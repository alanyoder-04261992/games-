// Hexstead scenery: the pines and leafy trees, sheep, wheat, clay pits and brick kilns, quarry
// peaks and mines, and desert cacti that dress the island's tiles.
//
// Each prop is built from simple shapes merged into one geometry with its colours baked into
// the vertices: darker toward the ground (a cheap ambient-occlusion), lighter toward the tips
// and with a little per-face variation. One prop is then one instanced draw call, however many
// parts it has, and every copy gets its own slight tint so no two trees or sheep look alike.
import * as THREE from '../../vendor/three/three.webgpu.min.js';
import { mergeGeometries } from '../../vendor/three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from '../../vendor/three/addons/geometries/RoundedBoxGeometry.js';

// ---------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------
export function rng(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const hash = (a, b = 0, c = 0) => {
  const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453;
  return s - Math.floor(s);
};
// smooth, repeatable bumps (same input, same output, so shared vertices move together)
const noise3 = (x, y, z, s) =>
  (Math.sin(x * 1.7 + s) * Math.sin(y * 2.3 + s * 1.3) * Math.sin(z * 1.9 + s * 0.7) + 0.5 * Math.sin(x * 3.9 + y * 2.1 + s * 2.1) * Math.sin(z * 4.3 - y * 1.1 + s)) / 1.5;

// non-indexed, no uvs, with normals: every part merges with every other
function prep(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g.attributes.uv) g.deleteAttribute('uv');
  if (!g.attributes.normal) g.computeVertexNormals();
  return g;
}

// Colour a part: `color` at y0 blending to `top` at y1, darkened toward y0 by `ao`, each
// triangle nudged lighter or darker by up to `vary`.
const COL = new THREE.Color();
function paint(geo, color, { top, y0, y1, ao = 0, vary = 0, seed = 7 } = {}) {
  const g = prep(geo);
  const pos = g.attributes.position;
  if (y0 == null || y1 == null) {
    g.computeBoundingBox();
    y0 ??= g.boundingBox.min.y;
    y1 ??= g.boundingBox.max.y;
  }
  const a = new THREE.Color(color);
  const b = top ? new THREE.Color(top) : a;
  const r = rng(seed);
  const out = new Float32Array(pos.count * 3);
  let v = 1;
  for (let i = 0; i < pos.count; i++) {
    if (i % 3 === 0) v = 1 + (r() - 0.5) * vary;
    const k = clamp01((pos.getY(i) - y0) / (y1 - y0 || 1));
    COL.copy(a).lerp(b, k);
    const s = (1 - ao * (1 - k)) * v;
    out[i * 3] = COL.r * s;
    out[i * 3 + 1] = COL.g * s;
    out[i * 3 + 2] = COL.b * s;
  }
  g.setAttribute('color', new THREE.BufferAttribute(out, 3));
  return g;
}

// Colour each triangle with fn(centre, normal, index) → THREE.Color.
function paintFaces(geo, fn) {
  const g = prep(geo);
  const pos = g.attributes.position;
  const out = new Float32Array(pos.count * 3);
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
  const n = new THREE.Vector3(), cen = new THREE.Vector3(), e = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    A.fromBufferAttribute(pos, i);
    B.fromBufferAttribute(pos, i + 1);
    C.fromBufferAttribute(pos, i + 2);
    n.subVectors(C, B).cross(e.subVectors(A, B)).normalize();
    cen.copy(A).add(B).add(C).divideScalar(3);
    const c = fn(cen, n, i / 3);
    for (let k = 0; k < 3; k++) {
      out[(i + k) * 3] = c.r;
      out[(i + k) * 3 + 1] = c.g;
      out[(i + k) * 3 + 2] = c.b;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(out, 3));
  return g;
}

// push every vertex in or out along its direction from the centre: rocks and leaf clumps
function lumpy(geo, amt, seed = 1, freq = 9) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const len = v.length();
    if (len < 1e-6) continue;
    v.setLength(len + amt * noise3(v.x * freq, v.y * freq, v.z * freq, seed));
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

const merge = (parts) => mergeGeometries(parts, false);
const M = new THREE.Matrix4();
const E = new THREE.Euler();
const place = (geo, x, y, z, rx = 0, ry = 0, rz = 0) => geo.applyMatrix4(M.makeRotationFromEuler(E.set(rx, ry, rz)).setPosition(x, y, z));
const shade = (hex, k) => new THREE.Color(hex).multiplyScalar(k);

// ---------------------------------------------------------------------
// trees
// ---------------------------------------------------------------------
// a branch pointing out along +x from the origin: a flattened cone, base at the trunk
function frond(len, width, flat = 0.42) {
  return new THREE.ConeGeometry(width, len, 5).rotateZ(-Math.PI / 2).scale(1, flat, 1).translate(len / 2, 0, 0);
}
const lerpCol = (a, b, k) => new THREE.Color(a).lerp(new THREE.Color(b), clamp01(k));

// Conifers built branch by branch: whorls of drooping, needle-green fronds around a tapering
// trunk with flared roots, darker inside and underneath, lighter at the tips and the crown.
function pineGeo(seed, { tiers = 7, height = 0.44, spread = 1, dark = '#143a22', light = '#5aa35c', per = 10 } = {}) {
  const r = rng(seed);
  const bark = { top: '#6b4a30', ao: 0.55, vary: 0.22, seed };
  const parts = [paint(new THREE.CylinderGeometry(0.008, 0.021, height * 0.8, 7).translate(0, height * 0.4, 0), '#3d281a', bark)];
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + r();
    parts.push(paint(frond(0.045, 0.012, 1).rotateZ(-0.55).rotateY(-a).translate(0, 0.022, 0), '#3d281a', bark));
  }
  // the dense inner cone the branches grow out of
  parts.push(paint(new THREE.ConeGeometry(0.075 * spread, height * 0.82, 8).translate(0, 0.06 + height * 0.41, 0), dark, { top: lerpCol(dark, light, 0.5), ao: 0.4, vary: 0.12, seed }));
  for (let t = 0; t < tiers; t++) {
    const f = t / (tiers - 1);
    const y = 0.075 + f * (height - 0.13);
    const len = (0.185 - f * 0.13) * spread;
    const n = Math.max(4, Math.round(per - f * 3));
    const droop = 0.38 - f * 0.22;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + t * 0.73 + r() * 0.35;
      const L = len * (0.82 + r() * 0.36);
      const g = frond(L, L * 0.48, 0.5).rotateZ(-droop - r() * 0.12).rotateY(-a).translate(0, y + (r() - 0.5) * 0.012, 0);
      const tip = r() * 0.12;
      parts.push(paintFaces(g, (c, nrm, i) => {
        const out = clamp01(Math.hypot(c.x, c.z) / (len * 0.9));
        const col = lerpCol(dark, light, 0.15 + 0.4 * f + 0.4 * out + tip);
        return col.multiplyScalar((nrm.y < 0 ? 0.62 : 1) * (0.88 + 0.24 * hash(i, seed + t, k)));
      }));
    }
  }
  parts.push(paint(new THREE.ConeGeometry(0.016, 0.075, 6).translate(0, height + 0.03, 0), lerpCol(dark, light, 0.6), { top: light }));
  return merge(parts);
}

