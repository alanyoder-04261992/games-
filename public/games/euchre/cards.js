// Card artwork for Euchre, drawn as SVG: a classic white playing card with corner indices,
// pip layouts for the 9 and 10, a big ace pip, and original two-headed court figures.
import { naturalSuit, rankOf, RANK_SHORT, isRed } from './engine.js';

export const INK = { red: '#c8102e', black: '#17181c' };
export const suitInk = (s) => (isRed(s) ? INK.red : INK.black);

// Suit shapes, drawn in a 0..100 box.
export const PIP = {
  H: '<path d="M50 90 C22 68 4 50 4 30 C4 14 16 5 29 5 C39 5 46 11 50 20 C54 11 61 5 71 5 C84 5 96 14 96 30 C96 50 78 68 50 90 Z"/>',
  D: '<path d="M50 2 C60 18 74 36 90 50 C74 64 60 82 50 98 C40 82 26 64 10 50 C26 36 40 18 50 2 Z"/>',
  S: '<path d="M50 4 C62 22 94 38 94 61 C94 75 84 85 71 85 C63 85 57 81 53 75 C54 85 58 91 67 96 L33 96 C42 91 46 85 47 75 C43 81 37 85 29 85 C16 85 6 75 6 61 C6 38 38 22 50 4 Z"/>',
  C: '<circle cx="50" cy="27" r="20"/><circle cx="26" cy="57" r="20"/><circle cx="74" cy="57" r="20"/><circle cx="50" cy="52" r="11"/><path d="M46 52 L54 52 C55 74 60 88 68 96 L32 96 C40 88 45 74 46 52 Z"/>',
};

export function pip(suit, x, y, size, flip = false, fill = suitInk(suit)) {
  const s = size / 100;
  const rot = flip ? ` rotate(180 50 50)` : '';
  return `<g transform="translate(${x - size / 2} ${y - size / 2}) scale(${s})${rot}" fill="${fill}">${PIP[suit]}</g>`;
}

// A suit symbol as a small standalone SVG (for buttons, badges, the score sheet).
export function suitIcon(suit, cls = 'eu-suit-icon') {
  return `<svg viewBox="0 0 100 100" class="${cls}" aria-hidden="true"><g fill="${suitInk(suit)}">${PIP[suit]}</g></svg>`;
}

export const DEFS = `
<svg width="0" height="0" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true">
  <defs>
    <linearGradient id="eu-paper" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffffff"/><stop offset=".7" stop-color="#fcfbf7"/><stop offset="1" stop-color="#f2efe6"/>
    </linearGradient>
    <linearGradient id="eu-court" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff7e0"/><stop offset="1" stop-color="#fbe9bd"/>
    </linearGradient>
    <linearGradient id="eu-back" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#b0182f"/><stop offset=".55" stop-color="#8c0f23"/><stop offset="1" stop-color="#650818"/>
    </linearGradient>
    <pattern id="eu-lattice" width="22" height="22" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="22" height="22" fill="none"/>
      <path d="M0 11 H22 M11 0 V22" stroke="#f3d48a" stroke-opacity=".34" stroke-width="1.4"/>
      <circle cx="11" cy="11" r="2.2" fill="#f3d48a" fill-opacity=".45"/>
    </pattern>
    <radialGradient id="eu-gloss" cx=".3" cy=".1" r="1">
      <stop offset="0" stop-color="#fff" stop-opacity=".3"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
  </defs>
</svg>`;

const W = 250;
const H = 350;
const FONT = "Georgia, 'Times New Roman', serif";
const cache = new Map();

function corner(rank, suit) {
  const ink = suitInk(suit);
  const label = RANK_SHORT[rank];
  return `<text x="30" y="58" text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="${label.length > 1 ? 44 : 50}" letter-spacing="-3" fill="${ink}">${label}</text>
    ${pip(suit, 30, 86, 32)}`;
}

// pip positions (x, y, upside-down?) for the number cards
const COLS = [86, 125, 164];
const ROWS = { top: 84, upper: 141, mid: 175, lower: 209, bottom: 266 };
const LAYOUT = {
  9: [
    [0, 'top'], [0, 'upper'], [0, 'lower'], [0, 'bottom'],
    [2, 'top'], [2, 'upper'], [2, 'lower'], [2, 'bottom'],
    [1, 'mid'],
  ],
  T: [
    [0, 'top'], [0, 'upper'], [0, 'lower'], [0, 'bottom'],
    [2, 'top'], [2, 'upper'], [2, 'lower'], [2, 'bottom'],
    [1, 112], [1, 238],
  ],
};

