// Home-page thumbnail for Chinese Checkers: a wooden star board on a dark table, Red and Blue
// marbles racing across, and a Red marble mid-way through a jump ladder.
import { CELLS, STAR, layout, camp } from './board.js';
import { COLORS } from './colors.js';

const W = 400;
const H = 240;
const U = 13.4; // pixels per hole spacing
const CX = W / 2;
const CY = H / 2 + 2;
const P = (px, py) => [CX + px * U, CY + py * U];

// a game in progress: some of each colour still at home, some crossing the middle
const RED = new Set(camp(0, 10).slice(0, 6));
const BLUE = new Set(camp(3, 10).slice(4));
const GREEN = new Set(camp(2, 10).slice(3));
const at = (x, z) => CELLS.find((c) => c.x === x && c.z === z)?.i;
[[-1, 3], [0, 1], [1, -1], [2, 0]].forEach(([x, z]) => RED.add(at(x, z)));
[[1, -3], [0, -1], [-2, 2], [3, -3], [-1, 0], [2, -4]].forEach(([x, z]) => BLUE.add(at(x, z)));
[[-3, 0], [-2, -1], [-4, 2]].forEach(([x, z]) => GREEN.add(at(x, z)));
const HOP = [at(2, 0), at(2, -2), at(4, -4)]; // the jumping marble's path

// a triangle through the point's three corner holes, pushed out a little
const tint = (p, hex) => {
  const all = camp(p).map((i) => layout(i));
  const cx = all.reduce((t, q) => t + q.px, 0) / all.length;
  const cy = all.reduce((t, q) => t + q.py, 0) / all.length;
  const far = all.map((q) => [q, Math.hypot(q.px - cx, q.py - cy)]).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([q]) => q);
  return `<polygon points="${far.map((q) => P(cx + (q.px - cx) * 1.45, cy + (q.py - cy) * 1.45).join(',')).join(' ')}" fill="${hex}" opacity=".22" stroke="${hex}" stroke-opacity=".5" stroke-width="1.2" stroke-linejoin="round"/>`;
};

function marble(i, color, extra = '') {
  const { px, py } = layout(i);
  const [x, y] = P(px, py);
  return `<g ${extra}><circle cx="${x + 0.8}" cy="${y + 1.6}" r="5.6" fill="#000" opacity=".35"/><circle cx="${x}" cy="${y}" r="5.4" fill="url(#cc-${color})"/><circle cx="${x - 1.7}" cy="${y - 1.9}" r="1.7" fill="#fff" opacity=".75"/></g>`;
}

const holes = CELLS.map((c) => {
  const [x, y] = P(layout(c.i).px, layout(c.i).py);
  return `<circle cx="${x}" cy="${y}" r="3.1" fill="url(#cc-hole)"/>`;
}).join('');

const star = STAR.map((tri) => `<polygon points="${tri.map(([x, y]) => P(x * 1.1, y * 1.1).join(',')).join(' ')}"/>`).join('');
const [hx, hy] = P(layout(HOP[1]).px, layout(HOP[1]).py);
const trail = HOP.map((i) => P(layout(i).px, layout(i).py).join(',')).join(' ');

const grads = ['Red', 'Blue', 'Green'].map((name) => {
  const c = COLORS.find((k) => k.name === name);
  return `<radialGradient id="cc-${name}" cx=".35" cy=".3" r=".75"><stop offset="0" stop-color="${c.light}"/><stop offset=".45" stop-color="${c.hex}"/><stop offset="1" stop-color="${c.dark}"/></radialGradient>`;
}).join('');

export const CHECKERS_TILE = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  <defs>
    <radialGradient id="cc-felt" cx=".5" cy=".45" r=".75"><stop offset="0" stop-color="#2d4a3a"/><stop offset="1" stop-color="#0f1c16"/></radialGradient>
    <linearGradient id="cc-wood" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e3b77a"/><stop offset=".5" stop-color="#c8904f"/><stop offset="1" stop-color="#9c6630"/></linearGradient>
    <radialGradient id="cc-hole" cx=".5" cy=".4" r=".6"><stop offset="0" stop-color="#3a1f0c"/><stop offset=".8" stop-color="#5a3518"/><stop offset="1" stop-color="#c8904f"/></radialGradient>
    <filter id="cc-grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".01 .2" numOctaves="3" seed="4"/><feColorMatrix values="0 0 0 0 .3 0 0 0 0 .15 0 0 0 0 0 0 0 0 .35 0"/><feComposite in2="SourceGraphic" operator="in"/></filter>
    <filter id="cc-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3"/></filter>
    ${grads}
  </defs>
  <rect width="${W}" height="${H}" fill="url(#cc-felt)"/>
  <g fill="#000" opacity=".45" transform="translate(4 9)" stroke="#000" stroke-width="16" stroke-linejoin="round">${star}</g>
  <g fill="url(#cc-wood)" stroke="url(#cc-wood)" stroke-width="16" stroke-linejoin="round">${star}</g>
  <g fill="#fff" stroke="#fff" stroke-width="16" stroke-linejoin="round" filter="url(#cc-grain)">${star}</g>
  ${tint(0, COLORS[0].hex)}${tint(3, COLORS[1].hex)}${tint(2, COLORS[2].hex)}
  ${holes}
  <polyline points="${trail}" fill="none" stroke="#fff4c2" stroke-width="2" stroke-dasharray="3 4" stroke-linecap="round" opacity=".85"/>
  ${[...RED].filter((i) => i != null && i !== HOP[0]).map((i) => marble(i, 'Red')).join('')}
  ${[...BLUE].filter((i) => i != null).map((i) => marble(i, 'Blue')).join('')}
  ${[...GREEN].filter((i) => i != null).map((i) => marble(i, 'Green')).join('')}
  <circle cx="${hx}" cy="${hy}" r="11" fill="#ffe9a8" opacity=".55" filter="url(#cc-glow)"/>
  <g transform="translate(${hx} ${hy - 7}) scale(1.35) translate(${-hx} ${-hy})">${marble(HOP[1], 'Red')}</g>
</svg>`;
