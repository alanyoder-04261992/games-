// Broadside 3D sea (three.js r187). Everything is modelled in code: a reflective ocean under a
// physically based sky with drifting clouds, two floating grids marked out with lit buoys,
// warships with painted plating, turrets, funnels, masts and navigation lights, shells that arc
// in, water columns on a miss, explosions with shockwaves, debris, fire and smoke on a hit, and
// ships that roll over and sink. Bloom makes fire and lights glow. The enemy grid sits to the
// north, your own fleet to the south. "Low" quality drops reflections and bloom.
// Renders with WebGPURenderer, which falls back to WebGL 2 by itself where WebGPU is missing.
import * as THREE from '../../vendor/three/three.webgpu.min.js';
import { pass, uniform, vec2, vec3, float, positionWorld, cameraPosition, normalize, reflect, max, dot, pow, length, mix, reflector } from '../../vendor/three/three.tsl.min.js';
import { RoundedBoxGeometry } from '../../vendor/three/addons/geometries/RoundedBoxGeometry.js';
import { WaterMesh } from '../../vendor/three/addons/objects/WaterMesh.js';
import { SkyMesh } from '../../vendor/three/addons/objects/SkyMesh.js';
import { bloom } from '../../vendor/three/addons/tsl/display/BloomNode.js';
import { SHIPS, shipCells, COLS } from './engine.js';

export const FLEET_COLORS = ['#2f6fd6', '#c8372d'];
const OVERLAY = 1; // render layer the water's reflection camera doesn't see

// The reflective sea. WaterMesh's own uniforms (normals, sun, colour, distortion) with a shader
// that keeps three things the old Water had: its own wave clock (so the swell can run slower than
// real time), the flatter wave normals (vec3(1.5, 1, 1.5)), and a mirror camera that sees only
// layer 0, so grid lines and labels aren't reflected.
class Sea extends WaterMesh {
  constructor(geometry, options, camera) {
    super(geometry, options);
    this.time = uniform(0);
    const t = this.time;
    const uv = positionWorld.xz.mul(this.size);
    const n = this.waterNormals.sample(uv.div(103).add(vec2(t.div(17), t.div(29))))
      .add(this.waterNormals.sample(uv.div(107).sub(vec2(t.div(-19), t.div(31)))))
      .add(this.waterNormals.sample(uv.div(vec2(8907, 9803)).add(vec2(t.div(101), t.div(97)))))
      .add(this.waterNormals.sample(uv.div(vec2(1091, 1027)).sub(vec2(t.div(109), t.div(-113)))))
      .mul(0.5)
      .sub(1);
    const surfaceNormal = normalize(n.xzy.mul(vec3(1.5, 1, 1.5)));
    const worldToEye = cameraPosition.sub(positionWorld);
    const eyeDirection = normalize(worldToEye);
    const sunReflect = normalize(reflect(this.sunDirection.negate(), surfaceNormal));
    const specularLight = pow(max(0, dot(eyeDirection, sunReflect)), 100).mul(this.sunColor).mul(2);
    const diffuseLight = max(dot(this.sunDirection, surfaceNormal), 0).mul(this.sunColor).mul(0.5);
    const distortion = surfaceNormal.xz.mul(float(0.001).add(float(1).div(length(worldToEye)))).mul(this.distortionScale);
    const mirror = reflector({ resolutionScale: this.resolutionScale });
    mirror.uvNode = mirror.uvNode.add(distortion);
    mirror.reflector.getVirtualCamera(camera).layers.set(0);
    this.add(mirror.target);
    this.mirror = mirror;
    const theta = max(dot(eyeDirection, surfaceNormal), 0);
    const reflectance = pow(float(1).sub(theta), 5).mul(0.98).add(0.02);
    const scatter = max(0, dot(surfaceNormal, eyeDirection)).mul(this.waterColor);
    this.material.colorNode = mix(this.sunColor.mul(diffuseLight).mul(0.3).add(scatter), mirror.rgb.add(specularLight), reflectance);
    this.material.transparent = false; // opaque like the old Water, so tinted patches and foam draw over it
  }
  dispose() {
    this.mirror.dispose();
    this.material.dispose();
    this.geometry.dispose();
  }
}

const ease = {
  out: (t) => 1 - (1 - t) ** 3,
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
};
const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.15, ...extra });

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
function waterNormals() {
  const S = 256;
  const r = seeded(21);
  const waves = Array.from({ length: 16 }, () => ({ fx: Math.floor(r() * 9) - 4 || 1, fy: Math.floor(r() * 9) - 4 || 2, ph: r() * 6.28, a: 0.4 + r() }));
  const n = (x, y) => waves.reduce((v, k) => v + k.a * Math.sin(((k.fx * x) / S + (k.fy * y) / S) * 6.283 + k.ph), 0);
  return canvasTexture(
    S,
    S,
    (g) => {
      const img = g.createImageData(S, S);
      for (let y = 0; y < S; y++)
        for (let x = 0; x < S; x++) {
          const dx = n(x + 1, y) - n(x - 1, y);
          const dy = n(x, y + 1) - n(x, y - 1);
          const len = Math.hypot(dx, dy, 2.2);
          const i = (y * S + x) * 4;
          img.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
          img.data[i + 1] = ((-dy / len) * 0.5 + 0.5) * 255;
          img.data[i + 2] = ((2.2 / len) * 0.5 + 0.5) * 255;
          img.data[i + 3] = 255;
        }
      g.putImageData(img, 0, 0);
    },
    { srgb: false, repeat: true },
  );
}
const glowTexture = (inner, outer) =>
  canvasTexture(128, 128, (g, w) => {
    const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    gr.addColorStop(0, inner);
    gr.addColorStop(0.4, outer);
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, w);
  });
const puffTexture = () =>
  canvasTexture(128, 128, (g, w) => {
    const r = seeded(9);
    for (let k = 0; k < 9; k++) {
      const x = w / 2 + (r() - 0.5) * 40, y = w / 2 + (r() - 0.5) * 40, rad = 22 + r() * 22;
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, 'rgba(255,255,255,0.55)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, w, w);
    }
  });
function labelTexture(text, color = '#ffffff') {
  return canvasTexture(128, 128, (g, w) => {
    g.font = '800 72px Inter, Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 10;
    g.strokeStyle = 'rgba(5,25,45,0.55)';
    g.strokeText(text, w / 2, w / 2 + 4);
    g.fillStyle = color;
    g.fillText(text, w / 2, w / 2 + 4);
  });
}

