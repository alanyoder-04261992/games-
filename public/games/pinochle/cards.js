// Pinochle card art, drawn as SVG: classic white cards with corner indexes, pip layouts for the
// 9s and 10s, a big pip on the Aces, and framed court cards with a simple crown or cap.
// The card back is an original design.
import { rankOf, suitOf, RANK_LABEL } from './engine.js';

export const SUIT_INK = { S: '#1d1d22', C: '#1d1d22', H: '#c4202f', D: '#c4202f' };

// Suit shapes in a 0..100 box.
export const SUIT_PATH = {
  H: '<path d="M50 90 C22 68 4 52 4 31 C4 15 16 5 30 5 C40 5 47 11 50 19 C53 11 60 5 70 5 C84 5 96 15 96 31 C96 52 78 68 50 90 Z"/>',
  D: '<path d="M50 3 L88 50 L50 97 L12 50 Z"/>',
  S: '<path d="M50 4 C66 24 96 40 96 62 C96 76 86 84 74 84 C64 84 57 79 54 73 C55 83 59 90 67 96 L33 96 C41 90 45 83 46 73 C43 79 36 84 26 84 C14 84 4 76 4 62 C4 40 34 24 50 4 Z"/>',
  C: '<circle cx="50" cy="27" r="21"/><circle cx="27" cy="58" r="21"/><circle cx="73" cy="58" r="21"/><path d="M45 52 L55 52 C55 74 58 86 67 96 L33 96 C42 86 45 74 45 52 Z"/>',
};

export function pip(suit, x, y, size, flip = false) {
  const s = size / 100;
  const rot = flip ? ` rotate(180 50 50)` : '';
  return `<g transform="translate(${x - size / 2} ${y - size / 2}) scale(${s})${rot}" fill="${SUIT_INK[suit]}">${SUIT_PATH[suit]}</g>`;
}

export function suitIcon(suit, cls = 'pn-suit-icon') {
  return `<svg viewBox="0 0 100 100" class="${cls}" aria-hidden="true"><g fill="${SUIT_INK[suit]}">${SUIT_PATH[suit]}</g></svg>`;
}

const W = 250;
const H = 350;
const SERIF = "'Playfair Display', Georgia, 'Times New Roman', serif";
const cache = new Map();

function corner(rank, suit) {
  const label = RANK_LABEL[rank];
  const ink = SUIT_INK[suit];
  const narrow = label.length > 1;
  return `<text x="${narrow ? 30 : 31}" y="58" text-anchor="middle" font-family="${SERIF}" font-weight="800" font-size="${narrow ? 44 : 50}" letter-spacing="${narrow ? -4 : 0}" fill="${ink}">${label}</text>
    ${pip(suit, 31, 86, 30)}`;
}

// pip positions for the number cards (x, y, flipped)
const L = 76, C = 125, R = 174;
const PIPS = {
  9: [[L, 78], [R, 78], [L, 138], [R, 138], [C, 175], [L, 212, 1], [R, 212, 1], [L, 272, 1], [R, 272, 1]],
  T: [[L, 78], [R, 78], [C, 112], [L, 138], [R, 138], [L, 212, 1], [R, 212, 1], [C, 238, 1], [L, 272, 1], [R, 272, 1]],
};

// small ornaments for the court cards, centered on (0,0)
function ornament(rank, ink) {
  if (rank === 'K')
    return `<path d="M-34 14 L-34 -14 L-18 2 L0 -22 L18 2 L34 -14 L34 14 Z" fill="${ink}"/><rect x="-36" y="16" width="72" height="8" rx="2" fill="${ink}"/>
      <circle cx="-34" cy="-18" r="5" fill="${ink}"/><circle cx="0" cy="-27" r="5" fill="${ink}"/><circle cx="34" cy="-18" r="5" fill="${ink}"/>`;
  if (rank === 'Q')
    return `<path d="M-28 14 C-28 -4 -16 -14 0 -14 C16 -14 28 -4 28 14 Z" fill="${ink}"/><rect x="-32" y="16" width="64" height="7" rx="2" fill="${ink}"/>
      <circle cx="0" cy="-21" r="6" fill="${ink}"/><circle cx="-18" cy="-12" r="4" fill="${ink}"/><circle cx="18" cy="-12" r="4" fill="${ink}"/>`;
  return `<path d="M-30 16 C-30 -6 -14 -16 6 -16 C20 -16 30 -10 32 0 L10 2 L10 16 Z" fill="${ink}"/><rect x="-32" y="16" width="64" height="7" rx="2" fill="${ink}"/>
    <path d="M12 -14 C24 -34 40 -34 46 -26 C34 -26 26 -20 20 -10 Z" fill="${ink}" opacity=".75"/>`;
}

