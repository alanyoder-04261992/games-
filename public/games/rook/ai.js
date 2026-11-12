// Computer players for Rook. They only ever see a view() of the game, never the full state.
//
// How they think:
//   * Card play: Monte Carlo. Deal the unseen cards out many times in ways that fit what the
//     table has shown (who is out of which color, who took the bid), play each candidate card
//     and finish the round with a fast rule-of-thumb player, and keep the card with the best
//     average score swing. If the rule-of-thumb card is about as good, play that (looks natural).
//   * Bidding: practice deals. Pick up a random nest, bury, pick trump, play it out, and bid up to
//     what the hand makes often enough. Reads partner support, opponents' jumps and the score.
//   * Burying: compare several trump/discard plans the same way.
import {
  BIRD,
  COLORS,
  LAST_TRICK_BONUS,
  MIN_BID,
  allBids,
  cardPoints,
  colorOf,
  fullDeck,
  handSize,
  isTrump,
  partnerOf,
  rankOf,
  strength,
  suitOf,
  teamOf,
} from './engine.js';

export const LEVELS = {
  easy: { label: 'Easy', playSamples: 0, bidSamples: 50, makeChance: 0.75, noise: 0.25, discardSamples: 0 },
  normal: { label: 'Normal', playSamples: 36, bidSamples: 140, makeChance: 0.62, noise: 0, discardSamples: 30 },
  hard: { label: 'Expert', playSamples: 110, bidSamples: 260, makeChance: 0.6, noise: 0, discardSamples: 70 },
};

