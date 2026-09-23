// @vitest-environment happy-dom
// The view's controls (View.tsx): a node carrying `action` is a button
// whose click runs that action, a hidden one included, a slider's click
// carries the fraction as `values.value` and a drag sends each new one, a switch draws its state, a hex
// surface paints the stack and picks its ink, an avatar wears its dot,
// and `selected` marks the cursor.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Launcher, type LauncherHandle } from "../Launcher";
import { View } from "../ui/View";
import type { Effect, SourceInfo } from "../items";
import type { ViewNode, ViewSpec } from "../ui/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root, el: HTMLDivElement;
beforeEach(() => { el = document.createElement("div"); document.body.appendChild(el); root = createRoot(el); });
afterEach(() => { act(() => root.unmount()); el.remove(); });
/** A primary-button pointer (or click) event at `clientX`. */
const press = (target: HTMLElement, type: string, clientX: number) => target.dispatchEvent(new (type === "click" ? MouseEvent : PointerEvent)(type, { bubbles: true, clientX, button: 0, pointerId: 1 }));
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

const tree: ViewNode = {
  type: "stack", children: [
    { type: "stack", key: "room", surface: "#ffcf78", radius: true, padding: 2, action: "toggle", selected: true, children: [{ type: "text", value: "Living room" }, { type: "text", value: "72%", style: "muted" }] },
    { type: "stack", key: "faint", surface: "#3967ff20", children: [{ type: "text", value: "off" }] },
    { type: "switch", key: "sw", on: true, color: "green", action: "toggle", label: "Power" },
    { type: "slider", key: "bri", value: 0.5, width: 200, color: "#3967ff", action: "level", label: "Brightness" },
    { type: "progress", key: "p", value: 0.25, color: "#ff0000" },
    { type: "image", key: "av", src: "data:image/png;base64,AA", width: 24, height: 24, mask: "circle", dot: "green" },
    { type: "keycap", key: "cap", keys: "cmd+enter", action: "join" },
  ],
};

