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
| Camera | rigid, 38.5 degrees, about 12 m back, 28 down, on the centre line | rigid, low behind the car (2.3 m up, 6.4 m back, 50 degrees), following three quarters of the way; C cycles six others (Chase, Classic, Bumper, High, Tower, Long lens) | the road rushes at you; a steady frame to judge a turn against |

The tyre model (slip angles, load transfer) only takes over for 0.9 s after a
knock, so a bump still sends the car sliding.

## Traffic

Density is Traffic Racer's: 5 cars in the 140 m ahead at the start, one more
every 27 s, up to 14 (it then drops to 6; our breathers do that job). Speeds
are its band, 9 + top/5.7 to 51.5 + top/5.5 km/h, from a top speed halfway
between the first car's and yours (Progression, Cars),
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

## Progression

What keeps you coming back. Traffic Racer's long-term layer is a ladder of 48
cars priced to make you watch ads, three missions, and locations bought with
cash; score never pays. Ours keeps what works (cash from driving well, a next
car always in sight, missions) and adds a layer that rewards playing *better*,
not only longer. Every number below is a starting point that
`scripts/economy.ts` tunes against simulated players of four skills.

### The loop

A run pays **cash** (for cars and upgrades) and **XP** (for your driver
level). Both grow with how well you drove, so a better run is visibly worth
more, and the end of a run counts it up line by line.

- **Cash** comes from distance, every near miss (more for a closer one), the
  peak of your best combo, time above 150 km/h, time in the oncoming lane, and
  threading a gap; the place and the mode multiply it. The first run of each
  day pays double.
- **XP** is the score divided by 80, plus whatever missions you finish. Level 2
  takes 300 (a run); after that the curve is fitted to play time in
  `scripts/economy.ts`: a regular player reaches level 5 in about 20 minutes, 10
  in 1.5 h, 15 in 4 h and 25 in 16 h. A level pays 150 times its number.

### Driver level

Levels 1 to 40. Each one pays a little cash and many unlock something, so the
next reward is always named on screen:

| Level | Unlocks |
| --- | --- |
| 2 | Two-Way |
| 3 | High Noon |
| 5 | Time Attack |
| 6 | Golden Hour |
| 8 | Grey Day |
| 10 | Speed Trap |
| 12 | Night Run |
| 15, 20, 25 | paint collections (metallic, matte, two-tone) |

Places unlock by level rather than by cash: cash goes to cars and upgrades,
which you feel in the driving, and a place is a reward for getting better.

### Missions

Three at a time, each one run away: *pass 12 cars closely in one run*, *reach
a ×8 combo*, *drive 5 km in one run*, *thread the gap twice*, *30 s in the
oncoming lane*, *hit 220 km/h*, *score 40,000*, *use nitro 3 times*. The
targets grow with your level; a finished mission pays cash and XP and a new
one takes its place. In a run, progress on them shows briefly as it happens.

### Nitro

The one ability. Near misses fill the bar (more for a closer one, most for
threading a gap), and Space spends it: a burst of speed past the car's top
and double points while it lasts. It turns the near-miss game into a loop
(risk earns the boost, the boost earns more points at more risk) and gives
the fourth upgrade something to grow.

### Cars and upgrades

Seventeen cars in five classes, each with its own engine note: City (158 to 182
km/h), Sport (200 to 230), Muscle (245 to 275), GT (290 to 310) and Super (325
to 360). Every car is quicker, sharper and better on the brakes than the one
before, and the big jumps are between classes (measured, `game/vehicle.ts`):

| | Compact (first) | Asti (top Sport) | Saba (top Super) |
| --- | --- | --- | --- |
| 100 to 150 km/h | 17.3 s | 4.5 s | 2.4 s |
| A lane change at 160 | 0.54 s | 0.43 s | 0.34 s |
| A flick turned back | 0.21 s | 0.16 s | 0.13 s |
| Braking 160 to 100 | 1.02 s | 0.92 s | 0.81 s |

Four upgrades per car (engine, handling, brakes, nitro), five levels each: a
full set takes a car about half a class up. The garage shows the gain before
you pay: browsing another car, each bar marks yours and shows what it adds in
yellow; on an upgrade's row, what its next level adds.

Traffic follows only half of your climb in top speed (Traffic Racer scales it
with yours, so every car meets the same road): a faster car truly outruns it,
passes more cars a minute, and near misses pay more the faster you pass (×2 at
300 km/h). A better car is worth more money, not only more points.

Prices and the XP curve come from `scripts/economy.ts`, which plays thousands of
real runs with a bot of four skills (`game/bot.ts`) and pays careers through
`meta.finish`. The bot drives as a player does: it dodges by lanes, brakes only
when boxed in, and dares a speed over the traffic that grows with how quickly
its car changes lanes. It is a careful player (about 80 to 110 km/h on
average), so real play runs ahead of these numbers. What a minute pays in
Endless, measured:

| | Compact | Asti (Sport) | Saba (Super) |
| --- | --- | --- | --- |
| a good player | $436 | $637 | $754 |
| near misses a minute | 7.5 | 11.5 | 12.7 |

Cars run $2,500 to $56,000; upgrades cost 6% of the car's price (at least $800, so a
first run buys two or three, not a set), half again a
level. Simulated at 40 minutes a day:

| | regular | good |
| --- | --- | --- |
| First purchase | after run 1 | after run 1 |
| Something to buy | every 1 to 2 runs in the first 3 h, 3 to 5 after | the same |
| Into Sport / Muscle / GT / Super | 0.5 / 2.7 / 7.4 / 13 h | 0.4 / 1.5 / 4 / 7 h |
| The top car | about 18 h | about 9 h |
| Two-Way, Time Attack, Speed Trap, Night Run | 4 min, 14 min, 1.1 h, 1.8 h | 10 min, 15 min, 40 min, 53 min |
| Paint collections (levels 15, 20, 25) | 3, 7, 14 h | 1.4, 3, 6 h |

What it found and changed: a combo paid its square (12·c²), so short, wild
Two-Way runs out-earned everything; it now pays 30 per step. Near misses on
oncoming cars paid double cash on top of triple points; they pay triple
points only. Every car once earned about the same a minute (traffic kept pace
with your top speed, and cars barely differed); the classes, traffic that
falls behind a faster car, and near misses that pay with speed fixed that.

### Modes

| Mode | Opens | Rule |
| --- | --- | --- |
| Endless | at once | four lanes your way; one crash ends it |
| Two-Way | level 2 | the oncoming side pays three times, touching it ends the run |
| Time Attack | level 5 | a clock from 60 s; every 2.5 km adds time, a little less each time |
| Speed Trap | level 10 | stay above a speed that rises every 10 s; 3 s below it ends the run |
