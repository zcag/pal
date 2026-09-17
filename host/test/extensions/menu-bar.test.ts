// menu-bar against canned core/menubar.* replies: one row per item with
// the path as subtitle and keywords, the shortcut as a key-cap accessory,
// the check mark, the section per top menu; Enter presses with the app's
// pid and answers a HUD line; the hint rows without the permission and
// off macOS.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { tile } from "../../../sdk/src/icon.ts";
import type { Menu } from "../../../extensions/menu-bar/index.ts";
import { Host } from "../harness.ts";

const EXT = "menu-bar";
const MENU: Menu = {
  app: "TextEdit",
  bundle: "com.apple.TextEdit",
  pid: 4242,
  icon: "/System/Applications/TextEdit.app",
  items: [
    { id: "File > New", path: ["File", "New"], shortcut: "cmd+n", checked: false },
    { id: "File > Export as PDF…", path: ["File", "Export as PDF…"], shortcut: null, checked: false },
    { id: "File > Open Recent > notes.txt", path: ["File", "Open Recent", "notes.txt"], shortcut: null, checked: false },
    { id: "Format > Font > Bold", path: ["Format", "Font", "Bold"], shortcut: "cmd+b", checked: false },
    { id: "View > Show Toolbar", path: ["View", "Show Toolbar"], shortcut: "alt+cmd+t", checked: true },
    { id: "Window > Untitled", path: ["Window", "Untitled"], shortcut: null, checked: false },
    { id: "Window > Untitled (2)", path: ["Window", "Untitled"], shortcut: null, checked: true },
  ],
  truncated: false,
  elapsed_ms: 12,
};

let menu: Menu | (() => never) = MENU;
const pressed: { pid: number; id: string }[] = [];
const asked: string[] = [];
let host: Host;
beforeAll(async () => {
  host = await Host.bundled({
    core: {
      "menubar.items": () => (typeof menu === "function" ? menu() : menu),
      "menubar.press": (p) => { pressed.push(p); if (p.id === "Window > Untitled (2)") throw new Error("the app refused the press"); return null; },
      "permissions.request": (p) => { asked.push(p.which); return { accessibility: false, calendar: "granted", input_monitoring: true, location: "granted" }; },
    },
  });
});
afterAll(() => host.kill());

// Typed loosely: `{ keys }` accessories and `Manifest.store` are not in the SDK's types yet (protocol.ts, manifest.ts are another pass's).
const list = () => host.list(EXT, EXT) as Promise<Record<string, any>[]>;
const pick = (id: string, action?: string) => host.pick(EXT, EXT, id, action) as Promise<unknown>;

describe("menu-bar", () => {
  test("meta: one live primary palette wearing the slate tile", () => {
    const l = host.loaded().find((l) => l.extension === EXT)!;
    expect(l.warnings).toEqual([]);
    expect(l.palettes).toEqual([{ name: EXT, title: "Menu Bar Items", live: true, input: false, tier: "primary", icon: tile("slate", "\u{f035c}"), placeholder: "Search the front app's menus" }]);
    expect(l.manifest.palettes?.[EXT]).toMatchObject({ tier: "primary", kind: "live" });
    expect((l.manifest as Record<string, any>).store?.platforms).toEqual(["macos"]);
  });

  test("one row per item: the title, the path above it, key caps, the check, the app icon, the top menu as section", async () => {
    const rows = await list();
    expect(rows.map((r) => r.id)).toEqual(MENU.items.map((i) => i.id));
    expect(rows[0]).toEqual({
      id: "File > New",
      name: "New",
      subtitle: "File",
      icon: { app: "/System/Applications/TextEdit.app" },
      keywords: ["File", "TextEdit"],
      accessories: [{ keys: "cmd+n" }],
      section: "File",
      actions: [{ id: "press", title: "Press" }],
    });
    expect(rows[2]).toMatchObject({ name: "notes.txt", subtitle: "File > Open Recent", keywords: ["File", "Open Recent", "TextEdit"], accessories: [], section: "File" });
    expect(rows[4].accessories).toEqual([{ text: "✓" }, { keys: "alt+cmd+t" }]);
    expect(rows[6]).toMatchObject({ id: "Window > Untitled (2)", name: "Untitled", accessories: [{ text: "✓" }] });
    expect(host.coreCalls.filter((c) => c.method === "menubar.items")).toHaveLength(1);
  });

  test("Enter presses the item of the app listed and the HUD names it; a refusal reaches the HUD too", async () => {
    expect(await pick("File > Export as PDF…")).toEqual({ hud: "TextEdit: File > Export as PDF…" });
    expect(await pick("Format > Font > Bold", "press")).toEqual({ hud: "TextEdit: Format > Font > Bold" });
    expect(pressed).toEqual([{ pid: 4242, id: "File > Export as PDF…" }, { pid: 4242, id: "Format > Font > Bold" }]);
    expect(await pick("Window > Untitled (2)")).toEqual({ hud: "Could not press Untitled: the app refused the press" });
    const before = host.coreCalls.filter((c) => c.method === "menubar.items").length;
    expect(await pick("Edit > Nope")).toMatchObject({ keep: true, toast: { title: "That menu is gone", style: "failure" } });
    expect(host.coreCalls.filter((c) => c.method === "menubar.items")).toHaveLength(before + 1);
    expect(await pick("File > New", "other")).toEqual({});
    // An id the last listing lacks (or a listing older than two seconds) is read again before pressing: `pal run` and item hotkeys reach pick without a show.
    menu = { ...MENU, items: [...MENU.items, { id: "Edit > Nope", path: ["Edit", "Nope"], shortcut: null, checked: false }] };
    expect(await pick("Edit > Nope")).toEqual({ hud: "TextEdit: Edit > Nope" });
    expect(pressed.at(-1)).toEqual({ pid: 4242, id: "Edit > Nope" });
    menu = MENU;
  });

  test("without Accessibility the one row asks; unreadable or off macOS it says why", async () => {
    menu = () => { throw new Error("menu bar search needs Accessibility permission"); };
    let rows = await list();
    expect(rows).toEqual([{ id: "hint:accessibility", name: "Menu bar search needs Accessibility", subtitle: "Grant pal in System Settings > Privacy & Security > Accessibility", icon: "\u{f0026}", actions: [{ id: "open", title: "Open System Settings" }] }]);
    expect(await pick("hint:accessibility")).toEqual({ keep: true });
    expect(asked).toEqual(["accessibility"]);
    menu = () => { throw new Error("menu bar unavailable: the menu bar is macOS only; no desktop on Linux exposes an app's menus to read"); };
    rows = await list();
    expect(rows).toEqual([{ id: "hint:unavailable", name: process.platform === "darwin" ? "No menu bar to read" : "Menu bar search is macOS only", subtitle: "the menu bar is macOS only; no desktop on Linux exposes an app's menus to read", icon: "\u{f0029}", actions: [] }]);
    expect(await pick("hint:unavailable")).toEqual({ keep: true });
    expect(await pick("File > New")).toMatchObject({ keep: true, toast: { title: "That menu is gone" } });
    menu = MENU;
  });
});
