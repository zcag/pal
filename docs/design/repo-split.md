# Splitting the extensions out of pal

Design spec, 2026-10-04. pal's repo holds the launcher; the extensions move
to `zcag/pal-extensions` and the games to `zcag/pal-games`. Status:
built 2026-10-05 (the two repos made with
`git filter-repo`, waiting to be pushed); it came after the accounts work
(`accounts.md`), which touches every game. Where the build differs from
the plan below: each repo's screenshot fixtures are in `test/shots/`;
`bundled.txt` is `app/bundled.txt`; the signer builds every
extension itself; and publishing is a poll, not a hand-over: pal's
`extensions.yml` reads each repo's main every 15 minutes, builds a green
head it has not taken (staged at `extensions/<name>`, so an unchanged
extension keeps its hash) and publishes the changed builds. The extension
repos hold no token, upload nothing and dispatch nothing; steps 1 to 3 of
"Publishing: one signer" below are what was planned before that.

## Why

pal's history and CI are mostly extension and game work (`highway:` alone
was 29 commits in the month to 2026-10-04; `extensions/highway` is 122 MB of
the 260 MB `extensions/`). The goal is a lean pal repo whose log, changelog
and CI are the launcher's, with extension and game work in their own places.

## Layout

| repo | holds |
| --- | --- |
| `zcag/pal` | app, core, host, SDK, surface kit, CLI, docs, `bundled.txt` (which names ship in the app), the build, test and screenshot tools, the registry signer |
| `zcag/pal-extensions` | every extension that is not a game, the bundled ones included, the Games shelf (`games`) included; their tests, fixtures, screenshots |
| `zcag/pal-games` | 2048, blackjack, crossword, highway, minesweeper, night-parade, snake, solitaire, sudoku, typing, vortex, wordle, yahtzee; their tests, fixtures, screenshots |

Both new repos are public and keep their history (`git filter-repo` on the
paths: the extension's directory, its `host/test/extensions/<name>*.test.ts`
and fixtures, its `app/src/gallery/shots/<name>*.json`). Each extension
repo's layout is flat: `<name>/` at the root, `test/` for its tests,
`registry-only.txt` there; `bundled.txt` stays in pal, since bundling is an
app decision.

## READMEs

Each of the three is the front door of its repo, good and descriptive:

- **pal**: what pal is, then a clear section pointing to the two other
  repos (what lives where, how an extension or a game reaches users through
  the registry, where to send a change).
- **pal-extensions**: what is there (bundled ones marked), how to run and
  test one against a pal checkout, how a change ships (edge, stable), how
  to write a new one (links to pal's docs).
- **pal-games**: the games with a line each and their play.cagdas.io link,
  said plainly that they are almost entirely written by Claude, and that
  most are reworks or clones of classic games (Snake II, Minesweeper,
  Solitaire, Super Hexagon's Vortex, ...); then how to run, test and ship
  one, accounts, sync rules and leaderboards.

## How a bundled extension reaches the app

Today `app/scripts/build-extensions.sh` copies `extensions/<name>` for each
name in `bundled.txt`. After the split it takes the **stable registry
build** of each name instead: the package the registry serves, verified
against the signed index, unpacked into `resources/extensions/<name>`.
`release.yml`'s `manifest` job already requires the bundled hash to equal the
registry's; now it holds by construction. A bundled extension's fix still
reaches users through the registry without an app release, as today.

Development uses checkouts: the app in debug builds, the host harness and the
screenshot tool look for `../pal-extensions` and `../pal-games` beside the
pal checkout (overridable with `PAL_EXTENSION_REPOS`, a path list), the way
debug builds read `extensions/` today.

## Publishing: one signer

The index is signed as a whole in pal's CI and the site never signs
(`pal-site/hosting/registry.go` `PutIndex`), so two repos cannot each write
the index: they would overwrite each other, and the key would sit in three
repos. Instead:

1. An extension repo's CI, on a green push to main, builds the changed
   extensions with `pal-pack` (from the pal checkout it tests against),
   uploads the packages (`PUT` package, content-addressed, safe in
   parallel), and dispatches pal's `extensions.yml` with
   `repository_dispatch` `{repo, ref, builds: [name@hash]}`.
2. pal's `extensions.yml`, the only holder of the signing key and still one
   run at a time (its `registry` concurrency group), downloads each named
   package, checks its tree hash and that it came from that repo's ref,
   adds it to the edge index, signs and publishes. Promote, yank and
   reindex stay where they are (`make ext-release` in pal).
3. A per-repo token that may only dispatch and upload packages: a leaked one
   can push unsigned bytes nobody installs, never a signed index.

## Testing

- An extension repo's CI checks out `zcag/pal` at `main` into `.pal/`, links
  the SDK and the host from it, and runs its own tests through the host
  harness (`make test-ext` moves into each repo as `make test`). The
  ext-mode of `ci-scope.ts` becomes the whole of their CI.
- pal's CI runs its own tests plus, as a check that a core change does not
  break them, the bundled extensions' tests from a checkout of
  `pal-extensions` at main.
- `PROTOCOL` stays in pal; an extension repo builds with the SDK of the pal
  it checked out, which stamps the package as today.

## Changelogs

- pal's `docs/changelog.md` is the app's alone.
- Each extension repo keeps the `<name>: what changed` commit subject rule,
  which is what the store's per-build notes and pal-site's extension pages
  read; pal-site's sync reads the three repos instead of one.

## What else moves

- pal-site: its repo sync (play files before a registry build exists, docs,
  changelog), `scripts/subset-font.py` (manifest glyphs) and the landing's
  hand-picked lists read the new repos.
- `app/src/gallery`: reads manifests and shots from the checkouts.
- The `CLAUDE.md` rules on extensions move with them; pal's keeps the
  bundled/registry decision and the protocol rules.

## Order of work

1. pal's `extensions.yml`: accept dispatched builds from other repos; the
   upload-only token.
2. `build-extensions.sh` from registry builds; dev roots from the sibling
   checkouts.
3. `pal-games` first (games touch only the SDK and the kit): filter-repo,
   CI, a publish through the new path, then delete them from pal.
4. `pal-extensions` the same way.
5. pal-site reading the new repos; docs.
