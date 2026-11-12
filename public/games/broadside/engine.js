// Broadside rules engine. Plain functions with no DOM; only the host runs them.
//
// Two admirals hide a fleet on their own grid, then take turns firing at squares of the
// other grid. A ship sinks when every square it covers has been hit. Sink the whole enemy
// fleet to win.
//
// Modes:  classic  one shot per turn
//         chain    a hit earns another shot
//         barrage  one shot for every ship you still have afloat

export const SHIPS = {
  flagship: { name: 'Flagship', len: 5 },
  dreadnought: { name: 'Dreadnought', len: 4 },
  frigate: { name: 'Frigate', len: 3 },
  submarine: { name: 'Submarine', len: 3 },
  cutter: { name: 'Cutter', len: 3 },
  patrol: { name: 'Patrol Boat', len: 2 },
};
export const FLEETS = {
  8: ['dreadnought', 'frigate', 'submarine', 'patrol'],
  10: ['flagship', 'dreadnought', 'frigate', 'submarine', 'patrol'],
  12: ['flagship', 'dreadnought', 'frigate', 'cutter', 'submarine', 'patrol'],
};
export const MODES = ['classic', 'chain', 'barrage'];
export const COLS = 'ABCDEFGHIJKL';
export const cellName = (size, i) => `${COLS[i % size]}${Math.floor(i / size) + 1}`;

function fail(msg) {
  throw new Error(msg);
}
function rng(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// the squares a ship covers, or null if it runs off the grid
export function shipCells(size, x, y, dir, len) {
  const out = [];
  for (let k = 0; k < len; k++) {
    const cx = dir === 'h' ? x + k : x;
    const cy = dir === 'v' ? y + k : y;
    if (cx < 0 || cy < 0 || cx >= size || cy >= size) return null;
    out.push(cy * size + cx);
  }
  return out;
}

// A random legal fleet. With `apart`, ships never touch, even at the corners.
export function randomFleet(size, ids, rand = Math.random, apart = true) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const taken = new Set();
    const blocked = new Set();
    const out = [];
    let ok = true;
    for (const id of [...ids].sort((a, b) => SHIPS[b].len - SHIPS[a].len)) {
      let placed = false;
      for (let tries = 0; tries < 300 && !placed; tries++) {
        const dir = rand() < 0.5 ? 'h' : 'v';
        const x = Math.floor(rand() * size);
        const y = Math.floor(rand() * size);
        const cells = shipCells(size, x, y, dir, SHIPS[id].len);
        if (!cells || cells.some((c) => taken.has(c) || (apart && blocked.has(c)))) continue;
        for (const c of cells) {
          taken.add(c);
          const cx = c % size, cy = Math.floor(c / size);
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const nx = cx + dx, ny = cy + dy;
              if (nx >= 0 && ny >= 0 && nx < size && ny < size) blocked.add(ny * size + nx);
            }
        }
        out.push({ id, x, y, dir });
        placed = true;
      }
      if (!placed) {
        ok = false;
        break;
      }
    }
    if (ok) return ids.map((id) => out.find((s) => s.id === id));
  }
  return randomFleet(size, ids, rand, false);
}

export function setup({ seed = 1, options = {} } = {}) {
  const size = [8, 10, 12].includes(Number(options.size)) ? Number(options.size) : 10;
  const mode = MODES.includes(options.mode) ? options.mode : 'classic';
  const r = rng(seed);
  return {
    seed: seed >>> 0,
    size,
    mode,
    fleet: FLEETS[size],
    phase: 'place',
    boards: [0, 1].map(() => ({ ships: null, shots: [] })), // shots: fired AT this board
    first: r() < 0.5 ? 0 : 1,
    turn: null,
    shotsLeft: 0,
    turnNo: 0,
    last: null,
    winner: null,
  };
}

const afloat = (board) => (board.ships || []).filter((sh) => !sh.sunk).length;
const shotsFor = (s, seat) => (s.mode === 'barrage' ? Math.max(1, afloat(s.boards[seat])) : 1);

export function actors(s) {
  if (s.phase === 'place') return [0, 1].filter((p) => !s.boards[p].ships);
  if (s.phase === 'battle') return [s.turn];
  return [];
}

