// Broadside computer admirals. They see exactly what a player sees: their own fleet, every
// shot fired, and enemy ships only once they have sunk.
//
// Every level counts, for each open square, how many ways the enemy ships still afloat could
// lie across it (squares already missed, or covered by a sunk ship, rule a position out).
// Positions running through an unsunk hit count far more, so after a hit they finish that
// ship off. Easy mostly fires at random; Normal sometimes guesses; Expert never does.
import { SHIPS, shipCells } from './engine.js';

export const LEVELS = {
  easy: { label: 'Easy', random: 0.7, noise: 1 },
  normal: { label: 'Normal', random: 0.1, noise: 0.6 },
  hard: { label: 'Expert', random: 0, noise: 0 },
};

export function heatmap(view, seat) {
  const N = view.size;
  const enemy = view.boards[1 - seat];
  const state = new Array(N * N).fill(0); // 0 open, 1 miss, 2 hit, 3 sunk ship
  for (const sh of enemy.shots) state[sh.i] = sh.hit ? 2 : 1;
  const sunkIds = new Set();
  for (const ship of enemy.ships || [])
    if (ship.sunk) {
      sunkIds.add(ship.id);
      for (const c of ship.cells) state[c] = 3;
    }
  const remaining = view.fleet.filter((id) => !sunkIds.has(id));
  const heat = new Array(N * N).fill(0);
  const openHits = state.some((x) => x === 2);
  for (const id of remaining) {
    const len = SHIPS[id].len;
    for (const dir of ['h', 'v'])
      for (let y = 0; y < N; y++)
        for (let x = 0; x < N; x++) {
          const cells = shipCells(N, x, y, dir, len);
          if (!cells || cells.some((c) => state[c] === 1 || state[c] === 3)) continue;
          const hits = cells.filter((c) => state[c] === 2).length;
          if (openHits && !hits) {
            for (const c of cells) if (state[c] === 0) heat[c] += 0.02;
            continue;
          }
          const w = hits ? 50 ** hits : 1;
          for (const c of cells) if (state[c] === 0) heat[c] += w;
        }
  }
  return heat;
}

export function chooseAction(view, legal, level = 'normal') {
  if (!legal.length) return null;
  const lvl = LEVELS[level] || LEVELS.normal;
  const seat = view.seat;
  if (view.phase === 'place') {
    return legal[0]; // a random fleet, spread out so ships don't touch
  }
  if (lvl.random && Math.random() < lvl.random) return legal[Math.floor(Math.random() * legal.length)];
  const heat = heatmap(view, seat);
  let best = legal[0];
  let bestScore = -Infinity;
  for (const m of legal) {
    let score = heat[m.i] * (1 + (Math.random() - 0.5) * lvl.noise) + Math.random() * 1e-6;
    if (score > bestScore) [best, bestScore] = [m, score];
  }
  return best;
}