// A broadleaf crown: a dome of leafy clumps on a forked trunk. Each facet is shaded by how much
// it faces the sky and the outside of the crown, so the canopy reads round and deep.
function oakGeo(seed, dark, light) {
  const r = rng(seed);
  const barkFace = (c, n, i) => lerpCol('#3a2a1e', '#6e5440', 0.3 + 0.5 * hash(i, seed) + c.y * 1.2);
  const parts = [paintFaces(new THREE.CylinderGeometry(0.012, 0.025, 0.2, 7, 3).translate(0, 0.1, 0), barkFace)];
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + r() * 0.8;
    parts.push(paintFaces(new THREE.CylinderGeometry(0.004, 0.009, 0.11, 5).translate(0, 0.055, 0).rotateZ(-0.7 - r() * 0.3).rotateY(-a).translate(0, 0.15 + r() * 0.04, 0), barkFace));
  }
  const C0 = new THREE.Vector3(0, 0.27, 0);
  const out = new THREE.Vector3();
  const n = 12;
  for (let i = 0; i < n; i++) {
    // spread the clumps over a dome (a golden-angle spiral), a few tucked underneath
    const yk = 1 - (i + 0.5) / n * 1.25;
    const rad = Math.sqrt(Math.max(0, 1 - yk * yk));
    const th = i * 2.399 + seed;
    const p = new THREE.Vector3(Math.cos(th) * rad * 0.1, yk * 0.07, Math.sin(th) * rad * 0.1).add(C0);
    const size = 0.048 + r() * 0.03;
    const blob = lumpy(new THREE.IcosahedronGeometry(size, 1), size * 0.24, seed + i * 5, 34).scale(1, 0.85, 1).translate(p.x, p.y, p.z);
    parts.push(paintFaces(blob, (c, nrm, f) => {
      out.copy(c).sub(C0).normalize();
      const k = 0.3 * clamp01(0.5 + 0.5 * nrm.y) + 0.4 * clamp01(nrm.dot(out)) + 0.3 * clamp01((c.y - 0.17) / 0.22);
      const col = lerpCol(dark, light, k);
      if (hash(f, seed, i) < 0.05) col.lerp(new THREE.Color(light), 0.6).multiplyScalar(1.12); // sunlit leaves
      return col.multiplyScalar(0.84 + 0.3 * hash(seed, f, i));
    }));
  }
  return merge(parts);
}

// a slender birch: white bark with black marks, a light, airy crown
function birchGeo(seed) {
  const r = rng(seed);
  const parts = [paintFaces(new THREE.CylinderGeometry(0.007, 0.013, 0.34, 7, 8).translate(0, 0.17, 0), (c, n, i) => {
    const mark = hash(Math.floor(c.y * 45), Math.floor(Math.atan2(c.z, c.x) * 2), seed) < 0.22;
    return mark ? new THREE.Color('#2b2622') : lerpCol('#cfc9bc', '#f2efe6', 0.4 + c.y * 2);
  })];
  const C0 = new THREE.Vector3(0, 0.3, 0);
  const out = new THREE.Vector3();
  for (let i = 0; i < 9; i++) {
    const y = 0.2 + (i / 8) * 0.17 + (r() - 0.5) * 0.02;
    const a = i * 2.399 + seed;
    const d = 0.035 * (1 - Math.abs(y - 0.28) * 3) + 0.01;
    const size = 0.03 + r() * 0.02;
    const blob = lumpy(new THREE.IcosahedronGeometry(size, 1), size * 0.25, seed + i, 40).translate(Math.cos(a) * d, y, Math.sin(a) * d);
    parts.push(paintFaces(blob, (c, nrm, f) => {
      out.copy(c).sub(C0).normalize();
      const k = 0.35 * clamp01(0.5 + 0.5 * nrm.y) + 0.35 * clamp01(nrm.dot(out)) + 0.3 * clamp01((c.y - 0.2) / 0.18);
      return lerpCol('#4a8530', '#c7e070', k).multiplyScalar(0.86 + 0.28 * hash(seed, f, i));
    }));
  }
  return merge(parts);
}

