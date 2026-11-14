# Adding a game to the Game Center

Every game lives in its own folder under `public/games/`. The Game Center gives every game
the same things for free:

- a tile on the home page and a setup page with your options
- **online multiplayer** — lobby, invite code and link, seats, chat, reconnects
- **computer players** that fill empty seats and cover anyone who drops off
- autopilot, saving and resuming, game speed, sound

Your game only has to describe its rules, its computer player and its screen.

`public/games/four-in-a-row/` is a small, complete example: about 150 lines of rules
(`index.js`), 190 of screen (`ui.js`), a flat HTML/CSS board (`board2d.js`) and a 3D board
(`scene.js`, three.js on WebGPU) that a setting switches between. `public/games/rook/` is the
full-size one.

## 1. Make the folder

```
public/games/my-game/
  index.js     the manifest (required)
  ui.js        the screen (required)
  my-game.css  styles (optional)
  scene.js     a 3D board (optional, see "3D games" below)
  rules.html   the illustrated rule book (required, see docs/RULEBOOK.md)
```

## 2. Write the manifest (`index.js`)

```js
export default {
  id: 'my-game',                 // folder name, used in saves and URLs
  version: '1.0',                // shown on the home tile; bump it every time you improve the game
  name: 'My Game',
  tagline: 'One line for the home page tile.',
  description: 'A paragraph for the setup page.',
  seats: 2,                      // how many seats at the table
  // seatCount: (options) => options.players,  // optional: let a table option set the seat count
  seatLabels: ['Red', 'Blue'],   // optional
  teams: [[0, 2], [1, 3]],       // optional, for partnership games
  joinOrder: [1],                // optional: which seat the first friend gets
  sameDevice: 'open',            // optional: pass and play, several people on one device.
                                 //   'open' when nothing is hidden, 'private' when players have
                                 //   hidden hands (a "Pass to Sam" cover between people).
                                 //   Leave it out for real-time games where everyone acts at once.
  players: '1–2 players',
  tile: '<svg …>…</svg>',        // tile art, 200×140 viewBox works well
  accent: '#5b8cff',
  options: [                     // optional table rules, shown on setup and in the lobby
    { key: 'size', label: 'Board', type: 'select', default: 7,
      choices: [{ value: 7, label: 'Normal' }, { value: 9, label: 'Big' }] },
  ],
  botLevels: { easy: 'Easy', normal: 'Normal', hard: 'Expert' },
  engine,                        // see below
  bot: { choose: (view, legalMoves, level) => legalMoves[0] },
  pace: (state, lastEvent, prevState) => 700, // ms a computer waits before moving
  styles: [new URL('./my-game.css', import.meta.url).href],
  ui: () => import('./ui.js'),
};
```

### The engine

Plain functions with no DOM. Only the host's device runs them; everyone else just gets views.

| Function | What it does |
| --- | --- |
| `setup({ seed, options })` | Returns a new game state. Use `seed` for any shuffling so games can be replayed. |
| `actors(state)` | The seats that may act right now (usually one; several for things like "everyone ready"). |
| `legal(state, seat)` | The moves that seat may make. Computer players choose from this list. |
| `check(state, seat, move)` | *Optional.* `null` if the move is fine, otherwise a reason. Defaults to "is it in `legal`". |
| `apply(state, seat, move)` | Returns the **new** state. Must not change the old one (`structuredClone` it). Throw on illegal moves. |
| `view(state, seat)` | What that seat is allowed to see. **Strip hidden information here** (other hands, the deck, the random seed). `seat` is `null` for spectators. |
| `isOver(state)` | `true` when the game has finished. |
| `redact(move, actor, viewer)` | *Optional.* Hide parts of a move from other players (e.g. which cards were discarded). |
| `claim` / `claimActive` / `claimMove` | *Optional.* Let the host auto-play a part of the game whose outcome is already decided (see Rook). |

States, moves and views must be plain JSON (they are saved and sent over the network).

## 3. Write the screen (`ui.js`)

