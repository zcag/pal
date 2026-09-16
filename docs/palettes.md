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

| palette | id | kind | what `Enter` does |
| --- | --- | --- | --- |
| Applications | `apps` | indexed | launches the app |
| Blackjack | `blackjack` | view | deals, hits, or the next hand |
| Bookmarks | `bookmarks` | indexed | opens the link |
| Calculator | `calc` | input | copies the result |
| Clipboard History | `clipboard-history` | live, input | pastes into the app in front |
| Emoji | `emoji` | indexed, grid | copies the emoji |
| Files | `files` | input | opens the file |
| Processes | `processes` | live, input | kills the process (after a confirm) |
| Quicklinks | `quicklinks` | indexed | opens the link, or asks for its `{query}` first |
| Snippets | `snippets` | indexed | pastes the text into the app in front |
| SSH Hosts | `ssh` | indexed | opens a terminal running `ssh` |
| System | `system` | live | runs the command |
| Windows | `windows` | live | focuses the window |
| Window Management | `window-management` | indexed | moves and resizes the focused window |
| Arrange Window | `window-management-arrange` | input | picks a window, then a layout for it |
| Scripts and data files | `scripts-<name>` | as configured | as configured |

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

Actions: one, Open.

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
line's bar). Insurance is offered on an ace only with `insurance = true`,
costs half the bet and pays 2:1.

Cards are drawn by the extension as SVG (rank and suit indices, pips laid
out as on a real deck) so nothing is loaded from disk; the view vocabulary
they ride on is in [Extensions](extensions.md).

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
and `keywords` (a list of strings). Same file as v1's bookmarks palette.

```json
[
  { "name": "Home Assistant", "url": "http://ha.lan", "keywords": ["ha", "home"] },
  { "name": "GitHub", "url": "https://github.com", "icon": "🐙" }
]
```

Actions:

| action | shortcut | what |
| --- | --- | --- |
| Open in browser | `Enter` | opens the url |
| Copy link | `⌘C` | copies the url |

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
| Pin / Unpin | `⌘P` | pinned entries sort first and never expire |
| Delete | `⌘D` | removes the entry; asks first |
| Clear history | `⌘⇧D` | removes every entry, pinned ones included; asks first |

`primary_action = "copy"` swaps the first two, so `Enter` copies and
`⌘Enter` pastes.

**Paste needs the Accessibility permission on macOS**: the paste is a
synthesised Cmd+V, which the system only delivers from a process on the
Accessibility list. Without it pal shows the system prompt once per run
and a toast, "Paste needs Accessibility. Grant pal in System Settings >
Privacy & Security > Accessibility", instead of half-doing it. On Linux the
paste is Ctrl+V through `wtype`, else `ydotool` (which needs `ydotoold`
running); with neither, paste fails and the toast says so.

What is never recorded: anything a password manager marks as concealed or
transient (the `org.nspasteboard` convention), copies over 10 MB, and
copies made while an app in `exclude_apps` is in front. Copying something
already in history bumps it to the top instead of adding a duplicate.

Retention runs after every copy: unpinned entries older than
`max_age_days` are deleted, then the unpinned tail past `max_entries`.
Pinned entries never expire. A search lists at most 200 rows of what is
left, newest first after the pinned ones; type more to narrow it.

Settings, `[extensions.clipboard]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `exclude_apps` | list | `["com.apple.keychainaccess", "com.apple.Passwords"]` | Bundle ids (`com.1password.1password`) or readable names (`Slack`). The recorder skips copies made while one of them is in front, and entries already recorded from one are not listed. The default is Keychain Access and Passwords; `[]` excludes nothing. |
| `max_entries` | number, 1 to 100000 | `1000` | How many unpinned entries history keeps. |
| `max_age_days` | number, 0 to 3650 | `30` | Unpinned entries older than this are deleted. `0` is no age limit: entries stay until the count limit. |
| `primary_action` | `paste`, `copy` | `"paste"` | What `Enter` does on an entry. |

The recorder reads the three retention keys once, when pal starts, so a
change to them takes effect at the next launch (`primary_action` applies
live). On Linux the source app of a copy is not known (neither X11 nor the
Wayland data-control protocol says who owns the selection), so
`exclude_apps` has no effect there.

## Emoji (`emoji`)

A grid of every emoji in the bundled list, searched by name and keyword.
The tile is the glyph; the name is the shortcode with spaces.

Actions:

| action | shortcut | what |
| --- | --- | --- |
| Copy emoji | `Enter` | copies the glyph |
| Copy shortcode | `⌘⇧C` | copies `:shortcode:` |

Settings, per palette, `[palettes.emoji.settings]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `columns` | number, 4 to 16 | `10` | Tiles per row in the grid. Read once when the extension loads: after a change, Settings > Restart extension host. |

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

