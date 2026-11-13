// Shed Tycoon rules engine: plain functions, no DOM. The host runs these.
//
// Buy building materials, then use them to build sheds, barns and garages from the order board.
// Every building you finish is a permanent discount on one material, so builds get cheaper as
// your yard grows. Sales lots sign on with the first builder whose yard has enough of the
// buildings they sell. When someone reaches the target score, the round is played out and the
// most points wins.

export const MATS = ['lumber', 'steel', 'glass', 'paint', 'shingle'];
export const MAT_NAMES = ['Lumber', 'Steel', 'Glass', 'Paint', 'Shingles'];
export const CASH = 5; // index of the wild "cash" token
export const TOKEN_LIMIT = 10;
export const RESERVE_LIMIT = 3;
export const SUPPLY = { 2: 4, 3: 5, 4: 7 };
export const CASH_SUPPLY = 5;
export const SLOTS = 4; // face-up orders per tier
export const DECK = -1; // `slot` for reserving the top of a deck blind

// ---------------------------------------------------------------------
// the order deck: built from templates, the same in every game
// ---------------------------------------------------------------------
// each template: points and the cost amounts, spread over the other materials in turn
const TEMPLATES = [
  [
    { p: 0, c: [1, 1, 1, 1] },
    { p: 0, c: [2, 1] },
    { p: 0, c: [1, 1, 1] },
    { p: 0, c: [2, 2] },
    { p: 0, c: [3] },
    { p: 0, c: [1, 2, 1] },
    { p: 1, c: [4] },
  ],
  [
    { p: 1, c: [2, 2, 3] },
    { p: 1, c: [3, 2, 2] },
    { p: 2, c: [4, 2, 1] },
    { p: 2, c: [5, 2] },
    { p: 2, c: [5] },
    { p: 3, c: [6] },
  ],
  [
    { p: 3, c: [3, 3, 5, 3] },
    { p: 4, c: [7] },
    { p: 4, c: [6, 3, 3] },
    { p: 5, c: [7, 3] },
  ],
];
const NAMES = [
  // by tier, then by bonus material
  [
    ['Tool Shed', 'Wood Crib', 'Lean-To', 'Firewood Rack', 'Garden Shed', 'Potting Bench', 'Log Bin'],
    ['Steel Locker', 'Mower Shed', 'Bike Port', 'Metal Hutch', 'Grain Bin', 'Trash Corral', 'Rain Tank'],
    ['Cold Frame', 'Potting Shed', 'Seed House', 'Glass Hutch', 'Sun Shed', 'Window Box', 'Plant Stand'],
    ['Playhouse', 'Kids’ Fort', 'Chicken Coop', 'Dog House', 'Rabbit Hutch', 'Duck House', 'Goat Shelter'],
    ['Gable Shed', 'Pump House', 'Well Cover', 'Wood Shed', 'Saltbox Shed', 'Cart Barn', 'Hay Crib'],
  ],
  [
    ['Lofted Barn', 'Timber Pavilion', 'Pole Barn', 'Horse Stall', 'Sawmill Shed', 'Board & Batten'],
    ['Steel Carport', 'Equipment Barn', 'Tractor Shed', 'Welding Shop', 'RV Cover', 'Quonset'],
    ['Greenhouse', 'Sunroom Studio', 'Art Studio', 'Conservatory', 'Garden Office', 'Orangery'],
    ['Red Barn', 'Painted Cottage', 'Sugar Shack', 'Farm Stand', 'Tiny Cabin', 'Market Stall'],
    ['Gambrel Barn', 'Cabin', 'Hunting Cabin', 'Side Lofted', 'Mini Barn', 'Utility Barn'],
  ],
  [
    ['Timber Lodge', 'Post & Beam Hall', 'Log Home', 'Event Barn'],
    ['Four-Car Garage', 'Machine Shed', 'Steel Shop', 'Boat Storage'],
    ['Glass Conservatory', 'Backyard Office', 'Studio Loft', 'Garden Pavilion'],
    ['Classic Bank Barn', 'Country Store', 'Farmhouse Barn', 'Cider House'],
    ['Two-Story Garage', 'Lake Cabin', 'Mountain Cabin', 'Carriage House'],
  ],
];

