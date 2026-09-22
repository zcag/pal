// space: the pure halves first (layout.ts: the squarified strips add up
// and stay near square, the flex grouping, the spatial neighbour;
// scan.ts: kinds, the walk on a temp tree with a hard link, a symlink and
// a folder of many files, the pack/unpack round trip under a byte cap;
// render.ts: the map's tree passes checkView, the focus ring, the marks,
// the crumbs, the actions), then the extension over the wire: the roots
// palette, the map of a temp root scanned live (the pushes), zooming,
// marking and trashing with a stand-in trash, the persisted tree, the
// lists, the links.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, linkSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { group, neighbour, squarify, worst, type Rect } from "../../../extensions/space/layout.ts";
import { BOARD_H, BOARD_W, MAX_BOXES, MAX_ROWS, actions, children, move, render, rects, type MapState } from "../../../extensions/space/render.ts";
import { fileRow, folderRow, suggestionRow } from "../../../extensions/space/rows.ts";
import { FILES_PER_DIR, KINDS, chain, detach, dominant, find, kindOf, largestDirs, largestFiles, pack, packWithin, pathOf, pct, rootNode, unpack, walk, type Node } from "../../../extensions/space/scan.ts";
import { tile } from "../../../sdk/src/icon.ts";
import type { View, ViewNode } from "../../../sdk/src/protocol.ts";
import { checkView } from "../../../sdk/src/view.ts";
import { Host, stored } from "../harness.ts";

const MAC = process.platform === "darwin";
const MB = 1024 ** 2;

// ---- layout.ts ----------------------------------------------------------------

const areaOf = (r: Rect) => r.w * r.h;
const aspect = (r: Rect) => Math.max(r.w / r.h, r.h / r.w);

describe("layout.ts", () => {
  test("worst aspect ratio of a strip", () => {
    expect(worst([6, 6, 4], 4)).toBeCloseTo(4, 5);
    expect(worst([6], 4)).toBeCloseTo(8 / 3, 5);
    expect(worst([], 4)).toBe(Infinity);
  });

  test("the paper's example: 6 6 4 3 2 2 1 in a 6 by 4 lays as the squarified strips, every rectangle's area its share, nothing outside the box", () => {
    const items = [6, 6, 4, 3, 2, 2, 1];
    const strips = squarify(items, (a) => a, { x: 0, y: 0, w: 6, h: 4 });
    const boxes = strips.flatMap((s) => s.boxes);
    expect(boxes.map((b) => b.item)).toEqual(items);
    boxes.forEach((b) => expect(areaOf(b.rect)).toBeCloseTo(b.item, 6));
    expect(boxes.reduce((t, b) => t + areaOf(b.rect), 0)).toBeCloseTo(24, 6);
    for (const b of boxes) { expect(b.rect.x).toBeGreaterThanOrEqual(-1e-9); expect(b.rect.y).toBeGreaterThanOrEqual(-1e-9); expect(b.rect.x + b.rect.w).toBeLessThanOrEqual(6 + 1e-9); expect(b.rect.y + b.rect.h).toBeLessThanOrEqual(4 + 1e-9); }
    // The first strip is the two 6s down the left (a wider box takes a vertical strip), each 3 by 2.
    expect(strips[0].vertical).toBe(true);
    expect(strips[0].boxes.map((b) => [b.rect.w, b.rect.h])).toEqual([[3, 2], [3, 2]]);
    // Every box stays near square (the slice-and-dice layout of the same data has a 1 by 6 sliver).
    expect(Math.max(...boxes.map((b) => aspect(b.rect)))).toBeLessThanOrEqual(3);
  });

  test("zero and negative areas are dropped, an empty box lays nothing, one item fills the box", () => {
    expect(squarify([0, -1], (a) => a, { x: 0, y: 0, w: 10, h: 10 })).toEqual([]);
    expect(squarify([5], (a) => a, { x: 0, y: 0, w: 10, h: 0 })).toEqual([]);
    const [s] = squarify([5, 0], (a) => a, { x: 2, y: 3, w: 10, h: 4 });
    expect(s.boxes).toEqual([{ item: 5, rect: { x: 2, y: 3, w: 10, h: 4 } }]);
  });

  test("group: consecutive strips of one orientation are siblings, a flip nests as the rest", () => {
    const strips = squarify([50, 30, 10, 5, 3, 1, 1], (a) => a, { x: 0, y: 0, w: 472, h: 300 });
    const g = group(strips)!;
    expect(g.vertical).toBe(true);
    let depth = 0, n = 0;
    for (let x: typeof g | undefined = g; x; x = x.rest) { depth++; n += x.strips.length; for (const s of x.strips) expect(s.vertical).toBe(x.vertical); if (x.rest) expect(x.rest.vertical).toBe(!x.vertical); }
    expect(n).toBe(strips.length);
    expect(depth).toBeLessThanOrEqual(strips.length);
    expect(group([])).toBeUndefined();
  });

  test("neighbour: the box across the edge in that direction, straight ahead over nearer but off to the side; nothing that way is undefined", () => {
    // A 2 by 2 grid plus a tall box on the right.
    const rs: Rect[] = [
      { x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 },
      { x: 0, y: 10, w: 10, h: 10 }, { x: 10, y: 10, w: 10, h: 10 },
      { x: 20, y: 0, w: 5, h: 20 },
    ];
    expect(neighbour(rs, 0, "right")).toBe(1);
    expect(neighbour(rs, 0, "down")).toBe(2);
    expect(neighbour(rs, 3, "up")).toBe(1);
    expect(neighbour(rs, 3, "left")).toBe(2);
    expect(neighbour(rs, 1, "right")).toBe(4);
    expect(neighbour(rs, 4, "left")).toBe(1);
    expect(neighbour(rs, 0, "left")).toBeUndefined();
    expect(neighbour(rs, 0, "up")).toBeUndefined();
    expect(neighbour(rs, 9, "up")).toBeUndefined();
  });
});

