// icons: the generated Nerd Font glyph table as a grid by set, the
// freedesktop names the SDK maps as a second grid, and Iconify's sets as
// a third, against a mock of api.iconify.design (icons-mock.ts).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tile } from "../../../sdk/src/icon.ts";
import { XDG_ICONS } from "../../../sdk/src/icons.ts";
import { dataUrl, fileName, svgOf } from "../../../extensions/icons/iconify.ts";
import { Host } from "../harness.ts";
import { startMock, type Mock } from "./icons-mock.ts";

let host: Host;
let mock: Mock;
const saveTo = mkdtempSync(join(tmpdir(), "pal-iconify-"));
beforeAll(async () => {
  mock = startMock();
  process.env.PAL_ICONIFY_API = mock.url;
  host = await Host.bundled({ settings: { icons: { settings: { save_to: saveTo } } } });
});
afterAll(() => { host.kill(); mock.stop(); delete process.env.PAL_ICONIFY_API; rmSync(saveTo, { recursive: true, force: true }); });

const list = () => host.list("icons", "icons");
const ICONIFY_ACTIONS = [{ id: "svg", title: "Copy SVG" }, { id: "name", title: "Copy name" }, { id: "data", title: "Copy as data URL", shortcut: "cmd+shift+d" }, { id: "open", title: "Open on Iconify", shortcut: "cmd+o" }, { id: "save", title: "Save SVG…", shortcut: "cmd+s" }];
const NF_ACTIONS = [{ id: "glyph", title: "Copy glyph" }, { id: "codepoint", title: "Copy code point" }, { id: "name", title: "Copy name", shortcut: "cmd+shift+n" }, { id: "class", title: "Copy CSS class", shortcut: "cmd+shift+c" }];
const XDG_ACTIONS = [{ id: "name", title: "Copy name" }, { id: "glyph", title: "Copy glyph" }, { id: "codepoint", title: "Copy code point", shortcut: "cmd+shift+u" }];
const pick = (id: string, action?: string) => host.pick("icons", "icons", id, action);

