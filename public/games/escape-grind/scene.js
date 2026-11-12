// Escape the Grind — the 3D table. A walnut table under a warm lamp, the round board with its
// two loops of raised tiles, glossy pawns, rolling dice, flying cards, gold-coin stacks and a
// tray for each player with miniature buildings for everything they own.
import * as THREE from '../../vendor/three/three.module.js';
import { RoomEnvironment } from '../../vendor/three/RoomEnvironment.js';
import { RoundedBoxGeometry } from '../../vendor/three/RoundedBoxGeometry.js';
import { OrbitControls } from '../../vendor/three/OrbitControls.js';
import { GRIND, RING, PLAYER_COLORS } from './cards.js';
import * as T from './textures.js';

const TAU = Math.PI * 2;
const BOARD_R = 10.2;
const BOARD_TOP = 0.5;
const TILE_H = 0.12;
const TILE_TOP = BOARD_TOP + TILE_H;
const INNER = { r: 5.6, w: 1.3, d: 1.55 };
const OUTER = { r: 8.5, w: 2.04, d: 1.85 };
const TRAY_R = 13.6;
const DIE = 0.62;
const ease = {
  linear: (k) => k,
  out: (k) => 1 - (1 - k) ** 3,
  inOut: (k) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2),
  back: (k) => 1 + 2.4 * (k - 1) ** 3 + 1.4 * (k - 1) ** 2,
};
export const seatAngle = (seat) => (-seat * Math.PI) / 2;
const angleOf = (track, i) => (i / (track === 'free' ? RING.length : GRIND.length)) * TAU;
const polar = (r, a, y = 0) => new THREE.Vector3(Math.sin(a) * r, y, Math.cos(a) * r);
const DECK_SLOTS = { small: 0, big: 1, market: 3, splurge: 4, venture: 5, setback: 7 };

