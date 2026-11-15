// Voice chat for online tables.
//
// Everyone at an online table hears voice chat without doing anything: they "listen" from the
// moment they arrive and the whole time they're there (no microphone needed, nothing to allow).
// Talking is tap to talk: tapping the mic opens the microphone and you're live; tap again and
// it's off (the mic stays ready, muted, so the next tap is instant). Players and watchers
// alike, so a table can have as many voices as it has people. Audio travels peer to peer over
// WebRTC (through the table's relay when a network needs it); nothing is recorded or stored.
//
// Who calls whom: someone with a mic calls everyone listening; between two people with mics,
// the side with the smaller peer id dials. Two listeners don't need a call.
//
// The host can mute anyone for the whole table. A host-muted player's microphone is switched
// off on their own device AND every other device stops playing their audio, so it holds even
// if their app misbehaves.
//
// Signaling rides on the room: each client tells the host { t: 'voice', on, peerId, muted, mic },
// the host puts that in the lobby roster, and everyone connects to everyone listed.
import { Emitter, store } from './util.js';

const SPEAK_LEVEL = 0.035; // RMS above this counts as talking
const SPEAK_HOLD = 450; // ms a speaker stays "lit" after going quiet
const CALL_TIMEOUT = 15000; // a call that hasn't connected by then is dialled again