function buildDeck() {
  const cards = [];
  TEMPLATES.forEach((list, tier) => {
    for (let b = 0; b < MATS.length; b++) {
      list.forEach((t, k) => {
        const cost = [0, 0, 0, 0, 0];
        // spread the amounts over the other materials, starting at a different one per card
        const others = [1, 2, 3, 4].map((d) => (b + d + k) % MATS.length).filter((m) => m !== b);
        while (others.length < 4) others.push(b);
        t.c.forEach((amt, i) => (cost[others[i % others.length]] += amt));
        cards.push({ id: cards.length, tier, bonus: b, points: t.p, cost, name: NAMES[tier][b][k] });
      });
    }
  });
  return cards;
}
export const CARDS = buildDeck();

// sales lots: each wants enough buildings of two or three kinds; all worth 3 points
const LOT_NAMES = [
  'Pine Ridge Lot', 'Crossroads Sales', 'Valley Barn Co.', 'Maple Street Lot', 'Riverbend Sheds', 'Hillcrest Display',
  'Route 9 Lot', 'Cedar Hollow', 'Prairie Sales', 'Oak Lane Lot', 'Mill Pond Sheds', 'Lakeside Lot',
  'Highway Barn Mart', 'Twin Silos Lot', 'Orchard Road', 'Stony Creek Lot', 'Meadowview Sales', 'Fairground Lot',
  'Old Depot Lot', 'Sunset Sheds',
];
function buildLots() {
  const lots = [];
  for (let a = 0; a < 5; a++) for (let b = a + 1; b < 5; b++) lots.push([a, b]);
  for (let a = 0; a < 5; a++) for (let b = a + 1; b < 5; b++) for (let c = b + 1; c < 5; c++) lots.push([a, b, c]);
  return lots.map((kinds, id) => {
    const need = [0, 0, 0, 0, 0];
    for (const k of kinds) need[k] = kinds.length === 2 ? 4 : 3;
    return { id, need, points: 3, name: LOT_NAMES[id] };
  });
}
export const LOTS = buildLots();

