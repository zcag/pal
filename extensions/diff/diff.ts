// The diff itself, pure: two texts in, a line list out (jsdiff's line
// diff, one entry per line with both line numbers), the intra-line word
// spans on a removed/added pair that changed a little, the whitespace-only
// mark, the folds over long unchanged runs, the side-by-side pairing and
// the unified text for the clipboard. `view.ts` draws what this answers.
import { diffLines, diffWordsWithSpace, formatPatch, structuredPatch } from "diff";

export type LineKind = "same" | "add" | "del";
/** One piece of a line: `changed` runs are the words that differ from the line paired with it. */
export type Span = { text: string; changed: boolean };
/** One line of the diff with its number on each side (`l` on the left, `r` on the right; a removed line has no `r`, an added one no `l`). */
export type Line = { kind: LineKind; text: string; l?: number; r?: number; /** Word-level highlights, on a changed line paired with its counterpart. */ spans?: Span[]; /** The pair differs in whitespace only. */ ws?: boolean };
/** A run of unchanged lines folded away: `index` is the fold's number (what an expand names), `from` the first line's index in `lines`, `count` how many. */
export type Fold = { kind: "fold"; index: number; from: number; count: number };
export type Block = Line | Fold;
/** A side-by-side row: a fold across both sides, or a line per side (one side empty where a line was only removed or only added). */
export type SideRow = Fold | { kind: "pair"; left?: Line; right?: Line };

export type Options = { ignoreWhitespace?: boolean };
export type Result = { lines: Line[]; added: number; removed: number; /** Every change is whitespace only (and there is at least one). */ wsOnly: boolean; identical: boolean };

/** Unchanged lines kept around a change; a longer run folds. */
export const CONTEXT = 3;
/** Past this share of a line's characters changed, the pair reads as two different lines and gets no word spans. */
const SPAN_RATIO = 0.6;

const noWs = (s: string) => s.replace(/\s+/g, "");
/** jsdiff's line tokens keep their newline; the last line of a text without one does not. */
const chomp = (s: string) => (s.endsWith("\n") ? s.slice(0, -1) : s);
/**
 * Ignore whitespace as `diff -w` does: two lines are the same once every
 * space, tab and newline is out (indentation, a run of spaces, a missing
 * newline at the end). jsdiff's own `ignoreWhitespace` only trims the
 * ends; a `comparator` decides equality in its place (the base class
 * honours one for every diff; the line typings do not list it).
 */
const lineOptions = (opts: Options) => (opts.ignoreWhitespace ? { comparator: (a: string, b: string) => noWs(a) === noWs(b) } : {});

/** The word spans of a removed/added pair, or nothing when the two share too little. */
export function wordSpans(a: string, b: string): { del: Span[]; add: Span[] } | undefined {
  const parts = diffWordsWithSpace(a, b);
  let changed = 0;
  for (const p of parts) if (p.added || p.removed) changed += p.value.length;
  if (changed > SPAN_RATIO * Math.max(a.length, b.length, 1)) return;
  const del = parts.filter((p) => !p.added).map((p) => ({ text: p.value, changed: !!p.removed }));
  const add = parts.filter((p) => !p.removed).map((p) => ({ text: p.value, changed: !!p.added }));
  return { del, add };
}

/**
 * The line diff: every line of both texts once, in order, numbered on its
 * side; a run of removed lines followed by added ones is paired line by
 * line for the word spans and the whitespace-only mark. `ignoreWhitespace`
 * is `diff -w`: whitespace does not count anywhere in a line (a common
 * line then reads as the right side wrote it).
 */
