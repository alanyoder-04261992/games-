// Renders the Ridgeline Rally tile art (public/games/rally/tile.jpg) from the real game.
// Runs a race of computer cars for a few seconds on the High setting, freezes it with the
// pack bunched up, and frames them from the roadside ahead. Saves a PNG; then shrink it to an
// 800x480 JPEG. Needs Playwright, which is not a project dependency:
//   npm start   (in another terminal)
//   node tools/rally-thumbnail.cjs out.png '{"track":"lakeside","t":15,"ahead":26,"side":-7,"up":2.2,"fov":38}'
const { chromium } = require('playwright');
const out = process.argv[2], cfg = JSON.parse(process.argv[3] || '{}');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const pg = await b.newPage({ viewport: { width: 1000, height: 600 }, deviceScaleFactor: 2 });
  pg.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await pg.addInitScript((c) => localStorage.setItem('rally.settings', JSON.stringify({ quality: 'high', phone: 'off', track: c.track || 'ridgeline', opponents: c.opp ?? 5, car: c.car || 'vela', color: c.color ?? 1, difficulty: 'pro' })), cfg);
  await pg.goto('http://localhost:8080/games/rally/play.html');
  await pg.waitForFunction(() => window.__game && window.__game.G.state === 'menu', null, { timeout: 180000 });
  await pg.waitForFunction(() => window.__game.post, null, { timeout: 60000 }).catch(() => console.log('no bloom'));
  const info = await pg.evaluate(async (cfg) => {
    const g = window.__game, { RACE, T, camera } = g;
    await g.startRace('race');
    window.__autodrive = true;
    window.__sim(cfg.t ?? 15);
    window.__freeze = true; g.hud = false;
    // frame the pack from the roadside a little way ahead of the leader
    const lead = RACE.order[0], back = RACE.order[Math.min(RACE.order.length - 1, cfg.packN ?? 3)];
    const i = (lead.idx + Math.round((cfg.ahead ?? 26) / T.ds)) % T.N, f = g.frameAt(i);
    camera.position.set(f.x + f.rx * (cfg.side ?? -7), f.h + (cfg.up ?? 2.2), f.z + f.rz * (cfg.side ?? -7));
    camera.up.set(0, 1, 0);
    camera.lookAt((lead.x + back.x) / 2, (lead.y + back.y) / 2 + 0.6, (lead.z + back.z) / 2);
    camera.fov = cfg.fov ?? 38; camera.updateProjectionMatrix();
    return RACE.order.map((c) => `${c.label}:${c.idx}`).join(' ');
  }, cfg);
  console.log(info);
  const data = await pg.evaluate(() => window.__game.renderNow());
  require('fs').writeFileSync(out, Buffer.from(data.split(',')[1], 'base64'));
  await b.close();
})();
