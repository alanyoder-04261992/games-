// Voice chat for online tables.
//
// Everyone who taps "Join voice" opens their microphone (always on, with a mute button) and
// connects straight to every other person in voice — players and watchers alike, so a table
// can have as many voices as it has people. Audio travels peer to peer over WebRTC, on the
// same PeerJS connection the game uses; nothing is recorded or sent to a server.
//
// The host can mute anyone for the whole table. A host-muted player's microphone is switched
// off on their own device AND every other device stops playing their audio, so it holds even
// if their app misbehaves.
//
// Signaling rides on the room: each client tells the host { t: 'voice', on, peerId, muted },
// the host puts that in the lobby roster, and everyone calls everyone listed. To avoid two
// calls between the same pair, only the side with the smaller peer id dials.
import { Emitter, store } from './util.js';

const SPEAK_LEVEL = 0.035; // RMS above this counts as talking
const SPEAK_HOLD = 450; // ms a speaker stays "lit" after going quiet

export class Voice extends Emitter {
  constructor(client) {
    super();
    this.client = client;
    this.state = 'off'; // off | starting | on | error
    this.stream = null;
    this.muted = false; // muted by me
    this.hostMuted = false; // muted by the host
    this.calls = new Map(); // peerId -> { call, playerId, audio, meter }
    this.localMutes = new Set(store.get('gc.voice.localMutes', [])); // playerIds I silenced for myself
    this.speaking = new Set();
    this.ctx = null;
    this.meters = new Map(); // playerId -> { analyser, data, last }
    this.peerBound = null;
    this.offs = [
      client.on('lobby', () => this.reconcile()),
      client.on('voice-force', (muted) => this.#forced(muted)),
      client.on('welcome', () => this.state === 'on' && this.#announce()),
      client.on('status', (s) => s === 'online' && this.state === 'on' && this.#announce()),
    ];
    this.tick = setInterval(() => this.#measure(), 120);
    // phones may refuse to start audio until the next tap; retry then
    this.on('blocked', () =>
      window.addEventListener(
        'pointerdown',
        () => {
          this.ctx?.resume?.();
          for (const c of this.calls.values()) c.audio?.play?.().catch(() => {});
        },
        { once: true, capture: true },
      ),
    );
  }

  // ---------- public ----------
  get available() {
    return !!navigator.mediaDevices?.getUserMedia && !!window.RTCPeerConnection;
  }

  async join() {
    if (this.state === 'on' || this.state === 'starting') return;
    if (!this.available) {
      this.#setState('error', 'This browser can’t do voice chat.');
      return;
    }
    this.#setState('starting');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
    } catch (e) {
      const denied = e?.name === 'NotAllowedError' || e?.name === 'SecurityError';
      this.#setState('error', denied ? 'Microphone permission was blocked. Allow it in your browser settings and try again.' : 'No microphone was found.');
      return;
    }
    this.#audioContext();
    this.#meter(this.client.playerId, this.stream);
    this.#applyTrack();
    this.#setState('on');
    this.#announce();
    this.reconcile();
  }

  leave() {
    for (const peerId of [...this.calls.keys()]) this.#hangUp(peerId);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.meters.clear();
    this.speaking.clear();
    const was = this.state;
    this.#setState('off');
    if (was === 'on') this.client.send({ t: 'voice', on: false });
    this.emit('speaking', this.speaking);
  }

  setMuted(muted) {
    this.muted = !!muted;
    this.#applyTrack();
    this.#announce();
    this.emit('change');
  }

  toggleMute() {
    if (this.hostMuted) return false;
    this.setMuted(!this.muted);
    return true;
  }

  // Silence one person on my device only.
  setLocalMute(playerId, muted) {
    if (muted) this.localMutes.add(playerId);
    else this.localMutes.delete(playerId);
    store.set('gc.voice.localMutes', [...this.localMutes]);
    this.#applyPlayback();
    this.emit('change');
  }

  // Host only: mute or unmute someone for everybody.
  hostMute(playerId, muted) {
    if (!this.client.isHost) return;
    this.client.send({ t: 'voice-force', playerId, muted: !!muted });
  }

  // Everyone the host lists as being in voice (including me), with their state.
  roster() {
    const players = this.client.lobby?.players || [];
    return players
      .filter((p) => p.voice?.on || p.id === this.client.playerId)
      .map((p) => {
        const me = p.id === this.client.playerId;
        const on = me ? this.state === 'on' : !!p.voice?.on;
        const call = [...this.calls.values()].find((c) => c.playerId === p.id);
        return {
          id: p.id,
          name: p.name,
          hue: p.hue,
          isHost: p.isHost,
          me,
          on,
          muted: me ? this.muted : !!p.voice?.muted,
          hostMuted: me ? this.hostMuted : !!p.hostMuted,
          localMuted: this.localMutes.has(p.id),
          connected: me ? this.state === 'on' : !!call?.audio,
          speaking: this.speaking.has(p.id),
        };
      })
      .filter((r) => r.on);
  }

  destroy() {
    this.leave();
    clearInterval(this.tick);
    this.offs.forEach((off) => off());
    this.ctx?.close?.();
  }

  // ---------- connections ----------
  reconcile() {
    // the host remembers who it muted, even across someone leaving and rejoining voice
    const mine = this.client.lobby?.players?.find((p) => p.id === this.client.playerId);
    if (mine && !!mine.hostMuted !== this.hostMuted) this.#forced(!!mine.hostMuted, false);
    if (this.state !== 'on') {
      this.emit('change');
      return;
    }
    const peer = this.client.peer;
    if (!peer || peer.destroyed) return;
    this.#bindPeer(peer);
    const myId = peer.id;
    const wanted = new Map();
    for (const p of this.client.lobby?.players || []) {
      if (p.id === this.client.playerId || !p.voice?.on || !p.voice.peerId || !p.connected) continue;
      wanted.set(p.voice.peerId, p.id);
    }
    for (const peerId of [...this.calls.keys()]) if (!wanted.has(peerId)) this.#hangUp(peerId);
    for (const [peerId, playerId] of wanted) {
      if (this.calls.has(peerId)) {
        this.calls.get(peerId).playerId = playerId;
        continue;
      }
      if (myId && myId < peerId) {
        const call = peer.call(peerId, this.stream, { metadata: { playerId: this.client.playerId } });
        if (call) this.#track(call, playerId);
      }
    }
    this.#applyPlayback();
    this.emit('change');
  }

  #bindPeer(peer) {
    if (this.peerBound === peer) return;
    this.peerBound = peer;
    peer.on('call', (call) => {
      if (this.state !== 'on' || !this.stream) {
        call.close();
        return;
      }
      const roster = this.client.lobby?.players || [];
      const from = roster.find((p) => p.voice?.peerId === call.peer);
      if (this.calls.has(call.peer)) this.#hangUp(call.peer);
      call.answer(this.stream);
      this.#track(call, from?.id || call.metadata?.playerId || null);
    });
  }

  #track(call, playerId) {
    const entry = { call, playerId, audio: null };
    this.calls.set(call.peer, entry);
    call.on('stream', (remote) => {
      if (this.calls.get(call.peer) !== entry) return;
      if (!entry.audio) {
        entry.audio = new Audio();
        entry.audio.autoplay = true;
        entry.audio.setAttribute('playsinline', '');
        entry.audio.dataset.voice = entry.playerId || '';
        entry.audio.style.display = 'none';
        document.body.append(entry.audio);
      }
      entry.audio.srcObject = remote;
      entry.audio.play?.().catch(() => this.emit('blocked'));
      if (entry.playerId) this.#meter(entry.playerId, remote);
      this.#applyPlayback();
      this.emit('change');
    });
    const done = () => {
      if (this.calls.get(call.peer) === entry) this.#hangUp(call.peer);
      // the other side may come back; let the next roster update reconnect
      setTimeout(() => this.reconcile(), 1500);
    };
    call.on('close', done);
    call.on('error', done);
  }

  #hangUp(peerId) {
    const entry = this.calls.get(peerId);
    if (!entry) return;
    this.calls.delete(peerId);
    try {
      entry.call.close();
    } catch {
      /* already closed */
    }
    if (entry.audio) {
      entry.audio.srcObject = null;
      entry.audio.remove();
    }
    if (entry.playerId) this.meters.delete(entry.playerId);
    this.emit('change');
  }

