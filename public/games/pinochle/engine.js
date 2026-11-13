// Pinochle rules engine (four-hand partnership, single 48-card deck). Pure and deterministic:
// (state, action) -> new state. The Game Center runs it on the host only; everyone else gets
// a view() with the other hands taken out.
//
// Rules:
//   * 48 cards: two each of A, 10, K, Q, J, 9 in four suits. Rank: A > 10 > K > Q > J > 9.
//     When two identical cards fall in one trick, the one played first wins.
//   * 4 players, partners across. 12 cards each. The deal passes clockwise.
//   * Bidding starts left of the dealer, from the minimum bid (250) up in 10s. Once you pass
//     you're out. If the first three pass, the dealer must take it at the minimum.
//   * The high bidder names trump. Optional: partner passes 3 or 4 cards to the bidder,
//     who passes the same number back.
//   * Everyone lays down meld. The bidder may throw the hand in instead of playing it.
//   * Play: follow suit; if you can't, trump; and always beat the winning card if you can
//     ("head the trick"). The bidder leads first.
//   * Counters: every Ace, 10 and King taken is 10 points; the last trick is 10 more (250).
//   * A team's meld only counts if it takes at least one trick. The bidding team must reach
//     its bid with meld + counters or it loses the bid. First team to 1500 wins; if both
//     cross in the same hand, the bidding team wins.

export const SUITS = ['S', 'H', 'C', 'D'];
export const RANKS = ['A', 'T', 'K', 'Q', 'J', '9']; // high to low
export const SUIT_NAMES = { S: 'Spades', H: 'Hearts', C: 'Clubs', D: 'Diamonds' };
export const SUIT_SYMBOL = { S: '♠', H: '♥', C: '♣', D: '♦' };
export const RANK_NAMES = { A: 'Ace', T: '10', K: 'King', Q: 'Queen', J: 'Jack', 9: '9' };
export const RANK_LABEL = { A: 'A', T: '10', K: 'K', Q: 'Q', J: 'J', 9: '9' };
export const SEAT_NAMES = ['South', 'West', 'North', 'East'];
export const HAND_SIZE = 12;
export const BID_STEP = 10;
export const LAST_TRICK_BONUS = 10;
export const MAX_BID_SPAN = 750; // highest bid offered: minimum + this
export const DEFAULT_OPTIONS = { minBid: 250, pass: 4, winScore: 1500 };

// ---------- cards ----------
// A card is rank + suit + copy, e.g. 'AS0' and 'AS1' are the two Aces of Spades.
export const rankOf = (c) => c[0];
export const suitOf = (c) => c[1];
export const faceOf = (c) => c.slice(0, 2);
export const power = (c) => 5 - RANKS.indexOf(c[0]); // A=5 … 9=0
export const isCounter = (c) => c[0] === 'A' || c[0] === 'T' || c[0] === 'K';
export const cardPoints = (c) => (isCounter(c) ? 10 : 0);
export const sumPoints = (cards) => cards.reduce((s, c) => s + cardPoints(c), 0);
export const cardName = (c) => `${RANK_NAMES[c[0]]} of ${SUIT_NAMES[c[1]]}`;
export const shortName = (c) => `${RANK_LABEL[c[0]]}${SUIT_SYMBOL[c[1]]}`;

export function fullDeck() {
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) for (const k of [0, 1]) deck.push(r + s + k);
  return deck;
}

// Sorted for the hand: by suit (alternating colors), high cards on the left. With trump known,
// trump goes first.
export function sortHand(cards, trump = null) {
  const order = trump ? [trump, ...SUITS.filter((s) => s !== trump)] : SUITS;
  return [...cards].sort((a, b) => order.indexOf(suitOf(a)) - order.indexOf(suitOf(b)) || power(b) - power(a) || a.localeCompare(b));
}

// ---------- seats ----------
export const teamOf = (seat) => seat % 2;
export const partnerOf = (seat) => (seat + 2) % 4;
export const nextSeat = (seat) => (seat + 1) % 4;

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

