// Hexstead computer players. They see only what a person in their seat could see: their own
// cards, everyone's card counts and the board. Decisions are heuristic: value corners by how
// often their numbers roll and which resources they add, pick a building goal, trade toward
// it, and point the bandit at whoever is ahead.
import { board, PIPS } from './geometry.js';

// How often a number pays, in 36ths. With fast harvest a 2–6 also pays whenever either die shows
// it (11 more chances in 36), so low numbers become the best tiles on the island.
const pipsOf = (v, n) => (PIPS[n] || 0) + (v.fastHarvest && n >= 2 && n <= 6 ? 11 : 0);
import { RES, COST, TERRAIN, canPay, total, canHomestead, canRoad, ratio } from './engine.js';

const G = (v) => board(v.size || 'base');

export const LEVELS = {
  easy: { label: 'Easy', noise: 0.6, trade: false, random: 0.35 },
  normal: { label: 'Normal', noise: 0.15, trade: true, random: 0 },
  hard: { label: 'Expert', noise: 0, trade: true, random: 0 },
};

const RES_WEIGHT = { timber: 1.1, brick: 1.1, wool: 0.85, grain: 1.05, stone: 1.0 };
const rnd = (arr) => arr[Math.floor(Math.random() * arr.length)];

// ---------------------------------------------------------------------
// evaluation helpers
// ---------------------------------------------------------------------
function production(v, p) {
  const prod = Object.fromEntries(RES.map((r) => [r, 0]));
  v.verts.forEach((b, vi) => {
    if (b?.o !== p) return;
    for (const hi of G(v).VERTS[vi].hexes) {
      const r = TERRAIN[v.hexes[hi].t].res;
      if (r && hi !== v.bandit) prod[r] += pipsOf(v, v.hexes[hi].n) * (b.k === 'town' ? 2 : 1);
    }
  });
  return prod;
}

function cornerValue(v, p, vi, prod, lvl) {
  let score = 0;
  const seen = new Set();
  for (const hi of G(v).VERTS[vi].hexes) {
    const r = TERRAIN[v.hexes[hi].t].res;
    if (!r) continue;
    const pips = pipsOf(v, v.hexes[hi].n);
    let w = RES_WEIGHT[r];
    if ((prod?.[r] || 0) === 0) w *= 1.35; // new resource
    else if (prod[r] > 8) w *= 0.8;
    if (hi === v.bandit) w *= 0.4;
    score += pips * w;
    seen.add(r);
  }
  score += seen.size * 0.8;
  // harbors
  for (const h of v.harbors) {
    const slot = G(v).HARBOR_SLOTS[h.slot].verts;
    if (!slot.includes(vi)) continue;
    if (h.type === 'any') score += 1.2;
    else score += (prod?.[h.type] || 0) >= 5 ? 3 : 0.8;
  }
  if (lvl.noise) score *= 1 + (Math.random() - 0.5) * lvl.noise;
  return score;
}

const openCorner = (v, vi) => v.verts[vi] == null && G(v).VERTS[vi].adj.every((a) => v.verts[a] == null);

// how good are the open corners reachable from this vertex within `depth` trail steps
function reachValue(v, p, from, prod, lvl, depth = 2) {
  let best = 0;
  const seen = new Set([from]);
  let frontier = [from];
  for (let d = 0; d <= depth; d++) {
    const next = [];
    for (const x of frontier) {
      if (openCorner(v, x)) best = Math.max(best, cornerValue(v, p, x, prod, lvl) * (1 - d * 0.22));
      const b = v.verts[x];
      if (b && b.o !== p) continue;
      for (const e of G(v).VERTS[x].edges) {
        const y = G(v).otherEnd(e, x);
        if (seen.has(y) || (v.roads[e] != null && v.roads[e] !== p)) continue;
        seen.add(y);
        next.push(y);
      }
    }
    frontier = next;
  }
  return best;
}

function bestRoad(v, p, moves, prod, lvl) {
  let best = null;
  let bestScore = -Infinity;
  for (const m of moves) {
    const ed = G(v).EDGES[m.e];
    let score = 0;
    for (const end of [ed.a, ed.b]) score = Math.max(score, reachValue(v, p, end, prod, lvl, 1));
    // a little extra for growing the longest trail
    score += 0.2;
    if (score > bestScore) [best, bestScore] = [m, score];
  }
  return { move: best, score: bestScore };
}

