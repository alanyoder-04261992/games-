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
function pineGeo(seed, tiers) {
  const r = rng(seed);
  const parts = [paint(new THREE.CylinderGeometry(0.012, 0.024, 0.14, 6).translate(0, 0.07, 0), '#4a3020', { top: '#6b4a30', ao: 0.5, vary: 0.15, seed })];
  let y = 0.055, rad = 0.155, h = 0.17;
  const cones = [];
  for (let t = 0; t < tiers; t++) {
    const seg = 10;
    const c = new THREE.ConeGeometry(rad, h, seg, 2);
    const p = c.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), yy = p.getY(i), z = p.getZ(i);
      if (Math.hypot(x, z) < 1e-6) continue;
      const idx = Math.round(((Math.atan2(z, x) + Math.PI) / (Math.PI * 2)) * seg) % seg;
      if (yy < -h / 2 + 1e-6) {
        // a jagged skirt of drooping branch tips
        const f = idx % 2 ? 1.17 : 0.9 + 0.06 * Math.sin(idx * 12.9 + seed);
        p.setXYZ(i, x * f, yy - (idx % 2 ? 0.028 : 0.004), z * f);
      } else if (yy < h / 2 - 1e-6) {
        // pull the middle in for a concave, layered silhouette
        p.setXYZ(i, x * 0.84, yy, z * 0.84);
      }
    }
    c.rotateY(r() * Math.PI).translate(0, y + h / 2, 0);
    cones.push(c);
    y += h * 0.52;
    rad *= 0.77;
    h *= 0.88;
  }
  const height = y + h * 0.6;
  cones.forEach((c, t) => parts.push(paint(c, '#173f24', { top: '#4f9a55', y0: 0.03, y1: height, ao: 0.15, vary: 0.16, seed: seed + t })));
  return merge(parts);
}

