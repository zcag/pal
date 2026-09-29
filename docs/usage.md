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

## What is sent

Every request pal makes to pal.cagdas.io (registry, packages, updates)
carries `User-Agent: pal/<version> (<os>; <arch>)`, and `X-Pal-Install: <id>`
while sharing is on. On top of that, while sharing is on, pal sends batches
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
