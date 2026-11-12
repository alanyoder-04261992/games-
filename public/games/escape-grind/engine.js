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
// The real-life economy (advanced mode). A market index moves through a business cycle —
// expansion, boom, slowdown, recession, recovery — once per round. It moves stock prices, the
// price of every deal, what buyers will pay, small-business income and the bank's loan rate.
// The lesson: save cash in good times, buy when everything is on sale, sell into a boom.
// ---------------------------------------------------------------------------------------------
export const ECON = {
  expansion: {
    label: 'Expansion', color: '#2fb36a', drift: 2.5, biz: 1, rate: 0.08, next: 'boom', rounds: [3, 5],
    headline: 'The economy is growing again. Jobs are steady and prices are rising.',
    tip: 'Prices are fair. Buy deals with good cash flow, but start building a cash cushion for the next downturn.',
  },
  boom: {
    label: 'Boom', color: '#f0b429', drift: 5, biz: 1.15, rate: 0.12, next: 'slowdown', rounds: [2, 4],
    headline: 'BOOM! Stocks are soaring and buyers are paying top dollar.',
    tip: 'Everything costs more now. Sell to Market buyers and take stock profits. Borrowing is expensive — pay loans down.',
  },
  slowdown: {
    label: 'Slowdown', color: '#e2803c', drift: -3, biz: 1, rate: 0.1, next: 'recession', rounds: [2, 3],
    headline: 'The economy is cooling. Sales are slowing and stocks are slipping.',
    tip: 'Raise cash and avoid new debt. Experienced investors short stocks they expect to fall — you profit when the price drops.',
  },
  recession: {
    label: 'Recession', color: '#e2453c', drift: -7, biz: 0.75, rate: 0.05, next: 'recovery', rounds: [3, 4],
    headline: 'RECESSION. Stocks tumble, businesses struggle and prices are falling.',
    tip: 'Cash is king. Deals are on sale and loans are cheap — buy rentals and stocks at a discount. Cover your shorts for a profit.',
  },
  recovery: {
    label: 'Recovery', color: '#2f7fe0', drift: 5, biz: 0.9, rate: 0.06, next: 'expansion', rounds: [2, 4],
    headline: 'Recovery! The worst is over and prices are bouncing back.',
    tip: 'What you bought in the recession is gaining value. Loans are still cheap — a good time to grow.',
  },
};
const STOCK_MODEL = {
  OAK: { base: 15, beta: 1.6, vol: 0.06 },
  NPK: { base: 16, beta: 2.3, vol: 0.1 },
  CRL: { base: 18, beta: 0.8, vol: 0.04 },
  BMF: { base: 20, beta: 1, vol: 0.02 },
};
export const SHORT_MARGIN = 0.5;
const MAX_TRADES_PER_TURN = 8;

