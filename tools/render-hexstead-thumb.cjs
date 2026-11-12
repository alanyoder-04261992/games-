// Renders the Hexstead home-page thumbnail from the real 3D board.
//
//   npm start                                  (serves public/ on :8080)
//   node tools/render-hexstead-thumb.cjs [seed]
//
// Plays a few rounds with computer players to put houses, barns and trails on the island,
// frames the camera low across the board, and saves public/games/hexstead/thumb.jpg.
const path = require('node:path');
const { chromium } = require('playwright');

const SEED = Number(process.argv[2] || 21);
const ACTIONS = Number(process.argv[3] || 260);
const OUT = path.resolve(__dirname, '../public/games/hexstead/thumb.jpg');
const BASE = process.env.BASE || 'http://localhost:8080';

(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 720 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error(e));
  await page.goto(`${BASE}/`);
  await page.setContent(`<!doctype html><html><head>
    <link href="https://fonts.googleapis.com/css2?family=Roboto+Slab:wght@900&display=swap" rel="stylesheet">
    <style>html,body{margin:0;height:100%;overflow:hidden}#s{position:absolute;inset:0}</style></head>
    <body><div id="s"></div></body></html>`);
  await page.evaluate(
    async ({ base, seed, actions }) => {
      await document.fonts.load('900 100px "Roboto Slab"').catch(() => {});
      const E = await import(`${base}/games/hexstead/engine.js`);
      const { chooseAction } = await import(`${base}/games/hexstead/ai.js`);
      const { createScene } = await import(`${base}/games/hexstead/scene.js`);
      // a game in progress
      let s = E.setup({ seed, options: { target: 99 } });
      for (let i = 0; i < actions && !E.isOver(s); i++) {
        const seat = E.actors(s)[0];
        s = E.apply(s, seat, chooseAction(E.view(s, seat), E.legal(s, seat), 'hard'));
      }
      const view = E.view(s, 0);
      const scene = createScene(document.getElementById('s'));
      await scene.ready;
      scene.setBoard(view);
      scene.sync(view, { animate: false });
      scene.setCamera({ distance: 8.6, polar: 0.98, azimuth: 0.32, target: [0.15, 0, 0.55] });
      scene.rollDice([6, 2]);
      window.__ready = new Promise((r) => setTimeout(r, 2600)); // after ready: let the dice settle
    },
    { base: BASE, seed: SEED, actions: ACTIONS },
  );
  await page.evaluate(() => window.__ready);
  await page.screenshot({ path: OUT, type: 'jpeg', quality: 84 });
  console.log('saved', OUT);
  await browser.close();
})();