function frame(inner) {
  return `<svg viewBox="0 0 ${W} ${H}" class="card-svg" aria-hidden="true">
    <rect x="1.5" y="1.5" width="${W - 3}" height="${H - 3}" rx="16" fill="url(#eu-paper)" stroke="#cdcac2" stroke-width="2"/>
    ${inner}
  </svg>`;
}

export function cardFace(card) {
  if (cache.has(card)) return cache.get(card);
  const rank = rankOf(card);
  const suit = naturalSuit(card);
  let body;
  if (rank === 'A') {
    body = `<circle cx="125" cy="175" r="70" fill="none" stroke="${suitInk(suit)}" stroke-opacity=".18" stroke-width="2"/>
      <circle cx="125" cy="175" r="62" fill="none" stroke="${suitInk(suit)}" stroke-opacity=".12" stroke-width="1" stroke-dasharray="3 5"/>
      ${pip(suit, 125, 175, suit === 'S' ? 104 : 92)}`;
  } else if (rank === '9' || rank === 'T') {
    body = LAYOUT[rank]
      .map(([col, row]) => {
        const y = typeof row === 'number' ? row : ROWS[row];
        return pip(suit, COLS[col], y, 44, y > 175);
      })
      .join('');
  } else body = court(rank, suit);
  const svg = frame(`${corner(rank, suit)}<g transform="rotate(180 ${W / 2} ${H / 2})">${corner(rank, suit)}</g>${body}`);
  cache.set(card, svg);
  return svg;
}

// One half of a court card (the top half; the bottom is the same, turned around).
function courtHalf(rank, suit) {
  const ink = suitInk(suit);
  const alt = isRed(suit) ? '#1f3f8f' : '#b3122b';
  const gold = '#e2a72e';
  const skin = '#f6d7b4';
  const hair = rank === 'Q' ? '#c9842f' : rank === 'K' ? '#8a8f98' : '#6b3e1c';
  // headwear
  let hat = '';
  if (rank === 'K')
    hat = `<path d="M100 76 L104 52 L113 66 L125 46 L137 66 L146 52 L150 76 Z" fill="${gold}" stroke="#7a5410" stroke-width="1.6" stroke-linejoin="round"/>
      <circle cx="125" cy="64" r="3.4" fill="${ink}"/><circle cx="111" cy="70" r="2.4" fill="${alt}"/><circle cx="139" cy="70" r="2.4" fill="${alt}"/>`;
  else if (rank === 'Q')
    hat = `<path d="M104 76 C108 62 116 58 125 54 C134 58 142 62 146 76 Z" fill="${gold}" stroke="#7a5410" stroke-width="1.6"/>
      <circle cx="125" cy="58" r="4" fill="${ink}"/><circle cx="113" cy="66" r="2.6" fill="#fff"/><circle cx="137" cy="66" r="2.6" fill="#fff"/>`;
  else
    hat = `<path d="M98 78 C100 60 114 54 128 56 C140 57 150 64 152 78 Z" fill="${ink}" stroke="#2a0a0a" stroke-opacity=".4" stroke-width="1.4"/>
      <path d="M146 64 C160 52 170 40 168 30 C160 40 150 48 140 58 Z" fill="${gold}" stroke="#7a5410" stroke-width="1.2"/>
      <path d="M100 76 H150" stroke="${gold}" stroke-width="3"/>`;
  return `
    <path d="M70 175 C72 140 88 122 104 116 L146 116 C162 122 178 140 180 175 Z" fill="${ink}"/>
    <path d="M86 175 C88 150 100 134 112 128 L138 128 C150 134 162 150 164 175 Z" fill="${alt}" opacity=".9"/>
    <path d="M112 128 L125 175 L138 128" fill="#fff" opacity=".9"/>
    <path d="M104 116 C112 126 138 126 146 116" fill="none" stroke="${gold}" stroke-width="4"/>
    ${rank === 'Q' ? `<path d="M98 84 C92 104 96 118 106 122 M152 84 C158 104 154 118 144 122" fill="none" stroke="${hair}" stroke-width="7" stroke-linecap="round"/>` : ''}
    <ellipse cx="125" cy="94" rx="20" ry="23" fill="${skin}" stroke="#a5754a" stroke-width="1.4"/>
    <path d="M106 86 C108 74 116 70 125 70 C134 70 142 74 144 86 C136 80 114 80 106 86 Z" fill="${hair}"/>
    ${rank === 'K' ? `<path d="M110 102 C112 120 138 120 140 102 C134 108 116 108 110 102 Z" fill="${hair}"/>` : ''}
    <circle cx="117" cy="93" r="2.2" fill="#2b1b10"/><circle cx="133" cy="93" r="2.2" fill="#2b1b10"/>
    <path d="M119 104 C123 107 127 107 131 104" fill="none" stroke="#a5452f" stroke-width="2" stroke-linecap="round"/>
    ${hat}
    ${pip(suit, 125, 154, 20, false, '#fff')}
    ${rank === 'K' ? `<path d="M160 176 L172 102" stroke="${gold}" stroke-width="4" stroke-linecap="round"/><circle cx="172" cy="100" r="6" fill="${gold}"/>` : ''}
    ${rank === 'Q' ? `<path d="M80 168 C76 150 80 140 88 132" stroke="#2f8f5b" stroke-width="3" fill="none"/><circle cx="88" cy="130" r="6" fill="${ink}"/>` : ''}
    ${rank === 'J' ? `<path d="M168 176 L176 120" stroke="#7a5410" stroke-width="4" stroke-linecap="round"/><path d="M170 120 L182 120 L176 106 Z" fill="${gold}"/>` : ''}`;
}

