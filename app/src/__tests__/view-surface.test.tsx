// @vitest-environment happy-dom
// A game surface's level (ui/Surface.tsx, docs/design/game-surface.md):
// the node is a sandboxed frame on the extension's page; only our frame's
// messages count; the page's title, keys (Escape leaves, ⌘K opens the
// actions) and calls go where the panel's would, the calls to the host for
// the level the Launcher knows; a view action goes to the page, never to
// `pick`; a push (`post`) and the shown state reach the page.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Launcher, type LauncherHandle, type SurfaceBridge } from "../Launcher";
import type { SourceInfo } from "../items";
import type { ViewSpec } from "../ui/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const source: SourceInfo = { extension: "snake", palette: "snake", title: "Snake", live: false, input: false, view: "view", count: 0, stale: false };
const spec: ViewSpec = { title: "Snake", tree: { type: "surface", src: "surface/index.html" }, actions: [{ id: "new", title: "New game" }, { id: "pause", title: "Pause", shortcut: "cmd+p" }] };

let root: Root, el: HTMLDivElement;
const launcher: { current: LauncherHandle | null } = { current: null };
let picks: (string | undefined)[], hides: number, calls: unknown[][];
const bridge: SurfaceBridge = {
  // Not the real `ext://`: happy-dom would try to fetch it.
  url: (extension, src) => `about:blank#${extension}/${src}`,
  call: async (level, method, params) => { calls.push([level, method, params]); return method === "send" ? { got: params.msg } : null; },
};

beforeEach(() => {
  el = document.createElement("div");
  document.body.appendChild(el);
  root = createRoot(el);
  picks = []; hides = 0; calls = [];
});
afterEach(() => { act(() => root.unmount()); el.remove(); });

const flush = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });
const frame = () => el.querySelector("iframe");
/** What the app posted to the page, by `pal` kind. */
let posted: Record<string, unknown>[] = [];
const mount = async () => {
  await act(async () => {
    root.render(<Launcher ref={launcher} sources={[source]} search={async () => []} view={async () => spec} surface={bridge} onPick={(_i, _q, a) => { picks.push(a); return {}; }} onHide={() => { hides++; }} />);
  });
  await flush();
  await act(() => { launcher.current!.open("snake/snake"); });
  await flush();
  posted = [];
  vi.spyOn(frame()!.contentWindow!, "postMessage").mockImplementation(((m: Record<string, unknown>) => { posted.push(m); }) as never);
};
/** A message as if from the page: our frame's window unless `source` says otherwise. */
const fromPage = async (data: unknown, source: unknown = frame()!.contentWindow) => {
  await act(() => { window.dispatchEvent(new MessageEvent("message", { data, source: source as Window })); });
  await flush();
};
const title = () => el.querySelector(".pal-search__title")?.textContent;