// ---------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------
function rand(s) {
  // mulberry32; its state lives in the game state so a game can be replayed from its seed
  s.rng = (s.rng + 0x6d2b79f5) >>> 0;
  let t = s.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function shuffle(s, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand(s) * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
const sum = (a) => a.reduce((n, x) => n + x, 0);
export const tokenCount = (pl) => sum(pl.tokens);
export const card = (id) => CARDS[id];

export function bonuses(pl) {
  const b = [0, 0, 0, 0, 0];
  for (const id of pl.built) b[CARDS[id].bonus]++;
  return b;
}
export function points(pl) {
  return pl.built.reduce((n, id) => n + CARDS[id].points, 0) + pl.lots.reduce((n, id) => n + LOTS[id].points, 0);
}

// what building a card would cost this player: materials from each pile and cash to cover the rest
export function payment(pl, id) {
  const b = bonuses(pl);
  const pay = [0, 0, 0, 0, 0, 0];
  for (let m = 0; m < 5; m++) {
    const need = Math.max(0, CARDS[id].cost[m] - b[m]);
    pay[m] = Math.min(need, pl.tokens[m]);
    pay[CASH] += need - pay[m];
  }
  return pay[CASH] <= pl.tokens[CASH] ? pay : null;
}

// ---------------------------------------------------------------------
// the engine
// ---------------------------------------------------------------------
export function setup({ seed = 1, options = {} } = {}) {
  const n = Math.min(4, Math.max(2, Number(options.players) || 2));
  const s = {
    n,
    rng: seed >>> 0 || 1,
    target: Number(options.target) || 15,
    phase: 'play', // 'play' | 'discard' | 'over'
    turn: 0,
    start: 0,
    turnNo: 1,
    lastRound: false,
    supply: [...MATS.map(() => SUPPLY[n]), CASH_SUPPLY],
    decks: [0, 1, 2].map((t) => CARDS.filter((c) => c.tier === t).map((c) => c.id)),
    board: [],
    lots: [],
    players: Array.from({ length: n }, () => ({
      tokens: [0, 0, 0, 0, 0, 0],
      built: [],
      reserved: [], // { id, blind } — blind ones came off a deck and only their owner sees them
      lots: [],
    })),
    last: null,
    winners: null,
  };
  s.decks.forEach((d) => shuffle(s, d));
  s.board = s.decks.map((d) => d.splice(0, SLOTS));
  s.lots = shuffle(s, LOTS.map((l) => l.id)).slice(0, n + 1);
  s.start = s.turn = Math.floor(rand(s) * n);
  return s;
}

export const actors = (s) => (s.phase === 'over' ? [] : [s.turn]);
export const isOver = (s) => s.phase === 'over';

function takeMoves(s) {
  const out = [];
  const open = [0, 1, 2, 3, 4].filter((m) => s.supply[m] > 0);
  const k = Math.min(3, open.length);
  const combos = (from, size, start = 0, acc = []) => {
    if (acc.length === size) return void out.push({ type: 'take', mats: acc.slice() });
    for (let i = start; i < from.length; i++) combos(from, size, i + 1, [...acc, from[i]]);
  };
  if (k > 0) combos(open, k);
  for (let m = 0; m < 5; m++) if (s.supply[m] >= 4) out.push({ type: 'take', mats: [m, m] });
  return out;
}

export function legal(s, seat) {
  if (!actors(s).includes(seat)) return [];
  const pl = s.players[seat];
  if (s.phase === 'discard') return [0, 1, 2, 3, 4, 5].filter((m) => pl.tokens[m] > 0).map((m) => ({ type: 'discard', mat: m }));
  const out = [];
  s.board.forEach((row, tier) => row.forEach((id, slot) => id != null && payment(pl, id) && out.push({ type: 'build', tier, slot })));
  pl.reserved.forEach((r, i) => payment(pl, r.id) && out.push({ type: 'build', hand: i }));
  out.push(...takeMoves(s));
  if (pl.reserved.length < RESERVE_LIMIT) {
    s.board.forEach((row, tier) => {
      row.forEach((id, slot) => id != null && out.push({ type: 'reserve', tier, slot }));
      if (s.decks[tier].length) out.push({ type: 'reserve', tier, slot: DECK });
    });
  }
  if (!out.length) out.push({ type: 'pass' });
  return out;
}

const same = (a, b) => a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]);
export function check(s, seat, a) {
  if (!actors(s).includes(seat)) return 'It is not your turn';
  const moves = legal(s, seat);
  const ok = moves.some((m) => {
    if (m.type !== a?.type) return false;
    if (m.type === 'take') return Array.isArray(a.mats) && same(m.mats, a.mats);
    if (m.type === 'discard') return m.mat === a.mat;
    if (m.type === 'build') return m.hand != null ? m.hand === a.hand : m.tier === a.tier && m.slot === a.slot && a.hand == null;
    if (m.type === 'reserve') return m.tier === a.tier && m.slot === a.slot;
    return true;
  });
  if (ok) return null;
  if (a?.type === 'build') return 'You can’t afford that build yet';
  if (a?.type === 'take') return 'Take three different materials, or two of one material when four or more are left';
  if (a?.type === 'reserve') return `You can hold at most ${RESERVE_LIMIT} orders`;
  return 'That move isn’t allowed right now';
}

function refill(s, tier, slot) {
  s.board[tier][slot] = s.decks[tier].length ? s.decks[tier].shift() : null;
}