function court(rank, suit) {
  const ink = suitInk(suit);
  return `
    <rect x="56" y="44" width="138" height="262" rx="6" fill="url(#eu-court)" stroke="${ink}" stroke-width="2.2"/>
    <clipPath id="eu-clip-${rank}${suit}"><rect x="57" y="45" width="136" height="260" rx="5"/></clipPath>
    <g clip-path="url(#eu-clip-${rank}${suit})">
      ${courtHalf(rank, suit)}
      <g transform="rotate(180 125 175)">${courtHalf(rank, suit)}</g>
    </g>
    <path d="M56 175 H194" stroke="${ink}" stroke-width="1.4" stroke-opacity=".5"/>
    ${pip(suit, 72, 62, 18)}
    <g transform="rotate(180 125 175)">${pip(suit, 72, 62, 18)}</g>`;
}

export function cardBack() {
  if (cache.has('back')) return cache.get('back');
  const svg = `<svg viewBox="0 0 ${W} ${H}" class="card-svg" aria-hidden="true">
    <rect x="1.5" y="1.5" width="${W - 3}" height="${H - 3}" rx="16" fill="#ffffff" stroke="#cdcac2" stroke-width="2"/>
    <rect x="13" y="13" width="${W - 26}" height="${H - 26}" rx="10" fill="url(#eu-back)"/>
    <rect x="13" y="13" width="${W - 26}" height="${H - 26}" rx="10" fill="url(#eu-lattice)"/>
    <rect x="22" y="22" width="${W - 44}" height="${H - 44}" rx="7" fill="none" stroke="#f3d48a" stroke-opacity=".6" stroke-width="2"/>
    <g transform="translate(125 175)">
      <circle r="46" fill="#650818" stroke="#f3d48a" stroke-width="3"/>
      <circle r="38" fill="none" stroke="#f3d48a" stroke-opacity=".5" stroke-width="1.2"/>
      <g transform="translate(-36 -36) scale(.34)" fill="#f3d48a">${PIP.S}</g>
      <g transform="translate(2 -36) scale(.34)" fill="#f3d48a">${PIP.H}</g>
      <g transform="translate(-36 2) scale(.34)" fill="#f3d48a">${PIP.D}</g>
      <g transform="translate(2 2) scale(.34)" fill="#f3d48a">${PIP.C}</g>
    </g>
    <rect x="13" y="13" width="${W - 26}" height="${H - 26}" rx="10" fill="url(#eu-gloss)"/>
  </svg>`;
  cache.set('back', svg);
  return svg;
}
