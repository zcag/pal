# pal

Rust command palette. `src/` is the binary, `plugins/palettes/` the built-in
palettes, `raycast/` a Raycast extension that renders any of them.

## After you change something, run the sync — don't leave it to Cagdas

Palette **contents** are read live: the extension shells out to `pal` on every
open, so editing a palette's `run.sh`, its data file, or `~/.config/pal/config.toml`
shows up immediately with no sync at all.

What is *not* live is Raycast's **command list**, which Raycast bakes into a
static manifest at install time. So:

| You changed | Run | Why |
|---|---|---|
| A palette's `run.sh`, data, or plugin | nothing | read live on every open |
| `config.toml`: added, removed, or renamed a palette | **`make raycast`** | the palette has no Raycast command until the manifest is regenerated and rebuilt |
| A palette's `requires`, so it became (un)available | **`make raycast`** | commands are generated from `pal meta`, which only lists available palettes |
| Items of a baked palette (`cmds`, `bookmarks`, `power`) | nothing | *Sync Pal Item Scripts* re-runs hourly on its own |
| The extension's own code under `raycast/src` | **`make raycast`** | rebuilds and reinstalls |

`make raycast` is `npm run sync && npm run build` in `raycast/` — it regenerates
one command per available palette and reinstalls the extension. It is safe to
run at any time and is the only sync anything needs. **Run it yourself as part
of the change**; there is no step here that requires Raycast's UI.

⚠️ It cannot enable a command that Raycast already knows about — Raycast keeps
per-command enabled state in its own encrypted store and only honours
`disabledByDefault` for a name it has never seen. New palettes arrive enabled;
changing an existing one's default needs a remove-and-reimport in Raycast.

## ⛔ Never spawn a bare binary name from the extension

`resolveBinary()` in `raycast/src/lib/pal.ts` exists because **spawning a name
Raycast's PATH cannot resolve kills the whole Raycast app** — it does not raise
ENOENT, it leaves an empty stdout and the window vanishes. Raycast's PATH is not
a login PATH; it has no `~/.cargo/bin`, where `pal` lives.

Every `useExec`/`execFile` in the extension must take an absolute path. Use
`palBinary()` for pal and `resolveBinary(name)` for anything else. The `palPath`
preference *defaults to the literal string* `"pal"`, so a bare default is normal
and means "find it" — only a value containing `/` is ever spawned verbatim.

## Testing the extension without Raycast's UI

Raycast's own death is a usable pass/fail signal, and a deeplink launches a
command headlessly:

```sh
pkill -x Raycast; sleep 1; open -a Raycast; sleep 4
open "raycast://extensions/cagdassalur/pal/pal"; sleep 6
pgrep -x Raycast >/dev/null && echo PASS || echo FAIL
```

Validate any such probe against a build known to render first, or it measures
nothing. An extension can also `writeFileSync` to `/tmp`, which is the only way
to read a value out of a runtime with no console.
