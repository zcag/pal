# Remote: pal in a browser

Design spec, 2026-11-08. A pal running on one machine (marko) serves its
whole UI to a browser on another device (a phone, a laptop, a tablet): the
panel, the bar, Settings, the store, every extension. Status: in progress.

## Goals and non-goals

- Everything pal does is usable from a browser on another device, against
  the pal that runs there: search, palettes, live views, forms, bar items
  and their popovers, Settings, the store, games.
- Nothing about an extension changes. Extensions keep calling the SDK and
  answering with effects; whether the person is at the machine or on a
  phone is the shell's business.
- One path. The UI in a browser is the same bundle, the same pages and the
  same commands as in the app; there is no second implementation of any
  command, page or capability.
- Off by default; a switch in Settings turns it on.
- Non-goals for now: a native mobile app (the browser page comes first and
  a shell around it later is cheap), several pals federated into one list,
  pal running in a browser without a machine behind it.

## How pal is split, and the seam chosen

1. **Pages to shell.** The React pages call the Rust shell through Tauri:
   `invoke` for the commands in `lib.rs`'s `generate_handler!`, `listen` for
   the `pal://` events, which all leave through `events::emit` and
   `events::emit_to` (`app/src-tauri/src/events.rs`), and two URL schemes,
   `icon://` (`icon.rs`) and `ext://` (`surface.rs`).
2. **Shell to host.** Newline-delimited JSON over stdio, both ways
   (`host.rs`, `host/src/bridge.ts`).
3. **Extensions** run inside Bun and use its APIs directly
   (`sdk/src/exec.ts`), so they always act on the machine the host runs on.

Remote is a second transport for seam 1 and nothing else. The pal on marko
stays the whole pal; a browser is one more set of pages.

Splitting at seam 2 (host on marko, shell on the phone) was rejected: the
`core/...` capabilities and the extensions' own spawns would act on two
machines, and a phone has no shell to run.

## The transport

**Server.** `remote.rs` in the shell runs an HTTP server when
`[remote] enabled` is set:

| Path | Serves |
|---|---|
| `/` and the bundle's files | the app's frontend, from the shell's own embedded assets (`AppHandle::asset_resolver`) |
| `/__icon/<path>` | what `icon://localhost/<path>` answers, through the same `icon::respond` |
| `/__ext/<path>` | what `ext://localhost/<path>` answers, through the same `surface::respond` |
| `/__pal/ws` | the IPC socket |

**Calls.** A message `{ id, cmd, args }` on the socket is fed to the
existing command handlers with Tauri's own entry point,
`Webview::on_message(InvokeRequest, responder)`, on the panel's webview,
with the request's `invoke_key` from `AppHandle::invoke_key()`. The reply
`{ id, ok | err }` is what the responder got. So every command the app
registers is reachable from a browser, with its argument parsing, its
state and its errors, and no table of commands is kept anywhere else.

**Events.** `events::emit` sends to every Tauri window and to every
connection; `events::emit_to(label)` sends to that window or, for a
remote label, to that connection only. The connection says which events it
listens to, so a busy event (`pal://view`) only travels where a page waits
for it.

**The page.** `app/src/remote.ts` installs, before anything else runs,
what Tauri's runtime would have put on `window`: `__TAURI_INTERNALS__`
with `invoke` over the socket, `transformCallback`, `convertFileSrc` to
the `/__icon` and `/__ext` routes, and the current window's label; event
`listen`/`unlisten` are served locally from the socket's events. The pages
keep importing `@tauri-apps/api` and do not know which transport they are
on. `main.tsx` installs it when the page is not inside Tauri (and is not
the gallery).

## Callers: the one abstraction

Some commands care which page called: a pick hides the window it came
from, a live view is pushed to the page showing it, a bar popover sizes
itself. Today they take `tauri::Window` and read its label. They take a
`Caller` instead (a `CommandArg`), whose label is the window's, or for a
remote call the connection's: `remote:<connection>:<page>`, where page is
`main`, `bar` or `settings`. The connection's label rides in the
`InvokeRequest`'s headers, which `Caller` reads.

