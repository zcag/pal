// The two view levels: a research answer (the grounding tela assembled, its
// sources as selectable rows, the flags) and a page read inside the panel
// (its markdown through md.ts under a header). Pure: state in, tree out.
import type { Action, View, ViewNode } from "@zcag/pal";
import { excerpts, iso, type Page, type Research } from "./data.ts";
import { render as md } from "./md.ts";

/** Characters of the selected source's excerpt drawn under the rows; the page itself is one key away. */
export const EXCERPT_CHARS = 1600;
/** Characters of a source's snippet on its row. */
const SNIPPET_CHARS = 180;

export type ResearchState = { r: Research; cursor: number; asking?: boolean; where: Map<number, string> };

type Text = Extract<ViewNode, { type: "text" }>;
const text = (value: string, more: Partial<Omit<Text, "type" | "value">> = {}): ViewNode => ({ type: "text", value, ...more });
const stack = (children: ViewNode[], more: Partial<Extract<ViewNode, { type: "stack" }>> = {}): ViewNode => ({ type: "stack", children, ...more });
const cut = (s: string, n: number) => { const t = s.replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };

/** `3 min ago`, `2 h ago`, `5 d ago`, else the date. */
export function ago(t?: string | null, now = Date.now()): string {
  const at = iso(t);
  if (!at) return "";
  const ms = now - new Date(at).getTime();
  if (!Number.isFinite(ms)) return "";
  const m = Math.round(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} d ago`;
  return new Date(at).toLocaleDateString();
}

const HEADING_PATH = (p: string) => p.split(/\s*>\s*|\s*›\s*/).filter(Boolean).join(" › ");

/** The research level: flags first, then the sources with the cursor on one, then that source's excerpt. */
export function researchView(s: ResearchState): View {
  const { r, cursor } = s;
  const ex = excerpts(r.context);
  const children: ViewNode[] = [];
  if (r.low_confidence) children.push(stack([{ type: "badge", text: "Low confidence", color: "amber" }, text("Nothing strongly relevant was found; verify before relying on this", { style: "muted", size: "sm" })], { direction: "row", gap: 2, surface: "elevated", radius: true, padding: 2 }));
  if (r.disagreements) children.push(stack([stack([{ type: "badge", text: "Disagreements", color: "red" }, text("The sources conflict", { weight: "semibold", size: "sm" })], { direction: "row", gap: 2 }), text(cut(r.disagreements, 600), { size: "sm" })], { surface: "elevated", radius: true, padding: 3, gap: 1 }));
  const n = r.sources.length;
  children.push(text(n ? `${n} source${n === 1 ? "" : "s"} of ${r.considered} considered${r.truncated ? "; + asks for more" : ""}${r.space ? ", one space" : ""}` : "No sources: nothing in the wiki is close to this question", { style: "muted", size: "xs" }));
  if (n) {
    // The selected source's card opens on its excerpt from the grounding (the full section, cut long); the others show their snippet.
    children.push(stack(r.sources.map((src, i) => {
      const k = i + 1, on = i === cursor;
      const where = s.where.get(src.space_id) ?? `Space ${src.space_id}`;
      const path = src.source_kind === "file" ? `file ${src.file_name ?? ""}` : HEADING_PATH(src.heading_path);
      const e = on ? ex.get(k) : undefined;
      const body = e ? (e.body.length > EXCERPT_CHARS ? e.body.slice(0, EXCERPT_CHARS) + "\n\n\u2026" : e.body) : undefined;
      return stack([
        { type: "tile", width: 22, height: 22, text: String(k), color: on ? "accent" : "neutral", fill: on ? "solid" : "soft" },
        stack([
          text(src.title, { weight: "semibold" }),
          text([where, path, ago(src.updated_at)].filter(Boolean).join(" \u00B7 "), { style: "muted", size: "xs" }),
          ...(body ? [stack([md(body, { padding: 0, maxNodes: 220, width: 600, shift: 2 }).tree], { surface: "sunken", radius: true, padding: 3 })] : [text(cut(src.snippet, SNIPPET_CHARS), { size: "sm" })]),
        ], { gap: 1, grow: true }),
      ], { key: `s${k}`, direction: "row", gap: 2, padding: 2, align: "start", radius: true, ...(on ? { surface: "elevated" as const } : {}) });
    }), { gap: 1 }));
  }
  const actions: Action[] = [
    { id: "open", title: "Open source in tela" },
    { id: "read", title: "Read source in pal", shortcut: "cmd+enter" },
    { id: "down", title: "Next source", shortcut: ["down", "j"] },
    { id: "up", title: "Previous source", shortcut: ["up", "k"] },
    { id: "copy", title: "Copy source link", shortcut: "cmd+c" },
    { id: "context", title: "Copy the grounding", shortcut: "cmd+shift+c" },
    { id: "ask-tela", title: "Open in tela Ask", shortcut: "cmd+shift+o" },
    ...(r.truncated ? [{ id: "more", title: "More sources", shortcut: ["+", "="] }] : []),
    { id: "question", title: "New question", shortcut: "n" },
    ...(s.asking ? [{ id: "ask", title: "Ask" }, { id: "cancel", title: "Cancel the question" }] : []),
    ...Array.from({ length: Math.min(9, n) }, (_, i) => ({ id: `go${i + 1}`, title: `Source ${i + 1}`, shortcut: String(i + 1), hidden: true as const })),
  ];
  return {
    id: "research",
    title: cut(r.question, 60),
    keys: "actions",
    tree: stack(children, { gap: 3, padding: 4 }),
    actions,
    ...(s.asking ? { input: { placeholder: "Ask the wiki a question", submit: "ask", cancel: "cancel" } } : {}),
  };
}

/** The page level: the title, where it lives and when it moved, then the body. */
export function pageView(p: Page, where: string, crumb: string[] = []): View {
  const words = p.body.split(/\s+/).filter(Boolean).length;
  const line = [[where, ...crumb].join(" › "), `updated ${ago(p.updated_at)}`, `${words} words`, p.props?.deck === true ? "deck" : p.props?.sheet === true ? "sheet" : ""].filter(Boolean).join(" · ");
  const body = md(p.body, { padding: 0, width: 660, dropTitle: p.title });
  return {
    id: `page:${p.id}`,
    title: cut(p.title, 60),
    tree: stack([stack([text(p.title, { style: "title", size: "xl" }), text(line, { style: "muted", size: "xs" })], { gap: 0 }), { type: "divider" }, body.tree], { gap: 3, padding: 4 }),
    actions: [
      { id: "open", title: "Open in tela" },
      { id: "copy", title: "Copy link", shortcut: "cmd+c" },
      { id: "backlinks", title: "Backlinks", shortcut: "cmd+b" },
      { id: "outline", title: "Outline", shortcut: "cmd+shift+o" },
      { id: "comment", title: "Comment on page", shortcut: "cmd+shift+m" },
      { id: "markdown", title: "Copy markdown", shortcut: "cmd+shift+c" },
    ],
  };
}
