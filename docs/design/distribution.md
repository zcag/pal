# Extension distribution

Design spec, 2026-09-29. How extensions reach a machine, stay current, and get
found:
- built and signed packages;
- registries that anyone can run;
- a small bundled core;
- update detection that never lies;
- uninstalled extensions visible where people look;
- usage counts.

Status: decided, being built. The exact formats are in `../registry.md`, the
usage payload in `../usage.md`. Reviewed against the code and the site
the same day; the evidence pointers are from that review.

## Where it stands

- **Everything is bundled.** Every `extensions/*` ships in the app
  (`app/scripts/build-extensions.sh:45`): 80 extensions, 8.8 MB of the 89 MB
  app. The SDK is inlined into each one (`build-extensions.sh:17-22`).
- **Roots.** Extensions load from three places, in this order:
  - bundled (the repo in debug builds and repo layouts, `app/src-tauri/src/host.rs:84-90`);
  - `<data dir>/extensions`;
  - `general.extension_dirs`.

  A later root wins a name clash (`host/src/host.ts:73-83`).
- **Remote install.** A bare name is resolved through
  `GET pal.cagdas.io/api/extensions/<name>` → `{spec}`
  (`core/src/extensions.rs:31`). The **source** is fetched from GitHub `main`
  and `bun install` runs on the user's machine (`extensions.rs:372-435, 521`).
  Install, update and remove each restart the whole host
  (`app/src-tauri/src/settings.rs:1137,1148,1158`).
- **Registry.** The one registry, `pal-site/registry`, lists only bundled
  extensions. A bundled row in the Store can only open its page
  (`extensions/store/store.ts:162`).

What is wrong:
1. A bundled extension gets a fix only through an app release.
2. An install builds `main` against whatever SDK the user's app shipped, and
   nothing checks compatibility.
3. Versions mean nothing (75 manifests say `0.1.0`). Two checks decide "update
   available", and they disagree:
   - Settings compares the repo HEAD sha (`extensions.rs:357-370`), so any commit
     flags every store install.
   - The Store compares version strings (`store.ts:127`).
4. `pal install calc` silently shadows the bundled calc with `main`.
5. Everyone gets all 80 extensions and 193 palettes, and there is no
   extension-wide off switch.

## Principles

- **UI first.** Every operation here is done in the panel or Settings: browse,
  install, update, remove, disable, add or remove a registry, trust,
  auto-update. `config.toml` mirrors the resulting state for backup, restore
  and versioning. It is never the only way to do something.
- **One path.** Our extensions and anyone else's use the same package format,
  index format, install and update code. Ours is only the first registry.
- **Seen before installed.** An uninstalled extension shows up wherever an
  installed one would have been looked for.
- **Nothing silently inert.** A hotkey, deep link, bar item, state, feature or
  cross-extension push that points at an extension that is missing or disabled
  says so and offers the fix. It never fails quietly.
- **Public contract, private hosting.** The pal repo is public and pal-site is
  private.
  - Everything an app or a third party relies on is in the pal repo: the
    package and index formats, the packer, the GitHub Action, the endpoints the
    app calls, and what usage data is sent.
  - The site's service, database, stats and pages stay private.
  - Our index is built by the same public packer in pal's CI. The site only
    serves it and never holds a signing key.

## Packages

A package is the built directory of one extension:
- `index.js`;
- `pal.json`;
- `surface/`, with the sibling `*.ts` files a surface imports
  (`build-extensions.sh:49-54`).

The SDK is **not** inlined. It is built with `--external @zcag/pal`, and the
host links the app's SDK into every root, bundled included (as it already does
for user roots, `host.ts:276-300`). So an SDK change does not change 80
packages. Always built from the repo root, so the source-path comments in the
output stay stable. (`bun build` twice gives byte-identical output; checked on
calc.)

**Identity and order are separate fields:**

- `hash`: sha256 of the unpacked tree, normalised:
  - sorted paths;
  - file bytes and the executable bit only;
  - `.pal-install.json` and dotfiles excluded.

  A bundled copy and a store copy of the same build have the same hash. The
  build writes the bundled one's hash to `.pal-build.json` beside its
  manifest.
