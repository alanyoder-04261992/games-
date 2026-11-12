// Home-page thumbnail for Escape the Grind: a still rendered from the game's own 3D table
// (pawns, dice, a barn-style shed and gold coins on the board). Wrapped in an SVG so it sizes
// and zooms on hover like the other tiles.
const IMG = new URL('./thumb.webp', import.meta.url).href;
export const ESCAPE_TILE = `<svg viewBox="0 0 400 240" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Escape the Grind 3D board">
  <rect width="400" height="240" fill="#1c120b"/>
  <image href="${IMG}" width="400" height="240" preserveAspectRatio="xMidYMid slice"/>
</svg>`;
