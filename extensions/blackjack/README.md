# Blackjack

A hand of blackjack in the panel, keyboard only. Enter on the palette's
row (or its hotkey) opens the table as a view level: the search input
gives way to the phase ("Place your bet", "Your turn", "Dealer busts"),
the footer shows the primary key, and `cmd+k` lists every move with its
key. The table is a render tree the extension builds from a pure game
state (`game.ts`, `render.ts`); every key is a pick whose action is the
move, and the reply is the next tree, so a hit rises in, the hole card
flips over and a split moves its card across.

- **Betting**: `+` and `-` move the bet by the minimum, Enter deals.
- **Playing**: `H` hit, `S` stand, `D` double down (first two cards, one
  card then stand), `P` split (a pair, once; split aces take one card
  each). Totals show live next to each hand (`Soft 17`); the dealer's
  hole card stays face down until you stand, then flips and the dealer
  draws to 17.
- **Settled**: the result and the net for the hand, Enter for the next
  hand. `N` starts a new game (asks first) with a fresh bankroll and
  record.
- Escape leaves at any point; the hand, the bankroll and the record
  persist in the extension's storage after every move, so the table is
  as you left it next time, across restarts too.

The status line has the bet, the bankroll, the record (hands, wins,
losses, pushes, blackjacks, the net) and a bar for how much of the shoe
is left.

Rules: dealer stands on 17 (soft 17 too unless `dealer_hits_soft_17`),
blackjack pays 3:2, a dealer blackjack is checked at once, doubling after
a split is allowed, no surrender. The shoe is `decks` decks and is
reshuffled before a deal once under a quarter of it is left. Insurance is
offered on an ace only with `insurance = true`, costs half the bet and
pays 2:1; `I` takes it, Enter plays on. Out of chips (a bankroll under
the minimum bet) leaves only New game.

Cards are drawn by the extension as SVG (rank and suit indices, pips laid
out as on a real deck), so nothing is loaded from disk; the view
vocabulary they ride on is in the extensions guide.

## Keyboard

Only the moves legal in the phase are offered; the footer names the
primary one and `cmd+k` lists the rest.

| keys | action | when |
| --- | --- | --- |
| `enter` | Deal; Next hand once settled; No insurance when asked | betting, settled, insurance |
| `+`, `-` | Raise or lower the bet by the minimum | betting |
| `h` | Hit | playing |
| `s` | Stand | playing |
| `d` | Double down | the first two cards of a hand |
| `p` | Split | a pair, once per hand |
| `i` | Take insurance | the dealer shows an ace and `insurance` is on |
| `n` | New game: a fresh bankroll and record; asks first | any phase |
| `cmd+k` | Every move with its key | |
| `escape` | Leave the table; the hand waits | |

## Setup

Nothing to install and no permission. The game state lives in the
extension's storage (`<data dir>/pal/storage/blackjack.json`), shared by
every config profile; New game is the way to clear it.

Settings, `[extensions.blackjack]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `decks` | number, 1 to 8 | `6` | Decks in the shoe; it is reshuffled once a quarter is left. |
| `starting_bankroll` | number | `1000` | Chips a new game starts with. |
| `min_bet` | number | `10` | The smallest bet, and the step `+` and `-` move it by. |
| `dealer_hits_soft_17` | bool | `false` | The dealer draws on a soft 17 (H17) instead of standing (S17). |
| `insurance` | bool | `false` | Ask about insurance when the dealer shows an ace. |

A settings change applies to the next deal; the bankroll and the record
are kept.

## What it does not do

- Surrender, re-splitting (a pair splits once), or hitting split aces.
- Card counting aids: the shoe bar says how much is left, nothing more.
- More than one player, or a bet above the bankroll (the bet is capped by
  what you have).
- Mouse play: the table is keyboard only, as the whole panel is.

## Platforms

macOS and Linux, the same on both: everything is in-process and the
cards are drawn by the extension.
