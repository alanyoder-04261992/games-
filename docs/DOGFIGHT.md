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

## The world

The detailed core (the coast, the airfield, the town and the missions, 30 × 30 km) sits in the middle of a world about 68 × 68 km, on a coarser grid of its own:

- **North:** arctic. Rugged hills under snow down to the shore, snowy firs, sea ice floating off the coast, and an arctic station with a radio mast.
- **South:** desert. Dunes, flat-topped mesas, red rock, palms along the coast and a desert village.
- **West:** high mountains. Ridges up to about 2,000 m with snow above about 1,150 m; the river runs on up its valley.
- **East:** islands out at sea, lush in the south and rocky in the north, with shallows round them.
- **Edge:** the land falls away into the open ocean at the edge.

You may fly anywhere within 27 km of the centre (LEAVING SECTOR warns you, and further out the aircraft turns back); computer fighters stay within 15 km of the fight. Clouds thin out over the desert and thicken in the north. The water shader knows the outer world's depths, so the islands and far coasts have shallows too.

## Finding your way and landing

- **Compass:** a heading tape at the top of the HUD, with ticks for HOME (green), the objective (gold) and your next waypoint (cyan).
- **Home marker:** a HOME marker (or an arrow at the screen edge) appears when you need it: heading back to land, short of fuel, damaged, out of ammunition, or with the gear down near the field.
- **Landing guide:** with the gear down within 7.5 km of the airfield and below 1,000 m, the runway is outlined in green and gates mark a 3.5° glide path to the near end (whichever way you are heading). Beside the reticle it reads high or low, left or right of the centreline, and your speed against the approach speed (1.3 × stall). If you are low and slow near the field with the gear up, GEAR UP flashes.
- **Big map:** **N** (or **MAP** on touch) opens a map of the whole world: climates, the airfield and town, mission targets, every aircraft as an arrow, and your route. Tap or click to add waypoints (up to 6); tap one to remove it. **Fly route** hands the controls to an autopilot that flies the waypoints in turn, holding your height but keeping 250 m above the ground ahead; any stick input takes over again. **I** (or **ROUTE**) turns it on and off from the cockpit. The corner map's style (radar, sector, off) is chosen on the big map on touch, and with **M** on a keyboard. In single player the game pauses while the map is open.
- **Who your helpers are shooting:** an enemy your gunner or a wingman is firing at gets a green dashed ring and a tag (GUNNER, MACK, DUTCH).

## Campaign (single player)

The menu has two tabs: **Campaign** and **Free flight & missions**. The campaign is single player. In the Game Center it shows when nobody else is sitting at your table; with friends there, everyone uses Free flight. It is ten missions in a row:

| # | Mission | What | Time | Unlocks |
|---|---|---|---|---|
| 1 | First Patrol | Dogfight, two rookies | Day | Swift |
| 2 | Two's Company | Dogfight, two wingmen with you | Day | Ranger |
| 3 | The Coast Road | Ground attack | Day | Thunder |
| 4 | Iron Rails | Train busting | Day | Brute |
| 5 | Dusk Raid | Bomber intercept, two formations | Sunset | |
| 6 | The Black Heron | Dogfight with a named ace | Sunset | Lancer |
| 7 | Ship in the Dark | Naval strike under searchlights | Night | |
| 8 | Night Train | Train busting with searchlights | Night | Talon |
| 9 | Searchlights | Bomber intercept, three formations | Night | Striker |
| 10 | The Last Duel | Dogfight, ending with the Red Wasp | Day | |

- **Unlocking.** Each mission opens when the one before is finished.
- **Stars.** A mission earns up to three: one for finishing it, one for not losing an aircraft (being shot down or bailing out), one for an A grade. The best result is kept in this browser (`localStorage` key `dogfight.campaign`).
- **Medals** for the star total: Bronze wings (8), Silver wings (16), Gold wings (24), Ace of the coast (30).
- **Aircraft.** The Kestrel and Falke are open from the start. Missions unlock the rest *for the campaign*; Free flight always has every aircraft.
- **Debrief.** It shows the stars, any unlock or new medal, and a **Next mission** button.

