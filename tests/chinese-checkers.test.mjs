import test from 'node:test';
import assert from 'node:assert/strict';
import game from '../public/games/chinese-checkers/index.js';
import * as E from '../public/games/chinese-checkers/engine.js';
import { choose } from '../public/games/chinese-checkers/ai.js';
import { CELLS, N, NEIGHBORS, SEATING, camp, cellAt, layout, TIP, opposite } from '../public/games/chinese-checkers/board.js';

// Seeded random numbers so the computer players' choices are the same on every run.
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
  const random = seeded(seed + 1);
  let s = E.setup({ seed, options });
  while (!E.isOver(s)) {
    const seat = E.actors(s)[0];
    const moves = E.legal(s, seat);
    const move = choose(E.view(s, seat), moves, levels[seat % levels.length], random);
    assert.ok(moves.some((m) => m.type === move.type && m.from === move.from && m.to === move.to), 'the computer picks a legal move');
    s = E.apply(s, seat, move);
  }
  return s;
}

const at = (x, z) => cellAt(x, z);

test('chinese checkers: the star has 121 holes and six points of 10', () => {
  assert.equal(N, 121);
  for (let p = 0; p < 6; p++) {
    assert.equal(CELLS.filter((c) => c.point === p).length, 10);
    assert.equal(camp(p, 6).length, 6);
    assert.equal(opposite(opposite(p)), p);
  }
  assert.equal(CELLS.filter((c) => c.point === -1).length, 61);
  // point 0 is at the bottom of the screen, and a turn moves it to point 1
  assert.ok(layout(TIP[0]).py > 6);
  const a = layout(TIP[0], 1), b = layout(TIP[1]);
  assert.ok(Math.abs(a.px - b.px) < 1e-9 && Math.abs(a.py - b.py) < 1e-9);
});

test('chinese checkers: setup for 2, 3, 4 and 6 players', () => {
  for (const n of [2, 3, 4, 6]) {
    const s = E.setup({ seed: 5, options: { players: n } });
    assert.equal(s.n, n);
    assert.equal(game.seatCount({ players: n }), n);
    assert.deepEqual(s.homes, SEATING[n]);
    for (let seat = 0; seat < n; seat++) {
      assert.equal(s.board.filter((v) => v === seat).length, 10);
      // nobody starts in anyone's target unless it is the opposite player's home
      for (const c of E.targetCells(s, seat)) assert.ok(s.board[c] == null || s.homes[s.board[c]] === s.targets[seat]);
    }
  }
  const quick = E.setup({ seed: 0, options: { players: 2, pieces: 6 } });
  assert.equal(quick.board.filter((v) => v === 0).length, 6);
});

test('chinese checkers: steps, single jumps and jump ladders', () => {
  const board = Array(N).fill(null);
  const from = at(0, 0);
  board[from] = 0;
  // alone in the middle: six steps, no jumps
  assert.equal(E.reach(board, from).size, 6);
  // a marble to the right: jump over it
  board[at(1, 0)] = 1;
  const r = E.reach(board, from);
  assert.deepEqual(r.get(at(2, 0)), [from, at(2, 0)]);
  assert.ok(!r.has(at(1, 0)));
  // and another beyond it, with a gap: a two-jump ladder
  board[at(3, 0)] = 1;
  assert.deepEqual(E.reach(board, from).get(at(4, 0)), [from, at(2, 0), at(4, 0)]);
  // two marbles in a row can't be jumped
  board[at(-1, 0)] = 1;
  board[at(-2, 0)] = 1;
  assert.ok(!E.reach(board, from).has(at(-3, 0)));
  assert.ok(!E.reach(board, from).has(at(-2, 0)));
});

test('chinese checkers: illegal moves are rejected', () => {
  const s = E.setup({ seed: 0, options: { players: 2 } });
  const seat = s.turn;
  const other = 1 - seat;
  const mine = s.board.findIndex((v) => v === seat);
  const theirs = s.board.findIndex((v) => v === other);
  assert.throws(() => E.apply(s, other, E.legal(s, seat)[0]));
  assert.throws(() => E.apply(s, seat, { type: 'move', from: theirs, to: at(0, 0) }));
  assert.throws(() => E.apply(s, seat, { type: 'move', from: mine, to: at(0, 0) }));
  assert.throws(() => E.apply(s, seat, { type: 'pass' }));
  assert.throws(() => E.apply(s, seat, { type: 'move', from: 'x', to: 3 }));
  // apply doesn't change the old state
  const before = JSON.stringify(s);
  E.apply(s, seat, E.legal(s, seat)[0]);
  assert.equal(JSON.stringify(s), before);
});

