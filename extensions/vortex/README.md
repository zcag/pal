# Vortex

Turn round the centre and slip through the gaps as walls close in on the
beat. Enter on the palette's row (or its hotkey) opens it as a view level
whose body is the extension's own page (`surface/`, a `surface` view node).

The whole design, and why each part is there: [DESIGN.md](DESIGN.md).

## Playing

- **Turn** with the arrows (or A and D); hold Shift to turn slowly. Walls
  close in with a way through; be in it when they reach you. Turning into a
  wall's side stops you there.
- **Ranks** at 10, 20, 30, 45 and 60 seconds. A minute clears a stage, opens
  the next one and its hyper.
- **Space** plays, and plays again after a death; Backspace goes back to the
  stages; M turns the sound off. Escape (or closing pal) pauses a run.
- **Stages**: Pulse, Drift, Prism, Undertow, Overdrive, Singularity, each a
  chart written to its own song, in a world of its own; up on a cleared stage
  picks its hyper. Then **Endless** (every stage in turn, new walls each run)
  and the **daily** (today's walls, the same for everyone).
- **Your best run** races you as a ghost; a death replays its last second
  slowly with the wall that got you outlined; near misses spark.
- **Medals** (clear, steady, hairline, marathon) open new shapes and trails:
  C on the stages. P practises a stage from any rank you have reached.

## Code

- `game/`: the rules, pure and seeded. `sim.ts` (the run, patterns,
  collision), `content.ts` (every number), `bot.ts` (a planning player),
  `meta.ts` (the save).
- `surface/`: the page. `main.ts` (screens, keys, the loop), `render.ts`
  (WebGL2), `music.ts` and `songs.ts` (the synthesised music, which is also
  the clock).
- `scripts/survey.ts`: how long the bot lasts on every board.
- Tests: `host/test/extensions/vortex.test.ts`.

The font is Orbitron (SIL Open Font License, `surface/font/OFL.txt`).
