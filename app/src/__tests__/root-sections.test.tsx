// @vitest-environment happy-dom
// The root's composition (Launcher.tsx `rootHits`): inline sections above
// the hits, fallback rows only when nothing else came (or always), the
// empty root's Welcome, Now, Frequent, Recent Files order; the alias-and-
// space jump (`aliasTarget`, `setQuery`); the search history recalled
// with Up at the top of an empty root; a fallback "Ask" row opening its
// palette with the query typed; and the "Reset ranking" action.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Launcher, aliasTarget, rootHits, type LauncherHandle, type Prefs } from "../Launcher";
import type { SourceInfo } from "../items";
import type { Hit } from "../ui";
import type { Item } from "../ui/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const src = (extension: string, palette: string, title: string, more: Partial<SourceInfo> = {}): SourceInfo => ({ extension, palette, title, live: false, input: false, count: 1, stale: false, ...more });
const SOURCES: SourceInfo[] = [
  src("pal", "welcome", "Welcome"),
  src("pal", "palettes", "Palettes"),
  src("apps", "apps", "Applications"),
  src("calc", "calc", "Calculator", { input: true, inline: true, fallback: "ask" }),
  src("emoji", "emoji", "Emoji", { alias: "em" }),
  src("files", "recent", "Recent Files"),
  src("colors", "picker", "Colour Picker", { view: "view", input: true }),
  src("clipboard", "history", "Clipboard History"),
  src("colors", "history", "Colour History"),
];
const item = (palette: string, id: string, name: string, more: Partial<Item> = {}): Item => ({ id, name, palette, source: { extension: palette.split("/")[0], palette: palette.split("/")[1] }, ...more });
const hit = (palette: string, id: string, name: string, more: Partial<Item> = {}): Hit => ({ item: item(palette, id, name, more) });
const titleOf = (key: string) => SOURCES.find((s) => `${s.extension}/${s.palette}` === key)?.title ?? key;
const names = (hits: Hit[]) => hits.map((h) => `${h.item.section}:${h.item.name}`);

describe("rootHits", () => {
  const found = [hit("apps/apps", "a", "Slack"), hit("emoji/emoji", "e", "smile")];
  const inline = [hit("calc/calc", "r", "4", { group: "Calculator" })];
  const fallback = [hit("pal/fallback", "web", "Search the web", { group: "Use “x” with" }), hit("calc/calc", "pal:ask", "Ask Calculator", { group: "Use “x” with", push: { extension: "calc", palette: "calc", query: "x" } })];
  it("typed: inline sections first, then the hits under their palettes, fallbacks only with nothing else unless always", () => {
    expect(names(rootHits("x", found, inline, fallback, [], false, titleOf))).toEqual(["Calculator:4", "Applications:Slack", "Emoji:smile"]);
    expect(names(rootHits("x", [], [], fallback, [], false, titleOf))).toEqual(["Use “x” with:Search the web", "Use “x” with:Ask Calculator"]);
    // An inline answer is a result: no fallbacks under it.
    expect(names(rootHits("x", [], inline, fallback, [], false, titleOf))).toEqual(["Calculator:4"]);
    expect(names(rootHits("x", found, [], fallback, [], true, titleOf))).toEqual(["Applications:Slack", "Emoji:smile", "Use “x” with:Search the web", "Use “x” with:Ask Calculator"]);
  });
  it("empty: welcome, the suggestions, Frequent, Recent Files, then the rest as the core ordered it", () => {
    const empty = [
      hit("pal/welcome", "about", "You are in pal"),
      hit("apps/apps", "b", "B", { group: "Frequent" }),
      hit("pal/palettes", "apps/apps", "Applications"),
      hit("apps/apps", "a", "A"),
      hit("files/recent", "f", "report.pdf"),
      hit("emoji/emoji", "e", "smile"),
    ];
    const suggested = [hit("calendar/today", "ev", "Standup", { group: "Now" }), hit("clipboard/rows", "url", "example.com", { group: "Clipboard" })];
    expect(names(rootHits("", empty, inline, fallback, suggested, true, titleOf))).toEqual([
      "Welcome:You are in pal", "Now:Standup", "Clipboard:example.com", "Frequent:B", "Recent Files:report.pdf", "Palettes:Applications", "Applications:A", "Emoji:smile",
    ]);
  });
});

