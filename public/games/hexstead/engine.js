// Hexstead rules engine. Plain functions with no DOM; only the host runs them.
//
// Settle a hex island: place homesteads on corners, connect them with trails, roll dice to
// harvest timber, brick, wool, grain and stone, trade, upgrade homesteads to barns, and draw
// almanac cards. First to the target score on their own turn wins.
import { board, sizeFor } from './geometry.js';

export const RES = ['timber', 'brick', 'wool', 'grain', 'stone'];
export const RES_LABEL = { timber: 'Timber', brick: 'Brick', wool: 'Wool', grain: 'Grain', stone: 'Stone' };
export const TERRAIN = {
  forest: { res: 'timber', label: 'Forest' },
  clay: { res: 'brick', label: 'Clay Pits' },
  pasture: { res: 'wool', label: 'Pasture' },
  fields: { res: 'grain', label: 'Fields' },
  quarry: { res: 'stone', label: 'Quarry' },
  desert: { res: null, label: 'Badlands' },
};
export const COST = {
  road: { timber: 1, brick: 1 },
  homestead: { timber: 1, brick: 1, wool: 1, grain: 1 },
  town: { grain: 2, stone: 3 },
  card: { wool: 1, grain: 1, stone: 1 },
};
export const PIECES = { road: 15, homestead: 5, town: 4 };
export const CARDS = {
  sheriff: { label: 'Sheriff', text: 'Move the bandit and take a card from someone on that hex. Three or more Sheriffs earn the Big Posse (2 points).' },
  trailblazer: { label: 'Trailblazer', text: 'Build two trails for free.' },
  harvest: { label: 'Bumper Crop', text: 'Take any two resources from the bank.' },
  market: { label: 'Corner the Market', text: 'Name a resource. Everyone hands you all of theirs.' },
  landmark: { label: 'Landmark', text: 'Worth 1 point. Kept hidden until the game ends.' },
};
export const CARD_TYPES = Object.keys(CARDS);
// What goes in the box for each island. Bigger islands (5–8 players) get more tiles, number
// tokens, harbors, cards in the bank and almanac cards.
const nums = (counts) => Object.entries(counts).flatMap(([n, k]) => Array(k).fill(Number(n)));
export const SUPPLY = {
  base: {
    terrain: { forest: 4, pasture: 4, fields: 4, clay: 3, quarry: 3, desert: 1 },
    numbers: nums({ 2: 1, 3: 2, 4: 2, 5: 2, 6: 2, 8: 2, 9: 2, 10: 2, 11: 2, 12: 1 }),
    harbors: ['any', 'any', 'any', 'any', ...RES],
    bank: 19,
    deck: { sheriff: 14, trailblazer: 2, harvest: 2, market: 2, landmark: 5 },
  },
  large: {
    terrain: { forest: 6, pasture: 6, fields: 6, clay: 5, quarry: 5, desert: 2 },
    numbers: nums({ 2: 2, 3: 3, 4: 3, 5: 3, 6: 3, 8: 3, 9: 3, 10: 3, 11: 3, 12: 2 }),
    harbors: ['any', 'any', 'any', 'any', 'any', ...RES, 'wool'],
    bank: 24,
    deck: { sheriff: 20, trailblazer: 3, harvest: 3, market: 3, landmark: 5 },
  },
  huge: {
    terrain: { forest: 7, pasture: 7, fields: 7, clay: 6, quarry: 7, desert: 3 },
    numbers: nums({ 2: 2, 3: 4, 4: 4, 5: 4, 6: 3, 8: 3, 9: 4, 10: 4, 11: 4, 12: 2 }),
    harbors: ['any', 'any', 'any', 'any', 'any', 'any', ...RES, 'grain', 'stone'],
    bank: 30,
    deck: { sheriff: 24, trailblazer: 4, harvest: 4, market: 4, landmark: 6 },
  },
};
const G = (s) => board(s.size || 'base');
const seatsOf = (s) => s.players.map((_, i) => i);
export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 8;

