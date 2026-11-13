// Escape the Grind — the screen. A full 3D table (scene.js) with a heads-up display on top:
// player money strips, an action bar, a financial statement and an event ticker.
// Plays with mouse, touch, keyboard or a game controller (Xbox / PlayStation / Switch pads).
import { h, avatar } from '../../core/util.js';
import { sound } from '../../core/sound.js';
import { Table3D } from './scene.js';
import * as E from './engine.js';
import { GRIND, RING, SPACE_INFO, PLAYER_COLORS, EXPENSE_LABELS, STOCKS } from './cards.js';

const money = E.money;
const SPEED = { relaxed: 1.35, normal: 1, fast: 0.6, turbo: 0.32 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function mount(ctx) {
  const root = h('div.eg');
  const stage = h('div.eg-stage');
  const hud = h('div.eg-hud');
  const econEl = h('button.eg-econ', { onclick: () => openMarket() });
  const lesson = h('div.eg-lesson');
  const strip = h('div.eg-strip');
  const ticker = h('div.eg-ticker');
  const banner = h('div.eg-banner');
  const bar = h('div.eg-bar');
  const tools = h('div.eg-tools');
  const sheet = h('div.eg-sheet');
  const padHint = h('div.eg-padhint');
  const loading = h('div.eg-loading', h('div.eg-loading-coin'), h('p', 'Setting the table…'));
  hud.append(strip, econEl, lesson, tools, ticker, banner, bar, padHint);
  root.append(stage, h('div.eg-vignette'), hud, sheet, loading);
  ctx.el.append(root);

  let table;
  try {
    table = new Table3D(stage, { quality: ctx.prefs.get('eg-quality') || 'high' });
  } catch (err) {
    loading.replaceChildren(h('p', 'This device could not start 3D graphics (WebGPU or WebGL). Try another browser.'));
    console.error(err);
    return { destroy() { root.remove(); } };
  }
  root.table = table;
  root.debug = () => ({ busy, waiting, queue: queue.length, tweens: table.tweens.map((t) => [t.t0, t.ms]), hidden: document.hidden, last: table.last, now: performance.now(), phase: view?.phase, step });
  // the GPU starts up asynchronously: lift the curtain after the first frames, or explain why not
  table.ready.then(
    () => requestAnimationFrame(() => setTimeout(() => loading.classList.add('gone'), 350)),
    (err) => {
      loading.replaceChildren(h('p', 'This device could not start 3D graphics (WebGPU or WebGL). Try another browser.'));
      console.error(err);
    },
  );

  let view = null;
  let seats = [];
  let speed = 1;
  let presentedSeq = null; // cardSeq currently on screen
  let busy = false;
  const queue = [];
  let panelMode = null; // 'money' sub-panel during a roll turn
  let stockQty = 100;
  let statementSeat = null;
  let waiting = false;

  const me = () => view?.seat;
  const name = (s) => (s === me() ? 'You' : seats[s]?.name || ['Red', 'Blue', 'Green', 'Gold'][s]);
  const myTurn = () => view && E.actors(view).includes(me()) && !busy;

  // ---------------------------------------------------------------------------------------------
  // state messages → animations → HUD
  // ---------------------------------------------------------------------------------------------
  function onState(msg) {
    queue.push(msg);
    pump();
  }
  async function pump() {
    if (busy) return;
    busy = true;
    renderBar();
    while (queue.length) {
      const msg = queue.shift();
      try {
        await present(msg, queue.length > 2);
      } catch (e) {
        console.error(e);
      }
    }
    busy = false;
    waiting = false;
    renderAll();
  }

  let step = '';
  async function present(msg, fast) {
    step = 'start';
    const prev = view;
    const v = msg.view;
    seats = msg.seats || seats;
    speed = (SPEED[msg.speed] ?? 1) * (fast ? 0.25 : 1);
    if (!prev || v.seq < prev.seq || prev.seat !== v.seat) {
      view = v;
      table.setMySeat(v.seat ?? 0, !prev);
      v.players.forEach((p, i) => {
        table.placePawn(i, p.track, p.pos);
        table.syncTray(i, p);
      });
      syncDecks(v);
      if (v.econ?.on) table.setMood(v.econ.phase, true);
      if (needsCard(v)) await showCard(v);
      return;
    }
    // 1) dice and pawn
    const r = v.lastRoll;
    if (r && r.seq !== prev.lastRoll?.seq) {
      if (table.hasCard()) await table.dismissCard(null, speed);
      presentedSeq = null;
      table.setActive(r.seat);
      table.lookToward(table.pawns[r.seat].position, 0.35);
      sound.shuffle();
      step = 'dice';
      await table.rollDice(r.seat, r.dice, speed);
      step = 'hop';
      sound.card();
      flash(`${name(r.seat)} rolled ${r.dice.join(' + ')}${r.dice.length > 1 ? ` = ${r.dice[0] + r.dice[1]}` : ''}`, 'roll', 900 * speed);
      const steps = r.dice.reduce((a, b) => a + b, 0);
      const pays = new Map(r.paydays.map((p) => [p.pos, p.amount]));
      const cashShown = { v: prev.players[r.seat].cash };
      await table.hop(r.seat, r.track, r.from, steps, speed, (pos) => {
        sound.pop();
        table.lookToward(table.pawns[r.seat].position, 0.45);
        if (pays.has(pos)) {
          const amt = pays.get(pos);
          cashShown.v += amt;
          sound.chip();
          if (amt > 0) table.burst(table.pawns[r.seat].position.clone().setY(1.2), { count: 18, power: 0.7 });
          flash(`${r.track === 'free' ? 'Freedom ' : ''}Payday ${amt >= 0 ? '+' : ''}${money(amt)}`, amt >= 0 ? 'good' : 'bad', 1300 * speed);
          table.setCash(r.seat, cashShown.v, true);
        }
      });
      const kind = (r.track === 'free' ? RING : GRIND)[r.to];
      if (!['pay', 'fpay'].includes(kind)) flash(SPACE_INFO[kind].label, kind, 1100 * speed);
      await sleep(250 * speed);
    }
    view = v;
    // 2) breaking free
    for (const p of v.players) {
      const was = prev.players[p.seat];
      if (was.track === 'grind' && p.track === 'free') {
        if (table.hasCard()) await table.dismissCard(p.seat, speed);
        presentedSeq = null;
        sound.win();
        flash(`${name(p.seat)} broke out of the Grind!`, 'win', 2600 * speed);
        table.burst(table.pawns[p.seat].position.clone().setY(1), { count: 90, color: true, power: 1.2 });
        await table.leap(p.seat, 'free', p.pos, speed);
      }
    }
    // 3) cards
    step = 'cards';
    if (v.card && v.cardSeq !== presentedSeq && v.cardSeq !== prev.cardSeq) {
      await showCard(v);
      if (v.card.done) {
        const amt = v.card.amount;
        if (v.card.type === 'splurge' || v.card.type === 'setback') sound.bad();
        if (amt) flash(`-${money(amt)}`, 'bad', 1200 * speed);
        await sleep(1700 * speed);
        await table.dismissCard(null, speed);
        presentedSeq = null;
      }
    } else if (needsCard(v) && !table.hasCard()) await showCard(v);
    // the presented card was settled
    if (table.hasCard() && !needsCard(v)) {
      const buyer = v.players.find((p) => p.assets.length > prev.players[p.seat].assets.length || (p.ventures?.length || 0) > (prev.players[p.seat].ventures?.length || 0));
      if (buyer) sound.good();
      await table.dismissCard(buyer ? buyer.seat : null, speed);
      presentedSeq = null;
    }
    // 4) trays, pawns, decks
    step = 'trays';
    v.players.forEach((p, i) => {
      const pos = table.positions[i];
      if (pos.track !== p.track || pos.pos !== p.pos) table.placePawn(i, p.track, p.pos);
      table.syncTray(i, p, { animate: true });
    });
    syncDecks(v);
    // 5) the economy turned
    if (v.econ?.news && v.econ.news.seq !== prev.econ?.news?.seq) {
      const ph = E.ECON[v.econ.phase];
      table.setMood(v.econ.phase);
      renderEcon();
      (v.econ.phase === 'recession' || v.econ.phase === 'slowdown' ? sound.bad : sound.good)();
      flash(ph.label.toUpperCase(), `econ ${v.econ.phase}`, 2200 * speed);
      showLesson(v.econ.phase);
      await sleep(1200 * speed);
    }
    const ev = msg.event;
    if (v.phase === 'over' && prev.phase !== 'over') {
      (v.winner === me() ? sound.win : sound.good)();
      table.burst(table.pawns[v.winner].position.clone().setY(1.5), { count: 160, color: true, power: 1.4 });
    }
    if (ev && v.turn !== prev.turn && v.turn === me() && v.phase === 'roll') sound.turn();
    table.setActive(E.actors(v)[0]);
    if (E.actors(v)[0] === me()) table.lookHome();
  }

  function needsCard(v) {
    return ['deal', 'venture', 'dream', 'market'].includes(v.phase) && v.card && !v.card.done;
  }
  // the event log steps aside while a card is held up
  const cardWatch = setInterval(() => root.classList.toggle('card-up', table.hasCard()), 200);
  async function showCard(v) {
    presentedSeq = v.cardSeq;
    sound.slide();
    await table.showCard(v.card, v.card.deck || 'small', speed);
  }
  function syncDecks(v) {
    for (const [k, n] of Object.entries(v.deckSizes || {})) table.setDeckSize(k, n);
  }

  // ---------------------------------------------------------------------------------------------
  // HUD
  // ---------------------------------------------------------------------------------------------
  function renderAll() {
    if (!view) return;
    renderStrip();
    renderTicker();
    renderBar();
    renderTools();
    renderEcon();
    if (statementSeat != null) renderStatement(statementSeat);
    focusFirst();
  }

  // ---------------------------------------------------------------------------------------------
  // the economy (real-life mode)
  // ---------------------------------------------------------------------------------------------
  function renderEcon() {
    const e = view?.econ;
    econEl.classList.toggle('on', !!e?.on);
    root.classList.toggle('econ-on', !!e?.on);
    if (!e?.on) return;
    const ph = E.ECON[e.phase];
    const hist = e.history.length > 1 ? e.history : [e.history[0], e.history[0]];
    const prevIdx = hist.length > 1 ? hist[hist.length - 2] : e.index;
    const chg = e.index - prevIdx;
    const lo = Math.min(...hist) - 2, hi = Math.max(...hist) + 2;
    const pts = hist.map((v, i) => `${((i / Math.max(1, hist.length - 1)) * 160).toFixed(1)},${(44 - ((v - lo) / (hi - lo)) * 40).toFixed(1)}`).join(' ');
    const deals = e.mult < 1 ? `${Math.round((1 - e.mult) * 100)}% off` : e.mult > 1 ? `+${Math.round((e.mult - 1) * 100)}%` : 'normal';
    econEl.style.setProperty('--ec', ph.color);
    econEl.replaceChildren(
      h('div.eg-econ-top', h('span.eg-econ-phase', ph.label), h(`span.eg-econ-idx${chg < 0 ? '.down' : ''}`, `${e.index.toFixed(1)} ${chg >= 0 ? '▲' : '▼'}${Math.abs(chg).toFixed(1)}`)),
      h('div.eg-spark', { html: `<svg viewBox="0 0 160 46" preserveAspectRatio="none"><polyline points="0,46 ${pts} 160,46" fill="var(--ec)" fill-opacity=".14" stroke="none"/><polyline points="${pts}" fill="none" stroke="var(--ec)" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>` }),
      h('div.eg-econ-grid',
        h('span', 'Deals'), h(`b${e.mult < 1 ? '.good' : e.mult > 1 ? '.bad' : ''}`, deals),
        h('span', 'Loan rate'), h('b', `${Math.round(e.rate * 100)}%/mo`),
        h('span', 'Business income'), h(`b${e.biz < 1 ? '.bad' : e.biz > 1 ? '.good' : ''}`, `${Math.round(e.biz * 100)}%`),
      ),
      h('div.eg-econ-stocks', ...Object.entries(e.prices).map(([sym, pr]) => {
        const d = pr - (e.prev[sym] ?? pr);
        return h(`span${d < 0 ? '.down' : d > 0 ? '.up' : ''}`, h('i', sym), `$${pr}`);
      })),
    );
  }
  let lessonTimer;
  function showLesson(phase) {
    const ph = E.ECON[phase];
    clearTimeout(lessonTimer);
    lesson.style.setProperty('--ec', ph.color);
    lesson.replaceChildren(h('strong', `Money lesson · ${ph.label}`), h('p', ph.headline), h('p.tip', ph.tip));
    lesson.classList.add('show');
    lessonTimer = setTimeout(() => lesson.classList.remove('show'), 11000);
  }
  function openMarket() {
    if (!view?.econ?.on) return;
    if (view.phase === 'roll' && E.actors(view)[0] === me() && !busy) {
      panelMode = 'stocks';
      renderBar();
      focusFirst();
    } else showLesson(view.econ.phase);
  }

  function renderStrip() {
    const act = E.actors(view)[0];
    strip.replaceChildren(
      ...view.players.map((p) => {
        const prog = E.freedomProgress(p);
        const cf = p.track === 'free' ? p.freeFlow : E.cashflow(p);
        return h(
          `button.eg-chip${p.seat === act ? '.active' : ''}${p.seat === me() ? '.me' : ''}${p.track === 'free' ? '.free' : ''}${view.winner === p.seat ? '.won' : ''}`,
          { style: { '--pc': PLAYER_COLORS[p.seat] }, onclick: () => openStatement(p.seat), title: 'Open financial statement' },
          avatar(seats[p.seat]?.name || '?', seats[p.seat]?.hue ?? 0, { bot: seats[p.seat]?.kind === 'bot', size: 'sm' }),
          h(
            'div.eg-chip-body',
            h('div.eg-chip-top', h('strong', name(p.seat)), h('small', p.track === 'free' ? 'Freedom Ring' : p.jobName)),
            h('div.eg-chip-money', h('span', money(p.cash)), h(`span.cf${cf < 0 ? '.neg' : ''}`, `${cf >= 0 ? '+' : ''}${money(cf)}/mo`)),
            h(
              'div.eg-meter',
              { title: p.track === 'free' ? 'Progress to +$50,000 a month' : 'Passive income vs. expenses' },
              h('i', { style: { width: `${Math.round(prog * 100)}%` } }),
            ),
          ),
          p.laidOff ? h('span.eg-tag.bad', 'Laid off') : p.charity ? h('span.eg-tag', `2 dice ×${p.charity}`) : null,
        );
      }),
    );
  }

  let tickerSeq = 0;
  function renderTicker() {
    const fresh = view.log.slice(-5);
    ticker.replaceChildren(
      ...fresh.map((l) =>
        h(
          `div.eg-line${l.kind ? '.' + l.kind : ''}${l.seq > tickerSeq ? '.new' : ''}`,
          l.seat != null ? h('b', { style: { color: PLAYER_COLORS[l.seat] } }, name(l.seat) + ' ') : null,
          l.seat != null && l.seat === me() ? fixYou(l.text) : l.text,
        ),
      ),
    );
    tickerSeq = view.seq;
  }
  const fixYou = (t) => t.replace(/\btheir\b/g, 'your').replace(/^is /, 'are ').replace(/^was /, 'were ').replace(/^has /, 'have ');

  let flashTimer;
  function flash(text, kind = '', ms = 1200) {
    clearTimeout(flashTimer);
    banner.className = `eg-banner show ${kind}`;
    banner.textContent = text;
    flashTimer = setTimeout(() => banner.classList.remove('show'), ms + 300);
  }

  function btn(label, onclick, { primary = false, back = false, disabled = false, sub = null, cls = '' } = {}) {
    return h(
      `button.eg-btn${primary ? '.primary' : ''}${back ? '.back' : ''}${cls ? '.' + cls : ''}`,
      { onclick: () => !disabled && onclick(), disabled, dataset: { primary: primary ? '1' : '', back: back ? '1' : '' } },
      h('span', label),
      sub ? h('small', sub) : null,
    );
  }
  function act(move) {
    if (waiting) return;
    waiting = true;
    sound.pop();
    // stay in the stock market after a trade so you can keep trading
    if (!(panelMode === 'stocks' && ['trade', 'short', 'cover'].includes(move.type))) panelMode = null;
    renderBar();
    ctx.client.act(move);
    setTimeout(() => {
      if (waiting && !busy) {
        waiting = false;
        renderBar();
      }
    }, 4000);
  }

  function renderBar() {
    if (!view) return bar.replaceChildren();
    const actor = E.actors(view)[0];
    const p = view.players[me()];
    if (view.phase === 'over') {
      const w = view.winner;
      return bar.replaceChildren(
        h('div.eg-prompt.win', h('strong', w === me() ? 'You win!' : `${name(w)} wins!`), h('span', `${name(w)} ${w === me() ? fixYou(view.winReason) : view.winReason}.`)),
        h(
          'div.eg-actions',
          ctx.client.isHost ? btn('Play again', () => ctx.client.send({ t: 'rematch' }), { primary: true }) : h('small.eg-wait', 'Waiting for the host…'),
          btn('Game Center', () => ctx.leave(), { back: true }),
          btn('Statements', () => openStatement(me() ?? w)),
        ),
      );
    }
    if (busy || waiting || actor !== me() || me() == null) {
      const who = actor != null ? name(actor) : '';
      const phaseText = {
        roll: 'is about to roll',
        pick: 'is choosing a deal',
        deal: 'is looking at the deal',
        charity: 'is deciding whether to give',
        market: 'is deciding whether to sell',
        venture: 'is weighing the venture',
        dream: 'is looking at a dream',
      }[view.phase];
      return bar.replaceChildren(
        h('div.eg-prompt.wait', h('span.eg-dot', { style: { background: PLAYER_COLORS[actor] ?? '#999' } }), h('span', busy ? '…' : waiting ? 'One moment…' : `${who} ${phaseText || 'is playing'}…`)),
      );
    }
    const legal = E.legal(view, me());
    const L = (type, pred = () => true) => legal.find((m) => m.type === type && pred(m));
    const space = SPACE_INFO[(p.track === 'free' ? RING : GRIND)[p.pos]];
    const kids = [];
    switch (view.phase) {
      case 'roll': {
        if (panelMode === 'money' && p.track === 'grind') return renderMoney(p, legal);
        if (panelMode === 'stocks' && view.econ?.on) return renderStocks(p, legal);
        const two = L('roll', (m) => m.dice === 2);
        const one = L('roll', (m) => m.dice === 1);
        kids.push(
          h('div.eg-prompt', h('strong', 'Your turn'), h('span', p.track === 'free' ? 'Roll two dice around the Freedom Ring.' : `You are on ${space.label}. Cash ${money(p.cash)} · cash flow ${money(E.cashflow(p))}/mo`)),
        );
        const acts = [];
        if (two && one) acts.push(btn('Roll 1 die', () => act(one)), btn('Roll 2 dice', () => act(two), { primary: true }));
        else acts.push(btn(two ? 'Roll the dice' : 'Roll', () => act(two || one), { primary: true }));
        if (p.track === 'grind') acts.push(btn('Loans & payoffs', () => ((panelMode = 'money'), renderBar(), focusFirst())));
        if (view.econ?.on) acts.push(btn('Stock market', () => ((panelMode = 'stocks'), renderBar(), focusFirst()), { sub: E.ECON[view.econ.phase].label }));
        kids.push(h('div.eg-actions', acts));
        break;
      }
      case 'pick':
        kids.push(
          h('div.eg-prompt', h('strong', 'Opportunity!'), h('span', `Small deals cost $5,000 or less. Big deals need more cash, but pay more. You have ${money(p.cash)}.`)),
          h('div.eg-actions', btn('Small Deal', () => act(L('pick', (m) => m.size === 'small')), { primary: p.cash < 12000, sub: 'up to $5,000' }), btn('Big Deal', () => act(L('pick', (m) => m.size === 'big')), { primary: p.cash >= 12000, sub: '$6,000 and up' })),
        );
        break;
      case 'deal': {
        const c = view.card;
        if (c.type === 'stock') {
          const own = p.stocks[c.sym] || 0;
          const max = Math.floor(p.cash / c.price);
          stockQty = Math.max(0, Math.min(stockQty, max));
          if (stockQty === 0 && max > 0) stockQty = Math.min(100, max);
          const qty = h('div.eg-qty', btn('−', () => setQty(-1), { cls: 'sq' }), h('div.eg-qty-n', h('strong', stockQty.toLocaleString('en-US')), h('small', 'shares')), btn('+', () => setQty(1), { cls: 'sq' }));
          kids.push(
            h('div.eg-prompt', h('strong', `${c.sym} at $${c.price}`), h('span', `You own ${own.toLocaleString('en-US')} shares${own ? ` (avg $${(p.stockCost[c.sym] || 0).toFixed(2)})` : ''}. You can afford ${max.toLocaleString('en-US')}.`)),
            h(
              'div.eg-actions',
              max > 0 ? qty : null,
              max > 0 ? btn(`Buy for ${money(stockQty * c.price)}`, () => act({ type: 'buy', qty: stockQty }), { primary: true, disabled: stockQty < 1 }) : null,
              own ? btn(`Sell all ${own.toLocaleString('en-US')}`, () => act({ type: 'sell', qty: own }), { sub: `for ${money(own * c.price)}`, primary: max === 0 }) : null,
              btn('Pass', () => act({ type: 'pass' }), { back: true }),
            ),
          );
        } else {
          const buy = L('buy');
          kids.push(
            h('div.eg-prompt', h('strong', c.name), h('span', `${money(c.down)} down · ${c.flow >= 0 ? '+' : ''}${money(c.flow)} a month${c.mortgage ? ` · ${money(c.mortgage)} loan` : ''}`)),
            h(
              'div.eg-actions',
              buy.loan
                ? btn(`Buy with a ${money(buy.loan)} loan`, () => act(buy), { sub: `loan costs ${money(buy.loan * 0.1)}/mo` })
                : btn(`Buy for ${money(c.down)}`, () => act(buy), { primary: c.flow > 0 }),
              btn('Pass', () => act({ type: 'pass' }), { back: true, primary: c.flow <= 0 }),
            ),
          );
        }
        break;
      }
      case 'charity': {
        const amt = Math.round(E.income(p) * 0.1);
        kids.push(
          h('div.eg-prompt', h('strong', 'Give back'), h('span', `Give 10% of your income (${money(amt)}) and you may roll two dice for your next 3 turns.`)),
          h('div.eg-actions', btn(`Give ${money(amt)}`, () => act({ type: 'donate' }), { primary: p.cash > amt * 2 }), btn('Not now', () => act({ type: 'skip' }), { back: true })),
        );
        break;
      }
      case 'market': {
        const c = view.market.card;
        const sells = legal.filter((m) => m.type === 'sell').map((m) => {
          const a = p.assets.find((x) => x.id === m.id);
          const val = E.offerValue(a, c);
          return btn(`Sell ${a.name}`, () => act(m), { sub: `${money(val)} · you keep ${money(val - (a.mortgage || 0))} · lose ${money(a.flow)}/mo`, cls: 'wide' });
        });
        kids.push(h('div.eg-prompt', h('strong', c.name), h('span', c.text)), h('div.eg-actions.col', sells, btn('Keep them', () => act({ type: 'keep' }), { back: true, primary: true })));
        break;
      }
      case 'venture':
      case 'dream': {
        const c = view.card;
        const buy = L('buy');
        const goal = p.freeStart + E.FREEDOM_GOAL;
        kids.push(
          h('div.eg-prompt', h('strong', c.name), h('span', view.phase === 'dream' ? `Buy it for ${money(c.cost)} and you win. You have ${money(p.cash)}.` : `${money(c.cost)} · +${money(c.flow)}/mo. Freedom income ${money(p.freeFlow)} of ${money(goal)} goal.`)),
          h('div.eg-actions', btn(buy ? `Buy for ${money(c.cost)}` : `Need ${money(c.cost - p.cash)} more`, () => act(buy), { primary: !!buy, disabled: !buy }), btn('Pass', () => act({ type: 'pass' }), { back: true, primary: !buy })),
        );
        break;
      }
    }
    bar.replaceChildren(...kids);
  }
  function setQty(dir) {
    const p = view.players[me()];
    const c = view.card;
    const max = Math.floor(p.cash / c.price);
    const steps = [1, 10, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000];
    if (dir > 0) stockQty = steps.find((s) => s > stockQty && s <= max) ?? max;
    else stockQty = [...steps].reverse().find((s) => s < stockQty) ?? 1;
    stockQty = Math.min(stockQty, max);
    const focused = document.activeElement?.textContent;
    renderBar();
    // keep the controller/keyboard focus on the same +/− button
    const again = [...bar.querySelectorAll('button')].find((b) => b.textContent === focused);
    again?.focus();
  }

  function renderStocks(p, legal) {
    const e = view.econ;
    const has = (m) => legal.some((x) => x.type === m.type && x.sym === m.sym && x.qty === m.qty);
    const rows = Object.entries(e.prices).map(([sym, pr]) => {
      const d = pr - (e.prev[sym] ?? pr);
      const own = p.stocks[sym] || 0;
      const sh = p.shorts?.[sym];
      let pos = 'No position';
      if (own) {
        const pl = (pr - (p.stockCost[sym] || 0)) * own;
        pos = `Own ${own.toLocaleString('en-US')} @ $${(p.stockCost[sym] || 0).toFixed(2)} · ${pl >= 0 ? '+' : ''}${money(pl)}`;
      } else if (sh) {
        const pl = (sh.price - pr) * sh.qty;
        pos = `Short ${sh.qty.toLocaleString('en-US')} @ $${sh.price} · ${pl >= 0 ? '+' : ''}${money(pl)}`;
      }
      const btns = [];
      for (const q of [10, 100, 1000]) if (has({ type: 'trade', sym, qty: q })) btns.push(btn(`Buy ${q}`, () => act({ type: 'trade', sym, qty: q }), { sub: money(q * pr), cls: 'sm' }));
      if (own) btns.push(btn('Sell all', () => act({ type: 'trade', sym, qty: -own }), { sub: money(own * pr), cls: 'sm' }));
      if (sh) btns.push(btn('Cover', () => act({ type: 'cover', sym }), { sub: 'close short', cls: 'sm' }));
      for (const q of [10, 100, 1000]) if (has({ type: 'short', sym, qty: q })) btns.push(btn(`Short ${q}`, () => act({ type: 'short', sym, qty: q }), { sub: `bet on a fall`, cls: 'sm.short' }));
      return h(
        'div.eg-stock',
        h('div.eg-stock-name', h('strong', sym), h('small', STOCKS[sym].name)),
        h(`div.eg-stock-price${d < 0 ? '.down' : d > 0 ? '.up' : ''}`, h('strong', `$${pr}`), h('small', d ? `${d > 0 ? '▲' : '▼'} $${Math.abs(d)}` : '—')),
        h(`div.eg-stock-pos${/ \+/.test(pos) ? '.up' : /-\$/.test(pos) ? '.down' : ''}`, pos),
        h('div.eg-stock-btns', btns.length ? btns : h('small.eg-note', 'Not enough cash')),
      );
    });
    const ph = E.ECON[e.phase];
    bar.replaceChildren(
      h('div.eg-prompt', h('strong', 'Stock market'), h('span', `${ph.label} · cash ${money(p.cash)}. ${ph.tip}`)),
      h('div.eg-stocks', rows),
      h('small.eg-note', `Short selling: you profit when the price falls and lose if it rises. You need cash of ${E.SHORT_MARGIN * 100}% of every short; if the loss grows too big the bank closes it (a margin call).`),
      h('div.eg-actions', btn('Done', () => ((panelMode = null), renderBar(), focusFirst()), { back: true, primary: true })),
    );
  }

  function renderMoney(p, legal) {
    const payoffs = legal.filter((m) => m.type === 'payoff').map((m) => {
      const d = p.debts[m.key];
      return btn(`Pay off ${d.label}`, () => act(m), { sub: `${money(d.balance)} · saves ${money(p.exp[m.key])}/mo`, cls: 'wide' });
    });
    const owed = Object.entries(p.debts).filter(([k, d]) => d && !legal.some((m) => m.type === 'payoff' && m.key === k));
    const repay = legal.filter((m) => m.type === 'repay').map((m) => btn(m.amount === p.bank ? `Repay all ${money(m.amount)}` : `Repay ${money(m.amount)}`, () => act(m), { sub: `saves ${money(m.amount * 0.1)}/mo` }));
    const borrow = [1000, 5000, 10000, 25000].map((a) => btn(`Borrow ${money(a)}`, () => act({ type: 'borrow', amount: a }), { sub: `costs ${money(a * 0.1)}/mo` }));
    bar.replaceChildren(
      h('div.eg-prompt', h('strong', 'Loans & payoffs'), h('span', `Cash ${money(p.cash)} · bank loan ${money(p.bank)} (10% a month). Paying off debt raises your cash flow.`)),
      h('div.eg-actions.col', payoffs, owed.length ? h('small.eg-note', `Not enough cash yet to pay off: ${owed.map(([, d]) => `${d.label} ${money(d.balance)}`).join(', ')}`) : null),
      h('div.eg-actions', repay, borrow, btn('Done', () => ((panelMode = null), renderBar(), focusFirst()), { back: true, primary: true })),
    );
  }

  function renderTools() {
    tools.replaceChildren(
      h('button.eg-tool', { title: 'My financial statement (Y)', onclick: () => openStatement(me() ?? 0) }, h('span', { html: ICONS.sheet })),
      h('button.eg-tool', { title: 'Camera view (X)', onclick: () => cycleCamera() }, h('span', { html: ICONS.cam })),
      h('button.eg-tool', { title: 'Center the board (R, or double-tap the table)', 'aria-label': 'Center the board', onclick: () => recenter() }, h('span', { html: ICONS.center })),
      h('button.eg-tool', { title: 'Full screen (Start)', onclick: () => fullscreen() }, h('span', { html: ICONS.full })),
    );
  }
  const CAMS = ['home', 'top', 'low'];
  let camIdx = 0;
  function cycleCamera() {
    camIdx = (camIdx + 1) % CAMS.length;
    table.view(CAMS[camIdx]);
  }
  function recenter() {
    camIdx = 0;
    table.recenter();
  }
  // double-tap (or double-click) the table to bring the board back to the middle
  {
    let lastTap = 0, downAt = null;
    table.canvas.addEventListener('pointerdown', (e) => (downAt = e.isPrimary ? { x: e.clientX, y: e.clientY, t: performance.now() } : null));
    table.canvas.addEventListener('pointerup', (e) => {
      if (!downAt || !e.isPrimary) return;
      const still = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 12 && performance.now() - downAt.t < 300;
      downAt = null;
      if (!still) return (lastTap = 0);
      const now = performance.now();
      if (now - lastTap < 350) {
        lastTap = 0;
        recenter();
      } else lastTap = now;
    });
  }
  function fullscreen() {
    const el = document.documentElement;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el);
  }

  // ---------------------------------------------------------------------------------------------
  // financial statement
  // ---------------------------------------------------------------------------------------------
  function openStatement(seat) {
    statementSeat = seat;
    renderStatement(seat);
    sheet.classList.add('open');
    sound.slide();
    setTimeout(() => sheet.querySelector('button')?.focus(), 50);
  }
  function closeStatement() {
    statementSeat = null;
    sheet.classList.remove('open');
    focusFirst();
  }
  function renderStatement(seat) {
    const p = view.players[seat];
    const row = (label, val, cls = '') => h(`div.eg-row${cls ? '.' + cls : ''}`, h('span', label), h('b', val));
    const inc = [
      row('Salary', money(p.salary)),
      ...p.assets.filter((a) => a.flow).map((a) => {
        const f = E.assetFlow(p, a);
        const note = f !== a.flow ? ` (economy ${Math.round((p.bizMod ?? 1) * 100)}%)` : '';
        return row(a.name + note, `${f > 0 ? '+' : ''}${money(f)}`, f < 0 ? 'neg' : 'pos');
      }),
    ];
    const exp = [
      ...Object.entries(p.exp).filter(([, v]) => v).map(([k, v]) => row(EXPENSE_LABELS[k], money(v))),
      p.children ? row(`Children (${p.children} × ${money(p.perChild)})`, money(p.children * p.perChild)) : null,
      p.bank ? row('Bank loan payment', money(E.bankPayment(p))) : null,
    ];
    const assets = [
      row('Cash', money(p.cash)),
      ...Object.entries(p.stocks).map(([sym, n]) =>
        row(`${STOCKS[sym]?.name || sym}: ${n.toLocaleString('en-US')} sh (avg $${(p.stockCost[sym] || 0).toFixed(2)})`, p.stockPrice?.[sym] ? `worth ${money(n * p.stockPrice[sym])}` : '—'),
      ),
      ...Object.entries(p.shorts || {}).map(([sym, sh]) => {
        const pl = (sh.price - (p.stockPrice?.[sym] ?? sh.price)) * sh.qty;
        return row(`Short ${sym}: ${sh.qty.toLocaleString('en-US')} sh at $${sh.price}`, `${pl >= 0 ? '+' : ''}${money(pl)}`, pl < 0 ? 'neg' : 'pos');
      }),
      ...p.assets.map((a) => row(a.name, `paid ${money(a.cost)}`)),
      ...(p.ventures || []).map((v) => row(v.name, money(v.cost))),
    ];
    const debts = [
      ...Object.values(p.debts).filter(Boolean).map((d) => row(d.label, money(d.balance))),
      ...p.assets.filter((a) => a.mortgage).map((a) => row(`Loan: ${a.name}`, money(a.mortgage))),
      p.bank ? row('Bank loan', money(p.bank)) : null,
    ];
    const pas = E.passive(p), tot = E.expenses(p);
    const tabs = view.players.map((q) => h(`button.eg-tab${q.seat === seat ? '.on' : ''}`, { style: { '--pc': PLAYER_COLORS[q.seat] }, onclick: () => openStatement(q.seat) }, name(q.seat)));
    sheet.replaceChildren(
      h(
        'div.eg-sheet-card',
        h('div.eg-tabs', tabs, h('button.eg-close', { onclick: closeStatement, dataset: { back: '1' }, 'aria-label': 'Close' }, '×')),
        h('h2', { style: { color: PLAYER_COLORS[seat] } }, `${name(seat)} — ${p.jobName}`),
        p.track === 'free'
          ? h(
              'div.eg-escape.free',
              h('div', h('small', 'Freedom income'), h('strong', `${money(p.freeFlow)}/mo`)),
              h('div', h('small', 'Goal'), h('strong', money(p.freeStart + E.FREEDOM_GOAL))),
              h('div.eg-meter.big', h('i', { style: { width: `${Math.round(E.freedomProgress(p) * 100)}%` } })),
              h('p', 'Buy your Dream on a gold Dream space, or add $50,000 a month in ventures, to win.'),
            )
          : h(
              'div.eg-escape',
              h('div', h('small', 'Passive income'), h('strong', money(pas))),
              h('div', h('small', 'Total expenses'), h('strong', money(tot))),
              h('div.eg-meter.big', h('i', { style: { width: `${Math.round(Math.min(1, pas / tot) * 100)}%` } })),
              h('p', pas > tot ? 'You are free!' : `${money(tot - pas)} more passive income a month and you break out of the Grind.`),
            ),
        h(
          'div.eg-cols',
          h('section', h('h3', 'Income'), inc, row('Total income', money(E.income(p)), 'total'), h('h3', 'Expenses'), exp, row('Total expenses', money(tot), 'total'), row('Monthly cash flow', money(E.cashflow(p)), `big${E.cashflow(p) < 0 ? '.neg' : ''}`)),
          h('section', h('h3', 'Assets'), assets, h('h3', 'Liabilities'), debts.filter(Boolean).length ? debts : h('p.eg-note', 'No debts. Nice.'), row('Net worth', money(E.netWorth(p)), 'total')),
        ),
      ),
    );
    sheet.onclick = (e) => e.target === sheet && closeStatement();
  }

  // ---------------------------------------------------------------------------------------------
  // keyboard and game controller
  // ---------------------------------------------------------------------------------------------
  function focusables() {
    const scope = sheet.classList.contains('open') ? sheet : bar;
    return [...scope.querySelectorAll('button:not([disabled])')].filter((b) => b.offsetParent);
  }
  function focusFirst() {
    if (!padActive && !keyActive) return;
    const list = focusables();
    if (list.includes(document.activeElement)) return;
    (list.find((b) => b.dataset.primary === '1') || list[0])?.focus();
  }
  function move(dx, dy) {
    const list = focusables();
    if (!list.length) return;
    const cur = list.includes(document.activeElement) ? document.activeElement : null;
    if (!cur) return (list.find((b) => b.dataset.primary === '1') || list[0]).focus();
    const a = cur.getBoundingClientRect();
    const ac = { x: a.left + a.width / 2, y: a.top + a.height / 2 };
    let best = null, bestScore = Infinity;
    for (const b of list) {
      if (b === cur) continue;
      const r = b.getBoundingClientRect();
      const c = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      const ddx = c.x - ac.x, ddy = c.y - ac.y;
      const along = dx ? ddx * dx : ddy * dy;
      if (along <= 4) continue;
      const across = dx ? Math.abs(ddy) : Math.abs(ddx);
      const score = along + across * 2.5;
      if (score < bestScore) [best, bestScore] = [b, score];
    }
    if (!best && dx) {
      const i = list.indexOf(cur);
      best = list[(i + dx + list.length) % list.length];
    }
    best?.focus();
    sound.card();
  }
  function back() {
    if (sheet.classList.contains('open')) return closeStatement();
    if (panelMode) {
      panelMode = null;
      renderBar();
      return focusFirst();
    }
    const b = bar.querySelector('button[data-back="1"]:not([disabled])');
    if (b && document.activeElement !== b) b.focus();
    else b?.click();
  }
  function primary() {
    const list = focusables();
    if (list.includes(document.activeElement)) return document.activeElement.click();
    (list.find((b) => b.dataset.primary === '1') || list[0])?.click();
  }
  function toggleSheet() {
    if (sheet.classList.contains('open')) closeStatement();
    else openStatement(me() ?? 0);
  }

  let keyActive = false;
  const onKey = (e) => {
    if (e.target.closest?.('input, textarea, select') || document.querySelector('.gc-modal, .gc-sheet.open')) return;
    const k = e.key;
    const map = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (map[k]) {
      keyActive = true;
      move(...map[k]);
    } else if (k === 'Enter' || k === ' ') {
      if (focusables().includes(document.activeElement)) return;
      primary();
    } else if (k === 'Escape' || k === 'Backspace') back();
    else if (k === 's' || k === 'S') toggleSheet();
    else if (k === 'c' || k === 'C') cycleCamera();
    else if (k === 'r' || k === 'R' || k === 'Home') recenter();
    else if (k === 'f' || k === 'F') fullscreen();
    else if (k === '+' || k === '=') table.zoom(0.9);
    else if (k === '-') table.zoom(1.1);
    else return;
    e.preventDefault();
  };
  window.addEventListener('keydown', onKey);

  let padActive = false;
  const held = new Map();
  let padRaf;
  function pollPad() {
    padRaf = requestAnimationFrame(pollPad);
    const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
    const gp = pads[0];
    if (!gp) return;
    const now = performance.now();
    const press = (id, on, fn, repeat = false) => {
      const t = held.get(id);
      if (on && t == null) {
        held.set(id, now + 380);
        if (!padActive) {
          padActive = true;
          root.classList.add('pad');
          padHint.replaceChildren(...PAD_HINT());
          focusFirst();
        }
        fn();
      } else if (on && repeat && now > t) {
        held.set(id, now + 120);
        fn();
      } else if (!on) held.delete(id);
    };
    const b = (i) => gp.buttons[i]?.pressed;
    const ax = (i) => (Math.abs(gp.axes[i] || 0) > 0.55 ? Math.sign(gp.axes[i]) : 0);
    press('a', b(0), primary);
    press('b', b(1), back);
    press('x', b(2), cycleCamera);
    press('y', b(3), toggleSheet);
    press('start', b(9), fullscreen);
    press('rstick', b(11), recenter);
    press('back', b(8), () => openStatement(((statementSeat ?? me() ?? 0) + 1) % 4));
    press('up', b(12) || ax(1) < 0, () => move(0, -1), true);
    press('down', b(13) || ax(1) > 0, () => move(0, 1), true);
    press('left', b(14) || ax(0) < 0, () => move(-1, 0), true);
    press('right', b(15) || ax(0) > 0, () => move(1, 0), true);
    const rx = gp.axes[2] || 0, ry = gp.axes[3] || 0;
    if (Math.abs(rx) > 0.15 || Math.abs(ry) > 0.15) table.orbit(rx * 0.035, ry * 0.025);
    const lt = gp.buttons[6]?.value || 0, rt = gp.buttons[7]?.value || 0;
    if (b(4) || lt > 0.2) table.zoom(1 + 0.02 * Math.max(lt, b(4) ? 1 : 0));
    if (b(5) || rt > 0.2) table.zoom(1 - 0.02 * Math.max(rt, b(5) ? 1 : 0));
  }
  pollPad();
  const onPad = () => ctx.toast?.('Controller connected — A to choose, B to go back, Y for your statement');
  window.addEventListener('gamepadconnected', onPad);

  const off = ctx.client.on('state', onState);
  if (ctx.client.lastState) onState(ctx.client.lastState);
  renderTools();

  return {
    destroy() {
      off();
      clearInterval(cardWatch);
      cancelAnimationFrame(padRaf);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('gamepadconnected', onPad);
      table.dispose();
      root.remove();
    },
    settings: () => [
      {
        label: 'High-quality graphics',
        value: (ctx.prefs.get('eg-quality') || 'high') === 'high',
        set: (v) => {
          ctx.prefs.set('eg-quality', v ? 'high' : 'low');
          table.setQuality(v ? 'high' : 'low');
        },
      },
    ],
  };
}

const PAD_HINT = () => [
  h('span', h('i.a', 'A'), 'Choose'),
  h('span', h('i.b', 'B'), 'Back'),
  h('span', h('i.y', 'Y'), 'Statement'),
  h('span', h('i.x', 'X'), 'Camera'),
  h('span', h('i.s', 'R'), 'Orbit'),
  h('span', h('i.s', 'LT/RT'), 'Zoom'),
];
const ICONS = {
  sheet: '<svg viewBox="0 0 24 24"><path d="M6 3h9l4 4v14H6z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9 11h7M9 15h7M9 7h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  cam: '<svg viewBox="0 0 24 24"><path d="M4 8h3l2-2h6l2 2h3v11H4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.5" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
  center: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="6.5" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><path d="M12 2.5v3.5M12 18v3.5M2.5 12H6M18 12h3.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  full: '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};
