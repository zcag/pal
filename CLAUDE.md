# pal: working rules

Read the docs before changing an area: `docs/extensions.md` (the SDK and
manifest), `docs/registry.md` (package and index formats: the contract),
`docs/design/distribution.md` (how extensions reach machines),
`docs/releasing.md`, `host/test/README.md` (test rules), and the matching
section of `notes/decisions.md`.

## Principles

- **UI first.** Every setting and operation is done in Settings or the
  panel; `config.toml` mirrors that state for backup, restore and
  versioning and is never the only way to do something. A new option gets a
  UI control in the same change.
- Quiet, plain words over jargon; animations are fine, never add
  `prefers-reduced-motion` handling.
- `make test` before every push (it mirrors CI); CI runs on Linux too. It
  runs the host's contract tests over the extension repos' checkouts and
  the bundled extensions' tests from pal-extensions (CI checks out both
  repos at main), so a host or SDK change that breaks one is caught here.

## The extension repos

The extensions live in `zcag/pal-extensions`, the games in
`zcag/pal-games`; extension and game changes are made there, and their
CLAUDE.md has the rules that moved with them (the store block, the icon,
the screenshots, edge and stable). In development they are the checkouts
beside this one, `../pal-extensions` and `../pal-games`
(`PAL_EXTENSION_REPOS`, a path list, overrides;
`app/scripts/extension-repos.mjs` and `pal_core::extensions::dev` read
them): a debug app loads them, the host harness tests them, the gallery
and `make shots` read their manifests and fixtures. Each repo tests
against a pal checkout in its `.pal/` (`make test` there is its CI).

## Extensions are distributed, not just bundled

- **Bundled vs registry is a decision for every extension.**
  `app/bundled.txt` lists the extensions built into the app (they need no
  account or setup and a Mac user expects them on day one, or a core
  feature relies on them); each extension repo's `registry-only.txt` lists
  the rest of its own, which ship only through pal's registry. Every
  extension must be in exactly one of the two, and a test fails otherwise
  (`host/test/pack.test.ts`, run over each repo), so a new extension gets a
  deliberate call: say which list and why when adding it. An app build
  bundles each name's stable registry build (`app/scripts/build-extensions.sh`).
  Moving one is a one-line change; a name that leaves the bundle is
  installed by itself on machines that use it (the migration in
  `app/src-tauri/src/store.rs`).
- **How a change reaches users.** A green push to an extension repo's main
  hands every changed build to `.github/workflows/extensions.yml` here (a
  `publish-builds` repository_dispatch, sent by
  `.github/actions/publish-extensions`), which builds it again, signs it and
  adds it to the **edge** index; it is the only signer.
  Users follow **stable**: `make ext-release [NAMES="a b"]` promotes edge to
  stable, and every app release promotes everything on edge first, then
  bundles stable's builds.
  Promoting is a release decision, like cutting an app release: only after
  the change was tried. Auto-update is on by default, so a promoted build
  reaches everyone within hours; a bad one is pulled with the `yank`
  dispatch input (docs/releasing.md).
- **Compatibility.** `PROTOCOL` / `PROTOCOL_MIN` in `sdk/src/protocol.ts`
  (and `pal_core::registry`, kept equal by a test) gate which packages an app
  runs. Bump `PROTOCOL` for any SDK or host change that breaks extensions
  built before it, and for one that extensions built after it rely on (a
  new SDK export, a new `Effect` field: the SDK is external to a package);
  a build stamped with a protocol newer than the latest released app is
  published but not offered until that app is out.
- **Identity and order.** A build is its tree hash (`pal-tree-v1`), ordered
  by `seq` (the source commit's time). The manifest's `version` is for
  humans only; nothing compares it.
- **One path for everything.** Installs, updates, removal, rollback and the
  update check live in the core (`core/src/extensions.rs`, `updates.rs`,
  `registry.rs`, `manage.rs`) and the app's store service
  (`app/src-tauri/src/store.rs`). Settings, the Store palette, Games, root
  search, links and the CLI all call those; never compare versions or
  fetch the registry anywhere else.
- **No host restarts** for extension changes: swap the directory, send the
  host `reload {extension}`, await its answer.
- **Cross-extension dependencies** go in the manifest (`requires`,
  `suggests`); a push, link or hotkey into a missing extension must offer to
  install it, never fail silently.
- **Formats are public.** Anything an app or a third party relies on
  (package, index, endpoints, what usage data is sent) is documented in the
  public docs; pal.cagdas.io's code (`~/proj/pal-site`, private) only hosts
  it. Changing a format means changing `docs/registry.md` first.

## What stays here when an extension changes

- The bar's strip parity snapshot (`app/src/ui/__tests__/bar-parity.json`)
  keeps the items it draws, so an extension repo never breaks it; when a
  bar item's look changed there, refresh it here with the checkouts beside
  this one (`PAL_UPDATE_PARITY=1 cargo test -p pal parity`, then
  `npx vitest run bar-parity` in app/) and commit it. A renderer change
  here needs the same.
- Promoting (`make ext-release`) and yanking (the `yank` dispatch input)
  are done here, for every repo's builds.
- pal-site (`~/proj/pal-site`): its `scripts/subset-font.py` when a
  manifest gains a Nerd glyph, the landing's hand-picked lists; its
  `./deploy.sh` asks first.

## Usage data

`docs/usage.md` is a promise: anonymous, first-party only, off with one
switch. Anything new that is counted is listed there in the same change;
never send query text, item names or anything about third-party registries.
