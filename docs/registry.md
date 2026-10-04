# Registries and packages

The formats every pal app, registry and publisher agrees on. This page is the
contract; the design and its reasons are in `design/distribution.md`.

Everything here is version 1. A reader refuses what it does not understand
(`format` above 1, an unknown statement prefix) rather than guessing.

## Protocol

`PROTOCOL` is an integer in `sdk/src/protocol.ts` (and `pal_core::registry::PROTOCOL`,
kept equal by a test). It goes up when a change to the SDK or the host breaks
extensions built before it, and when it adds something extensions built
after it rely on (a new SDK export, a new `Effect` field): the SDK is
external to a package, so a build calling `ignoreStore` would fail to load
on an app without it, and the stamp keeps it from being offered there. An
app runs packages whose `protocol` is in `[PROTOCOL_MIN, PROTOCOL]`; both
numbers are in the same two places. `PROTOCOL_MIN` goes up only when the
older builds really stop working.

| protocol | what came with it |
| --- | --- |
| 1 | the first registry |
| 2 | `preview()`, `ignoreStore()`, `Effect.show.actions` |
| 3 | the detail header: `Detail.caption`, `title`, `chips`, `stats` |
| 4 | controls and groups (`docs/design/controls.md`): `controls`, `Extension.controls`, the manifest's `controls`, the control view components |
| 5 | accounts (`docs/design/accounts.md`): `leaderboard`, `account`, `storage.onChange`; the kit's `score`, `leaderboard`, `account`, `signIn`, `storage.onChange`; the manifest's `sync` and `leaderboards` |

## Packages

A package is one extension, built: the directory `pal-pack` writes.

```
weather/
  pal.json        the manifest, with "protocol": N stamped in
  index.js        bun build of index.ts, @zcag/pal external
  *.js            chunks (--splitting)
  surface/        a game's page, when it has one
  *.ts            the sources a surface imports, when it has one: those
                  beside index.ts and, followed to any depth, whatever
                  they import in folders of their own (game/sim/core.ts)
```

Nothing else: no `node_modules` (dependencies are inlined by `bun build`), no
dotfiles, no symlinks. `@zcag/pal` is external and resolves to the app's own
SDK at run time.

**Tree hash** (`pal-tree-v1`), the package's identity, computed on the
directory, not the tarball:

1. Walk the directory. Skip every entry whose name starts with `.`, at any
   depth. A symlink or anything but a regular file or directory is an error.
2. For each regular file, its path relative to the package root with `/`
   separators, UTF-8.
3. Sort the paths by bytes.
4. For each, the line `<path>\0<x|->\0<sha256 of the content, lowercase hex>\n`,
   where `x` means the owner-executable bit is set.
5. The hash is the lowercase hex sha256 of all lines concatenated.

`core/tests/fixtures/tree-hash/` holds a tree and its expected hash; the Rust
and TypeScript implementations both test against it.

**Tarball**: gzip over ustar, entries under one top directory named after the
extension (`weather/…`), modes `0644` or `0755`, uid and gid 0, mtime 0, no
user or group names, gzip header without a name and with mtime 0. The bytes
are reproducible but not what is hashed; a reader unpacks, refuses any entry
that is not a file or a directory or that escapes the top directory, then
hashes the tree.

**seq**: the committer time (unix seconds) of the commit the package was
built from. Newer means a higher `seq`; equal hashes are the same build
whatever their `seq`.

**Statement and signature.** A build is signed over the statement

```
pal-build-v1
<name>
<hash>
<seq>
<protocol>
```

