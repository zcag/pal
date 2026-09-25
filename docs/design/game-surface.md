# Game surfaces

Design spec, 2026-09-25. One sandboxed exception to "a view is a render
tree, never HTML" (`notes/decisions.md`, "Game surfaces"), for games only:
a `surface` view node that runs the extension's own HTML and JavaScript in
a frame filling the view body. Status: built in
`app/src-tauri/src/surface.rs` (the `ext://` scheme), `app/src/ui/Surface.tsx`
and `Launcher.tsx` (the frame and its bridge), `app/src-tauri/surface-kit/`
(the kit), `host/src/serve.ts` (`surface`) and `host/src/surface.ts`
(`surface/transpile`), `sdk/src` (`surface` node, `checkView`,
`Palette.onMessage`, `surface.post`, `SurfaceKit`). The example is
`examples/surface-extension/`.

## Why

The five bundled games are view trees: every move is a pick, every frame a
tree the host answers, drawn from stacks, tiles and SVG data urls. It
works, and it reads as a menu: no drag, no pointer, no animation beyond
the keyed transitions, a round trip per key. A card game wants a card
under the pointer, a snake wants 60 frames a second. Growing the
vocabulary until it is a game engine is the wrong direction; letting a
game draw its own page is the small one, as long as the page cannot reach
anything the rest of the panel can.

Everything else stays a tree. The node is for games; a palette that shows
data uses the vocabulary, which follows the theme, the density and the
keys by construction.

## The node

```ts
view: () => ({ title: "Snake", tree: { type: "surface", src: "surface/index.html" }, actions: [...] })
```

