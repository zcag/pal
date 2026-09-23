# Extensions

Every palette in pal is an extension, the bundled ones included: a
directory with a `pal.json` manifest and an `index.ts` that Bun runs inside
one long-lived extension host. An extension declares palettes; a palette
lists rows, says what happens when one is picked, and can declare settings
the settings window renders and the config file keeps. An extension can
also put items on the bar ("Bar items", below).

`sdk/src/protocol.ts` (the types of `@zcag/pal`, every one with a doc
comment) is the contract; this page follows it, and where the two differ
the code is right.

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
  file (`SettingSpec`). Every one has `id`, `label`, an optional
  `description` and a `default`; `"scope": "instance"` marks one that
  identifies the account (below, "Instances"); `"bar": "<item id>"` marks
  one that is about a bar item (when it shows, its thresholds, its
  colours), so Settings > Bar lists it on that item's pane as well, and an
  id starting `bar_` with no `bar` lands on every item of the extension.
  The kinds and what each
  adds: `text` and `secret` (`placeholder`; a secret goes to the OS
  keychain, [Config](config.md#secrets)), `number` (`min`, `max`, `step`,
  `unit`), `boolean` (`text`, the line beside the switch), `select`
  (`options`, each `{ id, title }`), `hotkey`, `path` (`pick`: `file` or
  `folder`, `placeholder`), `list` (`placeholder`; the default a list of
  strings).
- `keywords`: words every palette's row at the root answers to, on top
  of its title and key: the short names people type for the product
  (`["gh"]` on GitHub, `["ha", "hass"]` on Home Assistant, `["1p", "op"]`
  on 1Password). Typing one lists the extension's palettes first; without
  it `gh` scatters across `GitHub` and loses to rows that start a word
  with it. They name the palette's **rows** as well: with the titles and
  the config's `alias` they are the source's *path*, and a query word
  that starts a word of it is spent there, so `gh pal` finds the
  repository and `tod estonia` the todo. A word only lands in the path
  when it starts a word of it (`mail` does not reach `Gmail`: that is
  what a keyword is for), and a query all of whose words land there
  lists nothing, so `gh` alone is still the palettes, not every pull
  request in them.
- `palettes.<key>`: the palette's static description: `title`,
  `description`, `kind`, `ttl`, `lazy`, `tier`, `keys`, `keywords` (the
  palette's own, on top of the extension's), `rank`, `settings`,
  `match`, `inline`, `fallback`, and for a view palette `refresh` and `on`
  (`[palettes.<id>].settings` in the file). The key is the palette's key
  in the code's `palettes` object; what goes here and what goes in the
  code is the next section.
- `bar.<id>`: a bar item's `title`, `description`, `refresh` schedule,
  `keys`, optional Settings-only `mocks`, and its `rules` (below, "Bar
  items"). The id is the key in the code's `bar` object.
- `links.<route>`: a deep link route the code answers, with its
  `description`, `params` and `confirm` (below, "Links: routes of your
  own").
- `states.<name>`: a state the code publishes, with `state.set` or in a
  render's `states` (below, "States"), its `description` and `kind`
  (`boolean`, `number`, `string`), so the States palette and the item's
  Settings pane show it before it is ever set.
- `multi`: `true` when the extension can run as several configured
  instances (two accounts, two homes; below, "Instances"). Without it a
  `[instances."<name>@<suffix>"]` in the config file is not loaded.

## Instances: one extension, several accounts

An extension that declares `"multi": true` in `pal.json` can run as
several *instances*: the user adds `[instances."gmail@work"]` to the
config file ([config.md](config.md), "`[instances]`") and gets a second
set of palettes and bar items with their own settings, storage, cache,
frecency and links; the code and the manifest are shared. The default
instance is the bare name and everything that exists today; the other
is spelled by its *key*, `<name>@<suffix>`, everywhere a name is used
(`[extensions."gmail@work"]`, `[palettes."gmail@work-inbox"]`,
`[bar.items."gmail@work/unread"]`, `pal://open/gmail@work/inbox`,
`storage/gmail@work.json`).

The code never learns a new API to work: `settings.get()`, `storage`,
`bar.update`, `push` and the rest keep meaning "me", where "me" is the
instance. Every instance of a `multi` extension runs in its own worker of
the host (the default too, even when it is alone), with its own copy of
the module and everything it imports, so a token cached at module level
in `api.ts` is one instance's alone. What changes for the author:

- `settings`: mark a setting `"scope": "instance"` when it identifies the
  account rather than configures it (Home Assistant's `url`, Slack's
  `workspace`); it is then never inherited from the default instance,
  like a `secret` never is. Everything else inherits: `[extensions.gmail]
  signature` is `gmail@work`'s signature until set there.
- Palette titles: with two or more instances every palette title gets the
  instance's title in parentheses appended ("Inbox (Work)"), unless the
  manifest's `title` contains `{instance}`, which is substituted instead
  (`"{instance} Inbox"` gives "Work Inbox"). With one instance, or for a default
  the user has not named, `{instance}` and one surrounding pair of parentheses
  or a flanking space are stripped ("Inbox ({instance})" is "Inbox").
  `{instance}` in a manifest without `multi` is a load warning.
- Tile: the extension's tile wears the instance's `tint` and a `badge`
  letter in the corner; a palette's own tile keeps its colour and gains
  the badge. The default instance keeps the plain tile.
- `instance()` in `@zcag/pal` answers `{ key, name, title, isDefault }`:
  `key` is `gmail@work` (the bare name for the default and for a non-`multi`
  extension), `name` the manifest's, `title` "Work" (none for an unnamed
  default). A bar item gets the same as `ctx.instance` in `render`, so
  it can name its account in `title`.
- An effect's `push` (and a bar item's `menu: { palette }`) that names
  the extension by its manifest name, or not at all, lands on the
  instance it came from; another extension's name is left as written.
- `dispose` runs when an instance is removed or reloaded, before its
  worker is terminated. An instance whose event loop hangs is terminated
  after a second without touching the others.
- Bar items: the strip is not marked; the core appends the instance's
  title to the tooltip ("3 unread (Work)") and to the popover's title,
  and Settings > Bar reads "Gmail (Work) › Unread". A lone or unnamed
  default is not marked.
- Settings: the user adds, renames, parks and removes instances on the
  Extensions page ("Add another account", with the suffix slugged from
  the title), or with `pal instance add gmail work --title Work` and `pal
  instance remove gmail@work`; nothing is asked of the extension. Settings
  shows each instance's values with the inherited ones marked; a secret
  or `scope: "instance"` field reads "Set for this instance" and, empty,
  puts the instance on the Overview's needs-setup list ("Gmail (Work)
  needs token"). Removing an instance takes its tables, storage, index
  cache and frecency away; keychain items stay.

Bundled: `gmail` (two accounts: `token_command`, `address` and `send` per
instance), `github` (two accounts: `token` per instance, the rest inherits),
`slack` (a workspace per instance: `workspace` is `scope: "instance"`),
`home-assistant` (a home per instance: `url` is `scope: "instance"`).

## Where a palette is described

A palette is described in two files, and each fact has one home:

- **`pal.json` holds what is static and author-facing**: `title`,
  `description`, `kind`, `ttl`, `lazy`, `tier` (below), `keys` (what each key
  does, as `[{ "keys": "cmd+c", "title": "Copy the link" }]`), `keywords`
  (the words the palette's root row answers to), `hold` (the switcher
  chord to suggest, `"alt+tab"` on Windows: applied while the user's
  config has no `hold` line, [Keyboard](keyboard.md#switcher)), `rank`,
  `settings`, and the extension's `icon` and `keywords`. The store and
  the settings window read these without running the code.
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
and `tier` may appear on both sides; the manifest's value is the
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
| `catalog` | a big static list where any query matches dozens of rows: emoji, unicode, icons, colours, a scripts data file of 100 rows or more | ranked down (-150), at most 3 rows; an exact name (`git` the glyph) sits under the primary rows that have the word and above the normal ones |

A row whose name or keyword has the typed word (every query word starts a
word of it) is ranked above one that only collects the letters (`chr`
across `Clipboard History`), by two tiers' worth; a row named what was
typed leads outright, whatever the tier (a catalog's only above the
normal tier); what the user picks a lot climbs (`docs/config.md`, "Search
history") by up to a tier and a third, so a much-used glyph passes the
normal rows but never a primary one that has the word (the boost's
ceiling is 200 points against a tier's 150). The rows a cap
leaves out are behind a muted "12 more in Emoji" row at the end of the
section; `Enter` on it opens the palette, where nothing is capped. One
row for one thing: two palettes of one extension that list the same item
under the same id (Today beside My Schedule, Recent Notes beside Notes,
Unread beside Chats) put it under the better-ranked section only. The
constants and the measurements are in `core/src/index.rs` under
`EXACT_BONUS` and in `notes/decisions.md` ("Root ordering").

The manifest declares it (`"tier": "catalog"` under `palettes.<key>`);
the code may say `tier` too. The user overrides it with `[palettes.<id>]
tier = "primary"` and the caps with `[general] root_caps`
([Config](config.md#palettesid)). The empty query is untouched: use, then
the listing order, no caps.

## The code, `index.ts`

The default export is `{ palettes: { <key>: Palette } }`. A palette
(`Palette` in `@zcag/pal`):

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
  settings change, on `⌘R` (`ctx.refresh` is then `true`, so a cache of
  the extension's own steps aside), or after `ttl` seconds at the next
  start.
  With `input: true` it runs on every keystroke inside the palette and the
  root has only the palette's own row (a calculator).
- `pick(id, action?, ctx?)` returns an `Effect`: `copy` (text, or a
  `CopyText` for a secret, see the note below), `copy_files` (a
  list of paths: the files themselves, see the note below), `open` (url or
  path), `paste` (`{ text }`, or `{ entry }` for a clipboard history id),
  `focus` (a window id), `layout` (a `WindowLayoutRequest`: `name` one of
  the window layouts, `id` a window from `windows.list()`, else the
  focused one; the panel hides first and the HUD names the layout),
  `space` (a space id from `windows.spaces()`: the panel hides, then the
  space comes in front),
  `hide`, `toast` (`{ title, message?, style? }`, `style` `success` or
  `destructive`), `hud` (a line in
  the HUD capsule after the panel hides; `copy` alone shows "Copied" there),
  `large_type` (the text across the screen, below), `dialog` (a path typed
  into the open or save panel in front, below),
  `keep` (stay open and list again), `push` (drill into a palette with
  `args`; `title` names the level's crumb, the folder being browsed
  rather than the palette's title; `query` is typed into it), `show` (a
  detail-only level: a `Detail` plus a `title`), `view` (a render tree, below),
  `form` (a prompt with fields, below). `ctx` carries `filter`, the `args`
  of the `push` that opened the level, on a form's submit its `values`,
  and on a multi pick `ids` (below).
- A bare `→`, `←` or `backspace` on a list row while nothing is typed
  runs the row's action carrying that key as its `shortcut` (`"right"`,
  `["left", "backspace"]`); `←` and `backspace` also reach such an action
  on any row of the level, so a `..` row's Go up works from anywhere in a
  browsed folder. With text in the box the keys keep their native effect.
- Several rows at once: an action with `multi: true` is offered while rows are
  marked (`⇧↓`, `⌘`-click, and `Tab` or, with nothing typed, a bare `x` in a
  palette that declares `multi: true` itself), and `Enter` runs it as one
  `pick(id, action, ctx)` where `id` is the first marked row and `ctx.ids` every
  marked one, in order. An action without `multi` is single-row only and is not
  listed while rows are marked. Frecency records nothing for a multi pick. The
  bundled Files (open, reveal, the copies, trash), Windows (close, minimize),
  Clipboard (copy joined, delete) and Bookmarks (open) do this; the pattern is
  `const ids = ctx?.ids ?? [id]` and a loop.
- `dialog`: the path is typed into the open or save panel the app in
  front has up (macOS: its Go to Folder sheet, `⌘⇧G`, the path
  pasted, Return; GTK: `Ctrl+L`), the panel hidden first; the HUD says
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
  a listing that reaches the network (Slack, GitHub, Home Assistant,
  tela, Hue) or reads something private (Messages for OTP). The core logs
  `index <ext>/<palette> lazy, waits for a show` at load and lists it on
  the show with `why` = `show`.
- `lazy: "visit"`: the first listing waits for the user's first visit to
  the palette (the panel inside it, or the sidebar showing it), not the
  first show, and a reload before that visit still waits. For a listing
  that **prompts**: 1Password authorises `op` per app with its own
  window, and pal asks for nothing before the feature is used (the same
  rule as its own permissions: nothing at launch, the ask at the
  feature). The price is a fresh profile's root search not finding those
  rows until the palette was opened once; the cache carries them from
  then on. Logged `lazy, waits for a visit` at load, listed with `why` =
  `visit`.
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
    for can still do. `fallback: true` adds an "Ask `<title>`" row that
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
  search box (a fallback row hands the root query in this way). A push
  carrying `args: { create: ... }` into `snippets` (a string, the text)
  or `quicklinks` (`{ name?, url?, keywords? }`) lists one row whose form
  comes pre-filled with it: the way another extension hands a snippet or
  a link over to be saved.
- An `Item` has `id` (stable), `name`, `subtitle`, `icon`, `keywords`,
  `url`, `accessories`, `detail`, `actions` (first is Enter, second
  ⌘Enter; an empty list is an inert hint row). Any other key rides
  through untouched (a `section` for the empty root, whatever the
  extension wants to keep on the row) and `pick` does not get it back.
  An accessory is right-aligned on the row: `{ text }`, `{ tag, color? }`
  (a badge in the tag palette), `{ date }` (an ISO string or unix ms,
  shown relative: "3 h ago") or `{ keys }` (a shortcut drawn as key
  caps). `detail` is `{ markdown?, metadata? }`:
  markdown (no raw HTML; `icon://` images work) over a list of
  `{ label, value?, tags?, link? }` lines; `detail(id, ctx)` on the
  palette answers the same lazily. An `Action` has `id`, `title`,
  `shortcut` (below), `style: "destructive"` (drawn red), `confirm` (a
  question asked first, the action's title as the go-ahead), `multi` and
  `hidden`. Rows that all do the
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
| `{ tile: { glyph, bg } }` or `{ tile: { svg, bg } }`, or `tile(bg, mark)` from `@zcag/pal` | a rounded square in the brand colour `bg`, the mark white: one Nerd Font glyph, or SVG path data (`d` only, no markup, 400 bytes at most) drawn in a 16 by 16 box; `badge` puts one or two characters in its corner (`badged(icon, { tint, badge })`) | the extension's own icon: `icon` in `pal.json`, which every palette wears at the root, in the crumb, in Settings and on the store |
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
  (Wordle's 26 letters), so it must have one, or a node that runs it on a
  click (`action`, below).
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

The vocabulary (`ViewNode` in `@zcag/pal`; every node may carry `key`,
`transition`, `action` and `selected`):

| node | fields | draws |
| --- | --- | --- |
| `stack` | `direction` row/column, `gap` and `padding` in 4 px steps (0..6), `align` start/center/end/stretch, `justify` start/center/end/between, `grow`, `flex` (a weight: this share of the parent's free space against its `flex` siblings, so a row of weighted stacks divides the width in proportion at any panel width), `width` / `height` px (a box of that size), `minHeight` px, `surface` sunken/elevated (a well behind a board, a card behind stats; give it `padding`) or a hex colour of the extension's own (the box is that colour; black or white ink by contrast once its alpha is over 0.5, the panel's ink under a faint tint), `radius`, `children` | a flex box; with a hex surface a card in that colour: a room tile. A weighted or sized stack clips what does not fit, as a tile does: Disk Space's treemap is a `height` board of `flex` strips of `flex` boxes |
| `text` | `value`, `style` title/body/muted/mono/number/glyph, `size` xs..xl, `weight` regular/medium/semibold, `color` (tag palette, `accent`, `success`, `destructive`, `muted`, `faint`), `width` / `minWidth` px (a column that lines up; a run with a `width` clips instead of wrapping), `align` start/center/end inside it | one run of text; `glyph` draws the value in the bundled symbols font, so a Nerd Font glyph (`\u{f0369}`) stands in a popover or a card as a mark next to text, at the size of `size`, never wrapped (OTP's empty popover carries its message mark this way) |
| `image` | `src` (`icon://…` or `data:image/…`, anything else is not shown), `width`/`height` px, `mask` rounded/circle, `alt`, `dot` (a tag colour) | a picture the extension made or the app's icon scheme serves; with `dot` a presence dot on its bottom-right corner, ringed by the panel: an avatar (green active, grey away, red do not disturb) |
| `tile` | `width`/`height` px, `text`, `sub` (small, under the text), `color` (tag palette, `neutral` (default), `accent`, or a hex colour of the extension's own: `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`), `fill` `solid` (the colour, the panel's background as ink; solid neutral is paper, the elevated surface), `soft` (the tint, the colour as ink; default), `outline` | a rounded box with the tokens' colours, so it follows the theme: a game tile, a keycap of an on-screen keyboard, a stat. The type is tabular, scales with the box, gets heavier as it grows and shrinks to fit the text; under 44 px the box takes the control radius. A hex colour paints the box with itself whatever the fill (a hairline in it for `outline`), takes black or white ink by contrast, and shows a checker through a translucent one: a swatch |
| `gradient` | `width`/`height` px, `fill` (a hex colour under everything), `layers` (each `stops`: two or more hex colours, alpha allowed (`#ffffff00`), spread evenly along `direction` right (default), down, up or left; in paint order, a later layer composites over an earlier one), `marker` `{ x, y }` in 0..1 | a box of CSS linear gradients with the tile radius and, with `marker`, a ring at that point drawn to read on any colour: a hue strip (seven stops round the wheel), the classic saturation/value plane (`fill` the pure hue, white to transparent rightwards, black to transparent upwards) |
| `badge` | `text`, `color` (grey, blue, green, amber, red, violet, pink, teal) | a tag, as on a row |
| `divider` | | a hairline (vertical in a row) |
| `spacer` | `size` px, else the free space | space |
| `progress` | `value` 0..1, `width` px, `color` (tag palette or a hex colour; else the accent) | a bar |
| `slider` | `value` 0..1, `width` px (else the free space), `color` as for `progress`, `label` (for a screen reader) | a level the user sets: a 6 px track with the fill and a round thumb at its end (`role="slider"`). The keys move it through the view's own actions; with `action`, a click runs that action with the clicked fraction as `ctx.values.value` ("0.620") |
| `switch` | `on`, `color` (tag palette; else the accent), `label` | the system's switch pill, the knob slid over when on; with `action` a click runs it |
| `keycap` | `keys` in the shortcut spelling (`h`, `cmd+k`, `up`) | key caps, as in the footer; with `action` a click runs what the cap names |

Two fields every node takes. **`action`**: the id of one of the view's
`actions`; a click (a tap) on the node runs it as its key would, so a
room tile toggles the room and a keycap runs what it names. The node is
drawn as a control (a pointer, a lift on hover), and a `hidden` action
some node runs needs no shortcut. A click inside nested controls lands
on the innermost. **`selected`**: an accent ring on the node's box, the
keys' cursor when arrows walk a grid; one per tree is the idea. Both are
checked (`checkView`): an `action` naming no action of the view is refused.

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

## Live views: push and pull

A view is drawn on open and on every key; a view that follows something
outside the panel (a song's position, a light a switch just dimmed, a
counter) needs to change while nobody presses anything. Two halves, and
they compose:

**Push: `view.update`.** From `@zcag/pal`, `view.update(spec)` replaces
the open level's tree in place, exactly as a `{ view }` answer to a pick
does: the keyed transitions run (`move`, enter, exit), the DOM of a kept
key stays, the text field and its caret are untouched. `spec` is a
`ViewNode` (the tree alone; the level keeps its actions, title, keys and
input) or a whole `View` (those replaced too). Inside `view` or `pick`
the palette is known; from a timer or a stream pass `{ palette }`, and
`{ id }` when the palette's view answers to several things (Hue's light
view is one level per light, its `View.id` the light's id; an update
without `id` reaches whichever is open). Pushes to one level closer than
`VIEW_UPDATE_MIN_MS` (33 ms) coalesce, the last winning, so a stream may
push as it likes. The core drops a push while no such level is open (one
log line per target until one lands), so a loop may run a beat past the
level without harm; still, stop it:

```ts
import { view } from "@zcag/pal";

let timer: ReturnType<typeof setInterval> | undefined;
view.onShown((ev) => {                       // ev: { extension, palette, id } (or { bar } for a bar item's own popover level), compact: true in the popover
  if (ev.palette !== "now-playing") return;
  timer ??= setInterval(() => view.update(tree(position()), { palette: "now-playing" }), 1000);
}, "spotify");
view.onHidden((ev) => { if (ev.palette === "now-playing") { clearInterval(timer); timer = undefined; } }, "spotify");
```

`view.onShown` fires when a view level of yours comes on top of the
panel or the bar popover with its tree in (pushed, or uncovered when a
level over it pops, or the panel shown again with it kept), `view.onHidden`
when it leaves (popped, covered by a palette you pushed, the window
hidden). `view.open()` lists what is open right now, for a stream handler
that pushes into every open level (`for (const ev of view.open()) ...`).
A reload of the extension tells the new module about the levels already
open. `dispose()` still clears the interval: the old module stays
resident.

**Pull: `refresh` and `on`.** On a view palette, `refresh: 5` (seconds,
manifest or code; the manifest wins) makes the app ask `view(ctx)` again
on that cadence while the level is on top, and `on: ["media", "wake",
"network", "show"]` adds triggers (`media`: a track or player change from
the MediaRemote stream, `wake` from sleep, `network` back, `show`: the
panel shown with the level kept). Each answer replaces the tree in place
the same way. A tick while a pick is in flight is skipped (the reply
brings a newer tree). Nothing to write in the code: the palette's `view`
already answers from live state.

**Which to use.** Pull when the state lives elsewhere and a re-read is
cheap and rare (a dashboard every 30 s, a device list on `wake`): no
loop to own, nothing to stop. Push when you already have the change in
hand (a bridge's event stream, a 1 Hz clock you run anyway for the bar
item) or the cadence is faster than a request should be: the tree you
push is the one you would have answered. Both together is the usual
shape: push for the beat, `refresh` as the safety net (Spotify's lyrics
view pushes every second while the song plays, and `refresh: 5` covers
a missed push).

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

## Typed arguments: values in the search bar

A form is a page; a row that just needs a word or two before it runs
declares `args` instead, and the search bar takes them (Raycast's command
arguments). While the cursor rests on the row, one field per argument
appears after the query; Tab moves into them, Escape back to the query,
and Enter runs the row as it always does, with what was typed as
`ctx.values` by id. Nothing costs an extra keystroke: `ssh marko` with an
empty command is one Enter, `ssh marko` + Tab + `uptime` + Enter runs
that. A row of `ssh` that takes a command, a timer that takes a duration
and a name, a chat that takes a message for its Send.

```ts
{ id: "marko", name: "marko", subtitle: "cagdas@marko",
  args: [{ id: "command", placeholder: "Command", required: true }, { id: "shell", placeholder: "Shell", kind: "select", options: [{ id: "zsh", title: "zsh" }, { id: "sh", title: "sh" }] }],
  actions: [{ id: "connect", title: "Connect" }, { id: "copy", title: "Copy host", shortcut: "cmd+c" }, { id: "run", title: "Run there", shortcut: "cmd+r", args: true }] }
// pick("marko", "connect", { values: { command: "uptime", shell: "zsh" } })
```

- An argument has `id`, `placeholder` (its label in the bar), and
  optionally `kind` (`text`, `number`, `select` with `options`,
  `password`, drawn masked), `required` (blocks the run while empty) and
  `default`. Values arrive as strings (`select`: the option id), like a
  form's.
- Which actions take the values: those marked `args: true`; when none
  is, the primary (the first listed, or the default pick). The rest run
  bare, so a chat row's Enter still opens the chat while its `Send
  message` (`args: true`) takes the text. A `required` argument left
  empty blocks only the actions that take it: the field is marked and
  focused, and nothing runs. An optional one left empty arrives as `""`.
- A pick can still arrive without `values`: `pal run
  ext/palette/id?command=uptime` fills them from the link's query, but a
  bare `pal run`, an item hotkey or a pick from a script does not. Answer
  `{ form }` with the same fields then, or run with the defaults.

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
`copy_files`, `open`, `paste`, `focus`, `layout`, `space`, `hud`, `toast` (its title
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
- `empty`: with `hidden`, the shape the user may keep on the strip anyway
  (`{ icon?, title?, tooltip?, menu? }`: the glyph, an honest tooltip such
  as "No unread mail", the same popover). The core's per-item
  `[bar.items."ext/id"] show = "always"` (docs/config.md) draws it muted,
  without badge or segments, in the hidden item's own frame (its
  `icon_size`, `icon_width`, `position`); `auto`, the default, hides.
  The extension never reads the setting: it answers
  `{ hidden: true, empty: { icon, tooltip, menu } }` when it has nothing to
  say and leaves the choice to the core, so every item gets the setting
  without remembering it. Hidden without `empty` hides under either
  setting: signed out, there is nothing to open a popover on. A setting
  that widens what the item computes (slack's `unread`, media's
  `running`) stays the extension's; keeping the item up at all times is
  the core's.
- `icon` (a glyph from the bundled Nerd Font, an emoji, `{ image }`, `{ app }`),
  `title` (short: 64 characters at most, the menu bar does not truncate),
  `segments` (up to 8 extra runs after the title, each `{ id, icon?, text?,
  color?, tooltip? }`; a click on one is the `segment:<id>` action), `badge` (a
  count, or `"dot"`), `color` (the tag palette plus `text`, `muted`, `accent`,
  `destructive`), `urgent` (drawn as an alarm), `stale` (muted, "could not
  refresh"), `progress` (0..1, a thin fill), `tooltip`, `refresh` (seconds until
  the next `render`, this once).
- `states`: the facts the item knows, as `{ name: scalar }`, published
  as `<extension>/<name>` with the render (`power/level`,
  `calendar/phase`): what the manifest's `rules` and anyone's state
  expressions read. `null` withdraws one. Not drawn.
- `menu`: what a click, the item's hotkey or a hover peek opens, always in
  pal's own popover. An array of `BarMenuNode` is a **menu level**: rows
  (`{ type: "item", id, title, subtitle?, icon?, shortcut?, checked?,
  disabled?, style?, action? }`), `section`s (`{ title?, children }`),
  `submenu`s (`{ title, icon?, children }`, 3 deep at most),
  `separator`s; 64 nodes at most. `{ palette: "name", extension?, args? }`
  opens that **palette level**, the panel machinery unchanged.
  `{ view: View }` draws the tree as a **view level**: the same level
  as in the panel (`keys: "actions"`, the text field, the keyed `move`
  transitions), 420 px wide, the popover as tall as its content up to
  480 px and the tree scrolling inside past that. Because it scrolls, a
  popover never omits rows: every row the item knows is in the tree, no
  row cap per section and no "and N more" line. A `{ palette }` naming a
  view palette opens as a view level too (`view(ctx)` asked with
  `ctx.compact`). Without a `menu` the click is `onOpen` and the extension
  answers an Effect. `click: "open"` takes that direct path even when the
  item has a menu (a hover peek still opens the menu); `{ view }`, `{ push }` or `{ show }` in it opens the
  popover on that level.

**The manifest.** `bar.<id>` next to `palettes`, so the settings window
lists the item without running the code:

```json
"bar": {
  "notifications": { "title": "Notifications", "description": "Unread count", "refresh": { "every": 300, "on": ["show", "wake", "network"] } }
}
```

**Rules.** `rules` next to `refresh`: how the item draws by its facts,
decided by the core at draw time and overridden by the user by id
(docs/config.md, "Rules"). An item states what it knows in `states` and
leaves presence, urgency and colour to its rules; the settings that used
to pick a threshold or a colour go with that:

```json
"rules": [
  { "id": "fine", "when": "not power.charging and power.level >= 50 and not power.alert", "description": "Plenty left, nothing wrong.", "hidden": true },
  { "id": "low", "when": "not power.charging and power.level <= 20", "description": "Getting low.", "color": "amber" },
  { "id": "critical", "when": "not power.charging and power.level <= 10", "description": "Nearly out.", "color": "red" }
]
```

Each rule: `id` (unique in the item, lowercase letters, digits, `_`),
`when` (a Jinja state expression; the item's own facts are
`<extension>.<name>`), a `description` for the Settings pane, and what it
does while it holds: `hidden`, `urgent`, `position`, and the `[bar.items]`
appearance keys (`color`, `size`, `icon`, `show_title`, `dim`, `font`,
`width`, ...). In order, later wins. A rule that does nothing is a load
warning. A hidden rule takes the same path as `hidden: true` from the
render: `show = "always"` keeps the `empty` shape, so a render that may be
hidden by a rule answers `empty` too. The render keeps running while a
rule hides the item (its facts come from the render); the user's
`show_when`/`hide_when` are what hold an item off without one.

`refresh.every` is seconds between renders (10 at least), `on` adds
triggers: `show` (the panel shown), `wake`, `network` (back online),
`focus` (the front app changed), `minute`, `state:<name>` (that state's
value changed; `state:*` any state, or a hold or reset by hand: below,
"States"). The core renders every item
once at load and whenever the extension's settings change. The user's
`[bar.items] show_when`/`hide_when` (docs/config.md) holds an item off
the strip by a state expression without a render; the flip back renders
once with reason `state`. `keys`, as on
a palette (`[{ "keys": "space", "title": "Pause" }]`), is the key table
of the item's own `{ view }` popover for the store and the settings
window.

**The code.** `bar.<id>` in the default export, next to `palettes`:

```ts
export default defineExtension({
  palettes: { /* ... */ },
  bar: {
    notifications: {
      render: async (ctx) => {                    // ctx.reason: load | every | show | wake | network | focus | minute | settings | update | cli | open
        const n = await notifications();          // the palette's own loader, one cache
        if (n.length === 0) return { hidden: true, empty: { icon: "\u{f09b}", tooltip: "No unread notifications", menu: [] } };  // what `show = "always"` keeps
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
      onOpen: async (ctx) => ({ copy: code }),    // no `menu`, or `click: "open"`
      onShown: async (ctx) => { /* the popover opened (a peek counts): warm a cache */ },
    },
  },
});
```

- `render(ctx)` returns a `BarItem`, sync or async. `ctx.reason` says why
  (the manifest's timer is `every`; a push asking for a render is
  `update`; a click that opened the popover is `open`), `ctx.anchor` where
  a click came from (`menubar`, `sketchybar`, `hotkey`, `cli`),
  `ctx.compact` that what the call answers is drawn in the popover (set
  on every bar call today: 420 px wide, so a `{ view }` lays out for that
  width; a `view(ctx)` or `pick` reached from the popover gets
  `ctx.compact` on its `Ctx` the same way). The host
  checks every answer (`checkBarItem`, the limits above, no `pal:` action
  ids, a `{ view }` menu through `checkView`); over the limits is an
  error the core marks the item `stale` with.
- `onAction(action, ctx)` and `onOpen(ctx)` answer an `Effect` like
  `pick`: `open`, `copy`, `hud`, `push` (drill into a palette in the
  popover), `view`, `form`, `keep` (re-render the item, the popover stays).
  `settings.get()` works inside all of them without an argument. From a
  `{ view }` popover every action is `onAction` with the action's id: a
  key of the view, Enter on the first listed action, a click on a node
  carrying `action`. What a control read rides in `ctx.values`: the
  view's text field on Enter (`input`), a form's fields by id, a
  slider's clicked fraction (`value`).
- `bar.update(id, item)` in `@zcag/pal` **pushes** an item from the
  extension's own side, for a webhook, a file watcher or a poll it runs
  itself: the core draws it as if `render` had answered. `bar.refresh(id)`
  asks for a `render` with reason `update`. From a timer or a watcher
  (outside `render`/`list`/`pick`) pass the extension's name as the last
  argument, as for `storage`. A push is checked like a render answer.
- **A live popover.** A `{ view }` level in the popover is a view level
  of the item's own: `view.update(tree, { bar: "<item id>" })` replaces
  its tree in place (the strip untouched; `bar.update` re-renders the
  whole item, popover included, and is the call when the strip changes
  too), and `view.onShown`/`view.onHidden` fire for it with `{ bar }` and
  `compact: true` when the popover opens on it (a peek counts) and when
  it closes: the "popover closed" signal `onShown` never had. A
  `{ palette }` level naming a view palette is that palette's level, with
  `{ palette }` in the notifications and `compact: true`. See "Live
  views" above.
- An extension that runs an interval or a watcher for its pushes declares
  `dispose()` on the default export: the host calls it before the
  extension is reloaded or removed, since the old module stays resident
  and would keep pushing otherwise.

**The bundled items**, each in the extension that already owns the
data, so the strip and the palette share one loader and one cache. Every
popover is a `{ view }` level laid out for 420 px (`extensions/<name>/view.ts`,
Hue's `popover.ts`: a pure `render(state)` the gallery draws too), with
`keys: "actions"`, a keycap hint row, the cursor as a `selected` ring the
arrows move and a click sets, and the strip untouched:

- **Hue, `home`** (`extensions/hue/`): the main room's colour as a dot and
  the count on the strip. The popover: a status row (lights on, the motion
  and temperature sensors as badges, a bridge that is away), the rooms as
  a grid of tiles in their lit colour with a switch, the count and a thin
  brightness bar (a tap toggles, the chevron opens the room's lights
  inline, each with a slider a tap sets), the scenes as five-swatch tiles
  on the digits, `e` everything on, `x` all off. Follows the event stream
  (a `bar.update` at most every 300 ms redraws strip and popover).
- **Spotify, `playing`** (`extensions/spotify/`): the cover, the titles, a
  progress row ticking every second while shown, the lyric line playing
  with its neighbours, the transport and state keycaps, the queue's next
  two as rows (a click skips to one).
- **Timer, `timer`** (`extensions/timer/`): a card per timer with the
  time left large and a progress bar in the strip's colour, `space`
  pause/resume/dismiss, `+` five minutes, `backspace` stop, `n` a text
  field (`25m tea`) whose Enter starts one (`ctx.values.input`), the last
  durations as tiles. Ticks every second while shown.
- **Calendar, `upcoming`** (`extensions/calendar/`): today's events as
  rows (a time column, the calendar's colour bar, "in 12 min" / "ends in
  24 min", the running one on a card), a Join tile on rows with a call,
  all-day events as badges, tomorrow folded under a header (`t`), `o` the
  calendar, a 30 s tick from the cache while shown.
- **Slack, `unreads`** (`extensions/slack/`): a section per kind (direct
  messages, mentions, threads) with avatars fetched into data urls, the
  latest line and a count badge; Enter opens, `r` a reply field whose
  Enter posts `ctx.values.input`, `m` marks read, `a` all read; quiet
  channels as badges. Urgent while a direct message waits.
- **GitHub, `notifications`** (`extensions/github/`): the unread threads
  grouped by repository with a colour rail per subject type, a reason
  badge and the age; Enter / `o` marks read and opens, `m` marks read,
  `a` all read, `p` the palette; a height budget keeps six or so rows and
  says how many more are in pal. Hidden at zero and signed out.
- **Now Playing, `now-playing`** (`extensions/media/`): the cover large
  (the stream's picture, a cover url fetched once, else the app's icon),
  the titles, a progress row ticking while shown, `space` / arrows /
  `c` / `o` keycaps. Hidden while nothing plays.
- **Verification Codes, `latest-code`** (`extensions/otp/`): the newest
  code as digit tiles with the sender and a bar counting the minute
  down, Enter copies (concealed), `p` pastes, the two before as rows a
  click copies. The item leaves when the minute ends.
- **States, `forced`** (`extensions/states/`): the states held by hand
  with the time left on the soonest to expire; hidden while none is.
  `on: ["state:*"]`, so a hold or a reset redraws it at once.
- **Stats, `cpu`, `memory`, `disk`, `network`, `load`**
  (`extensions/stats/`): five items off one 3 s sampler that pushes them
  all (`bar.update`, the core's `every` floor being 10 s), each stating
  its facts (`stats/cpu`, `stats/memory_pressure`, `stats/disk_free`,
  `stats/net_down`, ...) and hidden by its manifest rules while quiet.
  The popovers: per-core bars and the busiest processes with a Kill key,
  the memory segments and the largest, a card per volume (`Enter`
  reveals), every interface with its rates and address, the load tiles,
  each with a sparkline of the last 60 samples as an SVG `image` in the
  theme's ink. `ps` runs every tick only while a process popover is open.
- **System, `awake`** (`extensions/system/`): a coffee and what is left
  of a keep-awake run (`∞` without an end), hidden while off; the popover
  a card with the time left and a bar, the presets as tiles on the
  digits, the display switch, `u` a field for `45m` or `14:30`, Enter
  allows sleep. Ticks at the moments the countdown's text changes. The
  run is `caffeinate` with its own `-t`, found back by pid after a host
  restart.

## States

`state` in `@zcag/pal` reads and feeds the named variables of `[states]`
(docs/config.md, `docs/design/states.md`): what the user declared,
the built-ins (`hour`, `weekday`, `front_app`, `network`, `theme`,
`locked`, `idle`, `panel`, ...), and what other extensions published.

- `state.get(name)`: the resolved value (a JSON scalar; `null` unknown or
  no such state); `state.get()` every state by name.
- `state.set(name, value)`: publish `<me>/<name>` (`sessions/working`
  from `sessions`; the instance key for an instance of a `multi`
  extension). `null` withdraws it. An extension feeds only its own
  prefix; the user composes it into a state of theirs with an expression
  (`sessions.working > 0`). Declare what you publish under `states` in
  `pal.json`. From a timer or a watcher pass the extension's name as the
  last argument, as for `storage`.
- `state.onChange(name, cb)`: `cb(value)` when that state's resolved
  value changes; `state.onChange(cb)`: `cb({ name: value })` on every
  change. Returns the unsubscribe. Only a resolved value moving fires
  it; a hold at the value a state already had does not.
- `state.list()`: every state as the palette lists it (`StateEntry`:
  value, source, `until`, `expr`, `description`, `error`, `declared`,
  `builtin`); `state.eval(expr)`: what a Jinja expression reads now.

A bar item that follows a state re-renders on `state:<name>` in its
`refresh.on`; the user's `show_when`/`hide_when` on the item hides it
without a render. The bundled `sessions` publishes `working` and
`waiting` (its counts) at every render.

## Storage

`storage` in `@zcag/pal` is a small per-extension key-value store:
`get(key)` (null when unset), `set(key, value)` (any JSON; null removes),
`remove(key)`, `keys()`. The core keeps one file per extension (per
instance of a `multi` one: `gmail@work.json`),
`<data dir>/pal/storage/<extension>.json` (`~/Library/Application
Support/pal/storage/` on macOS, `~/.local/share/pal/storage/` on Linux),
written whole and atomically on every change and shared by every config
profile. It is capped at 256 KB serialised: a `set` that would cross the
cap rejects and nothing is written. For a bankroll, a cursor, a last-used
choice; not for a cache. Which extension is asking is known inside
`list`/`pick`/`view` and at import time; elsewhere pass the name as the
last argument.

## The `@zcag/pal` package

`import { ... } from "@zcag/pal"` is pal's extension API: the calls into the
core and the types of everything above. It lives in `sdk/` in the repo and is
the package of that name on npm (not published as of this writing; "Writing one"
below links it from a checkout). The host links it into
`<root>/node_modules/@zcag/pal` in the store and in every `extension_dirs` root,
so the name resolves for an extension there without a fetch (the host runs Bun
with `--no-install`). An extension that carries its own copy in `node_modules`
(a `bun add`) gets that one instead, which works the same: the package reaches
the host through a process-wide slot, not a shared module, so the version in
your `node_modules` only has to speak the same wire. Every call is one request
to the core.

- `settings.get<T>()`: the extension's values, `[extensions.<name>]`
  (the instance's, for an instance of a `multi` extension: "Instances"
  above). `settings.palette<T>()`: the current palette's declared values.
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
  A hint row that asks the user to set one opens Settings on that row:
  `{ open: "pal://settings/extensions?anchor=extensions:<key>:<id>" }`
  (`instance().key` for `<key>`, so a second account lands on its own
  table; [Links](links.md)), the row lit as a search hit is.
- `instance()`: which instance of the extension this code runs as,
  `{ key, name, title, isDefault }` ("Instances" above); the bare name as
  `key` and `isDefault: true` for an extension without `multi`.
- `clipboard.list({ query, kind, limit, offset })`, `get(id)`,
  `current()` (the newest entry, or null), `pin(id, pinned = true)`,
  `rename(id, name)` (a name that titles the entry and is searched like
  its text, `ClipboardEntry.name`; `null` or blank clears it),
  `delete(id)`, `clear()`, `copy(id)` (back onto the clipboard),
  `imageUrl(id, size)` for an image entry.
- `thumbnailUrl(path, size)`: an image file on disk as the webview loads
  it (`icon://localhost/file`): a thumbnail fitted into `size` px, or the
  file itself for 0 (a PNG or a JPEG). PNG, JPEG and GIF by extension,
  absolute paths only; anything else is a 404 and the row keeps its
  glyph. A screenshot's row, a browsed folder's pictures.
- `windows.list()` (every window, most recently used first on macOS and
  Hyprland, `Window`: `id`, `app`, `title`, `bundle_or_class`, `pid`,
  `minimized`, `hidden` (the app is hidden, macOS), `on_screen`,
  `monitor`, `workspace`, `icon`), `focused()` (the window with keyboard
  focus, the app behind the panel), `activate(id)` (the window's app to
  the front, unhidden, the panel hiding as it comes up; its name),
  `close(id)`, `minimize(id)`, `frame(id)` (a
  `Rect`: `x`, `y`, `w`, `h`), `setFrame(id, rect)`, `displays()`
  (`Display[]`: `id`, `frame`, `visible_frame`, `primary`), `layout(req)`
  (a `WindowLayoutRequest` run now, the panel up; from `pick` prefer the
  `layout` effect), `spaces()` (every Space, workspace or desktop in the
  desktop's order, `Space`: `id`, `index` (the number the desktop shows),
  `name` (Hyprland's or Sway's), `current`, `previous` (left most
  recently), `fullscreen`, `monitor`, `windows` (ids from `list()`)),
  `goSpace(id)` (the space in front now; from `pick` prefer the `space`
  effect, which hides first). Focus is the `{ focus: id }` effect from
  `pick`, so the panel hides first.
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
- `extensions.list()`: every extension the app knows, as
  `{ name, version, root, loaded, store, bundled }`: `store` for one
  `pal install` put in the user store (updatable, removable), `bundled`
  for one that ships with pal. `extensions.install(spec)`,
  `extensions.update(name)`, `extensions.remove(name)` hand the work to
  the `pal://install`, `pal://update` and `pal://remove` routes and
  resolve at once: the store restarts the host your code runs in, so no
  reply could follow the work. No card is shown (ask through
  `Action.confirm` first); the HUD says "Installing…" and the outcome,
  and an install reopens the root with the name typed. What the Store
  palette is built on.
- `selection.text()`: the text selected in the app in front, or null.
  The accessibility API first (`AXSelectedText` of the focused element on
  macOS, the primary selection on Linux); when that answers nothing and
  `general.selection_snapshot` allows (the default), the copy shortcut is
  sent and the clipboard read and put back as it was, with pal's own
  history looking away. Rejects on macOS without Accessibility (the
  prompt is shown once per run). Reading it from `pick` works: the panel
  does not take the selection from the app behind it. The Snippets
  palette fills `{selection}` with it.
- `selection.files()`: the files selected in the file manager in front,
  as absolute paths in its order (`string[]`, never rejects). macOS:
  Finder's marked items, the front window's or the Desktop's, over
  `osascript`, and only while Finder is the app in front; a folder shown
  with nothing marked is nothing, not the folder. Empty otherwise, and on
  Linux, where no file manager exposes its selection portably. Read once
  per panel show and cached like `dialog.current()` (~190 ms on hornet,
  1 ms when Finder is not in front), so a `suggest`, a listing on every
  keystroke and a `pick` inside the palette share one read and all see
  what was marked when the panel came up. The Files palette's
  "Selected in Finder" section, System's Quick Look row and the Images
  palette's inputs read it; `{files}` in a snippet or a quicklink fills
  it in.
- `textAtHand()`: what a palette opened with nothing typed should work
  on: the selection (a failed read counts as none), else the clipboard's
  text (`clipboard.current()`, or the newest text entry), trimmed, as
  `{ text, where: "selection" | "clipboard" }` or null; one read per
  `TEXT_AT_HAND_TTL_MS` (2 s) across calls, so an `input` palette may ask
  on every empty listing. Translate and Turkish start from it.
- `dialog.current()`: the open or save panel in front, or null (the
  `dialog` effect types a path into it).
- `permissions.status()` (`Permissions`: `accessibility`, `calendar`,
  `full_disk_access`, `input_monitoring`, `location`; a boolean or a
  `granted` / `denied` / `not_determined` / `restricted` / `unavailable`
  state) and `permissions.request(which)`: the system prompt while the OS
  still has one to show, else the System Settings pane. Honoured only
  while the user is looking at your extension: inside one of its palettes
  (a listing at startup, a relist on a show or a background refresh never
  prompts; the ask is skipped and logged, `permissions<TAB>location<TAB>
  skipped`), or from a `pick` (Enter on a row that offers it, wherever
  the panel is). Ask lazily, from the listing that needs it, only while
  `not_determined`, and give the palette a hint row whose pick asks too,
  so a user who lands in the palette after the held-back listing has a
  way in: the prompt is modal. The hint row says what the permission is
  for in pal's words ("Wi-Fi names need Location access: macOS shows
  them only to an app with it"), since the system prompt says little and
  pal asks nothing at launch. What the Wi-Fi palette does for `location`.
- `calendar.permission()`, `request()` (the Calendars prompt on macOS),
  `openSettings()`, `calendars()` (`Calendar[]`: `id`, `title`, `color`,
  `source`, `writable`), `events(from, to, calendars?)` (unix ms;
  `CalendarEvent[]` with `start`, `end`, `all_day`, `location`, `notes`,
  `url`, `calendar`, `attendees`, `organizer`, `conference_url`,
  `recurring`, `my_status`, and `occurrence` on a recurring one),
  `create(event)` (a `NewCalendarEvent`; resolves with the id),
  `delete(id, occurrence?)`, `open(id, occurrence?)`. EventKit on macOS,
  `khal` on Linux (no delete or open there). What the Calendar extension
  is built on.
- `ocr.image({ path })` or `ocr.image({ data })` (base64 bytes): the text
  in an image, lines top to bottom, an empty string for none; a PDF is
  its first page (`pdftoppm` when installed, else `sips` on macOS). The
  Vision framework on macOS (accurate level, language detected),
  `tesseract` on Linux when installed; `ocr.available()` says, and
  `image` rejects with "OCR unavailable" otherwise. Waits up to 30 s
  (`OCR_TIMEOUT_MS`).
  The Clipboard History and Files palettes offer it on images.
- `conceal(text, clearAfter?)`: the `CopyText` for a secret (above);
  `CONCEAL_SECONDS` (30) is the default clear.
- `expand(text, sources)`: the placeholder grammar every text pal fills
  in shares (`sdk/src/placeholders.ts`): `{clipboard}`, `{selection}`,
  `{files}` (the Finder selection's paths one per line, or joined by
  `sep=`), `{date}`, `{time}`, `{datetime}` (each with `format=` over the
  tokens `YYYY YY MM DD HH mm ss ddd MMM` and `offset=+1d` / `-2w` /
  `+3h` / `-90m`), `{uuid}`, `{cursor}` (dropped), `{snippet name=...}`
  (one level deep); anything else in braces stays. `sources`
  (`PlaceholderSources`): `clipboard()` (read once, only when asked),
  `selection?()` (the clipboard when null or throwing), `files?()` (empty
  when throwing), `now?()`, `uuid?()`, `snippet?(name)`; each optional
  one absent leaves its placeholder as written. `hasPlaceholders(text)`, `formatDate(d,
  format)`, `offsetDate(d, offset)`, `isoDate(d)`, `isoTime(d)`,
  `FORMAT_TOKENS`, `PLACEHOLDERS` come with it. Snippets pastes with it,
  Quicklinks fills a url with it (the values percent-encoded through the
  sources), Obsidian appends with it.
- `home(path)`: a leading `~` expanded. `core.call(method, params)`: the
  raw bridge.
- `xdg(name)`: a freedesktop icon name as the glyph the app draws it with
  (`icon: xdg("dialog-error")`), undefined for a name it does not know.
- `bar.update(id, item)`: push a bar item now (above, "Bar items");
  `bar.refresh(id)`: ask for a render.
- `state.get(name?)`, `state.set(name, value)`, `state.onChange(name?,
  cb)`, `state.list()`, `state.eval(expr)`: the states (above, "States").
- `view.update(spec, { palette?, bar?, id? })`: push a tree into an open
  view level (above, "Live views"); `view.onShown(cb)` / `view.onHidden(cb)`:
  a level of yours came on top or left; `view.open()`: the levels open now;
  `VIEW_UPDATE_MIN_MS` (33): the coalescing window.
- `checkView(view)`, `checkForm(form)`, `checkBarItem(item)`,
  `checkEffect(effect)`, `checkIcon(icon)`: what the host runs on every
  answer (the limits above: `MAX_NODES`, `MAX_DEPTH`, `MAX_BAR_TITLE`,
  `MAX_BAR_SEGMENTS`, `MAX_BAR_MENU_NODES`, `MAX_BAR_SUBMENU_DEPTH`,
  `MAX_TILE_SVG`, `MAX_BADGE`; `SHELL_PREFIX` is the reserved `pal:`),
  for an extension's own tests; `shortcutsOf(action)`: an action's keys
  as a list. `checkPalettes(manifest, ext)`: the manifest against the
  code ("Where a palette is described"), `{ metas, warnings }`;
  `kindOf(p)`: the kind a palette implies (`PALETTE_KINDS` lists them,
  `isViewPalette(p)` tests one); `paletteMeta(name, p, manifest)`: what
  the host announces for a palette; `instanceTitle(title, instance)` and
  `stripInstance(title)`: the `{instance}` rule above. `checkLinks`,
  `checkLinkParams`, `checkLinkEffect` and the tables `LINK_PARAM_TYPES`,
  `LINK_EFFECT_REFUSED` are the links' ("Links: routes of your own");
  `VIEW_TRIGGERS` the `on` names. `defineExtension(ext)` and
  `defineExtension(manifest, ext)`: the typed default export.
  `storage.LIMIT` is the 256 KB cap; `XDG_ICONS` the table `xdg` reads.
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
  `setPower(on)`. CoreWLAN in-process, `ipconfig` and `networksetup` on
  macOS, `nmcli` on Linux.
- `media.nowPlaying()` (`players`: `MediaPlayer[]` with `id`, `name`,
  `state`, `title`, `artist`, `album`, `artwork`, `url`, `app`,
  `position`, `duration`, playing first; `system_wide`: whether a
  system-wide source is there: the bundled MediaRemote adapter or
  `nowplaying-cli` on macOS, `playerctl` on Linux; `unasked`, macOS: the
  running players macOS has not been asked about, `{ id, name, app }`
  each, since a listing never fires the Automation consent alert),
  `control(player, command)` (`play_pause`, `play`, `pause`, `next`,
  `previous`; the panel stays up), `ask(player)` (macOS: the consent
  alert for `spotify` or `music`, from a pick only; true once allowed).
  Spotify and Music over AppleScript plus the system's Now
  Playing as the `system` player on macOS (a title-less player with a
  state is one that reports no track, Chrome for one), `playerctl` on
  Linux.
- Keycast, the feature ([Features](features.md#keycast)), through the
  raw bridge: `core.call("keycast.status")` answers `{ available,
  reason?, active, mode, input_monitoring, settings }`,
  `core.call("keycast.start", { mode? })`, `"keycast.stop"` and
  `"keycast.toggle", { mode? }` (`keys`, `cursor`, `both`) drive the
  overlay and answer the same status. The feature publishes
  `keycast/active` and `keycast/mode` as states.
- Snippets, the Text expansion feature's ([Features](features.md#text-expansion)):
  `core.call("snippets.list")` answers the stored list (`[{ id, name,
  keyword?, text }]`), `core.call("snippets.set", { snippets })`
  replaces it. The bundled Snippets palette is built on these.

### Shared helpers

The helpers the bundled extensions share, on the same import (`sdk/src/rows.ts`,
`text.ts`, `exec.ts`, `token.ts`, `png.ts`, `image.ts`, and the namespaces):

- Rows: `hint(id, name, subtitle?, { icon?, actions?, section? })`: an inert
  row that tells the user something (`hint:` prefixed, no actions, the
  `HINT_GLYPH` information mark unless an icon is given); `toast(title,
  message?, style?)` and `failed(what, error)` ("Could not <what>" with the
  error's message): a pick's answer with the panel kept open. For a view:
  `text(value, extra?)`, `row(children, extra?)`, `column(children, extra?)`
  (stacks, two steps of gap), `keycap(keys, action?)`, `keyHint(keys, what,
  { action?, size? })`: keycaps then a muted caption, the footer line;
  `POPOVER_W` (396), the width a bar popover's view measures fixed widths
  against.
- Text: `bytes(n)` ("3.2 KB", "1.5 MB", "1.50 TB"), `truncate(s, n)` (an ellipsis as the
  last character), `oneLine(s)` (whitespace runs as one space, invisible
  characters such as a mail preheader's zero-width joiners out), `slug(s)`,
  `appName(bundleId)` (`com.google.Chrome` as "Chrome": a small table, else
  the last segment; what a clipboard entry's `source_app` reads as),
  `errorMessage(e)` (an Error's message, else the value as text),
  `mdEscape(text)` (plain text as markdown that reads as the text, links
  left whole).
- Paths: `home(path)` above, and `tilde(path)`, its reverse for subtitles.
- Time: `now()`, unix ms; `PAL_NOW` (`2026-09-16T10:30:00`, local to `TZ`)
  pins it, so a test fixes the day and the hour. Every read of the time in
  an extension should go through it. Reading a duration: `parseDuration(s)`
  (`90s`, `25m`, `1h30m`, `1d`, a bare number as minutes; seconds, or
  `undefined`), what States' holds and System's Keep Awake read. Writing a moment: `clock(t)` (`14:05`,
  24 h), `dayName(t)` (`Fri 18 Sep`), `dayNameYear(t)`, `isoDay(t)`
  (`2026-09-18`), `when(t)` (the clock alone today, the day before it
  on another day, the year in another year) and `ago(t)` (`just now`,
  `23 s ago`, `5 min ago`, `2 h ago`, `3 d ago`, `2 w ago`, `5 mo ago`,
  `1 y ago`, `in 2 h`; `ago(t, { short: true })` is `now`, `5m`, `2h` for a
  narrow column or the bar; `{ now }` fixes the reference), all local and
  hand-formatted:
  the host runs under whatever locale launchd gave it (`en-US` on a
  machine set to `en_TR`), so `toLocaleString` puts the month first and an
  AM/PM on a user whose clock says 14:05. Use these for a row's subtitle
  and a pane's metadata; a `{ date }` accessory stays a raw instant (the
  UI draws it relative).
- Processes: `exec(argv, { ms?, cwd?, stdin?, env? })`: `{ code, out, err,
  timedOut }`, killed after `ms` (`EXEC_MS`, 10 s); `run(argv, opts)`:
  stdout, or a throw with stderr, the exit code, or "<program> did not
  finish in N s". `listProcesses()`: the process table as `Proc[]` (`pid`,
  `ppid`, `uid`, `cpu`, `rss` in KiB, `comm`, `name`) from one `ps`
  (`PS_ARGV`, `parsePs(out)`); what Processes lists and Stats ranks.
- Tokens: `parseToken(out, now?)`: the bearer token a command printed (a
  bare line, or JSON with `access_token` and its expiry) and when it stops
  being good; `mintToken(command, now?)` runs it through `sh -c`, a
  `TokenError` (`stderr`, `code`) when it printed none. Calendar's and
  Gmail's accounts are built on it.
- Pictures: `pngSize(head)`: `{ width, height }` off a PNG's first 24 bytes;
  `imageData(url)`: a picture on the web as a data url for an `image` node,
  fetched once and kept (`forgetImages()` for tests); `copyImage(path,
  fmt?)`: a PNG or JPEG file onto the clipboard as an image (AppleScript's
  `«class PNGf»` / `«class JPEG»` on macOS, `wl-copy` or `xclip` on
  Linux), true when it landed, false for any other format so the caller
  falls back to `copy_files`. Images and Immich copy pictures with it.
- `terminal`: a terminal window: `terminal.open(cmd, want?, cwd?)` /
  `terminal.argv(...)` run a command in a fresh window (the app by name or
  found in /Applications, `$TERMINAL` or the first installed on Linux),
  `terminal.at(cwd, name)` / `terminal.on(tail, ...)` open a shell in a
  folder; `terminal.linux()`, `terminal.linuxArgv()`, `terminal.quote()`.
- `files`: the rename, move and copy forms and their submits
  (`renameForm`, `moveForm`, `copyForm`, `renamePick`, `intoFolderPick`,
  `moveTo`, `copyTo`), `archive(paths)` (`ditto` / `zip`),
  `quickLook(paths)` (`qlmanage -p` detached, macOS; false elsewhere).
- `md`: markdown to the view tree: `md.render(text, { width?, maxNodes?,
  padding?, shift?, dropTitle?, where? })`, `md.parseBlocks`, `md.inline`,
  `md.frontmatter`, `md.outline`, `md.plain`, `md.excerpt`.
- `colors`: colour maths (parse any CSS colour, the conversions, tints and
  shades, harmonies, contrast, the nearest name, a swatch); the sampler is
  `color`.
- `tabs`: the browsers' open tabs: `tabs.active()`, `tabs.find(url)`,
  `tabs.focus(tab)`.

The protocol's types ride along: `Extension`, `Palette`, `Item`,
`Accessory`, `Metadata`, `Action`, `Icon`, `TileIcon`, `TintedIcon`,
`TileColor`, `Effect`, `CopyText`, `WindowLayout`, `WindowLayoutRequest`,
`WindowLayoutOptions`, `Ctx`, `Detail`, `View`, `ViewNode`, `ViewInput`,
`ViewTrigger`, `ViewShown`, `Transition`, `Form`, `FormField`,
`FormValues`, `BarItem`, `BarMenu`, `BarMenuNode`, `BarSegment`,
`BarColor`, `BarCtx`, `BarSource`, `InstanceInfo`, `Manifest`,
`ManifestPalette`, `ManifestBar`, `ManifestLink`, `SettingSpec`, and the
API's own (`ClipboardEntry`, `ClipboardListOpts`, `Window`, `Rect`,
`Display`, `Applied`, `SystemCommand`, `App`, `InstalledExtension`,
`AudioDevice`, `BluetoothDevice`, `WifiStatus`, `WifiCurrent`,
`WifiKnown`, `WifiNetwork`, `WifiScan`, `WifiScanMode`, `MediaPlayer`,
`NowPlaying`, `MediaCommand`, `Permissions`, `PermissionId`,
`PermissionStatus`, `Calendar`, `CalendarEvent`, `CalendarStatus`,
`Attendee`, `NewCalendarEvent`, `Color`, `Dialog`, `SettingWrite`,
`ViewUpdateOptions`).

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

2. The API, for the editor. `@zcag/pal` is not on npm, so link it from
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
   import { clock, defineExtension, settings, type Item } from "@zcag/pal";

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
         pick: (id) => (id === "greet" ? { copy: `${settings.get<Settings>().greeting}, world` } : { toast: { title: clock(Date.now()) } }),
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
   it, the rows in the panel following on the next open. `⌘R` in the
   panel lists it again by hand.

The example's full form (three rows, a setting with a description, the
manifest's `palettes` block) is `examples/hello-extension/`. Install it
from a checkout with `pal install path/to/pal/examples/hello-extension`,
or from GitHub with `pal install github:zcag/pal/examples/hello-extension@main`;
change the greeting under Settings › Extensions › Hello and the row follows.

## Trust

An extension is code that runs with your user's rights inside the host.
There is no signing and no vetting: install what you would run from a
terminal. `bun install` also runs the dependencies' install scripts.
