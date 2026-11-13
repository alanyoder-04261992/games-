// The Game Center's list of games. To add a game, build it in its own folder (see
// docs/ADDING_A_GAME.md and games/four-in-a-row for a small complete example) and add one
// line here. Order here is the order of the tiles on the home page.
export const GAME_MODULES = [
  () => import('./rook/index.js'),
  () => import('./euchre/index.js'),
  () => import('./hexstead/index.js'),
  () => import('./broadside/index.js'),
  () => import('./roofline/index.js'),
  () => import('./shed-tycoon/index.js'),
  () => import('./escape-grind/index.js'),
  () => import('./four-in-a-row/index.js'),
  () => import('./spit-speed/index.js'),
  () => import('./chinese-checkers/index.js'),
  () => import('./liars-dice/index.js'),
  () => import('./dogfight/index.js'),
  () => import('./rally/index.js'),
];
