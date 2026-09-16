# Links

Design spec, 2026-09-16. One grammar for what a `pal://` URL and the `pal`
CLI can reach: the app, a palette, an item, a form, the shell's effects,
bar items, the store, and routes an extension declares for itself. Every
link has a CLI twin; every screen has "Copy deep link". Status: decided in
`notes/decisions.md` ("Decided: links"); built in `deeplink.rs`, `cli.rs`,
`app/src/links.ts`, `sdk/src/manifest.ts` (`checkLinks`) and the host's
`link` method.

Raycast is the reference: `raycast://extensions/<author>/<ext>/<command>?
arguments=<json>&context=<json>&launchType=&fallbackText=`,
`raycast://script-commands/<name>`, `raycast://confetti`, a Copy Deeplink
action (⌘⇧C) on every command, and a confirm card on every link launch.
pal's surface covers the same ground with one path grammar instead of a
per-feature scheme, and adds a CLI twin per link so a keybind, a script and
a bookmark are the same words.

## Grammar

```text
pal://<route>[/<part>...][?<key>=<value>&...]
pal link '<url>'               the same, from a shell; readable twins below
```

1. The scheme is `pal` (a scratch build may register another; the parser
   ignores it). An empty link (`pal://`) shows the panel.
2. The path is split on `/`; each part is percent-decoded on its own, so an
   encoded slash (`%2F`) stays inside an item id.
3. The first part names the route; the table below is the whole set. A
   first part no route claims is an **extension name**, and the second part
   a route that extension declares (`pal://timer/start?duration=25m`). The
   route names are reserved: an extension called `open` cannot be linked.
4. Parameters are the query string: `key=value`, `&` between, percent
   encoding, `+` is a space. A key repeated is an array (`tag=a&tag=b`).
   `args` on `run` and a parameter an extension declares as `json` carry a
   percent-encoded JSON value.
5. A fragment (`#...`) is dropped. A link over 2048 bytes is refused.
6. `install/<spec>` keeps the rest of the path whole (a spec has slashes).
7. What acts asks first (below); what only shows never does. The CLI never
   asks: typing the command is the consent.
