# Typing

A typing test in the panel, in the manner of monkeytype. Enter on the
palette's row (or its hotkey) opens it as a view level whose tree is one
`surface`, the extension's own page (`surface/`): the options on a bar
at the top, three lines of words in the middle, the keys that do
something at the bottom. The title line names the test ("Typing · time
30", "Typing · words 50 · punctuation"); ⌘K lists a new test, every
length and mode, and the two toggles.

- **The words**: 244 common English words, drawn at random, never the
  same one twice in a row. Letters still to type are a quiet grey, typed
  ones turn full colour when right and red when wrong (the letter it
  should have been), extra letters trail in a darker red, and a word left
  wrong is underlined. The caret glides from letter to letter, and the
  box slides up a line when it reaches the third.
- **The options**: time (15, 30, 60, 120 seconds), words (10, 25, 50,
  100) or zen; punctuation (capitals, sentences, commas, now and then a
  question, a colon, quotes, brackets, a dash) and numbers (a word now
  and then is 1 to 4 digits). Picked on the bar, with the arrows before
  the first key, or from ⌘K; kept across restarts.
- **The test**: the clock starts on the first key. A time test shows the
  seconds left above the words and ends when they run out; a words test
  shows the words done out of all and ends on the last word typed right
  (or a space on it). Zen has no words to copy: type anything, the
  counter shows the seconds so far, and Enter ends it (every letter
  counts as right, so it measures speed alone). While it runs the bar and the hints fade, and the
  pointer hides; moving the mouse brings them back.
- **The result**: wpm and accuracy large, a *new best* mark when it is
  one (else the best, and the average of the last ten of this kind);
  raw speed, the letters right, wrong, extra and missed, consistency and
  the time; a chart of the test second by second, with the wpm so far,
  each second's raw speed and its mistakes (hover for the numbers).
- **Pace caret** (setting `pace_caret`, or ⌘K): a second, fainter caret
  gliding at a steady speed to race: your personal best, the average of
  your last ten or your last test of the same kind. Beside the best
  above the words it says the speed. Not in zen, and nothing to race
  until one test of that kind is done.
- **Stop on error** (setting `stop_on_error`, or ⌘K): `letter` refuses a
  wrong letter (the caret shakes red and waits for the right one);
  `word` will not leave a word with a mistake in it on space. The
  refused key still counts against accuracy.
- **Clock** (setting `clock`, ⌘T or ⌘K): the seconds above the words,
  left in a time test or so far in zen. Off hides them for anyone a
  ticking number rushes: a time test still ends on time, and the result
  says how long it took. A words test's count (`12/25`) is progress, not
  time, and stays.
- **Stats**: the `stats` button on the bar, `S` on the result or ⌘K opens
  them over the test. Chips pick all tests or one kind (`time 30`,
  `words 50 · punctuation`); the figures (tests, time typing, highest
  and average wpm with the last ten, accuracy, consistency), a progress
  chart (every test a dot, the average of ten a line; hover for the
  test) and the history table (newest first, each kind's best crowned)
  follow the chip. The personal bests show all eight lengths for the
  options on the bar. `←` `→` switch the kind, `↑` `↓` scroll, Tab
  closes.
- Tab starts a new test at any point; on the result Enter does too, and
  `R` repeats the same words. Escape leaves; a test in progress is
  dropped, as it is when the panel hides mid-test.

The measures are monkeytype's (`typing.ts` has them in full): wpm counts
the letters of correctly typed words and their spaces, over five, per
minute; raw counts everything typed; accuracy is the keystrokes right
when pressed, so a mistake fixed still counts against it; consistency is
100 × (1 − tanh(v + v³/3 + v⁵/5)), v the coefficient of variation of the
per-second raw speeds. A test under 75% accuracy is not counted.

## How it is built

- `typing.ts`: the test, pure. A run is the words, what was typed for
  each and the keystrokes with their times; `typeChar`, `typeSpace` and
  `backspace` are what a key does, `result` scores it (the per-second
  samples included), `file` puts it in the records, `summary`,
  `rolling` and `kinds` are the stats page's numbers. Also the options,
  the view's actions and the title, used by the extension and the page.
- `words.ts`: the word list and `generate`, which draws and dresses the
  words (the rng injected, so the tests pin a draw).
- `index.ts`: the view palette. `view` answers the surface with the
  actions and the title for the stored options; the page sends
  `{ moved: true }` after it saves them, and the extension pushes them
  again with `view.update`. An action picked from ⌘K goes to the page
  (`pal.onAction`).
- `surface/`: the page. `main.ts` holds the run, the keys, the clock and
  the saves, and draws incrementally (a key redraws the one word it
  touched; the caret is one element moved by a transform); `chart.ts`
  is the result's SVG chart, `stats.ts` the stats page. Browser code: `host/tsconfig.surface.json`
  checks it with the DOM types.

## Keyboard

| keys | action | when |
| --- | --- | --- |
| letters, digits, symbols | Type | the test |
| `space` | The next word; the letters left in this one are missed | the test |
| `backspace` | Take a letter back; at the start of a word, back into the one before if it was left wrong | the test |
| `alt+backspace`, `ctrl+backspace` | Take the word back | the test |
| `tab` | New test | any time |
| `enter` | Finish | zen |
| `←`, `→` | A shorter or longer test | before the first key |
| `↑`, `↓` | Time, words or zen | before the first key |
| `enter` | New test | the result |
| `r` | The same words again | the result |
| `s` | Stats and history | the result |
| `←`, `→` | All tests, or the kind before or after | stats |
| `↑`, `↓` | Scroll | stats |
| `tab`, `enter`, `s` | Back to the test | stats |
| `cmd+t` | Hide or show the clock (the `clock` setting) | |
| `cmd+k` | New test, stats, every length and mode, punctuation, numbers, the settings | |
| `escape` | Leave; a test in progress is dropped | |

## Setup

Nothing to install and no permission. Three settings (Settings, or ⌘K in
the test):

| setting | values | default |
| --- | --- | --- |
| `pace_caret` | `off`, `pb`, `average`, `last` | `off` |
| `stop_on_error` | `off`, `letter`, `word` | `off` |
| `clock` | `true`, `false` | `true` |

The options and the
records (the best of every kind of test, the last 1000 tests, the count
and the time typed) live in the extension's storage
(`<data dir>/pal/storage/typing.json`).

## What it does not do

- Quotes, other languages or custom text.
- Themes of its own: it follows the panel's.
- Sound.

## Platforms

macOS and Linux, the same on both: the page runs in the panel's webview.
