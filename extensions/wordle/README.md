# Wordle

The five-letter word game in the panel, keyboard only. Enter on the
palette's row (or its hotkey) opens the board as a view level: the search
input gives way to the puzzle's name ("Daily #259", "Practice"), the
footer shows the primary key, and `cmd+k` lists the moves with their
keys (the letters route but are not listed). The board is a render tree
the extension builds from a pure game state (`game.ts`, `render.ts`);
every key is a pick whose action is the letter or the move, and the reply
is the next tree, so a typed letter pops in and a submitted row flips
tile by tile. The tiles and the keyboard are the view vocabulary's `tile`
nodes drawn by the app with its tokens, so the board follows the theme.

- **Typing**: the letter keys fill the current row, Backspace takes one
  back, Enter submits. A guess must be five letters
  and in the word list; otherwise a red badge says so over the board and
  the row stays for editing.
- **Marks**: a letter in its place turns green, a letter elsewhere in the
  answer amber, the rest grey. A letter the guess repeats is amber only as
  often as the answer has it beyond the greens, as in the original. The
  on-screen keyboard keeps the best mark each letter has earned.
- **Daily**: with `daily` on (the default) there is one puzzle a day,
  seeded from the local date and the same on every machine; opening the
  palette on a new day starts it. Once it is solved or lost, `n` starts a
  practice game on a random word; the next day's puzzle waits until you
  open the palette again. With `daily` off every game is a practice game
  and `cmd+n` starts another at any time (a bare `n` types the letter
  mid-game).
- **Hard mode** (`hard_mode`): a guess must keep every green letter in
  place and use every amber one, else the badge names the slip ("2nd
  letter must be R", "Guess must contain E"). A game keeps the mode it
  started with; the badge in the header says `hard`.
- **Result**: the praise ("Splendid! 4/6") or the answer, the stats
  (played, win %, streak, best) and the guess distribution as bars. `c`
  (or Enter) copies the result for sharing:

  ```text
  pal wordle #259 4/6

  ⬜⬜🟩⬜🟩
  ⬜🟩🟩🟨🟩
  ⬜🟩🟩🟨🟩
  🟩🟩🟩🟩🟩
  ```

- Escape leaves at any point; the game and the stats persist in the
  extension's storage, so the board is as you left it next time, across
  restarts too.

Stats count every finished game. The streak is wins in a row; a daily
after a skipped day starts it over. Six guesses, five letters, like the
original.

## Keyboard

| keys | action | when |
| --- | --- | --- |
| `a` to `z` | Type a letter | playing |
| `backspace` | Delete a letter | playing |
| `enter` | Submit the guess | playing |
| `c` | Copy the result (Enter too) | over |
| `n` | New game: today's puzzle if unplayed, else a practice word | over |
| `cmd+n` | New game mid-game | a practice game, or `daily` off |
| `cmd+k` | The moves with their keys | |
| `escape` | Leave the board; the game waits | |

## Word lists

Two text files ship with the extension, one word per line, built by
`build.ts` from public domain sources (nothing is fetched at runtime):

- `answers.txt` (2551 words, 15 KB): the five-letter words of the
  American `3esl` and `6of12` lists of **12dicts** 6.0.2 by Alan Beale
  (released to the public domain, <http://wordlist.aspell.net/12dicts/>),
  plurals and third-person forms dropped, a short block list of slurs
  removed. The daily walks them in a fixed stride, so the order of the
  file must not change once shipped.
- `allowed.txt` (8878 words, 53 KB): every five-letter word of the public
  domain 12dicts lists (`3esl`, `2of12`, `6of12`, `3of6game`, `3of6all`,
  `2of4brif`, `5d+2a`) and of **ENABLE** (the Enhanced North American
  Benchmark Lexicon, public domain), the answers included.

`bun run extensions/wordle/build.ts <12dicts dir> <enable1.txt>` rebuilds
both.

## Setup

Nothing to install and no permission. The game and the stats live in the
extension's storage (`<data dir>/pal/storage/wordle.json`), shared by every
config profile.

Settings, `[extensions.wordle]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `daily` | bool | `true` | One puzzle a day from the date; off, every game is a random word. |
| `hard_mode` | bool | `false` | Greens stay in place, ambers must be used. Applies from the next game. |

## What it does not do

- Catch up on missed days: the daily is the day you open the palette on.
- Share to anything but the clipboard, or fetch the original's word of
  the day (the lists are its own, so the answers differ from the
  original's).
- Mouse play: the board is keyboard only, as the whole panel is.

## Platforms

macOS and Linux, the same on both: everything is in-process and the tiles
are the app's own.