describe("aliasTarget", () => {
  it("the alias, else the palette name, else a one-word title, each only when one palette answers; never a shell source or a view palette", () => {
    expect(aliasTarget(SOURCES, "em")!.palette).toBe("emoji");
    expect(aliasTarget(SOURCES, "EM")!.palette).toBe("emoji");
    expect(aliasTarget(SOURCES, "calc")!.palette).toBe("calc");
    expect(aliasTarget(SOURCES, "emoji")!.palette).toBe("emoji");
    expect(aliasTarget(SOURCES, "applications")!.extension).toBe("apps");
    expect(aliasTarget(SOURCES, "history")).toBeUndefined();
    expect(aliasTarget(SOURCES, "palettes")).toBeUndefined();
    expect(aliasTarget(SOURCES, "picker")).toBeUndefined();
    expect(aliasTarget(SOURCES, "")).toBeUndefined();
  });
  it("a unique prefix, or an extension's name reaching its search", () => {
    const srcs = [...SOURCES, src("tela", "search", "Search tela", { input: true }), src("tela", "pages", "tela Pages"), src("tela", "spaces", "Spaces")];
    expect(aliasTarget(srcs, "emo")!.palette).toBe("emoji");
    expect(aliasTarget(srcs, "tela")!.palette).toBe("search");
    expect(aliasTarget(srcs, "tel")!.palette).toBe("search");
    expect(aliasTarget(srcs, "e")).toBeUndefined();
  });
});

let root: Root, el: HTMLDivElement;
const launcher: { current: LauncherHandle | null } = { current: null };
const searches: [string, string | undefined][] = [];
const picks: string[] = [];
const forgets: string[] = [];
let history: string[] = [];
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
const search = async (q: string, scope?: SourceInfo): Promise<Hit[]> => {
  searches.push([q, scope?.palette]);
  if (scope) return [hit(`${scope.extension}/${scope.palette}`, "in", `${scope.title} row for “${q}”`)];
  if (!q) return [hit("pal/palettes", "apps/apps", "Applications"), hit("apps/apps", "slack", "Slack")];
  return q.startsWith("sl") ? [hit("apps/apps", "slack", "Slack")] : [];
};
const fallback = async (q: string): Promise<Hit[]> => [hit("calc/calc", "pal:ask", "Ask Calculator", { group: `Use “${q}” with`, push: { extension: "calc", palette: "calc", query: q } })];
const mount = async (prefs?: Partial<Prefs>) => {
  await act(async () => {
    root.render(<Launcher ref={launcher} sources={SOURCES} search={search} fallback={fallback} history={async () => history} prefs={{ aliasSpace: true, fallbacksAlways: false, searchHistory: true, now: [], compact: false, ...prefs }} onPick={(i) => { picks.push(i.id); }} onHide={() => {}} onForget={async (i) => { forgets.push(i.id); return true; }} />);
  });
  await flush();
};
beforeEach(() => {
  el = document.createElement("div"); document.body.appendChild(el); root = createRoot(el); searches.length = 0; picks.length = 0; forgets.length = 0; history = [];
  // happy-dom lays nothing out: give the list a viewport so the virtualiser draws rows.
  HTMLElement.prototype.getBoundingClientRect = function () { return { left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400, x: 0, y: 0, toJSON: () => ({}) } as DOMRect; };
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 400 });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 600 });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => 400 });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => 600 });
  // happy-dom's ResizeObserver reports a zero box right after observe, which would undo the rect above.
  (globalThis as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
});
afterEach(() => { act(() => root.unmount()); el.remove(); });
const field = () => el.querySelector<HTMLInputElement>(".pal-search__input")!;
const type = (value: string) => act(() => { const f = field(); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!; setter.call(f, value); f.dispatchEvent(new Event("input", { bubbles: true })); });
const key = (k: string, init: KeyboardEventInit = {}) => act(() => { (document.activeElement ?? window).dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init })); });
const crumb = () => el.querySelector(".pal-search__crumb")?.textContent;
const rowNames = () => [...el.querySelectorAll(".pal-row__title")].map((r) => r.textContent);
const wait = (ms: number) => act(() => new Promise((r) => setTimeout(r, ms)));