## Named aces

The last wave of a single-player dogfight brings a named ace instead of an ordinary one: Viktor Kessel, *the Black Heron* (black, yellow trim); Ilse Brandt, *the Red Wasp* (red); or with jets, Arkady Volk, *the Grey Ghost* (grey). Each flies a painted aircraft with nose art and a checkered spinner, has a health bar at the top of the HUD, and takes about 1.8 times the damage of a normal aircraft.

- **Hard to stay behind.** An ace notices you on its tail quickly and scissors, reversing its turn every second or so.
- **Last stand.** Badly hit, it stops dodging, goes to full power and fires every missile it has.
- **Reward.** Shooting one down is worth +1000.

## Single player options

The game's menu has:

- **Time of day**: Day, Sunset or Night. At sunset the sun sits low over the sea. At night there are stars and a moon; the town's windows, the runway lights and the lighthouse are lit; tracers glow brighter; and **searchlights** sweep the sky round the targets (the battleship carries two). A searchlight that catches you locks on until you turn hard out of it, and while you are lit the flak is far more accurate. In the dark, unlit, it is far less accurate. Online, it is a table option.
- **Wingmen**: none, one or two (Mack and Dutch). They cover you by default. **T** sends them after your target (the locked one, or the nearest ahead). **Y** brings them back to cover you; they form up on your wings and go after anything that comes near you. **U** sends them in on the ground target: they dive with guns, rockets and bombs, pull out and come round again. On a phone or iPad, **WING** steps through the orders that make sense at that moment.
- **Rockets**: every fighter carries rockets: six on most fighters, ten on the Thunder, twelve on the jets, nineteen on the Striker, none on the bomber. **K**, **RKT** or **L3** fires a pair. They burn for a second, then fall like shells, and burst on aircraft, vehicles, wagons, the battleship or the ground (about 14 m blast). Land to rearm.
- **Flaps in a fight**: lowering the flaps (V or FLAP) in the air gives combat flaps: bank and pull back and your aircraft comes round at up to about 60 degrees a second, at any speed, jets included (a Kestrel turns about 15–18 without them, a Lancer at 540 mph about 14). It bleeds speed doing it and fades out as you near the stall, so a long hard turn ends slower. The extra turn swings the aircraft round the vertical the way you are banked, nose and flight path together, so it neither stalls nor adds g. It reads how hard you pull the stick (or how hard the aim point asks), not the g-limited elevator. Raise the flaps to get the speed back. Computer pilots never get combat flaps.
- **Rudder**: Q and E (or the rudder buttons) skid the nose round, and the flight path follows it, so a rudder turn keeps its new heading when you let go. In mouse or touch-drag aim it turns the aim point with it.
- **Altitude lock** (L, or ALT on touch): holds the height you are at, through turns too, until you push or pull the stick hard (or move the mouse up or down).
- **Formation** (O, or FORM): your aircraft flies itself onto the right wing of the nearest friend (another pilot first, otherwise a wingman), about 40 m out, and keeps station; you can still shoot. Move the stick to take over. A wingman you form up on holds a steady course for you.
- **Bailing out**: when you are shot down and the wreck is still falling, the HUD flashes **BAIL OUT**. Press **J**, **BAIL** or **R3** to jump. The same key works from a damaged aircraft at any time (twice from a healthy one). You fall clear, open the parachute a few hundred metres up and float down; a car or a boat picks you up and you are back in the air in a fresh aircraft, −100 points, and the mission goes on. If the wreck hits first, the mission is over. Half the time you are thrown clear when your aircraft explodes. Computer pilots often bail out too.
- **Mission**. The pause menu can **switch mission mid-flight**: the old fight is cleared and the new one starts round you. Online in co-op, missions are shared (see Multiplayer).
  - *Dogfight*: waves of enemy fighters come in off the sea; shoot them all down, then land.
  - *Naval strike*: a 190 m battleship steams up and down the coast about 5 km out. Its ten light AA mounts throw up flak bursts timed to where you will be and streams of tracer when you come close, its turrets turn to follow you, and its main battery shells the coast now and then. Bomb and rocket it until it rolls over and sinks: its hull takes about 1,600 points, so two direct 250 kg bomb hits and a few pairs of rockets do it in one sortie (four 500 kg bombs on their own; cannon fire helps a little), then land. Fighters scramble to defend it.
  - *Ground attack*: a convoy of tanks and trucks drives up a track to a fuel depot (four fuel tanks and two supply sheds) guarded by three flak guns. Bomb and strafe them: trucks fall to guns, tanks need cannon or bombs, and fuel tanks go up in a fireball. Flak guns are optional targets. Fighters scramble to defend it.
  - *Train busting*: an ammunition train (locomotive, tender, two flak wagons, six ammunition wagons) runs up the river valley on the north bank to a depot by the harbour, about 10 km. An ammunition wagon that blows up can set off the cars next to it, so the train goes up car by car. Destroy every ammunition wagon before it reaches the depot; knocking out the locomotive stops the train.
  - *Gunnery range* (single player): a tow plane flies an oval over the range west of the airfield, streaming a sleeve target 260 m behind it on a cable. Hits on the sleeve score 15; twelve shoot it away (+150) and a new one streams out. Bombs and rockets dropped on the circles score by how close they land (bullseye +400, 10 m +250, 25 m +120, 50 m +50). Five strafing boards score 10 a hit and shred after 15 (+100). The range closes after six minutes; then land. The tow plane can't be shot down.
  - *Bomber intercept*: formations of twin-engine bombers with fighter cover fly for the harbour town. Their top and tail gunners shoot back. If three bombers get through and drop on the town, the mission fails. The *Waves* option sets how many formations come (one to three).
  - **Bombs**: every aircraft carries bombs, in every mission (two to four on fighters, eight on the attack jet, ten in the bomber). Drop with **B** in the air (B is still the brake on the ground), **BOMB** on touch, or **LT** on a gamepad. A bomb sight on the HUD shows where a bomb released now would land and how long it would fall. Land on the airfield to rearm.
  - Targets show as red brackets on screen and squares on the radar; a gold marker (or an arrow at the edge of the screen) points to the objective.