// ---- small seeded rng so bots are reproducible per decision ----
function makeRng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(a, rnd) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function hashView(v) {
  let h = 2166136261;
  const s = `${v.round}|${v.seat}|${v.phase}|${v.hand.join()}|${v.tricks.length}|${v.trick?.plays.length ?? 0}|${v.bidding?.log.length}`;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// ---------- entry point ----------
export function chooseAction(view, legalActions, level = 'normal') {
  const cfg = LEVELS[level] || LEVELS.normal;
  const rnd = makeRng(hashView(view) ^ (Math.random() * 1e9));
  if (legalActions.length === 1 && legalActions[0].type !== 'discard') return legalActions[0];
  switch (view.phase) {
    case 'score':
      return { type: 'ready' };
    case 'bid':
      return chooseBid(view, legalActions, cfg, rnd);
    case 'gift':
      return { type: 'give', card: chooseGift(view.hand) };
    case 'discard':
      return { type: 'discard', cards: chooseDiscard(view, cfg, rnd).discard };
    case 'play':
      return choosePlay(view, legalActions, cfg, rnd);
    default:
      return legalActions[0];
  }
}

// A one-line explanation used by the Hint button.
export function hint(view, legalActions) {
  const action = chooseAction(view, legalActions, 'hard');
  return action;
}

// =====================================================================
// Card tables (precomputed per trump for speed)
// =====================================================================
const POINTS = new Map();
function pts(c) {
  let p = POINTS.get(c);
  if (p === undefined) POINTS.set(c, (p = cardPoints(c)));
  return p;
}

// =====================================================================
// Fast simulator used for rollouts
// =====================================================================
// sim: { hands[4], trump, plays[{seat,card}], turn, sittingOut, points[2], tricksLeft,
//        bidder, amount, solo, buried (points in discards), lastWinner }
function simSuit(c, trump) {
  return c === BIRD ? trump : colorOf(c);
}

function simLegal(sim, seat) {
  const hand = sim.hands[seat];
  if (!sim.plays.length) return hand;
  const led = simSuit(sim.plays[0].card, sim.trump);
  const f = hand.filter((c) => simSuit(c, sim.trump) === led);
  return f.length ? f : hand;
}

function beats(a, b, led, trump) {
  // does card a beat card b (b currently winning) given led suit
  const ta = isTrump(a, trump), tb = isTrump(b, trump);
  if (ta && !tb) return true;
  if (!ta && tb) return false;
  if (ta && tb) return strength(a, trump) > strength(b, trump);
  if (colorOf(a) !== led) return false;
  if (colorOf(b) !== led) return true;
  return strength(a, trump) > strength(b, trump);
}

function currentWinner(plays, trump) {
  const led = simSuit(plays[0].card, trump);
  let w = plays[0];
  for (let i = 1; i < plays.length; i++) if (beats(plays[i].card, w.card, led, trump)) w = plays[i];
  return w;
}

function nextActive(sim, seat) {
  let n = (seat + 1) % 4;
  if (n === sim.sittingOut) n = (n + 1) % 4;
  return n;
}

function simPlay(sim, seat, card, trumpChoice) {
  const h = sim.hands[seat];
  h.splice(h.indexOf(card), 1);
  if (sim.trump == null) sim.trump = card === BIRD ? trumpChoice : colorOf(card);
  sim.plays.push({ seat, card });
  const size = sim.sittingOut == null ? 4 : 3;
  if (sim.plays.length < size) {
    sim.turn = nextActive(sim, seat);
    return;
  }
  const w = currentWinner(sim.plays, sim.trump).seat;
  let p = 0;
  for (const pl of sim.plays) p += pts(pl.card);
  sim.points[teamOf(w)] += p;
  sim.plays = [];
  sim.tricksLeft--;
  sim.lastWinner = w;
  sim.turn = w;
  if (sim.tricksLeft === 0) sim.points[teamOf(w)] += LAST_TRICK_BONUS + (sim.solo ? 0 : sim.buried);
}

function rollout(sim) {
  while (sim.tricksLeft > 0) {
    const seat = sim.turn;
    const choice = policy(sim, seat);
    simPlay(sim, seat, choice.card, choice.trump);
  }
  return sim.points;
}

function utility(points, sim, team) {
  const bidTeam = teamOf(sim.bidder);
  const other = 1 - bidTeam;
  let made;
  if (sim.solo) made = points[other] === 0;
  else made = points[bidTeam] >= sim.amount;
  const change = [0, 0];
  change[bidTeam] = made ? (sim.solo ? sim.amount : points[bidTeam]) : -sim.amount;
  change[other] = points[other];
  return change[team] - change[1 - team];
}

function cloneSim(sim) {
  return {
    ...sim,
    hands: sim.hands.map((h) => h.slice()),
    plays: sim.plays.slice(),
    points: sim.points.slice(),
  };
}

// ---------------------------------------------------------------------
// Rule-of-thumb player (perfect information inside one sampled world)
// ---------------------------------------------------------------------
function cost(c, trump) {
  // how "expensive" a card is to throw away: trumps and point cards are dear
  return (isTrump(c, trump) ? 60 : 0) + strength(c, trump) + pts(c) * 2.2;
}

function bestTrumpColor(hand) {
  let best = COLORS[0], bestScore = -1;
  for (const col of COLORS) {
    let s = 0;
    for (const c of hand) {
      if (c === BIRD) continue;
      if (colorOf(c) !== col) continue;
      const r = rankOf(c);
      s += 10 + (r === 1 ? 9 : r === 14 ? 6 : r === 13 ? 4 : r >= 11 ? 2 : r === 10 ? 1 : 0);
    }
    if (s > bestScore) [best, bestScore] = [col, s];
  }
  return best;
}

function remainingCanBeat(sim, seat, card) {
  // could any later player in this trick beat `card` (assuming card would be winning)?
  const size = sim.sittingOut == null ? 4 : 3;
  const led = sim.plays.length ? simSuit(sim.plays[0].card, sim.trump) : simSuit(card, sim.trump);
  let s = seat;
  for (let k = sim.plays.length + 1; k < size; k++) {
    s = nextActive(sim, s);
    if (teamOf(s) === teamOf(seat)) continue;
    const hand = sim.hands[s];
    const follow = hand.filter((c) => simSuit(c, sim.trump) === led);
    const options = follow.length ? follow : hand;
    if (options.some((c) => beats(c, card, led, sim.trump))) return true;
  }
  return false;
}

function policy(sim, seat) {
  const legal = simLegal(sim, seat);
  const trump = sim.trump;
  if (legal.length === 1) {
    const c = legal[0];
    return { card: c, trump: c === BIRD && trump == null ? bestTrumpColor(sim.hands[seat]) : undefined };
  }
  const myTeam = teamOf(seat);
  const bidTeam = teamOf(sim.bidder);

  // ---- leading ----
  if (!sim.plays.length) {
    if (trump == null) {
      const col = bestTrumpColor(sim.hands[seat]);
      const trumps = legal.filter((c) => c === BIRD || colorOf(c) === col);
      trumps.sort((a, b) => strength(b, col) - strength(a, col));
      const c = trumps[0];
      return { card: c, trump: c === BIRD ? col : undefined };
    }
    const myTrumps = legal.filter((c) => isTrump(c, trump));
    const oppHaveTrump = [0, 1, 2, 3].some(
      (s) => s !== sim.sittingOut && teamOf(s) !== myTeam && sim.hands[s].some((c) => isTrump(c, trump)),
    );
    const allOtherTrumps = [];
    for (let s = 0; s < 4; s++) if (s !== seat) for (const c of sim.hands[s]) if (isTrump(c, trump)) allOtherTrumps.push(c);
    const topOther = allOtherTrumps.reduce((m, c) => Math.max(m, strength(c, trump)), -1);
    if (myTeam === bidTeam && oppHaveTrump && myTrumps.length) {
      myTrumps.sort((a, b) => strength(b, trump) - strength(a, trump));
      if (strength(myTrumps[0], trump) > topOther) return { card: myTrumps[0] };
      // draw with the highest no-point trump to force the top trump out
      const noPt = myTrumps.filter((c) => pts(c) === 0);
      if (noPt.length) return { card: noPt[0] };
      return { card: myTrumps[myTrumps.length - 1] };
    }
    // cash a sure side winner
    const sure = legal.filter((c) => !isTrump(c, trump) && !remainingCanBeatLead(sim, seat, c));
    if (sure.length) {
      sure.sort((a, b) => pts(b) - pts(a) || strength(b, trump) - strength(a, trump));
      return { card: sure[0] };
    }
    if (myTrumps.length && myTrumps.length === legal.length) {
      myTrumps.sort((a, b) => strength(b, trump) - strength(a, trump));
      return { card: strength(myTrumps[0], trump) > topOther ? myTrumps[0] : myTrumps[myTrumps.length - 1] };
    }
    // lead low from a side color, avoid point cards
    const side = legal.filter((c) => !isTrump(c, trump));
    const pool = side.length ? side : legal;
    pool.sort((a, b) => cost(a, trump) - cost(b, trump));
    return { card: pool[0] };
  }

  // ---- following ----
  const size = sim.sittingOut == null ? 4 : 3;
  const isLast = sim.plays.length === size - 1;
  const winning = currentWinner(sim.plays, trump);
  const led = simSuit(sim.plays[0].card, trump);
  let trickPts = 0;
  for (const p of sim.plays) trickPts += pts(p.card);
  const partnerWinning = teamOf(winning.seat) === myTeam;

  if (partnerWinning) {
    const safe = isLast || !remainingCanBeat(sim, seat, winning.card);
    if (safe) {
      // smear points on partner's trick
      const sorted = [...legal].sort((a, b) => pts(b) - pts(a) || cost(a, trump) - cost(b, trump));
      if (pts(sorted[0]) > 0) return { card: sorted[0] };
    }
    const sorted = [...legal].sort((a, b) => cost(a, trump) - cost(b, trump));
    return { card: sorted[0] };
  }

  const winners = legal.filter((c) => beats(c, winning.card, led, trump));
  if (winners.length) {
    winners.sort((a, b) => cost(a, trump) - cost(b, trump));
    if (isLast) {
      if (trickPts > 0 || pts(winners[0]) > 0 || !isTrump(winners[0], trump)) return { card: winners[0] };
    } else {
      const holding = winners.filter((c) => !remainingCanBeat(sim, seat, c));
      if (holding.length && (trickPts > 0 || holding.some((c) => pts(c) > 0) || !isTrump(holding[0], trump))) {
        // prefer a holding winner that also banks points
        holding.sort((a, b) => cost(a, trump) - pts(a) * 3 - (cost(b, trump) - pts(b) * 3));
        return { card: holding[0] };
      }
      if (trickPts >= 15) return { card: winners[winners.length - 1] };
    }
  }
  // duck: cheapest card, avoid giving points
  const sorted = [...legal].sort((a, b) => pts(a) * 4 + cost(a, trump) - (pts(b) * 4 + cost(b, trump)));
  return { card: sorted[0] };
}

function remainingCanBeatLead(sim, seat, card) {
  const led = simSuit(card, sim.trump);
  for (let s = 0; s < 4; s++) {
    if (s === seat || s === sim.sittingOut || teamOf(s) === teamOf(seat)) continue;
    const hand = sim.hands[s];
    const follow = hand.filter((c) => simSuit(c, sim.trump) === led);
    const options = follow.length ? follow : hand;
    if (options.some((c) => beats(c, card, led, sim.trump))) return true;
  }
  return false;
}

// =====================================================================
// Inference: what's unseen and who could hold it
// =====================================================================
function playedCards(view) {
  const out = [];
  for (const t of view.tricks) for (const p of t.plays) out.push(p.card);
  if (view.trick) for (const p of view.trick.plays) out.push(p.card);
  return out;
}

function voidsFromTricks(view) {
  const voids = [new Set(), new Set(), new Set(), new Set()];
  const all = [...view.tricks];
  if (view.trick && view.trick.plays.length) all.push(view.trick);
  for (const t of all) {
    const led = suitOf(t.plays[0].card, view.trump);
    for (const p of t.plays.slice(1)) {
      if (suitOf(p.card, view.trump) !== led) voids[p.seat].add(led);
    }
  }
  return voids;
}

// Build a sampler that deals the unseen cards to the other seats.
function makeSampler(view, rnd) {
  const deck = fullDeck(view.options);
  const known = new Set([...view.hand, ...playedCards(view), ...view.myDiscards]);
  const unseen = deck.filter((c) => !known.has(c));
  const voids = voidsFromTricks(view);
  const sizes = view.handSizes.slice();
  const me = view.seat;
  const others = [0, 1, 2, 3].filter((s) => s !== me && sizes[s] > 0);
  const bidder = view.contract?.bidder;
  const trump = view.trump;

  return function sample() {
    for (let attempt = 0; attempt < 30; attempt++) {
      const pool = shuffle(unseen.slice(), rnd);
      const hands = [[], [], [], []];
      hands[me] = view.hand.slice();
      const room = sizes.slice();
      room[me] = 0;
      let hiddenRoom = pool.length - others.reduce((a, s) => a + room[s], 0);
      let ok = true;
      // place most-constrained cards first: trumps (bidder bias) then the rest
      for (const c of pool) {
        const suit = trump == null ? null : suitOf(c, trump);
        const cands = [];
        let total = 0;
        for (const s of others) {
          if (room[s] <= 0) continue;
          if (suit && voids[s].has(suit)) continue;
          let w = room[s];
          if (trump && s === bidder && isTrump(c, trump)) w *= 2.4;
          cands.push([s, w]);
          total += w;
        }
        if (hiddenRoom > 0) {
          cands.push([-1, hiddenRoom * (trump && isTrump(c, trump) ? 0.55 : 1)]);
          total += hiddenRoom * (trump && isTrump(c, trump) ? 0.55 : 1);
        }
        if (!cands.length) {
          ok = false;
          break;
        }
        let r = rnd() * total;
        let pick = cands[cands.length - 1][0];
        for (const [s, w] of cands) {
          if ((r -= w) <= 0) {
            pick = s;
            break;
          }
        }
        if (pick === -1) hiddenRoom--;
        else {
          hands[pick].push(c);
          room[pick]--;
        }
      }
      if (ok) return hands;
    }
    // give up on constraints
    const pool = shuffle(unseen.slice(), rnd);
    const hands = [[], [], [], []];
    hands[me] = view.hand.slice();
    let i = 0;
    for (const s of others) hands[s] = pool.slice(i, (i += sizes[s]));
    return hands;
  };
}

function buriedPoints(view) {
  // Points sitting in the discards. Known to the bidder; others guess the average.
  if (view.contract?.solo) return 0;
  if (view.myDiscards.length) return view.myDiscards.reduce((s, c) => s + pts(c), 0);
  return 12;
}

function simFromView(view, hands) {
  const total = handSize(view.options);
  return {
    hands,
    trump: view.trump,
    plays: view.trick.plays.slice(),
    turn: view.turn,
    sittingOut: view.sittingOut,
    points: view.points.slice(),
    tricksLeft: total - view.tricks.length,
    bidder: view.contract.bidder,
    amount: view.contract.amount,
    solo: view.contract.solo,
    buried: buriedPoints(view),
  };
}

// =====================================================================
// Card play
// =====================================================================
function choosePlay(view, legalActions, cfg, rnd) {
  const sampler = makeSampler(view, rnd);
  const team = teamOf(view.seat);
  // natural move from the rule of thumb, using one sample for hidden hands
  const naturalWorld = sampler();
  const natSim = simFromView(view, naturalWorld);
  const nat = policy(natSim, view.seat);
  const natKey = nat.card + '|' + (nat.trump || '');
  const keyOf = (a) => a.card + '|' + (a.trump || '');

  if (!cfg.playSamples) {
    if (cfg.noise && rnd() < cfg.noise) return legalActions[Math.floor(rnd() * legalActions.length)];
    return legalActions.find((a) => keyOf(a) === natKey) || legalActions[0];
  }

  // Avoid testing all 4 trump names for a Bird lead: try the two best colors.
  let candidates = legalActions;
  if (view.trump == null) {
    const ranked = [...COLORS].sort((a, b) => colorScore(view.hand, b) - colorScore(view.hand, a));
    const keep = new Set(ranked.slice(0, 2));
    candidates = legalActions.filter((a) => a.card !== BIRD || keep.has(a.trump));
  }

  const worlds = [];
  for (let i = 0; i < cfg.playSamples; i++) worlds.push(sampler());
  let best = null, bestScore = -Infinity;
  const scores = new Map();
  for (const a of candidates) {
    let total = 0;
    for (const w of worlds) {
      const sim = simFromView(view, w.map((h) => h.slice()));
      simPlay(sim, view.seat, a.card, a.trump);
      total += utility(rollout(sim), sim, team);
    }
    const avg = total / worlds.length;
    scores.set(keyOf(a), avg);
    if (avg > bestScore) [best, bestScore] = [a, avg];
  }
  const natScore = scores.get(natKey);
  if (natScore !== undefined && natScore >= bestScore - 3) return candidates.find((a) => keyOf(a) === natKey);
  return best;
}

function colorScore(hand, col) {
  let s = 0;
  for (const c of hand) {
    if (c === BIRD) {
      s += 8;
      continue;
    }
    if (colorOf(c) !== col) continue;
    const r = rankOf(c);
    s += 10 + (r === 1 ? 9 : r === 14 ? 6 : r === 13 ? 4 : r >= 11 ? 2 : 0);
  }
  return s;
}

// =====================================================================
// Burying (discarding from the nest)
// =====================================================================
function keepValue(card, trump, hand) {
  if (isTrump(card, trump)) return 1000 + strength(card, trump);
  const col = colorOf(card);
  const r = rankOf(card);
  const sameColor = hand.filter((c) => c !== BIRD && colorOf(c) === col && !isTrump(c, trump));
  const hasOne = sameColor.some((c) => rankOf(c) === 1);
  let v = strength(card, trump) * 3;
  if (r === 1) v += 120;
  if (r === 14 && hasOne) v += 70;
  if (r === 13 && hasOne && sameColor.some((c) => rankOf(c) === 14)) v += 40;
  // short colors are better thrown away entirely (voids let you trump in)
  v -= Math.max(0, 4 - sameColor.length) * 6;
  // losing point cards: keep out of opponents' reach by burying them
  if (pts(card) > 0 && r !== 1 && !(r === 14 && hasOne)) v -= 25;
  return v;
}

function planDiscard(hand, trump, n) {
  const ranked = [...hand].sort((a, b) => keepValue(a, trump, hand) - keepValue(b, trump, hand));
  return ranked.slice(0, n);
}

export function suggestDiscard(view) {
  return chooseDiscard(view, LEVELS.normal, makeRng(hashView(view))).discard;
}

function chooseDiscard(view, cfg, rnd) {
  const n = view.discardCount;
  const hand = view.hand;
  const colors = [...COLORS].sort((a, b) => colorScore(hand, b) - colorScore(hand, a));
  const plans = [];
  for (const col of colors.slice(0, cfg.discardSamples ? 3 : 1)) {
    const d = planDiscard(hand, col, n);
    plans.push({ trump: col, discard: d });
    // a variant that keeps points instead of burying them
    const alt = [...hand]
      .filter((c) => !isTrump(c, col))
      .sort((a, b) => strength(a, col) + pts(a) * 3 - (strength(b, col) + pts(b) * 3))
      .slice(0, n);
    if (alt.length === n && alt.join() !== d.join()) plans.push({ trump: col, discard: alt });
  }
  if (!cfg.discardSamples || plans.length === 1) return plans[0];

  const deck = fullDeck(view.options);
  const mine = new Set(hand);
  const unseen = deck.filter((c) => !mine.has(c));
  const others = [0, 1, 2, 3].filter((s) => s !== view.seat && s !== view.sittingOut);
  const size = handSize(view.options);
  const worlds = [];
  for (let i = 0; i < cfg.discardSamples; i++) {
    const pool = shuffle(unseen.slice(), rnd);
    const hands = [[], [], [], []];
    let k = 0;
    for (const s of others) hands[s] = pool.slice(k, (k += size));
    worlds.push(hands);
  }
  let best = plans[0], bestScore = -Infinity;
  const team = teamOf(view.seat);
  for (const plan of plans) {
    const keep = hand.filter((c) => !plan.discard.includes(c));
    let total = 0;
    for (const w of worlds) {
      const hands = w.map((h) => h.slice());
      hands[view.seat] = keep.slice();
      const sim = {
        hands,
        trump: null,
        plays: [],
        turn: view.seat,
        sittingOut: view.sittingOut,
        points: [0, 0],
        tricksLeft: size,
        bidder: view.seat,
        amount: view.contract.amount,
        solo: view.contract.solo,
        buried: plan.discard.reduce((s, c) => s + pts(c), 0),
      };
      // lead the planned trump
      const trumps = keep.filter((c) => c === BIRD || colorOf(c) === plan.trump);
      const lead = trumps.sort((a, b) => strength(b, plan.trump) - strength(a, plan.trump))[0] || keep[0];
      simPlay(sim, view.seat, lead, lead === BIRD ? plan.trump : undefined);
      total += utility(rollout(sim), sim, team);
    }
    const avg = total / worlds.length;
    if (avg > bestScore) [best, bestScore] = [plan, avg];
  }
  return best;
}

// =====================================================================
// Bidding
// =====================================================================
function simulateHand(view, cfg, rnd, { solo = 0 } = {}) {
  // Returns the list of points the bidding team takes over practice deals if we win the bid.
  const deck = fullDeck(view.options);
  const mine = new Set(view.hand);
  const unseen = deck.filter((c) => !mine.has(c));
  const size = handSize(view.options);
  const me = view.seat;
  const partner = partnerOf(me);
  const results = [];
  const samples = solo ? Math.ceil(cfg.bidSamples / 2) : cfg.bidSamples;
  for (let i = 0; i < samples; i++) {
    const pool = shuffle(unseen.slice(), rnd);
    const hands = [[], [], [], []];
    let k = 0;
    for (let s = 0; s < 4; s++) {
      if (s === me) continue;
      hands[s] = pool.slice(k, (k += size));
    }
    const nest = pool.slice(k, k + 5);
    let mineNow = [...view.hand];
    let sittingOut = null;
    if (solo === 800) {
      sittingOut = partner;
    } else if (solo === 400) {
      sittingOut = partner;
      mineNow.push(chooseGift(hands[partner]), ...nest);
    } else mineNow.push(...nest);
    if (sittingOut != null) hands[partner] = [];
    const n = mineNow.length - size;
    const trump = bestTrumpColor(mineNow.filter((c) => c !== BIRD).length ? mineNow : view.hand);
    const discard = n > 0 ? planDiscard(mineNow, trump, n) : [];
    hands[me] = mineNow.filter((c) => !discard.includes(c));
    const sim = {
      hands,
      trump: null,
      plays: [],
      turn: me,
      sittingOut,
      points: [0, 0],
      tricksLeft: size,
      bidder: me,
      amount: solo || 100,
      solo: !!solo,
      buried: discard.reduce((s, c) => s + pts(c), 0),
    };
    const trumps = hands[me].filter((c) => c === BIRD || colorOf(c) === trump);
    const lead = trumps.sort((a, b) => strength(b, trump) - strength(a, trump))[0] || hands[me][0];
    simPlay(sim, me, lead, lead === BIRD ? trump : undefined);
    const p = rollout(sim);
    results.push({ us: p[teamOf(me)], them: p[1 - teamOf(me)] });
  }
  return results;
}

function chooseBid(view, legalActions, cfg, rnd) {
  const canPass = legalActions.some((a) => a.type === 'pass');
  const high = view.bidding.high;
  const me = view.seat;
  const myTeam = teamOf(me);
  const results = simulateHand(view, cfg, rnd);
  const us = results.map((r) => r.us).sort((a, b) => b - a);
  // the highest bid that the hand makes at least makeChance of the time
  const idx = Math.max(0, Math.floor(us.length * cfg.makeChance) - 1);
  let limit = Math.floor(us[idx] / 5) * 5;

  // read the table
  const log = view.bidding.log;
  const partner = partnerOf(me);
  const partnerBids = log.filter((e) => e.seat === partner && e.type === 'bid');
  const oppBids = log.filter((e) => teamOf(e.seat) !== myTeam && e.type === 'bid');
  if (partnerBids.some((e) => e.amount > 100)) limit += 10;
  if (partnerBids.some((e) => e.amount >= 170)) limit += 10;
  if (oppBids.some((e) => e.amount >= 170)) limit -= 10;
  if (cfg.noise) limit += Math.round((rnd() - 0.5) * 20);

  // near the finish, defend unless the bid is very safe
  const need = view.options.winScore - view.scores[myTeam];
  if (need <= 30) {
    const safe = us.filter((p) => p >= MIN_BID).length / us.length;
    if (safe < 0.97 && canPass) return { type: 'pass' };
  }

  // solo bids, only for monsters
  if (!cfg.noise) {
    const strong = us[Math.floor(us.length * 0.5)] >= 170;
    if (strong) {
      for (const amount of [800, 400]) {
        if (high && high.amount >= amount) continue;
        const solo = simulateHand(view, cfg, rnd, { solo: amount });
        const clean = solo.filter((r) => r.them === 0).length / solo.length;
        if (clean >= (amount === 800 ? 0.995 : 0.97)) return { type: 'bid', amount };
      }
    }
  }

  const partnerHigh = high && high.seat === partner;
  const oppsOut = [0, 1, 2, 3].filter((s) => teamOf(s) !== myTeam).every((s) => view.bidding.passed[s]);
  if (partnerHigh && (oppsOut || limit < high.amount + 20) && canPass) return { type: 'pass' };

  const minNext = high ? high.amount + 5 : MIN_BID;
  if (!canPass) return { type: 'bid', amount: Math.max(MIN_BID, Math.min(limit, 200)) };
  if (limit < minNext || minNext > 200) return { type: 'pass' };

  // opening jumps say "I'm strong" to partner
  let amount = minNext;
  if (!high || high.amount < 150) {
    if (limit >= 185) amount = Math.max(amount, 170);
    else if (limit >= 170) amount = Math.max(amount, 160);
    else if (limit >= 155) amount = Math.max(amount, 150);
  }
  amount = Math.min(amount, limit, 200);
  if (!allBids().includes(amount) || amount < minNext) return { type: 'pass' };
  return { type: 'bid', amount };
}

// =====================================================================
// Gift (partner of a 400 bidder)
// =====================================================================
function chooseGift(hand) {
  const order = (c) => {
    if (c === BIRD) return 100;
    const r = rankOf(c);
    return r === 1 ? 90 : r === 14 ? 70 : r === 13 ? 50 : r;
  };
  return [...hand].sort((a, b) => order(b) - order(a))[0];
}
