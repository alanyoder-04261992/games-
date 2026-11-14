// Rooms and game sessions.
//
// Every game, single player or online, runs inside a HostRoom. The host's browser owns the
// real game state, runs the rules engine and the computer players, and sends each player
// only their own view. Guests (GuestClient) send actions and render what they receive.
// Because this is generic, any game that follows the contract in docs/ADDING_A_GAME.md
// gets online multiplayer, computer players, reconnects and saving for free.
//
// Network: WebRTC data channels through PeerJS (https://peerjs.com). No server of our own is
// needed, so the whole Game Center can be hosted as static files.
import { Emitter, roomCode, store, uid } from './util.js';

const PEER_PREFIX = 'gamecenter-v1-';
const BOT_NAMES = ['Maple', 'Hank', 'Ruth', 'Otis', 'June', 'Walt', 'Ivy', 'Gus', 'Pearl', 'Abe', 'Nell', 'Clem'];
const BOT_HUES = [12, 140, 265, 45, 190, 320, 95, 225];
export const SPEEDS = {
  relaxed: { label: 'Relaxed', factor: 1.6 },
  normal: { label: 'Normal', factor: 1 },
  fast: { label: 'Fast', factor: 0.55 },
  turbo: { label: 'Turbo', factor: 0.25 },
};

function peerOptions() {
  const params = new URLSearchParams(location.search);
  const custom = params.get('peer') || store.get('gc.peerServer');
  const opts = { debug: 1 };
  if (custom) {
    const [host, port] = custom.split(':');
    Object.assign(opts, {
      host,
      port: Number(port) || 443,
      path: '/',
      secure: Number(port) === 443 || (!port && location.protocol === 'https:'),
    });
  }
  if (params.has('noice')) opts.config = { iceServers: [] };
  return opts;
}

function loadPeer() {
  if (window.Peer) return Promise.resolve(window.Peer);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = new URL('../vendor/peerjs.min.js', import.meta.url).href;
    s.onload = () => resolve(window.Peer);
    s.onerror = () => reject(new Error('Could not load the networking library'));
    document.head.append(s);
  });
}

