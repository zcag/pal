// ipuz (ipuz.org, v1 and v2), the format Crosshare's /api/ipuz/<id> answers,
// read into a `Puzzle`. The parts a crossword needs: the dimensions, the
// solution (a letter, `{ value }`, or the block and empty markers the file
// names), the circles and bars from each cell's style, the clues in any of
// the spec's shapes (`{ number, clue }`, `[number, clue]`, "number clue"),
// the title, author, copyright and notes. Pure, so the host tests read
// hand-written files.
import type { Puzzle } from "./game.ts";

type Style = { shapebg?: string; barred?: string; hidden?: boolean } | string | undefined;
type Cell = number | string | null | { cell?: number | string; value?: string; style?: Style };
type Clue = { number?: number | string; clue?: string } | [number | string, string] | string;
export type Ipuz = {
  version?: string;
  kind?: string[];
  title?: string;
  author?: string;
  copyright?: string;
  notes?: string;
  block?: string;
  empty?: string | number;
  dimensions?: { width?: number; height?: number };
  puzzle?: Cell[][];
  solution?: Cell[][];
  clues?: Record<string, Clue[]>;
};

// A title, author or clue can carry markup (`<i>`, `&amp;`): plain text on the page.
const plain = (s: unknown) =>
  String(s ?? "").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

/** Crosshare adds "Created on crosshare.org" (or "... - Published by X on crosshare.org") to every file: what is left is the constructor's own note. */
function noteOf(notes: unknown): string | undefined {
  const n = plain(notes).replace(/\s*-?\s*(Created on crosshare\.org|Published by .* on crosshare\.org)\s*$/i, "").trim();
  return n || undefined;
}

function clueOf(c: Clue): [number, string] | undefined {
  if (Array.isArray(c)) return [Number(c[0]), plain(c[1])];
  if (typeof c === "string") { const m = /^\s*(\d+)\s*[.:)]?\s+(.*)$/s.exec(c); return m ? [Number(m[1]), plain(m[2])] : undefined; }
  if (c && typeof c === "object") return [Number(c.number), plain(c.clue)];
  return undefined;
}

function cluesOf(list: Clue[] | undefined): Record<number, string> {
  const out: Record<number, string> = {};
  for (const c of list ?? []) { const got = clueOf(c); if (got && Number.isFinite(got[0])) out[got[0]] = got[1]; }
  return out;
}

/** An ipuz object (parsed JSON) as a puzzle; throws on anything that is not a crossword it can play. */
export function fromIpuz(j: Ipuz, id: string): Puzzle {
  if (j.kind && !j.kind.some((k) => /crossword/i.test(k))) throw new Error("not a crossword");
  const w = Number(j.dimensions?.width), h = Number(j.dimensions?.height);
  if (!(w > 0 && h > 0 && w <= 30 && h <= 30)) throw new Error("no dimensions");
  const block = j.block ?? "#", blank = String(j.empty ?? 0);
  const sol = j.solution, grid = j.puzzle;
  if (!Array.isArray(sol) || sol.length !== h) throw new Error("no solution");
  const solution: string[] = [], circles: number[] = [], right: number[] = [], below: number[] = [];
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
    const i = r * w + c;
    const s = sol[r]?.[c], p = grid?.[r]?.[c];
    const style = p && typeof p === "object" ? p.style : undefined;
    const val = s && typeof s === "object" ? s.value : s;
    const isBlock = val === null || val === undefined || String(val) === block || p === null || String(p) === block || (typeof style === "object" && style?.hidden);
    const letter = isBlock ? "" : String(val).toUpperCase().trim();
    if (!isBlock && (!letter || letter === blank)) throw new Error("the solution has a gap");
    solution.push(letter);
    if (typeof style === "object" && style) {
      if (style.shapebg === "circle") circles.push(i);
      if (style.barred?.includes("R") && c < w - 1) right.push(i);
      if (style.barred?.includes("B") && r < h - 1) below.push(i);
      // A bar on a cell's left or top is its neighbour's right or bottom.
      if (style.barred?.includes("L") && c > 0) right.push(i - 1);
      if (style.barred?.includes("T") && r > 0) below.push(i - w);
    }
  }
  const lists = Object.entries(j.clues ?? {});
  const pick = (dir: string) => lists.find(([k]) => k.split(":")[0].trim().toLowerCase() === dir)?.[1];
  const p: Puzzle = {
    id,
    title: plain(j.title) || "Untitled",
    author: plain(j.author),
    w, h, solution,
    clues: { across: cluesOf(pick("across")), down: cluesOf(pick("down")) },
  };
  const note = noteOf(j.notes), copyright = plain(j.copyright);
  if (note) p.note = note;
  if (copyright) p.copyright = copyright;
  if (circles.length) p.circles = circles;
  if (right.length || below.length) p.bars = { right: [...new Set(right)], below: [...new Set(below)] };
  return p;
}
