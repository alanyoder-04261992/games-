# Game Center

Card and board games to play with friends online or against computer players.
Plain HTML, CSS and JavaScript modules — no build step, hosts anywhere static files can go.

**Games**

- **Rook** — a full rebuild of the four-player trick-taking game with the house rules from the
  original app (45-card deck with the Bird, bids 100–200 plus solo 400/800, first lead names
  trump, 1000 to win). Animated dealing and tricks, original card art, Monte Carlo computer
  players, a coach, auto-play helpers and online play for up to four people.
- **Hexstead** — an original island-settling game in full 3D (three.js): roll for timber, brick,
  wool, grain and stone, lay trails, raise homesteads and upgrade them to barns, trade with the
  table or the harbors, play almanac cards, and keep the bandit off your fields. Every tile,
  tree, sheep, house, barn, boat and die is modelled in code — no image or model files.
  Computer players at three levels, up to 8 players: 5–6 play on a 30-tile Big island and
  7–8 on a 37-tile Grand island, with "barn raising" so everyone can build between turns.
- **Broadside** — an original two-admiral naval battle on a 3D sea (three.js r187: reflective
  water, a sky with drifting clouds, bloom): hide your fleet, then trade shots. Shells arc in, misses throw up water columns, hits start fires, and sunk ships roll over
  and go down. 8×8, 10×10 or 12×12 seas; one shot a turn, chain fire or barrage; computer
  admirals that hunt down your remaining ships.
- **Escape the Grind** — a 3D personal-finance board game for 1–4 players. Start in a job living
  paycheck to paycheck, buy rentals, shed lots, storage, businesses and stocks, and break out of
  the Grind once your passive income beats your expenses. Then buy your Dream on the Freedom Ring
  to win. Full 3D table (Three.js): walnut table, lamp lighting and soft shadows, rolling dice,
  glossy pawns, cards that fly up to the camera, coin stacks and miniature buildings for everything
  you own. Plays with mouse, touch, keyboard or a game controller (A choose, B back, Y statement,
  X camera, right stick orbit, triggers zoom, Start full screen).
  **Real-life economy** (advanced option): a market index runs through expansion, boom, slowdown,
  recession and recovery. Deal prices, buyer offers, business income and loan rates follow it, and
  a live stock market lets players buy the dip, sell the boom, and short stocks to profit from a fall.
- **Four in a Row** — a small, complete example of how a game plugs in, with a 3D board (three.js on WebGPU) and a flat one.
- **Coastal Dogfight** — a real-time 3D flight game: 1940s fighters over a 20 km coastline.
  Up to four pilots team up against waves of raiders (you pick how many per wave and how
  many waves) or fight a free-for-all. Phone touch controls, mouse aim, keyboard and gamepad.
  Details in [docs/DOGFIGHT.md](docs/DOGFIGHT.md).
- **Ridgeline Rally** — a real-time 3D racing game on Three.js r187: three country circuits
  (farmland, a lakeside at sunset, a wooded hollow), three cars, up to four drivers online
  plus computer cars, and a time trial against your own ghost. Phone touch controls, keyboard
  and gamepad. Details in [docs/RALLY.md](docs/RALLY.md).

## Online play

Step-by-step instructions for hosts and players: [docs/PLAYING_ONLINE.md](docs/PLAYING_ONLINE.md) — also built into the app (home page link, or `/#/help`).

The host's browser runs the game; friends join with a 5-letter code or an invite link.
Connections are peer-to-peer WebRTC through [PeerJS](https://peerjs.com), so there is no game
server to run or pay for.

- Empty seats are filled with computer players when the game starts.
- If someone drops, a computer player covers their seat after a few seconds; they get their
  seat back when they reconnect (refreshing the page rejoins automatically).
- The host can seat a newcomer in place of a computer player mid-game, remove players, and
  change speed and computer skill.
- Games save after every move. A host who closes the tab can reopen the table from the home
  page with the same code.

Keep the host's screen open — if the host's device sleeps, the table pauses.

## Rook helpers ("automation")

- **Coach** (light bulb): suggests a bid, picks cards to bury, highlights a good play.
- **Auto-play** when only one card is legal; **auto-continue** between rounds.
- **Sure tricks**: when the leader is certain to take the rest, the round plays itself out.
- **Autopilot**: hand your seat to the computer and take it back any time.
- Computer players: Easy, Normal and Expert. They only see what a real player could see,
  read voids and bids, and simulate many deals before each decision.

## Project layout

```
public/                 ← the website (deploy this folder)
  index.html
  css/center.css        Game Center look
  core/                 shell, rooms & networking, sound, helpers
  games/index.js        list of games
  games/rook/           Rook: engine.js, ai.js, ui.js, cards.js (art), rook.css, rules.html
  games/hexstead/       Hexstead: engine.js, ai.js, geometry.js, scene.js (3D board), ui.js, art.js
  games/escape-grind/   Escape the Grind: engine.js, ai.js, cards.js (decks, jobs), scene.js (3D),
                        textures.js (painted-in-code textures), ui.js (HUD, controller), escape.css
  games/broadside/      Broadside: engine.js, ai.js, scene.js (3D sea), ui.js, broadside.css, rules.html
  games/four-in-a-row/  example game
  games/dogfight/       Coastal Dogfight: play.html (the game), index.js, ui.js (frame bridge)
  games/rally/          Ridgeline Rally: play.html (the game), index.js, ui.js
  vendor/peerjs.min.js
  vendor/three/         three.js r187 (MIT), shared by every 3D game, + the add-ons they use
                        (update with `npm run update-three`; see docs/ADDING_A_GAME.md)
tests/                  node --test
tools/                  local server, local PeerJS server
docs/ADDING_A_GAME.md   how to add a game
```

## Run locally

```bash
npm install
npm start          # http://localhost:8080
npm test
```

## Deploy (Cloudflare Pages)

Connect the repository in Cloudflare Pages with:

- Build command: *(none)*
- Build output directory: `public`

Netlify picks this up from `netlify.toml` (publish directory `public`). Any other static host works the same way: publish the `public` folder.

## Adding games

See [docs/ADDING_A_GAME.md](docs/ADDING_A_GAME.md).
