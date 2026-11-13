// Four in a Row: the 3D board. A blue plastic rack with round holes stands on a wooden table
// under a warm lamp. Glossy ridged discs drop down their column with gravity and bounce, the
// winning four light up, and at a new game the slider under the rack opens and the discs fall
// out onto the table. Everything is modelled in code: there are no image or model files.
//
// How a 3D board plugs into a Game Center game
// --------------------------------------------
// * ui.js runs the game: it reads each state message, knows whose turn it is and sends moves.
//   This file only draws. createScene() has the same small interface as the flat board in
//   board2d.js, so ui.js can switch between them (the "3D board" setting):
//     const board = await createScene(container, { onHover, onPick, onLand, canPick });
//     board.update(view, prev)    draw a view, animating what changed since `prev`
//     board.preview(col, seat)    the disc hovering over a column (col null = hide it)
//     board.frame({ top, bottom }) pixels covered by the player list / buttons, kept clear
//     board.destroy()
// * three.js is the Game Center's shared copy (public/vendor/three, r187). We use
//   WebGPURenderer, which draws with WebGPU where the browser has it and with WebGL 2
//   everywhere else, and TSL (three's shading language, compiled to WGSL or GLSL to match) for
//   the custom shading. Don't use WebGL-only things here (ShaderMaterial, onBeforeCompile,
//   WebGLRenderer, the WebGL post-processing add-ons): they don't work with WebGPURenderer.
import * as THREE from '../../vendor/three/three.webgpu.min.js';
import { color, float, length, mix, mx_noise_float, positionLocal, sin, smoothstep, uniform } from '../../vendor/three/three.tsl.min.js';

const COLS = 7;
const ROWS = 6;

// ---------------------------------------------------------------------
// Measurements. One unit = the distance between two holes.
// The rack stands upright in the x/y plane, facing +z (towards the player); the discs slide
// down the gap between its front and back panels, at z = 0.
// ---------------------------------------------------------------------
const R_DISC = 0.47; // disc radius
const HALF = 0.13; // half the disc's thickness
const R_HOLE = 0.4; // smaller than the disc, so the rack holds it
const GAP = HALF + 0.02; // inner face of each panel
const PANEL = 0.08; // panel thickness, plus a bevel of BEVEL on each side
const BEVEL = 0.03;
const FACE = GAP + PANEL + 2 * BEVEL; // outer face of each panel
const MARGIN = 0.4; // plastic beyond the outer columns
const HALF_W = COLS / 2 + MARGIN; // half the rack's width
const FLOOR = 1.05; // height of the slider the bottom discs rest on
const TOP_Y = FLOOR + ROWS + 0.95; // where the preview disc hovers
const GRAVITY = 70; // units per second²: a drop down the whole column takes about half a second
const RED = new THREE.Color('#e0362b');
const GOLD = new THREE.Color('#fcd024');

const cellX = (c) => c - (COLS - 1) / 2;
const cellY = (r) => FLOOR + R_DISC + (ROWS - 1 - r); // row 0 is the top row, as in the engine

// what the camera keeps in view: the rack from the table up to the preview disc
const FIT_W = 2 * HALF_W + 0.9;
const FIT_H = TOP_Y + R_DISC + 0.3;

