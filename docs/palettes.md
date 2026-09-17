# Palettes

The palettes that ship with pal. Each is an extension under `extensions/`
with a `pal.json` manifest; its settings go under `[extensions.<name>]` in
the config file unless noted, and the per-palette keys (`enabled`, `alias`,
`hotkey`, `icon`) go under `[palettes.<id>]`. See [Config](config.md).

Three words used below. An **input** palette is never in the index: its
rows come from the extension on every keystroke inside it, and the root
only has the palette's own row. A **live** palette is listed again every
time the panel shows (not twice within 2 s, and with a `ttl` only once its
last listing is older than that), so its rows are current at the root. A
palette that is neither is indexed: listed once, searched from the index,
refreshed with `⌘R`; a `scripts` palette keeps its listing across restarts
for the extension's `ttl` (an hour by default) unless it sets its own.

At the root every palette also has a **tier**
([Extensions](extensions.md#tier-what-the-rows-are-at-the-root)): `primary` for
what is reached by name (Applications, Windows, Menu Bar Items, Bookmarks,
Quicklinks, Snippets, Recent Files, Browser Tabs, System, SSH Hosts), ranked up
and capped at 8 rows per palette; `catalog` for the big static lists (Emoji,
Unicode Characters, Colors, both Icons palettes, a data file of 100 rows or
more), ranked down and capped at 3, the rest behind a "12 more in Emoji" row;
`normal` for everything else, capped at 6. `[palettes.<id>] tier` overrides it.

Every palette that ships, by extension. The id is the config key
(`[palettes.<id>]`) and the heading of its section; a `multi` extension's
second account gets the same palettes under `<name>@<suffix>-<palette>`
([Config](config.md#instances)).

| palette | id | kind, tier | what `Enter` does |
| --- | --- | --- | --- |
| [2048](#2048-2048) | `2048` | view, normal | New game (asks mid-game); Keep going after the first 2048 |
| [Applications](#applications-apps) | `apps` | indexed, primary | Open the app |
| [Audio](#audio-audio) | `audio` | live, normal | Set as the default output or input |
| [Blackjack](#blackjack-blackjack) | `blackjack` | view, normal | Deal, or the next hand; declines insurance |
| [Bluetooth](#bluetooth-bluetooth) | `bluetooth` | live, normal | Connect or disconnect |
| [Bookmarks](#bookmarks-bookmarks) | `bookmarks` | indexed, primary | Open in the browser |
| [Browser Tabs](#browser-tabs-browser-tabs-tabs) | `browser-tabs-tabs` | live, primary | Switch to the tab |
| [Calculator](#calculator-calc) | `calc` | input, normal | Copy the result |
| [My Schedule](#calendar-calendar-today-calendar-schedule-calendarupcoming) | `calendar-schedule` | live, normal | Join the call, else open in Calendar |
| [Today](#calendar-calendar-today-calendar-schedule-calendarupcoming) | `calendar-today` | live, normal | Join the call, else open in Calendar |
| [Clipboard](#clipboard-clipboard-rows) | `clipboard-rows` | input, normal | What the row is for: open, call, paste as plain, copy the answer |
| [Clipboard History](#clipboard-history-clipboard-history) | `clipboard-history` | input, normal | Paste into the app in front |
| [Colour Picker](#colors-colors-picker-colors-colors-history-colors-convert) | `colors-picker` | view, normal | |
| [Named Colours](#colors-colors-picker-colors-colors-history-colors-convert) | `colors` | indexed, grid, catalog | Open in Picker |
| [Colour History](#colors-colors-picker-colors-colors-history-colors-convert) | `colors-history` | live, normal | Open in Picker (on the top row: pick from the screen) |
| [Convert Colour](#colors-colors-picker-colors-colors-history-colors-convert) | `colors-convert` | input, normal | Open in Picker |
| [Docker Containers](#docker-docker-docker-images-docker-compose) | `docker` | live, normal | Stop a running container, start a stopped one |
| [Docker Images](#docker-docker-docker-images-docker-compose) | `docker-images` | live, normal | Run, after a form for the name and ports |
| [Compose Projects](#docker-docker-docker-images-docker-compose) | `docker-compose` | live, normal | Up |
| [Downloads](#downloads-downloads) | `downloads` | live, primary | Open the file |
| [Emoji](#emoji-emoji) | `emoji` | indexed, grid, catalog | Copy emoji |
| [Files](#files-files-files-browse-files-recent) | `files` | input, normal | Open the file, browse a folder |
| [Browse Folder](#files-files-files-browse-files-recent) | `files-browse` | input, normal | Browse a folder, open a file |
| [Recent Files](#files-files-files-browse-files-recent) | `files-recent` | live, primary | Open the file |
| [Generate](#generate-generate) | `generate` | input, normal | Copy the value (show the QR code on its row) |
| [GIFs](#gifs-gifs-gifs-favourites) | `gifs` | indexed, grid, normal | Copy the GIF file |
| [Favourite GIFs](#gifs-gifs-gifs-favourites) | `gifs-favourites` | indexed, grid, normal | Copy the GIF file |
| [Pull Requests](#github-github-prs-github-issues-github-repos-github-notifications-github-search) | `github-prs` | indexed, normal | Open the pull request |
| [Issues](#github-github-prs-github-issues-github-repos-github-notifications-github-search) | `github-issues` | indexed, normal | Open the issue |
| [Repositories](#github-github-prs-github-issues-github-repos-github-notifications-github-search) | `github-repos` | indexed, normal | Open on GitHub |
| [Notifications](#github-github-prs-github-issues-github-repos-github-notifications-github-search) | `github-notifications` | live, normal | Mark read and open |
| [Search GitHub](#github-github-prs-github-issues-github-repos-github-notifications-github-search) | `github-search` | input, normal | Open what was found |
| [Inbox](#gmail-gmail-inbox-gmail-search-gmail-labels-gmail-compose-gmail-drafts-gmailunread) | `gmail-inbox` | live, normal | Open the message in Gmail |
| [Search Mail](#gmail-gmail-inbox-gmail-search-gmail-labels-gmail-compose-gmail-drafts-gmailunread) | `gmail-search` | input, normal | Open the message in Gmail |
| [Labels](#gmail-gmail-inbox-gmail-search-gmail-labels-gmail-compose-gmail-drafts-gmailunread) | `gmail-labels` | indexed, catalog | Open the label in Gmail |
| [Compose](#gmail-gmail-inbox-gmail-search-gmail-labels-gmail-compose-gmail-drafts-gmailunread) | `gmail-compose` | indexed, normal | Open the form; on the form, send |
| [Drafts](#gmail-gmail-inbox-gmail-search-gmail-labels-gmail-compose-gmail-drafts-gmailunread) | `gmail-drafts` | live, normal | Open the draft in Gmail |
| [Home Assistant](#home-assistant-home-assistant-entities-home-assistant-services-home-assistant-areas) | `home-assistant-entities` | live, normal | The domain's first action: toggle, activate, run, copy value |
| [Home Assistant Services](#home-assistant-home-assistant-entities-home-assistant-services-home-assistant-areas) | `home-assistant-services` | indexed, normal | Open the form, then call |
| [Home Assistant Areas](#home-assistant-home-assistant-entities-home-assistant-services-home-assistant-areas) | `home-assistant-areas` | indexed, normal | List the area's entities |
| [Hue Rooms](#hue-hue-rooms-hue-lights-hue-scenes-hue-light-hue-setup-hue-sensors-hue-automations-hue-entertainment-huehome) | `hue-rooms` | live, primary | Toggle the room |
| [Hue Lights](#hue-hue-rooms-hue-lights-hue-scenes-hue-light-hue-setup-hue-sensors-hue-automations-hue-entertainment-huehome) | `hue-lights` | live, normal | Toggle the light |
| [Hue Scenes](#hue-hue-rooms-hue-lights-hue-scenes-hue-light-hue-setup-hue-sensors-hue-automations-hue-entertainment-huehome) | `hue-scenes` | live, primary | Play the scene |
| [Hue Light](#hue-hue-rooms-hue-lights-hue-scenes-hue-light-hue-setup-hue-sensors-hue-automations-hue-entertainment-huehome) | `hue-light` | view, normal | Toggle, or apply the chosen preset, scene or effect |
| [Set up Hue](#hue-hue-rooms-hue-lights-hue-scenes-hue-light-hue-setup-hue-sensors-hue-automations-hue-entertainment-huehome) | `hue-setup` | view, normal | Pair with a bridge |
| [Hue Sensors](#hue-hue-rooms-hue-lights-hue-scenes-hue-light-hue-setup-hue-sensors-hue-automations-hue-entertainment-huehome) | `hue-sensors` | live, normal | Copy the reading |
| [Hue Automations](#hue-hue-rooms-hue-lights-hue-scenes-hue-light-hue-setup-hue-sensors-hue-automations-hue-entertainment-huehome) | `hue-automations` | live, normal | Enable or disable |
| [Hue Entertainment](#hue-hue-rooms-hue-lights-hue-scenes-hue-light-hue-setup-hue-sensors-hue-automations-hue-entertainment-huehome) | `hue-entertainment` | live, normal | Start streaming |
| [Nerd Font icons](#icons-icons-icons-freedesktop) | `icons` | indexed, grid, catalog | Copy glyph |
| [Freedesktop icon names](#icons-icons-icons-freedesktop) | `icons-freedesktop` | indexed, grid, catalog | Copy name |
| [Images](#images-images) | `images` | input, normal | Compress |
| [Makefile Targets](#makefile-targets-make) | `make` | indexed, normal | Run the target |
| [Maps](#maps-maps) | `maps` | input, normal | Open the place or the route |
| [Now Playing](#now-playing-media) | `media` | live, normal | Play or pause |
| [Menu Bar Items](#menu-bar-items-menu-bar) | `menu-bar` | live, primary | Press the menu item |
| [Network](#network-network) | `network` | live, normal | Copy the value |
| [Notes](#obsidian-obsidian-notes-obsidian-search-obsidian-daily-obsidian-tags-obsidian-recent-obsidian-backlinks-obsidian-outgoing) | `obsidian-notes` | indexed, primary | Open in Obsidian (or the editor, per the setting) |
| [Search Notes](#obsidian-obsidian-notes-obsidian-search-obsidian-daily-obsidian-tags-obsidian-recent-obsidian-backlinks-obsidian-outgoing) | `obsidian-search` | input, normal | Open in Obsidian (or the editor, per the setting) |
| [Daily Notes](#obsidian-obsidian-notes-obsidian-search-obsidian-daily-obsidian-tags-obsidian-recent-obsidian-backlinks-obsidian-outgoing) | `obsidian-daily` | live, normal | Open the note; on Create today's note, create it (asks first); on the forms, open them |
| [Tags](#obsidian-obsidian-notes-obsidian-search-obsidian-daily-obsidian-tags-obsidian-recent-obsidian-backlinks-obsidian-outgoing) | `obsidian-tags` | indexed, catalog | The notes with the tag |
| [Recent Notes](#obsidian-obsidian-notes-obsidian-search-obsidian-daily-obsidian-tags-obsidian-recent-obsidian-backlinks-obsidian-outgoing) | `obsidian-recent` | live, normal | Open in Obsidian (or the editor, per the setting) |
| [Backlinks](#obsidian-obsidian-notes-obsidian-search-obsidian-daily-obsidian-tags-obsidian-recent-obsidian-backlinks-obsidian-outgoing) | `obsidian-backlinks` | indexed, normal | Open the linking note |
| [Outgoing Links](#obsidian-obsidian-notes-obsidian-search-obsidian-daily-obsidian-tags-obsidian-recent-obsidian-backlinks-obsidian-outgoing) | `obsidian-outgoing` | indexed, normal | Open the linked note; on a link to nothing, create it |
| [1Password](#1password-onepassword-items) | `onepassword-items` | indexed, normal | Copy the password |
| [Verification Codes](#verification-codes-otp) | `otp` | live, normal | Paste the code |
| [Processes](#processes-processes) | `processes` | input, normal | Kill (asks first) |
| [Quicklinks](#quicklinks-quicklinks) | `quicklinks` | indexed, primary | Open, or fill in the {query} |
| [Screenshots](#screenshots-screenshots) | `screenshots` | live, primary | Capture, or open the screenshot |
| [Services](#services-services) | `services` | live, normal | Stop or start (unload or load on macOS) |
| [Shell](#shell-shell-shell-history) | `shell` | input, normal | Run the command (in the view: copy the output) |
| [Shell History](#shell-shell-shell-history) | `shell-history` | input, normal | Run the command again |
| [Shortcuts](#shortcuts-shortcuts) | `shortcuts` | indexed, primary | Run the shortcut |
| [Unreads](#slack-slack-unreads-slack-channels-slack-search-slack-status) | `slack-unreads` | live, normal | Open the conversation in Slack |
| [Channels](#slack-slack-unreads-slack-channels-slack-search-slack-status) | `slack-channels` | indexed, catalog | Open in Slack |
| [Search Slack](#slack-slack-unreads-slack-channels-slack-search-slack-status) | `slack-search` | input, normal | Open the message in Slack |
| [Status](#slack-slack-unreads-slack-channels-slack-search-slack-status) | `slack-status` | live, normal | Set it |
| [Snippets](#snippets-snippets) | `snippets` | indexed, primary | Paste into the app in front |
| [Speedtest](#speedtest-speedtest-speedtest-history) | `speedtest` | view, normal | Start the test (stop it while it runs) |
| [Speedtest History](#speedtest-speedtest-speedtest-history) | `speedtest-history` | live, normal | Copy the run (on Trend: show the bars) |
| [Lyrics](#spotify-spotify-now-playing-spotify-search-spotify-playlists-spotify-library-spotify-devices-spotify-queue-spotify-commands-spotifyplaying) | `spotify-now-playing` | view, normal | Play or pause |
| [Search Spotify](#spotify-spotify-now-playing-spotify-search-spotify-playlists-spotify-library-spotify-devices-spotify-queue-spotify-commands-spotifyplaying) | `spotify-search` | input, normal | Play |
| [Playlists](#spotify-spotify-now-playing-spotify-search-spotify-playlists-spotify-library-spotify-devices-spotify-queue-spotify-commands-spotifyplaying) | `spotify-playlists` | indexed, normal | Play |
| [Library](#spotify-spotify-now-playing-spotify-search-spotify-playlists-spotify-library-spotify-devices-spotify-queue-spotify-commands-spotifyplaying) | `spotify-library` | indexed, normal | Play |
| [Spotify Devices](#spotify-spotify-now-playing-spotify-search-spotify-playlists-spotify-library-spotify-devices-spotify-queue-spotify-commands-spotifyplaying) | `spotify-devices` | live, normal | Play here (a device); volume up, down, mute (the volume rows) |
| [Queue](#spotify-spotify-now-playing-spotify-search-spotify-playlists-spotify-library-spotify-devices-spotify-queue-spotify-commands-spotifyplaying) | `spotify-queue` | live, normal | Skip to the row (play or pause on the first) |
| [Spotify](#spotify-spotify-now-playing-spotify-search-spotify-playlists-spotify-library-spotify-devices-spotify-queue-spotify-commands-spotifyplaying) | `spotify-commands` | indexed, primary | Run |
| [SSH Hosts](#ssh-hosts-ssh) | `ssh` | indexed, primary | Connect in a terminal |
| [Store](#store-store) | `store` | input, primary | Install, update, or open the store page |
| [System](#system-system) | `system` | live, primary | Run the command |
| [Search tela](#tela-tela-search-tela-research-tela-pages-tela-spaces-tela-new-page-tela-decks-tela-sheets-tela-comments-tela-backlinks) | `tela-search` | input, normal | Open the page in tela |
| [Ask tela](#tela-tela-search-tela-research-tela-pages-tela-spaces-tela-new-page-tela-decks-tela-sheets-tela-comments-tela-backlinks) | `tela-research` | input, normal | Ask; on a source, open it in tela |
| [Pages](#tela-tela-search-tela-research-tela-pages-tela-spaces-tela-new-page-tela-decks-tela-sheets-tela-comments-tela-backlinks) | `tela-pages` | indexed, normal | Open the page in tela |
| [Spaces](#tela-tela-search-tela-research-tela-pages-tela-spaces-tela-new-page-tela-decks-tela-sheets-tela-comments-tela-backlinks) | `tela-spaces` | indexed, normal | The space's pages |
| [New Page](#tela-tela-search-tela-research-tela-pages-tela-spaces-tela-new-page-tela-decks-tela-sheets-tela-comments-tela-backlinks) | `tela-new-page` | indexed, normal | The form |
| [Decks](#tela-tela-search-tela-research-tela-pages-tela-spaces-tela-new-page-tela-decks-tela-sheets-tela-comments-tela-backlinks) | `tela-decks` | indexed, normal | Open the deck in tela |
| [Sheets](#tela-tela-search-tela-research-tela-pages-tela-spaces-tela-new-page-tela-decks-tela-sheets-tela-comments-tela-backlinks) | `tela-sheets` | indexed, normal | Open the sheet in tela |
| [Comments](#tela-tela-search-tela-research-tela-pages-tela-spaces-tela-new-page-tela-decks-tela-sheets-tela-comments-tela-backlinks) | `tela-comments` | live, normal | Mark read and open the page |
| [Backlinks](#tela-tela-search-tela-research-tela-pages-tela-spaces-tela-new-page-tela-decks-tela-sheets-tela-comments-tela-backlinks) | `tela-backlinks` | indexed, normal | Open the linking page in tela |
| [Timers](#timer-timer-timers) | `timer-timers` | live, normal | Pause, resume or dismiss |
| [Translate](#translate-translate-translate-history) | `translate` | input, normal | Copy the translation (on Swap: translate it back) |
| [Translation History](#translate-translate-translate-history) | `translate-history` | live, normal | Copy the translation |
| [Unicode Characters](#unicode-characters-unicode) | `unicode` | indexed, grid, catalog | Copy character |
| [Chats](#whatsapp-whatsapp-chats-whatsapp-unread-whatsapp-search-whatsapp-contacts-whatsappunread) | `whatsapp-chats` | live, primary | Open the chat (a group opens WhatsApp at the top) |
| [Unread](#whatsapp-whatsapp-chats-whatsapp-unread-whatsapp-search-whatsapp-contacts-whatsappunread) | `whatsapp-unread` | live, normal | Open the chat |
| [Search WhatsApp](#whatsapp-whatsapp-chats-whatsapp-unread-whatsapp-search-whatsapp-contacts-whatsappunread) | `whatsapp-search` | input, normal | Open the chat |
| [Contacts](#whatsapp-whatsapp-chats-whatsapp-unread-whatsapp-search-whatsapp-contacts-whatsappunread) | `whatsapp-contacts` | indexed, catalog | Open a chat with the contact |
| [Wi-Fi](#wi-fi-wifi) | `wifi` | live, normal | Join, scan, or turn the radio off or on |
| [Window Management](#window-management-window-management-window-management-arrange) | `window-management` | indexed, normal | Apply to the focused window |
| [Arrange Window](#window-management-window-management-window-management-arrange) | `window-management-arrange` | input, normal | Pick the window, then its layout |
| [Windows](#windows-windows) | `windows` | live, primary | Focus the window |
| [Wordle](#wordle-wordle) | `wordle` | view, normal | Submit the guess |
| [YouTube](#youtube-youtube-search-youtube-channels-youtube-later) | `youtube-search` | input, normal | Open in the browser |
| [YouTube Channels](#youtube-youtube-search-youtube-channels-youtube-later) | `youtube-channels` | input, normal | Latest videos |
| [Watch Later](#youtube-youtube-search-youtube-channels-youtube-later) | `youtube-later` | live, normal | Open in the browser |
| [Scripts and data files](#scripts-and-data-files-scripts) | `scripts-<name>` | as configured | as configured |
| [Script Commands](#script-commands-scripts-commands) | `scripts-commands` | live, normal | runs the script command as its header says |

## Applications (`apps`)

Installed applications with their own icons.

- **macOS**: `.app` bundles in `/Applications`, `/System/Applications` and
  `~/Applications`, one level deep so the Utilities folders come along. The
  row's subtitle is where it came from (Applications, macOS, User). The
  bundle id is a keyword, so `com.apple.` or `anthropic` finds the app.
  Enter opens the bundle path with the system opener.
- **Linux**: `.desktop` entries from every XDG data dir (`~/.local/share`,
  `$XDG_DATA_DIRS`, the flatpak exports), first directory wins per desktop
  id. Entries with `NoDisplay`, `Hidden`, a `TryExec` that is not installed,
  or an `OnlyShowIn`/`NotShowIn` that excludes `$XDG_CURRENT_DESKTOP` are
  skipped. `Comment` (else `GenericName`) is the subtitle; `GenericName`,
  `Keywords`, the binary and the desktop id are keywords. Enter launches
  through `gio launch`, else `gtk-launch`, else the parsed `Exec`.
  `Terminal=true` entries run in `$TERMINAL`, else the first of kitty,
  foot, xterm found on PATH.

### Running apps, System Settings panes and actions

- A running app carries a green `running` tag (as of the last listing:
  the palette is indexed, so the tag is refreshed by `⌘R`, a settings
  change, and after a Quit or Hide from the panel) and its actions are
  Open, **Quit** (`⌘Q`), **Hide** (`⌘H`), **Reveal in Finder** (`⌘⇧R`),
  **Copy path** (`⌘C`), **Copy bundle id** (`⌘⇧C`); an app that is not
  running has Quit and Hide last, and both answer "is not running" as a
  toast rather than launching it. Quit asks the app through AppleScript
  (so it can ask you to save; a save dialog left up is the app's to
  finish) and falls back to `SIGTERM` for a bundle Launch Services does
  not know. Hide goes through System Events (an Automation prompt for pal
  once).
- Keywords: the bundle id as before, plus `CFBundleDisplayName` and
  `CFBundleName` when they differ from the folder name (`Chrome` finds
  Google Chrome). Localised names (`InfoPlist.strings`) are not read: they
  are binary plists in most system apps and would cost a spawn per app.
- **System Settings panes** are rows: 35 common panes (Keyboard,
  Displays, Privacy & Security, Wi-Fi, ...) with the System Settings icon,
  `System Settings` as subtitle, `settings`/`preferences` and a few words
  per pane as keywords. Enter opens the pane
  (`x-apple.systempreferences:<id>`), `⌘C` copies that url. A curated
  table (macOS 13+ ids), not a scan of `/System/Library/ExtensionKit`:
  the extensions there mix panes with intents and widgets and carry no
  display names.
- Linux: a `.desktop` file's `[Desktop Action …]` groups ("New Window",
  "New Private Window") are the row's secondary actions, run from their
  own `Exec` (there is no launcher CLI for an action); **Copy path** too.
  The parser is `extensions/apps/desktop.ts`.

Settings, `[extensions.apps]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `folders` | list of paths | `[]` | Extra folders scanned in addition to the system's application folders. `~` is expanded. A change rescans. |

## Blackjack (`blackjack`)

A hand of blackjack in the panel, keyboard only. Enter on the palette's
row (or its hotkey) opens the table as a view level: the search input
gives way to the phase ("Place your bet", "Your turn", "Dealer busts"),
the footer shows the primary key, ⌘K lists every move with its key.

- Betting: `+` and `-` move the bet by the minimum, Enter deals.
- Playing: `H` hit, `S` stand, `D` double down (first two cards, one card
  then stand), `P` split (a pair, once; split aces take one card each).
  Totals show live next to each hand ("Soft 17"); the dealer's hole card
  stays face down until you stand, then flips and the dealer draws to 17.
- Settled: the result and the net for the hand, Enter for the next hand.
  `N` starts a new game (asks first) with a fresh bankroll and record.
- Escape leaves at any point; the hand, the bankroll and the record persist
  (in the extension's storage), so the table is as you left it next time.

Rules: dealer stands on 17 (soft 17 too unless `dealer_hits_soft_17`),
blackjack pays 3:2, a dealer blackjack is checked at once, doubling after a
split is allowed, no surrender. The shoe is `decks` decks and is
reshuffled before a deal once under a quarter of it is left (the status
line's bar). Insurance is offered on an ace only with `insurance = true`
(`i` takes it; Enter declines), costs half the bet and pays 2:1.

Cards are drawn by the extension as SVG (rank and suit indices, pips laid
out as on a real deck) so nothing is loaded from disk; they sit on a
sunken well the app draws, and a split's card glides across to its new
hand; the view vocabulary they ride on is in [Extensions](extensions.md).

```toml
[extensions.blackjack]
decks = 6                     # 1..8
starting_bankroll = 1000
min_bet = 10                  # also the step for + and -
dealer_hits_soft_17 = false
insurance = false
```

## Bookmarks (`bookmarks`)

Hand-picked links from a JSON file: a JSON array of objects with `name` and
`url`, plus optional `subtitle` (the url when absent), `icon` (a glyph,
emoji or hex colour; a row with a url and no icon gets the site's favicon)
and `keywords` (a list of strings); the previous pal's bookmarks file
reads as is.

```json
[
  { "name": "Home Assistant", "url": "http://ha.lan", "keywords": ["ha", "home"] },
  { "name": "GitHub", "url": "https://github.com", "icon": "🐙" }
]
```

Actions:

| action | shortcut | what |
| --- | --- | --- |
| Open in browser | `Enter` | opens the url; over marked rows (`⇧↓`, `⌘`-click), every one in a tab |
| Copy link | `⌘C` | copies the url |

### Browser bookmarks

The browsers' bookmarks join the JSON file: Chrome, Brave, Edge,
Chromium, Vivaldi and Arc (every profile's `Bookmarks` JSON, the profile
name from `Local State` when there is more than one), Safari
(`~/Library/Safari/Bookmarks.plist`, read through `plutil -convert xml1`
since the JSON form refuses the Reading List's dates; the Reading List
itself is left out) and Firefox (every profile's `places.sqlite`, copied
first because the running browser holds it locked, then `bun:sqlite`;
tags and `place:` queries left out). Every source is read on every list.

- The file's rows come first, then each browser in the `browsers`
  setting's order; a url two sources have is listed once, the first wins.
  Browser rows sit in a section per browser and profile (`Chrome`,
  `Chrome (Work)`, `Safari`, `Firefox`), carry the folder path as an
  accessory (`Bookmarks Bar / Dev`) and as keywords, and get the site's
  favicon.
- Actions: **Open in browser** (`Enter`), **Copy link** (`⌘C`), **Copy as
  markdown** (`⌘⇧C`, `[name](url)`), and on a browser row **Open in
  Chrome/Safari/...** (`open -a` on macOS, the browser's binary on Linux).
- Safari's file needs Full Disk Access: without it the Safari section is
  one inert row saying so (System Settings > Privacy & Security > Full
  Disk Access, add pal).

Settings, `[extensions.bookmarks]`, in addition to `file`:

| key | type | default | what |
| --- | --- | --- | --- |
| `browsers` | list | `["chrome", "brave", "edge", "chromium", "vivaldi", "arc", "safari", "firefox"]` | Whose bookmarks to list, in order. A browser with no profile on the machine lists nothing. `[]` is the file alone. |
| `exclude_folders` | list | `[]` | Bookmark folders skipped, by name (`Archive`) or a short path (`Bookmarks Bar/Old`), case-insensitive. |

Settings, `[extensions.bookmarks]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `file` | path | `~/.config/pal/data/bookmarks.json` | The bookmarks file. `~` is expanded. |

## Calculator (`calc`)

An input palette: what you type is answered on every keystroke. Three
parsers take the query in turn: dates and time zones, currencies, then
[mathjs](https://mathjs.org) for arithmetic and units. The result is the
row's title, the query as it was understood is the subtitle (`12 USD to
TRY`), and a second row carries another form when there is one: the other
bases of an integer, a fraction, the reverse conversion, the ISO date. A
query that does not parse lists nothing, so nothing flashes while typing;
with nothing typed the palette shows three hint rows.

Actions on every result row: `Enter` copies the result as shown, `⌘Enter`
pastes it into the app in front, `⌘⇧C` copies it without grouping or
symbols (`583.68`, `1000000`), `⌘⇧E` copies `expression = result`.

What works (every line below is checked by `host/test/extensions/calc.test.ts`):

| kind | expression | result |
| --- | --- | --- |
| arithmetic | `2+2`, `2^10`, `5!`, `1e6`, `2^100` | `4`, `1,024`, `120`, `1,000,000`, `1.2676506e+30` |
| functions | `sqrt 2`, `sqrt(16)`, `square root of 625`, `2 power 10`, `3 x 4`, `10 mod 3`, `pi`, `e` | `1.414213562`, `4`, `25`, `1,024`, `12`, `1`, `3.141592654`, `2.718281828` |
| percent | `15% of 240`, `20% off 80`, `240 + 15%`, `240 - 15%`, `50%` | `36`, `64`, `276`, `204`, `0.5` |
| bases | `0xff`, `0b1010`, `255 to hex`, `255 in binary`, `hex(255)` | `255` (+ a `0b11111111` row), `10`, `0xff`, `0b11111111`, `0xff` |
| fractions | `1/3`, `0.375` | `0.3333333333` + a `1/3` row, `0.375` + a `3/8` row |
| units | `5 km to miles`, `72 f to c`, `212 °F to °C`, `300 k to c`, `12 gb to mb`, `1 gib to mb`, `3 weeks to days`, `100 kph to mph`, `1 acre in m2`, `5 kg to lb`, `10 ft in m`, `1 hp to kw`, `5 ft 3 in to cm`, `2 hours + 30 minutes to minutes` | `3.10686 miles`, `22.2222 °C`, `100 °C`, `26.85 °C`, `12,000 MB`, `1,073.74 MB`, `21 days`, `62.1371 mph`, `4,046.86 m2`, `11.0231 lb`, `3.048 m`, `0.7457 kW`, `160.02 cm`, `150 minutes` |
| currency | `12 usd to try`, `12 usd in eur`, `€12 to $`, `12 dollars in lira`, `£10 to ₺`, `1k usd`, `12*2 usd to try`, `usd try` | `583.68 TRY`, `10.40 EUR`, `13.85 USD`, `583.68 TRY`, `655.85 TRY`, `48,640.26 TRY`, `1,167.37 TRY`, `48.64 TRY` (at the test's canned rates) |
| home currency | `12 usd`, `$12`, `100 try` | to `home_currency` (`12 USD to TRY`); the home currency itself goes to USD |
| dates | `today`, `tomorrow`, `today + 3 days`, `3 weeks from now`, `in 3 weeks`, `2 days ago`, `25 dec 2026`, `dec 25, 2026` | the date written out (`Saturday, September 19, 2026`), a relative accessory (`in 3 days`), an ISO row (`2026-09-19`) |
| now | `now` | the time, with the date as accessory; ISO and unix rows |
| counts | `days until 2026-12-25`, `weeks until 25 dec`, `months since 2025-06-15`, `2026-01-01 - 2025-06-15`, `2025-06-15 to 2026-01-01`, `weeks between 2025-06-15 and 2026-01-01` | `100 days` (with `14 weeks 2 days · 3 months 9 days`), `14.3 weeks`, `n months`, `200 days`, `200 days`, `28.6 weeks` |
| time zones | `10:00 utc to tokyo`, `14:30 ist to cet`, `5pm ldn in sf`, `10:00 in tokyo`, `now in utc`, `time in tokyo`, `tokyo time`, `10am new york to utc+3`, `10:00 in Europe/Berlin` | `7:00 PM`, the subtitle `10:00 UTC (UTC) → Tokyo (GMT+9)`, the zone as accessory, `next day` when it crosses midnight, a second row with the full date there |
| unix time | `unix 1700000000`, `1700000000 to date`, `unix`, `2026-01-01 12:00 to unix` | the moment written out (+ ISO and unix rows), the current unix time, `1767268800` (local time, here UTC) |

Details:

- **Currencies** are the 30 the ECB fixes (USD, EUR, GBP, TRY, JPY, CHF,
  ...); no crypto, the source has none. Symbols (`$ € £ ₺ ¥ ₹ ₩ ₪ zł`,
  `HK$`, `R$`, ...), names (`dollars`, `lira`, `euro`, `quid`, `yen`, `TL`)
  and ISO codes in any case are understood; `to`, `in`, `as` and `→` join
  the two sides; `1k`, `2.5m` are thousands and millions; the amount may
  be an expression. A bare `usd` is the rate (`1 USD to TRY`). Results
  use the currency's own decimals (JPY none); the accessories carry the
  rate and `rates <date>`, the detail pane the rate, its inverse, both
  names, the date and the source. A target still being typed (`12 usd to
  tr`) answers for the source alone meanwhile; an unknown target lists
  nothing, a currency the set lacks is an inert `No rate for X` row.
- **Rates** come from the ECB reference rates through
  `https://api.frankfurter.dev/v1/latest` (no key, one fix per working
  day), fetched on the first currency query, never before. The first query
  without a cache shows an inert `Fetching exchange rates…` row, and the
  next keystroke has the numbers. The set is kept in the extension's
  storage with its date and fetch time, and refreshed in the background
  once it is a day old; meanwhile, and whenever the network is away, the
  cached set answers with its date on the row. A failed fetch is retried
  after a minute. `PAL_CALC_OFFLINE=1` in the host's environment disables
  fetching (the tests), `PAL_CALC_RATES_URL` points it elsewhere.
- **Units** are mathjs's, plus the spellings people type: `gb`/`mb`/`kb`
  (bytes; mathjs's own `kb` is a kilobit), `kph`/`kmh`/`mph`, `kw`/`kwh`,
  `mo`/`yr`/`hr`/`wk`, `ha`, `sqm`, `tsp`/`tbsp`, `lbs`, and `f`/`c`/`k`
  as degrees on either side of a `to`. `5 ft 3 in` and `5'3"` add up.
  Unit and rate results show at most 6 significant digits whatever
  `precision` says.
- **Precision** is significant digits for a number below 1 and for the
  fraction of one above; integers are never rounded (`123456789*1000` is
  exact). Numbers past 1e15 or under 1e-6 go exponential.
- **Locale** sets grouping and the decimal separator both ways: under `tr`
  (or `de`), `1,5 + 2` is `3,5` and `1.000.000 / 3` is `333.333,3333`;
  under `en` a `1,000` is a thousand. Dates and relative phrases follow it
  too.
- **Dates** are ISO (`2026-12-25`, with an optional `12:00`), `25 dec`,
  `dec 25, 2026`, `25.12.2026`, and the words `now`, `today`, `tomorrow`,
  `yesterday`. Arithmetic takes `days`, `weeks`, `months`, `years`,
  `hours`, `minutes` (and `d`, `w`, `mo`, `y`, `h`, `min`), chained
  (`today + 1 month - 2 days`); months keep the day of month, clamped. Day
  counts are calendar days (DST-proof); `A - B` is A minus B, `A to B`
  reads left to right. A date-shaped query that is no date (`2026-02-30`)
  lists nothing rather than falling through to arithmetic.
- **Zones** are IANA ids in any case, `utc+3`-style whole-hour offsets,
  the common abbreviations (`utc`, `cet`, `est`, `pst`, `jst`, `aest`,
  ...) and 120-odd city and country names (`tokyo`, `new york`, `sf`,
  `ldn`, `india`, `hong kong`). `ist` is Istanbul here (the airport code),
  India is `india`, `delhi`, `mumbai`. Without a source zone the local one
  is meant; the time is today's in the source zone.

What does not:

- Crypto (`1 btc to usd`): frankfurter carries no crypto; it lists nothing.
- Currencies outside the ECB set (`12 usd to aed`): nothing, or a `No
  rate` row once the set is loaded.
- A trailing operator or an open parenthesis (`1 +`, `(1+2`): nothing
  until the expression closes. A trailing `=` is fine.
- Variables do not persist between keystrokes: `x = 5` shows `5`, but a
  later `x` is undefined.
- `10x3` without spaces (`0x` would be hex); write `10 x 3` or `10*3`.
- Half-hour offsets as `utc+5:30`; use the zone (`india`).
- `12 usd to try` at the root: the calculator is an input palette, so
  open it first (its row, or an alias).

At the root, a query that reads as sums, a conversion or a date (`2+2`,
`15% of 80`, `12 usd to try`, `5 km to miles`, `3 days from now`,
`today + 3 days`) is answered inline under a Calculator section above the
hits, with the same actions (Enter copies the result). A bare number or a
word never wakes it. A query nothing matched gets an "Ask Calculator"
fallback row that opens the palette with it typed.

Settings, `[extensions.calc]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `precision` | number, 2 to 20 | `10` | Significant digits in a result; integers are never rounded, units and rates show at most 6. |
| `locale` | text | `en` | How numbers and dates are written and how a typed number is read (`en`: `1,234.5`; `tr`, `de`: `1.234,5`). |
| `home_currency` | text | empty | What a bare amount (`12 usd`) converts to. Empty: the currency of the machine's time zone (`Europe/Istanbul` is TRY, `Europe/*` otherwise EUR, `America/*` USD, ...), then the locale's region, else USD. |

## Clipboard History (`clipboard-history`)

What you copied, searchable, with images. Text, images and file lists are
recorded by a watcher that runs while pal runs; the search is SQLite
full-text search over the text, ordered pinned first, then newest. The
palette opens with the detail pane showing: the full text (fenced), the
image, or the file list, with kind, size, source app and time as metadata.
A row that is a single url gets the site's favicon; the source app and the
time are accessories, and a pinned entry carries a `pinned` tag.

Actions:

| action | shortcut | what |
| --- | --- | --- |
| Paste | `Enter` | hides the panel and pastes the entry into the app that was in front |
| Copy | `⌘Enter` | puts the entry back on the clipboard |
| Copy text from image | `⌘⇧T` | on an image entry: the text in it read by OCR (the Vision framework on macOS, `tesseract` on Linux when installed) goes on the clipboard as a copy of its own, "Copied text" in the HUD; an image with no text is a toast |
| Pin / Unpin | `⌘P` | pinned entries sort first and never expire |
| Delete | `⌘D` | removes the entry; asks first |
| Clear history | `⌘⇧D` | removes every entry, pinned ones included; asks first |

`primary_action = "copy"` swaps the first two, so `Enter` copies and
`⌘Enter` pastes. Marked rows (`⇧↓`, `⌘`-click): Copy puts their texts
on the clipboard joined one per line (a file list its paths, an image its
title) as one copy, Delete removes each.

**Paste needs the Accessibility permission on macOS**: the paste is a
synthesised Cmd+V, which the system only delivers from a process on the
Accessibility list. Without it pal shows the system prompt once per run
and a toast, "Paste needs Accessibility. Grant pal in System Settings >
Privacy & Security > Accessibility", instead of half-doing it. On Linux the
paste is Ctrl+V through `wtype`, else `ydotool` (which needs `ydotoold`
running); with neither, paste fails and the toast says so.

What is never recorded: anything a password manager marks as concealed or
transient (the `org.nspasteboard` convention on macOS, the
`x-kde-passwordManagerHint` type on Linux, read through `wl-paste` or
`xclip`), pal's own concealed copies (a 1Password password, a
verification code: marked the same way, and their clear-after restore),
copies over 10 MB, and copies made while an app in `exclude_apps` is in
front. Copying something already in history bumps it to the top instead
of adding a duplicate.

Retention runs after every copy: unpinned entries older than
`max_age_days` are deleted, then the unpinned tail past `max_entries`.
Pinned entries never expire. A search lists at most 200 rows of what is
left, newest first after the pinned ones; type more to narrow it.

**Link**: `pal://clipboard/copy?index=0` puts a history entry back on the
clipboard, `0` (the default) the newest ([Links](links.md#extension-routes)).

### Pinned, filters and more actions

- Pinned entries sit in a **Pinned** section at the top; the rest follow
  without a header.
- A filter dropdown (`Tab`) by kind: All, Text, Images, Files (the core's
  kinds), **Links** (text that is one url) and **Colors** (text that is one
  `#hex` or `rgb()`/`rgba()` colour).
- A colour entry's icon is the colour itself (a tinted dot); an image row
  shows its size next to its dimensions.
- More actions: **Open link** (`⌘O`) on a url, **Paste as plain text**
  (`⌘⇧V`) on text (the entry's text pasted as text), **Copy image file**
  (`⌘⇧C`) on an image (the PNG the core keeps, as a file), **Delete all
  unpinned** (asks first; every unpinned entry deleted one by one, since
  the core's only bulk operation is Clear).

Settings, `[extensions.clipboard]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `exclude_apps` | list | `["com.apple.keychainaccess", "com.apple.Passwords"]` | Bundle ids (`com.1password.1password`) or readable names (`Slack`). The recorder skips copies made while one of them is in front, and entries already recorded from one are not listed. The default is Keychain Access and Passwords; `[]` excludes nothing. |
| `max_entries` | number, 1 to 100000 | `1000` | How many unpinned entries history keeps. |
| `max_age_days` | number, 0 to 3650 | `30` | Unpinned entries older than this are deleted. `0` is no age limit: entries stay until the count limit. |
| `primary_action` | `paste`, `copy` | `"paste"` | What `Enter` does on an entry. |
| `ocr_concealed` | bool | `false` | Text read from an image (Copy text from image) is copied concealed, so it never enters this history. |

The recorder reads the three retention keys once, when pal starts, so a
change to them takes effect at the next launch (`primary_action` applies
live). On Linux the source app of a copy is not known (neither X11 nor the
Wayland data-control protocol says who owns the selection), so
`exclude_apps` has no effect there.

## Clipboard (`clipboard-rows`)

What is on the clipboard right now, read as the things it could be: the
**Clipboard** section of the empty root (before you type), and the same
rows as a palette of their own. The rows are built from the history entry
for the current clipboard, so what history never recorded (a concealed
copy from a password manager, one made while an excluded app was in
front, one over the size cap) never shows here either, and nothing leaves
the machine except the page-title fetch below.

Each row's Enter is the one thing it is for; ⌘K has the rest, and every
row ends in **Hide from the root** (`⌘⇧H`), which keeps the section away
until the next copy:

| what is on the clipboard | rows | Enter | also |
| --- | --- | --- | --- |
| a web address | the page (its title fetched, 1 s at most, else the address; the site's favicon) and a QR code of it | Open | Open in private window (`⌘⇧O`), Copy as Markdown link (`⌘⇧M`), Copy URL, Shorten and copy (with `shortener`); the QR row: Show it large, Save to Desktop (SVG) |
| a colour (hex, `rgb()`, `hsl()`, …, a CSS name) | a swatch with the hex, rgb and hsl forms | Open in Colour Picker | Copy hex, rgb(), hsl() |
| a path, or lines of paths, or files copied in Finder | one row per path (three at most) with its size, then "N files" | Open | Reveal in Finder (`⌘Enter`), Open with… (`⌘O`), Copy name, Copy path; the count row: Reveal all, Copy paths, Copy names |
| an email address | the address | Compose | Copy address |
| a phone number | the number, with the digits | Call (`tel:`) | Copy digits, FaceTime |
| JSON | `JSON · 3 keys` with its size and line count; the pretty form in the detail pane | Pretty-print to clipboard | Minify to clipboard (`⌘⇧M`) |
| an expression (`2+2*3`, `(1+2)/4`, `2^10`, `15% * 80`) | `2+2*3 = 8` | Copy answer | Paste answer (`⌘Enter`), Copy expression = answer |
| a number | the number formatted, its hex, binary and octal | Copy without formatting | Copy as hex, Copy as binary |
| a unix timestamp (10 or 13 digits) or an ISO date | the moment in local time, how far off it is, the ISO form | Copy local time | Copy ISO 8601 (UTC), Copy unix seconds |
| hex or base64 that decodes to text | the decoded text | Copy decoded text | Paste decoded text (`⌘Enter`) |
| a tracking number (UPS, USPS, FedEx, DHL) | Track with the carrier | Open the carrier's page | |
| a git sha, `owner/repo#12`, `owner/repo` | the commit, the issue, the repo | Copy short sha / Open on GitHub | Copy full sha, Copy GitHub URL |
| an image | `Image 640 × 480` with its thumbnail and size; Recognise text when the core can OCR | Save to Desktop | Copy as PNG file (`⌘⇧C`), Paste; the OCR row: Recognise and copy, Recognise and paste |
| any text | the text with its word, character and line counts | Paste as plain text | Save as snippet (`⌘S`, the Snippets form pre-filled), Copy as Title Case, lowercase, UPPERCASE, as slug, trimmed |

A text is read as everything it is at once: `1700000000` is a number and
a timestamp, a path is a path and a text. Text over 64 KB keeps its
counts only. Every row has a detail pane (`⌘I`): the QR code large, the
swatch wide, the JSON pretty-printed, the file list, the image itself.

Settings, `[palettes.clipboard-rows.settings]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `fetch_titles` | bool | `true` | Ask a copied web address for its `<title>` (one request, 1 s at most, http and https only). The only thing these rows send off the machine. |
| `shortener` | text | empty | A URL with `{url}` in it whose response body is the short link, for the Shorten action (`https://is.gd/create.php?format=simple&url={url}`). Empty: no Shorten action. |
| `private_browser` | text | empty | Which browser opens a private window: Google Chrome, Brave Browser, Microsoft Edge, Chromium, Vivaldi or Firefox. Empty: the first of those that is installed. Safari has no such switch. |

## Emoji (`emoji`)

A grid of every emoji in the bundled list, searched by name and keyword.
The tile is the glyph; the name is the shortcode with spaces. A `catalog`
at the root: 1906 rows, so a typed query shows at most three of them there
and the rest behind the "more" row, ranked under the primary and normal
rows that have the word.

Actions:

| action | shortcut | what |
| --- | --- | --- |
| Copy emoji | `Enter` | copies the glyph |
| Copy shortcode | `⌘⇧C` | copies `:shortcode:` |

Settings, per palette, `[palettes.emoji.settings]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `columns` | number, 4 to 16 | `10` | Tiles per row in the grid. Read once when the extension loads: after a change, Settings > Restart extension host. |

### Sections, skin tone and shortcodes

- Sections: **Recently used** first (the last 24 you copied or pasted,
  kept in the extension's storage), then Unicode's groups in order
  (Smileys & Emotion, People & Body, ..., Flags). `data.json` now carries
  `category` and `skin` per emoji (from unicode-emoji-json; the names and
  keywords are emojilib's as before).
- The palette is `live` with a 30 s `ttl`: the order is the sections'
  own, never frecency's, and a show more than 30 s after the last listing
  lists again so the recents follow what you used.
- Search by shortcode: `:thumbs_up:` is a keyword next to `thumbs_up`.
- Actions: **Copy emoji** (`Enter`), **Paste emoji** (`⌘Enter`), **Copy
  shortcode** (`⌘⇧C`); `paste_by_default` swaps the first two.
- Skin tone: `skin_tone` (none by default) is applied to the emoji that
  take one (329 of them: hands, people) in the tile, on copy and on
  paste. The modifier goes after the first code point, which tones a
  single person and the first person of a family or profession sequence;
  a two-person sequence gets one tone, on its first person.

Settings, `[extensions.emoji]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `skin_tone` | `none`, `light`, `medium-light`, `medium`, `medium-dark`, `dark` | `"none"` | The Fitzpatrick modifier applied where an emoji takes one. |
| `paste_by_default` | bool | `false` | `Enter` pastes into the app in front (needs Accessibility on macOS), `⌘Enter` copies. |

## Processes (`processes`)

What is running, from `ps`, listed again on every keystroke because the
set changes constantly (an input palette; the root only has its own row).
The query matches the name or a pid prefix. The row is the executable's
name, its full path the subtitle on macOS (Linux `ps` gives only the
name); the pid and the resident memory sit on the right, and a process
above 10% CPU carries a `NN% cpu` tag (orange, red from 50%). Rows are
sorted by CPU, then memory. On macOS a process that lives in a `.app`
bundle gets that app's icon.

The filter dropdown scopes the list:

| filter | rows |
| --- | --- |
| All | everything (the default) |
| Mine | your own user's processes |
| Top CPU | the 25 busiest |
| Top memory | the 25 largest, by resident memory |

Actions:

| action | shortcut | what |
| --- | --- | --- |
| Kill | `Enter` | `SIGTERM`, after a confirm; the palette stays open and lists again |
| Force kill | `⌘⇧K` | `SIGKILL`, after a confirm |
| Copy PID | `⌘C` | copies the pid |

A kill that fails (a process of another user, a pid that is gone) keeps
the panel open with a toast carrying the OS's message.

### Ports and Activity Monitor

- **Kill by port**: a query of `:` and digits lists what listens on TCP
  ports instead of processes: `:3000` that port, `:30` every port
  starting with 30, `:` alone every listener. One row per process and
  port with the port as a blue tag and the address as subtitle; a process
  `ps` knows gets its usual numbers and icon. `ss -ltnp` on Linux, else
  `lsof -iTCP -sTCP:LISTEN` (macOS ships it). Rows have the same kill and
  copy actions; a row's id is `pid:port`.
- **Open in Activity Monitor** (`⌘O`, macOS): brings Activity Monitor up
  and types the pid into its search field (`⌘F`, then the digits, through
  System Events; needs Accessibility, else the app just comes up).

Settings, `[extensions.processes]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `include_system` | bool | `false` | List system processes too: pids below 100, and kernel threads (children of `kthreadd`) on Linux. |

## Quicklinks (`quicklinks`)

Your own links, kept in the extension's storage and edited in the panel.
At the root a typed web address (`docs.rs/serde`, `https://…`) gets one
inline Open row under a Quicklinks section (`https://` is assumed when
there is no scheme), and a query nothing matched gets every link with a
`{query}` in it filled with the query as a fallback row.
Enter on a link opens it. A link whose url has a `{query}` placeholder
(`https://github.com/search?q={query}`; Raycast's `{argument}` and
`{argument name="Repo"}` are read the same way) drills in instead: the
input fills the placeholder as you type, percent-encoded, and Enter opens
the filled url (⌘C copies it). The row shows the placeholder as a tag and
the url as its subtitle; the icon is the site's favicon.

The root row **Create Quicklink** opens a form (name, url, keywords);
**Edit** (⌘E) opens the same form filled in, and a url the opener could
not take (no scheme, not a path) is refused with the message under the
field. **Delete** (⌃X) asks first. Keywords are extra words the search
matches, space or comma separated.

| action | shortcut | what |
| --- | --- | --- |
| Open | `Enter` | opens the url, or drills in to fill its `{query}` |
| Copy URL | `⌘C` | copies the url as stored |
| Edit | `⌘E` | the form, filled in |
| Delete | `⌃X` | removes it, after a confirm |

**Link**: `pal://quicklinks/open?name=<name>` opens a quicklink by name or
keyword; a `{query}` link opens the panel to fill it, or `&query=<text>`
fills it from the link ([Links](links.md#extension-routes)).

### Import and export

- **Import Quicklinks** / **Export Quicklinks** and **Import Snippets** /
  **Export Snippets** are rows after the list: each opens a form with one
  path field (`~` expanded; export defaults to
  `~/Downloads/pal-quicklinks.json` and `~/Downloads/pal-snippets.json`).
  Export writes your own rows as a JSON array (`{name, url, keywords?}`,
  `{name, text, keyword?}`; no ids), replacing the file. Import reads such
  a file (Raycast's `{name, link}` quicklink export is read too), skips
  what you already have (a quicklink by url, a snippet by name and text),
  and says how many came in. A path that cannot be read or written is
  refused with the message under the field.

Settings, `[extensions.quicklinks]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `import` | path | (none) | A JSON array of `{name, url, keywords?}` listed alongside your own links, read-only (Open and Copy URL only), read on every listing. `~` is expanded. A file that cannot be read lists nothing and says so in the log. |

The links themselves live in `<data dir>/pal/storage/quicklinks.json`
(see Storage in [Extensions](extensions.md)), shared by every config
profile.

## Snippets (`snippets`)

Short texts by name and keyword, kept in the extension's storage and
edited in the panel. Enter pastes the text into the app that was in front
(needs Accessibility on macOS, like Clipboard History), ⌘C copies it
instead. The keyword is a row keyword, so typing `sig` finds the
signature; it shows as a tag, the first line of the text is the subtitle,
and the whole text is in the detail pane (⌘I).

Placeholders in the text are filled in when it is pasted or copied:

| placeholder | becomes |
| --- | --- |
| `{clipboard}` | the newest text on the clipboard |
| `{date}` | today, `YYYY-MM-DD` |
| `{time}` | now, `HH:MM` |
| `{datetime}` | both, with a space between |
| `{uuid}` | a fresh UUID, a different one per occurrence |
| `{selection}` | the text selected in the app in front (the clipboard when nothing is) |
| `{cursor}` | where the caret lands after an expansion (below); dropped by a paste from the panel |

Anything else in braces is left as it is, so a snippet of code keeps its
braces. A snippet with placeholders carries a "dynamic" accessory.

The root row **Create snippet** opens a form (name, keyword, text);
**Edit** (⌘E) opens it filled in; a keyword with a space in it is refused
(one word, so typing it finds the row whole). **Delete** (⌃X) asks first.

| action | shortcut | what |
| --- | --- | --- |
| Paste | `Enter` | hides, then pastes the filled text into the app in front |
| Copy | `⌘C` | copies the filled text |
| Edit | `⌘E` | the form, filled in |
| Delete | `⌃X` | removes it, after a confirm |

**Link**: `pal://snippets/paste?name=sig` pastes the snippet by name or
keyword with the placeholders filled; `&copy=1` copies it instead
([Links](links.md#extension-routes)).

The snippets live in `<data dir>/pal/storage/snippets.json`, shared by
every config profile.

### Expansion: the keyword typed in any app

On macOS, with `expand = true`, a snippet's keyword typed in any other app
is replaced by its text in place: type `;sig` in a mail and the signature
lands where the keyword was, placeholders filled, the clipboard left as
it was. Off by default. How it works (`pal_core::expansion`,
`app/src-tauri/src/expansion.rs`): pal watches the keys typed in other
apps (an `NSEvent` global monitor, which needs **Input Monitoring** for
pal; the Overview's row says so and grants it) and keeps the last 64
characters typed in the app in front; when they end in the prefix and a
keyword, it deletes what was typed with that many backspaces, puts the
filled text on the pasteboard marked concealed (clipboard managers and
pal's own history skip it), pastes it, moves the caret back for a
`{cursor}`, and 300 ms later puts the previous clipboard back (the
backspaces and the paste need **Accessibility**, like Paste). Then the
HUD says "Expanded Signature".

- **Prefix** (`expand_prefix`): `;sig` by default, `:sig`, or `none` for
  the bare keyword at the start of a word (after a space, a bracket, the
  start of the field; `design` never fires `sig`). The bare form fires
  inside ordinary typing more often than you would like, which is why
  the prefix is the default.
- **Never in** (`expand_exclude_apps`): bundle ids where nothing expands.
  Terminals (Terminal, kitty, iTerm, Warp, WezTerm, Alacritty, Ghostty)
  and password managers (1Password, Bitwarden) by default. A secure text
  field (a password field, `sudo` in a terminal; `IsSecureEventInputEnabled`)
  never expands anywhere, and neither do pal's own windows.
- The buffer empties on an arrow, Enter, Tab, Escape, a `⌘` or `⌃`
  combination, a change of app, and after an expansion; Backspace takes
  one character back, so a typo corrected still expands.
- `{cursor}` in the text: the caret lands there after the paste
  (`Dear {cursor},` leaves it before the comma). A paste from the panel
  drops it. `{selection}` is left as written: the selection while a
  keyword is being typed is the keyword.
- A snippet saved or edited in the panel expands on the next keystroke:
  the storage file is re-read when its mtime moves.
- Linux: not available. Wayland hands key events to the focused client only and
  X11 has no portable tap either, so nothing watches the keys; the palette's
  Enter is the way to paste a snippet, and `pal://snippets/paste?name=sig` binds
  one to a compositor key.

Settings, `[extensions.snippets]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `expand` | bool | `false` | Expand keywords typed in other apps (macOS). Needs Accessibility and Input Monitoring for pal. |
| `expand_prefix` | `";"`, `":"`, `"none"` | `";"` | What comes before the keyword. |
| `expand_exclude_apps` | list of bundle ids | terminals and password managers | Apps where nothing expands. |
| `expand_hud` | bool | `true` | "Expanded `<name>`" in the HUD after an expansion. |

## SSH Hosts (`ssh`)

Every `Host` in `~/.ssh/config` that is a name rather than a pattern
(`*`, `?` and `!` entries are skipped, a `Host a b` line gives two rows),
in file order. `Include` lines are followed one level: `~`, absolute and
globbed operands work, a relative one is under `~/.ssh`. A `Match` block
ends the current host. `HostName` is the subtitle (and a keyword, so the
real name finds the alias), `User` an accessory and a keyword, `Port` a
tag.

With `include_known_hosts` on, the names in `~/.ssh/known_hosts` (next to
the config) come after, in a second section: `[host]:port` unwrapped,
comma lists split, hashed lines, bare IPs and hosts already in the config
skipped.

Actions:

| action | shortcut | what |
| --- | --- | --- |
| Connect | `Enter` | opens a terminal window running `ssh <host>` |
| Copy host | `⌘C` | copies the host name |
| Copy ssh command | `⌘⇧C` | copies `ssh <host>` |

Which terminal Connect opens:

- **macOS**: the `terminal` setting. `auto` takes the first installed of
  kitty, Ghostty, Alacritty, iTerm2, Terminal (Terminal is always there,
  so it is the fallback). kitty gets `kitty -1 ssh host` (a new OS window
  in the running instance when that was started single-instance), Ghostty
  and Alacritty `open -na <app> --args -e ssh host`, Terminal and iTerm2
  an AppleScript that opens a window running the command. A terminal that
  is picked but not installed keeps the panel open with a toast.
- **Linux**: `$TERMINAL`, else the first of kitty, foot, alacritty, xterm
  on PATH; kitty and foot take the command as arguments, the others after
  `-e`. Same rule as the Applications palette's terminal entries.

### Sections, ProxyJump and Ping

- The section is the file a host came from, relative to the config's
  directory (`.ssh/config`, `.ssh/conf.d/work.conf`); known hosts stay a
  last `Known hosts` section.
- `ProxyJump` is read: the row carries a `via <jump>` tag and the jump as
  a keyword, and **Copy ssh -J command** (`⌘⇧J`) copies
  `ssh -J <jump> <host>` (the plain command already goes through the
  config's ProxyJump; the `-J` form is for a machine without it).
- **Ping** (`⌘P`): one echo to the HostName (else the name), the round
  trip as a toast (`marko.lan: 3 ms`), or why it did not answer.

Settings, `[extensions.ssh]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `config` | path | `~/.ssh/config` | The config to read. `~` is expanded; `known_hosts` is looked for next to it. |
| `include_known_hosts` | bool | `false` | List the names in `known_hosts` too, in a second section. |
| `terminal` | `auto`, `kitty`, `Terminal`, `iTerm2`, `Ghostty`, `Alacritty` | `auto` | macOS only: which terminal Connect opens. |

## Files (`files`, `files-browse`, `files-recent`)

An input palette over the operating system's own file index: what you type
is a name search on every keystroke, never a walk pal indexes itself. A
typed path (`~/Down`, `/usr/local/bin`) completes instead of searching:
the file itself when it exists, else the entries of its folder that start
with the last segment (hidden ones only when the segment starts with a
dot or `show_hidden` is on); at the root the same rows show inline under
a Files section. A path ending in `/` (`~/`, `/usr/local/`) lists that
folder whole, as [browsing](#browsing-folders) does. A root query nothing
matched gets a "Search Files for
“…”" fallback row that opens the palette with it typed. The
row is the file name; the parent folder is the subtitle (home shortened to
`~`); the size and the modification date are accessories. `.app` bundles
get their own icon, everything else a glyph by kind (folder, image,
document, code, archive). Exact and prefix name matches come first, the
rest in the backend's order, at most `limit` rows. With nothing typed the
palette shows one hint row naming the backend and the folders it searches.

The backend is picked once when the extension loads:

| platform | backend | how |
| --- | --- | --- |
| macOS | Spotlight | `mdfind -name <query> -onlyin <folder>...`; case-insensitive substring of the display name, so `kitty` finds `kitty.app` |
| Linux | `fd` | `fd --absolute-path --fixed-strings --max-results <limit> --max-depth 8 --exclude <x>... <query> <folders>`; respects `.gitignore` like fd does everywhere |
| Linux, no fd | `locate` | `locate -i <query>`, filtered to the folders (`updatedb` decides how fresh it is) |
| Linux, neither | `find` | `find <folders> -iname '*<query>*'`; walks the folders on every keystroke, and a second hint row says so |

Every search is one process: killed after 3 s, killed as soon as `limit`
paths have been read, and killed when the next keystroke starts a new one.
The `exclude` folders are pruned from the walk (fd, find) or dropped from
the answer (Spotlight, locate); fd also stops eight levels down, since with
fewer than `limit` matches it would otherwise walk the whole home. The
backend picked is logged once at load (`[files] backend: fd`).

**Contents** are searched too. A plain query lists the name matches, then
a second section, "In files", of files whose text contains the query,
each row's subtitle the first matching line (`12: the line` collapsed to
one line, then the folder). A query starting with `'` or `content:`
(`'invoice total`, Alfred's `in` prefix) searches contents only. The
content backend, picked once at load and logged (`[files] content:
mdfind`): Spotlight's text index on macOS (`mdfind -onlyin <folder>...
'kMDItemTextContent == "*<query>*"cd'`, so PDFs and documents count, and
only what Spotlight has indexed), `rg --files-with-matches` on Linux when
ripgrep is installed, else `grep -rlI`. One process per keystroke, killed
after 1 s: what it printed by then is the answer. The snippet is `rg -n
-m1` (or `grep -n -m 1`) per file, eight at a time; a file the tool
cannot read as text (a PDF Spotlight matched) keeps the folder as its
subtitle. A file both searches find is listed once, as the name match.
`content_search = false` keeps the second section off; the prefix still
works.

The detail pane (lazy, asked when the cursor rests on a row) shows the
path, size, modified time and kind; for a text file under 64 KB the first
40 lines in a code block. No image preview: the app's `icon://` scheme
serves app icons, favicons and clipboard images only.

Actions:

| action | shortcut | what |
| --- | --- | --- |
| Open | `Enter` | the system opener; on a folder row this is Browse (below), Open second |
| Browse | `Enter`, `→` | a folder's contents as a level (below); `→` from anywhere in a listing while nothing is typed |
| Reveal in Finder / Show in file manager | `⌘Enter` | `open -R` on macOS, `xdg-open` on the parent folder on Linux |
| Open with… | `⌘O` | a level listing the apps registered for the file (below) |
| Copy path | `⌘C` | copies the absolute path |
| Copy file | `⌘⇧C` | the file itself onto the clipboard: a paste in Finder or a file manager copies it, a paste in a text field gets its path |
| Copy text (OCR) | `⌘⇧T` | on an image or a PDF: the text in it (the PDF's first page) read by OCR onto the clipboard, "Copied text" in the HUD; the Vision framework on macOS, `tesseract` on Linux when installed (a toast otherwise). A PDF page is rendered by `pdftoppm` when installed, else `sips` on macOS |
| Move to Trash | `⌘D` | asks first; Finder's delete on macOS, `gio trash` on Linux; the palette stays open with a toast |
| Use in TextEdit's open panel | `⌘G` | only while the app in front has an Open or Save panel up: pal hides and types the path into it through its Go to Folder sheet (`ctrl+L` on a GTK chooser); listed first then, and the empty root leads with a "Dialog" hint into Files |

Marked rows (`Tab` here, `x` while nothing is typed, `⇧↓`, `⌘`-click): Open,
Reveal, Copy path (the paths one per line), Copy file and Move to Trash run over
all of them as one pick; Quick Look and Open with… stay one file's.

### Browsing folders

Enter (or `→`) on any folder row, in a search, the recents, a completion
or the root's inline Files section, pushes the **Browse Folder** palette
(`browse`) with that folder: a level whose crumb is the folder's path
(`~/proj`), led by a `..` row and followed by the entries under the
dropdown's sort. `Enter`, `←` or `Backspace` on the `..` row goes up, and
`←` or `Backspace` from any row does too while nothing is typed
(LaunchBar's and Alfred's convention); `→` on a folder goes in. There is
no `..` row at `/`. Typing filters the listing by name (a case-insensitive
substring); `Tab` cycles the sort:

| sort | order |
| --- | --- |
| Name | folders first, then files, each case-insensitive alphabetical (Finder's) |
| Date | newest first, folders and files mixed |
| Size | largest first, folders (no size of their own) last |

Hidden entries (a leading dot) show only with `show_hidden`, which `⌘.`
flips from any row (it writes the setting, so every listing follows; the
action's title says which way). A picture draws its own thumbnail in
place of the kind glyph (`icon://localhost/file`, the app's scheme). A
folder over 500 entries shows that many and a last, inert row counting
the rest; typing narrows past the cap. File rows carry the same actions
as search rows (`⌘I` for the pane; `Tab`, `x`, `⇧↓` mark rows as in
Files), the `..` row's pane describes the folder it leads to, and Open
with… from a browsed row pushes the apps level on this palette. Inside
Files, a typed path ending in `/` that names a folder lists it the same
way (the `..` row, every entry sorted by name, the cap), so `~/` is a
way in without a search; a path without the slash still completes the
last segment. Opened by name from the root (its own row, "Browse
Folder") it lists the home folder.

**Open with…** drills into a level of the applications the OS registers
for the file, each with its own icon: the default (what `Enter` would use)
first with a `default` tag, the rest by name; typing narrows them by name
or bundle id, and `Enter` opens the file with that app (`open -a` on
macOS, `gio launch` on Linux) and hides the panel. On macOS the list is
Launch Services' (`NSWorkspace`, every role); on Linux the file's MIME
type (`xdg-mime query filetype`, else `file`) is looked up in the
`mimeapps.list` files and every data dir's `mimeinfo.cache`, the default
from `xdg-mime query default`, and a `text/*` file also gets the
`text/plain` editors. A file nothing is registered for shows one hint
row.

**Copy file** writes file URLs on macOS and `text/uri-list` on Linux
(X11, or Wayland with the wlr data-control protocol; a compositor without
it gets a toast saying so). The clipboard history records it as a files
entry like any copy.

### Recent files and Quick Look

- Before you type, the Files palette lists the **recently used files**
  (a `Recently used` section) instead of the hints: on macOS Spotlight's
  `kMDItemLastUsedDate` over the last seven days within the configured
  folders (`mdfind -attr`, so the rows sort newest first), on Linux GTK's
  `~/.local/share/recently-used.xbel`. Folders, hidden and excluded paths
  and files that are gone are left out; the date on the right is when the
  file was last used.
- **Recent Files** (`files-recent`) lists the same rows as a palette of
  its own: live (newest first is the order), listed again on a show once
  the listing is a minute old, with the same actions and detail pane.
- **Quick Look** (`⌘Y`) on macOS opens the file in `qlmanage -p`.

Settings, `[extensions.files]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `folders` | list of paths | `["~"]` | Where to search. `~` is expanded. |
| `limit` | number, 1 to 500 | `50` | At most this many rows per query. |
| `show_hidden` | bool | `false` | List files and folders whose name starts with a dot (below the configured folder; `~/.config` as a folder is fine either way). |
| `exclude` | list of names | `["node_modules", ".cache", "Library/Caches", "target"]` | Folders skipped below the search folders, by name or a short path. |
| `content_search` | bool | `true` | The "In files" section under the name matches. Off, only the `'` prefix searches contents. |
| `ocr_concealed` | bool | `false` | Text read from an image (Copy text) is copied concealed, so it never enters the clipboard history. |

## System (`system`)

Sleep, lock, log out, restart, shut down, empty the trash, dark mode,
volume, brightness, do not disturb, eject, show desktop, keep awake. The
rows are indexed, so `mute` or `sleep` at the root finds them (each
carries keywords: `suspend`, `power off`, `bin`); live because the Keep
Awake row flips to Allow Sleep while a keep-awake is running, and a live
palette lists again on every show. pal hides the panel before running a
command, so it lands on the desktop, not on pal.

Only commands this machine can run are listed:

| command | macOS | Linux |
| --- | --- | --- |
| Sleep | `pmset sleepnow` | `systemctl suspend` |
| Sleep Displays | `pmset displaysleepnow` | Hyprland (`hyprctl dispatch dpms off`) or Sway (`swaymsg output * dpms off`) only |
| Lock Screen | the login framework's immediate lock, falling back to the Cmd+Ctrl+Q keystroke (which needs Accessibility) | `loginctl lock-session` |
| Log Out | System Events | `hyprctl dispatch exit`, `swaymsg exit`, else `loginctl terminate-session` |
| Restart, Shut Down | System Events | `systemctl reboot`, `systemctl poweroff` |
| Empty Trash | Finder | `gio trash --empty` |
| Toggle Dark Mode | System Events appearance | `gsettings` `color-scheme` between `default` and `prefer-dark` |
| Volume Up, Down, Toggle Mute | 10% steps, System Events | `wpctl`, else `pactl`, 10% steps |
| Brightness Up, Down | needs the `brightness` CLI on PATH; hidden otherwise | `brightnessctl`, 10% steps |
| Toggle Do Not Disturb | runs a Shortcut named "Toggle Do Not Disturb"; hidden until you create one (Focus has no CLI) | `swaync-client`, `makoctl` or `dunstctl`; hidden with none |
| Eject All Disks | Finder | not available |
| Show Desktop | Mission Control | not available |
| Keep Awake / Allow Sleep | `caffeinate -d -i`, detached; running it again stops it | `systemd-inhibit --what=idle:sleep ... sleep infinity`, the same toggle |

Log Out, Restart, Shut Down and Empty Trash are destructive: with
`confirm_destructive` on, `Enter` asks "(command) now?" first. A command
that fails keeps the panel open with a toast carrying the tool's message.

**Link**: `pal://system/run?id=<command>` runs one by its id (`sleep`,
`lock`, `logout`, `restart`, `shutdown`, `empty-trash`, `dark-mode`,
`volume-up`, `volume-down`, `volume-mute`, `brightness-up`,
`brightness-down`, `dnd`, `eject-all`, `show-desktop`, `keep-awake`);
the route is declared with `confirm`, so a link always asks first
([Links](links.md#extension-routes)).

### Trash count and dark mode

- **Empty Trash** shows what is in the Trash on the right (`3 items`,
  `empty`); `~/.Trash` itself is readable only with Full Disk Access, and
  without it the row simply has no count. Linux reads
  `~/.local/share/Trash/files`.
- **Toggle Dark Mode** carries the current appearance as a tag (`dark`
  violet, `light` amber), from `defaults read -g AppleInterfaceStyle` on
  macOS and GNOME's `color-scheme` on Linux.

Settings, `[extensions.system]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `confirm_destructive` | bool | `true` | Confirm before logging out, restarting, shutting down or emptying the trash. |

## Windows (`windows`)

Every open window with its app's icon, in the desktop's order (front to
back on macOS, most recently focused first on Hyprland), never ranked by
use. A live palette: the list runs on every show, so window titles are
root results. The app name is the subtitle; the bundle id or window class
is a keyword; a minimised window carries a `minimized` tag, one on another
workspace or space `ws <n>` or `other space`, and the monitor when known.

Actions:

| action | shortcut | what |
| --- | --- | --- |
| Focus | `Enter` | hides the panel, then raises the window, restoring it if minimised |
| Close | `⌘W` | closes the window; the palette stays open and lists again |
| Minimize | `⌘M` | minimises; not offered on a window that already is |

Marked rows (`Tab` here, `x` while nothing is typed, `⇧↓`, `⌘`-click): Close and
Minimize run over all of them; Focus is one window.

- **macOS**: the list comes from CoreGraphics merged with the Accessibility
  API for the parts CoreGraphics does not give (another app's window title,
  whether it is minimised). Without the Accessibility permission the list
  still works (titles only when Screen Recording allows, else the app
  name), focusing falls back to activating the app, and close and minimise
  fail with "needs Accessibility permission". Focus shows the same
  one-time prompt and toast as paste when the permission is missing.
- **Linux**: the backend is detected, not configured. Hyprland when
  `hyprctl` and an instance signature exist (the newest
  `$XDG_RUNTIME_DIR/hypr/*` when the variable is missing, so a
  service-started pal works); Sway on `SWAYSOCK`; X11 on `DISPLAY` plus
  `wmctrl`. Hyprland has no minimise, so pal parks the window on the
  `special:minimized` workspace and Focus brings it back. Sway minimise is
  `move scratchpad`; X11 minimise needs `xdotool`. With none of the three
  the palette reports "no Hyprland, Sway or X11 (wmctrl) session".

### Grouping and app actions

- Rows are grouped by app (a section per app, in the order the front
  window of each gives); the app name is a keyword as well as the
  subtitle.
- More actions: **Hide app** (`⌘H`, macOS: System Events hides the
  window's process), and on an app with more than one window **Minimize
  all of this app** (`⌘⇧M`) and **Close all of this app** (`⌘⇧W`, asks
  first).

Settings, `[extensions.windows]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `include_minimized` | bool | `true` | List minimised windows too (focusing one restores it). |

## Window Management (`window-management`, `window-management-arrange`)

Move and resize windows from the keyboard, Raycast's set: one row per
layout (halves, thirds, quarters, the maximize family, larger and smaller,
a nudge by a step, the other display, fullscreen, minimize, restore),
`Enter` applies it to the window you were in. pal hides its panel
first, so the window with focus is the one behind the panel, not pal; the
HUD then names the layout, or says why it did not happen ("Restore: nothing
to restore", "Next Display: only one display").

| layout | id | what |
| --- | --- | --- |
| Left Half, Right Half, Top Half, Bottom Half | `left_half` `right_half` `top_half` `bottom_half` | half of the screen |
| Left Third, Center Third, Right Third | `left_third` `center_third` `right_third` | a third |
| Left Two Thirds, Right Two Thirds | `left_two_thirds` `right_two_thirds` | two thirds |
| Top Left, Top Right, Bottom Left, Bottom Right Quarter | `top_left_quarter` `top_right_quarter` `bottom_left_quarter` `bottom_right_quarter` | a quarter |
| Maximize, Almost Maximize | `maximize` `almost_maximize` | the whole screen; `almost_maximize_percent` of it, centred |
| Maximize Height, Maximize Width | `maximize_height` `maximize_width` | the full height or width, the other side kept |
| Center, Reasonable Size | `center` `reasonable_size` | centred as it is; `reasonable_size_percent` of the screen, centred |
| Larger, Smaller | `larger` `smaller` | 10% bigger or smaller about the centre |
| Move Left, Right, Up, Down | `move_left` `move_right` `move_up` `move_down` | nudged by `step` pixels |
| Next Display, Previous Display | `next_display` `previous_display` | the same place on the other display |
| Toggle Fullscreen, Minimize, Unminimize | `fullscreen` `minimize` `unminimize` | window state, not a frame (below) |
| Restore | `restore` | the frame the window had before the run of layouts |

These ids are what `item_hotkeys` (below) and the
`pal://window-management/layout?name=<id>` route take
([Links](links.md#extension-routes)).

### What it does not do

No custom layouts: the thirty-one above are the set; `gap`, `step` and
the two percentages are the knobs. Larger and Smaller are a fixed 10%.

## Store (`store`)

pal.cagdas.io's extension list in the panel. An input palette: what you
type narrows the list by name, title, tagline, category and author; the
dropdown (`Tab`) filters to **Installed**, **Updates**, or one of the
site's shelves (Productivity, Developer, System, Media, Reference, Fun,
Integration). Every row is one extension with its tile, its tagline as
the subtitle, chips for what it brings (`menu bar`, `links`, `accounts`),
an `installed` or `bundled` tag, or `update to x.y.z` when the site has
a newer version of one installed from the store; the category on the
right. What is behind leads the list under an **Updates** heading. The
detail pane (`⌘I`) shows the description, "What it does", the
screenshots (loaded from the site) and a keys table per palette, with
the author, version (the installed one beside it when they differ),
category, licence, platforms, what it needs, the `pal install` line and
a link to the page.

| standing | `Enter` | `⌘Enter` | `⌘C` | `⌃X` |
| --- | --- | --- | --- | --- |
| not installed | Install (asks first) | Open store page | Copy `pal install <name>` | |
| from the store, current | Open store page | Update (asks first) | Copy install command | Remove (asks first) |
| from the store, behind | Update (asks first) | Open store page | Copy install command | Remove (asks first) |
| bundled with pal | Open store page | | Copy install command | |

Install, Update and Remove run through the core's `pal://install`,
`pal://update` and `pal://remove` routes ([Links](links.md)) without the
link's card (the panel's confirm is the question; Enter here is your
hand): the HUD says "Installing…" and the outcome, the extension host
restarts with the change, and an install reopens the root with the
extension's name typed so its palettes are one keystroke away. A
bundled extension is never updated from here: it ships with pal and
moves with the app.

The list comes from `https://pal.cagdas.io/api/extensions`, fetched at
most once an hour, trimmed to what the rows and the pane need, and kept
in the extension's storage across restarts; `⌘R` fetches now. Offline
with a list from before, the rows show under a "Showing the list from N
min ago" note; with no list at all, one row says the site is not
reachable. `PAL_STORE_API` points the palette at another server (the
tests serve a fixture). No settings.

"The screen" is the display the window's centre is on (the one it overlaps
most when the centre is off every display), minus the menu bar, Dock, or
bars, minus `gap` on every side; the halves, thirds and quarters are equal
cells with `gap` between them. Restore remembers, per window and in memory
until pal quits, the frame a window had before a run of layouts started: a
run is any sequence of pal layouts, and moving the window by hand in
between starts a new one, so Restore goes back to where you had put it.

Actions:

| action | shortcut | what |
| --- | --- | --- |
| Apply | `Enter` | the layout on the focused window |
| Apply to… | `⌘Enter` | pick a window from the open ones (the Arrange Window palette), then the layout goes on that one |

**Arrange Window** (`window-management-arrange`) is the same thing the
other way round: an input palette of the open windows (minimised ones left
out); `Enter` on one lists the layouts with that window's title as the
subtitle, and `Enter` on a layout applies it there.

Per-layout global hotkeys, which move the focused window without showing
pal at all, are `item_hotkeys` under the palette in the config file (see
[Config](config.md#palettesid)); the moves and the resizes are the ones
worth a key, since they repeat:

```toml
[palettes.window-management.item_hotkeys]
left_half = "ctrl+alt+left"
right_half = "ctrl+alt+right"
maximize = "ctrl+alt+enter"
restore = "ctrl+alt+backspace"
larger = "ctrl+alt+="
smaller = "ctrl+alt+-"
move_left = "ctrl+alt+shift+left"
move_right = "ctrl+alt+shift+right"
move_up = "ctrl+alt+shift+up"
move_down = "ctrl+alt+shift+down"
fullscreen = "ctrl+alt+f"
minimize = "ctrl+alt+m"
```

Toggle Fullscreen, Minimize and Unminimize are window state, not a frame:
Restore does not undo them, and Unminimize picks its own window (the one
Minimize last put away while it is still minimised, else the frontmost
minimised one), so it has no Apply to… and is not offered for a picked
window. Larger and Smaller scale each side by 10% about the centre and
are then pushed back inside the screen where they fit; the moves stop at
the screen's edge; both leave a window larger than the screen where it is.

- **macOS**: needs the Accessibility permission (the frame is set through
  the window's `AXPosition` and `AXSize`); without it `Enter` shows the same
  toast as paste and asks once. The displays are `NSScreen`'s frames with
  `visibleFrame` for the usable part, so an auto-hidden menu bar or Dock
  gives the whole screen. Apps keep their minimum size and may round.
- **Linux**: Hyprland (`movewindowpixel exact` / `resizewindowpixel exact`;
  a tiled window is floated first, since an exact frame means nothing
  inside the tiling layout; the display is `monitors -j` with `reserved`
  taken out; Toggle Fullscreen is `focuswindow` then `dispatch fullscreen
  0`, since that dispatcher takes no window), Sway (`floating enable`,
  `move absolute position`, `resize set`, `fullscreen toggle`; the
  workspace rect is the usable part), or X11 (`wmctrl -i -r <id> -e`, `-b
  toggle,fullscreen`; `xrandr --listmonitors` for the displays, `wmctrl
  -d`'s work area for the usable part, `xprop -root _NET_ACTIVE_WINDOW` for
  the focused window). Minimize is the Windows palette's (`special:minimized`,
  the scratchpad, `xdotool`), Unminimize its focus. Sway and X11 are written
  to the tools' documented shapes and unit-tested on fixtures, not run
  against a live session yet.

Settings, `[extensions.window-management]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `gap` | number (px) | `0` | Pixels between a window and the screen edge, and between two windows of a split. |
| `almost_maximize_percent` | number (%) | `90` | How much of the screen Almost Maximize fills, centred. |
| `reasonable_size_percent` | number (%) | `60` | How much of the screen Reasonable Size fills, centred. |
| `step` | number (px) | `32` | How far Move Left, Right, Up and Down nudge the window. |

## Scripts and data files (`scripts`)

The zero-code tier: every `[palette.<name>]` table of a scripts config file
becomes a palette, backed by a shell script speaking JSON lines or by a
json / jsonl / toml data file. Each such palette has the id
`scripts-<name>`. Its settings and the whole format are in
[Scripts and data files](scripts.md). A data-file table of 100 rows or
more (the nerd and kde icon lists, `chars`) is a `catalog` at the root
unless the table sets `tier` itself.

## Home Assistant (`home-assistant-entities`, `home-assistant-services`, `home-assistant-areas`)

Home Assistant over its REST API (`/api/states`, `/api/services`, one
`/api/template` render for areas), with a long-lived access token;
`multi`, so a second home is `[instances."home-assistant@cabin"]` with
its own `url` and `token` ([Config](config.md#instances)).

**Home Assistant** (`home-assistant-entities`) is live: every entity of
the `domains` setting, listed again whenever the panel shows, so a light's
state at the root is the current one and `kitchen light` finds it from the
root. Favourites come first in their order, then the domains in the
setting's order, names sorted within. A row is the friendly name; the
subtitle is the domain and the area (when the entity has one); the entity
id, domain and area are keywords; the accessories are the state (a
coloured tag for `on`/`off`/`open`/`locked`/`playing` and the other known
states, the value with its unit otherwise) and when it last changed. The
icon is the domain's glyph; a light that is on is a dot in its colour
(`rgb_color`, else warm white). The filter (`Tab`) scopes it: All entities (the
`domains` setting), Every domain (the rest after those), then Lights,
Switches, Sensors, Binary sensors, Climate, Media players, People, Scripts,
Automations, Scenes; a domain filter shows its domain whether or not it is
in `domains`. The detail pane (lazy) shows the entity, its state
and its attributes.

Actions, by domain (`Enter` is the first; `⌘K` has them all):

| domain | actions |
| --- | --- |
| light | Toggle, Turn on, Turn off, Brightness (`⌘B`: a level of presets 10/25/50/75/100 %, the current one tagged) |
| switch, fan, input_boolean, humidifier | Toggle, Turn on, Turn off |
| climate | Set temperature (a form: the temperature with the entity's range, the mode from its `hvac_modes`), Turn on, Turn off |
| cover | Open, Close, Stop (Close first while open) |
| lock | Lock, Unlock (both ask first; the one that changes the state comes first) |
| media_player | Play or Pause, Next track, Previous track, Volume (`⌘U`: presets), Turn off |
| scene | Activate |
| script | Run |
| automation | Trigger, Enable or Disable |
| button, input_button | Press |
| vacuum | Start, Return to dock |
| anything else (sensor, binary_sensor, person, ...) | Copy value |

Every row also has the domain's second action on `⌘Enter` (turn on or
off, set, pause), Copy entity id (`⌘C`), Show attributes (`⌘⇧A`: a level
with the state and every attribute as rows, each copying its value, `⌘C`
its name) and Open in Home Assistant (`⌘O`: the automation or script
editor, the history page for the rest). A service call keeps the panel
open and lists again, so the row shows the new state, with a toast naming
it; a call that fails is a failure toast with HA's answer. Entity ids are
the row ids, so `[palettes.home-assistant-entities.item_hotkeys]` with
`"light.kitchen" = "ctrl+alt+k"` toggles the kitchen light without showing
pal.

**Home Assistant Services** (`home-assistant-services`) is every service
from `/api/services`, by domain then name, the id (`light.turn_on`) as an
accessory and a keyword, HA's name and description when it gives them
(most core services carry none over REST; the key is title-cased instead).
`Enter` opens a form: the target as a select of the entities the service
takes (its domains, every entity for a service that targets any, no field
for one without a target), then the service's fields from its description:
a `select` selector is a select, a `boolean` one a checkbox, the rest text
with the example as placeholder and a number's range in the help line. A
group's fields are inlined; a collapsed group (HA's "advanced" section) is
left out. The submit calls the service with the values coerced by selector
(numbers, JSON for objects and anything typed as `[...]` or `{...}`, comma
lists for entity selectors), empty fields left out, and toasts what
changed; a number field that is not one comes back on the form. Copy
service id is `⌘C`. Listed once an hour.

**Home Assistant Areas** (`home-assistant-areas`) is every area that has an
entity, with the count; `Enter` lists those entities. The mapping is one
template render (`areas()`, `area_entities()`, `area_name()`), kept ten
minutes for the entity rows' subtitles; an HA that refuses the template
API leaves the rows without areas and the palette with a hint row.

When something is wrong every palette is one inert hint row that says
what and where to fix it (Settings, Extensions, Home Assistant): no URL, a
URL without a scheme, no token, a `keychain:`/`env:` token that did not
resolve, a rejected token (401), a host that did not answer within the
timeout, or one that could not be reached. Every request carries the
timeout. A URL that redirects (an `http://` one behind a proxy that
answers 301 to `https://`) is followed with the token kept, since `fetch`
would drop it on the new origin, and the log says which URL to set.

Settings, `[extensions.home-assistant]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `url` | text | unset | Where Home Assistant answers, scheme included (`http://homeassistant.local:8123`). |
| `token` | secret | unset | A long-lived access token (your profile in HA, Security). A `keychain:` or `env:` reference in the file. |
| `domains` | list | `light`, `switch`, `climate`, `media_player`, `cover`, `lock`, `fan`, `scene`, `script`, `automation`, `sensor`, `binary_sensor`, `person`, `input_boolean` | The domains listed at the root, in this order. |
| `favorites` | list | `[]` | Entity ids pinned to the top, in this order, whatever their domain. |
| `timeout` | number (s) | `5` | How long one request may take. |

## Verification Codes (`otp`)

One-time codes out of your recent text messages, read straight from
Messages' database (`~/Library/Messages/chat.db`, read-only, one SQLite
query per listing). The last `hours` of incoming messages are scanned; a
message counts when it talks about a code (code, kod, şifre, OTP, PIN,
parola, passcode, verification, doğrulama, código, token and so on) and
carries a run of 4 to 8 digits that is not part of an amount, a date, a
time or a phone number; Google's `G-123456` is taken by its digits. The
row is the sender as Messages knows it (a shortcode like `AKBANK`, an
alphanumeric originator, a number or an email; a number or an email that
is in Contacts shows the contact's name, from the AddressBook database
the same permission covers), the message text is the subtitle, the code
is a green tag on the right with how long ago it arrived. Sections are
Today and Earlier, newest first. A live palette: listed again on every
show, so the code that just arrived is at the top, and the codes are root
results while they are in the window. A message whose `text` is empty is
read from its `attributedBody` (macOS Ventura and later keep the text
there).

Actions:

| action | shortcut | what |
| --- | --- | --- |
| Paste code | `Enter` | hides, then pastes the code into the app in front (Accessibility, as for any paste) |
| Copy code | `⌘C` | copies the code |
| Copy sender | `⌘⇧C` | copies the sender as Messages stores it |

Permissions and platforms:

- **Full Disk Access**: Messages keeps the database behind it, and
  without it SQLite answers "authorization denied" (`SQLITE_AUTH`); the
  palette then has one row, "Full Disk Access needed", whose action opens
  Privacy & Security, Full Disk Access. Grant it to pal, open the palette
  again. There is no other way to read Messages.
- A database SQLite reports locked (`SQLITE_BUSY`) is copied aside with
  its `-wal` and `-shm` and the copy is read; the copy is removed after.
- A database that is not there ("No Messages database"), or any other
  read error, is one inert row with the reason.
- **Linux**: one "Unavailable" row; there is no Messages.

The bar item `otp/latest-code` puts the newest code on the strip, green,
for a minute after it arrived (hidden otherwise); a click copies it. The
same reader, the same permission.

Popover keys of `otp/latest-code` (rendered every 10 s; the arrows move the
cursor, a click sets it):

| keys | does |
| --- | --- |
| `enter` | Copy the code (concealed, clears after 30 s) |
| `p` | Paste the code into the app in front |
| `s` | Copy the sender |
| `o` | Open the Verification Codes palette |

Settings, `[extensions.otp]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `hours` | number | `24` | How far back to scan. |
| `senders` | list | `[]` | Senders never listed, as Messages shows them (`AKBANK`, a number, an email); case does not matter. |
| `db` | path | `~/Library/Messages/chat.db` | The database to read. |
| `contacts` | path | `` | An `AddressBook-v22.abcddb` for names; empty reads every source under `~/Library/Application Support/AddressBook`. |

## 1Password (`onepassword-items`)

Your 1Password items through the `op` CLI. One `op item list --format
json` per listing, kept for `ttl` seconds so the vault filters and a
Refresh inside the ttl do not run the CLI (and its unlock prompt) again;
`⌘R` past the ttl asks it again. The row is the item's title, the vault
and the username the subtitle, a glyph by category (login and password,
secure note, card and bank account, identity, SSH key, API credential,
server and database, and so on), the primary website's host on the right,
favourites first with a `favorite` tag, then by title. The item's website
hosts, username, category, vault and tags are keywords, so `github.com`
finds the login. The detail pane lists vault, category, username, the
website as a link, tags and the update time. No secret is ever in a row,
the index or a log: a pick runs `op item get` for that one field and puts
the value on the clipboard.

Actions:

| action | shortcut | what |
| --- | --- | --- |
| Copy password | `Enter` | `op item get <id> --fields label=password --reveal`; "Copied password" in the HUD |
| Copy username | `⌘U` | the `username` field |
| Copy one-time code | `⌘T` | `op item get <id> --otp`, the current TOTP |
| Open in 1Password | `⌘O` | `onepassword://view-item?i=<item>&v=<vault>&a=<account>`, the app's own link (the account from `op account list`, when there is one or `account` names it) |

An item without the field (a secure note has no password, a login without
TOTP has no one-time code) keeps the panel open with a toast carrying the
CLI's message.

Signed in or not:

- Nothing signed in (or no account set up for the CLI at all) is one row,
  "Sign in to 1Password", whose action opens the CLI's sign-in page. Sign
  in with `eval $(op signin)` in a terminal, or turn on the desktop app
  integration (1Password, Settings, Developer), then `⌘R`.
- With the app integration on, every CLI call that needs the vault shows
  1Password's own unlock prompt (Touch ID on a Mac); pal waits up to a
  minute for it.
- `op` not installed (looked up on PATH, then `/opt/homebrew/bin`,
  `/usr/local/bin`, `/usr/bin`) is one row whose action opens the install
  page.

Settings, `[extensions.onepassword]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `account` | text | `` | Passed as `--account` to every call: a shorthand, sign-in address, account id or user id. Empty uses the CLI's default account. |
| `vaults` | list | `[]` | Only these vaults are listed, and each is a filter in the palette (All vaults first). Empty lists every vault with no filter. The filters are read when the extension loads, so a change shows after the host restarts. |
| `ttl` | number (seconds) | `300` | How long the item list is kept before `op` is asked again. |

## Browser Tabs (`browser-tabs-tabs`)

Every open tab of your browsers, in the browsers' own order, never ranked.
A live palette: listed again on every show, so tab titles are root
results. Three sources are merged:

- **DevTools protocol**: a Chromium browser (Chrome, Chromium, Brave,
  Edge, Vivaldi, Arc) started with `--remote-debugging-port=<port>`. The
  tab list is `http://127.0.0.1:<port>/json`; one WebSocket to the
  browser then asks every page whether a media element is playing and
  whether it is muted (the `playing` and `muted` tags) and which browser
  window it is in. Chrome 136 and later ignore the port flag on the
  default profile: it needs `--user-data-dir` too.
- **AppleScript** (macOS): the browsers in `apps` that are running, over
  one `osascript` run (JavaScript for Automation): Safari, and Chrome
  when nothing on the port already covers it. No playing or muted state
  this way.
- **Firefox**: its session file (`sessionstore-backups/recovery.jsonlz4`,
  the newest profile's, LZ4-decoded in the extension). Read-only, since
  Firefox has no scripting interface: its tabs list, and Focus can only
  raise its window.

The row is the tab's title (the url without its scheme when there is
none), the host is the subtitle, the favicon comes from the url; a tab
without a web url (`chrome://settings`) gets the browser's icon. On the
right: the browser's name when more than one is listed, `window N` when
the browser has more than one window, and `playing` (green) or `muted`
for a tab the protocol could ask. The url, the host and the browser's
name are keywords.

The filter dropdown scopes the list:

| filter | rows |
| --- | --- |
| All | everything (the default) |
| Audible | tabs a page reports as playing sound unmuted (DevTools tabs only) |
| This window | the front window of each browser: the window of the most recently used DevTools tab, window 1 over AppleScript, Firefox's selected window |

Actions:

| action | shortcut | what |
| --- | --- | --- |
| Focus | `Enter` | selects the tab in the browser (`/json/activate` plus `Page.bringToFront`, or `set active tab index` and `set index of window to 1`), then hides and raises the browser window through the `focus` effect (the window carrying the tab's title, else the browser's front one); for Firefox, "Focus window" raises its window only |
| Close | `⌘W` | closes the tab (`/json/close`, or the tab's `close` over AppleScript); not for Firefox |
| Copy URL | `⌘C` | copies the url |
| Mute / Unmute | `⌘M` | DevTools tabs only: sets `muted` on every media element in the page, so it is the page's sound, not Chrome's tab mute |
| Copy as markdown link | `⌘⇧C` | copies `[title](url)` |

Close and mute keep the palette open and list again. A focus, close or
mute that fails keeps the panel open with a toast carrying the reason.

Permissions and platforms:

- **Automation** (macOS): the first AppleScript run asks whether pal may
  control Safari (and Chrome); a refusal makes every later run fail with
  error -1743, which the palette shows as one row, "Automation permission
  needed", whose action opens Privacy & Security, Automation. The
  DevTools and Firefox tabs still list under it.
- Nothing on the port, no scriptable browser running and no Firefox
  session is one row saying so.
- **Linux**: the DevTools and Firefox sources only.

Settings, `[extensions.browser-tabs]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `port` | number | `9222` | The `--remote-debugging-port` to look at. |
| `apps` | list | `["Safari", "Google Chrome"]` | macOS: browsers asked over AppleScript when running, by app name. A Chromium browser already on the port is skipped. |
| `firefox` | bool | `true` | List Firefox tabs from its session file. |
| `firefox_session` | path | `` | A `recovery.jsonlz4` to read; empty finds the most recently written profile's. |

## GitHub (`github-prs`, `github-issues`, `github-repos`, `github-notifications`, `github-search`)

One extension, five palettes, one sign-in; `multi`, so a second account is
`[instances."github@work"]` with its own `token` under
`[extensions."github@work"]` ([Config](config.md#instances)).

| palette | id | kind | what `Enter` does |
| --- | --- | --- | --- |
| Pull Requests | `github-prs` | indexed, 5 min | opens the pull request |
| Issues | `github-issues` | indexed, 5 min | opens the issue |
| Repositories | `github-repos` | indexed, 5 min | opens the repository on GitHub |
| Notifications | `github-notifications` | live, 1 min | marks the thread read and opens it |
| Search GitHub | `github-search` | input | opens what was found |

**Signing in.** The `token` setting when set (a personal access token
with `repo`, `notifications`, `read:org`; the file holds a `keychain:`
reference, never the value), else the gh CLI's login (`gh auth token`,
asked at most every five minutes). Neither one gives a single hint row
per palette saying how to sign in; Enter on it opens the token page. A
token GitHub rejects is the same row with GitHub's message.

**Requests.** Every request has a 10 s timeout. Pull Requests, Issues and
Search are one GraphQL request each, the filters' queries as aliases in
it, so "All" and each filter come from the same answer; Repositories and
Notifications are REST, which carries ETags: a re-list sends
`If-None-Match` and a 304 costs nothing against the rate limit. The
rows already normalised, with the ETag, are kept in the extension's
storage (never a raw body), so a restart still has them and an outage
shows the last rows with a note in the log. While the rate limit is
exhausted a hint row at the top says when it resets.

**Pull Requests.** Yours (`is:open author:@me`), the ones waiting on
your review (`review-requested:@me`), and yours merged within
`merged_days`; filters (`Tab`) All, Mine, Review requested, Merged; the row is
the title with `owner/repo #n` under it, a state dot (green open, grey
draft, violet merged, red closed), tags for the checks (`checks ✓` /
`✗` / `…` from the status rollup), the review decision (approved,
changes requested, review), draft, conflicts, and the updated date. The
pane shows the body, then the latest comments and reviews, over the
repository, author, branch, size, every check by name, who approved and
who asked for changes, reviewers, labels and dates (fetched when the
cursor rests on the row).

| action | shortcut | when |
| --- | --- | --- |
| Open | `Enter` | |
| Copy URL | `⌘C` | |
| Checkout branch | `⌘⇧O` | open, gh on PATH, a clone under `repos_root` (`gh pr checkout` there) |
| Copy branch name | `⌘B` | |
| Open checks | `⌘⇧K` | |
| Open files changed | `⌘⇧F` | |
| Copy reference | | `owner/repo#n` |
| Mark ready for review | `⌘⇧R` | a draft |
| Merge | `⌘⇧M` | open, not a draft, GitHub says mergeable; asks first; `merge_method` |

**Issues.** Assigned to you, mentioning you, opened by you (open ones);
filters (`Tab`) All, Assigned, Mentioned, Created; an issue in two lists is
listed once, in the first. Rows carry the first two labels, the comment
count and the updated date; the pane the body, the latest comments and
the milestone. Actions: Open, Copy URL (`⌘C`), Copy reference, Close
(`⌘⇧X`, asks first). **Create Issue** at the top is a form: the
repository (a select of the repositories with recent activity in the
lists, then yours by push date), title, body; the submit opens the new
issue.

**Repositories.** Yours (owner or collaborator, by push date), your
`default_org`'s recently pushed, and your starred ones, in that order and
sectioned so; filters (`Tab`) All, Mine, Starred, Organisation. Rows: name,
description, tags for private, archived and the language, stars, the
push date; the pane adds forks, open issues, the default branch, the
clone url and the local clone when one sits under `repos_root`
(`<root>/<name>` or `<root>/<owner>/<name>`). Actions: Open on GitHub,
Open in editor (`⌘E`, with a clone: `code` when on PATH, else the folder
with the system opener), Open folder (`⌘O`), Copy clone URL (`⌘⇧C`, ssh
or https per `clone_protocol`), Copy URL, Copy owner/name, Open issues,
Open pull requests. **Create Repository** is a form (owner: you or the
organisation, name, description, private).

**Notifications.** Unread threads, sectioned by reason (Review requested,
Mentioned, Assigned, Your threads, Comments, State changed, CI, Security,
Subscribed) and newest first inside one; the first row is the unread
count (its actions: open the inbox, mark all read). A row's url is the
subject's page (pull, issue, commit; a release or discussion falls back to
the repository's page). Enter marks the thread read and opens it, so the
count is honest when you are back; Mark as read (`⌘⇧R`) does not open;
Mark all as read (`⌘⇧A`) asks first. The bar item `github/notifications`
shows the unread count as a badge (hidden at zero) over the same cache;
its popover has the newest five, Open all (this palette) and Mark all
read.

Popover keys of `github/notifications` (rendered every 300 s and on show, wake,
network; the arrows move the cursor, a click sets it):

| keys | does |
| --- | --- |
| `enter` | Mark the thread read and open it on GitHub |
| `m` | Mark the thread read |
| `a` | Mark all read |
| `p` | Open the Notifications palette |
| `cmd+c` | Copy the thread's URL |
| `up` | Move between threads (or j and k) |

**Search GitHub.** GitHub's own search syntax, typed: free text,
`repo:owner/name`, `is:pr`, `author:login`, `label:bug`. Filters
Everything, Issues and PRs, Repositories, Users; a query carrying `is:`,
`repo:`, `author:` or the like searches issues and pull requests only.
Results come sectioned by kind with the same rows and actions as the
palettes above; users show their avatar and open their profile. A
keystroke waits 300 ms for the next before asking.

Settings, `[extensions.github]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `token` | secret | (none) | A personal access token; empty means the gh CLI's login. |
| `default_org` | text | (none) | The organisation whose recently pushed repositories are listed, and an owner the Create Repository form offers. |
| `repos_root` | path | (none) | Where your clones live; enables Checkout branch and Open in editor. `~` is expanded. |
| `clone_protocol` | `ssh` / `https` | `ssh` | What Copy clone URL copies. |
| `merged_days` | number (days) | `7` | How far back the Merged list reaches. |
| `merge_method` | `merge` / `squash` / `rebase` | `merge` | How the Merge action merges. |

For the tests, `PAL_GITHUB_API` points the extension at another base url
(a local server) and `PAL_GITHUB_TOKEN` is used as the token without
asking gh.

## Docker (`docker`, `docker-images`, `docker-compose`)

Three live palettes over the docker CLI (`docker ps -a`, `docker images`,
`docker compose ls -a`, each with `--format '{{json .}}'`), listed again
on show once their rows are older than `ttl`. Podman works through the
same commands: set `binary` to `podman`, or install its `docker` alias.
Without the binary, or with the daemon not answering, each palette is one
inert hint row that says which.

**Docker Containers** (`docker`): every container, the running ones first
in a Running section, the rest under Stopped. The row is the container's
name, its image the subtitle; on the right the published ports, compact
(`80, 443`; `8080:80` when host and container differ), docker's status
(`Up 27 hours`, `Exited (0) 3 days ago`) and a state tag (running green,
exited grey, paused and restarting amber, created blue, dead red). The id,
the image and the Compose project are keywords; the detail pane lists id,
image, command, status, created, ports, mounts, networks and project.

| action | shortcut | what |
| --- | --- | --- |
| Stop / Start | `Enter` | `docker stop` for a running container (after a confirm), `docker start` for a stopped one; the palette lists again with a toast |
| Logs | `⌘L` | `docker logs --tail 200`, stdout and stderr, as a `show` level in a code fence |
| Shell | `⌘T` | opens a terminal running `docker exec -it <id> sh -c '…'` (bash when the image has it, sh otherwise); running containers only |
| Restart | `⌘⇧R` | `docker restart` |
| Remove | `⌘D` | `docker rm -f`, after a confirm |
| Copy id | `⌘C` | copies the short id |

**Docker Images** (`docker-images`): `repository:tag` (the id for an
untagged image), the id as subtitle, size and age on the right. Run
(`Enter`) asks for a name and ports in a form (`host:container` pairs,
comma separated; a malformed one is refused under the field) and runs
`docker run -d [--name] [-p …] <image>`; Copy id (`⌘C`); Remove (`⌘D`,
`docker rmi`, after a confirm).

**Compose Projects** (`docker-compose`): every project docker knows of,
its folder as subtitle, the status text and a tag (running green, a mix
amber, exited grey). Up (`Enter`, `compose up -d`), Logs (`⌘L`, `compose
logs --tail 200`), Restart (`⌘⇧R`), Down (`⌘D`, after a confirm), Open
project folder (`⌘O`). Every config file of the project is passed with
`-f`.

The panel gives a pick 10 s. A command still running after 8 s (a `stop`
whose process ignores SIGTERM and waits for docker's 10 s kill, a `compose
up` that pulls) is left to finish on its own and the toast says so; `⌘R`
later shows the outcome. A failed command keeps the panel open with
docker's last stderr line.

Which terminal Shell opens is the same rule as SSH Hosts' Connect: the
`terminal` setting on macOS, `$TERMINAL` then kitty, foot, alacritty,
xterm on Linux.

Settings, `[extensions.docker]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `binary` | text | `docker` | The CLI to run; `podman` works. |
| `ttl` | number (s) | `10` | How long a listing stays good for before a show lists again. Palette meta, read when the extension loads. |
| `terminal` | `auto`, `kitty`, `Terminal`, `iTerm2`, `Ghostty`, `Alacritty` | `auto` | macOS only: which terminal Shell opens. |

## Services (`services`)

The OS's service manager, one live palette. What it lists depends on the
platform; `ttl` is the same "list again on show once older than" as
Docker's.

**Linux, systemd.** Filters (`Tab`): User (`systemctl --user`), System, Failed
and Running (the last two span both managers, in a User and a System
section). The row is the unit without `.service`, its description the
subtitle; on the right the unit file's state (`enabled`, `disabled`;
nothing for static, generated and transient units) and a tag with the
active state: the sub state alone when active (`running`, `exited`,
green), `active/sub` otherwise (`inactive/dead` grey, `failed/failed`
red, activating amber). Units are what `list-units --all` has loaded,
then the unit files it has not (a disabled service that never ran),
inactive and without a description; templates, masked and alias files
are skipped. An instance (`app-foo@autostart.service`) shows its
template's enabled state.

| action | shortcut | what |
| --- | --- | --- |
| Stop / Start | `Enter` | `systemctl stop` for an active unit, `start` otherwise |
| Logs | `⌘L` | `journalctl -u <unit> -n 200 --no-pager` (`--user` for a user unit) as a `show` level |
| Restart | `⌘⇧R` | `systemctl restart` |
| Enable / Disable | `⌘E` | flips on the unit file's state; absent for a static, generated or transient unit |
| Copy unit name | `⌘C` | copies `name.service` |

A system unit's Stop, Restart and Disable ask first (a user unit's too
with `confirm_user`). A system verb runs as `systemctl --no-ask-password
<verb>`; when that is refused for want of authentication it is tried
through `sudo -n` (a credential window opened by `sudo -v` in a
terminal), then `pkexec` (a polkit agent's prompt, when one is running).
When none is allowed the panel stays open with a toast quoting all three
refusals. A verb still running after 8 s (a stop waiting on
`TimeoutStopSec`, a polkit prompt) goes on without the panel; `⌘R` shows
the outcome. A `journalctl` for a system unit shows what your user may
read.

**macOS, launchd.** Filters: Agents (the plists in the `agent_dirs`
folders, one section per folder), Loaded (everything `launchctl list`
knows, sorted; the `application.*` jobs of running apps skipped) and
Running (those with a pid). The row is the label, the program from the
plist (its `Program`, or the first `ProgramArguments` entry) the
subtitle, and on the right the pid and a tag: `running` (green), `loaded`
(blue, no process right now), `exit N` (red, the last exit was not 0),
`not loaded` (grey, a plist launchd has not been given). A binary plist is
read through `plutil`.

| action | shortcut | what |
| --- | --- | --- |
| Unload / Load | `Enter` | `launchctl bootout gui/$UID/<label>` (after a confirm) for a loaded job, `launchctl bootstrap gui/$UID <plist>` for one that is not |
| Restart | `⌘⇧R` | `launchctl kickstart -k gui/$UID/<label>` |
| Show plist | `⌘L` | the plist as XML in a `show` level |
| Open plist file | `⌘O` | opens the file |
| Copy label | `⌘C` | copies the label |

`PAL_SERVICES_BACKEND=systemd|launchd` forces a backend; the tests run
both on one machine against fake binaries.

Settings, `[extensions.services]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `ttl` | number (s) | `10` | How long a listing stays good for before a show lists again. Read when the extension loads. |
| `confirm_user` | bool | `false` | Ask before stopping, restarting or disabling a user unit too. |
| `agent_dirs` | list | `~/Library/LaunchAgents`, `/Library/LaunchAgents` | macOS only: where agent plists are read from. |

## Makefile Targets (`make`)

Every target of every Makefile under the `projects` folders, one section
per project. A folder is scanned two levels deep for a `Makefile`,
`makefile` or `GNUmakefile` (GNU make's own order when several are
there); dot folders and `node_modules`, `target`, `vendor`, `dist`,
`build` are not entered. Targets are read from the file's text, not from
`make -pn`: a line beginning with one or more names and a colon
(`:=`-style assignments, pattern rules and `$(VAR)` targets are not
targets), `.PHONY` names included even when their rule is not literal,
in file order. A description is the `## text` on the rule's line, else
the comment line right above it (a `.PHONY:` line in between is skipped).

The row is the target, the project folder the subtitle (with the
description after a colon), the project's name a keyword (so `pal test`
finds it from the root); a phony target has `phony` as one too. The
detail pane shows the recipe and, in its metadata, the project, the
Makefile's name, the description and whether it is phony.

| action | shortcut | what |
| --- | --- | --- |
| Run | `Enter` | see below |
| Copy command | `⌘C` | copies `make -C <dir> <target>` |
| Open project | `⌘O` | opens the project folder |
| Show Makefile | `⌘L` | the whole file in a `show` level |

Run opens a terminal in the project folder running `make <target>`; the
window stays open until Enter is pressed, so a quick target's output is
not gone with it, and the HUD names the target. With `terminal =
"background"` make runs unseen instead: a toast carries the exit status
and the output's last line, and a failure opens the whole output in a
`show` level too; a run still going after 8 s is left to finish on its
own and the toast says so. The terminal is chosen as for SSH Hosts'
Connect.

Settings, `[extensions.make]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `projects` | list | `~/proj` | Folders to scan, two levels deep. `~` is expanded; a folder that is not there lists nothing. |
| `terminal` | `auto`, `background`, `kitty`, `Terminal`, `iTerm2`, `Ghostty`, `Alacritty` | `auto` | Where Run puts make. |

## Audio (`audio`)

Every audio output and input, in two sections, over the core's audio
capability. The default of each direction carries a `default` tag, the
volume is the accessory, a muted device is tagged `muted`; the subtitle
says the direction and, when the OS reports it, the transport
(`bluetooth`, `usb`, `builtin`). A headset shows once under Output and
once under Input. Live: read again on every show. With no audio backend
the one row says which tool is missing.

- **macOS**: the CoreAudio HAL, in-process (no tool to install): the
  device's UID is its id (stable across replugs), the volume is the
  virtual main volume the menu bar slider moves, with the per-channel
  scalar for a device without one; a digital output without a volume
  control has no volume accessory and no Mute action.
- **Linux**: `wpctl` (PipeWire), else `pactl -f json` (PulseAudio 16+).

| action | shortcut | what |
| --- | --- | --- |
| Set as Output / Set as Input | `Enter` | makes the row the default for its direction; the HUD names it |
| Set Volume… | `⌘⇧V` | drills into a level of presets, 0 / 25 / 50 / 75 / 100 %, the current one tagged; a pick sets it and the HUD says so |
| Mute / Unmute | `⌘M` | toggles mute and stays in the list |

No settings.

## Bluetooth (`bluetooth`)

The paired devices over the core's bluetooth capability, connected ones
first then by name, each with a glyph for its kind (headphones, speaker,
keyboard, mouse, game controller, phone, computer), a `connected` tag and
the battery as the accessory when the OS reports one (AirPods show
`L 80% · R 75% · Case 90%`). Live: read again on every show. With no
adapter the one row says so.

- **macOS**: the list is `system_profiler SPBluetoothDataType -json`
  (the one unprivileged source with the device type and the battery
  levels, ~80 ms); connect and disconnect are IOBluetooth's own calls
  (what `blueutil` does), so nothing has to be installed.
- **Linux**: BlueZ over `bluetoothctl` (`devices Paired`, `info`,
  `connect`, `disconnect`), each call time-boxed, and only with an
  adapter under `/sys/class/bluetooth` (without one `bluetoothctl` hangs
  rather than answering empty).

| action | shortcut | what |
| --- | --- | --- |
| Connect / Disconnect | `Enter` | toggles, on the state read back from the OS at that moment; Disconnect asks first; the HUD says which happened |
| Copy Address | `⌘C` | copies `AA:BB:CC:DD:EE:FF` |

No settings.

## Wi-Fi (`wifi`)

The network the machine is on, the saved ones and what is in range, over
the core's wifi capability, in sections Current / Known / Available plus
a Wi-Fi row that turns the radio off or on. The current row's subtitle
has the IP, channel and security, its accessories the signal (`▂▄▆█ 92%`)
and a `connected` tag; a known network that a scan also sees carries its
signal and an `in range` tag; an available one shows its security
(`Open` for none) and channel. Live: read again on every show.

- **macOS**: CoreWLAN in-process for the interface, the radio, the
  current link (name, signal, channel, security) and a scan;
  `networksetup` for the preferred list, join, forget and the radio
  switch; `ipconfig getsummary` for the IP; `security
  find-generic-password -wa <ssid>` for a password (the keychain prompts;
  that dialog is yours to answer). A scan takes several seconds (the
  radio walks every channel; CoreWLAN and `system_profiler` take the
  same 9 s on an M-series laptop), so Available shows the last one (kept
  for a minute) and the **Scan for Networks** row runs a fresh one.
  macOS 15 and later show network names only to an app with **Location
  Services** (CoreWLAN answers nil, the CLIs `<redacted>`; `wdutil info`
  would say, but needs sudo), so the first time the palette lists with
  the names withheld while you are inside it, it asks, once: the system
  prompt, the same as Calendars (a listing at startup or on a show is
  held back, so nothing asks at first run or next to another prompt; the
  **Wi-Fi names need Location access** row asks on `Enter` meanwhile).
  Say yes and the next listing has the names; until then the current row
  reads "Connected network" with its IP and channel, and the Scan row
  counts the nearby networks whose names are hidden. A refusal keeps
  that row (`Enter` opens Privacy & Security > Location Services) and
  puts a Grant button in Settings > General > Permissions and on the
  Overview.
- **Linux**: NetworkManager over `nmcli -t` (`device wifi list`, which
  answers from NetworkManager's own scan cache, so Available lists at
  once; `connection show` for the saved ones; `device wifi connect`;
  `connection delete`; `radio wifi`; `-s -g 802-11-wireless-security.psk`
  for a password).

| action | shortcut | what |
| --- | --- | --- |
| Join | `Enter` | a saved or open network joins at once; a secured new one asks for its password in a form, and a refused join shows the form again with the tool's message |
| Copy Password | `⌘⇧C` | the saved password onto the clipboard |
| Copy IP | `⌘C` on the current row | the interface's IPv4 address |
| Copy Name | `⌘C` on an available row | the network's name |
| Forget | `⌃X` | removes the saved network, after a confirm |
| Scan | `Enter` on the Scan row | a fresh scan, then the list again |
| Turn Wi-Fi Off / On | `Enter` on the Wi-Fi row | the radio; off, only that row is listed |
| Allow Location Access / Open System Settings | `Enter` on the Location row (macOS) | the system prompt while unasked, the Location Services pane once refused |

No settings.

## Now Playing (`media`)

The playing track is also the empty root's Now section's row (nothing while
nothing plays). One row per running player over the core's media capability: the
track as the title, artist and album as the subtitle, the cover (the system's
Now Playing artwork on macOS, else the player's artwork url, else the app's
icon), the position as `12:34 / 1:06:03`, the player's name and a `playing` /
`paused` / `stopped` tag, playing ones first. A player with nothing loaded reads
"Nothing playing" with the player's name; one playing without a track (Chrome
with YouTube on macOS reports the position and nothing else) is its app's name
with the position as the subtitle. Live: read again on every show, and the
position is the core's estimate at that moment (it advances from the last report
and the clock while playing). With no player running the one row says so; on
Linux without `playerctl` it says to install it.

- **macOS**: Spotify and Music through AppleScript, only while the app is
  running (the check is `NSRunningApplication`, so pal never launches one
  to ask); Spotify gives the artwork url and the track url. The system-wide
  Now Playing (any other player: a browser, VLC) is one more row, named
  and iconed from the app's bundle id, through the bundled MediaRemote
  adapter (`mediaremote-adapter.pl` plus a framework, run by
  `/usr/bin/perl`; the one source that works on macOS 15.4 and later,
  where `nowplaying-cli` gets null). The adapter runs as one `stream`
  child of pal for as long as pal does (started on the first look,
  restarted if it dies, ended with pal): every change the system reports
  lands in memory as it happens, with the cover, so a look costs
  microseconds and never a process. Nothing to install.
- **Linux**: `playerctl` over MPRIS, one row per player; the icon is the
  player's `.desktop` when one is named like it.

| action | shortcut | what |
| --- | --- | --- |
| Play / Pause | `Enter` | toggles and stays in the list, so the tag follows |
| Next Track | `⌘→` | |
| Previous Track | `⌘←` | |
| Copy Track | `⌘C` | copies `artist - title` |
| Open in … | `⌘O` | the track's url (Spotify's `spotify:track:` link), else the app on macOS |

The bar item `media/now-playing` puts the playing track on the strip
(hidden while nothing plays) with the track row (the cover, or the app's
icon, at row size; a click opens the track) over Pause, Next, Previous,
Copy Track and Open in its popover. On macOS the core's stream fires the
item's `media` trigger the moment the track, the state or the cover
changes, so the strip follows a skip at once; on Linux the extension
polls the players every 5 s while one plays and pushes a track change
itself.

Popover keys of `media/now-playing` (rendered every 30 s and on show, wake,
media; the arrows move the cursor, a click sets it):

| keys | does |
| --- | --- |
| `space` | Pause or play |
| `right` | Next track (cmd+right too) |
| `left` | Previous track (cmd+left too) |
| `c` | Copy artist - title (cmd+c too) |
| `o` | Open the track in its player (cmd+o too) |

| setting | default | what |
| --- | --- | --- |
| Cover on the bar (`bar_artwork`) | off | the cover instead of the note on the menu bar strip, only when the cover is square (a 24 pt picture of anything else is a smudge); the popover shows the cover either way |
| Leave to another extension (`exclude`) | empty | players this extension leaves to another, by app name or player id (`Spotify`, `music`): the bar item and the root's Now row skip them; the palette still lists them |

## Unicode Characters (`unicode`)

A grid of 1795 characters one pastes rather than types (a `catalog` at
the root: three rows there, the rest behind the "more" row), from
`extensions/unicode/data.json`: arrows, math, Greek, currency, quotes and
dashes, punctuation, typographic and zero-width spaces, superscripts and
fractions, accented Latin letters (the Turkish, German, French, Nordic and
Spanish sets), letterlike symbols, the Mac keyboard glyphs (⌘ ⌥ ⇧ ⌃ ⎋ ⏎ ⌫
⇥ ⏏ and the control pictures), check marks, box drawing and block
elements, geometric shapes, miscellaneous symbols, dingbats, enclosed
numbers and letters. The tile is the glyph (a space shows as the open box
`␣`); the name is the Unicode name in lower case; the section is the
block. The search matches the name, the code point (`2192` or `u+2192`),
the HTML entity names (`rarr`, `nbsp`), the LaTeX command where there is an
obvious one (`\rightarrow`, `\alpha`), the character's Unicode 1.0 name
(`command key`) and plain words (`cmd`, `turkish`, `tick`, `eur`).

The last twelve characters copied lead the grid in a **Recent** section
(kept in the extension's storage) and leave their block while they are
there. The section is rebuilt when the palette lists again (at start, on
⌘R); between listings the core's frecency already moves a picked tile up.

Actions:

| action | shortcut | what |
| --- | --- | --- |
| Copy character | `Enter` | copies the glyph |
| Paste | `⌘Enter` | hides and pastes it into the app in front (needs Accessibility on macOS, like Snippets) |
| Copy code point | `⌘⇧U` | `U+2192` |
| Copy HTML entity | `⌘⇧E` | `&rarr;`, or `&#x2192;` for a character without a named entity |
| Copy numeric reference | `⌘⇧N` | `&#x2192;` |

The detail pane (⌘I) shows the glyph large, the block, the code point,
both HTML forms, the UTF-8 bytes (`E2 86 92`), the LaTeX command and the
aliases.

The table is generated: `bun run extensions/unicode/build.ts` fetches
`UnicodeData.txt` (names) and the WHATWG `entities.json` (entity names),
applies the sections, LaTeX and keyword tables in the script, and writes
`data.json` (160 KB), which is committed. The whole UCD is not shipped;
add a range or a code point to the script's `SECTIONS` to widen the table.

Settings, per palette, `[palettes.unicode.settings]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `columns` | number, 4 to 16 | `10` | Tiles per row in the grid. Read once when the extension loads, like Emoji's. |

## Colors (`colors-picker`, `colors`, `colors-history`, `colors-convert`)

Four palettes over one colour maths (`extensions/colors/color.ts`) and one
history. At the root a hex, an `rgb()`/`hsl()`/`oklch()`… notation or a CSS name
answers inline under a Convert Colour section (the first four notations; Enter
opens the picker on it). **Colour Picker** is a view level: a large swatch on a
sunken well over a hue strip and a saturation/value plane (both drawn by the app
from the colour, the ring marking where it sits), the colour in hex, rgb, hsl,
hwb, oklch, oklab, lab and display-p3 with its CSS name (or the nearest, in
OKLab), the nearest Tailwind and Material tokens, the contrast on white, on
black and against the previous colour with the WCAG level as a badge, and to the
right nine tints, nine shades and the complementary, analogous, triadic, split
and tetradic harmonies as tiles. The keys edit the colour in place: `←`/`→` turn
the hue 5°, `↑`/`↓` move the lightness 2 points, `-`/`+` the saturation 5
points, `⇧` makes an arrow step three to five times bigger, `m` switches to
OKLCH (lightness, chroma and hue; a chroma step stops at the sRGB gamut edge
instead of clipping) and back. `⇥` moves the focus from the swatch to the tints,
the shades and each harmony row in turn (`⇧⇥` back): the arrows then walk the
row, the label names the tile and `Enter` takes it. A digit or `#` opens a text
field in the search row with that character; type any notation and `Enter`
applies it, `Escape` closes the field (a notation that does not parse stays in
the field with a toast). `c` (and `Enter` on the swatch) copies in the notation
the `format` setting names, `⌘C` always the hex, `⌘⇧R` rgb, `⌘⇧H` hsl, `⌘⇧O`
oklch, `⌘⇧L` lab, `⌘⇧P` display-p3, `⌘⇧N` the CSS name, hwb and oklab from ⌘K.
`p` picks from the screen: the panel hides, the system's loupe appears
(`NSColorSampler` on macOS, the screenshot portal on Linux), and the panel comes
back in the picker on the picked colour (unchanged after Escape). `h` opens the
history, `n` the named sets, `u` goes back to the previous colour, `r` makes a
random one. The colour, the model and the history live in the extension's
storage, so Escape and a restart lose nothing.

**Named Colours** is a grid of 995 swatch tiles (a `catalog` at the root:
three rows there, the rest behind the "more" row), one section per set,
with a filter per set in the dropdown (`⇥` cycles them): the 148 CSS
names, Tailwind 3.4 (`slate 500`), the Material 3 baseline tonal palettes
(`primary 40`, generated from the seed `#6750A4` with Google's
material-color-utilities), the 2014 Material palette (`red a200`), Apple's
system colours in the light and the dark appearance (`blue`, `gray6`),
Catppuccin's four flavours, Rosé Pine's three variants, Nord, Solarized,
and pal's own tokens. The search matches the name, the hex, the token
spelling (`slate-500`, `systemBlue`, `mocha/mauve`) and the set. `Enter`
opens the tile in the picker; `⌘Enter` copies it in the chosen notation,
`⌘⇧C` the hex, `⌘⇧N` the token. The detail pane (`⌘I`) adds where the
token is used: the Tailwind utilities, the Material 3 role, the
`UIColor`/`NSColor` name and what Apple uses it for, the role a theme gives
it (Catppuccin's `mauve` is keywords, Nord's `nord8` the primary accent).
The last twelve opened lead in a **Recent** section. The `sets` setting
narrows what All lists; the dropdown reaches every set regardless.

**Colour History** (live, so its rows at the root follow every pick and
copy) lists every picked and copied colour, newest first, one row per
colour, with the hex, where it came from (the screen, typed, a
set with its token, the picker, the converter) and when; the CSS name (or
`≈` the nearest) is the accessory, the chosen notation when it is not hex.
The first row is **Pick Colour from Screen**, which is also at the root:
the loupe, then the colour copied in the chosen notation with the HUD
naming it, and remembered. `Enter` on a colour opens it in the picker,
`⌘Enter` copies it, `⌘D` removes it, `⌘⇧D` clears the history (with a
question). The `history_size` setting caps it (50).

**Convert Colour** is an input palette: type a colour in any notation and
the rows are its conversions, each with a swatch. It reads hex in every
length with or without the hash (`#f80`, `ff880080`), `rgb()`/`rgba()` in
the comma and the space syntax with percentages and alpha (`rgb(255 136 0
/ 50%)`), a bare triple (`255 136 0`), `hsl()`/`hsla()` with hue units
(`deg`, `turn`, `grad`, `rad`), `hwb()`, `oklch()`, `oklab()`, `lab()` (CIE
Lab against D50, as CSS means it), `color(display-p3 …)`, `color(srgb …)`
and the CSS names. The rows: every notation, the CSS name (or the nearest
one, tagged `close`, `near` or `far` by its OKLab distance), and the
contrast ratio on white and on black, each tagged with what it passes for
normal text (`AAA` at 7, `AA` at 4.5, `AA large` at 3, else `fail`, WCAG
2). `Enter` opens the picker on the colour, `⌘Enter` copies the row; a
contrast row only copies. Something that is not a colour gives one inert
row saying so.

The rows of the sets are generated by `bun run extensions/colors/build.ts`
(the CSS table from `color.ts`, the tokens read from `tokens.css`,
Tailwind and Material fetched from unpkg, Material 3 computed with the
library from esm.sh, Catppuccin from its GitHub palette; Apple, Rosé Pine,
Nord and Solarized are hand-kept in `sets.ts`) into `data.json` (72 KB),
committed. The maths is unit-tested against the CSS Color 4 reference
points (`host/test/extensions/colors.test.ts`).

Settings, `[extensions.colors]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `format` | `hex`, `rgb`, `hsl`, `hwb`, `oklch`, `oklab`, `lab`, `p3`, `name` | `hex` | What `c`, Copy and the grid's `⌘Enter` write. |
| `uppercase` | boolean | `false` | `#FF8800` rather than `#ff8800`. |
| `alpha` | `keep`, `drop` | `keep` | Whether a translucent colour copies with its alpha (`#ff880080`, `rgba(…)`, `/ 0.5`) or as the opaque colour. |
| `sets` | list of set ids | every set | Which sets the grid lists under All: `css`, `tailwind`, `material3`, `material`, `apple`, `catppuccin`, `rosepine`, `nord`, `solarized`, `pal`. |
| `history_size` | number, 5 to 500 | `50` | How many colours the history keeps. |

Per palette, `[palettes.colors.settings]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `columns` | number, 4 to 16 | `8` | Tiles per row in the grid. Read once when the extension loads. |

## Icons (`icons`, `icons-freedesktop`)

Both palettes are `catalog`s at the root: three rows each there, the rest
behind the "more" row, and a glyph named exactly what was typed (`git`)
sits under the primary rows that have the word, not above Google Chrome.
**Nerd Font icons** is a grid of every glyph in the Symbols Nerd Font the
app bundles (`app/src/assets/fonts`, Nerd Fonts 3.5.1): 10995 glyphs, one
section per set in a fixed order (Material Design, Font Awesome, Codicons,
Octicons, Devicons, Seti, Weather, Font Logos, Font Awesome Extension,
Powerline, Powerline Extra, Pomicons, IEC Power, Custom, Extra, Indent).
The tile is the glyph, the name is the set's name with spaces (`account
circle`), the code point is the subtitle and the `nf-md-account_circle`
name a keyword, so `md-account` or `f0009` finds it. The last twelve
picked lead in a **Recent** section.

| action | shortcut | what |
| --- | --- | --- |
| Copy glyph | `Enter` | the character itself, as an `icon` for a script or a bar |
| Copy code point | `⌘Enter` | `U+F0009` |
| Copy name | `⌘⇧N` | `nf-md-account_circle` |
| Copy CSS class | `⌘⇧C` | `nf nf-md-account_circle` |

The detail pane names the set and the Nerd Fonts version, the code point,
the CSS class and the `\u{f0009}` escape; it does not draw the glyph large,
since the pane's text is the UI font and only the icon box uses the
bundled symbols font.

**Freedesktop icon names** is a second grid: the 114 freedesktop names the SDK's
`xdg()` maps to a glyph (`sdk/src/icons.ts`, what a script's `icon_xdg` may
say), each drawn with its glyph and its Nerd Font name as the subtitle. `Enter`
copies the name; the glyph (`⌘Enter`) and the code point (`⌘⇧U`) are the other
actions. Only the names in that table are listed: pal draws no other, so a
longer list would show names that render as nothing.

The glyph table is generated: `bun run extensions/icons/build.ts` fetches
`glyphnames.json` at the pinned release and writes `data.json` (282 KB,
`[name, code]` pairs by set), committed; bump the version in the script
together with the font. A listing is eleven thousand rows (about 3.4 MB
over the host's pipe) on every start, as the palette has no `ttl`; the
rows carry the least they can for that.

Settings, per palette, `[palettes.icons.settings]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `columns` | number, 4 to 16 | `10` | Tiles per row in the grid. Read once when the extension loads. |

## Network (`network`)

This machine's addresses, one row per value: the value is the row's name
so it reads at a glance, the label is the subtitle, `Enter` copies. Live,
listed again when the panel shows and the last listing is over a minute
old; ⌘R lists now. The palette opens with the detail pane showing.

| section | rows | from |
| --- | --- | --- |
| This machine | every interface's IPv4 and global IPv6 addresses (loopback and link-local left out), the Wi-Fi one labelled with its SSID; the Tailscale IPv4 and IPv6; the hostname; the Bonjour `.local` name on macOS | macOS: `ifconfig`, `networksetup -listallhardwareports` (the kind), `ipconfig getsummary <dev>` (SSID, security); Linux: `ip -j addr`, `iw dev`; `tailscale ip` where the CLI is on PATH (or the Tailscale.app binary on macOS); `os.hostname()`, `scutil --get LocalHostName` |
| Internet | the public IP, with the city, country and organisation when the endpoint gives them | one GET of `public_ip_url` with a 3 s timeout, kept 10 minutes (⌘R fetches again; a failure is not kept); JSON with `ip` (ipinfo), `query` (ip-api) or `connection.isp` (ipwho.is) shapes, or a bare address |
| Network | the default gateway with its interface; the DNS servers in resolver order | macOS: `route -n get default`, `scutil --dns`; Linux: `ip -j route show default`, `/etc/resolv.conf` (behind systemd-resolved's stub, `resolvectl dns`) |

Every tool runs with a 3 s timeout and a missing one just leaves its rows
out. The tunnel interface carrying the Tailscale addresses (`utun4`,
`tailscale0`) is folded into the Tailscale rows. When nothing has an
address, or there is no route, an inert row says so; the public IP row
says why when the fetch fails.

**The SSID on macOS**: since Sonoma the system redacts the network name
for a process without Location Services access (`ipconfig getsummary`
prints `<redacted>`, `networksetup -getairportnetwork` says not
associated), and pal's own grant does not reach the tools it runs:
`ipconfig` under a granted pal still prints `<redacted>` (checked on
hornet). So when the summary is redacted the palette asks the core's wifi
capability, which reads the name in-process (CoreWLAN) and has it once
pal holds Location access (the Wi-Fi palette asks for it); until then the
Wi-Fi row is labelled by kind (`en0 · Wi-Fi`) and the detail pane says
what is missing.

Actions:

| action | shortcut | what |
| --- | --- | --- |
| Copy | `Enter` | copies the value |
| Open Network settings | `⌘Enter` | the Network pane of System Settings on macOS; on Linux the first of `gnome-control-center network`, `systemsettings kcm_networkmanagement`, `nm-connection-editor` installed |

No Flush DNS: on macOS it is `dscacheutil -flushcache; killall -HUP
mDNSResponder`, which needs sudo, and the host has no way to ask for a
password; run it from a terminal.

The detail pane lists every field of the row: interface, kind, SSID,
security, IPv4, IPv6, MAC and status for an address; city, region,
country, organisation and when it was fetched for the public IP; the
resolver order for a DNS server.

Settings, `[extensions.network]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `public_ip_url` | text | `https://ipinfo.io/json` | The endpoint the public IP row asks. Empty: no Internet section. `https://api.ipify.org` (a bare address) and `http://ip-api.com/json` work too. |

## Timer (`timer-timers`)

Named countdown timers over the `timer` CLI (`~/.local/bin/timer` in the
owner's dotfiles): the CLI keeps the timers, one detached process per
timer that fires on its own (confetti, a chime, a phone ping) and one KV
file per timer under its state directory. pal is a view of that directory
and asks the CLI for every change, so a timer started from a terminal and
one started here are the same thing. Live: listed again on every show;
the empty root's Now section shows the most urgent one (running, paused
or just landed) with its own actions, nothing when there is none.

One row per timer, most urgent first (landed, then running soonest first,
then paused): the name, what is left and when it lands (or "Paused at
12:34", "Landed 0:42 ago"), a state tag. The last row is **New timer**, a
form: a duration (`25m`, `90s`, `1h30m`, `2:30`, a bare number is minutes;
the CLI parses it and its complaint comes back under the field), an
optional name (the duration otherwise; a name already taken restarts that
timer), and a checkbox to ring the phone out loud when it lands (`--ring`).
The same from a link: `pal://timer/start?duration=25m&name=tea`
(`&ring=1` rings; [Links](links.md#extension-routes)).

Actions, by state:

| row | `Enter` | `⌘+` | `⌘D` |
| --- | --- | --- | --- |
| running | Pause | Add 5 minutes | Stop |
| paused | Resume | Add 5 minutes | Stop |
| landed | Dismiss (the CLI's `done`) | Add 5 minutes (restarts it) | Stop |

Every pick runs the CLI (`timer pause <id>`, `resume`, `add 5m <id>`,
`stop <id>`, `done`) with the state directory as `TIMER_DIR` and lists
again; a refusal is a toast with the CLI's words.

**The bar item** (`timer/timer`,
[Extensions](extensions.md#bar-items-glanceable-state-on-the-bar)): the soonest
timer's remaining time as the title with a fill for how far along it is, blue,
then amber past two thirds, red past nine tenths, muted while paused; a landed
timer is the alarm (its name, or "Done" for an unnamed one, in red) until the
CLI's badge ttl (5 minutes) or a Dismiss removes it. Hidden with no timer at
all. A click opens this palette. The second-level countdown is pushed by the
extension itself (a watch on the state directory plus a 1 Hz tick while a timer
runs); the core asks every 10 s and on wake besides.

Popover keys of `timer/timer` (rendered every 10 s and on wake; the arrows move
the cursor, a click sets it):

| keys | does |
| --- | --- |
| `space` | Pause, resume or dismiss the timer with the ring |
| `+` | Add five minutes |
| `backspace` | Stop |
| `up` | Move the ring to another timer (or click a card) |
| `n` | Start one: type 25m tea in the field, Enter |
| `o` | Open the Timers palette |

Settings, `[extensions.timer]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `command` | path | `timer` | The CLI, a name on PATH or a path. |
| `dir` | path | `~/.local/share/timer` | Its state directory (`TIMER_DIR`); made if missing. `~` is expanded. |

## Calendar (`calendar-today`, `calendar-schedule`, `calendar/upcoming`)

Two live palettes and a bar item over one source and one cache; Today
also suggests the empty root's Now section its first row: the current
event, else the next inside `horizon_hours` (the strip's rules), with
Join first when it has a call, from the cache when that is under a minute
old
(`extensions/calendar/source.ts`). The source is a setting: `system` is
the core's calendar capability (`pal_core::calendar`: EventKit on macOS,
so every account Calendar.app has is one store and one permission; `khal`
on Linux, read through its `list --json`); `google` is the Calendar API
v3 read directly per account; `auto` (the default) is `google` once an
account is listed, else `system`. Every reader goes through `load`,
which keeps the last window fetched (local midnight to `days` ahead, two
at least) and answers it while it is younger than the caller's allowance:
a palette show takes up to a minute, the bar's minute tick five, a
`refresh` nothing. A fetch that fails leaves the last events in place as
`stale`, so a source that is away costs the strip its freshness, not the
meeting.

**Today** is the day's events in time order, whatever their state: the
row is the title, the time range with how long (`10:00 – 10:30 · 30 min
· Room 4`, `All day`), the calendar glyph tinted with the calendar's
colour, and the state as the first tag: `in 12 min` (`in 2 h 5 min`) in
blue, `now, 25 min left` in green, `over` in grey, `today` for an all-day
one; then `declined` / `maybe`, the head count, `Join` when there is a
call. Once no timed event is left today a **Nothing else today** row
names the next timed event's day (`Next: Concert, tomorrow 19:00`,
`Next: Review, Sat 19 Sep 09:00`; **Nothing today** on a day that never
had one) and tomorrow's rows follow under their own section. The bar's
popover opens the same palette with `args: { rest: true }`: the over
ones dropped and tomorrow always there.

**My Schedule** is the week: sections **Today**, **Tomorrow**, **This
week** (within seven days), **Later** (up to the `days` setting); events
that have ended are gone, an all-day one lasts until its midnight; the
current event carries a `now` tag, else the next one `in 12 min` (`in 2
h` further out, nothing past a day); the calendar's colour as the row's
dot, the head count, `Join`, `declined` or `maybe`. The last row is
**New event** on the system source.

A call is Google's `conferenceData` video entry point (else
`hangoutLink`), or the first Zoom, Google Meet, Teams, Webex, Jitsi,
Whereby or GoTo meeting link in the event's url (system), location, then
notes or description; Outlook safelinks are unwrapped and `&amp;`
unescaped. A Zoom marketing page or a docs link does not count.

| action | shortcut | what |
| --- | --- | --- |
| Join call | `Enter` | opens the call link; first only when there is one |
| Open in Calendar / Open in Google Calendar | `Enter` (`⌘Enter` with a call) | `ical://ekevent/…` into Calendar.app, the occurrence for a repeating event (macOS, system source); the event's `htmlLink` in the browser for a Google account |
| Copy conference link | `⌘⇧C` | |
| Copy event details | `⌘C` | title, when, where and the link as text; the primary action on Linux without a call |
| Delete event / Delete this occurrence | `⌃X` | asks first; on a repeating event only that occurrence goes; macOS, system source only (khal has no delete; a Google token may be read-only) |
| New event | `Enter` on the last row | the form below; system source only |
| Grant access | `Enter` on the permission row | the system prompt, or System Settings when it was denied |

The filter dropdown is one entry per calendar (read when the host loads,
so a calendar added later shows at the next start; a Google account's
are named by account, `Personal (personal)`). The detail pane is the
notes as markdown (a Google description as text, its HTML stripped; the
title when there are none) over when with the duration, the calendar and
its account, the location, the call or link, the organizer, every
attendee with their reply as a coloured tag, your own reply, and whether
it repeats.

**The bar item** (`calendar/upcoming`,
[Extensions](extensions.md#bar-items-glanceable-state-on-the-bar)): the next
event as `Standup in 12m` (`Standup now` while it runs, the title cut to 36
characters), hidden when nothing timed starts within `horizon_hours` (10), so a
clear evening is a clear strip. The event is the first that has not ended, timed
unless `hide_all_day` is off, not declined unless `hide_declined` is off,
starting inside the horizon; a running one counts until it ends. Colour by
escalation, the boundaries inclusive: `muted` far off, `amber` from
`warn_minutes` (15) before the start, `red` from `urgent_minutes` (5), `green`
while it runs; sketchybar draws the same names through the bar module's colour
map. A `dot` badge says there is a call. The tooltip is the title, the time
range and the calendar. A click opens Today in the popover (the rest of today
and tomorrow, Enter joins). The core asks every five minutes and on wake, the
network coming back and the minute tick; a minute tick renders from the cache
(0.1 ms through the host in the tests; the count-down needs no fetch), every
other reason fetches (about 80 ms for a week from EventKit on hornet, 250 to 350
ms for two Google accounts whose token commands hop over ssh). A failed fetch
keeps the last item as `stale`; no cache and no source is hidden.

Popover keys of `calendar/upcoming` (rendered every 300 s and on minute, wake,
network; the arrows move the cursor, a click sets it):

| keys | does |
| --- | --- |
| `enter` | Join the focused event's call, else open it in Calendar (Google Calendar for a Google account) |
| `j` | Join the next call |
| `t` | Show or fold tomorrow |
| `o` | Open Calendar (the day's page on calendar.google.com for a Google account) |
| `r` | Refresh |
| `cmd+c` | Copy the focused event's details |
| `cmd+shift+c` | Copy the focused event's conference link |
| `up, down` | Move between the rows; a click on a row focuses it, a click on Join joins it |

**Google.** Each account is one entry of `accounts`, `name = command`:
the command prints an access token for the Calendar API on stdout (a
bare token, or the JSON an OAuth endpoint answers with `access_token`
and `expires_in`); pal runs it through `sh -c`, keeps the token in memory
until its expiry (30 minutes for a bare one, a minute's margin), mints
again once on a 401, and never writes a token anywhere: the command is
the secret's owner, so nothing secret sits in the config. `gcloud auth
application-default print-access-token` after an `application-default
login` with the `calendar.readonly` scope (documented, not verified
here), a keychain helper, a broker behind ssh (quote the remote command
for its shell: `ssh archer "curl -s 'http://…/token?aud=calendar'"`).
An entry reads the account's primary calendar; a table in the file, `{
name, token_command, calendars = ["primary", "<id>"] }`, reads more.
Events are read with `events.list` (`singleEvents`, `timeMin`/`timeMax`,
the `conferenceData` entry points), the calendars from `calendarList`
(their colour, title and access role), all accounts at once. One account
away is logged and the rest list; every account away keeps the last
events read behind a hint row. Google rows open in the browser and are
not deleted or created from here.

On Linux, `khal new` prints no id and reads dates in the formats of its
own `[locale]` section; with none set (the C locale's `%c`), khal cannot
parse a timed event back, so pal refuses one with the format to set
(`datetimeformat = %Y-%m-%d %H:%M`) rather than saving it wrong. All-day
events go through either way.

**New event** is a form: a title; a day in words (`today`, `tomorrow`,
`fri`, `next mon`, `next week`, `2026-09-20`, `20.9`, `20 sep`, `sep 20`);
a start and an end time (`14:30`, `2pm`, `2:30 pm`, `1430`, `noon`; an end
before the start is the next day); an all-day checkbox (then the end may be
the last day, `22.9`); the calendar (the writable ones, or the backend's
default); a location; notes. A field that does not parse shows its
complaint and keeps what was typed; the backend's refusal (a read-only
calendar) comes back under the title.

**Permission.** macOS lists an app under Privacy & Security > Calendars
only after it has asked once, so while the state is `not_determined` the
palette is one row, **Grant calendar access**, whose Enter shows the
system prompt (the panel hides while it is up; open the palette again
after answering). `denied` and `restricted` are one row that opens that
pane. The app carries `NSCalendarsFullAccessUsageDescription` (and the
pre-14 `NSCalendarsUsageDescription`) in its Info.plist; without the
string macOS ends the process instead of asking. On Linux without `khal`
the one row says so. The Google source needs no permission: a token that
fails shows on the listing.

Settings, `[extensions.calendar]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `source` | select | `auto` | `auto`, `system`, `google`. |
| `accounts` | list | `[]` | Google accounts as `name = command`, or tables `{ name, token_command, calendars }` in the file. |
| `calendars` | list | `[]` | Calendar names (or ids, `work:primary` for Google) to list; empty is every calendar. Also narrows the filter dropdown. |
| `days` | number | `7` | How many days from today My Schedule lists. |
| `hide_declined` | boolean | `true` | Leave out invitations you declined. |
| `horizon_hours` | number | `10` | The bar item shows the next event only when it starts within this many hours. |
| `warn_minutes` | number | `15` | The bar item turns amber this many minutes before the event. |
| `urgent_minutes` | number | `5` | The bar item turns red this many minutes before the event. |
| `hide_all_day` | boolean | `true` | The bar item speaks for timed events only. |

Not built: accept and decline (EventKit has no public API to change a
participant's status; Raycast does it through the private
`EKParticipant` setter; the Google tokens this is built for are
read-only), a second `calendars` palette toggling visibility
(an extension cannot write its own settings), reminders, an OAuth flow
of pal's own (a Google client id would have to ship with it).

## 2048 (`2048`)

The sliding-tile game in the panel, keyboard only. Enter on the palette's
row (or its hotkey) opens the board as a view level: the search input
gives way to the score, the footer shows the primary key, ⌘K lists every
move with its key.

- Moving: the arrows or `hjkl` slide every tile that way; equal neighbours
  merge once per move, a 2 (or a 4, one in ten) lands on a free cell. A
  move that changes nothing spawns nothing and is not counted.
- `U` takes the last move back (one move, `undo` setting), game over too.
- The first 2048 shows a banner: Enter keeps going, `N` starts over. Game
  over shows the score, Enter for a new game. `N` mid-game asks first.
- Escape leaves at any point; the board, the score, the move count and
  the best score persist (in the extension's storage).

Tiles are the view vocabulary's `tile` nodes on a sunken well, drawn by
the app with its tokens (paper for 2, the neutral tint for 4, then solid
tiles walking the tag palette's hues warm to cool, grey at 1024, the
accent at 2048), so the board follows the theme; a slid tile
glides to its new cell, a merge pops in place, the spawned tile pops a
beat later. The arrows and `hjkl` are one action each with two keys.

```toml
[extensions.2048]
undo = true
```

## Wordle (`wordle`)

The five-letter word game in the panel, keyboard only. Enter on the
palette's row (or its hotkey) opens the board as a view level: the search
input gives way to the puzzle's name ("Daily #259", "Practice"), the
footer shows the primary key, ⌘K lists the moves with their keys (the
letters route without being listed).

- Typing: the letter keys fill the row, Backspace takes one back, Enter
  submits; a word not in the list is a red badge over the board. A typed
  letter pops in; a submitted row flips tile by tile: green in place,
  amber elsewhere in the answer (a repeated letter only as often as the
  answer has it), grey otherwise. The on-screen keyboard keeps each
  letter's best mark. Tiles and keys are `tile` nodes drawn by the app
  with its tokens, on a sunken well, so the board follows the theme.
- Daily (`daily`, on by default): one puzzle a day seeded from the local
  date, started when the palette opens on a new day. Once it is over, `N`
  starts a practice game on a random word; with `daily` off every game is
  one and `⌘N` starts another mid-game.
- Hard mode (`hard_mode`): greens stay in place, ambers must be used; a
  slip is named in the badge. A game keeps the mode it started with.
- The result view: the praise or the answer, played, win %, streak and
  best, the guess distribution as bars; `C` (or Enter) copies the emoji
  grid with the puzzle number and the score.
- Escape leaves at any point; the game and the stats persist (in the
  extension's storage).

The word lists ship with the extension, built from public domain sources
(12dicts and ENABLE; the README says how): 2551 answers, 8878 allowed
guesses, 69 KB in all. Nothing is fetched.

```toml
[extensions.wordle]
daily = true
hard_mode = false
```

## Slack (`slack-unreads`, `slack-channels`, `slack-search`, `slack-status`)

One extension, four palettes and a bar item (`multi`: a second workspace
is `[instances."slack@work"]`, its `workspace` set for that instance,
[Config](config.md#instances)), signed in through the Slack
desktop app's own session (or a user token).

| palette | id | kind | what `Enter` does |
| --- | --- | --- | --- |
| Unreads | `slack-unreads` | live | opens the conversation in the Slack app, at the message |
| Channels | `slack-channels` | indexed, 1 h, catalog | opens the conversation in the Slack app |
| Search Slack | `slack-search` | input | opens the message in the Slack app |
| Status | `slack-status` | live | sets the status, snoozes, or flips presence |

**Signing in.** `auth = "app"` (the default) reads the desktop app's
session: the `xoxc-` token per workspace out of its Local Storage (a
LevelDB: the SSTables and the write-ahead log are parsed, both copied
first) and the `d` cookie out of its cookie jar (AES-128-CBC under the
"Slack Safe Storage" password from the login keychain, or the Secret
Service / "peanuts" on Linux). Read-only, kept in memory, extracted again
once when Slack answers `invalid_auth`. It is the only way to
`client.counts`, the client call that answers every unread at once; the
public API has no unread endpoint. `auth = "token"` sends a user token
(`xoxp-`) as a bearer and falls back to `conversations.info` per
conversation: direct messages and unread channels, no mention counts, no
threads. Without either, one hint row per palette; Enter opens the
extension's settings.

**Unreads.** Addressed versus merely unread: direct messages, mentions
(`@you`, `@here`, `@channel`) and replies in followed threads are the
rows and the count; channels that are only unread are named last, no
count. Sections Direct messages, Mentions, Threads, Channels, newest
first in each. The row: the conversation's name, the sender's avatar, the
message (in a channel the one naming you, not the last), a count badge
(red; blue for thread replies; `1+` past a page), the time. The pane is
the unread run, oldest first, up to eight messages. One `client.counts`
per refresh; `conversations.history` only for an addressed conversation,
the newest twelve, once per change of its `latest`; the inbox is shared
with the bar item for 30 s.

| action | shortcut | when |
| --- | --- | --- |
| Open in Slack | `Enter` | `slack://channel?team=&id=&message=` |
| Reply | `⌘Enter` | not a thread row; a one-field form, `chat.postMessage` (into the thread for a threaded mention) |
| Mark as read | `⌘⇧R` | not a thread row; `conversations.mark` at the latest message |
| Open in browser | `⌘⇧O` | the archive page |
| Copy link | `⌘C` | |

**Channels.** Every channel, private channel, group message and direct
message you are in (`users.conversations`, an hour), channels first then
by name, with the topic or purpose, the member count and a tag for
private, group, DM. Actions: Open in Slack, Open in browser (`⌘⇧O`),
Copy link (`⌘C`).

**Search Slack.** `search.messages` with the query as typed, Slack's
syntax through (`from:@name`, `in:#channel`, `has:link`,
`before:yesterday`), newest first; rows are the message, who said it
where, the time. A keystroke waits 300 ms for the next. Actions: Open in
Slack (at the message), Open in browser (the permalink), Copy text.

**Status.** What is set now first (the status with its expiry, Do Not
Disturb, presence; Enter clears, ends, flips), then the `statuses`
presets (`:emoji: text (expiry)`, common Slack shortcodes drawn as the
emoji), Do Not Disturb for 30 minutes, an hour, until tomorrow, and Set
away / Set active. `users.profile.set`, `dnd.setSnooze` / `endSnooze`,
`users.setPresence`; every pick keeps the palette open with a toast.

**The bar item** `slack/unreads`: the count of what is addressed (DMs +
mentions + thread replies) as the badge, hidden at zero, urgent while a
direct message waits (`dm_urgent`); every `refresh` seconds and on show,
wake, network. The popover is a view: a section per kind with the newest
rows (avatars, the latest line, a count badge; Enter opens one), the
quiet channels as badges, a reply field on `r`, mark read on `m`, all
read on `a`, the palette on `p`. A failed refresh leaves it stale; not
signed in hides it.

Popover keys of `slack/unreads` (rendered every 120 s and on show, wake,
network; the arrows move the cursor, a click sets it):

| keys | does |
| --- | --- |
| `enter` | Open the row in Slack |
| `up` | Move the cursor (down, j, k too; a click sets it) |
| `r` | Reply: the search row becomes the field, Enter sends |
| `m` | Mark the row read |
| `a` | Mark all read (cmd+shift+a too) |
| `o` | Open Slack |
| `p` | Open the Unreads palette |
| `cmd+shift+o` | Open the row in the browser |
| `cmd+c` | Copy the row's link |

Settings, `[extensions.slack]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `auth` | `app` / `token` | `app` | The desktop app's session, or a user token. |
| `token` | secret | (none) | The user token, with `auth = "token"`. |
| `workspace` | text | (none) | The workspace when the app is signed in to several (id or domain); empty lists every one. |
| `statuses` | list | five presets | `:emoji: text (expiry)` per line; expiry `30m`, `2h`, `1d`, `today`, or none. |
| `dm_urgent` | boolean | `true` | The bar item red while a direct message is unread. |
| `refresh` | number (s) | `120` | Seconds between bar refreshes, 10 at least. |

For the tests, `PAL_SLACK_API` replaces the API host, `PAL_SLACK_APP_DIR`
the app's directory and `PAL_SLACK_TOKEN` the token setting.

## Menu Bar Items (`menu-bar`)

The menus of the app in front as one list, Raycast's Search Menu Bar
Items: every enabled item with the menus above it as the subtitle ("File
> Export"), its shortcut as key caps, a check mark when it is on, the
app's icon on every row, a section per top menu in menu order. Live, so
the menus are read again every time the panel shows (pal's panel never
takes the app's place, so the app behind it is the one read) and the rows
are root results: `export pdf` at the root finds Preview's item without
opening the palette; the whole path is searched (the segments are
keywords, and so is the app's name).

`Enter` presses the item: pal hides first and waits a few frames for key
focus to return to the app, so an item that opens a sheet or a dialog
lands there, then presses the very element it listed through Accessibility
(`AXPress`); the HUD names the app and the path ("TextEdit: File > Export
as PDF…"), or says why the press failed. A pick more than two seconds
after the listing, or of an id it does not have (`pal run
'menu-bar/menu-bar/File > New'`, an item hotkey, the app in front changed
since), reads the menus once more first, so the press lands in the app in
front now and `item_hotkeys` on a menu item work as long as its path is
stable.

What is left out: separators and disabled items (what the app would not
let you click now), the Apple menu (the System palette has what matters
there), submenus deeper than four levels (`File > Export > As > PDF` is the
deepest listed) and whatever was not reached within 150 ms of reading. The
walk is one round trip to the app's main thread per item (seven attributes
in one `AXUIElementCopyMultipleAttributeValues`) plus one per submenu, so a
warm app is fast: Finder 40 items in 18 ms, kitty 54 in 7 ms, TextEdit
with a document 144 in 11 ms, Chrome 271 in 81 ms (deep bookmark folders
cut). An app answers slowly for a moment right after it comes to the
front (TextEdit just activated: 22 items in 188 ms; a second later 144 in
11 ms), so a walk the budget cuts short is answered with the last fuller
listing of the same app when there is one, and pressing checks the item is
still enabled.

- **macOS**: needs the Accessibility permission (the menus are read through
  the app's `AXMenuBar`); without it the one row says so and `Enter` on it
  opens System Settings on the pane. Fn (Globe) shortcuts have no
  Accessibility bit: a bare letter with the "no command" flag is drawn as
  `fn F`, which is what Enter Full Screen carries.
- **Linux**: not available; no desktop exposes an app's menus to read. The
  one row says so.

No settings.

## Generate (`generate`)

Identifiers, secrets, random values, hashes, encodings, lorem ipsum, a
random colour, a QR code and a JWT taken apart, from `extensions/generate/`.
An input palette: the rows come from what is typed, and every value
copies on `Enter`, pastes on `⌘Enter`; `⌘R` (Refresh) lists again
with fresh values, which is how a value is regenerated.

The empty query lists one fresh value of every generator: UUID v4, UUID
v7 (time-ordered), ULID, Nano ID, a password (`password_length`
characters from `password_charset`, the strength as a tag on the right:
bits of entropy, weak under 36, fair under 60, good under 80, strong
under 128), a passphrase (`passphrase_words` words from a list of 2551
common five-letter words, about 11 bits each), a random number (1 to
100), 16 random bytes as hex and as base64, a lorem ipsum paragraph, a
random colour (the swatch as its icon, `⌘O` opens it in the Colour
Picker). A mode word narrows and parameterises: `password 32 alnum`,
`passphrase 7`, `number 1-6` (or `dice`), `hex 32`, `bytes 32`, `lorem
3 paragraphs`, `colour` (five). Anything else filters the generators by
name and keyword.

A transform mode works on the text after it, or on the newest clipboard
text when nothing follows (the subtitle says which): `sha256`, `md5`,
`sha1`, `sha512`, `hash` (all four, `⌘⇧C` copies them as lines),
`base64`, `b64url`, `url`, `hex` (each decoding first when the text is
already that), `encode` (every form), `decode` (whatever the text turns
out to be: base64, URL escapes, hex, a JWT). `qr <text>` is one row
wearing the code as its icon, drawn large in the detail pane; `Enter`
shows it full width, `⌘C` copies the SVG. The encoder is the
extension's own (`qr.ts`, byte mode, versions 1 to 40, after Nayuki's
qrcodegen). `jwt <token>` is the header, the payload with its expiry as a
tag, a row per time claim (`exp`, `iat`, `nbf`) as a date with the
relative time, and a reminder row: the signature is never verified.

| keys | action |
| --- | --- |
| `enter` | Copy the value; show the QR code large on its row |
| `cmd+enter` | Paste the value into the app in front |
| `cmd+shift+c` | Copy the whole group: all hashes, all encodings, the JWT's header and payload |
| `cmd+o` | Open a colour in the Colour Picker |
| `cmd+c` | Copy the QR code as SVG |
| `cmd+r` | List again: every value regenerated |

Settings, `[extensions.generate]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `password_length` | 4 to 256 | `20` | Characters in a password; `password 32` overrides it once. |
| `password_charset` | `full`, `alnum`, `letters`, `digits` | `full` | What a password is drawn from; with `full` or `alnum` one of each class is guaranteed. |
| `passphrase_words` | 2 to 20 | `5` | Words in a passphrase; `passphrase 7` overrides it once. |
| `passphrase_separator` | text | `-` | Between the words. |

## Shortcuts (`shortcuts`)

Every shortcut from the Shortcuts app, from `extensions/shortcuts/`, over
the `shortcuts` command line tool (macOS 12 and later): indexed and
primary, so a shortcut's name at the root finds it; the folder is the
section inside the palette and a keyword. `Enter` runs the shortcut and
the panel hides; when the run ends, however long it took, the HUD shows
`<name>: Done`, the first line of what the shortcut output, or the tool's
message when it failed. `⌘Enter` runs it with the newest clipboard
text as its input (a temporary file handed to `shortcuts run -i`),
`⌘T` asks for the input in a form, `⌘O` opens the shortcut in the
Shortcuts app, `⌘C` copies its name. The listing is kept five minutes
(`ttl`); `⌘R` lists again now.

| keys | action |
| --- | --- |
| `enter` | Run the shortcut |
| `cmd+enter` | Run it with the clipboard's text as input |
| `cmd+t` | Run with text: a form for the input |
| `cmd+o` | Open it in Shortcuts |
| `cmd+c` | Copy its name |

A global hotkey per shortcut is `[palettes.shortcuts.item_hotkeys]` with
the shortcut's name as the key (`"Lights On" = "ctrl+alt+l"`); a second
shortcut of the same name has `<name> (<identifier>)` as its id. The
Shortcuts database is behind macOS's privacy guard and the tool does not
expose a shortcut's icon or colour, so every row wears the palette's
mark. On Linux, or a Mac without the tool, the palette is one row saying
so.

## Script Commands (`scripts-commands`)

Part of the `scripts` extension: every executable file in the `commands`
folder (`~/.config/pal/commands` by default, watched) whose header has a
`# @pal.title` line is one row. The header says the mode (`hud`, the
default: the HUD shows the first output line; `silent`; `show`: the whole
output as a level; `list`: the output's JSON lines as rows, a row with
`url` opening, one with `copy` copying, any other running the script again
with `PAL_PICK`; `inline`: the first output line as the row's subtitle,
refreshed every `@pal.refresh`), the arguments (`@pal.args`, a form on
`Enter`), `@pal.confirm`, `@pal.keyword`, `@pal.section`, `@pal.cwd` and
`@pal.icon` (an emoji, a glyph, a hex, a brand colour, an image next to
the script, a url). Raycast's `@raycast.*` headers are read as aliases,
so a Raycast script command drops in unchanged. The row's id is the file
name, the key for `[palettes.scripts-commands.item_hotkeys]`. The whole
format is in [Scripts and data files](scripts.md#script-commands); two
examples are under `examples/commands/`.

| keys | action |
| --- | --- |
| `enter` | Run (Open, for a `list` command; a form first with `args`) |
| `cmd+o` | Open the script file |
| `cmd+c` | Copy output: run it and copy what it printed |
| `cmd+shift+c` | Copy the file's path |

## tela (`tela-search`, `tela-research`, `tela-pages`, `tela-spaces`, `tela-new-page`, `tela-decks`, `tela-sheets`, `tela-comments`, `tela-backlinks`)

One extension, nine palettes and a bar item over a [tela](https://telawiki.com)
instance, signed in with a personal access token. Everything goes to the
instance's own API: the REST routes for lists, pages, search and writes,
and `/api/mcp` (what tela's `tela-mcp` package proxies to) for `research`.

| palette | id | kind | what `Enter` does |
| --- | --- | --- | --- |
| Search tela | `tela-search` | input | opens the page in tela |
| Ask tela | `tela-research` | input | asks; on a source, opens it |
| Pages | `tela-pages` | indexed, 5 min | opens the page in tela |
| Spaces | `tela-spaces` | indexed, 1 h | lists the space's pages |
| New Page | `tela-new-page` | indexed, 1 h | the form, the space chosen |
| Decks | `tela-decks` | indexed, 1 h | opens the deck in tela |
| Sheets | `tela-sheets` | indexed, 1 h | opens the sheet in tela |
| Comments | `tela-comments` | live | marks read and opens the page |
| Backlinks | `tela-backlinks` | indexed, 5 min | opens the linking page |

**Signing in.** `base_url` is the instance, `token` a personal access
token from Settings, API Keys on tela (`tela_pat_...`, kept in the
keychain). A read token lists, searches and researches; a page, a
comment and marking read need write scope. Without either
setting every palette is one hint row naming which; a 401 is one naming
the renewal, Enter on tela's API Keys page.

**Search tela.** Ranked full-text over titles and bodies (a phrase in
quotes, `-word` excluded), 250 ms after the last keystroke; rows by
space with the breadcrumb and the matching passage, a public-only hit
tagged; the pane is the page. **Ask tela.** tela's `research`: a numbered
grounding, the cited sources, disagreements, a low-confidence flag. Enter
on the question opens the answer as a view: the flags on top, the
sources as numbered rows, the selected one's excerpt rendered under its
row. `↓`/`j`, `↑`/`k`, a digit select; Enter opens the source, `⌘Enter`
reads it in pal, `⌘C` its link, `⌘⇧C` the grounding, `⌘⇧O` the question
on tela's Ask page, `+` twice the sources when truncated, `n` a new
question in the search row. Twelve questions are remembered; `⌘⇧D`
forgets one.

**Pages.** At the root four commands (New tela page, Search tela, Ask
tela, Quick Notes), favourites, then the pages that changed lately by
space with who changed them; from Spaces, one space's tree by top-level
page. On every page row: Open (`Enter`), Read in pal (`⌘Enter`, the
markdown drawn as a view: headings, lists, callouts as tinted cards, code
and quotes on sunken wells, tables as aligned columns, links under their
paragraph; bold and code inside a paragraph are flattened, the view's
text is one run), Copy link (`⌘C`), Outline (`⌘⇧O`), Backlinks (`⌘B`),
Comment (`⌘⇧M`, anchored on a run of the page's text).
**Spaces**: every space with its page count, tags for public, personal and
the default; `⌘Enter` opens it, `⌘N` starts a page in it. **New Page**: a
form whose body starts as the front app's selection, else the clipboard's
text. **Decks** and
**Sheets**: the flagged pages across every space, newest first; a deck's
pane leads with its first slide. **Comments**: mentions and replies to your
comments, unread first; Enter marks read and opens, `⌘⇧R` marks read,
`⌘⇧A` marks all. **Backlinks**: what links to the page opened last, or to
the row `⌘B` came from.

**The bar item** `tela/inbox`: unread mentions and replies as the badge,
hidden at zero; every 300 s and on show, wake, network. The popover: the
newest five, Open in pal, Mark all read.

Not there: a daily page (tela has none; Quick Notes stands in), an append
or any edit of a page's body (that is tela's MCP, not a launcher's job), a
space filter on Search (the REST search takes none), an LLM answer (that
is tela's Ask page, `⌘⇧O`).

Settings, `[extensions.tela]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `base_url` | text | (none) | The instance's origin. |
| `token` | secret | (none) | A personal access token from Settings, API Keys. |
| `default_space` | text | (none) | The space New tela page offers first: name, slug or id. |
| `research` | boolean | `true` | Show Ask tela; needs an embedder on the instance. |

For the tests, `PAL_TELA_URL` and `PAL_TELA_TOKEN` replace the two settings.

## Hue (`hue-rooms`, `hue-lights`, `hue-scenes`, `hue-light`, `hue-setup`, `hue-sensors`, `hue-automations`, `hue-entertainment`, `hue/home`)

Philips Hue over the bridge's CLIP v2 API on the LAN (https, the
`hue-application-key` header), nothing through the Hue cloud beyond one
discovery lookup during setup. One `GET /clip/v2/resource` per bridge reads
the home whole; the bridge's event stream (`/eventstream/clip/v2`) patches
it from then on, so every palette below is drawn from memory and follows a
change made in the Hue app, on a switch or by an automation without a
request. A change from pal is one `PUT`, applied to the model at once and
confirmed by the stream; per resource the newest state goes out no more
often than Hue asks (10 a second to a light, 1 a second to a group), so a
held arrow key is one command. Several bridges make one home. The
extension's README (`extensions/hue/README.md`) has the pairing story, the
TLS pinning (Signify's `root-bridge` CA plus the certificate pinned at
pairing; `insecure` skips it) and every key.

**Set up Hue** (`hue-setup`, a view) finds the bridges (the cloud endpoint
and mDNS; `r` scans again, `i` takes an address typed), asks each its
name and id with no key, and `1`..`9` (or Enter) starts press-link: "Press
the round button on the bridge" with a thirty-second countdown while a
background task asks the bridge every second; `x` stops a pairing (or
forgets a bridge), `b` goes back to the bridges, Escape leaves and the
panel comes back on its own once the key is in. The key lands in the
keychain and the address in the config file through `settings.set`
(Settings › Extensions › Hue shows both); `c` copies the key once paired.
Until a bridge is paired every other palette is one "Set up Hue" row and
the bar item is hidden.

**Hue Rooms** (`hue-rooms`, live, primary) lists rooms then zones with a
tile of the lit lights' colours as stripes (faded by the brightness, an
outline when off), the count on and the grouped brightness; Enter toggles
the grouped light, `⌘Enter` opens the room under the keys, `⌘S` its
scenes, `⌘L` its lights, `⌘⇧C` copies the id. **Hue Lights** (`hue-lights`,
live) is every light under its room's section with its colour as a
swatch, the archetype, the kelvin, `unreachable`, the effect and the
brightness; Enter toggles, `⌘Enter` opens, `⌘B` blinks, `⌘C` copies the
hex. **Hue Scenes** (`hue-scenes`, live, primary) is every scene by room as
a five-swatch strip of its palette, tagged `active`, `playing`, `dynamic`
or `smart`; Enter recalls it with the `transition`, `⌘Enter` plays the
palette dynamically, `⌘O` opens the room. Rooms and scenes are primary at
the root: `living room` and Enter toggles the room, `relax` and Enter
plays the scene.

**Hue Light** (`hue-light`, a view, opened from a row) puts a light or a room
under the keys: the tile in its colour with the brightness, the brightness bar,
the temperature on a warm-to-cool strip with a marker across the light's mirek
range, the hue/saturation plane with a marker (the same `gradient` node as the
colour picker), then the presets (Relax, Read, Concentrate, Energize, Bright,
Dimmed, Nightlight), the room's scenes as strips, the effects the light supports
and the options. `←`/`→` brightness (5 %, `⇧` 20 %), `↑`/`↓` cooler/warmer (20
mirek, `⇧` 80), `1`..`9` and `0`, `t`/`space` toggle, `⇥` (`⇧⇥` back) walks
light, colour (the arrows become hue and saturation, clamped into the gamut),
presets, scenes, effects (`←`/`→` choose, Enter applies), `a` this light or the
whole room, `d` the transition (instant, 400 ms, 1 s, 4 s), `s` scenes, `o` the
room, `i` blink, `c` copy, `r` re-read. The view follows the bridge: a change
from a switch or the Hue app reaches it through the event stream while it is
open (the tree pushed, `view.update`), no key needed.

**Hue Sensors** (`hue-sensors`, live): motion, temperature, light level
(lux), buttons and dials with their last event, contact sensors, by
device with the battery on the device's first row (red when low) and when
the reading changed; Enter copies the reading, `⌘E` enables or disables.
**Hue Automations** (`hue-automations`, live): the behaviour instances
with their script and status; Enter enables or disables. **Hue
Entertainment** (`hue-entertainment`, live): the areas; Enter starts
streaming, `⌘Enter` stops.

**The bar item** (`hue/home`): the main room's colour as a dot (a PNG; the
`main_room` setting, else the room with most lights on) and `N on`; the
popover toggles every room, plays the scenes (`bar_scenes`, else the main
room's), opens pal, turns everything off. Rendered every 60 s and on show,
wake and network, pushed on every stream event (at most every 300 ms).

Popover keys of `hue/home` (rendered every 60 s and on show, wake, network; the
arrows move the cursor, a click sets it):

| keys | does |
| --- | --- |
| `up` | Move over the rooms; walk an opened room's lights |
| `enter` | Open the room under the cursor; toggle the light under it |
| `space` | Toggle the room (or the light) under the cursor |
| `right` | Brighter by 5 (shift: 20); left dims |
| `backspace` | Close the opened room |
| `1` | Play the scene with that digit (1 to 9) |
| `e` | Everything on |
| `x` | All off |
| `p` | Open Rooms in pal |
| `r` | Read the bridge again |

**Links**: `pal://hue/toggle?room=living-room` (`on=1` sets),
`pal://hue/scene?name=relax&room=living-room` (`dynamic=1`),
`pal://hue/off`. Ids are slugs (`room:living-room`,
`scene:living-room/relax`, `light:sofa-lamp`), so
`[palettes.hue-rooms.item_hotkeys]` with `"room:living-room" =
"ctrl+alt+l"` toggles the room without showing pal.

Settings, `[extensions.hue]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `bridge` | text | unset | The bridge's address, for a key kept in the keychain; pairing needs neither. |
| `application_key` | secret | unset | The key for `bridge`, a `keychain:` or `env:` reference. |
| `insecure` | boolean | `false` | Skip the certificate check (a bridge behind a proxy). |
| `transition` | number (ms) | `400` | How long a change from a row or a link takes; the view cycles its own with `d`. |
| `main_room` | text | unset | The bar dot's room and the popover's scenes. |
| `bar_scenes` | list | `[]` | Scene names or ids in the popover, in order. |
| `timeout` | number (s) | `5` | One request's limit. |

## Spotify (`spotify-now-playing`, `spotify-search`, `spotify-playlists`, `spotify-library`, `spotify-devices`, `spotify-queue`, `spotify-commands`, `spotify/playing`)

One extension over the Spotify Web API, signed in to your own Spotify
app with PKCE (no secret; `extensions/spotify/README.md` says how to
create the app and register `http://127.0.0.1:27182/callback`). The
refresh token lives in the extension's storage file, since the SDK has
no `settings.set` to write a `keychain:` reference through; Sign Out
deletes it.

| palette | id | kind | what `Enter` does |
| --- | --- | --- | --- |
| Lyrics | `spotify-now-playing` | view | play or pause; the transport on keys |
| Search Spotify | `spotify-search` | input | plays the row |
| Playlists | `spotify-playlists` | indexed, 5 min | plays the playlist; `cmd+enter` lists its tracks |
| Library | `spotify-library` | indexed, 5 min, filters | plays the track |
| Spotify Devices | `spotify-devices` | live | transfers playback there |
| Queue | `spotify-queue` | live | skips to the row |
| Spotify | `spotify-commands` | indexed, primary | play or pause, next, previous, like, lyrics, sign out, "Play `<pinned playlist>`" |

**Search** lists Tracks, Artists, Albums, Playlists, Podcasts and
Episodes as sections with the cover as the icon. A track: `Enter` plays,
`⌘Enter` queues, `⌘L` likes or unlikes, `⌘O` opens in Spotify,
`⌘C` copies the link; a playlist or album: `Enter` plays it as the
context, `⌘Enter` its tracks as a level (a row there plays from that
point inside it), `⌘S` shuffled. **Library**'s filters (`Tab`): Liked Songs
(newest first), Recently played, Top tracks, Top artists (the last
weeks). **Devices**: a row per device with its glyph, volume and
`active` tag (Enter plays there, `⌘Enter` transfers without playing),
plus Volume up, down and Mute rows for the active one (`⌘↑`/`⌘↓` from
any row).
**Queue**: what plays now, then the queue numbered; the Web API cannot
remove a queued track, so Enter skips to the row (one Next per row).
The **Spotify** rows are root results (`pause`, `next`, `like`, `Play
Focus`); the playing track is also a Now row at the empty root.

**The lyrics view** (`spotify-now-playing`): the cover, the track, a
ticking progress bar, badges (paused, shuffle, repeat, liked, the device
and its volume) and lrclib.net's synced lyrics around the line playing,
the line bright at the largest size, the three before muted, the three
after faint, sliding up as the song goes; unsynced lyrics scroll with
the position; "No lyrics on lrclib" with `f` to search there. The
cover's dominant colour is a band under the art and the progress bar's
colour. Keys: `space` play or pause, `left`/`right` seek 10 s,
`up`/`down` volume, `l` like, `s` shuffle, `r` repeat, `q` queue, `d`
devices, `⌘→`/`⌘←` skip, `⌘C` copy the line, `⌘O`
open in Spotify. Every key answers with the next tree at once from a
locally patched state, and the view follows the song while it is open:
the tree is pushed every second while something plays (the lines slide
up on time), with a re-ask every 5 s as the safety net.

**The bar item** (`spotify/playing`): the track, or with `bar_lyrics`
the lyric line playing; hidden while nothing plays. The popover is the
lyrics view in a compact layout (the cover top-left, a slim progress
bar, the line playing with one before and two after, the transport and
the like/device/queue row as keycap hints), pushed every second while
the popover is open (the shell says when it opens and closes; five
minutes after the last action as the fallback; Spotify read every 5 s,
the clock between reads), and outside that window the item asks to be
rendered again when the next line starts. Rendered every 30 s, on show,
wake, network and the `media` trigger.

Popover keys of `spotify/playing` (rendered every 30 s and on show, wake,
network, media; the arrows move the cursor, a click sets it):

| keys | does |
| --- | --- |
| `space` | Pause or play |
| `cmd+right` | Next track |
| `cmd+left` | Previous track |
| `right` | Seek 10 s forward |
| `left` | Seek 10 s back |
| `up` | Volume up |
| `down` | Volume down |
| `l` | Like or unlike |
| `s` | Shuffle on or off |
| `r` | Repeat all, one, off |
| `q` | Open the queue |
| `d` | Open the devices |
| `cmd+c` | Copy the current line (or the track) |
| `cmd+o` | Open in Spotify |

Settings, `[extensions.spotify]`: `client_id` (text), `redirect_port`
(number, `27182`), `bar_lyrics` (boolean, `true`), `pinned` (list of
playlist names or `spotify:playlist:` links). A `429` is waited out
under two seconds and otherwise refused locally until its `Retry-After`;
offline, no device and Premium-required states are one line each.

## Obsidian (`obsidian-notes`, `obsidian-search`, `obsidian-daily`, `obsidian-tags`, `obsidian-recent`, `obsidian-backlinks`, `obsidian-outgoing`)

One extension, seven palettes over an Obsidian vault on disk: the folder
in the `vault` setting, else the one Obsidian has open in its own
`obsidian.json`. Nothing goes through Obsidian itself except opening a
note (`obsidian://open`); the notes are read as files.

| palette | id | kind | what `Enter` does |
| --- | --- | --- | --- |
| Notes | `obsidian-notes` | indexed, 5 min, primary | opens the note |
| Search Notes | `obsidian-search` | input | opens the note |
| Daily Notes | `obsidian-daily` | live | opens today's note, or creates it |
| Tags | `obsidian-tags` | indexed, 5 min, catalog | lists the notes with the tag |
| Recent Notes | `obsidian-recent` | live | opens the note |
| Backlinks | `obsidian-backlinks` | indexed, 5 min | opens the linking note |
| Outgoing Links | `obsidian-outgoing` | indexed, 5 min | opens the linked note |

**Notes.** Every `.md` in the vault (dot folders and the `exclude` globs
out) as a row: the title (front matter `title`, else the first `#`
heading, else the file name), the description (front matter, else the
first body line) as the subtitle, the folder as the section, up to three
tags and the change date on the right; the file name, the aliases, the
tags and the folder are keywords. Four commands lead: Today's note
(`⌘Enter` appends to it), New note, Search notes (`⌘Enter` opens
Obsidian's search), Random note. On a note: Open in Obsidian and Open in
editor (`Enter` and `⌘Enter`, swapped by the `open_with` setting; the
`editor` command gets the path, empty is the OS opener), Copy wikilink
(`⌘C`: `[[name]]`, `[[folder/name]]` when the name is shared), Read in
pal (`⌘⇧R`: the note as a view through tela's markdown renderer, with
callouts, tables, tasks, code), Backlinks (`⌘B`), Outgoing links (`⌘L`),
Copy path (`⌘⇧C`). The pane (`⌘I`) is the note as markdown (front matter
off, callouts a bold lead, wikilinks as links into Obsidian) over its
path, modified time, words, tags, aliases, links and backlinks. The index
is per file by mtime and size; a watcher on the vault marks it stale, the
next listing rebuilds it.

**Search Notes.** Full-text as you type, the words as typed, case-
insensitive: ripgrep over the vault when `rg` is on PATH, else a scan in
Bun cut at one second. Rows by folder with the first matching line as the
subtitle and the count of matching lines; the pane lists them with the
match bold; a note named like the query first. **Daily Notes.** Today's
note (Create today's note when missing, asking first, from the template),
yesterday's, the last seven days under This week; then Append to today (a
form prefilled from the clipboard; `{selection}`, `{clipboard}`,
`{date}`, `{time}` filled; the text lands as the last line, the note
created when missing) and New note (title, a folder of the vault, the
body from the `template` setting with `{{title}}` and `{{date}}` filled,
else your selection or the clipboard; a title already taken is refused).
The folder, name format and template of a daily note come from the
`daily_*` settings, else Obsidian's `.obsidian/daily-notes.json`, else
`YYYY-MM-DD`; the format is moment's tokens as Obsidian takes them.
**Tags**: every tag with its count, most used first; Enter lists the
carriers (a nested `#a/b` counts under `#a` too). **Recent Notes**: the
twenty changed last. **Backlinks** and **Outgoing Links**: for the note
opened last, or the row `⌘B` / `⌘L` came from; a link to nothing yet
offers Create the note.

Links: `pal://obsidian/open?path=`, `pal://obsidian/new?title=&body=&folder=`,
`pal://obsidian/append-today?text=`.

Settings, `[extensions.obsidian]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `vault` | path | (none) | The vault folder; empty takes the vault Obsidian has open. |
| `open_with` | select | `obsidian` | What Enter does on a note (`obsidian` or `editor`); `⌘Enter` is the other. |
| `editor` | text | (none) | The command Open in editor runs with the path last; empty opens with the OS. |
| `daily_folder` | text | (none) | Where daily notes live; empty reads the plugin. |
| `daily_format` | text | (none) | The daily note's name; empty reads the plugin, then `YYYY-MM-DD`. |
| `daily_template` | text | (none) | The template a new daily note starts as; empty reads the plugin. |
| `template` | text | (none) | The template New note starts as. |
| `exclude` | list | `[]` | Globs relative to the vault left out of every palette. |

Not there: editing a note's body, Obsidian's search operators (`tag:`,
`path:`), weekly and monthly notes, canvases and attachments.

## Gmail (`gmail-inbox`, `gmail-search`, `gmail-labels`, `gmail-compose`, `gmail-drafts`, `gmail/unread`)

One extension, five palettes and a bar item over the Gmail API, `multi`:
one instance per account (`[extensions.gmail]` and
`[extensions."gmail@work"]` next to `[instances."gmail@work"]`), each
with its own token command, address, palettes, bar item and storage; the
titles read "Inbox (Work)", the tile takes the instance's tint and badge.

| palette | id | kind | what `Enter` does |
| --- | --- | --- | --- |
| Inbox | `gmail-inbox` | live, lazy | opens the thread in the account's Gmail |
| Search Mail | `gmail-search` | input | opens the thread |
| Labels | `gmail-labels` | indexed, 1 h, catalog | opens the label in Gmail |
| Compose | `gmail-compose` | list (one row, send on) | the form, then sends |
| Drafts | `gmail-drafts` | live, lazy (send on) | opens the draft in Gmail |

**The token.** `token_command` (per instance) is a shell command whose
stdout is an access token, bare or as an OAuth endpoint's JSON
(`access_token`, `expires_in`): the calendar extension's pattern. Kept
in memory until its expiry (30 min for a bare one), minted again once on
a 401, never written. `gcloud auth application-default
print-access-token` after a login with `gmail.modify`; the owner's two
identities through his broker (`aud=gmail`, `aud=gmail-work`). A failing
command is one hint row with its last stderr line and Open Gmail
settings; an empty one names the fix; a rejected token says to check the
scopes. The bar item hides without a token, goes stale on anything else.

**Inbox.** `messages.list` with `maxResults` 50 for the inbox's unread,
then the inbox, then each `labels` entry's unread; `messages.get` with
`format=metadata` (From, To, Cc, Subject, Date, Message-ID, Reply-To,
References) eight at a time, cached by id for the process, the labels
patched on every write. Sections Unread, Recent, then one per `labels`
entry. The row: the sender's Gravatar (a HEAD per address, remembered)
or the initial on a tile tinted from the address, the subject, the
sender and the snippet, the user labels as chips (two), a star tag, a
paperclip when the top-level MIME type is `multipart/mixed` (a guess:
`metadata` sends no parts; the pane confirms), the date. The pane
(`format=full`, the last twenty kept): the text body with the quoted
replies folded (`On ... wrote:` and `>` runs; Gmail's `gmail_quote`,
`blockquote`, Outlook's `divRplyFwdMsg` in HTML), else the HTML as text
(lists as a `-` bullet, links as `text (url)`), markdown-escaped so a `<a@b>`
survives; From, To, Cc, Date, Labels, Attachments (name and size),
Open in Gmail. The unread count is the list's length under a page,
`labels.get INBOX` past it. The inbox is shared with the bar item for
30 s.

| action | shortcut | when |
| --- | --- | --- |
| Open in Gmail | `Enter` | `https://mail.google.com/mail/u/<address>/#inbox/<threadId>`; `#all/` off the inbox |
| Mark as read / Mark as unread | `⌘Enter` | `messages.batchModify` over the row or the marked rows |
| Archive | `⌘E` | send on; `INBOX` removed |
| Star / Unstar | `⌘S` | send on |
| Reply | `⌘⇧R` | send on; a form (to, cc, subject, body), the original quoted under the answer and the signature between, `messages.send` in the thread with `In-Reply-To` |
| Copy link | `⌘C` | |

The bare `e` and `s` the design asked for would type into the search
box in a list palette, so they are `⌘E` and `⌘S`.

**Search Mail.** `messages.list` with the query as typed (`from:`,
`subject:`, `has:attachment`, `newer_than:7d`, `label:`), 50 at most, a
keystroke waiting 300 ms for the next; the rows as Inbox's, sectioned by
the first user label, else Inbox / Sent / Drafts / Spam / Trash /
Archive.

**Labels.** `labels.list` once an hour, persisted in storage so a restart
lists with no call; yours by name, then Inbox, Starred, Important, Sent,
Drafts, Spam, Trash and the categories. Enter opens `#label/<name>` (or
Gmail's own anchor); `⌘Enter` pushes Search Mail with `label:<name>`
typed; `⌘C` copies the name.

**`send`, per instance, off by default.** Off is read and mark-read
only: no compose, no reply, no drafts, no archive, no star; Compose and
Drafts list nothing and the row keeps Open, Mark as read, Copy link.
That is the rule for the owner's work account (the token can send, the
extension does not; README). On: Compose is one row opening a form (to,
cc, subject, body with the `signature` under it) that sends
`messages.send`; Drafts lists `drafts.list` with the recipient and the
subject, `⌘Enter` sends after a confirmation (`drafts.send`), `⌘D`
discards after one.

**The bar item** `gmail/unread`: the inbox's unread count as the badge,
hidden at zero, the instance's title as the strip text when it has one
("Personal", "Work"), the address in the tooltip; every 120 s and on
show, wake, network. The popover: the newest five unread, each a
submenu (Open in Gmail, Mark as read), then Open in pal (the Inbox
palette) and Open Gmail.

Settings, `[extensions.gmail]` (and `[extensions."gmail@work"]`):

| key | type | default | what |
| --- | --- | --- | --- |
| `token_command` | text, `scope: instance` | (none) | The command that prints the access token. |
| `address` | text, `scope: instance` | (none) | For the links and the tooltip; the profile's when empty. |
| `labels` | list | `[]` | Labels whose unread mail Inbox lists besides the inbox, by name. |
| `send` | boolean, `scope: instance` | `false` | Compose, reply, drafts, archive, star. |
| `signature` | text | (none) | Under a composed or replied body. |

A 429 (or a 403 naming the quota) is remembered for `Retry-After` (60 s
without one) and every call until then refused locally, one hint row.
For the tests, `PAL_GMAIL_API` replaces the API host and
`PAL_GMAIL_AVATARS` the Gravatar host.

## Translate (`translate`, `translate-history`)

Text translated as it is typed, from `extensions/translate/`. An input
palette: 350 ms after the last key the text goes to the backend and the
rows come back: the translation first (`Enter` copies, `⌘Enter`
pastes, `⌘⇧S` speaks it aloud, `⌘⇧C` copies the source,
`⌘O` opens the pair in the Google Translate web app), then the
translation in Latin letters when its script is not Latin, the detected
language with the detector's confidence, the alternatives Google offers,
the source romanised, dictionary entries for a word, and a Swap row that
translates the result back the other way (a push with the pair
reversed). The detail pane holds both texts, the pair, the backend and
the confidence.

The target is the `to` setting, else the system language; the source is detected
unless `from` names one. A prefix names the ends once, at the root too
(`inline`): `tr: hello`, `>de hello`, `german: hello` (the target), `en>tr
merhaba`, `turkish>english merhaba` (both); a word only counts as a language
when it is one (`todo: buy milk` is text), and `>de` takes no space (`>` and a
space is the Shell palette's root prefix). Nothing typed: the selection in the
app in front, else the newest clipboard text, the subtitle saying which; `tr:`
alone does the same to Turkish. A text already in the target goes the other way:
to `from` when it names a language, else to English, else to the system
language; with nothing else to go to (an English text on an English system) the
row says so.

Backends: Google's web endpoint (`translate.googleapis.com/translate_a/single`,
`client=dict-chrome-ex`), no key and unofficial (it may refuse a network
it takes for a bot, as `gtx` did from one home network, or change; the
refusal is one row naming the fix), 5000 characters per request; or
DeepL's v2 API on the free host with `api_key` (the translation and the
detected source only). Speech is `say` with a voice of the language on
macOS (Yelda for Turkish), `spd-say` or `espeak` on Linux.

Translation History (`translate-history`, live, its rows at the root):
what was copied, pasted or spoken, newest first, once each, the last
hundred in `storage`; `Enter` copies again, `⌘T` translates the entry
afresh with the detected source pinned, `⌘D` removes it, the last row
clears the history after a confirm card.

| keys | action |
| --- | --- |
| `enter` | Copy the translation; on Swap, translate it back |
| `cmd+enter` | Paste the translation into the app in front |
| `cmd+shift+s` | Speak the row aloud, in its language |
| `cmd+shift+c` | Copy the source text |
| `cmd+o` | Open in Google Translate |
| `cmd+t` | History: translate the entry again |
| `cmd+d` | History: remove the entry |

Settings, `[extensions.translate]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `from` | code or name | `auto` | The source language; a prefix overrides it once. |
| `to` | code or name | empty (the system language) | The target; text already in it goes the other way. |
| `backend` | `google`, `deepl` | `google` | Which translator. |
| `api_key` | secret | empty | The DeepL key (a free one ends in `:fx`). |
| `speak` | boolean | `false` | Also read the translation aloud when `enter` copies it. |

For the tests, `PAL_TRANSLATE_GOOGLE` and `PAL_TRANSLATE_DEEPL` replace
the hosts and `PAL_TRANSLATE_SAY` the speaker.

## Shell (`shell`, `shell-history`)

One command run in the login shell, its output read in the panel, from
`extensions/shell/`. An input palette: the typed command is one row,
`Run: <command>`, and nothing runs until `Enter`; `$ ls` or `> git
status` at the root lists the same row inline. `⌘Enter` on the row
opens the command in a terminal window instead, `⌘C` copies it. A
command that looks destructive (`rm`, `sudo`, `mv`, `dd`, `git reset
--hard`, `kill -9`, a package manager's uninstall, a redirect onto a disk
device, and so on, judged on the command word of every simple command
of the line) asks first while `confirm` is on.

The command runs through the `shell` setting (`$SHELL -lic`: the login
shell with the profile and the interactive rc, so PATH, aliases and
functions apply) in `cwd`, with the `env` lines set, for `timeout`
seconds (10) at most, then SIGTERM and SIGKILL to the process group.
The answer is a view level: the command as the title, the folder under
it, `exit 0` (green) or `exit N` (red) and the duration as badges,
`killed after N s` on a timeout and `output cut` past 256 KB per stream,
stdout in monospace on a sunken surface with stderr under it in red,
scrolling past the panel. A command still running 2.5 s after `Enter`
gets the view with a `running` badge and the elapsed time, and the
result lands in place through `view.update` when it ends, so a command
may outlast the panel's own wait for a pick. In the view `Enter` copies
the output (stderr when there was none), `⌘Enter` opens a terminal on
the command, `⌘R` runs it again (the view's own action: a view level
takes the keys the shell's Refresh would), `⌘C` copies the command,
`⌘⇧E` copies stderr.

The terminal is the `terminal` setting: Terminal (default) and iTerm over
AppleScript, kitty, Alacritty, WezTerm and Ghostty by their flags through
`open -na`, any other name with `-e`; on Linux `$TERMINAL`, else
`x-terminal-emulator`. The window opens on `cd <cwd> && <command>; exec
<shell>`, so it stays up with the output.

Shell History (`shell-history`): every command that ran, newest first,
once each, the last hundred in `storage`, with its exit code as a tag
(`killed` for a timeout), the duration and the folder; `Enter` runs it
again (the same confirm), `⌘Enter` opens it in a terminal, `⌘C`
copies it, `⌘D` removes the entry, the last row clears the history.
It is an input palette rather than live: listed on every keystroke so a
command just run is there, and never at the root, where an `Enter` would
run one.

| keys | action |
| --- | --- |
| `enter` | Run the command; in the view, copy the output |
| `cmd+enter` | Run in a terminal; in the view, open one |
| `cmd+c` | Copy the command |
| `cmd+r` | In the view: run again |
| `cmd+shift+e` | In the view: copy stderr |
| `cmd+d` | History: remove the entry |

Settings, `[extensions.shell]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `shell` | text | `$SHELL -lic` | The shell and its flags; the command is the last argument. |
| `cwd` | folder | `~` | Where commands run. |
| `timeout` | 1 to 600 s | `10` | The kill after. |
| `env` | list of `KEY=VALUE` | empty | Set for every command. |
| `confirm` | boolean | `true` | Ask before a destructive-looking command. |
| `terminal` | text | empty (`Terminal`) | What `cmd+enter` opens. |

Not done: stdin (closed), colour (escapes shown as printed), streaming
(the view fills at the end), a session (`cd` does not stick).

## Downloads (`downloads`)

The Downloads folder newest first, from `extensions/downloads/`. A live,
primary palette: the rows are at the root by name and the folder is read
again on every show. A file still coming in (`.crdownload`, `.part`,
`.download`, `.partial`) leads under Downloading with the name it will
have, a blue tag, its size and, once it has grown between two listings,
the rate (Safari's `.download` bundle gives its percentage and total from
its plist); the rest sit under Today, Yesterday, This week and Older by
modification day with the size and the age on the right and the kind as
the subtitle. An image or a PDF wears a 64 px thumbnail (`sips` on macOS,
ImageMagick on Linux, made once into the cache directory, the newest 24
per listing); other rows a kind glyph. With `browser_folders` the
browsers' own download folders (Chrome-family `Preferences`, Firefox
`prefs.js`) are listed too when they differ from `folder`. The last rows
clear what is older than `clear_days` (the count and size in the row, a
confirm card) and open the folder. The detail pane adds the url and the
page the file came from (Spotlight's `kMDItemWhereFroms`). The root's
Now section shows the newest download of the last ten minutes
(`suggest`).

| keys | action |
| --- | --- |
| `enter` | Open (marked rows: every one) |
| `cmd+enter` | Reveal in Finder / the file manager |
| `cmd+y` | Quick Look (macOS) |
| `cmd+c` | Copy the file itself |
| `cmd+shift+c` | Copy the path |
| `cmd+m` | Move to a folder (a form; `~` expanded, the folder created) |
| `cmd+shift+r` | Rename (a form) |
| `cmd+d` | Move to Trash (asks first; marked rows together) |
| `tab`, `shift+↓`, `cmd+click` | Mark rows |

Open, reveal, both copies and the trash take marked rows (`multi`). Trash
is Finder's delete on macOS, `gio trash` on Linux; for the tests,
`PAL_DOWNLOADS_TRASH` names a stand-in and `PAL_DOWNLOADS_CACHE` the
thumbnail directory.

Settings, `[extensions.downloads]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `folder` | folder | `~/Downloads` | The downloads folder. |
| `browser_folders` | boolean | `true` | Also the browsers' own download folders when they differ. |
| `limit` | 10 to 2000 | `200` | At most this many files, the newest. |
| `thumbnails` | boolean | `true` | Previews for images and PDFs. |
| `clear_days` | 1 to 365 | `30` | The age the Clear row trashes. |

## GIFs (`gifs`, `gifs-favourites`)

Tenor (or Giphy) searched from the panel, from `extensions/gifs/`. An
input grid: what is typed is searched 300 ms after the last key, nothing
typed lists what is trending under a Trending section, and every tile is
the GIF's small animated preview (Tenor's `nanogif`, Giphy's
`fixed_height_small`), fetched once into the cache directory
(`~/Library/Caches/pal/gifs`, `$XDG_CACHE_HOME/pal/gifs`) and sent as a
data url. `Enter` downloads the GIF into the cache, named after its
title, and puts the **file** on the clipboard (`copy_files`), so it
pastes as a picture; `⌘Enter` copies the url; `⌘O` opens the page;
`⌘S` writes the file to `save_to`; `⌘F` keeps it. The detail pane
(`⌘I`) shows the preview larger, the size in pixels and bytes, the
page. A root query nothing matched offers "Search GIFs for …".

Favourite GIFs (`gifs-favourites`, a live grid, its rows at the root):
what `⌘F` kept, newest first, the last 200 in `storage`, with the same
actions and `⌘D` to remove; the last row clears it after a confirm
card.

Backends: Tenor v2 with a Google Cloud API key that has the Tenor API
enabled (free, no billing), or Giphy with a key from developers.giphy.com;
without one the grid is one row saying which setting to fill and where
the key comes from. `content_filter` is Tenor's `contentfilter` and
Giphy's `rating` in one setting.

| keys | action |
| --- | --- |
| `enter` | Copy the GIF file |
| `cmd+enter` | Copy the url |
| `cmd+o` | Open the page on tenor.com or giphy.com |
| `cmd+s` | Save to Downloads (`save_to`) |
| `cmd+f` | Add to favourites |
| `cmd+d` | Favourites: remove |

Settings, `[extensions.gifs]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `backend` | `tenor`, `giphy` | `tenor` | Where the GIFs come from. |
| `tenor_api_key` | secret | empty | The Google Cloud key with the Tenor API enabled. |
| `giphy_api_key` | secret | empty | The Giphy key. |
| `content_filter` | `off`, `low`, `medium`, `high` | `medium` | What the results may show. |
| `save_to` | folder | `~/Downloads` | Where `cmd+s` writes the file. |

`[palettes.gifs.settings] columns` (3 to 10, default 6) is the tiles per
row of both grids. For the tests, `PAL_GIFS_TENOR` and `PAL_GIFS_GIPHY`
replace the hosts and `PAL_GIFS_CACHE` the cache directory.

## Maps (`maps`)

Places and directions in Google Maps or Apple Maps, from
`extensions/maps/`. An input palette over urls, no key: a typed place
gets Search, Directions from here, from home and from work, and the
saved places whose name or address contains it; `home > work`,
`here -> Kadıköy` or `Moda to Levent` is a route with both ends and its
reverse (`>` and `->` always split; ` to ` only when an end is home, work,
here or a saved place, so "things to do in Moda" stays a search); nothing
typed lists Home, Work, the commute both ways and every saved place. The
travel mode is the filter (driving, transit, walking, cycling; Tab cycles
it). `go: coffee` or `maps: home > work` at the root answers inline.

With `api_key` (a Google Cloud key with Places API (New) enabled), place
predictions follow the rows 250 ms after the last key and open pinned to
their place id; the inline ask never waits on them. Google bills those
requests past the monthly free credit, so they are debounced and cached
per input.

| keys | action |
| --- | --- |
| `enter` | Open the place in the chosen app; on a route row, the directions |
| `cmd+enter` | Directions from here (the current location) |
| `cmd+h` | Directions from home |
| `cmd+w` | Directions from work |
| `cmd+c` | Copy the address |
| `cmd+l` | Copy the link (a web url, never `maps://`) |
| `cmd+shift+o` | Open in the other app |
| `tab` | Next travel mode |

Settings, `[extensions.maps]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `app` | `google`, `apple` | `google` | Which app the rows open; Apple Maps is macOS only. |
| `home` | text | empty | The Home row, `home` in a route, "from home" directions. |
| `work` | text | empty | Likewise; both set lists the commute. |
| `places` | list | empty | `Name = address` per line; a line without `=` is both. |
| `api_key` | secret | empty | Places API (New) key, for autocomplete. |

For the tests, `PAL_MAPS_PLACES` replaces the Places host.

## Speedtest (`speedtest`, `speedtest-history`)

A speed test watched in the panel, run by the CLI installed, from
`extensions/speedtest/`. A view palette: opening it draws the last result
and which tool was found (Speedtest by Ookla, `speedtest-cli` or `fast`,
in that order for `auto`; `speedtest` on PATH is told apart by its
`--version`, since sivel's package installs an alias of that name), or
the three install lines when none is; **nothing runs until Enter**.
Enter spawns the tool in its own process group and the view follows its
stream through `view.update`: a bar per direction with the live figure
in Mbps (Ookla's own fraction fills it; the other two get an estimate
from the elapsed time that stops short of full), the ping tiles (latency,
jitter, loss when reported), the server and the ISP in the head, the
elapsed time in the foot with a tick between the tool's lines. Enter
while it runs stops it (SIGTERM to the group, SIGKILL a second later);
a test past two minutes is stopped. `⌘Enter` copies the result as
one line, `⌘O` opens Ookla's result page, `⌘H` opens the history;
Escape leaves and a running test keeps running, the view catching up
when reopened (`on: ["show"]` re-asks it, and a push lands when the
level reports itself).

Speedtest History (`speedtest-history`, live): every finished run,
newest first, the last `keep` in `storage`, the figures and the ping as
the name, the server, ISP and tool as the subtitle, the date on the
right; `Enter` copies the line, `⌘O` opens the result page, `⌘D`
removes it, the last row clears after a confirm card. The first row,
Trend, is a view of the last twenty runs as bars, download in blue and
upload in green, each against the best of its own, the ping beside;
Enter there copies the history as text.

| keys | action |
| --- | --- |
| `enter` | Start the test; while it runs, stop it |
| `cmd+enter` | Copy the result |
| `cmd+o` | Open the result page (Ookla) |
| `cmd+h` | History |
| `cmd+d` | History: remove the run |

Settings, `[extensions.speedtest]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `tool` | `auto`, `ookla`, `speedtest-cli`, `fast` | `auto` | Which CLI runs the test. |
| `server` | text | empty | A speedtest.net server id; fast ignores it. |
| `keep` | 1 to 200 | `30` | Runs the history holds. |

For the tests, `PAL_SPEEDTEST_PATH` names a directory searched first for
the three binaries.

## YouTube (`youtube-search`, `youtube-channels`, `youtube-later`)

YouTube searched from the panel, from `extensions/youtube/`. An input
palette: 400 ms after the last key the videos come back with the
thumbnail (`i.ytimg.com`, no key) as the icon and `channel · length ·
views · age` as the subtitle (`live now` for a stream); nothing typed is
the trending list for `region` under a Trending section; `yt: lofi` at
the root answers inline, and a root query nothing matched offers "Search
YouTube for …". `Enter` opens the video in the browser, `⌘Enter` plays
it in IINA, mpv or VLC (`player`; `auto` takes the first installed, the
browser when none is; mpv and VLC need `yt-dlp`), `⌘C` copies the url,
`⌘S` keeps it, `⌘⇧O` opens the channel; the detail pane shows
the bigger thumbnail, the channel as a link, the exact views and the
date.

YouTube Channels (`youtube-channels`, input): channels by name with the
avatar, the subscriber count and the description; `Enter` lists the
channel's latest videos as a level of the search palette (what is typed
there filters them), `⌘Enter` opens the channel. Subscriptions are not
listed: they need a Google sign-in (OAuth), which pal does not do, and
the empty palette says so.

Watch Later (`youtube-later`, live, its rows at the root): what `⌘S`
kept, newest first, the last 200 in `storage`, the same actions and
`⌘D` to remove; the last row clears it after a confirm card.

Backends: the Data API v3 with `api_key` (a Google Cloud key with the
API enabled; 10,000 units a day, a search 100, so about a hundred
searches), or an Invidious instance at `invidious_url` through
`/api/v1` with no key; the key wins when both are set. Most public
Invidious instances have turned the API off (on 2026-09-17 only
`invidious.f5.si` of the listed ones answered), so a self-hosted one is
the reliable choice; a refused key, a used-up quota, an instance that
answers HTML or an error is one row naming the fix.

| keys | action |
| --- | --- |
| `enter` | Open in the browser; on a channel, its latest videos |
| `cmd+enter` | Play in the player; on a channel, open it |
| `cmd+c` | Copy the url |
| `cmd+s` | Watch later |
| `cmd+shift+o` | Open the channel |
| `cmd+d` | Watch Later: remove |

Settings, `[extensions.youtube]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `api_key` | secret | empty | The Data API v3 key. |
| `invidious_url` | text | empty | An Invidious instance serving its API. |
| `player` | `auto`, `iina`, `mpv`, `vlc`, `browser` | `auto` | What `cmd+enter` plays in. |
| `region` | text | empty | A two-letter country code for the trending list. |

For the tests, `PAL_YOUTUBE_API` replaces the Data API host (the
Invidious host is the setting) and `PAL_YOUTUBE_PATH` a directory
searched first for the players.

## Screenshots (`screenshots`)

Take a screenshot from the panel, then find the ones you took. A live,
primary palette: three Capture rows lead it, under them the screenshots
folder newest first, each row with a 48 px thumbnail (the app's `icon://`
file route), the pixel size read off the PNG header, the file size and
the age. The folder is read again on every show, so the shot just taken
is there, and its name finds it at the root.

The Capture rows run the OS tool once the panel is down (the pick answers
`hide` and the tool starts a beat later, so the panel is never in the
shot): `screencapture -i` (an area; space switches to a window, Escape
cancels), `screencapture -i -W` (a window) and `screencapture` (the
screen) on macOS; `grim -g "$(slurp)"` and `grim` on Linux, where both
tools must be on PATH (and `wl-copy` for the clipboard) or the section is
one hint row. Enter sends the shot where the `destination` setting says,
a file named the way macOS names its own (`Screenshot 2026-09-17 at
14.03.22.png`) in the folder, or the clipboard; `⌘C` on the row takes
the other destination for that one shot; `⌘Enter` waits `timer`
seconds first (`-T`). The HUD then says `Screenshot saved: <name>` or
`Copied to the clipboard`; a cancelled capture says nothing. The shutter
is silent unless `sound` is on.

| keys | action |
| --- | --- |
| `enter` | Open (marked rows: every one); on a Capture row, capture |
| `cmd+enter` | Reveal in Finder / the file manager; on a Capture row, capture after the timer |
| `cmd+c` | Copy image: the file itself onto the clipboard, so a paste in a chat drops the picture; on a Capture row, the other destination |
| `cmd+shift+c` | Copy the path |
| `cmd+m` | Copy as markdown image: `![Screenshot 2026-09-17 at 14.03.22](/Users/x/Desktop/Screenshot%202026-09-17%20at%2014.03.22.png)` |
| `cmd+shift+t` | Copy text (OCR): the text in the picture through the core's OCR (Vision on macOS, `tesseract` on Linux); `ocr_concealed` keeps it out of the history |
| `cmd+d` | Move to Trash (asks first; marked rows together) |
| `tab`, `x`, `shift+↓`, `cmd+click` | Mark rows |

Open, Reveal, Copy image, Copy path and the trash take marked rows
(`multi`). The detail pane (`⌘I`) shows the picture itself over its
name, folder, size, pixels and the time it was taken. The root's Now
section offers a screenshot taken in the last two minutes as
`Screenshot taken 40 s ago` with Open, Copy image and the markdown tag.
For the tests, `PAL_SCREENCAPTURE_BIN` names a stand-in capture tool and
`PAL_SCREENSHOTS_TRASH` a stand-in trash.

Settings, `[extensions.screenshots]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `destination` | `file`, `clipboard` | `file` | Where Enter on a Capture row sends the shot. |
| `folder` | folder | (system) | Where captures land and the list reads. Empty: `defaults read com.apple.screencapture location`, else `~/Desktop`; on Linux `~/Pictures/Screenshots` when it exists, else `~/Pictures`. |
| `timer` | 1 to 60 | `3` | Seconds the delayed capture waits. |
| `sound` | boolean | `false` | Play the shutter sound. |
| `all_files` | boolean | `false` | Every image and recording in the folder, not only the ones named like macOS's captures (`Screenshot`, `Screen Shot`, `Screen Recording`, `grim-`). |
| `limit` | 1 to 500 | `50` | At most this many recent rows. |
| `ocr_concealed` | boolean | `false` | Text copied by OCR is concealed. |

## Images (`images`)

Compress, resize, convert, rotate, crop, strip metadata, make an icon
set, read the text: the images selected in Finder, on the clipboard or at
a typed path, with the tools on the machine (sips, pngquant, oxipng,
mozjpeg, cwebp, avifenc, ImageMagick) and TinyPNG when you give it a key.
An input palette: before you type it lists the images at hand (the Finder
selection, a folder's images, an image or files on the clipboard); a
typed path lists a file, a folder or the entries that complete it. Every
result is written next to its source with a suffix (`-compressed`,
`@0.5x`, `.webp`) and its path copied; `replace` writes over the source
and keeps the original for Restore. Several at once: mark rows (`Tab`, or
`x` while nothing is typed) or pick a folder.

| action | shortcut | what |
| --- | --- | --- |
| Compress | `Enter` | the first tool in `tools` that takes the format; the row says which and the sizes |
| Optimise for web | `⌘Enter` | the long side capped at `web_max`, encoded at `quality` as `web_format`, stripped; a view with before and after |
| Compress losslessly | `⌘L` | |
| Compress with TinyPNG | `⌘T` | with `tinypng_api_key` set |
| Resize… | `⌘⇧R` | width, height, fit, percent, @2x and @1x |
| Convert… | `⌘⇧V` | PNG, JPEG, WebP, AVIF, HEIC, PDF, TIFF, GIF |
| Rotate or flip… | `⌘⇧O` | |
| Crop or pad… | `⌘⇧A` | crop to an aspect, centred, or pad to a square in `pad_color` |
| Strip metadata | `⌘⇧M` | lossless for PNG and JPEG |
| Grayscale | `⌘G` | |
| Make an icon set | `⌘⇧F` | the `.iconset`, the `.icns`, `favicon.ico`, the touch and Android sizes, in a folder next to the image |
| Copy text (OCR) | `⌘⇧T` | Vision on macOS, `tesseract` on Linux |
| Copy info | `⌘⇧I` | dimensions, format, colour profile, camera, exposure, date, location (`exiftool` when installed) |
| Copy path | `⌘C` | |
| Copy image | `⌘⇧P` | |
| Open | `⌘O` | |
| Reveal in Finder | `⌘⇧E` | |
| Restore original | `⌘⇧Z` | a replaced result |
| Move result to Trash | `⌘D` | |

Settings, `[extensions.images]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `replace` | bool | `false` | Write over the original (kept for Restore) instead of next to it. |
| `quality` | number | `80` | For the lossy encoders (JPEG, WebP, AVIF, HEIC; pngquant's floor is 25 below it). |
| `web_format` | `keep`, `webp`, `avif` | `"keep"` | What Optimise for web writes: the source's format, or WebP or AVIF. |
| `web_max` | number | `2000` | Optimise for web shrinks the long side to at most this many pixels; smaller images are left at their size. |
| `thumbnails` | bool | `true` | Thumbnails on the rows. |
| `pad_color` | text | `"#ffffff"` | What Pad to a square fills with, as hex. |
| `tinypng_api_key` | secret | unset | From tinypng.com/developers (500 compressions a month free). Adds Compress with TinyPNG to every row. |
| `tools` | list | `["pngquant", "oxipng", "optipng", "cjpeg", "jpegtran", "cwebp", "avifenc", "gifsicle", "exiftool", "magick", "sips"]` | The encoders in the order they are tried; one left out is never used. sips (macOS) and ImageMagick are the fallbacks for everything. |

## WhatsApp (`whatsapp-chats`, `whatsapp-unread`, `whatsapp-search`, `whatsapp-contacts`, `whatsapp/unread`)

One extension, four palettes and a bar item over a self-hosted
[OpenWA](https://github.com/openwa) gateway's HTTP API (the owner's at
`http://wp.lan`, one session named `main` linked to his phone, the
archive of every message since 2018 behind its `/api/search`).
`extensions/whatsapp/README.md` has the setup for a gateway of your own.

| palette | id | kind | what `Enter` does |
| --- | --- | --- | --- |
| Chats | `whatsapp-chats` | live, lazy, primary | opens the chat in the app or the web client |
| Unread | `whatsapp-unread` | live, lazy | the same, over the unread chats only |
| Search WhatsApp | `whatsapp-search` | input | opens the hit's chat |
| Contacts | `whatsapp-contacts` | indexed, 1 h, catalog | opens a chat with the contact |

**Chats.** `GET /chats` (the list, live from WhatsApp), the status feed,
broadcast lists and Channels dropped, the unread chats first then newest
first. The unread chats' newest messages (their count, five at most)
come from `/messages/<chat>/history` (live, `fromMe`, oldest first) laid
over `/messages?chatId=` (the archive: the sender's saved name, the
quoted reply), merged by message id, so the row says who said what and
a media message is named (`[photo]`, `[voice message]`, `[document]
name`); the other rows carry the gateway's one-line summary. The row:
the profile picture (else the initial on a tile; a group the group
glyph), the name, the line, a `group` tag, the unread count in green,
the time. The pane: the last twenty messages as a conversation (the
sender in bold, "You" for yours, the time, a quoted reply as a
blockquote, media in brackets), then kind, unread, the phone (a LID-era
`@lid` id resolved through `/contacts/<lid>/phone`, once), the newest
message's time, a link into the web client. Pictures are never on the
listing's path: the gateway resolves them at ~150 ms each (50 ids took
11.5 s live), so a background pass asks for eight at a time among the
newest 48 chats and keeps the urls (good for about nine days, `oe` in
the query) in storage under `pictures`. One chat list serves the bar
and the palettes for 30 s.

| action | shortcut | when |
| --- | --- | --- |
| Open chat | `Enter` | `whatsapp://send?phone=` in the desktop app, `https://web.whatsapp.com/send?phone=` on the web, per `open` (`auto` is the app when installed on macOS); a group has no link of its own, so WhatsApp opens at the top and the HUD says so |
| Mark as read / Mark as unread | `⌘Enter` | `POST /chats/read` and `/chats/unread`, over the marked rows too |
| Send a message | `⌘⇧R` | `send` on; a form with the text and a box to quote the latest message (`/messages/reply`, else `/messages/send-text`) |
| React to the latest message | `⌘⇧E` | `send` on; WhatsApp's six quick reactions or remove yours (`/messages/react`) |
| Open in the web client | `⌘⇧O` | |
| Copy number / Copy name | `⌘C` | `+905...`; a group's name |

**Unread**: the same rows over the chats with something unread, direct
messages then groups (the root's unread rows). **Search WhatsApp**:
`/api/search?q=` (full-text over the archive, `<mark>` snippets), 300 ms
after the last keystroke, 40 hits; the row is the matching line, who
said it where (the chat's name from the list, a sender's from the
contacts), when; `Enter` opens the chat, `⌘C` copies the message, the
pane is the chat's conversation; a provider that is down is one hint
row with the status and the gateway's message. **Contacts**: `/contacts`
a thousand a page (the first page, then five in parallel), the saved
ones (`isMyContact` with a name) one per number, an hour in memory;
`Enter` opens a chat, `⌘C` copies `+<number>`, `⌘⇧C` a vCard 3.0.

**`send`, off by default.** Off is read and mark-read only: no Send a
message, no React, no reply field in the popover; every write path
checks it again at pick time and refuses with a toast naming the
setting. The key can do all of it; the setting is the control (the
owner's rule for sends: an outward action, only as a form he submits).

**The bar item** `whatsapp/unread`: the number of unread chats as the
badge, hidden at zero (`unread_only_bar` off keeps the glyph and lists
the recent chats in the popover), red while a direct chat is unread
(`dm_urgent`); every 120 s and on show, wake, network. The popover is a
view of the item's own (`view.ts`): direct messages then groups with the
picture as a data url, the newest message and the time, a cursor the
arrows move and a click sets; `Enter` opens, `m` marks read, `a` all,
`r` (send on) a message field whose `Enter` sends, `o` WhatsApp, `p` the
Unread palette, `⌘⇧O` the web client.

Popover keys of `whatsapp/unread` (rendered every 120 s and on show, wake,
network; the arrows move the cursor, a click sets it):

| keys | does |
| --- | --- |
| `enter` | Open the row's chat |
| `up` | Move the cursor (down, j, k too; a click sets it) |
| `r` | Reply: the search row becomes the field, Enter sends (send on) |
| `m` | Mark the row read |
| `a` | Mark all read (cmd+shift+a too) |
| `o` | Open WhatsApp |
| `p` | Open the Unread palette |
| `cmd+shift+o` | Open the row's chat in the web client |

Links: `pal://whatsapp/open?chat=<id | phone | name>` (a chat id, a
number, or a name from the chats then the contacts, exact then prefix)
and `pal://whatsapp/search?q=`.

Settings, `[extensions.whatsapp]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `base_url` | text | `http://wp.lan` | Where the gateway answers; `/api` is under it. |
| `api_key` | secret | (none) | Sent as `x-api-key`; in the OS keychain. |
| `session` | text | `main` | The session's name; the UUID is resolved once and kept in storage (`session:<name>`), resolved again on a 404 naming the session. |
| `send` | boolean | `false` | Send a message, React, the popover's reply field. |
| `unread_only_bar` | boolean | `true` | Hide the bar item at zero. |
| `dm_urgent` | boolean | `true` | Red while a direct chat is unread. |
| `open` | `auto`, `app`, `web` | `auto` | Where a chat opens. |

Hint rows: no key (Open WhatsApp settings), the gateway unreachable at
its url, the key rejected (401), a session not ready (a `qr_ready` one
says to scan the code at the gateway's url; the chat list answers 409
meanwhile), a session name nobody has, a 429 (refused locally for
`Retry-After`, 60 s without), the search provider down. Not shown: muted
and pinned chats and a group's member count (the gateway's chat summary
has none of them).
