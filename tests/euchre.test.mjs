import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../public/games/euchre/engine.js';
import { chooseAction, heuristicPlay } from '../public/games/euchre/ai.js';
import game from '../public/games/euchre/index.js';

function playGame(seed, levels, options = {}) {
  let s = E.setup({ seed, options, firstDealer: seed % 4 });
  let steps = 0;
  const timing = { play: [0, 0] };
  while (s.phase !== 'over' && steps < 20000) {
    const seat = E.actors(s)[0];
    const legal = E.legal(s, seat);
    const t0 = performance.now();
    const a = chooseAction(E.view(s, seat), legal, levels[seat]);
    if (s.phase === 'play') (timing.play[0] += performance.now() - t0), timing.play[1]++;
    s = E.apply(s, seat, a);
    steps++;
  }
  return { s, steps, timing };
}

test('24-card deck, five each, four in the kitty', () => {
  assert.equal(E.fullDeck().length, 24);
  const s = E.setup({ seed: 1, firstDealer: 0 });
  assert.deepEqual(s.hands.map((h) => h.length), [5, 5, 5, 5]);
  assert.equal(s.kitty.length + 1, 4);
  assert.equal(new Set([...s.hands.flat(), ...s.kitty, s.upcard]).size, 24);
  assert.equal(s.turn, 1);
  assert.equal(s.phase, 'order');
});

test('bowers: right, then left, then the ace', () => {
  assert.ok(E.strength('JH', 'H') > E.strength('JD', 'H'));
  assert.ok(E.strength('JD', 'H') > E.strength('AH', 'H'));
  assert.equal(E.suitOf('JD', 'H'), 'H');
  assert.equal(E.suitOf('JD', 'S'), 'D');
  assert.ok(E.isTrump('JC', 'S'));
  // the left bower wins a trick led in trump and trumps a side suit
  assert.equal(E.trickWinner([{ seat: 0, card: 'AH' }, { seat: 1, card: 'JD' }, { seat: 2, card: 'KH' }], 'H'), 1);
  assert.equal(E.trickWinner([{ seat: 0, card: 'AD' }, { seat: 1, card: 'JD' }], 'H'), 1);
  // off-suit doesn't win; led suit does
  assert.equal(E.trickWinner([{ seat: 0, card: '9C' }, { seat: 1, card: 'AD' }, { seat: 2, card: 'TC' }], 'H'), 2);
});

test('follow suit counts the left bower as trump, not its own suit', () => {
  const trick = { leader: 0, plays: [{ seat: 0, card: 'AD' }] };
  // trump hearts: the jack of diamonds is a heart, so it can't follow diamonds
  assert.deepEqual(E.legalPlays(['JD', 'KC', '9H'], trick, 'H').sort(), ['9H', 'JD', 'KC'].sort());
  assert.deepEqual(E.legalPlays(['JD', 'KD', '9H'], trick, 'H'), ['KD']);
  const trumpLed = { leader: 0, plays: [{ seat: 0, card: 'AH' }] };
  assert.deepEqual(E.legalPlays(['JD', 'KC'], trumpLed, 'H'), ['JD']);
});

test('ordering up gives the dealer the up-card and a discard', () => {
  let s = E.setup({ seed: 4, firstDealer: 0 });
  const up = s.upcard;
  s = E.apply(s, 1, { type: 'pass' });
  s = E.apply(s, 2, { type: 'order', alone: false });
  assert.equal(s.trump, up[1]);
  assert.equal(s.maker, 2);
  assert.equal(s.phase, 'discard');
  assert.equal(s.turn, 0);
  assert.equal(s.hands[0].length, 6);
  assert.ok(s.hands[0].includes(up));
  // other players don't see the discard
  s = E.apply(s, 0, { type: 'discard', card: s.hands[0][0] });
  assert.equal(s.phase, 'play');
  assert.equal(s.turn, 1);
  assert.equal(E.view(s, 1).myDiscard, null);
  assert.ok(E.view(s, 0).myDiscard);
  assert.deepEqual(E.redact({ type: 'discard', card: 'AS' }, 0, 1), { type: 'discard' });
});

test('round two cannot name the turned-down suit; all pass means a new deal', () => {
  let s = E.setup({ seed: 9, firstDealer: 3 });
  for (const seat of [0, 1, 2, 3]) s = E.apply(s, seat, { type: 'pass' });
  assert.equal(s.phase, 'call');
  assert.equal(s.turnedDown, s.upcard);
  const banned = s.upcard[1];
  assert.ok(!E.legal(s, 0).some((a) => a.suit === banned));
  assert.throws(() => E.apply(s, 0, { type: 'call', suit: banned, alone: false }));
  const round = s.round;
  for (const seat of [0, 1, 2, 3]) s = E.apply(s, seat, { type: 'pass' });
  assert.equal(s.round, round + 1);
  assert.equal(s.dealer, 0);
  assert.equal(s.phase, 'order');
  assert.equal(s.passedOut, 1);
});

test('stick the dealer: the dealer cannot pass in round two', () => {
  let s = E.setup({ seed: 9, firstDealer: 3, options: { stickDealer: true } });
  for (const seat of [0, 1, 2, 3]) s = E.apply(s, seat, { type: 'pass' });
  for (const seat of [0, 1, 2]) s = E.apply(s, seat, { type: 'pass' });
  assert.equal(s.turn, 3);
  assert.ok(!E.legal(s, 3).some((a) => a.type === 'pass'));
  assert.throws(() => E.apply(s, 3, { type: 'pass' }));
  const suit = E.legal(s, 3)[0].suit;
  s = E.apply(s, 3, { type: 'call', suit, alone: false });
  assert.equal(s.phase, 'play');
});

