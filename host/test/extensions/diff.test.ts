// diff: the pure half first (diff.ts: the line list with both numberings,
// the word spans and the whitespace mark on a paired change, the folds
// with their context and expansion, the side-by-side pairing, the unified
// text; view.ts: a tree the host accepts, the tints, the node budget on a
// huge diff, the empty view), then the palette over the wire: the two
// newest copies from the fixtures, the toggles as new trees, the copies,
// the files form and its errors, the external tool against a stand-in
// `code`, the links, the pick palette, and the Diff actions the Clipboard
// History palette gained.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compute, CONTEXT, fold, sideBySide, summary, unified, wordSpans, type Line } from "../../../extensions/diff/diff.ts";
import { customArgv } from "../../../extensions/diff/index.ts";
import { actions, NODE_BUDGET, render, renderEmpty, size, TINT } from "../../../extensions/diff/view.ts";
import { tile } from "../../../sdk/src/icon.ts";
import type { Effect, View, ViewNode } from "../../../sdk/src/protocol.ts";
import { checkView, MAX_NODES } from "../../../sdk/src/view.ts";
import { fixtures, Host, stored } from "../harness.ts";

const A = ["import x from 'y';", "", "function hello(name) {", "  return 'Hello, ' + name;", "}", ...Array.from({ length: 20 }, (_, i) => `line ${i}`), "const a = 1;", "const b = 2;", "end"].join("\n");
const B = ["import x from 'y';", "", "function hello(name, greeting) {", "  return greeting + ', ' + name;", "}", ...Array.from({ length: 20 }, (_, i) => `line ${i}`), "const a = 1;", "const  b = 2;", "end", "one more"].join("\n");

const texts = (n: ViewNode): string[] => (n.type === "text" ? [n.value] : n.type === "badge" ? [`[${n.text}]`] : n.type === "keycap" ? [`<${n.keys}>`] : n.type === "stack" ? n.children.flatMap(texts) : []);
const surfaces = (n: ViewNode): string[] => (n.type === "stack" ? [...(typeof n.surface === "string" ? [n.surface] : []), ...n.children.flatMap(surfaces)] : []);
const find = (n: ViewNode, pred: (n: ViewNode) => boolean): ViewNode[] => [...(pred(n) ? [n] : []), ...(n.type === "stack" ? n.children.flatMap((c) => find(c, pred)) : [])];
const state = (over: Partial<Parameters<typeof render>[0]> = {}) => ({ id: "diff:1", left: { text: A, label: "before", sub: "copied 3 min ago from Chrome" }, right: { text: B, label: "after", sub: "copied just now from kitty" }, side: false, ws: false, expanded: [], cursor: -1, tool: "VS Code", ...over });

