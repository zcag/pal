# Extensions

Every palette in pal is an extension, the bundled ones included: a
directory with a `pal.json` manifest and an `index.ts` that Bun runs inside
one long-lived extension host. An extension declares palettes; a palette
lists rows, says what happens when one is picked, and can declare settings
the settings window renders and the config file keeps. An extension can
also put items on the bar ("Bar items", below).

The shapes below are provisional: `sdk/src/protocol.ts` (the types of
`@zcag/pal`, every one with a doc comment) is the contract and moves ahead
of this page until the first release.

## Where they live

- Bundled: `extensions/<name>/` in the repo (the app's resource tree in a
  release build).
- The store, what `pal install` and the settings window fill:
  `~/Library/Application Support/pal/extensions/<name>/` on macOS,
  `~/.local/share/pal/extensions/<name>/` on Linux (`$XDG_DATA_HOME/pal/`
  when set). One store for every config file. Not in the config directory:
  that is often a dotfiles checkout, and the store's install records,
  staging directory and the host's `node_modules/@zcag/pal` link do not
  belong in one.
- Yours, kept wherever you like: every directory in
  `general.extension_dirs` ([Config](config.md)), one subdirectory per
  extension, for a set that lives in dotfiles.

The roots load in that order and a later one wins on a name: a directory
named like a bundled extension replaces it. The host loads every directory
under those roots that has an `index.ts` (or `index.js`), watches them, and
reloads an extension whose files change.

## The manifest, `pal.json`

Read without running the code, so the settings window lists an extension
whose code fails to load.

```json
{
  "name": "hello",
  "title": "Hello",
  "description": "One palette, three rows, one setting.",
  "version": "0.1.0",
  "icon": { "tile": { "glyph": "󱠡", "bg": "teal" } },
  "author": "you",
  "repo": "github.com/you/pal-hello",
  "settings": [
    { "kind": "text", "id": "greeting", "label": "Greeting", "default": "Hello" }
  ],
  "palettes": {
    "hello": { "kind": "list", "description": "What the palette is for." }
  }
}
```

- `name`: required, the directory name and the config key; lowercase
  letters, digits, `-`, `_`, `.`. `pal install` refuses anything else.
- `version`: required (a string).
- `title`, `description`, `icon`, `author`, `repo`: what the settings
  window and the store show. `icon` is the extension's tile ("Icons",
  below): a rounded square in one of twelve brand colours with a white
  mark; every palette wears it at the root unless the code gives the
  palette one of its own.
- `settings`: extension-level settings, `[extensions.<name>]` in the config
  file. Kinds: `text`, `secret`, `number`, `boolean`, `select`, `hotkey`,
  `path`, `list`; each with `id`, `label`, optional `description` and a
  `default`.
- `palettes.<key>`: the palette's static description: `title`,
  `description`, `kind`, `ttl`, `lazy`, `tier`, `keys`, `rank`, `settings`,
  `match`, `inline`, `fallback`
  (`[palettes.<id>].settings` in the file). The key is the palette's key
  in the code's `palettes` object; what goes here and what goes in the
  code is the next section.
- `bar.<id>`: a bar item's `title`, `description` and `refresh` schedule
  (below, "Bar items"). The id is the key in the code's `bar` object.

## Where a palette is described

A palette is described in two files, and each fact has one home:

- **`pal.json` holds what is static and author-facing**: `title`,
  `description`, `kind`, `ttl`, `lazy`, `tier` (below), `keys` (what each key
  does, as `[{ "keys": "cmd+c", "title": "Copy the link" }]`), `rank`,
  `settings`, and the extension's `icon`. The store and the settings
  window read these without running the code.
- **The code holds the behaviour and what only it can know**: `list`,
  `pick`, `detail`, `view`, `filters`, `placeholder`, `showDetail`,
  `columns`, and the flags `live` and `input`.

`kind` is the one fact both sides state, since the manifest names it and
the code implies it, and they must agree:

| `kind` | the code |
| --- | --- |
| `view` | a `view()` palette |
| `grid` | `view: "grid"` |
| `input` | `input: true` (a live input palette is `input`: nothing of it is indexed) |
| `live` | `live: true`, without `input` |
| `list` | none of those |

Read top down: the first row that fits is the kind. `title`, `ttl`, `lazy`
and `tier` may appear on both sides for now; the manifest's value is the
one served, and a code value that differs is a warning. A code value with
no manifest counterpart serves silently (the key stands in for a missing
title). `lazy` is the one of these a code side may want on purpose: the
bundled calendar sets it from its `source` setting at load (Google is a
token command and a network read, EventKit is local).