// ---------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------
function rand(s) {
  // mulberry32, state kept in the game state so games can be replayed
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
const emptyRes = () => ({ timber: 0, brick: 0, wool: 0, grain: 0, stone: 0 });
const emptyCards = () => ({ sheriff: 0, trailblazer: 0, harvest: 0, market: 0, landmark: 0 });
export const total = (res) => RES.reduce((n, r) => n + (res?.[r] || 0), 0);
export const canPay = (res, cost) => Object.entries(cost).every(([r, n]) => (res[r] || 0) >= n);
function pay(s, p, cost) {
  for (const [r, n] of Object.entries(cost)) {
    s.players[p].res[r] -= n;
    s.bank[r] += n;
  }
}
function fail(msg) {
  throw new Error(msg);
}
function log(s, entry) {
  s.log.push({ ...entry, i: (s.logN = (s.logN || 0) + 1) });
  if (s.log.length > 40) s.log.splice(0, s.log.length - 40);
}

// ---------------------------------------------------------------------
// setup
// ---------------------------------------------------------------------
export function setup({ seed = 1, options = {} } = {}) {
  const n = Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, Number(options.players) || 4));
  const size = sizeFor(n);
  const supply = SUPPLY[size];
  const s = {
    rng: seed >>> 0 || 1,
    size,
    // with 5 or more players, everyone may build between turns ("barn raising"); Fast play can
    // turn it on for smaller tables too
    raising: (n >= 5 && options.raising !== false) || options.fast === 'raise' || options.fast === 'both',
    // Fast play "fast harvest": each die's number produces as well as the total
    fastHarvest: options.fast === 'harvest' || options.fast === 'both',
    raiseQueue: null,
    target: Number(options.target) || 10,
    friendly: !!options.friendly,
    hexes: [],
    bandit: 0,
    harbors: [],
    verts: Array(board(size).VERTS.length).fill(null), // { o: seat, k: 'homestead' | 'town' }
    roads: Array(board(size).EDGES.length).fill(null), // seat
    players: Array.from({ length: n }, () => ({
      res: emptyRes(),
      cards: emptyCards(),
      fresh: emptyCards(), // bought this turn, not playable yet
      sheriffs: 0,
      pieces: { ...PIECES },
    })),
    bank: Object.fromEntries(RES.map((r) => [r, supply.bank])),
    deck: [],
    phase: 'setup',
    order: [],
    step: 0,
    setupVert: null,
    current: 0,
    turnNo: 0,
    dice: null,
    rolled: false,
    cardPlayed: false,
    freeRoads: 0,
    banditReturn: 'main',
    discard: null,
    trade: null,
    offers: 0,
    bankTrades: 0,
    trailHolder: null,
    posseHolder: null,
    trailLen: Array(n).fill(0),
    gains: null,
    log: [],
    winner: null,
  };
  buildBoard(s);
  for (const t of CARD_TYPES) for (let i = 0; i < supply.deck[t]; i++) s.deck.push(t);
  shuffle(s, s.deck);
  const first = Math.floor(rand(s) * n);
  const fwd = seatsOf(s).map((i) => (first + i) % n);
  s.order = [...fwd, ...fwd.slice().reverse()];
  s.current = s.order[0];
  log(s, { k: 'start', p: first });
  return s;
}

function buildBoard(s) {
  const supply = SUPPLY[s.size];
  const { HEXES } = G(s);
  const bag = Object.entries(supply.terrain).flatMap(([t, k]) => Array(k).fill(t));
  let best = null;
  let bestBad = Infinity;
  for (let tries = 0; tries < 300 && bestBad > 0; tries++) {
    const terr = shuffle(s, bag.slice());
    const land = terr.map((t, i) => (t === 'desert' ? -1 : i)).filter((i) => i >= 0);
    // the busy numbers (6 and 8) first, never side by side
    const hotNums = supply.numbers.filter((x) => x === 6 || x === 8);
    const rest = shuffle(s, supply.numbers.filter((x) => x !== 6 && x !== 8));
    const n = Array(terr.length).fill(null);
    const order = shuffle(s, land.slice());
    let k = 0;
    for (const i of order) {
      if (k >= hotNums.length) break;
      if (HEXES[i].near.some((j) => n[j] === 6 || n[j] === 8)) continue;
      n[i] = hotNums[k++];
    }
    if (k < hotNums.length) continue;
    for (const i of land) if (n[i] == null) n[i] = rest.pop();
    // fewer matching neighbours is better
    let bad = 0;
    HEXES.forEach((hx, i) => hx.near.forEach((j) => n[i] != null && n[i] === n[j] && bad++));
    if (bad < bestBad) {
      bestBad = bad;
      best = terr.map((t, i) => ({ t, n: n[i] }));
    }
  }
  s.hexes = best;
  s.bandit = s.hexes.findIndex((h) => h.t === 'desert');
  const types = shuffle(s, supply.harbors.slice());
  s.harbors = G(s).HARBOR_SLOTS.map((slot, i) => ({ slot: i, type: types[i] }));
}