8. A refused link (no such route, bad encoding, a missing parameter) is one
   line in the HUD (`pal: unknown link`, `pal: no palette x/y`, `pal:
   <reason>`); the CLI prints the same to stderr and exits 2 for a link it
   can refuse before sending (the grammar), 0 once it is handed over (the
   outcome is the HUD's: there is no reply channel).
9. Links are stable across restarts: ids are the extension's own (a
   quicklink's uuid, an app's bundle id, a layout's name), never a row
   index.
10. Old spellings stay as aliases for one release: `pal://extensions`
    (`settings/extensions`) and `pal://run/pal/commands/<id>`
    (`commands/<id>`). No route was renamed.

## Routes

| Link | CLI twin | Does | Asks |
| --- | --- | --- | --- |
| `pal://` `pal://show` | `pal show` | Shows the panel | no |
| `pal://hide` | `pal hide` | Hides it | no |
| `pal://toggle` | `pal toggle` | One or the other | no |
| `pal://settings[/<page>]` | `pal settings [page]` | The settings window on `overview general palettes extensions bar about` | no |
| `pal://reload` | `pal reload` | Restarts the extension host | no |
| `pal://quit` | `pal quit` | Quits the instance | no |
| `pal://commands/<id>` | `pal command <id>` | One of pal's own rows: `settings settings-extensions settings-palettes settings-about store install reload refresh updates config-open config-reveal tips docs bug diagnostics theme quit restart version` | no |
| `pal://open/<ext>/<palette>?q=&filter=` | `pal open <ext>/<palette> [-q Q] [--filter F]` | The panel inside that palette, the query typed, the filter chosen | no |
| `pal://run/<ext>/<palette>/<id>?action=&args=` | `pal run <ext>/<palette>/<id> [--action A] [--args JSON]` | A pick, the panel down; `args` is the level's args (a drill-in). A `push`/`show`/`view`/`form` answer shows the panel with it, a `toast` is the HUD's line | yes |
| `pal://form/<ext>/<palette>/<id>?action=&<field>=...` | `pal form <ext>/<palette>/<id> [--action A] [field=value ...]` | The same pick, expected to answer a form; every other parameter fills the field of that id, and the form opens in the panel | yes |
| `pal://copy?text=` | `pal copy TEXT` | Text onto the clipboard, "Copied" in the HUD | no |
| `pal://paste?text=` | `pal paste TEXT` | Text pasted into the app in front (Accessibility on macOS) | yes |
| `pal://open?url=` | `pal open --url URL` | A url, path or app for the OS opener | yes |
| `pal://hud?text=` | `pal hud TEXT` | One line in the HUD | no |
| `pal://toast?title=&message=` | `pal toast TITLE [MESSAGE]` | A toast in the panel when it is up, else the HUD line | no |
| `pal://confetti?text=` | `pal confetti [TEXT]` | A celebration in the HUD (the capsule with `text`, "🎉" without) | no |
| `pal://install/<spec>` | `pal install SPEC` | Installs an extension (a `pal install` spec or a store name) | always |
| `pal://update[/<name>]` | `pal update [NAME]` | Fetches an installed extension again (every one with a source without a name) | always |
| `pal://remove/<name>` | `pal remove NAME` | Removes an installed extension | always |
| `pal://bar/<ext>/<id>[?action=]` | `pal bar click <ext>/<id>` / `pal bar action <ext>/<id> <action>` | A bar item's popover; with `action`, one of its actions | no / yes |
| `pal://<ext>/<route>?<params>` | `pal call <ext>/<route> [key=value ...]` | A route the extension declares in its manifest (below) | yes |
| any of the above | `pal link '<url>'` | The link as written | as the CLI: never |

"Asks" is the confirm card in the panel (Enter runs, Escape does not, 30 s
then no). "yes" obeys `general.deeplink_confirm`: `true` (default) asks;
`false` never asks (a machine that scripts pal by link); a list of
extension names asks for everything except links into those extensions
(`deeplink_confirm = ["timer", "quicklinks"]`), which covers `run`, `form`
and extension routes by the extension in the path. "always" ignores the
setting: `install`, `update` and `remove` fetch or delete code. `paste` and
`open?url=` have no extension and follow the boolean only: a web page must
not type into the app in front or launch a file through pal unasked. A
route an extension declares with `"confirm": true` always asks too, for a
`system/run?id=shutdown`. The CLI twins never ask, whatever the setting:
the shell is the user's hand. What only shows something (`open` a palette,
`settings`, `hud`, `toast`, `confetti`, `copy`, a bar popover) never asks.

Extension routes the bundled extensions declare:

| Link | Does |
| --- | --- |
| `pal://quicklinks/open?name=` | Opens the quicklink of that name; one with a `{query}` opens the panel to fill it (`&query=` fills it from the link) |
| `pal://snippets/paste?name=` | Pastes the snippet of that name or keyword, placeholders filled; `&copy=1` copies instead |
| `pal://window-management/layout?name=` | Moves the focused window to that layout (`left_half`, `maximize`, ...) |
| `pal://system/run?id=` | Runs a system command (`lock`, `sleep`, `volume-mute`, ...); `confirm: true`, so the card always shows |
| `pal://timer/start?duration=&name=&ring=` | Starts a timer through the CLI (`25m`, `90s`, `1h30m`) |
| `pal://clipboard/copy?index=` | Puts the nth newest history entry back on the clipboard (`0` is the newest) |
| `pal://calendar/join-next` | Joins the next meeting's call (declared for the calendar extension; its author wires it) |
| `pal://colors/pick` | Opens the screen sampler (declared for the colors extension; its author wires it) |

## What a link addresses

- **The app**: `show hide toggle settings reload quit` and pal's own rows
  under `commands/<id>` (the ids are `commands.rs` constants).
- **A palette**: `open/<ext>/<palette>`, the two names from the manifest
  (`clipboard/history`), not the one-word config id. `q` is typed into the
  search box and never run; `filter` picks one of the palette's filters.
