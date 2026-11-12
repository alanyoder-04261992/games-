# Game Center

Card and board games to play with friends online or against computer players.
Plain HTML, CSS and JavaScript modules — no build step, hosts anywhere static files can go.

**Games**

- **Rook** — a full rebuild of the four-player trick-taking game with the house rules from the
  original app (45-card deck with the Bird, bids 100–200 plus solo 400/800, first lead names
  trump, 1000 to win). Animated dealing and tricks, original card art, Monte Carlo computer
  players, a coach, auto-play helpers and online play for up to four people.
- **Four in a Row** — a small, complete example of how a game plugs in.
- **Coastal Dogfight** — a real-time 3D flight game: 1940s fighters over a 20 km coastline.
  Up to four pilots team up against waves of raiders (you pick how many per wave and how
  many waves) or fight a free-for-all. Phone touch controls, mouse aim, keyboard and gamepad.
  Details in [docs/DOGFIGHT.md](docs/DOGFIGHT.md).

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
  games/four-in-a-row/  example game
  games/dogfight/       Coastal Dogfight: play.html (the game), index.js, ui.js (frame bridge)
  vendor/peerjs.min.js
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
