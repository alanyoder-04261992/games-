// Renders the Coastal Dogfight tile art (public/games/dogfight/tile.jpg) from the real game.
// Stages a Kestrel chasing a burning Falke over the coast on the High setting and saves the
// frame as a PNG; then shrink it to 800x480 JPEG. Needs Playwright, which is not a project dependency:
//   npm start   (in another terminal)
//   node tools/dogfight-thumbnail.cjs out.png '{"alt":700,"back":18,"camRight":7,"camUp":1.4,"fov":40,"ahead":70,"eRight":-11,"eUp":7,"eYaw":0.7,"eRoll":1.05,"lookT":0.42,"camRoll":0.22,"dz":2200,"inland":150,"nt":4,"t0":16,"tgap":15}'
const { chromium } = require('playwright');
const out = process.argv[2], cfg = JSON.parse(process.argv[3] || '{}');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const pg = await b.newPage({ viewport: { width: 1000, height: 600 }, deviceScaleFactor: 2 });
  pg.on('pageerror', e => console.log('PAGEERROR', e.message));
  await pg.addInitScript(() => localStorage.setItem('dogfight.settings', JSON.stringify({ quality: 'high', control: 'stick-assist', phone: 'off' })));
  await pg.goto('http://localhost:8080/games/dogfight/play.html');
  await pg.waitForFunction(() => window.__game && window.__game.G.state === 'menu', null, { timeout: 180000 });
  await pg.waitForFunction(() => window.__game.post, null, { timeout: 60000 }).catch(() => console.log('no bloom'));
  await pg.click('#btnQuick');
  await pg.evaluate((cfg) => {
    const g = window.__game, { G, camera, B, world } = g, { smokeFX, fireFX } = g.fx;
    g.hud = false; document.getElementById('touch').hidden = true; document.getElementById('portrait').hidden = true;
    G.mission.next = 1e9; G.state = 'paused'; window.__freeze = true;
    const V3 = camera.position.constructor, Q = camera.quaternion.constructor, E = camera.rotation.constructor;
    const z0 = world.TOWN.z + (cfg.dz ?? 1500), x0 = world.coastX(z0) - (cfg.inland ?? 250);
    const pl = G.player, Plane = pl.constructor;
    const orient = (p, yaw, pitch, roll) => { p.q.setFromEuler(new E(pitch, yaw, roll, 'YXZ')); p.axes(); };
    pl.pos.set(x0, cfg.alt ?? 430, z0); orient(pl, cfg.yaw ?? 0.25, 0.08, cfg.roll ?? 0.75);
    pl.vel.copy(pl.fwd).multiplyScalar(140); pl.gear = pl.gearT = 0; pl.rpm = 2900; pl.ctrl.roll = -0.6; pl.ctrl.pitch = 0.5; pl.visuals(0);
    // the Falke ahead, hit and burning
    const e = new Plane('falke', { id: 'shot', team: 'red', role: 'raider', skill: 'veteran' });
    const ahead = cfg.ahead ?? 95;
    e.pos.copy(pl.pos).addScaledVector(pl.fwd, ahead).addScaledVector(pl.right, cfg.eRight ?? -14).addScaledVector(pl.up, cfg.eUp ?? 9);
    orient(e, (cfg.yaw ?? 0.25) + (cfg.eYaw ?? 0.35), 0.05, cfg.eRoll ?? 0.95); e.vel.copy(e.fwd).multiplyScalar(135); e.gear = e.gearT = 0; e.rpm = 2600; e.visuals(0); G.planes.push(e);
    // smoke and fire trail behind the Falke
    for (let i = 0; i < 260; i++) {
      const t = i / 260, d = i * 0.85;
      const p = e.pos.clone().addScaledVector(e.fwd, -2 - d).addScaledVector(e.right, Math.sin(i * 0.05) * d * 0.05).addScaledVector(e.up, d * 0.04);
      p.x += (Math.random() - .5) * (0.5 + d * 0.03); p.y += (Math.random() - .5) * (0.5 + d * 0.03); p.z += (Math.random() - .5) * (0.5 + d * 0.03);
      const g = 0.1 + t * 0.28;
      smokeFX.spawn(p.x, p.y, p.z, 0, 0, 0, 8, 2.2 + d * 0.07, 0, g, g * 0.95, g * 0.9, 0.55 * (1 - t * 0.8), 0, 0, 0);
      if (i < 14) fireFX.spawn(p.x, p.y, p.z, 0, 0, 0, 8, 3.2 - i * 0.15, 0, 1, 0.62 - i * 0.02, 0.22, 0.85, 0, 0, 1);
    }
    // tracers from the Kestrel's wing guns toward the Falke
    const tgt = e.pos.clone();
    let k = 0;
    for (const gx of [-3.2, 3.2]) for (let j = 0; j < (cfg.nt ?? 3); j++) {
      const from = pl.pos.clone().addScaledVector(pl.right, gx).addScaledVector(pl.up, -0.25);
      const dir = tgt.clone().sub(from).normalize(); const dist = (cfg.t0 ?? 14) + j * (cfg.tgap ?? 24) + (gx > 0 ? 9 : 0);
      const q = from.clone().addScaledVector(dir, dist);
      B.px[k] = q.x; B.py[k] = q.y; B.pz[k] = q.z; B.vx[k] = dir.x * 380; B.vy[k] = dir.y * 380; B.vz[k] = dir.z * 380; B.tracer[k] = 1; B.cannon[k] = j % 2; B.owner[k] = pl; B.life[k] = 99; k++;
    }
    B.n = k;
    // sparks where rounds strike
    for (let i = 0; i < 10; i++) fireFX.spawn(e.pos.x + (Math.random() - .5) * 2, e.pos.y + (Math.random() - .5), e.pos.z + (Math.random() - .5) * 2, 0, 0, 0, 8, 0.7, 0, 1, 0.9, 0.6, 1, 0, 0, 1);
    // camera: behind and to the right of the Kestrel, looking past it at the Falke
    const cam = pl.pos.clone().addScaledVector(pl.fwd, -(cfg.back ?? 15)).addScaledVector(pl.right, cfg.camRight ?? 9).addScaledVector(pl.up, cfg.camUp ?? 2.5);
    camera.position.copy(cam); camera.up.set(0, 1, 0);
    const look = pl.pos.clone().lerp(e.pos, cfg.lookT ?? 0.35); camera.lookAt(look);
    camera.rotateZ(cfg.camRoll ?? 0.18);
    camera.fov = cfg.fov ?? 50; camera.updateProjectionMatrix();
    window.__shotFrozen = true;
  }, cfg);
  const data = await pg.evaluate(() => window.__game.renderNow(1.2));
  require('fs').writeFileSync(out, Buffer.from(data.split(',')[1], 'base64'));
  await b.close();
})();
