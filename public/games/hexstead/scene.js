// Hexstead 3D board (three.js). Everything is modelled in code — no image or model files:
// beveled terrain tiles with painted tops, harbors with piers and sailboats, painted wooden
// homesteads, barns with silos, trails, a bandit in a wide-brim hat, and dice that tumble.
// The scenery on the tiles (trees, sheep, wheat, kilns, quarries…) comes from props.js.
import * as THREE from '../../vendor/three/three.webgpu.min.js';
import { context, renderOutput, vec3, vec4, mix, texture, screenUV, uniform, rangeFogFactor } from '../../vendor/three/three.tsl.min.js';
import { OrbitControls } from '../../vendor/three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from '../../vendor/three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from '../../vendor/three/addons/geometries/RoundedBoxGeometry.js';
import { board as islandGeometry, PIPS } from './geometry.js';
import { SEAT_COLORS, RES_ICON, RES_COLORS, svgUrl } from './art.js';
import { makeKit, decorate, Batcher } from './props.js';

const BASE = 0.12; // top of the sandy island
const TILE_H = 0.16;
const BEVEL = 0.035;
const TOP = BASE + TILE_H + BEVEL; // walking surface of a tile
// base, dark, light. Picked so every terrain reads apart at a glance: deep woodland green vs
// bright spring pasture, golden-amber wheat that no longer melts into the beach, warm terracotta
// clay, cool blue-slate quarry, and pale dune desert.
const TERRAIN_COLORS = {
  forest: ['#2b5f36', '#1d4628', '#3d7a45'],
  pasture: ['#84c24c', '#69a83a', '#a3d76a'],
  fields: ['#e2a930', '#c58a1a', '#f2c65a'],
  clay: ['#c8623a', '#a24726', '#de7d50'],
  quarry: ['#86909c', '#69727e', '#a6afba'],
  desert: ['#ecd5a6', '#dcbd86', '#f6e6c2'],
};

// ---------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------
function seeded(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function canvasTexture(w, h, draw, { srgb = true, repeat = false } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}
const ease = {
  out: (t) => 1 - (1 - t) ** 3,
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  bounce: (t) => {
    const n = 7.5625, d = 2.75;
    if (t < 1 / d) return n * t * t;
    if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
    if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
    return n * (t -= 2.625 / d) * t + 0.984375;
  },
};
const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0, ...extra });

// ---------------------------------------------------------------------
// tone mapping
// ---------------------------------------------------------------------
// Each material tone-maps (ACES) and sRGB-encodes its own colour as it draws, as under WebGL (see
// the output setup in createScene). The sky is drawn by three's background mesh, which can't be
// marked toneMapped: false, so untoneNode() runs the ACES curve backwards on it first: the sky
// gradient then reaches the screen in its own colours, as it did before.
const EXPOSURE = 1.05;
const rowsOf = (m) => {
  const e = m.transpose().elements;
  return [e.slice(0, 3), e.slice(3, 6), e.slice(6, 9)];
};
// three's ACESOutputMat and ACESInputMat, inverted
const ACES_OUT_INV = rowsOf(new THREE.Matrix3().set(1.60475, -0.53108, -0.07367, -0.10208, 1.10813, -0.00605, -0.00327, -0.07276, 1.07602).invert());
const ACES_IN_INV = rowsOf(new THREE.Matrix3().set(0.59719, 0.35458, 0.04823, 0.076, 0.90834, 0.01566, 0.0284, 0.13383, 0.83777).invert());
function untoneNode(rgb) {
  const m = (rows, v) => vec3(...rows.map((r) => vec3(...r).dot(v)));
  const y = m(ACES_OUT_INV, rgb).clamp(0, 1);
  // inverse of the RRT/ODT fit (v² + 0.0245786v − 0.000090537) / (0.983729v² + 0.432951v + 0.238081)
  const a = y.mul(0.983729).sub(1), b = y.mul(0.432951).sub(0.0245786), c = y.mul(0.238081).add(0.000090537);
  const v = b.mul(-1).sub(b.mul(b).sub(a.mul(c).mul(4)).sqrt()).div(a.mul(2));
  return m(ACES_IN_INV, v).mul(0.6 / EXPOSURE).max(0);
}

// tileable noise built from integer-frequency waves
function waveNoise(seed, w, h) {
  const r = seeded(seed);
  const waves = Array.from({ length: 14 }, () => ({
    fx: Math.floor(r() * 9) - 4 || 1,
    fy: Math.floor(r() * 9) - 4 || 2,
    ph: r() * Math.PI * 2,
    a: 0.4 + r(),
  }));
  return (x, y) => {
    let v = 0;
    for (const k of waves) v += k.a * Math.sin(((k.fx * x) / w + (k.fy * y) / h) * Math.PI * 2 + k.ph);
    return v;
  };
}

// ---------------------------------------------------------------------
// textures
// ---------------------------------------------------------------------
function terrainTexture(t, seed) {
  const [base, dark, light] = TERRAIN_COLORS[t];
  return canvasTexture(512, 512, (g, w, h) => {
    const r = seeded(seed);
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    const blot = (color, n, rmin, rmax, alpha) => {
      g.globalAlpha = alpha;
      g.fillStyle = color;
      for (let i = 0; i < n; i++) {
        g.beginPath();
        g.ellipse(r() * w, r() * h, rmin + r() * (rmax - rmin), rmin + r() * (rmax - rmin), r() * 3, 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;
    };
    blot(dark, 60, 14, 60, 0.35);
    blot(light, 60, 10, 46, 0.28);
    if (t === 'fields') {
      g.strokeStyle = dark;
      g.globalAlpha = 0.55;
      g.lineWidth = 6;
      for (let y = -w; y < w * 2; y += 26) {
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(w, y + w * 0.35);
        g.stroke();
      }
      g.globalAlpha = 1;
    }
    if (t === 'pasture' || t === 'forest') {
      g.strokeStyle = t === 'pasture' ? light : dark;
      g.globalAlpha = 0.5;
      g.lineWidth = 2;
      for (let i = 0; i < 1600; i++) {
        const x = r() * w, y = r() * h;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + (r() - 0.5) * 6, y - 4 - r() * 7);
        g.stroke();
      }
      g.globalAlpha = 1;
    }
    if (t === 'clay') {
      g.strokeStyle = '#7a3519';
      g.globalAlpha = 0.45;
      g.lineWidth = 2.5;
      for (let i = 0; i < 50; i++) {
        let x = r() * w, y = r() * h;
        g.beginPath();
        g.moveTo(x, y);
        for (let k = 0; k < 4; k++) g.lineTo((x += (r() - 0.5) * 50), (y += (r() - 0.5) * 50));
        g.stroke();
      }
      g.globalAlpha = 1;
    }
    if (t === 'quarry') blot('#54595f', 140, 3, 12, 0.5);
    if (t === 'desert') {
      g.strokeStyle = '#c29d5e';
      g.globalAlpha = 0.45;
      g.lineWidth = 3;
      for (let y = 0; y < h; y += 22) {
        g.beginPath();
        for (let x = 0; x <= w; x += 8) g.lineTo(x, y + Math.sin(x / 40 + y) * 7);
        g.stroke();
      }
      g.globalAlpha = 1;
    }
    // speckle grain
    const img = g.getImageData(0, 0, w, h);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (r() - 0.5) * 22;
      img.data[i] += n;
      img.data[i + 1] += n;
      img.data[i + 2] += n;
    }
    g.putImageData(img, 0, 0);
  });
}

