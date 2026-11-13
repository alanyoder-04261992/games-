# Coastal Dogfight

A browser air-combat game. You fly a 1940s propeller fighter over a 20 × 20 km stretch of coast. Take off from the airfield, beat three waves of raiders that come in from the sea, then land back on the runway.

The game is part of the Game Center. It is one file, `public/games/dogfight/play.html`, which needs no build step and no assets. Three.js r187 comes from the Game Center's shared copy in `public/vendor/three/` through an import map and draws with WebGPU (`WebGPURenderer`, which falls back to WebGL2 where WebGPU is missing) (see the 3D section of [ADDING_A_GAME.md](ADDING_A_GAME.md)), and the terrain, aircraft, textures and sound are all generated in code when the page loads.

It works on phones as well as desktops, alone or with up to four pilots online.

## Running it

```sh
npm start        # Game Center at http://localhost:8080, Coastal Dogfight is a tile on the home page
```

`/games/dogfight/play.html` also opens on its own as a single-player game.

## Difficulty, missiles, map and boost

- **Difficulty** (Easy, Normal, Hard, Ace) moves every raider up or down a skill level, sharpens or blunts their aim, and scales the damage you take: half on Easy, 1.5× on Ace. It also decides who carries missiles: nobody on Easy, the ace on Normal, veterans and aces on Hard, and everyone on Ace. Online, the host sets it as a table option.
- **Missiles** lock automatically. Keep a hostile near your nose and a square closes in with a growl; when it flashes red and the tone goes steady, fire with MSL, X, right click or LB. Missiles burn for 3 s, home with a lead on the target, are limited in how hard they can turn, and fuse by proximity. Manual lock (in settings) needs the target held near the centre for longer. You carry 4, or 6 on Easy.
- **Flares** (FLARE, F or RB) can pull an incoming missile away. A missile warning beeps faster as it closes, and a red arrow points at it.
- **Corner map**: the radar, a map of the whole sector, or off (MAP, M or Y).
- **Boost**: hold Shift at full throttle, or drag into the red top of the touch slider, for about 18 seconds of extra power.
- **Rearm**: land and stop on the airfield for 3 seconds to rearm, refuel and repair.
- **Kill streaks**: two or more kills within 10 seconds earn a bonus, and score pop-ups mark each shoot-down.

## Graphics

Rendering uses ACES tone mapping. The aircraft have metallic and glossy materials that reflect a blurred copy of the sky, and their paint is weathered with panel lines, rivets and chipped seams. The sea sums fifteen wave trains spread round the wind, each faded out before it is finer than a pixel so the distance never shimmers, with rougher and calmer wind patches, a sun glint that broadens with distance, light through the wave crests and gusty patches of whitecaps. Far out it fades to a sea haze darker than the sky. It shades shallow water turquoise and shows surf along the shore, using a depth map baked from the terrain. Trees are layered conifers and multi-crown broadleaves with trunks, with lone trees dotted among the fields. The sky runs from horizon haze to a deeper blue overhead, with light scattered round the sun, a sun disc and drifting wisps of high cirrus drawn with noise. Clouds have shaded bases, and contrails form above 2,700 m. Muzzle flashes light the wings, and the field of view widens with speed.

The **High** graphics setting adds bloom, which makes the sun, tracers, fires and explosions glow. It also turns on 4× multisampling, finer terrain and textures, and more trees. Phones default to Medium.

## Single player options

The game's menu has:

- **Mission** (single player; online tables fly the dogfight):
  - *Dogfight*: waves of enemy fighters come in off the sea; shoot them all down, then land.
  - *Naval strike*: a 190 m battleship steams up and down the coast about 5 km out. Its ten light AA mounts throw up flak bursts timed to where you will be and streams of tracer when you come close, its turrets turn to follow you, and its main battery shells the coast now and then. Bomb it (two to four direct hits, more for near misses) until it rolls over and sinks, then land. Fighters scramble to defend it.
  - *Ground attack*: a convoy of tanks and trucks drives up a track to a fuel depot (four fuel tanks and two supply sheds) guarded by three flak guns. Bomb and strafe them: trucks fall to guns, tanks need cannon or bombs, and fuel tanks go up in a fireball. Flak guns are optional targets. Fighters scramble to defend it.
  - *Bomber intercept*: formations of twin-engine bombers with fighter cover fly for the harbour town. Their top and tail gunners shoot back. If two bombers get through and drop on the town, the mission fails. The *Waves* option sets how many formations come (one to three).
  - **Bombs**: every aircraft carries bombs on attack missions (two to four on fighters, eight on the attack jet, ten in the bomber). Drop with **B** in the air (B is still the brake on the ground), **BOMB** on touch, or **LT** on a gamepad. A bomb sight on the HUD shows where a bomb released now would land and how long it would fall. Land on the airfield to rearm.
  - Targets show as red brackets on screen and squares on the radar; a gold marker (or an arrow at the edge of the screen) points to the objective.