Everything keyed by a window label today (views.rs's table, the store's
"opened" bookkeeping, effects' `hide_first`) keys by the caller's label, so
two people (the laptop's panel and a phone) each keep their own level,
cursor and live view. `remote::page_of(label)` maps a remote label back to
the page it stands for where behaviour depends on the page ("the bar
popover's pick hides the popover").

## Where an effect lands

An `Effect` (`sdk/src/protocol.ts`) is data, so the shell decides where it
runs by the caller:

| Effect | From a remote page |
|---|---|
| `copy`, `open` of a URL, `hud`, `large_type`, `toast`, `confetti` | on the device in hand: the page writes the clipboard, opens the URL, shows the HUD or Large Type in the page |
| `copy_files`, `paste`, `focus`, `layout`, `space`, `dialog`, `open` of a path or an app | on the machine pal runs on: pal on marko controls marko, which is what a remote pal is; refused with a toast saying why when the machine has nothing to act on |

`effects::apply_from` takes the caller and splits the envelope: what is the
device's goes back in the envelope under `client` (the page runs it after
the pick resolves); the rest runs as today. A HUD line for a remote caller
is an event to that connection, and HUD lines with no caller (a link's
outcome, an extension's later `effects.run`) go to the local HUD and every
connected page.

Capabilities that need someone at the machine (`color.sample`, `selection`,
keycast, screen OCR) keep answering for the machine. Whether palettes built
only on those should be hidden on remote pages is left open until the list
proves noisy.

## The bar in a browser

On a phone there is no menu bar, and on Linux pal draws no bar at all
today (`bar::SUPPORTED`). The browser gets a strip of its own: a third bar
target, `web`, beside the menu bar and sketchybar. Its renderer is the
page: the strip is the existing `BarStrip` component (`app/src/ui/BarStrip.tsx`,
the one the gallery and Settings › Bar already draw from `bar-model.ts`), at
the top of the page, with the live items and the bar's look; a tap opens
the item's popover as a sheet, which is the existing bar page (`BarPage`)
with a remote label, so menus, views, forms and actions are the same code.
The items render, refresh and follow their rules while a page is connected
on every platform, so marko's bar items exist for the first time.

In the shell the strip is the `Web` target (`bar/web.rs`): it takes every
item that draws (enabled, not `off`, its conditions and rules applied) while
a page is connected, whatever the native target, in the look of the target
the item lands on. `bar_web_items` answers the strip, `{ items: [{ key,
item, look, position }] }` by `order` then key (`item` the wire `BarItem`
without its popover parts, `look` the resolved `BarLook` in the page's
spelling), and `pal://bar/strip` carries the same to every page when it
changes. `bar_web_open(key)` from the page's `bar` sheet sends it the
popover's own `pal://bar` show (or runs `onOpen` for an item with no menu),
and `bar_action`, `bar_refresh` and `bar_hide` route by its label. The
first page connecting starts the render loop off macOS, the last leaving
stops it (`bar::on_pages`).

## Auth

The socket and the routes refuse a request that is neither from one of
the user's own tailnet devices (`tailscale whois` on the peer address, as
atc does) nor carrying the token (`[remote] token`, made on first enable,
shown and replaced in Settings, sent once as `?token=` and kept as a
cookie). A remote page can run anything marko's extensions can, so this
is not optional.

## Settings and config

`[remote]`: `enabled` (false), `port` (7373), `token`. Settings › General
has a Remote section: the switch, the port, the address to open (the
machine's hostname, never localhost), the token with Copy and Replace.

## The page on a phone

- The panel is the page's home: always shown, no hotkey, no hide; the
  search field focused on load only on a device with a keyboard.
- Rows and actions take taps: tapping a row is Enter, a long press or the
  row's chevron opens its actions (the ⌘K panel) as a sheet.
- Back is the browser's back (each level is a history entry).
- Settings is `?settings`, reached from the page's menu.
- The page installs as an app (a web manifest, the app's icon).

## pal inside other web apps (later)

A web app that wants pal's palettes inside it has two shapes, in order of
cost:

1. **Embed a pal.** The same transport, consumed by a small package
   (`@zcag/pal-web`): a `<pal-panel>` element that connects to a pal server
   the user runs, renders the panel, and hands back picks. The app gets
   pal's search over the user's own extensions. Needs CORS and a scoped
   token per embedding app.
2. **pal as a library.** The app ships its own extensions and runs the
   host itself: a Node or Bun backend runs `host/` against a minimal core
   (settings, storage, the index) and the page is the React panel. This
   needs the parts of the shell that are not about a desktop (the index,
   frecency, config, store) pulled out of the Tauri app into a crate the
   server links, which is also what a headless `pal serve` needs.

Neither starts until the remote page is solid; the first rides entirely on
this design, the second on extracting the shell's state from `AppHandle`.
