// Card artwork, drawn as SVG. Original designs: cream linen faces, a colored frame, big
// serif numerals, a color emblem (so the four colors are easy to tell apart, even for
// color-blind players), and a gold coin showing what each card is worth.
import { BIRD, cardPoints, colorOf, rankOf } from './engine.js';

export const PALETTE = {
  red: { ink: '#c0392b', deep: '#8e2219', tint: '#fbe3dc', name: 'Red' },
  green: { ink: '#24834a', deep: '#145a31', tint: '#dcf1e1', name: 'Green' },
  yellow: { ink: '#d99a06', deep: '#9a6a00', tint: '#fff1c7', name: 'Yellow' },
  black: { ink: '#2b2d33', deep: '#0f1013', tint: '#e5e6ea', name: 'Black' },
};

// Emblems, drawn in a 0..20 box centered on (10,10).
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

const RAVEN = `
  <path d="M38 118 C30 104 34 86 50 74 C58 68 66 62 70 50 C73 41 80 34 90 33 C99 32 106 37 109 44 L122 46 L110 52 C112 60 110 68 104 74 C118 78 134 88 146 104 C152 112 160 120 172 126 C156 128 142 124 130 118 C134 128 136 138 134 150 C126 140 118 134 108 132 C96 134 82 134 70 130 C58 132 46 128 38 118 Z" fill="#111318"/>
  <path d="M62 92 C78 86 98 88 116 98 C128 105 138 114 146 124 C128 118 112 110 96 106 C84 104 72 100 62 92 Z" fill="#2c3440"/>
  <path d="M70 104 C86 102 104 106 118 114" stroke="#4a5666" stroke-width="2.5" fill="none" stroke-linecap="round"/>
  <path d="M74 114 C88 114 102 118 114 124" stroke="#4a5666" stroke-width="2.5" fill="none" stroke-linecap="round"/>
  <circle cx="94" cy="43" r="4.2" fill="#f4c542"/><circle cx="95" cy="42.3" r="1.6" fill="#111318"/>
  <path d="M84 132 L80 150 M92 133 L94 151" stroke="#111318" stroke-width="3.2" stroke-linecap="round"/>
  <path d="M74 152 L80 150 L86 154 M88 153 L94 151 L100 155" stroke="#111318" stroke-width="2.6" stroke-linecap="round" fill="none"/>`;

// Shared gradients and patterns, written once into the page.
export const DEFS = `
<svg width="0" height="0" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true">
  <defs>
    <linearGradient id="rk-paper" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fffdf7"/><stop offset=".55" stop-color="#fbf5e8"/><stop offset="1" stop-color="#efe4cc"/>
    </linearGradient>
    <pattern id="rk-linen" width="6" height="6" patternUnits="userSpaceOnUse">
      <path d="M0 0h6v6H0z" fill="none"/><path d="M0 3h6M3 0v6" stroke="#b79b6b" stroke-opacity=".07" stroke-width=".8"/>
    </pattern>
    <radialGradient id="rk-coin" cx=".35" cy=".3" r=".8">
      <stop offset="0" stop-color="#fff6c9"/><stop offset=".45" stop-color="#f2c94c"/><stop offset="1" stop-color="#a87412"/>
    </radialGradient>
    <linearGradient id="rk-gold" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#f7e3a1"/><stop offset=".5" stop-color="#c9982f"/><stop offset="1" stop-color="#8a6416"/>
    </linearGradient>
    <radialGradient id="rk-sky" cx=".5" cy=".38" r=".7">
      <stop offset="0" stop-color="#f6e7c1"/><stop offset=".6" stop-color="#e3c78a"/><stop offset="1" stop-color="#b98d3e"/>
    </radialGradient>
    <linearGradient id="rk-back" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1e3a5f"/><stop offset=".5" stop-color="#16304f"/><stop offset="1" stop-color="#0c1d33"/>
    </linearGradient>
    <pattern id="rk-lattice" width="22" height="22" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="22" height="22" fill="none"/>
      <path d="M0 11h22M11 0v22" stroke="#d8b76a" stroke-opacity=".32" stroke-width="1.2"/>
      <circle cx="11" cy="11" r="2.2" fill="#d8b76a" fill-opacity=".38"/>
      <circle cx="0" cy="0" r="1.2" fill="#d8b76a" fill-opacity=".3"/>
    </pattern>
    <radialGradient id="rk-gloss" cx=".3" cy=".1" r="1">
      <stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
    ${Object.entries(PALETTE)
      .map(
        ([k, p]) => `<radialGradient id="rk-med-${k}" cx=".4" cy=".35" r=".75">
      <stop offset="0" stop-color="#fff"/><stop offset=".7" stop-color="${p.tint}"/><stop offset="1" stop-color="${p.tint}" stop-opacity=".9"/>
    </radialGradient>`,
      )
      .join('')}
  </defs>
</svg>`;

const W = 250;
const H = 350;
const label = (r) => String(r);
const cache = new Map();

function coin(x, y, value, r = 19) {
  return `<g transform="translate(${x} ${y})">
    <circle r="${r}" fill="url(#rk-coin)" stroke="#8a6416" stroke-width="1.6"/>
    <circle r="${r - 4}" fill="none" stroke="#fff7d6" stroke-opacity=".7" stroke-width="1"/>
    <text y="${r * 0.36}" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-weight="800" font-size="${r * 1.02}" fill="#5c3d05">${value}</text>
  </g>`;
}

