// Spit & Speed screen: a felt table drawn in HTML/CSS.
//
// You sit at the bottom. Tap a card to play it (it picks the best pile for you), or drag it to
// the pile you want. Keys: 1–5 play that card, Space flips ("Speed!" / "Spit!"), ← / → slap.
//
// Every card on screen that you can see the face of has data-key="c<card>", so after each
// state the screen can slide cards from where they were to where they are now (FLIP). Cards
// that come out of hiding (the other player's hand, a side pile, a spit pile) fly in from that
// spot instead.
import { h, avatar } from '../../core/util.js';
import { sound } from '../../core/sound.js';
import { fits } from './engine.js';

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const PREF_HINTS = 'spit.hints';

function face(c, cls = '') {
  const r = RANKS[c % 13];
  const s = SUITS[Math.floor(c / 13)];
  const red = s === '♥' || s === '♦';
  const big = c % 13 >= 10 ? h('span.ss-court', r, h('i', s)) : h('span.ss-pip', s);
  return h(
    `div.ss-card.face${red ? '.red' : ''}${cls}`,
    { dataset: { key: 'c' + c, card: c }, 'aria-label': `${r} of ${['spades', 'hearts', 'diamonds', 'clubs'][Math.floor(c / 13)]}` },
    h('span.ss-corner', r, h('i', s)),
    big,
    h('span.ss-corner.br', r, h('i', s)),
  );
}
const back = (color, cls = '') => h(`div.ss-card.back.b${color}${cls}`);
const slot = (cls = '') => h(`div.ss-card.slot${cls}`);
const tilt = (c) => ((c * 37) % 11) - 5; // a little messiness on the center piles

