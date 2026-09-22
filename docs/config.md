# Config

One TOML file holds every setting: `~/.config/pal/config.toml`
(`$XDG_CONFIG_HOME/pal/config.toml` when that variable is set, on macOS
too). The file is the source of truth. The Settings window reads and writes
it, and a hand edit is picked up live. A key you do not set has its default;
an empty or missing file is all defaults.

## The file

```toml
#:schema https://raw.githubusercontent.com/zcag/pal/main/core/schema/config.schema.json
# pal settings. The settings view writes this file; editing by hand is fine too.

[general]
hotkey = "ctrl+space"      # global hotkey, or several: ["cmd+space", "ctrl+space"]; "" turns it off (bind `pal toggle` instead)
theme = "system"           # system | light | dark
position = "top"           # top | centre | last
launch_at_login = false
menu_bar_icon = true
check_updates = true
ask_permissions_on_start = true   # macOS: ask for Accessibility on first show
selection_snapshot = true         # {selection}: fall back to a copy shortcut when the app hides its selection from the accessibility API
deeplink_confirm = true    # a pal:// link that acts asks first; false never asks; ["timer"] asks except for those extensions
extension_dirs = ["~/dotfiles/pal-extensions"]   # extra extension roots, loaded after the store

# Per-palette settings, keyed by palette id. Absent palette: all defaults.
[palettes.clipboard-history]
alias = "cb"               # extra keyword on the palette's row at the root
hotkey = "ctrl+shift+v"    # opens pal straight inside this palette

[palettes.windows]
hold = "alt+tab"           # the switcher chord (the manifest suggests this one; "" turns it off)

[palettes.calc]
icon = "∑"                 # replaces the extension's icon on the palette row

[palettes.windows]
enabled = false            # no rows in the index, no palette row

[palettes.emoji.settings]  # settings the extension declared for this palette
columns = 8

# Extension settings, keyed by extension name. Shape is whatever the
# extension declared in its pal.json.
[extensions.clipboard]
exclude_apps = ["com.1password.1password"]
primary_action = "copy"

[extensions.apps]
folders = ["~/Applications/Nix Apps"]

[extensions.github]
token = "keychain:pal/github-token"   # a secret reference, never the value
```

The first line is taplo's schema directive, pointing at the committed
schema's URL (`core/schema/config.schema.json` on `main`), so an editor
with TOML schema support (VS Code "Even Better TOML", nvim through taplo)
validates keys and completes them; taplo fetches it. The first launch
writes those two header lines and nothing else into the config directory.

## `[general]`

