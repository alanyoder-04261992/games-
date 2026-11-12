// Hexstead board geometry: the fixed shape of the island (19 hexes), its corners (where
// homesteads go), its edges (where trails go), and the harbor slots on the coast.
// Pure data with no DOM, shared by the rules engine, the computer players and the 3D screen.
//
// Hexes are "pointy-top" with a circumradius of 1 world unit. Axial coordinates (q, r):
//   x = √3 · (q + r/2),  z = 1.5 · r      (z grows toward the viewer)

const SQ3 = Math.sqrt(3);

// 19 hexes in reading order (back row first, left to right)
export const HEXES = [];
for (let r = -2; r <= 2; r++) {
  for (let q = -2; q <= 2; q++) {
    if (Math.abs(q + r) > 2) continue;
    HEXES.push({ q, r, x: SQ3 * (q + r / 2), z: 1.5 * r, verts: [], edges: [], near: [] });
  }
}

const vKey = (x, z) => `${Math.round(x * 1000)},${Math.round(z * 1000)}`;
const corner = (hx, i) => {
  const a = ((60 * i - 30) * Math.PI) / 180;
  return [hx.x + Math.cos(a), hx.z + Math.sin(a)];
};

// corners
const vIndex = new Map();
const rawVerts = [];
for (const hx of HEXES)
  for (let i = 0; i < 6; i++) {
    const [x, z] = corner(hx, i);
    const k = vKey(x, z);
    if (!vIndex.has(k)) {
      vIndex.set(k, -1);
      rawVerts.push({ x, z, k });
    }
  }
rawVerts.sort((a, b) => a.z - b.z || a.x - b.x);
export const VERTS = rawVerts.map((v, i) => {
  vIndex.set(v.k, i);
  return { x: v.x, z: v.z, hexes: [], edges: [], adj: [] };
});

// edges
const eIndex = new Map();
export const EDGES = [];
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

export const otherEnd = (e, v) => (EDGES[e].a === v ? EDGES[e].b : EDGES[e].a);
export const edgeBetween = (a, b) => VERTS[a].edges.find((e) => otherEnd(e, a) === b);

// The coast: edges that belong to a single hex, in order around the island.
export const COAST = EDGES.map((e, i) => i)
  .filter((i) => EDGES[i].hexes.length === 1)
  .sort((i, j) => Math.atan2(EDGES[i].z, EDGES[i].x) - Math.atan2(EDGES[j].z, EDGES[j].x));

// Nine harbor slots spaced around the 30 coastal edges. Each knows which way is "out to sea".
const SLOT_AT = [0, 3, 7, 10, 13, 17, 20, 23, 27];
export const HARBOR_SLOTS = SLOT_AT.map((n) => {
  const e = COAST[n];
  const ed = EDGES[e];
  const hx = HEXES[ed.hexes[0]];
  const dx = ed.x - hx.x;
  const dz = ed.z - hx.z;
  const len = Math.hypot(dx, dz);
  return { edge: e, verts: [ed.a, ed.b], x: ed.x, z: ed.z, nx: dx / len, nz: dz / len };
});

export const PIPS = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 };
