# pit triage: the `in` lane against pal

Every idea of the pit board `pali` (`in` lane, 406 cards, dumped 2026-09-16) read against what pal has today: `notes/decisions.md`, `docs/*.md`, the 36 bundled extensions' `pal.json`, `app/src/ui/keys.ts`, the Settings pages and `docs/design/bar.md`. `in` means relevant, never a commitment; this file says what is already there and what a pull would cost.

Classes: **done** (pal has it; where), **partial** (what is missing), **missing**, **not for pal** (Windows-only, Raycast's business, cloud AI, or against a decision already made). `V:`/`E:` are value and effort, S/M/L, on `missing` and `partial` rows only. Ids are the pit card ids; the number before each is the card's position in the dump, which is how rows refer to each other.

## Counts

| class | ideas |
| --- | --- |
| done | 142 |
| partial | 104 |
| missing | 80 |
| not for pal | 80 |
| total | 406 |

Per area (done / partial / missing / not for pal):

| area | done | partial | missing | not for pal |
| --- | --- | --- | --- | --- |
| Core / launcher | 14 | 7 | 3 | 0 |
| Search and ranking | 7 | 18 | 9 | 2 |
| Keyboard | 4 | 6 | 2 | 0 |
| Clipboard | 9 | 6 | 4 | 0 |
| Window management | 3 | 4 | 2 | 1 |
| Snippets and quicklinks | 3 | 6 | 9 | 0 |
| Calendar | 1 | 2 | 1 | 0 |
| Files | 3 | 6 | 8 | 1 |
| System | 11 | 7 | 12 | 4 |
| Extensions API, scripts and store | 69 | 33 | 24 | 16 |
| Settings | 8 | 3 | 4 | 3 |
| Bar / menu bar | 3 | 0 | 0 | 1 |
| Onboarding | 0 | 2 | 0 | 0 |
| Sync, import and export | 0 | 2 | 0 | 0 |
| AI | 0 | 0 | 0 | 20 |
| Platform, product and business | 7 | 2 | 2 | 32 |

## Core / launcher

| # | id | idea | class | V/E | pal today, and the fit |
| --- | --- | --- | --- | --- | --- |
| 1 | `01M2KJSVCWR3V17WXF3JFAKEM2` | core: Global hotkey to open and close the launcher | done |  | `general.hotkey` (string or list, presets, Spotlight detection, per-entry status): `hotkey.rs`, Settings > General |
| 2 | `01M2KJSVCWR3V17WXF3JWQ0F8S` | core: Overlay launcher window (floating, no app switch) | done |  | non-activating NSPanel, no Dock icon, pre-painted and never ordered out: `panel/macos.rs` |
| 3 | `01M2KJSVCWR3V17WXF3N0VBBQK` | core: Compact vs Expanded window mode | missing | V:S E:M | `general.window_mode = compact`: search row only at the empty query, list appears on typing; the panel already resizes to content (`auto_resize`), so it is a body toggle |
| 4 | `01M2KJSVCWR3V17WXF3TY3J88H` | core: Pop to Root Search timeout | partial | V:M E:S | Missing: the timeout. Today every show is `launcher.reset()` (App.tsx `pal://shown`), so a reopen never lands where you left. Fit: `general.pop_to_root = 0 \| seconds`; keep the level while the hide is younger than that |
| 5 | `01M2KJSVCXJDEVAJVB8A5H9ZJE` | core: Menu bar icon and system tray icon | done |  | tray with Open, Settings, Restart host, Check for updates, Quit: `tray.rs`, `general.menu_bar_icon` |
| 6 | `01M2KJSVCXJDEVAJVB8BP20E99` | core: Launch at login and login-item repair | done |  | LaunchAgent written by pal, handover from a hand start, crash relaunch: `autostart.rs`, `crash.rs` |
| 7 | `01M2KJSVCXJDEVAJVB8G2ZBZGP` | core: Auto-updater with privileged daemon | partial | V:L E:M | Missing: download and install (the check, the daily loop, About and Overview lines exist: `updater.rs`, `settings::Checks`). Fit: `tauri-plugin-updater` is already the dependency; wire install + relaunch behind the tray item that is disabled today |
| 8 | `01M2KJSVCXJDEVAJVB8R2NBC0R` | core: Logs, diagnostics and debug commands | done |  | log file with rotation, Copy Diagnostics, last crash and panic under About: `crash.rs`, `SettingsAbout.tsx` |
| 9 | `01M2KJSVCYQ16H34C0PQYH7J3J` | core: App lifecycle: quit, single instance, crash recovery | done |  | single-instance socket, host supervised with 2 s stop, `RunEvent::Exit` flush, launchd `KeepAlive`: `cli.rs`, `host.rs`, `autostart.rs` |
| 10 | `01M2KJSVCYQ16H34C0PSJMS79G` | core: Multi-window shell and window handoff | done |  | panel, settings, HUD and bar popover are four windows on one bundle: `settings.rs`, `hud.rs`, `bar/popover.rs` |
| 11 | `01M2KJSVCYQ16H34C0PWACMKE1` | core: HUD, toast, alert and dialog surfaces | done |  | `Hud`, `Toast`, `Confirm` components; `hud`/`toast` effects, `action.confirm` |
| 39 | `01M2KJSVD3C26CH27BJZ9NW846` | core: Favicon provider setting | done |  | favicons are fetched from the site itself and cached, no third-party provider (`core/src/icons.rs`); a provider choice is not needed |
| 49 | `01M2KJSVD3C26CH27BMC4FFREC` | core: raycast:// URL scheme and command-launch deeplinks | done |  | `pal://open/<ext>/<palette>?q=`, `pal://run/...`, `pal://install/<spec>`, `pal://settings/<page>`, `pal://bar/...` with confirm cards: `deeplink.rs`, `docs/cli.md` |
| 50 | `01M2KJSVD3C26CH27BMD9KEVT1` | core: Feature deeplinks catalog | partial | V:S E:S | Missing: create links (`pal://create/quicklink?url=`, `.../snippet?text=`) and `pal://confetti`. Fit: two more routes in `deeplink.rs` pushing the existing forms prefilled (needs 187) |
| 52 | `01M2KJSVD3C26CH27BMKAYKR13` | core: Localhost control socket (aster-endpoint) | done |  | single-instance socket driven by `pal toggle\|show\|hide\|settings\|reload\|quit\|bar ...` and `pal://` links: `cli.rs`; the dmenu half is 329 |
| 56 | `01M2KJSVD7AE742Y64536RRXYR` | core: Permissions registry and per-feature gating | done |  | `permissions.rs`: Accessibility, Calendars, Full Disk Access, Input Monitoring probed, Overview rows with Grant, polled while missing |
| 57 | `01M2KJSVD7AE742Y6455QDBRMT` | core: Frontmost app tracking for paste targets and app toggling | partial | V:S E:S | Missing: naming the target app on paste rows ("Paste into Slack"). Paste and focus hide first so the front app is right. Fit: capture `NSWorkspace.frontmostApplication` on show, send it with `pal://shown`, the footer shows it on paste actions |
| 132 | `01M2KJSVDJ2SF0Q1A8N72MRQF2` | builtin: Feedback, Manual and Changelog commands | done |  | Documentation, Report a Bug (issue prefilled), Copy Diagnostics rows: `commands.rs`; no changelog row, the release notes are on GitHub |
| 329 | `01M2KJSVH4TCMWJRCGAB4V5JQD` | beyond: dmenu mode (stdin in, selection out) with exit codes, multi-select | missing | V:L E:M | `pal pick [--prompt] [--multi]` (and `pal menu`): lines on stdin become a scratch list level over the single-instance socket, the panel shows, Enter prints the pick to the caller's stdout (exit 1 on Escape, `--json` for rows with `title`/`subtitle`/`icon`); `robot`, skhd and fzf-style scripts get the panel as their UI. The decisions already call it the natural bridge |
| 330 | `01M2KJSVH4TCMWJRCGAEV57SKF` | beyond: Socket/IPC API to push content into the open window or switch mode | partial | V:S E:S | Missing: pushing rows into the open panel from outside. `pal://open?q=` types a query, `pal://run` runs. Fit: 329's socket message `show { rows }` reused by scripts and by `bar.update` |
| 331 | `01M2KJSVH4TCMWJRCGAHPNNMZ7` | beyond: Pipe text or files into the launcher as an object | partial | V:S E:S | Missing: `pal show --query <text>` and a file argument becoming the selected object. `pal://open?q=` covers the query. Fit: `pal show <path>` opening files' Open with… level for it |
| 333 | `01M2KJSVH4TCMWJRCGAHZBKMC6` | beyond: Deeplink extras (toggle, provider filter, reload, install URIs) | done |  | `pal://toggle`, `pal://open/<ext>/<palette>`, `pal reload`, `pal://settings/<page>`: `docs/cli.md` |
| 348 | `01M2KJSVH8JA3CZ8Q49193D4WY` | beyond: Compact search-box mode, monitor pick, close-on-focus-loss | partial | V:S E:S | Missing: compact mode (3). Position on the pointer's screen, hide on focus loss, follow-system theme are in |
| 355 | `01M2KJSVH8JA3CZ8Q49JQVC471` | beyond: Large Type | missing | V:S E:S | a `pal:large-type` shell action (cmd+L) on any row: the row's name or the query drawn huge on a full-screen transparent panel like the HUD's, any key closes; an OTP code or an IP read across the room |

## Search and ranking

| # | id | idea | class | V/E | pal today, and the fit |
| --- | --- | --- | --- | --- | --- |
| 12 | `01M2KJSVCYQ16H34C0PZYPP4T0` | core: Root search: unified index of everything launchable | done |  | one index over every palette's rows, palettes as sections: `core/src/index.rs`, `registry.rs` |
| 13 | `01M2KJSVCYQ16H34C0Q201VJ3G` | core: Fuzzy matching and Root Search Sensitivity | partial | V:S E:S | Missing: a strictness setting. nucleo per-field matching is fixed (`notes/matching.md`). Fit: `general.match = strict\|normal\|loose` mapping to nucleo's config; low value, the current tuning was benchmarked |
| 14 | `01M2KJSVCYQ16H34C0Q30EAKBN` | core: Ranking with frecency and Reset Ranking | partial | V:M E:S | Missing: per-item Reset Ranking (Settings > General has only Forget all: `general:frecency`). Fit: a `pal:reset-ranking` shell action in cmd+K on any row, dropping that id from `frecency.json` |
| 15 | `01M2KJSVCYQ16H34C0Q44SZF2P` | core: Search history recall | missing | V:M E:M | Up at the top of the root list recalls previous queries, Down goes forward; the last 50 queries in the profile dir, never synced, a Reset under Maintenance |
| 16 | `01M2KJSVCYQ16H34C0Q6FXRQ3B` | core: Favorites section | missing | V:S E:M | A `pal:pin` action putting a row in a Pinned section at the top of the empty root, reorder with cmd+up/down, stored as `[general] pinned = ["apps/Slack"]`. Frecency covers most of this already |
| 17 | `01M2KJSVCYQ16H34C0Q8BFQMBK` | core: Suggestions, recents and the empty root list | partial | V:M E:S | Missing: contextual rows at the empty root (next event, recent files); today the empty root is palettes + apps by frecency plus Welcome. Fit: a palette flag `root_empty: n` letting its first n rows sit above the frecency list (calendar's next event, files' recents) |
| 18 | `01M2KJSVCYQ16H34C0QAK8XK66` | core: Per-command alias | partial | V:M E:S | Missing: an alias on an item (only palettes take `alias`, and it is a keyword, not a jump). Fit: `[palettes.<id>] item_aliases = { left_half = "lh" }` next to `item_hotkeys`, an exact alias getting `EXACT_BONUS`; a Set Alias action in cmd+K writing it through `edit::set` |
| 19 | `01M2KJSVCYQ16H34C0QE9RBKWA` | core: Per-command global hotkey | partial | V:M E:S | Missing: setting item hotkeys from the UI (`item_hotkeys` is config-only, `hotkey.rs Target::Item` works). Fit: a Record Hotkey action in cmd+K and a row in the Palettes pane's Item hotkeys section |
| 22 | `01M2KJSVCYQ16H34C0QKNBQFBT` | core: Disable, hide and re-enable items in root search | partial | V:S E:S | Missing: hiding one item (only `[palettes.<id>] enabled`). Fit: `[palettes.<id>] hide = ["id"]` filtered in `index::fetch`, plus a Hide action; re-enable in the Palettes pane |
| 23 | `01M2KJSVCYQ16H34C0QQEVTBAC` | core: Command arguments in the search bar | partial | V:M E:M | Missing: typed argument fields. Today an argument is a `push` with `args`, or a quicklink's `{query}` drill-in. Fit: `Item.args: [{ id, placeholder, kind }]` drawn as inline fields after Enter (or alias+space), values arriving as `ctx.args`; scripts get them as `PAL_ARG1..3` |
| 24 | `01M2KJSVCYQ16H34C0QTV37PGQ` | core: Fallback commands when nothing matches | missing | V:L E:M | `general.fallbacks = ["quicklinks/google", "files/files", "calc/calc"]`: when a query has no hit (or under the hits), rows "Search Google for X" that push the palette with the query typed; a palette opts in with `fallback: true` (takes the query as its input). The most-used Raycast path pal lacks |
| 25 | `01M2KJSVCYQ16H34C0QY3FRM7P` | core: Inline results in root: math, colors, translation, URLs, paths | partial | V:L E:M | Missing: root answers. Calc, colors' convert and the URL/path cases are input palettes you open first (`docs/palettes.md` says so). Fit: an input palette declares `match: <regex>` (calc `^[\d(.]`, colors `^#\|^rgb`, url `^https?://\|\.\w{2,}$`, path `^[~/]`); the core forwards a matching root query to it and shows its rows inline under the hits, with an "Open in browser" / "Open in Finder" shell row for url and path |
| 26 | `01M2KJSVCYQ16H34C0QYYQKPVG` | core: Customize Search: files, file content, contacts and agents in root | partial | V:S E:S | Missing: a Launcher-style toggle set. `enabled`, `tier`, `root_caps` cover most. Fit: nothing beyond 25 and 87; leave |
| 62 | `01M2KJSVD8VFVAYT1FGD7J1KHN` | builtin: Inline natural-language calculator | partial | V:L E:M | Missing: the root. The calculator itself is rebuilt (arithmetic, units, currency, dates, zones: `extensions/calc`) but input-only. This is 25 |
| 63 | `01M2KJSVD8VFVAYT1FGDGFVAY2` | builtin: Unit, currency and crypto conversion | partial | V:S E:S | Missing: crypto (frankfurter has none, documented). Fit: a second source (CoinGecko simple price) behind `rate_source`, fetched lazily like the ECB set |
| 64 | `01M2KJSVD8VFVAYT1FGEZV2WDV` | builtin: Time zone and date math in the calculator | done |  | zones, cities, offsets, date arithmetic, counts, unix time: `extensions/calc/dates.ts` |
| 65 | `01M2KJSVD8VFVAYT1FGG0SGKXP` | builtin: Percentages, durations and work-time calculations | partial | V:S E:S | Missing: `145 mins to timespan`, `55h in workdays`, `week %`. Percent forms are in. Fit: three rewrites in `math.ts` and a `work_hours` setting |
| 66 | `01M2KJSVD8VFVAYT1FGJ6FDSZC` | builtin: Calculator History | missing | V:S E:S | A `history` palette in calc over `storage` like colors' (last 100 answers, pin), plus "Put answer in search" |
| 67 | `01M2KJSVD8VFVAYT1FGK0JB602` | builtin: Color conversion and preview in root search | partial | V:M E:S | Missing: at the root; `convert` is an input palette. Fit: 25 with `match: ^#\|^rgba?\(\|^hsl` |
| 130 | `01M2KJSVDJ2SF0Q1A8N22A6C6F` | builtin: URL quick-open and web searches | partial | V:M E:S | Missing: a typed url or domain opening in the browser; searches are quicklinks with `{query}`. Fit: the url/path row of 25 (`^https?://` or a bare `host.tld`), Enter opens, cmd+C copies; Google / DDG as bundled quicklinks that 24 can name as fallbacks |
| 211 | `01M2KJSVG8R9ZF565JRYXAP2RF` | ext-api: @raycast/utils: useFrecencySorting | done |  | frecency in the core for every indexed palette, per profile: `index.rs` |
| 237 | `01M2KJSVGC29K4JCR17RKBR55Q` | ext-api: Dynamic root-search items from extensions (gap: static manifest) | done |  | every palette's rows are root rows, live palettes relist on show, scripts add tables: the root is the union by design |
| 317 | `01M2KJSVH21VZCFD6ZM758Z4WB` | beyond: Global vs triggered vs fallback handler taxonomy | partial | V:M E:M | Missing: the fallback class. Global (indexed and live rows at the root) and triggered (input palettes, aliases) exist. Fit: 24 |
| 318 | `01M2KJSVH3TSHV3PNZE1NXEW30` | beyond: Regex- and context-gated plugin activation | missing | V:M E:M | the mechanism behind 25 and 352: a palette's `match` regex (and `clipboard: true`) deciding when it answers at the root without being opened |
| 336 | `01M2KJSVH4TCMWJRCGAWY3CY4B` | beyond: Selectable matching algorithm and sort method | not for pal |  | nucleo per-field matching was chosen on benchmarks (`notes/matching.md`); a matching-algorithm switch is not a knob pal wants |
| 340 | `01M2KJSVH7583GA05ANKD5Z1JR` | beyond: Query history recall (!!) and input history browsing | missing | V:S E:S | with 15 |
| 341 | `01M2KJSVH7583GA05ANPGBDSVP` | beyond: Direct vs indirect aliases and alias+space into a command's query | partial | V:M E:S | Missing: alias + space jumping into the palette with the rest of the query typed (the docs say alias is only a keyword). Fit: in the Launcher, a query starting with `<alias> ` where alias matches exactly one palette pushes it and keeps the remainder as the level's query; typed in one motion, no Enter |
| 342 | `01M2KJSVH7583GA05ANQM7WV1G` | beyond: Spotlight Quick Keys auto-suggested from usage | missing | V:S E:M | suggest an alias for a row picked N times with a long query ("Set `gc` for Google Chrome?" as a Welcome-style row); after 18 |
| 344 | `01M2KJSVH7583GA05ANWGF5MMD` | beyond: On-device personalized ranking and contextual suggestions | partial | V:S E:M | Missing: context (front app) in the ranking. Frecency is per row. Fit: a second frecency key `<bundle id>/<row>` blended at 30% when the front app on show has history; cheap in `index.rs`, measure before keeping |
| 347 | `01M2KJSVH8JA3CZ8Q48VPWJYK3` | beyond: Plugin weight and results-order tuning | done |  | `tier`, `root_caps`, `rank`, `EXACT_BONUS`: `docs/extensions.md`, `index.rs` |
| 370 | `01M2KJSVHCQD0A9ASDXD5B954S` | beyond: Value generators (GUID v7, hashes, base64, escapes, passwords) | missing | V:M E:S | a `generate` input palette (or calc rows): `uuid`, `uuid7`, `nanoid`, `password 24`, `sha256 <text>`, `md5`, `base64 <text>` / `b64d`, `urlencode`, `lorem 3`, `hex 255`; every row copies, all pure TypeScript in an afternoon |
| 384 | `01M2KJSVHDZ5QKD0W14ZEGPFMT` | beyond: Multiple calculator backends (Qalculate, SoulverCore, Numen) | not for pal |  | mathjs plus three parsers was the rebuild (`notes/decisions.md` calc); a backend switch is not wanted |
| 392 | `01M2KJSVHGH3B1WDCG2GBBXDPA` | gap: Inline results in root search without opening a view | partial | V:M E:M | with 25 and 318: an extension's answer inline at the root without opening it |
| 393 | `01M2KJSVHGH3B1WDCG2M2GW6A5` | gap: Universal search across extensions (aggregated results) | done |  | the root is the union of every palette (tiers, caps): `docs/extensions.md` |
| 394 | `01M2KJSVHGH3B1WDCG2QBSBG74` | gap: Fuzzy search inside extension lists and over keywords | done |  | nucleo inside every level; input palettes filter themselves: `index.rs` |
| 395 | `01M2KJSVHGH3B1WDCG2RFFD5C9` | gap: Autocomplete / search-bar completion | missing | V:S E:M | ghost text from the top hit's name after the caret (Tab accepts), and Tab completing a unique alias; `Search.tsx` draws a shadow span |

## Keyboard

| # | id | idea | class | V/E | pal today, and the fit |
| --- | --- | --- | --- | --- | --- |
| 27 | `01M2KJSVCYQ16H34C0R2R45T9M` | core: Search bar input behaviours | done |  | escape clears then pops, cmd+backspace pops, cmd+1..9, IME guards, forms with cmd+enter: `keys.ts`, `docs/keyboard.md` |
| 29 | `01M2KJSVCYQ16H34C0R74177BF` | core: Action Panel (Cmd K) | done |  | cmd+K panel with typed filter, sections, destructive style, shortcuts drawn: `ActionPanel.tsx` |
| 30 | `01M2KJSVCYQ16H34C0RB1QYEYA` | core: List navigation keys and page jumps | done |  | arrows, ctrl+n/p, home/end/page keys, cmd+N: `keys.ts` |
| 31 | `01M2KJSVCYQ16H34C0RCYGRE92` | core: Emacs and Vim navigation bindings | partial | V:S E:S | Missing: the vim set (ctrl+h/j/k/l) and a preset switch; ctrl+n/p are there. Fit: `general.navigation = arrows\|emacs\|vim` in `resolve` |
| 32 | `01M2KJSVCYQ16H34C0RG3EKARV` | core: Escape key and close-window behaviour | partial | V:S E:S | Missing: the setting. Escape is fixed to clear, then pop, then hide (`docs/keyboard.md`). Fit: `general.escape = back\|close` read by the Launcher's escape handler; folds into 4 |
| 33 | `01M2KJSVD2FF4FMG80WZB30SKS` | core: Standard item shortcut vocabulary | partial | V:M E:S | Missing: one table the SDK and the lint enforce. The polish pass settled the conventions by hand (`notes/decisions.md`, keys per `pal.json`). Fit: `Keys.Common` in `@zcag/pal` (copy cmd+c, edit cmd+e, delete ctrl+x, open with cmd+o, quick look cmd+y, pin cmd+p) and a `checkPalettes` warning when an action uses a shell key |
| 334 | `01M2KJSVH4TCMWJRCGAJ2PNJSE` | beyond: Query hotkeys with Silent Run / Preview presets and tray queries | partial | V:S E:S | Missing: a hotkey that opens pal with a query typed (silent run is `item_hotkeys`, a palette hotkey opens it). Fit: `[general.query_hotkeys] "ctrl+alt+g" = "quicklinks: gh "` reusing `pal://open?q=`; or skhd binding `open pal://open/...?q=` today |
| 338 | `01M2KJSVH7583GA05AN8NRYD67` | beyond: LaunchBar staging multi-select | missing | V:M E:M | `shift+↓` / `shift+↑` extend a selection in a list (a count in the footer), `cmd+a` all; `pick(ids[], action)` when an action declares `multi: true`; processes (kill several), browser-tabs (close several), files (trash, copy paths), clipboard (delete) opt in |
| 345 | `01M2KJSVH7583GA05AP04YAZBV` | beyond: Esc behavior, backspace-on-empty, triple-press, return-home timeout | partial | V:S E:S | with 4 and 32; Backspace on an empty query popping a level is one line in `keys.ts` |
| 346 | `01M2KJSVH8JA3CZ8Q48SATEMWP` | beyond: Numbered result activation (Ctrl/Alt+1..9) | done |  | cmd+1..9: `keys.ts` |
| 397 | `01M2KJSVHGH3B1WDCG2YM83N6M` | gap: Persistent navigation state across commands | missing | V:S E:M | keep a form's typed values when a `push` interrupts it (a stack of drafts in the Launcher, restored on pop); `keep` already relists in place |
| 405 | `01M2KJSVHGH3B1WDCG3EHGFETT` | gap: Vim motions and customizable list keybindings | partial | V:S E:M | Missing: rebinding the grammar and the vim set. Fit: 31 plus a `[keys]` table mapping grammar commands to combos, validated at load |

## Clipboard

| # | id | idea | class | V/E | pal today, and the fit |
| --- | --- | --- | --- | --- | --- |
| 54 | `01M2KJSVD7AE742Y64525PZVJF` | core: Pasteboard watcher XPC helper | done |  | in-process `changeCount` poll at 250 ms, concealed and transient types honoured, images to files: `core/src/clipboard.rs` |
| 72 | `01M2KJSVD8VFVAYT1FGZQ2HKRS` | builtin: Clipboard History browser | done |  | FTS over text, kinds filter (Text, Images, Files, Links, Colors), detail pane with image/file list/metadata, pinned section: `extensions/clipboard`, `core/src/clipboard.rs` |
| 73 | `01M2KJSVD8VFVAYT1FH38JHE59` | builtin: Clipboard capture engine (pasteboard watcher, formats, limits) | done |  | files, then text, then image priority; dedupe bumps; 10 MB cap; concealed skipped; images as PNG files: `core/src/clipboard.rs` |
| 74 | `01M2KJSVD8VFVAYT1FH6CPRZV4` | builtin: Clipboard entry actions (paste, paste as, OCR, QR, share, edit, save) | partial | V:M E:M | Missing: OCR (78), QR decode, Save as snippet, Save as file, Edit, Share. Paste / Copy / Paste plain / Pin / Delete / Open link / Copy image file are in. Fit: Save as snippet is a `push` to snippets' form with `args` (187), Save as file a save dialog on the PNG the core keeps; QR via `CIDetector` in core next to 78 |
| 75 | `01M2KJSVD8VFVAYT1FH9Q27RPC` | builtin: Clipboard pinning and renaming | partial | V:S E:S | Missing: rename (pin is cmd+P). Fit: a `name` column in `clipboard.db`, an Edit-name form, FTS over it |
| 76 | `01M2KJSVD8VFVAYT1FHBAT0VCT` | builtin: Clipboard retention and bulk deletion | done |  | `max_age_days`, `max_entries`, pinned exempt, Delete all unpinned, Clear history: `docs/palettes.md` Clipboard History |
| 77 | `01M2KJSVD8VFVAYT1FHCJRM812` | builtin: Clipboard privacy: disabled applications and concealed content | done |  | `exclude_apps` (Keychain Access and Passwords by default), concealed and transient types never recorded |
| 78 | `01M2KJSVD8VFVAYT1FHF49QM8Z` | builtin: Clipboard image text recognition (OCR) | missing | V:M E:M | `VNRecognizeTextRequest` in core when an image entry is recorded (off the watcher thread), the text into the FTS column and a Copy text action; Linux `tesseract` when on PATH, else nothing. Screenshots become searchable the day they are copied |
| 79 | `01M2KJSVD8VFVAYT1FHGKCG41D` | builtin: Clipboard behaviour settings (primary action, plain text, previews) | done |  | `primary_action`, Paste as plain text, favicons on url rows, used entry bumps to the top |
| 80 | `01M2KJSVD8VFVAYT1FHMH71FQQ` | builtin: Paste Sequentially and Reset Paste Sequence | missing | V:S E:S | A `paste-next` row in clipboard with an `item_hotkeys` binding: each run pastes the next entry down from a cursor kept in storage, reset after 60 s |
| 81 | `01M2KJSVD8VFVAYT1FHPRJ3ERG` | builtin: Emoji & Symbols picker | done |  | emoji grid with Unicode groups, Recently used, skin tone, copy / paste / shortcode: `extensions/emoji` |
| 82 | `01M2KJSVD8VFVAYT1FHTARVYEW` | builtin: Emoji AI search and custom keywords | partial | V:S E:S | Missing: custom keywords per emoji (the AI half is not for pal). Fit: `[extensions.emoji] keywords = { "rocket" = ["ship", "deploy"] }` merged into the row keywords at list |
| 184 | `01M2KJSVEYVAKYFC8GTC2AJ1Y1` | ext-api: Clipboard actions: Action.CopyToClipboard and Action.Paste | partial | V:M E:S | Missing: a concealed copy. `copy` from 1Password and OTP lands in clipboard history today. Fit: `copy: { text, concealed: true }` writing `org.nspasteboard.ConcealedType` alongside so the recorder skips it (it already honours the type); onepassword and otp switch to it |
| 349 | `01M2KJSVH8JA3CZ8Q496232DFW` | beyond: Clipboard keeping all MIME offers, encrypted dir, eviction, denylist | partial | V:S E:M | Missing: encryption at rest and per-flavour storage. Kinds, eviction, exclude list are in. Fit: `sqlcipher` behind `[extensions.clipboard] encrypt = true` with the key in the keychain; RTF/HTML flavours kept next to the text when a paste-as-rich action exists |
| 350 | `01M2KJSVH8JA3CZ8Q4971DN7KJ` | beyond: ClipMerge (Cmd+C twice appends) and LIFO paste-and-remove stack | missing | V:S E:S | the watcher sees two copies within 500 ms of the same source: append to the previous entry with a newline (ClipMerge); a `paste-and-pop` action for the stack |
| 351 | `01M2KJSVH8JA3CZ8Q498S4ZS2Q` | beyond: Clipboard favorites, aliases and paste image/emoji to active window | partial | V:S E:S | with 75 (a name); pasting images and emoji into the front app already works (`paste`, `paste_by_default`) |
| 352 | `01M2KJSVH8JA3CZ8Q49AWCTV8Z` | beyond: Clipboard-content launchers (act on URL/color/math in clipboard) | missing | V:M E:S | rows at the empty root (or the top of a typed one) from what is on the pasteboard: a url "Open …", a `#hex` "Convert …" (pushes colors), a path "Reveal …", a number "Calculate …"; the `clipboard: true` half of 318, the watcher already knows the text |
| 353 | `01M2KJSVH8JA3CZ8Q49EFNCKXK` | beyond: Clipboard history API for scripts (get/remove/clear) | done |  | `clipboard.*` in the SDK, `pal action copy\|paste` for scripts: `docs/cli.md` |
| 399 | `01M2KJSVHGH3B1WDCG33SJ2ZR4` | gap: Richer clipboard API and history control | done |  | `clipboard.delete/clear/pin`, retention settings: `docs/extensions.md`; concealed copy is 184 |

## Window management

| # | id | idea | class | V/E | pal today, and the fit |
| --- | --- | --- | --- | --- | --- |
| 94 | `01M2KJSVDD76EFZZC8Y1KD875A` | builtin: Switch Windows | done |  | windows palette grouped by app: focus, close, minimize, hide app, close all: `extensions/windows`, `pal_core::windows` |
| 118 | `01M2KJSVDHS83Z1K2NT12WYVAT` | builtin: Window layout command set (halves, thirds, fourths, quarters, sixths) | done |  | halves, thirds, two-thirds, quarters, maximize, almost, center, reasonable, displays, restore, gap: `extensions/window-management`, `pal_core::windows::layout` |
| 119 | `01M2KJSVDHS83Z1K2NT3VSTDBX` | builtin: Window size and move commands (maximize, center, resize, restore) | partial | V:S E:S | Done 2026-09-16: Larger / Smaller (10%), Move Left/Right/Up/Down by `step`, Maximize Height / Width, Toggle Fullscreen (`AXFullScreen`), Minimize, Unminimize (`notes/decisions.md`). Missing: Resize to WxH (a form). The layout arithmetic is pure and the frame calls exist (`windows.frame`/`set_frame`), so each is one more static row plus one arm in `layout.rs` |
| 120 | `01M2KJSVDHS83Z1K2NT67CA28K` | builtin: Move windows between displays and Spaces | partial | V:S E:M | Missing: Spaces (private `CGSMoveWindowsToManagedSpace` or synthesised ctrl+arrows). Next / Previous Display are in. Fit: leave to yabai on hornet; a `windows.move_space` behind a feature flag if ever |
| 121 | `01M2KJSVDHS83Z1K2NT6XYDYGV` | builtin: Window Management settings (gaps, cycling, Stage Manager, presets) | partial | V:S E:S | Missing: cycle mode (Left Half again cycles 1/2, 2/3, 1/3) and a Rectangle-keys preset. `gap` is in. Fit: `cycle = true` on the halves keeping the last size per window in the `restore` map; a documented `item_hotkeys` block matching Rectangle's defaults in `docs/palettes.md` |
| 122 | `01M2KJSVDHS83Z1K2NT7MBQ6FA` | builtin: Custom window commands (Create Command) [Pro] | missing | V:S E:S | `[extensions.window-management.custom]` table `{ name, x, y, w, h }` in percent or points, each a row and an `item_hotkeys` target; the same `set_frame` path |
| 123 | `01M2KJSVDHS83Z1K2NTB08SQ34` | builtin: Custom window layouts (Create Layout, Save Current Layout) [Pro] | missing | V:S E:L | Layouts placing several windows (`layouts.toml`: app, frame, display) applied through `windows.list` + `set_frame`, launching missing apps; Save current layout from the windows palette. yabai does this for him, so low |
| 124 | `01M2KJSVDJ2SF0Q1A8MFPQS6ZK` | builtin: Toggle Grid Overlay for window placement | not for pal |  | mouse-driven overlay; yabai and the layout rows cover it |
| 205 | `01M2KJSVG8R9ZF565JRG9FF4Z6` | ext-api: WindowManagement API (Pro, macOS) | done |  | `windows.list/frame/set_frame/displays/focused/layout` in the SDK: `docs/extensions.md` |
| 398 | `01M2KJSVHGH3B1WDCG30GZRZAG` | gap: Window management gaps | partial | V:S E:S | with 119 and 121: cycle on repeat, move to the other display on a repeated half hotkey |

## Snippets and quicklinks

| # | id | idea | class | V/E | pal today, and the fit |
| --- | --- | --- | --- | --- | --- |
| 28 | `01M2KJSVCYQ16H34C0R5WMM5D6` | core: Tags on quicklinks, snippets and run commands (v2) | missing | V:S E:M | Tags on quicklinks and snippets as a filter dropdown; keywords already do the search half. Low |
| 46 | `01M2KJSVD3C26CH27BM5QRJYWD` | core: Dynamic placeholder grammar (snippets, quicklinks, AI commands) | partial | V:M E:M | Missing: `{selection}` (needs 197), `{cursor}` (documented unsupported), `{snippet name=}`, `{calculator}`, `{browser-tab}`; snippets have clipboard/date/time/datetime/uuid, quicklinks `{query}`/`{argument}`. Fit: one placeholder module in `@zcag/pal` used by snippets, quicklinks and scripts |
| 47 | `01M2KJSVD3C26CH27BM6GM7W52` | core: Placeholder modifiers, date offsets, formats and locale | missing | V:S E:S | `{date format="yyyy-MM-dd" offset="+2d"}` and `\| uppercase \| trim` modifiers in the shared module of 46; `Intl` and a small pipe parser |
| 48 | `01M2KJSVD3C26CH27BM9Y16EYD` | core: Placeholder arguments and prompt inputs | partial | V:S E:S | Missing: several arguments and `options=` dropdowns; quicklinks fill one `{query}` / `{argument name=}` per drill-in. Fit: the typed fields of 23 |
| 83 | `01M2KJSVD8VFVAYT1FHXY895EK` | builtin: Inline emoji autocomplete with ':' in text fields | missing | V:S E:S | `:name` completion inside pal's own form fields (snippet text, calendar notes): a small popover on `:` in `Form.tsx` fed by emoji's data; low, pal has few text fields |
| 97 | `01M2KJSVDD76EFZZC8YDD9WYRB` | builtin: Create Quicklink form (link, icon, open with, tags, autofill) | partial | V:S E:S | Missing: an Open With app on a quicklink and autofill from the front browser tab. Fit: an `app` select in the form from `apps.forFile(url)`, prefill from `browser-tabs`' active tab when the form opens |
| 98 | `01M2KJSVDD76EFZZC8YESZKHZ8` | builtin: Quicklink library and argument placeholders | partial | V:S E:S | Missing: a library of ready-made search quicklinks. `{query}`/`{argument}` are read. Fit: a `quicklinks.json` on pal.cagdas.io that the `import` setting can point at (read-only rows), plus a Browse library row |
| 99 | `01M2KJSVDD76EFZZC8YH0RR4S5` | builtin: Search Quicklinks and quicklink actions | done |  | Open (drill-in for `{query}`), Copy URL, Edit, Delete, root Create row: `extensions/quicklinks` |
| 100 | `01M2KJSVDD76EFZZC8YM645RFF` | builtin: Quicklink settings (previews, existing tabs, selected text) | partial | V:S E:M | Missing: Prefer existing tab (browser-tabs has the CDP/AppleScript listing to match a url and focus it) and Pass selected text (needs 197). Fit: an `open` that first asks `browser-tabs` for a tab with that url |
| 101 | `01M2KJSVDD76EFZZC8YQWRPY5B` | builtin: Quicklink import/export, shared quicklinks and @quicklinks | done |  | Import / Export Quicklinks forms, Raycast's `{name, link}` export read: `docs/palettes.md` Quicklinks and Snippets |
| 105 | `01M2KJSVDD76EFZZC8Z07S7B5W` | builtin: Create and edit snippets (text, name, keyword, tags, organization) | done |  | Create / Edit form (name, keyword, text), keyword as a tag and keyword, detail pane: `extensions/snippets` |
| 106 | `01M2KJSVDD76EFZZC8Z3BE6QTV` | builtin: Snippet keyword expansion engine | missing | V:M E:L | A CGEvent keydown tap in core (Input Monitoring is already probed in `permissions.rs`) buffering typed characters, on a keyword match: N synthesised backspaces then a pasteboard swap + Cmd+V, restore; secure-input fields skipped. Only worth it if he wants to drop espanso-style tools; `docs/palettes.md` says pal pastes on Enter today |
| 280 | `01M2KJSVGG1RTCGGEQG8XSBJBQ` | store: Snippet Explorer and snippets import deeplink | missing | V:S E:S | a curated `snippets.json` on pal-site (symbols, arrows, dates) importable through the existing Import Snippets form or 277's link |
| 283 | `01M2KJSVGH5B56PX6F6XYV02GS` | store: Quicklink Explorer and quicklinks import deeplink | missing | V:S E:S | with 98 |
| 335 | `01M2KJSVH4TCMWJRCGANZEG2ZK` | beyond: Custom query shortcuts with {clipboard} and {active_explorer_path} | missing | V:S E:S | `{finder}` (front Finder window's folder via `osascript`) and `{clipboard}` in quicklink urls through the shared module of 46 |
| 354 | `01M2KJSVH8JA3CZ8Q49EZ4GPW5` | beyond: Snippet {shell} placeholder and per-app expansion scope | missing | V:S E:S | `{shell cmd}` in the placeholder module of 46 (`Bun.$` with the login PATH); a per-app `apps` list on a snippet is only useful with 106 |
| 357 | `01M2KJSVH8JA3CZ8Q49QR9943F` | beyond: Context Manager (copy/paste path, URL, title context between apps) | missing | V:S E:M | with 335 and 204: `{finder}`, `{browser-url}`, `{window-title}` placeholders |
| 382 | `01M2KJSVHDZ5QKD0W14WFH6D7P` | beyond: OpenSearch discovery, POST search templates, live web suggestions | partial | V:S E:M | Missing: OpenSearch discovery and live suggestions. Quicklinks with `{query}` are the search templates. Fit: a Create-from-site action reading `<link rel=search>` of a pasted url; suggestions are a network call per keystroke, skip |

## Calendar

| # | id | idea | class | V/E | pal today, and the fit |
| --- | --- | --- | --- | --- | --- |
| 68 | `01M2KJSVD8VFVAYT1FGQR1FXG1` | builtin: My Schedule (calendar agenda) [Mac] | done |  | `calendar-schedule`: EventKit, sections by day, join / open / copy / delete, filters per calendar, New event form: `extensions/calendar`; accept/decline needs private EventKit, documented |
| 69 | `01M2KJSVD8VFVAYT1FGSG3DXW1` | builtin: Join next meeting from root search and conference-link detection | partial | V:M E:S | Missing: the next event at the empty root; it is on the bar (`calendar/upcoming`) and in the `today` palette. Fit: 17's `root_empty` flag on `calendar-schedule` with the join action first |
| 70 | `01M2KJSVD8VFVAYT1FGVJPPBJ8` | builtin: Auto-Join meetings and auto-transcription | missing | V:S E:M | A `join_before_minutes` setting on calendar's bar item render: a HUD "Zoom with X in 2 min, Enter joins" and a hotkey; auto-join without asking is a one-line step after. Transcription is out |
| 365 | `01M2KJSVHCQD0A9ASDWZ6RS90Z` | beyond: Natural-language calendar and reminder entry with live feedback | partial | V:S E:M | Missing: one-line entry with live feedback. The New event form parses days and times from words. Fit: an `event` input palette reusing `schedule.ts`: `standup @ tomorrow 10:00` shows the parsed row as you type, Enter creates |

## Files

| # | id | idea | class | V/E | pal today, and the fit |
| --- | --- | --- | --- | --- | --- |
| 55 | `01M2KJSVD7AE742Y6452XAX2SC` | core: File indexer plumbing (minidex, FSEvents, ripgrep, OCR) | not for pal |  | pal chose the OS index on purpose (Spotlight `mdfind`, `fd`/`locate`/`find`), no indexer of its own: `docs/palettes.md` Files |
| 84 | `01M2KJSVDC42GEZ5JM75DG767T` | builtin: Search Files command (file browser UI) | done |  | files palette: OS index, detail pane, recents at the empty query, Quick Look, Open with… level: `extensions/files` |
| 85 | `01M2KJSVDC42GEZ5JM779QMGTQ` | builtin: Files and folders inline in root search | partial | V:M E:M | Missing: files at the root (the palette is input, `recent` is live at the root) and a typed path opening. Fit: the path half is 25; file names at the root would be a debounced `mdfind` behind `[extensions.files] root = true`, capped by `root_caps` |
| 86 | `01M2KJSVDD76EFZZC8X6HNRGDK` | builtin: Natural-language and typed file filters | missing | V:S E:M | `.pdf in ~/Desktop`, `kind:image`, `modified:today` parsed in `files/index.ts` into `mdfind` attributes / `fd` flags; a small grammar, the backend already takes a folder |
| 87 | `01M2KJSVDD76EFZZC8X8GD3WVH` | builtin: File content search | missing | V:M E:S | A `content:` prefix or a filter entry (Names / Contents) in the files palette running `mdfind` without `-name` (Spotlight `kMDItemTextContent`, free on macOS); `rg -l` under the folders on Linux with `fd`'s excludes |
| 88 | `01M2KJSVDD76EFZZC8X944VN1B` | builtin: File Search settings (scopes, ignore rules, volumes, disk guard) | done |  | `folders`, `exclude`, `show_hidden`, `limit` settings; `.gitignore` respected by fd: `docs/palettes.md` Files |
| 89 | `01M2KJSVDD76EFZZC8XC7YWAS2` | builtin: File actions (open, reveal, copy path, trash, terminal, share, rename) | partial | V:S E:S | Missing: Open in Terminal (a folder), Rename, Move to…, Copy to…. Open / Reveal / Open with / Copy path / Copy file / Trash / Quick Look are in. Fit: Terminal reuses ssh's terminal launcher (the copy the docker/make extensions carry, to be moved into the SDK); Rename and Move are forms over `fs.rename` |
| 90 | `01M2KJSVDD76EFZZC8XE24KAYV` | builtin: Quick Look command for the Finder selection | missing | V:S E:S | A system row "Quick Look Finder selection" (`osascript` selection as alias list, then `qlmanage -p`), bound through `item_hotkeys` |
| 102 | `01M2KJSVDD76EFZZC8YV58B9M4` | builtin: Search Screenshots (grid with OCR search and filters) | missing | V:M E:M | A `screenshots` palette (grid) over `defaults read com.apple.screencapture location` (else Desktop) sorted newest, `mdfind kMDItemIsScreenCapture=1` for the set, thumbnails through the `icon://` scheme (it serves clipboard images already), actions Copy / Paste / Reveal / Trash; OCR search once 78 lands. Both his boxes screenshot a lot |
| 103 | `01M2KJSVDD76EFZZC8YW2NWTNF` | builtin: Paste Latest Screenshot | missing | V:S E:S | "Paste latest screenshot" row in the screenshots palette (or system): newest file in that folder, `copy_files` then `paste`; an `item_hotkeys` target |
| 104 | `01M2KJSVDD76EFZZC8YY4ENYC7` | builtin: Screenshots settings (scopes, OCR, storage duration) | missing | V:S E:S | settings of 102: folders, storage duration (auto-trash after N days) |
| 186 | `01M2KJSVG7QNPDTXJJZKWMQFA0` | ext-api: File actions: Action.ShowInFinder and Action.Trash | done |  | Reveal and Move to Trash on files rows; extensions shell out (`open -R`, Finder trash, `gio trash`) |
| 337 | `01M2KJSVH7583GA05AN4VW1Z3A` | beyond: Alfred File Buffer | missing | V:S E:M | with 338: a buffer that survives leaving a level, then Open all / Trash all / Copy paths; multi-select first |
| 339 | `01M2KJSVH7583GA05ANGS27T5C` | beyond: Deep sub-search and inline browsing (folders, plists, contacts) | partial | V:M E:S | Missing: browsing into a folder. Open with… is a drill-in already. Fit: Enter on a folder row pushes `files` with `args: { dir }` listing that folder (`readdir`, sorted, hidden per setting), `cmd+backspace` up, `/` typed at the start of the query as the path mode |
| 358 | `01M2KJSVH8JA3CZ8Q49QXBZ8D3` | beyond: Dialog Jump / Quick Jump for Open and Save dialogs | missing | V:M E:S | when the front window is an open/save panel (AX role `AXSheet`/`NSOpenPanel` on show), files and recent rows offer "Use in dialog": hide, `cmd+shift+g`, type the path, Enter (AX, already the paste path). Cuts the Finder detour every time a browser asks for a file |
| 367 | `01M2KJSVHCQD0A9ASDX4WP9F6X` | beyond: Configurable indexing rules per source and metadata info browsing | partial | V:S E:S | Missing: per-source rules beyond each extension's folders; the files detail shows size / kind / modified. Fit: image dimensions and Finder tags in files' `detail` from `mdls` |
| 373 | `01M2KJSVHCQD0A9ASDXKV32Q23` | beyond: File operations from results (move, copy, rename, compress, tag) | partial | V:S E:M | with 89: rename, move, copy to, compress (`ditto -c -k`), Finder tags (`xattr` / `tag` CLI) |
| 404 | `01M2KJSVHGH3B1WDCG3CFS8Q7K` | gap: What Alfred still does better | partial | V:S E:S | with 89 and 373: file actions are the one Alfred edge left; Spotlight-backed search, complete system commands, zero cloud are in |

## System

| # | id | idea | class | V/E | pal today, and the fit |
| --- | --- | --- | --- | --- | --- |
| 60 | `01M2KJSVD7AE742Y645ETZDYBB` | builtin: Application launcher (search, open, per-app actions) | done |  | apps palette: Open, Quit, Hide, Reveal, Copy path, Copy bundle id, Running tag, System Settings panes, Linux desktop actions: `extensions/apps` |
| 61 | `01M2KJSVD7AE742Y645J12FF4F` | builtin: Application search scopes and deep (recursive) search | partial | V:S E:S | Missing: disabling a default folder, recursive scan. `[extensions.apps] folders` adds roots. Fit: `folders_off` and `deep = true` settings in the same scan |
| 91 | `01M2KJSVDD76EFZZC8XKVG8CKR` | builtin: Focus sessions (start, toggle, edit, pause, resume, complete) | missing | V:S E:L | A focus session is a timer with app blocking; the timer half is the bundled `timer` palette. App blocking is an `NSWorkspace` launch observer terminating listed bundles, website blocking needs a browser hook or hosts file; a lot for something `timer` + Do Not Disturb mostly cover |
| 92 | `01M2KJSVDD76EFZZC8XQBZSBM6` | builtin: Focus categories (built-in and custom, import/export) | missing | V:S E:M | only with 91: named lists of bundle ids and hosts in `[extensions.focus]` |
| 93 | `01M2KJSVDD76EFZZC8XY72KK9C` | builtin: Search Menu Bar Items [Mac] | done |  | `extensions/menu-bar`, `pal_core::menubar` (2026-09-16, `notes/decisions.md`). Was: A live `menus` palette: `pal_core::ax` (already there) walks `AXMenuBar > AXMenu > AXMenuItem` of the frontmost app captured on show, rows "File › Export…" with the shortcut as accessory, Enter does `AXPress` after the panel hides (focus-effect path); cache the walk per bundle id. Accessibility is already the permission pal asks for. The one Raycast command a keyboard user reaches for hourly |
| 107 | `01M2KJSVDD76EFZZC8ZHW1Z958` | builtin: Power and session system commands | done |  | system palette: Sleep, Sleep Displays, Lock, Log Out, Restart, Shut Down with confirm: `extensions/system` |
| 108 | `01M2KJSVDEW468Z3GJ70RD3PX6` | builtin: Audio and media system commands | done |  | Volume up / down / mute rows, `audio` palette for devices and levels, `media` palette for play / pause / next: `extensions/{system,audio,media}` |
| 109 | `01M2KJSVDEW468Z3GJ73V8ZYGS` | builtin: Volume Mixer and per-app volume [Win] | not for pal |  | Windows-only surface; macOS has no public per-app volume API (process taps on 14.2+ are a project of their own) |
| 110 | `01M2KJSVDEW468Z3GJ762KE89W` | builtin: Display and appearance system commands | done |  | Toggle Dark Mode with the state as a tag, Show Desktop: `extensions/system`; Stage Manager is not there and not wanted |
| 111 | `01M2KJSVDEW468Z3GJ768M7SEX` | builtin: Files and storage system commands (trash, eject, hidden files) | done |  | Empty Trash with a count, Eject All Disks: `extensions/system` |
| 112 | `01M2KJSVDEW468Z3GJ78PQ5JQ5` | builtin: App and notification commands (hide, quit all, dismiss) | partial | V:S E:S | Missing: Quit all apps (except front), Unhide all, Dismiss notifications. Hide app is on windows rows. Fit: three more `pal_core::system` commands: `NSRunningApplication` over `.regular` apps with an exclude setting; Dismiss via AX on NotificationCenter's group (Accessibility, already asked) |
| 113 | `01M2KJSVDEW468Z3GJ79R6ZRRC` | builtin: Connectivity commands (Wi-Fi, Bluetooth, Airplane Mode) | done |  | wifi and bluetooth palettes with toggles, join, forget, connect, battery: `extensions/{wifi,bluetooth}` |
| 114 | `01M2KJSVDHS83Z1K2NSTMPBA65` | builtin: Confetti (command, deeplink, holiday confetti) | missing | V:S E:S | A system row "Confetti" (his `confet` helper when on PATH, else nothing) and `pal://confetti` for skhd; a bar-item render already knows how to run a CLI |
| 115 | `01M2KJSVDHS83Z1K2NSWBHN91E` | builtin: Translate command [Pro] | missing | V:S E:M | A `translate` input palette over Apple's Translation framework in core (macOS 15+, on-device, one language pack prompt) with `argos-translate` on Linux when installed; rows per target language from a `languages` setting. Cloud APIs stay out |
| 116 | `01M2KJSVDHS83Z1K2NSWNNJ294` | builtin: Inline translation in root search | missing | V:S E:S | after 115: `match: \bin (german\|turkish\|…)$` through 25 |
| 117 | `01M2KJSVDHS83Z1K2NSXZR1PR5` | builtin: Custom translate commands and translator settings | missing | V:S E:S | after 115: fixed pairs as rows with `item_hotkeys` |
| 125 | `01M2KJSVDJ2SF0Q1A8MJHQHWV3` | builtin: Custom Run commands [Win] | not for pal |  | Windows-only; the scripts tier and data-file palettes are pal's equivalent |
| 126 | `01M2KJSVDJ2SF0Q1A8MQJ9TY84` | builtin: Dictionary / Define word | missing | V:S E:S | A `define` input palette: `DCSCopyTextDefinition` through a tiny core call (or `open dict://word` for the app), the definition as the detail pane; ties to 197 for the selection |
| 127 | `01M2KJSVDJ2SF0Q1A8MTHNRQRM` | builtin: Search Contacts [Mac] | missing | V:S E:M | A contacts palette over `CNContactStore` in core (one more permission), rows with call / message / mail / copy actions as `tel:` `imessage:` `mailto:` opens. Only if he wants Contacts in the launcher |
| 128 | `01M2KJSVDJ2SF0Q1A8MXXK52NF` | builtin: Apple Shortcuts search and run [Mac] | missing | V:M E:S | A `shortcuts` palette (primary tier): `shortcuts list --show-identifiers` for the rows, `shortcuts run <name>` on Enter with the panel hidden, Edit opens `shortcuts://open-shortcut?name=`; his Toggle Do Not Disturb shortcut is already a dependency of the system palette |
| 129 | `01M2KJSVDJ2SF0Q1A8N09SD06F` | builtin: System Settings panes and Windows settings as root items | done |  | 35 curated System Settings panes as app rows with `x-apple.systempreferences:` urls: `extensions/apps` |
| 134 | `01M2KJSVDJ2SF0Q1A8ND9DD4XB` | builtin: Staples left to the Store (Kill Process, Timers, Bookmarks) | done |  | Kill process (`processes`), timers (`timer` over the CLI), bookmarks (browser profiles + file) all ship bundled |
| 343 | `01M2KJSVH7583GA05ANT5ZR6E4` | beyond: Spotlight App Intents actions with inline parameter fields | not for pal |  | App Intents are enumerable only by system frameworks; Shortcuts (128) is the reachable half |
| 359 | `01M2KJSVH8JA3CZ8Q49VJTSDDH` | beyond: Screen Search (Vimium-style labels) and in-window UI element search | missing | V:S E:L | a `click` input palette over the front app's AX tree (buttons, links, tabs, `AXPress` on Enter) is a day; the Vimium-style label overlay is a week and Vimium covers the browser |
| 360 | `01M2KJSVH8JA3CZ8Q49ZQ8B12D` | beyond: Browser tab/history/bookmark search without a browser extension | partial | V:S E:S | Missing: browser history. Bookmarks from every profile and tabs over CDP are in. Fit: a `history` palette in bookmarks reading Chrome's `History` (copied, `bun:sqlite`, `urls` by `last_visit_time`) and Firefox's `moz_places`, `ttl` 60 |
| 362 | `01M2KJSVHBR5F5YFMJV377KKXY` | beyond: Hardware providers (displays, bluetooth, audio, MPRIS, tray, fonts) | done |  | audio, bluetooth, wifi, media, network palettes: `docs/palettes.md` |
| 363 | `01M2KJSVHBR5F5YFMJV6ZSJJ5V` | beyond: Sol extras (notch hider, media keys, Wi-Fi password, scratchpad) | partial | V:S E:S | Missing: notch hide, generators (370). Wi-Fi password (`wifi.password`), IPs (`network`), media keys, calendar on the bar are in |
| 364 | `01M2KJSVHBR5F5YFMJV9TD368W` | beyond: Timers with desktop overlay, pomodoro, todo, weather | done |  | `timer` palette and bar item over the CLI: `docs/palettes.md` Timer |
| 366 | `01M2KJSVHCQD0A9ASDX1S2T9CE` | beyond: Contacts viewer with field actions and Music mini player | partial | V:S E:M | Missing: contacts (127). `media` lists players with controls; a Music/Spotify library browser is a separate palette over AppleScript / the Web API, low |
| 368 | `01M2KJSVHCQD0A9ASDX709TZ38` | beyond: Offline dictation with local models | missing | V:S E:L | `SFSpeechRecognizer` on-device in core behind a hold-to-talk hotkey, text pasted; only if he wants dictation at all |
| 369 | `01M2KJSVHCQD0A9ASDXAAD680M` | beyond: Screenshot editor with size chips and color inspector | not for pal |  | screenshot editing is CleanShot's job |
| 371 | `01M2KJSVHCQD0A9ASDXFWJZNBC` | beyond: Process killer / kill all apps built in | done |  | `processes` palette with kill, force kill, ports: `docs/palettes.md` |
| 381 | `01M2KJSVHCQD0A9ASDY927QZJ1` | beyond: Dev-tool launchers (IDE projects, docsets, SSH/PuTTY sessions) | partial | V:M E:S | Missing: projects / IDE recents (the decisions list `repos` as an uncovered v1 palette). ssh, make, docker, github are in. Fit: a `projects` extension: VS Code `storage.json` recents + JetBrains `recentProjects.xml` + `~/proj/*` and `general` roots, actions Open in editor / terminal / GitHub / Finder, `ttl` 300; primary tier |
| 403 | `01M2KJSVHGH3B1WDCG3BQCMNVJ` | gap: Broken high-dependency integrations | partial | V:M E:S | Missing: IDE recents (381). Bookmarks (browser profiles) and Spotify (media, over AppleScript, no sign-in) are first-party |

## Extensions API, scripts and store

| # | id | idea | class | V/E | pal today, and the fit |
| --- | --- | --- | --- | --- | --- |
| 40 | `01M2KJSVD3C26CH27BK5DKGXNK` | core: Developer settings toggles | partial | V:S E:S | Missing: a keep-open-while-developing switch. `extension_dirs` hot reload exists. Fit: `general.pop_to_root` from 4 covers it (a large value keeps the level) |
| 51 | `01M2KJSVD3C26CH27BMGJBP3SE` | core: OAuth redirect and developer CLI callback deeplinks | missing | V:S E:M | `pal://oauth?code=&state=` routed to the extension that started the flow; only meaningful with 200 |
| 135 | `01M2KJSVDJ2SF0Q1A8NFM22WW8` | ext-api: Extension package model and entry points | done |  | `pal.json` + `index.ts`, kinds list / live / input / grid / view, bar items: `docs/extensions.md` |
| 136 | `01M2KJSVDJ2SF0Q1A8NK1Y3WSM` | ext-api: Node host process with per-extension isolates | partial | V:S E:L | Missing: isolation (one Bun host, every extension in one process, no heap cap). Fit: a `worker_threads` Worker per extension with `resourceLimits` once an extension misbehaves; the reverse-RPC bridge stays. Not before it hurts |
| 137 | `01M2KJSVDJ2SF0Q1A8NPC6WPMF` | ext-api: Custom React reconciler rendering a native UI tree | not for pal |  | pal renders a fixed tree, not React in extensions, by decision (`notes/decisions.md` Extensions); a Raycast shim is "nice to have", see 238 |
| 138 | `01M2KJSVDJ2SF0Q1A8NTX14FTM` | ext-api: Heap limits and Out-of-Memory diagnostics | missing | V:S E:M | with 136: `resourceLimits.maxOldGenerationSizeMb` per worker and an "out of memory" row in Settings > Extensions |
| 139 | `01M2KJSVDJ2SF0Q1A8NWH3HRS8` | ext-api: Command unload rules and lifecycle timing | done |  | a different model: one resident host, `dispose()` on reload or removal, `ttl` and `live` decide relisting: `docs/extensions.md` Bar items |
| 140 | `01M2KJSVDJ2SF0Q1A8NYV8EF6R` | ext-api: Extension process environment (env vars, PATH, tmp, proxy) | done |  | `pal_core::env::adopt` merges the login shell's PATH, `~` expansion in `home()`: `notes/decisions.md` Findings PATH |
| 141 | `01M2KJSVDJ2SF0Q1A8NZJCS7QE` | ext-api: Extension install and support directories on disk | done |  | store dir, `.pal-install.json`, `storage/<ext>.json`, `node_modules/@zcag/pal` link: `docs/extensions.md` |
| 142 | `01M2KJSVDJ2SF0Q1A8P1AJD169` | ext-api: Dev protocol raycast://cli and hot reload | done |  | `general.extension_dirs` watched, an extension reloads on save, `pal reload`: `docs/extensions.md` Writing one |
| 143 | `01M2KJSVDJ2SF0Q1A8P1H6TF87` | ext-api: Console logging, error overlay and crash reporting | partial | V:S E:S | Missing: an in-panel error surface for a pick that threw (today stderr/log, and a load error in Settings). Fit: the host turns an exception in `list`/`pick` into a failure toast with the message; the stack stays in the log |
| 144 | `01M2KJSVDJ2SF0Q1A8P1MAEYVR` | ext-api: React DevTools and Node inspector attachment | missing | V:S E:S | `PAL_HOST_INSPECT=1` starting `pal-bun` with `--inspect` so a debugger attaches; a log line with the URL |
| 145 | `01M2KJSVDJ2SF0Q1A8P3KPD13N` | ext-api: Root-search developer actions and Extension Diagnostics | partial | V:S E:S | Missing: per-extension "Clear storage" and "Reload this one". Reload Extensions, Refresh Index, Copy Diagnostics, Settings warnings are in. Fit: two buttons on the Extensions pane |
| 146 | `01M2KJSVDJ2SF0Q1A8P4J3HXP8` | ext-api: Create Extension templates and boilerplates | partial | V:S E:S | Missing: a scaffold command. `examples/hello-extension` is the template. Fit: `pal new <name> [--kind list\|view\|grid]` copying it with the name substituted |
| 147 | `01M2KJSVDJ2SF0Q1A8P8A34BJ1` | ext-api: Manifest store metadata (categories, platforms, keywords, owner) | done |  | `store.tagline`, `permissions`, `screenshots`, categories on pal.cagdas.io: `pal-site/STORE-FIELDS.md` |
| 148 | `01M2KJSVEW5K4SHM2B7EYZB4T6` | ext-api: Command manifest properties and modes | done |  | palettes with `kind`, `ttl`, `tier`, `keys`, `rank`, `settings`; bar items with `refresh.every` and `on`: `docs/extensions.md` |
| 149 | `01M2KJSVEW5K4SHM2B7H14R970` | ext-api: Command arguments (manifest, root search fields, props.arguments) | partial | V:S E:M | Missing: declared typed arguments; `ctx.args` from a `push` and quicklinks' `{query}` are the two forms. Fit: 23 |
| 150 | `01M2KJSVEXVPJ6VSV5D3ED66J4` | ext-api: Preference declarations in the manifest | done |  | `settings[]` kinds text / secret / number / boolean / select / hotkey / path / list, per-palette settings, `required` drives needsSetup: `docs/extensions.md` |
| 151 | `01M2KJSVEXVPJ6VSV5D3Y68AX8` | ext-api: Preferences runtime API and required-preference onboarding | partial | V:S E:S | Missing: `openSettings()` from an extension. `settings.get/onChange` exist. Fit: an `Effect.settings: { page, anchor }` opening `pal://settings/extensions#<ext>:<key>` (the route exists) |
| 152 | `01M2KJSVEXVPJ6VSV5D6QE94RE` | ext-api: Generated raycast-env.d.ts types | partial | V:S E:S | Missing: generated `Settings` types. `defineExtension(manifest, ext)` types the palette keys. Fit: `pal types` writing `pal-env.d.ts` from `pal.json` settings |
| 153 | `01M2KJSVEXVPJ6VSV5D8W3J8V2` | ext-api: Command launch semantics and LaunchProps | done |  | `ctx.{filter,args,values,refresh}`, `pal://run` and `pal://open?q=` as launch sources: `docs/extensions.md` |
| 154 | `01M2KJSVEXVPJ6VSV5DC9RVEEX` | ext-api: Fallback commands for extension commands | missing | V:M E:M | the palette side of 24: `fallback: true` in `pal.json`, the query arrives as `ctx.args.query` |
| 155 | `01M2KJSVEXVPJ6VSV5DG5CJ6EN` | ext-api: Background refresh (interval) commands | done |  | bar `refresh.every` (10 s min) + `on` triggers, palette `ttl` and `live`: `docs/extensions.md` Bar items |
| 157 | `01M2KJSVEXVPJ6VSV5DJ9E61P3` | ext-api: launchCommand: intra- and inter-extension launches | done |  | `Effect.push { extension, palette, args }` to any extension, `pal://run/<ext>/<palette>/<id>`: `docs/extensions.md` |
| 158 | `01M2KJSVEXVPJ6VSV5DKJ6FS7Y` | ext-api: updateCommandMetadata runtime subtitle | missing | V:S E:S | A palette-row accessory an extension can set (`palette.update({ subtitle \| badge })` over the reverse RPC, like `bar.update`): GitHub's unread count on its Notifications row instead of a first row (`notes/decisions.md` GitHub names the gap) |
| 159 | `01M2KJSVEXVPJ6VSV5DW75EE33` | ext-api: Extension command deeplinks and createDeeplink | done |  | `pal://open/<ext>/<palette>?q=`, `pal://run/...?action=`, confirm card, `deeplink_confirm`: `docs/cli.md` |
| 160 | `01M2KJSVEXVPJ6VSV5DZYPE36G` | ext-api: Search bar, filtering, throttle and pagination (shared interfaces) | partial | V:S E:M | Missing: pagination (`onLoadMore`) and `keepSectionOrder`. Filters, per-keystroke input palettes, lazy detail, `placeholder` are in. Fit: `list` may return `{ items, next }` and the shell asks `next` at the list's end; github's search would use it |
| 161 | `01M2KJSVEXVPJ6VSV5E33WGS30` | ext-api: List component (root, sections, empty view) | done |  | `List` with sections, empty state, detail toggle, virtualised: `app/src/ui/List.tsx` |
| 162 | `01M2KJSVEXVPJ6VSV5E5HEQWYY` | ext-api: List.Item with accessories, tooltips, keywords and ids | done |  | `Item` with `subtitle`, `keywords`, `icon`, `accessories` (text / tag / date), `detail`, `actions`, palette-level `actions`: `sdk/src/protocol.ts` |
| 163 | `01M2KJSVEXVPJ6VSV5E6012SB9` | ext-api: List detail pane (isShowingDetail, List.Item.Detail, metadata) | done |  | `Detail` markdown + metadata, `detail(id)` lazy after 100 ms rest, `showDetail`: `docs/extensions.md` |
| 164 | `01M2KJSVEXVPJ6VSV5E7FBBG46` | ext-api: List/Grid search bar Dropdown accessory | done |  | `filters` as the search-row dropdown, Tab cycles, `ctx.filter`: `docs/extensions.md`; the last filter is not remembered (small) |
| 165 | `01M2KJSVEXVPJ6VSV5EASE57NG` | ext-api: Grid component | done |  | `view: "grid"`, `columns`, sections kept together, `{ image }` tiles: `Grid.tsx` |
| 166 | `01M2KJSVEXVPJ6VSV5EDMEWRGT` | ext-api: Detail component and markdown rendering features | partial | V:S E:S | Missing: syntax-highlighted code blocks, remote image urls, LaTeX. `marked` with GFM tables, `data:` and `icon://` images are in. Fit: `highlight.js` core languages in `Detail.tsx`; remote images through the favicon-style disk cache |
| 167 | `01M2KJSVEXVPJ6VSV5EH40CEDC` | ext-api: Detail.Metadata pane (Label, Link, TagList, Separator) | done |  | `Detail.metadata` labels with text, link, tags: `sdk/src/protocol.ts` |
| 168 | `01M2KJSVEXVPJ6VSV5EJCA9NTW` | ext-api: Form component: root, item props, validation, events and refs | done |  | `Effect.form`: fields, `required`, `errors` back in place, `ctx.values`: `docs/extensions.md` Forms |
| 169 | `01M2KJSVEXVPJ6VSV5EJRVSJ0F` | ext-api: Form text fields: TextField, PasswordField, TextArea | done |  | `text`, `textarea`, `password` fields: `Form.tsx` |
| 170 | `01M2KJSVEXVPJ6VSV5EK18HSH5` | ext-api: Form Checkbox, Dropdown and TagPicker | partial | V:S E:S | Missing: a tag picker (multi-select). `checkbox` and `select` are in. Fit: a `tags` field kind drawn as chips with a filter |
| 171 | `01M2KJSVEXVPJ6VSV5EKK4SBN4` | ext-api: Form.DatePicker | missing | V:S E:M | a `date` field kind: calendar's New event already parses days and times from words (`extensions/calendar/schedule.ts`); move that parser into the SDK and validate in the panel |
| 172 | `01M2KJSVEXVPJ6VSV5EPB43BZT` | ext-api: Form.FilePicker | missing | V:S E:S | a `file` / `directory` field kind opening the OS chooser (tauri dialog plugin) with the path typed back into a text field |
| 173 | `01M2KJSVEXVPJ6VSV5ER8T4AE4` | ext-api: Form Separator, Description and LinkAccessory | partial | V:S E:S | Missing: a separator and a static text block; `description` per field exists. Fit: `{ kind: "note", text }` and `{ kind: "separator" }` in `FormField` |
| 174 | `01M2KJSVEXVPJ6VSV5ERXZ50S9` | ext-api: ActionPanel with Sections and Submenus | partial | V:S E:S | Missing: submenus in the action panel (sections exist). Fit: `Action.children` drawn as a second level in `ActionPanel.tsx`; files' Open with… would move there from a palette level |
| 176 | `01M2KJSVEXVPJ6VSV5EWSAY70E` | ext-api: Color enum, dynamic and raw colors | done |  | tag palette as token names, hex on tiles and icons, `accent` / `destructive` roles: `sdk/src/protocol.ts` |
| 177 | `01M2KJSVEXVPJ6VSV5EZVKH1T2` | ext-api: Icon enum (478 built-in icons with light/dark SVGs) | done |  | Nerd Font glyphs (11k), `xdg()` names, `{ app }`, `{ image }`: a different vocabulary with the same reach |
| 178 | `01M2KJSVEXVPJ6VSV5F0E153KX` | ext-api: Image model: sources, fallback, mask, tint, FileIcon and emoji | partial | V:S E:S | Missing: a light/dark pair, a tint, a fallback, remote urls (favicons only via `url`). Fit: `{ image, dark?, tint? }` on `Icon`; remote images through the disk cache of 166 |
| 179 | `01M2KJSVEXVPJ6VSV5F0E510C9` | ext-api: Keyboard shortcut model (modifiers, keys, Common set, reserved) | done |  | `shortcut` strings and lists, shell keys refused at load, `cmd` mapped per platform: `keys.ts`, `checkView` |
| 180 | `01M2KJSVEXVPJ6VSV5F0WCC66D` | ext-api: Navigation stack: useNavigation push/pop and Action.Push | done |  | levels: `push`, `show`, `view`, `form`; Escape and cmd+backspace pop: `Launcher.tsx` |
| 181 | `01M2KJSVEYVAKYFC8GT6B0JYA9` | ext-api: Quick Look for items (quickLook prop and Action.ToggleQuickLook) | partial | V:S E:S | Missing: a generic `Item.quicklook` path with cmd+Y in the shell; files does `qlmanage -p` itself. Fit: the field plus one shell action, `qlmanage` in core |
| 182 | `01M2KJSVEYVAKYFC8GT7YCZSJ9` | ext-api: Drag and drop items out of the launcher | missing | V:S E:M | dragging a row with a path out of the panel as a file (`NSDraggingSource` file promise from the row element); useful for files and clipboard images even keyboard-first |
| 183 | `01M2KJSVEYVAKYFC8GTBBNYAZB` | ext-api: Action base component and Action.Style | done |  | `Action { id, title, icon, shortcut, style, confirm, hidden, section }`: `sdk/src/protocol.ts` |
| 185 | `01M2KJSVEYVAKYFC8GTCQ2R135` | ext-api: Open actions: Action.Open, Action.OpenInBrowser, Action.OpenWith | done |  | `open` effect, files' Open with… over `apps.forFile`/`openWith`: `docs/extensions.md` |
| 187 | `01M2KJSVG7QNPDTXJJZN62J33W` | ext-api: Action.CreateSnippet and Action.CreateQuicklink | partial | V:S E:S | Missing: prefilling another extension's create form. `push` reaches the palette but not its form. Fit: quicklinks and snippets honour `args: { create: { name, url \| text, keyword } }` by answering the form prefilled; then 50 and 74 are one line each |
| 189 | `01M2KJSVG8R9ZF565JQJZ1RP42` | ext-api: Action.PickDate | missing | V:S E:S | with 171: an action variant that opens the date field alone |
| 190 | `01M2KJSVG8R9ZF565JQPEN11YF` | ext-api: Toast API (showToast, styles, actions, HUD fallback) | done |  | `toast { title, message, style }`: `Toast.tsx`; no actions on a toast, `keep` covers the flow |
| 191 | `01M2KJSVG8R9ZF565JQPMP5PHG` | ext-api: HUD (showHUD) | done |  | `hud` effect, `copy` shows Copied: `hud.rs` |
| 192 | `01M2KJSVG8R9ZF565JQRT7H81N` | ext-api: Alert dialogs (confirmAlert, rememberUserChoice) | done |  | `Confirm` overlay, `action.confirm`, `deeplink_confirm`: `Confirm.tsx` |
| 193 | `01M2KJSVG8R9ZF565JQWKYZTFC` | ext-api: Clipboard API (copy, paste, read with history offset, concealed) | done |  | `clipboard.list/get/pin/delete/clear/copy/imageUrl`, `paste { entry \| text }`: `docs/extensions.md` |
| 194 | `01M2KJSVG8R9ZF565JQZ5HN9HC` | ext-api: LocalStorage (encrypted per-extension key-value store) | done |  | `storage.get/set/remove/keys`, 256 KB per extension, atomic: `docs/extensions.md` Storage |
| 195 | `01M2KJSVG8R9ZF565JR19QAY51` | ext-api: Cache class (synchronous LRU file cache with subscriptions) | missing | V:S E:S | `cache.get/set(key, value, ttl)` next to `storage`: a per-extension file with capacity and age, no 256 KB cap (github and network roll their own today) |
| 196 | `01M2KJSVG8R9ZF565JR46TB8MR` | ext-api: environment object | partial | V:S E:S | Missing: `environment` facts (appearance, isDevelopment, version, platform). Fit: an `env` object filled at `hello` |
| 197 | `01M2KJSVG8R9ZF565JR4GCVNH2` | ext-api: getSelectedText and getSelectedFinderItems | missing | V:M E:M | `selection.text()` in core: AX `AXSelectedText` of the focused element captured when the panel shows, cmd+C-and-restore as the fallback; `selection.finderItems()` via `osascript`. Unlocks `{selection}` (46), Pass selected text (100), define (126), translate (115) |
| 198 | `01M2KJSVG8R9ZF565JR4KZ1GFY` | ext-api: Applications and file utilities (open, getApplications, trash) | done |  | `apps.forFile`, `apps.openWith`, `open` effect: `docs/extensions.md`; the frontmost app is 57 |
| 199 | `01M2KJSVG8R9ZF565JR6Q3AZAR` | ext-api: Window and search bar control (closeMainWindow, popToRoot) | done |  | `hide`, `keep`, `push`, `show`; `effects.run` from outside a pick: `docs/extensions.md` |
| 200 | `01M2KJSVG8R9ZF565JR7D48EXB` | ext-api: OAuth.PKCEClient API | missing | V:S E:L | `oauth.authorize({ authorizeUrl, tokenUrl, clientId, scope })` in core: opens the browser, `pal://oauth` callback (51), PKCE, tokens in the keychain under the extension. Only worth it for the first extension that needs Google or Slack OAuth; slack and github use tokens |
| 201 | `01M2KJSVG8R9ZF565JR7QET2VH` | ext-api: OAuth redirect methods, CIMD and Raycast-hosted proxy endpoints | not for pal |  | Raycast-hosted redirect proxy and client ids |
| 204 | `01M2KJSVG8R9ZF565JRDS1X6GG` | ext-api: BrowserExtension API (getContent, getTabs) | partial | V:S E:S | Missing: page content. browser-tabs speaks CDP and AppleScript itself (`extensions/browser-tabs/cdp.ts`). Fit: `tabs.text(id)` / `markdown` in that extension's exports (what `bt text` does), usable by a `{browser-tab}` placeholder |
| 206 | `01M2KJSVG8R9ZF565JRMNDV10Q` | ext-api: @raycast/utils: usePromise | not for pal |  | React hook; pal extensions are plain TypeScript |
| 207 | `01M2KJSVG8R9ZF565JRP30YBVY` | ext-api: @raycast/utils: useCachedPromise and useCachedState | not for pal |  | React hook; `storage` and a `ttl` cover the stale-while-revalidate case |
| 208 | `01M2KJSVG8R9ZF565JRRQFVACJ` | ext-api: @raycast/utils: useFetch | not for pal |  | React hook; Bun's `fetch` |
| 209 | `01M2KJSVG8R9ZF565JRVB3N8D1` | ext-api: @raycast/utils: useExec | done |  | `Bun.spawn` / `Bun.$` with timeouts, `pal_core::tool` on the core side |
| 210 | `01M2KJSVG8R9ZF565JRYRA7W0Y` | ext-api: @raycast/utils: useSQL and executeSQL | done |  | `bun:sqlite` in otp and bookmarks (copy a locked db first), Full Disk Access as a hint row |
| 212 | `01M2KJSVG8R9ZF565JRZG7Q9X0` | ext-api: @raycast/utils: useStreamJSON | not for pal |  | React hook; streaming JSON is Bun's |
| 213 | `01M2KJSVG8R9ZF565JS0NCMXR2` | ext-api: @raycast/utils: useLocalStorage | done |  | `storage` API |
| 214 | `01M2KJSVG8R9ZF565JS1K1B3ZZ` | ext-api: @raycast/utils: useForm and FormValidation | done |  | the form contract: `errors` per field back in place, `required` checked in the panel |
| 215 | `01M2KJSVG8R9ZF565JS5DYQVK1` | ext-api: @raycast/utils: runAppleScript and runPowerShellScript | done |  | `osascript` through `Bun.spawn`; `tool::osascript` in core |
| 216 | `01M2KJSVG8R9ZF565JS7P5GDRM` | ext-api: @raycast/utils: getFavicon with providers | done |  | `url` on a row gets the site's favicon from the site itself: `core/src/icons.rs` |
| 217 | `01M2KJSVG8R9ZF565JS8NFGXDN` | ext-api: @raycast/utils: getAvatarIcon and getProgressIcon | missing | V:S E:S | `icons.avatar(name)` and `icons.progress(0..1)` helpers in `@zcag/pal` returning SVG data urls (`{ image }` takes them today) |
| 218 | `01M2KJSVG8R9ZF565JS8XD5M6F` | ext-api: @raycast/utils: OAuthService with built-in providers | not for pal |  | Raycast-hosted client ids |
| 219 | `01M2KJSVG8R9ZF565JSAF05WZJ` | ext-api: @raycast/utils: withAccessToken and getAccessToken | not for pal |  | with 218 |
| 224 | `01M2KJSVG9QKFDCYQ6Z39HMY89` | ext-api: Script Commands: discovery and @raycast.* metadata header | partial | V:M E:S | Missing: single executables with a metadata header. The scripts tier is `[palette.<name>]` tables + JSON lines (`docs/scripts.md`). Fit: a `scripts_dir` setting whose executables carrying `# @pal.title` / `@raycast.title`, `mode`, `icon`, `argument1` become one-row palettes (or rows of one `Script Commands` palette); pal generated exactly these for Raycast, so the parser is known |
| 225 | `01M2KJSVGC29K4JCR16T4XR9HY` | ext-api: Script Commands: output modes, ANSI colours and error handling | partial | V:S E:S | Missing: `inline` (stdout's first line as the row subtitle, refreshed on a schedule) and ANSI in `show`. Fit: `mode inline` + `refreshTime` on 224 mapped to `live` + `ttl`; an ANSI-to-markdown pass before `show` |
| 226 | `01M2KJSVGC29K4JCR16X738Y34` | ext-api: Script Commands: arguments | partial | V:S E:S | Missing: declared arguments; input tables get `PAL_QUERY`. Fit: 23's fields exported as `PAL_ARG1..3` |
| 227 | `01M2KJSVGC29K4JCR16XBB5F13` | ext-api: Script Commands: execution environment, templates, conventions | done |  | shebang decides, login PATH merged, `env_file`, `_PAL_*` variables: `docs/scripts.md` |
| 228 | `01M2KJSVGC29K4JCR170X2WZF7` | ext-api: ray build and ray bundle | done |  | no build step: Bun runs the TypeScript; bundled extensions are staged by `scripts/build-extensions.sh` |
| 229 | `01M2KJSVGC29K4JCR172G81120` | ext-api: ray develop | done |  | `extension_dirs` live reload: `docs/extensions.md` Writing one |
| 230 | `01M2KJSVGC29K4JCR174A30JJV` | ext-api: ray lint and the @raycast/eslint-config | partial | V:S E:S | Missing: a CLI. `checkPalettes` / `checkView` / `checkForm` / `checkBarItem` run at load and are exported for tests. Fit: `pal lint <dir>`: manifest schema, `checkPalettes`, tagline length, keys vs shell keys (the polish pass's rules as code) |
| 231 | `01M2KJSVGC29K4JCR177CRQ1S8` | ext-api: ray publish, pull-contributions and account commands | missing | V:S E:M | `pal publish` opening a PR that adds the spec to `community.json` (`gh pr create`); today it is a hand PR. No accounts |
| 232 | `01M2KJSVGC29K4JCR17AC18A0V` | ext-api: ray migrate codemods and the API versioning model | missing | V:S E:S | `"api": "1"` in `pal.json` and the host warning when the wire it speaks is older; the SDK is provisional until 1.0 (`docs/extensions.md`), so a codemod tool is for later |
| 233 | `01M2KJSVGC29K4JCR17CJYC3CY` | ext-api: CLI config file and environment overrides | not for pal |  | Raycast CLI account config |
| 234 | `01M2KJSVGC29K4JCR17E01XCKK` | ext-api: Store submission pipeline and review process | done |  | publishing is a PR to `community.json`, pal-site syncs hourly: `pal-site/README.md` |
| 235 | `01M2KJSVGC29K4JCR17GMBKQYG` | ext-api: Store listing assets: icon, README, screenshots, CHANGELOG, naming | done |  | `STORE-FIELDS.md`, screenshots per extension, tagline under 60, the polish pass table: `notes/decisions.md` |
| 236 | `01M2KJSVGC29K4JCR17NRXZJR6` | ext-api: What installed store extensions actually use (compat priorities) | not for pal |  | Raycast-compat acceptance set; compat is "nice to have" by decision |
| 238 | `01M2KJSVGC29K4JCR17TTSKAAE` | ext-api: Raycast-compat shim strategy (how Vicinae maps @raycast/api) | missing | V:S E:L | a `@raycast/api` shim over the fixed tree (List/Item/ActionPanel/Detail/Form subset) so simple store extensions load; nice to have per decisions, a week of work for a subset |
| 239 | `01M2KJSVGC29K4JCR17WR6ZH2K` | ext-api: Multi-instance extensions (gap: one config per extension) | missing | V:S E:M | `[extensions.github.instances.work]` = a second copy of the settings with its own storage namespace and palette ids suffixed `@work`; the host loads the module once per instance |
| 240 | `01M2KJSVGC29K4JCR1804716GD` | ext-api: Richer views, HTML previews and floating windows (gap) | done |  | the view tree (stack / text / tile / gradient / image / badge / progress / keycap, transitions, `input`), no HTML by design: `docs/extensions.md` |
| 241 | `01M2KJSVGC29K4JCR181MNES53` | ext-api: Non-JS extensions (gap: Script Commands are the only path) | done |  | the scripts tier: JSON lines with rows, actions, detail, `show`, drill-in; any language: `docs/scripts.md` |
| 242 | `01M2KJSVGC29K4JCR183KYRZ78` | store: Store index page (search, sort tabs, list cards) | done |  | pal.cagdas.io/extensions: shelves by category, client-side search and filters: `pal-site/README.md` |
| 243 | `01M2KJSVGC29K4JCR184R1D9TJ` | store: Featured extensions strip | not for pal |  | hand curation by community managers; the shelf order on pal-site is the equivalent |
| 244 | `01M2KJSVGC29K4JCR1863HGTV3` | store: Category pages and category taxonomy | done |  | categories as shelves and filters on pal-site |
| 245 | `01M2KJSVGC29K4JCR187G0NBC3` | store: Store feeds (JSON Feed, Atom, RSS) | missing | V:S E:S | `/extensions/feed.json` on pal-site from the registry rows; ten lines of Go |
| 246 | `01M2KJSVGC29K4JCR189E6G3Z5` | store: Listing page header and install button | done |  | `/extensions/<name>` with the install line and "Open in pal" (`pal://install`) |
| 247 | `01M2KJSVGC29K4JCR18BXEMZ5Y` | store: Listing tabs: Overview, Commands, Version History | partial | V:S E:S | Missing: a version history tab (271). Palettes, actions, settings, facts are on the page |
| 248 | `01M2KJSVGC29K4JCR18DKMTXWC` | store: Listing screenshots carousel | done |  | screenshots per extension on the listing page |
| 250 | `01M2KJSVGC29K4JCR18G9HF9J0` | store: Author, owner, contributors and past contributors | partial | V:S E:S | Missing: contributors. `author` from `pal.json` is shown. Fit: a `contributors` array in the manifest, avatars from GitHub |
| 251 | `01M2KJSVGDZ6XS22YJE7ENYR8P` | store: Source link, bug/feature templates, related extensions | done |  | source link (the spec), related extensions on the page; bug reports go to the repo the spec names |
| 252 | `01M2KJSVGDZ6XS22YJE9EPJNAP` | store: Listing status, version and download metadata | done |  | registry rows with the spec and manifest; `pal update` compares the recorded ref against GitHub |
| 253 | `01M2KJSVGDZ6XS22YJEAWDQ6FJ` | store: User and organization profile pages | not for pal |  | accounts and profiles |
| 254 | `01M2KJSVGDZ6XS22YJEC7RJBDG` | store: Backend API: list and search listings | done |  | `/api/extensions` and `/api/extensions/<name>`: `pal-site/README.md` |
| 255 | `01M2KJSVGDZ6XS22YJED68DCA8` | store: Backend API: single extension, user, prompts endpoints | done |  | same |
| 257 | `01M2KJSVGDZ6XS22YJEGYWVC7C` | store: In-app Store command (browse, details, install) | partial | V:M E:M | Missing: browsing inside the panel. The `Extension Store` row opens the site, `Install Extension` is a form. Fit: a `store` palette over `/api/extensions` (cached with a `ttl`), rows with tagline and category, Enter installs through `Store::install` with the same confirm card, Installed / Update filters from the registry |
| 258 | `01M2KJSVGDZ6XS22YJEHH2PCZD` | store: In-app Store filters (Installed, category, AI, organization) | missing | V:S E:S | with 257: category and Installed filters as the palette's `filters` |
| 260 | `01M2KJSVGDZ6XS22YJEM7VA7ZE` | store: Install from web deeplink | done |  | `pal://install/<spec>` with a confirm card: `docs/cli.md` Deep links |
| 261 | `01M2KJSVGDZ6XS22YJEQAJZDBZ` | store: Extension auto-update and update details | partial | V:S E:S | Missing: background auto-update. `pal update`, the Extensions page check and the Overview row exist. Fit: `general.auto_update_extensions = true` running `pal update` after the daily release check, a HUD naming what changed |
| 264 | `01M2KJSVGG1RTCGGEQF7P4VPB1` | store: Report extension issues and feedback | partial | V:S E:S | Missing: per-extension bug reports. Report a Bug is pal's. Fit: a "Report an issue" button on the Extensions pane opening the extension's repo issues with the version filled |
| 265 | `01M2KJSVGG1RTCGGEQFAYHY12Q` | store: Installed-extension registry and on-disk layout | done |  | store dir per extension, `.pal-install.json`, `pal list` |
| 266 | `01M2KJSVGG1RTCGGEQFDPDRX52` | store: Import, create and manage local extensions | done |  | `pal install <dir>`, `extension_dirs`, live reload; a scaffold is 146 |
| 267 | `01M2KJSVGG1RTCGGEQFHP3JD5K` | store: Publishing flow: build, publish, PR review | done |  | PR to `community.json`, hourly sync, no review queue |
| 268 | `01M2KJSVGG1RTCGGEQFJ9HKB3C` | store: Store metadata and naming rules | done |  | `STORE-FIELDS.md` and the polish pass rules (sentence-case actions, Title Case palettes, taglines) |
| 269 | `01M2KJSVGG1RTCGGEQFKDP4XKB` | store: Extension icon and README requirements | done |  | `icon` in `pal.json`, README next to it shown on pal-site |
| 270 | `01M2KJSVGG1RTCGGEQFNH0MNEA` | store: Screenshot requirements and metadata folder | done |  | `screenshots/` per extension, rendered by `app/scripts/shots.mjs` from fixtures |
| 271 | `01M2KJSVGG1RTCGGEQFNT9VGBB` | store: CHANGELOG.md and Version History | missing | V:S E:S | `CHANGELOG.md` next to `pal.json` rendered as a Version history tab on pal-site and shown after `pal update` |
| 272 | `01M2KJSVGG1RTCGGEQFR2T7BQP` | store: CI lint enforcers and rejection criteria | partial | V:S E:S | Missing: a CI check on `community.json` entries. `host/test/manifest.test.ts` sweeps the bundled set. Fit: the `pal lint` of 230 run by pal-site's sync, a broken manifest logged and skipped (it is already) |
| 273 | `01M2KJSVGG1RTCGGEQFSETN7R7` | store: Binaries policy | partial | V:S E:S | Missing: a written binaries rule beyond Trust. `store.permissions` names required CLIs. Fit: two sentences in `docs/extensions.md`: system binaries first, downloads only from the vendor with a checksum, no opaque blobs |
| 274 | `01M2KJSVGG1RTCGGEQFTHM79A1` | store: Ownership transfer and contributor credits | not for pal |  | store accounts and credits |
| 316 | `01M2KJSVH21VZCFD6ZM6NCQDWJ` | beyond: Script Filter JSON (rerun, cache, mods, autocomplete, children) | done |  | the scripts protocol: rows with icon / subtitle / accessories / detail / actions / preview, `show`, drill-in, `reload`: `docs/scripts.md`; modifier variants and rerun are 225 |
| 319 | `01M2KJSVH3TSHV3PNZE20GABQ9` | beyond: npm as the plugin registry | not for pal |  | npm as the registry; pal installs from GitHub specs by decision |
| 320 | `01M2KJSVH3TSHV3PNZE36852FN` | beyond: Extension install/upgrade from CLI or a git URL | done |  | `pal install github:user/repo[/dir][@ref]`, a URL, a directory; `pal update`, `remove`, `list`: `docs/cli.md` |
| 322 | `01M2KJSVH3TSHV3PNZE4VN4NPJ` | beyond: Declarative plugin settings without code (YAML template) | done |  | `settings[]` in `pal.json` rendered by Settings and kept in the config file |
| 324 | `01M2KJSVH3TSHV3PNZEK5C4CD7` | beyond: Adaptive Cards declarative forms | done |  | `Effect.form` is a declarative JSON form the panel draws: `docs/extensions.md` Forms |
| 325 | `01M2KJSVH3TSHV3PNZEK5CAK7K` | beyond: CmdPal page model (List/Detail/Form/Markdown/Grid, CommandResult) | done |  | List / Grid / Detail / Form / View levels, effects as command results, `keep` / `hide` / `push`: `docs/extensions.md` |
| 326 | `01M2KJSVH3TSHV3PNZEKWC7DJN` | beyond: Editor and terminal prompts inside the launcher | not for pal |  | an editor or terminal pane is HTML-class UI the tree excludes by design; `View.input` and `textarea` are the line |
| 327 | `01M2KJSVH3TSHV3PNZEQ9AN1TB` | beyond: Markdown scriptlets (headings become commands) | missing | V:S E:S | the scripts tier reading a `.md` file: each `## heading` with a code fence is a row whose Enter runs the fence (`$1` prompts through 23); his `cmds` data file wants exactly this |
| 328 | `01M2KJSVH3TSHV3PNZEV7PE12N` | beyond: WebView panels embedding sites with custom UA/CSS | not for pal |  | no HTML by design |
| 332 | `01M2KJSVH4TCMWJRCGAHQ42XQ7` | beyond: Script output modes: terminal mode, ANSI colors, exec directive | partial | V:S E:S | with 225: `terminal` mode running the script in the ssh extension's terminal launcher |
| 356 | `01M2KJSVH8JA3CZ8Q49MW2PAST` | beyond: Paste/type into previous app and simulate input from plugins | partial | V:S E:S | Missing: character typing for fields that refuse a paste. `paste`, `pal action type` (a paste), `focus` exist. Fit: `type: text` effect posting `CGEventKeyboardSetUnicodeString` chunks; no mouse |
| 372 | `01M2KJSVHCQD0A9ASDXKG97GDA` | beyond: Drag and drop results out of the launcher | missing | V:S E:M | with 182 |
| 386 | `01M2KJSVHDZ5QKD0W153JD134V` | gap: Extension sandboxing and permission system | missing | V:M E:L | `store.permissions` is declared but not enforced (Trust says install what you would run). Fit: with 136's worker per extension, a `net` allow-list from the manifest checked in a `fetch` wrapper and `fs` roots checked in the bridge; enforce declared, log undeclared first |
| 390 | `01M2KJSVHDZ5QKD0W15JT1SJS1` | gap: Richer UI components (HTML in Detail, chat view, SVG/GIF) | done |  | the view tree with tiles, gradients and SVG data urls; HTML excluded on purpose |
| 391 | `01M2KJSVHDZ5QKD0W15P6V2J9W` | gap: Programmable floating / detached windows for extensions | partial | V:S E:L | Missing: an extension-owned detached window. The bar popover is a detached window an extension fills through its bar item's `menu` / `view`. Fit: enough for now; a `window` effect is a Tauri window per extension and a lot of focus rules |
| 396 | `01M2KJSVHGH3B1WDCG2VF203PG` | gap: Write preferences programmatically | missing | V:M E:S | `settings.set(key, value)` writing the config through `edit::set` (toml_edit, comments kept) with the same round trip Settings uses; unblocks a `calendars` visibility palette and colors' filters, both noted as blocked in the decisions |
| 400 | `01M2KJSVHGH3B1WDCG36HYZ7EK` | gap: User shell PATH for extensions | done |  | `pal_core::env::adopt` at startup: `notes/decisions.md` Findings |
| 401 | `01M2KJSVHGH3B1WDCG39S9P147` | gap: Small API asks (frontmost app, multi-app picker, keep-open) | partial | V:S E:S | Missing: the front app (57) and a multi-app picker setting. `keep` covers keep-open. Fit: `apps` setting kind with `multiple: true` drawn as chips from the apps index |
| 402 | `01M2KJSVHGH3B1WDCG3AEH92KA` | gap: Extensions in languages other than JS/React | done |  | the scripts tier: shell, Python, anything printing JSON lines: `docs/scripts.md` |

## Settings

| # | id | idea | class | V/E | pal today, and the fit |
| --- | --- | --- | --- | --- | --- |
| 20 | `01M2KJSVCYQ16H34C0QEYQVDRQ` | core: Hotkey recorder: sides, key equivalents, conflict detection | done |  | recorder with presets, auto-save, per-entry status, Spotlight conflict polling: `SettingsGeneral.tsx`, `pal_core::spotlight` |
| 21 | `01M2KJSVCYQ16H34C0QGVTWHCF` | core: Settings > Shortcuts page | partial | V:M E:M | Missing: items in the table (the Palettes page lists palettes with on / alias / hotkey inline, `SettingsPalettes.tsx`). Fit: expand a palette row to its indexed items with alias and hotkey cells, backed by 18 and 19 |
| 34 | `01M2KJSVD2FF4FMG80X6A1J5TE` | core: Interface Size (text size) | missing | V:S E:M | `general.text_size = default\|large`: the tokens are rem-based, so one root font-size step; the panel height follows |
| 35 | `01M2KJSVD2FF4FMG80XJ2VJXS3` | core: Settings window shell, search and routes | done |  | settings window with six icon tabs, search with anchors, cmd+1..6, `pal settings <page>`, `pal://settings`: `Settings.tsx`, `settings.rs` |
| 36 | `01M2KJSVD2FF4FMG80XK0TABBS` | core: General settings page | done |  | General: hotkey, permissions, theme, position, launch at login, menu bar icon, config file, maintenance: `SettingsGeneral.tsx` |
| 37 | `01M2KJSVD2FF4FMG80XKG1JF6D` | core: Launcher settings page | partial | V:M E:S | Missing: a Launcher group (pop to root, fallbacks, search history). Fit: the settings of 4, 15 and 24 as one group on General; nothing to build on its own |
| 38 | `01M2KJSVD3C26CH27BJXCRTV9Q` | core: Appearance: follow system or fixed light/dark theme pair | done |  | `general.theme = system\|light\|dark` applied live to both windows: `theme.ts`, `docs/config.md` |
| 41 | `01M2KJSVD3C26CH27BK8ZBN4KX` | core: About tab | done |  | About: version, updates, links, Copy Diagnostics, last crash, licences: `SettingsAbout.tsx` |
| 42 | `01M2KJSVD3C26CH27BKC70CWB2` | core: Extension entries in Settings (per-extension controls) | done |  | Extensions page (hero, screenshots, callouts, settings form, palettes as chips) and Palettes page (on / alias / hotkey inline, pane with tier, keys, settings): `SettingsExtensions.tsx`, `SettingsPalettes.tsx` |
| 43 | `01M2KJSVD3C26CH27BKQEJBK6F` | core: Custom themes: JSON schema, sharing, deeplink import [Pro] | missing | V:M E:M | A theme file: `[general] theme_file = "~/.config/pal/theme.toml"` (or one per light/dark) overriding `--pal-*` tokens from `tokens.css`, read at load and on change; pairs with his `theme` CLI (Catppuccin Frappe / Rose Pine Dawn) without a GUI |
| 44 | `01M2KJSVD3C26CH27BKTWDGZ9Y` | core: Theme Studio editor and Switch Theme command | not for pal |  | a GUI theme editor is against the file-first design; the theme file of 43 is the whole feature |
| 131 | `01M2KJSVDJ2SF0Q1A8N36BZ52C` | builtin: Raycast Settings shortcut commands (@raycast-settings) | done |  | pal rows: Settings, Settings › Extensions / Palettes / About, Open Config File, Toggle Theme, ...: `commands.rs` |
| 262 | `01M2KJSVGG1RTCGGEQF3VKRTNF` | store: Per-extension settings: enable, configure, uninstall | done |  | Extensions page: enable per palette (Palettes page), settings form, Update and Remove: `SettingsExtensions.tsx` |
| 284 | `01M2KJSVGH5B56PX6F6YB6ZN48` | store: Theme Explorer, theme JSON schema and raycast://theme deeplink | missing | V:S E:M | with 43: a gallery of theme files on pal-site |
| 374 | `01M2KJSVHCQD0A9ASDXQ06VY3X` | beyond: Free custom themes with inheritance, matugen and AI generation | partial | V:M E:M | with 43: a theme file; inheritance is a `base = "dark"` key; matugen output can be a theme file; no paywall |
| 375 | `01M2KJSVHCQD0A9ASDXV4H6QVM` | beyond: Background image, Mica/Acrylic backdrop, opacity and blur | not for pal |  | the panel's material and vibrancy are fixed by the brief; a background image is not the design |
| 376 | `01M2KJSVHCQD0A9ASDXW7FGZZY` | beyond: Layout themes separate from color schemes | missing | V:S E:M | with 34: `general.density = comfortable\|compact` (row height and paddings are tokens) |
| 377 | `01M2KJSVHCQD0A9ASDXYTQWW7Y` | beyond: Skins as image packs | not for pal |  | image-pack skins |

## Bar / menu bar

| # | id | idea | class | V/E | pal today, and the fit |
| --- | --- | --- | --- | --- | --- |
| 71 | `01M2KJSVD8VFVAYT1FGWYQ15YR` | builtin: Menu Bar Agenda (next event in the menu bar) | done |  | `calendar/upcoming` bar item: next event, join and open in the popover: `extensions/calendar/pal.json` |
| 156 | `01M2KJSVEXVPJ6VSV5DJ5VTJ33` | ext-api: Menu-bar command lifecycle | done |  | bar items render on load, on their timer, on push; last state in `bar.json`; `dispose()` on reload: `docs/extensions.md` |
| 175 | `01M2KJSVEXVPJ6VSV5ETDJCMDC` | ext-api: MenuBarExtra component tree | done |  | bar `menu` nodes: items with shortcut / checked / disabled / destructive, sections, submenus (3 deep), separators: `docs/design/bar.md` |
| 361 | `01M2KJSVH99GDGGQHBQYCBN4C1` | beyond: Glance live stats beside the query box and performance pages | not for pal |  | bar items are pal's glance surface and sketchybar already shows stats; a stat strip beside the query is not the design |

## Onboarding

| # | id | idea | class | V/E | pal today, and the fit |
| --- | --- | --- | --- | --- | --- |
| 263 | `01M2KJSVGG1RTCGGEQF7064QC5` | store: Extension terms, permissions and gating prompts | partial | V:S E:S | Missing: nothing worth building; `store.permissions` names what an extension needs, the install card asks, Trust in `docs/extensions.md` says the rest |
| 321 | `01M2KJSVH3TSHV3PNZE3XJM1TW` | beyond: Per-workflow user configuration form and README on import | partial | V:S E:S | Missing: the README in Settings on install (the site shows it; the Extensions pane shows tagline, callouts, needsSetup and the settings form). Fit: render `README.md` in the pane under the hero |

## Sync, import and export

| # | id | idea | class | V/E | pal today, and the fit |
| --- | --- | --- | --- | --- | --- |
| 45 | `01M2KJSVD3C26CH27BKZAHZS62` | core: Import Settings & Data (selective, cross-platform, additive) | partial | V:S E:S | Missing: one-shot bundle. The config file is the settings export, `storage/*.json` the data, quicklinks and snippets have import/export forms. Fit: `pal export <tar>` / `pal import` over config + storage; dotfiles already do this for him |
| 277 | `01M2KJSVGG1RTCGGEQFZH1KMG5` | store: ray.so explorers: shared share/import model | partial | V:S E:M | Missing: a web catalogue with Add to pal for quicklinks / snippets / themes. Import forms take JSON files today. Fit: `pal://import/quicklinks?json=` (a deep link into the existing import) and static JSON lists on pal-site; small once 98 and 280 exist |

## AI

| # | id | idea | class | V/E | pal today, and the fit |
| --- | --- | --- | --- | --- | --- |
| 188 | `01M2KJSVG8R9ZF565JQJE02AWR` | ext-api: Action.InstallMCPServer | not for pal |  | AI/MCP feature |
| 202 | `01M2KJSVG8R9ZF565JR9BJM5D3` | ext-api: AI.ask API (Pro) | not for pal |  | cloud AI API |
| 203 | `01M2KJSVG8R9ZF565JRBCX5644` | ext-api: AI.Model enum and deprecated alias remapping | not for pal |  | cloud AI model list |
| 220 | `01M2KJSVG9QKFDCYQ6YX2D0DG4` | ext-api: AI tool file contract, manifest entry and JSON schema generation | not for pal |  | AI tools |
| 221 | `01M2KJSVG9QKFDCYQ6YX37E6SM` | ext-api: AI instructions and the ai.yaml manifest file | not for pal |  | AI manifest |
| 222 | `01M2KJSVG9QKFDCYQ6YZS5WV7X` | ext-api: AI evals grammar and ray evals | not for pal |  | AI evals |
| 223 | `01M2KJSVG9QKFDCYQ6Z1GQGACC` | ext-api: AI skills (SKILL.md) and the agent plugin.json manifest | not for pal |  | AI skills |
| 249 | `01M2KJSVGC29K4JCR18EJG4RQ3` | store: AI tools and prompt examples on listings | not for pal |  | AI tools on listings |
| 259 | `01M2KJSVGDZ6XS22YJEKCA8182` | store: Ask Store AI extension (@store) | not for pal |  | AI over the store |
| 281 | `01M2KJSVGG1RTCGGEQGAXCJM78` | store: Prompt Explorer and AI commands import deeplink | not for pal |  | AI prompts |
| 282 | `01M2KJSVGG1RTCGGEQGCVK31A5` | store: Preset Explorer and AI presets import deeplink | not for pal |  | AI presets |
| 300 | `01M2KJSVGH5B56PX6F805YTQ15` | store: Enterprise: Organization-wide AI toggle and AI feedback control | not for pal |  | Enterprise AI toggle |
| 301 | `01M2KJSVGH5B56PX6F80HF016A` | store: Enterprise: AI provider allow-list and org BYOK | not for pal |  | Enterprise AI providers |
| 302 | `01M2KJSVGNE88GDEPA316DN8J4` | store: Enterprise: Custom AI provider configuration (AI gateway) | not for pal |  | Enterprise AI gateway |
| 303 | `01M2KJSVGNE88GDEPA3265GSK5` | store: Enterprise: Organization-managed MCP servers | not for pal |  | Enterprise MCP |
| 306 | `01M2KJSVGNE88GDEPA38AEM1AZ` | store: AI credits, usage-based pricing and top-ups | not for pal |  | AI credits |
| 323 | `01M2KJSVH3TSHV3PNZED7JVTZ3` | beyond: Plugin tools exposed to AI agents via JSON Schema (free tier) | not for pal |  | AI tools |
| 378 | `01M2KJSVHCQD0A9ASDXZ3YG6KA` | beyond: Installed-CLI agents as chat providers, %s AI commands (Wox) | not for pal |  | AI chat providers |
| 379 | `01M2KJSVHCQD0A9ASDY0RST5RN` | beyond: Local semantic search and summarization without cloud | not for pal |  | local ML ranking and summaries; frecency and nucleo are enough for a launcher |
| 380 | `01M2KJSVHCQD0A9ASDY0ZMZ99V` | beyond: ai() / ai.object() / assistant() helpers for scripts | not for pal |  | AI helpers for scripts |

## Platform, product and business

| # | id | idea | class | V/E | pal today, and the fit |
| --- | --- | --- | --- | --- | --- |
| 53 | `01M2KJSVD7AE742Y644XE1FX5B` | core: File-system layout: config, support, caches, logs, node runtime | done |  | config, data dir per profile, `clipboard.db`, `storage/`, `extensions/`, the log: `docs/getting-started.md` "Where the rest lives" |
| 58 | `01M2KJSVD7AE742Y6459J2TJ8K` | core: Crash reporting and telemetry (what leaves the machine) | done |  | no telemetry, no crash upload; crash and panic reports stay local (`docs/config.md` Crash relaunch) |
| 59 | `01M2KJSVD7AE742Y645AR6F54A` | core: Network egress inventory (InternetAccessPolicy) | missing | V:S E:S | Ship `InternetAccessPolicy.plist` in the bundle naming frankfurter, github.com/api.github.com, pal.cagdas.io, favicon hosts (any site), HA/Slack as user-set; Little Snitch and LuLu read it. An afternoon |
| 95 | `01M2KJSVDD76EFZZC8Y3R297DH` | builtin: Raycast Notes floating window | not for pal |  | a floating notes app is outside a launcher; his notes are the vault and nvim |
| 96 | `01M2KJSVDD76EFZZC8Y3TM5VA6` | builtin: Notes Markdown editor, shortcuts and Format Bar | not for pal |  | with 95 |
| 133 | `01M2KJSVDJ2SF0Q1A8N9QKJ9RB` | builtin: Raycast Wrapped (year in review) | missing | V:S E:S | A `pal:wrapped` row in December from `frecency.json` (launches, top rows, top palettes, hours) as a view tree; a fun afternoon on the tile and progress nodes, nothing else needed |
| 256 | `01M2KJSVGDZ6XS22YJEGX7TV4R` | store: Organization object and Teams/Enterprise feature flags | not for pal |  | enterprise org flags |
| 275 | `01M2KJSVGG1RTCGGEQFXKW2028` | store: Private extension publishing (Teams) | not for pal |  | Teams |
| 276 | `01M2KJSVGG1RTCGGEQFYKH17JJ` | store: Private Extension Store (Teams, consumer side) | not for pal |  | Teams |
| 278 | `01M2KJSVGG1RTCGGEQG1KKC8JG` | store: ray.so Code Images | not for pal |  | ray.so code images |
| 279 | `01M2KJSVGG1RTCGGEQG51T1D99` | store: ray.so Icon Maker | not for pal |  | ray.so icon maker; the Nerd Font is the icon set |
| 285 | `01M2KJSVGH5B56PX6F70RWS9R5` | store: ray.so iOS icon packs | not for pal |  | iOS |
| 286 | `01M2KJSVGH5B56PX6F73DQYB47` | store: Organizations: create, manage, invite, join | not for pal |  | Teams organizations |
| 287 | `01M2KJSVGH5B56PX6F73RCFCTA` | store: Team roles and permissions (Manager, Billing, Member) | not for pal |  | Teams roles |
| 288 | `01M2KJSVGH5B56PX6F77AWJ1SY` | store: Shared snippets, quicklinks, AI commands, agents, styles | not for pal |  | Teams sharing |
| 289 | `01M2KJSVGH5B56PX6F77RH7922` | store: Team webhook commands | not for pal |  | Teams webhooks |
| 290 | `01M2KJSVGH5B56PX6F77RRADX5` | store: Enterprise: SAML SSO | not for pal |  | Enterprise SAML |
| 291 | `01M2KJSVGH5B56PX6F78NSC5NG` | store: Enterprise: SCIM provisioning | not for pal |  | Enterprise SCIM |
| 292 | `01M2KJSVGH5B56PX6F7BQV989K` | store: Enterprise: Domain Capture | not for pal |  | Enterprise domain capture |
| 293 | `01M2KJSVGH5B56PX6F7DR2HART` | store: Enterprise: MDM sign-in enforcement | not for pal |  | Enterprise MDM |
| 294 | `01M2KJSVGH5B56PX6F7H7WS0EC` | store: Enterprise: 2FA enforcement | not for pal |  | Enterprise 2FA |
| 295 | `01M2KJSVGH5B56PX6F7N0X8Y5M` | store: Enterprise: Cloud Sync control (kill switch) | not for pal |  | Enterprise sync control |
| 296 | `01M2KJSVGH5B56PX6F7P02BM7E` | store: Enterprise: Invitations control | not for pal |  | Enterprise invitations |
| 297 | `01M2KJSVGH5B56PX6F7PMGB5D0` | store: Enterprise: Clipboard History governance | not for pal |  | Enterprise clipboard governance |
| 298 | `01M2KJSVGH5B56PX6F7TE0TYVP` | store: Enterprise: IP allow-list | not for pal |  | Enterprise IP allow-list |
| 299 | `01M2KJSVGH5B56PX6F7XA324AN` | store: Enterprise: Extensions allow-list | not for pal |  | Enterprise extension allow-list |
| 304 | `01M2KJSVGNE88GDEPA32GJW0D1` | store: Enterprise: Security and compliance posture | not for pal |  | SOC 2 and trust portal |
| 305 | `01M2KJSVGNE88GDEPA36FVPZBR` | store: Plan matrix (Free, Pro, Pro+/Plus, Max, Teams, Enterprise) | not for pal |  | pricing |
| 307 | `01M2KJSVGNE88GDEPA3C339NFP` | store: Pro trial | not for pal |  | Pro trial |
| 308 | `01M2KJSVGNE88GDEPA3CWH0731` | store: Billing and subscription management | not for pal |  | billing |
| 309 | `01M2KJSVGNE88GDEPA3FTXG494` | store: Referral program (Share Raycast) | not for pal |  | referral |
| 310 | `01M2KJSVGNE88GDEPA3G10J911` | store: Affiliate program | not for pal |  | affiliate |
| 311 | `01M2KJSVGNE88GDEPA3K1S7T7F` | store: Student discount and Ambassadors program | not for pal |  | student and ambassador programs |
| 312 | `01M2KJSVGNE88GDEPA3NMM13QA` | store: Account: sign-in, profile, organizations, deletion | not for pal |  | accounts; pal has none by design |
| 313 | `01M2KJSVGP8GT79J81375FRW90` | platform: Browser Companion extension (install, browsers, transport) | done |  | `browser-tabs` reads tabs over CDP and AppleScript, Firefox from its session file; no companion extension: `extensions/browser-tabs` |
| 314 | `01M2KJSVGP8GT79J8139TDVSHQ` | platform: {browser-tab} placeholder, @browser and tab context for AI | partial | V:S E:S | Missing: `{browser-tab}` content. Tabs, focus, close, mute are in. Fit: 204 plus the placeholder in 46 |
| 315 | `01M2KJSVGP8GT79J813BM7J8XN` | platform: What v1 had that v2 lacked (and what came back) | not for pal |  | Raycast's own v1/v2 history; reference only |
| 383 | `01M2KJSVHDZ5QKD0W14WNRX4AE` | beyond: Wox rich-text floating notes with tables/images and MD/HTML export | not for pal |  | with 95 |
| 385 | `01M2KJSVHDZ5QKD0W151XC2W3A` | gap: Linux version | done |  | AppImage and deb, Hyprland rules, `pal toggle` for Wayland: `notes/linux.md` |
| 387 | `01M2KJSVHDZ5QKD0W1589E0KEY` | gap: Local-only / no-account mode without telemetry | done |  | no account, no telemetry, everything local: `docs/config.md` |
| 388 | `01M2KJSVHDZ5QKD0W15BWCKZXG` | gap: Open source, less AI, less bloat | done |  | MIT, `github.com/zcag/pal`, no AI surface |
| 389 | `01M2KJSVHDZ5QKD0W15CV2F1WA` | gap: Memory and CPU footprint | done |  | measured: app 153-169 MB RSS / 56-59 MB footprint, host 161 MB, idle 0.02% CPU: `notes/decisions.md` performance pass |
| 406 | `01M2KJSVHGH3B1WDCG3KXC6TEA` | gap: Raycast advantages every clone lacks (replicate first) | partial | V:M E:M | pal has the store, typed views, bar items, the calculator, hotkeys and aliases, the built-ins list (calendar, timers, windows), no cloud sync by design (the config file and dotfiles). Left: snippet expansion (106), placeholders (46), root inline answers (25), fallbacks (24), notes and focus (not for pal) |

## Top 25 to pull next

Ranked for a keyboard-driven local launcher, daily use before breadth. Each is one card; the cards it drags along are named in the tables above.

1. `01M2KJSVCYQ16H34C0QY3FRM7P` (25, V:L E:M) core: Inline results in root: math, colors, translation, URLs, paths: `12 usd to try`, `#ff6b35`, a url or a path answered under the hits without opening calc or colors first; a `match` regex per input palette
2. `01M2KJSVCYQ16H34C0QTV37PGQ` (24, V:L E:M) core: Fallback commands when nothing matches: rows when nothing matches: Google, Files, calc named in `general.fallbacks`, the query carried into the palette
3. `01M2KJSVDD76EFZZC8XY72KK9C` (93, V:L E:M) builtin: Search Menu Bar Items [Mac]: the front app's menus as a live palette over the AX tree pal already has, Enter presses the item
4. `01M2KJSVH7583GA05ANPGBDSVP` (341, V:M E:S) beyond: Direct vs indirect aliases and alias+space into a command's query: alias + space jumps into the palette with the rest typed, in one motion
5. `01M2KJSVCYQ16H34C0Q30EAKBN` (14, V:M E:S) core: Ranking with frecency and Reset Ranking: Reset Ranking on any row from cmd+K, instead of forgetting all history
6. `01M2KJSVEYVAKYFC8GTC2AJ1Y1` (184, V:M E:S) ext-api: Clipboard actions: Action.CopyToClipboard and Action.Paste: a concealed copy so 1Password and OTP secrets never land in clipboard history
7. `01M2KJSVCYQ16H34C0Q44SZF2P` (15, V:M E:M) core: Search history recall: Up at the top of the list brings the previous queries back
8. `01M2KJSVH4TCMWJRCGAB4V5JQD` (329, V:L E:M) beyond: dmenu mode (stdin in, selection out) with exit codes, multi-select: `pal pick`: lines in, the panel as the picker, the choice out; robot, skhd and fzf flows get pal's UI
9. `01M2KJSVCYQ16H34C0Q8BFQMBK` (17, V:M E:S) core: Suggestions, recents and the empty root list: the empty root shows what matters now: the next event (join on Enter) and recent files above the frecency list
10. `01M2KJSVCYQ16H34C0QE9RBKWA` (19, V:M E:S) core: Per-command global hotkey: item hotkeys and aliases set from the UI (cmd+K Record Hotkey, Set Alias) and listed in Settings, not config-only
11. `01M2KJSVHCQD0A9ASDXD5B954S` (370, V:M E:S) beyond: Value generators (GUID v7, hashes, base64, escapes, passwords): a `generate` palette: uuid, password, sha256, base64, urlencode, lorem; every row copies
12. `01M2KJSVDJ2SF0Q1A8MXXK52NF` (128, V:M E:S) builtin: Apple Shortcuts search and run [Mac]: Apple Shortcuts as a primary-tier palette over `shortcuts list` / `run`
13. `01M2KJSVHCQD0A9ASDY927QZJ1` (381, V:M E:S) beyond: Dev-tool launchers (IDE projects, docsets, SSH/PuTTY sessions): a projects palette: VS Code and JetBrains recents plus `~/proj`, open in editor / terminal / GitHub (the uncovered v1 `repos`)
14. `01M2KJSVDHS83Z1K2NT3VSTDBX` (119, V:M E:S) builtin: Window size and move commands (maximize, center, resize, restore): the missing window verbs: larger / smaller, move by step, maximize height / width, fullscreen, minimize; one row and one arm each on the existing frame path
15. `01M2KJSVH8JA3CZ8Q49AWCTV8Z` (352, V:M E:S) beyond: Clipboard-content launchers (act on URL/color/math in clipboard): rows from what is on the clipboard: open the url, convert the colour, reveal the path, calculate the number, without typing
16. `01M2KJSVH8JA3CZ8Q49QXBZ8D3` (358, V:M E:S) beyond: Dialog Jump / Quick Jump for Open and Save dialogs: a file or recent row typed into the front app's open/save panel via cmd+shift+g
17. `01M2KJSVCXJDEVAJVB8G2ZBZGP` (7, V:L E:M) core: Auto-updater with privileged daemon: updater install and relaunch behind the tray item that is disabled today; the check already runs daily
18. `01M2KJSVH7583GA05AN8NRYD67` (338, V:M E:M) beyond: LaunchBar staging multi-select: multi-select in lists (shift+arrows), `pick(ids[])` for kill several, close several tabs, trash several files
19. `01M2KJSVG8R9ZF565JR4GCVNH2` (197, V:M E:M) ext-api: getSelectedText and getSelectedFinderItems: `selection.text()` in core (AX with a cmd+C fallback): unlocks `{selection}`, define, translate, pass-selected-text quicklinks
20. `01M2KJSVDD76EFZZC8X8GD3WVH` (87, V:M E:S) builtin: File content search: a Contents filter running `mdfind` without `-name`, free on macOS
21. `01M2KJSVD8VFVAYT1FHF49QM8Z` (78, V:M E:M) builtin: Clipboard image text recognition (OCR): OCR on copied images (Vision in core) so screenshots are searchable in clipboard history
22. `01M2KJSVH8JA3CZ8Q49JQVC471` (355, V:S E:S) beyond: Large Type: cmd+L shows the row's text huge, for an OTP code or an IP across the room
23. `01M2KJSVHGH3B1WDCG2VF203PG` (396, V:M E:S) gap: Write preferences programmatically: `settings.set` for extensions through the same toml_edit round trip Settings uses; unblocks two palettes the decisions list as blocked
24. `01M2KJSVCWR3V17WXF3TY3J88H` (4, V:M E:S) core: Pop to Root Search timeout: pop to root after a timeout instead of on every show, so a reopen within seconds lands where you were
25. `01M2KJSVG9QKFDCYQ6Z39HMY89` (224, V:M E:S) ext-api: Script Commands: discovery and @raycast.* metadata header: single-file script commands with a `# @pal.title` header in a `scripts_dir`; the cheapest zero-code palette and Raycast-compatible headers

Close behind: 106 snippet expansion (M/L, only if espanso-style tools should go), 339 folder browsing in Files (M/S), 257 an in-panel store palette (M/M), 43 a theme file for the `theme` CLI pairing (M/M), 102 a screenshots palette (M/M), 3 compact mode (S/M), 74 the rest of the clipboard actions (M/M).
