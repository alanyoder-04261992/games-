// Chinese Checkers: the 3D board. A maple star with real holes drilled through its top sits on
// a green felt table under a warm lamp; glassy swirled marbles rest in the holes and arc from
// hole to hole when they jump. The board turns so your own point is nearest you. Everything is
// modelled in code: there are no image or model files.
//
// createScene() has the same small interface as the flat board in board2d.js, so ui.js can
// switch between them (the "3D board" setting):
//   const board = await createScene(container, { onPick, onHover, onHop });
//   board.update(view, prev)    draw a view, animating the move since `prev`
//   board.mark({ selected, targets, path, movable })   highlights for choosing a move
//   board.frame({ top, bottom }) pixels covered by the player list / buttons, kept clear
//   board.destroy()
// It uses the Game Center's shared three.js (public/vendor/three, r187) with WebGPURenderer
// (WebGPU, or WebGL 2 where WebGPU is missing) and TSL node materials: no WebGL-only code.
import * as THREE from '../../vendor/three/three.webgpu.min.js';
import { color, float, mix, mx_noise_float, positionLocal, smoothstep, uniform } from '../../vendor/three/three.tsl.min.js';
import { CELLS, N, layout, turnsFor, camp } from './board.js';
import { COLORS } from './colors.js';

// ---------------------------------------------------------------------
// Measurements. One unit = the distance between two holes. The board lies in the x/z plane
// (+z towards the player), with its centre at the origin.
// ---------------------------------------------------------------------
const R_MARBLE = 0.36;
const R_HOLE = 0.25;
const BASE_H = 0.3; // the solid slab underneath
const PANEL_H = 0.12; // the drilled top panel
const BEVEL = 0.03;
const TOP = BASE_H + PANEL_H + 2 * BEVEL; // the playing surface
const REST = TOP + Math.sqrt(R_MARBLE ** 2 - R_HOLE ** 2) - 0.02; // a marble's centre, sitting in a hole
const HOP_STEP = 0.2; // seconds per step…
const HOP_JUMP = 0.28; // …and per jump
const TEX_SPAN = 20; // board units across the painted texture
const SQ3 = Math.sqrt(3);
const POS = CELLS.map((c) => layout(c.i, 0)); // every hole's x (px) and z (py) on the board

// ---------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------
// The star's outline: six tips and six inner corners, pushed out from the holes by `grow`,
// with rounded corners.
function starShape(grow = 1.2, round = 0.7) {
  const tip = 4 * SQ3 * grow; // the holes' tips are 4√3 from the centre
  const inner = (tip / SQ3);
  const pts = [];
  for (let k = 0; k < 12; k++) {
    const a = (k * Math.PI) / 6 + Math.PI / 2; // start at the bottom tip (+z)
    const r = k % 2 ? inner : tip;
    pts.push(new THREE.Vector2(Math.cos(a) * r, -Math.sin(a) * r)); // shape y = −z
  }
  const s = new THREE.Shape();
  pts.forEach((v, k) => {
    const p = pts[(k + 11) % 12], n = pts[(k + 1) % 12];
    const rr = k % 2 ? round * 0.4 : round;
    const a = v.clone().add(p.clone().sub(v).setLength(rr));
    const b = v.clone().add(n.clone().sub(v).setLength(rr));
    if (k === 0) s.moveTo(a.x, a.y);
    else s.lineTo(a.x, a.y);
    s.quadraticCurveTo(v.x, v.y, b.x, b.y);
  });
  s.closePath();
  return s;
}

function boardGeometries() {
  const base = new THREE.ExtrudeGeometry(starShape(1.24, 0.9), { depth: BASE_H, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.06, bevelSegments: 3, curveSegments: 10 });
  const top = starShape(1.2, 0.8);
  for (const { px, py } of POS) {
    const hole = new THREE.Path();
    hole.absarc(px, -py, R_HOLE, 0, Math.PI * 2, true);
    top.holes.push(hole);
  }
  const panel = new THREE.ExtrudeGeometry(top, { depth: PANEL_H, bevelEnabled: true, bevelThickness: BEVEL, bevelSize: 0.03, bevelSegments: 2, curveSegments: 14 });
  // lay them flat: shape x → x, shape y → −z, extrusion → +y
  base.rotateX(-Math.PI / 2);
  panel.rotateX(-Math.PI / 2).translate(0, BASE_H + BEVEL, 0);
  return { base, panel };
}

