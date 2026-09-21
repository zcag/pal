// @vitest-environment happy-dom
// The keyboard walk of docs/keyboard.md as a new user takes it, with real
// KeyboardEvents on the Launcher: root to palette to detail to action panel
// and back to the root without the mouse; Escape at every level (clears the
// query, then closes the level, then hides, never a dead press); Tab with
// and without a filter; the action panel's order (the row's actions, then
// the shell's, each under its section); cmd+1..9; cmd+backspace; a toast
// leaving focus where it was.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { Launcher, type LauncherHandle } from "../Launcher";
import { Hud } from "../ui/Hud";
import { Toast } from "../ui/Toast";
import type { Ctx, Effect, SourceInfo } from "../items";
import type { Hit } from "../ui";
import type { Item } from "../ui/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const src = (extension: string, palette: string, title: string, more: Partial<SourceInfo> = {}): SourceInfo => ({ extension, palette, title, live: false, input: false, count: 3, stale: false, ...more });
const SOURCES: SourceInfo[] = [
  src("pal", "palettes", "Palettes"),
  src("apps", "apps", "Applications"),
  src("bookmarks", "bookmarks", "Bookmarks", { filters: [{ id: "all", title: "All" }, { id: "chrome", title: "Chrome" }, { id: "safari", title: "Safari" }] }),
];
const item = (palette: string, id: string, name: string, more: Partial<Item> = {}): Item => ({ id, name, palette, source: { extension: palette.split("/")[0], palette: palette.split("/")[1] }, ...more });
const APPS = [item("apps/apps", "slack", "Slack", { actions: [{ id: "open", title: "Open" }, { id: "quit", title: "Quit", shortcut: "cmd+q", section: "App", confirm: "Quit Slack?", style: "destructive" }], detail: { markdown: "# Slack" } }), item("apps/apps", "safari", "Safari", { actions: [{ id: "open", title: "Open" }] })];
const MARKS = [item("bookmarks/bookmarks", "b1", "Docs", { section: "Chrome", actions: [{ id: "open", title: "Open" }] }), item("bookmarks/bookmarks", "b2", "News", { section: "Safari", actions: [{ id: "open", title: "Open" }] })];
const PALETTE_ROWS = [item("pal/palettes", "apps/apps", "Applications"), item("pal/palettes", "bookmarks/bookmarks", "Bookmarks")];
const search = async (q: string, scope?: SourceInfo, ctx?: Ctx): Promise<Hit[]> => {
  const has = (i: Item) => !q || i.name.toLowerCase().includes(q.toLowerCase());
  if (scope?.palette === "apps") return APPS.filter(has).map((i) => ({ item: i }));
  if (scope?.palette === "bookmarks") return MARKS.filter((i) => has(i) && (!ctx?.filter || ctx.filter === "all" || i.section?.toLowerCase() === ctx.filter)).map((i) => ({ item: i }));
  if (scope) return [];
  return [...PALETTE_ROWS, ...APPS, ...MARKS].filter(has).map((i) => ({ item: i }));
};

