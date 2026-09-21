// The transcript as a view level (`View` in `@zcag/pal`), pure over what
// the fold kept (agents.ts `Acc.log`): a header (the agent's mark, the
// title, the state with its age, folder, branch, model, turns, tokens),
// then the latest entries oldest to newest as a chat. A prompt is a
// sunken block with a rail in the accent colour, the assistant's text
// plain paragraphs capped at `CAP` characters with a line saying how much
// more there is, a tool call one compact row (its name, the command or
// path, a dot: green done, red failed, grey still running) lit when the
// session is waiting on that call, a stretch of thinking one muted line
// ("thought for 12 s" from the gap to the next entry). `[` widens the
// window by `PAGE` entries; `s` on a tmux-backed session turns the search
// row into a field whose Enter types the line into the pane. index.ts
// keeps the window and the field per session and re-renders on every key
// and on every write to the file while the level is shown.
import { POPOVER_W, ago, column, keyHint, row, text, truncate, type Action, type TagColor, type View, type ViewNode } from "@zcag/pal";
import { AGENT_TITLE, fmtTokens, type Turn } from "./agents.ts";
import { AGENT_COLOR, AGENT_GLYPH, STATE, tagOf, type Session } from "./view.ts";

export type TranscriptState = { session: Session; log: Turn[]; /** How many of the latest entries are drawn. */ window: number; /** The field is open (`s`). */ field: boolean; now: number };

export const PAGE = 15;
/** An assistant entry longer than this is cut, with the remainder counted. */
export const CAP = 1200;
/** nf-md-cog for a tool row. */
const COG = "\u{f0493}";
const W = POPOVER_W;
const DOT: Record<NonNullable<Turn["status"]>, TagColor> = { done: "green", failed: "red", pending: "grey" };

/** The entries drawn: the last `window` of the log. */
export const shown = (st: TranscriptState): Turn[] => st.log.slice(-st.window);

function header(st: TranscriptState): ViewNode[] {
  const s = st.session;
  const meta = [s.cwd.slice(s.cwd.lastIndexOf("/") + 1) || s.cwd, s.branch, s.model, `${s.turns} turn${s.turns === 1 ? "" : "s"}`, s.tokens.context !== undefined ? `${fmtTokens(s.tokens.context)} context` : s.tokens.total !== undefined ? `${fmtTokens(s.tokens.total)} tokens` : undefined].filter(Boolean).join(" · ");
  return [
    row([
      text(AGENT_GLYPH[s.agent], { style: "glyph", size: "lg", color: AGENT_COLOR[s.agent], width: 24, align: "center" }),
      column([text(s.title, { style: "title", size: "md", minWidth: 0 })], { key: "t", gap: 0, grow: true }),
      { type: "badge", key: "state", text: `${tagOf(s)} · ${ago(s.stateAt, { now: st.now, short: true })}`, color: STATE[s.state].color },
    ], { key: "head", gap: 2, minHeight: 28 }),
    text(`${AGENT_TITLE[s.agent]} · ${meta}`, { key: "meta", size: "xs", color: "muted", width: W }),
    { type: "divider", key: "rule-top" },
  ];
}

const paragraphs = (t: string) => t.trim().split(/\n{2,}/).map((p) => p.replace(/\s*\n\s*/g, " ").trim()).filter(Boolean);

function userNode(t: Turn, i: number): ViewNode {
  return row(
    [{ type: "tile", key: "rail", width: 3, height: 22, color: "accent", fill: "solid" }, column(paragraphs(t.text ?? "").map((p, j) => text(p, { key: `p${j}`, size: "sm", width: W - 40 })), { key: "body", gap: 1, grow: true })],
    { key: `u${i}`, surface: "sunken", radius: true, padding: 2, gap: 2, align: "start" },
  );
}

function assistantNode(t: Turn, i: number): ViewNode {
  const full = t.text ?? "";
  const cut = full.length > CAP;
  const kids = paragraphs(cut ? full.slice(0, CAP) : full).map((p, j) => text(p, { key: `p${j}`, size: "sm", width: W - 8 }));
  if (cut) kids.push(text(`… ${full.length - CAP} more chars`, { key: "more", size: "xs", color: "faint" }));
  return column(kids, { key: `a${i}`, gap: 1, padding: 1 });
}

