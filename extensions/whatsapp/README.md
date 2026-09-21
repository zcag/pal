# WhatsApp

Your WhatsApp chats in the panel, through a self-hosted [OpenWA](https://github.com/openwa)
gateway: the chats by recency with the newest message and who sent it,
the unread ones at the root and counted on the bar, a full-text search
over the whole archive, the contacts with their numbers. Reading and
marking read are always on; sending, replying and reacting only where
you turn `send` on, and then only as a form you submit.

| palette | id | kind | what `Enter` does |
| --- | --- | --- | --- |
| Chats | `whatsapp-chats` | live, lazy, primary | opens the chat in the app or the web client |
| Unread | `whatsapp-unread` | live, lazy | the same, over the unread chats only |
| Search WhatsApp | `whatsapp-search` | input | opens the hit's chat |
| Contacts | `whatsapp-contacts` | indexed, 1 h, catalog | opens a chat with the contact |

**Chats** lists every conversation the session has (direct chats and
groups; the status feed and broadcast lists are left out), the unread
ones first, then newest first. A row is the profile picture (or the
initial on a tile; a group without a picture takes the group glyph), the
name, the newest message on one line (in a group with who wrote it), a
`group` tag, the unread count in green, and how long ago. For the unread
chats the newest messages are fetched live so the line and the sender
are right; for the rest the gateway's own one-line summary stands
(media messages have none, so the line is empty). The pane (`⌘I`, or rest
on the row) is the last twenty messages as a conversation: the sender in
bold ("You" for yours) with the time, a quoted reply as a blockquote
under it, a photo, a voice message, a document or a sticker named in
brackets, then the chat's facts (kind, unread, the phone, when the newest
message came) and a link into the web client.

| action | shortcut | notes |
| --- | --- | --- |
| Open chat | `Enter` | `whatsapp://send?phone=` in the desktop app, `https://web.whatsapp.com/send?phone=` on the web, per `open`. A group has no link of its own on either, so it opens WhatsApp at the top and the HUD says so |
| Mark as read / Mark as unread | `⌘Enter` | works on marked rows too |
| Send a message | `⌘⇧R` | `send` on. A form: the text, and a box to quote the chat's latest message (a reply) |
| React to the latest message | `⌘⇧E` | `send` on. WhatsApp's six quick reactions, or remove yours |
| Open in the web client | `⌘⇧O` | |
| Copy number / Copy name | `⌘C` | the number as `+905...`; a group's name |

**Unread** is the same rows over the chats with something unread, direct
messages first then groups, so the root carries them; "Nothing unread"
when there are none. **Search WhatsApp** sends what you type to the
gateway's `/api/search` (full-text over the archive, every message back
to the first chat, `<mark>`-highlighted snippets), a keystroke waiting
300 ms for the next; a row is the matching line, who said it where, and
when; `Enter` opens the chat, `⌘C` copies the message, the pane is the
chat's conversation. **Contacts** is every saved contact (the ones the
phone has a name for) with the number, one row per number; `Enter`
opens a chat, `⌘C` copies the number, `⌘⇧C` copies a vCard 3.0
(`FN` and `TEL`), so the person lands in Contacts or another phone.

## The bar item

`whatsapp/unread`: the number of unread chats as the badge, hidden at
zero, red while a direct chat is among them (`dm_urgent`); every 120 s
and when the panel shows, after a wake and when the network is back.
The popover lists them, direct messages then groups, each with the
picture, the newest message and the time, and a cursor the arrows move
and a click sets: `Enter` opens the chat, `m` marks it read, `a` every
listed one, `o` opens WhatsApp, `p` the Unread palette, `⌘⇧O` the web
client; with `send` on, `r` turns the search row into a message field
whose `Enter` sends to the focused chat. With `unread_only_bar` off the
glyph stays on the bar while nothing is unread, muted, and the popover
lists the recent chats instead.

## What it reads, and what it writes

Everything goes to the gateway's HTTP API with the `api_key` as
`x-api-key`; nothing else sees the chats. Read: `GET /api/sessions`
(once, to resolve the session's UUID from its name; kept in storage),
`/chats` (the list, live from WhatsApp), `/messages/<chat>/history`
(the newest messages of the unread chats and the pane's twenty, live)
and `/messages?chatId=` (the archive's rows for the same chat, which
carry the sender's saved name and the quoted reply the live shape
lacks; the two are merged by message id), `/contacts` (a thousand a
page), `/contacts/<id>` (a group member's name, once each),
`/contacts/<lid>/phone` (the number behind a LID-era chat id, once
each), `/contacts/profile-pictures` (eight ids per pass, in the
background: the gateway resolves them one by one at about 150 ms each,
so they are never on a listing's path; the urls, good for about nine
days, are kept in storage), `/search`.

Written, always: `POST /chats/read` and `/chats/unread` (Mark as
read / unread: the owner's daily write, and the account's own
setting on the phone). Written only with `send` on, each from a form
you submit or the popover's field on `Enter`: `POST /messages/send-text`,
`/messages/reply` (a quoted reply), `/messages/react`. With `send` off
none of the three is offered anywhere, and a pick that asks anyway is
refused with a toast naming the setting, so a stale row from before a
settings change cannot send. The key can do all of it; the setting is
the control.

## Setting up

The bundled configuration is the owner's: OpenWA on his own box at
`http://wp.lan` (`base_url`), one session named `main` linked to his
phone, the archive of every message since 2018 behind `/api/search`,
sending off. A generic install needs an OpenWA gateway of your own
(Docker, Postgres or SQLite; the project's README), a session linked
by scanning its QR code in OpenWA's UI, and an API key from its
Settings, API keys, put under `api_key` (it lands in the OS keychain).
`session` is the session's name (or its UUID). The search palette needs
OpenWA's full-text index (built into the Postgres and SQLite stores) or
a search plugin; without one the palette shows one row naming what the
gateway answered.

| key | type | default | what |
| --- | --- | --- | --- |
| `base_url` | text | `http://wp.lan` | Where the gateway answers; `/api` is under it. |
| `api_key` | secret | (none) | Sent as `x-api-key`. |
| `session` | text | `main` | The session's name; its UUID is resolved and cached. |
| `send` | boolean | `false` | Send a message, React, the popover's reply field. |
| `unread_only_bar` | boolean | `true` | Hide the bar item at zero; off keeps the glyph as a way into the popover, muted while nothing is unread. |
| `dm_urgent` | boolean | `true` | The bar item red while a direct chat is unread. |
| `open` | select | `auto` | `auto` (the desktop app when installed on macOS, else the web client), `app`, `web`. |

Hint rows name the fix: no key set (Open WhatsApp settings), the
gateway unreachable at its url, the key rejected (401), the session
not ready (a `qr_ready` session says to scan the code at the gateway's
url), a session name nobody has, the rate limit (`Retry-After`, refused
locally until then), the search provider down (the status and the
message the gateway gave).

Not shown, because the gateway's chat list does not carry them: muted
and pinned chats, a group's member count. A chat's picture is asked for
among the newest 48 only; the rest keep the initial. WhatsApp Channels,
the status feed and broadcast lists are not listed.

## Links

- `pal://whatsapp/open?chat=<id | phone | name>`: a chat id (`...@c.us`,
  `...@lid`, `...@g.us`), a phone number, or a name the chats or the
  contacts have (exact, then a prefix).
- `pal://whatsapp/search?q=<words>`: the search palette with the query
  typed.
