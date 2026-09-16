// The view check (view.ts): what leaves the host as a tree is one the UI can
// draw, with action ids that cannot shadow the shell's. The form check, the
// same way, for fields.
import { describe, expect, test } from "bun:test";
import { MAX_DEPTH, MAX_NODES, checkForm, checkView } from "../../sdk/src/view.ts";
import type { Form, View, ViewNode } from "../../sdk/src/protocol.ts";

const ok: View = { tree: { type: "stack", children: [{ type: "text", value: "hi" }] }, actions: [{ id: "go", title: "Go" }] };

describe("checkView", () => {
  test("a well-formed view passes through untouched", () => expect(checkView(ok)).toBe(ok));
  test("needs a tree and an actions array", () => {
    expect(() => checkView(null)).toThrow("not an object");
    expect(() => checkView({ actions: [] })).toThrow("no tree");
    expect(() => checkView({ tree: ok.tree })).toThrow("actions must be an array");
  });
  test("the shell's action prefix is refused, so are duplicate ids", () => {
    expect(() => checkView({ ...ok, actions: [{ id: "pal:settings", title: "x" }] })).toThrow("pal: is reserved");
    expect(() => checkView({ ...ok, actions: [{ id: "a", title: "x" }, { id: "a", title: "y" }] })).toThrow("twice");
    expect(() => checkView({ ...ok, actions: [{ title: "x" }] })).toThrow("no id");
  });
  test("keys is actions or nothing", () => expect(() => checkView({ ...ok, keys: "typing" })).toThrow("keys"));
  test("an image loads icon:// or data:image/ only", () => {
    expect(() => checkView({ ...ok, tree: { type: "image", src: "https://x/y.png" } })).toThrow("image src");
    expect(() => checkView({ ...ok, tree: { type: "image", src: "file:///etc/passwd" } })).toThrow("image src");
    expect(checkView({ ...ok, tree: { type: "image", src: "icon://localhost/app?path=x" } })).toBeTruthy();
    expect(checkView({ ...ok, tree: { type: "image", src: "data:image/svg+xml,%3Csvg%3E" } })).toBeTruthy();
  });
  test("siblings keyed alike are refused; an unknown node type is not (the UI skips it)", () => {
    expect(() => checkView({ ...ok, tree: { type: "stack", children: [{ type: "text", key: "a", value: "1" }, { type: "badge", key: "a", text: "2" }] } })).toThrow('keyed "a"');
    expect(checkView({ ...ok, tree: { type: "stack", children: [{ type: "hologram" } as unknown as ViewNode] } })).toBeTruthy();
    expect(() => checkView({ ...ok, tree: { type: "stack", children: [null as unknown as ViewNode] } })).toThrow("not a node");
    expect(() => checkView({ ...ok, tree: { type: "stack" } as ViewNode })).toThrow("no children");
  });
  test("a shortcut is a key or a list of keys; a hidden action needs one", () => {
    expect(checkView({ ...ok, actions: [{ id: "up", title: "Up", shortcut: ["up", "k"] }] })).toBeTruthy();
    expect(() => checkView({ ...ok, actions: [{ id: "up", title: "Up", shortcut: [] }] })).toThrow("shortcut must be a key or a list of keys");
    expect(() => checkView({ ...ok, actions: [{ id: "up", title: "Up", shortcut: ["up", 3] }] })).toThrow("shortcut must be a key or a list of keys");
    expect(() => checkView({ ...ok, actions: [{ id: "up", title: "Up", shortcut: 7 }] })).toThrow("shortcut must be a key or a list of keys");
    expect(checkView({ ...ok, actions: [{ id: "a", title: "Type A", shortcut: "a", hidden: true }] })).toBeTruthy();
    expect(() => checkView({ ...ok, actions: [{ id: "a", title: "Type A", hidden: true }] })).toThrow("hidden and has no shortcut");
    expect(() => checkView({ ...ok, actions: [{ id: "a", title: "Type A", shortcut: "a", hidden: "yes" }] })).toThrow("hidden must be true");
  });
  test("a transition names a known entrance and exit; move wants a key that is unique in the whole tree", () => {
    const t = (transition: unknown, key?: string): View => ({ ...ok, tree: { type: "stack", children: [{ type: "text", key, value: "x", transition } as ViewNode] } });
    for (const enter of ["fade", "slide-up", "slide-down", "slide-left", "slide-right", "flip", "pop"]) expect(checkView(t({ enter }))).toBeTruthy();
    expect(() => checkView(t({ enter: "explode" }))).toThrow('unknown enter "explode"');
    expect(() => checkView(t({ exit: "explode" }))).toThrow('unknown exit "explode"');
    expect(() => checkView(t({ delay: "2" }))).toThrow("delay must be a number");
    expect(() => checkView(t("fade"))).toThrow("transition must be an object");
    expect(checkView(t({ move: true }, "a"))).toBeTruthy();
    expect(() => checkView(t({ move: true }))).toThrow("moves but has no key");
    expect(() => checkView(t({ move: "yes" }, "a"))).toThrow("move must be true");
    // The same key in two stacks is fine for a plain node, not for one that moves: the app tracks a mover by key across the tree.
    const twice = (transition?: unknown): View => ({ ...ok, tree: { type: "stack", children: [
      { type: "stack", key: "c0", children: [{ type: "text", key: "t1", value: "1", transition } as ViewNode] },
      { type: "stack", key: "c1", children: [{ type: "text", key: "t1", value: "1", transition } as ViewNode] },
    ] } });
    expect(checkView(twice())).toBeTruthy();
    expect(() => checkView(twice({ move: true }))).toThrow('key "t1" is used elsewhere in the tree');
  });
  test("a tile needs its size and known looks; a text's width and a progress colour are checked; a stack's surface too", () => {
    const one = (node: unknown): View => ({ ...ok, tree: { type: "stack", children: [node as ViewNode] } });
    expect(checkView(one({ type: "tile", width: 64, height: 64, text: "2", color: "amber", fill: "soft" }))).toBeTruthy();
    expect(checkView(one({ type: "tile", width: 32, height: 40 }))).toBeTruthy();
    expect(() => checkView(one({ type: "tile", width: 64 }))).toThrow("tile needs width and height");
    expect(() => checkView(one({ type: "tile", width: -1, height: 64 }))).toThrow("tile needs width and height");
    expect(() => checkView(one({ type: "tile", width: 64, height: 64, color: "gold" }))).toThrow('unknown color "gold"');
    expect(() => checkView(one({ type: "tile", width: 64, height: 64, fill: "striped" }))).toThrow('unknown fill "striped"');
    expect(checkView(one({ type: "text", value: "6", width: 8, minWidth: 4, align: "end" }))).toBeTruthy();
    expect(() => checkView(one({ type: "text", value: "6", width: "8px" }))).toThrow("text width must be px");
    expect(() => checkView(one({ type: "text", value: "6", minWidth: -2 }))).toThrow("text minWidth must be px");
    expect(() => checkView(one({ type: "text", value: "6", align: "justify" }))).toThrow('unknown align "justify"');
    expect(checkView(one({ type: "progress", value: 0.5, color: "grey" }))).toBeTruthy();
    expect(() => checkView(one({ type: "progress", value: 0.5, color: "accent" }))).toThrow('unknown color "accent"');
    expect(checkView(one({ type: "stack", surface: "sunken", radius: true, children: [] }))).toBeTruthy();
    expect(checkView(one({ type: "stack", surface: "elevated", children: [] }))).toBeTruthy();
    expect(() => checkView(one({ type: "stack", surface: "glass", children: [] }))).toThrow('unknown surface "glass"');
    expect(() => checkView(one({ type: "stack", radius: 10, children: [] }))).toThrow("radius must be a boolean");
  });
  test("the controls: a node's action names one of the view's actions and lets a hidden one go without a shortcut; selected is true; a hex surface and bar colour; slider, switch and an avatar's dot are checked", () => {
    const one = (node: unknown, actions = ok.actions): View => ({ ...ok, actions, tree: { type: "stack", children: [node as ViewNode] } });
    expect(checkView(one({ type: "tile", width: 40, height: 40, action: "go", selected: true }))).toBeTruthy();
    expect(() => checkView(one({ type: "tile", width: 40, height: 40, action: "nope" }))).toThrow('action "nope" is none of the view\'s actions');
    expect(() => checkView(one({ type: "tile", width: 40, height: 40, selected: false }))).toThrow("selected must be true");
    expect(checkView(one({ type: "stack", children: [], action: "tap" }, [{ id: "tap", title: "Tap", hidden: true }]))).toBeTruthy();
    expect(() => checkView(one({ type: "stack", children: [] }, [{ id: "tap", title: "Tap", hidden: true }]))).toThrow("hidden and has no shortcut");
    expect(checkView(one({ type: "stack", surface: "#ffcf78", children: [] }))).toBeTruthy();
    expect(checkView(one({ type: "stack", surface: "#ffcf7840", children: [] }))).toBeTruthy();
    expect(checkView(one({ type: "progress", value: 0.5, color: "#3967ff" }))).toBeTruthy();
    expect(checkView(one({ type: "slider", value: 0.62, width: 120, color: "amber", label: "Volume" }))).toBeTruthy();
    expect(checkView(one({ type: "slider", value: 0, color: "#fff" }))).toBeTruthy();
    expect(() => checkView(one({ type: "slider", value: 1.5 }))).toThrow("slider value must be 0..1");
    expect(() => checkView(one({ type: "slider", value: 0.5, color: "accent" }))).toThrow('slider has an unknown color "accent"');
    expect(checkView(one({ type: "switch", on: true, color: "green" }))).toBeTruthy();
    expect(() => checkView(one({ type: "switch", on: "yes" }))).toThrow("switch needs on");
    expect(() => checkView(one({ type: "switch", on: true, color: "#0f0" }))).toThrow('switch has an unknown color "#0f0"');
    expect(checkView(one({ type: "image", src: "data:image/png;base64,AA", width: 24, height: 24, mask: "circle", dot: "green" }))).toBeTruthy();
    expect(() => checkView(one({ type: "image", src: "data:image/png;base64,AA", dot: "online" }))).toThrow('unknown dot colour "online"');
  });
  test("a tile takes a hex colour of the extension's own in every length, nothing else beyond the tokens", () => {
    for (const c of ["#f80", "#f80a", "#ff8800", "#FF880080"]) expect(checkView({ ...ok, tree: { type: "tile", width: 40, height: 40, color: c } })).toBeTruthy();
    for (const c of ["#ff888", "#ff88000", "ff8800", "rgb(1 2 3)", "hotpink"]) expect(() => checkView({ ...ok, tree: { type: "tile", width: 40, height: 40, color: c } })).toThrow("unknown color");
  });
  test("a gradient needs a size, layers of two or more hex stops (alpha allowed) in a known direction, a hex fill, and a marker inside the box", () => {
    const g = (extra: Record<string, unknown>) => ({ ...ok, tree: { type: "gradient", width: 200, height: 12, layers: [{ stops: ["#f00", "#00f"] }], ...extra } as ViewNode });
    expect(checkView(g({}))).toBeTruthy();
    expect(checkView(g({ fill: "#ff8800", layers: [{ stops: ["#ffffff", "#ffffff00"] }, { stops: ["#000000", "#00000000"], direction: "up" }], marker: { x: 0.5, y: 1 } }))).toBeTruthy();
    expect(() => checkView(g({ fill: "red" }))).toThrow("fill must be a #hex");
    expect(() => checkView(g({ width: -1 }))).toThrow("width and height");
    expect(() => checkView(g({ layers: [] }))).toThrow("needs layers");
    expect(() => checkView(g({ layers: [{ stops: ["#f00"] }] }))).toThrow("at least two stops");
    expect(() => checkView(g({ layers: [{ stops: ["#f00", "red"] }] }))).toThrow("not a #hex colour");
    expect(() => checkView(g({ layers: [{ stops: ["#f00", "#00f"], direction: "sideways" }] }))).toThrow("unknown direction");
    expect(() => checkView(g({ marker: { x: 1.5, y: 0 } }))).toThrow("marker");
    expect(() => checkView(g({ marker: { x: 0 } }))).toThrow("marker");
  });
  test("a view's input names a submit (and a cancel) among its actions, with string value and placeholder", () => {
    const acts = [{ id: "apply", title: "Apply" }, { id: "close", title: "Close" }];
    expect(checkView({ ...ok, actions: acts, input: { submit: "apply" } })).toBeTruthy();
    expect(checkView({ ...ok, actions: acts, input: { submit: "apply", cancel: "close", value: "#", placeholder: "Any notation" } })).toBeTruthy();
    expect(() => checkView({ ...ok, actions: acts, input: { submit: "go" } })).toThrow("input.submit");
    expect(() => checkView({ ...ok, actions: acts, input: { submit: "apply", cancel: "pal:x" } })).toThrow("input.cancel");
    expect(() => checkView({ ...ok, actions: acts, input: { submit: "apply", value: 3 } })).toThrow("input.value");
    expect(() => checkView({ ...ok, actions: acts, input: "yes" })).toThrow("input must be an object");
  });
  test("too many nodes, or too deep, is an error naming the limit", () => {
    const wide: ViewNode = { type: "stack", children: Array.from({ length: MAX_NODES }, () => ({ type: "divider" }) as ViewNode) };
    expect(() => checkView({ ...ok, tree: wide })).toThrow(`${MAX_NODES}`);
    let deep: ViewNode = { type: "divider" };
    for (let i = 0; i <= MAX_DEPTH; i++) deep = { type: "stack", children: [deep] };
    expect(() => checkView({ ...ok, tree: deep })).toThrow(`${MAX_DEPTH}`);
  });
});

