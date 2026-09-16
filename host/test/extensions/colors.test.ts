// colors: the maths (color.ts, imported directly), then the swatch grid
// and the converter through the host.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { BLACK, CSS_NAMES, WHITE, complementary, contrast, lighten, luminance, nameOf, nearestName, parse, swatch, toHex, toHslString, toHwb, toOklch, toRgb, wcag } from "../../../extensions/colors/color.ts";
import { Host } from "../harness.ts";

describe("color.ts", () => {
  test("parses hex in every length, with and without the hash, upper or lower case", () => {
    expect(parse("#ff8800")).toEqual({ r: 255, g: 136, b: 0, a: 1 });
    expect(parse("ff8800")).toEqual({ r: 255, g: 136, b: 0, a: 1 });
    expect(parse("f80")).toEqual({ r: 255, g: 136, b: 0, a: 1 });
    expect(parse("#F80")).toEqual({ r: 255, g: 136, b: 0, a: 1 });
    expect(parse("#f80f")).toEqual({ r: 255, g: 136, b: 0, a: 1 });
    expect(parse("#ff880080")!.a).toBeCloseTo(0.502, 2);
    expect(parse("  #abc  ")).toEqual({ r: 170, g: 187, b: 204, a: 1 });
    for (const bad of ["#ggg", "#12345", "#1234567", "", "   ", "nope", "rgb(1, 2)", "hsl(a b c)", "rgb()"]) expect(parse(bad)).toBeUndefined();
  });

  test("parses rgb() in the comma and the space syntax, percentages, alpha, and a bare triple", () => {
    expect(parse("rgb(255, 136, 0)")).toEqual({ r: 255, g: 136, b: 0, a: 1 });
    expect(parse("rgb(255 136 0)")).toEqual({ r: 255, g: 136, b: 0, a: 1 });
    expect(parse("RGB(100%, 0%, 50%)")).toEqual({ r: 255, g: 0, b: 128, a: 1 });
    expect(parse("rgb(255 136 0 / 50%)")).toEqual({ r: 255, g: 136, b: 0, a: 0.5 });
    expect(parse("rgba(255, 136, 0, 0.25)")).toEqual({ r: 255, g: 136, b: 0, a: 0.25 });
    expect(parse("255 136 0")).toEqual({ r: 255, g: 136, b: 0, a: 1 });
    expect(parse("255,136,0")).toEqual({ r: 255, g: 136, b: 0, a: 1 });
    expect(parse("rgb(300, -5, 0)")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
  });

  test("parses hsl(), hwb() and oklch() with hue units, and CSS names", () => {
    expect(parse("hsl(30 100% 50%)")).toEqual({ r: 255, g: 128, b: 0, a: 1 });
    expect(parse("hsl(30, 100%, 50%)")).toEqual({ r: 255, g: 128, b: 0, a: 1 });
    expect(parse("hsl(0.5turn 50% 50%)")).toEqual({ r: 64, g: 191, b: 191, a: 1 });
    expect(parse("hsl(120deg 100% 25% / 0.5)")).toEqual({ r: 0, g: 128, b: 0, a: 0.5 });
    expect(parse("hwb(30 0% 0%)")).toEqual({ r: 255, g: 128, b: 0, a: 1 });
    expect(parse("hwb(0 50% 50%)")).toEqual({ r: 128, g: 128, b: 128, a: 1 });
    expect(parse("oklch(62.8% 0.2577 29.23)")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(parse("oklch(1 0 0)")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parse("Red")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(parse("rebeccapurple")).toEqual({ r: 102, g: 51, b: 153, a: 1 });
    expect(parse("transparent")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(Object.keys(CSS_NAMES)).toHaveLength(148);
    expect(CSS_NAMES.gray).toBe(CSS_NAMES.grey);
  });

  test("formats every notation, alpha included", () => {
    const c = parse("#ff8800")!;
    expect(toHex(c)).toBe("#ff8800");
    expect(toRgb(c)).toBe("rgb(255, 136, 0)");
    expect(toHslString(c)).toBe("hsl(32, 100%, 50%)");
    expect(toHwb(c)).toBe("hwb(32 0% 0%)");
    expect(toOklch(c)).toBe("oklch(0.744 0.181 56.5)");
    const t = parse("rgb(255 136 0 / 50%)")!;
    expect(toHex(t)).toBe("#ff880080");
    expect(toRgb(t)).toBe("rgba(255, 136, 0, 0.5)");
    expect(toHslString(t)).toBe("hsla(32, 100%, 50%, 0.5)");
    expect(toHwb(t)).toBe("hwb(32 0% 0% / 0.5)");
    expect(toOklch(t)).toBe("oklch(0.744 0.181 56.5 / 0.5)");
    // Reference points: OKLCH of pure red and of white (Ottosson's tables), HSL of a grey.
    expect(toOklch(parse("red")!)).toBe("oklch(0.628 0.258 29.2)");
    expect(toOklch(WHITE)).toBe("oklch(1 0 0)");
    expect(toHslString(parse("#808080")!)).toBe("hsl(0, 0%, 50%)");
    expect(toHwb(WHITE)).toBe("hwb(0 100% 0%)");
  });

  test("hsl and oklch strings round-trip through sRGB within the rounding (integer percents, three decimals)", () => {
    for (const hex of ["#ff8800", "#663399", "#1a1a1f", "#7fb0ff", "#0b6664", "#fafafa"]) {
      const c = parse(hex)!;
      for (const back of [parse(toHslString(c))!, parse(toOklch(c))!]) for (const k of ["r", "g", "b"] as const) expect(Math.abs(back[k] - c[k])).toBeLessThanOrEqual(2);
    }
  });

  test("names: exact, and the nearest in OKLab", () => {
    expect(nameOf(parse("#ff0000")!)).toBe("red");
    expect(nameOf(parse("#808080")!)).toBe("gray");
    expect(nameOf(parse("#ff8800")!)).toBeUndefined();
    expect(nearestName(parse("#ff8800")!)).toMatchObject({ name: "darkorange" });
    expect(nearestName(parse("#ff8800")!).distance).toBeLessThan(0.02);
    expect(nearestName(parse("#663399")!)).toEqual({ name: "rebeccapurple", distance: 0 });
    expect(nearestName(parse("#4f46d6")!).name).toBe("slateblue");
  });

  test("WCAG luminance, contrast and levels", () => {
    expect(luminance(WHITE)).toBe(1);
    expect(luminance(BLACK)).toBe(0);
    expect(contrast(WHITE, BLACK)).toBe(21);
    expect(contrast(BLACK, WHITE)).toBe(21);
    expect(contrast(parse("#663399")!, WHITE)).toBeCloseTo(8.41, 2);
    expect(contrast(parse("#ff0000")!, WHITE)).toBeCloseTo(4.0, 2);
    expect(wcag(21)).toBe("AAA");
    expect(wcag(7)).toBe("AAA");
    expect(wcag(4.5)).toBe("AA");
    expect(wcag(3)).toBe("AA large");
    expect(wcag(2.99)).toBe("fail");
  });

  test("relatives: the complement is across the wheel, lighten moves HSL lightness and clamps", () => {
    expect(toHex(complementary(parse("#ff0000")!))).toBe("#00ffff");
    expect(toHex(complementary(parse("#663399")!))).toBe("#669933");
    expect(toHslString(lighten(parse("hsl(200, 50%, 40%)")!, 0.2))).toBe("hsl(200, 50%, 60%)");
    expect(toHex(lighten(WHITE, 0.3))).toBe("#ffffff");
    expect(toHex(lighten(BLACK, -0.3))).toBe("#000000");
  });

  test("the swatch is an SVG data url filled with the colour", () => {
    const s = swatch("#ff8800");
    expect(s.startsWith("data:image/svg+xml,")).toBe(true);
    expect(decodeURIComponent(s)).toContain('fill="#ff8800"');
  });
});

let host: Host;
beforeAll(async () => { host = await Host.bundled(); });
afterAll(() => host.kill());

const grid = () => host.list("colors", "colors");
const convert = (q?: string) => host.list("colors", "convert", q);

describe("colors grid", () => {
  test("meta: a swatch grid of 8 columns with a lazy detail, and the converter as an input palette", () => {
    const l = host.loaded().find((l) => l.extension === "colors")!;
    expect(l.palettes).toEqual([
      { name: "colors", title: "Colors", live: false, input: false, icon: "#4F46D6", view: "grid", columns: 8, detail: "lazy" },
      { name: "convert", title: "Convert colour", live: false, input: true, icon: "#4F46D6", placeholder: "#ff8800, rgb(255 136 0), hsl(30 100% 50%), a name" },
    ]);
  });

  test("700 rows in four sections; a tile is an SVG swatch of its hex, the hex and the token are keywords", async () => {
    const items = await grid();
    expect(items).toHaveLength(700);
    expect(new Set(items.map((i) => i.id)).size).toBe(700);
    expect([...new Set(items.map((i) => i.section))]).toEqual(["CSS", "pal tokens", "Tailwind", "Material"]);
    expect(items.filter((i) => i.section === "CSS")).toHaveLength(148);
    expect(items.filter((i) => i.section === "Tailwind")).toHaveLength(244);
    expect(items.filter((i) => i.section === "Material")).toHaveLength(254);
    const slate = items.find((i) => i.id === "tw/slate-500")!;
    expect(slate).toMatchObject({ name: "slate 500", subtitle: "#64748b", icon: { image: swatch("#64748b") }, keywords: ["#64748b", "slate-500", "tailwind"], section: "Tailwind" });
    expect(slate.actions!.map((a) => a.id)).toEqual(["hex", "rgb", "hsl", "name"]);
    expect(items.find((i) => i.id === "pal/light/accent")).toMatchObject({ name: "accent (light)", subtitle: "#4f46d6", keywords: ["#4f46d6", "accent", "pal tokens"] });
    expect(items.find((i) => i.id === "pal/dark/tag-blue")).toMatchObject({ subtitle: "#7fb0ff" });
    expect(items.find((i) => i.id === "md/red-a200")).toMatchObject({ name: "red a200", subtitle: "#ff5252" });
  });

  test("picks copy hex, rgb, hsl or the token name; the picked colours then lead in a Recent section", async () => {
    expect(await host.pick("colors", "colors", "tw/slate-500")).toEqual({ copy: "#64748b" });
    expect(await host.pick("colors", "colors", "tw/slate-500", "rgb")).toEqual({ copy: "rgb(100, 116, 139)" });
    expect(await host.pick("colors", "colors", "tw/slate-500", "hsl")).toEqual({ copy: "hsl(215, 16%, 47%)" });
    expect(await host.pick("colors", "colors", "tw/slate-500", "name")).toEqual({ copy: "slate-500" });
    expect(await host.pick("colors", "colors", "css/rebeccapurple", "name")).toEqual({ copy: "rebeccapurple" });
    expect(await host.pick("colors", "colors", "pal/dark/tag-blue", "name")).toEqual({ copy: "tag-blue" });
    expect(await host.pick("colors", "colors", "nope")).toEqual({ toast: { title: "Unknown colour", message: "nope", style: "failure" } });
    const items = await grid();
    expect(items.slice(0, 3).map((i) => [i.id, i.section])).toEqual([["pal/dark/tag-blue", "Recent"], ["css/rebeccapurple", "Recent"], ["tw/slate-500", "Recent"]]);
    expect(items).toHaveLength(700);
    expect(items[3].section).toBe("CSS");
  });

  test("detail: a wide swatch, every notation, the name, contrast with levels, relatives as coloured tags", async () => {
    const d = await host.detail("colors", "colors", "css/rebeccapurple");
    expect(d.markdown).toMatch(/^!\[#663399\]\(data:image\/svg\+xml,[^)]+\)\n\n\*\*rebeccapurple\*\*$/);
    expect(d.metadata).toEqual([
      { label: "Hex", value: "#663399" },
      { label: "RGB", value: "rgb(102, 51, 153)" },
      { label: "HSL", value: "hsl(270, 50%, 40%)" },
      { label: "HWB", value: "hwb(270 20% 40%)" },
      { label: "OKLCH", value: "oklch(0.44 0.16 303.4)" },
      { label: "CSS name", value: "rebeccapurple" },
      { label: "On white", value: "8.41:1", tags: [{ text: "AAA", color: "green" }] },
      { label: "On black", value: "2.50:1", tags: [{ text: "fail", color: "red" }] },
      { label: "Complementary", tags: [{ text: "#669933", color: "#669933" }] },
      { label: "Lighter", tags: [{ text: "#8040bf", color: "#8040bf" }, { text: "#9966cc", color: "#9966cc" }, { text: "#b38cd9", color: "#b38cd9" }] },
      { label: "Darker", tags: [{ text: "#4d2673", color: "#4d2673" }, { text: "#331a4d", color: "#331a4d" }, { text: "#1a0d26", color: "#1a0d26" }] },
    ]);
    const near = await host.detail("colors", "colors", "tw/slate-500");
    expect(near.metadata).toContainEqual({ label: "Nearest name", value: "slategray", tags: [{ text: "near", color: "grey" }] });
  });
});

describe("colors convert", () => {
  test("empty: two inert hints; not a colour: one hint naming the input", async () => {
    const hints = await convert("");
    expect(hints.map((h) => h.actions)).toEqual([[], []]);
    expect(hints[0].name).toBe("Type a colour");
    expect(await convert()).toEqual(hints);
    const bad = await convert("zzz");
    expect(bad).toHaveLength(1);
    expect(bad[0]).toMatchObject({ name: "Not a colour", subtitle: "zzz is none of hex, rgb(), hsl(), hwb(), oklch() or a CSS name", actions: [] });
    expect(await host.pick("colors", "convert", bad[0].id)).toEqual({ keep: true });
  });

  test("a colour lists its notations, the nearest name and the contrast rows, each with a swatch and an inline detail; Enter copies the row", async () => {
    const rows = await convert("hsl(30 100% 50%)");
    expect(rows.map((r) => [r.id, r.name, r.subtitle])).toEqual([
      ["#ff8000", "#ff8000", "hex"],
      ["rgb(255, 128, 0)", "rgb(255, 128, 0)", "rgb"],
      ["hsl(30, 100%, 50%)", "hsl(30, 100%, 50%)", "hsl"],
      ["hwb(30 0% 0%)", "hwb(30 0% 0%)", "hwb"],
      ["oklch(0.732 0.186 53)", "oklch(0.732 0.186 53)", "oklch"],
      ["darkorange", "darkorange", "nearest CSS name, #ff8c00"],
      ["2.52:1", "2.52:1 on white", "contrast ratio"],
      ["8.34:1", "8.34:1 on black", "contrast ratio"],
    ]);
    expect(rows[5].accessories).toEqual([{ tag: "near", color: "grey" }]);
    expect(rows[6].accessories).toEqual([{ tag: "fail", color: "red" }]);
    expect(rows[7].accessories).toEqual([{ tag: "AAA", color: "green" }]);
    expect(rows.every((r) => (r.icon as { image: string }).image === swatch("#ff8000"))).toBe(true);
    expect(rows.every((r) => r.detail?.markdown?.includes("**#ff8000**") && r.detail.metadata!.length === 11)).toBe(true);
    expect(rows.every((r) => r.actions!.length === 1 && r.actions![0].id === "copy")).toBe(true);
    expect(await host.pick("colors", "convert", "rgb(255, 128, 0)")).toEqual({ copy: "rgb(255, 128, 0)" });
    expect(await host.pick("colors", "convert", "#ff8000", "copy")).toEqual({ copy: "#ff8000" });
  });

  test("a named colour shows the CSS name row; alpha rides through every notation", async () => {
    const red = await convert("red");
    expect(red[5]).toMatchObject({ id: "red", subtitle: "CSS name" });
    expect(red[5].accessories).toBeUndefined();
    expect(red[0].detail!.markdown).toContain("**red**");
    const half = await convert("rgb(255 136 0 / 50%)");
    expect(half.slice(0, 5).map((r) => r.id)).toEqual(["#ff880080", "rgba(255, 136, 0, 0.5)", "hsla(32, 100%, 50%, 0.5)", "hwb(32 0% 0% / 0.5)", "oklch(0.744 0.181 56.5 / 0.5)"]);
  });
});

describe("colors columns setting", () => {
  test("is read at load from [palettes.colors]", async () => {
    const h = await Host.bundled({ settings: { colors: { palettes: { colors: { columns: 12 } } } } });
    expect(h.loaded().find((l) => l.extension === "colors")!.palettes[0].columns).toBe(12);
    h.kill();
  });
});