// a fern: arching fronds, each a tapering strip with serrated edges (two-sided)
function fernGeo(seed) {
  const r = rng(seed);
  const pts = [];
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2 + r() * 0.5;
    const L = 0.07 + r() * 0.03;
    const ca = Math.cos(a), sa = Math.sin(a);
    const seg = 6;
    let prev = null;
    for (let j = 0; j <= seg; j++) {
      const u = j / seg;
      const d = u * L;
      const y = Math.sin(u * Math.PI * 0.85) * 0.035 + 0.004;
      const w = 0.012 * Math.sin(Math.PI * Math.min(1, u * 1.15)) * (j % 2 ? 1 : 0.55);
      const cx = ca * d, cz = sa * d;
      const cur = [[cx + sa * w, y, cz - ca * w], [cx - sa * w, y, cz + ca * w]];
      if (prev) pts.push(...prev[0], ...prev[1], ...cur[1], ...prev[0], ...cur[1], ...cur[0]);
      prev = cur;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  g.computeVertexNormals();
  return paint(g, '#24561f', { top: '#7cb24a', y0: 0, y1: 0.04, vary: 0.18, seed });
}

// a stump with growth rings and a cap of moss
function stumpGeo() {
  const rings = paintFaces(new THREE.RingGeometry(0.001, 0.027, 12, 4).rotateX(-Math.PI / 2).translate(0, 0.045, 0), (c) => {
    const rr = Math.hypot(c.x, c.z);
    return new THREE.Color(Math.floor(rr * 160) % 2 ? '#c8a06c' : '#a77e50');
  });
  return merge([
    paintFaces(new THREE.CylinderGeometry(0.027, 0.034, 0.045, 10, 2, true).translate(0, 0.0225, 0), (c, n, i) => lerpCol('#3a2a1e', '#6e5440', 0.3 + 0.5 * hash(i, 4))),
    rings,
    paint(lumpy(new THREE.IcosahedronGeometry(0.014, 1), 0.004, 2, 50).scale(1.4, 0.5, 1).translate(0.015, 0.046, 0.008), '#4c7a2a', { top: '#86b04a', vary: 0.2 }),
  ]);
}

function bushGeo(seed, base, tip) {
  const parts = [];
  for (let i = 0; i < 3; i++) {
    const rad = 0.035 + 0.012 * hash(seed, i);
    const b = lumpy(new THREE.IcosahedronGeometry(rad, 1), rad * 0.22, seed + i, 30).scale(1, 0.75, 1);
    parts.push(paint(b.translate((i - 1) * 0.035, rad * 0.6, (hash(i, seed) - 0.5) * 0.04), base, { top: tip, y0: 0, y1: 0.06, ao: 0.3, vary: 0.15, seed: seed + i }));
  }
  return merge(parts);
}

// a tuft of grass blades leaning outwards (drawn two-sided)
function grassGeo(seed, base, tip, n = 8, hgt = 0.055) {
  const r = rng(seed);
  const pts = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + r() * 0.6;
    const h = hgt * (0.65 + r() * 0.6);
    const lean = 0.25 + r() * 0.45;
    const w = 0.0045;
    const bx = Math.cos(a) * 0.008, bz = Math.sin(a) * 0.008;
    const dx = Math.cos(a), dz = Math.sin(a);
    const px = -dz * w, pz = dx * w;
    const L = [bx - px, 0, bz - pz], R = [bx + px, 0, bz + pz];
    const mid = [bx + dx * h * lean * 0.4, h * 0.55, bz + dz * h * lean * 0.4];
    const mL = [mid[0] - px * 0.6, mid[1], mid[2] - pz * 0.6], mR = [mid[0] + px * 0.6, mid[1], mid[2] + pz * 0.6];
    const T = [bx + dx * h * lean, h, bz + dz * h * lean];
    pts.push(...L, ...R, ...mR, ...L, ...mR, ...mL, ...mL, ...mR, ...T);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  g.computeVertexNormals();
  return paint(g, base, { top: tip, y0: 0, y1: hgt, ao: 0.2, vary: 0.2, seed });
}

function logGeo() {
  const parts = [paint(new THREE.CylinderGeometry(0.022, 0.025, 0.24, 9).rotateZ(Math.PI / 2).translate(0, 0.022, 0), '#4f3624', { top: '#6e5038', ao: 0.4, vary: 0.2, seed: 3 })];
  parts.push(paint(new THREE.CircleGeometry(0.021, 9).rotateY(Math.PI / 2).translate(0.1205, 0.022, 0), '#c9a06a'));
  parts.push(paint(new THREE.CircleGeometry(0.023, 9).rotateY(-Math.PI / 2).translate(-0.1205, 0.022, 0), '#c9a06a'));
  // moss along the top, and a few toadstools
  parts.push(paint(lumpy(new THREE.IcosahedronGeometry(0.02, 1), 0.005, 4, 40).scale(2.2, 0.45, 1).translate(-0.02, 0.043, 0), '#4f7a2c', { top: '#7aa33f', vary: 0.2 }));
  for (const [x, z, s] of [[0.04, 0.04, 1], [0.06, 0.05, 0.75], [-0.07, -0.04, 0.9]]) {
    parts.push(paint(new THREE.CylinderGeometry(0.004 * s, 0.005 * s, 0.022 * s, 5).translate(x, 0.011 * s, z), '#efe6d4'));
    parts.push(paint(new THREE.SphereGeometry(0.013 * s, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.7, 1).translate(x, 0.02 * s, z), '#b8321f', { top: '#d84a32' }));
  }
  return merge(parts);
}

// ---------------------------------------------------------------------
// pasture
// ---------------------------------------------------------------------
function sheepGeo(seed, graze) {
  const r = rng(seed);
  const WOOL = '#f2ede0', SKIN = '#2a221d';
  const woolPaint = { top: '#fbf8f0', y0: 0.04, y1: 0.16, ao: 0.4, vary: 0.07, seed };
  const parts = [paint(new THREE.SphereGeometry(0.056, 10, 7).scale(1.35, 0.95, 1).translate(0, 0.1, 0), WOOL, woolPaint)];
  // fleece: puffs over the back and sides
  for (let k = 0; k < 15; k++) {
    const th = r() * Math.PI * 2;
    const ph = Math.acos(clamp01(r() * 1.5 - 0.45) * 2 - 1) * 0.5 + 0.15;
    const x = Math.sin(ph) * Math.cos(th) * 0.074, y = Math.cos(ph) * 0.05 + 0.1, z = Math.sin(ph) * Math.sin(th) * 0.054;
    parts.push(paint(new THREE.IcosahedronGeometry(0.023 + r() * 0.01, 0).translate(x, y, z), WOOL, { ...woolPaint, seed: seed + k }));
  }
  const hx = graze ? 0.098 : 0.096, hy = graze ? 0.055 : 0.132;
  const tilt = graze ? -1.0 : -0.3;
  parts.push(paint(place(new THREE.SphereGeometry(0.027, 8, 6).scale(1.4, 1, 0.9), hx, hy, 0, 0, 0, tilt), SKIN, { top: '#3a302a', vary: 0.04 }));
  parts.push(paint(new THREE.IcosahedronGeometry(0.019, 1).translate(hx - 0.016, hy + 0.017, 0), WOOL, { vary: 0.06 }));
  for (const s of [-1, 1]) parts.push(paint(place(new THREE.SphereGeometry(0.011, 6, 4).scale(1.9, 0.45, 1), hx - 0.012, hy + 0.008, s * 0.026, s * 0.5, s * 0.6, 0), SKIN));
  for (const [lx, lz] of [[0.045, 0.026], [0.045, -0.026], [-0.045, 0.026], [-0.045, -0.026]])
    parts.push(paint(new THREE.CylinderGeometry(0.0085, 0.007, 0.075, 5).translate(lx, 0.0375, lz), SKIN, { ao: 0.3 }));
  parts.push(paint(new THREE.IcosahedronGeometry(0.016, 1).translate(-0.086, 0.11, 0), WOOL, { vary: 0.06 }));
  return merge(parts);
}

function flowersGeo(seed, colors) {
  const r = rng(seed);
  const parts = [];
  for (let k = 0; k < 7; k++) {
    const x = (r() - 0.5) * 0.06, z = (r() - 0.5) * 0.06, h = 0.02 + r() * 0.025;
    parts.push(paint(new THREE.CylinderGeometry(0.0013, 0.0016, h, 3, 1, true).translate(x, h / 2, z), '#4f7f2a'));
    parts.push(paint(new THREE.IcosahedronGeometry(0.0065 + r() * 0.003, 0).scale(1, 0.6, 1).translate(x, h, z), colors[k % colors.length], { vary: 0.1, seed: seed + k }));
  }
  return merge(parts);
}

// ---------------------------------------------------------------------
// fields
// ---------------------------------------------------------------------
function wheatGeo(seed) {
  const r = rng(seed);
  const parts = [];
  const m = new THREE.Matrix4();
  for (let k = 0; k < 6; k++) {
    const h = 0.095 + r() * 0.04;
    m.makeRotationFromEuler(E.set((r() - 0.5) * 0.35, r() * 6, (r() - 0.5) * 0.35)).setPosition((r() - 0.5) * 0.034, 0, (r() - 0.5) * 0.034);
    parts.push(paint(new THREE.CylinderGeometry(0.0021, 0.003, h, 3, 1, true).translate(0, h / 2, 0).applyMatrix4(m), '#8f8c38', { top: '#d8b552', ao: 0.3 }));
    // the ear: an elongated, slightly nodding head of grain
    const ear = new THREE.OctahedronGeometry(0.0085, 0).scale(1, 3.4, 1).rotateZ(0.18).translate(0.003, h + 0.024, 0).applyMatrix4(m);
    parts.push(paint(ear, '#cf9a2a', { top: '#f3d06c', vary: 0.14, seed: seed + k }));
    // a leaf off the stem
    const leaf = new THREE.BufferGeometry();
    leaf.setAttribute('position', new THREE.Float32BufferAttribute([-0.003, 0.02, 0, 0.003, 0.02, 0, 0.034, 0.068, 0.004], 3));
    leaf.computeVertexNormals();
    leaf.rotateY(r() * 6).applyMatrix4(m);
    parts.push(paint(leaf, '#8a9238', { top: '#c6b552' }));
  }
  return merge(parts);
}

function baleGeo() {
  const parts = [paint(new THREE.CylinderGeometry(0.062, 0.062, 0.1, 16).rotateZ(Math.PI / 2).translate(0, 0.062, 0), '#c99e48', { top: '#e3be6a', ao: 0.35, vary: 0.14, seed: 9 })];
  for (const x of [-0.025, 0.025]) parts.push(paint(new THREE.TorusGeometry(0.063, 0.0028, 4, 20).rotateY(Math.PI / 2).translate(x, 0.062, 0), '#7a5a32'));
  return merge(parts);
}

function scarecrowGeo() {
  const wood = '#6b4a2a';
  return merge([
    paint(new THREE.CylinderGeometry(0.006, 0.007, 0.2, 5).translate(0, 0.1, 0), wood, { ao: 0.4 }),
    paint(new THREE.CylinderGeometry(0.009, 0.009, 0.15, 6).rotateZ(Math.PI / 2).translate(0, 0.155, 0), '#3b5f8a', { vary: 0.1 }),
    paint(new RoundedBoxGeometry(0.05, 0.065, 0.032, 1, 0.008).translate(0, 0.14, 0), '#b8442e', { top: '#c95a3a', vary: 0.1 }),
    paint(new THREE.SphereGeometry(0.022, 10, 8).translate(0, 0.198, 0), '#d6b26a'),
    paint(new THREE.CylinderGeometry(0.038, 0.038, 0.004, 14).translate(0, 0.216, 0), '#5a3f22'),
    paint(new THREE.CylinderGeometry(0.016, 0.02, 0.026, 12).translate(0, 0.23, 0), '#5a3f22'),
    // straw sticking out at the cuffs
    paint(new THREE.ConeGeometry(0.008, 0.02, 5).rotateZ(Math.PI / 2).translate(0.083, 0.155, 0), '#e2c06a'),
    paint(new THREE.ConeGeometry(0.008, 0.02, 5).rotateZ(-Math.PI / 2).translate(-0.083, 0.155, 0), '#e2c06a'),
  ]);
}

// ---------------------------------------------------------------------
// clay pits
// ---------------------------------------------------------------------
const BRICKS = ['#a8462a', '#b5522f', '#9a3d24', '#c0603a', '#8b3420', '#b04a2c'];

function pitGeo() {
  return merge([
    paint(new THREE.CircleGeometry(0.12, 22).rotateX(-Math.PI / 2).translate(0, 0.008, 0), '#6e2f17'),
    paint(lumpy(new THREE.TorusGeometry(0.12, 0.03, 6, 22), 0.008, 5, 50).rotateX(Math.PI / 2).scale(1, 0.55, 1).translate(0, 0.008, 0), '#9c4524', { top: '#c86a40', vary: 0.12 }),
  ]);
}
function puddleGeo() {
  return new THREE.CircleGeometry(0.065, 18).scale(1.3, 1, 1).rotateX(-Math.PI / 2).translate(0.01, 0.011, 0.012);
}

function moundGeo(seed, shovel) {
  const parts = [paint(lumpy(new THREE.SphereGeometry(0.12, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2), 0.018, seed, 30).scale(1, 0.5, 1), '#93401f', { top: '#d77a4c', ao: 0.3, vary: 0.12, seed })];
  if (shovel) {
    parts.push(paint(place(new THREE.CylinderGeometry(0.0035, 0.0035, 0.15, 5), 0.02, 0.1, 0, 0, 0, 0.35), '#8a6238'));
    parts.push(paint(place(new THREE.BoxGeometry(0.028, 0.038, 0.003), 0.045, 0.04, 0, 0, 0, 0.35), '#7d848c'));
  }
  return merge(parts);
}

function palletGeo(seed) {
  const r = rng(seed);
  const parts = [];
  for (const z of [-0.06, 0, 0.06]) parts.push(paint(new THREE.BoxGeometry(0.17, 0.012, 0.03).translate(0, 0.006, z), '#8c6a42', { vary: 0.12, seed: seed + z * 100 }));
  for (let lv = 0; lv < 4; lv++) {
    const rot = lv % 2 ? Math.PI / 2 : 0;
    for (let a = -1; a <= 1; a++)
      for (let b = -2; b <= 2; b++) {
        if (lv === 3 && r() < 0.35) continue; // a part-used top layer
        const brick = new THREE.BoxGeometry(0.05, 0.022, 0.024);
        place(brick, a * 0.053, 0.023 + lv * 0.0235, b * 0.0255, 0, 0, 0);
        brick.rotateY(rot);
        parts.push(paint(brick, BRICKS[Math.floor(r() * BRICKS.length)], { vary: 0.08, seed: seed + lv * 31 + a * 7 + b }));
      }
  }
  return merge(parts);
}

// bricks set out on edge to dry
function dryingGeo(seed) {
  const r = rng(seed);
  const parts = [];
  for (let row = 0; row < 2; row++)
    for (let k = 0; k < 6; k++) {
      const brick = new THREE.BoxGeometry(0.022, 0.05, 0.024);
      place(brick, (k - 2.5) * 0.034, 0.025, row * 0.05 - 0.025, 0, (r() - 0.5) * 0.15, (r() - 0.5) * 0.08);
      parts.push(paint(brick, row ? '#c88360' : BRICKS[Math.floor(r() * 4)], { vary: 0.08, seed: seed + row * 9 + k }));
    }
  return merge(parts);
}

// a beehive kiln laid in brick courses, with a chimney; the glowing door is its own mesh
function kilnGeo() {
  const brickFace = (c, n, i) => {
    const course = Math.floor(c.y / 0.018);
    const col = Math.floor(((Math.atan2(c.z, c.x) + Math.PI) / (Math.PI * 2)) * 20 + (course % 2) * 0.5);
    const k = 0.82 + hash(course, col) * 0.3;
    return shade(BRICKS[Math.floor(hash(col, course, 3) * BRICKS.length)], k * (0.7 + 0.3 * clamp01(c.y / 0.1)));
  };
  return merge([
    paintFaces(new THREE.CylinderGeometry(0.105, 0.112, 0.05, 20, 2).translate(0, 0.025, 0), brickFace),
    paintFaces(new THREE.SphereGeometry(0.105, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 1.05, 1).translate(0, 0.05, 0), brickFace),
    paintFaces(new THREE.CylinderGeometry(0.021, 0.025, 0.1, 8, 3).translate(0.03, 0.17, -0.025), brickFace),
    paint(new THREE.CylinderGeometry(0.028, 0.028, 0.012, 8).translate(0.03, 0.222, -0.025), '#3b2a22'),
    // the dark doorway and a stone sill
    paint(new THREE.BoxGeometry(0.064, 0.066, 0.03).translate(0, 0.033, 0.098), '#1a0f0a'),
    paint(new THREE.BoxGeometry(0.08, 0.012, 0.03).translate(0, 0.006, 0.112), '#8d8a84', { vary: 0.1 }),
  ]);
}
const KILN_CHIMNEY = [0.03, 0.232, -0.025];
function kilnGlowGeo() {
  return new THREE.PlaneGeometry(0.046, 0.046).translate(0, 0.03, 0.115);
}

// ---------------------------------------------------------------------
// quarry
// ---------------------------------------------------------------------
// Rock, shaded per facet: strata bands, darker at the foot, lichen on low ledges, snow on high
// upward faces, and seams of ore (rusty iron, gold) running across the face on a slant.
function rockColor(c, n, i, seed, h, { snowAt = null, veins = false } = {}) {
  const k = clamp01(h);
  if (snowAt != null && k > snowAt + 0.06 * Math.sin(c.x * 40 + c.z * 30 + seed) && n.y > 0.1) return shade('#eef3f7', 0.86 + 0.14 * n.y);
  const band = Math.sin(c.y * 80 + c.x * 9 + seed) * 0.5 + 0.5; // strata
  const col = new THREE.Color('#434c57').lerp(new THREE.Color('#939eaa'), 0.18 + 0.5 * k + band * 0.16);
  if (k < 0.35 && n.y > 0.72 && hash(i, seed, 2) < 0.5) col.lerp(new THREE.Color('#6d7a46'), 0.55); // lichen
  if (veins && k < 0.62) {
    const d = c.x * Math.sin(seed) + c.y * 0.8 + c.z * Math.cos(seed);
    const v = Math.abs(((d * 6 + seed) % 1 + 1) % 1 - 0.5);
    const gold = hash(Math.floor(d * 6 + seed), seed) < 0.3;
    if (v < 0.022) col.lerp(new THREE.Color(gold ? '#d9a93a' : '#7a4a30'), gold ? 0.75 : 0.55);
  }
  const f = hash(i, seed);
  if (k < 0.45 && f < 0.008) col.lerp(new THREE.Color('#8a4b2a'), 0.6);
  else if (k < 0.45 && f < 0.011) col.set('#d9a93a');
  return col.multiplyScalar((0.6 + 0.4 * clamp01(k * 2.2)) * (0.88 + 0.24 * hash(seed, i)) * (0.82 + 0.18 * Math.max(0, n.y)));
}

// layered noise: broad swells, sharp ridges (cliff edges) and fine grit
function crag(geo, seed, scale = 1) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const len = v.length();
    if (len < 1e-6) continue;
    const x = v.x / scale, y = v.y / scale, z = v.z / scale;
    const broad = noise3(x * 7, y * 7, z * 7, seed);
    const ridge = 1 - Math.abs(noise3(x * 15 + 3, y * 15, z * 15 - 2, seed + 1)) * 1.5;
    const grit = noise3(x * 34 + 7, y * 34, z * 34, seed + 2);
    v.setLength(len + scale * (0.05 * broad + 0.03 * ridge + 0.012 * grit));
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

function peakGeo(seed) {
  // a craggy, tapering peak, narrowed toward the summit and leaning a little
  const g = crag(new THREE.IcosahedronGeometry(0.24, 6), seed).scale(1, 1.75, 1).translate(0, 0.14, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const k = clamp01(y / 0.56);
    const f = 1 - 0.5 * k * k + 0.07 * Math.sin(y * 40 + seed);
    p.setXYZ(i, p.getX(i) * f + 0.03 * k * Math.sin(seed), y, p.getZ(i) * f);
  }
  g.computeVertexNormals();
  return paintFaces(g, (c, n, i) => rockColor(c, n, i, seed, c.y / 0.56, { snowAt: 0.7, veins: true }));
}

function boulderGeo(seed, tone) {
  const g = crag(new THREE.IcosahedronGeometry(0.05, 2), seed, 0.25).scale(1, 0.75, 1).translate(0, 0.022, 0);
  if (tone) return paint(g, tone, { top: new THREE.Color(tone).multiplyScalar(1.25), ao: 0.35, vary: 0.18, seed });
  return paintFaces(g, (c, n, i) => rockColor(c, n, i + 7, seed, 0.3 + c.y * 4));
}

// loose rock spilled at the foot of a slope
function screeGeo(seed) {
  const r = rng(seed);
  const parts = [];
  for (let k = 0; k < 16; k++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 0.085;
    const size = 0.007 + r() * 0.014 * (1 - d * 6);
    const g = lumpy(new THREE.IcosahedronGeometry(Math.max(0.006, size), 0), size * 0.3, seed + k, 60).translate(Math.cos(a) * d, size * 0.55 + (0.085 - d) * 0.25, Math.sin(a) * d);
    parts.push(paintFaces(g, (c, n, i) => rockColor(c, n, i + k * 7, seed + k, 0.25 + n.y * 0.3)));
  }
  return merge(parts);
}

// gold nuggets (drawn with a polished metal material)
function nuggetsGeo(seed) {
  const r = rng(seed);
  const parts = [];
  for (let k = 0; k < 5; k++) {
    const size = 0.006 + r() * 0.006;
    parts.push(prep(lumpy(new THREE.IcosahedronGeometry(size, 1), size * 0.35, seed + k, 120).scale(1.2, 0.75, 1).translate((r() - 0.5) * 0.045, size * 0.5, (r() - 0.5) * 0.045)));
  }
  return merge(parts);
}

// a cluster of six-sided quartz crystals with pointed tips
function crystalGeo(seed, base, tip) {
  const r = rng(seed);
  const parts = [];
  for (let k = 0; k < 7; k++) {
    const len = 0.03 + r() * 0.06 * (k ? 1 : 1.4);
    const rad = 0.007 + r() * 0.006;
    const tilt = k ? 0.25 + r() * 0.5 : 0.05;
    const a = r() * Math.PI * 2;
    const prism = merge([
      prep(new THREE.CylinderGeometry(rad, rad * 1.08, len, 6).translate(0, len / 2, 0)),
      prep(new THREE.ConeGeometry(rad, rad * 2.4, 6).translate(0, len + rad * 1.2, 0)),
    ]);
    prism.rotateZ(-tilt).rotateY(-a).translate((r() - 0.5) * 0.02, 0, (r() - 0.5) * 0.02);
    parts.push(paint(prism, base, { top: tip, y0: 0, y1: 0.08, vary: 0.12, seed: seed + k }));
  }
  return merge(parts);
}

const MINE_CART_Z = 0.29;
function mineGeo() {
  const wood = '#7a5532';
  const parts = [
    paintFaces(crag(new THREE.IcosahedronGeometry(0.16, 4), 11, 0.7).scale(1.15, 0.8, 0.9).translate(0, 0.05, 0), (c, n, i) => rockColor(c, n, i, 11, 0.25 + c.y * 3, { veins: true })),
    paint(new THREE.BoxGeometry(0.072, 0.085, 0.04).translate(0, 0.0425, 0.133), '#0f0b08'),
    paint(new THREE.BoxGeometry(0.013, 0.095, 0.013).translate(-0.043, 0.0475, 0.156), wood, { vary: 0.1 }),
    paint(new THREE.BoxGeometry(0.013, 0.095, 0.013).translate(0.043, 0.0475, 0.156), wood, { vary: 0.1 }),
    paint(new THREE.BoxGeometry(0.11, 0.015, 0.016).translate(0, 0.1, 0.156), wood, { vary: 0.1 }),
    // a hanging lantern (its flame is the glow mesh) and a pickaxe leaning on the post
    paint(new THREE.CylinderGeometry(0.0012, 0.0012, 0.012, 3).translate(0.028, 0.086, 0.166), '#2a2522'),
    paint(new THREE.ConeGeometry(0.009, 0.008, 6).translate(0.028, 0.079, 0.166), '#2a2522'),
    paint(new THREE.CylinderGeometry(0.008, 0.008, 0.003, 6).translate(0.028, 0.06, 0.166), '#2a2522'),
    paint(place(new THREE.CylinderGeometry(0.0025, 0.0025, 0.085, 5), 0.062, 0.04, 0.17, 0, 0, 0.28), '#8a6238'),
    paint(place(new THREE.BoxGeometry(0.048, 0.006, 0.006), 0.05, 0.082, 0.17, 0, 0, 0.28 + 0.2), '#6f767e'),
  ];
  // rails out of the mine, on sleepers
  for (const x of [-0.019, 0.019]) parts.push(paint(new THREE.BoxGeometry(0.004, 0.005, 0.2).translate(x, 0.008, 0.255), '#5c6168'));
  for (let k = 0; k < 6; k++) parts.push(paint(new THREE.BoxGeometry(0.058, 0.005, 0.012).translate(0, 0.003, 0.17 + k * 0.034), '#5e4128', { vary: 0.12, seed: k }));
  // an ore cart heaped with rock, rust and gold
  const cz = MINE_CART_Z, metal = '#59606a';
  parts.push(paint(new THREE.BoxGeometry(0.052, 0.006, 0.072).translate(0, 0.024, cz), metal));
  for (const s of [-1, 1]) {
    parts.push(paint(new THREE.BoxGeometry(0.004, 0.032, 0.072).translate(s * 0.026, 0.04, cz), metal, { top: '#7a828c' }));
    parts.push(paint(new THREE.BoxGeometry(0.052, 0.032, 0.004).translate(0, 0.04, cz + s * 0.036), metal, { top: '#7a828c' }));
    for (const dz of [-0.022, 0.022]) parts.push(paint(new THREE.CylinderGeometry(0.011, 0.011, 0.006, 10).rotateZ(Math.PI / 2).translate(s * 0.028, 0.012, cz + dz), '#2e2a28'));
  }
  const ores = ['#7e8790', '#6c747c', '#8a4b2a', '#8d959d', '#a0603a', '#5f676f'];
  ores.forEach((c, k) => parts.push(paint(lumpy(new THREE.IcosahedronGeometry(0.013, 1), 0.004, k, 80).translate(((k % 3) - 1) * 0.015, 0.056 + (k > 2 ? 0.008 : 0), cz + ((k % 2) - 0.5) * 0.026), c, { vary: 0.18, seed: k })));
  // a heap of broken ore beside the track
  const r = rng(77);
  for (let k = 0; k < 12; k++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 0.04;
    const size = 0.008 + r() * 0.008;
    parts.push(paint(lumpy(new THREE.IcosahedronGeometry(size, 0), size * 0.3, k, 70).translate(-0.075 + Math.cos(a) * d, size * 0.6 + (0.04 - d) * 0.4, 0.23 + Math.sin(a) * d), ores[k % ores.length], { vary: 0.2, seed: k }));
  }
  return merge(parts);
}
// the lantern flame, and gold showing in the cart and the heap
function mineGlowGeo() {
  return new THREE.SphereGeometry(0.0055, 8, 6).scale(1, 1.3, 1).translate(0.028, 0.069, 0.166);
}
function mineGoldGeo() {
  const parts = [];
  for (const [x, y, z, s] of [[0.006, 0.07, MINE_CART_Z + 0.006, 0.009], [-0.012, 0.064, MINE_CART_Z - 0.014, 0.007], [-0.07, 0.03, 0.235, 0.008], [-0.085, 0.018, 0.215, 0.006]])
    parts.push(prep(lumpy(new THREE.IcosahedronGeometry(s, 1), s * 0.35, x * 1000, 120).translate(x, y, z)));
  return merge(parts);
}

function blocksGeo(seed) {
  const r = rng(seed);
  const parts = [];
  const spots = [[-0.075, 0, 0], [0, 0, 0], [0.075, 0, 0], [-0.037, 1, 0.004], [0.037, 1, -0.004]];
  for (const [x, lv, z] of spots) {
    const b = new RoundedBoxGeometry(0.07, 0.045, 0.05, 1, 0.005);
    place(b, x, 0.0225 + lv * 0.046, z, 0, (r() - 0.5) * 0.12, 0);
    parts.push(paint(b, '#a9b1ba', { top: '#c7ced6', ao: 0.25, vary: 0.1, seed: seed + x * 100 + lv }));
  }
  return merge(parts);
}

// ---------------------------------------------------------------------
// desert
// ---------------------------------------------------------------------
function cactusGeo(seed) {
  const c = { top: '#62a04f', y0: 0, y1: 0.22, ao: 0.35, vary: 0.06, seed };
  const s = hash(seed) < 0.5 ? 1 : -1;
  return merge([
    paint(new THREE.CylinderGeometry(0.021, 0.025, 0.2, 10).translate(0, 0.1, 0), '#2f6a32', c),
    paint(new THREE.SphereGeometry(0.021, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.2, 0), '#2f6a32', c),
    paint(new THREE.CylinderGeometry(0.013, 0.013, 0.04, 8).rotateZ(Math.PI / 2).translate(s * 0.034, 0.08, 0), '#2f6a32', c),
    paint(new THREE.CylinderGeometry(0.013, 0.014, 0.07, 8).translate(s * 0.054, 0.112, 0), '#2f6a32', c),
    paint(new THREE.SphereGeometry(0.013, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).translate(s * 0.054, 0.147, 0), '#2f6a32', c),
    paint(new THREE.CylinderGeometry(0.012, 0.012, 0.035, 8).rotateZ(Math.PI / 2).translate(-s * 0.031, 0.115, 0), '#2f6a32', c),
    paint(new THREE.CylinderGeometry(0.012, 0.013, 0.05, 8).translate(-s * 0.049, 0.137, 0), '#2f6a32', c),
    paint(new THREE.SphereGeometry(0.012, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).translate(-s * 0.049, 0.162, 0), '#2f6a32', c),
  ]);
}

// ---------------------------------------------------------------------
// the kit and the placer
// ---------------------------------------------------------------------
export function makeKit() {
  const vc = (extra = {}) => new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.88, metalness: 0, ...extra });
  const g = {
    pines: [pineGeo(3), pineGeo(17, { tiers: 7, height: 0.48 }), pineGeo(29, { per: 7, height: 0.4 })],
    spruce: pineGeo(41, { tiers: 9, height: 0.52, spread: 0.78, dark: '#0e3226', light: '#3f8a68', per: 7 }),
    oaks: [oakGeo(5, '#173f15', '#5e9e3a'), oakGeo(13, '#21561a', '#7fb646')],
    autumn: [oakGeo(21, '#5e5010', '#e3cf4c'), oakGeo(37, '#6e2c12', '#f4a43c')],
    birches: [birchGeo(2), birchGeo(8)],
    ferns: [fernGeo(3), fernGeo(9)],
    stump: stumpGeo(),
    bush: bushGeo(7, '#21521f', '#5c9a3a'),
    forestGrass: grassGeo(41, '#25521f', '#5f8f34', 7, 0.045),
    log: logGeo(),
    sheep: sheepGeo(4, false),
    sheepGraze: sheepGeo(9, true),
    grass: [grassGeo(2, '#4f8a2b', '#a7d65c'), grassGeo(8, '#5a9530', '#c2df6c', 9, 0.065)],
    flowers: [flowersGeo(3, ['#ffffff', '#fff2b8']), flowersGeo(6, ['#ffd23f', '#ffb32b']), flowersGeo(11, ['#f08bb4', '#b58ee8', '#ffffff'])],
    post: paint(new THREE.BoxGeometry(0.014, 0.08, 0.014).translate(0, 0.04, 0), '#6e4c2c', { top: '#8f6a42', ao: 0.35 }),
    rail: paint(new THREE.BoxGeometry(1, 0.008, 0.006), '#8a6238', { vary: 0.1 }),
    wheat: [wheatGeo(1), wheatGeo(5), wheatGeo(12)],
    bale: baleGeo(),
    scarecrow: scarecrowGeo(),
    pit: pitGeo(),
    puddle: puddleGeo(),
    mounds: [moundGeo(3, true), moundGeo(8, false)],
    pallets: [palletGeo(2), palletGeo(19)],
    drying: dryingGeo(4),
    kiln: kilnGeo(),
    kilnGlow: kilnGlowGeo(),
    peaks: [peakGeo(1), peakGeo(4), peakGeo(9)],
    boulders: [boulderGeo(2), boulderGeo(6)],
    scree: [screeGeo(3), screeGeo(7)],
    nuggets: nuggetsGeo(5),
    crystals: [crystalGeo(4, '#a9cdef', '#f2f9ff'), crystalGeo(9, '#7b58b8', '#e0ccff')],
    mine: mineGeo(),
    mineGlow: mineGlowGeo(),
    mineGold: mineGoldGeo(),
    blocks: blocksGeo(5),
    dune: paint(new THREE.SphereGeometry(0.22, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1.3, 0.28, 0.8), '#d9b67c', { top: '#f3dfb4', ao: 0.25 }),
    cacti: [cactusGeo(1), cactusGeo(2)],
    redRock: boulderGeo(3, '#9d5132'),
  };
  const m = {
    flat: vc({ flatShading: true }),
    smooth: vc({ roughness: 0.95 }),
    plant: vc({ side: THREE.DoubleSide, roughness: 0.8 }),
    glow: new THREE.MeshStandardMaterial({ color: '#000000', emissive: '#ff8a2a', emissiveIntensity: 2.4 }),
    // polished gold: catches the sun and the sky in the environment light
    gold: new THREE.MeshStandardMaterial({ color: '#f2c14e', metalness: 1, roughness: 0.28, flatShading: true }),
    crystal: vc({ flatShading: true, roughness: 0.12, metalness: 0.1 }),
    water: new THREE.MeshStandardMaterial({ color: '#3d6b78', roughness: 0.05, metalness: 0.3 }),
  };
  return { g, m };
}

