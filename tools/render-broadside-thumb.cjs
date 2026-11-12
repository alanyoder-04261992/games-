// Renders the Broadside home-page thumbnail from the real 3D sea.
//
//   npm start                                  (serves public/ on :8080)
//   node tools/render-broadside-thumb.cjs
//
// Stages a battle in progress — a fleet with a burning hit, misses in the water, and a shell
// exploding on a ship — then saves public/games/broadside/thumb.jpg.
const path = require('node:path');
const { chromium } = require('playwright');

const OUT = path.resolve(__dirname, '../public/games/broadside/thumb.jpg');
const BASE = process.env.BASE || 'http://localhost:8080';

(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 720 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error(e));
  await page.goto(`${BASE}/`);
  await page.setContent(`<!doctype html><html><head>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@800&display=swap" rel="stylesheet">
    <style>html,body{margin:0;height:100%;overflow:hidden}#s{position:absolute;inset:0}</style></head>
    <body><div id="s"></div></body></html>`);
  await page.evaluate(async (base) => {
    await document.fonts.load('800 60px Inter').catch(() => {});
    const { createScene } = await import(`${base}/games/broadside/scene.js`);
    const scene = await createScene(document.getElementById('s'));
    scene.setSize(10);
    const ships = [
      { id: 'flagship', x: 1, y: 5, dir: 'h' },
      { id: 'dreadnought', x: 6, y: 2, dir: 'v' },
      { id: 'frigate', x: 2, y: 2, dir: 'h' },
      { id: 'submarine', x: 3, y: 8, dir: 'h' },
      { id: 'patrol', x: 8, y: 7, dir: 'v' },
    ];
    scene.syncShips(0, ships, '#2f6fd6');
    const cell = (x, y) => y * 10 + x;
    for (const [x, y, hit, onShip] of [[3, 5, true, true], [6, 3, true, true], [0, 1, false], [4, 3, false], [8, 4, false], [1, 8, false], [5, 6, false], [9, 1, false]])
      scene.addMarker(0, { i: cell(x, y), hit }, onShip);
    const z = scene.boardZ(0);
    // after the first resize (which re-frames the camera), move it in low across the fleet
    await new Promise((r) => setTimeout(r, 400));
    scene.setCamera([-6, 6.2, z + 8.6], [0.4, 0, z - 0.3]);
    setTimeout(() => scene.fire({ board: 0, i: cell(2, 5), hit: true, from: 1 }), 1400);
    window.__ready = new Promise((r) => setTimeout(r, 1400 + 950 + 160));
  }, BASE);
  await page.evaluate(() => window.__ready);
  await page.screenshot({ path: OUT, type: 'jpeg', quality: 84 });
  console.log('saved', OUT);
  await browser.close();
})();
