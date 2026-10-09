# Changelog

## 0.16.1 · 2026-10-09

- **Emoji and icons stay below what you were looking for**: in search, Emoji, Icons, Unicode and the other big lists now show under every section that has the word you typed. `sync` lists your Home Assistant rows before the glyph named sync; when nothing else has the word, as with `smile`, the emoji still lead.

## 0.16.0 · 2026-10-09

- **Clock, built in**: the date and time on the bar, and a popover with the time to the second, the date and week, a month to walk through with the arrows, and world clocks (z adds a city). Enter opens the day in Calendar.
- **Calculator mixes currencies**: `50 usd + 20 try` or `$1.5k - 200 eur to eur` adds them up at the day's rates, shown in your home currency (or the one you name) and in the first one.
- **Highway tells a story**: Lina's texts along a 412 km trip home, rivals with a message of their own, and two endings. Stars are set at a person's pace, and cars open as you finish a region's stops.
- **Fixed: pal froze with Settings open** when a display was connected or removed.
- **Fixed: bar items flickered or went missing**: a Space switch could redraw the whole bar, an item coming back after being hidden stayed off it, an item placed next to a left-side item landed on the right, and a sync after a sketchybar reload put nothing back.

## 0.15.0 · 2026-10-08

- **Watch the best runs on a leaderboard**: a game can keep a replay with your best score, and anyone can watch the run behind a board's times. Highway is first: its replays panel shows the record holder's run beside yours and the 3★ run.
- **Fixed: ⌘→ and other modified arrows did nothing in a popover or the panel**, as with Spotify's next track; they now run their action, or do what the field would do.
- **Smoother lists when a row leaves**: the rows below slide up into its place as it fades, instead of jumping a row once it is gone.
- **Fixed: moving the cursor in a sized box could scroll it a row too far**, as in Games' grid.

## 0.14.2 · 2026-10-06

- **Fixed: a long row of chips squeezed its label to one letter a line**, as in Slack's "Also unread" (0.14.1's fix missed it); the chips now go on to the next line.

## 0.14.1 · 2026-10-06

- **Fixed: after closing a game in its large panel, pal could still open near the top-left corner** instead of in the middle of the screen.
- **Fixed: a long row of chips squeezed its label to one letter a line**, as in Slack's "Also unread"; the chips now go on to the next line.

## 0.14.0 · 2026-10-05

- **Two new games in the store**: **Ramparts**, a tower defense roguelike on a floating island diorama: three acts on a branching map, twelve towers that combine (frost then shatter, oil then fire), relics, commanders and ascensions. **Seedfall**, a mining game: dig through seven biomes to a sleeping Seed at the planet's core, haul ore home, upgrade, build rigs that mine while you're away, then launch the Seed and start on a new planet with permanent perks.
- **Game stats kept per enemy, tower or level now add up across your Macs** like the rest of your progress, however much a game adds later.

## 0.13.1 · 2026-10-05

- **Fixed: back from a game's large panel (⌘⇧F), pal opened near the top-left corner** instead of in the middle of the screen.

## 0.13.0 · 2026-10-05

- **A pal account, if you want one**: Settings › Account signs in with your email and a code, no password. Your settings and installed extensions follow you to a new Mac, so there is no setup step, and every earlier version is kept: History puts back any day's settings. Hotkeys, folders and where the bar draws stay on each Mac; a key from your keychain is asked for once.
- **Game progress on every Mac, never lost**: two Macs that both played are merged, keeping the best score, every unlock and both machines' play counts, never one overwriting the other. The games on play.cagdas.io share the same progress.
- **Leaderboards**: every game has its own, by mode, level or map, many with a daily run: a daily deal in Solitaire, a daily board in Minesweeper, daily dice in Yahtzee, each Wordle puzzle, Vortex's daily. Pick a name to show; signed out, your scores still count, marked anonymous, and every board can hide those. The Games shelf shows each game's boards (⌘L on a game).
- **Wordle's streak counts the daily puzzle only**, as in the original, so a streak kept on two Macs adds up.
- **play.cagdas.io** is the new home of the games in the browser, with the same account, progress and boards; progress saved on palplay.cagdas.io comes along.

## 0.12.1 · 2026-10-04

- **Fixed: a palette opened from the menu bar's popover drew its full-size layout** in the narrow popover. Battery & Power, opened by a click on the battery, showed an empty card with the rest one letter wide; it now stacks the level over the tabs. Displays, the Apple TV, the Samsung TV and Spaces lay out for the popover the same way.

