# Vortex: design

Turn round the centre and slip through the gaps as walls close in on the
beat. The genre is Super Hexagon's (Terry Cavanagh) and Open Hexagon's; the
numbers, patterns, music and picture here are our own.

This is the source of truth for the game's rules. Numbers live in
`game/content.ts`; this file says what each is for, so a change to one can be
judged against the rest.

## Pillars

1. **A death is always yours.** Every row of walls is spaced for the turn it
   asks (below, Fairness); a planning bot that sees only what you see clears
   every board, and a test keeps it so. When you die you know why, and you
   want the next run.
2. **The next run is one key away.** Space restarts at once, from the
   death screen or during the death itself; the music drops back in on the
   first beat of the new run.
3. **The music is the clock.** Walls land on its sixteenth notes, the world
   pumps with its kick, a song builds a layer at every rank.
4. **Awe at a glance.** A real 3D arena from a tilted, circling camera; HDR
   light, bloom, chromatic aberration, shockwaves; every stage its own colours
   and camera.
5. **Readable at 720 by 390.** The orbit sits in the middle, walls come out
   of the dark well before they reach you, their inner edge burns so the
   edge that kills is the brightest thing on screen.

## The run

The player is a point on a circle round the centre (`FEEL.orbit`), drawn as
a triangle. Left and right turn it (`FEEL.turn`, 9.6 rad/s: half a turn in a
third of a second); Shift turns at half that, for a fine line. A wall covers
one side of the polygon and a band of apothem; it closes in at the stage's
speed. Turning into a wall's side stops you flush against it; a wall reaching
you ends the run. The world turns (and reverses, and sometimes surges) but
that is only how it is drawn: nothing in the sim moves with it.

The time survived is the score. **Ranks** come at 10, 20, 30, 45 and 60
seconds (Line, Triangle, Square, Pentagon, Hexagon, after the Point you start
at). Sixty seconds clears a stage: it opens the next stage and the stage's
hyper, and the run goes on in the stage's other colours.

Within a run the walls quicken (0.42% a second to the minute, 0.16% after)
and the world spins faster; past the clear the spacing tightens by a tenth.

## Fairness

Patterns are rows with arrival times. `lay` spaces each row after the last by
the row's thickness, plus the time to turn from **anywhere** in the last
row's gap to the nearest gap of this one at full speed (`jump`, `travel`),
plus the stage's `margin`; the spacing rounds **up** to the sixteenth note,
so snapping to the beat never tightens a row. Between patterns there is room
for a half turn. The tunnel is spaced for the long way round; rails and
tunnels lay their long walls with the rows they enclose.

The bot (`game/bot.ts`) checks it: it cuts the orbit into 180 bins, looks
1.1 s ahead, works back how long each bin lasts, and turns toward the best bin
it can reach. It plans as if it turned at 65% speed, so it sets off early,
and only counts on more when that finds no way through. The tests run it 25 s
on all twelve boards; `scripts/survey.ts` runs it longer over more seeds (at
90 s, 94 of 96 runs live; the two losses are the bot's coarse bins, not the
walls).

## Stages

| Stage | Song | Speed | Margin | Sides | What it adds |
| --- | --- | --- | --- | --- | --- |
| Pulse | 132 bpm, A minor, uplifting | 5.6 | 0.20 s | 6 | the turn: barrages, runs, alternates |
| Drift | 144, D minor, electro | 6.4 | 0.17 | 6, 5 | the world reverses often; mirrors |
| Prism | 156, F♯ minor, chiptune | 7.0 | 0.15 | 4 to 6 | shapes change, colours cycle, scatter |
| Undertow | 120, G minor, half time | 7.6 | 0.14 | 5 to 7 | a steep camera; rails and tunnels |
| Overdrive | 168, B minor, breakbeat | 8.6 | 0.12 | 4 to 6 | strobing floors, whirlwinds |
| Singularity | 180, C minor, hard | 9.4 | 0.105 | 4 to 7 | all of it, surging spin |

Hyper: speed ×1.22, spin ×1.35, margin ×0.72, the stage's other colours.
Every tempo is a multiple of 12, so every rank lands on a beat.

Patterns: **barrage** (one gap), **run** (gaps that jump), **alt** (every
other side, then the others), **spiral** (the gap walks round), **zigzag**
(it rocks between two), **tunnel** (a long wall you go all the way round),
**mirror** (two gaps closing or opening), **scatter** (loose walls),
**rails** (two long walls halve the round, the gaps dance in one half),
**whirl** (a wide gap spinning: never stop). The first six seconds only deal
the plain three.

## Sound

Everything is synthesised (`surface/music.ts`, songs in `surface/songs.ts`):
kick, snare, hats, a two-saw bass with a sub, a pad, a pluck arp, a lead
(five saws at the higher ranks), chord stabs at the last. The kick ducks the
rest (the pump). The run's time is the heard audio time since its step 0, so
sight and sound never drift. Layers by rank: drums and bass, then the snare
and arp, the lead, wider lead and rides, quicker hats, stabs. On the menus a
song plays muffled; a death closes the filter like a tape stop, with a crunch
and a glitch, and a retry throws it open on a downbeat.

## Picture

`surface/render.ts`, WebGL2: a floor shader (alternating sectors, polygonal
rings rushing in, light pooled at the centre that breathes on the kick),
walls and centre as extruded prisms, the player with a short trail, all in
HDR into a 4× multisampled buffer; then a bloom mip chain, and a last pass
for chromatic aberration, the shockwave, flash, desaturation, grain,
vignette and an ACES tone map. Walls fade in out of the dark between 7 and
11 apothems, so nothing pops in.

Moments: a **rank** (banner, ring, shockwave, flash, a chord); a **record**
beaten mid-run (gold time, a chime); a **death** (shards, a white flash,
shake, the world slowing, walls drawn back outward in a rewind, colour
draining, the camera pushing in); a **retry** (flash, ring, the drop).

## Lasting

`game/meta.ts`: per board its best, tries and time; the stages open one by
one, a hyper with its stage's clear, the daily with Pulse's. The **daily**
is the same board and seed for everyone all day (the stages in turn), its
best kept for the day. The death card shows the time, the rank, the record
or the gap to it, and how far the next rank was: the reason for one more.
