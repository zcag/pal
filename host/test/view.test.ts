// The view check (view.ts): what leaves the host as a tree is one the UI can
// draw, with action ids that cannot shadow the shell's.
import { describe, expect, test } from "bun:test";
import { MAX_DEPTH, MAX_NODES, checkView } from "../src/view.ts";
import type { View, ViewNode } from "../src/protocol.ts";

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
  test("too many nodes, or too deep, is an error naming the limit", () => {
    const wide: ViewNode = { type: "stack", children: Array.from({ length: MAX_NODES }, () => ({ type: "divider" }) as ViewNode) };
    expect(() => checkView({ ...ok, tree: wide })).toThrow(`${MAX_NODES}`);
    let deep: ViewNode = { type: "divider" };
    for (let i = 0; i <= MAX_DEPTH; i++) deep = { type: "stack", children: [deep] };
    expect(() => checkView({ ...ok, tree: deep })).toThrow(`${MAX_DEPTH}`);
  });
});