// ---------------------------------------------------------------------
// board queries
// ---------------------------------------------------------------------
export function harborsOf(s, p) {
  const set = new Set();
  for (const h of s.harbors) for (const v of G(s).HARBOR_SLOTS[h.slot].verts) if (s.verts[v]?.o === p) set.add(h.type);
  return set;
}
export function ratio(s, p, r) {
  const hb = harborsOf(s, p);
  return hb.has(r) ? 2 : hb.has('any') ? 3 : 4;
}
const freeCorner = (s, v) => s.verts[v] == null && G(s).VERTS[v].adj.every((a) => s.verts[a] == null);

export function canHomestead(s, p, v, isSetup = false) {
  if (!freeCorner(s, v)) return false;
  if (isSetup) return true;
  return G(s).VERTS[v].edges.some((e) => s.roads[e] === p);
}
export function canRoad(s, p, e, fromVert = null) {
  if (s.roads[e] != null) return false;
  const ed = G(s).EDGES[e];
  if (fromVert != null) return ed.a === fromVert || ed.b === fromVert;
  for (const v of [ed.a, ed.b]) {
    const b = s.verts[v];
    if (b && b.o === p) return true;
    if (b && b.o !== p) continue; // can't build through someone else's homestead
    if (G(s).VERTS[v].edges.some((x) => x !== e && s.roads[x] === p)) return true;
  }
  return false;
}
export const roadSpots = (s, p) => G(s).EDGES.map((_, e) => e).filter((e) => canRoad(s, p, e));
export const homesteadSpots = (s, p, isSetup = false) => G(s).VERTS.map((_, v) => v).filter((v) => canHomestead(s, p, v, isSetup));
export const townSpots = (s, p) => G(s).VERTS.map((_, v) => v).filter((v) => s.verts[v]?.o === p && s.verts[v].k === 'homestead');

export function longestTrail(s, p) {
  let best = 0;
  const used = new Set();
  const walk = (v, len) => {
    if (len > best) best = len;
    const b = s.verts[v];
    if (len > 0 && b && b.o !== p) return;
    for (const e of G(s).VERTS[v].edges) {
      if (s.roads[e] !== p || used.has(e)) continue;
      used.add(e);
      walk(G(s).otherEnd(e, v), len + 1);
      used.delete(e);
    }
  };
  for (let v = 0; v < G(s).VERTS.length; v++) if (G(s).VERTS[v].edges.some((e) => s.roads[e] === p)) walk(v, 0);
  return best;
}

export function publicPoints(s, p) {
  let vp = 0;
  for (const b of s.verts) if (b?.o === p) vp += b.k === 'town' ? 2 : 1;
  if (s.trailHolder === p) vp += 2;
  if (s.posseHolder === p) vp += 2;
  return vp;
}
export const points = (s, p) => publicPoints(s, p) + s.players[p].cards.landmark + s.players[p].fresh.landmark;

function updateTrail(s) {
  s.trailLen = seatsOf(s).map((p) => longestTrail(s, p));
  const lens = s.trailLen;
  const holder = s.trailHolder;
  const max = Math.max(...lens);
  let next = null;
  if (max >= 5) {
    const top = lens.map((l, i) => (l === max ? i : -1)).filter((i) => i >= 0);
    if (holder != null && top.includes(holder)) next = holder;
    else if (top.length === 1) next = top[0];
  }
  if (next !== holder) {
    s.trailHolder = next;
    log(s, { k: 'award', p: next, what: 'trail', lost: holder });
  }
}

// ---------------------------------------------------------------------
// turn structure
// ---------------------------------------------------------------------
export function actors(s) {
  if (s.phase === 'over') return [];
  if (s.phase === 'discard') return seatsOf(s).filter((p) => s.discard[p] > 0);
  if (s.phase === 'trade') {
    if (s.trade.stage === 'choose') return [s.trade.from];
    return seatsOf(s).filter((p) => p !== s.trade.from && s.trade.resp[p] == null);
  }
  if (s.phase === 'raise') return [s.raiseQueue[0]];
  return [s.current];
}

export function banditTargets(s, p, hex) {
  const set = new Set();
  for (const v of G(s).HEXES[hex].verts) {
    const b = s.verts[v];
    if (b && b.o !== p && total(s.players[b.o].res) > 0) set.add(b.o);
  }
  return [...set];
}
export function banditHexes(s, p) {
  const out = [];
  for (let i = 0; i < G(s).HEXES.length; i++) {
    if (i === s.bandit) continue;
    if (s.friendly) {
      // the friendly bandit leaves players with 2 points or fewer alone
      const owners = new Set(G(s).HEXES[i].verts.map((v) => s.verts[v]?.o).filter((o) => o != null && o !== p));
      if ([...owners].some((o) => publicPoints(s, o) <= 2)) continue;
    }
    out.push(i);
  }
  return out.length ? out : G(s).HEXES.map((_, i) => i).filter((i) => i !== s.bandit);
}

