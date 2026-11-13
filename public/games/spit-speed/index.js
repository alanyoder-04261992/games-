// Spit & Speed for the Game Center: the manifest. Rules are in engine.js, the computer player
// in ai.js, the screen in ui.js.
import * as E from './engine.js';
import { choose, LEVELS } from './ai.js';
import { SPIT_TILE as TILE } from './tile.js';

export default {
  id: 'spit-speed',
  version: '1.1', // shown on the home tile; bump it whenever you improve the game
  name: 'Spit & Speed',
  tagline: 'No turns, just fast hands. Race to get rid of your cards.',
  description:
    'Two real-time card games in one. Both players play at the same time, laying cards one higher or one lower onto the center piles — Ace and King wrap around. Speed: empty your hand and draw pile first. Spit: clear your five stockpiles, slap the smaller pile, and play rounds until one of you is out of cards. Play the computer or a friend online.',
  seats: 2,
  seatLabels: ['Red', 'Blue'],
  joinOrder: [1],
  players: '1–2 players',
  tile: TILE,
  accent: '#e2463f',
  options: [
    {
      key: 'mode',
      label: 'Game',
      type: 'select',
      default: 'speed',
      choices: [
        { value: 'speed', label: 'Speed — hand of 5 and a draw pile' },
        { value: 'spit', label: 'Spit — five stockpiles, slap between rounds' },
      ],
    },
    {
      key: 'wrap',
      label: 'Ace and King',
      type: 'select',
      default: 'yes',
      choices: [
        { value: 'yes', label: 'Wrap around (K–A–2)' },
        { value: 'no', label: 'Ace is low only' },
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
  bot: { choose: (view, legal, level) => choose(view, legal, level) },
  // Both players act at once: each computer keeps its own reaction clock (see core/room.js).
  realtime: true,
  // How long a computer takes to react. This is what the difficulty mostly changes.
  pace(state, event, prev, who) {
    const L = LEVELS[who?.level] || LEVELS.normal;
    const jitter = 0.75 + Math.random() * 0.5;
    if (!event || event.type === 'start') return 1600;
    if (state.phase === 'ready') return L.ready * jitter;
    if (state.phase === 'slap') return L.slap * jitter;
    // a fresh flip: give everyone a moment to see the new cards
    if (prev && prev.phase === 'ready') return (L.play + 250) * jitter;
    return L.play * jitter;
  },
  styles: [new URL('./spit-speed.css', import.meta.url).href],
  ui: () => import('./ui.js'),
};