// instanced meshes, one per (geometry, material), with an optional colour per copy
export class Batcher {
  constructor() {
    this.sets = new Map();
  }
  add(geo, mat, matrix, color = null) {
    const key = geo.uuid + mat.uuid;
    if (!this.sets.has(key)) this.sets.set(key, { geo, mat, list: [], tinted: false });
    const set = this.sets.get(key);
    set.list.push({ matrix: matrix.clone(), color });
    if (color) set.tinted = true;
  }
  build(parent) {
    const white = new THREE.Color(1, 1, 1);
    for (const { geo, mat, list, tinted } of this.sets.values()) {
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach(({ matrix, color }, i) => {
        mesh.setMatrixAt(i, matrix);
        if (tinted) mesh.setColorAt(i, color || white);
      });
      mesh.castShadow = mat.side !== THREE.DoubleSide || geo.attributes.position.count > 200;
      mesh.receiveShadow = true;
      parent.add(mesh);
    }
  }
}

const M4 = new THREE.Matrix4();
const Q = new THREE.Quaternion();
const V = new THREE.Vector3();
const S3 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const mat = (x, y, z, rotY = 0, s = 1, sy = s) => M4.compose(V.set(x, y, z), Q.setFromAxisAngle(UP, rotY), S3.set(s, sy, s));
const matS = (x, y, z, rotY, sx, sy, sz) => M4.compose(V.set(x, y, z), Q.setFromAxisAngle(UP, rotY), S3.set(sx, sy, sz));

