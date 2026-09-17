// @vitest-environment happy-dom
// Compact mode (`general.compact`, `prefs.compact`): no footer, the
// primary hint on the search row, no detail pane (cmd+i inert), and
// cmd+shift+m or the "Compact panel" / "Full panel" action asking the
// shell to flip the key (`onCompact`).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Launcher, type LauncherHandle, type Prefs } from "../Launcher";
import type { Hit } from "../ui";
import type { Item } from "../ui/types";
import type { SourceInfo } from "../items";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root, el: HTMLDivElement;
const launcher: { current: LauncherHandle | null } = { current: null };
let flips = 0;
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const SOURCES: SourceInfo[] = [{ extension: "apps", palette: "apps", title: "Apps", live: false, input: false, count: 2, stale: false }];
const rows: Item[] = [
  { id: "a", name: "Alpha", subtitle: "one", palette: "apps/apps", source: { extension: "apps", palette: "apps" }, detail: { markdown: "# Alpha" } },
  { id: "b", name: "Beta", subtitle: "two", palette: "apps/apps", source: { extension: "apps", palette: "apps" } },
];
const search = async (q: string): Promise<Hit[]> => rows.filter((r) => !q || r.name.toLowerCase().includes(q.toLowerCase())).map((item) => ({ item }));
const prefs = (compact: boolean): Prefs => ({ aliasSpace: true, backspaceBack: true, fallbacksAlways: false, searchHistory: true, now: [], compact });
const mount = async (compact: boolean) => {
  await act(async () => {
    root.render(<Launcher ref={launcher} sources={SOURCES} search={search} prefs={prefs(compact)} onPick={() => {}} onHide={() => {}} onCompact={() => { flips++; }} onSettings={() => {}} />);
  });
  await flush();
};
beforeEach(() => {
  el = document.createElement("div"); document.body.appendChild(el); root = createRoot(el); flips = 0;
  HTMLElement.prototype.getBoundingClientRect = function () { return { left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400, x: 0, y: 0, toJSON: () => ({}) } as DOMRect; };
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 400 });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 600 });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => 400 });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => 600 });
  (globalThis as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
});
afterEach(() => { act(() => root.unmount()); el.remove(); });
const key = (k: string, init: KeyboardEventInit = {}) => act(() => { (document.activeElement ?? window).dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init })); });
const actionTitles = () => [...el.querySelectorAll(".pal-action")].map((a) => a.textContent ?? "");

describe("compact mode", () => {
  it("folds the footer into the search row and keeps the detail pane closed", async () => {
    await mount(true);
    expect(el.querySelector(".pal-footer")).toBeNull();
    expect(el.querySelector(".pal-search__hint")?.textContent).toContain("Open");
    await key("i", { metaKey: true, ctrlKey: true });
    await flush();
    expect(el.querySelector(".pal-panel__aside")).toBeNull();
    expect(el.querySelector(".pal-detail")).toBeNull();
  });
  it("keeps the footer and the pane in full mode", async () => {
    await mount(false);
    expect(el.querySelector(".pal-footer")).not.toBeNull();
    expect(el.querySelector(".pal-search__hint")).toBeNull();
    await key("i", { metaKey: true, ctrlKey: true });
    await flush();
    expect(el.querySelector(".pal-detail")).not.toBeNull();
  });
  it("the empty state spells the actions key for the platform (happy-dom is not a Mac: Ctrl+K)", async () => {
    await mount(false);
    await act(() => { launcher.current!.type("zzz-nothing"); });
    await flush();
    expect(el.querySelector(".pal-empty__hint")?.textContent).toBe("Try a different word, or Ctrl+K for actions");
  });
  it("cmd+shift+m and the pal action ask the shell to flip the key, worded for the mode", async () => {
    await mount(true);
    await key("m", { metaKey: true, ctrlKey: true, shiftKey: true, code: "KeyM" });
    expect(flips).toBe(1);
    await key("k", { metaKey: true, ctrlKey: true });
    await flush();
    const titles = actionTitles();
    expect(titles.some((t) => t.includes("Full panel"))).toBe(true);
    expect(titles.some((t) => t.includes("Show details"))).toBe(false);
    await key("Escape");
    await mount(false);
    await key("k", { metaKey: true, ctrlKey: true });
    await flush();
    expect(actionTitles().some((t) => t.includes("Compact panel"))).toBe(true);
  });
});
