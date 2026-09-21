# Slack

What Slack is holding for you, the part that is yours: direct messages,
@-mentions and replies in threads you follow as rows with who said what
and how long ago, the channels that are merely unread named under them;
the channels you are in; Slack's own search typed into the panel; your
status, presence and Do Not Disturb. One bar item counts what is
addressed to you and stays hidden otherwise.

| palette | id | kind | what `Enter` does |
| --- | --- | --- | --- |
| Unreads | `slack-unreads` | live | opens the conversation in the Slack app, at the message |
| Channels | `slack-channels` | indexed, 1 h, catalog | opens the conversation in the Slack app |
| Search Slack | `slack-search` | input | opens the message in the Slack app |
| Status | `slack-status` | live | sets the status, snoozes, or flips presence |

**Unreads** is built on *addressed* versus merely *unread*. A workspace of
thirty channels is never at zero unread, so a list or a count of those
would be permanently lit and say nothing. A direct message, an @-mention
(`@you`, `@here`, `@channel`) or a reply in a thread you follow is
someone asking you for something: those are the rows and the count.
Channels that are only unread come last, named, without a count, their
topic or purpose as the subtitle (else "New messages"). The
sections are Direct messages, Mentions, Threads, Channels, newest first
in each. A row is the conversation (the person, `#channel`, the people of
a group message) with the sender's avatar, the message (in a channel, the
one that names you, not whatever was said last), a count badge (red for
a direct message or mention, blue for thread replies, `1+` when the run
is longer than a page), a presence dot for a direct message (green while
the person is active, grey while away; in a group message, whoever wrote
the message shown) and how long ago. The detail pane (`⌘I`, or rest
on the row) is the unread run itself, oldest first, up to eight
messages. Actions: Open in Slack (`Enter`), Reply (`⌘Enter`; the message
is the row's typed argument: Tab into the Message field in the bar, and
`⌘Enter` posts it to the conversation, or into the thread for a threaded
mention; a pick without it, from `pal run` or a hotkey, is a one-field
form), Mark as read (`⌘⇧R`, up to the latest message), Open
in browser (`⌘⇧O`, the archive page), Copy link (`⌘C`). Thread rows have
no message text (Slack's counts name the channel, not the thread) and no
Reply or Mark as read.

**Channels** is every channel, private channel, group message and direct
message you are in, channels first, then by name, with the topic or
purpose, the member count and a tag for private, group and DM. Enter
opens it; Send a message (`⌘⇧R`) posts the message typed in the bar's
field (the same `chat.postMessage` a reply uses; a form when picked
without it). Listed once an hour (`⌘R` for now). **Search Slack** sends what you type to
`search.messages` as is, so Slack's own syntax works: free text,
`from:@name`, `in:#channel`, `has:link`, `before:yesterday`, `on:` a
date; rows are the message, who said it where, and when. **Status** lists
what is set now first (your status with its expiry, Do Not Disturb, your
presence), then the presets from the `statuses` setting and a "Set a
status…" row whose text, emoji and expiry are typed in the search bar,
Do Not Disturb for 30 minutes, an hour, until tomorrow or for the minutes
you type ("Do Not Disturb for…"), and Set away / Set active. A pick of
either typed row that arrives without its values (a hotkey, `pal run`)
asks for them in a form with the same fields.

## Signing in

**`auth = "app"`** (the default) reads the Slack desktop app's own
session, so what the palette sees is exactly the inbox on your screen:
no Slack app to create, nothing for an admin to approve, and the client
API's `client.counts`, the one call that answers every unread at once
(the public API has no unread endpoint). What is read, all of it
read-only, both files copied before reading since the app holds them
open:

- `~/Library/Application Support/Slack/Local Storage/leveldb/` (Linux:
  `~/.config/Slack/`, the snap or the flatpak path): the key ending in
  `localConfig_v2`, the app's record of its signed-in workspaces (id,
  name, domain, your user id, the `xoxc-` token). It is a LevelDB, so
  the SSTables and the write-ahead log are parsed (`leveldb.ts`); a
  value written since the last compaction is only in the log.
