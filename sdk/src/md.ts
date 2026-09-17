// Markdown to the view tree: what a page of markdown (tela's, Obsidian's,
// a README) draws as inside the panel, with the tokens and never HTML. Headings, paragraphs,
// lists (nested, tasks), callouts (`> [!NOTE]`) as tinted cards, quotes and
// tela's `:::quote`, code blocks mono on a sunken well, tables as aligned
// text rows, `<details>` as a titled section, `:::tabs` as headed
// sections, links collected under the paragraph they sit in. The view's
// `text` node is one run, so bold, italic and code inside a paragraph are
// flattened to their text; a paragraph that is one such run keeps the
// weight or the mono. `outline` and `plain` read the same blocks.
import type { ViewNode } from "./protocol.ts";

export type Link = { label: string; href?: string; page?: string };
export type Block =
  | { kind: "heading"; level: number; text: string; links: Link[] }
  | { kind: "paragraph"; text: string; links: Link[]; run?: "bold" | "italic" | "code" }
  | { kind: "code"; lang: string; text: string }
  | { kind: "list"; ordered: boolean; start: number; items: ListItem[] }
  | { kind: "quote"; blocks: Block[]; cite?: string }
  | { kind: "callout"; type: string; title?: string; blocks: Block[] }
  | { kind: "details"; summary: string; blocks: Block[] }
  | { kind: "table"; header: string[]; align: ("start" | "center" | "end")[]; rows: string[][] }
  | { kind: "image"; alt: string; src: string }
  | { kind: "rule" };
export type ListItem = { text: string; links: Link[]; task?: boolean; done?: boolean; children: Block[] };

/** The tag colour and the label a callout type takes; unknown types are NOTE's. */
export const CALLOUT: Record<string, { color: "blue" | "green" | "violet" | "amber" | "red"; label: string }> = {
  NOTE: { color: "blue", label: "Note" }, TIP: { color: "green", label: "Tip" }, IMPORTANT: { color: "violet", label: "Important" }, WARNING: { color: "amber", label: "Warning" }, CAUTION: { color: "red", label: "Caution" },
};
/** Nodes a render may take before it stops with a "the rest is in <where>" line; well under the host's 2000. */
export const MAX_RENDER_NODES = 1200;
/** Lines of one code block kept; the rest is counted. */
export const MAX_CODE_LINES = 40;
/** Rows of one table kept. */
export const MAX_TABLE_ROWS = 30;

// ---- front matter -----------------------------------------------------------

