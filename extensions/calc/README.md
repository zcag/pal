# Calculator

An input palette: what you type is answered on every keystroke. Three
parsers take the query in turn, dates and time zones first, then
currencies, then [mathjs](https://mathjs.org) for arithmetic and units. The
result is the row's title, the query as it was understood is the subtitle
(`12 USD to TRY`), and a second row carries another form when there is one:
the reverse conversion, a fraction, the hex and binary of an integer, the
ISO date. A query that does not parse lists nothing, so nothing flashes
while you type; with nothing typed the palette shows three hint rows.

At the root, a query that reads as sums, a conversion, a date or a time
(`2+2`, `12 usd to try`, `next friday`, `time in tokyo`, `1759000000`) is
answered inline under a Calculator section, with the same actions; a bare
number or a single word (`42`, `mon`, `friday`) never is, so app names
stay undisturbed. Anything else can be typed into the palette itself.

## What works

| kind | expression | result |
| --- | --- | --- |
| arithmetic | `2+2`, `2^10`, `5!`, `sqrt 2`, `10 mod 3`, `pi` | `4`, `1,024`, `120`, `1.414213562`, `1`, `3.141592654` |
| percent | `15% of 240`, `20% off 80`, `240 + 15%` | `36`, `64`, `276` |
| bases | `0xff`, `255 to hex`, `255 in binary` | `255` (with a `0b11111111` row), `0xff`, `0b11111111` |
| fractions | `1/3`, `0.375` | `0.3333333333` with a `1/3` row, `0.375` with a `3/8` row |
| units | `5 km to miles`, `72 f to c`, `12 gb to mb`, `5 ft 3 in to cm` | `3.10686 miles`, `22.2222 °C`, `12,000 MB`, `160.02 cm` |
| currency | `12 usd to try`, `€12 to $`, `1k usd`, `usd try` | the amount in the target currency, at the ECB's rate of the day |
| thousands | `210k / 12`, `2k + 500`, `1.5m usd`, `$1.5k` | `k` is thousands anywhere; `m` and `b` are millions and billions before a currency (a bare `5m` is metres) |
| home currency | `12 usd`, `$12` | to `home_currency`; the home currency itself goes to USD |
| dates | `today + 3 days`, `2026-10-14 + 45 days`, `in 90 days`, `25 dec 2026`, `25 aralık` | the date written out, `in 3 days` on the right, an ISO row |
| weekdays | `next friday`, `friday`, `last friday`, `next month`, `gelecek cuma` | the coming Friday (today on a Friday), the one after today, the one before |
| counts | `days until 25 dec`, `days since 2026-08-31`, `between 1 mar and 14 oct` | `100 days` (with `14 weeks 2 days · 3 months 9 days`), `16 days`, `227 days` |
| workdays | `workdays until 25 dec`, `business days between 2026-10-01 and 2026-11-01` | `72 workdays`, Monday to Friday from today up to the day; holidays are not known |
| weeks | `what week is it`, `week number`, `week of 25 dec`, `week 42` | `Week 38` with its Monday to Sunday, the ISO `2026-W38`, its Monday |
| day of a date | `what day is 2027-01-01` | `Friday`, the full date under it |
| time zones | `time in tokyo`, `tokyo time`, `3pm in tokyo`, `3pm istanbul to new york`, `now in pst`, `3pm tokyo` | `16:30`, with `6 h ahead` and the zone on the right, `tomorrow, 08:00` when the day there is not today's here; the full date, ISO and unix rows |
| unix time | `1759000000`, `@1759000000`, `unix time`, `2026-01-01 12:00 to unix` | the moment written out (with ISO and unix rows), the current unix time, `1767258000` |
| durations | `3h20m + 45m`, `2 hours + 30 minutes`, `90 min in hours`, `1h30m to minutes` | `4 h 5 min` (with `4:05`, minutes and hours rows), `2 h 30 min`, `1.5 hours`, `90 minutes` |

Times are 24 h whatever the locale. `3pm in tokyo` is your 3pm there;
`3pm tokyo` is Tokyo's 3pm here. A bare 10-digit number starting with 1
(2001 to 2033) is read as a unix time, `@` reads any; other numbers stay
numbers. Month and day names are English or Turkish (`aralık`, `aralik`,
`cuma`, `gelecek salı`). `45m + 10m` is metres: minutes need an hour
beside them or a spelled-out `min`.

Currencies are the 30 the ECB fixes (USD, EUR, GBP, TRY, JPY, CHF and the
rest); symbols (`$ € £ ₺ ¥ ₹`), names (`dollars`, `lira`, `quid`) and ISO
codes in any case are understood, `to`, `in`, `as` and `→` join the two
sides, `1k` and `2.5m` are thousands and millions. Zones are IANA ids,
`utc+3` offsets, the common abbreviations, 120-odd city and country
names (a few in Turkish: `londra`, `moskova`) and the city of every IANA
id (`caracas`); `ist` is Istanbul, India is `india`. All from the
runtime's time zone data, no network. Locale sets grouping and the
decimal separator both ways: under `tr` or `de`, `1,5 + 2` is `3,5`.

## Keyboard

Every result row has the same actions; a hint row has none.

| keys | action |
| --- | --- |
| `enter` | Copy result, as shown (`583.68 TRY`) |
| `cmd+enter` | Paste result into the app that was in front |
| `cmd+shift+c` | Copy without formatting: no grouping or symbols (`583.68`, `1000000`) |
| `cmd+shift+e` | Copy `expression = result` |
| `cmd+i` | The detail pane: for a conversion, the rate, its inverse, both names, the date and the source |

## Setup

Nothing to install. Rates come from the ECB reference rates through
`https://api.frankfurter.dev/v1/latest` (no key, one fix per working day),
fetched on the first currency query, never before. The first query without
a cache shows a `Fetching exchange rates…` row and the next keystroke has
the numbers; the set is kept in the extension's storage with its date and
refreshed in the background once it is a day old, so the calculator
answers offline with the rates it has, their date on the row.

Paste result is a synthesised Cmd+V, which macOS only delivers from a
process on the Accessibility list; without the permission pal shows the
system prompt once and a toast saying what to grant. Copying needs nothing.

Settings, `[extensions.calc]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `precision` | number, 2 to 20 | `10` | Significant digits in a result; integers are never rounded, units and rates show at most 6. |
| `locale` | text | `en` | How numbers and dates are written and how a typed number is read (`en`: `1,234.5`; `tr`, `de`: `1.234,5`). |
| `home_currency` | text | empty | What a bare amount (`12 usd`) converts to. Empty: the currency of the machine's time zone, then the locale's region, else USD. |
| `vars` | list | `[]` | Variables, one `name = value` per line (below). |

### Variables

```toml
[extensions.calc]
vars = [
  "salary_hour = 54 usd",
  "salary_day = salary_hour * 8",
  "salary_month = salary_hour * 2080 / 12",
  "rent = 42000 try",
  "height = 183 cm",
]
```

A query naming one is expanded before it is read, each name to its value
in parentheses, so a value is anything calc reads and may use other
variables. Currencies inside are converted into the first one's terms at
the day's rate, so `salary_month * 12` stays money (shown in the home
currency, or `... to eur`) and `rent / salary_month` is a plain ratio
(`0.2243`, with `22.43%` beside it). The subtitle is the query with each
name replaced by its value: `42,000 TRY / 9,360 USD`. At the root a query
naming a variable answers inline even without a digit. `X in <variable>`
says how many of it fit in X (`1500 usd in salary_hour`: `27.78
salary_hour`), and a word that is not a variable but the prefix of some
answers once per member, labelled with the rest of the name and the
largest count first: `1500 usd in salary` is `27.78 hour`, `3.472 day`,
`0.1603 month`; `5 km in lap` with `lap_pool = 50 m` and `lap_track =
400 m` is `100 pool`, `12.5 track`. An `in` naming neither converts as
before (`12 usd in eur`). Values are written
with a dot for decimals whatever the `locale`; a name is letters, digits
and underscores, and one spelled like a currency (`try`, `usd`) is ignored.

## What it does not do

- Crypto (`1 btc to usd`): frankfurter carries none, so it lists nothing.
- Currencies outside the ECB set (`12 usd to aed`): nothing, or a `No
  rate` row once the set is loaded.
- A trailing operator or an open parenthesis (`1 +`, `(1+2`): nothing
  until the expression closes.
- Variables between keystrokes: `x = 5` shows `5`, but a later `x` is
  undefined; variables live in the `vars` setting.
- `10x3` without spaces (`0x` would be hex); write `10 x 3` or `10*3`.
- Half-hour offsets as `utc+5:30`; use the zone name (`india`).
- Public holidays: `workdays` counts Monday to Friday only.

## Platforms

macOS and Linux, the same on both. Paste needs Accessibility on macOS and
`wtype` or `ydotool` on Linux; everything else is in-process.
