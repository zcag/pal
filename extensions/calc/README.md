# Calculator

An input palette: what you type is answered on every keystroke. Three
parsers take the query in turn, dates and time zones first, then
currencies, then [mathjs](https://mathjs.org) for arithmetic and units. The
result is the row's title, the query as it was understood is the subtitle
(`12 USD to TRY`), and a second row carries another form when there is one:
the reverse conversion, a fraction, the hex and binary of an integer, the
ISO date. A query that does not parse lists nothing, so nothing flashes
while you type; with nothing typed the palette shows three hint rows.

The calculator is an input palette, so its rows are never at the root:
open it first (its row, an alias, or a hotkey), then type.

## What works

| kind | expression | result |
| --- | --- | --- |
| arithmetic | `2+2`, `2^10`, `5!`, `sqrt 2`, `10 mod 3`, `pi` | `4`, `1,024`, `120`, `1.414213562`, `1`, `3.141592654` |
| percent | `15% of 240`, `20% off 80`, `240 + 15%` | `36`, `64`, `276` |
| bases | `0xff`, `255 to hex`, `255 in binary` | `255` (with a `0b11111111` row), `0xff`, `0b11111111` |
| fractions | `1/3`, `0.375` | `0.3333333333` with a `1/3` row, `0.375` with a `3/8` row |
| units | `5 km to miles`, `72 f to c`, `12 gb to mb`, `5 ft 3 in to cm` | `3.10686 miles`, `22.2222 °C`, `12,000 MB`, `160.02 cm` |
| currency | `12 usd to try`, `€12 to $`, `1k usd`, `usd try` | the amount in the target currency, at the ECB's rate of the day |
| home currency | `12 usd`, `$12` | to `home_currency`; the home currency itself goes to USD |
| dates | `today + 3 days`, `3 weeks from now`, `25 dec 2026` | the date written out, `in 3 days` on the right, an ISO row |
| counts | `days until 2026-12-25`, `weeks between 2025-06-15 and 2026-01-01` | `100 days` (with `14 weeks 2 days · 3 months 9 days`), `28.6 weeks` |
| time zones | `10:00 utc to tokyo`, `5pm ldn in sf`, `time in tokyo` | the time there, the zone on the right, `next day` when it crosses midnight |
| unix time | `unix 1700000000`, `unix`, `2026-01-01 12:00 to unix` | the moment written out, the current unix time, `1767268800` |

Currencies are the 30 the ECB fixes (USD, EUR, GBP, TRY, JPY, CHF and the
rest); symbols (`$ € £ ₺ ¥ ₹`), names (`dollars`, `lira`, `quid`) and ISO
codes in any case are understood, `to`, `in`, `as` and `→` join the two
sides, `1k` and `2.5m` are thousands and millions. Zones are IANA ids,
`utc+3` offsets, the common abbreviations and 120-odd city and country
names; `ist` is Istanbul, India is `india`. Locale sets grouping and the
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
naming a variable answers inline even without a digit. Values are written
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

## Platforms

macOS and Linux, the same on both. Paste needs Accessibility on macOS and
`wtype` or `ydotool` on Linux; everything else is in-process.