- `seq`: the committer time of the source commit (unix seconds), the same in
  every workflow that builds it. "Newer"
  always means a higher `seq`; the hash only says whether two builds are the
  same.
- `commit`: the source commit, for humans and bug reports.
- `protocol`: the SDK protocol the build targets.

**Protocol.** `sdk/src/protocol.ts` gains an integer `PROTOCOL`, bumped on a
change that breaks extensions. That replaces "bumps the minor" in its header
comment, which gives nothing to compare. The host reports it in `hello`. The
app supports a closed range `[PROTOCOL_MIN, PROTOCOL]`.
- The host's discovery skips a package outside that range and falls back to the
  same name in an earlier root. An old store override never loads on an app
  that can't run it.
- Each app release that bumps `PROTOCOL` also publishes a rebuild of every
  first-party package.
- `host.ts:31`'s dead `VERSION` goes.

**Packer.** One implementation, `pal-pack`, a bun script shipped inside
`@zcag/pal`, which is published to npm on each release. It is the only thing
that builds and hashes packages:
- `build-extensions.sh` calls it;
- our CI calls it;
- third parties call it.

The core only verifies: it hashes the unpacked tree in Rust, and a conformance
test keeps both hash implementations equal. The tarball is written with
normalised modes, owners and mtimes, and gzip without a name or time.

**Signing.** Covers the index and each build.
- The whole index is signed (`index.json.minisig`).
- Each build is signed over `name|hash|seq|protocol`, so a signed package
  cannot be relisted under another name or order.
- On install the core checks the signature, then the hash, then that the
  unpacked `pal.json` `name` matches the entry.

**Keys.** Ours is a new **extension key**, not the updater key. Today the
updater key is exposed only on tag runs (`release.yml:132`), and package
builds run `bun install`, which runs dependency scripts.
- Build and sign are separate jobs. The sign job installs nothing and reads the
  key from a protected GitHub Environment.
- A backup lives in `~/Sync/.secrets/pal/`.
- The app ships a list of trusted keys for our registry.
- Any registry can rotate its key: the index carries a `next_key` signed by the
  current key, and the app moves its pin when it sees one.
- Verification uses `minisign-verify` (already in `Cargo.lock`).

## Registries

A registry is **a signed static index at a URL**, with packages anywhere. Our
URL is `pal.cagdas.io/registry/index.json`; a third party's can be a GitHub
Pages site.

```json
{
  "format": 1,
  "name": "pal",
  "generated_at": "2026-09-29T12:00:00Z",
  "next_key": null,
  "extensions": [
    {
      "name": "weather",
      "listing": { "title": "…", "tagline": "…", "category": "…", "keywords": [], "icon": {},
                   "palettes": [{ "id": "weather", "title": "Weather", "kind": "list" }],
                   "platforms": ["macos", "linux"], "screenshots": ["https://…/1.png"] },
      "builds": [
        { "hash": "…", "seq": 812, "protocol": 3, "commit": "…",
          "url": "https://…/weather-<hash>.tar.gz", "manifest": "https://…/weather-<hash>.json",
          "sig": "…", "yanked": false }
      ]
    }
  ]
}
```

- **The index is slim.** `listing` holds what the Store, root search and Games
  need. The full `pal.json` is a separate file per build. All 80 full manifests
  total about 690 KB, too much to fetch on every Store open.
- **Builds kept.** `builds` holds the newest build per protocol plus the one
  before it, which is the rollback target and the retention rule. Tarballs no
  longer listed are pruned after 30 days.
- **Yanking.** `yanked` pulls a bad build: it is never offered, and an install
  of it is rolled back to the newest good build.
- **URLs.** `url` may point anywhere, so a registry can be a curated list of
  other people's packages. Screenshot URLs are absolute.

**Adding one.** All entry points lead to the same confirm:
- a `pal://registry/add?url=…` link, for a README button;
- the Store palette's Registries section;
- Settings › Extensions.

