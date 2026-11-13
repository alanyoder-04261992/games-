import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../public/games/shed-tycoon/engine.js';
import { chooseAction } from '../public/games/shed-tycoon/ai.js';

function seeded(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), t | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export function play(seed, levels, options = {}) {
  const random = seeded(seed + 3);
  let s = E.setup({ seed, options });
  const total = E.census(s);
  let moves = 0;
  while (!E.isOver(s)) {
    const seat = E.actors(s)[0];
    const legal = E.legal(s, seat);
    assert.ok(legal.length > 0);
    const a = chooseAction(E.view(s, seat), legal, levels[seat % levels.length], random);
    assert.equal(E.check(s, seat, a), null, `bot move rejected: ${JSON.stringify(a)}`);
    s = E.apply(s, seat, a);
    assert.deepEqual(E.census(s), total, 'tokens are conserved');
    for (const pl of s.players) {
      assert.ok(pl.tokens.every((k) => k >= 0));
      assert.ok(pl.reserved.length <= E.RESERVE_LIMIT);
      if (s.phase === 'play') assert.ok(E.tokenCount(pl) <= E.TOKEN_LIMIT);
    }
    if (++moves > 3000) throw new Error(`game ${seed} did not finish`);
  }
  return s;
}

test('shed tycoon: the deck and the lots', () => {
  assert.equal(E.CARDS.length, 35 + 30 + 20);
  for (const c of E.CARDS) {
    assert.ok(c.name, 'every order has a name');
    assert.ok(c.cost.reduce((a, b) => a + b, 0) > 0);
  }
  assert.equal(new Set(E.CARDS.map((c) => c.name)).size, E.CARDS.length, 'names are unique');
  assert.equal(E.LOTS.length, 20);
});

test('shed tycoon: bots finish 2, 3 and 4 player games and the winner has the target', () => {
  for (const players of [2, 3, 4]) {
    for (let seed = 1; seed <= 25; seed++) {
      const s = play(seed * 17 + players, ['normal', 'hard', 'easy', 'normal'], { players, target: [12, 15, 18][seed % 3] });
      assert.ok(s.winners.length >= 1);
      assert.ok(E.points(s.players[s.winners[0]]) >= s.target, `seed ${seed}: winner reached the target`);
      assert.ok(s.turnNo < 60, `took ${s.turnNo} rounds`);
    }
  }
});

test('shed tycoon: expert beats easy most of the time', () => {
  let wins = 0;
  for (let seed = 1; seed <= 30; seed++) if (play(seed, ['hard', 'easy'], { players: 2 }).winners.includes(0)) wins++;
  assert.ok(wins >= 22, `expert won ${wins}/30`);
});

test('shed tycoon: taking, reserving and the token limit', () => {
  let s = E.setup({ seed: 4, options: { players: 2 } });
  const me = s.turn;
  assert.throws(() => E.apply(s, me, { type: 'take', mats: [0, 1] }), /three different/);
  s = E.apply(s, me, { type: 'take', mats: [0, 0] });
  assert.equal(s.players[me].tokens[0], 2);
  const other = s.turn;
  s = E.apply(s, other, { type: 'reserve', tier: 2, slot: E.DECK });
  assert.equal(s.players[other].tokens[E.CASH], 1);
  // the blind order is hidden from the other player
  assert.equal(E.view(s, me).players[other].reserved[0].id, null);
  assert.notEqual(E.view(s, other).players[other].reserved[0].id, null);
  assert.equal(E.view(s, me).decks[2], 20 - 4 - 1);
});
