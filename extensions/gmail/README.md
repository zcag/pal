# Gmail

Your inbox in the panel and its count on the bar, per account. Five
palettes and a bar item over the Gmail API, one instance per account:

- **Inbox** (`gmail-inbox`): unread first, then the newest fifty, then the
  unread of any label named in `labels`; each row the sender's avatar,
  the subject, the sender and the snippet, the user labels as chips, a
  paperclip when there is an attachment, the date. The pane shows the
  message as text with the quoted replies folded, the headers and the
  attachments.
- **Search Mail** (`gmail-search`): Gmail's own search as you type
  (`from:`, `to:`, `subject:`, `has:attachment`, `newer_than:7d`,
  `label:`), the hits sectioned by label.
- **Labels** (`gmail-labels`): yours, then Gmail's and the categories;
  Enter opens the label in Gmail, cmd+Enter searches it here.
- **Compose** (`gmail-compose`) and **Drafts** (`gmail-drafts`): only for
  an account with `send` on (below).
- **Unread** (`gmail/unread`, the bar item): the inbox's unread count as
  a badge, hidden at zero, the account's title beside the glyph; every
  two minutes and on show, wake and network. The popover is a view of
  its own: the newest five as rows — the sender's mark, who wrote it,
  the subject and its snippet, the time, a star or a paperclip — with a
  cursor the arrows move and a click sets. Enter opens the focused
  message in Gmail, `m` marks it read, `s` stars it, `a` marks every
  listed message read, `o` opens Gmail, `p` the Inbox palette.

## Two accounts

The extension is `multi`: a second account is a second instance with its
own token command, address, palettes, bar item and storage
(docs/design/instances.md). The default instance is `[extensions.gmail]`;
another is `[extensions."gmail@work"]` next to `[instances."gmail@work"]`:

```toml
[extensions.gmail]
token_command = "gcloud auth application-default print-access-token"
send = true
signature = "Cagdas"

[instances.gmail]
title = "Personal"

[instances."gmail@work"]
title = "Work"
tint = "amber"

[extensions."gmail@work"]
token_command = "ssh archer \"curl -s 'http://127.0.0.1:8776/token?aud=gmail-work'\""
address = "someone@example.org"
# send stays false: read and mark-read only
```

`token_command`, `address` and `send` are `scope: instance`: never
inherited from the default instance, so a second account can never send
because the first one may. `labels` and `signature` inherit until set.
Palette titles carry the instance's title ("Inbox (Work)"), the tile
its tint and badge, and the bar item's strip text is the title, so the
two accounts read apart everywhere.

## The token command

pal has no OAuth flow and ships no Google client id. The account's
access token comes from a command of yours, `token_command`, run through
`sh -c`; its stdout is the token, a bare line or the JSON an OAuth
endpoint answers (`access_token`, `expires_in`). The token is kept in
memory until the expiry it stated (30 minutes for a bare one), minted
again once on a 401, and never written anywhere. The command owns the
secret; pal only ever holds a short-lived access token.

- **gcloud** (the generic path, documented, not tested here): `gcloud
  auth application-default login
  --scopes=https://www.googleapis.com/auth/gmail.modify,https://www.googleapis.com/auth/cloud-platform`
  once, then `gcloud auth application-default print-access-token` is the
  command. `gmail.readonly` is enough for the rows; mark-read needs
  `gmail.modify`, and sending `gmail.send` or `gmail.modify`. If Google
  answers 403 asking for a quota project, `gcloud auth
  application-default set-quota-project <project>` with the Gmail API
  enabled on it.
- **A helper or a broker**: anything that prints a token. The owner's
  accounts go through a broker on another box that mints one per
  audience: `ssh archer "curl -s 'http://127.0.0.1:8776/token?aud=gmail'"`
  and `aud=gmail-work`. The remote command needs its own quotes: the
  remote shell globs the `?` in the url otherwise, and that `no matches
  found` is what the hint row shows.

