// The diff as a view tree, pure: a header (the two sides with what they
// are and when they were copied, the +added / −removed badges), a keycap
// line, then the lines on a sunken surface: unified (one column, a sign
// per line) or side by side (a cell per side), the changed lines on a
// green or red tint, the words that differ on a stronger one, line
// numbers in the gutter, long unchanged runs folded to one row a click or
// `space` expands. The tints are hex surfaces at an alpha under a half,
// so the panel keeps its own ink in both themes.
import { column, keyHint, row, text, type Action, type View, type ViewNode } from "@zcag/pal";
import { compute, fold, sideBySide, summary, type Block, type Line, type Result, type SideRow, type Span } from "./diff.ts";

/** One side of the diff as drawn: the text, a short name and a line under it (when it was copied, which app, the file's folder). */
export type Side = { text: string; label: string; sub?: string };

export type State = {
  /** The `View.id`; a pick from the view finds its state by it. */
  id: string;
  left: Side;
  right: Side;
  /** Side by side rather than unified. */
  side: boolean;
  /** Ignore whitespace. */
  ws: boolean;
  /** The folds written out, by index. */
  expanded: number[];
  /** The fold the keys are on (`tab` moves it), -1 for none. */
  cursor: number;
  /** The external tool's name for the Open action's title; none when no tool is installed. */
  tool?: string;
};

/** A view with nothing to diff yet: why, and what to do. */
export type Empty = { id: string; title: string; reason: string; tool?: string };

/** The tints (GitHub's diff green and red at a fifth, the words at twice that): under 0.5 alpha, so the panel's ink stays. */
export const TINT = { add: "#3fb95033", del: "#f8514933", addWord: "#3fb95066", delWord: "#f8514966" } as const;
/** Nodes the lines may take (the host refuses a tree past `MAX_NODES`, 2000; the header and the chrome take a few dozen); the rest of the lines is a note, the clipboard gets the whole diff. */
export const NODE_BUDGET = 1800;
/** Word spans are drawn only on a line that fits the column: a long line split into spans wraps piece by piece and stops reading as one line. */
const SPAN_MAX = { unified: 88, side: 40 } as const;
const GUTTER_W = 30;
const SIGN_W = 12;
/** A side-by-side cell's text is at least this wide, so the two halves come out even whatever the lines hold. */
const CELL_MIN = 250;

/** `View.id` is `diff:<n>`: one state per open level, so a diff pushed over another keeps its own toggles. */
export const VIEW_ID_PREFIX = "diff:";

const SOURCES: Action[] = [
  { id: "newest", title: "Diff the two newest copies", shortcut: "n" },
  { id: "selection", title: "Clipboard vs selection", shortcut: "e" },
  { id: "history", title: "Pick two from history…", shortcut: "h" },
  { id: "files", title: "Two files…", shortcut: "f" },
];

/** The actions of a diff view, in the footer's order: Enter copies, cmd+Enter opens the tool; the rest are bare keys. `drawn` are the folds a click can expand. */
export function actions(s: { tool?: string; side: boolean; ws: boolean; folds: number }, drawn: number[]): Action[] {
  const folds: Action[] = s.folds
    ? [
        { id: "expand", title: "Expand the fold under the cursor", shortcut: "space" },
        { id: "next", title: "Next fold", shortcut: "tab" },
        { id: "prev", title: "Previous fold", shortcut: "shift+tab" },
        { id: "expand-all", title: "Expand every fold", shortcut: "a" },
        ...drawn.map((i): Action => ({ id: `expand:${i}`, title: `Expand fold ${i + 1}`, hidden: true })),
      ]
    : [];
  return [
    { id: "copy", title: "Copy unified diff" },
    { id: "open", title: s.tool ? `Open in ${s.tool}` : "Open in external tool", shortcut: "o" },
    { id: "side", title: s.side ? "Unified" : "Side by side", shortcut: "s" },
    { id: "ws", title: s.ws ? "Mind whitespace" : "Ignore whitespace", shortcut: "w" },
    { id: "swap", title: "Swap sides", shortcut: "x" },
    { id: "copy-left", title: "Copy left text", shortcut: "l" },
    { id: "copy-right", title: "Copy right text", shortcut: "r" },
    ...folds,
    ...SOURCES,
  ];
}

const lineCount = (t: string) => (t ? t.split("\n").length : 0);

/** The two sides as two rows: the sign in its colour, the name, then what it is. */
function sideRow(sign: "−" | "+", s: Side, key: string): ViewNode {
  const n = lineCount(s.text);
  return row(
    [
      text(sign, { style: "mono", weight: "semibold", color: sign === "+" ? "success" : "destructive", width: SIGN_W }),
      text(s.label, { weight: "medium", size: "sm" }),
      text(`${n} ${n === 1 ? "line" : "lines"}${s.sub ? ` · ${s.sub}` : ""}`, { style: "muted", size: "xs" }),
    ],
    { key, gap: 2 },
  );
}

