import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// Row pulls in icons.ts, which reads `window` at import; no DOM is needed for these tests.
vi.hoisted(() => { (globalThis as { window?: unknown }).window ??= globalThis; });
import { Highlight } from "../Row";
import { graphemePositions, graphemes, relativeDate } from "../format";

const render = (text: string, positions: number[]) => renderToStaticMarkup(<Highlight text={text} positions={new Set(positions)} />);

describe("Highlight", () => {
  it("marks runs of positions", () => {
    expect(render("Activity Monitor", [0, 1, 9, 10])).toBe("<mark>Ac</mark>tivity <mark>Mo</mark>nitor");
  });
  it("counts positions in grapheme clusters, as the core does", () => {
    // 🇹🇷 is one cluster (two code points, four UTF-16 units): positions 2..4 are "Tür".
    expect(render("🇹🇷 Türkiye", [2, 3, 4])).toBe("🇹🇷 <mark>Tür</mark>kiye");
    expect(render("👩‍💻 dev", [2, 3])).toBe("👩‍💻 <mark>de</mark>v");
  });
  it("renders plain text without positions", () => {
    expect(render("plain", [])).toBe("plain");
  });
});

describe("graphemes", () => {
  it("keeps flags and ZWJ sequences whole", () => {
    expect(graphemes("🇹🇷 T")).toEqual(["🇹🇷", " ", "T"]);
    expect(graphemes("👩‍💻!")).toEqual(["👩‍💻", "!"]);
  });
  it("maps UTF-16 offsets onto cluster positions", () => {
    // fzf in the gallery reports code units: "T" of "🇹🇷 Türkiye" is unit 5, cluster 2.
    expect([...graphemePositions("🇹🇷 Türkiye", [5, 6, 7])]).toEqual([2, 3, 4]);
  });
});

describe("relativeDate", () => {
  const now = Date.UTC(2026, 8, 16, 12, 0, 0);
  const ago = (s: number) => relativeDate(now - s * 1000, now);
  it("rounds to the largest unit", () => {
    expect(ago(10)).toBe("now");
    expect(ago(50)).toBe("50s");
    expect(ago(5 * 60)).toBe("5m");
    expect(ago(3 * 3600)).toBe("3h");
    expect(ago(2 * 86400)).toBe("2d");
    expect(ago(3 * 7 * 86400)).toBe("3w");
    expect(ago(2 * 365 * 86400)).toBe("2y");
  });
  it("prefixes the future", () => {
    expect(relativeDate(now + 26 * 3600 * 1000, now)).toBe("in 1d");
  });
});

describe("shortcutKeys", () => {
  it("names the plus key itself when the shortcut ends with it", async () => {
    const { shortcutKeys } = await import("../format");
    expect(shortcutKeys("+")).toEqual(["+"]);
    expect(shortcutKeys("shift++")).toEqual(["Shift", "+"]);
    expect(shortcutKeys("-")).toEqual(["-"]);
    expect(shortcutKeys("cmd+k")).toEqual(["Ctrl", "K"]);
  });
});
