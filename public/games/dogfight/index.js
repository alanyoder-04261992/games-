// Coastal Dogfight — a real-time 3D flight game in the Game Center.
//
// Unlike the card and board games, nobody takes turns here. The flying happens inside
// play.html (loaded in a frame by ui.js), and every device streams its aircraft over the
// room's real-time channel. The rules engine below only does what the Game Center needs
// around that: it holds the table options, and it records the final scoreboard when the
// host ends the round so rematches and the "game over" state work like every other game.

function setup({ seed, options }) {
  return { seed, options: { ...options }, over: false, results: null, round: 1 };
}
const actors = () => []; // real-time: no turns
const legal = () => [];
function check(state, seat, move) {
  if (state.over) return 'The round is over';
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
function sanitizeResults(r = {}) {
  const board = Array.isArray(r.board) ? r.board.slice(0, 8) : [];
  return {
    mode: r.mode === 'versus' ? 'versus' : 'coop',
    reason: String(r.reason || 'ended').slice(0, 20),
    waves: Number(r.waves) || 0,
    W: Number(r.W) || 0,
    board: board.map((b) => ({
      seat: Number(b.seat),
      name: String(b.name || 'Pilot').slice(0, 20),
      kills: Number(b.kills) || 0,
      deaths: Number(b.deaths) || 0,
      bot: !!b.bot,
    })),
  };
}
const view = (s) => ({ options: s.options, over: s.over, results: s.results });
const isOver = (s) => s.over;

export const engine = { setup, actors, legal, check, apply, view, isOver };

// Tile art: a real frame from the game, rendered on the High setting
// (tools/dogfight-thumbnail.cjs stages and captures it).
const tile = `<svg viewBox="0 0 200 120" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="A camouflaged fighter banks after a burning enemy over the coast">
  <image href="${new URL('./tile.jpg', import.meta.url).href}" width="200" height="120" preserveAspectRatio="xMidYMid slice"/>
</svg>`;

export default {
  id: 'dogfight',
  name: 'Coastal Dogfight',
  tagline: '1940s fighters over a 20 km coastline. Fly together against raiders, or shoot each other down.',
  description:
    'A real-time 3D flight game. Take off from the airfield behind the cliffs, then team up against waves of raiders coming in off the sea, or fight a free-for-all where the first pilot to the kill target wins. Works with a mouse, a keyboard, a gamepad or the touch controls on a phone.',
  seats: 4,
  seatLabels: ['Pilot 1', 'Pilot 2', 'Pilot 3', 'Pilot 4'],
  players: '1–4 pilots',
  tile,
  accent: '#eaa53c',
  options: [
    { key: 'mode', label: 'Mode', type: 'select', default: 'coop', choices: [{ value: 'coop', label: 'Co-op vs raiders' }, { value: 'versus', label: 'Free-for-all' }] },
    {
      key: 'difficulty',
      label: 'Difficulty',
      type: 'select',
      default: 'normal',
      choices: [{ value: 'easy', label: 'Easy' }, { value: 'normal', label: 'Normal' }, { value: 'hard', label: 'Hard' }, { value: 'ace', label: 'Ace' }],
    },
    {
      key: 'enemies',
      label: 'Raiders per wave',
      type: 'select',
      default: 'normal',
      choices: [{ value: 'normal', label: 'Standard' }, { value: 1, label: '1' }, { value: 2, label: '2' }, { value: 3, label: '3' }, { value: 4, label: '4' }, { value: 6, label: '6' }, { value: 8, label: '8' }, { value: 12, label: '12' }],
    },
    { key: 'waves', label: 'Waves', type: 'select', default: 3, choices: [{ value: 1, label: '1' }, { value: 2, label: '2' }, { value: 3, label: '3' }, { value: 5, label: '5' }, { value: 8, label: '8' }] },
    { key: 'kills', label: 'Kills to win (free-for-all)', type: 'select', default: 5, choices: [{ value: 3, label: '3' }, { value: 5, label: '5' }, { value: 10, label: '10' }] },
    { key: 'wingmen', label: 'Computer wingmen (co-op)', type: 'select', default: 'off', choices: [{ value: 'off', label: 'Off' }, { value: 'on', label: 'Fill empty seats' }] },
  ],
  botLevels: { easy: 'Rookie', normal: 'Veteran', hard: 'Ace' },
  engine,
  bot: { choose: (view, legalMoves) => legalMoves[0] },
  pace: () => 1000,
  styles: [new URL('./dogfight.css', import.meta.url).href],
  ui: () => import('./ui.js'),
};