describe("diff.ts", () => {
  test("compute: every line once with its numbers on each side, the counts, the summary", () => {
    const r = compute(A, B);
    expect([r.added, r.removed, r.identical, r.wsOnly]).toEqual([5, 4, false, false]);
    expect(summary(r)).toBe("+5 −4");
    const changed = r.lines.filter((l) => l.kind !== "same").map((l) => [l.kind, l.l, l.r, l.text]);
    expect(changed).toEqual([
      ["del", 3, undefined, "function hello(name) {"],
      ["del", 4, undefined, "  return 'Hello, ' + name;"],
      ["add", undefined, 3, "function hello(name, greeting) {"],
      ["add", undefined, 4, "  return greeting + ', ' + name;"],
      ["del", 27, undefined, "const b = 2;"],
      ["del", 28, undefined, "end"],
      ["add", undefined, 27, "const  b = 2;"],
      ["add", undefined, 28, "end"],
      ["add", undefined, 29, "one more"],
    ]);
    expect(r.lines[0]).toEqual({ kind: "same", text: "import x from 'y';", l: 1, r: 1 });
    expect(r.lines.at(-1)).toEqual({ kind: "add", text: "one more", r: 29 });
    expect(compute("same\ntext", "same\ntext")).toMatchObject({ added: 0, removed: 0, identical: true, wsOnly: false });
    expect(summary(compute("x", "x"))).toBe("no differences");
    expect(compute("", "a")).toMatchObject({ added: 1, removed: 0 });
  });

  test("a removed line paired with the added one after it gets word spans when they share enough, and a whitespace mark when only whitespace differs", () => {
    const r = compute(A, B);
    const spans = (l: Line) => l.spans!.map((s) => (s.changed ? `[${s.text}]` : s.text)).join("");
    expect(spans(r.lines.find((l) => l.kind === "del" && l.l === 3)!)).toBe("function hello(name) {");
    expect(spans(r.lines.find((l) => l.kind === "add" && l.r === 3)!)).toBe("function hello(name[, greeting]) {");
    expect(spans(r.lines.find((l) => l.kind === "add" && l.r === 4)!)).toBe("  return [greeting + ]', ' + name;");
    const ws = r.lines.filter((l) => l.ws);
    expect(ws.map((l) => l.text)).toEqual(["const b = 2;", "end", "const  b = 2;", "end"]);
    expect(wordSpans("alpha beta gamma", "alpha delta gamma")!.add.map((s) => [s.text, s.changed])).toEqual([["alpha ", false], ["delta", true], [" gamma", false]]);
    expect(wordSpans("completely different text here", "nothing alike at all whatsoever")).toBeUndefined();
    const only = compute("a b\nc", "a  b\nc");
    expect(only).toMatchObject({ wsOnly: true, added: 1, removed: 1 });
    expect(summary(only)).toBe("+1 −1, whitespace only");
    // -w: whitespace anywhere in the line, the newline at the end included.
    expect(compute("a b\nc", "a  b\nc", { ignoreWhitespace: true }).identical).toBe(true);
    expect(compute("  a\nc", "a  \nc\n", { ignoreWhitespace: true }).identical).toBe(true);
    expect(compute("ab\nc", "a b\nc", { ignoreWhitespace: true }).identical).toBe(true);
    expect(compute("ab\nc", "a c\nc", { ignoreWhitespace: true }).identical).toBe(false);
  });

  test("fold: a long unchanged run keeps CONTEXT lines each side and folds the middle; none before a change at the top or after one at the bottom; a short run stays; an expanded fold is written out", () => {
    const r = compute(A, B);
    const blocks = fold(r.lines);
    const kinds = blocks.map((b) => (b.kind === "fold" ? `fold#${b.index}:${b.count}` : b.kind[0]));
    expect(kinds.join(" ")).toBe("s s d d a a s s s fold#0:16 s s s d d a a a");
    expect(blocks.filter((b) => b.kind === "same").length).toBe(2 * CONTEXT + 2);
    expect(fold(r.lines, [0]).every((b) => b.kind !== "fold")).toBe(true);
    expect(fold(r.lines, [0]).length).toBe(r.lines.length);
    // The top: no context before the first change, so the run folds up to it; the bottom likewise.
    const top = fold(compute("x\n" + Array.from({ length: 10 }, (_, i) => `k${i}`).join("\n"), "y\n" + Array.from({ length: 10 }, (_, i) => `k${i}`).join("\n")).lines);
    expect(top.map((b) => b.kind)).toEqual(["del", "add", "same", "same", "same", "fold"]);
    expect((top[5] as { count: number }).count).toBe(7);
    const short = fold(compute("a\nb\nc\nd\ne\nX", "a\nb\nc\nd\ne\nY").lines);
    expect(short.some((b) => b.kind === "fold")).toBe(false);
    expect(fold(compute("a\nb\nc\nd\ne\nf\nX", "a\nb\nc\nd\ne\nf\nY").lines)[0]).toEqual({ kind: "fold", index: 0, from: 0, count: 3 });
    expect(fold(compute("same", "same").lines)).toEqual([{ kind: "same", text: "same", l: 1, r: 1 }]);
  });

  test("sideBySide: unchanged lines on both sides, a removed run beside the added run after it, an empty cell for the odd one out, the fold across", () => {
    const rows = sideBySide(fold(compute(A, B).lines));
    const shape = rows.map((r) => (r.kind === "fold" ? "FOLD" : `${r.left?.text ?? "∅"} | ${r.right?.text ?? "∅"}`));
    expect(shape.slice(0, 5)).toEqual(["import x from 'y'; | import x from 'y';", " | ", "function hello(name) { | function hello(name, greeting) {", "  return 'Hello, ' + name; |   return greeting + ', ' + name;", "} | }"]);
    expect(shape[7]).toBe("FOLD");
    expect(shape.at(-1)).toBe("∅ | one more");
  });

  test("unified: the text as diff -u writes it, no index line, the context; ignoreWhitespace carried", () => {
    const u = unified("a\nb\nc\n", "a\nB\nc\n", "before", "after");
    expect(u).toBe("--- before\n+++ after\n@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n");
    expect(unified("x\n", "x \n", "l", "r", { ignoreWhitespace: true })).toBe("--- l\n+++ r\n");
    expect(unified("a b\n", "a  b\n", "l", "r", { ignoreWhitespace: true })).toBe("--- l\n+++ r\n");
    expect(unified(A, B, "l", "r")).toContain("\\ No newline at end of file");
  });
});

