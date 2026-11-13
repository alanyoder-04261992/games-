// Computer players for Euchre. They only ever see a view (their own hand plus what's on the
// table) and pick one of the legal moves.
//
//   Easy    calls on big hands only and plays loosely.
//   Normal  sound bidding and table play: counts what's gone, knows the bowers, leads trump
//           when its team called it, saves partner's tricks.
//   Expert  bids the same way, then plays each card by trying it out: it deals the unseen cards
//           to the other hands many times (matching who has shown out of a suit) and plays every
//           deal to the end, picking the card that scores best on average.
import {
  SUITS,
  fullDeck,
  isRight,
  isLeft,
  isTrump,
  legalPlays,
  naturalSuit,
  partnerOf,
  power,
  rankOf,
  scoreHand,
  strength,
  suitOf,
  teamOf,
  nextActive,
  HAND_SIZE,
} from './engine.js';

export const LEVELS = {
  easy: { label: 'Easy', bid: 1.2, alone: false, random: 0.4 },
  normal: { label: 'Normal', bid: 0, alone: true, random: 0 },
  hard: { label: 'Expert', bid: -0.15, alone: true, random: 0, samples: 48 },
};

// ---------- hand strength ----------
// A rough number of how good `hand` is with `trump`: about 6 is worth calling.
export function handValue(hand, trump) {
  let v = 0;
  let trumps = 0;
  const counts = {};
  for (const c of hand) {
    const s = suitOf(c, trump);
    counts[s] = (counts[s] || 0) + 1;
    if (s === trump) {
      trumps++;
      if (isRight(c, trump)) v += 3.1;
      else if (isLeft(c, trump)) v += 2.6;
      else v += { A: 2.0, K: 1.65, Q: 1.4, T: 1.2, 9: 1.1 }[rankOf(c)];
    } else if (rankOf(c) === 'A') v += 1.05;
    else if (rankOf(c) === 'K') v += counts[s] === 1 && hand.includes('A' + s) ? 0.55 : 0.25;
  }
  if (trumps >= 2) {
    for (const s of SUITS) {
      if (s === trump) continue;
      if (!counts[s]) v += 0.55;
      else if (counts[s] === 1 && !hand.includes('A' + s)) v += 0.15;
    }
  }
  return v;
}

// Will this hand take all five tricks alone? Conservative.
export function aloneWorthy(hand, trump) {
  const trumps = hand.filter((c) => isTrump(c, trump));
  const side = hand.filter((c) => !isTrump(c, trump));
  const top = topTrumpRun(trumps, trump);
  const sideAces = side.filter((c) => rankOf(c) === 'A').length;
  if (trumps.length === 5) return top >= 1 || trumps.some((c) => isLeft(c, trump));
  if (trumps.length === 4) return top >= 2 || (top >= 1 && sideAces === side.length);
  if (trumps.length === 3) return top >= 3 && sideAces === side.length;
  return false;
}

// how many of the very top trumps (right, left, ace, king...) are held in an unbroken run
function topTrumpRun(trumps, trump) {
  const order = ['J' + trump, 'J' + { S: 'C', C: 'S', H: 'D', D: 'H' }[trump], 'A' + trump, 'K' + trump, 'Q' + trump, 'T' + trump, '9' + trump];
  let n = 0;
  while (n < order.length && trumps.includes(order[n])) n++;
  return n;
}

// The best card for the dealer to throw away after picking up: keep what makes the hand strongest.
export function bestDiscard(hand, trump) {
  let best = null;
  let bestV = -Infinity;
  for (const c of hand) {
    const rest = hand.filter((x) => x !== c);
    const v = handValue(rest, trump) - (isTrump(c, trump) ? 0.01 : 0);
    if (v > bestV) [best, bestV] = [c, v];
  }
  return best;
}

