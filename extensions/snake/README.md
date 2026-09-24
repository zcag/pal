# Snake II

Snake II as the Nokia 3310 plays it, on the phone's own screen. Enter on
the palette's row (or its hotkey) opens it as a view level whose body is
the extension's own page (`surface/`, a `surface` view node): the 84 by 48
pixels of the 3310's LCD, drawn pixel for pixel, with the phone's menus,
fonts, sprites, mazes, rules, delays and buzzer.

Nothing here is a remake from memory. Every screen, sprite, maze, rule,
delay and tone was read off the real 3310 firmware (version 6.07) running
in a DCT3 emulator, and the host tests replay 123 runs recorded from that
firmware through this extension, comparing every frame, every tone and
every backlight switch (see "How it was measured").

## Playing

Opening the view enters Snake II as picking it from the phone's Games menu
does: the SNAKE II splash, then its menu (New game, Level, Mazes, Top
score, Instructions). The screen is lit green in the menus and unlit in
play, as the phone keeps its backlight.

- **Steering**: 2 4 6 8 (the arrows while playing) turn up, left, right
  and down. 1 3 7 9 turn across the way the snake goes (moving right, 1
  and 3 turn up, 7 and 9 down); `*` and `#` turn left and right, as do
  the phone's scroll keys (Page Up and Page Down here). A key back the
  way the snake came is dropped; only the last key before a step counts,
  one turn per step, and a key in the direction the snake already goes
  cancels a waiting turn. 5 and 0 do nothing.
- **Levels**: 1 to 9, a step every 656 ms at level 1 down to 88 ms at
  level 9 (82, 60, 47, 37, 28, 22, 17, 13, 11 units of 8 ms). Food is
  worth the level.
- **Mazes**: No maze (the snake wraps at every edge) and Mazes 1 to 5,
  each with its own start; the snake wraps wherever a maze leaves an edge
  open.
- **Growing**: the head enters the food on one step, the tail holds on the
  next, and the swallowed food rides down the body as a bulge until the
  tail passes it.
- **Bonus creatures**: after every fifth food eaten while none is on
  screen, one of six creatures comes for 20 steps, its countdown and icon
  at the top right; eaten, it is worth 5 x level + 5 + 2 x the countdown
  and the snake does not grow.
- **The split-second before a crash**: a step into a wall or the body does
  not happen; the phone tries again about 100 ms later with whatever turn
  was pressed meanwhile, so a late turn still saves the snake. Reversing
  the blocked turn in that moment does not.
- **Game over**: the snake blinks off and on, then "Game over!" with the
  score; a new top score gets fireworks and the jingle, and "TOP SCORE:".
- **Pausing**: C or Menu in play opens the menu with Continue first;
  Continue shows the game still, and the next key goes on. Escape (leaving
  the view) and the panel hiding pause the same way, and Continue is there
  when you come back, across restarts. A new level or any maze chosen from
  that menu ends the paused game, as on the phone.
- **Leaving**: C on the Snake II menu leaves the game (the phone goes back
  to its Games list), and so does a digit, `*` or `#` on any of its
  screens: on the phone that starts dialling. Both close the view.

The phone's random numbers are its own: rand() starts from 1 at a
power-on and is never reseeded, so the first food after a power-on is
always at column 3, row 6, and the food and creatures after it follow the
phone's sequence. A power-on here is pal starting: the first time the page
asks the extension (the extension host keeps the flag). The numbers carry
on across games and across opening and closing the view, as the phone's
do between power-ons.

## Keyboard

| keys | the phone's key | when |
| --- | --- | --- |
| `up` `down` `left` `right` | 2 8 4 6 | playing (and after Continue) |
| `up` `down` | the scroll keys | in a menu, the Level bars, Instructions |
| `enter` | the left soft key: Menu, Select, OK, More | any time |
| `backspace` | C | any time |
| `pageup` `pagedown` | the scroll keys | any time (in play they turn left and right) |
| `1`...`9`, `0`, `*`, `#` (digit row or numpad) | the keypad | any time |
| `cmd+t` | | game tones on or off |
| `escape` | | pause and leave the view |

The browser's own key repeat is ignored; a held scroll key repeats as the
phone's does (the first repeat after 0.8 s, then every half second).

## Setup

Nothing to install and no permission. The phone's memory (the level, the
maze, the top score, a paused game, rand()'s state) is in the extension's
storage (`<data dir>/pal/storage/snake.json`).

Settings, `[extensions.snake]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `tones` | boolean | `true` | The buzzer: the click on eating, three pips on a crash, the jingle on a new top score (the phone's "Warning and game tones"). |

## How it was measured

The reference is the 3310's firmware v6.07 (MAME romset `noki3310`) in
[djr-747/nokia-dct3-emulator](https://github.com/djr-747/nokia-dct3-emulator),
driven key by key with every LCD change and buzzer register write logged
with its emulated time. From it:

- **The pictures**: the in-game sprites are the firmware's 4 by 4 cell
  patterns (`lcd.ts`); everything else (menu labels, the path's small
  font, soft keys, the Level screen, the notes and their tick, the Top
  score screen and its coin cup, the instructions, the game over texts
  and their large digits, the splash, the fireworks) is cut out of the
  firmware's own frames (`bitmaps.ts`, generated) and composed as the
  phone composes it.
- **The rules and delays**: `game.ts` (the snake) and `phone.ts` (its
  screens), in the firmware's game unit (8 ms on a real phone, from
  footage of real 3310s; 7.745 ms in the emulator). The disassembly gave
  rand() (`seed * 0x625F + 0x3623 mod 0xFFF1`), the food's and the
  creature's placement, and the creature table (`rand() % 6`).
- **The proof**: `host/test/extensions/snake-emulator.fixture.json` holds
  123 recorded runs (menus and their keys, every level and maze played to
  the end, bonus creatures eaten and missed, the collision grace at levels
  1 and 9, pauses and Continue, deaths with and without a top score, keys
  during each, held keys). `snake.test.ts` replays each run's keys through
  this extension and requires every frame to be identical, pixel for
  pixel, in order, with the buzzer's tones and the backlight's switches in
  the same order and time.

What no recording can settle is marked in the code and left as the best
reading:

- The LCD's colours (from a photo of a 3310, unlit and lit by its
  backlight) and the buzzer's loudness (the volume register read as steps
  of loudness).
- The re-check after a blocked step comes about 12.3 units (98 ms) after
  it in this model, the keypad scan is 2.3 units (18 ms): those two fit
  every run recorded at levels 1 and 9, where the emulator's own clock
  jitters by about one unit.
- A power-on is pal starting.
- A 2 by 2 bonus creature the firmware can draw but was never seen (its
  trigger is unknown) is not drawn.
- Keys the recordings do not cover act as their nearest recorded kind: C
  on a still game after Continue carries on like any other key, and a
  held scroll key does not repeat in play.

## Platforms

macOS and Linux, the same on both: everything is in-process.
