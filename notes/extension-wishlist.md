# Extension wishlist

Raycast Store pages Cagdas picked (2026-09-16, from his open tabs) as
extensions pal could carry. A list to consider, not a commitment; each
line says what the Raycast one does and how it would fit pal. Status:
`have` (a bundled extension covers it), `partial`, `todo`. Checked
against `extensions/` on 2026-09-28: every row is covered.

| Raycast extension | What it does | pal | Notes |
| --- | --- | --- | --- |
| [Hue](https://www.raycast.com/pindab0ter/hue) | Philips Hue lights, scenes, rooms | have | `extensions/hue`: guided pairing, rooms, lights and scenes, colour/brightness/temperature, sensors and automations, a bar item |
| [Iconify](https://www.raycast.com/destiner/iconify) | Search 200k icons across sets, copy SVG | have | Icons' `iconify` palette (2026-09-17): the search API, every set, SVG copy / name / data url / save |
| [Gmail](https://www.raycast.com/tonka3000/gmail) | Unread mail, search, compose, mark read | have | `extensions/gmail`, `multi` (personal and work); read and mark-read only on the work account |
| [TinyPNG](https://www.raycast.com/kawamataryo/tinypng) | Compress images from Finder selection or clipboard | have | `extensions/images`: compress, resize, convert |
| [Google Maps Search](https://www.raycast.com/ratoru/google-maps-search) | Search places, directions from home/work | have | `extensions/maps` |
| [WhatsApp](https://www.raycast.com/vimtor/whatsapp) | Open chats by contact | have | `extensions/whatsapp` over his OpenWA |
| [ScreenOCR](https://www.raycast.com/huzef44/screenocr) | Select a screen region, OCR to clipboard | have | `extensions/screenshots`: area/window/screen capture, and Copy text (Vision OCR) on any capture |
| [Port Manager](https://www.raycast.com/lucaschultz/port-manager) | Ports in use, kill the owner | have | Processes: `:3000` mode |
| [Image Modification](https://www.raycast.com/HelloImSteven/sips) | Rotate, flip, resize, convert, strip EXIF via sips | have | `extensions/images` |
| [Shell](https://www.raycast.com/asubbotin/shell) | Run a shell command, show output | have | `extensions/shell`: input mode, output as a live view, history |
| [Downloads Manager](https://www.raycast.com/thomas/downloads-manager) | Latest downloads, open/reveal/delete, copy | have | `extensions/downloads` |
| [GIF Search](https://www.raycast.com/josephschmitt/gif-search) | Giphy/Tenor search, copy GIF | have | `extensions/gifs` |
| [YouTube](https://www.raycast.com/tonka3000/youtube) | Search videos and channels | have | `extensions/youtube` |
| [Pomodoro](https://www.raycast.com/asubbotin/pomodoro) | Focus intervals with a menu bar countdown | have | Timer's pomodoro mode (2026-09-17): work/break/long-break cycle on the CLI's timers, skip and stop, a per-day count |
| [Timers](https://www.raycast.com/ThatNerd/timers) | Named timers, presets, alarms | have | Timer extension |
| [Google Search](https://www.raycast.com/mblode/google-search) | Suggestions as you type, open | done | `extensions/google`: suggestions per keystroke, Tab completes, results with SerpApi/Brave/SearXNG, root suggestions under Search the web (`lateFallback`) |
| [Obsidian](https://www.raycast.com/marcjulian/obsidian) | Search notes, daily note, append | have | `extensions/obsidian` over ~/Sync/vault |
| [Speedtest](https://www.raycast.com/tonka3000/speedtest) | Run a speed test in the panel | have | `extensions/speedtest` |
| [Slack](https://www.raycast.com/mommertf/slack) | Unreads, search, status, presence | have | Slack extension (2026-09-16) |
| [Google Translate](https://www.raycast.com/gebeto/translate) | Translate typed or selected text | have | `extensions/translate` |
| [Spotify Player](https://www.raycast.com/mattisssa/spotify-player) | Search, play, queue, like, devices | have | `extensions/spotify`, with the synced lyrics view |

## Added by Cagdas (2026-09-16 22:20)

- **Multiple instances of one extension**: two Gmail accounts as two instances, each with its own settings, palettes and bar item (`[extensions.gmail.personal]`, `[extensions.gmail.work]`). Built: `docs/design/instances.md`, `multi` in a manifest (gmail, github, slack, home-assistant).
- **telawiki**: an extremely rich extension for tela (his wiki product): search and research, open/create/append pages, spaces, decks, sheets, with the panel's views. Built: `extensions/tela`.
