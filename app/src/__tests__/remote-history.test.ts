import { describe, expect, it } from "vitest";
import { historyLayers } from "../remote-history";
import { indexOfId } from "../ui/touch";

/** A browser history: the entries above the page's first, and the popstate each walk fires. */
function browser() {
  const h = { above: 0, pops: 0 };
  const layers = historyLayers({ push: () => { h.above++; }, go: (n) => { h.above += n; h.pops++; } });
  return { h, layers };
}

describe("historyLayers", () => {
  it("keeps an entry per layer, the person's back pops one, the page's own walk back is not a pop", () => {
    const { h, layers } = browser();
    layers.sync(1);
    layers.sync(3);
    expect(h.above).toBe(3);
    // Back: the browser left an entry, the page drops a layer and reports the count it has now.
    h.above--;
    expect(layers.popped()).toBe(true);
    layers.sync(2);
    expect(h.above).toBe(2);
    // The page dropped both itself (a pick went home): one walk back, whose popstate is ignored.
    layers.sync(0);
    expect(h).toEqual({ above: 0, pops: 1 });
    expect(layers.popped()).toBe(false);
    // Back past the page's first entry leaves it: nothing to drop.
    expect(layers.popped()).toBe(false);
  });
});

describe("indexOfId", () => {
  it("reads the row's index off its dom id, and nothing off another id", () => {
    expect(indexOfId("pal-list-12")).toBe(12);
    expect(indexOfId("pal-list")).toBe(-1);
  });
});
