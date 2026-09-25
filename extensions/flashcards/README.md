# Flashcards

Spaced repetition for the minute a build takes. Enter on **Flashcards**
lands on the next card due across every pack you practise; each answer is
saved the moment you give it, so Escape at any point loses nothing and the
next open carries on where you were. The first open asks what to learn.

The bundled packs are Spanish: the **6000 most common words** (Jeff
Doozan's *6001 Spanish* deck), most used first, each with its gender, a
short meaning and an example sentence; and **everyday phrases**. Any pack of your own works the same way (below).

## Studying

A session is a card on a stack. The front shows the word; Space flips the
card over to what it means, with an example sentence (the word marked in
it). Then say whether you knew it, and the card flies off that way:

| Key | Answer | The card |
| --- | --- | --- |
| `→`, Space or Enter | Knew it | Flies right; comes back later, further apart each time |
| `←` | Didn't know | Flies left; comes back in a minute |

The mouse can drag the card either way instead. With `Buttons` set to four,
`1`–`4` are Didn't know, Barely, Knew it and Too easy (Anki's Again, Hard,
Good, Easy). Each button says when the card comes back. The first dozen
answers ever get a line of explanation, and the first open explains the
loop in three steps.

**Sessions are short.** A session is 10 answers (`Cards per session`),
counted by the bar along the top; the stack under the card thins as it
runs out. Then a summary: how many right, how long, the words you missed,
the new ones and any you mastered (as chips), and how much of everyday
Spanish your words now cover, with what this session added. Enter keeps
going with another 10, `d` drills this session's misses until each is
right once, `s` the stats page.

A noun's article is coloured by gender (**el** blue, **la** rose), and the
card carries the same colour along its top edge. `?` lists every key. Tab says the word aloud (a deck's own recording if
it has one, else the best system voice installed: Premium, then Enhanced;
Stats says how to download a better one), (shift+Tab the example; `Say it aloud` can make it automatic), ⌘Z takes
the last answer back (the card comes back from the left), ⌘E writes your
own meaning for a card that the pack got wrong (kept for both directions),
⌘K lists the rest (suspend, learn more today, the refresher, mute).

**Recognise first, then produce.** A pack with `reverse` (both bundled
ones) makes two cards of each word. The Spanish-to-English card comes
first; once you have learned the word, its English-to-Spanish card joins
the queue, and you type the answer. The check is kind where a learner is
right in substance: case, punctuation and ¿¡ do not matter, any one of
several meanings counts, and a missing accent, a missing article
("gato" for "el gato") or one slip in a longer word counts as close: the
letters you typed are shown against the answer, and Enter takes the grade
it earned (Knew it; Didn't know when wrong, or after more than one hint).
Tab gives the next letter; `a'` types á, `n~` ñ, `u:` ü, and the accents
sit under the field to click. The two cards of one word
never come on the same day.

**The day.** New cards come in pack order, 15 a day (`New cards a day`),
one after every three reviews. Cards you are learning come back within
the day (1 and 10 minutes, then days); when nothing else is left, one due
in the next 20 minutes is shown early rather than ending the session. The
day runs to 4 am. When everything is done, the summary: what you answered,
what you mastered, how much of everyday speech the words you know cover, a
heatmap of the last 16 weeks, what comes back tomorrow; `n` learns ten more
today, `r` opens the refresher.

**Goal and streak.** The ring fills with the day's answers (`Daily goal`,
20); the streak counts the days in a row it was filled. **Stats** (`s`):
the streak and your best, answers and time studied, how much of what came
due you remembered this month, a 16-week heatmap, the next seven days'
reviews, and each pack's mastered, learning and new.

**The refresher** drills the cards you keep missing: forgotten in the last
week, forgotten three times or more, or below 80% recall now, weakest
first, 20 at most. An Again sends a card three places back until you get
it. It never changes a card's schedule: practising a card early teaches
the scheduler nothing, so only a real review does.

**Mastered** is Anki's "mature": a card not due for three weeks or more.
A card forgotten eight times is flagged as a tricky one: it needs a
mnemonic, not more reviews.

