# Extensions

Every palette in pal is an extension, the bundled ones included: a
directory with a `pal.json` manifest and an `index.ts` that Bun runs inside
one long-lived extension host. An extension declares palettes; a palette
lists rows, says what happens when one is picked, and can declare settings
the settings window renders and the config file keeps.

The shapes below are provisional: `host/src/protocol.ts` is the contract
and moves ahead of this page while `pali` is being built.

## Where they live

- Bundled: `extensions/<name>/` in the repo (the app's resource tree in a
  release build).
- Yours: `~/.config/pal/extensions/<name>/`, next to the config file
  (`extensions/` next to whatever `PAL_CONFIG` points at). Loaded after the
  bundled root, so a directory named like a bundled extension replaces it.

The host loads every directory under those roots that has an `index.ts`
(or `index.js`), watches them, and reloads an extension whose files change.

## The manifest, `pal.json`

Read without running the code, so the settings window lists an extension
whose code fails to load.

```json
{
  "name": "hello",
  "title": "Hello",
  "description": "One palette, three rows, one setting.",
  "version": "0.1.0",
  "icon": "👋",
  "author": "you",
  "repo": "github.com/you/pal-hello",
  "settings": [
    { "kind": "text", "id": "greeting", "label": "Greeting", "default": "Hello" }
  ],
  "palettes": {
    "hello": { "description": "What the palette is for." }
  }
}
```

- `name`: required, the directory name and the config key; lowercase
  letters, digits, `-`, `_`, `.`. `pal install` refuses anything else.
- `version`: required (a string).
- `title`, `description`, `icon` (an emoji, glyph or hex colour), `author`,
  `repo`: what the settings window shows.
- `settings`: extension-level settings, `[extensions.<name>]` in the config
  file. Kinds: `text`, `secret`, `number`, `boolean`, `select`, `hotkey`,
  `path`, `list`; each with `id`, `label`, optional `description` and a
  `default`.
- `palettes.<key>`: per-palette `title` (a fallback while the code fails),
  `description`, `settings` (`[palettes.<id>].settings` in the file) and
  `ttl`. The key is the palette's key in the code's `palettes` object.

## The code, `index.ts`

The default export is `{ palettes: { <key>: Palette } }`. A palette
(provisional shape, `Palette` in `host/src/protocol.ts`):

```ts
import { settings, type Extension, type Item } from "pal";

export default {
  palettes: {
    hello: {
      title: "Hello",          // the section label at the root
      icon: "👋",
      list: (): Item[] => [    // rows; indexed unless `input: true`
        { id: "greet", name: "Hello, world", subtitle: "a row", icon: "👋", actions: [{ id: "copy", title: "Copy" }] },
      ],
      pick: (id, action) => ({ copy: "Hello, world" }),  // an Effect
    },
  },
} satisfies Extension;
```

- `list(query?, ctx?)` returns `Item[]`, sync or async. Without `input:
  true` the host lists once, the core indexes the rows, and the root search
  matches them like everything else; the palette is listed again when its
  settings change, on `cmd+r`, or after `ttl` seconds at the next start.
  With `input: true` it runs on every keystroke inside the palette and the
  root has only the palette's own row (a calculator).
- `pick(id, action?, ctx?)` returns an `Effect`: `copy`, `open` (url or
  path), `paste`, `focus` (a window id), `hide`, `toast`, `keep` (stay open
  and list again), `push` (drill into a palette with `args`), `show` (a
  detail-only level).
- `detail(id, ctx?)`: the detail pane's content for a row, asked lazily.
- Palette flags: `live` (arrival order, re-listed on every show), `view:
  "grid"` + `columns`, `placeholder`, `showDetail`, `filters`, `ttl`.
- An `Item` has `id` (stable), `name`, `subtitle`, `icon`, `keywords`,
  `url`, `accessories`, `detail`, `actions` (first is Enter, second
  cmd+Enter; an empty list is an inert hint row).

Settings reach the code resolved: the manifest's defaults with the file's
values on top, kept current on every config change (an extension whose
values changed is listed again).

## The `pal` module

`import { ... } from "pal"` is the host's API (`host/src/api.ts`); the host
links it into `~/.config/pal/extensions/node_modules/pal` so the bare name
resolves for an installed extension (the bundled ones import it by relative
path). Do not list `pal` as a dependency in `package.json`: the npm package
of that name is something else. Every call is one request to the core.

- `settings.get<T>()`: the extension's values, `[extensions.<name>]`.
  `settings.palette<T>()`: the current palette's declared values.
  `settings.onChange(cb)`: called with new values.
- `clipboard.list({ query, kind, limit, offset })`, `get(id)`, `pin(id)`,
  `delete(id)`, `clear()`, `copy(id)` (back onto the clipboard),
  `imageUrl(id, size)` for an image entry.
- `windows.list()` (every window, front to back, with `id`, `app`, `title`,
  `minimized`, `on_screen`), `close(id)`, `minimize(id)`. Focus is the
  `{ focus: id }` effect from `pick`, so the panel hides first.
- `system.commands()` (sleep, lock, dark mode, volume, and so on, with
  `available` per machine), `system.run(id)` (hides the panel, then runs).
- `home(path)`: a leading `~` expanded. `core.call(method, params)`: the
  raw bridge.

The protocol's types ride along: `Extension`, `Palette`, `Item`, `Effect`,
`Ctx`, `Detail`, `Manifest`.

Dependencies: a `package.json` next to `index.ts` is honoured; `pal
install` runs `bun install --production` in the copy it makes.

## Install, update, remove

From the CLI (`pal install SPEC`, see [CLI](cli.md)) or the settings
window's Extensions page (the box at the top takes the same spec; Update
and Remove are on each extension). A spec is:

- `github:user/repo`, `github:user/repo/sub/dir`, either with `@ref` (a
  branch, tag or commit; the default branch otherwise);
- `https://github.com/user/repo`, or `.../tree/<ref>/sub/dir`;
- a local directory, which is copied (without `node_modules` and `.git`).

Install fetches the codeload tarball (20 s), validates the manifest, runs
`bun install --production` when there is a `package.json` (120 s), and
renames the finished copy into `~/.config/pal/extensions/<name>/` in one
step, so nothing ever sees it half-done. A name already installed is
refused: `update` it instead. `.pal-install.json` in the directory records
the source, the ref, the time and the commit it was fetched at.

`pal update NAME` fetches the recorded source again and replaces the
directory; `pal update` with no name does every extension that has a
source. The Extensions page checks GitHub once when it opens (the commit
at the recorded ref, unauthenticated, 10 s each) and marks an extension
whose branch moved with an `update` tag.

`pal remove NAME` deletes the directory. Its keys in the config file stay
(`[extensions.<name>]`, `[palettes.<id>]`), so a reinstall finds its
settings; delete them by hand if you want them gone.

After each of these the extension host is restarted, so the new set is
loaded and a removed extension is gone from the root.

## The hello example

`examples/hello-extension/` is the smallest complete extension: one
palette, three rows, one setting. Install it from a checkout with `pal
install path/to/pal/examples/hello-extension`, or from GitHub with `pal
install github:zcag/pal/examples/hello-extension@main`. Then type `hello`
in the panel; change the greeting under Settings, Extensions, Hello and
the row follows.

## Trust

An extension is code that runs with your user's rights inside the host.
There is no signing and no registry yet: install what you would run from
a terminal. `bun install` also runs the dependencies' install scripts.
