// colors: the maths (color.ts, imported directly), then the swatch grid
// and the converter through the host.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { BLACK, CSS_NAMES, WHITE, adjust, complementary, contrast, format, fromLab, harmony, inGamut, lighten, luminance, maxChroma, nameOf, nearestIn, nearestName, parse, shades, swatch, tints, toHex, toHslString, toHwb, toLab, toOklabString, toOklch, toOklchValues, toP3, toRgb, wcag } from "../../../extensions/colors/color.ts";
import { actions, hueStops, plane, readout, render, vivid } from "../../../extensions/colors/render.ts";
import { conversions, detailOf, gridItem, historyRows } from "../../../extensions/colors/rows.ts";
import { SETS, handKept, sectionOf, token, usage, type Row } from "../../../extensions/colors/sets.ts";
import { DEFAULTS, ago, apply, fresh, previous, remember, type State } from "../../../extensions/colors/state.ts";
import data from "../../../extensions/colors/data.json";
import type { View, ViewNode } from "../../../sdk/src/protocol.ts";
import { checkView } from "../../../sdk/src/view.ts";
import { Host, stored } from "../harness.ts";

const rows = data as Row[];
const tokens = { tailwind: rows.filter((r) => r.s === "tailwind"), material: rows.filter((r) => r.s === "material") };
const orange = parse("#ff8800")!;

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

  test("the swatch is an SVG data url filled with the colour, with only the hash escaped", () => {
    const s = swatch("#ff8800");
    expect(s.startsWith("data:image/svg+xml,<svg ")).toBe(true);
    expect(s).toContain("fill='%23ff8800'");
    expect(s).not.toContain("#");
    expect(s.length).toBeLessThan(130);
  });

  test("lab() is CIE Lab against D50 as CSS means it, display-p3 goes through XYZ: the spec's reference points, and both parse back", () => {
    expect(toLab(parse("red")!)).toBe("lab(54.29 80.8 69.89)");
    expect(toLab(WHITE)).toBe("lab(100 0 0)");
    expect(toLab(BLACK)).toBe("lab(0 0 0)");
    expect(toP3(parse("red")!)).toBe("color(display-p3 0.917 0.2 0.139)");
    expect(toP3(WHITE)).toBe("color(display-p3 1 1 1)");
    expect(toOklabString(parse("red")!)).toBe("oklab(0.628 0.225 0.126)");
    // CSS Color 4's examples: lab(29.2345% 39.3825 20.0664) is #7d2329, lab(52.2345% 40.1645 59.9971) is rgb(198, 93, 7).
    expect(toHex(fromLab(29.2345, 39.3825, 20.0664))).toBe("#7d2329");
    expect(toHex(parse("lab(52.2345% 40.1645 59.9971)")!)).toBe("#c65d06");
    expect(toHex(parse("color(display-p3 0.9175 0.2003 0.1386)")!)).toBe("#ff0000");
    expect(toHex(parse("color(srgb 1 0.533 0)")!)).toBe("#ff8800");
    expect(toHex(parse("oklab(0.628 0.225 0.126)")!)).toBe("#ff0000");
    expect(parse("lab(50 0 0 / 0.5)")!.a).toBe(0.5);
    expect(parse("color(rec2020 1 0 0)")).toBeUndefined();
    for (const hex of ["#ff8800", "#663399", "#1a1a1f", "#7fb0ff", "#0b6664"]) {
      const c = parse(hex)!;
      for (const back of [parse(toLab(c))!, parse(toP3(c))!, parse(toOklabString(c))!]) for (const k of ["r", "g", "b"] as const) expect(Math.abs(back[k] - c[k])).toBeLessThanOrEqual(2);
    }
  });

  test("OKLCH steps stay inside the gamut by reducing chroma, HSL steps wrap the hue and clamp", () => {
    expect(inGamut(0.5, 0.1, 30)).toBe(true);
    expect(inGamut(0.5, 0.35, 30)).toBe(false);
    expect(maxChroma(0.628, 29.2)).toBeCloseTo(0.2577, 3);
    expect(maxChroma(0, 100)).toBe(0);
    expect(maxChroma(1, 100)).toBe(0);
    // Five chroma steps up from pure red would leave sRGB; the colour lands on the gamut edge instead of clipping to a different hue.
    const pushed = adjust(parse("red")!, "oklch", "s", 5);
    expect(toHex(pushed)).toBe("#ff0000");
    const lighter = adjust(parse("red")!, "oklch", "l", 5);
    expect(toOklchValues(lighter).L).toBeCloseTo(0.728, 2);
    expect(toHex(adjust(orange, "hsl", "h", 1))).toBe("#ff9d00");
    expect(toHex(adjust(parse("hsl(358 100% 50%)")!, "hsl", "h", 1))).toBe("#ff0d00");
    expect(toHex(adjust(WHITE, "hsl", "l", 3))).toBe("#ffffff");
    expect(toHex(adjust(parse("hsl(200 50% 40%)")!, "hsl", "s", -2))).toBe(toHex(parse("hsl(200 40% 40%)")!));
    expect(adjust(parse("#ff880080")!, "hsl", "l", 1).a).toBeCloseTo(0.502, 2);
  });

  test("tints and shades are nine steps towards white and black; the harmonies turn the hue and keep the rest", () => {
    expect(tints(parse("red")!).map(toHex)).toEqual(["#ff1a1a", "#ff3333", "#ff4d4d", "#ff6666", "#ff8080", "#ff9999", "#ffb3b3", "#ffcccc", "#ffe5e5"]);
    expect(shades(parse("red")!).map(toHex)).toEqual(["#e60000", "#cc0000", "#b30000", "#990000", "#800000", "#660000", "#4d0000", "#330000", "#190000"]);
    expect(harmony(parse("red")!, "complementary").map(toHex)).toEqual(["#00ffff"]);
    expect(harmony(parse("red")!, "analogous").map(toHex)).toEqual(["#ff0080", "#ff8000"]);
    expect(harmony(parse("red")!, "triadic").map(toHex)).toEqual(["#00ff00", "#0000ff"]);
    expect(harmony(parse("red")!, "split").map(toHex)).toEqual(["#00ff80", "#0080ff"]);
    expect(harmony(parse("red")!, "tetradic").map(toHex)).toEqual(["#80ff00", "#00ffff", "#8000ff"]);
    expect(harmony(parse("hsl(200 50% 40%)")!, "complementary").map(toHslString)).toEqual(["hsl(20, 50%, 40%)"]);
  });

  test("format writes every notation with the settings' case and alpha", () => {
    const t = parse("#ff880080")!;
    expect(format(t, "hex")).toBe("#ff880080");
    expect(format(t, "hex", { upper: true })).toBe("#FF880080");
    expect(format(t, "hex", { alpha: "drop" })).toBe("#ff8800");
    expect(format(t, "rgb", { alpha: "drop" })).toBe("rgb(255, 136, 0)");
    expect(format(t, "name")).toBe("darkorange");
    expect(format(parse("red")!, "name")).toBe("red");
    expect(format(orange, "p3")).toBe("color(display-p3 0.939 0.558 0.206)");
  });

  test("the nearest token of a table is found in OKLab", () => {
    expect(nearestIn(orange, tokens.tailwind)!.row.id).toBe("tw/orange-400");
    expect(nearestIn(parse("#64748b")!, tokens.tailwind)).toMatchObject({ row: { id: "tw/slate-500" }, distance: 0 });
    expect(nearestIn(orange, tokens.material)!.row.id).toBe("md/orange-600");
    expect(nearestIn(orange, [])).toBeUndefined();
  });
});

