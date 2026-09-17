# @zcag/pal

The extension API of [pal](https://github.com/zcag/pal), a keyboard
launcher for macOS and Linux. An extension is a directory with a `pal.json`
and an `index.ts` that Bun runs inside pal's extension host; this package
is what that `index.ts` imports: the calls into the core (settings, storage,
clipboard, windows, system) and the types of what a palette lists, what a
pick returns, what a view draws.

Provisional: pal is 0.x and the shapes still move. A change that breaks an
extension bumps the minor version.

## Install

```sh
bun add -d @zcag/pal
```

A dev dependency: pal's host provides the package at runtime (it links it
into every extension root), so the copy in your `node_modules` is for the
editor and your tests. The types come from `dist/*.d.ts`, the code Bun runs
from `src/*.ts`; nothing is compiled to JavaScript. To work against an
unreleased checkout of pal instead: `(cd pal/sdk && bun run build && bun
link)`, then `bun link @zcag/pal` in your extension.

## An extension

```ts
// index.ts, next to a pal.json naming the extension
import { clock, defineExtension, settings, storage, type Item } from "@zcag/pal";

type Settings = { greeting: string };

export default defineExtension({
  palettes: {
    hello: {
      title: "Hello",
      icon: "👋",
      list: async (): Promise<Item[]> => {
        const { greeting } = settings.get<Settings>();
        const times = (await storage.get<number>("times")) ?? 0;
        return [
          { id: "greet", name: `${greeting}, world`, subtitle: `picked ${times} times`, actions: [{ id: "copy", title: "Copy" }] },
          { id: "time", name: "What time is it", actions: [{ id: "tell", title: "Tell me" }] },
        ];
      },
      pick: async (id) => {
        if (id === "time") return { toast: { title: clock(Date.now()) } };
        await storage.set("times", ((await storage.get<number>("times")) ?? 0) + 1);
        return { copy: `${settings.get<Settings>().greeting}, world`, keep: true };
      },
    },
  },
});
```

`pal install .` copies it into the store; the host loads it and reloads it
on every change. The walkthrough, the manifest, settings, views and forms:
[docs/extensions.md](https://github.com/zcag/pal/blob/main/docs/extensions.md).

## Surface

Everything is exported from the package root; every type carries a doc
comment, `src/protocol.ts` is the contract.

| export | what |
| --- | --- |
| `Extension`, `Palette`, `ListPalette`, `ViewPalette` | what `index.ts` exports: palettes with `list` or `view`, `pick`, `detail`; `bar` items; `dispose` |
| `Item`, `Action`, `Icon`, `Accessory`, `Detail`, `Metadata` | a row and what it carries |
| `Effect`, `Ctx` | what `pick` returns (`copy`, `open`, `paste`, `focus`, `layout`, `toast`, `hud`, `keep`, `push`, `show`, `view`, `form`) and how a level was opened |
| `View`, `ViewNode`, `Transition`, `TagColor`, `Space` | a render tree |
| `Form`, `FormField`, `FormValues` | a prompt with fields |
| `BarItem`, `BarSegment`, `BarColor`, `BarMenu`, `BarMenuNode`, `BarSource`, `BarCtx`, `BarRefresh` | a bar item: what `Extension.bar[id].render` answers, its popover menu, why it ran |
| `Manifest`, `SettingSpec`, `ManifestPalette`, `ManifestBar`, `ResolvedSettings` | `pal.json` and the values it resolves to |
| `settings` | `get()`, `palette()`, `onChange()` |
| `storage` | `get()`, `set()`, `remove()`, `keys()`, per-extension JSON, `LIMIT` bytes |
| `bar` | `update()` (push an item now), `refresh()` (ask for a render) |
| `clipboard` | `list()`, `get()`, `pin()`, `delete()`, `clear()`, `copy()`, `imageUrl()`; `ClipboardEntry` |
| `windows` | `list()`, `close()`, `minimize()`, `frame()`, `setFrame()`, `displays()`, `focused()`, `layout()`; `Window`, `Rect`, `Display`, `WindowLayout` |
| `system` | `commands()`, `run()`; `SystemCommand` |
| `home()`, `tilde()`, `core.call()` | `~` expansion and its reverse; the raw bridge |
| `hint()`, `toast()`, `failed()` | an inert row that tells the user something; a toast that keeps the panel open; the "Could not <what>" failure toast |
| `text()`, `row()`, `column()`, `keycap()`, `keyHint()`, `POPOVER_W` | view node builders, the keycaps-plus-caption line, a bar popover's content width |
| `bytes()`, `truncate()`, `oneLine()`, `slug()`, `errorMessage()`, `mdEscape()` | small text helpers |
| `now()`, `clock()`, `dayName()`, `dayNameYear()`, `isoDay()`, `when()` | the clock, in unix ms (`PAL_NOW` pins it for tests); a moment written as `14:05`, `Fri 18 Sep`, `Fri 18 Sep 2026`, `2026-09-18`, or the clock today and the day before it otherwise (never `toLocaleString`: the host's locale is not the user's) |
| `exec()`, `run()` | a program run with a timeout: the code and both streams, or stdout with stderr as the error |
| `parseToken()`, `mintToken()`, `TokenError` | a bearer token a shell command prints |
| `pngSize()`, `imageData()` | a PNG's size off its header; a picture on the web as a data url for a view |
| `terminal`, `files`, `md`, `colors`, `tabs` | a terminal window; rename/move/copy forms and archives; markdown to a view tree; colour maths; the browsers' open tabs |
| `xdg()`, `XDG_ICONS` | freedesktop icon names as glyphs |
| `checkView()`, `checkForm()`, `checkBarItem()`, `checkEffect()`, `MAX_NODES`, `MAX_DEPTH`, `MAX_BAR_*`, `SHELL_PREFIX` | what the host checks a view, form, bar item or effect against, for your tests |
| `defineExtension()` | type-checks the default export where it is written |
| `@zcag/pal/runtime` | the host's side (`bind`); not for extensions |

Wire shapes (`Request`, `Response`, `Notification`, `PaletteMeta`,
`BarMeta`, `SettingsChanged`) are exported for a host or a test harness.

## License

MIT