export function playable(s, p, card) {
  const pl = s.players[p];
  if (card === 'landmark' || s.cardPlayed || pl.cards[card] <= 0) return false;
  if (card === 'sheriff') return s.phase === 'roll' || s.phase === 'main';
  return s.phase === 'main';
}

// Every move this seat can make right now. Trade offers and discards can take many shapes, so
// for those this lists one sensible default; check() accepts any valid shape.
export function legal(s, p) {
  if (!actors(s).includes(p)) return [];
  const pl = s.players[p];
  const out = [];
  switch (s.phase) {
    case 'setup':
      if (s.setupVert == null) for (const v of homesteadSpots(s, p, true)) out.push({ type: 'homestead', v });
      else for (const e of G(s).VERTS[s.setupVert].edges) if (s.roads[e] == null) out.push({ type: 'road', e });
      break;
    case 'roll':
      out.push({ type: 'roll' });
      if (playable(s, p, 'sheriff')) out.push({ type: 'play', card: 'sheriff' });
      break;
    case 'discard':
      out.push({ type: 'discard', res: defaultDiscard(pl.res, s.discard[p]) });
      break;
    case 'bandit':
      for (const hex of banditHexes(s, p)) {
        const victims = banditTargets(s, p, hex);
        if (!victims.length) out.push({ type: 'bandit', hex, victim: null });
        for (const victim of victims) out.push({ type: 'bandit', hex, victim });
      }
      break;
    case 'roads': {
      const spots = roadSpots(s, p);
      for (const e of spots) out.push({ type: 'road', e });
      if (!spots.length) out.push({ type: 'skip' });
      break;
    }
    case 'trade':
      if (s.trade.stage === 'choose') {
        out.push({ type: 'cancel-trade' });
        for (const [seat, yes] of Object.entries(s.trade.resp)) if (yes) out.push({ type: 'accept-trade', with: Number(seat) });
      } else {
        out.push({ type: 'respond', yes: false });
        if (canPay(pl.res, s.trade.get)) out.push({ type: 'respond', yes: true });
      }
      break;
    case 'raise':
    case 'main': {
      out.push({ type: s.phase === 'raise' ? 'pass' : 'end' });
      if (pl.pieces.road > 0 && canPay(pl.res, COST.road)) for (const e of roadSpots(s, p)) out.push({ type: 'road', e });
      if (pl.pieces.homestead > 0 && canPay(pl.res, COST.homestead)) for (const v of homesteadSpots(s, p)) out.push({ type: 'homestead', v });
      if (pl.pieces.town > 0 && canPay(pl.res, COST.town)) for (const v of townSpots(s, p)) out.push({ type: 'town', v });
      if (s.deck.length && canPay(pl.res, COST.card)) out.push({ type: 'buy' });
      if (s.phase === 'raise') break; // building only: no trades or cards between turns
      for (const give of RES) {
        const n = ratio(s, p, give);
        if (pl.res[give] < n) continue;
        for (const get of RES) if (get !== give && s.bank[get] > 0) out.push({ type: 'bank', give, get });
      }
      for (const card of ['sheriff', 'trailblazer', 'harvest', 'market']) {
        if (!playable(s, p, card)) continue;
        if (card === 'harvest') {
          for (let i = 0; i < RES.length; i++)
            for (let j = i; j < RES.length; j++) {
              const a = RES[i], b = RES[j];
              if (s.bank[a] >= (a === b ? 2 : 1) && s.bank[b] >= 1) out.push({ type: 'play', card, res: [a, b] });
            }
        } else if (card === 'market') for (const r of RES) out.push({ type: 'play', card, res: r });
        else out.push({ type: 'play', card });
      }
      break;
    }
  }
  return out;
}

function defaultDiscard(res, n) {
  const have = { ...res };
  const out = emptyRes();
  for (let i = 0; i < n; i++) {
    const r = RES.reduce((a, b) => (have[b] > have[a] ? b : a), RES[0]);
    have[r]--;
    out[r]++;
  }
  return out;
}

export function check(s, p, a) {
  try {
    apply(s, p, a);
    return null;
  } catch (e) {
    return e.message;
  }
}

function cleanRes(obj) {
  const out = emptyRes();
  if (!obj || typeof obj !== 'object') return out;
  for (const r of RES) {
    const n = obj[r] == null ? 0 : Number(obj[r]);
    if (!Number.isInteger(n) || n < 0 || n > 99) fail('Bad amount');
    out[r] = n;
  }
  return out;
}
const pick = (o) => Object.fromEntries(Object.entries(o).filter(([, n]) => n > 0));