## 0.12.0 · 2026-10-04

- **Apple TV, from the keyboard** (in the store): the clickpad on the arrows, your apps with their icons on the digits, typing into the TV's search, what is playing with its cover, chapters and a seek bar, links you copy played on the TV, and the remote in the menu bar's popover. Setup finds the Apple TV and takes the code it shows.
- **Samsung TV, from the keyboard** (in the store): the remote on the arrows, apps, the volume, power and inputs, typing whenever the TV shows its keyboard. Setup finds the TV; press Allow on it. Everything stays on your network.
- **Devices you use together**: Settings › Groups puts an Apple TV and a TV in one group, so the Apple TV's remote turns the TV's volume, switches its inputs, and power turns both on and off. Pick the two devices; the rest is set for you.
- **Everything playing, in one place**: Now Playing lists what plays on the Apple TV, the TV, Spotify and your Mac, and the empty panel's Now rows show each one. A new Playing card at the top shows whatever is playing, with a line for a second one; a click opens its own remote or player.
- **The magnifier at the root** sits on your query's letters, at a size that reads.
- **Fixed: an extension's name above the list was hard to read** on the dark panel when its colour was a deep one.

## 0.11.0 · 2026-10-03

- **A new look, Ink**: type-led and calm. What you type is the headline, the selected row carries its own keys, the panel is only as tall as its results and fades in as it opens. Inside an extension the panel glows in its colour. The previous look stays as Classic, and Frappé is Ink in Catppuccin colours: Settings › General › Design.
- **Answers first**: a sum, a conversion, the weather now, a translation or a generated password is the large first row, the rest under it.
- **Every popover leads with what matters**: the next meeting with its Join, the track playing, the time left on a timer, the battery, the temperature, the unread count, the alerts firing.
- **Details read like a page**: a pull request, a mail, an event, a container or a file opens with its name, its state and its numbers up top, then the rest.
- **At a glance**: on the empty panel, cards show your next meeting, what is playing, unread mail and the weather; ⌥1–⌥4 opens one. Pick them under Settings › General › Glance strip.
- **⌘K is a sheet** across the panel, in two columns; the arrows move across them.
- **Nothing found? Try these**: a search inside an extension that finds nothing offers to search the web, your files or ask instead. Lists on their way show their rows' outline instead of a blank.
- **Every extension went through**: shorter, plainer words, rows that say one thing, the right icon on each row, fresh store pictures.
- **Fixed: popovers jumped** when opened or switched, showing the last item's contents or an empty frame first; they now appear once their content is ready, and show a loading line while it refreshes.
- **Fixed: the loading bar never stopped** for some setups (a 1Password list waiting for its first visit).

## 0.10.2 · 2026-10-01

- **Night Parade picks up where you left it**: close pal mid-night and the night is waiting, paused, when you come back.
- **Night Parade, easier to win by getting stronger**: as Midnight and the Hour of the Ox begin, choose one of three blessings for the rest of the night (more damage, more projectiles, more area, faster cooldowns, armor, healing or speed). Every night now pays a bonus for how long you lasted, the bosses you beat and the dawn, and the results screen and the title tell you when the shrine has something you can afford.
- **Night Parade, fairer and easier to read**: the burrowing mole shows as a mound of earth moving toward you and gives you time to step away; arrows at the screen's edge point to chests, the golden tanuki and processions off screen; S while paused opens the game's settings; Settings › Night Parade has a volume slider.
- **Fixed: an extension could fail to load** after switching from a copy installed from source to the store's.

## 0.10.1 · 2026-09-30

- **Fixed: Check for Updates could take minutes** while the extensions that update by themselves were installed, and each of them was installed twice. The check now answers as soon as it has looked, says which extensions are updating, and they go in behind it, once.

## 0.10.0 · 2026-09-30

- **Read before you decide**: in the Gmail, WhatsApp, Slack and GitHub popovers, Space opens the row under the cursor in full: the whole mail, the chat's latest messages, a pull request's or issue's text and comments. Its keys still work there (`m` read, `s` star, `r` reply, Enter to open), and Space or Escape takes you back. In the compact panel, ⌘I does the same for any row with details.
- **Ignore until it changes**: `i` in those popovers (⌘⇧I on a row) takes something out of the count and the list until there is news: a chat or a thread until its next message, a pull request until it is pushed to, reviewed, commented on or its checks change. Then it comes back by itself. Nothing is sent: a WhatsApp chat stays unread on your phone, with no blue ticks. The palettes still list them, with Show again: WhatsApp's and Slack's Ignored filter, Gmail's Inbox, GitHub's Hidden filter beside your muted ones.
- **Check for Updates checks your extensions too**, from Settings › About, the menu bar icon or pal's own row, and says what it found; About has Update All for any waiting on you.
- **Settings › About** now holds the upkeep buttons (refresh every list, restart the extension host, reset the ranking) and links to the extension store, the changelog and a bug report.
- **GitHub notifications** show the pull request or issue behind them in the detail pane.