| key | type | default | what |
| --- | --- | --- | --- |
| `hotkey` | string, or list of strings | `"ctrl+space"` | Global hotkey that shows pal, or several that all do: `hotkey = ["cmd+space", "ctrl+space"]`. Every entry registers; one another app or Spotlight holds is reported on its own row in Settings and costs the others nothing. Empty (`""` or `[]`) turns it off, for a compositor keybind that runs `pal toggle` instead. Settings writes back whichever spelling the file has, and turns a string into a list only when Add another gives it a second entry (up to three there; the file may hold more). The menu bar hint and the Welcome tips show the first. |
| `app_switcher` | string | unset | macOS's own App Switcher (Cmd+Tab's) on another Tab chord, `"alt+tab"`, for when `palettes.windows.hold = "cmd+tab"` has taken cmd+tab: pal's event tap turns the chord into a held Cmd+Tab for the Dock (its `shift+` variant steps back), so it needs Input Monitoring like `cmd+tab` does. A `hold` chord equal to it is dropped with a log line. Settings › General has it on the Window switcher card. macOS only. |
| `theme` | `system`, `light`, `dark` | `"system"` | Follow the OS, or force one. Applied live to the panel and the Settings window. |
| `theme_file` | string | `""` | A theme file overriding pal's colours, radii and fonts ([Theme file](#theme-file)): a name, looked up as `<config dir>/themes/<name>.toml` (`"catppuccin-frappe"`), or a path (`"~/dotfiles/pal-theme.toml"`). Its `[light]` and `[dark]` sections apply to whichever scheme `theme` (or the OS) picks; the file is watched and a save applies live. Settings > General > Theme file picks one from the folder. Empty is pal's own look. |
| `compact` | bool | `false` | Compact mode: the panel 560 px wide with 32 px rows, no detail pane, and the footer folded into the search row (the primary action's hint on its right; `⌘K` still lists everything). `⌘⇧M` in the panel flips it and writes it here, so it is remembered per profile. The gallery shows both. |
| `position` | `top`, `centre`, `last` | `"top"` | Where the panel appears on the screen with the pointer. `top`: a fifth of the way down, where Spotlight and Raycast sit. `centre`: centred. `last`: wherever it was last shown. On Wayland the compositor places the window and this key does nothing (see [Getting started](getting-started.md)). |
| `launch_at_login` | bool | `false` | Start pal when you sign in: a LaunchAgent (`~/Library/LaunchAgents/io.cagdas.pal.plist`) on macOS, a `pal.service` user unit (or, without systemd, an XDG autostart entry) on Linux. The same agent relaunches pal after a crash, on or off; see [Crash relaunch](#crash-relaunch). |
| `menu_bar_icon` | bool | `true` | Show pal's icon in the menu bar (macOS) or system tray (Linux). The app has no Dock icon, so this is the visible way to reach Settings and Quit; the hotkey and `pal settings` work without it. |
| `check_updates` | bool | `true` | Look for a newer release 20 s after startup and once a day, in release builds (the GitHub release manifest; nothing is downloaded by the check). A found release shows on the Overview and the About page and as an "Install Update" row at the root; installing is always your click (Settings › About, the Overview's row, that root row), never automatic. `false` means no automatic check at all: neither this one nor the settings Overview's (which otherwise checks the app and the store's extensions when it opens, at most once a day). The Overview's "Check now", About's "Check for Updates", the menu bar's "Check for updates…" and the "Check for Updates" row run regardless. See [Updates](getting-started.md#updates). |
| `extension_dirs` | list of paths | `[]` | Extra directories of extensions, one subdirectory per extension like the store, for a dotfiles-managed set. Loaded after the bundled extensions and the store, in order, so a later directory's extension replaces an earlier one's by name. `~` is expanded. Read when the host starts: `pal reload` after a change. See [Extensions](extensions.md). |
| `ask_permissions_on_start` | bool | `true` | macOS: ask for the Accessibility permission (the system prompt, and System Settings opened on that pane) the first time the panel shows on a profile that has not hidden the Welcome tips yet. Paste and window switching need it. `false` leaves the ask to the Welcome row and to Settings > General > Permissions. Nothing on Linux. |
| `selection_snapshot` | bool | `true` | When an app does not expose its selected text to the accessibility API (`selection.text()`, `{selection}` in a snippet), send the copy shortcut and read the clipboard, then put it back as it was; pal's own history records none of it. `false` keeps pal off the clipboard: the selection is then only what the API reports. macOS needs Accessibility for either. |
| `root_caps` | table | `{ primary = 8, normal = 6, catalog = 3 }` | How many rows one palette may show at the root for a typed query, by its tier ([Extensions](extensions.md#tier-what-the-rows-are-at-the-root)); the rest is a "12 more in Emoji" row that opens the palette. Inline, `root_caps = { catalog = 5 }` keeps the other two at their defaults. The empty query and a palette's own level are never capped. |
| `root_first` | list | `["browser-tabs/tabs", "windows/windows", "apps/apps", "pal/palettes"]` | Palettes whose rows lead the others of their standing at the root, in this order: a tab over a window over an app over a palette row (`pal/palettes` is the row that opens a palette), all over the rest. Each is `root_first_step` points above the next, on top of its tier; the ladder orders rows that are otherwise level and never lifts a row that only scatters the typed letters over one that has the word, nor a normal row over a primary one. `[]` turns it off; then the shorter name leads among equals. Ranking tweaks: this, `root_first_step`, `root_cut`, `root_caps`, and `tier` per palette (below). |
| `root_first_step` | number | `30` | Points between two `root_first` palettes. The word bonus is 300 and the tier spread 150 (the ladder in `core/src/index.rs` under `EXACT_BONUS`), so keep the whole ladder (step times the list's length) under 150 for the rules above to hold. |
| `root_cut` | bool | `true` | At the root, a palette with a row that has the typed word shows only those rows: `spo` is Spotify, not Spotify and six apps that spell it out of their bundle ids. The rest stay in the "N more" row. `false` leaves every match to `root_caps`; fuzzy typing works either way (a query no row has as a word cuts nothing). |
| `fallbacks` | list of strings | `["web", "url", "quicklinks", "calc", "files"]` | The rows offered when a typed query matches nothing, in this order ([Getting started](getting-started.md#the-root-inline-answers-fallbacks-and-the-empty-list)): `web` is Search the web (through `search_engine`), `url` is Open as URL (only when the query reads as one: a scheme, or `docs.rs/serde`, `localhost:8080`), and the rest are palette ids that opted in (`quicklinks` lists every `{query}` link filled in, `calc` and `files` open with the query typed, any other input palette that declared it as "Ask `<name>`"). A fallback palette not named here comes after these, in load order; an id that names nothing is skipped. |
| `fallbacks_always` | bool | `false` | Show the fallback rows under the hits as well, not only when nothing matched. |
| `search_engine` | string | `"https://www.google.com/search?q={query}"` | The Search the web fallback's URL; `{query}` is percent-encoded into it (`https://duckduckgo.com/?q={query}`, `https://kagi.com/search?q={query}`). Without the placeholder the query is appended. |
| `backspace_back` | bool | `true` | Backspace with nothing typed leaves the level you are in (a palette, a browsed folder, a show level; a form's fields keep it), the way `cmd+backspace` does; never at the root. A row that uses Backspace itself (the `..` row's Go up in a browsed folder) comes first, and a view level's keys are its own. `false` leaves Backspace to the row alone. Settings > General > Keyboard. |
| `alias_space` | bool | `true` | Typing a palette's alias (or its palette name, or its one-word title) and a space at the root jumps into that palette with whatever follows typed there: `em cat`, `calc 2+2`, `files report`. Only a word typed forward jumps (a deletion never does), and only when exactly one palette answers to it. `false` leaves the space as a character. |
| `search_history` | bool | `true` | Remember the last 20 root queries that led to a pick (in `frecency.json` under the profile, never synced). Up at the top of an empty root list recalls them, newest first; Down walks back; Escape clears. "Clear Search History" in pal's own commands empties them. `false` neither records nor recalls. |
| `pop_to_root` | `"always"`, `"never"`, `"after 90s"` | `"after 90s"` | Where a re-show lands: `"always"` back at the root with an empty box, `"never"` where you left (the level and the query kept), `"after 90s"` (any number of seconds; `2m`, `1h` read too) kept while the panel was hidden for less than that, the root after. A palette hotkey opens its palette either way. |
| `now` | list of strings | `["calendar-today", "timer-timers", "media", "clipboard-rows"]` | The palettes whose suggestions lead the empty root (the "Now" section: the next event, the running timer, what is playing; the "Clipboard" section: what is on the clipboard), in this order; suggesting palettes not named here follow in load order. |
| `deeplink_confirm` | bool or string[] | `true` | A `pal://` link that acts (`run`, `form`, `paste`, `open?url=`, a bar action, an extension's route; a web page can emit one) shows a card naming what it is about to do. `false` runs it straight away, for a machine that scripts pal by link; a list of extension names (`["timer", "quicklinks"]`) asks for everything except links into those extensions. `install`, `update` and `remove` always ask; the `pal` commands never do. See [Links](links.md). |

Hotkey syntax: modifiers first, `+` between, one main key, case does not
matter. Modifiers: `ctrl` (or `control`), `alt` (or `option`), `cmd` (or
`command`, `super`), `shift`, `cmdorctrl` (Cmd on macOS, Ctrl elsewhere).
Keys: letters, digits, `space`, `enter`, `f1`..`f12`, punctuation and the
rest of the usual key names. A `general.hotkey` entry that does not parse
is reported and skipped; when none parses the first falls back to
`ctrl+space` and is logged, so pal stays reachable. A hotkey another app
already holds is reported and skipped: the other entries still register,
and when none of them could be had the previous root hotkeys stay
registered. Settings > General says "Not registered" with the OS's reason
under that entry's field, and the Overview names it. On macOS `cmd+space`
is Spotlight's until "Show Spotlight search" is unticked under System
Settings > Keyboard > Keyboard Shortcuts > Spotlight; pal reads that
binding, says so in Settings, and while the key is wanted and held polls
it every 2 s so the registration lands as soon as it is freed. On Linux
the hotkey reaches only X11 clients; Wayland sessions bind `pal toggle`
in the compositor.

## Theme file

`general.theme_file` names a TOML file of the `--pal-*` tokens a user may
override (`pal_core::theme`): the colours, the tag palette, the brand
tiles, the radii and the two font stacks. Geometry, spacing and motion
stay pal's. A file has a `name`, keys shared by both schemes at the top
level, and a `[light]` and a `[dark]` section for the rest:

```toml
name = "Catppuccin Frappé"
radius_row = 6            # both schemes

[light]
accent = "#8839ef"
bg = "#eff1f5"

[dark]
accent = "#ca9ee6"
bg = "#303446"
```

The section applied is the scheme in force: `theme = "dark"` pins dark,
`"system"` follows the OS and swaps the section when the OS flips. Every
window (the panel, the HUD, Settings, the bar popover) sets the section's
variables on its `:root`, so a themed panel and a themed Settings window
agree. The file is watched (an mtime poll every second): a save applies
live, as a config edit does.

Two examples ship in `examples/themes/`: Catppuccin Frappé (with Latte
as its light section) and Rosé Pine Dawn (with Rosé Pine as its dark
one). Settings > General > Theme file lists the files in
`<config dir>/themes/` (the folder is made with the two examples in it the
first time that page looks for it; "Open themes folder" seeds an empty
one), sets `theme_file` to the chosen name, and "Edit theme file" opens
the file in the editor. Its diagnostics show under the picker and in the
log (lines starting `theme`).

Every key is checked: an unknown key is a warning naming its dotted path
(`light.accnet: not a theme token`), a value of the wrong shape is
dropped with a warning (`dark.accent: ignored: expected a colour`), and
the rest applies. A file that does not parse is one error with its line
and no theme. A colour is `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, or an
`rgb()`, `rgba()`, `hsl()`, `hsla()` call; a radius is a number of pixels
(`14`, `6.5`, `"14px"`); a font is a stack as CSS writes it.

The tokens, each `<key>` driving `--pal-<key>` with `_` as `-`:

| key | kind | what |
| --- | --- | --- |
| `accent`, `accent_fg`, `accent_soft` | colour | The accent (the caret, the focus ring, the switch), the ink on it, its tint |
| `bg`, `bg_glass`, `bg_elevated`, `bg_sunken` | colour | The panel's colour, the glass it is drawn with (give it alpha), a card, a well |
| `fg`, `fg_muted`, `fg_faint` | colour | Text: titles, subtitles and accessories, section headers and hints |
| `line`, `line_strong` | colour | Hairlines; the stronger one on controls |
| `selection` | colour | The cursor's pill on a row |
| `scrim` | colour | Behind the action panel and a confirm card |
| `match` | colour | The highlighter on matched letters |
| `knob` | colour | A switch's knob |
| `destructive`, `destructive_soft` | colour | A destructive action, its tint |
| `success`, `success_soft` | colour | A success toast, its tint |
| `tag_grey`, `tag_blue`, `tag_green`, `tag_amber`, `tag_red`, `tag_violet`, `tag_pink`, `tag_teal` | colour | The tag palette's ink: tags, badges, coloured text in a view |
| `tag_<colour>_bg` (the same eight) | colour | The tag palette's fills |
| `brand_red`, `brand_orange`, `brand_amber`, `brand_green`, `brand_teal`, `brand_cyan`, `brand_blue`, `brand_indigo`, `brand_violet`, `brand_pink`, `brand_slate`, `brand_ink` | colour | The icon tiles' twelve colours ([Extensions](extensions.md#icons)) |
| `tile_fg`, `tile_ring` | colour | The mark on a tile, the hairline around it |
| `radius_panel`, `radius_popover`, `radius_hud`, `radius_tile`, `radius_row`, `radius_icon`, `radius_control`, `radius_tag`, `radius_kbd` | px | The corners: the panel, the bar popover, the HUD, a tile, the cursor's pill, an icon box, a field or button, a tag, a key cap |
| `font_ui`, `font_mono` | font | The text and code stacks (`"Inter, sans-serif"`, `"JetBrains Mono, monospace"`) |

The values pal ships with are in `app/src/ui/tokens.css` (`--pal-*`,
light and dark), the place to read what each token looks like before
overriding it; the brief (`app/design/brief.html`) shows them on the
components.

## `[palettes.<id>]`

Settings pal provides to every palette without the extension declaring
them. A palette absent from the file gets the defaults.

| key | type | default | what |
| --- | --- | --- | --- |
| `enabled` | bool | `true` | `false` removes the palette's rows from the index and its row from the root. The palette stays known, so re-enabling is immediate. The settings view unsets the key rather than writing `true`. |
| `alias` | string | unset | A short name for the palette. It is added as a keyword on the palette's row at the root, so typing it finds the palette; `Enter` opens it. |
| `hotkey` | string | unset | A global hotkey that opens pal directly in this palette. Same syntax as `general.hotkey`; the root hotkey wins a clash. Registered once the palette exists. |
| `hold` | string | unset, or what the manifest suggests | The switcher chord ([Keyboard](keyboard.md#switcher)): tapped, it switches to the previous window at once (Windows; one further per extra press); held past 150 ms, it shows the palette flat (no sections, the index's order) with the cursor on row 2, every further press steps down, its `shift+` variant up, and letting go of the modifier runs the row under the cursor. Same syntax as `hotkey`; the chord and its `shift+` variant both register, after the root and palette hotkeys in a clash, before a bar item's or an item's. An extension may suggest one in its manifest (`palettes.<name>.hold` in `pal.json`: Windows suggests `alt+tab`), which applies when the file has no `hold` line; `hold = ""` turns it off. A chord with no modifier (`f13`) has no release: presses step, Enter runs. `cmd+tab` replaces the App Switcher: the Dock owns that chord, so pal takes it with an event tap, which needs Input Monitoring, asked once when you set it (the Overview lists it with Grant until then). On Linux the compositor drives the same machine with [`pal switch`](cli.md#pal-switch). Settings › Palettes edits it (the selected palette's Switcher chord row: the recorder shows the manifest's suggestion greyed while the file has no `hold` line, Clear writes `""`), and Settings › General has the Windows palette's as its own Window switcher card. |
| `item_hotkeys` | table of strings | `{}` | Global hotkeys that run one item of the palette without showing the panel, keyed by the item's id: the item's primary action runs as if you had pressed `Enter` on it, and whatever it shows after hiding (the HUD) still shows. `[palettes.window-management.item_hotkeys]` with `left_half = "ctrl+alt+left"` is the case it exists for ([Window Management](palettes.md#window-management-window-management-window-management-arrange)); any palette's item ids work, an indexed palette's being the stable ones. Same syntax and registration as `hotkey`; in a clash the root hotkey wins, then a palette's, then an item's. Settings › Palettes edits them too: the selected palette's pane has an Item hotkeys table (the id typed, or picked from the palette's indexed rows; a recorder per row; Remove), written one key at a time so a hand-written table keeps its other lines, and the Overview counts them. |
| `icon` | string | unset | Icon override for the palette's row; the extension's own icon when unset. A glyph, an emoji or a hex colour. |
| `tier` | `primary`, `normal`, `catalog` | unset | The palette's tier at the root over what its manifest says: `primary` is ranked up and capped at `root_caps.primary` rows, `catalog` ranked down and capped at `root_caps.catalog` ([Extensions](extensions.md#tier-what-the-rows-are-at-the-root)). `tier = "catalog"` on a data-file palette whose rows flood the root; `tier = "primary"` on one you reach for by name; Settings › Palettes has it as "At the root". |
| `settings` | table | `{}` | Settings the extension declared for this palette, from `palettes.<key>.settings` in its `pal.json`. `[palettes.emoji.settings]` or inline `settings.columns = 8`. |

The id is the extension's name when the palette is named like it (`apps`,
`emoji`, `calc`, `system`, `windows`, `bookmarks`), else
`<extension>-<palette>` (`clipboard-history`; a script palette named `otp`
is `scripts-otp`). Bare keys, no quoting.

## `[bar]`

Bar items: what extensions put on the macOS menu bar or on sketchybar
(the design in `docs/design/bar.md`; what an extension declares in
[Extensions](extensions.md)). Every item is keyed `<extension>/<id>`.
Not drawn on Linux: the table is read and kept there, declared items are
listed by `pal bar list`, but nothing is drawn and no item renders
(Settings > Bar says so).

| key | type | default | what |
| --- | --- | --- | --- |
| `target` | `"auto"`, `"menubar"`, `"sketchybar"`, `"both"`, `"off"` | `"auto"` | Where items are drawn. `auto` is sketchybar when `sketchybar --query bar` answers (probed at start, on a `[bar]` change, on wake and on a Space change), else the menu bar. |
| `hover_delay` | integer, ms | `250` | How long the pointer rests on an item before its popover peeks. |
| `hover_grace` | integer, ms | `400` | How long after the pointer has left both the item and the popover a peek stays. |
| `menubar.open_on_hover` | bool | `false` | A hover peeks on the menu bar (Apple's bar has no hover convention, so off). |
| `sketchybar.open_on_hover` | bool | `false` | A hover peeks on sketchybar; off, a click opens and closes, like the menu bar. |
| `sketchybar.position` | string | `"right"` | Where pal's items go: `left`, `right`, `center`, `q`, `e`, or `before:<item>` / `after:<item>` next to one of the bar's own items. |
| `sketchybar.colors` | table of strings | `{}` | Overrides of the colour names the model uses (`red`, `amber`, `muted`, `text`, ...) as `0xAARRGGBB` or `#rrggbb`, so a themed bar keeps its own palette. |

**Appearance.** `[bar.menubar]` and `[bar.sketchybar]` both take these
keys, how that target draws every item; each is overridable per item
below. The same key means the same thing on both targets where the target
can (Settings > Bar > Defaults shows each with its description and the
target's caveat).

| key | type | default | what |
| --- | --- | --- | --- |
| `dim` | int, percent | `50` | A muted item's strength: a stale item, or one the extension colours `muted` (a paused timer), draws at this opacity. Menu bar: the template image's alpha (the title text keeps the bar's colour unless prerendered, below). sketchybar: the alpha of the `muted` colour. |
| `opacity` | int, percent | `100` | The item's strength: every colour it draws (icon, text, segments, badge) at this alpha. A muted item is at `dim` of this (the two multiply: `opacity = 60`, `dim = 50` draws a stale item at 30). sketchybar: the alpha of every colour (an image icon keeps its own). Menu bar: the image's alpha; under 100 the text is prerendered into the image so it fades too. |
| `size` | number, points | `0` | Point size of the glyph and the text; `0` is the target's own (the menu bar's 13 pt text and 14 pt glyph; sketchybar's icon and label font size). On the menu bar a size prerenders the text into the icon image. |
| `icon_size` | number, points | `0` | Point size of the glyph alone; `0` follows `size`. |
| `text_size` | number, points | `0` | Point size of the title and the segments alone; `0` follows `size`. |
| `spacing` | int, points | `4` | Between the icon, the title and the segments. sketchybar: the paddings. Menu bar: only a prerendered strip takes it; Apple sets the gap otherwise. |
| `show_icon` | bool | `true` | Draw the icon. |
| `icon` | string | unset | A glyph, an emoji or a short text drawn as the icon in place of the one the extension answers (what an extension's `icon` takes as a string), or a picture: an absolute or `~/` path to an image file (PNG, JPEG, GIF, SVG, fitted into the icon's square), a `data:image/` URI or an `icon://` url. A picture keeps its own colours (no tint, non-template on the menu bar) and the count goes into the title text. Meant per item: every item the same icon is no bar, so a target leaves it unset. |
| `show_title` | bool | `true` | Draw the title and the segments; off is a glyph-only item. An item with nothing left to draw takes no slot. |
| `color` | string | unset | The tint: a colour name (`grey`, `blue`, `green`, `amber`, `red`, `violet`, `pink`, `teal`, `accent`, `text`, `muted`) or `#rrggbb`, drawn in place of the colour the extension answers (`muted` from the extension stays: it is a state). Unset keeps the extension's: a coloured item its own, the rest the bar's text colour. Menu bar: the glyph's ink; the title text keeps the bar's colour unless prerendered. |
| `urgent_color` | string | `"destructive"` | The colour of an urgent item, a name or `#rrggbb`. |
| `badge_color` | string | unset | The colour of a count badge and a dot, a name or `#rrggbb`. Unset draws them in the item's own colour (the tint; `urgent_color` while urgent; `muted` while stale), so a mail count is not red by default; `"red"` on a target brings the old red back. Menu bar: the dot's colour, and a set colour prerenders the text into the image so the `·3` can wear it. sketchybar: the `.badge` item's colour, a dot's `icon.color`. |
| `badge_style` | `"count"`, `"dot"`, `"none"` | `"count"` | How a count badge is drawn: the number (`·3` after the title on the menu bar, a `.badge` item after sketchybar's label), a dot whatever the number, or nothing (the count stays in the tooltip). |
| `width` | int, points | `0` | A fixed width, so a ticking timer does not move its neighbours; `0` is the natural width. Text past it is cut. Menu bar: the prerendered image's width. sketchybar: `label.width`. |
| `font` | `"system"`, `"mono"` | `"system"` | The text's face; `mono` for codes and times (SF Mono on the menu bar, prerendered; Menlo on sketchybar). |
| `max_chars` | int | `32` | The longest title an item draws; longer text ends in an ellipsis, since Apple's bar hides whatever runs under the notch or off the left edge (sketchybar: `label.max_chars`). |

The menu bar's title is a plain system-font string (tray-icon sets no
attributes), so `size` (`icon_size`, `text_size`), `font`, `width`,
`opacity` under 100 and a set `badge_color` make the renderer prerender the
title into the icon image next to the glyph (`bar/glyph.rs`, the system's
own SF Pro or SF Mono read from `/System/Library/Fonts`); an emoji icon
stays title text, an image icon keeps its picture and its title text.
sketchybar has no way to unset a property, so an item whose `size` or
`font` goes back to the bar's own is removed and added afresh, which gives
it the bar's `--default`s again.

Per item, `[bar.items."<extension>/<id>"]` (the key needs quoting):

| key | type | default | what |
| --- | --- | --- | --- |
| `enabled` | bool | `true` | `false` takes the item off every target and stops its refresh. |
| `show` | `"auto"`, `"always"` | `"auto"` | What the item does with its slot when its render says `hidden`: `auto` takes it off the strip; `always` keeps the quiet shape the render offers (`BarItem.empty`: the glyph, an honest tooltip such as "No unread mail", the same popover; weather's reading as the title), muted, without a badge or segments, in the item's own frame. An item whose render offers no such shape (signed out) hides either way. Read at draw time, so a flip needs no re-render. |
| `show_when` | string | unset | A state expression (`[states]`, below): the item is on the strip only while it is true (`working`, `hour >= 9 and not deep`). Read at draw time; nothing renders while it holds the item off, and the flip back renders once. |
| `hide_when` | string | unset | The opposite: off the strip while true. Both may be set; hidden when either says so. |
| `rules.<id>` | table | unset | The item's presentation rules by id (`[bar.items."power/battery".rules.low]`): an extension's rule overridden key by key (`when`, `hidden`, `urgent`, `position`, `description`, and the appearance keys above), or a rule of your own (which needs `when`). Below, "Rules". |
| `target` | as above | unset | This item's target; the global one when unset. |
| `position` | string | unset | This item's sketchybar position; `sketchybar.position` when unset. |
| `hotkey` | string | unset | A global hotkey that opens the item's popover (or runs its open action). Same syntax as `general.hotkey`; the root and palette hotkeys win a clash. |
| `open_on_hover` | bool | unset | This item's say on hovering; the target's default when unset. |
| `order` | integer | `0` | Order among pal's own items, ascending left to right (on the menu bar, and within one sketchybar position). |
| `dim`, `opacity`, `size`, `icon_size`, `text_size`, `spacing`, `show_icon`, `icon`, `show_title`, `color`, `urgent_color`, `badge_color`, `badge_style`, `width`, `font`, `max_chars` | as above | unset | This item's say on each appearance key; the target's default when unset (the menu bar's for an item drawn there, sketchybar's for one drawn there). Settings > Bar marks each inherited field "from the menu bar default" and offers Reset on an overridden one; `icon` is the one key its pane alone shows (a target-wide icon makes no sense). |

A change re-targets, moves or removes items live. pal only ever touches
sketchybar items named `pal.<extension>.<id>` (a segment is
`pal.<extension>.<id>.<segment>`, a count badge `pal.<extension>.<id>.badge`);
the bar's own items are never touched, and every pal item is removed on
quit. A bar restarted by its own rc (which wipes its items) gets pal's
back at the next probe, or at once with `pal bar sync` at the end of the
rc.

## Rules: presence, urgency and appearance by state

An extension's bar item states its facts with every render (`power/level`,
`power/charging`, `spotify/playing`, `calendar/phase`: the States palette
lists them, and the item's pane under Settings > Bar shows them live) and
declares in its `pal.json` the **rules** that turn those into how the item
draws: while a rule's `when` (a state expression, as `[states]` below)
holds, the item is hidden, urgent, moved, or drawn with the appearance
keys of this table. Rules apply in the extension's order, later wins.
The extension no longer decides presentation in its code, so every one of
those decisions is yours to move:

```toml
[bar.items."power/battery".rules.low]
when = "power.level < 25"            # the extension's rule, its threshold moved

[bar.items."power/battery".rules.fine]
hidden = false                       # keep the healthy battery on the strip

[bar.items."media/now-playing".rules.paused]
hidden = false                       # a paused track stays, muted (the rule's own tint)

[bar.items."power/battery".rules.focus]   # a rule of your own
when = "not working"
hidden = true
color = "muted"
```

A key you set replaces the extension's for that rule; a key you leave
keeps the extension's. Settings > Bar lists an item's rules with the
condition, what each does, whether it holds now and where it comes from,
and edits them the same way. A rule's `hidden` is decided at draw time
after the render (the item keeps rendering, since its facts come from the
render); `show_when`/`hide_when` above hold an item off without a render.
A rule's `color` wins over a `muted` the render answered, since the rule is
the decision; the item-level `color` key above leaves `muted` alone.

## `[states]`

Named variables the whole of pal reads (`docs/design/states.md`): the
bar items' `show_when`/`hide_when`, an extension's `state.get`, `pal
state`. A state is yours: it exists because `[states.<name>]` is here, or
because `pal state set <name> …` was run once. pal ships no meaning for
"working"; it ships `hour` and `weekday` and you write the rule.

```toml
[states.working]
expr = "weekday not in ['sat', 'sun'] and hour >= 9 and hour < 18 or sessions.working > 0"
description = "On the clock"      # what the States palette shows

[states.deep]                     # no expr: only ever set by hand or from outside
default = false

[bar.items."github/prs"]
show_when = "working"
```

| key | type | default | what |
| --- | --- | --- | --- |
| `expr` | string | unset | A Jinja expression over other states (`and`, `or`, `not`, `in`, comparisons, `x if c else y`, filters), re-evaluated whenever a state it names changes. An extension's state is `sessions.working` here (its states as a map under its key, since `/` divides); any name at all is `states['gmail@work/unread']`. A state it names that nothing has fed reads `none`; an expression that fails to parse or evaluate is a diagnostic and reads `null`. A cycle is a diagnostic and both read `null`. |
| `default` | bool, number, string | `false` | The value with nothing set and no expression. A state holds a scalar, never a table or a list. |
| `description` | string | unset | The palette's subtitle. |

**Names.** Lowercase letters, digits, `_`. The built-ins are reserved
(`hour`, `minute`, `weekday`, `date`, `front_app`, `awake_since`,
`network`, `theme`, `locked`, `idle`, `host`, `panel`); an extension's
are `<key>/<name>` (`sessions/working`, `gmail@work/unread`) and only it
can feed them.

**Resolution.** A value set by hand (`pal state set`, the palette; with an
optional expiry) wins, else `expr`, else what an extension or a built-in
published, else `default`. `pal state reset <name>` drops the manual value.
The manual and published layers survive a relaunch (`states.json` under
pal's data directory, next to `bar.json`); the built-ins are read afresh.

## `[sidebar]`

A live palette docked to a screen edge (the design in
`docs/design/switcher.md`): it peeks the moment the pointer touches the edge (`delay`), centred on
the pointer, and closes `grace` after the pointer has left;
a click into the peek, a key while it is up, or its hotkey engages it
(key: typing filters, Enter runs, Escape hides). Every row wears its
number, and `cmd+N` (`ctrl+N` on Linux) runs row N without a search, so
the numbers on screen are the promise. One sidebar; macOS only for now:
on Linux the table is read and validated, nothing is built.

```toml
[sidebar]
palette = "windows/windows"   # any palette; unset or "" = no sidebar (the default)
edge = "right"                # left | right
display = "cursor"            # cursor | primary | a display's name
width = 280
peek = true
delay = 0                     # ms the pointer rests at the edge before the peek
grace = 150                   # ms after the pointer has left before a peek closes
hotkey = "ctrl+opt+tab"
```

| key | type | default | what |
| --- | --- | --- | --- |
| `palette` | string | unset | The palette it shows, `<extension>/<palette>`; `windows/windows` is the one built for it. Unset or `""` is no sidebar (no window, no strip, no hotkey): an edge that peeks when the pointer rests there is asked for, never on by default. A live palette lists again on every show, as it does for the panel. |
| `edge` | `"left"`, `"right"` | `"right"` | The edge it docks to, 8 px in from it; the window is centred on the pointer's height when the pointer brought it (the peek, a click), at the top of the work area from the hotkey. |
| `display` | string | `"cursor"` | Which display: `cursor` (the one under the pointer at each show; a peek strip on every display), `primary` (the one with the menu bar), or a display's name as the OS reports it (`Built-in Retina Display`; an unknown name falls back to the cursor's, with a log line). |
| `width` | number, points | `280` | The window's width; the height follows the rows, up to the work area. |
| `peek` | bool | `true` | The pointer resting at the edge peeks it; `false` leaves the hotkey and nothing at the edge. |
| `delay` | number, ms | `0` | How long the pointer rests at the edge before the peek; `0` is at once. |
| `grace` | number, ms | `150` | How long after the pointer has left the edge and the window a peek stays before it closes. |
| `hotkey` | string | unset | A global hotkey that engages it (shown key from hidden, or a peek made key). Same syntax as `general.hotkey`; the root, palette and bar item hotkeys win a clash. |

Settings › General edits the whole table as its Sidebar card (the switch
puts `windows/windows` in `palette` and Off writes `""`; the palette, the
edge, the display by the names the OS reports, the width, the peek and the
hotkey each write their key, a value at its default leaving the file);
Settings › Bar lists the sidebar next to the bar items and points there.

`show_when` / `hide_when` (the sidebar following a named state, as a bar
item does) are not read yet.

## `[extensions.<name>]`

Extension settings, keyed by extension name. The shape is whatever the
extension declared in its `pal.json`; the defaults live there and the
[Palettes](palettes.md) page lists them for the bundled extensions.

The values an extension sees are the manifest's defaults with every key you
set on top, one level deep: a key you set replaces the default whole (a
list is not appended to, a table not merged). Keys the manifest does not
declare pass through, so a setting written ahead of an upgrade is not lost.
A declared setting set to its default is unset by the settings view, so the
file only holds what differs.

Changes reach a running extension without a restart: the core pushes the
resolved values and lists the extension's palettes again. Three exceptions:
`emoji`'s `columns` is read once at load (edit the file, then Settings >
Restart extension host); the `scripts` extension discovers its palettes
once at import, so its `config`, `skip`, `v1_repo` and `ttl` need a host
restart too (`timeout` and `preview_max` apply to the next run); and the
clipboard recorder, which runs in pal itself rather than in the host,
reads `exclude_apps`, `max_entries` and `max_age_days` once at startup, so
those want pal relaunched.

## `[instances]`

One extension, several configured copies: two GitHub accounts, two Slack
workspaces, two Home Assistant homes. Only an extension whose `pal.json`
declares `"multi": true` has instances (`github`, `slack` and
`home-assistant` among the bundled ones). The default instance is the
extension's bare name and the tables you already have; another one exists
because its table does, keyed `<name>@<suffix>`:

```toml
[instances."github@work"]        # the instance exists because this table does (empty is fine)
title = "Work"                   # the display name; default: the suffix capitalised
tint = "amber"                   # one of the twelve brand colours; default: picked from the suffix
badge = "W"                      # one or two characters on the tile's corner; default: the title's first letter
enabled = true                   # false parks it: not loaded, rows gone, settings kept

[instances.github]               # optional: name the default once a second exists
title = "Personal"

[extensions."github@work"]       # its settings; inherits [extensions.github], except secrets
token = "keychain:pal/github@work-token"

[palettes."github@work-prs"]     # per-palette keys, per instance (hotkey, alias, icon, enabled, tier)
hotkey = "ctrl+alt+w"

[bar.items."github@work/notifications"]   # bar items, per instance
order = 30
```

| key | type | default | what |
| --- | --- | --- | --- |
| `title` | string | the suffix capitalised | The display name ("Work"), what palette titles and bar tooltips carry. The default instance has none until you name it under `[instances.<name>]`. |
| `tint` | string | picked from the suffix | The tile's colour, one of the twelve brand names (`red`, `orange`, `amber`, `green`, `teal`, `cyan`, `blue`, `indigo`, `violet`, `pink`, `slate`, `ink`). The default instance keeps the extension's own tile. |
| `badge` | string | the title's first letter | One or two characters in the tile's corner. |
| `enabled` | bool | `true` | `false` parks the instance: not loaded, its rows and bar items gone, its settings kept. |

The suffix is lowercase letters, digits, `-` and `_` (up to 32, starting
with a letter or digit), and never `default`; the key needs quotes in
TOML because of the `@`. It is fixed at creation: it sits in file paths
(the storage file `storage/github@work.json`, the index cache), in the
frecency record and in links (`pal://open/github@work/prs`), so renaming
means removing and adding; the title is what you rename.

**Inheritance.** `[extensions."github@work"]` layers over
`[extensions.github]`, which layers over the manifest's defaults, each one
level deep, a set key replacing whole. Two kinds of setting never inherit
from the default instance: one declared `kind: "secret"` (a token
identifies the account) and one declared `scope: "instance"` (Slack's
`workspace`, Home Assistant's `url`); those fall to the manifest default
until set for the instance. `[palettes."github@work-prs"].settings`
inherits `[palettes.github-prs].settings` the same way; the pal-provided
palette keys (`enabled`, `alias`, `hotkey`, `hold`, `icon`, `tier`,
`item_hotkeys`) never inherit, since a hotkey cannot be shared and an
alias or icon is what tells the two apart. A secret reference is looked
up per instance, so `keychain:pal/github@work-token` is its own keychain
item.

**What an instance gets.** Its own palettes at the root, titled with the
instance's title ("Pull Requests (Work)", or where the manifest's title
says `{instance}`), its tile in the instance's `tint` with the `badge` in
the corner (the default instance keeps the plain tile), its own bar items
(`github@work/notifications`), storage, cache, frecency and deep links.
The extension's code is shared and runs once per instance, each in its
own worker of the extension host, so nothing one instance caches leaks
into another. Every instance of a `multi` extension runs in a worker, the
default too, even when alone.

A change under `[instances]` takes effect at once: the running pal
reloads the extension's instances (every one, like a file change to its
code), so an added table lists its palettes within a second and a removed
or parked one takes its rows and bar items away, an open level of it
popping to the root. A `[instances."x@y"]` for an extension without
`"multi": true` is not loaded and shows as a warning (`x does not support
instances`, or `x is not installed`) in the diagnostics strip and on the
Overview. Keys the schema does not know under an instance table are
warnings, like everywhere else.

**In Settings and from the shell.** Settings > Extensions shows a
`multi` extension's instances as a section of its pane: one row each
(the badged tile, the title, the key, "default", an on/off switch,
Rename, Remove) and "Add another account", an inline form that slugs a
suffix from the title, checks it live and offers the tint; the Settings
section below has a segmented control per instance, an inherited value
carrying a "From Gmail (Personal)" note and a secret or `scope:
"instance"` field reading "Set for this instance". A value typed equal
to the inherited one leaves the file, so the instance keeps following.
The Palettes page groups per instance ("Gmail (Work) › Inbox (Work)"),
the Bar page's rows read "Gmail (Work) › Unread", the Overview's
needs-setup rows name the instance. `pal instance list|add|remove`
(docs/cli.md) and `pal://instance/add/<name>/<suffix>`,
`pal://instance/remove/<key>` (docs/links.md) do the same edits.
Removing an instance unsets every table of its own (`[instances.<key>]`,
`[extensions.<key>]`, its `[palettes."<key>*"]` and `[bar.items."<key>/*"]`),
deletes its storage file and index cache and forgets its frecency; the
keychain items stay, as they do for a removed extension.

## Secrets

A setting of kind `secret` never sits in the file as plain text. The file
holds a reference:

- `keychain:<service>/<account>` or `keychain:<account>` (service `pal`):
  the OS store. On macOS that is the Keychain, as a generic password; on
  Linux the Secret Service (gnome-keyring, KWallet's compat service) through
  the `secret-tool` CLI from libsecret, as an item with the attributes
  `service` and `account`. The Settings window writes the value there under
  `pal/<extension>-<key>` and puts `keychain:pal/<extension>-<key>` in the
  file. By hand: `security add-generic-password -s pal -a github-token -w`
  on macOS, `secret-tool store --label="pal github-token" service pal
  account github-token` on Linux.
- `env:<NAME>`: an environment variable of the pal process.

A setting the extension declared `kind: "secret"` reaches it resolved:
the values it gets (at import and on every change) carry the secret itself,
fetched from the store by the core (`core/src/config/secrets.rs`,
`resolve_declared`). Anything that is not a reference passes through as
itself. A reference that does not resolve (no such item, locked keychain)
stays as the reference string and is logged as `secrets  unresolved`; the
extension still loads. Settings of any other kind are never resolved, even
when their value looks like a reference, and neither is a key the manifest
does not declare. Removing a secret in Settings unsets the key; the
keychain item stays. On Linux without `secret-tool` on PATH (package
`libsecret` on Arch, `libsecret-tools` on Debian and Ubuntu) or without a
Secret Service on the session bus, every `keychain:` reference is
unresolved and the log says which of the two is missing; `env:` references
work everywhere.

## Live reload

pal watches the config file's directory (editors save by writing a new file
and renaming it over the old one, and a watch on the old file would go
quiet after the first save). Events within 150 ms collapse into one reload,
and a reload only fires when the bytes changed. After a reload the hotkeys
are re-registered, palettes are removed or listed as `enabled` says,
extensions get their new values, `launch_at_login` and `menu_bar_icon` are
applied, and both windows follow `theme`.

A save that does not parse keeps the last good config live and adds an
error diagnostic; nothing blanks while you are mid-edit. A deleted file is a
reload to the defaults.

## Crash relaunch

pal runs under the OS's service manager so that a crash brings it back
and a quit does not. On macOS the agent is a LaunchAgent labelled after
the bundle (`io.cagdas.pal`) with `RunAtLoad` and
`KeepAlive { SuccessfulExit = false }`: launchd restarts pal after a
non-zero exit or a signal, within about five seconds
(`ThrottleInterval`), and leaves it alone after `pal quit` or the menu's
Quit, which exit 0. `launch_at_login` only decides where the plist lives:
on, `~/Library/LaunchAgents/`, which launchd loads at login; off,
`~/Library/Application Support/pal/launchd/`, which nothing loads at
login and pal bootstraps itself for the session. A pal started by hand
(`open -a pal`, a terminal) hands itself over to the agent at startup, so
the process you see is always the supervised one; that costs one extra
startup and happens at most once a minute, so a manager that will not
start pal cannot loop. On Linux the unit is `~/.config/systemd/user/pal.service`
with `Restart=on-failure` (a transient unit of the same name when the
setting is off); without systemd the XDG entry starts pal at login and
nothing relaunches it. Debug builds do none of this. After a relaunch pal
shows "pal restarted after a crash" once, logs the report it found, and
Settings > About lists the last crash (the `.ips` under
`~/Library/Logs/DiagnosticReports`, or the `coredumpctl` entry) and the
last Rust panic (`<data dir>/<profile>/last-panic.txt`, written by pal's
own panic hook with the message and a backtrace). Nothing is uploaded.

Edits the settings view makes go through `toml_edit`: comments, key order
and spacing you wrote survive.

## Diagnostics

The Settings window shows a strip at the bottom when the file has problems,
one line each:

```text
1 error in config.toml. The file did not parse, so pal is still using the last settings that did.
✕ error   unknown variant `blue`, expected one of `system`, `light`, `dark`   line 3
```

```text
2 warnings in config.toml. Unknown keys stay in the file and are ignored.
! warning   unknown key  general.hotkeys
! warning   unknown key  palettes.clipboard.enabld
```

- A **warning** is an unknown key, shown as its dotted path. The key stays
  in the file and is ignored; a typo'd key does not reach the real one. No
  line number: the parser does not report where an ignored key sits.
- An **error** means the file did not parse (bad TOML, or a value outside
  its enum such as `theme = "blue"`); it carries the 1-based line, and the
  line is a button that opens the file in your editor. The config shown is
  the last good one, or the defaults at startup.

## `PAL_CONFIG` and profiles

`PAL_CONFIG=<path>` makes pal use that file instead of the default. The
index cache and the frecency file are keyed by config file: they live under
`<data dir>/pal/<profile>/`, where `<profile>` is `default` for
`~/.config/pal/config.toml` and the first 8 hex digits of the sha256 of the
file's canonical path otherwise. Two config files never share a cache or a
search history, since a palette enabled in one may not be in the other. The
profile is logged at startup. `clipboard.db` and `storage/` (what
extensions keep through the storage API: quicklinks, snippets) stay one
level up and are shared by every profile: they are your data, not a view of
one config, so a quicklink made under a test profile shows up in all of them.

The data dir is `~/Library/Application Support/pal` on macOS and
`~/.local/share/pal` on Linux (`$XDG_DATA_HOME/pal` when set). The
extension store, `extensions/` in it, is shared by every profile.

A symlinked config file (dotfiles setups) is followed: edits and the watch
go to the real file, so a write never replaces the link with a plain file.
The watch follows the link once, at startup; re-pointing it later is not
seen.

## Coming from the previous pal

The previous pal (the `v0.1.x` and `v0.2.x` releases on GitHub, "v1"
below and in the code) kept its config at the same path in another shape
(`[palette.<name>]` tables, `general.default_frontend`). The first launch
that finds one there migrates it, and logs each step as a `migrate` line:

- the v1 file is kept whole as `config.v1.toml` next to it (written and
  read back before the original is touched);
- in that copy, a `base` that no longer exists on disk but does under the
  `scripts` extension's `v1_repo` (the v1 checkout, `~/proj/pal-v1` by
  default) is pointed there;
- a new `config.toml` is written from the template, with
  `[extensions.scripts] config` set to the copy's absolute path, so every
  `[palette.*]` table keeps running through [Scripts](scripts.md), and
  `[extensions.bookmarks] file` set to v1's `palette.bookmarks.data` when
  there was one. v1 had no hotkey key; everything else starts from the
  defaults.

A `config.v1.toml` already there with other content stops the migration
(the log says so; move it away). A file already in this shape, or an empty
or missing one, is not touched: the template is written when there is no
file. `cargo run -p pal-core --example migrate` runs the same code on
`PAL_CONFIG`, for a dry run on a copy.
