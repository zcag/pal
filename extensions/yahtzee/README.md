# Yahtzee

Solo Yahtzee in the panel. Enter on the palette's row (or its hotkey)
opens the game as a view level whose tree is one `surface`: the
extension's own page (`surface/`), with five dice on a tray and Roll
beside them, the scorecard under them in two columns (upper, lower) and
the total at the bottom. Everything fits the body at once, compact
included. The title line says where you are ("Round 4 · Roll 2 of 3",
"Round 4 · Choose a category", "Final score 247"), the footer the
primary move, and `cmd+k` lists Roll and every category the dice may go
in, the one that adds most first.

- **Rolling**: the first roll of a round throws all five dice; up to two
  more throw the dice you did not hold. Held dice sit in a ring of the
  accent with "Held" under them and stay still while the rest tumble.
- **Choosing**: every open category shows what it would score with the
  dice as they lie (in the accent; a 0 greyed). Picking a row (hover, or
  the keys) rings the dice it counts, shows on the total what it would
  add (`+25`, the bonuses included) and, for an upper box, its share of
  the bar to 63 in a lighter shade. Scoring drops the value into its row
  and the total counts up to it.
- **Yahtzee**: the dice jump, a banner and confetti; a further one says
  `+100` and where the Joker rules let it go.
- **Game over**: after the thirteenth round the tray gives way to the
  final score, the best and the average; a new best gets its badge and
  confetti. Enter or `N` starts the next game.
- **New game** mid-game: `N` asks first (Enter starts over, any other key
  keeps playing). The record is kept.
- Escape leaves at any point; the page saves the game whole in the
  extension's storage after every move, so it is as you left it next
  time, across restarts too.

Rules (Hasbro's): 13 rounds, 3 rolls a round, one category filled a
round, a 0 when the dice do not fit. Ones to Sixes count their face; 3
and 4 of a kind the sum of all five dice; full house 25; small straight
(four in a run) 30; large straight (five) 40; Yahtzee 50; chance the sum.
63 or more in the upper section pays 35. A further Yahtzee pays 100 while
the Yahtzee box holds 50 (none if it holds 0), and either way it is a
Joker: it must go in its number's upper box if that is open; else any
open lower box, where a full house and the straights score in full; else
an upper box, for 0.

## How it is built

- `game.ts`: the rules, pure (a state and a move in, a state out, the
  dice from an injected `rng`); the host tests it, and the page plays
  with it, so the two cannot disagree. `options` is what the dice may
  score where, Joker included; `gain` what a category adds to the total.
- `moves.ts`: the view's actions and the title line, used by both sides.
- `index.ts`: the view palette. `view` answers the surface with the
  actions and the title for the stored game; the page sends
  `{ moved: true }` after each save and the extension pushes them again
  with `view.update`. An action picked from `cmd+k` goes to the page
  (`pal.onAction`).
- `surface/`: the page. `main.ts` holds the state, the cursor, the keys
  and the save; `board.ts` draws it: the elements are made once and only
  their classes and text change, and every animation is a transform
  (WAAPI) or a class. The dice and their pips are CSS. It is browser
  code: the host's type check leaves `surface/` out and
  `host/tsconfig.surface.json` checks it with the DOM types.

## Keyboard

One hand on the arrows: the cursor is on the dice or on the card. The
footer of the page shows the keys that do something at that moment.

| keys | action | when |
| --- | --- | --- |
| `space`, `r` | Roll | a roll is left |
| `←`, `→` | The previous or next die | on the dice |
| `enter` | Hold or release the die; the first roll of a round | on the dice |
| `1` to `5` | Hold or release that die | after a roll |
| `↑` | Roll | on the dice |
| `↓` | Onto the card, on the category that adds most | on the dice, after a roll |
| `↑`, `↓` | The open category above or below; past the top, back to the dice | on the card |
| `←`, `→` | The other column, the open row nearest | on the card |
| `enter` | Score the category | on the card |
| `n` | New game; asks mid-game | any time; `enter` too once over |
| `cmd+k` | Roll, the categories ranked by what they add, New game | |
| `escape` | Leave; the game waits | |

After the third roll (or a Joker with one place to go) the cursor is on
the card by itself.

## Mouse

| where | does |
| --- | --- |
| a die | Hold or release it |
| Roll | Roll |
| a category's row | Score it; hovering it rings the dice it counts and shows what it adds |
| New game (game over) | Start the next game |

## Setup

Nothing to install, no permission and no settings. The game lives in the
extension's storage (`<data dir>/pal/storage/yahtzee.json`), with the
record: games finished, the best score and the average.

## What it does not do

- More than one player, or the triple Yahtzee variant.
- Undo: a score is final, as on paper.
- Sound.

## Platforms

macOS and Linux, the same on both: the page runs in the panel's webview.
