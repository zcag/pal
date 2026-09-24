# Releasing pal

A release is a `v*` tag. `.github/workflows/release.yml` bundles it for
every platform onto a draft GitHub release and publishes it, as the latest
release, once every bundle is on it. Nothing is done by hand after the tag.

## Steps

1. On a clean tree: `make release VERSION=x.y.z DRY_RUN=1` prints the steps;
   without `DRY_RUN` it sets the version in `app/src-tauri/tauri.conf.json`,
   `app/src-tauri/Cargo.toml`, `app/package.json`, `core/Cargo.toml`,
   `sdk/package.json` and the three lockfiles, commits that alone as `vx.y.z`,
   tags `vx.y.z` and pushes the branch and the tag. It refuses a dirty tree and
   a tag that already exists here or on origin (the previous pal's tags `v0.1.2`
   to `v0.2.1` are on origin).
2. The tag push starts `release.yml`, which refuses a tag that does not match
   `tauri.conf.json`'s version.
3. Three jobs run (`macos-latest` for aarch64 and, cross-compiled, x86_64;
   `ubuntu-24.04` for x86_64) and upload to one draft release named after the
   tag, one bullet per commit subject since the previous `v*` tag reachable
   from it (every commit while the branch shares no history with the previous
   pal's tags). ~15 to 25 min cold; the release profile is LTO with one codegen
   unit. A fourth job, `manifest`, then reads `latest.json` back from the
   draft and fails if any of the three platforms or any bundle is missing:
   the three jobs merge into that one file in parallel, and a platform can
   be dropped when two finish at once. Re-run the missing platform's job;
   it merges its entry in again.
4. When every bundle is there (with the updater key set: both dmgs, the
   AppImage and the deb, the `.app.tar.gz` and AppImage `.sig`s, and
   `latest.json`), `manifest` publishes the draft with `--latest`. The repo's
   older releases of the previous pal sort by version on their own, and
   `https://github.com/zcag/pal/releases/latest/download/latest.json` (the
   in-app updater) and pal.cagdas.io's Download buttons both follow whatever
   GitHub calls latest; every running pal finds the release on its next
   check, the site within its 10-minute cache. A failed `manifest` leaves
   the draft unpublished: re-run the missing job, then `manifest`.

## The updater

`tauri-plugin-updater` (`app/src-tauri/src/updater.rs`) checks the manifest
above once 20 s after startup and then daily while `general.check_updates`
is on (default), and on demand from the menu bar's "Check for updates…",
Settings › About and the "Check for Updates" row. A found release is
offered in three places and installed only on a click: the plugin
downloads the signed bundle (the progress on the HUD and on the About
row), verifies it against the public key, replaces the `.app` or the
AppImage in place and relaunches pal ([Getting
started](getting-started.md#updates)). A debug build skips the periodic
check and cannot be installed over.

`latest.json` is written by `tauri-action` from the `.sig` files of every
job (`uploadUpdaterJson`), platform keys `darwin-aarch64`, `darwin-x86_64`,
`linux-x86_64`, each with the asset URL and its minisign signature. The
signature is checked against `plugins.updater.pubkey` in `tauri.conf.json`
at update time, so the key pair is load-bearing: **lose the private key and
no installed pal can update to a build signed with a new one** (they would
need a manual reinstall).

The Linux updater only handles AppImages; a `.deb` or `.rpm` install sees
the update and is pointed at the releases page instead (the manifest
carries the AppImage only; the package manager updates those).

## Secrets

Repository secrets (Settings, Secrets and variables, Actions):

| secret | what | required |
| --- | --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | the minisign private key, file contents (`tauri signer generate`) | no: without it the release builds with `createUpdaterArtifacts` off and has no `latest.json`, so the updater never sees it |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | its password | empty for the current key |
| `GITHUB_TOKEN` | provided by Actions | yes |

The matching public key is committed in `tauri.conf.json`. A new pair
(`cd app && npx tauri signer generate -w <path>`) means replacing both, and
every installed pal older than that release updating by hand once.

Local `npm run tauri build` needs the key in the environment for the same
reason (`TAURI_SIGNING_PRIVATE_KEY=<contents or path>`); without one, build
with the updater artifacts off:
`npm run tauri build -- --config '{"bundle":{"createUpdaterArtifacts":false}}'`.

## macOS signing, later

Today: ad-hoc (`bundle.macOS.signingIdentity: "-"`, `hardenedRuntime: false`).
Gatekeeper refuses the first launch of the downloaded app once per install (the
dialogs and the ways past them: [Getting started](getting-started.md#macos)); no
notarisation. For a signed and notarised build:

1. A Developer ID Application certificate (Apple Developer Program). Export
   it as `.p12`; base64 of the file is `APPLE_CERTIFICATE`, its password
   `APPLE_CERTIFICATE_PASSWORD`, and its name (`Developer ID Application:
   Name (TEAMID)`) `APPLE_SIGNING_IDENTITY`.
2. Notarisation credentials: `APPLE_ID`, `APPLE_PASSWORD` (an app-specific
   password), `APPLE_TEAM_ID`.
3. In `tauri.conf.json`: `signingIdentity` to the Developer ID name (the
   `APPLE_SIGNING_IDENTITY` env only applies when the config leaves it
   unset), `hardenedRuntime: true`, and an `entitlements` plist. The bun
   sidecar is a JIT (JavaScriptCore), so hardened runtime needs at least
   `com.apple.security.cs.allow-jit`; Bun's own signing notes (docs for
   `bun build --compile`, "Codesigning on macOS") also list
   `com.apple.security.cs.allow-unsigned-executable-memory` and
   `com.apple.security.cs.disable-executable-page-protection`. Start with all
   three and drop what a notarised build still runs without.
4. Uncomment the `APPLE_*` lines in `release.yml`. tauri-bundler then signs
   the sidecar and the app inside out, submits to notarytool and staples.

Cost: the Apple Developer Program is USD 99 a year
(developer.apple.com/programs); notarisation itself is free within it, takes a
few minutes per build in `notarytool`, and needs the sidecar's entitlements to
hold up under the hardened runtime, which is the part to test first with a local
`npm run tauri build` and `spctl -a -vv` on the result.

Until then, the dmg is what `README.md` says: ad-hoc signed, refused once by
Gatekeeper on first launch.

## CI

`ci.yml` runs on every push and pull request on the same two runners:
clippy with `-D warnings`, `cargo test --workspace` (tests that need a
pasteboard, an unlocked keychain or the fixture corpus are `#[ignore]`d and
run by hand with `--ignored`), a `cargo build` of the app crate (build.rs,
tauri-build, no bundle), `tsc` and `vitest` in `app/`, `tsc` and `bun test`
in `host/` (the `apps` test is macOS-only), the declaration build and a
`npm pack --dry-run` in `sdk/`. Caches: cargo (rust-cache), npm
(setup-node), bun's package cache and the fetched bun sidecar
(`app/src-tauri/binaries`, keyed on `fetch-bun.sh`).
