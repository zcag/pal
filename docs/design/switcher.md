# Switcher and sidebar

Design spec, 2026-09-21. Two ways to reach a window without typing: a
hold-modifier switcher (Cmd+Tab's shape, over pal's rows) and a sidebar
(a live palette pinned to a screen edge, rows numbered so one chord picks
one). Both are built on what the tree has: the panel and its keys, the
bar popover's state machine and window, the `windows` capability. The
reference behaviours are Contexts and AltTab; the mechanism is pal's, so
neither is tied to windows: any palette can be held or pinned, windows
is the one that ships wired. Status: implemented 2026-09-21 (the
`switcher` branch), verified on hornet with a scratch instance: the real
chord end to end, the MRU order, the sidebar's hotkey, `cmd+N` and the
edge strip's peek.

## Goals and non-goals

- Release to switch. `opt+tab` shows the windows palette with the cursor
  on the *previous* window; another `opt+tab` steps down, `shift+opt+tab`
  up, letting go of `opt` focuses the row under the cursor. Typing
  filters as it always does; Escape cancels.
- The order is most recently used, flat, across every space and display,
  because the switcher's promise is "row 2 is where I just was". The
  palette lists in that order for everyone (typed searches rank on
  match, so they lose nothing).
- Hidden is a state of its own. A hidden app's windows read `hidden`,
  not `other space`, and there is a Show app action.
- A sidebar is a live palette docked to a screen edge: it peeks when the
  pointer rests at the edge, engages on click, hotkey or a key, and every
  row carries its number so `cmd+3` (engaged) runs row 3 without a
  search. One sidebar for now, its palette from the config; off until a
  palette is named (an edge that peeks is asked for, never shipped on),
  windows is the one built for it.
- No new permission for the default paths. Modifier release is read from
  `NSEvent.modifierFlags`, which any process may; the edge peek comes
  from a strip window pal owns. What needs Input Monitoring (a key
  engaging a *peeking* sidebar) degrades exactly as the popover's peek
  does today (`bar/popover.rs`).
- Non-goals now: window thumbnails; more than one sidebar; a sidebar on
  Linux (no popover window there yet, `bar::SUPPORTED`); an `AXObserver`
  for focus changes inside one app (below, MRU). Replacing Cmd+Tab itself
  was one (the Dock owns it) until the tap round below: `hold =
  "cmd+tab"` goes through a `CGEventTap`, gated on Input Monitoring like
  snippet expansion, never the default.

## MRU order and hidden state (`pal_core::windows`)

`Window` gains `hidden: bool` (`NSRunningApplication.isHidden` of the
pid; Linux false) and `list()` returns most-recently-used first on
macOS the way Hyprland already does (`focusHistoryID`): a focus history
in the core (`windows::note_focus(id)`, a bounded `VecDeque<(id, Instant)>`)
sorts the windows it knows by recency, the rest follow in CG's front to
back order. Stamps come from three places, all app-side, none needing a
new observer kind:

- `NSWorkspaceDidActivateApplicationNotification`: the observer bar
  triggers already install (`bar/mod.rs` `triggers::macos`) also reads
  `windows::focused()` and stamps it. (The states branch adds a second
  observer for `front_app`; merge into one when both land.)
- The panel's show (`lib::show_in`, before `index::on_shown` relists):
  stamps `focused()`, which is the window the user was in when they
  pressed the hotkey: row 1.
- `windows::focus(id)` itself stamps its target, so a pick is the next
  "previous".