describe("view controls", () => {
  it("draws the controls with their state: a hex surface with black ink, a faint one with the panel's, the switch on, the slider's thumb, the dot, the cursor ring", async () => {
    await act(async () => { root.render(<View tree={tree} />); });
    const room = el.querySelector<HTMLElement>('[data-action="toggle"].pal-view__stack')!;
    expect(room.dataset.surface).toBe("custom");
    expect(room.style.background).toBe("#ffcf78");
    expect(room.style.color).toBe("#000");
    expect(room.getAttribute("role")).toBe("button");
    expect(room.hasAttribute("data-selected")).toBe(true);
    const faint = el.querySelector<HTMLElement>(".pal-view__stack[data-surface='custom']:not([data-action])")!;
    expect(faint.style.color).toBe("");
    const sw = el.querySelector<HTMLElement>(".pal-view__switch")!;
    expect(sw.getAttribute("role")).toBe("switch");
    expect(sw.getAttribute("aria-checked")).toBe("true");
    expect(sw.dataset.color).toBe("green");
    const slider = el.querySelector<HTMLElement>(".pal-view__slider")!;
    expect(slider.getAttribute("role")).toBe("slider");
    expect(slider.getAttribute("aria-valuenow")).toBe("50");
    expect(slider.dataset.color).toBe("custom");
    expect(slider.style.getPropertyValue("--bar")).toBe("#3967ff");
    expect(slider.querySelector<HTMLElement>(".pal-view__thumb")!.style.left).toBe("50%");
    expect(el.querySelector<HTMLElement>(".pal-view__progress")!.style.getPropertyValue("--bar")).toBe("#ff0000");
    expect(el.querySelector(".pal-view__avatar .pal-view__dot")?.getAttribute("data-color")).toBe("green");
    expect(el.querySelector('[data-action="join"]')?.classList.contains("pal-kbd")).toBe(true);
  });

  it("a click runs the node's action; a slider's carries the fraction; the innermost control wins", async () => {
    const got: [string, Record<string, string> | undefined][] = [];
    await act(async () => { root.render(<View tree={tree} onAction={(id, v) => got.push([id, v])} />); });
    const room = el.querySelector<HTMLElement>('[data-action="toggle"].pal-view__stack')!;
    await act(async () => { room.querySelector<HTMLElement>(".pal-view__text")!.click(); });
    expect(got).toEqual([["toggle", undefined]]);
    const slider = el.querySelector<HTMLElement>(".pal-view__slider")!;
    slider.getBoundingClientRect = () => ({ left: 100, width: 200, top: 0, height: 6, right: 300, bottom: 6, x: 100, y: 0, toJSON: () => ({}) });
    await act(async () => { press(slider, "pointerdown", 250); press(slider, "pointerup", 250); press(slider, "click", 250); });
    expect(got[1]).toEqual(["level", { value: "0.750" }]);
    await act(async () => { el.querySelector<HTMLElement>('[data-action="join"]')!.click(); });
    expect(got[2]).toEqual(["join", undefined]);
  });

  it("a slider drags: each new value sends, past the end is the end, the thumb draws the held value without a transition", async () => {
    const got: [string, Record<string, string> | undefined][] = [];
    await act(async () => { root.render(<View tree={tree} onAction={(id, v) => got.push([id, v])} />); });
    const slider = el.querySelector<HTMLElement>(".pal-view__slider")!;
    slider.getBoundingClientRect = () => ({ left: 100, width: 200, top: 0, height: 6, right: 300, bottom: 6, x: 100, y: 0, toJSON: () => ({}) });
    await act(async () => { press(slider, "pointerdown", 150); });
    expect(slider.hasAttribute("data-drag")).toBe(true);
    await act(async () => { press(slider, "pointermove", 200); press(slider, "pointermove", 200); press(slider, "pointermove", 340); });
    expect(slider.querySelector<HTMLElement>(".pal-view__thumb")!.style.left).toBe("100%");
    await act(async () => { press(slider, "pointerup", 340); press(slider, "pointermove", 120); });
    expect(got.map(([, v]) => v!.value)).toEqual(["0.250", "0.500", "1.000"]);
    expect(slider.hasAttribute("data-drag")).toBe(false);
    expect(slider.getAttribute("aria-valuenow")).toBe("100");
  });

  it("through the Launcher a click is a pick of that action, a hidden one included, with the slider's value on the ctx", async () => {
    const source: SourceInfo = { extension: "hue", palette: "home", title: "Home", live: false, input: true, view: "view", count: 0, stale: false };
    const spec: ViewSpec = { keys: "actions", actions: [{ id: "open", title: "Open" }, { id: "toggle", title: "Toggle", hidden: true }, { id: "level", title: "Level", hidden: true }], tree };
    const picks: [string | undefined, unknown][] = [];
    const launcher: { current: LauncherHandle | null } = { current: null };
    await act(async () => {
      root.render(<Launcher ref={launcher} sources={[source]} search={async () => []} view={async () => spec} onPick={(_i, _q, action, ctx): Effect => { picks.push([action, ctx?.values]); return { view: spec }; }} onHide={() => {}} />);
    });
    await flush();
    await act(() => { launcher.current!.open("hue/home"); });
    await flush();
    await act(async () => { el.querySelector<HTMLElement>('[data-action="toggle"].pal-view__stack')!.click(); });
    await flush();
    const slider = el.querySelector<HTMLElement>(".pal-view__slider")!;
    slider.getBoundingClientRect = () => ({ left: 0, width: 100, top: 0, height: 6, right: 100, bottom: 6, x: 0, y: 0, toJSON: () => ({}) });
    await act(async () => { press(slider, "pointerdown", 25); press(slider, "pointerup", 25); press(slider, "click", 25); });
    await flush();
    expect(picks).toEqual([["toggle", undefined], ["level", { value: "0.250" }]]);
  });
});
