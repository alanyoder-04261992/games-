// Home-page thumbnail for Euchre: the right and left bowers crossed under a pool of lamp light
// on a wine-red table, with the kitty and its turned-up card on one side and the classic
// 6-and-4 score counters on the other.
import { DEFS, cardFace, cardBack, pip, suitInk } from './cards.js';

const W = 400;
const H = 240;
const FONT = "Georgia, 'Times New Roman', serif";

// Put a 250×350 card drawing at (x, y), w wide, turned `rot` degrees about its own center.
function place(svg, { x, y, w, rot = 0, shadow = 'et-shadow' }) {
  const h = w * 1.4;
  const inner = svg.replace('<svg viewBox="0 0 250 350"', `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="0 0 250 350"`);
  return `<g transform="rotate(${rot} ${x + w / 2} ${y + h / 2})" filter="url(#${shadow})">${inner}</g>`;
}

// A low number card (the 4 and 6 score counters aren't part of the Euchre deck, so they're
// drawn here in the same style as cards.js).
function counterCard(rank, suit) {
  const ink = suitInk(suit);
  const spots = { 4: [[86, 84], [164, 84], [86, 266], [164, 266]], 6: [[86, 84], [164, 84], [86, 175], [164, 175], [86, 266], [164, 266]] }[rank];
  const corner = `<text x="30" y="58" text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="50" fill="${ink}">${rank}</text>${pip(suit, 30, 86, 32)}`;
  return `<svg viewBox="0 0 250 350" class="card-svg" aria-hidden="true">
    <rect x="1.5" y="1.5" width="247" height="347" rx="16" fill="url(#eu-paper)" stroke="#cdcac2" stroke-width="2"/>
    ${corner}<g transform="rotate(180 125 175)">${corner}</g>
    ${spots.map(([x, y]) => pip(suit, x, y, 52, y > 175)).join('')}
  </svg>`;
}

// A gold ribbon label ("RIGHT" / "LEFT") hanging over a card.
function ribbon(x, y, text, rot) {
  const w = text.length * 9 + 18;
  return `<g transform="translate(${x} ${y}) rotate(${rot})" filter="url(#et-soft)">
    <path d="M${-w / 2 - 7} 2 L${-w / 2} -9 L${w / 2} -9 L${w / 2 + 7} 2 L${w / 2} 13 L${-w / 2} 13 Z" fill="url(#et-gold)" stroke="#7a5410" stroke-width="1"/>
    <text x="0" y="7.5" text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="12.5" letter-spacing="2" fill="#3b2805">${text}</text>
  </g>`;
}

// four-pointed glints around the bowers
const glint = (x, y, s, o = 1) =>
  `<path transform="translate(${x} ${y}) scale(${s})" d="M0 -10 C1 -2 2 -1 10 0 C2 1 1 2 0 10 C-1 2 -2 1 -10 0 C-2 -1 -1 -2 0 -10 Z" fill="#fff6d0" opacity="${o}"/>`;

const defs = DEFS.replace(/^[\s\S]*?<defs>/, '').replace(/<\/defs>[\s\S]*$/, '');

// the kitty: three face down with the up-card on top
const kitty =
  [0, 1, 2].map((i) => place(cardBack(), { x: 28 + i * 2.5, y: 84 - i * 2.5, w: 52, rot: -12 + i * 3 })).join('') +
  place(cardFace('AH'), { x: 40, y: 72, w: 52, rot: 9 });

// score counters: the 4 face up, the 6 laid across it face down to cover pips
const counters =
  place(counterCard(4, 'S'), { x: 318, y: 92, w: 50, rot: 8 }) +
  place(cardBack(), { x: 310, y: 116, w: 50, rot: 82 });

// the bowers, crossed: the left bower behind, the right bower in front
const bowers =
  place(cardFace('JD'), { x: 126, y: 52, w: 94, rot: -17, shadow: 'et-deep' }) +
  place(cardFace('JH'), { x: 188, y: 50, w: 94, rot: 14, shadow: 'et-deep' });

export const EUCHRE_TILE = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  <defs>
    ${defs}
    <radialGradient id="et-felt" cx=".5" cy=".45" r=".78">
      <stop offset="0" stop-color="#9b2335"/><stop offset=".45" stop-color="#6e1424"/><stop offset="1" stop-color="#2a050d"/>
    </radialGradient>
    <radialGradient id="et-lamp" cx=".52" cy=".42" r=".42">
      <stop offset="0" stop-color="#ffe7a6" stop-opacity=".55"/><stop offset=".5" stop-color="#ffcf6b" stop-opacity=".16"/><stop offset="1" stop-color="#ffcf6b" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="et-halo" cx=".5" cy=".5" r=".5">
      <stop offset="0" stop-color="#fff2c2" stop-opacity=".95"/><stop offset=".35" stop-color="#f6c75a" stop-opacity=".45"/><stop offset="1" stop-color="#f6c75a" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="et-gold" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff0b3"/><stop offset=".5" stop-color="#f0c35a"/><stop offset="1" stop-color="#c8901f"/>
    </linearGradient>
    <filter id="et-grain" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="11"/>
      <feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 .25 0"/>
      <feComposite in2="SourceGraphic" operator="in"/>
    </filter>
    <filter id="et-shadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="4" stdDeviation="4" flood-color="#000" flood-opacity=".5"/>
    </filter>
    <filter id="et-deep" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="9" stdDeviation="8" flood-color="#1a0006" flood-opacity=".7"/>
    </filter>
    <filter id="et-soft" x="-30%" y="-60%" width="160%" height="220%">
      <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#000" flood-opacity=".5"/>
    </filter>
    <linearGradient id="et-rail" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#8a5a32"/><stop offset=".45" stop-color="#5e3a1d"/><stop offset="1" stop-color="#2c170a"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#et-felt)"/>
  <rect width="${W}" height="${H}" fill="#000" filter="url(#et-grain)"/>
  <ellipse cx="208" cy="118" rx="150" ry="96" fill="none" stroke="#f3d48a" stroke-opacity=".14" stroke-width="1.5"/>
  <ellipse cx="208" cy="118" rx="138" ry="86" fill="none" stroke="#f3d48a" stroke-opacity=".08" stroke-width="1" stroke-dasharray="4 6"/>
  <rect width="${W}" height="${H}" fill="url(#et-lamp)"/>
  ${kitty}
  ${counters}
  <ellipse cx="208" cy="112" rx="96" ry="84" fill="url(#et-halo)"/>
  ${bowers}
  ${ribbon(154, 47, 'LEFT', -17)}
  ${ribbon(251, 45, 'RIGHT', 14)}
  ${glint(118, 78, 0.85)}${glint(296, 150, 0.75)}${glint(204, 40, 0.6, 0.9)}${glint(128, 176, 0.5, 0.7)}
  <g transform="translate(354 66)" filter="url(#et-soft)">
    <circle r="21" fill="#fffaf0" stroke="url(#et-gold)" stroke-width="4"/>
    ${pip('H', 0, 1, 24)}
  </g>
  <path d="M0 ${H - 14} H${W} V${H} H0Z" fill="url(#et-rail)"/>
  <path d="M0 ${H - 14} H${W}" stroke="#c08a52" stroke-opacity=".6"/>
  <rect width="${W}" height="${H}" fill="none" stroke="#000" stroke-opacity=".4" stroke-width="30" style="filter:blur(14px)"/>
</svg>`;
