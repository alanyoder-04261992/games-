# Play insights (owner only)

A private dashboard showing who plays the Game Center: each player (by the name they typed and
a random id for their device), what they play, how often, how long, alone, pass and play or
online, who they play with, and a feed of recent activity.

**Open it at** `https://<your-site>/#/insights` (it is linked from nowhere) and enter your
owner key. The key is remembered on that device; **Forget key** removes it.

## One-time setup: your owner key

The dashboard only answers to a secret key that you choose and that only you know:

1. In Netlify, open the site → **Site configuration → Environment variables → Add a variable**.
2. Key: `INSIGHTS_KEY`. Value: a long password only you know (for example four random words).
   Scope: Functions. Save.
3. **Deploys → Trigger deploy → Deploy site**, so the functions pick it up.
4. Open `/#/insights` and enter the same value.

Until `INSIGHTS_KEY` is set, the dashboard says it isn't set up and shows nothing. Play is
recorded from the first deploy either way, so nothing is lost while you set it up.

## What is recorded

Each device reports, in small batches:

| Event | When | Extra |
|---|---|---|
| `open` | the app is opened | |
| `start` | a game starts on this device (or a saved game is resumed) | game, mode, number of people and computer players, the people's names, game version |
| `end` | the game finishes | how long it took |
| `leave` | the player leaves before the end | how long they played |
| `join` | someone joins a friend's online table | game |

Each event carries a random device id (made on the device, kept in its storage) and the name
the player typed. The server stores the time. **Not stored:** IP addresses, locations, contact
details or anything else about the device. The owner's own visits to `/#/insights` aren't
counted.

## How it works

- `public/core/insights.js`: the app's side. `track(type, data)` batches events and sends them
  to `/api/track` (`sendBeacon`, so nothing is lost when a tab closes).
- `netlify/functions/track.mjs` → `handleTrack`: checks and cleans each event (known fields
  only, short strings, ids of letters and digits) and stores it in **Netlify Blobs**, store
  `insights` on the live site (`insights-preview` on deploy previews and branch deploys, so
  trying out a preview never mixes into the real numbers), one blob per event under
  `e/<YYYY-MM-DD>/…`.
- `netlify/functions/insights.mjs` → `handleInsights`: compares the `Authorization: Bearer`
  key with `INSIGHTS_KEY` (in constant time, slowly on a miss), reads the chosen days and
  returns the summary from `summarize()`.
- `netlify/lib/insights.mjs` holds all of that logic; `tests/insights.test.mjs` tests it.
- `public/core/insights-dashboard.js` draws the page.
- Locally, `npm start` serves the same API from `tools/serve.js`, storing events in
  `.insights-dev/` (git-ignored). The local key is `local`, or set `INSIGHTS_KEY`.

New ways to play that start or end games through core (`showTable`, `leaveCurrent`) are tracked
automatically. A new event type needs adding to `EVENT_TYPES` and `cleanEvent()`.
