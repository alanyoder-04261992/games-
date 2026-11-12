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
      for (let i = 0; i < game.seats; i++)
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
          connected: !!p?.connected,
          isHost: s.playerId === 'host',
          autopilot: !!p?.autopilot,
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
        .map((p) => ({ id: p.id, name: p.name, hue: p.hue, connected: !!p.connected, isHost: !!p.isHost, seat: this.seatOf(p.id) })),
      started: this.started,
    };
  }

  #broadcastLobby() {
    if (this.destroyed) return;
    this.#sendAll({ t: 'lobby', lobby: this.lobby() });
  }

  setOption(key, value) {
    if (this.started) return;
    this.options[key] = value;
    this.#broadcastLobby();
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
    this.seq = 0;
    this.lastEvent = { type: 'start' };
    this.#broadcastLobby();
    this.#broadcastState(this.lastEvent);
    this.#persist();
    this.schedule();
  }

  rematch() {
    this.started = false;
    this.claim = null;
    this.start();
  }

  handle(playerId, msg) {
    const p = this.players.get(playerId);
    if (!p) return;
    switch (msg.t) {
      case 'ping':
        this.#send(p, { t: 'pong' });
        break;
      case 'action': {
        const seat = this.seatOf(playerId);
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
        if (p.isHost && this.game.engine.isOver(this.state)) this.rematch();
        break;
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
    if (this.claim != null && !this.game.engine.claimActive(this.state, this.claim)) this.claim = null;
    this.#broadcastState(this.lastEvent);
    this.#persist();
    this.emit('applied', { seat, action, state: this.state });
    this.schedule();
    return true;
  }

  #sendState(p, event) {
    if (!this.state) return;
    const seat = this.seatOf(p.id);
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
    let pick = null;
    let wait = Infinity;
    for (const seat of actors) {
      const s = this.seats[seat];
      let delay = null;
      if (this.claim != null) delay = 380;
      else if (s.kind === 'bot') delay = this.game.pace ? this.game.pace(this.state, this.lastEvent, this.prevState) : 700;
      else if (s.kind === 'human') {
        const p = this.players.get(s.playerId);
        if (p?.autopilot) delay = this.game.pace ? this.game.pace(this.state, this.lastEvent, this.prevState) : 700;
        else if (!p?.connected) delay = 9000; // give a dropped player a moment, then the computer covers
      }
      if (delay == null) continue;
      delay *= this.claim != null ? Math.min(speed, 1) : speed;
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
      players: [...this.players.values()].map(({ id, name, hue, token, isHost, kicked }) => ({ id, name, hue, token, isHost, kicked })),
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
  receive(msg) {
    // async like a real network, so the UI code path is the same for everyone
    queueMicrotask(() => dispatch(this, msg));
  }
  send(msg) {
    this.room.handle('host', msg);
  }
  act(action) {
    this.send({ t: 'action', action });
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
    this.send({ t: 'action', action });
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
