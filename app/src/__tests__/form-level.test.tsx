// @vitest-environment happy-dom
// The form level: an `Effect.form` from a pick pushes it, Enter submits it
// as a pick carrying the values, a required field left empty blocks that,
// `errors` from the extension show it again, Escape pops it.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Launcher } from "../Launcher";
import type { Ctx, Effect, SourceInfo } from "../items";
import type { Item } from "../ui/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const source: SourceInfo = { extension: "quicklinks", palette: "quicklinks", title: "Quicklinks", live: false, input: false, count: 1, stale: false };
const row: Item = { id: "create", name: "Create Quicklink", palette: "quicklinks/quicklinks", source: { extension: "quicklinks", palette: "quicklinks" }, actions: [{ id: "create", title: "Create Quicklink" }] };
const form: Effect["form"] = {
  title: "Create Quicklink",
  fields: [
    { kind: "text", id: "name", label: "Name", required: true },
    { kind: "text", id: "url", label: "URL", required: true, description: "{query} stands for what you type." },
    { kind: "checkbox", id: "pin", label: "Pinned", text: "Show at the top" },
  ],
  submit: { id: "save", title: "Create" },
};

let root: Root, el: HTMLDivElement;
const picks: { id: string; action?: string; ctx?: Ctx }[] = [];
let answer: (id: string, action?: string, ctx?: Ctx) => Effect | void;

beforeEach(() => {
  el = document.createElement("div");
  document.body.appendChild(el);
  root = createRoot(el);
  picks.length = 0;
  answer = (id, action) => (id === "create" && action === "create" ? { form } : undefined);
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
  // React listens for the native value change: set through the prototype setter, then bubble input.
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
});
const openForm = async () => {
  await mount();
  await key(window, "Enter");
  await flush();
};

describe("form level", () => {
  it("renders the form in place of the list when a pick answers { form }: title, fields, submit in the footer, first field focused", async () => {
    await openForm();
    expect(picks).toEqual([{ id: "create", action: "create", ctx: undefined }]);
    expect(el.querySelector(".pal-search__title")?.textContent).toBe("Create Quicklink");
    expect(el.querySelector(".pal-search__crumb")?.textContent).toBe("Quicklinks");
    expect(el.querySelector("form.pal-form")).toBeTruthy();
    expect([...el.querySelectorAll(".pal-field")].map((f) => f.getAttribute("data-kind"))).toEqual(["text", "text", "checkbox"]);
    expect(el.querySelector(".pal-field__help")?.textContent).toBe("{query} stands for what you type.");
    expect(el.querySelector(".pal-footer__hint")?.textContent).toContain("Create");
    expect(el.querySelector('[role="listbox"]')).toBeNull();
    expect(document.activeElement).toBe(field("name"));
  });

  it("blocks the submit while a required field is empty: the field is marked and focused, no pick goes out", async () => {
    await openForm();
    await type("name", "Docs");
    await key(field("name"), "Enter");
    await flush();
    expect(picks).toHaveLength(1);
    expect(field("url").getAttribute("aria-invalid")).toBe("true");
    expect(el.querySelector(".pal-field__error")?.textContent).toBe("Required");
    expect(document.activeElement).toBe(field("url"));
    // Typing into it clears the mark.
    await type("url", "h");
    expect(field("url").getAttribute("aria-invalid")).toBeNull();
  });

  it("submits as a pick on the row with the submit id and the values in ctx, and closes the form on a plain answer", async () => {
    answer = (_id, action) => (action === "create" ? { form } : action === "save" ? { toast: { title: "Created" } } : undefined);
    await openForm();
    await type("name", "Docs");
    await type("url", "https://docs.rs/{query}");
    await act(() => { field("pin").click(); });
    await key(field("url"), "Enter");
    await flush();
    expect(picks[1]).toEqual({ id: "create", action: "save", ctx: { values: { name: "Docs", url: "https://docs.rs/{query}", pin: true } } });
    expect(el.querySelector("form.pal-form")).toBeNull();
    expect(el.querySelector(".pal-toast")?.textContent).toContain("Created");
  });

  it("shows the form again with the extension's errors when the submit answers { form } with them, keeping what was typed", async () => {
    answer = (_id, action) => (action === "create" ? { form } : action === "save" ? { form: { ...form, errors: { url: "Not a URL" } } } : undefined);
    await openForm();
    await type("name", "Docs");
    await type("url", "docs.rs");
    await key(field("url"), "Enter");
    await flush();
    expect(el.querySelector("form.pal-form")).toBeTruthy();
    expect(field("url").value).toBe("docs.rs");
    expect(el.querySelector(".pal-field__error")?.textContent).toBe("Not a URL");
    expect(field("url").getAttribute("aria-invalid")).toBe("true");
  });

  it("addresses the submit to the form's own id when it has one", async () => {
    answer = (_id, action) => (action === "create" ? { form: { ...form, id: "ql-1" } } : undefined);
    await openForm();
    await type("name", "a");
    await type("url", "b");
    await key(field("url"), "Enter");
    await flush();
    expect(picks[1]).toMatchObject({ id: "ql-1", action: "save" });
  });

  it("names the key that submits from where focus is: Enter in a field, cmd+Enter in a textarea, which Enter does not submit", async () => {
    const withBody: Effect["form"] = { ...form, fields: [form.fields[0], { kind: "textarea", id: "body", label: "Body" }] };
    answer = (_id, action) => (action === "create" ? { form: withBody } : action === "save" ? {} : undefined);
    await openForm();
    const hint = () => el.querySelector(".pal-footer__hint .pal-kbd")?.getAttribute("aria-label");
    const button = () => el.querySelector(".pal-form__buttons [data-primary] .pal-kbd")?.getAttribute("aria-label");
    expect(document.activeElement).toBe(field("name"));
    expect([hint(), button()]).toEqual(["enter", "enter"]);
    await act(() => { field("body").focus(); });
    expect([hint(), button()]).toEqual(["cmd+enter", "cmd+enter"]);
    await type("name", "Docs");
    await key(field("body"), "Enter");
    await flush();
    expect(picks).toHaveLength(1);
    await key(field("body"), "Enter", { metaKey: true, ctrlKey: true });
    await flush();
    expect(picks[1]).toMatchObject({ id: "create", action: "save" });
  });

  it("Escape pops the form without a pick; the list is back", async () => {
    await openForm();
    await key(field("name"), "Escape");
    await flush();
    expect(el.querySelector("form.pal-form")).toBeNull();
    expect(el.querySelector('[role="listbox"]')).toBeTruthy();
    expect(picks).toHaveLength(1);
  });
});