function sandTexture() {
  return canvasTexture(
    512,
    512,
    (g, w, h) => {
      const r = seeded(77);
      g.fillStyle = '#e6cf9a';
      g.fillRect(0, 0, w, h);
      const img = g.getImageData(0, 0, w, h);
      for (let i = 0; i < img.data.length; i += 4) {
        const n = (r() - 0.5) * 30;
        img.data[i] += n;
        img.data[i + 1] += n * 0.9;
        img.data[i + 2] += n * 0.7;
      }
      g.putImageData(img, 0, 0);
    },
    { repeat: true },
  );
}

function waterNormals() {
  const S = 256;
  const n = waveNoise(11, S, S);
  return canvasTexture(
    S,
    S,
    (g) => {
      const img = g.createImageData(S, S);
      for (let y = 0; y < S; y++)
        for (let x = 0; x < S; x++) {
          const dx = n(x + 1, y) - n(x - 1, y);
          const dy = n(x, y + 1) - n(x, y - 1);
          const len = Math.hypot(dx, dy, 2.4);
          const i = (y * S + x) * 4;
          img.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
          img.data[i + 1] = ((-dy / len) * 0.5 + 0.5) * 255;
          img.data[i + 2] = ((2.4 / len) * 0.5 + 0.5) * 255;
          img.data[i + 3] = 255;
        }
      g.putImageData(img, 0, 0);
    },
    { srgb: false, repeat: true },
  );
}

function skyTexture() {
  return canvasTexture(8, 512, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#3f78b8');
    gr.addColorStop(0.45, '#8fbde3');
    gr.addColorStop(0.75, '#d9e8ef');
    gr.addColorStop(1, '#eef1e6');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  });
}

function tokenTexture(num) {
  return canvasTexture(256, 256, (g, w) => {
    const c = w / 2;
    const gr = g.createRadialGradient(c * 0.85, c * 0.8, 10, c, c, c);
    gr.addColorStop(0, '#fbf3df');
    gr.addColorStop(1, '#e4d3ad');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, w);
    g.strokeStyle = '#b89b67';
    g.lineWidth = 6;
    g.beginPath();
    g.arc(c, c, c - 14, 0, Math.PI * 2);
    g.stroke();
    const hot = num === 6 || num === 8;
    g.fillStyle = hot ? '#b3261e' : '#2a2118';
    g.font = `900 ${hot ? 112 : 104}px "Roboto Slab", Georgia, serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(num), c, c - 14);
    const pips = PIPS[num];
    for (let i = 0; i < pips; i++) {
      g.beginPath();
      g.arc(c + (i - (pips - 1) / 2) * 20, c + 62, 7, 0, Math.PI * 2);
      g.fill();
    }
  });
}

function dieFace(value, red) {
  return canvasTexture(128, 128, (g, w) => {
    g.fillStyle = red ? '#c0392b' : '#f4ecd8';
    g.fillRect(0, 0, w, w);
    const spots = {
      1: [[0.5, 0.5]],
      2: [[0.28, 0.28], [0.72, 0.72]],
      3: [[0.26, 0.26], [0.5, 0.5], [0.74, 0.74]],
      4: [[0.28, 0.28], [0.72, 0.28], [0.28, 0.72], [0.72, 0.72]],
      5: [[0.26, 0.26], [0.74, 0.26], [0.5, 0.5], [0.26, 0.74], [0.74, 0.74]],
      6: [[0.28, 0.24], [0.72, 0.24], [0.28, 0.5], [0.72, 0.5], [0.28, 0.76], [0.72, 0.76]],
    }[value];
    for (const [x, y] of spots) {
      const gr = g.createRadialGradient(x * w - 3, y * w - 3, 1, x * w, y * w, 11);
      gr.addColorStop(0, red ? '#ffffff' : '#4a3a2c');
      gr.addColorStop(1, red ? '#e9dcd2' : '#17100a');
      g.fillStyle = gr;
      g.beginPath();
      g.arc(x * w, y * w, 10, 0, Math.PI * 2);
      g.fill();
    }
  });
}

// A round harbor sign: parchment face, a thick ring in the resource's colour (navy for the 3:1
// "any" harbors), the resource icon, and the rate on a dark ribbon so it reads from across the
// board. Drawn at 256px; the icon is painted in once its SVG has loaded.
function harborSign(type) {
  const S = 256, c = S / 2;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  const ring = type === 'any' ? '#2b4f7a' : RES_COLORS[type][0];
  // drop shadow, ring, face
  g.fillStyle = 'rgba(0,0,0,0.28)';
  g.beginPath();
  g.arc(c + 3, c + 6, c - 8, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(c, c, c - 8, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = ring;
  g.beginPath();
  g.arc(c, c, c - 15, 0, Math.PI * 2);
  g.fill();
  const face = g.createRadialGradient(c - 20, c - 30, 10, c, c, c - 34);
  face.addColorStop(0, '#fffaf0');
  face.addColorStop(1, '#efe2c2');
  g.fillStyle = face;
  g.beginPath();
  g.arc(c, c, c - 34, 0, Math.PI * 2);
  g.fill();
  const ribbon = (text, y, h, size) => {
    g.fillStyle = '#21180f';
    g.beginPath();
    g.roundRect(c - 70, y - h / 2, 140, h, h / 2);
    g.fill();
    g.fillStyle = '#ffffff';
    g.font = `900 ${size}px "Roboto Slab", Georgia, serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, c, y + 3);
  };
  if (type === 'any') {
    g.fillStyle = '#21180f';
    g.font = '900 96px "Roboto Slab", Georgia, serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('3:1', c, c - 24);
    g.fillStyle = ring;
    g.font = '900 40px Inter, system-ui, sans-serif';
    g.fillText('ANY', c, c + 50);
  } else {
    ribbon('2:1', c + 56, 58, 48);
    const img = new Image();
    img.onload = () => {
      g.drawImage(img, c - 54, c - 88, 108, 108);
      t.needsUpdate = true;
    };
    img.src = svgUrl(RES_ICON[type]);
  }
  return t;
}

