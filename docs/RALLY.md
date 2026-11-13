# Ridgeline Rally

A browser racing game. Race country roads over hills, farms and lakeshores, against computer cars, against up to three friends online, or against your own ghost in a time trial.

The game is part of the Game Center. It is one file, `public/games/rally/play.html`, with no build step and no assets. Three.js r187 comes from the Game Center's shared copy in `public/vendor/three/` through an import map and draws with WebGPU (`WebGPURenderer`, which falls back to WebGL2 where WebGPU is missing) (see the 3D section of [ADDING_A_GAME.md](ADDING_A_GAME.md)), and the circuits, cars, textures and sound are all generated in code when the page loads.

## Running it

```sh
npm start        # Game Center at http://localhost:8080, Ridgeline Rally is a tile on the home page
```

`/games/rally/play.html` also opens on its own as a single-player game, with the car, circuit, laps, opponents and difficulty in its menu.

## Circuits and cars

| Circuit | Character | Light |
|---|---|---|
| Ridgeline Loop | fast sweepers and crests over farm country | midday |
| Lakeside Sprint | tighter corners round a lake | golden hour |
| Hollow Creek | hairpins and a long back straight through the woods | morning |

Each circuit is a closed spline. The road heights follow the land, smoothed into gentle grades, and the terrain is flattened under and beside the road. Corners get red-and-white kerbs and tyre stacks, and boards on the roadside warn of the big braking zones.

| Car | Drive | Feel |
|---|---|---|
| Sparrow RS | front | light, quick to turn, easy to drive |
| Brumby V8 | rear | most power; the tail steps out under throttle |
| Vela GT | rear, mid-engine | downforce makes it the fastest through quick corners |

## Driving model

Each car is a two-axle model with slip-angle tyres. Weight shifts under braking and acceleration, every tyre has a friction circle (a braking or spinning tyre has less grip left for cornering), and drag, rolling resistance and hills all count. The rear tyres grip a little more than the fronts, so the cars understeer gently at the limit instead of spinning, except the Brumby, which has the least margin. Off the tarmac there is less grip and more drag, and trees stop you dead.

**Full steering is always the tightest turn the tyres can hold.** The steering lock narrows with speed to the angle for the car's grip plus the front tyres' peak slip, so holding a steering button never asks for an angle the tyres can't use. **Stability control** caps how fast the car can rotate at the rate its grip can sustain, so a sharp turn-in carries straight into a clean, steady arc (about 1.1–1.3 g, depending on the car) instead of overshooting into a slide. It is looser with the assist off, loosest in the V8, and off while the handbrake is held, so drifts still work.

**Driving assist** counter-steers real slides (it ignores the small slip of normal cornering) and eases the throttle when the wheels spin. **Auto accelerate** holds the gas so you only steer and brake. Both are in the settings, and the assist is on by default on phones.

## Computer drivers

They follow a racing line that cuts to the inside of each corner. They steer by pure pursuit toward a point down the line, with a pull back toward the line from where the car is now. They brake for the slowest corner within braking distance, catch slides, and move over to pass. Difficulty sets how close they run to the grip limit (Easy 80 %, Pro 100 %).

## Graphics (Three.js r187, WebGPU)

The game draws with `WebGPURenderer`: WebGPU where the browser has it, WebGL2 otherwise (it checks for a GPU adapter first and picks the backend itself). Custom shading is written in TSL node materials.


- **Sky:** the r187 physical `SkyMesh` (the WebGPU version of `Sky`), with Rayleigh and Mie scattering and its built-in drifting cloud layer. Each circuit sets the sun angle, haze and cloud cover.
- **Auto-exposure:** at load, the game renders the sky a pixel at a time all the way round the horizon. It sets the sky's brightness from the log-average, like a camera's meter, so a sunset glow doesn't black out the rest. The fog takes the horizon colour, so the hills fade into the actual sky behind them, and the lake reflects it too.
- **Reflections:** cars and road reflect a pre-filtered environment map made from that same sky, clouds included.
- **Car models:** bodies are lofted. A rounded cross-section is swept from nose to tail, following each model's side profile, with sills that rise to cut real wheel arches and wings that swell into fenders. The glasshouse is a second, narrower loft that tumbles in toward the roof, framed by body-coloured A-, B- and C-pillars and a roof panel. Details: slim headlamps that follow the bonnet, a full-width tail-light bar that brightens when braking, a grille, number plates, mirrors, exhausts, a splitter, a diffuser and side skirts. The hatch has a roof spoiler, the V8 a ducktail and the GT a wing and bonnet vents. Wheels have lathed tyres with rounded shoulders, five-spoke rims (silver, black or gold by model), brake discs and calipers.
- **Car paint:** `MeshPhysicalMaterial` with a clear coat. The livery is projected from the side onto the flanks (stripe, door lines, roundel) and from above onto the bonnet, roof and deck (twin racing stripes, roof number). A soft contact shadow sits under every car.
- **High setting:** adds sun shadows (r187's `PCFShadowMap`) and a `RenderPipeline`: half-resolution ground-truth ambient occlusion (the TSL `ao()` node, denoised) for soft shading under cars and buildings and among the trees, and a light `bloom()` on the sun, lights and glints, plus 4× multisampling, a finer terrain and more trees.

Medium and Low skip the post chain entirely: each material tone-maps itself and draws straight to the screen, as WebGL did, so there is no extra full-screen pass. Phones default to Medium. Terrain and tree detail change the next time a circuit loads.

## Phone layout

On a phone the map sits at the top centre and the speedometer at the bottom centre, between the thumbs. On short screens (under 430 px tall, typical in landscape with the browser bars and the Game Center header showing), DRIFT moves beside BRAKE and the buttons and readouts shrink a size. Under 300 px they shrink again and the best-lap line is hidden.

## Playing online

In the Game Center the host picks the circuit, laps, computer cars and their skill as table options. Everyone picks their own car and colour; if two drivers pick the same colour, the lower seat keeps it. Each device drives its own car and streams it 15 times a second. The host drives the computer cars, including any computer players seated at the table. The host ends the race when every human driver has finished, or 45 seconds after the first finisher. Everyone sees the same results, and the host can start a new race for everyone.

## Testing hooks

`window.__sim(seconds)` runs the race headless and returns the player's state. `window.__autodrive = true` hands the player's car to the computer driver. `#autopilot` in the URL starts a one-lap race on its own. `tools/rally-thumbnail.cjs` stages and renders the tile art.