describe("icons", () => {
  test("meta: two grids of 10 columns and Iconify's input grid of 8; the Nerd Font one with a lazy detail; the copy actions once, on the palette", () => {
    const l = host.loaded().find((l) => l.extension === "icons")!;
    expect(l.palettes).toEqual([
      { name: "icons", title: "Nerd Font icons", live: false, input: false, icon: tile("pink", "\u{f0831}"), view: "grid", columns: 10, detail: "lazy", tier: "catalog", actions: NF_ACTIONS },
      { name: "freedesktop", title: "Freedesktop icon names", live: false, input: false, icon: tile("pink", "\u{f0831}"), view: "grid", columns: 10, tier: "catalog", actions: XDG_ACTIONS },
      { name: "iconify", title: "Iconify Icons", live: false, input: true, icon: tile("pink", "\u{f0831}"), view: "grid", columns: 8, placeholder: "Search 200k icons: home, arrow left, github", tier: "normal", actions: ICONIFY_ACTIONS },
    ]);
    expect(l.warnings).toEqual([]);
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

describe("iconify", () => {
  const list = (q?: string, ctx?: { refresh?: boolean }) => host.list("icons", "iconify", q, ctx);
  const pick = (id: string, action?: string) => host.pick("icons", "iconify", id, action);
  const MDI_HOME = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="currentColor" d="M10 20v-6h4v6h5v-8h3L12 3L2 12h3v8z"/></svg>';

  test("svgOf: the set's box, the icon's own size over it, flips and a rotation as one transform; the data url swaps currentColor for the tile only; the file name", () => {
    expect(svgOf({ body: "<p/>" }, { width: 24, height: 24 })).toBe('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><p/></svg>');
    expect(svgOf({ body: "<p/>", width: 32, height: 16, left: 2, top: 1 }, { width: 24 })).toBe('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="16" viewBox="2 1 32 16"><p/></svg>');
    expect(svgOf({ body: "<p/>", hFlip: true, rotate: 1 }, {})).toBe('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><g transform="scale(-1 1) translate(-16 0) rotate(90 8 8)"><p/></g></svg>');
    expect(dataUrl('<svg fill="currentColor"/>', "#888888")).toBe("data:image/svg+xml;utf8," + encodeURIComponent('<svg fill="#888888"/>'));
    expect(dataUrl('<svg fill="currentColor"/>')).toBe("data:image/svg+xml;utf8," + encodeURIComponent('<svg fill="currentColor"/>'));
    expect(fileName("mdi:home-outline")).toBe("mdi-home-outline.svg");
  });

  test("nothing typed is nothing listed and no request (the placeholder says what to type)", async () => {
    expect(await list("")).toEqual([]);
    expect(mock.hits).toEqual([]);
  });

  test("a word: one search, one bodies call per set, a tile per hit drawn from its SVG in grey with the set as its section", async () => {
    const items = await list("home");
    expect(items.map((i) => i.id)).toEqual(["mdi:home", "mdi:home-outline", "tabler:home"]);
    expect(items[0]).toEqual({ id: "mdi:home", name: "home", subtitle: "Material Design Icons", icon: { image: dataUrl(MDI_HOME, "#888888") }, keywords: ["mdi:home", "mdi"], section: "Material Design Icons" });
    expect(items[2].section).toBe("Tabler Icons");
    expect(mock.hits.sort()).toEqual(["/mdi.json?icons=home%2Chome-outline", "/search?query=home&limit=64", "/tabler.json?icons=home"]);
    // The same word again is the cache: no request.
    mock.hits.length = 0;
    expect((await list("home")).map((i) => i.id)).toEqual(["mdi:home", "mdi:home-outline", "tabler:home"]);
    expect(mock.hits).toEqual([]);
    // Refresh asks again; the bodies already known are not fetched twice.
    expect((await list("home", { refresh: true }))).toHaveLength(3);
    expect(mock.hits).toEqual(["/search?query=home&limit=64"]);
  });

  test("typed at speed: the keystrokes share one search for the last word, and every reply is that word's rows", async () => {
    mock.hits.length = 0;
    const replies = await Promise.all(["a", "ar", "arr", "arro", "arrow"].map((q, i) => Bun.sleep(i * 40).then(() => list(q))));
    expect(mock.hits.filter((h) => h.startsWith("/search"))).toEqual(["/search?query=arrow&limit=64"]);
    for (const r of replies) expect(r.map((i) => i.id)).toEqual(["mdi:arrow-left", "tabler:arrow-left"]);
  });

  test("picks: the SVG with currentColor kept, the name, the data url, the page, a saved file (and -2 for a second)", async () => {
    expect(await pick("mdi:home")).toEqual({ copy: MDI_HOME });
    expect(await pick("mdi:home", "svg")).toEqual({ copy: MDI_HOME });
    expect(await pick("mdi:home", "name")).toEqual({ copy: "mdi:home" });
    expect(await pick("mdi:home", "data")).toEqual({ copy: dataUrl(MDI_HOME) });
    expect(await pick("mdi:home", "open")).toEqual({ open: "https://icon-sets.iconify.design/mdi/home/" });
    expect(await pick("mdi:home", "save")).toEqual({ hud: `Saved ${join(saveTo, "mdi-home.svg")}` });
    expect(readFileSync(join(saveTo, "mdi-home.svg"), "utf8")).toBe(MDI_HOME + "\n");
    expect(await pick("mdi:home", "save")).toEqual({ hud: `Saved ${join(saveTo, "mdi-home-2.svg")}` });
    expect(existsSync(join(saveTo, "mdi-home-2.svg"))).toBe(true);
    expect(await pick("hint:none")).toEqual({ keep: true });
    expect(await pick("mdi:nope")).toEqual({ toast: { title: "Search again first", message: "mdi:nope is not in this run's results", style: "failure" } });
  });

  test("the sets setting narrows the search to those prefixes", async () => {
    host.changeSettings("icons", { settings: { save_to: saveTo, sets: ["tabler", " lucide "] } });
    mock.hits.length = 0;
    const items = await list("ho");
    expect(items.map((i) => i.id)).toEqual(["tabler:home", "lucide:house"]);
    expect(mock.hits[0]).toBe("/search?query=ho&limit=64&prefixes=tabler%2Clucide");
    host.changeSettings("icons", { settings: { save_to: saveTo, sets: [] } });
  });

  test("no hit, a 429 and a dead server are one hint row each", async () => {
    expect(await list("zzz")).toEqual([expect.objectContaining({ id: "hint:none", name: "No icons for “zzz”", actions: [] })]);
    mock.limited = true;
    expect(await list("limited")).toEqual([expect.objectContaining({ id: "hint:fail", name: "Iconify is rate limiting this machine; try again in a moment", icon: "\u{f0026}" })]);
    mock.fail = true;
    expect(await list("failing")).toEqual([expect.objectContaining({ id: "hint:fail", name: "Iconify answered 500" })]);
    // A failure is not cached: the next listing asks again and gets the rows.
    expect((await list("failing", { refresh: true })).map((i) => i.id)).toEqual(["hint:none"]);
  });
});
