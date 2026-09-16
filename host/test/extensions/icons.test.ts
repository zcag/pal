// icons: the generated Nerd Font glyph table as a grid by set, and the
// freedesktop names the SDK maps, as a second grid.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { tile } from "../../../sdk/src/icon.ts";
import { XDG_ICONS } from "../../../sdk/src/icons.ts";
import { Host } from "../harness.ts";

let host: Host;
beforeAll(async () => { host = await Host.bundled(); });
afterAll(() => host.kill());

const list = () => host.list("icons", "icons");
const NF_ACTIONS = [{ id: "glyph", title: "Copy glyph" }, { id: "codepoint", title: "Copy code point" }, { id: "name", title: "Copy name", shortcut: "cmd+shift+n" }, { id: "class", title: "Copy CSS class", shortcut: "cmd+shift+c" }];
const XDG_ACTIONS = [{ id: "name", title: "Copy name" }, { id: "glyph", title: "Copy glyph" }, { id: "codepoint", title: "Copy code point", shortcut: "cmd+shift+u" }];
const pick = (id: string, action?: string) => host.pick("icons", "icons", id, action);

describe("icons", () => {
  test("meta: two grids of 10 columns; the Nerd Font one with a lazy detail; the copy actions once, on the palette", () => {
    const l = host.loaded().find((l) => l.extension === "icons")!;
    expect(l.palettes).toEqual([
      { name: "icons", title: "Nerd Font icons", live: false, input: false, icon: tile("pink", "\u{f0831}"), view: "grid", columns: 10, detail: "lazy", tier: "catalog", actions: NF_ACTIONS },
      { name: "freedesktop", title: "Freedesktop icon names", live: false, input: false, icon: tile("pink", "\u{f0831}"), view: "grid", columns: 10, tier: "catalog", actions: XDG_ACTIONS },
    ]);
  });

  test("10995 rows with unique ids, the sets as sections in a fixed order, Material first", async () => {
    const items = await list();
    expect(items).toHaveLength(10995);
    expect(new Set(items.map((i) => i.id)).size).toBe(10995);
    expect([...new Set(items.map((i) => i.section))]).toEqual(["Material Design", "Font Awesome", "Codicons", "Octicons", "Devicons", "Seti", "Weather", "Font Logos", "Font Awesome Extension", "Powerline", "Powerline Extra", "Pomicons", "IEC Power", "Custom", "Extra", "Indent", "Indentation"]);
    expect(items.filter((i) => i.section === "Material Design")).toHaveLength(6896);
    expect(items.filter((i) => i.section === "Font Awesome")).toHaveLength(1818);
    expect(items.filter((i) => i.section === "Powerline")).toHaveLength(9);
  });

  test("a row: the glyph as the tile, the name with spaces, the code point as subtitle, the nf- name as keyword, no actions of its own (the palette's four)", async () => {
    const items = await list();
    const account = items.find((i) => i.id === "nf-md-account_circle")!;
    expect(account).toEqual({ id: "nf-md-account_circle", name: "account circle", subtitle: "U+F0009", icon: "\u{f0009}", keywords: ["nf-md-account_circle"], section: "Material Design" });
    // Eleven thousand rows: nothing rides on a row that the palette can say once (2026-09-16: the four actions were half the 3.4 MB listing).
    expect(items.every((i) => i.actions === undefined && i.detail === undefined && i.accessories === undefined)).toBe(true);
    // A BMP glyph and an astral one both draw as one code point.
    expect(items.find((i) => i.id === "nf-fa-github")).toMatchObject({ icon: "\u{f09b}", subtitle: "U+F09B" });
    expect([...(items.find((i) => i.id === "nf-md-account")!.icon as string)]).toHaveLength(1);
    // The SDK's table draws from the same font: every xdg glyph is a listed code point.
    const codes = new Set(items.map((i) => i.subtitle));
    for (const glyph of Object.values(XDG_ICONS)) expect(codes.has(`U+${glyph.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`)).toBe(true);
  });

  test("picks: the glyph, the code point, the name, the CSS class; then a Recent section leads", async () => {
    expect(await pick("nf-md-account")).toEqual({ copy: "\u{f0004}" });
    expect(await pick("nf-md-account", "glyph")).toEqual({ copy: "\u{f0004}" });
    expect(await pick("nf-md-account", "codepoint")).toEqual({ copy: "U+F0004" });
    expect(await pick("nf-fa-github", "name")).toEqual({ copy: "nf-fa-github" });
    expect(await pick("nf-fa-github", "class")).toEqual({ copy: "nf nf-fa-github" });
    expect(await pick("nf-md-nope")).toEqual({ toast: { title: "Unknown glyph", message: "nf-md-nope", style: "failure" } });
    const items = await list();
    expect(items.slice(0, 2).map((i) => [i.id, i.section])).toEqual([["nf-fa-github", "Recent"], ["nf-md-account", "Recent"]]);
    expect(items).toHaveLength(10995);
    expect(items.filter((i) => i.id === "nf-md-account")).toHaveLength(1);
    expect(items[2].section).toBe("Material Design");
  });

  test("detail: the set, the version, name, code point, class and escape", async () => {
    expect(await host.detail("icons", "icons", "nf-fa-github")).toEqual({
      markdown: "**github**\n\nFont Awesome (fa), Nerd Fonts 3.5.1",
      metadata: [{ label: "Name", value: "nf-fa-github" }, { label: "Code point", value: "U+F09B" }, { label: "CSS class", value: "nf nf-fa-github" }, { label: "Escape", value: "\\u{f09b}" }],
    });
  });
});

describe("freedesktop", () => {
  test("every name of the SDK table, with its glyph, the Nerd Font name it is as subtitle and keyword", async () => {
    const items = await host.list("icons", "freedesktop");
    expect(items).toHaveLength(Object.keys(XDG_ICONS).length);
    expect(items.map((i) => i.id)).toEqual(Object.keys(XDG_ICONS));
    const err = items.find((i) => i.id === "dialog-error")!;
    expect(err).toEqual({ id: "dialog-error", name: "dialog-error", subtitle: "nf-md-alert_octagon", icon: "\u{f0029}", keywords: ["nf-md-alert_octagon"] });
    expect(items.every((i) => i.subtitle)).toBe(true);
  });

  test("picks copy the name, the glyph or the code point", async () => {
    expect(await host.pick("icons", "freedesktop", "dialog-error")).toEqual({ copy: "dialog-error" });
    expect(await host.pick("icons", "freedesktop", "dialog-error", "glyph")).toEqual({ copy: "\u{f0029}" });
    expect(await host.pick("icons", "freedesktop", "dialog-error", "codepoint")).toEqual({ copy: "U+F0029" });
    expect(await host.pick("icons", "freedesktop", "nope")).toEqual({ toast: { title: "Unknown icon name", message: "nope", style: "failure" } });
  });
});

describe("icons columns setting", () => {
  test("is read at load from [palettes.icons]", async () => {
    const h = await Host.bundled({ settings: { icons: { palettes: { icons: { columns: 14 } } } } });
    expect(h.loaded().find((l) => l.extension === "icons")!.palettes[0].columns).toBe(14);
    h.kill();
  });
});
