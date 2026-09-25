# Changelog

## 0.5.0 · 2026-09-25

- **Snake II**, the Nokia 3310's, pixel for pixel and step for step: the phone's screen, menus, levels, mazes, bonus creatures, tones and backlight, checked frame by frame against the real 3310 firmware. The top score sits in the title line, and a quick second turn is kept instead of lost (`queue_turns`, off plays exactly as the phone).
- **Yahtzee**: solo, thirteen rounds, every open category showing what it would score, full rules with the bonuses and Joker.
- **Minesweeper**: the classic board with right-click flags, chording, a pressed look while you hold, beginner to expert, best times.
- **Solitaire**: Klondike with real cards, drag and drop or one hand on the arrows and Enter, undo, draw 1 or 3, a win cascade.
- **Blackjack rebuilt** as a felt table with real cards dealt from a shoe, chips, clickable moves; totals update as each card turns over, and Enter stands mid-hand so a stray press never draws a card.
- **Games**: one row that lists every game you have, including ones installed from the store.
- **Every game plays one-handed** on the arrows and Enter, as well as with the mouse.
- **For extension authors**: a game can bring its own page (the `surface` view node), run in a sandboxed frame with keys, theme, storage and messages to the extension, and a standard card deck to use (docs: Game surfaces).
- **GitHub search is faster**, about 2 s instead of 4 to 7, and lists what involves you first; the search row shows it is still searching while a slow search is out.
- **Fixed**: an extension installed from the store could fail to load when it read its settings on start.

## 0.4.4 · 2026-09-24

- **Hide the pointer while it is idle**: Settings › Features › Mouse & Trackpad hides it in every app after a delay you choose (3 s by default), and the first move or click brings it back (macOS).
- **Keycast's cursor ring hides with the pointer**, so a hidden pointer never leaves a ring on screen.
- **Permissions survive updates**: every pal is now signed with the same certificate, so Accessibility, Input Monitoring and Full Disk Access stay granted across updates. Coming from 0.4.3 or older, grant them once more.

## 0.4.3 · 2026-09-24

- **Fixed**: installing an update from inside pal quit it and never started it again when pal runs at login; it now relaunches, and so does Restart pal.

## 0.4.2 · 2026-09-24

- **Fixed**: the Displays bar item showed an external monitor's brightness as 0% right after setting it. Some monitors (a Dell U2724DE here) drop most brightness reads, and pal now asks again instead of trusting a 0.

## 0.4.1 · 2026-09-24

- **Fixed**: Settings flagged Hue, Images and YouTube as needing setup when they did not; only what an extension marks required counts now.

## 0.4.0 · 2026-09-24

- **Settings › Features**: clipboard recording, text expansion, the switcher, the sidebar, keep below the bar, mouse and keycast are now built in, each a card with its switch, settings and command hotkeys.
- **Mouse & Trackpad**: a three-finger click or tap on the trackpad works as a middle click, and scrolling can be reversed per device and per axis (macOS).
- **Keep windows below the bar**: with a sketchybar strip over a hidden menu bar, windows that open, zoom or get dragged under it are moved clear of it.
- **Calculator variables**: define `name = value` lines under `[extensions.calc] vars`, use them in any calculation, and ask "1500 usd in salary" for hours, days, weeks, months.
- **Calculator shorthand**: `210k` means thousands everywhere, `m` and `b` mean millions and billions before a currency, and `$1.5k` reads as 1500 USD.
- **Search by palette name**: a word can match the palette a row lives in, so "gh pal" finds the repository and "tod estonia" finds the todo.
- **Settings reorganised**: the Extensions page leads with what needs you and what is in use, Palettes folded into it, and bar item settings live on Settings › Bar.
- **Smoother keycast ring**: the cursor ring is drawn natively and moves every display refresh, so it no longer trails a fast cursor.
- **Root order**: pal's own commands rank above System Settings ("sett" opens pal's Settings), and whatever is playing leads the empty root.
- **Quieter bar items**: GitHub's Pull requests count is your own PRs (review requests opt in with `review_requests`), and Sessions drops the ended count.
- **Fixed**: sliders in views now drag; the Settings window no longer opens doubled or clipped on a different-DPI display, or bounces when scrolled past its edges.
- **Fixed**: Slack and Translate no longer report a missing token or API key for an auth mode that does not use one; a reversed trackpad scroll's coast no longer flips direction.

