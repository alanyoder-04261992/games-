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