// ---------------------------------------------------------------------
// apply
// ---------------------------------------------------------------------
export function apply(prev, p, a) {
  if (!a || typeof a !== 'object') fail('No move');
  // the player who made an offer may withdraw it while others are still answering
  const withdrawing = a.type === 'cancel-trade' && prev.phase === 'trade' && prev.trade?.from === p;
  if (!withdrawing && !actors(prev).includes(p)) fail('It is not your turn');
  const s = structuredClone(prev);
  s.gains = null;
  const pl = s.players[p];
  const ph = s.phase;

  switch (a.type) {
    // ---------- building ----------
    case 'homestead': {
      const v = a.v;
      if (!Number.isInteger(v) || !G(s).VERTS[v]) fail('No such corner');
      if (ph === 'setup') {
        if (s.setupVert != null) fail('Place a trail next to your homestead');
        if (!canHomestead(s, p, v, true)) fail('Too close to another homestead');
        s.verts[v] = { o: p, k: 'homestead' };
        pl.pieces.homestead--;
        s.setupVert = v;
        log(s, { k: 'build', p, what: 'homestead', v });
        if (s.step >= 4) {
          const got = emptyRes();
          for (const hi of G(s).VERTS[v].hexes) {
            const r = TERRAIN[s.hexes[hi].t].res;
            if (r && s.bank[r] > 0) {
              got[r]++;
              s.bank[r]--;
              pl.res[r]++;
            }
          }
          if (total(got)) {
            s.gains = { [p]: pick(got) };
            log(s, { k: 'gain', gains: s.gains });
          }
        }
        break;
      }
      if (ph !== 'main' && ph !== 'raise') fail('You cannot build right now');
      if (pl.pieces.homestead <= 0) fail('No homesteads left — upgrade one to a barn');
      if (!canPay(pl.res, COST.homestead)) fail('Not enough resources');
      if (!canHomestead(s, p, v)) fail('A homestead needs your trail and a corner with no neighbours');
      pay(s, p, COST.homestead);
      s.verts[v] = { o: p, k: 'homestead' };
      pl.pieces.homestead--;
      log(s, { k: 'build', p, what: 'homestead', v });
      updateTrail(s);
      break;
    }
    case 'town': {
      if (ph !== 'main' && ph !== 'raise') fail('You cannot build right now');
      const v = a.v;
      if (s.verts[v]?.o !== p || s.verts[v].k !== 'homestead') fail('Upgrade one of your homesteads');
      if (pl.pieces.town <= 0) fail('No barns left');
      if (!canPay(pl.res, COST.town)) fail('Not enough resources');
      pay(s, p, COST.town);
      s.verts[v] = { o: p, k: 'town' };
      pl.pieces.town--;
      pl.pieces.homestead++;
      log(s, { k: 'build', p, what: 'town', v });
      break;
    }
    case 'road': {
      const e = a.e;
      if (!Number.isInteger(e) || !G(s).EDGES[e]) fail('No such edge');
      if (ph === 'setup') {
        if (s.setupVert == null) fail('Place a homestead first');
        if (!canRoad(s, p, e, s.setupVert)) fail('The trail must touch the homestead you just placed');
        s.roads[e] = p;
        pl.pieces.road--;
        log(s, { k: 'build', p, what: 'road', e });
        s.setupVert = null;
        s.step++;
        updateTrail(s);
        if (s.step >= s.order.length) {
          s.phase = 'roll';
          s.current = s.order[0];
          s.turnNo = 1;
          log(s, { k: 'turn', p: s.current });
        } else s.current = s.order[s.step];
        break;
      }
      if (ph !== 'main' && ph !== 'roads' && ph !== 'raise') fail('You cannot build right now');
      if (pl.pieces.road <= 0) fail('No trails left');
      if (!canRoad(s, p, e)) fail('A trail must connect to your trails or homesteads');
      if (ph === 'main' || ph === 'raise') {
        if (!canPay(pl.res, COST.road)) fail('Not enough resources');
        pay(s, p, COST.road);
      }
      s.roads[e] = p;
      pl.pieces.road--;
      log(s, { k: 'build', p, what: 'road', e, free: ph === 'roads' });
      updateTrail(s);
      if (ph === 'roads') {
        s.freeRoads--;
        if (s.freeRoads <= 0 || pl.pieces.road <= 0 || !roadSpots(s, p).length) s.phase = 'main';
      }
      break;
    }
    case 'pass':
      if (ph !== 'raise') fail('Nothing to pass');
      s.raiseQueue.shift();
      nextRaiser(s);
      break;
    case 'skip':
      if (ph !== 'roads') fail('Nothing to skip');
      s.phase = 'main';
      s.freeRoads = 0;
      break;
    case 'buy': {
      if (ph !== 'main' && ph !== 'raise') fail('You cannot buy right now');
      if (!s.deck.length) fail('The almanac deck is empty');
      if (!canPay(pl.res, COST.card)) fail('Not enough resources');
      pay(s, p, COST.card);
      const card = s.deck.pop();
      if (ph === 'raise') pl.cards[card]++;
      else pl.fresh[card]++;
      log(s, { k: 'buy', p, card });
      break;
    }

    // ---------- dice ----------
    case 'roll': {
      if (ph !== 'roll') fail('You already rolled');
      const d1 = 1 + Math.floor(rand(s) * 6);
      const d2 = 1 + Math.floor(rand(s) * 6);
      s.dice = [d1, d2];
      s.rolled = true;
      const sum = d1 + d2;
      log(s, { k: 'roll', p, dice: [d1, d2] });
      // fast harvest: the dice's own numbers produce even when the total is a 7
      if (sum === 7 && s.fastHarvest) produce(s, harvestNumbers(s, [d1, d2]), sum);
      if (sum === 7) {
        const owe = seatsOf(s).map((q) => {
          const n = total(s.players[q].res);
          return n > 7 ? Math.floor(n / 2) : 0;
        });
        s.banditReturn = 'main';
        if (owe.some((n) => n > 0)) {
          s.discard = owe;
          s.phase = 'discard';
        } else s.phase = 'bandit';
      } else {
        produce(s, harvestNumbers(s, [d1, d2]), sum);
        s.phase = 'main';
      }
      break;
    }
    case 'discard': {
      if (ph !== 'discard') fail('Nothing to discard');
      const d = cleanRes(a.res);
      if (total(d) !== s.discard[p]) fail(`Discard exactly ${s.discard[p]} cards`);
      if (!canPay(pl.res, d)) fail('You do not have those cards');
      pay(s, p, d);
      log(s, { k: 'discard', p, n: total(d) });
      s.discard[p] = 0;
      if (s.discard.every((n) => n === 0)) {
        s.discard = null;
        s.phase = 'bandit';
      }
      break;
    }
    case 'bandit': {
      if (ph !== 'bandit') fail('The bandit is not moving');
      const hex = a.hex;
      if (!banditHexes(s, p).includes(hex)) fail('The bandit must move to a different hex');
      const victims = banditTargets(s, p, hex);
      if (victims.length && !victims.includes(a.victim)) fail('Choose who to rob');
      if (!victims.length && a.victim != null) fail('Nobody to rob there');
      s.bandit = hex;
      log(s, { k: 'bandit', p, hex });
      if (a.victim != null) {
        const vr = s.players[a.victim].res;
        const bag = RES.flatMap((r) => Array(vr[r]).fill(r));
        const r = bag[Math.floor(rand(s) * bag.length)];
        vr[r]--;
        pl.res[r]++;
        log(s, { k: 'steal', p, from: a.victim, res: r });
      }
      s.phase = s.banditReturn;
      break;
    }

    // ---------- almanac cards ----------
    case 'play': {
      const card = a.card;
      if (!CARDS[card]) fail('No such card');
      if (pl.fresh[card] > 0 && pl.cards[card] <= 0) fail('Cards can be played starting next turn');
      if (!playable(s, p, card)) fail(s.cardPlayed ? 'One almanac card per turn' : 'You cannot play that now');
      if (card === 'harvest') {
        const list = Array.isArray(a.res) ? a.res : [];
        if (list.length !== 2 || !list.every((r) => RES.includes(r))) fail('Pick two resources');
        const need = emptyRes();
        for (const r of list) need[r]++;
        if (!RES.every((r) => s.bank[r] >= need[r])) fail('The bank is out of that');
        for (const r of list) {
          s.bank[r]--;
          pl.res[r]++;
        }
        s.gains = { [p]: pick(need) };
      } else if (card === 'market') {
        if (!RES.includes(a.res)) fail('Pick a resource');
        let n = 0;
        for (const q of seatsOf(s)) {
          if (q === p) continue;
          n += s.players[q].res[a.res];
          s.players[q].res[a.res] = 0;
        }
        pl.res[a.res] += n;
        s.gains = n ? { [p]: { [a.res]: n } } : null;
        log(s, { k: 'market', p, res: a.res, n });
      }
      pl.cards[card]--;
      s.cardPlayed = true;
      log(s, { k: 'card', p, card, res: a.res });
      if (card === 'sheriff') {
        pl.sheriffs++;
        if (pl.sheriffs >= 3 && s.posseHolder !== p && (s.posseHolder == null || pl.sheriffs > s.players[s.posseHolder].sheriffs)) {
          log(s, { k: 'award', p, what: 'posse', lost: s.posseHolder });
          s.posseHolder = p;
        }
        s.banditReturn = ph;
        s.phase = 'bandit';
      } else if (card === 'trailblazer') {
        s.freeRoads = Math.min(2, pl.pieces.road);
        if (s.freeRoads > 0 && roadSpots(s, p).length) s.phase = 'roads';
      }
      break;
    }

    // ---------- trading ----------
    case 'bank': {
      if (ph !== 'main') fail('Trade after you roll');
      if (!RES.includes(a.give) || !RES.includes(a.get) || a.give === a.get) fail('Pick two different resources');
      const n = ratio(s, p, a.give);
      if (pl.res[a.give] < n) fail(`You need ${n} ${RES_LABEL[a.give]}`);
      if (s.bank[a.get] <= 0) fail('The bank is out of that');
      pl.res[a.give] -= n;
      s.bank[a.give] += n;
      pl.res[a.get]++;
      s.bank[a.get]--;
      s.bankTrades++;
      log(s, { k: 'bank', p, give: a.give, n, get: a.get });
      break;
    }
    case 'offer': {
      if (ph !== 'main') fail('Trade after you roll');
      if (s.offers >= 3) fail('Three offers per turn');
      const give = cleanRes(a.give);
      const get = cleanRes(a.get);
      if (!total(give) || !total(get)) fail('Offer something and ask for something');
      if (RES.some((r) => give[r] && get[r])) fail('You cannot give and ask for the same thing');
      if (!canPay(pl.res, give)) fail('You do not have those cards');
      s.offers++;
      const resp = {};
      for (const q of seatsOf(s)) if (q !== p) resp[q] = canPay(s.players[q].res, get) ? null : false;
      s.trade = { from: p, give: pick(give), get: pick(get), resp, stage: 'respond' };
      log(s, { k: 'offer', p, give: s.trade.give, get: s.trade.get });
      s.phase = 'trade';
      settleTrade(s);
      break;
    }
    case 'respond': {
      if (ph !== 'trade' || s.trade.stage !== 'respond') fail('No offer to answer');
      if (a.yes && !canPay(pl.res, s.trade.get)) fail('You do not have what they asked for');
      s.trade.resp[p] = !!a.yes;
      settleTrade(s);
      break;
    }
    case 'accept-trade': {
      if (ph !== 'trade' || s.trade.stage !== 'choose' || p !== s.trade.from) fail('No trade to accept');
      const q = a.with;
      if (!s.trade.resp[q]) fail('They did not accept');
      const other = s.players[q];
      if (!canPay(pl.res, s.trade.give) || !canPay(other.res, s.trade.get)) fail('Someone no longer has the cards');
      for (const [r, n] of Object.entries(s.trade.give)) {
        pl.res[r] -= n;
        other.res[r] += n;
      }
      for (const [r, n] of Object.entries(s.trade.get)) {
        other.res[r] -= n;
        pl.res[r] += n;
      }
      log(s, { k: 'trade', p, with: q, give: s.trade.give, get: s.trade.get });
      s.trade = null;
      s.phase = 'main';
      break;
    }
    case 'cancel-trade':
      if (ph !== 'trade' || p !== s.trade.from) fail('No offer to cancel');
      s.trade = null;
      s.phase = 'main';
      break;

    // ---------- end of turn ----------
    case 'end': {
      if (ph !== 'main') fail(ph === 'roll' ? 'Roll the dice first' : 'Finish what you started first');
      for (const c of CARD_TYPES) {
        pl.cards[c] += pl.fresh[c];
        pl.fresh[c] = 0;
      }
      s.cardPlayed = false;
      s.rolled = false;
      s.offers = 0;
      s.bankTrades = 0;
      if (s.raising) {
        // barn raising: everyone else, in turn order, may build before the next turn starts
        const n = s.players.length;
        s.raiseQueue = Array.from({ length: n - 1 }, (_, i) => (s.current + 1 + i) % n);
        s.phase = 'raise';
        nextRaiser(s);
      } else nextTurn(s);
      break;
    }
    default:
      fail('Unknown move');
  }

  if (ph === 'raise' && s.phase === 'raise' && a.type !== 'pass' && s.raiseQueue[0] === p && !canBuildAnything(s, p)) {
    s.raiseQueue.shift();
    nextRaiser(s);
  }

  // you win the moment you reach the target on your own turn
  if (s.phase !== 'setup' && s.phase !== 'over' && points(s, s.current) >= s.target) {
    s.winner = s.current;
    s.phase = 'over';
    s.trade = null;
    log(s, { k: 'win', p: s.current });
  }
  return s;
}

