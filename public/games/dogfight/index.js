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

const tile = `<svg viewBox="0 0 200 140" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="df-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3d6aa3"/><stop offset="1" stop-color="#c3d3df"/></linearGradient>
    <linearGradient id="df-sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b6a72"/><stop offset="1" stop-color="#123a4c"/></linearGradient>
  </defs>
  <rect width="200" height="140" fill="url(#df-sky)"/>
  <ellipse cx="44" cy="38" rx="26" ry="9" fill="#fff" opacity=".85"/><ellipse cx="60" cy="33" rx="16" ry="8" fill="#fff" opacity=".9"/>
  <ellipse cx="160" cy="26" rx="20" ry="7" fill="#fff" opacity=".8"/>
  <path d="M0 98 L40 88 L70 92 L96 84 L120 96 L120 140 L0 140Z" fill="#5f7d3e"/>
  <path d="M96 84 L120 96 L104 99Z" fill="#d6cfb4"/>
  <rect x="0" y="98" width="200" height="42" fill="url(#df-sea)" opacity=".0"/>
  <path d="M112 97 L200 92 L200 140 L118 140Z" fill="url(#df-sea)"/>
  <g transform="translate(100 62) rotate(-12)">
    <ellipse cx="0" cy="0" rx="46" ry="9" fill="#4a5833"/>
    <ellipse cx="0" cy="2" rx="46" ry="5" fill="#7b6744" opacity=".7"/>
    <rect x="-5" y="-6" width="10" height="34" rx="5" fill="#4a5833"/>
    <ellipse cx="0" cy="-7" rx="9" ry="3" fill="#1d1f1d" opacity=".5"/>
    <circle cx="-30" cy="0" r="4.5" fill="#2b3f6e"/><circle cx="-30" cy="0" r="2.2" fill="#a9302b"/>
    <circle cx="30" cy="0" r="4.5" fill="#2b3f6e"/><circle cx="30" cy="0" r="2.2" fill="#a9302b"/>
    <ellipse cx="0" cy="27" rx="15" ry="3.5" fill="#4a5833"/>
  </g>
  <g transform="translate(160 64) rotate(18) scale(.42)" opacity=".9">
    <ellipse cx="0" cy="0" rx="42" ry="7" fill="#6d777b"/><rect x="-4" y="-6" width="8" height="30" rx="4" fill="#6d777b"/><circle cx="0" cy="-8" r="4" fill="#d4ab2e"/>
  </g>
  <path d="M120 60 L150 63" stroke="#ffd27a" stroke-width="2" stroke-linecap="round" opacity=".9"/>
  <path d="M126 66 L154 68" stroke="#ffd27a" stroke-width="2" stroke-linecap="round" opacity=".7"/>
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
