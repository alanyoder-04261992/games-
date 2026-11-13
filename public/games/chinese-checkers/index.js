// Chinese Checkers for the Game Center: race your marbles across a star board by stepping
// and jumping. This file is the game's manifest; the rules are in engine.js, the computer
// players in ai.js, the board geometry in board.js and the screen in ui.js.
import * as E from './engine.js';
import { choose, LEVELS } from './ai.js';
import { CHECKERS_TILE as TILE } from './tile.js';
import { SEAT_NAMES } from './colors.js';

export default {
  id: 'chinese-checkers',
  version: '1.1', // shown on the home tile; bump it whenever you improve the game
  name: 'Chinese Checkers',
  tagline: 'Hop your marbles across the star. Chain jumps to race home.',
  description:
    'Move all your marbles across the star into the point opposite your own. Step to a neighbouring hole, or jump over any marble into the empty hole beyond, and keep jumping as far as the ladder goes. First to fill the far point wins. 2, 3, 4 or 6 players, online or against the computer.',
  seats: 2,
  seatCount: (options) => E.playerCount(options),
  seatLabels: SEAT_NAMES,
  players: '1–6 players',
  tile: TILE,
  accent: '#e0a34a',
  options: [
    {
      key: 'players',
      label: 'Players',
      type: 'select',
      default: 2,
      choices: [
        { value: 2, label: '2' },
        { value: 3, label: '3' },
        { value: 4, label: '4' },
        { value: 6, label: '6' },
      ],
    },
    {
      key: 'pieces',
      label: 'Marbles',
      type: 'select',
      default: 10,
      choices: [
        { value: 10, label: '10 each (standard)' },
        { value: 6, label: '6 each (quick game)' },
      ],
    },
    {
      key: 'finish',
      label: 'Game ends (3+ players)',
      type: 'select',
      default: 'first',
      choices: [
        { value: 'first', label: 'When the first player gets home' },
        { value: 'all', label: 'Play on for 2nd, 3rd…' },
      ],
    },
  ],
  botLevels: LEVELS,
  engine: {
    setup: E.setup,
    actors: E.actors,
    legal: E.legal,
    check: E.check,
    apply: E.apply,
    view: E.view,
    isOver: E.isOver,
  },
  bot: { choose: (view, legal, level) => choose(view, legal, level) },
  // give the marble time to finish hopping before the next computer moves
  pace: (state) => 520 + 200 * Math.max(1, (state?.last?.path?.length ?? 2) - 1),
  styles: [new URL('./checkers.css', import.meta.url).href],
  ui: () => import('./ui.js'),
};
