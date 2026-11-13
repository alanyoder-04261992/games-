// Liar's Dice screen. Reads each state message, draws the table (everyone's cups, the current
// bid, your own dice) and sends { type: 'bid', qty, face }, { type: 'liar' }, { type: 'spot' }
// or { type: 'roll' }. Never changes the view itself: it waits for the next state message.
import { h, avatar } from '../../core/util.js';
import { sound } from '../../core/sound.js';
import { faces, minQty, isRaise, matches } from './engine.js';
import { odds } from './ai.js';

const PREF_ODDS = 'liars.odds';
// pip positions on a 3 × 3 grid, row-major
const PIPS = { 1: [4], 2: [2, 6], 3: [2, 4, 6], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
const NAMES = { 1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six' };
export const faceName = (face, qty = 2) => (qty === 1 ? NAMES[face] : face === 6 ? 'sixes' : NAMES[face] + 's');

export function die(face, cls = '') {
  const el = h('div.ld-die' + (cls ? '.' + cls.split(' ').filter(Boolean).join('.') : ''), { dataset: { f: face }, role: 'img', 'aria-label': face ? NAMES[face] : 'hidden die' });
  for (const i of PIPS[face] || []) el.append(h('i', { style: { gridArea: `${1 + Math.floor(i / 3)} / ${1 + (i % 3)}` } }));
  return el;
}

export function mount(ctx) {
  const root = h('div.ld');
  const opps = h('div.ld-opps');
  const bidBox = h('div.ld-bid');
  const status = h('div.ld-status', { 'aria-live': 'polite' });
  const center = h('div.ld-center', bidBox, status);
  const myDice = h('div.ld-mydice');
  const myNote = h('div.ld-note');
  const controls = h('div.ld-controls');
  const after = h('div.ld-after');
  const me = h('div.ld-me', h('div.ld-tray', myDice), myNote, controls, after);
  root.append(h('div.ld-felt'), h('div.ld-lamp'), opps, center, me);
  ctx.el.append(root);

  let view = null;
  let seats = [];
  let sel = null; // { qty, face } — the bid being put together
  let sent = false; // a move is on its way; wait for the next state
  let showOdds = ctx.prefs.get(PREF_ODDS) ?? true;
  const timers = new Set();
  const later = (fn, ms) => {
    const id = setTimeout(() => (timers.delete(id), fn()), ms);
    timers.add(id);
  };

  const mine = () => view?.seat;
  const isMine = (s) => s === mine();
  const name = (s) => (isMine(s) ? 'You' : seats[s]?.name || `Player ${s + 1}`);
  const myTurn = () => view && view.seat != null && view.phase === 'bid' && view.turn === view.seat;
  const myRoll = () => view && view.seat != null && view.phase === 'reveal' && view.starter === view.seat;
  const act = (move) => {
    if (sent) return;
    sent = true;
    ctx.client.act(move);
    paintControls();
  };

  // ---------- choosing a bid ----------
  function freshSelection() {
    const fs = faces(view.options.wild);
    let face = view.bid?.face;
    if (!face) {
      // open on the face you hold the most of
      const hand = view.dice[view.seat] || [];
      face = fs.reduce((best, f) => (hand.filter((d) => matches(d, f, view.options.wild)).length >= hand.filter((d) => matches(d, best, view.options.wild)).length ? f : best), fs[0]);
    }
    let qty = Math.min(view.total, minQty(view.bid, face));
    // an opening bid starts at the most you can claim with even odds, not at "1 ×"
    if (!view.bid) while (qty < view.total && odds(view, qty + 1, face) >= 0.5) qty++;
    sel = { face, qty };
  }
  const selLegal = () => sel && sel.qty >= 1 && sel.qty <= view.total && isRaise(view.bid, sel.qty, sel.face);
  function setFace(face) {
    sel.face = face;
    sel.qty = Math.min(view.total, Math.max(sel.qty, minQty(view.bid, face)));
    sound.chip();
    paintControls();
  }
  function step(d) {
    const lo = minQty(view.bid, sel.face);
    const q = Math.min(view.total, Math.max(lo, sel.qty + d));
    if (q === sel.qty) return sound.error();
    sel.qty = q;
    sound.chip();
    paintControls();
  }

  function paintControls() {
    controls.replaceChildren();
    after.replaceChildren();
    if (!view) return;
    const over = view.phase === 'over';
    if (over) {
      after.append(
        h(
          'div.ld-actions',
          h('button.btn.ghost', { onclick: () => ctx.leave() }, 'Game Center'),
          ctx.rematch(),
        ),
      );
      return;
    }
    if (view.phase === 'reveal') {
      if (myRoll()) after.append(h('button.btn.gold.big.ld-roll', { disabled: sent, onclick: () => act({ type: 'roll' }) }, '🎲 Roll for the next round'));
      else after.append(h('small.ld-wait', `${name(view.starter)} rolls next…`));
      return;
    }
    if (!myTurn()) return;
    if (!sel) freshSelection();
    const ok = selLegal() && !sent;
    const qty = h(
      'div.ld-qty',
      h('button.btn.round', { 'aria-label': 'Fewer', disabled: sent || sel.qty <= minQty(view.bid, sel.face), onclick: () => step(-1) }, '−'),
      h('div.ld-qty-n', { 'aria-label': `${sel.qty} dice` }, String(sel.qty)),
      h('button.btn.round', { 'aria-label': 'More', disabled: sent || sel.qty >= view.total, onclick: () => step(1) }, '+'),
    );
    const facePick = h(
      'div.ld-faces',
      { role: 'radiogroup', 'aria-label': 'Face' },
      faces(view.options.wild).map((f) =>
        h(
          'button.ld-face' + (f === sel.face ? '.on' : ''),
          { role: 'radio', 'aria-checked': f === sel.face ? 'true' : 'false', 'aria-label': faceName(f), disabled: sent || minQty(view.bid, f) > view.total, onclick: () => setFace(f) },
          die(f),
        ),
      ),
    );
    const bidBtn = h('button.btn.gold.ld-go', { disabled: !ok, onclick: () => ok && act({ type: 'bid', qty: sel.qty, face: sel.face }) }, h('span', `Bid ${sel.qty} ×`), die(sel.face, 'tiny'));
    const calls = view.bid
      ? [
          h('button.btn.ld-liar', { disabled: sent, onclick: () => act({ type: 'liar' }) }, 'Liar!'),
          view.options.spotOn ? h('button.btn.ld-spot', { disabled: sent, onclick: () => act({ type: 'spot' }) }, 'Spot on') : null,
        ]
      : [];
    const hint = showOdds ? h('div.ld-odds', `Chance ${sel.qty} × ${faceName(sel.face, sel.qty)} is on the table: ${pct(odds(view, sel.qty, sel.face))}`) : null;
    controls.append(h('div.ld-pick', qty, h('span.ld-x', '×'), facePick), hint, h('div.ld-buttons', bidBtn, calls));
  }
  const pct = (p) => `${Math.round(Math.max(0, Math.min(1, p)) * 100)}%`;

  // ---------- the table ----------
  function seatOrder() {
    const n = view.n;
    const from = view.seat ?? -1;
    const out = [];
    for (let i = 1; i <= n; i++) {
      const s = (from + i + n) % n;
      if (s !== view.seat) out.push(s);
    }
    return view.seat == null ? [...Array(n).keys()] : out;
  }

  // the last thing each player said this round
  function lastWords(s) {
    if (view.reveal && view.reveal.caller === s) return view.reveal.call === 'spot' ? 'Spot on!' : 'Liar!';
    const b = [...view.history].reverse().find((x) => x.seat === s);
    return b ? b : null;
  }
  function bubble(s) {
    const w = lastWords(s);
    if (!w) return null;
    if (typeof w === 'string') return h('div.ld-say.call', w);
    const current = view.bid && view.bid.seat === s;
    return h('div.ld-say' + (current ? '.current' : ''), h('span', `${w.qty} ×`), die(w.face, 'tiny'));
  }

  function diceRow(s, { big = false, fresh = false } = {}) {
    const dice = view.dice[s];
    const r = view.reveal;
    const count = view.counts[s];
    if (!dice) {
      // a closed cup, with one dot per die under it
      return h('div.ld-cupzone', h('div.ld-cup' + (fresh ? '.shake' : '')), h('div.ld-dots', Array.from({ length: count }, () => h('i'))));
    }
    const lifted = view.phase !== 'bid' && !isMine(s);
    return h(
      'div.ld-dicerow' + (big ? '.big' : '') + (lifted ? '.lifted' : ''),
      lifted ? h('div.ld-cup.up') : null,
      dice.map((f, i) => {
        const hit = r && matches(f, r.bid.face, r.wild);
        const cls = [hit ? 'hit' : r ? 'miss' : '', fresh ? 'roll' : '', r?.wild && f === 1 ? 'wild' : ''].join(' ');
        const d = die(f, cls);
        d.style.setProperty('--i', i);
        return d;
      }),
    );
  }

  function seatCard(s, fresh) {
    const info = seats[s] || {};
    const out = view.counts[s] === 0 && !(view.reveal?.losers.includes(s) && view.reveal.dice[s]?.length);
    const lost = view.reveal?.losers.includes(s);
    const turn = (view.phase === 'bid' && view.turn === s) || (view.phase === 'reveal' && view.starter === s);
    const cls = (turn ? '.turn' : '') + (out ? '.out' : '') + (lost ? '.lost' : '') + (view.winner === s ? '.won' : '');
    return h(
      'div.ld-seat' + cls,
      { dataset: { seat: s } },
      bubble(s),
      h(
        'div.ld-who',
        avatar(info.name || '?', info.hue ?? 0, { bot: info.kind === 'bot', size: 'sm' }),
        h('div', h('strong', name(s)), h('small', out ? 'Out' : `${view.counts[s]} ${view.counts[s] === 1 ? 'die' : 'dice'}`)),
      ),
      out ? null : diceRow(s, { fresh }),
      lost ? h('div.ld-minus', view.counts[s] === 0 ? 'Out!' : '−1 die') : null,
    );
  }

  function paintCenter() {
    const r = view.reveal;
    if (r) {
      const n = r.actual;
      const bidder = name(r.bid.seat);
      const caller = name(r.caller);
      let verdict;
      // mid-sentence: "you lose a die", "Sam loses a die"
      const loses = (x) => (isMine(x) ? 'you lose' : `${name(x)} loses`);
      if (r.call === 'liar') verdict = r.correct ? `${caller} called it — ${loses(r.bid.seat)} a die.` : `The bid was good — ${loses(r.caller)} a die.`;
      else verdict = r.correct ? `Spot on! Everyone but ${isMine(r.caller) ? 'you' : caller} loses a die.` : `Not exact — ${loses(r.caller)} a die.`;
      const ones = r.wild ? r.dice.flat().filter((d) => d === 1).length : 0;
      bidBox.replaceChildren(
        h('small', `${bidder} bid ${r.bid.qty} × ${faceName(r.bid.face, r.bid.qty)} · ${caller} ${r.call === 'spot' ? 'said spot on' : 'called liar'}`),
        h('div.ld-count', h('span', `There ${n === 1 ? 'was' : 'were'} ${n}`), die(r.bid.face, 'mid')),
        ones && r.bid.face !== 1 ? h('small', `(${ones} wild ${ones === 1 ? 'one' : 'ones'} counted)`) : null,
      );
      status.textContent = view.phase === 'over' ? `${verdict} ${view.winner === mine() ? 'You win!' : `${name(view.winner)} wins!`}` : verdict;
      root.classList.toggle('correct', !!r.correct);
      return;
    }
    if (view.bid) {
      bidBox.replaceChildren(
        h('small', `Round ${view.round} · ${view.total} dice on the table${view.options.wild ? ' · ones are wild' : ''}`),
        h('div.ld-count', h('span', `${view.bid.qty} ×`), die(view.bid.face, 'mid')),
        h('small', `${name(view.bid.seat)} ${isMine(view.bid.seat) ? 'bid' : 'bids'} at least ${view.bid.qty} ${faceName(view.bid.face, view.bid.qty)}`),
        showOdds && view.seat != null && view.dice[view.seat] ? h('small.ld-odds', `Chance it’s true, from your dice: ${pct(odds(view, view.bid.qty, view.bid.face))}`) : null,
      );
    } else {
      bidBox.replaceChildren(
        h('small', `Round ${view.round} · ${view.total} dice on the table${view.options.wild ? ' · ones are wild' : ''}`),
        h('div.ld-count.empty', 'No bid yet'),
        h('small', `${name(view.turn)} ${isMine(view.turn) ? 'open' : 'opens'} the bidding`),
      );
    }
    status.textContent = myTurn() ? (view.bid ? 'Your turn — raise the bid or call it' : 'Your turn — make the first bid') : `${name(view.turn)} ${view.seat == null || !isMine(view.turn) ? 'is thinking…' : ''}`;
  }

  function paintMe(fresh) {
    if (view.seat == null) {
      me.classList.add('watching');
      myDice.replaceChildren(h('small', 'Watching'));
      myNote.textContent = '';
      return;
    }
    me.classList.remove('watching');
    const s = view.seat;
    const dice = view.dice[s];
    const lost = view.reveal?.losers.includes(s);
    const gone = !dice || (!dice.length && view.counts[s] === 0);
    me.classList.toggle('gone', gone);
    if (gone) {
      myDice.replaceChildren(h('small', 'You’re out — watching the rest'));
      myNote.textContent = '';
    } else {
      myDice.replaceChildren(diceRow(s, { big: true, fresh }), lost ? h('div.ld-minus', view.counts[s] === 0 ? 'Out!' : '−1 die') : null);
      me.classList.toggle('turn', myTurn());
      if (view.phase === 'bid') {
        const f = view.bid?.face;
        myNote.textContent = f ? `You hold ${dice.filter((d) => matches(d, f, view.options.wild)).length} that count as ${faceName(f)}` : 'Your dice — only you can see them';
      } else myNote.textContent = '';
    }
    me.classList.toggle('turn', myTurn());
  }

  function render(msg) {
    const prev = view;
    view = msg.view;
    seats = msg.seats || seats;
    sent = false;
    const ev = msg.event?.action;
    const newRound = !prev || prev.round !== view.round || (prev.phase !== 'bid' && view.phase === 'bid');
    if (newRound || (myTurn() && (!prev || prev.turn !== view.turn || prev.bid?.qty !== view.bid?.qty || prev.bid?.face !== view.bid?.face))) sel = null;
    const fresh = newRound && view.phase === 'bid';
    opps.dataset.n = seatOrder().length;
    opps.replaceChildren(...seatOrder().map((s) => seatCard(s, fresh)));
    paintCenter();
    paintMe(fresh);
    paintControls();
    root.classList.toggle('reveal', view.phase !== 'bid');
    root.classList.toggle('over', view.phase === 'over');

    // sounds
    if (ev?.type === 'bid') sound.chip();
    else if (ev?.type === 'roll' || (fresh && !prev)) sound.dice();
    else if (ev?.type === 'liar' || ev?.type === 'spot') {
      sound.pop();
      const r = view.reveal;
      later(() => {
        if (view.phase === 'over') (view.winner === mine() || mine() == null ? sound.win : sound.bad)();
        else if (mine() != null) (r.losers.includes(mine()) ? sound.bad : sound.good)();
      }, 700);
    }
    if (myTurn() && !(prev && prev.phase === 'bid' && prev.turn === view.seat)) later(() => sound.turn(), ev?.type === 'roll' ? 900 : 0);
  }

  function paintVoice() {
    if (!ctx.voice) return;
    opps.querySelectorAll('.ld-seat').forEach((el) => {
      const id = seats[Number(el.dataset.seat)]?.playerId;
      el.classList.toggle('speaking', !!(id && ctx.voice.speaking.has(id)));
    });
  }
  const offVoice = ctx.voice ? [ctx.voice.on('speaking', paintVoice), ctx.voice.on('change', paintVoice)] : [];
  const off = ctx.client.on('state', (msg) => {
    render(msg);
    paintVoice();
  });
  if (ctx.client.lastState) render(ctx.client.lastState);

  // keyboard: arrows change the bid, Enter bids, L calls liar
  function onKey(e) {
    if (!myTurn() || sent || e.target.closest?.('input, textarea')) return;
    if (!sel) freshSelection();
    const fs = faces(view.options.wild);
    if (e.key === 'ArrowUp') step(1);
    else if (e.key === 'ArrowDown') step(-1);
    else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const i = fs.indexOf(sel.face) + (e.key === 'ArrowRight' ? 1 : -1);
      if (fs[i]) setFace(fs[i]);
    } else if (/^[1-6]$/.test(e.key) && fs.includes(Number(e.key))) setFace(Number(e.key));
    else if (e.key === 'Enter' && selLegal() && !e.target.closest?.('button')) act({ type: 'bid', qty: sel.qty, face: sel.face });
    else if ((e.key === 'l' || e.key === 'L') && view.bid) act({ type: 'liar' });
    else return;
    e.preventDefault();
  }
  window.addEventListener('keydown', onKey);

  return {
    destroy() {
      off();
      offVoice.forEach((f) => f());
      timers.forEach(clearTimeout);
      window.removeEventListener('keydown', onKey);
      root.remove();
    },
    settings: () => [
      {
        label: 'Show the odds',
        value: showOdds,
        set: (v) => {
          showOdds = v;
          ctx.prefs.set(PREF_ODDS, v);
          if (view) (paintCenter(), paintControls());
        },
      },
    ],
  };
}
