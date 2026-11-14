// Play insights for the Game Center's owner: who plays, which games, how often.
//
// The app sends small events to /api/track (netlify/functions/track.mjs). They are stored one
// per blob in Netlify Blobs, keyed by day. /api/insights (netlify/functions/insights.mjs) reads
// them back and summarises them, but only for a request carrying the owner's key (the
// INSIGHTS_KEY environment variable in Netlify). See docs/INSIGHTS.md.
//
// Stored per event, nothing else: what happened, when (server time), a random device id, the
// name the player typed, the game and how it was played. No IP address, no location.

export const EVENT_TYPES = ['open', 'start', 'end', 'leave', 'join'];
const MODES = ['solo', 'local', 'host', 'guest'];
const MAX_EVENTS_PER_REQUEST = 25;
const MAX_BODY = 16 * 1024;
const MAX_READ = 20000;

const str = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, n) : '');
const int = (v, lo, hi) => (Number.isFinite(+v) ? Math.max(lo, Math.min(hi, Math.round(+v))) : null);
const id = (v, n = 24) => (typeof v === 'string' && /^[A-Za-z0-9_-]{4,40}$/.test(v) ? v.slice(0, n) : '');

// Keep only known fields, with sane types and lengths. Returns null for anything unusable.
export function cleanEvent(raw, now = Date.now()) {
  if (!raw || typeof raw !== 'object' || !EVENT_TYPES.includes(raw.t)) return null;
  const d = id(raw.d);
  if (!d) return null;
  const ev = { t: raw.t, ts: now, d, n: str(raw.n, 20) || 'Player' };
  if (raw.t !== 'open') {
    const g = id(raw.g, 32);
    if (!g) return null;
    ev.g = g;
    if (MODES.includes(raw.m)) ev.m = raw.m;
    const tb = id(raw.tb, 16);
    if (tb) ev.tb = tb;
  }
  const h = int(raw.h, 0, 12);
  const b = int(raw.b, 0, 12);
  if (h != null) ev.h = h;
  if (b != null) ev.b = b;
  if (Array.isArray(raw.p)) ev.p = raw.p.slice(0, 8).map((x) => str(x, 20)).filter(Boolean);
  const dur = int(raw.dur, 0, 24 * 3600);
  if (dur != null && raw.t !== 'open' && raw.t !== 'join') ev.dur = dur;
  if (raw.t === 'start' && raw.r) ev.r = 1; // a saved game resumed
  const v = str(raw.v, 10);
  if (v && /^[\d.]+$/.test(v)) ev.v = v;
  return ev;
}