// ---------------------------------------------------------------------
// The painted top: maple grain, each player's point tinted in their colour, an inlaid star
// outline and a darker ring around every hole. Drawn on a canvas in board coordinates.
// ---------------------------------------------------------------------
function paintBoard(canvas, homes) {
  const W = canvas.width;
  const g = canvas.getContext('2d');
  const X = (px) => (px / TEX_SPAN + 0.5) * W;
  let seed = 11;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const grad = g.createLinearGradient(0, 0, W, W);
  grad.addColorStop(0, '#e8c48e');
  grad.addColorStop(0.55, '#d5a466');
  grad.addColorStop(1, '#b57b40');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, W);
  // grain: long wavy streaks across the board
  for (let i = 0; i < 420; i++) {
    const y = rand() * W;
    const amp = 2 + rand() * 9;
    const freq = (0.5 + rand() * 2.5) / W * Math.PI * 2;
    const phase = rand() * 6;
    g.strokeStyle = rand() < 0.7 ? `rgba(110,62,20,${0.04 + rand() * 0.12})` : `rgba(255,236,200,${0.04 + rand() * 0.08})`;
    g.lineWidth = 0.8 + rand() * 3;
    g.beginPath();
    for (let x = -20; x <= W + 20; x += 24) g.lineTo(x, y + Math.sin(x * freq + phase) * amp);
    g.stroke();
  }
  // each player's home point, tinted
  homes.forEach((p, seat) => {
    const cells = camp(p).map((i) => POS[i]);
    const cx = cells.reduce((t, q) => t + q.px, 0) / cells.length;
    const cy = cells.reduce((t, q) => t + q.py, 0) / cells.length;
    const far = cells.map((q) => [q, Math.hypot(q.px - cx, q.py - cy)]).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([q]) => q);
    g.beginPath();
    far.forEach((q, k) => g[k ? 'lineTo' : 'moveTo'](X(cx + (q.px - cx) * 1.45), X(cy + (q.py - cy) * 1.45)));
    g.closePath();
    g.lineJoin = 'round';
    g.fillStyle = COLORS[seat].hex + '55';
    g.fill();
    g.lineWidth = W / 300;
    g.strokeStyle = COLORS[seat].dark + 'aa';
    g.stroke();
  });
  // the inlaid star: two big triangles, a dark line with a light edge
  for (const [dark, w, off] of [['rgba(70,36,10,0.55)', W / 400, 0], ['rgba(255,240,210,0.25)', W / 900, W / 500]]) {
    g.strokeStyle = dark;
    g.lineWidth = w;
    for (const flip of [1, -1]) {
      g.beginPath();
      for (let k = 0; k < 3; k++) {
        const a = Math.PI / 2 + (k * 2 * Math.PI) / 3;
        const r = 4 * SQ3 * 1.1;
        g[k ? 'lineTo' : 'moveTo'](X(Math.cos(a) * r) + off, X(flip * Math.sin(a) * r) + off);
      }
      g.closePath();
      g.stroke();
    }
  }
  // a dark ring round each hole: end grain where it was drilled
  for (const { px, py } of POS) {
    const r = (R_HOLE / TEX_SPAN) * W;
    const ring = g.createRadialGradient(X(px), X(py), r * 0.95, X(px), X(py), r * 1.5);
    ring.addColorStop(0, 'rgba(70,35,10,0.7)');
    ring.addColorStop(1, 'rgba(70,35,10,0)');
    g.fillStyle = ring;
    g.beginPath();
    g.arc(X(px), X(py), r * 1.5, 0, Math.PI * 2);
    g.fill();
  }
}

// ---------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------
// a glass marble with a coloured swirl inside: two layers of noise mix the colour with a paler
// and a darker shade, under a glossy clear coat
function marbleMaterial(c) {
  const m = new THREE.MeshPhysicalNodeMaterial({ roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.04, metalness: 0 });
  const swirl = mx_noise_float(positionLocal.mul(2.6)).mul(0.5).add(0.5); // broad ribbons…
  const fine = mx_noise_float(positionLocal.mul(6.5).add(3.1)).mul(0.5).add(0.5); // …and thinner streaks
  const base = mix(color(new THREE.Color(c.hex)), color(new THREE.Color(c.light)), smoothstep(0.55, 0.8, swirl).mul(0.6));
  m.colorNode = mix(base, color(new THREE.Color(c.dark)), smoothstep(0.6, 0.85, fine).mul(0.4));
  return m;
}

