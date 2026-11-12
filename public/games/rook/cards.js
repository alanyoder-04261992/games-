// Card artwork, drawn as SVG, in the look of a classic Rook deck: white cards, a big slab
// numeral with the color's name in the corner, a little box with the point value on
// counting cards, and the numeral again inside a thin square frame in the middle.
// The Bird card and the card back are original designs.
import { BIRD, cardPoints, colorOf, rankOf } from './engine.js';

export const PALETTE = {
  red: { ink: '#d42a2f', deep: '#9b161b', tint: '#fde4e4', name: 'Red' },
  green: { ink: '#16917a', deep: '#0c6656', tint: '#dcf3ee', name: 'Green' },
  yellow: { ink: '#e3a300', deep: '#a77600', tint: '#fff3cf', name: 'Yellow' },
  black: { ink: '#1b1b1d', deep: '#000000', tint: '#e7e7ea', name: 'Black' },
};
const BIRD_INK = '#2f8fc6';

// Emblems for the trump badge and the trump picker, drawn in a 0..20 box.
const EMBLEM = {
  red: '<path d="M10 1.2 L18.2 10 L10 18.8 L1.8 10 Z"/>',
  green: '<circle cx="10" cy="5.6" r="4.3"/><circle cx="5.4" cy="11" r="4.3"/><circle cx="14.6" cy="11" r="4.3"/><path d="M10 10 L10 19" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
  yellow:
    '<circle cx="10" cy="10" r="4.6"/><g stroke-width="2.1" stroke-linecap="round" stroke="currentColor"><path d="M10 .8v3M10 16.2v3M.8 10h3M16.2 10h3M3.5 3.5l2.1 2.1M14.4 14.4l2.1 2.1M3.5 16.5l2.1-2.1M14.4 5.6l2.1-2.1"/></g>',
  black: '<path d="M13.5 1.6 A8.6 8.6 0 1 0 18.6 13.4 A7 7 0 1 1 13.5 1.6 Z"/>',
};

export function emblem(color, x, y, size, rotate = 0) {
  const s = size / 20;
  const c = PALETTE[color].ink;
  return `<g transform="translate(${x - size / 2} ${y - size / 2}) rotate(${rotate} ${size / 2} ${size / 2}) scale(${s})" fill="${c}" color="${c}">${EMBLEM[color]}</g>`;
}

export function colorChip(color) {
  if (!color) return '';
  return `<svg viewBox="0 0 20 20" class="chip-emblem">${EMBLEM[color].replace(/currentColor/g, '#fff')}</svg>`;
}

// An original perched-bird drawing (one ink color, like a printed card), ~180x170 box.
function bird(ink) {
  return `<g fill="${ink}" stroke="none">
    <path d="M18 120 C26 104 44 92 62 86 C70 70 76 52 90 40 C98 33 108 30 118 32 C126 33 132 38 135 45 L156 47 L137 56 C140 66 138 78 130 88 C146 94 160 106 170 122 C150 116 134 116 120 122 C110 128 96 132 80 132 C62 134 40 130 18 120 Z"/>
    <path d="M60 96 C78 92 98 96 114 106" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" opacity=".85"/>
    <path d="M52 108 C72 104 94 108 110 116" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" opacity=".85"/>
    <path d="M70 84 C82 76 96 74 108 78" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round" opacity=".7"/>
    <circle cx="121" cy="45" r="4.6" fill="#fff"/><circle cx="122" cy="44.5" r="2.2"/>
    <path d="M86 131 L82 152 M100 130 L102 152" stroke="${ink}" stroke-width="4" stroke-linecap="round"/>
    <path d="M74 154 L82 152 L90 157 M94 156 L102 152 L110 157" stroke="${ink}" stroke-width="3" stroke-linecap="round" fill="none"/>
    <path d="M40 158 C80 150 130 150 172 158" stroke="${ink}" stroke-width="5" stroke-linecap="round" fill="none"/>
  </g>`;
}

// Shared gradients and patterns, written once into the page.
export const DEFS = `
<svg width="0" height="0" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true">
  <defs>
    <linearGradient id="rk-paper" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffffff"/><stop offset=".7" stop-color="#fbfbf8"/><stop offset="1" stop-color="#f1f0ea"/>
    </linearGradient>
    <linearGradient id="rk-back" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#7cc2e6"/><stop offset=".5" stop-color="#5aa9d6"/><stop offset="1" stop-color="#3f8fc0"/>
    </linearGradient>
    <pattern id="rk-feathers" width="36" height="24" patternUnits="userSpaceOnUse" patternTransform="rotate(-18)">
      <rect width="36" height="24" fill="none"/>
      <path d="M0 12 C8 2 18 2 26 12 C18 8 8 8 0 12 Z" fill="#ffffff" fill-opacity=".18"/>
      <path d="M18 24 C26 14 36 14 44 24 C36 20 26 20 18 24 Z" fill="#0d4f7a" fill-opacity=".16"/>
      <path d="M-18 24 C-10 14 0 14 8 24 C0 20 -10 20 -18 24 Z" fill="#0d4f7a" fill-opacity=".16"/>
    </pattern>
    <radialGradient id="rk-gloss" cx=".3" cy=".1" r="1">
      <stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
  </defs>
</svg>`;

