// Roofline for the Game Center: draft bundles of shingles from the lumber yard and lay out the
// best-looking shed roof. This file is the game's manifest.
import * as E from './engine.js';
import { chooseAction, LEVELS } from './ai.js';

// Home-page thumbnail: a 3D render of a shed mid-shingle (thumb.jpg, made with
// tools/render-roofline-thumb.cjs), wrapped in an SVG like the other games' tile art.
const TILE = `<svg viewBox="0 0 400 240" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  <rect width="400" height="240" fill="#c9a26e"/>
  <image href="${new URL('./thumb.jpg', import.meta.url).href}" width="400" height="240" preserveAspectRatio="xMidYMid slice"/>
</svg>`;

export default {
  id: 'roofline',
  version: '1.2', // shown on the home tile; bump it whenever you improve the game
  sameDevice: 'open', // pass and play: several people on one device (everything is on the table)
  name: 'Roofline',
  tagline: 'Draft shingle bundles, lay the best shed roof.',
  description:
    'Pallets of shingle bundles arrive in the lumber yard. Take every bundle of one color from a pallet (the rest slide into the yard) and stack them on your staging racks. A full rack nails a shingle onto your roof, and shingles score more the more they touch. Overflow lands in the gutter and costs you. When someone finishes a whole roof row, bonuses for rows, columns and colors decide the winner. 2–4 roofers.',
  seats: 2,
  seatCount: (options) => Math.min(4, Math.max(2, Number(options?.players) || 2)),
  seatLabels: ['Roofer 1', 'Roofer 2', 'Roofer 3', 'Roofer 4'],
  players: '1–4 players',
  tile: TILE,
  accent: '#c9783d',
  options: [
    {
      key: 'players',
      label: 'Players',
      type: 'select',
      default: 2,
      choices: [
        { value: 2, label: '2 · 5 pallets' },
        { value: 3, label: '3 · 7 pallets' },
        { value: 4, label: '4 · 9 pallets' },
      ],
    },
    {
      key: 'dormers',
      label: 'Dormers',
      type: 'select',
      default: true,
      choices: [
        { value: true, label: 'On — three ★ squares worth +2' },
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
  bot: { choose: (view, legal, level) => chooseAction(view, legal, level) },
  // ms a computer waits before picking: longer after a round is nailed down
  pace(state, event, prev) {
    if (!event || event.type === 'start') return 1300;
    if (prev && prev.round !== state.round) return 2600;
    return 1000;
  },
  styles: [new URL('./roofline.css', import.meta.url).href],
  ui: () => import('./ui.js'),
};
