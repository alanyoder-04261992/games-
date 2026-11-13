// Spit & Speed computer player. It picks a move from the legal list; how *fast* it reacts is
// set by pace() in index.js, which is what the difficulty levels mostly change.
import { fits } from './engine.js';

export const LEVELS = {
  easy: { label: 'Easy (slow hands)', play: 1750, ready: 1300, slap: 1500, sloppy: 0.35 },
  normal: { label: 'Normal', play: 1100, ready: 900, slap: 950, sloppy: 0.1 },
  hard: { label: 'Lightning', play: 640, ready: 600, slap: 560, sloppy: 0 },
};

const topOf = (pile) => (pile.top.length ? pile.top[pile.top.length - 1] : null);

export function choose(view, legal, level = 'normal', random = Math.random) {
  if (!legal.length) return null;
  const first = legal[0];
  const L = LEVELS[level] || LEVELS.normal;
  const moves = legal.filter((m) => m.type === 'move');
  // waiting to flip: turn up a hidden card first if there's an empty space, then say ready
  if (first.type === 'ready' || (!legal.some((m) => m.type === 'play') && !legal.some((m) => m.type === 'slap'))) {
    if (moves.length) return moves.reduce((a, b) => (view.players[view.seat].stacks[b.from].n > view.players[view.seat].stacks[a.from].n ? b : a));
    return first;
  }
  if (first.type === 'slap') {
    if (random() < L.sloppy) return legal[Math.floor(random() * legal.length)];
    // grab the smaller pile
    return view.piles[0].n <= view.piles[1].n ? legal[0] : legal[1];
  }
  const plays = legal.filter((m) => m.type === 'play');
  if (random() < L.sloppy) return plays[Math.floor(random() * plays.length)];

  const me = view.players[view.seat];
  const tops = view.piles.map(topOf);
  // my other cards that could go next
  const mine = view.mode === 'speed' ? me.hand : me.stacks.map((st) => st.top).filter((c) => c != null);
  let best = plays[0];
  let bestScore = -Infinity;
  for (const m of plays) {
    const card = view.mode === 'speed' ? m.card : me.stacks[m.from].top;
    const after = tops.slice();
    after[m.pile] = card;
    let score = 0;
    // chains: after this card, how many of my cards still have somewhere to go
    for (const c of mine) if (c !== card && (fits(c, after[0], view.wrap) || fits(c, after[1], view.wrap))) score += 2;
    if (view.mode === 'spit' && me.stacks[m.from].n >= 2) score += 3; // turns up a new card
    if (view.mode === 'spit' && me.stacks[m.from].n === 1) score += 1; // empties a space to move into
    score += random() * 0.5;
    if (score > bestScore) [best, bestScore] = [m, score];
  }
  return best;
}