## 0.9.1 · 2026-09-30

- **Fixed: pal could freeze** while macOS showed a "pal wants to control …" prompt for a music app (Spotify, Music) that nobody had answered yet: the now-playing checks piled up behind it until the panel stopped opening. pal now checks once at a time and doesn't wait on the prompt.

## 0.9.0 · 2026-09-30

- **A lighter pal**: 33 extensions come with pal now, the ones that work with no account or setup; the other 47 install when you want them. The ones you use are installed for you on first start, from whichever version you come, with their settings and progress as you left them.
- **Browse extensions**: Settings › Extensions has a Browse view with big cards, categories, search and a few picks to start with, and each extension a page with its pictures in your theme, what it does and what it needs. The Store palette opens on Featured and one section per category; Games lists the ones you have first and the rest below, one Enter from playing.
- **Real logos**: GitHub, Gmail, Google, Spotify, Docker, Grafana, Home Assistant, Hue, Immich, Obsidian, 1Password, WhatsApp, YouTube and GIPHY wear their own logo and colour; pal's own tools keep theirs.
- **Clearer words**: every extension's description says plainly what it does for you.
- **pal.cagdas.io**: a new extension browser with search, categories and bigger cards, richer extension pages, and a few picks on the front page.

## 0.8.0 · 2026-09-30

- **Extensions update on their own**: a fix to an extension reaches you within hours instead of waiting for the next pal release. Every build is signed and checked before it installs; one that fails to load is put back to the one before by itself, and Settings says what happened. Settings › Extensions › Update extensions automatically turns it off, for everything or per registry.
- **Find extensions where you look**: type a name in pal and an extension you don't have yet shows below your own results, Enter installs it and opens it. Games lists every game with the ones you haven't installed marked, and Enter installs and starts one. Settings › Extensions has a Browse section, and each extension a page with what it does, its pictures and where it came from.
- **Install, turn off and remove without a restart**: nothing else reloads when an extension comes or goes. Turn an extension off without removing it; Remove keeps its settings and data for a reinstall, Remove and forget clears them. A link, hotkey or row that points at an extension you don't have says so and offers to install it.
- **Registries**: anyone can publish a list of extensions (a signed file on GitHub Pages is enough, with a ready GitHub Action), and you add one in Settings › Extensions › Registries or from a link. Extensions from a folder or GitHub install from the same page.
- **Anonymous usage counts**: pal now counts installs, updates and which extensions get opened, with a random id and nothing about what you type or pick. Settings › General › Share anonymous usage turns it off; pal.cagdas.io/docs/usage lists exactly what is sent.
- **Settings › General** gains the switches for pal's own update check and for extension updates.
- **Coming next**: pal will ship with a smaller set of extensions and install the rest when you want them. This version notes which ones you use, so they stay installed when that happens.

## 0.7.2 · 2026-09-29