// value of an up-card going to the dealer's side
function upcardBonus(card, trump) {
  if (isRight(card, trump)) return 3.1;
  if (isLeft(card, trump)) return 2.6;
  return { A: 2.0, K: 1.65, Q: 1.4, T: 1.2, 9: 1.1 }[rankOf(card)] ?? 1;
}

function bidChoice(v, level, random) {
  const L = LEVELS[level] || LEVELS.normal;
  const me = v.seat;
  const hand = v.hand;
  const noise = level === 'easy' ? (random() - 0.5) * 1.2 : 0;
  // score position: need to stop them, or one point wins it
  const us = teamOf(me);
  const target = v.options?.winScore ?? 10;
  const theyClose = v.scores && v.scores[1 - us] >= target - 2;
  const scoreAdj = theyClose ? -0.3 : 0;
  const threshold = 6.1 + L.bid + noise + scoreAdj;
  const allowAlone = v.options?.allowAlone !== false && L.alone;

  if (v.phase === 'order') {
    const trump = naturalSuit(v.upcard);
    let value;
    let finalHand = hand;
    if (me === v.dealer) {
      const withUp = [...hand, v.upcard];
      finalHand = withUp.filter((c) => c !== bestDiscard(withUp, trump));
      value = handValue(finalHand, trump);
    } else if (partnerOf(me) === v.dealer) value = handValue(hand, trump) + upcardBonus(v.upcard, trump) * 0.6;
    else value = handValue(hand, trump) - upcardBonus(v.upcard, trump) * 0.55 - 0.2;
    if (value >= threshold) {
      // going alone as the dealer's partner means the up-card is wasted, so judge the bare hand
      const alone = allowAlone && aloneWorthy(finalHand, trump);
      return { type: 'order', alone };
    }
    return { type: 'pass' };
  }

  // round two: name the best suit other than the one turned down
  const banned = naturalSuit(v.turnedDown);
  let best = null;
  let bestV = -Infinity;
  for (const s of SUITS) {
    if (s === banned) continue;
    const val = handValue(hand, s);
    if (val > bestV) [best, bestV] = [s, val];
  }
  const stuck = v.options?.stickDealer && me === v.dealer;
  // the seat left of the dealer leads first, so a little less is enough there ("next" is a
  // classic call: the same-color suit as the turned-down card)
  const leftOfDealer = (v.dealer + 1) % 4 === me;
  let adj = leftOfDealer ? -0.25 : 0;
  if (leftOfDealer && best && sisterOf(banned) === best) adj -= 0.2;
  if (stuck || bestV >= threshold + adj) {
    return { type: 'call', suit: best, alone: allowAlone && aloneWorthy(hand, best) };
  }
  return { type: 'pass' };
}
const sisterOf = (s) => ({ S: 'C', C: 'S', H: 'D', D: 'H' })[s];

// ---------- card play ----------
// Everything a seat can work out from the table: cards gone, who is out of which suit.
function knowledge(v) {
  const trump = v.trump;
  const played = new Set();
  const voids = [new Set(), new Set(), new Set(), new Set()];
  const tricks = [...(v.tricks || []), ...(v.trick && v.trick.plays.length ? [v.trick] : [])];
  for (const t of tricks) {
    if (!t.plays.length) continue;
    const led = suitOf(t.plays[0].card, trump);
    for (const p of t.plays) {
      played.add(p.card);
      if (suitOf(p.card, trump) !== led) voids[p.seat].add(led);
    }
  }
  const mine = new Set(v.hand);
  const gone = new Set(played);
  if (v.myDiscard) gone.add(v.myDiscard);
  // a card turned down (or set aside) is known to be out of play
  if (v.turnedDown) gone.add(v.turnedDown);
  const unseen = fullDeck().filter((c) => !mine.has(c) && !gone.has(c));
  return { played, voids, unseen };
}

// No card still out there beats `card` in its own suit.
function isBoss(card, trump, unseen) {
  const s = suitOf(card, trump);
  const st = strength(card, trump);
  return !unseen.some((c) => suitOf(c, trump) === s && strength(c, trump) > st);
}

