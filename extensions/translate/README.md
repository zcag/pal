# Translate

Translate what you type, the text selected in the app in front, or the
clipboard, as you type. An input palette: the rows come from the text and
nothing is indexed. The first row is the translation; `enter` copies it,
`cmd+enter` pastes it into the app in front, `cmd+shift+s` reads it aloud.

## What the query does

| query | what |
| --- | --- |
| `hello world` | translated to the `to` setting (the system language when unset), the source detected |
| `tr: hello`, `>de hello`, `german: hello` | translated to that language, once |
| `en>tr merhaba`, `turkish>english merhaba` | both ends named, once |
| nothing | the text selected in the app in front, else the newest clipboard text; `tr:` or `>de` alone does the same to that language |

A word before `:` or `>` only counts when it is a language code or name
(`todo: buy milk` is translated whole). `>de` is written without a space:
`> ` with a space is the Shell palette's prefix at the root. A text that
is already in the target goes the other way: to the `from` setting when
it names a language, else to English, else to the system language. Set
`from` and `to` to your pair (`tr` and `en`) and text in either lands in
the other. When nothing names another language (an English text on an
English system with nothing set) the row says so and how to fix it.

At the root a prefixed query answers inline under a Translate section
(`tr: hello` at the root is the translation with its actions); plain text
never wakes the palette there.

## The rows

| row | what |
| --- | --- |
| the translation | first; the pair and the backend as the subtitle, both texts in the detail pane (`cmd+i`) with the detector's confidence |
| in Latin letters | the translation romanised, when its script is not Latin (Google gives it) |
| `<language> detected` | what the detector said, and how sure it was |
| alternatives | other renderings Google offers; for a text of several sentences, the segments' second choices joined |
| the source in Latin letters | when the source's script is not Latin |
| dictionary entries | for a word or a short phrase: the word, its part of speech, the back-translations |
| `Swap: Turkish → English` | translates the result back the other way (a push with the pair reversed) |

Every text row copies on `enter`, pastes on `cmd+enter`, speaks on
`cmd+shift+s` (in the row's own language: a romanisation of Japanese is
spoken as Japanese), copies the source on `cmd+shift+c`, opens the pair
and the text in the Google Translate web app on `cmd+o`.

Typing is debounced 350 ms so a request goes out once the keys settle;
the same text again is answered from a small in-memory cache.

## Translation History

Everything copied, pasted or spoken lands in the Translation History
palette (`translate-history`), newest first, once each, the last hundred
(`storage`); looking at a translation does not record it, so half-typed
words never do. `enter` copies the translation again, `cmd+enter` pastes,
`cmd+shift+s` speaks, `cmd+t` translates the entry afresh (the detected
source pinned), `cmd+shift+c` copies the source, `cmd+d` removes the
entry; the last row clears the history (asks first). The palette is live:
its rows are at the root, so a past translation is found by either text.

## Keyboard

| keys | action |
| --- | --- |
| `enter` | Copy the translation; on Swap, translate it back |
| `cmd+enter` | Paste the translation into the app in front |
| `cmd+shift+s` | Speak the row aloud |
| `cmd+shift+c` | Copy the source text |
| `cmd+o` | Open in Google Translate |
| `cmd+i` | The detail pane: both texts, the pair, the backend, the confidence |
| `cmd+t` | History: translate the entry again |
| `cmd+d` | History: remove the entry |

## Backends

- **Google Translate** (the default, no key): the endpoint the web app
  and Chrome's dictionary use, `translate.googleapis.com/translate_a/single`
  with `client=dict-chrome-ex`. It is **unofficial**: Google can change it
  or refuse a network it takes for a bot without notice (the `gtx` client
  most scripts use was refused with a "Sorry..." page from one home
  network on 2026-09-17 while `dict-chrome-ex` answered), and a refusal is
  one row naming the fix. It answers the translation, the detected
  language, alternatives, romanisation and dictionary entries in one
  reply. 5000 characters per request; longer text is cut and the row
  says so.
- **DeepL** (`backend = "deepl"`, `api_key`): the documented v2 API on the
  free host (`api-free.deepl.com`; a free key ends in `:fx`, 500k
  characters a month). The translation and the detected source only, no
  alternatives. A rejected key, a used-up quota and a rate limit each get
  their own row.

Apple's on-device Translation has no scriptable interface, so there is
no third backend.

## Speech

`say` on macOS, with the first installed voice of the row's language
(`say -v ?`; Yelda for Turkish, Kyoko for Japanese) and the default voice
when none is; `spd-say`, else `espeak-ng`, else `espeak` on Linux; a row
says so when nothing can speak. `speak = true` also reads the translation
aloud when `enter` copies it.

## Setup

Nothing to install for Google. Pasting needs Accessibility on macOS
(`wtype` or `ydotool` on Linux); reading the selection does too, and
falls back to the clipboard without it.

Settings, `[extensions.translate]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `from` | code or name | `auto` | The source language; `auto` detects it. A prefix overrides it once. |
| `to` | code or name | empty (the system language) | The target. Text already in it goes the other way. A prefix overrides it once. |
| `backend` | `google`, `deepl` | `google` | Which translator. |
| `api_key` | secret | empty | The DeepL key; read only with `backend = "deepl"`. |
| `speak` | boolean | `false` | Also read the translation aloud when `enter` copies it. |

## What it does not do

- Translate a whole document or a file: text of up to 5000 characters.
- Offline translation: both backends are on the network.
- Guarantee Google keeps answering: the endpoint is unofficial. DeepL with
  a key is the supported path.

## Platforms

macOS and Linux.