Focus changes inside one app (cmd+` in Chrome) are missed until the next
activation; the AXObserver that would catch them is a later round if it
bites. The extension: a `hidden` tag, `Show app` (`windows.activate`,
which already unhides), the README's "No ranking" paragraph replaced.

## The switcher

### Config

```toml
[palettes."windows/windows"]
hold = "opt+tab"          # the chord; "" turns it off; the windows manifest suggests this default
```

`hold` is a palette key like `hotkey` (Settings › Palettes edits it,
`palettes.<id>.hold` in the schema). The windows manifest suggests
`opt+tab` (`palettes.windows.hold` in `pal.json`, applied when the config
has no `hold` line; `""` in the config turns it off). Registered as
`Target::Hold(key)` with the chord and its `shift+` variant; a clash
with a root or palette hotkey loses to them, in the existing order.

### Mechanics (macOS)

- Press, switcher idle: `switcher::begin` stamps the focused window and
  starts a 150 ms show timer (`SHOW_AFTER`); nothing is painted. A press
  before it fires counts a step (the shift variant one back). The timer,
  with the chord still held, runs `show_hold(key, steps)` with `hold:
  true` and `steps` in the `pal://shown` payload. The page opens the
  palette with the cursor on row `2 + steps` (wrapping), sections off (a
  flat MRU list; `groupBySection` is skipped while a hold is on), the
  search field empty with the palette's placeholder. A release before
  the timer is the tap (2026-09-22 round): the shell lists
  `pal_core::windows::list()` itself once the stamp landed and raises
  row `2 + steps` (`windows::raise`, the focus effect's helper), no page.
  The tap is the windows palette's; any other held palette shows at once.
- Press again (the OS delivers the registered chord to `hotkey::pressed`
  again, never to the webview): `pal://switch { step: 1 }`; the shift
  variant `step: -1`. The page moves the cursor, wrapping.
- Release: the shell polls `NSEvent.modifierFlags()` every 40 ms while a
  hold is on and, when every modifier of the chord is up, emits
  `pal://switch { commit: true }`. The page runs the primary action of
  the row under the cursor (`focus`, which hides the panel and raises).
  A commit waits for a live relist in flight for that palette (up to
  300 ms) so the row committed is the fresh one. The cursor is an index
  (row 1 plus the steps) across that relist, never a row followed by id:
  the rows on screen at the begin are the last show's, and their row 2
  is not the previous window. Only a typed filter follows the row by id.
- A chord with no modifier (`f13`) has no release: presses step, Enter
  commits.
- A commit reaching the page before the held level's rows landed (the
  release right after the show) waits for them and runs on the placed
  row; nothing hides early.
- Escape, a click outside, any hide: cancel; the poll stops on the
  panel's hide (`panel::hide` calls `switcher::on_hidden` the way it
  calls `pick::on_hidden`). A hold's end also calls `pop::forget`, so
  the next root hotkey lands at the root whatever `pop_to_root` says.