// =====================================================================
// Host
// =====================================================================
export class HostRoom extends Emitter {
  constructor({ game, profile, online = false, options = {}, settings = {}, saved = null }) {
    super();
    this.game = game;
    this.online = online;
    this.code = saved?.code || (online ? roomCode() : null);
    this.peer = null;
    this.status = online ? 'connecting' : 'offline';
    this.players = new Map();
    this.rematchVotes = new Set(); // players who said "I'm in" for a rematch after the game ended
    this.chatLog = saved?.chat || [];
    this.timer = null;
    this.claim = null;
    this.destroyed = false;
    this.options = { ...defaultOptions(game), ...options, ...(saved?.options || {}) };
    this.settings = { speed: 'normal', autoClaim: true, botLevel: 'normal', ...settings, ...(saved?.settings || {}) };

    const me = { id: 'host', name: profile.name, hue: profile.hue, token: 'host', isHost: true, connected: true, autopilot: false };
    this.players.set('host', me);
    if (saved) {
      for (const p of saved.players || []) if (p.id !== 'host') this.players.set(p.id, { ...p, connected: false, link: null });
      this.seats = saved.seats;
      this.state = saved.state;
      this.seq = saved.seq || 0;
      this.started = true;
      this.lastEvent = null;
    } else {
      this.seats = [];
      for (let i = 0; i < seatCount(game, this.options); i++)
        this.seats.push(i === 0 ? { kind: 'human', playerId: 'host' } : online ? { kind: 'open' } : this.#newBot(i));
      this.state = null;
      this.seq = 0;
      this.started = false;
    }
    this.local = new LocalClient(this);
    if (online) this.#listen();
    this.heartbeat = setInterval(() => this.#checkAlive(), 3000);
  }

  // ---------- networking ----------
  async #listen(attempt = 0) {
    let Peer;
    try {
      Peer = await loadPeer();
    } catch (e) {
      this.#setStatus('error', e.message);
      return;
    }
    if (this.destroyed) return;
    const peer = new Peer(PEER_PREFIX + this.code, peerOptions());
    this.peer = peer;
    peer.on('open', () => this.#setStatus('online'));
    peer.on('connection', (conn) => this.#accept(conn));
    peer.on('disconnected', () => {
      if (this.destroyed) return;
      this.#setStatus('connecting');
      setTimeout(() => !this.destroyed && !peer.destroyed && peer.reconnect(), 1500);
    });
    peer.on('error', (err) => {
      if (this.destroyed) return;
      if (err.type === 'unavailable-id') {
        peer.destroy();
        if (this.started && attempt < 25) {
          // our old connection is still registered after a refresh; it expires shortly
          this.#setStatus('connecting', 'Re-opening the room…');
          setTimeout(() => this.#listen(attempt + 1), 3000);
        } else if (!this.started) {
          this.code = roomCode();
          this.#listen(attempt + 1);
          this.#broadcastLobby();
        }
        return;
      }
      if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type)) {
        this.#setStatus('connecting', 'Network trouble, retrying…');
        return;
      }
      console.warn('peer error', err.type, err);
    });
  }

  #setStatus(status, detail = '') {
    this.status = status;
    this.statusDetail = detail;
    this.local.emit('status', status, detail);
    this.#broadcastLobby();
  }

  #accept(conn) {
    let playerId = null;
    conn.on('data', (msg) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.t === 'hello') {
        playerId = this.#hello(conn, msg);
        return;
      }
      if (!playerId) return;
      const p = this.players.get(playerId);
      if (!p || p.link !== conn) return;
      p.lastSeen = Date.now();
      this.handle(playerId, msg);
    });
    conn.on('close', () => {
      const p = playerId && this.players.get(playerId);
      if (p && p.link === conn) this.#drop(p);
    });
    conn.on('error', () => {});
  }

  #hello(conn, msg) {
    let p = [...this.players.values()].find((x) => x.token && x.token === msg.token && x.id !== 'host');
    if (p?.kicked) {
      conn.send({ t: 'kicked' });
      setTimeout(() => conn.close(), 300);
      return null;
    }
    if (!p) {
      p = { id: uid(8), token: msg.token || uid(16), autopilot: false };
      this.players.set(p.id, p);
    }
    if (p.link && p.link !== conn) {
      try {
        p.link.close();
      } catch {
        /* already closed */
      }
    }
    Object.assign(p, {
      name: String(msg.name || 'Player').slice(0, 20),
      hue: Number(msg.hue) || 0,
      connected: true,
      link: conn,
      lastSeen: Date.now(),
    });
    conn.send({ t: 'welcome', playerId: p.id, token: p.token, gameId: this.game.id, code: this.code });
    // a newcomer takes an open seat while we're in the lobby
    if (!this.started && this.seatOf(p.id) == null) {
      const order = this.game.joinOrder || this.seats.map((_, i) => i);
      const open = order.find((i) => this.seats[i]?.kind === 'open');
      if (open != null) this.seats[open] = { kind: 'human', playerId: p.id };
    }
    this.#system(`${p.name} ${this.seatOf(p.id) != null ? 'joined' : 'is watching'}`);
    this.#broadcastLobby();
    if (this.started) this.#sendState(p, this.lastEvent);
    for (const entry of this.chatLog.slice(-30)) this.#send(p, { t: 'chat', ...entry, replay: true });
    this.schedule();
    return p.id;
  }

  #drop(p) {
    if (!p.connected) return;
    p.connected = false;
    p.link = null;
    p.voice = null;
    this.#system(`${p.name} disconnected`);
    this.#broadcastLobby();
    this.schedule();
  }

  #checkAlive() {
    const now = Date.now();
    for (const p of this.players.values()) {
      if (p.id === 'host' || !p.connected) continue;
      if (now - (p.lastSeen || 0) > 15000) this.#drop(p);
    }
  }

  #send(p, msg) {
    if (p.id === 'host') this.local.receive(msg);
    else if (p.connected && p.link?.open) {
      try {
        p.link.send(msg);
      } catch (e) {
        console.warn('send failed', e);
      }
    }
  }

  #sendAll(msg) {
    for (const p of this.players.values()) this.#send(p, msg);
  }

  // ---------- lobby ----------
  #newBot(seat) {
    const used = new Set(this.seats?.map((s) => s?.name).filter(Boolean));
    const pool = BOT_NAMES.filter((n) => !used.has(n));
    const name = pool[(seat * 5 + Math.floor(Math.random() * pool.length)) % pool.length];
    return { kind: 'bot', name, hue: BOT_HUES[(seat * 3 + name.length) % BOT_HUES.length], level: this.settings.botLevel };
  }

  seatOf(playerId) {
    const i = this.seats.findIndex((s) => s.kind === 'human' && s.playerId === playerId);
    return i < 0 ? null : i;
  }

  // ---------- several people on one device (pass and play) ----------
  // Extra people at a device are "companions": players with `device` set to the id of the
  // device's own player. They have no connection of their own; the device shows and plays
  // whichever of its seats has to act (see #focus), and is online when its player is.
  #device(p) {
    return p?.device ? this.players.get(p.device) : p;
  }

  #online(p) {
    return !!this.#device(p)?.connected;
  }

  // every seat played from this device (its own player's and its companions')
  deviceSeats(deviceId) {
    const out = [];
    this.seats.forEach((s, i) => {
      if (s.kind !== 'human') return;
      const p = this.players.get(s.playerId);
      if (s.playerId === deviceId || p?.device === deviceId) out.push(i);
    });
    return out;
  }

  // The seat a device shows right now: one of its seats that has to act (staying on the same
  // one while it still has moves), otherwise the seat it showed last.
  #focus(p) {
    const seats = this.deviceSeats(p.id);
    if (!seats.length) return null;
    const actors = this.state && !this.game.engine.isOver(this.state) ? this.game.engine.actors(this.state) : [];
    const acting = seats.filter((i) => actors.includes(i));
    if (acting.includes(p.focus)) return p.focus;
    if (acting.length) return (p.focus = acting[0]);
    if (seats.includes(p.focus)) return p.focus;
    return (p.focus = seats[0]);
  }

  // Seat another person at this device. Before the game: an open seat, else a computer's seat.
  addLocalPlayer(deviceId, name, seat = null) {
    if (!this.game.sameDevice || this.started) return null;
    const device = this.players.get(deviceId);
    if (!device || device.device) return null;
    if (seat == null || this.seats[seat]?.kind === 'human') {
      seat = this.seats.findIndex((x) => x.kind === 'open');
      if (seat < 0) seat = this.seats.findIndex((x) => x.kind === 'bot');
    }
    if (seat < 0 || !this.seats[seat] || this.seats[seat].kind === 'human') return null;
    const taken = new Set([...this.players.values()].map((x) => x.hue));
    const hue = [20, 140, 270, 330, 190, 50, 100, 230].find((x) => !taken.has(x)) ?? Math.floor(Math.random() * 360);
    const p = { id: uid(8), device: deviceId, name: String(name || 'Player').trim().slice(0, 20) || 'Player', hue, autopilot: false };
    this.players.set(p.id, p);
    this.seats[seat] = { kind: 'human', playerId: p.id };
    this.#system(`${p.name} is playing on ${device.name}'s device`);
    this.#broadcastLobby();
    return p.id;
  }

  removeLocalPlayer(id) {
    const p = this.players.get(id);
    if (!p?.device) return;
    const seat = this.seatOf(id);
    if (seat != null) this.seats[seat] = this.started ? this.#newBot(seat) : this.online ? { kind: 'open' } : this.#newBot(seat);
    this.players.delete(id);
    this.#broadcastLobby();
    if (this.started) {
      this.#broadcastState(this.lastEvent);
      this.schedule();
    }
    this.#persist();
  }

  seatInfo() {
    return this.seats.map((s, i) => {
      if (s.kind === 'human') {
        const p = this.players.get(s.playerId);
        return {
          seat: i,
          kind: 'human',
          playerId: s.playerId,
          name: p?.name || 'Player',
          hue: p?.hue ?? 200,
          connected: this.#online(p),
          isHost: s.playerId === 'host',
          autopilot: !!p?.autopilot,
          device: p?.device || null, // set for someone playing on another player's device
        };
      }
      if (s.kind === 'bot') return { seat: i, kind: 'bot', name: s.name, hue: s.hue, level: s.level, connected: true };
      return { seat: i, kind: 'open', name: 'Open seat', hue: 0 };
    });
  }

  lobby() {
    return {
      code: this.code,
      online: this.online,
      status: this.status,
      gameId: this.game.id,
      options: this.options,
      settings: this.settings,
      seats: this.seatInfo(),
      players: [...this.players.values()]
        .filter((p) => !p.kicked)
        .map((p) => ({
          id: p.id,
          name: p.name,
          hue: p.hue,
          connected: this.#online(p),
          isHost: !!p.isHost,
          device: p.device || null,
          seat: this.seatOf(p.id),
          voice: p.voice || null,
          hostMuted: !!p.hostMuted,
        })),
      started: this.started,
      // ids of players ready for a rematch (only after a game has ended)
      rematch: [...this.rematchVotes].filter((id) => this.players.has(id) && !this.players.get(id).kicked && this.deviceSeats(id).length),
    };
  }

  #broadcastLobby() {
    if (this.destroyed) return;
    this.#sendAll({ t: 'lobby', lobby: this.lobby() });
  }

  setOption(key, value) {
    if (this.started) return;
    this.options[key] = value;
    this.#resizeSeats();
    this.#broadcastLobby();
  }

  // Games whose player count is a table option (game.seatCount) grow or shrink the table here.
  #resizeSeats() {
    const want = seatCount(this.game, this.options);
    while (this.seats.length < want) this.seats.push(this.online ? { kind: 'open' } : this.#newBot(this.seats.length));
    while (this.seats.length > want) {
      // drop an empty or computer seat from the end first; a person left without a seat watches
      let i = this.seats.findLastIndex((s) => s.kind !== 'human');
      if (i < 0) i = this.seats.length - 1;
      this.seats.splice(i, 1);
    }
  }

  setSetting(key, value) {
    this.settings[key] = value;
    if (key === 'botLevel') for (const s of this.seats) if (s.kind === 'bot') s.level = value;
    this.#broadcastLobby();
    this.#persist();
    this.schedule();
  }

  setSeat(seat, kind, playerId) {
    const cur = this.seats[seat];
    if (!cur) return;
    if (kind === 'bot') this.seats[seat] = this.#newBot(seat);
    else if (kind === 'open') {
      if (this.started) return; // a started game never has empty chairs
      this.seats[seat] = { kind: 'open' };
    } else if (kind === 'human') {
      const from = this.seatOf(playerId);
      if (from != null) this.seats[from] = this.started ? this.#newBot(from) : { kind: 'open' };
      this.seats[seat] = { kind: 'human', playerId };
    }
    this.#broadcastLobby();
    if (this.started) {
      this.#broadcastState(this.lastEvent);
      this.schedule();
    }
    this.#persist();
  }

  // swap two seats (lets the host arrange partners)
  swapSeats(a, b) {
    if (this.started) return;
    [this.seats[a], this.seats[b]] = [this.seats[b], this.seats[a]];
    this.#broadcastLobby();
  }

  kick(playerId) {
    const p = this.players.get(playerId);
    if (!p || p.isHost) return;
    if (p.device) return this.removeLocalPlayer(playerId);
    for (const q of [...this.players.values()]) if (q.device === playerId) this.removeLocalPlayer(q.id);
    p.kicked = true;
    this.#send(p, { t: 'kicked' });
    const seat = this.seatOf(playerId);
    if (seat != null) this.seats[seat] = this.started ? this.#newBot(seat) : { kind: 'open' };
    setTimeout(() => p.link?.close(), 300);
    this.#system(`${p.name} was removed`);
    this.#broadcastLobby();
    if (this.started) this.schedule();
  }

  #system(text) {
    const entry = { from: null, name: 'Table', text, ts: Date.now(), system: true };
    this.chatLog.push(entry);
    this.chatLog = this.chatLog.slice(-80);
    this.#sendAll({ t: 'chat', ...entry });
  }

  // ---------- game ----------
  start() {
    if (this.started) return;
    for (let i = 0; i < this.seats.length; i++) if (this.seats[i].kind === 'open') this.seats[i] = this.#newBot(i);
    this.state = this.game.engine.setup({ seed: (Math.random() * 2 ** 32) >>> 0, options: this.options });
    this.started = true;
    this.rematchVotes.clear();
    this.seq = 0;
    this.due = null;
    this.lastEvent = { type: 'start' };
    this.#broadcastLobby();
    this.#broadcastState(this.lastEvent);
    this.#persist();
    this.schedule();
  }

  // Same table, same seats, same players, same room code: just a fresh deal. Anyone who
  // dropped out keeps their seat (a computer player covers it until they come back).
  rematch() {
    this.started = false;
    this.claim = null;
    this.start();
  }

  // A seated player taps Rematch after the game ended. The host's tap starts the new game
  // right away (the host's device runs the table). Anyone else's tap tells the table they are
  // in: the host sees who is ready on their Rematch button, plus a toast and a chat line.
  #rematchVote(p) {
    if (!this.started || !this.state || !this.game.engine.isOver(this.state)) return;
    if (p.isHost) return this.rematch();
    if (p.device || !this.deviceSeats(p.id).length || this.rematchVotes.has(p.id)) return; // watchers don't get a say
    this.rematchVotes.add(p.id);
    this.#system(`${p.name} is in for a rematch`);
    this.#send(this.players.get('host'), { t: 'toast', text: `${p.name} wants a rematch` });
    this.#broadcastLobby();
  }

  handle(playerId, msg) {
    const p = this.players.get(playerId);
    if (!p) return;
    switch (msg.t) {
      case 'ping':
        this.#send(p, { t: 'pong' });
        break;
      case 'action': {
        // a device plays for any of its seats (pass and play); default to the one it shows
        const mine = this.deviceSeats(playerId);
        const seat = mine.includes(msg.seat) ? msg.seat : this.#focus(p);
        if (seat == null || !this.started) return;
        if (this.claim != null) return; // the round is being played out automatically
        const err = this.game.engine.check
          ? this.game.engine.check(this.state, seat, msg.action)
          : this.game.engine.legal(this.state, seat).length
            ? null
            : 'Not your turn';
        if (err) {
          this.#send(p, { t: 'reject', text: err, seq: this.seq });
          this.#sendState(p, null);
          return;
        }
        this.applyAction(seat, msg.action);
        break;
      }
      case 'chat': {
        const text = String(msg.text || '').slice(0, 300).trim();
        if (!text) return;
        const entry = { from: p.id, name: p.name, hue: p.hue, text, ts: Date.now(), emote: !!msg.emote };
        this.chatLog.push(entry);
        this.chatLog = this.chatLog.slice(-80);
        this.#sendAll({ t: 'chat', ...entry });
        break;
      }
      case 'voice':
        // someone joined, left or muted themselves in voice chat (see core/voice.js)
        p.voice = msg.on && msg.peerId ? { on: true, peerId: String(msg.peerId).slice(0, 80), muted: !!msg.muted } : null;
        this.#broadcastLobby();
        break;
      case 'voice-force': {
        // the host mutes (or unmutes) someone for the whole table
        if (!p.isHost) return;
        const target = this.players.get(msg.playerId);
        if (!target || target.isHost) return;
        target.hostMuted = !!msg.muted;
        this.#send(target, { t: 'voice-force', muted: target.hostMuted });
        this.#system(`${p.name} ${target.hostMuted ? 'muted' : 'unmuted'} ${target.name}`);
        this.#broadcastLobby();
        break;
      }
      case 'autopilot':
        p.autopilot = !!msg.on;
        this.#broadcastLobby();
        this.#broadcastState(null);
        this.schedule();
        break;
      case 'sync':
        this.#sendState(p, null);
        break;
      case 'rematch':
        this.#rematchVote(p);
        break;
      case 'local-add':
        this.addLocalPlayer(p.id, msg.name, msg.seat ?? null);
        break;
      case 'local-remove': {
        const q = this.players.get(msg.id);
        if (q?.device === p.id && !this.started) this.removeLocalPlayer(q.id);
        break;
      }
      case 'rt': {
        // Real-time channel for action games (see docs/ADDING_A_GAME.md). Relayed to everyone
        // else at the table as-is: no rules engine, no saving, no seat checks. Games that use
        // it decide for themselves what each message means.
        if (!this.started) return;
        const out = { t: 'rt', from: this.seatOf(playerId), player: playerId, data: msg.data };
        for (const other of this.players.values()) if (other.id !== playerId && !other.kicked) this.#send(other, out);
        break;
      }
    }
  }

  applyAction(seat, action) {
    const prev = this.state;
    try {
      this.state = this.game.engine.apply(this.state, seat, action);
    } catch (e) {
      console.warn('rejected action', action, e.message);
      return false;
    }
    this.seq++;
    this.lastEvent = { seat, action, seq: this.seq };
    this.prevState = prev;
    if (this.due) delete this.due[seat]; // real-time games: this seat starts a fresh clock
    if (this.claim != null && !this.game.engine.claimActive(this.state, this.claim)) this.claim = null;
    this.#broadcastState(this.lastEvent);
    this.#persist();
    this.emit('applied', { seat, action, state: this.state });
    this.schedule();
    return true;
  }

  #sendState(p, event) {
    if (!this.state || p.device) return; // companions see their device's screen
    const seat = this.#focus(p);
    const engine = this.game.engine;
    const view = engine.view(this.state, seat);
    let ev = null;
    if (event?.action) {
      ev = { seat: event.seat, seq: event.seq, action: engine.redact ? engine.redact(event.action, event.seat, seat) : event.action };
    } else if (event?.type === 'start') ev = { type: 'start' };
    this.#send(p, {
      t: 'state',
      seq: this.seq,
      view,
      event: ev,
      seat,
      seats: this.seatInfo(),
      speed: this.settings.speed,
      claim: this.claim != null,
      over: engine.isOver(this.state),
    });
  }

  #broadcastState(event) {
    for (const p of this.players.values()) this.#sendState(p, event);
  }

  // Decide whether someone should move automatically, and when.
  schedule() {
    clearTimeout(this.timer);
    if (!this.started || this.destroyed || !this.state) return;
    const engine = this.game.engine;
    if (engine.isOver(this.state)) return;

    if (this.claim == null && this.settings.autoClaim && engine.claim) {
      const token = engine.claim(this.state);
      if (token != null) {
        this.claim = token;
        const seat = engine.actors(this.state)[0];
        const who = this.seatInfo()[seat]?.name || 'Leader';
        this.#sendAll({ t: 'toast', text: `${who} has the rest — playing it out` });
      }
    }

    const speed = SPEEDS[this.settings.speed]?.factor ?? 1;
    const actors = engine.actors(this.state);
    // pace's 4th argument says who is about to move, so a game can time each seat differently
    const pace = (seat, level) => (this.game.pace ? this.game.pace(this.state, this.lastEvent, this.prevState, { seat, level }) : 700);
    // Real-time games (manifest `realtime: true`, where several seats act at once): each seat
    // keeps its own clock from when it could first act, so one quick player doesn't keep
    // restarting the computer's reaction time.
    const now = Date.now();
    if (this.game.realtime) for (const seat of Object.keys(this.due || {})) if (!actors.includes(+seat)) delete this.due[seat];
    let pick = null;
    let wait = Infinity;
    for (const seat of actors) {
      const s = this.seats[seat];
      let delay = null;
      if (this.claim != null) delay = 380;
      else if (s.kind === 'bot') delay = pace(seat, s.level);
      else if (s.kind === 'human') {
        const p = this.players.get(s.playerId);
        if (p?.autopilot) delay = pace(seat, this.settings.botLevel);
        else if (!this.#online(p)) delay = 9000; // give a dropped player a moment, then the computer covers
      }
      if (delay == null) continue;
      delay *= this.claim != null ? Math.min(speed, 1) : speed;
      if (this.game.realtime) {
        this.due ??= {};
        this.due[seat] ??= now + delay;
        delay = Math.max(0, this.due[seat] - now);
      }
      if (delay < wait) [pick, wait] = [seat, delay];
    }
    if (pick == null) return;
    this.timer = setTimeout(() => this.#autoMove(pick), wait);
  }

  #autoMove(seat) {
    if (this.destroyed || !this.started) return;
    const engine = this.game.engine;
    if (!engine.actors(this.state).includes(seat)) return this.schedule();
    let action = null;
    if (this.claim != null && engine.claimMove) action = engine.claimMove(this.state, seat);
    if (!action) {
      const s = this.seats[seat];
      const view = engine.view(this.state, seat);
      const legal = engine.legal(this.state, seat);
      const level = s.kind === 'bot' ? s.level : this.settings.botLevel;
      action = this.game.bot.choose(view, legal, level);
    }
    if (!this.applyAction(seat, action)) {
      // should never happen; fall back to the first legal move so the table never stalls
      const legal = engine.legal(this.state, seat);
      if (legal.length) this.applyAction(seat, legal[0]);
    }
  }

  #persist() {
    if (!this.started) return;
    store.set(`gc.save.${this.game.id}`, {
      gameId: this.game.id,
      code: this.code,
      online: this.online,
      options: this.options,
      settings: this.settings,
      seats: this.seats,
      players: [...this.players.values()].map(({ id, name, hue, token, isHost, kicked, device }) => ({ id, name, hue, token, isHost, kicked, device })),
      state: this.state,
      seq: this.seq,
      chat: this.chatLog.slice(-30),
      savedAt: Date.now(),
      over: this.game.engine.isOver(this.state),
    });
  }

  close({ keepSave = true } = {}) {
    this.destroyed = true;
    clearTimeout(this.timer);
    clearInterval(this.heartbeat);
    if (!keepSave) store.del(`gc.save.${this.game.id}`);
    this.#sendAll({ t: 'closed' });
    setTimeout(() => this.peer?.destroy(), 200);
  }
}