test('going alone: partner sits out and tricks have three cards', () => {
  let s = E.setup({ seed: 12, firstDealer: 0 });
  s = E.apply(s, 1, { type: 'order', alone: true });
  assert.equal(s.sittingOut, 3);
  s = E.apply(s, 0, { type: 'discard', card: s.hands[0][0] });
  assert.equal(s.hands[3].length, 0);
  assert.equal(s.turn, 1);
  while (s.phase === 'play') {
    const seat = s.turn;
    assert.notEqual(seat, 3);
    s = E.apply(s, seat, E.legal(s, seat)[0]);
  }
  for (const t of s.lastRound.tricks) assert.equal(t.plays.length, 3);
});

test("dealer's partner alone: the dealer sits out and doesn't pick up", () => {
  let s = E.setup({ seed: 13, firstDealer: 0 });
  s = E.apply(s, 1, { type: 'pass' });
  s = E.apply(s, 2, { type: 'order', alone: true });
  assert.equal(s.sittingOut, 0);
  assert.equal(s.pickedUp, false);
  assert.equal(s.phase, 'play');
  assert.equal(s.turn, 1);
  assert.equal(s.turnedDown, s.upcard);
});

test('scoring', () => {
  assert.deepEqual(E.scoreHand([3, 2], 0, false), { change: [1, 0], result: 'made' });
  assert.deepEqual(E.scoreHand([4, 1], 2, true), { change: [1, 0], result: 'made' });
  assert.deepEqual(E.scoreHand([5, 0], 0, false), { change: [2, 0], result: 'march' });
  assert.deepEqual(E.scoreHand([0, 5], 1, true), { change: [0, 4], result: 'alone-march' });
  assert.deepEqual(E.scoreHand([2, 3], 0, false), { change: [0, 2], result: 'euchre' });
  assert.deepEqual(E.scoreHand([2, 3], 0, true), { change: [0, 2], result: 'euchre' });
});

test('views hide other hands and the kitty', () => {
  const s = E.setup({ seed: 3 });
  const v = E.view(s, 1);
  assert.equal(v.hand.length, 5);
  const text = JSON.stringify(v);
  for (const c of [...s.hands[0], ...s.hands[2], ...s.hands[3], ...s.kitty]) assert.ok(!text.includes(`"${c}"`), `${c} leaked`);
  assert.ok(!('hands' in v) && !('kitty' in v) && !('rng' in v));
  assert.equal(E.view(s, null).hand.length, 0);
});

test('the normal player never revokes and finds the obvious win', () => {
  // last to play, opponent winning: take it with the cheapest winner
  const v = {
    seat: 3, hand: ['AS', 'KS', '9D'], trump: 'H', maker: 0, sittingOut: null, dealer: 0,
    trick: { leader: 0, plays: [{ seat: 0, card: 'QS' }, { seat: 1, card: 'TS' }, { seat: 2, card: '9S' }] }, tricks: [],
  };
  assert.equal(heuristicPlay(v), 'KS');
  // partner already winning, last to play: throw the cheapest card
  const w = { ...v, trick: { leader: 0, plays: [{ seat: 0, card: 'QS' }, { seat: 1, card: 'AH' }, { seat: 2, card: '9S' }] } };
  assert.equal(heuristicPlay({ ...w, seat: 3, hand: ['KS', 'TS'] }), 'TS');
});

for (const [name, levels] of [
  ['normal vs easy', ['normal', 'easy', 'normal', 'easy']],
  ['expert vs normal', ['hard', 'normal', 'hard', 'normal']],
]) {
  test(`full bot games finish with legal play (${name})`, () => {
    for (let i = 0; i < 3; i++) {
      const { s, timing } = playGame(100 + i, levels, i === 1 ? { stickDealer: true } : i === 2 ? { allowAlone: false, winScore: 5 } : {});
      assert.equal(s.phase, 'over');
      assert.ok(s.winner === 0 || s.winner === 1);
      assert.ok(s.scores[s.winner] >= s.options.winScore);
      for (const r of s.history) assert.equal(r.taken[0] + r.taken[1], 5);
      const ms = timing.play[1] ? (timing.play[0] / timing.play[1]).toFixed(2) : '-';
      console.log(`${name} game ${i}: hands=${s.history.length} deals=${s.round} scores=${s.scores} ms/play=${ms}`);
    }
  });
}

test('stronger computers win more often', () => {
  const tally = (levels, n) => {
    let wins = 0;
    for (let seed = 0; seed < n; seed++) if (playGame(500 + seed, levels).s.winner === 0) wins++;
    return wins;
  };
  const normal = tally(['normal', 'easy', 'normal', 'easy'], 30);
  console.log(`normal beat easy ${normal}/30`);
  assert.ok(normal >= 20, `normal won ${normal}/30`);
  // Expert games are slower (each card is tried on many deals), so play fewer
  const expert = tally(['hard', 'normal', 'hard', 'normal'], 16);
  console.log(`expert beat normal ${expert}/16`);
  assert.ok(expert >= 9, `expert won ${expert}/16`);
});

test('manifest engine wiring and pacing', () => {
  const s = game.engine.setup({ seed: 5, options: {} });
  assert.equal(game.engine.actors(s).length, 1);
  assert.equal(game.seats, 4);
  assert.ok(game.pace(s, null, null) > 0);
  assert.match(game.version, /^\d+\.\d+$/);
});
