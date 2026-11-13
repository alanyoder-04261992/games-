// Chinese Checkers computer players. They see the whole board (nothing is hidden) and pick
// from the legal moves the host hands them.
//
// A position is judged by how far the marbles still are from the tip of their target point
// (hex distance), plus a penalty on the marble furthest behind so nobody gets left at home.
//   Easy    likes moving forward but often picks a so-so move.
//   Normal  takes the move that gains the most ground now.
//   Expert  also looks at its own best follow-up move, so it sets up jump ladders, and
//           avoids moves that hand the next player a long jump.
import { N, TIP, dist } from './board.js';
import { reach, targetCells } from './engine.js';

export const LEVELS = { easy: 'Easy', normal: 'Normal', hard: 'Expert' };
const LAG = 0.7; // how much the furthest-behind marble counts on top of the sum

function score(board, seat, tip) {
  let sum = 0, worst = 0;
  for (let c = 0; c < N; c++) {
    if (board[c] !== seat) continue;
    const d = dist(c, tip);
    sum += d;
    if (d > worst) worst = d;
  }
  return sum + LAG * worst;
}

// all moves for `seat` on a scratch board (the same rule as the engine: no leaving the target)
function movesOn(board, seat, target) {
  const out = [];
  for (let c = 0; c < N; c++) {
    if (board[c] !== seat) continue;
    const inside = target.has(c);
    for (const to of reach(board, c).keys()) if (!inside || target.has(to)) out.push([c, to]);
  }
  return out;
}

function bestGain(board, seat, tip, target) {
  const base = score(board, seat, tip);
  let best = -Infinity;
  for (const [from, to] of movesOn(board, seat, target)) {
    board[from] = null;
    board[to] = seat;
    const g = base - score(board, seat, tip);
    board[to] = null;
    board[from] = seat;
    if (g > best) best = g;
  }
  return best === -Infinity ? 0 : best;
}

export function choose(view, moves, level = 'normal', random = Math.random) {
  if (!moves.length || moves[0].type === 'pass') return moves[0];
  const seat = view.seat;
  const board = view.board.slice();
  const tip = TIP[view.targets[seat]];
  const target = targetCells(view, seat);
  const before = score(board, seat, tip);
  const prev = view.prev?.[seat];
  // the next player still in the game, for the Expert's "don't build them a ladder" check
  let next = seat;
  if (level === 'hard' && view.n > 1) {
    do next = (next + 1) % view.n;
    while (next !== seat && view.places?.includes(next));
  }
  const nextTip = next !== seat ? TIP[view.targets[next]] : null;
  const nextTarget = next !== seat ? targetCells(view, next) : null;
  const nextBase = nextTip != null ? bestGain(board, next, nextTip, nextTarget) : 0;

  let best = moves[0], bestScore = -Infinity;
  const scored = [];
  for (const m of moves) {
    board[m.from] = null;
    board[m.to] = seat;
    let v = before - score(board, seat, tip);
    if (target.has(m.to) && !target.has(m.from)) v += 0.3; // getting a marble home is worth a little extra
    if (prev && prev.from === m.to && prev.to === m.from) v -= 2; // don't rock back and forth
    if (level === 'hard') {
      v += 0.85 * bestGain(board, seat, tip, target);
      if (nextTip != null) v -= 0.25 * Math.max(0, bestGain(board, next, nextTip, nextTarget) - nextBase);
    }
    board[m.to] = null;
    board[m.from] = seat;
    v += random() * 0.05; // break ties differently each game
    scored.push([m, v]);
    if (v > bestScore) [best, bestScore] = [m, v];
  }
  if (level === 'easy') {
    if (random() < 0.3) {
      const forward = scored.filter(([, v]) => v > 0.5);
      const pool = forward.length ? forward : scored;
      return pool[Math.floor(random() * pool.length)][0];
    }
    let pick = best, top = -Infinity;
    for (const [m, v] of scored) {
      const noisy = v + random() * 2.5;
      if (noisy > top) [pick, top] = [m, noisy];
    }
    return pick;
  }
  return best;
}