function header(s: State, r: Result): ViewNode {
  const badge = (t: string, color: "green" | "red" | "amber" | "grey"): ViewNode => ({ type: "badge", text: t, color });
  const badges: ViewNode[] = r.identical ? [badge("no differences", "green")] : [...(r.added ? [badge(`+${r.added}`, "green")] : []), ...(r.removed ? [badge(`−${r.removed}`, "red")] : []), ...(r.wsOnly ? [badge("whitespace only", "amber")] : [])];
  if (s.ws) badges.push(badge("whitespace ignored", "grey"));
  return column([row([sideRow("−", s.left, "left"), { type: "spacer" }, ...badges], { key: "l", gap: 1 }), sideRow("+", s.right, "right")], { key: "head", gap: 1 });
}

function hints(s: State, folds: number): ViewNode {
  return row(
    [
      ...keyHint("s", s.side ? "unified" : "side by side"),
      ...keyHint("w", s.ws ? "mind whitespace" : "ignore whitespace"),
      ...keyHint("x", "swap"),
      ...(folds ? keyHint("space", "expand") : []),
      ...keyHint("o", s.tool ?? "tool"),
      ...keyHint("h", "history"),
    ],
    { key: "keys", gap: 1 },
  );
}

const gutter = (n: number | undefined, color?: "success" | "destructive"): ViewNode => text(n === undefined ? "" : String(n), { style: "mono", size: "xs", color: color ?? "faint", width: GUTTER_W, align: "end" });
const mono = (t: string, extra: Record<string, unknown> = {}): ViewNode => text(t || " ", { style: "mono", ...extra });

/** The line's text: one mono run, or its spans with the changed words on the stronger tint (square, a highlighter's mark). */
function body(line: Line, max: number): ViewNode {
  if (!line.spans || line.text.length > max) return mono(line.text);
  const tint = line.kind === "add" ? TINT.addWord : TINT.delWord;
  // Neighbouring spans of one kind read as one; a changed run gets its own tinted box.
  const merged: Span[] = [];
  for (const sp of line.spans) {
    const last = merged[merged.length - 1];
    if (last && last.changed === sp.changed) last.text += sp.text;
    else merged.push({ ...sp });
  }
  return row(merged.map((sp) => (sp.changed ? { type: "stack", direction: "row", surface: tint, children: [mono(sp.text)] } : mono(sp.text))), { gap: 0, align: "start" });
}

const SIGN = { same: " ", add: "+", del: "−" } as const;
const sideColor = (k: Line["kind"]) => (k === "add" ? "success" : k === "del" ? "destructive" : undefined);

/** A unified line: both gutters, the sign, the text; a whitespace-only pair says so at the end. */
function unifiedLine(line: Line, i: number): ViewNode {
  const c = sideColor(line.kind);
  return row([gutter(line.l, c), gutter(line.r, c), text(SIGN[line.kind], { style: "mono", color: c, width: SIGN_W }), body(line, SPAN_MAX.unified), ...(line.ws ? [{ type: "spacer" } as ViewNode, { type: "badge", text: "whitespace", color: "amber" } as ViewNode] : [])], { key: `u${i}`, gap: 1, align: "start" });
}

/** One side-by-side cell: the gutter and the text, on the side's tint when changed; an empty cell where the other side has a line alone. */
function cell(line: Line | undefined, key: string): ViewNode {
  const b = line ? body(line, SPAN_MAX.side) : mono(" ");
  // The cell's least width, so the halves come out even: on the text itself, or on an empty run under a spans row (no height, the width alone).
  if (b.type === "text") b.minWidth = CELL_MIN;
  const c = line && sideColor(line.kind);
  const inner = row([gutter(line && (line.kind === "add" ? line.r : line.l), c), b], { gap: 1, align: "start" });
  const children = b.type === "text" ? [inner] : [inner, text("", { minWidth: GUTTER_W + 4 + CELL_MIN })];
  return { type: "stack", direction: "column", key, grow: true, gap: 0, ...(line && line.kind !== "same" && { surface: TINT[line.kind], radius: true }), children };
}

const foldLabel = (count: number) => `${count} unchanged ${count === 1 ? "line" : "lines"}`;

/** A fold: one row that a click (or `space` with the cursor on it) expands. */
function foldRow(f: { index: number; count: number }, selected: boolean, i: number): ViewNode {
  return row([text("⋯", { style: "mono", color: "faint", width: GUTTER_W, align: "end" }), text(foldLabel(f.count), { style: "muted", size: "xs" }), ...(selected ? keyHint("space", "expand") : [])], { key: `f${i}`, gap: 2, padding: 1, action: `expand:${f.index}`, ...(selected && { selected: true }) });
}

