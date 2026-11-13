// Home-page thumbnail for Pinochle: a fan with the namesake pinochle (Queen of Spades and Jack
// of Diamonds) between two Aces, on a burgundy felt table.
import { DEFS, cardFace, cardBack } from './cards.js';

function place(svg, { x, y, w, rot, cx, cy }) {
  const h = w * 1.4;
  const inner = svg.replace('<svg viewBox="0 0 250 350"', `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="0 0 250 350"`);
  return `<g transform="rotate(${rot} ${cx} ${cy})" filter="url(#pt-shadow)">${inner}</g>`;
}

const defs = DEFS.replace(/^[\s\S]*?<defs>/, '').replace(/<\/defs>[\s\S]*$/, '');
const W = 400;
const H = 240;
const pivot = { cx: 200, cy: 430 };
const fan = ['AH0', 'QS0', 'JD0', 'AS0', 'TC0']
  .map((card, i) => place(cardFace(card), { x: 200 - 38, y: 58, w: 76, rot: -16 + i * 8, ...pivot }))
  .join('');
const stack = [0, 1, 2]
  .map((i) => place(cardBack(), { x: 18 + i * 3, y: 72 - i * 3, w: 46, rot: -10 + i * 5, cx: 40, cy: 104 }))
  .join('');

export const PINOCHLE_TILE = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  <defs>
    ${defs}
    <radialGradient id="pt-felt" cx=".5" cy=".42" r=".75">
      <stop offset="0" stop-color="#2d6f9a"/><stop offset=".5" stop-color="#1c4d72"/><stop offset="1" stop-color="#0b2238"/>
    </radialGradient>
    <radialGradient id="pt-light" cx=".5" cy=".3" r=".55">
      <stop offset="0" stop-color="#fff6d8" stop-opacity=".26"/><stop offset="1" stop-color="#fff6d8" stop-opacity="0"/>
    </radialGradient>
    <filter id="pt-shadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="5" stdDeviation="5" flood-color="#000" flood-opacity=".45"/>
    </filter>
    <linearGradient id="pt-rail" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#8a5a32"/><stop offset=".45" stop-color="#5e3a1d"/><stop offset="1" stop-color="#2c170a"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#pt-felt)"/>
  <ellipse cx="200" cy="120" rx="124" ry="92" fill="none" stroke="#fff" stroke-opacity=".07" stroke-width="2"/>
  <rect width="${W}" height="${H}" fill="url(#pt-light)"/>
  ${stack}
  <g transform="translate(360 64)">
    <circle r="24" fill="#e8b23c" stroke="#fff" stroke-width="3"/>
    <text y="6" text-anchor="middle" font-family="Georgia, serif" font-weight="900" font-size="16" fill="#3b2805">40</text>
  </g>
  ${fan}
  <path d="M0 ${H - 14} H${W} V${H} H0Z" fill="url(#pt-rail)"/>
  <path d="M0 ${H - 14} H${W}" stroke="#c08a52" stroke-opacity=".6"/>
</svg>`;
