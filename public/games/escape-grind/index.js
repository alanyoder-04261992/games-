// Escape the Grind for the Game Center: the manifest.
import * as E from './engine.js';
import { chooseAction, LEVELS } from './ai.js';
import { ESCAPE_TILE as TILE } from './tile.js';

export default {
  id: 'escape-grind',
  version: '1.10', // shown on the home tile; bump it whenever you improve the game
  name: 'Escape the Grind',
  tagline: 'A 3D money board game: build passive income and break out of the paycheck loop.',
  description:
    'Start in a job, living paycheck to paycheck. Buy rentals, shed lots, businesses and stocks that pay you every month. When your passive income beats your expenses you break out of the Grind onto the Freedom Ring — then buy your Dream to win. Full 3D table, works with a game controller.',
  seats: E.SEATS,
  seatLabels: ['Red', 'Blue', 'Green', 'Gold'],
  joinOrder: [1, 2, 3],
  players: '1–4 players',
  tile: TILE,
  accent: '#e0a526',
  options: [
    {
      key: 'economy',
      label: 'Economy',
      type: 'select',
      default: 'classic',
      choices: [
        { value: 'classic', label: 'Classic' },
        { value: 'real', label: 'Real-life (advanced): booms, recessions, live stock market' },
      ],
    },
    {
      key: 'length',
      label: 'Game length',
      type: 'select',
      default: 'standard',
      choices: [
        { value: 'quick', label: 'Quick (40 rounds max)' },
        { value: 'standard', label: 'Standard (80 rounds max)' },
        { value: 'long', label: 'Play until someone wins' },
      ],
    },
  ],
  botLevels: Object.fromEntries(Object.entries(LEVELS).map(([k, v]) => [k, v.label])),
  engine: {
    setup: ({ seed, options }) => E.setup({ seed, options }),
    actors: E.actors,
    legal: E.legal,
    check: E.check,
    apply: E.apply,
    view: E.view,
    isOver: E.isOver,
  },
  bot: { choose: (view, legal, level) => chooseAction(view, legal, level) },
  // ms a computer player waits before moving, so the dice, pawn and cards can be watched
  pace(state, event, prev) {
    if (!event || event.type === 'start') return 2400;
    if (prev && state.lastRoll && state.lastRoll.seq !== prev.lastRoll?.seq) {
      const r = state.lastRoll;
      return 2300 + (r.dice[0] + (r.dice[1] || 0)) * 260;
    }
    if (prev && state.turn !== prev.turn) return 1500;
    if (state.phase === 'deal' || state.phase === 'venture' || state.phase === 'dream') return 1900;
    return 1100;
  },
  styles: [new URL('./escape.css', import.meta.url).href],
  ui: () => import('./ui.js'),
};
