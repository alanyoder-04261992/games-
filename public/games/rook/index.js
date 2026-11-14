// Rook for the Game Center. This file is the game's "manifest": everything the Game Center
// needs to list it, set it up, run it on the host, and seat computer players.
import * as R from './engine.js';
import { chooseAction, LEVELS } from './ai.js';
import { ROOK_TILE as TILE } from './tile.js';


export default {
  id: 'rook',
  version: '2.5', // shown on the home tile; bump it whenever you improve the game
  sameDevice: 'private', // pass and play: several people on one device (hands are hidden: a cover screen between people)
  name: 'Rook',
  tagline: 'The classic trick-taking bidding game for four.',
  description:
    'Two teams of partners bid for the nest, name trump with the first lead, and race to 1000. Bird card, solo 400 and 800 bids, smart computer partners.',
  seats: 4,
  seatLabels: ['South', 'West', 'North', 'East'],
  // the first friend to join sits across from the host as their partner
  joinOrder: [2, 1, 3],
  teams: [
    [0, 2],
    [1, 3],
  ],
  players: '1–4 players',
  tile: TILE,
  accent: '#2f8f5b',
  options: [
    {
      key: 'lowCards',
      label: 'Deck',
      type: 'select',
      default: true,
      choices: [
        { value: true, label: '45 cards (no 2, 3, 4)' },
        { value: false, label: '33 cards (no 2, 3, 4, 6, 7, 8)' },
      ],
    },
    {
      key: 'bird',
      label: 'Bird',
      type: 'select',
      default: 'middle',
      choices: [
        { value: 'middle', label: 'Trump between 10 and 11' },
        { value: 'high', label: 'Highest trump' },
        { value: 'low', label: 'Lowest trump' },
      ],
    },
    {
      key: 'winScore',
      label: 'Play to',
      type: 'select',
      default: 1000,
      choices: [
        { value: 500, label: '500 (quick)' },
        { value: 1000, label: '1000' },
        { value: 1500, label: '1500 (long)' },
      ],
    },
  ],
  botLevels: Object.fromEntries(Object.entries(LEVELS).map(([k, v]) => [k, v.label])),

  engine: {
    setup: ({ seed, options }) => R.setup({ seed, options }),
    actors: R.actors,
    legal: R.legal,
    check: R.check,
    apply: R.apply,
    view: R.view,
    redact: R.redact,
    isOver: (s) => s.phase === 'over',
    // "Claiming": when the leader is sure to take every trick, the round plays itself out.
    claim: (s) => (R.canClaim(s) ? s.round : null),
    claimActive: (s, round) => s.phase === 'play' && s.round === round,
    claimMove: (s, seat) => {
      if (s.phase !== 'play') return null;
      if (s.trick.plays.length === 0) return { type: 'play', card: R.claimOrder(s.hands[seat], s.trump, s.options.bird)[0] };
      const cards = R.legalPlays(s, seat).sort((a, b) => R.cardPoints(a) - R.cardPoints(b) || R.strength(a, s.trump, s.options.bird) - R.strength(b, s.trump, s.options.bird));
      return { type: 'play', card: cards[0] };
    },
  },

  bot: {
    choose: (view, legal, level) => chooseAction(view, legal, level),
  },

  // How long the host waits before a computer player moves (ms at Normal speed), so people
  // can follow along and the animations finish.
  pace(state, event, prev) {
    if (!event || event.type === 'start') return 2600;
    if (state.phase === 'score') return 350;
    if (prev && state.round !== prev.round) return 2600;
    if (prev && state.tricks?.length > (prev.tricks?.length || 0)) return 1900;
    if (prev?.phase === 'play' && state.phase !== 'play') return 1900;
    if (state.phase === 'discard' && prev?.phase !== 'discard') return 1500;
    if (state.phase === 'play' && prev?.phase !== 'play') return 1300;
    if (state.phase === 'bid' || state.phase === 'gift') return 950;
    return 820;
  },

  styles: [new URL('./rook.css', import.meta.url).href],
  ui: () => import('./ui.js'),
};