export class Voice extends Emitter {
  constructor(client) {
    super();
    this.client = client;
    this.state = 'off'; // off | listening (hears, no mic) | starting | on (mic) | error
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
      client.on('welcome', () => this.#announce()),
      client.on('status', (s) => s === 'online' && this.#announce()),
    ];
    this.tick = setInterval(() => this.#measure(), 120);
    // phones may refuse to start audio until the next tap; retry then
    this.on('blocked', () =>
      window.addEventListener(
        'pointerdown',
        () => this.unblock(),
        { once: true, capture: true },
      ),
    );
  }

  // ---------- public ----------
  get available() {
    return !!navigator.mediaDevices?.getUserMedia && !!window.RTCPeerConnection;
  }

  get hearing() {
    return this.state === 'on' || this.state === 'listening';
  }

  // Hear everyone in voice, without a microphone. Called when an online table opens.
  listen() {
    if (this.hearing || this.state === 'starting') return;
    store.set('gc.voice.listen', true);
    this.#setState('listening');
    this.#announce();
    this.reconcile();
  }

  // Phones only play sound after a tap; voice calls this on the next tap anywhere.
  unblock() {
    this.ctx?.resume?.();
    const plays = [...this.calls.values()].map((c) => c.audio?.play?.()).filter(Boolean);
    Promise.allSettled(plays).then((res) => {
      const still = res.some((r) => r.status === 'rejected');
      if (still) this.emit('blocked'); // try again on the next tap
      if (still !== !!this.blocked) {
        this.blocked = still;
        this.emit('change');
      }
    });
  }

  async join() {
    if (this.state === 'on' || this.state === 'starting') return;
    const before = this.state;
    store.set('gc.voice.listen', true);
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
      this.#setState('error', denied ? 'Microphone permission was blocked. Allow it in your browser settings and try again. You can still hear everyone.' : 'No microphone was found. You can still hear everyone.');
      // still hear everyone
      this.state = before === 'off' ? 'off' : 'listening';
      this.emit('change');
      return;
    }
    this.#audioContext();
    this.#meter(this.client.playerId, this.stream);
    this.#applyTrack();
    this.#setState('on');
    this.#announce();
    this.reconcile();
  }

  // Turn my microphone off but keep hearing everyone.
  stopTalking() {
    if (this.state !== 'on') return;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.meters.delete(this.client.playerId);
    this.speaking.delete(this.client.playerId);
    this.#setState('listening');
    this.#announce();
    this.reconcile();
    this.emit('speaking', this.speaking);
  }

  // Stop voice chat altogether: no mic, and no sound from anyone.
  leave(remember = true) {
    for (const peerId of [...this.calls.keys()]) this.#hangUp(peerId);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.meters.clear();
    this.speaking.clear();
    const was = this.state;
    this.#setState('off');
    if (remember) store.set('gc.voice.listen', false); // stays off at the next table too
    if (was === 'on' || was === 'listening') this.client.send({ t: 'voice', on: false });
    this.emit('speaking', this.speaking);
  }

  setMuted(muted) {
    this.muted = !!muted;
    this.#applyTrack();
    this.#announce();
    this.emit('change');
  }

  // Tap to talk: the first tap opens the microphone (asking permission once); after that each
  // tap turns talking on or off. Listening never stops.
  get talking() {
    return this.state === 'on' && !this.muted && !this.hostMuted;
  }

  async toggleTalk() {
    if (this.hostMuted) return false;
    if (this.state !== 'on') {
      this.muted = false;
      await this.join();
      return true;
    }
    this.setMuted(!this.muted);
    return true;
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

  // Everyone the host lists as being in voice (including me), with their state. `mic` says
  // whether they can talk; people without one are listening.
  roster() {
    const players = this.client.lobby?.players || [];
    return players
      .filter((p) => p.voice?.on || p.id === this.client.playerId)
      .map((p) => {
        const me = p.id === this.client.playerId;
        const on = me ? this.hearing : !!p.voice?.on;
        const mic = me ? this.state === 'on' : !!p.voice?.on && p.voice.mic !== false;
        const call = [...this.calls.values()].find((c) => c.playerId === p.id);
        return {
          id: p.id,
          name: p.name,
          hue: p.hue,
          isHost: p.isHost,
          me,
          on,
          mic,
          muted: me ? this.muted : !!p.voice?.muted,
          hostMuted: me ? this.hostMuted : !!p.hostMuted,
          localMuted: this.localMutes.has(p.id),
          // a call is only needed when one of us has a mic
          connected: me ? this.hearing : !!call?.live || (!mic && this.state !== 'on'),
          speaking: this.speaking.has(p.id),
        };
      })
      .map((r) => {
        r.live = r.mic && !r.muted && !r.hostMuted; // talking right now (their mic is on)
        return r;
      })
      .filter((r) => r.on);
  }

  destroy() {
    this.leave(false);
    clearInterval(this.tick);
    this.offs.forEach((off) => off());
    this.ctx?.close?.();
  }

  // ---------- connections ----------
  reconcile() {
    // the host remembers who it muted, even across someone leaving and rejoining voice
    const mine = this.client.lobby?.players?.find((p) => p.id === this.client.playerId);
    if (mine && !!mine.hostMuted !== this.hostMuted) this.#forced(!!mine.hostMuted, false);
    if (!this.hearing) {
      for (const peerId of [...this.calls.keys()]) this.#hangUp(peerId);
      this.emit('change');
      return;
    }
    const peer = this.client.peer;
    if (!peer || peer.destroyed) return;
    this.#bindPeer(peer);
    const myId = peer.id;
    const myMic = this.state === 'on' && !!this.stream;
    const wanted = new Map(); // peerId -> { playerId, shape }
    for (const p of this.client.lobby?.players || []) {
      if (p.id === this.client.playerId || !p.voice?.on || !p.voice.peerId || !p.connected) continue;
      const theirMic = p.voice.mic !== false;
      if (!myMic && !theirMic) continue; // two listeners: nothing to send
      wanted.set(p.voice.peerId, { playerId: p.id, shape: `${+myMic}${+theirMic}`, theirMic });
    }
    for (const [peerId, entry] of [...this.calls]) {
      const want = wanted.get(peerId);
      // gone, or someone turned a mic on or off: this call has to be made again
      if (!want || entry.shape !== want.shape) this.#hangUp(peerId);
    }
    for (const [peerId, want] of wanted) {
      if (this.calls.has(peerId)) {
        this.calls.get(peerId).playerId = want.playerId;
        continue;
      }
      // whoever has a mic dials; with two mics, the smaller peer id does
      const dial = myMic && (!want.theirMic || (myId && myId < peerId));
      if (dial) {
        const call = peer.call(peerId, this.stream, { metadata: { playerId: this.client.playerId } });
        if (call) this.#track(call, want.playerId, want.shape);
      }
    }
    this.#applyPlayback();
    this.emit('change');
  }

  #bindPeer(peer) {
    if (this.peerBound === peer) return;
    this.peerBound = peer;
    peer.on('call', (call) => {
      if (!this.hearing) {
        call.close();
        return;
      }
      const roster = this.client.lobby?.players || [];
      const from = roster.find((p) => p.voice?.peerId === call.peer);
      if (this.calls.has(call.peer)) this.#hangUp(call.peer);
      const myMic = this.state === 'on' && !!this.stream;
      // a listener answers without a microphone and just receives
      if (myMic) call.answer(this.stream);
      else call.answer();
      this.#track(call, from?.id || call.metadata?.playerId || null, `${+myMic}1`);
    });
  }

  #track(call, playerId, shape) {
    const entry = { call, playerId, audio: null, shape, live: false };
    this.calls.set(call.peer, entry);
    const theyTalk = shape?.[1] === '1';
    // a call that never connects (a network that blocks it, a lost answer) is tried again
    entry.timer = setTimeout(() => {
      if (this.calls.get(call.peer) === entry && !entry.live) {
        this.#hangUp(call.peer);
        this.reconcile();
      }
    }, CALL_TIMEOUT);
    // when only I talk, no sound comes back: the connection itself says it's working
    call.on('iceStateChanged', (st) => {
      if (this.calls.get(call.peer) !== entry) return;
      if ((st === 'connected' || st === 'completed') && !theyTalk && !entry.live) {
        entry.live = true;
        this.emit('change');
      }
    });
    call.on('stream', (remote) => {
      if (this.calls.get(call.peer) !== entry) return;
      entry.live = true;
      if (!entry.audio) {
        entry.audio = new Audio();
        entry.audio.autoplay = true;
        entry.audio.setAttribute('playsinline', '');
        entry.audio.dataset.voice = entry.playerId || '';
        entry.audio.style.display = 'none';
        document.body.append(entry.audio);
      }
      entry.audio.srcObject = remote;
      entry.audio.play?.().catch(() => {
        this.blocked = true;
        this.emit('blocked');
        this.emit('change');
      });
      this.#audioContext();
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
    clearTimeout(entry.timer);
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
    if (!this.hearing) return;
    const peerId = this.client.peer?.id;
    if (!peerId) {
      clearTimeout(this.announceTimer);
      this.announceTimer = setTimeout(() => this.#announce(), 800);
      return;
    }
    this.client.send({ t: 'voice', on: true, peerId, muted: this.muted, mic: this.state === 'on' });
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
    if (!this.hearing) return;
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
