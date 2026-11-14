// Owner's play insights: event cleaning, storing, the key check and the summary.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanEvent, handleTrack, handleInsights, summarize } from '../netlify/lib/insights.mjs';

function memoryStore() {
  const m = new Map();
  return {
    m,
    async setJSON(k, v) { m.set(k, structuredClone(v)); },
    async get(k) { return m.has(k) ? structuredClone(m.get(k)) : null; },
    async list({ prefix = '' } = {}) { return { blobs: [...m.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) }; },
  };
}
const post = (events) => new Request('http://x/api/track', { method: 'POST', body: JSON.stringify({ events }) });
const get = (key, days = 30) => new Request(`http://x/api/insights?days=${days}`, { headers: key ? { authorization: `Bearer ${key}` } : {} });

test('events are cleaned: only known fields, sane sizes, server time', () => {
  const ev = cleanEvent({ t: 'start', d: 'dev12345', n: '  Alan\u0007  ', g: 'rook', m: 'host', h: 3, b: 1, p: ['Alan', 'Sam'], v: '2.7', ip: '1.2.3.4', ts: 5, junk: { a: 1 } }, 1000);
  assert.deepEqual(ev, { t: 'start', ts: 1000, d: 'dev12345', n: 'Alan', g: 'rook', m: 'host', h: 3, b: 1, p: ['Alan', 'Sam'], v: '2.7' });
  assert.equal(cleanEvent({ t: 'hack', d: 'dev12345' }), null, 'unknown type');
  assert.equal(cleanEvent({ t: 'open', d: '../../etc' }), null, 'bad device id');
  assert.equal(cleanEvent({ t: 'start', d: 'dev12345', g: '<script>' }), null, 'bad game id');
  assert.equal(cleanEvent({ t: 'open', d: 'dev12345', n: 'x'.repeat(99) }).n.length, 20);
  assert.equal(cleanEvent({ t: 'end', d: 'dev12345', g: 'rook', dur: 1e9 }).dur, 86400);
});

test('track stores each clean event; rejects junk', async () => {
  const s = memoryStore();
  const res = await handleTrack(post([{ t: 'open', d: 'dev12345', n: 'Alan' }, { t: 'nope' }, { t: 'start', d: 'dev12345', g: 'rook', m: 'solo' }]), s, Date.UTC(2026, 10, 14, 12));
  assert.equal(res.status, 204);
  assert.equal(s.m.size, 2);
  assert.ok([...s.m.keys()].every((k) => k.startsWith('e/2026-11-14/')));
  assert.equal((await handleTrack(new Request('http://x/api/track'), s)).status, 405);
  assert.equal((await handleTrack(new Request('http://x/api/track', { method: 'POST', body: 'not json' }), s)).status, 400);
  assert.equal((await handleTrack(new Request('http://x/api/track', { method: 'POST', body: 'x'.repeat(20000) }), s)).status, 413);
});

test('insights answer only with the owner key', async () => {
  const s = memoryStore();
  assert.equal((await handleInsights(get('anything'), s, undefined)).status, 503, 'not set up');
  assert.equal((await handleInsights(get(null), s, 'secret-key')).status, 401, 'no key');
  assert.equal((await handleInsights(get('secret-kez'), s, 'secret-key')).status, 401, 'wrong key');
  const ok = await handleInsights(get('secret-key'), s, 'secret-key');
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('cache-control'), 'no-store');
});

test('summary: players, games, modes, minutes, finish rate', async () => {
  const s = memoryStore();
  const now = Date.UTC(2026, 10, 14, 12);
  await handleTrack(post([
    { t: 'open', d: 'alan0001', n: 'Alan' },
    { t: 'start', d: 'alan0001', n: 'Alan', g: 'rook', m: 'host', h: 2, b: 2, p: ['Alan', 'Sam'] },
    { t: 'end', d: 'alan0001', n: 'Alan', g: 'rook', m: 'host', dur: 1800 },
    { t: 'join', d: 'samm0001', n: 'Sam', g: 'rook', m: 'guest' },
    { t: 'start', d: 'samm0001', n: 'Sam', g: 'rook', m: 'guest', h: 2, b: 2, p: ['Alan', 'Sam'] },
    { t: 'end', d: 'samm0001', n: 'Sam', g: 'rook', m: 'guest', dur: 1800 },
    { t: 'start', d: 'samm0001', n: 'Sammy', g: 'four-in-a-row', m: 'solo' },
    { t: 'leave', d: 'samm0001', n: 'Sammy', g: 'four-in-a-row', m: 'solo', dur: 120 },
  ]), s, now);
  const sum = await (await handleInsights(get('k'), s, 'k', now)).json();
  assert.equal(sum.totals.players, 2);
  assert.equal(sum.totals.gamesStarted, 3);
  assert.equal(sum.totals.finishRate, 67);
  assert.equal(sum.totals.minutes, 62);
  assert.deepEqual(sum.totals.modes, { host: 1, guest: 1, solo: 1 });
  const rook = sum.games.find((g) => g.id === 'rook');
  assert.equal(rook.started, 2);
  assert.equal(rook.players, 2);
  assert.equal(rook.avgMinutes, 30);
  const sam = sum.players.find((p) => p.device === 'samm0001');
  assert.equal(sam.name, 'Sammy');
  assert.deepEqual(sam.otherNames, ['Sam']);
  assert.equal(sam.favorite, 'rook');
  assert.deepEqual(sam.playsWith, ['Alan']);
  assert.equal(sum.daily.at(-1).players, 2);
  assert.equal(sum.recent[0].t, 'leave');
  assert.equal(summarize([]).totals.finishRate, null);
});