function newEconomy(s) {
  const e = { on: true, phase: 'expansion', left: 3 + Math.floor(rand(s) * 2), index: 100, history: [100], rate: 0.08, mult: 1, biz: 1, drift: {}, prices: {}, prev: {}, news: null };
  for (const sym of Object.keys(STOCK_MODEL)) e.drift[sym] = 1;
  setPrices(e);
  e.prev = { ...e.prices };
  return e;
}
function setPrices(e) {
  for (const [sym, m] of Object.entries(STOCK_MODEL)) e.prices[sym] = Math.max(1, Math.round(m.base * (e.index / 100) ** m.beta * e.drift[sym]));
}
// once a round, when the first player's turn comes back around
function stepEconomy(s) {
  const e = s.econ;
  if (!e?.on) return;
  const ph = ECON[e.phase];
  e.prev = { ...e.prices };
  const noise = (rand(s) - 0.5) * 2;
  e.index = Math.round(Math.max(45, Math.min(180, e.index * (1 + (ph.drift + noise * 3) / 100))) * 10) / 10;
  for (const [sym, m] of Object.entries(STOCK_MODEL)) e.drift[sym] = Math.max(0.5, Math.min(1.8, e.drift[sym] * Math.exp((rand(s) - 0.5) * 2 * m.vol)));
  if (--e.left <= 0) {
    e.phase = ph.next;
    const np = ECON[e.phase];
    e.left = np.rounds[0] + Math.floor(rand(s) * (np.rounds[1] - np.rounds[0] + 1));
    e.news = { seq: s.seq, phase: e.phase };
    log(s, null, np.headline, 'econ');
  }
  const cur = ECON[e.phase];
  e.rate = cur.rate;
  e.biz = cur.biz;
  e.mult = Math.round(Math.max(0.6, Math.min(1.45, 1 + (e.index - 100) * 0.009)) * 100) / 100;
  setPrices(e);
  e.history.push(e.index);
  if (e.history.length > 30) e.history.shift();
  syncEconomy(s);
  for (const p of s.players)
    for (const [sym, sh] of Object.entries(p.shorts)) {
      const loss = (e.prices[sym] - sh.price) * sh.qty;
      if (loss > 0 && loss > p.cash * 0.8) cover(s, p, sym, true);
    }
}
function syncEconomy(s) {
  const e = s.econ;
  for (const p of s.players) {
    p.loanRate = e.rate;
    p.bizMod = e.biz;
    Object.assign(p.stockPrice, e.prices);
  }
}
// deal prices follow the economy: on sale in a recession, expensive in a boom
function priced(s, c) {
  const e = s.econ;
  const label = ECON[e.phase].label;
  const r100 = (n) => Math.round(n / 100) * 100;
  if ((c.type === 'asset' || c.type === 'venture') && e.mult !== 1) {
    c.listCost = c.cost;
    c.cost = r100(c.cost * e.mult);
    if (c.type === 'asset') {
      c.down = Math.max(100, r100(c.down * e.mult));
      c.mortgage = c.cost - c.down;
    }
    c.econNote = e.mult < 1 ? `${label} sale: ${Math.round((1 - e.mult) * 100)}% off` : `${label} price: ${Math.round((e.mult - 1) * 100)}% above normal`;
  } else if (c.type === 'stock') {
    c.price = e.prices[c.sym];
    c.text = `${STOCKS[c.sym].note} Live market price: $${c.price} a share. Buy, or sell what you own.`;
  } else if (c.type === 'offer' && e.mult !== 1) {
    c.econ = e.mult;
    c.econNote = e.mult > 1 ? `${label}: buyers pay ${Math.round((e.mult - 1) * 100)}% more` : `${label}: buyers pay ${Math.round((1 - e.mult) * 100)}% less`;
  }
  return c;
}
export function shortExposure(p, prices) {
  let t = 0;
  for (const [sym, sh] of Object.entries(p.shorts || {})) t += sh.qty * (prices[sym] ?? sh.price);
  return t;
}

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
  const c = { ...structuredClone(DECKS[deck][s.decks[deck].pop()]), deck };
  return s.econ?.on ? priced(s, c) : c;
}

