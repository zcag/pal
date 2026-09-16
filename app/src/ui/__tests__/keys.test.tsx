// @vitest-environment happy-dom
// The keyboard grammar (keys.ts): what `resolve` makes of Backspace and
// Delete, an action's shortcuts as a list, and how `useKeys` treats a
// held key.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { hasShortcut, resolve, shortcutsOf, useKeys, type Handlers } from "../keys";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ev = (key: string, init: KeyboardEventInit = {}) => new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });

describe("resolve", () => {
  it("routes an unmodified Backspace and Delete as bare keys, so a view can bind them like space", () => {
    expect(resolve(ev("Backspace"))).toEqual({ type: "key", key: "backspace" });
    expect(resolve(ev("Delete"))).toEqual({ type: "key", key: "delete" });
    expect(resolve(ev(" "))).toEqual({ type: "key", key: "space" });
    // The modifier combos keep their own meaning.
    expect(resolve(ev("Backspace", { ctrlKey: true }))).toEqual({ type: "back" });
    expect(resolve(ev("Backspace", { altKey: true }))).toBeNull();
  });
});

describe("shortcutsOf", () => {
  it("reads one key, a list, or none, and matches any of them", () => {
    expect(shortcutsOf({ shortcut: "h" })).toEqual(["h"]);
    expect(shortcutsOf({ shortcut: ["up", "k"] })).toEqual(["up", "k"]);
    expect(shortcutsOf({})).toEqual([]);
    expect(hasShortcut({ shortcut: ["up", "k"] }, "k")).toBe(true);
    expect(hasShortcut({ shortcut: ["up", "k"] }, "j")).toBe(false);
    expect(hasShortcut({}, "enter")).toBe(false);
  });
});

describe("useKeys and a held key", () => {
  let root: Root | undefined, el: HTMLDivElement | undefined;
  afterEach(() => { if (root) act(() => root!.unmount()); el?.remove(); });
  const mount = async (handlers: Handlers) => {
    el = document.createElement("div");
    document.body.appendChild(el);
    root = createRoot(el);
    const input = document.createElement("input");
    el.appendChild(input);
    const ref = { current: input };
    function Bound() { useKeys(handlers, { input: ref }); return null; }
    await act(() => { root!.render(<Bound />); });
    return input;
  };
  it("fires a bare-key action once while the key is held, but lets a held Backspace repeat in a field", async () => {
    const key = vi.fn(() => undefined);
    const input = await mount({ key });
    input.focus();
    // Typing in the field: the handler declines nothing here, but a repeat with the field focused is left native.
    const held = ev("Backspace", { repeat: true });
    input.dispatchEvent(held);
    expect(held.defaultPrevented).toBe(false);
    expect(key).not.toHaveBeenCalled();
    // A view level: nothing editable has focus, a held key is swallowed after the first press.
    input.blur();
    const first = ev("Backspace");
    window.dispatchEvent(first);
    expect(key).toHaveBeenCalledWith({ type: "key", key: "backspace" });
    expect(first.defaultPrevented).toBe(true);
    const again = ev("Backspace", { repeat: true });
    window.dispatchEvent(again);
    expect(key).toHaveBeenCalledTimes(1);
    expect(again.defaultPrevented).toBe(true);
  });
});