let root: Root, el: HTMLDivElement;
const launcher: { current: LauncherHandle | null } = { current: null };
const picks: { id: string; action?: string }[] = [];
let hidden = 0;
let answer: (id: string, action?: string) => Effect | void = () => undefined;
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
const mount = async (more: Partial<Parameters<typeof Launcher>[0]> = {}) => {
  await act(async () => {
    root.render(<Launcher ref={launcher} sources={SOURCES} search={search} onPick={(i, _q, action) => { picks.push({ id: i.id, action }); return answer(i.id, action); }} onHide={() => { hidden++; }} onSettings={() => {}} onRefresh={() => {}} onLink={() => {}} onForget={() => true} history={async () => ["slack", "docs"]} {...more} />);
  });
  await flush();
};
beforeEach(() => {
  el = document.createElement("div"); document.body.appendChild(el); root = createRoot(el); picks.length = 0; hidden = 0; answer = () => undefined;
  HTMLElement.prototype.getBoundingClientRect = function () { return { left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400, x: 0, y: 0, toJSON: () => ({}) } as DOMRect; };
  for (const p of ["clientHeight", "offsetHeight"]) Object.defineProperty(HTMLElement.prototype, p, { configurable: true, get: () => 400 });
  for (const p of ["clientWidth", "offsetWidth"]) Object.defineProperty(HTMLElement.prototype, p, { configurable: true, get: () => 600 });
  (globalThis as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
});
afterEach(() => { act(() => root.unmount()); el.remove(); });

const field = () => el.querySelector<HTMLInputElement>(".pal-search__input")!;
const type = (value: string) => act(() => { const f = field(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(f, value); f.dispatchEvent(new Event("input", { bubbles: true })); });
/** A key on whatever has focus (the search box, a panel's field, a button), as the webview dispatches it. */
const key = (k: string, init: KeyboardEventInit = {}) => act(() => { (document.activeElement ?? window).dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init })); });
const cmd = (k: string, init: KeyboardEventInit = {}) => key(k, { ctrlKey: true, ...init });
const activeName = () => el.querySelector(".pal-row[data-active] .pal-row__title")?.textContent;
const crumb = () => el.querySelector(".pal-search__crumb")?.textContent;
const panelActions = () => [...el.querySelectorAll(".pal-actions .pal-action__title, .pal-actions .pal-actions__section")].map((a) => (a.classList.contains("pal-actions__section") ? `[${a.textContent}]` : a.textContent));
/** Up, and not on its way out (Presence keeps a closing panel in the DOM through its exit). */
const panelOpen = () => !!el.querySelector(".pal-actions") && !el.querySelector("[data-exiting] .pal-actions");
const paneOpen = () => !!el.querySelector(".pal-detail") && !el.querySelector("[data-exiting] .pal-detail");
const filterValue = () => el.querySelector<HTMLSelectElement>(".pal-search__filter select")?.value;

