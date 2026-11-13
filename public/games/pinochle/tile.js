// Home-page thumbnail for Pinochle: the meld on a burgundy felt table. The namesake pinochle
// (Queen of Spades and Jack of Diamonds) glows up front, a run in hearts fans out behind it,
// a laid-down marriage sits to the right and a score pad with a pencil to the left.
import { DEFS, cardFace } from './cards.js';

const CARD_W = 250;
const CARD_H = 350;
function place(svg, { x, y, w, rot = 0, cx = x + w / 2, cy = y + (w * CARD_H) / CARD_W / 2, shadow = 'pt-shadow' }) {
  const h = (w * CARD_H) / CARD_W;
  const inner = svg.replace(`<svg viewBox="0 0 ${CARD_W} ${CARD_H}"`, `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="0 0 ${CARD_W} ${CARD_H}"`);
  return `<g transform="rotate(${rot} ${cx} ${cy})" filter="url(#${shadow})">${inner}</g>`;
}

const defs = DEFS.replace(/^[\s\S]*?<defs>/, '').replace(/<\/defs>[\s\S]*$/, '');
const W = 400;
const H = 240;

// the run, fanned behind
const runPivot = { cx: 200, cy: 280 };
const run = ['AH0', 'TH0', 'KH0', 'QH0', 'JH0']
  .map((c, i) => place(cardFace(c), { x: 200 - 27, y: 14, w: 54, rot: -28 + i * 14, ...runPivot, shadow: 'pt-soft' }))
  .join('');

// the pinochle, up front
const pair =
  place(cardFace('QS0'), { x: 200 - 84, y: 60, w: 84, rot: -10, cx: 200, cy: 224 }) +
  place(cardFace('JD0'), { x: 200 - 2, y: 60, w: 84, rot: 10, cx: 200, cy: 224 });

// a marriage laid on the felt to the right
const marriage =
  place(cardFace('KC0'), { x: 306, y: 112, w: 48, rot: 14, shadow: 'pt-soft' }) +
  place(cardFace('QC0'), { x: 336, y: 120, w: 48, rot: 24, shadow: 'pt-soft' });

const HAND = "'Segoe Print', 'Bradley Hand', 'Comic Sans MS', cursive";
const pad = `<g transform="translate(-4 14) rotate(-9 64 140)" filter="url(#pt-soft)">
    <rect x="16" y="84" width="92" height="112" rx="4" fill="#fbf6e6"/>
    <rect x="16" y="84" width="92" height="16" rx="4" fill="#b8323f"/>
    <rect x="16" y="94" width="92" height="6" fill="#b8323f"/>
    <g fill="#5c4a3a" opacity=".55">${[0, 1, 2, 3, 4, 5].map((i) => `<rect x="20" y="${114 + i * 13}" width="84" height="1"/>`).join('')}</g>
    <rect x="61" y="102" width="1.2" height="90" fill="#c0392b" opacity=".6"/>
    <text x="38" y="111" text-anchor="middle" font-family="${HAND}" font-size="9" font-weight="700" fill="#2d2a7a">US</text>
    <text x="84" y="111" text-anchor="middle" font-family="${HAND}" font-size="9" font-weight="700" fill="#2d2a7a">THEM</text>
    <g font-family="${HAND}" font-size="10.5" fill="#2d2a7a" text-anchor="middle">
      <text x="38" y="125">350</text><text x="84" y="125">130</text>
      <text x="38" y="138">720</text><text x="84" y="138">410</text>
      <text x="38" y="151">1090</text><text x="84" y="151">650</text>
      <text x="38" y="164">1510</text><text x="84" y="164">880</text>
    </g>
    <path d="M24 168 Q38 172 52 167" stroke="#c0392b" stroke-width="1.6" fill="none" stroke-linecap="round"/>
    <path d="M27 160 l4 4 l7 -9" stroke="#2f9e5b" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" transform="translate(30 23)"/>
  </g>
  <g transform="translate(-2 30) rotate(14 70 170)" filter="url(#pt-soft)">
    <rect x="20" y="166" width="96" height="8" rx="1.5" fill="#f2c12e"/>
    <rect x="20" y="166" width="96" height="2.4" fill="#ffe27a"/>
    <rect x="108" y="166" width="10" height="8" fill="#c9c9c9"/>
    <rect x="116" y="166" width="10" height="8" rx="3" fill="#e88a9a"/>
    <path d="M20 166 L8 170 L20 174 Z" fill="#e8c9a0"/>
    <path d="M8 170 L12 168.7 L12 171.3 Z" fill="#333"/>
  </g>`;

