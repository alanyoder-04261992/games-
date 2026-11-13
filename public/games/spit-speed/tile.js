// Home-page thumbnail for Spit & Speed: two center piles on green felt, a red and a blue hand
// slapping cards down at the same time, with speed lines.
const W = 400;
const H = 240;
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

function face(x, y, r, s, rot = 0, w = 54) {
  const h = w * 1.4;
  const red = s === 1 || s === 2;
  const ink = red ? '#d3262b' : '#1b1f2a';
  const label = RANKS[r - 1];
  return `<g transform="translate(${x} ${y}) rotate(${rot})">
    <rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" rx="6" fill="#000" opacity=".28" transform="translate(2 4)"/>
    <rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" rx="6" fill="url(#st-card)" stroke="#d6d2c6"/>
    <text x="${-w / 2 + 6}" y="${-h / 2 + 15}" font-size="13" font-weight="800" fill="${ink}" font-family="Georgia, serif">${label}</text>
    <text x="${-w / 2 + 6}" y="${-h / 2 + 27}" font-size="11" fill="${ink}">${SUITS[s]}</text>
    <text x="0" y="${w * 0.22}" font-size="${w * 0.62}" text-anchor="middle" fill="${ink}">${SUITS[s]}</text>
  </g>`;
}
function back(x, y, rot, color, w = 46) {
  const h = w * 1.4;
  return `<g transform="translate(${x} ${y}) rotate(${rot})">
    <rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" rx="5" fill="#000" opacity=".25" transform="translate(2 3)"/>
    <rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" rx="5" fill="#fbf7ee"/>
    <rect x="${-w / 2 + 3}" y="${-h / 2 + 3}" width="${w - 6}" height="${h - 6}" rx="3" fill="url(#st-${color})"/>
  </g>`;
}

export const SPIT_TILE = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  <defs>
    <radialGradient id="st-felt" cx="50%" cy="45%" r="75%">
      <stop offset="0" stop-color="#2f9a5c"/><stop offset=".6" stop-color="#17703f"/><stop offset="1" stop-color="#0a3d22"/>
    </radialGradient>
    <linearGradient id="st-card" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fffdf7"/><stop offset="1" stop-color="#efe9da"/></linearGradient>
    <pattern id="st-red" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="8" height="8" fill="#c8312c"/><rect width="4" height="8" fill="#a8221f"/>
    </pattern>
    <pattern id="st-blue" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="8" height="8" fill="#2f63c9"/><rect width="4" height="8" fill="#1f4aa3"/>
    </pattern>
    <filter id="st-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5"/></filter>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#st-felt)"/>
  <rect x="10" y="10" width="${W - 20}" height="${H - 20}" rx="16" fill="none" stroke="#f3d27a" stroke-opacity=".35" stroke-width="2" stroke-dasharray="2 6"/>

  <!-- opponent's backs (top) and side piles -->
  ${[-2, -1, 0, 1, 2].map((i) => back(200 + i * 34, 22, i * 4, 'blue', 34)).join('')}
  ${back(58, 120, -4, 'red')}${back(62, 116, 2, 'red')}
  ${back(342, 120, 4, 'blue')}${back(338, 116, -2, 'blue')}

  <!-- the two center piles -->
  ${face(160, 122, 6, 3, -8)}${face(158, 118, 7, 1, 4)}
  ${face(244, 122, 12, 0, 7)}${face(242, 120, 13, 2, -3)}

  <!-- speed lines and two cards landing at once -->
  <g stroke="#fff" stroke-linecap="round" opacity=".7">
    <line x1="110" y1="222" x2="138" y2="178" stroke-width="3"/><line x1="96" y1="214" x2="120" y2="176" stroke-width="2"/>
    <line x1="292" y1="222" x2="266" y2="178" stroke-width="3"/><line x1="306" y1="214" x2="282" y2="176" stroke-width="2"/>
  </g>
  <ellipse cx="158" cy="118" rx="40" ry="50" fill="#ffe28a" opacity=".35" filter="url(#st-glow)"/>
  ${face(148, 160, 8, 2, -18, 50)}
  ${face(258, 158, 1, 1, 16, 50)}

  <!-- my hand (bottom) -->
  ${[[-2, 4, 0], [-1, 9, 3], [1, 5, 1], [2, 11, 0]].map(([i, r, s]) => face(200 + i * 30, 236, r, s, i * 6, 44)).join('')}
</svg>`;
