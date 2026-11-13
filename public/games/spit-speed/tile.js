// Home-page thumbnail for Spit & Speed: a 3D render of a lamp-lit red felt table (thumb.jpg,
// made with tools/render-spit-thumb.cjs). Both players slap a card down at the same instant —
// an 8 onto the 7, a 10 onto the 9 — with motion trails and the side piles on either side.
// Wrapped in an SVG so it fits the Game Center's tile styles like the other games' art.
const SRC = new URL('./thumb.jpg', import.meta.url).href;

export const SPIT_TILE = `<svg viewBox="0 0 400 240" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  <defs>
    <radialGradient id="ss-vig" cx=".5" cy=".45" r=".75">
      <stop offset=".6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".5"/>
    </radialGradient>
  </defs>
  <rect width="400" height="240" fill="#2a0607"/>
  <image href="${SRC}" width="400" height="240" preserveAspectRatio="xMidYMid slice"/>
  <rect width="400" height="240" fill="url(#ss-vig)"/>
</svg>`;
