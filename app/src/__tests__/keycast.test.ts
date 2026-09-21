import { describe, expect, it } from "vitest";
import { DEFAULTS, MAX_RIPPLES, countLabel, initial, reduce, rippleColor, showsCursor, showsKeys, visible, type Payload, type State } from "../keycast";

const on = (over: Partial<State["settings"] & object> = {}): State => reduce(initial(), { kind: "state", active: true, mode: "both", settings: { ...DEFAULTS, ...over } });
const entry = (id: number, at: number, keys = ["⌘", "S"], count = 1) => ({ id, keys, count, at });

describe("keycast page: the reducer", () => {
  it("off clears what is drawn and keeps the settings and the display", () => {
    let s = on();
    s = reduce(s, { kind: "display", inset: [37, 0, 70, 0] });
    s = reduce(s, { kind: "keys", entries: [entry(1, 1000)] });
    s = reduce(s, { kind: "cursor", x: 10, y: 20 });
    s = reduce(s, { kind: "click", button: "left", x: 10, y: 20, down: true });
    expect(s.entries).toHaveLength(1);
    expect(s.ripples).toHaveLength(1);
    expect(s.down).toBe(true);
    const off = reduce(s, { kind: "state", active: false, mode: "keys", settings: { ...DEFAULTS, scale: 2 } });
    expect(off).toMatchObject({ active: false, entries: [], cursor: null, down: false, ripples: [], inset: [37, 0, 70, 0], mode: "keys" });
    expect(off.settings?.scale).toBe(2);
  });

  it("a click moves the cursor, marks the button down until its up, and ripples only while the setting is on", () => {
    let s = on({ ripples: false });
    s = reduce(s, { kind: "click", button: "right", x: 5, y: 6, down: true });
    expect(s.cursor).toEqual({ x: 5, y: 6 });
    expect(s.down).toBe(true);
    expect(s.ripples).toEqual([]);
    s = reduce(s, { kind: "click", button: "right", x: 5, y: 6, down: false });
    expect(s.down).toBe(false);
    s = reduce(on(), { kind: "click", button: "right", x: 5, y: 6, down: true });
    expect(s.ripples).toMatchObject([{ x: 5, y: 6, button: "right" }]);
    const id = s.ripples[0].id;
    expect(reduce(s, { kind: "ripple-done", id }).ripples).toEqual([]);
  });

  it("a click storm keeps the newest ripples only", () => {
    let s = on();
    for (let i = 0; i < MAX_RIPPLES + 5; i++) s = reduce(s, { kind: "click", button: "left", x: i, y: 0, down: true } satisfies Payload);
    expect(s.ripples).toHaveLength(MAX_RIPPLES);
    expect(s.ripples[0].x).toBe(5);
  });

  it("a keys payload replaces the strip; the state payload while on keeps it", () => {
    let s = on();
    s = reduce(s, { kind: "keys", entries: [entry(1, 1000), entry(2, 1100, ["A"], 3)] });
    expect(s.entries.map((e) => e.id)).toEqual([1, 2]);
    s = reduce(s, { kind: "state", active: true, mode: "keys", settings: { ...DEFAULTS, hold: 4 } });
    expect(s.entries).toHaveLength(2);
    expect(s.settings?.hold).toBe(4);
    expect(s.mode).toBe("keys");
  });
});

describe("keycast page: the helpers", () => {
  it("visible keeps the entries inside their hold", () => {
    const es = [entry(1, 1000), entry(2, 2500)];
    expect(visible(es, 2, 3000).map((e) => e.id)).toEqual([2]);
    expect(visible(es, 2, 2999).map((e) => e.id)).toEqual([1, 2]);
    expect(visible(es, 2, 4500)).toEqual([]);
  });
  it("the count reads ×N past one press", () => {
    expect(countLabel(1)).toBeNull();
    expect(countLabel(3)).toBe("×3");
  });
  it("a left click ripples in the ring's colour, a right one in amber, a middle one in grey", () => {
    expect(rippleColor("left", "pink")).toBe("pink");
    expect(rippleColor("right", "pink")).toBe("amber");
    expect(rippleColor("middle", "pink")).toBe("grey");
  });
  it("the modes say what draws", () => {
    expect([showsKeys("keys"), showsCursor("keys")]).toEqual([true, false]);
    expect([showsKeys("cursor"), showsCursor("cursor")]).toEqual([false, true]);
    expect([showsKeys("both"), showsCursor("both")]).toEqual([true, true]);
  });
});
