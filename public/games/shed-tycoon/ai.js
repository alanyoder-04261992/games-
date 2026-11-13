// Shed Tycoon computer players. They value every order they could chase (points, how much the
// discount helps their other plans and the sales lots), pick the best few targets by value
// per material still missing, then build, take the materials that close the gap fastest, or
// hold an order that's nearly in reach.
import { CARDS, LOTS, CASH, TOKEN_LIMIT, RESERVE_LIMIT, DECK, bonuses, points, payment, tokenCount } from './engine.js';

export const LEVELS = {
  easy: { label: 'Easy' },
  normal: { label: 'Normal' },
  hard: { label: 'Expert' },
};

// materials still missing for a card after discounts, tokens and cash
function gap(pl, b, id, extra = null) {
  const c = CARDS[id];
  let short = 0;
  for (let m = 0; m < 5; m++) short += Math.max(0, c.cost[m] - b[m] - pl.tokens[m] - (extra ? extra[m] : 0));
  return Math.max(0, short - pl.tokens[CASH] - (extra ? extra[CASH] : 0));
}

function cardValue(view, me, id, level) {
  const pl = view.players[me];
  const c = CARDS[id];
  const b = bonuses(pl);
  const mine = points(pl);
  const late = mine >= view.target - 5;
  let v = c.points * (late ? 1.6 : 1.1);
  // a discount is worth more early, and more if it's a material the open orders want
  const want = view.board.flat().filter((x) => x != null).reduce((n, x) => n + Math.max(0, CARDS[x].cost[c.bonus] - b[c.bonus]), 0);
  v += (late ? 0.25 : 0.7) + Math.min(1.4, want / 14);
  if (level !== 'easy') {
    for (const lid of view.lots) {
      const need = LOTS[lid].need;
      if (need[c.bonus] > b[c.bonus]) {
        const missing = need.reduce((n, k, m) => n + Math.max(0, k - b[m]), 0);
        v += 3 / Math.max(1, missing) * (level === 'hard' ? 0.9 : 0.5);
      }
    }
  }
  if (mine + c.points >= view.target) v += 6; // this build wins (or sets up) the game
  return v;
}

function targets(view, me, level) {
  const pl = view.players[me];
  const b = bonuses(pl);
  const ids = [...view.board.flat().filter((x) => x != null), ...pl.reserved.map((r) => r.id).filter((x) => x != null)];
  return ids
    .map((id) => {
      const g = gap(pl, b, id);
      const total = CARDS[id].cost.reduce((n, k, m) => n + Math.max(0, k - b[m]), 0);
      const value = cardValue(view, me, id, level);
      const turns = Math.ceil(g / 2.6) + 1;
      return { id, g, total, value, score: value / (turns + total * 0.05) };
    })
    .sort((a, b2) => b2.score - a.score);
}

export function chooseAction(view, moves, level = 'normal', random = Math.random) {
  if (!moves.length) return null;
  if (moves.length === 1) return moves[0];
  const me = view.seat;
  const pl = view.players[me];
  const b = bonuses(pl);

  if (view.phase === 'discard') {
    // drop what our targets need least
    const top = targets(view, me, level).slice(0, 3);
    const need = [0, 0, 0, 0, 0, 0];
    for (const t of top) CARDS[t.id].cost.forEach((k, m) => (need[m] += Math.max(0, k - b[m])));
    need[CASH] = 99;
    let best = moves[0], low = Infinity;
    for (const m of moves) {
      const surplus = pl.tokens[m.mat] - need[m.mat];
      const v = -surplus + random() * 0.1;
      if (v < low) [best, low] = [m, v];
    }
    return best;
  }

  if (level === 'easy' && random() < 0.35) {
    const builds = moves.filter((m) => m.type === 'build');
    if (builds.length && random() < 0.7) return builds[Math.floor(random() * builds.length)];
    const takes = moves.filter((m) => m.type === 'take');
    return (takes.length ? takes : moves)[Math.floor(random() * (takes.length || moves.length))];
  }

  const ranked = targets(view, me, level);
  const idOf = (m) => (m.hand != null ? pl.reserved[m.hand].id : view.board[m.tier][m.slot]);

  // 1. build the most valuable affordable order, if it's worth a turn
  const builds = moves.filter((m) => m.type === 'build');
  if (builds.length) {
    let best = null, bv = -Infinity;
    for (const m of builds) {
      const v = cardValue(view, me, idOf(m), level) + random() * 0.2;
      if (v > bv) [best, bv] = [m, v];
    }
    const topValue = ranked[0]?.value ?? 0;
    if (bv >= topValue * 0.55 || level === 'easy' || bv >= 2) return best;
  }

  // 2. take the materials that close the gap to the best targets
  const focus = ranked.slice(0, level === 'hard' ? 3 : 2);
  const weights = level === 'hard' ? [1, 0.45, 0.25] : [1, 0.35];
  const takes = moves.filter((m) => m.type === 'take');
  let bestTake = null, bt = -Infinity;
  for (const m of takes) {
    const extra = [0, 0, 0, 0, 0, 0];
    m.mats.forEach((x) => extra[x]++);
    let v = 0;
    focus.forEach((t, i) => (v += (t.g - gap(pl, b, t.id, extra)) * weights[i] * (0.5 + t.value / 6)));
    const over = tokenCount(pl) + m.mats.length - TOKEN_LIMIT;
    if (over > 0) v -= over * 0.9;
    v += random() * (level === 'easy' ? 1 : 0.15);
    if (v > bt) [bestTake, bt] = [m, v];
  }

  // 3. hold an order: a strong one that's close, or when taking does little
  const reserves = moves.filter((m) => m.type === 'reserve');
  if (reserves.length && pl.reserved.length < RESERVE_LIMIT && level !== 'easy') {
    let bestRes = null, br = -Infinity;
    for (const m of reserves) {
      if (m.slot === DECK) continue;
      const id = view.board[m.tier][m.slot];
      const g = gap(pl, b, id);
      const v = cardValue(view, me, id, level) - g * 0.8 + (CARDS[id].points >= 3 ? 1 : 0);
      if (v > br) [bestRes, br] = [m, v];
    }
    const takeWeak = !bestTake || bt < 1.2;
    if (bestRes && ((takeWeak && br > 1) || (level === 'hard' && br > 4.5 && view.players.some((p, i) => i !== me && points(p) >= view.target - 6)))) return bestRes;
    if (!bestTake) return bestRes || reserves[0];
  }
  if (bestTake) return bestTake;
  return builds[0] || reserves[0] || moves[0];
}