// A dim room with a lamp overhead; never shown, only turned into an environment map so the
// marbles and the varnish have something warm to reflect.
function lampRoom() {
  const room = new THREE.Scene();
  const glow = (hex, k) => new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(hex).multiplyScalar(k) });
  const walls = new THREE.Mesh(new THREE.BoxGeometry(30, 14, 30), new THREE.MeshBasicNodeMaterial({ color: '#2a3328', side: THREE.BackSide }));
  walls.position.y = 6;
  const lamp = new THREE.Mesh(new THREE.CircleGeometry(3, 32), glow('#ffe2b8', 8));
  lamp.position.set(-1, 12.8, 2);
  lamp.rotation.x = Math.PI / 2;
  const pane = new THREE.Mesh(new THREE.PlaneGeometry(6, 3), glow('#c4d6ff', 2));
  pane.position.set(-14.9, 6, -3);
  pane.rotation.y = Math.PI / 2;
  const sheen = new THREE.Mesh(new THREE.PlaneGeometry(14, 4), glow('#ffe9cc', 1.2));
  sheen.position.set(0, 7, 14.9);
  sheen.rotation.y = Math.PI;
  const table = new THREE.Mesh(new THREE.PlaneGeometry(30, 30).rotateX(-Math.PI / 2), new THREE.MeshBasicNodeMaterial({ color: '#1f3a2a' }));
  table.position.y = 0.01;
  room.add(walls, lamp, pane, sheen, table);
  return room;
}

