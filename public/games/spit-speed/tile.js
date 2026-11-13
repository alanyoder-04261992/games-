// Home-page thumbnail for Spit & Speed: the moment both players slap a card down at once.
// Two center piles on red felt, a red-backed 8 streaking in from the bottom left and a
// blue-backed 10 from the top right, with motion trails, speed lines and impact sparks.
// Suits are drawn as paths (not text) so they never turn into emoji on a phone.
const W = 400;
const H = 240;
const CW = 64; // card width
const CH = CW * 1.4;

const SUIT_PATHS = {
  H: 'M50 90 C20 68 4 50 4 31 C4 15 16 5 29 5 C39 5 46 11 50 21 C54 11 61 5 71 5 C84 5 96 15 96 31 C96 50 80 68 50 90Z',
  D: 'M50 3 L86 50 L50 97 L14 50Z',
  S: 'M50 3 C40 22 6 38 6 60 C6 75 17 83 29 83 C38 83 44 79 47 73 C46 84 42 91 34 96 H66 C58 91 54 84 53 73 C56 79 62 83 71 83 C83 83 94 75 94 60 C94 38 60 22 50 3Z',
  C: 'M50 6 A21 21 0 0 1 66 41 A21 21 0 1 1 55 73 C55 84 59 91 66 96 H34 C41 91 45 84 45 73 A21 21 0 1 1 34 41 A21 21 0 0 1 50 6Z',
};
const RED = { H: true, D: true };
const ink = (s) => (RED[s] ? '#c8162b' : '#16181e');

// pip rows (0 = top, 1 = bottom) for the left/right columns and the middle column
const LAYOUT = {
  5: { side: [0, 1], mid: [0.5] },
  6: { side: [0, 0.5, 1], mid: [] },
  7: { side: [0, 0.5, 1], mid: [0.25] },
  8: { side: [0, 0.5, 1], mid: [0.25, 0.75] },
  9: { side: [0, 1 / 3, 2 / 3, 1], mid: [0.5] },
  10: { side: [0, 1 / 3, 2 / 3, 1], mid: [1 / 6, 5 / 6] },
};

const suit = (s, x, y, size, flip = false) =>
  `<use href="#ss-${s}" x="${x - size / 2}" y="${y - size / 2}" width="${size}" height="${size}" fill="${ink(s)}"${flip ? ` transform="rotate(180 ${x} ${y})"` : ''}/>`;

function face(rank, s) {
  const label = rank === 10 ? '10' : String(rank);
  const pips = [];
  const { side, mid } = LAYOUT[rank];
  const y = (t) => CH * 0.2 + t * CH * 0.6;
  const p = CW * 0.2;
  for (const t of side) for (const x of [CW * 0.3, CW * 0.7]) pips.push(suit(s, x, y(t), p, t > 0.5));
  for (const t of mid) pips.push(suit(s, CW / 2, y(t), p, t > 0.5));
  const corner = (flip) =>
    `<g${flip ? ` transform="rotate(180 ${CW / 2} ${CH / 2})"` : ''}>
      <text x="${rank === 10 ? 3.2 : 4.5}" y="13.5" font-family="Georgia, 'Times New Roman', serif" font-weight="700" font-size="${rank === 10 ? 11 : 12.5}" letter-spacing="-0.6" fill="${ink(s)}">${label}</text>
      ${suit(s, 8.6, 21, 8)}
    </g>`;
  return `<rect width="${CW}" height="${CH}" rx="5.5" fill="url(#ss-paper)"/>
    <rect x=".5" y=".5" width="${CW - 1}" height="${CH - 1}" rx="5" fill="none" stroke="#000" stroke-opacity=".16"/>
    ${pips.join('')}${corner(false)}${corner(true)}`;
}

function back(color) {
  return `<rect width="${CW}" height="${CH}" rx="5.5" fill="#fbf7ee"/>
    <rect x=".5" y=".5" width="${CW - 1}" height="${CH - 1}" rx="5" fill="none" stroke="#000" stroke-opacity=".2"/>
    <rect x="4.5" y="4.5" width="${CW - 9}" height="${CH - 9}" rx="3" fill="url(#ss-${color})"/>
    <rect x="7.5" y="7.5" width="${CW - 15}" height="${CH - 15}" rx="2" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="1.2"/>`;
}

// a card centred on (x, y), turned by rot degrees
const place = (x, y, rot, body, extra = '') =>
  `<g transform="translate(${x} ${y}) rotate(${rot}) translate(${-CW / 2} ${-CH / 2})" ${extra}>${body}</g>`;
const card = (x, y, rot, body) => place(x, y, rot, body, 'filter="url(#ss-shadow)"');

// the blur trail behind a moving card: fading paper-coloured ghosts back along its path
function trail(x, y, rot, dx, dy, tint) {
  let out = '';
  for (let i = 4; i >= 1; i--)
    out += place(x + dx * i, y + dy * i, rot - i * 2.5, `<rect width="${CW}" height="${CH}" rx="6" fill="${tint}" opacity="${0.26 - i * 0.05}"/>`);
  return out;
}

// a center pile: two cards peeking out underneath a top card
const pile = (x, y, under, topCard, topRot) =>
  under.map(([r, s, rot, ox, oy]) => card(x + ox, y + oy, rot, face(r, s))).join('') + card(x, y, topRot, topCard);

