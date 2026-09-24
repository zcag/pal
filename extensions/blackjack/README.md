# Blackjack

A hand of blackjack on a felt table in the panel. Enter on the palette's
row (or its hotkey) opens the table as a view level whose tree is one
`surface`: the extension's own page (`surface/`), with the Kenney deck
from the kit (`/__pal/cards/`), chips drawn in CSS, a shoe in the corner
and a rail of buttons under the felt. The title line shows the phase
("Place your bet", "Your turn", "Dealer busts"), the footer the primary
move, and `cmd+k` lists every legal move with its key.

- **Betting**: `↑` and `↓` (or `+` and `-`, or a click on the chips) move
  the bet by the minimum; Enter deals. The cards leave the shoe in the
  order a dealer deals them: you, the dealer, you, then the hole card
  face down.
- **Playing**: `↑` or `H` hit, `↓` or `S` stand, `→` or `D` double down
  (first two cards, one card then stand), `←` or `P` split (a pair, once;
  split aces take one card each; the pair slides apart into two hands).
  Enter hits too. Each hand's total is on a badge over it (`Soft 17`);
  on stand the hole card turns over and the dealer draws to 17.
- **Settled**: the result and the net for the hand. A win glows and its
  winnings come in from the dealer's tray beside the bet, a loss's chips
  go to the dealer, a bust shakes, a blackjack gets a gold flourish; the
  bankroll counts to its new value. Enter for the next hand.
- **New game**: `N` or the button in the felt's corner, after a confirm
  (Enter starts over, any other key keeps playing): a fresh bankroll and
  record.
- **Mouse**: every legal move is a button on the rail with its keys on
  it; the first one is Enter's.
- Escape leaves at any point; the page saves the state whole in the
  extension's storage after every move, so the table is as you left it
  next time, across restarts too.

The rail has the bankroll and the record (hands, share won, the net); the
bar on the shoe says how much of it is left.

Rules: dealer stands on 17 (soft 17 too unless `dealer_hits_soft_17`),
blackjack pays 3:2, a dealer blackjack is checked at once, doubling after
a split is allowed, no surrender. The shoe is `decks` decks and is
reshuffled before a deal once under a quarter of it is left. Insurance is
offered on an ace only with `insurance = true`, costs half the bet and
pays 2:1; `↑` or `I` takes it, `↓` or Enter plays on. Out of chips (a
bankroll under the minimum bet) leaves only New game.

## How it is built

- `game.ts`: the rules, pure (a state and a move in, a state out); the
  host tests it, and the page plays with it, so the two cannot disagree.
- `moves.ts`: the moves as the table offers them (titles, keys, the key a
  move answers to by phase), the title line, money and chip stacks; used
  by both sides.
- `index.ts`: the view palette. `view` answers the surface with the legal
  moves as the view's actions and the phase as its title; the page sends
  `{ moved: true }` after each save and the extension pushes the new
  actions and title with `view.update`. A move picked from `cmd+k` goes
  to the page (`pal.onAction`).
- `surface/`: the page. `main.ts` holds the state, the keys and the save;
  `table.ts` draws it: cards and chips are sprites keyed by what they are
  (the hole card, hand 2's second card), moved by transform transitions,
  so a deal, a hit, a split, a settle and the sweep before the next hand
  are one diff. It is browser code: the host's type check leaves
  `surface/` out and `host/tsconfig.surface.json` checks it with the DOM
  types.

## Keyboard

Only the moves legal in the phase are offered; the footer names the
primary one and `cmd+k` lists the rest.

| keys | action | when |
| --- | --- | --- |
| `enter` | Deal; Hit; Next hand once settled; No insurance when asked | every phase |
| `up`/`+`, `down`/`-` | Raise or lower the bet by the minimum | betting |
| `up`, `h` | Hit | playing |
| `down`, `s` | Stand | playing |
| `right`, `d` | Double down | the first two cards of a hand |
| `left`, `p` | Split | a pair, once per hand |
| `up`, `i` | Take insurance | the dealer shows an ace and `insurance` is on |
| `down` | No insurance | insurance |
| `n` | New game: a fresh bankroll and record; asks first | any phase |
| `cmd+k` | Every legal move with its key | |
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
| `min_bet` | number | `10` | The smallest bet, and the step the bet moves by. |
| `dealer_hits_soft_17` | bool | `false` | The dealer draws on a soft 17 (H17) instead of standing (S17). |
| `insurance` | bool | `false` | Ask about insurance when the dealer shows an ace. |

A settings change applies to the next deal; the bankroll and the record
are kept.

## What it does not do

- Surrender, re-splitting (a pair splits once), or hitting split aces.
- Card counting aids: the shoe's bar says how much is left, nothing more.
- More than one player, or a bet above the bankroll (the bet is capped by
  what you have).
- Sound.

## Platforms

macOS and Linux, the same on both: the page runs in the panel's webview
and the cards come with the app.

The cards are Kenney's Boardgame pack (CC0, kenney.nl), served by the app
as its kit.