(each line ending in `\n`) with [minisign](https://jedisct1.github.io/minisign/).
The build's `sig` is the whole `.minisig` file as text.

## Index

A registry is one JSON file and its detached minisign signature
(`index.json.minisig`, over the exact bytes of `index.json`) at a URL.

```json
{
  "format": 1,
  "name": "pal",
  "generated_at": "2026-09-30T12:00:00Z",
  "key": "RWQ…",
  "next_key": null,
  "extensions": [
    {
      "name": "weather",
      "listing": {
        "title": "Weather", "description": "…", "tagline": "…",
        "features": ["…", "…"], "category": "system",
        "keywords": ["forecast"], "icon": { "tile": { "glyph": "…", "bg": "cyan" } },
        "author": "pal", "platforms": ["macos", "linux"], "play": false,
        "palettes": [{ "id": "weather", "title": "Weather", "kind": "list" }],
        "screenshots": [{ "url": "https://…/1-list.png", "caption": "…" }],
        "requires": [], "suggests": [], "controls": []
      },
      "builds": [
        {
          "hash": "…", "seq": 1790000000, "protocol": 1, "commit": "…",
          "url": "https://pal.cagdas.io/registry/pkg/weather/<hash>.tar.gz",
          "manifest": "https://pal.cagdas.io/registry/pkg/weather/<hash>.json",
          "size": 12345, "sig": "untrusted comment: …\n…", "yanked": false
        }
      ]
    }
  ]
}
```

- `name` is the registry's own name, the one `[[store.registries]]` uses.
  Ours is `pal`.
- `listing` is what the Store, root search and Games show without fetching
  anything else; `manifest` is the full `pal.json` of that build. It is
  the manifest's `title`, `description`, `keywords`, `icon` (a tile,
  a product's logo included: docs/extensions.md, "Icons"), `author`,
  `requires`, `suggests` and `controls` (what it can do for a group:
  `volume`, `power`, `inputs`, `player`; design/controls.md), its store block's `tagline`, `features` (the
  "What it does" bullets), `category`, `platforms` (absent: every
  platform), `play` and `screenshots` (absolute urls with their
  captions), and its `palettes` (`id`, `title`, `kind`). A field an
  older index lacks reads as empty.
- `builds`: newest `seq` first. A registry keeps at least the newest build
  per `protocol` and the one before it (the rollback target).
- `yanked: true`: never offered; an installed yanked build is replaced by the
  newest good one.
- `url` and `manifest` may point anywhere.
- `key` (optional): the registry's current minisign public key. It is
  trusted only when a user adds the registry: `pal registry add` without a
  key shows it and pins it then. After that it is never read; the pin, and
  `next_key`, are what indexes are checked against, so an index cannot move
  the pin by changing `key`. Our indexes carry it too; the app ignores it
  and uses its built-in keys.
- `next_key`: a minisign public key the registry is moving to. The index is
  signed by the current key, so the move is signed; an app that sees it
  accepts later indexes signed by either key and keeps the new one from the
  first index signed by it.

**What an app checks**, in order: the index signature against the pinned key
(or the announced `next_key`); `format`; `generated_at` not older than the
cached copy's; per build, the statement signature; after download, the tree
hash equals `hash` and `pal.json`'s `name` equals the entry's.

## Our registry

| | |
|---|---|
| Stable index | `https://pal.cagdas.io/registry/stable/index.json` (+ `.minisig`) |
| Edge index | `https://pal.cagdas.io/registry/edge/index.json` (+ `.minisig`) |
| Packages | `https://pal.cagdas.io/registry/pkg/<name>/<hash>.tar.gz`, `…/<hash>.json` |
| Key | built into the app (`pal_core::registry::PAL_KEYS`) |

Served with `ETag` and gzip; apps send `If-None-Match`.

Published by `.github/workflows/extensions.yml`: every green push to main
builds into edge; `make ext-release [NAMES="a b"]` promotes edge to stable;
an app release promotes every first-party build at its tag. Publishing talks
to the site with a bearer token (`PAL_PUBLISH_TOKEN`):

| Call | Body |
|---|---|
| `PUT /api/registry/pkg/<name>/<hash>.tar.gz` | the tarball |
| `PUT /api/registry/pkg/<name>/<hash>.json` | the manifest |
| `PUT /api/registry/<channel>` | `{"index": "<text>", "sig": "<text>"}`, swapped in at once |
| `GET /api/registry/<channel>` | the current index, to build the next from |

## Running your own

`pal-pack` ships in `@zcag/pal`. By hand, with a key made once (below):

```sh
bunx --package @zcag/pal pal-pack build extensions/* --out dist   # → dist/<name>/, <name>.tar.gz, <name>.entry.json
bunx --package @zcag/pal pal-pack statements dist                 # → dist/<name>.statement, to sign
for f in dist/*.statement; do minisign -S -s acme.key -m "$f"; done
bunx --package @zcag/pal pal-pack index dist --name acme --base https://acme.github.io/pal --key RWQ… --out site
minisign -S -s acme.key -m site/index.json
```