export const dayKey = (ts) => new Date(ts).toISOString().slice(0, 10);
const blobKey = (ev) => `e/${dayKey(ev.ts)}/${ev.ts.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

// POST /api/track  { events: [...] }  →  204
export async function handleTrack(request, store, now = Date.now()) {
  if (request.method !== 'POST') return new Response('POST only', { status: 405 });
  const text = await request.text();
  if (text.length > MAX_BODY) return new Response('Too large', { status: 413 });
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return new Response('Bad JSON', { status: 400 });
  }
  const list = Array.isArray(body?.events) ? body.events.slice(0, MAX_EVENTS_PER_REQUEST) : [];
  const events = list.map((e) => cleanEvent(e, now)).filter(Boolean);
  await Promise.all(events.map((ev) => store.setJSON(blobKey(ev), ev)));
  return new Response(null, { status: 204 });
}

// Constant-time comparison, so the key can't be guessed one character at a time.
function sameKey(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// GET /api/insights?days=30  (Authorization: Bearer <INSIGHTS_KEY>)  →  summary JSON
export async function handleInsights(request, store, ownerKey, now = Date.now()) {
  const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  if (!ownerKey) return json({ error: 'not-configured' }, 503);
  const given = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!sameKey(given, ownerKey)) {
    await new Promise((r) => setTimeout(r, 400)); // slow down guessing
    return json({ error: 'wrong-key' }, 401);
  }
  const days = int(new URL(request.url).searchParams.get('days'), 1, 365) ?? 30;
  const events = [];
  for (let i = 0; i < days && events.length < MAX_READ; i++) {
    const day = dayKey(now - i * 86400e3);
    const { blobs } = await store.list({ prefix: `e/${day}/` });
    const got = await Promise.all(blobs.slice(0, MAX_READ - events.length).map((b) => store.get(b.key, { type: 'json' }).catch(() => null)));
    events.push(...got.filter(Boolean));
  }
  return json(summarize(events, { now, days }));
}

// Everything the dashboard shows, worked out from the raw events.
export function summarize(events, { now = Date.now(), days = 30 } = {}) {
  events = events.filter((e) => e && e.ts).sort((a, b) => a.ts - b.ts);
  const week = now - 7 * 86400e3;
  const players = new Map(); // device id → player
  const games = new Map(); // game id → game
  const daily = new Map(); // day → { players:Set, games, minutes }
  for (let i = 0; i < days; i++) daily.set(dayKey(now - i * 86400e3), { players: new Set(), games: 0, minutes: 0 });
  const player = (e) => {
    let p = players.get(e.d);
    if (!p) players.set(e.d, (p = { device: e.d, name: e.n, names: new Set(), first: e.ts, last: e.ts, visits: 0, started: 0, finished: 0, left: 0, minutes: 0, byGame: {}, modes: {}, partners: new Set(), lastGame: null }));
    p.name = e.n;
    p.names.add(e.n);
    p.last = Math.max(p.last, e.ts);
    p.first = Math.min(p.first, e.ts);
    return p;
  };
  const game = (g) => {
    let x = games.get(g);
    if (!x) games.set(g, (x = { id: g, started: 0, finished: 0, left: 0, minutes: 0, players: new Set(), modes: {}, last: 0 }));
    return x;
  };
  for (const e of events) {
    const p = player(e);
    const d = daily.get(dayKey(e.ts));
    d?.players.add(e.d);
    const mins = (e.dur || 0) / 60;
    if (e.t === 'open') p.visits++;
    if (!e.g) continue;
    const g = game(e.g);
    g.players.add(e.d);
    g.last = Math.max(g.last, e.ts);
    if (e.t === 'start') {
      p.started++;
      g.started++;
      p.byGame[e.g] = (p.byGame[e.g] || 0) + 1;
      if (e.m) {
        p.modes[e.m] = (p.modes[e.m] || 0) + 1;
        g.modes[e.m] = (g.modes[e.m] || 0) + 1;
      }
      for (const name of e.p || []) if (name !== e.n) p.partners.add(name);
      p.lastGame = e.g;
      if (d) d.games++;
    }
    if (e.t === 'end') {
      p.finished++;
      g.finished++;
    }
    if (e.t === 'leave') {
      p.left++;
      g.left++;
    }
    if (e.t === 'end' || e.t === 'leave') {
      p.minutes += mins;
      g.minutes += mins;
      if (d) d.minutes += mins;
    }
  }
  const round = (x) => Math.round(x * 10) / 10;
  const fav = (byGame) => Object.entries(byGame).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  const playerList = [...players.values()]
    .map((p) => ({ device: p.device, name: p.name, otherNames: [...p.names].filter((n) => n !== p.name), first: p.first, last: p.last, visits: p.visits, started: p.started, finished: p.finished, left: p.left, minutes: round(p.minutes), favorite: fav(p.byGame), byGame: p.byGame, modes: p.modes, playsWith: [...p.partners].slice(0, 8), lastGame: p.lastGame }))
    .sort((a, b) => b.last - a.last);
  const gameList = [...games.values()]
    .map((g) => ({ id: g.id, started: g.started, finished: g.finished, left: g.left, minutes: round(g.minutes), players: g.players.size, modes: g.modes, avgMinutes: g.finished + g.left ? round(g.minutes / (g.finished + g.left)) : 0, last: g.last }))
    .sort((a, b) => b.started - a.started);
  const inWeek = events.filter((e) => e.ts >= week);
  return {
    generatedAt: now,
    days,
    totals: {
      players: players.size,
      playersThisWeek: new Set(inWeek.map((e) => e.d)).size,
      newThisWeek: playerList.filter((p) => p.first >= week).length,
      gamesStarted: gameList.reduce((n, g) => n + g.started, 0),
      gamesThisWeek: inWeek.filter((e) => e.t === 'start').length,
      minutes: round(gameList.reduce((n, g) => n + g.minutes, 0)),
      finishRate: (() => {
        const done = gameList.reduce((n, g) => n + g.finished, 0);
        const all = done + gameList.reduce((n, g) => n + g.left, 0);
        return all ? Math.round((done / all) * 100) : null;
      })(),
      modes: gameList.reduce((m, g) => {
        for (const [k, v] of Object.entries(g.modes)) m[k] = (m[k] || 0) + v;
        return m;
      }, {}),
    },
    daily: [...daily.entries()].map(([day, d]) => ({ day, players: d.players.size, games: d.games, minutes: round(d.minutes) })).sort((a, b) => a.day.localeCompare(b.day)),
    games: gameList,
    players: playerList,
    recent: events.slice(-60).reverse().map((e) => ({ t: e.t, ts: e.ts, name: e.n, device: e.d, g: e.g || null, m: e.m || null, dur: e.dur ?? null, p: e.p || null, r: e.r || 0 })),
  };
}
