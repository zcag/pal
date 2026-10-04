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
- **Stages**: Pulse, Drift, Prism, Undertow, Overdrive, Singularity, each with
  a song, colours, camera and patterns of its own; up on a cleared stage
  picks its hyper. The last card is the **daily**: today's walls, the same for
  everyone.

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
