// @vitest-environment happy-dom
// Marked rows in a view level (`NodeBase.mark`, a bar popover's inbox):
// cmd+click toggles, shift+click marks the range from the view's cursor,
// a shifted arrow marks the row it leaves and the one the extension's
// arrow action lands on, the listed actions narrow to the `multi` ones
// (hidden keys still move the cursor), a multi action runs once with
// every marked id, a single-row key says so, marks of rows a new tree
// dropped go, and Escape clears before it leaves.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Launcher, type LauncherHandle } from "../Launcher";
import type { Ctx, Effect, SourceInfo } from "../items";
import type { Action, ViewNode, ViewSpec } from "../ui/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const source: SourceInfo = { extension: "mail", palette: "inbox", title: "Inbox", live: false, input: false, view: "view", count: 0, stale: false };
let rows: string[] = [];
let focus = 0;
const spec = (): ViewSpec => {
  const actions: Action[] = [
    { id: "open", title: "Open" },
    { id: "read", title: "Mark as read", shortcut: "m", multi: true },
    { id: "star", title: "Star", shortcut: "s" },
    { id: "down", title: "Next", shortcut: ["down", "j"], hidden: true },
    { id: "up", title: "Previous", shortcut: ["up", "k"], hidden: true },
    ...rows.map((r): Action => ({ id: `focus:${r}`, title: `Go to ${r}`, hidden: true })),
  ];
  const tree: ViewNode = { type: "stack", children: rows.map((r, i): ViewNode => ({ type: "stack", key: r, mark: r, action: `focus:${r}`, selected: i === focus || undefined, children: [{ type: "text", value: r }] })) };
  return { title: "Inbox", keys: "actions", actions, tree };
};
const picks: { action?: string; ids?: string[] }[] = [];
const answer = (action: string | undefined, ctx?: Ctx): Effect => {
  picks.push({ action, ...(ctx?.ids && { ids: ctx.ids }) });
  if (action === "down") focus = Math.min(focus + 1, rows.length - 1);
  else if (action === "up") focus = Math.max(focus - 1, 0);
  else if (action?.startsWith("focus:")) focus = rows.indexOf(action.slice(6));
  else if (action === "read") { const gone = new Set(ctx?.ids ?? [rows[focus]!]); rows = rows.filter((r) => !gone.has(r)); focus = Math.min(focus, rows.length - 1); }
  return { view: spec() };
};

let root: Root, el: HTMLDivElement;
const launcher: { current: LauncherHandle | null } = { current: null };
beforeEach(() => { el = document.createElement("div"); document.body.appendChild(el); root = createRoot(el); picks.length = 0; rows = ["m1", "m2", "m3", "m4"]; focus = 0; });
afterEach(() => { act(() => root.unmount()); el.remove(); });

const flush = () => act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });
const mount = async () => {
  await act(async () => {
    root.render(<Launcher ref={launcher} sources={[source]} search={async () => []} view={async () => spec()} onPick={(_i, _q, action, ctx) => answer(action, ctx)} onHide={() => {}} />);
  });
  await flush();
  await act(() => { launcher.current!.open("mail/inbox"); });
  await flush();
};
const key = async (k: string, init: KeyboardEventInit = {}) => { await act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init })); }); await flush(); };
const node = (id: string) => [...el.querySelectorAll<HTMLElement>("[data-mark]")].find((n) => n.textContent === id)!;
const click = async (id: string, init: MouseEventInit = {}) => { await act(() => { node(id).dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...init })); }); await flush(); };
const marked = () => [...el.querySelectorAll<HTMLElement>("[data-mark][data-marked]")].map((n) => n.textContent);
const count = () => el.querySelector(".pal-footer__count")?.textContent;
const toast = () => el.querySelector(".pal-toast")?.textContent ?? "";
const primary = () => el.querySelector(".pal-footer__hint-title")?.textContent;

describe("marks in a view level", () => {
  it("cmd+click toggles a row without running its click; the footer counts; m runs once over every marked id and the marks go", async () => {
    await mount();
    await click("m2", { ctrlKey: true });
    await click("m4", { ctrlKey: true });
    expect(marked()).toEqual(["m2", "m4"]);
    expect(count()).toBe("2 selected");
    expect(picks).toEqual([]);
    expect(primary()).toBe("Mark as read");
    await key("m");
    expect(picks).toEqual([{ action: "read", ids: ["m2", "m4"] }]);
    expect(rows).toEqual(["m1", "m3"]);
    expect(marked()).toEqual([]);
    expect(count()).toBeUndefined();
  });

  it("a plain click is still the row's action; shift+click marks the range from the view's cursor", async () => {
    await mount();
    await click("m2");
    expect(picks).toEqual([{ action: "focus:m2" }]);
    await click("m4", { shiftKey: true });
    expect(marked()).toEqual(["m2", "m3", "m4"]);
  });

  it("shift+down marks the row left and the row landed on; shift+up takes it back; the plain arrows still move with marks", async () => {
    await mount();
    await key("ArrowDown", { shiftKey: true });
    expect(marked()).toEqual(["m1", "m2"]);
    await key("ArrowDown", { shiftKey: true });
    expect(marked()).toEqual(["m1", "m2", "m3"]);
    await key("ArrowUp", { shiftKey: true });
    expect(marked()).toEqual(["m1", "m2"]);
    await key("j");
    expect(focus).toBe(2);
    expect(marked()).toEqual(["m1", "m2"]);
    await key("m");
    // The cursor's row is not marked: the marked ones in order.
    expect(picks.at(-1)).toEqual({ action: "read", ids: ["m1", "m2"] });
  });

  it("a single-row key with marks says so and runs nothing; Escape clears the marks before leaving", async () => {
    await mount();
    await click("m1", { ctrlKey: true });
    await key("s");
    expect(picks).toEqual([]);
    expect(toast()).toContain("Star works on one row");
    await key("Escape");
    expect(marked()).toEqual([]);
    expect(el.querySelector("[data-mark]")).not.toBeNull();
  });

  it("marks of rows a new tree no longer has drop out", async () => {
    await mount();
    await click("m3", { ctrlKey: true });
    await click("m4", { ctrlKey: true });
    rows = ["m1", "m2", "m3"];
    await key("j");
    expect(marked()).toEqual(["m3"]);
    expect(count()).toBe("1 selected");
  });
});
