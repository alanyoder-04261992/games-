// Home-page thumbnail for Chinese Checkers: a render of the real 3D board mid-game, a Red
// marble in mid-air on a jump ladder with its hops dotted behind it (thumb.jpg, made with
// tools/render-checkers-thumb.cjs), wrapped in an SVG so it fits the Game Center's tile styles
// like the other games' art.
const SRC = new URL('./thumb.jpg', import.meta.url).href;

export const CHECKERS_TILE = `<svg viewBox="0 0 400 240" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  <rect width="400" height="240" fill="#1a3527"/>
  <image href="${SRC}" width="400" height="240" preserveAspectRatio="xMidYMid slice"/>
</svg>`;
