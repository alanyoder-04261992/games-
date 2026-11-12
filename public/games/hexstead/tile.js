// Home-page thumbnail for Hexstead: a render of the real 3D board mid-game (thumb.jpg, made
// with tools/render-hexstead-thumb.cjs), wrapped in an SVG so it fits the Game Center's tile
// styles like the other games' art.
const SRC = new URL('./thumb.jpg', import.meta.url).href;

export const HEXSTEAD_TILE = `<svg viewBox="0 0 400 240" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  <rect width="400" height="240" fill="#2f86b8"/>
  <image href="${SRC}" width="400" height="240" preserveAspectRatio="xMidYMid slice"/>
</svg>`;
