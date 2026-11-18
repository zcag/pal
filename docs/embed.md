# pal inside other web apps

A web app can show pal inside its own pages: the bar's items across the
top with their popovers, and the panel (search, palettes, live views,
forms) over the page on a key. The pal is the one you run (Settings ›
General › Remote serves it to other devices); the page frames its pages and
hears what happens in them. Nothing about your extensions changes, and they
keep running on the machine pal runs on.

## One tag

```html
<script type="module" src="https://pal.lan/__pal/embed.js"></script>
```

That is all a page needs. It loads from the pal you run, so it always
matches it, and does the rest itself:

- **The bar** across the top of the page, fixed, the page's own background
  behind it. Its height is published on `<html>` as `--pal-bar-h` (0px
  while it is not shown), and `<html>` has the class `pal-bar` while it is,
  so the page reserves the room: `body { padding-top: var(--pal-bar-h, 0px); }`.
- **The panel** in an overlay: a scrim, the panel in a dialog, focus moved
  into it and back where it was when it closes; Escape, a click on the
  scrim, or a pick that would hide pal closes it.
- **Keys**, pal's own and the same on every site: **shift P** opens and
  closes the panel, **shift B** shows and hides the bar. Never while
  someone types in a field or an editable element, and never a key the page
  already handled (`preventDefault`).
- **Which bar items show**, per device: a right-click on the strip (a long
  press on a phone) lists every item to tick on or off. The pick is kept in the page's own storage, so
  per site and per browser; until a device picks, the site's default from
  pal's config shows (Settings, below).
- **Light or dark as the page is**: the page's background decides, else
  its `color-scheme`, else the device's; a page that flips its theme flips
  pal with it.
- **A link a pick opens** opens in a new tab, unless the page handles
  `pal-open` itself and calls `preventDefault()`.
- **Silent when pal is not there**: unreachable, the site not allowed, or
  the device not signed in, it draws nothing and throws nothing.

The tag's `data-*` change that:

| attribute | what |
| --- | --- |
| `data-token` | This site's token (Settings › Copy snippet), for a device outside your tailnet. |
| `data-bar` | `none`: no bar (and no bar key). A CSS selector (`#top`): the strip goes inside that element, in its flow, instead of fixed to the top; no `--pal-bar-h`. |
| `data-keys` | `panel:<keys> bar:<keys>`, e.g. `panel:ctrl+k bar:none`; `none` for no keys at all. Keys are `ctrl`, `alt`, `shift`, `meta` and a key name joined by `+`. |
| `data-theme` | `light` or `dark` always; `pal`: pal's own theme, not the page's. |

### `window.pal`

So a page can put pal in its own command palette or menu:

| | what |
| --- | --- |
| `pal.toggle()` | The panel opened, or closed when open. |
| `pal.open(palette?)` | The panel opened, in `ext/palette` when given. |
| `pal.close()` | The panel closed. |
| `pal.bar(on?)` | The bar shown or hidden (flipped without `on`), remembered for this site on this device. |
| `pal.theme(tokens)` | Theme tokens over those the page's CSS sets (below): `{ accent: "#0a7", radius_row: "3px" }`, keys as in a theme file or as `--pal-` names; `null` clears them. |
| `pal.ready` | A promise: `true` once pal is up on the page, `false` when it will not be. A page can hide its own pal entry on `false`. |

The module is also `@zcag/pal-web/embed` for a build that bundles it; it
then asks the pal at its own address, so serving it from pal is the usual way.

### Match your site

