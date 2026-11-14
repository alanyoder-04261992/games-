// Rook — the 3D card table (three.js r187, WebGPURenderer; WebGL 2 is used automatically where a
// device has no WebGPU). A green felt table with a varnished wood rail under a warm lamp: real
// cards with thin rounded edges and the deck's own art (cards.js) painted onto them, opponents
// holding their fans, the nest, tricks sliding to the winner's pile, and wooden bid, trump and
// dealer tokens. Custom shading is TSL; the glow around highlighted cards comes from the
// emissive channel, blurred in a RenderPipeline.
//
// The scene is driven by ui.js with plain descriptions of the table ("these cards in my hand,
// six cards in the west hand, this trick…"); sync() moves every card to where the description
// says it belongs, so animations fall out of changes in the description.
import * as THREE from '../../vendor/three/three.webgpu.min.js';
import { Fn, uniform, uv, vec2, vec3, float, mix, smoothstep, sin, time, length, max, min, abs, positionWorld, texture, mx_noise_float, mx_fractal_noise_float, color, pass, mrt, output, emissive, exp, screenSize } from '../../vendor/three/three.tsl.min.js';
import { DEFS, cardFace, cardBack, emblem, PALETTE } from './cards.js';

// card size in world units (the art is 250 × 350)
const CW = 1;
const CH = 1.4;
const CT = 0.014;
const CR = 0.078;
const STACK = 0.0158; // height step between cards lying in a pile
const RAIL = 1.05; // width of the wood rail
const POSITIONS = ['bottom', 'left', 'top', 'right'];
const DEG = Math.PI / 180;
const easeOut = (k) => 1 - (1 - k) ** 3;
const easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hash = (s) => {
  let x = 7;
  for (const ch of String(s)) x = (x * 31 + ch.charCodeAt(0)) % 9973;
  return x;
};

// ---------------------------------------------------------------------------------------------
// card art → canvas textures
// ---------------------------------------------------------------------------------------------
const DEFS_INNER = DEFS.match(/<defs>([\s\S]*)<\/defs>/)[1];
let measureHost = null;
let fontsReady = null;
function waitFonts() {
  if (!fontsReady) {
    const fonts = document.fonts;
    fontsReady = fonts
      ? Promise.race([Promise.all(['900 64px "Roboto Slab"', '800 17px "Roboto Slab"'].map((f) => fonts.load(f).catch(() => null))), new Promise((r) => setTimeout(r, 2500))])
      : Promise.resolve();
  }
  return fontsReady;
}

// Paint one card's SVG (from cards.js) into a canvas. The shapes and gradients are drawn from
// the SVG itself; the lettering is drawn with the page's Roboto Slab (an SVG drawn as an image
// cannot use the page's web fonts), at exactly the place the SVG puts it.
async function paintSvg(svg, canvas) {
  await waitFonts();
  if (!measureHost) {
    measureHost = document.createElement('div');
    Object.assign(measureHost.style, { position: 'fixed', left: '-2000px', top: '0', width: '250px', height: '350px', visibility: 'hidden', pointerEvents: 'none', contain: 'strict' });
    document.body.append(measureHost);
  }
  measureHost.innerHTML = svg;
  const root = measureHost.firstElementChild;
  root.setAttribute('width', '250');
  root.setAttribute('height', '350');
  const texts = [...root.querySelectorAll('text')].map((t) => {
    const m = t.getCTM();
    return {
      m: m ? [m.a, m.b, m.c, m.d, m.e, m.f] : [1, 0, 0, 1, 0, 0],
      x: Number(t.getAttribute('x') || 0),
      y: Number(t.getAttribute('y') || 0),
      str: t.textContent,
      size: Number(t.getAttribute('font-size') || 16),
      weight: t.getAttribute('font-weight') || '400',
      ls: Number(t.getAttribute('letter-spacing') || 0),
      fill: t.getAttribute('fill') || '#000',
      anchor: t.getAttribute('text-anchor') || 'start',
    };
  });
  measureHost.innerHTML = '';
  const shapes = svg
    .replace(/<text[\s\S]*?<\/text>/g, '')
    .replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" width="250" height="350" ')
    .replace(/(<svg[^>]*>)/, `$1<defs>${DEFS_INNER}</defs>`);
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(shapes);
  await img.decode();
  const g = canvas.getContext('2d');
  const k = canvas.width / 250;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = '#f3f2ed';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.drawImage(img, 0, 0, canvas.width, canvas.height);
  for (const t of texts) {
    const [a, b, c, d, e, f] = t.m;
    g.setTransform(k * a, k * b, k * c, k * d, k * e, k * f);
    g.font = `${t.weight} ${t.size}px "Roboto Slab", Rockwell, "Courier New", Georgia, serif`;
    if ('letterSpacing' in g) g.letterSpacing = `${t.ls}px`;
    g.textAlign = t.anchor === 'middle' ? 'center' : t.anchor === 'end' ? 'right' : 'left';
    g.textBaseline = 'alphabetic';
    g.fillStyle = t.fill;
    g.fillText(t.str, t.x - (t.anchor === 'middle' ? t.ls / 2 : 0), t.y);
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
}

// Canvases stay in CPU memory (willReadFrequently): uploading them into a WebGPU texture is then
// a plain copy, instead of a slow readback of a GPU-backed canvas on some devices.
function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (draw) draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// ---------------------------------------------------------------------------------------------
// geometry
// ---------------------------------------------------------------------------------------------
function roundRectPoints(hw, hh, r, seg) {
  const pts = [];
  const corners = [
    [hw - r, hh - r, 0],
    [-hw + r, hh - r, Math.PI / 2],
    [-hw + r, -hh + r, Math.PI],
    [hw - r, -hh + r, Math.PI * 1.5],
  ];
  for (const [cx, cy, a0] of corners) {
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (i / seg) * (Math.PI / 2);
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r, Math.cos(a), Math.sin(a)]);
    }
  }
  return pts;
}

// A thin card with rounded corners: group 0 is the face (+z), 1 the back (−z), 2 the edge.
function cardGeometry() {
  const pts = roundRectPoints(CW / 2, CH / 2, CR, 6);
  const n = pts.length;
  const pos = [];
  const nor = [];
  const uvs = [];
  const idx = [];
  const z = CT / 2;
  const add = (x, y, zz, nx, ny, nz, u, v) => {
    pos.push(x, y, zz);
    nor.push(nx, ny, nz);
    uvs.push(u, v);
    return pos.length / 3 - 1;
  };
  const fc = add(0, 0, z, 0, 0, 1, 0.5, 0.5);
  const f0 = pos.length / 3;
  for (const [x, y] of pts) add(x, y, z, 0, 0, 1, x / CW + 0.5, y / CH + 0.5);
  for (let i = 0; i < n; i++) idx.push(fc, f0 + i, f0 + ((i + 1) % n));
  const front = idx.length;
  const bc = add(0, 0, -z, 0, 0, -1, 0.5, 0.5);
  const b0 = pos.length / 3;
  for (const [x, y] of pts) add(x, y, -z, 0, 0, -1, 0.5 - x / CW, y / CH + 0.5); // mirrored: reads right from behind
  for (let i = 0; i < n; i++) idx.push(bc, b0 + ((i + 1) % n), b0 + i);
  const back = idx.length - front;
  const e0 = pos.length / 3;
  for (let i = 0; i <= n; i++) {
    const [x, y, nx, ny] = pts[i % n];
    add(x, y, z, nx, ny, 0, i / n, 1);
    add(x, y, -z, nx, ny, 0, i / n, 0);
  }
  for (let i = 0; i < n; i++) {
    const a = e0 + i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.addGroup(0, front, 0);
  g.addGroup(front, back, 1);
  g.addGroup(front + back, idx.length - front - back, 2);
  g.computeBoundingSphere();
  return g;
}

function roundRectShape(hw, hh, r, reverse = false) {
  const pts = roundRectPoints(hw, hh, r, 14).map(([x, y]) => new THREE.Vector2(x, y));
  if (reverse) pts.reverse();
  return pts;
}

// ---------------------------------------------------------------------------------------------
// materials (TSL)
// ---------------------------------------------------------------------------------------------
// signed distance to a rounded rectangle (negative inside)
const sdRoundRect = (p, half, r) => {
  const q = abs(p).sub(half.sub(r));
  return length(max(q, 0)).add(min(max(q.x, q.y), 0)).sub(r);
};

function feltMaterial(dims, logoTex) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.93, metalness: 0 });
  const p = positionWorld.xz;
  const mottle = mx_fractal_noise_float(vec3(p.mul(0.9), 0.3), 3, 2.0, 0.5).mul(0.5).add(0.5);
  const fibre = mx_noise_float(vec3(p.x.mul(70), p.y.mul(9), 1.7)).mul(0.5).add(0.5);
  const speck = mx_noise_float(vec3(p.mul(140), 4.1)).mul(0.5).add(0.5);
  const base = mix(color('#1b6a43'), color('#247a4d'), mottle);
  const d = sdRoundRect(p, vec2(dims.a, dims.b), dims.r); // ≤ 0 on the felt
  const edge = smoothstep(-1.6, 0, d).mul(0.38); // darker where the felt meets the rail
  const line = smoothstep(0.03, 0.0, abs(d.add(0.62)).sub(0.012)).mul(0.16); // a printed racetrack line
  const logo = texture(logoTex, vec2(p.x.div(dims.logo).add(0.5), p.y.div(dims.logo).negate().add(0.5))).a;
  const c = base
    .mul(fibre.mul(0.12).add(0.94))
    .mul(speck.mul(0.08).add(0.96))
    .mul(float(1).sub(edge))
    .mul(float(1).sub(logo.mul(0.16)))
    .add(line.mul(vec3(0.9, 0.85, 0.6)));
  m.colorNode = c;
  m.roughnessNode = float(0.9).add(fibre.mul(0.08));
  return m;
}

