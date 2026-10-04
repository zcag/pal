# Usage data

pal counts a few things so its author can see what is installed, used and
kept, and whether a release reached people. This page lists all of it; the
code that sends it is `core/src/usage.rs`.

It is on by default and off with one switch: Settings › General › **Share
anonymous usage** (`general.usage = false` in the config file).

## What identifies you

A random id made on first run and kept in pal's data directory
(`usage-id`). Nothing else: no account, no name, no hostname, no path. A
config file restored on another machine does not carry the id.
pal.cagdas.io does not keep IP addresses; it keeps the country at most.

Turning sharing off deletes the id; turning it on again makes a new one.

Separately, pal keeps a local record of which extensions you open
(`extensions-used.json` in its data directory, a name and the last time),
so the ones you use carry over when fewer come bundled. It is kept whether
sharing is on or off and is never sent.

## What is sent

Every request pal makes to pal.cagdas.io (registry, packages, updates)
carries `User-Agent: pal/<version> (<os>; <arch>)`, and `X-Pal-Install: <id>`
while sharing is on. The app's own update check asks
`https://pal.cagdas.io/update/<target>/<arch>/<version>`, with `?i=<id>`
while sharing is on: a query parameter rather than the header, since the
site redirects that request to GitHub, which never gets the id. On top of that, while sharing is on, pal sends batches
to `POST https://pal.cagdas.io/api/events`:

```json
{
  "pal": "0.8.0", "os": "macos", "arch": "aarch64",
  "events": [
    { "at": 1790000000, "kind": "install", "ext": "weather", "hash": "…", "seq": 1790000000, "from": "search" },
    { "at": 1790000100, "kind": "fail", "ext": "hue", "from": "auto", "error": "download" }
  ],
  "daily": {
    "day": "2026-09-30",
    "installed": [{ "ext": "weather", "hash": "…" }],
    "third_party": 1,
    "source": 0,
    "opens": { "calc": 12, "weather": 3 }
  }
}
```

- `kind`: `install`, `update`, `remove`, `rollback`, `fail`, `enable`,
  `disable`.
- `from`: where it started: `store`, `settings`, `search`, `games`,
  `welcome`, `web`, `deeplink`, `migration`, `reconcile`, `auto`, `cli`.
- `error`: a kind only (`download`, `verify`, `load`, `offline`,
  `incompatible`), never a message.
- `daily`, once a day: extensions installed from pal's own registry with
  their build, how many come from other registries or from source (counts,
  no names), and how many times each extension's palettes were opened.

Nothing about extensions from other registries, what you type, what you
pick, or any row's content is ever sent. Other registries receive only the
requests needed to fetch their index and packages, without the id.

Events wait in `usage-queue.jsonl` in the data directory while offline and
are dropped after 30 days unsent.

## A pal account is separate

Signing in to a pal account (Settings › Account) is opt-in, and has
nothing to do with the usage id above: the account calls
(`https://pal.cagdas.io/api/auth/*`, `/api/account`, `/api/sync`,
`/api/scores`, `/api/boards/*`) never carry `X-Pal-Install`, and the
events endpoint never receives the account's token. The endpoints and
their payloads are public: `docs/accounts.md`.

What the server keeps for an account: the email address, the handle,
the synced settings and extension storage with their history (every
version for 90 days, then at least the last 20 of each key), the scores,
and for each signed-in device the SHA-256 of its token, its name and when
it signed in and was last seen. Secret values never leave the keychain;
only their `keychain:` references sync. No IP addresses are kept: the
rate limits on sign-in codes live in memory. **Delete account** removes
all of it at once.

Leaderboard scores posted while signed out go out under an anonymous id
of their own (`anon-id` in the data directory), never the usage id and
never sent anywhere else; signing in moves those scores to the account
and deletes the id. A score that cannot be sent waits in
`score-queue.json` until it can.