- `cmd+tab` (and its shift variant) is the Dock's: a Carbon registration
  is accepted and the Dock still takes the press (measured on hornet).
  `hotkey::apply` keeps such a chord in its map without registering and
  installs a session-level, head-insert, active `CGEventTap` (keyDown and
  flagsChanged; a matching keyDown runs `pressed` and is swallowed,
  autorepeats swallowed without a press, the rest pass; re-enabled on
  `kCGEventTapDisabledByTimeout`). It needs Input Monitoring: without it
  the chord is logged, asked for once (expansion's path) and listed in
  the Overview with Grant (`Outcome.hold_blocked`); a grant seen by
  `permissions::watch` re-applies. The release is the same modifier poll.
- Typing while held filters; the cursor keeps its row while it is still
  listed, else goes to row 1 of the filtered list. Release then commits
  the filtered row.

### Linux

No global chord on Wayland; the compositor drives the same machine over
the CLI: `pal switch [next|prev|commit|cancel]` (bare `pal switch` =
next, which begins when idle). Hyprland:

```
bind  = ALT, Tab, exec, pal switch
bind  = ALT SHIFT, Tab, exec, pal switch prev
bindr = ALT, Alt_L, exec, pal switch commit
```

`pal switch` also works on macOS (the same handover), so a Karabiner or
skhd user can drive it too.

## The sidebar

### Config

```toml
[sidebar]
palette = "windows/windows"   # any palette; unset or "" = no sidebar (the default)
edge = "right"                # left | right
display = "cursor"            # cursor | primary | <name from `pal windows displays`>
width = 320
peek = true                   # pointer at the edge peeks it
hotkey = "ctrl+opt+tab"       # engages it (unset = none)
```

`show_when` / `hide_when` join when states land (`docs/design/states.md`).

### Mechanics

The sidebar is a second window of the popover's kind, `sidebar`
(`index.html?bar&sidebar`), built by `panel::bar_install` like `bar`,
driven by its own `sidebar` module that reuses the popover's pure
`Machine` (state keyed by the sidebar's id) and the popover page. What
differs from a popover:

- **Placement**: docked to the edge (`x` = the work area's edge, 8 px
  in), centred on the pointer's height when the pointer brought it (the
  peek, a click into it), at the work area's top from the hotkey; the
  anchor is kept while the height settles. Width from the config, height
  = content up to the work-area height (the page reports `bar_size` as
  it does for the popover). The display is resolved at each show
  (`popover::displays` lists them with the under-cursor index).
- **Peek**: an edge strip, a 2 px wide transparent NSPanel pal owns along
  the chosen edge of the chosen display, `ignoresMouseEvents: false`, a
  tracking area like `BarPanel`'s. Its `mouse_entered` is
  `Input::Enter(sidebar)`, `mouse_exited` `Input::Exit(sidebar)`; the
  sidebar window's own tracking area gives `PopoverEnter/Exit`. The
  machine is the popover's table unchanged; the timings are the
  sidebar's own (`delay`, 0 by default: the peek is instant; `grace`
  150 ms), not the bar's hover ones. A click into a peek is the pick
  (wry's webview class answers `acceptsFirstMouse:` yes, else AppKit's
  click-through rule eats the first click of a non-key panel). The strip is re-placed on display
  changes (`NSApplicationDidChangeScreenParametersNotification`) and
  removed with `peek = false`.
- **Engage**: click, the `hotkey`, or a key during a peek (the popover's
  global monitor, Input Monitoring or nothing). Engaged, the sidebar is
  key: typing filters, Enter runs, Escape hides; `cmd+N` runs row N
  (not only jumps: the number *is* the pick), so the visible ordinals
  are the promise.
- **Ordinals**: the page draws each row's number always (the panel's
  `ordinal` prop, shown here without holding cmd), 1 to 9 then blank.
- **Live**: a show calls `index::relist_live(app, palette)` (the panel's
  `on_shown` path split so the sidebar reaches it too), and the page
  re-renders on `pal://index` as the popover does. `views::set_visible`
  for `sidebar` so a live *view* palette gets `view/shown` too.
- **Payload**: `pal://bar` to the `sidebar` window with
  `{ key: "sidebar", title, engaged, menu: { palette }, sidebar: true }`;
  the popover's `entry(app, key)` requirement is bypassed for this key
  (no bar item exists), and `bar_action`/`bar_refresh` from that window
  route to the palette's `pick` like the panel's picks, not to `bar/action`.

## Files

- `core/src/windows.rs`: `hidden`, `note_focus`, MRU sort; `docs/extensions.md` the field; `core/examples/windows.rs`.
- `app/src-tauri/src/switcher.rs` (new): begin / step / commit / cancel, the flags poll, `on_hidden`; `hotkey.rs` `Target::Hold`; `lib.rs` `Shown.hold`; `cli.rs` `Cmd::Switch`; `events.rs` `SWITCH`.
- `app/src-tauri/src/sidebar.rs` (new): the window, the strip, placement, the machine; `panel/macos.rs` the strip panel; `config` `[sidebar]`; `hotkey.rs` `Target::Sidebar`.
- `app/src/Launcher.tsx`, `App.tsx`, `BarPage.tsx`, `ui/keys.ts`, `ui/List.tsx`: hold mode (cursor, flat, step/commit), sidebar mode (ordinals, `cmd+N` runs).
- `extensions/windows`: `hidden`, Show app, README, `hold` suggestion.
- `docs/config.md`, `docs/keyboard.md`, `docs/palettes.md` (Windows), `docs/cli.md` (`pal switch`).
