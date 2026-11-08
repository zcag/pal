import { describe, expect, it } from "vitest";
import { bySide, hiddenKeys, sideOf } from "../bar-sides";

describe("bar sides", () => {
  it("places an item by its configured position, the menu bar's right for anything else", () => {
    expect(["left", "q", "center", "e", "right", undefined, "x"].map(sideOf)).toEqual(["left", "center", "center", "center", "right", "right", "right"]);
  });
  it("keeps the strip's order within a side, the notch's q before its e", () => {
    const s = bySide([{ k: 1, position: "e" }, { k: 2, position: "left" }, { k: 3 }, { k: 4, position: "q" }, { k: 5, position: "left" }]);
    expect([s.left, s.center, s.right].map((x) => x.map((i) => i.k))).toEqual([[2, 5], [4, 1], [3]]);
  });
  it("reads hide's list of keys", () => {
    expect([...hiddenKeys(" dpi/bypass, audio/volume ,,")]).toEqual(["dpi/bypass", "audio/volume"]);
    expect(hiddenKeys(null).size).toBe(0);
  });
});
