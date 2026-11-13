// Chinese Checkers: the star board. Plain data and functions, no DOM; the rules (engine.js),
// the computer players (ai.js) and both boards (board2d.js, scene.js) all use it.
//
// Every hole has cube coordinates (x, y, z) with x + y + z = 0. The star is two big
// triangles laid over each other: { x, y, z ≤ 4 } and { x, y, z ≥ −4 }. Together they make a
// hexagon of 61 holes in the middle and six points of 10 holes each: 121 holes in all.
//
// The six points are numbered clockwise as you look at the screen, starting at the bottom:
//   0 bottom · 1 bottom-left · 2 top-left · 3 top · 4 top-right · 5 bottom-right
// Point p's opposite is point (p + 3) % 6.

export const POINTS = [
  { axis: 'z', sign: 1 },
  { axis: 'x', sign: -1 },
  { axis: 'y', sign: 1 },
  { axis: 'z', sign: -1 },
  { axis: 'x', sign: 1 },
  { axis: 'y', sign: -1 },
];
export const opposite = (p) => (p + 3) % 6;

// Which points the players start in, by number of players. Turns go round clockwise.
export const SEATING = {
  2: [0, 3],
  3: [0, 2, 4],
  4: [0, 1, 3, 4],
  6: [0, 1, 2, 3, 4, 5],
};

const inStar = (x, y, z) => (x <= 4 && y <= 4 && z <= 4) || (x >= -4 && y >= -4 && z >= -4);

// CELLS[i] = { i, x, y, z, point, depth }
//   point: which of the six points the hole is in (-1 for the middle hexagon)
//   depth: rows from that point's tip (0 at the tip, 3 at its widest row)
export const CELLS = [];
const index = new Map();
for (let z = -8; z <= 8; z++)
  for (let x = -8; x <= 8; x++) {
    const y = -x - z;
    if (!inStar(x, y, z)) continue;
    const c = { i: CELLS.length, x, y, z, point: -1, depth: -1 };
    POINTS.forEach((p, n) => {
      const v = p.sign * c[p.axis];
      if (v > 4) (c.point = n), (c.depth = 8 - v);
    });
    index.set(`${x},${z}`, c.i);
    CELLS.push(c);
  }
export const N = CELLS.length; // 121
export const cellAt = (x, z) => index.get(`${x},${z}`) ?? null;

// the six directions, and for each hole its neighbour and the hole two steps away in each
const DIRS = [[1, -1, 0], [1, 0, -1], [0, 1, -1], [-1, 1, 0], [-1, 0, 1], [0, -1, 1]];
export const NEIGHBORS = CELLS.map((c) => DIRS.map(([dx, , dz]) => cellAt(c.x + dx, c.z + dz)));
export const JUMPS = CELLS.map((c) => DIRS.map(([dx, , dz]) => cellAt(c.x + 2 * dx, c.z + 2 * dz)));

export const dist = (a, b) => {
  const p = CELLS[a], q = CELLS[b];
  return Math.max(Math.abs(p.x - q.x), Math.abs(p.y - q.y), Math.abs(p.z - q.z));
};

// the hole at the very tip of each point
export const TIP = POINTS.map((_, p) => CELLS.find((c) => c.point === p && c.depth === 0).i);

// The holes a full set of marbles fills in a point: 10 marbles fill all four rows, 6 marbles
// the three rows nearest the tip, 3 marbles the two nearest.
const ROWS = { 10: 4, 6: 3, 3: 2 };
export function camp(point, pieces = 10) {
  const rows = ROWS[pieces] ?? 4;
  return CELLS.filter((c) => c.point === point && c.depth < rows).map((c) => c.i);
}

// Where a hole is drawn, in units of one hole spacing, with +y pointing down the screen.
// `turns` spins the board clockwise in 60° steps (so each player can see their own point at the
// bottom): one turn moves point p to where point p + 1 was.
export function layout(i, turns = 0) {
  let { x, y, z } = CELLS[i];
  for (let k = 0; k < ((turns % 6) + 6) % 6; k++) [x, y, z] = [-z, -x, -y];
  return { px: x + z / 2, py: (z * Math.sqrt(3)) / 2 };
}
// how many turns put point `home` at the bottom
export const turnsFor = (home) => (home == null ? 0 : (6 - home) % 6);

// the corners of the two big triangles, in layout units, for drawing the star's outline
export const STAR = [
  [[4, 4, -8], [4, -8, 4], [-8, 4, 4]],
  [[-4, -4, 8], [-4, 8, -4], [8, -4, -4]],
].map((tri) => tri.map(([x, , z]) => [x + z / 2, (z * Math.sqrt(3)) / 2]));