describe("surface level", () => {
  it("draws a sandboxed frame on the extension's page, hidden until the page is ready", async () => {
    await mount();
    const f = frame()!;
    expect(f.getAttribute("src")).toBe("about:blank#snake/surface/index.html");
    expect(f.getAttribute("sandbox")).toBe("allow-scripts");
    expect(el.querySelector(".pal-view__surface")!.hasAttribute("data-ready")).toBe(false);
    await fromPage({ pal: "hello" });
    expect(posted[0]).toMatchObject({ pal: "theme", scheme: expect.stringMatching(/^(light|dark)$/), tokens: expect.any(Object) });
    await fromPage({ pal: "ready" });
    expect(el.querySelector(".pal-view__surface")!.hasAttribute("data-ready")).toBe(true);
  });

  it("hears only its own frame: the title from the page, not from another window", async () => {
    await mount();
    await fromPage({ pal: "title", text: "Score 4" }, window);
    expect(title()).toBe("Snake");
    await fromPage({ pal: "title", text: "Score 4" });
    expect(title()).toBe("Score 4");
    await fromPage({ pal: "title", text: "" });
    expect(title()).toBe("Snake");
  });

  it("relays a call to the host for the level, never the page's say of which, and posts the reply", async () => {
    await mount();
    await fromPage({ pal: "hello" });
    await fromPage({ pal: "call", id: 3, method: "send", params: { msg: { dir: "up" }, extension: "other" } });
    expect(calls).toEqual([[{ extension: "snake", palette: "snake" }, "send", { msg: { dir: "up" }, extension: "other" }]]);
    expect(posted).toContainEqual({ pal: "reply", id: 3, result: { got: { dir: "up" } } });
    await fromPage({ pal: "call", id: 4, method: "exec", params: {} });
    expect(posted).toContainEqual({ pal: "reply", id: 4, error: "no surface call exec" });
  });

  it("a view action goes to the page, not to pick", async () => {
    await mount();
    await fromPage({ pal: "hello" });
    // Enter with the panel focused is the first action, as for any view.
    await act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); });
    await flush();
    expect(posted).toContainEqual({ pal: "action", id: "new" });
    expect(picks).toEqual([]);
  });

  it("the page's forwarded keys act as the panel's: a cmd combo runs its action, ⌘K opens the actions, Escape leaves", async () => {
    await mount();
    await fromPage({ pal: "hello" });
    await fromPage({ pal: "key", key: "p", code: "KeyP", metaKey: true, ctrlKey: true });
    expect(posted).toContainEqual({ pal: "action", id: "pause" });
    await fromPage({ pal: "key", key: "k", code: "KeyK", metaKey: true, ctrlKey: true });
    expect(el.querySelector(".pal-actions")).not.toBeNull();
    await act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
    await flush();
    await fromPage({ pal: "key", key: "Escape", code: "Escape" });
    expect(frame()).toBeNull();
    expect(hides).toBe(0);
  });

  it("a new spec with the same surface node keeps the frame, its page and its handshake; another src is another page", async () => {
    await mount();
    await fromPage({ pal: "hello" });
    const f = frame();
    const same = (title: string, key?: string): ViewSpec => ({ title, tree: { type: "surface", src: "surface/index.html", ...(key && { key }) }, actions: [{ id: "hit", title: "Hit" }] });
    // A push (blackjack's fresh actions after a move) and a pick's `{ view }` alike.
    await act(() => { launcher.current!.update({ extension: "snake", palette: "snake", spec: same("Your turn", "table") }); });
    await flush();
    expect(frame()).toBe(f);
    expect(title()).toBe("Your turn");
    await act(() => { launcher.current!.apply({ id: "view", name: "Snake", palette: "snake/snake" }, { view: same("Dealer plays", "table") }); });
    await flush();
    expect(frame()).toBe(f);
    expect(title()).toBe("Dealer plays");
    // The page is the same, so nothing is said to it again; its next action is the new spec's.
    expect(posted.filter((m) => m.pal === "theme")).toHaveLength(1);
    await act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); });
    await flush();
    expect(posted).toContainEqual({ pal: "action", id: "hit" });
    await act(() => { launcher.current!.update({ extension: "snake", palette: "snake", spec: { ...same("Next"), tree: { type: "surface", src: "surface/other.html" } } }); });
    await flush();
    expect(frame()).not.toBe(f);
    expect(frame()!.getAttribute("src")).toBe("about:blank#snake/surface/other.html");
  });

  it("a push for the level reaches the page, as does the level hidden and shown; one for another level does not", async () => {
    await mount();
    // Before the page's hello the message waits, then arrives after the theme.
    await act(() => { launcher.current!.update({ extension: "snake", palette: "snake", post: { pal: "message", data: { food: [1, 2] } } }); });
    expect(posted).toEqual([]);
    await fromPage({ pal: "hello" });
    expect(posted.map((m) => m.pal)).toEqual(["theme", "message"]);
    await act(() => { launcher.current!.update({ extension: "snake", palette: "snake", shown: false }); });
    await act(() => { launcher.current!.update({ extension: "tetris", palette: "tetris", post: { pal: "message", data: 1 } }); });
    await act(() => { launcher.current!.update({ extension: "snake", palette: "snake", post: { pal: "action", data: "x" } }); });
    expect(posted.slice(2)).toEqual([{ pal: "hidden" }]);
  });
});
