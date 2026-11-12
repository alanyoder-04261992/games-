// Broadside for the Game Center: a two-admiral naval battle on a 3D sea. Hide your fleet,
// then trade shots until one fleet is on the bottom. This file is the game's manifest.
import * as E from './engine.js';
import { chooseAction, LEVELS } from './ai.js';

const tile = `<svg viewBox="0 0 400 240" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  <rect width="400" height="240" fill="#1b5f86"/>
  <image href="${new URL('./thumb.jpg', import.meta.url).href}" width="400" height="240" preserveAspectRatio="xMidYMid slice"/>
</svg>`;

export default {
  id: 'broadside',
  name: 'Broadside',
  tagline: 'Hide your fleet, then trade shots on a 3D sea.',
  description:
    'Two admirals hide their warships on a grid, then take turns calling shots into the other’s waters. Watch the shells arc in, the water columns rise on a miss, and fires break out on a hit. Sink the whole enemy fleet to win. Play the computer or a friend online.',
  seats: 2,
  seatLabels: ['Blue fleet', 'Red fleet'],
  players: '1–2 players',
  tile,
  accent: '#2f86b8',
  options: [
    {
      key: 'size',
      label: 'Sea',
      type: 'select',
      default: 10,
      choices: [
        { value: 8, label: '8 × 8 · 4 ships (quick)' },
        { value: 10, label: '10 × 10 · 5 ships' },
        { value: 12, label: '12 × 12 · 6 ships (long)' },
      ],
    },
    {
      key: 'mode',
      label: 'Firing',
      type: 'select',
      default: 'classic',
      choices: [
        { value: 'classic', label: 'One shot a turn' },
        { value: 'chain', label: 'Chain fire — a hit fires again' },
        { value: 'barrage', label: 'Barrage — a shot per ship afloat' },
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
  // How long a computer admiral waits (ms at Normal speed): long enough for the last shell to
  // land, burn or sink before the next one flies.
  pace(state, event) {
    if (!event || event.type === 'start') return 1400;
    const a = event.action;
    if (a?.type === 'place') return 700;
    if (a?.type === 'fire') {
      if (state.last?.sunk) return 4600;
      return state.last?.by === state.turn ? 2800 : 3300; // a turn change also swings the camera
    }
    return 1200;
  },
  styles: [new URL('./broadside.css', import.meta.url).href],
  ui: () => import('./ui.js'),
};
