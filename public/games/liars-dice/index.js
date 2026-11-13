// Liar's Dice for the Game Center. This file is the game's manifest: the rules live in
// engine.js, the computer players in ai.js and the screen in ui.js.
import * as E from './engine.js';
import { choose, LEVELS } from './ai.js';
import { LIARS_TILE as TILE } from './tile.js';

export default {
  id: 'liars-dice',
  version: '1.1', // shown on the home tile; bump it whenever you improve the game
  name: "Liar's Dice",
  tagline: 'Hide your dice, raise the bid, call the bluff.',
  description:
    'Everyone rolls in secret under a cup. Take turns raising the bid on how many of a face are on the whole table, or call the last bid a lie. Lose the call and you lose a die. Last player with dice wins. 2 to 6 players, with wild ones and Spot on calls.',
  seats: 4,
  seatCount: (options) => E.playerCount(options),
  players: '1–6 players',
  tile: TILE,
  accent: '#c0392b',
  options: [
    {
      key: 'players',
      label: 'Players',
      type: 'select',
      default: 4,
      choices: [2, 3, 4, 5, 6].map((n) => ({ value: n, label: String(n) })),
    },
    {
      key: 'dice',
      label: 'Dice each',
      type: 'select',
      default: 5,
      choices: [
        { value: 3, label: '3 (quick)' },
        { value: 5, label: '5' },
        { value: 6, label: '6 (long)' },
      ],
    },
    {
      key: 'wild',
      label: 'Ones',
      type: 'select',
      default: true,
      choices: [
        { value: true, label: 'Wild (count as any face)' },
        { value: false, label: 'Plain' },
      ],
    },
    {
      key: 'spotOn',
      label: 'Spot on calls',
      type: 'select',
      default: true,
      choices: [
        { value: true, label: 'On' },
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
    isOver: E.isOver,
  },
  bot: { choose },
  // a quick beat between bids; a long look at the lifted cups before the next roll
  pace: (state) => (state.phase === 'reveal' ? 4200 : state.phase === 'bid' && state.bid == null ? 1300 : 1100),
  styles: [new URL('./liars.css', import.meta.url).href],
  ui: () => import('./ui.js'),
};
