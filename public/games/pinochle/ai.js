// Pinochle computer players. They only get one seat's view (their own hand plus what is on
// the table) and the legal moves, so they never peek.
//
//   easy    bids by feel, often plays a random legal card
//   normal  counts meld and trump for its bid, keeps track of which cards are gone
//   hard    also reads voids, feeds counters to a partner who is sure to win,
//           and saves its trump for the right moment
import { SUITS, BID_STEP, HAND_SIZE, LAST_TRICK_BONUS, faceOf, fullDeck, isCounter, meldPoints, partnerOf, power, rankOf, suitOf, teamOf, beats, winningPlay, legalPlaysFor, cardPoints } from './engine.js';

export const LEVELS = {
  easy: { label: 'Easy', noise: 0.45, margin: 30 },
  normal: { label: 'Normal', noise: 0, margin: 15 },
  hard: { label: 'Expert', noise: 0, margin: 15 },
};

export function chooseAction(view, legal, level = 'normal', random = Math.random) {
  if (!legal.length) return null;
  const L = LEVELS[level] || LEVELS.normal;
  if (legal.length === 1 && legal[0].type !== 'pass-cards') return legal[0];
  switch (view.phase) {
    case 'bid':
      return chooseBid(view, legal, level, random);
    case 'trump':
      return { type: 'trump', suit: bestTrump(view.hand).suit };
    case 'passIn':
    case 'passBack':
      return { type: 'pass-cards', cards: choosePass(view) };
    case 'meld':
      return shouldThrowIn(view, level) && legal.some((a) => a.type === 'throw-in') ? { type: 'throw-in' } : { type: 'ready' };
    case 'play': {
      if (L.noise && random() < L.noise) return legal[Math.floor(random() * legal.length)];
      const cards = legal.map((a) => a.card);
      const card = level === 'hard' && cards.length > 1 ? searchPlay(view, cards, random) : choosePlay(view, cards, level);
      return { type: 'play', card };
    }
    default:
      return legal[0];
  }
}

// ---------------------------------------------------------------------------
// Hand evaluation
// ---------------------------------------------------------------------------
const count = (hand, pred) => hand.filter(pred).length;

// Counters (out of 250) a team is likely to take when this hand names `trump`.
export function trickEstimate(hand, trump) {
  const trumps = hand.filter((c) => suitOf(c) === trump);
  let est = 95;
  est += (trumps.length - 3) * 14;
  est += count(trumps, (c) => rankOf(c) === 'A') * 12 + count(trumps, (c) => rankOf(c) === 'T') * 6;
  for (const s of SUITS) {
    if (s === trump) continue;
    const cs = hand.filter((c) => suitOf(c) === s);
    const aces = count(cs, (c) => rankOf(c) === 'A');
    est += aces * 11;
    if (aces === 2) est += count(cs, (c) => rankOf(c) === 'T') * 8;
    if (cs.length === 0 && trumps.length >= 4) est += 8;
  }
  return Math.max(30, Math.min(230, est));
}

export function bestTrump(hand) {
  let best = null;
  for (const suit of SUITS) {
    const len = count(hand, (c) => suitOf(c) === suit);
    if (!len) continue;
    const meld = meldPoints(hand, suit);
    const tricks = trickEstimate(hand, suit);
    const value = meld + tricks;
    if (!best || value > best.value) best = { suit, meld, tricks, value };
  }
  return best || { suit: SUITS[0], meld: 0, tricks: 60, value: 60 };
}

// What this hand thinks the team can make as bidder.
function handValue(hand, partnerShows = 0) {
  const b = bestTrump(hand);
  const partnerMeld = 25 + partnerShows;
  return b.meld + b.tricks + partnerMeld;
}

