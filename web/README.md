# @zcag/pal-web

pal inside your web app: `<pal-panel>` and `<pal-bar>`, custom elements
that frame the panel and the bar of a pal you run, and tell your page what
is picked, copied and opened.

```html
<script type="module" src="https://cdn.jsdelivr.net/npm/@zcag/pal-web"></script>
<pal-panel server="https://pal.lan" token="…"></pal-panel>
```

The site has to be allowed first, in pal's Settings › General › Remote ›
Inside other sites, which also gives its token. Attributes, methods,
events and how sign-in works inside a frame:
[docs/embed.md](https://github.com/zcag/pal/blob/main/docs/embed.md).
`demo/index.html` is a host page with both elements and an event log.