function nextTurn(s) {
  s.raiseQueue = null;
  s.current = (s.current + 1) % s.players.length;
  s.turnNo++;
  s.phase = 'roll';
  log(s, { k: 'turn', p: s.current });
}

// skip players who can't afford anything; when nobody is left, the next turn starts
function nextRaiser(s) {
  while (s.raiseQueue.length && !canBuildAnything(s, s.raiseQueue[0])) s.raiseQueue.shift();
  if (!s.raiseQueue.length) nextTurn(s);
}

export function canBuildAnything(s, p) {
  const pl = s.players[p];
  return (
    (pl.pieces.town > 0 && canPay(pl.res, COST.town) && townSpots(s, p).length > 0) ||
    (pl.pieces.homestead > 0 && canPay(pl.res, COST.homestead) && homesteadSpots(s, p).length > 0) ||
    (pl.pieces.road > 0 && canPay(pl.res, COST.road) && roadSpots(s, p).length > 0) ||
    (s.deck.length > 0 && canPay(pl.res, COST.card))
  );
}

function settleTrade(s) {
  const t = s.trade;
  if (Object.values(t.resp).some((v) => v == null)) return;
  if (Object.values(t.resp).some((v) => v)) t.stage = 'choose';
  else {
    log(s, { k: 'nodeal', p: t.from });
    s.trade = null;
    s.phase = 'main';
  }
}

