// Hexstead for the Game Center: settle a hex island in 3D, harvest and trade resources,
// build homesteads, barns and trails. This file is the game's manifest.
import * as E from './engine.js';
import { chooseAction, LEVELS } from './ai.js';
import { HEXSTEAD_TILE as TILE } from './tile.js';

export default {
  id: 'hexstead',
  name: 'Hexstead',
  tagline: 'Settle a 3D hex island. Harvest, trade, build barns.',
  description:
    'Roll for timber, brick, wool, grain and stone. Lay trails, raise homesteads and upgrade them to barns, trade with the table or the harbors, and keep the bandit off your fields. First to the target score wins.',
  seats: 4,
  seatLabels: ['Red', 'Blue', 'Ivory', 'Orange'],
  players: '1–4 players',
  tile: TILE,
  accent: '#d9813b',
  options: [
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
    if (a?.type === 'end') return 900;
    return 950;
  },
  styles: [new URL('./hexstead.css', import.meta.url).href],
  ui: () => import('./ui.js'),
};