- **Privacy**: see which app has your camera, microphone or screen. A bar item appears only while one is in use, with a glyph for each on an amber band, and a click lists every app with what it holds and for how long. The app is named even when a helper or a command does the recording (`ffmpeg` in kitty reads kitty).
- **Store pictures in both themes**: every extension's screenshots, on pal.cagdas.io and in the Store palette, come in light and dark and follow your setting. The bar pictures show the item as the menu bar and sketchybar really draw it.
- **Argument fields**: fields a row asks for (a timer's duration and name) now show in the search bar; the search keeps its words whole beside them.
- **Files**: Open with… says Search apps over its list of apps.
- **Fixed**: a selected line in Diff no longer paints over its neighbours; Solitaire's first deal turns its cards in order; Bluetooth's device tiles and the AirPods glyph draw properly; three weather glyphs were one off (fog, snow, thunder); Images falls back to the next tool when pngquant turns a picture down; Slack's popover times fit; YouTube's publish date and Space's status line read cleanly, and Docker.raw is no longer a photo; settings are named by their label in hints ("Set Data API key"), not in backticks.

## 0.7.1 · 2026-09-27

- **Searches show what they have right away**: the fast part of a search appears at once and the rest joins below it, instead of the list waiting for the slowest part. Files lists name matches before the matches inside files, GitHub your own items before the rest, Gmail and WhatsApp messages before their pictures and contact names, Immich, GIFs and Spotify rows before their images, Maps your saved places before the lookup. The row you are on stays put while rows arrive.
- **Google Search results in the list**: with Show results set to As I type, the answer and the top five results join the list under the suggestions once you pause typing (one search per pause, none while you keep typing).
- **Fixed: focus after closing pal**: closing the panel sometimes left the keyboard with pal's invisible window, so typing did nothing until you clicked or switched Space. The app you were in gets it back now.
- **Sudoku**: quieter pencil marks, a clearer mistake count that shakes when one is added, undo takes back the mistake too, and the selected cell can be let go with a click.
- **Crossword**: the big panel scales the whole page, so the clues and lists grow with the grid.
- **For extension authors**: `ctx.partial(items)` shows rows while a slow `list` is still working (docs: Slow listings).

## 0.7.0 · 2026-09-26

- **Sudoku**: puzzles made on your Mac, a daily one per difficulty from Easy to Expert, graded by the techniques a person needs. Pencil marks without a mode: type a second digit over one you placed and the cell becomes notes, or right-click a pad key. Auto notes (C) keeps every cell's candidates up to date while you only take marks out, digit first (D) lights every cell a digit can still go, and hints come in three steps: where to look, why in plain words, then the move.
- **Crossword**: daily minis from Crosshare in the manner of the NYT Mini, and the Turkish papers' kare bulmaca (HaberTürk, Cumhuriyet, Sabah) with Turkish letters typed on any keyboard. Browse opens on every half-done puzzle.
- **Battery & Power**: one view of what drains the battery. Six hours of draw with the time on the charger shaded, what uses power now with the watts and why (CPU, wakeups, disk, network), and what used the battery today, this week and ever, in watt-hours, with the power watcher installed. The bar popover shows the last hour and the top four.
- **Google Search**: suggestions as you type, Tab to complete, a Wikipedia card for people and places, and up to three suggestions at the root when nothing on your Mac matched. Results from SerpApi, Brave Search or your own SearXNG with a key.
- **Dates and times in the calculator**: `3pm in tokyo`, `next friday`, `days until 25 dec`, `workdays until 25 dec`, `what week is it`, `@1759000000`, `3h20m + 45m`; Turkish month and day names work too.
- **Join a call from the top of pal**: the root's Now row shows your next event, and five minutes before a call it turns into a Join row (Enter joins).
- **Hide the clock** in every timed game (Sudoku, Crossword, Minesweeper, Solitaire, Typing): a setting, or T while playing. Your times still count.
- **Bigger game panels**: ⌘⇧F plays a game at 90% of the screen, ⌘⇧J in a small panel in the corner, and each game remembers how you left it.
- Animations always play, whatever the system's reduce motion setting says.

## 0.6.0 · 2026-09-25

- **Flashcards**: spaced repetition for the minute a build takes. A card on a stack: space flips it, → "Knew it" throws it right and ← "Didn't know" left (or drag it), and each answer says when the card comes back. Every answer is saved as you give it, so Escape at any moment loses nothing. Scheduled with FSRS, the algorithm Anki uses.
- **Short sessions** of ten cards with a summary: the words you missed, the new ones and any you mastered, and how much of everyday Spanish your words now cover. `d` drills the misses until they stick.
- **Learn Spanish out of the box** with Jeff Doozan's *6001 Spanish* (the most used words, each with an example sentence) and everyday phrases. Words come in both directions: recognise first, then type it, with a missing accent or article counted as close and shown where.
- **Any Anki deck works**: drop an `.apkg` into the packs folder, and its native audio plays on Tab. **Browse Anki Decks** searches AnkiWeb's shared decks right in pal, with ratings and sample cards, and Enter adds one.
- A daily goal and a streak, stats with a heatmap and the week ahead, ⌘E to fix a card's meaning, `?` for every key, and a row at the top of pal while cards are due.
- **Typing**: a monkeytype-style typing test. Time, word-count or zen tests with punctuation and numbers, a smooth caret, and a result with wpm, accuracy and a second-by-second chart; personal bests, a stats page and history, and an optional pace caret to race.

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