// ---------- meld ----------
// Every meld in a hand, with the cards that show it. Cards may count once in each of the three
// classes (trump runs/marriages, arounds, pinochles/marriages) but never twice in one.
export const MELD_VALUES = {
  run: 150,
  doubleRun: 1500,
  royalMarriage: 40,
  dix: 10,
  marriage: 20,
  pinochle: 40,
  doublePinochle: 300,
  around: { A: 100, K: 80, Q: 60, J: 40 },
  doubleAround: { A: 1000, K: 800, Q: 600, J: 400 },
};

export function meldOf(hand, trump) {
  const by = new Map();
  for (const c of hand) {
    const f = faceOf(c);
    if (!by.has(f)) by.set(f, []);
    by.get(f).push(c);
  }
  const n = (r, s) => by.get(r + s)?.length || 0;
  const take = (r, s, i) => by.get(r + s)[i];
  const items = [];
  const add = (name, points, cards) => items.push({ name, points, cards });

  if (trump) {
    const t = trump;
    const runs = Math.min(n('A', t), n('T', t), n('K', t), n('Q', t), n('J', t));
    const runCards = (i) => ['A', 'T', 'K', 'Q', 'J'].map((r) => take(r, t, i));
    if (runs === 2) add('Double run', MELD_VALUES.doubleRun, [...runCards(0), ...runCards(1)]);
    else if (runs === 1) add('Run', MELD_VALUES.run, runCards(0));
    const royal = Math.min(n('K', t), n('Q', t)) - runs;
    for (let i = 0; i < royal; i++) add('Royal marriage', MELD_VALUES.royalMarriage, [take('K', t, runs + i), take('Q', t, runs + i)]);
    for (let i = 0; i < n('9', t); i++) add('Dix', MELD_VALUES.dix, [take('9', t, i)]);
  }
  for (const r of ['A', 'K', 'Q', 'J']) {
    const k = Math.min(...SUITS.map((s) => n(r, s)));
    const label = { A: 'Aces', K: 'Kings', Q: 'Queens', J: 'Jacks' }[r];
    if (k === 2) add(`Double ${label.toLowerCase()} around`, MELD_VALUES.doubleAround[r], SUITS.flatMap((s) => by.get(r + s)));
    else if (k === 1) add(`${label} around`, MELD_VALUES.around[r], SUITS.map((s) => take(r, s, 0)));
  }
  for (const s of SUITS) {
    if (s === trump) continue;
    const m = Math.min(n('K', s), n('Q', s));
    for (let i = 0; i < m; i++) add('Marriage', MELD_VALUES.marriage, [take('K', s, i), take('Q', s, i)]);
  }
  const p = Math.min(n('Q', 'S'), n('J', 'D'));
  if (p === 2) add('Double pinochle', MELD_VALUES.doublePinochle, [...by.get('QS'), ...by.get('JD')]);
  else if (p === 1) add('Pinochle', MELD_VALUES.pinochle, [take('Q', 'S', 0), take('J', 'D', 0)]);

  const shown = [...new Set(items.flatMap((i) => i.cards))];
  return { total: items.reduce((s, i) => s + i.points, 0), items, cards: sortHand(shown, trump) };
}
export const meldPoints = (hand, trump) => meldOf(hand, trump).total;

// ---------- setup ----------
export function setup({ seed = Date.now(), options = {}, firstDealer } = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  opts.minBid = Number(opts.minBid) || DEFAULT_OPTIONS.minBid;
  opts.pass = Number(opts.pass) || 0;
  opts.winScore = Number(opts.winScore) || DEFAULT_OPTIONS.winScore;
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
  const deck = shuffleInto(state, fullDeck());
  const hands = [0, 1, 2, 3].map((s) => sortHand(deck.slice(s * HAND_SIZE, (s + 1) * HAND_SIZE)));
  Object.assign(state, {
    round: state.round + 1,
    dealer,
    phase: 'bid',
    turn: nextSeat(dealer),
    hands,
    dealt: hands.map((h) => [...h]),
    bidding: { high: null, passed: [false, false, false, false], log: [] },
    contract: null,
    trump: null,
    passed: null, // { toBidder: [...], toPartner: [...] }
    melds: null,
    thrownIn: false,
    trick: null,
    tricks: [],
    points: [0, 0],
    ready: [false, false, false, false],
  });
}