// ---------------------------------------------------------------------
// ships
// ---------------------------------------------------------------------
// painted steel plating: plate seams, weld lines, rust streaks and waterline grime
function hullTexture(base, seed) {
  const t = canvasTexture(
    512,
    256,
    (g, w, h) => {
      const r = seeded(seed);
      g.fillStyle = base;
      g.fillRect(0, 0, w, h);
      g.globalAlpha = 0.18;
      for (let i = 0; i < 160; i++) {
        g.fillStyle = r() < 0.5 ? '#000' : '#fff';
        g.fillRect(r() * w, r() * h, 20 + r() * 60, 6 + r() * 16);
      }
      g.globalAlpha = 0.35;
      g.strokeStyle = '#1d2329';
      g.lineWidth = 1.5;
      for (let x = 0; x < w; x += 46) {
        g.beginPath();
        g.moveTo(x + r() * 4, 0);
        g.lineTo(x + r() * 4, h);
        g.stroke();
      }
      for (let y = 30; y < h; y += 52) {
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(w, y);
        g.stroke();
      }
      // rust streaks running down from fittings
      for (let i = 0; i < 26; i++) {
        const x = r() * w, y = r() * h * 0.6, len = 20 + r() * 70;
        const gr = g.createLinearGradient(x, y, x, y + len);
        gr.addColorStop(0, 'rgba(120,60,25,0.55)');
        gr.addColorStop(1, 'rgba(120,60,25,0)');
        g.globalAlpha = 0.6;
        g.fillStyle = gr;
        g.fillRect(x, y, 2 + r() * 3, len);
      }
      g.globalAlpha = 1;
    },
    { repeat: true },
  );
  t.repeat.set(1.6, 2.5);
  return t;
}
function deckTexture(teak) {
  const t = canvasTexture(
    512,
    128,
    (g, w, h) => {
      const r = seeded(teak ? 3 : 8);
      g.fillStyle = teak ? '#a07b52' : '#878e95';
      g.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += teak ? 8 : 16) {
        g.globalAlpha = 0.18 + r() * 0.15;
        g.fillStyle = r() < 0.5 ? '#000' : '#fff';
        g.fillRect(0, y, w, teak ? 7 : 15);
        g.globalAlpha = 0.5;
        g.fillStyle = '#2a1d10';
        g.fillRect(0, y + (teak ? 7 : 15), w, 1);
        if (teak) for (let x = r() * 120; x < w; x += 90 + r() * 120) g.fillRect(x, y, 1, 7);
      }
      if (!teak) {
        g.globalAlpha = 0.25;
        for (let x = 0; x < w; x += 6) for (let y = 0; y < h; y += 6) g.fillRect(x, y, 1, 1);
      }
      g.globalAlpha = 1;
    },
    { repeat: true },
  );
  t.repeat.set(2, 6);
  return t;
}
function foamTexture() {
  return canvasTexture(256, 128, (g, w, h) => {
    const r = seeded(17);
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) {
      const a = r() * Math.PI * 2;
      const rr = 0.78 + r() * 0.2;
      const x = w / 2 + Math.cos(a) * (w / 2) * rr * 0.96;
      const y = h / 2 + Math.sin(a) * (h / 2) * rr * 0.92;
      const s = 3 + r() * 9;
      const gr = g.createRadialGradient(x, y, 0, x, y, s);
      gr.addColorStop(0, 'rgba(255,255,255,0.75)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(x - s, y - s, s * 2, s * 2);
    }
  });
}

const MAT = {
  hull: std('#ffffff', { map: hullTexture('#66737f', 1), roughness: 0.55, metalness: 0.35 }),
  hullDark: std('#3a434c', { roughness: 0.55, metalness: 0.35 }),
  boot: std('#8f2a22', { roughness: 0.7 }),
  deck: std('#ffffff', { map: deckTexture(false), roughness: 0.8 }),
  teak: std('#ffffff', { map: deckTexture(true), roughness: 0.85, metalness: 0 }),
  super: std('#b9c1c8', { roughness: 0.5, metalness: 0.3 }),
  dark: std('#2a3036', { roughness: 0.5, metalness: 0.5 }),
  gun: std('#4b545c', { roughness: 0.4, metalness: 0.6 }),
  glass: std('#1c2a36', { roughness: 0.1, metalness: 0.8 }),
  white: std('#ffffff', { map: hullTexture('#e9edf0', 2), roughness: 0.5 }),
  navRed: new THREE.MeshBasicMaterial({ color: new THREE.Color(10, 0.6, 0.4), toneMapped: false }),
  navGreen: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 10, 1.4), toneMapped: false }),
  navWhite: new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 8.5, 7), toneMapped: false }),
  foam: new THREE.MeshBasicMaterial({ map: foamTexture(), transparent: true, opacity: 0.8, depthWrite: false }),
  red: std('#c0392b', { roughness: 0.6 }),
  sub: std('#ffffff', { map: hullTexture('#2f363d', 3), roughness: 0.45, metalness: 0.4 }),
};
const navGeo = new THREE.SphereGeometry(0.016, 8, 6);

// Geometries, materials and textures used by many objects at once. disposeTree() frees
// everything else an object owns (a ship's hull and flag, a board's labels, a ghost's squares)
// and leaves these alone.
const SHARED = new WeakSet();
const share = (...xs) => xs.forEach((x) => SHARED.add(x));
share(navGeo, ...Object.values(MAT));
function disposeTree(root) {
  root.traverse((o) => {
    // sprites all share one built-in quad, so only their materials are theirs
    if (o.geometry && !o.isSprite && !SHARED.has(o.geometry)) o.geometry.dispose();
    for (const m of [o.material].flat()) {
      if (!m || SHARED.has(m)) continue;
      if (m.map && !SHARED.has(m.map)) m.map.dispose();
      m.dispose();
    }
  });
}

function hullShape(L, W, bow = 0.32, sh = new THREE.Shape()) {
  const x0 = -L / 2, x1 = L / 2;
  sh.moveTo(x0 + 0.04, -W / 2);
  sh.lineTo(x1 - L * bow, -W / 2);
  sh.quadraticCurveTo(x1 - L * 0.08, -W * 0.42, x1, 0);
  sh.quadraticCurveTo(x1 - L * 0.08, W * 0.42, x1 - L * bow, W / 2);
  sh.lineTo(x0 + 0.04, W / 2);
  sh.quadraticCurveTo(x0 - 0.02, W * 0.3, x0 - 0.02, 0);
  sh.quadraticCurveTo(x0 - 0.02, -W * 0.3, x0 + 0.04, -W / 2);
  return sh;
}
function hullGeometry(L, W, H, bow = 0.32) {
  const sh = hullShape(L, W, bow);
  const g = new THREE.ExtrudeGeometry(sh, { depth: H, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 2, curveSegments: 10 });
  g.rotateX(-Math.PI / 2); // extrude upward; shape's y becomes -z (symmetric)
  return g;
}

function turret(scale = 1, barrels = 2) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.075 * scale, 0.085 * scale, 0.045 * scale, 18), MAT.gun);
  base.position.y = 0.022 * scale;
  const house = new THREE.Mesh(new RoundedBoxGeometry(0.15 * scale, 0.06 * scale, 0.12 * scale, 2, 0.015 * scale), MAT.gun);
  house.position.set(0.01 * scale, 0.07 * scale, 0);
  g.add(base, house);
  for (let k = 0; k < barrels; k++) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.011 * scale, 0.013 * scale, 0.2 * scale, 8), MAT.dark);
    b.rotation.z = -Math.PI / 2 + 0.08;
    b.position.set(0.17 * scale, 0.075 * scale, (k - (barrels - 1) / 2) * 0.04 * scale);
    g.add(b);
  }
  return g;
}

function box(w, h, d, mat, x, y, z, r = 0.012) {
  const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 3, h / 3, d / 3)), mat);
  m.position.set(x, y + h / 2, z);
  return m;
}
function cyl(r1, r2, h, mat, x, y, z, seg = 14) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg), mat);
  m.position.set(x, y + h / 2, z);
  return m;
}

