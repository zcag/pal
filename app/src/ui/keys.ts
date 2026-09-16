/**
 * The keyboard grammar, in one place. `resolve` turns a keydown into a
 * command; `useKeys` binds handlers for those commands on a scope (the window,
 * or one element for overlays such as the action panel and forms, which then
 * swallow what they handle so the outer scope never sees it).
 */
import { useEffect, useRef, useState, type RefObject } from "react";
import type { Shortcut } from "./types";

export const isMac = /Mac|iPhone|iPad/.test(navigator.userAgent);

export type Command =
  | { type: "move"; dir: "up" | "down" | "left" | "right" }
  | { type: "jump"; to: "home" | "end" | "pageUp" | "pageDown" }
  | { type: "jumpTo"; index: number }
  | { type: "primary" }
  | { type: "secondary" }
  | { type: "actions" }
  | { type: "escape" }
  | { type: "back" }
  | { type: "filter"; dir: 1 | -1 }
  | { type: "detail" }
  | { type: "shortcut"; combo: Shortcut };

/**
 * Return `false` to decline: the key bubbles and keeps its native effect.
 * Return `"native"` to claim it for this scope but keep the native effect
 * (a form field keeping Tab and arrows to itself).
 */
export type Handlers = {
  [C in Command as C["type"]]?: (cmd: C) => boolean | void | "native";
};

/** Human-readable table of the grammar, for the gallery and docs. */
export const grammar: { keys: string[]; does: string }[] = [
  { keys: ["↓", "↑", "ctrl+n", "ctrl+p"], does: "Move the cursor" },
  { keys: ["enter"], does: "Run the primary action" },
  { keys: ["cmd+enter"], does: "Run the secondary action" },
  { keys: ["cmd+k"], does: "Toggle the action panel" },
  { keys: ["escape"], does: "Close action panel, else clear query, else pop a level, else hide" },
  { keys: ["cmd+backspace"], does: "Pop a level when the query is empty" },
  { keys: ["tab", "shift+tab"], does: "Cycle the filter dropdown, when there is one" },
  { keys: ["cmd+i"], does: "Toggle the detail pane" },
  { keys: ["cmd+1"], does: "Jump to row 1..9 (cmd+1 to cmd+9)" },
  { keys: ["home", "end", "pageup", "pagedown"], does: "Scroll the list" },
  { keys: ["cmd+c"], does: "Any other modifier combo runs the action carrying that shortcut" },
];

const keyName = (e: KeyboardEvent) => {
  const m = /^(?:Key|Digit)(\w)$/.exec(e.code);
  return m ? m[1].toLowerCase() : e.key.toLowerCase();
};

/** "cmd+shift+c" for the event, using the platform's primary modifier as "cmd". */
export function comboOf(e: KeyboardEvent): Shortcut {
  const cmd = isMac ? e.metaKey : e.ctrlKey;
  const ctrl = isMac ? e.ctrlKey : false;
  return [cmd && "cmd", ctrl && "ctrl", e.altKey && "alt", e.shiftKey && "shift", keyName(e)]
    .filter(Boolean)
    .join("+");
}

export function resolve(e: KeyboardEvent): Command | null {
  const cmd = isMac ? e.metaKey : e.ctrlKey;
  const k = keyName(e);
  if (e.ctrlKey && !e.metaKey && !e.altKey && (k === "n" || k === "p")) return { type: "move", dir: k === "n" ? "down" : "up" };
  if (!cmd && !e.altKey) {
    switch (e.key) {
      case "ArrowDown": return { type: "move", dir: "down" };
      case "ArrowUp": return { type: "move", dir: "up" };
      case "ArrowLeft": return { type: "move", dir: "left" };
      case "ArrowRight": return { type: "move", dir: "right" };
      case "Enter": return { type: "primary" };
      case "Escape": return { type: "escape" };
      case "Tab": return { type: "filter", dir: e.shiftKey ? -1 : 1 };
      case "Home": return { type: "jump", to: "home" };
      case "End": return { type: "jump", to: "end" };
      case "PageUp": return { type: "jump", to: "pageUp" };
      case "PageDown": return { type: "jump", to: "pageDown" };
    }
  }
  if (cmd && !e.altKey && !e.shiftKey) {
    if (k === "enter") return { type: "secondary" };
    if (k === "k") return { type: "actions" };
    if (k === "backspace") return { type: "back" };
    if (k === "i") return { type: "detail" };
    if (/^[1-9]$/.test(k)) return { type: "jumpTo", index: Number(k) - 1 };
  }
  if ((cmd || e.altKey || (isMac && e.ctrlKey)) && k.length === 1) return { type: "shortcut", combo: comboOf(e) };
  return null;
}

const isEditable = (el: EventTarget | null) =>
  el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el instanceof HTMLElement && el.isContentEditable);

/**
 * `onMouseDown` for rows, tiles, hint buttons and overlay cards: a click on
 * them must not pull focus off the search input (or an overlay's own field),
 * so the next keystroke still lands where it did before the click.
 */
export const keepFocus = (e: { target: EventTarget | null; preventDefault(): void }) => {
  if (!isEditable(e.target)) e.preventDefault();
};

/** Only cursor movement should repeat while a key is held; Enter, Escape and shortcuts fire once. */
const repeats = (cmd: Command) => cmd.type === "move" || cmd.type === "jump";

type Options = {
  /** Element to listen on; the window when absent. Element scopes swallow handled keys. */
  scope?: RefObject<HTMLElement | null>;
  /** Where typing goes when nothing editable has focus. */
  input?: RefObject<HTMLInputElement | null>;
};

export function useKeys(handlers: Handlers, { scope, input }: Options = {}) {
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => {
    const target: HTMLElement | Window = scope?.current ?? window;
    const local = target !== window;
    const onKey = (ev: Event) => {
      const e = ev as KeyboardEvent;
      // Mid-composition (Turkish dead keys, CJK) the keys belong to the IME: Enter commits, arrows pick a candidate.
      if (e.isComposing || e.keyCode === 229) return;
      const cmd = resolve(e);
      if (cmd && e.repeat && !repeats(cmd)) { e.preventDefault(); if (local) e.stopPropagation(); return; }
      const handler = cmd && ref.current[cmd.type];
      const result = handler ? handler(cmd as never) : false;
      if (result !== false) {
        if (result !== "native") e.preventDefault();
        if (local) e.stopPropagation();
        return;
      }
      const field = input?.current;
      if (!field || cmd || e.metaKey || e.ctrlKey) return;
      // Typing with nothing focused goes to the search input, unless an overlay or form (a key scope) is up: its own fields own the keys.
      const typing = e.key.length === 1 || e.key === "Backspace";
      if (typing && !isEditable(document.activeElement) && !document.querySelector("[data-keyscope]")) field.focus();
    };
    target.addEventListener("keydown", onKey);
    return () => target.removeEventListener("keydown", onKey);
  }, [scope, input]);
}

/** True while the platform's primary modifier is held (for cmd+N row hints). */
export function useCmdHeld() {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    const key = isMac ? "Meta" : "Control";
    const on = (e: KeyboardEvent) => setHeld(e.key === key ? e.type === "keydown" : isMac ? e.metaKey : e.ctrlKey);
    const off = () => setHeld(false);
    window.addEventListener("keydown", on);
    window.addEventListener("keyup", on);
    window.addEventListener("blur", off);
    return () => {
      window.removeEventListener("keydown", on);
      window.removeEventListener("keyup", on);
      window.removeEventListener("blur", off);
    };
  }, []);
  return held;
}
