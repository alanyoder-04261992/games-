// Roofline rules engine: plain functions, no DOM. The host runs these.
//
// Each player shingles a 5 × 5 shed roof. Bundles of shingles in five colors sit on pallets in
// the lumber yard. On your turn take every bundle of one color from one pallet (the rest slide
// into the yard) or every bundle of one color from the yard, and stack them on one of your five
// staging racks. A full rack nails one shingle onto its roof row at the end of the round; extra
// bundles fall in the gutter and cost points. The round after someone finishes a whole roof row,
// the game ends and roof bonuses are paid.

export const COLORS = ['cedar', 'slate', 'barn', 'forest', 'sand'];
export const COLOR_NAMES = ['Cedar', 'Slate', 'Barn Red', 'Forest', 'Sand'];
export const SIZE = 5;
export const PER_COLOR = 20;
export const PER_PALLET = 4;
export const GUTTER = [-1, -1, -2, -2, -2, -3, -3]; // penalty for each gutter slot
export const BONUS = { row: 2, column: 5, color: 8, dormer: 2 };
export const YARD = -1; // `src` for the yard
export const PALLETS = { 2: 5, 3: 7, 4: 9 };

// The roof's color layout: every row and every column holds each color once.
export const roofColor = (r, c) => (c + 2 * r) % SIZE;
export const roofCol = (r, color) => (((color - 2 * r) % SIZE) + SIZE * 2) % SIZE;
export const cell = (r, c) => r * SIZE + c;

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
const sum = (a) => a.reduce((n, x) => n + x, 0);

function draw(s) {
  if (sum(s.bag) === 0) {
    // the bag is empty: the scrap bin goes back in
    s.bag = s.scrap;
    s.scrap = COLORS.map(() => 0);
    s.refills++;
  }
  const total = sum(s.bag);
  if (total === 0) return null;
  let k = Math.floor(rand(s) * total);
  for (let c = 0; c < COLORS.length; c++) {
    if (k < s.bag[c]) {
      s.bag[c]--;
      return c;
    }
    k -= s.bag[c];
  }
  return null;
}

function fillPallets(s) {
  s.pallets = Array.from({ length: PALLETS[s.n] }, () => {
    const p = [];
    for (let i = 0; i < PER_PALLET; i++) {
      const c = draw(s);
      if (c != null) p.push(c);
    }
    return p.sort((a, b) => a - b);
  });
  s.yard = COLORS.map(() => 0);
  s.whistle = true; // the foreman's whistle sits in the yard until someone takes from it
}

// Points for nailing a shingle at (r, c): the length of the run across it plus the run down
// it, or 1 for a shingle with no neighbours.
export function placeScore(roof, r, c) {
  const filled = (rr, cc) => rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE && roof[cell(rr, cc)];
  let h = 1;
  for (let x = c - 1; filled(r, x); x--) h++;
  for (let x = c + 1; filled(r, x); x++) h++;
  let v = 1;
  for (let y = r - 1; filled(y, c); y--) v++;
  for (let y = r + 1; filled(y, c); y++) v++;
  if (h === 1 && v === 1) return 1;
  return (h > 1 ? h : 0) + (v > 1 ? v : 0);
}

export function roofBonuses(roof) {
  let rows = 0, cols = 0, colors = 0;
  for (let r = 0; r < SIZE; r++) if ([0, 1, 2, 3, 4].every((c) => roof[cell(r, c)])) rows++;
  for (let c = 0; c < SIZE; c++) if ([0, 1, 2, 3, 4].every((r) => roof[cell(r, c)])) cols++;
  for (let k = 0; k < SIZE; k++) if ([0, 1, 2, 3, 4].every((r) => roof[cell(r, roofCol(r, k))])) colors++;
  return { rows, cols, colors, points: rows * BONUS.row + cols * BONUS.column + colors * BONUS.color };
}

export const gutterPenalty = (count) => sum(GUTTER.slice(0, count));

