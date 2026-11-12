// Broadside screen: the 3D sea (scene.js) plus the HUD — both admirals' fleet status, the
// placement controls, a mini-map of the grid you're not looking at, and the end-of-battle
// report. It draws the view it receives and sends moves back with ctx.client.act().
import { h, avatar } from '../../core/util.js';
import { sound } from '../../core/sound.js';
import { SHIPS, shipCells, randomFleet, cellName, stats } from './engine.js';
import { FLEET_COLORS } from './scene.js';

const FLEET_NAMES = ['Blue fleet', 'Red fleet'];

function shipIcon(id, sunk) {
  const len = SHIPS[id].len;
  const w = 14 + len * 12;
  const hull = sunk ? '#5b6168' : '#c9d2da';
  return `<svg viewBox="0 0 ${w} 18" width="${w}" height="18"><path d="M2 9 L${w - 12} 9 L${w - 2} 12 L${w - 6} 16 L4 16 Z" fill="${hull}" stroke="#0007" stroke-width="1"/><rect x="${w * 0.35}" y="3" width="${w * 0.22}" height="6" rx="1.5" fill="${hull}" stroke="#0007"/><rect x="${w * 0.62}" y="5.5" width="${w * 0.12}" height="3.5" fill="${hull}" stroke="#0007"/>${sunk ? `<path d="M4 3 L${w - 4} 17 M4 17 L${w - 4} 3" stroke="#ff5a4a" stroke-width="2.2" stroke-linecap="round"/>` : ''}</svg>`;
}

