# Highway: design

What the game is for and why each part is the way it is, so a change to one
can be judged against the rest. Numbers live in `game/content.ts`; the
reference is Traffic Racer (SK Games), whose code we read (v4.0 and v2.5) for
its numbers, not its assets.

## Pillars

1. **Speed is the dial.** Points grow with the cube of speed and near misses
   only count above 100 km/h, so going faster and passing closer are one
   decision.
2. **The car does what your thumb says.** A key press shows on screen at
   once; letting go ends the move where you let go.
3. **Readable traffic.** You are always the fastest thing on the road; other
   drivers keep gaps, signal and change lanes when it is safe; a row never
   blocks every lane.
4. **It looks real.** Textured cars, photographed skies, PBR road and land;
   the motion keeps a real car's shape (it yaws into a move, leans, settles).

## Feel

`FEEL` in `game/content.ts`; the control itself is `Vehicle.step` (the arcade
branch), the body's lean is in `surface/run.ts`, the views in
`surface/camera.ts`.

| | Traffic Racer | Ours | Why |
| --- | --- | --- | --- |
| Pace | the world scrolls 1.66 times the dial | 1.4 | true scale feels slow; 1.66 makes realistic cars read as toys |
| Crossing speed | about 8.4 m/s at 100 km/h, 13 at 200 | 5.5 m/s + 7% of the speed: about 10 at 100, 13 at 200 on the dial | dodging grows more urgent, not harder, with speed |
| Steering ramp | 0.17 s to full | the same | a tap nudges, holding commits |
| Letting go | the sideways motion stops in about 0.2 s | about 0.3 s, no overshoot | a lane change ends where you let go |
| Heading on screen | input times (3 + 0.035 per km/h) degrees | 85% of the real heading (about 8 at 160) | the car points into the move, never a drift |
| Body lean | input times (4 + 0.05 per km/h) degrees, 12 at 160 | 45% of that, on a soft spring | 12 degrees looks cartoonish on realistic cars |
| Camera | rigid, 38.5 degrees, about 12 m back, 28 down, on the centre line | rigid, 42 degrees, 4.4 m up, 17 down, following a third of the way | a steady frame to judge a turn against, with more road ahead |

The tyre model (slip angles, load transfer) only takes over for 0.9 s after a
knock, so a bump still sends the car sliding.

## Traffic

Density is Traffic Racer's: 5 cars in the 140 m ahead at the start, one more
every 27 s, up to 14 (it then drops to 6; our breathers do that job). Speeds
are its band from your car's top speed, 9 + top/5.7 to 51.5 + top/5.5 km/h,
faster lanes to the left, trucks slower. Where it drops cars at random,
`game/director.ts` plans rows (a single car, a pair, a door to thread, a
diagonal, a truck with company, a near wall) and never closes every lane; the
first 150 m keep your lane clear. Drivers follow with IDM and change lanes by
MOBIL, signalling first (`game/traffic.ts`).

## Scoring and crashes

Its rules, measured: points per second from speed (v³·10⁻⁶ + v²/3000 past
100 km/h, times 25); a near miss is a pass under about 1 m above 100 km/h,
graded here by the gap (Close, Very close, Paint trader); combos within 4 s;
the oncoming lane pays three times; two passes within 0.15 s pay 2500. A hit
ends the run when the closing speed is 35 km/h or more, or the car was
coming the other way.
