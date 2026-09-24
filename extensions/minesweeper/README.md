# Minesweeper

The mine-clearing game in the panel, keyboard only. Enter on the
palette's row (or its hotkey) opens the board as a view level: the search
input gives way to the mines left ("7 mines left", "Cleared in 1:11"),
the footer shows the primary key, and `cmd+k` lists every move with its
key. The board is a render tree the extension builds from a pure game
state (`game.ts`, `render.ts`); every key is a pick whose action is the
move, and the reply is the next tree.

- **Moving**: the arrows (or `hjkl`) move the cursor, the ringed cell; it
  stops at the edges.
- **Opening**: Enter opens the cell. The first open is always safe: the
  mines are laid after it, never on it or around it, so it opens an area.
  A cell with no mine around it opens its neighbours in turn. Enter on an
  open number whose flags are all placed opens the cells around it (the
  chord; the footer says "Open around"); a wrong flag sets off the mine
  it left.
- **Flagging**: `F`, `/` or Space flags or unflags a closed cell. The
  counter is the mines less the flags, and goes below zero when there are
  too many.
- **The end**: the game is won when every safe cell is open (the mines
  left are flagged for you) and lost on the first mine opened, which
  shows red among every other mine; a wrong flag is crossed out. Enter
  then starts a new game; `N` does at any time, asking first mid-game.
- **One-handed**: the arrows, Enter and `/` (just above the arrows on most
  laptops) play a whole game; the hint line under the board shows every
  key.
- Escape leaves at any point; the board persists in the extension's
  storage after every move, so it is as you left it next time, across
  restarts too.

The header has the level, the mine counter, the clock, the best time and
how many games of the level were won.

**The clock** starts on the first open and stops when the game ends. It
counts only while the board is on screen: leaving the view (Escape, the
panel hidden, another level on top) pauses it, coming back resumes it, so
time away is never counted. A run the panel never closed (pal quit or
crashed with the board up) is cut off at the last move. While a game runs
on screen the extension pushes the tree once a second so the time moves.

Cells are the view vocabulary's `tile` nodes on a sunken well, drawn by
the app with its tokens: a closed cell is paper, a flag the amber chip,
an open number its classic colour on the tag palette (1 blue, 2 green, 3
red, 4 violet, 5 pink, 6 teal, 7 amber, 8 grey), an empty cell a
hairline. An open pops in, rippling out ring by ring from the cell
opened; a lost game's mines ripple out from the one that went off. The
cells are 30 px on beginner and 17 px on intermediate and expert, so the
30 by 16 expert board fits the panel, the compact one included.

## Keyboard

Only the moves legal in the phase are offered; the footer names the
primary one and `cmd+k` lists the rest.

| keys | action | when |
| --- | --- | --- |
| `up` `down` `left` `right`, `k` `j` `h` `l` | Move the cursor | playing |
| `enter` | Open; on a number whose flags are placed, open around it | playing |
| `enter` | New game | won or lost |
| `f`, `/`, `space` | Flag or unflag | playing, a closed cell |
| `n` | New game; asks first mid-game | any time |
| `cmd+k` | Every move with its key | |
| `escape` | Leave the board; the game and its clock wait | |

## Setup

Nothing to install and no permission. The game state lives in the
extension's storage (`<data dir>/pal/storage/minesweeper.json`), shared
by every config profile.

Settings, `[extensions.minesweeper]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `difficulty` | `beginner`, `intermediate`, `expert` | `beginner` | 9 by 9 with 10 mines, 16 by 16 with 40, 30 by 16 with 99. |

A change applies at once to a board with nothing open yet, else to the
next board; a game in progress plays out first. The best times and the
won counts are kept per level.

## What it does not do

- Question marks, custom board sizes, or no-guess boards (a board may
  still need a guess, as in the classic game).
- Mouse play: the board is keyboard only, as the whole panel is.

## Platforms

macOS and Linux, the same on both: everything is in-process.
