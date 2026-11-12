// Hexstead board geometry: the shape of the island, its corners (where homesteads go), its
// edges (where trails go), and the harbor slots on the coast. Pure data with no DOM, shared by
// the rules engine, the computer players and the 3D screen.
//
// Three islands:
//   base   19 hexes (3–4 players)   rows 3-4-5-4-3
//   large  30 hexes (5–6 players)   rows 3-4-5-6-5-4-3
//   huge   37 hexes (7–8 players)   rows 4-5-6-7-6-5-4
//
// Hexes are "pointy-top" with a circumradius of 1 world unit. Axial coordinates (q, r):
//   x = √3 · (q + r/2),  z = 1.5 · r      (z grows toward the viewer)

const SQ3 = Math.sqrt(3);

export const BOARD_SIZES = {
  base: { label: 'Island', radius: 2, trim: false, harbors: 9 },
  large: { label: 'Big island', radius: 3, trim: true, harbors: 11 },
  huge: { label: 'Grand island', radius: 3, trim: false, harbors: 13 },
};
export const sizeFor = (players) => (players >= 7 ? 'huge' : players >= 5 ? 'large' : 'base');

const cache = new Map();

export function board(size = 'base') {
  if (cache.has(size)) return cache.get(size);
  const cfg = BOARD_SIZES[size] || BOARD_SIZES.base;
  const R = cfg.radius;

  // hexes in reading order (back row first, left to right)
  const HEXES = [];
  for (let r = -R; r <= R; r++) {
    let qs = [];
    for (let q = -R; q <= R; q++) if (Math.abs(q + r) <= R) qs.push(q);
    if (cfg.trim) qs = qs.slice(0, -1); // one hex shorter per row: 3-4-5-6-5-4-3
    for (const q of qs) HEXES.push({ q, r, x: SQ3 * (q + r / 2), z: 1.5 * r, verts: [], edges: [], near: [] });
  }
  // centre the island
  const cx = HEXES.reduce((a, h) => a + h.x, 0) / HEXES.length;
  for (const h of HEXES) h.x -= cx;

  const vKey = (x, z) => `${Math.round(x * 1000)},${Math.round(z * 1000)}`;
  const corner = (hx, i) => {
    const a = ((60 * i - 30) * Math.PI) / 180;
    return [hx.x + Math.cos(a), hx.z + Math.sin(a)];
  };

  // corners
  const vIndex = new Map();
  const raw = [];
  for (const hx of HEXES)
    for (let i = 0; i < 6; i++) {
      const [x, z] = corner(hx, i);
      const k = vKey(x, z);
      if (!vIndex.has(k)) {
        vIndex.set(k, -1);
        raw.push({ x, z, k });
      }
    }
  raw.sort((a, b) => a.z - b.z || a.x - b.x);
  const VERTS = raw.map((v, i) => {
    vIndex.set(v.k, i);
    return { x: v.x, z: v.z, hexes: [], edges: [], adj: [] };
  });

  // edges
  const eIndex = new Map();
  const EDGES = [];
  HEXES.forEach((hx, hi) => {
    for (let i = 0; i < 6; i++) {
      const a = vIndex.get(vKey(...corner(hx, i)));
      const b = vIndex.get(vKey(...corner(hx, (i + 1) % 6)));
      hx.verts.push(a);
      if (!VERTS[a].hexes.includes(hi)) VERTS[a].hexes.push(hi);
      const [lo, hiV] = a < b ? [a, b] : [b, a];
      const k = `${lo}-${hiV}`;
      let ei = eIndex.get(k);
      if (ei == null) {
        ei = EDGES.length;
        eIndex.set(k, ei);
        EDGES.push({ a: lo, b: hiV, hexes: [], x: (VERTS[lo].x + VERTS[hiV].x) / 2, z: (VERTS[lo].z + VERTS[hiV].z) / 2 });
        VERTS[lo].edges.push(ei);
        VERTS[hiV].edges.push(ei);
        VERTS[lo].adj.push(hiV);
        VERTS[hiV].adj.push(lo);
      }
      EDGES[ei].hexes.push(hi);
      hx.edges.push(ei);
    }
  });

  // neighbouring hexes (share an edge)
  for (const e of EDGES)
    if (e.hexes.length === 2) {
      const [a, b] = e.hexes;
      HEXES[a].near.push(b);
      HEXES[b].near.push(a);
    }

  // the coast: edges that belong to a single hex, in order around the island
  const COAST = EDGES.map((e, i) => i)
    .filter((i) => EDGES[i].hexes.length === 1)
    .sort((i, j) => Math.atan2(EDGES[i].z, EDGES[i].x) - Math.atan2(EDGES[j].z, EDGES[j].x));

  // harbor slots spaced around the coast; each knows which way is "out to sea"
  const at = size === 'base' ? [0, 3, 7, 10, 13, 17, 20, 23, 27] : spaced(COAST.length, cfg.harbors);
  const HARBOR_SLOTS = at.map((n) => {
    const e = COAST[n];
    const ed = EDGES[e];
    const hx = HEXES[ed.hexes[0]];
    const dx = ed.x - hx.x;
    const dz = ed.z - hx.z;
    const len = Math.hypot(dx, dz);
    return { edge: e, verts: [ed.a, ed.b], x: ed.x, z: ed.z, nx: dx / len, nz: dz / len };
  });

  const extent = {
    x: Math.max(...VERTS.map((v) => Math.abs(v.x))),
    z: Math.max(...VERTS.map((v) => Math.abs(v.z))),
  };
  const otherEnd = (e, v) => (EDGES[e].a === v ? EDGES[e].b : EDGES[e].a);
  const g = { size, HEXES, VERTS, EDGES, COAST, HARBOR_SLOTS, extent, otherEnd };
  cache.set(size, g);
  return g;
}

// n slots spread evenly over a ring of `count` coastal edges, never on neighbouring edges
function spaced(count, n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(Math.round((i * count) / n) % count);
  return out;
}

// the standard island, for code that only ever uses it
const base = board('base');
export const HEXES = base.HEXES;
export const VERTS = base.VERTS;
export const EDGES = base.EDGES;
export const COAST = base.COAST;
export const HARBOR_SLOTS = base.HARBOR_SLOTS;
export const otherEnd = base.otherEnd;

export const PIPS = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 };