// draw an SVG icon onto a sprite texture once it has loaded
function iconTexture(svg, ring) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  // make the 2D context now: WebGPU can't upload a canvas that has none yet
  const g = c.getContext('2d');
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const img = new Image();
  img.onload = () => {
    if (ring) {
      g.fillStyle = ring;
      g.beginPath();
      g.arc(64, 64, 60, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#fff';
      g.lineWidth = 6;
      g.stroke();
      g.drawImage(img, 22, 22, 84, 84);
    } else g.drawImage(img, 0, 0, 128, 128);
    t.needsUpdate = true;
  };
  img.src = svgUrl(svg);
  return t;
}

const UP = new THREE.Vector3(0, 1, 0);

// ---------------------------------------------------------------------
// player pieces
// ---------------------------------------------------------------------
function pieceMaterials(color) {
  const c = new THREE.Color(color);
  return {
    body: new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.42, clearcoat: 0.6, clearcoatRoughness: 0.35 }),
    roof: new THREE.MeshPhysicalMaterial({ color: c.clone().multiplyScalar(0.62), roughness: 0.5, clearcoat: 0.4 }),
    trim: std('#fbf8f0', { roughness: 0.5 }),
    metal: new THREE.MeshStandardMaterial({ color: '#c9ced4', roughness: 0.35, metalness: 0.7 }),
    dark: std('#3a2c22'),
  };
}

function prism(shapePts, depth) {
  const sh = new THREE.Shape(shapePts.map(([x, y]) => new THREE.Vector2(x, y)));
  const geo = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 1 });
  geo.translate(0, 0, -depth / 2);
  return geo;
}

function makePieceGeos() {
  return {
    road: new RoundedBoxGeometry(0.56, 0.07, 0.1, 2, 0.022),
    houseBody: new RoundedBoxGeometry(0.2, 0.15, 0.17, 2, 0.012).translate(0, 0.075, 0),
    houseRoof: prism([[-0.125, 0], [0, 0.11], [0.125, 0]], 0.21).translate(0, 0.148, 0),
    chimney: new THREE.BoxGeometry(0.03, 0.07, 0.03).translate(0.05, 0.22, -0.03),
    door: new THREE.BoxGeometry(0.045, 0.075, 0.006).translate(0, 0.038, 0.088),
    window: new THREE.BoxGeometry(0.006, 0.04, 0.04),
    barnBody: new RoundedBoxGeometry(0.3, 0.2, 0.24, 2, 0.014).translate(0, 0.1, 0),
    barnRoof: prism([[-0.17, 0], [-0.14, 0.085], [0, 0.15], [0.14, 0.085], [0.17, 0]], 0.28).translate(0, 0.198, 0),
    barnDoor: new THREE.BoxGeometry(0.11, 0.13, 0.006).translate(0, 0.067, 0.122),
    barnX: new THREE.BoxGeometry(0.15, 0.012, 0.004),
    silo: new THREE.CylinderGeometry(0.058, 0.058, 0.3, 18).translate(0, 0.15, 0),
    siloCap: new THREE.SphereGeometry(0.06, 18, 9, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.3, 0),
    siloBand: new THREE.TorusGeometry(0.059, 0.005, 6, 24).rotateX(Math.PI / 2),
  };
}

function buildHouse(geos, mats) {
  const g = new THREE.Group();
  const add = (geo, m, f) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (f) f(mesh);
    g.add(mesh);
  };
  add(geos.houseBody, mats.body);
  add(geos.houseRoof, mats.roof);
  add(geos.chimney, mats.dark);
  add(geos.door, mats.trim);
  add(geos.window, mats.trim, (m) => m.position.set(0.101, 0.09, 0));
  add(geos.window, mats.trim, (m) => m.position.set(-0.101, 0.09, 0));
  return g;
}

function buildBarn(geos, mats) {
  const g = new THREE.Group();
  const add = (geo, m, f) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (f) f(mesh);
    g.add(mesh);
    return mesh;
  };
  add(geos.barnBody, mats.body, (m) => m.position.x = -0.04);
  add(geos.barnRoof, mats.roof, (m) => m.position.x = -0.04);
  add(geos.barnDoor, mats.trim, (m) => m.position.x = -0.04);
  add(geos.barnX, mats.body, (m) => m.position.set(-0.04, 0.067, 0.126)).rotation.z = 0.72;
  add(geos.barnX, mats.body, (m) => m.position.set(-0.04, 0.067, 0.126)).rotation.z = -0.72;
  add(geos.silo, mats.metal, (m) => m.position.set(0.17, 0, -0.04));
  add(geos.siloCap, mats.roof, (m) => m.position.set(0.17, 0, -0.04));
  for (const y of [0.08, 0.16, 0.24]) add(geos.siloBand, mats.dark, (m) => m.position.set(0.17, y, -0.04));
  return g;
}

function buildBandit() {
  const g = new THREE.Group();
  const coat = new THREE.MeshPhysicalMaterial({ color: '#2a2a30', roughness: 0.38, metalness: 0.25, clearcoat: 0.5 });
  const pts = [
    [0, 0], [0.12, 0], [0.13, 0.02], [0.11, 0.05], [0.085, 0.16], [0.07, 0.27], [0.055, 0.31], [0.05, 0.33], [0, 0.33],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const body = new THREE.Mesh(new THREE.LatheGeometry(pts, 28), coat);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.07, 22, 16), coat);
  head.position.y = 0.39;
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.135, 0.14, 0.014, 28), coat);
  brim.position.y = 0.44;
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.075, 0.08, 22), coat);
  crown.position.y = 0.485;
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.073, 0.009, 8, 28).rotateX(Math.PI / 2), std('#8f1d1d', { roughness: 0.6 }));
  band.position.y = 0.455;
  const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.058, 0.02, 10, 28).rotateX(Math.PI / 2), std('#b3261e', { roughness: 0.7 }));
  scarf.position.y = 0.335;
  for (const m of [body, head, brim, crown, band, scarf]) {
    m.castShadow = true;
    g.add(m);
  }
  return g;
}

function buildBoat(rand) {
  const g = new THREE.Group();
  const hull = new THREE.Mesh(prism([[-0.18, 0.05], [-0.13, -0.03], [0.13, -0.03], [0.2, 0.05]], 0.09), std('#7a4b2a', { roughness: 0.7 }));
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.012, 0.096), std(rand() < 0.5 ? '#f0f0ea' : '#c8372d'));
  stripe.position.y = 0.04;
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.008, 0.32, 6), std('#5a3a20'));
  mast.position.set(0.0, 0.2, 0);
  const sailGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0.01, 0.08, 0), new THREE.Vector3(0.01, 0.35, 0), new THREE.Vector3(0.17, 0.08, 0)]);
  sailGeo.computeVertexNormals();
  const sail = new THREE.Mesh(sailGeo, std('#fbf6ea', { side: THREE.DoubleSide, roughness: 0.9 }));
  for (const m of [hull, stripe, mast, sail]) {
    m.castShadow = true;
    g.add(m);
  }
  return g;
}

