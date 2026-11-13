import test from 'node:test';
import assert from 'node:assert/strict';
import game from '../public/games/liars-dice/index.js';

const { engine, bot } = game;

function seeded(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), t | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function play(seed, options, levels) {
  const random = seeded(seed + 99);
  let s = engine.setup({ seed, options });
  let steps = 0;
  while (!engine.isOver(s)) {
    const [seat] = engine.actors(s);
    const legal = engine.legal(s, seat);
    assert.ok(legal.length > 0, 'someone can always move');
    const move = bot.choose(engine.view(s, seat), legal, levels[seat % levels.length], random);
    assert.equal(engine.check(s, seat, move), null, `bot chose an illegal move ${JSON.stringify(move)}`);
    const before = s.counts.reduce((a, b) => a + b, 0);
    s = engine.apply(s, seat, move);
    if (move.type === 'liar' || move.type === 'spot') assert.ok(s.counts.reduce((a, b) => a + b, 0) < before, 'a call always costs a die');
    assert.ok(++steps < 5000, 'game ran too long');
  }
  return s;
}

test("liar's dice: bot games always finish with one player left", () => {
  const tables = [
    { players: 2, dice: 5, wild: true, spotOn: true },
    { players: 4, dice: 5, wild: true, spotOn: true },
    { players: 6, dice: 6, wild: false, spotOn: true },
    { players: 3, dice: 3, wild: false, spotOn: false },
    { players: 5, dice: 5, wild: true, spotOn: false },
  ];
  let games = 0;
  for (const options of tables)
    for (let seed = 1; seed <= 40; seed++) {
      const s = play(seed, options, ['easy', 'normal', 'hard']);
      assert.equal(s.phase, 'over');
      assert.equal(s.counts.filter((n) => n > 0).length, 1);
      assert.ok(s.counts[s.winner] > 0);
      assert.equal(s.out.length, options.players - 1);
      assert.deepEqual(engine.actors(s), []);
      games++;
    }
  assert.equal(games, 200);
});

test("liar's dice: expert beats easy most of the time", () => {
  let wins = 0;
  const N = 120;
  for (let seed = 1; seed <= N; seed++) if (play(seed, { players: 2, dice: 5 }, seed % 2 ? ['hard', 'easy'] : ['easy', 'hard']).winner === (seed % 2 ? 0 : 1)) wins++;
  assert.ok(wins > N * 0.6, `expert won ${wins}/${N}`);
});

test("liar's dice: views hide other players' dice until the cups are lifted", () => {
  const s = engine.setup({ seed: 7, options: { players: 4 } });
  const v = engine.view(s, 1);
  assert.deepEqual(v.dice[1], s.dice[1]);
  for (const seat of [0, 2, 3]) assert.equal(v.dice[seat], null);
  assert.equal(v.rng, undefined);
  assert.ok(engine.view(s, null).dice.every((d) => d === null), 'spectators see no dice');
  // bid, then call
  let t = engine.apply(s, s.turn, { type: 'bid', qty: 2, face: 3 });
  t = engine.apply(t, t.turn, { type: 'liar' });
  assert.equal(t.phase, 'reveal');
  assert.ok(engine.view(t, 2).dice.every((d) => Array.isArray(d)), 'everyone sees every die after a call');
});

