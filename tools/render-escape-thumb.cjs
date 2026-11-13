// Renders the Escape the Grind home-page thumbnail from the real 3D table.
//
//   npm start                                  (serves public/ on :8080)
//   node tools/render-escape-thumb.cjs
//
// Sets up a game in full swing (a shed, a house and stacks of coins on the near tray, pawns on
// the Grind, one player already out on the Freedom Ring, dice landing), frames the camera low
// over the near tray toward the board in the golden "boom" light, and saves
// public/games/escape-grind/thumb.jpg.
const path = require('node:path');
const { chromium } = require('playwright');

const OUT = path.resolve(__dirname, '../public/games/escape-grind/thumb.jpg');
const BASE = process.env.BASE || 'http://localhost:8080';
// camera: [position x, y, z, target x, y, z, field of view] — low behind the near tray, looking across the board
const CAM = process.env.CAM ? JSON.parse(process.env.CAM) : [2.2, 4.6, 19.5, -0.8, 0.6, 6.5, 34];
const OUT_FILE = process.env.OUT || OUT;

(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-features=WebGPU'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 720 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error(e));
  page.on('console', (m) => /THREE|rror/.test(m.text()) && console.log(m.text()));
  await page.goto(`${BASE}/`);
  await page.setContent(`<!doctype html><html><head>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@800&family=Playfair+Display:wght@900&display=swap" rel="stylesheet">
    <style>html,body{margin:0;height:100%;overflow:hidden;background:#0b0806}#s{position:absolute;inset:0}</style></head>
    <body><div id="s"></div></body></html>`);
  await page.evaluate(
    async ({ base, cam }) => {
      await Promise.all([document.fonts.load('800 40px Inter'), document.fonts.load('900 40px "Playfair Display"')]).catch(() => {});
      const { Table3D } = await import(`${base}/games/escape-grind/scene.js`);
      const table = new Table3D(document.getElementById('s'), { quality: 'high' });
      await table.ready;
      table.setMood('boom', true);
      // the board's decks, full
      for (const d of ['small', 'big', 'market', 'splurge', 'venture', 'setback']) table.setDeckSize?.(d, 30);
      // what each player owns (models are the ones the game puts on the trays)
      const asset = (id, model) => ({ id, model, flow: 100 });
      const players = [
        { assets: [asset(1, 'shed'), asset(2, 'house'), asset(3, 'storage')], stocks: { ON2U: 100 }, ventures: [], cash: 42000 },
        { assets: [asset(1, 'condo'), asset(2, 'land')], stocks: {}, ventures: [], cash: 9000 },
        { assets: [asset(1, 'plex'), asset(2, 'store'), asset(3, 'apt')], stocks: {}, ventures: [{}], cash: 60000 },
        { assets: [asset(1, 'house'), asset(2, 'shed')], stocks: { MYT4: 50 }, ventures: [], cash: 15000 },
      ];
      players.forEach((p, i) => {
        table.syncTray(i, p);
        table.setCash(i, p.cash);
      });
      // pawns: red and blue on the near side of the Grind, green further round, gold out on the Freedom Ring
      table.placePawn(0, 'grind', 1);
      table.placePawn(1, 'grind', 22);
      table.placePawn(2, 'grind', 5);
      table.placePawn(3, 'free', 2);
      table.setActive(0);
      // camera: low over the near tray, looking across the board
      table.followUntil = Infinity;
      table.focus.set(cam[3], cam[4], cam[5]);
      table.controls.target.copy(table.focus);
      table.camera.position.set(cam[0], cam[1], cam[2]);
      table.controls.update();
      // a longer lens than the game's own, so the near tray and the board both come out big
      table.camera.fov = cam[6] ?? 38;
      table.camera.updateProjectionMatrix();
      // turn the big gold coin to face the camera, and hold it there (the game spins it with the clock)
      const coin = table.bigCoin;
      coin.rotation.z = Math.atan2(cam[0] - coin.position.x, cam[2] - coin.position.z);
      Object.defineProperty(coin.rotation, 'z', { get: () => coin.rotation._z, set: () => {}, configurable: true });
      table.rollDice(0, [6, 5]);
      window.__ready = new Promise((r) => setTimeout(r, 4200)); // let the dice land
      window.__table = table;
    },
    { base: BASE, cam: CAM },
  );
  await page.evaluate(() => window.__ready);
  // software rendering (no GPU) can take well over the default 30 s for one frame
  await page.screenshot({ path: OUT_FILE, type: 'jpeg', quality: 86, timeout: 240000 });
  console.log('saved', OUT_FILE);
  await browser.close();
})();
