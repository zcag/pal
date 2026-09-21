// @vitest-environment happy-dom
// Live views: a push (`update` in the handle, what `pal://view` delivers)
// lands on the open level in place, keyed nodes keep their DOM (a moved
// key is the same element at its new place, a new key a new one), the
// text field and its caret are untouched, a `{ tree }` push keeps the
// actions and the input while a whole spec replaces them, a push for
// another id or palette is ignored, and the shell hears which view is on
// top (`onViewOpen`) as levels come and go. The pull half: `refresh` on
// the palette re-asks the tree on its cadence, `on` on its trigger.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Launcher, type LauncherHandle, type ViewOpen } from "../Launcher";
import type { SourceInfo } from "../items";
import type { Action, ViewNode, ViewSpec } from "../ui/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const source: SourceInfo = { extension: "spotify", palette: "lyrics", title: "Lyrics", live: false, input: true, view: "view", count: 0, stale: false, refresh: 5, on: ["media"] };
const actions: Action[] = [
  { id: "toggle", title: "Pause", shortcut: "space" },
  { id: "search", title: "Search", shortcut: "enter" },
  { id: "close", title: "Close", hidden: true, shortcut: "escape" },
];
const line = (key: string, value: string): ViewNode => ({ type: "text", key, value, transition: { move: true, enter: "slide-up" } });
const lines = (...keys: string[]): ViewNode => ({ type: "stack", children: keys.map((k) => line(k, `line ${k}`)) });
const spec = (tree: ViewNode, extra: Partial<ViewSpec> = {}): ViewSpec => ({ title: "Lyrics", keys: "actions", actions, tree, ...extra });

let root: Root, el: HTMLDivElement;
const launcher: { current: LauncherHandle | null } = { current: null };
const opens: (ViewOpen | null)[] = [];
let views = 0;
let served: ViewSpec = spec(lines("a", "b", "c"));

beforeEach(() => {
  el = document.createElement("div");
  document.body.appendChild(el);
  root = createRoot(el);
  opens.length = 0;
  views = 0;
  served = spec(lines("a", "b", "c"));
});
afterEach(() => { act(() => root.unmount()); el.remove(); vi.useRealTimers(); });

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
const mount = async () => {
  await act(async () => {
    root.render(<Launcher ref={launcher} sources={[source]} search={async () => []} view={async () => { views++; return served; }} onPick={() => ({ view: served })} onHide={() => {}} onViewOpen={(o) => opens.push(o)} />);
  });
  await flush();
  await act(() => { launcher.current!.open("spotify/lyrics"); });
  await flush();
};
/** The text nodes on screen, the ones exiting (kept under the presence wrapper until their exit ends) left out. */
const texts = () => [...el.querySelectorAll<HTMLElement>(".pal-view__text")].filter((t) => !t.closest("[data-exiting]"));
const values = () => texts().map((t) => t.textContent);
const push = (u: Parameters<LauncherHandle["update"]>[0]) => act(() => { launcher.current!.update(u); });
const input = () => el.querySelector<HTMLInputElement>(".pal-search__input")!;