// A ship lying along +x (bow at +x), centred on the origin, waterline at y = 0.
export function buildShip(id, flagColor = '#ffffff') {
  const len = SHIPS[id].len;
  const L = len * 0.94;
  const g = new THREE.Group();
  const add = (...ms) => ms.forEach((m) => g.add(m));
  const deckY = 0.11;
  const funnels = [];
  const funnel = (x, r, h) => {
    add(cyl(r * 0.85, r, h, MAT.super, x, deckY + 0.1, 0));
    add(cyl(r * 0.87, r * 0.87, 0.04, MAT.dark, x, deckY + 0.1 + h - 0.02, 0));
    funnels.push(new THREE.Vector3(x, deckY + 0.14 + h, 0));
  };
  // foam lapping round the hull at the waterline
  const foam = new THREE.Mesh(new THREE.PlaneGeometry(L + 0.24, (id === 'patrol' ? 0.5 : 0.66) + 0.16).rotateX(-Math.PI / 2), MAT.foam);
  foam.position.y = 0.012;
  foam.renderOrder = 1;
  foam.userData.foam = true;
  add(foam);
  if (id === 'submarine') {
    const hull = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, L - 0.36, 8, 18), MAT.sub);
    hull.rotation.z = Math.PI / 2;
    hull.scale.set(1, 1, 0.85);
    hull.position.y = -0.04;
    const deck = box(L * 0.7, 0.03, 0.14, MAT.sub, 0, 0.1, 0);
    const tower = box(0.36, 0.2, 0.12, MAT.sub, -0.05, 0.12, 0, 0.04);
    const fin = box(0.24, 0.015, 0.36, MAT.sub, -0.02, 0.26, 0);
    const scope = cyl(0.008, 0.008, 0.18, MAT.dark, 0.03, 0.32, 0, 6);
    const scope2 = cyl(0.008, 0.008, 0.12, MAT.dark, -0.08, 0.32, 0, 6);
    const rudder = box(0.1, 0.18, 0.012, MAT.sub, -L / 2 + 0.05, -0.03, 0);
    add(hull, deck, tower, fin, scope, scope2, rudder);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.07), new THREE.MeshStandardMaterial({ color: flagColor, side: THREE.DoubleSide }));
    flag.position.set(-0.03 - 0.06, 0.47, 0);
    const pole = cyl(0.004, 0.004, 0.2, MAT.dark, -0.03, 0.32, 0, 5);
    add(flag, pole);
  } else {
    const W = id === 'patrol' ? 0.5 : id === 'flagship' ? 0.7 : 0.62;
    const hull = new THREE.Mesh(hullGeometry(L, W, 0.24), id === 'cutter' ? MAT.white : MAT.hull);
    hull.position.y = -0.13;
    const boot = new THREE.Mesh(hullGeometry(L * 1.006, W * 1.02, 0.05), MAT.boot);
    boot.position.y = -0.04;
    const deck = new THREE.Mesh(hullGeometry(L * 0.97, W * 0.93, 0.01), id === 'flagship' || id === 'dreadnought' ? MAT.teak : MAT.deck);
    deck.position.y = deckY;
    // a low bulwark round the deck edge
    const rim = hullShapeRing(L, W);
    rim.position.y = deckY - 0.005;
    add(hull, boot, deck, rim);
    // navigation lights: red to port, green to starboard
    const port = new THREE.Mesh(navGeo, MAT.navRed);
    port.position.set(L * 0.05, deckY + 0.06, -W / 2 + 0.02);
    const stbd = new THREE.Mesh(navGeo, MAT.navGreen);
    stbd.position.set(L * 0.05, deckY + 0.06, W / 2 - 0.02);
    add(port, stbd);
    if (id === 'cutter') {
      const stripe = box(0.05, 0.16, W + 0.012, MAT.red, L * 0.22, -0.05, 0, 0.004);
      stripe.rotation.y = 0;
      add(stripe);
    }
    const mast = (x, h = 0.5) => {
      add(cyl(0.012, 0.016, h, MAT.dark, x, deckY, 0, 8));
      add(box(0.02, 0.012, 0.18, MAT.dark, x, deckY + h * 0.72, 0));
      const radar = box(0.05, 0.035, 0.14, MAT.super, x, deckY + h - 0.02, 0, 0.01);
      add(radar);
      const light = new THREE.Mesh(navGeo, MAT.navWhite);
      light.position.set(x, deckY + h + 0.04, 0);
      add(light);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.085), new THREE.MeshStandardMaterial({ color: flagColor, side: THREE.DoubleSide, roughness: 0.8 }));
      flag.position.set(x - 0.08, deckY + h + 0.02, 0);
      add(flag);
      return radar;
    };
    const t = (x, s = 1, rot = 0, barrels = 2) => {
      const tu = turret(s, barrels);
      tu.position.set(x, deckY, 0);
      tu.rotation.y = rot;
      add(tu);
    };
    if (id === 'flagship') {
      t(L * 0.36, 1.25, 0, 3);
      t(L * 0.22, 1.25, 0, 3);
      t(-L * 0.36, 1.25, Math.PI, 3);
      add(box(0.62, 0.12, 0.42, MAT.super, -0.05, deckY, 0));
      add(box(0.36, 0.12, 0.34, MAT.super, 0.04, deckY + 0.12, 0));
      add(box(0.2, 0.1, 0.28, MAT.super, 0.08, deckY + 0.24, 0));
      add(box(0.205, 0.03, 0.285, MAT.glass, 0.08, deckY + 0.3, 0, 0.005));
      funnel(-0.28, 0.08, 0.3);
      funnel(-0.48, 0.07, 0.26);
      mast(0.1, 0.62);
      for (const s of [-1, 1]) for (const x of [-0.7, -0.1, 0.5]) add(cyl(0.03, 0.03, 0.04, MAT.gun, x, deckY, s * 0.27, 10));
    } else if (id === 'dreadnought') {
      t(L * 0.34, 1.1);
      t(L * 0.18, 1.1);
      t(-L * 0.34, 1.1, Math.PI);
      add(box(0.5, 0.12, 0.38, MAT.super, -0.06, deckY, 0));
      add(box(0.26, 0.11, 0.3, MAT.super, 0.04, deckY + 0.12, 0));
      add(box(0.265, 0.03, 0.305, MAT.glass, 0.04, deckY + 0.2, 0, 0.005));
      funnel(-0.24, 0.095, 0.3);
      mast(0.02, 0.55);
    } else if (id === 'frigate' || id === 'cutter') {
      t(L * 0.3, 0.9, 0, 1);
      add(box(0.6, 0.12, 0.36, id === 'cutter' ? MAT.white : MAT.super, -0.08, deckY, 0));
      add(box(0.28, 0.1, 0.3, id === 'cutter' ? MAT.white : MAT.super, 0.06, deckY + 0.12, 0));
      add(box(0.285, 0.03, 0.305, MAT.glass, 0.06, deckY + 0.18, 0, 0.005));
      funnel(-0.24, 0.075, 0.2);
      if (id === 'frigate') for (const s of [-1, 1]) add(box(0.18, 0.06, 0.08, MAT.gun, -L * 0.33, deckY, s * 0.12));
      else add(box(0.3, 0.02, 0.4, MAT.dark, -L * 0.33, deckY, 0)); // helipad
      mast(0.0, 0.5);
    } else if (id === 'patrol') {
      add(box(0.36, 0.13, 0.3, MAT.super, -0.08, deckY, 0));
      add(box(0.365, 0.035, 0.305, MAT.glass, -0.08, deckY + 0.09, 0, 0.005));
      t(L * 0.3, 0.7, 0, 1);
      mast(-0.08, 0.36);
      add(box(0.18, 0.05, 0.12, MAT.white, -L * 0.36, deckY, 0)); // dinghy
    }
  }
  g.traverse((m) => {
    if (m.isMesh) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
  });
  g.userData = { id, len, funnels };
  return g;
}

// a thin raised rim following the hull outline
function hullShapeRing(L, W) {
  const outer = hullShape(L * 0.985, W * 0.97);
  outer.holes.push(hullShape(L * 0.95, W * 0.86, 0.32, new THREE.Path()));
  const geo = new THREE.ExtrudeGeometry(outer, { depth: 0.04, bevelEnabled: false, curveSegments: 10 });
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, MAT.hull);
  m.castShadow = true;
  return m;
}