The confirm shows the URL, how many extensions it lists, its key (pinned
then), and that its extensions update automatically unless that is turned off
for it. An index signed by a key that is neither the pin nor a signed
`next_key` is refused and shown as a problem on that registry. Ours is always
present, first, and cannot be removed.

**Removing one.** Its extensions stay installed and keep working, but are marked
*no longer updated*. They get one Needs you row per extension, offering "find
in another registry" (the same name, re-pinned to that registry) or Remove.

**Rules:**
- **Names stay flat; a clash is refused.** Config tables, palette ids,
  frecency, links and storage are keyed by name, so `acme/weather` would
  ripple through all of them.
  - Two registries listing `weather` both show, each with its registry.
    Installing the second while the first is installed is refused with a
    message.
  - A name inside a user's `extension_dirs` beats any registry (it is the last
    root). It is shown as local, and the registry copy is not offered.
  - The name of a core (bundled) extension is reserved for our registry.
- **An extension updates only from the registry it came from.** The install
  record gains `registry`, `hash`, `seq` and `protocol`.
- **Bare names.** `pal install weather` searches ours first, then the rest in
  config order, and says which registry it used.
- **Platforms.** Everything honours `listing.platforms`: the Store, root
  search, Games, install and the migration. Three extensions are macOS-only
  today.
- The `community.json` ingest in pal-site goes; community extensions live in
  their own registries.

## Publishing (ours)

**`extensions.yml`** in pal. It runs on a green `ci` on main when
`extensions/**`, `sdk/src/**`, `bun.lock` or `app/scripts/fetch-bun.sh`
changed, and on `workflow_dispatch`.
1. **build**: `pal-pack` builds every extension and compares each hash with
   the live index. Only changed ones go on.
2. **sign**: isolated, holds the extension key.
3. **publish**: uploads the packages and the signed index to the site through
   an authenticated `PUT /api/registry/publish`. The site swaps them in at
   once, with no hourly sync.

**Publishing is a decision, like an app release.** A push to main builds, and
the result goes to the **edge** index (`index.edge.json`). Only a
`make ext-release [NAMES]` (a dispatch) promotes it to the stable index that
apps use. So a push never reaches every user by itself; this follows the same
"his go-ahead" rule as app releases. My own machines can follow edge (a
per-registry `channel = "edge"`).

**App releases.** `release.yml` promotes every changed first-party build at the
tag, so the registry never has a build older than the app's bundled copy. The
`manifest` job fails if a bundled hash differs from the registry build for the
same commit.

**Protocol gate.** A build whose `protocol` is above the latest released app's
is published but not offered until that app release is out.

## Hosting (site side)

- **Paths.** Packages live at `pal.cagdas.io/registry/pkg/<name>/<hash>.tar.gz`.
  They are not GitHub release assets, because a new non-prerelease release
  becomes "latest" and breaks the updater's `releases/latest/download/latest.json`
  and the site's Download buttons.
- **HTTP.** The index is served with an `ETag` (today's API sends none,
  `pal-site/web/server.go:596-624`) and gzip via Caddy. There is no CDN (grey
  cloud); nothing assumes one.
- **Apps already released keep working unchanged.**
  - `/api/extensions` and `/api/extensions/<name>` are frozen in today's shape,
    with `version` from `pal.json`.
  - `spec` is pinned to the latest release tag (`github:zcag/pal/extensions/<n>@v0.7.x`)
    instead of main, so old apps stop installing untested `main`.
  - `extensions/` stays in the pal repo.
  - New apps never call these endpoints.
  - New apps send a real `User-Agent: pal/<version>`; today's is hard-coded
    `pal/0.1` (`extensions.rs:30`).
- **Site pages.** `/extensions/<name>` shows the registry, platforms, protocol
  and an "Open in pal" button (`pal://install/<name>`) with the command as the
  fallback. A web page can't see what is installed, and the page says so.
  - The bundled/community split and "installing puts an editable copy ahead of
    the bundled one" (`extension.html:80,89`) change to core / pal registry.
  - `DeepLink`/`InstallCmd` stop emitting `github:` specs (`server.go:368-372`,
    `registry/sync.go:30`).
- **palplay** serves `store.play` games from the published package, not main's
  source. It is our registry's games only.

