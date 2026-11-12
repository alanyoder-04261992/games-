// Home-page thumbnail for Four in a Row: the blue rack on a wooden table, a red checker
// dropping in, and a glowing diagonal four.
const W = 400;
const H = 240;
const CELL = 23;
const R = 9.2;
const BX = 119.5; // board left (inside the frame)
const BY = 52; // board top

// 6 rows x 7 columns, top row first. r = red, y = gold.
const GRID = [
  '.......',
  '.......',
  '...r...',
  '..ryr..',
  '.ryyr..',
  'ryrryy.',
];
const WIN = [[0, 5], [1, 4], [2, 3], [3, 2]]; // red diagonal (col, row)

function checker(cx, cy, color) {
  const fill = color === 'r' ? 'url(#ft-red)' : 'url(#ft-gold)';
  const edge = color === 'r' ? '#8e1a12' : '#946700';
  return `<g>
    <circle cx="${cx}" cy="${cy}" r="${R}" fill="${fill}"/>
    <circle cx="${cx}" cy="${cy}" r="${R - 2.6}" fill="none" stroke="${edge}" stroke-opacity=".45" stroke-width="1"/>
    <circle cx="${cx}" cy="${cy}" r="${R - 5}" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width=".9"/>
    <circle cx="${cx}" cy="${cy}" r="${R}" fill="url(#ft-shine)"/>
  </g>`;
}

const cells = [];
const holes = [];
for (let r = 0; r < 6; r++) {
  for (let c = 0; c < 7; c++) {
    const cx = BX + c * CELL + CELL / 2;
    const cy = BY + r * CELL + CELL / 2;
    holes.push(`<circle cx="${cx}" cy="${cy}" r="${R + 0.6}"/>`);
    const v = GRID[r][c];
    if (v !== '.') cells.push(checker(cx, cy, v));
  }
}
const center = (c, r) => [BX + c * CELL + CELL / 2, BY + r * CELL + CELL / 2];
const [x1, y1] = center(...WIN[0]);
const [x2, y2] = center(...WIN[3]);
const dropX = BX + 4 * CELL + CELL / 2;

export const FOUR_TILE = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  <defs>
    <linearGradient id="ft-wood" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#9a6638"/><stop offset=".5" stop-color="#6e4322"/><stop offset="1" stop-color="#40240f"/>
    </linearGradient>
    <filter id="ft-grain" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency=".012 .4" numOctaves="4" seed="9"/>
      <feColorMatrix values="0 0 0 0 .1  0 0 0 0 .05  0 0 0 0 0  0 0 0 .75 0"/>
      <feComposite in2="SourceGraphic" operator="in"/>
    </filter>
    <radialGradient id="ft-lamp" cx=".5" cy=".35" r=".6">
      <stop offset="0" stop-color="#ffe2a8" stop-opacity=".35"/><stop offset="1" stop-color="#ffe2a8" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="ft-plastic" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#5a8ff8"/><stop offset=".5" stop-color="#3268dc"/><stop offset="1" stop-color="#1f47a8"/>
    </linearGradient>
    <radialGradient id="ft-red" cx=".38" cy=".32" r=".75">
      <stop offset="0" stop-color="#ff8a7a"/><stop offset=".55" stop-color="#df3a2c"/><stop offset="1" stop-color="#8e1a12"/>
    </radialGradient>
    <radialGradient id="ft-gold" cx=".38" cy=".32" r=".75">
      <stop offset="0" stop-color="#fff0b0"/><stop offset=".55" stop-color="#f4be16"/><stop offset="1" stop-color="#946700"/>
    </radialGradient>
    <radialGradient id="ft-shine" cx=".32" cy=".26" r=".5">
      <stop offset="0" stop-color="#fff" stop-opacity=".6"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
    <mask id="ft-holes">
      <rect width="${W}" height="${H}" fill="#fff"/>
      <g fill="#000">${holes.join('')}</g>
    </mask>
    <filter id="ft-shadow" x="-20%" y="-20%" width="140%" height="160%">
      <feDropShadow dx="0" dy="10" stdDeviation="9" flood-color="#000" flood-opacity=".55"/>
    </filter>
    <filter id="ft-glow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="3"/>
    </filter>
    <linearGradient id="ft-trail" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ff6b5a" stop-opacity="0"/><stop offset="1" stop-color="#ff6b5a" stop-opacity=".45"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#ft-wood)"/>
  <rect width="${W}" height="${H}" fill="#000" filter="url(#ft-grain)"/>
  <path d="M0 0 V${H} M100 0 V${H} M210 0 V${H} M320 0 V${H}" stroke="#000" stroke-opacity=".28" stroke-width="2"/>
  <rect width="${W}" height="${H}" fill="url(#ft-lamp)"/>

  <ellipse cx="200" cy="${BY + 6 * CELL + 30}" rx="125" ry="12" fill="#000" opacity=".45" style="filter:blur(6px)"/>
  <g filter="url(#ft-shadow)">
    <rect x="${BX - 14}" y="${BY + 6 * CELL - 4}" width="14" height="34" rx="3" fill="#2a58c4"/>
    <rect x="${BX + 7 * CELL}" y="${BY + 6 * CELL - 4}" width="14" height="34" rx="3" fill="#2a58c4"/>
    <rect x="${BX - 30}" y="${BY + 6 * CELL + 24}" width="46" height="8" rx="4" fill="#2f60d0"/>
    <rect x="${BX + 7 * CELL - 16}" y="${BY + 6 * CELL + 24}" width="46" height="8" rx="4" fill="#2f60d0"/>
    <rect x="${BX - 8}" y="${BY - 8}" width="${7 * CELL + 16}" height="${6 * CELL + 18}" rx="12" fill="#0b1a45"/>
  </g>
  <rect x="${BX}" y="${BY}" width="${7 * CELL}" height="${6 * CELL}" fill="#0b1a45"/>
  ${cells.join('')}
  <rect x="${BX - 8}" y="${BY - 8}" width="${7 * CELL + 16}" height="${6 * CELL + 18}" rx="12" fill="url(#ft-plastic)" mask="url(#ft-holes)"/>
  <rect x="${BX - 8}" y="${BY - 8}" width="${7 * CELL + 16}" height="${6 * CELL + 18}" rx="12" fill="none" stroke="#9cc0ff" stroke-opacity=".7" stroke-width="1.5"/>
  <g fill="none" stroke="#0a1a52" stroke-opacity=".5" stroke-width="1.6">${holes.join('')}</g>

  <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#fff" stroke-width="7" stroke-linecap="round" opacity=".8" filter="url(#ft-glow)"/>
  <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".95"/>

  <rect x="${dropX - R}" y="2" width="${R * 2}" height="28" rx="${R}" fill="url(#ft-trail)"/>
  ${checker(dropX, 32, 'r')}
</svg>`;
