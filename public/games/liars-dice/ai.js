// Computer players for Liar's Dice. A bot sees only its own view (its own dice, the dice
// counts and the bids so far) and works out how likely each bid is to be true.
//
// For a bid of "q × face", the bot counts its own matching dice and treats every other die on
// the table as a coin with a 1-in-6 chance (1-in-3 with wild ones) of matching. Normal and
// Expert players also read the table: someone who bid fours probably has a four or two.
import { faces, minQty, countFace } from './engine.js';

export const LEVELS = {
  easy: { label: 'Easy', target: 0.5, noise: 0.3, read: 0.2, bluff: 0.25, caution: 1.25 },
  normal: { label: 'Normal', target: 0.55, noise: 0.08, read: 0.45, bluff: 0.12, caution: 1 },
  hard: { label: 'Expert', target: 0.6, noise: 0.03, read: 0.9, bluff: 0.1, caution: 0.85 },
};

// P(X >= k) and P(X == k) for X ~ Binomial(n, p)
function binom(n, p) {
  const pmf = new Array(n + 1).fill(0);
  pmf[0] = (1 - p) ** n;
  for (let k = 1; k <= n; k++) pmf[k] = (pmf[k - 1] * (n - k + 1) * p) / (k * (1 - p));
  return pmf;
}
const tailAt = (pmf, k) => (k <= 0 ? 1 : k >= pmf.length ? 0 : pmf.slice(k).reduce((a, b) => a + b, 0));
// fractional k: blend between the neighbouring whole numbers
const tail = (pmf, k) => {
  const lo = Math.floor(k);
  const f = k - lo;
  return tailAt(pmf, lo) * (1 - f) + tailAt(pmf, lo + 1) * f;
};

export function choose(view, moves, level = 'normal', random = Math.random) {
  if (moves.length === 1) return moves[0];
  const L = LEVELS[level] || LEVELS.normal;
  const me = view.seat;
  const mine = view.dice[me] || [];
  const wild = view.options.wild;
  const unknown = view.total - mine.length;
  const pmf = { wild: binom(unknown, 1 / 3), plain: binom(unknown, 1 / 6) };
  const dist = (face) => (wild && face !== 1 ? pmf.wild : pmf.plain);

  // how many extra matching dice the other players' bids suggest they hold
  const hint = (face) => {
    if (!L.read) return 0;
    const bidders = new Set(view.history.filter((b) => b.seat !== me && b.face === face).map((b) => b.seat));
    // without wild ones a bidder's own dice stand out more against the 1-in-6 odds
    return Math.min(unknown, bidders.size * L.read * (wild ? 1 : 1.4));
  };
  const have = (face) => countFace(mine, face, wild);
  const pTrue = (qty, face) => tail(dist(face), qty - have(face) - hint(face));
  const pExact = (qty, face) => {
    const need = Math.round(qty - have(face) - hint(face));
    if (need < 0 || need > unknown) return 0;
    return dist(face)[need];
  };

  const bid = view.bid;
  const has = (type) => moves.some((m) => m.type === type);
  const N = view.total;

  // the cheapest raise on each face, and how far to push it
  const options = [];
  for (const face of faces(wild)) {
    let qty = minQty(bid, face);
    if (qty > N) continue;
    const p = pTrue(qty, face) + (random() - 0.5) * L.noise;
    // an opening bid climbs to what the bot believes; a raise pushes at most one more
    const push = bid ? 1 : N;
    for (let i = 0; i < push && qty < N && pTrue(qty + 1, face) >= L.target + 0.1; i++) qty++;
    options.push({ type: 'bid', qty, face, p, mine: have(face) });
  }
  options.sort((a, b) => b.p - a.p || b.mine - a.mine || b.face - a.face);
  let pick = options[0] || null;

  // a bluff now and then: a believable raise on a face the bot doesn't hold
  if (pick && random() < L.bluff) {
    const fakes = options.filter((o) => o !== pick && o.p > 0.35);
    if (fakes.length) pick = { ...fakes[Math.floor(random() * fakes.length)] };
  }

  if (bid) {
    const truth = pTrue(bid.qty, bid.face) + (random() - 0.5) * L.noise;
    const raiseOdds = pick ? pick.p : 0;
    if (has('spot')) {
      const exact = pExact(bid.qty, bid.face);
      // a good spot-on call costs everyone else a die, so take it when it's the best bet
      if (exact > 0.3 && exact >= 1 - truth && exact >= raiseOdds * 0.7) return { type: 'spot' };
    }
    if (!pick || (truth < 0.5 && 1 - truth > raiseOdds * L.caution)) return { type: 'liar' };
  }
  return pick ? { type: 'bid', qty: pick.qty, face: pick.face } : moves[0];
}

// The plain odds that "qty × face" is on the table, from one player's own dice only. The
// screen shows this as a hint while you bid.
export function odds(view, qty, face) {
  const mine = view.dice[view.seat] || [];
  const wild = view.options.wild;
  const pmf = binom(view.total - mine.length, wild && face !== 1 ? 1 / 3 : 1 / 6);
  return tailAt(pmf, qty - countFace(mine, face, wild));
}