## Third-party publishing

`@zcag/pal` on npm gives authors the types and `pal-pack`. A reusable GitHub
Action in the pal repo, `zcag/pal/.github/actions/registry`:
1. packs the author's extensions;
2. signs them with their key (a repo secret);
3. writes the index;
4. deploys to Pages.

It needs `pages: write` and `id-token: write`. On first run it prints the
public key and the `pal://registry/add` link. Source installs
(`pal install --from github:…`, a directory) remain for development. They are
marked *source* everywhere and never update by themselves.

## Installing, updating, removing (app side)

**All in the core.** Install, update, remove, rollback, the update check and
the index cache all live there. The CLI, Settings, the Store palette, root
search and Games all call it; none of them compares anything themselves.

**Locking.** Store writes take an `flock` on the store dir, because
`pal install` runs in the CLI's own process next to the app (`cli.rs:513-560`).
Operations queue per name. Staging leftovers are cleaned on start. The staging
names `old-<name>-<pid>` collide within one process today; those go.

**No host restart.** The host already hot-loads on a directory rename
(`host.ts:315-340`). The core swaps the directory, sends `reload {extension}`,
and waits for `extension/loaded` or `extension/error` for that name and root
before reporting or pushing.
- Multi-select installs are one queue, not one restart each.
- Only a change to `extension_dirs` restarts the host, because roots are argv.

**Rollback.** The previous generation is kept in
`<data dir>/extensions-previous/<name>`, outside every root.
- It rolls back when the new build gets `extension/error` at load, and only if
  the previous one loaded in this session. For a `multi` extension that means
  every instance failed.
- A runtime `list` error is not a load failure.
- A rollback marks that build as bad locally (it is not offered again), shows
  in Needs you with the error, and is counted (see Usage).

**Deferred apply.** An update to an extension whose view or surface is open
applies when it closes, so files are never swapped under a running game.

**Removing keeps data.** Config, storage, cache, frecency and keychain entries
stay, so a reinstall brings back the setup and game progress. Remove also offers
"Remove and forget", which deletes them the way removing an instance does
(`settings.rs:1238-1283`).

**Disabling.**
- The host's discovery takes the disabled set from the core, with a
  `disabled/changed` notification.
- A disabled extension does not load, and its bar items, palette hotkeys and
  features show as off.
- It relates to `[instances.<name>] enabled` like this: disabling the extension
  parks every instance, and the instance switch still parks one.
- A disabled name that isn't installed is kept, and does nothing.

**Dev layouts.** In a debug build or a repo layout (hornet's dev runs, marko
running from `~/proj/pali`), the repo root wins for every name it contains,
over the store. First-party auto-update skips those names. Edits in the repo
are never shadowed by a registry build.

## The installed set in config

A new top-level `[store]` table. `[extensions]` can't hold it, because
`Config.extensions` is a map of per-extension settings tables
(`core/src/config/mod.rs:73`).

```toml
[store]
auto_update = true
installed = ["weather", "spotify", "acme:todo"]   # registry-qualified when not ours
disabled = ["hue"]

[[store.registries]]
name = "acme"
url = "https://acme.github.io/pal/index.json"
key = "RWQ…"
auto_update = true                                # overrides the global switch for this registry
channel = "stable"
```

- **What is listed.** pal writes these lists from the UI. `installed` holds
  registry installs only: bundled core extensions, `extension_dirs` and source
  installs are never listed. `installed` and `disabled` take extension names;
  instances stay in `[instances]`.
- **Reconcile on start.** A listed extension that is missing is installed in
  the background. When it can't be (offline, gone from the registry), it shows
  in Needs you and is retried, never dropped from the list. An unlisted
  directory in the store is left alone and shown as *not in config* with an
  "Add" fix. It is not added silently, because hand-made extensions such as
  `tan` must not end up in a list that another machine would try to install
  from a registry.
- Added to `Config`, the JSON schema, the config template and `unknown_keys`.

## Update detection