// ---- scan.ts ------------------------------------------------------------------------

/** A tree from a spec: `{ name: bytes }` for a file, `{ name: {...} }` for a folder. */
type Spec = { [name: string]: number | Spec };
function tree(name: string, spec: Spec, up?: Node): Node {
  const n: Node = { name, dir: true, alloc: 0, size: 0, files: 0, mtime: 1_700_000_000_000, kids: [], up, done: 1, kinds: new Array(KINDS.length).fill(0) };
  for (const [k, v] of Object.entries(spec)) {
    const kid = typeof v === "number" ? { name: k, dir: false, alloc: v, size: v, files: 1, mtime: 1_700_000_000_000, up: n } : tree(k, v, n);
    n.kids!.push(kid);
    n.alloc += kid.alloc; n.size += kid.size; n.files += kid.files;
    if (kid.dir) kid.kinds!.forEach((b, i) => (n.kinds![i] += b)); else n.kinds![KINDS.indexOf(kindOf(kid))] += kid.alloc;
  }
  return n;
}
const home = () => tree("/h", {
  Movies: { "a.mov": 900 * MB, "b.mkv": 300 * MB },
  proj: { pal: { target: { debug: { "libpal.a": 400 * MB } }, node_modules: { "x.node": 200 * MB }, "README.md": 1024 }, tela: { node_modules: { "y.node": 150 * MB } } },
  Pictures: { "IMG_1.HEIC": 50 * MB, "scan.png": 10 * MB },
  ".zshrc": 512,
  empty: {},
});

