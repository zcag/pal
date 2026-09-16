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
  click scripts and hover tricks were workarounds for a bar with no rich
  surface, and pal's popover replaces them. pal owns names under `pal.` only;
  the owner's items are never touched.
- Non-goals: HTML; a second extension API (bar items are part of
  `Extension`); sketchybar's popup grammar; Windows.

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
  /** A count, or a dot: drawn as a small red mark on the icon (menu bar), a coloured count after the label (sketchybar). */
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
  /** What a click (or the item's hotkey) opens. Absent: the click is `bar/open` and the extension answers an Effect. */
  menu?: BarMenu;
};

/**
 * `nodes`: a menu. Native NSMenu on the macOS menu bar; pal's popover as a
 * menu level everywhere else (sketchybar, hotkey, Linux). `{ palette }`:
 * the popover opens that palette level (any extension's), `args` as for
 * `Effect.push`. `{ view }`: the popover draws the tree as a view level.
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

### Two click paths, and when to use which

| path | opens | use for |
| --- | --- | --- |
| `menu: nodes` | native NSMenu on the menu bar; a **menu level** (rows with shortcuts, ticks, sections) in pal's popover elsewhere | up to a screenful of commands and toggles: Now Playing controls, "Mark all read", the last five notifications with an "Open all" |
| `menu: { palette }` | pal's **popover**: the panel machinery, one level, that palette | anything with search, a detail pane, filters, forms, more than a screenful: the notifications list, a PR queue, sessions |
| `menu: { view }` | pal's popover as a view level | a dashboard or card: battery drain with a bar per process, a timer with a big countdown |
| no `menu` | `bar/open` to the extension, its `Effect` runs (`open` a url, `hud`, a `push`) | a single-purpose item: OTP copies its code, prs opens github.com/pulls |

The popover is a fourth window, `bar` (`index.html?bar`): an NSPanel like
the main one (`panel/macos.rs`: non-activating, floating, all Spaces, never
ordered out, hidden = alpha 0) with the Launcher mounted on one level and no
root: Escape hides it, `cmd+k` and the whole grammar apply, `keep`/`push`/
`show`/`form`/`view` stack inside it, and any hiding effect hides it.
Placement: centred under the anchor rect, 8 px down, clamped to the screen;
width 420, height by content up to 480. The anchor is the tray icon's rect on
a menu bar click (`TrayIconEvent::Click { rect, .. }`, tauri 2.11 `src/tray/mod.rs:71`,
verified in the registry source; `None` on Linux), the item's
`bounding_rects` from `sketchybar --query pal.<ext>.<id>` on a sketchybar
click (verified on hornet: `origin`, `size` per display), the panel's
usual position from a hotkey with no anchor.

## Extension side

```ts
/** When the core asks `render` again. `every` is seconds (min 10, like Raycast's interval); `on` adds triggers. */
export type BarRefresh = { every?: number; on?: ("show" | "wake" | "network" | "focus" | "minute")[] };

/** `pal.json`: `bar.<id>`, readable without code (the Settings window lists it, hidden or not). */
export type ManifestBar = { title: string; description?: string; refresh?: BarRefresh };
// Manifest gains: bar?: Record<string, ManifestBar>

/** Why `render` runs, and what a popover-opening click carried. */
export type BarCtx = { reason: "load" | "every" | "show" | "wake" | "network" | "focus" | "minute" | "settings" | "update" | "cli" | "open"; anchor?: "menubar" | "sketchybar" | "hotkey" | "cli" };

