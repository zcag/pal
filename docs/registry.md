# Registries and packages

The formats every pal app, registry and publisher agrees on. This page is the
contract; the design and its reasons are in `design/distribution.md`.

Everything here is version 1. A reader refuses what it does not understand
(`format` above 1, an unknown statement prefix) rather than guessing.

## Protocol

`PROTOCOL` is an integer in `sdk/src/protocol.ts` (and `pal_core::registry::PROTOCOL`,
kept equal by a test). It goes up when a change to the SDK or the host breaks
extensions built before it. An app runs packages whose `protocol` is in
`[PROTOCOL_MIN, PROTOCOL]`; both numbers are in the same two places.

## Packages

A package is one extension, built: the directory `pal-pack` writes.

```
weather/
  pal.json        the manifest, with "protocol": N stamped in
  index.js        bun build of index.ts, @zcag/pal external
  *.js            chunks (--splitting)
  surface/        a game's page, when it has one
  *.ts            the sources a surface imports, when it has one
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
  "next_key": null,
  "extensions": [
    {
      "name": "weather",
      "listing": {
        "title": "Weather", "description": "…", "tagline": "…", "category": "system",
        "keywords": ["forecast"], "icon": { "tile": { "glyph": "…", "bg": "sky" } },
        "author": "pal", "platforms": ["macos", "linux"], "play": false,
        "palettes": [{ "id": "weather", "title": "Weather", "kind": "list" }],
        "screenshots": [{ "url": "https://…/1-list.png", "caption": "…" }],
        "requires": [], "suggests": []
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
  anything else; `manifest` is the full `pal.json` of that build.
- `builds`: newest `seq` first. A registry keeps at least the newest build
  per `protocol` and the one before it (the rollback target).
- `yanked: true`: never offered; an installed yanked build is replaced by the
  newest good one.
- `url` and `manifest` may point anywhere.
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

`pal-pack` ships in `@zcag/pal`:

```sh
bunx pal-pack build extensions/*     # → dist/<name>/ and dist/<name>.tar.gz, prints each entry
bunx pal-pack statements dist        # → dist/<name>.statement, to sign
minisign -S -s key -m dist/*.statement
bunx pal-pack index dist --name acme --base https://acme.github.io/pal --out site
minisign -S -s key -m site/index.json
```

or the Action, which does all of it and deploys to GitHub Pages:

```yaml
- uses: zcag/pal/.github/actions/registry@main
  with:
    name: acme
    extensions: extensions/*
    key: ${{ secrets.PAL_REGISTRY_KEY }}
```

Users add it with `pal registry add <url>` or a `pal://registry/add?url=<url>`
link; the key shown then is pinned.

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
