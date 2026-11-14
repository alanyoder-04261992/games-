// Hexstead for the Game Center: settle a hex island in 3D, harvest and trade resources,
// build homesteads, barns and trails. This file is the game's manifest.
import * as E from './engine.js';
import { chooseAction, LEVELS } from './ai.js';
import { HEXSTEAD_TILE as TILE } from './tile.js';
import { SEAT_NAMES } from './art.js';

export default {
  id: 'hexstead',
  version: '2.3', // shown on the home tile; bump it whenever you improve the game
  name: 'Hexstead',
  tagline: 'Settle a 3D hex island. Harvest, trade, build barns.',
  description:
    'Roll for timber, brick, wool, grain and stone. Lay trails, raise homesteads and upgrade them to barns, trade with the table or the harbors, and keep the bandit off your fields. First to the target score wins. Up to 8 players: 5 or more play on a bigger island and can build between turns.',
  seats: 4,
  // 3–8 players: 5–6 play on the Big island, 7–8 on the Grand island
  seatCount: (options) => Math.min(8, Math.max(3, Number(options?.players) || 4)),
  seatLabels: SEAT_NAMES,
  players: '1–8 players',
  tile: TILE,
  accent: '#d9813b',
  options: [
    {
      key: 'players',
      label: 'Players',
      type: 'select',
      default: 4,
      choices: [
        { value: 3, label: '3' },
        { value: 4, label: '4' },
        { value: 5, label: '5 · Big island' },
        { value: 6, label: '6 · Big island' },
        { value: 7, label: '7 · Grand island' },
        { value: 8, label: '8 · Grand island' },
      ],
    },
    {
      key: 'target',
      label: 'Play to',
      type: 'select',
      default: 10,
      choices: [
        { value: 8, label: '8 points (quick)' },
        { value: 10, label: '10 points' },
        { value: 12, label: '12 points (long)' },
      ],
    },
    {
      key: 'friendly',
      label: 'Bandit',
      type: 'select',
      default: false,
      choices: [
        { value: false, label: 'Standard' },
        { value: true, label: 'Friendly (spares players with 2 points)' },
      ],
    },
    {
      key: 'raising',
      label: 'Barn raising (5+ players)',
      type: 'select',
      default: true,
      choices: [
        { value: true, label: 'On — everyone may build between turns' },
        { value: false, label: 'Off' },
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
    redact: E.redact,
    isOver: E.isOver,
  },
  bot: { choose: (view, legal, level) => chooseAction(view, legal, level) },
  // How long a computer player waits before moving (ms at Normal speed)
  pace(state, event, prev) {
    if (!event || event.type === 'start') return 2200;
    const a = event.action;
    if (a?.type === 'roll') return 1700; // let the dice land and the harvest show
    if (state.phase === 'trade') return 1100;
    if (state.phase === 'discard') return 900;
    if (state.phase === 'bandit') return 1100;
    if (a?.type === 'bandit') return 1300;
    if (state.phase === 'setup') return 850;
    if (state.phase === 'raise') return 650;
    if (a?.type === 'end') return 900;
    return 950;
  },
  styles: [new URL('./hexstead.css', import.meta.url).href],
  ui: () => import('./ui.js'),
};
