// Roofline for the Game Center: draft bundles of shingles from the lumber yard and lay out the
// best-looking shed roof. This file is the game's manifest.
import * as E from './engine.js';
import { chooseAction, LEVELS } from './ai.js';

const SH = ['#b9773e', '#5f7a90', '#b8352c', '#3f7d48', '#d8bf86'];
function tileArt() {
  // a shed whose roof is half shingled, with a pallet of bundles in front
  let roof = '';
  for (let r = 0; r < 5; r++)
    for (let c = 0; c < 5; c++) {
      const filled = (r * 7 + c * 3) % 4 !== 0 || r === 4;
      const k = SH[(c + 2 * r) % 5];
      roof += `<rect x="${150 + c * 22}" y="${46 + r * 22}" width="20" height="20" rx="2" fill="${filled ? k : '#00000040'}" ${filled ? '' : `stroke="${k}" stroke-opacity=".6"`}/>`;
      if (filled) roof += `<rect x="${150 + c * 22}" y="${56 + r * 22}" width="20" height="2" fill="#0004"/>`;
    }
  const bundles = [0, 2, 2, 3].map((k, i) => `<rect x="${44 + (i % 2) * 24}" y="${150 + Math.floor(i / 2) * 24}" width="21" height="21" rx="2" fill="${SH[k]}"/><rect x="${44 + (i % 2) * 24}" y="${160 + Math.floor(i / 2) * 24}" width="21" height="2" fill="#0004"/>`).join('');
  return `<svg viewBox="0 0 400 240" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  <defs><linearGradient id="rlsky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f2b56b"/><stop offset="1" stop-color="#7c4a2c"/></linearGradient></defs>
  <rect width="400" height="240" fill="url(#rlsky)"/>
  <rect y="190" width="400" height="50" fill="#3b2a1c"/>
  <path d="M130 46 L205 6 L280 46 Z" fill="#4b3a2c"/>
  <rect x="140" y="40" width="130" height="6" fill="#6b5442"/>
  <rect x="142" y="44" width="126" height="118" fill="#3a2d22"/>
  ${roof}
  <rect x="150" y="162" width="110" height="34" fill="#8a3b2a"/><rect x="190" y="166" width="30" height="30" fill="#5a2418"/>
  <rect x="34" y="196" width="66" height="10" fill="#7e5530"/><rect x="34" y="144" width="66" height="54" fill="#a77b4c" opacity=".55"/>
  ${bundles}
  <circle cx="330" cy="176" r="16" fill="#e1ad3d"/><text x="330" y="182" font-size="16" text-anchor="middle">📣</text>
</svg>`;
}

export default {
  id: 'roofline',
  version: '1.0', // shown on the home tile; bump it whenever you improve the game
  name: 'Roofline',
  tagline: 'Draft shingle bundles, lay the best shed roof.',
  description:
    'Pallets of shingle bundles arrive in the lumber yard. Take every bundle of one color from a pallet (the rest slide into the yard) and stack them on your staging racks. A full rack nails a shingle onto your roof, and shingles score more the more they touch. Overflow lands in the gutter and costs you. When someone finishes a whole roof row, bonuses for rows, columns and colors decide the winner. 2–4 roofers.',
  seats: 2,
  seatCount: (options) => Math.min(4, Math.max(2, Number(options?.players) || 2)),
  seatLabels: ['Roofer 1', 'Roofer 2', 'Roofer 3', 'Roofer 4'],
  players: '1–4 players',
  tile: tileArt(),
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
