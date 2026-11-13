// Home-page thumbnail for Euchre: the two bowers and a fan of hearts on a lit felt table,
// with the kitty and its turned-up card off to the side.
import { DEFS, cardFace, cardBack } from './cards.js';

function place(svg, { x, y, w, rot, cx, cy }) {
  const h = w * 1.4;
  const inner = svg.replace('<svg viewBox="0 0 250 350"', `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="0 0 250 350"`);
  return `<g transform="rotate(${rot} ${cx} ${cy})" filter="url(#et-shadow)">${inner}</g>`;
}

const defs = DEFS.replace(/^[\s\S]*?<defs>/, '').replace(/<\/defs>[\s\S]*$/, '');

const W = 400;
const H = 240;
const pivot = { cx: 214, cy: 420 };
const fan = ['9H', 'QH', 'AH', 'JD', 'JH']
  .map((card, i) => place(cardFace(card), { x: 214 - 37, y: 60, w: 74, rot: -16 + i * 8, ...pivot }))
  .join('');

const kitty = [0, 1, 2].map((i) => place(cardBack(), { x: 18 + i * 3, y: 78 - i * 3, w: 50, rot: -10 + i * 4, cx: 44, cy: 112 })).join('');
const up = place(cardFace('KS'), { x: 30, y: 70, w: 50, rot: 8, cx: 55, cy: 105 });

export const EUCHRE_TILE = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  <defs>
    ${defs}
    <radialGradient id="et-felt" cx=".5" cy=".42" r=".75">
      <stop offset="0" stop-color="#2b6fae"/><stop offset=".45" stop-color="#1b4f86"/><stop offset="1" stop-color="#0b2240"/>
    </radialGradient>
    <radialGradient id="et-light" cx=".55" cy=".3" r=".55">
      <stop offset="0" stop-color="#fff6d8" stop-opacity=".3"/><stop offset="1" stop-color="#fff6d8" stop-opacity="0"/>
    </radialGradient>
    <filter id="et-grain" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="7"/>
      <feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 .22 0"/>
      <feComposite in2="SourceGraphic" operator="in"/>
    </filter>
    <filter id="et-shadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="5" stdDeviation="5" flood-color="#000" flood-opacity=".45"/>
    </filter>
    <linearGradient id="et-rail" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#8a5a32"/><stop offset=".45" stop-color="#5e3a1d"/><stop offset="1" stop-color="#2c170a"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#et-felt)"/>
  <rect width="${W}" height="${H}" fill="#000" filter="url(#et-grain)"/>
  <ellipse cx="214" cy="120" rx="120" ry="92" fill="none" stroke="#fff" stroke-opacity=".07" stroke-width="2"/>
  <rect width="${W}" height="${H}" fill="url(#et-light)"/>
  ${kitty}
  ${up}
  <g transform="translate(360 62)">
    <circle r="23" fill="#c8102e" stroke="#fff" stroke-width="3"/>
    <g transform="translate(-11 -11) scale(.22)" fill="#fff"><path d="M50 90 C22 68 4 50 4 30 C4 14 16 5 29 5 C39 5 46 11 50 20 C54 11 61 5 71 5 C84 5 96 14 96 30 C96 50 78 68 50 90 Z"/></g>
  </g>
  ${fan}
  <path d="M0 ${H - 14} H${W} V${H} H0Z" fill="url(#et-rail)"/>
  <path d="M0 ${H - 14} H${W}" stroke="#c08a52" stroke-opacity=".6"/>
  <rect width="${W}" height="${H}" fill="none" stroke="#000" stroke-opacity=".35" stroke-width="30" style="filter:blur(14px)"/>
</svg>`;
