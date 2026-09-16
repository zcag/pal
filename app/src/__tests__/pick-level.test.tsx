// @vitest-environment happy-dom
// `pal pick`'s picker level (`pickLevel`, pick.rs): the rows as given
// filtered by the query, Enter answering `onPickReply` with the row's id,
// marks (x, Tab, shift+arrows) answering every marked id under `multi`,
// Escape answering null, and nothing reaching `onPick`.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Launcher, pickLevel, type LauncherHandle } from "../Launcher";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root, el: HTMLDivElement;
const launcher: { current: LauncherHandle | null } = { current: null };
const replies: [number, string[] | null][] = [];
const picks: string[] = [];
let hidden = 0;
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
const ROWS = [{ id: "main", name: "main" }, { id: "feature/x", name: "feature/x", subtitle: "2 days ago", icon: "\u{f062c}" }, { id: "fix/y", name: "fix/y" }];
const mount = async (multi = false, query?: string) => {
  await act(async () => {
    root.render(<Launcher ref={launcher} sources={[]} search={async () => []} onPick={(i) => { picks.push(i.id); }} onHide={() => { hidden++; }} onPickReply={(t, ids) => { replies.push([t, ids]); }} />);
  });
  await act(() => { launcher.current!.start(pickLevel(7, "Branch", ROWS, multi)); if (query) launcher.current!.type(query); });
  await flush();
};
beforeEach(() => {
  el = document.createElement("div"); document.body.appendChild(el); root = createRoot(el); replies.length = 0; picks.length = 0; hidden = 0;
  HTMLElement.prototype.getBoundingClientRect = function () { return { left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400, x: 0, y: 0, toJSON: () => ({}) } as DOMRect; };
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 400 });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 600 });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => 400 });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => 600 });
  (globalThis as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
});
afterEach(() => { act(() => root.unmount()); el.remove(); });
const field = () => el.querySelector<HTMLInputElement>(".pal-search__input")!;
const type = (value: string) => act(() => { const f = field(); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!; setter.call(f, value); f.dispatchEvent(new Event("input", { bubbles: true })); });
const key = (k: string, init: KeyboardEventInit = {}) => act(() => { (document.activeElement ?? window).dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init })); });
const rowNames = () => [...el.querySelectorAll(".pal-row__title")].map((r) => r.textContent);
const markedNames = () => [...el.querySelectorAll<HTMLElement>(".pal-row[data-marked] .pal-row__title")].map((r) => r.textContent);

describe("pick level", () => {
  it("shows the rows under the title, filters as typed, and Enter answers the row's id; nothing is picked", async () => {
    await mount();
    expect(el.querySelector(".pal-search__crumb")?.textContent).toBe("Branch");
    expect(rowNames()).toEqual(["main", "feature/x", "fix/y"]);
    expect(el.querySelector(".pal-footer__hint")?.textContent).toContain("Pick");
    await type("fea"); await flush();
    expect(rowNames()).toEqual(["feature/x"]);
    await key("Enter");
    expect(replies).toEqual([[7, ["feature/x"]]]);
    expect(picks).toEqual([]);
  });
  it("a query given up front is typed in; Escape clears it, then answers null (never hides by itself)", async () => {
    await mount(false, "fix");
    expect(field().value).toBe("fix");
    expect(rowNames()).toEqual(["fix/y"]);
    await key("Escape");
    expect(field().value).toBe("");
    await key("Escape");
    expect(replies).toEqual([[7, null]]);
    expect(hidden).toBe(0);
  });
  it("multi: x and Tab mark and step, shift+down too; Enter answers every marked id, the cursor's first", async () => {
    await mount(true);
    await key("x");
    await key("Tab");
    expect(markedNames()).toEqual(["main", "feature/x"]);
    expect(el.querySelector(".pal-footer__count")?.textContent).toBe("2 selected");
    await key("ArrowUp");
    await key("Enter");
    expect(replies).toEqual([[7, ["feature/x", "main"]]]);
  });
  it("without multi, x is typing", async () => {
    await mount();
    await key("x", { code: "KeyX" });
    expect(markedNames()).toEqual([]);
  });
});