// is a point (relative to the tile centre) on the tile, `lim` of the way to its edge?
function onTile(x, z, lim = 0.86) {
  const ang = Math.abs((((Math.atan2(z, x) * 180) / Math.PI + 360) % 60) - 30);
  return Math.hypot(x, z) <= (lim * Math.cos(Math.PI / 6)) / Math.cos((ang * Math.PI) / 180);
}

// spots on a hex away from the number token
function scatter(rand, n, { inner = 0.36, outer = 0.74, minGap = 0.15 } = {}) {
  const out = [];
  for (let tries = 0; out.length < n && tries < n * 40; tries++) {
    const a = rand() * Math.PI * 2;
    const d = inner + Math.sqrt(rand()) * (outer - inner);
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    if (!onTile(x, z)) continue;
    if (out.some((p) => Math.hypot(p[0] - x, p[1] - z) < minGap)) continue;
    out.push([x, z]);
  }
  return out;
}

// Dress one tile. Returns { smoke: [[x, y, z]...] }: chimneys the scene puts smoke over.
export function decorate(b, kit, type, hx, seed, top) {
  const { g, m } = kit;
  const r = rng(seed);
  const X = hx.x;
  const Z = hx.z;
  const y = top - 0.005;
  const extras = { smoke: [] };
  const pick = (list) => list[Math.floor(r() * list.length)];
  // a gentle per-copy colour shift so repeats don't look stamped
  const tint = (w = 0.14) => new THREE.Color(1 + (r() - 0.5) * w, 1 + (r() - 0.5) * w, 1 + (r() - 0.5) * w * 0.7);

  if (type === 'forest') {
    // a mixed wood: mostly pines, a dark spruce or two, oaks (some turning) and birches
    for (const [x, z] of scatter(r, 13, { minGap: 0.135, outer: 0.78 })) {
      const s = 0.82 + r() * 0.4;
      const k = r();
      const geo = k < 0.45 ? pick(g.pines) : k < 0.58 ? g.spruce : k < 0.78 ? (r() < 0.25 ? pick(g.autumn) : pick(g.oaks)) : pick(g.birches);
      b.add(geo, m.flat, mat(X + x, y, Z + z, r() * 6, s, s * (0.92 + r() * 0.16)), tint());
    }
    // the forest floor
    for (const [x, z] of scatter(r, 5, { inner: 0.3, outer: 0.82, minGap: 0.08 })) b.add(pick(g.ferns), m.plant, mat(X + x, y, Z + z, r() * 6, 0.8 + r() * 0.5), tint(0.18));
    for (const [x, z] of scatter(r, 2, { inner: 0.3, outer: 0.8, minGap: 0.1 })) b.add(g.bush, m.flat, mat(X + x, y, Z + z, r() * 6, 0.8 + r() * 0.5), tint());
    for (const [x, z] of scatter(r, 7, { inner: 0.3, outer: 0.82, minGap: 0.06 })) b.add(g.forestGrass, m.plant, mat(X + x, y, Z + z, r() * 6, 0.8 + r() * 0.5), tint(0.2));
    for (const [x, z] of scatter(r, 2, { inner: 0.35, outer: 0.8, minGap: 0.1 })) b.add(pick(g.boulders), m.flat, mat(X + x, y, Z + z, r() * 6, 0.45 + r() * 0.3), new THREE.Color(0.85, 0.95, 0.8));
    if (r() < 0.6) {
      const [x, z] = scatter(r, 1, { inner: 0.45, outer: 0.7 })[0] || [0.5, 0.2];
      b.add(g.log, m.flat, mat(X + x, y, Z + z, r() * 6, 0.9 + r() * 0.2));
    }
    if (r() < 0.6) {
      const [x, z] = scatter(r, 1, { inner: 0.4, outer: 0.75 })[0] || [-0.5, 0.2];
      b.add(g.stump, m.flat, mat(X + x, y, Z + z, r() * 6, 0.9 + r() * 0.3));
    }
  } else if (type === 'pasture') {
    for (const [x, z] of scatter(r, 16, { inner: 0.3, outer: 0.84, minGap: 0.07 })) b.add(pick(g.grass), m.plant, mat(X + x, y, Z + z, r() * 6, 0.8 + r() * 0.5), tint(0.18));
    for (const [x, z] of scatter(r, 6, { inner: 0.34, outer: 0.82, minGap: 0.12 })) b.add(pick(g.flowers), m.plant, mat(X + x, y, Z + z, r() * 6, 0.8 + r() * 0.5));
    for (const [x, z] of scatter(r, 5, { minGap: 0.19 })) {
      const lamb = r() < 0.2;
      const black = r() < 0.12;
      const geo = !lamb && r() < 0.5 ? g.sheepGraze : g.sheep;
      const s = lamb ? 0.62 : 0.9 + r() * 0.22;
      b.add(geo, m.smooth, mat(X + x, y, Z + z, r() * 6, s), black ? new THREE.Color(0.32, 0.29, 0.27) : tint(0.08));
    }
    for (const [x, z] of scatter(r, 2, { minGap: 0.1, inner: 0.5, outer: 0.8 })) b.add(g.bush, m.flat, mat(X + x, y, Z + z, r() * 6, 0.7 + r() * 0.4), tint());
    // a fence along part of the edge, posts joined by two rails
    const fa = r() * Math.PI * 2;
    const posts = [];
    for (let i = 0; i < 6; i++) {
      const a = fa + i * 0.15;
      posts.push([X + Math.cos(a) * 0.72, Z + Math.sin(a) * 0.72]);
      b.add(g.post, m.flat, mat(...[posts[i][0], y, posts[i][1]], -a));
    }
    for (let i = 0; i < posts.length - 1; i++) {
      const [ax, az] = posts[i], [bx, bz] = posts[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const rot = -Math.atan2(bz - az, bx - ax);
      for (const h of [0.03, 0.06]) b.add(g.rail, m.flat, matS((ax + bx) / 2, y + h, (az + bz) / 2, rot, len, 1, 1));
    }
  } else if (type === 'fields') {
    // rows of wheat clumps
    const rot = 0.35;
    const c = Math.cos(rot), sn = Math.sin(rot);
    for (let i = -11; i <= 11; i++)
      for (let j = -12; j <= 12; j++) {
        const u = i * 0.07, w = j * 0.064;
        const x = u * c - w * sn + (r() - 0.5) * 0.018;
        const z = u * sn + w * c + (r() - 0.5) * 0.018;
        const d = Math.hypot(x, z);
        if (d < 0.35 || !onTile(x, z, 0.84)) continue;
        b.add(pick(g.wheat), m.plant, mat(X + x, y, Z + z, r() * 6, 0.85 + r() * 0.35, 0.85 + r() * 0.4), tint(0.12));
      }
    for (const [x, z] of scatter(r, 2, { inner: 0.45, outer: 0.7, minGap: 0.3 })) b.add(g.bale, m.flat, mat(X + x, y, Z + z, r() * 6), tint(0.1));
    if (r() < 0.5) {
      const [x, z] = scatter(r, 1, { inner: 0.42, outer: 0.62 })[0] || [0.5, 0];
      b.add(g.scarecrow, m.flat, mat(X + x, y, Z + z, (r() - 0.5) * 1.2));
    }
  } else if (type === 'clay') {
    const spots = scatter(r, 6, { inner: 0.38, outer: 0.72, minGap: 0.25 });
    const [kiln, pit, p1, p2, mound, dry] = spots;
    if (kiln) {
      const rot = (r() - 0.5) * 1.4;
      const s = 0.95 + r() * 0.15;
      b.add(g.kiln, m.flat, mat(X + kiln[0], y, Z + kiln[1], rot, s));
      b.add(g.kilnGlow, m.glow, mat(X + kiln[0], y, Z + kiln[1], rot, s));
      const [lx, ly, lz] = KILN_CHIMNEY;
      const cs = Math.cos(rot), ss = Math.sin(rot);
      extras.smoke.push([X + kiln[0] + (lx * cs + lz * ss) * s, y + ly * s, Z + kiln[1] + (-lx * ss + lz * cs) * s]);
    }
    if (pit) {
      const rot = r() * 6;
      b.add(g.pit, m.flat, mat(X + pit[0], y, Z + pit[1], rot));
      b.add(g.puddle, m.water, mat(X + pit[0], y, Z + pit[1], rot));
    }
    for (const p of [p1, p2]) if (p) b.add(pick(g.pallets), m.flat, mat(X + p[0], y, Z + p[1], r() * 6));
    if (mound) b.add(g.mounds[0], m.flat, mat(X + mound[0], y, Z + mound[1], r() * 6, 0.85 + r() * 0.3));
    if (dry) b.add(r() < 0.5 ? g.drying : g.mounds[1], m.flat, mat(X + dry[0], y, Z + dry[1], r() * 6));
  } else if (type === 'quarry') {
    const spots = scatter(r, 5, { inner: 0.4, outer: 0.64, minGap: 0.33 });
    spots.slice(0, 3).forEach(([x, z], i) => {
      const s = 0.85 + r() * 0.4 - i * 0.08;
      b.add(g.peaks[i % 3], m.flat, mat(X + x, y, Z + z, r() * 6, s, s * (0.9 + r() * 0.25)), tint(0.08));
      // scree spilled at its foot, toward the players
      const a = Math.PI / 2 + (r() - 0.5) * 1.6;
      const sx = x + Math.cos(a) * 0.17 * s, sz = z + Math.sin(a) * 0.17 * s;
      if (onTile(sx, sz)) b.add(pick(g.scree), m.flat, mat(X + sx, y, Z + sz, r() * 6, 0.9 + r() * 0.3), tint(0.06));
    });
    // the mine faces the players, so its timbers, lantern and ore cart show
    if (spots[3]) {
      const mm = mat(X + spots[3][0], y, Z + spots[3][1], (r() - 0.5) * 0.8, 0.85);
      b.add(g.mine, m.flat, mm);
      b.add(g.mineGlow, m.glow, mm);
      b.add(g.mineGold, m.gold, mm);
    }
    if (spots[4]) b.add(g.blocks, m.flat, mat(X + spots[4][0], y, Z + spots[4][1], r() * 6, 0.9));
    for (const [x, z] of scatter(r, 7, { minGap: 0.08 })) b.add(pick(g.boulders), m.flat, mat(X + x, y, Z + z, r() * 6, 0.5 + r() * 0.8), tint(0.1));
    // gold lying in the open, and a crystal cluster in a crevice
    for (const [x, z] of scatter(r, 2, { inner: 0.32, outer: 0.78, minGap: 0.1 })) b.add(g.nuggets, m.gold, mat(X + x, y, Z + z, r() * 6, 0.9 + r() * 0.4));
    if (r() < 0.7) {
      const [x, z] = scatter(r, 1, { inner: 0.36, outer: 0.78 })[0] || [0.4, -0.3];
      b.add(pick(g.crystals), m.crystal, mat(X + x, y, Z + z, r() * 6, 0.8 + r() * 0.4));
    }
  } else if (type === 'desert') {
    for (const [x, z] of scatter(r, 3, { minGap: 0.3, inner: 0.3 })) b.add(g.dune, m.smooth, mat(X + x, y, Z + z, r() * 6, 0.8 + r() * 0.4));
    for (const [x, z] of scatter(r, 3, { minGap: 0.22, inner: 0.42 })) b.add(pick(g.cacti), m.flat, mat(X + x, y, Z + z, r() * 6, 0.8 + r() * 0.45), tint(0.1));
    for (const [x, z] of scatter(r, 5, { minGap: 0.1 })) b.add(g.redRock, m.flat, mat(X + x, y, Z + z, r() * 6, 0.6 + r() * 0.6));
  }
  return extras;
}
