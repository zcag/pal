// @vitest-environment happy-dom
// Marked rows (`ui/selection.ts`, Launcher): the model (one palette, kept
// across queries, unmarkable rows), shift+arrows marking as the cursor
// moves, cmd+click toggling, `x` in a palette that opts in, Escape
// clearing before the query, the action panel narrowed to `multi`
// actions, Enter running one pick with every marked id, and the count in
// the footer.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Launcher, type LauncherHandle } from "../Launcher";
import type { Ctx, SourceInfo } from "../items";
import type { Hit } from "../ui";
import { isMarked, mark, markable, multiActions, pickIds, toggle } from "../ui/selection";
import type { Action, Item } from "../ui/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TRASH: Action = { id: "trash", title: "Move to Trash", multi: true, style: "destructive" };
const OPEN: Action = { id: "open", title: "Open", multi: true };
const REVEAL: Action = { id: "reveal", title: "Reveal" };
const item = (palette: string, id: string, name: string, more: Partial<Item> = {}): Item => ({ id, name, palette, source: { extension: palette.split("/")[0], palette: palette.split("/")[1] }, actions: [OPEN, REVEAL, TRASH], ...more });

describe("selection model", () => {
  const a = item("files/files", "/a", "a"), b = item("files/files", "/b", "b"), w = item("windows/windows", "w1", "kitty");
  it("toggle marks and unmarks within one palette; another palette starts over; empty is null", () => {
    let s = toggle(null, a);
    expect(s).toEqual({ palette: "files/files", ids: ["/a"] });
    s = toggle(s, b);
    expect(s!.ids).toEqual(["/a", "/b"]);
    expect(isMarked(s, a)).toBe(true);
    s = toggle(s, a);
    expect(s!.ids).toEqual(["/b"]);
    expect(toggle(s, b)).toBeNull();
    expect(toggle(s, w)).toEqual({ palette: "windows/windows", ids: ["w1"] });
  });
  it("mark never unmarks; pickIds puts the cursor row first when it is marked", () => {
    const s = mark(mark(mark(null, a), b), a);
    expect(s.ids).toEqual(["/a", "/b"]);
    expect(pickIds(s, b)).toEqual(["/b", "/a"]);
    expect(pickIds(s, w)).toEqual(["/a", "/b"]);
    expect(pickIds(s, undefined)).toEqual(["/a", "/b"]);
  });
  it("hints, palette rows, fallbacks, more rows and pushes cannot be marked", () => {
    expect(markable(a)).toBe(true);
    expect(markable(item("files/files", "h", "hint", { actions: [] }))).toBe(false);
    expect(markable(item("pal/palettes", "files/files", "Files"))).toBe(false);
    expect(markable(item("files/files", "m", "more", { muted: true }))).toBe(false);
    expect(markable(item("calc/calc", "pal:ask", "Ask", { push: { extension: "calc", palette: "calc" } }))).toBe(false);
    expect(markable(item("files/files", "d", "off", { disabled: true }))).toBe(false);
  });
  it("multiActions keeps the multi ones, in order, hidden ones out", () => {
    expect(multiActions([OPEN, REVEAL, TRASH, { id: "h", title: "h", multi: true, hidden: true, shortcut: "cmd+h" }]).map((x) => x.id)).toEqual(["open", "trash"]);
    expect(multiActions(undefined)).toEqual([]);
  });
});

const src = (extension: string, palette: string, title: string, more: Partial<SourceInfo> = {}): SourceInfo => ({ extension, palette, title, live: false, input: false, count: 3, stale: false, ...more });
const SOURCES: SourceInfo[] = [src("pal", "palettes", "Palettes"), src("files", "files", "Files", { input: true, multi: true }), src("apps", "apps", "Applications")];
const FILES = ["/a.txt", "/b.txt", "/c.txt"].map((p) => item("files/files", p, p.slice(1)));
const picks: { id: string; action?: string; ctx?: Ctx }[] = [];
const search = async (q: string, scope?: SourceInfo): Promise<Hit[]> => {
  if (scope?.palette === "files") return FILES.filter((f) => !q || f.name.includes(q)).map((i) => ({ item: i }));
  if (scope) return [];
  return [{ item: item("pal/palettes", "files/files", "Files", { actions: undefined }) }, ...FILES.map((i) => ({ item: i })), { item: item("apps/apps", "slack", "Slack", { actions: [{ id: "open", title: "Open" }] }) }];
};