export function mount(ctx) {
  const root = h('div.bs');
  const stage = h('div.bs-3d');
  const top = h('div.bs-top');
  const banner = h('div.bs-banner');
  const mini = h('button.bs-mini', { title: 'Switch view' });
  const dock = h('div.bs-dock');
  const report = h('div.bs-report-host');
  root.append(stage, top, banner, mini, dock, report);
  ctx.el.append(root);

  let scene = null;
  let view = null;
  let seats = [];
  let queue = Promise.resolve();
  let busy = 0; // shot animations in flight
  const pendingShots = new Set(); // "board:i" waiting to be animated
  const pendingSunk = new Set(); // "board:id"
  let manualFocus = null;
  let plan = null; // placement in progress
  let hoverCell = null;
  let pending = false;

  import('./scene.js')
    .then(({ createScene }) => {
      try {
        scene = createScene(stage, { onCell, onHover, quality: ctx.prefs.get('bs.quality') ?? 'high' });
        if (view) sync(true);
      } catch (e) {
        console.error(e);
        stage.append(h('div.bs-nogl', h('strong', '3D graphics are not available on this device.'), h('p', 'Broadside needs WebGPU or WebGL 2. Try another browser or turn on hardware acceleration.')));
      }
    })
    .catch((e) => stage.append(h('div.bs-nogl', h('strong', 'The 3D sea could not load.'), h('p', String(e.message || e)))));

  // ---------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------
  const me = () => view?.seat ?? null;
  const mySide = () => me() ?? 0; // spectators watch from seat 0's side
  const local = (k) => (k === mySide() ? 0 : 1); // engine board -> scene board (0 = south)
  const engineBoard = (lb) => (lb === 0 ? mySide() : 1 - mySide());
  const name = (q) => (q === me() ? 'You' : seats[q]?.name || FLEET_NAMES[q]);
  const myTurn = () => view && me() != null && view.phase === 'battle' && view.turn === me();
  const placing = () => view && me() != null && view.phase === 'place' && !view.boards[me()].placed;
  function act(move) {
    if (pending) return;
    pending = true;
    ctx.client.act(move);
    setTimeout(() => (pending = false), 1200);
  }

  // ---------------------------------------------------------------------
  // placement
  // ---------------------------------------------------------------------
  function newPlan() {
    plan = { ships: {}, selected: view.fleet[0], dir: 'h', size: view.size };
  }
  const planList = () => Object.entries(plan.ships).map(([id, p]) => ({ id, ...p }));
  function planCells(exceptId) {
    const set = new Set();
    for (const s of planList()) if (s.id !== exceptId) for (const c of shipCells(plan.size, s.x, s.y, s.dir, SHIPS[s.id].len)) set.add(c);
    return set;
  }
  function fits(id, x, y, dir) {
    const cells = shipCells(plan.size, x, y, dir, SHIPS[id].len);
    if (!cells) return false;
    const taken = planCells(id);
    return cells.every((c) => !taken.has(c));
  }
  // place so the square you pointed at sits in the ship's middle when it can
  function anchor(id, x, y, dir) {
    const len = SHIPS[id].len;
    const back = Math.floor((len - 1) / 2);
    let ax = dir === 'h' ? x - back : x;
    let ay = dir === 'v' ? y - back : y;
    ax = Math.max(0, Math.min(plan.size - (dir === 'h' ? len : 1), ax));
    ay = Math.max(0, Math.min(plan.size - (dir === 'v' ? len : 1), ay));
    return [ax, ay];
  }
  function showGhost() {
    if (!scene || !placing() || !plan?.selected || !hoverCell) return scene?.setGhost(null);
    const [x, y] = anchor(plan.selected, hoverCell.x, hoverCell.y, plan.dir);
    scene.setGhost({ id: plan.selected, x, y, dir: plan.dir, ok: fits(plan.selected, x, y, plan.dir) });
  }
  function placeAt(cx, cy) {
    if (!plan.selected) {
      // pick a placed ship back up
      const i = cy * plan.size + cx;
      const s = planList().find((sh) => shipCells(plan.size, sh.x, sh.y, sh.dir, SHIPS[sh.id].len).includes(i));
      if (s) {
        delete plan.ships[s.id];
        plan.selected = s.id;
        plan.dir = s.dir;
        sound.slide();
        drawPlacement();
      }
      return;
    }
    const [x, y] = anchor(plan.selected, cx, cy, plan.dir);
    if (!fits(plan.selected, x, y, plan.dir)) {
      sound.error();
      return ctx.toast('That spot is taken or off the grid');
    }
    plan.ships[plan.selected] = { x, y, dir: plan.dir };
    sound.card();
    plan.selected = view.fleet.find((id) => !plan.ships[id]) || null;
    drawPlacement();
  }
  function drawPlacement() {
    if (!scene) return;
    scene.syncShips(0, planList(), FLEET_COLORS[mySide()]);
    showGhost();
    drawDock();
  }

  // ---------------------------------------------------------------------
  // input from the 3D sea
  // ---------------------------------------------------------------------
  function onCell(board, i, x, y) {
    if (!view) return;
    if (placing() && board === 0) return placeAt(x, y);
    if (myTurn() && board === 1 && !busy) {
      const enemy = view.boards[1 - me()];
      if (enemy.shots.some((s) => s.i === i)) return ctx.toast('Already fired there');
      act({ type: 'fire', i });
      return;
    }
    if (view.phase === 'battle' && board !== scene.focus()) setFocusManual(board);
  }
  function onHover(board, i, x, y) {
    hoverCell = board === 0 && i != null ? { x, y } : null;
    if (placing()) showGhost();
  }
  const onKey = (e) => {
    if ((e.key === 'r' || e.key === 'R') && placing()) rotate();
  };
  window.addEventListener('keydown', onKey);
  function rotate() {
    plan.dir = plan.dir === 'h' ? 'v' : 'h';
    sound.pop();
    showGhost();
    drawDock();
  }

  // ---------------------------------------------------------------------
  // state
  // ---------------------------------------------------------------------
  function render(msg) {
    const prev = view;
    view = msg.view;
    seats = msg.seats || seats;
    pending = false;
    const fresh = !prev || (view.phase === 'place' && prev.phase !== 'place') || view.size !== prev.size;
    if (fresh) {
      pendingShots.clear();
      pendingSunk.clear();
      manualFocus = null;
      plan = null;
    }
    if (placing() && !plan) newPlan();
    if (!placing()) plan = null;

    // new shots to animate
    const ev = msg.event?.action;
    if (prev && !fresh && ev?.type === 'fire' && view.last) {
      const lb = local(view.last.target);
      pendingShots.add(`${lb}:${view.last.i}`);
      if (view.last.sunk) pendingSunk.add(`${lb}:${view.last.sunk}`);
      const shot = { ...view.last };
      busy++;
      queue = queue.then(() => animateShot(shot)).finally(() => {
        busy--;
        drawAll();
      });
    }
    if (scene) sync(fresh);
    drawAll();
    if (myTurn() && !(prev && prev.phase === 'battle' && prev.turn === me())) setTimeout(() => sound.turn(), busy ? 1800 : 200);
    if (view.phase === 'over' && prev && prev.phase !== 'over') setTimeout(() => (view.winner === me() ? sound.win() : sound.bad()), busy ? 2600 : 400);
  }

  function shipsFor(lb) {
    const b = view.boards[engineBoard(lb)];
    return (b.ships || [])
      .filter((sh) => !(lb === 1 && pendingSunk.has(`${lb}:${sh.id}`)))
      .map((sh) => (pendingSunk.has(`${lb}:${sh.id}`) ? { ...sh, sunk: false } : sh));
  }

  // bring the 3D sea up to date, without animation, for everything not waiting to animate
  function sync(fresh) {
    scene.setSize(view.size);
    if (fresh) {
      scene.clearBoard(0);
      scene.clearBoard(1);
    }
    if (placing()) drawPlacement();
    else {
      scene.setGhost(null);
      for (const lb of [0, 1]) {
        const eb = engineBoard(lb);
        scene.syncShips(lb, shipsFor(lb), FLEET_COLORS[eb]);
        const shipCellsMine = new Set((view.boards[eb].ships || []).flatMap((s) => (lb === 0 || view.phase === 'over' ? s.cells : [])));
        for (const shot of view.boards[eb].shots) {
          if (pendingShots.has(`${lb}:${shot.i}`) || scene.hasMarker(lb, shot.i)) continue;
          scene.addMarker(lb, shot, lb === 0 && shipCellsMine.has(shot.i));
        }
        for (const s of view.boards[eb].ships || []) if (s.sunk && !pendingSunk.has(`${lb}:${s.id}`)) scene.quenchFires(lb, s.cells);
      }
    }
    if (!busy) focusDesired(false);
    scene.setAim(1, myTurn() && !busy);
  }

  function desiredFocus() {
    if (!view || view.phase === 'place') return 0;
    if (view.phase === 'over') return 1;
    if (manualFocus != null) return manualFocus;
    return view.turn === mySide() ? 1 : 0;
  }
  function focusDesired(animate = true) {
    const f = desiredFocus();
    if (scene && scene.focus() !== f) scene.setFocus(f, animate);
  }
  function setFocusManual(b) {
    manualFocus = b;
    scene?.setFocus(b);
    drawMini();
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  async function animateShot(shot) {
    if (!scene) return;
    const lb = local(shot.target);
    const key = `${lb}:${shot.i}`;
    manualFocus = null;
    if (scene.focus() !== lb) {
      scene.setFocus(lb);
      await wait(900);
    }
    sound.cannon();
    setTimeout(() => sound.whistle(), 120);
    await new Promise((resolve) => scene.fire({ board: lb, i: shot.i, hit: shot.hit, sunk: shot.sunk, from: 1 - lb }, resolve));
    pendingShots.delete(key);
    const eb = engineBoard(lb);
    const onMyShip = lb === 0 && shot.hit;
    scene.addMarker(lb, shot, onMyShip);
    if (shot.hit) sound.boom();
    else sound.splash();
    if (shot.sunk) {
      pendingSunk.delete(`${lb}:${shot.sunk}`);
      const ship = view.boards[eb].ships?.find((s) => s.id === shot.sunk);
      const shipName = SHIPS[shot.sunk].name;
      if (lb === 1) {
        scene.syncShips(1, shipsFor(1), FLEET_COLORS[eb], { animateSink: true });
        flash(`${me() == null ? name(shot.by) + ' sank the' : 'You sank their'} ${shipName}!`, 'good');
      } else {
        scene.sinkLater(0, shot.sunk, 500);
        flash(`${me() == null ? name(shot.by) + ' sank the' : 'Your'} ${shipName} ${me() == null ? '' : 'was sunk!'}`.replace(/\s+!/, '!'), 'bad');
      }
      if (ship) setTimeout(() => scene?.quenchFires(lb, ship.cells), 2600);
      await wait(1600);
    } else {
      showResult(shot);
      await wait(shot.hit ? 700 : 450);
    }
    drawAll();
    await wait(450);
    if (!busy || busy === 1) focusDesired();
    scene.setAim(1, myTurn() && busy <= 1);
  }

  let flashTimer = null;
  function flash(text, kind = '') {
    const el = h(`div.bs-flash.${kind || 'info'}`, text);
    root.querySelector('.bs-flash')?.remove();
    root.append(el);
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => el.classList.add('out'), 1900);
    setTimeout(() => el.remove(), 2500);
  }
  function showResult(shot) {
    const who = shot.by === me() ? 'You' : name(shot.by);
    flash(`${who}: ${cellName(view.size, shot.i)} — ${shot.hit ? 'Hit!' : 'Miss'}`, shot.hit ? (shot.by === me() ? 'good' : 'bad') : 'info');
  }

  // ---------------------------------------------------------------------
  // HUD
  // ---------------------------------------------------------------------
  function drawAll() {
    if (!view) return;
    drawTop();
    drawBanner();
    drawMini();
    drawDock();
    drawReport();
    root.classList.toggle('my-turn', !!myTurn());
  }

  function drawTop() {
    const order = [mySide(), 1 - mySide()];
    top.replaceChildren(
      ...order.map((q) => {
        const b = view.boards[q];
        // a fleet's own status: sunk ships come from the board that holds them
        const known = new Map((b.ships || []).map((s) => [s.id, s]));
        const st = stats(view, q);
        const active = (view.phase === 'battle' && view.turn === q) || (view.phase === 'place' && !b.placed);
        return h(
          `div.bs-admiral${active ? '.active' : ''}${view.winner === q ? '.won' : ''}`,
          { style: { '--c': FLEET_COLORS[q] } },
          h('div.bs-admiral-head', avatar(seats[q]?.name || FLEET_NAMES[q], seats[q]?.hue ?? 0, { bot: seats[q]?.kind === 'bot' }), h('div.bs-who', h('strong', name(q)), h('small', FLEET_NAMES[q])), view.phase === 'place' ? h('span.bs-tag', b.placed ? 'Ready' : 'Placing…') : h('span.bs-tag', `${b.afloat} afloat`)),
          h(
            'div.bs-fleet',
            view.fleet.map((id) => {
              const sunk = !!known.get(id)?.sunk && !pendingSunk.has(`${local(q)}:${id}`);
              return h('span.bs-ship-icon' + (sunk ? '.sunk' : ''), { title: `${SHIPS[id].name} (${SHIPS[id].len})${sunk ? ' — sunk' : ''}`, html: shipIcon(id, sunk) });
            }),
          ),
          view.phase !== 'place' ? h('div.bs-stats', `${st.shots} shot${st.shots === 1 ? '' : 's'} · ${st.hits} hit${st.hits === 1 ? '' : 's'} · ${st.accuracy}%`) : null,
        );
      }),
    );
  }

  function drawBanner() {
    let title = '';
    let sub = '';
    if (view.phase === 'place') {
      if (placing()) {
        const left = view.fleet.filter((id) => !plan?.ships[id]).length;
        title = left ? 'Position your fleet' : 'Fleet in position — ready?';
        sub = left ? `Tap your grid to place the ${plan?.selected ? SHIPS[plan.selected].name : 'ship'}. Tap a placed ship to move it. R or ⟳ rotates.` : 'Press Ready when you are happy, or tap a ship to move it.';
      } else title = 'Waiting for the other admiral to position their fleet…';
    } else if (view.phase === 'battle') {
      if (myTurn()) {
        title = 'Your shot — pick a square in enemy waters';
        if (view.mode === 'barrage') sub = `${view.shotsLeft} shot${view.shotsLeft === 1 ? '' : 's'} left this turn`;
        else if (view.mode === 'chain') sub = 'A hit earns another shot';
      } else title = me() == null ? `${name(view.turn)} is aiming…` : `${name(view.turn)} is taking aim…`;
    } else if (view.phase === 'over') {
      title = view.winner === me() ? 'Victory! The enemy fleet is sunk.' : me() == null ? `${name(view.winner)} wins!` : 'Defeat — your fleet is sunk.';
    }
    banner.replaceChildren(h('div.bs-banner-in', h('strong', title), sub ? h('small', sub) : null));
  }

  // a small 2D chart of the grid you're not looking at
  function drawMini() {
    if (!view || view.phase === 'place' || !scene) {
      mini.hidden = true;
      return;
    }
    mini.hidden = false;
    const lb = scene.focus() === 1 ? 0 : 1;
    const eb = engineBoard(lb);
    const N = view.size;
    const shipSet = new Set((view.boards[eb].ships || []).flatMap((s) => s.cells));
    const shots = new Map(view.boards[eb].shots.filter((s) => !pendingShots.has(`${lb}:${s.i}`)).map((s) => [s.i, s]));
    const cells = [];
    for (let i = 0; i < N * N; i++) {
      const s = shots.get(i);
      cells.push(h('i' + (shipSet.has(i) ? '.ship' : '') + (s ? (s.hit ? '.hit' : '.miss') : '')));
    }
    mini.replaceChildren(h('small', lb === 0 ? (me() == null ? FLEET_NAMES[mySide()] : 'Your fleet') : 'Enemy waters'), h('div.bs-mini-grid', { style: { '--n': N } }, cells));
    mini.onclick = () => setFocusManual(lb);
  }

  function drawDock() {
    if (!view) return;
    if (placing() && plan) {
      dock.replaceChildren(
        h(
          'div.bs-ships',
          view.fleet.map((id) =>
            h(
              'button.bs-pick' + (plan.selected === id ? '.on' : '') + (plan.ships[id] ? '.done' : ''),
              {
                onclick: () => {
                  if (plan.ships[id]) delete plan.ships[id];
                  plan.selected = id;
                  sound.pop();
                  drawPlacement();
                },
              },
              h('span.bs-pick-icon', { html: shipIcon(id, false) }),
              h('span', SHIPS[id].name),
              h('small', `${SHIPS[id].len} squares`),
            ),
          ),
        ),
        h(
          'div.bs-place-btns',
          h('button.btn.ghost', { onclick: rotate, title: 'Rotate (R)' }, plan.dir === 'h' ? '⟳ Across' : '⟳ Down'),
          h(
            'button.btn.ghost',
            {
              onclick: () => {
                plan.ships = Object.fromEntries(randomFleet(view.size, view.fleet).map(({ id, x, y, dir }) => [id, { x, y, dir }]));
                plan.selected = null;
                sound.shuffle();
                drawPlacement();
              },
            },
            'Shuffle',
          ),
          h('button.btn.ghost', { onclick: () => ((plan.ships = {}), (plan.selected = view.fleet[0]), drawPlacement()) }, 'Clear'),
          h(
            'button.btn.gold',
            {
              disabled: view.fleet.some((id) => !plan.ships[id]),
              onclick: () => act({ type: 'place', ships: planList().map(({ id, x, y, dir }) => ({ id, x, y, dir })) }),
            },
            'Ready',
          ),
        ),
      );
      return;
    }
    if (view.phase === 'battle' && scene) {
      const f = scene.focus();
      dock.replaceChildren(
        h('button.btn.ghost', { onclick: () => setFocusManual(f === 1 ? 0 : 1) }, f === 1 ? (me() == null ? 'View the other fleet' : 'View my fleet') : 'View enemy waters'),
        view.mode !== 'classic' ? h('span.bs-mode', view.mode === 'chain' ? 'Chain fire' : 'Barrage') : null,
      );
      return;
    }
    dock.replaceChildren();
  }

  function drawReport() {
    if (view.phase !== 'over' || busy) {
      report.replaceChildren();
      return;
    }
    const rows = [0, 1].map((q) => {
      const st = stats(view, q);
      return h('tr' + (view.winner === q ? '.win' : ''), h('td', h('b', { style: { color: FLEET_COLORS[q] } }, name(q))), h('td', st.shots), h('td', st.hits), h('td', `${st.accuracy}%`), h('td', view.boards[q].afloat));
    });
    report.replaceChildren(
      h(
        'div.bs-report',
        h('h3', view.winner === me() ? 'Victory' : me() == null ? `${name(view.winner)} wins` : 'Defeat'),
        h('table', h('tr', h('th', ''), h('th', 'Shots'), h('th', 'Hits'), h('th', 'Accuracy'), h('th', 'Ships left')), rows),
        h(
          'div.bs-report-btns',
          h('button.btn.ghost', { onclick: () => ctx.leave() }, 'Game Center'),
          ctx.client.isHost ? h('button.btn.gold', { onclick: () => ctx.client.send({ t: 'rematch' }) }, 'Rematch') : h('small', 'Waiting for the host…'),
        ),
      ),
    );
  }

  const off = [ctx.client.on('state', render), ctx.client.on('reject', (t) => (sound.error(), ctx.toast(t)))];
  if (ctx.client.lastState) render(ctx.client.lastState);

  return {
    destroy() {
      off.forEach((f) => f());
      window.removeEventListener('keydown', onKey);
      scene?.destroy();
      scene = null;
      root.remove();
    },
    settings: () => [
      {
        label: 'High quality graphics (sea reflections, glowing fire and lights)',
        value: (ctx.prefs.get('bs.quality') ?? 'high') === 'high',
        set: (v) => {
          ctx.prefs.set('bs.quality', v ? 'high' : 'low');
          scene?.setQuality(v ? 'high' : 'low');
        },
      },
    ],
  };
}