pal draws itself in its own theme unless the page says otherwise. A page
says it with the tokens of a [theme file](config.md#theme-file), set as
custom properties on `<html>`, `--pal-<key>` with `_` as `-`:

```css
:root { --pal-accent: #1d1d1b; --pal-bg: #f4f4f1; --pal-fg: #1d1d1b; --pal-font-ui: Recursive, sans-serif; --pal-radius-row: 3px; }
:root[data-theme="dark"] { --pal-accent: #ececea; --pal-bg: #18181a; --pal-fg: #ececea; }
```

The tag reads them on load and again whenever `<html>` or `<body>`
changes an attribute (a class, a style, a `data-` flag) or the device
flips between light and dark, so tokens set inside the page's own
dark-mode rules make a matching pal with no script. `pal.theme({...})`
sets them from code instead, over the CSS ones.

| tokens | kind |
| --- | --- |
| `accent`, `accent-fg`, `accent-soft`, `bg`, `bg-glass`, `bg-elevated`, `bg-sunken`, `fg`, `fg-muted`, `fg-faint`, `line`, `line-strong`, `selection`, `scrim`, `match`, `knob`, `destructive`(`-soft`), `success`(`-soft`), the `tag-*` and `brand-*` colours, `tile-fg`, `tile-ring` | a colour: anything the browser reads (`oklch()` and names are passed on as `rgba()`) |
| `radius-panel`, `radius-popover`, `radius-hud`, `radius-tile`, `radius-row`, `radius-icon`, `radius-control`, `radius-tag`, `radius-kbd` | pixels (`3px`) |
| `font-ui`, `font-mono` | a font stack. A family the page loads itself (`@font-face` in one of its stylesheets) is loaded in pal's frames from the same files, which pal's origin fetches: the page's server answers those font files with `Access-Control-Allow-Origin` (pal's address, or `*`) |

[Theme file](config.md#theme-file) says what each one colours. pal checks
every value as it checks a theme file's; one it cannot use is dropped with
a console warning on the page naming the token (`pal: --pal-radius-row:
ignored: expected a number of pixels`), and the rest apply. Only that
page's frames change; pal elsewhere keeps its own theme. A page that sets
none looks as it did before.

### What the page still does

- **Content-Security-Policy**, if it sends one: `script-src` and
  `frame-src` for pal's address, `connect-src` too (the tag asks pal
  whether the site is allowed: `/__pal/embed.json`).
- Reserve the bar's room with `--pal-bar-h`, as above.
- To match pal to its look, its `--pal-*` tokens, and CORS on the font
  files they name ("Match your site").
- Nothing else; the elements below are for a page that wants to place
  them itself.

## Allowing a site

The first time a page with the tag is opened, pal lists it in Settings ›
General › Remote as "**https://app.example wants to show pal**", with
**Allow** and **Deny**. Allow is a decision made in pal, never by the site:
a site's token can do what your extensions can on that machine, like the
main token, so allow only sites you trust with that. A denied site is not
asked about again (Settings lists it with an Allow to undo that). Nothing
shows on the page until it is allowed; a reload then shows pal.

Settings › General › Remote › **Inside other sites** also takes addresses
typed by hand (`https://app.example`, scheme, host and port only). Each
allowed site gets its own token, and a row of its own: **Copy snippet**
copies the tag with its token, and its **bar items** are the default for
that site, the items a device sees until it picks its own. In the config
file these are `[remote] embed_origins`, `embed_denied` and
`embed_bar_hide` ([Config](config.md)).

- A site not on the list cannot show pal at all: every page pal serves
  says who may frame it (`Content-Security-Policy: frame-ancestors`), pal
  itself and the listed sites, and the browser refuses everyone else.
- A site's token works only while the site is listed: taking it off signs
  it out. **Replace** on the main token changes every site's token too.
- On one of your own tailnet devices the token is not needed, as for the
  remote page itself.

## The elements

The tag above is built on two custom elements, which a page can use
directly to place pal itself (in its own header, its own dialog).
`@zcag/pal-web` (this repo's `web/`) defines them; it has no framework
dependency, so it works in a plain page, React, Vue or anything else.

Load it from the pal you frame, which serves the copy that matches it at
`/__pal/web.js` (one module, no sign-in, readable cross-origin by the
allowed sites, so `import()` works too); the npm package is the same code
for a build that bundles it.

```html
<script type="module" src="https://pal.lan/__pal/web.js"></script>

<pal-bar server="https://pal.lan" token="…"></pal-bar>
<pal-panel server="https://pal.lan" token="…" links="host"></pal-panel>

<script type="module">
  const panel = document.querySelector("pal-panel");
  panel.addEventListener("pal-pick", (e) => console.log("picked", e.detail.name));
  panel.addEventListener("pal-open", (e) => router.go(e.detail.url));
  panel.focus();
</script>
```

Or from a bundler: `npm i @zcag/pal-web`, then `import "@zcag/pal-web"`.

**`<pal-panel>`**: the panel. It is never hidden: a pick that would hide
the panel in the app leaves it at its start instead. Its height is yours
(440px unless you style it).

**`<pal-bar>`**: the bar's items as a quiet strip, live, each item on the
side its `position` in `[bar.items]` says, in its `order`: `left`, then
sketchybar's `q` and `e` (the notch's sides; a page has no notch, so they
follow the left items), `center` in the middle, and anything else on the
right, as the menu bar draws it. A strip wider than the
element scrolls sideways (a mouse wheel too). The element's height is the
strip's, which pal tells it (26px today), so your page needs no number.
A click opens the item's popover under it, drawn over your page, and a
click outside the popover or Escape closes it. A right-click on the strip (a long
press on a phone) opens the item picker: it changes `hide` and tells
`pal-bar-hide`, for your page to keep.

