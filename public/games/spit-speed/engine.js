// Spit & Speed rules engine: plain functions, no DOM. Only the host runs these.
//
// Two real-time card games for two players with one 52-card deck. Both players act at the
// same time: actors() lists every seat with a legal move, and the host serializes moves in
// the order they arrive, so if both players go for the same pile the second one is "too slow".
//
//   Speed  Each player holds 5 cards with a draw pile behind them. Two side piles in the
//          middle feed the two center piles. Play any card one rank above or below a center
//          top (Ace and King wrap). The hand refills itself. Empty your hand and draw pile to win.
//   Spit   Each player gets half the deck and lays out five stockpiles (1–5 cards, top card
//          face up). The rest is their spit pile. Play stockpile tops onto the center piles.
//          Clear your stockpiles, then slap the smaller center pile — the other player takes
//          the bigger one. Re-deal and go again. Get rid of every card to win.
//
// Cards are numbers 0–51: rank = c % 13 + 1 (1 = Ace … 13 = King), suit = floor(c / 13).

export const HAND = 5;
const MAX_ROUNDS = 40; // Spit: a game that somehow never ends is decided by cards left
const MAX_IDLE_FLIPS = 80; // flips in a row with no card played before the game is called

export const rank = (c) => (c % 13) + 1;
export const suit = (c) => Math.floor(c / 13);
export function fits(card, top, wrap = true) {
  if (top == null) return true; // an empty center pile takes anything
  const d = Math.abs(rank(card) - rank(top));
  return d === 1 || (wrap && d === 12);
}

