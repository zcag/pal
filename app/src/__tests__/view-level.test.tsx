// @vitest-environment happy-dom
// The view level's keys: Backspace routes as a bare key, an action with
// several shortcuts answers to any of them (the panel draws the first and
// the rest faintly), a hidden action routes without being listed, and keys
// pressed while a pick is in flight queue up and run against the tree the
// reply brings.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Launcher, type LauncherHandle } from "../Launcher";
import type { Effect, SourceInfo } from "../items";
import type { Action, ViewSpec } from "../ui/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const source: SourceInfo = { extension: "wordle", palette: "wordle", title: "Wordle", live: false, input: true, view: "view", count: 0, stale: false };
const actions: Action[] = [
  { id: "submit", title: "Submit", shortcut: "enter" },
  { id: "delete", title: "Delete a letter", shortcut: "backspace" },
  { id: "up", title: "Up", shortcut: ["up", "k"] },
  { id: "a", title: "Type A", shortcut: "a", hidden: true },
];
const tree = (typed: string): ViewSpec => ({ title: `Typed ${typed}`, keys: "actions", actions, tree: { type: "stack", children: [{ type: "text", value: typed }] } });

let root: Root, el: HTMLDivElement;
const launcher: { current: LauncherHandle | null } = { current: null };
const picks: string[] = [];
/** The extension: every pick appends the action to the typed text; `delete` takes one off. Answered when `reply` is called, so a pick can be held in flight. */
let pending: (() => void)[] = [];
let typed = "";
const answer = (action?: string): Effect => {
  if (action === "delete") typed = typed.slice(0, -1);
  else if (action && action !== "submit") typed += action;
  return { view: tree(typed) };
};

beforeEach(() => {
  el = document.createElement("div");
  document.body.appendChild(el);
  root = createRoot(el);
  picks.length = 0;
  pending = [];
  typed = "";
});
afterEach(() => { act(() => root.unmount()); el.remove(); });

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
const mount = async (hold = false) => {
  await act(async () => {
    root.render(
      <Launcher
        ref={launcher}
        sources={[source]}
        search={async () => []}
        view={async () => tree(typed)}
        onPick={(_item, _q, action) => {
          picks.push(action ?? "");
          if (!hold) return answer(action);
          return new Promise<Effect>((resolve) => pending.push(() => resolve(answer(action))));
        }}
        onHide={() => {}}
      />,
    );
  });
  await flush();
  // Into the view level, as a palette hotkey would.
  await act(() => { launcher.current!.open("wordle/wordle"); });
  await flush();
};
const key = (k: string, init: KeyboardEventInit = {}) => act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init })); });
const reply = async () => { const next = pending.shift(); await act(async () => { next?.(); }); await flush(); };
const title = () => el.querySelector(".pal-search__title")?.textContent;

describe("view level", () => {
  it("routes Backspace as a bare key, and either of an action's shortcuts", async () => {
    await mount();
    expect(title()).toBe("Typed ");
    await key("a"); await flush();
    await key("k"); await flush();
    await key("ArrowUp"); await flush();
    await key("Backspace"); await flush();
    expect(picks).toEqual(["a", "up", "up", "delete"]);
    expect(title()).toBe("Typed aupu");
  });

  it("keeps a hidden action out of the panel and the footer; the panel draws the alternatives faintly before the first key", async () => {
    await mount();
    expect(el.querySelector(".pal-footer__hint")?.textContent).toContain("Submit");
    // No navigator in the test: the primary modifier is Control.
    await key("k", { ctrlKey: true }); await flush();
    const rows = [...el.querySelectorAll(".pal-action")].map((r) => r.textContent);
    expect(rows).toEqual(["SubmitEnter", "Delete a letterBksp", "UpK↑"]);
    expect(el.querySelector(".pal-action__alt")?.textContent).toBe("K");
    expect(rows.join()).not.toContain("Type A");
  });

  it("queues keys pressed while a pick is in flight and runs them against the reply's tree, four at most", async () => {
    await mount(true);
    await key("a");
    expect(picks).toEqual(["a"]);
    // Five more while the first is on its way: four wait, the fifth is dropped.
    for (const k of ["a", "a", "Backspace", "a", "a"]) await key(k);
    expect(picks).toEqual(["a"]);
    await reply();
    expect(picks).toEqual(["a", "a"]);
    await reply(); await reply(); await reply();
    expect(picks).toEqual(["a", "a", "a", "delete", "a"]);
    await reply();
    expect(pending).toHaveLength(0);
    expect(title()).toBe("Typed aaa");
  });

  it("drops the queue when the level is left", async () => {
    await mount(true);
    await key("a");
    await key("a");
    await key("Escape"); await flush();
    expect(el.querySelector(".pal-search__title")).toBeNull();
    await reply();
    expect(picks).toEqual(["a"]);
  });
});
