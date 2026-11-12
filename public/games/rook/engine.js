// Rook rules engine. Pure and deterministic: (state, action) -> new state.
// The Game Center runs this on the host only; every other player gets a view().
//
// House rules (carried over from the original card-game app):
//   * 45 cards: red, green, yellow, black 5-14 and 1, plus the Bird. The 1 is high.
//     Optional short deck drops the 6s, 7s and 8s (33 cards).
//   * 4 players, partners across. 10 cards each (7 with the short deck), 5 in the nest.
//   * Bidding from 100 in 5s to 200, plus solo bids of 400 and 800. Dealer is stuck if all pass.
//   * The bidder's first lead sets trump. Leading the Bird means naming the color.
//   * The Bird is trump, ranked between the 10 and the 11.
//   * Points: 5s=5, 10s=10, 14s=10, 1s=15, Bird=20, last trick 20 (+ the discards).
//   * Made: score what you took. Set: lose the bid. Solo: the other team must take nothing.
//   * First team to 1000 wins.

export const COLORS = ['red', 'green', 'yellow', 'black'];
export const BIRD = 'bird';
const RANKS_FULL = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 1];
const RANKS_SHORT = [5, 9, 10, 11, 12, 13, 14, 1];
// Strength order, low to high. Trump order places the Bird between 10 and 11.
const PLAIN_ORDER = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 1];
const TRUMP_ORDER = [5, 6, 7, 8, 9, 10, BIRD, 11, 12, 13, 14, 1];
const POINTS = { 5: 5, 10: 10, 14: 10, 1: 15 };
export const BIRD_POINTS = 20;
export const NEST_SIZE = 5;
export const MIN_BID = 100;
export const MAX_BID = 200;
export const BID_STEP = 5;
export const SOLO_BIDS = [400, 800];
export const LAST_TRICK_BONUS = 20;
export const SEAT_NAMES = ['South', 'West', 'North', 'East'];

export const DEFAULT_OPTIONS = { lowCards: true, winScore: 1000 };

// ---------- cards ----------
export const colorOf = (c) => (c === BIRD ? null : c.slice(0, c.indexOf('-')));
export const rankOf = (c) => (c === BIRD ? null : Number(c.slice(c.indexOf('-') + 1)));
export const suitOf = (c, trump) => (c === BIRD ? trump : colorOf(c));
export const cardPoints = (c) => (c === BIRD ? BIRD_POINTS : POINTS[rankOf(c)] || 0);
export const sumPoints = (cards) => cards.reduce((s, c) => s + cardPoints(c), 0);
export const isTrump = (c, trump) => c === BIRD || (trump != null && colorOf(c) === trump);

export function strength(card, trump) {
  if (isTrump(card, trump)) return 100 + TRUMP_ORDER.indexOf(card === BIRD ? BIRD : rankOf(card));
  return PLAIN_ORDER.indexOf(rankOf(card));
}

export function fullDeck(options = DEFAULT_OPTIONS) {
  const ranks = options.lowCards ? RANKS_FULL : RANKS_SHORT;
  const deck = [];
  for (const color of COLORS) for (const r of ranks) deck.push(`${color}-${r}`);
  deck.push(BIRD);
  return deck;
}

const SORT_INDEX = new Map(fullDeck({ lowCards: true }).map((c, i) => [c, i]));
// Sort a hand by color then rank, high cards on the right. With trump known, trump goes last
// and the Bird sits inside it in its true order.
export function sortHand(cards, trump = null) {
  const colorRank = (c) => {
    const col = suitOf(c, trump);
    if (col == null) return 4; // Bird before trump is known: far right
    if (col === trump) return 5;
    return COLORS.indexOf(col);
  };
  return [...cards].sort((a, b) => {
    const ca = colorRank(a), cb = colorRank(b);
    if (ca !== cb) return ca - cb;
    if (trump != null && ca === 5) return strength(a, trump) - strength(b, trump);
    return (SORT_INDEX.get(a) ?? 99) - (SORT_INDEX.get(b) ?? 99);
  });
}

// ---------- seats ----------
export const teamOf = (seat) => seat % 2;
export const partnerOf = (seat) => (seat + 2) % 4;
export const nextSeat = (seat) => (seat + 1) % 4;
export const handSize = (options) => (options.lowCards ? 10 : 7);