## Scheduling

[FSRS](https://github.com/open-spaced-repetition/fsrs4anki/wiki/ABC-of-FSRS),
the scheduler Anki uses, through [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs)
(MIT): each card has a stability and a difficulty, and comes back when the
chance you still remember it falls to `Remember` (90% by default; higher
means many more reviews). Intervals are fuzzed a little so cards learned
together spread out. Every answer is logged, which is what an FSRS
optimiser would fit its weights to later.

## Decks from AnkiWeb

**Browse Anki Decks** searches AnkiWeb's shared decks (the library the
Anki app downloads from, thousands of them) as you type; with nothing
typed it lists the decks for the language you are learning. Each row has
the cards, whether it has audio and pictures, how many liked it and when
it was updated; the pane beside it has the deck's description and a few
sample cards as they would read here. Enter downloads the deck into the
packs folder in the background and adds it to practice; the HUD says when
it is in (a big deck with audio is 100 MB or more). Added, Enter studies
it; ⌘Enter opens its page on AnkiWeb. The first open's `b`, Flashcard
Packs and ⌘K while studying all lead here. No account is needed: it asks
AnkiWeb's own service the way its site does.

## Your own packs

Put a file in the packs folder (⌘K › Open the packs folder;
`~/Library/Application Support/pal/flashcards/packs` on macOS,
`$XDG_DATA_HOME/pal/flashcards/packs` on Linux), then add it to practice
from **Flashcard Packs**:

- **An Anki deck (.apkg)**, any from AnkiWeb or elsewhere: each note is a
  card, its fields matched by name (Front/Word/Spanish… to the front,
  Back/Meaning/English… to the back, a Sentence and its translation to the
  example), else the first two. The deck's own recordings come along and
  play on Tab, a native speaker over the system voice. Both Anki's older
  and its 2.1.50+ (zstd) exports read.
- **TSV, CSV or TXT**: front, back, then optionally note, example,
  example_back per line; a first line naming those columns is a header.
  Anki's *Export › Notes in Plain Text* reads as is (`#` lines skipped,
  HTML stripped).
- **JSON**: `{ "title", "description", "lang": { "front": "es", "back": "en" }, "reverse": true, "cards": [{ "front", "back", "note", "example", "example_back" }] }`.
  `lang` picks the voice; `reverse` adds the typed cards.

A card is known by its `id`, else its front, so fixing a translation keeps
its history. **Add Flashcard** takes one card at a time: `gato = cat`
(or `→`, `;`, a tab) goes into My cards, which joins practice.

## Palettes and settings

- **Flashcards** (view): study what is due; the root's Now section shows a
  row while cards are due (`On opening pal`).
- **Flashcard Packs**: every pack with how much is mastered, learning and
  new, and how much of the language it covers; Enter studies that pack
  alone, ⌘Enter adds it to practice or takes it out (progress is kept),
  ⌘R its refresher.
- **Add Flashcard** (input).

Settings: new cards a day, cards per session, daily goal, remember (desired retention), type
the answer (reverse cards, always, never), say it aloud (when shown, on
Tab, off; Tab by default), voice, buttons (Didn't know and Knew it, or four), sounds, on opening pal.

Progress lives in `progress.json` beside the packs folder, written whole
and atomically after every answer.

## The bundled data

The words are [6001 Spanish](https://github.com/doozan/6001_Spanish) by
Jeff Doozan: the most used Spanish lemmas (OpenSubtitles frequencies,
lemmatised), with phrases where a word lives in one, common noise
excluded, gender and part of speech, Wiktionary's senses with short
flash-card glosses marked, and example sentences from Tatoeba's reviewed
lists. `tools/spanish.ts` converts its last build (pinned to a commit):
the short glosses without their asides, three senses at most, the example
that uses the word as written at a readable length, and each word's share
of spoken Spanish for the coverage figure. The phrases are written for
the pack. Licenses and credits: `packs/LICENSE.md`.