// ---------------------------------------------------------------------
// The scene
// ---------------------------------------------------------------------
export async function createScene(container, { onPick, onHover, onHop }) {
  // WebGPU if the browser offers an adapter, otherwise WebGL 2 (choosing ourselves keeps the
  // console free of the fallback warning)
  const adapter = navigator.gpu ? await navigator.gpu.requestAdapter().catch(() => null) : null;
  const renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL: !adapter });
  try {
    await renderer.init();
  } catch (err) {
    renderer.dispose();
    throw err;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const el = renderer.domElement;
  el.className = 'cc-gl';
  container.append(el);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#0d1c14');
  scene.fog = new THREE.Fog('#0d1c14', 30, 60);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = lampRoom();
  const envMap = pmrem.fromScene(room, 0.035).texture;
  scene.environment = envMap;
  scene.environmentIntensity = 0.75;
  room.traverse((o) => o.isMesh && (o.geometry.dispose(), o.material.dispose()));

  const camera = new THREE.PerspectiveCamera(32, 1, 0.5, 120);

  // ---------- lights ----------
  scene.add(new THREE.HemisphereLight('#fff1dc', '#13261b', 0.5));
  const lamp = new THREE.SpotLight('#ffe0b5', 1500, 0, 0.6, 0.8, 2);
  lamp.position.set(-3, 17, 7);
  lamp.target.position.set(0, 0, 0);
  lamp.castShadow = true;
  lamp.shadow.mapSize.set(2048, 2048);
  lamp.shadow.camera.near = 8;
  lamp.shadow.camera.far = 30;
  lamp.shadow.bias = -0.0003;
  lamp.shadow.normalBias = 0.02;
  lamp.shadow.radius = 4;
  scene.add(lamp, lamp.target);
  const rim = new THREE.DirectionalLight('#cfe0ff', 0.45);
  rim.position.set(8, 6, -10);
  scene.add(rim);

  // ---------- the felt table ----------
  const felt = new THREE.MeshStandardNodeMaterial({ roughness: 0.95 });
  felt.colorNode = color(new THREE.Color('#244a35')).mul(mx_noise_float(positionLocal.mul(9)).mul(0.08).add(1)).mul(mx_noise_float(positionLocal.mul(0.25)).mul(0.12).add(1));
  const table = new THREE.Mesh(new THREE.CircleGeometry(40, 64).rotateX(-Math.PI / 2), felt);
  table.receiveShadow = true;
  scene.add(table);

  // ---------- the board (it turns so your point is nearest you) ----------
  const boardGroup = new THREE.Group();
  scene.add(boardGroup);
  const { base, panel } = boardGeometries();
  // the painted top is a fresh canvas texture whenever the seating changes (re-uploading one
  // canvas in place makes WebGPU complain)
  const paintTexture = (homes) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 2048;
    paintBoard(canvas, homes);
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    t.repeat.set(1 / TEX_SPAN, 1 / TEX_SPAN);
    t.offset.set(0.5, 0.5);
    return t;
  };
  let tex = paintTexture([]);
  const maple = new THREE.MeshPhysicalNodeMaterial({ map: tex, roughness: 0.5, clearcoat: 0.55, clearcoatRoughness: 0.25 });
  const baseWood = new THREE.MeshPhysicalNodeMaterial({ color: '#7a4a22', roughness: 0.6, clearcoat: 0.3, clearcoatRoughness: 0.35 });
  baseWood.colorNode = color(new THREE.Color('#6e4020')).mul(mx_noise_float(positionLocal.mul(new THREE.Vector3(0.6, 14, 0.6))).mul(0.12).add(1));
  const baseMesh = new THREE.Mesh(base, baseWood);
  const panelMesh = new THREE.Mesh(panel, maple);
  baseMesh.castShadow = baseMesh.receiveShadow = true;
  panelMesh.castShadow = panelMesh.receiveShadow = true;
  boardGroup.add(baseMesh, panelMesh);
  let painted = '';
  function repaint(homes) {
    const key = homes.join(',');
    if (key === painted) return;
    painted = key;
    const old = tex;
    tex = maple.map = paintTexture(homes);
    old.dispose();
  }

  // ---------- marbles ----------
  const marbleGeo = new THREE.SphereGeometry(R_MARBLE, 40, 28);
  const marbleMats = COLORS.map(marbleMaterial);
  const marbleGroup = new THREE.Group();
  boardGroup.add(marbleGroup);
  function makeMarble(seat) {
    const m = new THREE.Mesh(marbleGeo, marbleMats[seat]);
    m.castShadow = m.receiveShadow = true;
    m.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6); // each swirl different
    m.userData.seat = seat;
    marbleGroup.add(m);
    return m;
  }

  // ---------- highlights ----------
  const pulse = uniform(0); // 0…1, breathing
  const glowMat = (hex, k, min = 0.55) => {
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    m.colorNode = color(new THREE.Color(hex).multiplyScalar(k));
    m.opacityNode = pulse.mul(1 - min).add(min);
    return m;
  };
  const targetMat = glowMat('#fff2b0', 1.6, 0.5);
  const onMat = new THREE.MeshBasicNodeMaterial({ color: new THREE.Color('#ffffff').multiplyScalar(2) });
  const ringMat = glowMat('#fff3c4', 1.4, 0.35);
  const movableMat = glowMat('#fff3c4', 1, 0.15);
  const dotGeo = new THREE.CircleGeometry(0.17, 24).rotateX(-Math.PI / 2);
  const viaGeo = new THREE.SphereGeometry(0.08, 12, 8);
  const ringGeo = new THREE.TorusGeometry(R_MARBLE + 0.07, 0.035, 8, 40).rotateX(Math.PI / 2);
  const marks = new THREE.Group();
  boardGroup.add(marks);
  const trailMat = new THREE.MeshBasicNodeMaterial({ transparent: true, opacity: 0.55, depthWrite: false, color: '#fff' });
  const trailDotGeo = new THREE.CircleGeometry(0.07, 12).rotateX(-Math.PI / 2);
  const trail = new THREE.Group();
  boardGroup.add(trail);


  // ---------------------------------------------------------------------
  // State and animation
  // ---------------------------------------------------------------------
  let view = null;
  const grid = new Map(); // hole → marble mesh
  let anim = null; // the marble hopping right now
  let selected = null;
  let spin = 0; // the board's turn, eased towards spinTo
  let spinTo = 0;

  const at = (i) => POS[i];
  const isJump = (a, b) => {
    const p = CELLS[a], q = CELLS[b];
    return Math.max(Math.abs(p.x - q.x), Math.abs(p.y - q.y), Math.abs(p.z - q.z)) > 1;
  };

  function hop(mesh, path) {
    const jump = path.length > 2 || isJump(path[0], path[1]);
    anim = { mesh, path, t: 0, per: jump ? HOP_JUMP : HOP_STEP, height: jump ? 0.95 : 0.35, landed: 0 };
  }
  function stepAnim(dt) {
    if (!anim) return;
    const a = anim;
    a.t += dt / a.per;
    const legs = a.path.length - 1;
    while (a.landed < Math.min(legs, Math.floor(a.t))) (a.landed++, onHop?.());
    if (a.t >= legs) {
      const p = at(a.path[legs]);
      a.mesh.position.set(p.px, REST, p.py);
      anim = null;
      return;
    }
    const leg = Math.floor(a.t), u = a.t - leg;
    const p = at(a.path[leg]), q = at(a.path[leg + 1]);
    const e = u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u);
    a.mesh.position.set(p.px + (q.px - p.px) * e, REST + Math.sin(Math.PI * u) * a.height, p.py + (q.py - p.py) * e);
    a.mesh.rotation.z -= dt * 9; // rolling through the air
  }
  function finishAnim() {
    if (!anim) return;
    const p = at(anim.path[anim.path.length - 1]);
    anim.mesh.position.set(p.px, REST, p.py);
    anim = null;
  }

  function drawTrail(last) {
    trail.clear();
    if (!last?.path) return;
    // little dots along the hops, and the hole it came from
    for (let k = 0; k < last.path.length - 1; k++) {
      const p = at(last.path[k]), q = at(last.path[k + 1]);
      const steps = Math.round(Math.hypot(q.px - p.px, q.py - p.py) / 0.35);
      for (let s = k === 0 ? 1 : 0; s < steps; s++) {
        const u = s / steps;
        const d = new THREE.Mesh(trailDotGeo, trailMat);
        d.position.set(p.px + (q.px - p.px) * u, TOP + 0.01, p.py + (q.py - p.py) * u);
        trail.add(d);
      }
    }
    const ring = new THREE.Mesh(ringGeo, trailMat);
    const f = at(last.from);
    ring.position.set(f.px, TOP + 0.02, f.py);
    ring.scale.setScalar(0.7);
    trail.add(ring);
  }

  function update(next, prev) {
    finishAnim();
    repaint(next.homes);
    spinTo = (-turnsFor(next.seat != null ? next.homes[next.seat] : null) * Math.PI) / 3;
    const fresh = !view || view.seat !== next.seat || view.n !== next.n;
    if (fresh) spin = spinTo; // no spinning when you first sit down
    const moved = prev && !fresh && next.moves === prev.moves + 1 && next.last?.path ? next.last : null;
    const keep = new Map();
    for (let i = 0; i < N; i++) {
      const seat = next.board[i];
      if (seat == null) continue;
      let m = moved && i === moved.to ? grid.get(moved.from) : grid.get(i);
      if (!m || m.userData.seat !== seat) m = makeMarble(seat);
      keep.set(i, m);
    }
    const kept = new Set(keep.values());
    for (const m of grid.values()) if (!kept.has(m)) marbleGroup.remove(m);
    grid.clear();
    for (const [i, m] of keep) {
      grid.set(i, m);
      const p = at(i);
      m.position.set(p.px, REST, p.py);
    }
    view = next;
    drawTrail(next.last);
    if (moved) {
      const m = grid.get(moved.to);
      const p = at(moved.from);
      m.position.set(p.px, REST, p.py);
      hop(m, moved.path);
    }
  }

  function mark({ selected: sel = null, targets = [], path = null, movable = [] } = {}) {
    marks.clear();
    selected = sel;
    const on = path ? path[path.length - 1] : null;
    for (const i of targets) {
      const d = new THREE.Mesh(dotGeo, i === on ? onMat : targetMat);
      const p = at(i);
      d.position.set(p.px, TOP + 0.015, p.py);
      if (i === on) d.scale.setScalar(1.3);
      marks.add(d);
    }
    if (path)
      for (const i of path.slice(1, -1)) {
        const b = new THREE.Mesh(viaGeo, onMat);
        const p = at(i);
        b.position.set(p.px, TOP + 0.12, p.py);
        marks.add(b);
      }
    for (const i of movable) {
      const r = new THREE.Mesh(ringGeo, movableMat);
      const p = at(i);
      r.position.set(p.px, TOP + 0.03, p.py);
      marks.add(r);
    }
    if (sel != null) {
      const r = new THREE.Mesh(ringGeo, ringMat);
      const p = at(sel);
      r.position.set(p.px, TOP + 0.03, p.py);
      r.scale.setScalar(1.12);
      marks.add(r);
    }
    for (const [i, m] of grid) if (i !== sel && m !== anim?.mesh) m.position.y = REST;
  }

  // ---------------------------------------------------------------------
  // Camera: looks down at the board from your side, fitted to the space the player list and
  // buttons leave; sways a little and can be dragged round (it drifts back after a while).
  // ---------------------------------------------------------------------
  const look = new THREE.Vector3(0, 0.3, 0.4);
  let insets = { top: 0, bottom: 0 };
  let fitDist = 30;
  let dist = 0;
  let zoom = 1;
  let dragYaw = 0;
  let dragPitch = 0;
  let idle = 99;
  let basePitch = 0.98; // radians above the table (steeper on a tall phone screen)
  function fitCamera(w, h) {
    camera.aspect = w / h;
    basePitch = camera.aspect < 0.8 ? 1.2 : 0.98;
    const shift = (insets.top - insets.bottom) / 2;
    camera.setViewOffset(w, h, 0, -shift, w, h);
    camera.updateProjectionMatrix();
    const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const availH = Math.max(h * 0.45, h - insets.top - insets.bottom - 8);
    // the board seen at an angle: about 17 units across, and its 19 units of depth foreshortened
    const halfH = 7.1 * (0.45 + 0.55 * Math.sin(basePitch) / Math.sin(0.98));
    const byHeight = (halfH / t) * (h / availH);
    const byWidth = (8.4 / (t * camera.aspect)) * (w / Math.max(1, w - 16));
    fitDist = Math.max(byHeight, byWidth);
    if (!dist) dist = fitDist;
  }
  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    fitCamera(w, h);
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  // Compile every shader now, while the page shows "Setting up the board…".
  const standIns = [...marbleMats, targetMat, onMat, ringMat, movableMat, trailMat].map((m, k) => {
    const s = new THREE.Mesh(marbleGeo, m);
    s.position.set(k - 5, REST, 0);
    scene.add(s);
    return s;
  });
  placeCamera(0, 0);
  await renderer.compileAsync(scene, camera);
  standIns.forEach((s) => scene.remove(s));

  function placeCamera(dt, t) {
    idle += dt;
    if (idle > 4) {
      const k = Math.exp(-dt * 0.7);
      dragYaw *= k;
      dragPitch *= k;
    }
    const yaw = Math.sin(t * 0.13) * 0.045 + dragYaw;
    const pitch = THREE.MathUtils.clamp(basePitch + Math.sin(t * 0.09) * 0.02 + dragPitch, 0.35, 1.45);
    if (dt) dist += (fitDist * zoom - dist) * (1 - Math.exp(-dt * 5));
    else dist = fitDist * zoom;
    camera.position.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(dist).add(look);
    camera.lookAt(look);
    // a phone's tall screen puts the camera far back: keep the fog behind the board
    scene.fog.near = dist + 8;
    scene.fog.far = dist + 40;
  }

  // ---------------------------------------------------------------------
  // Pointer and touch. Tapping a hole picks it (ui.js decides what that means). Dragging turns
  // the view, two fingers or the mouse wheel zoom. A mouse also reports the hole under it, so the
  // path of a jump shows before you click.
  // ---------------------------------------------------------------------
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -TOP);
  const hit = new THREE.Vector3();
  function holeAt(ev) {
    const rect = el.getBoundingClientRect();
    ndc.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    // a marble's top first (they stand proud of the board), then the board surface
    const hits = ray.intersectObjects(marbleGroup.children, false);
    if (hits.length) for (const [i, m] of grid) if (m === hits[0].object) return i;
    if (!ray.ray.intersectPlane(plane, hit)) return null;
    boardGroup.worldToLocal(hit);
    let best = null, bestD = 0.55;
    for (let i = 0; i < N; i++) {
      const d = Math.hypot(POS[i].px - hit.x, POS[i].py - hit.z);
      if (d < bestD) [best, bestD] = [i, d];
    }
    return best;
  }
  const pointers = new Map();
  let gesture = null;
  const spread = () => {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y) || 1;
  };
  function onDown(ev) {
    el.setPointerCapture?.(ev.pointerId);
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pointers.size === 2) gesture = { mode: 'zoom', spread: spread(), zoom };
    else if (pointers.size === 1) gesture = { mode: 'tap', x0: ev.clientX, y0: ev.clientY, x: ev.clientX, y: ev.clientY };
  }
  function onMove(ev) {
    const p = pointers.get(ev.pointerId);
    if (p) (p.x = ev.clientX), (p.y = ev.clientY);
    if (!gesture) {
      if (ev.pointerType === 'mouse') onHover(holeAt(ev));
      return;
    }
    if (gesture.mode === 'tap' && Math.hypot(ev.clientX - gesture.x0, ev.clientY - gesture.y0) > 8) gesture.mode = 'turn';
    if (gesture.mode === 'turn' && p) {
      dragYaw = THREE.MathUtils.clamp(dragYaw - (ev.clientX - gesture.x) * 0.005, -1.2, 1.2);
      dragPitch = THREE.MathUtils.clamp(dragPitch + (ev.clientY - gesture.y) * 0.004, -0.55, 0.45);
      gesture.x = ev.clientX;
      gesture.y = ev.clientY;
      idle = 0;
    } else if (gesture.mode === 'zoom' && pointers.size === 2) {
      zoom = THREE.MathUtils.clamp(gesture.zoom * (gesture.spread / spread()), 0.55, 1.4);
      idle = 0;
    }
  }
  function onUp(ev) {
    pointers.delete(ev.pointerId);
    const g = gesture;
    if (pointers.size === 0) gesture = null;
    if (g?.mode === 'tap' && ev.type === 'pointerup') {
      const i = holeAt(ev);
      if (i != null) onPick(i);
      if (ev.pointerType === 'mouse') onHover(holeAt(ev));
    }
  }
  const onLeave = (ev) => ev.pointerType === 'mouse' && !gesture && onHover(null);
  const onWheel = (ev) => {
    ev.preventDefault();
    zoom = THREE.MathUtils.clamp(zoom * Math.exp(ev.deltaY * 0.001), 0.55, 1.4);
  };
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
  el.addEventListener('pointerleave', onLeave);
  el.addEventListener('wheel', onWheel, { passive: false });

  // ---------------------------------------------------------------------
  // The frame loop
  // ---------------------------------------------------------------------
  const timer = new THREE.Timer();
  timer.connect(document);
  renderer.setAnimationLoop((now) => {
    timer.update(now);
    const dt = Math.min(timer.getDelta(), 0.1);
    const t = timer.getElapsed();
    stepAnim(dt);
    // the board turns the short way round to its new heading
    let d = spinTo - spin;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    spin += d * (1 - Math.exp(-dt * 3));
    boardGroup.rotation.y = spin;
    // the picked-up marble floats and bobs
    if (selected != null) {
      const m = grid.get(selected);
      if (m && m !== anim?.mesh) m.position.y = REST + 0.28 + Math.sin(t * 4) * 0.05;
    }
    pulse.value = 0.5 + 0.5 * Math.sin(t * 4.5);
    placeCamera(dt, t);
    renderer.render(scene, camera);
  });

  return {
    update,
    mark,
    frame(next) {
      insets = next;
      resize();
    },
    destroy() {
      renderer.setAnimationLoop(null);
      ro.disconnect();
      timer.dispose();
      for (const [type, fn] of [['pointerdown', onDown], ['pointermove', onMove], ['pointerup', onUp], ['pointercancel', onUp], ['pointerleave', onLeave], ['wheel', onWheel]]) el.removeEventListener(type, fn);
      const seen = new Set();
      scene.traverse((o) => {
        if (!o.isMesh) return;
        for (const thing of [o.geometry, o.material, o.material.map]) if (thing && !seen.has(thing)) (seen.add(thing), thing.dispose());
      });
      for (const thing of [...marbleMats, targetMat, onMat, ringMat, movableMat, trailMat, dotGeo, viaGeo, ringGeo, trailDotGeo, marbleGeo, tex]) thing.dispose();
      envMap.dispose();
      pmrem.dispose();
      renderer.dispose();
      el.remove();
    },
  };
}
