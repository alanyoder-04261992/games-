// Home-page thumbnail for Hexstead: a little hex island seen at an angle, with forests,
// fields, a red homestead, a blue barn and silo, a harbor sailboat and a pair of dice.
const W = 400;
const H = 240;
const SX = 26; // hex radius on screen
const SY = 0.58; // vertical squash for the tilted view
const CX = 200;
const CY = 128;
const DEPTH = 9;

const TERR = {
  f: ['#2f6b33', '#1d4620'],
  p: ['#7cbf4a', '#4f8a2c'],
  g: ['#e2b947', '#9c7618'],
  c: ['#c56b3e', '#7e3a1d'],
  q: ['#9298a0', '#5b6168'],
  d: ['#e6cd96', '#a88d56'],
};
// axial (q, r) and terrain
const LAYOUT = [
  [0, -2, 'q'], [1, -2, 'f'], [2, -2, 'p'],
  [-1, -1, 'g'], [0, -1, 'c'], [1, -1, 'f'], [2, -1, 'g'],
  [-2, 0, 'p'], [-1, 0, 'f'], [0, 0, 'd'], [1, 0, 'p'], [2, 0, 'q'],
  [-2, 1, 'c'], [-1, 1, 'g'], [0, 1, 'p'], [1, 1, 'f'],
  [-2, 2, 'f'], [-1, 2, 'q'], [0, 2, 'g'],
];
const NUMS = [10, 2, 9, 12, 6, 4, 10, 9, 11, null, 3, 8, 8, 3, 4, 5, 5, 6, 11];

const center = (q, r) => [CX + Math.sqrt(3) * SX * (q + r / 2), CY + 1.5 * SX * r * SY];
function hexPts(x, y, dy = 0) {
  return Array.from({ length: 6 }, (_, i) => {
    const a = ((60 * i - 30) * Math.PI) / 180;
    return `${(x + Math.cos(a) * SX * 0.95).toFixed(1)},${(y + Math.sin(a) * SX * 0.95 * SY + dy).toFixed(1)}`;
  }).join(' ');
}

function decor(t, x, y, seed) {
  const r = (n) => {
    seed = (seed * 9301 + 49297) % 233280;
    return (seed / 233280) * n;
  };
  const out = [];
  if (t === 'f')
    for (let i = 0; i < 4; i++) {
      const tx = x - 14 + r(28), ty = y - 7 + r(12);
      if (Math.abs(tx - x) < 6 && Math.abs(ty - y) < 4) continue;
      out.push(`<path d="M${tx} ${ty - 15} L${tx + 6} ${ty} L${tx - 6} ${ty}Z" fill="#245a2b"/><path d="M${tx} ${ty - 15} L${tx + 6} ${ty} L${tx} ${ty}Z" fill="#1a4320"/>`);
    }
  if (t === 'g') for (let i = -2; i <= 2; i++) out.push(`<path d="M${x - 15 + i * 2} ${y + i * 3 - 1} l28 -4" stroke="#b8901f" stroke-width="1.6"/>`);
  if (t === 'p')
    for (let i = 0; i < 2; i++) {
      const sx = x - 12 + i * 20 + r(4), sy = y - 3 + r(6);
      out.push(`<ellipse cx="${sx}" cy="${sy}" rx="4.6" ry="3.2" fill="#f6f2e6"/><circle cx="${sx + 4.5}" cy="${sy - 1}" r="1.8" fill="#2e2824"/>`);
    }
  if (t === 'q') out.push(`<path d="M${x - 16} ${y + 2} L${x - 6} ${y - 18} L${x + 2} ${y + 2}Z" fill="#7c838b"/><path d="M${x - 9} ${y - 12} L${x - 6} ${y - 18} L${x - 3} ${y - 12}Z" fill="#fff"/><path d="M${x + 1} ${y + 3} L${x + 10} ${y - 12} L${x + 17} ${y + 3}Z" fill="#9aa1a8"/>`);
  if (t === 'c') out.push(`<ellipse cx="${x - 11}" cy="${y + 1}" rx="7" ry="3.5" fill="#9e4524"/><rect x="${x + 6}" y="${y - 6}" width="9" height="6" fill="#a8432a" stroke="#5a1d0c" stroke-width=".6"/>`);
  return out.join('');
}

function token(x, y, n) {
  if (!n) return '';
  const hot = n === 6 || n === 8;
  return `<ellipse cx="${x}" cy="${y + 1.5}" rx="8.5" ry="5.2" fill="#000" opacity=".25"/><ellipse cx="${x}" cy="${y}" rx="8.5" ry="5.2" fill="#f4e8cc" stroke="#b89b67" stroke-width=".8"/><text x="${x}" y="${y + 3}" font-size="8.5" font-weight="900" text-anchor="middle" font-family="Roboto Slab,Georgia,serif" fill="${hot ? '#b3261e' : '#2a2118'}">${n}</text>`;
}

const tiles = LAYOUT.map(([q, r, t], i) => {
  const [x, y] = center(q, r);
  const [top, side] = TERR[t];
  return `<g><polygon points="${hexPts(x, y, DEPTH)}" fill="${side}"/><polygon points="${hexPts(x, y)}" fill="${top}" stroke="#00000033" stroke-width=".6"/>${decor(t, x, y, i * 7 + 3)}${token(x, y, NUMS[i])}</g>`;
}).join('');