const W = 250;
const H = 350;
const SLAB = "'Roboto Slab', Rockwell, 'Courier New', Georgia, serif";
const cache = new Map();

// Approximate width of a numeral string in the slab face at a given size.
const numWidth = (s, size) => s.length * size * 0.62;

function corner(rank, color, pts) {
  const p = PALETTE[color];
  const big = String(rank);
  const fs = 64;
  const nx = 20;
  const wordX = nx + numWidth(big, fs) + 6;
  const box = pts
    ? `<rect x="${wordX}" y="46" width="${pts >= 10 ? 30 : 22}" height="22" fill="#fff" stroke="${p.ink}" stroke-width="2"/>
       <text x="${wordX + (pts >= 10 ? 15 : 11)}" y="63" text-anchor="middle" font-family="${SLAB}" font-weight="800" font-size="16" fill="${p.ink}">${pts}</text>`
    : '';
  return `<text x="${nx}" y="74" font-family="${SLAB}" font-weight="900" font-size="${fs}" fill="${p.ink}" letter-spacing="-2">${big}</text>
    <text x="${wordX}" y="38" font-family="${SLAB}" font-weight="800" font-size="17" letter-spacing="1" fill="${p.ink}">${p.name.toUpperCase()}</text>
    ${box}`;
}

export function cardFace(card) {
  if (cache.has(card)) return cache.get(card);
  let svg;
  if (card === BIRD) svg = birdFace();
  else {
    const color = colorOf(card);
    const rank = rankOf(card);
    const p = PALETTE[color];
    const pts = cardPoints(card);
    const big = String(rank);
    const fs = big.length > 1 ? 104 : 124;
    const underline = rank === 6 || rank === 9;
    const cy = H / 2;
    svg = `<svg viewBox="0 0 ${W} ${H}" class="card-svg" aria-hidden="true">
      <rect x="1.5" y="1.5" width="${W - 3}" height="${H - 3}" rx="18" fill="url(#rk-paper)" stroke="#cfcfcf" stroke-width="2"/>
      ${corner(rank, color, pts)}
      <g transform="rotate(180 ${W / 2} ${H / 2})">${corner(rank, color, pts)}</g>
      <rect x="${W / 2 - 66}" y="${cy - 66}" width="132" height="132" fill="none" stroke="${p.ink}" stroke-width="2.2"/>
      <text x="${W / 2}" y="${cy + fs * 0.36}" text-anchor="middle" font-family="${SLAB}" font-weight="900" font-size="${fs}" letter-spacing="-4" fill="${p.ink}">${big}</text>
      ${underline ? `<rect x="${W / 2 - 30}" y="${cy + fs * 0.36 + 8}" width="60" height="6" fill="${p.ink}"/>` : ''}
    </svg>`;
  }
  cache.set(card, svg);
  return svg;
}

function birdFace() {
  const ink = BIRD_INK;
  const side = (x, y, rot) =>
    `<text transform="translate(${x} ${y}) rotate(${rot})" font-family="${SLAB}" font-weight="900" font-size="30" letter-spacing="6" fill="${ink}">BIRD</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" class="card-svg" aria-hidden="true">
    <rect x="1.5" y="1.5" width="${W - 3}" height="${H - 3}" rx="18" fill="url(#rk-paper)" stroke="#cfcfcf" stroke-width="2"/>
    ${side(28, 22, 90)}
    <g transform="rotate(180 ${W / 2} ${H / 2})">${side(28, 22, 90)}</g>
    <g transform="translate(${W / 2 - 92} 64) scale(1.02)">${bird(ink)}</g>
    <text x="${W / 2 + 8}" y="${H - 54}" text-anchor="middle" font-family="${SLAB}" font-weight="900" font-size="92" letter-spacing="-4" fill="${ink}">20</text>
  </svg>`;
}

export function cardBack() {
  if (cache.has('back')) return cache.get('back');
  const svg = `<svg viewBox="0 0 ${W} ${H}" class="card-svg" aria-hidden="true">
    <rect x="1.5" y="1.5" width="${W - 3}" height="${H - 3}" rx="18" fill="#ffffff" stroke="#cfcfcf" stroke-width="2"/>
    <rect x="13" y="13" width="${W - 26}" height="${H - 26}" rx="10" fill="url(#rk-back)"/>
    <rect x="13" y="13" width="${W - 26}" height="${H - 26}" rx="10" fill="url(#rk-feathers)"/>
    <g transform="translate(${W / 2 - 64} ${H / 2 - 72}) scale(.7)" opacity=".9">${bird('#0f4c74')}</g>
    <rect x="13" y="13" width="${W - 26}" height="${H - 26}" rx="10" fill="url(#rk-gloss)"/>
  </svg>`;
  cache.set('back', svg);
  return svg;
}
