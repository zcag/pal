# Crossword

Daily crosswords in the panel: Crosshare's English minis in the manner of
the NYT Mini, and the Turkish papers' kare bulmaca (HaberTürk, Cumhuriyet,
Sabah). Enter on the palette's row opens a view level whose body is the
extension's own page (`surface/`, a `surface` view node): the grid, as
large as the panel allows; the puzzle's title and source, the clock, the
clue you are on in a bar of its own, and the Across and Down lists.

The page plays the solve with `game.ts`, the same file the host tests, and
hands every change to the extension (`pal.send`), which writes it to disk
before the next key. The puzzles, the lists and the record live on the
extension's side (`index.ts`).

## Sources

A source lists a month of its puzzles and fetches one as a puzzle
(`sources.ts`); nothing else about it leaks out. Every request is made only
when a puzzle or a list is about to be shown, and kept (`cache.ts`): a
fetched puzzle for good under `cache/puzzles/`, so a replay or the archive
never asks again and a puzzle once opened plays offline; a list while it
is fresh. A failed request falls back to the cache, however old; offline,
the page says so plainly and lists the puzzles opened before. Nothing of
any source's ships with pal: the puzzles are their makers' work, fetched
when you play and credited on the page with a link to the puzzle's own
page. The tests and the screenshots use puzzles made for them
(`host/test/extensions/crossword-fixtures.ts`, `crossword-tr-fixtures.ts`).

| Source | What | Archive | Size |
| --- | --- | --- | --- |
| Crosshare | daily minis, and the newest minis tagged `mini` | 2020 on | minis (Next plays up to 7 by 7) |
| HaberTürk | günlük kare bulmaca | 25 November 2017 on, every day | 8 by 8 |
| Cumhuriyet | günlük kare bulmaca, with a photo the clues point at | February 2026 on, most days | 17 by 11 |
| Sabah | kare bulmaca, an archive that stopped | July 2024 to April 2025 | 9 by 9 |