function need(res, cost) {
  const out = {};
  let n = 0;
  for (const [r, c] of Object.entries(cost)) {
    const miss = Math.max(0, c - (res[r] || 0));
    if (miss) {
      out[r] = miss;
      n += miss;
    }
  }
  return { miss: out, n };
}

// Pick what to work toward this turn.
function goal(v, p) {
  const me = v.players[p];
  const res = me.res;
  const towns = v.verts.some((b) => b?.o === p && b.k === 'homestead') && me.pieces.town > 0;
  const spots = me.pieces.homestead > 0 ? G(v).VERTS.map((_, i) => i).filter((i) => canHomestead(v, p, i)) : [];
  const options = [];
  if (towns) options.push({ what: 'town', cost: COST.town, value: 3.2 });
  if (spots.length) options.push({ what: 'homestead', cost: COST.homestead, value: 3.4 });
  if (v.deck > 0) options.push({ what: 'card', cost: COST.card, value: 1.5 });
  if (!spots.length && me.pieces.road > 0 && me.pieces.homestead > 0) options.push({ what: 'road', cost: COST.road, value: 2.2 });
  let best = null;
  let bestScore = -Infinity;
  for (const o of options) {
    const { n } = need(res, o.cost);
    const score = o.value - n * 0.9;
    if (score > bestScore) [best, bestScore] = [o, score];
  }
  return best;
}

// resources we can spare without hurting the goal
function surplus(res, g) {
  const keep = g ? g.cost : {};
  return Object.fromEntries(RES.map((r) => [r, Math.max(0, (res[r] || 0) - (keep[r] || 0))]));
}

function leaderScore(v, q) {
  return v.players[q].vp + v.players[q].cardCount * 0.35 + v.players[q].resCount * 0.05;
}

// ---------------------------------------------------------------------
// main entry
// ---------------------------------------------------------------------
export function chooseAction(v, legal, level = 'normal') {
  const lvl = LEVELS[level] || LEVELS.normal;
  const p = v.seat;
  if (!legal.length) return null;
  const by = (type) => legal.filter((m) => m.type === type);
  const prod = production(v, p);
  const me = v.players[p];

  switch (v.phase) {
    case 'setup': {
      if (by('homestead').length) {
        let best = null, bestScore = -Infinity;
        for (const m of by('homestead')) {
          const sc = cornerValue(v, p, m.v, prod, lvl);
          if (sc > bestScore) [best, bestScore] = [m, sc];
        }
        return best;
      }
      return bestRoad(v, p, by('road'), prod, lvl).move || legal[0];
    }
    case 'roll': {
      const sheriff = legal.find((m) => m.type === 'play');
      if (sheriff && banditOnMe(v, p)) return sheriff;
      return { type: 'roll' };
    }
    case 'discard':
      return { type: 'discard', res: discardPlan(v, p) };
    case 'bandit':
      return banditMove(v, p, legal, lvl);
    case 'roads':
      return bestRoad(v, p, by('road'), prod, lvl).move || legal[0];
    case 'trade': {
      const t = v.trade;
      if (t.stage === 'choose') {
        const acc = by('accept-trade');
        if (!acc.length) return { type: 'cancel-trade' };
        acc.sort((a, b) => leaderScore(v, a.with) - leaderScore(v, b.with));
        return acc[0];
      }
      return { type: 'respond', yes: wantsTrade(v, p, t, lvl) && legal.some((m) => m.yes) };
    }
    case 'main':
      return mainTurn(v, p, legal, lvl, prod, me);
    case 'raise':
      return raiseTurn(v, p, legal, lvl, prod);
  }
  return legal[0];
}

function banditOnMe(v, p) {
  return G(v).HEXES[v.bandit].verts.some((vi) => v.verts[vi]?.o === p) && v.hexes[v.bandit].t !== 'desert';
}