describe("view.ts", () => {
  test("render: a tree the host accepts, the header with both sides and the badges, the keycap line, the changed lines on tinted blocks with signs and numbers", () => {
    const v = checkView(render(state()));
    expect(v).toMatchObject({ id: "diff:1", title: "Diff · +5 −4", keys: "actions" });
    const t = texts(v.tree);
    expect(t.slice(0, 8)).toEqual(["−", "before", "28 lines · copied 3 min ago from Chrome", "[+5]", "[−4]", "+", "after", "29 lines · copied just now from kitty"]);
    expect(t).toContain("<s>");
    expect(t).toContain("side by side");
    expect(t).toContain("VS Code");
    expect(surfaces(v.tree)).toEqual(expect.arrayContaining(["sunken", TINT.del, TINT.add, TINT.addWord]));
    // The first removed line: both gutters, the sign, then the text.
    const del = find(v.tree, (n) => n.type === "stack" && n.surface === TINT.del)[0];
    expect(texts(del).slice(0, 4)).toEqual(["3", "", "−", "function hello(name) {"]);
    expect(t).toContain("16 unchanged lines");
    expect(t).toContain("[whitespace]");
    expect(v.actions.map((a) => a.id)).toEqual(["copy", "open", "side", "ws", "swap", "copy-left", "copy-right", "expand", "next", "prev", "expand-all", "expand:0", "newest", "selection", "history", "files"]);
    expect(v.actions[1].title).toBe("Open in VS Code");
    expect(v.actions.find((a) => a.id === "expand:0")).toEqual({ id: "expand:0", title: "Expand fold 1", hidden: true });
    expect(find(v.tree, (n) => n.action === "expand:0").length).toBe(1);
  });

  test("the cursor on a fold draws the ring and the space hint; an expanded fold is gone with its action; ignore whitespace and side by side change the titles and the badges", () => {
    const on = checkView(render(state({ cursor: 0 })));
    const fold = find(on.tree, (n) => n.action === "expand:0")[0];
    expect(fold.selected).toBe(true);
    expect(texts(fold)).toEqual(["⋯", "16 unchanged lines", "<space>", "expand"]);
    const opened = checkView(render(state({ expanded: [0] })));
    expect(texts(opened.tree)).not.toContain("16 unchanged lines");
    expect(opened.actions.some((a) => a.id === "expand:0")).toBe(false);
    expect(opened.actions.some((a) => a.id === "expand")).toBe(true);
    const ws = checkView(render(state({ ws: true })));
    expect(texts(ws.tree)).toContain("[whitespace ignored]");
    expect(ws.actions.find((a) => a.id === "ws")!.title).toBe("Mind whitespace");
    expect(ws.title).toBe("Diff · +3 −2");
    expect(texts(ws.tree).at(-1)).not.toBe("The two texts differ in whitespace at most");
    expect(texts(checkView(render(state({ ws: true, left: { text: "a b", label: "a" }, right: { text: "a  b", label: "b" } }))).tree).at(-1)).toBe("The two texts differ in whitespace at most");
    const side = checkView(render(state({ side: true })));
    expect(side.actions.find((a) => a.id === "side")!.title).toBe("Unified");
    expect(find(side.tree, (n) => n.type === "divider").length).toBeGreaterThan(10);
    expect(texts(side.tree)).toContain("16 unchanged lines");
    expect(texts(side.tree)).toContain("one more");
  });

  test("identical texts: the green badge and the line; the empty view: the reason and the source keys, Enter is the newest copies", () => {
    const same = checkView(render(state({ left: { text: "x\ny", label: "a" }, right: { text: "x\ny", label: "b" } })));
    expect(same.title).toBe("Diff · no differences");
    expect(texts(same.tree)).toContain("[no differences]");
    expect(texts(same.tree).at(-1)).toBe("The two texts are the same");
    expect(same.actions.some((a) => a.id === "expand")).toBe(false);
    const e = checkView(renderEmpty({ id: "diff:2", title: "Diff", reason: "Nothing copied yet" }));
    expect(texts(e.tree)).toContain("Nothing copied yet");
    expect(e.actions[0]).toEqual({ id: "newest", title: "Diff the two newest copies", shortcut: "n" });
    expect(actions({ side: false, ws: false, folds: 0 }, [])[1].title).toBe("Open in external tool");
  });

  test("a huge diff stays under the host's node cap in both layouts and says how many lines it left out", () => {
    const big1 = Array.from({ length: 3000 }, (_, i) => `row ${i} ${i % 7 === 0 ? "x" : "y"}`).join("\n");
    const big2 = Array.from({ length: 3000 }, (_, i) => `row ${i} ${i % 5 === 0 ? "x" : "y"}`).join("\n");
    for (const side of [false, true]) {
      const v = checkView(render(state({ left: { text: big1, label: "a" }, right: { text: big2, label: "b" }, side })));
      expect(size(v.tree)).toBeLessThanOrEqual(MAX_NODES);
      expect(size(v.tree)).toBeGreaterThan(NODE_BUDGET - 100);
      const cut = texts(v.tree).find((t) => t.startsWith("… "));
      expect(cut).toMatch(/^… \d+ more lines: Copy unified diff has them all$/);
    }
  });

  test("customArgv fills {left} and {right} and keeps a quoted argument whole", () => {
    expect(customArgv('nvim -d {left} {right}', "/a b", "/c")).toEqual(["nvim", "-d", "/a b", "/c"]);
    expect(customArgv('"My Tool" --files={left},{right}', "/l", "/r")).toEqual(["My Tool", "--files=/l,/r"]);
  });
});

