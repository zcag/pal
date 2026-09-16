// unicode: the generated character table as a grid, by block, with the
// recently picked characters first.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Host } from "../harness.ts";

let host: Host;
beforeAll(async () => { host = await Host.bundled(); });
afterAll(() => host.kill());

const list = () => host.list("unicode", "unicode");
const pick = (id: string, action?: string) => host.pick("unicode", "unicode", id, action);

describe("unicode", () => {
  test("meta: a grid with the palette setting's columns and a lazy detail", () => {
    const l = host.loaded().find((l) => l.extension === "unicode")!;
    expect(l.palettes).toEqual([{ name: "unicode", title: "Unicode characters", live: false, input: false, icon: "Ω", view: "grid", columns: 10, detail: "lazy" }]);
  });

  test("1795 rows with unique ids, in section order; the arrow has its name, code point, entity, LaTeX and words as keywords", async () => {
    const items = await list();
    expect(items).toHaveLength(1795);
    expect(new Set(items.map((i) => i.id)).size).toBe(1795);
    const sections = [...new Set(items.map((i) => i.section))];
    expect(sections).toEqual(["Keyboard", "Arrows", "Math", "Greek", "Currency", "Quotes and dashes", "Punctuation", "Spaces", "Superscripts and subscripts", "Fractions and numerals", "Letters", "Letterlike", "Symbols", "Dingbats", "Shapes", "Box drawing", "Enclosed"]);
    // Sections are contiguous runs: the grid draws a header per run.
    for (let i = 1; i < items.length; i++) if (items[i].section !== items[i - 1].section) expect(items.slice(0, i).map((x) => x.section)).not.toContain(items[i].section);
    const arrow = items.find((i) => i.id === "2192")!;
    expect(arrow).toMatchObject({ name: "rightwards arrow", subtitle: "U+2192", icon: "→", section: "Arrows" });
    expect(arrow.keywords).toEqual(["U+2192", "right", "arrow", "right arrow", "rarr", "srarr", "rightarrow", "\\rightarrow"]);
    expect(arrow.actions!.map((a) => a.id)).toEqual(["copy", "paste", "codepoint", "entity", "numeric"]);
  });

  test("the keyboard block has the Mac keys with their plain names; letters carry their language", async () => {
    const items = await list();
    const cmd = items.find((i) => i.icon === "⌘")!;
    expect(cmd).toMatchObject({ id: "2318", section: "Keyboard" });
    expect(cmd.keywords).toEqual(expect.arrayContaining(["cmd", "command"]));
    expect(items.find((i) => i.icon === "⌥")!.keywords).toContain("option");
    expect(items.find((i) => i.icon === "⎋")!.keywords).toContain("escape");
    expect(items.find((i) => i.icon === "⏎")!.keywords).toContain("return");
    expect(items.find((i) => i.icon === "ğ")!.keywords).toContain("turkish");
    expect(items.find((i) => i.icon === "ß")!.keywords).toContain("german");
    expect(items.find((i) => i.icon === "œ")!.keywords).toContain("french");
    expect(items.find((i) => i.icon === "α")!.keywords).toContain("\\alpha");
    expect(items.find((i) => i.icon === "€")!.keywords).toContain("eur");
  });

  test("a space draws as the open box and its name says which space it is", async () => {
    const items = await list();
    const nbsp = items.find((i) => i.id === "00A0")!;
    expect(nbsp).toMatchObject({ name: "no-break space", icon: "␣", section: "Spaces" });
    expect(nbsp.keywords).toContain("nbsp");
    expect(items.find((i) => i.id === "200B")).toMatchObject({ name: "zero width space", icon: "␣" });
  });

  test("picks: the character, paste, the code point, the named or numeric entity", async () => {
    expect(await pick("2192")).toEqual({ copy: "→" });
    expect(await pick("2192", "copy")).toEqual({ copy: "→" });
    expect(await pick("2192", "paste")).toEqual({ paste: { text: "→" } });
    expect(await pick("2192", "codepoint")).toEqual({ copy: "U+2192" });
    expect(await pick("2192", "entity")).toEqual({ copy: "&rarr;" });
    expect(await pick("2192", "numeric")).toEqual({ copy: "&#x2192;" });
    // A code point with no entity name copies the numeric reference for both.
    expect(await pick("2318", "entity")).toEqual({ copy: "&#x2318;" });
    // An astral one is one character, four UTF-8 bytes.
    expect(await pick("1F5B1")).toEqual({ copy: "🖱" });
    expect(await pick("nope")).toEqual({ toast: { title: "Unknown character", message: "nope", style: "failure" } });
  });

  test("the picked characters lead the next listing in a Recent section, newest first, and leave their block", async () => {
    const items = await list();
    expect(items.slice(0, 3).map((i) => [i.id, i.section])).toEqual([["1F5B1", "Recent"], ["2318", "Recent"], ["2192", "Recent"]]);
    expect(items.filter((i) => i.id === "2192")).toHaveLength(1);
    expect(items[3].section).toBe("Keyboard");
    await pick("2192");
    expect((await list()).slice(0, 2).map((i) => i.id)).toEqual(["2192", "1F5B1"]);
  });

  test("detail: the glyph as an image, block, code point, entities, UTF-8 bytes, LaTeX, aliases", async () => {
    const d = await host.detail("unicode", "unicode", "2192");
    expect(d.markdown).toMatch(/^!\[rightwards arrow\]\(data:image\/svg\+xml,[^)]+\)\n\n\*\*rightwards arrow\*\*$/);
    expect(decodeURIComponent(d.markdown!.split("(")[1].split(")")[0].slice("data:image/svg+xml,".length))).toContain(">→</text>");
    expect(d.metadata).toEqual([
      { label: "Block", value: "Arrows" },
      { label: "Code point", value: "U+2192" },
      { label: "HTML", value: "&rarr; &#x2192;" },
      { label: "UTF-8", value: "E2 86 92" },
      { label: "LaTeX", value: "\\rightarrow" },
      { label: "Also", tags: [{ text: "right" }, { text: "arrow" }, { text: "right arrow" }, { text: "rarr" }, { text: "srarr" }, { text: "rightarrow" }] },
    ]);
    expect((await host.detail("unicode", "unicode", "1F5B1")).metadata).toContainEqual({ label: "UTF-8", value: "F0 9F 96 B1" });
    expect((await host.detail("unicode", "unicode", "0041")).metadata).toBeUndefined();
  });
});

describe("unicode columns setting", () => {
  test("is read at load from [palettes.unicode]", async () => {
    const h = await Host.bundled({ settings: { unicode: { palettes: { unicode: { columns: 6 } } } } });
    expect(h.loaded().find((l) => l.extension === "unicode")!.palettes[0].columns).toBe(6);
    h.kill();
  });
});
