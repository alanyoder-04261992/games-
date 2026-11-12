# Adding a game to the Game Center

Every game lives in its own folder under `public/games/`. The Game Center gives every game
the same things for free:

- a tile on the home page and a setup page with your options
- **online multiplayer** — lobby, invite code and link, seats, chat, reconnects
- **computer players** that fill empty seats and cover anyone who drops off
- autopilot, saving and resuming, game speed, sound

Your game only has to describe its rules, its computer player and its screen.

`public/games/four-in-a-row/` is a small, complete example (about 150 lines of rules and
250 of screen). `public/games/rook/` is the full-size one.

## 1. Make the folder

```
public/games/my-game/
  index.js     the manifest (required)
  ui.js        the screen (required)
  my-game.css  styles (optional)
  rules.html   shown by the ? button at the table (optional)
```

## 2. Write the manifest (`index.js`)

```js
export default {
  id: 'my-game',                 // folder name, used in saves and URLs
  name: 'My Game',
  tagline: 'One line for the home page tile.',
  description: 'A paragraph for the setup page.',
  seats: 2,                      // how many seats at the table
  // seatCount: (options) => options.players,  // optional: let a table option set the seat count
  seatLabels: ['Red', 'Blue'],   // optional
  teams: [[0, 2], [1, 3]],       // optional, for partnership games
  joinOrder: [1],                // optional: which seat the first friend gets
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
  // ctx.client   .on('state', msg => …), .act(move), .isHost, .send({ t: 'rematch' })
  // ctx.prefs    .get(key) / .set(key, value) — saved per device
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

## Real-time games

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
