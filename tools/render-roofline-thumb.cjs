// Renders the Roofline home-page thumbnail: a little shed at golden hour with its roof half
// shingled in the game's five colors (in the game's own roof layout), a pallet of shingle
// bundles in front and a ladder against the wall. Drawn with the shared three.js.
//
//   npm start                                   (serves public/ on :8080)
//   node tools/render-roofline-thumb.cjs
//
// Saves public/games/roofline/thumb.jpg.
const path = require('node:path');
const { chromium } = require('playwright');

const OUT = path.resolve(__dirname, '../public/games/roofline/thumb.jpg');
const BASE = process.env.BASE || 'http://localhost:8080';

(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1000, height: 600 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error(e));
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && console.error(m.text()));
  await page.goto(`${BASE}/`);
  await page.setContent(`<!doctype html><html><head><style>html,body{margin:0;height:100%;overflow:hidden;background:#000}canvas{display:block;position:fixed;left:0;top:0}</style></head><body></body></html>`);
  await page.evaluate(async (base) => {
    const THREE = await import(`${base}/vendor/three/three.webgpu.min.js`);
    const W = 1000, H = 600;
    const renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL: true });
    renderer.setSize(W, H);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    document.body.append(renderer.domElement);
    await renderer.init();

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#e9b277');
    scene.fog = new THREE.Fog('#e8b47e', 26, 70);

    // a sky dome: warm at the horizon, blue overhead
    {
      const geo = new THREE.SphereGeometry(60, 32, 16);
      const col = [];
      const pos = geo.attributes.position;
      const lo = new THREE.Color('#f6c58a'), hi = new THREE.Color('#5d86b8'), c = new THREE.Color();
      for (let i = 0; i < pos.count; i++) {
        const t = Math.min(1, Math.max(0, pos.getY(i) / 32));
        c.copy(lo).lerp(hi, Math.pow(t, 0.7));
        col.push(c.r, c.g, c.b);
      }
      geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      scene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false })));
    }

    scene.add(new THREE.HemisphereLight('#ffe3bd', '#4a5a2a', 1.25));
    const sun = new THREE.DirectionalLight('#ffd29a', 3.4);
    sun.position.set(-7, 9, 7);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 30 });
    sun.shadow.bias = -0.0004;
    scene.add(sun);
    const fill = new THREE.DirectionalLight('#9fb8ff', 0.5);
    fill.position.set(8, 4, 6);
    scene.add(fill);

    const std = (color, rough = 0.85, metal = 0) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
    const box = (w, h, d, mat, x, y, z, parent = scene) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      m.castShadow = m.receiveShadow = true;
      parent.add(m);
      return m;
    };
    // a little noise so flat colors look like material
    const jitter = (hex, amt, seed) => {
      const c = new THREE.Color(hex);
      const r = Math.sin(seed * 12.9898) * 43758.5453;
      const f = 1 + (r - Math.floor(r) - 0.5) * amt;
      return c.multiplyScalar(f);
    };

    // ---------- ground ----------
    const ground = new THREE.Mesh(new THREE.CircleGeometry(40, 64), std('#6f8a3a', 1));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);
    const pad = box(6.2, 0.08, 4.6, std('#a39a8c', 1), 0, 0.04, 0.35); // gravel pad
    pad.castShadow = false;
    // grass tufts and a few distant trees
    for (let i = 0; i < 26; i++) {
      const a = i * 2.399, r = 9 + (i % 7) * 2.2;
      const x = Math.cos(a) * r, z = Math.sin(a) * r - 6;
      if (z > 2) continue;
      const h = 2.2 + (i % 4) * 0.7;
      const trunk = box(0.25, h * 0.4, 0.25, std('#5a3d24'), x, h * 0.2, z);
      const crown = new THREE.Mesh(new THREE.ConeGeometry(0.9 + (i % 3) * 0.25, h, 9), std(jitter('#3e5f2c', 0.3, i), 0.9));
      crown.position.set(x, h * 0.4 + h / 2 - 0.2, z);
      crown.castShadow = true;
      scene.add(crown);
      trunk.castShadow = true;
    }

    // ---------- the shed ----------
    const shed = new THREE.Group();
    scene.add(shed);
    const WD = 4.4, DP = 3.2, WALL = 2.3, RISE = 1.45;
    const siding = std('#c7a173', 0.9), trim = std('#f1ece2', 0.7), deck = std('#3b3430', 0.95);
    box(WD, WALL, DP, siding, 0, WALL / 2 + 0.08, 0, shed);
    // board-and-batten strips on the front
    for (let x = -WD / 2 + 0.2; x < WD / 2; x += 0.32) box(0.05, WALL - 0.1, 0.04, std('#b89062', 0.9), x, WALL / 2 + 0.08, DP / 2 + 0.02, shed);
    // corner trim
    for (const sx of [-1, 1]) box(0.14, WALL, 0.14, trim, sx * (WD / 2 + 0.01), WALL / 2 + 0.08, DP / 2 + 0.01, shed);
    box(WD + 0.1, 0.12, 0.1, trim, 0, WALL + 0.02, DP / 2 + 0.03, shed);
    // double barn doors with a white X
    const door = std('#7a2f22', 0.8);
    for (const sx of [-1, 1]) {
      const g = new THREE.Group();
      g.position.set(sx * 0.48, 0.98, DP / 2 + 0.06);
      shed.add(g);
      box(0.92, 1.7, 0.06, door, 0, 0, 0, g);
      box(0.92, 0.1, 0.08, trim, 0, 0.82, 0.02, g);
      box(0.92, 0.1, 0.08, trim, 0, -0.82, 0.02, g);
      box(0.1, 1.7, 0.08, trim, -0.41, 0, 0.02, g);
      box(0.1, 1.7, 0.08, trim, 0.41, 0, 0.02, g);
      const diag = box(0.09, 1.86, 0.07, trim, 0, 0, 0.03, g);
      diag.rotation.z = sx * Math.atan2(0.82, 1.6);
    }
    // a window on the side wall
    box(0.06, 0.62, 0.8, std('#9cc2d8', 0.15, 0.3), WD / 2 + 0.02, 1.55, -0.2, shed);
    box(0.08, 0.1, 0.96, trim, WD / 2 + 0.04, 1.9, -0.2, shed);
    box(0.08, 0.1, 0.96, trim, WD / 2 + 0.04, 1.2, -0.2, shed);
    box(0.08, 0.7, 0.08, trim, WD / 2 + 0.04, 1.55, 0.24, shed);
    box(0.08, 0.7, 0.08, trim, WD / 2 + 0.04, 1.55, -0.64, shed);
    // gable ends
    const gable = new THREE.Shape();
    gable.moveTo(-DP / 2, 0); gable.lineTo(DP / 2, 0); gable.lineTo(0, RISE); gable.lineTo(-DP / 2, 0);
    for (const sx of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.ExtrudeGeometry(gable, { depth: 0.04, bevelEnabled: false }), siding);
      m.rotation.y = Math.PI / 2;
      m.position.set(sx * WD / 2 - 0.02, WALL + 0.08, 0);
      m.castShadow = m.receiveShadow = true;
      shed.add(m);
    }
    // roof deck: two slopes, the front one gets the shingles
    const OVER = 0.28;
    const slopeLen = Math.hypot(DP / 2, RISE) + OVER;
    const pitch = Math.atan2(RISE, DP / 2);
    const front = new THREE.Group(); // local x across, local y down the slope from the ridge, z out of the roof
    front.position.set(0, WALL + 0.08 + RISE + 0.06, 0);
    front.rotation.x = pitch;
    shed.add(front);
    const ROOFW = WD + 0.5;
    box(ROOFW, 0.08, slopeLen, deck, 0, 0, slopeLen / 2, front);
    const back = new THREE.Group();
    back.position.copy(front.position);
    back.rotation.y = Math.PI;
    back.rotation.x = -pitch;
    shed.add(back);
    box(ROOFW, 0.08, slopeLen, std('#4d3b33', 0.9), 0, 0, slopeLen / 2, back);
    // fascia along the eave and a ridge cap
    const eave = box(ROOFW + 0.04, 0.16, 0.08, trim, 0, -0.04, slopeLen, front);
    box(ROOFW + 0.06, 0.12, 0.34, std('#55443a', 0.8), 0, WALL + 0.08 + RISE + 0.12, 0, shed).rotation.x = 0;

    // shingles: a 5 × 5 roof in the game's layout, rows overlapping like real shingles
    const COLORS = ['#b9773e', '#5f7a90', '#b8352c', '#3f7d48', '#d8bf86'];
    const roofColor = (r, c) => (c + 2 * r) % 5;
    // which squares are nailed down: the bottom rows full, the top ones in progress
    const filled = [
      [1, 1, 0, 1, 0],
      [1, 1, 1, 1, 0],
      [1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1],
    ];
    const cellW = ROOFW / 5, cellH = slopeLen / 5;
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 5; c++) {
        const x = -ROOFW / 2 + cellW * (c + 0.5);
        const y = cellH * (r + 0.5);
        const k = COLORS[roofColor(r, c)];
        if (!filled[r][c]) {
          // an empty square: chalk outline of the color it wants
          const ghost = new THREE.Mesh(new THREE.PlaneGeometry(cellW - 0.08, cellH - 0.08), new THREE.MeshStandardMaterial({ color: k, transparent: true, opacity: 0.28, roughness: 1 }));
          ghost.position.set(x, 0.045, y);
          ghost.rotation.x = -Math.PI / 2;
          front.add(ghost);
          continue;
        }
        // each square is a few courses of tabbed shingles
        for (let course = 0; course < 3; course++) {
          const yy = cellH * r + cellH * (course + 0.5) / 3 + 0.03;
          const tabs = 3;
          for (let t = 0; t < tabs; t++) {
            const off = course % 2 ? cellW / tabs / 2 : 0;
            let x0 = -ROOFW / 2 + cellW * c + (cellW / tabs) * t + off;
            let w = cellW / tabs - 0.02;
            if (x0 + w > -ROOFW / 2 + cellW * (c + 1)) w = -ROOFW / 2 + cellW * (c + 1) - x0 - 0.01;
            if (w < 0.05) continue;
            const s = box(w, 0.045, cellH / 3 + 0.06, std(jitter(k, 0.16, r * 97 + c * 31 + course * 7 + t), 0.88), x0 + w / 2, 0.06 + course * 0.004, yy, front);
            s.rotation.x = -0.05;
          }
        }
      }
    }

    // ---------- a pallet of shingle bundles ----------
    const wood = std('#a77b4c', 0.95), wood2 = std('#8a623a', 0.95);
    const band = std('#efe6d2', 0.7);
    function makePallet(x, z, rot, stack) {
      const pallet = new THREE.Group();
      pallet.position.set(x, 0, z);
      pallet.rotation.y = rot;
      scene.add(pallet);
      for (const zz of [-0.55, 0, 0.55]) box(1.5, 0.12, 0.14, wood2, 0, 0.06, zz, pallet);
      for (let i = 0; i < 6; i++) box(0.2, 0.04, 1.3, wood, -0.62 + i * 0.25, 0.14, 0, pallet);
      stack.forEach(([k, bx, bz, level, brot], i) => {
        const g = new THREE.Group();
        g.position.set(bx, 0.16 + level * 0.19 + 0.09, bz);
        g.rotation.y = brot;
        pallet.add(g);
        // a bundle: stacked shingles (thin layers), two paper straps
        for (let l = 0; l < 4; l++) box(0.66, 0.04, 0.42, std(jitter(COLORS[k], 0.14, i * 13 + l + x), 0.85), (l % 2) * 0.012, -0.06 + l * 0.042, 0, g);
        for (const sx of [-0.2, 0.2]) box(0.06, 0.18, 0.43, band, sx, 0, 0, g);
      });
    }
    makePallet(-2.75, 2.35, 0.32, [[2, -0.36, -0.28, 0, 0.04], [2, 0.36, -0.28, 0, -0.03], [3, -0.36, 0.28, 0, -0.02], [1, 0.36, 0.28, 0, 0.05], [2, -0.3, 0, 1, 0.12], [4, 0.34, 0.08, 1, -0.2]]);
    makePallet(-4.35, 0.2, -0.25, [[0, -0.36, -0.28, 0, 0.02], [0, 0.36, -0.28, 0, -0.06], [4, -0.36, 0.28, 0, 0.03], [3, 0.36, 0.28, 0, 0]]);

    // ---------- a ladder against the front corner ----------
    const ladder = new THREE.Group();
    ladder.position.set(1.7, 0, DP / 2 + 0.98);
    ladder.rotation.x = -0.36;
    scene.add(ladder);
    const al = std('#c9ccd0', 0.35, 0.8);
    for (const sx of [-0.25, 0.25]) box(0.07, 2.62, 0.09, al, sx, 1.31, 0, ladder);
    for (let i = 0; i < 8; i++) box(0.5, 0.05, 0.06, al, 0, 0.3 + i * 0.32, 0, ladder);

    // a hammer and loose shingle on the gravel
    box(0.6, 0.04, 0.22, std(COLORS[4], 0.85), 0.2, 0.11, 2.45).rotation.y = 0.5;
    const ham = new THREE.Group();
    ham.position.set(-0.6, 0.12, 2.5);
    ham.rotation.y = -0.6;
    scene.add(ham);
    box(0.5, 0.05, 0.06, std('#c48a4a', 0.6), 0, 0, 0, ham);
    box(0.08, 0.08, 0.2, std('#565a60', 0.3, 0.9), 0.25, 0.01, 0, ham);

    // ---------- camera ----------
    const camera = new THREE.PerspectiveCamera(28, W / H, 0.1, 200);
    camera.position.set(3.2, 4.4, 9.4);
    camera.lookAt(-0.55, 2.2, 0.6);

    await renderer.compileAsync(scene, camera);
    renderer.render(scene, camera);
    await new Promise((r) => requestAnimationFrame(r));
    renderer.render(scene, camera);
    window.__done = true;
  }, BASE);
  await page.waitForFunction(() => window.__done, null, { timeout: 240000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: OUT, type: 'jpeg', quality: 86, timeout: 240000 });
  console.log('saved', OUT);
  await browser.close();
})();