A command that fails is one hint row in every palette with the command's
last stderr line ("Token command exited 7: curl: (7) Failed to connect
...") and Open Gmail settings as its action; an empty command names the
fix; a token Gmail rejects says to check the scopes. The bar item hides
while there is no token and goes stale on any other failure.

## Read and mark-read only, unless you say so

`send` is off by default, and off means the account is **read and
mark-read only**: no compose, no reply, no drafts, no archive, no star,
whatever the token could do. The Inbox and Search rows then carry Open
in Gmail, Mark as read (or unread) and Copy link; Compose and Drafts
list nothing.

That is the rule for a work account, and the reason `send` is per
instance. Mail leaving an employer's domain commits the employer and is
seen by colleagues; that is not a launcher's to originate. The owner's
work identity is granted the full Gmail scope because mark-read needs
`gmail.modify` and no Google scope grants mark-read without also
granting send, so the rule lives in this setting rather than in the
scope: the token *can* send, the extension does not. Marking read is the
one write that stays on, because it is the one the owner uses daily and
the one the account's policy allows. Draft the answer and hand it over;
send it from Gmail yourself.

With `send` on for an account (a personal one), Compose is a form (to,
cc, subject, body; the `signature` under the body), Reply on a row is a
form with the original quoted under the answer and sent in its thread,
Drafts lists Gmail's drafts to send or discard after a confirmation,
Archive and Star join the row's actions.

## Rows and actions

| action | shortcut | when |
| --- | --- | --- |
| Open in Gmail | `Enter` | `https://mail.google.com/mail/u/<address>/#inbox/<threadId>` (`#all/` off the inbox) |
| Mark as read / Mark as unread | `⌘Enter` | `messages.batchModify`; works over marked rows too |
| Archive | `⌘E` | send on; out of the inbox |
| Star / Unstar | `⌘S` | send on |
| Reply | `⌘⇧R` | send on; the form, then `messages.send` in the thread |
| Copy link | `⌘C` | |
| Search label | `⌘Enter` | on a label row: Search Mail with `label:<name>` typed |
| Send draft / Discard draft | `⌘Enter` / `⌘D` | send on; each asks first |

The letter keys the design asked for (`e`, `s`) would type into the
search box in a list palette (docs/keyboard.md), so they are `⌘E` and
`⌘S`.

The sender's mark is the Gravatar for the address when there is one (a
HEAD per address, remembered for the process), else the initial on a
tile tinted from the address.

## Requests and quota

`messages.list` with `maxResults` 50 (the unread of the inbox, the
inbox, each `labels` entry's unread), then `messages.get` with
`format=metadata` and the row's headers only, eight at a time, cached by
id for the process (a message's headers never change; its labels are
patched here on every write); `format=full` only for the message the
pane or a reply opens (the last twenty kept). The unread count is the
list's length under a page, `labels.get INBOX` past it. The label table
is read once an hour and persisted in storage, so a restart lists with
no call. The inbox is shared between the bar item and the palette for
30 s, so the panel showing (which fires both) costs one read. A 429 (or
a 403 naming the quota) is remembered for its `Retry-After` (60 s
without one) and every call until then refused locally.

## Settings

| key | type | default | what |
| --- | --- | --- | --- |
| `token_command` | text, per instance | (none) | The command that prints the access token. |
| `address` | text, per instance | (none) | The account's address for the links and the tooltip; the profile's when empty. |
| `labels` | list | `[]` | Labels whose unread mail Inbox lists besides the inbox, by name. |
| `send` | boolean, per instance | `false` | Compose, reply, drafts, archive, star. Off: read and mark-read only. |
| `signature` | text | (none) | Under the body of a composed or replied message. |

For the tests, `PAL_GMAIL_API` replaces the API host and
`PAL_GMAIL_AVATARS` the Gravatar host (empty turns the probe off).

## Not done

The attachment mark on a row is a guess from the top-level MIME type
(`multipart/mixed`) since `format=metadata` sends no parts; the pane
confirms it. Threads are not grouped: a row is a message, opened at its
thread. No trash, no labelling from here, no attachment download.