function leafyGeo(seed, leaf, leafTop) {
  const r = rng(seed);
  const bark = { top: '#6d5038', ao: 0.5, vary: 0.12, seed };
  const parts = [paint(new THREE.CylinderGeometry(0.011, 0.022, 0.2, 6).translate(0, 0.1, 0), '#4c3626', bark)];
  for (const s of [-1, 1]) parts.push(paint(place(new THREE.CylinderGeometry(0.005, 0.009, 0.09, 5), s * 0.03, 0.17, s * 0.01, 0, 0, -s * 0.75), '#4c3626', bark));
  const blobs = [
    [0, 0.255, 0, 0.095], [0.07, 0.225, 0.03, 0.072], [-0.065, 0.23, -0.035, 0.076],
    [0.015, 0.215, -0.07, 0.066], [-0.025, 0.215, 0.07, 0.064], [-0.03, 0.31, 0.025, 0.07], [0.04, 0.3, -0.025, 0.062],
  ];
  blobs.forEach(([x, y, z, rad], i) => {
    const b = lumpy(new THREE.IcosahedronGeometry(rad * (0.9 + r() * 0.2), 1), rad * 0.2, seed + i * 3, 26).translate(x, y, z);
    parts.push(paint(b, leaf, { top: leafTop, y0: 0.15, y1: 0.38, ao: 0.25, vary: 0.18, seed: seed + i }));
  });
  return merge(parts);
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
function rockColor(c, n, i, seed, h, snowAt) {
  const k = clamp01(h);
  if (snowAt != null && k > snowAt + 0.05 * Math.sin(c.x * 40 + c.z * 30 + seed) && n.y > 0.12) return shade('#eef3f7', 0.88 + 0.12 * n.y);
  const band = Math.sin(c.y * 75 + c.x * 9 + seed) * 0.5 + 0.5; // strata
  const col = new THREE.Color('#47505b').lerp(new THREE.Color('#8f9aa6'), 0.2 + 0.5 * k + band * 0.15);
  const f = hash(i, seed);
  // ore in the lower slopes: rusty iron and the odd fleck of gold
  if (k < 0.45 && f < 0.022) col.set('#7e4a2e');
  else if (k < 0.45 && f < 0.03) col.set('#c99a32');
  return col.multiplyScalar((0.62 + 0.38 * clamp01(k * 2.2)) * (0.9 + 0.2 * hash(seed, i)) * (0.85 + 0.15 * Math.max(0, n.y)));
}

function peakGeo(seed) {
  // a craggy, tapering peak: lumpy rock, narrowed toward the summit, with one side pushed out
  const g = lumpy(new THREE.IcosahedronGeometry(0.24, 2), 0.05, seed, 9).scale(1, 1.75, 1).translate(0, 0.14, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const k = clamp01(y / 0.56);
    const f = 1 - 0.5 * k * k + 0.08 * Math.sin(y * 40 + seed);
    p.setXYZ(i, p.getX(i) * f + 0.03 * k * Math.sin(seed), y, p.getZ(i) * f);
  }
  g.computeVertexNormals();
  return paintFaces(g, (c, n, i) => rockColor(c, n, i, seed, c.y / 0.56, 0.72));
}

function boulderGeo(seed, tone) {
  const g = lumpy(new THREE.IcosahedronGeometry(0.05, 1), 0.014, seed, 30).scale(1, 0.75, 1).translate(0, 0.022, 0);
  if (tone) return paint(g, tone, { top: new THREE.Color(tone).multiplyScalar(1.25), ao: 0.35, vary: 0.18, seed });
  return paintFaces(g, (c, n, i) => rockColor(c, n, i + 7, seed, 0.3 + c.y * 4, null));
}

function mineGeo() {
  const wood = '#7a5532';
  const parts = [
    paintFaces(lumpy(new THREE.IcosahedronGeometry(0.16, 1), 0.03, 11, 14).scale(1.15, 0.8, 0.9).translate(0, 0.05, 0), (c, n, i) => rockColor(c, n, i, 11, 0.25 + c.y * 3, null)),
    paint(new THREE.BoxGeometry(0.072, 0.085, 0.04).translate(0, 0.0425, 0.133), '#0f0b08'),
    paint(new THREE.BoxGeometry(0.013, 0.095, 0.013).translate(-0.043, 0.0475, 0.156), wood, { vary: 0.1 }),
    paint(new THREE.BoxGeometry(0.013, 0.095, 0.013).translate(0.043, 0.0475, 0.156), wood, { vary: 0.1 }),
    paint(new THREE.BoxGeometry(0.11, 0.015, 0.016).translate(0, 0.1, 0.156), wood, { vary: 0.1 }),
  ];
  // rails out of the mine, on sleepers
  for (const x of [-0.019, 0.019]) parts.push(paint(new THREE.BoxGeometry(0.004, 0.005, 0.2).translate(x, 0.008, 0.255), '#5c6168'));
  for (let k = 0; k < 6; k++) parts.push(paint(new THREE.BoxGeometry(0.058, 0.005, 0.012).translate(0, 0.003, 0.17 + k * 0.034), '#5e4128', { vary: 0.12, seed: k }));
  // an ore cart heaped with rock, rust and gold
  const cz = 0.29, metal = '#59606a';
  parts.push(paint(new THREE.BoxGeometry(0.052, 0.006, 0.072).translate(0, 0.024, cz), metal));
  for (const s of [-1, 1]) {
    parts.push(paint(new THREE.BoxGeometry(0.004, 0.032, 0.072).translate(s * 0.026, 0.04, cz), metal, { top: '#7a828c' }));
    parts.push(paint(new THREE.BoxGeometry(0.052, 0.032, 0.004).translate(0, 0.04, cz + s * 0.036), metal, { top: '#7a828c' }));
    for (const dz of [-0.022, 0.022]) parts.push(paint(new THREE.CylinderGeometry(0.011, 0.011, 0.006, 10).rotateZ(Math.PI / 2).translate(s * 0.028, 0.012, cz + dz), '#2e2a28'));
  }
  const ores = ['#7e8790', '#6c747c', '#9a5a34', '#d6aa3c', '#8d959d', '#b06a3a'];
  ores.forEach((c, k) => parts.push(paint(new THREE.IcosahedronGeometry(0.013, 0).translate(((k % 3) - 1) * 0.015, 0.058 + (k > 2 ? 0.008 : 0), cz + ((k % 2) - 0.5) * 0.026), c, { vary: 0.15, seed: k })));
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
    pines: [pineGeo(3, 4), pineGeo(17, 5), pineGeo(29, 4)],
    leafy: [leafyGeo(5, '#244f20', '#5f9f3c'), leafyGeo(13, '#3d7a25', '#97c654'), leafyGeo(21, '#7d6a16', '#d8c445'), leafyGeo(37, '#93401a', '#ef9a35')],
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
    mine: mineGeo(),
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
    for (const [x, z] of scatter(r, 12, { minGap: 0.14, outer: 0.78 })) {
      const s = 0.82 + r() * 0.42;
      const leafy = r() < 0.32;
      const geo = leafy ? (r() < 0.2 ? g.leafy[2 + Math.floor(r() * 2)] : g.leafy[Math.floor(r() * 2)]) : pick(g.pines);
      b.add(geo, m.flat, mat(X + x, y, Z + z, r() * 6, s, s * (0.92 + r() * 0.16)), tint());
    }
    for (const [x, z] of scatter(r, 3, { inner: 0.3, outer: 0.8, minGap: 0.1 })) b.add(g.bush, m.flat, mat(X + x, y, Z + z, r() * 6, 0.8 + r() * 0.5), tint());
    for (const [x, z] of scatter(r, 7, { inner: 0.3, outer: 0.82, minGap: 0.06 })) b.add(g.forestGrass, m.plant, mat(X + x, y, Z + z, r() * 6, 0.8 + r() * 0.5), tint(0.2));
    if (r() < 0.6) {
      const [x, z] = scatter(r, 1, { inner: 0.45, outer: 0.7 })[0] || [0.5, 0.2];
      b.add(g.log, m.flat, mat(X + x, y, Z + z, r() * 6, 0.9 + r() * 0.2));
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
    });
    // the mine faces the players, so its timbers and ore cart show
    if (spots[3]) b.add(g.mine, m.flat, mat(X + spots[3][0], y, Z + spots[3][1], (r() - 0.5) * 0.8, 0.85));
    if (spots[4]) b.add(g.blocks, m.flat, mat(X + spots[4][0], y, Z + spots[4][1], r() * 6, 0.9));
    for (const [x, z] of scatter(r, 7, { minGap: 0.08 })) b.add(pick(g.boulders), m.flat, mat(X + x, y, Z + z, r() * 6, 0.5 + r() * 0.8), tint(0.1));
  } else if (type === 'desert') {
    for (const [x, z] of scatter(r, 3, { minGap: 0.3, inner: 0.3 })) b.add(g.dune, m.smooth, mat(X + x, y, Z + z, r() * 6, 0.8 + r() * 0.4));
    for (const [x, z] of scatter(r, 3, { minGap: 0.22, inner: 0.42 })) b.add(pick(g.cacti), m.flat, mat(X + x, y, Z + z, r() * 6, 0.8 + r() * 0.45), tint(0.1));
    for (const [x, z] of scatter(r, 5, { minGap: 0.1 })) b.add(g.redRock, m.flat, mat(X + x, y, Z + z, r() * 6, 0.6 + r() * 0.6));
  }
  return extras;
}