/** A leading `---` block: its keys as strings and the body after it (a Slidev deck's headmatter counts too). */
export function frontmatter(md: string): { meta: Record<string, string>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(md);
  if (!m) return { meta: {}, body: md };
  const meta: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([\w-]+):\s*(.*)$/.exec(line);
    if (kv) meta[kv[1]] = kv[2].replace(/^["']|["']$/g, "");
  }
  return { meta, body: md.slice(m[0].length) };
}

// ---- inline -----------------------------------------------------------------

const AUTOLINK = /<(https?:\/\/[^>\s]+)>/g;
const MD_LINK = /!?\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const WIKI = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
const HTML_TAG = /<\/?[a-zA-Z][^>]*>/g;

/** Inline markup reduced to text, the links collected; `run` says the whole text was one bold, italic or code run. */
export function inline(src: string): { text: string; links: Link[]; run?: "bold" | "italic" | "code" } {
  const links: Link[] = [];
  // A backslash-escaped mark is set aside before any pattern can see it, and put back at the end.
  let s = src.trim().replace(/\\([\\`*_{}\[\]()#+\-.!|<>~])/g, (_, c: string) => `\u0000${c.charCodeAt(0).toString(16).padStart(2, "0")}`);
  let run: "bold" | "italic" | "code" | undefined;
  const whole = (re: RegExp, r: "bold" | "italic" | "code") => { const m = re.exec(s); if (m && m[0] === s) { run = r; s = m[1]; } };
  whole(/^\*\*([^*]+)\*\*$/, "bold");
  whole(/^__([^_]+)__$/, "bold");
  whole(/^`([^`]+)`$/, "code");
  whole(/^\*([^*]+)\*$/, "italic");
  whole(/^_([^_]+)_$/, "italic");
  s = s.replace(WIKI, (_, page: string, label?: string) => { links.push({ label: (label ?? page).trim(), page: page.trim() }); return (label ?? page).trim(); });
  s = s.replace(MD_LINK, (m, label: string, href: string) => { if (m.startsWith("!")) { links.push({ label: label || "image", href }); return label ? `[image: ${label}]` : "[image]"; } links.push({ label: label || href, href }); return label || href; });
  s = s.replace(AUTOLINK, (_, href: string) => { links.push({ label: href, href }); return href; });
  s = s.replace(/`([^`]+)`/g, "$1").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/__([^_]+)__/g, "$1").replace(/(^|[^\w*])\*([^*\n]+)\*(?=[^\w*]|$)/g, "$1$2").replace(/(^|[^\w_])_([^_\n]+)_(?=[^\w_]|$)/g, "$1$2").replace(/~~([^~]+)~~/g, "$1");
  s = s.replace(/<br\s*\/?>/gi, "\n").replace(HTML_TAG, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  s = s.replace(/\u0000([0-9a-f]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
  return { text: s, links, run };
}

// ---- blocks -----------------------------------------------------------------

const FENCE = /^(`{3,}|~{3,})\s*(\S*)/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^(?:-{3,}|\*{3,}|_{3,})\s*$/;
const LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const TASK = /^\[( |x|X)\]\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;
const DIRECTIVE = /^:::(\w+)(?:\{([^}]*)\})?\s*$/;
const CALLOUT_HEAD = /^\[!(\w+)\]\s*(.*)$/;

const stripQuote = (l: string) => l.replace(/^\s*>\s?/, "");
const cells = (l: string) => { let s = l.trim(); if (s.startsWith("|")) s = s.slice(1); if (s.endsWith("|")) s = s.slice(0, -1); return s.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, "|").trim()); };

/** The blocks of a markdown body (front matter already off). */
export function parseBlocks(md: string): Block[] {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out: Block[] = [];
  let i = 0;
  const para: string[] = [];
  const flush = () => {
    if (!para.length) return;
    // Soft breaks join with a space; a line ending in two spaces or a backslash is a hard break.
    const { text, links, run } = inline(para.map((l, i) => (i < para.length - 1 && /(  |\\)$/.test(l) ? l.replace(/(  |\\)$/, "\n") : i < para.length - 1 ? l + " " : l)).join(""));
    para.length = 0;
    if (text.trim()) out.push({ kind: "paragraph", text, links, run });
  };
  while (i < lines.length) {
    const line = lines[i];
    let m: RegExpExecArray | null;
    if (!line.trim()) { flush(); i++; continue; }
    if ((m = FENCE.exec(line))) {
      flush();
      const fence = m[1], lang = m[2].toLowerCase();
      const body: string[] = [];
      i++;
      while (i < lines.length && !(lines[i].startsWith(fence) && !lines[i].slice(fence.length).trim())) body.push(lines[i++]);
      i++;
      out.push({ kind: "code", lang, text: body.join("\n") });
      continue;
    }
    if ((m = HEADING.exec(line))) { flush(); const { text, links } = inline(m[2]); out.push({ kind: "heading", level: m[1].length, text, links }); i++; continue; }
    if (RULE.test(line) && !para.length) { out.push({ kind: "rule" }); i++; continue; }
    if (/^\s*>/.test(line)) {
      flush();
      const body: string[] = [];
      while (i < lines.length && (/^\s*>/.test(lines[i]) || (lines[i].trim() && body.length && !LIST.test(lines[i]) && !HEADING.test(lines[i])))) body.push(stripQuote(lines[i++]));
      const head = CALLOUT_HEAD.exec(body[0] ?? "");
      if (head) out.push({ kind: "callout", type: head[1].toUpperCase(), title: head[2].trim() || undefined, blocks: parseBlocks(body.slice(1).join("\n")) });
      else out.push({ kind: "quote", blocks: parseBlocks(body.join("\n")) });
      continue;
    }
    if ((m = DIRECTIVE.exec(line))) {
      flush();
      const name = m[1].toLowerCase(), attrs = m[2] ?? "";
      const body: string[] = [];
      i++;
      let depth = 1;
      while (i < lines.length) { const l = lines[i++]; if (DIRECTIVE.test(l)) depth++; else if (/^:::\s*$/.test(l)) { if (--depth === 0) break; } body.push(l); }
      const inner = parseBlocks(body.join("\n"));
      if (name === "quote") out.push({ kind: "quote", blocks: inner, cite: /cite="([^"]*)"/.exec(attrs)?.[1] });
      else out.push(...inner);
      continue;
    }
    if (/^\s*<details/i.test(line)) {
      flush();
      const body: string[] = [];
      let summary = "";
      while (i < lines.length && !/<\/details>/i.test(lines[i])) { const l = lines[i++]; const s = /<summary>(.*?)<\/summary>/i.exec(l); if (s) summary = inline(s[1]).text; else body.push(l.replace(/<details[^>]*>/i, "")); }
      i++;
      out.push({ kind: "details", summary: summary || "Details", blocks: parseBlocks(body.join("\n")) });
      continue;
    }
    // A bullet or a `1.` may interrupt a paragraph, as in CommonMark; another number is a line of it.
    if ((m = LIST.exec(line)) && (!para.length || /^[-*+]$/.test(m[2]) || /^1[.)]$/.test(m[2]))) {
      flush();
      const items: ListItem[] = [];
      const base = m[1].length, ordered = /\d/.test(m[2]), start = ordered ? parseInt(m[2], 10) || 1 : 1;
      while (i < lines.length) {
        const lm = LIST.exec(lines[i]);
        if (!lm || lm[1].length !== base) { if (lm && lm[1].length < base) break; if (!lm && !lines[i].trim()) { if (i + 1 < lines.length && (LIST.exec(lines[i + 1])?.[1].length ?? -1) >= base) { i++; continue; } break; } if (!lm && lines[i].trim() && !/^\s/.test(lines[i])) break; }
        if (lm && lm[1].length === base) {
          if (/\d/.test(lm[2]) !== ordered) break;
          const text: string[] = [lm[3]];
          const nested: string[] = [];
          i++;
          while (i < lines.length) {
            const nm = LIST.exec(lines[i]);
            if (nm && nm[1].length === base) break;
            if (!lines[i].trim()) { if (i + 1 < lines.length && (LIST.exec(lines[i + 1])?.[1].length ?? -1) > base) { nested.push(""); i++; continue; } break; }
            if (nm && nm[1].length > base) { nested.push(lines[i++]); continue; }
            if (/^\s/.test(lines[i]) && !nm) { (nested.length ? nested : text).push(lines[i++].trim()); continue; }
            if (nm && nm[1].length < base) break;
            text.push(lines[i++].trim());
          }
          const task = TASK.exec(text[0]);
          const { text: t, links } = inline((task ? [task[2], ...text.slice(1)] : text).join(" "));
          const indent = nested.find((l) => l.trim())?.match(/^\s*/)?.[0].length ?? 0;
          items.push({ text: t, links, ...(task ? { task: true, done: task[1] !== " " } : {}), children: nested.length ? parseBlocks(nested.map((l) => l.slice(Math.min(indent, l.length - l.trimStart().length))).join("\n")) : [] });
        } else break;
      }
      out.push({ kind: "list", ordered, start, items });
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]) && !para.length) {
      const header = cells(line).map((c) => inline(c).text);
      const align = cells(lines[i + 1]).map((c) => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "end" : "start") as "start" | "center" | "end");
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(cells(lines[i++]).map((c) => inline(c).text));
      out.push({ kind: "table", header, align, rows });
      continue;
    }
    if ((m = /^!\[([^\]]*)\]\(([^)\s]+)[^)]*\)\s*$/.exec(line)) && !para.length) { out.push({ kind: "image", alt: m[1], src: m[2] }); i++; continue; }
    if ((m = /^<img[^>]*alt="([^"]*)"[^>]*>|^<img[^>]*>/i.exec(line)) && !para.length) { out.push({ kind: "image", alt: m[1] ?? "", src: /src="([^"]*)"/i.exec(line)?.[1] ?? "" }); i++; continue; }
    if (/^<!--/.test(line)) { while (i < lines.length && !/-->/.test(lines[i])) i++; i++; continue; }
    if (/^<\/?(div|p|span|section|br|hr|iframe|video|audio|figure)[\s>\/]/i.test(line) && !inline(line).text.trim()) { i++; continue; }
    para.push(line);
    i++;
  }
  flush();
  return out;
}