function discardPlan(v, p) {
  const res = { ...v.players[p].res };
  const g = goal(v, p);
  const keep = g ? g.cost : {};
  const out = Object.fromEntries(RES.map((r) => [r, 0]));
  let n = v.discard[p];
  while (n > 0) {
    // throw away whatever we have most of beyond what the goal needs
    let pickR = null;
    let pickScore = -Infinity;
    for (const r of RES) {
      if (res[r] <= 0) continue;
      const sc = res[r] - (keep[r] || 0) * 1.5 + Math.random() * 0.1;
      if (sc > pickScore) [pickR, pickScore] = [r, sc];
    }
    res[pickR]--;
    out[pickR]++;
    n--;
  }
  return out;
}

function banditMove(v, p, legal, lvl) {
  if (lvl.random && Math.random() < lvl.random) return rnd(legal);
  let best = legal[0];
  let bestScore = -Infinity;
  for (const m of legal) {
    const hx = v.hexes[m.hex];
    const pips = pipsOf(v, hx.n);
    let score = 0;
    for (const vi of G(v).HEXES[m.hex].verts) {
      const b = v.verts[vi];
      if (!b) continue;
      const amt = b.k === 'town' ? 2 : 1;
      if (b.o === p) score -= pips * amt * 2.5;
      else score += pips * amt * (1 + leaderScore(v, b.o) / 6);
    }
    if (m.victim != null) score += 2 + leaderScore(v, m.victim) * 0.6 + Math.min(v.players[m.victim].resCount, 7) * 0.3;
    score += Math.random() * 0.3;
    if (score > bestScore) [best, bestScore] = [m, score];
  }
  return best;
}

function wantsTrade(v, p, t, lvl) {
  if (lvl.random && Math.random() < 0.5) return Math.random() < 0.3;
  if (v.players[t.from].vp >= v.target - 2) return false;
  const res = v.players[p].res;
  const g = goal(v, p);
  const before = g ? need(res, g.cost).n : 0;
  const after = { ...res };
  for (const [r, n] of Object.entries(t.give)) after[r] += n;
  for (const [r, n] of Object.entries(t.get)) after[r] -= n;
  const g2 = g ? need(after, g.cost).n : 0;
  const gain = total(t.give) - total(t.get);
  if (g2 < before) return gain >= -1;
  if (g2 === before && gain > 0) return true;
  return false;
}

function mainTurn(v, p, legal, lvl, prod, me) {
  const by = (type) => legal.filter((m) => m.type === type);
  if (lvl.random && Math.random() < lvl.random) {
    const builds = legal.filter((m) => ['homestead', 'town', 'road', 'buy'].includes(m.type));
    if (builds.length && Math.random() < 0.5) return rnd(builds);
  }

  // play a card first when it helps
  const plays = by('play');
  if (plays.length) {
    const card = playCard(v, p, plays, prod, lvl);
    if (card) return card;
  }

  // towns are the best value
  const towns = by('town');
  if (towns.length) {
    let best = towns[0], bs = -1;
    for (const m of towns) {
      const sc = cornerValue(v, p, m.v, null, { noise: 0 });
      if (sc > bs) [best, bs] = [m, sc];
    }
    return best;
  }
  const homes = by('homestead');
  if (homes.length) {
    let best = homes[0], bs = -1;
    for (const m of homes) {
      const sc = cornerValue(v, p, m.v, prod, lvl);
      if (sc > bs) [best, bs] = [m, sc];
    }
    return best;
  }

  const g = goal(v, p);
  // roads, when they lead somewhere and we aren't saving for something better
  const roads = by('road');
  if (roads.length && (!g || g.what === 'road' || g.what === 'card' || me.res.timber + me.res.brick >= 4)) {
    const { move, score } = bestRoad(v, p, roads, prod, lvl);
    const chasingTrail = v.trailHolder !== p && v.trailLen[p] >= 4 && me.pieces.road > 2;
    if (move && (score > 4 || chasingTrail || (g?.what === 'road' && score > 1.5))) return move;
  }

  if (legal.some((m) => m.type === 'buy') && (!g || g.what === 'card' || canPay(me.res, { ...COST.card, ...addCost(g.cost, COST.card) }))) {
    return { type: 'buy' };
  }

  // trade toward the goal
  if (g && lvl.trade !== false) {
    const { miss, n } = need(me.res, g.cost);
    if (n > 0) {
      const spare = surplus(me.res, g);
      // bank trades
      if (v.bankTrades < 4) {
        for (const [get] of Object.entries(miss)) {
          for (const give of RES) {
            if (give === get) continue;
            const r = ratio(v, p, give);
            if (spare[give] >= r && legal.some((m) => m.type === 'bank' && m.give === give && m.get === get)) {
              // only trade if it brings the goal within reach
              const totalSpare = RES.reduce((a, x) => a + Math.floor(spare[x] / ratio(v, p, x)), 0);
              if (totalSpare >= n) return { type: 'bank', give, get };
            }
          }
        }
      }
      // ask the table for a 1-for-1
      if (v.offers < 1 && n === 1 && Math.random() < 0.4) {
        const [get] = Object.keys(miss);
        const give = RES.filter((r) => spare[r] > 0 && !(r in miss)).sort((a, b) => spare[b] - spare[a])[0];
        if (give) return { type: 'offer', give: { [give]: 1 }, get: { [get]: 1 } };
      }
    }
  }
  // too many cards in hand invites the bandit: spend on a card or a road
  if (total(me.res) > 7) {
    if (legal.some((m) => m.type === 'buy')) return { type: 'buy' };
    if (roads.length) return bestRoad(v, p, roads, prod, lvl).move;
  }
  return { type: 'end' };
}