- **Enemies per wave**: Standard (2, then 3, then more), or a fixed 1, 2, 3, 4, 6, 8 or 12.
- **Waves**: 1, 2, 3, 5 or 8. Skill rises through the sortie, and the last wave brings an ace.
- **Difficulty**, **Missile lock** (auto or manual) and **Corner map** are in the same menu and in the pause menu.
- **Phone mode**: Auto turns the touch controls on for phones. On forces them, which is useful on a tablet or a touch laptop. Off hides them in favour of the keyboard and mouse. The same switch is in the pause menu.
- **Rudder buttons** (touch, off by default): two hold buttons above the stick, ◀ RUD and RUD ▶, that yaw the nose for fine aiming and for steering on the runway. Keyboard and gamepad already have rudder (Q / E, right stick).

## Multiplayer

In the Game Center, choose **Multiplayer** on its tile or options page. Friends join with the 5-letter code or the invite link, using the same lobby, chat and seats as the other games. The table options are:

| Option | Choices |
|---|---|
| Mode | **Co-op vs raiders**: everyone against the waves. **Free-for-all**: every pilot for themselves. |
| Raiders per wave | Standard, or 1–12 |
| Waves | 1, 2, 3, 5 or 8 |
| Kills to win (free-for-all) | 3, 5 or 10 |
| Computer wingmen (co-op) | Off, or fill the empty seats with computer pilots |

Computer pilots always fly the empty seats in a free-for-all. Their skill follows the table's computer player setting: Rookie, Veteran or Ace. A pilot who is shot down is back in the air after 6 seconds. In co-op the round ends when the host lands after the last wave; in a free-for-all it ends when someone reaches the kill target. The host can also end the round from the pause menu. The debrief shows the scoreboard, and the host starts a new round for everyone.

### How the network works

- **Each device flies its own aircraft.** It sends the aircraft's position, attitude, throttle, gear, firing and damage state 15 times a second over the room's real-time channel (`{ t: 'rt' }` in `core/room.js`). Other devices draw it with dead reckoning plus smoothing.
- **The host flies the raiders and the computer pilots.** It also runs the wave timer and holds the scoreboard, sending both every half second.
- **Hits are decided by the shooter.** Every device draws everyone's tracers, but only rounds fired by your own device count. A hit on an aircraft another device flies becomes a `hit` message to that device, which applies the damage through the normal damage model.
- **Shoot-downs are announced by the victim's device.** It sends a `down` event naming the aircraft that last hit it, so everyone gets the same kill credit and messages.
- **The bridge to the Game Center.** `ui.js` shows `play.html?embed=1` in a frame and passes messages through `postMessage`. Ending a round is a normal Game Center action (`{ type: 'finish', results }`), so the table, rematches and saving behave like the other games.
- **Pausing with friends doesn't stop the round.** When another person is connected to the table, the menu can't pause the round for them: your aircraft holds level flight while it is open. With only computer pilots at the table, pausing freezes everything, the same as playing alone.

## What's in it

