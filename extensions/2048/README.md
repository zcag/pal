# 2048

The sliding-tile game in the panel, keyboard only. Enter on the palette's
row (or its hotkey) opens the board as a view level: the search input
gives way to the score, the footer shows the primary key, and `cmd+k`
lists every move with its key. The board is a render tree the extension
builds from a pure game state (`game.ts`, `render.ts`); every key is a
pick whose action is the move, and the reply is the next tree, so a tile
that slid fades into its new cell, a merge flips, and the spawned tile
lands a beat after the rest.

- **Moving**: the arrows or `hjkl` slide every tile that way. Equal
  neighbours merge once per move (`4 4 8` moved left is `8 8`, never
  `16`), the merged value is added to the score, and a 2 (nine times in
  ten) or a 4 lands on a free cell. A move that changes nothing is not a
  move: nothing spawns, nothing is counted.
- **Undo**: `u` takes the last move back, one move, when the `undo`
  setting is on. It works after game over too.
- **2048**: the first 2048 tile shows a banner; Enter keeps going for a
  higher tile, `n` starts over. Game over (no move can change the board)
  shows the score, Enter for a new game.
- **New game**: `n`, asking first mid-game. The best score is kept.
- Escape leaves at any point; the board, the score, the move count and
  the best score persist in the extension's storage after every move, so
  the game is as you left it next time, across restarts too.

The header has the score, the best score across games and the move count;
the score is the title while playing.

Tiles are the view vocabulary's `tile` nodes on a sunken well, drawn by
the app with its own tokens, so the board follows the theme: paper for 2,
the neutral tint for 4, then solid tiles walking the tag palette's hues
warm to cool (amber, red, pink, violet, blue, teal, green) for 8 to 512,
the grey chip at 1024, the accent at 2048.
A tile that slid glides from its old cell to its new one, a merged tile
pops in place as the slide lands, the spawned one pops a beat later. The
vocabulary is in the extensions guide.

## Keyboard

| keys | action | when |
| --- | --- | --- |
| `up`, `down`, `left`, `right`, or `k`, `j`, `h`, `l` | Slide the tiles | playing |
| `u` | Undo the last move (with `undo` on) | after a move, game over too |
| `n` | New game; asks first mid-game | any |
| `enter` | Keep going after the first 2048; New game at game over | won, over |
| `cmd+k` | Every move with its key | |
| `escape` | Leave the board; the game waits | |

While playing, Enter is New game with the question first, so a stray
Enter loses nothing.

## Setup

Nothing to install and no permission. The game state lives in the
extension's storage (`<data dir>/pal/storage/2048.json`), shared by every
config profile; New game clears the board and keeps the best score.

Settings, `[extensions.2048]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `undo` | bool | `true` | `u` takes the last move back (one move). |

## What it does not do

- More than one move of undo, or a move history.
- Board sizes other than four by four, or a different target.
- Mouse or swipe play: the board is keyboard only, as the whole panel is.

## Platforms

macOS and Linux, the same on both: everything is in-process and the tiles
are the app's own.
