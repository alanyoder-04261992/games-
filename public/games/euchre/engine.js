// Euchre rules engine. Pure and deterministic: (state, action) -> new state.
// The Game Center runs this on the host only; every other player gets a view().
//
// Rules (standard North American Euchre):
//   * 24 cards: 9, 10, J, Q, K, A in each suit. 4 players, partners sit across.
//   * Five cards each. The next card is turned face up on the kitty.
//   * Round one: starting left of the dealer, each player passes or "orders up" the up-card's
//     suit as trump. Ordering it up sends the card to the dealer, who picks it up and discards one.
//   * Round two (everyone passed): the card is turned down and each player may name any other
//     suit, or pass. If everyone passes again the deal moves on (or, with "stick the dealer",
//     the dealer has to name a suit).
//   * Whoever names trump may "go alone": their partner sits the hand out.
//   * Trump ranks: Jack of trump (right bower), the other Jack of the same color (left bower,
//     which counts as trump), then A, K, Q, 10, 9. Other suits rank A, K, Q, J, 10, 9.
//   * Follow suit if you can. Most trumps wins the trick, else the highest card of the suit led.
//   * Scoring: the makers take 3 or 4 tricks: 1 point; all 5: 2 points (4 if alone).
//     Makers take fewer than 3: euchred, the defenders score 2. First team to 10 wins.

export const SUITS = ['S', 'H', 'C', 'D']; // display order: black, red, black, red
export const RANKS = ['9', 'T', 'J', 'Q', 'K', 'A'];
export const HAND_SIZE = 5;
export const SEAT_NAMES = ['South', 'West', 'North', 'East'];
export const SUIT_NAMES = { S: 'Spades', H: 'Hearts', D: 'Diamonds', C: 'Clubs' };
export const SUIT_SINGULAR = { S: 'Spade', H: 'Heart', D: 'Diamond', C: 'Club' };
export const SUIT_SYMBOL = { S: '♠', H: '♥', D: '♦', C: '♣' };
export const RANK_NAMES = { 9: 'Nine', T: 'Ten', J: 'Jack', Q: 'Queen', K: 'King', A: 'Ace' };
export const RANK_SHORT = { 9: '9', T: '10', J: 'J', Q: 'Q', K: 'K', A: 'A' };

export const DEFAULT_OPTIONS = { winScore: 10, stickDealer: false, allowAlone: true };

// ---------- cards ----------
export const rankOf = (c) => c[0];
export const naturalSuit = (c) => c[1];
export const isRed = (suit) => suit === 'H' || suit === 'D';
// the other suit of the same color: where the left bower comes from
export const sisterSuit = (suit) => ({ S: 'C', C: 'S', H: 'D', D: 'H' })[suit];
export const isRight = (c, trump) => trump != null && c === 'J' + trump;
export const isLeft = (c, trump) => trump != null && c === 'J' + sisterSuit(trump);
// The suit a card belongs to once trump is known: the left bower is a trump.
export const suitOf = (c, trump) => (isLeft(c, trump) ? trump : naturalSuit(c));
export const isTrump = (c, trump) => trump != null && suitOf(c, trump) === trump;

const RANK_VALUE = { 9: 0, T: 1, J: 2, Q: 3, K: 4, A: 5 };
const TRUMP_VALUE = { 9: 10, T: 11, Q: 13, K: 14, A: 15 };
// Strength of a card within its own suit. Trumps are all above every other card.
export function strength(c, trump) {
  if (isRight(c, trump)) return 120;
  if (isLeft(c, trump)) return 119;
  if (isTrump(c, trump)) return 100 + TRUMP_VALUE[rankOf(c)];
  return RANK_VALUE[rankOf(c)];
}
// How strongly a card plays to a trick where `led` was led: -1 if it can't win at all.
export function power(c, trump, led) {
  const s = suitOf(c, trump);
  if (s === trump) return strength(c, trump);
  return s === led ? strength(c, trump) : -1;
}

export function fullDeck() {
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) deck.push(r + s);
  return deck;
}

// Sort a hand by suit (alternating colors), high cards on the right. With trump known, trump goes
// on the right and the left bower sits inside it.
export function sortHand(cards, trump = null) {
  let order = [...SUITS];
  if (trump) {
    // keep colors alternating around trump where possible
    const others = SUITS.filter((s) => s !== trump);
    const sameColor = others.find((s) => isRed(s) === isRed(trump));
    const opp = others.filter((s) => s !== sameColor);
    order = [opp[0], sameColor, opp[1], trump];
  }
  return [...cards].sort((a, b) => {
    const sa = order.indexOf(suitOf(a, trump));
    const sb = order.indexOf(suitOf(b, trump));
    if (sa !== sb) return sa - sb;
    return strength(a, trump) - strength(b, trump);
  });
}

// ---------- seats ----------
export const teamOf = (seat) => seat % 2;
export const partnerOf = (seat) => (seat + 2) % 4;
export const nextSeat = (seat) => (seat + 1) % 4;
// next seat that is in the hand (skips a partner sitting out)
export const nextActive = (seat, out) => {
  let n = nextSeat(seat);
  if (n === out) n = nextSeat(n);
  return n;
};