// ---------- rules queries ----------
export function actors(state) {
  if (state.phase === 'over') return [];
  if (state.phase === 'meld' || state.phase === 'score') return [0, 1, 2, 3].filter((s) => !state.ready[s]);
  return state.turn == null ? [] : [state.turn];
}

export function bidRange(state) {
  const { minBid } = state.options;
  const high = state.bidding.high;
  const from = high ? high.amount + BID_STEP : minBid;
  return { from, to: Math.max(from, minBid + MAX_BID_SPAN) };
}

// Is this seat stuck with the bid (everyone else passed without bidding)?
export const dealerStuck = (state) => !state.bidding.high && state.bidding.passed.filter(Boolean).length === 3;

export function legal(state, seat) {
  if (!actors(state).includes(seat)) return [];
  switch (state.phase) {
    case 'bid': {
      const out = [];
      if (!dealerStuck(state)) out.push({ type: 'pass' });
      const { from, to } = bidRange(state);
      for (let b = from; b <= to; b += BID_STEP) out.push({ type: 'bid', amount: b });
      return out;
    }
    case 'trump':
      return SUITS.map((suit) => ({ type: 'trump', suit }));
    case 'passIn':
    case 'passBack':
      return [{ type: 'pass-cards', count: state.options.pass }];
    case 'meld': {
      const out = [{ type: 'ready' }];
      if (seat === state.contract.bidder) out.push({ type: 'throw-in' });
      return out;
    }
    case 'play':
      return legalPlays(state, seat).map((card) => ({ type: 'play', card }));
    case 'score':
      return [{ type: 'ready' }];
    default:
      return [];
  }
}

// Which play is winning a (partial) trick.
export function winningPlay(plays, trump) {
  let best = plays[0];
  for (const p of plays.slice(1)) {
    const bs = suitOf(best.card), ps = suitOf(p.card);
    if (ps === bs) {
      if (power(p.card) > power(best.card)) best = p;
    } else if (ps === trump) best = p;
  }
  return best;
}
export const trickWinner = (plays, trump) => winningPlay(plays, trump).seat;

// Does `card` beat the current winning card?
export function beats(card, win, trump) {
  if (suitOf(card) === suitOf(win)) return power(card) > power(win);
  return suitOf(card) === trump;
}

// Cards this seat may play: follow suit, else trump, and beat the winning card when you can.
export function legalPlaysFor(hand, plays, trump) {
  if (plays.length === 0) return [...hand];
  const led = suitOf(plays[0].card);
  const win = winningPlay(plays, trump).card;
  const follow = hand.filter((c) => suitOf(c) === led);
  if (follow.length) {
    // the trick was trumped (and led suit isn't trump): no need to head it
    if (suitOf(win) !== led) return follow;
    const over = follow.filter((c) => beats(c, win, trump));
    return over.length ? over : follow;
  }
  const trumps = hand.filter((c) => suitOf(c) === trump);
  if (trumps.length) {
    if (suitOf(win) !== trump) return trumps;
    const over = trumps.filter((c) => beats(c, win, trump));
    return over.length ? over : trumps;
  }
  return [...hand];
}
export const legalPlays = (state, seat) => legalPlaysFor(state.hands[seat], state.trick.plays, state.trump);

const passer = (state) => (state.phase === 'passIn' ? partnerOf(state.contract.bidder) : state.contract.bidder);

