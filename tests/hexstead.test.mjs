import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../public/games/hexstead/engine.js';
import { chooseAction } from '../public/games/hexstead/ai.js';
import { VERTS, EDGES, HEXES, board } from '../public/games/hexstead/geometry.js';

// Play a full game with computer players. Returns the final state.
function play(seed, levels = ['normal', 'normal', 'normal', 'normal'], options = {}) {
  levels = Array.from({ length: Number(options.players) || 4 }, (_, i) => levels[i % levels.length]);
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
    if (++moves > 20000) throw new Error(`game ${seed} did not finish (turn ${s.turnNo})`);
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
    for (const r of E.RES) assert.equal(s.bank[r] + s.players.reduce((n, p) => n + p.res[r], 0), E.SUPPLY[s.size].bank, `${r} conserved`);
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

test('hexstead: bigger islands for 5–8 players', () => {
  const sizes = { 3: [19, 'base'], 4: [19, 'base'], 5: [30, 'large'], 6: [30, 'large'], 7: [37, 'huge'], 8: [37, 'huge'] };
  for (const [n, [hexes, size]] of Object.entries(sizes)) {
    const s = E.setup({ seed: Number(n), options: { players: Number(n) } });
    assert.equal(s.players.length, Number(n));
    assert.equal(s.size, size);
    assert.equal(s.hexes.length, hexes);
    const g = board(size);
    assert.equal(s.verts.length, g.VERTS.length);
    assert.equal(s.harbors.length, g.HARBOR_SLOTS.length);
    // every non-desert tile has a number, and the busy numbers are never neighbours
    assert.ok(s.hexes.every((h) => (h.t === 'desert') === (h.n == null)));
    const hot = (i) => s.hexes[i].n === 6 || s.hexes[i].n === 8;
    for (let i = 0; i < s.hexes.length; i++) if (hot(i)) for (const j of g.HEXES[i].near) assert.ok(!hot(j), `${n} players: 6/8 side by side`);
    assert.equal(s.order.length, Number(n) * 2);
    assert.equal(s.raising, Number(n) >= 5);
  }
});

test('hexstead: 5–8 player games with barn raising finish', () => {
  for (const n of [5, 6, 7, 8]) {
    for (let seed = 1; seed <= 6; seed++) {
      const s = play(seed * 13 + n, ['normal', 'hard', 'easy'], { players: n, raising: seed % 3 !== 0 });
      assert.ok(s.winner != null, `${n} players seed ${seed} has a winner`);
      assert.ok(!s.botErrors, `${n} players seed ${seed}: ${s.botErrors} bot moves were rejected`);
      for (const r of E.RES) assert.equal(s.bank[r] + s.players.reduce((k, p) => k + p.res[r], 0), E.SUPPLY[s.size].bank);
    }
  }
});

test('hexstead: barn raising lets the others build in order, then the next turn starts', () => {
  let s = E.setup({ seed: 77, options: { players: 6 } });
  // finish the opening placements
  while (s.phase === 'setup') {
    const seat = E.actors(s)[0];
    s = E.apply(s, seat, E.legal(s, seat)[0]);
  }
  const cur = s.current;
  s = E.apply(s, cur, { type: 'roll' });
  while (s.phase !== 'main') {
    const seat = E.actors(s)[0];
    s = E.apply(s, seat, E.legal(s, seat)[0]);
  }
  // give two other players enough for an almanac card
  const a = (cur + 2) % 6, b = (cur + 4) % 6;
  for (const q of s.players) for (const r of E.RES) q.res[r] = 0;
  for (const q of [a, b]) Object.assign(s.players[q].res, { wool: 1, grain: 1, stone: 1 });
  s = E.apply(s, cur, { type: 'end' });
  assert.equal(s.phase, 'raise');
  assert.deepEqual(E.actors(s), [a], 'players who cannot build are skipped');
  assert.throws(() => E.apply(s, a, { type: 'bank', give: 'wool', get: 'stone' }), /roll|trade/i);
  s = E.apply(s, a, { type: 'buy' });
  assert.deepEqual(E.actors(s), [b], 'moves on once you cannot afford more');
  assert.equal(E.CARD_TYPES.reduce((k, c) => k + s.players[a].cards[c], 0), 1, 'cards bought between turns are ready next turn');
  s = E.apply(s, b, { type: 'pass' });
  assert.equal(s.phase, 'roll');
  assert.equal(s.current, (cur + 1) % 6);
});

test('hexstead: fast harvest pays each die and the total, once each; a 7 pays only the dice', () => {
  const on = { fastHarvest: true }, off = { fastHarvest: false };
  assert.deepEqual(E.harvestNumbers(on, [2, 4]), [2, 4, 6]);
  assert.deepEqual(E.harvestNumbers(on, [3, 3]), [3, 6]);
  assert.deepEqual(E.harvestNumbers(on, [3, 4]), [3, 4]);
  assert.deepEqual(E.harvestNumbers(on, [1, 6]), [6]);
  assert.deepEqual(E.harvestNumbers(off, [2, 4]), [6]);
  assert.deepEqual(E.harvestNumbers(off, [3, 4]), []);
});

test('hexstead: fast harvest pays exactly the tiles showing a die number on top of the total', () => {
  // a game just past setup, then the same roll with and without fast harvest
  let base = E.setup({ seed: 11, options: { fast: 'harvest' } });
  while (base.phase !== 'roll') {
    const seat = E.actors(base)[0];
    base = E.apply(base, seat, chooseAction(E.view(base, seat), E.legal(base, seat), 'normal'));
  }
  let checked = 0;
  for (let rng = 1; rng < 400 && checked < 25; rng++) {
    const a = structuredClone(base);
    a.rng = rng;
    const fast = E.apply(a, a.current, { type: 'roll' });
    const [d1, d2] = fast.dice;
    if (d1 + d2 === 7) continue;
    const b = structuredClone(base);
    b.rng = rng;
    b.fastHarvest = false;
    const slow = E.apply(b, b.current, { type: 'roll' });
    // what the dice's own numbers (not the total) should add, with a full bank
    const extra = fast.players.map(() => Object.fromEntries(E.RES.map((r) => [r, 0])));
    const faces = new Set([d1, d2].filter((n) => n >= 2 && n !== d1 + d2));
    base.hexes.forEach((h, i) => {
      if (!faces.has(h.n) || i === base.bandit) return;
      for (const v of HEXES[i].verts) {
        const bld = base.verts[v];
        if (bld) extra[bld.o][E.TERRAIN[h.t].res] += bld.k === 'town' ? 2 : 1;
      }
    });
    fast.players.forEach((pl, q) => {
      for (const r of E.RES) assert.equal(pl.res[r] - slow.players[q].res[r], extra[q][r], `roll ${d1}+${d2}: seat ${q} ${r}`);
    });
    checked++;
  }
  assert.ok(checked >= 20, `checked ${checked} rolls`);
});

test('hexstead: fast play games finish, and building between turns works for 3 and 4 players', () => {
  for (const fast of ['raise', 'harvest', 'both']) {
    for (let seed = 60; seed < 66; seed++) {
      const players = seed % 2 ? 3 : 4;
      const s = play(seed, ['normal', 'hard', 'easy', 'normal'], { fast, players });
      assert.ok(s.winner != null, `${fast} seed ${seed} has a winner`);
      assert.ok(!s.botErrors, `${fast} seed ${seed}: ${s.botErrors} bot moves were rejected`);
      for (const r of E.RES) assert.equal(s.bank[r] + s.players.reduce((n, p) => n + p.res[r], 0), E.SUPPLY[s.size].bank, `${r} conserved`);
      assert.equal(s.raising, fast !== 'harvest');
      assert.equal(s.fastHarvest, fast !== 'raise');
    }
  }
  // a 4-player table with "build between turns" really gets a raise phase
  let s = E.setup({ seed: 7, options: { fast: 'raise', players: 4 } });
  let raised = false;
  for (let i = 0; i < 4000 && !E.isOver(s) && !raised; i++) {
    const seat = E.actors(s)[0];
    s = E.apply(s, seat, chooseAction(E.view(s, seat), E.legal(s, seat), 'normal'));
    if (s.phase === 'raise') raised = true;
  }
  assert.ok(raised, 'someone built between turns');
});
