// Roofline screen: the lumber yard (pallets and the yard pile) at the top, your roof and racks
// below, everyone else's roofs beside them. Tap a bundle to pick up every bundle of that color
// from the same spot, then tap the rack (or the gutter) to stack them on. Moves go out with
// ctx.client.act(); the screen only ever draws the views it receives.
import { h, avatar } from '../../core/util.js';
import { sound } from '../../core/sound.js';
import { COLOR_NAMES, SIZE, GUTTER, YARD, roofColor, rackOpen, gutterPenalty, BONUS } from './engine.js';

const shingle = (c, extra = '') => h(`span.rl-sh.c${c}${extra}`, { 'aria-label': COLOR_NAMES[c] });
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function mount(ctx) {
  const root = h('div.rl');
  const status = h('div.rl-status');
  const note = h('div.rl-note');
  const yard = h('section.rl-yard');
  const mine = h('section.rl-mine');
  const others = h('section.rl-others');
  const after = h('div.rl-after');
  root.append(h('div.rl-top', status, note), h('div.rl-main', h('div.rl-left', yard, mine), others), after);
  ctx.el.append(root);

  let view = null;
  let seats = [];
  let pick = null; // { src, color } chosen on the yard, waiting for a rack
  let sent = false;
  let lastSeen = null; // the last move we animated
  let showResults = true;
  let freshRound = false; // the state that just arrived ended a round: animate the nailing

  const myTurn = () => view && view.seat != null && view.phase === 'draft' && view.turn === view.seat && !sent;
  const nameOf = (s) => (s === view?.seat ? 'You' : seats[s]?.name || `Roofer ${s + 1}`);

  function choose(src, color) {
    if (!myTurn()) return;
    if (pick && pick.src === src && pick.color === color) pick = null;
    else pick = { src, color };
    sound.card();
    draw();
  }
  function place(rack) {
    if (!myTurn() || !pick) return;
    const pl = view.players[view.seat];
    if (rack >= 0 && !rackOpen(pl, rack, pick.color)) return sound.error();
    sent = true;
    ctx.client.act({ type: 'take', src: pick.src, color: pick.color, rack });
    pick = null;
    draw();
  }

  // ---------- the yard ----------
  function drawYard() {
    const picking = myTurn();
    const pallets = view.pallets.map((p, i) =>
      h(
        'div.rl-pallet' + (p.length ? '' : '.empty'),
        { 'aria-label': `Pallet ${i + 1}` },
        h('div.rl-slats'),
        h(
          'div.rl-stack',
          p.map((c) =>
            h(
              'button.rl-bundle' + (pick && pick.src === i && pick.color === c ? '.picked' : '') + (picking ? '.live' : ''),
              { onclick: () => choose(i, c), title: `${COLOR_NAMES[c]} from pallet ${i + 1}`, 'aria-label': `${COLOR_NAMES[c]} from pallet ${i + 1}` },
              shingle(c),
            ),
          ),
        ),
      ),
    );
    const pile = h(
      'div.rl-pile',
      view.whistle ? h('span.rl-whistle', { title: 'Foreman’s whistle: first to take from the yard starts next round, but it fills a gutter slot' }, '📣') : null,
      view.yard.flatMap((k, c) =>
        k
          ? [
              h(
                'button.rl-group' + (pick && pick.src === YARD && pick.color === c ? '.picked' : '') + (picking ? '.live' : ''),
                { onclick: () => choose(YARD, c), title: `${k} ${COLOR_NAMES[c]} from the yard`, 'aria-label': `${k} ${COLOR_NAMES[c]} from the yard` },
                Array.from({ length: k }, () => shingle(c)),
                h('b', k),
              ),
            ]
          : [],
      ),
      view.yard.every((k) => !k) ? h('small.rl-pile-empty', 'Leftover bundles land here') : null,
    );
    yard.replaceChildren(
      h('div.rl-pallets', pallets),
      h('div.rl-pile-wrap', h('div.rl-label', 'Yard'), pile),
      h('div.rl-meta', h('span', `Round ${view.round}`), h('span', `${view.bag} in the bag`)),
    );
  }

  // ---------- a roof board ----------
  function board(seat, big) {
    const pl = view.players[seat];
    const live = big && myTurn() && pick;
    const fresh = view.last && view.last.seat === seat && view.last.round === view.round ? view.last : null;
    const tally = view.tally?.[seat];
    const justNailed = new Set(tally && freshRound ? tally.nailed.map((n) => n.cell) : []);

    const racks = h(
      'div.rl-racks',
      pl.racks.map((rack, r) => {
        const ok = live && rackOpen(pl, r, pick.color);
        return h(
          'button.rl-rack' + (ok ? '.can' : live ? '.no' : ''),
          { onclick: () => place(r), disabled: !big || null, 'aria-label': `Rack ${r + 1}: ${rack.count} of ${r + 1}${rack.color != null ? ' ' + COLOR_NAMES[rack.color] : ''}` },
          Array.from({ length: r + 1 }, (_, i) => {
            const filled = i >= r + 1 - rack.count;
            const isNew = fresh && fresh.rack === r && i >= r + 1 - rack.count && i < r + 1 - rack.count + fresh.placed;
            return filled ? shingle(rack.color, isNew ? '.drop' : '') : h('span.rl-slot');
          }),
        );
      }),
    );
    const roof = h(
      'div.rl-roof',
      Array.from({ length: SIZE * SIZE }, (_, i) => {
        const r = Math.floor(i / SIZE), c = i % SIZE;
        const k = roofColor(r, c);
        const dormer = view.dormers.includes(i);
        const target = live && k === pick.color && rackOpen(pl, r, pick.color);
        if (pl.roof[i]) return h('span.rl-cell.full', shingle(k, justNailed.has(i) ? '.nail' : ''), dormer ? h('i.rl-dormer.on', '★') : null);
        return h(`span.rl-cell.c${k}` + (target ? '.aim' : ''), dormer ? h('i.rl-dormer', { title: `Dormer: +${BONUS.dormer}` }, '★') : null);
      }),
    );
    const gutter = h(
      'button.rl-gutter' + (live ? '.can' : ''),
      { onclick: () => place(-1), disabled: !big || null, 'aria-label': `Gutter: ${pl.gutter.length} bundles, ${gutterPenalty(pl.gutter.length)} points` },
      GUTTER.map((pen, i) => {
        const g = pl.gutter[i];
        return h('span.rl-gslot', g == null ? h('small', pen) : g === 'whistle' ? h('span.rl-whistle', '📣') : shingle(g, fresh && i >= pl.gutter.length - fresh.gutter - (fresh.whistle ? 1 : 0) ? '.drop' : ''));
      }),
    );
    const info = seats[seat] || {};
    const isTurn = view.phase === 'draft' && view.turn === seat;
    const won = view.phase === 'over' && view.winners?.includes(seat);
    return h(
      `div.rl-board${big ? '.big' : '.small'}${isTurn ? '.turn' : ''}${won ? '.won' : ''}`,
      { dataset: { seat } },
      h(
        'div.rl-head',
        avatar(info.name || '?', info.hue ?? 30, { bot: info.kind === 'bot' }),
        h('div.rl-who', h('strong', nameOf(seat)), h('small', isTurn ? (seat === view.seat ? 'Your turn' : 'Picking…') : view.phase === 'draft' && view.nextFirst === seat ? 'Starts next round' : '')),
        h('div.rl-score', h('b', pl.score), h('small', 'pts')),
      ),
      h('div.rl-work', racks, h('div.rl-roofwrap', h('div.rl-ridge'), roof)),
      gutter,
    );
  }
  function drawBoards() {
    const me = view.seat ?? 0;
    mine.replaceChildren(board(me, view.seat != null));
    const rest = [];
    for (let i = 1; i < view.n; i++) rest.push((me + i) % view.n);
    others.replaceChildren(...rest.map((s) => board(s, false)));
  }

  function describe(last) {
    if (!last) return '';
    const who = nameOf(last.seat);
    const what = `${plural(last.count, COLOR_NAMES[last.color] + ' bundle')} from ${last.src === YARD ? 'the yard' : 'pallet ' + (last.src + 1)}`;
    const where = last.rack < 0 ? ' into the gutter' : ` onto rack ${last.rack + 1}${last.gutter ? ` (${last.gutter} in the gutter)` : ''}`;
    return `${who} took ${what}${where}${last.whistle ? ' and blew the whistle' : ''}.`;
  }

  function drawStatus() {
    if (view.phase === 'over') {
      const w = view.winners || [];
      status.textContent = w.length > 1 ? `Tie: ${w.map(nameOf).join(' & ')}` : w[0] === view.seat ? 'You win!' : `${nameOf(w[0])} wins!`;
    } else if (myTurn()) status.textContent = pick ? `Now tap a rack for the ${COLOR_NAMES[pick.color]} — or the gutter` : 'Your turn — tap a bundle in the yard';
    else if (view.turn === view.seat && sent) status.textContent = '…';
    else status.textContent = `${nameOf(view.turn)} is picking…`;
    note.textContent = describe(view.last);
  }

  function drawAfter() {
    if (view.phase !== 'over') return after.replaceChildren();
    const order = view.players.map((p, i) => i).sort((a, b) => view.players[b].score - view.players[a].score);
    after.replaceChildren(
      showResults
        ? h(
            'div.rl-results',
            h('h2', status.textContent),
            h(
              'table',
              h('tr', h('th', ''), h('th', 'Rows'), h('th', 'Columns'), h('th', 'Colors'), h('th', 'Total')),
              order.map((s) =>
                h(
                  'tr' + (view.winners.includes(s) ? '.win' : ''),
                  h('td', nameOf(s)),
                  h('td', `${view.final[s].rows} · +${view.final[s].rows * BONUS.row}`),
                  h('td', `${view.final[s].cols} · +${view.final[s].cols * BONUS.column}`),
                  h('td', `${view.final[s].colors} · +${view.final[s].colors * BONUS.color}`),
                  h('td', h('b', view.players[s].score)),
                ),
              ),
            ),
            h(
              'div.rl-actions',
              h('button.btn.ghost', { onclick: () => ((showResults = false), drawAfter()) }, 'See roofs'),
              h('button.btn.ghost', { onclick: () => ctx.leave() }, 'Game Center'),
              ctx.client.isHost ? h('button.btn.gold', { onclick: () => ctx.client.send({ t: 'rematch' }) }, 'Play again') : h('small', 'Waiting for the host…'),
            ),
          )
        : h('button.btn.gold.rl-reopen', { onclick: () => ((showResults = true), drawAfter()) }, 'Results'),
    );
  }

  function draw() {
    if (!view) return;
    root.classList.toggle('my-turn', !!myTurn());
    root.classList.toggle('picking', !!pick);
    root.dataset.players = view.n;
    drawYard();
    drawBoards();
    drawStatus();
    drawAfter();
  }

  function roundToast() {
    const t = view.tally;
    if (!t) return;
    const parts = t.map((x, s) => {
      const pts = x.nailed.reduce((n, y) => n + y.points, 0);
      return `${nameOf(s)} +${pts}${x.penalty ? ` ${x.penalty}` : ''}`;
    });
    ctx.toast(`Round ${t.round} nailed down — ${parts.join(' · ')}`);
  }

  function render(msg) {
    const prev = view;
    view = msg.view;
    seats = msg.seats || seats;
    sent = false;
    if (view.phase !== 'over') showResults = true;
    // forget a pick that no longer makes sense
    if (pick) {
      const still = pick.src === YARD ? view.yard[pick.color] > 0 : view.pallets[pick.src]?.includes(pick.color);
      if (!still || !myTurn()) pick = null;
    }
    freshRound = !!(prev && view.tally && prev.round !== view.round) || (prev && view.phase === 'over' && prev.phase !== 'over');
    const moveKey = view.last ? `${view.last.round}:${view.last.seat}:${view.last.src}:${view.last.color}:${view.last.rack}` : null;
    const moved = prev && moveKey !== lastSeen;
    lastSeen = moveKey;
    if (!moved) {
      // a repeated state (reconnect, settings change): draw without the drop animation
      const keep = view.last;
      view = { ...view, last: null };
      draw();
      view = { ...view, last: keep };
    } else draw();
    if (moved) sound.chip();
    if (freshRound) {
      setTimeout(() => sound.deal(6), 250);
      roundToast();
    }
    if (view.phase === 'over' && prev && prev.phase !== 'over') {
      setTimeout(() => (view.winners.includes(view.seat) || view.seat == null ? sound.win : sound.bad)(), 500);
    } else if (myTurn() && prev && !(prev.turn === view.seat && prev.phase === 'draft')) sound.turn();
  }

  function paintVoice() {
    if (!ctx.voice) return;
    root.querySelectorAll('.rl-board').forEach((el) => {
      const id = seats[Number(el.dataset.seat)]?.playerId;
      el.classList.toggle('speaking', !!(id && ctx.voice.speaking.has(id)));
    });
  }
  const offVoice = ctx.voice ? [ctx.voice.on('speaking', paintVoice), ctx.voice.on('change', paintVoice)] : [];
  const off = [
    ctx.client.on('state', (msg) => (render(msg), paintVoice())),
    ctx.client.on('reject', (t) => ((sent = false), sound.error(), ctx.toast(t), draw())),
  ];
  if (ctx.client.lastState) render(ctx.client.lastState);

  // Escape drops the bundle you picked up
  const onKey = (e) => {
    if (e.key === 'Escape' && pick) (pick = null), draw();
  };
  window.addEventListener('keydown', onKey);

  return {
    destroy() {
      off.forEach((f) => f());
      offVoice.forEach((f) => f());
      window.removeEventListener('keydown', onKey);
      root.remove();
    },
  };
}
