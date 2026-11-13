// Home-page thumbnail for Liar's Dice: a 3D render of a lamp-lit table (thumb.jpg, made with
// tools/render-liars-thumb.cjs). A cup lies tipped over with its dice spilled out, another is
// lifted to show what was under it, and a speech bubble carries the bid. Wrapped in an SVG so
// it fits the Game Center's tile styles like the other games' art.
const SRC = new URL('./thumb.jpg', import.meta.url).href;

// a small die face for the bubble: four pips
const pip = (x, y) => `<circle cx="${x}" cy="${y}" r="2.3" fill="#1d1d24"/>`;

export const LIARS_TILE = `<svg viewBox="0 0 400 240" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  <defs>
    <radialGradient id="ld-vig" cx=".5" cy=".42" r=".75">
      <stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".55"/>
    </radialGradient>
    <linearGradient id="ld-ivory" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fffdf6"/><stop offset="1" stop-color="#e2d6bb"/>
    </linearGradient>
    <filter id="ld-drop" x="-20%" y="-30%" width="140%" height="170%"><feDropShadow dx="0" dy="3" stdDeviation="3" flood-opacity=".5"/></filter>
  </defs>
  <rect width="400" height="240" fill="#0b2a19"/>
  <image href="${SRC}" width="400" height="240" preserveAspectRatio="xMidYMid slice"/>
  <rect width="400" height="240" fill="url(#ld-vig)"/>
  <g filter="url(#ld-drop)" transform="translate(150 10)">
    <path d="M10 0 h66 a10 10 0 0 1 10 10 v18 a10 10 0 0 1 -10 10 h-30 l-9 9 l1 -9 h-28 a10 10 0 0 1 -10 -10 v-18 a10 10 0 0 1 10 -10 z" fill="#fffaf0"/>
    <text x="13" y="26.5" font-family="system-ui, -apple-system, sans-serif" font-weight="800" font-size="17" fill="#2a1a10">4 ×</text>
    <g transform="translate(52 7)">
      <rect width="24" height="24" rx="5" fill="url(#ld-ivory)" stroke="#cbbd9c" stroke-width=".8"/>
      ${pip(7, 7)}${pip(17, 7)}${pip(7, 17)}${pip(17, 17)}
    </g>
  </g>
</svg>`;