function seatCount(game, options) {
  const n = game.seatCount ? Number(game.seatCount(options)) : game.seats;
  return Number.isInteger(n) && n > 0 ? n : game.seats;
}

function defaultOptions(game) {
  const o = {};
  for (const opt of game.options || []) o[opt.key] = opt.default;
  return o;
}

// The host's own player talks to the room directly.
class LocalClient extends Emitter {
  constructor(room) {
    super();
    this.room = room;
    this.isHost = true;
    this.playerId = 'host';
    this.status = room.online ? 'connecting' : 'offline';
    this.on('status', (s) => (this.status = s));
  }
  get peer() {
    return this.room.peer;
  }
  receive(msg) {
    // real-time messages skip the microtask hop; they are frequent and order-insensitive
    if (msg.t === 'rt') return dispatch(this, msg);
    // async like a real network, so the UI code path is the same for everyone
    queueMicrotask(() => dispatch(this, msg));
  }
  send(msg) {
    this.room.handle('host', msg);
  }
  act(action) {
    this.send({ t: 'action', action, seat: this.lastState?.seat }); // the seat on screen (pass and play)
  }
  chat(text, emote = false) {
    this.send({ t: 'chat', text, emote });
  }
  setAutopilot(on) {
    this.send({ t: 'autopilot', on });
  }
  leave() {
    this.room.close();
  }
}

