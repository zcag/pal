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
editor and your tests. Not published yet: link it from a checkout of pal
with `(cd pal/sdk && bun run build && bun link)` then `bun link @zcag/pal`
in your extension.

## An extension

```ts
// index.ts, next to a pal.json naming the extension
import { defineExtension, settings, storage, type Item } from "@zcag/pal";

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
        if (id === "time") return { toast: { title: new Date().toLocaleTimeString() } };
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
| `Extension`, `Palette`, `ListPalette`, `ViewPalette` | what `index.ts` exports: palettes with `list` or `view`, `pick`, `detail` |
| `Item`, `Action`, `Icon`, `Accessory`, `Detail`, `Metadata` | a row and what it carries |
| `Effect`, `Ctx` | what `pick` returns (`copy`, `open`, `paste`, `focus`, `layout`, `toast`, `hud`, `keep`, `push`, `show`, `view`, `form`) and how a level was opened |
| `View`, `ViewNode`, `Transition`, `TagColor`, `Space` | a render tree |
| `Form`, `FormField`, `FormValues` | a prompt with fields |
| `Manifest`, `SettingSpec`, `ManifestPalette`, `ResolvedSettings` | `pal.json` and the values it resolves to |
| `settings` | `get()`, `palette()`, `onChange()` |
| `storage` | `get()`, `set()`, `remove()`, `keys()`, per-extension JSON, `LIMIT` bytes |
| `clipboard` | `list()`, `get()`, `pin()`, `delete()`, `clear()`, `copy()`, `imageUrl()`; `ClipboardEntry` |
| `windows` | `list()`, `close()`, `minimize()`, `frame()`, `setFrame()`, `displays()`, `focused()`, `layout()`; `Window`, `Rect`, `Display`, `WindowLayout` |
| `system` | `commands()`, `run()`; `SystemCommand` |
| `home()`, `core.call()` | `~` expansion; the raw bridge |
| `xdg()`, `XDG_ICONS` | freedesktop icon names as glyphs |
| `checkView()`, `checkForm()`, `MAX_NODES`, `MAX_DEPTH`, `SHELL_PREFIX` | what the host checks a view or form against, for your tests |
| `defineExtension()` | type-checks the default export where it is written |
| `@zcag/pal/runtime` | the host's side (`bind`); not for extensions |

Wire shapes (`Request`, `Response`, `Notification`, `PaletteMeta`,
`SettingsChanged`) are exported for a host or a test harness.

## License

MIT
