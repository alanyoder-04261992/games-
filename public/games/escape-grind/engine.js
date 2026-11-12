// Escape the Grind — rules engine. Plain functions, no DOM; the host runs these.
// Everyone starts in a job on the inner loop (the Grind). Buy assets that pay you every month.
// When your passive income is bigger than your monthly expenses you break out to the outer
// loop (the Freedom Ring). There, buy your Dream or add $50,000 a month of new income to win.
import {
  JOBS, GRIND, RING, DREAMS, STOCKS,
  smallDeals, bigDeals, marketCards, splurgeCards, ventureCards, setbackCards,
} from './cards.js';

export const DECKS = {
  small: smallDeals(),
  big: bigDeals(),
  market: marketCards(),
  splurge: splurgeCards(),
  venture: ventureCards(),
  setback: setbackCards(),
};
export const SEATS = 4;
export const FREEDOM_GOAL = 50000;
const LENGTHS = { quick: 40, standard: 80, long: 400 };

// ---------------------------------------------------------------------------------------------
// random numbers (seeded, kept in the state so games replay exactly)
// ---------------------------------------------------------------------------------------------
function rand(s) {
  let t = (s.rng = (s.rng + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const die = (s) => 1 + Math.floor(rand(s) * 6);
function shuffled(s, n) {
  const a = [...Array(n).keys()];
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand(s) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function draw(s, deck) {
  if (!s.decks[deck].length) s.decks[deck] = shuffled(s, DECKS[deck].length);
  return { ...structuredClone(DECKS[deck][s.decks[deck].pop()]), deck };
}

// ---------------------------------------------------------------------------------------------
// money math
// ---------------------------------------------------------------------------------------------
export const money = (n) => (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US');
export function passive(p) {
  return p.assets.reduce((t, a) => t + (a.flow || 0), 0);
}
export function bankPayment(p) {
  return Math.round(p.bank * 0.1);
}
export function expenses(p) {
  let t = 0;
  for (const v of Object.values(p.exp)) t += v;
  return t + p.children * p.perChild + bankPayment(p);
}
export function income(p) {
  return p.salary + passive(p);
}
export function cashflow(p) {
  return income(p) - expenses(p);
}
export function netWorth(p) {
  let w = p.cash - p.bank;
  for (const d of Object.values(p.debts)) if (d) w -= d.balance;
  for (const a of p.assets) w += (a.cost || 0) - (a.mortgage || 0);
  for (const [sym, n] of Object.entries(p.stocks)) w += n * (p.stockPrice?.[sym] ?? 0);
  for (const v of p.ventures || []) w += v.cost;
  return w;
}
export function freedomProgress(p) {
  if (p.track !== 'free') return Math.min(1, passive(p) / Math.max(1, expenses(p)));
  return Math.min(1, (p.freeFlow - p.freeStart) / FREEDOM_GOAL);
}

function log(s, seat, text, kind = '') {
  s.log.push({ seq: s.seq, seat, text, kind });
  if (s.log.length > 40) s.log.shift();
}

// Pay a bill. On the Grind the bank covers what you can't (a loan in $1,000 steps, 10%/month).
function pay(s, p, amount, what) {
  if (p.cash >= amount) {
    p.cash -= amount;
    return 0;
  }
  if (p.track === 'free') {
    p.cash = 0;
    return 0;
  }
  const loan = Math.ceil((amount - p.cash) / 1000) * 1000;
  p.bank += loan;
  p.cash += loan - amount;
  log(s, p.seat, `borrowed ${money(loan)} from the bank to pay for ${what}`, 'bad');
  return loan;
}

// ---------------------------------------------------------------------------------------------
// setup
// ---------------------------------------------------------------------------------------------
function newPlayer(seat, job) {
  return {
    seat,
    job: job.id,
    jobName: job.name,
    salary: job.salary,
    perChild: job.perChild,
    children: 0,
    exp: { ...job.expenses },
    debts: Object.fromEntries(Object.entries(job.debts).filter(([, d]) => d).map(([k, d]) => [k, { label: d.label, balance: d.balance }])),
    bank: 0,
    cash: 0,
    assets: [],
    stocks: {},
    stockCost: {},
    stockPrice: {},
    pos: 0,
    track: 'grind',
    laidOff: 0,
    charity: 0,
    freeFlow: 0,
    freeStart: 0,
    ventures: [],
    nextId: 1,
    escapedRound: null,
  };
}

export function setup({ seed = 1, options = {} } = {}) {
  const s = {
    seq: 0,
    rng: seed >>> 0 || 1,
    round: 1,
    maxRounds: LENGTHS[options.length] || LENGTHS.standard,
    turn: 0,
    phase: 'roll',
    players: [],
    decks: {},
    card: null,
    market: null,
    lastRoll: null,
    log: [],
    winner: null,
    winReason: null,
  };
  for (const k of Object.keys(DECKS)) s.decks[k] = shuffled(s, DECKS[k].length);
  const jobs = shuffled(s, JOBS.length);
  for (let i = 0; i < SEATS; i++) {
    const p = newPlayer(i, JOBS[jobs[i]]);
    p.cash = JOBS[jobs[i]].savings + cashflow(p);
    s.players.push(p);
  }
  s.turn = s.first = Math.floor(rand(s) * SEATS);
  log(s, null, 'Everyone starts in the Grind. Build passive income bigger than your expenses to break free.');
  return s;
}

// ---------------------------------------------------------------------------------------------
// whose move, and which moves
// ---------------------------------------------------------------------------------------------
export function actors(s) {
  if (s.phase === 'over') return [];
  if (s.phase === 'market') return s.market.queue.length ? [s.market.queue[0]] : [];
  return [s.turn];
}

const STOCK_LOTS = [10, 50, 100, 200, 500, 1000, 2000, 5000];
const BORROW_STEPS = [1000, 5000, 10000, 25000];

export function matches(asset, card) {
  if (card.cat === 'estate') return asset.kind === 'estate';
  return asset.cat === card.cat;
}
export function offerValue(asset, card) {
  if (card.price != null) return card.price;
  if (card.perUnit != null) return card.perUnit * (asset.units || 1);
  return Math.round((asset.cost * card.mult) / 100) * 100;
}

export function legal(s, seat) {
  if (!actors(s).includes(seat)) return [];
  const p = s.players[seat];
  const out = [];
  switch (s.phase) {
    case 'roll': {
      if (p.track === 'free') out.push({ type: 'roll', dice: 2 });
      else {
        out.push({ type: 'roll', dice: 1 });
        if (p.charity > 0) out.push({ type: 'roll', dice: 2 });
        for (const [k, d] of Object.entries(p.debts)) if (d && d.balance <= p.cash) out.push({ type: 'payoff', key: k });
        for (const a of BORROW_STEPS) out.push({ type: 'borrow', amount: a });
        if (p.bank > 0) {
          for (const a of [1000, 5000, p.bank]) if (a <= p.bank && a <= p.cash) out.push({ type: 'repay', amount: a });
        }
      }
      break;
    }
    case 'pick':
      out.push({ type: 'pick', size: 'small' }, { type: 'pick', size: 'big' });
      break;
    case 'deal': {
      const c = s.card;
      if (c.type === 'stock') {
        for (const q of STOCK_LOTS) if (q * c.price <= p.cash) out.push({ type: 'buy', qty: q });
        const own = p.stocks[c.sym] || 0;
        if (own > 0) {
          out.push({ type: 'sell', qty: own });
          if (own >= 20) out.push({ type: 'sell', qty: Math.floor(own / 2) });
        }
      } else if (c.type === 'asset') {
        if (p.cash >= c.down) out.push({ type: 'buy' });
        else out.push({ type: 'buy', loan: Math.ceil((c.down - p.cash) / 1000) * 1000 });
      }
      out.push({ type: 'pass' });
      break;
    }
    case 'charity':
      out.push({ type: 'donate' }, { type: 'skip' });
      break;
    case 'market': {
      for (const a of p.assets) if (matches(a, s.market.card)) out.push({ type: 'sell', id: a.id });
      out.push({ type: 'keep' });
      break;
    }
    case 'venture':
    case 'dream':
      if (p.cash >= s.card.cost) out.push({ type: 'buy' });
      out.push({ type: 'pass' });
      break;
  }
  return out;
}

// Custom amounts (any share count, any loan in $1,000s) are allowed beyond the listed moves.
export function check(s, seat, m) {
  if (!m || typeof m !== 'object') return 'Bad move';
  if (!actors(s).includes(seat)) return 'It is not your turn';
  const p = s.players[seat];
  const int = (n) => Number.isInteger(n) && n > 0;
  if (s.phase === 'roll' && m.type === 'borrow') {
    if (p.track !== 'grind') return 'The bank only lends on the Grind';
    return int(m.amount) && m.amount % 1000 === 0 && m.amount <= 500000 ? null : 'Borrow in $1,000 steps';
  }
  if (s.phase === 'roll' && m.type === 'repay') {
    if (!int(m.amount) || m.amount > p.bank) return 'You do not owe that much';
    if (m.amount > p.cash) return 'Not enough cash';
    return m.amount % 1000 === 0 || m.amount === p.bank ? null : 'Repay in $1,000 steps';
  }
  if (s.phase === 'deal' && s.card?.type === 'stock' && m.type === 'buy') {
    return int(m.qty) && m.qty * s.card.price <= p.cash ? null : 'Not enough cash for that many shares';
  }
  if (s.phase === 'deal' && s.card?.type === 'stock' && m.type === 'sell') {
    return int(m.qty) && m.qty <= (p.stocks[s.card.sym] || 0) ? null : 'You do not own that many shares';
  }
  const ok = legal(s, seat).some((x) => sameMove(x, m));
  return ok ? null : 'That move is not allowed right now';
}
function sameMove(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if (a[k] !== b[k]) return false;
  return true;
}

// ---------------------------------------------------------------------------------------------
// applying a move
// ---------------------------------------------------------------------------------------------
export function apply(prev, seat, m) {
  const err = check(prev, seat, m);
  if (err) throw new Error(err);
  const s = structuredClone(prev);
  s.seq++;
  const p = s.players[seat];
  switch (s.phase) {
    case 'roll':
      if (m.type === 'roll') roll(s, p, m.dice);
      else if (m.type === 'payoff') {
        const d = p.debts[m.key];
        p.cash -= d.balance;
        p.exp[m.key] = 0;
        p.debts[m.key] = null;
        log(s, seat, `paid off the ${d.label.toLowerCase()} (${money(d.balance)})`, 'good');
        checkEscape(s, p);
      } else if (m.type === 'borrow') {
        p.bank += m.amount;
        p.cash += m.amount;
        log(s, seat, `took a ${money(m.amount)} bank loan`);
      } else if (m.type === 'repay') {
        p.bank -= m.amount;
        p.cash -= m.amount;
        log(s, seat, `paid back ${money(m.amount)} of bank loans`, 'good');
        checkEscape(s, p);
      }
      break;
    case 'pick': {
      const c = draw(s, m.size);
      s.cardSeq = s.seq;
      if (c.type === 'split') {
        for (const q of s.players) {
          if (!q.stocks[c.sym]) continue;
          q.stocks[c.sym] = Math.floor(q.stocks[c.sym] * c.factor);
          if (q.stockCost[c.sym]) q.stockCost[c.sym] = q.stockCost[c.sym] / c.factor;
        }
        s.card = c;
        log(s, seat, `drew “${c.name}”`);
        s.phase = 'deal';
        s.card.done = true;
        endTurn(s);
      } else {
        s.card = c;
        s.phase = 'deal';
        log(s, seat, `drew a ${m.size === 'big' ? 'Big' : 'Small'} Deal: ${c.name}`);
      }
      break;
    }
    case 'deal':
      deal(s, p, m);
      break;
    case 'charity':
      if (m.type === 'donate') {
        const amt = Math.round(income(p) * 0.1);
        pay(s, p, amt, 'a donation');
        p.charity = 3;
        log(s, seat, `gave ${money(amt)} to charity and may roll two dice for 3 turns`, 'good');
      } else log(s, seat, 'decided not to give this time');
      endTurn(s);
      break;
    case 'market': {
      const card = s.market.card;
      if (m.type === 'sell') {
        const i = p.assets.findIndex((a) => a.id === m.id);
        const a = p.assets[i];
        const value = offerValue(a, card);
        const net = value - (a.mortgage || 0);
        p.assets.splice(i, 1);
        p.cash += net;
        s.market.sales.push({ seat, id: a.id, model: a.model });
        log(s, seat, `sold ${a.name} for ${money(value)} and kept ${money(net)} after the loan`, net > a.down ? 'good' : '');
        if (!p.assets.some((x) => matches(x, card))) s.market.queue.shift();
      } else s.market.queue.shift();
      if (!s.market.queue.length) endTurn(s);
      break;
    }
    case 'venture':
      if (m.type === 'buy') {
        p.cash -= s.card.cost;
        p.freeFlow += s.card.flow;
        p.ventures.push({ name: s.card.name, cost: s.card.cost, flow: s.card.flow });
        log(s, seat, `bought ${s.card.name} for ${money(s.card.cost)}: +${money(s.card.flow)} a month`, 'good');
        if (p.freeFlow - p.freeStart >= FREEDOM_GOAL) return win(s, p, `added ${money(p.freeFlow - p.freeStart)} a month of new income`);
      } else log(s, seat, `passed on ${s.card.name}`);
      endTurn(s);
      break;
    case 'dream':
      if (m.type === 'buy') {
        p.cash -= s.card.cost;
        log(s, seat, `bought their dream: ${s.card.name}!`, 'win');
        return win(s, p, `bought their dream — ${s.card.name}`);
      }
      log(s, seat, `passed on the ${s.card.name}`);
      endTurn(s);
      break;
  }
  return s;
}

function roll(s, p, n) {
  const dice = [die(s)];
  if (n === 2) dice.push(die(s));
  if (p.track === 'grind' && p.charity > 0) p.charity--;
  const steps = dice[0] + (dice[1] || 0);
  const board = p.track === 'free' ? RING : GRIND;
  const from = p.pos;
  const paydays = [];
  for (let i = 1; i <= steps; i++) {
    p.pos = (p.pos + 1) % board.length;
    if (board[p.pos] === 'pay') {
      const cf = cashflow(p);
      if (cf >= 0) p.cash += cf;
      else pay(s, p, -cf, 'a short month');
      paydays.push({ pos: p.pos, amount: cf });
      log(s, p.seat, `Payday: ${cf >= 0 ? '+' : ''}${money(cf)}`, cf >= 0 ? 'good' : 'bad');
    } else if (board[p.pos] === 'fpay') {
      p.cash += p.freeFlow;
      paydays.push({ pos: p.pos, amount: p.freeFlow });
      log(s, p.seat, `Freedom Payday: +${money(p.freeFlow)}`, 'good');
    }
  }
  s.lastRoll = { seq: s.seq, seat: p.seat, dice, from, to: p.pos, track: p.track, paydays };
  s.card = null;
  land(s, p);
}

function land(s, p) {
  const seat = p.seat;
  if (p.track === 'free') {
    const kind = RING[p.pos];
    if (kind === 'ven') {
      s.card = draw(s, 'venture');
      s.cardSeq = s.seq;
      s.phase = 'venture';
      return;
    }
    if (kind === 'drm') {
      const idx = RING.slice(0, p.pos + 1).filter((k) => k === 'drm').length - 1;
      s.card = { type: 'dream', deck: 'dream', ...DREAMS[idx % DREAMS.length] };
      s.cardSeq = s.seq;
      s.phase = 'dream';
      return;
    }
    if (kind === 'set') {
      const c = draw(s, 'setback');
      s.card = { ...c, done: true };
      s.cardSeq = s.seq;
      const loss = c.half ? Math.floor(p.cash / 2) : Math.min(p.cash, c.amount);
      p.cash -= loss;
      log(s, seat, `${c.name}: lost ${money(loss)}`, 'bad');
    }
    return endTurn(s);
  }
  const kind = GRIND[p.pos];
  switch (kind) {
    case 'opp':
      s.phase = 'pick';
      return;
    case 'mkt': {
      const c = draw(s, 'market');
      s.card = c;
      s.cardSeq = s.seq;
      log(s, seat, `Market: ${c.name}`);
      if (c.type === 'offer') {
        const queue = [];
        for (let k = 0; k < SEATS; k++) {
          const q = s.players[(seat + k) % SEATS];
          if (q.track === 'grind' && q.assets.some((a) => matches(a, c))) queue.push(q.seat);
        }
        if (queue.length) {
          s.market = { card: c, queue, sales: [] };
          s.phase = 'market';
          return;
        }
      } else if (c.type === 'boom') {
        for (const q of s.players)
          for (const a of q.assets)
            if (q.track === 'grind' && a.cat === c.cat) {
              a.flow += c.flow;
              log(s, q.seat, `${a.name} now earns ${money(a.flow)} a month`, 'good');
            }
        for (const q of s.players) checkEscape(s, q);
      } else if (c.type === 'repair') {
        for (const q of s.players)
          if (q.track === 'grind' && q.assets.some((a) => matches(a, c))) {
            pay(s, q, c.amount, c.name.toLowerCase());
            log(s, q.seat, `paid ${money(c.amount)} for ${c.name.toLowerCase()}`, 'bad');
          }
      }
      s.card.done = true;
      return endTurn(s);
    }
    case 'spl': {
      const c = draw(s, 'splurge');
      s.card = { ...c, done: true };
      s.cardSeq = s.seq;
      pay(s, p, c.amount, c.name.toLowerCase());
      log(s, seat, `Splurge: ${c.name} (${money(c.amount)})`, 'bad');
      return endTurn(s);
    }
    case 'chr':
      s.phase = 'charity';
      return;
    case 'kid':
      if (p.children < 3) {
        p.children++;
        log(s, seat, `welcomed a new baby! Expenses go up ${money(p.perChild)} a month`, 'baby');
      } else log(s, seat, 'already has a full house — no new baby');
      return endTurn(s);
    case 'lay': {
      const bill = expenses(p);
      pay(s, p, bill, 'bills while laid off');
      p.laidOff = 2;
      log(s, seat, `was laid off: paid ${money(bill)} in bills and sits out 2 turns`, 'bad');
      return endTurn(s);
    }
    default:
      return endTurn(s);
  }
}

function deal(s, p, m) {
  const c = s.card;
  if (m.type === 'pass') {
    log(s, p.seat, `passed on ${c.name}`);
  } else if (c.type === 'stock') {
    p.stockPrice[c.sym] = c.price;
    if (m.type === 'buy') {
      const own = p.stocks[c.sym] || 0;
      p.stockCost[c.sym] = ((p.stockCost[c.sym] || 0) * own + c.price * m.qty) / (own + m.qty);
      p.stocks[c.sym] = own + m.qty;
      p.cash -= c.price * m.qty;
      log(s, p.seat, `bought ${m.qty.toLocaleString('en-US')} shares of ${c.sym} at $${c.price}`);
    } else {
      p.stocks[c.sym] -= m.qty;
      p.cash += c.price * m.qty;
      const gain = (c.price - (p.stockCost[c.sym] || 0)) * m.qty;
      log(s, p.seat, `sold ${m.qty.toLocaleString('en-US')} shares of ${c.sym} at $${c.price} (${gain >= 0 ? 'gain' : 'loss'} ${money(Math.abs(gain))})`, gain >= 0 ? 'good' : 'bad');
      if (!p.stocks[c.sym]) {
        delete p.stocks[c.sym];
        delete p.stockCost[c.sym];
      }
    }
  } else if (c.type === 'asset') {
    if (m.loan) {
      p.bank += m.loan;
      p.cash += m.loan;
    }
    p.cash -= c.down;
    const a = { id: p.nextId++, kind: c.kind, name: c.name, cat: c.cat, model: c.model, cost: c.cost, down: c.down, mortgage: c.mortgage, flow: c.flow };
    if (c.units) a.units = c.units;
    if (c.count) a.count = c.count;
    p.assets.push(a);
    log(s, p.seat, `bought ${c.name} for ${money(c.down)} down${c.flow ? `: ${c.flow > 0 ? '+' : ''}${money(c.flow)} a month` : ''}${m.loan ? ` (with a ${money(m.loan)} loan)` : ''}`, c.flow > 0 ? 'good' : '');
  }
  for (const q of s.players) if (c.type === 'stock' && q.stocks[c.sym]) q.stockPrice[c.sym] = c.price;
  s.card.done = true;
  endTurn(s);
}

function checkEscape(s, p) {
  if (p.track !== 'grind' || passive(p) <= expenses(p)) return;
  p.track = 'free';
  p.pos = 0;
  p.freeStart = p.freeFlow = Math.round((passive(p) * 10) / 1000) * 1000 + 20000;
  p.cash += p.freeFlow;
  p.escapedRound = s.round;
  p.laidOff = 0;
  log(s, p.seat, `broke out of the Grind! Freedom income ${money(p.freeFlow)} a month`, 'win');
}

function win(s, p, reason) {
  s.winner = p.seat;
  s.winReason = reason;
  s.phase = 'over';
  log(s, p.seat, `wins: ${reason}`, 'win');
  return s;
}

function endTurn(s) {
  for (const q of s.players) checkEscape(s, q);
  if (s.phase === 'over') return;
  s.market = null;
  for (let guard = 0; guard < SEATS * 4; guard++) {
    s.turn = (s.turn + 1) % SEATS;
    if (s.turn === s.first) s.round++;
    const n = s.players[s.turn];
    if (n.laidOff > 0) {
      n.laidOff--;
      log(s, n.seat, 'is laid off and sits this turn out', 'bad');
      continue;
    }
    break;
  }
  if (s.round > s.maxRounds) {
    const ranked = [...s.players].sort((a, b) => rank(b) - rank(a));
    s.winner = ranked[0].seat;
    s.winReason = 'was furthest along when time ran out';
    s.phase = 'over';
    log(s, ranked[0].seat, `wins on time: ${s.winReason}`, 'win');
    return;
  }
  s.phase = 'roll';
}
function rank(p) {
  if (p.track === 'free') return 1e9 + (p.freeFlow - p.freeStart) * 100 + p.cash;
  return freedomProgress(p) * 1e8 + netWorth(p);
}

export function view(s, seat) {
  const v = structuredClone(s);
  delete v.decks;
  delete v.rng;
  v.seat = seat;
  v.deckSizes = Object.fromEntries(Object.entries(s.decks).map(([k, d]) => [k, d.length]));
  return v;
}

export const isOver = (s) => s.phase === 'over';
export { GRIND, RING, DREAMS, STOCKS };