// cheapest card to give away: side suits before trump, low before high, singletons first
function throwaway(cards, hand, trump) {
  const count = (s) => hand.filter((c) => suitOf(c, trump) === s).length;
  const cost = (c) => {
    const s = suitOf(c, trump);
    let x = strength(c, trump);
    if (s === trump) x += 50;
    else if (rankOf(c) === 'A') x += 8;
    if (s !== trump && count(s) === 1 && rankOf(c) !== 'A') x -= 0.5;
    return x;
  };
  return [...cards].sort((a, b) => cost(a) - cost(b))[0];
}

// The normal player's card choice. `v` needs seat, hand, trick, tricks, trump, maker,
// sittingOut, dealer and (optionally) myDiscard / turnedDown.
export function heuristicPlay(v, info = knowledge(v)) {
  const me = v.seat;
  const trump = v.trump;
  const hand = v.hand;
  const plays = v.trick.plays;
  const legal = legalPlays(hand, v.trick, trump);
  if (legal.length === 1) return legal[0];
  const { unseen, voids } = info;
  const partner = partnerOf(me);
  const partnerIn = v.sittingOut !== partner;
  const ourCall = teamOf(v.maker) === teamOf(me);
  const active = v.sittingOut == null ? 4 : 3;
  const trumps = legal.filter((c) => isTrump(c, trump));
  const side = legal.filter((c) => !isTrump(c, trump));
  const byStrength = (a, b) => strength(a, trump) - strength(b, trump);
  const unseenTrumps = unseen.filter((c) => isTrump(c, trump));

  // ----- leading -----
  if (!plays.length) {
    const bossTrump = trumps.filter((c) => isBoss(c, trump, unseen)).sort(byStrength).pop();
    if (ourCall && trumps.length && unseenTrumps.length) {
      // pull trump: makers lead it, and so does the partner of whoever called
      if (v.maker === me && (trumps.length >= 2 || bossTrump)) return bossTrump || trumps.sort(byStrength)[0];
      if (v.maker === partner && partnerIn) return bossTrump || trumps.sort(byStrength)[0];
    }
    // cash side aces/boss cards, preferring suits an opponent can't trump
    const opps = [0, 1, 2, 3].filter((s) => teamOf(s) !== teamOf(me) && s !== v.sittingOut);
    const bossSide = side
      .filter((c) => isBoss(c, trump, unseen))
      .sort((a, b) => {
        const ruffA = opps.some((o) => voids[o].has(suitOf(a, trump)) && !voids[o].has(trump)) ? 1 : 0;
        const ruffB = opps.some((o) => voids[o].has(suitOf(b, trump)) && !voids[o].has(trump)) ? 1 : 0;
        return ruffA - ruffB || byStrength(b, a);
      });
    if (bossSide.length && (unseenTrumps.length === 0 || !opps.some((o) => voids[o].has(suitOf(bossSide[0], trump)) && !voids[o].has(trump)))) return bossSide[0];
    if (!side.length) return bossTrump || trumps.sort(byStrength)[0];
    // defenders against a lone hand: lead something partner might win
    // otherwise lead low from a short suit, ideally one partner is out of (they can trump it)
    const partnerVoid = side.filter((c) => partnerIn && voids[partner].has(suitOf(c, trump)) && !voids[partner].has(trump));
    if (partnerVoid.length && !ourCall) return partnerVoid.sort(byStrength)[0];
    return throwaway(side, hand, trump);
  }

  // ----- following -----
  const led = suitOf(plays[0].card, trump);
  let best = plays[0];
  for (const p of plays) if (power(p.card, trump, led) > power(best.card, trump, led)) best = p;
  const bestPower = power(best.card, trump, led);
  const winners = legal.filter((c) => power(c, trump, led) > bestPower).sort((a, b) => power(a, trump, led) - power(b, trump, led));
  const last = plays.length === active - 1;
  const partnerWinning = best.seat === partner;
  // seats still to play after me
  const after = [];
  for (let s = nextActive(me, v.sittingOut), i = plays.length + 1; i < active; i++, s = nextActive(s, v.sittingOut)) after.push(s);
  const oppsAfter = after.filter((s) => teamOf(s) !== teamOf(me));
  // could anyone after me beat this card?
  const safe = (card) => {
    const p = power(card, trump, led);
    if (!oppsAfter.length) return true;
    const higher = unseen.filter((c) => power(c, trump, led) > p);
    if (!higher.length) return true;
    // only beatable by trump, and every opponent after me has shown out of trump
    if (higher.every((c) => isTrump(c, trump)) && !isTrump(card, trump) && oppsAfter.every((o) => voids[o].has(trump))) return true;
    if (higher.every((c) => isTrump(c, trump)) && isTrump(card, trump) && oppsAfter.every((o) => voids[o].has(trump))) return true;
    return false;
  };

  if (partnerWinning && (last || safe(best.card))) return throwaway(legal, hand, trump);
  if (winners.length) {
    if (last) return winners[0];
    const sure = winners.filter(safe);
    if (sure.length) return sure[0];
    // partner still to play and already likely strong: hold back
    if (after.includes(partner) && partnerWinning) return throwaway(legal, hand, trump);
    // trumping in: use the lowest trump that wins; following: play the best card
    const followers = winners.filter((c) => !isTrump(c, trump) || led === trump);
    if (followers.length) return followers[followers.length - 1];
    return winners[0];
  }
  return throwaway(legal, hand, trump);
}