// Returns null when fine, otherwise a reason.
export function check(state, seat, action) {
  if (!action || typeof action !== 'object') return 'Bad action';
  if (!actors(state).includes(seat)) return 'Not your turn';
  if (state.phase === 'passIn' || state.phase === 'passBack') {
    if (action.type !== 'pass-cards') return 'Choose cards to pass';
    const n = state.options.pass;
    const cards = action.cards;
    if (!Array.isArray(cards) || cards.length !== n) return `Pass exactly ${n} cards`;
    if (new Set(cards).size !== n) return 'Duplicate card';
    if (cards.some((c) => !state.hands[seat].includes(c))) return 'Card not in hand';
    return null;
  }
  if (state.phase === 'bid' && action.type === 'bid') {
    const { from, to } = bidRange(state);
    const b = action.amount;
    if (!Number.isInteger(b) || b < from || b > to || (b - state.options.minBid) % BID_STEP) return `Bid ${from} or more, in ${BID_STEP}s`;
    return null;
  }
  const key = (a) => `${a.type}|${a.amount ?? ''}|${a.card ?? ''}|${a.suit ?? ''}`;
  return legal(state, seat).some((a) => key(a) === key(action)) ? null : 'That move is not allowed';
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
    case 'trump':
      doTrump(state, action.suit);
      break;
    case 'pass-cards':
      doPassCards(state, seat, action.cards);
      break;
    case 'throw-in':
      state.thrownIn = true;
      endRound(state);
      break;
    case 'ready':
      state.ready[seat] = true;
      if (state.ready.every(Boolean)) {
        if (state.phase === 'meld') startPlay(state);
        else deal(state, nextSeat(state.dealer));
      }
      break;
    case 'play':
      doPlay(state, seat, action.card);
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
  if (b.high && active.length === 1 && active[0] === b.high.seat) {
    state.contract = { bidder: b.high.seat, amount: b.high.amount };
    state.phase = 'trump';
    state.turn = b.high.seat;
    return;
  }
  let next = nextSeat(seat);
  while (b.passed[next]) next = nextSeat(next);
  state.turn = next;
}

function doTrump(state, suit) {
  state.trump = suit;
  state.hands = state.hands.map((h) => sortHand(h, suit));
  if (state.options.pass > 0) {
    state.phase = 'passIn';
    state.turn = partnerOf(state.contract.bidder);
    state.passed = { toBidder: [], toPartner: [] };
  } else startMeld(state);
}

function doPassCards(state, seat, cards) {
  const to = partnerOf(seat);
  state.hands[seat] = state.hands[seat].filter((c) => !cards.includes(c));
  state.hands[to] = sortHand([...state.hands[to], ...cards], state.trump);
  if (state.phase === 'passIn') {
    state.passed.toBidder = [...cards];
    state.phase = 'passBack';
    state.turn = to;
  } else {
    state.passed.toPartner = [...cards];
    startMeld(state);
  }
}

function startMeld(state) {
  state.melds = state.hands.map((h) => meldOf(h, state.trump));
  state.phase = 'meld';
  state.turn = null;
  state.ready = [false, false, false, false];
}

function startPlay(state) {
  state.phase = 'play';
  state.turn = state.contract.bidder;
  state.trick = { leader: state.contract.bidder, plays: [] };
}

function doPlay(state, seat, card) {
  state.hands[seat] = state.hands[seat].filter((c) => c !== card);
  state.trick.plays.push({ seat, card });
  if (state.trick.plays.length < 4) {
    state.turn = nextSeat(seat);
    return;
  }
  const winner = trickWinner(state.trick.plays, state.trump);
  const last = state.tricks.length === HAND_SIZE - 1;
  const done = { ...state.trick, winner, points: sumPoints(state.trick.plays.map((p) => p.card)) + (last ? LAST_TRICK_BONUS : 0) };
  state.tricks.push(done);
  state.lastTrick = done;
  state.points[teamOf(winner)] += done.points;
  if (last) endRound(state);
  else {
    state.trick = { leader: winner, plays: [] };
    state.turn = winner;
  }
}

export const teamMeld = (melds, team) => melds[team].total + melds[team + 2].total;