// The numbers a roll harvests: the total, and with fast harvest each die's own number too
// (once each, so a double 3 harvests 3 and 6). A total of 7 harvests nothing itself.
export function harvestNumbers(s, [d1, d2]) {
  const sum = d1 + d2;
  const nums = s.fastHarvest ? [d1, d2, sum] : [sum];
  return [...new Set(nums)].filter((n) => n >= 2 && n !== 7).sort((a, b) => a - b);
}

// Every tile showing one of `nums` pays its corners (the bandit's tile excepted). The bank
// shortage rule looks at everything a roll pays out at once.
function produce(s, nums, sum) {
  const want = seatsOf(s).map(() => emptyRes());
  G(s).HEXES.forEach((hx, i) => {
    if (!nums.includes(s.hexes[i].n) || i === s.bandit) return;
    const r = TERRAIN[s.hexes[i].t].res;
    for (const v of hx.verts) {
      const b = s.verts[v];
      if (b) want[b.o][r] += b.k === 'town' ? 2 : 1;
    }
  });
  const gains = {};
  for (const r of RES) {
    const need = want.reduce((n, w) => n + w[r], 0);
    if (!need) continue;
    const takers = want.filter((w) => w[r] > 0).length;
    // the bank can't cover everyone: if several players want it, nobody gets it
    if (need > s.bank[r] && takers > 1) continue;
    for (const q of seatsOf(s)) {
      const n = Math.min(want[q][r], s.bank[r]);
      if (!n) continue;
      s.bank[r] -= n;
      s.players[q].res[r] += n;
      (gains[q] ||= {})[r] = n;
    }
  }
  s.gains = Object.keys(gains).length ? gains : null;
  log(s, { k: 'gain', gains: s.gains || {}, sum, nums });
}