test('chinese checkers: a marble in its target point can’t leave it', () => {
  const s = E.setup({ seed: 0, options: { players: 2 } });
  s.board.fill(null);
  s.turn = 0;
  const target = [...E.targetCells(s, 0)];
  const edge = target.find((c) => CELLS[c].depth === 3);
  s.board[edge] = 0;
  s.board[target.find((c) => CELLS[c].depth === 0)] = 1; // so player 1 still has a marble
  for (const m of E.legal(s, 0)) assert.ok(E.targetCells(s, 0).has(m.to), 'stays inside');
});

test('chinese checkers: you win with a full target that holds at least one of yours', () => {
  const s = E.setup({ seed: 0, options: { players: 2 } });
  s.board.fill(null);
  s.turn = 0;
  const target = [...E.targetCells(s, 0)].sort((a, b) => CELLS[a].depth - CELLS[b].depth);
  // player 1 never left the tip (blocking); player 0 fills the rest but one hole
  s.board[target[0]] = 1;
  for (const c of target.slice(1, -1)) s.board[c] = 0;
  const last = target[target.length - 1];
  const outside = NEIGHBORS[last].find((c) => c != null && CELLS[c].point === -1); // next to it, in the middle
  s.board[outside] = 0;
  const next = E.apply(s, 0, { type: 'move', from: outside, to: last });
  assert.equal(next.over, true);
  assert.equal(next.winner, 0);
  assert.equal(next.ended, 'home');
  // a target filled only by someone else's marbles is not a win
  const s2 = structuredClone(s);
  for (const c of target) s2.board[c] = 1;
  assert.equal(E.isHome(s2, 0), false);
});

test('chinese checkers: a player with no moves passes', () => {
  const s = E.setup({ seed: 0, options: { players: 2 } });
  s.board.fill(null);
  s.turn = 0;
  // player 0's only marble sits at the tip of point 0, boxed in by two rows of player 1
  s.board[TIP[0]] = 0;
  for (const c of camp(0, 6)) if (c !== TIP[0]) s.board[c] = 1;
  assert.deepEqual(E.legal(s, 0), [{ type: 'pass' }]);
  const next = E.apply(s, 0, { type: 'pass' });
  assert.equal(next.turn, 1);
});

test('chinese checkers: computer games end with someone home, for every table size', () => {
  const tables = [
    [{ players: 2 }, ['normal', 'easy']],
    [{ players: 2, pieces: 6 }, ['hard', 'normal']],
    [{ players: 3 }, ['easy', 'normal', 'hard']],
    [{ players: 4 }, ['normal']],
    [{ players: 6 }, ['easy', 'normal']],
    [{ players: 4, finish: 'all' }, ['normal', 'easy']],
    [{ players: 6, finish: 'all', pieces: 6 }, ['easy']],
  ];
  for (const [options, levels] of tables)
    for (let seed = 0; seed < 3; seed++) {
      const s = play(seed, options, levels);
      assert.equal(s.ended, 'home', `${JSON.stringify(options)} seed ${seed} ended by ${s.ended}`);
      assert.equal(s.places.length, s.n);
      assert.equal(new Set(s.places).size, s.n);
      assert.ok(E.isHome(s, s.winner));
      if (s.mode === 'all') for (const seat of s.places.slice(0, -1)) assert.ok(E.isHome(s, seat));
    }
});

test('chinese checkers: stronger computers usually win', () => {
  let normal = 0, expert = 0;
  for (let seed = 0; seed < 8; seed++) {
    if (play(seed, { players: 2 }, ['normal', 'easy']).winner === 0) normal++;
    if (play(seed, { players: 2 }, ['hard', 'normal']).winner === 0) expert++;
  }
  assert.ok(normal >= 6, `normal beat easy ${normal}/8`);
  assert.ok(expert >= 6, `expert beat normal ${expert}/8`);
});
