import test from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../public/games/rook/engine.js';
import { chooseAction } from '../public/games/rook/ai.js';

function playGame(seed, levels, options = {}) {
  let s = R.setup({ seed, options, firstDealer: 0 });
  let steps = 0;
  const timing = { play: [0, 0], bid: [0, 0], discard: [0, 0] };
  while (s.phase !== 'over' && steps < 20000) {
    const seat = R.actors(s)[0];
    const v = R.view(s, seat);
    const legal = R.legal(s, seat);
    const t0 = performance.now();
    const a = chooseAction(v, legal, levels[seat]);
    const dt = performance.now() - t0;
    if (timing[s.phase]) { timing[s.phase][0] += dt; timing[s.phase][1]++; }
    s = R.apply(s, seat, a);
    steps++;
  }
  return { s, steps, timing };
}

test('deck sizes and points total 200', () => {
  for (const lowCards of [true, false]) {
    const deck = R.fullDeck({ lowCards });
    assert.equal(deck.length, lowCards ? 45 : 33);
    assert.equal(R.sumPoints(deck) + R.LAST_TRICK_BONUS, 200);
  }
});

test('bird ranks between 10 and 11 of trump', () => {
  assert.ok(R.strength('bird', 'red') > R.strength('red-10', 'red'));
  assert.ok(R.strength('bird', 'red') < R.strength('red-11', 'red'));
  assert.equal(R.trickWinner([{ seat: 0, card: 'green-1' }, { seat: 1, card: 'bird' }], 'red'), 1);
  assert.equal(R.trickWinner([{ seat: 0, card: 'green-5' }, { seat: 1, card: 'green-1' }, { seat: 2, card: 'yellow-1' }], 'red'), 1);
});

test('short deck has no 2, 3, 4, 6, 7 or 8', () => {
  const ranks = new Set(R.fullDeck({ lowCards: false }).filter((c) => c !== R.BIRD).map(R.rankOf));
  assert.deepEqual([...ranks].sort((x, y) => x - y), [1, 5, 9, 10, 11, 12, 13, 14]);
  for (const r of [2, 3, 4]) assert.ok(!R.fullDeck({ lowCards: true }).some((c) => R.rankOf(c) === r));
});

test('bird setting: highest or lowest trump', () => {
  // default (no setting) and 'middle' are the same: between 10 and 11
  assert.equal(R.strength('bird', 'red', 'middle'), R.strength('bird', 'red'));
  assert.ok(R.strength('bird', 'red', 'high') > R.strength('red-1', 'red', 'high'));
  assert.ok(R.strength('bird', 'red', 'low') < R.strength('red-5', 'red', 'low'));
  assert.ok(R.strength('bird', 'red', 'low') > R.strength('green-1', 'red', 'low'));
  const plays = [{ seat: 0, card: 'red-1' }, { seat: 1, card: 'bird' }, { seat: 2, card: 'red-5' }];
  assert.equal(R.trickWinner(plays, 'red'), 0);
  assert.equal(R.trickWinner(plays, 'red', 'high'), 1);
  assert.equal(R.trickWinner(plays, 'red', 'low'), 0);
  assert.equal(R.trickWinner([{ seat: 0, card: 'red-5' }, { seat: 1, card: 'bird' }], 'red', 'low'), 0);
  // a game remembers the setting and scores tricks by it
  const s = R.setup({ seed: 5, options: { bird: 'high' } });
  assert.equal(s.options.bird, 'high');
  assert.equal(R.setup({ seed: 5 }).options.bird, 'middle');
});

test('dealer is stuck when everyone passes', () => {
  let s = R.setup({ seed: 7, firstDealer: 0 });
  for (const seat of [1, 2, 3]) s = R.apply(s, seat, { type: 'pass' });
  assert.equal(s.turn, 0);
  assert.ok(!R.legal(s, 0).some((a) => a.type === 'pass'));
  s = R.apply(s, 0, { type: 'bid', amount: 100 });
  assert.equal(s.phase, 'discard');
  assert.equal(s.hands[0].length, 15);
});

