import test from 'node:test';
import assert from 'node:assert/strict';
import game from '../public/games/escape-grind/index.js';
import { expenses, passive, legal } from '../public/games/escape-grind/engine.js';

const { engine, bot } = game;
function play(seed, levels, options = {}) {
  let s = engine.setup({ seed, options });
  let moves = 0;
  while (!engine.isOver(s)) {
    const seats = engine.actors(s);
    assert.equal(seats.length, 1, `one actor in phase ${s.phase}`);
    const seat = seats[0];
    const lm = engine.legal(s, seat);
    assert.ok(lm.length > 0, `moves exist in ${s.phase}`);
    const m = bot.choose(engine.view(s, seat), lm, levels[seat]);
    assert.ok(m, `bot chose a move in ${s.phase}`);
    s = engine.apply(s, seat, m);
    JSON.stringify(engine.view(s, seat));
    if (++moves > 20000) throw new Error('game did not end');
  }
  return { s, moves };
}

test('escape the grind: bot games end with a winner and sane money', () => {
  const reasons = {};
  let rounds = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const { s } = play(seed, ['hard', 'normal', 'easy', 'normal'], { length: 'long' });
    assert.ok(s.winner != null);
    reasons[s.winReason.startsWith('bought') ? 'dream' : s.winReason.startsWith('added') ? 'income' : 'time'] =
      (reasons[s.winReason.startsWith('bought') ? 'dream' : s.winReason.startsWith('added') ? 'income' : 'time'] || 0) + 1;
    rounds += s.round;
    for (const p of s.players) {
      assert.ok(Number.isFinite(p.cash) && p.cash >= 0, `cash never negative (${p.cash})`);
      assert.ok(p.bank >= 0 && p.bank % 1000 === 0);
    }
  }
  console.log('win types', reasons, 'avg rounds', (rounds / 60).toFixed(1));
});

test('escape the grind: quick games stop at the round limit', () => {
  for (let seed = 100; seed < 110; seed++) {
    const { s } = play(seed, ['easy', 'easy', 'easy', 'easy'], { length: 'quick' });
    assert.ok(s.round <= 41);
    assert.ok(s.winner != null);
  }
});

test('escape the grind: views hide the decks and the seed', () => {
  const s = engine.setup({ seed: 7 });
  const v = engine.view(s, 0);
  assert.equal(v.decks, undefined);
  assert.equal(v.rng, undefined);
  assert.ok(expenses(s.players[0]) > 0 && passive(s.players[0]) === 0);
  assert.ok(legal(s, s.turn).some((m) => m.type === 'roll'));
  assert.equal(engine.check(s, s.turn, { type: 'borrow', amount: 1500 }), 'Borrow in $1,000 steps');
});
