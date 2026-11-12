// The Rook table: felt, seats, fanned hands, animated dealing and tricks, bidding and
// burying panels, round summaries. Works the same for the host and for online guests:
// it only ever renders the view it receives and sends actions back.
import { h, sleep, clamp, avatar } from '../../core/util.js';
import { sound } from '../../core/sound.js';
import { DEFS, PALETTE, cardFace, cardBack, colorChip, emblem } from './cards.js';
import {
  BIRD,
  COLORS,
  MAX_BID,
  MIN_BID,
  BID_STEP,
  cardName,
  cardPoints,
  colorOf,
  legalPlays,
  sumPoints,
  suitOf,
  teamOf,
  partnerOf,
} from './engine.js';
import { chooseAction, suggestDiscard } from './ai.js';

const POS = ['bottom', 'left', 'top', 'right'];
const SPEED = { relaxed: 1.45, normal: 1, fast: 0.6, turbo: 0.3 };
const PREF_DEFAULTS = { autoSingle: true, autoContinue: true, hints: false, bigCards: false, sortTrumpRight: true };

export function mount(ctx) {
  const ui = new RookTable(ctx);
  return { destroy: () => ui.destroy(), settings: () => ui.settingsItems() };
}

class RookTable {
  constructor(ctx) {
    this.ctx = ctx;
    this.client = ctx.client;
    this.view = null;
    this.seats = [];
    this.mySeat = null;
    this.queue = Promise.resolve();
    this.pending = 0;
    this.selected = new Set();
    this.giftPick = null;
    this.waiting = false;
    this.seq = -1;
    this.speed = 1;
    this.prefs = { ...PREF_DEFAULTS, ...(ctx.prefs.get('rook') || {}) };
    this.unsub = [];
    this.timers = new Set();
    this.build();
    this.unsub.push(this.client.on('state', (msg) => this.enqueue(msg)));
    this.unsub.push(this.client.on('chat', (m) => this.bubble(m)));
    this.unsub.push(this.client.on('reject', (text) => this.ctx.toast(text, { kind: 'warn' })));
    this.onResize = () => {
      this.layout();
      if (this.view && !this.pending) this.renderAll();
    };
    window.addEventListener('resize', this.onResize);
    this.onKey = (e) => this.key(e);
    window.addEventListener('keydown', this.onKey);
    if (this.client.lastState) this.enqueue(this.client.lastState);
  }

