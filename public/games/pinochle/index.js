// Pinochle for the Game Center. This is the game's manifest: everything the Game Center needs
// to list it, set it up, run it on the host and seat computer players.
import * as P from './engine.js';
import { chooseAction, LEVELS } from './ai.js';
import { PINOCHLE_TILE as TILE } from './tile.js';

export default {
  id: 'pinochle',
  version: '1.0', // shown on the home tile; bump it whenever you improve the game
  name: 'Pinochle',
  tagline: 'Bid, meld and take tricks with your partner.',
  description:
    'Four-hand partnership Pinochle with a 48-card deck. Win the bid, name trump, pass cards with your partner, lay down your meld — runs, arounds, marriages and the pinochle — then take the counters. First team to 1500 wins.',
  seats: 4,
  seatLabels: P.SEAT_NAMES,
  joinOrder: [2, 1, 3], // the first friend sits across from the host as their partner
  teams: [
    [0, 2],
    [1, 3],
  ],
  players: '1–4 players',
  tile: TILE,
  accent: '#2d6f9a',
  options: [
    {
      key: 'pass',
      label: 'Passing',
      type: 'select',
      default: 4,
      choices: [
        { value: 4, label: 'Partners pass 4 cards' },
        { value: 3, label: 'Partners pass 3 cards' },
        { value: 0, label: 'No passing' },
      ],
    },
    {
      key: 'minBid',
      label: 'Opening bid',
      type: 'select',
      default: 250,
      choices: [
        { value: 200, label: '200' },
        { value: 250, label: '250' },
        { value: 300, label: '300' },
      ],
    },
    {
      key: 'winScore',
      label: 'Play to',
      type: 'select',
      default: 1500,
      choices: [
        { value: 1000, label: '1000 (quick)' },
        { value: 1500, label: '1500' },
        { value: 2500, label: '2500 (long)' },
      ],
    },
  ],
  botLevels: Object.fromEntries(Object.entries(LEVELS).map(([k, v]) => [k, v.label])),

  engine: {
    setup: ({ seed, options }) => P.setup({ seed, options }),
    actors: P.actors,
    legal: P.legal,
    check: P.check,
    apply: P.apply,
    view: P.view,
    redact: P.redact,
    isOver: (s) => s.phase === 'over',
  },

  bot: {
    choose: (view, legal, level) => chooseAction(view, legal, level),
  },

  // How long the host waits before a computer player moves (ms at Normal speed), so people can
  // follow along and the animations finish.
  pace(state, event, prev) {
    if (!event || event.type === 'start') return 2400;
    if (state.phase === 'meld') return prev?.phase === 'meld' ? 400 : 2200;
    if (state.phase === 'score') return 350;
    if (prev && state.round !== prev.round) return 2400;
    if (prev && state.tricks?.length > (prev.tricks?.length || 0)) return 1700;
    if (state.phase === 'play' && prev?.phase !== 'play') return 1200;
    if (state.phase === 'trump' || state.phase === 'passIn' || state.phase === 'passBack') return 1200;
    if (state.phase === 'bid') return 900;
    return 760;
  },

  styles: [new URL('./pinochle.css', import.meta.url).href],
  ui: () => import('./ui.js'),
};
