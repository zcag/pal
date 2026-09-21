# Bar items

Design spec, 2026-09-16, `pali`. Extensions put rich, glanceable state on the
bar: the macOS menu bar, sketchybar, later a Linux bar. One model, several
renderers. Status: decided in `notes/decisions.md`; nothing implemented yet.

## Goals and non-goals

- One model (`BarItem`), one `render` per item, three renderers: the macOS
  menu bar (Tauri tray icons, one per item), sketchybar (its CLI), Linux bars
  (a JSON feed for waybar's `custom` module).
- **An item earns its slot by having something to say** (the owner's rule,
  `~/Sync/vault/setup/bar.md`): `hidden: true` takes no space on any target
  and its refresh keeps running so it can come back (sketchybar's
  `updates=when_shown` trap, avoided by design).
- The panel's design bar: keyboard-first, rich content is the view tree or a
  palette level drawn by the panel machinery, never HTML; actions are
  `Effect`s; every click has a keyboard twin (a hotkey, the `pal bar` CLI).
- sketchybar renders the strip; it is not the model. Its popups, per-row
  click scripts and hover guards were workarounds for a bar with no rich
  surface, and pal's popover replaces them. pal owns names under `pal.` only;
  the owner's items are never touched.
- **One popover, every target.** Rich content, a `nodes` menu included, is
  pal's own popover on the menu bar, sketchybar, a hotkey and Linux alike:
  one renderer means parity across bars and one keyboard model, and the
  native NSMenu was the only per-target behaviour, so it went. It could
  return later as an opt-in degradation, not a design path.
- Non-goals: HTML; a second extension API (bar items are part of
  `Extension`); sketchybar's popup grammar; a native NSMenu; Windows.

## Model

Types live in `sdk/src/protocol.ts` next to `View`; the SDK style applies
(doc comments, provisional until 1.0).

```ts
/** What an item may be coloured: the tag palette plus the bar's own text roles. */
export type BarColor = TagColor | "text" | "muted" | "accent" | "destructive";

/** One coloured run of a strip (`BarItem.segments`): a small glyph and/or text with its own colour. */
export type BarSegment = { id: string; icon?: string; text?: string; color?: BarColor; tooltip?: string };

/**
 * What `render` answers: the item's whole state. The core diffs it against
 * the last one and touches only what changed on each target.
 */
export type BarItem = {
  /** The rule: true takes no space, on every target. `render` keeps running. */
  hidden?: boolean;
  /** A glyph (drawn from the bundled Nerd Font), an emoji, `{ image }` (`icon://`, `data:image/`), `{ app }`. `Icon`'s image form gains `template?: boolean`. */
  icon?: Icon;
  /** Text beside the icon: a count, a code, a track. Short; the menu bar has no truncation of its own. */
  title?: string;
  /** Extra runs after the title, each its own colour: prs' four state counts. Menu bar: joined into the title text. */
  segments?: BarSegment[];
  /** A count, or a dot: drawn as a small mark on the icon (menu bar), a count item after the label (sketchybar), in the item's colour unless the look's `badge_color` says. */
  badge?: number | "dot";
  /** Tints the icon and the title. Menu bar: the icon is a template image (system tint) unless a colour is set. */
  color?: BarColor;
  /** Draws the item as an alarm (destructive colour, non-template icon) and the popover's title bar red. */
  urgent?: boolean;
  /** The number could not be refreshed: muted, tooltip says so. Set by the core on a failed render too. */
  stale?: boolean;
  /** 0..1, drawn as a thin fill under the icon (menu bar image) or a rule of box-drawing characters (sketchybar). */
  progress?: number;
  tooltip?: string;
  /** Seconds until the next `render`, this once (prs: 60 while checks run, else the manifest's `every`). */
  refresh?: number;
  /** A named/hex background tint; sketchybar only. */
  background?: string;
  /** Independent per-render glyph and title sizes in points. */
  icon_size?: number;
  label_size?: number;
  /** A fixed glyph slot width in points; sketchybar only. */
  icon_width?: number;
  /** A per-render sketchybar position, overriding the item's configured one. */
  position?: string;
  /** Up/down actions from the item's sketchybar scroll wheel event. */
  scroll?: { up: string; down: string };
  /** Run `onOpen` on a click or item hotkey even when this item also has a menu. Hover still opens the menu. */
  click?: "open";
  /** What a click, the item's hotkey or a hover peek opens. Absent: the click is `bar/open` and the extension answers an Effect; hover does nothing. */
  menu?: BarMenu;
};

/**
 * Always pal's popover, on every target. `nodes`: a menu level (rows with
 * shortcuts, ticks, sections, submenus). `{ palette }`: that palette level
 * (any extension's), `args` as for `Effect.push`. `{ view }`: the tree as a
 * view level.
 */
export type BarMenu = BarMenuNode[] | { palette: string; extension?: string; args?: unknown } | { view: View };

export type BarMenuNode =
  /** A row; `action` (default `id`) reaches `onAction`. `checked` draws a tick, `disabled` greys it. */
  | { type: "item"; id: string; title: string; subtitle?: string; icon?: Icon; shortcut?: string; checked?: boolean; disabled?: boolean; style?: "destructive"; action?: string }
  /** A captioned group; separators around it are the renderer's. */
  | { type: "section"; title?: string; children: BarMenuNode[] }
  | { type: "submenu"; title: string; icon?: Icon; children: BarMenuNode[] }
  | { type: "separator" };