const okForm: Form = { title: "Add", fields: [{ kind: "text", id: "name", label: "Name" }, { kind: "select", id: "kind", label: "Kind", options: [] }], submit: { id: "save", title: "Save" } };

describe("checkForm", () => {
  test("a well-formed form passes through untouched", () => expect(checkForm(okForm)).toBe(okForm));
  test("needs a title, fields, and a submit id that is not the shell's", () => {
    expect(() => checkForm(null)).toThrow("not an object");
    expect(() => checkForm({ ...okForm, title: undefined })).toThrow("no title");
    expect(() => checkForm({ ...okForm, fields: [] })).toThrow("no fields");
    expect(() => checkForm({ ...okForm, submit: { title: "x" } })).toThrow("submit has no id");
    expect(() => checkForm({ ...okForm, submit: { id: "pal:settings", title: "x" } })).toThrow("pal: is reserved");
  });
  test("fields have unique ids and a kind the UI draws; a select has options", () => {
    expect(() => checkForm({ ...okForm, fields: [{ kind: "text", label: "x" }] })).toThrow("field 0 has no id");
    expect(() => checkForm({ ...okForm, fields: [{ kind: "text", id: "a", label: "x" }, { kind: "text", id: "a", label: "y" }] })).toThrow("twice");
    expect(() => checkForm({ ...okForm, fields: [{ kind: "date", id: "a", label: "x" }] })).toThrow("unknown kind");
    expect(() => checkForm({ ...okForm, fields: [{ kind: "select", id: "a", label: "x" }] })).toThrow("needs options");
  });
  test("errors are keyed by field", () => {
    expect(checkForm({ ...okForm, errors: { name: "Required" } })).toBeTruthy();
    expect(() => checkForm({ ...okForm, errors: { nope: "x" } })).toThrow("no field");
    expect(() => checkForm({ ...okForm, errors: "bad" })).toThrow("errors must be an object");
  });
});