// ---- the tree -------------------------------------------------------------

type Text = Extract<ViewNode, { type: "text" }>;
const text = (value: string, more: Partial<Omit<Text, "type" | "value">> = {}): ViewNode => ({ type: "text", value, ...more });
const stack = (children: ViewNode[], more: Partial<Extract<ViewNode, { type: "stack" }>> = {}): ViewNode => ({ type: "stack", children, ...more });

const HEADING_SIZE: Record<number, Text["size"]> = { 1: "xl", 2: "lg", 3: "md", 4: "sm", 5: "sm", 6: "xs" };

/** One wrapping run under the block that carries the links: an arrow and the label per link. */
const linkLine = (links: Link[]): ViewNode | undefined => (links.length ? text(links.map((l) => `↗ ${l.label}`).join("   "), { style: "muted", size: "xs" }) : undefined);

/** A run of `text` nodes for a table row: each column its width, header semibold. */
function tableRows(t: Extract<Block, { kind: "table" }>, width: number): ViewNode[] {
  const cols = t.header.length;
  const chars = t.header.map((h, c) => Math.max(h.length, ...t.rows.slice(0, MAX_TABLE_ROWS).map((r) => (r[c] ?? "").length), 2));
  const natural = chars.map((n) => Math.min(n * 7 + 12, 240));
  const total = natural.reduce((a, b) => a + b, 0) + (cols - 1) * 8;
  const scale = total > width ? width / total : 1;
  const w = natural.map((n) => Math.max(40, Math.floor(n * scale)));
  const row = (cells: string[], head: boolean) => stack(cells.slice(0, cols).map((c, i) => text(c, { width: w[i], align: t.align[i] ?? "start", size: "sm", ...(head ? { weight: "semibold" as const } : {}) })), { direction: "row", gap: 2 });
  const rows = [row(t.header, true), { type: "divider" } as ViewNode, ...t.rows.slice(0, MAX_TABLE_ROWS).map((r) => row(r, false))];
  if (t.rows.length > MAX_TABLE_ROWS) rows.push(text(`… ${t.rows.length - MAX_TABLE_ROWS} more rows`, { style: "muted", size: "xs" }));
  return rows;
}

