// The Euchre table: felt, seats, fanned hands, the kitty and its up-card, animated dealing and
// tricks, ordering-up and calling panels, hand summaries. Works the same for the host and for
// online guests: it only ever renders the view it receives and sends actions back.
import { h, sleep, clamp, avatar } from '../../core/util.js';
import { sound } from '../../core/sound.js';
import { DEFS, cardFace, cardBack, suitIcon } from './cards.js';
import {
  SUITS,
  SUIT_NAMES,
  cardName,
  shortName,
  isLeft,
  isRight,
  isRed,
  isTrump,
  legalPlays,
  naturalSuit,
  partnerOf,
  power,
  suitOf,
  teamOf,
} from './engine.js';
import { chooseAction, bestDiscard } from './ai.js';

const POS = ['bottom', 'left', 'top', 'right'];
const SPEED = { relaxed: 1.45, normal: 1, fast: 0.6, turbo: 0.3 };
const PREF_DEFAULTS = { autoSingle: true, autoContinue: true, hints: false, bigCards: false };

export function mount(ctx) {
  const ui = new EuchreTable(ctx);
  return { destroy: () => ui.destroy(), settings: () => ui.settingsItems() };
}

class EuchreTable {
  constructor(ctx) {
    this.ctx = ctx;
    this.client = ctx.client;
    this.view = null;
    this.seats = [];
    this.mySeat = null;
    this.queue = Promise.resolve();
    this.pending = 0;
    this.selected = null; // the card picked to discard
    this.aloneToggle = false;
    this.waiting = false;
    this.seq = -1;
    this.speed = 1;
    this.prefs = { ...PREF_DEFAULTS, ...(ctx.prefs.get('euchre') || {}) };
    this.unsub = [];
    this.timers = new Set();
    this.build();
    this.unsub.push(this.client.on('state', (msg) => this.enqueue(msg)));
    this.unsub.push(this.client.on('chat', (m) => this.bubble(m)));
    this.unsub.push(
      this.client.on('reject', (text) => {
        this.ctx.toast(text, { kind: 'warn' });
        this.waiting = false;
        this.renderHand();
        this.renderPanel();
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
    clearInterval(this.countdown);
    this.root.remove();
  }

  later(fn, ms) {
    const t = setTimeout(() => {
      this.timers.delete(t);
      if (!this.dead) fn();
    }, ms);
    this.timers.add(t);
  }

  savePrefs() {
    this.ctx.prefs.set('euchre', this.prefs);
  }

  settingsItems() {
    return [
      { label: 'Auto-play when only one card is legal', value: this.prefs.autoSingle, set: (v) => ((this.prefs.autoSingle = v), this.savePrefs(), this.maybeAuto()) },
      { label: 'Auto-continue after each hand', value: this.prefs.autoContinue, set: (v) => ((this.prefs.autoContinue = v), this.savePrefs()) },
      { label: 'Show suggestions (coach)', value: this.prefs.hints, set: (v) => ((this.prefs.hints = v), this.savePrefs(), this.renderAll()) },
      { label: 'Large cards', value: this.prefs.bigCards, set: (v) => ((this.prefs.bigCards = v), this.savePrefs(), this.layout(), this.renderAll()) },
    ];
  }

  // ------------------------------------------------------------------
  // Skeleton
  // ------------------------------------------------------------------
  build() {
    if (!document.getElementById('eu-defs')) document.body.append(h('div', { id: 'eu-defs', html: DEFS }));
    this.root = h('div.euchre', { dataset: { phase: 'loading' } });
    this.root.euchreTable = this; // handy from the console
    this.felt = h(
      'div.eu-felt',
      h('div.eu-felt-light'),
      h('div.eu-felt-logo', { html: `<span>EUCHRE</span><div class="eu-logo-suits">${SUITS.map((s) => suitIcon(s)).join('')}</div>` }),
    );
    this.hud = h('div.eu-hud');
    this.seatEls = POS.map((p) => h(`div.eu-seat.${p}`));
    this.oppHands = POS.map((p) => h(`div.eu-opp.${p}`));
    this.kittyEl = h('div.eu-kitty');
    this.trickEl = h('div.eu-trick');
    this.ticker = h('div.eu-ticker');
    this.center = h('div.eu-center', this.kittyEl, this.trickEl);
    this.panel = h('div.eu-panel');
    this.handEl = h('div.eu-hand');
    this.watchEl = h('div');
    this.flyLayer = h('div.eu-fly');
    this.overlay = h('div.eu-overlay');
    this.root.append(this.felt, ...this.oppHands, this.center, ...this.seatEls, this.hud, this.ticker, h('div.eu-mine', this.panel, this.handEl, this.watchEl), this.flyLayer, this.overlay);
    this.ctx.el.append(this.root);
    this.layout();
  }

  layout() {
    const r = this.ctx.el.getBoundingClientRect();
    const W = r.width || window.innerWidth;
    const H = r.height || window.innerHeight;
    const portrait = H > W * 1.05;
    let cw = portrait ? Math.min(W / 5.6, H / 9) : Math.min(W / 11.5, H / 6.7);
    if (this.prefs.bigCards) cw *= 1.15;
    cw = clamp(cw, 54, 138);
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
  // "You" / "Ann" as the subject of a sentence, with the verb agreeing
  says(seat, verb, verbS = verb + 's') {
    return `${this.name(seat)} ${seat === this.mySeat ? verb : verbS}`;
  }
  teamName(team) {
    const [a, b] = [0, 1, 2, 3].filter((s) => teamOf(s) === team);
    const n = (s) => (s === this.mySeat ? 'You' : this.seats[s]?.name || ['South', 'West', 'North', 'East'][s]);
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
    this.seq = msg.seq;
    this.waiting = false;
    const ev = msg.event;
    this.root.dataset.phase = next.phase;

    // fresh table (first message, reconnect or seat change): just draw it
    if (!prev || seatChanged || !ev || ev.type === 'start') {
      this.view = next;
      this.resetHandState(prev, next);
      if (ev?.type === 'start') {
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
      case 'pass': {
        sound.chip();
        const redeal = next.round !== prev.round;
        // show the pass on the old table first
        this.view = redeal ? { ...prev, calls: [...prev.calls, { seat, type: 'pass' }], turn: null } : next;
        this.renderAll();
        this.popBubble(seat);
        this.tick(`${this.says(seat, 'pass', 'passes')}`);
        if (prev.phase === 'order' && next.phase === 'call') {
          await this.wait(500);
          this.tick(`${shortName(prev.upcard)} turned down — name another suit`);
          this.view = next;
          this.renderAll();
          this.renderKitty(true);
        } else if (redeal) {
          await this.wait(700);
          this.tick(`Everyone passed — ${this.says(next.dealer, 'deal', 'deals')} a new hand`);
          await this.wait(500);
          this.view = next;
          this.resetHandState(prev, next);
          await this.dealAnimation(next);
          this.renderAll();
        }
        break;
      }
      case 'order':
      case 'call': {
        sound.good();
        const suit = a.type === 'order' ? naturalSuit(prev.upcard) : a.suit;
        // bubble first, on a table that doesn't yet show the dealer's new card
        this.view = { ...next, hand: prev.hand, handSizes: prev.handSizes, turn: null };
        this.renderAll();
        this.popBubble(seat);
        const who = this.name(seat);
        let text;
        if (a.type === 'order') text = seat === prev.dealer ? `${this.says(seat, 'pick', 'picks')} it up — ${SUIT_NAMES[suit]} trump` : `${this.says(seat, 'order', 'orders')} it up — ${SUIT_NAMES[suit]} trump`;
        else text = `${who} ${seat === this.mySeat ? 'name' : 'names'} ${SUIT_NAMES[suit]} trump`;
        if (a.alone) text += ' and ' + (seat === this.mySeat ? 'go' : 'goes') + ' alone!';
        this.tick(text);
        await this.wait(700);
        if (next.pickedUp) await this.pickUpAnimation(prev, next);
        this.view = next;
        this.renderAll();
        break;
      }
      case 'discard': {
        await this.discardAnimation(prev, next, seat, a);
        this.view = next;
        this.selected = null;
        this.renderAll();
        this.tick(`${this.says(seat, 'discard', 'discards')} — ${this.name(next.turn)} ${next.turn === this.mySeat ? 'lead' : 'leads'}`);
        break;
      }
      case 'play':
        await this.playAnimation(prev, next, seat, a);
        break;
      case 'ready':
        this.view = next;
        if (next.round !== prev.round) {
          this.closeModal();
          this.resetHandState(prev, next);
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

  resetHandState(prev, next) {
    if (!prev || prev.round !== next.round) {
      this.selected = null;
      this.aloneToggle = false;
      this.newCard = null;
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
    if (!v || this.mySeat == null) return false;
    if (v.phase === 'score') return !v.ready[this.mySeat];
    return v.turn === this.mySeat && ['order', 'call', 'discard', 'play'].includes(v.phase);
  }

  me() {
    return this.seats[this.mySeat];
  }

  maybeAuto() {
    const v = this.view;
    if (!v || this.pending || !this.myTurn() || this.waiting) return;
    if (this.me()?.autopilot) return;
    if (v.phase === 'play' && this.prefs.autoSingle) {
      const legal = legalPlays(v.hand, v.trick, v.trump);
      if (legal.length === 1) {
        const seq = this.seq;
        this.later(() => {
          if (this.seq === seq && !this.pending && this.myTurn()) this.play(legal[0]);
        }, 650 * this.speed);
      }
    }
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
    this.renderKitty();
    this.renderTrick();
    this.renderHand();
    this.renderPanel();
  }

  renderHud() {
    const v = this.view;
    const us = this.myTeam();
    const them = 1 - us;
    const target = v.options.winScore;
    const prevScores = this.shownScores || v.scores;
    const team = (t, label) => {
      const score = v.scores[t];
      const pips = [];
      for (let i = 0; i < target; i++) pips.push(h('i' + (i < score ? '.on' : '')));
      const taken = v.phase === 'play' ? v.taken[t] : null;
      return h(
        `div.eu-team.${t === us ? 'us' : 'them'}`,
        h('div.eu-team-top', h('span.eu-team-label', label), h('span.eu-team-names', this.teamName(t))),
        h('div.eu-team-score', h('span.eu-score' + (score !== prevScores[t] ? '.bump' : ''), score), target <= 15 ? h('div.eu-pips', { title: `First to ${target}` }, pips) : null),
        taken != null ? h('div.eu-tricks', { title: 'Tricks this hand' }, taken ? Array.from({ length: taken }, () => h('b')) : null, `${taken} trick${taken === 1 ? '' : 's'}`) : null,
      );
    };
    this.shownScores = [...v.scores];
    let mid;
    if (v.trump) {
      mid = h(
        'div.eu-contract',
        h('div.eu-trump-badge', { html: suitIcon(v.trump), title: `${SUIT_NAMES[v.trump]} are trump` }),
        h(
          'div.eu-contract-text',
          h('strong', `${SUIT_NAMES[v.trump]}`, v.alone ? h('span.eu-alone', 'Alone') : null),
          h('small', `Called by ${this.name(v.maker)}`),
        ),
      );
    } else if (v.phase === 'order' || v.phase === 'call') {
      const up = v.upcard;
      const down = v.phase === 'call';
      mid = h(
        'div.eu-contract.bidding',
        h(
          `div.eu-trump-badge.up.${isRed(naturalSuit(up)) ? 'red' : 'black'}` + (down ? '.down' : ''),
          { title: down ? `${cardName(up)} was turned down` : `Up-card: ${cardName(up)}` },
          down ? null : h('span', shortName(up).replace(/[♠♥♦♣]/, ''), h('span', { html: suitIcon(naturalSuit(up)) })),
        ),
        h(
          'div.eu-contract-text',
          h('strong', down ? 'Name trump' : 'Order up?'),
          h('small', `Hand ${v.round} · ${this.name(v.dealer)} ${v.dealer === this.mySeat ? 'deal' : 'deals'}`),
        ),
      );
    } else {
      mid = h('div.eu-contract.bidding', h('div.eu-contract-text', h('strong', `Hand ${v.round}`), h('small', `First to ${target}`)));
    }
    const buttons = h(
      'div.eu-hud-buttons',
      v.lastTrick && v.phase === 'play' && v.tricks.length ? h('button.eu-icon', { title: 'Last trick', onclick: () => this.showLastTrick() }, h('span', { html: ICONS.last })) : null,
      h('button.eu-icon', { title: 'Score sheet', onclick: () => this.showScoreSheet() }, h('span', { html: ICONS.sheet })),
      this.mySeat != null && !['score', 'over'].includes(v.phase)
        ? h('button.eu-icon' + (this.prefs.hints ? '.on' : ''), { title: 'Coach: suggest a move', onclick: () => this.coach() }, h('span', { html: ICONS.bulb }))
        : null,
    );
    this.hud.replaceChildren(team(us, 'Us'), mid, team(them, 'Them'), buttons);
  }

  renderSeats() {
    const v = this.view;
    for (let s = 0; s < 4; s++) {
      const el = this.seatEl(s);
      const info = this.seats[s] || { name: this.name(s), kind: 'bot', hue: 200 };
      const isTurn = v.turn === s && !['score', 'over'].includes(v.phase);
      el.className = `eu-seat ${this.pos(s)} team-${teamOf(s) === this.myTeam() ? 'us' : 'them'}`;
      el.classList.toggle('turn', isTurn);
      el.classList.toggle('out', v.sittingOut === s);
      el.classList.toggle('offline', info.kind === 'human' && !info.connected);
      const badges = [];
      if (v.dealer === s) badges.push(h('span.eu-dealer', { title: 'Dealer' }, 'D'));
      if (v.maker === s && v.trump) badges.push(h('span.eu-maker', { title: v.alone ? 'Called trump and went alone' : 'Called trump', html: suitIcon(v.trump) + (v.alone ? 'ALONE' : '') }));
      const status =
        v.sittingOut === s
          ? 'Sitting out'
          : info.kind === 'human' && !info.connected
            ? 'Reconnecting…'
            : info.autopilot
              ? 'Autopilot'
              : isTurn
                ? s === this.mySeat
                  ? 'Your turn'
                  : v.phase === 'discard'
                    ? 'Discarding…'
                    : 'Thinking…'
                : s === partnerOf(this.mySeat ?? -9) && this.mySeat != null
                  ? 'Partner'
                  : '';
      el.replaceChildren(
        h('div.eu-avatar-wrap', avatar(info.name || this.name(s), info.hue ?? 200, { bot: info.kind === 'bot' }), h('div.eu-ring'), ...badges),
        h('div.eu-nameplate', h('span.eu-name', s === this.mySeat ? `${info.name || 'You'} (you)` : info.name || this.name(s)), status ? h('span.eu-status', status) : null),
        this.bubbleFor(s),
      );
    }
    this.paintVoice();
  }

  // the latest call this seat made, while trump is being decided (and just after)
  bubbleFor(s) {
    const v = this.view;
    if (!['order', 'call'].includes(v.phase) && !(v.phase === 'discard' || (v.phase === 'play' && !v.tricks.length && !v.trick?.plays.length))) return null;
    const last = [...(v.calls || [])].reverse().find((c) => c.seat === s);
    if (!last) return null;
    if (last.type === 'pass') {
      // after round one, only show passes from the current round
      if (v.phase === 'call' && last.phase === 'order') return null;
      if (v.trump) return null;
      return h('div.eu-bubble.pass', 'Pass');
    }
    const suit = last.type === 'order' ? naturalSuit(v.upcard) : last.suit;
    const words = last.type === 'order' ? (s === v.dealer ? 'Pick it up!' : 'Order up!') : SUIT_NAMES[suit];
    return h('div.eu-bubble.call', { html: (last.type === 'call' ? suitIcon(suit) : '') + `<span>${words}${last.alone ? ' Alone!' : ''}</span>` });
  }

  popBubble(seat) {
    const el = this.seatEl(seat).querySelector('.eu-bubble');
    if (el) {
      el.classList.remove('pop');
      void el.offsetWidth;
      el.classList.add('pop');
    }
  }

  // voice chat: light up whoever is talking, mark who is muted
  paintVoice() {
    const voice = this.ctx.voice;
    if (!voice || !this.view) return;
    const roster = voice.roster();
    for (let s = 0; s < 4; s++) {
      const id = this.seats[s]?.playerId;
      const el = this.seatEl(s);
      const r = id && roster.find((x) => x.id === id);
      el.classList.toggle('speaking', !!(id && voice.speaking.has(id)));
      el.classList.toggle('mic-off', !!(r && (r.muted || r.hostMuted)));
    }
  }

  renderOpp(sizes = this.view.handSizes) {
    for (let s = 0; s < 4; s++) {
      const el = this.oppHands[POS.indexOf(this.pos(s))];
      if (s === this.mySeat) {
        el.replaceChildren();
        continue;
      }
      el.replaceChildren(...this.backFan(s, sizes[s] || 0));
    }
  }

  backFan(s, n) {
    const horiz = this.pos(s) === 'top' || this.pos(s) === 'bottom';
    const step = Math.min(this.cw * (horiz ? 0.22 : 0.18), 16);
    const out = [];
    for (let i = 0; i < n; i++) {
      const off = (i - (n - 1) / 2) * step;
      const rot = (i - (n - 1) / 2) * 4;
      const c = h('div.eu-card.back.small', { html: cardBack() });
      c.style.transform = horiz ? `translate(${off}px, ${Math.abs(off) * 0.12}px) rotate(${rot}deg)` : `translate(${Math.abs(off) * 0.12}px, ${off}px) rotate(${90 + rot}deg)`;
      out.push(c);
    }
    return out;
  }

  // The kitty: three cards face down with the up-card on top, during the calling.
  renderKitty(flipping = false) {
    const v = this.view;
    const show = ['order', 'call', 'discard'].includes(v.phase) && !this.dealing;
    if (!show) return this.kittyEl.replaceChildren();
    const cards = [];
    const n = v.kittySize || 3;
    for (let i = 0; i < n; i++) {
      const c = h('div.eu-card.back', { html: cardBack() });
      c.style.transform = `translate(${i * 1.5 - 3}px, ${-i * 1.5}px) rotate(${(i - 1) * 3}deg)`;
      cards.push(c);
    }
    if (v.phase === 'order') {
      const up = this.cardEl(v.upcard, '.up' + (v.turn === this.mySeat ? '.glow' : ''));
      up.style.transform = `translate(4px, -6px) rotate(4deg)`;
      cards.push(up);
    } else if (v.phase === 'call') {
      // turned face down, a little askew, on top of the pile
      const down = h('div.eu-card.back' + (flipping ? '.up' : ''), { html: cardBack() });
      down.style.transform = `translate(6px, -6px) rotate(-14deg)`;
      cards.push(down);
    } else if (v.phase === 'discard' && this.discardShown) {
      const down = h('div.eu-card.back', { html: cardBack() });
      down.style.transform = `translate(5px, -5px) rotate(10deg)`;
      cards.push(down);
    }
    const label = v.phase === 'order' ? 'Up-card' : v.phase === 'call' ? 'Turned down' : 'Kitty';
    this.kittyEl.replaceChildren(...cards, h('div.eu-kitty-label', label));
    // during the calling the trick area is empty, so the kitty sits in the middle
  }

  slotOffset(seat) {
    const p = this.pos(seat);
    const dx = this.cw * 0.82;
    const dy = this.ch * 0.44;
    return { bottom: [0, dy], top: [0, -dy], left: [-dx, 0], right: [dx, 0] }[p];
  }
  tilt(card) {
    let x = 0;
    for (const ch of card) x = (x * 31 + ch.charCodeAt(0)) % 97;
    return (x % 13) - 6;
  }

  renderTrick(plays = this.view.trick?.plays || []) {
    const v = this.view;
    const cards = plays.map(({ seat, card }) => {
      const [x, y] = this.slotOffset(seat);
      const c = this.cardEl(card);
      c.style.transform = `translate(${x}px, ${y}px) rotate(${this.tilt(card)}deg)`;
      c.dataset.seat = seat;
      return c;
    });
    if (v.trick && plays.length > 1) {
      const w = winnerOf(plays, v.trump);
      cards[plays.findIndex((p) => p.seat === w)]?.classList.add('winning');
    }
    this.trickEl.replaceChildren(...cards);
  }

  cardEl(card, extra = '') {
    return h('div.eu-card' + extra, { html: cardFace(card), dataset: { card } });
  }

  // ---------- my hand ----------
  legalSet() {
    const v = this.view;
    if (!v || this.mySeat == null || v.turn !== this.mySeat) return new Set();
    if (v.phase === 'play') return new Set(legalPlays(v.hand, v.trick, v.trump));
    if (v.phase === 'discard') return new Set(v.hand);
    return new Set();
  }

  renderHand() {
    const v = this.view;
    if (!v) return;
    const hand = this.dealing ? [] : v.hand || [];
    const legal = this.legalSet();
    const interactive = !this.pending && !this.waiting && legal.size > 0 && !this.me()?.autopilot;
    const W = this.handEl.getBoundingClientRect().width || window.innerWidth;
    const n = hand.length;
    const cw = this.cw * 1.1;
    const maxStep = cw * 0.78;
    const step = n > 1 ? Math.min(maxStep, (W - cw * 1.5) / (n - 1)) : 0;
    const spread = Math.min(4, 24 / Math.max(n, 1));
    const hint = this.prefs.hints && interactive ? this.hintCard() : null;
    // mark trumps and name the bowers; while the up-card is out, show what its suit would make trump
    const trump = v.trump || (v.phase === 'order' ? naturalSuit(v.upcard) : null);
    const els = hand.map((card, i) => {
      const off = i - (n - 1) / 2;
      const el = this.cardEl(card, '.in-hand');
      el.style.setProperty('--x', `${off * step}px`);
      el.style.setProperty('--y', `${Math.pow(Math.abs(off), 1.6) * 2}px`);
      el.style.setProperty('--r', `${off * spread}deg`);
      el.style.zIndex = 10 + i;
      if (this.newCard === card) el.classList.add('new');
      if (v.phase === 'discard' && this.selected === card) el.classList.add('selected');
      if (interactive) {
        if (legal.has(card)) el.classList.add('playable');
        else if (v.phase === 'play') el.classList.add('dim');
      }
      if (hint === card) el.classList.add('hint');
      if (trump && isTrump(card, trump)) {
        el.classList.add('trump');
        if (isRight(card, trump)) el.append(h('span.eu-tag', 'Right'));
        else if (isLeft(card, trump)) el.append(h('span.eu-tag', 'Left'));
      }
      this.bindCard(el, card, legal, interactive);
      return el;
    });
    this.handEl.replaceChildren(...els);
    this.handEl.classList.toggle('active', interactive);
    // sitting out (or watching): say so where the hand would be
    const out = this.mySeat != null && v.sittingOut === this.mySeat;
    this.watchEl.className = out ? 'eu-watch' : '';
    this.watchEl.textContent = out ? 'Your partner is going alone — sit back and cheer.' : '';
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
      this.selected = this.selected === card ? null : card;
      sound.slide();
      this.renderHand();
      this.renderPanel();
    }
  }

  play(card) {
    this.act({ type: 'play', card });
    this.handEl.querySelector(`[data-card="${card}"]`)?.classList.add('sent');
  }

  // what the coach would do here (the Expert computer's choice)
  suggestion() {
    const v = this.view;
    if (this._hint?.seq === this.seq) return this._hint.value;
    let value = null;
    try {
      value = chooseAction(v, legalFor(v), 'hard');
    } catch (e) {
      console.warn(e);
    }
    this._hint = { seq: this.seq, value };
    return value;
  }
  hintCard() {
    const a = this.suggestion();
    return a && (a.type === 'play' || a.type === 'discard') ? a.card : null;
  }

  coach() {
    const v = this.view;
    if (!this.myTurn() || v.phase === 'score') {
      this.ctx.toast('The coach helps when it is your turn.');
      return;
    }
    const a = this.suggestion();
    if (!a) return;
    if (a.type === 'pass') this.ctx.toast('Coach: pass this one.', { ms: 3200 });
    else if (a.type === 'order') this.ctx.toast(`Coach: ${v.dealer === this.mySeat ? 'pick it up' : 'order it up'}${a.alone ? ' and go alone' : ''}.`, { ms: 3200 });
    else if (a.type === 'call') this.ctx.toast(`Coach: name ${SUIT_NAMES[a.suit]}${a.alone ? ' and go alone' : ''}.`, { ms: 3200 });
    else if (a.type === 'discard') {
      this.selected = a.card;
      this.renderHand();
      this.renderPanel();
      this.ctx.toast(`Coach: discard the ${cardName(a.card)}.`, { ms: 3000 });
    } else if (a.type === 'play') {
      this.prefs.hints = true;
      this.savePrefs();
      this.renderHand();
      this.renderHud();
      this.ctx.toast(`Coach: play the ${cardName(a.card, v.trump)}.`, { ms: 3000 });
    }
  }

  // ---------- action panel ----------
  renderPanel() {
    const v = this.view;
    const p = this.panel;
    p.replaceChildren();
    p.className = 'eu-panel';
    if (!v || this.mySeat == null || this.pending) return;
    if (this.me()?.autopilot && !['score', 'over'].includes(v.phase)) {
      p.append(h('div.eu-prompt', 'Autopilot is playing your hand. ', h('button.btn.small', { onclick: () => this.client.setAutopilot(false) }, 'Take over')));
      return;
    }
    if (v.turn !== this.mySeat) {
      if (v.phase === 'discard') p.append(h('div.eu-prompt', `${this.name(v.dealer)} is picking a card to discard…`));
      return;
    }
    if (v.phase === 'order') this.orderPanel(p);
    else if (v.phase === 'call') this.callPanel(p);
    else if (v.phase === 'discard') this.discardPanel(p);
    else if (v.phase === 'play') {
      const plays = v.trick.plays;
      let text;
      if (!plays.length) text = v.tricks.length ? 'Your lead.' : 'You lead first.';
      else {
        const led = suitOf(plays[0].card, v.trump);
        const legal = this.legalSet();
        const follows = [...legal].every((c) => suitOf(c, v.trump) === led);
        const ledName = SUIT_NAMES[led].toLowerCase() + (led === v.trump ? ' (trump)' : '');
        text = follows ? `Follow ${ledName}.` : `No ${SUIT_NAMES[led].toLowerCase()} — trump it or throw off.`;
      }
      p.append(h('div.eu-prompt.turn', h('span.eu-dot'), text, h('small', ' Tap a card or drag it up.')));
    }
  }

  aloneButton() {
    if (this.view.options.allowAlone === false) return null;
    return h(
      'button.btn.chip.alone' + (this.aloneToggle ? '.on' : ''),
      {
        onclick: () => {
          this.aloneToggle = !this.aloneToggle;
          sound.chip();
          this.renderPanel();
        },
        title: 'Your partner sits out. Take all five tricks for 4 points.',
        'aria-pressed': this.aloneToggle ? 'true' : 'false',
      },
      this.aloneToggle ? '✓ Going alone' : 'Go alone',
    );
  }

  orderPanel(p) {
    const v = this.view;
    const up = v.upcard;
    const suit = naturalSuit(up);
    const me = this.mySeat;
    const dealer = v.dealer;
    let question;
    if (dealer === me) question = 'Pick it up?';
    else if (partnerOf(me) === dealer) question = 'Order your partner to pick it up?';
    else question = `Order ${this.name(dealer)} to pick it up?`;
    const count = v.hand.filter((c) => isTrump(c, suit)).length;
    p.classList.add('box');
    p.append(
      h(
        'div.eu-head',
        h('strong', h('span', { html: suitIcon(suit) }), `${SUIT_NAMES[suit]} as trump — ${question}`),
        h('small', `The ${cardName(up)} goes to ${dealer === me ? 'you' : this.name(dealer)}. You hold ${count} ${SUIT_NAMES[suit].toLowerCase()} (counting the left bower).`),
      ),
      h(
        'div.eu-actions',
        h('button.btn.ghost.big', { onclick: () => this.act({ type: 'pass' }) }, 'Pass'),
        h('button.btn.gold.big', { onclick: () => this.act({ type: 'order', alone: this.aloneToggle && v.options.allowAlone !== false }) }, dealer === me ? 'Pick it up' : 'Order it up'),
        this.aloneButton(),
      ),
    );
  }

  callPanel(p) {
    const v = this.view;
    const banned = naturalSuit(v.turnedDown);
    const stuck = v.options.stickDealer && v.dealer === this.mySeat;
    const hint = this.prefs.hints ? this.suggestion() : null;
    p.classList.add('box');
    p.append(
      h(
        'div.eu-head',
        h('strong', 'Name trump, or pass'),
        stuck ? h('small.warn', 'Stick the dealer: you have to name a suit.') : h('small', `${SUIT_NAMES[banned]} were turned down and can't be trump this hand.`),
      ),
      h(
        'div.eu-suits',
        SUITS.map((s) => {
          const n = v.hand.filter((c) => isTrump(c, s)).length;
          return h(
            `button.eu-suit-btn.${isRed(s) ? 'red' : 'black'}` + (hint?.type === 'call' && hint.suit === s ? '.best' : ''),
            { disabled: s === banned, onclick: () => this.act({ type: 'call', suit: s, alone: this.aloneToggle && v.options.allowAlone !== false }), 'aria-label': `Name ${SUIT_NAMES[s]} trump` },
            h('span', { html: suitIcon(s) }),
            SUIT_NAMES[s],
            h('small', s === banned ? 'turned down' : `${n} in hand`),
          );
        }),
      ),
      h('div.eu-actions', stuck ? null : h('button.btn.ghost', { onclick: () => this.act({ type: 'pass' }) }, 'Pass'), this.aloneButton()),
    );
  }

  discardPanel(p) {
    const v = this.view;
    const c = this.selected;
    p.classList.add('box');
    p.append(
      h('div.eu-head', h('strong', `You picked up the ${cardName(v.upcard)}`), h('small', 'Tap the card you want to put down. Nobody else sees it.')),
      h(
        'div.eu-actions',
        h('button.btn.ghost', { onclick: () => ((this.selected = bestDiscard(v.hand, v.trump)), sound.slide(), this.renderHand(), this.renderPanel()) }, 'Suggest'),
        h('button.btn.gold.big', { disabled: !c, onclick: () => c && this.act({ type: 'discard', card: c }) }, c ? `Discard ${shortName(c)}` : 'Pick a card'),
      ),
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
    const el = h('div.eu-card.flying' + (back ? '.back' : ''), {
      html: back ? cardBack() : flip ? `<div class="eu-flip"><div class="eu-f">${cardFace(card)}</div><div class="eu-b">${cardBack()}</div></div>` : cardFace(card),
    });
    const T = (p, rot, sc) => `translate(${p.x - this.cw / 2}px, ${p.y - this.ch / 2}px) rotate(${rot}deg) scale(${sc})`;
    el.style.transform = T(from, fromRot, fromScale);
    this.flyLayer.append(el);
    const d = dur * this.speed;
    const anim = el.animate([{ transform: T(from, fromRot, fromScale) }, { transform: T(to, toRot, toScale) }], {
      duration: d,
      delay: delay * this.speed,
      easing: 'cubic-bezier(.22,.8,.26,1)',
      fill: 'both',
    });
    if (flip) {
      el.firstChild.animate([{ transform: 'rotateY(180deg)' }, { transform: 'rotateY(0deg)' }], { duration: d * 0.8, delay: delay * this.speed + d * 0.1, easing: 'ease-in-out', fill: 'both' });
    }
    await anim.finished.catch(() => {});
    if (!keep) el.remove();
    return el;
  }

  // Cards fly from the dealer, three then two (or two then three) to each seat, then the
  // up-card turns over on the kitty.
  async dealAnimation(v) {
    if (this.dead) return;
    this.dealing = true;
    this.renderSeats();
    this.renderHud();
    this.renderOpp([0, 0, 0, 0]);
    this.trickEl.replaceChildren();
    this.renderKitty();
    this.renderHand();
    this.panel.replaceChildren();
    sound.shuffle();
    await this.wait(500);
    const from = this.seatPoint(v.dealer);
    const center = this.centerPoint();
    const shown = [0, 0, 0, 0];
    const flights = [];
    let k = 0;
    for (const pass of [0, 1]) {
      for (let i = 1; i <= 4; i++) {
        const s = (v.dealer + i) % 4;
        const n = (i % 2 === 1) === (pass === 0) ? 3 : 2;
        for (let j = 0; j < n; j++) {
          const delay = k * 55;
          k++;
          flights.push(
            this.fly(null, from, this.seatPoint(s), { back: true, dur: 300, delay, fromScale: 0.55, toScale: s === this.mySeat ? 0.8 : 0.56, toRot: this.pos(s) === 'left' || this.pos(s) === 'right' ? 90 : 0 }).then(() => {
              shown[s]++;
              if (s !== this.mySeat && !this.dead) this.oppHands[POS.indexOf(this.pos(s))].replaceChildren(...this.backFan(s, shown[s]));
            }),
          );
        }
      }
    }
    sound.deal(10);
    this.later(() => sound.deal(10), 550 * this.speed);
    await Promise.all(flights);
    // the kitty lands in the middle and the top card turns over
    await this.fly(null, from, center, { back: true, dur: 280, fromScale: 0.55 });
    this.dealing = false;
    this.handEl.classList.add('dealt');
    this.renderAll();
    this.later(() => this.handEl.classList.remove('dealt'), 900);
    sound.card();
    await this.wait(400);
    this.tick(`${this.name(v.dealer)} ${v.dealer === this.mySeat ? 'turn' : 'turns'} up the ${cardName(v.upcard)}`);
  }

  // the up-card goes to the dealer's hand
  async pickUpAnimation(prev, next) {
    const dealer = next.dealer;
    const upEl = this.kittyEl.querySelector('.eu-card.up');
    const from = upEl ? this.rel(upEl) : this.centerPoint();
    upEl?.remove();
    sound.slide();
    await this.fly(next.upcard, from, this.seatPoint(dealer), { dur: 520, fromRot: 4, toScale: dealer === this.mySeat ? 1 : 0.56, back: false });
    if (dealer === this.mySeat) this.newCard = next.upcard;
  }

  async discardAnimation(prev, next, seat, action) {
    const to = this.centerPoint();
    if (seat === this.mySeat && action.card) {
      const el = this.handEl.querySelector(`[data-card="${action.card}"]`);
      const from = el ? this.rel(el) : this.seatPoint(seat);
      if (el) el.style.visibility = 'hidden';
      sound.slide();
      await this.fly(action.card, from, { x: to.x + 5, y: to.y - 5 }, { dur: 420, toRot: 10 });
    } else {
      const fan = this.oppHands[POS.indexOf(this.pos(seat))];
      fan.lastElementChild?.remove();
      sound.slide();
      await this.fly(null, this.seatPoint(seat), { x: to.x + 5, y: to.y - 5 }, { back: true, dur: 420, fromScale: 0.56, toRot: 10 });
    }
    this.newCard = null;
    this.discardShown = true;
    this.renderKitty();
    await this.wait(300);
    this.discardShown = false;
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
      this.oppHands[POS.indexOf(this.pos(seat))].lastElementChild?.remove();
    }
    sound.card();
    this.newCard = null;
    await this.fly(card, from, to, { dur: 420, fromRot: seat === this.mySeat ? 0 : this.pos(seat) === 'top' ? 180 : 90, toRot: this.tilt(card), flip });

    const active = prev.sittingOut == null ? 4 : 3;
    const plays = [...prev.trick.plays, { seat, card }];
    const completes = plays.length === active;
    // show the card in place (keep the old view for everything else until the trick is swept)
    this.view = { ...prev, hand: seat === this.mySeat ? prev.hand.filter((x) => x !== card) : prev.hand, handSizes: next.handSizes, trick: { ...prev.trick, plays }, turn: completes ? null : next.turn };
    this.renderTrick(plays);
    this.renderHand();
    this.renderSeats();
    if (!completes) {
      // a trump on a side-suit lead is worth a word
      const led = suitOf(plays[0].card, prev.trump);
      if (plays.length > 1 && isTrump(card, prev.trump) && led !== prev.trump) this.tick(`${this.says(seat, 'trump', 'trumps')} in with the ${cardName(card, prev.trump)}`);
      this.view = next;
      this.renderSeats();
      this.renderHud();
      return;
    }
    const winner = next.lastTrick?.winner ?? winnerOf(plays, prev.trump);
    await this.wait(520);
    this.trickEl.querySelector(`[data-seat="${winner}"]`)?.classList.add('taker');
    this.tick(`${this.says(winner, 'take', 'takes')} the trick with the ${cardName(plays.find((p) => p.seat === winner).card, prev.trump)}`);
    await this.wait(760);
    await this.sweep(winner, teamOf(winner) === this.myTeam());
    this.view = next;
    this.renderAll();
    if (next.phase === 'score' || next.phase === 'over') {
      await this.wait(350);
      this.showSummary(next);
    }
  }

  async sweep(winner, good) {
    const target = this.seatPoint(winner);
    const cards = [...this.trickEl.children];
    sound.sweep();
    const anims = cards.map((el) => {
      const r = this.rel(el);
      const card = el.dataset.card;
      el.remove();
      return this.fly(card, r, target, { dur: 460, fromRot: this.tilt(card), toRot: this.tilt(card) * 2 + 90, toScale: 0.42 });
    });
    this.floatText(target, '+1 trick', good ? 'good' : 'bad');
    await Promise.all(anims);
  }

  floatText(at, text, kind = '') {
    const el = h('div.eu-float' + (kind ? '.' + kind : ''), text);
    el.style.left = at.x + 'px';
    el.style.top = at.y + 'px';
    this.flyLayer.append(el);
    this.later(() => el.remove(), 1600);
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
    const b = h('div.eu-chat-bubble', m.text);
    this.seatEl(seat).append(b);
    this.later(() => b.remove(), 4200);
  }

  key(e) {
    if (e.target.closest('input, textarea')) return;
    const v = this.view;
    if (!v || !this.myTurn() || this.pending) return;
    if ((v.phase === 'play' || v.phase === 'discard') && /^[1-6]$/.test(e.key)) {
      const card = v.hand[Number(e.key) - 1];
      if (card && this.legalSet().has(card)) this.clickCard(card);
    }
    if (v.phase === 'discard' && e.key === 'Enter' && this.selected) this.act({ type: 'discard', card: this.selected });
    if (v.phase === 'score' && (e.key === 'Enter' || e.key === ' ')) this.ready();
  }

  // ------------------------------------------------------------------
  // Modals
  // ------------------------------------------------------------------
  openModal(content, size = '') {
    this.overlay.replaceChildren(h('div.eu-modal' + (size ? '.' + size : ''), content));
    this.overlay.classList.add('open');
  }
  closeModal() {
    this.overlay.classList.remove('open');
    this.overlay.replaceChildren();
    clearInterval(this.countdown);
  }

  ready() {
    if (this.view.phase === 'score' && this.mySeat != null && !this.view.ready[this.mySeat]) this.act({ type: 'ready' });
  }

  showSummary(v) {
    const r = v.lastRound;
    if (!r) return;
    const us = this.myTeam();
    const them = 1 - us;
    const makers = teamOf(r.maker);
    const scorer = r.change[0] ? 0 : 1;
    const good = scorer === us;
    const over = v.phase === 'over';
    if (over) (v.winner === us ? sound.win : sound.bad)();
    else (good ? sound.good : sound.bad)();

    const pts = r.change[scorer];
    let headline;
    if (over) headline = v.winner === us ? (this.mySeat == null ? `${this.teamName(us)} win!` : 'You win the game!') : `${this.teamName(them)} win the game`;
    else if (r.result === 'euchre') headline = `Euchred! ${this.teamName(makers)} took only ${r.taken[makers]}`;
    else if (r.result === 'alone-march') headline = `${this.name(r.maker)} went alone and took all five!`;
    else if (r.result === 'march') headline = `March! ${this.teamName(makers)} took all five`;
    else headline = `${this.teamName(makers)} made it with ${r.taken[makers]} tricks`;
    const sign = (x) => (x > 0 ? `+${x}` : '—');
    const row = (label, a, b, cls = '') => h('tr' + (cls ? '.' + cls : ''), h('th', label), h('td', a), h('td', b));
    const recap = r.tricks.map((t, i) =>
      h(
        'div.eu-recap-trick.' + (teamOf(t.winner) === us ? 'us' : 'them'),
        h('div.eu-mini-row', t.plays.map((p) => h('div.eu-card.mini' + (p.seat === t.winner ? '.won' : ''), { html: cardFace(p.card), title: `${this.name(p.seat)}: ${cardName(p.card, r.trump)}` }))),
        h('small', `${i + 1}. ${this.name(t.winner)}`),
      ),
    );
    const body = h(
      'div.eu-summary',
      over ? h('div.eu-confetti', Array.from({ length: 40 }, (_, i) => h('i', { style: { '--i': i, '--h': (i * 47) % 360 } }))) : null,
      h('div.eu-banner.' + (good ? 'good' : 'bad'), h('small', over ? 'Game over' : `Hand ${r.round}`), h('h2', headline), !over ? h('div.eu-big-pts', `+${pts} for ${scorer === us ? 'us' : 'them'}`) : null),
      h(
        'p.eu-sub',
        h('span', { html: suitIcon(r.trump) }),
        `${SUIT_NAMES[r.trump]} · called by ${this.name(r.maker)}${r.alone ? ' (alone)' : ''} · ${this.name(r.dealer)} dealt`,
      ),
      h(
        'table.eu-table',
        h('thead', h('tr', h('th', ''), h('th.us', 'Us'), h('th.them', 'Them'))),
        h('tbody', row('Tricks', r.taken[us], r.taken[them]), row('Points', sign(r.change[us]), sign(r.change[them]), 'change'), row('Score', r.scores[us], r.scores[them], 'total')),
      ),
      h('div.eu-recap', recap),
      over ? this.gameOverButtons() : this.readyRow(v),
    );
    this.openModal(body, over ? 'wide' : '');
    if (!over && this.prefs.autoContinue && this.mySeat != null && !v.ready[this.mySeat]) {
      let n = 8;
      const btn = this.overlay.querySelector('.eu-continue');
      clearInterval(this.countdown);
      this.countdown = setInterval(() => {
        if (this.dead) return clearInterval(this.countdown);
        n--;
        if (btn && !btn.disabled) btn.textContent = `Continue (${n})`;
        if (n <= 0) {
          clearInterval(this.countdown);
          this.ready();
        }
      }, 1000);
    }
  }

  readyRow(v) {
    return h(
      'div.eu-ready',
      h('div.eu-ready-seats', [0, 1, 2, 3].map((s) => h('span.eu-ready-dot' + (v.ready[s] ? '.ok' : ''), { title: this.name(s) }, this.name(s).slice(0, 1)))),
      this.mySeat != null
        ? h('button.btn.gold.big.eu-continue', { onclick: () => (clearInterval(this.countdown), this.ready()), disabled: v.ready[this.mySeat] }, v.ready[this.mySeat] ? 'Waiting for others…' : 'Continue')
        : h('small', 'Watching'),
    );
  }

  updateReady(v) {
    const row = this.overlay.querySelector('.eu-ready');
    if (row) row.replaceWith(this.readyRow(v));
  }

  gameOverButtons() {
    return h(
      'div.eu-actions',
      h('button.btn.ghost.big', { onclick: () => this.ctx.leave() }, 'Game Center'),
      this.client.isHost ? h('button.btn.gold.big', { onclick: () => this.client.send({ t: 'rematch' }) }, 'Play again') : h('small', 'Waiting for the host to start a new game'),
    );
  }

  showLastTrick() {
    const t = this.view.lastTrick;
    if (!t) return;
    const trump = this.view.trump;
    const body = h(
      'div.eu-last',
      h('h3', 'Last trick'),
      h('div.eu-last-row', t.plays.map((p) => h('div.eu-last-card' + (p.seat === t.winner ? '.won' : ''), h('div.eu-card.mid', { html: cardFace(p.card) }), h('small', this.name(p.seat))))),
      h('p', `${this.says(t.winner, 'take', 'takes')} it with the ${cardName(t.plays.find((p) => p.seat === t.winner).card, trump)}.`),
      h('button.btn.gold', { onclick: () => this.closeModal() }, 'Close'),
    );
    this.openModal(body, 'small');
  }

  showScoreSheet() {
    const v = this.view;
    const us = this.myTeam();
    const sign = (x) => (x > 0 ? `+${x}` : '');
    const rows = v.history.map((r) =>
      h(
        'tr',
        h('td', r.round),
        h('td', h('span', { html: suitIcon(r.trump) }), ` ${this.name(r.maker)}${r.alone ? ' · alone' : ''}`),
        h('td', `${r.taken[us]}–${r.taken[1 - us]}`),
        h('td.' + (r.change[us] ? 'good' : 'bad'), r.result === 'euchre' ? 'Euchre' : r.result === 'made' ? 'Made' : r.result === 'march' ? 'March' : 'Loner'),
        h('td', sign(r.change[us])),
        h('td', sign(r.change[1 - us])),
        h('td', `${r.scores[us]} – ${r.scores[1 - us]}`),
      ),
    );
    const o = v.options;
    const body = h(
      'div.eu-sheet',
      h('h3', 'Score sheet'),
      h('p.eu-sub', `First to ${o.winScore} · ${o.stickDealer ? 'stick the dealer' : 'all pass: deal again'} · going alone ${o.allowAlone === false ? 'off' : 'on'}`),
      rows.length
        ? h('div.eu-sheet-scroll', h('table.eu-table.sheet', h('thead', h('tr', h('th', '#'), h('th', 'Trump'), h('th', 'Tricks'), h('th', ''), h('th.us', 'Us'), h('th.them', 'Them'), h('th', 'Score'))), h('tbody', rows)))
        : h('p', 'No hands finished yet.'),
      h('button.btn.gold', { onclick: () => this.closeModal() }, 'Close'),
    );
    this.openModal(body, 'wide');
  }
}

function winnerOf(plays, trump) {
  if (!plays.length) return null;
  const led = suitOf(plays[0].card, trump);
  return plays.reduce((b, p) => (power(p.card, trump, led) > power(b.card, trump, led) ? p : b)).seat;
}

// The legal moves for this view (the same list the engine would give the host).
function legalFor(v) {
  const alone = v.options.allowAlone !== false;
  switch (v.phase) {
    case 'order':
      return [{ type: 'pass' }, { type: 'order', alone: false }, ...(alone ? [{ type: 'order', alone: true }] : [])];
    case 'call': {
      const out = v.options.stickDealer && v.seat === v.dealer ? [] : [{ type: 'pass' }];
      for (const suit of SUITS) {
        if (suit === naturalSuit(v.turnedDown)) continue;
        out.push({ type: 'call', suit, alone: false });
        if (alone) out.push({ type: 'call', suit, alone: true });
      }
      return out;
    }
    case 'discard':
      return v.hand.map((card) => ({ type: 'discard', card }));
    case 'play':
      return legalPlays(v.hand, v.trick, v.trump).map((card) => ({ type: 'play', card }));
    default:
      return [];
  }
}

const ICONS = {
  last: '<svg viewBox="0 0 24 24"><rect x="4" y="6" width="9" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><rect x="10" y="4" width="9" height="13" rx="2" fill="currentColor" opacity=".35"/><path d="M14 20l3-3-3-3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  sheet: '<svg viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 8h8M8 12h8M8 16h5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  bulb: '<svg viewBox="0 0 24 24"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
};

