import test from 'node:test';
import assert from 'node:assert/strict';
import game from '../public/games/spit-speed/index.js';
import { choose } from '../public/games/spit-speed/ai.js';
import { setup, legal, actors, apply, check, view, isOver, cardsLeft } from '../public/games/spit-speed/engine.js';

function seeded(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), t | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

// every card is somewhere, exactly once
function allCards(s) {
  const cards = [...s.piles.flat()];
  if (s.mode === 'speed') {
    cards.push(...s.side.flat());
    for (const p of s.p) cards.push(...p.hand, ...p.stock);
  } else for (const p of s.p) cards.push(...p.stacks.flat(), ...p.spit);
  return cards.sort((a, b) => a - b);
}
const DECK = [...Array(52).keys()];

// Both players act at once in the real game; here a random one of the seats that can act goes
// next (weighted, so one bot can be "faster" than the other).
function play(seed, options, levels = ['normal', 'normal'], bias = 0.5) {
  const random = seeded(seed + 7);
  let s = setup({ seed, options });
  let steps = 0;
  while (!isOver(s)) {
    const who = actors(s);
    assert.ok(who.length, `nobody can act (seed ${seed}, phase ${s.phase})`);
    const seat = who.length === 2 ? (random() < bias ? 0 : 1) : who[0];
    const moves = legal(s, seat);
    const move = choose(view(s, seat), moves, levels[seat], random);
    assert.equal(check(s, seat, move), null);
    s = apply(s, seat, move);
    assert.deepEqual(allCards(s), DECK, `cards went missing (seed ${seed}, step ${steps})`);
    assert.ok(++steps < 20000, `game ${seed} never ended`);
  }
  return s;
}

test('speed: bot games end with a winner who is out of cards', () => {
  let outs = 0;
  for (let seed = 1; seed <= 150; seed++) {
    const s = play(seed, { mode: 'speed', wrap: seed % 3 ? 'yes' : 'no' });
    assert.ok(s.winner === 0 || s.winner === 1 || s.winner === 'draw');
    if (s.reason === 'out') {
      outs++;
      assert.equal(cardsLeft(s, s.winner), 0);
    }
  }
  assert.ok(outs > 140, `only ${outs} games ended by someone going out`);
});

test('spit: bot games play rounds and end', () => {
  let rounds = 0;
  for (let seed = 1; seed <= 150; seed++) {
    const s = play(seed, { mode: 'spit', wrap: seed % 3 ? 'yes' : 'no' });
    assert.ok(s.winner === 0 || s.winner === 1 || s.winner === 'draw');
    if (s.reason === 'out') assert.equal(cardsLeft(s, s.winner), 0);
    rounds += s.round;
  }
  assert.ok(rounds > 150, 'spit games should take more than one round');
});

test('the faster player usually wins', () => {
  for (const mode of ['speed', 'spit']) {
    let wins = 0;
    for (let seed = 1; seed <= 60; seed++) if (play(seed, { mode }, ['normal', 'normal'], 0.75).winner === 0) wins++;
    assert.ok(wins >= 40, `${mode}: faster player won ${wins}/60`);
  }
});

test('views hide the other hand, the draw piles and the seed', () => {
  const s = setup({ seed: 3, options: { mode: 'speed' } });
  const v = view(s, 0);
  assert.equal(v.players[1].hand, null);
  assert.equal(v.players[0].hand.length, 5);
  assert.equal(v.players[1].handCount, 5);
  assert.equal(typeof v.players[0].stock, 'number');
  assert.equal(v.rng, undefined);
  assert.equal(view(s, null).players[0].hand, null);
  const t = setup({ seed: 3, options: { mode: 'spit' } });
  const w = view(t, 1);
  assert.deepEqual(w.players[0].stacks.map((st) => st.n), [1, 2, 3, 4, 5]);
  assert.equal(w.players[0].spit, 11);
  assert.ok(!JSON.stringify(w).includes('"rng"'));
});

test('moves are checked', () => {
  let s = setup({ seed: 5, options: { mode: 'speed' } });
  // nobody plays before the first flip
  assert.ok(check(s, 0, { type: 'play', card: s.p[0].hand[0], pile: 0 }));
  for (let seed = 5; s.phase !== 'play'; seed++) {
    s = setup({ seed, options: { mode: 'speed' } });
    s = apply(apply(s, 0, { type: 'ready' }), 1, { type: 'ready' });
  }
  assert.throws(() => apply(s, 0, { type: 'play', card: s.p[1].hand[0], pile: 0 }), /hand/);
  assert.ok(check(s, null, { type: 'ready' }));
  // a card that doesn't fit is "too slow"
  const bad = s.p[0].hand.find((c) => !legal(s, 0).some((m) => m.card === c));
  if (bad != null && s.phase === 'play') assert.match(check(s, 0, { type: 'play', card: bad, pile: 0 }) || check(s, 0, { type: 'play', card: bad, pile: 1 }), /slow/);
});

test('manifest', () => {
  assert.equal(game.id, 'spit-speed');
  assert.equal(game.seats, 2);
  assert.ok(game.realtime);
  for (const level of Object.keys(game.botLevels)) assert.ok(game.pace(setup({ seed: 1 }), { seat: 0 }, null, { seat: 1, level }) > 0);
});