  destroy() {
    this.dead = true;
    this.unsub.forEach((f) => f());
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKey);
    for (const t of this.timers) clearTimeout(t);
    this.root.remove();
  }

  later(fn, ms) {
    const t = setTimeout(() => {
      this.timers.delete(t);
      if (!this.dead) fn();
    }, ms);
    this.timers.add(t);
    return t;
  }

  savePrefs() {
    this.ctx.prefs.set('rook', this.prefs);
  }

  settingsItems() {
    return [
      { label: 'Auto-play when only one card is legal', value: this.prefs.autoSingle, set: (v) => ((this.prefs.autoSingle = v), this.savePrefs(), this.maybeAuto()) },
      { label: 'Auto-continue after each round', value: this.prefs.autoContinue, set: (v) => ((this.prefs.autoContinue = v), this.savePrefs()) },
      { label: 'Show suggestions (coach)', value: this.prefs.hints, set: (v) => ((this.prefs.hints = v), this.savePrefs(), this.renderAll()) },
      { label: 'Large cards', value: this.prefs.bigCards, set: (v) => ((this.prefs.bigCards = v), this.savePrefs(), this.layout(), this.renderAll()) },
    ];
  }

  // ------------------------------------------------------------------
  // Skeleton
  // ------------------------------------------------------------------
  build() {
    if (!document.getElementById('rk-defs')) {
      const d = h('div', { id: 'rk-defs', html: DEFS });
      document.body.append(d);
    }
    this.root = h('div.rook', { dataset: { phase: 'loading' } });
    this.felt = h('div.rk-felt', h('div.rk-felt-light'), h('div.rk-felt-logo', { html: `<span>ROOK</span>` }));
    this.hud = h('div.rk-hud');
    this.seatEls = POS.map((p) => h(`div.rk-seat.${p}`));
    this.oppHands = POS.map((p) => h(`div.rk-opp.${p}`));
    this.nestEl = h('div.rk-nest');
    this.trickEl = h('div.rk-trick');
    this.ticker = h('div.rk-ticker');
    this.center = h('div.rk-center', this.nestEl, this.trickEl);
    this.panel = h('div.rk-panel');
    this.handEl = h('div.rk-hand');
    this.flyLayer = h('div.rk-fly');
    this.overlay = h('div.rk-overlay');
    this.root.append(
      this.felt,
      ...this.oppHands,
      this.center,
      ...this.seatEls,
      this.hud,
      this.ticker,
      h('div.rk-mine', this.panel, this.handEl),
      this.flyLayer,
      this.overlay,
    );
    this.ctx.el.append(this.root);
    this.layout();
  }

  layout() {
    const r = this.ctx.el.getBoundingClientRect();
    const W = r.width || window.innerWidth;
    const H = r.height || window.innerHeight;
    const portrait = H > W * 1.05;
    let cw = portrait ? Math.min(W / 6.1, H / 9.2) : Math.min(W / 11.5, H / 6.4);
    if (this.prefs.bigCards) cw *= 1.15;
    cw = clamp(cw, 50, 132);
    this.cw = cw;
    this.ch = cw * 1.4;
    this.root.style.setProperty('--cw', cw + 'px');
    this.root.style.setProperty('--ch', this.ch + 'px');
    this.root.classList.toggle('portrait', portrait);
    this.root.classList.toggle('compact', W < 520);
  }

  pos(seat) {
    const base = this.mySeat ?? 0;
    return POS[(seat - base + 4) % 4];
  }
  seatEl(seat) {
    return this.seatEls[POS.indexOf(this.pos(seat))];
  }
  name(seat) {
    if (seat === this.mySeat) return 'You';
    return this.seats[seat]?.name || ['South', 'West', 'North', 'East'][seat];
  }
  teamName(team) {
    const [a, b] = [0, 1, 2, 3].filter((s) => teamOf(s) === team);
    const n = (s) => (s === this.mySeat ? 'You' : this.seats[s]?.name || '');
    return `${n(a)} & ${n(b)}`;
  }
  myTeam() {
    return teamOf(this.mySeat ?? 0);
  }

  // ------------------------------------------------------------------
  // Update queue: every state change is animated in order
  // ------------------------------------------------------------------
  enqueue(msg) {
    if (msg.seq < this.seq && msg.event) return;
    this.pending++;
    this.queue = this.queue
      .then(() => this.handle(msg))
      .catch((e) => console.error(e))
      .finally(() => {
        this.pending--;
        if (!this.pending) this.idle();
      });
  }

  async handle(msg) {
    if (this.dead) return;
    const prev = this.view;
    const next = msg.view;
    this.seats = msg.seats || this.seats;
    const seatChanged = this.mySeat !== msg.seat;
    this.mySeat = msg.seat;
    this.speed = SPEED[msg.speed] ?? 1;
    this.claim = msg.claim;
    this.seq = msg.seq;
    this.waiting = false;
    const ev = msg.event;
    this.root.dataset.phase = next.phase;

    // fresh table (first message, reconnect or seat change): just draw it
    if (!prev || seatChanged || !ev || ev.type === 'start') {
      this.view = next;
      if (next.round !== prev?.round) this.selected.clear();
      if (ev?.type === 'start' || (prev && next.round !== prev.round && next.phase === 'bid')) {
        this.closeModal();
        await this.dealAnimation(next);
      }
      this.renderAll();
      if (next.phase === 'score' || next.phase === 'over') this.showSummary(next);
      return;
    }

    const a = ev.action;
    if (!a) {
      this.view = next;
      this.renderAll();
      return;
    }
    const seat = ev.seat;

    switch (a.type) {
      case 'bid':
      case 'pass': {
        this.view = next;
        sound.chip();
        this.renderAll();
        this.popBid(seat, a.type === 'pass' ? 'Pass' : a.amount);
        this.tick(a.type === 'pass' ? `${this.name(seat)} ${seat === this.mySeat ? 'pass' : 'passes'}` : `${this.name(seat)} bid${seat === this.mySeat ? '' : 's'} ${a.amount}`);
        if (next.phase !== 'bid') {
          await this.wait(650);
          await this.afterBidding(prev, next);
        }
        break;
      }
      case 'give': {
        await this.flyBacks(seat, next.contract.bidder, 1, 420);
        this.view = next;
        this.renderAll();
        await this.nestToBidder(next, true);
        break;
      }
      case 'discard': {
        await this.buryAnimation(prev, next, seat, a);
        this.view = next;
        this.selected.clear();
        this.renderAll();
        this.tick(`${this.name(seat)} buried ${a.count ?? a.cards.length} cards`);
        break;
      }
      case 'play':
        await this.playAnimation(prev, next, seat, a);
        break;
      case 'ready':
        this.view = next;
        if (next.phase === 'bid' && next.round !== prev.round) {
          this.closeModal();
          await this.dealAnimation(next);
          this.renderAll();
        } else {
          this.updateReady(next);
          this.renderHud();
        }
        break;
      default:
        this.view = next;
        this.renderAll();
    }
  }

  wait(ms) {
    return sleep(ms * this.speed);
  }

  // When nothing is animating, maybe take an automatic action for the player.
  idle() {
    if (this.dead || !this.view) return;
    this.renderPanel();
    this.renderHand();
    this.maybeAuto();
    if (this.myTurn()) sound.turn();
  }

  myTurn() {
    const v = this.view;
    if (!v || this.mySeat == null || this.claim) return false;
    if (v.phase === 'score') return !v.ready[this.mySeat];
    return v.turn === this.mySeat && ['bid', 'gift', 'discard', 'play'].includes(v.phase);
  }

  maybeAuto() {
    const v = this.view;
    if (!v || this.pending || !this.myTurn() || this.waiting) return;
    if (this.me()?.autopilot) return;
    if (v.phase === 'play' && this.prefs.autoSingle) {
      const legal = legalPlays({ hands: { [this.mySeat]: v.hand }, trick: v.trick, trump: v.trump }, this.mySeat);
      if (legal.length === 1 && !(legal[0] === BIRD && v.trump == null)) {
        const seq = this.seq;
        this.later(() => {
          if (this.seq === seq && !this.pending && this.myTurn()) this.play(legal[0]);
        }, 650 * this.speed);
      }
    }
  }

  me() {
    return this.seats[this.mySeat];
  }

  act(action) {
    if (this.waiting) return;
    this.waiting = true;
    this.client.act(action);
    // safety: if nothing comes back, allow another try
    const seq = this.seq;
    this.later(() => {
      if (this.seq === seq) this.waiting = false;
    }, 4000);
  }

  // ------------------------------------------------------------------
  // Rendering
  // ------------------------------------------------------------------
  renderAll() {
    if (!this.view) return;
    this.renderHud();
    this.renderSeats();
    this.renderOpp();
    this.renderNest();
    this.renderTrick();
    this.renderHand();
    this.renderPanel();
  }

  renderHud() {
    const v = this.view;
    const us = this.myTeam();
    const them = 1 - us;
    const target = v.options.winScore;
    const team = (t, label) => {
      const score = v.scores[t];
      const pct = clamp(score / target, 0, 1) * 100;
      const trickCount = v.tricks.filter((x) => teamOf(x.winner) === t).length;
      const live = v.phase === 'play' ? v.points[t] : null;
      return h(
        `div.rk-team.${t === us ? 'us' : 'them'}`,
        h('div.rk-team-top', h('span.rk-team-label', label), h('span.rk-team-names', this.teamName(t))),
        h('div.rk-team-score', h('span.rk-score', score), live != null ? h('span.rk-live', { title: 'Points this round' }, `+${live}`) : null),
        h('div.rk-progress', h('div', { style: { width: pct + '%' } })),
        v.phase === 'play' ? h('div.rk-tricks', `${trickCount} trick${trickCount === 1 ? '' : 's'}`) : null,
      );
    };
    const c = v.contract;
    let mid;
    if (c) {
      const tr = v.trump;
      mid = h(
        'div.rk-contract',
        h('div.rk-contract-bid', h('small', `${this.name(c.bidder)}${c.solo ? ' · solo' : ''}`), h('strong', c.amount)),
        h(
          'div.rk-trump' + (tr ? '.' + tr : '.none'),
          { title: tr ? `${PALETTE[tr].name} is trump` : 'Trump is set by the first card led' },
          tr ? h('span', { html: colorChip(tr) }) : null,
          h('small', tr ? `${PALETTE[tr].name} trump` : 'Trump: first lead'),
        ),
      );
    } else {
      const high = v.bidding?.high;
      mid = h(
        'div.rk-contract.bidding',
        h('div.rk-contract-bid', h('small', high ? `High bid · ${this.name(high.seat)}` : `Round ${v.round} · bidding`), h('strong', high ? high.amount : '—')),
      );
    }
    const buttons = h(
      'div.rk-hud-buttons',
      v.lastTrick && v.phase === 'play' && v.tricks.length
        ? h('button.rk-icon', { title: 'Last trick', onclick: () => this.showLastTrick() }, h('span', { html: ICONS.last }))
        : null,
      h('button.rk-icon', { title: 'Score sheet', onclick: () => this.showScoreSheet() }, h('span', { html: ICONS.sheet })),
      this.mySeat != null && !['score', 'over'].includes(v.phase)
        ? h(
            'button.rk-icon' + (this.prefs.hints ? '.on' : ''),
            { title: 'Coach: suggest a move', onclick: () => this.coach() },
            h('span', { html: ICONS.bulb }),
          )
        : null,
    );
    this.hud.replaceChildren(team(us, 'Us'), mid, team(them, 'Them'), buttons);
  }

  renderSeats() {
    const v = this.view;
    for (let s = 0; s < 4; s++) {
      const el = this.seatEl(s);
      const info = this.seats[s] || { name: this.name(s), kind: 'bot', hue: 200 };
      const isTurn = (v.turn === s && !['score', 'over'].includes(v.phase)) || (v.phase === 'score' && !v.ready[s]);
      el.className = `rk-seat ${this.pos(s)} team${teamOf(s)}`;
      el.classList.toggle('turn', isTurn && v.phase !== 'score');
      el.classList.toggle('out', v.sittingOut === s);
      el.classList.toggle('offline', info.kind === 'human' && !info.connected);
      const badges = [];
      if (v.dealer === s && v.phase === 'bid') badges.push(h('span.rk-dealer', { title: 'Dealer' }, 'D'));
      if (v.contract?.bidder === s) badges.push(h('span.rk-bidder', { title: 'Took the bid' }, v.contract.amount));
      const last = v.phase === 'bid' ? [...v.bidding.log].reverse().find((e) => e.seat === s) : null;
      const status =
        v.sittingOut === s
          ? 'Sitting out'
          : info.kind === 'human' && !info.connected
            ? 'Reconnecting…'
            : info.autopilot
              ? 'Autopilot'
              : isTurn && v.phase !== 'score'
                ? s === this.mySeat
                  ? 'Your turn'
                  : 'Thinking…'
                : '';
      el.replaceChildren(
        h(
          'div.rk-avatar-wrap',
          avatar(info.name || this.name(s), info.hue ?? 200, { bot: info.kind === 'bot' }),
          h('div.rk-ring'),
          ...badges,
        ),
        h(
          'div.rk-nameplate',
          h('span.rk-name', s === this.mySeat ? `${info.name || 'You'} (you)` : info.name || this.name(s)),
          status ? h('span.rk-status', status) : null,
        ),
        last ? h('div.rk-bubble' + (last.type === 'pass' ? '.pass' : ''), last.type === 'pass' ? 'Pass' : last.amount) : null,
      );
    }
  }

  renderOpp() {
    const v = this.view;
    for (let s = 0; s < 4; s++) {
      const el = this.oppHands[POS.indexOf(this.pos(s))];
      if (s === this.mySeat) {
        el.replaceChildren();
        continue;
      }
      const n = v.handSizes[s];
      const cards = [];
      const horiz = this.pos(s) === 'top' || this.pos(s) === 'bottom';
      const step = Math.min(this.cw * (horiz ? 0.2 : 0.16), 14);
      for (let i = 0; i < n; i++) {
        const off = (i - (n - 1) / 2) * step;
        const rot = (i - (n - 1) / 2) * 3.2;
        const c = h('div.rk-card.back.small', { html: cardBack() });
        c.style.transform = horiz ? `translate(${off}px, ${Math.abs(off) * 0.12}px) rotate(${rot}deg)` : `translate(${Math.abs(off) * 0.12}px, ${off}px) rotate(${90 + rot}deg)`;
        cards.push(c);
      }
      el.replaceChildren(...cards);
    }
  }

  renderNest() {
    const v = this.view;
    const n = v.nestSize;
    const cards = [];
    for (let i = 0; i < n; i++) {
      const c = h('div.rk-card.back', { html: cardBack() });
      c.style.transform = `translate(${i * 1.5 - 3}px, ${-i * 1.5}px) rotate(${(i - 2) * 2.5}deg)`;
      cards.push(c);
    }
    this.nestEl.replaceChildren(...cards, n ? h('div.rk-nest-label', 'Nest') : null);
  }

  slotOffset(seat) {
    const p = this.pos(seat);
    const dx = this.cw * 0.8;
    const dy = this.ch * 0.42;
    return { bottom: [0, dy], top: [0, -dy], left: [-dx, 0], right: [dx, 0] }[p];
  }
  tilt(card) {
    let x = 0;
    for (const ch of card) x = (x * 31 + ch.charCodeAt(0)) % 97;
    return (x % 13) - 6;
  }

  renderTrick(plays = this.view.trick?.plays || []) {
    const cards = plays.map(({ seat, card }) => {
      const [x, y] = this.slotOffset(seat);
      const c = this.cardEl(card);
      c.classList.add('in-trick');
      c.style.transform = `translate(${x}px, ${y}px) rotate(${this.tilt(card)}deg)`;
      c.dataset.seat = seat;
      return c;
    });
    if (this.view.trick && plays.length) {
      const w = winnerOf(plays, this.view.trump);
      const win = cards[plays.findIndex((p) => p.seat === w)];
      if (win && plays.length > 1) win.classList.add('winning');
    }
    this.trickEl.replaceChildren(...cards);
  }

  cardEl(card, extra = '') {
    const el = h('div.rk-card' + extra, { html: cardFace(card), dataset: { card } });
    if (card === BIRD) el.classList.add('bird');
    else el.classList.add(colorOf(card));
    return el;
  }

  // ---------- my hand ----------
  legalSet() {
    const v = this.view;
    if (!v || this.mySeat == null || this.claim) return new Set();
    if (v.phase === 'play' && v.turn === this.mySeat) {
      return new Set(legalPlays({ hands: { [this.mySeat]: v.hand }, trick: v.trick, trump: v.trump }, this.mySeat));
    }
    if ((v.phase === 'discard' || v.phase === 'gift') && v.turn === this.mySeat) return new Set(v.hand);
    return new Set();
  }

  renderHand() {
    const v = this.view;
    if (!v) return;
    const hand = v.hand || [];
    const legal = this.legalSet();
    const interactive = !this.pending && !this.waiting && legal.size > 0;
    const W = this.handEl.getBoundingClientRect().width || window.innerWidth;
    const n = hand.length;
    const cw = this.cw * 1.08;
    const narrow = W < 700;
    const maxStep = cw * 0.72;
    const step = n > 1 ? Math.min(maxStep, (W - cw * (narrow ? 1.6 : 1.4)) / (n - 1)) : 0;
    const spread = Math.min(narrow ? 1.2 : 3, (narrow ? 12 : 30) / Math.max(n, 1));
    const hintCard = this.prefs.hints && interactive ? this.hintCard() : null;
    const els = hand.map((card, i) => {
      const off = i - (n - 1) / 2;
      const el = this.cardEl(card, '.in-hand');
      el.style.setProperty('--x', `${off * step}px`);
      el.style.setProperty('--y', `${Math.pow(Math.abs(off), 1.6) * 1.6}px`);
      el.style.setProperty('--r', `${off * spread}deg`);
      el.style.zIndex = 10 + i;
      if (this.newCards?.has(card)) el.classList.add('new');
      if (v.phase === 'discard' && this.selected.has(card)) el.classList.add('selected');
      if (v.phase === 'gift' && this.giftPick === card) el.classList.add('selected');
      if (interactive) {
        if (legal.has(card)) el.classList.add('playable');
        else if (v.phase === 'play') el.classList.add('dim');
      }
      if (hintCard && (hintCard === card || (Array.isArray(hintCard) && hintCard.includes(card)))) el.classList.add('hint');
      if (v.trump && suitOf(card, v.trump) === v.trump) el.classList.add('trump');
      this.bindCard(el, card, legal, interactive);
      return el;
    });
    this.handEl.replaceChildren(...els);
    this.handEl.classList.toggle('active', interactive);
  }

  bindCard(el, card, legal, interactive) {
    if (!interactive || !legal.has(card)) return;
    let start = null;
    let dragged = false;
    el.addEventListener('pointerdown', (e) => {
      if (e.button) return;
      start = { x: e.clientX, y: e.clientY };
      dragged = false;
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (Math.abs(dy) > 8 || Math.abs(dx) > 8) dragged = true;
      if (dragged && this.view.phase === 'play') {
        el.classList.add('dragging');
        el.style.setProperty('--dx', `${dx}px`);
        el.style.setProperty('--dy', `${Math.min(dy, 0)}px`);
      }
    });
    const end = (e) => {
      if (!start) return;
      const dy = e.clientY - start.y;
      start = null;
      el.classList.remove('dragging');
      el.style.removeProperty('--dx');
      el.style.removeProperty('--dy');
      if (dragged && this.view.phase === 'play') {
        if (dy < -this.ch * 0.45) this.clickCard(card);
        return;
      }
      if (!dragged) this.clickCard(card);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', () => {
      start = null;
      el.classList.remove('dragging');
    });
  }

  clickCard(card) {
    const v = this.view;
    if (this.pending || this.waiting) return;
    if (v.phase === 'play') this.play(card);
    else if (v.phase === 'discard') {
      if (this.selected.has(card)) this.selected.delete(card);
      else if (this.selected.size < v.discardCount) this.selected.add(card);
      else {
        sound.error();
        this.ctx.toast(`You can bury ${v.discardCount}. Tap a raised card to put it back.`);
        return;
      }
      sound.slide();
      this.renderHand();
      this.renderPanel();
    } else if (v.phase === 'gift') {
      this.giftPick = card;
      sound.slide();
      this.renderHand();
      this.renderPanel();
    }
  }

  play(card) {
    const v = this.view;
    if (card === BIRD && v.trump == null && !v.trick.plays.length) {
      this.pickTrump();
      return;
    }
    this.act({ type: 'play', card });
    const el = this.handEl.querySelector(`[data-card="${card}"]`);
    el?.classList.add('sent');
  }

  pickTrump() {
    const v = this.view;
    const count = (c) => v.hand.filter((x) => x !== BIRD && colorOf(x) === c).length;
    const body = h(
      'div.rk-trump-pick',
      h('h3', 'Name trump'),
      h('p', 'Leading the Bird first means you choose the trump color.'),
      h(
        'div.rk-trump-grid',
        COLORS.map((c) =>
          h(
            `button.rk-trump-btn.${c}`,
            {
              onclick: () => {
                this.closeModal();
                this.act({ type: 'play', card: BIRD, trump: c });
              },
            },
            h('span', { html: `<svg viewBox="0 0 40 40">${emblem(c, 20, 20, 30)}</svg>` }),
            h('strong', PALETTE[c].name),
            h('small', `${count(c)} in hand`),
          ),
        ),
      ),
      h('button.btn.ghost', { onclick: () => this.closeModal() }, 'Cancel'),
    );
    this.openModal(body, 'small');
  }

  hintCard() {
    const v = this.view;
    if (this._hint?.seq === this.seq) return this._hint.value;
    let value = null;
    try {
      if (v.phase === 'play') {
        const legal = [...this.legalSet()].flatMap((card) =>
          card === BIRD && v.trump == null ? COLORS.map((trump) => ({ type: 'play', card, trump })) : [{ type: 'play', card }],
        );
        value = chooseAction(v, legal, 'normal').card;
      } else if (v.phase === 'discard') value = suggestDiscard(v);
    } catch (e) {
      console.warn(e);
    }
    this._hint = { seq: this.seq, value };
    return value;
  }

  coach() {
    const v = this.view;
    if (!this.myTurn()) {
      this.ctx.toast('The coach helps when it is your turn.');
      return;
    }
    if (v.phase === 'bid') {
      const legal = legalBids(v);
      const a = chooseAction(v, legal, 'hard');
      this.ctx.toast(a.type === 'pass' ? 'Coach: pass this one.' : `Coach: bid ${a.amount}.`, { ms: 3500 });
      return;
    }
    if (v.phase === 'discard') {
      this.selected = new Set(suggestDiscard(v));
      this.renderHand();
      this.renderPanel();
      this.ctx.toast('Coach picked the cards to bury.');
      return;
    }
    if (v.phase === 'play') {
      this.prefs.hints = true;
      this._hint = null;
      this.savePrefs();
      this.renderHand();
      this.renderHud();
      const c = this.hintCard();
      if (c) this.ctx.toast(`Coach: play ${cardName(c)}.`, { ms: 3000 });
    }
  }

  // ---------- action panel ----------
  renderPanel() {
    const v = this.view;
    const p = this.panel;
    p.replaceChildren();
    p.className = 'rk-panel';
    if (!v || this.mySeat == null || this.pending) return;
    if (this.claim) {
      p.append(h('div.rk-prompt', 'Playing out the sure tricks…'));
      return;
    }
    if (this.me()?.autopilot && !['score', 'over'].includes(v.phase)) {
      p.append(
        h(
          'div.rk-prompt',
          'Autopilot is playing your hand. ',
          h('button.btn.small', { onclick: () => this.client.setAutopilot(false) }, 'Take over'),
        ),
      );
      return;
    }
    if (v.turn !== this.mySeat) return;
    if (v.phase === 'bid') this.bidPanel(p);
    else if (v.phase === 'discard') this.discardPanel(p);
    else if (v.phase === 'gift') this.giftPanel(p);
    else if (v.phase === 'play') {
      const plays = v.trick.plays;
      let text;
      if (v.trump == null) text = 'Your lead names trump — lead a card of the color you want.';
      else if (!plays.length) text = 'Your lead.';
      else {
        const led = suitOf(plays[0].card, v.trump);
        const legal = this.legalSet();
        const follows = [...legal].every((c) => suitOf(c, v.trump) === led);
        text = follows ? `Follow ${PALETTE[led].name.toLowerCase()}${led === v.trump ? ' (trump)' : ''}.` : `No ${PALETTE[led].name.toLowerCase()} — play anything.`;
      }
      p.append(h('div.rk-prompt.turn', h('span.rk-dot'), text, h('small', ' Tap a card or drag it up.')));
    }
  }

  bidPanel(p) {
    const v = this.view;
    const high = v.bidding.high;
    const legal = legalBids(v);
    const canPass = legal.some((a) => a.type === 'pass');
    const min = high ? high.amount + BID_STEP : MIN_BID;
    if (this.bidValue == null || this.bidValue < min || this.bidRound !== v.round) {
      this.bidValue = Math.min(min, MAX_BID);
      this.bidRound = v.round;
    }
    const normalOk = min <= MAX_BID;
    const set = (x) => {
      this.bidValue = clamp(x, min, MAX_BID);
      sound.chip();
      this.renderPanel();
    };
    const partnerHigh = high && high.seat === partnerOf(this.mySeat);
    p.classList.add('bid');
    p.append(
      h(
        'div.rk-bid-head',
        h('strong', high ? `${this.name(high.seat)} ${high.seat === this.mySeat ? 'have' : 'has'} it at ${high.amount}` : 'You open the bidding'),
        partnerHigh ? h('small', ' · that’s your partner') : null,
        !canPass ? h('small.warn', ' · dealer is stuck and must bid') : null,
      ),
      normalOk
        ? h(
            'div.rk-bid-row',
            h('button.btn.round', { onclick: () => set(this.bidValue - BID_STEP), disabled: this.bidValue <= min, 'aria-label': 'Lower' }, '−'),
            h('div.rk-bid-value', this.bidValue),
            h('button.btn.round', { onclick: () => set(this.bidValue + BID_STEP), disabled: this.bidValue >= MAX_BID, 'aria-label': 'Higher' }, '+'),
            h('div.rk-quick', [10, 20].map((d) => h('button.btn.chip', { onclick: () => set(this.bidValue + d), disabled: this.bidValue + d > MAX_BID }, `+${d}`))),
          )
        : null,
      h(
        'div.rk-bid-actions',
        canPass ? h('button.btn.ghost.big', { onclick: () => this.act({ type: 'pass' }) }, 'Pass') : null,
        normalOk ? h('button.btn.gold.big', { onclick: () => this.act({ type: 'bid', amount: this.bidValue }) }, `Bid ${this.bidValue}`) : null,
      ),
      h(
        'div.rk-solo',
        h('small', 'Shoot the moon:'),
        [400, 800]
          .filter((amt) => !high || high.amount < amt)
          .map((amt) =>
            h(
              'button.btn.chip.solo',
              {
                onclick: () => {
                  if (confirm(amt === 400 ? 'Bid 400? You play alone with the nest plus one card from your partner, and the other team must not take a single point.' : 'Bid 800? You play alone with only the cards you were dealt, and the other team must not take a single point.'))
                    this.act({ type: 'bid', amount: amt });
                },
                title: amt === 400 ? 'Solo with nest + partner card' : 'Solo, no nest',
              },
              `${amt}`,
            ),
          ),
      ),
    );
  }

  discardPanel(p) {
    const v = this.view;
    const n = v.discardCount;
    const k = this.selected.size;
    const pts = sumPoints([...this.selected]);
    p.classList.add('discard');
    p.append(
      h(
        'div.rk-prompt',
        h('strong', `Bury ${n} cards`),
        h('span.rk-count' + (k === n ? '.ok' : ''), `${k}/${n}`),
        pts ? h('small', ` · ${pts} pts buried (they go to whoever wins the last trick)`) : h('small', ' · tap cards to choose'),
      ),
      h(
        'div.rk-bid-actions',
        h('button.btn.ghost', { onclick: () => this.coach() }, 'Suggest'),
        k ? h('button.btn.ghost', { onclick: () => (this.selected.clear(), this.renderHand(), this.renderPanel()) }, 'Clear') : null,
        h('button.btn.gold.big', { disabled: k !== n, onclick: () => this.act({ type: 'discard', cards: [...this.selected] }) }, 'Bury'),
      ),
    );
  }

  giftPanel(p) {
    p.classList.add('discard');
    p.append(
      h('div.rk-prompt', h('strong', `${this.name(this.view.contract.bidder)} bid 400!`), h('small', ' Pick one card to hand over — you sit this round out.')),
      h('div.rk-bid-actions', h('button.btn.gold.big', { disabled: !this.giftPick, onclick: () => this.act({ type: 'give', card: this.giftPick }) }, 'Hand it over')),
    );
  }

  // ------------------------------------------------------------------
  // Animations
  // ------------------------------------------------------------------
  rel(el) {
    const r = el.getBoundingClientRect();
    const o = this.root.getBoundingClientRect();
    return { x: r.left - o.left + r.width / 2, y: r.top - o.top + r.height / 2, w: r.width, h: r.height };
  }
  seatPoint(seat) {
    const p = this.pos(seat);
    if (p === 'bottom') {
      const r = this.rel(this.handEl);
      return { x: r.x, y: r.y };
    }
    const r = this.rel(this.oppHands[POS.indexOf(p)]);
    return { x: r.x, y: r.y };
  }
  centerPoint() {
    return this.rel(this.trickEl);
  }

  async fly(card, from, to, { dur = 420, fromRot = 0, toRot = 0, fromScale = 1, toScale = 1, flip = false, keep = false, back = false, delay = 0 } = {}) {
    const el = h('div.rk-card.flying' + (back ? '.back' : ''), {
      html: back ? cardBack() : flip ? `<div class="rk-flip"><div class="rk-f">${cardFace(card)}</div><div class="rk-b">${cardBack()}</div></div>` : cardFace(card),
    });
    const T = (p, rot, sc, ry = 0) => `translate(${p.x - this.cw / 2}px, ${p.y - this.ch / 2}px) rotate(${rot}deg) scale(${sc})${ry ? ` rotateY(${ry}deg)` : ''}`;
    el.style.transform = T(from, fromRot, fromScale);
    this.flyLayer.append(el);
    const d = dur * this.speed;
    const anim = el.animate(
      [{ transform: T(from, fromRot, fromScale) }, { transform: T(to, toRot, toScale) }],
      { duration: d, delay: delay * this.speed, easing: 'cubic-bezier(.22,.8,.26,1)', fill: 'both' },
    );
    if (flip) {
      el.firstChild.animate([{ transform: 'rotateY(180deg)' }, { transform: 'rotateY(0deg)' }], {
        duration: d * 0.8,
        delay: delay * this.speed + d * 0.1,
        easing: 'ease-in-out',
        fill: 'both',
      });
    }
    await anim.finished.catch(() => {});
    if (!keep) el.remove();
    return el;
  }

  async playAnimation(prev, next, seat, action) {
    const card = action.card;
    const [ox, oy] = this.slotOffset(seat);
    const c = this.centerPoint();
    const to = { x: c.x + ox, y: c.y + oy };
    let from;
    let flip = true;
    if (seat === this.mySeat) {
      const el = this.handEl.querySelector(`[data-card="${card}"]`);
      if (el) {
        from = this.rel(el);
        el.style.visibility = 'hidden';
        flip = false;
      } else from = this.seatPoint(seat);
    } else {
      from = this.seatPoint(seat);
      // take one back off their fan right away
      const fan = this.oppHands[POS.indexOf(this.pos(seat))];
      fan.lastElementChild?.remove();
    }
    sound.card();
    if (action.trump && prev.trump == null) this.tick(`${this.name(seat)} named ${PALETTE[action.trump].name} trump`);
    else if (prev.trump == null) this.tick(`${PALETTE[colorOf(card)].name} is trump`);
    await this.fly(card, from, to, { dur: 430, fromRot: seat === this.mySeat ? 0 : this.pos(seat) === 'top' ? 180 : 90, toRot: this.tilt(card), flip });

    const trickSize = prev.sittingOut == null ? 4 : 3;
    const completes = prev.trick.plays.length + 1 === trickSize;
    const plays = [...prev.trick.plays, { seat, card }];
    // show the card in place (use prev view for everything else until the trick is swept)
    this.view = { ...prev, hand: seat === this.mySeat ? prev.hand.filter((x) => x !== card) : prev.hand, handSizes: next.handSizes, trick: { ...prev.trick, plays }, trump: next.trump, turn: completes ? null : next.turn };
    if (prev.trump == null) this.view.hand = next.phase === 'play' ? next.hand : this.view.hand;
    this.renderTrick(plays);
    this.renderHand();
    this.renderSeats();
    this.renderHud();
    if (!completes) {
      this.view = next;
      this.renderSeats();
      this.renderHud();
      return;
    }
    // the trick is done: pause, highlight the winner, sweep it away
    const done = next.lastTrick && next.lastTrick.plays.length === plays.length ? next.lastTrick : null;
    const winner = done ? done.winner : winnerOf(plays, next.trump ?? prev.trump);
    const pts = sumPoints(plays.map((p) => p.card));
    await this.wait(520);
    const winEl = this.trickEl.querySelector(`[data-seat="${winner}"]`);
    winEl?.classList.add('taker');
    this.tick(`${this.name(winner)} take${winner === this.mySeat ? '' : 's'} it${pts ? ` · ${pts} pts` : ''}`);
    await this.wait(720);
    await this.sweep(winner, pts);
    this.view = next;
    this.renderAll();
    if (next.phase === 'score' || next.phase === 'over') {
      await this.wait(350);
      this.showSummary(next);
    }
  }

  async sweep(winner, pts) {
    const target = this.seatPoint(winner);
    const cards = [...this.trickEl.children];
    sound.sweep();
    const anims = cards.map((el) => {
      const r = this.rel(el);
      const card = el.dataset.card;
      el.remove();
      return this.fly(card, r, target, { dur: 480, fromRot: this.tilt(card), toRot: this.tilt(card) * 2 + 90, toScale: 0.45 });
    });
    if (pts) this.floatText(target, `+${pts}`, teamOf(winner) === this.myTeam() ? 'good' : 'bad');
    await Promise.all(anims);
  }

  floatText(at, text, kind = '') {
    const el = h('div.rk-float.' + kind, text);
    el.style.left = at.x + 'px';
    el.style.top = at.y + 'px';
    this.flyLayer.append(el);
    this.later(() => el.remove(), 1600);
  }

  async dealAnimation(v) {
    this.renderHud();
    this.renderSeats();
    this.handEl.replaceChildren();
    this.oppHands.forEach((e) => e.replaceChildren());
    this.nestEl.replaceChildren();
    this.trickEl.replaceChildren();
    this.tick(`Round ${v.round} · ${this.name(v.dealer)} deal${v.dealer === this.mySeat ? '' : 's'}${v.redeals ? ' (redealt: a hand had no points)' : ''}`);
    sound.shuffle();
    await this.wait(700);
    const from = this.seatPoint(v.dealer);
    const c = this.centerPoint();
    const per = v.handSizes[0] || 10;
    const flights = [];
    let k = 0;
    const order = [1, 2, 3, 0].map((i) => (v.dealer + i) % 4);
    for (let round = 0; round < Math.ceil(per / 2); round++) {
      for (const s of order) {
        flights.push(this.fly(null, from, this.seatPoint(s), { back: true, dur: 300, delay: k * 34, fromRot: 0, toRot: this.pos(s) === 'left' || this.pos(s) === 'right' ? 90 : 0, toScale: s === this.mySeat ? 1 : 0.6 }));
        k++;
      }
      if (round === 1) {
        for (let i = 0; i < 5; i++) {
          flights.push(this.fly(null, from, c, { back: true, dur: 300, delay: k * 34, toRot: (i - 2) * 2.5 }));
          k++;
        }
      }
    }
    sound.deal(Math.min(k, 24));
    await Promise.all(flights);
    this.view = v;
    this.renderOpp();
    this.renderNest();
    this.newCards = null;
    this.renderHand();
    this.handEl.classList.add('dealt');
    this.later(() => this.handEl.classList.remove('dealt'), 900);
  }

  async afterBidding(prev, next) {
    const c = next.contract;
    this.tick(`${this.name(c.bidder)} won the bid at ${c.amount}${c.solo ? ' — solo!' : ''}`);
    this.renderAll();
    if (c.amount === 800) {
      this.ctx.toast(`${this.name(c.bidder)} bid 800 — no nest, partner sits out!`, { kind: 'big' });
      await this.wait(900);
    } else if (c.amount === 400) {
      this.ctx.toast(`${this.name(c.bidder)} bid 400 — partner hands over one card and sits out.`, { kind: 'big' });
      await this.wait(700);
    } else {
      await this.nestToBidder(next, false);
    }
  }

  async nestToBidder(next, afterGift) {
    const bidder = next.contract.bidder;
    const c = this.centerPoint();
    const to = this.seatPoint(bidder);
    const nestCards = [...this.nestEl.querySelectorAll('.rk-card')];
    nestCards.forEach((el) => el.remove());
    this.nestEl.replaceChildren();
    const flights = nestCards.map((_, i) => this.fly(null, { x: c.x + i * 1.5, y: c.y - i * 1.5 }, to, { back: true, dur: 460, delay: i * 70, toScale: bidder === this.mySeat ? 1 : 0.6 }));
    sound.deal(5);
    await Promise.all(flights);
    if (bidder === this.mySeat) {
      const before = new Set(this.view?.hand || []);
      this.newCards = new Set(next.hand.filter((x) => !before.has(x)));
      this.later(() => {
        this.newCards = null;
      }, 6000);
    }
    this.view = next;
    this.renderAll();
    if (!afterGift && bidder === this.mySeat) this.ctx.toast('The nest is yours. Bury the cards you don’t want.');
  }

  async buryAnimation(prev, next, seat, action) {
    const c = this.centerPoint();
    if (seat === this.mySeat && action.cards) {
      const flights = action.cards.map((card, i) => {
        const el = this.handEl.querySelector(`[data-card="${card}"]`);
        const from = el ? this.rel(el) : this.seatPoint(seat);
        if (el) el.style.visibility = 'hidden';
        return this.fly(card, from, { x: c.x + i * 1.5, y: c.y - i * 1.5 }, { dur: 480, delay: i * 60, toScale: 0.8 });
      });
      sound.deal(action.cards.length);
      await Promise.all(flights);
    } else {
      const n = action.count ?? 5;
      const flights = [];
      for (let i = 0; i < n; i++) flights.push(this.fly(null, this.seatPoint(seat), { x: c.x + i * 1.5, y: c.y - i * 1.5 }, { back: true, dur: 460, delay: i * 60, fromScale: 0.6, toScale: 0.8 }));
      sound.deal(n);
      await Promise.all(flights);
    }
    this.newCards = null;
  }

  async flyBacks(from, to, n, dur) {
    const flights = [];
    for (let i = 0; i < n; i++) flights.push(this.fly(null, this.seatPoint(from), this.seatPoint(to), { back: true, dur, delay: i * 60, fromScale: 0.6, toScale: 0.6 }));
    await Promise.all(flights);
  }

  popBid(seat, text) {
    const el = this.seatEl(seat).querySelector('.rk-bubble');
    if (el) {
      el.classList.remove('pop');
      void el.offsetWidth;
      el.classList.add('pop');
    }
  }

  tick(text) {
    this.ticker.textContent = text;
    this.ticker.classList.remove('show');
    void this.ticker.offsetWidth;
    this.ticker.classList.add('show');
  }

  bubble(m) {
    if (m.replay || m.system) return;
    const seat = this.seats.findIndex((s) => s?.playerId === m.from);
    if (seat < 0) return;
    const el = this.seatEl(seat);
    const b = h('div.rk-chat-bubble', m.text);
    el.append(b);
    this.later(() => b.remove(), 4200);
  }

  key(e) {
    if (e.target.closest('input, textarea')) return;
    const v = this.view;
    if (!v || !this.myTurn()) return;
    if (v.phase === 'play' && /^[1-9]$|^0$/.test(e.key)) {
      const i = e.key === '0' ? 9 : Number(e.key) - 1;
      const card = v.hand[i];
      if (card && this.legalSet().has(card)) this.clickCard(card);
    }
    if (v.phase === 'score' && (e.key === 'Enter' || e.key === ' ')) this.ready();
  }

  // ------------------------------------------------------------------
  // Modals
  // ------------------------------------------------------------------
  openModal(content, size = '') {
    this.overlay.replaceChildren(h('div.rk-modal' + (size ? '.' + size : ''), content));
    this.overlay.classList.add('open');
  }
  closeModal() {
    this.overlay.classList.remove('open');
    this.overlay.replaceChildren();
    clearInterval(this.countdown);
  }

  ready() {
    if (this.view.phase === 'score' && !this.view.ready[this.mySeat] && this.mySeat != null) this.act({ type: 'ready' });
  }

  showSummary(v) {
    const r = v.lastRound;
    if (!r) return;
    const us = this.myTeam();
    const them = 1 - us;
    const bidTeam = teamOf(r.contract.bidder);
    const weBid = bidTeam === us;
    const good = weBid ? r.made : !r.made;
    const over = v.phase === 'over';
    if (over) (v.winner === us ? sound.win : sound.bad)();
    else (good ? sound.good : sound.bad)();

    const trickPts = [0, 0];
    for (const t of r.tricks) trickPts[teamOf(t.winner)] += sumPoints(t.plays.map((p) => p.card));
    const lastBonus = [0, 0];
    lastBonus[r.lastTeam] = 20;
    const nestBonus = [0, 0];
    nestBonus[r.lastTeam] = r.nestPoints;
    const row = (label, a, b, cls = '') => h('tr' + (cls ? '.' + cls : ''), h('th', label), h('td', a), h('td', b));
    const sign = (x) => (x > 0 ? `+${x}` : `${x}`);

    let headline;
    if (over) headline = v.winner === us ? (this.mySeat == null ? `${this.teamName(us)} win!` : 'You win the game!') : `${this.teamName(them)} win the game`;
    else headline = r.made ? `${this.teamName(bidTeam)} made ${r.contract.amount}` : `${this.teamName(bidTeam)} got set!`;

    const mini = (cards) => h('div.rk-mini-row', cards.map((c) => h('div.rk-card.mini', { html: cardFace(c) })));
    const body = h(
      'div.rk-summary',
      over ? h('div.rk-confetti', Array.from({ length: 40 }, (_, i) => h('i', { style: { '--i': i, '--h': (i * 47) % 360 } }))) : null,
      h('div.rk-banner.' + (good ? 'good' : 'bad'), h('small', over ? 'Game over' : `Round ${r.round}`), h('h2', headline)),
      h(
        'p.rk-sub',
        `${this.name(r.contract.bidder)} bid ${r.contract.amount}${r.contract.solo ? ' (solo)' : ''}`,
        r.trump ? h('span', ' · ', h('span.rk-inline-chip.' + r.trump, { html: colorChip(r.trump) }), ` ${PALETTE[r.trump].name} trump`) : null,
      ),
      h(
        'table.rk-score-table',
        h('thead', h('tr', h('th', ''), h('th', 'Us'), h('th', 'Them'))),
        h(
          'tbody',
          row('Cards taken', trickPts[us], trickPts[them]),
          row('Last trick', lastBonus[us] ? '+20' : '—', lastBonus[them] ? '+20' : '—'),
          r.contract.solo ? null : row('Buried points', nestBonus[us] ? `+${nestBonus[us]}` : '—', nestBonus[them] ? `+${nestBonus[them]}` : '—'),
          row('Round', r.points[us], r.points[them], 'sum'),
          row('Score change', sign(r.change[us]), sign(r.change[them]), 'change'),
          row('Total', r.scores[us], r.scores[them], 'total'),
        ),
      ),
      h(
        'div.rk-reveal',
        h('div', h('small', 'The nest'), mini(r.nest)),
        r.discards?.length ? h('div', h('small', `${this.name(r.contract.bidder)} buried`), mini(r.discards)) : null,
      ),
      over ? this.gameOverButtons() : this.readyRow(v),
    );
    this.openModal(body, over ? 'wide' : '');
    if (!over && this.prefs.autoContinue && this.mySeat != null && !v.ready[this.mySeat]) {
      let n = 8;
      const btn = this.overlay.querySelector('.rk-continue');
      clearInterval(this.countdown);
      this.countdown = setInterval(() => {
        if (this.dead) return clearInterval(this.countdown);
        n--;
        if (btn) btn.textContent = `Continue (${n})`;
        if (n <= 0) {
          clearInterval(this.countdown);
          this.ready();
        }
      }, 1000);
    }
  }

  readyRow(v) {
    return h(
      'div.rk-ready',
      h(
        'div.rk-ready-seats',
        [0, 1, 2, 3].map((s) => h('span.rk-ready-dot' + (v.ready[s] ? '.ok' : ''), { title: this.name(s) }, this.name(s).slice(0, 1))),
      ),
      this.mySeat != null
        ? h('button.btn.gold.big.rk-continue', { onclick: () => (clearInterval(this.countdown), this.ready()), disabled: v.ready[this.mySeat] }, v.ready[this.mySeat] ? 'Waiting for others…' : 'Continue')
        : h('small', 'Watching'),
    );
  }

  updateReady(v) {
    const row = this.overlay.querySelector('.rk-ready');
    if (row) row.replaceWith(this.readyRow(v));
  }

  gameOverButtons() {
    return h(
      'div.rk-bid-actions',
      h('button.btn.ghost.big', { onclick: () => this.ctx.leave() }, 'Game Center'),
      this.client.isHost ? h('button.btn.gold.big', { onclick: () => this.client.send({ t: 'rematch' }) }, 'Play again') : h('small', 'Waiting for the host to start a new game'),
    );
  }

  showLastTrick() {
    const t = this.view.lastTrick;
    if (!t) return;
    const body = h(
      'div.rk-last',
      h('h3', 'Last trick'),
      h(
        'div.rk-last-row',
        t.plays.map((p) => h('div.rk-last-card' + (p.seat === t.winner ? '.won' : ''), h('div.rk-card.mid', { html: cardFace(p.card) }), h('small', this.name(p.seat)))),
      ),
      h('p', `${this.name(t.winner)} took ${t.points} points.`),
      h('button.btn.gold', { onclick: () => this.closeModal() }, 'Close'),
    );
    this.openModal(body, 'small');
  }

  showScoreSheet() {
    const v = this.view;
    const us = this.myTeam();
    const sign = (x) => (x > 0 ? `+${x}` : `${x}`);
    const rows = v.history.map((r) =>
      h(
        'tr',
        h('td', r.round),
        h('td', `${this.name(r.contract.bidder)} ${r.contract.amount}`),
        h('td', r.trump ? h('span.rk-inline-chip.' + r.trump, { html: colorChip(r.trump) }) : '—'),
        h('td.' + (r.made ? 'good' : 'bad'), r.made ? 'Made' : 'Set'),
        h('td', sign(r.change[us])),
        h('td', sign(r.change[1 - us])),
        h('td', `${r.scores[us]} – ${r.scores[1 - us]}`),
      ),
    );
    const body = h(
      'div.rk-sheet',
      h('h3', 'Score sheet'),
      h('p.rk-sub', `First to ${v.options.winScore} wins · ${v.options.lowCards ? '45' : '33'}-card deck`),
      rows.length
        ? h('div.rk-sheet-scroll', h('table.rk-score-table.sheet', h('thead', h('tr', h('th', '#'), h('th', 'Bid'), h('th', 'Trump'), h('th', ''), h('th', 'Us'), h('th', 'Them'), h('th', 'Score'))), h('tbody', rows)))
        : h('p', 'No rounds finished yet.'),
      h('button.btn.gold', { onclick: () => this.closeModal() }, 'Close'),
    );
    this.openModal(body, 'wide');
  }
}

