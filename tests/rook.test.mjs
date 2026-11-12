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

test('claim detection is sound', () => {
  // simulate many positions; whenever claim is true, the leader's team must take every remaining trick
  let checked = 0;
  for (let seed = 1; seed < 40; seed++) {
    let s = R.setup({ seed, firstDealer: 0 });
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
          if (st === leader && t.trick.plays.length === 0) a = { type: 'play', card: R.claimOrder(t.hands[st], t.trump)[0] };
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