```js
export function mount(ctx) {
  // ctx.el       the element to draw into (fills the screen under the top bar)
  // ctx.client   .on('state', msg => …), .act(move), .isHost
  // ctx.prefs    .get(key) / .set(key, value) — saved per device
  // ctx.rematch() the shared Rematch button: put it on your game-over screen
  // ctx.toast(text), ctx.leave()
  const off = ctx.client.on('state', (msg) => {
    // msg.view   what your engine's view() returned for this player
    // msg.seat   this player's seat (null when watching)
    // msg.seats  [{ name, hue, kind: 'human' | 'bot', connected }]
    // msg.event  { seat, action } — the move that just happened (animate it!)
    // msg.speed  'relaxed' | 'normal' | 'fast' | 'turbo'
  });
  if (ctx.client.lastState) { /* draw it right away */ }
  return {
    destroy() { off(); },
    settings: () => [ { label: 'Show hints', value: true, set: (v) => {} } ], // optional
  };
}
```

Send moves with `ctx.client.act(move)`. Never change the view yourself — wait for the next
`state` message. That's what keeps every player's screen in sync.

**When the game ends**, put `ctx.rematch()` on your game-over screen (next to a
`Game Center` button that calls `ctx.leave()`). It is the same Rematch button every game
uses: same players, same seats, same table options and room code. The host's tap starts the
new game; anyone else's tap says "I'm in" and the host's button lists who's ready. Playing
alone it reads "Play again". `ctx.rematch({ big: true })` gives a larger button. If your
screen doesn't place one, the table shows it in a bar along the bottom once the game is over.
A game in its own frame (Dogfight, Rally) marks its frame with `data-own-rematch` and gets
the status through its bridge instead (see `public/games/rally/ui.js`).

## Games where everyone plays at once

A card game like Spit & Speed (`public/games/spit-speed/`) has no turns but still runs on the
rules engine: `actors()` returns every seat that has a legal move, and the host applies moves
in the order they arrive (a move that's no longer legal gets `check()`'s reason back, such as
"Too slow"). Two manifest settings help:

```js
realtime: true,   // each computer player keeps its own reaction clock, so a fast human
                  // playing over and over doesn't keep restarting the computer's timer
pace(state, lastEvent, prevState, { seat, level }) { … }  // who is about to move, and their level
```

## Real-time channel

Turn-based games never need this. A game where everyone acts at once (like Coastal Dogfight)
can use the room's real-time channel next to the rules engine:

```js
ctx.client.send({ t: 'rt', data: { … } });          // goes to everyone else at the table
ctx.client.on('rt', ({ from, player, data }) => …);  // from = sender's seat (null if watching)
```

The host relays these messages as they are. They are not checked, saved or replayed, so keep
them small and frequent (positions) or idempotent (events), and let the rules engine hold
anything that must survive a refresh. `actors()` can return `[]` so nobody is waited on, and
an action like `{ type: 'finish', results }` can end the round so rematches work as usual.
See `public/games/dogfight/` for a full example. It runs the game in a frame and bridges
these messages with `postMessage`.

## 3D games: the shared three.js (r187) and WebGPU

Every 3D game in the Game Center runs on the **same three.js — r187**, kept in
`public/vendor/three/`, and draws with **WebGPU** through `THREE.WebGPURenderer`. On a
device or browser without WebGPU, that renderer switches to WebGL2 by itself, so everyone
can still play. Don't load three.js from a CDN or keep your own copy: one shared version
means every game works offline, loads it once, and gets upgraded together.

```js
// in public/games/my-game/scene.js
import * as THREE from '../../vendor/three/three.webgpu.min.js';
import { pass, uniform, color, time } from '../../vendor/three/three.tsl.min.js';
import { OrbitControls } from '../../vendor/three/addons/controls/OrbitControls.js';
import { bloom } from '../../vendor/three/addons/tsl/display/BloomNode.js';
// add-ons keep the same path they have in three's examples/jsm folder

const renderer = new THREE.WebGPURenderer({ antialias: true });
await renderer.init();                       // or start drawing with renderer.setAnimationLoop
const pipeline = new THREE.RenderPipeline(renderer);   // optional glow
const scenePass = pass(scene, camera);
pipeline.outputNode = scenePass.add(bloom(scenePass, 0.6, 0.4, 0.85));
renderer.setAnimationLoop(() => pipeline.render());    // or renderer.render(scene, camera)
```