- **World.** About 30 km of procedural terrain. It has hills and ridges inland, chalk cliffs and beaches along the coast, a river with its estuary, a mountain lake, forests, a patchwork of fields with hedges, farms with barns and sheds, a harbour town with a church and fishing boats, and a lighthouse. The sea uses a wave shader, the sky has a sun, and there are sprite cumulus clouds you can fly through.
- **Airfield.** A marked runway (36/18), apron, three hangars, a control tower, a windsock, fuel tanks and two parked fighters.
- **Nine aircraft.** Five 1940s fighters, a twin-engine bomber, two modern jets and an attack jet.
  - *Kestrel Mk IX*: elliptical wing, low wing loading, turns tightly, two cannon and four MGs.
  - *Falke G-6*: small wing, faster with a better climb, a nose cannon and two cowl MGs.
  - *Ranger D-20*: bare-metal long-range escort with a laminar wing and belly radiator; fast, six heavy machine guns.
  - *Swift A6*: feather-light, with a radial engine; out-turns anything, but it does not take punishment. Two cowl MGs and two wing cannon.
  - *Lancer F-2* (modern jet): single engine, cropped-delta wing, quick roll, a rotary cannon (50 rounds a second) and six missiles.
  - *Talon T-27* (modern jet): twin engines, twin canted fins, big wing, long range and tough.
  - *Thunder TB-1*: heavy fighter-bomber with a big radial engine; rugged, eight heavy machine guns, four 500 kg bombs.
  - *Brute B-25*: twin-engine bomber with a glazed nose, two engines on the wings, a top turret and a tail gunner, and ten bombs in the bay (it drops them in pairs). No missiles.
  - *Striker A-12* (attack jet): straight thick wing, two engines in pods on top, twin tails on the tailplane tips, a heavy rotary cannon (65 rounds a second), eight bombs; slow for a jet, no afterburner, but it takes a lot of punishment.
  - Only fighters fly as raiders in dogfights; the bomber is the target in a bomber intercept.
  - The jets have afterburners (hold boost at full throttle; it burns fuel three times as fast instead of running out), fly-by-wire that pulls to 9 g and no further, a transonic drag rise that holds them to about 740 mph, tricycle gear, and two more missiles and four more flares than the 1940s fighters.
  - Raiders fly the other side's aircraft of your era: pick a 1940s fighter and you meet 1940s fighters, pick a jet and you meet jets.
  - The picker shows each aircraft with a small picture rendered from the game (`node tools/dogfight-plane-thumbs.cjs` remakes `public/games/dogfight/planes/*.jpg` after a model changes; it needs `npm start` running and Playwright), its top speed, guns and missiles, and two fun facts.
  - Every aircraft has moving ailerons (flaperons on the jets), elevators (all-moving tailplanes on the jets) and rudders, retracting gear, a canopy with a pilot inside, and a cockpit view with working gauges. The propellers blur to a disc at speed; the jets' nozzles glow with the throttle and show an afterburner plume.
- **Guns.** Rounds are ballistic, with muzzle velocity and gravity drop. Wing guns converge at 300 m. Every second or third round is a tracer.
- **Damage model.** Each part has its own hit points: engine, fuel tank, left wing, right wing, tail, pilot and fuselage.
  - An engine hit loses power, then smokes, and can catch fire or seize.
  - A fuel tank hit leaks, and the tank can catch fire or explode.
  - A damaged wing loses lift on that side, which rolls the aircraft. A wing can be shot off.
  - Tail damage reduces pitch and yaw authority.
  - Pulling too many G overstresses the wings.
