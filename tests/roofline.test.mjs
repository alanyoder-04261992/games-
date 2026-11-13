import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../public/games/roofline/engine.js';
import { chooseAction } from '../public/games/roofline/ai.js';

function seeded(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), t | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function play(seed, levels, options = {}) {
  const random = seeded(seed + 7);
  let s = E.setup({ seed, options });
  let moves = 0;
  while (!E.isOver(s)) {
    const seat = E.actors(s)[0];
    const legal = E.legal(s, seat);
    assert.ok(legal.length > 0, 'someone to move always has a move');
    const a = chooseAction(E.view(s, seat), legal, levels[seat % levels.length], random);
    assert.equal(E.check(s, seat, a), null, `bot move rejected: ${JSON.stringify(a)}`);
    s = E.apply(s, seat, a);
    const c = E.census(s);
    for (const k of c) assert.equal(k, E.PER_COLOR, 'shingles are conserved');
    if (++moves > 2000) throw new Error(`game ${seed} did not finish`);
  }
  return s;
}

test('roofline: the roof layout has each color once per row and column', () => {
  for (let r = 0; r < 5; r++) {
    assert.equal(new Set([0, 1, 2, 3, 4].map((c) => E.roofColor(r, c))).size, 5);
    assert.equal(new Set([0, 1, 2, 3, 4].map((c) => E.roofColor(c, r))).size, 5);
    for (let k = 0; k < 5; k++) assert.equal(E.roofColor(r, E.roofCol(r, k)), k);
  }
});

test('roofline: placement scoring counts runs', () => {
  const roof = Array(25).fill(0);
  assert.equal(E.placeScore(roof, 2, 2), 1);
  roof[E.cell(2, 1)] = roof[E.cell(2, 3)] = 1;
  assert.equal(E.placeScore(roof, 2, 2), 3);
  roof[E.cell(1, 2)] = 1;
  assert.equal(E.placeScore(roof, 2, 2), 5);
});

test('roofline: bots finish 2, 3 and 4 player games', () => {
  for (const players of [2, 3, 4]) {
    for (let seed = 1; seed <= 25; seed++) {
      const s = play(seed * 31 + players, ['normal', 'hard', 'easy', 'normal'], { players, dormers: seed % 2 === 0 });
      assert.ok(s.winners.length >= 1);
      assert.ok(s.round >= 5 && s.round < 15, `rounds: ${s.round}`);
      assert.ok(s.players.some((p) => E.roofBonuses(p.roof).rows > 0));
    }
  }
});

test('roofline: expert beats easy most of the time', () => {
  let wins = 0;
  for (let seed = 1; seed <= 30; seed++) if (play(seed, ['hard', 'easy'], { players: 2 }).winners.includes(0)) wins++;
  assert.ok(wins >= 22, `expert won ${wins}/30`);
});

test('roofline: taking from a pallet sends the rest to the yard; first into the yard takes the whistle', () => {
  let s = E.setup({ seed: 3, options: { players: 2 } });
  const seat = s.turn;
  const p = s.pallets[0];
  const color = p[0];
  const rest = p.filter((x) => x !== color).length;
  s = E.apply(s, seat, { type: 'take', src: 0, color, rack: 4 });
  assert.equal(s.pallets[0].length, 0);
  assert.equal(s.yard.reduce((a, b) => a + b, 0), rest);
  if (rest) {
    const yc = s.yard.findIndex((k) => k > 0);
    s = E.apply(s, s.turn, { type: 'take', src: E.YARD, color: yc, rack: -1 });
    assert.equal(s.players[1 - seat].gutter[0], 'whistle');
    assert.equal(s.nextFirst, 1 - seat);
  }
  // a rack can't mix colors
  assert.throws(() => E.apply(s, seat, { type: 'take', src: 1, color: (s.players[seat].racks[4].color + 1) % 5, rack: 4 }));
});

test('roofline: the view hides the bag order and the seed', () => {
  const s = E.setup({ seed: 9, options: { players: 3 } });
  const v = E.view(s, 1);
  assert.equal(v.rng, undefined);
  assert.equal(typeof v.bag, 'number');
});
