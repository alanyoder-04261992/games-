// Rook for the Game Center. This file is the game's "manifest": everything the Game Center
// needs to list it, set it up, run it on the host, and seat computer players.
import * as R from './engine.js';
import { chooseAction, LEVELS } from './ai.js';

const TILE = `
<svg viewBox="0 0 200 140" aria-hidden="true">
  <defs>
    <linearGradient id="rt-felt" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2f8f5b"/><stop offset="1" stop-color="#11402a"/></linearGradient>
    <linearGradient id="rt-card" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fffdf6"/><stop offset="1" stop-color="#eadfc4"/></linearGradient>
  </defs>
  <rect width="200" height="140" fill="url(#rt-felt)"/>
  <g transform="translate(100 150)">
    <g transform="rotate(-26) translate(-23 -120)"><rect width="46" height="64" rx="6" fill="url(#rt-card)" stroke="#c0392b" stroke-width="2"/><text x="23" y="42" text-anchor="middle" font-family="Playfair Display, Georgia" font-weight="900" font-size="26" fill="#c0392b">14</text></g>
    <g transform="rotate(-9) translate(-23 -124)"><rect width="46" height="64" rx="6" fill="url(#rt-card)" stroke="#24834a" stroke-width="2"/><text x="23" y="42" text-anchor="middle" font-family="Playfair Display, Georgia" font-weight="900" font-size="28" fill="#24834a">1</text></g>
    <g transform="rotate(9) translate(-23 -124)"><rect width="46" height="64" rx="6" fill="url(#rt-card)" stroke="#d99a06" stroke-width="2"/><text x="23" y="42" text-anchor="middle" font-family="Playfair Display, Georgia" font-weight="900" font-size="26" fill="#d99a06">10</text></g>
    <g transform="rotate(26) translate(-23 -120)"><rect width="46" height="64" rx="6" fill="#f3e3b5" stroke="#b8862b" stroke-width="2"/><circle cx="23" cy="32" r="15" fill="#e3c78a" stroke="#b8862b" stroke-width="2"/><path d="M15 38 C14 31 19 26 24 25 C26 22 29 21 31 23 L35 24 L31 26 C32 30 30 34 27 36 C24 39 19 40 15 38Z" fill="#111"/></g>
  </g>
</svg>`;

export default {
  id: 'rook',
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
        { value: true, label: '45 cards (with 6, 7, 8)' },
        { value: false, label: '33 cards (no 6, 7, 8)' },
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
      if (s.trick.plays.length === 0) return { type: 'play', card: R.claimOrder(s.hands[seat], s.trump)[0] };
      const cards = R.legalPlays(s, seat).sort((a, b) => R.cardPoints(a) - R.cardPoints(b) || R.strength(a, s.trump) - R.strength(b, s.trump));
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