/**
 * The tree for a markdown body: a column stack of the blocks. `width` is
 * the room a table may take in px. Stops at `maxNodes` with a muted line
 * saying the rest is in `where` (the app the page lives in); `truncated` says so.
 */
export function render(md: string, opts: { width?: number; maxNodes?: number; padding?: 0 | 1 | 2 | 3 | 4 | 5 | 6; /** Headings drawn this many levels smaller: an excerpt inside a card. */ shift?: number; /** A leading `#` heading that repeats this title is left out: the page's header already says it. */ dropTitle?: string; /** The app named on the closing line when the budget cut the page ("… the rest of the page is in tela"); without it the line says the rest is not shown. */ where?: string } = {}): { tree: ViewNode; truncated: boolean; links: Link[] } {
  const width = opts.width ?? 640, max = opts.maxNodes ?? MAX_RENDER_NODES, shift = opts.shift ?? 0;
  const blocks = parseBlocks(frontmatter(md).body);
  const first = blocks[0];
  if (opts.dropTitle && first?.kind === "heading" && first.level === 1 && first.text.trim().toLowerCase() === opts.dropTitle.trim().toLowerCase()) blocks.shift();
  const links: Link[] = [];
  let count = 0, truncated = false;
  const size = (n: ViewNode): number => 1 + (n.type === "stack" ? n.children.reduce((a, c) => a + size(c), 0) : 0);
  const draw = (bs: Block[], depth: number): ViewNode[] => {
    const out: ViewNode[] = [];
    for (const b of bs) {
      if (truncated) break;
      const nodes = one(b, depth);
      const n = nodes.reduce((a, c) => a + size(c), 0);
      if (count + n > max) { truncated = true; break; }
      count += n;
      out.push(...nodes);
    }
    return out;
  };
  const one = (b: Block, depth: number): ViewNode[] => {
    switch (b.kind) {
      case "heading": { links.push(...b.links); const level = Math.min(6, b.level + shift); return [text(b.text, { style: level <= 2 ? "title" : "body", size: HEADING_SIZE[level], weight: "semibold" })]; }
      case "paragraph": {
        links.push(...b.links);
        const run = b.run === "code" ? { style: "mono" as const } : b.run === "bold" ? { weight: "semibold" as const } : b.run === "italic" ? { color: "muted" as const } : {};
        const l = linkLine(b.links);
        return l ? [stack([text(b.text, run), l], { gap: 1 })] : [text(b.text, run)];
      }
      case "code": {
        const lines = b.text.split("\n");
        if (b.lang === "excalidraw" || b.lang === "mermaid" || b.lang === "defter-style") return [stack([text(`[${b.lang === "defter-style" ? "sheet style" : "diagram"}: ${b.lang}]`, { style: "muted", size: "sm" })], { surface: "sunken", radius: true, padding: 2 })];
        const kept = lines.slice(0, MAX_CODE_LINES).join("\n");
        const children = [text(kept, { style: "mono" })];
        if (lines.length > MAX_CODE_LINES) children.push(text(`… ${lines.length - MAX_CODE_LINES} more lines`, { style: "muted", size: "xs" }));
        return [stack(children, { surface: "sunken", radius: true, padding: 3, gap: 1 })];
      }
      case "list":
        return [stack(b.items.map((it, i) => {
          links.push(...it.links);
          const mark = it.task ? (it.done ? "☑" : "☐") : b.ordered ? `${b.start + i}.` : "•";
          const body: ViewNode[] = [text(it.text, it.task && it.done ? { color: "muted" } : {})];
          const l = linkLine(it.links);
          if (l) body.push(l);
          if (it.children.length && depth < 6) body.push(...draw(it.children, depth + 1));
          return stack([text(mark, { width: b.ordered ? 22 : 14, style: "muted", align: b.ordered ? "end" : "center" }), stack(body, { gap: 1, grow: true })], { direction: "row", gap: 2, align: "start" });
        }), { gap: 1 })];
      case "quote": {
        const inner = draw(b.blocks, depth + 1);
        if (b.cite) inner.push(text(b.cite, { style: "muted", size: "sm", align: "end" }));
        return [stack(inner, { surface: "sunken", radius: true, padding: 3, gap: 2 })];
      }
      case "callout": {
        const c = CALLOUT[b.type] ?? CALLOUT.NOTE;
        const head = stack([{ type: "badge", text: c.label, color: c.color }, ...(b.title ? [text(b.title, { weight: "semibold" })] : [])], { direction: "row", gap: 2 });
        return [stack([head, ...draw(b.blocks, depth + 1)], { surface: "elevated", radius: true, padding: 3, gap: 2 })];
      }
      case "details":
        return [stack([text(`▸ ${b.summary}`, { weight: "semibold" }), ...draw(b.blocks, depth + 1)], { gap: 2 })];
      case "table": return [stack(tableRows(b, width), { gap: 1 })];
      case "image": return [text(b.alt ? `[image: ${b.alt}]` : "[image]", { style: "muted", size: "sm" })];
      case "rule": return [{ type: "divider" }];
    }
  };
  const children = draw(blocks, 0);
  if (truncated) children.push(text(opts.where ? `… the rest of the page is in ${opts.where}` : "… the rest of the page is not shown", { style: "muted", size: "sm" }));
  if (!children.length) children.push(text("Nothing on this page yet", { style: "muted" }));
  return { tree: stack(children, { gap: 3, padding: opts.padding ?? 4 }), truncated, links };
}