export function compute(left: string, right: string, opts: Options = {}): Result {
  const lines: Line[] = [];
  let l = 1, r = 1, added = 0, removed = 0;
  for (const c of diffLines(left, right, { oneChangePerToken: true, ...lineOptions(opts) })) {
    const text = chomp(c.value);
    if (c.added) { lines.push({ kind: "add", text, r: r++ }); added++; }
    else if (c.removed) { lines.push({ kind: "del", text, l: l++ }); removed++; }
    else lines.push({ kind: "same", text, l: l++, r: r++ });
  }
  // Pair each removed run with the added run right after it.
  let wsChanges = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].kind !== "del") continue;
    let j = i;
    while (j < lines.length && lines[j].kind === "del") j++;
    let k = j;
    while (k < lines.length && lines[k].kind === "add") k++;
    for (let d = i, a = j; d < j && a < k; d++, a++) {
      const del = lines[d], add = lines[a];
      if (noWs(del.text) === noWs(add.text)) { del.ws = add.ws = true; wsChanges++; }
      const spans = wordSpans(del.text, add.text);
      if (spans) { del.spans = spans.del; add.spans = spans.add; }
    }
    i = k - 1;
  }
  const changes = added + removed;
  return { lines, added, removed, wsOnly: changes > 0 && wsChanges * 2 === changes, identical: changes === 0 };
}

/**
 * The lines with every long unchanged run folded to a `Fold`, `context`
 * lines kept on each side of a change (only after it at the top, only
 * before it at the bottom); the folds numbered in order, and those in
 * `expanded` written out.
 */
export function fold(lines: Line[], expanded: Iterable<number> = [], context = CONTEXT): Block[] {
  const open = new Set(expanded);
  const out: Block[] = [];
  let index = 0;
  let i = 0;
  while (i < lines.length) {
    if (lines[i].kind !== "same") { out.push(lines[i++]); continue; }
    let j = i;
    while (j < lines.length && lines[j].kind === "same") j++;
    const atStart = i === 0, atEnd = j === lines.length;
    const keepBefore = atStart ? 0 : context, keepAfter = atEnd ? 0 : context;
    const run = j - i;
    // A fold of under three lines saves no reading for the row it takes.
    if (run - keepBefore - keepAfter < 3) { for (; i < j; i++) out.push(lines[i]); continue; }
    for (let n = 0; n < keepBefore; n++) out.push(lines[i + n]);
    const from = i + keepBefore, count = run - keepBefore - keepAfter;
    if (open.has(index)) for (let n = 0; n < count; n++) out.push(lines[from + n]);
    else out.push({ kind: "fold", index, from, count });
    index++;
    for (let n = j - keepAfter; n < j; n++) out.push(lines[n]);
    i = j;
  }
  return out;
}

/** The blocks as side-by-side rows: unchanged lines on both sides, a removed run beside the added run that follows it, line by line. */
export function sideBySide(blocks: Block[]): SideRow[] {
  const out: SideRow[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.kind === "fold") { out.push(b); continue; }
    if (b.kind === "same") { out.push({ kind: "pair", left: b, right: b }); continue; }
    const dels: Line[] = [], adds: Line[] = [];
    let j = i;
    while (j < blocks.length && blocks[j].kind === "del") dels.push(blocks[j++] as Line);
    while (j < blocks.length && blocks[j].kind === "add") adds.push(blocks[j++] as Line);
    for (let n = 0; n < Math.max(dels.length, adds.length); n++) out.push({ kind: "pair", left: dels[n], right: adds[n] });
    i = j - 1;
  }
  return out;
}

/** The unified diff as text (`--- left`, `+++ right`, the hunks), the way `diff -u` writes it. */
export function unified(left: string, right: string, leftName: string, rightName: string, opts: Options = {}): string {
  const patch = structuredPatch(leftName, rightName, left, right, undefined, undefined, { context: CONTEXT, ...lineOptions(opts) });
  return formatPatch(patch, { includeIndex: false, includeUnderline: false, includeFileHeaders: true });
}

/** `+12 −4` for a subtitle or a HUD line; `no differences` when there are none. */
export const summary = (r: Result): string => (r.identical ? "no differences" : `+${r.added} −${r.removed}${r.wsOnly ? ", whitespace only" : ""}`);
