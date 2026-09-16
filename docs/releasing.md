# Releasing pal

A release is a `v*` tag. `.github/workflows/release.yml` bundles it for
every platform onto a **draft** GitHub release; publishing the draft by hand
is what makes it public and what the in-app updater sees.

## Steps

1. `make release VERSION=x.y.z` sets the version in `app/src-tauri/tauri.conf.json`,
   `app/src-tauri/Cargo.toml`, `app/package.json`, `core/Cargo.toml` and the two
   lockfiles. Review the diff, commit it.
2. Tag and push the tag, as the target prints:
   `git tag -a vx.y.z -m vx.y.z && git push origin vx.y.z`. The workflow
   refuses a tag that does not match `tauri.conf.json`'s version.
3. Three jobs run (`macos-latest` for aarch64 and, cross-compiled, x86_64;
   `ubuntu-24.04` for x86_64) and upload to one draft release named after the
   tag, notes generated from the commits since the previous tag. ~15 to 25 min
   cold; the release profile is LTO with one codegen unit.
4. Check the draft on GitHub:
   - `pal_x.y.z_aarch64.dmg`, `pal_x.y.z_x64.dmg`
   - `pal_x.y.z_amd64.AppImage`, `pal_x.y.z_amd64.deb`
   - with the updater key set: `pal_x.y.z_aarch64.app.tar.gz` (+ `.sig`),
     `..._x64.app.tar.gz` (+ `.sig`), `..._amd64.AppImage.sig`, and `latest.json`
   - the notes; edit them, the draft is yours until published.
   Install one dmg and the AppImage somewhere real before publishing:
   ad-hoc signed, so on macOS it is right-click, Open the first time.
5. Publish the draft. `https://github.com/zcag/pal/releases/latest/download/latest.json`
   now resolves to this release's manifest, and every running pal finds it on
   its next check.

## The updater

`tauri-plugin-updater` (`app/src-tauri/src/updater.rs`) checks the manifest
above once 20 s after startup and then daily while `general.check_updates`
is on (default), and on demand through the `check_updates` command (`{
available, version?, notes? }`), which the tray's "Check for updates…" will
call. Today a found update is a log line (`updater\tavailable\t<version>`);
download and install are not wired. Debug builds skip the periodic check.

`latest.json` is written by `tauri-action` from the `.sig` files of every
job (`uploadUpdaterJson`), platform keys `darwin-aarch64`, `darwin-x86_64`,
`linux-x86_64`, each with the asset URL and its minisign signature. The
signature is checked against `plugins.updater.pubkey` in `tauri.conf.json`
at update time, so the key pair is load-bearing: **lose the private key and
no installed pal can update to a build signed with a new one** (they would
need a manual reinstall).

The Linux updater only handles AppImages; a `.deb` install sees the update
and cannot apply it (the plugin's limitation, not ours).

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
Gatekeeper shows the "unidentified developer" dialog once per install; no
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

Until then, the dmg is what `README.md` says: ad-hoc signed, right-click
Open on first launch.

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