type Body = { nodes: ViewNode[]; /** Lines past the budget, not drawn. */ cut: number; /** The folds drawn, by index. */ drawn: number[] };
const rest = (blocks: (Block | SideRow)[]) => blocks.reduce((n, b) => n + (b.kind === "fold" ? b.count : 1), 0);
/** Nodes in a subtree, what the budget counts. */
export const size = (n: ViewNode): number => 1 + (n.type === "stack" ? n.children.reduce((s, c) => s + size(c), 0) : 0);

function unifiedBody(blocks: Block[], cursor: number): Body {
  const nodes: ViewNode[] = [], drawn: number[] = [];
  let used = 0, i = 0;
  const take = (node: ViewNode): boolean => { used += size(node); return used <= NODE_BUDGET; };
  // Consecutive lines of one kind share a tinted block, so a change reads as one rather than a stack of stripes.
  while (i < blocks.length && used < NODE_BUDGET) {
    const b = blocks[i];
    if (b.kind === "fold") { const f = foldRow(b, b.index === cursor, i); if (!take(f)) break; nodes.push(f); drawn.push(b.index); i++; continue; }
    const kind = b.kind;
    const run: ViewNode[] = [];
    while (i < blocks.length && blocks[i].kind === kind) { const l = unifiedLine(blocks[i] as Line, i); if (!take(l)) break; run.push(l); i++; }
    if (run.length) nodes.push(kind === "same" ? column(run, { key: `b${i}`, gap: 0 }) : { type: "stack", direction: "column", key: `b${i}`, gap: 0, surface: TINT[kind], radius: true, children: run });
    if (used > NODE_BUDGET) break;
  }
  return { nodes, cut: rest(blocks.slice(i)), drawn };
}

function sideBody(rows: SideRow[], cursor: number): Body {
  const nodes: ViewNode[] = [], drawn: number[] = [];
  let used = 0, i = 0;
  for (; i < rows.length; i++) {
    const r = rows[i];
    const node = r.kind === "fold" ? foldRow(r, r.index === cursor, i) : row([cell(r.left, `l${i}`), { type: "divider" }, cell(r.right, `r${i}`)], { key: `p${i}`, gap: 1, align: "stretch" });
    used += size(node);
    if (used > NODE_BUDGET) break;
    nodes.push(node);
    if (r.kind === "fold") drawn.push(r.index);
  }
  return { nodes, cut: rest(rows.slice(i)), drawn };
}

/** How many folds a result has: what the cursor moves over. */
export const foldCount = (r: Result): number => fold(r.lines).filter((b) => b.kind === "fold").length;

/** The whole view for a state: the diff computed here, so a toggle is a new tree from the same two texts. */
export function render(s: State): View {
  const r = compute(s.left.text, s.right.text, { ignoreWhitespace: s.ws });
  const blocks = fold(r.lines, s.expanded);
  const folds = foldCount(r);
  const { nodes, cut, drawn } = s.side ? sideBody(sideBySide(blocks), s.cursor) : unifiedBody(blocks, s.cursor);
  if (cut) nodes.push(row([text(`… ${cut} more ${cut === 1 ? "line" : "lines"}: Copy unified diff has them all`, { style: "muted", size: "xs" })], { key: "cut", padding: 1 }));
  if (r.identical) nodes.push(row([text(s.ws ? "The two texts differ in whitespace at most" : "The two texts are the same", { style: "muted", size: "sm" })], { key: "same", padding: 1 }));
  return {
    id: s.id,
    title: `Diff · ${summary(r)}`,
    keys: "actions",
    actions: actions({ tool: s.tool, side: s.side, ws: s.ws, folds }, drawn),
    tree: column([header(s, r), hints(s, folds), { type: "stack", direction: "column", key: "body", gap: 0, padding: 2, surface: "sunken", radius: true, grow: true, children: nodes }], { padding: 3, gap: 2 }),
  };
}

/** The view when there is nothing to diff: the reason, and the ways to get two texts. */
export function renderEmpty(e: Empty): View {
  return {
    id: e.id,
    title: e.title,
    keys: "actions",
    actions: [...SOURCES, { id: "copy", title: "Copy unified diff", hidden: true, shortcut: "c" }],
    tree: column(
      [
        { type: "stack", direction: "column", key: "empty", gap: 2, padding: 4, surface: "sunken", radius: true, align: "center", children: [text("\u{f08aa}", { style: "glyph", size: "xl", color: "faint" }), text(e.reason, { style: "muted", size: "sm", align: "center" })] },
        row([...keyHint("n", "two newest copies"), ...keyHint("e", "clipboard vs selection"), ...keyHint("h", "history"), ...keyHint("f", "files")], { key: "keys", gap: 1, justify: "center" }),
      ],
      { padding: 3, gap: 3 },
    ),
  };
}
