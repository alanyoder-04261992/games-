// Euchre for the Game Center. This file is the game's "manifest": everything the Game Center
// needs to list it, set it up, run it on the host, and seat computer players.
import * as E from './engine.js';
import { chooseAction, LEVELS } from './ai.js';
import { EUCHRE_TILE as TILE } from './tile.js';

export default {
  id: 'euchre',
  version: '1.0', // shown on the home tile; bump it whenever you improve the game
  name: 'Euchre',
  tagline: 'Bowers, loners and a quick race to 10 with your partner.',
  description:
    'The classic partnership trick-taking game. Order up the turned card or name trump, ride the right and left bowers, go alone for 4 points, and euchre the other side when they overreach. Smart computer partners fill any empty seat.',
  seats: 4,
  seatLabels: E.SEAT_NAMES,
  // the first friend to join sits across from the host as their partner
  joinOrder: [2, 1, 3],
  teams: [
    [0, 2],
    [1, 3],
  ],
  players: '1–4 players',
  tile: TILE,
  accent: '#c8102e',
  options: [
    {
      key: 'winScore',
      label: 'Play to',
      type: 'select',
      default: 10,
      choices: [
        { value: 5, label: '5 points (quick)' },
        { value: 10, label: '10 points' },
        { value: 15, label: '15 points (long)' },
      ],
    },
    {
      key: 'stickDealer',
      label: 'If everyone passes twice',
      type: 'select',
      default: false,
      choices: [
        { value: false, label: 'Deal again' },
        { value: true, label: 'Stick the dealer (must call)' },
      ],
    },
    {
      key: 'allowAlone',
      label: 'Going alone',
      type: 'select',
      default: true,
      choices: [
        { value: true, label: 'Allowed' },
        { value: false, label: 'Not allowed' },
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
    redact: E.redact,
    isOver: (s) => s.phase === 'over',
  },

  bot: {
    choose: (view, legal, level) => chooseAction(view, legal, level),
  },

  // How long the host waits before a computer player moves (ms at Normal speed), so people
  // can follow along and the animations finish.
  pace(state, event, prev) {
    if (!event || event.type === 'start') return 2400;
    if (state.phase === 'score') return 350;
    if (prev && state.round !== prev.round) return 2400; // a fresh deal
    if (prev && state.tricks?.length > (prev.tricks?.length || 0)) return 1700;
    if (prev?.phase === 'play' && state.phase !== 'play') return 1700;
    if (state.phase === 'discard' && prev?.phase !== 'discard') return 1300;
    if (state.phase === 'play' && prev?.phase !== 'play') return 1300;
    if (state.phase === 'call' && prev?.phase === 'order') return 1200;
    if (state.phase === 'order' || state.phase === 'call') return 900;
    return 780;
  },

  styles: [new URL('./euchre.css', import.meta.url).href],
  ui: () => import('./ui.js'),
};
