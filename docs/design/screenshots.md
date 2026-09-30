# Screenshots

Every bundled extension's store pictures, what they show, how they are made
and what keeps them honest. The store (pal.cagdas.io, `pal-site`) shows them;
`make test` refuses a set that breaks the rules below.

They are generated, never captured: the gallery (`app/src/gallery`) renders
pal's own UI over fixture data in a headless Chrome, so a shot is the same
on every machine and carries nobody's mail, calendar or music. Generated
does not mean invented: the panel and the popover are the real components,
and the bar strips are drawn from what the real renderers draw ("Parity").

## The set

Each extension with a palette has **panel shots**; each extension with a
`bar` item has **bar shots** of one item (the one its bar fixture names).
Every picture exists twice, `<name>.png` on the light theme and
`<name>-dark.png` on the dark one; the store shows the one matching the
visitor's scheme, so a listing is always in one theme (Raycast's rule for
its store: "Avoid using screenshots in different themes").

| file | what | size (px) |
| --- | --- | --- |
| `<n>-<what>.png` | the panel at its size, centred on the wallpaper; `n` orders them (`1-list`, `2-actions`) | 1440 by 900 (960 by 600 at 1.5x) |
| `bar-menubar.png` | the item on the macOS menu bar, among Apple's items | 1440 by 120 (720 by 60 at 2x) |
| `bar-popover.png` | the same strip with the popover a click opens under the item | 1440 by 1080 (720 by 540 at 2x) |
| `bar-popover-<state>.png` | the popover in another state (optional, at most three) | 1440 by 1080 |
| `bar-sketchybar.png` | the item on a sketchybar | 1440 by 120 |

Panel: two to six shots, the first the palette as it opens. Bar: the three
required, the popover states optional. A popover shot can press `keys` as a
panel shot does; a `{ view }` popover answers them from the fixture's
`effects` (what `bar/action` returned for each action id), so Space opens
the recorded preview (`bar-popover-preview.png`). The popover is centred under its
item, as `BarPage.tsx` places it, and top-aligned under the band; the canvas
is the tallest popover's (480 pt) so every popover shot is the same size.

`pal.json`'s `store.screenshots` lists the light files, each with its
caption and `kind` (`panel` or `bar`); the dark twins are not listed. A
popover shot also has `box`, `[x, y, width, height]` in the picture's
pixels: where the popover sits on its canvas, which the store crops to.
`app/scripts/shots.mjs` writes that list from the fixtures, so the captions
live in one place, the fixture.

## Content

- **Invented, plausible data.** People, places, repositories, mail and
  tracks are made up; no real person's name, no real brand's artwork (draw an
  SVG for an app icon, as `extensions/privacy/fixture.ts` does). The
  pictures should look like a real day: sensible times, amounts that add up,
  a few items rather than one or fifty.
- **One fixed clock**, 16 Sep 2026 14:32 local, the strip's clock.
- **What the item really shows.** A bar fixture's item is what the
  extension's `render` answers for that state, a popover's tree is its
  `view.ts` over the fixture; a fixture never hand-writes a tree the code
  would not produce. `extensions/<name>/fixture.ts` builds the fixtures from
  the extension's own functions and writes them; a bar fixture always comes
  from one (a gate), a panel fixture of plain rows may be written by hand.
- **The same every run.** A fixture pins the clock and the zone
  (`fixture-kit.ts` `pinClock`), draws from `seeded()` where it needs chance,
  and passes through `settle()` while its mock servers are up, so no
  `127.0.0.1:<port>` survives into a picture (a picture is inlined as a
  `data:` URI, an address named by a plausible host). `make shots` runs
  every generator twice and fails on a difference.
- **Games** are their own page in the panel frame: the fixture's palette is
  a `tree` whose body is the `surface` node, with `surface.storage` seeding
  the game's state (a deal, a board) so the shot is the same every time.
- **Captions** say what the picture shows and why it matters, in a sentence:
  "A click opens the popover: one row per app, what it holds and for how
  long".

## Parity

The strips on the gallery's band and in Settings > Bar are drawn by
`app/src/ui/BarStrip.tsx` from `app/src/ui/bar-model.ts`, which says what
the menu bar (`bar/menubar.rs`, `describe`) and sketchybar
(`bar/sketchybar.rs`, `props`) draw: the glyph or the glyph run, the text in
the image or the title, template or coloured ink, the count as ` ·7` on the
menu bar and a label item on sketchybar, the band, the paddings.

`app/src-tauri/src/bar/parity.rs` writes the renderers' own answer for every
bar fixture (under ten looks) and every manifest mock (what Settings
previews), in both themes, to `app/src/ui/__tests__/bar-parity.json`, and
fails when that file is stale; `bar-parity.test.ts` fails when
`bar-model.ts` says anything else. A renderer change is therefore three
steps: change the Rust, `PAL_UPDATE_PARITY=1 cargo test -p pal parity`, make
`bar-model.ts` agree.

The parity data covers what is drawn, not how the face renders it: a font's
width, a glyph's weight. `app/scripts/bar-real.sh <extension>...` sets the
gallery's strips beside the real ones (the menu bar's own status-item
picture from `menubar::pixels`, and a running sketchybar drawing the
renderer's properties as temporary items) for the eye; run it after a change
to `BarStrip.tsx` or the renderers' drawing. It caught the progress rule
drawn twice its width and a glyph run at the wrong size.

## Making them

    make shots                  # every extension, both themes, both kinds
    make shots EXT=privacy      # one (a space-separated list works)

`make shots` runs each `extensions/<name>/fixture.ts`, starts the gallery's
Vite server, renders every shot both themes with `app/scripts/shots.mjs`
(the cached Chrome for Testing, never the daily browser, its clock pinned to
the fixtures' moment and zone), quantises the PNGs to 256 colours with
`pngquant` (`brew install pngquant`), rewrites `store.screenshots`, and stamps
`screenshots/.shots.json` with the fixtures' hash. Then look at every
picture: `make shots` prints a contact sheet per extension.

## Gates (`host/test/screenshots.test.ts`, in `make test`)

- every bundled extension with a palette has panel shots, every one with a
  `bar` has a bar fixture naming a declared item and the three bar shots;
- every listed file exists with its `-dark` twin, at its size; nothing in
  `screenshots/` is unlisted or orphaned; captions are there;
- the stamp matches the fixtures: a fixture changed without `make shots` is
  a failure, so the pictures cannot fall behind what they claim to show;
- a `fixture.ts` takes its clock from `fixture-kit.ts` and never reads
  `Date.now()` (two runs a second apart agree even when a picture shows only
  minutes; this makes them agree next month too);
- every `bar.<id>` in a manifest has at least one `mock` (Settings previews
  them) and every mock is a valid item;
- a bar fixture carries what its manifest's rules draw (`parity.rs`,
  `fixtures_carry_what_their_rules_draw`): the core applies the rules over
  what `render` answered, by the states the item publishes, so the fixture
  sets the urgency, tint and presence they give, or its picture is a strip
  the bar never shows.
