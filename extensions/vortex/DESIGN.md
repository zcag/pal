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

## Charts, not dice

A stage is a **chart**: the same seed every run (`chartSeed`), so its walls
are the same every time, like a level in a rhythm game. You learn it, the
ghost of your best is exact, and a drop lands on the same moment every run.
Chance lives in **Endless** (every stage in turn, a new run each time) and the
**daily** (the same chance for everyone all day). Walls never depend on what
the player does, which is what makes the ghost, practice starts and the
death replay cheap: the chart plays out the same whatever you did.

## Choreography

Each stage's song has a form (`content.ts`): intro, build, drop, break, with
bars and an energy, written to end near the minute that clears the stage,
then a loop (drop, break, build) for as long as you last. The music arranges
itself by it and the walls follow it (`plan` in `sim.ts`): plain patterns in
an intro and a break, with room to breathe; spirals, zigzags, whirls and
mirrors tightening through a build; the stage's whole repertoire in a drop,
whose **first downbeat lands a slam** (a wall all round but one gap). The
centre changes shape at the start of a section and the world reverses on bar
lines, so everything that happens, happens on the music. The page adds the
light: a build darkens over its last two beats, the drop throws it back with
a flash, a ring and the camera swung round (inverted for a moment in hyper);
breaks flatten the camera and pull back.

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

Everything is synthesised (`surface/music.ts`, songs in `surface/songs.ts`),
and the run's time is the heard audio time since its step 0, so sight and
sound never drift. Each song has an 8-bar progression (7ths, 9ths, sus
chords, a major V home) and an 8-bar call-and-response hook, and arranges
itself by its stage's form: an **intro** behind a closed filter with the hook
on a bell; a **build** whose filter sweeps open while the snare rolls from
quarters to 32nds, a riser climbs, a reversed cymbal swells and the kick
drops out for the last bar; a **drop** that lands a crash and a sub boom on
its downbeat, then full drums with ghost notes and fills, pumped supersaw
chords, the hook on a supersaw lead (a harmony and an octave shimmer from
the second drop); a **break** with no kick, the hook half time. The rank adds
a little on top. On the menus a song plays intro and break material,
muffled. A death closes the filter with a crunch and a glitch; its replay
bends the music down like slowed tape; a retry throws it open on a downbeat.
Endless queues the next stage's song on the bar its walls begin, with a
riser into it. Near misses zing in the current chord, climbing it through a
quick run.

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

## Feedback

- **Near misses**: a wall's edge passing within 0.06 rad of you (`GRAZE`)
  throws sparks off that edge and a bright zing, louder the closer.
- **Ghost**: your best run on a board plays alongside you as a faint
  hologram (its keys recorded run-length, replayed tick for tick on the same
  chart); overtaking it is the record.
- **Death replay**: after the impact, the last 1.1 s plays again at 0.42×
  speed with the wall that killed you outlined, the music slowed with it;
  then the walls roll back. Space retries at any point.

## Lasting

`game/meta.ts`: per board its best, tries, time, medals and the ghost of its
best; the stages open one by one, a hyper with its stage's clear, Endless
and the daily with Pulse's. **Medals**: per stage board Clear (a minute),
Steady (a minute without Shift), Hairline (20 near misses in a run),
Marathon (90 s); Endless has Tour, Voyage and Odyssey (2, 4, 6 minutes).
Medals open the player's **look**: five shapes and four trails (C on the
stages). **Practice** (P) starts a stage's chart at any rank you have
reached there, the walls played to that moment and you set down where it is
safe, untouchable for a moment; practice changes no record. The **daily**
is the same board and seed for everyone all day (the stages in turn), its
best kept for the day. The death card shows the time, the rank, the record
or the gap to it, and how far the next rank was: the reason for one more.