- **Crosshare** (`crosshare.ts`): `/dailyminis/<year>/<month>` is a
  Next.js page with the month in its `__NEXT_DATA__` as `[day, puzzle,
  constructor, patron]`, newest first; the days are UTC and the props'
  month 0-based. `/tags/mini/page/<n>` has the newest minis, 20 a page,
  pages 0 to 9 (the site's limit). `/api/ipuz/<id>` is one puzzle
  (`ipuz.ts`: circles, bars, the clue shapes the spec allows, the
  constructor's note).
- **HaberTürk** (`turkish.ts`): `/bulmaca/gunluk/YYYY/MM/DD` carries the
  puzzle as `var _data = [...]`, each answer with its clue, direction and
  1-based start; `fromEntries` builds the grid from them (blocks where no
  answer runs, numbered as the grid numbers, each clue on the word that
  starts where its answer does; an answer that is not a word of the grid is
  refused). Later days are up before their day; a day is played only once
  it has come. There is no list: the calendar shows every day, and Next
  passes by a day that turns out to have none.
- **Cumhuriyet**: the game's own JSON on `cumhuriyet.lidyagames.com`:
  `/api/list` for the archive, `/api/puzzle/YYYY-MM-DD` for a puzzle (the
  rows, the clues by the grid's numbers, and a photo over a 5 by 5 block
  as a data URL, drawn over its squares; a click shows it large).
- **Sabah**: the month slider (`POST /bulmaca-coz/getsliderarticles`; the
  site reads only the month of the date sent), then the article, then the
  player page in its iframe (`isbh.tmgrup.com.tr`), which holds the puzzle
  as base64 JSON in the same shape as HaberTürk's. A day with two puzzles
  lists the first. The same player files come back under other dates, so
  two days can be the same puzzle.

The papers' days are Istanbul's (UTC+3), Crosshare's UTC.

**Turkish letters.** On a Turkish puzzle (`lang: "tr"`) a key is upper-cased
the Turkish way (i to İ, ı to I), and a letter matches its answer with the
diacritics folded (Ç C, Ğ G, İ I, Ö O, Ş S, Ü U): the papers' grids cross Ç
with C and Ü with U (Sabah's often), and their own players check that
way. So a US keyboard solves one with plain letters, and a plain letter that
matches shows as the answer's own (c typed where Ç goes shows Ç, i where I
goes shows I). A Turkish keyboard's letters, and macOS's ⌥c (ç), type as
they are.

**Which puzzle.** The first open is the puzzle left half-done, else today's
puzzle of the `source` setting (an archive's newest). **Next** (⌘N, or
Enter on the finish) stays with the puzzle's source and goes to an
unplayed one: today's while it is open, then back from the puzzle's day, a
month's list at a time (four months at most a step); for Crosshare, the
newest minis too (first after a newest mini, last after a daily).
Anything solved or started is skipped. The next puzzle is looked up and
fetched 1.5 s after one opens (`prefetch`), so Next is instant.

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

**Browse** (⌘O): **In progress** first, every half-done puzzle from any
source, the last played on top (Enter picks it up where it was left); then
a tab per source (Tab walks them), Crosshare's newest minis as a list right
after it. A source's tab is its calendar, month by
month (`[` `]`, bounded by what it has), each day marked solved (gold),
solved with help (grey), started (a pie of how far) or new, with the day's
puzzle beside it. Enter plays, ⌫ goes back.

**Stats** (⌘S), per source (a tab each, the one being played lit): solved,
best and average time (and the last ten), the streak and the best one, a
chart of the recent clean times with the average, and the history. The
streak counts the source's daily puzzles solved without a reveal on their
own day, on the source's calendar; it reads from yesterday until today's
is solved.

**Now.** While today's puzzle of the `source` setting is unsolved, a quiet
row in the root's Now section opens it (only once you have solved a
puzzle, so it never nags someone who does not play; never for Sabah, an
archive; `suggest` turns it off).

## The page's arrangements

The page picks whichever arrangement gives the squares the most room:

- **side**: the grid on the left, the title, clock, clue bar and both lists
  on the right (a mini, an 8 or 9 square kare bulmaca);
- **top**: the clue bar across the top beside the clock, the grid under it,
  the title and one column of lists beside the grid (a wide grid such as
  Cumhuriyet's 17 by 11 at 720);
- **top without lists**: when there is no room beside the grid either
  (Cumhuriyet's in the compact panel), the title and the hint under the
  grid, and ⌘L lays every clue over it.

A small square gives its number the top-left corner and a smaller letter
set lower, so the two never touch.

## Files

- `game.ts`: the rules, pure: numbering, the keys, check, reveal, clear,
  the finish, the saved form, the Turkish letters.
- `ipuz.ts`: ipuz to a puzzle. `stats.ts`: bests, averages, streaks, per
  source.
- `sources.ts`: the sources, today's puzzle, Next. `crosshare.ts` and
  `turkish.ts`: each site's pages. `cache.ts`: the requests and the disk.
- `store.ts`: `progress.json` (every solve as it stands, the log of
  solves, each puzzle's name for the lists), written whole and atomically,
  a burst of saves coalesced into one write. `PAL_CROSSWORD_DIR` moves it;
  `PAL_CROSSWORD_URL`, `PAL_CROSSWORD_HT_URL`, `PAL_CROSSWORD_CUM_URL` and
  `PAL_CROSSWORD_SABAH_URL` point at stand-in sites (tests).
- `surface/`: the page (`main.ts` the solve and the keys, `screens.ts`
  Browse, Stats and the offline page).

## Settings

```toml
[extensions.crossword]
source = "crosshare"   # what the first open and the Now row offer: haberturk, cumhuriyet, sabah
autocheck = false      # mark a wrong letter as it is typed; also on ⌘K
suggest = true         # today's puzzle in the root's Now section while unsolved
```