  #announce() {
    if (this.state !== 'on') return;
    const peerId = this.client.peer?.id;
    if (!peerId) {
      setTimeout(() => this.#announce(), 800);
      return;
    }
    this.client.send({ t: 'voice', on: true, peerId, muted: this.muted });
  }

  // ---------- muting ----------
  #forced(muted, notify = true) {
    if (this.hostMuted === !!muted) return;
    this.hostMuted = !!muted;
    this.#applyTrack();
    if (notify) this.emit('forced', this.hostMuted);
    this.emit('change');
  }

  #applyTrack() {
    const live = !this.muted && !this.hostMuted;
    this.stream?.getAudioTracks().forEach((t) => (t.enabled = live));
  }

  #applyPlayback() {
    const players = this.client.lobby?.players || [];
    for (const entry of this.calls.values()) {
      if (!entry.audio) continue;
      const p = players.find((x) => x.id === entry.playerId);
      entry.audio.muted = this.localMutes.has(entry.playerId) || !!p?.hostMuted;
    }
  }

  // ---------- who is talking ----------
  #audioContext() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) this.ctx = new AC();
    this.ctx?.resume?.();
  }

  #meter(playerId, stream) {
    if (!this.ctx) return;
    try {
      const src = this.ctx.createMediaStreamSource(stream);
      const analyser = this.ctx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      this.meters.set(playerId, { analyser, data: new Float32Array(analyser.fftSize), last: 0 });
    } catch {
      /* some browsers can't meter remote audio; the speaking glow just won't show */
    }
  }

  #measure() {
    if (this.state !== 'on') return;
    const now = performance.now();
    const before = [...this.speaking].join();
    const players = this.client.lobby?.players || [];
    for (const [playerId, m] of this.meters) {
      const me = playerId === this.client.playerId;
      const p = players.find((x) => x.id === playerId);
      const silenced = me ? this.muted || this.hostMuted : !!p?.voice?.muted || !!p?.hostMuted || this.localMutes.has(playerId);
      m.analyser.getFloatTimeDomainData(m.data);
      let sum = 0;
      for (const v of m.data) sum += v * v;
      const rms = Math.sqrt(sum / m.data.length);
      if (!silenced && rms > SPEAK_LEVEL) m.last = now;
      if (!silenced && now - m.last < SPEAK_HOLD) this.speaking.add(playerId);
      else this.speaking.delete(playerId);
    }
    if ([...this.speaking].join() !== before) this.emit('speaking', this.speaking);
  }

  #setState(state, detail = '') {
    this.state = state;
    this.error = state === 'error' ? detail : '';
    this.emit('state', state, detail);
    this.emit('change');
  }
}