describe("sets", () => {
  test("data.json holds every set in the declared order, ids unique, hexes lower case", () => {
    expect(rows).toHaveLength(995);
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
    expect([...new Set(rows.map((r) => r.s))]).toEqual(SETS.map((s) => s.id));
    expect(rows.every((r) => /^#[0-9a-f]{6}$/.test(r.h))).toBe(true);
    const count = (id: string) => rows.filter((r) => r.s === id).length;
    expect([count("css"), count("tailwind"), count("material3"), count("material"), count("apple"), count("catppuccin"), count("rosepine"), count("nord"), count("solarized"), count("pal")]).toEqual([148, 244, 78, 254, 36, 104, 45, 16, 16, 54]);
    expect(rows.find((r) => r.id === "m3/primary-40")!.h).toBe("#6750a4");
    expect(rows.find((r) => r.id === "ctp/mocha/mauve")!.h).toBe("#cba6f7");
    expect(rows.find((r) => r.id === "apple/light/blue")!.h).toBe("#007aff");
    expect(rows.find((r) => r.id === "rp/dawn/pine")!.h).toBe("#286983");
    expect(rows.find((r) => r.id === "nord/nord8")!.h).toBe("#88c0d0");
    expect(rows.find((r) => r.id === "sol/base03")!.h).toBe("#002b36");
    expect(handKept()).toHaveLength(36 + 45 + 16 + 16);
  });

  test("a token is spelled as its set uses it, the section names the variant, and the usage line says where it goes", () => {
    const byId = (id: string) => rows.find((r) => r.id === id)!;
    expect(token(byId("tw/slate-500"))).toBe("slate-500");
    expect(token(byId("apple/dark/blue"))).toBe("systemBlue");
    expect(token(byId("pal/light/accent"))).toBe("--pal-accent");
    expect(token(byId("ctp/mocha/mauve"))).toBe("mocha/mauve");
    expect(sectionOf(byId("ctp/mocha/mauve"))).toBe("Catppuccin Mocha");
    expect(sectionOf(byId("apple/dark/blue"))).toBe("Apple dark");
    expect(sectionOf(byId("nord/nord8"))).toBe("Nord");
    expect(usage(byId("tw/slate-500"))).toContain("`bg-slate-500`");
    expect(usage(byId("tw/slate-500"))).toContain("base shade");
    expect(usage(byId("m3/primary-40"))).toContain("md.sys.color.primary");
    expect(usage(byId("apple/dark/blue"))).toContain("UIColor.systemBlue");
    expect(usage(byId("ctp/mocha/mauve"))).toContain("keywords");
    expect(usage(byId("rp/main/love"))).toContain("errors");
    expect(usage(byId("nord/nord8"))).toContain("Frost");
    expect(usage(byId("sol/base03"))).toContain("dark background");
    expect(usage(byId("css/aliceblue"))).toContain("color: aliceblue");
    const tile = gridItem(byId("ctp/mocha/mauve"), "Catppuccin Mocha");
    expect(tile).toMatchObject({ id: "ctp/mocha/mauve", name: "mauve", subtitle: "#cba6f7 · mocha", keywords: ["#cba6f7", "mocha/mauve", "catppuccin", "mocha"], section: "Catppuccin Mocha" });
  });
});

describe("picker state", () => {
  const max = 5;
  test("a set colour leads the history once, newest first, capped, and the swatch takes the focus", () => {
    let st = fresh();
    st = apply(st, { kind: "set", color: orange, from: "screen", at: 1 }, max);
    st = apply(st, { kind: "set", color: parse("#663399")!, from: "typed", at: 2 }, max);
    st = apply(st, { kind: "set", color: orange, from: "set", name: "x", at: 3 }, max);
    expect(st.history.map((h) => [h.c, h.from, h.at])).toEqual([["#ff8800", "set", 3], ["#663399", "typed", 2]]);
    expect(toHex(st.color)).toBe("#ff8800");
    expect(previous(st)).toEqual(parse("#663399"));
    for (let i = 0; i < 9; i++) st = apply(st, { kind: "set", color: parse(`hsl(${i * 40} 50% 50%)`)!, from: "picker", at: 10 + i }, max);
    expect(st.history).toHaveLength(max);
    expect(remember([], { c: "#000000", at: 1, from: "typed" }, 0)).toHaveLength(1);
  });

  test("steps edit the colour on the swatch only; Tab walks the rows and the arrows the tiles; Enter on a tile takes it", () => {
    let st = apply(fresh(), { kind: "set", color: orange, from: "typed", at: 1 }, max);
    st = apply(st, { kind: "step", axis: "h", steps: 1 }, max);
    expect(toHex(st.color)).toBe("#ff9d00");
    st = apply(st, { kind: "focus", dir: 1 }, max);
    expect(st.focus).toBe("tints");
    expect(apply(st, { kind: "step", axis: "h", steps: 1 }, max)).toBe(st);
    st = apply(st, { kind: "focus", dir: 1 }, max);
    st = apply(st, { kind: "along", dir: -1 }, max);
    expect([st.focus, st.index]).toEqual(["shades", 8]);
    st = apply(st, { kind: "use", at: 2 }, max);
    expect(toHex(st.color)).toBe(toHex(shades(parse("#ff9d00")!)[8]));
    expect(st.focus).toBe("swatch");
    expect(st.history[0]).toMatchObject({ c: toHex(st.color), from: "picker" });
    expect(apply(apply(st, { kind: "focus", dir: -1 }, max), { kind: "focus", dir: -1 }, max).focus).toBe("split");
  });

  test("the model toggles, undo goes back to the previous colour, typing opens and applies or stays open on junk", () => {
    let st = apply(fresh(), { kind: "set", color: orange, from: "typed", at: 1 }, max);
    st = apply(st, { kind: "set", color: parse("#663399")!, from: "typed", at: 2 }, max);
    expect(apply(st, { kind: "model" }, max).model).toBe("oklch");
    expect(toHex(apply(st, { kind: "undo" }, max).color)).toBe("#ff8800");
    st = apply(st, { kind: "type", text: "#" }, max);
    expect(st.typing).toBe("#");
    const junk = apply(st, { kind: "apply", text: "nope", at: 3 }, max);
    expect(junk.typing).toBe("nope");
    const ok = apply(st, { kind: "apply", text: "rgb(0 0 255)", at: 3 }, max);
    expect([ok.typing, toHex(ok.color), ok.history[0].from]).toEqual([undefined, "#0000ff", "typed"]);
    expect(apply(st, { kind: "copied", at: 4 }, max).history[0]).toMatchObject({ c: "#663399", at: 4, from: "picker" });
    expect(apply(st, { kind: "clear" }, max).history).toEqual([]);
    expect(toHslString(apply(st, { kind: "random", hue: 200, sat: 70, light: 50 }, max).color)).toBe("hsl(200, 70%, 50%)");
  });

  test("ago reads as people say it", () => {
    const now = 1_000_000_000;
    expect(ago(now, now)).toBe("just now");
    expect(ago(now - 4 * 60_000, now)).toBe("4 min ago");
    expect(ago(now - 2 * 3_600_000, now)).toBe("2 h ago");
    expect(ago(now - 26 * 3_600_000, now)).toBe("yesterday");
    expect(ago(now - 3 * 86_400_000, now)).toBe("3 d ago");
  });
});

describe("picker tree", () => {
  const base: State = { ...fresh(), color: orange, history: [{ c: "#ff8800", at: 2, from: "screen" }, { c: "#663399", at: 1, from: "typed" }] };
  const find = (n: ViewNode, pred: (n: ViewNode) => boolean, into: ViewNode[] = []): ViewNode[] => { if (pred(n)) into.push(n); if (n.type === "stack") for (const c of n.children) find(c, pred, into); return into; };

  test("passes checkView and draws the swatch, strip, plane, notations, tokens, contrast and the scales in the colour itself", () => {
    const v = render(base, DEFAULTS, tokens);
    expect(checkView(v)).toBe(v);
    expect(v).toMatchObject({ id: "picker", keys: "actions", title: "#ff8800" });
    expect(v.input).toBeUndefined();
    const tiles = find(v.tree, (n) => n.type === "tile") as Extract<ViewNode, { type: "tile" }>[];
    expect(tiles[0]).toMatchObject({ width: 160, height: 116, color: "#ff8800" });
    // Nine tints, nine shades, 1 + 2 + 2 + 2 + 3 harmony tiles, two token dots, the previous colour's dot.
    expect(tiles.filter((t) => t.width === 16)).toHaveLength(9 + 9 + 10);
    const gradients = find(v.tree, (n) => n.type === "gradient") as Extract<ViewNode, { type: "gradient" }>[];
    expect(gradients).toHaveLength(2);
    expect(gradients[0].layers[0].stops).toEqual(["#ff0000", "#ffff00", "#00ff00", "#00ffff", "#0000ff", "#ff00ff", "#ff0000"]);
    expect(gradients[0].marker!.x).toBeCloseTo(32 / 360, 2);
    // The classic plane: the pure hue as the fill, white to transparent rightwards, black to transparent upwards; #ff8800 is HSV (32, 100%, 100%), the top right corner.
    expect(gradients[1]).toMatchObject({ fill: "#ff8800", layers: [{ stops: ["#ffffff", "#ffffff00"], direction: "right" }, { stops: ["#000000", "#00000000"], direction: "up" }], marker: { x: 1, y: 0 } });
    const grey = plane({ ...base, color: parse("hsl(200 50% 40%)")! });
    expect(grey.fill).toBe("#00aaff");
    expect(grey.marker.x).toBeCloseTo(2 / 3, 3);
    expect(grey.marker.y).toBeCloseTo(0.4, 3);
    const texts = find(v.tree, (n) => n.type === "text").map((n) => (n as Extract<ViewNode, { type: "text" }>).value);
    for (const t of ["#ff8800", "rgb(255, 136, 0)", "hsl(32, 100%, 50%)", "oklch(0.744 0.181 56.5)", "lab(69.4 41.7 75.66)", "color(display-p3 0.939 0.558 0.206)", "darkorange (nearest)", "orange-400", "orange-600", "2.39:1", "8.77:1"]) expect(texts).toContain(t);
    const badges = find(v.tree, (n) => n.type === "badge").map((n) => (n as Extract<ViewNode, { type: "badge" }>).text);
    expect(badges).toEqual(["HSL", "fail", "AAA", "AA large"]);
    expect(readout(base)).toBe("32° 100% 50%");
    expect(readout({ ...base, model: "oklch" })).toBe("0.744 0.181 56.5°");
    const ok = plane({ ...base, model: "oklch" });
    expect(ok.marker.x).toBeCloseTo(1, 1);
    expect(ok.marker.y).toBeCloseTo(1 - 0.744, 2);
    expect(ok.fill).toBe(vivid(toOklchValues(base.color).H));
    expect(hueStops({ ...base, model: "oklch" })).toHaveLength(13);
    expect(hueStops({ ...base, model: "oklch" })[0]).toBe(vivid(0));
    expect(render({ ...base, color: parse("red")!, history: [] }, { ...DEFAULTS, uppercase: true }, tokens).title).toBe("#ff0000 · red");
  });

  test("the actions: Copy in the chosen notation on Enter and c, hex on cmd+c, the steps hidden on the swatch, Use on a row, typing on the digits, and the tree with the field open", () => {
    const a = actions(base, DEFAULTS);
    expect(a[0]).toMatchObject({ id: "copy", title: "Copy #ff8800", shortcut: "c" });
    expect(a.find((x) => x.id === "copy:hex")!.shortcut).toBe("cmd+c");
    expect(a.find((x) => x.id === "pick")!.shortcut).toBe("p");
    expect(a.find((x) => x.id === "h++")).toMatchObject({ shortcut: "shift+right", hidden: true });
    expect(a.find((x) => x.id === "s+")!.shortcut).toEqual(["+", "="]);
    expect(a.find((x) => x.id === "type:#")).toMatchObject({ shortcut: "#", hidden: true });
    expect(a.filter((x) => x.id.startsWith("type:"))).toHaveLength(11);
    const onRow = actions({ ...base, focus: "shades", index: 2 }, { ...DEFAULTS, format: "rgb" });
    expect(onRow[0]).toMatchObject({ id: "use", title: `Use ${toHex(shades(orange)[2])}`, shortcut: "enter" });
    expect(onRow[1].title).toBe("Copy rgb(255, 136, 0)");
    expect(onRow.find((x) => x.id === "focus:next")!.shortcut).toEqual(["tab", "down"]);
    expect(onRow.find((x) => x.id === "along:next")).toMatchObject({ shortcut: "right", hidden: true });
    expect(onRow.find((x) => x.id === "h+")).toBeUndefined();
    const typing = render({ ...base, typing: "#ff" }, DEFAULTS, tokens);
    expect(checkView(typing).input).toMatchObject({ value: "#ff", submit: "apply", cancel: "cancel" });
  });
});

describe("rows", () => {
  test("the conversions list every notation, the nearest name and the contrast rows; a detail carries the usage of a set's row", () => {
    const rowsOf = conversions(parse("hsl(30 100% 50%)")!, DEFAULTS);
    expect(rowsOf.map((r) => [r.name, r.subtitle])).toEqual([
      ["#ff8000", "hex"], ["rgb(255, 128, 0)", "rgb"], ["hsl(30, 100%, 50%)", "hsl"], ["hwb(30 0% 0%)", "hwb"], ["oklch(0.732 0.186 53)", "oklch"], ["oklab(0.732 0.112 0.148)", "oklab"], ["lab(67.82 45.49 74.84)", "lab"], ["color(display-p3 0.936 0.529 0.199)", "display-p3"],
      ["darkorange", "nearest CSS name, #ff8c00"], ["2.52:1 on white", "contrast ratio"], ["8.34:1 on black", "contrast ratio"],
    ]);
    expect(rowsOf[0].actions!.map((a) => a.id)).toEqual(["open", "copy"]);
    const d = detailOf(parse("#64748b")!, "slate 500", DEFAULTS, rows.find((r) => r.id === "tw/slate-500"));
    expect(d.markdown).toContain("`bg-slate-500`");
    expect(d.metadata!.map((m) => m.label)).toEqual(["Hex", "RGB", "HSL", "HWB", "OKLCH", "OKLab", "Lab", "P3", "Nearest name", "On white", "On black"]);
  });

  test("the history rows: the screen pick first, then each colour with where from and when, the CSS name as the accessory (the notation when it is not hex)", () => {
    const st: State = { ...fresh(), history: [{ c: "#663399", at: 100_000, from: "typed" }, { c: "#64748b", at: 100_000 - 26 * 3_600_000, from: "set", name: "slate-500" }] };
    const r = historyRows(st, DEFAULTS, 100_000 + 5 * 60_000);
    expect(r[0]).toMatchObject({ id: "pick", name: "Pick Colour from Screen", section: "Pick" });
    expect(r[1]).toMatchObject({ id: "#663399", name: "#663399", subtitle: "typed · 5 min ago", accessories: [{ text: "rebeccapurple" }] });
    expect(r[2]).toMatchObject({ id: "#64748b", subtitle: "slate-500 · from a set · yesterday", accessories: [{ text: "≈ slategray" }] });
    expect(historyRows(st, { ...DEFAULTS, format: "rgb" }, 0)[1].accessories).toEqual([{ text: "rgb(102, 51, 153)" }]);
  });
});



let host: Host;
let sampled: { r: number; g: number; b: number; hex: string } | null = { r: 255, g: 136, b: 0, hex: "#ff8800" };
const ran: unknown[] = [];
beforeAll(async () => {
  host = await Host.bundled({ core: { "color.sample": () => sampled, "effects.run": ({ effect }: { effect: unknown }) => { ran.push(effect); return null; } } });
});
afterAll(() => host.kill());

const grid = (ctx?: { filter?: string }) => host.list("colors", "colors", "", ctx);
const convert = (q?: string, ctx?: Parameters<Host["list"]>[3]) => host.list("colors", "convert", q, ctx);
const pickView = (action: string, ctx?: { values?: Record<string, string> }) => host.pick("colors", "picker", "picker", action, ctx).then((r) => r.view as View);
const historyOf = () => (stored.get("colors\0history") ?? []) as { c: string; from: string }[];

describe("colors over the wire", () => {
  test("meta: the picker is a view palette, the grid has a filter per set and the four actions, history a list, the converter an input palette; no manifest warnings", async () => {
    const l = host.loaded().find((l) => l.extension === "colors")!;
    expect(l.warnings).toEqual([]);
    expect(l.palettes.map((p) => [p.name, p.view, p.input, p.live, p.tier])).toEqual([["picker", "view", true, false, undefined], ["colors", "grid", false, false, "catalog"], ["history", undefined, false, true, undefined], ["convert", undefined, true, false, undefined]]);
    expect(l.palettes[1].filters!.map((f) => f.id)).toEqual(["all", ...SETS.map((s) => s.id)]);
    expect(l.palettes[1].actions!.map((a) => a.id)).toEqual(["open", "copy", "hex", "name"]);
    expect(l.palettes[1].columns).toBe(8);
    expect(l.palettes[2].actions!.map((a) => a.id)).toEqual(["open", "copy", "hex", "delete", "clear"]);
    expect(l.manifest.settings!.map((s) => s.id)).toEqual(["format", "uppercase", "alpha", "sets", "history_size"]);
  });

  test("the picker opens on the accent with nothing stored, a step persists the colour, Escape and reopening keep it", async () => {
    const v = await host.request<View>("view", { extension: "colors", palette: "picker" });
    expect(v.title).toBe("#4f46d6");
    const after = await pickView("h+");
    expect(after.title).toBe("#5b46d6");
    expect(stored.get("colors\0current")).toBe("#5b46d6");
    const again = await host.request<View>("view", { extension: "colors", palette: "picker" });
    expect(again.title).toBe("#5b46d6");
    expect((await pickView("model")).actions.find((a) => a.id === "model")!.title).toBe("Edit in HSL");
    expect(stored.get("colors\0model")).toBe("oklch");
    await pickView("model");
  });

  test("typing: a digit opens the field with the digit, Enter applies the text and remembers it as typed, junk keeps the field with a toast, Escape closes it", async () => {
    const opened = await pickView("type:#");
    expect(opened.input).toMatchObject({ value: "#", submit: "apply", cancel: "cancel" });
    const bad = await host.pick("colors", "picker", "picker", "apply", { values: { input: "nope" } });
    expect((bad.view as View).input!.value).toBe("nope");
    expect(bad.toast).toMatchObject({ title: "Not a colour", style: "failure" });
    const ok = await pickView("apply", { values: { input: "rgb(255 136 0)" } });
    expect(ok.title).toBe("#ff8800");
    expect(ok.input).toBeUndefined();
    expect(historyOf()[0]).toMatchObject({ c: "#ff8800", from: "typed" });
    const typing = await pickView("type:3");
    expect((await pickView("cancel")).input).toBeUndefined();
    expect(typing.input!.value).toBe("3");
  });

  test("copies: Enter copies in the chosen notation, cmd+c the hex, the others by name; a copy is remembered", async () => {
    expect(await host.pick("colors", "picker", "picker", "copy")).toEqual({ copy: "#ff8800" });
    expect(await host.pick("colors", "picker", "picker", "copy:rgb")).toEqual({ copy: "rgb(255, 136, 0)" });
    expect(await host.pick("colors", "picker", "picker", "copy:p3")).toEqual({ copy: "color(display-p3 0.939 0.558 0.206)" });
    expect(await host.pick("colors", "picker", "picker", "copy:name")).toEqual({ copy: "darkorange" });
    expect(historyOf()[0]).toMatchObject({ c: "#ff8800", from: "picker" });
  });

  test("the rows: Tab to the tints, right along it, Enter takes the tile; h and n push the other palettes", async () => {
    const tints1 = await pickView("focus:next");
    expect(tints1.actions[0].id).toBe("use");
    await pickView("along:next");
    const used = await pickView("use");
    expect(used.title).toBe(toHex(tints(orange)[1]));
    expect(used.actions[0].id).toBe("copy");
    expect(await host.pick("colors", "picker", "picker", "history")).toEqual({ push: { extension: "colors", palette: "history" } });
    expect(await host.pick("colors", "picker", "picker", "names")).toEqual({ push: { extension: "colors", palette: "colors" } });
    expect((await pickView("undo")).title).toBe("#ff8800");
  });

  test("a screen pick from the picker returns at once, samples in the background, stores the colour and brings the panel back in the picker", async () => {
    sampled = { r: 102, g: 51, b: 153, hex: "#663399" };
    expect(await host.pick("colors", "picker", "picker", "pick")).toEqual({ hide: true });
    await host.until(() => ran.length === 1, 3000, "the effect after the pick");
    expect(ran[0]).toEqual({ push: { extension: "colors", palette: "picker" } });
    expect(host.coreCalls.filter((c) => c.method === "color.sample")).toHaveLength(1);
    expect(historyOf()[0]).toMatchObject({ c: "#663399", from: "screen" });
    expect((await host.request<View>("view", { extension: "colors", palette: "picker" })).title).toBe("#663399 · rebeccapurple");
  });

  test("the root row picks and copies with the HUD naming the colour; a cancel says so", async () => {
    ran.length = 0;
    sampled = { r: 0, g: 0, b: 255, hex: "#0000ff" };
    expect(await host.pick("colors", "history", "pick")).toEqual({ hide: true });
    await host.until(() => ran.length === 1, 3000, "the copy after the pick");
    expect(ran[0]).toEqual({ copy: "#0000ff", hud: "Copied #0000ff" });
    sampled = null;
    ran.length = 0;
    await host.pick("colors", "history", "pick", "pick");
    await host.until(() => ran.length === 1, 3000, "the cancel's hud");
    expect(ran[0]).toEqual({ hud: "No colour picked" });
    expect(await host.pick("colors", "history", "pick", "open")).toEqual({ push: { extension: "colors", palette: "picker" } });
  });

  test("history lists newest first with where from; open pushes the picker, delete and clear take rows away", async () => {
    const items = await host.list("colors", "history");
    expect(items[0].id).toBe("pick");
    expect(items.slice(1, 4).map((i) => i.id)).toEqual(["#0000ff", "#663399", toHex(tints(orange)[1])]);
    expect(items[1].subtitle).toMatch(/^picked from the screen · just now$/);
    expect(await host.pick("colors", "history", "#663399")).toEqual({ push: { extension: "colors", palette: "picker", args: { color: "#663399", from: "history" } } });
    expect(await host.pick("colors", "history", "#663399", "copy")).toEqual({ copy: "#663399" });
    expect(await host.pick("colors", "history", "#0000ff", "delete")).toEqual({ keep: true });
    expect((await host.list("colors", "history")).map((i) => i.id)).not.toContain("#0000ff");
    expect(await host.pick("colors", "history", "nope", "delete")).toMatchObject({ toast: { title: "Unknown colour" } });
    expect(await host.pick("colors", "history", "#663399", "clear")).toEqual({ keep: true });
    expect(await host.list("colors", "history")).toHaveLength(1);
  });

  test("the grid: every set under All, one set under its filter, a tile opens the picker on it (and leads the Recent section), the copies write the settings' notation", async () => {
    const all = await grid();
    expect(all).toHaveLength(995);
    expect([...new Set(all.map((i) => i.section))].slice(0, 4)).toEqual(["CSS", "Tailwind", "Material 3", "Material"]);
    expect(all.find((i) => i.id === "ctp/mocha/mauve")).toMatchObject({ name: "mauve", subtitle: "#cba6f7 · mocha", section: "Catppuccin Mocha" });
    const nord = await grid({ filter: "nord" });
    expect(nord.map((i) => i.id)).toEqual(handKept().filter((r) => r.s === "nord").map((r) => r.id));
    expect(await host.pick("colors", "colors", "tw/slate-500")).toEqual({ push: { extension: "colors", palette: "picker", args: { color: "#64748b", from: "set", name: "slate-500" } } });
    expect((await grid()).slice(0, 2).map((i) => [i.id, i.section])).toEqual([["tw/slate-500", "Recent"], ["css/aliceblue", "CSS"]]);
    expect(await host.pick("colors", "colors", "tw/slate-500", "copy")).toEqual({ copy: "#64748b" });
    expect(await host.pick("colors", "colors", "apple/dark/blue", "name")).toEqual({ copy: "systemBlue" });
    expect(historyOf()[0]).toMatchObject({ c: "#64748b", from: "set", name: "slate-500" });
    expect(await host.pick("colors", "colors", "nope")).toMatchObject({ toast: { title: "Unknown colour" } });
    const d = await host.detail("colors", "colors", "m3/primary-40");
    expect(d.markdown).toContain("md.sys.color.primary");
    expect(d.metadata).toContainEqual({ label: "Hex", value: "#6750a4" });
  });

  test("the converter at the root: a hex, a function notation or a CSS name lists its first four notations inline, Enter opens the picker; a word does not match", async () => {
    const inline = (q: string) => host.request<{ extension: string; palette: string; items: { id: string; actions: { id: string }[] }[] }[]>("inline", { query: q }).then((r) => r.find((s) => s.extension === "colors" && s.palette === "convert")?.items);
    const rows = await inline("#ff8800");
    expect(rows!.map((r) => r.id)).toEqual(["#ff8800", "rgb(255, 136, 0)", "hsl(32, 100%, 50%)", "hwb(32 0% 0%)"]);
    expect(rows![0].actions[0].id).toBe("open");
    expect((await inline("rebeccapurple"))!.length).toBe(4);
    expect(await inline("chrome")).toBeUndefined();
    expect(await convert("", { inline: true } as never)).toEqual([]);
  });

  test("the converter: hints when empty, one row per notation for a colour, Enter opens the picker on it and cmd+enter copies the row; a contrast row only copies", async () => {
    const hints = await convert("");
    expect(hints.map((h) => h.actions)).toEqual([[], []]);
    expect(await host.pick("colors", "convert", hints[0].id)).toEqual({ keep: true });
    const bad = await convert("zzz");
    expect(bad[0]).toMatchObject({ name: "Not a colour", actions: [] });
    const r = await convert("#663399");
    expect(r.map((x) => x.subtitle)).toEqual(["hex", "rgb", "hsl", "hwb", "oklch", "oklab", "lab", "display-p3", "CSS name", "contrast ratio", "contrast ratio"]);
    expect(await host.pick("colors", "convert", "rgb(102, 51, 153)")).toEqual({ push: { extension: "colors", palette: "picker", args: { color: "#663399", from: "convert" } } });
    expect(await host.pick("colors", "convert", "rgb(102, 51, 153)", "copy")).toEqual({ copy: "rgb(102, 51, 153)" });
    expect(await host.pick("colors", "convert", "8.41:1")).toEqual({ copy: "8.41:1" });
  });

  test("settings: uppercase hex, alpha dropped, a shorter history and fewer sets reach every palette", async () => {
    const h = await Host.bundled({ settings: { colors: { settings: { format: "hsl", uppercase: true, alpha: "drop", sets: ["nord", "solarized"], history_size: 2 } } }, core: { "color.sample": () => null, "effects.run": () => null } });
    stored.delete("colors\0recent");
    try {
      await h.pick("colors", "picker", "picker", "type:#");
      const v = await h.request<{ view: View }>("pick", { extension: "colors", palette: "picker", id: "picker", action: "apply", values: { input: "#ff880080" } }).then((r) => r.view);
      expect(v.actions[0].title).toBe("Copy hsl(32, 100%, 50%)");
      expect(await h.pick("colors", "picker", "picker", "copy:hex")).toEqual({ copy: "#FF8800" });
      const all = await h.list("colors", "colors");
      expect([...new Set(all.map((i) => i.section))]).toEqual(["Nord", "Solarized"]);
      expect((await h.list("colors", "colors", "", { filter: "css" })).length).toBe(148);
      for (const c of ["#111111", "#222222", "#333333"]) await h.request("pick", { extension: "colors", palette: "picker", id: "picker", action: "apply", values: { input: c } });
      expect((await h.list("colors", "history")).map((i) => i.id)).toEqual(["pick", "#333333", "#222222"]);
    } finally {
      h.kill();
    }
  });
});
