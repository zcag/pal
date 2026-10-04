# Games

Every game in one list. Enter on the Games row opens it: one row per
game with its tile and tagline, sorted by name, the installed ones first,
and Enter on a row opens that game (Escape comes back to the list).

The list is not kept here: every open reads the installed extensions'
manifests and takes each view palette of an extension the store shelves
under Fun, then adds every game the registries list for this machine
(`extensions.available()`: Fun, a view palette, this platform, a build
that runs here) that is not installed, under a **Not installed** heading
(the installed ones then sit under **Installed**).

Enter on a game not installed installs it from its registry, waits for it
to load, and opens it; its row says **Installing…** meanwhile. An install
that fails stays at the top of the list as a row saying why, until the
next try.

## Leaderboards

An installed game that has leaderboards has a second action on its row,
**Leaderboards** (`cmd+l`); the root's Leaderboards row opens the same
view on the game looked at last, and `g` walks the others.

- A tab per board the game has (`left`, `right`, or a digit). A board
  per puzzle (each Wordle, each sudoku daily, each dated crossword) gets
  a tab for each of its newest puzzles that has scores, as pal's server
  lists them; a board that stays the same (a best score, a fastest time)
  has the period instead: all time, this week or today (`p`).
- Rows: the rank, the name, the score. A player without an account shows
  under a made-up name with an **anonymous** tag; **Hide anonymous**
  (`a`, or the switch) leaves them out and is remembered. Your own row is
  ringed and tagged **you**, and drawn under the top when you are not in
  it.
- Signed out, a last row offers to sign in (`s`), so your scores are kept
  with your account.
- Boards come from pal's server: the view draws at once, says Loading,
  and fills in when the board arrives; a board read in the last minute is
  shown at once. `cmd+r` reads them again.

## Keyboard

| keys | action |
| --- | --- |
| `enter` | Play the game (installing it first when it is not installed) |
| `cmd+l` | The game's leaderboards |
| `escape` | Back to the root |

## Setup

No settings. Hide anonymous is kept in the extension's storage, and
follows a pal account to every machine (`sync`).

## Platforms

macOS and Linux, the same on both; a game a registry marks for one
platform is offered only there.