The host runs this check on every load (`checkPalettes` in `@zcag/pal`,
so an extension's tests can run it too). Nothing fails: each disagreement
is a `[<ext>] manifest: palettes.<key>: ...` line on stderr and an entry
in the `warnings` the settings window shows for the extension. A palette
the code has but the manifest lacks is served from the code alone; one
the manifest has but the code lacks is not served at all. A manifest with
no `palettes` key declares nothing static and gets no warnings (the
bundled `scripts` discovers its palettes from a config file); one that has
the key, even empty, must name every palette.

**The palette id.** Wherever a palette is addressed outside its extension
it is one word: the extension's name when the palette is named like the
extension, else `<extension>-<palette>`. So `emoji`'s `emoji` palette is
`emoji`, `clipboard`'s `history` is `clipboard-history`, `github`'s `prs`
is `github-prs`. That id is the config table `[palettes.<id>]` (`enabled`,
`alias`, `hotkey`, `item_hotkeys`, `icon`, `settings`; see
[Config](config.md)) and the heading in [Palettes](palettes.md). A
`pal://open/<extension>/<palette>` link names the two parts separately
instead.

## `tier`: what the rows are at the root

Every palette's rows compete in one root search, and a big static list
would drown the rest: `chr` matches four hundred icon glyphs. `tier` says
what a palette's rows are next to everyone else's:

| `tier` | for | at the root |
| --- | --- | --- |
| `primary` | what is reached by name: apps, windows, bookmarks, quicklinks, snippets, recent files, browser tabs, system commands, SSH hosts | ranked up (+150), at most 8 rows per palette |
| `normal` | what is browsed: containers, pull requests, devices, services, timers; the default | as matched, at most 6 rows |
| `catalog` | a big static list where any query matches dozens of rows: emoji, unicode, icons, colours, a v1 data file of 100 rows or more | ranked down (-150), at most 3 rows; an exact name (`git` the glyph) sits under the primary rows that have the word and above the normal ones |

A row whose name or keyword has the typed word (every query word starts a
word of it) is ranked above one that only collects the letters (`chr`
across `Clipboard History`), by two tiers' worth; a row named what was
typed leads outright, whatever the tier (a catalog's only above the
normal tier); what the user picks a lot climbs (`docs/config.md`, "Search
history") by up to a tier and a half, so a much-used glyph passes the
normal rows but never a primary one that has the word. The rows a cap
leaves out are behind a muted "12 more in Emoji" row at the end of the
section; `Enter` on it opens the palette, where nothing is capped. The
constants and the measurements are in `core/src/index.rs` under
`EXACT_BONUS` and in `notes/decisions.md` ("Root ordering").

The manifest declares it (`"tier": "catalog"` under `palettes.<key>`);
the code may say `tier` too. The user overrides it with `[palettes.<id>]
tier = "primary"` and the caps with `[general] root_caps`
([Config](config.md#palettesid)). The empty query is untouched: use, then
the listing order, no caps.

## The code, `index.ts`

The default export is `{ palettes: { <key>: Palette } }`. A palette
(provisional shape, `Palette` in `@zcag/pal`):

```ts
import { defineExtension, settings, type Item } from "@zcag/pal";

export default defineExtension({
  palettes: {
    hello: {
      title: "Hello",          // the section label at the root; the manifest's tile is its icon
      list: (): Item[] => [    // rows; indexed unless `input: true`
        { id: "greet", name: "Hello, world", subtitle: "a row", icon: "👋", actions: [{ id: "copy", title: "Copy" }] },
      ],
      pick: (id, action) => ({ copy: "Hello, world" }),  // an Effect
    },
  },
});
```

`defineExtension` only type-checks the object where it is written (it is
`satisfies Extension` under a name an editor completes); the bundled
extensions use `satisfies` directly. With the manifest first,
`defineExtension(manifest, { palettes: { ... } })` (`import manifest from
"./pal.json" with { type: "json" }`), the palettes are checked against
what `pal.json` declares: a declared key left out or an undeclared one
written is a type error. A manifest written inline (`as const`) also pins
each palette's shape to its `kind` (a `view` must have `view()`, a `live`
one `live: true`); a JSON import widens `kind` to `string`, so that part
is left to the load-time check.

- `list(query?, ctx?)` returns `Item[]`, sync or async. Without `input:
  true` the host lists once, the core indexes the rows, and the root search
  matches them like everything else; the palette is listed again when its
  settings change, on `cmd+r`, or after `ttl` seconds at the next start.
  With `input: true` it runs on every keystroke inside the palette and the
  root has only the palette's own row (a calculator).
- `pick(id, action?, ctx?)` returns an `Effect`: `copy` (text, or a
  `CopyText` for a secret, see the note below), `copy_files` (a
  list of paths: the files themselves, see the note below), `open` (url or
  path), `paste`, `focus` (a window id), `hide`, `toast`, `hud` (a line in
  the HUD capsule after the panel hides; `copy` alone shows "Copied" there),
  `large_type` (the text across the screen, below), `dialog` (a path typed
  into the open or save panel in front, below),
  `keep` (stay open and list again), `push` (drill into a palette with
  `args`), `show` (a detail-only level), `view` (a render tree, below),
  `form` (a prompt with fields, below). `ctx` carries `filter`, the `args`
  of the `push` that opened the level, on a form's submit its `values`,
  and on a multi pick `ids` (below).
- Several rows at once: an action with `multi: true` is offered while
  rows are marked (`⇧↓`, `⌘`-click, and `Tab` or, with nothing typed, a
  bare `x` in a palette that declares `multi: true` itself), and `Enter` runs it as one
  `pick(id, action, ctx)` where `id` is the first marked row and
  `ctx.ids` every marked one, in order. An action without `multi` is
  single-row only and is not listed while rows are marked. Frecency
  records nothing for a multi pick. The bundled Files (open, reveal, the
  copies, trash), Windows (close, minimize), Clipboard (copy joined,
  delete) and Bookmarks (open) do this; the pattern is
  `const ids = ctx?.ids ?? [id]` and a loop.
- `dialog`: the path is typed into the open or save panel the app in
  front has up (macOS: its Go to Folder sheet, `cmd+shift+g`, the path
  pasted, Return; GTK: `ctrl+l`), the panel hidden first; the HUD says
  which panel took it or that none was up. `dialog.current()` from
  `@zcag/pal` answers `{ app, pid, kind: "open" | "save", title? }` or
  `null`, read once per panel show and cached (a `list` may ask it on
  every keystroke), so a row can lead with the action only while a panel
  is up, as Files does.
- A secret is a concealed copy: `{ copy: conceal(password) }`, that is
  `{ copy: { text, concealed: true, clear_after: 30 } }`. The text goes on
  the clipboard marked for clipboard managers to skip
  (`org.nspasteboard.ConcealedType` on macOS, the KDE password-manager
  hint on Linux), never enters pal's own history, and after `clear_after`
  seconds the previous clipboard is put back (or the clipboard emptied) if
  the secret is still on it; the HUD says "Copied, clears in 30 s". The
  bundled 1Password and Verification Codes palettes copy this way;
  `conceal(text, 0)` conceals without the clear.
- `large_type`: the panel hides and the text is shown across the screen
  in a type size fitted to the width (a run of digits grouped, a code-like
  text in monospace), until any key, a click, or 8 s: an OTP, an IP, a
  licence key read from across the room. Blank text shows nothing; 400
  characters is the cut.
- `detail(id, ctx?)`: the detail pane's content for a row, asked lazily.
- Palette flags: `live` (arrival order, re-listed on every show, not twice
  within 2 s; with a `ttl`, only once the last listing is older than that),
  `view: "grid"` + `columns`, `placeholder`, `showDetail`, `filters`. `ttl`
  and `tier` belong in the manifest ("Where a palette is described",
  above); the code's is a fallback. Without a `ttl` a palette is listed on
  every load: most bundled TypeScript extensions have none, they are cheap;
  `scripts` defaults its tables to an hour ([Scripts](scripts.md)).
- `lazy: true` (manifest or code, the manifest wins): the palette's first
  listing of a run waits for the first time the panel shows instead of
  running at process start. Its cached rows still restore into the root at
  startup, so nothing is missing from the search; only the refresh moves.
  From that first show on, `ttl` and `live` apply as for any palette, and
  an extension reloaded later lists at once. The only moment such a
  palette has no rows is a first run before the panel was ever shown. For
  a listing that prompts (1Password authorises `op` per app, so every
  start was a prompt), reaches the network (Slack, GitHub, Home Assistant,
  tela, Hue) or reads something private (Messages for OTP). The core logs
  `index <ext>/<palette> lazy, waits for a show` at load and lists it on
  the show with `why` = `show`.
- The root's sections a palette may take part in, all optional:
  - **Inline results**: `inline: true` with a `match` (a regex, a regex
    source, or a predicate `(query) => boolean`; the manifest may carry
    the string form under `palettes.<key>.match` for the store). A root
    query the match accepts runs `list(query, { inline: true })`, and its
    first five rows show at the root under the palette's title, above the
    index's hits, with their own actions (Enter on a calc row copies the
    result, on a colour row opens the picker, on a path row opens the
    file). The core asks 120 ms after the last keystroke, after the local
    hits painted, and drops a reply for a query that moved on; a list
    slower than 1.5 s is left out. A palette that lists hints for the
    empty query returns `[]` when `ctx.inline` is set and nothing matched.
    Make the match tight: it decides how often the list runs.
  - **Fallback rows** (`fallback`): what a query the index has nothing
    for can still do. `fallback: true` adds an "Ask <title>" row that
    opens the palette with the query typed; a string is that row's title
    with `{query}` filled in (`"Search Files for “{query}”"`); a function
    `(query) => Item[]` answers the rows itself (quicklinks lists every
    `{query}` link filled in), picked through `pick` like any row. The
    manifest may declare `true` or the title. `general.fallbacks` orders
    the rows; `general.fallbacks_always` shows them under the hits too.
  - **Suggestions** (`suggest: () => Item[]`): a few rows for the empty
    root's "Now" section, asked on every show of the empty root and after
    every pick from it (the next
    event, the running timer, what is playing, what is on the clipboard).
    Keep it fast and cached: it runs with every other palette's, each on
    a 1.5 s budget, and a slow or failing one is left out. A row's own
    `section` names its section ("Clipboard"); rows without one go under
    "Now". `general.now` orders the palettes.
- `Effect.push` may carry `query`: the level opens with that text in its
  search box (a fallback row hands the root query in this way).
- An `Item` has `id` (stable), `name`, `subtitle`, `icon`, `keywords`,
  `url`, `accessories`, `detail`, `actions` (first is Enter, second
  cmd+Enter; an empty list is an inert hint row). Rows that all do the
  same things declare `actions` once on the palette instead: a row without
  its own gets those (the icons catalog's eleven thousand rows carried
  four copies of `Copy glyph` each, half the listing on the wire).

Settings reach the code resolved: the manifest's defaults with the file's
values on top, kept current on every config change (an extension whose
values changed is listed again).

### Icons

Every icon field (`icon` in the manifest, on a palette, on a row, on a bar
item's menu rows) takes the same forms:

| Form | Draws as | For |
| --- | --- | --- |
| `{ tile: { glyph, bg } }` or `{ tile: { svg, bg } }`, or `tile(bg, mark)` from `@zcag/pal` | a rounded square in the brand colour `bg`, the mark white: one Nerd Font glyph, or SVG path data (`d` only, no markup, under 400 bytes) drawn in a 16 by 16 box | the extension's own icon: `icon` in `pal.json`, which every palette wears at the root, in the crumb, in Settings and on the store |
| `{ glyph, color }`, or `tinted(glyph, color)` | the glyph in a brand colour or a hex of your own | a state on a row: an open pull request's octicon in green, a merged one's in violet |
| a Nerd Font codepoint (`"\u{f0868}"`, or `xdg("dialog-error")`) | the glyph, tinted in the palette's tile colour; the text colour on a palette without a tile | most rows |
| an emoji | the platform's colour emoji | rows whose content is the emoji |
| a hex colour (`"#4F46D6"`) | a dot in that colour | a swatch |
| `{ app: path }` | the application's own artwork | apps, windows, processes |
| `{ image: url }` | the picture, `icon://` or `data:image/` | artwork, avatars, a diagram the extension drew |
| nothing, with a `url` on the row | the site's favicon; the globe mark, in the palette's colour, until it loads | bookmarks, quicklinks, tabs |

The brand colours (`TILE_COLORS`, the `--pal-brand-*` tokens, each with a
light and a dark value): `red orange amber green teal cyan blue indigo
violet pink slate ink`. Pick the one the thing is known by (GitHub `ink`,
1Password `blue`, Home Assistant `teal`); the neutral family (apps,
windows, files, processes, services, system, scripts) is `slate`. A row
with a real picture shows it (an app's icon, a favicon, an avatar, album
art, a colour swatch) and only falls back to a glyph without one. The
host checks every icon on load (`checkIcon`): a tile off the palette or
with markup for its svg is a warning in Settings and the palette's own
icon falls back to the manifest's. Glyphs listed as content (a catalog,
a grid) are not tinted: they are what the palette lists.

## View palettes: a render tree

A palette can draw instead of list: give it `view(ctx)` in place of
`list`, returning a `View`, and pal opens it as a **view level**. The
bundled Blackjack, 2048 and Wordle are (`extensions/{blackjack,2048,wordle}/`).
The tree is built from a fixed vocabulary the app draws with its own
tokens, never HTML, so a view looks like the rest of the panel in both
themes.

```ts
export default {
  palettes: {
    table: {
      title: "Table",
      view: () => ({
        title: "Your turn",
        keys: "actions",
        tree: { type: "stack", padding: 4, gap: 2, children: [
          { type: "text", value: "Dealer", style: "muted", size: "xs" },
          { type: "stack", direction: "row", gap: 1, minHeight: 80, children: [
            { type: "image", key: "d0", src: svgDataUrl, width: 56, height: 80, transition: { enter: "slide-up" } },
          ] },
          { type: "badge", text: "17", color: "blue" },
        ] },
        actions: [{ id: "hit", title: "Hit", shortcut: "h" }, { id: "stand", title: "Stand", shortcut: "s" }],
      }),
      pick: (_id, action) => ({ view: nextTree(action) }),
    },
  },
} satisfies Extension;
```

- In a view level the search input is gone: the view's `title` stands in
  its place, the footer shows the first action and "Actions ⌘K", ⌘K lists
  `actions` with their keys, Escape (and ⌘⌫) leaves. Enter runs the first
  listed action, ⌘Enter the second, a modifier combo the action carrying
  it as `shortcut`. With `keys: "actions"` a **bare key** does too: a
  letter or digit, a symbol as it was typed (`#`, `+`, `-`, `=`), `space`,
  `backspace`, `delete`, `tab`, `up`, `down`, `left`, `right` as
  `shortcut`; a shifted arrow arrives as the combo `shift+up` (and
  `shift+tab` likewise), and one no action carries runs the plain arrow's,
  so a picker's big steps cost no second binding. `shortcut` may be a list
  of alternatives (`["up", "k"]`): any of them runs the action, ⌘K draws
  the first and the rest faintly. `hidden: true` keeps an action out of
  ⌘K, the footer and the Enter / ⌘Enter pair; its key still runs it
  (Wordle's 26 letters), so it must have one.
- **A line of text**: `input: { value?, placeholder?, submit, cancel? }`
  on the view turns the search row into a text field (the caret at the
  end of `value`, focused) for as long as trees carry it. Typing goes to
  the field, bare keys are typing, arrows move the caret, a modifier combo
  still runs its action. Enter picks the `submit` action with the text as
  `ctx.values.input`, Escape the `cancel` action (or leaves the level when
  there is none); both must be actions of the view (`checkView`). Answer
  with a tree without `input` to close the field (the query clears, the
  view's document takes the keys again), or with one to keep it: a
  `value` that differs from the previous tree's replaces the text, the
  same value leaves what was typed alone. Keys that queued while the tree
  with the field was on its way are typed into it. The bundled picker
  opens the field from a hidden action on the first digit or `#` typed
  and answers with that character as `value`, so a notation is typed
  without a mode key.
- One pick at a time, and the search row sweeps meanwhile; a key pressed
  while the reply is on its way **queues** (four at most, the rest dropped)
  and runs against the tree the reply brings, so fast typing loses
  nothing and a key meant for a board that is gone lands on nothing. The
  queue is dropped when the level changes.
- A pick from the view is `pick(id, action, ctx)` with the view's `id`
  (`view` unless the view sets one) and the action's id. Answer `{ view }`
  and the level's tree is replaced in place; any other effect works as from
  a row (`toast` shows over the view, `copy` hides). From a list row,
  `{ view }` pushes a new view level. `ctx.args` are the `push` that opened
  the level, `ctx.filter` its filter.
- Action ids may not start with `pal:` (the shell's own); the host refuses
  such a view (`checkView`, also exported for an extension's own tests). A
  tree is refused past 2000 nodes or 24 levels deep, when two siblings
  share a `key`, when two `move` nodes share one anywhere, and when a
  node names a colour, fill, surface, entrance or exit the app does not
  draw.
- The palette is reported `input: true` (nothing of it is indexed; the root
  has only its own row) with `view: "view"`. It still declares `icon`,
  `title` and settings like any other; `detail` and `filters` have no
  meaning for it.

The vocabulary (`ViewNode` in `@zcag/pal`; every node may carry `key` and
`transition`):

| node | fields | draws |
| --- | --- | --- |
| `stack` | `direction` row/column, `gap` and `padding` in 4 px steps (0..6), `align` start/center/end/stretch, `justify` start/center/end/between, `grow`, `minHeight` px, `surface` sunken/elevated (a well behind a board, a card behind stats; give it `padding`), `radius`, `children` | a flex box |
| `text` | `value`, `style` title/body/muted/mono/number, `size` xs..xl, `weight` regular/medium/semibold, `color` (tag palette, `accent`, `success`, `destructive`, `muted`, `faint`), `width` / `minWidth` px (a column that lines up; a run with a `width` clips instead of wrapping), `align` start/center/end inside it | one run of text |
| `image` | `src` (`icon://…` or `data:image/…`, anything else is not shown), `width`/`height` px, `mask` rounded/circle, `alt` | a picture the extension made or the app's icon scheme serves |
| `tile` | `width`/`height` px, `text`, `sub` (small, under the text), `color` (tag palette, `neutral` (default), `accent`, or a hex colour of the extension's own: `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`), `fill` `solid` (the colour, the panel's background as ink; solid neutral is paper, the elevated surface), `soft` (the tint, the colour as ink; default), `outline` | a rounded box with the tokens' colours, so it follows the theme: a game tile, a keycap of an on-screen keyboard, a stat. The type is tabular, scales with the box, gets heavier as it grows and shrinks to fit the text; under 44 px the box takes the control radius. A hex colour paints the box with itself whatever the fill (a hairline in it for `outline`), takes black or white ink by contrast, and shows a checker through a translucent one: a swatch |
| `gradient` | `width`/`height` px, `fill` (a hex colour under everything), `layers` (each `stops`: two or more hex colours, alpha allowed (`#ffffff00`), spread evenly along `direction` right (default), down, up or left; in paint order, a later layer composites over an earlier one), `marker` `{ x, y }` in 0..1 | a box of CSS linear gradients with the tile radius and, with `marker`, a ring at that point drawn to read on any colour: a hue strip (seven stops round the wheel), the classic saturation/value plane (`fill` the pure hue, white to transparent rightwards, black to transparent upwards) |
| `badge` | `text`, `color` (grey, blue, green, amber, red, violet, pink, teal) | a tag, as on a row |
| `divider` | | a hairline (vertical in a row) |
| `spacer` | `size` px, else the free space | space |
| `progress` | `value` 0..1, `width` px, `color` (tag palette; else the accent) | a bar |
| `keycap` | `keys` in the shortcut spelling (`h`, `cmd+k`, `up`) | key caps, as in the footer |

Unknown node types are skipped, not errors, so a newer extension still
draws on an older app. `key` makes a node the same node across trees: the
app keeps its DOM, and animates one whose key is new or gone per
`transition`: `enter` `fade`, `slide-up` (a 6 px rise, `--pal-motion-slide`)
or `slide-down` / `slide-left` / `slide-right` (the node arrives from that
side), `flip` (a horizontal unfold), `pop` (a scale from 0.8, for a merged
tile or a typed letter); `exit` `fade` (default) or `none`; `delay`
staggers the entrance in steps of 80 ms (0..8). `move: true` animates
layout: when the key was in the previous tree at another box, in another
cell or another parent, the node slides from that box to its new one
(`--pal-motion-move`, a FLIP over the DOM the app keeps) instead of
entering, and the stack it left draws no exit for it; a 2048 tile keyed by
its id slides across the board, a split's card glides to its new hand. A
`move` key must be unique in the whole tree. Durations and easings are the
tokens'; reduced motion turns them all off. A row whose keyed children come
and go wants a `minHeight` so the layout holds still; a cell whose tile
moves out wants a stack of its own holding an `outline` tile meanwhile.

## Forms: asking for values

A pick can answer `{ form }` instead of doing something, and pal pushes a
**form level**: the fields in place of the list, the form's `title` in
the search row, the submit in the footer. Enter submits (⌘Enter from a
textarea), Escape leaves, Tab moves between fields. The bundled Quicklinks
and Snippets create and edit their rows this way (`extensions/quicklinks/`,
`extensions/snippets/`).

```ts
pick: async (id, action, ctx) => {
  if (action === "edit") return { form: {
    id,                                  // what the submit is addressed to; default: the row's id
    title: "Edit Quicklink",
    fields: [
      { kind: "text", id: "name", label: "Name", required: true, default: link.name },
      { kind: "text", id: "url", label: "URL", required: true, default: link.url, description: "{query} stands for what you type." },
      { kind: "checkbox", id: "pin", label: "Pinned", text: "Show at the top" },
    ],
    submit: { id: "save", title: "Save" },
  } };
  if (action === "save") {
    const { name, url } = ctx!.values!;         // a string per field, a boolean per checkbox
    if (!/^https?:/.test(String(url))) return { form: { ...editForm(id), errors: { url: "Not a URL" } } };
    await store(id, name, url);
    return { keep: true, toast: { title: "Saved" } };
  }
},
```

- Fields: `text`, `textarea`, `password`, `select` (with `options`),
  `checkbox` (with `text` beside the box); each has `id`, `label`, and
  optionally `placeholder`, `default`, `required`, `description` (a help
  line under the field). A `required` field left empty (unticked, for a
  checkbox) blocks the submit in the panel: the field is marked and
  focused, and no pick goes out.
- The submit is `pick(form.id ?? rowId, submit.id, ctx)` with
  `ctx.values` keyed by field id (`ctx.args` are the level's, as for any
  pick). Answer it with `{ form }` again carrying `errors: { field:
  message }` and the same form stays with the messages under the fields,
  what was typed kept; any other effect closes the form and runs as from a
  row: `keep` lists the palette again (the new row is there), `toast`
  shows over the list, `copy` or nothing hides. `cancel` names the cancel
  button ("Cancel").
- The host refuses a form without fields, with two fields of one id, a
  field of a kind the panel cannot draw, a submit id starting with `pal:`,
  or `errors` for a field that is not there.

## Links: routes of your own

Every row already has a deep link (`pal://run/<ext>/<palette>/<id>`,
[Links](links.md)), and "Copy deep link" in the panel writes it. A route
of your own is for what a row cannot say: an argument from the outside
(`pal://timer/start?duration=25m&name=tea`), a thing by name rather than
by id (`pal://snippets/paste?name=sig`), a keybind that should not go
through a row at all. Declare it in `pal.json` and answer it in the code:

```json
"links": {
  "start": {
    "description": "Start a timer",
    "params": {
      "duration": { "description": "25m, 90s, 1h30m", "required": true },
      "name": { "description": "Optional; the duration otherwise" },
      "ring": { "description": "Ring the phone when it lands", "type": "boolean" }
    }
  }
}
```

```ts
export default defineExtension(manifest, {
  palettes: { ... },
  link: async (route, params) => {
    if (route === "start") return { hud: await timer(String(params.duration), String(params.name ?? "")) };
  },
});
```

`pal://<name>/<route>?key=value` (and `pal call <name>/<route> key=value`)
then reaches `link(route, params)`. A route name is lowercase letters,
digits and `-`. A param has a `description` (the store and the settings
window show it), `required`, and a `type`: `string` (the default),
`number`, `boolean` (`1`, `true`, `yes`, `on`), `json` (a percent-encoded
JSON value) or `string[]` (a repeated key). The host checks the route is
declared, refuses a missing required param with a line in the HUD
(`pal: timer/start: duration is required`), coerces the rest and drops a
missing optional one, so `params.name` is `undefined` rather than `""`. A
key the manifest does not name rides through as a string.

The answer is an `Effect` like a pick's, run with the panel down: `copy`,
`copy_files`, `open`, `paste`, `focus`, `layout`, `hud`, `toast` (its title
is the HUD's line), `push` (the panel shows inside that palette, with the
args) or nothing. `keep`, `show`, `view` and `form` need the level a pick
came from and are refused with the reason, as `effects.run` refuses them;
to open a form from a link, point the link at the row that opens it
(`pal://form/<ext>/<palette>/<id>?field=value`, which also prefills it).
Throw for what cannot be done (`no snippet "x"`): the message is the
HUD's line.

A link from a web page asks first ("“Start a timer” from a link?
timer/start duration=25m"), unless the user trusts your extension in
`general.deeplink_confirm`; `"confirm": true` on a route keeps the card
whatever they set, for a route that does something irreversible
(system's `run`). The `pal` command never asks.

`checkLinks(manifest, ext)` runs on every load like `checkPalettes`: a
`links` block with no `link` function, a `link` function with no `links`
block (a route is reachable only when declared), a bad route name or a
param type not in the table is a load warning the settings window shows.
Your own tests can call it, and `checkLinkParams(spec, raw, where)` to
see what your handler would get.

## Bar items: glanceable state on the bar

An extension can put an item on the bar (the macOS menu bar, sketchybar,
later a Linux bar): a glyph, a short title, a badge, a fill, and something
that opens on a click. The design is `docs/design/bar.md`; this is the
extension's side of it. One model, `BarItem`, rendered by the core on
every target; the extension never talks to a bar.

**The model.** `render(ctx)` answers the item's whole state and the core
diffs it against the last one:

- `hidden`: the rule. An item earns its slot by having something to say;
  `hidden: true` takes no space on any target, and `render` keeps
  running so it can come back.
- `icon` (a glyph from the bundled Nerd Font, an emoji, `{ image }`,
  `{ app }`), `title` (short: 64 characters at most, the menu bar does not
  truncate), `segments` (up to 8 extra runs after the title, each with its
  own `color`), `badge` (a count, or `"dot"`), `color` (the tag palette
  plus `text`, `muted`, `accent`, `destructive`), `urgent` (drawn as an
  alarm), `stale` (muted, "could not refresh"), `progress` (0..1, a thin
  fill), `tooltip`, `refresh` (seconds until the next `render`, this once).
- `menu`: what a click, the item's hotkey or a hover peek opens, always in
  pal's own popover. An array of `BarMenuNode` is a **menu level**: rows
  (`{ type: "item", id, title, subtitle?, icon?, shortcut?, checked?,
  disabled?, style?, action? }`), `section`s, `submenu`s (3 deep at most),
  `separator`s; 64 nodes at most. `{ palette: "name", extension?, args? }`
  opens that **palette level**, the panel machinery unchanged.
  `{ view: View }` draws the tree as a **view level**. Without a `menu`
  the click is `onOpen` and the extension answers an Effect.

**The manifest.** `bar.<id>` next to `palettes`, so the settings window
lists the item without running the code:

```json
"bar": {
  "notifications": { "title": "Notifications", "description": "Unread count", "refresh": { "every": 300, "on": ["show", "wake", "network"] } }
}
```

`refresh.every` is seconds between renders (10 at least), `on` adds
triggers: `show` (the panel shown), `wake`, `network` (back online),
`focus` (the front app changed), `minute`. The core renders every item
once at load and whenever the extension's settings change.

**The code.** `bar.<id>` in the default export, next to `palettes`:

```ts
export default defineExtension({
  palettes: { /* ... */ },
  bar: {
    notifications: {
      render: async (ctx) => {                    // ctx.reason: load | every | show | wake | network | focus | minute | settings | update | cli | open
        const n = await notifications();          // the palette's own loader, one cache
        if (n.length === 0) return { hidden: true };
        return { icon: "\u{f09b}", badge: n.length, menu: [
          { type: "section", title: "Unread", children: n.slice(0, 5).map((x) => ({ type: "item", id: x.id, title: x.title, subtitle: x.repo })) },
          { type: "separator" },
          { type: "item", id: "read-all", title: "Mark all read", shortcut: "cmd+shift+r" },
        ] };
      },
      onAction: async (action, ctx) => {          // a menu row was picked (its `action`, default its `id`); `segment:<id>` for a segment
        if (action === "read-all") { await markAllRead(); return { keep: true, hud: "Marked read" }; }
        return { open: urlOf(action) };
      },
      onOpen: async (ctx) => ({ copy: code }),    // the click on an item that has no `menu`
      onShown: async (ctx) => { /* the popover opened (a peek counts): warm a cache */ },
    },
  },
});
```

- `render(ctx)` returns a `BarItem`, sync or async. `ctx.reason` says why
  (the manifest's timer is `every`; a push asking for a render is
  `update`; a click that opened the popover is `open`), `ctx.anchor` where
  a click came from (`menubar`, `sketchybar`, `hotkey`, `cli`). The host
  checks every answer (`checkBarItem`, the limits above, no `pal:` action
  ids, a `{ view }` menu through `checkView`); over the limits is an
  error the core marks the item `stale` with.
- `onAction(action, ctx)` and `onOpen(ctx)` answer an `Effect` like
  `pick`: `open`, `copy`, `hud`, `push` (drill into a palette in the
  popover), `view`, `form`, `keep` (re-render the item, the popover stays).
  `settings.get()` works inside all of them without an argument.
- `bar.update(id, item)` in `@zcag/pal` **pushes** an item from the
  extension's own side, for a webhook, a file watcher or a poll it runs
  itself: the core draws it as if `render` had answered. `bar.refresh(id)`
  asks for a `render` with reason `update`. From a timer or a watcher
  (outside `render`/`list`/`pick`) pass the extension's name as the last
  argument, as for `storage`. A push is checked like a render answer.
- An extension that runs an interval or a watcher for its pushes declares
  `dispose()` on the default export: the host calls it before the
  extension is reloaded or removed, since the old module stays resident
  and would keep pushing otherwise.

**The bundled items**, each in the extension that already owns the
data, so the strip and the palette share one loader and one cache:

- **GitHub, `notifications`** (`extensions/github/`): the unread count as a
  badge, hidden at zero. The popover is a menu level with the newest five
  (a row marks the thread read and opens it), "Open all" (pushes the
  Notifications palette) and "Mark all read". Refresh every 300 s and on
  `show`, `wake`, `network`; those triggers ask GitHub with the ETag (a
  304 is free), the timer takes the cache. Signed out is hidden, not an
  error: the strip has no room for a hint.
- **Now Playing, `now-playing`** (`extensions/media/`): the playing track
  as the title, hidden while nothing plays; the popover has Pause, Next,
  Previous, Copy Track and Open. The core asks every 30 s; while a player
  was playing at the last look the extension polls the players every 5 s
  itself and pushes on a track or state change, so a skip shows within
  seconds and an idle machine costs nothing.
- **Verification Codes, `latest-code`** (`extensions/otp/`): the newest
  code as the title, green, for a minute after it arrived, then hidden;
  a click copies it (no `menu`, so `onOpen`). The render sets `refresh`
  to the seconds left in that minute, so the item leaves on time; the
  manifest asks every 10 s otherwise.
- **Timer, `timer`** (`extensions/timer/`, [Palettes](palettes.md#timer-timer-timers)):
  the soonest timer's remaining time with a `progress` fill, blue then
  amber then red, muted while paused, `urgent` once it landed; hidden
  with no timer at all. A click opens the `timers` palette
  (`menu: { palette }`). The second-level ticks are the extension's own:
  an `fs.watch` on the CLI's state directory pushes on every change, and
  a 1 Hz interval pushes the countdown while a timer runs.
- **Slack, `unreads`** (`extensions/slack/`, [Palettes](palettes.md#slack-slack-unreads-slack-channels-slack-search-slack-status)):
  the count of what is addressed to you (direct messages, mentions,
  thread replies) as the badge, hidden at zero, urgent while a direct
  message waits; never the unread channels, which are only named in the
  popover. The popover is a menu level: a section per kind with the
  newest five, "Also unread", Open in pal, Mark all read, Open Slack.
  Refresh every `refresh` seconds (120) and on `show`, `wake`,
  `network`; the palette and the item share one inbox for 30 s, so the
  panel showing costs one `client.counts`.

## Storage

`storage` in `@zcag/pal` is a small per-extension key-value store:
`get(key)` (null when unset), `set(key, value)` (any JSON; null removes),
`remove(key)`, `keys()`. The core keeps one file per extension,
`<data dir>/pal/storage/<extension>.json` (`~/Library/Application
Support/pal/storage/` on macOS, `~/.local/share/pal/storage/` on Linux),
written whole and atomically on every change and shared by every config
profile. It is capped at 256 KB serialised: a `set` that would cross the
cap rejects and nothing is written. For a bankroll, a cursor, a last-used
choice; not for a cache. Which extension is asking is known inside
`list`/`pick`/`view` and at import time; elsewhere pass the name as the
last argument.

## The `@zcag/pal` package

`import { ... } from "@zcag/pal"` is pal's extension API: the calls into
the core and the types of everything above. It lives in `sdk/` in the repo
and is the package of that name on npm (not yet published; see "Writing
one"). The host links it into `<root>/node_modules/@zcag/pal` in the store
and in every `extension_dirs` root, so the name resolves for an extension
there without a fetch (the host runs Bun with `--no-install`). An
extension that carries its own copy in `node_modules` (a `bun add`) gets
that one instead, which works the same: the package reaches the host
through a process-wide slot, not a shared module, so the version in your
`node_modules` only has to speak the same wire. Every call is one request
to the core.

- `settings.get<T>()`: the extension's values, `[extensions.<name>]`.
  `settings.palette<T>()`: the current palette's declared values.
  `settings.onChange(cb)`: called with new values.
  `settings.set(id, value)` / `settings.set({ id: value, ... })` writes
  declared extension-level settings to the config file the way the
  settings window does (a surgical edit through the core: comments and
  the rest of the file stay); `settings.setPalette(id, value)` (or the
  object form) the current palette's. The core checks each value against
  the setting's `kind` (a `select` against its options, a `number`
  against `min`/`max`, a `list` as strings), puts a `secret` in the OS
  keychain and writes the `keychain:pal/<name>-<id>` reference so the
  value never sits in the file, unsets the key for `null` or the
  manifest's default, and writes the ids of one object in one edit so no
  reader sees half of them. The promise resolves once the file is
  written, with `settings.get()` already answering the new values;
  `onChange` fires once per change. An id the manifest does not declare,
  or a value of the wrong kind, rejects and nothing is written. What Hue
  does with the application key after pairing, so it lands in the
  keychain and under Settings › Extensions › Hue like a typed one.
- `clipboard.list({ query, kind, limit, offset })`, `get(id)`, `pin(id)`,
  `delete(id)`, `clear()`, `copy(id)` (back onto the clipboard),
  `imageUrl(id, size)` for an image entry.
- `windows.list()` (every window, front to back, with `id`, `app`, `title`,
  `minimized`, `on_screen`), `close(id)`, `minimize(id)`. Focus is the
  `{ focus: id }` effect from `pick`, so the panel hides first.
- `system.commands()` (sleep, lock, dark mode, volume, and so on, with
  `available` per machine), `system.run(id)` (hides the panel, then runs).
- `apps.forFile(path)`: the applications the OS registers for a file
  (`App[]`: `name`, `path` (the `.app` or `.desktop`, usable as
  `icon: { app: path }`), `bundle_id?`, `default`), the default first; Launch
  Services on macOS, `xdg-mime` + `mimeapps.list` + `mimeinfo.cache` on
  Linux. `apps.openWith(path, app)` opens the file with one of them.
- `storage.get(key)`, `set(key, value)`, `remove(key)`, `keys()`: the
  extension's own key-value file (above).
- `color.sample()`: one pixel off the screen, picked by the user with the
  OS's own loupe (`NSColorSampler` on macOS, no permission; the
  `org.freedesktop.portal.Screenshot.PickColor` portal on Linux, which may
  ask once), as `{ r, g, b, hex }` in sRGB, or null on Escape. The panel
  hides first and stays hidden. The user may take a while, so the call
  waits up to two minutes (`SAMPLE_TIMEOUT_MS`), longer than a pick may:
  from `pick` start it, return at once, and finish in the background
  with `effects.run`.
- `effects.run(effect)`: an `Effect` from outside a pick, for work that
  finished after the pick returned. The OS effects (`copy` with "Copied"
  or the `hud` text in the HUD, `copy_files`, `open`, `paste`, `focus`,
  `layout`, `hud`) and `push`, which shows the panel inside that palette
  (its `view` or `list` asked afresh, as a palette hotkey would). `toast`,
  `keep`, `view`, `form` and `show` need the level a pick came from and
  are refused.
- `selection.text()`: the text selected in the app in front, or null.
- `dialog.current()`: the open or save panel in front, or null (the
  `dialog` effect types a path into it).
  The accessibility API first (`AXSelectedText` of the focused element on
  macOS, the primary selection on Linux); when that answers nothing and
  `general.selection_snapshot` allows (the default), the copy shortcut is
  sent and the clipboard read and put back as it was, with pal's own
  history looking away. Rejects on macOS without Accessibility (the
  prompt is shown once per run). Reading it from `pick` works: the panel
  does not take the selection from the app behind it. The Snippets
  palette fills `{selection}` with it.
- `ocr.image({ path })` or `ocr.image({ data })` (base64 bytes): the text
  in an image, lines top to bottom, an empty string for none; a PDF is
  its first page (`pdftoppm` when installed, else `sips` on macOS). The
  Vision framework on macOS (accurate level, language detected),
  `tesseract` on Linux when installed; `ocr.available()` says, and
  `image` rejects with "OCR unavailable" otherwise. Waits up to 30 s.
  The Clipboard History and Files palettes offer it on images.
- `conceal(text, clearAfter?)`: the `CopyText` for a secret (above);
  `CONCEAL_SECONDS` (30) is the default clear.
- `home(path)`: a leading `~` expanded. `core.call(method, params)`: the
  raw bridge.
- `xdg(name)`: a freedesktop icon name as the glyph the app draws it with
  (`icon: xdg("dialog-error")`), undefined for a name it does not know.
- `bar.update(id, item)`: push a bar item now (above, "Bar items");
  `bar.refresh(id)`: ask for a render.
- `checkView(view)`, `checkForm(form)`, `checkBarItem(item)`: what the
  host runs on every answer (the limits above), for an extension's own
  tests; `shortcutsOf(action)`: an action's keys as a list.
  `checkPalettes(manifest, ext)`: the manifest against the code
  ("Where a palette is described"), `{ metas, warnings }`; `kindOf(p)`:
  the kind a palette implies. `defineExtension(ext)` and
  `defineExtension(manifest, ext)`: the typed default export.
- `audio.devices()` (every output and input, `AudioDevice[]`: `id`,
  `name`, `kind`, `default`, `volume`, `muted`, `transport`),
  `setDefault(id, kind)`, `setVolume(id, kind, percent)`,
  `setMute(id, kind, muted?)` (omitted toggles; resolves with the state
  after). CoreAudio on macOS, `wpctl` else `pactl` on Linux.
- `bluetooth.devices()` (paired, `BluetoothDevice[]`: `address`, `name`,
  `connected`, `kind`, `battery`, `battery_detail`; connected first),
  `connect(address)`, `disconnect(address)` (synchronous, seconds).
  `system_profiler` + IOBluetooth on macOS, `bluetoothctl` on Linux.
- `wifi.status()` (`interface`, `powered`, `current` with `ssid`, `signal`,
  `channel`, `security`, `ip`; `ssid` null when macOS hides it),
  `known()`, `scan(mode)` (`cached` never runs the tool, `auto` reuses a
  scan under a minute old, `fresh` scans now; `networks` strongest first
  plus `hidden`, the count of nameless ones), `join(ssid, password?)`,
  `forget(ssid)`, `password(ssid)` (the keychain prompts on macOS),
  `setPower(on)`. `networksetup`/`ipconfig`/`system_profiler` on macOS,
  `nmcli` on Linux.
- `media.nowPlaying()` (`players`: `MediaPlayer[]` with `id`, `name`,
  `state`, `title`, `artist`, `album`, `artwork`, `url`, `app`,
  `position`, `duration`, playing first; `system_wide`: whether a
  system-wide source is there: the bundled MediaRemote adapter or
  `nowplaying-cli` on macOS, `playerctl` on Linux), `control(player,
  command)` (`play_pause`, `play`, `pause`, `next`, `previous`; the panel
  stays up). Spotify and Music over AppleScript plus the system's Now
  Playing as the `system` player on macOS (a title-less player with a
  state is one that reports no track, Chrome for one), `playerctl` on
  Linux.

The protocol's types ride along: `Extension`, `Palette`, `Item`, `Action`,
`Icon`, `Effect`, `CopyText`, `Ctx`, `Detail`, `View`, `ViewNode`, `Form`,
`FormField`, `FormValues`, `BarItem`, `BarMenu`, `BarMenuNode`,
`BarSegment`, `BarColor`, `BarCtx`, `BarSource`, `Manifest`,
`SettingSpec`, and the API's own
(`ClipboardEntry`, `Window`, `WindowLayout`, `SystemCommand`, `App`,
`AudioDevice`, `BluetoothDevice`, `WifiStatus`, `WifiNetwork`, `WifiScan`,
`MediaPlayer`, `NowPlaying`).

Dependencies: a `package.json` next to `index.ts` is honoured; `pal
install` runs `bun install --production` in the copy it makes. List
`@zcag/pal` under `devDependencies` (it is for the editor; the host
provides it at runtime), so that install skips it.

## Install, update, remove

From the CLI (`pal install SPEC`, see [CLI](cli.md)) or the settings
window's Extensions page (the box at the top takes the same spec; Update
and Remove are on each extension). A spec is:

- `github:user/repo`, `github:user/repo/sub/dir`, either with `@ref` (a
  branch, tag or commit; the default branch otherwise);
- `https://github.com/user/repo`, or `.../tree/<ref>/sub/dir`;
- a local directory, which is copied (without `node_modules` and `.git`).

Install fetches the codeload tarball (20 s), validates the manifest, runs
`bun install --production` when there is a `package.json` (120 s), and
renames the finished copy into the store's `<name>/` in one step, so
nothing ever sees it half-done. A name already installed is refused:
`update` it instead. `.pal-install.json` in the directory records
the source, the ref, the time and the commit it was fetched at.

`pal update NAME` fetches the recorded source again and replaces the
directory; `pal update` with no name does every extension that has a
source. The Extensions page checks GitHub once when it opens (the commit
at the recorded ref, unauthenticated, 10 s each) and marks an extension
whose branch moved with an `update` tag.

`pal remove NAME` deletes the directory. Its keys in the config file stay
(`[extensions.<name>]`, `[palettes.<id>]`), so a reinstall finds its
settings; delete them by hand if you want them gone.

After each of these the extension host is restarted, so the new set is
loaded and a removed extension is gone from the root.

## Writing one

An extension is a directory; nothing else is needed. The walkthrough
below is what `examples/hello-extension/` is, step by step.

1. A directory and its manifest:

   ```sh
   mkdir hello && cd hello
   cat > pal.json <<'EOF'
   {
     "name": "hello",
     "title": "Hello",
     "version": "0.1.0",
     "icon": "👋",
     "settings": [
       { "kind": "text", "id": "greeting", "label": "Greeting", "default": "Hello" }
     ]
   }
   EOF
   ```

2. The API, for the editor. `@zcag/pal` is not on npm yet, so link it from
   a checkout of pal (once: `bun run build` in `sdk/` produces the `.d.ts`
   the editor reads, `bun link` registers the package under its name):

   ```sh
   (cd path/to/pal/sdk && bun run build && bun link)
   echo '{ "name": "hello", "private": true, "type": "module" }' > package.json
   bun link @zcag/pal
   ```

   That puts the symlink under `node_modules` and writes nothing to
   `package.json`. Once the package is published this is `bun add -d
   @zcag/pal`: a dev dependency, since the host provides the package at
   runtime and `pal install` skips dev dependencies.

3. The code:

   ```ts
   // index.ts
   import { defineExtension, settings, type Item } from "@zcag/pal";

   type Settings = { greeting: string };

   export default defineExtension({
     palettes: {
       hello: {
         title: "Hello",
         icon: "👋",
         list: (): Item[] => [
           { id: "greet", name: `${settings.get<Settings>().greeting}, world`, icon: "👋", actions: [{ id: "copy", title: "Copy greeting" }] },
           { id: "time", name: "What time is it", icon: "🕰", actions: [{ id: "tell", title: "Tell me" }] },
         ],
         pick: (id) => (id === "greet" ? { copy: `${settings.get<Settings>().greeting}, world` } : { toast: { title: new Date().toLocaleTimeString() } }),
       },
     },
   });
   ```

4. Install it: `pal install .` copies the directory into the store (without
   `node_modules`), and the host loads it. Type `hello` in the panel.

5. Edit and reload. `pal update hello` copies the directory again (the
   install recorded where it came from; `pal install .` a second time is
   refused, the name is taken), and the host reloads the extension: the
   store is watched, a changed file reloads its extension in place. For a
   real edit loop skip the copy: add the directory you are editing to
   `general.extension_dirs` ([Config](config.md)) and every save reloads
   it, the rows in the panel following on the next open. `cmd+r` in the
   panel lists it again by hand.

The example's full form (three rows, a setting with a description, the
manifest's `palettes` block) is `examples/hello-extension/`. Install it
from a checkout with `pal install path/to/pal/examples/hello-extension`,
or from GitHub with `pal install github:zcag/pal/examples/hello-extension@main`;
change the greeting under Settings, Extensions, Hello and the row follows.

## Trust

An extension is code that runs with your user's rights inside the host.
There is no signing and no registry yet: install what you would run from
a terminal. `bun install` also runs the dependencies' install scripts.
