# Accounts, sync and leaderboards

Design spec, 2026-10-04. A pal account, made from an email address, that
backs up and syncs a user's settings and game progress across their
machines and play.cagdas.io, and puts their scores on leaderboards. Status:
proposed; nothing implemented.

## Goals and non-goals

- A new machine has no setup step: sign in, and the settings, the installed
  extensions and the game progress of the other machines arrive.
- Settings have a backup: every version is kept on the server, and Settings
  can put back the settings of any earlier day.
- **No progress is ever lost.** A sync merges, it never replaces one side
  with the other; and the server never deletes a value, it keeps it as an
  older revision.
- Games have leaderboards, several per game (a mode, a map, a daily run),
  with scores from accounts and, clearly marked, from devices without one.
- The games on play.cagdas.io share all of it: the same account, the same
  progress, the same boards, in a plain browser.
- Optional. pal works as it does today without an account, and the
  anonymous usage id (`docs/usage.md`) is never joined to an account.
- Non-goals: passwords; GitHub, Google or Apple sign-in (not everyone has
  them; passkeys may come later as a second way in); syncing secret values
  (only their `keychain:` references sync); real-time multiplayer; cheat
  proof scores.

## Signing in: an email and a code

No password and no third-party identity. One flow everywhere:

1. The user types an email address (Settings › Account in the app, the
   sign-in sheet on play.cagdas.io).
2. `POST /api/auth/start {email}` mails a 6-digit code from
   `noreply@cagdas.io` (Resend), valid 10 minutes, 5 tries, at most 5 codes
   an hour per address. Always answers 200, so it never tells whether an
   address has an account.
3. The user types the code where they asked for it. `POST /api/auth/verify
   {email, code, device}` answers `{token, account}`. An unknown address
   becomes a new account here: there is no separate sign-up.

A code rather than a link, because a link opens where the mail is read (often
the phone) and would sign in the wrong device; a code is typed into the one
that asked.

- **The app** keeps the token in the keychain (`keychain:pal/account`, the
  secrets store the config already uses) and sends it as
  `Authorization: Bearer`. The account's email and handle are cached in the
  data dir for display only.
- **play.cagdas.io** gets the token as an `HttpOnly; Secure; SameSite=Strict`
  cookie on its own origin. Only the outer page reads or uses it; see
  "play.cagdas.io" for why a game never can.
- A token is a random 32 bytes; the server keeps its SHA-256, the device
  name, created and last-seen dates. Settings › Account lists the devices and
  signs any of them out. Tokens do not expire while used; one unused for 180
  days is dropped.
- **Delete account** (Settings › Account, and the account page on the site)
  deletes everything the server holds for it: values, history, scores,
  handle, tokens. One confirm, no grace period.

## The handle

A leaderboard shows a **handle**, never the email: unique, `[a-z0-9_-]`, 3
to 20 characters, case-insensitive, a small reserved list (`pal`, `admin`,
`anonymous`, …). Chosen the first time it is needed (the first score of a
signed-in user, or in Settings › Account), changeable there at any time.
The old one is free again after 30 days.

## Sync

### The model

Everything synced is a **value under a key in a space**:

| space | keys | what |
| --- | --- | --- |
| `config` | dotted paths (`general.theme`, `palettes.files`) | the config file's synced part |
| `ext:<name>` | the extension's storage keys | the storage of an extension that opted in |

The server keeps, per account, space and key: the JSON value, a revision
(per account, increasing), the time and the device that wrote it. A value
replaced or removed moves to **history**, which keeps every revision for 90
days and at least the last 20 of each key after that. Nothing is deleted
any other way but Delete account.

### The calls

- `GET /api/sync?since=<rev>` → every value changed after `rev`, and the
  account's current revision. A client stores the revision it last saw.
- `POST /api/sync {changes: [{space, key, value, base, rule, base_value?}]}`
  → for each change, the value now stored and its revision.
  - `base` is the revision the client last saw for that key (0 when it never
    synced it). When it equals the server's, the value is stored as sent.
  - When it does not, someone else wrote the key since: the server **merges**
    the two by `rule` and stores the result; the client takes what comes
    back. Both inputs go to history.
- `GET /api/sync/history?space=&key=` and `POST /api/sync/restore {space,
  key, rev}` (a restore is a new revision, so it can be undone too).
- A space holds at most 256 KB (`storage.LIMIT`), the config space 1 MB.

The merge is on the server so it exists once (Go) rather than in the app's
Rust and the play page's JavaScript.

### Merge rules

A rule is per key, declared by the extension (below) or the core (config):

