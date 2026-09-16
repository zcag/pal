// @vitest-environment happy-dom
// A view's text field (`View.input`): a hidden digit action opens it with
// the digit as its value, typing goes to the field (bare keys are not
// actions, arrows move the caret), Enter picks the submit action with the
// text, Escape the cancel action, a tree without `input` closes it and
// clears the query, and a shifted arrow runs its own action or falls back
// to the plain arrow's.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Launcher, type LauncherHandle } from "../Launcher";
import type { Ctx, Effect, SourceInfo } from "../items";
import type { Action, ViewSpec } from "../ui/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const source: SourceInfo = { extension: "colors", palette: "picker", title: "Picker", live: false, input: true, view: "view", count: 0, stale: false };
const actions: Action[] = [
  { id: "copy", title: "Copy", shortcut: "c" },
  { id: "apply", title: "Apply", shortcut: "enter" },
  { id: "close", title: "Cancel", hidden: true, shortcut: "escape" },
  { id: "up", title: "Lighter", shortcut: "up" },
  { id: "big-up", title: "Much lighter", shortcut: "shift+up" },
  { id: "right", title: "Warmer", shortcut: "right" },
  { id: "type:3", title: "Type 3", shortcut: "3", hidden: true },
  { id: "type:#", title: "Type #", shortcut: "#", hidden: true },
];
const tree = (typing: string | undefined, colour = "#ff8800"): ViewSpec => ({
  title: colour, keys: "actions", actions, tree: { type: "text", value: colour },
  input: typing === undefined ? undefined : { value: typing, placeholder: "Any notation", submit: "apply", cancel: "close" },
});

let root: Root, el: HTMLDivElement;
const launcher: { current: LauncherHandle | null } = { current: null };
const picks: [string, Ctx | undefined][] = [];
let colour = "#ff8800";
let typing: string | undefined;
const answer = (action?: string, ctx?: Ctx): Effect => {
  if (action?.startsWith("type:")) typing = action.slice(5);
  else if (action === "apply") { colour = String((ctx?.values as { input?: string } | undefined)?.input ?? colour); typing = undefined; }
  else if (action === "close") typing = undefined;
  else if (action === "big-up") colour = "#ffffff";
  else if (action === "up") colour = "#ffaa44";
  else if (action === "right") colour = "#ff9900";
  return { view: tree(typing, colour) };
};

beforeEach(() => {
  el = document.createElement("div");
  document.body.appendChild(el);
  root = createRoot(el);
  picks.length = 0;
  colour = "#ff8800";
  typing = undefined;
});
afterEach(() => { act(() => root.unmount()); el.remove(); });

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
const mount = async () => {
  await act(async () => {
    root.render(<Launcher ref={launcher} sources={[source]} search={async () => []} view={async () => tree(typing, colour)} onPick={(_item, _q, action, ctx) => { picks.push([action ?? "", ctx]); return answer(action, ctx); }} onHide={() => {}} />);
  });
  await flush();
  await act(() => { launcher.current!.open("colors/picker"); });
  await flush();
};
const key = (k: string, init: KeyboardEventInit = {}) => act(() => { (document.activeElement ?? window).dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init })); });
const field = () => el.querySelector<HTMLInputElement>(".pal-search__input");
const title = () => el.querySelector(".pal-search__title")?.textContent;
const typeInto = (text: string) => act(() => { const f = field()!; const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!; setter.call(f, f.value + text); f.dispatchEvent(new Event("input", { bubbles: true })); });

describe("a view's text field", () => {
  it("opens from a digit or # with that character, takes typing and the caret keys, submits on Enter with the text", async () => {
    await mount();
    expect(title()).toBe("#ff8800");
    expect(field()).toBeNull();
    await key("#", { code: "Digit3", shiftKey: true }); await flush();
    expect(picks.map(([a]) => a)).toEqual(["type:#"]);
    const f = field()!;
    expect(f.value).toBe("#");
    expect(f.placeholder).toBe("Any notation");
    expect(document.activeElement).toBe(f);
    expect(f.selectionStart).toBe(1);
    expect(el.querySelector(".pal-footer__hint")?.textContent).toContain("Apply");
    // Letters and arrows are the field's now, not actions.
    await typeInto("00c");
    await key("c"); await key("ArrowLeft"); await flush();
    expect(picks).toHaveLength(1);
    expect(f.value).toBe("#00c");
    await key("Enter"); await flush();
    expect(picks[1][0]).toBe("apply");
    expect(picks[1][1]?.values).toEqual({ input: "#00c" });
    // The reply had no input: the field closes, the title is back, the query is cleared so Escape leaves.
    expect(field()).toBeNull();
    expect(title()).toBe("#00c");
    await key("Escape"); await flush();
    expect(picks).toHaveLength(2);
    expect(el.querySelector(".pal-search__title")).toBeNull();
  });

  it("cancels with Escape through the cancel action, and keeps typed text when a tree repeats the same value", async () => {
    await mount();
    await key("3", { code: "Digit3" }); await flush();
    expect(field()!.value).toBe("3");
    await typeInto("3aa88");
    await key("Escape"); await flush();
    expect(picks.map(([a]) => a)).toEqual(["type:3", "close"]);
    expect(field()).toBeNull();
    expect(title()).toBe("#ff8800");
  });

  it("runs a shifted arrow's own action, and the plain arrow's when there is none", async () => {
    await mount();
    await key("ArrowUp", { shiftKey: true }); await flush();
    await key("ArrowRight", { shiftKey: true }); await flush();
    await key("ArrowUp"); await flush();
    expect(picks.map(([a]) => a)).toEqual(["big-up", "right", "up"]);
  });
});
