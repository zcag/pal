# Highway

Weave through highway traffic at speed. Enter on the palette's row opens it
as a view level whose body is the extension's own page (`surface/`, a
`surface` view node, three.js on WebGL).

## Playing

- **The garage** is a sign beside the road while your car drives behind it:
  up and down pick a line, left and right change it (car, paint, mode, place),
  Enter buys (a car, a colour, an upgrade level, a place), Space drives.
- **A run**: up is the gas, down the brake, left and right steer (WASD too).
  Pass a car close above 100 km/h for a near miss, graded by the gap you
  left (Close, Very close, Paint trader); near misses within four seconds of
  each other build a combo. Points grow with the cube of your speed.
- **Crashes**: a bump is a bump; hitting something 35 km/h slower than you,
  or anything coming the other way, ends the run.
- **Modes**: Endless (four lanes your way) and Two-Way (the oncoming side
  pays three times).
- C changes the view (chase, far, bumper), P pauses, M mutes.

## How it is built

- `game/`: no DOM. `vehicle.ts` is the car (a dynamic bicycle model: tyre
  slip, load transfer, an engine with gears, a driver aid that holds the
  heading you ask for), `traffic.ts` the drivers (IDM car following, MOBIL
  lane changes, signals), `director.ts` where traffic appears (patterns per
  row, always a lane through), `score.ts`, `crash.ts` (boxes and impulses),
  `content.ts` every number and name, `meta.ts` the save.
- `surface/`: the page. `world.ts` builds a place (sky, road, rails, land),
  `terrain.ts` streams the land and plans it (forest, fields or a town each
  side, cuttings and embankments, an overpass every kilometre or two),
  `foliage.ts` makes trees cheap (impostors baked at startup) and the grass,
  `structures.ts` the overpasses, noise barriers, signs and lamp light,
  `run.ts` a run, `camera.ts` the views, `audio.ts` the sound, `main.ts` the
  screens.
- `scripts/drive.ts` measures every car (0 to 100, top speed, braking, a lane
  change); `scripts/trace.ts` traces a lane change step by step.
- `bun host/src/surface.ts extensions/highway 8733` serves the page in a
  browser.

## Assets and their licences

- **Cars** (`surface/cars/`): models by DanielZhabotinsky on Sketchfab, CC BY
  4.0, every one credited in `surface/cars/LICENSE.md`.
  `scripts/cars.ts <dir> <out> [ids]` converts the downloaded GLBs (turned to
  face +z, unseen parts removed, textures to shared WebP, glTF JSON with the
  buffer inline, since the page cannot be served binary files).
- **Skies, ground and props** (`surface/env/`): Poly Haven and ambientCG,
  CC0; trees made with EZ-Tree (MIT). `surface/env/LICENSES.md`.
- **Sound** (`surface/audio/`): CC0 engine, road and crash recordings from
  Freesound, Kenney's UI sounds (CC0), music CC0 and CC BY.
  `surface/audio/LICENSES.md` has every credit.
- **Type**: Overpass (SIL OFL 1.1), `surface/font/OFL.txt`.
- **three.js** (MIT): `surface/vendor/three.js`, rebuilt by
  `scripts/vendor.sh`.

## Platforms

macOS and Linux.