test("liar's dice: bids must go up, ones can't be bid when wild", () => {
  const s = engine.setup({ seed: 3, options: { players: 3, wild: true } });
  const p = s.turn;
  assert.ok(engine.check(s, p, { type: 'liar' }), 'no call before the first bid');
  assert.ok(engine.check(s, p, { type: 'bid', qty: 2, face: 1 }), 'ones are wild');
  assert.ok(engine.check(s, p, { type: 'bid', qty: 16, face: 4 }), 'more dice than the table holds');
  assert.ok(engine.check(s, (p + 1) % 3, { type: 'bid', qty: 2, face: 4 }), 'out of turn');
  const t = engine.apply(s, p, { type: 'bid', qty: 3, face: 4 });
  const q = t.turn;
  assert.ok(engine.check(t, q, { type: 'bid', qty: 3, face: 4 }), 'same bid');
  assert.ok(engine.check(t, q, { type: 'bid', qty: 3, face: 2 }), 'same number, lower face');
  assert.ok(engine.check(t, q, { type: 'bid', qty: 2, face: 6 }), 'lower number');
  assert.equal(engine.check(t, q, { type: 'bid', qty: 3, face: 5 }), null);
  assert.equal(engine.check(t, q, { type: 'bid', qty: 4, face: 2 }), null);
  assert.throws(() => engine.apply(t, q, { type: 'bid', qty: 3, face: 3 }));
  assert.equal(engine.legal(t, q).filter((m) => m.type === 'bid').length, engine.legal(t, q).length - 2);
});

test("liar's dice: calls are scored right", () => {
  // build a known table by hand
  const base = engine.setup({ seed: 5, options: { players: 3, dice: 3, wild: true, spotOn: true } });
  const s = { ...structuredClone(base), dice: [[1, 4, 4], [2, 3, 4], [5, 6, 6]], turn: 0, starter: 0 };
  // four fours counting the wild one
  let t = engine.apply(s, 0, { type: 'bid', qty: 4, face: 4 });
  let r = engine.apply(t, 1, { type: 'liar' });
  assert.equal(r.reveal.actual, 4);
  assert.deepEqual(r.reveal.losers, [1], 'the bid was good, the caller loses');
  assert.equal(r.starter, 1);
  t = engine.apply(s, 0, { type: 'bid', qty: 5, face: 4 });
  r = engine.apply(t, 1, { type: 'liar' });
  assert.deepEqual(r.reveal.losers, [0], 'the bid was short, the bidder loses');
  // spot on: right, everyone else loses one
  t = engine.apply(s, 0, { type: 'bid', qty: 4, face: 4 });
  r = engine.apply(t, 1, { type: 'spot' });
  assert.deepEqual(r.reveal.losers.sort(), [0, 2]);
  assert.deepEqual(r.counts, [2, 3, 2]);
  assert.equal(r.starter, 1);
  // spot on: wrong, the caller loses one
  t = engine.apply(s, 0, { type: 'bid', qty: 3, face: 4 });
  r = engine.apply(t, 1, { type: 'spot' });
  assert.deepEqual(r.reveal.losers, [1]);
  // the next round
  const n = engine.apply(r, r.starter, { type: 'roll' });
  assert.equal(n.phase, 'bid');
  assert.equal(n.round, 2);
  assert.equal(n.bid, null);
  assert.deepEqual(n.dice.map((d) => d.length), n.counts);
});

test("liar's dice: knocked-out players are skipped", () => {
  const base = engine.setup({ seed: 9, options: { players: 3, dice: 3 } });
  const s = { ...structuredClone(base), counts: [1, 3, 3], dice: [[6], [2, 2, 3], [5, 5, 5]], turn: 2, starter: 2 };
  let t = engine.apply(s, 2, { type: 'bid', qty: 6, face: 6 }); // impossible bid
  t = engine.apply(t, 0, { type: 'liar' }); // seat 2 loses
  t = engine.apply(t, t.starter, { type: 'roll' });
  t = { ...t, dice: [[6], [2, 2, 3], [5, 5]] };
  t = engine.apply(t, 2, { type: 'bid', qty: 2, face: 6 }); // short: one six plus one wild? no ones → 1 six
  t = engine.apply(t, 0, { type: 'bid', qty: 3, face: 6 });
  t = engine.apply(t, 1, { type: 'liar' }); // seat 0 bid 3 sixes, only 1: seat 0 is out
  assert.deepEqual(t.out, [0]);
  t = engine.apply(t, t.starter, { type: 'roll' });
  assert.notEqual(t.turn, 0);
  t = engine.apply(t, t.turn, { type: 'bid', qty: 1, face: 2 });
  assert.notEqual(t.turn, 0, 'seat 0 is out and never gets a turn');
});