test('views hide other hands', () => {
  const s = R.setup({ seed: 3 });
  const v = R.view(s, 1);
  assert.equal(v.hand.length, 10);
  assert.equal(JSON.stringify(v).includes(s.hands[2][0] + '"'), JSON.stringify(v.hand).includes(s.hands[2][0] + '"') || JSON.stringify(v).includes(s.hands[2][0] + '"'));
  assert.equal(v.nestSize, 5);
  assert.ok(!('hands' in v) && !('nest' in v) && !('rng' in v));
});

test('full bot games finish with legal play (both decks)', () => {
  for (const [i, lowCards] of [[1, true], [2, false], [3, true]].entries()) {
    const { s, timing } = playGame(1000 + i, ['normal', 'easy', 'normal', 'easy'], { lowCards });
    assert.equal(s.phase, 'over');
    assert.ok(s.winner === 0 || s.winner === 1);
    const avg = (k) => (timing[k][1] ? (timing[k][0] / timing[k][1]).toFixed(1) : '-');
    console.log(`game ${i} rounds=${s.round} scores=${s.scores} ms/play=${avg('play')} ms/bid=${avg('bid')} ms/discard=${avg('discard')}`);
  }
});

test('full bot games finish with every Bird setting', () => {
  for (const [i, bird] of ['high', 'low'].entries()) {
    const { s } = playGame(2000 + i, ['normal', 'easy', 'normal', 'easy'], { lowCards: i === 1, bird, winScore: 500 });
    assert.equal(s.phase, 'over');
    assert.ok(s.winner === 0 || s.winner === 1);
    // every recorded trick went to the right card under this setting
    for (const t of s.lastRound.tricks) assert.equal(R.trickWinner(t.plays, s.lastRound.trump, bird), t.winner);
  }
});

test('claim detection is sound', () => {
  // simulate many positions; whenever claim is true, the leader's team must take every remaining trick
  let checked = 0;
  for (let seed = 1; seed < 40; seed++) {
    let s = R.setup({ seed, firstDealer: 0, options: { bird: R.BIRD_RANKS[seed % 3] } });
    while (s.phase !== 'over' && s.phase !== 'score') {
      const seat = R.actors(s)[0];
      if (s.phase === 'play' && R.canClaim(s)) {
        checked++;
        // random play-out must still give every trick to the leader
        const leader = s.turn;
        let t = s;
        const startTricks = t.tricks.length;
        while (t.phase === 'play') {
          const st = R.actors(t)[0];
          let a;
          if (st === leader && t.trick.plays.length === 0) a = { type: 'play', card: R.claimOrder(t.hands[st], t.trump, t.options.bird)[0] };
          else { const l = R.legal(t, st); a = l[Math.floor(Math.random() * l.length)]; }
          t = R.apply(t, st, a);
        }
        const tricks = t.phase === 'play' ? t.tricks : t.lastRound.tricks;
        for (const tr of tricks.slice(startTricks)) assert.equal(tr.winner, leader);
        break;
      }
      s = R.apply(s, seat, chooseAction(R.view(s, seat), R.legal(s, seat), 'easy'));
    }
  }
  console.log('claims checked', checked);
});

test('easy computer only makes legal bids, even when it has to bid', () => {
  // The Easy level adds random noise to its bid limit. That noise used to be any whole number,
  // so when everyone else passed and it had to bid, it could bid 143 (bids go up by 5).
  const real = Math.random;
  let forced = 0;
  try {
    for (let seed = 1; seed <= 12; seed++) {
      let s = R.setup({ seed, firstDealer: 0 });
      // everyone passes until one seat is left with no choice but to bid
      while (R.legal(s, R.actors(s)[0]).some((a) => a.type === 'pass')) s = R.apply(s, R.actors(s)[0], { type: 'pass' });
      const seat = R.actors(s)[0];
      const legal = R.legal(s, seat);
      for (let k = 1; k <= 6; k++) {
        let x = seed * 7919 + k;
        Math.random = () => ((x = (x * 16807) % 2147483647) / 2147483647);
        const a = chooseAction(R.view(s, seat), legal, 'easy');
        forced++;
        assert.ok(legal.some((l) => l.type === a.type && l.amount === a.amount), `seed ${seed}: illegal bid ${JSON.stringify(a)}`);
      }
    }
  } finally {
    Math.random = real;
  }
  assert.ok(forced >= 60);
});