// ---------------------------------------------------------------------
// views: strip what this seat may not see
// ---------------------------------------------------------------------
export function view(s, seat) {
  const v = structuredClone(s);
  delete v.rng;
  v.deck = s.deck.length;
  v.seat = seat;
  v.over = s.phase === 'over';
  v.players = s.players.map((pl, q) => {
    const mine = q === seat;
    const showAll = mine || v.over;
    return {
      res: showAll ? pl.res : null,
      cards: showAll ? pl.cards : null,
      fresh: showAll ? pl.fresh : null,
      resCount: total(pl.res),
      cardCount: CARD_TYPES.reduce((n, c) => n + pl.cards[c] + pl.fresh[c], 0),
      sheriffs: pl.sheriffs,
      pieces: pl.pieces,
      vp: publicPoints(s, q),
      points: showAll ? points(s, q) : null,
      harbors: [...harborsOf(s, q)],
    };
  });
  // which resource was stolen or which card was bought is private
  v.log = s.log.map((e) => {
    if (e.k === 'steal' && seat !== e.p && seat !== e.from && !v.over) return { ...e, res: null };
    if (e.k === 'buy' && seat !== e.p && !v.over) return { ...e, card: null };
    return e;
  });
  return v;
}

export function redact(action) {
  return action;
}

export const isOver = (s) => s.phase === 'over';
