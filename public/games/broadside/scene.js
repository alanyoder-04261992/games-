// Broadside 3D sea (three.js). Everything is modelled in code: an animated ocean, two floating
// grids marked out with buoys, warships with turrets, funnels and masts, shells that arc in,
// water columns on a miss, explosions, fire and smoke on a hit, and ships that roll over and
// sink. The enemy grid sits to the north, your own fleet to the south.
import * as THREE from '../../vendor/three/three.module.min.js';
import { RoomEnvironment } from '../../vendor/three/RoomEnvironment.js';
import { RoundedBoxGeometry } from '../../vendor/three/RoundedBoxGeometry.js';
import { SHIPS, shipCells, COLS } from './engine.js';

export const FLEET_COLORS = ['#2f6fd6', '#c8372d'];

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
const MAT = {
  hull: std('#5f6c78', { roughness: 0.55, metalness: 0.35 }),
  hullDark: std('#3a434c', { roughness: 0.55, metalness: 0.35 }),
  boot: std('#8f2a22', { roughness: 0.7 }),
  deck: std('#8d949b', { roughness: 0.75 }),
  teak: std('#9b7650', { roughness: 0.8, metalness: 0 }),
  super: std('#b9c1c8', { roughness: 0.5, metalness: 0.3 }),
  dark: std('#2a3036', { roughness: 0.5, metalness: 0.5 }),
  gun: std('#4b545c', { roughness: 0.4, metalness: 0.6 }),
  glass: std('#1c2a36', { roughness: 0.1, metalness: 0.8 }),
  white: std('#eef2f4', { roughness: 0.5 }),
  red: std('#c0392b', { roughness: 0.6 }),
  sub: std('#2b3137', { roughness: 0.45, metalness: 0.4 }),
};

function hullGeometry(L, W, H, bow = 0.32) {
  const sh = new THREE.Shape();
  const x0 = -L / 2, x1 = L / 2;
  sh.moveTo(x0 + 0.04, -W / 2);
  sh.lineTo(x1 - L * bow, -W / 2);
  sh.quadraticCurveTo(x1 - L * 0.08, -W * 0.42, x1, 0);
  sh.quadraticCurveTo(x1 - L * 0.08, W * 0.42, x1 - L * bow, W / 2);
  sh.lineTo(x0 + 0.04, W / 2);
  sh.quadraticCurveTo(x0 - 0.02, W * 0.3, x0 - 0.02, 0);
  sh.quadraticCurveTo(x0 - 0.02, -W * 0.3, x0 + 0.04, -W / 2);
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
    add(hull, boot, deck);
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
      add(cyl(0.07, 0.08, 0.3, MAT.super, -0.28, deckY + 0.1, 0));
      add(cyl(0.072, 0.072, 0.04, MAT.dark, -0.28, deckY + 0.38, 0));
      add(cyl(0.06, 0.07, 0.26, MAT.super, -0.48, deckY + 0.1, 0));
      add(cyl(0.062, 0.062, 0.04, MAT.dark, -0.48, deckY + 0.34, 0));
      mast(0.1, 0.62);
      for (const s of [-1, 1]) for (const x of [-0.7, -0.1, 0.5]) add(cyl(0.03, 0.03, 0.04, MAT.gun, x, deckY, s * 0.27, 10));
    } else if (id === 'dreadnought') {
      t(L * 0.34, 1.1);
      t(L * 0.18, 1.1);
      t(-L * 0.34, 1.1, Math.PI);
      add(box(0.5, 0.12, 0.38, MAT.super, -0.06, deckY, 0));
      add(box(0.26, 0.11, 0.3, MAT.super, 0.04, deckY + 0.12, 0));
      add(box(0.265, 0.03, 0.305, MAT.glass, 0.04, deckY + 0.2, 0, 0.005));
      add(cyl(0.085, 0.095, 0.3, MAT.super, -0.24, deckY + 0.1, 0));
      add(cyl(0.087, 0.087, 0.04, MAT.dark, -0.24, deckY + 0.38, 0));
      mast(0.02, 0.55);
    } else if (id === 'frigate' || id === 'cutter') {
      t(L * 0.3, 0.9, 0, 1);
      add(box(0.6, 0.12, 0.36, id === 'cutter' ? MAT.white : MAT.super, -0.08, deckY, 0));
      add(box(0.28, 0.1, 0.3, id === 'cutter' ? MAT.white : MAT.super, 0.06, deckY + 0.12, 0));
      add(box(0.285, 0.03, 0.305, MAT.glass, 0.06, deckY + 0.18, 0, 0.005));
      add(cyl(0.06, 0.075, 0.2, MAT.super, -0.24, deckY + 0.12, 0));
      add(cyl(0.062, 0.062, 0.035, MAT.dark, -0.24, deckY + 0.31, 0));
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
  g.userData = { id, len };
  return g;
}

