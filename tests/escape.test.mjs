import test from 'node:test';
import assert from 'node:assert/strict';
import game from '../public/games/escape-grind/index.js';
import { expenses, passive, legal, rank } from '../public/games/escape-grind/engine.js';

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

test('escape the grind: finished games record what the end-of-game summary shows', () => {
  let escaped = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const { s } = play(seed, ['hard', 'normal', 'easy', 'normal'], { length: seed % 2 ? 'long' : 'quick' });
    assert.ok(Number.isInteger(s.endRound) && s.endRound >= 1 && s.endRound <= s.maxRounds, `end round ${s.endRound}`);
    for (const p of s.players) {
      if (p.track === 'free') {
        escaped++;
        assert.ok(p.escapedRound >= 1 && p.escapedRound <= s.endRound, 'escape turn is within the game');
        assert.ok(p.escapedPassive > 0, 'passive income at the escape is recorded');
      } else {
        assert.equal(p.escapedRound, null);
        assert.equal(p.escapedPassive, null);
      }
    }
    // a win on time goes to whoever the summary's standings put first
    if (s.winReason.startsWith('was furthest')) assert.equal([...s.players].sort((a, b) => rank(b) - rank(a))[0].seat, s.winner);
  }
  assert.ok(escaped > 0, 'some players broke free');
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

test('escape the grind: real-life economy games run, cycle, and keep money sane', () => {
  const phases = new Set();
  let shorts = 0, dipBuys = 0, minMult = 9, maxMult = 0;
  for (let seed = 200; seed < 240; seed++) {
    let s = engine.setup({ seed, options: { length: 'long', economy: 'real' } });
    let moves = 0;
    while (!engine.isOver(s)) {
      const seat = engine.actors(s)[0];
      const m = bot.choose(engine.view(s, seat), engine.legal(s, seat), ['hard', 'normal', 'easy', 'hard'][seat]);
      assert.equal(engine.check(s, seat, m), null, `bot move is legal: ${JSON.stringify(m)}`);
      if (m.type === 'short') shorts++;
      if (m.type === 'trade' && m.qty > 0 && s.econ.phase === 'recession') dipBuys++;
      s = engine.apply(s, seat, m);
      phases.add(s.econ.phase);
      minMult = Math.min(minMult, s.econ.mult);
      maxMult = Math.max(maxMult, s.econ.mult);
      if (++moves > 30000) throw new Error('game did not end');
    }
    assert.ok(s.winner != null);
    for (const p of s.players) {
      assert.ok(p.cash >= 0 && Number.isFinite(p.cash), `cash ${p.cash}`);
      for (const v of Object.values(s.econ.prices)) assert.ok(v >= 1);
    }
  }
  assert.deepEqual([...phases].sort(), ['boom', 'expansion', 'recession', 'recovery', 'slowdown']);
  assert.ok(shorts > 0 && dipBuys > 0, `bots used the market (shorts ${shorts}, dip buys ${dipBuys})`);
  assert.ok(minMult < 0.95 && maxMult > 1.05, `prices moved (${minMult}–${maxMult})`);
});

test('escape the grind: shorting profits when the price falls', () => {
  let s = engine.setup({ seed: 5, options: { economy: 'real' } });
  const seat = s.turn;
  s.players[seat].cash = 10000;
  s = engine.apply(s, seat, { type: 'short', sym: 'NPK', qty: 100 });
  assert.equal(s.players[seat].shorts.NPK.price, 16);
  s.econ.prices.NPK = 10; // the price drops
  s = engine.apply(s, seat, { type: 'cover', sym: 'NPK' });
  assert.equal(s.players[seat].cash, 10600);
  assert.equal(engine.check(s, seat, { type: 'short', sym: 'NPK', qty: 5000 }), 'Shorting needs cash of 50% of the position');
});
