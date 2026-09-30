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
- `make test` before every push (it mirrors CI); CI runs on Linux too.

## Extensions are distributed, not just bundled

- **Bundled vs registry is a decision for every extension.**
  `extensions/bundled.txt` lists the extensions built into the app (they
  need no account or setup and a Mac user expects them on day one, or a
  core feature relies on them); `extensions/registry-only.txt` lists the
  rest, which ship only through pal's registry. Every extension directory
  must be in exactly one of the two, and a test fails otherwise, so a new
  extension gets a deliberate call: say which list and why when adding it.
  Moving one is a one-line change; a name that leaves the bundle is
  installed by itself on machines that use it (the migration in
  `app/src-tauri/src/store.rs`).
- **How a change reaches users.** A green push to main publishes every
  changed extension to the **edge** index (`.github/workflows/extensions.yml`).
  Users follow **stable**: `make ext-release [NAMES="a b"]` promotes edge to
  stable, and every app release promotes everything built at its tag.
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

## Shipping an extension change

Beyond the code, unasked:
- its `pal.json` store block (tagline, description, features: plain,
  specific) and palette `title`s (registry listings and root search match on
  them; a test requires them);
- its icon: a product's real logo only when the extension is that product
  (`bun app/scripts/brand-icons.ts`, Simple Icons; `--check` exits 1 when a
  manifest drifted),
  pal's own tools keep glyph tiles;
- store screenshots (`extensions/<ext>/fixture.ts`, `make shots EXT=<ext>`,
  look at every PNG in both themes), committing the regenerated
  `app/src/gallery/shots/*.json` with them; when a bar item's look changed,
  also `PAL_UPDATE_PARITY=1 cargo test -p pal parity` and `npx vitest run
  bar-parity` in app/, or CI fails on the stale strip snapshot;
- pal-site: `scripts/subset-font.py ../pal` when a manifest gains a Nerd
  glyph, then its `./deploy.sh`; the landing's hand-picked lists
  (`showcase`, `featured`, `apiShots`, `popovers`, `barStrip` in
  `web/server.go`) when the extension deserves a slot.

## Usage data

`docs/usage.md` is a promise: anonymous, first-party only, off with one
switch. Anything new that is counted is listed there in the same change;
never send query text, item names or anything about third-party registries.