// ---------------------------------------------------------------------
// particles: fire, smoke, spray, flashes (sprites, recycled)
// ---------------------------------------------------------------------
class Particles {
  constructor(scene) {
    this.scene = scene;
    this.live = [];
    this.pool = [];
    this.tex = {
      fire: glowTexture('rgba(255,240,180,1)', 'rgba(255,120,20,0.7)'),
      flash: glowTexture('rgba(255,255,230,1)', 'rgba(255,170,60,0.8)'),
      smoke: puffTexture(),
      spray: glowTexture('rgba(255,255,255,0.95)', 'rgba(210,235,255,0.6)'),
    };
  }
  spawn(kind, pos, { vel = [0, 0, 0], life = 1, size = [0.3, 0.6], color = 0xffffff, opacity = 1, gravity = 0, spin = 0 } = {}) {
    if (this.live.length > 900) return;
    let sp = this.pool.pop();
    if (!sp) sp = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }));
    const additive = kind === 'fire' || kind === 'flash';
    sp.material.map = this.tex[kind];
    sp.material.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    sp.material.color.set(color);
    sp.material.rotation = Math.random() * 6;
    sp.material.needsUpdate = true;
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
        this.pool.push(p.sp);
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
export function createScene(container, { onCell, onHover } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.className = 'bs-gl';
  container.append(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = canvasTexture(8, 512, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#2d5f93');
    gr.addColorStop(0.5, '#86b3d8');
    gr.addColorStop(0.78, '#d8e4ea');
    gr.addColorStop(1, '#e9ece4');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  });
  scene.fog = new THREE.Fog('#cfdde6', 30, 80);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
  scene.add(new THREE.HemisphereLight('#d9ecff', '#1b3c55', 0.9));
  const sun = new THREE.DirectionalLight('#fff1d8', 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);
  const flashLight = new THREE.PointLight('#ffb050', 0, 10, 1.6);
  scene.add(flashLight);

  // ocean
  const normals = waterNormals();
  normals.repeat.set(18, 18);
  const water = new THREE.Mesh(
    new THREE.CircleGeometry(120, 64).rotateX(-Math.PI / 2),
    new THREE.MeshPhysicalMaterial({ color: '#1b5f86', roughness: 0.1, metalness: 0.05, normalMap: normals, normalScale: new THREE.Vector2(0.4, 0.4), clearcoat: 1, clearcoatRoughness: 0.1 }),
  );
  water.receiveShadow = true;
  scene.add(water);

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

  const cellPos = (b, i, y = 0) => new THREE.Vector3((i % N) - (N - 1) / 2, y, boardZ[b] + Math.floor(i / N) - (N - 1) / 2);

  // ---------- grids ----------
  const buoyGeo = new THREE.SphereGeometry(0.09, 12, 8);
  const buoyMats = [std('#e34b3a', { roughness: 0.4 }), std('#f4f4ee', { roughness: 0.4 })];
  function buildBoards(size) {
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
    sun.position.set(-12, 22, 10);
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
  const missMat = std('#f6f7f2', { roughness: 0.35 });
  const hitMat = std('#d8321f', { roughness: 0.35, emissive: '#5a0c00' });
  const pegGeo = new THREE.CylinderGeometry(0.07, 0.09, 0.22, 14).translate(0, 0.08, 0);
  const capGeo = new THREE.SphereGeometry(0.08, 14, 10).translate(0, 0.2, 0);
  const scorchGeo = new THREE.CircleGeometry(0.42, 24).rotateX(-Math.PI / 2);
  const scorchMat = new THREE.MeshBasicMaterial({ color: '#1a0f0a', transparent: true, opacity: 0.45, depthWrite: false });
  const ringGeo = new THREE.RingGeometry(0.2, 0.26, 32).rotateX(-Math.PI / 2);

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
      const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.35, depthWrite: false }));
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
  function setGhost(g) {
    ghost.clear();
    if (!g) return;
    const obj = buildShip(g.id, '#ffffff');
    obj.traverse((m) => m.isMesh && ((m.material = g.ok ? ghostOk : ghostBad), (m.castShadow = false)));
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
  const shellMat = new THREE.MeshBasicMaterial({ color: '#fff2b0', toneMapped: false });
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
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.3, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.8, depthWrite: false }));
    ring.position.copy(p).setY(0.02);
    world.add(ring);
    anims.push({
      t0: performance.now(),
      dur: 1400,
      step(k) {
        ring.scale.setScalar(1 + k * 4);
        ring.material.opacity = 0.8 * (1 - k);
      },
      done: () => world.remove(ring),
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
    shake = Math.max(shake, big ? 0.35 : 0.2);
  }

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
  function setFocus(b, animate = true) {
    focus = b;
    const to = camFor(b);
    if (!animate) {
      camState.pos.copy(to.pos);
      camState.look.copy(to.look);
      return;
    }
    const from = { pos: camState.pos.clone(), look: camState.look.clone() };
    anims = anims.filter((a) => !a.camera);
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
  let raf = 0;
  const clock = new THREE.Clock();
  let last = 0;
  function frame() {
    if (destroyed) return;
    raf = requestAnimationFrame(frame);
    if (document.hidden) return;
    const t = clock.getElapsedTime();
    const dt = Math.min(0.05, t - last);
    last = t;
    const now = performance.now();
    normals.offset.set(t * 0.01, t * 0.006);
    for (const B of boards) {
      for (const m of B.buoys) m.position.y = 0.03 + Math.sin(t * 1.6 + m.userData.phase) * 0.025;
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
    anims = anims.filter((a) => {
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
    particles.update(dt);
    camera.position.copy(camState.pos);
    if (shake > 0.002) {
      camera.position.add(new THREE.Vector3((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake));
      shake *= 0.9;
    }
    camera.lookAt(camState.look);
    renderer.render(scene, camera);
  }
  {
    const w = container.clientWidth, h = container.clientHeight;
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }
  buildBoards(10);
  frame();

  return {
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
      anims = anims.filter((a) => !a.camera);
      camState.pos.set(...pos);
      camState.look.set(...look);
    },
    boardZ: (b) => boardZ[b],
    setFocus,
    setAim(board, enabled) {
      aim = { board, enabled };
      if (!enabled) updateReticle(null);
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
      cancelAnimationFrame(raf);
      ro.disconnect();
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointermove', onMove);
      renderer.dispose();
      pmrem.dispose();
      el.remove();
    },
  };
}