Settings, `[extensions.processes]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `include_system` | bool | `false` | List system processes too: pids below 100, and kernel threads (children of `kthreadd`) on Linux. |

## Quicklinks (`quicklinks`)

Your own links, kept in the extension's storage and edited in the panel.
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

Anything else in braces is left as it is, so a snippet of code keeps its
braces. A snippet with placeholders carries a "dynamic" accessory.

The root row **Create Snippet** opens a form (name, keyword, text);
**Edit** (⌘E) opens it filled in; a keyword with a space in it is refused
(one word, so typing it finds the row whole). **Delete** (⌃X) asks first.

| action | shortcut | what |
| --- | --- | --- |
| Paste | `Enter` | hides, then pastes the filled text into the app in front |
| Copy | `⌘C` | copies the filled text |
| Edit | `⌘E` | the form, filled in |
| Delete | `⌃X` | removes it, after a confirm |

No settings. The snippets live in `<data dir>/pal/storage/snippets.json`,
shared by every config profile. Expansion by typing the keyword in other
apps (Raycast's snippet expansion) is not part of this: pal pastes on
Enter.

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

Settings, `[extensions.ssh]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `config` | path | `~/.ssh/config` | The config to read. `~` is expanded; `known_hosts` is looked for next to it. |
| `include_known_hosts` | bool | `false` | List the names in `known_hosts` too, in a second section. |
| `terminal` | `auto`, `kitty`, `Terminal`, `iTerm2`, `Ghostty`, `Alacritty` | `auto` | macOS only: which terminal Connect opens. |

## Files (`files`)

An input palette over the operating system's own file index: what you type
is a name search on every keystroke, never a walk pal indexes itself. The
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

The detail pane (lazy, asked when the cursor rests on a row) shows the
path, size, modified time and kind; for a text file under 64 KB the first
40 lines in a code block. No image preview: the app's `icon://` scheme
serves app icons, favicons and clipboard images only.

Actions:

| action | shortcut | what |
| --- | --- | --- |
| Open | `Enter` | the system opener |
| Reveal in Finder / Show in file manager | `⌘Enter` | `open -R` on macOS, `xdg-open` on the parent folder on Linux |
| Open with… | `⌘O` | a level listing the apps registered for the file (below) |
| Copy path | `⌘C` | copies the absolute path |
| Copy file | `⌘⇧C` | the file itself onto the clipboard: a paste in Finder or a file manager copies it, a paste in a text field gets its path |
| Move to Trash | `⌘D` | asks first; Finder's delete on macOS, `gio trash` on Linux; the palette stays open with a toast |

**Open with…** drills into a level of the applications the OS registers
for the file, each with its own icon: the default (what `Enter` would use)
first with a `Default` tag, the rest by name; typing narrows them by name
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

Settings, `[extensions.files]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `folders` | list of paths | `["~"]` | Where to search. `~` is expanded. |
| `limit` | number, 1 to 500 | `50` | At most this many rows per query. |
| `show_hidden` | bool | `false` | List files and folders whose name starts with a dot (below the configured folder; `~/.config` as a folder is fine either way). |
| `exclude` | list of names | `["node_modules", ".cache", "Library/Caches", "target"]` | Folders skipped below the search folders, by name or a short path. |

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

Settings, `[extensions.windows]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `include_minimized` | bool | `true` | List minimised windows too (focusing one restores it). |

## Window Management (`window-management`)