// ---------- expert: try each card on many possible deals ----------
function seeded(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), t | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

// Deal the unseen cards to the other hands, matching known voids and the dealer's up-card.
function sampleHands(v, info, random) {
  const me = v.seat;
  const trump = v.trump;
  const need = v.handSizes.map((n, s) => (s === me ? 0 : n));
  const fixed = [[], [], [], []];
  let pool = [...info.unseen];
  // the dealer picked up the up-card; unless they've played it, assume they still hold it
  if (v.pickedUp && v.dealer !== me && !info.played.has(v.upcard) && need[v.dealer] > 0 && pool.includes(v.upcard)) {
    fixed[v.dealer].push(v.upcard);
    need[v.dealer]--;
    pool = pool.filter((c) => c !== v.upcard);
  }
  for (let attempt = 0; attempt < 30; attempt++) {
    const cards = [...pool];
    for (let i = cards.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [cards[i], cards[j]] = [cards[j], cards[i]];
    }
    const hands = fixed.map((f) => [...f]);
    const left = [...need];
    // most constrained seats first
    const seats = [0, 1, 2, 3].filter((s) => left[s] > 0).sort((a, b) => info.voids[b].size - info.voids[a].size);
    let ok = true;
    const rest = [];
    for (const c of cards) {
      const s = suitOf(c, trump);
      const fit = seats.filter((x) => left[x] > 0 && !info.voids[x].has(s));
      if (!fit.length) {
        rest.push(c);
        continue;
      }
      // spread cards so no seat is starved
      const pick = fit.reduce((a, b) => (left[b] > left[a] ? b : a));
      hands[pick].push(c);
      left[pick]--;
    }
    for (const c of rest) {
      const x = seats.find((s) => left[s] > 0);
      if (x == null) break;
      if (info.voids[x].has(suitOf(c, trump))) ok = false;
      hands[x].push(c);
      left[x]--;
    }
    if (ok || attempt === 29) {
      hands[me] = [...v.hand];
      return hands;
    }
  }
  return null;
}