- **Enemy AI.** Bandits pursue with lead and fire in bursts. They break when you get on their tail, extend after an overshoot, avoid head-on collisions, avoid terrain and stay inside the sector. There are three skill levels: rookie, veteran and ace (the ace has a red nose).
- **Mission.** Take off, fight three escalating waves, then return to base and land. The debrief shows score, kills, accuracy, damage taken, flight time, how good the landing was, and a grade.
- **Cameras.** Chase view, cockpit view, and a slow-motion kill camera (you can turn this off).
- **HUD.** Gun reticle, a lead indicator on the nearest target, target brackets with range, off-screen arrows, a heading-up radar drawn over the terrain map, a damage diagram, an artificial horizon (sky blue above, earth brown below, with INVERTED when you're upside down; the cockpit panel has its own), flight data, and warnings for stall, pull-up, fire, fuel, gear overspeed and leaving the sector. It also shows the effects of high G: blackout, redout, wingtip vapour and the stall horn.
- **Sound.** All sound is generated with WebAudio: the engine follows RPM (a jet has turbine whine, roar and an afterburner rumble), plus wind, guns, hits, bullet cracks, nearby enemy engines and the stall horn. A missile leaves its rail with a clunk, lights with a crack and a rising whoosh, and its motor roars past you, panned and Doppler-shifted, then whistles after burnout. Explosions arrive after their flash by the time sound takes to travel: a crack up close, a falling boom, a sub-bass thump, a long rumble and wreckage pattering down.
- **Explosions.** A white-hot flash, a fireball that swells and rises, a shock ring racing outward, sparks arcing down, burning wreckage tumbling away trailing smoke, and dark smoke billowing upward; crashes add a dirt plume or a column of spray, and nearby blasts shake the camera.

## Controls

### Phone and tablet

| Action | Control |
|---|---|
| Steer | Left thumb anywhere on the left side (a floating stick) |
| Throttle | Vertical slider next to FIRE |
| Fire | Hold **FIRE** |
| Gear / flaps | **GEAR**, **FLAP** |
| Camera / pause | **CAM**, **II** |
| Rudder (optional) | hold **◀ RUD** or **RUD ▶**; turn on *Rudder buttons* in the menu or pause menu |

The control style is set in the pause menu:

- **Stick · assisted** (the default on phones). Wings level themselves when you let go, the aircraft holds your climb or descent angle, it holds height in turns, rudder is automatic, and a limiter stops you from stalling or overstressing.
- **Stick · manual.** Raw control surfaces.
- **Touch-drag aim.** Drag anywhere to move an aim point, and the aircraft flies toward it.
- **Tilt.** Tilt the phone to steer (assisted). If the browser blocks motion sensors, the game switches back to the stick.

Landscape works best, and the menu has a Full screen button on Android.

### Desktop

| Action | Keys |
|---|---|
| Aim (mouse-aim mode) | Move the mouse; the aircraft flies to the circle |
| Fire | Left click / Space |
| Pitch / roll / rudder | W S / A D / Q E (these override mouse aim at any time) |
| Throttle | Shift up, Z down, mouse wheel, 1–9 and 0 (full) |
| Gear / flaps / brakes | G / V / B |
| Camera | C |
| Pause and settings | Esc or P |

### Gamepad

Left stick pitches and rolls, the right stick's X axis is rudder and its Y axis is throttle, RT fires, LT brakes, A is gear, B is camera, X is flaps, and Start pauses.

## Flight model

The flight model is a six-degree-of-freedom point mass with simplified rotational dynamics. Physics runs at a fixed 120 Hz. In the body axes, x points right, y up and −z forward.

**Air data**

```
ρ = 1.225 · exp(−h / 8500)                 air density (kg/m³)
q = ½ ρ V²                                 dynamic pressure
α = atan2(−v_body.y, −v_body.z)            angle of attack
β = atan2(v_body.x, |v_body.z|)            sideslip
```

**Lift.** Linear up to the stall, then a drop to a flat-plate model.

```
|α| ≤ α_s :  C_L = C_L0 + C_Lα·α
|α| < 0.7 :  C_L = (C_L0 + C_Lα·α_s·sign α) · (1 − 0.5·s),   s = min(1, (|α|−α_s)/0.3)
otherwise :  C_L = 0.85 · sin 2α
C_L += 0.38 · flaps;   C_L *= mean wing health
```

**Drag**

```
C_D = C_D0 + C_L² / (π e AR) + 0.9·max(0, sin²α − sin²α_s) + 0.45 β²
      + 0.04·flaps + 0.022·gear + damage terms
```

**Forces**

```
L = q S C_L   along  normalize(right × v̂)
D = q S C_D   along  −v̂
Y = −0.9 q S β along  right
T = min(T_static, P·η / max(V, 20)) · throttle · engine health,   η = 0.82
P falls off above 5,500 m as exp(−(h−5500)/7000)
m·dv/dt = L + D + Y + T + m·g
```

**Rotation.** Body rates are integrated, with qₙ = q / q_ref and q_ref = q at 110 m/s at sea level.

```
ṗitch = qₙ (K_e·δe·tail − C_mα (α − α_trim)) − C_mq ω_x √qₙ
ṙoll  = −qₙ K_a·δa·fade(V) − C_lp ω_z √qₙ + 3 qₙ (f_R − f_L) C_L     (asymmetric wing damage)
ẏaw   = qₙ (−K_r·δr·tail − C_nβ β) − C_nr ω_y √qₙ
```

Above 205 m/s, compressibility stiffens the controls. In a stall the wing drops (a roll moment with a random or spin-direction sign) and the nose drops.

**Pilot load.** n = (F_aero + T)·up / (m g). Sustained loads above +11.5 g or below −5.5 g damage the wings. On screen, blackout starts at +6.2 g and redout at −2.4 g.

**Ground handling.** The aircraft is a tail-dragger with a three-point attitude of 11°. Ride height follows the main-gear geometry, `h = 1.95 cos θ − 0.6 sin θ`. It has rolling friction, brakes, tailwheel steering, and side-slip removal on the ground. A touchdown is survivable when the gear is down, sink rate is under 6.5 m/s, bank is under 16°, and the ground is flat. A gentle gear-up landing counts as a belly landing.

**Assists.** These are shared by the AI, mouse aim and the assisted stick. The pitch command is a feed-forward trim for the load factor you ask for, plus feedback on the error:

```
δe_ff = C_mα/K_e · ((n·m·g / (q S) − C_L0) / C_Lα − α_trim)
```

It is clamped so that α stays under 0.9 α_s and n under 8.5 g.

## QA autopilot

Open `/games/dogfight/play.html?autopilot` and an AI test pilot flies the full sortie by itself. It takes off on the runway heading, raises the gear, climbs and fights each wave. It logs a `[QA] debrief …` line to the console when the sortie ends.

`window.__sim(seconds)` runs the simulation headless without rendering, and returns the player's state, phase, wave, kills, shots and hits. It makes it quick to check take-off and combat in an automated browser.