Move and resize windows from the keyboard, Raycast's set: one row per
layout, `Enter` applies it to the window you were in. pal hides its panel
first, so the window with focus is the one behind the panel, not pal; the
HUD then names the layout, or says why it did not happen ("Restore: nothing
to restore", "Next Display: only one display").

| layout | id | what |
| --- | --- | --- |
| Left Half, Right Half, Top Half, Bottom Half | `left_half` `right_half` `top_half` `bottom_half` | half of the screen |
| Left Third, Center Third, Right Third | `left_third` `center_third` `right_third` | a third |
| Left Two Thirds, Right Two Thirds | `left_two_thirds` `right_two_thirds` | two thirds |
| Top Left, Top Right, Bottom Left, Bottom Right Quarter | `top_left_quarter` `top_right_quarter` `bottom_left_quarter` `bottom_right_quarter` | a quarter |
| Maximize | `maximize` | the whole screen |
| Almost Maximize | `almost_maximize` | `almost_maximize_percent` of the screen, centred |
| Center | `center` | the same size, centred |
| Reasonable Size | `reasonable_size` | `reasonable_size_percent` of the screen, centred |
| Next Display, Previous Display | `next_display` `previous_display` | the same place and proportions on the other display; refused with one |
| Restore | `restore` | back to where the window was before pal moved it |

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
[Config](config.md#palettesid)):

```toml
[palettes.window-management.item_hotkeys]
left_half = "ctrl+alt+left"
right_half = "ctrl+alt+right"
maximize = "ctrl+alt+enter"
restore = "ctrl+alt+backspace"
```

- **macOS**: needs the Accessibility permission (the frame is set through
  the window's `AXPosition` and `AXSize`); without it `Enter` shows the same
  toast as paste and asks once. The displays are `NSScreen`'s frames with
  `visibleFrame` for the usable part, so an auto-hidden menu bar or Dock
  gives the whole screen. Apps keep their minimum size and may round.
- **Linux**: Hyprland (`movewindowpixel exact` / `resizewindowpixel exact`;
  a tiled window is floated first, since an exact frame means nothing
  inside the tiling layout; the display is `monitors -j` with `reserved`
  taken out), Sway (`floating enable`, `move absolute position`, `resize
  set`; the workspace rect is the usable part), or X11 (`wmctrl -i -r
  <id> -e`; `xrandr --listmonitors` for the displays, `wmctrl -d`'s work
  area for the usable part, `xprop -root _NET_ACTIVE_WINDOW` for the focused
  window). Sway and X11 are written to the tools' documented shapes and
  unit-tested on fixtures, not run against a live session yet.

Settings, `[extensions.window-management]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `gap` | number (px) | `0` | Pixels between a window and the screen edge, and between two windows of a split. |
| `almost_maximize_percent` | number (%) | `90` | How much of the screen Almost Maximize fills. |
| `reasonable_size_percent` | number (%) | `60` | How much of the screen Reasonable Size fills. |

## Scripts and data files (`scripts`)

The zero-code tier: every `[palette.<name>]` table of a pal v1 config
becomes a palette, backed by a shell script speaking JSON lines or by a
json / jsonl / toml data file. Each such palette has the id
`scripts-<name>`. Its settings and the whole format are in
[Scripts and data files](scripts.md).

## Home Assistant (`home-assistant-entities`, `home-assistant-services`, `home-assistant-areas`)

Home Assistant over its REST API (`/api/states`, `/api/services`, one
`/api/template` render for areas), with a long-lived access token.
Replaces the v1 `ha-states` and `ha-services` script palettes.

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
(`rgb_color`, else warm white). The filter scopes it: All entities (the
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

Every row also has Copy entity id (`⌘C`), Show attributes (`⌘I`: a level
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

Settings, `[extensions.otp]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `hours` | number | `24` | How far back to scan. |
| `senders` | list | `[]` | Senders never listed, as Messages shows them (`AKBANK`, a number, an email); case does not matter. |
| `db` | path | `~/Library/Messages/chat.db` | The database to read. |
| `contacts` | path | `` | An `AddressBook-v22.abcddb` for names; empty reads every source under `~/Library/Application Support/AddressBook`. |

## 1Password (`onepassword`)

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

## Browser Tabs (`browser-tabs`)

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

## GitHub (`github-prs`, `github-issues`, and three more)

One extension, five palettes, one sign-in. It replaces the v1 script
palettes `repos` and `gh-reviews` for the general case; the personal
sketchybar-shaped `prs` and `issues` scripts stay in the scripts tier.

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
`merged_days`; filters All, Mine, Review requested, Merged; the row is
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
| Copy branch name | `⌘⇧B` | |
| Open checks | `⌘⇧K` | |
| Open files changed | `⌘⇧F` | |
| Copy reference | | `owner/repo#n` |
| Mark ready for review | `⌘⇧R` | a draft |
| Merge | `⌘⇧M` | open, not a draft, GitHub says mergeable; asks first; `merge_method` |

**Issues.** Assigned to you, mentioning you, opened by you (open ones);
filters All, Assigned, Mentioned, Created; an issue in two lists is
listed once, in the first. Rows carry the first two labels, the comment
count and the updated date; the pane the body, the latest comments and
the milestone. Actions: Open, Copy URL (`⌘C`), Copy reference, Close
(`⌘⇧X`, asks first). **Create Issue** at the top is a form: the
repository (a select of the repositories with recent activity in the
lists, then yours by push date), title, body; the submit opens the new
issue.

**Repositories.** Yours (owner or collaborator, by push date), your
`default_org`'s recently pushed, and your starred ones, in that order and
sectioned so; filters All, Mine, Starred, Organisation. Rows: name,
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

**Linux, systemd.** Filters: User (`systemctl --user`), System, Failed
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

## Makefile targets (`make`)

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

- **macOS**: `networksetup` (the interface, the radio, the preferred
  list, join, forget), `scutil` and `ipconfig getsummary` for the current
  link, `security find-generic-password -wa <ssid>` for a password (the
  keychain prompts; that dialog is yours to answer), `system_profiler
  SPAirPortDataType -json` for a scan. That scan takes several seconds, so
  Available shows the last one (kept for a minute) and the **Scan for
  Networks** row runs a fresh one. macOS 15 and later withhold every
  network name from a process without Location Services (`<redacted>` in
  `ipconfig`, `scutil` and `system_profiler` alike; `wdutil info` would
  say, but needs sudo): the current row then reads "Connected network"
  with its IP and channel, and the Scan row counts the nearby networks
  whose names are hidden instead of listing them.
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

No settings.

## Now Playing (`media`)

One row per running player over the core's media capability: the track
as the title, artist and album as the subtitle, the artwork (else the
app's icon) and a `playing` / `paused` / `stopped` tag, playing ones
first. A player with nothing loaded reads "Nothing playing" with the
player's name. Live: read again on every show. With no player running the
one row says so; on macOS without `nowplaying-cli` it says how to see
players beyond Spotify and Music.

- **macOS**: Spotify and Music through AppleScript, only while the app is
  running (the check is `NSRunningApplication`, so pal never launches one
  to ask); Spotify gives the artwork url and the track url. `nowplaying-cli`
  on PATH (`brew install nowplaying-cli`) adds the system-wide Now Playing
  as one more row for any other player.
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
(hidden while nothing plays) with Pause, Next, Previous, Copy Track and
Open in its popover; the extension polls the players every 5 s while one
plays and pushes a track change itself.

No settings.

## Unicode characters (`unicode`)

A grid of 1795 characters one pastes rather than types, from
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

## Colors (`colors`, `convert`)

Two palettes. **Colors** is a grid of 700 named colours as swatch tiles
(the tile is an SVG of the colour, so it fills the box): the 148 CSS
names, pal's own tokens from `app/src/ui/tokens.css` (the light and the
dark value of each, `accent (light)`, `tag blue (dark)`), Tailwind 3.4's
palette (`slate 500`) and Material's 2014 palette (`red a200`); one
section per set. The search matches the name, the hex (`#64748b`), the
token spelling (`slate-500`) and the set (`tailwind`). The last twelve
picked lead in a **Recent** section, as in Unicode characters.

| action | shortcut | what |
| --- | --- | --- |
| Copy hex | `Enter` | `#64748b` |
| Copy rgb | `⌘Enter` | `rgb(100, 116, 139)` |
| Copy hsl | `⌘⇧H` | `hsl(215, 16%, 47%)` |
| Copy name | `⌘⇧N` | the token: `slate-500`, `aliceblue`, `tag-blue` |

**Convert colour** is an input palette: type a colour in any notation and
the rows are its conversions, each with a swatch, `Enter` copying the
row. It reads hex in every length with or without the hash (`#f80`,
`ff880080`), `rgb()`/`rgba()` in the comma and the space syntax with
percentages and alpha (`rgb(255 136 0 / 50%)`), a bare triple (`255 136
0`), `hsl()`/`hsla()` with hue units (`deg`, `turn`, `grad`, `rad`),
`hwb()`, `oklch()` and the CSS names. The rows: hex, rgb, hsl, hwb, oklch,
the CSS name (or the nearest one, tagged `close`, `near` or `far` by its
OKLab distance), and the contrast ratio on white and on black, each tagged
with what it passes for normal text (`AAA` at 7, `AA` at 4.5, `AA large`
at 3, else `fail`, WCAG 2). Something that is not a colour gives one inert
row saying so.

The detail pane, for a grid tile or a conversion row, shows a wide swatch,
every notation, the exact or nearest CSS name, both contrast ratios with
their levels, and the complementary colour with three lighter and three
darker steps as coloured tags. The maths is `extensions/colors/color.ts`
(sRGB, HSL, HWB, OKLab/OKLCH by Ottosson's matrices, WCAG luminance),
unit-tested on its own.

No pick-from-screen: the core has no screen-sampling capability, and an
extension cannot read pixels, so the action is not offered. The palette's
rows are generated by `bun run extensions/colors/build.ts` (the CSS table
from `color.ts`, the tokens read from `tokens.css`, Tailwind and Material
fetched from unpkg) into `data.json` (48 KB), committed.

Settings, per palette, `[palettes.colors.settings]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `columns` | number, 4 to 16 | `8` | Tiles per row in the grid. Read once when the extension loads. |

## Icons (`icons`, `freedesktop`)

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
| Copy name | | `nf-md-account_circle` |
| Copy CSS class | | `nf nf-md-account_circle` |

The detail pane names the set and the Nerd Fonts version, the code point,
the CSS class and the `\u{f0009}` escape; it does not draw the glyph large,
since the pane's text is the UI font and only the icon box uses the
bundled symbols font.

**Freedesktop icon names** is a second grid: the 114 freedesktop names the
SDK's `xdg()` maps to a glyph (`sdk/src/icons.ts`, what a script's
`icon_xdg` may say), each drawn with its glyph and its Nerd Font name as
the subtitle. `Enter` copies the name; the glyph and the code point are
the other actions. v1's larger freedesktop list is not carried over: pal
draws only the names in that table, so listing more would list names that
render as nothing.

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
associated), and pal has no such grant, so the Wi-Fi row is labelled by
kind (`en0 · Wi-Fi`) and the detail pane says the SSID is hidden. Grant
pal Location access in System Settings and the name appears.

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
one started here are the same thing. Live: listed again on every show.

One row per timer, most urgent first (landed, then running soonest first,
then paused): the name, what is left and when it lands (or "Paused at
12:34", "Landed 0:42 ago"), a state tag. The last row is **New timer**, a
form: a duration (`25m`, `90s`, `1h30m`, `2:30`, a bare number is minutes;
the CLI parses it and its complaint comes back under the field), an
optional name (the duration otherwise; a name already taken restarts that
timer), and a checkbox to ring the phone out loud when it lands (`--ring`).

Actions, by state:

| row | `Enter` | `⌘+` | `⌘⌫` |
| --- | --- | --- | --- |
| running | Pause | Add 5 minutes | Stop |
| paused | Resume | Add 5 minutes | Stop |
| landed | Dismiss (the CLI's `done`) | Add 5 minutes (restarts it) | Stop |

Every pick runs the CLI (`timer pause <id>`, `resume`, `add 5m <id>`,
`stop <id>`, `done`) with the state directory as `TIMER_DIR` and lists
again; a refusal is a toast with the CLI's words.

**The bar item** (`timer/timer`, [Extensions](extensions.md#bar-items-glanceable-state-on-the-bar)):
the soonest timer's remaining time as the title with a fill for how far
along it is, blue, then amber past two thirds, red past nine tenths,
muted while paused; a landed timer is the alarm (its name, or "Done" for
an unnamed one, in red) until the CLI's badge ttl (5 minutes) or a
Dismiss removes it. Hidden with no timer at all. A click opens this
palette. The second-level countdown is pushed by the extension itself
(a watch on the state directory plus a 1 Hz tick while a timer runs);
the core asks every 10 s and on wake besides.

Settings, `[extensions.timer]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `command` | path | `timer` | The CLI, a name on PATH or a path. |
| `dir` | path | `~/.local/share/timer` | Its state directory (`TIMER_DIR`); made if missing. `~` is expanded. |

## Raycast parity pass on the bundled palettes (2026-09-16)

What the built-in palettes gained to match what a Raycast user reaches
for, per palette. Each item below adds to, or corrects, the palette's own
section above.

### Applications

- A running app carries a green `Running` tag (as of the last listing:
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
- Fixed: two roots with an app of the same name both listed (a `Set.add`
  was read as a boolean); the first root wins now, as intended.

### Bookmarks

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

### Emoji

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

### Clipboard History

- Pinned entries sit in a **Pinned** section at the top; the rest follow
  without a header.
- A filter dropdown by kind: All, Text, Images, Files (the core's kinds),
  **Links** (text that is one url) and **Colors** (text that is one
  `#hex` or `rgb()`/`rgba()` colour).
- A colour entry's icon is the colour itself (a tinted dot); an image row
  shows its size next to its dimensions.
- Actions added: **Open link** (`⌘O`) on a url, **Paste as plain text**
  (`⌘⇧V`) on text (the entry's text pasted as text), **Copy image file**
  (`⌘⇧C`) on an image (the PNG the core keeps, as a file), **Delete all
  unpinned** (asks first; every unpinned entry deleted one by one, since
  the core's only bulk operation is Clear).

### Windows

- Rows are grouped by app (a section per app, in the order the front
  window of each gives); the app name is a keyword as well as the
  subtitle.
- Actions added: **Hide app** (`⌘H`, macOS: System Events hides the
  window's process), and on an app with more than one window **Minimize
  all of this app** (`⌘⇧M`) and **Close all of this app** (`⌘⇧W`, asks
  first).

### System

- **Empty Trash** shows what is in the Trash on the right (`3 items`,
  `empty`); `~/.Trash` itself is readable only with Full Disk Access, and
  without it the row simply has no count. Linux reads
  `~/.local/share/Trash/files`.
- **Toggle Dark Mode** carries the current appearance as a tag (`dark`
  violet, `light` amber), from `defaults read -g AppleInterfaceStyle` on
  macOS and GNOME's `color-scheme` on Linux.
- Do Not Disturb was already hidden unless available; nothing changed.
  No "Restart pal" row: the tray has it.

### Files

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

### SSH Hosts

- The section is the file a host came from, relative to the config's
  directory (`.ssh/config`, `.ssh/conf.d/work.conf`); known hosts stay a
  last `Known hosts` section.
- `ProxyJump` is read: the row carries a `via <jump>` tag and the jump as
  a keyword, and **Copy ssh -J command** (`⌘⇧J`) copies
  `ssh -J <jump> <host>` (the plain command already goes through the
  config's ProxyJump; the `-J` form is for a machine without it).
- **Ping** (`⌘P`): one echo to the HostName (else the name), the round
  trip as a toast (`marko.lan: 3 ms`), or why it did not answer.

### Processes

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
- The CPU tag's colour for 10..50% is the token palette's `amber` (it
  named `orange`, which is not a token).

### Quicklinks and Snippets

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
- Snippets: `{selection}` (Raycast's spelling for the selected text,
  which pal cannot read) is filled from the clipboard like `{clipboard}`,
  the documented fallback. `{cursor}` is **not supported**: pal pastes
  the text whole and cannot place the caret, so it is left in the text as
  typed.

### Window Management, Blackjack

Reviewed, nothing changed: no bug found.
