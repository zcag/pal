# Accounts

A pal account is optional. With one, your settings and game progress sync
between your machines and play.cagdas.io and are backed up, and your game
scores go on the leaderboards under a name you choose. Everything here is
done in Settings › Account (or the Sign in button on play.cagdas.io). The
design is `design/accounts.md`; what is kept and sent is in
[usage.md](usage.md).

## Signing in

Type your email address, then the 6-digit code pal mails you
(from `noreply@cagdas.io`, valid 10 minutes). There is no password and no
separate sign-up: a new address becomes an account at its first code.
Settings › Account lists the machines signed in and signs any of them out.
**Delete account** removes everything the server keeps for you at once.

## What syncs

- **Settings**: the config file, except what belongs to one machine
  (hotkeys, the bar's target and position, folders, the menu bar icon, the
  usage switch, ...); [config.md](config.md#sync) has the list, and
  Settings marks those fields "this Mac only". Secret settings sync as
  their keychain reference only: a new machine asks for the key once.
- **Game progress**: the storage of extensions that opt in (`sync` in
  `pal.json`, [extensions.md](extensions.md#syncing-storage)). Other
  extensions' storage never leaves the machine.
- **Nothing is lost**: two machines that both changed something are
  merged by the extension's rules (a best score keeps the higher, unlocks
  keep both), never one overwriting the other. Every earlier value is kept
  for 90 days (and the last 20 of each after that); Settings › Account ›
  History puts any of them back.

## Leaderboards

A game declares its boards (`leaderboards` in `pal.json`,
[extensions.md](extensions.md#leaderboards)): a mode, a map, a daily run.
Signed in, your best per board shows under your handle (3 to 20 of
`a-z 0-9 _ -`, changeable). Signed out, scores still count, under a
generated name like *Teal Fox* marked **anonymous**; every board can hide
those. Signing in moves that machine's anonymous scores to your handle.

## The API

`https://pal.cagdas.io`, JSON in and out. The app sends
`Authorization: Bearer <token>`; play.cagdas.io uses its own `pal_session`
cookie (HttpOnly, Secure, SameSite=Strict, and a write must carry
`Origin: https://play.cagdas.io`). An error is
`{"error": "<code>", "message": "<plain words>"}`. Times are unix seconds.
A **value** is `{space, key, value, rev, at, device}` (`value` null:
removed).

### Auth and account

| call | answer, errors |
| --- | --- |
| `POST /api/auth/start {email}` | `{}` always (also when rate limited); 400 `email` |
| `POST /api/auth/verify {email, code, device}` | `{token, account: {email, handle}}` (on play: sets the cookie, `{account}`); 400 `code`, 429 `tries` |
| `POST /api/auth/signout` | `{}` |
| `GET /api/account` | `{email, handle, devices: [{id, name, created, last_seen, current}]}` |
| `PUT /api/account/handle {handle}` | `{handle}`; 400 `handle`, 409 `taken` |
| `DELETE /api/account/devices/{id}` | `{}` |
| `DELETE /api/account` | `{}` |

5 codes an hour per address, 5 tries per code. A token unused for 180
days is dropped. A handle is held for its old owner 30 days after a change.

### Sync

| call | answer, errors |
| --- | --- |
| `GET /api/sync?since=<rev>` | `{rev, values: [value]}`: every value changed after `rev` |
| `POST /api/sync {changes: [{space, key, value, base, rule, base_value?}]}` | `{rev, values: [value]}`, one per change, in order; all or none. 400 `space`/`key`/`rule`/`json`, 413 `full` |
| `GET /api/sync/history?space=&key=` | `{revs: [value]}`, newest first (no `key`: the whole space) |
| `POST /api/sync/restore {space, key, rev}` or `{space, at}` | `{rev, values: [value]}`, the keys that changed; a restore is a new revision |

`space` is `config` or `ext:<name>`; 256 KB per extension, 1 MB for
config, 2000 changes per push. `base` is the revision the client last saw
for the key (0: never). Equal to the server's, the value is stored as sent;
otherwise the server merges by `rule`:

| rule | merge |
| --- | --- |
| `max`, `min` | the larger, the smaller |
| `union` | every element of both arrays, the server's first, no duplicates by JSON value |
| `sum` | the server's + (sent − `base_value`) |
| `{"fields": {...}}` | objects field by field, recursively, an unlisted field by `latest` |
| `latest` | what was sent |

A value of the wrong type for its rule merges by `latest`; under any rule
but `latest` a removal keeps the other side's value. Both inputs of a merge
go to history.

### Scores

| call | answer, errors |
| --- | --- |
| `POST /api/scores {ext, board, value, anon?}` | `{best, rank, total}`; 400 `board`/`range`/`anon`, 409 `handle` (signed in without one), 429 `slow` |
| `POST /api/scores/claim {anon}` | `{}`: that id's scores move to the account, the better per board kept |
| `GET /api/boards/{ext}` | `{boards: [{id, title}]}`: declared boards, and those under a `*` that have scores |
| `GET /api/boards/{ext}/{board}?period=all\|day\|week&anon=0\|1&me=<anon>` | `{board: {id, title, order, format, period}, rows: [{rank, name, anon, value, at, me}], me}`: the top 50 and the asker's row |

Signed out, `anon` is required: a random id (`[A-Za-z0-9_-]{16,64}`) kept
by the device, never the usage id. A board must be declared by the newest
build of the extension in pal's registry. Every score counts for all time,
its UTC day and its ISO week; the declared `period` is the default view.
`anon=0` hides anonymous rows, and ranks count what is shown.
