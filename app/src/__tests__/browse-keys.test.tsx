// @vitest-environment happy-dom
// Folder browsing's keys in a list level (`rowKey` in Launcher): a bare
// right arrow while nothing is typed runs the action carrying `right` on
// the row under the cursor (a folder's Browse), a bare left arrow or
// Backspace the action carrying it on any row of the level (the `..` row's
// Go up), and once something is typed the arrows are the caret's again.
// A push naming a `title` shows it as the level's crumb.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Launcher, type LauncherHandle } from "../Launcher";
import type { Effect, SourceInfo } from "../items";
import type { Item } from "../ui/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const sources: SourceInfo[] = [
  { extension: "files", palette: "browse", title: "Browse Folder", live: false, input: true, count: 0, stale: false },
];
const UP: Item = { id: "up:/Users/ada", name: "..", subtitle: "~", palette: "files/browse", actions: [{ id: "up", title: "Go up", shortcut: ["left", "backspace"] }] };
const FOLDER: Item = { id: "/Users/ada/Downloads/pics", name: "pics", palette: "files/browse", actions: [{ id: "browse", title: "Browse", shortcut: "right" }, { id: "open", title: "Open" }] };
const FILE: Item = { id: "/Users/ada/Downloads/a.txt", name: "a.txt", palette: "files/browse", actions: [{ id: "open", title: "Open" }, { id: "copy", title: "Copy path", shortcut: "cmd+c" }] };

let root: Root, el: HTMLDivElement;
const launcher: { current: LauncherHandle | null } = { current: null };
const picks: string[] = [];
let answer: Effect | undefined;

beforeEach(() => {
  el = document.createElement("div"); document.body.appendChild(el); root = createRoot(el); picks.length = 0; answer = undefined;
  HTMLElement.prototype.getBoundingClientRect = function () { return { left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400, x: 0, y: 0, toJSON: () => ({}) } as DOMRect; };
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 400 });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 600 });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => 400 });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => 600 });
  (globalThis as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
});
afterEach(() => { act(() => root.unmount()); el.remove(); });

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
const search = async (q: string, scope?: SourceInfo) => (scope ? [UP, FOLDER, FILE].filter((i) => !q || i.name.includes(q)).map((item) => ({ item })) : []);
const mount = async () => {
  await act(async () => {
    root.render(<Launcher ref={launcher} sources={sources} search={search} onPick={(i, _q, a) => { picks.push(`${i.name}:${a ?? "-"}`); return answer; }} onHide={() => {}} />);
  });
  await act(() => { launcher.current!.open("files/browse"); });
  await flush();
};
const field = () => el.querySelector<HTMLInputElement>(".pal-search__input")!;
const type = (value: string) => act(() => { const f = field(); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!; setter.call(f, value); f.dispatchEvent(new Event("input", { bubbles: true })); });
const key = (k: string, init: KeyboardEventInit = {}) => act(() => { (document.activeElement ?? window).dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init })); });
const rowNames = () => [...el.querySelectorAll(".pal-row__title")].map((r) => r.textContent);
const cursorName = () => el.querySelector(".pal-row[aria-selected='true'] .pal-row__title")?.textContent;

describe("browse keys", () => {
  it("right on a folder row runs its Browse; on a file row (no action carrying right) nothing is picked", async () => {
    await mount();
    expect(rowNames()).toEqual(["..", "pics", "a.txt"]);
    await key("ArrowDown");
    expect(cursorName()).toBe("pics");
    await key("ArrowRight");
    await flush();
    expect(picks).toEqual(["pics:browse"]);
    await key("ArrowDown");
    await key("ArrowRight");
    await flush();
    expect(picks).toEqual(["pics:browse"]);
  });

  it("left and Backspace run the .. row's Go up from any row; the cursor moves to it", async () => {
    await mount();
    await key("ArrowDown"); await key("ArrowDown");
    expect(cursorName()).toBe("a.txt");
    await key("ArrowLeft");
    await flush();
    expect(picks).toEqual(["..:up"]);
    expect(cursorName()).toBe("..");
    await key("ArrowDown");
    await key("Backspace");
    await flush();
    expect(picks).toEqual(["..:up", "..:up"]);
  });

  it("with something typed the arrows and Backspace are the input's, not a row's", async () => {
    await mount();
    await type("pic"); await flush();
    expect(rowNames()).toEqual(["pics"]);
    await key("ArrowRight"); await key("ArrowLeft"); await key("Backspace");
    await flush();
    expect(picks).toEqual([]);
  });

  it("a push naming a title shows it as the crumb of the pushed level", async () => {
    await mount();
    expect(el.querySelector(".pal-search__crumb")?.textContent).toBe("Browse Folder");
    answer = { push: { extension: "files", palette: "browse", args: { browse: "/Users/ada/Downloads/pics" }, title: "~/Downloads/pics" } };
    await key("ArrowDown");
    await key("Enter");
    await flush();
    expect(picks).toEqual(["pics:browse"]);
    expect(el.querySelector(".pal-search__crumb")?.textContent).toBe("~/Downloads/pics");
  });
});
