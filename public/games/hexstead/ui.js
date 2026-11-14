// Hexstead screen: the 3D island (scene.js) plus the table around it — player panels, your
// hand, build and trade controls, and the little pop-up sheets for discards, offers and cards.
// It only draws the view it receives and sends moves back with ctx.client.act().
import { h, avatar } from '../../core/util.js';
import { sound } from '../../core/sound.js';
import {
  RES, RES_LABEL, COST, CARDS, TERRAIN, canPay, total, ratio, homesteadSpots, roadSpots, townSpots, banditHexes, banditTargets, playable, actors, harvestNumbers,
} from './engine.js';
import { board } from './geometry.js';
import { SEAT_COLORS, SEAT_NAMES, SEAT_INK, RES_ICON, RES_COLORS, CARD_ICON, PIECE_ICON, DICE_ICON } from './art.js';

const PLAYABLE_CARDS = ['sheriff', 'trailblazer', 'harvest', 'market', 'landmark'];

export function mount(ctx) {
  const root = h('div.hx');
  const stage3d = h('div.hx-3d');
  const players = h('div.hx-players');
  const banner = h('div.hx-banner');
  const logBox = h('div.hx-log');
  const hand = h('div.hx-hand');
  const actionsBar = h('div.hx-actions');
  const dock = h('div.hx-dock', hand, actionsBar);
  const sheetHost = h('div.hx-sheet-host');
  const toolbar = h(
    'div.hx-tools',
    h('button.hx-tool', { title: 'Reset camera', onclick: () => scene?.resetCamera(), html: '<svg viewBox="0 0 24 24"><path d="M12 5a7 7 0 1 1-6.6 4.7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M4 4v5h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' }),
    h('button.hx-tool', { title: 'Game log', onclick: () => root.classList.toggle('log-open'), html: '<svg viewBox="0 0 24 24"><path d="M5 6h14M5 12h14M5 18h9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' }),
    h('button.hx-tool', { title: 'Building costs', onclick: () => openSheet({ type: 'costs' }), html: '<svg viewBox="0 0 24 24"><path d="M4 20V10l8-6 8 6v10z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M10 20v-5h4v5" fill="none" stroke="currentColor" stroke-width="2"/></svg>' }),
  );
  root.append(stage3d, players, banner, toolbar, logBox, dock, sheetHost);
  ctx.el.append(root);
  // touch tablets (an iPad in landscape is ~1180 wide) keep the island clear: the log starts closed
  const coarse = window.matchMedia?.('(pointer: coarse)').matches;
  if (ctx.prefs.get('hx.log') ?? window.innerWidth > (coarse ? 1400 : 900)) root.classList.add('log-open');

  let scene = null;
  let view = null;
  let seats = [];
  let mode = null; // 'road' | 'homestead' | 'town' while choosing a spot
  let sheet = null;
  let lastLog = 0;
  let pending = false;
  let armed = null; // a spot chosen with one tap, waiting for the second (touch screens)
  let quality = ctx.prefs.get('hx.quality') ?? 'high';
  const autoDecline = () => ctx.prefs.get('hx.autoDecline') ?? false;

  let gone = false;
  const noGL = (e) => {
    console.error(e);
    stage3d.append(h('div.hx-nogl', h('strong', '3D graphics are not available on this device.'), h('p', 'Hexstead needs WebGPU or WebGL 2. Try another browser or turn on hardware acceleration.')));
  };
  import('./scene.js')
    .then(({ createScene }) => {
      if (gone) return;
      try {
        scene = createScene(stage3d, {
          onPick: pick,
          // a first tap on a touch screen picks the spot; say how to confirm it
          onArm: (kind) => {
            armed = kind;
            if (view) drawBanner();
          },
        });
        if (quality === 'low') scene.setQuality(false);
        if (view) {
          scene.setBoard(view);
          scene.sync(view, { animate: false });
          updateTargets();
        }
      } catch (e) {
        noGL(e);
        return;
      }
      // the renderer starts asynchronously; if neither WebGPU nor WebGL 2 comes up, say so
      const s = scene;
      s.ready.catch((e) => {
        if (gone || scene !== s) return;
        s.destroy();
        scene = null;
        noGL(e);
      });
    })
    .catch((e) => {
      console.error(e);
      stage3d.append(h('div.hx-nogl', h('strong', 'The 3D board could not load.'), h('p', String(e.message || e))));
    });

  // ---------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------
  const me = () => view?.seat;
  const mine = () => (me() != null ? view.players[me()] : null);
  const myTurn = () => view && me() != null && actors(view).includes(me());
  const seatList = () => view.players.map((_, q) => q);
  // may I build right now? (my turn after rolling, or my slot in barn raising)
  const building = () => view && me() != null && ((view.phase === 'main' && view.current === me()) || (view.phase === 'raise' && view.raiseQueue?.[0] === me()));
  const name = (q) => (q === me() ? 'You' : seats[q]?.name || SEAT_NAMES[q]);
  const nameEl = (q) => h('b.hx-name', { style: { '--c': SEAT_COLORS[q] } }, name(q));
  const resIcon = (r, cls = '') => h('span.hx-ricon' + cls, { html: RES_ICON[r], title: RES_LABEL[r] });
  // one light chip per resource: the icon on parchment, underlined in the resource's colour,
  // with the count beside it. `have` (my hand) marks the ones I'm short of.
  const resChip = (r, n, have) =>
    h(
      'span.hx-cc' + (have && have[r] < n ? '.short' : '') + (n === 1 ? '.one' : ''),
      { style: { '--rc': RES_COLORS[r][0] }, title: `${n} ${RES_LABEL[r]}${have && have[r] < n ? ` (you have ${have[r]})` : ''}` },
      h('span.hx-cc-i', { html: RES_ICON[r] }),
      n > 1 || have ? h('b', n) : null,
    );
  const costChips = (cost, have) =>
    h(
      'span.hx-cost',
      Object.entries(cost).map(([r, n]) => resChip(r, n, have)),
    );
  const resList = (obj) =>
    h(
      'span.hx-reslist',
      Object.entries(obj || {})
        .filter(([, n]) => n > 0)
        .map(([r, n]) => resChip(r, n)),
    );
  function act(move) {
    if (pending) return;
    pending = true;
    ctx.client.act(move);
    setTimeout(() => (pending = false), 1500);
  }

  // ---------------------------------------------------------------------
  // board clicks
  // ---------------------------------------------------------------------
  function pick(kind, id) {
    if (!view || !myTurn() || kind == null) return;
    const p = me();
    if (view.phase === 'setup') {
      if (kind === 'vertex') act({ type: 'homestead', v: id });
      if (kind === 'edge') act({ type: 'road', e: id });
      sound.pop();
      return;
    }
    if (view.phase === 'roads' && kind === 'edge') return act({ type: 'road', e: id });
    if (view.phase === 'bandit' && kind === 'hex') {
      const victims = banditTargets(view, p, id);
      if (victims.length <= 1) return act({ type: 'bandit', hex: id, victim: victims[0] ?? null });
      return openSheet({ type: 'victim', hex: id, victims });
    }
    if ((view.phase === 'main' || view.phase === 'raise') && mode) {
      const m = mode;
      mode = null;
      if (m === 'road') act({ type: 'road', e: id });
      else act({ type: m, v: id });
      sound.pop();
    }
  }

  function targetsFor() {
    if (!view || !myTurn() || view.phase === 'over') return null;
    const p = me();
    switch (view.phase) {
      case 'setup':
        return view.setupVert == null
          ? { kind: 'vertex', ids: homesteadSpots(view, p, true), seat: p, piece: 'homestead' }
          : { kind: 'edge', ids: board(view.size).VERTS[view.setupVert].edges.filter((e) => view.roads[e] == null), seat: p, piece: 'road' };
      case 'roads':
        return { kind: 'edge', ids: roadSpots(view, p), seat: p, piece: 'road' };
      case 'bandit':
        return { kind: 'hex', ids: banditHexes(view, p) };
      case 'raise':
      case 'main':
        if (mode === 'road') return { kind: 'edge', ids: roadSpots(view, p), seat: p, piece: 'road' };
        if (mode === 'homestead') return { kind: 'vertex', ids: homesteadSpots(view, p), seat: p, piece: 'homestead' };
        if (mode === 'town') return { kind: 'vertex', ids: townSpots(view, p), seat: p, piece: 'town' };
    }
    return null;
  }
  function updateTargets() {
    scene?.setTargets(targetsFor());
  }

  // ---------------------------------------------------------------------
  // state
  // ---------------------------------------------------------------------
  function render(msg) {
    const prev = view;
    view = msg.view;
    seats = msg.seats || seats;
    pending = false;
    const ev = msg.event;
    if (!building()) mode = null;
    if (mode && !canBuild(mode)) mode = null;

    if (scene) {
      scene.setBoard(view);
      const animate = !!prev && !!ev?.action;
      scene.sync(view, { animate });
      if (animate) animateEvent(ev, prev);
      updateTargets();
    }
    soundFor(ev, prev);
    drawPlayers();
    drawBanner();
    drawLog(!prev);
    drawHand();
    drawActions();
    autoSheets(prev);
    renderSheet();
    root.classList.toggle('my-turn', !!myTurn());
  }

  function animateEvent(ev, prev) {
    const a = ev.action;
    if (a.type === 'roll' && view.dice) {
      scene.rollDice(view.dice);
      // with fast harvest each die's own number lights up too
      const nums = harvestNumbers(view, view.dice);
      setTimeout(() => {
        if (!scene) return;
        for (const n of nums) scene.pulseNumber(n, view.bandit);
        if (view.gains) scene.floatGains(view.gains, view, 200);
      }, 1050);
      return;
    }
    if (view.gains) scene.floatGains(view.gains, view, a.type === 'homestead' ? 500 : 0);
  }

  function soundFor(ev, prev) {
    const a = ev?.action;
    if (!a || !prev) {
      if (ev?.type === 'start') sound.shuffle();
      return;
    }
    if (a.type === 'roll') {
      sound.deal(5);
      setTimeout(() => {
        const sum = view.dice?.[0] + view.dice?.[1];
        if (sum === 7) sound.bad();
        else if (view.gains?.[me()]) sound.good();
        else sound.chip();
      }, 1100);
    } else if (a.type === 'homestead' || a.type === 'town' || a.type === 'road') setTimeout(() => sound.card(), 380);
    else if (a.type === 'buy' || a.type === 'play') sound.slide();
    else if (a.type === 'bank' || a.type === 'accept-trade') sound.chip();
    else if (a.type === 'bandit') setTimeout(() => sound.sweep(), 500);
    else if (a.type === 'offer') sound.pop();
    if (view.phase === 'over' && prev.phase !== 'over') setTimeout(() => (view.winner === me() ? sound.win() : sound.bad()), 700);
    else if (myTurn() && !(prev && actors(prev).includes(me()))) setTimeout(() => sound.turn(), 250);
    // someone took a card from you
    const steal = view.log.at(-1);
    if (a.type === 'bandit' && steal?.k === 'steal' && steal.from === me() && steal.i > lastLog - 1) ctx.toast(`${name(steal.p)} took your ${RES_LABEL[steal.res] || 'card'}`);
  }

  // ---------------------------------------------------------------------
  // players
  // ---------------------------------------------------------------------
  function drawPlayers() {
    root.classList.toggle('many', view.players.length > 4);
    root.classList.toggle('lots', view.players.length > 6);
    requestAnimationFrame(() => root.style.setProperty('--top', `${players.offsetTop + players.offsetHeight + 10}px`));
    players.replaceChildren(
      ...seatList().map((q) => {
        const pl = view.players[q];
        const isTurn = view.current === q && view.phase !== 'over';
        const acting = actors(view).includes(q) && !isTurn;
        const pts = pl.points != null && pl.points !== pl.vp ? `${pl.vp}+${pl.points - pl.vp}` : String(pl.points ?? pl.vp);
        return h(
          `div.hx-player` + (isTurn ? '.turn' : '') + (acting ? '.acting' : '') + (view.winner === q ? '.won' : '') + (q === me() ? '.me' : ''),
          { style: { '--c': SEAT_COLORS[q], '--ink': SEAT_INK[q] } },
          h('div.hx-player-top', avatar(seats[q]?.name || SEAT_NAMES[q], seats[q]?.hue ?? 0, { bot: seats[q]?.kind === 'bot' }), h('div.hx-player-name', h('strong', name(q)), h('small', SEAT_NAMES[q])), h('div.hx-vp', { title: 'Points' }, pts)),
          h(
            'div.hx-player-stats',
            h('span', { title: 'Resource cards' }, h('i.hx-mini-card'), pl.resCount),
            h('span', { title: 'Almanac cards' }, h('i.hx-mini-card.al'), pl.cardCount),
            h('span', { title: 'Sheriffs played' }, h('i', { html: CARD_ICON.sheriff }), pl.sheriffs),
            h('span', { title: 'Longest trail' }, h('i', { html: PIECE_ICON.road(SEAT_COLORS[q]) }), view.trailLen[q]),
          ),
          h(
            'div.hx-badges',
            view.trailHolder === q ? h('span.hx-badge', 'Longest Trail') : null,
            view.posseHolder === q ? h('span.hx-badge', 'Big Posse') : null,
            acting ? h('span.hx-badge.wait', view.phase === 'discard' ? 'Discarding' : view.phase === 'raise' ? 'Building' : 'Deciding') : null,
          ),
        );
      }),
    );
  }

  // ---------------------------------------------------------------------
  // banner
  // ---------------------------------------------------------------------
  function drawBanner() {
    const p = me();
    const cur = view.current;
    let title = '';
    let sub = '';
    const dice = view.dice ? h('span.hx-dice-mini', { html: DICE_ICON }) : null;
    switch (view.phase) {
      case 'setup': {
        const second = view.step >= 4;
        if (cur === p) {
          title = view.setupVert == null ? (second ? 'Place your second homestead' : 'Place your first homestead') : 'Add a trail next to it';
          sub = view.setupVert == null ? (second ? 'You collect one of each resource around it.' : 'Pick a glowing corner — high numbers with dots roll most often.') : 'Tap a glowing edge.';
        } else title = `${name(cur)} is settling…`;
        break;
      }
      case 'roll':
        title = cur === p ? 'Your turn — roll the dice' : `${name(cur)}'s turn`;
        break;
      case 'main':
        title = cur === p ? (mode ? `Pick a spot for your ${mode === 'road' ? 'trail' : mode === 'town' ? 'barn' : 'homestead'}` : 'Build, trade, or end your turn') : `${name(cur)} is building…`;
        if (view.dice) {
          const [d1, d2] = view.dice;
          sub = view.fastHarvest ? `Rolled ${d1} + ${d2} = ${d1 + d2} · ${harvestNumbers(view, view.dice).join(', ') || 'nothing'} paid` : `Rolled ${d1 + d2}`;
        }
        break;
      case 'raise': {
        const who = view.raiseQueue?.[0];
        title = who === p ? (mode ? `Barn raising — pick a spot for your ${mode === 'road' ? 'trail' : mode === 'town' ? 'barn' : 'homestead'}` : 'Barn raising — build before the next turn') : `${name(who)} is barn raising…`;
        sub = who === p ? 'Build or buy an almanac card now, or tap Done. No trading between turns.' : `${name((cur + 1) % view.players.length)} plays next`;
        break;
      }
      case 'discard': {
        const owe = view.discard?.[p] || 0;
        title = owe ? `Seven! Discard ${owe} cards` : 'Seven! Players with more than 7 cards discard half';
        break;
      }
      case 'bandit':
        title = cur === p ? 'Move the bandit' : `${name(cur)} is moving the bandit…`;
        sub = cur === p ? 'Tap a hex. It stops producing, and you take a card from someone there.' : '';
        break;
      case 'roads':
        title = cur === p ? `Place a free trail (${view.freeRoads} left)` : `${name(cur)} is blazing trails…`;
        break;
      case 'trade':
        title = view.trade.from === p ? 'Waiting for answers to your offer' : `${name(view.trade.from)} wants to trade`;
        break;
      case 'over':
        title = view.winner === p ? 'You win!' : `${name(view.winner)} wins!`;
        sub = `${view.players[view.winner].points} points`;
        break;
    }
    if (armed && myTurn()) sub = armed === 'hex' ? 'Tap the same tile again to send the bandit there.' : 'Tap it again to build there — or tap another glowing spot.';
    banner.replaceChildren(h('div.hx-banner-in' + (armed && myTurn() ? '.armed' : ''), h('strong', title), sub ? h('small', armed && myTurn() ? null : dice, sub) : null));
  }

  // ---------------------------------------------------------------------
  // log
  // ---------------------------------------------------------------------
  function logLine(e) {
    const P = (q) => nameEl(q);
    switch (e.k) {
      case 'start':
        return [P(e.p), e.p === me() ? ' go first' : ' goes first'];
      case 'turn':
        return null;
      case 'roll':
        return [P(e.p), ` rolled `, h('b.hx-roll', String(e.dice[0] + e.dice[1]))];
      case 'gain':
        if (!Object.keys(e.gains).length) return e.sum ? ['Nobody collects'] : null;
        return Object.entries(e.gains).map(([q, res]) => h('div', P(Number(q)), ' +', resList(res)));
      case 'build':
        return [P(e.p), ` ${e.free ? 'blazed' : 'built'} a ${e.what === 'road' ? 'trail' : e.what === 'town' ? 'barn' : 'homestead'}`];
      case 'buy':
        return [P(e.p), ' bought an almanac card', e.card ? ` (${CARDS[e.card].label})` : ''];
      case 'card':
        return [P(e.p), ' played ', h('b', CARDS[e.card].label), e.card === 'harvest' ? [' for ', resList(Object.fromEntries(RES.map((r) => [r, (e.res || []).filter((x) => x === r).length])))] : ''];
      case 'market':
        return [P(e.p), ' collected ', resList({ [e.res]: e.n })];
      case 'bandit':
        return [P(e.p), ` sent the bandit to ${TERRAIN[view.hexes[e.hex].t].label}${view.hexes[e.hex].n ? ' (' + view.hexes[e.hex].n + ')' : ''}`];
      case 'steal':
        return [P(e.p), ' took ', e.res ? resList({ [e.res]: 1 }) : 'a card', ' from ', P(e.from)];
      case 'discard':
        return [P(e.p), ` discarded ${e.n}`];
      case 'bank':
        return [P(e.p), ' traded ', resList({ [e.give]: e.n }), ' for ', resList({ [e.get]: 1 })];
      case 'offer':
        return [P(e.p), ' offers ', resList(e.give), ' for ', resList(e.get)];
      case 'trade':
        return [P(e.p), ' and ', P(e.with), ' traded ', resList(e.give), ' ⇄ ', resList(e.get)];
      case 'nodeal':
        return ['No one took ', P(e.p), "'s offer"];
      case 'award':
        if (e.p == null) return [`${e.what === 'trail' ? 'Longest Trail' : 'Big Posse'} is up for grabs`];
        return [P(e.p), ` took the ${e.what === 'trail' ? 'Longest Trail' : 'Big Posse'} (+2)`];
      case 'win':
        return [P(e.p), ' won the game!'];
    }
    return null;
  }
  function drawLog(first) {
    const rows = view.log
      .slice(-14)
      .map((e) => {
        const line = logLine(e);
        return line ? h('div.hx-log-row' + (!first && e.i > lastLog ? '.new' : ''), line) : null;
      })
      .filter(Boolean);
    logBox.replaceChildren(h('div.hx-log-title', 'Table log'), ...rows);
    logBox.scrollTop = logBox.scrollHeight;
    lastLog = view.log.at(-1)?.i || lastLog;
  }

  // ---------------------------------------------------------------------
  // hand
  // ---------------------------------------------------------------------
  function drawHand() {
    const pl = mine();
    if (!pl) {
      hand.replaceChildren(h('div.hx-watching', 'Watching'));
      return;
    }
    const cards = RES.map((r) =>
      h(
        'div.hx-card' + (pl.res[r] ? '' : '.none'),
        { style: { '--a': RES_COLORS[r][0], '--b': RES_COLORS[r][1] }, title: RES_LABEL[r] },
        h('span.hx-card-icon', { html: RES_ICON[r] }),
        h('span.hx-card-label', RES_LABEL[r]),
        h('span.hx-card-n', String(pl.res[r])),
      ),
    );
    const almanac = PLAYABLE_CARDS.flatMap((c) => {
      const n = pl.cards[c] + pl.fresh[c];
      if (!n) return [];
      const can = myTurn() && playable(view, me(), c);
      return [
        h(
          'button.hx-acard' + (can ? '.can' : ''),
          { title: `${CARDS[c].label}: ${CARDS[c].text}${pl.fresh[c] && !pl.cards[c] ? ' (playable next turn)' : ''}`, onclick: () => playCard(c) },
          h('span.hx-acard-icon', { html: CARD_ICON[c] }),
          h('span.hx-acard-label', CARDS[c].label),
          n > 1 ? h('span.hx-card-n', String(n)) : null,
          pl.fresh[c] && !pl.cards[c] ? h('span.hx-new', 'new') : null,
        ),
      ];
    });
    hand.replaceChildren(h('div.hx-res', cards), almanac.length ? h('div.hx-almanac', almanac) : null);
  }

  function playCard(c) {
    if (c === 'landmark') return ctx.toast('Landmarks count as a point automatically.');
    if (!myTurn() || !playable(view, me(), c)) {
      const pl = mine();
      if (pl.fresh[c] && !pl.cards[c]) return ctx.toast('New cards can be played starting next turn.');
      if (view.cardPlayed) return ctx.toast('One almanac card per turn.');
      return ctx.toast(c === 'sheriff' ? 'Play a Sheriff on your turn.' : 'Play this after you roll.');
    }
    if (c === 'harvest') return openSheet({ type: 'harvest', pick: [] });
    if (c === 'market') return openSheet({ type: 'market' });
    act({ type: 'play', card: c });
  }

  // ---------------------------------------------------------------------
  // actions
  // ---------------------------------------------------------------------
  function canBuild(kind) {
    const p = me();
    const pl = mine();
    if (!pl || !building()) return false;
    if (kind === 'card') return view.deck > 0 && canPay(pl.res, COST.card);
    const piece = kind === 'road' ? 'road' : kind;
    if (pl.pieces[piece] <= 0 || !canPay(pl.res, COST[kind])) return false;
    if (kind === 'road') return roadSpots(view, p).length > 0;
    if (kind === 'homestead') return homesteadSpots(view, p).length > 0;
    return townSpots(view, p).length > 0;
  }

  function drawActions() {
    const p = me();
    if (view.phase === 'over') {
      actionsBar.replaceChildren(
        h('button.btn.ghost', { onclick: () => openSheet({ type: 'scores' }) }, 'Final scores'),
        ctx.rematch(),
        h('button.btn.ghost', { onclick: () => ctx.leave() }, 'Game Center'),
      );
      return;
    }
    const raisingMe = view.phase === 'raise' && building();
    if (!raisingMe && (p == null || view.current !== p || !['roll', 'main'].includes(view.phase))) {
      const raiser = view.raiseQueue?.[0];
      const waiting =
        view.phase === 'raise'
          ? `${name(raiser)} is building`
          : ['setup', 'roll', 'main'].includes(view.phase)
            ? view.current === p
              ? 'Your turn'
              : `${name(view.current)}'s turn`
            : '';
      const who = view.phase === 'raise' ? raiser : view.current;
      actionsBar.replaceChildren(waiting ? h('div.hx-wait', h('span.hx-dot', { style: { '--c': SEAT_COLORS[who] } }), waiting) : null);
      return;
    }
    if (view.phase === 'roll') {
      actionsBar.replaceChildren(
        h('button.btn.gold.big.hx-roll-btn', { onclick: () => act({ type: 'roll' }) }, h('span.hx-btn-icon', { html: DICE_ICON }), 'Roll dice'),
        playable(view, p, 'sheriff') ? h('button.btn.ghost', { onclick: () => act({ type: 'play', card: 'sheriff' }) }, h('span.hx-btn-icon', { html: CARD_ICON.sheriff }), 'Sheriff first') : null,
      );
      return;
    }
    const buildBtn = (kind, label) => {
      const ok = canBuild(kind);
      return h(
        'button.hx-build' + (mode === kind ? '.on' : '') + (ok ? '' : '.off'),
        {
          title: ok ? `Build a ${label.toLowerCase()}` : `Build a ${label.toLowerCase()} — you need the resources shown and a place for it`,
          onclick: () => {
            if (!ok) {
              sound.error();
              return ctx.toast(kind === 'card' && !view.deck ? 'The almanac deck is empty.' : `Not enough for a ${label.toLowerCase()} yet.`);
            }
            if (kind === 'card') return act({ type: 'buy' });
            mode = mode === kind ? null : kind;
            updateTargets();
            drawActions();
            drawBanner();
          },
        },
        h('span.hx-build-icon', { html: PIECE_ICON[kind](SEAT_COLORS[p]) }),
        h('span.hx-build-label', label),
        costChips(COST[kind], view.players[p].res),
      );
    };
    actionsBar.replaceChildren(
      h('div.hx-builds', buildBtn('road', 'Trail'), buildBtn('homestead', 'Homestead'), buildBtn('town', 'Barn'), buildBtn('card', 'Almanac')),
      raisingMe
        ? h('div.hx-turn-btns', h('button.btn.gold', { onclick: () => ((mode = null), act({ type: 'pass' })) }, 'Done'))
        : h(
            'div.hx-turn-btns',
            h('button.btn.ghost', { onclick: () => openSheet({ type: 'trade', tab: view.offers < 3 ? 'table' : 'bank', give: {}, get: {}, bankGive: null, bankGet: null }) }, 'Trade'),
            h('button.btn.gold', { onclick: () => ((mode = null), act({ type: 'end' })) }, 'End turn'),
          ),
    );
  }

  // ---------------------------------------------------------------------
  // sheets
  // ---------------------------------------------------------------------
  function openSheet(s) {
    sheet = s;
    renderSheet();
  }
  function closeSheet() {
    sheet = null;
    renderSheet();
  }

  // open the sheets that a situation calls for
  function autoSheets(prev) {
    const p = me();
    if (p == null) return;
    if (view.phase === 'discard' && view.discard?.[p] > 0) {
      if (sheet?.type !== 'discard') openSheet({ type: 'discard', pick: {} });
      return;
    }
    if (view.phase === 'trade') {
      const t = view.trade;
      if (t.from === p && sheet?.type !== 'offer-wait') openSheet({ type: 'offer-wait' });
      else if (t.from !== p && t.resp[p] == null && sheet?.type !== 'offer-in') {
        if (autoDecline() && seats[t.from]?.kind === 'bot') act({ type: 'respond', yes: false });
        else openSheet({ type: 'offer-in' });
      }
      return;
    }
    if (['discard', 'offer-wait', 'offer-in', 'victim'].includes(sheet?.type)) closeSheet();
    if (['harvest', 'market', 'trade'].includes(sheet?.type) && (view.phase !== 'main' || view.current !== p)) closeSheet();
    if (view.phase === 'over' && prev && prev.phase !== 'over') setTimeout(() => openSheet({ type: 'scores' }), 1600);
  }

  function stepper(r, value, max, set) {
    return h(
      'div.hx-step',
      { style: { '--a': RES_COLORS[r][0], '--b': RES_COLORS[r][1] } },
      h('span.hx-step-icon', { html: RES_ICON[r] }),
      h('div.hx-step-ctl', h('button', { onclick: () => set(Math.max(0, value - 1)), disabled: value <= 0 }, '−'), h('b', String(value)), h('button', { onclick: () => set(Math.min(max, value + 1)), disabled: value >= max }, '+')),
    );
  }

  function renderSheet() {
    if (!sheet || !view) {
      sheetHost.replaceChildren();
      root.classList.remove('sheet-open');
      return;
    }
    const p = me();
    const pl = mine();
    const close = h('button.hx-x', { onclick: closeSheet, 'aria-label': 'Close' }, '×');
    let body = null;
    let closable = true;
    switch (sheet.type) {
      case 'discard': {
        closable = false;
        const owe = view.discard?.[p] || 0;
        const picked = total(sheet.pick);
        body = [
          h('h3', `Discard ${owe} cards`),
          h('p.hx-hint', `You had more than 7 when a 7 was rolled. Chosen ${picked} of ${owe}.`),
          h('div.hx-steps', RES.map((r) => stepper(r, sheet.pick[r] || 0, Math.min(pl.res[r], (sheet.pick[r] || 0) + owe - picked), (v) => ((sheet.pick[r] = v), renderSheet())))),
          h('div.hx-sheet-actions', h('button.btn.gold', { disabled: picked !== owe, onclick: () => act({ type: 'discard', res: sheet.pick }) }, 'Discard')),
        ];
        break;
      }
      case 'victim':
        body = [
          h('h3', 'Take a card from…'),
          h('div.hx-choice', sheet.victims.map((q) => h('button.hx-choice-btn', { style: { '--c': SEAT_COLORS[q] }, onclick: () => (act({ type: 'bandit', hex: sheet.hex, victim: q }), closeSheet()) }, nameEl(q), h('small', `${view.players[q].resCount} cards`)))),
        ];
        break;
      case 'harvest': {
        const bankOk = (r) => view.bank[r] - sheet.pick.filter((x) => x === r).length > 0;
        body = [
          h('h3', 'Bumper Crop'),
          h('p.hx-hint', 'Take any two resources from the bank.'),
          h('div.hx-pickrow', RES.map((r) => h('button.hx-pick', { disabled: sheet.pick.length >= 2 || !bankOk(r), onclick: () => (sheet.pick.push(r), renderSheet()), style: { '--a': RES_COLORS[r][0], '--b': RES_COLORS[r][1] } }, h('span', { html: RES_ICON[r] }), RES_LABEL[r]))),
          h('div.hx-picked', sheet.pick.length ? sheet.pick.map((r, i) => h('button.hx-chip', { onclick: () => (sheet.pick.splice(i, 1), renderSheet()) }, resIcon(r, '.sm'), '×')) : h('small', 'Pick two')),
          h('div.hx-sheet-actions', h('button.btn.gold', { disabled: sheet.pick.length !== 2, onclick: () => (act({ type: 'play', card: 'harvest', res: sheet.pick }), closeSheet()) }, 'Take them')),
        ];
        break;
      }
      case 'market':
        body = [
          h('h3', 'Corner the Market'),
          h('p.hx-hint', 'Name a resource. Every other player hands you all of theirs.'),
          h('div.hx-pickrow', RES.map((r) => h('button.hx-pick', { onclick: () => (act({ type: 'play', card: 'market', res: r }), closeSheet()), style: { '--a': RES_COLORS[r][0], '--b': RES_COLORS[r][1] } }, h('span', { html: RES_ICON[r] }), RES_LABEL[r]))),
        ];
        break;
      case 'trade':
        body = tradeSheet(p, pl);
        break;
      case 'offer-wait': {
        closable = false;
        const t = view.trade;
        if (!t) break;
        const rows = Object.entries(t.resp).map(([q, yes]) => {
          q = Number(q);
          return h(
            'div.hx-resp',
            nameEl(q),
            yes == null ? h('small', 'thinking…') : yes ? h('button.btn.gold.small', { onclick: () => act({ type: 'accept-trade', with: q }) }, 'Trade') : h('small.no', 'no thanks'),
          );
        });
        body = [
          h('h3', 'Your offer'),
          h('div.hx-offer', h('div', h('small', 'You give'), resList(t.give)), h('span.hx-arrow', '⇄'), h('div', h('small', 'You get'), resList(t.get))),
          h('div.hx-resps', rows),
          h('div.hx-sheet-actions', h('button.btn.ghost', { onclick: () => act({ type: 'cancel-trade' }) }, 'Withdraw offer')),
        ];
        break;
      }
      case 'offer-in': {
        closable = false;
        const t = view.trade;
        if (!t) break;
        const can = canPay(pl.res, t.get);
        body = [
          h('h3', nameEl(t.from), ' offers you a trade'),
          h('div.hx-offer', h('div', h('small', 'You get'), resList(t.give)), h('span.hx-arrow', '⇄'), h('div', h('small', 'You give'), resList(t.get))),
          h('div.hx-sheet-actions', h('button.btn.ghost', { onclick: () => act({ type: 'respond', yes: false }) }, 'No thanks'), h('button.btn.gold', { disabled: !can, onclick: () => act({ type: 'respond', yes: true }) }, 'Accept')),
        ];
        break;
      }
      case 'scores': {
        const order = seatList().sort((a, b) => (view.players[b].points ?? 0) - (view.players[a].points ?? 0));
        body = [
          h('h3', 'Final scores'),
          h(
            'table.hx-scores',
            h('tr', h('th', ''), h('th', 'Homesteads'), h('th', 'Barns'), h('th', 'Awards'), h('th', 'Landmarks'), h('th', 'Total')),
            order.map((q) => {
              const homes = view.verts.filter((b) => b?.o === q && b.k === 'homestead').length;
              const barns = view.verts.filter((b) => b?.o === q && b.k === 'town').length;
              const awards = (view.trailHolder === q ? 2 : 0) + (view.posseHolder === q ? 2 : 0);
              const lm = (view.players[q].cards?.landmark || 0) + (view.players[q].fresh?.landmark || 0);
              return h('tr' + (view.winner === q ? '.win' : ''), h('td', nameEl(q)), h('td', homes), h('td', barns * 2), h('td', awards), h('td', lm), h('td', h('b', view.players[q].points)));
            }),
          ),
        ];
        break;
      }
      case 'costs':
        body = [
          h('h3', 'Building costs'),
          h(
            'div.hx-costs',
            [
              ['road', 'Trail', '0 points · connects your corners'],
              ['homestead', 'Homestead', '1 point · collects 1 per roll'],
              ['town', 'Barn', '2 points · upgrade a homestead, collects 2'],
              ['card', 'Almanac card', 'a surprise from the deck'],
            ].map(([k, label, note]) => h('div.hx-cost-row', h('span.hx-build-icon', { html: PIECE_ICON[k](SEAT_COLORS[p ?? 0]) }), h('div', h('strong', label), h('small', note)), costChips(COST[k], p != null ? view.players[p]?.res : null))),
          ),
          h('p.hx-hint', `First to ${view.target} points on their own turn wins. Longest Trail (5+) and Big Posse (3+ Sheriffs) are worth 2 each.`),
        ];
        break;
    }
    if (!body) {
      sheet = null;
      sheetHost.replaceChildren();
      root.classList.remove('sheet-open');
      return;
    }
    sheetHost.replaceChildren(h('div.hx-sheet', closable ? close : null, body));
    root.classList.add('sheet-open');
  }

  function tradeSheet(p, pl) {
    if (!pl || view.phase !== 'main' || view.current !== p) return null;
    const tab = sheet.tab;
    const tabs = h(
      'div.hx-tabs',
      h('button' + (tab === 'table' ? '.on' : ''), { onclick: () => ((sheet.tab = 'table'), renderSheet()) }, 'Players'),
      h('button' + (tab === 'bank' ? '.on' : ''), { onclick: () => ((sheet.tab = 'bank'), renderSheet()) }, 'Bank & harbors'),
    );
    if (tab === 'bank') {
      const give = sheet.bankGive;
      const get = sheet.bankGet;
      return [
        h('h3', 'Trade'),
        tabs,
        h('p.hx-hint', 'Give several of one resource for one of another. Harbors you own improve the rate.'),
        h('small.hx-label', 'You give'),
        h(
          'div.hx-pickrow',
          RES.map((r) => {
            const n = ratio(view, p, r);
            return h(
              'button.hx-pick' + (give === r ? '.on' : ''),
              { disabled: pl.res[r] < n, onclick: () => ((sheet.bankGive = r), sheet.bankGet === r && (sheet.bankGet = null), renderSheet()), style: { '--a': RES_COLORS[r][0], '--b': RES_COLORS[r][1] } },
              h('b.hx-rate' + (n < 4 ? '.deal' : ''), `${n}:1`),
              h('span', { html: RES_ICON[r] }),
              `${n} ${RES_LABEL[r]}`,
              h('small', `have ${pl.res[r]}`),
            );
          }),
        ),
        h('small.hx-label', 'You get'),
        h(
          'div.hx-pickrow',
          RES.map((r) =>
            h(
              'button.hx-pick' + (get === r ? '.on' : ''),
              { disabled: r === give || view.bank[r] <= 0, onclick: () => ((sheet.bankGet = r), renderSheet()), style: { '--a': RES_COLORS[r][0], '--b': RES_COLORS[r][1] } },
              h('span', { html: RES_ICON[r] }),
              `1 ${RES_LABEL[r]}`,
            ),
          ),
        ),
        h(
          'div.hx-sheet-actions',
          h(
            'button.btn.gold',
            {
              disabled: !give || !get || pl.res[give] < ratio(view, p, give),
              onclick: () => {
                act({ type: 'bank', give, get });
                sheet.bankGet = null;
                if (pl.res[give] - ratio(view, p, give) < ratio(view, p, give)) sheet.bankGive = null;
              },
            },
            'Trade with the bank',
          ),
        ),
      ];
    }
    const giveN = total(sheet.give);
    const getN = total(sheet.get);
    const overlap = RES.some((r) => sheet.give[r] && sheet.get[r]);
    const left = 3 - view.offers;
    return [
      h('h3', 'Trade'),
      tabs,
      h('p.hx-hint', `Make an offer to the table. Anyone who has the cards can accept. ${left} offer${left === 1 ? '' : 's'} left this turn.`),
      h('small.hx-label', 'You give'),
      h('div.hx-steps', RES.map((r) => stepper(r, sheet.give[r] || 0, pl.res[r], (v) => ((sheet.give[r] = v), renderSheet())))),
      h('small.hx-label', 'You want'),
      h('div.hx-steps', RES.map((r) => stepper(r, sheet.get[r] || 0, 6, (v) => ((sheet.get[r] = v), renderSheet())))),
      h(
        'div.hx-sheet-actions',
        overlap ? h('small.no', 'Pick different resources to give and get') : null,
        h('button.btn.gold', { disabled: !giveN || !getN || overlap || left <= 0, onclick: () => act({ type: 'offer', give: sheet.give, get: sheet.get }) }, 'Offer to the table'),
      ),
    ];
  }

  // ---------------------------------------------------------------------
  const off = [ctx.client.on('state', render), ctx.client.on('reject', (t) => (sound.error(), ctx.toast(t)))];
  if (ctx.client.lastState) render(ctx.client.lastState);

  return {
    destroy() {
      gone = true;
      off.forEach((f) => f());
      scene?.destroy();
      scene = null;
      root.remove();
    },
    settings: () => [
      { label: 'High quality graphics (shadows, sharp edges)', value: quality === 'high', set: (v) => ((quality = v ? 'high' : 'low'), ctx.prefs.set('hx.quality', quality), scene?.setQuality(v)) },
      { label: 'Automatically decline trade offers from computer players', value: autoDecline(), set: (v) => ctx.prefs.set('hx.autoDecline', v) },
      { label: 'Show the table log', value: root.classList.contains('log-open'), set: (v) => (root.classList.toggle('log-open', v), ctx.prefs.set('hx.log', v)) },
    ],
  };
}
