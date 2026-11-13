// Shed Tycoon screen: the sales lots, the order board (three tiers of buildings), the material
// supply, and every builder's yard. Tap materials to fill your cart and press Take; tap an order
// to build it or hold it. Moves go out with ctx.client.act(); the screen only ever draws the
// views it receives.
import { h, avatar } from '../../core/util.js';
import { sound } from '../../core/sound.js';
import { CARDS, LOTS, MAT_NAMES, CASH, TOKEN_LIMIT, RESERVE_LIMIT, DECK, bonuses, points, payment, tokenCount } from './engine.js';
import { MAT_COLORS, matIcon, buildingArt } from './art.js';

const NAMES = [...MAT_NAMES, 'Cash'];
const TIER_NAMES = ['Sheds', 'Barns', 'Garages & lodges'];

const token = (m, extra = '', label = '') => h(`span.st-tok.m${m}${extra}`, { html: matIcon(m), style: { '--k': MAT_COLORS[m] }, title: NAMES[m], 'aria-label': label || NAMES[m] });

function costPips(cost, have = null) {
  return h(
    'div.st-cost',
    cost.flatMap((k, m) => (k ? [h(`span.st-pip${have && have[m] >= k ? '.met' : ''}`, { style: { '--k': MAT_COLORS[m] }, title: `${k} ${NAMES[m]}` }, k)] : [])),
  );
}

function cardEl(id, { onclick, can = false, fresh = false, small = false } = {}) {
  const c = CARDS[id];
  return h(
    `button.st-card.t${c.tier}${can ? '.can' : ''}${fresh ? '.fresh' : ''}${small ? '.small' : ''}`,
    { onclick, style: { '--k': MAT_COLORS[c.bonus] }, 'aria-label': `${c.name}: ${c.points} points, ${MAT_NAMES[c.bonus]} discount` },
    h('div.st-card-top', h('b.st-pts', c.points || ''), token(c.bonus, '.bonus')),
    h('div.st-art', { html: buildingArt(c.tier, c.bonus) }),
    h('div.st-name', c.name),
    costPips(c.cost),
  );
}