export function mount(ctx) {
  const root = h('div.ss');
  ctx.el.append(root);

  let view = null;
  let prev = null;
  let seats = [];
  let hints = ctx.prefs.get(PREF_HINTS) ?? true;
  let drag = null; // { el, src, x, y, moved, target }
  let held = null; // a state that arrived mid-drag, drawn when the card is let go
  const sent = new Set(); // cards we just played, until the host answers

  const me = () => (view?.seat ?? 0); // spectators watch from seat 0's chair
  const playing = () => view && view.seat != null && view.phase !== 'over';
  const name = (s) => (s === view?.seat ? 'You' : seats[s]?.name || ['Red', 'Blue'][s]);
  const order = () => (me() === 1 ? [1, 0] : [0, 1]); // center piles, left to right, from your chair
  const tops = () => view.piles.map((p) => (p.top.length ? p.top[p.top.length - 1] : null));

  // ---------- your cards ----------
  // a "source" is a card you can move: { card, hand: i } in Speed, { card, stack: i } in Spit
  function sources() {
    if (!view || view.seat == null) return [];
    const pl = view.players[view.seat];
    if (view.mode === 'speed') return (pl.hand || []).map((card, i) => ({ card, hand: i }));
    return pl.stacks.map((st, i) => (st.top == null ? null : { card: st.top, stack: i, n: st.n })).filter(Boolean);
  }
  const fitsAny = (card) => tops().some((t) => fits(card, t, view.wrap));
  const hasEmpty = () => view.mode === 'spit' && view.seat != null && view.players[view.seat].stacks.some((st) => st.n === 0);
  const movable = (src) => src.n >= 2 && hasEmpty();
  const canPlay = () => view.phase === 'play' && sources().some((src) => fitsAny(src.card));
  const canMove = () => view.phase !== 'slap' && view.phase !== 'over' && sources().some(movable);

  // pick the pile that leaves the most of your other cards playable
  function bestPile(src) {
    const t = tops();
    const ok = [0, 1].filter((k) => fits(src.card, t[k], view.wrap));
    if (ok.length < 2) return ok[0] ?? null;
    const others = sources().filter((o) => o.card !== src.card);
    const score = (k) => {
      const after = t.slice();
      after[k] = src.card;
      return others.filter((o) => fits(o.card, after[0], view.wrap) || fits(o.card, after[1], view.wrap)).length;
    };
    return score(ok[0]) >= score(ok[1]) ? ok[0] : ok[1];
  }

  function play(src, pile) {
    if (!playing() || view.phase !== 'play' || sent.has(src.card)) return false;
    if (pile == null || !fits(src.card, tops()[pile], view.wrap)) return false;
    sent.add(src.card);
    ctx.client.act(view.mode === 'speed' ? { type: 'play', card: src.card, pile } : { type: 'play', from: src.stack, pile });
    return true;
  }
  function moveToEmpty(src, to) {
    const pl = view.players[view.seat];
    if (view.mode !== 'spit' || (view.phase !== 'play' && view.phase !== 'ready') || !(src.n >= 2) || sent.has(src.card)) return false;
    to ??= pl.stacks.findIndex((st) => st.n === 0);
    if (to < 0 || pl.stacks[to].n !== 0) return false;
    sent.add(src.card);
    ctx.client.act({ type: 'move', from: src.stack, to });
    return true;
  }
  function tap(src) {
    if (!playing()) return;
    if (view.phase === 'play' && play(src, bestPile(src))) return paintSent();
    if (moveToEmpty(src)) return paintSent();
    shake(src.card);
  }
  function ready() {
    if (!playing() || view.phase !== 'ready' || view.ready[view.seat]) return;
    sound.pop();
    ctx.client.act({ type: 'ready' });
    view.ready[view.seat] = true; // show "waiting" right away; the next state confirms it
    paintCall();
  }
  function slap(pile) {
    if (!playing() || view.phase !== 'slap') return;
    sound.chip();
    root.querySelector(`.ss-pile[data-pile="${pile}"]`)?.classList.add('slapped');
    ctx.client.act({ type: 'slap', pile });
  }
  function shake(card) {
    sound.error();
    const el = root.querySelector(`[data-key="c${card}"]`);
    el?.animate([{ translate: '0 0' }, { translate: '-6px 0' }, { translate: '6px 0' }, { translate: '0 0' }], { duration: 220 });
  }
  function paintSent() {
    for (const c of sent) root.querySelector(`[data-key="c${c}"]`)?.classList.add('sent');
  }

  // ---------- drawing ----------
  function render(msg) {
    if (drag) return void (held = msg);
    prev = view;
    view = msg.view;
    seats = msg.seats || seats;
    sent.clear();
    const before = new Map([...root.querySelectorAll('[data-key]')].map((el) => [el.dataset.key, el.getBoundingClientRect()]));
    const mine = me();
    const opp = 1 - mine;
    root.className = `ss mode-${view.mode} phase-${view.phase}` + (hints ? ' hints' : '') + (view.seat == null ? ' watching' : '');
    root.replaceChildren(
      h('div.ss-felt'),
      bar(opp, 'opp'),
      zone(opp, 'opp'),
      center(),
      h('div.ss-call'),
      zone(mine, 'me'),
      bar(mine, 'me'),
      over(),
    );
    paintCall();
    animate(before, msg.event);
    sounds(msg.event);
  }

  function bar(s, where) {
    const info = seats[s] || {};
    const ready = view.phase === 'ready' && view.ready[s];
    const left = view.left[s];
    return h(
      `div.ss-bar.${where}` + (view.winner === s ? '.won' : ''),
      avatar(info.name || '?', info.hue ?? (s ? 220 : 4), { bot: info.kind === 'bot' }),
      h('div.ss-who', h('strong', name(s)), h('small', `${left} card${left === 1 ? '' : 's'} left`)),
      view.phase === 'ready' ? h('span.ss-ready' + (ready ? '.on' : ''), ready ? 'Ready' : '…') : null,
      where === 'me' && view.mode === 'spit' ? h('span.ss-round', `Round ${view.round}`) : null,
    );
  }

  function zone(s, where) {
    const pl = view.players[s];
    const z = h(`div.ss-zone.${where}`);
    const mineZone = s === view.seat;
    if (view.mode === 'speed') {
      const stock = h('div.ss-deck', { dataset: { src: 'stock' + s } }, pl.stock ? back(s) : slot(), pl.stock ? h('b.ss-count', pl.stock) : null);
      const hand = h('div.ss-hand', { dataset: { src: 'hand' + s } });
      if (pl.hand) {
        pl.hand.forEach((c, i) => hand.append(withKey(face(c, mineZone ? '.mine' : ''), mineZone ? { card: c, hand: i } : null)));
        for (let i = pl.hand.length; i < 5; i++) hand.append(slot());
      } else for (let i = 0; i < 5; i++) hand.append(i < pl.handCount ? back(s) : slot());
      z.append(hand, stock);
    } else {
      const stacks = h('div.ss-stacks');
      pl.stacks.forEach((st, i) => {
        const col = h('div.ss-stack', { dataset: mineZone ? { slot: i } : {}, style: { '--under': Math.max(0, Math.min(st.n - 1, 4)) } });
        for (let j = 0; j < Math.min(st.n - 1, 4); j++) col.append(back(s, '.under'));
        if (st.top != null) col.append(withKey(face(st.top, mineZone ? '.mine' : ''), mineZone ? { card: st.top, stack: i, n: st.n } : null));
        else col.append(slot(mineZone ? '.drop' : ''));
        stacks.append(col);
      });
      const spit = h('div.ss-deck', { dataset: { src: 'spit' + s } }, pl.spit ? back(s) : slot(), pl.spit ? h('b.ss-count', pl.spit) : null);
      z.append(stacks, spit);
    }
    return z;
  }
  function withKey(el, src) {
    if (!src) return el;
    el.classList.toggle('can', (view.phase === 'play' && fitsAny(src.card)) || (!canPlay() && canMove() && movable(src)));
    el.addEventListener('pointerdown', (e) => grab(e, el, src));
    return el;
  }

  function center() {
    const row = h('div.ss-center');
    const [a, b] = order();
    const pile = (k) => {
      const p = view.piles[k];
      const el = h('div.ss-pile', { dataset: { pile: k }, onclick: () => slap(k) });
      if (!p.top.length) el.append(slot());
      p.top.forEach((c, i) => {
        const card = face(c, i === p.top.length - 1 ? '.topcard' : '');
        card.style.rotate = tilt(c) + 'deg';
        el.append(card);
      });
      if (view.mode === 'spit' || view.phase === 'slap') el.append(h('b.ss-count.pile', p.n));
      return el;
    };
    if (view.mode === 'speed') {
      const side = (k) => h('div.ss-deck.side', { dataset: { src: 'side' + k } }, view.side[k] ? back(2) : slot(), view.side[k] ? h('b.ss-count', view.side[k]) : null);
      row.append(side(a), pile(a), pile(b), side(b));
    } else row.append(pile(a), pile(b));
    return row;
  }

  // the line under the center piles: the flip button, slap call or a short note
  function paintCall() {
    const call = root.querySelector('.ss-call');
    if (!call || !view) return;
    const word = view.mode === 'speed' ? 'Speed!' : 'Spit!';
    let content = null;
    if (view.phase === 'ready') {
      const lead = view.stuck ? (view.note?.again ? 'Still stuck — flip again.' : 'Nobody can play.') : view.round > 1 && view.mode === 'spit' ? `Round ${view.round}. Ready?` : 'Ready?';
      const tip = view.seat != null && canMove() ? h('p.ss-tip', 'You can still move a card into your empty space.') : null;
      if (view.seat == null) content = h('p', lead);
      else if (view.ready[view.seat]) content = [h('p', lead), h('button.btn.ss-go.waiting', { disabled: true }, `Waiting for ${name(1 - view.seat)}…`)];
      else content = [h('p', lead), h('button.btn.gold.ss-go', { onclick: ready }, word)];
      if (tip && view.seat != null) content.push(tip);
    } else if (view.phase === 'slap') {
      const who = view.cleared === view.seat ? 'You’re out of stockpiles' : `${name(view.cleared)} is out of stockpiles`;
      content = h('p.ss-slapcall', `${who} — slap the smaller pile!`);
    } else if (view.phase === 'play' && view.seat != null && !canPlay() && canMove()) content = h('p.ss-tip', 'Move a card into your empty space to turn one up.');
    else if (view.phase === 'play' && view.note?.kind === 'reshuffle') content = h('p', 'Side piles ran out — the middle was shuffled in.');
    call.replaceChildren(...[content].flat().filter(Boolean));
  }

  function over() {
    if (view.phase !== 'over') return null;
    const mine = view.seat;
    const w = view.winner;
    let title = w === 'draw' ? 'It’s a draw' : w === mine ? 'You win!' : `${name(w)} wins`;
    if (mine == null && w !== 'draw') title = `${name(w)} wins`;
    const why =
      view.reason === 'out'
        ? `${w === mine ? 'You' : name(w)} played every card.`
        : view.reason === 'rounds'
          ? 'Too many rounds — fewest cards left wins.'
          : 'Nobody could play any more — fewest cards left wins.';
    return h(
      'div.ss-over',
      h(
        'div.ss-over-card',
        h('h2', title),
        h('p', why),
        h(
          'div.ss-stats',
          [0, 1].map((s) => h('div', h('strong', name(s)), h('span', `${view.plays[s]} cards played`), h('span', `${view.left[s]} left`))),
        ),
        h(
          'div.ss-actions',
          h('button.btn.ghost', { onclick: () => ctx.leave() }, 'Game Center'),
          ctx.rematch(), // the shared Rematch button: same players and seats
        ),
      ),
    );
  }

  // ---------- motion ----------
  function animate(before, event) {
    const rectOf = (sel) => root.querySelector(sel)?.getBoundingClientRect();
    const redeal = prev && (prev.round !== view.round || prev.phase === 'over');
    for (const el of root.querySelectorAll('[data-key]')) {
      const to = el.getBoundingClientRect();
      let from = before.get(el.dataset.key);
      if (!from && !redeal && prev) {
        const pileEl = el.closest('.ss-pile');
        if (pileEl) {
          const k = +pileEl.dataset.pile;
          const moved = view.note?.moved?.find((m) => m.pile === k);
          if (event?.action?.type === 'play' && event.action.pile === k && event.seat !== view.seat && view.mode === 'speed') from = rectOf(`[data-src="hand${event.seat}"]`);
          else if (moved) from = rectOf(`[data-src="${view.mode === 'speed' ? 'side' : 'spit'}${moved.from}"]`);
        } else if (el.closest('.ss-zone.me .ss-hand') && view.phase !== 'over') from = rectOf(`[data-src="stock${view.seat}"]`);
        else if (el.closest('.ss-stack')) el.classList.add('reveal');
      }
      if (!from) continue;
      const dx = from.left + from.width / 2 - (to.left + to.width / 2);
      const dy = from.top + from.height / 2 - (to.top + to.height / 2);
      if (Math.abs(dx) + Math.abs(dy) < 2) continue;
      const scale = from.width / to.width || 1;
      el.style.zIndex = 30;
      el.animate([{ translate: `${dx}px ${dy}px`, scale: `${scale}` }, { translate: '0 0', scale: '1' }], {
        duration: 300,
        easing: 'cubic-bezier(.2,.8,.25,1)',
      }).onfinish = () => (el.style.zIndex = '');
    }
    if (redeal) root.querySelectorAll('.ss-zone .ss-card').forEach((el, i) => el.animate([{ opacity: 0, translate: '0 -30px' }, { opacity: 1, translate: '0 0' }], { duration: 380, delay: i * 18, fill: 'backwards' }));
  }

  function sounds(event) {
    if (!prev || !view) return;
    const note = view.note;
    if (event?.action?.type === 'play') sound.card();
    else if (event?.action?.type === 'move') sound.slide();
    if (note?.kind === 'reshuffle' && event?.action?.type === 'ready') sound.shuffle();
    else if (note?.kind === 'flip' && event?.action?.type === 'ready') sound.deal(2);
    if (note?.kind === 'slap' && event?.action?.type === 'slap') {
      sound.sweep();
      const got = note.sizes[view.seat];
      if (view.seat != null && view.phase !== 'over') ctx.toast(note.seat === view.seat ? `You slapped first — you take ${got} card${got === 1 ? '' : 's'}.` : `${name(note.seat)} slapped first — you take ${got} card${got === 1 ? '' : 's'}.`);
    }
    if (note?.kind === 'blocked' && prev.round !== view.round) ctx.toast('Nobody could play or spit — everyone takes the pile on their side.');
    if (view.phase === 'slap' && prev.phase !== 'slap') sound.turn();
    if (view.phase === 'over' && prev.phase !== 'over') setTimeout(() => (view.winner === view.seat || view.seat == null ? sound.win : sound.bad)(), 350);
  }

  // ---------- dragging ----------
  function grab(e, el, src) {
    if (!playing() || e.button > 0) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    drag = { el, src, x: e.clientX, y: e.clientY, moved: false, target: null, id: e.pointerId };
  }
  function targetAt(x, y) {
    const hit = (el) => {
      const r = el.getBoundingClientRect();
      const pad = 14;
      return x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;
    };
    for (const el of root.querySelectorAll('.ss-pile')) if (hit(el)) return { el, pile: +el.dataset.pile };
    for (const el of root.querySelectorAll('.ss-zone.me .ss-stack')) if (hit(el) && view.players[view.seat]?.stacks[+el.dataset.slot]?.n === 0) return { el, slot: +el.dataset.slot };
    return null;
  }
  function onMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 9) return;
    drag.moved = true;
    drag.el.classList.add('drag');
    drag.el.style.translate = `${dx}px ${dy}px`;
    const t = targetAt(e.clientX, e.clientY);
    if (drag.target?.el !== t?.el) {
      drag.target?.el.classList.remove('over', 'bad');
      t?.el.classList.add('over');
      if (t && t.pile != null && (view.phase !== 'play' || !fits(drag.src.card, tops()[t.pile], view.wrap))) t.el.classList.add('bad');
      drag.target = t;
    }
  }
  function onUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    d.target?.el.classList.remove('over', 'bad');
    if (!d.moved) tap(d.src);
    else {
      let ok = false;
      if (d.target?.pile != null) ok = play(d.src, d.target.pile);
      else if (d.target?.slot != null) ok = moveToEmpty(d.src, d.target.slot);
      if (ok) d.el.classList.add('sent');
      else {
        if (d.target) sound.error();
        d.el.animate([{ translate: d.el.style.translate }, { translate: '0 0' }], { duration: 200, easing: 'ease-out' });
      }
      d.el.style.translate = '';
      d.el.classList.remove('drag');
    }
    if (held) {
      const m = held;
      held = null;
      render(m);
    }
  }
  function onCancel(e) {
    if (!drag || e.pointerId !== drag.id) return;
    drag.el.style.translate = '';
    drag.el.classList.remove('drag');
    drag.target?.el.classList.remove('over', 'bad');
    drag = null;
    if (held) {
      const m = held;
      held = null;
      render(m);
    }
  }
  root.addEventListener('pointermove', onMove);
  root.addEventListener('pointerup', onUp);
  root.addEventListener('pointercancel', onCancel);

  // ---------- keyboard ----------
  function onKey(e) {
    if (!view || e.target.closest?.('input, textarea, select, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^[1-5]$/.test(e.key)) {
      const i = +e.key - 1;
      const src = sources().find((s) => (s.hand ?? s.stack) === i);
      if (src) tap(src);
      e.preventDefault();
    } else if (e.key === ' ' || e.key === 'Enter') {
      if (view.phase === 'ready' && !e.target.closest?.('button')) (ready(), e.preventDefault());
    } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && view.phase === 'slap') {
      slap(order()[e.key === 'ArrowLeft' ? 0 : 1]);
      e.preventDefault();
    }
  }
  document.addEventListener('keydown', onKey);

  const offs = [
    ctx.client.on('state', render),
    ctx.client.on('reject', (t) => {
      sound.error();
      ctx.toast(t);
    }),
  ];
  if (ctx.client.lastState) render(ctx.client.lastState);

  return {
    destroy() {
      offs.forEach((f) => f());
      document.removeEventListener('keydown', onKey);
      root.remove();
    },
    settings: () => [
      {
        label: 'Glow on cards you can play',
        value: hints,
        set: (v) => {
          hints = v;
          ctx.prefs.set(PREF_HINTS, v);
          root.classList.toggle('hints', v);
        },
      },
    ],
  };
}
