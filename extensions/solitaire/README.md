# Solitaire

Klondike in the panel, played one-handed on the arrows and Enter. Enter
on the palette's row (or its hotkey) opens the table as a view level: the
search input gives way to a line that says what the cursor is on
(`Pile 4 · 9♣ 8♥`), what you carry (`Moving 7♥ and 2 more`) or why a
drop was refused (`7♥ can't go on 9♠`), the footer shows what Enter does
here, and `cmd+k` lists every key. The table is a render tree the
extension builds from a pure game state (`game.ts`, `render.ts`); every
key is a pick whose action is the move, and the reply is the next tree.

- **The cursor**: `←` and `→` walk the stock, the waste, the four
  foundations and the seven piles, wrapping round. On a pile, `↑` takes
  one more card of its face-up run and `↓` one fewer (the ring shows what
  Enter would pick up); `↑` past the run goes to the row above, `↓` from
  the top row to the pile under it.
- **Moving cards**: Enter picks up what the ring holds, and the cards
  ride under the cursor as it moves; Enter again drops them there. An
  illegal drop puts them back with a line saying why. Enter a second
  time on the pile they came from sends them where they go: a card to its
  foundation, else to the first pile that takes it. Dropped on any
  foundation, a card goes to its own suit's, and `↑` from a pile with one
  card in hand jumps straight to it.
- **The stock**: Enter on it (or `space` anywhere) turns one card, or
  three with `draw = "3"`, onto the waste; once it is out, it turns the
  waste back over, as often as you like.
- **Undo**: `u` or `Backspace` takes the last move back (a hundred deep),
  a turned-over card included; while you hold cards, it puts them down.
- **The finish**: once the stock and the waste are played out and every
  tableau card is face up, the rest flies home by itself, one card at a
  time (Enter finishes at once). A win shows the moves and the time;
  Enter deals again. `N` deals a new game at any point, asking first
  mid-game (the game counts as lost).
- Escape leaves at any point; the game persists in the extension's
  storage after every move, so the table is as you left it next time,
  across restarts too.

Beside the table: the moves, the time played (counted only while the
table is open: time away from it is not), games won of played, a bar for
the cards home, the draw, and the keys.

Rules: Klondike as dealt by hand, seven piles of one to seven cards with
the last face up, the 24 left the stock. A pile builds down by one in
alternating colours, an empty pile takes only a king, any face-up run
moves as one; the foundations build up by suit from the ace, and a card
comes back off one onto a pile. A pile's newly exposed card turns over by
itself. No scoring, and unlimited passes through the stock in both draws.

Motion rides the view's keyed transitions: every face-up card keeps its
key while it is in play, so a drop, an undo, a carried run following the
cursor and the finish's cards going home all glide from one pile to the
other (`move`); a card turned over flips in, the deal drops in column by
column. The cards are blackjack's (`../blackjack/cards.ts`, drawn by the
extension as SVG); a covered card is a strip cropped from the same
picture, its index on one line (`10♥`) so the strip names it, and a long
run tightens its strips to stay in the panel.

## Keyboard

Only the keys legal now are offered; the footer names what Enter does
and `cmd+k` lists the rest.

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
| `cmd+k` | Every key | |
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
- Mouse play: the table is keyboard only, as the whole panel is.

## Platforms

macOS and Linux, the same on both: everything is in-process and the
cards are drawn by the extension.
