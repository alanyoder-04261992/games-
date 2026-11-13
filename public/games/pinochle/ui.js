// The Pinochle table: felt, four seats, your fanned hand, the trick in the middle, and panels
// for bidding, naming trump, passing cards, meld and the round score. It only ever draws the
// view it receives and sends actions back, so it works the same for the host and for guests.
import { h, sleep, clamp, avatar } from '../../core/util.js';
import { sound } from '../../core/sound.js';
import { DEFS, cardFace, cardBack, suitIcon } from './cards.js';
import {
  SUITS,
  SUIT_NAMES,
  BID_STEP,
  LAST_TRICK_BONUS,
  MAX_BID_SPAN,
  cardName,
  shortName,
  meldOf,
  partnerOf,
  teamOf,
  suitOf,
  winningPlay,
  legalPlaysFor,
} from './engine.js';
import { chooseAction, choosePass, bestTrump } from './ai.js';

const POS = ['bottom', 'left', 'top', 'right'];
const SPEED = { relaxed: 1.45, normal: 1, fast: 0.6, turbo: 0.3 };
const PREF_DEFAULTS = { autoSingle: true, autoContinue: false, hints: false, bigCards: false };

export function mount(ctx) {
  const ui = new PinochleTable(ctx);
  return { destroy: () => ui.destroy(), settings: () => ui.settingsItems() };
}

class PinochleTable {
  constructor(ctx) {
    this.ctx = ctx;
    this.client = ctx.client;
    this.view = null;
    this.seats = [];
    this.mySeat = null;
    this.queue = Promise.resolve();
    this.pending = 0;
    this.selected = new Set();
    this.waiting = false;
    this.seq = -1;
    this.speed = 1;
    this.bidPick = null;
    this.fresh = new Set(); // cards that just arrived in my hand (passed to me)
    this.prefs = { ...PREF_DEFAULTS, ...(ctx.prefs.get('pinochle') || {}) };
    this.unsub = [];
    this.timers = new Set();
    this.build();
    this.unsub.push(this.client.on('state', (msg) => this.enqueue(msg)));
    this.unsub.push(this.client.on('chat', (m) => this.bubble(m)));
    this.unsub.push(
      this.client.on('reject', (text) => {
        this.ctx.toast(text, { kind: 'warn' });
        this.waiting = false;
        this.renderAll();
      }),
    );
    if (ctx.voice) {
      const paint = () => this.paintVoice();
      this.unsub.push(ctx.voice.on('speaking', paint), ctx.voice.on('change', paint));
    }
    this.onResize = () => {
      this.layout();
      if (this.view && !this.pending) this.renderAll();
    };
    window.addEventListener('resize', this.onResize);
    if (this.client.lastState) this.enqueue(this.client.lastState);
  }

