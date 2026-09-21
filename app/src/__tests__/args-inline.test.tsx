// @vitest-environment happy-dom
// Typed arguments (`Item.args`): while the cursor rests on a row that has
// them the search row draws a field per argument after the query; Enter
// runs the row with the values as it always runs it, a required one left
// empty marks its field and runs nothing, Tab moves into the fields and
// Escape back to the query; an action marked `args` takes them, the others
// run bare.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Launcher } from "../Launcher";
import type { Ctx, Effect, SourceInfo } from "../items";
import type { Item } from "../ui/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const source: SourceInfo = { extension: "ssh", palette: "ssh", title: "SSH", live: false, input: false, count: 2, stale: false };
const host: Item = {
  id: "marko", name: "marko", subtitle: "cagdas@marko", palette: "ssh/ssh", source: { extension: "ssh", palette: "ssh" },
  actions: [{ id: "connect", title: "Connect" }, { id: "copy", title: "Copy host", shortcut: "cmd+c" }],
  args: [{ id: "command", placeholder: "Command", default: "" }, { id: "shell", placeholder: "Shell", kind: "select", options: [{ id: "zsh", title: "zsh" }, { id: "sh", title: "sh" }] }],
};
const chat: Item = {
  id: "chat", name: "Alice", palette: "ssh/ssh", source: { extension: "ssh", palette: "ssh" },
  actions: [{ id: "open", title: "Open" }, { id: "send", title: "Send message", shortcut: "cmd+s", args: true }],
  args: [{ id: "text", placeholder: "Message", required: true }],
};

let root: Root, el: HTMLDivElement;
const picks: { id: string; action?: string; ctx?: Ctx }[] = [];
let rows: Item[] = [host, chat];
let answer: (id: string, action?: string, ctx?: Ctx) => Effect | void;

beforeEach(() => {
  el = document.createElement("div");
  document.body.appendChild(el);
  root = createRoot(el);
  picks.length = 0;
  rows = [host, chat];
  answer = () => ({ hud: "ran" });
});
afterEach(() => { act(() => root.unmount()); el.remove(); });

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const mount = async () => {
  await act(async () => {
    root.render(<Launcher sources={[source]} search={async () => rows.map((item) => ({ item }))} onPick={(item, _q, action, ctx) => { picks.push({ id: item.id, action, ctx }); return answer(item.id, action, ctx); }} onHide={() => {}} />);
  });
  await flush();
};
const key = (k: string, init: KeyboardEventInit = {}) => act(() => { (document.activeElement ?? window).dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init })); });
const field = (name: string) => el.querySelector<HTMLInputElement>(`.pal-args [name="${name}"]`)!;
const type = (name: string, value: string) => act(() => {
  const input = field(name);
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
});
const search = () => el.querySelector<HTMLInputElement>(".pal-search__input")!;

describe("typed arguments", () => {
  it("the fields follow the cursor: the row's arguments after the query, none on a row without", async () => {
    await mount();
    expect([...el.querySelectorAll(".pal-args__field")].map((f) => f.getAttribute("name"))).toEqual(["command", "shell"]);
    expect(field("command").getAttribute("placeholder")).toBe("Command");
    expect(el.querySelector('[role="listbox"]')).toBeTruthy();
    await key("ArrowDown");
    expect([...el.querySelectorAll(".pal-args__field")].map((f) => f.getAttribute("name"))).toEqual(["text"]);
  });

  it("Enter runs the row at once with the values (empty optional ones included); Tab moves into the fields, Escape back", async () => {
    await mount();
    await key("Enter");
    await flush();
    expect(picks).toEqual([{ id: "marko", action: "connect", ctx: { values: { command: "", shell: "zsh" } } }]);
    search().focus();
    await key("Tab");
    expect(document.activeElement).toBe(field("command"));
    await type("command", "uptime");
    await key("Enter");
    await flush();
    expect(picks[1]).toEqual({ id: "marko", action: "connect", ctx: { values: { command: "uptime", shell: "zsh" } } });
    await key("Escape");
    expect(document.activeElement).toBe(search());
    expect(el.querySelector('[role="listbox"]')).toBeTruthy();
  });

  it("a secondary action without `args` runs bare; one marked `args` takes them, and a required one left empty marks the field and runs nothing", async () => {
    await mount();
    await key("c", { ctrlKey: true });
    await flush();
    expect(picks).toEqual([{ id: "marko", action: "copy", ctx: undefined }]);
    await key("ArrowDown");
    await key("Enter");
    await flush();
    expect(picks[1]).toEqual({ id: "chat", action: "open", ctx: undefined });
    await key("s", { ctrlKey: true });
    await flush();
    expect(picks).toHaveLength(2);
    expect(field("text").getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(field("text"));
    await type("text", "hi");
    expect(field("text").getAttribute("aria-invalid")).toBeNull();
    await key("s", { ctrlKey: true });
    await flush();
    expect(picks[2]).toEqual({ id: "chat", action: "send", ctx: { values: { text: "hi" } } });
  });
});