function chooseBid(view, legal, level, random) {
  const L = LEVELS[level] || LEVELS.normal;
  const bids = legal.filter((a) => a.type === 'bid');
  const canPass = legal.some((a) => a.type === 'pass');
  if (!canPass) return bids[0]; // stuck: take it at the minimum
  const me = view.seat;
  const partner = partnerOf(me);
  const high = view.bidding.high;
  const log = view.bidding.log;
  // partner's bids tell us their hand is good
  const partnerBids = log.filter((e) => e.seat === partner && e.type === 'bid').length;
  const partnerShows = partnerBids ? 20 + 10 * Math.min(2, partnerBids - 1) : 0;
  const pass = view.options.pass || 0;
  // passing cards adds about 25-30 points a card to the bidding team (measured in bot games)
  let value = handValue(view.hand, partnerShows) + pass * 26 - L.margin;
  if (L.noise) value += (random() - 0.5) * 80;
  const next = bids[0]?.amount;
  if (next == null || next > value) return { type: 'pass' };
  // don't bid over a partner who's already winning it unless we're clearly stronger
  if (high && high.seat === partner) {
    const myOwn = bestTrump(view.hand);
    if (myOwn.meld < 80 && value < next + 60) return { type: 'pass' };
  }
  // opening bid with a lot of meld: jump to show it (meld bid) — hard only
  if (level === 'hard' && !high) {
    const meld = bestTrump(view.hand).meld;
    if (meld >= 120) {
      const jump = Math.min(value, next + Math.floor(meld / 60) * BID_STEP * 2);
      const pick = bids.filter((b) => b.amount <= jump).pop();
      if (pick) return pick;
    }
  }
  return bids[0];
}

