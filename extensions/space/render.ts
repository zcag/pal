// The map as a view tree (`View` in `@zcag/pal`), pure over a `MapState`:
// a crumb row with the scan's status, the board (the directory's children
// as squarified boxes, nested flex stacks weighted by the layout's px so
// the split is exact at any panel width, each box's own children drawn
// faintly inside it when it is big enough: the SpaceSniffer look), a side
// strip of the same children as rows, a footer line about the focused
// box, and the keys. Every box and row is a control (a click zooms or
// focuses) through a hidden action per index; the focused box wears the
// accent ring and the marked ones the trash tint.
import { ago, bytes, column, keyHint, row, text, tilde, type Action, type View, type ViewNode } from "@zcag/pal";
import { group, neighbour, squarify, type Dir, type Group, type Rect, type Strip } from "./layout.ts";
import { KIND_LABEL, chain, count, dominant, find, isRoot, kindOf, pct, pathOf, type Kind, type Node, type Progress } from "./scan.ts";

export type Sizes = "allocated" | "apparent";
export type Colour = "kind" | "depth";

export type MapState = {
  root: Node;
  /** The board's directory. */
  dir: Node;
  /** Which of `dir`'s children (in `children()` order) the keys are on. */
  focus: number;
  /** Paths marked for the trash. */
  marked: Set<string>;
  sizes: Sizes;
  colour: Colour;
  /** A scan of this root under way: its progress. */
  scanning?: Progress;
  /** When the tree was last completed (unix ms); absent for a tree still on its first scan. */
  scannedAt?: number;
  /** From the stored compact tree: only the biggest nodes are in hand. */
  partial?: boolean;
  denied: number;
  /** Laid out for the 420 px popover. */
  compact?: boolean;
  mac: boolean;
  now: number;
  /** The first render after a zoom: the boxes glide. */
  animate?: boolean;
};

/** The board in the panel: the view's 696 px less the side strip and the gap. */
export const BOARD_W = 472;
export const BOARD_H = 300;
export const SIDE_W = 216;
/** The popover's board, the rows under it. */
export const COMPACT_W = 396;
export const COMPACT_H = 220;
/** Boxes drawn on the board; the rest fold into one. */
export const MAX_BOXES = 40;
/** Children drawn inside a box, at most. */
export const MAX_INNER = 12;
/** Rows in the side strip. */
export const MAX_ROWS = 15;
/** A tree past this many nodes stops nesting (the host's cap is 2000). */
const NODE_BUDGET = 1500;

const HUES: Record<Kind, string> = { folder: "#4f8cff", app: "#7c6cff", image: "#ff5ca8", video: "#b054ff", audio: "#22c1c3", document: "#f5a623", code: "#35c46f", archive: "#ff7a45", disk: "#8e9aaf", package: "#d4a017", file: "#9aa3b2", rest: "#9aa3b2" };
const RAMP = ["#4f8cff", "#35c46f", "#f5a623", "#ff5ca8", "#22c1c3", "#b054ff", "#ff7a45", "#d4a017"];
const MARK = "#ef4444";
/** A box's tint alpha at the first level and inside another box: under the panel's ink either way (0.5 is where a hex surface swaps to contrast ink). */
const A1 = "66", A2 = "40";

export const sizeOf = (n: Node, s: Sizes) => (s === "apparent" ? n.size : n.alloc);

/** `dir`'s children as the board and the strip list them: biggest first, empty ones last. */
export const children = (dir: Node, s: Sizes): Node[] => [...(dir.kids ?? [])].sort((a, b) => sizeOf(b, s) - sizeOf(a, s) || a.name.localeCompare(b.name));

/** A box's hue: its kind (a folder's: the kind that weighs most below it, as WinDirStat colours), or by its place among the siblings (the DaisyDisk ring) with the nested ones inheriting. */
const hue = (n: Node, i: number, colour: Colour, inherited?: string): string => inherited ?? (colour === "depth" && i >= 0 ? RAMP[i % RAMP.length] : HUES[dominant(n)]);

type Placed = { node: Node; i: number; rect: Rect };
type Stack = Extract<ViewNode, { type: "stack" }>;