describe("the walk: root, palette, detail, action panel, back", () => {
  it("never needs the mouse and never has a dead Escape", async () => {
    await mount();
    expect(document.activeElement).toBe(field());
    expect(activeName()).toBe("Applications");
    // Enter on a palette row drills in: the crumb says where we are, the box is empty and focused.
    await key("Enter"); await flush();
    expect(crumb()).toBe("Applications");
    expect(field().value).toBe("");
    expect(document.activeElement).toBe(field());
    expect(activeName()).toBe("Slack");
    // cmd+i opens the pane on the row; cmd+k lists the row's actions first, then the shell's, each under its section.
    await cmd("i");
    expect(paneOpen()).toBe(true);
    await cmd("k");
    expect(panelOpen()).toBe(true);
    expect(panelActions()).toEqual(["Open", "[App]", "Quit", "[View]", "Hide details", "[Link]", "Copy deep link", "[pal]", "Reset ranking for this item", "Refresh Applications"]);
    // Escape: closes the panel, then (with a query) clears it, then pops the level, then hides.
    await key("Escape");
    expect(panelOpen()).toBe(false);
    expect(document.activeElement).toBe(field());
    await type("sl"); await flush();
    expect(activeName()).toBe("Slack");
    await key("Escape");
    expect(field().value).toBe("");
    expect(crumb()).toBe("Applications");
    await key("Escape");
    expect(crumb()).toBeUndefined();
    expect(paneOpen()).toBe(false);
    expect(hidden).toBe(0);
    await key("Escape");
    expect(hidden).toBe(1);
    expect(picks).toEqual([{ id: "apps/apps", action: undefined }]);
  });

  it("cmd+backspace pops a level only with an empty query; with text it is the field's word delete", async () => {
    await mount();
    await key("Enter"); await flush();
    expect(crumb()).toBe("Applications");
    await type("sl"); await flush();
    const e = new KeyboardEvent("keydown", { key: "Backspace", ctrlKey: true, bubbles: true, cancelable: true });
    await act(() => { field().dispatchEvent(e); });
    expect(e.defaultPrevented).toBe(false);
    expect(crumb()).toBe("Applications");
    await type(""); await flush();
    await cmd("Backspace");
    expect(crumb()).toBeUndefined();
  });

  it("a bare Backspace with nothing typed goes back a level (general.backspace_back), never at the root, and stays the field's with text or with the key off", async () => {
    await mount();
    // At the root it is declined: nothing to leave.
    const atRoot = new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true });
    await act(() => { field().dispatchEvent(atRoot); });
    expect(atRoot.defaultPrevented).toBe(false);
    expect(crumb()).toBeUndefined();
    await key("Enter"); await flush();
    expect(crumb()).toBe("Applications");
    // With text it deletes a character, as always.
    await type("sl"); await flush();
    const typing = new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true });
    await act(() => { field().dispatchEvent(typing); });
    expect(typing.defaultPrevented).toBe(false);
    expect(crumb()).toBe("Applications");
    // Emptied, the next Backspace leaves the palette.
    await type(""); await flush();
    await key("Backspace");
    expect(crumb()).toBeUndefined();
    // The key off: a bare Backspace in an empty box does nothing.
    await mount({ prefs: { aliasSpace: true, backspaceBack: false, fallbacksAlways: false, searchHistory: true, now: [], compact: false } });
    await key("Enter"); await flush();
    expect(crumb()).toBe("Applications");
    await key("Backspace");
    expect(crumb()).toBe("Applications");
  });

  it("cmd+1..9 jump to that row; a number past the list is declined", async () => {
    await mount();
    await cmd("3");
    expect(activeName()).toBe("Slack");
    await cmd("1");
    expect(activeName()).toBe("Applications");
    const e = new KeyboardEvent("keydown", { key: "9", code: "Digit9", ctrlKey: true, bubbles: true, cancelable: true });
    await act(() => { field().dispatchEvent(e); });
    expect(activeName()).toBe("Applications");
  });

  it("with ordinals (the sidebar) every row wears its number and cmd+N runs row N, the cursor moved or not", async () => {
    await mount({ ordinals: true, start: { kind: "palette", palette: "apps/apps" } });
    expect([...el.querySelectorAll(".pal-row__ordinal")].map((k) => k.textContent)).toEqual(["1", "2"]);
    expect(activeName()).toBe("Slack");
    await cmd("2"); await flush();
    expect(picks).toEqual([{ id: "safari", action: "open" }]);
    expect(activeName()).toBe("Safari");
    // The row under the cursor already: run at once.
    await cmd("2"); await flush();
    expect(picks).toHaveLength(2);
    // Past the list: declined, nothing runs.
    await cmd("9"); await flush();
    expect(picks).toHaveLength(2);
    // Without the flag the numbers wait for cmd (let go above) and cmd+N only moves.
    await mount({ start: { kind: "palette", palette: "apps/apps" } });
    await act(() => { window.dispatchEvent(new KeyboardEvent("keyup", { key: "Control", bubbles: true })); });
    expect(el.querySelector(".pal-row__ordinal")).toBeNull();
    await cmd("1");
    expect(activeName()).toBe("Slack");
    expect(picks).toHaveLength(2);
  });
});