// Play out a deal to the end with the normal player in every seat; return points for `team`
// minus points for the other side, plus a little for each trick.
function rollout(v, hands, firstCard) {
  const trump = v.trump;
  const team = teamOf(v.seat);
  let trick = { leader: v.trick.leader, plays: [...v.trick.plays] };
  const tricks = (v.tricks || []).map((t) => ({ ...t, plays: [...t.plays] }));
  const taken = [...v.taken];
  const active = v.sittingOut == null ? 4 : 3;
  hands = hands.map((h) => [...h]);
  let seat = v.seat;
  let card = firstCard;
  const turnedDown = v.turnedDown;
  for (let guard = 0; guard < 40; guard++) {
    hands[seat] = hands[seat].filter((c) => c !== card);
    trick.plays.push({ seat, card });
    if (trick.plays.length === active) {
      const led = suitOf(trick.plays[0].card, trump);
      let best = trick.plays[0];
      for (const p of trick.plays) if (power(p.card, trump, led) > power(best.card, trump, led)) best = p;
      tricks.push({ ...trick, winner: best.seat });
      taken[teamOf(best.seat)]++;
      if (tricks.length === HAND_SIZE) break;
      trick = { leader: best.seat, plays: [] };
      seat = best.seat;
    } else seat = nextActive(seat, v.sittingOut);
    const sv = { seat, hand: hands[seat], trick, tricks, trump, maker: v.maker, sittingOut: v.sittingOut, dealer: v.dealer, turnedDown };
    // in a rollout each seat knows its own hand; it doesn't peek at the others
    card = heuristicPlay(sv);
  }
  const { change } = scoreHand(taken, v.maker, v.alone);
  return change[team] - change[1 - team] + 0.05 * taken[team];
}

function expertPlay(v, level, random) {
  const legal = legalPlays(v.hand, v.trick, v.trump);
  if (legal.length === 1) return legal[0];
  const info = knowledge(v);
  const samples = LEVELS[level]?.samples || 40;
  const totals = new Map(legal.map((c) => [c, 0]));
  let n = 0;
  for (let i = 0; i < samples; i++) {
    const hands = sampleHands(v, info, random);
    if (!hands) break;
    n++;
    for (const c of legal) totals.set(c, totals.get(c) + rollout(v, hands, c));
  }
  if (!n) return heuristicPlay(v, info);
  // ties go to the normal player's choice
  const pref = heuristicPlay(v, info);
  let best = pref;
  let bestV = totals.get(pref);
  for (const [c, t] of totals) if (t > bestV + 1e-9) [best, bestV] = [c, t];
  return best;
}

// ---------- entry point ----------
export function chooseAction(v, legal, level = 'normal', random) {
  if (!legal.length) return null;
  const L = LEVELS[level] || LEVELS.normal;
  // a seeded generator from the position keeps games repeatable for tests
  random ||= seeded((v.round || 1) * 7919 + (v.seat ?? 0) * 104729 + (v.tricks?.length || 0) * 31 + (v.trick?.plays.length || 0) + hashCards(v.hand));
  const pick = (a) => legal.find((x) => x.type === a.type && (x.card ?? null) === (a.card ?? null) && (x.suit ?? null) === (a.suit ?? null) && !!x.alone === !!a.alone);
  switch (v.phase) {
    case 'order':
    case 'call': {
      const a = bidChoice(v, level, random);
      return pick(a) || pick({ ...a, alone: false }) || legal.find((x) => x.type === 'pass') || legal[0];
    }
    case 'discard':
      return pick({ type: 'discard', card: bestDiscard(v.hand, v.trump) }) || legal[0];
    case 'play': {
      let card;
      if (L.random && random() < L.random) {
        const cards = legal.map((a) => a.card);
        card = cards[Math.floor(random() * cards.length)];
      } else if (L.samples) card = expertPlay(v, level, random);
      else card = heuristicPlay(v);
      return pick({ type: 'play', card }) || legal[0];
    }
    default:
      return legal[0];
  }
}

function hashCards(cards = []) {
  let x = 0;
  for (const c of cards) for (const ch of c) x = (x * 31 + ch.charCodeAt(0)) >>> 0;
  return x;
}

// For the coach: what would the normal player do here?
export function suggest(v, legal) {
  return chooseAction(v, legal, 'hard');
}
