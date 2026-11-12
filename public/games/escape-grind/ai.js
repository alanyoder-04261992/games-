// Escape the Grind — computer players. They see the same view a person sees.
import { passive, expenses, cashflow, income, offerValue, FREEDOM_GOAL, SHORT_MARGIN, shortExposure } from './engine.js';

export const LEVELS = {
  easy: { label: 'Easy', reserve: 0.5, roiMin: 0.08, loans: false, noise: 0.3 },
  normal: { label: 'Normal', reserve: 1, roiMin: 0.15, loans: true, noise: 0.08 },
  hard: { label: 'Expert', reserve: 1.2, roiMin: 0.12, loans: true, noise: 0 },
};

export function chooseAction(view, moves, levelKey = 'normal') {
  const L = LEVELS[levelKey] || LEVELS.normal;
  const p = view.players[view.seat];
  const find = (type, pred = () => true) => moves.find((m) => m.type === type && pred(m));
  const reserve = Math.max(500, expenses(p) * 0.25 * L.reserve);
  const rnd = Math.random;

  switch (view.phase) {
    case 'roll': {
      const t = view.econ?.on && (view.turnTrades || 0) < 3 ? economyMove(view, p, moves, levelKey, reserve) : null;
      if (t) return t;
      if (p.track === 'grind') {
        // clear the bank loan first (10% a month is the worst rate), then the best payoff
        const repay = moves.filter((m) => m.type === 'repay').sort((a, b) => b.amount - a.amount);
        for (const m of repay) if (p.cash - m.amount >= reserve) return m;
        const payoffs = moves
          .filter((m) => m.type === 'payoff')
          .map((m) => ({ m, rate: p.exp[m.key] / p.debts[m.key].balance }))
          .filter((x) => p.cash - p.debts[x.m.key].balance >= reserve * 3)
          .sort((a, b) => b.rate - a.rate);
        if (levelKey !== 'easy' && payoffs.length && payoffs[0].rate > 0.025) return payoffs[0].m;
      }
      return find('roll', (m) => m.dice === 2) || find('roll');
    }
    case 'pick': {
      const big = p.cash >= (levelKey === 'easy' ? 25000 : 12000) || (L.loans && cashflow(p) > 2500 && p.cash > 8000);
      return find('pick', (m) => m.size === (big ? 'big' : 'small'));
    }
    case 'deal': {
      const c = view.card;
      if (c.type === 'stock') {
        const own = p.stocks[c.sym] || 0;
        if (own && c.price >= 30) return find('sell', (m) => m.qty === own) || find('pass');
        if (own && c.price >= 20 && (p.stockCost[c.sym] || 99) <= 5) return find('sell', (m) => m.qty === own) || find('pass');
        if (c.price <= 5 && c.sym !== 'BMF') {
          const budget = (p.cash - reserve) * (levelKey === 'hard' ? 0.6 : 0.4);
          const buys = moves.filter((m) => m.type === 'buy' && m.qty * c.price <= budget).sort((a, b) => b.qty - a.qty);
          if (buys.length && rnd() > L.noise) return buys[0];
        }
        return find('pass');
      }
      if (c.type === 'asset') {
        const buy = find('buy');
        if (!buy) return find('pass');
        if (c.flow <= 0) {
          // only speculate on things a Market card might pay well for, when cash is plentiful
          const spec = (c.cat === 'coins' || c.cat === 'land') && p.cash - c.down > reserve * 4 && levelKey !== 'easy';
          return spec && rnd() < 0.5 ? buy : find('pass');
        }
        const roi = (c.flow * 12) / Math.max(1, c.down);
        if (buy.loan) {
          if (!L.loans) return find('pass');
          const loanCost = Math.round(buy.loan * 0.1);
          return c.flow - loanCost > 0 && roi > L.roiMin && cashflow(p) - loanCost > 0 ? buy : find('pass');
        }
        const left = p.cash - c.down;
        if (roi >= L.roiMin && (left >= reserve || roi > 0.4)) return rnd() < L.noise ? find('pass') : buy;
        return find('pass');
      }
      return find('pass');
    }
    case 'charity': {
      const amt = income(p) * 0.1;
      return p.cash - amt >= reserve * 2 && levelKey !== 'easy' ? find('donate') : find('skip');
    }
    case 'market': {
      const card = view.market.card;
      const sells = moves
        .filter((m) => m.type === 'sell')
        .map((m) => {
          const a = p.assets.find((x) => x.id === m.id);
          const value = offerValue(a, card);
          const net = value - (a.mortgage || 0);
          return { m, a, net, gain: net - a.down };
        })
        .sort((x, y) => y.gain - x.gain);
      for (const x of sells) {
        if (x.net <= 0) continue;
        // a sale is good when the cash could buy back much more income than the asset makes
        const monthsOfFlow = x.a.flow > 0 ? x.net / x.a.flow : Infinity;
        const almostFree = passive(p) - x.a.flow < expenses(p) && passive(p) > expenses(p) * 0.85;
        if (!almostFree && (monthsOfFlow > 60 || (x.a.flow <= 0 && x.gain > 0) || x.gain > x.a.down * 3)) return x.m;
      }
      return find('keep');
    }
    case 'venture': {
      const buy = find('buy');
      if (!buy) return find('pass');
      const need = FREEDOM_GOAL - (p.freeFlow - p.freeStart);
      return view.card.flow >= need || p.cash - view.card.cost > 20000 || levelKey === 'easy' ? buy : rnd() < 0.7 ? buy : find('pass');
    }
    case 'dream':
      return find('buy') || find('pass');
  }
  return moves[0];
}

// Real-life economy: read the business cycle like a patient investor.
function economyMove(view, p, moves, levelKey, reserve) {
  const e = view.econ;
  const ph = e.phase;
  const pr = e.prices;
  // take profits when stocks are expensive
  for (const [sym, n] of Object.entries(p.stocks)) {
    const cost = p.stockCost[sym] || 0;
    if (pr[sym] > cost && (ph === 'boom' || pr[sym] >= cost * 1.6)) return { type: 'trade', sym, qty: -n };
  }
  // cover shorts once the fall has happened (or cut the loss when the market turns up)
  for (const [sym, sh] of Object.entries(p.shorts || {})) {
    const fell = pr[sym] < sh.price * 0.8;
    if (fell || ph === 'recovery' || ph === 'expansion' || (ph === 'recession' && e.left <= 1)) return { type: 'cover', sym };
  }
  if (levelKey === 'easy') return null;
  // buy the dip: broad, steady stocks when everything is on sale
  if ((ph === 'recession' || e.index < 85) && p.track === 'grind') {
    const sym = levelKey === 'hard' ? 'OAK' : 'BMF';
    const budget = (p.cash - reserve * 3) * 0.35;
    const qty = Math.floor(budget / pr[sym] / 10) * 10;
    if (!p.stocks[sym] && qty >= 10) return { type: 'trade', sym, qty };
  }
  // experts short the most jumpy stock as the economy cools
  if (levelKey === 'hard' && ph === 'slowdown' && !p.shorts?.NPK && !p.stocks.NPK) {
    const qty = Math.floor((p.cash * 0.3) / pr.NPK / 10) * 10;
    if (qty >= 10 && p.cash >= SHORT_MARGIN * (shortExposure(p, pr) + qty * pr.NPK)) return { type: 'short', sym: 'NPK', qty };
  }
  return null;
}