// ---------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------
function roundedRect(x, y, w, h, r) {
  const s = new THREE.Shape();
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

// a box with softly rounded edges, centred on the origin
function roundedBox(w, h, d, r) {
  const geo = new THREE.ExtrudeGeometry(roundedRect(-w / 2 + r, -h / 2 + r, w - 2 * r, h - 2 * r, Math.min(w, h) * 0.12), {
    depth: d - 2 * r,
    bevelEnabled: true,
    bevelThickness: r,
    bevelSize: r,
    bevelSegments: 3,
    curveSegments: 6,
  });
  return geo.translate(0, 0, -(d - 2 * r) / 2);
}

// one face of the rack: a rounded slab with a hole for every cell
function panelGeometry() {
  const bottom = FLOOR - 0.24;
  const top = cellY(0) + 0.66;
  const shape = roundedRect(-HALF_W, bottom, 2 * HALF_W, top - bottom, 0.3);
  for (let c = 0; c < COLS; c++)
    for (let r = 0; r < ROWS; r++) {
      const hole = new THREE.Path();
      hole.absarc(cellX(c), cellY(r), R_HOLE, 0, Math.PI * 2, true);
      shape.holes.push(hole);
    }
  return new THREE.ExtrudeGeometry(shape, { depth: PANEL, bevelEnabled: true, bevelThickness: BEVEL, bevelSize: 0.025, bevelSegments: 3, curveSegments: 28 });
}

// A disc, turned on a lathe: a recessed centre, a raised inner ring, a grooved band, a raised
// lip and a ridged edge, like real checkers. The lathe spins around y; we turn it to face +z.
function discGeometry() {
  const face = [[0, 0.105], [0.17, 0.105], [0.19, 0.13], [0.235, 0.13], [0.255, 0.112], [0.415, 0.112], [0.445, 0.124], [0.462, 0.112], [R_DISC, 0.085]];
  const profile = [...face.map(([x, y]) => new THREE.Vector2(x, -y)), ...face.reverse().map(([x, y]) => new THREE.Vector2(x, y))];
  const geo = new THREE.LatheGeometry(profile, 160);
  // ridges around the edge: push the rim in and out 40 times around the circle
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    if (Math.hypot(x, z) < R_DISC - 0.001) continue;
    const k = 1 + 0.012 * Math.cos(Math.atan2(x, z) * 40);
    pos.setXYZ(i, x * k, pos.getY(i), z * k);
  }
  geo.computeVertexNormals();
  return geo.rotateX(Math.PI / 2);
}

// ---------------------------------------------------------------------
// Materials. Node materials take the usual options (color, roughness…) and can also take TSL
// nodes: small shader programs written in JavaScript, like colorNode or roughnessNode below.
// ---------------------------------------------------------------------

// moulded blue plastic: faint mottling so the big faces aren't flat, and a slightly uneven gloss
function plasticMaterial(hex) {
  const m = new THREE.MeshPhysicalNodeMaterial({ clearcoat: 0.8, clearcoatRoughness: 0.18 });
  const mottle = mx_noise_float(positionLocal.mul(2.2)); // -1…1, changes slowly across the panel
  const grain = mx_noise_float(positionLocal.mul(45)); // fine speckle
  m.colorNode = color(new THREE.Color(hex)).mul(mottle.mul(0.05).add(1));
  m.roughnessNode = grain.mul(0.05).add(0.34);
  return m;
}

// glossy disc plastic with fine moulded grooves on the band of each face. `shine` (a uniform:
// a value JavaScript sets each frame) makes a disc glow when it is part of the winning four.
function discMaterial(base, shine) {
  const m = new THREE.MeshPhysicalNodeMaterial({ clearcoat: 1, clearcoatRoughness: 0.08 });
  const r = length(positionLocal.xy); // distance from the disc's centre
  const band = smoothstep(0.25, 0.27, r).mul(float(1).sub(smoothstep(0.4, 0.42, r)));
  const groove = sin(r.mul((Math.PI * 2) / 0.017)).mul(0.5).add(0.5).mul(band);
  m.colorNode = color(base).mul(float(1).sub(groove.mul(0.16)));
  m.roughnessNode = groove.mul(0.22).add(0.2);
  if (shine) m.emissiveNode = color(base).mul(0.45).add(0.06).mul(shine);
  return m;
}