export function mount(ctx) {
  const root = h('div.st');
  const status = h('div.st-status');
  const note = h('div.st-note');
  const lots = h('section.st-lots');
  const board = h('section.st-board');
  const supply = h('section.st-supply');
  const yards = h('section.st-yards');
  const sheet = h('div.st-sheet-host');
  const after = h('div.st-after');
  root.append(h('div.st-top', status, note), h('div.st-main', h('div.st-left', lots, board, supply), yards), sheet, after);
  ctx.el.append(root);

  let view = null;
  let seats = [];
  let cart = []; // materials picked from the supply
  let sent = false;
  let focus = null; // { tier, slot } | { hand } | { tier, slot: DECK } shown in the sheet
  let lastKey = null;
  let showResults = true;

  const me = () => (view?.seat != null ? view.players[view.seat] : null);
  const myTurn = () => view && view.seat != null && view.phase !== 'over' && view.turn === view.seat && !sent;
  const nameOf = (s) => (s === view?.seat ? 'You' : seats[s]?.name || `Builder ${s + 1}`);

  // ---------- the cart ----------
  function cartValid() {
    if (!cart.length) return false;
    const open = [0, 1, 2, 3, 4].filter((m) => view.supply[m] > 0).length;
    if (cart.length === 2 && cart[0] === cart[1]) return view.supply[cart[0]] >= 4;
    return new Set(cart).size === cart.length && cart.length === Math.min(3, open);
  }
  function addToCart(m) {
    if (!myTurn() || view.phase !== 'play') return;
    if (m === CASH) return ctx.toast('Cash comes with holding an order — tap an order to hold it');
    const inCart = cart.filter((x) => x === m).length;
    if (view.supply[m] - inCart <= 0) return sound.error();
    if (inCart === 1 && cart.length === 1) {
      if (view.supply[m] < 4) return ctx.toast('Two of the same need at least four left in the supply'), sound.error();
      cart.push(m);
    } else if (inCart >= 1 || cart.length >= 3 || (cart.length === 2 && cart[0] === cart[1])) {
      return sound.error();
    } else cart.push(m);
    sound.chip();
    draw();
  }
  function take() {
    if (!myTurn() || !cartValid()) return sound.error();
    sent = true;
    ctx.client.act({ type: 'take', mats: cart.slice() });
    cart = [];
    draw();
  }
  function send(move) {
    if (!myTurn()) return;
    sent = true;
    focus = null;
    cart = [];
    ctx.client.act(move);
    draw();
  }

  // ---------- drawing ----------
  function drawLots() {
    lots.replaceChildren(
      h('div.st-label', 'Sales lots · 3 points each'),
      h(
        'div.st-lot-row',
        view.lots.map((id) => {
          const l = LOTS[id];
          return h(
            'div.st-lot',
            { title: `${l.name} signs on with the first builder who has these buildings` },
            h('strong', l.name),
            h('div.st-need', l.need.flatMap((k, m) => (k ? [h('span.st-need-k', { style: { '--k': MAT_COLORS[m] } }, k)] : []))),
          );
        }),
        view.lots.length ? null : h('small', 'Every lot has signed on.'),
      ),
    );
  }

  function drawBoard() {
    const pl = me();
    const fresh = view.last && (view.last.type === 'build' || view.last.type === 'reserve') && view.last.hand == null && view.last.slot !== DECK ? `${view.last.tier}:${view.last.slot}` : null;
    board.replaceChildren(
      ...[2, 1, 0].map((tier) =>
        h(
          `div.st-row.t${tier}`,
          h(
            'button.st-deck',
            { onclick: () => myTurn() && view.phase === 'play' && view.decks[tier] && openSheet({ tier, slot: DECK }), 'aria-label': `${TIER_NAMES[tier]}: ${view.decks[tier]} orders left`, disabled: !view.decks[tier] || null },
            h('span.st-deck-n', view.decks[tier]),
            h('small', TIER_NAMES[tier]),
            h('i', '●'.repeat(tier + 1)),
          ),
          view.board[tier].map((id, slot) =>
            id == null
              ? h('div.st-card.empty')
              : cardEl(id, { onclick: () => openSheet({ tier, slot }), can: !!(pl && myTurn() && payment(pl, id)), fresh: fresh === `${tier}:${slot}` && lastKey !== null }),
          ),
        ),
      ),
    );
  }

  function drawSupply() {
    const live = myTurn() && view.phase === 'play';
    supply.replaceChildren(
      h(
        'div.st-bank',
        view.supply.map((k, m) =>
          h(
            'button.st-stack' + (live && m !== CASH && k - cart.filter((x) => x === m).length > 0 ? '.live' : ''),
            { onclick: () => addToCart(m), 'aria-label': `${k} ${NAMES[m]} in the supply` },
            token(m),
            h('b', k - cart.filter((x) => x === m).length),
          ),
        ),
      ),
      live
        ? h(
            'div.st-cart',
            h(
              'div.st-cart-slots',
              cart.length
                ? cart.map((m, i) => h('button.st-cart-tok', { onclick: () => (cart.splice(i, 1), draw()), 'aria-label': `Put back ${NAMES[m]}` }, token(m)))
                : h('small', 'Tap 3 different materials, or 2 of one'),
            ),
            h('button.btn.gold.small', { onclick: take, disabled: !cartValid() || null }, 'Take'),
          )
        : null,
    );
  }

  function yard(seat) {
    const pl = view.players[seat];
    const b = bonuses(pl);
    const info = seats[seat] || {};
    const isMe = seat === view.seat;
    const discarding = isMe && myTurn() && view.phase === 'discard';
    const isTurn = view.phase !== 'over' && view.turn === seat;
    const won = view.phase === 'over' && view.winners?.includes(seat);
    const fresh = view.last && view.last.seat === seat && lastKey !== null;
    return h(
      `div.st-yard${isMe ? '.me' : ''}${isTurn ? '.turn' : ''}${won ? '.won' : ''}${discarding ? '.discard' : ''}`,
      { dataset: { seat } },
      h(
        'div.st-head',
        avatar(info.name || '?', info.hue ?? 140, { bot: info.kind === 'bot' }),
        h('div.st-who', h('strong', nameOf(seat)), h('small', `${tokenCount(pl)}/${TOKEN_LIMIT} materials · ${pl.built.length} built`)),
        h('div.st-score', h('b', points(pl)), h('small', `/ ${view.target}`)),
      ),
      h(
        'div.st-mats',
        [0, 1, 2, 3, 4, 5].map((m) =>
          h(
            `button.st-mat${discarding && pl.tokens[m] ? '.live' : ''}${fresh && view.last.mats?.includes(m) ? '.gain' : ''}`,
            { onclick: () => discarding && pl.tokens[m] && send({ type: 'discard', mat: m }), disabled: !discarding || !pl.tokens[m] || null, 'aria-label': `${NAMES[m]}: ${m < 5 ? b[m] + ' built, ' : ''}${pl.tokens[m]} tokens` },
            m < 5 ? h('span.st-bonus', { style: { '--k': MAT_COLORS[m] }, title: `${b[m]} ${MAT_NAMES[m]} discount` }, b[m]) : h('span.st-bonus.none'),
            token(m, pl.tokens[m] ? '' : '.zero'),
            h('b', pl.tokens[m]),
          ),
        ),
      ),
      pl.reserved.length || pl.lots.length
        ? h(
            'div.st-held',
            pl.reserved.map((r, i) =>
              r.id == null
                ? h(`div.st-card.back.small.t${r.tier}`, { title: 'An order held face down' }, h('i', '●'.repeat(r.tier + 1)))
                : cardEl(r.id, { small: true, can: isMe && myTurn() && view.phase === 'play' && !!payment(pl, r.id), onclick: () => (isMe ? openSheet({ hand: i }) : null) }),
            ),
            pl.lots.map((id) => h('div.st-lot.won', h('strong', LOTS[id].name), h('small', '+3'))),
          )
        : null,
    );
  }

  function drawYards() {
    const first = view.seat ?? 0;
    const order = Array.from({ length: view.n }, (_, i) => (first + i) % view.n);
    yards.replaceChildren(...order.map(yard));
  }

  // ---------- the build / hold sheet ----------
  function openSheet(f) {
    focus = f;
    sound.card();
    drawSheet();
  }
  function drawSheet() {
    if (!focus || !view) return sheet.replaceChildren();
    const pl = me();
    const close = () => ((focus = null), drawSheet());
    let id = null;
    if (focus.hand != null) id = pl?.reserved[focus.hand]?.id;
    else if (focus.slot !== DECK) id = view.board[focus.tier][focus.slot];
    if (focus.slot !== DECK && id == null) return close();
    const playing = myTurn() && view.phase === 'play';
    const pay = id != null && pl ? payment(pl, id) : null;
    const canHold = playing && pl && pl.reserved.length < RESERVE_LIMIT && focus.hand == null;
    const b = pl ? bonuses(pl) : [0, 0, 0, 0, 0];
    const have = pl ? pl.tokens.slice(0, 5).map((k, m) => k + b[m]) : null;
    sheet.replaceChildren(
      h(
        'div.st-sheet-bg',
        { onclick: (e) => e.target === e.currentTarget && close() },
        h(
          'div.st-sheet',
          id != null
            ? h(
                'div.st-sheet-card',
                cardEl(id),
                h(
                  'div.st-sheet-info',
                  h('h3', CARDS[id].name),
                  h('p', `${CARDS[id].points ? `${CARDS[id].points} point${CARDS[id].points > 1 ? 's' : ''} · ` : ''}every build after this costs 1 less ${MAT_NAMES[CARDS[id].bonus]}.`),
                  h('div.st-sheet-cost', h('small', 'Costs'), costPips(CARDS[id].cost, have)),
                  pay
                    ? h('p.st-pay', 'You pay: ', pay.some((k) => k) ? pay.flatMap((k, m) => (k ? [h('span.st-pay-k', token(m), `×${k}`)] : [])) : 'nothing — your discounts cover it!')
                    : pl
                      ? h('p.st-short', 'You can’t afford this yet.')
                      : null,
                ),
              )
            : h('div.st-sheet-info', h('h3', `Hold a ${TIER_NAMES[focus.tier].replace(/s$/, '').toLowerCase()} order blind`), h('p', 'Take the top order of this deck without showing it. Only you will see it.')),
          h(
            'div.st-sheet-actions',
            h('button.btn.ghost', { onclick: close }, 'Cancel'),
            canHold ? h('button.btn', { onclick: () => send({ type: 'reserve', tier: focus.tier, slot: focus.slot }) }, view.supply[CASH] ? 'Hold it (+1 cash)' : 'Hold it') : null,
            playing && pay ? h('button.btn.gold', { onclick: () => send(focus.hand != null ? { type: 'build', hand: focus.hand } : { type: 'build', tier: focus.tier, slot: focus.slot }) }, 'Build it') : null,
          ),
          !playing && view.seat != null ? h('small.st-wait', view.phase === 'discard' && view.turn === view.seat ? 'Hand back materials first.' : 'Wait for your turn.') : null,
        ),
      ),
    );
  }

  function describe(l) {
    if (!l) return '';
    const who = nameOf(l.seat);
    let text = '';
    if (l.type === 'take') text = `${who} took ${l.mats.map((m) => NAMES[m]).join(', ')}.`;
    else if (l.type === 'reserve') text = `${who} held ${l.id != null ? `the ${CARDS[l.id].name}` : `a ${TIER_NAMES[l.tier].replace(/s$/, '').toLowerCase()} order face down`}${l.cash ? ' and took 1 cash' : ''}.`;
    else if (l.type === 'build') text = `${who} built the ${CARDS[l.id].name}${CARDS[l.id].points ? ` (+${CARDS[l.id].points})` : ''}.`;
    else if (l.type === 'discard') text = `${who} handed back ${NAMES[l.mat]}.`;
    if (l.lot != null) text += ` ${LOTS[l.lot].name} signed on with ${l.seat === view.seat ? 'you' : who} (+3)!`;
    return text;
  }

  function drawStatus() {
    if (view.phase === 'over') {
      const w = view.winners || [];
      status.textContent = w.length > 1 ? `Tie: ${w.map(nameOf).join(' & ')}` : w[0] === view.seat ? 'You win!' : `${nameOf(w[0])} wins!`;
    } else if (myTurn() && view.phase === 'discard') status.textContent = `Too much to store — hand back ${tokenCount(me()) - TOKEN_LIMIT} (tap your materials)`;
    else if (myTurn()) status.textContent = 'Your turn — take materials, or tap an order to build or hold it';
    else if (view.turn === view.seat && sent) status.textContent = '…';
    else status.textContent = `${nameOf(view.turn)} is ${view.phase === 'discard' ? 'tidying up the yard' : 'planning'}…`;
    const final = view.lastRound && view.phase !== 'over' ? ' Final round!' : '';
    note.textContent = describe(view.last) + final;
  }

  function drawAfter() {
    if (view.phase !== 'over') return after.replaceChildren();
    const order = view.players.map((p, i) => i).sort((a, b) => points(view.players[b]) - points(view.players[a]));
    after.replaceChildren(
      showResults
        ? h(
            'div.st-results',
            h('h2', status.textContent),
            h(
              'table',
              h('tr', h('th', ''), h('th', 'Built'), h('th', 'Lots'), h('th', 'Points')),
              order.map((s) => h('tr' + (view.winners.includes(s) ? '.win' : ''), h('td', nameOf(s)), h('td', view.players[s].built.length), h('td', view.players[s].lots.length), h('td', h('b', points(view.players[s]))))),
            ),
            h('p.st-small', 'On a tie in points, the builder with fewer buildings wins.'),
            h(
              'div.st-actions',
              h('button.btn.ghost', { onclick: () => ((showResults = false), drawAfter()) }, 'See yards'),
              h('button.btn.ghost', { onclick: () => ctx.leave() }, 'Game Center'),
              ctx.client.isHost ? h('button.btn.gold', { onclick: () => ctx.client.send({ t: 'rematch' }) }, 'Play again') : h('small', 'Waiting for the host…'),
            ),
          )
        : h('button.btn.gold.st-reopen', { onclick: () => ((showResults = true), drawAfter()) }, 'Results'),
    );
  }

  function draw() {
    if (!view) return;
    root.classList.toggle('my-turn', !!myTurn());
    drawLots();
    drawBoard();
    drawSupply();
    drawYards();
    drawStatus();
    drawSheet();
    drawAfter();
  }

  function render(msg) {
    const prev = view;
    view = msg.view;
    seats = msg.seats || seats;
    sent = false;
    if (view.phase !== 'over') showResults = true;
    if (!myTurn() || view.phase !== 'play') cart = [];
    const key = view.last ? JSON.stringify(view.last) : null;
    const moved = !!prev && key !== lastKey;
    lastKey = moved ? key : null; // null: draw without the "just happened" highlights
    draw();
    lastKey = key;
    if (moved && view.last) {
      const t = view.last.type;
      if (t === 'build') sound.card();
      else if (t === 'take' || t === 'discard') sound.chip();
      else sound.slide();
      if (view.last.lot != null) setTimeout(() => sound.good(), 300);
    }
    if (view.phase === 'over' && prev && prev.phase !== 'over') setTimeout(() => (view.winners.includes(view.seat) || view.seat == null ? sound.win : sound.bad)(), 500);
    else if (myTurn() && prev && prev.turn !== view.seat) sound.turn();
  }

  function paintVoice() {
    if (!ctx.voice) return;
    root.querySelectorAll('.st-yard').forEach((el) => {
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
  const onKey = (e) => {
    if (e.key === 'Escape' && focus) (focus = null), drawSheet();
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