| attribute | on | what |
| --- | --- | --- |
| `server` | both | pal's address, as Settings shows it. |
| `token` | both | This site's token, for a device outside your tailnet. |
| `palette` | panel | `ext/palette`: the panel starts there and goes back there after a pick. |
| `theme` | both | `light` or `dark` over pal's own theme. Changing it applies at once. |
| `links` | both | `host`: a URL a pick opens is only told (`pal-open`), for your app to open; otherwise pal opens it in a new tab and still tells. |
| `transparent` | panel | The panel draws no background of its own. |
| `hide` | bar | Item keys, comma-separated, as `pal bar list` prints them (`hide="dpi/bypass,audio/volume"`), that leave the strip; any other item, a new one included, shows. Changing it applies at once, without reloading the frame. |

| method | on | what |
| --- | --- | --- |
| `tokens(map)` | both | Theme tokens over pal's own in this frame (`{ "--pal-accent": "#0a7" }`, "Match your site" above), kept across reloads; `{}` clears them. |
| `focus()` | both | The search field focused. |
| `reset()` | both | Back to the start (the root, or `palette`). |
| `open(palette)` | panel | Straight into a palette (`ext/palette`). |
| `query(text)` | panel | The search field set to `text`. |
| `close()` | bar | The open popover closed. |

Events are `CustomEvent`s that bubble out of the element (cancelable, so a
listener can `preventDefault()` what the one-tag layer would do next), with this `detail`:

| event | detail |
| --- | --- |
| `pal-pick` | `{ id, name, subtitle?, palette?, action? }`: a row was picked, in the panel or a popover. Never the row's data. |
| `pal-hud` | `{ text, large? }`: a HUD line (or Large Type) pal showed. |
| `pal-copy` | `{ text }`: what a pick put on the clipboard. |
| `pal-open` | `{ url }`: a URL a pick opens. |
| `pal-bar-open` | `{ key, title }`: an item's popover opened. |
| `pal-bar-close` | `{}`: it closed. |
| `pal-bar-items` | `[{ key, title }]`: every item the bar has, those `hide` leaves out included, once the strip is up and again whenever the set changes; for a picker of your own that writes `hide`. |
| `pal-bar-hide` | `{ keys }`: someone picked which items show, in the strip's own picker; the element has already taken `keys` as its `hide`. |
| `pal-dismiss` | `{ reason: "escape" \| "pick" }`: where the app would hide pal. `escape`: Escape with nothing left to back out of (a level, the query, the actions), or in `<pal-bar>` with no sheet open; `pick`: a pick that hides the panel (a copy, an open). A host showing pal in an overlay closes it. |

What a pick does on the machine (pasting, moving windows, opening a file
or an app) still happens there, as on the remote page
([design](design/remote.md), "Where an effect lands").

## Signing in inside a frame

A page framed by another site gets no ordinary cookie, so the element
puts the token on the frame's address and pal keeps it in a partitioned
cookie (`SameSite=None; Secure; Partitioned`), one the browser keeps for
that site's frames only. That needs pal served over https (it has to be
anyway: an https page cannot frame an http one), and a browser that keeps
partitioned cookies (Chrome, Edge and Firefox do). On a tailnet device
none of this is needed.

## The demo

`web/demo/index.html` is a host app with an event log, in two ways: as
it is, the one tag from the pal it names; with `&elements`, both elements
placed by the page itself. Serve `web/` on some origin (for the elements,
build the package first: `cd web && npm run build`), open
`/demo/?server=https://pal.lan&token=<the site's token>`, and Allow the
origin when pal asks.