/** The headings, in order, with their level: the page's outline. */
export function outline(md: string): { level: number; text: string }[] {
  const out: { level: number; text: string }[] = [];
  const walk = (bs: Block[]) => { for (const b of bs) { if (b.kind === "heading") out.push({ level: b.level, text: b.text }); else if (b.kind === "callout" || b.kind === "quote" || b.kind === "details") walk(b.blocks); } };
  walk(parseBlocks(frontmatter(md).body));
  return out;
}

/** The body as plain text, blocks joined by single newlines: what tela anchors a comment on. */
export function plain(md: string): string {
  const lines: string[] = [];
  const walk = (bs: Block[]) => {
    for (const b of bs) {
      switch (b.kind) {
        case "heading": case "paragraph": lines.push(b.text); break;
        case "code": lines.push(b.text); break;
        case "list": for (const it of b.items) { lines.push(it.text); walk(it.children); } break;
        case "quote": case "callout": case "details": walk(b.blocks); break;
        case "table": lines.push(b.header.join(" "), ...b.rows.map((r) => r.join(" "))); break;
        case "image": if (b.alt) lines.push(b.alt); break;
        case "rule": break;
      }
    }
  };
  walk(parseBlocks(frontmatter(md).body));
  return lines.join("\n");
}

/** The first `n` characters of the plain text, on one line: a row's subtitle. */
export const excerpt = (md: string, n = 140): string => { const s = plain(md).replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