- **An item**: `run/<ext>/<palette>/<id>`, the row's id; `action` one of
  its action ids (the first one otherwise); `args` the level's args for a
  row that only exists inside a drill-in (files' "Open with…").
- **A form**: `form/...` is `run/...` whose answer is expected to be a form;
  the extra parameters prefill fields by id. The panel shows, the form is
  on top, nothing is submitted.
- **Effects**: `copy paste open hud toast confetti` are what a pick would
  answer, from the outside (as `effects.run` is for extensions).
- **Bar items**: `bar/<ext>/<id>`, the popover; `?action=` one of its
  actions (a menu node's action id, or `segment:<id>`).
- **The store**: `install update remove`.
- **Extension routes**: whatever the extension declares, with params.

## How extensions declare routes

`pal.json`:

```json
"links": {
  "start": {
    "description": "Start a timer",
    "confirm": false,
    "params": {
      "duration": { "description": "25m, 90s, 1h30m, 2:30, or minutes", "required": true },
      "name": { "description": "Optional name; the duration otherwise" },
      "ring": { "description": "Ring the phone when it lands", "type": "boolean" }
    }
  }
}
```

A route name is `[a-z0-9][a-z0-9-]*`. A param has `description`,
`required` (default false) and `type`: `string` (default), `number`,
`boolean` (`1 true yes on` are true), `json` (percent-encoded JSON), or
`string[]` (a repeated key; one value is a one-element array). `confirm:
true` makes the card show whatever the allowlist says.

`index.ts` answers them next to the palettes:

```ts
export default defineExtension(manifest, {
  palettes: { ... },
  link: async (route, params) => {
    if (route === "start") return { hud: await timer(String(params.duration)) };
  },
});
```

`link(route, params)` returns an `Effect` like a pick, or nothing. The
host has already checked the route exists in the manifest, filled in
missing optional params as `undefined`, refused a missing required one
(`pal: timer/start: duration is required` in the HUD) and coerced types.
The answer may be `copy copy_files open paste focus layout hud toast push
hide`: what the shell can do with the panel down, plus `push` (the panel
shows inside that palette with the args) and `toast` (its title in the
HUD). `keep`, `show`, `view` and `form` need a level and are refused with
the reason, as `effects.run` refuses them. `checkLinks(manifest, ext)`
(sdk/src/manifest.ts) runs on every load like `checkPalettes`: a manifest
`links` block without a `link` function, a `link` function without a
`links` block, a bad route name or param type is a load warning the
settings window shows; a route is served only when both sides have it.

## How the app generates links

"Copy deep link" (⌘⇧C, section Link) is a shell action on every item in
the action panel (`app/src/links.ts` `linkFor`), and copies with the HUD
saying `Copied pal://...`:

- a palette row (the `pal/palettes` source): `pal://open/<ext>/<palette>`;
- one of pal's rows: `pal://commands/<id>`;
- any other row: `pal://run/<ext>/<palette>/<id>`, `?args=` when the level
  was opened with args;
- with nothing under the cursor inside a palette (or a view palette):
  `pal://open/<ext>/<palette>`, `?q=` with the query typed;
- a form level: `pal://form/<ext>/<palette>/<id>?action=<the action that
  opened it>`;
- a bar item's menu row: `pal://bar/<ext>/<id>?action=<row>`.

The page writes `pal://`; the core swaps in the bundle's scheme when it
differs (a scratch build). The settings pages are addressable
(`pal://settings/<page>`) and listed in docs; a copy action there is
pending the settings revamp another agent owns.

## How the site shows routes

`STORE-FIELDS.md` in pal-site: an extension with `links` gets a "Links"
section on its page, one row per route (`pal://<name>/<route>` as code
with a copy button, the description, the params as `name` chips with
required ones marked and the type in the tooltip, "asks first" on a
`confirm: true` route) and a link glyph on its card. The API adds
`links[]` with `route`, `url` (the example with required params filled
with `<name>`), `description`, `params[]` and `confirm`.

## Arrival

A link from the OS is delivered inside the deep-link plugin's tauri event
listener on the main thread, under the listeners' lock; the CLI twins
arrive on the main thread through the single-instance callback. Neither
runs a route inline: `enqueue` hops to the async runtime and each route
posts back to the main thread from there. A route that builds a window
(settings) emits events of its own and, run inline, deadlocks on that lock
(seen on hornet with `open palscratch://settings/bar`). Links that arrive
before the panel's page has loaded are queued and run once it has.

## Errors

| Case | Where | Text |
| --- | --- | --- |
| Not a route, bad encoding, too long | HUD / stderr exit 2 | `pal: unknown link` |
| Unknown palette | HUD | `pal: no palette x/y` |
| Unknown extension route, missing param | HUD | `pal: no route x/y`, `pal: x/y: name is required` |
| The pick or route threw | HUD | `pal: <message>` |
| Declined card | nothing (log line) | |
| Card unanswered 30 s | the card goes, nothing runs | |
| CLI with no instance | the app starts and applies the link once loaded (`quit`, `reload`: `not running`) | |