- **Your aircraft turns tighter than the computer's.** You get about 30% more lift for the same angle (a tighter turn that bleeds less speed) and a quicker roll; raiders get less by difficulty (Easy 0.8, Normal 0.88, Hard 0.97, Ace 1.04) and notice you on their tail later, so you can work round behind them.
- **Kill replay**: when you shoot one down, the fight freezes (you, the others and the rounds in flight) while the camera circles the aircraft going down in slow motion.
- **Enemies per wave**: Standard (2, then 3, then more), or a fixed 1, 2, 3, 4, 6, 8 or 12.
- **Waves**: 1, 2, 3, 5 or 8. Skill rises through the sortie, and the last wave brings an ace.
- **Difficulty**, **Missile lock** (auto or manual) and **Corner map** are in the same menu and in the pause menu.
- **Phone mode**: Auto turns the touch controls on for phones. On forces them, which is useful on a tablet or a touch laptop. Off hides them in favour of the keyboard and mouse. The same switch is in the pause menu.
- **Tilt** (pause menu → Controls → Tilt phone): on iPhone and iPad the first tap asks for motion access. Tap the left half of the screen to re-centre on however you are holding the phone. Until the sensor answers, the stick keeps working.
- **Rudder buttons** (touch, off by default): two hold buttons above the stick, ◀ RUD and RUD ▶, that yaw the nose for fine aiming and for steering on the runway. Keyboard and gamepad already have rudder (Q / E, right stick).

## Multiplayer

In the Game Center, choose **Multiplayer** on its tile or options page. Friends join with the 5-letter code or the invite link, using the same lobby, chat and seats as the other games. The table options are:

| Option | Choices |
|---|---|
| Mode | **Co-op**: free play and shared missions. **Free-for-all**: every pilot for themselves. |
| Raiders per wave (dogfight missions) | Standard, or 1–12 |
| Waves (dogfight missions; bomber formations up to 3) | 1, 2, 3, 5 or 8 |
| Kills to win (free-for-all) | 3, 5 or 10 |
| Computer wingmen (co-op) | Off, or fill the empty seats with computer pilots |
| Friendly fire in free play (co-op) | On (default) or off: while neither of you is in a mission, your rounds, rockets and missiles can hit other pilots, and they show in amber instead of green |
| Time of day | Day, Sunset or Night |

Computer pilots always fly the empty seats in a free-for-all. Their skill follows the table's computer player setting: Rookie, Veteran or Ace. A pilot who is shot down is back in the air after 6 seconds. In co-op the round runs until the host ends it from the pause menu; in a free-for-all it ends when someone reaches the kill target (the host can end it early the same way). The debrief shows the scoreboard, and the host starts a new round for everyone.

### Co-op missions

A co-op round starts in **free play**: no raiders. The menu shows a *Free play* card first, then the four missions. Picking a mission there starts it as you launch, or joins it if someone is already flying it. While flying, the pause menu's *Mission* list does the same and shows who is flying what (`· join Ana`, `· you are in it`). Choosing *Free play* there leaves your mission.

- **Starting.** The pilot who starts a mission owns it. Their device runs it: it spawns the mission's raiders and bombers, sails the battleship, drives the convoy and decides when the mission is won or lost.
- **The banner.** Everyone else gets *"Ana started Naval strike — Join mission ✕"* across the top for 30 seconds. *Join mission* joins it, even partway through. ✕ (or ignoring it) leaves you in free play. Each kind of mission runs once at a time, so different pilots can fly different missions together. If two pilots start the same kind at the same moment, the lower seat keeps it and the other joins.
- **Everyone sees the targets.** The owner sends the mission's state twice a second (`mstate`: the battleship's position, heading and hull; each convoy vehicle's place on its track and health; the HUD line; the objective marker). Other devices build the same battleship and depot (the depot is laid out the same way on every device) and follow it. Mission raiders are ordinary aircraft from the owner's device.
- **Flak shoots at you on your own device.** Each device's copy of the flak guns aims at the aircraft that device flies, so everyone near a target gets shot at, with no network lag on the bursts.
- **Damage goes to the owner.** Bullets and bombs that hit a target on your copy are added up and sent to the owner four times a second (`mhit`). The owner applies them and sends back points to whoever destroyed something (`mpts`). Bombs you drop are also sent (`bomb`) so the others see them fall; only your device works out their damage.
- **Ending.** When the owner's device sees the mission won or lost it sends `mend`. Every member gets +500 for a win, and everyone returns to free play. The convoy's wrecks stay and a sunk battleship finishes going down. If the owner picks free play or another mission, theirs is called off for everyone in it. If the owner leaves the table, the others' copies end after 9 seconds of silence.
- **Debrief.** It shows how many missions the squadron completed, with your score and the ground targets you destroyed.

### How the network works

- **Each device flies its own aircraft.** It sends the aircraft's position, attitude, throttle, gear, firing and damage state 15 times a second over the room's real-time channel (`{ t: 'rt' }` in `core/room.js`). Other devices draw it with dead reckoning plus smoothing.
- **The host flies the computer pilots and holds the scoreboard,** sending it every half second. Each mission's raiders are flown by the device of the pilot who started it.
- **Hits are decided by the shooter.** Every device draws everyone's tracers, but only rounds fired by your own device count. A hit on an aircraft another device flies becomes a `hit` message to that device, which applies the damage through the normal damage model.
- **Shoot-downs are announced by the victim's device.** It sends a `down` event naming the aircraft that last hit it, so everyone gets the same kill credit and messages.
- **The bridge to the Game Center.** `ui.js` shows `play.html?embed=1` in a frame and passes messages through `postMessage`. Ending a round is a normal Game Center action (`{ type: 'finish', results }`), so the table, rematches and saving behave like the other games.
- **Pausing with friends doesn't stop the round.** When another person is connected to the table, the menu can't pause the round for them: your aircraft holds level flight while it is open. With only computer pilots at the table, pausing freezes everything, the same as playing alone.