const house = (x, y, c, roof) => `<g><path d="M${x - 7} ${y} v-9 l7 -6 l7 6 v9z" fill="${c}" stroke="#0006" stroke-width=".7"/><path d="M${x - 9} ${y - 8} l9 -8 l9 8" fill="none" stroke="${roof}" stroke-width="3.2" stroke-linejoin="round" stroke-linecap="round"/><rect x="${x - 2}" y="${y - 5}" width="4" height="5" fill="#fff"/></g>`;
const barn = (x, y, c, roof) => `<g><rect x="${x + 9}" y="${y - 22}" width="7" height="22" rx="1.5" fill="#c9ccd1" stroke="#0006" stroke-width=".6"/><path d="M${x + 9} ${y - 22} a3.5 3.5 0 0 1 7 0" fill="${roof}"/><path d="M${x - 11} ${y} v-11 l4 -6 l7 -4 l7 4 l4 6 v11z" fill="${c}" stroke="#0006" stroke-width=".7"/><path d="M${x - 12} ${y - 10} l5 -7 l7 -4 l7 4 l5 7" fill="none" stroke="${roof}" stroke-width="2.6" stroke-linejoin="round"/><rect x="${x - 4.5}" y="${y - 9}" width="9" height="9" fill="none" stroke="#fff" stroke-width="1.2"/><path d="M${x - 4.5} ${y - 9} l9 9 m0 -9 l-9 9" stroke="#fff" stroke-width="1"/></g>`;
const road = (x1, y1, x2, y2, c) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#0005" stroke-width="5.5" stroke-linecap="round"/><line x1="${x1}" y1="${y1 - 1}" x2="${x2}" y2="${y2 - 1}" stroke="${c}" stroke-width="4" stroke-linecap="round"/>`;

export const HEXSTEAD_TILE = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  <defs>
    <linearGradient id="hx-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4f86c2"/><stop offset=".45" stop-color="#9cc6e6"/><stop offset="1" stop-color="#d7e7ee"/></linearGradient>
    <linearGradient id="hx-sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4f9cc4"/><stop offset="1" stop-color="#155f8a"/></linearGradient>
    <radialGradient id="hx-lagoon" cx=".5" cy=".5" r=".5"><stop offset=".7" stop-color="#7fe0d8" stop-opacity=".8"/><stop offset="1" stop-color="#7fe0d8" stop-opacity="0"/></radialGradient>
    <filter id="hx-shadow" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="6" stdDeviation="5" flood-color="#04324d" flood-opacity=".45"/></filter>
    <radialGradient id="hx-sun" cx=".22" cy=".12" r=".5"><stop offset="0" stop-color="#fff6d8" stop-opacity=".85"/><stop offset="1" stop-color="#fff6d8" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#hx-sky)"/>
  <rect y="58" width="${W}" height="${H - 58}" fill="url(#hx-sea)"/>
  <path d="M0 80 Q100 74 200 78 T400 76" stroke="#ffffff" stroke-opacity=".25" fill="none"/>
  <path d="M0 200 Q60 196 120 200 T240 199 T400 201" stroke="#ffffff" stroke-opacity=".2" fill="none"/>
  <ellipse cx="${CX}" cy="${CY + 8}" rx="170" ry="80" fill="url(#hx-lagoon)"/>
  <g filter="url(#hx-shadow)">
    <ellipse cx="${CX}" cy="${CY + 10}" rx="145" ry="62" fill="#c9ab70"/>
    <ellipse cx="${CX}" cy="${CY + 4}" rx="145" ry="62" fill="#e8d09a"/>
  </g>
  ${tiles}
  ${road(...center(-1, 0), ...center(-1, 0).map((v, i) => v + (i ? -12 : 14)), '#c8372d')}
  ${house(center(-1, 0)[0] + 0, center(-1, 0)[1] - 6, '#c8372d', '#7c1f18')}
  ${road(center(1, 0)[0] + 22, center(1, 0)[1] + 8, center(1, 0)[0] + 22, center(1, 0)[1] + 26, '#2f6fd6')}
  ${barn(center(1, 0)[0] + 22, center(1, 0)[1] + 9, '#2f6fd6', '#183b78')}
  ${house(center(0, -1)[0] - 22, center(0, -1)[1] - 6, '#e8892b', '#8a4c12')}
  ${house(center(0, 1)[0] + 23, center(0, 1)[1] + 9, '#efe6d2', '#8c8170')}
  <g transform="translate(332 186)">
    <path d="M-16 0 Q0 9 18 0 L14 -3 H-13Z" fill="#7a4b2a"/><rect x="-1" y="-30" width="1.6" height="28" fill="#5a3a20"/><path d="M1 -29 V-5 H15Z" fill="#fbf6ea"/>
  </g>
  <g transform="translate(70 186) rotate(-12)">
    <rect x="-11" y="-11" width="22" height="22" rx="5" fill="#f4ecd8" stroke="#0005"/><circle cx="-5" cy="-5" r="2.2" fill="#2a2118"/><circle cx="5" cy="5" r="2.2" fill="#2a2118"/><circle cx="0" cy="0" r="2.2" fill="#2a2118"/>
  </g>
  <g transform="translate(97 196) rotate(14)">
    <rect x="-11" y="-11" width="22" height="22" rx="5" fill="#c0392b" stroke="#0005"/><circle cx="-5" cy="-5" r="2.1" fill="#fff"/><circle cx="5" cy="-5" r="2.1" fill="#fff"/><circle cx="-5" cy="5" r="2.1" fill="#fff"/><circle cx="5" cy="5" r="2.1" fill="#fff"/>
  </g>
  <rect width="${W}" height="${H}" fill="url(#hx-sun)"/>
</svg>`;