One check, in the core. Settings, the Store palette, the bar badge,
`pal update` and `pal list` all read its result. The Settings GitHub-SHA check
(`extensions.rs:357`, `settings.rs:1166`) and the Store's `newer()`/`standing`
(`store.ts:106-128`) are deleted.

- **Compared.** For each installed registry extension: the newest non-yanked
  build in its registry and channel whose `protocol` the app supports, on this
  platform, not locally marked bad. It is an update when its `seq` is higher
  and its `hash` differs.
  - A bundled core extension compares its `.pal-build.json` with our registry
    the same way.
  - Equal hashes are never an update, whatever the seq.
- **Fetching.**
  - Each registry's index is fetched on start, every 6 hours, and whenever the
    Store or Settings › Extensions opens.
  - Conditional requests (`If-None-Match`).
  - The core owns the cache at `<cache dir>/pal/registries/<name>.json`, not in
    extension storage (which is capped, `storage.rs:7`), and falls back to it
    when stale.
  - An index with an older `generated_at` than the cached one is ignored, so a
    replay can't roll anything back. It is signed, so that date can be trusted.
- **Failures are visible.** Each registry shows when it was last checked and
  why the last check failed ("acme: unreachable since 14:02"). A failed check
  never reads as "up to date".
- **Too new.**
  - When the newest build needs a newer protocol, the row says "needs a newer
    pal" with the version.
  - On macOS that leads to the app update.
  - On a Linux `.deb`, which can't self-update (`updater.rs:150`), it shows the
    apt/dpkg command.
- **Applying.** Automatic by default, for every registry: Settings ›
  Extensions has "Update extensions automatically" (on), mirrored as
  `[store] auto_update`, and each registry's row can override it
  (`auto_update`). Trust was given when the registry was added and every
  build is signed with its pinned key, so a third party's updates are held to
  the same bar as ours. Off means a Needs you row per update. Deferred while
  the extension is shown, and rolled back on a failed load (above).
- **After an app update**: a store copy whose hash equals the new bundled one,
  or whose seq is lower, is deleted.
- **Tests.** A fixture registry served by the host tests covers:
  - behind, equal hash, and lower seq with a different hash;
  - an unsupported protocol and a yanked build;
  - wrong platform, unreachable, a stale (replayed) index;
  - a wrong key and a rotated key;
  - a failed load followed by rollback;
  - deferred apply;
  - two concurrent installs;
  - `pal install` from the CLI while the app auto-updates.

## Dependencies between extensions

Today these break when the target isn't installed:
- clipboard → snippets, diff, colors, files (`clipboard/index.ts:293-304`,
  `now.ts:139-199`);
- generate → colors;
- power → processes;
- stats → processes, network;
- turkish → translate;
- games → every `fun` extension;
- core features: expansion → snippets, switcher → windows, clipboard →
  clipboard (`core/features/*.json`).

- `pal.json` gains `requires` (it doesn't load without them; installing it
  installs them) and `suggests` (actions that use them hide when they are
  missing).
- A push into a missing extension shows "X isn't installed · Install" instead
  of an error. The same goes for deep links (`deeplink.rs:617,816`) when an
  index knows the name.
- Every extension a core feature depends on is in the bundled core.

## Missing and leftover references

Palette hotkeys (`hotkey.rs:406`), bar items, aliases, `[states]` expressions
and fallbacks can point at an extension that isn't installed or is disabled.
- Settings lists each one under Needs you as *points at X, not installed*, with
  Install, or Forget to drop the references.
- A hotkey or link used meanwhile shows the same message in the HUD.
- A state referencing a missing extension is *unknown*, not false.
- Config tables for extensions that aren't installed show in Settings ›
  Extensions under *Left over*, with Install and Forget; today there is no row
  for them at all.

## What is bundled

Decided 2026-09-30 (option B of three): the 33 extensions that work with no
account or setup and that a Mac user expects on day one. They are the first
run without network, and they include every core feature's dependency.

- **Launcher**: apps, files, calc, clipboard, snippets, windows,
  window-management, system, quicklinks, emoji.
- **Plumbing**:
  - store and games, which are the way to everything else;
  - states, for `[states]` and bar hiding;
  - scripts, which the v1 migration writes into (`firstrun.rs:13`).
