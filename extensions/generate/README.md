# Generate

Identifiers, secrets, random values, hashes, encodings, lorem ipsum, a
random colour, a QR code and a JWT taken apart. An input palette: the
rows come from what you type, nothing is indexed, and every value copies
on `enter` and pastes on `cmd+enter`. `cmd+r` (the shell's Refresh) lists
again with fresh values.

## What the query does

The empty query lists one fresh value of every generator:

| row | what |
| --- | --- |
| UUID v4 | `crypto.randomUUID()` |
| UUID v7 | RFC 9562: 48 bits of unix time, then random; sorts by time |
| ULID | 26 Crockford base32 characters, the first 10 the time; sorts by time |
| Nano ID | 21 characters from the url-safe 64-symbol alphabet |
| Password | `password_length` characters from `password_charset`, the strength on the right (bits of entropy on the usual scale: under 36 weak, 60 fair, 80 good, 128 strong) |
| Passphrase | `passphrase_words` words from a list of 2551 common five-letter words (about 11 bits each), joined by `passphrase_separator` |
| Random number | 1 to 100 |
| Random hex, Random base64 | 16 bytes from the CSPRNG |
| Lorem ipsum | one paragraph |
| Random colour | `#rrggbb`, the swatch as the icon; `cmd+o` opens it in the Colour Picker |

A mode word narrows the list and takes parameters:

| query | rows |
| --- | --- |
| `uuid`, `ulid`, `nanoid` | that generator |
| `password 32`, `password 16 alnum`, `pw 8 digits` | a password of that length and charset (`full`, `alnum`, `letters`, `digits`) |
| `passphrase 7` | seven words |
| `number 1-6`, `number 10`, `number 5 to 9`, `dice` | a number in that range (`dice` is 1 to 6) |
| `hex 32`, `bytes 32` | that many random bytes as hex, or as base64 |
| `lorem`, `lorem 25`, `lorem 3 paragraphs`, `lorem 3p` | ten words, a paragraph and three; or the count asked |
| `colour` | five random colours |

A transform mode works on the text after it, or, with nothing after it, on
the newest text on the clipboard (the subtitle says which):

| query | rows |
| --- | --- |
| `sha256 <text>`, `md5`, `sha1`, `sha512` | that digest |
| `hash <text>` | all four, `cmd+shift+c` copies them as lines |
| `base64 <text>`, `b64url <text>` | the encoding; when the text is itself base64 that decodes, the decoded text comes first |
| `url <text>` | URL-encoded, and decoded first when the text has escapes |
| `hex <text>` | the UTF-8 bytes as hex (decoded first when the text is hex); `hex 32` with a bare number is random bytes instead |
| `encode <text>` | base64, base64url, URL-encoded and hex, `cmd+shift+c` for all |
| `decode <text>` | whatever the text decodes as: base64, URL escapes, hex, or a JWT |
| `qr <text>` | the QR code: on the row as its icon, large in the detail pane (`cmd+i`); `enter` shows it full width, `cmd+c` copies the SVG |
| `jwt <token>` | the header, the payload with its expiry as a tag, a row per time claim (`exp`, `iat`, `nbf`) with the date and the relative time, and a reminder: **the signature is never verified** |

Anything else filters the generators by name and keyword (`uu`, `random`,
`time ordered`); when nothing matches, one row says how to pick a mode.

## Keyboard

| keys | action |
| --- | --- |
| `enter` | Copy the value; on the QR row, show the code large |
| `cmd+enter` | Paste the value into the app in front |
| `cmd+shift+c` | Copy the whole group: all hashes, all encodings, the JWT's header and payload |
| `cmd+o` | Open a colour in the Colour Picker |
| `cmd+c` | Copy the QR code as SVG |
| `cmd+i` | The detail pane: the whole value, its length and kind; the QR code drawn large |
| `cmd+r` | List again: every value regenerated |

## Setup

Nothing to install. Pasting needs Accessibility on macOS (`wtype` or
`ydotool` on Linux). The Colour Picker action needs the bundled Colors
extension.

Settings, `[extensions.generate]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `password_length` | 4 to 256 | `20` | Characters in a password; `password 32` overrides it for one listing. |
| `password_charset` | `full`, `alnum`, `letters`, `digits` | `full` | What a password is drawn from; a word after `password` overrides it. With `full` or `alnum`, one of each class is guaranteed. |
| `passphrase_words` | 2 to 20 | `5` | Words in a passphrase; `passphrase 7` overrides it. |
| `passphrase_separator` | text | `-` | Between the words. |

## How it is made

`gen.ts` is the generators, all on `crypto.getRandomValues` with rejection
sampling for uniform picks; the hashes are `node:crypto`. The passphrase
words are the five-letter words the bundled Wordle draws its answers from
(`words.txt`, 12dicts' 3esl and 6of12 lists, public domain; see
`extensions/wordle/build.ts`). `qr.ts` is a QR encoder in plain
TypeScript after Nayuki's qrcodegen: byte mode, versions 1 to 40, the four
levels (M by default, raised when the version has room), the eight masks
scored by the standard's penalty rules; its matrices were checked against
segno and decoded by Apple's Vision framework.

## What it does not do

- Verify a JWT: there is no key, and the palette says so on its own row.
- Hash a file, or hash with a key (HMAC): text only.
- Numeric or alphanumeric QR modes, Kanji, or a logo in the middle: byte
  mode only, which any reader takes.
- Regenerate one row: `cmd+r` lists everything again.

## Platforms

macOS and Linux.
