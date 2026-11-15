# Playing online

The same guide is built into the Game Center: tap **How does online play work?** on the
home page, **Step-by-step guide** in the lobby, the **?** button at the table, or open
`…/#/help`.

## Start a table (the host)
1. On the home page, pick a game and tap **Multiplayer**. Check the game's settings in the
   pop-up, choose a **Table code**: *New each time*, or *My own code* (4 to 8 letters or
   numbers that stay the same every time you host, so friends can keep it), and tap
   **Continue**. The table code appears. Refreshing the page in the lobby reopens the same
   table with the same code, and friends reconnect by themselves.
2. Tap **Invite** to text or email the link, or read the code out loud.
3. Friends appear in seats as they join. In Rook the first friend sits across from you as
   your partner. Use **Sit here**, **Add computer** or **Remove** to arrange the table.
   **Change seat…** on any seat moves people: seat someone who is watching there, or swap
   two seats (to pick partners). If the table is full, a newcomer **watches**; give them a
   seat from **Give a seat…** next to their name. When a seat frees up, the first person
   watching takes it by themselves. Someone whose connection dropped gives up their seat if
   a new person arrives while the table is full (usually the same friend on another phone).
4. Tap **Start game**. Empty seats get computer players, so two people is enough.

## Join a table (everyone else)
1. Tap the invite link — or open the Game Center, type the code into
   **Join a friend's table**, and tap **Join**.
2. Pick a name and color the first time, then wait for the host to start. If there's an
   empty seat you'd rather have, tap **Sit here** on it.

## During the game
- **Chat** with the bubble at the top: a small see-through panel drops down so you can
  type and still see the table. New messages flash under the top bar for a few seconds
  while it's closed. Chat opens by itself when a game ends, to talk about a rematch.
- If someone drops, a **computer player covers their seat** until they come back.
- **Refresh or reopen** the link to get back to your seat. The home page also shows
  **Rejoin table**.
- **Late arrivals** can join mid-game. They watch, and the host sees a bar
  "Sara is watching · **Give a seat**": tap it and pick **Seat a player…** next to a
  computer player, or next to someone who went offline.
- A phone that switched apps or locked for a moment comes back on its own ("Sara is back").
- **Rematch** when a game ends: everyone keeps their seat and the same table code, so
  nobody has to rejoin. The host taps **Rematch — same players** to start. Anyone else taps
  **Rematch** to say they're in; the host's button then shows who's ready.

## Several people on one device (pass and play)
Most turn-based games let people share a phone or tablet:
- **Everyone in the same room, one device:** tap **Multiplayer**, choose **This device (pass
  and play)**, and type a name for each person. Empty seats get computer players. No
  internet needed.
- **Some online, some sharing:** in the online lobby, tap **Add a player on this device**.
  That person gets their own seat and plays on your screen. Friends can do the same on theirs.
- The device shows whoever has to move next. In games with hidden hands (cards, dice, fleets)
  a **Pass to Sam** screen covers everything until Sam taps, so nobody sees another hand.
- Not in real-time games (Spit & Speed, Coastal Dogfight, Ridgeline Rally), where everyone
  plays at once.

## Voice chat
- **Everyone at the table hears voice chat automatically**: nobody has to tap anything or
  allow a microphone just to listen. (On an iPhone, sound starts after the first tap on the
  screen; a **Tap to hear** button shows until then.)
- To **talk**, tap the **microphone** at the top of the table (or **Talk** in the lobby) and
  allow the microphone. Players and watchers alike, as many as are at the table.
- **Turn voice off** (in the voice list) stops all voice sound on that device; it stays off
  at the next table until you turn it on again.
- The mic is **always on**. Tap the green mic to mute, the red one to talk again. Whoever is
  talking lights up green.
- **The host can mute anyone for everybody:** people button → **Mute for all**. That person
  can't unmute until the host taps **Allow to talk**. Their audio also stops playing on
  everyone else's device, so it holds even if their app misbehaves.
- **Silence** mutes one person just for you.
- Audio goes directly between devices and is never recorded. With many people in voice
  (8 or more) each device carries a connection per person, so a weak phone may struggle.

## Good to know
- The host's device runs the game. Keep its screen on — if the host's phone locks, the
  table pauses. A tablet or computer on a charger makes the best host.
- Players don't need the same Wi-Fi. Any internet connection works.
- Games are saved. A host who closes the page reopens it from **Pick up where you left off**
  with the same code, and everyone rejoins.

## Troubleshooting
| Problem | Try this |
| --- | --- |
| "No table found" | Check the code (made-up codes never use I, O, 0 or 1; your own code can be anything). Make sure the host still has the table open. |
| "Can't reach table … yet" / stuck on "Connecting…" | That network is blocking the direct connection. Switch between Wi-Fi and mobile data and tap **Try again**; turn off a VPN or iCloud Private Relay. For the host: set up the free relay below so this stops happening. |
| A player shows "Reconnecting…" | Their device slept or lost signal. A computer covers; they reopen the link to take over. |
| Nobody hears me (voice) | Make sure the mic is green. If the host muted you, ask them to allow you. If the browser blocked the mic, allow it in site settings and tap Talk again. Others hear you without doing anything, unless they turned voice off. |
| I can't hear anyone (voice) | Turn the volume up and the silent switch off; on iPhone tap the screen once (or **Tap to hear**). If the voice list says voice is off, tap **Turn voice on**. |
| Everything froze | The host's device went to sleep — have the host unlock and reopen the Game Center. |

## For the host: a relay so everyone can connect

Players' devices connect straight to the host's. Most networks allow that, but some (often
mobile data, and work, school or hotel Wi-Fi) block it, and a player on one of them sits on
"Connecting to the host". A **relay** passes the game through for them. The Game Center uses
PeerJS's free shared relay, which is often busy; your own free Cloudflare relay makes it reliable:

1. Sign in at dash.cloudflare.com (a free account works) → **Realtime** (or "Calls") →
   **TURN Server** → **Create**. Name it "Game Center".
2. Copy the **Turn Token ID** and the **API Token** it shows (the API token is shown once).
3. In Netlify: the site → **Site configuration → Environment variables**. Add
   `CF_TURN_KEY_ID` = the Turn Token ID and `CF_TURN_API_TOKEN` = the API Token (scope:
   Functions).
4. **Deploys → Trigger deploy**. Every player now gets relay details from `/api/ice` before
   connecting. Cloudflare's free tier covers far more than a family's game nights.

## Put it on your home screen
- **iPhone / iPad:** Safari → Share → **Add to Home Screen**.
- **Android:** Chrome → ⋮ menu → **Add to Home screen** / **Install app**.