function court(rank, suit) {
  const ink = SUIT_INK[suit];
  const red = suit === 'H' || suit === 'D';
  const tint = red ? '#fdeaea' : '#ebedf3';
  const gold = '#d9a532';
  const half = (flip) => `<g ${flip ? `transform="rotate(180 ${W / 2} ${H / 2})"` : ''}>
      <g transform="translate(${W / 2} 108)">${ornament(rank, ink)}</g>
      <text x="${W / 2}" y="${H / 2 - 10}" text-anchor="middle" font-family="${SERIF}" font-weight="800" font-size="58" fill="${ink}">${rank}</text>
      ${pip(suit, W / 2 - 46, 150, 26)}${pip(suit, W / 2 + 46, 150, 26)}
    </g>`;
  return `<rect x="58" y="62" width="${W - 116}" height="${H - 124}" rx="10" fill="${tint}" stroke="${ink}" stroke-width="2.5"/>
    <rect x="66" y="70" width="${W - 132}" height="${H - 140}" rx="7" fill="none" stroke="${gold}" stroke-width="2"/>
    <path d="M70 ${H / 2} H${W - 70}" stroke="${gold}" stroke-width="2" stroke-dasharray="4 5"/>
    ${half(false)}${half(true)}`;
}

export function cardFace(card) {
  const face = card.slice(0, 2);
  if (cache.has(face)) return cache.get(face);
  const rank = rankOf(card);
  const suit = suitOf(card);
  let middle;
  if (rank === 'A') middle = pip(suit, W / 2, H / 2, 118) + `<circle cx="${W / 2}" cy="${H / 2}" r="72" fill="none" stroke="#d9a532" stroke-width="2" stroke-dasharray="3 6" opacity=".7"/>`;
  else if (rank === '9' || rank === 'T') middle = PIPS[rank].map(([x, y, f]) => pip(suit, x, y, 44, !!f)).join('');
  else middle = court(rank, suit);
  const svg = `<svg viewBox="0 0 ${W} ${H}" class="card-svg" aria-hidden="true">
    <rect x="1.5" y="1.5" width="${W - 3}" height="${H - 3}" rx="18" fill="url(#pn-paper)" stroke="#c9c9c9" stroke-width="2"/>
    ${corner(rank, suit)}
    <g transform="rotate(180 ${W / 2} ${H / 2})">${corner(rank, suit)}</g>
    ${middle}
  </svg>`;
  cache.set(face, svg);
  return svg;
}

export function cardBack() {
  if (cache.has('back')) return cache.get('back');
  const svg = `<svg viewBox="0 0 ${W} ${H}" class="card-svg" aria-hidden="true">
    <rect x="1.5" y="1.5" width="${W - 3}" height="${H - 3}" rx="18" fill="#fff" stroke="#c9c9c9" stroke-width="2"/>
    <rect x="13" y="13" width="${W - 26}" height="${H - 26}" rx="10" fill="url(#pn-back)"/>
    <rect x="13" y="13" width="${W - 26}" height="${H - 26}" rx="10" fill="url(#pn-lattice)"/>
    <rect x="24" y="24" width="${W - 48}" height="${H - 48}" rx="6" fill="none" stroke="#e8c46a" stroke-opacity=".55" stroke-width="2"/>
    <ellipse cx="${W / 2}" cy="${H / 2}" rx="58" ry="78" fill="#5a1222" stroke="#e8c46a" stroke-width="3"/>
    <ellipse cx="${W / 2}" cy="${H / 2}" rx="48" ry="68" fill="none" stroke="#e8c46a" stroke-opacity=".6" stroke-width="1.5"/>
    <g transform="translate(${W / 2 - 22} ${H / 2 - 52}) scale(.44)" fill="#e8c46a">${SUIT_PATH.S}</g>
    <g transform="translate(${W / 2 - 22} ${H / 2 + 8}) scale(.44)" fill="#e8c46a">${SUIT_PATH.D}</g>
  </svg>`;
  cache.set('back', svg);
  return svg;
}

// Shared gradients and patterns, written once into the page.
export const DEFS = `
<svg width="0" height="0" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true">
  <defs>
    <linearGradient id="pn-paper" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffffff"/><stop offset=".7" stop-color="#fbfaf6"/><stop offset="1" stop-color="#efede6"/>
    </linearGradient>
    <linearGradient id="pn-back" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#9b2335"/><stop offset=".55" stop-color="#7c1a2b"/><stop offset="1" stop-color="#5a1222"/>
    </linearGradient>
    <pattern id="pn-lattice" width="22" height="22" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="22" height="22" fill="none"/>
      <path d="M0 11 H22 M11 0 V22" stroke="#f3d48a" stroke-opacity=".22" stroke-width="2"/>
      <circle cx="11" cy="11" r="2.2" fill="#f3d48a" fill-opacity=".35"/>
    </pattern>
  </defs>
</svg>`;
