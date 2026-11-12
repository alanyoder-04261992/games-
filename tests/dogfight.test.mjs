import test from 'node:test';
import assert from 'node:assert/strict';
import game from '../public/games/dogfight/index.js';

const { engine } = game;
const options = Object.fromEntries(game.options.map((o) => [o.key, o.default]));

test('dogfight: a round is real-time, with no turns for the table to schedule', () => {
  const s = engine.setup({ seed: 1, options });
  assert.deepEqual(engine.actors(s), []);
  assert.equal(engine.isOver(s), false);
  assert.deepEqual(engine.view(s, 0).options, options);
});

test('dogfight: finishing records a clean scoreboard and ends the round', () => {
  const s = engine.setup({ seed: 1, options });
  const results = { mode: 'versus', reason: 'won', board: [{ seat: 2, name: 'Ruth'.repeat(10), kills: 5, deaths: 1, extra: 'x' }] };
  const done = engine.apply(s, 0, { type: 'finish', results });
  assert.equal(engine.isOver(done), true);
  assert.equal(engine.isOver(s), false, 'old state untouched');
  assert.equal(done.results.board[0].name.length, 20);
  assert.equal(done.results.board[0].extra, undefined);
  assert.throws(() => engine.apply(done, 0, { type: 'finish', results }));
  assert.ok(engine.check(s, 1, { type: 'fly' }));
});

test('dogfight: options cover mode, raider count and waves', () => {
  for (const k of ['mode', 'difficulty', 'enemies', 'waves', 'kills', 'wingmen']) assert.ok(game.options.find((o) => o.key === k), k);
  JSON.stringify(engine.setup({ seed: 3, options })); // states must be plain JSON
});
