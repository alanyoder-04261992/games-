// Renders the Chinese Checkers home-page thumbnail from the real 3D board.
//
//   npm start                                   (serves public/ on :8080)
//   node tools/render-checkers-thumb.cjs [seed] [moves]
//
// Plays a six-player game with computer players for a while so marbles of every colour are
// out in the middle, finds Red's longest jump ladder, freezes the marble in mid-air over the
// marble it is jumping, frames the camera low across the board and saves
// public/games/chinese-checkers/thumb.jpg.
const path = require('node:path');
const { chromium } = require('playwright');

const SEED = Number(process.argv[2] || 3);
const MOVES = Number(process.argv[3] || 30);
const OUT = process.env.OUT || path.resolve(__dirname, '../public/games/chinese-checkers/thumb.jpg');
const BASE = process.env.BASE || 'http://localhost:8080';
// camera: angle round from your side, angle above the table, distance, and where it aims
// relative to the jumping marble
const CAM = { yaw: -0.3, pitch: 0.42, distance: 10, dx: 1.5, dz: -1.2, height: 1.5, ...JSON.parse(process.env.CAM || '{}') };

(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-features=WebGPU'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 720 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error(e));
  page.on('console', (m) => m.type() !== 'log' && console.log(m.type(), m.text()));
  await page.goto(`${BASE}/`);
  await page.setContent(`<!doctype html><html><head>
    <style>html,body{margin:0;height:100%;overflow:hidden;background:#0d1c14}#s{position:absolute;inset:0}</style></head>
    <body><div id="s"></div></body></html>`);
  const info = await page.evaluate(
    async ({ base, seed, moves, camJSON }) => {
      const E = await import(`${base}/games/chinese-checkers/engine.js`);
      const { choose } = await import(`${base}/games/chinese-checkers/ai.js`);
      const { layout } = await import(`${base}/games/chinese-checkers/board.js`);
      const { createScene } = await import(`${base}/games/chinese-checkers/scene.js`);
      // a game in progress: six players, everyone a few moves out of their point
      let s = E.setup({ seed, options: { players: 6 } });
      let rng = seed + 1;
      const random = () => ((rng = (rng * 16807) % 2147483647) - 1) / 2147483646;
      for (let i = 0; i < moves && !E.isOver(s); i++) {
        const seat = E.actors(s)[0];
        s = E.apply(s, seat, choose(E.view(s, seat), E.legal(s, seat), 'normal', random));
      }
      // Red to move: its longest jump ladder that heads up the board
      while (E.actors(s)[0] !== 0) {
        const seat = E.actors(s)[0];
        s = E.apply(s, seat, choose(E.view(s, seat), E.legal(s, seat), 'normal', random));
      }
      let best = null;
      for (const m of E.legal(s, 0)) {
        const p = E.destinations(s, 0, m.from).get(m.to);
        const climb = layout(m.from).py - layout(m.to).py;
        const score = p.length * 3 + climb;
        if (!best || score > best.score) best = { ...m, path: p, score };
      }
      s = E.apply(s, 0, { type: 'move', from: best.from, to: best.to });
      const view = E.view(s, 0);
      const board = await createScene(document.getElementById('s'), { onPick() {}, onHover() {}, onHop() {} });
      board.update(view, null);
      board.mark({ targets: [best.to] });
      // freeze the marble over the middle of its ladder, and look at it from low down
      const leg = Math.floor((best.path.length - 1) / 2);
      const a = layout(best.path[leg]), b = layout(best.path[leg + 1]);
      const mid = [(a.px + b.px) / 2, 0.6, (a.py + b.py) / 2];
      const cam = JSON.parse(camJSON);
      board.pose({
        yaw: cam.yaw,
        pitch: cam.pitch,
        distance: cam.distance,
        fov: 30,
        look: [mid[0] + cam.dx, 1, mid[2] + cam.dz],
        hop: { path: best.path, leg, u: 0.5, height: cam.height },
      });
      // the scene keeps the frozen marble where pose() put it only until the next update
      window.__ready = new Promise((r) => setTimeout(r, 3000));
      return { hops: best.path.length - 1, path: best.path };
    },
    { base: BASE, seed: SEED, moves: MOVES, camJSON: JSON.stringify(CAM) },
  );
  console.log('jump ladder', info);
  await page.evaluate(() => window.__ready);
  await page.screenshot({ path: OUT, type: 'jpeg', quality: 86, timeout: 240000 });
  console.log('saved', OUT);
  await browser.close();
})();