// ---------- rng (mulberry32, state kept in the game state) ----------
function rand(state) {
  let t = (state.rng = (state.rng + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function shuffleInto(state, items) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand(state) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function allBids() {
  const bids = [];
  for (let b = MIN_BID; b <= MAX_BID; b += BID_STEP) bids.push(b);
  return [...bids, ...SOLO_BIDS];
}

// ---------- setup ----------
export function setup({ seed = Date.now(), options = {}, firstDealer } = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const state = {
    v: 1,
    options: opts,
    rng: seed >>> 0,
    round: 0,
    dealer: 0,
    scores: [0, 0],
    history: [],
    winner: null,
    lastRound: null,
    lastTrick: null,
  };
  const dealer = Number.isInteger(firstDealer) ? firstDealer : Math.floor(rand(state) * 4);
  deal(state, dealer);
  return state;
}

function deal(state, dealer) {
  const size = handSize(state.options);
  let hands, nest, redeals = -1;
  do {
    redeals++;
    const deck = shuffleInto(state, fullDeck(state.options));
    hands = [0, 1, 2, 3].map((s) => sortHand(deck.slice(s * size, (s + 1) * size)));
    nest = deck.slice(4 * size);
  } while (hands.some((h) => sumPoints(h) === 0));
  Object.assign(state, {
    round: state.round + 1,
    dealer,
    redeals,
    phase: 'bid',
    turn: nextSeat(dealer),
    hands,
    nest,
    dealt: { hands: hands.map((h) => [...h]), nest: [...nest] },
    bidding: { high: null, passed: [false, false, false, false], log: [] },
    contract: null,
    sittingOut: null,
    gift: null,
    discards: [],
    dead: [],
    trump: null,
    trick: null,
    tricks: [],
    points: [0, 0],
    ready: [false, false, false, false],
  });
}

// ---------- rules queries ----------
export function discardCount(state) {
  return state.hands[state.contract.bidder].length - handSize(state.options);
}

// Seats that may act right now.
export function actors(state) {
  if (state.phase === 'over') return [];
  if (state.phase === 'score') return [0, 1, 2, 3].filter((s) => !state.ready[s]);
  return state.turn == null ? [] : [state.turn];
}

export function legal(state, seat) {
  if (!actors(state).includes(seat)) return [];
  switch (state.phase) {
    case 'bid': {
      const { high, passed } = state.bidding;
      const out = [];
      const stuck = !high && passed.filter(Boolean).length === 3;
      if (!stuck) out.push({ type: 'pass' });
      for (const amount of allBids()) if (!high || amount > high.amount) out.push({ type: 'bid', amount });
      return out;
    }
    case 'gift':
      return state.hands[seat].map((card) => ({ type: 'give', card }));
    case 'discard':
      return [{ type: 'discard', count: discardCount(state) }];
    case 'play':
      return legalPlays(state, seat).flatMap((card) =>
        card === BIRD && state.trump == null
          ? COLORS.map((trump) => ({ type: 'play', card, trump }))
          : [{ type: 'play', card }],
      );
    case 'score':
      return [{ type: 'ready' }];
    default:
      return [];
  }
}

// Cards this seat may play to the current trick.
export function legalPlays(state, seat) {
  const hand = state.hands[seat];
  const plays = state.trick.plays;
  if (plays.length === 0) return [...hand];
  const led = suitOf(plays[0].card, state.trump);
  const follow = hand.filter((c) => suitOf(c, state.trump) === led);
  return follow.length ? follow : [...hand];
}

// Returns null when fine, otherwise a reason.
export function check(state, seat, action) {
  if (!action || typeof action !== 'object') return 'Bad action';
  if (!actors(state).includes(seat)) return 'Not your turn';
  if (state.phase === 'discard') {
    if (action.type !== 'discard') return 'Choose cards to discard';
    const n = discardCount(state);
    const cards = action.cards;
    if (!Array.isArray(cards) || cards.length !== n) return `Discard exactly ${n} cards`;
    if (new Set(cards).size !== n) return 'Duplicate card';
    if (cards.some((c) => !state.hands[seat].includes(c))) return 'Card not in hand';
    return null;
  }
  const key = (a) => `${a.type}|${a.amount ?? ''}|${a.card ?? ''}|${a.trump ?? ''}`;
  return legal(state, seat).some((a) => key(a) === key(action)) ? null : 'That move is not allowed';
}

export function trickWinner(plays, trump) {
  const led = suitOf(plays[0].card, trump);
  let best = plays[0];
  const score = (p) => {
    const s = suitOf(p.card, trump);
    if (s === trump) return 1000 + strength(p.card, trump);
    return s === led ? strength(p.card, trump) : -1;
  };
  for (const p of plays) if (score(p) > score(best)) best = p;
  return best.seat;
}

// ---------- apply ----------
export function apply(prev, seat, action) {
  const problem = check(prev, seat, action);
  if (problem) throw new Error(problem);
  const state = structuredClone(prev);
  switch (action.type) {
    case 'pass':
    case 'bid':
      doBid(state, seat, action);
      break;
    case 'give':
      doGive(state, seat, action.card);
      break;
    case 'discard':
      doDiscard(state, seat, action.cards);
      break;
    case 'play':
      doPlay(state, seat, action);
      break;
    case 'ready':
      state.ready[seat] = true;
      if (state.ready.every(Boolean)) deal(state, nextSeat(state.dealer));
      break;
  }
  return state;
}

function doBid(state, seat, action) {
  const b = state.bidding;
  if (action.type === 'pass') {
    b.passed[seat] = true;
    b.log.push({ seat, type: 'pass' });
  } else {
    b.high = { seat, amount: action.amount };
    b.log.push({ seat, type: 'bid', amount: action.amount });
  }
  const active = [0, 1, 2, 3].filter((s) => !b.passed[s]);
  if (b.high && (b.high.amount === 800 || (active.length === 1 && active[0] === b.high.seat))) {
    finishBidding(state);
    return;
  }
  let next = nextSeat(seat);
  while (b.passed[next]) next = nextSeat(next);
  state.turn = next;
}

function finishBidding(state) {
  const { seat: bidder, amount } = state.bidding.high;
  const partner = partnerOf(bidder);
  state.contract = { bidder, amount, solo: amount >= 400 };
  if (amount === 800) {
    state.sittingOut = partner;
    state.dead.push(...state.nest, ...state.hands[partner]);
    state.nest = [];
    state.hands[partner] = [];
    startPlay(state);
  } else if (amount === 400) {
    state.sittingOut = partner;
    state.phase = 'gift';
    state.turn = partner;
  } else {
    state.hands[bidder] = sortHand([...state.hands[bidder], ...state.nest]);
    state.nest = [];
    state.phase = 'discard';
    state.turn = bidder;
  }
}

function doGive(state, seat, card) {
  const { bidder } = state.contract;
  state.gift = card;
  state.dead.push(...state.hands[seat].filter((c) => c !== card));
  state.hands[seat] = [];
  state.hands[bidder] = sortHand([...state.hands[bidder], ...state.nest, card]);
  state.nest = [];
  state.phase = 'discard';
  state.turn = bidder;
}

function doDiscard(state, seat, cards) {
  state.hands[seat] = state.hands[seat].filter((c) => !cards.includes(c));
  state.discards = [...cards];
  startPlay(state);
}

function startPlay(state) {
  state.phase = 'play';
  state.turn = state.contract.bidder;
  state.trick = { leader: state.contract.bidder, plays: [] };
}

function doPlay(state, seat, { card, trump }) {
  state.hands[seat] = state.hands[seat].filter((c) => c !== card);
  if (state.trump == null) {
    state.trump = card === BIRD ? trump : colorOf(card);
    state.hands = state.hands.map((h) => sortHand(h, state.trump));
  }
  state.trick.plays.push({ seat, card });
  const size = state.sittingOut == null ? 4 : 3;
  if (state.trick.plays.length < size) {
    let n = nextSeat(seat);
    if (n === state.sittingOut) n = nextSeat(n);
    state.turn = n;
    return;
  }
  const winner = trickWinner(state.trick.plays, state.trump);
  const done = { ...state.trick, winner, points: sumPoints(state.trick.plays.map((p) => p.card)) };
  state.tricks.push(done);
  state.lastTrick = done;
  state.points[teamOf(winner)] += done.points;
  if (state.tricks.length === handSize(state.options)) endRound(state);
  else {
    state.trick = { leader: winner, plays: [] };
    state.turn = winner;
  }
}

export function scoreRound(state) {
  const points = [0, 0];
  for (const t of state.tricks) points[teamOf(t.winner)] += t.points;
  const lastTeam = teamOf(state.tricks[state.tricks.length - 1].winner);
  const { bidder, amount, solo } = state.contract;
  const nestPoints = solo ? 0 : sumPoints(state.discards);
  points[lastTeam] += LAST_TRICK_BONUS + nestPoints;
  const bidTeam = teamOf(bidder);
  const other = 1 - bidTeam;
  const made = solo ? points[other] === 0 : points[bidTeam] >= amount;
  const change = [0, 0];
  change[bidTeam] = made ? (solo ? amount : points[bidTeam]) : -amount;
  change[other] = points[other];
  return { points, made, change, lastTeam, nestPoints };
}

function endRound(state) {
  const r = scoreRound(state);
  state.scores = state.scores.map((s, t) => s + r.change[t]);
  const summary = {
    round: state.round,
    dealer: state.dealer,
    contract: state.contract,
    trump: state.trump,
    ...r,
    scores: [...state.scores],
    discards: state.discards,
    nest: state.dealt.nest,
    gift: state.gift,
    dealt: state.dealt.hands,
    bids: state.bidding.log,
    tricks: state.tricks.map((t) => ({ leader: t.leader, winner: t.winner, plays: t.plays })),
  };
  state.history.push({
    round: summary.round,
    contract: summary.contract,
    trump: summary.trump,
    made: summary.made,
    points: summary.points,
    change: summary.change,
    scores: summary.scores,
  });
  state.lastRound = summary;
  state.points = [...r.points];
  state.turn = null;
  state.trick = null;
  state.winner = gameWinner(state.scores, state.options.winScore);
  if (state.winner != null) state.phase = 'over';
  else {
    state.phase = 'score';
    state.ready = [false, false, false, false];
  }
}

export function gameWinner([a, b], target) {
  if (a < target && b < target) return null;
  if (a === b) return null;
  return a > b ? 0 : 1;
}

// ---------- hidden information ----------
export function view(state, seat) {
  const me = seat;
  const isBidder = state.contract?.bidder === me;
  return structuredClone({
    seat: me,
    options: state.options,
    round: state.round,
    dealer: state.dealer,
    scores: state.scores,
    history: state.history,
    winner: state.winner,
    phase: state.phase,
    turn: state.turn,
    hand: me == null ? [] : state.hands[me],
    handSizes: state.hands.map((h) => h.length),
    nestSize: state.nest.length,
    bidding: state.bidding,
    contract: state.contract,
    sittingOut: state.sittingOut,
    trump: state.trump,
    trick: state.trick,
    tricks: state.tricks.map((t) => ({ leader: t.leader, winner: t.winner, points: t.points, plays: t.plays })),
    lastTrick: state.lastTrick,
    points: state.points,
    ready: state.ready,
    lastRound: state.lastRound,
    myDiscards: isBidder ? state.discards : [],
    discardCount: state.phase === 'discard' ? discardCount(state) : 0,
    redeals: state.redeals,
  });
}

// What other seats get to see of an action.
export function redact(action, actor, viewer) {
  if (actor === viewer) return action;
  if (action.type === 'discard') return { type: 'discard', count: action.cards.length };
  if (action.type === 'give') return { type: 'give' };
  return action;
}

export function describe(action, name) {
  switch (action.type) {
    case 'pass':
      return `${name} passes`;
    case 'bid':
      return `${name} bids ${action.amount}`;
    case 'give':
      return `${name} hands a card to the bidder`;
    case 'discard':
      return `${name} buries ${action.count ?? action.cards?.length} cards`;
    case 'play':
      return `${name} plays ${cardName(action.card)}${action.trump ? ` and names ${action.trump} trump` : ''}`;
    default:
      return '';
  }
}

export function cardName(card) {
  if (card === BIRD) return 'the Bird';
  const r = rankOf(card);
  return `${colorOf(card)} ${r}`;
}

// Claim check (host side, real hands): the leader is certain to take every remaining trick
// whatever anyone plays, by drawing trump from the top and then cashing winners.
export function canClaim(state) {
  if (state.phase !== 'play' || state.trump == null || state.trick.plays.length) return false;
  const leader = state.turn;
  const hand = state.hands[leader];
  if (hand.length < 2) return false;
  const trump = state.trump;
  const others = state.hands.flatMap((h, s) => (s === leader ? [] : h));
  const myTrumps = hand.filter((c) => isTrump(c, trump)).sort((a, b) => strength(b, trump) - strength(a, trump));
  const maxOtherTrumps = Math.max(
    0,
    ...state.hands.map((h, s) => (s === leader ? 0 : h.filter((c) => isTrump(c, trump)).length)),
  );
  const otherTrumps = others.filter((c) => isTrump(c, trump));
  if (maxOtherTrumps > 0) {
    if (myTrumps.length < maxOtherTrumps) return false;
    const topOther = Math.max(...otherTrumps.map((c) => strength(c, trump)));
    for (let i = 0; i < maxOtherTrumps; i++) if (strength(myTrumps[i], trump) < topOther) return false;
  }
  for (const c of hand) {
    if (isTrump(c, trump)) continue;
    const col = colorOf(c);
    const beat = others.some((o) => !isTrump(o, trump) && colorOf(o) === col && strength(o, trump) > strength(c, trump));
    if (beat) return false;
  }
  return true;
}

// Order the leader would play a claimed hand: trumps high to low, then side winners.
export function claimOrder(hand, trump) {
  return [...hand].sort((a, b) => {
    const ta = isTrump(a, trump), tb = isTrump(b, trump);
    if (ta !== tb) return ta ? -1 : 1;
    return strength(b, trump) - strength(a, trump);
  });
}
