# Crossword

Mini crosswords from [Crosshare](https://crosshare.org) in the panel, in
the manner of the NYT Mini. Enter on the palette's row opens a view level
whose body is the extension's own page (`surface/`, a `surface` view
node): the grid on the left, as large as the panel's height allows; on the
right the puzzle's title and constructor, the clock, the clue you are on
in a bar of its own, and the Across and Down lists.

The page plays the solve with `game.ts`, the same file the host tests, and
hands every change to the extension (`pal.send`), which writes it to disk
before the next key. The puzzles, the lists and the record live on the
extension's side (`index.ts`).

## Puzzles

Crosshare is the one source. Three requests, each made only when a puzzle
or a list is about to be shown (`crosshare.ts`):

- `/dailyminis/<year>/<month>`: a month of daily minis. A Next.js page,
  the list in its `__NEXT_DATA__` as `[day, puzzle, constructor, patron]`,
  newest first; the site's days are UTC and its props' month is 0-based
  (the URL's is 1-based). Back to 2020.
- `/tags/mini/page/<n>`: the newest puzzles tagged `mini`, 20 a page,
  pages 0 to 9 (the site's own limit).
- `/api/ipuz/<id>`: one puzzle as ipuz (`ipuz.ts` reads it: circles,
  bars, the clue shapes the spec allows, the constructor's note).

A fetched puzzle is kept for good under `cache/puzzles/`, so a replay or
the archive never asks again and a puzzle once opened plays offline; a
past month's list is kept for good too, the current month's and the
newest pages are asked again after a while (sooner while today's mini is
missing). A failed request falls back to the cache, however old.
Offline, the page says so plainly and lists the puzzles opened before.
Nothing of Crosshare's ships with pal: the puzzles are their
constructors' work, fetched when you play and credited on the page ("by
… · Crosshare", a link to the puzzle on crosshare.org). The tests and the
screenshots use minis made for them (`host/test/extensions/crossword-fixtures.ts`).

**Which puzzle.** The first open is the puzzle left half-done, else
today's daily mini. **Next** (⌘N, or Enter on the finish) goes to an
unplayed one: today's daily while it is open; then, after a daily, the
dailies back from its day (a month's list at a time, four months at most
a step), then the newest minis; after a newest mini the other way round.
Anything solved or started, or bigger than 7 by 7, is skipped. The next
puzzle is looked up and fetched 1.5 s after one opens (`prefetch`), so
Next is instant.

## Playing

The NYT's keys:

- A letter (or digit) fills the square and moves to the next empty one in
  the word, skipping filled ones; typing over a full word goes square by
  square; a finished word jumps to the next clue that has a gap.
- Backspace clears the square; on an empty one it steps back and clears
  that, into the previous clue from a word's first square. Delete clears
  and stays.
- An arrow along the word moves one square (over blocks); an arrow across
  it turns first. Space, or a click on the cursor's square, turns.
- Tab and Shift-Tab (Enter and Shift-Enter too) walk the clues, across
  then down, skipping full ones while any has a gap. A click on a square
  or a clue goes there.
- ⌘E checks the word (⌘⌥E the square, ⌘⇧E the grid): a wrong letter gets
  a red slash until it changes, a right one turns blue and locks. ⌘U
  reveals the word (⌘⌥U the square, ⌘⇧U the grid, asking first): the
  answer in blue with a corner mark. ⌥⌫ clears the word, ⌘⌥⌫ the grid
  (locked squares stay). The `autocheck` setting slashes a wrong letter as
  it lands.
- ⌘P pauses: the grid is covered and the clues blurred. `?` shows every
  key; ⌘K lists the rest (start over, autocheck, the puzzle on
  crosshare.org).

The colours rank what you look at: the cursor's square yellow, its word
blue, the crossing word a faint blue; in the lists the clue you are on is
filled, the crossing one has a bar, and finished clues are greyed. The
clue bar keeps its height and shrinks a long clue's type to fit.

**The clock** runs only while the grid is on screen and unsolved: it stops
when the panel hides, on Browse and Stats, over the key sheet or a
question, and while paused. The time rides in every save.

**The finish.** A full grid with a mistake says "Not quite" and never
where. Solved, a wave of light runs across the grid on the diagonals with
every letter hopping in turn; then the time, a new best or the streak,
the constructor's note if there is one, and Next puzzle. A reveal makes
it "finished with help": it counts as solved, but not for the best time
or the streak; checks are only noted.

## Browse and stats

**Browse** (⌘O): the daily minis as a calendar, month by month (`[` `]`),
each day marked solved (gold), solved with help (grey), started (a pie of
how far) or new, with the day's puzzle beside it; Tab switches to the
newest minis as a list. Enter plays, ⌫ goes back.

**Stats** (⌘S): solved, best and average time (and the last ten), the
streak and the best one, a chart of the recent clean times with the
average, and the history. The streak counts daily minis solved without a
reveal on their own day, in Crosshare's (UTC) days; it reads from
yesterday until today's is solved.

**Now.** While today's mini is unsolved, a quiet row in the root's Now
section opens it (only once you have solved a puzzle, so it never nags
someone who does not play; `suggest` turns it off).

## Files

- `game.ts`: the rules, pure: numbering, the keys, check, reveal, clear,
  the finish, the saved form.
- `ipuz.ts`: ipuz to a puzzle. `stats.ts`: bests, averages, streaks.
- `crosshare.ts`: the pages, the cache, the next puzzle.
- `store.ts`: `progress.json` (every solve as it stands, the log of
  solves, each puzzle's name for the lists), written whole and atomically,
  a burst of saves coalesced into one write. `PAL_CROSSWORD_DIR` moves it
  (tests), `PAL_CROSSWORD_URL` points at a stand-in site.
- `surface/`: the page (`main.ts` the solve and the keys, `screens.ts`
  Browse, Stats and the offline page).

## Settings

```toml
[extensions.crossword]
autocheck = false   # mark a wrong letter as it is typed; also on ⌘K
suggest = true      # today's mini in the root's Now section while unsolved
```
