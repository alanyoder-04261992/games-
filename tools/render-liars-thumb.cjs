// Renders the Liar's Dice home-page thumbnail: a lamp-lit felt table, a leather cup tipped
// over with its dice spilled out, and the other players' cups still closed behind it. Built
// with the shared three.js (public/vendor/three) and saved as public/games/liars-dice/thumb.jpg.
//
//   npm start                                  (serves public/ on :8080)
//   node tools/render-liars-thumb.cjs
const path = require('node:path');
const { chromium } = require('playwright');

const OUT = path.resolve(__dirname, '../public/games/liars-dice/thumb.jpg');
const BASE = process.env.BASE || 'http://localhost:8080';

(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 720 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error(e));
  page.on('console', (m) => (m.type() === 'warning' || m.type() === 'error') && console.log(m.type(), m.text()));
  await page.goto(`${BASE}/`);
  await page.setContent('<!doctype html><html><head><style>html,body{margin:0;height:100%;overflow:hidden;background:#000}canvas{display:block}</style></head><body></body></html>');
  await page.evaluate(async (base) => {
    const THREE = await import(`${base}/vendor/three/three.webgpu.min.js`);
    const { RoundedBoxGeometry } = await import(`${base}/vendor/three/addons/geometries/RoundedBoxGeometry.js`);
    const { RoomEnvironment } = await import(`${base}/vendor/three/addons/environments/RoomEnvironment.js`);

    const W = innerWidth;
    const H = innerHeight;
    const adapter = navigator.gpu ? await navigator.gpu.requestAdapter().catch(() => null) : null;
    const renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL: !adapter });
    renderer.setPixelRatio(2); // drawn at twice the size, so the screenshot is smooth
    renderer.setSize(W, H);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.VSMShadowMap;
    document.body.append(renderer.domElement);
    await renderer.init();

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#04100a');
    scene.fog = new THREE.Fog('#04100a', 13, 26); // the far table fades into the dark
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.22;

    // ---------- felt ----------
    function feltTexture() {
      const c = document.createElement('canvas');
      c.width = c.height = 512;
      const g = c.getContext('2d');
      g.fillStyle = '#18643c';
      g.fillRect(0, 0, 512, 512);
      const img = g.getImageData(0, 0, 512, 512);
      for (let i = 0; i < img.data.length; i += 4) {
        const n = (Math.random() - 0.5) * 26;
        img.data[i] += n * 0.5;
        img.data[i + 1] += n;
        img.data[i + 2] += n * 0.6;
      }
      g.putImageData(img, 0, 0);
      const t = new THREE.CanvasTexture(c);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(10, 10);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    }
    const felt = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ map: feltTexture(), roughness: 1, metalness: 0 }));
    felt.rotation.x = -Math.PI / 2;
    felt.receiveShadow = true;
    scene.add(felt);

    // ---------- dice ----------
    const ivory = new THREE.MeshPhysicalMaterial({ color: '#f4ecd8', roughness: 0.32, clearcoat: 0.7, clearcoatRoughness: 0.15, sheen: 0.2 });
    const ink = new THREE.MeshStandardMaterial({ color: '#141418', roughness: 0.55 });
    const red = new THREE.MeshStandardMaterial({ color: '#b3231a', roughness: 0.45 });
    const dieGeo = new RoundedBoxGeometry(1, 1, 1, 5, 0.15);
    const pipGeo = new THREE.CylinderGeometry(0.095, 0.095, 0.03, 24);
    const bigPipGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.03, 32);
    const SPOTS = {
      1: [[0, 0]],
      2: [[-0.25, -0.25], [0.25, 0.25]],
      3: [[-0.25, -0.25], [0, 0], [0.25, 0.25]],
      4: [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]],
      5: [[-0.25, -0.25], [0.25, -0.25], [0, 0], [-0.25, 0.25], [0.25, 0.25]],
      6: [[-0.25, -0.27], [0.25, -0.27], [-0.25, 0], [0.25, 0], [-0.25, 0.27], [0.25, 0.27]],
    };
    // which face points along each axis (opposite faces add up to 7)
    const FACES = [
      { v: 1, n: [0, 1, 0] },
      { v: 6, n: [0, -1, 0] },
      { v: 2, n: [0, 0, 1] },
      { v: 5, n: [0, 0, -1] },
      { v: 3, n: [1, 0, 0] },
      { v: 4, n: [-1, 0, 0] },
    ];
    function makeDie() {
      const g = new THREE.Group();
      const body = new THREE.Mesh(dieGeo, ivory);
      body.castShadow = body.receiveShadow = true;
      g.add(body);
      const up = new THREE.Vector3(0, 1, 0);
      for (const { v, n } of FACES) {
        const normal = new THREE.Vector3(...n);
        const q = new THREE.Quaternion().setFromUnitVectors(up, normal);
        for (const [a, b] of SPOTS[v]) {
          const pip = new THREE.Mesh(v === 1 ? bigPipGeo : pipGeo, v === 1 ? red : ink);
          pip.position.set(a, 0.492, b).applyQuaternion(q);
          pip.quaternion.copy(q);
          g.add(pip);
        }
      }
      return g;
    }
    // turn a die so `face` is on top, then spin it about the vertical
    const TOP = { 1: [0, 0, 0], 6: [Math.PI, 0, 0], 2: [-Math.PI / 2, 0, 0], 5: [Math.PI / 2, 0, 0], 3: [0, 0, Math.PI / 2], 4: [0, 0, -Math.PI / 2] };
    function placeDie(face, x, z, yaw, { tilt = 0, y = 0.5 } = {}) {
      const d = makeDie();
      const inner = d;
      inner.rotation.set(...TOP[face]);
      const outer = new THREE.Group();
      outer.add(inner);
      outer.rotation.y = yaw;
      outer.rotation.z = tilt;
      outer.position.set(x, y, z);
      scene.add(outer);
      return outer;
    }

    // ---------- cups ----------
    // leather: dark oxblood with grain, scuffs and a worn lighter streak here and there
    function leatherTexture() {
      const c = document.createElement('canvas');
      c.width = 1024;
      c.height = 512;
      const g = c.getContext('2d');
      const grad = g.createLinearGradient(0, 0, 0, 512);
      grad.addColorStop(0, '#5e2410');
      grad.addColorStop(1, '#4a1a0a');
      g.fillStyle = grad;
      g.fillRect(0, 0, 1024, 512);
      for (let i = 0; i < 90; i++) {
        g.strokeStyle = `rgba(${Math.random() < 0.5 ? '255,190,140' : '20,5,0'},${0.015 + Math.random() * 0.03})`;
        g.lineWidth = 1 + Math.random() * 3;
        const x = Math.random() * 1024;
        g.beginPath();
        g.moveTo(x, 0);
        g.bezierCurveTo(x + (Math.random() - 0.5) * 40, 170, x + (Math.random() - 0.5) * 40, 340, x + (Math.random() - 0.5) * 30, 512);
        g.stroke();
      }
      const img = g.getImageData(0, 0, 1024, 512);
      for (let i = 0; i < img.data.length; i += 4) {
        const n = (Math.random() - 0.5) * 34;
        img.data[i] += n;
        img.data[i + 1] += n * 0.7;
        img.data[i + 2] += n * 0.5;
      }
      g.putImageData(img, 0, 0);
      // stitching just below the rim and above the base
      g.fillStyle = 'rgba(232, 200, 150, 0.85)';
      for (const y of [44, 470]) for (let x = 0; x < 1024; x += 16) g.fillRect(x, y, 9, 3);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      return t;
    }
    const leather = new THREE.MeshPhysicalMaterial({ map: leatherTexture(), roughness: 0.55, clearcoat: 0.45, clearcoatRoughness: 0.45, sheen: 0.5, sheenColor: new THREE.Color('#d48a55') });
    const lining = new THREE.MeshStandardMaterial({ color: '#1a0904', roughness: 0.98, side: THREE.DoubleSide });
    const brass = new THREE.MeshStandardMaterial({ color: '#d8a948', metalness: 1, roughness: 0.28 });
    function makeCup() {
      // profile from the closed base (y = 0) out to the open mouth (y = 2.2)
      const pts = [];
      const base = 0.88;
      const mouth = 1.12;
      const h = 2.2;
      pts.push(new THREE.Vector2(0, 0));
      pts.push(new THREE.Vector2(base - 0.06, 0));
      pts.push(new THREE.Vector2(base, 0.06));
      for (let i = 1; i <= 12; i++) {
        const t = i / 12;
        pts.push(new THREE.Vector2(base + (mouth - base) * t + Math.sin(t * Math.PI) * 0.03, 0.06 + t * (h - 0.06)));
      }
      pts.push(new THREE.Vector2(mouth + 0.02, h + 0.04));
      pts.push(new THREE.Vector2(mouth - 0.08, h + 0.04));
      const outside = new THREE.Mesh(new THREE.LatheGeometry(pts, 64), leather);
      outside.castShadow = outside.receiveShadow = true;
      const inPts = [];
      for (let i = 0; i <= 12; i++) {
        const t = i / 12;
        inPts.push(new THREE.Vector2(base - 0.08 + (mouth - base) * t, 0.12 + t * (h - 0.08)));
      }
      const inside = new THREE.Mesh(new THREE.LatheGeometry(inPts, 64), lining);
      const g = new THREE.Group();
      g.add(outside, inside);
      for (const [y, r] of [[0.32, base + (mouth - base) * 0.12], [h - 0.28, mouth - 0.02]]) {
        const band = new THREE.Mesh(new THREE.TorusGeometry(r + 0.012, 0.045, 12, 96), brass);
        band.rotation.x = Math.PI / 2;
        band.position.y = y;
        band.castShadow = true;
        g.add(band);
      }
      // stitching: a row of small dark marks under each band
      return g;
    }

    // the tipped cup: on its side at the left, mouth toward the dice it just spilled
    const tipped = makeCup();
    tipped.rotation.order = 'YXZ';
    tipped.rotation.z = -Math.PI / 2 + 0.07;
    tipped.rotation.y = -0.75;
    tipped.position.set(-3.7, 1.0, -0.4);
    scene.add(tipped);

    // the other players' cups, mouth down; the one on the right is lifted to show its dice
    for (const [x, z, yaw] of [[-3.4, -5.6, 0.4], [1.2, -7.2, -0.3]]) {
      const c = makeCup();
      c.rotation.set(Math.PI, yaw, 0);
      c.position.set(x, 2.24, z);
      scene.add(c);
    }
    const lifted = makeCup();
    lifted.rotation.order = 'YXZ';
    lifted.rotation.set(Math.PI, -0.6, -0.55);
    lifted.position.set(4.6, 2.95, -5.0);
    scene.add(lifted);
    placeDie(5, 3.75, -4.5, 0.4);
    placeDie(1, 4.9, -4.35, -0.3);

    // the spilled dice: three fours and a wild one make the bid, a six and a two don't
    placeDie(4, -1.6, 1.15, 0.5);
    placeDie(1, -0.2, 0.35, 0.7);
    placeDie(4, 0.1, 2.0, -0.25);
    placeDie(6, 1.55, 1.05, -0.55);
    placeDie(4, 2.05, 2.75, 0.3);
    placeDie(2, 2.9, 0.1, 1.1);

    // ---------- light: one warm lamp over the table, the edges fall into shadow ----------
    scene.add(new THREE.HemisphereLight('#ffe7c2', '#0b2416', 0.12));
    const lamp = new THREE.SpotLight('#ffd9a3', 1500, 45, 0.5, 0.9, 2);
    lamp.position.set(0.5, 15, 3);
    lamp.target.position.set(0.6, 0, -0.6);
    lamp.castShadow = true;
    lamp.shadow.mapSize.set(2048, 2048);
    lamp.shadow.radius = 8;
    lamp.shadow.blurSamples = 16;
    lamp.shadow.bias = -0.0003;
    scene.add(lamp, lamp.target);
    const rim = new THREE.DirectionalLight('#8fbfff', 0.9);
    rim.position.set(-6, 6, -12);
    scene.add(rim);

    const camera = new THREE.PerspectiveCamera(30, W / H, 0.1, 100);
    camera.position.set(1.2, 5.6, 11.4);
    camera.lookAt(0.7, 0.4, -1.2);

    await renderer.compileAsync(scene, camera);
    for (let i = 0; i < 3; i++) {
      renderer.render(scene, camera);
      await new Promise(requestAnimationFrame);
    }
    window.__ready = true;
  }, BASE);
  await page.waitForFunction(() => window.__ready, null, { timeout: 240000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: OUT, type: 'jpeg', quality: 86, timeout: 240000 });
  console.log('saved', OUT);
  await browser.close();
})();
