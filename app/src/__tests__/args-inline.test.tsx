// @vitest-environment happy-dom
// Typed arguments (`Item.args`): Enter on a row that has them turns the
// search row into a field per argument (the row as the crumb), Enter runs
// the pick with the values, a required one left empty blocks it, Escape
// backs out; a secondary action runs without them unless it says `args`.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Launcher } from "../Launcher";
import type { Ctx, Effect, SourceInfo } from "../items";
import type { Item } from "../ui/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const source: SourceInfo = { extension: "ssh", palette: "ssh", title: "SSH", live: false, input: false, count: 1, stale: false };
const row: Item = {
  id: "marko", name: "marko", subtitle: "cagdas@marko", palette: "ssh/ssh", source: { extension: "ssh", palette: "ssh" },
  actions: [{ id: "connect", title: "Connect" }, { id: "copy", title: "Copy host", shortcut: "cmd+c" }, { id: "run", title: "Run there", shortcut: "cmd+r", args: true }],
  args: [{ id: "command", placeholder: "Command", required: true }, { id: "shell", placeholder: "Shell", kind: "select", options: [{ id: "zsh", title: "zsh" }, { id: "sh", title: "sh" }] }],
};

let root: Root, el: HTMLDivElement;
const picks: { id: string; action?: string; ctx?: Ctx }[] = [];
let answer: (id: string, action?: string, ctx?: Ctx) => Effect | void;

beforeEach(() => {
  el = document.createElement("div");
  document.body.appendChild(el);
  root = createRoot(el);
  picks.length = 0;
  answer = () => ({ hud: "ran" });
});
afterEach(() => { act(() => root.unmount()); el.remove(); });

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const mount = async () => {
  await act(async () => {
    root.render(<Launcher sources={[source]} search={async () => [{ item: row }]} onPick={(item, _q, action, ctx) => { picks.push({ id: item.id, action, ctx }); return answer(item.id, action, ctx); }} onHide={() => {}} />);
  });
  await flush();
};
const key = (target: Element | Window, key: string, init: KeyboardEventInit = {}) => act(() => { target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init })); });
const field = (name: string) => el.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
const type = (name: string, value: string) => act(() => {
  const input = field(name);
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
});

describe("typed arguments", () => {
  it("Enter on the row opens the fields in the search row, the row as the crumb, the first field focused, no pick yet", async () => {
    await mount();
    await key(window, "Enter");
    await flush();
    expect(picks).toEqual([]);
    expect(el.querySelector(".pal-search--args")).toBeTruthy();
    expect(el.querySelector(".pal-search__crumb")?.textContent).toBe("marko");
    expect([...el.querySelectorAll(".pal-args__field")].map((f) => f.getAttribute("name"))).toEqual(["command", "shell"]);
    expect(field("command").getAttribute("placeholder")).toBe("Command");
    expect(document.activeElement).toBe(field("command"));
    expect(el.querySelector('[role="listbox"]')).toBeNull();
  });

  it("Enter with the fields filled picks the row's primary action with the values; a required field left empty blocks it", async () => {
    await mount();
    await key(window, "Enter");
    await flush();
    await key(field("command"), "Enter");
    await flush();
    expect(picks).toEqual([]);
    expect(field("command").getAttribute("aria-invalid")).toBe("true");
    await type("command", "uptime");
    await key(field("command"), "Enter");
    await flush();
    expect(picks).toEqual([{ id: "marko", action: "connect", ctx: { values: { command: "uptime", shell: "zsh" } } }]);
    expect(el.querySelector(".pal-search--args")).toBeNull();
  });

  it("Escape backs out to the list; a secondary action without `args` runs straight away, one with it takes the fields", async () => {
    await mount();
    await key(window, "Enter");
    await flush();
    await key(field("command"), "Escape");
    await flush();
    expect(el.querySelector(".pal-search--args")).toBeNull();
    expect(el.querySelector('[role="listbox"]')).toBeTruthy();
    await key(document.activeElement ?? window, "c", { ctrlKey: true });
    await flush();
    expect(picks).toEqual([{ id: "marko", action: "copy", ctx: undefined }]);
    await key(document.activeElement ?? window, "r", { ctrlKey: true });
    await flush();
    expect(el.querySelector(".pal-search--args")).toBeTruthy();
    await type("command", "ls");
    await key(field("command"), "Enter");
    await flush();
    expect(picks[1]).toEqual({ id: "marko", action: "run", ctx: { values: { command: "ls", shell: "zsh" } } });
  });
});