## What's in it

- **World.** About 30 km of procedural terrain. It has hills and ridges inland, chalk cliffs and beaches along the coast, a river with its estuary, a mountain lake, forests, a patchwork of fields with hedges, farms with barns and sheds, a harbour town with a church and fishing boats, and a lighthouse. The sea uses a wave shader, the sky has a sun, and there are sprite cumulus clouds you can fly through.
- **Airfield.** A marked runway (36/18), apron, three hangars, a control tower, a windsock, fuel tanks and two parked fighters.
- **Ten aircraft.** Six 1940s fighters (one a two-seater with a rear gunner), a twin-engine bomber, two modern jets and an attack jet.
  - *Kestrel Mk IX*: elliptical wing, low wing loading, turns tightly, two cannon and four MGs.
  - *Falke G-6*: small wing, faster with a better climb, a nose cannon and two cowl MGs.
  - *Ranger D-20*: bare-metal long-range escort with a laminar wing and belly radiator; fast, six heavy machine guns.
  - *Swift A6*: feather-light, with a radial engine; out-turns anything, but it does not take punishment. Two cowl MGs and two wing cannon.
  - *Lancer F-2* (modern jet): single engine, cropped-delta wing, quick roll, a rotary cannon (50 rounds a second) and six missiles.
  - *Talon T-27* (modern jet): twin engines, twin canted fins, big wing, long range and tough.
  - *Warden Mk II*: a two-seater. A gunner in a powered turret behind the pilot fires on his own at enemies that come within about 700 m, anywhere above and behind you (not through the propeller or the floor). His guns turn to follow the target. Four wing guns for you, two bombs. Campaign: unlocked by mission 5. If you fly the Brute, its two gunners fire on their own the same way.
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
| Bomb / rockets | **BOMB**, **RKT** (they appear while you carry them) |
| Wingmen | **WING** (cover → attack → ground) |
| Bail out | **BAIL** (appears when you are badly hit or going down) |
| Hold this height | **ALT**; push or pull the stick to release it |
| Fly on a friend's wing | **FORM** (shows when a friend or wingman is in the air); move the stick to take over |
| Big map and waypoints | **MAP** |
| Fly the route | **ROUTE** (shows once you have set waypoints) |

**iPad.** iPadOS Safari reports itself as a Mac, so the game also counts a Mac with a touch screen as an iPad and turns the touch controls on (even with a keyboard attached; switch *Phone mode* off to use the keyboard and trackpad instead). On a tablet the HUD is drawn about 20% larger, and the stick and buttons are bigger and spread out for thumbs. Pinch and double-tap zoom are blocked over the game. *Add to Home Screen* opens it full screen.

The control style is set in the pause menu:

- **Stick · assisted** (the default on phones). Moving the stick part of the way sideways banks to an angle and holds it (up to 80°); all the way to the edge rolls freely. The stick has a curve, gentle near the centre and full at the edge. Let go and the wings level; let go in a gentle climb or dive (under about 15°) and it levels off and holds that height, and steeper it holds the angle. It holds height in turns, the rudder is automatic, and a limiter stops you stalling or overstressing. The rudder buttons bank it gently into a flat turn, so the new heading stays when you let go.
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
| Rockets (a pair) | K |
| Wingmen | T attack my target · Y cover me · U hit the ground target |
| Bail out | J (twice from an aircraft that isn't damaged) |
| Hold this height (altitude lock) | L; a big pull or push releases it |
| Fly on a friend's wing (formation) | O; moving the stick takes over |
| Big map and waypoints | N |
| Fly the route | I |

### Gamepad

Left stick pitches and rolls, the right stick's X axis is rudder and its Y axis is throttle, RT fires, LT brakes (and drops bombs in the air), A is gear, B is camera, X is flaps, LB fires a missile, RB drops flares, Y switches the map, L3 fires rockets, R3 bails out, D-pad left and right send your wingmen after your target or back to cover you, Back sends them at the ground target, and Start pauses.

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