// side piles: a few backs stacked with a little offset
const stack = (x, y, color, rot) => [0, 1, 2].map((i) => card(x - i * 1.6, y - i * 2.2, rot + i * 1.5, back(color))).join('');

function spark(x, y, r, rot = 0) {
  const rays = Array.from({ length: 8 }, (_, i) => {
    const a = ((i * 45 + rot) * Math.PI) / 180;
    const len = i % 2 ? r * 0.55 : r;
    return `<line x1="${x + Math.cos(a) * r * 0.32}" y1="${y + Math.sin(a) * r * 0.32}" x2="${x + Math.cos(a) * len}" y2="${y + Math.sin(a) * len}"/>`;
  }).join('');
  return `<g stroke="#fff3c4" stroke-width="2.4" stroke-linecap="round">${rays}</g><circle cx="${x}" cy="${y}" r="${r * 0.18}" fill="#fff8dc"/>`;
}

const speedLines = (lines) =>
  lines.map(([x1, y1, x2, y2, w, o]) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke-width="${w}" stroke-opacity="${o}"/>`).join('');

const LX = 158; // left center pile
const RX = 246; // right center pile
const PY = 130;

export const SPIT_TILE = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  <defs>
    ${Object.entries(SUIT_PATHS).map(([k, d]) => `<symbol id="ss-${k}" viewBox="0 0 100 100"><path d="${d}"/></symbol>`).join('')}
    <radialGradient id="ss-felt" cx=".5" cy=".46" r=".78">
      <stop offset="0" stop-color="#c3322f"/><stop offset=".42" stop-color="#8e1a1d"/><stop offset=".8" stop-color="#4a0b0e"/><stop offset="1" stop-color="#260506"/>
    </radialGradient>
    <radialGradient id="ss-light" cx=".5" cy=".42" r=".5">
      <stop offset="0" stop-color="#ffe7b0" stop-opacity=".32"/><stop offset="1" stop-color="#ffe7b0" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="ss-paper" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fffdf6"/><stop offset="1" stop-color="#eee7d6"/></linearGradient>
    <pattern id="ss-red" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="7" height="7" fill="#c7302b"/><rect width="3.5" height="7" fill="#a11f1c"/>
    </pattern>
    <pattern id="ss-blue" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="7" height="7" fill="#2f66cc"/><rect width="3.5" height="7" fill="#1d469d"/>
    </pattern>
    <filter id="ss-grain" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="11"/>
      <feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 .2 0"/>
      <feComposite in2="SourceGraphic" operator="in"/>
    </filter>
    <filter id="ss-shadow" x="-40%" y="-40%" width="180%" height="180%">
      <feDropShadow dx="1" dy="5" stdDeviation="4.5" flood-color="#000" flood-opacity=".5"/>
    </filter>
    <filter id="ss-glow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="9"/></filter>
    <linearGradient id="ss-rail" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#8a5a32"/><stop offset=".45" stop-color="#5e3a1d"/><stop offset="1" stop-color="#2c170a"/>
    </linearGradient>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#ss-felt)"/>
  <rect width="${W}" height="${H}" fill="#000" filter="url(#ss-grain)"/>
  <ellipse cx="202" cy="124" rx="150" ry="86" fill="none" stroke="#ffd98a" stroke-opacity=".16" stroke-width="1.5" stroke-dasharray="1 6" stroke-linecap="round"/>
  <rect width="${W}" height="${H}" fill="url(#ss-light)"/>

  <!-- side piles: yours (red) and theirs (blue) -->
  ${stack(62, 128, 'red', -6)}
  ${stack(344, 124, 'blue', 5)}

  <!-- warm glow under the action -->
  <ellipse cx="202" cy="126" rx="78" ry="56" fill="#ffcf6a" opacity=".22" filter="url(#ss-glow)"/>

  <!-- the two center piles -->
  ${pile(LX, PY, [[5, 'S', -14, -3, 3], [6, 'H', 9, 2, 1]], face(7, 'C'), -3)}
  ${pile(RX, PY, [[10, 'D', 12, 3, 2], [8, 'C', -9, -2, 1]], face(9, 'H'), 4)}

  <!-- speed lines -->
  <g stroke="#fff" stroke-linecap="round">
    ${speedLines([[28, 238, 84, 196, 3, 0.5], [6, 214, 66, 178, 2, 0.35], [70, 246, 108, 216, 2, 0.4], [44, 196, 76, 176, 1.4, 0.3]])}
    ${speedLines([[300, -6, 290, 22, 3, 0.5], [322, -4, 310, 30, 2, 0.35], [278, -8, 270, 14, 2, 0.4], [334, 10, 324, 34, 1.4, 0.3]])}
  </g>

  <!-- the slap: an 8 onto the 7, a 10 onto the 9, both at once -->
  ${trail(122, 166, -26, -14, 11, '#ffe9c2')}
  ${card(122, 166, -26, face(8, 'D'))}
  ${trail(282, 78, 22, 7, -13, '#d7e4ff')}
  ${card(282, 78, 22, face(10, 'S'))}

  ${spark(140, 110, 15, 10)}
  ${spark(258, 108, 14, 30)}

  <path d="M0 ${H - 14} H${W} V${H} H0Z" fill="url(#ss-rail)"/>
  <path d="M0 ${H - 14} H${W}" stroke="#c08a52" stroke-opacity=".6"/>
  <rect width="${W}" height="${H}" fill="none" stroke="#000" stroke-opacity=".35" stroke-width="30" style="filter:blur(14px)"/>
</svg>`;