// ---------------------------------------------------------------------
// the engine
// ---------------------------------------------------------------------
export function setup({ seed = 1, options = {} } = {}) {
  const n = Math.min(4, Math.max(2, Number(options.players) || 2));
  const s = {
    n,
    rng: seed >>> 0 || 1,
    round: 0,
    phase: 'draft',
    turn: 0,
    first: 0,
    nextFirst: null,
    whistle: true,
    bag: COLORS.map(() => PER_COLOR),
    scrap: COLORS.map(() => 0),
    refills: 0,
    pallets: [],
    yard: COLORS.map(() => 0),
    dormers: [],
    players: Array.from({ length: n }, () => ({
      score: 0,
      racks: Array.from({ length: SIZE }, () => ({ color: null, count: 0 })),
      roof: Array(SIZE * SIZE).fill(0),
      gutter: [], // colors (or 'whistle') in gutter order
    })),
    last: null, // the most recent take, for the screen to animate
    tally: null, // what each player scored at the end of the last round
    winners: null,
    final: null,
  };
  // three dormer squares (the same on every roof) are worth extra when they're shingled
  if (options.dormers !== false) {
    const cells = [...Array(SIZE * SIZE).keys()];
    for (let i = 0; i < 3; i++) s.dormers.push(cells.splice(Math.floor(rand(s) * cells.length), 1)[0]);
    s.dormers.sort((a, b) => a - b);
  }
  s.first = s.turn = Math.floor(rand(s) * n);
  startRound(s);
  return s;
}

function startRound(s) {
  s.round++;
  fillPallets(s);
}

export const actors = (s) => (s.phase === 'draft' ? [s.turn] : []);
export const isOver = (s) => s.phase === 'over';

// can a rack take this color?
export function rackOpen(pl, r, color) {
  const rack = pl.racks[r];
  if (rack.count >= r + 1) return false;
  if (rack.color != null && rack.color !== color) return false;
  return !pl.roof[cell(r, roofCol(r, color))];
}

export function sources(s) {
  const out = [];
  s.pallets.forEach((p, i) => {
    for (const c of new Set(p)) out.push({ src: i, color: c, count: p.filter((x) => x === c).length });
  });
  s.yard.forEach((k, c) => k && out.push({ src: YARD, color: c, count: k }));
  return out;
}

export function legal(s, seat) {
  if (!actors(s).includes(seat)) return [];
  const pl = s.players[seat];
  const out = [];
  for (const { src, color } of sources(s)) {
    for (let r = 0; r < SIZE; r++) if (rackOpen(pl, r, color)) out.push({ type: 'take', src, color, rack: r });
    out.push({ type: 'take', src, color, rack: -1 }); // straight into the gutter
  }
  return out;
}

export function check(s, seat, a) {
  if (!actors(s).includes(seat)) return 'It is not your turn';
  if (a?.type !== 'take') return 'Unknown move';
  const from = a.src === YARD ? null : s.pallets[a.src];
  const have = a.src === YARD ? s.yard[a.color] : from ? from.filter((x) => x === a.color).length : 0;
  if (!have) return 'There are no bundles of that color there';
  if (a.rack !== -1 && !(a.rack >= 0 && a.rack < SIZE)) return 'Pick one of your racks';
  if (a.rack !== -1 && !rackOpen(s.players[seat], a.rack, a.color)) return 'That rack can’t take this color';
  return null;
}

function toGutter(s, pl, item) {
  if (pl.gutter.length < GUTTER.length) pl.gutter.push(item);
  else if (item !== 'whistle') s.scrap[item]++;
}

