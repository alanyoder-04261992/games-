// Roofline computer players. Each one looks at every legal take and scores it: points it is
// likely to nail this round, progress on racks, what falls in the gutter, and (Expert) whether
// the rest of a rack can still be filled before the round ends, plus the end-game roof bonuses.
import { SIZE, GUTTER, BONUS, YARD, roofCol, cell, placeScore, sources } from './engine.js';

export const LEVELS = {
  easy: { label: 'Easy' },
  normal: { label: 'Normal' },
  hard: { label: 'Expert' },
};

const gutterCost = (have, add) => {
  let pts = 0;
  for (let i = have; i < have + add && i < GUTTER.length; i++) pts += GUTTER[i];
  return pts;
};

function evaluate(view, me, m, level) {
  const pl = view.players[me];
  const src = view.pallets[m.src];
  const count = m.src === YARD ? view.yard[m.color] : src.filter((x) => x === m.color).length;
  const whistle = m.src === YARD && view.whistle;
  let gut = pl.gutter.length + (whistle ? 1 : 0);
  let score = 0;
  if (whistle) score += gutterCost(pl.gutter.length, 1) + (view.n > 2 ? 0.6 : 0.4); // starting next round is worth a little

  if (m.rack < 0) return score + gutterCost(gut, count) - 0.2;

  const r = m.rack;
  const rack = pl.racks[r];
  const cap = r + 1;
  const fits = Math.min(count, cap - rack.count);
  const over = count - fits;
  score += gutterCost(gut, over);
  const filled = rack.count + fits;
  const c = roofCol(r, m.color);
  const roof = pl.roof.slice();
  roof[cell(r, c)] = 1;
  let worth = placeScore(roof, r, c) + (view.dormers.includes(cell(r, c)) ? BONUS.dormer : 0);
  if (level === 'hard') {
    // shingles toward roof bonuses are worth more the closer the row, column and color are
    const rowHave = [0, 1, 2, 3, 4].filter((x) => pl.roof[cell(r, x)]).length;
    const colHave = [0, 1, 2, 3, 4].filter((y) => pl.roof[cell(y, c)]).length;
    const colorHave = [0, 1, 2, 3, 4].filter((y) => pl.roof[cell(y, roofCol(y, m.color))]).length;
    worth += (BONUS.column * colHave) / 8 + (BONUS.color * colorHave) / 12 + (rowHave >= 3 ? 1.2 : 0.2 * rowHave);
  }
  if (filled === cap) {
    score += worth + 0.5;
  } else {
    // how many more of this color could still arrive this round?
    const left = sources(view)
      .filter((x) => x.color === m.color && !(x.src === m.src))
      .reduce((n, x) => n + x.count, 0) + (m.src !== YARD ? 0 : 0);
    const need = cap - filled;
    const likely = level === 'hard' ? (left >= need ? 0.65 : 0.15) : 0.45;
    score += worth * likely * (filled / cap) + 0.15 * fits;
    if (level !== 'easy') score -= 0.1 * (cap - filled); // leaving big racks half-built is risky
  }
  // prefer starting rows that finish fast early in the game
  score -= 0.03 * r;
  return score;
}

export function chooseAction(view, moves, level = 'normal', random = Math.random) {
  if (!moves.length) return null;
  const me = view.seat;
  if (level === 'easy' && random() < 0.3) return moves[Math.floor(random() * moves.length)];
  let best = moves[0], bestScore = -Infinity;
  for (const m of moves) {
    let v = evaluate(view, me, m, level);
    if (level === 'easy') v += random() * 2;
    else if (level === 'normal') v += random() * 0.3;
    else v += random() * 0.05;
    if (v > bestScore) [best, bestScore] = [m, v];
  }
  return best;
}