function toolNode(t: Turn, i: number, lit: boolean): ViewNode {
  return row(
    [
      text(COG, { style: "glyph", size: "sm", color: lit ? "red" : "muted", width: 16, align: "center" }),
      text(t.name ?? "tool", { size: "xs", weight: "semibold", width: 88 }),
      column([text(t.summary ?? "", { style: "mono", size: "xs", color: "muted", minWidth: 0 })], { key: "s", gap: 0, grow: true }),
      { type: "tile", key: "dot", width: 8, height: 8, color: DOT[t.status ?? "done"], fill: "solid" },
    ],
    { key: `t${i}`, gap: 1, minHeight: 22, padding: 1, radius: true, ...(lit && { surface: "elevated" as const }) },
  );
}

/** The thinking line: the time until the next entry when there is one (under ten minutes), else the bare word. */
function thinkingNode(t: Turn, next: Turn | undefined, i: number): ViewNode {
  const ms = t.ms ?? (next && next.at > t.at && next.at - t.at < 600_000 ? next.at - t.at : undefined);
  return text(ms ? `thought for ${Math.max(1, Math.round(ms / 1000))} s` : "thinking", { key: `th${i}`, size: "xs", color: "faint", style: "muted" });
}

function hints(st: TranscriptState): ViewNode {
  const s = st.session;
  if (st.field) return row([...keyHint("enter", "send"), ...keyHint("escape", "close")], { key: "hints", gap: 1, minHeight: 22 });
  const kids: ViewNode[] = [];
  if (st.log.length > st.window) kids.push(...keyHint("[", "older"));
  if (s.state !== "ended") kids.push(...keyHint("f", "focus"));
  kids.push(...keyHint("c", "copy reply"), ...keyHint("o", "editor"));
  if (s.pane) kids.push(...keyHint("s", "send"));
  kids.push(...keyHint("r", "refresh"));
  return row(kids, { key: "hints", gap: 1, minHeight: 22 });
}

export function actions(st: TranscriptState): Action[] {
  const s = st.session;
  const acts: Action[] = [];
  if (st.field) acts.push({ id: "submit", title: "Send" }, { id: "cancel", title: "Close the field" });
  if (s.state !== "ended") acts.push({ id: "focus", title: "Focus the terminal", shortcut: "f" });
  acts.push({ id: "copy-reply", title: "Copy the last reply", shortcut: ["c", "cmd+c"] }, { id: "open-file", title: "Open in the editor", shortcut: ["o", "cmd+o"] });
  if (s.pane && !st.field) acts.push({ id: "field", title: "Send a line", shortcut: "s" });
  acts.push({ id: "older", title: `${PAGE} older entries`, shortcut: "[" }, { id: "refresh", title: "Refresh", shortcut: "r" });
  return acts;
}

export function render(st: TranscriptState): View {
  const s = st.session;
  const turns = shown(st);
  const kids: ViewNode[] = header(st);
  if (st.log.length > st.window) kids.push(text(`${st.log.length - st.window} earlier entries, [ shows more`, { key: "earlier", size: "xs", color: "faint", align: "center" }));
  if (!turns.length) kids.push(text("Nothing in the transcript yet", { key: "none", style: "muted", size: "sm", align: "center" }));
  turns.forEach((t, i) => {
    switch (t.kind) {
      case "user": kids.push(userNode(t, i)); break;
      case "assistant": kids.push(assistantNode(t, i)); break;
      case "tool": kids.push(toolNode(t, i, s.state === "blocked" && t.status === "pending")); break;
      case "thinking": kids.push(thinkingNode(t, turns[i + 1], i)); break;
    }
  });
  kids.push({ type: "divider", key: "rule" }, hints(st));
  return {
    tree: column(kids, { key: "transcript", padding: 3, gap: 2 }),
    actions: actions(st),
    title: truncate(s.title, 48),
    id: s.key,
    keys: "actions",
    ...(st.field && { input: { placeholder: `Type a line for ${AGENT_TITLE[s.agent]}`, submit: "submit", cancel: "cancel" } }),
  };
}