// Building between turns: barns and homesteads always; a trail only when it opens a good
// corner; an almanac card when that's what we're saving for. Otherwise pass.
function raiseTurn(v, p, legal, lvl, prod) {
  const by = (type) => legal.filter((m) => m.type === type);
  const best = (moves, score) => moves.reduce((a, m) => (score(m) > score(a) ? m : a), moves[0]);
  if (by('town').length) return best(by('town'), (m) => cornerValue(v, p, m.v, null, { noise: 0 }));
  if (by('homestead').length) return best(by('homestead'), (m) => cornerValue(v, p, m.v, prod, lvl));
  const g = goal(v, p);
  if (by('road').length && (!g || g.what === 'road')) {
    const { move, score } = bestRoad(v, p, by('road'), prod, lvl);
    if (move && score > 3) return move;
  }
  if (by('buy').length && (!g || g.what === 'card')) return { type: 'buy' };
  return { type: 'pass' };
}

function addCost(a, b) {
  const out = { ...a };
  for (const [r, n] of Object.entries(b)) out[r] = (out[r] || 0) + n;
  return out;
}

function playCard(v, p, plays, prod, lvl) {
  const me = v.players[p];
  const has = (c) => plays.find((m) => m.card === c);
  const sheriff = has('sheriff');
  if (sheriff) {
    const closeToPosse = me.sheriffs >= 2 && v.posseHolder !== p;
    if (banditOnMe(v, p) || closeToPosse || Math.random() < 0.25) return sheriff;
  }
  if (has('trailblazer') && me.pieces.road >= 2) {
    if (G(v).EDGES.some((_, e) => canRoad(v, p, e))) return has('trailblazer');
  }
  const g = goal(v, p);
  if (g) {
    const { miss, n } = need(me.res, g.cost);
    const harvests = plays.filter((m) => m.card === 'harvest');
    if (harvests.length && n > 0 && n <= 2) {
      const want = Object.entries(miss).flatMap(([r, k]) => Array(k).fill(r));
      while (want.length < 2) want.push(RES.reduce((a, b) => (prod[b] < prod[a] ? b : a), RES[0]));
      const m = harvests.find((x) => [...x.res].sort().join() === [...want].sort().join());
      if (m) return m;
    }
    const market = plays.filter((m) => m.card === 'market');
    if (market.length && n >= 2) {
      // take the resource we need most, guessing what others hold from the board
      const [r] = Object.entries(miss).sort((a, b) => b[1] - a[1])[0];
      const others = v.players.reduce((a, pl, q) => a + (q === p ? 0 : pl.resCount), 0);
      if (others >= 8) return market.find((m) => m.res === r);
    }
  }
  return null;
}