  destroy() {
    this.dead = true;
    this.unsub.forEach((f) => f());
    window.removeEventListener('resize', this.onResize);
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
  wait(ms) {
    return sleep(ms * this.speed);
  }

  savePrefs() {
    this.ctx.prefs.set('pinochle', this.prefs);
  }

  settingsItems() {
    return [
      { label: 'Auto-play when only one card is legal', value: this.prefs.autoSingle, set: (v) => ((this.prefs.autoSingle = v), this.savePrefs(), this.maybeAuto()) },
      { label: 'Auto-continue after meld and each hand', value: this.prefs.autoContinue, set: (v) => ((this.prefs.autoContinue = v), this.savePrefs()) },
      { label: 'Show suggestions (coach)', value: this.prefs.hints, set: (v) => ((this.prefs.hints = v), this.savePrefs(), this.renderAll()) },
      { label: 'Large cards', value: this.prefs.bigCards, set: (v) => ((this.prefs.bigCards = v), this.savePrefs(), this.layout(), this.renderAll()) },
    ];
  }

  // ------------------------------------------------------------------
  // Skeleton
  // ------------------------------------------------------------------
  build() {
    if (!document.getElementById('pn-defs')) document.body.append(h('div', { id: 'pn-defs', html: DEFS }));
    this.root = h('div.pinochle', { dataset: { phase: 'loading' } });
    this.root.pinochleTable = this; // handy from the console
    this.felt = h('div.pn-felt', h('div.pn-felt-light'), h('div.pn-felt-logo', h('span', 'PINOCHLE')));
    this.hud = h('div.pn-hud');
    this.seatEls = POS.map((p) => h(`div.pn-seat.${p}`));
    this.trickEl = h('div.pn-trick');
    this.ticker = h('div.pn-ticker');
    this.panel = h('div.pn-panel');
    this.handEl = h('div.pn-hand');
    this.overlay = h('div.pn-overlay');
    this.root.append(this.felt, this.trickEl, ...this.seatEls, this.hud, h('div.pn-mine', this.ticker, this.panel, this.handEl), this.overlay);
    this.ctx.el.append(this.root);
    this.layout();
  }

  layout() {
    const r = this.ctx.el.getBoundingClientRect();
    const W = r.width || window.innerWidth;
    const H = r.height || window.innerHeight;
    const portrait = H > W * 1.05;
    let cw = portrait ? Math.min(W / 5.4, H / 8.8) : Math.min(W / 11.5, H / 6.4);
    if (this.prefs.bigCards) cw *= 1.15;
    cw = clamp(cw, 52, 128);
    this.cw = cw;
    this.ch = cw * 1.4;
    this.W = W;
    this.root.style.setProperty('--cw', cw + 'px');
    this.root.style.setProperty('--ch', this.ch + 'px');
    this.root.classList.toggle('portrait', portrait);
    this.root.classList.toggle('compact', W < 560);
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
  verb(seat, you, they) {
    return seat === this.mySeat ? you : they;
  }
  myTeam() {
    return teamOf(this.mySeat ?? 0);
  }
  teamLabel(team) {
    const [a, b] = [team, team + 2];
    const n = (s) => (s === this.mySeat ? 'You' : this.seats[s]?.name || ['South', 'West', 'North', 'East'][s]);
    return `${n(a)} & ${n(b)}`;
  }

  // ------------------------------------------------------------------
  // Update queue: every state change is shown in order
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
    this.seq = msg.seq;
    this.waiting = false;
    const ev = msg.event;
    this.root.dataset.phase = next.phase;
    if (next.round !== prev?.round) {
      this.selected.clear();
      this.fresh.clear();
      this.bidPick = null;
    }

    if (!prev || seatChanged || !ev || ev.type === 'start' || !ev.action) {
      this.view = next;
      if (ev?.type === 'start') {
        this.closeModal();
        await this.dealAnimation();
      }
      this.renderAll();
      return;
    }

    const a = ev.action;
    const seat = ev.seat;
    switch (a.type) {
      case 'bid':
      case 'pass':
        this.view = next;
        sound.chip();
        this.renderAll();
        this.tick(a.type === 'pass' ? `${this.name(seat)} ${this.verb(seat, 'pass', 'passes')}` : `${this.name(seat)} ${this.verb(seat, 'bid', 'bids')} ${a.amount}`);
        if (next.phase !== 'bid') {
          await this.wait(500);
          const c = next.contract;
          this.tick(`${this.name(c.bidder)} ${this.verb(c.bidder, 'win', 'wins')} the bid at ${c.amount}`);
          sound.good();
        }
        break;
      case 'trump':
        this.view = next;
        sound.chip();
        this.tick(`${this.name(seat)} ${this.verb(seat, 'name', 'names')} ${SUIT_NAMES[a.suit]} trump`);
        this.renderAll();
        this.flashTrump();
        break;
      case 'pass-cards': {
        const to = partnerOf(seat);
        if (to === this.mySeat) for (const c of next.passedToMe) this.fresh.add(c);
        this.view = next;
        sound.slide();
        this.tick(`${this.name(seat)} ${this.verb(seat, 'pass', 'passes')} ${a.count ?? a.cards.length} cards to ${to === this.mySeat ? 'you' : this.name(to)}`);
        this.selected.clear();
        this.renderAll();
        if (to === this.mySeat) this.later(() => (this.fresh.clear(), this.renderHand()), 2600);
        break;
      }
      case 'ready':
        this.view = next;
        if (prev.phase === 'meld' && next.phase === 'play') {
          this.closeModal();
          this.tick(`${this.name(next.contract.bidder)} ${this.verb(next.contract.bidder, 'lead', 'leads')}`);
        }
        if (prev.phase === 'score' && next.phase === 'bid') {
          this.closeModal();
          await this.dealAnimation();
        }
        this.renderAll();
        break;
      case 'throw-in':
        this.view = next;
        sound.bad();
        this.tick(`${this.name(seat)} ${this.verb(seat, 'throw', 'throws')} in the hand`);
        this.renderAll();
        break;
      case 'play':
        await this.playAnimation(prev, next, seat, a.card);
        break;
      default:
        this.view = next;
        this.renderAll();
    }
  }

  // The queue is empty: your cards become clickable again.
  idle() {
    if (this.dead || !this.view) return;
    this.renderHand();
    this.renderPanel();
    this.maybeAuto();
  }

  // Auto-play a forced card, and auto-continue past the meld and score screens.
  maybeAuto() {
    const v = this.view;
    if (!v || this.pending || this.waiting || this.mySeat == null) return;
    if (v.phase === 'play' && v.turn === this.mySeat && this.prefs.autoSingle) {
      const cards = this.legalCards();
      if (cards.length === 1) {
        this.later(() => {
          if (!this.pending && !this.waiting && this.view === v) this.playCard(cards[0]);
        }, 450 * this.speed);
      }
    }
    if ((v.phase === 'score' || v.phase === 'meld') && this.prefs.autoContinue && !v.ready[this.mySeat]) {
      const isBidder = v.phase === 'meld' && v.contract?.bidder === this.mySeat;
      if (isBidder) return; // the bidder decides whether to throw in
      this.later(() => {
        if (this.view === v && !this.pending) this.act({ type: 'ready' });
      }, (v.phase === 'meld' ? 4500 : 5500) * this.speed);
    }
  }

  act(action) {
    if (this.waiting) return;
    this.waiting = true;
    this.client.act(action);
    this.renderPanel();
  }

  // ------------------------------------------------------------------
  // Animations
  // ------------------------------------------------------------------
  async dealAnimation() {
    const v = this.view;
    if (!v) return;
    sound.shuffle?.();
    this.trickEl.replaceChildren();
    this.handEl.replaceChildren();
    const deck = h('div.pn-deal', { html: cardBack() });
    this.root.append(deck);
    await this.wait(260);
    sound.deal?.(12);
    for (let i = 0; i < 8; i++) {
      for (const p of POS) {
        const c = h('div.pn-card.pn-flying', { html: cardBack() });
        this.root.append(c);
        const to = this.seatAnchor(p);
        const from = this.centerPoint();
        c.style.transform = `translate(${from.x - this.cw / 2}px, ${from.y - this.ch / 2}px) scale(.6)`;
        requestAnimationFrame(() => {
          c.style.transition = `transform ${260 * this.speed}ms ease-out, opacity ${260 * this.speed}ms`;
          c.style.transform = `translate(${to.x - this.cw / 2}px, ${to.y - this.ch / 2}px) scale(.55) rotate(${(Math.random() - 0.5) * 30}deg)`;
          c.style.opacity = '0.2';
        });
        this.later(() => c.remove(), 320 * this.speed + 40);
      }
      await this.wait(70);
    }
    deck.remove();
    await this.wait(200);
  }

  centerPoint() {
    const r = this.root.getBoundingClientRect();
    const t = this.trickEl.getBoundingClientRect();
    return { x: t.left - r.left + t.width / 2, y: t.top - r.top + t.height / 2 };
  }
  seatAnchor(p) {
    const r = this.root.getBoundingClientRect();
    if (p === 'bottom') {
      const hr = this.handEl.getBoundingClientRect();
      return { x: hr.left - r.left + hr.width / 2, y: hr.top - r.top + this.ch / 2 };
    }
    const el = this.seatEls[POS.indexOf(p)].getBoundingClientRect();
    return { x: el.left - r.left + el.width / 2, y: el.top - r.top + el.height / 2 };
  }

  async playAnimation(prev, next, seat, card) {
    const r = this.root.getBoundingClientRect();
    // where the card starts: my hand, or the player's seat
    let from;
    const mine = seat === this.mySeat && this.handEl.querySelector(`[data-card="${card}"]`);
    if (mine) {
      const b = mine.getBoundingClientRect();
      from = { x: b.left - r.left + b.width / 2, y: b.top - r.top + b.height / 2, rot: 0 };
    } else {
      const a = this.seatAnchor(this.pos(seat));
      from = { ...a, rot: { left: 90, right: -90, top: 180, bottom: 0 }[this.pos(seat)] };
    }
    const completed = next.tricks.length > prev.tricks.length;
    const plays = completed ? next.tricks[next.tricks.length - 1].plays : next.trick.plays;
    // draw the trick with the new card in it (it flies in from where it came from); while a
    // finished trick is on show, nobody has the turn yet
    this.view = completed ? { ...next, phase: 'play', turn: null, trick: { leader: plays[0].seat, plays } } : next;
    this.renderAll({ trick: plays });
    const el = this.trickEl.querySelector(`[data-card="${card}"]`);
    sound.card();
    if (el) {
      const b = el.getBoundingClientRect();
      const to = { x: b.left - r.left + b.width / 2, y: b.top - r.top + b.height / 2 };
      el.style.transition = 'none';
      el.style.transform = `translate(${from.x - to.x}px, ${from.y - to.y}px) rotate(${from.rot}deg) scale(${mine ? 1 : 0.6})`;
      el.getBoundingClientRect();
      el.style.transition = `transform ${300 * this.speed}ms cubic-bezier(.2,.8,.3,1)`;
      el.style.transform = '';
    }
    this.tick(`${this.name(seat)} ${this.verb(seat, 'play', 'plays')} ${shortName(card)}`);
    await this.wait(320);
    if (!completed) {
      this.view = next;
      this.renderAll();
      return;
    }
    // trick done: show it, then sweep it to the winner
    const t = next.tricks[next.tricks.length - 1];
    const winEl = this.trickEl.querySelector(`[data-card="${winningPlay(t.plays, next.trump).card}"]`);
    winEl?.classList.add('win');
    await this.wait(next.tricks.length === 12 ? 1200 : 850);
    const to = this.seatAnchor(this.pos(t.winner));
    sound.sweep?.();
    for (const c of this.trickEl.querySelectorAll('.pn-card')) {
      const b = c.getBoundingClientRect();
      c.style.transition = `transform ${380 * this.speed}ms ease-in, opacity ${380 * this.speed}ms ease-in`;
      c.style.transform = `translate(${to.x - (b.left - r.left + b.width / 2)}px, ${to.y - (b.top - r.top + b.height / 2)}px) scale(.4)`;
      c.style.opacity = '0';
    }
    const pts = t.points;
    this.tick(`${this.name(t.winner)} ${this.verb(t.winner, 'take', 'takes')} the trick${pts ? ` (+${pts})` : ''}${next.tricks.length === 12 ? ` — last trick +${LAST_TRICK_BONUS}` : ''}`);
    await this.wait(400);
    this.view = next;
    this.renderAll();
  }

  flashTrump() {
    const pill = this.hud.querySelector('.pn-contract');
    pill?.classList.add('flash');
    this.later(() => pill?.classList.remove('flash'), 1200);
  }

  tick(text) {
    this.ticker.replaceChildren(h('span', text));
    this.ticker.classList.remove('show');
    this.ticker.getBoundingClientRect();
    this.ticker.classList.add('show');
  }

  bubble(m) {
    if (m.replay || m.system) return;
    const seat = this.seats.findIndex((s) => s?.playerId === m.from);
    if (seat < 0) return;
    const b = h('div.pn-chat-bubble', m.text);
    this.seatEl(seat).append(b);
    this.later(() => b.remove(), 4200);
  }

  paintVoice() {
    if (!this.ctx.voice) return;
    for (let s = 0; s < 4; s++) {
      const id = this.seats[s]?.playerId;
      this.seatEl(s).classList.toggle('speaking', !!(id && this.ctx.voice.speaking.has(id)));
    }
  }

  // ------------------------------------------------------------------
  // Rendering
  // ------------------------------------------------------------------
  renderAll(opts = {}) {
    if (!this.view || this.dead) return;
    this.renderHud();
    this.renderSeats();
    this.renderTrick(opts.trick);
    this.renderHand();
    this.renderPanel();
    this.renderModal();
    this.paintVoice();
  }

  renderHud() {
    const v = this.view;
    const mine = this.myTeam();
    const team = (t) => {
      const c = v.contract;
      const bidding = c && teamOf(c.bidder) === t;
      const meld = v.melds ? v.melds[t].total + v.melds[t + 2].total : null;
      const showHand = v.phase === 'play' || v.phase === 'meld';
      return h(
        `div.pn-team.${t === mine ? 'us' : 'them'}`,
        h('div.pn-team-top', h('span.pn-team-name', t === mine ? 'Us' : 'Them'), h('strong.pn-team-score', String(v.scores[t]))),
        h('div.pn-team-sub', this.teamLabel(t)),
        showHand && meld != null
          ? h('div.pn-team-hand', h('span', `Meld ${meld}`), v.phase === 'play' ? h('span', `Tricks ${v.points[t]}`) : null, bidding ? h('span.pn-need', `Bid ${c.amount}`) : null)
          : null,
        h('div.pn-team-bar', h('i', { style: { width: `${clamp((v.scores[t] / v.options.winScore) * 100, 0, 100)}%` } })),
      );
    };
    const c = v.contract;
    const high = v.bidding?.high;
    const contract = c
      ? h(
          'div.pn-contract',
          v.trump ? h('span.pn-trump', { html: suitIcon(v.trump), title: `${SUIT_NAMES[v.trump]} are trump` }) : null,
          h('div', h('strong', `${c.amount}`), h('small', `${this.name(c.bidder)}${v.trump ? ` · ${SUIT_NAMES[v.trump]}` : ' · naming trump'}`)),
        )
      : h('div.pn-contract.bidding', h('div', h('strong', high ? String(high.amount) : '—'), h('small', high ? `High bid: ${this.name(high.seat)}` : `Opening bid ${v.options.minBid}`)));
    const last = v.lastTrick && v.phase === 'play' && v.tricks.length ? h('button.btn.chip.pn-last', { onclick: () => this.showLastTrick() }, 'Last trick') : null;
    this.hud.replaceChildren(team(mine), h('div.pn-hud-mid', contract, h('small.pn-round', `Hand ${v.round} · to ${v.options.winScore}`), last), team(1 - mine));
  }

  renderSeats() {
    const v = this.view;
    for (let s = 0; s < 4; s++) {
      const el = this.seatEl(s);
      const info = this.seats[s] || {};
      const tags = [];
      if (v.dealer === s) tags.push(h('span.pn-tag.dealer', { title: 'Dealer' }, 'D'));
      if (v.contract?.bidder === s) tags.push(h('span.pn-tag.bid', `Bid ${v.contract.amount}`));
      if (v.phase === 'bid') {
        const lastBid = [...v.bidding.log].reverse().find((e) => e.seat === s);
        if (lastBid) tags.push(h(`span.pn-tag.${lastBid.type}`, lastBid.type === 'pass' ? 'Pass' : String(lastBid.amount)));
      }
      if (v.melds && (v.phase === 'play' || v.phase === 'meld')) tags.push(h('span.pn-tag.meld', `Meld ${v.melds[s].total}`));
      const taken = v.phase === 'play' ? v.tricks.filter((t) => t.winner === s).length : 0;
      const p = this.pos(s);
      const backs =
        p !== 'bottom' && v.handSizes[s]
          ? h(
              'div.pn-backs',
              Array.from({ length: Math.min(v.handSizes[s], 8) }, (_, i) => h('div.pn-back', { style: { '--i': i }, html: cardBack() })),
              h('span.pn-count', String(v.handSizes[s])),
            )
          : null;
      el.className = `pn-seat ${p}` + (v.turn === s && v.phase !== 'over' ? ' turn' : '') + (teamOf(s) === this.myTeam() ? ' ally' : ' foe');
      el.replaceChildren(
        backs,
        h(
          'div.pn-plate',
          avatar(info.name || this.name(s), info.hue ?? 210, { bot: info.kind === 'bot' }),
          h('div.pn-plate-text', h('strong', this.name(s)), h('small', taken ? `${taken} trick${taken > 1 ? 's' : ''}` : info.kind === 'bot' ? 'Computer' : info.connected === false ? 'Offline' : ' ')),
          h('div.pn-tags', tags),
        ),
      );
    }
  }

  renderTrick(plays = this.view.trick?.plays || []) {
    this.trickEl.replaceChildren(
      ...plays.map((p, i) => h(`div.pn-card.pn-slot.${this.pos(p.seat)}`, { dataset: { card: p.card }, style: { zIndex: 10 + i }, html: cardFace(p.card) })),
    );
    const v = this.view;
    if (v.phase === 'play' && plays.length > 1 && plays.length < 4) {
      const w = winningPlay(plays, v.trump);
      this.trickEl.querySelector(`[data-card="${w.card}"]`)?.classList.add('leading');
    }
  }

  legalCards() {
    const v = this.view;
    if (!v || v.phase !== 'play' || v.turn !== this.mySeat || !v.trick) return [];
    return legalPlaysFor(v.hand, v.trick.plays, v.trump);
  }

  hintCard() {
    const v = this.view;
    if (!this.prefs.hints || this.mySeat == null) return null;
    if (v.phase === 'play' && v.turn === this.mySeat) {
      const legal = this.legalCards().map((card) => ({ type: 'play', card }));
      return chooseAction(v, legal, 'hard')?.card || null;
    }
    return null;
  }

  renderHand() {
    const v = this.view;
    const hand = v.hand || [];
    const n = hand.length;
    const avail = Math.min(this.W - 20, 1100);
    const step = n > 1 ? Math.min(this.cw * 0.62, (avail - this.cw) / (n - 1)) : 0;
    const width = this.cw + step * Math.max(0, n - 1);
    this.handEl.style.width = `${width}px`;
    const legal = new Set(this.legalCards());
    const passing = (v.phase === 'passIn' || v.phase === 'passBack') && v.turn === this.mySeat;
    const play = v.phase === 'play' && v.turn === this.mySeat && !this.waiting && !this.pending;
    const hint = this.hintCard();
    const meldCards = v.phase === 'meld' && v.melds && this.mySeat != null ? new Set(v.melds[this.mySeat].cards) : null;
    this.handEl.replaceChildren(
      ...hand.map((card, i) => {
        const cls = ['pn-card', 'in-hand'];
        if (play && legal.has(card)) cls.push('legal');
        if (v.phase === 'play' && v.turn === this.mySeat && !legal.has(card)) cls.push('dim');
        if (passing && this.selected.has(card)) cls.push('picked');
        if (passing) cls.push('pickable');
        if (this.fresh.has(card)) cls.push('fresh');
        if (hint === card) cls.push('hint');
        if (meldCards?.has(card)) cls.push('melded');
        if (v.trump && suitOf(card) === v.trump) cls.push('trump');
        const mid = (n - 1) / 2;
        return h(`div.${cls.join('.')}`, {
          dataset: { card },
          title: cardName(card),
          style: { left: `${i * step}px`, zIndex: i + 1, '--lift': `${Math.abs(i - mid) * Math.abs(i - mid) * 0.35}px`, '--tilt': `${(i - mid) * 1.1}deg` },
          html: cardFace(card),
          onclick: () => this.clickCard(card),
        });
      }),
    );
  }

  clickCard(card) {
    const v = this.view;
    if (!v || this.pending || this.waiting) return;
    if (v.phase === 'play') {
      if (v.turn !== this.mySeat) return;
      if (!this.legalCards().includes(card)) {
        sound.error();
        const led = v.trick.plays[0]?.card;
        this.ctx.toast(led && v.hand.some((c) => suitOf(c) === suitOf(led)) ? `Follow ${SUIT_NAMES[suitOf(led)].toLowerCase()} — and beat the winning card if you can` : led ? 'You must trump (and beat the winning trump if you can)' : 'You can’t play that card');
        return;
      }
      this.playCard(card);
    } else if ((v.phase === 'passIn' || v.phase === 'passBack') && v.turn === this.mySeat) {
      if (this.selected.has(card)) this.selected.delete(card);
      else if (this.selected.size < v.options.pass) this.selected.add(card);
      else return sound.error();
      sound.card();
      this.renderHand();
      this.renderPanel();
    }
  }

  playCard(card) {
    if (this.waiting) return;
    const el = this.handEl.querySelector(`[data-card="${card}"]`);
    el?.classList.add('sent');
    this.act({ type: 'play', card });
  }

  // The strip above your hand: bidding, trump, passing and turn prompts.
  renderPanel() {
    const v = this.view;
    const me = this.mySeat;
    const body = [];
    const myTurn = v.turn === me && me != null && !this.waiting;
    if (me == null) body.push(h('div.pn-prompt', 'Watching'));
    else if (v.phase === 'bid') {
      if (myTurn) body.push(this.bidControls());
      else body.push(h('div.pn-prompt', `${this.name(v.turn)} ${this.verb(v.turn, 'are', 'is')} bidding…`));
    } else if (v.phase === 'trump') {
      if (myTurn) body.push(this.trumpControls());
      else body.push(h('div.pn-prompt', `${this.name(v.turn)} is naming trump…`));
    } else if (v.phase === 'passIn' || v.phase === 'passBack') {
      if (myTurn) {
        const n = v.options.pass;
        const to = partnerOf(me);
        body.push(
          h(
            'div.pn-row',
            h('div.pn-prompt', v.phase === 'passIn' ? `Pass ${n} cards to ${this.name(to)}, who won the bid` : `Pass ${n} cards back to ${this.name(to)}`, h('small', ` (${this.selected.size}/${n} picked)`)),
            h('button.btn.small.ghost', { onclick: () => this.suggestPass() }, 'Suggest'),
            h('button.btn.gold', { disabled: this.selected.size !== n, onclick: () => this.act({ type: 'pass-cards', cards: [...this.selected] }) }, `Pass ${n}`),
          ),
        );
      } else body.push(h('div.pn-prompt', `${this.name(v.turn)} ${this.verb(v.turn, 'are', 'is')} choosing ${v.options.pass} cards to pass…`));
    } else if (v.phase === 'play') {
      if (v.turn === me) body.push(h('div.pn-prompt.go', this.waiting ? '…' : v.trick.plays.length ? 'Your turn' : 'Your lead'));
    } else if (v.phase === 'meld' && v.ready[me]) body.push(h('div.pn-prompt', 'Waiting for the others to look over the meld…'));
    else if (v.phase === 'score' && v.ready[me]) body.push(h('div.pn-prompt', 'Waiting for the next deal…'));
    this.panel.replaceChildren(...body);
    this.panel.classList.toggle('empty', !body.length);
  }

  bidControls() {
    const v = this.view;
    const high = v.bidding.high;
    const from = high ? high.amount + BID_STEP : v.options.minBid;
    const to = Math.max(from, v.options.minBid + MAX_BID_SPAN);
    const stuck = !high && v.bidding.passed.filter(Boolean).length === 3;
    if (this.bidPick == null || this.bidPick < from) this.bidPick = from;
    this.bidPick = clamp(this.bidPick, from, to);
    const best = bestTrump(v.hand);
    const step = (d) => {
      this.bidPick = clamp(this.bidPick + d, from, to);
      sound.chip();
      this.renderPanel();
    };
    let coach = null;
    if (this.prefs.hints) {
      const legalMoves = [...(stuck ? [] : [{ type: 'pass' }])];
      for (let b = from; b <= to; b += BID_STEP) legalMoves.push({ type: 'bid', amount: b });
      const s = chooseAction(v, legalMoves, 'hard');
      coach = h('small.pn-coach', `Coach: ${s.type === 'pass' ? 'pass' : `bid ${s.amount}`}`);
    }
    return h(
      'div.pn-bid',
      h('div.pn-bid-info', h('span', 'Your best meld: '), h('strong', String(best.meld)), h('span', ' with '), h('span.pn-inline-suit', { html: suitIcon(best.suit) }), h('span', ` trump`), coach),
      h(
        'div.pn-row',
        stuck ? h('small.pn-stuck', 'Everyone passed — you must bid') : h('button.btn.ghost', { onclick: () => this.act({ type: 'pass' }) }, 'Pass'),
        h(
          'div.pn-stepper',
          h('button.btn.round', { disabled: this.bidPick <= from, onclick: () => step(-BID_STEP), 'aria-label': 'Lower' }, '−'),
          h('strong.pn-bid-amount', String(this.bidPick)),
          h('button.btn.round', { disabled: this.bidPick >= to, onclick: () => step(BID_STEP), 'aria-label': 'Higher' }, '+'),
        ),
        h('button.btn.gold', { onclick: () => this.act({ type: 'bid', amount: this.bidPick }) }, `Bid ${this.bidPick}`),
      ),
    );
  }

  trumpControls() {
    const v = this.view;
    const best = bestTrump(v.hand).suit;
    return h(
      'div.pn-trumps',
      h('div.pn-prompt', 'Name trump', h('small', ' — meld shown for each suit')),
      h(
        'div.pn-row',
        SUITS.map((s) => {
          const meld = meldOf(v.hand, s).total;
          const n = v.hand.filter((c) => suitOf(c) === s).length;
          return h(
            'button.btn.pn-suit-btn' + (this.prefs.hints && s === best ? '.hinted' : ''),
            { onclick: () => this.act({ type: 'trump', suit: s }), title: SUIT_NAMES[s] },
            h('span.pn-inline-suit.big', { html: suitIcon(s) }),
            h('span.pn-suit-meta', h('strong', `${meld}`), h('small', `${n} card${n === 1 ? '' : 's'}`)),
          );
        }),
      ),
    );
  }

  suggestPass() {
    const v = this.view;
    this.selected = new Set(choosePass(v));
    sound.card();
    this.renderHand();
    this.renderPanel();
  }

  // ------------------------------------------------------------------
  // Meld, score and game-over sheets
  // ------------------------------------------------------------------
  closeModal() {
    this.overlay.replaceChildren();
    this.overlay.classList.remove('open');
    this.modalKey = null;
  }

  renderModal() {
    const v = this.view;
    let key = null;
    if (v.phase === 'meld') key = `meld-${v.round}-${v.ready.join()}`;
    else if (v.phase === 'score') key = `score-${v.round}-${v.ready.join()}`;
    else if (v.phase === 'over') key = `over-${v.round}`;
    if (!key) return this.closeModal();
    if (key === this.modalKey) return;
    const first = !this.modalKey?.startsWith(key.split('-').slice(0, 2).join('-'));
    this.modalKey = key;
    const sheet = v.phase === 'meld' ? this.meldSheet() : this.scoreSheet();
    this.overlay.replaceChildren(h('div.pn-sheet' + (first ? '.pop' : ''), sheet));
    this.overlay.classList.add('open');
    if (first && v.phase === 'over') {
      const won = this.mySeat == null || v.winner === this.myTeam();
      this.later(() => (won ? sound.win() : sound.bad()), 300);
    }
  }

  meldBlock(seat) {
    const m = this.view.melds[seat];
    const trump = this.view.trump;
    return h(
      `div.pn-meld-seat${teamOf(seat) === this.myTeam() ? '.ally' : '.foe'}`,
      h('div.pn-meld-head', h('strong', this.name(seat)), h('span.pn-meld-total', String(m.total))),
      m.items.length
        ? h('ul.pn-meld-list', m.items.map((it) => h('li', h('span', it.name), h('b', String(it.points)))))
        : h('p.pn-meld-none', 'No meld'),
      m.cards.length ? h('div.pn-meld-cards', m.cards.map((c) => h('div.pn-card.mini' + (suitOf(c) === trump ? '.trump' : ''), { title: cardName(c), html: cardFace(c) }))) : null,
    );
  }

  meldSheet() {
    const v = this.view;
    const me = this.mySeat;
    const mine = this.myTeam();
    const c = v.contract;
    const order = [0, 1, 2, 3].sort((a, b) => (teamOf(a) === mine ? 0 : 1) - (teamOf(b) === mine ? 0 : 1) || a - b);
    const tm = (t) => v.melds[t].total + v.melds[t + 2].total;
    const bidTeam = teamOf(c.bidder);
    const need = Math.max(0, c.amount - tm(bidTeam));
    const amBidder = me === c.bidder;
    const ready = me != null && v.ready[me];
    return [
      h('h2', 'Meld', h('span.pn-inline-suit', { html: suitIcon(v.trump) }), h('small', ` ${SUIT_NAMES[v.trump]} are trump`)),
      h(
        'p.pn-meld-summary',
        `${this.teamLabel(bidTeam)} bid ${c.amount} and meld ${tm(bidTeam)}. `,
        need > 250 ? h('strong.bad', `They can’t make it — ${need} more needed, but only 250 are in the tricks.`) : h('strong', `They need ${need} from the tricks.`),
      ),
      h('div.pn-meld-grid', order.map((s) => this.meldBlock(s))),
      h(
        'div.pn-team-melds',
        h('span', `Us: ${tm(mine)}`),
        h('span', `Them: ${tm(1 - mine)}`),
        h('small', 'Meld only counts for a team that takes at least one trick.'),
      ),
      me == null
        ? null
        : h(
            'div.pn-sheet-actions',
            amBidder && !ready ? h('button.btn.ghost', { onclick: () => this.confirmThrowIn() }, 'Throw in the hand') : null,
            ready ? h('small', 'Waiting for the others…') : h('button.btn.gold', { onclick: () => this.act({ type: 'ready' }) }, 'Play the hand'),
          ),
    ];
  }

  confirmThrowIn() {
    const v = this.view;
    const amt = v.contract.amount;
    if (confirm(`Throw in? Your team loses ${amt} and the other team scores only its meld.`)) this.act({ type: 'throw-in' });
  }

  scoreSheet() {
    const v = this.view;
    const r = v.lastRound;
    const mine = this.myTeam();
    const me = this.mySeat;
    if (!r) return [h('h2', 'Game over')];
    const bidTeam = teamOf(r.contract.bidder);
    const teams = [mine, 1 - mine];
    const row = (label, f, cls = '') => h('tr' + cls, h('th', label), ...teams.map((t) => h('td', f(t))));
    const sign = (n) => (n > 0 ? `+${n}` : String(n));
    const head =
      v.phase === 'over'
        ? h('h2.pn-final', me == null ? `${this.teamLabel(v.winner)} win!` : v.winner === mine ? 'You win the game!' : 'They win the game')
        : h('h2', `Hand ${r.round}`);
    const verdict = r.thrownIn
      ? `${this.teamLabel(bidTeam)} threw in the hand at ${r.contract.amount}.`
      : r.made
        ? `${this.teamLabel(bidTeam)} made ${r.contract.amount} in ${SUIT_NAMES[r.trump]}.`
        : `${this.teamLabel(bidTeam)} went set at ${r.contract.amount}.`;
    return [
      head,
      h(`p.pn-verdict.${r.made ? 'good' : 'bad'}`, verdict),
      h(
        'table.pn-score',
        h('thead', h('tr', h('th', ''), ...teams.map((t) => h('th', t === mine ? 'Us' : 'Them')))),
        h(
          'tbody',
          row('Meld', (t) => (r.saved[t] || r.thrownIn ? String(r.meld[t]) : h('s', String(r.meld[t])))),
          r.thrownIn ? null : row('Counters', (t) => String(r.counters[t])),
          row('Bid', (t) => (t === bidTeam ? String(r.contract.amount) : '—')),
          row('This hand', (t) => sign(r.change[t]), '.change'),
          row('Score', (t) => String(r.scores[t]), '.total'),
        ),
      ),
      !r.thrownIn && r.saved.some((x) => !x) ? h('small.pn-note', 'A team that takes no tricks loses its meld.') : null,
      this.historyTable(),
      v.phase === 'over'
        ? h(
            'div.pn-sheet-actions',
            h('button.btn.ghost', { onclick: () => this.ctx.leave() }, 'Game Center'),
            this.ctx.rematch ? this.ctx.rematch() : this.client.isHost ? h('button.btn.gold', { onclick: () => this.client.send({ t: 'rematch' }) }, 'Play again') : null,
          )
        : me == null
          ? null
          : h('div.pn-sheet-actions', v.ready[me] ? h('small', 'Waiting for the others…') : h('button.btn.gold', { onclick: () => this.act({ type: 'ready' }) }, 'Next hand')),
    ];
  }

  historyTable() {
    const v = this.view;
    if (!v.history?.length) return null;
    const mine = this.myTeam();
    return h(
      'details.pn-history',
      h('summary', `All hands (${v.history.length})`),
      h(
        'table',
        h('tr', h('th', '#'), h('th', 'Bid'), h('th', 'Us'), h('th', 'Them')),
        v.history.map((x) =>
          h(
            'tr',
            h('td', String(x.round)),
            h('td', `${x.contract.amount} ${teamOf(x.contract.bidder) === mine ? 'us' : 'them'} ${x.thrownIn ? '(in)' : x.made ? '✓' : '✗'}`),
            h('td', String(x.scores[mine])),
            h('td', String(x.scores[1 - mine])),
          ),
        ),
      ),
    );
  }

  showLastTrick() {
    const v = this.view;
    const t = v.lastTrick;
    if (!t) return;
    const pop = h(
      'div.pn-lasttrick',
      h('strong', `${this.name(t.winner)} took it (${t.points})`),
      h('div.pn-lasttrick-cards', t.plays.map((p) => h('div.pn-lt', h('div.pn-card.mini', { html: cardFace(p.card) }), h('small', this.name(p.seat))))),
    );
    pop.onclick = () => pop.remove();
    this.root.append(pop);
    this.later(() => pop.remove(), 3500);
  }
}