/**
 * The layout of a directory's children in a `w` by `h` box: the first
 * `MAX_BOXES` by size, the rest folded into one "N more items" box so
 * the areas still add up. The rects are what the labels and the keys
 * read; the strips are what the view draws.
 */
export function layout(dir: Node, s: Sizes, w: number, h: number): { strips: Strip<Placed>[]; placed: Placed[]; folded: number } {
  const kids = children(dir, s).filter((k) => sizeOf(k, s) > 0);
  const shown = kids.slice(0, MAX_BOXES);
  const tail = kids.slice(MAX_BOXES);
  const items: Placed[] = shown.map((node, i) => ({ node, i, rect: { x: 0, y: 0, w: 0, h: 0 } }));
  if (tail.length) items.push({ node: { name: `${tail.length.toLocaleString("en-US")} more items`, dir: false, rest: tail.length, alloc: tail.reduce((t, k) => t + k.alloc, 0), size: tail.reduce((t, k) => t + k.size, 0), files: tail.reduce((t, k) => t + k.files, 0), mtime: 0 }, i: -1, rect: { x: 0, y: 0, w: 0, h: 0 } });
  const strips = squarify(items, (p) => sizeOf(p.node, s), { x: 0, y: 0, w, h });
  for (const st of strips) for (const b of st.boxes) b.item.rect = b.rect;
  return { strips, placed: strips.flatMap((st) => st.boxes.map((b) => b.item)), folded: tail.length };
}

/** The rects of `dir`'s children by their index in `children()` order, for the keys' spatial moves. */
export function rects(dir: Node, s: Sizes, w = BOARD_W, h = BOARD_H): Rect[] {
  const out: Rect[] = [];
  for (const p of layout(dir, s, w, h).placed) if (p.i >= 0) out[p.i] = p.rect;
  return out;
}

/** The child the arrow lands on from `focus`; `focus` itself when nothing lies that way. */
export function move(dir: Node, s: Sizes, focus: number, d: Dir, compact?: boolean): number {
  const rs = rects(dir, s, ...boardSize({ compact }));
  if (!rs[focus]) return focus;
  // Children without a box (an empty file) are not on the board: the neighbour search skips their holes.
  const idx = rs.map((r, i) => (r ? i : -1)).filter((i) => i >= 0);
  const n = neighbour(idx.map((i) => rs[i]), idx.indexOf(focus), d);
  return n === undefined ? focus : idx[n];
}

const boardSize = (st: Pick<MapState, "compact">): [number, number] => (st.compact ? [COMPACT_W, COMPACT_H] : [BOARD_W, BOARD_H]);
/** Rows the side strip draws. */
const rowsOf = (st: Pick<MapState, "compact">) => (st.compact ? 8 : MAX_ROWS);

