// Home-page thumbnail for Escape the Grind: the round board in perspective, a glossy pawn,
// a stack of gold coins and two dice on a walnut table.
export const ESCAPE_TILE = `<svg viewBox="0 0 400 240" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="eg-wood" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#3a2416"/><stop offset="1" stop-color="#1c110a"/>
    </linearGradient>
    <radialGradient id="eg-lamp" cx=".5" cy=".35" r=".7">
      <stop offset="0" stop-color="#ffd9a0" stop-opacity=".35"/><stop offset="1" stop-color="#000" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="eg-felt" cx=".5" cy=".42" r=".6">
      <stop offset="0" stop-color="#1f6b4a"/><stop offset="1" stop-color="#0d3a28"/>
    </radialGradient>
    <linearGradient id="eg-rim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#8a5a32"/><stop offset="1" stop-color="#4a2c16"/>
    </linearGradient>
    <linearGradient id="eg-gold" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#a86f10"/><stop offset=".45" stop-color="#ffe08a"/><stop offset="1" stop-color="#b07a18"/>
    </linearGradient>
    <radialGradient id="eg-pawn" cx=".35" cy=".3" r=".8">
      <stop offset="0" stop-color="#ff8f86"/><stop offset=".5" stop-color="#e2453c"/><stop offset="1" stop-color="#7d1611"/>
    </radialGradient>
    <filter id="eg-sh" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="4"/></filter>
  </defs>
  <rect width="400" height="240" fill="url(#eg-wood)"/>
  <g opacity=".18" stroke="#000" fill="none">
    <path d="M0 40 C120 30 260 55 400 38"/><path d="M0 95 C140 85 250 110 400 92"/><path d="M0 170 C130 160 270 185 400 166"/><path d="M0 215 C150 205 260 228 400 210"/>
  </g>
  <rect width="400" height="240" fill="url(#eg-lamp)"/>
  <ellipse cx="200" cy="138" rx="170" ry="70" fill="#000" opacity=".55" filter="url(#eg-sh)"/>
  <ellipse cx="200" cy="132" rx="168" ry="70" fill="url(#eg-rim)"/>
  <ellipse cx="200" cy="124" rx="166" ry="68" fill="#6b4224"/>
  <ellipse cx="200" cy="122" rx="156" ry="63" fill="url(#eg-felt)"/>
  <g fill="none" stroke-width="13">
    ${Array.from({ length: 24 }, (_, i) => {
      const colors = ['#25a36a', '#1f7fb8', '#d9a21b', '#1f7fb8', '#b73a3a', '#1f7fb8'];
      const a0 = (i / 24) * Math.PI * 2, a1 = ((i + 0.86) / 24) * Math.PI * 2;
      const p = (a, r) => `${(200 + Math.cos(a) * r).toFixed(1)} ${(122 + Math.sin(a) * r * 0.405).toFixed(1)}`;
      return `<path d="M${p(a0, 140)} A140 56.7 0 0 1 ${p(a1, 140)}" stroke="${colors[i % 6]}"/>`;
    }).join('')}
  </g>
  <g fill="none" stroke-width="10">
    ${Array.from({ length: 24 }, (_, i) => {
      const colors = ['#2f9e5b', '#2c6fd1', '#d6463b', '#2c6fd1', '#7a4fd0', '#2c6fd1'];
      const a0 = (i / 24) * Math.PI * 2, a1 = ((i + 0.84) / 24) * Math.PI * 2;
      const p = (a, r) => `${(200 + Math.cos(a) * r).toFixed(1)} ${(122 + Math.sin(a) * r * 0.405).toFixed(1)}`;
      return `<path d="M${p(a0, 92)} A92 37.3 0 0 1 ${p(a1, 92)}" stroke="${colors[i % 6]}"/>`;
    }).join('')}
  </g>
  <text x="200" y="118" text-anchor="middle" font-family="Playfair Display, Georgia, serif" font-weight="900" font-size="22" fill="#f6d77c" letter-spacing="1">ESCAPE</text>
  <text x="200" y="138" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-weight="800" font-size="10" fill="#e9dcb5" letter-spacing="4">THE GRIND</text>
  <g transform="translate(306 150)">
    <ellipse cx="0" cy="22" rx="26" ry="8" fill="#000" opacity=".5" filter="url(#eg-sh)"/>
    ${Array.from({ length: 7 }, (_, i) => `<ellipse cx="0" cy="${18 - i * 5}" rx="22" ry="7" fill="url(#eg-gold)" stroke="#7a520c" stroke-width=".6"/>`).join('')}
    <ellipse cx="0" cy="-12" rx="22" ry="7" fill="#ffd25e"/><text x="0" y="-9" text-anchor="middle" font-size="9" font-weight="800" fill="#8a5a08" font-family="Arial">$</text>
  </g>
  <g transform="translate(128 112)">
    <ellipse cx="0" cy="34" rx="18" ry="6" fill="#000" opacity=".55" filter="url(#eg-sh)"/>
    <path d="M-15 32 Q-16 22 -6 18 Q-9 8 -4 0 A9 9 0 1 1 4 0 Q9 8 6 18 Q16 22 15 32 Z" fill="url(#eg-pawn)"/>
    <ellipse cx="-3" cy="-9" rx="3" ry="2" fill="#fff" opacity=".6"/>
  </g>
  <g transform="translate(76 168) rotate(-14)">
    <rect x="-14" y="-14" width="28" height="28" rx="6" fill="#f6f3ea" stroke="#cfc7b4"/>
    <circle cx="-6" cy="-6" r="2.6" fill="#222"/><circle cx="0" cy="0" r="2.6" fill="#222"/><circle cx="6" cy="6" r="2.6" fill="#222"/>
  </g>
  <g transform="translate(108 186) rotate(18)">
    <rect x="-14" y="-14" width="28" height="28" rx="6" fill="#f6f3ea" stroke="#cfc7b4"/>
    <circle cx="-6" cy="-6" r="2.6" fill="#222"/><circle cx="6" cy="-6" r="2.6" fill="#222"/><circle cx="-6" cy="6" r="2.6" fill="#222"/><circle cx="6" cy="6" r="2.6" fill="#222"/>
  </g>
</svg>`;