describe("scan.ts", () => {
  test("kindOf by extension, an .app is an app, a rest node its own; a folder's dominant kind is what weighs most below it", () => {
    expect(kindOf({ name: "a.mov", dir: false })).toBe("video");
    expect(kindOf({ name: "x.HEIC", dir: false })).toBe("image");
    expect(kindOf({ name: "Tool.app", dir: true })).toBe("app");
    expect(kindOf({ name: "src", dir: true })).toBe("folder");
    expect(kindOf({ name: "README", dir: false })).toBe("file");
    expect(kindOf({ name: "12 smaller files", dir: false, rest: 12 })).toBe("rest");
    const h = home();
    expect(dominant(h)).toBe("video");
    expect(dominant(find(h, "/h/proj")!)).toBe("code");
    expect(dominant(find(h, "/h/Pictures")!)).toBe("image");
    expect(dominant(find(h, "/h/empty")!)).toBe("folder");
    expect(pct(5, 200)).toBe("2.5%");
    expect(pct(50, 200)).toBe("25%");
    expect(pct(1, 10000)).toBe("<0.1%");
    expect(pct(1, 0)).toBe("0%");
  });

  test("paths: find, pathOf, chain", () => {
    const h = home();
    const lib = find(h, "/h/proj/pal/target/debug/libpal.a")!;
    expect(pathOf(lib)).toBe("/h/proj/pal/target/debug/libpal.a");
    expect(chain(lib).map((n) => n.name)).toEqual(["/h", "proj", "pal", "target", "debug", "libpal.a"]);
    expect(find(h, "/h")).toBe(h);
    expect(find(h, "/h/nope")).toBeUndefined();
    expect(find(h, "/other")).toBeUndefined();
  });

  test("largestFiles and largestDirs biggest first; detach takes a subtree's bytes, files and kinds out of every ancestor", () => {
    const h = home();
    expect(largestFiles(h, 3).map((f) => f.name)).toEqual(["a.mov", "libpal.a", "b.mkv"]);
    expect(largestDirs(h, 3).map((d) => d.name)).toEqual(["Movies", "proj", "pal"]);
    const before = h.alloc;
    const target = find(h, "/h/proj/pal/target")!;
    detach(target);
    expect(h.alloc).toBe(before - 400 * MB);
    expect(find(h, "/h/proj/pal")!.files).toBe(2);
    expect(find(h, "/h/proj/pal/target")).toBeUndefined();
    // libpal.a was the only code below; the .node files are plain files.
    expect(h.kinds![KINDS.indexOf("code")]).toBe(0);
    expect(dominant(find(h, "/h/proj")!)).toBe("file");
  });

  test("pack keeps the biggest nodes under a size cut with every ancestor, marks what was cut, and unpack brings the tree back with the dominant kinds", () => {
    const h = home();
    const p = pack(h, 5);
    const names = (x: any): string[] => [x[0], ...(x[7] ?? []).flatMap((k: any) => (typeof k === "number" ? [] : names(k)))];
    expect(names(p)).toEqual(["/h", "Movies", "a.mov", "proj", "pal"]);
    const back = unpack(p);
    expect(back.alloc).toBe(h.alloc);
    expect(back.files).toBe(h.files);
    expect(back.kids!.map((k) => k.name)).toEqual(["Movies", "proj"]);
    expect(back.omitted).toBe(3);
    expect(find(back, "/h/proj/pal")!.omitted).toBe(3);
    expect(find(back, "/h/Movies")!.omitted).toBe(1);
    expect(dominant(back)).toBe("video");
    expect(dominant(find(back, "/h/proj")!)).toBe("code");
    expect(find(back, "/h/Movies/a.mov")!.up).toBe(find(back, "/h/Movies"));
    // The whole tree packs and comes back whole: an empty folder is an empty array, no `omitted`.
    const whole = unpack(pack(h, 1000));
    expect(whole.omitted).toBeUndefined();
    expect(find(whole, "/h/empty")!.kids).toEqual([]);
    expect(find(whole, "/h/empty")!.omitted).toBeUndefined();
    expect(largestFiles(whole, 2).map((f) => f.name)).toEqual(["a.mov", "libpal.a"]);
  });

  test("packWithin shrinks the budget until the JSON fits", () => {
    const h = home();
    const full = JSON.stringify(pack(h, 1000)).length;
    const small = packWithin(h, Math.floor(full / 2));
    expect(JSON.stringify(small).length).toBeLessThanOrEqual(Math.floor(full / 2));
    expect(small[0]).toBe("/h");
    expect(JSON.stringify(packWithin(h, full * 2))).toBe(JSON.stringify(pack(h, 2000)));
  });

  describe("walk on a temp tree", () => {
    const dir = mkdtempSync(join(tmpdir(), "pal-space-walk-"));
    beforeAll(() => {
      mkdirSync(join(dir, "a/b"), { recursive: true });
      mkdirSync(join(dir, "many"));
      mkdirSync(join(dir, "empty"));
      writeFileSync(join(dir, "a/big.mov"), Buffer.alloc(300 * 1024));
      writeFileSync(join(dir, "a/b/notes.md"), "hello");
      writeFileSync(join(dir, "a/b/photo.heic"), Buffer.alloc(40 * 1024));
      // A hard link counts once; a symlink is never followed (to a file or a folder).
      linkSync(join(dir, "a/big.mov"), join(dir, "a/big-link.mov"));
      symlinkSync(join(dir, "a"), join(dir, "a-link"));
      symlinkSync(join(dir, "a/big.mov"), join(dir, "big-sym.mov"));
      for (let i = 0; i < FILES_PER_DIR + 10; i++) writeFileSync(join(dir, "many", `f${String(i).padStart(3, "0")}.txt`), Buffer.alloc(i === 0 ? 8192 : 16));
      utimesSync(join(dir, "a/b/notes.md"), new Date(1_600_000_000_000), new Date(1_600_000_000_000));
    });
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    test("counts files, bytes twice, hard links once, symlinks never; folds the tail of a big folder into a rest node; reports progress per folder", async () => {
      const root = rootNode(dir);
      const seen: string[] = [];
      const p = await walk(root, dir, { onProgress: (x) => seen.push(x.current) });
      expect(p.files).toBe(3 + FILES_PER_DIR + 10);
      expect(p.dirs).toBe(4);
      expect(p.denied).toBe(0);
      expect(root.files).toBe(p.files);
      expect(root.size).toBe(300 * 1024 + 5 + 40 * 1024 + 8192 + (FILES_PER_DIR + 9) * 16);
      expect(root.alloc).toBeGreaterThanOrEqual(root.size);
      expect(root.alloc).toBe(p.alloc);
      expect(root.done).toBeDefined();
      expect(seen).toContain(join(dir, "a/b"));
      const a = find(root, join(dir, "a"))!;
      // One of the two names of the hard-linked file, whichever stat landed first.
      expect(a.kids!.length).toBe(2);
      expect(a.kids!.filter((k) => k.name.endsWith(".mov")).length).toBe(1);
      expect(root.kids!.map((k) => k.name).sort()).toEqual(["a", "empty", "many"]);
      expect(a.mtime).toBeGreaterThan(0);
      expect(find(root, join(dir, "a/b/notes.md"))!.mtime).toBe(1_600_000_000_000);
      expect(dominant(a)).toBe("video");
      const many = find(root, join(dir, "many"))!;
      expect(many.kids!.length).toBe(FILES_PER_DIR + 1);
      const rest = many.kids!.find((k) => k.rest)!;
      expect(rest.rest).toBe(10);
      expect(rest.name).toBe("10 smaller files");
      expect(rest.size).toBe(160);
      expect(many.kids![0].name).toBe("f000.txt");
      expect(many.files).toBe(FILES_PER_DIR + 10);
      expect(find(root, join(dir, "empty"))!.kids).toEqual([]);
    });

    test("a rescan of one folder replaces its subtree in place and the totals above follow; a cancelled walk stops early; a missing folder is denied", async () => {
      const root = rootNode(dir);
      await walk(root, dir);
      const a = find(root, join(dir, "a"))!;
      const before = root.size;
      writeFileSync(join(dir, "a/b/more.txt"), Buffer.alloc(1000));
      await walk(a, join(dir, "a"));
      expect(root.size).toBe(before + 1000);
      expect(root.files).toBe(3 + FILES_PER_DIR + 10 + 1);
      expect(find(root, join(dir, "a/b/more.txt"))).toBeDefined();
      rmSync(join(dir, "a/b/more.txt"));
      const stopped = rootNode(dir);
      const signal = { cancelled: true };
      const p = await walk(stopped, dir, { signal });
      expect(p.files).toBe(0);
      const gone = rootNode(join(dir, "nope"));
      expect((await walk(gone, join(dir, "nope"))).denied).toBe(1);
      expect(gone.denied).toBe(true);
    });
  });
});

