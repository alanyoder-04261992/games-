# Coastal Dogfight

A browser air-combat game. You fly a 1940s propeller fighter over a 20 × 20 km stretch of coast. Take off from the airfield, beat three waves of raiders that come in from the sea, then land back on the runway.

The whole game is one file, `index.html`. It needs no build step and no assets. Three.js loads from the jsDelivr CDN, and the terrain, aircraft, textures and sound are all generated in code when the page loads.

It works on phones as well as desktops.

## Running it

Open `index.html` through any static web server, for example:

```sh
cd dogfight && python3 -m http.server 8000
# then open http://localhost:8000
```

GitHub Pages works too. Opening the file directly with `file://` also works in most browsers.

## What's in it

- **World.** About 30 km of procedural terrain. It has hills and ridges inland, chalk cliffs and beaches along the coast, a river with its estuary, a mountain lake, forests, a patchwork of fields with hedges, farms with barns and sheds, a harbour town with a church and fishing boats, and a lighthouse. The sea uses a wave shader, the sky has a sun, and there are sprite cumulus clouds you can fly through.
- **Airfield.** A marked runway (36/18), apron, three hangars, a control tower, a windsock, fuel tanks and two parked fighters.
- **Two aircraft.** You can fly either one, and the enemy flies the other.
  - *Kestrel Mk IX*: elliptical wing, low wing loading, turns tightly, two cannon and four MGs.
  - *Falke G-6*: small wing, faster with a better climb, a nose cannon and two cowl MGs.
  - Both have a spinning propeller (it blurs to a disc at speed), moving ailerons, elevator and rudder, retracting gear, a canopy with a pilot inside, and a cockpit view with working gauges.
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
- **HUD.** Gun reticle, a lead indicator on the nearest target, target brackets with range, off-screen arrows, a heading-up radar drawn over the terrain map, a damage diagram, flight data, and warnings for stall, pull-up, fire, fuel, gear overspeed and leaving the sector. It also shows the effects of high G: blackout, redout, wingtip vapour and the stall horn.
- **Sound.** All sound is generated with WebAudio: the engine follows RPM, plus wind, guns, hits, bullet cracks, explosions, nearby enemy engines and the stall horn.

## Controls

### Phone and tablet

| Action | Control |
|---|---|
| Steer | Left thumb anywhere on the left side (a floating stick) |
| Throttle | Vertical slider next to FIRE |
| Fire | Hold **FIRE** |
| Gear / flaps | **GEAR**, **FLAP** |
| Camera / pause | **CAM**, **II** |

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

Open `index.html#autopilot` and an AI test pilot flies the full sortie by itself. It takes off on the runway heading, raises the gear, climbs and fights each wave. It logs a `[QA] debrief …` line to the console when the sortie ends.

`window.__sim(seconds)` runs the simulation headless without rendering, and returns the player's state, phase, wave, kills, shots and hits. It makes it quick to check take-off and combat in an automated browser.
