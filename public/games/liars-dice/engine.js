// Liar's Dice rules engine. Plain functions, no DOM: the host runs these and sends each player
// a view with only their own dice in it.
//
// A round: everyone rolls their dice in secret. Taking turns, each player either raises the bid
// ("there are at least 7 fours on the table") or calls the last bid a lie. On a call every cup
// is lifted and the dice are counted: if the bid was short, the bidder loses a die; if it was
// good, the caller loses one. With "Spot on" a player may instead claim the bid is exactly
// right: if so, every other player loses a die; if not, the caller does. Lose all your dice and
// you are out. The last player with dice wins.

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;

export const playerCount = (options) => Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, Math.round(Number(options?.players)) || 4));

export function normalizeOptions(options = {}) {
  return {
    players: playerCount(options),
    dice: [3, 4, 5, 6].includes(Number(options.dice)) ? Number(options.dice) : 5,
    wild: options.wild !== false && options.wild !== 'false',
    spotOn: options.spotOn !== false && options.spotOn !== 'false',
  };
}

// ---------- seeded dice ----------
// mulberry32: the state keeps its own counter so a saved game rolls the same dice when resumed.
function nextRandom(s) {
  s.rng = (s.rng + 0x6d2b79f5) >>> 0;
  let x = Math.imul(s.rng ^ (s.rng >>> 15), s.rng | 1);
  x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
}
function rollAll(s) {
  s.dice = s.counts.map((n) => Array.from({ length: n }, () => 1 + Math.floor(nextRandom(s) * 6)).sort((a, b) => a - b));
}

// ---------- helpers ----------
export const faces = (wild) => (wild ? [2, 3, 4, 5, 6] : [1, 2, 3, 4, 5, 6]);
export const totalDice = (s) => s.counts.reduce((a, b) => a + b, 0);
export const alive = (s) => s.counts.map((n, i) => (n > 0 ? i : -1)).filter((i) => i >= 0);
// does a die showing `d` count toward a bid on `face`?
export const matches = (d, face, wild) => d === face || (wild && d === 1 && face !== 1);
export const countFace = (dice, face, wild) => dice.reduce((a, d) => a + (matches(d, face, wild) ? 1 : 0), 0);

function nextAlive(s, from) {
  for (let i = 1; i <= s.n; i++) {
    const seat = (from + i) % s.n;
    if (s.counts[seat] > 0) return seat;
  }
  return from;
}
// the next player to act, starting at `from` itself if they still have dice
const aliveFrom = (s, from) => (s.counts[from] > 0 ? from : nextAlive(s, from));

// the smallest legal quantity for a bid on `face` after `bid` (null = opening bid)
export function minQty(bid, face) {
  if (!bid) return 1;
  return face > bid.face ? bid.qty : bid.qty + 1;
}
export const isRaise = (bid, qty, face) => !bid || qty > bid.qty || (qty === bid.qty && face > bid.face);

// ---------- the engine ----------
export function setup({ seed = 1, options } = {}) {
  const o = normalizeOptions(options);
  const s = {
    options: o,
    n: o.players,
    counts: Array(o.players).fill(o.dice),
    dice: [],
    rng: seed >>> 0,
    round: 1,
    phase: 'bid',
    starter: 0,
    turn: 0,
    bid: null,
    history: [],
    reveal: null,
    out: [], // seats in the order they were knocked out
    winner: null,
  };
  s.starter = s.turn = Math.floor(nextRandom(s) * s.n);
  rollAll(s);
  return s;
}

export function actors(s) {
  if (s.phase === 'bid') return [s.turn];
  if (s.phase === 'reveal') return [s.starter];
  return [];
}

export function legal(s, seat) {
  if (!actors(s).includes(seat)) return [];
  if (s.phase === 'reveal') return [{ type: 'roll' }];
  const out = [];
  const N = totalDice(s);
  for (const face of faces(s.options.wild))
    for (let qty = minQty(s.bid, face); qty <= N; qty++) out.push({ type: 'bid', qty, face });
  if (s.bid) {
    out.push({ type: 'liar' });
    if (s.options.spotOn) out.push({ type: 'spot' });
  }
  return out;
}

export function check(s, seat, a) {
  if (!actors(s).includes(seat)) return 'It is not your turn';
  if (!a || typeof a !== 'object') return 'Unknown move';
  if (s.phase === 'reveal') return a.type === 'roll' ? null : 'Roll the dice for the next round';
  switch (a.type) {
    case 'bid': {
      const { qty, face } = a;
      if (!Number.isInteger(qty) || !Number.isInteger(face)) return 'Pick a number and a face';
      if (!faces(s.options.wild).includes(face)) return s.options.wild && face === 1 ? 'Ones are wild, so you can’t bid on them' : 'Pick a face from 1 to 6';
      if (qty < 1 || qty > totalDice(s)) return `There are only ${totalDice(s)} dice on the table`;
      if (!isRaise(s.bid, qty, face)) return 'Raise the number, or keep it and pick a higher face';
      return null;
    }
    case 'liar':
      return s.bid ? null : 'Someone has to bid first';
    case 'spot':
      if (!s.options.spotOn) return 'Spot on is switched off at this table';
      return s.bid ? null : 'Someone has to bid first';
    default:
      return 'Unknown move';
  }
}

export function apply(prev, seat, a) {
  const err = check(prev, seat, a);
  if (err) throw new Error(err);
  const s = structuredClone(prev);
  if (a.type === 'roll') {
    s.round++;
    s.phase = 'bid';
    s.turn = s.starter;
    s.bid = null;
    s.history = [];
    s.reveal = null;
    rollAll(s);
    return s;
  }
  if (a.type === 'bid') {
    s.bid = { qty: a.qty, face: a.face, seat };
    s.history.push({ seat, qty: a.qty, face: a.face });
    s.turn = nextAlive(s, seat);
    return s;
  }
  // a call: lift the cups
  const { qty, face, seat: bidder } = s.bid;
  const wild = s.options.wild;
  const actual = s.dice.reduce((n, d) => n + countFace(d, face, wild), 0);
  let losers;
  let correct;
  if (a.type === 'liar') {
    correct = actual < qty;
    losers = [correct ? bidder : seat];
  } else {
    correct = actual === qty;
    losers = correct ? alive(s).filter((x) => x !== seat) : [seat];
  }
  for (const x of losers) {
    s.counts[x]--;
    if (s.counts[x] === 0) s.out.push(x);
  }
  // whoever lost a die starts the next round (the caller after a good spot-on call)
  s.starter = aliveFrom(s, losers.length === 1 ? losers[0] : seat);
  s.reveal = { call: a.type, caller: seat, bid: { qty, face, seat: bidder }, actual, correct, losers, dice: s.dice, wild };
  const left = alive(s);
  if (left.length === 1) {
    s.phase = 'over';
    s.winner = left[0];
  } else s.phase = 'reveal';
  return s;
}

// What one seat may see: their own dice while bidding, everyone's once the cups are lifted.
export function view(s, seat) {
  const { rng, dice, ...rest } = s;
  const v = structuredClone(rest);
  v.seat = seat;
  v.total = totalDice(s);
  v.dice = s.phase === 'bid' ? dice.map((d, i) => (i === seat ? d.slice() : null)) : structuredClone(dice);
  return v;
}

export const isOver = (s) => s.phase === 'over';
