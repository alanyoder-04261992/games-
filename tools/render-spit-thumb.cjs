// Renders the Spit & Speed home-page thumbnail: a lamp-lit red felt table with the two center
// piles, the red and blue side piles, and two cards slapped down at the same instant (an 8 onto
// the 7, a 10 onto the 9), each trailing ghost copies and casting a shadow that shows it's still
// in the air. Built with the shared three.js (public/vendor/three) and saved as
// public/games/spit-speed/thumb.jpg.
//
//   npm start                                  (serves public/ on :8080)
//   node tools/render-spit-thumb.cjs
const path = require('node:path');
const { chromium } = require('playwright');

const OUT = process.env.OUT || path.resolve(__dirname, '../public/games/spit-speed/thumb.jpg');
const BASE = process.env.BASE || 'http://localhost:8080';

(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 720 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error(e));
  page.on('console', (m) => (m.type() === 'warning' || m.type() === 'error') && console.log(m.type(), m.text()));
  await page.goto(`${BASE}/`);
  await page.setContent('<!doctype html><html><head><style>html,body{margin:0;height:100%;overflow:hidden;background:#000}canvas{display:block;position:fixed;left:0;top:0}</style></head><body></body></html>');
  await page.evaluate(async (base) => {
    const THREE = await import(`${base}/vendor/three/three.webgpu.min.js`);
    const { RoomEnvironment } = await import(`${base}/vendor/three/addons/environments/RoomEnvironment.js`);

    const W = innerWidth;
    const H = innerHeight;
    const adapter = navigator.gpu ? await navigator.gpu.requestAdapter().catch(() => null) : null;
    const renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL: !adapter });
    renderer.setPixelRatio(2); // drawn at twice the size, so the screenshot is smooth
    renderer.setSize(W, H);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.VSMShadowMap;
    document.body.append(renderer.domElement);
    await renderer.init();

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#120203');
    scene.fog = new THREE.Fog('#120203', 14, 25); // the far side of the table fades into the dark
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.3;

    // seeded randomness, so the render is the same every time
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

    // ---------- felt ----------
    function feltTexture() {
      const c = document.createElement('canvas');
      c.width = c.height = 512;
      const g = c.getContext('2d');
      g.fillStyle = '#741417';
      g.fillRect(0, 0, 512, 512);
      const img = g.getImageData(0, 0, 512, 512);
      for (let i = 0; i < img.data.length; i += 4) {
        const n = (rand() - 0.5) * 28;
        img.data[i] += n;
        img.data[i + 1] += n * 0.45;
        img.data[i + 2] += n * 0.45;
      }
      g.putImageData(img, 0, 0);
      const t = new THREE.CanvasTexture(c);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(12, 12);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    }
    const felt = new THREE.Mesh(new THREE.PlaneGeometry(70, 70), new THREE.MeshStandardMaterial({ map: feltTexture(), roughness: 1, metalness: 0 }));
    felt.rotation.x = -Math.PI / 2;
    felt.receiveShadow = true;
    scene.add(felt);

    // ---------- card faces and backs (drawn on canvases) ----------
    const SUIT_PATHS = {
      H: 'M50 90 C20 68 4 50 4 31 C4 15 16 5 29 5 C39 5 46 11 50 21 C54 11 61 5 71 5 C84 5 96 15 96 31 C96 50 80 68 50 90Z',
      D: 'M50 3 L86 50 L50 97 L14 50Z',
      S: 'M50 3 C40 22 6 38 6 60 C6 75 17 83 29 83 C38 83 44 79 47 73 C46 84 42 91 34 96 H66 C58 91 54 84 53 73 C56 79 62 83 71 83 C83 83 94 75 94 60 C94 38 60 22 50 3Z',
      C: 'M50 6 A21 21 0 0 1 66 41 A21 21 0 1 1 55 73 C55 84 59 91 66 96 H34 C41 91 45 84 45 73 A21 21 0 1 1 34 41 A21 21 0 0 1 50 6Z',
    };
    const RED = { H: true, D: true };
    const LAYOUT = {
      5: { side: [0, 1], mid: [0.5] },
      6: { side: [0, 0.5, 1], mid: [] },
      7: { side: [0, 0.5, 1], mid: [0.25] },
      8: { side: [0, 0.5, 1], mid: [0.25, 0.75] },
      9: { side: [0, 1 / 3, 2 / 3, 1], mid: [0.5] },
      10: { side: [0, 1 / 3, 2 / 3, 1], mid: [1 / 6, 5 / 6] },
    };
    const CW = 500;
    const CH = 700;
    function roundRect(g, x, y, w, h, r) {
      g.beginPath();
      g.moveTo(x + r, y);
      g.arcTo(x + w, y, x + w, y + h, r);
      g.arcTo(x + w, y + h, x, y + h, r);
      g.arcTo(x, y + h, x, y, r);
      g.arcTo(x, y, x + w, y, r);
      g.closePath();
    }
    function drawSuit(g, s, x, y, size, flip) {
      g.save();
      g.translate(x, y);
      if (flip) g.rotate(Math.PI);
      g.scale(size / 100, size / 100);
      g.translate(-50, -50);
      g.fill(new Path2D(SUIT_PATHS[s]));
      g.restore();
    }
    function faceTexture(rank, s) {
      const c = document.createElement('canvas');
      c.width = CW;
      c.height = CH;
      const g = c.getContext('2d');
      const grad = g.createLinearGradient(0, 0, 0, CH);
      grad.addColorStop(0, '#fffdf7');
      grad.addColorStop(1, '#efe8d8');
      g.fillStyle = grad;
      g.fillRect(0, 0, CW, CH);
      g.strokeStyle = 'rgba(0,0,0,.12)';
      g.lineWidth = 6;
      roundRect(g, 3, 3, CW - 6, CH - 6, 40);
      g.stroke();
      const ink = RED[s] ? '#b40d22' : '#15171d';
      g.fillStyle = ink;
      const { side, mid } = LAYOUT[rank];
      const y = (t) => CH * 0.19 + t * CH * 0.62;
      const p = CW * 0.21;
      for (const t of side) for (const x of [CW * 0.3, CW * 0.7]) drawSuit(g, s, x, y(t), p, t > 0.5);
      for (const t of mid) drawSuit(g, s, CW / 2, y(t), p, t > 0.5);
      for (const flip of [false, true]) {
        g.save();
        if (flip) {
          g.translate(CW, CH);
          g.rotate(Math.PI);
        }
        g.font = `bold ${rank === 10 ? 76 : 88}px Georgia, 'DejaVu Serif', serif`;
        g.textAlign = 'center';
        g.fillText(String(rank), 62, 104);
        drawSuit(g, s, 62, 158, 62, false);
        g.restore();
      }
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      return t;
    }
    function backTexture(a, b) {
      const c = document.createElement('canvas');
      c.width = CW;
      c.height = CH;
      const g = c.getContext('2d');
      g.fillStyle = '#fbf7ee';
      g.fillRect(0, 0, CW, CH);
      g.save();
      roundRect(g, 30, 30, CW - 60, CH - 60, 22);
      g.clip();
      g.fillStyle = a;
      g.fillRect(0, 0, CW, CH);
      g.strokeStyle = b;
      g.lineWidth = 15;
      for (let d = -CH; d < CW + CH; d += 30) {
        g.beginPath();
        g.moveTo(d, 0);
        g.lineTo(d - CH, CH);
        g.stroke();
        g.beginPath();
        g.moveTo(d - CH, 0);
        g.lineTo(d, CH);
        g.stroke();
      }
      g.restore();
      g.strokeStyle = 'rgba(255,255,255,.7)';
      g.lineWidth = 8;
      roundRect(g, 52, 52, CW - 104, CH - 104, 14);
      g.stroke();
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      return t;
    }
    const BACKS = { red: backTexture('#c32e2a', '#9c1f1c'), blue: backTexture('#2f66cc', '#1d469d') };

    // ---------- card meshes ----------
    // A card is a rounded rectangle 2.5 x 3.5 lying in the XZ plane, face up, with a thin edge.
    const CARD_W = 2.5;
    const CARD_H = 3.5;
    const THICK = 0.022;
    const shape = new THREE.Shape();
    {
      const w = CARD_W / 2;
      const h = CARD_H / 2;
      const r = 0.18;
      shape.moveTo(-w + r, -h);
      shape.lineTo(w - r, -h);
      shape.quadraticCurveTo(w, -h, w, -h + r);
      shape.lineTo(w, h - r);
      shape.quadraticCurveTo(w, h, w - r, h);
      shape.lineTo(-w + r, h);
      shape.quadraticCurveTo(-w, h, -w, h - r);
      shape.lineTo(-w, -h + r);
      shape.quadraticCurveTo(-w, -h, -w + r, -h);
    }
    const faceGeo = new THREE.ShapeGeometry(shape, 12);
    {
      // ShapeGeometry's UVs are the raw x, y: map them onto 0..1 across the card
      const uv = faceGeo.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / CARD_W + 0.5, uv.getY(i) / CARD_H + 0.5);
    }
    const edgeGeo = new THREE.ExtrudeGeometry(shape, { depth: THICK, bevelEnabled: false, curveSegments: 12 });
    const edgeMat = new THREE.MeshStandardMaterial({ color: '#e9e2d0', roughness: 0.6 });
    const faceCache = new Map();
    function faceMat(rank, s, opacity = 1) {
      const key = `${rank}${s}`;
      if (!faceCache.has(key)) faceCache.set(key, faceTexture(rank, s));
      return new THREE.MeshPhysicalMaterial({ map: faceCache.get(key), roughness: 0.42, clearcoat: 0.35, clearcoatRoughness: 0.3, transparent: opacity < 1, opacity, depthWrite: opacity === 1 });
    }
    const backMat = (color) => new THREE.MeshPhysicalMaterial({ map: BACKS[color], roughness: 0.45, clearcoat: 0.35, clearcoatRoughness: 0.3 });

    // front: the face (or a back, for face-down cards); rear: a back
    function makeCard(front, rearColor = 'red', { ghost = 0 } = {}) {
      const g = new THREE.Group();
      const top = new THREE.Mesh(faceGeo, front);
      top.rotation.x = -Math.PI / 2;
      top.position.y = THICK / 2 + 0.001;
      g.add(top);
      if (!ghost) {
        const edge = new THREE.Mesh(edgeGeo, edgeMat);
        edge.rotation.x = -Math.PI / 2;
        edge.position.y = -THICK / 2;
        const rear = new THREE.Mesh(faceGeo, backMat(rearColor));
        rear.rotation.x = Math.PI / 2;
        rear.position.y = -THICK / 2 - 0.001;
        g.add(edge, rear);
        g.traverse((m) => m.isMesh && ((m.castShadow = true), (m.receiveShadow = true)));
      }
      return g;
    }

    // a center pile: a messy stack, a few named cards peeking out, then the top card
    function pile(x, z, under, topCard, topYaw) {
      let y = THICK / 2;
      for (let i = 0; i < 9; i++) {
        const peek = under[i - 9 + under.length];
        const mat = peek ? faceMat(...peek) : faceMat(5 + Math.floor(rand() * 6), 'SHDC'[Math.floor(rand() * 4)]);
        const c = makeCard(mat);
        c.position.set(x + (rand() - 0.5) * 0.35, y, z + (rand() - 0.5) * 0.35);
        c.rotation.y = (rand() - 0.5) * 0.7;
        scene.add(c);
        y += THICK + 0.004;
      }
      const t = makeCard(faceMat(...topCard));
      t.position.set(x, y, z);
      t.rotation.y = topYaw;
      scene.add(t);
    }
    // a side pile: a neat stack of backs
    function sidePile(x, z, color, yaw, n = 14) {
      for (let i = 0; i < n; i++) {
        const c = makeCard(backMat(color), color);
        c.position.set(x + (rand() - 0.5) * 0.06, THICK / 2 + i * (THICK + 0.004), z + (rand() - 0.5) * 0.06);
        c.rotation.y = yaw + (rand() - 0.5) * 0.05;
        scene.add(c);
      }
    }
    // a card in the air, with fading ghost copies back along the way it came
    function flying(rank, s, rear, pos, rot, from) {
      const c = makeCard(faceMat(rank, s), rear);
      c.position.set(...pos);
      c.rotation.set(...rot);
      scene.add(c);
      for (let i = 1; i <= 3; i++) {
        const k = i / 3;
        const ghost = makeCard(faceMat(rank, s, 0.2 * (1 - k) + 0.05), rear, { ghost: true });
        ghost.position.set(pos[0] + (from[0] - pos[0]) * k, pos[1] + (from[1] - pos[1]) * k, pos[2] + (from[2] - pos[2]) * k);
        ghost.rotation.set(rot[0] * (1 + k * 0.6), rot[1] + k * 0.25, rot[2] * (1 + k * 0.6));
        scene.add(ghost);
      }
    }

    // ---------- the table ----------
    pile(-1.75, 0.1, [[5, 'S'], [6, 'H']], [7, 'C'], -0.06);
    pile(1.75, -0.1, [[10, 'D'], [8, 'C']], [9, 'H'], 0.08);
    sidePile(-5.1, 0.3, 'red', 0.12);
    sidePile(5.1, -0.3, 'blue', -0.1);

    // the other player's hand, face down across the table
    for (let i = 0; i < 5; i++) {
      const c = makeCard(backMat('blue'), 'blue');
      c.position.set(-1.6 + i * 0.8, 0.02 + i * 0.03, -7.2 - Math.abs(i - 2) * 0.12);
      c.rotation.set(0, Math.PI + (i - 2) * 0.16, 0);
      scene.add(c);
    }

    // the slap: an 8 from your side onto the 7, a 10 from theirs onto the 9 — both at once
    flying(8, 'D', 'red', [-2.75, 1.8, 2.35], [-0.3, 0.35, 0.1], [-4.9, 1.3, 5.6]);
    flying(10, 'S', 'blue', [2.4, 1.8, -2.1], [0.25, -0.3, -0.12], [4.2, 2.2, -5.6]);

    // ---------- light: a warm lamp over the middle, edges falling into shadow ----------
    scene.add(new THREE.HemisphereLight('#ffe7c2', '#2a0606', 0.18));
    const lamp = new THREE.SpotLight('#ffdcab', 1500, 45, 0.48, 0.95, 2);
    lamp.position.set(0.4, 15, 2.5);
    lamp.target.position.set(0, 0, -0.3);
    lamp.castShadow = true;
    lamp.shadow.mapSize.set(2048, 2048);
    lamp.shadow.radius = 6;
    lamp.shadow.blurSamples = 16;
    lamp.shadow.bias = -0.0004;
    scene.add(lamp, lamp.target);
    const rim = new THREE.DirectionalLight('#9cc4ff', 0.8);
    rim.position.set(-6, 6, -12);
    scene.add(rim);

    const camera = new THREE.PerspectiveCamera(31, W / H, 0.1, 100);
    camera.position.set(0, 10.4, 11.8);
    camera.lookAt(0, 0.4, -0.4);

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
