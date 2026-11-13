// Renders the small aircraft pictures on Coastal Dogfight's plane picker
// (public/games/dogfight/planes/<type>.jpg) from the real game: each type alone against the sky on the
// High setting, three-quarter front view, lit from the sun's side. Re-run it after changing a model.
// Needs Playwright, which is not a project dependency:
//   npm start   (in another terminal)
//   node tools/dogfight-plane-thumbs.cjs            (all types)
//   node tools/dogfight-plane-thumbs.cjs lancer     (just one)
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const outDir = path.join(__dirname, '../public/games/dogfight/planes');
const only = process.argv.slice(2);
(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const pg = await b.newPage({ viewport: { width: 640, height: 320 }, deviceScaleFactor: 1 });
  pg.on('pageerror', e => console.log('PAGEERROR', e.message));
  await pg.addInitScript(() => localStorage.setItem('dogfight.settings', JSON.stringify({ quality: 'high', control: 'stick-assist', phone: 'off' })));
  await pg.goto('http://localhost:8080/games/dogfight/play.html');
  await pg.waitForFunction(() => window.__game && window.__game.G.state === 'menu', null, { timeout: 240000 });
  await pg.click('#btnQuick'); await pg.waitForTimeout(300);
  const keys = only.length ? only : await pg.evaluate(() => Object.keys(window.__game.SPECS));
  for (const k of keys) {
    await pg.evaluate((k) => {
      const g = window.__game, { G, camera } = g; g.hud = false; document.getElementById('touch').hidden = true;
      G.mission.next = 1e9; G.state = 'paused'; document.getElementById('pause').hidden = true; window.__freeze = true;
      for (const p of G.planes) p.model.group.visible = false;
      g.fx.smokeFX.n = 0; g.fx.fireFX.n = 0;
      const E = camera.rotation.constructor, V = camera.position.constructor, Plane = G.player.constructor;
      const pl = new Plane(k, { id: 'thumb-' + k, team: 'red', role: 'raider', skill: 'veteran' }); G.planes.push(pl);
      const sunH = new V(-0.45, 0, 0.55).normalize();
      const L = pl.spec.length, span = pl.spec.span, d = Math.max(L, span) * 1.48;
      // turn the aircraft so the side the camera sees faces the sun
      let best = 0, bd = -2;
      for (let y = 0; y < 6.283; y += 0.02) { pl.q.setFromEuler(new E(0, y, 0, 'YXZ')); pl.axes(); const c = pl.right.clone().multiplyScalar(0.82).addScaledVector(pl.fwd, 0.57).normalize(); if (c.dot(sunH) > bd) { bd = c.dot(sunH); best = y; } }
      // banked toward the camera so the top of the wing shows
      pl.pos.set(1500, 1900, 1500); pl.q.setFromEuler(new E(0.08, best, -0.55, 'YXZ')); pl.axes();
      pl.vel.copy(pl.fwd).multiplyScalar(150); pl.gear = pl.gearT = 0; pl.rpm = 200; pl.throttle = 0.8; pl.boosting = false; pl.engineOn = true;
      pl.missiles = pl.spec.jet ? 6 : 2; pl.visuals(0);
      const h = new V(pl.right.x, 0, pl.right.z).normalize().multiplyScalar(0.82).addScaledVector(new V(pl.fwd.x, 0, pl.fwd.z).normalize(), 0.57).normalize();
      camera.position.copy(pl.pos).addScaledVector(h, d).add(new V(0, d * 0.12, 0));
      camera.up.set(0, 1, 0); camera.lookAt(pl.pos.clone().addScaledVector(pl.fwd, -L * 0.03).add(new V(0, -span * 0.09, 0))); camera.fov = 30; camera.updateProjectionMatrix();
    }, k);
    const png = await pg.evaluate(() => window.__game.renderNow(0));
    // shrink to 360x180 and save as JPEG
    const jpg = await pg.evaluate(async (png) => {
      const im = new Image(); im.src = png; await im.decode();
      const c = document.createElement('canvas'); c.width = 360; c.height = 180; const x = c.getContext('2d');
      x.imageSmoothingQuality = 'high'; x.drawImage(im, 0, 0, 360, 180); return c.toDataURL('image/jpeg', 0.84);
    }, png);
    fs.writeFileSync(path.join(outDir, k + '.jpg'), Buffer.from(jpg.split(',')[1], 'base64'));
    await pg.evaluate((k) => { const G = window.__game.G, p = G.planes.find(x => x.id === 'thumb-' + k); p.model.group.visible = false; }, k);
    console.log('wrote', k);
  }
  await b.close();
})();
