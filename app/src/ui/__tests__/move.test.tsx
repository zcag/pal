// @vitest-environment happy-dom
// `Transition.move` (View.tsx useMove): a keyed node found at another box
// in the previous tree is played from that box to its own, across parents
// too, with the stack it left drawing no exit for it; a key new to the
// tree enters instead; the OS's reduced motion does not stop it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { View } from "../View";
import type { ViewNode } from "../types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TILE = 64;
/** A row of four cells; each cell holds one tile keyed by id, or an outline. */
const board = (ids: (number | null)[]): ViewNode => ({
  type: "stack", direction: "row", surface: "sunken",
  children: ids.map((id, i) => ({
    type: "stack", key: `cell${i}`, minHeight: TILE,
    children: [id === null
      ? { type: "tile", key: "empty", width: TILE, height: TILE, fill: "outline", transition: { exit: "none" } }
      : { type: "tile", key: `t${id}`, width: TILE, height: TILE, text: String(id), transition: { move: true, enter: "pop" } }],
  })),
});

let root: Root, el: HTMLDivElement;
const animations: { text: string; from: string; duration: number }[] = [];
let reduce = false;
beforeEach(() => {
  el = document.createElement("div");
  document.body.appendChild(el);
  root = createRoot(el);
  animations.length = 0;
  reduce = false;
  // happy-dom lays nothing out: a tile's box is its cell's index along the row, from the DOM order.
  HTMLElement.prototype.getBoundingClientRect = function () {
    const cell = this.closest(".pal-view__stack[style]");
    const cells = [...document.querySelectorAll(".pal-view__stack[style]")];
    const left = cell ? cells.indexOf(cell) * TILE : 0;
    return { left, top: 0, right: left + TILE, bottom: TILE, width: TILE, height: TILE, x: left, y: 0, toJSON: () => ({}) } as DOMRect;
  };
  HTMLElement.prototype.animate = function (frames: unknown, options: unknown) {
    const a = { cancel: vi.fn(), finished: Promise.resolve() } as unknown as Animation;
    animations.push({ text: this.textContent ?? "", from: (frames as { transform: string }[])[0].transform, duration: (options as { duration: number }).duration });
    return a;
  };
  const style = getComputedStyle;
  window.getComputedStyle = ((e: Element) => { const s = style(e); return Object.assign(Object.create(s), { getPropertyValue: (p: string) => (p === "--pal-motion-move" ? "180ms" : p === "--pal-ease" ? "ease" : s.getPropertyValue(p)) }); }) as typeof getComputedStyle;
  window.matchMedia = ((q: string) => ({ matches: reduce && q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof matchMedia;
});
afterEach(() => { act(() => root.unmount()); el.remove(); });

const show = (tree: ViewNode) => act(() => { root.render(<View tree={tree} label="board" />); });
const texts = () => [...el.querySelectorAll(".pal-view__tile")].map((t) => t.textContent);

describe("move", () => {
  it("slides a keyed node from its old box to its new one, across cells, and the cell it left draws no exit", async () => {
    await show(board([1, null, null, 2]));
    expect(texts()).toEqual(["1", "", "", "2"]);
    expect(animations).toEqual([]);
    await show(board([null, null, 1, 2]));
    // The old cell shows its outline at once (no lingering exit), the moved tile is in the new cell.
    expect(texts()).toEqual(["", "", "1", "2"]);
    expect(el.querySelectorAll("[data-exiting]")).toHaveLength(0);
    // Two cells to the right: played from 128 px left of where it now is. The tile that stayed put is not played.
    expect(animations).toEqual([{ text: "1", from: "translate(-128px, 0px)", duration: 180 }]);
    // A mover re-mounted in another cell has its entrance switched off, so it does not pop while sliding.
    expect((el.querySelectorAll(".pal-view__tile")[2] as HTMLElement).style.animation).toBe("none");
  });

  it("a key new to the tree enters (its data-enter stays), and the same tree again plays nothing", async () => {
    await show(board([1, null, null, null]));
    const next = board([1, 2, null, null]);
    await show(next);
    expect(animations).toEqual([]);
    expect(el.querySelectorAll(".pal-view__tile")[1].getAttribute("data-enter")).toBe("pop");
    await show(next);
    expect(animations).toEqual([]);
  });

  it("plays under reduced motion too", async () => {
    reduce = true;
    await show(board([1, null, null, null]));
    await show(board([null, null, null, 1]));
    expect(texts()).toEqual(["", "", "", "1"]);
    expect(animations).toEqual([{ text: "1", from: "translate(-192px, 0px)", duration: 180 }]);
  });
});