const sparkle = (x, y, s) =>
  `<path transform="translate(${x} ${y}) scale(${s})" d="M0 -10 C1.5 -2 2 -1.5 10 0 C2 1.5 1.5 2 0 10 C-1.5 2 -2 1.5 -10 0 C-2 -1.5 -1.5 -2 0 -10 Z" fill="#ffe7a3"/>`;

export const PINOCHLE_TILE = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  <defs>
    ${defs}
    <radialGradient id="pt-felt" cx=".5" cy=".42" r=".78">
      <stop offset="0" stop-color="#8e2a3a"/><stop offset=".48" stop-color="#6a1827"/><stop offset="1" stop-color="#2a0710"/>
    </radialGradient>
    <radialGradient id="pt-light" cx=".5" cy=".28" r=".6">
      <stop offset="0" stop-color="#fff2cc" stop-opacity=".3"/><stop offset="1" stop-color="#fff2cc" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="pt-glow" cx=".5" cy=".5" r=".5">
      <stop offset="0" stop-color="#ffd76a" stop-opacity=".75"/><stop offset=".55" stop-color="#ffb93a" stop-opacity=".22"/><stop offset="1" stop-color="#ffb93a" stop-opacity="0"/>
    </radialGradient>
    <pattern id="pt-damask" width="28" height="28" patternUnits="userSpaceOnUse">
      <path d="M14 3 L18 14 L14 25 L10 14 Z" fill="#000" fill-opacity=".07"/>
      <circle cx="0" cy="0" r="2" fill="#fff" fill-opacity=".03"/><circle cx="28" cy="28" r="2" fill="#fff" fill-opacity=".03"/>
    </pattern>
    <filter id="pt-shadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="6" stdDeviation="5" flood-color="#1a0006" flood-opacity=".55"/>
    </filter>
    <filter id="pt-soft" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#1a0006" flood-opacity=".45"/>
    </filter>
    <linearGradient id="pt-rail" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#8a5a32"/><stop offset=".45" stop-color="#5e3a1d"/><stop offset="1" stop-color="#2c170a"/>
    </linearGradient>
    <linearGradient id="pt-gold" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffe9a6"/><stop offset=".5" stop-color="#f0c35a"/><stop offset="1" stop-color="#b9821f"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#pt-felt)"/>
  <rect width="${W}" height="${H}" fill="url(#pt-damask)"/>
  <ellipse cx="200" cy="124" rx="150" ry="98" fill="none" stroke="#f0c35a" stroke-opacity=".16" stroke-width="1.5"/>
  <ellipse cx="200" cy="124" rx="142" ry="91" fill="none" stroke="#f0c35a" stroke-opacity=".08" stroke-width="1" stroke-dasharray="3 5"/>
  <rect width="${W}" height="${H}" fill="url(#pt-light)"/>
  <g opacity=".92">${run}</g>
  ${pad}
  ${marriage}
  <ellipse cx="200" cy="138" rx="112" ry="74" fill="url(#pt-glow)"/>
  ${pair}
  ${sparkle(116, 70, 0.8)}${sparkle(292, 64, 0.6)}${sparkle(284, 186, 0.5)}
  <g transform="translate(200 204)">
    <path d="M-74 -11 H74 L65 0 L74 11 H-74 L-65 0 Z" fill="url(#pt-gold)" stroke="#7a5310" stroke-width="1"/>
    <text y="4.5" text-anchor="middle" font-family="'Playfair Display', Georgia, serif" font-weight="900" font-size="12" letter-spacing="1.2" fill="#3b2805">PINOCHLE · 40</text>
  </g>
  <path d="M0 ${H - 12} H${W} V${H} H0Z" fill="url(#pt-rail)"/>
  <path d="M0 ${H - 12} H${W}" stroke="#c08a52" stroke-opacity=".6"/>
  <rect width="${W}" height="${H}" fill="none" stroke="#000" stroke-opacity=".35" stroke-width="30" style="filter:blur(14px)"/>
</svg>`;
