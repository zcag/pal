# Minesweeper

The mine-clearing game in the panel, by mouse or with one hand on the
keys. Enter on the palette's row (or its hotkey) opens the board as a
view level whose body is the extension's own page (`surface/`, a
`surface` view node): the search input gives way to the game's line ("7
mines left", "Cleared in 1:11"), `cmd+k` lists the moves.

The page imports the rules from `game.ts`, the same file the host tests
play, so it draws and takes input but never decides a rule. The state is
written whole to the extension's storage after every move (a cursor move
a beat later, so a held arrow is not a write per repeat).

- **Opening**: Enter or a click opens the cell. The first open is always
  safe: the mines are laid after it, never on it or around it, so it
  opens an area. A cell with no mine around it opens its neighbours in
  turn. On an open number whose flags are all placed, Enter or a click
  opens the cells around it (the chord; the hint line says "open
  around"); both buttons at once or the middle button do the same, as in
  the original. A wrong flag sets off the mine it left.
- **Flagging**: `/`, `F` or Space, or a right-click, flags or unflags a
  closed cell. The counter is the mines less the flags, and goes below
  zero when there are too many.
- **Holding a button** shows the cells it would open pressed flat, and
  the face says "oh", as in the original; the move happens where the
  button is let go.
- **The end**: the game is won when every safe cell is open (the mines
  left are flagged for you) and lost on the first mine opened, which
  goes off red among every other mine; a wrong flag is crossed out.
  Enter or a click on the face then starts a new game. `N` does at any
  time, asking first mid-game (Enter says yes, any other key keeps
  playing).
- **The level**: `D` (or Tab) opens the picker in the corner, left and
  right choose, Enter takes it; a click on a level does the same. Mid-game
  it asks first. The choice is written to the difficulty setting (the
  page sends it to the extension, which calls `settings.set`), so the
  settings page shows it too.
- **One-handed**: the arrows, Enter and `/` (just above the arrows on most
  laptops) play a whole game; the hint line under the board shows every
  key.
- Escape leaves at any point; the board is as you left it next time,
  across restarts too.

The bar has the level picker, the LED mine counter, the face (a new game
on click), the LED clock, and the best time and won count of the level.

**The clock** starts on the first open and stops when the game ends. It
counts only while the board is on screen: the page pauses it when the
view leaves (Escape, the panel hidden, another level on top) and resumes
it when it is back, so time away is never counted. A run the panel never
ended (pal quit or crashed with the board up) is cut off at the last
move. T (or `clock = false`) hides it for anyone a ticking time rushes;
it still counts, for the best time and the "Cleared in" line.

**The look** is the classic board redrawn: square cells, a closed one
raised by a light top-left and a dark bottom-right bevel, an open one
flat on a hairline grid, the numbers in the classic colours (1 blue, 2
green, 3 red, 4 navy, 5 maroon, 6 teal, 7 black, 8 grey; on the dark
theme lighter, 4 violet and 7 white so they read). An open lifts the
caps ring by ring out from the cell opened; a flag plants with a bounce
and pulls out when taken back; a mine goes off with a blast and a shake,
then the rest pop out from it; a cleared board plants its flags from the
last open under confetti and the face puts on its sunglasses. The cells
scale to the page (44 px at most): beginner and intermediate fill the
height, the 30 by 16 expert board is 17 px in the 560 px compact panel.

## Keyboard

| keys | action | when |
| --- | --- | --- |
| `up` `down` `left` `right`, `k` `j` `h` `l` | Move the cursor | playing |
| `enter` | Open; on a number whose flags are placed, open around it | playing |
| `enter` | New game | won or lost |
| `/`, `f`, `space` | Flag or unflag | playing, a closed cell |
| `n` | New game; asks first mid-game | any time |
| `d`, `tab` | The level picker: `left` `right` choose, `enter` takes it | any time |
| `t` | Hide or show the clock (the `clock` setting) | any time |
| `cmd+k` | Open, Flag, New game, Difficulty, the clock | |
| `escape` | Leave the board; the game and its clock wait | |

## Mouse

| | |
| --- | --- |
| click | Open where the button is let go; on a satisfied number, open around it |
| right-click | Flag or unflag, on the press |
| both buttons, middle button | Open around a satisfied number |
| the face | New game |
| a level | Switch to it (asking first mid-game) |

## Setup

Nothing to install and no permission. The game state lives in the
extension's storage (`<data dir>/pal/storage/minesweeper.json`), shared
by every config profile.

Settings, `[extensions.minesweeper]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `difficulty` | `beginner`, `intermediate`, `expert` | `beginner` | 9 by 9 with 10 mines, 16 by 16 with 40, 30 by 16 with 99. |

A change applies at once to a board with nothing open yet or a finished
one, else to the next board; a game in progress plays out first. The
page's level picker writes the same setting. The best times and the won
counts are kept per level.

## What it does not do

- Question marks, custom board sizes, or no-guess boards (a board may
  still need a guess, as in the classic game).
- Sound.

## Platforms

macOS and Linux, the same on both: everything is in-process.