export function apply(prev, seat, a) {
  const err = check(prev, seat, a);
  if (err) throw new Error(err);
  const s = structuredClone(prev);
  const pl = s.players[seat];
  s.last = { seat, type: a.type, turnNo: s.turnNo };

  if (a.type === 'discard') {
    pl.tokens[a.mat]--;
    s.supply[a.mat]++;
    s.last.mat = a.mat;
    if (tokenCount(pl) <= TOKEN_LIMIT) endTurn(s);
    return s;
  }
  if (a.type === 'take') {
    for (const m of a.mats) {
      pl.tokens[m]++;
      s.supply[m]--;
    }
    s.last.mats = a.mats.slice();
  } else if (a.type === 'reserve') {
    let id;
    if (a.slot === DECK) id = s.decks[a.tier].shift();
    else {
      id = s.board[a.tier][a.slot];
      refill(s, a.tier, a.slot);
    }
    pl.reserved.push({ id, blind: a.slot === DECK });
    s.last.tier = a.tier;
    s.last.slot = a.slot;
    s.last.id = a.slot === DECK ? null : id;
    if (s.supply[CASH] > 0) {
      s.supply[CASH]--;
      pl.tokens[CASH]++;
      s.last.cash = true;
    }
  } else if (a.type === 'build') {
    let id;
    if (a.hand != null) {
      id = pl.reserved.splice(a.hand, 1)[0].id;
      s.last.hand = a.hand;
    } else {
      id = s.board[a.tier][a.slot];
      refill(s, a.tier, a.slot);
      s.last.tier = a.tier;
      s.last.slot = a.slot;
    }
    const pay = payment(pl, id);
    for (let m = 0; m < 6; m++) {
      pl.tokens[m] -= pay[m];
      s.supply[m] += pay[m];
    }
    pl.built.push(id);
    s.last.id = id;
    s.last.paid = pay;
  }
  if (tokenCount(pl) > TOKEN_LIMIT) {
    s.phase = 'discard';
    return s;
  }
  endTurn(s);
  return s;
}

function endTurn(s) {
  s.phase = 'play';
  const seat = s.turn;
  const pl = s.players[seat];
  // a sales lot signs on with you when your yard has what it sells
  const b = bonuses(pl);
  const lot = s.lots.find((id) => LOTS[id].need.every((k, m) => b[m] >= k));
  if (lot != null) {
    s.lots = s.lots.filter((x) => x !== lot);
    pl.lots.push(lot);
    if (s.last && s.last.seat === seat) s.last.lot = lot;
  }
  if (points(pl) >= s.target) s.lastRound = true;
  s.turn = (s.turn + 1) % s.n;
  if (s.turn === s.start) {
    s.turnNo++;
    if (s.lastRound) return finish(s);
  }
  // no-one can move at all (everything bought out) — end it rather than loop forever
  if (s.turnNo > 120) finish(s);
}

function finish(s) {
  s.phase = 'over';
  const pts = s.players.map(points);
  const best = Math.max(...pts);
  let top = pts.map((p, i) => i).filter((i) => pts[i] === best);
  const fewest = Math.min(...top.map((i) => s.players[i].built.length));
  s.winners = top.filter((i) => s.players[i].built.length === fewest);
}

export function view(s, seat) {
  const v = structuredClone(s);
  delete v.rng;
  v.decks = s.decks.map((d) => d.length);
  v.seat = seat;
  v.players = v.players.map((pl, i) => ({
    ...pl,
    reserved: pl.reserved.map((r) => (r.blind && i !== seat && s.phase !== 'over' ? { id: null, blind: true, tier: CARDS[r.id].tier } : { ...r, tier: CARDS[r.id].tier })),
  }));
  return v;
}

// tokens everywhere, for tests
export function census(s) {
  const t = s.supply.slice();
  for (const pl of s.players) pl.tokens.forEach((k, m) => (t[m] += k));
  return t;
}
