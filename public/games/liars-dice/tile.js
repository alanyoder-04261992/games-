// Home-page thumbnail for Liar's Dice: a lamp-lit felt table, a leather cup tipped up to show
// its dice, two closed cups across the table and a speech bubble with the last bid.
const W = 400;
const H = 240;

const PIPS = {
  1: [[0.5, 0.5]],
  2: [[0.27, 0.27], [0.73, 0.73]],
  3: [[0.27, 0.27], [0.5, 0.5], [0.73, 0.73]],
  4: [[0.27, 0.27], [0.73, 0.27], [0.27, 0.73], [0.73, 0.73]],
  5: [[0.27, 0.27], [0.73, 0.27], [0.5, 0.5], [0.27, 0.73], [0.73, 0.73]],
  6: [[0.27, 0.25], [0.73, 0.25], [0.27, 0.5], [0.73, 0.5], [0.27, 0.75], [0.73, 0.75]],
};

function die(x, y, s, face, rot = 0, glow = false) {
  const pips = PIPS[face].map(([px, py]) => `<circle cx="${px * s}" cy="${py * s}" r="${s * 0.09}" fill="${face === 1 ? '#c0392b' : '#1d1d24'}"/>`).join('');
  return `<g transform="translate(${x} ${y}) rotate(${rot} ${s / 2} ${s / 2})">
    <rect x="1.5" y="3.5" width="${s}" height="${s}" rx="${s * 0.2}" fill="#000" opacity=".35"/>
    ${glow ? `<rect x="-3" y="-3" width="${s + 6}" height="${s + 6}" rx="${s * 0.26}" fill="none" stroke="#ffd36b" stroke-width="2.5" opacity=".9"/>` : ''}
    <rect width="${s}" height="${s}" rx="${s * 0.2}" fill="url(#ld-ivory)"/>
    <rect x=".8" y=".8" width="${s - 1.6}" height="${s - 1.6}" rx="${s * 0.18}" fill="none" stroke="#fff" stroke-opacity=".8" stroke-width="1"/>
    ${pips}
  </g>`;
}

function cup(cx, by, w, h, tilt = 0) {
  return `<g transform="rotate(${tilt} ${cx} ${by})">
    <ellipse cx="${cx}" cy="${by + 4}" rx="${w * 0.6}" ry="${w * 0.14}" fill="#000" opacity=".4"/>
    <path d="M${cx - w / 2} ${by} L${cx - w * 0.38} ${by - h} Q${cx} ${by - h - 6} ${cx + w * 0.38} ${by - h} L${cx + w / 2} ${by} Q${cx} ${by + 9} ${cx - w / 2} ${by} Z" fill="url(#ld-leather)"/>
    <path d="M${cx - w * 0.46} ${by - h * 0.2} Q${cx} ${by - h * 0.2 + 7} ${cx + w * 0.46} ${by - h * 0.2}" stroke="#e6b35c" stroke-width="2" fill="none" opacity=".75"/>
    <path d="M${cx - w * 0.41} ${by - h * 0.78} Q${cx} ${by - h * 0.78 + 6} ${cx + w * 0.41} ${by - h * 0.78}" stroke="#e6b35c" stroke-width="2" fill="none" opacity=".75"/>
    <path d="M${cx - w * 0.3} ${by - h * 0.9} L${cx - w * 0.36} ${by - h * 0.1}" stroke="#fff" stroke-opacity=".16" stroke-width="5" stroke-linecap="round"/>
  </g>`;
}

export const LIARS_TILE = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  <defs>
    <radialGradient id="ld-felt" cx=".5" cy=".45" r=".75">
      <stop offset="0" stop-color="#2e8a57"/><stop offset=".6" stop-color="#1c6440"/><stop offset="1" stop-color="#0c3321"/>
    </radialGradient>
    <filter id="ld-nap" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="4"/>
      <feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 .22 0"/>
      <feComposite in2="SourceGraphic" operator="in"/>
    </filter>
    <linearGradient id="ld-leather" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#4a2412"/><stop offset=".35" stop-color="#8b4a22"/><stop offset=".7" stop-color="#6a3416"/><stop offset="1" stop-color="#3a1b0c"/>
    </linearGradient>
    <linearGradient id="ld-ivory" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fffdf6"/><stop offset=".6" stop-color="#f1e9d6"/><stop offset="1" stop-color="#d9ccb0"/>
    </linearGradient>
    <radialGradient id="ld-lamp" cx=".5" cy=".38" r=".6">
      <stop offset="0" stop-color="#ffe7b0" stop-opacity=".32"/><stop offset="1" stop-color="#ffe7b0" stop-opacity="0"/>
    </radialGradient>
    <filter id="ld-soft" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="4" stdDeviation="4" flood-opacity=".45"/></filter>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#ld-felt)"/>
  <rect width="${W}" height="${H}" fill="#000" filter="url(#ld-nap)"/>
  <rect width="${W}" height="${H}" fill="url(#ld-lamp)"/>
  <rect x="10" y="10" width="${W - 20}" height="${H - 20}" rx="26" fill="none" stroke="#e6c27a" stroke-opacity=".28" stroke-width="2" stroke-dasharray="2 7"/>

  ${cup(92, 104, 52, 56, -4)}
  ${cup(310, 98, 48, 52, 5)}

  ${cup(205, 150, 74, 78, -58)}
  ${die(150, 160, 34, 4, -12, true)}
  ${die(192, 172, 34, 1, 9, true)}
  ${die(234, 158, 34, 4, 20, true)}
  ${die(278, 178, 34, 6, -6)}
  ${die(118, 196, 30, 2, 14)}

  <g filter="url(#ld-soft)">
    <path d="M232 26 h108 a14 14 0 0 1 14 14 v28 a14 14 0 0 1 -14 14 h-62 l-16 16 l2 -16 h-32 a14 14 0 0 1 -14 -14 v-28 a14 14 0 0 1 14 -14 z" fill="#fffaf0"/>
  </g>
  <text x="262" y="63" font-family="system-ui, sans-serif" font-weight="800" font-size="24" fill="#2a1a10">7 ×</text>
  ${die(306, 39, 28, 4)}
</svg>`;