export type BarSource = {
  render(ctx: BarCtx): BarItem | Promise<BarItem>;
  /** A menu node was picked (its `action`), or a segment clicked (`segment:<id>`). Any Effect; `keep` re-renders the item. */
  onAction?(action: string, ctx: BarCtx): Effect | void | Promise<Effect | void>;
  /** A click on an item without `menu`. */
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
{extension, id}` is a notification when the popover or native menu opens, so
an item that renders `{ palette }` can warm its cache. `settings/changed`
re-renders an extension's items as it relists its palettes.

## Core side

`app/src-tauri/src/bar/mod.rs`, a registry keyed `extension/id`:

- `Entry { source, manifest: ManifestBar, config, last: Option<BarItem>, rendered_at, stale, timer }`,
  filled from `extension/loaded` (the host adds `bar: ManifestBar[]`; a
  manifest id with no `BarSource` in the code is an error row in Settings),
  removed with the extension.
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
- `trait Target { apply(key, item, cfg); remove(key); anchor(key) -> Option<Rect> }`
  with `MenuBar`, `Sketchybar`, `Feed`; removal on quit and `enabled = false`.
- A click from a target opens the popover, the native menu, or sends
  `bar/open`; menu events (id `pal.<ext>.<id>.<action>`) and popover picks
  are `bar/action`; a `keep` answer re-renders. A push while the popover
  shows the item replaces its view in place or relists its palette.

### Mapping

| model | menu bar (Tauri tray) | sketchybar | waybar feed |
| --- | --- | --- | --- |
| `hidden` | `remove_tray_by_id` (no slot) | `drawing=off`, `updates=on` always | `text: ""` (waybar collapses it) |
| `icon` glyph | 36 px template PNG from the bundled Nerd Font (below) | `icon=<glyph>` in the bar's own `--default icon.font` (FiraCode Nerd Font on hornet) | the glyph in `text` |
| `icon` emoji | the first run of the title text (Apple Color Emoji is on every Mac) | `icon=<emoji>` | in `text` |
| `icon` `{ image }` / `{ app }` | decoded by `pal_core::icons` to 36 px, non-template; `{ image, template: true }` honoured | `background.image=<cached png>`, `icon.drawing=off` | dropped |
| `title` | the button title (`ImageLeft` of it) | `label=`; empty: `label.drawing=off` and the icon takes the label's right padding (the owner's `icon_only`, lib.sh:45) | `text` |
| `segments` | joined into the title as `glyph text` runs, two spaces apart; colour lost, so the glyph must carry the state | one item per segment (`pal.<ext>.<id>.<seg>`) with its own `icon.color`/`label.color`, in one bracket | joined into `text` |
| `badge` | count appended as ` ·3`; `dot` a 6 px red disc drawn into the icon's corner | count as ` <n>` in red on the label; `dot` = `icon.color=red` | `text` suffix, `class: badge` |
| `color`, `urgent` | the glyph PNG drawn in that colour, non-template; `text`/none stays template | `icon.color`/`label.color` from the map; `urgent` also eases `background.color` once (`--animate sin 8`) | `class: <color>`, `urgent` |
| `stale` | icon at 50% alpha, tooltip "(stale)" | both colours at `muted` (the owner's `stale_mark`, symmetric) | `class: stale` |
| `progress` | a 2 px bar drawn into the bottom of the icon | `━━━───` (8 cells of heavy/light box drawing, the owner's timer rule) before the glyph | `percentage` |
| `tooltip` | `set_tooltip` | none (no tooltips); shown in the popover title | `tooltip` |
| `menu: nodes` | native `tauri::menu` (`MenuItem`, `CheckMenuItem`, `IconMenuItem`, `Submenu`, separators; a section title is a disabled item; `subtitle` dropped, muda has none; `shortcut` as the accelerator hint) | `click_script="<pal binary> bar click <ext>/<id> --anchor sketchybar"` (absolute path: sketchybar's PATH is launchd's), the popover as a menu level under the item's `bounding_rects` | `on-click: pal bar click …`, popover |
| `menu` palette/view, none | `show_menu_on_left_click(false)`; `on_tray_icon_event` Click with `rect` opens the popover / sends `bar/open` | same `click_script`; no sketchybar popups | same |
| position, order | `order` among pal's icons (macOS places the rest) | `--add item NAME <position>`, `--move NAME before|after <ref>` for `before:clock` | the module's place in waybar's config |

### Menu bar renderer (`bar/menubar.rs`)

One `TrayIconBuilder::with_id("pal.<ext>.<id>")` per visible item, built on
the main thread as `tray.rs` does; `hidden` is `remove_tray_by_id` (a fresh
id on return, `tray.rs`'s Linux note), not `set_visible`, so a hidden item
takes no slot. Verified against tauri 2.11.5 (`src/tray/mod.rs`) and
tray-icon 0.24.2 (`src/platform_impl/macos/mod.rs`): `title` is the
NSStatusItem button's title, image `ImageLeft` of it, image scaled to 18 pt
high, `icon_as_template` is `NSImage.setTemplate`, `set_title(None)` leaves
the old text (clear with `Some("")`), `rect()` is the button's frame.

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
carries the item list). Polled every 30 s while the target is on, so a bar
restarted by its own `sketchybarrc` reload (which wipes every item) gets
pal's items re-added; `pal bar sync` at the end of a `sketchybarrc` does it
at once. Items are named `pal.<ext>.<id>` (segments `pal.<ext>.<id>.<seg>`,
grouped by `--add bracket pal.<ext>.<id>.group`); pal creates, sets, moves
and removes only names under `pal.`, and `--remove /pal\..*/` on quit. Every
change is one batched `sketchybar` invocation (the owner measured 3 ms per
call and 10 ms per `--add`; a diff keeps `--add` to first appearance).

Colours: `BarColor` to `0xAARRGGBB` from pal's tokens for `general.theme`
(`app/src/ui/tokens.css`, exported once into `bar/colors.rs`), overridable
per name in `[bar.sketchybar.colors]` so a Catppuccin bar keeps its own
red. Hover highlight, popups on hover, and per-row click scripts are not
rendered: the popover is the one rich surface.

### Linux feed (`bar/feed.rs`, phase 3)

`~/.local/state/pal/bar.json` (`{ "items": { "<ext>/<id>": BarItem & { text, class, percentage } } }`,
atomic write on every change) and `pal bar follow <ext>/<id>` printing one
waybar `custom` JSON line (`text`, `tooltip`, `class` from colour/urgent/
stale, `percentage` from progress) per change for a module with
`"exec": "pal bar follow github/notifications"`, `"return-type": "json"`,
`"on-click": "pal bar click github/notifications"`. A hidden item prints an
empty `text` (waybar collapses it). The tray icon path stays the Linux
default where a StatusNotifier host exists (`tray.rs`'s dlopen).

## Config

```toml
[bar]
target = "auto"            # "auto" (sketchybar when it answers, else menubar) | "menubar" | "sketchybar" | "both" | "off"

[bar.sketchybar]
position = "right"         # default for items: left | right | center | q | e | "before:<item>" | "after:<item>"
colors = { red = "0xffe78284", muted = "0xff737994" }   # overrides of the token map, optional

[bar.items."github/notifications"]
enabled = true             # false: no slot, no timers; the Settings view unsets true
target = "menubar"         # this item only; default the global one
position = "after:pal.github.prs"
hotkey = "ctrl+alt+n"      # opens the item's popover (or its menu as a menu level)
order = 20                 # among pal's own items on the menu bar (left to right ascending) and within a sketchybar position
```

`pal_core::config::Config` gains `bar: Bar` (`core/src/config/mod.rs`, the
schema in `core/schema/config.schema.json`), watched like the rest: a change
re-targets, moves, or removes live. Per-extension settings apply as usual
(`settings.get()` inside `render`). Settings window: a **Bar** tab after
Palettes, a two-pane page in the Palettes shape: the list of every declared
item (extension title as subtitle, a live dot for "visible now", "hidden" in
muted for the rule), the form on the right: enabled, target, position, hotkey,
order, plus the extension's declared settings that carry `"scope": "bar"`.

## Keyboard

- `[bar.items.<key>].hotkey` registers `Target::Bar(key)` in `hotkey.rs`
  (root beats palette beats bar beats item): opens the popover for `{ palette }`
  / `{ view }` / `nodes` (as a menu level), or runs `bar/open`. A native
  NSMenu cannot be popped from a hotkey (Tauri 2.11 wraps no
  `TrayIcon::show_menu`), which is why nodes also have the menu-level form.
- In the popover the panel grammar applies unchanged (`keys.ts`): arrows,
  Enter, `cmd+Enter`, `cmd+k`, Escape hides, `cmd+r` re-renders the item.
- CLI (`cli.rs`, over single-instance like `toggle`): `pal bar list` (every
  item, visible or not, with its last title), `pal bar click <ext>/<id>
  [--anchor sketchybar]`, `pal bar action <ext>/<id> <action>`, `pal bar
  render <ext>/<id>` (force), `pal bar json <ext>/<id>`, `pal bar follow
  <ext>/<id>`, `pal bar sync` (re-apply the sketchybar target).

## Examples

GitHub notifications: a badge, a menu of the last five, the palette on click.

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

Now Playing: the track as the title, play/pause from the menu.

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
popups, `popupsig`, `row_hover.sh`, `hover_guard`, `--trigger` events) are
the renderer's or gone.

| item | what it needs from the model | how | not expressible yet |
| --- | --- | --- | --- |
| prs (`plugins/prs.sh`, `helpers/gh-prs`) | a dim lead glyph and five coloured counts in a fixed order, a lane separator, the OSS glyph red when a drive-by is his move; drawn whenever a PR is open (the by-value exception); 60 s refresh while checks run else 300; stale dimming; serpapi rows dropped off the clock | `icon: "\u{f062c}", color: "muted"`, `segments: [block red, ready green, run amber, wait muted, { text: "│", color: "muted" }, oss]`; `hidden: open.length === 0`; `refresh: nrun ? 60 : 300`; `stale`; the off-clock filter is the extension's (`work_hours` setting, or `dek` shelled from `render`); `menu: { palette: "prs" }`, the popup's sections are the palette's rows with `section`, "checked 3 m ago" is `tooltip` | the menu bar loses the per-count colours (one text colour); the glyph shapes carry the state, which the owner designed them for |
| issues (`issues.sh`, `gh-issues`, `issue-read`) | an @-count in red and a bare assigned count; hidden at zero; a row click that opens and marks the thread read, then refreshes the strip | `segments: [{ icon: "\u{f00e9}", text: nnew, color: "red" }, { text: nmine }]`; `menu: { palette: "issues" }`; the palette's `open` pick does the PATCH and calls `bar.refresh("issues")` (replaces `--trigger issues_change`) | nothing |
| slack (`slack.sh`, `slack-unreads`) | hidden off the clock and at zero; red when a DM or mention is in it; sections DMs / mentions / threads with who, text, where, relative time; "also unread #a #b"; Open Slack | `hidden`, `color: attn_dm ? "red" : "text"`, `title: attn`; `menu: { palette: "slack" }` (rows with `{ date }` accessories, so the hover-swap of the aside is not needed; the quiet channels one inert row; Open Slack an action) | nothing |
| timer (`timer.sh`, `~/.local/bin/timer`) | a 1 Hz countdown, a fill that escalates blue / peach / red, paused muted, done as an alarm with a background; +5 min, Dismiss, Stop all | `progress`, `title: left`, `color`, `urgent` for done; the second-level ticks come from the extension: `bar.update` from an `fs.watch` on `~/.local/share/timer/` plus its own 1 s interval while one runs (the core's `every` floor is for polls, a push has none); `menu: { view }` with the timers as rows and the three actions, replaced in place on every push | a background tint on the strip: `urgent` gives the colour, not a tinted box |
| battery / power (`battery.sh`, `~/.local/share/power/state.json`) | hidden unless draining fast, low, charging low, or `power` has a verdict; colour by level; a loud form with watts and the culprit; a popover of kv sections (draw, breakdown, eating it now, last 24 h, holding it awake, health) and Battery Settings | the extension watches `state.json` (`fs.watch`, replaces `--trigger power_update`) and `bar.update`s; `hidden` by the same rule; `color: crit ? "red" : warn ? "amber" : "muted"`; `title: "4.2 W · chrome"`; `menu: { view }`: `text` rows and `progress` bars per process, `actions: [Battery Settings]` | the `--animate sin 12` colour ease: the sketchybar renderer animates every colour change itself |
| cldd / claude sessions (`cldd.sh`, `cldd-stream.sh`, `claude-state`) | two counts (your turn in yellow, working in blue); hidden at zero; local sessions from `claude-state ls`, marko's over ssh with a short cache when opened; focus a local session, copy the ssh line for a remote one | `segments: [{ text: yours, color: "amber" }, { text: working, color: "blue" }]`; `refresh: { every: 120, on: ["show"] }` and `ctx.reason` picks the ttl; the inotify stream moves into the extension (a long-lived `ssh marko inotifywait` it owns, `bar.update` per line), `claude-state`'s hook runs `pal bar render claude/sessions` instead of `--trigger cldd_change`; `menu: { palette: "sessions" }` with a section per host, `focus` and `copy` as row actions, "copied" as the HUD | the strip's click used to copy `ssh -t marko` without opening anything: with a `menu` the click opens; the copy is the first action inside |

What the catalogue added to the model: `segments`, `progress`, `stale`,
`urgent`, `BarItem.refresh`, `on: ["show"]` with `ctx.reason`, popover content replaced in place on a push, colour eases in
the sketchybar renderer, `tooltip` on a segment. Left to the extensions:
work hours (a setting; the file-first config also lets a `dek` hook write
`enabled = false` under `[bar.items."slack/unread"]` and pal follows live),
caches, and every data source.

## Open questions

- Hover-to-open on sketchybar: the owner's popups open on hover. pal can
  subscribe `mouse.entered` and close on `mouse.exited.global` unless the
  pointer is in the popover, but a popover that appears on a pass-by is
  what the panel's design avoids. Default click; `[bar.sketchybar] hover =
  true` later, or never?
- Native NSMenu at all, or the popover everywhere: one look, one keyboard
  model, and a hotkey can open it (Tauri wraps no `show_menu` for a tray
  icon). Cost: mouse users of the menu bar expect the native menu, and it is
  cheap with `tauri::menu`. The spec keeps both; say if one should go.
- `target = "auto"` when sketchybar quits mid-session: fall back to the menu
  bar (invisible under a hidden macOS bar) or draw nothing until it is back?
- Work hours as a pal notion (a `[bar] profile` the CLI flips, items
  declaring `profile: "work"`) versus each extension asking `dek`.
- Menu bar width: NSStatusItem autosizes and a long title pushes the rest;
  a per-item `max_chars` in config (Raycast has `maxTextLength`), or the
  64-char check alone?
- Persist the last rendered item per key under the profile's data dir and
  draw it before the host is up (Raycast restores menu bar commands without
  running code): the strip would be there at ~400 ms cold like the index.
  Phase 1 optional; not needed for correctness.
- Band separators between adjacent pal items on sketchybar (the owner's
  `sep_prs`/`sep_issues`): a `[bar.sketchybar] separators = true` drawing a
  hairline between visible pal items, or leave grouping to position?

## Phases

Phase 1, native menu and sketchybar (the owner's primary target):

- `sdk/src/protocol.ts` (`BarItem`, `BarSegment`, `BarMenu*`, `BarRefresh`, `ManifestBar`, `BarCtx`, `BarSource`, `Extension.bar`, `Manifest.bar`), `sdk/src/api.ts` (`bar.update/refresh`), `sdk/src/view.ts` (`checkBarItem`), `sdk/src/index.ts`.
- `host/src/host.ts`: `bar/render`, `bar/action`, `bar/open`, `bar/shown`; `extension/loaded` and `hello` carry `bar: ManifestBar[]` merged with the code's keys; `settings/changed` re-renders.
- `core/src/config/mod.rs` + `core/schema/config.schema.json`: `[bar]`, `[bar.sketchybar]`, `[bar.items.<key>]`.
- `app/src-tauri/src/bar/{mod,menubar,sketchybar,glyph,colors}.rs`; `bridge.rs` (`core/bar.update`, `core/bar.refresh`); `index.rs` `on_notification` (register on `extension/loaded`, drop on error/removed); `hotkey.rs` (`Target::Bar`); `cli.rs` (`pal bar list|click|action|render|sync`); `lib.rs` (install, `RunEvent::Exit` removal); `tray.rs` (the id scheme shared); `app/src-tauri/Cargo.toml` (`ab_glyph`), `tauri.conf.json` resources (the TTF), `app/scripts/` (fetch the TTF at the pinned Nerd Fonts release like `icons/build.ts` does its json).
- Settings: `app/src/ui/SettingsBar.tsx`, a tab in `SettingsWindow.tsx`, `settings.rs` `settings_get` carrying the items and their live state, `SettingsTypes.ts`.
- Docs: `docs/extensions.md` (a Bar items section), `docs/config.md` (`[bar]`), `docs/cli.md`.
- Tests: host harness renders/actions on a fixture extension; Rust tests on the sketchybar batch builder (pure: item to argv), the diff, the colour map, the glyph rasteriser. No popover yet: a `{ palette }` click opens the main panel in that palette (`show_in`), `{ view }` and nodes off the menu bar wait for phase 2.

Phase 2, the popover with the view tree:

- `app/src/main.tsx` (`?bar`), `app/src/BarPage.tsx` (the Launcher on one level, no root, the menu level built from nodes in `app/src/items.ts`), `app/src/ui/keys.ts` unchanged.
- `app/src-tauri/src/panel/macos.rs` (a third `tauri_panel!` module like `hud`), `panel/linux.rs`, `bar/popover.rs` (place under the anchor, show, hide on resign key, `pal://bar` event with the item and its menu), `effects.rs` (hide the window the pick came from), `index.rs` (`push`/`keep` scoped to the popover's level; a `bar.update` while open replaces the view or relists the palette).

Phase 3, Linux:

- `bar/feed.rs` (`~/.local/state/pal/bar.json`), `cli.rs` (`pal bar json|follow`), `notes/linux.md` (the waybar module), the `network` trigger on both platforms, tray-icon `title` for the StatusNotifier path where the host shows it.