// a varnished plank table top, painted on a canvas (it tiles left-right and top-bottom)
function woodTexture() {
  const W = 1024, H = 512, PLANKS = 4;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const ph = H / PLANKS;
  ['#7d4f2c', '#6c4326', '#87582f', '#744a29'].forEach((tint, p) => {
    const y0 = p * ph;
    g.fillStyle = tint;
    g.fillRect(0, y0, W, ph);
    // grain: long wavy streaks along the plank (whole waves across the width, so it tiles)
    for (let i = 0; i < 110; i++) {
      const y = y0 + rand() * ph;
      const amp = 1 + rand() * 5;
      const freq = ((1 + Math.floor(rand() * 3)) * Math.PI * 2) / W;
      const phase = rand() * 6;
      const dark = rand() < 0.65;
      g.strokeStyle = dark ? `rgba(38,18,6,${0.05 + rand() * 0.14})` : `rgba(255,214,160,${0.03 + rand() * 0.06})`;
      g.lineWidth = 0.6 + rand() * 2.4;
      g.beginPath();
      for (let x = 0; x <= W; x += 16) g.lineTo(x, y + Math.sin(x * freq + phase) * amp);
      g.stroke();
    }
    // a knot or two
    for (let k = rand() < 0.6 ? 1 : 0; k > 0; k--) {
      const kx = 80 + rand() * (W - 160), ky = y0 + ph * (0.3 + rand() * 0.4);
      for (let ring = 9; ring > 0; ring--) {
        g.strokeStyle = `rgba(40,18,6,${0.1 + (9 - ring) * 0.03})`;
        g.lineWidth = 1.5;
        g.beginPath();
        g.ellipse(kx, ky, ring * 6, ring * 2.2, 0, 0, Math.PI * 2);
        g.stroke();
      }
    }
    // the seam between planks
    g.fillStyle = 'rgba(18,8,2,0.8)';
    g.fillRect(0, y0, W, 3);
    g.fillStyle = 'rgba(255,225,180,0.1)';
    g.fillRect(0, y0 + 3, W, 1);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

// A dim room with a bright lamp over the table and a window off to the left. It is never shown:
// it is turned into an environment map, so the glossy plastic has something warm to reflect.
function lampRoom() {
  const room = new THREE.Scene();
  const glow = (hex, k) => new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(hex).multiplyScalar(k) });
  const walls = new THREE.Mesh(new THREE.BoxGeometry(24, 14, 24), new THREE.MeshBasicNodeMaterial({ color: '#3a2618', side: THREE.BackSide }));
  walls.position.y = 6;
  const lamp = new THREE.Mesh(new THREE.CircleGeometry(2.4, 32), glow('#ffe2b8', 9));
  lamp.position.set(-1.5, 12.8, 3);
  lamp.rotation.x = Math.PI / 2;
  const pane = new THREE.Mesh(new THREE.PlaneGeometry(5, 3), glow('#c4d6ff', 2.2));
  pane.position.set(-11.9, 6, -3);
  pane.rotation.y = Math.PI / 2;
  // a broad, soft glow behind the player: the long sheen across the rack's face
  const sheen = new THREE.Mesh(new THREE.PlaneGeometry(12, 4), glow('#ffe9cc', 1.4));
  sheen.position.set(0, 7, 11.9);
  sheen.rotation.y = Math.PI;
  const table = new THREE.Mesh(new THREE.PlaneGeometry(24, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicNodeMaterial({ color: '#5a3820' }));
  table.position.y = 0.01;
  room.add(walls, lamp, pane, sheen, table);
  return room;
}

// ---------------------------------------------------------------------
// The scene
// ---------------------------------------------------------------------
export async function createScene(container, { onHover, onPick, onLand, canPick }) {
  // Choose the backend ourselves: WebGPU if the browser offers an adapter, otherwise WebGL 2.
  // (WebGPURenderer can fall back on its own, but it logs a warning when it does.)
  const adapter = navigator.gpu ? await navigator.gpu.requestAdapter().catch(() => null) : null;
  const renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL: !adapter });
  try {
    await renderer.init(); // rejects if the device has neither WebGPU nor WebGL 2
  } catch (err) {
    renderer.dispose();
    throw err;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.NeutralToneMapping; // keeps the red and gold true
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // soft edges come from light.shadow.radius
  const el = renderer.domElement;
  el.className = 'f4-gl';
  container.append(el);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#140b06');
  scene.fog = new THREE.Fog('#140b06', 22, 42);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = lampRoom();
  const envMap = pmrem.fromScene(room, 0.035).texture;
  scene.environment = envMap;
  scene.environmentIntensity = 0.8;
  room.traverse((o) => o.isMesh && (o.geometry.dispose(), o.material.dispose()));

  const camera = new THREE.PerspectiveCamera(34, 1, 0.5, 80);
  // camera state; placeCamera() below moves it every frame
  const look = new THREE.Vector3(0, FIT_H / 2, 0); // the point it circles and looks at
  let insets = { top: 0, bottom: 0 }; // pixels covered by the player list and the buttons
  let fitDist = 20; // how far away the whole rack fits on screen
  let dist = 0;
  let zoom = 1; // pinch or mouse wheel
  let dragYaw = 0; // how far the player has dragged it round…
  let dragPitch = 0; // …and up or down
  let idle = 99; // seconds since the last drag

  // ---------- lights: a warm lamp overhead, a dim fill, a cool rim from behind ----------
  scene.add(new THREE.HemisphereLight('#ffe7c7', '#2a180c', 0.45));
  const lamp = new THREE.SpotLight('#ffdcae', 1100, 0, 0.55, 0.85, 2);
  lamp.position.set(-2.5, 10, 14); // high and in front, so light reaches the discs through the holes
  lamp.target.position.set(0, 3.4, 0);
  lamp.castShadow = true;
  lamp.shadow.mapSize.set(2048, 2048);
  lamp.shadow.camera.near = 8;
  lamp.shadow.camera.far = 32;
  lamp.shadow.bias = -0.0004;
  lamp.shadow.normalBias = 0.02;
  lamp.shadow.radius = 5;
  scene.add(lamp, lamp.target);
  const rim = new THREE.DirectionalLight('#d4defc', 0.4);
  rim.position.set(6, 8, -10);
  scene.add(rim);

  // ---------- the table ----------
  const wood = woodTexture();
  wood.repeat.set(40 / 12.8, 40 / 6.4); // one texture is 12.8 × 6.4 units of table
  const table = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40).rotateX(-Math.PI / 2),
    new THREE.MeshPhysicalNodeMaterial({ map: wood, roughness: 0.62, clearcoat: 0.35, clearcoatRoughness: 0.4 }),
  );
  table.receiveShadow = true;
  scene.add(table);

  // ---------- the rack ----------
  const plastic = plasticMaterial('#3f7af2');
  const darkPlastic = plasticMaterial('#2c5fd6');
  const rack = new THREE.Group();
  scene.add(rack);
  const part = (geo, mat, x = 0, y = 0, z = 0) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = true;
    rack.add(mesh);
    return mesh;
  };
  const panelGeo = panelGeometry();
  part(panelGeo, plastic, 0, 0, GAP + BEVEL); // front
  part(panelGeo, plastic, 0, 0, -GAP - BEVEL - PANEL); // back
  // thin walls between the columns, inside the gap, standing a little proud at the top
  const wallH = cellY(0) + 0.72 - (FLOOR - 0.2);
  const wallGeo = new THREE.BoxGeometry(0.04, wallH, 2 * GAP);
  for (let c = 0; c <= COLS; c++) part(wallGeo, plastic, cellX(c) - 0.5 + (c === 0 ? -0.02 : c === COLS ? 0.02 : 0), FLOOR - 0.2 + wallH / 2, 0);
  // the two upright ends and their feet
  const postGeo = roundedBox(0.3, cellY(0) + 0.75, 2 * FACE + 0.06, 0.06);
  const footGeo = roundedBox(0.56, 0.22, 2.9, 0.08);
  for (const s of [-1, 1]) {
    part(postGeo, plastic, s * (HALF_W + 0.13), (cellY(0) + 0.75) / 2, 0);
    part(footGeo, darkPlastic, s * (HALF_W + 0.13), 0.11, 0);
  }
  // the slider the bottom row rests on; it slides out to the right to empty the rack
  const slider = part(roundedBox(2 * HALF_W + 1.0, 0.16, 2 * GAP - 0.02, 0.04), darkPlastic, 0.5, FLOOR - 0.08, 0);

  // ---------- discs ----------
  const discGeo = discGeometry();
  const shine = uniform(0); // 0 … 1: how brightly the winning four glow right now
  const discMats = [discMaterial(RED), discMaterial(GOLD)];
  const winMats = [discMaterial(RED, shine), discMaterial(GOLD, shine)];
  const discs = new THREE.Group();
  scene.add(discs);
  const makeDisc = (seat) => {
    const d = new THREE.Mesh(discGeo, discMats[seat]);
    d.castShadow = d.receiveShadow = true;
    d.userData.seat = seat;
    discs.add(d);
    return d;
  };
  const ghost = makeDisc(0); // the preview disc that hovers over a column
  ghost.scale.setScalar(0);

  // the winning four: a glowing ring around each hole and a lamp-coloured light in front
  const ringMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  ringMat.colorNode = color(new THREE.Color('#fff3cf').multiplyScalar(2));
  ringMat.opacityNode = shine;
  const ringGeo = new THREE.TorusGeometry(R_HOLE + 0.012, 0.035, 10, 48);
  const rings = Array.from({ length: COLS }, () => {
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.visible = false;
    scene.add(ring);
    return ring;
  });
  const winLight = new THREE.PointLight('#ffe9c0', 0, 6, 2);
  scene.add(winLight);

  // Compile every shader now, while the page shows "Setting up the table…", so the first
  // drop or the first win doesn't stutter. Materials not in the scene yet get a stand-in.
  const standIns = [...discMats, ...winMats].map((m) => {
    const d = new THREE.Mesh(discGeo, m);
    d.position.set(0, cellY(2), 0);
    scene.add(d);
    return d;
  });
  rings.forEach((r) => (r.visible = true));
  fitCamera(container.clientWidth || 1, container.clientHeight || 1);
  await renderer.compileAsync(scene, camera);
  standIns.forEach((d) => scene.remove(d));
  rings.forEach((r) => (r.visible = false));

  // ---------------------------------------------------------------------
  // Animation: each moving object has one step(dt) function; it returns true when done.
  // ---------------------------------------------------------------------
  const anims = new Map();
  const grid = new Map(); // board index → disc mesh
  let winCells = null;
  let glow = 0;

  // A disc falls from where the preview hovers, then bounces, each bounce 30% as fast as the
  // one before. The height is worked out from the time since the drop (not added up frame by
  // frame), so the motion is the same on a fast computer and a slow phone.
  function dropDisc(disc, c, r) {
    const target = cellY(r);
    const fall = Math.sqrt((2 * (TOP_Y - target)) / GRAVITY); // seconds to reach the bottom
    const firstBounce = GRAVITY * fall * 0.3; // upward speed after hitting bottom
    let t = 0;
    let landed = false;
    disc.position.set(cellX(c), TOP_Y, 0);
    anims.set(disc, (dt) => {
      t += dt;
      if (t < fall) {
        disc.position.y = TOP_Y - (GRAVITY * t * t) / 2;
        return false;
      }
      if (!landed) {
        landed = true;
        onLand?.();
      }
      let u = t - fall; // time since the first landing
      for (let v = firstBounce; v > 1; v *= 0.3) {
        const hop = (2 * v) / GRAVITY; // how long this bounce stays in the air
        if (u < hop) {
          disc.position.y = target + v * u - (GRAVITY * u * u) / 2;
          return false;
        }
        u -= hop;
      }
      disc.position.y = target; // at rest
      return true;
    });
  }

  // New game: the slider opens, the discs fall out, topple over on the table and fade away.
  let sliderT = -1;
  function emptyRack() {
    sliderT = 0;
    let clatter = false;
    for (const disc of grid.values()) {
      disc.material = discMats[disc.userData.seat];
      let wait = 0.12 + Math.random() * 0.1;
      let vy = 0;
      let tip = -1; // 0 … 1 while toppling over
      let rest = 0;
      const dir = Math.random() < 0.5 ? 1 : -1; // topple towards the front or the back
      const slide = 0.4 + Math.random() * 1.3;
      const x = disc.position.x + (Math.random() - 0.5) * 0.6;
      const x0 = disc.position.x;
      const spin = (Math.random() - 0.5) * 0.8;
      disc.rotation.order = 'YXZ';
      anims.set(disc, (dt) => {
        if ((wait -= dt) > 0) return false;
        if (tip < 0) {
          vy -= GRAVITY * dt;
          disc.position.y += vy * dt;
          if (disc.position.y - R_DISC > 0) return false;
          tip = 0; // hit the table
          if (!clatter) (clatter = true), onLand?.();
        }
        if (tip < 1) {
          tip = Math.min(1, tip + dt / 0.42);
          const a = (tip * tip * Math.PI) / 2; // speeds up as it falls over
          const out = Math.sin((tip * Math.PI) / 2);
          // rolling over its bottom edge: the centre swings out and down to lie flat
          disc.position.set(x0 + (x - x0) * out, HALF * Math.sin(a) + R_DISC * Math.cos(a), dir * (R_DISC * Math.sin(a) - HALF * Math.cos(a) + HALF + slide * out));
          disc.rotation.set(dir * a, spin * out, 0);
          return false;
        }
        rest += dt;
        if (rest < 0.8) return false;
        disc.scale.setScalar(Math.max(0, 1 - (rest - 0.8) / 0.35));
        if (rest < 1.15) return false;
        discs.remove(disc);
        return true;
      });
    }
    grid.clear();
  }

  function setWinLine(cells) {
    const key = cells ? JSON.stringify(cells) : null;
    if (key === (winCells && JSON.stringify(winCells))) return;
    winCells = cells;
    rings.forEach((r) => (r.visible = false));
    if (!cells) return;
    const centre = new THREE.Vector3();
    cells.forEach(([c, r], i) => {
      const disc = grid.get(r * COLS + c);
      if (disc) disc.material = winMats[disc.userData.seat];
      rings[i].position.set(cellX(c), cellY(r), FACE + 0.012);
      rings[i].visible = true;
      centre.add(rings[i].position);
    });
    winLight.position.copy(centre.divideScalar(cells.length)).setZ(1.3);
  }

  // ---------- the interface ui.js uses ----------
  let ghostCol = null;
  let ghostSeat = 0;
  function update(view, prev) {
    if (prev && view.moves < prev.moves) emptyRack();
    const dropped = prev && view.moves === prev.moves + 1 ? view.last : null;
    view.board.forEach((seat, i) => {
      const have = grid.get(i);
      if (have && have.userData.seat === seat) return;
      if (have) (discs.remove(have), anims.delete(have), grid.delete(i));
      if (seat == null) return;
      const c = i % COLS;
      const r = Math.floor(i / COLS);
      const disc = makeDisc(seat);
      grid.set(i, disc);
      if (dropped && dropped.col === c && dropped.row === r) {
        dropDisc(disc, c, r);
        if (ghostCol === c) ghost.scale.setScalar(0); // the real disc takes the preview's place
      } else disc.position.set(cellX(c), cellY(r), 0);
    });
    setWinLine(view.line);
  }

  function preview(col, seat) {
    if (col != null && (ghostCol == null || ghost.scale.x < 0.05)) ghost.position.x = cellX(col); // appear in place
    ghostCol = col;
    if (seat != null && seat !== ghostSeat) ghost.material = discMats[(ghostSeat = seat)];
    el.style.cursor = col != null ? 'pointer' : '';
  }

  // ---------------------------------------------------------------------
  // Camera: frames the rack in whatever space the player list and buttons leave, sways gently
  // from side to side, and can be dragged (it drifts back after a few seconds).
  // ---------------------------------------------------------------------
  function fitCamera(w, h) {
    camera.aspect = w / h;
    const shift = (insets.top - insets.bottom) / 2; // move the picture down by this many pixels
    camera.setViewOffset(w, h, 0, -shift, w, h);
    camera.updateProjectionMatrix();
    const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const availH = Math.max(h * 0.4, h - insets.top - insets.bottom - 12);
    const byHeight = (FIT_H / 2 / t) * (h / availH);
    const byWidth = (FIT_W / 2 / (t * camera.aspect)) * (w / Math.max(1, w - 24));
    fitDist = Math.max(byHeight, byWidth) + 0.4;
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

  function placeCamera(dt, t) {
    idle += dt;
    if (idle > 3) {
      const k = Math.exp(-dt * 0.8); // drift back to the front after a drag
      dragYaw *= k;
      dragPitch *= k;
    }
    const yaw = Math.sin(t * 0.17) * 0.2 + dragYaw;
    const pitch = THREE.MathUtils.clamp(0.2 + Math.sin(t * 0.11) * 0.035 + dragPitch, 0.02, 0.9);
    dist += (fitDist * zoom - dist) * (1 - Math.exp(-dt * 5));
    camera.position.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(dist).add(look);
    camera.lookAt(look);
  }

  // ---------------------------------------------------------------------
  // Pointer and touch. On your turn, pressing on the rack picks a column: the preview disc
  // follows your finger and letting go drops it. Dragging anywhere else turns the camera.
  // A mouse also previews the column under it without pressing. Two fingers zoom.
  // ---------------------------------------------------------------------
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const boardPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const hit = new THREE.Vector3();
  function columnAt(ev) {
    const rect = el.getBoundingClientRect();
    ndc.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    if (!ray.ray.intersectPlane(boardPlane, hit)) return null;
    if (Math.abs(hit.x) > COLS / 2 || hit.y < FLOOR - 0.3 || hit.y > TOP_Y + 0.8) return null;
    return Math.min(COLS - 1, Math.floor(hit.x + COLS / 2));
  }
  const pointers = new Map(); // pointerId → { x, y }
  let gesture = null; // { mode: 'pick' | 'turn' | 'zoom', … }
  const spread = () => {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y) || 1;
  };
  function onDown(ev) {
    el.setPointerCapture?.(ev.pointerId);
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pointers.size === 2) {
      if (gesture?.mode === 'pick') onHover(null);
      gesture = { mode: 'zoom', spread: spread(), zoom };
      return;
    }
    if (pointers.size > 2) return;
    const col = canPick() ? columnAt(ev) : null;
    gesture = col != null ? { mode: 'pick' } : { mode: 'turn', x: ev.clientX, y: ev.clientY };
    if (col != null) onHover(col);
  }
  function onMove(ev) {
    const p = pointers.get(ev.pointerId);
    if (p) (p.x = ev.clientX), (p.y = ev.clientY);
    if (!gesture) {
      if (ev.pointerType === 'mouse') onHover(canPick() ? columnAt(ev) : null);
      return;
    }
    if (gesture.mode === 'pick') onHover(columnAt(ev));
    else if (gesture.mode === 'turn' && p) {
      dragYaw = THREE.MathUtils.clamp(dragYaw - (ev.clientX - gesture.x) * 0.006, -0.9, 0.9);
      dragPitch = THREE.MathUtils.clamp(dragPitch + (ev.clientY - gesture.y) * 0.004, -0.25, 0.6);
      gesture.x = ev.clientX;
      gesture.y = ev.clientY;
      idle = 0;
    } else if (gesture.mode === 'zoom' && pointers.size === 2) {
      zoom = THREE.MathUtils.clamp(gesture.zoom * (gesture.spread / spread()), 0.65, 1.4);
      idle = 0;
    }
  }
  function onUp(ev) {
    pointers.delete(ev.pointerId);
    const g = gesture;
    if (pointers.size === 0) gesture = null;
    if (g?.mode !== 'pick') return;
    const col = ev.type === 'pointerup' ? columnAt(ev) : null;
    if (col != null && canPick()) onPick(col);
    else onHover(null);
    if (ev.pointerType !== 'mouse') onHover(null); // a finger leaves no hover behind
  }
  const onLeave = (ev) => ev.pointerType === 'mouse' && !gesture && onHover(null);
  const onWheel = (ev) => {
    ev.preventDefault();
    zoom = THREE.MathUtils.clamp(zoom * Math.exp(ev.deltaY * 0.001), 0.65, 1.4);
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
  timer.connect(document); // no giant time step after the tab was hidden
  renderer.setAnimationLoop((now) => {
    timer.update(now);
    const dt = Math.min(timer.getDelta(), 0.1); // a slow device skips ahead instead of slowing down
    const t = timer.getElapsed();
    for (const [obj, step] of anims) if (step(dt)) anims.delete(obj);

    // preview disc: glides to its column, bobs, and grows in or shrinks away
    const showGhost = ghostCol != null;
    if (showGhost) ghost.position.x += (cellX(ghostCol) - ghost.position.x) * (1 - Math.exp(-dt * 18));
    ghost.position.y = TOP_Y + Math.sin(t * 3.2) * 0.07;
    ghost.scale.setScalar(THREE.MathUtils.clamp(ghost.scale.x + (showGhost ? dt : -dt) * 7, 0, 1));
    ghost.visible = ghost.scale.x > 0.01;

    // the slider: out to the right, a moment's pause, and back
    if (sliderT >= 0) {
      sliderT += dt;
      const out = sliderT < 0.18 ? sliderT / 0.18 : sliderT < 0.55 ? 1 : Math.max(0, 1 - (sliderT - 0.55) / 0.3);
      slider.position.x = 0.5 + out * out * (2 * HALF_W + 0.6);
      if (sliderT > 0.85) sliderT = -1;
    }

    // the winning four: fade the glow in once every disc has landed, then pulse
    const settled = winCells && [...grid.values()].every((d) => !anims.has(d));
    glow = THREE.MathUtils.clamp(glow + (settled ? dt * 2 : -dt * 4), 0, 1);
    const s = glow * (0.72 + 0.28 * Math.sin(t * 5.5));
    shine.value = s;
    winLight.intensity = s * 4;

    placeCamera(dt, t);
    renderer.render(scene, camera);
  });

  return {
    update,
    preview,
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
      for (const m of [...discMats, ...winMats]) m.dispose();
      envMap.dispose();
      pmrem.dispose();
      renderer.dispose();
      el.remove();
    },
  };
}
