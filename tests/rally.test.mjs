import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import game from '../public/games/rally/index.js';

const { engine } = game;
const options = Object.fromEntries(game.options.map((o) => [o.key, o.default]));

test('rally: a race is real-time, with no turns for the table to schedule', () => {
  const s = engine.setup({ seed: 1, options });
  assert.deepEqual(engine.actors(s), []);
  assert.equal(engine.isOver(s), false);
  assert.deepEqual(engine.view(s, 0).options, options);
  JSON.stringify(s); // states must be plain JSON
});

test('rally: calling the results records a clean classification and ends the race', () => {
  const s = engine.setup({ seed: 1, options });
  const results = {
    track: 'lakeside',
    laps: 3,
    rows: [
      { id: 'p0', name: 'Ruth'.repeat(10), car: 'Vela GT', color: '#1f6fd1', gap: '4:12.30', best: 81.2, extra: 'x' },
      { id: 'ai1', name: 'Otis', car: 'Brumby V8', color: 'red;background:url(x)', gap: '+2.10', best: 'fast' },
    ],
  };
  const done = engine.apply(s, 0, { type: 'finish', results });
  assert.equal(engine.isOver(done), true);
  assert.equal(engine.isOver(s), false, 'old state untouched');
  assert.equal(done.results.track, 'lakeside');
  assert.equal(done.results.rows[0].name.length, 20);
  assert.equal(done.results.rows[0].extra, undefined);
  assert.equal(done.results.rows[1].color, '#888888', 'colours are checked before the frame uses them');
  assert.equal(done.results.rows[1].best, null);
  assert.throws(() => engine.apply(done, 0, { type: 'finish', results }));
  assert.ok(engine.check(s, 1, { type: 'drive' }));
});

test('rally: options cover circuit, laps, computer cars and skill, and match the game', () => {
  for (const k of ['track', 'laps', 'opponents', 'difficulty']) assert.ok(game.options.find((o) => o.key === k), k);
  const html = readFileSync(new URL('../public/games/rally/play.html', import.meta.url), 'utf8');
  for (const c of game.options.find((o) => o.key === 'track').choices) assert.match(html, new RegExp(`\\b${c.value}: \\{ name:`), c.value);
  for (const c of game.options.find((o) => o.key === 'difficulty').choices) assert.match(html, new RegExp(`\\b${c.value}: 0?\\.?\\d`), c.value);
});