describe("live view", () => {
  it("a tree push lands in place: kept keys keep their element, a moved key moves it, a new key is new, the actions stay", async () => {
    await mount();
    expect(values()).toEqual(["line a", "line b", "line c"]);
    const [a, b, c] = texts();
    await push({ extension: "spotify", palette: "lyrics", spec: { tree: lines("b", "c", "d") } });
    // `a` is leaving (its exit runs under the presence wrapper), the rest moved up, `d` is new.
    const now = texts();
    expect(now.map((t) => t.textContent)).toEqual(["line b", "line c", "line d"]);
    expect(a.closest("[data-exiting]")).not.toBeNull();
    expect(now[0]).toBe(b);
    expect(now[1]).toBe(c);
    expect(now[2]).not.toBe(a);
    expect(el.querySelector(".pal-footer__hint")?.textContent).toContain("Pause");
    expect(views).toBe(1);
  });

  it("keeps the text field and its caret across a tree push; a whole spec replaces the actions", async () => {
    served = spec(lines("a"), { input: { value: "", placeholder: "Search lyrics", submit: "search", cancel: "close" } });
    await mount();
    const field = input();
    await act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, "weird"); field.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(() => { field.setSelectionRange(2, 2); });
    await push({ extension: "spotify", palette: "lyrics", spec: { tree: lines("a", "b") } });
    expect(input()).toBe(field);
    expect(field.value).toBe("weird");
    expect(field.selectionStart).toBe(2);
    expect(values()).toEqual(["line a", "line b"]);
    // A whole spec without `input` closes the field and swaps the actions.
    await push({ extension: "spotify", palette: "lyrics", spec: spec(lines("z"), { actions: [{ id: "x", title: "Only this" }] }) });
    await flush();
    expect(el.querySelector(".pal-footer__hint")?.textContent).toContain("Only this");
    expect(el.querySelector(".pal-search__title")?.textContent).toBe("Lyrics");
    expect(values()).toEqual(["line z"]);
  });

  it("ignores a push for another palette or id, and one without a tree", async () => {
    served = spec(lines("a"), { id: "track:1" });
    await mount();
    await push({ extension: "spotify", palette: "queue", spec: { tree: lines("q") } });
    await push({ extension: "spotify", palette: "lyrics", id: "track:2", spec: { tree: lines("q") } });
    await push({ extension: "spotify", palette: "lyrics", spec: { tree: undefined as never } });
    expect(values()).toEqual(["line a"]);
    await push({ extension: "spotify", palette: "lyrics", id: "track:1", spec: { tree: lines("q") } });
    expect(values()).toEqual(["line q"]);
  });

  it("reports the view on top to the shell as levels come and go", async () => {
    served = spec(lines("a"), { id: "track:1" });
    await mount();
    expect(opens).toEqual([null, { extension: "spotify", palette: "lyrics", id: "track:1" }]);
    await act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
    await flush();
    expect(opens.at(-1)).toBeNull();
  });

  it("a bar item's own { view } level (BarPage's levelOf) is reported by the item and takes a { bar } push; a { palette } level naming a view palette starts as a view level", async () => {
    await mount();
    await act(() => { launcher.current!.start({ kind: "view", palette: "bar:spotify/playing", title: "Spotify", spec: spec(lines("a"), { id: "now" }) }); });
    await flush();
    expect(opens.at(-1)).toEqual({ extension: "spotify", bar: "playing", id: "now" });
    // The popover opening on the same item again (the shell forgot the report): reported again, the same value.
    const n = opens.length;
    await act(() => { launcher.current!.start({ kind: "view", palette: "bar:spotify/playing", title: "Spotify", spec: spec(lines("a"), { id: "now" }) }); });
    await flush();
    expect(opens.slice(n)).toEqual([{ extension: "spotify", bar: "playing", id: "now" }]);
    await push({ extension: "spotify", palette: "playing", spec: { tree: lines("p") } });
    expect(values()).toEqual(["line a"]);
    await push({ extension: "spotify", bar: "playing", spec: { tree: lines("b") } });
    expect(values()).toEqual(["line b"]);
    // The item rendered again while showing (in place): the level keeps the tree the render carries, and a spec-less restart keeps the one it has.
    await act(() => { launcher.current!.start({ kind: "palette", palette: "spotify/lyrics" }, true); });
    await flush();
    expect(opens.at(-1)).toEqual({ extension: "spotify", palette: "lyrics", id: "view" });
    expect(views).toBe(2);
    expect(values()).toEqual(["line a", "line b", "line c"]);
  });

  it("a bar item named after one of its extension's palettes (github's prs/issues/notifications) is still the item's own level: reported by the item, and a pick from it carries no source", async () => {
    const playing: SourceInfo = { ...source, palette: "playing", title: "Playing", input: false };
    const picks: { palette?: string; source?: unknown }[] = [];
    await act(async () => {
      root.render(<Launcher ref={launcher} sources={[source, playing]} search={async () => []} view={async () => served} onPick={(item) => { picks.push({ palette: item.palette, source: item.source }); return {}; }} onHide={() => {}} onViewOpen={(o) => opens.push(o)} />);
    });
    await flush();
    await act(() => { launcher.current!.start({ kind: "view", palette: "bar:spotify/playing", title: "Spotify", spec: spec(lines("a"), { id: "now" }) }); });
    await flush();
    expect(opens.at(-1)).toEqual({ extension: "spotify", bar: "playing", id: "now" });
    await act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true })); });
    await flush();
    expect(picks).toEqual([{ palette: "bar:spotify/playing", source: undefined }]);
  });

  it("a palette pushed over the popover's view level hides it, and the item rendered again in place meanwhile does not bring it back", async () => {
    await mount();
    const bar = (v: string) => ({ kind: "view" as const, palette: "bar:spotify/playing", title: "Spotify", spec: spec(lines(v), { id: "now" }) });
    await act(() => { launcher.current!.start(bar("a")); });
    await flush();
    expect(opens.at(-1)).toEqual({ extension: "spotify", bar: "playing", id: "now" });
    await act(() => { launcher.current!.apply({ id: "now", name: "x", palette: "bar:spotify/playing" }, { push: { extension: "spotify", palette: "lyrics" } }); });
    await flush();
    // The pushed level is a view palette too: it is what is on top now.
    expect(opens.at(-1)).toEqual({ extension: "spotify", palette: "lyrics", id: "view" });
    const n = opens.length;
    await act(() => { launcher.current!.start(bar("b"), true); });
    await flush();
    expect(opens.slice(n)).toEqual([]);
    await act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
    await flush();
    expect(opens.at(-1)).toEqual({ extension: "spotify", bar: "playing", id: "now" });
    expect(values()).toEqual(["line b"]);
  });

  it("re-asks the tree on the palette's refresh cadence and on its trigger, in place", async () => {
    vi.useFakeTimers();
    await mount();
    expect(views).toBe(1);
    served = spec(lines("b"));
    await act(async () => { vi.advanceTimersByTime(5000); });
    await flush();
    expect(views).toBe(2);
    expect(values()).toEqual(["line b"]);
    served = spec(lines("c"));
    await act(() => { launcher.current!.trigger("wake"); });
    await flush();
    expect(views).toBe(2);
    await act(() => { launcher.current!.trigger("media"); });
    await flush();
    expect(views).toBe(3);
    expect(values()).toEqual(["line c"]);
  });
});
