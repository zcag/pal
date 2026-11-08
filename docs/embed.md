# pal inside other web apps

A web app can show pal's panel and bar inside its own pages: search,
palettes, live views and forms, the bar's items with their popovers. The
pal is the one you run (Settings › General › Remote serves it to other
devices); the app frames its pages and hears what happens in them. Nothing
about your extensions changes, and they keep running on the machine pal
runs on.

## Allowing a site

Settings › General › Remote › **Inside other sites**: add the site's
address (`https://app.example`, scheme, host and port only). Each site
gets its own token; **Copy snippet** copies what the site puts in its
page, token included. In the config file this is `[remote] embed_origins`
([Config](config.md)).

- A site not on the list cannot show pal at all: every page pal serves
  says who may frame it (`Content-Security-Policy: frame-ancestors`), pal
  itself and the listed sites, and the browser refuses everyone else.
- A site's token works only while the site is listed: taking it off signs
  it out. **Replace** on the main token changes every site's token too.
- On one of your own tailnet devices the token is not needed, as for the
  remote page itself.

A site's token can do what your extensions can on that machine, like the
main token: list only sites you trust with that.

## The elements

`@zcag/pal-web` (this repo's `web/`) defines two custom elements; it has no
framework dependency, so it works in a plain page, React, Vue or anything
else.

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

**`<pal-bar>`**: the bar's items as a strip, live. A click opens the
item's popover under it, drawn over your page; the element keeps its own
height (36px), and a click outside the popover or Escape closes it.

| attribute | on | what |
| --- | --- | --- |
| `server` | both | pal's address, as Settings shows it. |
| `token` | both | This site's token, for a device outside your tailnet. |
| `palette` | panel | `ext/palette`: the panel starts there and goes back there after a pick. |
| `theme` | both | `light` or `dark` over pal's own theme. |
| `links` | both | `host`: a URL a pick opens is only told (`pal-open`), for your app to open; otherwise pal opens it in a new tab and still tells. |
| `transparent` | panel | The panel draws no background of its own. |

| method | on | what |
| --- | --- | --- |
| `focus()` | both | The search field focused. |
| `reset()` | both | Back to the start (the root, or `palette`). |
| `open(palette)` | panel | Straight into a palette (`ext/palette`). |
| `query(text)` | panel | The search field set to `text`. |
| `close()` | bar | The open popover closed. |

Events are `CustomEvent`s that bubble out of the element, with this `detail`:

| event | detail |
| --- | --- |
| `pal-pick` | `{ id, name, subtitle?, palette?, action? }`: a row was picked, in the panel or a popover. Never the row's data. |
| `pal-hud` | `{ text, large? }`: a HUD line (or Large Type) pal showed. |
| `pal-copy` | `{ text }`: what a pick put on the clipboard. |
| `pal-open` | `{ url }`: a URL a pick opens. |
| `pal-bar-open` | `{ key, title }`: an item's popover opened. |
| `pal-bar-close` | `{}`: it closed. |

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

`web/demo/index.html` is a host app with both elements and an event log.
Allow its origin, build the package (`cd web && npm run build`), serve
`web/` on that origin and open
`/demo/?server=https://pal.lan&token=<the site's token>`.