/** Every key the view answers, in the order ⌘K lists them; the titles follow the state. */
export function actions(st: MapState): Action[] {
  const f = children(st.dir, st.sizes)[st.focus];
  const marked = st.marked.size;
  const markedBytes = [...st.marked].reduce((t, p) => t + (find(st.root, p)?.alloc ?? 0), 0);
  const acts: Action[] = [
    f?.dir ? { id: "zoom", title: "Zoom in" } : f && !f.rest ? { id: "zoom", title: "Open" } : { id: "zoom", title: "Zoom in" },
    { id: "reveal", title: st.mac ? "Reveal in Finder" : "Show in file manager" },
    { id: "out", title: "Zoom out", shortcut: ["backspace", "-"] },
    { id: "up", title: "Focus up", shortcut: ["up", "k"] },
    { id: "down", title: "Focus down", shortcut: ["down", "j"] },
    { id: "left", title: "Focus left", shortcut: ["left", "h"] },
    { id: "right", title: "Focus right", shortcut: ["right", "l"] },
    { id: "next", title: "Next by size", shortcut: "tab" },
    { id: "prev", title: "Previous by size", shortcut: "shift+tab" },
    { id: "mark", title: f && st.marked.has(pathOf(f)) ? "Unmark" : "Mark for the trash", shortcut: "m" },
    marked
      ? { id: "trash", title: `Trash marked (${marked}, ${bytes(markedBytes)})`, shortcut: "cmd+d", style: "destructive", confirm: `Move ${marked} marked item${marked === 1 ? "" : "s"} (${bytes(markedBytes)}) to the Trash?` }
      : { id: "trash", title: "Move to Trash", shortcut: "cmd+d", style: "destructive", confirm: f ? `Move ${f.name} (${bytes(sizeOf(f, st.sizes))}) to the Trash?` : "Move this to the Trash?" },
    ...(st.mac ? [{ id: "look", title: "Quick Look", shortcut: "space" }] : []),
    { id: "open", title: "Open", shortcut: "cmd+o" },
    { id: "copy", title: "Copy path", shortcut: "cmd+c" },
    { id: "info", title: "Info", shortcut: "i" },
    { id: "largest", title: "Largest files here", shortcut: "cmd+l" },
    { id: "colour", title: st.colour === "kind" ? "Colour by depth" : "Colour by kind", shortcut: "c" },
    { id: "sizes", title: st.sizes === "allocated" ? "Show apparent sizes" : "Show sizes on disk", shortcut: "a" },
    st.scanning ? { id: "stop", title: "Stop scanning", shortcut: "cmd+r" } : { id: "rescan", title: isRoot(st.dir) ? "Rescan" : "Rescan this folder", shortcut: "cmd+r" },
  ];
  // The controls: a click on a box that is drawn, a row that is drawn, a crumb.
  const n = children(st.dir, st.sizes).length;
  const drawn = new Set(layout(st.dir, st.sizes, ...boardSize(st)).placed.map((p) => p.i));
  for (let i = 0; i < n; i++) {
    if (drawn.has(i)) acts.push({ id: `box:${i}`, title: "Zoom into the box", hidden: true });
    if (i < rowsOf(st)) acts.push({ id: `row:${i}`, title: "Focus the row", hidden: true });
  }
  chain(st.dir).slice(0, -1).forEach((_, k) => acts.push({ id: `crumb:${k}`, title: "Zoom out to here", hidden: true }));
  return acts;
}

/** A root's label: `~`, a volume's name, else the path. */
export const rootLabel = (path: string): string => (path === "/" ? "Macintosh HD" : path.startsWith("/Volumes/") && path.split("/").length === 3 ? path.slice(9) : tilde(path));

