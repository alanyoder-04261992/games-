# Game Center — notes for anyone (person or Claude) working in this repo

The site is `public/` (plain ES modules, no build step; deployed by Netlify from `public/`).
Games plug in as folders under `public/games/` — read `docs/ADDING_A_GAME.md` first.

## 3D games: one shared three.js (r187), drawn with WebGPU

- Every 3D game uses the **shared three.js r187** in `public/vendor/three/` and renders with
  **`THREE.WebGPURenderer`** (WebGPU; it falls back to WebGL2 by itself where WebGPU is
  missing). Import it with a relative path:
  `import * as THREE from '../../vendor/three/three.webgpu.min.js'`, TSL from
  `'../../vendor/three/three.tsl.min.js'`, add-ons from
  `../../vendor/three/addons/<same path as three's examples/jsm>`.
- No WebGL-only code: no `WebGLRenderer`, `ShaderMaterial`/GLSL, `onBeforeCompile`,
  `EffectComposer` passes or `Water`/`Sky`. Use TSL node materials, `THREE.RenderPipeline`
  with `pass()` + `bloom()`/`ao()` (addons/tsl/display), `WaterMesh`, `SkyMesh`, `RenderTarget`.
  `await renderer.init()` (or `setAnimationLoop`) before the first frame.
- **Never** load three.js from a CDN (jsdelivr, unpkg, cdnjs, esm.sh…), from npm at runtime, or
  from a private copy inside a game folder, and never pin a different version for one game.
- Need an add-on that isn't vendored yet? Add its path to `public/vendor/three/addons.json`
  and run `npm run update-three`. Don't hand-copy files from three's repo.
- Pages that use an import map (games in an `<iframe>`, like `games/dogfight/play.html`)
  map `"three"` and `"three/webgpu"` to `three.webgpu.min.js`, `"three/tsl"` to
  `three.tsl.min.js` and `"three/addons/"` to the shared add-ons folder.
- Test on both backends: real WebGPU (Chromium flags `--enable-unsafe-webgpu
  --enable-features=Vulkan --use-angle=swiftshader --use-webgpu-adapter=swiftshader`, plus
  `--use-vulkan=swiftshader` if the WebGPU device is lost at once and the canvas stays blank) and the
  WebGL2 fallback (`--disable-features=WebGPU`).
- Write r187 code: `THREE.Timer` (not `THREE.Clock`), `PCFShadowMap`/`VSMShadowMap` (not the
  removed `PCFSoftShadowMap`), `colorSpace` (not `encoding`), `RenderPipeline` (not the
  deprecated `PostProcessing`). The console should show no `THREE.` warnings when a game runs.
- **Upgrading three.js is done for all games at once:** `npm run update-three -- <version>`,
  bump `REQUIRED_REVISION` in `tests/three.test.mjs`, fix every 3D game's warnings, run
  `npm test`, then open each 3D game and check the console.
- `tests/three.test.mjs` enforces all of this; keep it passing.

## Versions and updates

- Every game's manifest has `version: '1.7'`, shown small in the corner of its home tile.
  **Bump it whenever you improve a game** (1.7 → 1.8). `tests/updates.test.mjs` checks it exists.
- Deploys run `node tools/stamp-build.mjs`, which writes `public/build.json` (deploy id +
  game versions). Open pages notice a new deploy and show "Improved: <game> v1.8 — Tap to
  reload" (`public/core/updates.js`, which also does pull-to-refresh off the game table).

## Other house rules

- Games register with one line in `public/games/index.js`; online play, chat, voice,
  computer players, saving and the Rematch button (`ctx.rematch()` on the game-over
  screen; same players, seats and room code) come from `public/core/`.
- Pass and play (several people on one device) comes from core too: set `sameDevice: 'open'`
  (nothing hidden) or `'private'` (hidden hands: a "Pass to …" cover between people) in the
  manifest of any turn-based game. Leave it off for real-time games. A game's UI always draws
  `msg.seat`, which can change between turns on a shared device.
## Rule books (every game, kept up to date)

- **A new game ships with its rule book**: `public/games/<id>/rules.html`, an illustrated
  how-to-play guide written to `docs/RULEBOOK.md` (sections, inline-SVG pictures, every rule and
  number matching the engine). No rule book, no merge: `tests/rulebook.test.mjs` fails without it.
- **Changing a game means checking its rule book.** Whenever you change a game (rules, scoring,
  options, controls, pieces, screens) and bump its `version`, re-read its whole `rules.html`
  against the code: fix every rule, number, option, control and picture that changed, add new
  features, then set `data-checked` on its `<header class="rb-hero">` to the new version.
  The test fails while `data-checked` doesn't match the manifest's `version`, so a stale rule
  book can't slip through. Don't just bump the number: actually re-read it.
- Run `npm test` before pushing. Rules engines need bot-vs-bot tests that play full games.
