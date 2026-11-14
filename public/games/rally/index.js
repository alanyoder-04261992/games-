// Ridgeline Rally — a real-time 3D racing game in the Game Center.
//
// Like Coastal Dogfight, nobody takes turns. The driving happens inside play.html (loaded in
// a frame by ui.js), every device streams its own car over the room's real-time channel, and
// the host drives the computer cars. The rules engine below only holds the table options and
// records the final classification when the host calls the results, so rematches and the
// "game over" state work like every other game.

const TRACK_IDS = ['ridgeline', 'lakeside', 'hollow', 'cedar', 'harvest', 'mesa', 'mudline'];

function setup({ seed, options }) {
  return { seed, options: { ...options }, over: false, results: null };
}
const actors = () => []; // real-time: no turns
const legal = () => [];
function check(state, seat, move) {
  if (state.over) return 'The race is over';
  if (move?.type !== 'finish') return 'Unknown action';
  return null;
}
function apply(prev, seat, move) {
  const err = check(prev, seat, move);
  if (err) throw new Error(err);
  const s = structuredClone(prev);
  s.over = true;
  s.results = sanitizeResults(move.results);
  return s;
}
const num = (v) => (Number.isFinite(Number(v)) && v !== null ? Number(v) : null);
function sanitizeResults(r = {}) {
  const rows = Array.isArray(r.rows) ? r.rows.slice(0, 12) : [];
  return {
    mode: 'race',
    track: TRACK_IDS.includes(r.track) ? r.track : 'ridgeline',
    laps: Math.max(1, Math.min(20, Number(r.laps) || 1)),
    rows: rows.map((x) => ({
      id: String(x.id || '').slice(0, 12),
      name: String(x.name || 'Driver').slice(0, 20),
      car: String(x.car || '').slice(0, 20),
      color: /^#[0-9a-f]{6}$/i.test(x.color) ? x.color : '#888888',
      gap: String(x.gap || '').slice(0, 16),
      best: num(x.best),
    })),
  };
}
const view = (s) => ({ options: s.options, over: s.over, results: s.results });
const isOver = (s) => s.over;

export const engine = { setup, actors, legal, check, apply, view, isOver };

// Tile art: a real frame from the game (tools/rally-thumbnail.cjs stages and captures it).
const tile = `<svg viewBox="0 0 200 120" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Rally cars race through a corner on a country road">
  <image href="${new URL('./tile.jpg', import.meta.url).href}" width="200" height="120" preserveAspectRatio="xMidYMid slice"/>
</svg>`;

export default {
  id: 'rally',
  version: '2.3', // shown on the home tile; bump it whenever you improve the game
  name: 'Ridgeline Rally',
  tagline: 'Country-road racing over hills, farms and lakeshores. Race your friends or the computer.',
  description:
    'A real-time 3D racing game. Pick a hot hatch, a V8 coupe or a mid-engine GT and race up to four friends and a field of computer cars around seven circuits, from fast farmland sweepers and lakeside hairpins to a dirt stage with jumps. Crash hard enough and your car will wipe out or roll. Works with a keyboard, a gamepad or the touch controls on a phone.',
  seats: 4,
  seatLabels: ['Driver 1', 'Driver 2', 'Driver 3', 'Driver 4'],
  players: '1–4 drivers',
  tile,
  accent: '#ffcc1a',
  options: [
    {
      key: 'track',
      label: 'Circuit',
      type: 'select',
      default: 'ridgeline',
      choices: [{ value: 'ridgeline', label: 'Ridgeline Loop' }, { value: 'lakeside', label: 'Lakeside Sprint' }, { value: 'hollow', label: 'Hollow Creek' }, { value: 'cedar', label: 'Cedar Pass' }, { value: 'harvest', label: 'Harvest Flats' }, { value: 'mesa', label: 'Red Mesa' }, { value: 'mudline', label: 'Mudline Dirt (jumps)' }],
    },
    { key: 'laps', label: 'Laps', type: 'select', default: 3, choices: [{ value: 1, label: '1' }, { value: 2, label: '2' }, { value: 3, label: '3' }, { value: 5, label: '5' }, { value: 10, label: '10' }] },
    { key: 'opponents', label: 'Computer cars', type: 'select', default: 3, choices: [{ value: 0, label: 'None' }, { value: 1, label: '1' }, { value: 2, label: '2' }, { value: 3, label: '3' }, { value: 4, label: '4' }] },
    {
      key: 'difficulty',
      label: 'Computer skill',
      type: 'select',
      default: 'normal',
      choices: [{ value: 'easy', label: 'Easy' }, { value: 'normal', label: 'Normal' }, { value: 'hard', label: 'Hard' }, { value: 'pro', label: 'Pro' }],
    },
  ],
  botLevels: { easy: 'Easy', normal: 'Normal', hard: 'Hard' },
  engine,
  bot: { choose: (view, legalMoves) => legalMoves[0] },
  pace: () => 1000,
  styles: [new URL('./rally.css', import.meta.url).href],
  ui: () => import('./ui.js'),
};