let root: Root, el: HTMLDivElement;
const launcher: { current: LauncherHandle | null } = { current: null };
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
const mount = async () => {
  await act(async () => {
    root.render(<Launcher ref={launcher} sources={SOURCES} search={search} onPick={(i, _q, action, ctx) => { picks.push({ id: i.id, action, ctx }); }} onHide={() => {}} />);
  });
  await flush();
};
beforeEach(() => {
  el = document.createElement("div"); document.body.appendChild(el); root = createRoot(el); picks.length = 0;
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
const rows = () => [...el.querySelectorAll<HTMLElement>(".pal-row")];
const markedNames = () => rows().filter((r) => r.dataset.marked !== undefined).map((r) => r.querySelector(".pal-row__title")!.textContent);
const activeName = () => el.querySelector(".pal-row[data-active] .pal-row__title")?.textContent;
const badge = () => el.querySelector(".pal-footer__count")?.textContent;
const panelActions = () => [...el.querySelectorAll(".pal-action__title")].map((a) => a.textContent);
const click = (name: string, init: MouseEventInit = {}) => act(() => { rows().find((r) => r.querySelector(".pal-row__title")!.textContent === name)!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...init })); });

describe("marked rows in the Launcher", () => {
  it("shift+down marks the row and moves; a palette row is skipped; the badge counts; Escape clears before the query", async () => {
    await mount();
    expect(activeName()).toBe("Files");
    await key("ArrowDown", { shiftKey: true });
    expect(markedNames()).toEqual([]);
    expect(activeName()).toBe("a.txt");
    await key("ArrowDown", { shiftKey: true });
    await key("ArrowDown", { shiftKey: true });
    expect(markedNames()).toEqual(["a.txt", "b.txt"]);
    expect(badge()).toBe("2 selected");
    expect(rows().find((r) => r.dataset.marked !== undefined)!.querySelector(".pal-row__check")).not.toBeNull();
    await type("a"); await flush();
    expect(field().value).toBe("a");
    await key("Escape");
    expect(badge()).toBeUndefined();
    expect(field().value).toBe("a");
  });
  it("cmd+click toggles a row; marking a row of another palette starts over", async () => {
    await mount();
    await click("b.txt", { ctrlKey: true });
    await click("c.txt", { ctrlKey: true });
    expect(markedNames()).toEqual(["b.txt", "c.txt"]);
    await click("c.txt", { ctrlKey: true });
    expect(markedNames()).toEqual(["b.txt"]);
    await click("Slack", { ctrlKey: true });
    expect(markedNames()).toEqual(["Slack"]);
    expect(picks).toEqual([]);
  });
  it("the action panel lists only the multi actions; Enter is one pick with every marked id, the cursor row first; the marks go", async () => {
    await mount();
    await key("ArrowDown"); await key("ArrowDown", { shiftKey: true }); await key("ArrowDown", { shiftKey: true });
    expect(activeName()).toBe("c.txt");
    await key("k", { ctrlKey: true });
    expect(panelActions()).toEqual(["Open", "Move to Trash", "Clear selection"]);
    await key("Escape");
    await key("Enter", { ctrlKey: true });
    expect(picks).toEqual([{ id: "a.txt".replace("a.txt", "/a.txt"), action: "trash", ctx: { ids: ["/a.txt", "/b.txt"] } }]);
    expect(badge()).toBeUndefined();
  });
  it("x (while nothing is typed) and Tab mark and step down inside a palette that opts in; with a query x is typing; a plain click still picks one", async () => {
    await mount();
    await act(() => { launcher.current!.open("files/files"); }); await flush();
    await key("x"); await key("Tab");
    expect(markedNames()).toEqual(["a.txt", "b.txt"]);
    expect(activeName()).toBe("c.txt");
    expect(field().value).toBe("");
    await key("Enter");
    expect(picks.at(-1)).toEqual({ id: "/a.txt", action: "open", ctx: { ids: ["/a.txt", "/b.txt"] } });
    await click("c.txt");
    expect(picks.at(-1)).toEqual({ id: "/c.txt", action: "open", ctx: undefined });
    await type("t"); await flush();
    await key("x", { code: "KeyX" });
    expect(markedNames()).toEqual([]);
    await key("Tab");
    expect(markedNames()).toEqual(["a.txt"]);
  });
  it("with marks and no multi action Enter says so instead of picking one", async () => {
    await mount();
    await key("ArrowDown"); await key("ArrowDown"); await key("ArrowDown"); await key("ArrowDown");
    expect(activeName()).toBe("Slack");
    await key("ArrowUp", { shiftKey: true });
    expect(markedNames()).toEqual(["Slack"]);
    await key("Enter");
    expect(picks).toEqual([]);
    expect(el.querySelector(".pal-toast")?.textContent).toContain("Nothing here works on several rows");
  });
});
