// Chinese Checkers rules engine: plain functions, no DOM. The host runs these.
//
// A move is { type: 'move', from, to } (hole numbers from board.js), or { type: 'pass' } when
// a player has no move at all. A marble either steps into a neighbouring empty hole, or makes
// one or more jumps: over a single marble (anyone's) next to it into the empty hole straight
// beyond. A marble that has reached its target point may move around inside it but not leave.
// You win when every hole of your target point is filled and at least one of them holds your
// marble (so a player can't block you by never leaving home).
import { N, NEIGHBORS, JUMPS, SEATING, camp, opposite, dist, TIP } from './board.js';

export const LIMIT = 220; // turns each before the game is called on progress (only stalled games)

export function playerCount(options) {
  const n = Number(options?.players);
  return SEATING[n] ? n : 2;
}

export function setup({ seed = 0, options = {} } = {}) {
  const n = playerCount(options);
  const pieces = [10, 6, 3].includes(Number(options.pieces)) ? Number(options.pieces) : 10;
  const homes = SEATING[n];
  const targets = homes.map(opposite);
  const board = Array(N).fill(null);
  homes.forEach((p, seat) => camp(p, pieces).forEach((c) => (board[c] = seat)));
  const first = Math.abs(seed) % n;
  return {
    n,
    pieces,
    homes,
    targets,
    board,
    turn: first,
    first,
    moves: 0,
    mode: n > 2 && options.finish === 'all' ? 'all' : 'first',
    places: [], // seats in the order they got home
    winner: null,
    over: false,
    ended: null, // 'home' or 'limit'
    last: null, // { seat, from, to, path }
    prev: Array(n).fill(null), // each seat's last move, so the computer doesn't rock back and forth
  };
}

const targetCache = new Map();
export function targetCells(s, seat) {
  const key = `${s.targets[seat]}:${s.pieces}`;
  if (!targetCache.has(key)) targetCache.set(key, new Set(camp(s.targets[seat], s.pieces)));
  return targetCache.get(key);
}

// Every hole the marble on `from` can reach this turn, each with the holes it passes through:
// Map(to → [from, …, to]). Steps and jumps can't be mixed in one move.
export function reach(board, from) {
  const out = new Map();
  for (const n of NEIGHBORS[from]) if (n != null && board[n] == null) out.set(n, [from, n]);
  const parent = new Map([[from, null]]);
  const queue = [from];
  while (queue.length) {
    const c = queue.shift();
    for (let d = 0; d < 6; d++) {
      const over = NEIGHBORS[c][d];
      const land = JUMPS[c][d];
      if (over == null || land == null || over === from || board[over] == null) continue;
      if (land !== from && board[land] != null) continue;
      if (parent.has(land)) continue;
      parent.set(land, c);
      queue.push(land);
    }
  }
  for (const [to] of parent) {
    if (to === from || out.has(to)) continue;
    const path = [];
    for (let c = to; c != null; c = parent.get(c)) path.unshift(c);
    out.set(to, path);
  }
  return out;
}

// The moves of the marble on `from` for `seat` (honouring "no leaving the target point").
export function destinations(s, seat, from) {
  if (s.board[from] !== seat) return new Map();
  const all = reach(s.board, from);
  const target = targetCells(s, seat);
  if (target.has(from)) for (const to of [...all.keys()]) if (!target.has(to)) all.delete(to);
  return all;
}

export function actors(s) {
  return s.over ? [] : [s.turn];
}

export function legal(s, seat) {
  if (!actors(s).includes(seat)) return [];
  const out = [];
  for (let c = 0; c < N; c++) {
    if (s.board[c] !== seat) continue;
    for (const to of destinations(s, seat, c).keys()) out.push({ type: 'move', from: c, to });
  }
  return out.length ? out : [{ type: 'pass' }];
}

export function check(s, seat, a) {
  if (!actors(s).includes(seat)) return 'It is not your turn';
  if (a?.type === 'pass') return legal(s, seat)[0].type === 'pass' ? null : 'You still have a move';
  if (a?.type !== 'move' || !Number.isInteger(a.from) || !Number.isInteger(a.to)) return 'Unknown move';
  if (s.board[a.from] !== seat) return 'That is not your marble';
  return destinations(s, seat, a.from).has(a.to) ? null : 'That marble can’t get there';
}

export function isHome(s, seat, board = s.board) {
  let mine = false;
  for (const c of targetCells(s, seat)) {
    if (board[c] == null) return false;
    if (board[c] === seat) mine = true;
  }
  return mine;
}

// how far a seat's marbles still have to go (0 = all home), for the scoreboard and tie-breaks
export function remaining(s, seat) {
  const tip = TIP[s.targets[seat]];
  const ideal = [...targetCells(s, seat)].reduce((t, c) => t + dist(c, tip), 0);
  let total = 0;
  for (let c = 0; c < N; c++) if (s.board[c] === seat) total += dist(c, tip);
  return Math.max(0, total - ideal);
}
export const homeCount = (s, seat) => [...targetCells(s, seat)].filter((c) => s.board[c] === seat).length;

export function apply(prev, seat, a) {
  const err = check(prev, seat, a);
  if (err) throw new Error(err);
  const s = structuredClone(prev);
  s.moves++;
  if (a.type === 'pass') s.last = { seat, pass: true };
  else {
    const path = destinations(s, seat, a.from).get(a.to);
    s.board[a.from] = null;
    s.board[a.to] = seat;
    s.last = { seat, from: a.from, to: a.to, path };
    s.prev[seat] = { from: a.from, to: a.to };
    if (isHome(s, seat)) {
      s.places.push(seat);
      if (s.winner == null) s.winner = seat;
      if (s.mode === 'first' || s.places.length >= s.n - 1) return finish(s, 'home');
    }
  }
  if (s.moves >= LIMIT * s.n) return finish(s, 'limit');
  // next seat clockwise that hasn't finished
  let next = s.turn;
  do next = (next + 1) % s.n;
  while (s.places.includes(next));
  s.turn = next;
  return s;
}

// end the game; anyone not home yet is ranked by how far they still have to go
function finish(s, why) {
  const rest = [];
  for (let seat = 0; seat < s.n; seat++) if (!s.places.includes(seat)) rest.push(seat);
  rest.sort((a, b) => remaining(s, a) - remaining(s, b));
  s.places.push(...rest);
  s.winner = s.places[0];
  s.over = true;
  s.ended = why;
  return s;
}

export const view = (s, seat) => ({ ...structuredClone(s), seat }); // nothing is hidden
export const isOver = (s) => s.over;