- **Day one**: bookmarks, browser-tabs, downloads, audio, bluetooth, displays,
  wifi, network, media, screenshots, timer, processes, power, menu-bar,
  shortcuts, unicode, generate, colors, shell.

The other 47 are in our registry only:
- **Games**: 2048, blackjack, crossword, minesweeper, snake, solitaire,
  sudoku, typing, wordle, yahtzee.
- **An account, a server or another app**: gmail, github, slack, whatsapp,
  google, youtube, gifs, translate, calendar, spotify, obsidian, onepassword,
  otp, grafana, home-assistant, hue, immich, tela, odak, theater.
- **Developer**: docker, ssh, make, services, sessions, diff.
- **Other**: stats, weather, maps, speedtest, space, privacy, images, icons,
  flashcards, turkish, dpi.

The list lives in a file (`extensions/bundled.txt`) that the build reads, not
in the loader, so moving one across is a one-line change. The usage counts
will settle the borderline ones (stats, weather, ssh).

**Built in comes from the root, not `repo: "bundled"`.** All 80 manifests say
`repo: "bundled"`, and Settings and the Overview branch on it
(`Settings.tsx:150-168`, `SettingsExtensions.tsx:306`,
`SettingsOverview.tsx:139`). That field is removed; whether an extension is
bundled is read from which root it loaded from.

## Migration

It runs in two releases, because the second one no longer has the manifests or
code of the extensions it drops.

