// @vitest-environment happy-dom
// The switcher's hold (docs/design/switcher.md, switcher.rs): `open` with
// `hold` lists the palette flat with the cursor on row 2 (plus the `steps`
// the chord took before the panel showed), `switch` steps with wrap and
// commits the row under the cursor (a commit ahead of the rows waits for
// them), the cursor keeps its index across a relist (`version`; the fresh
// MRU order is the point), typing keeps its row by id while listed, and
// Escape hides outright.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Launcher, type LauncherHandle } from "../Launcher";
import type { SourceInfo } from "../items";
import type { Item } from "../ui/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const WINDOWS = "windows/windows";
const sources: SourceInfo[] = [{ extension: "windows", palette: "windows", title: "Windows", live: true, input: false, count: 3, stale: false }];
const win = (id: string, section: string): Item => ({ id, name: id, palette: WINDOWS, section, actions: [{ id: "focus", title: "Focus" }] });

let root: Root, el: HTMLDivElement;
const launcher: { current: LauncherHandle | null } = { current: null };
const picks: string[] = [];
const hides: number[] = [];
/** The palette's rows as the index has them now; a relist swaps them. */
let rows: Item[] = [];
/** Set, the search answers only once this resolves: rows still loading. */
let gate: Promise<void> | null = null;

beforeEach(() => {
  el = document.createElement("div"); document.body.appendChild(el); root = createRoot(el); picks.length = 0; hides.length = 0; gate = null;
  rows = [win("safari-1", "Safari"), win("kitty-1", "kitty"), win("safari-2", "Safari"), win("mail-1", "Mail")];
  HTMLElement.prototype.getBoundingClientRect = function () { return { left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400, x: 0, y: 0, toJSON: () => ({}) } as DOMRect; };
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 400 });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 600 });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => 400 });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => 600 });
  (globalThis as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
});
afterEach(() => { act(() => root.unmount()); el.remove(); });

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const search = async (q: string, scope?: SourceInfo) => { if (gate) await gate; return scope ? rows.filter((r) => r.name.includes(q)).map((item) => ({ item })) : []; };
const render = (version = 0) => act(async () => {
  root.render(<Launcher ref={launcher} sources={sources} version={version} search={search} onPick={(i) => { picks.push(i.id); }} onHide={() => { hides.push(1); }} />);
});
const names = () => [...el.querySelectorAll(".pal-row__title")].map((r) => r.textContent);
const sections = () => [...el.querySelectorAll(".pal-section__title")].map((r) => r.textContent);
const cursor = () => el.querySelector(".pal-row[aria-selected='true'] .pal-row__title")?.textContent;
const sw = (cmd: { step?: number; commit?: boolean }) => act(() => { launcher.current!.switch(cmd); });
const key = (k: string) => act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })); });

describe("the switcher's hold", () => {
  it("lists flat with the cursor on row 2, steps with wrap, commits the row under the cursor", async () => {
    await render();
    await act(() => { launcher.current!.open(WINDOWS, { hold: true }); });
    await flush();
    expect(names()).toEqual(["safari-1", "kitty-1", "safari-2", "mail-1"]);
    expect(sections()).toEqual([]);
    expect(cursor()).toBe("kitty-1");
    await sw({ step: 1 });
    expect(cursor()).toBe("safari-2");
    await sw({ step: 1 });
    await sw({ step: 1 });
    expect(cursor()).toBe("safari-1");
    await sw({ step: -1 });
    expect(cursor()).toBe("mail-1");
    await sw({ commit: true });
    expect(picks).toEqual(["mail-1"]);
    // Held again over the same palette: the rows on screen are last time's, never followed; the fresh order puts the cursor on its row 2.
    rows = [win("mail-1", "Mail"), win("safari-2", "Safari"), win("kitty-1", "kitty"), win("safari-1", "Safari")];
    await act(() => { launcher.current!.open(WINDOWS, { hold: true }); });
    await flush();
    expect(cursor()).toBe("safari-2");
  });

  it("the presses before the show place the cursor that many rows further, wrapping", async () => {
    await render();
    await act(() => { launcher.current!.open(WINDOWS, { hold: true, steps: 2 }); });
    await flush();
    expect(cursor()).toBe("mail-1");
    await act(() => { launcher.current!.open(WINDOWS, { hold: true, steps: 4 }); });
    await flush();
    expect(cursor()).toBe("kitty-1");
    await act(() => { launcher.current!.open(WINDOWS, { hold: true, steps: -1 }); });
    await flush();
    expect(cursor()).toBe("safari-1");
  });

  it("a commit before the rows land runs once they do, on the row the steps chose", async () => {
    await render();
    let release!: () => void;
    gate = new Promise((r) => { release = r; });
    await act(() => { launcher.current!.open(WINDOWS, { hold: true, steps: 1 }); });
    await sw({ commit: true });
    await flush();
    expect(picks).toEqual([]);
    expect(hides).toEqual([]);
    gate = null;
    await act(async () => { release(); });
    await flush();
    expect(picks).toEqual(["safari-2"]);
    // With nothing listed once they land: the hide, as a commit over an empty list.
    rows = [];
    gate = new Promise((r) => { release = r; });
    await act(() => { launcher.current!.open(WINDOWS, { hold: true }); });
    await sw({ commit: true });
    await flush();
    expect(hides).toEqual([]);
    gate = null;
    await act(async () => { release(); });
    await flush();
    expect(hides).toHaveLength(1);
  });

  it("without the hold the same palette is grouped by app", async () => {
    await render();
    await act(() => { launcher.current!.open(WINDOWS); });
    await flush();
    expect(sections()).toEqual(["Safari", "kitty", "Mail"]);
    expect(cursor()).toBe("safari-1");
  });

  it("keeps its index across a relist (row 1 plus the steps, in the fresh order), clamped to the rows left", async () => {
    await render();
    await act(() => { launcher.current!.open(WINDOWS, { hold: true }); });
    await flush();
    await sw({ step: 1 });
    expect(cursor()).toBe("safari-2");
    // The fresh MRU order lands: the cursor is still the third row, whichever window that is now.
    rows = [win("mail-1", "Mail"), win("kitty-1", "kitty"), win("safari-1", "Safari"), win("safari-2", "Safari")];
    await render(1);
    await flush();
    expect(cursor()).toBe("safari-1");
    rows = [win("kitty-1", "kitty"), win("mail-1", "Mail")];
    await render(2);
    await flush();
    expect(cursor()).toBe("mail-1");
  });

  it("typing keeps the row while it is listed, else row 0 of the filtered list; Escape hides", async () => {
    await render();
    await act(() => { launcher.current!.open(WINDOWS, { hold: true }); });
    await flush();
    await sw({ step: 1 });
    expect(cursor()).toBe("safari-2");
    await act(() => { launcher.current!.type("safari"); });
    await flush();
    expect(names()).toEqual(["safari-1", "safari-2"]);
    expect(cursor()).toBe("safari-2");
    await act(() => { launcher.current!.type("kitty"); });
    await flush();
    expect(cursor()).toBe("kitty-1");
    await key("Escape");
    expect(hides).toHaveLength(1);
  });

  it("commit with nothing listed hides", async () => {
    await render();
    await act(() => { launcher.current!.open(WINDOWS, { hold: true }); });
    await flush();
    await act(() => { launcher.current!.type("nothing here"); });
    await flush();
    await sw({ commit: true });
    expect(picks).toEqual([]);
    expect(hides).toHaveLength(1);
  });
});
