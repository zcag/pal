import { describe, expect, it } from "vitest";
import { bySide, hiddenKeys, sideOf } from "../bar-sides";

describe("bar sides", () => {
  it("places an item by its configured position: the notch's q and e on the left, center only when asked, the menu bar's right for anything else", () => {
    expect(["left", "q", "e", "center", "right", undefined, "x"].map(sideOf)).toEqual(["left", "left", "left", "center", "right", "right", "right"]);
  });
  it("keeps the strip's order within a side, left before q before e", () => {
    const s = bySide([{ k: 1, position: "e" }, { k: 2, position: "left" }, { k: 3 }, { k: 4, position: "q" }, { k: 5, position: "left" }, { k: 6, position: "center" }]);
    expect([s.left, s.center, s.right].map((x) => x.map((i) => i.k))).toEqual([[2, 5, 4, 1], [6], [3]]);
  });
  it("reads hide's list of keys", () => {
    expect([...hiddenKeys(" dpi/bypass, audio/volume ,,")]).toEqual(["dpi/bypass", "audio/volume"]);
    expect(hiddenKeys(null).size).toBe(0);
  });
});