function frame(stroke, inner = stroke) {
  return `<rect x="1.5" y="1.5" width="${W - 3}" height="${H - 3}" rx="20" fill="url(#rk-paper)" stroke="#cdbf9f" stroke-width="2"/>
    <rect x="1.5" y="1.5" width="${W - 3}" height="${H - 3}" rx="20" fill="url(#rk-linen)"/>
    <rect x="13" y="13" width="${W - 26}" height="${H - 26}" rx="12" fill="none" stroke="${stroke}" stroke-width="3.2"/>
    <rect x="19" y="19" width="${W - 38}" height="${H - 38}" rx="8" fill="none" stroke="${inner}" stroke-opacity=".35" stroke-width="1.2"/>`;
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
    const big = label(rank);
    const fs = big.length > 1 ? 118 : 138;
    svg = `<svg viewBox="0 0 ${W} ${H}" class="card-svg" aria-hidden="true">
      ${frame(p.ink)}
      <g class="corner">
        <text x="40" y="70" text-anchor="middle" font-family="'Playfair Display', Georgia, serif" font-weight="900" font-size="50" fill="${p.ink}">${big}</text>
        ${emblem(color, 40, 96, 22)}
      </g>
      <g transform="rotate(180 ${W / 2} ${H / 2})">
        <text x="40" y="70" text-anchor="middle" font-family="'Playfair Display', Georgia, serif" font-weight="900" font-size="50" fill="${p.ink}">${big}</text>
        ${emblem(color, 40, 96, 22)}
      </g>
      <circle cx="${W / 2}" cy="${H / 2}" r="74" fill="url(#rk-med-${color})" stroke="${p.ink}" stroke-width="3"/>
      <circle cx="${W / 2}" cy="${H / 2}" r="66" fill="none" stroke="${p.ink}" stroke-opacity=".3" stroke-width="1.2" stroke-dasharray="2 4"/>
      <text x="${W / 2}" y="${H / 2 + fs * 0.35}" text-anchor="middle" font-family="'Playfair Display', Georgia, serif" font-weight="900" font-size="${fs}" fill="${p.deep}" opacity=".18" transform="translate(3 4)">${big}</text>
      <text x="${W / 2}" y="${H / 2 + fs * 0.35}" text-anchor="middle" font-family="'Playfair Display', Georgia, serif" font-weight="900" font-size="${fs}" fill="${p.ink}">${big}</text>
      ${emblem(color, W / 2, 62, 26)}
      ${emblem(color, W / 2, H - 62, 26, 180)}
      ${pts ? coin(W - 42, 44, pts) + `<g transform="rotate(180 ${W / 2} ${H / 2})">${coin(W - 42, 44, pts)}</g>` : ''}
    </svg>`;
  }
  cache.set(card, svg);
  return svg;
}

function birdFace() {
  return `<svg viewBox="0 0 ${W} ${H}" class="card-svg" aria-hidden="true">
    ${frame('url(#rk-gold)', '#8a6416')}
    <circle cx="${W / 2}" cy="${H / 2}" r="92" fill="url(#rk-sky)" stroke="url(#rk-gold)" stroke-width="6"/>
    <circle cx="${W / 2}" cy="${H / 2}" r="82" fill="none" stroke="#fff6d8" stroke-opacity=".55" stroke-width="1.5"/>
    <g transform="translate(${W / 2 - 104} ${H / 2 - 94}) scale(1.04)">${RAVEN}</g>
    <text x="${W / 2}" y="58" text-anchor="middle" font-family="'Playfair Display', Georgia, serif" font-weight="900" font-size="30" letter-spacing="7" fill="#7a5410">BIRD</text>
    <text x="${W / 2}" y="${H - 38}" text-anchor="middle" font-family="'Playfair Display', Georgia, serif" font-weight="900" font-size="30" letter-spacing="7" fill="#7a5410" transform="rotate(180 ${W / 2} ${H - 48})">BIRD</text>
    ${coin(42, 44, 20)}
    <g transform="rotate(180 ${W / 2} ${H / 2})">${coin(42, 44, 20)}</g>
  </svg>`;
}

export function cardBack() {
  if (cache.has('back')) return cache.get('back');
  const svg = `<svg viewBox="0 0 ${W} ${H}" class="card-svg" aria-hidden="true">
    <rect x="1.5" y="1.5" width="${W - 3}" height="${H - 3}" rx="20" fill="#f6efe0" stroke="#cdbf9f" stroke-width="2"/>
    <rect x="12" y="12" width="${W - 24}" height="${H - 24}" rx="12" fill="url(#rk-back)"/>
    <rect x="12" y="12" width="${W - 24}" height="${H - 24}" rx="12" fill="url(#rk-lattice)"/>
    <rect x="20" y="20" width="${W - 40}" height="${H - 40}" rx="8" fill="none" stroke="#d8b76a" stroke-opacity=".7" stroke-width="1.6"/>
    <g transform="translate(${W / 2} ${H / 2})">
      <circle r="46" fill="#0c1d33" stroke="url(#rk-gold)" stroke-width="4"/>
      <circle r="38" fill="none" stroke="#d8b76a" stroke-opacity=".5" stroke-width="1"/>
      <path d="M0 -30 L7 -7 L30 0 L7 7 L0 30 L-7 7 L-30 0 L-7 -7 Z" fill="url(#rk-gold)"/>
      <path d="M0 -18 L4 -4 L18 0 L4 4 L0 18 L-4 4 L-18 0 L-4 -4 Z" fill="#0c1d33" transform="rotate(45)"/>
      <circle r="4" fill="#f7e3a1"/>
    </g>
    <rect x="12" y="12" width="${W - 24}" height="${H - 24}" rx="12" fill="url(#rk-gloss)"/>
  </svg>`;
  cache.set('back', svg);
  return svg;
}

export function colorChip(color) {
  if (!color) return '';
  return `<svg viewBox="0 0 20 20" class="chip-emblem">${EMBLEM[color].replace(/currentColor/g, '#fff')}</svg>`;
}