describe("alias and space", () => {
  it("a word and a space typed forward jumps into the palette the word names, the rest typed there; a deletion or an unknown word does not", async () => {
    await mount();
    await type("em"); await flush();
    expect(crumb()).toBeUndefined();
    await type("em "); await flush();
    expect(crumb()).toBe("Emoji");
    expect(field().value).toBe("");
    await type("cat"); await flush();
    expect(searches.at(-1)).toEqual(["cat", "emoji"]);
    await key("Escape"); await flush();
    await key("Escape"); await flush();
    expect(crumb()).toBeUndefined();
    // A word nothing answers to stays a query with a space in it; typing backwards over a space never jumps.
    await type("xyz "); await flush();
    expect(crumb()).toBeUndefined();
    expect(field().value).toBe("xyz ");
    await type("xyz"); await type("xyz "); await flush();
    expect(crumb()).toBeUndefined();
  });
  it("off with the pref; a pasted `calc 2+2` still lands in Calculator with the rest typed when on", async () => {
    await mount({ aliasSpace: false });
    await type("em "); await flush();
    expect(crumb()).toBeUndefined();
    expect(field().value).toBe("em ");
    await act(() => root.unmount()); el.remove(); el = document.createElement("div"); document.body.appendChild(el); root = createRoot(el);
    await mount();
    await act(() => { launcher.current!.type("calc 2+2"); }); await flush();
    expect(crumb()).toBe("Calculator");
    expect(field().value).toBe("2+2");
  });
});

describe("search history", () => {
  it("Up at the top of an empty root walks the history (newest first), Down walks back to an empty box, typing ends the walk, Escape clears", async () => {
    history = ["slack", "em", "2+2"];
    await mount();
    expect(rowNames()).toEqual(["Applications", "Slack"]);
    await key("ArrowUp"); await flush(); await flush();
    expect(field().value).toBe("slack");
    await key("ArrowUp"); await flush();
    expect(field().value).toBe("em");
    await key("ArrowDown"); await flush();
    expect(field().value).toBe("slack");
    await key("ArrowDown"); await flush();
    expect(field().value).toBe("");
    await key("ArrowUp"); await flush();
    await key("ArrowUp"); await flush();
    await key("ArrowUp"); await flush();
    expect(field().value).toBe("2+2");
    await key("ArrowUp"); await flush();
    expect(field().value).toBe("2+2"); // the end of the history
    await key("Escape"); await flush();
    expect(field().value).toBe("");
    // With something typed, Up is the cursor's.
    await type("sl"); await flush();
    await key("ArrowUp"); await flush();
    expect(field().value).toBe("sl");
  });
  it("nothing with the pref off", async () => {
    history = ["slack"];
    await mount({ searchHistory: false });
    await key("ArrowUp"); await flush(); await flush();
    expect(field().value).toBe("");
  });
});

describe("fallback rows and reset ranking", () => {
  it("an Ask row arrives after the debounce when nothing matched and Enter on it opens the palette with the query typed", async () => {
    await mount();
    await type("2+2"); await flush();
    expect(rowNames()).toEqual([]);
    await wait(200); await flush();
    expect(rowNames()).toEqual(["Ask Calculator"]);
    expect(el.querySelector(".pal-section__title")?.textContent).toBe("Use “2+2” with");
    await key("Enter"); await flush();
    expect(picks).toEqual([]);
    expect(crumb()).toBe("Calculator");
    expect(field().value).toBe("2+2");
  });
  it("the Reset ranking action is offered on an indexed row and calls back with it", async () => {
    await mount();
    await type("sl"); await flush();
    expect(rowNames()).toEqual(["Slack"]);
    await key("k", { metaKey: true, ctrlKey: true, code: "KeyK" }); await flush();
    const titles = [...el.querySelectorAll(".pal-action__title")].map((a) => a.textContent);
    expect(titles).toContain("Reset ranking for this item");
    const reset = [...el.querySelectorAll<HTMLElement>(".pal-action")].find((a) => a.textContent?.includes("Reset ranking"))!;
    await act(() => { reset.click(); }); await flush(); await flush();
    expect(forgets).toEqual(["slack"]);
    expect(el.querySelector(".pal-toast")?.textContent).toContain("Ranking reset");
  });
});
