# @zcag/pal-web

pal inside your web app. The usual way is one tag, served by the pal you
run: the bar across the top, the panel on shift P, the page's light or
dark, and `window.pal` for your own menus.

```html
<script type="module" src="https://pal.lan/__pal/embed.js"></script>
```

Under it are `<pal-panel>` and `<pal-bar>`, custom elements that frame the
panel and the bar, for a page that places them itself and hears what is
picked, copied and opened:

```html
<script type="module" src="https://pal.lan/__pal/web.js"></script>
<pal-panel server="https://pal.lan" token="…"></pal-panel>
```

Every pal serves this package itself at `/__pal/web.js`, the copy that
matches it; installing it from npm is for a build that bundles it. The
site has to be allowed in pal's Settings › General › Remote (a site with
the tag asks there by itself), which also gives its token. Attributes, methods,
events and how sign-in works inside a frame:
[docs/embed.md](https://github.com/zcag/pal/blob/main/docs/embed.md).
`demo/index.html` is a host page with both elements and an event log.