```

Limits the host checks before an item goes out (`checkBarItem`, next to
`checkView`): `title` 64 chars, 8 segments, 64 menu nodes, 3 levels of
submenu, action ids not `pal:`, a `{ view }` through `checkView`.

### What a click opens

By default, a click, the item's hotkey and a hover peek open the same thing on every target:

| `menu` | the popover shows | use for |
| --- | --- | --- |
| `nodes` | a **menu level**: rows with shortcuts, ticks, sections, submenus | up to a screenful of commands and toggles: Now Playing controls, "Mark all read", the last five notifications with an "Open all" |
| `{ palette }` | that **palette level**, the panel machinery unchanged; a view palette opens as its view level (`view(ctx)` with `ctx.compact`), live like any view (`view.update`, `refresh`) | anything with search, a detail pane, filters, forms, more than a screenful: the notifications list, a PR queue, sessions |
| `{ view }` | a **view level** drawing the tree, the same level as the panel's (`keys: "actions"`, the text field, the keyed `move` transitions), sized to the popover's width (`compact: true` on every `BarCtx`; `ctx.compact` on a `view`/`list`/`pick` reached from the popover). Live: `view.update(tree, { bar: id })` replaces its tree in place, `view.onShown`/`onHidden` fire for it with `{ bar, compact: true }` on open (a peek counts) and close (`app/src-tauri/src/views.rs`). Every key and click is `bar/action` with the action's id; a node carrying `action` runs it on a click, and what a control read (the text field on Enter, a form's fields, a slider's fraction) rides as `ctx.values` (`bar_action` carries them from the page) | a dashboard or card: Hue's rooms as colour tiles with switches and sliders, a timer with a big countdown and a field, Spotify's lyrics with the queue |
| none | nothing: `bar/open` to the extension, its `Effect` runs (`open` a url, `hud`, a `push`); hover does nothing | a single-purpose item: OTP copies its code, prs opens github.com/pulls |

Set `click: "open"` on an item that has a menu when its click and hotkey
should run `onOpen` directly (joining the next meeting, toggling playback).
Its menu remains available to an opt-in hover peek.

The popover is a fourth window, `bar` (`index.html?bar`): an NSPanel like
the main one (`panel/macos.rs:34-37`: `nonactivating_panel`, floating,
`can_join_all_spaces` + `full_screen_auxiliary`, never ordered out, hidden =
alpha 0) with the Launcher on one level and no root: Escape hides it, `cmd+k`
and the whole grammar apply, `keep`/`push`/`show`/`form`/`view` stack inside
it, any hiding effect hides it. Placement: centred under the anchor rect,
8 px down, clamped to the screen; width 420, height by content up to 480.
The anchor is the tray icon's rect on a menu bar click or hover
(`TrayIconEvent::Click { rect, .. }`, tauri 2.11 `src/tray/mod.rs:71`,
verified in the registry source; `None` on Linux), `bounding_rects` from
`sketchybar --query pal.<ext>.<id>` on sketchybar (verified on hornet:
`origin`, `size` per display), the panel's usual position from a hotkey.

### Hover: peek and engage

**Peek**: the pointer rests on an item for `hover_delay` ms (250) and the
popover shows non-activating with the item's level built; it takes no
keyboard, and closes once the pointer has left both the item and the popover
for `hover_grace` ms (400), so crossing the gap is inside the grace.
**Engage**: a click on the item, its hotkey, or any key pressed while a peek
is up makes the popover key; it then stays until Escape, a hiding effect, or
a click outside, the usual panel rules. An item with no `menu` never peeks.
`open_on_hover` defaults off on both targets (Cagdas, 2026-09-17 09:30:
a click opens and closes; the peek on the way across the bar was in the
way, and Apple's bar has no hover convention), each overridable per target
and per item. Focus safety: a peek never steals key focus. The
panel is a non-activating NSPanel (`panel/macos.rs:34`); shown without
`show_and_make_key` (`macos.rs:93`, the engage path) it leaves the front app
key and typing where it was, and over a full-screen app it follows the main
panel's Space rules (`full_screen_auxiliary`, `macos.rs:37`).

## Extension side

```ts
/** When the core asks `render` again. `every` is seconds (min 10, like Raycast's interval); `on` adds triggers. */
export type BarRefresh = { every?: number; on?: ("show" | "wake" | "network" | "focus" | "minute")[] };

/** One named, static state Settings can put through an item's preview strip. It never reaches the live bar. */
export type ManifestBarMock = { title: string; item: BarItem };

/** `pal.json`: `bar.<id>`, readable without code (the Settings window lists it, hidden or not). */
export type ManifestBar = { title: string; description?: string; refresh?: BarRefresh; mocks?: Record<string, ManifestBarMock> };
// Manifest gains: bar?: Record<string, ManifestBar>

/** Why `render` runs, and what a popover-opening click carried. */
export type BarCtx = { reason: "load" | "every" | "show" | "wake" | "network" | "focus" | "minute" | "settings" | "update" | "cli" | "open"; anchor?: "menubar" | "sketchybar" | "hotkey" | "cli" };

export type BarSource = {
  render(ctx: BarCtx): BarItem | Promise<BarItem>;
  /** A menu node was picked, its `action`. Any Effect; `keep` re-renders the item. A segment click opens the popover, like the rest of the item — it never reaches `onAction`. */
  onAction?(action: string, ctx: BarCtx): Effect | void | Promise<Effect | void>;
  /** A click on an item without `menu`, or one whose rendered item says `click: "open"`. */
  onOpen?(ctx: BarCtx): Effect | void | Promise<Effect | void>;
};
// Extension gains: bar?: Record<string, BarSource>
```

Push from the extension, for a webhook, a file watcher, a poll it runs
itself (`@zcag/pal`, over the reverse RPC like `storage`):

```ts
export const bar = {
  /** Replace the item now; the core renders it to every target. */
  update: (id: string, item: BarItem, extension?: string) => call("bar.update", { extension: who(extension), id, item }),
  /** Ask for a `render` with reason `update`. */
  refresh: (id: string, extension?: string) => call("bar.refresh", { extension: who(extension), id }),
};
```

Requests the core sends the host (`host/src/host.ts` `methods`): `bar/render
{extension, id, ctx}` answers the item; `bar/action {extension, id, action,
ctx}` and `bar/open {extension, id, ctx}` answer an Effect, run by
`effects::apply` with the popover as the window when one is up; `bar/shown
{extension, id}` is a notification when the popover opens (a peek counts),
so an item that renders `{ palette }` can warm its cache. `settings/changed`
re-renders an extension's items as it relists its palettes.

## Core side

`app/src-tauri/src/bar/mod.rs`, a registry keyed `extension/id`:

- `Entry { source, manifest: ManifestBar, config, last: Option<BarItem>,
  rendered_at, stale, timer }`, filled from `extension/loaded` (the host adds
  `bar: ManifestBar[]`; a manifest id with no `BarSource` in the code is an
  error row in Settings), removed with the extension.
- Render loop: one `tokio` interval per item from `refresh.every` (or the
  item's own `refresh`), reset on a push. `show` runs on `pal://shown` and
  when the item's popover opens; `wake` is `NSWorkspaceDidWakeNotification`
  and `focus` `NSWorkspaceDidActivateApplicationNotification` (objc2-app-kit,
  `NSWorkspace` already a feature in `core/Cargo.toml`); `minute` a clock
  tick; `network` phase 3 (`SCNetworkReachability`, NetworkManager D-Bus).
  `BAR_RENDER_TIMEOUT = 5 s`; a timeout or error keeps the last item with
  `stale: true` and logs `bar\t<key>\tfailed`. A trigger during a render
  marks it due again (no queue); pushes debounce 100 ms per item; the diff
  against `last` keeps a 1 Hz push at one `--set` per second.
