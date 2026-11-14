// Four in a Row — a small, complete example of a Game Center game.
// Read this file alongside docs/ADDING_A_GAME.md: it shows every piece a game needs.
import { FOUR_TILE as TILE } from './tile.js';
const COLS = 7;
const ROWS = 6;

// ---------------------------------------------------------------------
// 1. Rules engine: plain functions, no DOM. The host runs these.
// ---------------------------------------------------------------------
function setup({ seed }) {
  return { board: Array(COLS * ROWS).fill(null), turn: seed % 2, winner: null, line: null, moves: 0, last: null, first: seed % 2 };
}
const at = (s, c, r) => s.board[r * COLS + c];
function actors(s) {
  return s.winner == null && s.moves < COLS * ROWS ? [s.turn] : [];
}
function legal(s, seat) {
  if (!actors(s).includes(seat)) return [];
  const out = [];
  for (let c = 0; c < COLS; c++) if (at(s, c, 0) == null) out.push({ type: 'drop', col: c });
  return out;
}
function check(s, seat, a) {
  return legal(s, seat).some((x) => x.col === a?.col) ? null : 'That column is full or it is not your turn';
}
function apply(prev, seat, a) {
  const err = check(prev, seat, a);
  if (err) throw new Error(err);
  const s = structuredClone(prev);
  let row = ROWS - 1;
  while (at(s, a.col, row) != null) row--;
  s.board[row * COLS + a.col] = seat;
  s.moves++;
  s.last = { col: a.col, row };
  const line = findLine(s.board, a.col, row, seat);
  if (line) {
    s.winner = seat;
    s.line = line;
  } else s.turn = 1 - seat;
  return s;
}
function findLine(board, c, r, who) {
  for (const [dc, dr] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
    const cells = [[c, r]];
    for (const sgn of [1, -1]) {
      let x = c + dc * sgn, y = r + dr * sgn;
      while (x >= 0 && x < COLS && y >= 0 && y < ROWS && board[y * COLS + x] === who) {
        cells.push([x, y]);
        x += dc * sgn;
        y += dr * sgn;
      }
    }
    if (cells.length >= 4) return cells;
  }
  return null;
}
const engine = {
  setup,
  actors,
  legal,
  check,
  apply,
  view: (s, seat) => ({ ...structuredClone(s), seat }), // nothing is hidden in this game
  isOver: (s) => actors(s).length === 0,
};

// ---------------------------------------------------------------------
// 2. Computer player: gets one seat's view and the legal moves, returns a move.
// ---------------------------------------------------------------------
const DEPTH = { easy: 1, normal: 4, hard: 7 };
// `random` can be replaced with a seeded generator (the tests do this so they are repeatable).
function choose(view, moves, level = 'normal', random = Math.random) {
  const me = view.seat;
  const depth = DEPTH[level] ?? 4;
  const board = view.board.slice();
  if (level === 'easy' && random() < 0.35) return moves[Math.floor(random() * moves.length)];
  let best = moves[0], bestScore = -Infinity;
  const order = [...moves].sort((a, b) => Math.abs(3 - a.col) - Math.abs(3 - b.col));
  for (const m of order) {
    const row = drop(board, m.col, me);
    const score = findLine(board, m.col, row, me) ? 1e6 : -negamax(board, 1 - me, depth - 1, -Infinity, Infinity);
    board[row * COLS + m.col] = null;
    if (score > bestScore) [best, bestScore] = [m, score];
  }
  return best;
}
function drop(board, col, who) {
  let r = ROWS - 1;
  while (board[r * COLS + col] != null) r--;
  board[r * COLS + col] = who;
  return r;
}
function negamax(board, who, depth, alpha, beta) {
  if (depth <= 0) return evaluate(board, who);
  let any = false;
  for (const c of [3, 2, 4, 1, 5, 0, 6]) {
    if (board[c] != null) continue;
    any = true;
    const r = drop(board, c, who);
    const score = findLine(board, c, r, who) ? 1e5 + depth : -negamax(board, 1 - who, depth - 1, -beta, -alpha);
    board[r * COLS + c] = null;
    if (score > alpha) alpha = score;
    if (alpha >= beta) break;
  }
  return any ? alpha : 0;
}
function evaluate(board, who) {
  let score = 0;
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      const v = board[r * COLS + c];
      if (v == null) continue;
      const w = 4 - Math.abs(3 - c);
      score += v === who ? w : -w;
    }
  return score;
}

// ---------------------------------------------------------------------
// 3. Tile art and manifest
// ---------------------------------------------------------------------

export default {
  id: 'four-in-a-row',
  version: '2.2', // shown on the home tile; bump it whenever you improve the game
  sameDevice: 'open', // pass and play: several people on one device (everything is on the table)
  name: 'Four in a Row',
  tagline: 'Drop discs, line up four. Quick games for two.',
  description: 'Take turns dropping discs into the grid. First to line up four across, down or diagonally wins. Play a friend online or test the computer.',
  seats: 2,
  seatLabels: ['Red', 'Gold'],
  players: '1–2 players',
  tile: TILE,
  accent: '#5b8cff',
  options: [],
  botLevels: { easy: 'Easy', normal: 'Normal', hard: 'Expert' },
  engine,
  bot: { choose },
  pace: () => 650,
  styles: [new URL('./four.css', import.meta.url).href],
  ui: () => import('./ui.js'),
  COLS,
  ROWS,
};