// ---- the palettes over the wire ---------------------------------------------------

const dir = mkdtempSync(join(tmpdir(), "pal-diff-"));
const bin = join(dir, "bin"), cache = join(dir, "cache"), argvLog = join(dir, "argv.log");
mkdirSync(bin);
/** A stand-in `code` on PAL_DIFF_PATH that logs its argv. */
writeFileSync(join(bin, "code"), `#!/bin/sh\nprintf '%s\\n' "$*" >> "${argvLog}"\n`);
chmodSync(join(bin, "code"), 0o755);
const before = join(dir, "before.txt"), after = join(dir, "after.txt");
writeFileSync(before, A);
writeFileSync(after, B);

let host: Host;
let selectionText: string | null = null;
beforeAll(async () => {
  // The fixtures were copied on 2025-09-16; a pinned clock keeps their age at two weeks.
  process.env.PAL_NOW = "2025-09-30T10:00:00";
  process.env.PAL_DIFF_PATH = bin;
  process.env.PAL_DIFF_CACHE = cache;
  stored.clear();
  host = await Host.bundled({ core: { "selection.text": () => selectionText, "windows.focused": () => fixtures.windows[0] } });
});
afterAll(() => {
  host.kill();
  delete process.env.PAL_NOW;
  delete process.env.PAL_DIFF_PATH;
  delete process.env.PAL_DIFF_CACHE;
  rmSync(dir, { recursive: true, force: true });
});

const view = (args?: unknown) => host.request<View>("view", { extension: "diff", palette: "diff", ...(args !== undefined && { args }) }).then((v) => checkView(v));
const pick = (id: string, action?: string, ctx?: Parameters<Host["pick"]>[4]) => host.pick("diff", "diff", id, action, ctx);
const viewOf = (e: Effect) => checkView(e.view!);
const link = (route: string, params: Record<string, unknown> = {}) => host.request<Effect>("link", { extension: "diff", route, params });

