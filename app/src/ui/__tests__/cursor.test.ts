import { describe, expect, it } from "vitest";
import { followCursor } from "../cursor";

const rows = (...ids: string[]) => ids.map((id) => ({ item: { id } }));

describe("followCursor", () => {
  it("lands on row 2 when the hold begins, or the only row, or nowhere", () => {
    expect(followCursor(rows("a", "b", "c"), undefined, 0)).toBe(1);
    expect(followCursor(rows("a"), undefined, 0)).toBe(0);
    expect(followCursor([], undefined, 5)).toBe(0);
  });
  it("follows its row by id across a relist, wherever it moved", () => {
    expect(followCursor(rows("c", "a", "b"), "b", 1)).toBe(2);
    expect(followCursor(rows("b"), "b", 2)).toBe(0);
  });
  it("clamps the index when the row is gone, and takes row 0 after typing", () => {
    expect(followCursor(rows("a", "c"), "b", 1)).toBe(1);
    expect(followCursor(rows("a"), "b", 3)).toBe(0);
    expect(followCursor(rows("a", "c"), "b", 0)).toBe(0);
  });
});