- `trait Target { apply(key, item, cfg); remove(key); anchor(key) ->
  Option<Rect> }` with `MenuBar`, `Sketchybar`, `Feed`; removal on quit and
  `enabled = false`. A target draws the strip and reports `Click`, `Enter` and
  `Exit` for a key with the anchor rect; it builds no menus.
- `bar/popover.rs` owns the peek/engage state (Hover, above): a click opens
  engaged or sends `bar/open`; `Enter` arms `hover_delay`, `Exit` (the item's
  or the popover's own pointer tracking) arms `hover_grace`. Popover picks
  are `bar/action`; a `keep` answer re-renders. A push while the popover
  shows the item replaces its view in place or relists its palette.

### Mapping

| model | menu bar (Tauri tray) | sketchybar | waybar feed |
| --- | --- | --- | --- |
| `hidden` | `remove_tray_by_id` (no slot) | `drawing=off`, `updates=on` always | `text: ""` (waybar collapses it) |
| `icon` glyph | 36 px template PNG from the bundled Nerd Font (below) | `icon=<glyph>` in the bar's own `--default icon.font` (FiraCode Nerd Font on hornet) | the glyph in `text` |
| `icon` emoji | the first run of the title text (Apple Color Emoji is on every Mac) | `icon=<emoji>` | in `text` |
| `icon` `{ image }` / `{ app }` | decoded by `pal_core::icons` to 36 px, non-template; `{ image, template: true }` honoured | `icon.background.image=<cached png>` in the icon slot (an empty icon text, drawing; the item's own `background.image` draws only with `background.drawing=on`, and behind the label), scale 0.5 of sketchybar's 32 pt (16 pt), the slot's paddings as the image's | dropped |
| `title` | the button title (`ImageLeft` of it) | `label=`; empty: `label.drawing=off` and the icon takes the label's right padding (the owner's `icon_only`, lib.sh:45) | `text` |
| `segments` | joined into the title as `glyph text` runs, two spaces apart; colour lost, so the glyph must carry the state | one item per segment (`pal.<ext>.<id>.<seg>`) with its own `icon.color`/`label.color`, in one bracket | joined into `text` |
| `badge` | count appended as `·3` after the title; `dot` a 6 px disc drawn into the icon's corner, in the ink unless `badge_color` (`badge_style` in the look maps one to the other or drops it) | count as the number in a `.badge` item after the label, `dot` = `icon.color`, both in the item's colour unless `badge_color` | `text` suffix, `class: badge` |
| `color`, `urgent` | the glyph PNG drawn in that colour, non-template; `text`/none stays template | `icon.color`/`label.color` from the map; every changed colour eases with `--animate sin 10` | `class: <color>`, `urgent` |
| `stale` | the template icon at `dim` (50%), tooltip "(stale)" | icon, label and segments at the `muted` colour at `dim` (the owner's `stale_mark`, symmetric) | `class: stale` |
| `progress` | a 2 px bar drawn into the bottom of the icon | `━━━───` (8 cells of heavy/light box drawing, the owner's timer rule) before the glyph | `percentage` |
| `tooltip` | `set_tooltip` | none (no tooltips); shown in the popover title | `tooltip` |
| `menu` (nodes, palette, view), none | `show_menu_on_left_click(false)`, no `tauri::menu`; `on_tray_icon_event` Click with `rect` opens the popover under it / sends `bar/open` | `click_script="<pal binary> bar click <ext>/<id> --anchor sketchybar"` (absolute path: sketchybar's PATH is launchd's), the popover under the item's `bounding_rects`; no sketchybar popups | `on-click: pal bar click …`, popover |
| hover (peek) | `TrayIconEvent::Enter` / `Leave` with `rect` (tray-icon 0.24.2 `src/lib.rs:583-608`, `Move` between them unused); off unless `open_on_hover` | `--subscribe pal.<ext>.<id> mouse.entered mouse.exited`; its script gives the item a subtle 8-tick animated tint, restores any declared background on leave, then calls `pal bar hover <ext>/<id>`; on by default | none (waybar's `custom` module has no hover event) |
| scroll | unavailable from a status item | `scroll: { up, down }` subscribes `mouse.scrolled`; `SCROLL_DELTA` dispatches either action to `onAction` without opening the popover | unavailable |
| position, order | `order` among pal's icons (macOS places the rest) | `--add item NAME <position>`, `--move NAME before\|after REF` for `before:clock` | the module's place in waybar's config |

### Menu bar renderer (`bar/menubar.rs`)

One `TrayIconBuilder::with_id("pal.<ext>.<id>")` per visible item, built on
the main thread as `tray.rs` does; `hidden` is `remove_tray_by_id` (a fresh
id on return, `tray.rs`'s Linux note), not `set_visible`, so a hidden item
takes no slot. Verified against tauri 2.11.5 (`src/tray/mod.rs`) and
tray-icon 0.24.2 (`src/platform_impl/macos/mod.rs`): `title` is the
NSStatusItem button's title, image `ImageLeft` of it, image scaled to 18 pt
high, `icon_as_template` is `NSImage.setTemplate`, `set_title(None)` leaves
the old text (clear with `Some("")`), `rect()` is the button's frame. The
renderer builds no `Menu`: it draws the strip and hands `Click`, `Enter` and
`Leave` with their `rect` to `bar/popover.rs`; peeks are off here unless
`open_on_hover` says otherwise.

**Glyphs are prerendered, not sent as title text.** The title is a plain
`NSString` in the system font (tray-icon sets no attributed string), and the
Nerd Font is not on users' Macs, so a PUA code point there is tofu everywhere
but the owner's machine. The renderer rasterises the glyph with `ab_glyph`
(pure Rust) from `SymbolsNerdFontMono-Regular.ttf` shipped as a resource next
to the webview's woff2 (`ab_glyph` reads TTF/OTF, not woff2; 2.4 MB), at 2x
into the 36 px PNG, cached per (glyph, colour, badge, progress). Rejected:
the webview's canvas (has the font, but ties the bar to the page being alive
and adds a round trip per change); CoreText (still needs the TTF, macOS only
where a Linux tray wants the same PNG). Not probed; `Font::try_from_slice`,
`outline_glyph`, `draw` is the crate's documented path.

### sketchybar renderer (`bar/sketchybar.rs`)

Detection: `sketchybar --query bar` exits 0 (verified on hornet; the JSON
carries the item list). Probed while the target is on at start, on a `[bar]`
config change, on wake and on a Space change (a fork per probe, no timer: the 30
s poll it replaced was a process every half minute at idle), the answer cached,
so a bar restarted by its own `sketchybarrc` reload (which wipes every item)
gets pal's items re-added at the next of those; `pal bar sync` at the end of a
`sketchybarrc` does it at once. Items are named `pal.<ext>.<id>` (segments
`pal.<ext>.<id>.<seg>`, grouped by `--add bracket pal.<ext>.<id>.group`); pal
creates, sets, moves and removes only names under `pal.`, and `--remove
/pal\..*/` on quit. Every change is one batched `sketchybar` invocation (the
owner measured 3 ms per call and 10 ms per `--add`; a diff keeps `--add` to
first appearance).

Colours: `BarColor` to `0xAARRGGBB` from pal's tokens for `general.theme`
(`app/src/ui/tokens.css`, exported once into `bar/colors.rs`), overridable
per name in `[bar.sketchybar.colors]` so a Catppuccin bar keeps its own
red. Hover highlight, sketchybar popups and per-row click scripts are not
rendered: the popover is the one rich surface. Hover reaches pal through
`mouse.entered` / `mouse.exited` and `pal bar hover` (mapping table) and
peeks under `bounding_rects`; the popover's own pointer tracking spans the
gap, so no `mouse.exited.global` guard is needed.

### Linux feed (`bar/feed.rs`, phase 3)

`~/.local/state/pal/bar.json` (`{ "items": { "<ext>/<id>": BarItem & { text,
class, percentage } } }`, atomic write on every change) and `pal bar follow
<ext>/<id>` printing one waybar `custom` JSON line (`text`, `tooltip`, `class`
from colour/urgent/ stale, `percentage` from progress) per change for a module
with `"exec": "pal bar follow github/notifications"`, `"return-type": "json"`,
`"on-click": "pal bar click github/notifications"`. A hidden item prints an
empty `text` (waybar collapses it). The tray icon path stays the Linux default
where a StatusNotifier host exists (`tray.rs`'s dlopen). Click only (the feed
carries no hover); it opens the same popover.

## Config

```toml
[bar]
target = "auto"            # "auto" (sketchybar when it answers, else menubar) | "menubar" | "sketchybar" | "both" | "off"
hover_delay = 250          # ms the pointer rests on an item before a peek opens
hover_grace = 400          # ms after the pointer has left both the item and the popover before a peek closes

[bar.menubar]
open_on_hover = false      # Apple's bar has no hover convention
# appearance, every item on this target unless it says otherwise (the section below)
dim = 50
opacity = 100              # every colour's alpha; a muted item at dim of it
size = 0
icon_size = 0              # the glyph alone; 0 follows size
text_size = 0              # the text alone; 0 follows size
spacing = 4
show_icon = true
show_title = true
# color = "blue"           # unset: the extension's colour
urgent_color = "destructive"
# badge_color = "red"      # unset: the badge in the item's colour
badge_style = "count"      # count | dot | none
width = 0                  # 0: natural
font = "system"            # system | mono
max_chars = 32

[bar.sketchybar]
open_on_hover = true       # the owner's popups open on hover
position = "right"         # default for items: left | right | center | q | e | "before:<item>" | "after:<item>"
colors = { red = "0xffe78284", muted = "0xff737994" }   # overrides of the token map, optional
# the same appearance keys as [bar.menubar], sketchybar's own defaults

[bar.items."github/notifications"]
enabled = true             # false: no slot, no timers; the Settings view unsets true
target = "menubar"         # this item only; default the global one
position = "after:pal.github.prs"
hotkey = "ctrl+alt+n"      # opens the item's popover engaged, whatever its `menu` form
open_on_hover = true       # this item only; default the target's
order = 20                 # among pal's own items on the menu bar (left to right ascending) and within a sketchybar position
badge_style = "dot"        # any appearance key, this item only; default the target's

[bar.items."timer/timer"]
font = "mono"              # a countdown that does not jitter
width = 72
icon = "󰔛"                 # this item's own glyph in place of the extension's
```

`pal_core::config::Config` gains `bar: Bar` (`core/src/config/mod.rs`, the
schema in `core/schema/config.schema.json`), watched like the rest: a change
re-targets, moves, or removes live. Per-extension settings apply as usual
(`settings.get()` inside `render`). Settings window: a **Bar** tab after
Palettes (the "Settings > Bar" section below).

## Appearance

One vocabulary for how a target draws an item, `pal_core::config::BarLook`,
flattened into `[bar.menubar]` and `[bar.sketchybar]` (each target its own
defaults, the built-in ones equal) and, every key optional, into
`[bar.items."<key>"]` (`BarLookOverride`); `Bar::look(key, target)` resolves
the item over the target it draws on, and rides on `Draw` to both
renderers. The keys, and what each target makes of them:

| key | default | menu bar (`bar/menubar.rs`) | sketchybar (`bar/sketchybar.rs`) |
| --- | --- | --- | --- |
| `dim` (percent) | 50 | a muted item (stale, or `color = "muted"` from the extension) is the template image at this alpha, so the bar's own tint still applies; the title text cannot be dimmed unless prerendered | the `muted` colour (token or `[bar.sketchybar.colors]` override) at this alpha on icon, label and segments |
| `opacity` (percent) | 100 | the whole image's alpha (`glyph::Style::opacity`, the dot included; a muted item's ink at `dim` of it); under 100 the text is prerendered so it fades too | the alpha of every colour (`colors::at`), the `muted` colour at `dim` of it; an image icon keeps its own |
| `size` (pt) | 0 = the target's own | the glyph's em size in the 18 pt square (14 pt when 0); a size also prerenders the text at it (13 pt when 0) | `icon.font.size`, `label.font.size` |
| `icon_size`, `text_size` (pt) | 0 = follows `size` | the glyph's and the text's sizes apart (`Draw::icon_size` / `label_size`; an item's own dynamic sizes still win) | `icon.font.size` / `label.font.size` apart |
| `spacing` (pt) | 4 | the gap between the glyph square and the text in a prerendered strip; Apple's `ImageLeft` gap otherwise | `icon.padding_right` before a label or segment, a segment's `icon.padding_left` (its `label.padding_left` without an icon) |
| `show_icon`, `show_title` | true | `BarItem::shaped` drops the icon, or the title and the segments, before either renderer sees the item; nothing left to draw is `hidden` (no slot) | the same |
| `icon` | unset | `BarItem::shaped` puts it in place of the extension's icon (a glyph, an emoji or text, as `BarItem.icon` takes a string); per item, the one key Settings shows only in an item's pane | the same |
| `color` | unset | the glyph's ink (a name through `Palette::resolve`, or hex); the title text keeps the bar's colour unless prerendered | `icon.color` and `label.color`, segments without a colour of their own included |
| `urgent_color` | `destructive` | the ink of an urgent item | the same |
| `badge_color` | unset | the dot's colour and, prerendered (a set colour prerenders), the `·3` run's (`glyph::Text::badge`, `Style::badge`); unset is the ink's (`Draw::badge_tint`: the tint, `urgent_color` while urgent, `muted` while stale), so a dot rides a template image | the `.badge` item's colour and a dot's `icon.color`; unset the item's |
| `badge_style` | `count` | `count` is `·3` in the title text, `dot` the disc in the image's corner (a count becomes the dot), `none` drops the badge (`shaped`) | `count` the `.badge` item, `dot` the icon in the badge colour, `none` nothing |
| `width` (pt) | 0 = natural | a fixed prerendered image width (the tray keeps the aspect of an image scaled to 18 pt, so 2x pixels are half as many points); the text is clipped to it | `label.width` with `label.align=left` |
| `font` | `system` | `mono` prerenders the text in SF Mono | `label.font.family=Menlo` |
| `max_chars` | 32 | `menubar::clip`, an ellipsis on a word edge | the same word-edge clipping before `label.max_chars` |

**Prerendering on the menu bar.** The title is a plain `NSString` (tray-icon
0.24.2 `set_title` is `button.setTitle`,
`src/platform_impl/macos/mod.rs:179-191`, no attributed string, no font), so
`size`, `font`, `width`, `opacity` and `badge_color` cannot be title
attributes. `menubar::prerendered` then puts the whole item into the image: `glyph::strip` draws the glyph square
as before, the gap, and the text in the system's own face read from disk
(`/System/Library/Fonts/SFNS.ttf` or `SFNSMono.ttf`; Helvetica and Menlo as
fallbacks; a Nerd glyph inside the text, a segment's icon, from the bundled
symbols font), at 2x into an image 36 px tall and as wide as the text; the tray
scales any image to 18 pt high and keeps its aspect
(`set_icon_for_ns_status_item_button`, `mod.rs:296-297`), so the width lands at
half its pixels in points. The image stays a template (black ink) unless a
colour is set, so the system tints text and glyph alike for a light or dark bar,
and `dim` fades both. An emoji icon cannot be rasterised (Apple Color Emoji is a
bitmap font) and stays the first run of the title text, which the tray puts
right of the image; an image icon keeps its picture and its title text. `Draw`
and `same_image` compare the look too, so a look change redraws.

**sketchybar has no unset.** A property the bar has that the look no
longer sets (a size back to the bar's own) cannot be reverted to the bar's
`--default`, so `diff` removes and re-adds an item whose known properties
lost a key; a fresh item takes the defaults.

## Settings > Bar

A two-column page (`app/src/ui/SettingsBar.tsx`). The left column scrolls:
a **Defaults** card (the target with its explanation and the sketchybar
detection dot; the peeks: per-target hover switches, delay, grace;
sketchybar's position; then **Appearance** under a Menu bar / sketchybar
segmented switch, the chosen target's `BarLook` in four groups, Placement
(spacing, width), Text (font, size, longest title, icon, title), Colour
(tint, urgent, dim), Behaviour (badge), each field with its file key, its
description and the target's caveat), then the **Items** as a master list:
a badged tile (the extension's icon with the last badge count or dot), the
extension over the item title, the on switch, the target select, and the
live state line (badge, hidden, poll, last render, stale). The right column
is the selected item's pane: the description in full, a **preview** strip
of the last render drawn by `ui/BarStrip.tsx` (the band the gallery's bar
shots use, extracted from `gallery/bar-shot.tsx` so the two never drift)
in both themes on the target the item lands on (both bands under `both`),
with the resolved look applied; Placement (target, position, order);
Appearance in the same four groups, each field on the resolved value with
"from the menu bar default" (or sketchybar's) while inherited and Reset
once overridden, a value typed equal to the default writing nothing; the
hotkey recorder and the peek select under Popover; "Reset to defaults",
which drops every key of the item but on/off. Every field has a search
anchor (`bar:<target>:<key>`, `bar:<item key>:<key>`), and a hit selects
the item. Writes go one key at a time (`lookWrites`): a target default equal
to the built-in leaves the file, an item key equal to its target's does.

An item may declare `mocks` in its `pal.json` when its important conditions
are hard to catch live. It is a record keyed by a stable internal id; each
value has a reader-facing `title` such as "Starts in 4 min" and an ordinary
`BarItem` as `item`. Settings adds a compact **Preview state** select above
that item's strips. Its selected mock replaces only those strips, after the
current appearance settings are applied; it never writes config, calls the
extension, or changes the live bar. Items without mocks keep the last-render
preview alone.

```json
{
  "bar": {
    "upcoming": {
      "title": "Upcoming",
      "mocks": {
        "warning": {
          "title": "Starts in 4 min",
          "item": { "icon": "󰃭", "title": "Design review · 4m", "color": "amber" }
        }
      }
    }
  }
}
```

## Keyboard

- `[bar.items.<key>].hotkey` registers `Target::Bar(key)` in `hotkey.rs`
  (root beats palette beats bar beats item): opens the popover engaged on
  the item's level (menu, palette or view), or runs `bar/open`.
- In the popover the panel grammar applies unchanged (`keys.ts`): arrows,
  Enter, `cmd+Enter`, `cmd+k`, Escape hides, `cmd+r` re-renders the item.
- A peek has no keyboard: the first key pressed while one is up engages
  the popover, then the grammar handles keys as usual. Engaged, it closes on
  Escape, a hiding effect, or a click outside, never on the pointer leaving;
  a hover on another item while one is engaged is ignored.
- CLI (`cli.rs`, over single-instance like `toggle`): `pal bar list` (every
  item, visible or not, with its last title), `pal bar click <ext>/<id>
  [--anchor sketchybar]`, `pal bar hover <ext>/<id> --anchor <rect> --state
  enter|exit` (`<rect>`: `x,y,w,h` in screen points, or `sketchybar` to query
  `bounding_rects`; `--state` also takes `$SENDER`'s `mouse.entered` /
  `mouse.exited` so the item's `script` is one line), `pal bar action
  <ext>/<id> <action>`, `pal bar render <ext>/<id>` (force), `pal bar json
  <ext>/<id>`, `pal bar follow <ext>/<id>`, `pal bar sync` (re-apply the
  sketchybar target).

## Examples

GitHub notifications: a badge, a menu level of the last five in the popover, the
palette from its "Open" row.

```ts
import { defineExtension, type BarItem, type BarMenuNode } from "@zcag/pal";
import { notifications, markRead } from "./api.ts"; // the palette's own loader, one cache

export default defineExtension({
  palettes: { /* prs, issues, repos, notifications, search as today */ },
  bar: {
    notifications: {
      render: async (): Promise<BarItem> => {
        const n = await notifications();                  // ETag cached, shared with the palette
        if (n.length === 0) return { hidden: true };       // earns its slot
        const rows: BarMenuNode[] = n.slice(0, 5).map((x) => ({ type: "item", id: x.id, title: x.title, subtitle: x.repo, icon: x.icon }));
        return {
          icon: "\u{f09b}", badge: n.length, tooltip: `${n.length} unread`,
          menu: [{ type: "section", title: "Unread", children: rows }, { type: "separator" }, { type: "item", id: "open", title: "Open Notifications" }, { type: "item", id: "read-all", title: "Mark all as read", shortcut: "cmd+shift+r" }],
        };
      },
      onAction: async (action) => {
        if (action === "open") return { push: { extension: "github", palette: "notifications" } };
        if (action === "read-all") { await markRead(); return { keep: true, hud: "Marked read" }; }
        return { open: `https://github.com/notifications?query=${action}` };
      },
    },
  },
});
```

Now Playing: the track as the title, play/pause from the menu level (a peek on
sketchybar shows it without a click).

```ts
bar: { now: {
  render: async () => {
    const p = (await media.nowPlaying()).players.find((x) => x.state === "playing");
    if (!p) return { hidden: true };
    return { icon: "\uf001", title: `${p.title} · ${p.artist}`.slice(0, 40),
      menu: [{ type: "item", id: "play_pause", title: "Pause", shortcut: "space" }, { type: "item", id: "next", title: "Next", shortcut: "right" }] };
  },
  onAction: async (a) => { await media.control("spotify", a as "play_pause"); return { keep: true }; },
} }
```

OTP: the latest code as the title for 60 s, hidden otherwise; click copies.

```ts
bar: { otp: {
  render: async () => {
    const c = await latestCode();                                         // the palette's reader over chat.db
    if (!c || Date.now() - c.at > 60_000) return { hidden: true };
    return { icon: "\u{f084}", title: c.code, color: "green", tooltip: c.sender };
  },
  onOpen: async () => ({ copy: (await latestCode())!.code }),            // hides the popover, "Copied" in the HUD
} }
// pal.json: "bar": { "otp": { "title": "Latest code", "refresh": { "every": 10 } } }
```

Timer: the owner's `timer` tool (`~/.local/bin/timer`) as an extension.

```ts
bar: { timer: {
  render: async () => {
    const t = await runningTimer();                                       // `timer _bar`, tab-separated
    if (!t) return { hidden: true };
    if (t.kind === "done") return { icon: "\u{f0954}", title: t.name, urgent: true, menu: [{ type: "item", id: "done", title: "Dismiss", shortcut: "enter" }] };
    return { icon: "\u{f0954}", title: t.left, progress: t.pct / 100, color: t.pct > 90 ? "red" : t.pct > 66 ? "amber" : "blue", tooltip: t.name,
      menu: [{ type: "item", id: "pause", title: t.paused ? "Resume" : "Pause" }, { type: "item", id: "add", title: "Add 5 minutes" }, { type: "item", id: "stop", title: "Stop", style: "destructive" }] };
  },
  onAction: async (a) => { await timerCmd(a); return { keep: true }; },
} }
// "refresh": { "every": 10, "on": ["wake"] }; the CLI pushes the second-level ticks itself: `pal bar render timer/timer` from its own loop, or `bar.update` from a watcher on ~/.local/share/timer/
```

Battery drain: the owner's `power` tool, hidden unless there is a verdict.

```ts
bar: { power: {
  render: async () => {
    const p = await powerNow();                                           // `power --json`
    if (!p.verdict) return { hidden: true };
    return { icon: "\u{f240}", title: `${p.watts.toFixed(1)} W`, color: p.level === "crit" ? "red" : "amber", stale: p.age > 120,
      menu: { view: drainView(p) } };                                     // a stack: verdict text, one row per process with a progress bar
  },
} }
```

## Migration: the owner's items in pal's model

Source of truth for what they do today: `~/dotty/sketchybar/.config/sketchybar/`
(`sketchybarrc`, `lib.sh`, `plugins/*.sh`, `helpers/*`). Each becomes one
`bar` entry of the extension that already owns the data, so the palette and
the strip share one loader and one cache (the `prs`/`issues`/`slack` palettes
already read the bar's helpers; here it is the same TypeScript module).
sketchybar-only mechanics (segments as separate items, brackets, tick-built
popups, `popupsig`, `row_hover.sh`, `--trigger` events) are the renderer's
or gone; `hover_guard`'s open-on-hover survives as the popover's peek.

| item | what it needs from the model | how | not expressible yet |
| --- | --- | --- | --- |
| prs (`plugins/prs.sh`, `helpers/gh-prs`) | a dim lead glyph and five coloured counts in a fixed order, a lane separator, the OSS glyph red when a drive-by is his move; drawn whenever a PR is open (the by-value exception); 60 s refresh while checks run else 300; stale dimming; serpapi rows dropped off the clock | `icon: "\u{f062c}", color: "muted"`, `segments: [block red, ready green, run amber, wait muted, { text: "│", color: "muted" }, oss]`; `hidden: open.length === 0`; `refresh: nrun ? 60 : 300`; `stale`; the off-clock filter is the extension's (`work_hours` setting, or `dek` shelled from `render`); `menu: { palette: "prs" }`, the popup's sections are the palette's rows with `section`, "checked 3 m ago" is `tooltip` | the menu bar loses the per-count colours (one text colour); the glyph shapes carry the state, which the owner designed them for |
| issues (`issues.sh`, `gh-issues`, `issue-read`) | an @-count in red and a bare assigned count; hidden at zero; a row click that opens and marks the thread read, then refreshes the strip | `segments: [{ icon: "\u{f00e9}", text: nnew, color: "red" }, { text: nmine }]`; `menu: { palette: "issues" }`; the palette's `open` pick does the PATCH and calls `bar.refresh("issues")` (replaces `--trigger issues_change`) | nothing |
| slack (`slack.sh`, `slack-unreads`) | hidden off the clock and at zero; red when a DM or mention is in it; sections DMs / mentions / threads with who, text, where, relative time; "also unread #a #b"; Open Slack | `hidden`, `color: attn_dm ? "red" : "text"`, `title: attn`; `menu: { palette: "slack" }` (rows with `{ date }` accessories, so the hover-swap of the aside is not needed; the quiet channels one inert row; Open Slack an action) | nothing |
| timer (`timer.sh`, `~/.local/bin/timer`) | a 1 Hz countdown, a fill that escalates blue / peach / red, paused muted, done as an alarm with a background; +5 min, Dismiss, Stop all | `progress`, `title: left`, `color`, `urgent` for done; the second-level ticks come from the extension: `bar.update` from an `fs.watch` on `~/.local/share/timer/` plus its own 1 s interval while one runs (the core's `every` floor is for polls, a push has none); `menu: { view }` with the timers as rows and the three actions, replaced in place on every push | a background tint on the strip: `urgent` gives the colour, not a tinted box |
| battery / power (`battery.sh`, `~/.local/share/power/state.json`) | hidden unless draining fast, low, charging low, or `power` has a verdict; colour by level; a loud form with watts and the culprit; a popover of kv sections (draw, breakdown, eating it now, last 24 h, holding it awake, health) and Battery Settings | the extension watches `state.json` (`fs.watch`, replaces `--trigger power_update`) and `bar.update`s; `hidden` by the same rule; `color: crit ? "red" : warn ? "amber" : "muted"`; `title: "4.2 W · chrome"`; `menu: { view }`: `text` rows and `progress` bars per process, `actions: [Battery Settings]` | the `--animate sin 12` colour ease: the sketchybar renderer animates every colour change itself |
| cldd / claude sessions (`cldd.sh`, `cldd-stream.sh`, `claude-state`) | two counts (your turn in yellow, working in blue); hidden at zero; local sessions from `claude-state ls`, marko's over ssh with a short cache when opened; focus a local session, copy the ssh line for a remote one | `segments: [{ text: yours, color: "amber" }, { text: working, color: "blue" }]`; `refresh: { every: 120, on: ["show"] }` and `ctx.reason` picks the ttl; the inotify stream moves into the extension (a long-lived `ssh marko inotifywait` it owns, `bar.update` per line), `claude-state`'s hook runs `pal bar render claude/sessions` instead of `--trigger cldd_change`; `menu: { palette: "sessions" }` with a section per host, `focus` and `copy` as row actions, "copied" as the HUD | the strip's click used to copy `ssh -t marko` without opening anything: with a `menu` the click opens; the copy is the first action inside |

What the catalogue added to the model: `segments`, `progress`, `stale`,
`urgent`, `BarItem.refresh`, `on: ["show"]` with `ctx.reason`, popover content
replaced in place on a push, colour eases in the sketchybar renderer, `tooltip`
on a segment, the hover peek. Left to the extensions: work hours (a setting; the
file-first config also lets a `dek` hook write `enabled = false` under
`[bar.items."slack/unread"]` and pal follows live), caches, and every data
source.

## Open questions

Resolved 2026-09-16: hover vs click is both (peek, then engage; the pass-by
worry is met by `hover_delay` and a peek that never takes focus), and the
native NSMenu is out (popover only, the why in Goals). Still open:

- How a peek sees the key that engages it: the panel is not key, so a global
  monitor (`NSEvent`'s observes without swallowing and needs the Input
  Monitoring grant; a `CGEventTap` can swallow). Not checked; phase 2 decides.
- `target = "auto"` when sketchybar quits mid-session: fall back to the menu
  bar (invisible under a hidden macOS bar) or draw nothing until it is back?
- Work hours as a pal notion (a `[bar] profile` the CLI flips, items
  declaring `profile: "work"`) versus each extension asking `dek`.
- Menu bar width: NSStatusItem autosizes and a long title pushes the rest.
  Settled by the look: `max_chars` (32, per target and per item) cuts the
  title with an ellipsis, and `width` fixes an item's width outright
  (Appearance section). What macOS does with items that do not fit
  between the front app's menus and the notch stays its own.
- Persist the last rendered item per key under the profile's data dir and
  draw it before the host is up (Raycast restores menu bar commands without
  running code): the strip would be there at ~400 ms cold like the index.
  Phase 1 optional; not needed for correctness.
- Band separators between adjacent pal items on sketchybar (the owner's
  `sep_prs`/`sep_issues`): a `[bar.sketchybar] separators = true` drawing a
  hairline between visible pal items, or leave grouping to position?

## Phases

Phase 1, the strip on both targets and the popover with menu and palette
levels (click and hotkey only):

- `sdk/src/protocol.ts` (`BarItem`, `BarSegment`, `BarMenu*`, `BarRefresh`,
  `ManifestBar`, `BarCtx`, `BarSource`, `Extension.bar`, `Manifest.bar`),
  `sdk/src/api.ts` (`bar.update/refresh`), `sdk/src/view.ts` (`checkBarItem`),
  `sdk/src/index.ts`.
- `host/src/host.ts`: `bar/render`, `bar/action`, `bar/open`, `bar/shown`;
  `extension/loaded` and `hello` carry `bar: ManifestBar[]` merged with the
  code's keys; `settings/changed` re-renders.
- `core/src/config/mod.rs` + `core/schema/config.schema.json`: `[bar]`,
  `[bar.menubar]`, `[bar.sketchybar]`, `[bar.items.<key>]` (the hover keys
  parsed now, used in phase 2).
- `app/src-tauri/src/bar/{mod,menubar,sketchybar,glyph,colors,popover}.rs`;
  `bridge.rs` (`core/bar.update`, `core/bar.refresh`); `index.rs`
  `on_notification` (register on `extension/loaded`, drop on error/removed;
  `push`/`keep` scoped to the popover's level; a `bar.update` while open relists
  its palette); `hotkey.rs` (`Target::Bar`); `cli.rs` (`pal bar
  list|click|action|render|sync`); `lib.rs` (install, `RunEvent::Exit` removal);
  `tray.rs` (the id scheme shared); `app/src-tauri/Cargo.toml` (`ab_glyph`),
  `tauri.conf.json` resources (the TTF), `app/scripts/` (fetch the TTF at the
  pinned Nerd Fonts release like `icons/build.ts` does its json).
- The popover: `app/src/main.tsx` (`?bar`), `app/src/BarPage.tsx` (the Launcher
  on one level, no root, the menu level built from nodes in `app/src/items.ts`),
  `app/src/ui/keys.ts` unchanged; `panel/macos.rs` (a third `tauri_panel!`
  module like `hud`), `panel/linux.rs`, `bar/popover.rs` (place under the
  anchor, show engaged, hide on resign key, `pal://bar` event with the item and
  its menu), `effects.rs` (hide the window the pick came from).
- Settings: `app/src/ui/SettingsBar.tsx`, a tab in `SettingsWindow.tsx`,
  `settings.rs` `settings_get` carrying the items and their live state,
  `SettingsTypes.ts`.
- Docs: `docs/extensions.md` (a Bar items section), `docs/config.md` (`[bar]`),
  `docs/cli.md`.
- Tests: host harness renders/actions on a fixture extension; Rust tests on the
  sketchybar batch builder (pure: item to argv), the diff, the colour map, the
  glyph rasteriser, the popover placement. A `{ view }` item opens an empty
  level with its title until phase 2.

Phase 2, the view level and hover:

- `app/src/BarPage.tsx` draws `{ view }` as a view level; `index.rs` replaces it
  in place on a `bar.update`.
- Hover: `bar/popover.rs` gains the peek state machine (`hover_delay`,
  `hover_grace`, engage on click/hotkey/key, the popover's own pointer
  tracking); `bar/menubar.rs` forwards `TrayIconEvent::Enter`/`Leave`;
  `bar/sketchybar.rs` adds the `mouse.entered mouse.exited` subscription and
  `script`; `cli.rs` (`pal bar hover`); the `open_on_hover` keys take effect.
  Tests: the state machine as a pure table (events in, show/engage/hide out).

Phase 3, Linux:

- `bar/feed.rs` (`~/.local/state/pal/bar.json`), `cli.rs` (`pal bar
  json|follow`), `notes/linux.md` (the waybar module), the `network` trigger on
  both platforms, tray-icon `title` for the StatusNotifier path where the host
  shows it.