export function legal(s, seat) {
  if (!actors(s).includes(seat)) return [];
  if (s.phase === 'place') return [{ type: 'place', ships: randomFleet(s.size, s.fleet, rng(s.seed ^ (seat + 1) * 2654435761)) }];
  const fired = new Set(s.boards[1 - seat].shots.map((x) => x.i));
  const out = [];
  for (let i = 0; i < s.size * s.size; i++) if (!fired.has(i)) out.push({ type: 'fire', i });
  return out;
}

export function check(s, seat, a) {
  try {
    apply(s, seat, a);
    return null;
  } catch (e) {
    return e.message;
  }
}

export function apply(prev, seat, a) {
  if (!a || typeof a !== 'object') fail('No move');
  if (!actors(prev).includes(seat)) fail(prev.phase === 'place' ? 'Your fleet is already placed' : 'It is not your turn');
  const s = structuredClone(prev);
  const N = s.size;

  if (a.type === 'place') {
    if (s.phase !== 'place') fail('Ships are already placed');
    const list = Array.isArray(a.ships) ? a.ships : [];
    if (list.length !== s.fleet.length) fail('Place your whole fleet');
    const used = new Set();
    const ships = [];
    for (const id of s.fleet) {
      const p = list.find((x) => x?.id === id);
      if (!p) fail(`Place your ${SHIPS[id].name}`);
      if (!['h', 'v'].includes(p.dir) || !Number.isInteger(p.x) || !Number.isInteger(p.y)) fail('Bad position');
      const cells = shipCells(N, p.x, p.y, p.dir, SHIPS[id].len);
      if (!cells) fail(`Your ${SHIPS[id].name} runs off the grid`);
      if (cells.some((c) => used.has(c))) fail('Ships cannot overlap');
      cells.forEach((c) => used.add(c));
      ships.push({ id, len: SHIPS[id].len, x: p.x, y: p.y, dir: p.dir, cells, hits: 0, sunk: false });
    }
    s.boards[seat].ships = ships;
    if (s.boards.every((b) => b.ships)) {
      s.phase = 'battle';
      s.turn = s.first;
      s.turnNo = 1;
      s.shotsLeft = shotsFor(s, s.turn);
    }
    return s;
  }

  if (a.type === 'fire') {
    if (s.phase !== 'battle') fail('The battle has not started');
    const i = a.i;
    if (!Number.isInteger(i) || i < 0 || i >= N * N) fail('Pick a square on the grid');
    const target = s.boards[1 - seat];
    if (target.shots.some((x) => x.i === i)) fail('You already fired there');
    const ship = target.ships.find((sh) => sh.cells.includes(i));
    const shot = { i, hit: !!ship, sunk: null, by: seat, n: target.shots.length + 1 };
    if (ship) {
      ship.hits++;
      if (ship.hits >= ship.len) {
        ship.sunk = true;
        shot.sunk = ship.id;
      }
    }
    target.shots.push(shot);
    s.last = { ...shot, target: 1 - seat };
    if (target.ships.every((sh) => sh.sunk)) {
      s.phase = 'over';
      s.winner = seat;
      s.turn = null;
      return s;
    }
    // whose shot is next?
    let again = false;
    if (s.mode === 'chain') again = shot.hit;
    if (s.mode === 'barrage') {
      s.shotsLeft--;
      again = s.shotsLeft > 0 && legal({ ...s, turn: seat }, seat).length > 0;
    }
    if (!again) {
      s.turn = 1 - seat;
      s.turnNo++;
      s.shotsLeft = shotsFor(s, s.turn);
    }
    return s;
  }
  fail('Unknown move');
}

// What a seat may see: its own fleet, and only the enemy ships that have been sunk.
export function view(s, seat) {
  const v = structuredClone(s);
  delete v.seed;
  v.seat = seat;
  const over = s.phase === 'over';
  v.boards = s.boards.map((b, k) => {
    const mine = k === seat;
    return {
      placed: !!b.ships,
      afloat: afloat(b),
      shots: b.shots,
      ships: mine || over ? b.ships : (b.ships || []).filter((sh) => sh.sunk),
    };
  });
  return v;
}

export const isOver = (s) => s.phase === 'over';

export function stats(s, seat) {
  const shots = s.boards[1 - seat].shots.filter((x) => x.by === seat);
  const hits = shots.filter((x) => x.hit).length;
  return { shots: shots.length, hits, accuracy: shots.length ? Math.round((hits / shots.length) * 100) : 0 };
}