| rule | merge of mine and theirs |
| --- | --- |
| `max`, `min` | the larger, the smaller (numbers) |
| `union` | arrays: every element of both, in first-seen order, no duplicates by JSON value |
| `sum` | counters: theirs + (mine − `base_value`), the client sends the value it last synced |
| `fields` | objects: key by key, recursively, each field by the `fields` map's rule or `latest` |
| `latest` | the one written last; the other stays in history |

A key with no rule is `latest`. For game progress that is a loss the user
would feel (yesterday's longer streak replaced by today's shorter one), so
**every game declares a rule for every key that holds progress**, and a test
fails a game whose manifest says `sync` and leaves a key undeclared that the
fixture writes.

### First sign-in on a device that already has progress

The common way progress gets lost elsewhere, so it is the case the design is
built around: a device signing in for the first time pushes every local key
with `base: 0`, which the server merges against what it has by the same
rules. Neither side replaces the other. The same holds after signing out and
in again, and for a device that was offline for a month.

### What syncs

- **Extension storage, only by opting in**: `"sync"` in `pal.json`. Storage
  of extensions that did not opt in never leaves the machine; Spotify keeps
  its refresh token there, so syncing everything would upload credentials.
  ```json
  "sync": { "best": "max", "unlocks": "union", "plays": "sum",
            "stats": { "fields": { "wins": "sum", "streak": "latest", "longest": "max" } },
            "settings": "latest", "run": "latest" }
  ```
  A key not listed syncs as `latest`; a key whose rule is `"local"` never
  syncs (a hand of cards in progress may be one).
- **Settings**: the config file, as keys, except those that belong to one
  machine. The list lives in the core (`core/src/config/sync.rs`) and is
  shown in Settings: every field reads "synced" or "this Mac only". Stays
  local: hotkeys, the bar's target and position, window sizes and positions,
  paths (`extension_dirs`, files roots, projects), the menu bar icon,
  `general.usage`, instance settings that name a local path. Synced:
  everything else, including the installed extensions (a new machine installs
  them) and secret settings' `keychain:` references (the value is asked for
  once on the new machine: an "Add your key" row in Settings, a hint row in
  the palette). Config keys merge by `latest`.
- **When**: a change is pushed a few seconds after it is made (debounced),
  and the client pulls when the panel opens (at most once a minute), every
  15 minutes, and after a push. play.cagdas.io pulls on load and pushes after
  each `storage.set`, debounced.
- **A running game** learns of a value that arrived (merged or from another
  device) through `pal.storage.onChange(fn)` (kit) / `storage.onChange`
  (SDK), so a long session does not overwrite it with stale state on its next
  `set`: the core keeps the merged value and the game's next `set` of the
  same key goes through the merge again in any case.

### Settings › Account

A new Settings page, the only place any of this is done (config mirrors
nothing here; the token is not config):

- Signed out: the email field, then the code field. One sentence on what
  syncs.
- Signed in: email, handle (editable), "Last synced 2 min ago" with Sync
  now, the devices with Sign out, **History**: the config's versions by day
  with "Restore these settings", and per synced extension its keys with
  their history and Restore. Sign out (keeps local data), Delete account.
- Every synced setting elsewhere in Settings shows nothing new; the ones
  that stay local carry a small "this Mac only" note.

## Leaderboards

### Declaring boards

`pal.json` lists them; a game may have any number:

```json
"leaderboards": [
  { "id": "daily", "title": "Daily", "order": "desc", "format": "points", "period": "day" },
  { "id": "stage/*", "title": "Stage {1}", "order": "desc", "format": "time", "max": 3600 },
  { "id": "endless", "title": "Endless", "order": "desc", "format": "time" }
]
```

- `id`: `[a-z0-9_-]` segments joined by `/`; a `*` segment matches one
  segment of a posted board (`stage/hyper-3`), and `{1}` in the title is the
  segment it matched.
- `order`: `desc` (higher is better) or `asc` (lower: a time to clear).
- `format`: `points`, `time` (seconds, shown `1:01.20`), `moves`.
- `period`: `all` (default), `day`, `week`; days are UTC, so a daily board is
  the same board everywhere.
- `max` (and `min`): values outside are refused, the one cheap check against
  a forged score.

The server reads the declaration from the newest build of the extension in
our registry, and refuses a board that is not declared. Boards exist for our
registry's extensions only; a third-party registry has no server of ours
behind it.

### Posting and reading

- `POST /api/scores {ext, board, value}` → `{best, rank, total}`. Signed in:
  the account's entry. Signed out: the device's **anonymous id**, a random id
  kept in the data dir (`anon-id`) or in the play page's storage, never the
  usage id, never sent anywhere else.
- The server keeps each player's best per board and period, and the time it
  was set.