// ---------------------------------------------------------------------
// particles: fire, smoke, spray, flashes (sprites, recycled)
// ---------------------------------------------------------------------
class Particles {
  constructor(scene) {
    this.scene = scene;
    this.live = [];
    // one pool per kind, so a recycled sprite keeps its texture and blending (no material rebuild)
    this.pool = { fire: [], flash: [], smoke: [], spray: [] };
    this.tex = {
      fire: glowTexture('rgba(255,240,180,1)', 'rgba(255,120,20,0.7)'),
      flash: glowTexture('rgba(255,255,230,1)', 'rgba(255,170,60,0.8)'),
      smoke: puffTexture(),
      spray: glowTexture('rgba(255,255,255,0.95)', 'rgba(210,235,255,0.6)'),
    };
  }
  spawn(kind, pos, { vel = [0, 0, 0], life = 1, size = [0.3, 0.6], color = 0xffffff, opacity = 1, gravity = 0, spin = 0 } = {}) {
    if (this.live.length > 900) return;
    const additive = kind === 'fire' || kind === 'flash';
    let sp = this.pool[kind].pop();
    if (!sp) {
      sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex[kind], transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending }));
      sp.userData.kind = kind;
    }
    sp.material.color.set(color);
    if (additive) sp.material.color.multiplyScalar(6); // bright enough to glow
    sp.material.rotation = Math.random() * 6;
    sp.position.copy(pos);
    sp.renderOrder = additive ? 3 : 2;
    this.scene.add(sp);
    this.live.push({ sp, vel: new THREE.Vector3(...vel), life, age: 0, size, opacity, gravity, spin });
  }
  update(dt) {
    this.live = this.live.filter((p) => {
      p.age += dt;
      const k = p.age / p.life;
      if (k >= 1) {
        this.scene.remove(p.sp);
        this.pool[p.sp.userData.kind].push(p.sp);
        return false;
      }
      p.vel.y -= p.gravity * dt;
      p.sp.position.addScaledVector(p.vel, dt);
      const s = p.size[0] + (p.size[1] - p.size[0]) * k;
      p.sp.scale.set(s, s, 1);
      p.sp.material.opacity = p.opacity * (k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85);
      p.sp.material.rotation += p.spin * dt;
      return true;
    });
  }
}

// ---------------------------------------------------------------------
// the scene
// ---------------------------------------------------------------------
// Starts the renderer (asynchronous: WebGPU hands out its device through promises) and builds the
// sea. WebGPU where the browser has a usable adapter, WebGL 2 otherwise. Asking for an adapter
// first lets a browser without one go straight to the WebGL 2 backend instead of through the
// renderer's own fallback (same result, minus a console warning); the renderer still falls back
// by itself if WebGPU fails later in start-up. Rejects when neither is available.
export async function createScene(container, options = {}) {
  let forceWebGL = !navigator.gpu;
  if (!forceWebGL) {
    try {
      forceWebGL = !(await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }));
    } catch {
      forceWebGL = true;
    }
  }
  if (forceWebGL) {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) throw new Error('Neither WebGPU nor WebGL 2 is available');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
  const renderer = new THREE.WebGPURenderer({ antialias: true, powerPreference: 'high-performance', forceWebGL });
  try {
    await renderer.init();
  } catch (e) {
    renderer.dispose();
    throw e;
  }
  return buildScene(container, renderer, options);
}