- `~/Library/Application Support/Slack/Cookies`: the `d` cookie for
  `.slack.com`, AES-128-CBC under a key derived from the app's "Slack
  Safe Storage" password in the login keychain (`security
  find-generic-password`; the one step that can prompt, and "Always
  Allow" ends that). On Linux the password comes from the Secret Service
  (`secret-tool lookup application Slack`) for a `v11` value, or is
  Chromium's fixed "peanuts" for a `v10` one.

Both are kept in memory only, never written anywhere, and extracted
again when Slack answers `invalid_auth` (you signed in again), once per
call. Nothing is sent anywhere but `<workspace>.slack.com`.

**`auth = "token"`** uses a user token (`xoxp-...`) from a Slack app of
your own, as a bearer. It has no `client.counts`: unreads then come from
`conversations.info` per conversation you are in (`unread_count_display`),
which gives direct messages and unread channels but no mention counts and
no thread replies (a mention in a channel is still shown when its unread
run is fetched). Scopes: `channels:read`, `groups:read`, `im:read`,
`mpim:read`, the four `*:history`, `users:read`, `chat:write`,
`search:read`, `users.profile:write`, `users:write`, `dnd:write`.

Without either, each palette is one hint row saying what is missing;
Enter on it opens the extension's settings.

## Requests

One `client.counts` per refresh gives every conversation's `last_read`,
`latest`, mention count and unread flag and the thread counts. A
`conversations.history` is spent only on an addressed conversation
(never on the quiet channels), only for the newest twelve, and only once
per change of its `latest`, so a refresh where nothing moved is the one
call. The inbox is shared between the bar item and the palette for 30 s,
so the panel showing and the bar refreshing on it cost one fetch. Names
and avatars come from `users.list` and `users.conversations`, kept an
hour, with `users.info` / `conversations.info` for an id they lack.
The presence dots are one `users.getPresence` per person among the
direct messages listed (the inbox carries no presence), eight in flight
at once, each remembered a minute so a re-list inside it asks nothing;
a lookup that fails or takes over 2 s leaves its row without the dot and
never holds the listing longer. `presence = false` makes none of them.
Every request has a 10 s timeout; a 429 is remembered for its
`Retry-After` and every call until then fails at once (a hint row, a
stale bar item) instead of piling onto the limit.

## Keyboard

| keys | action | where |
| --- | --- | --- |
| `enter` | Open in Slack (the app, at the message when one is known) | Unreads, Channels, Search |
| `cmd+enter` | Reply: the message typed in the bar's field posts to the conversation, into the thread for a threaded mention (a form when picked without it) | Unreads, not a thread row |
| `cmd+shift+r` | Mark as read, up to the latest message | Unreads, not a thread row |
| `cmd+shift+r` | Send a message: the message typed in the bar's field, posted to the conversation (a form when picked without it) | Channels |
| `cmd+shift+o` | Open in browser (the web client's archive page) | Unreads, Channels, Search |
| `cmd+c` | Copy link (Copy text on a search hit) | Unreads, Channels, Search |
| `enter` | Set status, Clear status, Pause notifications, End Do Not Disturb, Set away / active; on "Set a status…" the bar takes the status text, the emoji (`:speech_balloon:` unless you say) and the expiry (none, 30m, 1h, 2h, 4h, tomorrow), on "Do Not Disturb for…" the minutes | Status |
| `cmd+i` | The detail pane: the unread run | Unreads |

## Settings

`[extensions.slack]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `auth` | `app` / `token` | `app` | The desktop app's session, or a user token. |
| `token` | secret | (none) | The user token, with `auth = "token"`; the file holds a `keychain:` reference. |
| `workspace` | text | (none) | The workspace when the app is signed in to several, by id (`T...`) or domain; empty lists every one (status and search on the first). |
| `statuses` | list | five presets | One per line as `:emoji: text (expiry)`; the expiry is `30m`, `2h`, `1d` or `today`, or left out. Common Slack shortcodes are drawn as the emoji. |
| `presence` | boolean | `true` | A presence dot on each direct message row (green active, grey away), one `users.getPresence` per person, remembered a minute; off makes no such call. |
| `refresh` | number (s) | `120` | Seconds between refreshes of the bar item (10 at least). |

When the bar item is drawn and whether a direct message makes it urgent are its rules (`quiet`, `dm`) under Settings > Bar: narrow `quiet` to `slack.attention == 0 and slack.channels == 0` to keep the glyph while a channel is merely unread, turn `dm`'s Urgent off for a plain count. Keeping it at all times is the core's `show = "always"` under `[bar.items."slack/unreads"]` (docs/config.md).

## The bar item

**Unreads** (`slack/unreads`): the count of what is addressed to you
(direct messages + mentions + thread replies) as the badge, hidden at
zero, urgent while a direct message waits. Refreshed every `refresh`
seconds and when the panel shows, after a wake and when the network is
back. The popover is a view of the item's own: a section per kind with
every row (the popover scrolls), each the sender's picture (an initial in a colour
while it is not fetched), the conversation, the message on one line,
the time and a count (red for a direct message or a mention, blue for
thread replies), a direct message's presence as a dot on the picture;
the channels that are only unread as a row of badges
under them (a click opens one), then the keys. A cursor marks the row
the keys act on: the arrows (or `j`/`k`) move it, a click on a row sets
it.

| key | does |
| --- | --- |
| Enter | opens the row in the Slack app, at the message |
| `r` | reply: the search row becomes a text field, Enter posts it to the conversation (into the thread for a threaded mention), Escape cancels |
| `m` | marks the row read, up to its latest message |
| `a`, `⌘⇧A` | marks every listed conversation read |
| `o` | opens Slack |
| `p` | opens the Unreads palette in the popover |
| `⌘⇧O`, `⌘C` | the row in the browser, its link copied |

A refresh that fails leaves the item stale (muted) until the next one
succeeds; not signed in hides it.

## What it does not do

- Read a thread's replies: Slack's counts say which channel has unread
  replies in threads you follow, not which thread; the row names the
  channel and the count, Enter opens the channel in Slack.
- Mentions and thread replies with a user token: only the desktop app's
  session has `client.counts`.
- Reactions, files, huddles: a message that is only a file shows as
  `📎 name`; a huddle as "started a huddle".
- Several workspaces for status and search: those act on the
  `workspace` setting's, else the first signed-in one; Unreads and
  Channels list every one.

## Platforms

macOS and Linux. The Linux cookie path (Secret Service or "peanuts") is
written to Chromium's documented shape and is not verified on a box
running Slack; the LevelDB and the rest are the same on both.
