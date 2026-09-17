# Extension wishlist

Raycast Store pages Cagdas picked (2026-09-16, from his open tabs) as
extensions pal could carry. A list to consider, not a commitment; each
line says what the Raycast one does and how it would fit pal. Status:
`have` (a bundled extension covers it), `partial`, `todo`.

| Raycast extension | What it does | pal | Notes |
| --- | --- | --- | --- |
| [Hue](https://www.raycast.com/pindab0ter/hue) | Philips Hue lights, scenes, rooms | todo | Cagdas (2026-09-16 22:20): not partial; wants native-Hue-app quality with every feature (bridge pairing, rooms/zones, colour/temperature/brightness, scenes, schedules, sensors). Building |
| [Iconify](https://www.raycast.com/destiner/iconify) | Search 200k icons across sets, copy SVG | have | Icons' `iconify` palette (2026-09-17): the search API, every set, SVG copy / name / data url / save |
| [Gmail](https://www.raycast.com/tonka3000/gmail) | Unread mail, search, compose, mark read | todo | His token broker mints Gmail for both accounts; read and mark-read only for the work account (never send from it) |
| [TinyPNG](https://www.raycast.com/kawamataryo/tinypng) | Compress images from Finder selection or clipboard | todo | `images` extension: compress (pngquant/oxipng/mozjpeg local, TinyPNG API optional), resize, convert |
| [Google Maps Search](https://www.raycast.com/ratoru/google-maps-search) | Search places, directions from home/work | todo | Quicklink-like with saved places and travel modes |
| [WhatsApp](https://www.raycast.com/vimtor/whatsapp) | Open chats by contact | todo | His OpenWA on archer has the API; open chat, search history, send on explicit ask |
| [ScreenOCR](https://www.raycast.com/huzef44/screenocr) | Select a screen region, OCR to clipboard | partial | OCR core capability is being built (pit 21); add a region capture (`screencapture -i`) front |
| [Port Manager](https://www.raycast.com/lucaschultz/port-manager) | Ports in use, kill the owner | have | Processes: `:3000` mode |
| [Image Modification](https://www.raycast.com/HelloImSteven/sips) | Rotate, flip, resize, convert, strip EXIF via sips | todo | Same `images` extension as TinyPNG |
| [Shell](https://www.raycast.com/asubbotin/shell) | Run a shell command, show output | todo | `shell` palette: input mode, output as a view, history, run in terminal |
| [Downloads Manager](https://www.raycast.com/thomas/downloads-manager) | Latest downloads, open/reveal/delete, copy | partial | Files has recents; a Downloads palette newest first with size and quick actions |
| [GIF Search](https://www.raycast.com/josephschmitt/gif-search) | Giphy/Tenor search, copy GIF | todo | Grid palette over Tenor (free key), copy file or URL |
| [YouTube](https://www.raycast.com/tonka3000/youtube) | Search videos and channels | todo | Search rows with thumbnails, open; needs an API key or Invidious |
| [Pomodoro](https://www.raycast.com/asubbotin/pomodoro) | Focus intervals with a menu bar countdown | have | Timer's pomodoro mode (2026-09-17): work/break/long-break cycle on the CLI's timers, skip and stop, a per-day count |
| [Timers](https://www.raycast.com/ThatNerd/timers) | Named timers, presets, alarms | have | Timer extension |
| [Google Search](https://www.raycast.com/mblode/google-search) | Suggestions as you type, open | todo | Fallback row exists (pit 2); suggestions API adds live rows |
| [Obsidian](https://www.raycast.com/marcjulian/obsidian) | Search notes, daily note, append | todo | Vault at ~/Sync/vault; search, open in Obsidian or editor, append to daily, create |
| [Speedtest](https://www.raycast.com/tonka3000/speedtest) | Run a speed test in the panel | todo | Network extension: `speedtest-cli`/Ookla CLI with a live view |
| [Slack](https://www.raycast.com/mommertf/slack) | Unreads, search, status, presence | have | Slack extension (2026-09-16) |
| [Google Translate](https://www.raycast.com/gebeto/translate) | Translate typed or selected text | todo | Input palette; Google free endpoint or DeepL key; uses `selection.text()` once it lands (pit 19) |
| [Spotify Player](https://www.raycast.com/mattisssa/spotify-player) | Search, play, queue, like, devices | todo | Cagdas: a Spotify extension with an impeccable lyrics view (synced lyrics from lrclib.net). Building |

## Added by Cagdas (2026-09-16 22:20)

- **Multiple instances of one extension**: two Gmail accounts as two instances, each with its own settings, palettes and bar item (`[extensions.gmail.personal]`, `[extensions.gmail.work]`). An architecture item, designed first (docs/design/instances.md), then built into the host, the registry, the config, Settings and the store.
- **telawiki**: an extremely rich extension for tela (his wiki product): search and research, open/create/append pages, spaces, decks, sheets, with the panel's views. Building.