function winnerOf(plays, trump) {
  if (!plays.length) return null;
  const led = suitOf(plays[0].card, trump);
  const score = (p) => {
    const s = suitOf(p.card, trump);
    if (trump && s === trump) return 1000 + strengthOf(p.card, trump);
    return s === led ? strengthOf(p.card, trump) : -1;
  };
  return plays.reduce((b, p) => (score(p) > score(b) ? p : b)).seat;
}
const PLAIN = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 1];
const TRUMP = [5, 6, 7, 8, 9, 10, 'bird', 11, 12, 13, 14, 1];
function strengthOf(card, trump) {
  if (card === BIRD) return TRUMP.indexOf('bird');
  const r = Number(card.split('-')[1]);
  return suitOf(card, trump) === trump ? TRUMP.indexOf(r) : PLAIN.indexOf(r);
}

function legalBids(v) {
  const high = v.bidding.high;
  const out = [];
  const stuck = !high && v.bidding.passed.filter(Boolean).length === 3;
  if (!stuck) out.push({ type: 'pass' });
  for (let b = MIN_BID; b <= MAX_BID; b += BID_STEP) if (!high || b > high.amount) out.push({ type: 'bid', amount: b });
  for (const b of [400, 800]) if (!high || b > high.amount) out.push({ type: 'bid', amount: b });
  return out;
}

const ICONS = {
  last: '<svg viewBox="0 0 24 24"><rect x="4" y="6" width="9" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><rect x="10" y="4" width="9" height="13" rx="2" fill="currentColor" opacity=".35"/><path d="M14 20l3-3-3-3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  sheet: '<svg viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 8h8M8 12h8M8 16h5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  bulb: '<svg viewBox="0 0 24 24"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
};

export { cardPoints };