function dispatch(client, msg) {
  switch (msg.t) {
    case 'lobby':
      client.lobby = msg.lobby;
      client.emit('lobby', msg.lobby);
      break;
    case 'state':
      client.lastState = msg;
      client.emit('state', msg);
      break;
    case 'chat':
      client.emit('chat', msg);
      break;
    case 'rt':
      client.emit('rt', msg);
      break;
    case 'voice-force':
      client.emit('voice-force', !!msg.muted);
      break;
    case 'toast':
      client.emit('toast', msg.text);
      break;
    case 'reject':
      client.emit('reject', msg.text);
      break;
    case 'kicked':
      client.emit('kicked');
      break;
    case 'closed':
      client.emit('closed');
      break;
  }
}

// =====================================================================
// Guest
// =====================================================================
export class GuestClient extends Emitter {
  constructor({ code, profile }) {
    super();
    this.code = code.toUpperCase();
    this.profile = profile;
    this.isHost = false;
    this.playerId = null;
    const saved = store.get('gc.guest');
    this.token = saved?.code === this.code ? saved.token : uid(16);
    this.status = 'connecting';
    this.closed = false;
    this.retries = 0;
    this.#connect();
    this.ping = setInterval(() => this.send({ t: 'ping' }), 4000);
  }

  async #connect() {
    let Peer;
    try {
      Peer = await loadPeer();
    } catch (e) {
      this.#status('error', e.message);
      return;
    }
    if (this.closed) return;
    if (!this.peer || this.peer.destroyed) {
      this.peer = new Peer(undefined, peerOptions());
      this.peer.on('error', (err) => {
        if (this.closed) return;
        if (err.type === 'peer-unavailable') {
          if (!this.playerId && this.retries > 2) this.#status('notfound', 'No game found with that code');
          else this.#retry();
        } else if (['network', 'server-error', 'socket-error', 'socket-closed', 'disconnected'].includes(err.type)) {
          this.#status('connecting', 'Network trouble, retrying…');
          this.#retry();
        }
      });
      this.peer.on('disconnected', () => !this.closed && setTimeout(() => !this.peer.destroyed && this.peer.reconnect(), 1500));
      await new Promise((resolve) => {
        if (this.peer.open) resolve();
        else this.peer.once('open', resolve);
      });
    }
    if (this.closed) return;
    const conn = this.peer.connect(PEER_PREFIX + this.code, { reliable: true, serialization: 'json' });
    this.conn = conn;
    const timeout = setTimeout(() => {
      if (!conn.open && this.conn === conn) this.#retry();
    }, 9000);
    conn.on('open', () => {
      clearTimeout(timeout);
      this.retries = 0;
      conn.send({ t: 'hello', token: this.token, name: this.profile.name, hue: this.profile.hue });
    });
    conn.on('data', (msg) => this.#receive(msg));
    conn.on('close', () => {
      if (this.conn === conn && !this.closed) {
        this.#status('connecting', 'Lost connection, reconnecting…');
        this.#retry();
      }
    });
    conn.on('error', () => {});
  }