export class Table3D {
  constructor(container, { quality = 'high' } = {}) {
    this.container = container;
    this.quality = quality;
    this.tweens = [];
    this.last = performance.now();
    this.mySeat = 0;
    this.followUntil = 0;
    this.focus = new THREE.Vector3(0, 0, 1);
    this.pawns = [];
    this.trays = [];
    this.trayItems = [[], [], [], []];
    this.positions = [];
    this.bursts = [];

    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }));
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === 'high' ? 2 : 1.25));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    container.append(r.domElement);
    r.domElement.className = 'eg-canvas';

    const scene = (this.scene = new THREE.Scene());
    scene.background = new THREE.Color('#0b0806');
    scene.fog = new THREE.Fog('#0b0806', 34, 70);
    const pm = new THREE.PMREMGenerator(r);
    scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.42;
    pm.dispose();

    const cam = (this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200));
    scene.add(cam);
    this.controls = new OrbitControls(cam, r.domElement);
    Object.assign(this.controls, {
      enableDamping: true,
      dampingFactor: 0.08,
      minDistance: 9,
      maxDistance: 48,
      minPolarAngle: 0.18,
      maxPolarAngle: 1.28,
      enablePan: false,
      rotateSpeed: 0.6,
      zoomSpeed: 0.8,
    });
    this.controls.addEventListener('start', () => (this.followUntil = performance.now() + 8000));

    this.#lights();
    this.#table();
    this.#board();
    this.#decks();
    this.#dice();
    this.#pawns();
    this.#trays();
    this.#cardMeshes();

    this.resize();
    this.setMySeat(0, true);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      const now = performance.now();
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      if (document.hidden) return;
      this.#frame(dt);
      this.#adapt(dt);
    };
    loop();
  }

  // ---------------------------------------------------------------------------------------------
  // building the world
  // ---------------------------------------------------------------------------------------------
  #lights() {
    const s = this.scene;
    this.hemi = new THREE.HemisphereLight('#ffe9cc', '#1a120c', 0.35);
    s.add(this.hemi);
    const key = (this.key = new THREE.SpotLight('#ffdcae', 2600, 80, 0.72, 0.65, 2));
    key.position.set(4, 26, 7);
    key.target.position.set(0, 0, 0);
    key.castShadow = true;
    const hi = this.quality === 'high';
    key.shadow.mapSize.set(hi ? 2048 : 1024, hi ? 2048 : 1024);
    key.shadow.bias = -0.0002;
    key.shadow.normalBias = 0.02;
    key.shadow.radius = 5;
    key.shadow.camera.near = 10;
    key.shadow.camera.far = 50;
    s.add(key, key.target);
    const rim = new THREE.DirectionalLight('#9fb7ff', 0.45);
    rim.position.set(-14, 9, -12);
    s.add(rim);
    const warm = new THREE.PointLight('#ff9d4a', 60, 40, 2);
    warm.position.set(-10, 6, 12);
    s.add(warm);
  }

  #table() {
    const wood = T.woodTextures({ w: 1024, h: 1024, planks: 6, seed: 11 });
    const map = T.woodTex(wood.map, [3, 3]);
    const rough = T.woodTex(wood.rough, [3, 3], false);
    const mat = new THREE.MeshStandardMaterial({ map, roughnessMap: rough, roughness: 0.9, metalness: 0, envMapIntensity: 0.6 });
    const top = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), mat);
    top.rotation.x = -Math.PI / 2;
    top.receiveShadow = true;
    this.scene.add(top);
  }

  #board() {
    const g = (this.boardGroup = new THREE.Group());
    this.scene.add(g);
    const wood = T.woodTextures({ w: 1024, h: 256, planks: 1, dark: [30, 16, 8], light: [96, 56, 28], seed: 5 });
    const rimMat = new THREE.MeshPhysicalMaterial({ map: T.woodTex(wood.map, [6, 1]), roughness: 0.38, clearcoat: 0.8, clearcoatRoughness: 0.18 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(BOARD_R + 0.35, BOARD_R + 0.5, BOARD_TOP, 160, 1, true), rimMat);
    base.position.y = BOARD_TOP / 2;
    base.castShadow = base.receiveShadow = true;
    g.add(base);
    const lip = new THREE.Mesh(new THREE.TorusGeometry(BOARD_R + 0.17, 0.2, 20, 160), rimMat);
    lip.rotation.x = Math.PI / 2;
    lip.position.y = BOARD_TOP - 0.02;
    lip.castShadow = true;
    g.add(lip);
    const topMat = new THREE.MeshStandardMaterial({ map: T.boardTexture({ R: BOARD_R, inner: INNER, outer: OUTER }), roughness: 0.92, metalness: 0 });
    const top = new THREE.Mesh(new THREE.CircleGeometry(BOARD_R + 0.02, 160), topMat);
    top.rotation.x = -Math.PI / 2;
    top.position.y = BOARD_TOP + 0.001;
    top.receiveShadow = true;
    g.add(top);
    const gold = (this.goldMat = new THREE.MeshStandardMaterial({ color: '#d9a640', metalness: 1, roughness: 0.28 }));
    const inlay = new THREE.Mesh(new THREE.TorusGeometry(BOARD_R - 0.05, 0.045, 10, 200), gold);
    inlay.rotation.x = Math.PI / 2;
    inlay.position.y = BOARD_TOP + 0.01;
    g.add(inlay);

    // tiles
    const texCache = {};
    const tileTex = (k) => (texCache[k] ||= T.tileTexture(k));
    const bodyMat = new THREE.MeshPhysicalMaterial({ color: '#f1ece0', roughness: 0.42, clearcoat: 0.5, clearcoatRoughness: 0.3 });
    for (const [track, list, dims] of [['grind', GRIND, INNER], ['free', RING, OUTER]]) {
      const geo = new RoundedBoxGeometry(dims.w, TILE_H, dims.d, 3, 0.05);
      const plane = new THREE.PlaneGeometry(dims.w - 0.12, dims.d - 0.12);
      list.forEach((kind, i) => {
        const a = angleOf(track, i);
        const tile = new THREE.Group();
        tile.position.copy(polar(dims.r, a, BOARD_TOP + TILE_H / 2));
        tile.rotation.y = a;
        const body = new THREE.Mesh(geo, bodyMat);
        body.castShadow = body.receiveShadow = true;
        const face = new THREE.Mesh(plane, new THREE.MeshPhysicalMaterial({ map: tileTex(kind), roughness: 0.4, clearcoat: 0.6, clearcoatRoughness: 0.25 }));
        face.rotation.x = -Math.PI / 2;
        face.position.y = TILE_H / 2 + 0.002;
        face.receiveShadow = true;
        tile.add(body, face);
        g.add(tile);
      });
    }

    // the spinning gold coin in the middle of the board
    const coinTex = T.coinFaceTexture();
    const faceMat = new THREE.MeshStandardMaterial({ map: coinTex, metalness: 0.95, roughness: 0.22 });
    const edgeMat = new THREE.MeshStandardMaterial({ color: '#d29a2c', metalness: 1, roughness: 0.3 });
    this.bigCoin = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.14, 64), [edgeMat, faceMat, faceMat]);
    this.bigCoin.rotation.x = Math.PI / 2;
    this.bigCoin.position.set(0, BOARD_TOP + 1.35, 0);
    this.bigCoin.castShadow = true;
    g.add(this.bigCoin);
    this.coinGeo = new THREE.CylinderGeometry(0.26, 0.26, 0.065, 36);
    this.coinMats = [edgeMat, new THREE.MeshStandardMaterial({ map: coinTex, metalness: 0.9, roughness: 0.25 }), faceMat];
  }

  #decks() {
    this.deckMeshes = {};
    this.backTex = {};
    const edge = new THREE.MeshStandardMaterial({ color: '#efe9db', roughness: 0.8 });
    for (const [deck, slot] of Object.entries(DECK_SLOTS)) {
      const back = (this.backTex[deck] = T.cardBack(deck));
      const topMat = new THREE.MeshStandardMaterial({ map: back, roughness: 0.55 });
      const geo = new RoundedBoxGeometry(1.12, 1, 1.56, 2, 0.04);
      const mesh = new THREE.Mesh(geo, [edge, edge, topMat, edge, edge, edge]);
      const a = ((slot + 0.5) / 8) * TAU;
      mesh.position.copy(polar(3.15, a, BOARD_TOP));
      mesh.rotation.y = a;
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.userData.angle = a;
      this.boardGroup.add(mesh);
      this.deckMeshes[deck] = mesh;
      this.setDeckSize(deck, 20);
    }
  }
  setDeckSize(deck, n) {
    const m = this.deckMeshes[deck];
    if (!m) return;
    const hgt = Math.max(0.03, Math.min(0.5, n * 0.014));
    m.scale.y = hgt;
    m.position.y = BOARD_TOP + hgt / 2;
  }

  #dice() {
    const faces = T.dieFaces();
    // BoxGeometry face order: +x, -x, +y, -y, +z, -z  → values 3, 4, 1, 6, 2, 5 (opposites add to 7)
    const order = [3, 4, 1, 6, 2, 5];
    this.dieNormals = { 3: [1, 0, 0], 4: [-1, 0, 0], 1: [0, 1, 0], 6: [0, -1, 0], 2: [0, 0, 1], 5: [0, 0, -1] };
    const mats = order.map((v) => new THREE.MeshPhysicalMaterial({ map: faces[v], roughness: 0.28, clearcoat: 0.7, clearcoatRoughness: 0.12 }));
    const geo = new RoundedBoxGeometry(DIE, DIE, DIE, 5, 0.1);
    this.dice = [0, 1].map((i) => {
      const d = new THREE.Mesh(geo, mats);
      d.castShadow = true;
      d.position.set(i ? 0.8 : -0.8, BOARD_TOP + DIE / 2, 1.9);
      d.quaternion.copy(this.#faceUp(i ? 4 : 3, 0.3 + i));
      d.visible = i === 0;
      this.scene.add(d);
      return d;
    });
  }
  #faceUp(v, yaw) {
    const n = new THREE.Vector3(...this.dieNormals[v]);
    const q = new THREE.Quaternion().setFromUnitVectors(n, new THREE.Vector3(0, 1, 0));
    return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw).multiply(q);
  }

  #pawns() {
    const pts = [
      [0, 0], [0.36, 0], [0.38, 0.05], [0.34, 0.1], [0.24, 0.16], [0.2, 0.24], [0.15, 0.42], [0.12, 0.58],
      [0.22, 0.62], [0.22, 0.66], [0.12, 0.7], [0.16, 0.78], [0.2, 0.88], [0.19, 0.98], [0.13, 1.06], [0.05, 1.1], [0, 1.11],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    const geo = new THREE.LatheGeometry(pts, 48);
    const ringGeo = new THREE.TorusGeometry(0.45, 0.04, 12, 48);
    for (let i = 0; i < 4; i++) {
      const mat = new THREE.MeshPhysicalMaterial({ color: PLAYER_COLORS[i], roughness: 0.16, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.06, sheen: 0.2 });
      const pawn = new THREE.Group();
      const body = new THREE.Mesh(geo, mat);
      body.castShadow = true;
      body.scale.setScalar(0.78);
      const glow = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: PLAYER_COLORS[i], transparent: true, opacity: 0, toneMapped: false }));
      glow.rotation.x = Math.PI / 2;
      glow.position.y = 0.03;
      pawn.add(body, glow);
      pawn.userData = { body, glow };
      this.scene.add(pawn);
      this.pawns.push(pawn);
      this.positions.push({ track: 'grind', pos: 0 });
      pawn.position.copy(this.slot('grind', 0, i));
    }
  }
  slot(track, pos, seat) {
    const dims = track === 'free' ? OUTER : INNER;
    const a = angleOf(track, pos);
    const off = [[-0.3, -0.32], [0.3, -0.32], [-0.3, 0.32], [0.3, 0.32]][seat];
    const k = track === 'free' ? 1.5 : 1;
    const p = polar(dims.r + off[1] * k, a, TILE_TOP);
    const tangent = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a));
    return p.addScaledVector(tangent, off[0] * k);
  }

  #trays() {
    const geo = new RoundedBoxGeometry(8.6, 0.24, 3.6, 3, 0.1);
    const feltGeo = new THREE.PlaneGeometry(8.2, 3.2);
    for (let i = 0; i < 4; i++) {
      const a = seatAngle(i);
      const g = new THREE.Group();
      g.position.copy(polar(TRAY_R, a, 0));
      g.rotation.y = a;
      const col = new THREE.Color(PLAYER_COLORS[i]);
      const body = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({ color: col.clone().multiplyScalar(0.55), roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.15 }));
      body.position.y = 0.12;
      body.castShadow = body.receiveShadow = true;
      const felt = new THREE.Mesh(feltGeo, new THREE.MeshStandardMaterial({ color: col.clone().lerp(new THREE.Color('#111'), 0.72), roughness: 1 }));
      felt.rotation.x = -Math.PI / 2;
      felt.position.y = 0.245;
      felt.receiveShadow = true;
      const coins = new THREE.InstancedMesh(this.coinGeo, this.coinMats, 80);
      coins.castShadow = true;
      coins.receiveShadow = true;
      coins.count = 0;
      g.add(body, felt, coins);
      g.userData = { coins, coinCount: 0 };
      this.scene.add(g);
      this.trays.push(g);
    }
  }
  trayWorld(seat, local = new THREE.Vector3(0, 0.6, 0)) {
    return this.trays[seat].localToWorld(local.clone());
  }

  // ---------------------------------------------------------------------------------------------
  // miniature buildings
  // ---------------------------------------------------------------------------------------------
  #mats() {
    if (this._m) return this._m;
    const M = (o) => new THREE.MeshStandardMaterial({ roughness: 0.7, ...o });
    this._m = {
      siding: M({ color: '#efe7d6' }),
      roof: M({ color: '#4a3d35', roughness: 0.85 }),
      brick: M({ color: '#9a4a36' }),
      shedRed: M({ map: T.sidingTexture('#b3322a') }),
      shedWall: M({ color: '#b3322a' }),
      shingle: M({ color: '#2d2a28', roughness: 0.9 }),
      condo: M({ map: T.windowsTexture({ floors: 5, cols: 2, wall: '#d8d1c4' }) }),
      plex: M({ map: T.windowsTexture({ floors: 2, cols: 4, wall: '#c9b79c' }) }),
      apt: M({ map: T.windowsTexture({ floors: 4, cols: 5, wall: '#b8a58a' }) }),
      house: M({ map: T.windowsTexture({ floors: 1, cols: 3, wall: '#e9e2d3', lit: 0.5 }) }),
      store: M({ map: T.windowsTexture({ floors: 1, cols: 3, wall: '#d6c7a6', glass: '#30495e', lit: 0.8 }) }),
      doors: M({ map: T.rollDoorsTexture() }),
      awning: M({ map: T.awningTexture(), side: THREE.DoubleSide }),
      concrete: M({ color: '#9a978f', roughness: 0.95 }),
      grass: M({ color: '#4f7f36', roughness: 1 }),
      trunk: M({ color: '#5a3b22' }),
      leaves: M({ color: '#2f6a2a', roughness: 0.9 }),
      silver: new THREE.MeshStandardMaterial({ color: '#d9dde3', metalness: 1, roughness: 0.25 }),
      glass: new THREE.MeshPhysicalMaterial({ color: '#7fa7c9', metalness: 0.6, roughness: 0.08, clearcoat: 1, envMapIntensity: 1.4 }),
      steel: new THREE.MeshStandardMaterial({ color: '#c8ccd2', metalness: 0.9, roughness: 0.3 }),
    };
    return this._m;
  }
  model(kind) {
    const m = this.#mats();
    const g = new THREE.Group();
    const box = (w, h, d, mat, x = 0, y = 0, z = 0) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      b.position.set(x, y + h / 2, z);
      b.castShadow = b.receiveShadow = true;
      g.add(b);
      return b;
    };
    const gable = (w, h, d, mat, y) => {
      const s = new THREE.Shape([new THREE.Vector2(-w / 2, 0), new THREE.Vector2(w / 2, 0), new THREE.Vector2(0, h)]);
      const geo = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false });
      geo.translate(0, 0, -d / 2);
      const r = new THREE.Mesh(geo, mat);
      r.position.y = y;
      r.castShadow = true;
      g.add(r);
    };
    switch (kind) {
      case 'house':
        box(0.8, 0.46, 0.66, [m.house, m.house, m.siding, m.siding, m.house, m.house]);
        gable(0.92, 0.36, 0.76, m.roof, 0.46);
        box(0.1, 0.24, 0.1, m.brick, 0.22, 0.6, -0.12);
        break;
      case 'condo':
        box(0.62, 1.15, 0.6, [m.condo, m.condo, m.concrete, m.concrete, m.condo, m.condo]);
        box(0.68, 0.06, 0.66, m.concrete, 0, 1.15);
        break;
      case 'plex':
        box(1.0, 0.66, 0.66, [m.plex, m.plex, m.siding, m.siding, m.plex, m.plex]);
        gable(1.1, 0.3, 0.74, m.roof, 0.66);
        break;
      case 'apt':
        box(1.05, 1.25, 0.8, [m.apt, m.apt, m.concrete, m.concrete, m.apt, m.apt]);
        box(1.1, 0.07, 0.85, m.concrete, 0, 1.25);
        box(0.3, 0.16, 0.3, m.steel, 0.25, 1.32, 0.1);
        break;
      case 'shed': {
        // a barn-style portable building: gambrel roof, double doors with white X trim
        const prof = [[-0.5, 0], [0.5, 0], [0.5, 0.42], [0.36, 0.68], [0, 0.8], [-0.36, 0.68], [-0.5, 0.42]].map(([x, y]) => new THREE.Vector2(x, y));
        const geo = new THREE.ExtrudeGeometry(new THREE.Shape(prof), { depth: 0.8, bevelEnabled: false });
        geo.translate(0, 0, -0.4);
        const body = new THREE.Mesh(geo, m.shedWall);
        body.castShadow = body.receiveShadow = true;
        g.add(body);
        const front = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.42), m.shedRed);
        front.position.set(0, 0.21, 0.402);
        g.add(front);
        const slope = (x0, y0, x1, y1) => {
          const len = Math.hypot(x1 - x0, y1 - y0) + 0.05;
          const r = new THREE.Mesh(new THREE.BoxGeometry(len, 0.035, 0.9), m.shingle);
          r.position.set((x0 + x1) / 2, (y0 + y1) / 2 + 0.018, 0);
          r.rotation.z = Math.atan2(y1 - y0, x1 - x0);
          r.castShadow = true;
          g.add(r);
        };
        slope(-0.54, 0.4, -0.36, 0.68);
        slope(-0.36, 0.68, 0, 0.8);
        slope(0, 0.8, 0.36, 0.68);
        slope(0.36, 0.68, 0.54, 0.4);
        g.scale.setScalar(0.9);
        break;
      }
      case 'storage':
        box(1.3, 0.34, 0.62, [m.concrete, m.concrete, m.concrete, m.concrete, m.doors, m.doors]);
        box(1.36, 0.04, 0.68, m.steel, 0, 0.34);
        break;
      case 'store': {
        box(0.92, 0.5, 0.7, [m.siding, m.siding, m.siding, m.siding, m.store, m.siding]);
        box(0.96, 0.08, 0.74, m.brick, 0, 0.5);
        const aw = new THREE.Mesh(new THREE.PlaneGeometry(0.92, 0.22), m.awning);
        aw.position.set(0, 0.44, 0.42);
        aw.rotation.x = -0.9;
        aw.castShadow = true;
        g.add(aw);
        break;
      }
      case 'coins':
        for (let i = 0; i < 4; i++) {
          const c = new THREE.Mesh(this.coinGeo, m.silver);
          c.position.set((i % 2) * 0.22 - 0.1, 0.035 + Math.floor(i / 2) * 0.066, 0);
          c.scale.setScalar(0.8);
          c.castShadow = true;
          g.add(c);
        }
        break;
      case 'land': {
        box(0.95, 0.05, 0.75, m.grass);
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.22, 8), m.trunk);
        trunk.position.set(0.22, 0.16, -0.1);
        const crown = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.42, 12), m.leaves);
        crown.position.set(0.22, 0.45, -0.1);
        trunk.castShadow = crown.castShadow = true;
        g.add(trunk, crown);
        break;
      }
      case 'venture':
        box(0.62, 1.8, 0.62, m.glass);
        box(0.66, 0.08, 0.66, m.steel, 0, 1.8);
        box(0.8, 0.1, 0.8, m.concrete);
        break;
      default:
        box(0.5, 0.5, 0.5, m.siding);
    }
    return g;
  }

  // Lay out a player's tray: coins for cash on the left, one miniature per asset.
  syncTray(seat, player, { animate = false } = {}) {
    const tray = this.trays[seat];
    const want = [...player.assets.map((a) => ({ key: `a${a.id}`, model: a.model })), ...(player.ventures || []).map((v, i) => ({ key: `v${i}`, model: 'venture' }))];
    if (Object.keys(player.stocks || {}).length) want.push({ key: 'stocks', model: 'stocks' });
    const have = this.trayItems[seat];
    const keep = [];
    for (const it of have) {
      if (want.some((w) => w.key === it.key)) keep.push(it);
      else {
        const obj = it.obj;
        if (animate) this.tween(450, (k) => obj.scale.setScalar(it.scale * (1 - ease.inOut(k)))).then(() => tray.remove(obj));
        else tray.remove(obj);
      }
    }
    for (const w of want) {
      if (keep.some((k) => k.key === w.key)) continue;
      const obj = w.model === 'stocks' ? this.#certificates() : this.model(w.model);
      tray.add(obj);
      const item = { key: w.key, obj, scale: 1, born: animate };
      keep.push(item);
    }
    this.trayItems[seat] = keep;
    const n = keep.length;
    const rows = n <= 10 ? 2 : Math.ceil(n / 5);
    const scale = n <= 10 ? 1 : Math.max(0.45, 2 / rows);
    keep.forEach((it, i) => {
      const col = i % 5, row = Math.floor(i / 5);
      const x = -1.3 + col * 1.2 * Math.max(scale, 0.8);
      const z = -0.85 + row * 1.6 * scale;
      it.obj.position.set(x, 0.25, z);
      it.obj.rotation.y = 0;
      const s0 = it.scale;
      it.scale = scale;
      if (it.born) {
        it.born = false;
        it.obj.scale.setScalar(0.001);
        this.tween(650, (k) => it.obj.scale.setScalar(scale * ease.back(k)));
      } else if (s0 !== scale) it.obj.scale.setScalar(scale);
    });
    this.setCash(seat, player.cash, animate);
  }
  #certificates() {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: '#efe4c2', roughness: 0.8 });
    const band = new THREE.MeshStandardMaterial({ color: '#2463b8', roughness: 0.6 });
    for (let i = 0; i < 3; i++) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.015, 0.55), mat);
      p.position.set(0, 0.01 + i * 0.016, 0);
      p.rotation.y = (i - 1) * 0.18;
      p.castShadow = p.receiveShadow = true;
      g.add(p);
    }
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.58), band);
    b.position.y = 0.03;
    g.add(b);
    return g;
  }
  setCash(seat, cash, animate) {
    const tray = this.trays[seat];
    const coins = tray.userData.coins;
    const n = Math.max(0, Math.min(80, Math.round(Math.sqrt(Math.max(0, cash) / 220))));
    const from = tray.userData.coinCount;
    const m = new THREE.Matrix4();
    const place = (count) => {
      for (let i = 0; i < count; i++) {
        const stack = Math.floor(i / 16), lvl = i % 16;
        const sx = -3.55 + (stack % 2) * 0.6, sz = -0.9 + Math.floor(stack / 2) * 0.6;
        const jitter = ((i * 7919) % 13) / 13 - 0.5;
        m.makeRotationY(jitter);
        m.setPosition(sx + jitter * 0.03, 0.28 + lvl * 0.066, sz + jitter * 0.02);
        coins.setMatrixAt(i, m);
      }
      coins.count = count;
      coins.instanceMatrix.needsUpdate = true;
    };
    tray.userData.coinCount = n;
    if (!animate || n === from) return place(n);
    const steps = Math.abs(n - from);
    this.tween(Math.min(900, 120 + steps * 40), (k) => place(Math.round(from + (n - from) * k)));
  }

  // ---------------------------------------------------------------------------------------------
  // cards
  // ---------------------------------------------------------------------------------------------
  #cardMeshes() {
    const geo = new THREE.PlaneGeometry(1.1, 1.54);
    this.cardGeo = geo;
    this.card = null;
  }
  async showCard(card, deck, speed = 1) {
    if (this.card) this.#dropCard(this.card);
    const face = T.cardFace(card, deck);
    // the face is unlit so the print stays crisp and true to color when held up to the camera
    const front = new THREE.Mesh(this.cardGeo, new THREE.MeshBasicMaterial({ map: face, color: '#f4f1ea', toneMapped: false, transparent: true, alphaTest: 0.5 }));
    const back = new THREE.Mesh(this.cardGeo, new THREE.MeshStandardMaterial({ map: this.backTex[deck] || this.backTex.small, roughness: 0.6, transparent: true, alphaTest: 0.5 }));
    back.rotation.y = Math.PI;
    const grp = new THREE.Group();
    grp.add(front, back);
    this.card = grp;
    const pile = this.deckMeshes[deck] || this.deckMeshes.small;
    // start: face down on top of the pile (world), converted into camera space
    const startW = pile.position.clone();
    startW.y = pile.position.y + pile.scale.y / 2 + 0.02;
    const startQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, pile.userData.angle + Math.PI, 0, 'YXZ'));
    this.camera.add(grp);
    const camQinv = this.camera.quaternion.clone().invert();
    const p0 = this.camera.worldToLocal(startW.clone());
    const q0 = camQinv.clone().multiply(startQ);
    const { pos: p1, scale: s1 } = this.#cardTarget();
    const mid = p0.clone().lerp(p1, 0.5).add(new THREE.Vector3(0, 0.8, 0));
    grp.position.copy(p0);
    grp.quaternion.copy(q0);
    await this.tween(780 * speed, (k) => {
      const e = ease.inOut(k);
      const a = p0.clone().lerp(mid, e), b = mid.clone().lerp(p1, e);
      grp.position.copy(a.lerp(b, e));
      grp.quaternion.copy(q0).slerp(new THREE.Quaternion(), ease.out(k));
      grp.scale.setScalar(1 + (s1 - 1) * e);
    });
    grp.userData.presented = true;
  }
  #cardTarget() {
    const d = 6;
    const vh = 2 * d * Math.tan((this.camera.fov * Math.PI) / 360);
    const vw = vh * this.camera.aspect;
    const s = Math.min((vh * 0.58) / 1.54, (vw * 0.62) / 1.1);
    const narrow = this.camera.aspect < 0.8;
    return { pos: new THREE.Vector3(0, vh * (narrow ? 0.18 : 0.15), -d), scale: s };
  }
  // send the presented card somewhere: a player's tray (bought) or off the table (passed)
  async dismissCard(seat = null, speed = 1) {
    const grp = this.card;
    if (!grp) return;
    this.card = null;
    const p0 = grp.position.clone();
    const s0 = grp.scale.x;
    const target = seat != null ? this.camera.worldToLocal(this.trayWorld(seat, new THREE.Vector3(1.5, 0.8, 0))) : p0.clone().add(new THREE.Vector3(0, -6, 2));
    const q0 = grp.quaternion.clone();
    const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(-1.1, 0, seat != null ? 0.3 : -0.4));
    await this.tween(560 * speed, (k) => {
      const e = ease.inOut(k);
      grp.position.lerpVectors(p0, target, e);
      grp.scale.setScalar(s0 * (1 - 0.85 * e));
      grp.quaternion.copy(q0).slerp(tilt, e);
    });
    this.#dropCard(grp);
  }
  #dropCard(grp) {
    grp.parent?.remove(grp);
    grp.children.forEach((c) => {
      if (c.material.map && c.material.map !== this.backTex.small && !Object.values(this.backTex).includes(c.material.map)) c.material.map.dispose();
      c.material.dispose();
    });
  }
  hasCard() {
    return !!this.card;
  }

  // ---------------------------------------------------------------------------------------------
  // dice and pawns
  // ---------------------------------------------------------------------------------------------
  async rollDice(seat, values, speed = 1) {
    const a = seatAngle(seat);
    const tangent = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a));
    const jobs = values.map((v, i) => {
      const d = this.dice[i];
      d.visible = true;
      const off = values.length === 2 ? (i ? 0.48 : -0.48) : 0;
      const start = polar(11.5, a, 3.4).addScaledVector(tangent, off * 2.2);
      const end = polar(1.95 + (i ? 0.12 : 0), a, BOARD_TOP + DIE / 2).addScaledVector(tangent, off);
      const finalQ = this.#faceUp(v, Math.random() * TAU);
      const axis = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.3, Math.random() - 0.5).normalize();
      const spins = (5 + Math.random() * 3) * TAU;
      const dur = (1150 + i * 90) * speed;
      return this.tween(dur, (k) => {
        const e = ease.out(k);
        d.position.lerpVectors(start, end, e);
        // bounces: one big drop then two shrinking hops
        const hop = k < 0.45 ? 3.4 * (1 - k / 0.45) ** 2 : k < 0.75 ? 0.55 * Math.sin(((k - 0.45) / 0.3) * Math.PI) : 0.14 * Math.sin(((k - 0.75) / 0.25) * Math.PI);
        d.position.y = end.y + Math.max(0, k < 0.45 ? hop : hop);
        const rem = (1 - e) ** 1.6;
        d.quaternion.copy(new THREE.Quaternion().setFromAxisAngle(axis, spins * rem).multiply(finalQ));
      });
    });
    this.dice[1].visible = values.length === 2;
    if (values.length === 1) this.dice[1].visible = false;
    await Promise.all(jobs);
  }

  async hop(seat, track, from, steps, speed = 1, onStep) {
    const pawn = this.pawns[seat];
    const len = track === 'free' ? RING.length : GRIND.length;
    for (let i = 1; i <= steps; i++) {
      const pos = (from + i) % len;
      const a = pawn.position.clone();
      const b = this.slot(track, pos, seat);
      await this.tween(240 * speed, (k) => {
        pawn.position.lerpVectors(a, b, ease.inOut(k));
        pawn.position.y = b.y + Math.sin(k * Math.PI) * 0.55;
      });
      onStep?.(pos, i === steps);
    }
    this.positions[seat] = { track, pos: (from + steps) % len };
  }
  async leap(seat, track, pos, speed = 1) {
    const pawn = this.pawns[seat];
    const a = pawn.position.clone();
    const b = this.slot(track, pos, seat);
    await this.tween(1100 * speed, (k) => {
      pawn.position.lerpVectors(a, b, ease.inOut(k));
      pawn.position.y = b.y + Math.sin(k * Math.PI) * 3;
      pawn.rotation.y = k * TAU;
    });
    pawn.rotation.y = 0;
    this.positions[seat] = { track, pos };
  }
  placePawn(seat, track, pos, active) {
    this.positions[seat] = { track, pos };
    this.pawns[seat].position.copy(this.slot(track, pos, seat));
    this.pawns[seat].visible = active !== false;
  }
  setActive(seat) {
    this.active = seat;
  }

  // The room's light follows the economy: golden in a boom, cold and dim in a recession.
  setMood(phase, snap = false) {
    const MOODS = {
      expansion: { key: '#ffdcae', k: 2600, sky: '#ffe9cc', h: 0.35 },
      boom: { key: '#ffcf85', k: 3100, sky: '#fff0c8', h: 0.42 },
      slowdown: { key: '#f2cfae', k: 2250, sky: '#e8dccb', h: 0.3 },
      recession: { key: '#bccbf2', k: 1800, sky: '#b9c6e6', h: 0.24 },
      recovery: { key: '#ffe3c2', k: 2450, sky: '#f4e6d2', h: 0.33 },
    };
    const m = MOODS[phase] || MOODS.expansion;
    if (this.mood === phase) return;
    this.mood = phase;
    const c0 = this.key.color.clone(), s0 = this.hemi.color.clone();
    const k0 = this.key.intensity, h0 = this.hemi.intensity;
    const c1 = new THREE.Color(m.key), s1 = new THREE.Color(m.sky);
    this.tween(snap ? 0 : 2200, (k) => {
      this.key.color.lerpColors(c0, c1, k);
      this.hemi.color.lerpColors(s0, s1, k);
      this.key.intensity = k0 + (m.k - k0) * k;
      this.hemi.intensity = h0 + (m.h - h0) * k;
    });
  }

  // ---------------------------------------------------------------------------------------------
  // camera
  // ---------------------------------------------------------------------------------------------
  setMySeat(seat, snap = false) {
    this.mySeat = seat ?? 0;
    const a = seatAngle(this.mySeat);
    const d = this.#defaultDistance();
    const el = 0.86;
    this.focus.copy(this.#home());
    const pos = this.focus.clone().add(new THREE.Vector3(Math.sin(a) * d * Math.sin(el), d * Math.cos(el), Math.cos(a) * d * Math.sin(el)));
    if (snap) {
      this.controls.target.copy(this.focus);
      this.camera.position.copy(pos);
      this.controls.update();
    } else {
      const p0 = this.camera.position.clone();
      const t0 = this.controls.target.clone();
      this.tween(1200, (k) => {
        const e = ease.inOut(k);
        this.camera.position.lerpVectors(p0, pos, e);
        this.controls.target.lerpVectors(t0, this.focus, e);
      });
    }
  }
  #defaultDistance() {
    const asp = this.camera.aspect || 1.6;
    return asp >= 1.3 ? 29 : asp >= 0.9 ? 34 : 42;
  }
  // gently look toward a point (the moving pawn) unless the person is steering the camera
  lookToward(vec, amount = 0.45) {
    if (performance.now() < this.followUntil) return;
    this.focus.copy(this.#home().lerp(new THREE.Vector3(vec.x, 0, vec.z), amount));
  }
  lookHome() {
    this.focus.copy(this.#home());
  }
  #home() {
    // aim between the board's center and my own tray, a little lower on tall screens
    return polar((this.camera.aspect || 1.6) < 0.9 ? 4.2 : 3.4, seatAngle(this.mySeat), 0);
  }
  orbit(dx, dy) {
    this.followUntil = performance.now() + 8000;
    const off = this.camera.position.clone().sub(this.controls.target);
    const sph = new THREE.Spherical().setFromVector3(off);
    sph.theta -= dx;
    sph.phi = Math.max(this.controls.minPolarAngle, Math.min(this.controls.maxPolarAngle, sph.phi - dy));
    off.setFromSpherical(sph);
    this.camera.position.copy(this.controls.target).add(off);
  }
  zoom(f) {
    const off = this.camera.position.clone().sub(this.controls.target);
    const len = Math.max(this.controls.minDistance, Math.min(this.controls.maxDistance, off.length() * f));
    this.camera.position.copy(this.controls.target).add(off.setLength(len));
  }
  view(kind) {
    this.followUntil = performance.now() + 1500;
    const a = seatAngle(this.mySeat);
    const t = this.controls.target.clone();
    let pos;
    if (kind === 'top') pos = t.clone().add(new THREE.Vector3(Math.sin(a) * 2, 34, Math.cos(a) * 2));
    else if (kind === 'low') pos = t.clone().add(new THREE.Vector3(Math.sin(a) * 18, 7, Math.cos(a) * 18));
    else return this.setMySeat(this.mySeat);
    const p0 = this.camera.position.clone();
    this.tween(900, (k) => this.camera.position.lerpVectors(p0, pos, ease.inOut(k)));
  }

  // ---------------------------------------------------------------------------------------------
  // effects
  // ---------------------------------------------------------------------------------------------
  burst(at, { count = 40, color = null, power = 1 } = {}) {
    const mat = color ? new THREE.MeshStandardMaterial({ color, metalness: 0.3, roughness: 0.4, side: THREE.DoubleSide }) : null;
    const geo = color ? new THREE.PlaneGeometry(0.16, 0.24) : this.coinGeo;
    const mesh = new THREE.InstancedMesh(geo, mat || this.coinMats, count);
    mesh.castShadow = true;
    const parts = [];
    for (let i = 0; i < count; i++) {
      const a = Math.random() * TAU;
      const sp = (2 + Math.random() * 3.5) * power;
      parts.push({
        p: at.clone(),
        v: new THREE.Vector3(Math.cos(a) * sp * 0.6, (5 + Math.random() * 5) * power, Math.sin(a) * sp * 0.6),
        r: new THREE.Euler(Math.random() * TAU, Math.random() * TAU, 0),
        w: new THREE.Vector3(Math.random() * 10, Math.random() * 10, Math.random() * 10),
      });
    }
    if (color) {
      const palette = PLAYER_COLORS.concat(['#ffffff', '#f6d77c']);
      for (let i = 0; i < count; i++) mesh.setColorAt(i, new THREE.Color(palette[i % palette.length]));
    }
    this.scene.add(mesh);
    this.bursts.push({ mesh, parts, t: 0, life: 2.6 });
  }

  // ---------------------------------------------------------------------------------------------
  // tweens and the frame loop
  // ---------------------------------------------------------------------------------------------
  tween(ms, fn) {
    return new Promise((resolve) => {
      if (ms <= 16) {
        fn(1);
        return resolve();
      }
      this.tweens.push({ t0: performance.now(), ms, fn, resolve });
    });
  }
  #frame(dt) {
    const now = performance.now();
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const tw = this.tweens[i];
      const k = Math.min(1, (now - tw.t0) / tw.ms);
      let failed = false;
      try {
        tw.fn(k);
      } catch (err) {
        // never let one broken animation freeze the table
        console.error(err);
        failed = true;
      }
      if (k >= 1 || failed || !(k >= 0)) {
        this.tweens.splice(i, 1);
        tw.resolve();
      }
    }
    const t = now / 1000;
    this.bigCoin.rotation.z = t * 0.6;
    this.bigCoin.position.y = BOARD_TOP + 1.35 + Math.sin(t * 1.3) * 0.08;
    this.pawns.forEach((p, i) => {
      const g = p.userData.glow;
      const on = i === this.active;
      g.material.opacity += ((on ? 0.55 + Math.sin(t * 4) * 0.3 : 0) - g.material.opacity) * Math.min(1, dt * 8);
      g.scale.setScalar(1 + (on ? Math.sin(t * 4) * 0.08 : 0));
    });
    for (let b = this.bursts.length - 1; b >= 0; b--) {
      const B = this.bursts[b];
      B.t += dt;
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      B.parts.forEach((pt, i) => {
        pt.v.y -= 14 * dt;
        pt.p.addScaledVector(pt.v, dt);
        if (pt.p.y < BOARD_TOP + 0.05) {
          pt.p.y = BOARD_TOP + 0.05;
          pt.v.multiplyScalar(0.4);
          pt.v.y = Math.abs(pt.v.y) * 0.3;
        }
        pt.r.x += pt.w.x * dt;
        pt.r.y += pt.w.y * dt;
        q.setFromEuler(pt.r);
        const s = B.t > B.life - 0.5 ? Math.max(0.001, (B.life - B.t) / 0.5) : 1;
        m.compose(pt.p, q, new THREE.Vector3(s, s, s));
        B.mesh.setMatrixAt(i, m);
      });
      B.mesh.instanceMatrix.needsUpdate = true;
      if (B.t >= B.life) {
        this.scene.remove(B.mesh);
        B.mesh.dispose();
        this.bursts.splice(b, 1);
      }
    }
    // glide the camera with its target so following the action never swings the view around
    const step = this.focus.clone().sub(this.controls.target).multiplyScalar(1 - Math.exp(-dt * 1.6));
    this.controls.target.add(step);
    this.camera.position.add(step);
    this.controls.update();
    if (this.card?.userData.presented) {
      const { pos, scale } = this.#cardTarget();
      this.card.position.lerp(pos, 0.2);
      this.card.scale.setScalar(this.card.scale.x + (scale - this.card.scale.x) * 0.2);
      this.card.rotation.y = Math.sin(t * 0.8) * 0.04;
    }
    this.renderer.render(this.scene, this.camera);
  }

  // Keep the frame rate up on slower hardware (TV and console browsers, older phones) by
  // lowering the render resolution a step at a time; raise it again when there is headroom.
  #adapt(dt) {
    const a = (this._adapt ||= { sum: 0, n: 0, scale: 1 });
    a.sum += dt;
    a.n++;
    if (a.sum < 2) return;
    const avg = a.sum / a.n;
    a.sum = a.n = 0;
    const max = Math.min(window.devicePixelRatio || 1, this.quality === 'high' ? 2 : 1.25);
    if (avg > 1 / 40 && a.scale > 0.5) a.scale = Math.max(0.5, a.scale - 0.15);
    else if (avg < 1 / 57 && a.scale < 1) a.scale = Math.min(1, a.scale + 0.1);
    else return;
    this.renderer.setPixelRatio(max * a.scale);
    this.resize();
  }

  resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    const was = this.camera.aspect;
    this.camera.aspect = w / h;
    this.camera.fov = w / h < 0.8 ? 50 : 38;
    // render the scene a little higher on screen so the action bar never hides the table edge
    this.camera.setViewOffset(w, h, 0, Math.round(h * 0.07), w, h);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    if (was !== this.camera.aspect && this.controls) {
      const off = this.camera.position.clone().sub(this.controls.target);
      if (Math.abs(was - this.camera.aspect) > 0.3) off.setLength(this.#defaultDistance());
      this.camera.position.copy(this.controls.target).add(off);
    }
  }
  setQuality(q) {
    this.quality = q;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q === 'high' ? 2 : 1.25));
    this.renderer.shadowMap.enabled = true;
    this.resize();
  }
  dispose() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