export function apply(prev, seat, a) {
  const err = check(prev, seat, a);
  if (err) throw new Error(err);
  const s = structuredClone(prev);
  const pl = s.players[seat];
  let count;
  let whistle = false;
  if (a.src === YARD) {
    count = s.yard[a.color];
    s.yard[a.color] = 0;
    if (s.whistle) {
      // first into the yard this round: start next round, but the whistle costs a gutter slot
      s.whistle = false;
      s.nextFirst = seat;
      whistle = true;
      toGutter(s, pl, 'whistle');
    }
  } else {
    const p = s.pallets[a.src];
    count = p.filter((x) => x === a.color).length;
    for (const x of p) if (x !== a.color) s.yard[x]++;
    s.pallets[a.src] = [];
  }
  let placed = 0;
  if (a.rack >= 0) {
    const rack = pl.racks[a.rack];
    placed = Math.min(count, a.rack + 1 - rack.count);
    rack.color = a.color;
    rack.count += placed;
  }
  for (let i = placed; i < count; i++) toGutter(s, pl, a.color);
  s.last = { seat, src: a.src, color: a.color, count, rack: a.rack, placed, gutter: count - placed, whistle, round: s.round };

  const empty = s.pallets.every((p) => p.length === 0) && sum(s.yard) === 0;
  if (empty) endRound(s);
  else s.turn = (s.turn + 1) % s.n;
  return s;
}

function endRound(s) {
  s.tally = s.players.map((pl) => {
    const nailed = [];
    for (let r = 0; r < SIZE; r++) {
      const rack = pl.racks[r];
      if (rack.count !== r + 1) continue;
      const c = roofCol(r, rack.color);
      pl.roof[cell(r, c)] = 1;
      let pts = placeScore(pl.roof, r, c);
      const dormer = s.dormers.includes(cell(r, c));
      if (dormer) pts += BONUS.dormer;
      pl.score += pts;
      nailed.push({ cell: cell(r, c), color: rack.color, points: pts, dormer });
      s.scrap[rack.color] += r; // the rest of the rack goes in the scrap bin
      pl.racks[r] = { color: null, count: 0 };
    }
    const penalty = gutterPenalty(pl.gutter.length);
    const before = pl.score;
    pl.score = Math.max(0, pl.score + penalty);
    for (const g of pl.gutter) if (g !== 'whistle') s.scrap[g]++;
    pl.gutter = [];
    return { nailed, penalty: pl.score - before };
  });
  s.tally.round = s.round;

  const done = s.players.some((pl) => roofBonuses(pl.roof).rows > 0);
  if (done) return finish(s);
  s.first = s.turn = s.nextFirst ?? (s.first + 1) % s.n;
  s.nextFirst = null;
  startRound(s);
}

function finish(s) {
  s.final = s.players.map((pl) => {
    const b = roofBonuses(pl.roof);
    pl.score += b.points;
    return b;
  });
  s.phase = 'over';
  s.pallets = s.pallets.map(() => []);
  const best = Math.max(...s.players.map((p) => p.score));
  let top = s.players.map((p, i) => i).filter((i) => s.players[i].score === best);
  const rows = (i) => s.final[i].rows;
  const mostRows = Math.max(...top.map(rows));
  top = top.filter((i) => rows(i) === mostRows);
  s.winners = top;
}

export function view(s, seat) {
  const v = structuredClone(s);
  delete v.rng;
  v.bag = sum(s.bag); // how many are left, not which
  v.seat = seat;
  return v;
}

// total shingles in the game, wherever they are (for tests)
export function census(s) {
  const t = COLORS.map(() => 0);
  const add = (c, k = 1) => (t[c] += k);
  s.bag.forEach((k, c) => add(c, k));
  s.scrap.forEach((k, c) => add(c, k));
  s.yard.forEach((k, c) => add(c, k));
  s.pallets.flat().forEach((c) => add(c));
  for (const pl of s.players) {
    pl.racks.forEach((r) => r.count && add(r.color, r.count));
    pl.gutter.forEach((g) => g !== 'whistle' && add(g));
    pl.roof.forEach((f, i) => f && add(roofColor(Math.floor(i / SIZE), i % SIZE)));
  }
  return t;
}