describe("diff over the wire", () => {
  test("meta: a view palette on the orange tile, the pick palette input and multi, five links, no warnings", () => {
    const l = host.loaded().find((l) => l.extension === "diff")!;
    expect(l.warnings).toEqual([]);
    expect(l.palettes[0]).toMatchObject({ name: "diff", title: "Diff", view: "view", input: true, icon: tile("orange", "\u{f08aa}"), keywords: ["diffy", "compare"] });
    expect(l.palettes[1]).toMatchObject({ name: "pick", title: "Diff from History", input: true, multi: true });
    expect(Object.keys(l.manifest.links!)).toEqual(["clipboard", "selection", "files", "text", "history"]);
  });

  test("opened bare: the two newest text copies, the older on the left, named by their name or first line with when and where they were copied", async () => {
    const v = await view();
    expect(v.id).toMatch(/^diff:\d+$/);
    const t = texts(v.tree);
    expect(t.slice(0, 3)).toEqual(["−", "Deploy notes", "3 lines · copied 2 w ago from kitty"]);
    expect(t.slice(5, 8)).toEqual(["+", "“hello world”", "1 line · copied 2 w ago from Chrome"]);
    expect(v.title).toBe("Diff · +1 −3");
  });

  test("the keys: side by side, whitespace, swap and the folds answer new trees of the same level; the copies answer the texts and the unified diff", async () => {
    const opened = viewOf(await link("text", { left: A, right: B, left_label: "v1", right_label: "v2" }).then((e) => host.request<View>("view", { extension: "diff", palette: "diff", args: (e.push as { args: unknown }).args })).then((v) => ({ view: v })));
    const id = opened.id!;
    expect(texts(opened.tree).slice(0, 2)).toEqual(["−", "v1"]);
    expect(viewOf(await pick(id, "side")).actions.find((a) => a.id === "side")!.title).toBe("Unified");
    expect(viewOf(await pick(id, "side")).actions.find((a) => a.id === "side")!.title).toBe("Side by side");
    expect(viewOf(await pick(id, "ws")).title).toBe("Diff · +3 −2");
    expect(viewOf(await pick(id, "ws")).title).toBe("Diff · +5 −4");
    const swapped = viewOf(await pick(id, "swap"));
    expect(swapped.title).toBe("Diff · +4 −5");
    expect(texts(swapped.tree).slice(0, 2)).toEqual(["−", "v2"]);
    viewOf(await pick(id, "swap"));
    // The fold cursor: tab lands on the first fold, space opens it, a click's action opens one by index, a expands all.
    const cursor = viewOf(await pick(id, "next"));
    expect(find(cursor.tree, (n) => n.action === "expand:0")[0].selected).toBe(true);
    expect(texts(viewOf(await pick(id, "expand")).tree)).not.toContain("16 unchanged lines");
    expect(await pick(id, "copy-left")).toEqual({ copy: A, hud: "Copied left text" });
    expect(await pick(id, "copy-right")).toEqual({ copy: B, hud: "Copied right text" });
    const copied = await pick(id, "copy");
    expect(copied.hud).toBe("Copied unified diff, +5 −4");
    expect(copied.copy).toMatch(/^--- v1\n\+\+\+ v2\n@@ /);
    expect(await pick("diff:999", "side")).toMatchObject({ keep: true, toast: { title: "This diff is gone" } });
  });

  test("the sources from the view: n is the newest copies again in place, e the clipboard against the selection (the empty view when nothing is selected), h pushes the pick palette, f the files form", async () => {
    const v = await view();
    const id = v.id!;
    expect(texts(viewOf(await pick(id, "newest")).tree)[1]).toBe("Deploy notes");
    selectionText = null;
    const empty = viewOf(await pick(id, "selection"));
    expect(empty.id).toBe(id);
    expect(texts(empty.tree)).toContain("Nothing is selected in the app in front: select a text, then open Diff");
    expect(await pick(id, "copy")).toMatchObject({ keep: true, toast: { title: "Nothing to copy" } });
    selectionText = "hello there";
    const sel = viewOf(await pick(id, "selection"));
    const t = texts(sel.tree);
    expect(t.slice(0, 3)).toEqual(["−", "Newest copy: “hello world”", "1 line · copied 2 w ago from Chrome"]);
    expect(t.slice(5, 8)).toEqual(["+", "Selection", "1 line · in kitty"]);
    expect(sel.title).toBe("Diff · +1 −1");
    expect(await pick(id, "history")).toEqual({ push: { extension: "diff", palette: "pick" } });
    const form = (await pick(id, "files")).form!;
    expect(form.fields.map((f) => f.id)).toEqual(["left", "right"]);
    expect(form.submit).toEqual({ id: "files-submit", title: "Diff" });
  });

  test("two files: the submit checks each side and puts the message under its field; a good pair pushes a level named after the files; a folder and a binary are refused", async () => {
    const id = (await view()).id!;
    let e = await pick(id, "files-submit", { values: { left: before, right: join(dir, "nope.txt") } });
    expect(e.form!.errors).toEqual({ right: `${join(dir, "nope.txt")} does not exist` });
    expect(e.form!.fields[0]).toMatchObject({ default: before });
    e = await pick(id, "files-submit", { values: { left: dir, right: after } });
    expect(e.form!.errors).toEqual({ left: `${dir} is a folder` });
    writeFileSync(join(dir, "bin.dat"), Buffer.from([0x89, 0x50, 0x00, 0x01]));
    e = await pick(id, "files-submit", { values: { left: before, right: join(dir, "bin.dat") } });
    expect(e.form!.errors).toEqual({ right: `${join(dir, "bin.dat")} is not a text file` });
    e = await pick(id, "files-submit", { values: { left: before, right: after } });
    expect(e.push).toEqual({ extension: "diff", palette: "diff", args: { left: { kind: "file", path: before }, right: { kind: "file", path: after } }, title: "before.txt → after.txt" });
    const v = await view(e.push!.args);
    expect(texts(v.tree).slice(0, 3)).toEqual(["−", "before.txt", `28 lines · ${dir}`]);
    expect(v.title).toBe("Diff · +5 −4");
  });

  test("o opens both sides in the tool: a file source as itself, a text written under the cache; no tool is a toast; a custom command takes {left} and {right}", async () => {
    const files = await view({ left: { kind: "file", path: before }, right: { kind: "text", text: "x", label: "Pasted: draft" } });
    expect(files.actions[1].title).toBe("Open in VS Code");
    expect(await pick(files.id!, "open")).toEqual({ hud: "Opened in VS Code" });
    await host.until(() => existsSync(argvLog), 2000, "the stand-in ran");
    const [argv] = readFileSync(argvLog, "utf8").trim().split("\n");
    const right = join(cache, "right-draft.txt");
    expect(argv).toBe(`--diff ${before} ${right}`);
    expect(readFileSync(right, "utf8")).toBe("x");
    host.changeSettings("diff", { settings: { tool: "meld" } });
    expect(await pick(files.id!, "open")).toMatchObject({ keep: true, toast: { title: "No diff tool found" } });
    host.changeSettings("diff", { settings: { tool: "custom", tool_command: `${join(bin, "code")} --wait {left} {right}` } });
    const v = await view();
    expect(v.actions[1].title).toBe("Open in code");
    expect(await pick(v.id!, "open")).toEqual({ hud: "Opened in code" });
    await host.until(() => readFileSync(argvLog, "utf8").trim().split("\n").length === 2, 2000, "the custom command ran");
    expect(readFileSync(argvLog, "utf8").trim().split("\n")[1]).toBe(`--wait ${join(cache, "left-Deploy-notes.txt")} ${join(cache, "right-hello-world.txt")}`);
    host.changeSettings("diff", { settings: {} });
  });

  test("the links push the view with their sources; a missing file param is refused by the host", async () => {
    expect(await link("clipboard")).toEqual({ push: { extension: "diff", palette: "diff", args: { left: { kind: "newest", index: 1 }, right: { kind: "newest", index: 0 } } } });
    expect(await link("selection")).toEqual({ push: { extension: "diff", palette: "diff", args: { left: { kind: "clipboard" }, right: { kind: "selection" } } } });
    expect(await link("files", { left: "~/a", right: "/b" })).toEqual({ push: { extension: "diff", palette: "diff", args: { left: { kind: "file", path: "~/a" }, right: { kind: "file", path: "/b" } }, title: "a → b" } });
    expect(await link("history", { left: 2, right: 1 })).toEqual({ push: { extension: "diff", palette: "diff", args: { left: { kind: "entry", id: 2 }, right: { kind: "entry", id: 1 } } } });
    await expect(link("files", { left: "/a" })).rejects.toThrow("diff/files: right is required");
    // A history pair that is not text answers the empty view with the reason.
    const v = await view({ left: { kind: "entry", id: 3 }, right: { kind: "entry", id: 1 } });
    expect(texts(v.tree)).toContain("History entry 3 is an image, not text");
  });

  test("the pick palette: the text entries with a hint on top; Enter on one pushes the palette again with it on the left, then Enter on another opens the diff; two marked go straight there, three are refused", async () => {
    const rows = await host.list("diff", "pick", "");
    expect(rows.map((r) => r.id)).toEqual(["hint:how", "1", "2", "5"]);
    expect(rows[1]).toMatchObject({ name: "“hello world”", subtitle: "1 lines · hello world" });
    expect(rows[1].actions!.map((a) => a.id)).toEqual(["left", "both"]);
    expect(await host.list("diff", "pick", "zzz")).toMatchObject([{ id: "hint:empty", name: "No text entry matches" }]);
    expect(await host.pick("diff", "pick", "2", "left")).toEqual({ push: { extension: "diff", palette: "pick", args: { left: 2 }, title: "Diff Deploy notes with…" } });
    const second = await host.list("diff", "pick", "", { args: { left: 2 } });
    expect(second.map((r) => r.id)).toEqual(["hint:left", "1", "5"]);
    expect(second[0].name).toBe("Left: Deploy notes");
    expect(second[1].actions![0].title).toBe("Diff Deploy notes with this");
    expect(await host.pick("diff", "pick", "1", "right", { args: { left: 2 } })).toEqual({ push: { extension: "diff", palette: "diff", args: { left: { kind: "entry", id: 2 }, right: { kind: "entry", id: 1 } } } });
    expect(await host.pick("diff", "pick", "5", "both", { ids: ["5", "1"] })).toEqual({ push: { extension: "diff", palette: "diff", args: { left: { kind: "entry", id: 5 }, right: { kind: "entry", id: 1 } } } });
    expect(await host.pick("diff", "pick", "5", "both", { ids: ["5", "1", "2"] })).toMatchObject({ keep: true, toast: { title: "Mark two entries", message: "3 marked" } });
  });

  test("Clipboard History: a text entry has Diff with… and, marked, Diff these two; both land in the diff palettes", async () => {
    const rows = await host.list("clipboard", "history", "");
    const text = rows.find((r) => r.id === "1")!, image = rows.find((r) => r.id === "3")!;
    expect(text.actions!.filter((a) => a.id.startsWith("diff"))).toEqual([{ id: "diff", title: "Diff with…", shortcut: "cmd+shift+f" }, { id: "diff-two", title: "Diff these two", shortcut: "cmd+shift+f", multi: true }]);
    expect(image.actions!.some((a) => a.id.startsWith("diff"))).toBe(false);
    expect(await host.pick("clipboard", "history", "1", "diff")).toEqual({ push: { extension: "diff", palette: "pick", args: { left: 1 }, title: "Diff hello world with…" } });
    expect(await host.pick("clipboard", "history", "2", "diff-two", { ids: ["2", "1"] })).toEqual({ push: { extension: "diff", palette: "diff", args: { left: { kind: "entry", id: 2 }, right: { kind: "entry", id: 1 } } } });
    expect(await host.pick("clipboard", "history", "2", "diff-two", { ids: ["2"] })).toMatchObject({ keep: true, toast: { title: "Mark two text entries" } });
  });
});