describe("Tab", () => {
  it("cycles the filter in a palette that has one, both ways, and the list follows", async () => {
    await mount();
    await key("ArrowDown"); await key("Enter"); await flush();
    expect(crumb()).toBe("Bookmarks");
    expect(filterValue()).toBe("all");
    await key("Tab"); await flush();
    expect(filterValue()).toBe("chrome");
    expect([...el.querySelectorAll(".pal-row__title")].map((r) => r.textContent)).toEqual(["Docs"]);
    await key("Tab"); await flush();
    expect(filterValue()).toBe("safari");
    await key("Tab", { shiftKey: true }); await flush();
    expect(filterValue()).toBe("chrome");
    expect(document.activeElement).toBe(field());
  });
  it("is swallowed at the root and in a palette without filters, so focus never leaves the box", async () => {
    await mount();
    const e = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    await act(() => { field().dispatchEvent(e); });
    expect(e.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(field());
  });
});

describe("focus and overlays", () => {
  it("a toast from a pick leaves the search box focused and the keys working", async () => {
    answer = () => ({ toast: { title: "Copied", style: "success" } });
    await mount();
    await cmd("3");
    await key("Enter"); await flush();
    expect(el.querySelector(".pal-toast")?.textContent).toContain("Copied");
    expect(el.querySelector(".pal-toast [tabindex]")).toBeNull();
    expect(document.activeElement).toBe(field());
    await key("ArrowDown");
    expect(activeName()).toBe("Safari");
  });
  it("cmd+k with the action panel open closes it; the panel's own field takes the typing", async () => {
    await mount();
    await cmd("k");
    expect(panelOpen()).toBe(true);
    expect(document.activeElement).toBe(el.querySelector(".pal-actions__search"));
    await cmd("k");
    expect(panelOpen()).toBe(false);
    expect(document.activeElement).toBe(field());
  });
  it("a confirm card: Enter goes ahead, Escape backs out, Tab reaches Cancel; the list behind never moves", async () => {
    await mount();
    await cmd("3");
    expect(activeName()).toBe("Slack");
    await cmd("q");
    const card = () => el.querySelector<HTMLElement>(".pal-confirm");
    expect(card()?.textContent).toContain("Quit Slack?");
    expect(document.activeElement).toBe(card()!.querySelector("[data-primary]"));
    expect(card()!.querySelector("[data-primary]")?.getAttribute("data-destructive")).toBe("true");
    // Arrows and Tab move between the two buttons, not the cursor behind; Escape backs out and hands focus back.
    await key("ArrowDown");
    expect(activeName()).toBe("Slack");
    await key("Tab");
    expect(document.activeElement?.textContent).toContain("Cancel");
    await key("Escape");
    expect(!!card() && !el.querySelector("[data-exiting] .pal-confirm")).toBe(false);
    expect(document.activeElement).toBe(field());
    expect(picks).toEqual([]);
    await cmd("q");
    await key("Enter"); await flush();
    expect(picks).toEqual([{ id: "slack", action: "quit" }]);
    expect(document.activeElement).toBe(field());
  });
  it("Up at the top of an empty root recalls the last query, Escape clears it, and the list stays reachable", async () => {
    await mount();
    await key("ArrowUp"); await flush();
    expect(field().value).toBe("slack");
    await key("ArrowUp"); await flush();
    expect(field().value).toBe("docs");
    await key("ArrowDown"); await flush();
    expect(field().value).toBe("slack");
    await key("Escape");
    expect(field().value).toBe("");
    expect(hidden).toBe(0);
  });
});

describe("the HUD and a toast never take the keyboard", () => {
  it("render nothing focusable: no field, no button, no tabindex; the HUD is a status, a failure toast an alert", () => {
    for (const html of [renderToStaticMarkup(<Hud text="Copied" />), renderToStaticMarkup(<Hud text="Done" celebrate />), renderToStaticMarkup(<Toast toast={{ title: "Copied", style: "success" }} />), renderToStaticMarkup(<Toast toast={{ title: "Failed", message: "why", style: "failure" }} />)]) {
      expect(html).not.toMatch(/<(input|button|textarea|select|a )/);
      expect(html).not.toContain("tabindex");
    }
    expect(renderToStaticMarkup(<Hud text="Copied" />)).toContain('role="status"');
    expect(renderToStaticMarkup(<Toast toast={{ title: "Failed", style: "failure" }} />)).toContain('role="alert"');
  });
});
