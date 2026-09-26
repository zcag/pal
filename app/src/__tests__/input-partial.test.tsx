// @vitest-environment happy-dom
// A streamed input palette (`ctx.partial`): its early rows show while the
// sweep keeps running, a superseded query's partial never shows, and the
// cursor stays on its row when the answer puts another row above it.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Launcher, type LauncherHandle } from "../Launcher";
import type { SourceInfo } from "../items";
import type { Hit } from "../ui/List";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const sources: SourceInfo[] = [{ extension: "s", palette: "search", title: "Search", live: false, input: true, count: 0, stale: false }];
const hit = (id: string): Hit => ({ item: { id, name: id.toUpperCase() } });

let root: Root, el: HTMLDivElement;
const launcher: { current: LauncherHandle | null } = { current: null };
/** Per query: its partial callback and its answer. */
const asked = new Map<string, { partial: (h: Hit[]) => void; answer: (h: Hit[]) => void }>();

beforeEach(() => {
  el = document.createElement("div"); document.body.appendChild(el); root = createRoot(el); asked.clear();
  // The list is virtual: without a size it draws no rows.
  HTMLElement.prototype.getBoundingClientRect = function () { return { left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400, x: 0, y: 0, toJSON: () => ({}) } as DOMRect; };
  for (const p of ["clientHeight", "offsetHeight"]) Object.defineProperty(HTMLElement.prototype, p, { configurable: true, get: () => 400 });
  for (const p of ["clientWidth", "offsetWidth"]) Object.defineProperty(HTMLElement.prototype, p, { configurable: true, get: () => 600 });
  (globalThis as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
});
afterEach(() => { act(() => root.unmount()); el.remove(); });

const search = (q: string, _scope?: SourceInfo, _ctx?: unknown, onPartial?: (h: Hit[]) => void) =>
  new Promise<Hit[]>((resolve) => asked.set(q, { partial: (h) => onPartial?.(h), answer: resolve }));
const tick = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const names = () => [...el.querySelectorAll(".pal-row .pal-row__title")].map((e) => e.textContent);
const active = () => el.querySelector(".pal-row[data-active] .pal-row__title")?.textContent;
const loading = () => el.querySelector(".pal-search")!.hasAttribute("data-loading");
const down = () => act(() => { document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true })); });

async function open() {
  await act(async () => { root.render(<Launcher ref={launcher} sources={sources} version={0} search={search} onPick={() => {}} onHide={() => {}} />); });
  await act(() => { launcher.current!.open("s/search"); });
  await tick();
}

describe("a streamed input palette", () => {
  it("shows the partial rows under a running sweep, then the answer", async () => {
    await open();
    await act(() => { launcher.current!.type("q"); });
    await act(() => asked.get("q")!.partial([hit("a")]));
    expect(names()).toEqual(["A"]);
    expect(loading()).toBe(true);
    await act(async () => { asked.get("q")!.answer([hit("a"), hit("b")]); });
    await tick();
    expect(names()).toEqual(["A", "B"]);
    expect(loading()).toBe(false);
  });
  it("drops a superseded query's partial", async () => {
    await open();
    await act(() => { launcher.current!.type("q"); });
    await act(() => { launcher.current!.type("qu"); });
    await act(() => asked.get("qu")!.partial([hit("new")]));
    await act(() => asked.get("q")!.partial([hit("old")]));
    expect(names()).toEqual(["NEW"]);
  });
  it("keeps the cursor on its row when the answer adds one above", async () => {
    await open();
    await act(() => { launcher.current!.type("q"); });
    await act(() => asked.get("q")!.partial([hit("a"), hit("b")]));
    await down();
    expect(active()).toBe("B");
    await act(async () => { asked.get("q")!.answer([hit("x"), hit("a"), hit("b")]); });
    await tick();
    expect(active()).toBe("B");
  });
});
