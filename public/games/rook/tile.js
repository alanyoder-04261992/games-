// Home-page thumbnail for Rook: a fan of real cards on a lit felt table.
import { DEFS, cardFace, cardBack } from './cards.js';

// Re-use the real card art inside the tile (nested SVGs keep it crisp at any size).
function place(svg, { x, y, w, rot, cx, cy }) {
  const h = w * 1.4;
  const inner = svg.replace('<svg viewBox="0 0 250 350"', `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="0 0 250 350"`);
  return `<g transform="rotate(${rot} ${cx} ${cy})" filter="url(#rt-shadow)">${inner}</g>`;
}

const defs = DEFS.replace(/^[\s\S]*?<defs>/, '').replace(/<\/defs>[\s\S]*$/, '');

const W = 400;
const H = 240;
const pivot = { cx: 200, cy: 420 };
const fan = ['red-1', 'green-14', 'black-10', 'yellow-5', 'bird']
  .map((card, i) => place(cardFace(card), { x: 200 - 37, y: 62, w: 74, rot: -14 + i * 7, ...pivot }))
  .join('');

const nest = [0, 1, 2]
  .map((i) => place(cardBack(), { x: 16 + i * 3, y: 70 - i * 3, w: 48, rot: -12 + i * 5, cx: 40, cy: 104 }))
  .join('');

export const ROOK_TILE = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  <defs>
    ${defs}
    <radialGradient id="rt-felt" cx=".5" cy=".42" r=".75">
      <stop offset="0" stop-color="#37a066"/><stop offset=".45" stop-color="#22774a"/><stop offset="1" stop-color="#0d3a25"/>
    </radialGradient>
    <radialGradient id="rt-light" cx=".5" cy=".3" r=".55">
      <stop offset="0" stop-color="#fff6d8" stop-opacity=".28"/><stop offset="1" stop-color="#fff6d8" stop-opacity="0"/>
    </radialGradient>
    <filter id="rt-grain" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="3"/>
      <feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 .22 0"/>
      <feComposite in2="SourceGraphic" operator="in"/>
    </filter>
    <filter id="rt-shadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="5" stdDeviation="5" flood-color="#000" flood-opacity=".45"/>
    </filter>
    <linearGradient id="rt-rail" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#8a5a32"/><stop offset=".45" stop-color="#5e3a1d"/><stop offset="1" stop-color="#2c170a"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#rt-felt)"/>
  <rect width="${W}" height="${H}" fill="#000" filter="url(#rt-grain)"/>
  <ellipse cx="200" cy="120" rx="120" ry="92" fill="none" stroke="#fff" stroke-opacity=".07" stroke-width="2"/>
  <rect width="${W}" height="${H}" fill="url(#rt-light)"/>
  ${nest}
  <g transform="translate(362 66)">
    <circle r="22" fill="#d42a2f" stroke="#fff" stroke-width="3"/>
    <circle r="15" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="1.5" stroke-dasharray="3 3"/>
    <text y="6" text-anchor="middle" font-family="'Roboto Slab', Rockwell, Georgia, serif" font-weight="900" font-size="15" fill="#fff">150</text>
  </g>
  ${fan}
  <path d="M0 ${H - 14} H${W} V${H} H0Z" fill="url(#rt-rail)"/>
  <path d="M0 ${H - 14} H${W}" stroke="#c08a52" stroke-opacity=".6"/>
  <rect width="${W}" height="${H}" fill="none" stroke="#000" stroke-opacity=".35" stroke-width="30" style="filter:blur(14px)"/>
</svg>`;