// ---------- rng (mulberry32, state kept in the game state) ----------
function rand(state) {
  let t = (state.rng = (state.rng + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function shuffle(state, items) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand(state) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- setup ----------
export function setup({ seed = Date.now(), options = {}, firstDealer } = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const state = {
    v: 1,
    options: opts,
    rng: seed >>> 0,
    round: 0, // hands dealt, including ones everybody passed on
    scores: [0, 0],
    history: [],
    winner: null,
    lastRound: null,
    lastTrick: null,
    passedOut: 0, // deals in a row that everybody passed
  };
  const dealer = Number.isInteger(firstDealer) ? firstDealer : Math.floor(rand(state) * 4);
  deal(state, dealer);
  return state;
}

function deal(state, dealer) {
  const deck = shuffle(state, fullDeck());
  // dealt starting left of the dealer; the order only matters for the animation
  const hands = [[], [], [], []];
  for (let i = 0; i < 4; i++) hands[(dealer + 1 + i) % 4] = sortHand(deck.slice(i * HAND_SIZE, (i + 1) * HAND_SIZE));
  const kitty = deck.slice(4 * HAND_SIZE);
  Object.assign(state, {
    round: state.round + 1,
    dealer,
    phase: 'order',
    turn: nextSeat(dealer),
    hands,
    upcard: kitty[0],
    kitty: kitty.slice(1),
    turnedDown: null,
    pickedUp: false,
    calls: [],
    trump: null,
    maker: null,
    alone: false,
    sittingOut: null,
    discard: null,
    trick: null,
    tricks: [],
    taken: [0, 0],
    ready: [false, false, false, false],
  });
}

// ---------- rules queries ----------
export function actors(state) {
  if (state.phase === 'over') return [];
  if (state.phase === 'score') return [0, 1, 2, 3].filter((s) => !state.ready[s]);
  return state.turn == null ? [] : [state.turn];
}

// Is the dealer stuck (must name trump) right now?
export const isStuck = (state, seat) => state.phase === 'call' && state.options.stickDealer && seat === state.dealer;

export function legal(state, seat) {
  if (!actors(state).includes(seat)) return [];
  const alone = state.options.allowAlone !== false;
  switch (state.phase) {
    case 'order': {
      const out = [{ type: 'pass' }, { type: 'order', alone: false }];
      if (alone) out.push({ type: 'order', alone: true });
      return out;
    }
    case 'call': {
      const out = isStuck(state, seat) ? [] : [{ type: 'pass' }];
      for (const suit of SUITS) {
        if (suit === naturalSuit(state.turnedDown)) continue;
        out.push({ type: 'call', suit, alone: false });
        if (alone) out.push({ type: 'call', suit, alone: true });
      }
      return out;
    }
    case 'discard':
      return state.hands[seat].map((card) => ({ type: 'discard', card }));
    case 'play':
      return legalPlays(state.hands[seat], state.trick, state.trump).map((card) => ({ type: 'play', card }));
    case 'score':
      return [{ type: 'ready' }];
    default:
      return [];
  }
}

// Cards from `hand` that may be played to `trick`.
export function legalPlays(hand, trick, trump) {
  if (!trick || trick.plays.length === 0) return [...hand];
  const led = suitOf(trick.plays[0].card, trump);
  const follow = hand.filter((c) => suitOf(c, trump) === led);
  return follow.length ? follow : [...hand];
}

const actionKey = (a) => `${a.type}|${a.card ?? ''}|${a.suit ?? ''}|${a.alone ? 1 : 0}`;
export function check(state, seat, action) {
  if (!action || typeof action !== 'object') return 'Bad action';
  if (!actors(state).includes(seat)) return 'Not your turn';
  return legal(state, seat).some((a) => actionKey(a) === actionKey(action)) ? null : 'That move is not allowed';
}

export function trickWinner(plays, trump) {
  const led = suitOf(plays[0].card, trump);
  let best = plays[0];
  for (const p of plays) if (power(p.card, trump, led) > power(best.card, trump, led)) best = p;
  return best.seat;
}

// ---------- apply ----------
export function apply(prev, seat, action) {
  const problem = check(prev, seat, action);
  if (problem) throw new Error(problem);
  const state = structuredClone(prev);
  switch (action.type) {
    case 'pass':
      doPass(state, seat);
      break;
    case 'order':
      state.calls.push({ seat, type: 'order', alone: !!action.alone });
      makeTrump(state, seat, naturalSuit(state.upcard), !!action.alone, true);
      break;
    case 'call':
      state.calls.push({ seat, type: 'call', suit: action.suit, alone: !!action.alone });
      makeTrump(state, seat, action.suit, !!action.alone, false);
      break;
    case 'discard':
      state.hands[seat] = state.hands[seat].filter((c) => c !== action.card);
      state.discard = action.card;
      startPlay(state);
      break;
    case 'play':
      doPlay(state, seat, action.card);
      break;
    case 'ready':
      state.ready[seat] = true;
      if (state.ready.every(Boolean)) deal(state, nextSeat(state.dealer));
      break;
  }
  return state;
}

function doPass(state, seat) {
  state.calls.push({ seat, type: 'pass', phase: state.phase });
  if (seat !== state.dealer) {
    state.turn = nextSeat(seat);
    return;
  }
  if (state.phase === 'order') {
    // everybody passed the up-card: turn it down and go round again
    state.phase = 'call';
    state.turnedDown = state.upcard;
    state.turn = nextSeat(state.dealer);
    return;
  }
  // everybody passed twice: the deal moves on
  state.passedOut++;
  deal(state, nextSeat(state.dealer));
}

function makeTrump(state, seat, suit, alone, fromUpcard) {
  state.trump = suit;
  state.maker = seat;
  state.alone = alone;
  state.sittingOut = alone ? partnerOf(seat) : null;
  state.passedOut = 0;
  state.hands = state.hands.map((h) => sortHand(h, suit));
  // ordering up hands the up-card to the dealer, unless the dealer is the one sitting out
  if (fromUpcard && state.sittingOut !== state.dealer) {
    state.pickedUp = true;
    state.hands[state.dealer] = sortHand([...state.hands[state.dealer], state.upcard], suit);
    state.phase = 'discard';
    state.turn = state.dealer;
    return;
  }
  if (fromUpcard) state.turnedDown = state.upcard; // set aside: nobody picks it up
  startPlay(state);
}

function startPlay(state) {
  state.phase = 'play';
  const leader = nextActive(state.dealer, state.sittingOut);
  state.turn = leader;
  state.trick = { leader, plays: [] };
  if (state.sittingOut != null) state.hands[state.sittingOut] = [];
}

function doPlay(state, seat, card) {
  state.hands[seat] = state.hands[seat].filter((c) => c !== card);
  state.trick.plays.push({ seat, card });
  const size = state.sittingOut == null ? 4 : 3;
  if (state.trick.plays.length < size) {
    state.turn = nextActive(seat, state.sittingOut);
    return;
  }
  const winner = trickWinner(state.trick.plays, state.trump);
  const done = { ...state.trick, winner };
  state.tricks.push(done);
  state.lastTrick = done;
  state.taken[teamOf(winner)]++;
  if (state.tricks.length === HAND_SIZE) endRound(state);
  else {
    state.trick = { leader: winner, plays: [] };
    state.turn = winner;
  }
}

// Points for a finished hand. `taken` is tricks per team.
export function scoreHand(taken, maker, alone) {
  const makers = teamOf(maker);
  const got = taken[makers];
  const change = [0, 0];
  let result;
  if (got < 3) {
    change[1 - makers] = 2;
    result = 'euchre';
  } else if (got === 5) {
    change[makers] = alone ? 4 : 2;
    result = alone ? 'alone-march' : 'march';
  } else {
    change[makers] = 1;
    result = 'made';
  }
  return { change, result };
}

function endRound(state) {
  const { change, result } = scoreHand(state.taken, state.maker, state.alone);
  state.scores = state.scores.map((s, t) => s + change[t]);
  const summary = {
    round: state.round,
    dealer: state.dealer,
    maker: state.maker,
    alone: state.alone,
    trump: state.trump,
    upcard: state.upcard,
    pickedUp: state.pickedUp,
    discard: state.discard,
    taken: [...state.taken],
    change,
    result,
    scores: [...state.scores],
    tricks: state.tricks.map((t) => ({ leader: t.leader, winner: t.winner, plays: t.plays })),
  };
  state.history.push({ round: summary.round, dealer: summary.dealer, maker: summary.maker, alone: summary.alone, trump: summary.trump, taken: summary.taken, change, result, scores: summary.scores });
  state.lastRound = summary;
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
    upcard: state.upcard,
    turnedDown: state.turnedDown,
    pickedUp: state.pickedUp,
    kittySize: state.kitty.length,
    calls: state.calls,
    trump: state.trump,
    maker: state.maker,
    alone: state.alone,
    sittingOut: state.sittingOut,
    trick: state.trick,
    tricks: state.tricks,
    taken: state.taken,
    lastTrick: state.lastTrick,
    ready: state.ready,
    lastRound: state.lastRound,
    passedOut: state.passedOut,
    // only the dealer knows what they put down
    myDiscard: me != null && me === state.dealer ? state.discard : null,
  });
}

export function redact(action, actor, viewer) {
  if (actor === viewer) return action;
  if (action.type === 'discard') return { type: 'discard' };
  return action;
}

export function cardName(card, trump = null) {
  if (isRight(card, trump)) return 'right bower';
  if (isLeft(card, trump)) return 'left bower';
  return `${RANK_NAMES[rankOf(card)]} of ${SUIT_NAMES[naturalSuit(card)]}`;
}
export const shortName = (card) => RANK_SHORT[rankOf(card)] + SUIT_SYMBOL[naturalSuit(card)];