// Varnished wood. The grain follows the rail around the table (the distance from the felt's
// edge), with a slow wobble and fine streaks, like bent and finished hardwood.
function woodMaterial(dims, { dark = false } = {}) {
  const m = new THREE.MeshPhysicalNodeMaterial({ roughness: 0.4, metalness: 0, clearcoat: dark ? 0.15 : 0.7, clearcoatRoughness: 0.28 });
  const w = positionWorld;
  const d = sdRoundRect(w.xz, vec2(dims.a, dims.b), dims.r);
  const warp = mx_fractal_noise_float(w.mul(vec3(0.45, 2.0, 0.45)), 3, 2.0, 0.5);
  const rings = sin(d.mul(26).add(w.y.mul(9)).add(warp.mul(3.2))).mul(0.5).add(0.5);
  const streak = mx_noise_float(vec3(d.mul(90), w.y.mul(30), w.x.add(w.z).mul(1.4))).mul(0.5).add(0.5);
  const a = color(dark ? '#1f120a' : '#3b1f0f');
  const b = color(dark ? '#2e1b10' : '#6e4122');
  const c = mix(a, b, rings.mul(0.55).add(streak.mul(0.45)));
  m.colorNode = c.mul(warp.mul(0.14).add(0.95));
  m.roughnessNode = float(0.34).add(streak.mul(0.18));
  return m;
}

function floorMaterial() {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.7, metalness: 0 });
  const p = positionWorld.xz;
  const plank = p.x.mul(0.9).floor();
  const shift = sin(plank.mul(12.9898)).mul(43758.5453).fract();
  const along = p.y.mul(0.25).add(shift.mul(7));
  const seam = smoothstep(0.0, 0.04, p.x.mul(0.9).fract()).mul(smoothstep(0.0, 0.03, along.fract()));
  const grain = mx_noise_float(vec3(p.x.mul(6), p.y.mul(0.6), plank)).mul(0.5).add(0.5);
  m.colorNode = mix(color('#1b110b'), color('#36231a'), grain.mul(0.6).add(shift.mul(0.4))).mul(seam.mul(0.5).add(0.5));
  return m;
}

// The soft glow around a highlighted card: a rounded-rect halo drawn behind it. It writes to the
// emissive channel too, which the RenderPipeline blurs into a glow.
const HALO_W = CW + 0.62;
const HALO_H = CH + 0.62;
function haloMaterial() {
  const tint = uniform(new THREE.Color('#ffd166'));
  const strength = uniform(0);
  const pulse = uniform(0);
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const glow = Fn(() => {
    const p = uv().sub(0.5).mul(vec2(HALO_W, HALO_H));
    const d = sdRoundRect(p, vec2(CW / 2, CH / 2), float(CR));
    const ring = exp(max(d, 0).mul(-11)).mul(smoothstep(-0.03, 0.004, d));
    const beat = mix(float(1), sin(time.mul(4.4)).mul(0.42).add(0.58), pulse);
    return ring.mul(strength).mul(beat);
  })();
  m.colorNode = tint.mul(glow);
  m.emissiveNode = tint.mul(glow).mul(0.9);
  m.userData = { tint, strength, pulse };
  return m;
}

// Soft glow from the emissive channel: three rings of taps around each pixel, weighted toward
// the middle (a cheap, single-pass stand-in for a mip-chain bloom).
function glowNode(tex, radius) {
  return Fn(() => {
    const px = vec2(1).div(screenSize).mul(radius);
    const acc = tex.sample(uv()).rgb.mul(0.22).toVar();
    const rings = [
      [1, 8, 0.075],
      [2.2, 10, 0.042],
      [3.8, 12, 0.02],
    ];
    rings.forEach(([r, n, w], ri) => {
      for (let k = 0; k < n; k++) {
        const a = ((k + ri * 0.5) / n) * Math.PI * 2;
        acc.addAssign(tex.sample(uv().add(px.mul(vec2(Math.cos(a) * r, Math.sin(a) * r)))).rgb.mul(w));
      }
    });
    return acc;
  })();
}

