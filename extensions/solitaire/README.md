# Solitaire

Klondike in the panel, by mouse or with one hand on the keys. Enter on
the palette's row (or its hotkey) opens the table as a view level whose
body is the extension's own page (`surface/`, a `surface` view node): a
felt with the Kenney cards (the kit's `/__pal/cards/`) as large as the
panel allows, the status beside it. The search input gives way to a line
that says what the cursor is on (`Pile 4 · 9♣ 8♥`), what you carry
(`Moving 7♥ and 2 more`) or why a move was refused (`7♥ can't go on
9♠`); `cmd+k` lists draw, undo, finish and new game.

The page imports the rules from `game.ts`, the same file the host tests
play, so it draws and takes input but never decides a rule; where the
cards go is `surface/layout.ts`, pure too. The state is written whole to
the extension's storage (`state`) after every change, so Escape mid-game
loses nothing.

- **The mouse**: drag a face-up card, and the cards under it come along;
  the piles it can go on light up, the one under it brightest, and a drop
  anywhere else glides the cards back (with the reason on the title
  line). Or click the cards (they lift and their piles light up) and then
  the pile they go on; a second click on the same cards, so a
  double-click, sends them where they go. A click on the stock draws.
  Cards that can move lift under the pointer.
- **The cursor**: `←` and `→` walk the stock, the waste, the four
  foundations and the seven piles, wrapping round. On a pile, `↑` takes
  one more card of its face-up run and `↓` one fewer (the ring shows what
  Enter would pick up); `↑` past the run goes to the row above, `↓` from
  the top row to the pile under it. The ring shows while the keys are in
  use and hides for the mouse.
- **Moving cards**: Enter picks up what the ring holds, and the cards
  ride on the pile under the cursor as it moves (while holding, only
  where they can go); Enter again drops them there. An illegal drop puts
  them back with a line saying why. Enter a second time on the pile they
  came from sends them where they go: a card to its foundation, else to
  the first pile that takes it.
- **The stock**: Enter on it (or `space` anywhere) turns one card, or
  three with `draw = "3"` (fanned), onto the waste; once it is out, it
  turns the waste back over, as often as you like.
- **Undo**: `u` or `Backspace` takes the last move back (a hundred deep),
  a turned-over card included; while you hold cards, it puts them down.
- **The finish**: once the stock and the waste are played out and every
  tableau card is face up, the rest flies home by itself, one card at a
  time (Enter finishes at once). A win bounces the cards off the
  foundations, leaving trails; any key or click stops it, and the table
  shows the moves and the time; Enter deals again. `N` deals a new game
  at any point, asking first mid-game (Enter says yes, any other key
  keeps playing; the game counts as lost).

Beside the table: the moves, the time played (counted only while the
table is open), games won of played, a bar for the cards home, the draw,
and the keys.

Rules: Klondike as dealt by hand, seven piles of one to seven cards with
the last face up, the 24 left the stock. A pile builds down by one in
alternating colours, an empty pile takes only a king, any face-up run
moves as one; the foundations build up by suit from the ace, and a card
comes back off one onto a pile. A pile's newly exposed card turns over by
itself. No scoring, and unlimited passes through the stock in both draws.

Motion: each card is one element for the whole game, placed by a
transform, so any change of place (a drop, a snap back, an undo, the
finish) glides; a card turned over flips; a new deal gathers the cards on
the stock and deals them out row by row. The card size follows the view:
the largest that fits seven columns across and the longest column down,
a column fanning loose while it has room and tightening as it grows,
never past the point where a card's rank shows.

## Keyboard

| keys | action | when |
| --- | --- | --- |
| `enter` | Pick up; drop; draw on the stock | playing |
| `enter` twice on one card | Send it where it goes: its foundation, else the first pile that takes it | holding |
| `left`, `right` (`h`, `l`) | Previous or next pile, wrapping; holding, only where the cards can go | playing |
| `up`, `down` (`k`, `j`) | One more or one fewer card of the run; past it, the row above or below | playing |
| `space` (`d`) | Draw, or turn the waste back over | playing |
| `u` (`backspace`) | Undo the last move; put down the cards held | after a move, or holding |
| `enter` | Finish now | the finish |
| `n` | New game; asks first mid-game; Enter too once won | any time |
| `cmd+k` | Draw, undo, finish, new game | |
| `escape` | Leave the table; the game waits | |

## Setup

Nothing to install and no permission. The game state lives in the
extension's storage (`<data dir>/pal/storage/solitaire.json`), shared by
every config profile.

Settings, `[extensions.solitaire]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `draw` | `"1"` or `"3"` | `"1"` | Cards turned from the stock at a time. Applies from the next deal. |

## What it does not do

- Scoring (Vegas or standard), a limit on passes through the stock, or
  a timer that counts while the table is closed.
- Hints or a solver: the finish only plays out a game that is already
  won.

## Platforms

macOS and Linux, the same on both: the page runs in the panel's webview,
the cards are the kit's.
