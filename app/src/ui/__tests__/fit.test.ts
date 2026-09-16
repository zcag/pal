import { describe, expect, it, vi } from "vitest";
import { gridColumns } from "../virtual";

// Row pulls in icons.ts, which reads `window` at import; no DOM is needed for these tests.
vi.hoisted(() => { (globalThis as { window?: unknown }).window ??= globalThis; });
import { accessoryDropOrder } from "../Row";

const tokens = { tile: 56, gap: 8, inset: 8 };

describe("gridColumns", () => {
  it("fits as many tile-wide cells as the width takes, up to the extension's count", () => {
    // 760 wide: 744 inside the insets takes eleven 56px cells with 8px between; the emoji palette asks for 10.
    expect(gridColumns(760, tokens, 10)).toBe(10);
    expect(gridColumns(760, tokens, 8)).toBe(8);
    expect(gridColumns(760, tokens, 12)).toBe(11);
  });
  it("narrows beside a detail pane", () => {
    // 296 wide: 280 inside the insets takes four (4 * 56 + 3 * 8 = 248; five would need 312).
    expect(gridColumns(296, tokens, 10)).toBe(4);
    expect(gridColumns(311, tokens, 10)).toBe(4);
    expect(gridColumns(312 + 16, tokens, 10)).toBe(5);
  });
  it("never goes under two, whatever the width", () => {
    expect(gridColumns(0, tokens, 10)).toBe(2);
    expect(gridColumns(100, tokens, 10)).toBe(2);
    expect(gridColumns(760, tokens, 1)).toBe(2);
  });
});

describe("accessoryDropOrder", () => {
  const text = { text: "kitty" }, date = { date: "2026-09-16" }, tag = { tag: "open" }, tag2 = { tag: "review" }, keys = { keys: "cmd+c" };
  it("gives way text first, then the date, then tags past the first", () => {
    expect(accessoryDropOrder([tag, tag2, text, date])).toEqual([2, 3, 1]);
  });
  it("keeps the first tag and key caps whatever their position", () => {
    expect(accessoryDropOrder([text, date, tag])).toEqual([0, 1]);
    expect(accessoryDropOrder([keys, tag])).toEqual([]);
    expect(accessoryDropOrder([tag2, keys, tag])).toEqual([2]);
  });
  it("drops repeats of a kind from the last", () => {
    expect(accessoryDropOrder([{ text: "a" }, { text: "b" }, { date: 1 }, { date: 2 }, tag, tag2, { tag: "c" }])).toEqual([1, 0, 3, 2, 6, 5]);
  });
  it("has nothing to drop without accessories", () => {
    expect(accessoryDropOrder()).toEqual([]);
    expect(accessoryDropOrder([])).toEqual([]);
  });
});