function buildScene(container, renderer, { onCell, onHover, quality = 'high' } = {}) {
  let high = quality !== 'low';
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, high ? 2 : 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.domElement.className = 'bs-gl';
  container.append(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog('#c6d9e5', 50, 190);

  // the sun sits behind the viewer's left shoulder: ships lit from the front, deep blue sea ahead
  const sunDir = new THREE.Vector3(-0.55, 0.62, 0.56).normalize();
  // the sky's clouds drift with TSL's global `time` (seconds since the renderer started)
  const makeSky = () => {
    const sky = new SkyMesh();
    sky.scale.setScalar(900);
    sky.turbidity.value = 2;
    sky.rayleigh.value = 2.1;
    sky.mieCoefficient.value = 0.004;
    sky.mieDirectionalG.value = 0.86;
    sky.sunPosition.value.copy(sunDir);
    sky.cloudCoverage.value = 0.24;
    sky.cloudDensity.value = 0.45;
    sky.cloudScale.value = 0.00028;
    sky.cloudSpeed.value = 0.00004;
    return sky;
  };
  const sky = makeSky();
  scene.add(sky);
  // light the scene with the sky itself (a second sky, baked once into a PMREM environment map)
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const envSky = makeSky();
  envScene.add(envSky);
  const envTarget = pmrem.fromScene(envScene);
  envSky.geometry.dispose();
  envSky.material.dispose();
  scene.environment = envTarget.texture;
  scene.environmentIntensity = 0.5;

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 2000);
  camera.layers.enable(OVERLAY); // labels and grid lines: seen by the camera, kept out of reflections
  scene.add(new THREE.HemisphereLight('#d9ecff', '#1b3c55', 0.45));
  const sun = new THREE.DirectionalLight('#fff0d6', 3.1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(high ? 2048 : 1024, high ? 2048 : 1024);
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);
  const flashLight = new THREE.PointLight('#ffb050', 0, 10, 1.6);
  scene.add(flashLight);

  // ocean: real reflections on High, a cheaper shiny surface on Low
  // The reflective sea samples its normals at world scale (the texture's repeat must stay 1:
  // TSL texture nodes honour texture.repeat, the old GLSL Water ignored it). The Low surface
  // tiles its own copy 18 times.
  const normals = waterNormals();
  const lowNormals = normals.clone();
  lowNormals.repeat.set(18, 18);
  let water = null;
  function makeWater() {
    if (water) {
      scene.remove(water);
      if (water.isWaterMesh) water.dispose();
      else {
        water.material.dispose();
        water.geometry.dispose();
      }
    }
    const geo = new THREE.PlaneGeometry(600, 600);
    if (high) {
      water = new Sea(
        geo,
        {
          resolutionScale: 0.5,
          waterNormals: normals,
          sunDirection: sunDir.clone(),
          sunColor: 0xfff2dc,
          waterColor: 0x0d4f6e,
          distortionScale: 3.6,
          size: 2.2,
        },
        camera,
      );
    } else {
      water = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({ color: '#1b5f86', roughness: 0.1, metalness: 0.05, normalMap: lowNormals, normalScale: new THREE.Vector2(0.4, 0.4), clearcoat: 1, clearcoatRoughness: 0.1 }));
      water.receiveShadow = true;
    }
    water.rotation.x = -Math.PI / 2;
    scene.add(water);
  }
  makeWater();

  // bloom makes fire, flashes and lamps glow (High only): a 4x MSAA half-float scene pass plus
  // bloom, tone mapped and converted to sRGB once at the end (the pipeline's output transform).
  // The pipeline follows the renderer's size and pixel ratio by itself.
  let pipeline = null;
  let pipeNodes = [];
  function makePipeline() {
    pipeline?.dispose();
    pipeNodes.forEach((n) => n.dispose());
    pipeline = null;
    pipeNodes = [];
    if (!high) return;
    const scenePass = pass(scene, camera, { samples: 4 });
    const color = scenePass.getTextureNode('output');
    // only things brighter than sunlit white (fire, flashes, lamps) cross the glow threshold
    const glow = bloom(color, 0.75, 0.5, 4.5);
    pipeline = new THREE.RenderPipeline(renderer, color.add(glow));
    pipeNodes = [glow, scenePass];
  }

  // distant islands for depth
  {
    const r = seeded(4);
    const rock = std('#6f6a5e', { flatShading: true, roughness: 0.95, metalness: 0 });
    const green = std('#3f6b38', { flatShading: true, roughness: 0.95, metalness: 0 });
    for (const [x, z, s] of [[-38, -46, 5], [30, -52, 7], [52, -18, 4], [-55, 6, 4.5]]) {
      const isl = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1).scale(s, s * 0.45, s * 0.7), rock);
      isl.position.set(x, -s * 0.12, z);
      isl.rotation.y = r() * 6;
      const top = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1).scale(s * 0.75, s * 0.3, s * 0.5), green);
      top.position.set(x + 0.3, s * 0.18, z);
      scene.add(isl, top);
    }
  }

  const particles = new Particles(scene);
  const world = new THREE.Group();
  scene.add(world);

  let N = 10;
  let boardZ = [0, 0]; // board 0 = mine (south), board 1 = enemy (north), in screen terms
  let boards = [];
  let anims = [];
  let fires = []; // { pos, rate, acc, smoke }
  let shake = 0;
  let destroyed = false;
  let aim = { board: null, enabled: false };
  let hover = null;
  let pointer = null; // where the pointer rests on the sea, so the reticle can follow aim changes

  const cellPos = (b, i, y = 0) => new THREE.Vector3((i % N) - (N - 1) / 2, y, boardZ[b] + Math.floor(i / N) - (N - 1) / 2);

  // ---------- grids ----------
  const buoyGeo = new THREE.SphereGeometry(0.09, 12, 8);
  const buoyMats = [std('#e34b3a', { roughness: 0.7, metalness: 0 }), std('#e9e9e2', { roughness: 0.75, metalness: 0 })];
  const lampGeo = new THREE.SphereGeometry(0.022, 8, 6);
  const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(8, 4, 0.8), toneMapped: false });
  share(buoyGeo, ...buoyMats, lampGeo, lampMat);
  function buildBoards(size) {
    // the old boards' water patches, grid lines, labels, markers and ships go with them
    for (const B of boards) disposeTree(B.group);
    world.clear();
    N = size;
    const gap = 3;
    boardZ = [N / 2 + gap / 2, -(N / 2 + gap / 2)];
    boards = [0, 1].map((b) => {
      const g = new THREE.Group();
      const z = boardZ[b];
      // tinted water patch
      const patch = new THREE.Mesh(
        new THREE.PlaneGeometry(N, N).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: b === 0 ? '#0e3a5a' : '#2a1b2e', transparent: true, opacity: b === 0 ? 0.28 : 0.22, depthWrite: false }),
      );
      patch.position.set(0, 0.01, z);
      // grid lines
      const pts = [];
      for (let k = 0; k <= N; k++) {
        const o = k - N / 2;
        pts.push(-N / 2, 0, o + z, N / 2, 0, o + z, o, 0, -N / 2 + z, o, 0, N / 2 + z);
      }
      const lg = new THREE.BufferGeometry();
      lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      const lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: '#e8f4ff', transparent: true, opacity: 0.38, depthWrite: false }));
      lines.position.y = 0.03;
      // buoys around the edge
      const buoys = [];
      for (let k = 0; k <= N * 4; k++) {
        const side = Math.floor(k / N) % 4;
        const t = (k % N) - N / 2;
        const [x, zz] = [[t, -N / 2], [N / 2, t], [-t, N / 2], [-N / 2, -t]][side];
        const m = new THREE.Mesh(buoyGeo, buoyMats[k % 2]);
        m.position.set(x, 0.03, zz + z);
        m.castShadow = true;
        m.userData.phase = k * 0.7;
        if (k % 2 === 0) {
          // a little lamp on every other buoy, blinking out of step
          const lamp = new THREE.Mesh(lampGeo, lampMat);
          lamp.position.y = 0.1;
          m.add(lamp);
          m.userData.lamp = lamp;
        }
        buoys.push(m);
      }
      // coordinates
      const labels = new THREE.Group();
      for (let k = 0; k < N; k++) {
        const a = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(COLS[k]), depthWrite: false }));
        a.scale.set(0.55, 0.55, 1);
        a.position.set(k - (N - 1) / 2, 0.35, z - N / 2 - 0.55);
        const n = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(String(k + 1)), depthWrite: false }));
        n.scale.set(0.55, 0.55, 1);
        n.position.set(-N / 2 - 0.6, 0.35, z + k - (N - 1) / 2);
        labels.add(a, n);
      }
      const markers = new THREE.Group();
      const ships = new THREE.Group();
      for (const o of [patch, lines, labels]) o.traverse((m) => m.layers.set(OVERLAY));
      g.add(patch, lines, labels, markers, ships, ...buoys);
      world.add(g);
      return { group: g, markers, ships, buoys, shots: new Map(), shipObjs: new Map(), patch };
    });
    // aim reticle
    reticle.visible = false;
    world.add(reticle);
    world.add(ghost);
    const span = N + 6;
    Object.assign(sun.shadow.camera, { left: -span, right: span, top: span * 1.6, bottom: -span * 1.6, near: 1, far: 80 });
    sun.shadow.camera.updateProjectionMatrix();
    sun.position.copy(sunDir).multiplyScalar(32);
    sun.target.position.set(0, 0, 0);
    fires = [];
  }

  const reticle = new THREE.Group();
  {
    const m = new THREE.MeshBasicMaterial({ color: '#ffdd55', transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.36, 40).rotateX(-Math.PI / 2), m);
    const sq = new THREE.Mesh(new THREE.RingGeometry(0.47, 0.5, 4, 1).rotateX(-Math.PI / 2).rotateY(Math.PI / 4), m);
    reticle.add(ring, sq);
    for (const [x, z] of [[0.18, 0], [-0.18, 0], [0, 0.18], [0, -0.18]]) {
      const bar = new THREE.Mesh(new THREE.PlaneGeometry(Math.abs(x) ? 0.16 : 0.03, Math.abs(z) ? 0.16 : 0.03).rotateX(-Math.PI / 2), m);
      bar.position.set(x * 1.55, 0, z * 1.55);
      reticle.add(bar);
    }
    reticle.position.y = 0.05;
  }

  // ---------- markers ----------
  const missMat = std('#ecede6', { roughness: 0.75, metalness: 0 });
  const hitMat = std('#d8321f', { roughness: 0.35, emissive: '#ff2a10', emissiveIntensity: 7 });
  const pegGeo = new THREE.CylinderGeometry(0.07, 0.09, 0.22, 14).translate(0, 0.08, 0);
  const capGeo = new THREE.SphereGeometry(0.08, 14, 10).translate(0, 0.2, 0);
  const scorchGeo = new THREE.CircleGeometry(0.42, 24).rotateX(-Math.PI / 2);
  const scorchMat = new THREE.MeshBasicMaterial({ color: '#1a0f0a', transparent: true, opacity: 0.45, depthWrite: false });
  const ringGeo = new THREE.RingGeometry(0.2, 0.26, 32).rotateX(-Math.PI / 2);
  const missRingMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.35, depthWrite: false });
  share(missMat, hitMat, pegGeo, capGeo, scorchGeo, scorchMat, ringGeo, missRingMat);

  function addMarker(b, shot, onShip) {
    const B = boards[b];
    if (B.shots.has(shot.i)) return;
    const g = new THREE.Group();
    const p = cellPos(b, shot.i);
    g.position.copy(p);
    if (shot.hit) {
      if (!onShip) {
        const sc = new THREE.Mesh(scorchGeo, scorchMat);
        sc.position.y = 0.015;
        g.add(sc);
        const peg = new THREE.Mesh(pegGeo, hitMat);
        const cap = new THREE.Mesh(capGeo, hitMat);
        peg.castShadow = cap.castShadow = true;
        g.add(peg, cap);
      }
      fires.push({ pos: p.clone().add(new THREE.Vector3(0, onShip ? 0.22 : 0.3, 0)), acc: Math.random(), board: b, i: shot.i });
    } else {
      const peg = new THREE.Mesh(pegGeo, missMat);
      const cap = new THREE.Mesh(capGeo, missMat);
      peg.scale.setScalar(0.75);
      cap.scale.setScalar(0.75);
      peg.castShadow = cap.castShadow = true;
      const ring = new THREE.Mesh(ringGeo, missRingMat);
      ring.position.y = 0.02;
      g.add(peg, cap, ring);
      g.userData.bob = Math.random() * 6;
    }
    B.markers.add(g);
    B.shots.set(shot.i, g);
  }

  // ---------- ships ----------
  function placeShip(b, ship, color) {
    const obj = buildShip(ship.id, color);
    const cells = ship.cells || shipCells(N, ship.x, ship.y, ship.dir, SHIPS[ship.id].len);
    const c = cells.reduce((v, i) => v.add(cellPos(b, i)), new THREE.Vector3()).multiplyScalar(1 / cells.length);
    obj.position.copy(c);
    obj.rotation.y = ship.dir === 'v' ? -Math.PI / 2 : 0;
    obj.userData.base = c.clone();
    obj.userData.phase = Math.random() * 6;
    return obj;
  }

  function syncShips(b, ships, color, { animateSink = false } = {}) {
    const B = boards[b];
    const want = new Map((ships || []).map((sh) => [sh.id, sh]));
    for (const [id, obj] of B.shipObjs) {
      const sh = want.get(id);
      if (!sh || sh.x !== obj.userData.x || sh.y !== obj.userData.y || sh.dir !== obj.userData.dir) {
        B.ships.remove(obj);
        B.shipObjs.delete(id);
        disposeTree(obj); // moving a ship while placing (or Shuffle) builds a new one
      }
    }
    for (const [id, sh] of want) {
      let obj = B.shipObjs.get(id);
      if (!obj) {
        obj = placeShip(b, sh, color);
        Object.assign(obj.userData, { x: sh.x, y: sh.y, dir: sh.dir });
        B.ships.add(obj);
        B.shipObjs.set(id, obj);
        if (sh.sunk && !animateSink) setSunk(obj, 1);
      }
      if (sh.sunk && !obj.userData.sinking) {
        obj.userData.sinking = true;
        if (animateSink) sinkShip(obj);
        else setSunk(obj, 1);
      }
    }
  }
  function setSunk(obj, k) {
    obj.userData.sinkK = k;
    obj.position.y = obj.userData.base.y - 0.75 * k;
    obj.rotation.x = 0.5 * k * (obj.userData.dir === 'v' ? 0 : 1);
    obj.rotation.z = 0.5 * k * (obj.userData.dir === 'v' ? 1 : 0) - 0.18 * k;
  }
  function sinkShip(obj, delay = 600) {
    anims.push({
      t0: performance.now() + delay,
      dur: 3200,
      step: (k) => setSunk(obj, ease.inOut(k)),
      start() {
        // a burst of bubbles and steam as it goes under
        for (let n = 0; n < 24; n++)
          particles.spawn('smoke', obj.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * obj.userData.len, 0.1, (Math.random() - 0.5) * 0.6)), {
            vel: [0, 0.5 + Math.random() * 0.6, 0],
            life: 2 + Math.random(),
            size: [0.4, 1.4],
            color: 0xdfe6ea,
            opacity: 0.7,
          });
      },
    });
  }
  // fires on a sunk ship go out
  function quenchFires(b, cells) {
    fires = fires.filter((f) => !(f.board === b && cells.includes(f.i)));
  }

  // ---------- placement ghost ----------
  const ghost = new THREE.Group();
  const ghostOk = new THREE.MeshBasicMaterial({ color: '#7dffb0', transparent: true, opacity: 0.42, depthWrite: false });
  const ghostBad = new THREE.MeshBasicMaterial({ color: '#ff6b6b', transparent: true, opacity: 0.42, depthWrite: false });
  share(ghostOk, ghostBad);
  let ghostKey = null;
  function setGhost(g) {
    // the ghost is rebuilt as the pointer crosses squares; skip it when nothing would change
    const key = g ? `${N}:${g.id}:${g.x}:${g.y}:${g.dir}:${g.ok}` : null;
    if (key === ghostKey) return;
    ghostKey = key;
    disposeTree(ghost);
    ghost.clear();
    if (!g) return;
    const obj = buildShip(g.id, '#ffffff');
    obj.traverse((m) => {
      if (!m.isMesh) return;
      if (!SHARED.has(m.material)) m.material.dispose(); // its own flag material, never drawn
      m.material = g.ok ? ghostOk : ghostBad;
      m.castShadow = false;
    });
    const cells = [];
    for (let k = 0; k < SHIPS[g.id].len; k++) {
      const cx = g.dir === 'h' ? g.x + k : g.x;
      const cy = g.dir === 'v' ? g.y + k : g.y;
      cells.push([cx, cy]);
    }
    const cx = cells.reduce((a, [x]) => a + x, 0) / cells.length;
    const cy = cells.reduce((a, [, y]) => a + y, 0) / cells.length;
    obj.position.set(cx - (N - 1) / 2, 0.1, boardZ[0] + cy - (N - 1) / 2);
    obj.rotation.y = g.dir === 'v' ? -Math.PI / 2 : 0;
    ghost.add(obj);
    for (const [x, y] of cells) {
      if (x < 0 || y < 0 || x >= N || y >= N) continue;
      const sq = new THREE.Mesh(new THREE.PlaneGeometry(0.92, 0.92).rotateX(-Math.PI / 2), g.ok ? ghostOk : ghostBad);
      sq.position.set(x - (N - 1) / 2, 0.04, boardZ[0] + y - (N - 1) / 2);
      ghost.add(sq);
    }
  }

  // ---------- shots ----------
  const shellGeo = new THREE.SphereGeometry(0.07, 12, 8);
  const shellMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 7, 3), toneMapped: false });
  function fire({ board, i, hit, sunk, from }, done) {
    const target = cellPos(board, i, hit ? 0.2 : 0);
    // shells come in from the other side's fleet
    const src = new THREE.Vector3((Math.random() - 0.5) * N * 0.6, 0.6, boardZ[from ?? 1 - board] + (board === 0 ? -N * 0.3 : N * 0.3));
    const shell = new THREE.Mesh(shellGeo, shellMat);
    world.add(shell);
    const peak = 3 + src.distanceTo(target) * 0.18;
    // muzzle flash where it was fired from
    particles.spawn('flash', src, { life: 0.35, size: [0.6, 2.2], color: 0xffd28a });
    for (let k = 0; k < 6; k++) particles.spawn('smoke', src.clone(), { vel: [(Math.random() - 0.5) * 0.6, 0.4, (Math.random() - 0.5) * 0.6], life: 1.6, size: [0.4, 1.4], color: 0xcfd4d8, opacity: 0.6 });
    const dur = 950;
    anims.push({
      t0: performance.now(),
      dur,
      step(k) {
        const p = new THREE.Vector3().lerpVectors(src, target, k);
        p.y += Math.sin(Math.PI * k) * peak;
        shell.position.copy(p);
        if (Math.random() < 0.9) particles.spawn('smoke', p.clone(), { life: 0.5, size: [0.12, 0.35], color: 0xe8ecef, opacity: 0.5 });
      },
      done() {
        world.remove(shell);
        if (hit) explode(target, !!sunk);
        else splash(target);
        done?.();
      },
    });
  }
  function splash(p) {
    for (let k = 0; k < 40; k++) {
      const a = Math.random() * 6.28, r = Math.random() * 0.25;
      particles.spawn('spray', p.clone().add(new THREE.Vector3(Math.cos(a) * r, 0.05, Math.sin(a) * r)), {
        vel: [Math.cos(a) * 0.6, 3 + Math.random() * 2.5, Math.sin(a) * 0.6],
        gravity: 7,
        life: 0.9 + Math.random() * 0.5,
        size: [0.25, 0.5],
        opacity: 0.85,
      });
    }
    // its own material (each ring fades on its own), freed when it has spread out
    const ring = new THREE.Mesh(splashGeo, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.8, depthWrite: false }));
    ring.position.copy(p).setY(0.02);
    world.add(ring);
    anims.push({
      t0: performance.now(),
      dur: 1400,
      step(k) {
        ring.scale.setScalar(1 + k * 4);
        ring.material.opacity = 0.8 * (1 - k);
      },
      done() {
        world.remove(ring);
        ring.material.dispose();
      },
    });
    shake = Math.max(shake, 0.05);
  }
  function explode(p, big) {
    flashLight.position.copy(p).add(new THREE.Vector3(0, 0.6, 0));
    flashLight.intensity = big ? 60 : 30;
    particles.spawn('flash', p.clone().add(new THREE.Vector3(0, 0.2, 0)), { life: 0.45, size: [0.5, big ? 4 : 2.6], color: 0xffe0a0 });
    for (let k = 0; k < (big ? 60 : 32); k++) {
      const a = Math.random() * 6.28;
      const sp = 1 + Math.random() * 2.5;
      particles.spawn('fire', p.clone().add(new THREE.Vector3(0, 0.2, 0)), { vel: [Math.cos(a) * sp, 1 + Math.random() * 2.5, Math.sin(a) * sp], gravity: 3, life: 0.6 + Math.random() * 0.5, size: [0.4, 0.1], color: 0xffa040 });
    }
    for (let k = 0; k < (big ? 26 : 14); k++)
      particles.spawn('smoke', p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.3, (Math.random() - 0.5) * 0.4)), {
        vel: [(Math.random() - 0.5) * 0.8, 0.8 + Math.random() * 0.8, (Math.random() - 0.5) * 0.8],
        life: 1.8 + Math.random(),
        size: [0.5, 2],
        color: 0x3a3a3a,
        opacity: 0.8,
      });
    for (let k = 0; k < 16; k++) {
      const a = Math.random() * 6.28;
      particles.spawn('spray', p.clone(), { vel: [Math.cos(a) * 0.8, 2 + Math.random() * 2, Math.sin(a) * 0.8], gravity: 7, life: 0.9, size: [0.2, 0.4], opacity: 0.7 });
    }
    // glowing embers that arc out and fall
    for (let k = 0; k < (big ? 40 : 22); k++) {
      const a = Math.random() * 6.28;
      const sp = 1.5 + Math.random() * 3;
      particles.spawn('fire', p.clone().add(new THREE.Vector3(0, 0.25, 0)), { vel: [Math.cos(a) * sp, 2.5 + Math.random() * 3, Math.sin(a) * sp], gravity: 9, life: 0.9 + Math.random() * 0.8, size: [0.09, 0.04], color: 0xffc070 });
    }
    // a shockwave racing out across the water
    const ring = new THREE.Mesh(shockGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 3.6, 1.6), transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }));
    ring.position.copy(p).setY(0.03);
    world.add(ring);
    anims.push({
      t0: performance.now(),
      dur: 650,
      step(k) {
        ring.scale.setScalar(0.3 + ease.out(k) * (big ? 5 : 3.2));
        ring.material.opacity = 0.9 * (1 - k);
      },
      done() {
        world.remove(ring);
        ring.material.dispose();
      },
    });
    // debris: chunks of plating spinning off and splashing down
    for (let k = 0; k < (big ? 14 : 8); k++) {
      const chunk = new THREE.Mesh(debrisGeo, k % 3 ? MAT.hullDark : MAT.dark);
      chunk.scale.setScalar(0.5 + Math.random());
      chunk.position.copy(p).add(new THREE.Vector3(0, 0.25, 0));
      chunk.castShadow = true;
      world.add(chunk);
      const a = Math.random() * 6.28;
      const v = new THREE.Vector3(Math.cos(a) * (1 + Math.random() * 2), 3 + Math.random() * 3, Math.sin(a) * (1 + Math.random() * 2));
      const spin = new THREE.Vector3(Math.random() * 12, Math.random() * 12, Math.random() * 12);
      let prev = 0;
      anims.push({
        t0: performance.now(),
        dur: 1600,
        step(k2) {
          const dt = (k2 - prev) * 1.6;
          prev = k2;
          v.y -= 9.8 * dt;
          chunk.position.addScaledVector(v, dt);
          chunk.rotation.x += spin.x * dt;
          chunk.rotation.y += spin.y * dt;
          chunk.rotation.z += spin.z * dt;
          if (chunk.position.y < 0) {
            if (chunk.visible) particles.spawn('spray', chunk.position.clone().setY(0.05), { vel: [0, 1.2, 0], gravity: 6, life: 0.5, size: [0.15, 0.3], opacity: 0.7 });
            chunk.visible = false;
          }
        },
        done: () => world.remove(chunk),
      });
    }
    shake = Math.max(shake, big ? 0.35 : 0.2);
  }
  const shockGeo = new THREE.RingGeometry(0.35, 0.5, 48).rotateX(-Math.PI / 2);
  const debrisGeo = new THREE.BoxGeometry(0.06, 0.02, 0.05);
  const splashGeo = new THREE.RingGeometry(0.2, 0.3, 40).rotateX(-Math.PI / 2);
  share(shellGeo, shellMat, shockGeo, debrisGeo, splashGeo);

  // ---------- picking ----------
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  function cellAt(ev) {
    const rect = renderer.domElement.getBoundingClientRect();
    ndc.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = new THREE.Vector3();
    if (!ray.ray.intersectPlane(plane, hit)) return null;
    for (const b of [0, 1]) {
      const x = Math.floor(hit.x + N / 2);
      const y = Math.floor(hit.z - boardZ[b] + N / 2);
      if (x >= 0 && y >= 0 && x < N && y < N) return { board: b, x, y, i: y * N + x };
    }
    return null;
  }
  const el = renderer.domElement;
  let down = null;
  const onDown = (ev) => (down = { x: ev.clientX, y: ev.clientY, t: performance.now() });
  const onUp = (ev) => {
    if (!down) return;
    const moved = Math.hypot(ev.clientX - down.x, ev.clientY - down.y);
    down = null;
    if (moved > 10) return;
    const c = cellAt(ev);
    if (c) onCell?.(c.board, c.i, c.x, c.y);
  };
  const onMove = (ev) => {
    pointer = { clientX: ev.clientX, clientY: ev.clientY };
    const c = cellAt(ev);
    const key = c ? `${c.board}:${c.i}` : null;
    if (key === hover) return;
    hover = key;
    updateReticle(c);
    onHover?.(c?.board ?? null, c?.i ?? null, c?.x, c?.y);
  };
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerleave', () => {
    hover = null;
    pointer = null;
    updateReticle(null);
    onHover?.(null, null);
  });
  function updateReticle(c) {
    const show = c && aim.enabled && c.board === aim.board && !boards[c.board]?.shots.has(c.i);
    reticle.visible = !!show;
    el.style.cursor = show ? 'crosshair' : '';
    if (show) reticle.position.copy(cellPos(c.board, c.i, 0.05));
  }

  // ---------- camera ----------
  let focus = 1;
  const camState = { pos: new THREE.Vector3(0, 30, 30), look: new THREE.Vector3() };
  function camFor(b) {
    const w = container.clientWidth || 1, h = container.clientHeight || 1;
    const aspect = w / h;
    const fit = aspect >= 1.15 ? 1 : Math.min(2.2, (1.15 / aspect) ** 0.95);
    const dist = (N * 1.12 + 3.5) * fit;
    const look = new THREE.Vector3(0, 0, boardZ[b] + 0.6);
    const pos = look.clone().add(new THREE.Vector3(0, dist * 0.82, dist * 0.62));
    return { pos, look };
  }
  // stop any camera move in flight (it would otherwise keep flying to the board it set out for)
  function stopCamera() {
    for (const a of anims) if (a.camera) a.cancelled = true;
    anims = anims.filter((a) => !a.camera);
  }
  function setFocus(b, animate = true) {
    focus = b;
    const to = camFor(b);
    stopCamera();
    if (!animate) {
      camState.pos.copy(to.pos);
      camState.look.copy(to.look);
      return;
    }
    const from = { pos: camState.pos.clone(), look: camState.look.clone() };
    anims.push({
      camera: true,
      t0: performance.now(),
      dur: 1100,
      step(k) {
        const e = ease.inOut(k);
        camState.pos.lerpVectors(from.pos, to.pos, e);
        camState.pos.y += Math.sin(Math.PI * e) * 2.5;
        camState.look.lerpVectors(from.look, to.look, e);
      },
    });
  }
  const ro = new ResizeObserver(() => {
    const w = container.clientWidth, h = container.clientHeight;
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    if (!anims.some((a) => a.camera)) setFocus(focus, false);
  });
  ro.observe(container);

  // ---------- loop ----------
  const timer = new THREE.Timer();
  const smokeAt = new THREE.Vector3();
  function frame(ts) {
    if (destroyed || document.hidden) return;
    timer.update(ts);
    const t = timer.getElapsed();
    const dt = Math.min(0.05, timer.getDelta());
    const now = performance.now();
    if (high) water.time.value += dt * 0.55;
    else lowNormals.offset.set(t * 0.01, t * 0.006);
    MAT.foam.opacity = 0.45 + Math.sin(t * 1.7) * 0.15;
    for (const B of boards) {
      for (const m of B.buoys) {
        m.position.y = 0.03 + Math.sin(t * 1.6 + m.userData.phase) * 0.025;
        if (m.userData.lamp) m.userData.lamp.visible = Math.sin(t * 2.2 + m.userData.phase * 3) > 0.8;
      }
      // a little smoke from the funnels of ships still afloat
      for (const s of B.ships.children) {
        if (s.userData.sinking || !s.userData.funnels?.length) continue;
        s.userData.smoke = (s.userData.smoke || Math.random()) + dt * 2.2;
        while (s.userData.smoke > 1) {
          s.userData.smoke -= 1;
          for (const f of s.userData.funnels) {
            s.localToWorld(smokeAt.copy(f));
            particles.spawn('smoke', smokeAt, { vel: [0.25, 0.35 + Math.random() * 0.2, -0.08], life: 2.6, size: [0.12, 0.7], color: 0x9a9fa4, opacity: 0.4 });
          }
        }
      }
      for (const g of B.markers.children) if (g.userData.bob != null) g.position.y = Math.sin(t * 1.8 + g.userData.bob) * 0.02;
      for (const s of B.ships.children)
        if (!s.userData.sinking) {
          s.position.y = s.userData.base.y + Math.sin(t * 1.1 + s.userData.phase) * 0.02;
          const roll = Math.sin(t * 0.9 + s.userData.phase) * 0.025;
          if (s.userData.dir === 'v') s.rotation.z = roll;
          else s.rotation.x = roll;
        }
    }
    // burning hits
    for (const f of fires) {
      f.acc += dt * 14;
      while (f.acc > 1) {
        f.acc -= 1;
        particles.spawn('fire', f.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.15, 0, (Math.random() - 0.5) * 0.15)), { vel: [0, 0.6 + Math.random() * 0.5, 0], life: 0.45 + Math.random() * 0.3, size: [0.32, 0.08], color: 0xff8a30 });
        if (Math.random() < 0.35)
          particles.spawn('smoke', f.pos.clone().add(new THREE.Vector3(0, 0.25, 0)), { vel: [0.15, 0.7 + Math.random() * 0.4, -0.05], life: 2.2, size: [0.25, 1.1], color: 0x2c2c2c, opacity: 0.55 });
      }
    }
    if (ghost.children.length) ghost.children[0].position.y = 0.1 + Math.sin(t * 4) * 0.03;
    reticle.rotation.y = t * 0.8;
    const rs = 1 + Math.sin(t * 6) * 0.06;
    reticle.scale.set(rs, 1, rs);
    flashLight.intensity *= 0.86;
    // Step a snapshot of the running animations. A done() may start new ones (a shell landing
    // starts its explosion or splash, which push their shockwave, ring and debris animations):
    // those go into a fresh list and are merged back, rather than being pushed onto the array
    // being filtered and then dropped when the filter's result replaces it.
    const running = anims;
    anims = [];
    const still = running.filter((a) => {
      if (a.cancelled) return false;
      if (now < a.t0) return true;
      if (!a.started) {
        a.started = true;
        a.start?.();
      }
      const k = Math.min(1, (now - a.t0) / a.dur);
      a.step(k);
      if (k >= 1) {
        a.done?.();
        return false;
      }
      return true;
    });
    anims = still.concat(anims);
    particles.update(dt);
    camera.position.copy(camState.pos);
    if (shake > 0.002) {
      camera.position.add(new THREE.Vector3((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake));
      shake *= 0.9;
    }
    // a slow, gentle sway so the sea never looks frozen
    camera.position.x += Math.sin(t * 0.21) * 0.12;
    camera.position.y += Math.sin(t * 0.33) * 0.06;
    camera.lookAt(camState.look);
    if (pipeline) pipeline.render();
    else renderer.render(scene, camera);
  }
  {
    const w = container.clientWidth, h = container.clientHeight;
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }
  makePipeline();
  buildBoards(10);
  renderer.setAnimationLoop(frame);

  return {
    get quality() {
      return high ? 'high' : 'low';
    },
    // High: reflections, bloom, sharper shadows. Low: cheaper water, no bloom.
    setQuality(q) {
      const next = q !== 'low';
      if (next === high) return;
      high = next;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, high ? 2 : 1.5));
      renderer.setSize(container.clientWidth, container.clientHeight, false);
      sun.shadow.mapSize.set(high ? 2048 : 1024, high ? 2048 : 1024); // the shadow map resizes itself
      makeWater();
      makePipeline();
    },
    setSize(size) {
      if (size === N && boards.length) return;
      buildBoards(size);
      setFocus(focus, false);
      const intro = camState.pos.clone();
      camState.pos.add(new THREE.Vector3(-6, 10, 8));
      const from = camState.pos.clone();
      anims.push({ camera: true, t0: performance.now() + 100, dur: 1800, step: (k) => camState.pos.lerpVectors(from, intro, ease.inOut(k)) });
    },
    get size() {
      return N;
    },
    focus: () => focus,
    // place the camera by hand (used to render the home-page thumbnail)
    setCamera(pos, look) {
      stopCamera();
      camState.pos.set(...pos);
      camState.look.set(...look);
    },
    boardZ: (b) => boardZ[b],
    setFocus,
    setAim(board, enabled) {
      aim = { board, enabled };
      // show (or hide) the reticle under a pointer already resting on the sea (the camera may
      // have moved since it last moved, so look again at which square it is over)
      updateReticle(pointer && cellAt(pointer));
    },
    syncShips,
    addMarker,
    quenchFires,
    sinkLater: (b, id, delay) => {
      const obj = boards[b].shipObjs.get(id);
      if (obj && !obj.userData.sinking) {
        obj.userData.sinking = true;
        sinkShip(obj, delay);
      }
    },
    hasMarker: (b, i) => boards[b]?.shots.has(i),
    clearBoard(b) {
      const B = boards[b];
      disposeTree(B.markers);
      disposeTree(B.ships);
      B.markers.clear();
      B.shots.clear();
      B.ships.clear();
      B.shipObjs.clear();
      fires = fires.filter((f) => f.board !== b);
    },
    fire,
    setGhost,
    destroy() {
      destroyed = true;
      renderer.setAnimationLoop(null);
      ro.disconnect();
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointermove', onMove);
      pipeline?.dispose();
      pipeNodes.forEach((n) => n.dispose());
      if (water?.isWaterMesh) water.dispose();
      else water?.material.dispose();
      envTarget.dispose();
      pmrem.dispose();
      renderer.dispose();
      el.remove();
    },
  };
}