export function scoreRound(state) {
  const { bidder, amount } = state.contract;
  const bidTeam = teamOf(bidder);
  const other = 1 - bidTeam;
  const meld = [teamMeld(state.melds, 0), teamMeld(state.melds, 1)];
  const counters = [0, 0];
  const tookTrick = [false, false];
  for (const t of state.tricks) {
    counters[teamOf(t.winner)] += t.points;
    tookTrick[teamOf(t.winner)] = true;
  }
  const change = [0, 0];
  const saved = [false, false];
  let made;
  if (state.thrownIn) {
    made = false;
    change[bidTeam] = -amount;
    change[other] = meld[other];
    saved[other] = true;
  } else {
    for (const t of [0, 1]) saved[t] = tookTrick[t];
    const total = (t) => counters[t] + (saved[t] ? meld[t] : 0);
    made = total(bidTeam) >= amount;
    change[bidTeam] = made ? total(bidTeam) : -amount;
    change[other] = total(other);
  }
  return { meld, counters, tookTrick, saved, made, change, thrownIn: state.thrownIn };
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
    melds: state.melds,
    passed: state.passed,
    dealt: state.dealt,
    bids: state.bidding.log,
    tricks: state.tricks.map((t) => ({ leader: t.leader, winner: t.winner, plays: t.plays, points: t.points })),
  };
  state.history.push({
    round: summary.round,
    contract: summary.contract,
    trump: summary.trump,
    made: summary.made,
    thrownIn: summary.thrownIn,
    meld: summary.meld,
    counters: summary.counters,
    change: summary.change,
    scores: summary.scores,
  });
  state.lastRound = summary;
  state.points = [...r.counters];
  state.turn = null;
  state.trick = null;
  state.winner = gameWinner(state.scores, state.options.winScore, teamOf(state.contract.bidder));
  if (state.winner != null) state.phase = 'over';
  else {
    state.phase = 'score';
    state.ready = [false, false, false, false];
  }
}

// First team to the target wins. If both cross together, the bidding team wins.
export function gameWinner([a, b], target, bidTeam) {
  if (a < target && b < target) return null;
  if (a >= target && b >= target) return bidTeam;
  return a >= target ? 0 : 1;
}

// ---------- hidden information ----------
export function view(state, seat) {
  const me = seat;
  const c = state.contract;
  let passedToMe = [];
  let passedByMe = [];
  if (state.passed && me != null && c) {
    if (me === c.bidder) (passedToMe = state.passed.toBidder), (passedByMe = state.passed.toPartner);
    else if (me === partnerOf(c.bidder)) (passedToMe = state.passed.toPartner), (passedByMe = state.passed.toBidder);
  }
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
    bidding: state.bidding,
    contract: c,
    trump: state.trump,
    melds: state.melds, // laid on the table for everyone to see
    passedToMe,
    passedByMe,
    trick: state.trick,
    tricks: state.tricks.map((t) => ({ leader: t.leader, winner: t.winner, points: t.points, plays: t.plays })),
    lastTrick: state.lastTrick,
    points: state.points,
    ready: state.ready,
    thrownIn: state.thrownIn,
    lastRound: state.lastRound,
  });
}

// What other seats get to see of an action.
export function redact(action, actor, viewer) {
  if (actor === viewer) return action;
  if (action.type === 'pass-cards') return { type: 'pass-cards', count: action.cards.length };
  return action;
}

export function describe(action, name) {
  switch (action.type) {
    case 'pass':
      return `${name} passes`;
    case 'bid':
      return `${name} bids ${action.amount}`;
    case 'trump':
      return `${name} names ${SUIT_NAMES[action.suit]} trump`;
    case 'pass-cards':
      return `${name} passes ${action.count ?? action.cards?.length} cards`;
    case 'throw-in':
      return `${name} throws in the hand`;
    case 'play':
      return `${name} plays the ${cardName(action.card)}`;
    default:
      return '';
  }
}