// ---------------------------------------------------------------------
// the scene
// ---------------------------------------------------------------------
export function createScene(container, { onPick, onHover } = {}) {
  // the island being shown; bigger islands (5–8 players) swap these in setBoard()
  let { HEXES, VERTS, EDGES, HARBOR_SLOTS } = islandGeometry('base');
  let scale = 1; // island size relative to the standard island
  // The canvas goes in now; the WebGPURenderer that draws on it is made once we know whether
  // the browser has WebGPU (see start() below).
  const el = document.createElement('canvas');
  el.className = 'hx-gl';
  container.append(el);
  let renderer = null;
  let highQuality = true;

  const scene = new THREE.Scene();
  // the sky gradient fills the screen behind everything, untouched by tone mapping as before
  const sky = skyTexture();
  scene.backgroundNode = vec4(untoneNode(texture(sky, screenUV.flipY()).rgb), 1);
  // Fog is mixed in after tone mapping, toward '#d9e6ec' as it appears on screen, as under WebGL
  // (see the output setup below), so it isn't a scene.fog: three would mix that in before.
  const fogNear = uniform(22), fogFar = uniform(52);
  const fogColor = vec3(0xd9 / 255, 0xe6 / 255, 0xec / 255);
  let pmrem = null;
  // r181–r186 PBR made diffuse surfaces a little darker; 0.55 (was 0.5) matches the old look
  scene.environmentIntensity = 0.55;

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 120);
  const controls = new OrbitControls(camera, el);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = true;
  controls.screenSpacePanning = false;
  controls.minDistance = 5;
  controls.maxDistance = 24;
  controls.minPolarAngle = 0.12;
  controls.maxPolarAngle = 1.2;
  controls.target.set(0, 0, 0.9);

  // lights
  // a warm late-morning sun, a little lower than overhead so trees, sheep and peaks throw
  // longer shadows that show their shape; sky-blue from above, earthy bounce from below
  const SUN_AT = new THREE.Vector3(-7, 10.5, 5.5);
  scene.add(new THREE.HemisphereLight('#d2e8ff', '#6e5d3c', 0.8));
  const sun = new THREE.DirectionalLight('#ffe8c2', 2.75);
  sun.position.copy(SUN_AT);
  sun.castShadow = true;
  sun.shadow.mapSize.set(3072, 3072);
  Object.assign(sun.shadow.camera, { left: -6.4, right: 6.4, top: 6.4, bottom: -6.4, near: 2, far: 30 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = 1.4; // soft edges, but tight enough for a sheep's or a stalk's shadow
  scene.add(sun);
  // a soft, cool fill from the far side so the shaded faces of peaks, trees and barns keep
  // their colour instead of going muddy (no shadows: it only lifts)
  const fill = new THREE.DirectionalLight('#bcd8ff', 0.55);
  fill.position.set(7, 5, -6);
  scene.add(fill);

  // ocean
  const normals = waterNormals();
  normals.repeat.set(10, 10);
  const water = new THREE.Mesh(
    new THREE.CircleGeometry(60, 64).rotateX(-Math.PI / 2),
    new THREE.MeshPhysicalMaterial({ color: '#1d6f9a', roughness: 0.12, metalness: 0.05, normalMap: normals, normalScale: new THREE.Vector2(0.35, 0.35), clearcoat: 1, clearcoatRoughness: 0.08 }),
  );
  water.receiveShadow = true;
  scene.add(water);
  const lagoon = new THREE.Mesh(
    new THREE.RingGeometry(4.6, 7.4, 96).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({
      map: canvasTexture(512, 8, (g, w) => {
        const gr = g.createLinearGradient(0, 0, w, 0);
        gr.addColorStop(0, 'rgba(110,232,214,0.82)');
        gr.addColorStop(0.35, 'rgba(60,196,206,0.4)');
        gr.addColorStop(1, 'rgba(40,140,180,0)');
        g.fillStyle = gr;
        g.fillRect(0, 0, w, 8);
      }),
      transparent: true,
      depthWrite: false,
    }),
  );
  // map the gradient across the ring's radius
  {
    const uv = lagoon.geometry.attributes.uv;
    const pos = lagoon.geometry.attributes.position;
    for (let i = 0; i < uv.count; i++) {
      const rr = Math.hypot(pos.getX(i), pos.getZ(i));
      uv.setXY(i, (rr - 4.6) / 2.8, 0.5);
    }
  }
  lagoon.position.y = 0.006;
  scene.add(lagoon);
  const foam = new THREE.Mesh(
    new THREE.RingGeometry(4.7, 4.95, 96).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55, depthWrite: false }),
  );
  foam.position.y = 0.012;
  scene.add(foam);

  // island
  const sandTex = sandTexture();
  sandTex.repeat.set(3, 3);
  const island = new THREE.Mesh(new THREE.CylinderGeometry(4.72, 5.05, 0.5, 72), std('#e4cb93', { map: sandTex, roughness: 1 }));
  island.position.y = BASE - 0.25;
  island.receiveShadow = true;
  scene.add(island);

  const board = new THREE.Group();
  scene.add(board);
  const pieces = new THREE.Group();
  scene.add(pieces);
  const markers = new THREE.Group();
  // after the see-through sea rings, which would tint the far markers
  markers.renderOrder = 1;
  scene.add(markers);
  const fx = new THREE.Group();
  scene.add(fx);

  const kit = makeKit();
  // kiln smoke: a few soft puffs per chimney, cycling up and drifting with the breeze
  const smokeTex = canvasTexture(64, 64, (g, w) => {
    const gr = g.createRadialGradient(w / 2, w / 2, 2, w / 2, w / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,255,255,0.9)');
    gr.addColorStop(0.5, 'rgba(255,255,255,0.45)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, w);
  });
  let smoke = [];
  function addSmoke([x, y, z]) {
    const ph = Math.random();
    for (let i = 0; i < 6; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, color: '#ece7df', transparent: true, depthWrite: false, opacity: 0 }));
      board.add(sp);
      smoke.push({ sp, x, y, z, ph: ph + i / 6 });
    }
  }
  const pieceGeos = makePieceGeos();
  const seatMats = SEAT_COLORS.map(pieceMaterials);
  const hexShape = new THREE.Shape();
  for (let i = 0; i < 6; i++) {
    const a = ((60 * i - 30) * Math.PI) / 180;
    const p = [Math.cos(a) * 0.955, Math.sin(a) * 0.955];
    if (i === 0) hexShape.moveTo(...p);
    else hexShape.lineTo(...p);
  }
  hexShape.closePath();
  const hexGeo = new THREE.ExtrudeGeometry(hexShape, { depth: TILE_H, bevelEnabled: true, bevelThickness: BEVEL, bevelSize: BEVEL, bevelSegments: 3, curveSegments: 1 });
  hexGeo.rotateX(-Math.PI / 2);
  const tileSide = std('#7a5a3a', { roughness: 0.85 });
  const tokenGeo = new THREE.CylinderGeometry(0.27, 0.27, 0.045, 48);
  const tokenSide = std('#e8d8b2', { roughness: 0.6 });

  let tiles = [];
  let tokens = [];
  let boats = [];
  let bandit = null;
  let banditHex = null;
  let boardKey = null;
  let pieceMap = new Map();
  let anims = [];
  let targets = null;
  let hovered = null;
  let ghost = null;
  let destroyed = false;

  function setBoard(view) {
    const key = JSON.stringify(view.hexes) + JSON.stringify(view.harbors);
    if (key === boardKey) return;
    boardKey = key;
    const g = islandGeometry(view.size || 'base');
    ({ HEXES, VERTS, EDGES, HARBOR_SLOTS } = g);
    fitIsland(g);
    board.clear();
    smoke = [];
    tiles = [];
    tokens = [];
    boats = [];
    const tileMats = {};
    for (const t of Object.keys(TERRAIN_COLORS)) {
      const tex = terrainTexture(t, t.length * 17);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(0.5, 0.5);
      tex.offset.set(0.5, 0.5);
      tileMats[t] = std('#ffffff', { map: tex, roughness: 0.92, emissive: '#000000' });
    }
    const batch = new Batcher();
    view.hexes.forEach((h, i) => {
      const hx = HEXES[i];
      const top = tileMats[h.t].clone();
      const tile = new THREE.Mesh(hexGeo, [top, tileSide]);
      tile.position.set(hx.x, BASE, hx.z);
      tile.receiveShadow = true;
      tile.castShadow = true;
      tile.userData = { kind: 'hex', id: i };
      board.add(tile);
      tiles.push(tile);
      for (const p of decorate(batch, kit, h.t, hx, i * 97 + 13, TOP).smoke) addSmoke(p);
      if (h.n) {
        // a little self-light keeps the numbers crisp and cream-white under the tone mapping
        const face = tokenTexture(h.n);
        const tok = new THREE.Mesh(tokenGeo, [tokenSide, std('#ffffff', { map: face, emissive: '#ffffff', emissiveMap: face, emissiveIntensity: 0.28, roughness: 0.55 }), tokenSide]);
        tok.position.set(hx.x, TOP + 0.022, hx.z);
        tok.rotation.y = Math.PI / 2;
        tok.castShadow = true;
        tok.receiveShadow = true;
        tok.userData = { baseY: tok.position.y, num: h.n, hex: i };
        board.add(tok);
        tokens.push(tok);
      }
    });
    batch.build(board);

    // harbors: a pier out to sea, planks to the two corners, a sign and a boat
    const plank = std('#9a6a3e', { roughness: 0.8 });
    const postMat = std('#5a3a20');
    const r = seeded(5);
    view.harbors.forEach((hb) => {
      const slot = HARBOR_SLOTS[hb.slot];
      const ang = Math.atan2(slot.nz, slot.nx);
      const grp = new THREE.Group();
      const deck = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.035, 0.2), plank);
      deck.position.set(0.55, BASE + 0.02, 0);
      grp.add(deck);
      for (const [px, pz] of [[0.32, 0.09], [0.32, -0.09], [0.84, 0.09], [0.84, -0.09]]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.3, 6), postMat);
        post.position.set(px, BASE - 0.08, pz);
        grp.add(post);
      }
      grp.position.set(slot.x, 0, slot.z);
      grp.rotation.y = -ang;
      grp.traverse((m) => m.isMesh && ((m.castShadow = true), (m.receiveShadow = true)));
      board.add(grp);
      // gangplanks to the corners
      for (const v of slot.verts) {
        const vx = VERTS[v].x, vz = VERTS[v].z;
        const ex = slot.x + slot.nx * 0.3, ez = slot.z + slot.nz * 0.3;
        const len = Math.hypot(ex - vx, ez - vz);
        const g = new THREE.Mesh(new THREE.BoxGeometry(len, 0.02, 0.06), plank);
        g.position.set((vx + ex) / 2, BASE + 0.012, (vz + ez) / 2);
        g.rotation.y = -Math.atan2(ez - vz, ex - vx);
        g.castShadow = g.receiveShadow = true;
        board.add(g);
      }
      // shown in its own colours (no tone mapping) and never faded by the haze, so the far
      // harbors' rates stay as readable as the near ones
      const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: harborSign(hb.type), depthWrite: false, toneMapped: false, fog: false }));
      sign.scale.set(0.66, 0.66, 1);
      sign.position.set(slot.x + slot.nx * 0.95, 0.62, slot.z + slot.nz * 0.95);
      sign.renderOrder = 2;
      board.add(sign);
      // a post holding the sign up from the water
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.018, 0.34, 6), postMat);
      pole.position.set(sign.position.x, 0.13, sign.position.z);
      pole.castShadow = true;
      board.add(pole);
      const boat = buildBoat(r);
      boat.position.set(slot.x + slot.nx * 1.35 + slot.nz * 0.35, 0, slot.z + slot.nz * 1.35 - slot.nx * 0.35);
      boat.rotation.y = -ang + Math.PI / 2 + (r() - 0.5);
      boat.userData = { phase: r() * 6 };
      board.add(boat);
      boats.push(boat);
    });
  }

  // ---------- pieces ----------
  function vertexPos(v) {
    return new THREE.Vector3(VERTS[v].x, TOP, VERTS[v].z);
  }
  function makePiece(kind, seat, id) {
    const mats = seatMats[seat];
    let obj;
    if (kind === 'road') {
      const e = EDGES[id];
      obj = new THREE.Mesh(pieceGeos.road, mats.body);
      obj.castShadow = obj.receiveShadow = true;
      obj.position.set(e.x, TOP + 0.035, e.z);
      obj.rotation.y = -Math.atan2(VERTS[e.b].z - VERTS[e.a].z, VERTS[e.b].x - VERTS[e.a].x);
    } else {
      obj = kind === 'town' ? buildBarn(pieceGeos, mats) : buildHouse(pieceGeos, mats);
      obj.position.copy(vertexPos(id));
      // face roughly toward the viewer, with a little variety
      obj.rotation.y = (((id * 47) % 40) - 20) * (Math.PI / 180);
    }
    obj.userData.kind = kind;
    return obj;
  }

  function dropIn(obj, delay = 0) {
    const y0 = obj.position.y;
    obj.position.y = y0 + 1.4;
    obj.visible = false;
    anims.push({
      t0: performance.now() + delay,
      dur: 650,
      step(k) {
        obj.visible = true;
        obj.position.y = y0 + 1.4 * (1 - ease.bounce(k));
      },
    });
  }

  function sync(view, { animate = true } = {}) {
    const want = new Map();
    view.verts.forEach((b, v) => b && want.set(`v${v}`, { kind: b.k, seat: b.o, id: v }));
    view.roads.forEach((o, e) => o != null && want.set(`e${e}`, { kind: 'road', seat: o, id: e }));
    for (const [key, obj] of pieceMap) {
      const w = want.get(key);
      if (!w || w.kind !== obj.userData.kind) {
        pieces.remove(obj);
        pieceMap.delete(key);
      }
    }
    for (const [key, w] of want) {
      if (pieceMap.has(key)) continue;
      const obj = makePiece(w.kind, w.seat, w.id);
      pieces.add(obj);
      pieceMap.set(key, obj);
      if (animate) dropIn(obj);
    }
    // bandit
    if (!bandit) {
      bandit = buildBandit();
      scene.add(bandit);
    }
    const hx = HEXES[view.bandit];
    const dest = new THREE.Vector3(hx.x + 0.28, TOP, hx.z - 0.22);
    if (banditHex == null || !animate) bandit.position.copy(dest);
    else if (banditHex !== view.bandit) {
      const from = bandit.position.clone();
      anims.push({
        t0: performance.now(),
        dur: 900,
        step(k) {
          const e = ease.inOut(k);
          bandit.position.lerpVectors(from, dest, e);
          bandit.position.y = TOP + Math.sin(Math.PI * e) * 1.4;
          bandit.rotation.y = e * Math.PI * 2;
        },
      });
    }
    banditHex = view.bandit;
    tiles.forEach((t, i) => (t.material[0].color.set(i === view.bandit ? '#9a9a9a' : '#ffffff')));
  }

  // ---------- targets (where the player can click) ----------
  const markerMat = new THREE.MeshBasicMaterial({ color: '#ffd23f', transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false });
  const markerHot = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 1, depthWrite: false, toneMapped: false });
  const haloMat = new THREE.MeshBasicMaterial({ color: '#ffe680', transparent: true, opacity: 0.45, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
  const haloGeo = new THREE.RingGeometry(0.11, 0.17, 32).rotateX(-Math.PI / 2);
  const hitMat = new THREE.MeshBasicMaterial({ visible: false });
  const ringGeo = new THREE.RingGeometry(0.62, 0.8, 6).rotateX(-Math.PI / 2).rotateY(Math.PI / 6);
  const dotGeo = new THREE.SphereGeometry(0.085, 18, 12);
  const dotHit = new THREE.SphereGeometry(0.22, 8, 6);
  const barGeo = new THREE.BoxGeometry(0.42, 0.04, 0.07);
  const barHit = new THREE.BoxGeometry(0.6, 0.2, 0.28);
  const ghostMats = SEAT_COLORS.map((c) => new THREE.MeshStandardMaterial({ color: c, transparent: true, opacity: 0.6, roughness: 0.4, depthWrite: false }));

  function setTargets(t) {
    markers.clear();
    hovered = null;
    clearGhost();
    targets = t && t.ids?.length ? t : null;
    if (!targets) return;
    for (const id of targets.ids) {
      let vis, hit;
      if (targets.kind === 'vertex') {
        vis = new THREE.Mesh(dotGeo, markerMat);
        hit = new THREE.Mesh(dotHit, hitMat);
        vis.position.copy(vertexPos(id)).add(new THREE.Vector3(0, 0.1, 0));
        if (targets.piece === 'town') vis.position.y += 0.3;
        const halo = new THREE.Mesh(haloGeo, haloMat);
        halo.position.copy(vertexPos(id)).add(new THREE.Vector3(0, 0.01, 0));
        halo.userData = { pulse: Math.random() * 6 };
        markers.add(halo);
      } else if (targets.kind === 'edge') {
        const e = EDGES[id];
        vis = new THREE.Mesh(barGeo, markerMat);
        hit = new THREE.Mesh(barHit, hitMat);
        vis.position.set(e.x, TOP + 0.03, e.z);
        vis.rotation.y = -Math.atan2(VERTS[e.b].z - VERTS[e.a].z, VERTS[e.b].x - VERTS[e.a].x);
      } else {
        const hx = HEXES[id];
        vis = new THREE.Mesh(ringGeo, markerMat);
        hit = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.3, 6), hitMat);
        vis.position.set(hx.x, TOP + 0.03, hx.z);
      }
      hit.position.copy(vis.position);
      hit.rotation.copy(vis.rotation);
      vis.userData = { id, pulse: Math.random() * 6 };
      hit.userData = { id, vis };
      markers.add(vis, hit);
    }
  }

  function clearGhost() {
    if (ghost) {
      fx.remove(ghost);
      ghost = null;
    }
  }
  function showGhost(id) {
    clearGhost();
    if (!targets || targets.kind === 'hex' || targets.seat == null) return;
    const piece = targets.piece || (targets.kind === 'edge' ? 'road' : 'homestead');
    const obj = makePiece(piece, targets.seat, id);
    obj.traverse((m) => {
      if (m.isMesh) {
        m.material = ghostMats[targets.seat];
        m.castShadow = false;
      }
    });
    ghost = obj;
    fx.add(obj);
  }

  // ---------- picking ----------
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function hitAt(ev) {
    if (!targets) return null;
    const rect = el.getBoundingClientRect();
    ndc.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(markers.children.filter((m) => m.userData.vis), false);
    if (hits.length) return hits[0].object.userData;
    if (targets.kind === 'hex') {
      const t = ray.intersectObjects(tiles, false)[0];
      if (t && targets.ids.includes(t.object.userData.id)) return { id: t.object.userData.id };
    }
    return null;
  }
  let down = null;
  const onDown = (ev) => (down = { x: ev.clientX, y: ev.clientY, t: performance.now() });
  const onUp = (ev) => {
    if (!down) return;
    const moved = Math.hypot(ev.clientX - down.x, ev.clientY - down.y);
    const quick = performance.now() - down.t < 700;
    down = null;
    if (moved > 8 || !quick) return;
    const h = hitAt(ev);
    if (h) onPick?.(targets.kind, h.id);
    else onPick?.(null, null);
  };
  const onMove = (ev) => {
    if (ev.pointerType === 'touch') return;
    const h = hitAt(ev);
    const id = h ? h.id : null;
    if (id === hovered) return;
    hovered = id;
    for (const m of markers.children) if (m.material === markerMat || m.material === markerHot) m.material = m.userData.id === id ? markerHot : markerMat;
    el.style.cursor = id != null ? 'pointer' : '';
    if (id != null) showGhost(id);
    else clearGhost();
    onHover?.(targets?.kind, id);
  };
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointermove', onMove);

  // ---------- dice ----------
  const dieGeo = new RoundedBoxGeometry(0.3, 0.3, 0.3, 4, 0.045);
  const makeDie = (red) => {
    // BoxGeometry face order: +x, -x, +y, -y, +z, -z
    const faces = [1, 6, 2, 5, 3, 4].map((n) => new THREE.MeshPhysicalMaterial({ map: dieFace(n, red), roughness: 0.3, clearcoat: 0.8 }));
    const d = new THREE.Mesh(dieGeo, faces);
    d.castShadow = true;
    d.receiveShadow = true;
    scene.add(d);
    return d;
  };
  const dice = [makeDie(false), makeDie(true)];
  const FACE_NORMAL = { 1: [1, 0, 0], 6: [-1, 0, 0], 2: [0, 1, 0], 5: [0, -1, 0], 3: [0, 0, 1], 4: [0, 0, -1] };
  const DICE_HOME = [new THREE.Vector3(3.55, BASE + 0.15, 3.0), new THREE.Vector3(3.95, BASE + 0.15, 2.55)];
  const DICE_REST = DICE_HOME.map((v) => v.clone());
  function restQuat(value, yaw) {
    const n = new THREE.Vector3(...FACE_NORMAL[value]);
    const q = new THREE.Quaternion().setFromUnitVectors(n, UP);
    return new THREE.Quaternion().setFromAxisAngle(UP, yaw).multiply(q);
  }
  dice.forEach((d, i) => {
    d.position.copy(DICE_REST[i]);
    d.quaternion.copy(restQuat(i ? 5 : 2, 0.4 + i));
  });
  function rollDice([a, b]) {
    dice.forEach((d, i) => {
      const value = i ? b : a;
      const end = DICE_REST[i].clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.3, 0, (Math.random() - 0.5) * 0.3));
      const start = end.clone().add(new THREE.Vector3(-1.6 - Math.random() * 0.5, 1.8, -1.2 + Math.random() * 0.4));
      const qEnd = restQuat(value, Math.random() * Math.PI * 2);
      const axis = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      const spins = 3 + Math.random() * 2;
      const tmp = new THREE.Quaternion();
      anims.push({
        t0: performance.now() + i * 90,
        dur: 1100,
        step(k) {
          const e = ease.out(k);
          d.position.lerpVectors(start, end, e);
          d.position.y = end.y + (start.y - end.y) * (1 - ease.bounce(Math.min(1, k * 1.15)));
          tmp.setFromAxisAngle(axis, (1 - e) * spins * Math.PI * 2);
          d.quaternion.copy(tmp).multiply(qEnd);
        },
      });
    });
  }

  // ---------- island size ----------
  // Stretch the beach, lagoon and foam to the island's shape, move the dice to its edge, and
  // widen the shadows and camera for the bigger islands.
  function fitIsland(g) {
    const rx = (g.extent.x + 0.4) / 4.72;
    const rz = (g.extent.z + 0.72) / 4.72;
    for (const m of [island, lagoon, foam]) m.scale.set(rx, 1, rz);
    DICE_HOME.forEach((v, i) => DICE_REST[i].set(v.x * rx, v.y, v.z * rz));
    dice.forEach((d, i) => d.position.copy(DICE_REST[i]));
    const next = Math.max(rx, rz);
    const cam = sun.shadow.camera;
    Object.assign(cam, { left: -6.4 * next, right: 6.4 * next, top: 6.4 * next, bottom: -6.4 * next, far: 30 * next });
    cam.updateProjectionMatrix();
    sun.position.copy(SUN_AT).multiplyScalar(Math.max(1, next));
    // the WebGPU shadow node resizes its map to mapSize on the next frame
    sun.shadow.mapSize.set(next > 1.1 ? 4096 : 3072, next > 1.1 ? 4096 : 3072);
    controls.maxDistance = 24 * next;
    fogNear.value = 22 * next;
    fogFar.value = 52 * next;
    if (next !== scale) {
      scale = next;
      anims = anims.filter((a) => !a.camera);
      intro = true;
      fitCamera(true);
    }
  }

  // ---------- harvest effects ----------
  function pulseNumber(sum, banditAt) {
    for (const tok of tokens) {
      if (tok.userData.num !== sum) continue;
      const blocked = tok.userData.hex === banditAt;
      const tile = tiles[tok.userData.hex];
      anims.push({
        t0: performance.now(),
        dur: 1300,
        step(k) {
          const s = Math.sin(Math.PI * Math.min(1, k * 2));
          tok.position.y = tok.userData.baseY + s * 0.22;
          tok.rotation.y = Math.PI / 2 + (blocked ? Math.sin(k * 30) * 0.15 * (1 - k) : 0);
          tile.material[0].emissive.set(blocked ? '#000000' : '#ffc94a');
          tile.material[0].emissiveIntensity = blocked ? 0 : Math.sin(Math.PI * k) * 0.35;
        },
        done() {
          tile.material[0].emissiveIntensity = 0;
        },
      });
    }
  }

  const iconCache = {};
  function floatGains(gains, view, delay = 0) {
    if (!gains) return;
    for (const [seat, res] of Object.entries(gains)) {
      // rise from that player's buildings next to producing tiles (or the board centre)
      const spots = [];
      view.verts.forEach((b, v) => b?.o === Number(seat) && spots.push(v));
      let i = 0;
      for (const [r, n] of Object.entries(res)) {
        for (let k = 0; k < n; k++) {
          const v = spots.find((x) => VERTS[x].hexes.some((h) => view.hexes[h].t && resOf(view.hexes[h].t) === r)) ?? spots[i % Math.max(1, spots.length)];
          const pos = v != null ? vertexPos(v) : new THREE.Vector3(0, TOP, 0);
          iconCache[r] ||= new THREE.SpriteMaterial({ map: iconTexture(RES_ICON[r], RES_COLORS[r][0]), depthWrite: false, transparent: true });
          const sp = new THREE.Sprite(iconCache[r].clone());
          sp.scale.set(0.34, 0.34, 1);
          sp.position.copy(pos).add(new THREE.Vector3((k - (n - 1) / 2) * 0.2, 0.35, 0));
          sp.visible = false;
          fx.add(sp);
          const y0 = sp.position.y;
          anims.push({
            t0: performance.now() + delay + i * 120,
            dur: 1500,
            step(t) {
              sp.visible = true;
              sp.position.y = y0 + ease.out(t) * 0.9;
              sp.material.opacity = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
              const s = 0.34 * (t < 0.15 ? t / 0.15 : 1);
              sp.scale.set(s, s, 1);
            },
            done() {
              fx.remove(sp);
            },
          });
          i++;
        }
      }
    }
  }
  const RES_OF = { forest: 'timber', clay: 'brick', pasture: 'wool', fields: 'grain', quarry: 'stone' };
  const resOf = (t) => RES_OF[t];

  // ---------- camera ----------
  let intro = true;
  function fitCamera(animate) {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    const aspect = w / h;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    renderer?.setSize(w, h, false);
    const dist = scale * (aspect >= 1.2 ? 14.2 : Math.min(28, 14.2 * (1.25 / Math.max(aspect, 0.45)) ** 0.9));
    const polar = aspect >= 1 ? 0.78 : 0.62;
    const pos = new THREE.Vector3().setFromSphericalCoords(dist, polar, 0).add(controls.target);
    if (animate) {
      const from = new THREE.Vector3().setFromSphericalCoords(dist * 1.5, 0.25, -0.9).add(controls.target);
      camera.position.copy(from);
      anims.push({
        camera: true,
        t0: performance.now() + 100,
        dur: 2200,
        step(k) {
          camera.position.lerpVectors(from, pos, ease.inOut(k));
        },
      });
    } else camera.position.copy(pos);
  }
  const ro = new ResizeObserver(() => {
    const w = container.clientWidth, h = container.clientHeight;
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
    renderer?.setSize(w, h, false);
  });
  ro.observe(container);
  fitCamera(true);

  // ---------- loop ----------
  let raf = 0;
  const timer = new THREE.Timer();
  function frame() {
    if (destroyed) return;
    raf = requestAnimationFrame(frame);
    if (document.hidden) return;
    const now = performance.now();
    const t = timer.update(now).getElapsed();
    normals.offset.set(t * 0.012, t * 0.007);
    foam.material.opacity = 0.35 + Math.sin(t * 1.3) * 0.15;
    for (const s of smoke) {
      const a = (t * 0.16 + s.ph) % 1;
      s.sp.position.set(s.x + a * 0.14, s.y + a * 0.55, s.z - a * 0.05);
      const sc = 0.045 + a * 0.17;
      s.sp.scale.set(sc, sc, 1);
      s.sp.material.opacity = Math.sin(Math.PI * Math.sqrt(a)) * 0.42 * (1 - a * 0.5);
    }
    for (const b of boats) {
      b.position.y = Math.sin(t * 1.4 + b.userData.phase) * 0.025;
      b.rotation.z = Math.sin(t * 1.1 + b.userData.phase) * 0.06;
    }
    for (const m of markers.children)
      if (m.userData.pulse != null) {
        const s = 1 + Math.sin(t * 4 + m.userData.pulse) * 0.18;
        m.scale.set(s, targets?.kind === 'hex' ? 1 : s, s);
      }
    if (ghost) ghost.position.y = (ghost.userData.kind === 'road' ? TOP + 0.035 : TOP) + 0.05 + Math.sin(t * 5) * 0.02;
    if (bandit && !anims.some((a) => a.bandit)) bandit.rotation.y += 0.003;
    anims = anims.filter((a) => {
      if (now < a.t0) return true;
      const k = Math.min(1, (now - a.t0) / a.dur);
      a.step(k);
      if (k >= 1) {
        a.done?.();
        return false;
      }
      return true;
    });
    if (intro && !anims.length) intro = false;
    controls.enabled = !intro;
    controls.update();
    renderer.render(scene, camera);
  }

  function applyQuality() {
    if (!renderer) return;
    // materials pick up the shadow switch by themselves (it is part of their cache key)
    renderer.shadowMap.enabled = highQuality;
    renderer.setPixelRatio(highQuality ? Math.min(window.devicePixelRatio || 1, 2) : 1);
    renderer.setSize(container.clientWidth, container.clientHeight, false);
  }

  // The renderer starts asynchronously. WebGPU when the browser offers an adapter, otherwise
  // WebGPURenderer's WebGL 2 backend, asked for up front (so three doesn't warn about falling
  // back). The API below works straight away; drawing starts once the renderer is ready.
  async function start() {
    const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' }).catch(() => null);
    if (destroyed) return;
    renderer = new THREE.WebGPURenderer({ canvas: el, antialias: true, powerPreference: 'high-performance', forceWebGL: !adapter });
    // Tone mapping (ACES, exposure 1.05) and the sRGB encode happen in each material (see below),
    // not in a full-screen pass afterwards, so the renderer draws (and antialiases) straight to the
    // canvas with no half-float buffer in between.
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.toneMappingExposure = EXPOSURE;
    // PCFShadowMap is the soft one (see sun.shadow.radius)
    renderer.shadowMap.type = THREE.PCFShadowMap;
    applyQuality();
    await renderer.init();
    if (destroyed) return;
    pmrem = new THREE.PMREMGenerator(renderer);
    // three r183 lowered the room by 3.5 (brighter, shifted highlights); keep the room where it was
    const room = new RoomEnvironment();
    room.position.y = 0;
    scene.environment = pmrem.fromScene(room, 0.04).texture;
    room.dispose();
    // Every material maps and encodes its own colour as it draws, exactly as the WebGL renderer did,
    // so toneMapped: false (the yellow markers) still works and see-through things blend the same
    // way. The fog goes on last, in screen colours, again as under WebGL. Installed after the
    // environment map is made: that has to stay linear HDR.
    renderer.contextNode = context({
      ...renderer.contextNode.getFlowContextData(),
      getOutput: (color, builder) => {
        if (builder.renderer.getRenderTarget() !== null) return color; // shadow maps
        const mat = builder.material;
        const out = renderOutput(color, mat?.toneMapped === false ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping, THREE.SRGBColorSpace);
        out.premultipliedAlpha = !!mat?.premultipliedAlpha;
        if (mat?.fog === false) return out;
        return vec4(mix(out.rgb, fogColor, rangeFogFactor(fogNear, fogFar)), out.a);
      },
    });
    timer.reset(); // count from the first frame, as THREE.Clock did
    frame();
  }
  const ready = start();

  return {
    ready,
    setBoard,
    sync,
    setTargets,
    rollDice,
    pulseNumber,
    floatGains,
    resetCamera: () => fitCamera(false),
    // place the camera by hand (used to render the home-page thumbnail)
    setCamera({ distance, polar, azimuth = 0, target = [0, 0, 0.9] }) {
      intro = false;
      anims = anims.filter((a) => !a.camera);
      controls.target.set(...target);
      camera.position.setFromSphericalCoords(distance, polar, azimuth).add(controls.target);
      controls.update();
    },
    setQuality(high) {
      highQuality = high;
      applyQuality();
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointermove', onMove);
      controls.dispose();
      timer.dispose();
      scene.environment?.dispose();
      sky.dispose();
      pmrem?.dispose();
      renderer?.dispose();
      el.remove();
    },
  };
}