## 0.3.0 · 2026-09-22

- **Typed arguments**: rows can take values right in the search bar (ssh's command, a timer's duration, a Slack status, a WhatsApp reply); Tab moves into the fields, Enter runs.
- **Window switcher**: a held chord (Windows suggests `alt+tab`, `cmd+tab` works too) switches windows on a tap and shows the list when held; macOS's App Switcher can move to another chord.
- **Sidebar**: an optional live palette docked to a screen edge, peeked from a thin strip, with numbered rows and cmd+N to pick (off by default, macOS).
- **Spaces palette**: lists every space with its apps and switches instantly on macOS; Hyprland, Sway and X11 too.
- **States and bar rules**: named variables (time, front app, network, idle, your own) that bar items can show or hide on, with per-item rules edited in Settings › Bar.
- **Settings › Shortcuts**: every global key in one place, with a filter, Add Shortcut, and a warning when a chord is bound twice.
- **Permissions are asked when a feature needs them**, never at launch, with a card from pal explaining why before the system prompt.
- **New extensions**: Sessions (Claude Code, Codex and Copilot CLI sessions), Stats (CPU, memory, disk, network bar items), Keycast, Keep Awake, Displays, Diff, Turkish, Immich, Grafana, Odak, Theater.
- **Finder selection**: a Selected in Finder row on the empty root, a Finder Selection palette, and Quick Look over marked rows.
- **Bar appearance**: per-item icons (including images), badge colour, opacity, sizes, and a Show select to keep an item on the strip muted when it has nothing.
- **More per extension**: mute GitHub PRs and issues, Spotify Add to playlist, a glyph per Wi-Fi network, calendar minutes left in a running meeting, Wi-Fi joins with a password.
- **Fixed**: panel and popover blur now shows what is really behind them; popover rows open the right item; removed script palettes leave the root; Gmail links open the right account.

## 0.1.0 · 2026-09-17

- **One search over everything**: apps, windows, files, bookmarks, clipboard history, emoji, system commands and every palette answer one query, ranked by what you pick.
- **Inline answers**: calculations, currency, units, time zones, colours and paths answer at the root; a query nothing matches falls back to the web, a quicklink or a palette.
- **A hundred-odd palettes in fifty-five extensions**, from Clipboard History and Window Management to GitHub, Slack, Gmail, Spotify, Hue, Docker, Obsidian, 1Password, Home Assistant and a few games.
- **The bar**: extensions put items on the menu bar or sketchybar (GitHub, Now Playing, calendar, timer, battery, weather and more), each with a popover to act from.
- **Extensions in TypeScript**: one directory with a manifest and an `index.ts` gets rows, actions, forms, drawn views and bar items; `pal install` adds more from the store or GitHub.
- **Zero-code tier**: a data file or a shell script becomes a palette.
- **Several accounts of one extension**, such as a personal and a work Gmail, each with its own settings.
- **One TOML config file**: the Settings window writes it, hand edits apply live, secrets go to the keychain, and a theme file recolours every window.
- **Scriptable from outside**: every action is a `pal` command and a `pal://` link, usable from a shell, a keybind, a browser or Shortcuts; `pal pick` works as a picker for scripts.
- **Window management** with 20 layouts and per-item hotkeys, plus snippets with text expansion and quicklinks.
- **macOS and Linux**: a dmg for Apple silicon and Intel, an AppImage and a deb, with a tray icon, launch at login and built-in updates.