`site/` is then the registry: `index.json`, its `.minisig` and
`pkg/<name>/<hash>.tar.gz|.json`. `--key` is the public key (below), written
as the index's `key`. A later publish adds `--merge` with the live
`index.json`, so the builds already listed stay (its `key` and `next_key`
too, unless `--key` or `--next-key` is given; `""` clears either), and their
packages must still be served beside it.

**The key.** A minisign key pair without a password, since CI has no one
to type it:

```sh
minisign -G -W -p acme.pub -s acme.key
```

`acme.key` (the whole file) is the secret; the second line of `acme.pub`
(`RWQ…`) is the public key users pin, and the one `--key` takes. Keep a copy of the secret somewhere
safe: without it, every user has to remove the registry and add it again.

**The Action** does all of it and deploys to GitHub Pages:

```yaml
# .github/workflows/registry.yml
name: registry
on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write      # deploy to Pages
  id-token: write   # the Pages deployment's OIDC token

concurrency:
  group: registry
  cancel-in-progress: false

jobs:
  publish:
    runs-on: ubuntu-24.04
    environment:
      name: github-pages
      url: ${{ steps.registry.outputs.url }}
    steps:
      - uses: actions/checkout@v4
      - id: registry
        uses: zcag/pal/.github/actions/registry@main
        with:
          name: acme
          extensions: extensions/*
          key: ${{ secrets.PAL_REGISTRY_KEY }}
          public-key: RWQ…
```

- Settings › Pages › Source: **GitHub Actions**, and `acme.key`'s text as
  the repository secret `PAL_REGISTRY_KEY`.
- Inputs: `name` (the registry's name), `extensions` (a glob, default
  `extensions/*`), `key`, `public-key` (the live index is checked against
  it before a run builds on it, a `key` that is not its pair fails the run,
  and the first key in it is written as the index's `key`), `base-url` (default the repository's Pages URL, a custom domain
  included) and `next-key` (below). Output: `url`, the index's URL.
- A run builds every extension and keeps the builds whose hash is not
  already the live index's newest; with none, nothing is deployed. It signs
  them and the index, and deploys the site with the packages of every build
  the index still lists.
- The run's summary prints the index URL, the public key and the
  `pal://registry/add?url=…&key=…` link, for a README.
- **Yanking** a build: `pal-pack index <an empty dir> --merge index.json
  --yank name@hash`, then sign and deploy that index as above.
- **Rotating the key:**
  1. Run with `next-key` set to the new public key: the index, signed by
     the old key, announces it.
  2. Once users have had time to fetch that index (apps check every 6
     hours), set `key` to the new secret, `public-key` to the new key then
     the old one (`RWQnew… RWQold…`), and drop `next-key`. That run finds
     the live index signed by the old key and re-signs it and every build
     in it with the new one; the index's `key` becomes the new key and its
     `next_key` is cleared.
  3. Then `public-key` is the new key alone.

Users add it with `pal registry add <url> --key <key>`, or with a
`pal://registry/add?url=<url>&key=<key>` link (both values URL-encoded:
a key's `+` and `/` are `%2B` and `%2F`), where `<url>` is the index's and
`<key>` the public key. The key is then checked against the index's
signature and pinned. Give it: without one, `add` falls back to the key the
index itself announces (`key`), which proves only that whoever serves the
index holds its secret, not that the index is the one you meant.
`pal registry add <url>` and a link with `url` alone still work that way.

## Calls the app makes to pal.cagdas.io

Every request carries `User-Agent: pal/<version> (<os>; <arch>)`, and
`X-Pal-Install: <id>` unless usage sharing is off (`docs/usage.md`).

| Call | What for |
|---|---|
| `GET /registry/<channel>/index.json[.minisig]` | the index |
| `GET /registry/pkg/…` | packages |
| `GET /update/<target>/<arch>/<version>` | the app updater; answers GitHub's `latest.json` |
| `POST /api/events` | usage events (`docs/usage.md`) |

Released apps before 0.8 call `GET /api/extensions` and
`GET /api/extensions/<name>` (`{spec}`); those stay as they are, with `spec`
pinned to the latest release tag.