// ---------------------------------------------------------------------------
// Passing cards
// ---------------------------------------------------------------------------
export function choosePass(view) {
  const n = view.options.pass;
  const hand = [...view.hand];
  const trump = view.trump;
  const toBidder = view.phase === 'passIn';
  const out = [];
  if (toBidder) {
    // partner sends what helps the bidder most: trump (high first), then aces, then pinochle parts
    const score = (c) => {
      if (suitOf(c) === trump) return 100 + power(c) * 3 + (rankOf(c) === 'Q' || rankOf(c) === 'K' ? 4 : 0);
      if (rankOf(c) === 'A') return 60;
      if (faceOf(c) === 'QS' || faceOf(c) === 'JD') return 20;
      if (rankOf(c) === 'T') return 10;
      return power(c);
    };
    hand.sort((a, b) => score(b) - score(a));
    return hand.slice(0, n);
  }
  // bidder sends back the cards that cost the least meld and trick power, keeping trump
  let left = hand;
  for (let i = 0; i < n; i++) {
    const base = meldPoints(left, trump);
    let best = null;
    for (const c of left) {
      const rest = left.filter((x) => x !== c);
      const lost = base - meldPoints(rest, trump);
      const suitLen = count(left, (x) => suitOf(x) === suitOf(c));
      let cost = lost * 3 + (suitOf(c) === trump ? 120 + power(c) * 4 : 0) + (rankOf(c) === 'A' ? 50 : 0) + power(c) * 2 + suitLen * 3;
      // short side suits are good to empty (we can trump them later)
      if (suitOf(c) !== trump && suitLen <= 2) cost -= 6;
      if (!best || cost < best.cost) best = { c, cost };
    }
    out.push(best.c);
    left = left.filter((x) => x !== best.c);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Throwing in
// ---------------------------------------------------------------------------
function shouldThrowIn(view, level) {
  const c = view.contract;
  if (!c || c.bidder !== view.seat || !view.melds) return false;
  const team = teamOf(view.seat);
  const ourMeld = view.melds[team].total + view.melds[team + 2].total;
  const theirMeld = view.melds[1 - team].total + view.melds[3 - team].total;
  const need = c.amount - ourMeld;
  if (need > 250) return true; // can't make it even taking every counter
  if (level === 'easy') return false;
  // likely set: throwing in keeps the opponents from scoring their counters
  const est = trickEstimate(view.hand, view.trump) + 10;
  return need > est + 70 && theirMeld < 150;
}

// ---------------------------------------------------------------------------
// Card play
// ---------------------------------------------------------------------------
// What every seat could still hold, from this seat's point of view.
function knowledge(view) {
  const me = view.seat;
  const trump = view.trump;
  const played = [...(view.tricks || []).flatMap((t) => t.plays.map((p) => p.card)), ...(view.trick?.plays || []).map((p) => p.card)];
  const gone = new Set([...played, ...view.hand]);
  // the faces still out in other hands
  const unseen = fullDeck().filter((c) => !gone.has(c));
  // voids learned from play: didn't follow the led suit -> void in it; didn't trump -> no trump
  const void_ = [0, 1, 2, 3].map(() => new Set());
  const allTricks = [...(view.tricks || []), ...(view.trick?.plays?.length ? [view.trick] : [])];
  for (const t of allTricks) {
    const plays = t.plays;
    if (!plays.length) continue;
    const led = suitOf(plays[0].card);
    for (let i = 1; i < plays.length; i++) {
      const p = plays[i];
      if (suitOf(p.card) !== led) {
        void_[p.seat].add(led);
        if (suitOf(p.card) !== trump) void_[p.seat].add(trump);
      }
    }
  }
  // cards shown in meld that haven't been played yet are known to be in that hand
  const shown = [0, 1, 2, 3].map((s) => {
    if (s === me || !view.melds) return [];
    const playedBy = new Set(allTricks.flatMap((t) => t.plays.filter((p) => p.seat === s).map((p) => p.card)));
    return view.melds[s].cards.filter((c) => !playedBy.has(c));
  });
  return { unseen, void: void_, shown, me };
}

// Is this card sure to win if led now? (No unseen card of its suit is higher, and nobody who
// might still trump is known to be void.)
function isBoss(card, k, trump, opponents, level) {
  const s = suitOf(card);
  const higher = k.unseen.some((c) => suitOf(c) === s && power(c) > power(card));
  if (higher) return false;
  if (s === trump) return true;
  if (level !== 'hard') return true;
  const trumpsOut = k.unseen.some((c) => suitOf(c) === trump);
  return !(trumpsOut && opponents.some((o) => k.void[o].has(s) && !k.void[o].has(trump)));
}

function choosePlay(view, cards, level) {
  if (cards.length === 1) return cards[0];
  const me = view.seat;
  const trump = view.trump;
  const partner = partnerOf(me);
  const opponents = [(me + 1) % 4, (me + 3) % 4];
  const plays = view.trick.plays;
  const k = knowledge(view);
  const hand = view.hand;
  const byLow = (a, b) => (isCounter(a) - isCounter(b)) || power(a) - power(b) || (suitOf(a) === trump) - (suitOf(b) === trump);
  const lowest = (list) => [...list].sort(byLow)[0];
  const cheapestWinner = (list) => [...list].sort((a, b) => (suitOf(a) === trump) - (suitOf(b) === trump) || power(a) - power(b))[0];

  // ---- leading ----
  if (plays.length === 0) {
    const bidTeam = view.contract && teamOf(view.contract.bidder) === teamOf(me);
    const myTrumps = cards.filter((c) => suitOf(c) === trump);
    const trumpsOut = k.unseen.filter((c) => suitOf(c) === trump).length;
    // bidding side pulls trump while it has the boss and the opponents may still hold some
    if (bidTeam && myTrumps.length >= 3 && trumpsOut > 0) {
      const boss = myTrumps.filter((c) => isBoss(c, k, trump, opponents, level));
      if (boss.length) return boss.sort((a, b) => power(b) - power(a))[0];
    }
    // cash side-suit winners
    const sideBoss = cards.filter((c) => suitOf(c) !== trump && isBoss(c, k, trump, opponents, level));
    if (sideBoss.length) return sideBoss.sort((a, b) => power(b) - power(a))[0];
    // hard: lead a suit partner is void in so partner can trump
    if (level === 'hard' && !k.void[partner].has(trump)) {
      const feed = cards.filter((c) => suitOf(c) !== trump && k.void[partner].has(suitOf(c)) && !isCounter(c));
      if (feed.length) return lowest(feed);
    }
    // otherwise lead low from a long side suit, keeping trump
    const side = cards.filter((c) => suitOf(c) !== trump);
    const pool = side.length ? side : cards;
    const len = (s) => count(hand, (c) => suitOf(c) === s);
    return [...pool].sort((a, b) => isCounter(a) - isCounter(b) || len(suitOf(b)) - len(suitOf(a)) || power(a) - power(b))[0];
  }

  // ---- following ----
  const win = winningPlay(plays, trump);
  const partnerWinning = win.seat === partner;
  const last = plays.length === 3;
  const winners = cards.filter((c) => beats(c, win.card, trump));
  const losers = cards.filter((c) => !beats(c, win.card, trump));
  // will partner's card hold? (we're last, or nobody after us can beat it)
  const after = [0, 1, 2, 3].filter((s) => s !== me && !plays.some((p) => p.seat === s));
  const canBeat = (seat, card) => {
    const s = suitOf(card);
    const led = suitOf(plays[0].card);
    const unseenHigher = k.unseen.some((c) => (suitOf(c) === s && power(c) > power(card)) || (s !== trump && suitOf(c) === trump));
    if (!unseenHigher) return false;
    if (level === 'easy') return true;
    // a seat known void in the led suit and out of trump can't beat anything
    if (k.void[seat].has(led) && k.void[seat].has(trump)) return false;
    if (s !== trump && !k.void[seat].has(led)) {
      // they must follow; only a higher card of the led suit beats it
      return k.unseen.some((c) => suitOf(c) === s && power(c) > power(card));
    }
    return true;
  };
  const holds = (card) => after.every((s) => !canBeat(s, card));

  if (partnerWinning && (last || holds(win.card))) {
    // smear: give partner counters, but never waste trump aces or a boss we could lead later
    const smear = losers.filter((c) => isCounter(c) && suitOf(c) !== trump);
    const pool = smear.length ? smear : losers.length ? losers : cards;
    if (level !== 'easy' && smear.length) return [...smear].sort((a, b) => rankOrderForSmear(a) - rankOrderForSmear(b))[0];
    return pool === losers ? [...pool].sort((a, b) => isCounter(b) - isCounter(a) || power(a) - power(b))[0] : lowest(pool);
  }
  if (winners.length) {
    if (last) return cheapestWinner(winners);
    // win with a card that will hold if we have one; otherwise only spend a low trump
    const holding = winners.filter((c) => holds(c));
    if (holding.length) return cheapestWinner(holding);
    const pts = plays.reduce((s, p) => s + (isCounter(p.card) ? 10 : 0), 0);
    const lowTrump = winners.filter((c) => suitOf(c) === trump && !isCounter(c));
    if (lowTrump.length && (pts >= 10 || level !== 'hard')) return cheapestWinner(lowTrump);
    if (losers.length) return lowest(losers);
    return cheapestWinner(winners);
  }
  return lowest(losers.length ? losers : cards);
}

// Smear order: Kings first, then 10s, then Aces (Aces are often winners on their own).
function rankOrderForSmear(c) {
  return { K: 0, T: 1, A: 2 }[rankOf(c)] ?? 3;
}

// ---------------------------------------------------------------------------
// Expert card play: try each card against many deals of the unseen cards that fit what's
// known (hand sizes, voids, meld still on the table), play each deal out quickly, and keep
// the card that scores best for our team.
// ---------------------------------------------------------------------------
const SAMPLES = 36;

function searchPlay(view, cards, random) {
  const me = view.seat;
  const k = knowledge(view);
  // identical cards play the same: only try each face once
  const byFace = new Map();
  for (const c of cards) if (!byFace.has(faceOf(c))) byFace.set(faceOf(c), c);
  const options = [...byFace.values()];
  if (options.length === 1) return options[0];
  const fallback = choosePlay(view, cards, 'hard');
  const total = new Map(options.map((c) => [c, 0]));
  for (let i = 0; i < SAMPLES; i++) {
    const hands = sampleHands(view, k, random);
    if (!hands) break;
    for (const c of options) total.set(c, total.get(c) + playout(view, hands, c));
  }
  let best = fallback;
  let bestScore = total.get(byFace.get(faceOf(fallback))) ?? -Infinity;
  for (const [c, v] of total) if (v > bestScore + 1e-9) (best = c), (bestScore = v);
  return best;
}

// Deal the unseen cards to the other three seats.
function sampleHands(view, k, random) {
  const me = view.seat;
  const trump = view.trump;
  const others = [0, 1, 2, 3].filter((s) => s !== me);
  const need = view.handSizes.slice();
  for (let attempt = 0; attempt < 30; attempt++) {
    const hands = [[], [], [], []];
    hands[me] = [...view.hand];
    const room = need.slice();
    const pool = [];
    const placed = new Set();
    for (const s of others) for (const c of k.shown[s]) if (!placed.has(c)) (hands[s].push(c), room[s]--, placed.add(c));
    for (const c of k.unseen) if (!placed.has(c)) pool.push(c);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const relax = attempt > 20;
    // most constrained cards first: those few seats can hold
    const fits = (s, c) => room[s] > 0 && (relax || !k.void[s].has(suitOf(c)));
    pool.sort((a, b) => others.filter((s) => !k.void[s].has(suitOf(a))).length - others.filter((s) => !k.void[s].has(suitOf(b))).length);
    let ok = true;
    for (const c of pool) {
      const seats = others.filter((s) => fits(s, c));
      if (!seats.length) {
        ok = false;
        break;
      }
      const s = seats[Math.floor(random() * seats.length)];
      hands[s].push(c);
      room[s]--;
    }
    if (ok && others.every((s) => room[s] === 0)) return hands;
    void trump;
  }
  return null;
}

// Play the rest of the hand with a quick policy; return our team's score change minus theirs.
function playout(view, dealt, first) {
  const me = view.seat;
  const trump = view.trump;
  const hands = dealt.map((h) => [...h]);
  const counters = [...view.points];
  const tookTrick = [false, false];
  for (const t of view.tricks) tookTrick[teamOf(t.winner)] = true;
  let plays = view.trick.plays.map((p) => ({ ...p }));
  let tricksDone = view.tricks.length;
  let seat = me;
  let card = first;
  for (;;) {
    hands[seat].splice(hands[seat].indexOf(card), 1);
    plays.push({ seat, card });
    if (plays.length === 4) {
      const w = winningPlay(plays, trump).seat;
      tricksDone++;
      counters[teamOf(w)] += plays.reduce((s, p) => s + cardPoints(p.card), 0) + (tricksDone === HAND_SIZE ? LAST_TRICK_BONUS : 0);
      tookTrick[teamOf(w)] = true;
      if (tricksDone === HAND_SIZE) break;
      plays = [];
      seat = w;
    } else seat = (seat + 1) % 4;
    card = quickPick(hands[seat], plays, trump, seat);
  }
  const c = view.contract;
  const bidTeam = teamOf(c.bidder);
  const meld = [view.melds[0].total + view.melds[2].total, view.melds[1].total + view.melds[3].total];
  const gain = [0, 1].map((t) => counters[t] + (tookTrick[t] ? meld[t] : 0));
  if (gain[bidTeam] < c.amount) gain[bidTeam] = -c.amount;
  const mine = teamOf(me);
  return gain[mine] - gain[1 - mine];
}

// A fast, sensible policy for playouts.
function quickPick(hand, plays, trump, seat) {
  const legal = legalPlaysFor(hand, plays, trump);
  if (legal.length === 1) return legal[0];
  const low = (a, b) => isCounter(a) - isCounter(b) || (suitOf(a) === trump) - (suitOf(b) === trump) || power(a) - power(b);
  if (!plays.length) {
    const aces = legal.filter((c) => rankOf(c) === 'A' && suitOf(c) !== trump);
    if (aces.length) return aces[0];
    return legal.sort(low)[0];
  }
  const win = winningPlay(plays, trump);
  if (win.seat === (seat + 2) % 4) {
    const losers = legal.filter((c) => !beats(c, win.card, trump));
    if (losers.length) return losers.sort((a, b) => isCounter(b) - isCounter(a) || (suitOf(a) === trump) - (suitOf(b) === trump) || power(a) - power(b))[0];
    return legal.sort(low)[0];
  }
  const winners = legal.filter((c) => beats(c, win.card, trump));
  if (winners.length) {
    if (plays.length === 3) return winners.sort((a, b) => (suitOf(a) === trump) - (suitOf(b) === trump) || power(a) - power(b))[0];
    return winners.sort((a, b) => power(b) - power(a))[0];
  }
  return legal.sort(low)[0];
}