- `GET /api/boards/<ext>/<board>?period=&anon=0|1&around=me` → the top 50,
  and the asking player's own row and rank when they are not among them.

### Anonymous scores

- Shown under a name generated from the anonymous id (*Teal Fox*), with an
  "anonymous" badge; never a handle.
- Every board view has **Hide anonymous** (`anon=0`), remembered per viewer.
  Ranks are counted within what is shown.
- Signing in claims the device's anonymous scores: they move to the account
  (the better of the two per board), and the anonymous id is dropped.

### In the extension

- Kit: `pal.score(board, value)` → `{best, rank, total}`;
  `pal.leaderboard(board, {period, anon})` → rows. SDK: `leaderboard.post`,
  `leaderboard.get`, for the view-tree games (2048, sudoku, wordle,
  crossword). Both go through the core in the app, through the outer page on
  play.cagdas.io.
- `pal.account()` → `{signedIn, handle}`, and `pal.signIn()` opens the
  sign-in (Settings › Account in the app, the sheet on play.cagdas.io), so a
  game can say "Sign in to keep your scores" and offer it.
- Offline: a post is queued and sent later; the game shows the local best.
- No board UI is required of a game: the **Games shelf** and each game's
  page on play.cagdas.io show its boards (tabs by board, period switch,
  Hide anonymous). A game may draw its own from `leaderboard`.

## play.cagdas.io

The games' site moves from palplay.cagdas.io (which answers 301 to it).

- **The game's frame is sandboxed**, `sandbox="allow-scripts"`, as in the
  app. Today it is not (`pal-site/web/templates/play-game.html`), so a game
  shares the page's origin, and with a session cookie there a game's code
  could call the account API as the player. Sandboxed, its origin is opaque:
  its requests carry no cookie (SameSite=Strict, and the API checks
  `Origin`), and it cannot reach the page.
- The outer page runs the kit's other half, the role `Surface.tsx` plays in
  the app: it answers the frame's `storage`, `score`, `leaderboard`,
  `account`, `signIn` messages, keeps storage in `localStorage` while signed
  out and syncs it when signed in, and draws the sign-in sheet, the handle
  picker and the boards.
- Signing in on play.cagdas.io merges the browser's progress into the account
  by the same first-sign-in rule.

## Privacy

`docs/usage.md` changes in the same commit as the feature: the account is
opt-in; the account API never receives the usage id and the usage endpoint
never receives the account token; the anonymous score id is its own; what
the server keeps (email, handle, synced values and their history, scores,
token hashes with device names) and that Delete account removes all of it.
No IPs are kept (rate limits are in memory). The endpoints and payloads are
public: `docs/accounts.md`.

## Protocol

New SDK exports (`leaderboard`, `storage.onChange`, `account`), new kit
calls and two manifest fields: `PROTOCOL` 5. A game that declares `sync` or
`leaderboards` is stamped 5 and reaches users with the app release that
carries 5, as the protocol gate already does.

## Where it lives

| piece | where |
| --- | --- |
| accounts, codes, tokens, sync, merge, history, scores, boards | pal-site: `account/` (new package), SQLite tables beside the registry's, routes on both listeners |
| mail | pal-site, Resend, `RESEND_API_KEY` in `/etc/pal-site.env` |
| token, sync client, config sync and its local list, anon id, offline queue | core: `account.rs`, `sync.rs`, `config/sync.rs`; `storage.rs` marks changes |
| Settings › Account, the "this Mac only" notes | app: `SettingsAccount.tsx`, Tauri commands |
| `leaderboard`, `account`, `storage.onChange`, manifest types | sdk; host relays; core bridge `core/account.*`, `core/leaderboard.*` |
| kit calls | `app/src-tauri/surface-kit/surface.js`, `Surface.tsx` |
| manifest validation | core manifest parsing and `pal-pack` (`leaderboards` ids and patterns, `sync` rules) |
| boards in the Games shelf | `games/` in pal-extensions |
| the play page, sandbox, sign-in sheet, boards | pal-site `web/play.go`, templates, static js |
| every game's `sync` and `leaderboards` | `<game>/pal.json` and code in pal-games |

## Order of work

1. pal-site: accounts and codes, sync with merge and history, boards. Tests
   on an in-memory database and a fake mailer.
2. Contract: SDK types, `PROTOCOL` 5, kit calls, manifest fields and their
   validation.
3. Core and app: account, sync client, config sync, Settings › Account.
4. play.cagdas.io: the domain, the sandbox, the outer page, sign-in, boards.
5. Games: rules and boards for each, the Games shelf's boards.
6. Deploy the site, release the app, promote the games.
