import { useEffect, useRef, type RefObject } from "react";
import { isRemote } from "../remote";

/** A remote page on a touch screen (its main pointer a finger): rows take long presses and carry an actions button, and nothing raises the keyboard unasked. Never inside the app. */
export const touchFirst = () => isRemote() && typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;

/** Whether a field may take focus on its own: with a keyboard at hand, not where it would raise a phone's. */
export const typesFirst = () => !touchFirst();

/** How long a finger rests on a row before it is a long press, and how far it may drift meanwhile. */
export const LONG_PRESS_MS = 450, LONG_PRESS_SLOP = 10;

/** The index a row's or tile's element id carries (`domId`: `<list>-<index>`). */
export const indexOfId = (id: string) => { const m = /-(\d+)$/.exec(id); return m ? Number(m[1]) : -1; };

/**
 * A long press on a `[role=option]` or `[role=gridcell]` inside `root`, by a
 * finger or a pen: `onPress` with that row's index, a short buzz, and the
 * click that ends the touch swallowed so the row is not picked as well.
 * The browser's own long-press menu is kept off the rows meanwhile.
 */
export function useLongPress(root: RefObject<HTMLElement | null>, onPress: ((index: number) => void) | undefined) {
  const press = useRef(onPress);
  press.current = onPress;
  const on = !!onPress;
  useEffect(() => {
    const el = root.current;
    if (!el || !on) return;
    let timer = 0, x = 0, y = 0, fired = false;
    const cancel = () => { clearTimeout(timer); timer = 0; };
    const rowOf = (t: EventTarget | null) => (t instanceof Element ? t.closest<HTMLElement>('[role="option"], [role="gridcell"]') : null);
    const down = (e: PointerEvent) => {
      fired = false;
      const row = rowOf(e.target);
      if (e.pointerType === "mouse" || !row) return;
      x = e.clientX; y = e.clientY;
      cancel();
      timer = window.setTimeout(() => {
        timer = 0;
        const i = indexOfId(row.id);
        if (i < 0) return;
        fired = true;
        navigator.vibrate?.(8);
        press.current?.(i);
      }, LONG_PRESS_MS);
    };
    const move = (e: PointerEvent) => { if (timer && Math.hypot(e.clientX - x, e.clientY - y) > LONG_PRESS_SLOP) cancel(); };
    const click = (e: MouseEvent) => { if (!fired) return; fired = false; e.preventDefault(); e.stopPropagation(); };
    const menu = (e: Event) => { if (rowOf(e.target)) e.preventDefault(); };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", cancel);
    el.addEventListener("pointercancel", cancel);
    el.addEventListener("scroll", cancel, true);
    document.addEventListener("click", click, true);
    el.addEventListener("contextmenu", menu);
    return () => {
      cancel();
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", cancel);
      el.removeEventListener("pointercancel", cancel);
      el.removeEventListener("scroll", cancel, true);
      document.removeEventListener("click", click, true);
      el.removeEventListener("contextmenu", menu);
    };
  }, [root, on]);
}
