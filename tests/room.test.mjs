// The table itself (public/core/room.js), run offline in Node: no network needed.
import test from 'node:test';
import assert from 'node:assert/strict';

// the browser globals core/util.js touches when it loads
globalThis.Element ??= class {};
globalThis.DocumentFragment ??= class {};
const { HostRoom } = await import('../public/core/room.js');
const { default: rook } = await import('../public/games/rook/index.js');

const open = (game) => new HostRoom({ game, profile: { name: 'Alan', hue: 210 }, online: false });
const states = (room) => {
  const got = [];
  room.local.on('state', (msg) => got.push(msg));
  return got;
};
const settle = () => new Promise((r) => setTimeout(r, 0));

test('Rematch: the new game reaches every screen (move numbers keep counting up)', async (t) => {
  const room = open(rook);
  t.after(() => room.close());
  room.schedule = () => {}; // no computer moves while we look
  const got = states(room);
  room.start();
  // play a few moves so the move number is well past zero, then end the game
  for (let i = 0; i < 6; i++) {
    const seat = rook.engine.actors(room.state)[0];
    room.applyAction(seat, rook.bot.choose(rook.engine.view(room.state, seat), rook.engine.legal(room.state, seat), 'normal'));
  }
  room.state = { ...room.state, phase: 'over', winner: 0 };
  const before = room.seq;
  assert.ok(before >= 6);
  room.local.send({ t: 'rematch' });
  await settle();
  const last = got.at(-1);
  assert.equal(last.event?.type, 'start', 'the host saw a new game start');
  assert.ok(last.seq > before, `new game's move number ${last.seq} is above the old ${before}`);
  // screens like Rook's drop an update whose move number went backwards: this one must pass
  assert.ok(!(last.seq < before && last.event));
  assert.notEqual(last.view.phase, 'over');
});

test('Seats: the host can move to another seat and swap back before the game', (t) => {
  const room = open(rook);
  t.after(() => room.close());
  // offline tables fill with computer players; seat the host somewhere else and back
  const bot = room.seats[2];
  room.setSeat(2, 'human', 'host');
  assert.equal(room.seatOf('host'), 2);
  assert.equal(room.seats[0].kind, 'open');
  room.swapSeats(0, 2);
  assert.equal(room.seatOf('host'), 0);
  assert.ok(bot);
});

// ---------- online: the next game with the same people ----------
// A stand-in for PeerJS (the table only needs it to exist) and a fake connection per guest
// that keeps what the table sends it.
class FakePeer {
  constructor() {
    this.handlers = {};
    this.open = true;
    this.destroyed = false;
    this.disconnected = false;
  }
  on(ev, fn) {
    (this.handlers[ev] ||= []).push(fn);
  }
  destroy() {
    this.destroyed = true;
  }
  reconnect() {
    this.reconnects = (this.reconnects || 0) + 1;
  }
}
globalThis.window ??= {};
globalThis.window.Peer = FakePeer;
globalThis.location ??= { search: '', protocol: 'http:', origin: 'http://localhost', pathname: '/' };
const { default: four } = await import('../public/games/four-in-a-row/index.js');
const { INVITE_MS, PICK_MS } = await import('../public/core/room.js');

function onlineTable(t, names) {
  const room = new HostRoom({ game: rook, profile: { name: 'Alan', hue: 210 }, online: true });
  t.after(() => room.close());
  room.schedule = () => {};
  const guests = names.map((name, k) => {
    const got = [];
    const link = { open: true, send: (m) => got.push(m), close() {} };
    const p = { id: `g${k}`, name, hue: k, token: `t${k}`, connected: true, link, lastSeen: Date.now(), autopilot: false };
    room.players.set(p.id, p);
    room.seats[k + 1] = { kind: 'human', playerId: p.id };
    return { id: p.id, got, last: (t) => got.filter((m) => m.t === t).at(-1) };
  });
  return { room, guests };
}

test('Next game: the host picks another game and everyone at the table gets an invite', async (t) => {
  const { room, guests } = onlineTable(t, ['Sara', 'Ben', 'Ruth']);
  const [sara, ben, ruth] = guests;
  room.start();
  room.pickNext();
  for (const g of guests) assert.equal(g.last('picking')?.host, 'Alan', 'told the host is picking');
  assert.ok(room.picking > Date.now() && room.picking <= Date.now() + PICK_MS);
  assert.equal(room.lobby().picking, room.picking);

  room.switchGame(four, {}, {});
  assert.equal(room.game.id, 'four-in-a-row');
  assert.equal(room.started, false);
  assert.equal(room.seats.length, four.seats);
  assert.equal(room.seatOf('host'), 0);
  assert.ok(room.seats.slice(1).every((s) => s.kind === 'open'), 'nobody is seated before answering');
  for (const g of guests) {
    const inv = g.last('invite');
    assert.equal(inv?.gameId, 'four-in-a-row');
    assert.equal(inv.code, room.code, 'same table code');
    assert.ok(inv.until > Date.now() && inv.until <= Date.now() + INVITE_MS + 50);
  }
  assert.ok(room.lobby().players.filter((p) => p.invited).length === 3);

  room.handle(sara.id, { t: 'invite', yes: true });
  assert.equal(room.seatOf(sara.id), 1, 'Sara takes the open seat');
  room.handle(ben.id, { t: 'invite', yes: false });
  assert.equal(room.players.has(ben.id), false, 'Ben is off the table');
  assert.equal(ben.last('closed')?.quiet, true);
  // Four in a Row has two seats: Ruth says yes too and watches
  room.handle(ruth.id, { t: 'invite', yes: true });
  assert.equal(room.seatOf(ruth.id), null);
  assert.ok(room.players.has(ruth.id));
  assert.equal(room.lobby().players.find((p) => p.id === ruth.id).invited, null);
  // the next game plays with the people who said yes
  room.start();
  assert.ok(sara.last('state'), 'Sara gets the new game');
  assert.equal(sara.last('state').seats[1].playerId, sara.id);
});

test('Next game: an invite nobody answers runs out, and the table closes if nothing is picked', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: Date.now() });
  const { room, guests } = onlineTable(t, ['Sara']);
  room.start();
  room.pickNext();
  room.switchGame(four, {}, {});
  // Sara's phone is connected (pings every few seconds) but nobody answers the invite
  for (let ms = 0; ms < INVITE_MS + 2500; ms += 2500) {
    if (room.players.has(guests[0].id)) room.handle(guests[0].id, { t: 'ping' });
    room.players.get(guests[0].id) && (room.players.get(guests[0].id).lastSeen = Date.now());
    t.mock.timers.tick(2500);
  }
  assert.equal(room.players.has(guests[0].id), false, 'no answer in time: off the table');
  assert.equal(guests[0].last('closed')?.quiet, true);

  const other = onlineTable(t, ['Ben']);
  other.room.start();
  other.room.pickNext();
  t.mock.timers.tick(PICK_MS + 10);
  assert.equal(other.room.destroyed, true, 'closed after the time to pick ran out');
});

test('Reconnecting the table: a host that lost the signalling server keeps trying', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: Date.now() });
  const { room } = onlineTable(t, ['Sara']);
  await new Promise((r) => setImmediate(r));
  for (let i = 0; i < 5 && !room.peer; i++) await new Promise((r) => setImmediate(r));
  assert.ok(room.peer, 'peer made');
  room.peer.disconnected = true;
  room.wake();
  t.mock.timers.tick(3000);
  t.mock.timers.tick(5000);
  t.mock.timers.tick(5000);
  assert.ok(room.peer.reconnects >= 2, `tries again and again (${room.peer.reconnects})`);
});
