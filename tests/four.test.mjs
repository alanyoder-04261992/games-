import test from 'node:test';
import assert from 'node:assert/strict';
import game from '../public/games/four-in-a-row/index.js';

const { engine, bot } = game;
function play(seed, levels) {
  let s = engine.setup({ seed });
  while (!engine.isOver(s)) {
    const seat = engine.actors(s)[0];
    s = engine.apply(s, seat, bot.choose(engine.view(s, seat), engine.legal(s, seat), levels[seat]));
  }
  return s;
}

test('four in a row: games end, wins have a line of four', () => {
  for (let seed = 0; seed < 20; seed++) {
    const s = play(seed, ['easy', 'easy']);
    if (s.winner != null) assert.ok(s.line.length >= 4);
    else assert.equal(s.moves, 42);
  }
});

test('four in a row: normal computer beats easy', () => {
  let wins = 0;
  for (let seed = 0; seed < 10; seed++) if (play(seed, ['normal', 'easy']).winner === 0) wins++;
  assert.ok(wins >= 8, `won ${wins}/10`);
});

test('four in a row: illegal moves are rejected', () => {
  const s = engine.setup({ seed: 0 });
  assert.throws(() => engine.apply(s, 1 - s.turn, { type: 'drop', col: 3 }));
  assert.throws(() => engine.apply(s, s.turn, { type: 'drop', col: 9 }));
});