1. **The last full-bundle release** writes `[store] installed` from a
   manifest-free "in use" test in the core. An extension is in use when:
   - a palette of it was opened here: `<data dir>/extensions-used.json`,
     a local record of opens (name and last time) kept whether usage sharing
     is on or off and never sent, written at the same places palette opens
     are counted;
   - or any of these mention it: `[extensions.<n>]`, `[instances.<n>*]`,
     `[palettes."<n>"|"<n>-*"]` (a hotkey, an alias, any setting),
     `bar.items."<n>/*"`, the sidebar palette, a fallback order the user
     set (the default order names calc, files and quicklinks for everyone),
     `[states]` expressions, frecency.

   A `storage/<n>.json` file does not count: extensions write theirs on
   their own (GitHub's cache), used or not; game progress shows as opens.

   This release also converts existing store installs whose source is
   `github:zcag/pal/extensions/<n>` to `registry = "pal"`, and deletes a
   source copy that shadows a core extension (problem 4).
2. **The slim release** only reconciles. What can't be installed (offline)
   stays listed, shows in Needs you, and is retried. The cache and frecency
   of a listed extension are **not pruned** while it is pending; today
   `host/ready` prunes caches of unknown extensions (`index.rs:323`,
   `cache.rs:153`).

Unused extensions are simply not installed, and they stay visible.

## Visibility

- **Root palette.**
  - A "Browse extensions" row opens the Store.
  - Uninstalled extensions from our registry answer searches: typing `weather`
    shows *Weather · not installed* below every installed match. It is matched
    on name, title, keywords and palette titles from the cached index, never
    shown on the empty query, and never scored by frecency.
  - This is a core synthetic source, like `pal/welcome`, so there is no host
    round trip.
  - Enter shows the listing with Install. After the install it opens the
    palette that was searched for.
- **Games.** The Games palette (`extensions/games/index.ts:17`) adds every game
  in the index for this platform, marked *Not installed*. Enter installs it,
  waits for it to load, then starts it. This is through a new SDK call,
  `extensions.available()`, which any shelf palette can use.
- **Settings › Extensions.**
  - The "Get more extensions" card becomes a browse section in the page:
    categories, search, install.
  - A Registries section sits beside it.
  - Updates, registry problems, pending installs, left-over references and
    rollbacks go to Needs you.
- **First run.** A welcome row, "Pick extensions", opens the Store on its
  categories. This keeps the standing decision in `welcome.rs:1-3`: no wizard,
  no prompt until asked for.
- **Website.** The per-extension "Open in pal" button, above.

## Usage counts

What is installed, used and kept: the numbers that set the core list, what to
fix first, and whether a release reached people. Anonymous, first-party only,
switchable in the UI.

**Identity.** A random install id (UUID), made on first run and kept in the
data dir, not in `config.toml`, so a restored config on a new machine is a new
install. Never sent:
- an account;
- a hostname;
- a path;
- query text or item names.

The site keeps no IP past the request; at most it stores the country derived
from the IP.

**Counted on the server from requests that happen anyway.** Each request carries
the install id, pal version, OS and arch as headers.

| Event | Where it is seen |
|---|---|
| Website download clicks | `/download/<os>` on pal.cagdas.io, logged, then redirected to the release asset |
| Website install clicks | the "Open in pal" button goes through `/go/install/<name>` |
| App update checks | the updater endpoint moves to `pal.cagdas.io/update/{{target}}/{{arch}}/{{current_version}}`, which answers the same JSON (Tauri fills the templates). This is also the daily "alive" count and the version spread. GitHub's `latest.json` stays for released apps. |
| App updates taken | the asset download, redirected through the site |
| Index fetches, package downloads | per registry (ours), per extension, per build |

**Sent by the app.** A small `POST /api/events`, batched, queued while offline,
never blocking anything.
- install, update, remove, rollback and failed installs (with an error kind),
  each with the extension, the build, and where it started: Store, website
  link, root search, Games, first run, migration, auto-update or CLI;
- enable and disable;
- once a day: the installed set (our registry's names and builds, plus counts
  of third-party and source installs) and how many times each extension's
  palettes were opened. Counts only.

Nothing about third-party registries is sent: not their names, not their
contents.

**Switch.** Settings › General, "Share anonymous usage". On by default, and
said in one plain sentence on the "Pick extensions" welcome row's page.
Mirrored as `general.usage`. Off means no install id header, no events, and the
id file is deleted. Registry and update fetches still happen, just unlabelled.

**Storage and reading.** pal-site's SQLite keeps raw events for 90 days and
daily aggregates for good. They are read through a private `/stats` page:
- installs and actives per day;
- the version spread;
- per-extension installs, removals, opens, failures and rollbacks.

They are also exported to Grafana.

**Honesty.** A public `docs/usage.md` lists exactly what is sent, and the
Settings row links to it.

## Docs and code to update

- `docs/cli.md`: the site API, "fetches from GitHub", `pal list`, which today
  shows only the store (`cli.rs:556`).
- `docs/extensions.md`: install, the SDK section, `requires`/`suggests`,
  `protocol`, publishing a registry.
- `docs/config.md`: `[store]`, and `extension_dirs` semantics.
- `docs/usage.md`: new.
- README: bundled vs registry counts, replacing "80 extensions and 193
  palettes".
- The gallery's `store.json` fixture tags.
- `protocol.ts`'s header comment, `host.ts:31`.
- The Store's action and confirm copy (`store.ts:153-160`).
- `notes/decisions.md`: a pointer here.

## Order of work

Each step ships on its own, and nothing is taken away until the last one.

1. **Contract.** `PROTOCOL`, the SDK built as external, `pal-pack`, the tree
   hash, `@zcag/pal` on npm, the extension key.
2. **Our registry.** `extensions.yml` with edge and stable, the site publish
   endpoint, the signed index, the frozen old API.
3. **Core.** Install, verify, lock, reload without restart, rollback, the
   single update check, `[store]` with reconcile, disable. Settings and the
   Store switch to it, and the two old checks are deleted.
4. **References.** `requires`/`suggests`, missing-target handling, left-over
   config.
5. **Visibility.** Root search, Games, Settings browse, the welcome row, site
   pages.
6. **Registries.** Add, trust, remove, rotation, the Action.
7. **Usage.** Site first (redirects, updater endpoint, `/api/events`,
   `/stats`), then the app's switch, id and events.
8. **Migration release**, then **the slim release**, once the counts show
   what is used.

## Decided along the way (2026-09-30)

- Root search shows uninstalled extensions from our registry only; other
  registries' are in the Store and Games.
- `seq` is the source commit's time, not a CI run number.
- Auto-update is `[store] auto_update`, next to the lists it acts on.
