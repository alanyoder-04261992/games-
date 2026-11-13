import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../public/games/pinochle/engine.js';
import { chooseAction } from '../public/games/pinochle/ai.js';
import game from '../public/games/pinochle/index.js';

// a small seeded random so bot games repeat exactly
function rng(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), t | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function playGame(seed, levels, options = {}) {
  let s = P.setup({ seed, options, firstDealer: seed % 4 });
  const random = rng(seed);
  let steps = 0;
  while (s.phase !== 'over' && steps < 30000) {
    const actors = P.actors(s);
    assert.ok(actors.length, `nobody can act in phase ${s.phase}`);
    const seat = actors[0];
    const legal = P.legal(s, seat);
    assert.ok(legal.length, `no legal moves for seat ${seat} in ${s.phase}`);
    const a = chooseAction(P.view(s, seat), legal, levels[seat], random);
    assert.equal(P.check(s, seat, a), null, `bot chose an illegal move ${JSON.stringify(a)} in ${s.phase}`);
    const before = JSON.stringify(s);
    s = P.apply(s, seat, a);
    assert.equal(JSON.stringify(P.apply(JSON.parse(before), seat, a)), JSON.stringify(s), 'apply is deterministic');
    steps++;
    // every card is always somewhere
    if (s.phase === 'play') {
      const held = s.hands.flat().length + s.trick.plays.length + s.tricks.length * 4;
      assert.equal(held, 48);
    }
  }
  return { s, steps };
}

const uniq = (faces) => {
  // give repeated faces copy numbers 0 and 1
  const seen = {};
  return faces.split(' ').map((f) => {
    const face = f.replace('10', 'T');
    seen[face] = (seen[face] || 0) + 1;
    return face + (seen[face] - 1);
  });
};

test('deck: 48 cards, 240 in counters plus 10 for the last trick', () => {
  const deck = P.fullDeck();
  assert.equal(deck.length, 48);
  assert.equal(new Set(deck).size, 48);
  assert.equal(P.sumPoints(deck) + P.LAST_TRICK_BONUS, 250);
});

test('trick winner: ten beats king, trump wins, first of two identical cards wins', () => {
  assert.equal(P.trickWinner([{ seat: 0, card: 'KH0' }, { seat: 1, card: 'TH0' }, { seat: 2, card: 'AS0' }, { seat: 3, card: '9H0' }], 'C'), 1);
  assert.equal(P.trickWinner([{ seat: 0, card: 'AH0' }, { seat: 1, card: '9C0' }, { seat: 2, card: 'AH1' }, { seat: 3, card: 'TH0' }], 'C'), 1);
  assert.equal(P.trickWinner([{ seat: 0, card: 'AH0' }, { seat: 1, card: 'AH1' }, { seat: 2, card: 'KH0' }, { seat: 3, card: 'TH0' }], 'S'), 0);
});

test('meld counting', () => {
  // run in hearts + pinochle + aces around + dix
  const m = P.meldOf(uniq('AH 10H KH QH JH 9H QS JD AS AC AD 9C'), 'H');
  const names = m.items.map((i) => i.name).sort();
  assert.deepEqual(names, ['Aces around', 'Dix', 'Pinochle', 'Run'].sort());
  assert.equal(m.total, 150 + 40 + 100 + 10);
  // run plus an extra royal marriage
  assert.equal(P.meldOf(uniq('AH 10H KH QH JH KH QH 9S 9S 9C 9C 9D'), 'H').total, 150 + 40);
  // the same cards with spades trump: two heart marriages and two dix
  assert.equal(P.meldOf(uniq('AH 10H KH QH JH KH QH 9S 9S 9C 9C 9D'), 'S').total, 20 * 2 + 10 * 2);
  // double pinochle and double jacks around
  assert.equal(P.meldOf(uniq('QS QS JD JD JS JS JH JH JC JC 9H 9H'), 'C').total, 300 + 400);
  // kings and queens around also make marriages; one Q♠ joins the pinochle
  const kq = P.meldOf(uniq('KS KH KC KD QS QH QC QD JD 9S 9H 9C'), 'D');
  assert.equal(kq.total, 80 + 60 + 40 + 20 * 3 + 40 + 0);
  // double run
  assert.equal(P.meldOf(uniq('AS AS 10S 10S KS KS QS QS JS JS 9H 9H'), 'S').total, 1500);
});

test('play rules: follow suit, trump when void, head the trick', () => {
  const plays = [{ seat: 0, card: 'KH0' }];
  // must beat the King with the 10 or Ace of hearts
  assert.deepEqual(P.legalPlaysFor(['9H0', 'TH0', 'AS0'], plays, 'S').sort(), ['TH0']);
  // can't beat: any heart
  assert.deepEqual(P.legalPlaysFor(['9H0', 'JH0', 'AS0'], plays, 'S').sort(), ['9H0', 'JH0']);
  // void in hearts: must trump
  assert.deepEqual(P.legalPlaysFor(['9S0', 'AC0'], plays, 'S'), ['9S0']);
  // trick already trumped: following suit need not head it
  const trumped = [{ seat: 0, card: 'KH0' }, { seat: 1, card: '9S0' }];
  assert.deepEqual(P.legalPlaysFor(['9H0', 'AH0'], trumped, 'S').sort(), ['9H0', 'AH0']);
  // void too: must over-trump if able
  assert.deepEqual(P.legalPlaysFor(['JS0', '9S1', 'AC0'], trumped, 'S'), ['JS0']);
  // neither suit nor trump: anything
  assert.deepEqual(P.legalPlaysFor(['AC0', '9D0'], trumped, 'S').sort(), ['9D0', 'AC0']);
});

