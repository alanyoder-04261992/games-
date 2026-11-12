# Game Center — notes for anyone (person or Claude) working in this repo

The site is `public/` (plain ES modules, no build step; deployed by Netlify from `public/`).
Games plug in as folders under `public/games/` — read `docs/ADDING_A_GAME.md` first.

## 3D games: one shared three.js, always r187

- Every 3D game uses the **shared three.js r187** in `public/vendor/three/`. Import it with a
  relative path, e.g. `import * as THREE from '../../vendor/three/three.module.min.js'` and
  add-ons from `../../vendor/three/addons/<same path as three's examples/jsm>`.
- **Never** load three.js from a CDN (jsdelivr, unpkg, cdnjs, esm.sh…), from npm at runtime, or
  from a private copy inside a game folder, and never pin a different version for one game.
- Need an add-on that isn't vendored yet? Add its path to `public/vendor/three/addons.json`
  and run `npm run update-three`. Don't hand-copy files from three's repo.
- Pages that use an import map (games in an `<iframe>`, like `games/dogfight/play.html`)
  must map `"three"` and `"three/addons/"` to the shared folder.
- Write r187 code: `THREE.Timer` (not `THREE.Clock`), `PCFShadowMap`/`VSMShadowMap` (not the
  removed `PCFSoftShadowMap`), `colorSpace` (not `encoding`). The console should show no
  `THREE.` warnings when a game runs.
- **Upgrading three.js is done for all games at once:** `npm run update-three -- <version>`,
  bump `REQUIRED_REVISION` in `tests/three.test.mjs`, fix every 3D game's warnings, run
  `npm test`, then open each 3D game and check the console.
- `tests/three.test.mjs` enforces all of this; keep it passing.

## Other house rules

- Games register with one line in `public/games/index.js`; online play, chat, voice,
  computer players and saving come from `public/core/`.
- Run `npm test` before pushing. Rules engines need bot-vs-bot tests that play full games.