export function render(st: MapState): View {
  const s = st.sizes;
  const kids = children(st.dir, s);
  const focus = kids[st.focus];
  const [w, h] = boardSize(st);
  const total = sizeOf(st.dir, s);
  let nodes = 0;

  // ---- the board ------------------------------------------------------------
  const { strips } = layout(st.dir, s, w, h);
  /** One box: the tint, the label when it fits, its own children faintly inside when there is room. */
  const box = (p: Placed, first: boolean, inherited?: string): Stack => {
    const n = p.node, r = p.rect;
    const path = p.i >= 0 ? pathOf(n) : "";
    const marked = first && st.marked.has(path);
    const tone = marked ? MARK : hue(n, p.i, st.colour, inherited);
    const inner: ViewNode[] = [];
    const label = r.w >= 40 && r.h >= 18;
    if (label) inner.push(text(n.name, { key: "n", size: "xs", weight: first ? "medium" : "regular", width: Math.max(8, Math.round(r.w) - 8), ...(marked && { color: "destructive" }) }));
    if (label && r.h >= 34 && first) inner.push(text(bytes(sizeOf(n, s)), { key: "s", size: "xs", style: "muted", width: Math.max(8, Math.round(r.w) - 8) }));
    nodes += 1 + inner.length;
    // The children inside: one level below the board's, faint, the biggest few.
    const innerH = r.h - 8 - inner.length * 15;
    if (first && n.dir && n.kids?.length && r.w >= 56 && innerH >= 28 && nodes < NODE_BUDGET) {
      const sub = layout({ ...n, kids: children(n, s).slice(0, MAX_INNER) }, s, r.w - 8, innerH);
      if (sub.strips.length) inner.push(stripsNode(sub.strips, false, tone, "in", true));
    }
    return {
      type: "stack", key: `b:${path || "rest"}`, direction: "column", gap: 0, padding: 1, radius: true, surface: `${tone}${first ? A1 : A2}` as `#${string}`,
      ...(first && p.i >= 0 && { action: `box:${p.i}`, transition: { move: true, exit: "none" } }),
      ...(first && p.i === st.focus && p.i >= 0 && { selected: true }),
      children: inner,
    };
  };
  /** Strips as nested flex stacks: the strips of one orientation are siblings weighted by their extent, the flipped rest nests last. */
  const stripsNode = (all: Strip<Placed>[], first: boolean, inherited: string | undefined, key: string, grow?: boolean): Stack => {
    const g = group(all)!;
    const one = (g: Group<Placed>): Stack => {
      const kids: ViewNode[] = g.strips.map((st, i) => ({
        type: "stack", key: `s${i}`, direction: g.vertical ? "column" : "row", gap: first ? 1 : 0, align: "stretch", flex: g.vertical ? st.rect.w : st.rect.h,
        children: st.boxes.map((b) => ({ ...(box(b.item, first, inherited) as Stack), flex: g.vertical ? b.rect.h : b.rect.w })),
      }));
      nodes += kids.length + 1;
      // The flipped rest spans what the group's strips left: a horizontal strip's width (or a vertical one's height) is exactly that.
      if (g.rest) kids.push({ ...one(g.rest), key: "rest", flex: g.vertical ? g.rest.strips[0].rect.w : g.rest.strips[0].rect.h });
      return { type: "stack", direction: g.vertical ? "row" : "column", gap: first ? 1 : 0, align: "stretch", children: kids };
    };
    return { ...one(g), key, ...(grow && { grow: true }) };
  };
  const empty = !strips.length;
  const board: ViewNode = {
    type: "stack", key: `b:${pathOf(st.dir)}`, direction: "column", surface: "sunken", radius: true, padding: 1, height: h, align: "stretch", justify: "center",
    ...(st.compact ? {} : { flex: w }),
    transition: { move: true, exit: "none" },
    children: empty
      ? [column([
          text(st.scanning ? "Reading…" : st.dir.denied ? "Could not read this folder" : st.dir.omitted ? "Not in the saved scan" : "Empty", { style: "muted", align: "center" }),
          ...(st.dir.denied && st.mac ? [text("Grant pal Full Disk Access in System Settings › Privacy & Security", { style: "muted", size: "xs", align: "center" })] : st.dir.omitted ? [text("Enter rescans it", { style: "muted", size: "xs", align: "center" })] : []),
        ], { align: "center", justify: "center", grow: true })]
      : [{ ...stripsNode(strips, true, undefined, "map", true) }],
  };

  // ---- the side strip: the same children as rows ------------------------------
  const rowsN = rowsOf(st);
  const rows: ViewNode[] = kids.slice(0, rowsN).map((k, i) => {
    const path = pathOf(k);
    const on = i === st.focus, marked = st.marked.has(path);
    const tone = marked ? MARK : hue(k, i, st.colour);
    const nameW = (st.compact ? COMPACT_W : SIDE_W) - 8 - 8 - 12 - 56 - 40;
    return row([
      { type: "tile", width: 8, height: 8, color: tone as `#${string}`, fill: "solid" },
      text((marked ? "✓ " : "") + k.name, { size: "sm", width: nameW, ...(on ? { color: "accent", weight: "medium" } : marked ? { color: "destructive" } : {}) }),
      text(bytes(sizeOf(k, s)), { style: "number", size: "xs", width: 56, align: "end", ...(sizeOf(k, s) === 0 && { color: "faint" }) }),
      text(pct(sizeOf(k, s), total), { style: "muted", size: "xs", width: 40, align: "end" }),
    ], { key: `r:${path}`, gap: 1, padding: 1, radius: true, action: `row:${i}`, ...(on && { surface: "elevated" }) });
  });
  if (kids.length > rowsN) rows.push(text(`${(kids.length - rowsN).toLocaleString("en-US")} more, smaller`, { key: "more", style: "muted", size: "xs", align: "center" }));
  if (!kids.length) rows.push(text(st.scanning ? "Reading…" : "Nothing here", { key: "none", style: "muted", size: "xs", align: "center" }));
  const side = column(rows, { key: "side", gap: 0, ...(st.compact ? {} : { width: SIDE_W, height: h }), align: "stretch" });

  // ---- the crumbs and the status ---------------------------------------------
  const path = chain(st.dir);
  const crumbs: ViewNode[] = [];
  path.forEach((n, k) => {
    const last = k === path.length - 1;
    if (k) crumbs.push(text("›", { key: `sep${k}`, style: "muted", size: "xs" }));
    crumbs.push(text(k === 0 ? rootLabel(n.name) : n.name, { key: `c${k}`, size: "sm", weight: last ? "semibold" : "regular", ...(last ? {} : { color: "muted", action: `crumb:${k}` }), ...(!last && { width: Math.min(160, n.name.length * 8 + 8) }) }));
  });
  const status: ViewNode[] = [];
  if (st.scanning) {
    status.push(text(`Scanning…  ${count(st.scanning.files)}  ·  ${bytes(st.sizes === "apparent" ? st.scanning.size : st.scanning.alloc)}`, { key: "prog", style: "muted", size: "xs" }));
  } else {
    status.push(text(`${bytes(total)}  ·  ${count(st.dir.files)}`, { key: "tot", style: "muted", size: "xs" }));
    if (st.scannedAt) status.push(text(`scanned ${ago(st.scannedAt, { now: st.now })}`, { key: "at", style: "muted", size: "xs", color: st.partial ? "amber" : undefined }));
  }
  if (st.marked.size) status.push(text(`${st.marked.size} marked`, { key: "marked", size: "xs", color: "destructive", weight: "medium" }));
  if (st.denied) status.push(text(`${st.denied} unreadable`, { key: "denied", size: "xs", color: "amber" }));
  const head = row([...crumbs, { type: "spacer" }, ...status], { key: "head", gap: 1, minHeight: 20 });

  // ---- the footer: the focused box, then the keys -------------------------------
  const foot: ViewNode[] = [];
  if (focus) {
    const f = focus;
    const bits = [f.rest ? `${f.rest.toLocaleString("en-US")} smaller files` : f.name, `${bytes(sizeOf(f, s))} (${pct(sizeOf(f, s), total)})`, ...(f.dir ? [count(f.files), ...(f.omitted ? ["more not in the saved scan"] : [])] : []), ...(f.mtime ? [`modified ${ago(f.mtime, { now: st.now })}`] : []), KIND_LABEL[kindOf(f)]];
    foot.push(text(bits.join("  ·  "), { key: "focus", style: "muted", size: "xs", width: st.compact ? COMPACT_W : BOARD_W + 8 + SIDE_W }));
  } else if (st.scanning) foot.push(text(tilde(st.scanning.current), { key: "cur", style: "muted", size: "xs", width: st.compact ? COMPACT_W : BOARD_W + 8 + SIDE_W }));
  const keys = row([
    ...keyHint(["up", "down", "left", "right"], "focus"), ...keyHint("enter", focus?.dir === false && !focus.rest ? "open" : "zoom"), ...keyHint("backspace", "up"), ...keyHint("m", "mark"),
    ...(st.compact ? [] : [...(st.mac ? keyHint("space", "look") : []), ...keyHint("cmd+d", "trash"), ...keyHint("i", "info"), ...keyHint("c", "colour")]),
  ], { key: "keys", gap: 1 });

  const body = st.compact ? column([board, side], { key: "body", gap: 2, align: "stretch" }) : row([board, side], { key: "body", gap: 2, align: "start" });
  const tree = column([head, body, ...foot, keys], { key: "map", padding: 3, gap: 1 });
  const title = isRoot(st.dir) ? rootLabel(st.dir.name) : st.dir.name;
  return { id: st.root.name, title, keys: "actions", tree, actions: actions(st) };
}