test('dealer is stuck when everyone passes', () => {
  let s = P.setup({ seed: 7, firstDealer: 0, options: { pass: 0 } });
  for (const seat of [1, 2, 3]) s = P.apply(s, seat, { type: 'pass' });
  assert.equal(s.turn, 0);
  assert.ok(!P.legal(s, 0).some((a) => a.type === 'pass'));
  assert.throws(() => P.apply(s, 0, { type: 'pass' }));
  s = P.apply(s, 0, { type: 'bid', amount: 250 });
  assert.equal(s.phase, 'trump');
  s = P.apply(s, 0, { type: 'trump', suit: 'H' });
  assert.equal(s.phase, 'meld');
  assert.equal(s.melds.length, 4);
});

test('passing cards between partners', () => {
  let s = P.setup({ seed: 11, firstDealer: 3, options: { pass: 4 } });
  s = P.apply(s, 0, { type: 'bid', amount: 250 });
  for (const seat of [1, 2, 3]) s = P.apply(s, seat, { type: 'pass' });
  assert.equal(s.contract.bidder, 0);
  s = P.apply(s, 0, { type: 'trump', suit: 'D' });
  assert.equal(s.phase, 'passIn');
  assert.equal(s.turn, 2);
  assert.ok(P.check(s, 2, { type: 'pass-cards', cards: s.hands[2].slice(0, 3) }));
  const give = s.hands[2].slice(0, 4);
  s = P.apply(s, 2, { type: 'pass-cards', cards: give });
  assert.equal(s.hands[0].length, 16);
  assert.equal(s.phase, 'passBack');
  // only the bidder sees what was passed
  assert.deepEqual(P.view(s, 0).passedToMe.sort(), [...give].sort());
  assert.deepEqual(P.view(s, 1).passedToMe, []);
  assert.deepEqual(P.redact({ type: 'pass-cards', cards: give }, 2, 1), { type: 'pass-cards', count: 4 });
  s = P.apply(s, 0, { type: 'pass-cards', cards: s.hands[0].slice(-4) });
  assert.equal(s.phase, 'meld');
  assert.ok(s.hands.every((h) => h.length === 12));
});

test('throwing in: bidders lose the bid, opponents score only meld', () => {
  let s = P.setup({ seed: 3, firstDealer: 0, options: { pass: 0 } });
  s = P.apply(s, 1, { type: 'bid', amount: 400 });
  for (const seat of [2, 3, 0]) s = P.apply(s, seat, { type: 'pass' });
  s = P.apply(s, 1, { type: 'trump', suit: 'S' });
  assert.ok(P.legal(s, 1).some((a) => a.type === 'throw-in'));
  assert.ok(!P.legal(s, 0).some((a) => a.type === 'throw-in'));
  const theirMeld = s.melds[0].total + s.melds[2].total;
  s = P.apply(s, 1, { type: 'throw-in' });
  assert.equal(s.phase, 'score');
  assert.deepEqual(s.scores, [theirMeld, -400]);
});

test('views hide other hands and the deck', () => {
  const s = P.setup({ seed: 5 });
  const v = P.view(s, 1);
  assert.equal(v.hand.length, 12);
  assert.ok(!('hands' in v) && !('rng' in v) && !('dealt' in v));
  const json = JSON.stringify(v);
  for (const c of s.hands[2]) if (!v.hand.includes(c)) assert.ok(!json.includes(`"${c}"`), `view leaks ${c}`);
});

test('game end: first to the target wins, bidders win a tie past it', () => {
  assert.equal(P.gameWinner([1400, 1200], 1500, 0), null);
  assert.equal(P.gameWinner([1510, 1200], 1500, 1), 0);
  assert.equal(P.gameWinner([1510, 1600], 1500, 0), 0);
  assert.equal(P.gameWinner([1510, 1600], 1500, 1), 1);
});

test('full bot games finish with legal play (every passing rule and level)', () => {
  const cases = [
    [101, ['normal', 'easy', 'normal', 'easy'], { pass: 4 }],
    [102, ['hard', 'normal', 'hard', 'normal'], { pass: 3, minBid: 200 }],
    [103, ['easy', 'hard', 'easy', 'hard'], { pass: 0, winScore: 1000 }],
    [104, ['hard', 'hard', 'hard', 'hard'], { pass: 4, minBid: 300 }],
  ];
  for (const [seed, levels, options] of cases) {
    const { s } = playGame(seed, levels, options);
    assert.equal(s.phase, 'over');
    assert.ok(s.winner === 0 || s.winner === 1);
    assert.ok(s.scores[s.winner] >= s.options.winScore);
    // the recorded tricks went to the right cards and counters add up to 250
    const r = s.lastRound;
    if (!r.thrownIn) {
      for (const t of r.tricks) assert.equal(P.trickWinner(t.plays, r.trump), t.winner);
      assert.equal(r.counters[0] + r.counters[1], 250);
    }
    const made = s.history.filter((x) => x.made).length;
    console.log(`seed ${seed} hands=${s.round} scores=${s.scores} made=${made}/${s.history.length}`);
  }
});

test('manifest matches the engine', () => {
  assert.equal(game.id, 'pinochle');
  assert.equal(game.seats, 4);
  const s = game.engine.setup({ seed: 9, options: { pass: 4, minBid: 250, winScore: 1500 } });
  assert.equal(game.engine.isOver(s), false);
  assert.ok(game.pace(s, null, null) > 0);
  for (const o of game.options) assert.ok(o.choices.some((c) => c.value === o.default));
});