- **Shaders and effects are written in TSL** (three's node language), never GLSL:
  node materials such as `MeshStandardNodeMaterial` with `colorNode`/`positionNode` instead of
  `ShaderMaterial` or `onBeforeCompile`; `THREE.RenderPipeline` with `pass()`, `bloom()` and
  `ao()` instead of `EffectComposer`; `WaterMesh`/`SkyMesh` instead of `Water`/`Sky`;
  `THREE.RenderTarget` instead of `WebGLRenderTarget`.
- **Need another add-on?** Add its path (e.g. `loaders/GLTFLoader.js`) to
  `public/vendor/three/addons.json` and run `npm run update-three`. The script copies it and
  everything it imports, and rewrites its imports to the shared build.
- **Game in its own page (`<iframe>`)?** Give that page an import map pointing at the shared
  copy, like `public/games/dogfight/play.html`:
  `{"imports":{"three":"../../vendor/three/three.webgpu.min.js","three/webgpu":"../../vendor/three/three.webgpu.min.js","three/tsl":"../../vendor/three/three.tsl.min.js","three/addons/":"../../vendor/three/addons/"}}`
- **Write current API:** `THREE.Timer` instead of `THREE.Clock`; `PCFShadowMap` (or
  `VSMShadowMap`) because `PCFSoftShadowMap` was removed; `texture.colorSpace` instead of
  `encoding`; `RenderPipeline`, not the deprecated `PostProcessing`. A running game should log
  no `THREE.` warnings.
- **Test both ways:** with WebGPU, and with it switched off so the WebGL2 fallback runs. In
  Chromium/Playwright, WebGPU works even without a GPU via
  `--enable-unsafe-webgpu --enable-features=Vulkan --use-angle=swiftshader --use-webgpu-adapter=swiftshader`;
  `--disable-features=WebGPU` forces the fallback.
- **Upgrading three.js** happens for every game at once: `npm run update-three -- <version>`,
  bump `REQUIRED_REVISION` in `tests/three.test.mjs`, fix each 3D game's console warnings, and
  run `npm test`.
- `tests/three.test.mjs` fails if any game imports three.js from anywhere else, uses an
  add-on that isn't vendored, or still uses WebGL-only code.

### A small 3D board to copy: Four in a Row

`public/games/four-in-a-row/scene.js` is a short, commented 3D board. Things it shows:

```js
// WebGPU where the browser has it, WebGL 2 everywhere else. Choosing ourselves keeps the
// console clean (left alone, three logs a warning when it falls back).
const adapter = navigator.gpu ? await navigator.gpu.requestAdapter().catch(() => null) : null;
const renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL: !adapter });
await renderer.init(); // rejects on a device with neither: show a flat board instead

// a uniform is a value JavaScript sets each frame; the TSL shader reads it
const glow = uniform(0);
const mat = new THREE.MeshPhysicalNodeMaterial({ roughness: 0.3 });
mat.emissiveNode = color('#e0362b').mul(glow);
```

- `await renderer.compileAsync(scene, camera)` before the first frame, so the first move
  doesn't stutter while shaders compile.
- Work animations out from the time since they started rather than adding up per-frame steps,
  so a slow phone shows the same motion as a fast computer (see `dropDisc`).
- Keep the 3D board behind a small interface, with a 2D board that has the same interface.
  Four in a Row's `ui.js` loads `scene.js` only when the "3D board" setting is on (saved with
  `ctx.prefs`), shows the flat board if 3D can't start, and offers the switch in
  `settings()`:

```js
settings: () => [{ label: '3D board', value: want3d, set: (v) => (ctx.prefs.set('four.3d', v), useBoard(v)) }],
```

- If headless Chromium's WebGPU canvas stays blank (the device is lost at once), add
  `--use-vulkan=swiftshader` to the flags above. Software rendering runs at a few frames a
  second, so give animations time before taking screenshots.

## 4. Register it

Add one line to `public/games/index.js`:

```js
export const GAME_MODULES = [
  () => import('./rook/index.js'),
  () => import('./four-in-a-row/index.js'),
  () => import('./my-game/index.js'),
];
```

## 5. Test it

```bash
npm install
npm start                  # http://localhost:8080
npm test                   # rules tests
```

To try online play on one computer, open two browser windows (one private) and join the
code from the first. To work without the internet, run `npm run peer-server` and open
`http://localhost:8080/?peer=localhost:9000` in both windows.

Write tests for your engine in `tests/` — have bots play hundreds of full games and check
that nothing throws and every game ends. That catches most rules bugs.