// ---------------------------------------------------------------------------------------------
// money math
// ---------------------------------------------------------------------------------------------
export const money = (n) => (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US');
// small businesses earn more in a boom and less in a recession; rents hold steady
export function assetFlow(p, a) {
  return a.kind === 'business' ? Math.round((a.flow || 0) * (p.bizMod ?? 1)) : a.flow || 0;
}
export function passive(p) {
  return p.assets.reduce((t, a) => t + assetFlow(p, a), 0);
}
export function bankPayment(p) {
  return Math.round(p.bank * (p.loanRate ?? 0.1));
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
  for (const [sym, sh] of Object.entries(p.shorts || {})) w += (sh.price - (p.stockPrice?.[sym] ?? sh.price)) * sh.qty;
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
    shorts: {},
    loanRate: 0.1,
    bizMod: 1,
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
    econ: null,
    turnTrades: 0,
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
  if (options.economy === 'real') {
    s.econ = newEconomy(s);
    syncEconomy(s);
    log(s, null, 'Real-life economy is on: markets rise and fall every round. Watch the cycle and buy when things are on sale.', 'econ');
  }
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
  const k = card.econ ?? 1;
  const r100 = (n) => Math.round(n / 100) * 100;
  if (card.price != null) return r100(card.price * k);
  if (card.perUnit != null) return r100(card.perUnit * (asset.units || 1) * k);
  return r100(asset.cost * card.mult * k);
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
      if (s.econ?.on && s.turnTrades < MAX_TRADES_PER_TURN) {
        const pr = s.econ.prices;
        for (const sym of Object.keys(pr)) {
          for (const q of [10, 100, 1000]) if (q * pr[sym] <= p.cash) out.push({ type: 'trade', sym, qty: q });
          if (p.stocks[sym]) out.push({ type: 'trade', sym, qty: -p.stocks[sym] });
          if (p.shorts[sym]) out.push({ type: 'cover', sym });
          else if (!p.stocks[sym])
            for (const q of [10, 100, 1000]) if (p.cash >= SHORT_MARGIN * (shortExposure(p, pr) + q * pr[sym])) out.push({ type: 'short', sym, qty: q });
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
  if (s.phase === 'roll' && ['trade', 'short', 'cover'].includes(m.type)) {
    if (!s.econ?.on) return 'The stock market is open in the real-life economy mode';
    if (s.turnTrades >= MAX_TRADES_PER_TURN) return 'That is enough trading for one turn';
    const price = s.econ.prices[m.sym];
    if (!price) return 'Unknown stock';
    if (m.type === 'cover') return p.shorts[m.sym] ? null : 'You have no short position there';
    const n = m.type === 'short' ? m.qty : Math.abs(m.qty);
    if (!int(n)) return 'Pick a number of shares';
    if (m.type === 'short') {
      if (p.stocks[m.sym]) return 'Sell the shares you own before shorting';
      return p.cash >= SHORT_MARGIN * (shortExposure(p, s.econ.prices) + n * price) ? null : `Shorting needs cash of ${SHORT_MARGIN * 100}% of the position`;
    }
    if (m.qty > 0) return n * price <= p.cash ? null : 'Not enough cash for that many shares';
    return n <= (p.stocks[m.sym] || 0) ? null : 'You do not own that many shares';
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
      } else if (m.type === 'trade') {
        trade(s, p, m.sym, m.qty, s.econ.prices[m.sym]);
        s.turnTrades++;
      } else if (m.type === 'short') {
        const price = s.econ.prices[m.sym];
        p.shorts[m.sym] = { qty: m.qty, price };
        s.turnTrades++;
        log(s, seat, `shorted ${m.qty.toLocaleString('en-US')} shares of ${m.sym} at $${price} — betting the price falls`);
      } else if (m.type === 'cover') {
        cover(s, p, m.sym, false);
        s.turnTrades++;
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
    trade(s, p, c.sym, m.type === 'buy' ? m.qty : -m.qty, c.price);
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

// buy (qty > 0) or sell (qty < 0) shares at a price
function trade(s, p, sym, qty, price) {
  p.stockPrice[sym] = price;
  if (qty > 0) {
    const own = p.stocks[sym] || 0;
    p.stockCost[sym] = ((p.stockCost[sym] || 0) * own + price * qty) / (own + qty);
    p.stocks[sym] = own + qty;
    p.cash -= price * qty;
    log(s, p.seat, `bought ${qty.toLocaleString('en-US')} shares of ${sym} at $${price}`);
  } else {
    const n = -qty;
    p.stocks[sym] -= n;
    p.cash += price * n;
    const gain = (price - (p.stockCost[sym] || 0)) * n;
    log(s, p.seat, `sold ${n.toLocaleString('en-US')} shares of ${sym} at $${price} (${gain >= 0 ? 'gain' : 'loss'} ${money(Math.abs(gain))})`, gain >= 0 ? 'good' : 'bad');
    if (!p.stocks[sym]) {
      delete p.stocks[sym];
      delete p.stockCost[sym];
    }
  }
}
// close a short: profit if the price fell since you shorted, loss if it rose
function cover(s, p, sym, forced) {
  const sh = p.shorts[sym];
  const price = s.econ.prices[sym];
  const gain = (sh.price - price) * sh.qty;
  delete p.shorts[sym];
  if (gain >= 0) p.cash += gain;
  else pay(s, p, -gain, 'a short-sale loss');
  const how = forced ? 'Margin call! The bank closed the short on' : 'covered the short on';
  log(s, p.seat, `${how} ${sh.qty.toLocaleString('en-US')} ${sym} at $${price} (shorted at $${sh.price}): ${gain >= 0 ? 'profit' : 'loss'} ${money(Math.abs(gain))}`, gain >= 0 ? 'good' : 'bad');
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
  s.turnTrades = 0;
  for (let guard = 0; guard < SEATS * 4; guard++) {
    s.turn = (s.turn + 1) % SEATS;
    if (s.turn === s.first) {
      s.round++;
      stepEconomy(s);
    }
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