  #retry() {
    if (this.closed || this.retryTimer) return;
    this.retries++;
    this.retryTimer = setTimeout(
      () => {
        this.retryTimer = null;
        this.#connect();
      },
      Math.min(1000 * this.retries, 5000),
    );
  }

  #status(s, detail = '') {
    this.status = s;
    this.emit('status', s, detail);
  }

  #receive(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'welcome') {
      this.playerId = msg.playerId;
      this.token = msg.token;
      this.gameId = msg.gameId;
      store.set('gc.guest', { code: this.code, token: this.token, gameId: msg.gameId, at: Date.now() });
      this.#status('online');
      this.emit('welcome', msg);
      return;
    }
    if (msg.t === 'pong') return;
    if (msg.t === 'kicked' || msg.t === 'closed') store.del('gc.guest');
    dispatch(this, msg);
  }

  send(msg) {
    if (this.conn?.open) {
      try {
        this.conn.send(msg);
      } catch {
        /* reconnect will resync */
      }
    }
  }
  act(action) {
    this.send({ t: 'action', action, seat: this.lastState?.seat }); // the seat on screen (pass and play)
  }
  chat(text, emote = false) {
    this.send({ t: 'chat', text, emote });
  }
  setAutopilot(on) {
    this.send({ t: 'autopilot', on });
  }
  leave() {
    this.closed = true;
    clearInterval(this.ping);
    clearTimeout(this.retryTimer);
    store.del('gc.guest');
    try {
      this.conn?.close();
    } catch {
      /* ignore */
    }
    setTimeout(() => this.peer?.destroy(), 200);
  }
}