// ---------------------------------------------------------------------------------------------
// tokens
// ---------------------------------------------------------------------------------------------
function tokenTexture(draw) {
  return canvasTexture(256, 256, draw);
}
function drawBid(g, w, h, amount, won) {
  g.clearRect(0, 0, w, h);
  const grad = g.createRadialGradient(w * 0.4, h * 0.35, 10, w / 2, h / 2, w / 2);
  grad.addColorStop(0, won ? '#ffe9a8' : '#fbf6ea');
  grad.addColorStop(1, won ? '#d29a2c' : '#d9cfb8');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = won ? '#8a5a10' : '#8c7a5a';
  g.lineWidth = 8;
  g.beginPath();
  g.arc(w / 2, h / 2, w / 2 - 22, 0, Math.PI * 2);
  g.stroke();
  g.setLineDash([10, 9]);
  g.lineWidth = 4;
  g.beginPath();
  g.arc(w / 2, h / 2, w / 2 - 8, 0, Math.PI * 2);
  g.stroke();
  g.setLineDash([]);
  g.fillStyle = won ? '#5a3600' : '#3a2c18';
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  g.font = '800 30px "Roboto Slab", Georgia, serif';
  g.fillText(won ? 'CONTRACT' : 'HIGH BID', w / 2, h * 0.36);
  g.font = `900 ${String(amount).length > 3 ? 70 : 88}px "Roboto Slab", Georgia, serif`;
  g.fillText(String(amount), w / 2, h * 0.73);
}
function drawDealer(g, w, h) {
  const grad = g.createRadialGradient(w * 0.4, h * 0.35, 10, w / 2, h / 2, w / 2);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(1, '#d6dae2');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = '#3b4658';
  g.lineWidth = 10;
  g.beginPath();
  g.arc(w / 2, h / 2, w / 2 - 22, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = '#1e293b';
  g.textAlign = 'center';
  g.font = '900 120px "Roboto Slab", Georgia, serif';
  g.fillText('D', w / 2, h * 0.68);
}
async function drawTrump(tex, colorName) {
  const c = tex.image;
  const g = c.getContext('2d');
  const w = c.width;
  const ink = { red: '#c0392b', green: '#24834a', yellow: '#d99a06', black: '#2b2d33' }[colorName];
  const grad = g.createRadialGradient(w * 0.4, w * 0.35, 10, w / 2, w / 2, w / 2);
  grad.addColorStop(0, '#fffaf0');
  grad.addColorStop(1, '#e2d6bd');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, w);
  g.fillStyle = ink;
  g.beginPath();
  g.arc(w / 2, w / 2, w / 2 - 14, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.lineWidth = 7;
  g.stroke();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="256" height="256">${emblem(colorName, 20, 18.5, 22).replace(new RegExp(PALETTE[colorName].ink, 'g'), '#ffffff')}</svg>`;
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await img.decode().catch(() => null);
  g.drawImage(img, 0, 0, w, w);
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.font = '800 30px "Roboto Slab", Georgia, serif';
  g.fillText('TRUMP', w / 2, w * 0.86);
  tex.needsUpdate = true;
}

// ---------------------------------------------------------------------------------------------
// the table
// ---------------------------------------------------------------------------------------------
export async function createTable3D(container, opts = {}) {
  const t = new Table3D(container, opts);
  try {
    await t.init();
  } catch (e) {
    t.destroy();
    throw e;
  }
  return t;
}

class Card {
  constructor(table) {
    this.table = table;
    this.id = null;
    this.zone = 'limbo';
    this.slot = 0;
    this.mesh = new THREE.Mesh(table.cardGeo, [table.backMat, table.backMat, table.edgeMat]);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.userData.card = this;
    this.mesh.visible = false;
    this.halo = null;
    this.tag = null;
    this.tw = null;
    this.dim = 1;
    table.cardLayer.add(this.mesh);
  }
  setId(id) {
    if (id === this.id) return;
    const t = this.table;
    if (this.id && t.byId.get(this.id) === this) t.byId.delete(this.id);
    if (id) {
      const other = t.byId.get(id);
      if (other && other !== this) other.setId(null);
      t.byId.set(id, this);
    }
    this.id = id;
    this.mesh.material = [id ? t.faceMaterial(id) : t.backMat, t.backMat, t.edgeMat];
  }
  setHalo(strength, tint = '#ffd166', pulse = 0) {
    if (!strength && !this.halo) return;
    if (!this.halo) {
      this.halo = new THREE.Mesh(this.table.haloGeo, haloMaterial());
      this.halo.position.z = -CT / 2 - 0.004;
      this.halo.renderOrder = 2;
      this.halo.castShadow = false;
      this.mesh.add(this.halo);
    }
    const u = this.halo.material.userData;
    if (u.strength.value !== strength || u.pulse.value !== pulse || u.tint.value.getHexString() !== new THREE.Color(tint).getHexString()) this.table.dirty = true;
    u.strength.value = strength;
    u.pulse.value = pulse;
    u.tint.value.set(tint);
    this.halo.visible = strength > 0;
  }
  setTag(on) {
    if (!on && !this.tag) return;
    if (!this.tag) {
      this.tag = new THREE.Mesh(this.table.tagGeo, this.table.tagMat);
      this.tag.position.set(0, CH / 2 + 0.02, CT / 2 + 0.006);
      this.tag.castShadow = false;
      this.mesh.add(this.tag);
    }
    if (this.tag.visible !== on) this.table.dirty = true;
    this.tag.visible = on;
  }
}

class Table3D {
  constructor(container, { quality, onTap, onPile, onLost } = {}) {
    this.container = container;
    this.onTap = onTap;
    this.onPile = onPile;
    this.onLost = onLost;
    const coarse = window.matchMedia?.('(pointer: coarse)').matches;
    this.quality = quality || (coarse && Math.min(screen.width, screen.height) < 820 ? 'low' : 'high');
    this.speed = 1;
    this.cards = [];
    this.byId = new Map();
    this.faceMats = new Map();
    this.desc = null;
    this.metrics = { cw: 90, safeBottom: 0, hud: 74 };
    this.dirty = true;
    this.hovered = null;
    this.drag = null;
    this.dims = null;
    this.mode = null;
    this.frameTimes = [];
    this.dead = false;
  }

  async init() {
    const hi = this.quality === 'high';
    // Ask for WebGPU ourselves so a device without it goes straight to the WebGL 2 backend
    // (WebGPURenderer would otherwise log a warning while it falls back).
    let gpu = false;
    try {
      gpu = !!(navigator.gpu && (await navigator.gpu.requestAdapter()));
    } catch {
      gpu = false;
    }
    const r = (this.renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL: !gpu, powerPreference: 'high-performance' }));
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, hi ? 2 : 1.5));
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.onDeviceLost = (info) => !this.dead && this.onLost?.(info);
    await r.init();
    if (this.dead) throw new Error('closed');
    this.backend = r.backend?.isWebGPUBackend ? 'webgpu' : 'webgl2';
    const canvas = r.domElement;
    canvas.className = 'rk-canvas';
    this.container.append(canvas);

    const scene = (this.scene = new THREE.Scene());
    scene.background = new THREE.Color('#0a0705');
    scene.fog = new THREE.Fog('#0a0705', 26, 60);
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.5, 120);
    scene.add(this.camera);

    this.#environment();
    this.#lights();
    this.#shared();
    this.#tokens();
    this.cardLayer = new THREE.Group();
    scene.add(this.cardLayer);
    this.tableGroup = new THREE.Group();
    scene.add(this.tableGroup);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(140, 140).rotateX(-Math.PI / 2), floorMaterial());
    floor.position.y = -3.4;
    floor.receiveShadow = true;
    scene.add(floor);

    // The glow: the RenderPipeline renders the scene once with an extra emissive output (only the
    // halos write to it), then blurs that into a soft glow in the same full-screen pass — a
    // ring of taps in TSL, no extra render targets, so it is cheap on phones.
    const pipeline = (this.pipeline = new THREE.RenderPipeline(r));
    const scenePass = pass(scene, this.camera);
    scenePass.setMRT(mrt({ output, emissive }));
    const out = scenePass.getTextureNode('output');
    const glowTex = scenePass.getTextureNode('emissive');
    this.glowRadius = uniform(hi ? 7 : 5);
    pipeline.outputNode = out.add(glowNode(glowTex, this.glowRadius));

    this.raycaster = new THREE.Raycaster();
    this.#bindPointer(canvas);
    this.resize();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.container);
    // paint the back first (the deal shows it), then every face
    this.painting = this.#paintAll();
    await r.compileAsync(scene, this.camera).catch(() => {});
    this.last = performance.now();
    r.setAnimationLoop(() => this.#frame());
  }

  destroy() {
    this.dead = true;
    this.ro?.disconnect();
    const r = this.renderer;
    if (r) {
      r.setAnimationLoop(null);
      this.scene?.traverse((o) => {
        o.geometry?.dispose?.();
        for (const m of [].concat(o.material || [])) {
          for (const k of ['map']) m[k]?.dispose?.();
          m.dispose?.();
        }
      });
      for (const m of this.faceMats.values()) {
        m.userData.tex?.dispose();
        m.dispose();
      }
      this.backTex?.dispose();
      this.pipeline?.dispose?.();
      r.dispose();
      // three keeps the GPU device (or WebGL context) alive after dispose(); hand it back so
      // switching the 3D table off really frees the memory, and a later restart starts clean
      try {
        r.backend?.device?.destroy?.();
        r.backend?.gl?.getExtension('WEBGL_lose_context')?.loseContext();
      } catch {
        /* already gone */
      }
      r.domElement.remove();
    }
  }

  setSpeed(s) {
    this.speed = s;
  }

  // card width in CSS pixels and the bottom safe area, from ui.js's layout()
  setMetrics(m) {
    Object.assign(this.metrics, m);
    this.resize();
  }

  // -------------------------------------------------------------------------------------------
  // building
  // -------------------------------------------------------------------------------------------
  #environment() {
    // a warm, dim room for reflections in the varnish and the cards' satin finish
    const env = new THREE.Scene();
    const box = new THREE.Mesh(new THREE.BoxGeometry(30, 14, 30), new THREE.MeshBasicMaterial({ color: '#2a1c12', side: THREE.BackSide }));
    box.position.y = 5;
    env.add(box);
    const panel = (w, h, c, x, y, z, ry = 0, rx = 0) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide }));
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, 0);
      env.add(m);
    };
    panel(6, 6, '#ffd9a0', 0, 11.9, 0, 0, Math.PI / 2); // the lamp
    panel(10, 4, '#6a5038', 0, 4, -14.9);
    panel(8, 4, '#55402c', -14.9, 4, 0, Math.PI / 2);
    panel(8, 4, '#3c4a63', 14.9, 4, 2, -Math.PI / 2); // a cool window on one side
    const pm = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pm.fromScene(env, 0.05).texture;
    this.scene.environmentIntensity = 0.55;
    env.traverse((o) => {
      o.geometry?.dispose();
      o.material?.dispose();
    });
    pm.dispose();
  }

  #lights() {
    const s = this.scene;
    const hi = this.quality === 'high';
    s.add(new THREE.HemisphereLight('#ffe7c4', '#1d130c', 0.55));
    const lamp = (this.lamp = new THREE.SpotLight('#ffd9a6', 900, 50, 0.68, 0.72, 2));
    lamp.position.set(0.6, 15, 1.2);
    lamp.castShadow = true;
    lamp.shadow.mapSize.set(hi ? 2048 : 1024, hi ? 2048 : 1024);
    lamp.shadow.bias = -0.0004;
    lamp.shadow.normalBias = 0.015;
    lamp.shadow.radius = hi ? 6 : 4;
    lamp.shadow.camera.near = 6;
    lamp.shadow.camera.far = 24;
    s.add(lamp, lamp.target);
    const rim = new THREE.DirectionalLight('#8fa6d8', 0.35);
    rim.position.set(-12, 8, -10);
    s.add(rim);
  }

  #shared() {
    this.cardGeo = cardGeometry();
    this.haloGeo = new THREE.PlaneGeometry(HALO_W, HALO_H);
    const hi = this.quality === 'high';
    this.texW = hi ? 384 : 256;
    this.texH = Math.round((this.texW * 350) / 250);
    this.backTex = canvasTexture(this.texW, this.texH, (g, w, h) => {
      g.fillStyle = '#5aa9d6';
      g.fillRect(0, 0, w, h);
    });
    this.backMat = new THREE.MeshStandardNodeMaterial({ map: this.backTex, roughness: 0.48, metalness: 0 });
    this.edgeMat = new THREE.MeshStandardNodeMaterial({ color: '#ebe7dc', roughness: 0.75, metalness: 0 });
    const tag = canvasTexture(128, 48, (g, w, h) => {
      g.fillStyle = '#3ccf8e';
      g.beginPath();
      g.roundRect(4, 4, w - 8, h - 8, 12);
      g.fill();
      g.fillStyle = '#04281a';
      g.font = '900 26px Inter, system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillText('NEW', w / 2, h * 0.68);
    });
    this.tagGeo = new THREE.PlaneGeometry(0.5, 0.19);
    this.tagMat = new THREE.MeshBasicNodeMaterial({ map: tag, transparent: true, depthWrite: false });
    this.logoTex = canvasTexture(512, 512, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.strokeStyle = '#000';
      g.fillStyle = '#000';
      g.lineWidth = 5;
      g.beginPath();
      g.arc(w / 2, h / 2, w / 2 - 12, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([8, 10]);
      g.lineWidth = 2.5;
      g.beginPath();
      g.arc(w / 2, h / 2, w / 2 - 30, 0, Math.PI * 2);
      g.stroke();
      g.textAlign = 'center';
      g.font = '900 104px "Roboto Slab", Georgia, serif';
      if ('letterSpacing' in g) g.letterSpacing = '26px';
      g.fillText('ROOK', w / 2 + 13, h / 2 + 36);
    });
    this.logoTex.colorSpace = THREE.NoColorSpace;
  }

  faceMaterial(id) {
    let m = this.faceMats.get(id);
    if (!m) {
      const tex = canvasTexture(this.texW, this.texH, (g, w, h) => {
        g.fillStyle = '#f3f2ed';
        g.fillRect(0, 0, w, h);
      });
      m = new THREE.MeshStandardNodeMaterial({ roughness: 0.46, metalness: 0 });
      const dim = uniform(1);
      const gain = uniform(1);
      m.colorNode = texture(tex).rgb.mul(dim).mul(gain);
      m.userData = { tex, dim, gain, painted: false };
      this.faceMats.set(id, m);
      if (this.paintedAll) this.#paintFace(id);
    }
    return m;
  }

  async #paintFace(id) {
    const m = this.faceMaterial(id);
    if (m.userData.painted) return;
    m.userData.painted = true;
    await paintSvg(cardFace(id), m.userData.tex.image).catch((e) => console.warn('rook: card art', e));
    m.userData.tex.needsUpdate = true;
    this.dirty = true;
  }

  async #paintAll() {
    await paintSvg(cardBack(), this.backTex.image).catch((e) => console.warn('rook: card back', e));
    this.backTex.needsUpdate = true;
    this.dirty = true;
    const ids = ['bird'];
    for (const c of ['red', 'green', 'yellow', 'black']) for (let r = 1; r <= 14; r++) if (r !== 2 && r !== 3 && r !== 4) ids.push(`${c}-${r}`);
    for (const id of ids) {
      if (this.dead) return;
      await this.#paintFace(id);
    }
    this.paintedAll = true;
  }

  #tokens() {
    const side = new THREE.MeshStandardNodeMaterial({ color: '#b38a4a', roughness: 0.4, metalness: 0.35 });
    const mk = (r, h, tex) => {
      const top = new THREE.MeshStandardNodeMaterial({ map: tex, roughness: 0.45, metalness: 0 });
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 48), [side, top, side]);
      m.castShadow = true;
      m.receiveShadow = true;
      m.visible = false;
      m.userData.tw = null;
      this.scene.add(m);
      return m;
    };
    this.bidTex = tokenTexture((g, w, h) => drawBid(g, w, h, 0, false));
    this.bidToken = mk(0.5, 0.09, this.bidTex);
    this.bidToken.userData.key = '';
    this.trumpTex = tokenTexture(null);
    this.trumpToken = mk(0.42, 0.07, this.trumpTex);
    this.trumpToken.userData.key = '';
    this.dealerTex = tokenTexture(drawDealer);
    this.dealerToken = mk(0.3, 0.08, this.dealerTex);
    this.dealerToken.userData.key = '';
  }

  // The table shape follows the screen: long side across in landscape, toward the far seat in
  // portrait, so the felt fills a phone either way.
  #buildTable(mode) {
    if (this.mode === mode) return;
    this.mode = mode;
    for (const o of [...this.tableGroup.children]) {
      this.tableGroup.remove(o);
      o.geometry?.dispose();
      for (const m of [].concat(o.material || [])) m.dispose?.();
    }
    const d = (this.dims = mode === 'portrait' ? { a: 4.15, b: 6.35, r: 2.6, logo: 4.2 } : { a: 7.4, b: 4.45, r: 2.9, logo: 4.4 });
    const felt = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(roundRectShape(d.a + 0.2, d.b + 0.2, d.r + 0.2)), 12).rotateX(-Math.PI / 2), feltMaterial(d, this.logoTex));
    felt.receiveShadow = true;
    this.tableGroup.add(felt);
    // the rail: a ring extruded with a fat bevel, so it is round like a padded wood rim
    const ring = new THREE.Shape(roundRectShape(d.a + RAIL, d.b + RAIL, d.r + RAIL));
    ring.holes.push(new THREE.Path(roundRectShape(d.a + 0.12, d.b + 0.12, d.r + 0.12, true)));
    const railGeo = new THREE.ExtrudeGeometry(ring, { depth: 0.16, bevelEnabled: true, bevelThickness: 0.17, bevelSize: 0.15, bevelSegments: 5, curveSegments: 24 });
    railGeo.rotateX(-Math.PI / 2);
    const rail = new THREE.Mesh(railGeo, woodMaterial(d));
    rail.position.y = 0.05;
    rail.castShadow = true;
    rail.receiveShadow = true;
    this.tableGroup.add(rail);
    const apron = new THREE.ExtrudeGeometry(new THREE.Shape(roundRectShape(d.a + RAIL - 0.12, d.b + RAIL - 0.12, d.r + RAIL - 0.12)), { depth: 1.2, bevelEnabled: false, curveSegments: 24 });
    apron.rotateX(Math.PI / 2);
    const base = new THREE.Mesh(apron, woodMaterial(d, { dark: true }));
    base.position.y = -0.02;
    base.receiveShadow = true;
    this.tableGroup.add(base);
    this.lamp.target.position.set(0, 0, mode === 'portrait' ? -0.4 : 0);
    this.lamp.angle = mode === 'portrait' ? 0.7 : 0.66;
    const sc = this.lamp.shadow.camera;
    sc.updateProjectionMatrix();
    this.dirty = true;
  }

  // -------------------------------------------------------------------------------------------
  // camera & layout
  // -------------------------------------------------------------------------------------------
  resize() {
    if (!this.renderer || this.dead) return;
    const rect = this.container.getBoundingClientRect();
    const W = Math.max(1, rect.width);
    const H = Math.max(1, rect.height);
    this.W = W;
    this.H = H;
    this.renderer.setSize(W, H);
    const portrait = H > W * 1.05;
    this.#buildTable(portrait ? 'portrait' : 'landscape');
    this.#fitCamera();
    if (this.desc) this.sync(this.desc, { dur: 0 });
    this.dirty = true;
  }

  project(v) {
    const p = v.clone().project(this.camera);
    return { x: (p.x * 0.5 + 0.5) * this.W, y: (-p.y * 0.5 + 0.5) * this.H };
  }

  #fitCamera() {
    const cam = this.camera;
    const { W, H } = this;
    const d = this.dims;
    const portrait = this.mode === 'portrait';
    cam.aspect = W / H;
    cam.fov = portrait ? 40 : 34;
    // a phone on its side is short: look down more steeply so the table keeps its depth
    const short = (this.short = !portrait && H < 520);
    const pitch = (portrait ? 58 : short ? 64 : 52) * DEG;
    const hud = this.metrics.hud;
    const place = (dist, tz) => {
      cam.position.set(0, Math.sin(pitch) * dist, tz + Math.cos(pitch) * dist);
      cam.lookAt(0, 0, tz);
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld(true);
    };
    const yOf = (v) => this.project(v).y;
    const centerY = H * (portrait ? 0.45 : short ? 0.47 : 0.44);
    const solveTz = (dist) => {
      let lo = -8, hi = 8;
      for (let i = 0; i < 30; i++) {
        const mid = (lo + hi) / 2;
        place(dist, mid);
        if (yOf(new THREE.Vector3(0, 0, 0)) > centerY) lo = mid;
        else hi = mid;
      }
      return (lo + hi) / 2;
    };
    // far felt edge just under the score panels; in landscape the rail also fits across
    // short screens (a phone on its side) let the far rail slide under the score panels so
    // the table still gets at least a quarter of the height above the middle
    const farY = short ? Math.max(H * 0.06, hud * 0.45) : Math.max(H * 0.04, Math.min(hud + (portrait ? 52 : 36), centerY - Math.max(56, H * 0.26)));
    let lo = 6, hi = 80;
    for (let i = 0; i < 26; i++) {
      const mid = (lo + hi) / 2;
      const tz = solveTz(mid);
      place(mid, tz);
      const far = yOf(new THREE.Vector3(0, 0, -d.b));
      let tooBig = far < farY;
      if (!portrait) {
        const edge = this.project(new THREE.Vector3(d.a + RAIL * 0.6, 0, 0)).x;
        if (edge > W * 0.995) tooBig = true;
      }
      if (tooBig) lo = mid;
      else hi = mid;
    }
    this.dist = hi;
    const tz = solveTz(hi);
    place(hi, tz);
    this.#spots();
  }

  // where things sit on the table for each seat position
  #spots() {
    const { a, b } = this.dims;
    const portrait = this.mode === 'portrait';
    // the side fans must stay on screen, even when a narrow phone cuts off the rail
    const visibleX = (z, y) => {
      const ndc = new THREE.Vector3(0.94, 0, 0);
      // find x at the screen edge on the plane through (0, y, z)
      let lo = 0, hi = 30;
      for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) / 2;
        const p = new THREE.Vector3(mid, y, z).project(this.camera);
        if (p.x > ndc.x) hi = mid;
        else lo = mid;
      }
      return lo;
    };
    const sideX = Math.min(a - 0.95, visibleX(0, 0.9) - 0.75);
    this.spot = {
      fan: {
        top: { c: new THREE.Vector3(0, 0.95, -(b - 0.95)), f: new THREE.Vector3(0, 0, -1) },
        left: { c: new THREE.Vector3(-sideX, 0.95, portrait ? -0.6 : -0.25), f: new THREE.Vector3(-1, 0, -0.55).normalize() },
        right: { c: new THREE.Vector3(sideX, 0.95, portrait ? -0.6 : -0.25), f: new THREE.Vector3(1, 0, -0.55).normalize() },
        bottom: { c: new THREE.Vector3(0, 0.95, b - 0.7), f: new THREE.Vector3(0, 0, -1) },
      },
      pile: portrait
        ? { bottom: new THREE.Vector3(a - 1.35, 0, b - 1.9), top: new THREE.Vector3(-(a - 1.6), 0, -(b - 1.5)), left: new THREE.Vector3(-(sideX - 0.35), 0, -3.3), right: new THREE.Vector3(sideX - 0.35, 0, 2.2) }
        : { bottom: new THREE.Vector3(a * 0.6, 0, b - 1.3), top: new THREE.Vector3(-a * 0.42, 0, -(b - 1.2)), left: new THREE.Vector3(-(a - 2.5), 0, -b * 0.5), right: new THREE.Vector3(a - 2.5, 0, b * 0.36) },
      buriedDir: { bottom: new THREE.Vector3(-1.45, 0, 0), top: new THREE.Vector3(1.45, 0, 0), left: new THREE.Vector3(0, 0, 1.6), right: new THREE.Vector3(0, 0, -1.6) },
      bid: portrait
        ? { bottom: new THREE.Vector3(-1.5, 0, b - 2.1), top: new THREE.Vector3(1.2, 0, -(b - 1.75)), left: new THREE.Vector3(-(sideX - 0.6), 0, 1.25), right: new THREE.Vector3(sideX - 0.6, 0, -2.2) }
        : { bottom: new THREE.Vector3(-1.9, 0, b - 1.65), top: new THREE.Vector3(1.5, 0, -(b - 1.55)), left: new THREE.Vector3(-(a - 2.0), 0, 1.25), right: new THREE.Vector3(a - 2.0, 0, -1.3) },
      trick: { bottom: new THREE.Vector3(0, 0, 0.74), top: new THREE.Vector3(0, 0, -0.74), left: new THREE.Vector3(-0.92, 0, 0), right: new THREE.Vector3(0.92, 0, 0) },
      nest: new THREE.Vector3(0, 0, 0),
      nestAside: new THREE.Vector3(portrait ? -1.9 : -2.7, 0, portrait ? 1.6 : 1.1),
    };
  }

  // screen positions (CSS px) for the HTML seats, the ticker and score pop-ups
  anchors() {
    const { a, b } = this.dims;
    const W = this.W;
    const H = this.H;
    const s = this.spot;
    const clampPt = (p, m = 34) => ({ x: clamp(p.x, m, W - m), y: clamp(p.y, Math.min(this.metrics.hud + 26, H * 0.3), H - 40) });
    const top = this.project(new THREE.Vector3(0, 0.25, -(b + RAIL * 0.5)));
    const centerY = this.project(new THREE.Vector3()).y;
    top.y = Math.min(Math.max(top.y, this.metrics.hud + 34), centerY - 52);
    return {
      top: clampPt(top),
      left: clampPt(this.project(this.short ? new THREE.Vector3(s.fan.left.c.x - 1.25, 0.3, s.fan.left.c.z + 0.2) : new THREE.Vector3(s.fan.left.c.x - 0.35, 0.3, s.fan.left.c.z - 1.75)), 40),
      right: clampPt(this.project(this.short ? new THREE.Vector3(s.fan.right.c.x + 1.25, 0.3, s.fan.right.c.z + 0.2) : new THREE.Vector3(s.fan.right.c.x + 0.35, 0.3, s.fan.right.c.z - 1.75)), 40),
      center: this.project(new THREE.Vector3(0, 0, 0)),
      ticker: this.project(new THREE.Vector3(0, 0, this.mode === 'portrait' ? 1.75 : 1.6)),
      pile: Object.fromEntries(POSITIONS.map((p) => [p, this.project(s.pile[p].clone().setY(0.4))])),
    };
  }

  // -------------------------------------------------------------------------------------------
  // poses
  // -------------------------------------------------------------------------------------------
  #flat(p, yaw, faceUp) {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), faceUp ? -Math.PI / 2 : Math.PI / 2));
    return { p, q, s: 1 };
  }

  #fanPose(spot, i, n, scale) {
    const F = spot.f;
    const up = new THREE.Vector3(0, 1, 0).addScaledVector(F, 0.36).normalize();
    const yl = up.clone().addScaledVector(F, -up.dot(F)).normalize();
    const xl = new THREE.Vector3().crossVectors(yl, F).normalize();
    const basis = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xl, yl, F));
    const spread = Math.min(6.5, 62 / Math.max(n, 1)) * DEG;
    const a = (i - (n - 1) / 2) * spread;
    const radius = 1.5 * scale;
    const rot = new THREE.Quaternion().setFromAxisAngle(F, -a);
    const pivot = spot.c.clone().addScaledVector(yl, -radius);
    const p = pivot.add(yl.clone().applyQuaternion(rot).multiplyScalar(radius)).addScaledVector(F, (i - (n - 1) / 2) * 0.012);
    return { p, q: rot.multiply(basis), s: scale };
  }

  // my hand: fanned at the bottom of the screen, facing the camera, sized like the 2D hand
  #handPose(card, i, n) {
    const cam = this.camera;
    const { W, H } = this;
    const m = this.metrics;
    const cw = m.cw * 1.08;
    const ch = cw * 1.4;
    const narrow = W < 700;
    const maxStep = cw * 0.72;
    // tablets (iPad portrait): keep the fan off the screen's rounded edges
    const edge = narrow ? 0 : Math.max(12, W * 0.035);
    const step = n > 1 ? Math.min(maxStep, (W - cw * (narrow ? 1.7 : 1.9) - 2 * edge) / (n - 1)) : 0;
    const spread = Math.min(narrow ? 1.2 : 3, (narrow ? 12 : 30) / Math.max(n, 1)) * DEG;
    const off = i - (n - 1) / 2;
    let lift = 0;
    const d = this.desc || {};
    const id = card.id;
    const playable = d.interactive && d.legal?.has(id);
    if (playable) lift = 10;
    if (playable && this.hovered === id) lift = 24;
    if (d.selected?.has(id)) lift = 34;
    if (d.sent === id) lift = 60;
    let dx = 0;
    let dy = 0;
    if (this.drag?.card === card && this.drag.moved) {
      dx = this.drag.dx;
      dy = Math.min(this.drag.dy, 0);
      lift = 30;
    }
    const r = off * spread;
    const cx = W / 2 + off * step + dx;
    const cy = H - (6 + m.safeBottom) - ch / 2 + Math.pow(Math.abs(off), 1.6) * 1.6 - lift + dy;
    const pivotY = cy + 0.7 * ch;
    const sx = cx + 0.7 * ch * Math.sin(r);
    const sy = pivotY - 0.7 * ch * Math.cos(r);
    const D = 5 - i * 0.02 - (this.drag?.card === card ? 0.3 : 0);
    const k = (2 * D * Math.tan((cam.fov * DEG) / 2)) / H;
    const local = new THREE.Vector3((sx - W / 2) * k, (H / 2 - sy) * k, -D);
    const p = local.applyMatrix4(cam.matrixWorld);
    const q = cam.quaternion.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -r)).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -5 * DEG));
    return { p, q, s: (cw * k) / CW };
  }

  #pose(card, n) {
    const s = this.spot;
    const i = card.slot;
    const z = card.zone;
    const tilt = (id) => ((hash(id) % 13) - 6) * DEG;
    if (z === 'hand-bottom' && this.desc?.myHandIds) return this.#handPose(card, i, n);
    if (z.startsWith('hand-')) {
      const pos = z.slice(5);
      return this.#fanPose(s.fan[pos], i, n, pos === 'top' ? 0.74 : 0.78);
    }
    if (z === 'trick') {
      const o = s.trick[card.trickPos] || new THREE.Vector3();
      return this.#flat(new THREE.Vector3(o.x, CT / 2 + 0.006 + i * (CT + 0.004), o.z), -tilt(card.id || i), true);
    }
    if (z === 'nest') {
      const base = this.desc?.nestAside ? s.nestAside : s.nest;
      return this.#flat(new THREE.Vector3(base.x + i * 0.02 - 0.04, CT / 2 + 0.006 + i * STACK, base.z - i * 0.02), (i - 2) * 2.5 * DEG + (this.desc?.nestAside ? 0.4 : 0), false);
    }
    if (z.startsWith('pile-')) {
      const pos = z.slice(5);
      const per = this.desc?.trickSize || 4;
      const trick = Math.floor(i / per);
      const j = i % per;
      const base = s.pile[pos];
      const jit = (hash(pos + trick) % 7) - 3;
      const yaw = (trick % 2 ? Math.PI / 2 : 0) + jit * 1.6 * DEG + (j - 1.5) * 1.2 * DEG + (pos === 'left' || pos === 'right' ? Math.PI / 2 : 0);
      return this.#flat(new THREE.Vector3(base.x + jit * 0.012, CT / 2 + 0.006 + i * STACK, base.z + ((hash(trick + pos) % 5) - 2) * 0.012), yaw, false);
    }
    if (z.startsWith('buried-')) {
      const pos = z.slice(7);
      const base = s.pile[pos].clone().add(s.buriedDir[pos]);
      return this.#flat(new THREE.Vector3(base.x + i * 0.05, CT / 2 + 0.006 + i * STACK, base.z - i * 0.02), 0.32 + i * 3 * DEG + (pos === 'left' || pos === 'right' ? Math.PI / 2 : 0), false);
    }
    if (z === 'deck') {
      const base = s.pile[this.desc?.dealer || 'bottom'];
      return this.#flat(new THREE.Vector3(base.x + (hash(i) % 3) * 0.006, CT / 2 + 0.006 + i * STACK * 0.96, base.z), 0.12 + ((hash(i * 7) % 5) - 2) * 0.4 * DEG, false);
    }
    return { p: new THREE.Vector3(0, -2, 0), q: new THREE.Quaternion(), s: 0.01 };
  }

  // -------------------------------------------------------------------------------------------
  // state → cards
  // -------------------------------------------------------------------------------------------
  // d = {
  //   myHandIds: [...ids] | null, hands: { left: n, top: n, right: n, bottom: n },
  //   trick: [{ pos, id }], nest: n, nestAside, piles: { pos: n }, buried: { pos, n } | null,
  //   deck: n, dealer: pos, trickSize, legal: Set, interactive, dimIllegal, selected: Set,
  //   hint: Set, newCards: Set, winning: pos, taker: pos, sent: id,
  //   bid: { pos, amount, won } | null, trump: { color, pos } | null, dealerButton: pos | null }
  sync(d, { dur = 0.42, stagger = 0, order = null } = {}) {
    if (this.dead) return Promise.resolve();
    this.desc = d;
    const used = new Set();
    const plan = new Map(); // card → { zone, slot, pos }
    const take = (c, zone, slot, extra = {}) => {
      used.add(c);
      plan.set(c, { zone, slot, ...extra });
    };
    // 1. cards whose faces are known: my hand and the trick
    const pendingIds = [];
    (d.myHandIds || []).forEach((id, i) => {
      const c = this.byId.get(id);
      if (c && !used.has(c)) take(c, 'hand-bottom', i);
      else pendingIds.push({ zone: 'hand-bottom', slot: i, id });
    });
    (d.trick || []).forEach((t, i) => {
      const c = this.byId.get(t.id);
      if (c && !used.has(c)) take(c, 'trick', i, { trickPos: t.pos });
      else pendingIds.push({ zone: 'trick', slot: i, id: t.id, trickPos: t.pos, from: 'hand-' + t.pos });
    });
    // 2. counted zones keep the cards they already hold
    const counted = [];
    for (const p of POSITIONS) if (!(p === 'bottom' && d.myHandIds)) counted.push(['hand-' + p, d.hands?.[p] || 0]);
    counted.push(['nest', d.nest || 0], ['deck', d.deck || 0]);
    for (const p of POSITIONS) counted.push(['pile-' + p, d.piles?.[p] || 0]);
    for (const p of POSITIONS) counted.push(['buried-' + p, d.buried?.pos === p ? d.buried.n : 0]);
    const shortfalls = [];
    for (const [zone, n] of counted) {
      const mine = this.cards.filter((c) => c.zone === zone && !used.has(c)).sort((x, y) => x.slot - y.slot);
      let k = 0;
      for (const c of mine) {
        if (k >= n) break;
        take(c, zone, k++);
      }
      for (; k < n; k++) shortfalls.push({ zone, slot: k });
    }
    // 3. fill the gaps with spare cards (nearest first), then new ones
    let spare = this.cards.filter((c) => !used.has(c));
    const grab = (prefZone, target) => {
      if (!spare.length) return null;
      let best = 0;
      if (prefZone) {
        const pref = spare.map((c, i) => [c, i]).filter(([c]) => c.zone === prefZone);
        if (pref.length) best = pref[pref.length - 1][1];
      } else if (target) {
        let bd = Infinity;
        spare.forEach((c, i) => {
          const dd = c.mesh.position.distanceToSquared(target);
          if (dd < bd) (bd = dd), (best = i);
        });
      }
      return spare.splice(best, 1)[0];
    };
    const spawn = (zone) => {
      const c = new Card(this);
      this.cards.push(c);
      c.zone = zone;
      c.fresh = true;
      return c;
    };
    for (const pi of pendingIds) {
      const c = grab(pi.from || null, null) || spawn(pi.zone);
      c.setId(pi.id);
      take(c, pi.zone, pi.slot, pi.trickPos ? { trickPos: pi.trickPos } : {});
    }
    for (const sf of shortfalls) {
      const target = this.#zoneCenter(sf.zone);
      const c = grab(null, target) || spawn(sf.zone);
      take(c, sf.zone, sf.slot);
    }
    for (const c of spare) take(c, 'limbo', 0);
    // 4. commit and move everything to where it now belongs
    const counts = new Map();
    for (const { zone } of plan.values()) counts.set(zone, (counts.get(zone) || 0) + 1);
    const now = performance.now();
    let end = now;
    let k = 0;
    const moved = [];
    for (const [c, pl] of plan) {
      const changedZone = c.zone !== pl.zone;
      c.zone = pl.zone;
      c.slot = pl.slot;
      if (pl.trickPos) c.trickPos = pl.trickPos;
      if (pl.zone.startsWith('hand-') && pl.zone !== 'hand-bottom') c.setId(null);
      if (pl.zone === 'hand-bottom' && !d.myHandIds) c.setId(null);
      if (changedZone) moved.push(c);
    }
    if (order) moved.sort((x, y) => order(x) - order(y));
    const delays = new Map(moved.map((c) => [c, stagger ? k++ * stagger : 0]));
    for (const [c] of plan) {
      const target = c.zone === 'limbo' ? null : this.#pose(c, counts.get(c.zone));
      const e = this.#moveTo(c, target, dur, delays.get(c) || 0, now);
      end = Math.max(end, e);
    }
    this.#decorate();
    this.#syncTokens(d, dur);
    this.dirty = true;
    const wait = end - now;
    return wait > 1 ? new Promise((r) => setTimeout(r, wait + 16)) : Promise.resolve();
  }

  #zoneCenter(zone) {
    const s = this.spot;
    if (zone.startsWith('hand-')) return zone === 'hand-bottom' ? this.camera.position.clone() : s.fan[zone.slice(5)].c;
    if (zone.startsWith('pile-')) return s.pile[zone.slice(5)];
    if (zone.startsWith('buried-')) return s.pile[zone.slice(7)].clone().add(s.buriedDir[zone.slice(7)]);
    if (zone === 'deck') return s.pile[this.desc?.dealer || 'bottom'];
    return s.nest;
  }

  // start (or retarget) a card's flight; returns when it lands (ms clock)
  #moveTo(c, target, dur, delay, now) {
    const m = c.mesh;
    if (!target) {
      c.tw = null;
      m.visible = false;
      c.fresh = false;
      return now;
    }
    if (c.fresh || !m.visible) {
      // a card that wasn't on the table: drop it in at its spot
      c.fresh = false;
      m.visible = true;
      m.position.copy(target.p).add(new THREE.Vector3(0, 0.6, 0));
      m.quaternion.copy(target.q);
      m.scale.setScalar(target.s * 0.2);
    }
    const cur = c.tw ? c.tw.to : { p: m.position, q: m.quaternion, s: m.scale.x };
    const same = cur.p.distanceToSquared(target.p) < 1e-7 && Math.abs(cur.q.dot(target.q)) > 0.99999 && Math.abs(cur.s - target.s) < 1e-4;
    if (same && (!c.tw || c.tw.end <= now)) return now;
    if (same && c.tw) return c.tw.end;
    const ms = dur * 1000 * this.speed;
    if (ms <= 0) {
      c.tw = null;
      m.position.copy(target.p);
      m.quaternion.copy(target.q);
      m.scale.setScalar(target.s);
      return now;
    }
    // start from where the card is by the clock, not where the last frame drew it (a slow
    // device may not have drawn the end of its previous move yet)
    const from = this.#poseAt(c, now);
    const dist = from.p.distanceTo(target.p);
    // lift cards off the cloth when they travel or turn over on the table
    const turning = 1 - Math.abs(from.q.dot(target.q));
    const onTable = from.p.y < 0.6 && target.p.y < 0.6;
    const arc = onTable ? Math.max(Math.min(1.1, dist * 0.16), turning > 0.05 ? 0.55 : 0) : Math.min(0.5, dist * 0.04);
    const t0 = now + delay * 1000 * this.speed;
    c.tw = { from, to: { p: target.p.clone(), q: target.q.clone(), s: target.s }, t0, end: t0 + ms, arc, ease: dist > 2 ? easeInOut : easeOut };
    // flights over a short way finish snappier
    if (dist < 0.4) c.tw.ease = easeOut;
    return c.tw.end;
  }

  #poseAt(c, now) {
    const m = c.mesh;
    const tw = c.tw;
    if (!tw) return { p: m.position.clone(), q: m.quaternion.clone(), s: m.scale.x };
    const k = clamp((now - tw.t0) / (tw.end - tw.t0), 0, 1);
    const e = tw.ease(k);
    const p = new THREE.Vector3().lerpVectors(tw.from.p, tw.to.p, e);
    p.y += Math.sin(Math.PI * k) * tw.arc;
    return { p, q: new THREE.Quaternion().slerpQuaternions(tw.from.q, tw.to.q, e), s: tw.from.s + (tw.to.s - tw.from.s) * e };
  }

  #decorate() {
    const d = this.desc || {};
    for (const c of this.cards) {
      if (c.zone === 'hand-bottom' && d.myHandIds) {
        const id = c.id;
        const playable = d.interactive && d.legal?.has(id);
        const dim = d.interactive && d.dimIllegal && !d.legal?.has(id) ? 0.3 : 1;
        const mat = this.faceMats.get(id);
        if (mat) {
          if (mat.userData.dim.value !== dim) this.dirty = true;
          mat.userData.dim.value = dim;
          mat.userData.gain.value = 3.1;
        }
        if (d.selected?.has(id)) c.setHalo(0.9, '#ffcf5a');
        else if (d.hint?.has(id)) c.setHalo(1.05, '#6dffb8', 1);
        else if (playable && this.hovered === id) c.setHalo(0.6, '#ffe39a');
        else c.setHalo(0);
        c.setTag(!!d.newCards?.has(id));
        c.mesh.castShadow = false;
      } else {
        const mat = c.id && this.faceMats.get(c.id);
        if (mat) {
          mat.userData.dim.value = 1;
          mat.userData.gain.value = 1;
        }
        if (c.zone === 'trick' && d.taker === c.trickPos) c.setHalo(1.6, '#ffd166');
        else if (c.zone === 'trick' && d.winning === c.trickPos) c.setHalo(0.65, '#ffd166');
        else c.setHalo(0);
        c.setTag(false);
        c.mesh.castShadow = true;
      }
    }
  }

  // wooden tokens: the high bid / contract, the trump coin and the dealer button
  #syncTokens(d, dur) {
    const s = this.spot;
    const now = performance.now();
    const place = (tok, key, target, { drop = false, spin = false } = {}) => {
      const u = tok.userData;
      if (!target) {
        if (tok.visible) {
          tok.visible = false;
          this.dirty = true;
        }
        u.key = '';
        u.tw = null;
        return;
      }
      // the cylinder's top cap is mapped with the picture's up along +x; turn it to face the player
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2 + (target.yaw || 0));
      if (!tok.visible) {
        tok.visible = true;
        tok.position.copy(target.p).add(new THREE.Vector3(0, drop ? 2.4 : 0.8, 0));
        tok.quaternion.copy(q);
        tok.scale.setScalar(drop ? 1 : 0.2);
      }
      if (u.key === key && u.tw) return;
      u.key = key;
      const ms = Math.max(1, (dur || 0.4) * 1000 * this.speed * (spin ? 2.2 : 1.3));
      u.tw = { from: { p: tok.position.clone(), q: tok.quaternion.clone(), s: tok.scale.x }, to: { p: target.p.clone(), q, s: 1 }, t0: now, end: now + ms, spin, arc: tok.position.distanceTo(target.p) > 0.3 ? 0.8 : 0 };
      this.dirty = true;
    };
    const y = (h) => h / 2 + 0.002;
    if (d.bid) {
      const p = s.bid[d.bid.pos].clone().setY(y(0.09));
      const tex = this.bidTex;
      const key = `${d.bid.pos}|${d.bid.amount}|${d.bid.won}`;
      if (this.bidToken.userData.key !== key) {
        drawBid(tex.image.getContext('2d'), tex.image.width, tex.image.height, d.bid.amount, d.bid.won);
        tex.needsUpdate = true;
      }
      place(this.bidToken, key, { p });
    } else place(this.bidToken, '', null);
    if (d.trump) {
      const base = s.bid[d.trump.pos] || s.nest;
      const inward = new THREE.Vector3(-base.x, 0, -base.z).normalize();
      const p = base.clone().addScaledVector(inward, 1.05).setY(y(0.07));
      if (!this.trumpToken.userData.key.startsWith(d.trump.color + '|')) drawTrump(this.trumpTex, d.trump.color).then(() => (this.dirty = true));
      place(this.trumpToken, `${d.trump.color}|${d.trump.pos}`, { p }, { drop: true, spin: true });
    } else place(this.trumpToken, '', null);
    if (d.dealerButton) {
      // across the seat from where the bid token goes
      const pos = d.dealerButton;
      const b = s.bid[pos];
      const p = (pos === 'top' || pos === 'bottom' ? new THREE.Vector3(-b.x, 0, b.z) : new THREE.Vector3(b.x, 0, -b.z)).setY(y(0.08));
      place(this.dealerToken, d.dealerButton, { p });
    } else place(this.dealerToken, '', null);
  }

  // -------------------------------------------------------------------------------------------
  // dealing (cards gather at the dealer, then go round the table two at a time)
  // -------------------------------------------------------------------------------------------
  async deal(d, order) {
    const total = (d.myHandIds?.length || 0) + POSITIONS.reduce((n, p) => n + (p === 'bottom' && d.myHandIds ? 0 : d.hands[p] || 0), 0) + (d.nest || 0);
    const gather = { ...d, myHandIds: null, hands: {}, trick: [], nest: 0, piles: {}, buried: null, deck: total, bid: null, trump: null, legal: null, interactive: false, selected: null, hint: null, newCards: null };
    for (const c of this.cards) c.setId(null);
    await this.sync(gather, { dur: 0.5, stagger: 0.006 });
    await new Promise((r) => setTimeout(r, 120 * this.speed));
    this.desc = d;
    const deck = this.cards.filter((c) => c.zone === 'deck').sort((x, y) => y.slot - x.slot);
    const fill = new Map(POSITIONS.map((p) => [p, 0]));
    let nestK = 0;
    const counts = new Map();
    const steps = [];
    const per = Math.max(...POSITIONS.map((p) => (p === 'bottom' && d.myHandIds ? d.myHandIds.length : d.hands[p] || 0)));
    for (let round = 0; round < Math.ceil(per / 2); round++) {
      for (const p of order) {
        const n = p === 'bottom' && d.myHandIds ? d.myHandIds.length : d.hands[p] || 0;
        for (let j = 0; j < 2; j++) if (fill.get(p) < n) steps.push({ zone: 'hand-' + p, slot: fill.get(p), pos: p, j }), fill.set(p, fill.get(p) + 1);
      }
      if (round === 1) for (let i = 0; i < (d.nest || 0); i++) steps.push({ zone: 'nest', slot: nestK++, j: i % 2 });
    }
    for (const st of steps) counts.set(st.zone, (counts.get(st.zone) || 0) + 1);
    const now = performance.now();
    let end = now;
    let k = 0;
    steps.forEach((st) => {
      const c = deck.shift();
      if (!c) return;
      c.zone = st.zone;
      c.slot = st.slot;
      if (st.zone === 'hand-bottom' && d.myHandIds) c.setId(d.myHandIds[st.slot]);
      if (st.j === 0) k++;
      const delay = (k * 0.075 + st.j * 0.03) * 1;
      end = Math.max(end, this.#moveTo(c, this.#pose(c, counts.get(st.zone)), 0.34, delay, now));
    });
    for (const c of deck) this.#moveTo(c, null, 0, 0, now);
    this.#decorate();
    this.#syncTokens(d, 0.4);
    this.dirty = true;
    await new Promise((r) => setTimeout(r, end - now + 30));
    return this.sync(d, { dur: 0.3 });
  }

  // an opponent's card: pick one from their fan and give it the face it is about to show
  prepPlay(pos, id) {
    const have = this.byId.get(id);
    if (have && (have.zone === 'hand-' + pos || have.zone === 'trick')) return;
    const fan = this.cards.filter((c) => c.zone === 'hand-' + pos).sort((a, b) => a.slot - b.slot);
    if (!fan.length) return;
    fan[hash(id) % fan.length].setId(id);
  }
  // cards given a face before they move (the nest coming to me, a partner's gift)
  prepFaces(zone, ids) {
    const from = this.cards.filter((c) => c.zone === zone && !c.id).sort((a, b) => a.slot - b.slot);
    ids.forEach((id, i) => from[i]?.setId(id));
  }

  // -------------------------------------------------------------------------------------------
  // input: tap a card, drag it up to play it, hover on a mouse
  // -------------------------------------------------------------------------------------------
  #pick(e) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const meshes = this.cards.filter((c) => c.zone === 'hand-bottom' && c.mesh.visible && c.id).map((c) => c.mesh);
    const hit = this.raycaster.intersectObjects(meshes, false)[0];
    return hit ? hit.object.userData.card : null;
  }
  // which trick pile (seat position) is under the pointer, if any
  #pickPile(e) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const meshes = this.cards.filter((c) => c.zone.startsWith('pile-') && c.mesh.visible).map((c) => c.mesh);
    const hit = this.raycaster.intersectObjects(meshes, false)[0];
    return hit ? hit.object.userData.card.zone.slice(5) : null;
  }

  #bindPointer(el) {
    el.style.touchAction = 'none';
    const playable = (c) => c && this.desc?.interactive && this.desc.legal?.has(c.id);
    el.addEventListener('pointerdown', (e) => {
      if (e.button) return;
      const c = this.#pick(e);
      if (!playable(c)) {
        const pile = this.onPile ? this.#pickPile(e) : null;
        this.pileTap = pile ? { pos: pile, x: e.clientX, y: e.clientY, id: e.pointerId } : null;
        return;
      }
      this.drag = { card: c, x: e.clientX, y: e.clientY, dx: 0, dy: 0, moved: false, id: e.pointerId };
      el.setPointerCapture?.(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      const g = this.drag;
      if (g && g.id === e.pointerId) {
        g.dx = e.clientX - g.x;
        g.dy = e.clientY - g.y;
        if (Math.abs(g.dx) > 8 || Math.abs(g.dy) > 8) g.moved = true;
        if (g.moved && this.desc?.dragPlay) this.#relayoutHand(0);
        return;
      }
      if (e.pointerType !== 'mouse') return;
      const c = this.#pick(e);
      const id = playable(c) ? c.id : null;
      el.style.cursor = id || (this.onPile && this.#pickPile(e)) ? 'pointer' : '';
      if (id !== this.hovered) {
        this.hovered = id;
        this.#relayoutHand(0.16);
        this.#decorate();
      }
    });
    const end = (e, cancel) => {
      const pt = this.pileTap;
      if (pt && pt.id === e.pointerId) {
        this.pileTap = null;
        if (!cancel && Math.hypot(e.clientX - pt.x, e.clientY - pt.y) < 12) this.onPile?.(pt.pos);
        return;
      }
      const g = this.drag;
      if (!g || g.id !== e.pointerId) return;
      this.drag = null;
      const card = g.card;
      const dy = g.dy;
      const dragPlay = this.desc?.dragPlay;
      this.#relayoutHand(0.22);
      if (cancel) return;
      if (g.moved && dragPlay) {
        if (dy < -this.metrics.cw * 1.4 * 0.45) this.onTap?.(card.id);
        return;
      }
      if (!g.moved || !dragPlay) {
        if (!g.moved) this.onTap?.(card.id);
      }
    };
    el.addEventListener('pointerup', (e) => end(e, false));
    el.addEventListener('pointercancel', (e) => end(e, true));
    el.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse' && this.hovered && !this.drag) {
        this.hovered = null;
        this.#relayoutHand(0.16);
        this.#decorate();
      }
    });
  }

  #relayoutHand(dur) {
    const hand = this.cards.filter((c) => c.zone === 'hand-bottom');
    const now = performance.now();
    for (const c of hand) this.#moveTo(c, this.#pose(c, hand.length), dur, 0, now);
    this.dirty = true;
  }

  // -------------------------------------------------------------------------------------------
  // the frame loop: render only while something moves or glows
  // -------------------------------------------------------------------------------------------
  #frame() {
    if (this.dead) return;
    const now = performance.now();
    if (document.hidden) return;
    let active = false;
    for (const c of this.cards) {
      const tw = c.tw;
      if (!tw) continue;
      const m = c.mesh;
      if (now < tw.t0) {
        active = true;
        continue;
      }
      const k = clamp((now - tw.t0) / (tw.end - tw.t0), 0, 1);
      const e = tw.ease(k);
      m.position.lerpVectors(tw.from.p, tw.to.p, e);
      m.position.y += Math.sin(Math.PI * k) * tw.arc;
      m.quaternion.slerpQuaternions(tw.from.q, tw.to.q, e);
      m.scale.setScalar(tw.from.s + (tw.to.s - tw.from.s) * e);
      if (k >= 1) c.tw = null;
      active = true;
    }
    for (const tok of [this.bidToken, this.trumpToken, this.dealerToken]) {
      const tw = tok.userData.tw;
      if (!tw) continue;
      const k = clamp((now - tw.t0) / (tw.end - tw.t0), 0, 1);
      const e = tw.spin ? easeOut(k) : easeInOut(k);
      tok.position.lerpVectors(tw.from.p, tw.to.p, e);
      if (!tw.spin) tok.position.y += Math.sin(Math.PI * k) * tw.arc;
      tok.quaternion.slerpQuaternions(tw.from.q, tw.to.q, e);
      if (tw.spin) tok.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), (1 - e) * Math.PI * 6));
      const pop = tw.from.s < 0.5 ? 1 + Math.sin(Math.PI * k) * 0.25 : 1;
      tok.scale.setScalar((tw.from.s + (tw.to.s - tw.from.s) * e) * pop);
      if (k >= 1) tok.userData.tw = null;
      active = true;
    }
    // pulsing halos (the coach) keep a gentle 30 fps
    let pulsing = false;
    for (const c of this.cards) if (c.halo?.visible && c.halo.material.userData.pulse.value > 0) pulsing = true;
    if (!active && !this.dirty && !(pulsing && now - (this.lastRender || 0) > 33)) return;
    this.dirty = false;
    const t0 = performance.now();
    if (this.pipeline) this.pipeline.render();
    else this.renderer.render(this.scene, this.camera);
    this.lastRender = now;
    this.#adapt(performance.now() - t0, now);
  }

  // drop the resolution on a device that can't keep up
  #adapt(cost, now) {
    const gap = now - (this.prevFrame || now);
    this.prevFrame = now;
    if (gap <= 0 || gap > 200) return;
    this.frameTimes.push(gap);
    if (this.frameTimes.length < 40) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes.length = 0;
    const pr = this.renderer.getPixelRatio();
    if (avg > 40 && pr > 1) {
      this.renderer.setPixelRatio(Math.max(1, pr - 0.5));
      this.resize();
    }
  }
}