`src` is a path inside the extension's folder: relative, no scheme, no
empty, `.`, `..` or dotfile segment (`isSurfaceSrc`, `checkView`). One per
view. It fills the view body (a stack's free space if nested). The level
keeps its `title` and `actions`: ⌘K lists them, the footer shows the first,
Enter with the panel focused runs it. A picked action goes to the **page**
(`pal.onAction`), not to `pick`: the page owns the game state, and the
extension hears of the action only if the page tells it (`pal.send`).

## Files: the `ext://` scheme

`ext://<extension>/<path>` serves a file of the extension's folder, in the
root the host loaded it from (`settings::extensions`: a later root wins as
for the code). On Windows it is `http://ext.localhost/<extension>/<path>`;
the app derives the base from Tauri's `convertFileSrc` as for `icon://`.
An instance key (`gmail@work`) is its extension's folder.

- **Guard.** Every segment is decoded and must be a plain name (not empty,
  no leading dot, no `/`, `\`, `:` or NUL); the file's real path must stay
  inside the folder's (a symlink pointing out is a 404); only the types in
  `mime()` are served (html, js, ts, css, json, txt, images, fonts,
  audio). Anything else is a 404.
- **TypeScript.** A `*.ts` answers as JavaScript: the scheme asks the host
  (`surface/transpile { path }`), which runs `Bun.Transpiler` on that one
  file (`trimUnusedImports`, so an import used only as a type goes) and
  caches it until the mtime moves. No bundling: `import { apply } from
  "../game.ts"` in the page is another request, so the pure rules the host
  tests are the rules the page runs. `import type` from `@zcag/pal` is
  erased; a runtime import of it or of a package does not resolve in the
  page.
- **Headers.** Every response carries the CSP (`default-src 'self';
  script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'
  data: blob:; font-src 'self' data:; media-src 'self' data: blob:;
  connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none';
  form-action 'none'`, every `'self'` followed by the page's own origin,
  `ext://<extension>`: in WKWebView a sandboxed frame's `'self'` is its
  opaque origin and matched nothing, which blocked every script, the
  kit's too): the page loads from its own origin, the kit included, and
  nothing else; no network, no eval, no inline script (a
  module file instead), inline style allowed. `Access-Control-Allow-Origin:
  *` because the frame's origin is opaque (below) and module scripts are
  fetched in CORS mode; `no-cache` so an edited page shows on reopen.
- **Shipping.** `build-extensions.sh` copies an extension's `surface/` and
  the `*.ts` beside its `index.ts` (never `index.ts` itself, which the
  host would load over the bundle) into the resource tree.

## The kit: `/__pal/`

On every extension's origin (the Windows form: the origin's root), from
`app/src-tauri/surface-kit/` (the resource tree's copy in a bundle, the
repo's in a debug build):

- `surface.js`: `window.pal` (below). Included first, as a classic script.
- `cards/<rank><suit>.png`, `joker.png`, `back-{red,green,blue}{1..5}.png`:
  Kenney's Boardgame pack v2, CC0 (`cards/LICENSE-kenney.txt`,
  `NOTICES.md`), 420 by 570 (3x of 140 by 190).
- `tokens.css`: the app's own `app/src/ui/tokens.css`, compiled into the
  binary, so there is one source of the values.

## `window.pal`

The type is `SurfaceKit` in `@zcag/pal` (`declare const pal: SurfaceKit`).

| call | does |
| --- | --- |
| `send(msg)` | to the palette's `onMessage(msg, ctx)`; resolves with what it returned (undefined for nothing), rejects with what it threw |
| `on(fn)` | what the extension pushes with `surface.post(msg)` |
| `onAction(fn)` | a view action picked from ⌘K or the footer, or its key pressed while the panel had focus |
| `storage.get(key)`, `storage.set(key, value)` | the extension's storage, the file the SDK's `storage` uses |
| `settings()`, `onSettings(fn)` | the extension's resolved settings; every change after the first ask |
| `title(text)` | the level's title line; `""` puts the view's own back |
| `onTheme(fn)` | the scheme after a flip; every `--pal-*` token is already set on `:root` and `data-theme` on `<html>` |
| `onShown(fn)`, `onHidden(fn)` | the panel shown again with the level, or hidden: pause the loop |
| `ready()` | the first frame is drawn; the app reveals the frame |

Outside pal (`window.parent === window`) the kit is a stub: storage in
`localStorage`, settings from `?settings=<json>`, the theme from
`?theme=dark|light` or the OS with `tokens.css` linked, sends logged. The
same serving for a plain browser, `.ts` transpiled and the kit mapped, is
`bun host/src/surface.ts <extension dir> [port]`.

## Security model

The page is the extension's own code, which already runs with the user's
rights in the host; what the frame must not get is the **app's**: its
IPC (every Tauri command, from `hide` to `settings_set`), its DOM and its
storage.

- **Sandbox.** `<iframe sandbox="allow-scripts">`: no `allow-same-origin`,
  so the document's origin is opaque; it cannot reach the parent's DOM or
  storage, open windows, navigate the top or submit forms.
- **Tauri's IPC.** The injected API (`__TAURI_INTERNALS__`, with the
  invoke key) is a main-frame-only initialisation script
  (`tauri-2.11.5/src/manager/webview.rs`, `main_frame_script`), so the
  frame has no `invoke`. WebKit's `window.webkit.messageHandlers.ipc` is
  visible in every frame, and Tauri counts a custom scheme's URL as a
  *local* origin (`webview/mod.rs` `is_local_url`), so a message from the
  frame would pass the capability check; what stops it is the invoke key
  every message must carry (`on_message`: "__TAURI_INVOKE_KEY__ expected
  ... but received"), which lives only in the main frame's script. The
  `ipc://` fetch path is refused by the CSP's `connect-src` before it
  leaves. Verified in the running app (below).
- **The bridge decides who is asking.** A message counts only when its
  `source` is our frame's window. The app sends the page's calls to the
  host with the level's extension and palette, never a name from the
  page, and relays only `send`, `storage.get`, `storage.set`, `settings`.
  A post from the host reaches the page only as `message` or `settings`.
- **CSP.** No network (`connect-src 'self'`), no other extension's origin,
  no `icon://` (so no file thumbnails of the user's disk), no eval, no
  inline script, no nested frame.

### Verified (2026-09-25, `/Applications/pal.app` built by `make app`)

`examples/surface-extension` installed in the store, with a probe module
added to its page that printed what it could reach: `__TAURI_INTERNALS__`,
`__TAURI__` and `window.ipc` undefined; `window.webkit.messageHandlers.ipc`
an object; `window.parent.document` blocked; `localStorage` blocked;
`new Function` blocked (CSP); `fetch("ipc://localhost/hide")` and
`fetch("icon://localhost/app?...")` blocked. A forged invoke posted to the
WebKit handler (`cmd: "hide"`, a guessed key) did nothing and pal's log
said `__TAURI_INVOKE_KEY__ expected ... but received surface-probe-guess`.
In the same run: the page drew, `main.ts` and `../game.ts` came
transpiled, arrows moved the dot, `pal.title` set the title line,
`pal.send` came back with the extension's reply, `surface.post` from
`view.onShown` reached the page, ⌘K opened the actions and the one picked
there reached `pal.onAction` with the frame focused again, Escape left the
level.

## Message flow

```text
page ──postMessage──> app (Surface.tsx) ──host_request "surface" {extension, palette, args?, call, data}──> host (serve.ts)
                                                                       send → onMessage → { reply } | {}
                                                                       storage.get/set, settings → the SDK's, in the palette's context
extension: surface.post(msg) ──core/view.post {extension, palette, msg: {pal:"message", data}}──> views.rs
     ──pal://view {…, post} to the windows with that level on top──> Launcher.update ──> page
views.rs: a shown/hidden transition ──pal://view {…, shown} to the windows holding the level──> page
```

The frame and the app speak `{ pal: <kind>, ... }`. Page to app: `hello`
(the app answers with the theme and flushes what it held), `ready`,
`title`, `key`, `call { id, method, params }`. App to page: `theme {
scheme, tokens }`, `reply { id, result | error }`, `action { id }`,
`message { data }`, `settings { data }`, `shown`, `hidden`. The app holds
what it would post until the page's hello; the kit holds a `message`,
`action` or `settings` until the page registers its first handler of
that kind (its module runs after the kit, so a `surface.post` from
`view.onShown` would otherwise land on nobody); the page holds `ready`
until its theme arrived, so the revealed frame is already in its colours (a page
that never says ready is revealed a second after it loaded).

## Keys

The frame has focus while the level is on top: it takes it when it loads
and gets it back when the action panel or a confirm closes (`focus()` in
the Launcher). Every key is the page's except the panel's: the kit
forwards **Escape** and **⌘K** always and any other cmd combo the page
did not `preventDefault` (read once every listener has run), and the app
dispatches each as the keydown the panel would have had, so Escape leaves
(or closes what is open), ⌘K lists the actions, ⌘Enter runs the second
action, a combo its action, exactly as for any view.

## Sizes

The body is about 720 by 390 CSS px in the panel and 560 wide in compact
mode, and can change: a page lays out to its own viewport, with no page
scroll, and draws at `devicePixelRatio`.
**⌘⇧F** ("Enlarge panel") grows the panel to 90% of the screen each way,
centred, for a game played from further back; **⌘⇧J** ("Panel in the
corner") shrinks it to 560 by 380 in the bottom-right corner of the
screen. The same key again goes back to the usual size. Each game
remembers its mode (`panel` under its `[palettes.<id>]`, [Config](../config.md))
and opens in it again. Leaving the level puts the panel back to its usual
size; hiding it does not, so the hotkey that brings the game back (pop
to root keeping the level) shows it the size it was (compact.rs). A page
sees only a bigger or smaller viewport, so one that caps its sizes should
leave room for it.
