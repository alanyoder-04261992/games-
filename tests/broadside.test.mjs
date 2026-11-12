import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../public/games/broadside/engine.js';
import { chooseAction } from '../public/games/broadside/ai.js';

function play(seed, levels = ['normal', 'normal'], options = {}) {
  let s = E.setup({ seed, options });
  let moves = 0;
  while (!E.isOver(s)) {
    const seat = E.actors(s)[0];
    const legal = E.legal(s, seat);
    const a = chooseAction(E.view(s, seat), legal, levels[seat]);
    assert.equal(E.check(s, seat, a), null, `seed ${seed}: bot move rejected`);
    s = E.apply(s, seat, a);
    if (++moves > 1000) throw new Error('game did not finish');
  }
  return s;
}

test('broadside: games finish and the winner sank every ship', () => {
  for (const size of [8, 10, 12])
    for (const mode of E.MODES)
      for (let seed = 1; seed <= 6; seed++) {
        const s = play(seed * 31 + size, ['normal', 'hard'], { size, mode });
        assert.ok(s.winner === 0 || s.winner === 1);
        assert.ok(s.boards[1 - s.winner].ships.every((sh) => sh.sunk));
        assert.equal(s.boards[0].ships.length, E.FLEETS[size].length);
      }
});

test('broadside: expert sinks a fleet in far fewer shots than random firing', () => {
  let shots = 0;
  for (let seed = 1; seed <= 30; seed++) {
    let s = E.setup({ seed });
    s = E.apply(s, 0, E.legal(s, 0)[0]);
    s = E.apply(s, 1, E.legal(s, 1)[0]);
    // seat 0 fires every turn (seat 1 passes by firing too, but we only count seat 0)
    let n = 0;
    while (!E.isOver(s)) {
      const seat = s.turn;
      const a = seat === 0 ? chooseAction(E.view(s, 0), E.legal(s, 0), 'hard') : E.legal(s, 1)[0];
      s = E.apply(s, seat, a);
      if (seat === 0) n++;
    }
    if (s.winner === 0) shots += n;
    else shots += 100;
  }
  const avg = shots / 30;
  assert.ok(avg < 62, `expert averages ${avg.toFixed(1)} shots (random needs ~96)`);
});

test('broadside: expert beats easy most of the time', () => {
  let wins = 0;
  for (let seed = 1; seed <= 30; seed++) if (play(seed, ['hard', 'easy']).winner === 0) wins++;
  assert.ok(wins >= 22, `expert won ${wins}/30`);
});

test('broadside: placement rules', () => {
  const s = E.setup({ seed: 1 });
  const fleet = E.legal(s, 0)[0].ships;
  assert.equal(E.check(s, 0, { type: 'place', ships: fleet }), null);
  const offGrid = fleet.map((sh) => (sh.id === 'flagship' ? { ...sh, x: 8, y: 0, dir: 'h' } : sh));
  assert.match(E.check(s, 0, { type: 'place', ships: offGrid }), /off the grid/);
  const overlap = fleet.map((sh, k) => ({ ...sh, x: 0, y: k === 1 ? 0 : k * 2, dir: 'h' }));
  assert.match(E.check(s, 0, { type: 'place', ships: overlap }), /overlap/);
  assert.match(E.check(s, 0, { type: 'place', ships: fleet.slice(1) }), /whole fleet/);
});

test('broadside: firing modes and turns', () => {
  const ready = (mode) => {
    let s = E.setup({ seed: 4, options: { mode } });
    s = E.apply(s, 0, E.legal(s, 0)[0]);
    return E.apply(s, 1, E.legal(s, 1)[0]);
  };
  // classic: one shot each
  let s = ready('classic');
  const t = s.turn;
  const miss = (st, seat) => E.legal(st, seat).find((m) => !st.boards[1 - seat].ships.some((sh) => sh.cells.includes(m.i)));
  const hit = (st, seat) => ({ type: 'fire', i: st.boards[1 - seat].ships[0].cells.find((c) => !st.boards[1 - seat].shots.some((x) => x.i === c)) });
  s = E.apply(s, t, hit(s, t));
  assert.equal(s.turn, 1 - t);
  assert.throws(() => E.apply(s, t, { type: 'fire', i: 0 }), /not your turn/);
  // chain: a hit fires again, a miss passes the turn
  s = ready('chain');
  s = E.apply(s, s.turn, hit(s, s.turn));
  assert.equal(s.turn, t);
  s = E.apply(s, t, miss(s, t));
  assert.equal(s.turn, 1 - t);
  // barrage: one shot per ship afloat
  s = ready('barrage');
  assert.equal(s.shotsLeft, 5);
  for (let k = 0; k < 5; k++) s = E.apply(s, t, miss(s, t));
  assert.equal(s.turn, 1 - t);
  // no firing twice at the same square
  s = ready('classic');
  const m = miss(s, s.turn);
  s = E.apply(s, s.turn, m);
  s = E.apply(s, s.turn, miss(s, s.turn));
  assert.throws(() => E.apply(s, s.turn, m), /already/);
});

test('broadside: views hide the enemy fleet until ships sink', () => {
  let s = E.setup({ seed: 2 });
  s = E.apply(s, 0, E.legal(s, 0)[0]);
  s = E.apply(s, 1, E.legal(s, 1)[0]);
  const v = E.view(s, 0);
  assert.equal(v.boards[0].ships.length, 5);
  assert.equal(v.boards[1].ships.length, 0);
  assert.equal(v.seed, undefined);
  const end = play(2);
  assert.equal(E.view(end, 0).boards[1].ships.length, 5, 'everything is revealed at the end');
});
