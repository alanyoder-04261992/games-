import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../public/games/hexstead/engine.js';
import { chooseAction } from '../public/games/hexstead/ai.js';
import { VERTS, EDGES, HEXES } from '../public/games/hexstead/geometry.js';

// Play a full game with computer players. Returns the final state.
function play(seed, levels = ['normal', 'normal', 'normal', 'normal'], options = {}) {
  let s = E.setup({ seed, options });
  let moves = 0;
  while (!E.isOver(s)) {
    const seat = E.actors(s)[0];
    const legal = E.legal(s, seat);
    let a = chooseAction(E.view(s, seat), legal, levels[seat]);
    const err = E.check(s, seat, a);
    if (err) {
      // the room falls back to the first legal move; count it so the test can flag it
      s.botErrors = (s.botErrors || 0) + 1;
      a = legal[0];
    }
    s = E.apply(s, seat, a);
    if (++moves > 6000) throw new Error(`game ${seed} did not finish (turn ${s.turnNo})`);
  }
  s.moves = moves;
  return s;
}

test('hexstead: board is a 19-hex island with 54 corners and 72 edges', () => {
  assert.equal(HEXES.length, 19);
  assert.equal(VERTS.length, 54);
  assert.equal(EDGES.length, 72);
  const s = E.setup({ seed: 5 });
  assert.equal(s.hexes.filter((h) => h.t === 'desert').length, 1);
  assert.equal(s.hexes[s.bandit].t, 'desert');
  // no 6 or 8 next to another 6 or 8
  const hot = (i) => s.hexes[i].n === 6 || s.hexes[i].n === 8;
  for (let i = 0; i < 19; i++) if (hot(i)) for (const j of HEXES[i].near) assert.ok(!hot(j));
});

test('hexstead: computer players finish full games and someone wins', () => {
  let turns = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const s = play(seed);
    assert.ok(s.winner != null, `seed ${seed} has a winner`);
    assert.ok(E.points(s, s.winner) >= s.target);
    assert.ok(!s.botErrors, `seed ${seed}: ${s.botErrors} bot moves were rejected`);
    // resources are conserved: 19 of each between the bank and the players
    for (const r of E.RES) assert.equal(s.bank[r] + s.players.reduce((n, p) => n + p.res[r], 0), 19, `${r} conserved`);
    turns += s.turnNo;
  }
  const avg = turns / 30;
  assert.ok(avg < 130, `games average ${avg.toFixed(0)} turns`);
});

test('hexstead: easy, quick and friendly-bandit games also finish', () => {
  for (let seed = 40; seed < 50; seed++) {
    const s = play(seed, ['easy', 'hard', 'easy', 'normal'], { target: seed % 2 ? 8 : 12, friendly: seed % 3 === 0 });
    assert.ok(s.winner != null);
  }
});

test('hexstead: expert beats easy players most of the time', () => {
  let wins = 0;
  for (let seed = 100; seed < 120; seed++) if (play(seed, ['hard', 'easy', 'easy', 'easy']).winner === 0) wins++;
  assert.ok(wins >= 8, `expert won ${wins}/20`);
});

test('hexstead: the setup snake and the distance rule', () => {
  let s = E.setup({ seed: 9 });
  const first = s.current;
  assert.deepEqual(s.order, [0, 1, 2, 3, 3, 2, 1, 0].map((i) => [first, first + 1, first + 2, first + 3][i] % 4));
  const v = 20;
  s = E.apply(s, first, { type: 'homestead', v });
  assert.throws(() => E.apply(s, first, { type: 'homestead', v: 21 }), /trail/);
  // a trail must touch the new homestead
  const far = EDGES.findIndex((e) => e.a !== v && e.b !== v);
  assert.throws(() => E.apply(s, first, { type: 'road', e: far }));
  s = E.apply(s, first, { type: 'road', e: VERTS[v].edges[0] });
  // the next player cannot build next to it
  const next = s.current;
  assert.throws(() => E.apply(s, next, { type: 'homestead', v: VERTS[v].adj[0] }), /close/);
  assert.throws(() => E.apply(s, first, { type: 'homestead', v: 40 }), /turn/);
});

test('hexstead: longest trail stops at an opponent homestead', () => {
  const s = E.setup({ seed: 3 });
  // a straight run of 5 edges for seat 0
  let v = 0;
  const path = [];
  const seen = new Set([v]);
  while (path.length < 5) {
    const e = VERTS[v].edges.find((x) => !seen.has(EDGES[x].a === v ? EDGES[x].b : EDGES[x].a));
    const w = EDGES[e].a === v ? EDGES[e].b : EDGES[e].a;
    path.push(e);
    seen.add(w);
    v = w;
  }
  for (const e of path) s.roads[e] = 0;
  assert.equal(E.longestTrail(s, 0), 5);
  // seat 1 builds on a middle corner of the trail
  const mid = EDGES[path[2]].a;
  s.verts[mid] = { o: 1, k: 'homestead' };
  assert.ok(E.longestTrail(s, 0) < 5);
});

test('hexstead: views hide other hands and the deck', () => {
  let s = play(7);
  s = E.setup({ seed: 7 });
  const v = E.view(s, 1);
  assert.equal(v.rng, undefined);
  assert.equal(typeof v.deck, 'number');
  assert.equal(v.players[0].res, null);
  assert.ok(v.players[1].res);
});
