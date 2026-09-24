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
| [Blackjack](#blackjack-blackjack) | `blackjack` | view (surface), normal | Deal, stand, or the next hand; declines insurance |
| [Bluetooth](#bluetooth-bluetooth) | `bluetooth` | live, normal | Connect or disconnect |
| [Bookmarks](#bookmarks-bookmarks-bookmarks-history) | `bookmarks` | indexed, primary | Open in the browser |
| [Browser History](#bookmarks-bookmarks-bookmarks-history) | `bookmarks-history` | input | Open in the browser it came from |
| [Browser Tabs](#browser-tabs-browser-tabs-tabs) | `browser-tabs-tabs` | live, primary | Switch to the tab |
| [Calculator](#calculator-calc) | `calc` | input, normal | Copy the result |
| [My Schedule](#calendar-calendar-today-calendar-schedule-calendar-quick-calendarupcoming) | `calendar-schedule` | live, normal | Join the call, else open in Calendar |
| [Today](#calendar-calendar-today-calendar-schedule-calendar-quick-calendarupcoming) | `calendar-today` | live, normal | Join the call, else open in Calendar |
| [Quick Add Event](#calendar-calendar-today-calendar-schedule-calendar-quick-calendarupcoming) | `calendar-quick` | input | Add the typed line as an event |
| [Clipboard](#clipboard-clipboard-rows) | `clipboard-rows` | input, normal | What the row is for: open, call, paste as plain, copy the answer |
| [Clipboard History](#clipboard-history-clipboard-history) | `clipboard-history` | input, normal | Paste into the app in front |
| [Colour Picker](#colors-colors-picker-colors-colors-history-colors-convert) | `colors-picker` | view, normal | |
| [Named Colours](#colors-colors-picker-colors-colors-history-colors-convert) | `colors` | indexed, grid, catalog | Open in Picker |
| [Colour History](#colors-colors-picker-colors-colors-history-colors-convert) | `colors-history` | live, normal | Open in Picker (on the top row: pick from the screen) |
| [Convert Colour](#colors-colors-picker-colors-colors-history-colors-convert) | `colors-convert` | input, normal | Open in Picker |
| [Diff](#diff-diff-diff-pick) | `diff` | view, normal | Copy the unified diff |
| [Diff from History](#diff-diff-diff-pick) | `diff-pick` | input, normal | Pick the side (with two marked: diff them) |
| [Disk Space](#disk-space-space-space-map-space-largest-space-folders-space-cleanup) | `space` | live, normal | Open the map of the root (scans first when there is none) |
| [Disk Map](#disk-space-space-space-map-space-largest-space-folders-space-cleanup) | `space-map` | view, normal | Zoom into the focused folder; open a file |
| [Largest Files](#disk-space-space-space-map-space-largest-space-folders-space-cleanup) | `space-largest` | live, normal | Open the file |
| [Largest Folders](#disk-space-space-space-map-space-largest-space-folders-space-cleanup) | `space-folders` | live, normal | Show in the map |
| [Cleanup Suggestions](#disk-space-space-space-map-space-largest-space-folders-space-cleanup) | `space-cleanup` | live, normal | Show in the map |
| [Docker Containers](#docker-docker-docker-images-docker-compose) | `docker` | live, normal | Stop a running container, start a stopped one |
| [Docker Images](#docker-docker-docker-images-docker-compose) | `docker-images` | live, normal | Run, after a form for the name and ports |
| [Compose Projects](#docker-docker-docker-images-docker-compose) | `docker-compose` | live, normal | Up |
| [Downloads](#downloads-downloads) | `downloads` | live, primary | Open the file |
| [Emoji](#emoji-emoji) | `emoji` | indexed, grid, catalog | Copy emoji |
| [Files](#files-files-files-browse-files-selection-files-recent) | `files` | input, normal | Open the file, browse a folder |
| [Browse Folder](#files-files-files-browse-files-selection-files-recent) | `files-browse` | input, normal | Browse a folder, open a file |
| [Finder Selection](#files-files-files-browse-files-selection-files-recent) | `files-selection` | input, normal | Open the file, browse a folder |
| [Recent Files](#files-files-files-browse-files-selection-files-recent) | `files-recent` | live, primary | Open the file |
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
| [Nerd Font icons](#icons-icons-icons-freedesktop-icons-iconify) | `icons` | indexed, grid, catalog | Copy glyph |
| [Freedesktop icon names](#icons-icons-icons-freedesktop-icons-iconify) | `icons-freedesktop` | indexed, grid, catalog | Copy name |
| [Iconify Icons](#icons-icons-icons-freedesktop-icons-iconify) | `icons-iconify` | input, grid | Copy SVG |
| [Images](#images-images) | `images` | input, normal | Compress |
| [Immich](#immich-immich-immich-albums-immich-people-immich-memories) | `immich` | input, grid | Open the photo in Immich |
| [Immich Albums](#immich-immich-immich-albums-immich-people-immich-memories) | `immich-albums` | indexed, normal | Open the album as a grid |
| [Immich People](#immich-immich-immich-albums-immich-people-immich-memories) | `immich-people` | indexed, normal | The person's photos as a grid |
| [On This Day](#immich-immich-immich-albums-immich-people-immich-memories) | `immich-memories` | live, normal | That year's photos as a grid |
| [Makefile Targets](#makefile-targets-make) | `make` | indexed, normal | Run the target |
| [Maps](#maps-maps) | `maps` | input, normal | Open the place or the route |
| [Now Playing](#now-playing-media) | `media` | live, normal | Play or pause |
| [Menu Bar Items](#menu-bar-items-menu-bar) | `menu-bar` | live, primary | Press the menu item |
| [Minesweeper](#minesweeper-minesweeper) | `minesweeper` | view (surface), normal | Open the cell (around a satisfied number); New game once over |
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
| [Sessions](#sessions-sessions) | `sessions` | live, primary | Focus the session's terminal (an ended one: resume it in a new terminal) |
| [Shell](#shell-shell-shell-history) | `shell` | input, normal | Run the command (in the view: copy the output) |
| [Shell History](#shell-shell-shell-history) | `shell-history` | input, normal | Run the command again |
| [Shortcuts](#shortcuts-shortcuts) | `shortcuts` | indexed, primary | Run the shortcut |
| [Unreads](#slack-slack-unreads-slack-channels-slack-search-slack-status) | `slack-unreads` | live, normal | Open the conversation in Slack |
| [Channels](#slack-slack-unreads-slack-channels-slack-search-slack-status) | `slack-channels` | indexed, catalog | Open in Slack |
| [Search Slack](#slack-slack-unreads-slack-channels-slack-search-slack-status) | `slack-search` | input, normal | Open the message in Slack |
| [Status](#slack-slack-unreads-slack-channels-slack-search-slack-status) | `slack-status` | live, normal | Set it |
| [Snippets](#snippets-snippets) | `snippets` | indexed, primary | Paste into the app in front |
| [Solitaire](#solitaire-solitaire) | `solitaire` | view (surface), normal | Draw (in the page, Enter picks up or drops the cards; twice on one card, sends it where it goes) |
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
| [Turkish](#turkish-turkish) | `turkish` | input, normal | Paste the converted text (over the selection it came from) |
| [Unicode Characters](#unicode-characters-unicode) | `unicode` | indexed, grid, catalog | Copy character |
| [Chats](#whatsapp-whatsapp-chats-whatsapp-unread-whatsapp-search-whatsapp-contacts-whatsappunread) | `whatsapp-chats` | live, primary | Open the chat (a group opens WhatsApp at the top) |
| [Unread](#whatsapp-whatsapp-chats-whatsapp-unread-whatsapp-search-whatsapp-contacts-whatsappunread) | `whatsapp-unread` | live, normal | Open the chat |
| [Search WhatsApp](#whatsapp-whatsapp-chats-whatsapp-unread-whatsapp-search-whatsapp-contacts-whatsappunread) | `whatsapp-search` | input, normal | Open the chat |
| [Contacts](#whatsapp-whatsapp-chats-whatsapp-unread-whatsapp-search-whatsapp-contacts-whatsappunread) | `whatsapp-contacts` | indexed, catalog | Open a chat with the contact |
| [Wi-Fi](#wi-fi-wifi) | `wifi` | live, normal | Join, scan, or turn the radio off or on |
| [Window Management](#window-management-window-management-window-management-arrange) | `window-management` | indexed, normal | Apply to the focused window |
| [Arrange Window](#window-management-window-management-window-management-arrange) | `window-management-arrange` | input, normal | Pick the window, then its layout |
| [Windows](#windows-windows-windows-spaces) | `windows` | live, primary | Focus the window |
| [Spaces](#windows-windows-windows-spaces) | `windows-spaces` | live, normal | Bring the space in front |
| [Wordle](#wordle-wordle) | `wordle` | view, normal | Submit the guess |
| [Yahtzee](#yahtzee-yahtzee) | `yahtzee` | view (surface), normal | Hold the die, or score the category under the cursor; the first roll of a round |
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

A hand of blackjack on a felt table. Enter on the palette's row (or its
hotkey) opens the table as a view level: a `surface`, the extension's own
page, with the Kenney deck dealt from a shoe in the corner. The title line
shows the phase ("Place your bet", "Your turn", "Dealer busts"), the
footer the primary move, and ⌘K lists every legal move with its key.

- Betting: `↑` / `+` and `↓` / `-` move the bet by the minimum (or click
  the chips), Enter deals: player, dealer, player, then the hole card face
  down.
- Playing: `↑` or `H` hit, `↓` or `S` stand, `→` or `D` double down (first
  two cards, one card then stand), `←` or `P` split (a pair, once; split
  aces take one card each; the hands slide apart). Enter stands too. Totals
  show on a badge over each hand ("Soft 17"); on stand the hole card turns
  over and the dealer draws to 17.
- Settled: the result and the net for the hand; a win glows, a bust
  shakes, a blackjack gets its own flourish, and the chips go to the
  dealer or come back with the winnings. Enter for the next hand. `N`
  starts a new game (asks first) with a fresh bankroll and record.
- Every move is a button on the rail under the felt too, with its keys on
  it; the arrows and Enter play a whole hand one-handed.
- Escape leaves at any point; the hand, the bankroll and the record persist
  (in the extension's storage), so the table is as you left it next time.

Rules: dealer stands on 17 (soft 17 too unless `dealer_hits_soft_17`),
blackjack pays 3:2, a dealer blackjack is checked at once, doubling after a
split is allowed, no surrender. The shoe is `decks` decks and is
reshuffled before a deal once under a quarter of it is left (the bar on
the shoe). Insurance is offered on an ace only with `insurance = true`
(`↑` or `i` takes it; `↓` or Enter declines), costs half the bet and pays
2:1.

The page plays with the extension's own rules (`game.ts`, the file the
host tests), so the table and the tests cannot disagree; the surface node
it rides on is in [Extensions](extensions.md).

```toml
[extensions.blackjack]
decks = 6                     # 1..8
starting_bankroll = 1000
min_bet = 10                  # also the step for + and -
dealer_hits_soft_17 = false
insurance = false
```

## Bookmarks (`bookmarks`, `bookmarks-history`)

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
  favicon. A bookmark saved without a name (Chrome's bar keeps those) is
  named by its bare address (`calendar.google.com`) and says nothing
  twice under it.
- Actions: **Open in browser** (`Enter`), **Copy link** (`⌘C`), **Copy as
  markdown** (`⌘⇧C`, `[name](url)`), and on a browser row **Open in
  Chrome/Safari/...** (`open -a` on macOS, the browser's binary on Linux).
- Safari's file needs Full Disk Access: without it the Safari section is
  one inert row saying so (System Settings > Privacy & Security > Full
  Disk Access, add pal).

Settings, `[extensions.bookmarks]`, in addition to `file`:

| key | type | default | what |
| --- | --- | --- | --- |
| `browsers` | list | `["chrome", "brave", "edge", "chromium", "vivaldi", "arc", "safari", "firefox"]` | Whose bookmarks and history to list, in order. A browser with no profile on the machine lists nothing. `[]` is the file alone, and no history. |
| `exclude_folders` | list | `[]` | Bookmark folders skipped, by name (`Archive`) or a short path (`Bookmarks Bar/Old`), case-insensitive. |

Settings, `[extensions.bookmarks]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `file` | path | `~/.config/pal/data/bookmarks.json` | The bookmarks file. `~` is expanded. |

### Browser History (`bookmarks-history`)

A second palette of the extension, input rather than indexed: every
keystroke searches the visit history the same browsers keep (the
`browsers` setting; Safari's `History.db` is behind Full Disk Access and
is not read), by title and address, newest first, fifty rows at most, a
url once. Chrome, Brave, Edge, Chromium, Vivaldi and Arc are every
profile's `History` (SQLite, the `urls` table; Chrome's clock counts
microseconds from 1601), Firefox every profile's `places.sqlite`
(`moz_places`, microseconds from 1970). A running browser holds its file
locked, so each is copied under pal's cache (`~/Library/Caches/pal/bookmarks`,
`~/.cache/pal/bookmarks` on Linux) before it is read; the copy is taken
again when the file's mtime moved, at most every 30 seconds, so a
keystroke never copies a large history twice. Hidden entries (a redirect
Chrome keeps for autocomplete) and pages never visited are left out; no
browser with a history is one inert row saying which are read.

- The row: the page's title (the address when it has none), the address
  under it and as the favicon's source, when it was last visited on the
  right, the browser and profile as the section (`Chrome (Work)`).
- Actions: **Open in Chrome/Firefox/...** (`Enter`, the browser it came
  from: `open -a` on macOS, the browser's binary on Linux), **Copy link**
  (`⌘C`), **Open in default browser** (`⌘O`).

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
| thousands | `210k / 12`, `2k + 500`, `1.5m usd to try` | `17,500`, `2,500`, `72,960,395.18 TRY`; `k` is thousands anywhere, `m` and `b` millions and billions before a currency, since a bare `5m` is metres |
| home currency | `12 usd`, `$12`, `100 try` | to `home_currency` (`12 USD to TRY`); the home currency itself goes to USD |
| variables | `salary_month`, `salary_month to eur`, `rent / salary_month`, `height to ft` (with `vars` below) | `455,272.87 TRY` (+ a `9,360.00 USD` row), `8,111.62 EUR`, `0.09225236807` with `9.225%`, `6.00394 ft`; the subtitle is the query with each name as its value (`42,000.00 TRY / 9,360.00 USD`) |
| how many fit | `1500 usd in salary_hour`, `1500 usd in salary` (a prefix), `5 km in lap` | `27.78 salary_hour`; one row per `salary_*` (`27.78 hour`, `3.472 day`, `0.1603 month`), largest count first; `100 pool`, `12.5 track` |
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
| `vars` | list | `[]` | Variables, one `name = value` per line (`salary_hour = 54 usd`, `salary_month = salary_hour * 2080 / 12`, `rent = 42000 try`). A query naming one is expanded before it is read, so a value is anything calc reads and may use other variables; currencies in it are converted into the first one's terms, so money stays money and a ratio of two amounts is a number. Decimals with a dot whatever the locale; a name spelled like a currency is ignored. At the root a query naming a variable answers inline without a digit. `X in <name>` divides by it and says how many fit; a name that is the prefix of several (`salary` for `salary_hour`, `salary_day`) answers per member. |

## Clipboard History (`clipboard-history`)

What you copied, searchable, with images. Text, images and file lists are
recorded by a watcher that runs while pal runs; the search is SQLite
full-text search over the text, ordered pinned first, then newest. The
palette opens with the detail pane showing: the full text (fenced), the
image, or the file list, with kind, size, source app and time as metadata.
A row that is a single url gets the site's favicon; the source app and the
time are accessories, and a pinned entry carries a `pinned` tag. An entry
you have named (`⌘⇧R`) is titled by its name from then on, with the text's
preview as its subtitle, and a search finds it by the name as well as by
the text (the name is matched as a substring, the text by prefix words).

Actions:

| action | shortcut | what |
| --- | --- | --- |
| Paste | `Enter` | hides the panel and pastes the entry into the app that was in front |
| Copy | `⌘Enter` | puts the entry back on the clipboard |
| Copy text from image | `⌘⇧T` | on an image entry: the text in it read by OCR (the Vision framework on macOS, `tesseract` on Linux when installed) goes on the clipboard as a copy of its own, "Copied text" in the HUD; an image with no text is a toast |
| Edit… | `⌘E` | on a text entry: a form with the text in a textarea; the submit copies the edited text, so it is the newest entry and the original stays as recorded; a box pastes it into the app in front as well |
| Pin / Unpin | `⌘P` | pinned entries sort first and never expire |
| Name… / Rename… | `⌘⇧R` | a one-field form: the name titles the row and is searched like the text; empty clears it |
| Save as file… | `⌘S` | a form with a folder (the Desktop by default, `~` expanded, created when missing) and a name taken from the entry (the text's first words `.txt`, `Image 640x480.png`, `paths.txt`); the text as it is, an image's PNG copied, a file list as its paths one per line; a name already there is refused with the form again |
| Save as snippet | `⌘⇧S` | on a text entry: the Snippets palette's create form, pre-filled with the text |
| Show as QR code | `⌘⇧K` | on a text entry up to 2000 characters: the code large in a level with the text under it |
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
copies over 10 MB, and copies made while an app in the feature's
`exclude_apps` is in front. Copying something already in history bumps it to the top instead
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
- The detail pane's metadata leads with the entry's name when it has one.
  Names live in the history database next to the entry (`name` column,
  added on the first open of an older database), so they survive a
  restart and go with the entry when it is deleted.

Settings, `[extensions.clipboard]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `primary_action` | `paste`, `copy` | `"paste"` | What `Enter` does on an entry. |
| `ocr_concealed` | bool | `false` | Text read from an image (Copy text from image) is copied concealed, so it never enters this history. |

What is recorded and for how long (`exclude_apps`, `max_entries`,
`max_age_days`) is the Clipboard history feature's, `[features.clipboard]`
([Features](features.md#clipboard-history)).

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
- Your words: the `keywords` setting adds search words per emoji
  (`rocket: ship deploy`), so a team's own names find them.

Settings, `[extensions.emoji]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `skin_tone` | `none`, `light`, `medium-light`, `medium`, `medium-dark`, `dark` | `"none"` | The Fitzpatrick modifier applied where an emoji takes one. |
| `paste_by_default` | bool | `false` | `Enter` pastes into the app in front (needs Accessibility on macOS), `⌘Enter` copies. |
| `keywords` | list of lines | `[]` | Your own search words: `rocket: ship deploy`, `🎉: party, woo` (a shortcode or the emoji, a colon, the words, split on spaces and commas). A line naming no emoji is ignored; the words join the emoji's own for search, parsed once per settings change. |

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
the filled url (⌘C copies it). `{selection}` and `{clipboard}` in a url
are filled without asking (the SDK's placeholders, [Snippets](#snippets-snippets)
below has the grammar; each value percent-encoded), so
`https://translate.google.com/?text={selection}` opens in one Enter. The
row shows the placeholder as a tag, the browser it opens with when one
is named, and the url as its subtitle; the icon is the site's favicon.

The root row **Create Quicklink** opens a form (name, url, keywords, and
**Open with**: the default browser or one of the browsers installed:
Safari, Chrome, Firefox, Arc, Brave, Edge, Chromium, Vivaldi, Zen; `open
-a` on macOS, the command on Linux; a `mailto:` or an app's scheme goes to
the system opener whatever the field says). The url and the name come
filled from the tab in front when [Browser Tabs](#browser-tabs-browser-tabs-tabs)
can name one within 400 ms (a DevTools port, a scriptable browser); an
extension can push the palette with `args: { create: { name, url,
keywords } }` and the form comes filled with that. **Edit** (⌘E) opens
the same form filled in, and a url the opener could not take (no scheme,
not a path) is refused with the message under the field. **Delete** (⌃X)
asks first. Keywords are extra words the search matches, space or comma
separated.

**Browse Library** (the row after Create) is a level of 25 ready-made
searches (Google, DuckDuckGo, Bing, Wikipedia, YouTube, GitHub, GitHub
code, npm, crates.io, PyPI, MDN, Stack Overflow, Amazon, Google Maps,
Google Translate, X, Reddit, Hacker News, IMDb, Spotify, Unsplash, Can I
use, Rust docs, Homebrew, Apple Developer): Enter adds one to your links
(once; the ones you have are tagged `added`), ⌘Enter searches with it
without adding (the same drill-in), ⌘C copies its url.

| action | shortcut | what |
| --- | --- | --- |
| Open | `Enter` | opens the url (in the named browser, or a tab already on the page with `prefer_existing_tab`), or drills in to fill its `{query}` |
| Copy URL | `⌘C` | copies the url as stored |
| Edit | `⌘E` | the form, filled in |
| Delete | `⌃X` | removes it, after a confirm |
| Add to my quicklinks | `Enter` | in the library: the search saved to your links |
| Search with it | `⌘Enter` | in the library: the drill-in, without saving |

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
| `prefer_existing_tab` | boolean | `false` | Opening a link first asks the browsers (as Browser Tabs does) for a tab already on that page (origin and path; query and fragment aside) and switches to it, the front one first; a new tab when none has it. |

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
| `{snippet name=sig}` | another snippet's text, by name or keyword, its own placeholders filled; one level deep (a `{snippet}` inside it stays as written) |
| `{cursor}` | where the caret lands after an expansion (below); dropped by a paste from the panel |

`{date}`, `{time}` and `{datetime}` take two attributes. `format=` writes
the moment with the tokens `YYYY` `YY` `MM` `DD` `HH` `mm` `ss` `ddd`
(Wed) `MMM` (Sep), anything else in the format as it is: `{date
format=DD.MM.YYYY}`, `{time format=HH:mm:ss}`, quotes around a format
with spaces (`{date format="ddd D MMM"}`). `offset=` moves the moment
first by a signed count of days, weeks, hours or minutes: `{date
offset=+1d}`, `{date offset=-2w}`, `{time offset=+3h}`, `{datetime
offset=-90m format=HH:mm}`.

Anything else in braces is left as it is, so a snippet of code keeps its
braces. A snippet with placeholders carries a "dynamic" accessory. The
grammar is the SDK's (`expand` in `@zcag/pal`, [Extensions](extensions.md#the-zcagpal-package)),
the same one quicklinks fill a url with and Obsidian an appended line.
An expansion by keyword (below) fills the plain forms only: `format=`,
`offset=` and `{snippet}` are left as written there.

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

On macOS a snippet's keyword typed in any other app can be replaced by its
text in place: that is the Text expansion feature's, which keeps the
snippets this palette edits ([Features](features.md#text-expansion)). A
snippet saved here expands on the next keystroke. Linux has no expansion
(no portable keyboard tap); the palette's Enter is the way to paste a
snippet there, and `pal://snippets/paste?name=sig` binds one to a
compositor key.

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

## Files (`files`, `files-browse`, `files-selection`, `files-recent`)

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
path, size, modified time and kind, then on macOS what Spotlight knows of
the file (one `mdls` call, only when the pane asks): an image's pixel
size and its Finder tags (the names; the colour index is dropped). On
Linux a PNG's size comes off its header. For a text file under 64 KB the
first 40 lines follow in a code block. No image preview: the app's
`icon://` scheme serves app icons, favicons and clipboard images only.

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
| Open in Terminal | `⌘T` | a terminal window in the folder (a file's folder): the app the `terminal` setting names, through the Shell extension's table (Terminal and iTerm over AppleScript; kitty, Alacritty, WezTerm, Ghostty by their flags; Linux `$TERMINAL` or the first installed) |
| Rename… | `⌘⇧R` | a form with the name; the same folder, a slash or a taken name refused with the message under the field |
| Move to… | `⌘M` | a form with the folder (`~` expanded, made when missing); across volumes `mv` does it |
| Copy to… | `⌘⌥C` | the same form; a copy under the same name (a folder whole), an existing name refused |
| Compress | `⌘⇧Z` | a zip next to the file named after it (`report.zip`, `report-2.zip` when taken); with rows marked, one zip of them all named after the first. `ditto -c -k --sequesterRsrc --keepParent` on macOS, `zip -r` on Linux |
| Move to Trash | `⌘D` | asks first; Finder's delete on macOS, `gio trash` on Linux; the palette stays open with a toast |
| Use in TextEdit's open panel | `⌘G` | only while the app in front has an Open or Save panel up: pal hides and types the path into it through its Go to Folder sheet (`ctrl+L` on a GTK chooser); listed first then, and the empty root leads with a "Dialog" hint into Files |

Marked rows (`Tab` here, `x` while nothing is typed, `⇧↓`, `⌘`-click): Open,
Reveal, Quick Look (one panel, arrows between them), Copy path (the paths
one per line), Copy file, Compress (one archive) and Move to Trash run
over all of them as one pick; Open with…, the terminal and the three
forms stay one file's.

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

### The Finder selection

Open pal over a Finder window (or the Desktop) with files marked and the
empty root leads with a **Selected in Finder** section, nothing typed:
each marked item as a file row with every action above, pictures with
their thumbnails; with two or more, an **N items** row first (the names,
the total size) whose actions run on all of them at once: Open all,
Reveal all, Quick Look all, Copy paths, Copy files, Compress together,
Move all to Trash (asks first), and whose `Enter` opens the palette with
the whole selection. The root shows four item rows at most.

**Finder Selection** (`files-selection`) is the same as a palette of its
own, for a hotkey or `pal open files/selection`: the N items row, then
every marked item, typing filters them by name, marks and the multi
actions work as anywhere. With nothing to list it says why: "Nothing is
selected in Finder" with Finder in front, "Finder is not in front"
otherwise (the `front_app` state), "Not available on Linux" there, since
no file manager exposes its selection.

The selection is the core's `selection.files()` (Finder's `selection`
over `osascript`, only while Finder is the app in front; ~190 ms, read
once per panel show and cached), so it is what was marked when the panel
came up: a folder shown with nothing marked is nothing, not the folder,
and a selected dot file is listed whatever `show_hidden` says. The
Images palette reads the same selection for its inputs, and `{files}` in
a snippet or a quicklink fills in the paths.

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
- **Quick Look** (`⌘Y`) on macOS opens the file in `qlmanage -p` (every
  marked row in one panel). The System palette's "Quick Look Finder
  Selection" row does the same for what is marked in Finder without
  listing it first.

Settings, `[extensions.files]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `folders` | list of paths | `["~"]` | Where to search. `~` is expanded. |
| `limit` | number, 1 to 500 | `50` | At most this many rows per query. |
| `show_hidden` | bool | `false` | List files and folders whose name starts with a dot (below the configured folder; `~/.config` as a folder is fine either way). |
| `exclude` | list of names | `["node_modules", ".cache", "Library/Caches", "target"]` | Folders skipped below the search folders, by name or a short path. |
| `content_search` | bool | `true` | The "In files" section under the name matches. Off, only the `'` prefix searches contents. |
| `ocr_concealed` | bool | `false` | Text read from an image (Copy text) is copied concealed, so it never enters the clipboard history. |
| `terminal` | string | `""` | What Open in Terminal opens: `Terminal` (the default), `iTerm`, `kitty`, `Alacritty`, `WezTerm`, `Ghostty`, or any app name (`open -na <name> --args -e ...`); on Linux a command name, else `$TERMINAL`, else the first installed terminal (the same words as Shell's setting). |

The rename, move and copy forms and the archive command are the SDK's
`files` (`sdk/src/files.ts`); Downloads uses them too, so the two palettes
rename and move the same way.

## System (`system`)

Sleep, lock, log out, restart, shut down, empty the trash, dark mode,
volume, brightness, do not disturb, eject, show desktop, keep awake (for a
while, until a time, or while an app runs, with a countdown on the bar),
quit or unhide every app, dismiss notifications. The rows are indexed, so
`mute` or `sleep` at the root finds them (each carries keywords:
`suspend`, `power off`, `bin`); live because the Keep Awake row reads
Allow Sleep with the time left while a run is on, and a live palette lists
again on every show. pal hides the panel before running a command, so it
lands on the desktop, not on pal.

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
| Keep Awake / Allow Sleep | `caffeinate -i` (`-di` with the display), `-t` for the deadline, `-w` to follow an app; below | `systemd-inhibit --what=sleep` (`idle:sleep` with the display) around `sleep <secs>`, `tail --pid` or `timeout`; a hint row without `systemd-inhibit` |
| Quit All Apps | System Events: every regular app but Finder and pal asked to quit, one by one, so an app with unsaved work still shows its sheet | not available |
| Unhide All Apps | System Events: every hidden app made visible | not available |
| Dismiss Notifications | Notification Center over Accessibility: the Clear All (else Close) action of every notification group; nothing on screen is nothing to do | `swaync-client --close-all`, `makoctl dismiss --all` or `dunstctl close-all`; hidden with none |
| Quick Look Finder Selection | the Quick Look panel (`qlmanage -p`) over what is marked in Finder (the core's `selection.files()`, read once per show): the names as the subtitle, the count on the right; while nothing is marked, or Finder is not in front, the row is inert and its subtitle says which | not available |

Log Out, Restart, Shut Down, Empty Trash and Quit All Apps are destructive: with
`confirm_destructive` on, `Enter` asks "(command) now?" first. A command
that fails keeps the panel open with a toast carrying the tool's message.

**Link**: `pal://system/run?id=<command>` runs one by its id (`sleep`,
`lock`, `logout`, `restart`, `shutdown`, `empty-trash`, `dark-mode`,
`volume-up`, `volume-down`, `volume-mute`, `brightness-up`,
`brightness-down`, `dnd`, `eject-all`, `show-desktop`, `keep-awake` (the
toggle), `quit-all`, `unhide-all`, `dismiss-notifications`, and on macOS
`quick-look-selection`, the one for a Quick Look hotkey: the HUD says
"nothing is selected in Finder" when there is nothing to show); the route
is declared with `confirm`, so a link always asks first
([Links](links.md#extension-routes)). `pal://system/awake?for=1h&display=1`
is Keep Awake's own (below).

### Keep Awake

The row takes how long in the bar (`Item.args`): `45m`, `2h`, `1h30m`, a
bare number of minutes, a clock time (`14:30`, `2pm`, `until 14:30`;
tomorrow's when today's has passed), or `forever`; blank runs
`awake_default` (an hour). A second field says whether the display stays
up too (`awake_display` preselected). `Enter` starts it, the panel hides
and the HUD says what it did (`Awake for 45 min`, `Awake until 14:30`,
`Awake until turned off`); `cmd+enter` keeps awake until turned off;
`cmd+u` opens a form with the same spelling, the display switch and an
app to follow (one with a window open: the run ends when it quits,
`caffeinate -w`). While a run is on the row reads **Allow Sleep** with the
time left as a tag: `Enter` ends it (`Sleep allowed`), `Keep awake for…`
takes the bar's fields for a new span, `cmd+d` flips the display; the
row sits in the empty root's Now section meanwhile. A spelling that is
neither a duration nor a time is a failure toast (under the field, in
the form).

`caffeinate` does the timing itself (`-t <secs>`), so a run ends on time
whether or not pal is up. pal keeps one record of the run (pid, until,
display, app) in its storage and checks it against the live process on
every read (the pid alive, its command line `caffeinate`'s, the deadline
not passed); the child is not killed with the host, so a restarted pal
finds the same run back, and a record whose process is gone (or is
something else after a reboot) is dropped silently. A run that ends while
pal watches says so in the HUD (`Keep awake ended, sleep allowed`).

**Bar item `system/awake`**: a coffee glyph and the countdown (`2h 40m`,
`12m`, `45s`; `∞` without an end), a monitor mark after it when the
display is kept awake too, amber in the last five minutes (the `ending`
rule, over `system.awake_left`); hidden while off, and
`[bar.items."system/awake"] show = "always"` keeps a muted coffee whose
click still opens the popover. The popover: the run on a card (what it is,
since when, the time left large, a bar), the presets (the item's `presets` setting) as
tiles on the digits `1`..`5` (a new end from now, on or off), the display
switch on `d` (a run is restarted with the other flag; off, it is the next
run's), `u` a field for a spelling, `Enter` allows sleep while on and
starts the default while off, `backspace` allows sleep, `o` the System
palette. The ticks are pal's own: a push when the countdown's text next
changes (every minute; every second under one, or while the popover is
up). States published: `system/awake`, `system/awake_until` (unix ms,
null without an end), `system/awake_left` (minutes, rounded up),
`system/awake_display`.

**Link**: `pal://system/awake?for=1h&display=1` (`until=14:30`,
`app=Xcode`, `off=1`; bare toggles: the default duration, or off while
on); `pal call system/awake for=2h` from a shell.

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
| `confirm_destructive` | bool | `true` | Confirm before logging out, restarting, shutting down, emptying the trash or quitting every app. |
| `awake_default` | string | `"1h"` | What a bare Keep Awake runs for: a duration, a clock time, or `forever`. |
| `awake_display` | bool | `true` | Keep the display awake too (`caffeinate -d`); off, the display may sleep while the machine stays up. The row's field and the popover's switch override it per run. |

`awake` item settings, `[bar.items."system/awake".settings]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `presets` | list of strings | `["30m", "1h", "2h", "forever"]` | The popover's tiles and digit keys, five at most. |

## Windows (`windows`, `windows-spaces`)

Every open window with its app's icon, most recently used first on macOS
and Hyprland (front to back on Sway and X11), never ranked by how often
it was picked: row 1 is the window you came from, row 2 the one before
it. Hyprland keeps that history; on macOS pal does, stamped on every app
activation, when the panel shows, and by Focus, so a focus change inside
one app shows up on the next activation. A live palette: the list runs on
every show, so window titles are root results. The app name is the
subtitle; the bundle id or window class is a keyword; a hidden app's
window carries a `hidden` tag, a minimised one `minimized`, one on another
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
  window's process), **Show app** in its place on a hidden app's window
  (`⌘⇧H`, macOS: the app comes forward with every window it had, and the
  panel hides), and on an app with more than one window **Minimize all of
  this app** (`⌘⇧M`) and **Close all of this app** (`⌘⇧W`, asks first).

### Spaces

**Spaces** (`windows-spaces`) is the same capability one level up: a row
per Space (macOS), workspace (Hyprland, Sway) or desktop (X11) in the
order the desktop shows them, the apps on it as the subtitle (most
recently used first, each once), the icon of the window used there last
(a monitor glyph when nothing is open there), a `current` tag on the one
in front and `previous` on the one left most recently, and the display
when there is more than one. A full-screen app's space (macOS) is a row
named by the app. The last row, **Previous space**, goes back to the one
left most recently: a switch by pal or a swipe, pal watches the Space
change either way.

`Enter` brings the space in front: the panel hides first. macOS has no
public call to switch Spaces, so pal does what yabai does with SIP on: a
synthesised Dock swipe at a velocity no finger reaches, one step per
space between along that display's strip, which moves the strip without
the slide (instant), and then raises the window used there last (the
focus history, else the biggest, never a hidden app's) so the space comes
up with it in front. Posting the swipe needs the Accessibility permission
like paste (the HUD says so when it is missing). Linux asks the
compositor (`hyprctl dispatch workspace`, `swaymsg workspace`,
`wmctrl -s`).

Names: `spaces = ["web", "term", "misc"]` names the desktops by number
(the first entry is Desktop 1). A named space's row is titled by it, the
Windows rows say `ws term` instead of `ws 2`, and its row id is the name,
which is what a global hotkey keys on:

```toml
[extensions.windows]
spaces = ["web", "term", "misc"]
back_and_forth = true
toggle = ["web", "term"]

[palettes.windows-spaces.item_hotkeys]
web = "ctrl+1"
term = "ctrl+2"
misc = "ctrl+3"
toggle = "ctrl+f"
```

An unnamed desktop's id is its number (`"4"`); `last` is Previous space.
With `back_and_forth` on (Hyprland's `workspace_back_and_forth`), a
space's key pressed while on that space goes to the previous one, so one
key toggles between a space and where you came from; `Enter` on the
current space's row does the same. `toggle = ["web", "term"]` adds a
**Toggle** row (`toggle`) that flips between those two: on the first it
goes to the second, anywhere else to the first, so `toggle = "ctrl+f"`
in the hotkeys block is a fixed ping-pong between two spaces however you
got where you are. `pal run windows/spaces/term` from a script or a
compositor keybind is the same pick.

Settings, `[extensions.windows]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `include_minimized` | bool | `true` | List minimised windows too (focusing one restores it). |
| `spaces` | list of strings | `[]` | Names for the desktops by number: the row titles, the `ws` accessory, and the row ids `item_hotkeys` key on. |
| `back_and_forth` | bool | `false` | A space's hotkey pressed while on it goes to the previous space. |
| `toggle` | list of two strings | `[]` | Two space names (or numbers) the Toggle row flips between. |

The switcher ([Keyboard](keyboard.md#switcher)): the manifest suggests
`hold = "alt+tab"` for this palette, so holding Alt and pressing Tab
shows the windows flat with the cursor on row 2, Tab again steps down,
Shift+Tab up, and letting go of Alt focuses the row under the cursor;
typing filters meanwhile, Escape cancels. `[palettes.windows] hold = ""`
turns it off, another chord moves it; on Linux a compositor keybind runs
[`pal switch`](cli.md#pal-switch) instead.

## Window Management (`window-management`, `window-management-arrange`)

Move and resize windows from the keyboard, Raycast's set: one row per
layout (halves, thirds, quarters, the maximize family, larger and smaller,
a size typed in, a nudge by a step, the other display, fullscreen,
minimize, restore),
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
| Resize to… | `resize` | a form: a size (`1280x720`, or one number for a square) and, optionally, X and Y; blank keeps the window centred on its current centre, and the size is capped to its screen |
| Move Left, Right, Up, Down | `move_left` `move_right` `move_up` `move_down` | nudged by `step` pixels |
| Next Display, Previous Display | `next_display` `previous_display` | the same place on the other display |
| Toggle Fullscreen, Minimize, Unminimize | `fullscreen` `minimize` `unminimize` | window state, not a frame (below) |
| Restore | `restore` | the frame the window had before the run of layouts |

These ids are what `item_hotkeys` (below) and the
`pal://window-management/layout?name=<id>` route take
([Links](links.md#extension-routes)).

### What it does not do

No custom layouts: the thirty-one layouts above plus the Resize to… form
are the set; `gap`, `step`, `cycle` and the two percentages are the
knobs. Larger and Smaller are a fixed 10%. Resize to… is a form, not a
link: `pal://window-management/layout` takes the layout ids only.

"The screen" is the display the window's centre is on (the one it overlaps
most when the centre is off every display), minus the menu bar, Dock, or
bars, minus `gap` on every side; the halves, thirds and quarters are equal
cells with `gap` between them. Restore remembers, per window and in memory
until pal quits, the frame a window had before a run of layouts started: a
run is any sequence of pal layouts, and moving the window by hand in
between starts a new one, so Restore goes back to where you had put it.

With `cycle` on (a setting, off by default), a half applied to a window
already at that half steps to the next size of its family, Rectangle's
way: Left Half, then Left Two Thirds, then Left Third, then the half
again (the right family likewise; the top and bottom halves have none).
The HUD names the size the window landed on, and Restore still goes
back to where the run started.

Actions:

| action | shortcut | what |
| --- | --- | --- |
| Apply | `Enter` | the layout on the focused window |
| Apply to… | `⌘Enter` | pick a window from the open ones (the Arrange Window palette), then the layout goes on that one |
| Resize | `Enter` in the Resize to… form | the size (and place) typed goes on the window; the panel hides and the HUD says "Resized to 1280x720" |

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

Coming from Rectangle, its default keys as one block, with `cycle` on so
a half pressed again steps through the thirds as it does there:

```toml
[extensions.window-management]
cycle = true

[palettes.window-management.item_hotkeys]
left_half = "ctrl+alt+left"
right_half = "ctrl+alt+right"
top_half = "ctrl+alt+up"
bottom_half = "ctrl+alt+down"
top_left_quarter = "ctrl+alt+u"
top_right_quarter = "ctrl+alt+i"
bottom_left_quarter = "ctrl+alt+j"
bottom_right_quarter = "ctrl+alt+k"
left_third = "ctrl+alt+d"
center_third = "ctrl+alt+f"
right_third = "ctrl+alt+g"
left_two_thirds = "ctrl+alt+e"
right_two_thirds = "ctrl+alt+t"
maximize = "ctrl+alt+enter"
center = "ctrl+alt+c"
restore = "ctrl+alt+backspace"
larger = "ctrl+alt+="
smaller = "ctrl+alt+-"
next_display = "ctrl+alt+cmd+right"
previous_display = "ctrl+alt+cmd+left"
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
| `cycle` | bool | `false` | A half applied to a window already at that half steps to the next size of its family (two thirds, a third, the half again). |

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
what and where to fix it (Settings › Extensions › Home Assistant): no URL, a
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
its popover has every unread thread (it scrolls), Open all (this palette)
and Mark all read.

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
`repo:owner/name`, `is:pr`, `author:login`, `label:bug`. Results come
nearest first, each once: **Involved** (`involves:@me`: you opened it, are
assigned, were mentioned or commented), **Your organisations** (your
account and every organisation you belong to), Repositories (yours
first), **Everywhere**, Users. A query naming its own `repo:`, `org:` or
`user:` skips the organisations tier, and its remaining matches are
**Other matches**. Your pull requests and issues already cached by the
two palettes above are also matched loosely against the query, so a typo
GitHub's word search misses (`directry`) still finds them under Involved.
Each tier is its own request, sent together, so a search takes about as
long as GitHub's slowest (about 2 s), and the search row's sweep runs
until it lands. A pull request found this way comes without the fields
GitHub computes per result (checks, review decision, conflicts, size,
which tripled the wait); one that is also in your cached lists shows
that copy, tags and all, and the pane fetches the checks by name. Filters Everything, Issues and PRs,
Repositories, Users; a query carrying `is:`, `repo:`, `author:` or the
like searches issues and pull requests only. The rows and actions are the
palettes' above; users show their avatar and open their profile. A
keystroke waits 300 ms for the next before asking. Give it an alias
(`[palettes.github-search] alias = "gs"`) and `gs <text>` at the root
lands in it with the text typed.

Settings, `[extensions.github]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `token` | secret | (none) | A personal access token; empty means the gh CLI's login. |
| `default_org` | text | (none) | The organisation whose recently pushed repositories are listed, and an owner the Create Repository form offers. |
| `repos_root` | path | (none) | Where your clones live; enables Checkout branch and Open in editor. `~` is expanded. |
| `clone_protocol` | `ssh` / `https` | `ssh` | What Copy clone URL copies. |
| `merged_days` | number (days) | `7` | How far back the Merged list reaches. |
| `merge_method` | `merge` / `squash` / `rebase` | `merge` | How the Merge action merges. |

`prs` item settings, `[bar.items."github/prs".settings]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `review_requests` | boolean | `false` | Count the reviews asked of you on the Pull requests strip; off, the strip is your own pull requests and a review sits in the popover alone. |

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

No extension settings. `volume` item settings, `[bar.items."audio/volume".settings]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `level` | select | `flash` | where the bar's percentage lives: `flash` for three seconds after a change, `always`, or `never` |

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

No extension settings. `battery` item settings, `[bar.items."bluetooth/battery".settings]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `low_threshold` | number (%) | `25` | a connected device at or below this level counts as low: named on the bar item, and its rules show the item |

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
  to ask) and only once macOS lets pal automate it: the first Apple Event
  to an app is the system's Automation consent alert (Music adds its
  Media Library one), and pal never fires that from a listing or at
  launch. Until you allow it the app's track shows on the system-wide row
  below, and the palette has a row "Spotify is running; let pal control
  it directly" whose Enter lets macOS ask; refused in System Settings >
  Privacy & Security > Automation stays refused. Spotify's own row gives
  the artwork url and the track url. The system-wide
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

Settings, `[extensions.media]`:

| setting | default | what |
| --- | --- | --- |
| Leave to another extension (`exclude`) | empty | players this extension leaves to another, by app name or player id (`Spotify`, `music`): the bar item and the root's Now row skip them; the palette still lists them |

`now-playing` item settings, `[bar.items."media/now-playing".settings]`:

| setting | default | what |
| --- | --- | --- |
| Cover on the bar (`artwork`) | off | the cover instead of the note on the menu bar strip, only when the cover is square (a 24 pt picture of anything else is a smudge); the popover shows the cover either way |

## Displays (`displays`, `displays/brightness`)

Every display with its mode and brightness, from `extensions/displays/`.
One row per display: its name (the Displays pane's, "Built-in Liquid
Retina XDR Display", "DELL U2720Q"), the mode it is in as the subtitle
(`2560×1440 @ 60 Hz · HiDPI`, the rotation, the connection), `main` and
`mirror` / `mirrored` tags, and the brightness as the accessory where
something can read it. The typed argument on the row takes a percent or
a step (`40`, `+10`) for `⌘B`. Enter drills into the display:

- **Brightness**, **Contrast**, **Volume** (the last two over DDC, on an
  external monitor; Volume only when the monitor answers for it): a
  slider view. `←` `→` move by the step setting, `⇧←` `⇧→` by 1 %, `1`…`9`
  are 10…90 %, `0` is 100 %, `m` full, a click on the slider sets the
  clicked fraction. The built-in panel never goes below 5 % from here,
  so the screen stays readable. From the row, `⌘=` and `⌘-` step without
  opening the slider and `⌘B` takes the percent typed in the bar.
- **Input source**: HDMI 1 / 2, DisplayPort 1 / 2, USB-C (the VCP 60
  codes; LG's alternate codes by the setting), or another code typed in.
  `ddcctl` and `ddcutil` read which is active and tag it; `m1ddc` only
  sets.
- **Resolution & scaling**: every mode displayplacer lists, HiDPI ("looks
  like") first, then native, each with its refresh rate, the current one
  tagged. A mode that changes the resolution or the scaling asks first;
  the arrangement before is kept as an **Undo** row at the palette's root
  until it is used or forgotten.
- **Rotation** (0 / 90 / 180 / 270; rotating the built-in screen asks,
  with displayplacer's own warning), **Mirror with…** / **Stop
  mirroring**, **Make main** (the origins shift so the display sits at
  (0,0), the layout otherwise kept), **Sleep displays** (System's own
  command).

At the root too: **Night Shift** on / off when the `nightlight` CLI is
installed, **Sleep displays**, and the **presets**: "Save current
arrangement as…" keeps displayplacer's own reproduce line (one command
per output on Linux) under a name; each preset is a row with Apply,
Rename (`⌘R`), Overwrite with the current arrangement (`⌘S`) and Delete
(`⌘⌫`), its commands in the detail pane. Live: read again on every show
(the tool listings are cached for 20 s, `⌘R` reads afresh). What is
missing for the displays there are is a Setup row each, Enter copying
the install command.

| tool | macOS | Linux | what it adds |
| --- | --- | --- | --- |
| nothing | `system_profiler` | `hyprctl` / `wlr-randr` / `xrandr`, whichever is there | the displays, their names, the current mode, main and mirror |
| `displayplacer` (`brew install displayplacer`) | modes, rotation, mirroring, make main, presets | the compositor tool does these | arrangement |
| `brightness` (`brew install --HEAD brightness`; the bottled 1.2 cannot read Apple Silicon panels) | the built-in display and Apple displays | `brightnessctl` | brightness |
| `m1ddc` (Apple Silicon) / `ddcctl` (Intel) | external monitors over DDC/CI | `ddcutil` | brightness, contrast, volume, input source |
| `nightlight` (`brew install smudge/smudge/nightlight`) | Night Shift | no | the toggle |

Settings, `[extensions.displays]`:

| setting | default | what |
| --- | --- | --- |
| Brightness step (`step`) | 5 % | what the arrows, a scroll on the bar item and a `+10`-style link move by |
| LG input codes (`input_alt`) | off | the alternate VCP 60 addressing LG (and some others) take |

`brightness` item settings, `[bar.items."displays/brightness".settings]`:

| setting | default | what |
| --- | --- | --- |
| Display on the bar (`display`) | the external display | whose level the bar item shows: `external`, `main` or `builtin`; a `pal://displays/brightness` link naming no display acts on it too |

**Bar item `displays/brightness`**: the chosen display's brightness as a
glyph (three steps of the same sun) and the percent; a scroll on the item
moves it by the step. The popover is a card per display with its mode
line and a slider (`↑` `↓` move between them, `←` `→` and the digits set
the one the cursor is on, `n` Night Shift, Enter opens the display in
pal, `p` the palette). Hidden by its rules (Settings > Bar) while only the
built-in display is connected, whose keyboard keys already set it, and
while nothing installed can set any display; `show = "always"` keeps it
muted with the level.

Routes: `pal://displays/brightness?value=50|+10|-10&display=main|external|builtin|<id>|<name>`
(also `contrast`, `volume`), `pal://displays/input?source=hdmi1|hdmi2|dp1|dp2|usbc|<code>`,
`pal://displays/mode?mode=<n>|1800x1169|1800x1169@60|2560x1440 hidpi|3024x1964 native`,
`pal://displays/preset?name=<name>`, `pal://displays/night-shift?state=on|off|toggle`.

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

Four palettes over one colour maths (the SDK's `colors`, `sdk/src/color.ts`) and one
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

## Icons (`icons`, `icons-freedesktop`, `icons-iconify`)

The two glyph grids are `catalog`s at the root: three rows each there, the rest
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

**Iconify Icons** is a third grid, an input palette over Iconify's public
API (`api.iconify.design`, no key): every set it hosts (Material Design
Icons, Tabler, Lucide, Phosphor, Simple Icons, Heroicons and the rest,
some 200k icons), searched by name 250 ms after the last keystroke:
`/search?query=` answers the names and the sets, then one
`/<prefix>.json?icons=` per set the SVG bodies, cached per word and per
icon for the process. Each tile is the icon's own SVG, filled mid-grey so
it reads on both themes (Iconify draws in `currentColor`, which a picture
cannot inherit); the set's name is the section. Nothing typed lists
nothing (the placeholder says what to type); no hit, a rate limit (429)
or an unreachable API is one hint row, and a failed search is not cached
so `⌘R` asks again.

| action | shortcut | what |
| --- | --- | --- |
| Copy SVG | `Enter` | the whole file, `currentColor` kept |
| Copy name | `⌘Enter` | `mdi:home` |
| Copy as data URL | `⌘⇧D` | `data:image/svg+xml;utf8,...`, what an `{ image }` icon or a CSS background takes |
| Open on Iconify | `⌘O` | the icon's page on icon-sets.iconify.design |
| Save SVG… | `⌘S` | `<prefix>-<name>.svg` into the `save_to` folder, `-2` when the name is taken; the HUD names the path |

The glyph table is generated: `bun run extensions/icons/build.ts` fetches
`glyphnames.json` at the pinned release and writes `data.json` (282 KB,
`[name, code]` pairs by set), committed; bump the version in the script
together with the font. A listing is eleven thousand rows (about 3.4 MB
over the host's pipe) on every start, as the palette has no `ttl`; the
rows carry the least they can for that.

Settings, `[extensions.icons]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `sets` | list | `[]` | Set prefixes the Iconify search is limited to (`mdi`, `tabler`, `lucide`, `phosphor`, `simple-icons`). Empty: every set. |
| `save_to` | path | `~/Downloads` | Where Save SVG puts an Iconify icon. `~` is expanded. |

Per palette, `[palettes.icons.settings]` and `[palettes.icons-iconify.settings]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `columns` | number, 4 to 16 | `10` (Iconify `8`) | Tiles per row in the grid. Read once when the extension loads. |

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
| `networks` | list | `[]` | One line per network, `SSID = kind label:Name icon:X` (or `gateway = ...`): `hide` drops the `network/status` item, `hotspot` and `public` mark it, `label:` renames it on the bar, `icon:` replaces its glyph there and on the interface's rows here. An extension setting, since the palette's rows read the icon too. |

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
12:34", "Landed 0:42 ago"), a state tag. Then **New timer**, a
form: a duration (`25m`, `90s`, `1h30m`, `2:30`, a bare number is minutes;
the CLI parses it and its complaint comes back under the field), an
optional name (the duration otherwise; a name already taken restarts that
timer), and a checkbox to ring the phone out loud when it lands (`--ring`).
The same from a link: `pal://timer/start?duration=25m&name=tea`
(`&ring=1` rings; [Links](links.md#extension-routes)).

**Start Pomodoro** is the last row while no pomodoro runs. It starts a
work timer (`Pomodoro 1 of 4`, `pomodoro_work` minutes) and the cycle
then runs itself: when that timer lands the extension stops it and
starts the break's (`Break 1 of 4`, `pomodoro_break`), then the next
round, after the last round the long break (`pomodoro_long_break`), then
round 1 again, each a timer of the CLI's own (its chime and phone ping
fire as for any timer), each announced on the HUD ("Pomodoro. Break: 5
min"). The pomodoro's row wears an apple, the phase as a tag (`work`
violet, `break` green) and "Round 2 of 4, work" before what is left; the
bar item reads `18:27 · 2/4` while working and `4:59 · break` on a break.
A finished work round counts toward **Pomodoros today: N**, an inert row
at the bottom (sixty days of counts in storage); the session is in
storage too, so a host restart picks it up. Stopping the pomodoro's
timer (here, or `timer stop` in a terminal) ends the cycle; so does a
landed one the CLI reaped while the host was down.

Actions, by state:

| row | `Enter` | `⌘+` | `⌘S` | `⌘⇧D` | `⌘D` |
| --- | --- | --- | --- | --- | --- |
| running | Pause | Add 5 minutes | | | Stop |
| paused | Resume | Add 5 minutes | | | Stop |
| landed | Dismiss (the CLI's `done`) | Add 5 minutes (restarts it) | | | Stop |
| the pomodoro's timer | as above | as above | Skip to the next phase (this phase's timer stopped, the next started; a skipped round is not counted) | Stop pomodoro (the cycle over, the timer gone) | Stop |

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
| `p` | Start a pomodoro (while none runs) |
| `s` | Skip to the pomodoro's next phase (while one runs); `cmd+shift+d` stops the cycle |
| `o` | Open the Timers palette |

A pomodoro's card carries the phase as a tag next to when it lands. The
key hints are two rows, the card's keys then the popover's own, and the
second ends with today's finished rounds (`3 today`).

Settings, `[extensions.timer]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `command` | path | `timer` | The CLI, a name on PATH or a path. |
| `dir` | path | `~/.local/share/timer` | Its state directory (`TIMER_DIR`); made if missing. `~` is expanded. |
| `pomodoro_work` | number, minutes | `25` | A work round. |
| `pomodoro_break` | number, minutes | `5` | The break after a round. |
| `pomodoro_long_break` | number, minutes | `15` | The break after the last round of a cycle. |
| `pomodoro_rounds` | number | `4` | Work rounds per cycle before the long break. |

## Calendar (`calendar-today`, `calendar-schedule`, `calendar-quick`, `calendar/upcoming`)

Two live palettes, one input palette (Quick Add) and a bar item over one
source and one cache; Today
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
| Add event | `Enter` | Quick Add: the typed line as the event (below) |
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
event's name as the title with the time as a segment after it (`in 12m`, `25m
left` while it runs), so the target's `max_chars` clips the name and never the
time; while one runs the next due under the same rules adds an `in 8m` segment
in its own colour, its name in the tooltip. Hidden when nothing timed starts
within `horizon_hours` (10), so a clear evening is a clear strip. The event is
the first that has not ended, timed unless `hide_all_day` is off, not declined
unless `hide_declined` is off, starting inside the horizon; a running one
counts until it ends (a click joins its call, not the next one's). Colour by
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

**Quick Add Event** (`calendar-quick`, an input palette) is the same
write from one typed line, parsed as you type (`extensions/calendar/quick.ts`,
pure, on `parseDay` and `parseTime`): a title first, then in any order a
day (`tomorrow`, `fri`, `next tue`, `20 sep`, `2026-09-20`, `on monday`),
a time or a range (`10:00`, `2pm-3pm`, `14:00 to 15:30`, `9-10am`), `for
45m` (else `default_length`, 30 minutes), `at <place>` (free text at the
end, unless a time follows the `at`), `@ <calendar>` anywhere (`in
<calendar>` too when a writable calendar starts with the word; an `in`
in a title stays), `all day`. No time makes it an all-day event; no day
means today, or tomorrow once the time has passed (an amber `tomorrow`
tag says so). The one row reads the event back, `dentist · Fri 18 Sep
14:00 to 15:00 · Room 4 · Home calendar`, the calendar's colour on the
glyph and the start as a `date` accessory; a line that is only a day, or
nothing, is a hint row naming the grammar; a calendar name nothing
matches falls to the default and the row says so. `Enter` creates it
through the form's write (`calendar.create`, the cache dropped, the
"Added" toast); a refusal is a failure toast. The palette declares
`fallback: "Add “{query}” to the calendar"`, so a root query nothing
matched offers the line as an Add row. The permission rows are the
others'; a Google source refuses the write as the form does.

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
| `horizon_hours` | number | `10` | The bar item shows the next event only when it starts within this many hours (the root's Now row too). |
| `hide_all_day` | boolean | `true` | The bar item speaks for timed events only (the root's Now row too). |
| `default_length` | number, 5 to 480 | `30` | How long a Quick Add event lasts when no end or `for` is typed (minutes). |

`upcoming` item settings, `[bar.items."calendar/upcoming".settings]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `near_minutes` | number | `60` | The item's `near` phase starts this many minutes before the event. |
| `warn_minutes` | number | `15` | The item turns amber (`warning`) this many minutes before the event. |
| `urgent_minutes` | number | `5` | The item turns red (`critical`) this many minutes before the event. |

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

## Minesweeper (`minesweeper`)

The mine-clearing game in the panel, by mouse or one hand on the keys.
Enter on the palette's row (or its hotkey) opens the board as a view
level whose body is the extension's own page (a `surface`): the search
input gives way to the game's line ("7 mines left", "Cleared in 1:11"),
⌘K lists the moves.

- Moving: the arrows or `hjkl` move the cursor (the ringed cell).
- Opening: Enter or a click. The first open is always safe (the mines
  are laid after it, never on it or around it) and opens an area; an
  empty cell floods open. Enter or a click on a number whose flags are
  all placed opens around it (the chord, "open around" in the hint line);
  both buttons or the middle one do the same. A held button shows the
  cells it would open pressed.
- Flagging: `/`, `F` or Space, or a right-click; the counter is the mines
  less the flags.
- The end: won when every safe cell is open (the mines left are flagged),
  lost on a mine, which goes off red among the rest; a wrong flag is
  crossed out. Enter or the face starts a new game; `N` does at any time,
  asking first mid-game.
- The level: `D` opens the picker (left, right, Enter), or click a level;
  it writes the `difficulty` setting.
- One-handed: the arrows, Enter and `/` (just above the arrows) play a
  whole game.
- Escape leaves at any point; the board, the clock, the best time and the
  won count per level persist (in the extension's storage).

The clock starts on the first open and counts only while the board is on
screen: leaving the view pauses it, coming back resumes it, and a run pal
never ended (a quit, a crash) is cut off at the last move. The board is
the classic one redrawn: square raised cells that press flat, the classic
number colours tuned per theme, an LED counter and clock around the face.
An open lifts the caps ring by ring from the cell opened; a mine goes off
with a blast before the rest pop out; a cleared board plants its flags
under confetti. The cells scale to the page, so the 30 by 16 expert board
fits the compact panel.

```toml
[extensions.minesweeper]
difficulty = "beginner"       # intermediate (16x16, 40), expert (30x16, 99); from the next board; D on the board too
```

## Snake II (`snake`)

Snake II as the Nokia 3310 plays it, on the phone's own 84 by 48 screen.
Enter on the palette's row opens it as a view level whose body is the
extension's own page (a `surface`): the SNAKE II splash, then the phone's
menu (New game, Level, Mazes, Top score, Instructions), lit green, and the
game unlit, as the phone keeps its backlight. Every screen, sprite, maze,
rule, delay and tone comes from the real 3310 firmware (v6.07) run in an
emulator, and the tests replay 123 runs recorded from it frame by frame.

- Steering: the arrows are the phone's 2 4 6 8 while playing; the digits,
  `*` and `#` are the keypad (1 3 7 9 turn across the way the snake goes,
  `*` and `#` turn left and right). Only the last key before a step counts;
  a key back the way the snake came is dropped.
- Enter is the phone's left soft key (Menu, Select, OK, More), Backspace
  its C; in a menu the up and down arrows are its scroll keys (Page Up and
  Page Down anywhere).
- Levels 1 to 9 (656 ms a step down to 88 ms), No maze and Mazes 1 to 5,
  food worth the level, a bonus creature after every fifth food with its
  countdown from 20, worth 5 x level + 5 + 2 x the countdown.
- A step into a wall or the body waits about 100 ms and tries again with
  any turn pressed meanwhile: a late turn still saves the snake.
- Game over blinks the snake, then the score; a new top score gets the
  fireworks and the jingle.
- C or Menu in play pauses (Continue first in the menu); Escape and the
  panel hiding pause too, and Continue is there next time, across
  restarts. C on the Snake II menu, or a digit on any of its screens (the
  phone's dialer), leaves the game and closes the view.
- The level, the maze, the top score, a paused game and the phone's random
  numbers persist in the extension's storage; the numbers start again
  from 1 when pal starts (the phone's power-on), so the first food after
  it is where the phone puts it.

```toml
[extensions.snake]
tones = true                  # the buzzer: eating, a crash, the top score's jingle; cmd+T on the game
```

## Solitaire (`solitaire`)

Klondike in the panel, by mouse or one-handed on the arrows and Enter.
Enter on the palette's row (or its hotkey) opens the table as a view
level whose body is the extension's own page (a `surface`): a felt with
real cards, as large as the panel allows. The search input gives way to
what the cursor is on ("Pile 4 · 9♣ 8♥"), what you carry ("Moving 7♥ and
2 more") or why a move was refused ("7♥ can't go on 9♠"); ⌘K lists draw,
undo, finish and new game.

- The mouse: drag a card (and the cards under it) onto a pile; the piles
  it can go on light up, a drop anywhere else glides it back. Or click
  the cards, then the pile; a double-click sends a card where it goes, a
  click on the stock draws.
- The cursor: `←` `→` walk the stock, the waste, the foundations and the
  seven piles (wrapping; `h` `l` too); on a pile `↑` `↓` take more or
  fewer cards of its face-up run, and past it move to the row above or
  below (`k` `j` too).
- Enter picks up what the cursor's ring holds; the cards ride on the pile
  under the cursor, and Enter drops them where it is. An illegal drop
  puts them back with the reason. Enter again on the pile they came from
  sends them where they go: the card's foundation, else the first pile
  that takes them. Any foundation takes a card onto its own suit's.
- Enter on the stock, or `space` (`d`) anywhere, turns one card (three
  with `draw = "3"`) onto the waste, and the waste back over once the
  stock is out; passes are unlimited. `U` or Backspace undoes (a hundred
  moves back, the turned-over card too), or puts down the cards held.
- Once the stock and the waste are played out and every card is face up,
  the rest flies home one card at a time (Enter finishes at once), and a
  win bounces the cards off the foundations. `N` deals a new game,
  asking first mid-game.
- Escape leaves at any point; the game, the moves, the time and the
  record (games won of played) persist (in the extension's storage). The
  time counts only while the table is open.

Every card glides to where it goes and turns over with a flip, the deal
goes out row by row from the stock, and a column fans out while it has
room and tightens as it grows, never past where a card's rank shows.

```toml
[extensions.solitaire]
draw = "1"                    # or "3"
```

## Yahtzee (`yahtzee`)

Solo Yahtzee: five dice, three rolls a round, thirteen rounds. Enter on
the palette's row (or its hotkey) opens the game as a view level whose
body is the extension's own page (a `surface`): the dice on a tray with
Roll beside them, the scorecard under them in two columns and the total
at the bottom, all of it in view at once, compact included. The title
line says the round and the roll ("Round 4 · Roll 2 of 3", "Choose a
category"); ⌘K lists Roll and every category the dice may go in, the one
that adds most first.

- Every open category shows what it would score with the dice as they
  lie. A picked row (hover, or the keys) rings the dice it counts, shows
  on the total what it would add (bonuses included) and, for an upper
  box, its share of the bar to 63.
- The keys, one hand: `space` (or `R`, or `↑` on the dice) rolls; `←` `→`
  pick a die and Enter holds it (`1` to `5` hold directly); `↓` goes to
  the card, on the category that adds most, where the arrows move between
  the open ones (`↑` past the top is back to the dice) and Enter scores.
  After the third roll the cursor is on the card by itself. `N` starts a
  new game, asking first mid-game.
- The mouse: click a die to hold it, Roll to roll, a row to score it.
- The dice tumble when thrown (held ones stay put), a score drops into
  its row while the total counts up, a Yahtzee gets a banner and
  confetti, and game over shows the final score with the best and the
  average.
- Escape leaves at any point; the game and the record (games, best,
  average) persist in the extension's storage.

Rules (Hasbro's): 35 for 63 or more in the upper section; a further
Yahtzee pays 100 while the Yahtzee box holds 50, and plays as a Joker:
its number's upper box if open, else any open lower box (a full house
and the straights at full value), else an upper box for 0. No settings.

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
count, their topic or purpose as the subtitle (else "New messages": no
run is fetched for them). Sections Direct messages, Mentions, Threads,
Channels, newest first in each. The row: the conversation's name, the sender's avatar, the
message (in a channel the one naming you, not the last), a count badge
(red; blue for thread replies; `1+` past a page), a presence dot on a
direct message (green active, grey away; `users.getPresence` per person,
a minute; the `presence` setting turns it off), the time. The pane is
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
direct message waits (its `dm` rule); every `refresh` seconds and on show,
wake, network. The popover is a view: a section per kind with the newest
rows (avatars with a direct message's presence dot, the latest line, a
count badge; Enter opens one), the
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
| `presence` | boolean | `true` | A presence dot on each direct message row (green active, grey away): one `users.getPresence` per person, remembered a minute; off makes no such call. |

`unreads` item settings, `[bar.items."slack/unreads".settings]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `refresh` | number (s) | `120` | Seconds between refreshes of the item, 10 at least. |

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
hidden at zero; every 300 s and on show, wake, network. The popover:
every one as a row (it scrolls), Open in pal, Mark all read.

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
item's `main_room` setting, else the room with most lights on) and `N on`; the
popover toggles every room, plays the scenes (the item's `scenes`, else the main
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
| `timeout` | number (s) | `5` | One request's limit. |

`home` item settings, `[bar.items."hue/home".settings]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `main_room` | text | unset | The bar dot's room and the popover's scenes. |
| `scenes` | list | `[]` | Scene names or ids in the popover, in order. |

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

**The bar item** (`spotify/playing`): the track, or with its `lyrics`
setting the lyric line playing; hidden while nothing plays. The popover is the
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
(number, `27182`), `pinned` (list of playlist names or
`spotify:playlist:` links). `playing` item settings,
`[bar.items."spotify/playing".settings]`: `lyrics` (boolean, `true`, the
lyric line on the strip instead of the track name). A `429` is waited out
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
show, wake, network. The popover: every unread as a row (it scrolls), each
a submenu (Open in Gmail, Mark as read), then Open in pal (the Inbox
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
thumbnail directory. The rename and move forms are the SDK's
`files` (`sdk/src/files.ts`), shared with Files.

Settings, `[extensions.downloads]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `folder` | folder | `~/Downloads` | The downloads folder. |
| `browser_folders` | boolean | `true` | Also the browsers' own download folders when they differ. |
| `limit` | 10 to 2000 | `200` | At most this many files, the newest. |
| `thumbnails` | boolean | `true` | Previews for images and PDFs. |
| `clear_days` | 1 to 365 | `30` | The age the Clear row trashes. |

## GIFs (`gifs`, `gifs-favourites`)

Giphy searched from the panel, from `extensions/gifs/`. An input grid:
what is typed is searched 300 ms after the last key, nothing typed lists
what is trending under a Trending section, and every tile is the GIF's
small animated preview (Giphy's `fixed_height_small`), fetched once into
the cache directory
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

The key is a Giphy app key from developers.giphy.com (Create an App,
API); without one the grid is one row saying which setting to fill and
where the key comes from. `content_filter` is Giphy's `rating`: `off`
(R), `low` (PG-13), `medium` (PG), `high` (G).

| keys | action |
| --- | --- |
| `enter` | Copy the GIF file |
| `cmd+enter` | Copy the url |
| `cmd+o` | Open the page on giphy.com |
| `cmd+s` | Save to Downloads (`save_to`) |
| `cmd+f` | Add to favourites |
| `cmd+d` | Favourites: remove |

Settings, `[extensions.gifs]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `giphy_api_key` | secret | empty | The Giphy app key. |
| `content_filter` | `off`, `low`, `medium`, `high` | `medium` | What the results may show. |
| `save_to` | folder | `~/Downloads` | Where `cmd+s` writes the file. |

`[palettes.gifs.settings] columns` (3 to 10, default 6) is the tiles per
row of both grids. For the tests, `PAL_GIFS_GIPHY` replaces the host and
`PAL_GIFS_CACHE` the cache directory.

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
name`; what the gateway cannot classify is its text, else `[message]`);
the other rows carry the gateway's one-line summary. The row:
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
ones (`isMyContact` with a name) one per number, an hour in memory; a
name without a letter or digit, or that is the number itself, reads as
the number alone; `Enter` opens a chat, `⌘C` copies `+<number>`, `⌘⇧C` a vCard 3.0.

**`send`, off by default.** Off is read and mark-read only: no Send a
message, no React, no reply field in the popover; every write path
checks it again at pick time and refuses with a toast naming the
setting. The key can do all of it; the setting is the control (the
owner's rule for sends: an outward action, only as a form he submits).

**The bar item** `whatsapp/unread`: the number of unread chats as the
badge, hidden at zero (the core's `show = "always"` keeps the glyph and
lists the recent chats in the popover), red while a direct chat is unread
(its `dm` rule); every 120 s and on show, wake, network. The popover is a
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
| `open` | `auto`, `app`, `web` | `auto` | Where a chat opens. |

Hint rows: no key (Open WhatsApp settings), the gateway unreachable at
its url, the key rejected (401), a session not ready (a `qr_ready` one
says to scan the code at the gateway's url; the chat list answers 409
meanwhile), a session name nobody has, a 429 (refused locally for
`Retry-After`, 60 s without), the search provider down. Not shown: muted
and pinned chats and a group's member count (the gateway's chat summary
has none of them).

## Images (`images`)

Compress, resize, convert, rotate, crop, strip metadata, make an icon
set, read the text, from `extensions/images/`: what Raycast's TinyPNG and
Image Modification do, local first. An input palette whose rows are the
images at hand: before you type, the Finder selection (a selected folder's
images too), an image or a copied file list on the clipboard, and the
Results of this session; a typed path lists a file, a folder's images or
the completions of the last segment; anything else filters by name. With
more than one image an "All N images" row leads, and rows mark with `tab`
(or `x` with nothing typed). Each row shows a thumbnail (the core's own
for PNG, JPEG and GIF, `sips -Z` or ImageMagick into the cache for the
rest), the size and the pixel size; the detail pane (open by default) is
the picture at 256 px over the info: dimensions, format, colour space and
profile, camera, lens, exposure, date and location (`sips -g all`, or
`identify`; `exiftool` for the photo fields when installed).

Every operation writes next to the source with a suffix (`-compressed`,
`-web`, `@0.5x`, `-800w`, `-rotated90`, `-square`, `-padded`, `-stripped`,
`-gray`; a convert swaps the extension; `@2x` strips an existing `@Nx`
and half of a `@2x` stem is the bare name; a taken name gets `-2`), then
copies the result's path (the paths one per line for a batch; the image
itself when the input was the clipboard, whose result goes to the cache's
`clipboard/` folder), hides and says in the HUD what it did and with
which tool: "Compressed photo.png: 1.4 MB → 312 KB (−78%), pngquant ·
path copied". A file no encoder can shrink writes nothing and says so. A
batch past eight seconds answers with a progress toast and finishes behind
the panel. With `replace` on the result takes the source's place and the
source is copied to `~/Library/Caches/pal/images/originals/` first;
Restore original puts it back. Nothing is ever deleted: a result written
next to its source can go to the Trash, the source stays.

The encoders, in the `tools` order (one left out is never used; every
result names the one that made it): `pngquant` (lossy PNG) and `oxipng`
or `optipng` (lossless), `cjpeg` (mozjpeg's or libjpeg-turbo's, through
`djpeg`) and `jpegtran`, `cwebp`, `avifenc`, `gifsicle`, `exiftool`, then
sips and ImageMagick. sips (in every macOS) does the geometry whenever it
is listed and writes PNG, JPEG, TIFF, GIF, BMP, PDF, HEIC, AVIF and ICO;
it never compresses a PNG (it re-encodes a palette PNG as RGBA). ImageMagick
is the fallback for everything and the whole of it on Linux. Strip
metadata is pal's own for PNG and JPEG (lossless: the APPn and COM
segments, the text, time, EXIF and ICC chunks). The empty listing names
up to three encoders worth installing. Optimise for web (`cmd+enter`) caps
the long side at `web_max`, encodes at `quality` (as `web_format`), strips,
and opens a view with a row per image (thumbnail, before → after, the
saving as a tag, a bar) and the total at the foot, following a long batch
as it lands. Make an icon set writes `name-icons/` with the `.iconset`,
the `.icns` (iconutil), `favicon.ico` and the touch and Android sizes.
TinyPNG (`tinypng_api_key`) adds `cmd+t` for PNG, JPEG, WebP and AVIF.

| keys | action |
| --- | --- |
| `enter` | Compress |
| `cmd+enter` | Optimise for web |
| `cmd+l` | Compress losslessly |
| `cmd+t` | Compress with TinyPNG (with a key) |
| `cmd+shift+r` | Resize… (presets; or type `800`, `x600`, `800x600`, `50%`, `2x`) |
| `cmd+shift+v` | Convert… (PNG, JPEG, WebP, AVIF, HEIC, PDF, TIFF, GIF; a missing tool named) |
| `cmd+shift+o` | Rotate or flip… |
| `cmd+shift+a` | Crop or pad… (1:1, 16:9, 4:3, 3:2, 9:16 centred; pad to a square) |
| `cmd+shift+m` | Strip metadata |
| `cmd+g` | Grayscale |
| `cmd+shift+f` | Make an icon set |
| `cmd+shift+t` | Copy text (OCR) |
| `cmd+shift+i` | Copy info |
| `cmd+c` | Copy path |
| `cmd+shift+p` | Copy image (PNG and JPEG onto the pasteboard; other formats as a file) |
| `cmd+o`, `cmd+shift+e` | Open, Reveal in Finder |
| `cmd+shift+z` | Restore original (a replaced result) |
| `cmd+d` | Move result to Trash (asks; the source stays) |

Settings, `[extensions.images]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `replace` | boolean | `false` | Write over the source; a copy is kept for Restore original. |
| `quality` | 1 to 100 | `80` | For the lossy encoders (pngquant's floor is 25 under it). |
| `web_format` | `keep`, `webp`, `avif` | `keep` | What Optimise for web writes. |
| `web_max` | 100 to 10000 | `2000` | Optimise for web caps the long side at this many pixels. |
| `thumbnails` | boolean | `true` | Thumbnails on the rows and in the pane. |
| `pad_color` | hex | `#ffffff` | What Pad to a square fills with. |
| `tinypng_api_key` | secret | (none) | Adds Compress with TinyPNG. |
| `tools` | list | every tool | The order the encoders are tried. |

## Stats (`stats`, `stats/cpu`, `stats/memory`, `stats/disk`, `stats/network`, `stats/load`)

CPU, memory, disk, network and load as five bar items off one sampler
(every `interval` seconds, 3 by default; about 5 ms a tick, 27 ms while a
process popover is open), each hidden by its rules while quiet and
coloured past its thresholds, with a popover of the breakdown; the same
facts as rows in the `Stats` palette. Detail: `extensions/stats/README.md`.

| item | strip (its `label` setting) | quiet, hidden | amber | red |
| --- | --- | --- | --- | --- |
| `stats/cpu` | `42%`; `▂▃▅▇▆`; one bar per core; `42% · node` | under 70% | from 70% | from 90% |
| `stats/memory` | `63%`; `24.2 GB`; `14.4 GB free`; sparkline | under 80% with no pressure | 80%, or pressure `warn` | 90%, or `critical` |
| `stats/disk` | the startup volume's free space; share; used | over 20 GB free, every writable volume under 85% | 85% or 20 GB | 95% or 5 GB |
| `stats/network` | `↓1.2M ↑80K`; `↓1.2M`; sparkline | under 1 MB/s either way | | (blue from 10 MB/s) |
| `stats/load` | `3.26`; `3.26 3.25 2.91` | the 1 min load under the core count | from the cores | from twice them |

The rules are the manifest's, edited by id in Settings > Bar or under
`[bar.items."stats/cpu".rules.quiet]`; `show = "always"` keeps an item on
the strip muted at rest, a `quiet` rule set to `when = "false"` keeps it in
colour. The states every render publishes (`stats.cpu`, `stats.cpu_top`,
`stats.cores`, `stats.memory`, `stats.memory_pressure`, `stats.swap`,
`stats.disk`, `stats.disk_free` (GB), `stats.disk_worst`, `stats.net_down`
and `stats.net_up` (KB/s), `stats.load1`, `load5`, `load15`) are what a
rule of your own reads.

The popovers, each with a sparkline of the last 60 samples in the theme's
ink, a cursor ring the arrows (or `j`/`k`) and a click move, and `s` for
the palette: **CPU** the share and level, cores / load / uptime, one bar
per core, the five busiest processes (`Enter` Activity Monitor, `x` kill
after a confirm, `c` copy, `p` Processes); **Memory** the segments bar
(app, wired, compressed, cached, free) with a legend, the swap, the five
largest, the same keys; **Disk** a card per volume with its bar, free
space, mount point and a `read-only` badge (`Enter` reveals in Finder,
`c` copies the path); **Network** the two rates, both in one sparkline,
every interface with its kind, SSID, address and rates (`Enter` the
Network palette, `c` copies the address); **Load** the three averages as
tiles, the per-core figure.

The palette is live (from the last sample, no tool runs; `⌘R` samples
now) with the detail pane showing: Processor (CPU, load), Memory (memory,
swap), Disks, Network (each interface, then the totals), Busiest and
Largest processes, System (uptime). The value is the name.

| action | shortcut | what |
| --- | --- | --- |
| Copy | `Enter` | the value: the share, the usage, a volume's mount point, an interface's address, a process's pid |
| Open Activity Monitor | `⌘O` | the Processes palette on Linux |
| Open bar popover | `⌘P` | the row's item, through `pal://bar/stats/<item>` |
| Reveal in Finder | `⌘R` | a volume |
| All addresses | `⌘A` | the Network palette |
| Kill | `⌘⌫` | a process, after a confirm |

Links: `pal://stats/cpu` (and `memory`, `disk`, `network`, `load`) opens
the popover; `?palette=1` the palette on that section.

Sources, no root: `os.cpus()` deltas, `os.loadavg()`, `vm_stat` and
`sysctl` (Activity Monitor's arithmetic and the kernel's pressure level),
`netstat -ibn`, `df -kP` and `mount` (every 60 s), `ps` (every 10 s, every
tick while a process popover is open) on macOS; `/proc/meminfo` and
`/proc/pressure/memory`, `/proc/net/dev` with `ip -j -br addr`,
`/proc/mounts` on Linux. No temperature (a native reader or root on
macOS).

Settings, `[extensions.stats]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `interval` | number | `3` | Seconds between samples, 1 to 60. |
| `disk_hide` | list | `[]` | Mount points or volume names left out of the disk item and the palette. |

Each item's settings, `[bar.items."stats/<item>".settings]` (`cpu`,
`memory`, `disk`, `network`, `load` item settings): `label`, what the strip says.

| item | `label` | default |
| --- | --- | --- |
| `cpu` | `percent`, `spark`, `bars`, `top` | `percent` |
| `memory` | `percent`, `used`, `free`, `spark` | `percent` |
| `disk` | `percent`, `free`, `used` (the startup volume) | `free` |
| `network` | `rate`, `down`, `spark` | `rate` |
| `load` | `one`, `three` | `one` |

## odak (`odak`, `odak-add`, `odak-search`, `odak-done`, `odak/today`)

One extension, four palettes and a bar item over an [odak](https://github.com/zcag/odak)
server, signed in with its API key. Everything is the server's own REST
API (`GET /todos` once, cached 60 s and shared by the palettes and the
bar; `/sections`; the writes). `extensions/odak/README.md` has the
endpoint list and the two model quirks worked around (an id is a hash of
the line, so every edit gives a new one, computed here as odak does; a
day cannot be cleared).

| palette | id | kind | what `Enter` does |
| --- | --- | --- | --- |
| Todos | `odak` | live, 60 s | completes the todo (Tab marks several) |
| Add Todo | `odak-add` | input | adds the line as read |
| Search Todos | `odak-search` | input | completes an open todo, reopens a completed one |
| Completed | `odak-done` | live, 60 s | reopens |

**Signing in.** `url` is the server (`http://host:8761`, the same origin
as the web UI), `api_key` its `ODAK_API_KEY` (kept in the keychain).
Without either, every palette is one hint row naming which and opening it
in Settings; a refused key says so; a server that does not answer names
the address and `⌘R`, and rows already fetched stay through an outage.

**Todos.** Two commands (New todo, the text typed in the bar as an
argument, `⌘Enter` into Add Todo; Open odak), then Overdue and Due today,
then the file's sections in order, a subtask under its parent, Not yet at
the end for a `[w:date]` still ahead. A row carries its tags and its day
as chips (`overdue 3 d` red, `today` amber, `tomorrow` blue, `Fri` within
the week, the date beyond), a red mark when urgent, the subtask count; the
pane the subtasks as a task list and the metadata. Complete (`Enter`, a
toast and an Undo row for a minute), Edit… (`⌘E`), Snooze to tomorrow
(`⌘T`), Snooze… (`⌘S`: tomorrow, in 3 days, next Monday, next week, in a
month, or a day typed), Move to section… (`⌘M`), Mark urgent (`⌘U`), Add
subtask… (`⌘N`), Open link (`⌘L`), Open odak (`⌘O`), Copy text (`⌘C`),
Copy link (`⌘⇧C`), Delete (`⌘D`, asks). The root's Now section shows what
is overdue or due today.

**Add Todo.** One line, read back as you type: `#tag`, a bare `!` for
urgent, `/section` (a prefix of one of the file's), `d:day` / `w:day`, and
a day in words at the end (`tomorrow`, `fri`, `next mon`, `in 3 days`,
`20 sep`, `2026-10-01`, `by fri`; a time after it stays in the text).
Enter adds and hides with the HUD line, `⌘Enter` keeps the line, `⌘⇧C`
copies it. Before you type: what was just added (Undo deletes it), the
selection and the clipboard as todos. A root query with no hit offers
"Add “…” to odak". **Search Todos**: every word against text, tags and
section, open by section then completed. **Completed**: what is checked
off by section, with when for the ones completed from pal; Enter reopens.

**The bar item** `odak/today`: the count of open todos due today or in
its `today_sections` plus the overdue, red while any is overdue (rule
`overdue`), hidden at zero (rule `quiet`; `show = "always"` keeps the
glyph), every 300 s and on show, wake, network; facts `odak/overdue`,
`odak/today`, `odak/open`. The popover: the overdue first, then today's,
a cursor the arrows move; `Enter`/`x` completes, `u` the flag, `t`
tomorrow, `n` a field whose Enter adds, `o` odak, `p` the palette, `r`
fetches again. `pal://odak/add?text=...` adds from outside (`section`,
`due`, `tags`, `urgent` on top).

Settings, `[extensions.odak]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `url` | text | (none) | The server's origin. |
| `api_key` | secret | (none) | `ODAK_API_KEY`. |
| `default_section` | text | `Inbox` | Where a todo lands unless the line names a section (one of the file's, else Inbox). |

`today` item settings, `[bar.items."odak/today".settings]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `today_sections` | list | `["Focus", "Today"]` | What the item counts as today's, on top of what is due today. |

For the tests, `PAL_ODAK_URL` and `PAL_ODAK_KEY` replace the two settings.

## Grafana (`grafana`, `grafana-alerts`, `grafana-query`, `grafana/alerts`)

Grafana over its HTTP API with a service account token (Viewer reads
everything here; Editor is needed to silence or star); `multi`, so a
second Grafana is `[instances."grafana@work"]` with its own `url` and
`token` ([Config](config.md#instances)).

**Grafana Dashboards** (`grafana`) is every dashboard the token can see,
starred first, then as Grafana sorts them. A row is the title; the
subtitle the description, or the folder when there is none; the folder
is a blue tag and the first two tags follow it; the uid, the tags and
the folder are keywords. `Enter` opens it in the browser with the
`time_range` setting appended (`from=now-6h&to=now`) when set, `⌘Enter`
asks for a range in a form (from, to, kiosk), `⌘F` opens it in kiosk
mode, `⌘S` stars or unstars it (the token's own stars, which are what
sort first here), `⌘C` copies the URL, `⌘U` the uid, `→` drills into the
dashboard's folder. The filter (`Tab`) is All, Starred, Folders; Folders
lists every folder with a dashboard in it and `Enter` drills in. Listed
every 15 minutes. The detail pane (lazy) shows the description, the
folder, the tags, the time range and refresh, the panels by type, and
the first three time series panels (`sparklines`) drawn: as panel images
when the image renderer plugin is installed (probed once per run), else
as sparklines the extension draws from the panels' own queries in one
`/api/ds/query` call over the dashboard's range, the first series' last
value in the panel's unit as the caption.

**Grafana Alerts** (`grafana-alerts`) is live: every alert instance
firing or pending from the ruler's Prometheus-compatible API, marked
where the Alertmanager says a silence covers it. Firing first, then by
rule and labels. A row is the rule's name; the subtitle the rendered
summary (else the labels); a red `firing` or amber `pending` tag, the
severity, a `silenced` tag, since when. The pane has the summary and
description, the rule (a link), the state, the labels, the value, the
rule's health when it is not ok, the silence and the dashboard the rule
points at. The filter is Firing and pending, Firing, Pending, Silenced
(the covered instances, then the active silences, each with Expire).
`Enter` opens the rule, `⌘Enter` its dashboard, `⌘S` / `⌘⇧S` / `⌘D`
silence the instance for 1 hour / 4 hours / 1 day (asking first; the
matchers are the rule's uid plus the instance's own labels), `⌘E` expires
the silence, `⌘C` copies the summary, `⌘L` the labels. Listed on show,
not twice within 30 s.

**Grafana Query** (`grafana-query`) is an input palette: what you type
runs as a PromQL instant query against the Prometheus datasource
(`datasource` by uid or name, else Grafana's default), one row per
series with Grafana's display name, the value on the right and the
labels in the pane; a parse error is a calm hint with Prometheus's
message. Before you type, the saved queries (`queries`, `Name = expr`
lines): `Enter` runs one, `⌘⌫` removes it. On a result `Enter` copies
the value, `⌘Enter` the series with its value, `⌘⇧A` every series, `⌘C`
the expression, `⌘O` opens Explore with it, `⌘S` saves it under a name.

**Bar item** `grafana/alerts`: the firing count in red and the pending
count in amber, hidden by its rules while both are zero (a firing
instance under a silence does not count); `grafana/firing` and
`grafana/pending` as states. Refreshed every minute and on show, wake and
the network back. The popover lists the instances by state with a colour
rail: `Enter` opens the rule, `o` the dashboard, `s` / `f` / `d` silence
for 1 hour / 4 hours / 1 day (asking first; `s` on a silenced one
expires it), `c` copies the summary, `a` opens the alert list, `p` the
palette, `r` refreshes.

Links: `pal://grafana/query?expr=up%20%3D%3D%200` opens the prompt with
the expression typed; `pal://grafana/open?uid=<uid>&from=now-24h&kiosk=1`
opens a dashboard.

When something is wrong every palette is one inert hint row that says
what and where to fix it (Settings › Extensions › Grafana; the no-URL
row's `Enter` opens it there): no URL, a URL without a scheme, no token,
a `keychain:`/`env:` token that did not resolve, a rejected token (401),
a host that did not answer within the timeout, or one that could not be
reached. A redirecting URL is followed with the token kept and logged.
A silence or a star a Viewer token may not make is a failure toast
naming the role.

Settings, `[extensions.grafana]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `url` | text | unset | Where Grafana answers, scheme included. |
| `token` | secret | unset | A service account token. A `keychain:` or `env:` reference in the file. |
| `time_range` | text | unset | Appended to a dashboard's URL as `from=…&to=now` when set; empty opens the dashboard's own range. |
| `datasource` | text | unset | The Prometheus datasource the prompt runs against, by uid or name; empty is Grafana's default. |
| `queries` | list | five `Name = expr` lines | The saved queries listed before you type. |
| `sparklines` | number | `3` | How many time series panels the pane draws; `0` turns it off. |
| `timeout` | number (s) | `8` | How long one request may take. |

## Diff (`diff`, `diff-pick`)

Diff what you copied, from `extensions/diff/`. A view palette: opened
bare it compares the two newest text entries of the clipboard history,
the older on the left, so the diff reads as what changed on the way to
the newer copy. The header names both sides with when and where they
were copied and carries the counts as badges (`+12` green, `−4` red,
`whitespace only` amber, `no differences`); under it the lines on a
sunken surface, unified by default: both line numbers, the sign, the
text in monospace, removed lines on a red tint and added ones on a
green one (consecutive lines of one kind share the block), the words
that differ inside a changed pair on a stronger tint, a pair that
differs in whitespace alone tagged. `s` lays the two sides out side by
side. Runs of unchanged lines beyond the three of context fold to one
row ("⋯ 16 unchanged lines"); `tab` walks the folds, `space` or a
click expands one, `a` all. `w` ignores whitespace as `diff -w` does,
`x` swaps the sides, `enter` copies the unified diff, `l` and `r` the
left and right text, `o` opens the pair in an external tool (`tool`:
VS Code, kitty's diff kitten, FileMerge, Meld, or a custom command with
`{left}` and `{right}`; the sides written under the cache when they are
not files). Other pairs: `n` the two newest copies again, `e` the
clipboard against the selection in the app in front, `h` two entries
picked from the history, `f` two files from a form (a missing file, a
folder or a binary refused under its field; over 1 MB left to the tool).
Nothing to diff (one copy in the history, nothing selected) is a view
that says so and lists the ways in.

Diff from History (`diff-pick`, input, `multi`): the history's text
entries; `enter` on one takes it as the left side and lists the rest
for the right, or two marked (`tab`, `x`) and `enter` diff at once. The
Clipboard History palette has the same two actions on a text entry,
`Diff with…` and `Diff these two` (`cmd+shift+f`).

| keys | action |
| --- | --- |
| `enter` | Copy the unified diff |
| `o`, `cmd+enter` | Open both sides in the external tool |
| `s` | Side by side, or unified |
| `w` | Ignore whitespace, or mind it |
| `x` | Swap the sides |
| `l`, `r` | Copy the left, the right text |
| `tab`, `shift+tab`, `space`, `a` | Next fold, previous, expand it, expand all |
| `n`, `e`, `h`, `f` | The newest copies, clipboard vs selection, pick from history, two files |

Links: `pal://diff/clipboard`, `pal://diff/selection`,
`pal://diff/files?left=&right=`, `pal://diff/text?left=&right=`
(`left_label`, `right_label`), `pal://diff/history?left=<id>&right=<id>`.

Settings, `[extensions.diff]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `tool` | `auto`, `code`, `kitty`, `opendiff`, `meld`, `custom` | `auto` | What `o` opens the sides in; auto is the first installed. |
| `tool_command` | text | empty | With `custom`: the command line, `{left}` and `{right}` the two files. |

The diff is jsdiff (`diff` on npm). For the tests, `PAL_DIFF_PATH` is
searched for the tools and `PAL_DIFF_CACHE` takes the written sides.

## Turkish (`turkish`)

Turkish text tools, from `extensions/turkish/`. An input palette: what
you type (with nothing typed, the selection in the app in front, else
the clipboard's text) converted five ways, one row each, named by the
result with the conversion and the count of characters it touched
beside it (`unchanged` as a tag when none): Deasciified (`Turkce
yazilmis bir cumle` → `Türkçe yazılmış bir cümle`, the letters decided
by context: `sik` → `sık`, `kus` → `kuş`, `acik` → `açık`, `yas` →
`yaş`; Deniz Yüret's Emacs turkish-mode pattern table in Mustafa Emre
Acer's JavaScript port, the `turkish-deasciifier` package), Asciified
(the reverse table), UPPERCASE and lowercase the Turkish way (`i` → `İ`,
`ı` → `I` and back, the `tr` locale), Title Case (every word, a suffix
after an apostrophe kept down: `İstanbul'da`). `enter` pastes the row
into the app in front, over the selection when that is where the text
came from; `cmd+c` (and `cmd+enter`) copies; `cmd+t` hands the row to
Translate; `cmd+shift+c` copies the source. The detail pane holds the
whole converted text over the source.

| keys | action |
| --- | --- |
| `enter` | Paste (over the selection the rows came from) |
| `cmd+enter`, `cmd+c` | Copy |
| `cmd+t` | Translate the row |
| `cmd+shift+c` | Copy the source text |

Links: `pal://turkish/deasciify?text=…` (and `asciify`, `upper`,
`lower`, `title`) copies the result, `paste=1` pastes it; without `text`
the selection (else the clipboard) is converted and, from a selection,
pasted over it: a keybind that fixes the letters of what was just typed.

Settings, `[extensions.turkish]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `primary_action` | `paste`, `copy` | `paste` | What `enter` does on a row. |

Not done: a `{turkish …}` snippet placeholder (`sdk/src/placeholders.ts`
has a fixed grammar with no hook for an extension's source).

## Immich (`immich`, `immich-albums`, `immich-people`, `immich-memories`)

The Immich photo library from the panel, from `extensions/immich/`. An
input grid over Immich's CLIP search: what is typed goes to
`/search/smart` 300 ms after the last key ("a receipt", "dog on the
beach"), a file name (`DSC00500`, `IMG-20260418-WA0021.jpg`) to
`/search/metadata` by name, and nothing typed lists the newest uploads
under a Recent section. Every tile is Immich's own thumbnail rendition
(WebP, ~10 KB, fetched once into `~/Library/Caches/pal/immich`,
`$XDG_CACHE_HOME/pal/immich`, and sent as a data url), captioned with
the place and the day ("Serdivan · 3 May 2022"; a video leads with "▶"
and its length). `since:2025`, `before:2024-06`, `in:2023`,
`in:Ataşehir`, `type:video` and `is:favourite` / `is:archived` narrow
either search; the dropdown (`Tab`) limits to photos, videos,
favourites or the archive; a More tile pages on, 24 at a time. Every
search sends `visibility`, since v3 lists archived and hidden assets
when it is left out. The pane (open by default) is the preview
rendition large over when and where (the place a link to the map), the
camera, lens and exposure, the size, the file, the people, the albums
it is in and the tags, fetched lazily per photo.

`Enter` opens the photo on the web address (`web_url`, else `url`);
`⌘Enter` copies the link; `⌘⇧C` copies the picture itself (the
preview JPEG through `copyImage`, or as a file); `⌘Y` Quick Looks it
(macOS); `⌘S` downloads the preview and `⌘⇧S` the original (fetched
behind the panel, the HUD says when it landed) into `download_to` as
`<day>_<name>`; `⌘F` favourites or unfavourites; `⌘⇧A` opens the albums
as a picker (New album… first) and Enter there files the photos; `⌘⇧F`
copies the file name. The downloads, Favourite and Add to album take
marked rows (`⌘`-click, `⇧↑↓`). A root query nothing matched offers
"Search Immich for …".

**Immich Albums** (`immich-albums`, indexed, 5 minutes, lazy): every
album with its cover, count, date range and a `shared` tag, the ones
with photos first (changed last first), the empty ones last; `Enter`
opens the album as the grid, where a search runs inside it; `⌘Enter`
opens it in Immich, `⌘C` copies the link. A key that may read the
statistics gets an "Immich library" row on top (photos, videos, bytes
on disk). **Immich People** (`immich-people`, indexed, 10 minutes):
the named people, favourites first, with their face; `Enter` lists
their photos, a last row counts the faces without a name. **On This
Day** (`immich-memories`, live, 30 minutes): Immich's memories for
today, a row per past year with the count, the places and the first
picture; `Enter` lists that year's photos.

`pal://immich/search?q=…&filter=videos`, `pal://immich/album?name=…`
(or `id=`) and `pal://immich/person?name=…` open the grids from a
script or a keybind.

| keys | action |
| --- | --- |
| `enter` | Open in Immich |
| `cmd+enter` | Copy link |
| `cmd+shift+c` | Copy image |
| `cmd+y` | Quick Look (macOS) |
| `cmd+s` | Download preview |
| `cmd+shift+s` | Download original |
| `cmd+f` | Favourite or unfavourite |
| `cmd+shift+a` | Add to album… |
| `cmd+shift+f` | Copy file name |
| `cmd+i` | The detail pane |
| `tab` | Photos, videos, favourites, archive |

Settings, `[extensions.immich]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `url` | text | empty | Where the Immich API answers. |
| `api_key` | secret | empty | An API key from Account Settings › API Keys. |
| `web_url` | text | empty | Where links open when the site has another name than the API; empty: `url`. |
| `download_to` | folder | `~/Downloads` | Where the downloads go. |

`[palettes.immich.settings] columns` (3 to 10, default 6) is the tiles
per row. Without `url` or `api_key` every palette is one row that opens
Settings on the missing field; a refused key, a missing permission (a
403 names it) and an unreachable server each say so in one row or a
toast. For the tests, `PAL_IMMICH_CACHE` moves the cache directory and
`PAL_COPY_IMAGE` stands in for the clipboard copy.
## Disk Space (`space`, `space-map`, `space-largest`, `space-folders`, `space-cleanup`)

A big file finder and cleanup, from `extensions/space/`. **Disk Space**
lists where to look: Home, every mounted volume with its free space
(`/Volumes/*` on macOS; `/`, `/home` and the media mounts on Linux),
the folders scanned before with their size and age, `Scan a folder…`
with the path as a typed argument in the bar, and Cleanup suggestions.
Enter opens **Disk Map**, a view level: the root scanned (a parallel
Bun walk, ~7 s for a million-file home, the map drawn live as it
runs) and drawn as a squarified treemap of boxes inside boxes, area by
size, a folder's own children faintly inside it, the same children as
rows beside the board with size and share, the focused box described
on a footer line. A scan is packed into storage when it lands (the
biggest nodes under 56 KB per root, four roots), so the next open draws
at once, marked "scanned 2 h ago"; a zoom into a folder the saved tree
cut rescans that folder alone. Boxes are coloured by the kind that
weighs most below them (the `colour` setting, or `c`: by depth instead),
sizes are the blocks on disk (`sizes`, or `a`: apparent).

| keys | action |
| --- | --- |
| `enter` | Zoom into the focused folder; open a file |
| `cmd+enter` | Reveal in Finder / the file manager |
| `backspace`, `-` | Zoom out |
| `up` `down` `left` `right`, `hjkl` | Focus the box in that direction |
| `tab`, `shift+tab` | Next / previous by size |
| `m` | Mark or unmark for the trash |
| `cmd+d` | Move to Trash: the focused box, or every marked one (asks, naming count and size) |
| `space` | Quick Look (macOS) |
| `cmd+o`, `cmd+c`, `i` | Open, Copy path, Info (a detail level: kind, sizes, count, share, modified, owner) |
| `cmd+l` | Largest files under this folder |
| `c`, `a` | Colour by kind or depth; sizes on disk or apparent |
| `cmd+r` | Rescan this folder; while scanning, stop |

A click on a box zooms into it (a file: focuses it), on a row focuses
it, on a crumb zooms out to it. **Largest Files** and **Largest
Folders** list the biggest under the last root (or the one a row or a
link names), the kind as a tag and a filter by kind on the files;
open, reveal, Quick Look (`cmd+y`), show in the map (`cmd+m`), copy
path, info (`cmd+shift+i`), trash (`cmd+d`, marked rows together).
**Cleanup Suggestions** measures what is usually safe to clear (user
and package caches, Xcode's DerivedData, `node_modules` and cargo
`target` folders untouched for `stale_days` from the scans in hand,
downloads older than that, the Trash) and offers one destructive action
per row (`cmd+d`), asked first, everything to the Trash (Empty Trash is
the one final action, and says so). Trash is Finder's delete on macOS,
`gio trash` on Linux; `PAL_SPACE_TRASH` names a stand-in for the tests.

Links: `pal://space/scan?root=~/proj` (`rescan=1` scans again),
`pal://space/largest?root=…`. No bar item: free space is the stats
lane's. The research notes and the timings are in the extension's
README.

Settings, `[extensions.space]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `sizes` | `allocated`, `apparent` | `allocated` | What the boxes and rows measure. |
| `colour` | `kind`, `depth` | `kind` | What colours a box. |
| `cross_devices` | boolean | `false` | Walk into other file systems under the root (macOS firmlinks are always crossed). |
| `largest` | 10 to 1000 | `100` | Rows in the Largest lists. |
| `stale_days` | 1 to 365 | `30` | When a build folder or a download counts as stale. |

## Theater (`theater`, `theater-jellyfin`, `theater-jellyfin-search`, `theater-jellyfin-playing`, `theater-seerr-requests`, `theater-seerr-request`, `theater-radarr`, `theater-sonarr`, `theater-lidarr` and their `-add`, `-wanted`, `-history`, `theater-downloads`, `theater-downloads-history`, `theater-prowlarr`, `theater-prowlarr-search`, `theater-hydra-search`, `theater-navidrome`, `theater-navidrome-search`, `theater-abs`, `theater-abs-search`, `theater-kavita`, `theater-kavita-search`, `theater-shelfmark`, `theater-shelfmark-releases`, `theater-bazarr`, `theater/downloads`, `theater/playing`, `theater/requests`, `theater/queue`)

One extension for a self-hosted media stack: Jellyfin, Jellyseerr, Radarr,
Sonarr, Lidarr, Prowlarr, NZBHydra2, Bazarr, SABnzbd, qBittorrent,
Navidrome, Audiobookshelf, Kavita, Shelfmark, Filebrowser and Homepage.
Every service is a settings group (a URL and an API key, or a user and a
password) and only the ones filled in light up: an unconfigured service is
one "Set up X" row in the Theater palette (Enter opens Settings on its
first empty field), its own indexed palettes list nothing, and its search
palettes say what to set. Each service speaks its own API (the endpoints
are in `extensions/theater/README.md`); one client (`http.ts`) folds the
auth in and keeps a small cache.

| palette | id | kind | what `Enter` does |
| --- | --- | --- | --- |
| Theater | `theater` | live, 30 s | opens the service's web UI |
| Jellyfin | `theater-jellyfin` | live, 60 s | opens the item in Jellyfin |
| Search Jellyfin | `theater-jellyfin-search` | input | opens the item in Jellyfin |
| Now Playing on Jellyfin | `theater-jellyfin-playing` | live, 30 s | opens the item |
| Play on | `theater-jellyfin-play` | pushed | plays the item on that session |
| Requests | `theater-seerr-requests` | live, 60 s | opens the request in Jellyseerr |
| Request a title | `theater-seerr-request` | input | requests it (asks first) |
| Radarr, Sonarr, Lidarr | `theater-radarr`... | live, 60 s | opens in the app |
| Add a movie / series / artist | `theater-radarr-add`... | input | adds with the default profile and searches (asks first) |
| Wanted movies / episodes / albums | `theater-radarr-wanted`... | indexed, 5 min | searches for it now |
| Radarr / Sonarr / Lidarr history | `theater-radarr-history`... | indexed, 5 min | opens in the app |
| Downloads | `theater-downloads` | live, 20 s | opens the download client |
| Download history | `theater-downloads-history` | indexed, 2 min | opens the download client |
| Indexers | `theater-prowlarr` | indexed, 5 min | opens Prowlarr's indexers |
| Search indexers | `theater-prowlarr-search` | input | grabs through Prowlarr (asks first) |
| Search NZBHydra2 | `theater-hydra-search` | input | sends the NZB to SABnzbd (asks first) |
| Navidrome | `theater-navidrome` | live, 60 s | opens in Navidrome |
| Search Navidrome | `theater-navidrome-search` | input | opens in Navidrome |
| Audiobookshelf | `theater-abs` | live, 60 s | opens in Audiobookshelf |
| Search Audiobookshelf | `theater-abs-search` | input | opens in Audiobookshelf |
| Kavita | `theater-kavita` | live, 60 s | opens the web reader |
| Search Kavita | `theater-kavita-search` | input | opens the web reader |
| Request a book | `theater-shelfmark` | input | lists the releases for the book |
| Releases | `theater-shelfmark-releases` | pushed | downloads the release (asks first) |
| Subtitles | `theater-bazarr` | indexed, 5 min | opens in Bazarr |

**Theater.** Every configured service as a row: the tile, the version and
one key number in the subtitle (Jellyfin: who is watching; Jellyseerr:
pending requests; the arrs: the queue with the stuck count and any health
warning; SABnzbd: the speed, the queue and the free disk; qBittorrent:
active torrents and the connection state; Bazarr: what wants subtitles
and a throttled provider; Prowlarr: indexers and failing ones), a green
`up`, an amber `attention` or a red `down` tag with the error. Enter opens
the web UI, `⌘Enter` the service's palette in pal, ⌘K lists its other
palettes as drill-ins, `⌘C` copies the URL, `⌘R` probes again (the probes
cache 30 s, every one with its own 3.5 s timeout, all in parallel).
Filebrowser and Homepage are open rows.

**Jellyfin.** Continue Watching (the position as a percentage) then
Latest, the poster as the row's icon (Jellyfin serves images without a
key), an episode led by its series and code; favourites and played items
tagged. The pane: the poster, the overview, year, runtime, rating,
genres, watched state, when it was added. Search lists movies, series,
episodes, albums and songs by section 300 ms after the last key. On every
item: Open (`Enter`), Play on a device (`⌘Enter`: a picker of the
sessions that take remote control, Enter plays there), Mark played or
unplayed (`⌘⇧P`), Favourite (`⌘F`), Copy link (`⌘C`). Now Playing lists
the sessions with something on: user, device, client, the position,
paused or playing, transcoding tagged; `⌘Enter` pauses or resumes,
`⌘⇧S` stops (asks). The rows are about one user: `jellyfin_user`, else
the first administrator.

**Jellyseerr.** Requests, pending first, the title resolved from TMDB
through the server (cached an hour), the poster, who asked, the status
and 4K tags; the filter narrows to pending, approved, available or all.
On a pending one: Approve (`⌘Enter`), Decline (`⌘⇧D`, asks). Request a
title searches TMDB through Jellyseerr (people dropped), a title already
requested or available tagged; Enter requests (asks), `⌘Enter` in 4K when
the server enables it for that type, `⌘O` opens it, `⌘C` copies the TMDB
link.

**Radarr, Sonarr, Lidarr** (one module, `arr.ts`). The home palette:
the commands (Add, Wanted, History, Sync watchlist now, Open), the
health warnings from `/health`, the queue (the movie, episode or album
the record is about, the release, a state tag: downloading, importing,
`needs a hand` for an import that waits on a manual choice, `failed`,
`error`; the size, the percentage, the time left), then the next seven
days from the calendar. On a queue row: Open, Remove from queue (`⌘⌫`,
asks; removed from the client, never blocklisted), Copy release title.
Sync watchlist runs `ImportListSync` once per enabled import list by
`definitionId`, the form that ignores the Trakt list's hardcoded 12 h
refresh interval. Wanted: the newest 40 monitored items without a file
with a line saying how many more; Enter runs the search command for that
one (`MoviesSearch`, `EpisodeSearch`, `AlbumSearch`), `⌘Enter` opens it.
History: grabbed, imported, failed, deleted with the release, the quality
and the client's message. Add: a lookup, one already in the library
tagged; Enter adds with the first quality profile, root folder (and
metadata profile on Lidarr), monitored, and starts a search (asks);
`⌘Enter` adds without searching; `⌘O` opens it on TMDB, TVDB or
MusicBrainz.

**Downloads.** SABnzbd and qBittorrent as one queue, sectioned by
client, the active items first: the name, the category, the speed, the
time left, the size; a state tag (downloading, queued, paused, stalled,
metadata, checking, error) and the percentage. Pause all / Resume all
and Set speed limit on top (a form: a percentage or a rate such as `2M`
for SABnzbd, a rate for qBittorrent, `0` lifts it). On a row: Open the
client, Pause or Resume (`⌘Enter`), Delete with its files (`⌘⌫`, asks),
Copy name. qBittorrent 5 is driven with `stop`/`start`, older ones with
`pause`/`resume`; a bearer API key (5.2+) signs the requests, else the
WebUI user and password with a `Referer` on the login (without one
qBittorrent's CSRF guard reports a wrong password). Download history:
what SABnzbd completed or failed (the reason on the row and in the
pane), the torrents qBittorrent has finished; `⌘⌫` removes one from the
history (the torrent without its files).

**Indexers.** Prowlarr's indexers by protocol with priority and privacy,
a failing one red with Prowlarr's reason and when it retries, a
disabled one grey, Prowlarr's own health warnings on top; `⌘Enter`
runs the indexer's test. Search indexers asks every enabled indexer
(up to 30 s), the rows sectioned by indexer with size, age, category,
flags, seeders or grabs; Enter grabs the release through Prowlarr into
its download client (asks), `⌘Enter` opens the release page, `⌘C` copies
the magnet or download link. Search NZBHydra2 is the same over Hydra's
newznab API; Enter sends the NZB to SABnzbd when it is set up (asks),
else opens Hydra.

**Navidrome** (Subsonic API, a salted token per request, the password
never on the wire). What plays now (who, on what player), the albums
added lately with covers; search by artist, album and song; Enter opens
the album or artist in Navidrome's web app, `⌘S` stars or unstars, `⌘C`
copies the link. **Audiobookshelf**: continue listening with the
progress, then what was added lately per library; search over books,
podcasts and authors; Mark finished (`⌘⇧P`, asks). **Kavita**: On Deck
with the page reached, the series added lately; search over series,
collections, reading lists and files; Enter opens the web reader.
**Request a book** (Shelfmark): with nothing typed, what Shelfmark is
downloading, queued or failed on; a search on its metadata provider
lists books with the author, year and series; Enter pushes the
releases found for one (format, size, indexer, seeders) and Enter on a
release downloads it into the ebook library (asks) with the same
payload Shelfmark's own button posts. **Subtitles** (Bazarr): how many
movies and episodes want subtitles (Enter runs Bazarr's wanted-search
tasks, asks), each provider's health with a throttled one's retry, the
wanted items with the missing languages as tags; `⌘Enter` searches for
that one.

**The bar items**, each a `{ view }` popover with a cursor the arrows
move and a click sets, `p` opening the palette:
- `theater/downloads`: the combined download speed and the active count,
  amber and `paused · N` while everything is paused; hidden while both
  clients are idle. Every 15 s and on show, wake, network. The popover:
  the queue with a progress bar per row, Enter opens the client, `space`
  pauses or resumes everything, `⌘Enter` the focused item, `⌫` deletes it
  (asks). States `downloading`, `speed`, `paused`.
- `theater/playing`: who is watching on Jellyfin (the name, or the
  count); hidden while nothing plays. Every 30 s. The popover: the
  sessions with the poster and the position, `space` pauses or resumes
  the focused one. State `watching`.
- `theater/requests`: pending Jellyseerr requests as the badge, hidden
  at zero. Every 300 s. The popover: the requests with their posters, `a`
  approves, `d` declines (asks) the focused one. State `pending`.
- `theater/queue`: the arr queues combined, the stuck count as the
  badge and amber; hidden while empty. Every 60 s. The popover: each
  item with its state and progress, `⌫` removes the focused one (asks).
  States `queued`, `stuck`.

**Links.** `pal://theater/search?q=` and `pal://theater/request?q=`
open Search Jellyfin and Request a title with the query typed;
`pal://theater/downloads` opens Downloads; `pal://theater/pause-all` and
`resume-all` reach both clients; `pal://theater/sync-watchlist?app=radarr`
(both when omitted) runs the import list sync; `pal://theater/open?service=kavita`
opens a service's web UI.

Settings, `[extensions.theater]`: `<service>_url` for every service
(`jellyfin`, `seerr`, `radarr`, `sonarr`, `lidarr`, `prowlarr`, `hydra`,
`bazarr`, `sab`, `qbit`, `navidrome`, `abs`, `kavita`, `shelfmark`,
`filebrowser`, `homepage`); `<service>_key` (secret) for Jellyfin,
Jellyseerr, the arrs, Prowlarr, NZBHydra2, Bazarr and SABnzbd;
`qbit_key` (secret, a 5.2+ API key) or `qbit_user` and `qbit_password`;
`<service>_user` and `<service>_password` (secret) for Navidrome,
Audiobookshelf and Kavita; `jellyfin_user`, whose watched state the rows
show. For the tests, `PAL_THEATER_<SERVICE>_<URL|KEY|USER|PASSWORD>`
replaces any of them.
## DPI Bypass (`dpi`, `dpi-test`, `dpi/bypass`)

The owner's `dpi` script (`~/.local/bin/dpi`: byedpi as a SOCKS proxy
with the active network service's DNS and SOCKS pointed at it on macOS,
zapret and dnscrypt-proxy under systemd on Linux) as a toggle with an
indicator, from `extensions/dpi/`. The script is the engine; pal runs
`on`, `off`, `toggle`, `status` and `build` and draws what it says. A
live, normal palette: Turn on bypass / Turn off bypass leads it (Enter
runs the script, the panel hides, the HUD says the script's own line,
`dpi on (Wi-Fi -> socks5://127.0.0.1:1080, dns 1.1.1.1 9.9.9.9)`; the row
is in the root's Now section while on), then Status (the facts in the
detail pane: proxy, service, DNS, SOCKS, or the units and the DNS probe;
Enter copies the script's output), Test the bypass, Open the log and
Build byedpi (macOS; the build asks first and the HUD says when it
landed), Copy the status. A **partial** status (the proxy up but the
service's SOCKS or DNS not pointing at it, or a service still pointed at
a proxy that died; one Linux unit down, or both up with the resolver
still answering the block page) is amber with the reason on the row and
gets a Repair row: off, then on. Without the script, one row saying where
it lives, Enter on the `tool` setting. `on` and `off` take about five
seconds on macOS: waited for up to seven inside the pick, then the HUD
says it is under way and the line lands when the script finishes.

Bypass Test (`dpi-test`, a view): the script's `dpi test` run here one
curl per url, all at once, through `socks5h://127.0.0.1:<port>` while the
proxy is up on macOS, direct otherwise; each row the host and its url, a
`blocked` or `control` badge, the code as a badge (green 2xx/3xx, amber
4xx/5xx, red `000`) and the time, landing as each curl answers; the
header `2 blocked reach, 4 controls fine`, or what failed by host.
Opening the level runs it. `test_urls` is `url` or `url = blocked|control`
(the first two blocked without a role, the rest controls).

| keys | action |
| --- | --- |
| `enter` | Turn the bypass on or off; on Status, copy it; in the test, open the url |
| `cmd+t` | Test the bypass |
| `cmd+shift+r` | Repair: off, then on (while partial) |
| `cmd+c` | Copy the status; in the test, the report |
| `c` | Test: copy the row's line |
| `cmd+r` | Test: run it again |
| `up` `down` `j` `k` | Test: move the ring |

`pal://dpi/toggle`, `pal://dpi/on`, `pal://dpi/off` (the HUD says the
script's line), `pal://dpi/test` (the panel on the test level),
`pal://dpi/status` (the palette). States `dpi/on`, `dpi/state` (`off`,
`on`, `partial`), `dpi/service`.

The bar item `dpi/bypass`: a shield while on, hidden while off by its
`off` rule (`show = "always"` keeps a muted shield), amber by its
`partial` rule; refreshed every minute and on `show`, `wake`, `network`.
The popover: the status card with the facts, Enter turns it on or off,
`t` runs the test with its rows landing under the card, `r` repairs, `c`
copies the status, `l` opens the log (macOS), `o` opens the palette.

Linux: `sudo -n true` is probed before a switch; a closed credential
window is a toast saying to run `sudo -v` in a terminal, and nothing
runs. No log or build rows there.

Settings, `[extensions.dpi]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `tool` | path | `dpi` | The script, a name on PATH or a path; `~/.local/bin` is looked in too. |
| `test_urls` | list | the script's six | What the test curls, `url` or `url = blocked|control`. |
| `dns` | list | `1.1.1.1`, `9.9.9.9` | The resolvers `dpi on` sets on macOS, to judge partial; empty leaves DNS unjudged. |