// ---- render.ts and rows.ts ------------------------------------------------------------------

const state = (dir: Node, extra: Partial<MapState> = {}): MapState => ({ root: chain(dir)[0], dir, focus: 0, marked: new Set(), sizes: "allocated", colour: "kind", scannedAt: 1_700_000_000_000, denied: 0, mac: true, now: 1_700_000_100_000, ...extra });
const texts = (n: ViewNode): string[] => (n.type === "text" ? [n.value] : n.type === "stack" ? n.children.flatMap(texts) : []);
const stacks = (n: ViewNode): Extract<ViewNode, { type: "stack" }>[] => (n.type === "stack" ? [n, ...n.children.flatMap(stacks)] : []);
const countNodes = (n: ViewNode): number => 1 + (n.type === "stack" ? n.children.reduce((t, c) => t + countNodes(c), 0) : 0);

describe("render.ts", () => {
  test("children biggest first; rects for every child with a box; move walks the neighbours and stays put at an edge", () => {
    const h = home();
    expect(children(h, "allocated").map((k) => k.name)).toEqual(["Movies", "proj", "Pictures", ".zshrc", "empty"]);
    const rs = rects(h, "allocated");
    expect(rs.filter(Boolean).length).toBe(4); // `empty` has no area
    expect(rs.reduce((t, r) => t + (r ? r.w * r.h : 0), 0)).toBeCloseTo(BOARD_W * BOARD_H, 3);
    const from = 0;
    const right = move(h, "allocated", from, "right");
    expect(right).not.toBe(from);
    expect(move(h, "allocated", from, "left")).toBe(from);
    expect(move(h, "allocated", 4, "right")).toBe(4); // no box: nowhere to go
  });

  test("the map: a view the host accepts, keyed by the root, the board a height of flex strips of flex boxes, the focused box ringed, marked ones tinted, the side rows, the crumbs, the footer line", () => {
    const h = home();
    const st = state(h, { focus: 1 });
    const v = render(st);
    checkView(v);
    expect(v.id).toBe("/h");
    expect(v.title).toBe("/h");
    expect(v.keys).toBe("actions");
    const all = stacks(v.tree);
    const board = all.find((s) => s.key === "b:/h")!;
    expect(board.height).toBe(BOARD_H);
    expect(board.flex).toBe(BOARD_W);
    expect(board.transition).toEqual({ move: true, exit: "none" });
    const boxes = all.filter((s) => s.key?.startsWith("b:/h/") && s.action?.startsWith("box:"));
    expect(boxes.map((b) => b.key)).toEqual(["b:/h/Movies", "b:/h/proj", "b:/h/Pictures", "b:/h/.zshrc"]);
    boxes.forEach((b) => { expect(b.flex).toBeGreaterThan(0); expect(b.surface).toMatch(/^#[0-9a-f]{6}66$/); expect(b.transition).toEqual({ move: true, exit: "none" }); });
    expect(boxes.find((b) => b.key === "b:/h/proj")!.selected).toBe(true);
    expect(boxes.filter((b) => b.selected).length).toBe(1);
    // Movies (video) and proj (code) wear their kinds' hues; the nested boxes are fainter and carry no action.
    expect(boxes.find((b) => b.key === "b:/h/Movies")!.surface).toBe("#b054ff66");
    expect(boxes.find((b) => b.key === "b:/h/proj")!.surface).toBe("#35c46f66");
    const inner = all.find((s) => s.key === "b:/h/Movies/a.mov")!;
    expect(inner.surface).toBe("#b054ff40");
    expect(inner.action).toBeUndefined();
    // The rows: name, size, share; the focused one elevated.
    const rows = all.filter((s) => s.key?.startsWith("r:"));
    expect(rows.map((r) => r.key)).toEqual(["r:/h/Movies", "r:/h/proj", "r:/h/Pictures", "r:/h/.zshrc", "r:/h/empty"]);
    expect(rows[1].surface).toBe("elevated");
    expect(rows[1].action).toBe("row:1");
    expect(texts(rows[0])).toEqual(["Movies", "1.17 GB", "60%"]);
    const t = texts(v.tree);
    expect(t).toContain("proj  ·  750.0 MB (37%)  ·  4 files  ·  modified 2 min ago  ·  Folder");
    expect(t).toContain("1.96 GB  ·  9 files");
    expect(t).toContain("scanned 2 min ago");
    // Marks: the tint and the check, the header count, the trash action's title.
    const marked = render(state(h, { marked: new Set(["/h/Movies", "/h/Pictures"]) }));
    checkView(marked);
    expect(stacks(marked.tree).find((s) => s.key === "b:/h/Movies")!.surface).toBe("#ef444466");
    expect(texts(marked.tree)).toContain("2 marked");
    expect(texts(marked.tree)).toContain("✓ Movies");
    expect(marked.actions.find((a) => a.id === "trash")!.title).toBe("Trash marked (2, 1.23 GB)");
    // Zoomed in: the crumbs are controls up to the current folder; the board is keyed by it.
    const pal = find(h, "/h/proj/pal")!;
    const z = render(state(pal));
    checkView(z);
    expect(z.title).toBe("pal");
    expect(stacks(z.tree).find((s) => s.key === "b:/h/proj/pal")!.height).toBe(BOARD_H);
    const crumbs = (z.tree as any).children[0].children.filter((c: ViewNode) => c.type === "text" && String(c.key).startsWith("c"));
    expect(crumbs.map((c: any) => [c.value, c.action])).toEqual([["/h", "crumb:0"], ["proj", "crumb:1"], ["pal", undefined]]);
    expect(z.actions.filter((a) => a.id.startsWith("crumb:")).map((a) => a.id)).toEqual(["crumb:0", "crumb:1"]);
  });

  test("actions: every key in the legend, the titles following the state; a click action per drawn box and row only", () => {
    const h = home();
    const acts = actions(state(h));
    const keys = Object.fromEntries(acts.filter((a) => !a.hidden).map((a) => [a.id, a.shortcut]));
    expect(keys).toEqual({ zoom: undefined, reveal: undefined, out: ["backspace", "-"], up: ["up", "k"], down: ["down", "j"], left: ["left", "h"], right: ["right", "l"], next: "tab", prev: "shift+tab", mark: "m", trash: "cmd+d", look: "space", open: "cmd+o", copy: "cmd+c", info: "i", largest: "cmd+l", colour: "c", sizes: "a", rescan: "cmd+r" });
    expect(acts[0].title).toBe("Zoom in");
    expect(actions(state(h, { focus: 3 }))[0].title).toBe("Open");
    expect(actions(state(h, { focus: 3, marked: new Set(["/h/.zshrc"]) })).find((a) => a.id === "mark")!.title).toBe("Unmark");
    expect(actions(state(h, { scanning: { files: 1, dirs: 1, alloc: 1, size: 1, denied: 0, current: "/h" } })).find((a) => a.shortcut === "cmd+r")!.id).toBe("stop");
    expect(actions(state(h, { mac: false })).some((a) => a.id === "look")).toBe(false);
    expect(acts.filter((a) => a.id.startsWith("box:")).map((a) => a.id)).toEqual(["box:0", "box:1", "box:2", "box:3"]);
    expect(acts.filter((a) => a.id.startsWith("row:")).length).toBe(5);
  });

  test("a folder of many children: at most MAX_BOXES boxes plus one for the rest, MAX_ROWS rows and a count, under the host's node cap", () => {
    const spec: Spec = {};
    for (let i = 0; i < 120; i++) spec[`d${i}`] = { [`f${i}.png`]: (120 - i) * MB, [`g${i}.mov`]: (120 - i) * MB };
    const big = tree("/big", spec);
    const v = render(state(big));
    checkView(v);
    expect(countNodes(v.tree)).toBeLessThan(2000);
    const boxes = stacks(v.tree).filter((s) => s.action?.startsWith("box:"));
    expect(boxes.length).toBe(MAX_BOXES);
    expect(stacks(v.tree).some((s) => s.key === "b:rest")).toBe(true);
    expect(texts(v.tree)).toContain("80 more items");
    expect(stacks(v.tree).filter((s) => s.key?.startsWith("r:")).length).toBe(MAX_ROWS);
    expect(texts(v.tree)).toContain(`${120 - MAX_ROWS} more, smaller`);
    // The compact layout: the rows under the board, fewer of them, no flex on the board.
    const c = render(state(big, { compact: true }));
    checkView(c);
    expect(stacks(c.tree).find((s) => s.key === "b:/big")!.flex).toBeUndefined();
    expect(stacks(c.tree).filter((s) => s.key?.startsWith("r:")).length).toBe(8);
  });

  test("empty and unreadable folders, and a scan under way, say so on the board", () => {
    const h = home();
    const empty = find(h, "/h/empty")!;
    expect(texts(render(state(empty)).tree)).toContain("Empty");
    empty.denied = true;
    expect(texts(render(state(empty)).tree)).toContain("Could not read this folder");
    empty.denied = false; empty.omitted = 4;
    expect(texts(render(state(empty)).tree)).toContain("Not in the saved scan");
    const scanning = render(state(empty, { scanning: { files: 12, dirs: 2, alloc: 5 * MB, size: 5 * MB, denied: 0, current: "/h/x" } }));
    expect(texts(scanning.tree)).toContain("Reading…");
    expect(texts(scanning.tree)).toContain("Scanning…  12 files  ·  5.0 MB");
  });

  test("rows.ts: a file row with its kind tag and folder, a folder row with its count and share, a suggestion row with its one confirmed action", () => {
    const h = home();
    const f = fileRow(find(h, "/h/Movies/a.mov")!, "/h", "allocated", true);
    expect(f).toMatchObject({ id: "/h/Movies/a.mov", name: "a.mov", subtitle: "/h/Movies", accessories: [{ tag: "Video", color: "violet" }, { text: "900.0 MB" }] });
    expect(f.actions!.map((a) => a.id)).toEqual(["open", "reveal", "map", "look", "copy", "info", "trash"]);
    expect(fileRow(find(h, "/h/Movies/a.mov")!, "/h", "allocated", false).actions!.some((a) => a.id === "look")).toBe(false);
    const d = folderRow(find(h, "/h/proj")!, h, "allocated", true);
    expect(d.accessories).toEqual([{ text: "4 files" }, { text: "37%" }, { text: "750.0 MB" }]);
    expect(d.actions!.map((a) => a.id)).toEqual(["map", "reveal", "largest", "copy", "info", "trash"]);
    const s = suggestionRow({ id: "trash", name: "Trash", path: "/h/.Trash", note: "Emptying it is final", size: 3 * MB, files: 2, action: "empty-trash", section: "Trash" }, 30, true);
    expect(s.actions![2]).toMatchObject({ id: "empty-trash", style: "destructive", confirm: "Empty the Trash (3.0 MB)? This cannot be undone." });
    const old = suggestionRow({ id: "downloads", name: "Old", path: "/h/Downloads", note: "By date", size: 5 * MB, files: 3, action: "trash-old", section: "x", measuring: true }, 30, true);
    expect(old.subtitle).toBe("Measuring… By date");
    expect(old.accessories).toEqual([{ text: "3 files" }, { text: "5.0 MB…" }]);
    expect(old.actions![2]).toMatchObject({ id: "trash-old", title: "Trash the 3 files", confirm: "Move 3 files (5.0 MB) older than 30 days to the Trash?" });
  });
});

// ---- the extension over the wire ------------------------------------------------------

const dir = realpathSync(mkdtempSync(join(tmpdir(), "pal-space-")));
const root = join(dir, "root");
const bin = join(dir, "bin");
const trashDir = join(dir, "trash");
const openLog = join(dir, "open.log");
mkdirSync(root); mkdirSync(bin); mkdirSync(trashDir);
mkdirSync(join(root, "proj/pal/node_modules"), { recursive: true });
mkdirSync(join(root, "Movies"));
writeFileSync(join(root, "Movies/trip.mov"), Buffer.alloc(200 * 1024));
writeFileSync(join(root, "Movies/clip.mp4"), Buffer.alloc(50 * 1024));
writeFileSync(join(root, "proj/pal/node_modules/x.node"), Buffer.alloc(120 * 1024));
writeFileSync(join(root, "proj/pal/README.md"), "# pal");
writeFileSync(join(root, "notes.txt"), "hi");
for (const opener of ["open", "xdg-open", "qlmanage", "osascript"]) { writeFileSync(join(bin, opener), `#!/bin/sh\nprintf '%s\\n' "$*" >> "${openLog}"\n`); chmodSync(join(bin, opener), 0o755); }
writeFileSync(join(bin, "trash"), `#!/bin/sh\nmv -- "$1" "${trashDir}/" || exit 1\n`);
chmodSync(join(bin, "trash"), 0o755);

let host: Host;
const oldPath = process.env.PATH;
beforeAll(async () => {
  process.env.PATH = `${bin}:${oldPath}`;
  process.env.PAL_SPACE_TRASH = join(bin, "trash");
  stored.clear();
  host = await Host.bundled({ settings: { space: { settings: { largest: 5 } } } });
});
afterAll(() => { host.kill(); process.env.PATH = oldPath; delete process.env.PAL_SPACE_TRASH; rmSync(dir, { recursive: true, force: true }); });

const viewOf = (e: { view?: View }) => checkView(e.view);
const mapView = (ctx: Record<string, unknown> = {}) => host.request<View>("view", { extension: "space", palette: "map", args: { root }, ...ctx }).then(checkView);
const mapPick = (action: string) => host.pick("space", "map", root, action, { args: { root } });

describe("space over the wire", () => {
  test("meta: the roots palette is live on the cyan disk tile, the map a view, the lists live and lazy; the manifest and the code agree; the links are declared", async () => {
    const l = host.loaded().find((l) => l.extension === "space")!;
    expect(l.warnings).toEqual([]);
    expect(l.palettes.map((p) => [p.name, p.view ?? "list", p.live ?? false, p.lazy ?? false])).toEqual([["space", "list", true, false], ["map", "view", false, false], ["largest", "list", true, true], ["folders", "list", true, true], ["cleanup", "list", true, true]]);
    expect(l.palettes[0].icon).toEqual(tile("cyan", "\u{f02ca}"));
    expect(l.palettes[2].filters![0]).toEqual({ id: "all", title: "All kinds" });
    expect(Object.keys(l.manifest.links!)).toEqual(["scan", "largest"]);
  });

  test("the roots: Home first, the volumes with their free space, Scan a folder with a typed path, Cleanup; a typed path that is not a folder is refused", async () => {
    const rows = await host.list("space", "space");
    expect(rows[0]).toMatchObject({ id: `root:${process.env.HOME}`, name: "Home", accessories: [{ tag: "not scanned", color: "grey" }] });
    expect(rows[0].actions!.map((a) => a.id)).toEqual(["map", "largest", "folders", "rescan"]);
    const vol = rows.find((r) => r.id === "root:/")!;
    expect(vol.name).toBe(MAC ? "Macintosh HD" : "Root");
    expect(vol.accessories![0]).toMatchObject({ text: expect.stringMatching(/free$/) });
    const scan = rows.find((r) => r.id === "scan")!;
    expect(scan.args).toEqual([{ id: "path", placeholder: "Folder (~/proj)", required: true }]);
    expect(rows.at(-1)!.id).toBe("cleanup");
    expect(await host.pick("space", "space", "scan", "map", { values: { path: join(root, "notes.txt") } })).toMatchObject({ keep: true, toast: { title: "Not a folder", style: "failure" } });
    const form = await host.pick("space", "space", "scan", "map", {});
    expect(form.form).toMatchObject({ title: "Scan a folder", submit: { id: "map", title: "Scan" } });
    expect(await host.pick("space", "space", "scan", "map", { values: { path: root } })).toEqual({ push: { extension: "space", palette: "map", args: { root }, title: root } });
    expect(await host.pick("space", "space", "cleanup")).toEqual({ push: { extension: "space", palette: "cleanup" } });
  });

  test("the map of a fresh root starts a scan, pushes the live tree into the open level and persists the packed tree when it lands", async () => {
    host.viewShown("space", { palette: "map" }, root);
    const first = await mapView();
    expect(first.id).toBe(root);
    // The scan lands within a moment; the last push has the totals and no progress line.
    const done = await host.nextViewUpdate("space", { palette: "map" }, (u) => u.id === root && !texts((u.spec as View).tree).some((t) => t.startsWith("Scanning")), 5000);
    const v = checkView(done.spec as View);
    const t = texts(v.tree);
    // Allocated sizes: the blocks, a little over the 376 KB written.
    expect(t.find((x) => x.endsWith("  ·  5 files"))).toMatch(/^3[789]\d KB/);
    expect(t.some((x) => x.startsWith("scanned "))).toBe(true);
    expect(stacks(v.tree).filter((s) => s.action?.startsWith("box:")).map((s) => s.key)).toEqual([`b:${root}/Movies`, `b:${root}/proj`, `b:${root}/notes.txt`]);
    await host.until(() => stored.has("space\0roots"), 3000, "the packed tree in storage");
    const saved = stored.get("space\0roots") as Record<string, { at: number; files: number; tree: unknown }>;
    expect(saved[root].files).toBe(5);
    expect(unpack(saved[root].tree as any).alloc).toBeGreaterThanOrEqual(376 * 1024);
    // The roots palette now shows it under Scanned before, with Forget.
    const rows = await host.list("space", "space");
    const row = rows.find((r) => r.id === `root:${root}`)!;
    expect(row.section).toBe("Scanned before");
    expect(row.subtitle).toMatch(/^3\d\d KB in 5 files, scanned /);
    expect(row.actions!.at(-1)!.id).toBe("forget");
  });

  test("keys: Enter zooms into the focused folder, Backspace out, the arrows and Tab move the focus, a click on a box zooms, on a row focuses, on a crumb zooms out", async () => {
    let v = viewOf(await mapPick("zoom"));
    expect(v.title).toBe("Movies");
    expect(texts(v.tree).find((t) => t.startsWith("trip.mov  ·  "))).toMatch(/^trip\.mov {2}· {2}200 KB \(\d+%\) {2}· {2}modified just now {2}· {2}Video$/);
    v = viewOf(await mapPick("right"));
    expect(stacks(v.tree).find((s) => s.selected)!.key).toBe(`b:${root}/Movies/clip.mp4`);
    v = viewOf(await mapPick("left"));
    expect(stacks(v.tree).find((s) => s.selected)!.key).toBe(`b:${root}/Movies/trip.mov`);
    v = viewOf(await mapPick("next"));
    expect(stacks(v.tree).find((s) => s.selected)!.key).toBe(`b:${root}/Movies/clip.mp4`);
    v = viewOf(await mapPick("out"));
    expect(v.title).toBe(root);
    expect(stacks(v.tree).find((s) => s.selected)!.key).toBe(`b:${root}/Movies`);
    v = viewOf(await mapPick("box:1"));
    expect(v.title).toBe("proj");
    v = viewOf(await mapPick("box:0"));
    expect(v.title).toBe("pal");
    v = viewOf(await mapPick("row:1"));
    expect(stacks(v.tree).find((s) => s.selected)!.key).toBe(`b:${root}/proj/pal/README.md`);
    // Enter on a file opens it.
    expect(await mapPick("zoom")).toEqual({ open: join(root, "proj/pal/README.md") });
    v = viewOf(await mapPick("crumb:0"));
    expect(v.title).toBe(root);
    expect(stacks(v.tree).find((s) => s.selected)!.key).toBe(`b:${root}/proj`);
    // Out at the root stays.
    expect(viewOf(await mapPick("out")).title).toBe(root);
  });

  test("the file verbs from the map: copy, reveal, Quick Look, info as a show level; colour and sizes write the settings", async () => {
    expect(await mapPick("copy")).toEqual({ copy: join(root, "proj") });
    expect(await mapPick("reveal")).toEqual({ hide: true });
    expect(await mapPick("look")).toEqual({ hide: true });
    const info = await mapPick("info");
    // (Asserted by hand: Bun's toMatchObject with an arrayContaining left the received array emptied on 1.4.2.)
    const md = info.show!.metadata!;
    expect(info.show!.title).toBe("proj");
    expect(md.map((m) => m.label)).toEqual(["Kind", "Path", "On disk", "Apparent", "Files", "Items", "Share of parent", "Modified", "Owner"]);
    expect(md[0]).toEqual({ label: "Kind", value: "Folder" });
    expect(md[4]).toEqual({ label: "Files", value: "2" });
    await mapPick("colour");
    expect(host.written.get("space")).toMatchObject({ colour: "depth" });
    await mapPick("sizes");
    expect(host.written.get("space")).toMatchObject({ sizes: "apparent" });
    // And back, so the layout below is the allocated one.
    await mapPick("colour");
    await mapPick("sizes");
    expect(host.written.get("space")).toEqual({}); // the defaults again: the keys are unset
    expect(await mapPick("largest")).toEqual({ push: { extension: "space", palette: "largest", args: { root }, title: `Largest in ${root}` } });
  });

  test("mark and trash: m marks the focused box, the trash takes every marked one through the stand-in, the tree and the saved scan follow", async () => {
    let v = viewOf(await mapPick("mark"));
    expect(texts(v.tree)).toContain("1 marked");
    v = viewOf(await mapPick("right"));
    v = viewOf(await mapPick("mark"));
    expect(texts(v.tree)).toContain("2 marked");
    expect(v.actions.find((a) => a.id === "trash")!.title).toMatch(/^Trash marked \(2, /);
    const r = await mapPick("trash");
    expect(r.toast).toEqual({ title: "Moved to Trash", message: "2 items" });
    v = checkView(r.view!);
    expect(stacks(v.tree).filter((s) => s.action?.startsWith("box:")).map((s) => s.key)).toEqual([`b:${root}/Movies`]);
    expect(texts(v.tree)).not.toContain("2 marked");
    expect(require("node:fs").readdirSync(trashDir).sort()).toEqual(["notes.txt", "proj"]);
    await host.until(() => (stored.get("space\0roots") as any)?.[root]?.files === 2, 3000, "the saved scan without the trashed items");
  });

  test("the lists: largest files with a kind filter, largest folders, the trash from a list with marked rows; a root without a scan gets a hint whose Enter scans it", async () => {
    const files = await host.list("space", "largest", "", { args: { root } });
    expect(files.map((f) => f.name)).toEqual(["trip.mov", "clip.mp4"]);
    expect(files[0].accessories).toEqual([{ tag: "Video", color: "violet" }, { text: "200 KB" }]);
    expect(await host.list("space", "largest", "", { args: { root }, filter: "image" })).toEqual([expect.objectContaining({ id: "hint:empty", name: "No files here" })]);
    const dirs = await host.list("space", "folders", "", { args: { root } });
    expect(dirs.map((d) => [d.name, d.accessories![0].text])).toEqual([["Movies", "2 files"]]);
    expect(await host.pick("space", "folders", join(root, "Movies"), "map", { args: { root } })).toEqual({ push: { extension: "space", palette: "map", args: { root }, title: root } });
    const other = join(dir, "other");
    mkdirSync(other);
    const hintRows = await host.list("space", "largest", "", { args: { root: other } });
    expect(hintRows).toEqual([expect.objectContaining({ id: "hint:none", name: `${other} is not scanned yet` })]);
    expect(await host.pick("space", "largest", "hint:none", "scan", { args: { root: other } })).toEqual({ push: { extension: "space", palette: "map", args: { root: other }, title: other } });
    const t = await host.pick("space", "largest", join(root, "Movies/clip.mp4"), "trash", { args: { root }, ids: [join(root, "Movies/clip.mp4")] });
    expect(t.toast).toEqual({ title: "Moved to Trash", message: "clip.mp4" });
    expect((await host.list("space", "largest", "", { args: { root } })).map((f) => f.name)).toEqual(["trip.mov"]);
  });

  test("cleanup: the candidate folders that exist, measured; nothing under this HOME beyond the hint to scan it", async () => {
    const rows = await host.list("space", "cleanup", "", {}, 8000);
    expect(rows.every((r) => r.section)).toBe(true);
    expect(rows.some((r) => r.id === "hint:scan-home" || r.section === "Stale build folders")).toBe(true);
    for (const r of rows.filter((r) => !r.id.startsWith("hint:"))) expect(r.actions!.find((a) => a.style === "destructive")!.confirm).toBeTruthy();
  });

  test("links: scan opens the map (a fresh root starts scanning), largest the list; a path that is not a folder is refused", async () => {
    expect(await host.request("link", { extension: "space", route: "scan", params: { root } })).toEqual({ push: { extension: "space", palette: "map", args: { root }, title: root } });
    expect(await host.request("link", { extension: "space", route: "largest", params: { root } })).toEqual({ push: { extension: "space", palette: "largest", args: { root }, title: `Largest in ${root}` } });
    await expect(host.request("link", { extension: "space", route: "scan", params: { root: join(root, "notes.txt") } })).rejects.toThrow("not a folder");
    // Forget: the saved scan goes, the folder stays.
    expect(await host.pick("space", "space", `root:${root}`, "forget")).toMatchObject({ toast: { title: "Forgotten" } });
    expect((stored.get("space\0roots") as any)[root]).toBeUndefined();
  });
});
