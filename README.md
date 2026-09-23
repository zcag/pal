# pal

A keyboard launcher for macOS and Linux. One hotkey, one search box over
your apps, bookmarks, clipboard history, emoji, windows and a calculator.
Every palette is a TypeScript extension against one API, so your own live
next to the bundled ones.

## Install

Downloads will be on the [Releases page](https://github.com/zcag/pal/releases):
a dmg for Apple silicon and Intel Macs, an AppImage and a deb for Linux.
The builds there today are the previous pal's (`v0.1.x` to `v0.2.1`, a
different program); this pal's first release is coming and is not
published yet. Until then, [build from source](#building-from-source).
The macOS builds are ad-hoc signed, so Gatekeeper refuses the first
launch once; [Getting started](docs/getting-started.md#macos) has the
three ways past it.

## What it does

- **One search over everything.** Apps, windows, files, bookmarks, clipboard
  history, emoji, system commands and every installed palette answer one query,
  ranked by what you pick; a calculation, a colour, a path or an address is
  answered inline, and a query nothing matches falls back to the web, a
  quicklink or a palette ([Getting
  started](docs/getting-started.md#the-root-inline-answers-fallbacks-and-the-empty-list)).
- **Close to two hundred palettes bundled** in sixty-nine extensions, from
  Applications and Clipboard History
  to GitHub, Slack, Gmail, Spotify, Hue, Docker, Obsidian, 1Password, your
  todos, photos, Grafana and home media stack, a disk map and
  a few games, each with its own actions, keys and settings
  ([Palettes](docs/palettes.md)).
- **Features built in**: clipboard history, text expansion, a window
  switcher on cmd+tab, a sidebar at the screen edge, mouse and trackpad
  tweaks, keycast; each a card in Settings with its switch, and every
  switch a command at the root ([Features](docs/features.md)).
- **Extensions in TypeScript**, one directory with a manifest and an
  `index.ts`: rows and actions, forms, a drawn view (a board, a picker,
  a dashboard), items on the menu bar, deep-link routes, several
  accounts of one extension ([Extensions](docs/extensions.md)). The
  zero-code tier is a data file or a shell script
  ([Scripts and data files](docs/scripts.md)).
- **A config file, not a settings database.** One TOML file holds every
  setting, the Settings window writes it, a hand edit is picked up live,
  secrets go to the keychain, a theme file recolours every window
  ([Config](docs/config.md)).
- **Scriptable from outside.** Every action is a `pal` command and a
  `pal://` link (`pal open emoji/emoji -q smile`, `pal pick` as a picker
  for a script, `pal://timer/start?duration=25m`), from a shell, a
  keybind, a browser or a Shortcuts action
  ([CLI](docs/cli.md), [Links](docs/links.md)).

## Extensions

Every palette in pal is an extension, the bundled ones included: a
directory under `extensions/` with a `pal.json` and an `index.ts` that
runs inside one long-lived Bun process. More live at
[pal.cagdas.io/extensions](https://pal.cagdas.io/extensions) and in the
Store palette; `pal install <name>` or `pal install github:user/repo`
puts one in the store directory, and `general.extension_dirs` loads a set
kept in dotfiles. Writing one is two files and a `pal install .`; the
walkthrough is in [Extensions](docs/extensions.md#writing-one), the
smallest complete example in `examples/hello-extension/`, and the API is
`@zcag/pal` in `sdk/`.

## Building from source

Prerequisites: Rust (stable), Node 20+, Bun 1.4 or newer (the pinned
release in `app/scripts/fetch-bun.sh`; a 1.3 `bun install` rewrites every
`bun.lock` in the tree, so an older bun leaves the checkout dirty), and the
[Tauri v2 system prerequisites](https://v2.tauri.app/start/prerequisites/)
for your platform (Xcode command line tools and `cmake` on macOS, `brew
install cmake`; webkit2gtk-4.1, gtk3, librsvg, openssl, base-devel on
Linux).

```sh
git clone git@github.com:zcag/pal.git && cd pal
(cd app && npm install)
bun install
for d in extensions/*/; do
  [ -f "$d/package.json" ] && (cd "$d" && bun install)
done
cd app && npm run tauri dev
```

The first cargo build fetches the pinned Bun release into
`app/src-tauri/binaries/pal-bun-<triple>` (`app/scripts/fetch-bun.sh`,
checksum verified, gitignored): it ships inside the app as the extension
host's runtime, and in dev the app runs that same copy. On macOS it also
builds the MediaRemote adapter into `app/src-tauri/mediaremote/`
(`app/scripts/fetch-mediaremote.sh`: a pinned clone and a cmake build,
about ten seconds; `NOTICES.md`), the system-wide Now Playing source the
`media` palette reads. In dev the host and the extensions load from the
repo and reload when a file changes. `bun install` at the root links the
workspace (`host/`, `sdk/`) and the `@zcag/pal` name the extensions
import.

A release build:

```sh
cd app && npm run tauri build
```

`beforeBuildCommand` builds the UI and stages the host, the SDK and the
extensions under `app/src-tauri/resources/` (`app/scripts/build-extensions.sh`:
each extension bundled to one `index.js` with `bun build`, the SDK inlined,
so no `node_modules` ships). The bundle also signs the updater artifacts,
so it wants `TAURI_SIGNING_PRIVATE_KEY` in the environment; without the
key, add `-- --config '{"bundle":{"createUpdaterArtifacts":false}}'`
(releases come from CI anyway: [Releasing](docs/releasing.md)). Output
under `target/release/bundle/`:

- macOS: `macos/pal.app` and `dmg/pal_0.1.0_aarch64.dmg`, ad-hoc signed
  (`bundle.macOS.signingIdentity: "-"`). `make app` builds and installs
  it to `/Applications`, signed with a local `pal-dev` identity when the
  keychain has one, which keeps the Accessibility grant across rebuilds.
- Linux: `appimage/pal_0.1.0_amd64.AppImage`, `deb/pal_0.1.0_amd64.deb` and
  an rpm. The first build downloads `linuxdeploy` and its plugins into
  `~/.cache/tauri/`. On a distro with current binutils (Arch) run it as
  `NO_STRIP=true npm run tauri build`: linuxdeploy's bundled `strip` cannot
  read the libraries and the bundle fails otherwise.

Inside the bundle, `bun` sits next to the `pal` binary (`Contents/MacOS/`,
`usr/bin/`) and the staged tree under the resource directory
(`Contents/Resources/`, `usr/lib/pal/`; on macOS `Resources/mediaremote/`
too). Installed extensions go in the store under the data dir
(`~/Library/Application Support/pal/extensions/`,
`~/.local/share/pal/extensions/`).

The layout of the repo:

- `app/` the Tauri v2 shell: React UI in `src/`, Rust in `src-tauri/`
- `core/` `pal-core`, the parts that are neither UI nor OS glue (config,
  index, clipboard, icons)
- `host/` the extension host, one long-lived Bun process the app talks to
  over stdio
- `sdk/` `@zcag/pal`, the extension API: what an extension imports
- `extensions/` the bundled extensions, one directory each
- `examples/` the smallest complete extension, two script commands, two
  theme files
- `docs/` what [pal.cagdas.io/docs](https://pal.cagdas.io/docs) renders
- `notes/` decisions and platform notes

## Contributing

Issues and pull requests are welcome at
[github.com/zcag/pal](https://github.com/zcag/pal). `make test` runs what CI
runs on every push (`.github/workflows/ci.yml`, macOS and Ubuntu): `cargo
clippy --workspace --all-targets -- -D warnings`, the Rust workspace's tests,
the SDK's build, `npx tsc --noEmit` and vitest in `app/`, `bunx tsc --noEmit`
(which covers `sdk/`, `extensions/` and `examples/`) and `bun test` in
`host/`, and `npm pack --dry-run` in `sdk/`. Docs are linted with `npx markdownlint-cli2 "docs/**/*.md"
README.md`. An extension of your own does not need a pull request against
the app: publish it on GitHub and anyone can `pal install
github:you/repo`; the store lists community extensions from a
`community.json` at this repo's root (an array of `github:` specs; none
listed yet), which is a one-line pull request.

## Docs

- [Getting started](docs/getting-started.md): install to the first
  extension, in order
- [Config](docs/config.md): the config file key by key
- [Palettes](docs/palettes.md): every bundled palette, its keys and settings
- [Scripts and data files](docs/scripts.md): the zero-code tier
- [Keyboard](docs/keyboard.md): the keyboard grammar
- [CLI](docs/cli.md): `pal` and its subcommands
- [Links](docs/links.md): `pal://` links and their `pal` twins
- [Extensions](docs/extensions.md): writing a palette in TypeScript
- [Troubleshooting](docs/troubleshooting.md): the log, permissions, the
  hotkey, PATH, the host
- [Releasing](docs/releasing.md): cutting a release, the updater

## License

MIT, see [LICENSE](LICENSE). What pal ships that is not its own (the
Bun runtime, the Nerd Fonts symbols, the MediaRemote adapter) is listed
with its licence in [NOTICES.md](NOTICES.md).
