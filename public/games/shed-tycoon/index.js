// Shed Tycoon for the Game Center: buy lumber, steel, glass, paint and shingles, build sheds,
// barns and garages, and win over the sales lots. This file is the game's manifest.
import * as E from './engine.js';
import { chooseAction, LEVELS } from './ai.js';
import { TILE_ART } from './art.js';

export default {
  id: 'shed-tycoon',
  version: '1.0', // shown on the home tile; bump it whenever you improve the game
  name: 'Shed Tycoon',
  tagline: 'Buy materials, build sheds, grow a backyard empire.',
  description:
    'Take lumber, steel, glass, paint and shingles from the supply, then spend them to build sheds, barns and garages from the order board. Every building you finish makes that material cheaper for good, so small sheds pay for the big lodges later. Hold an order you want (and pick up some cash), and win over sales lots by building what they sell. First to the target score triggers the final round. 2–4 builders.',
  seats: 2,
  seatCount: (options) => Math.min(4, Math.max(2, Number(options?.players) || 2)),
  seatLabels: ['Builder 1', 'Builder 2', 'Builder 3', 'Builder 4'],
  players: '1–4 players',
  tile: TILE_ART,
  accent: '#3f9d62',
  options: [
    {
      key: 'players',
      label: 'Players',
      type: 'select',
      default: 2,
      choices: [
        { value: 2, label: '2 · 4 of each material' },
        { value: 3, label: '3 · 5 of each material' },
        { value: 4, label: '4 · 7 of each material' },
      ],
    },
    {
      key: 'target',
      label: 'Play to',
      type: 'select',
      default: 15,
      choices: [
        { value: 12, label: '12 points (quick)' },
        { value: 15, label: '15 points' },
        { value: 18, label: '18 points (long)' },
      ],
    },
  ],
  botLevels: Object.fromEntries(Object.entries(LEVELS).map(([k, v]) => [k, v.label])),
  engine: {
    setup: E.setup,
    actors: E.actors,
    legal: E.legal,
    check: E.check,
    apply: E.apply,
    view: E.view,
    isOver: E.isOver,
  },
  bot: { choose: (view, legal, level) => chooseAction(view, legal, level) },
  // ms a computer waits before moving
  pace(state, event) {
    if (!event || event.type === 'start') return 1300;
    if (state.phase === 'discard') return 650;
    const a = event.action;
    if (a?.type === 'build') return 1500;
    if (a?.type === 'reserve') return 1300;
    return 1050;
  },
  styles: [new URL('./shed-tycoon.css', import.meta.url).href],
  ui: () => import('./ui.js'),
};
