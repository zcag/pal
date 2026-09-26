# Sudoku

Sudoku in the panel, made on your machine. Enter on the palette's row
opens the board as a view level whose body is the extension's own page
(`surface/`, a `surface` view node): the board, and beside it a slim
side with the clock, a line filling as the cells do, a pad of slim keys
(a bar under each digit for how many are down) and one row of tools.

The page imports the rules from `game.ts` and the solver from
`sudoku.ts`, the same files the host tests use, so it draws and takes
input but never decides a rule. Every move goes to the extension
(`pal.send`), which keeps the game in `progress.json`, so Escape anywhere
loses nothing.

- **Puzzles**: a daily for each of Easy, Medium, Hard and Expert, made
  from the date (the same on every machine that day), and a new one of
  any difficulty on ⌘N. A full grid is filled at random, clues are taken
  away in mirrored pairs while the answer stays unique, and the result is
  solved the way a person would and graded by the hardest technique it
  needed: singles you can spot (Easy), a cell with one digit left
  (Medium), locked candidates, pairs and triples (Hard), X-wings,
  swordfish and XY-wings (Expert). A puzzle of the wrong grade is thrown
  away and another made; an expert one takes a few dozen tries, about
  30 ms.
- **Notes without an extra step** (`game.ts` `enter`): a different digit
  typed over one you placed turns the cell into notes holding both (`j`
  marks the cell), and digits toggle notes there until Backspace clears
  it. With `check = "mistakes"` a wrong digit is replaced and a right one
  stays. Shift or Option with a digit, or N (Space) for notes mode, as
  before; on the pad a click places, a right-click, ⌥-click or the key's
  corner writes the note. Notes sit in a 3 by 3 in the cell; a placed
  digit clears its note from the cells it sees. A fills every note in,
  Shift-A clears them.
- **Auto notes** (C, `auto_notes = true`): a second layer. Every empty
  cell shows what fits, less what you took out (`x`, kept per cell, so a
  removal survives the board changing); your own notes (`n`) stay
  underneath for when it is turned off. `marks(p, auto)` is the layer on
  show; each move takes `auto` and writes only that layer.
- **Digit first** (D): pick a digit, the cells it fits in light up, a
  click places it (a note in notes mode). Enter places at the cursor, Tab
  goes to the next lit cell, D leaves.
- **Clarity**: clues solid, your digits in the accent colour; the
  cursor's row, column and box lit, its digit lit everywhere and that
  digit's notes circled; a clash is a red line under your digit with the
  clue it runs into ringed (every mistake in red with
  `check = "mistakes"`); a sweep of light for a finished row, column or
  box.
- **Hints** (I): where to look, then why in plain words, then the move.
- **Undo** (U, ⌘Z) and redo (Shift-U, ⌘⇧Z), erase (Backspace, 0), Tab to
  the next empty cell, arrows or `hjkl`, clicks on the cells and the pad.
- **The clock** runs only while the board is on screen; P pauses it
  and covers the board. T (or `clock = false`) hides it for anyone it
  rushes: no time on screen while you play, though the time still counts
  for the stats and shows on the finish.
- **Browse** (⌘O): every half-done game and a calendar of dailies per
  difficulty. **Stats** (⌘S): best and average time, the streak, a
  chart, the history, per difficulty.

Files: `sudoku.ts` (solver, generator, grader), `game.ts` (moves, marks,
the saved form, the hint), `stats.ts`, `store.ts`, `index.ts` (the
extension's calls), `surface/` (the page; `screens.ts` Browse and Stats,
`fx.ts` the confetti).