// ---------- seeded shuffling (the seed lives in the state and is never shown to players) ----------
function rand(s) {
  s.rng = (s.rng + 0x6d2b79f5) >>> 0;
  let x = Math.imul(s.rng ^ (s.rng >>> 15), s.rng | 1);
  x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
}
function shuffle(s, a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand(s) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const top = (pile) => (pile.length ? pile[pile.length - 1] : null);

// ---------- setup ----------
export function setup({ seed = 1, options = {} } = {}) {
  const s = {
    mode: options.mode === 'spit' ? 'spit' : 'speed',
    wrap: options.wrap !== 'no',
    rng: seed >>> 0,
    phase: 'ready', // ready → play → (stuck) ready → play … ; Spit adds slap between rounds
    ready: [false, false],
    piles: [[], []],
    p: [{}, {}],
    side: [[], []],
    round: 1,
    idle: 0,
    stuck: false, // the last "ready" came from nobody being able to play
    winner: null, // 0, 1, or 'draw'
    reason: null,
    note: null, // what just happened, for the screen: { kind: 'flip' | 'slap' | 'deal' | …, … }
    plays: [0, 0],
  };
  const deck = shuffle(s, [...Array(52).keys()]);
  if (s.mode === 'speed') {
    for (const pl of s.p) {
      pl.hand = deck.splice(0, HAND);
      pl.stock = deck.splice(0, 15);
    }
    s.side = [deck.splice(0, 6), deck.splice(0, 6)];
  } else {
    for (const pl of s.p) deal(s, pl, deck.splice(0, 26));
  }
  s.note = { kind: 'deal' };
  return s;
}

// Spit: lay out stockpiles of 1, 2, 3, 4 and 5 cards (as far as the cards go); the rest is the spit pile
function deal(s, pl, cards) {
  shuffle(s, cards);
  pl.stacks = [];
  for (let i = 0; i < 5; i++) pl.stacks.push(cards.splice(0, Math.min(i + 1, cards.length)));
  pl.spit = cards;
}

// ---------- who may act, and how ----------
export function legal(s, seat) {
  if (seat == null || s.phase === 'over') return [];
  if (s.phase === 'slap') return [{ type: 'slap', pile: 0 }, { type: 'slap', pile: 1 }];
  if (s.phase === 'ready') return [...(s.ready[seat] ? [] : [{ type: 'ready' }]), ...moves(s, seat)];
  return [...plays(s, seat), ...moves(s, seat)];
}
function plays(s, seat) {
  const out = [];
  const tops = s.piles.map(top);
  const pl = s.p[seat];
  if (s.mode === 'speed') {
    for (const card of pl.hand) for (let k = 0; k < 2; k++) if (fits(card, tops[k], s.wrap)) out.push({ type: 'play', card, pile: k });
  } else
    pl.stacks.forEach((st, i) => {
      if (!st.length) return;
      for (let k = 0; k < 2; k++) if (fits(top(st), tops[k], s.wrap)) out.push({ type: 'play', from: i, pile: k });
    });
  return out;
}
// Spit: move a top card into an empty space to turn up the card under it (any time but a slap)
function moves(s, seat) {
  if (s.mode !== 'spit') return [];
  const pl = s.p[seat];
  const empty = pl.stacks.findIndex((st) => !st.length);
  if (empty < 0) return [];
  const out = [];
  pl.stacks.forEach((st, i) => st.length >= 2 && out.push({ type: 'move', from: i, to: empty }));
  return out;
}
const anyPlays = (s) => plays(s, 0).length > 0 || plays(s, 1).length > 0;

export const actors = (s) => [0, 1].filter((seat) => legal(s, seat).length > 0);

export function check(s, seat, a) {
  if (seat !== 0 && seat !== 1) return 'You are watching this game';
  if (s.phase === 'over') return 'The game is over';
  if (!a || typeof a !== 'object') return 'Unknown move';
  if (a.type === 'ready') return s.phase === 'ready' && !s.ready[seat] ? null : 'Not now';
  if (a.type === 'slap') return s.phase === 'slap' && (a.pile === 0 || a.pile === 1) ? null : 'Too late — that pile is gone';
  if (s.phase === 'slap') return 'Slap a pile!';
  if (s.phase !== 'play' && !(s.phase === 'ready' && a.type === 'move')) return 'Wait for the flip';
  if (a.pile !== 0 && a.pile !== 1 && a.type === 'play') return 'Pick a pile';
  const pl = s.p[seat];
  if (s.mode === 'speed') {
    if (a.type !== 'play' || !pl.hand.includes(a.card)) return 'That card isn’t in your hand';
  } else if (a.type === 'play') {
    if (!pl.stacks[a.from]?.length) return 'That stockpile is empty';
  } else if (a.type === 'move') {
    if (!(pl.stacks[a.from]?.length >= 2) || pl.stacks[a.to]?.length !== 0) return 'You can only move a card into an empty space';
    return null;
  } else return 'Unknown move';
  const card = s.mode === 'speed' ? a.card : top(pl.stacks[a.from]);
  if (!fits(card, top(s.piles[a.pile]), s.wrap)) return 'Too slow — that pile changed';
  return null;
}

// ---------- making a move ----------
export function apply(prev, seat, a) {
  const err = check(prev, seat, a);
  if (err) throw new Error(err);
  const s = structuredClone(prev);
  s.note = null;
  if (a.type === 'ready') {
    s.ready[seat] = true;
    if (s.ready[0] && s.ready[1]) flip(s);
    return s;
  }
  if (a.type === 'slap') {
    slap(s, seat, a.pile);
    return s;
  }
  const pl = s.p[seat];
  if (a.type === 'move') {
    pl.stacks[a.to].push(pl.stacks[a.from].pop());
    s.note = { kind: 'move', seat };
    if (s.phase === 'ready' && s.stuck && anyPlays(s)) {
      // the card that turned up can be played: no need to spit after all
      s.phase = 'play';
      s.ready = [false, false];
      s.stuck = false;
    }
    return settle(s);
  }
  // a play
  s.idle = 0;
  s.plays[seat]++;
  if (s.mode === 'speed') {
    const i = pl.hand.indexOf(a.card);
    // the next card from the draw pile takes the played card's place, so the hand doesn't shuffle around
    if (pl.stock.length) pl.hand[i] = pl.stock.pop();
    else pl.hand.splice(i, 1);
    s.piles[a.pile].push(a.card);
    if (!pl.hand.length) return finish(s, seat, 'out');
  } else {
    s.piles[a.pile].push(pl.stacks[a.from].pop());
    if (pl.stacks.every((st) => !st.length)) {
      if (!pl.spit.length) return finish(s, seat, 'out');
      s.phase = 'slap';
      s.cleared = seat;
      s.note = { kind: 'cleared', seat };
      return s;
    }
  }
  return settle(s);
}

// after a play: if nobody can play, the round is stuck and both players flip again
function settle(s) {
  if (s.phase !== 'play') return s;
  if (anyPlays(s)) return s;
  if (s.mode === 'speed') {
    const spare = s.side[0].length + s.side[1].length + Math.max(0, s.piles[0].length - 1) + Math.max(0, s.piles[1].length - 1);
    if (!spare) return byCount(s, 'blocked');
  } else if (!s.p[0].spit.length && !s.p[1].spit.length) {
    // nobody can play and nobody has a card to spit: turn up cards with moves if anyone can,
    // otherwise each player takes the pile on their side and a new round is dealt
    if (moves(s, 0).length || moves(s, 1).length) return s;
    s.note = { kind: 'blocked' };
    return newRound(s, [s.piles[0], s.piles[1]]);
  }
  s.stuck = true;
  if (++s.idle > MAX_IDLE_FLIPS) return byCount(s, 'blocked');
  s.phase = 'ready';
  s.ready = [false, false];
  return s;
}

// both players are ready: turn up a new card on each center pile
function flip(s) {
  s.ready = [false, false];
  const moved = [];
  let reshuffled = false;
  if (s.mode === 'speed') {
    if (!s.side[0].length && !s.side[1].length) {
      // out of side cards: everything under the two tops is shuffled into new side piles
      const under = [...s.piles[0].splice(0, s.piles[0].length - 1), ...s.piles[1].splice(0, s.piles[1].length - 1)];
      shuffle(s, under);
      s.side = [under.slice(0, Math.ceil(under.length / 2)), under.slice(Math.ceil(under.length / 2))];
      reshuffled = true;
    }
    for (let k = 0; k < 2; k++) {
      const src = s.side[k].length ? s.side[k] : s.side[1 - k];
      if (src.length) {
        s.piles[k].push(src.pop());
        moved.push({ pile: k, from: src === s.side[k] ? k : 1 - k });
      }
    }
  } else {
    // each player spits onto the pile on their side; if one has run out, the other spits on both
    const spat = [false, false];
    for (let k = 0; k < 2; k++)
      if (s.p[k].spit.length) {
        s.piles[k].push(s.p[k].spit.pop());
        spat[k] = true;
        moved.push({ pile: k, from: k });
      }
    for (let k = 0; k < 2; k++)
      if (!spat[k] && s.p[1 - k].spit.length) {
        s.piles[k].push(s.p[1 - k].spit.pop());
        moved.push({ pile: k, from: 1 - k });
      }
  }
  s.phase = 'play';
  s.note = { kind: reshuffled ? 'reshuffle' : 'flip', moved };
  settle(s); // still stuck after the flip? then settle() asks for another one
  if (s.phase === 'ready') s.note.again = true;
  return s;
}

// Spit: someone cleared their stockpiles. Whoever slaps first takes the pile they slapped;
// the other player takes the other pile.
function slap(s, seat, pile) {
  const taken = [];
  taken[seat] = s.piles[pile];
  taken[1 - seat] = s.piles[1 - pile];
  const sizes = [taken[0].length, taken[1].length];
  const cleared = s.cleared;
  delete s.cleared;
  newRound(s, taken);
  s.note = { kind: 'slap', seat, pile, sizes, cleared };
  return s;
}

function newRound(s, taken) {
  const note = s.note;
  s.piles = [[], []];
  for (let i = 0; i < 2; i++) {
    const pl = s.p[i];
    const cards = [...pl.stacks.flat(), ...pl.spit, ...taken[i]];
    if (!cards.length) return finish(s, i, 'out');
    deal(s, pl, cards);
  }
  s.round++;
  if (s.round > MAX_ROUNDS) return byCount(s, 'rounds');
  s.phase = 'ready';
  s.ready = [false, false];
  s.stuck = false;
  s.idle = 0;
  s.note = note || { kind: 'deal' };
  return s;
}

export const cardsLeft = (s, i) => {
  const pl = s.p[i];
  return s.mode === 'speed' ? pl.hand.length + pl.stock.length : pl.stacks.reduce((n, st) => n + st.length, 0) + pl.spit.length;
};

function byCount(s, reason) {
  const a = cardsLeft(s, 0);
  const b = cardsLeft(s, 1);
  return finish(s, a === b ? 'draw' : a < b ? 0 : 1, reason);
}

function finish(s, winner, reason) {
  s.phase = 'over';
  s.winner = winner;
  s.reason = reason;
  s.ready = [false, false];
  return s;
}

// ---------- what each player may see ----------
export function view(s, seat) {
  const v = {
    seat,
    mode: s.mode,
    wrap: s.wrap,
    phase: s.phase,
    ready: s.ready.slice(),
    round: s.round,
    stuck: s.stuck,
    winner: s.winner,
    reason: s.reason,
    note: s.note,
    cleared: s.cleared ?? null,
    plays: s.plays.slice(),
    // only the top few cards of a center pile can be seen
    piles: s.piles.map((p) => ({ n: p.length, top: p.slice(-3) })),
    left: [cardsLeft(s, 0), cardsLeft(s, 1)],
  };
  if (s.mode === 'speed') {
    v.side = s.side.map((p) => p.length);
    v.players = s.p.map((pl, i) => ({
      hand: i === seat || s.phase === 'over' ? pl.hand.slice() : null,
      handCount: pl.hand.length,
      stock: pl.stock.length,
    }));
  } else {
    // stockpile tops are face up for everyone; the cards under them and the spit piles are not
    v.players = s.p.map((pl) => ({
      stacks: pl.stacks.map((st) => ({ n: st.length, top: top(st) })),
      spit: pl.spit.length,
    }));
  }
  return v;
}

export const isOver = (s) => s.phase === 'over';
