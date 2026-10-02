import { describe, expect, it, vi } from "vitest";

// items.ts pulls in icons.ts, which reads `window` at import; no DOM is needed here.
vi.hoisted(() => { (globalThis as { window?: unknown }).window ??= globalThis; });
import { toItem, type WireHit } from "../items";

describe("a row's typed arguments", () => {
  it("reach the panel's item, so the fields show while the row is focused (they were dropped: no extension's args ever drew)", () => {
    const args = [{ id: "minutes", placeholder: "minutes", kind: "number" as const, default: "25" }];
    const hit: WireHit = { source: { extension: "timer", palette: "timer" }, id: "new", score: 0, name_positions: [], item: { id: "new", name: "New timer", args } };
    expect(toItem(hit, { title: "Timer" }).args).toEqual(args);
    expect(toItem({ ...hit, item: { id: "x", name: "x" } }, { title: "Timer" }).args).toBeUndefined();
    expect(toItem({ ...hit, item: { id: "x", name: "x", args: [] } }, { title: "Timer" }).args).toBeUndefined();
    // An action that takes the fields says so (`args: true`), and keeps saying so through the panel.
    const acted = toItem({ ...hit, item: { id: "new", name: "New timer", args, actions: [{ id: "start", title: "Start", args: true }, { id: "copy", title: "Copy" }] } }, { title: "Timer" });
    expect(acted.actions?.map((a) => a.args)).toEqual([true, undefined]);
  });
});

describe("an answer row", () => {
  it("keeps `hero` through the panel's item, and only when it is true (the list draws it as a headline row)", () => {
    const hit: WireHit = { source: { extension: "calc", palette: "calc" }, id: "result", score: 0, name_positions: [], item: { id: "result", name: "583.67 TRY", hero: true } };
    expect(toItem(hit, { title: "Calculator" }).hero).toBe(true);
    expect(toItem({ ...hit, item: { id: "x", name: "x", hero: "yes" } }, { title: "Calculator" }).hero).toBeUndefined();
    expect(toItem({ ...hit, item: { id: "x", name: "x" } }, { title: "Calculator" }).hero).toBeUndefined();
  });
});
