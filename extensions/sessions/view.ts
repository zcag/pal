// The bar popover as a tree (`View` in `@zcag/pal`), pure: index.ts builds
// the sessions from the files and the process table, the tests pass made-up
// ones through the same function. A row per session under a header per
// state (waiting on you, your turn, working, ended), the agent's glyph in
// the agent's colour, the title clipped, the folder and branch under it,
// the state badge and the age at the right. The row the keys act on wears
// the accent ring; a click moves it. Every session is a row, the popover
// scrolls. A key-hint row closes the tree.
import { POPOVER_W, ago, column, keyHint, row, text, type Action, type TagColor, type View, type ViewNode } from "@zcag/pal";
import { AGENT_TITLE, type Agent, type Pending, type Tokens } from "./agents.ts";

/** `blocked` is the guess (a call without a result, the process idle), `waiting` is your turn, `ended` a file still warm with no process behind it. */
export type State = "blocked" | "waiting" | "working" | "ended";

export type Session = {
  /** `<agent>:<id>`, the row id. */
  key: string;
  agent: Agent;
  id: string;
  cwd: string;
  branch?: string;
  title: string;
  /** The transcript (Claude, Codex) or the events file (Copilot). */
  file: string;
  version?: string;
  model?: string;
  started: number;
  last: number;
  turns: number;
  turnMs?: number;
  tokens: Tokens;
  permission?: string;
  prompt?: string;
  promptAt: number;
  reply?: string;
  pending?: Pending;
  state: State;
  /** Claude: subagents running for it while its own turn is over (`working` on their account). */
  agents?: number;
  /** When the state began: the prompt, the turn's end, the call, the last write. */
  stateAt: number;
  /** The state came from a hook through `sessions/state`, not the files. */
  exact?: boolean;
  pid?: number;
  tty?: string;
  /** The tmux pane target (`main:0.1`) when the tty is one. */
  pane?: string;
};

export type PopoverState = { sessions: Session[]; cursor?: string; now: number };

export const STATE_ORDER: State[] = ["blocked", "waiting", "working", "ended"];
export const STATE: Record<State, { title: string; tag: string; color: TagColor }> = {
  blocked: { title: "Waiting on you?", tag: "waiting on you?", color: "red" },
  waiting: { title: "Your turn", tag: "your turn", color: "amber" },
  working: { title: "Working", tag: "working", color: "blue" },
  ended: { title: "Ended", tag: "ended", color: "grey" },
};
/** nf-cod-claude, nf-cod-openai, nf-cod-copilot: each agent's own mark, in a colour of its own. */
export const AGENT_GLYPH: Record<Agent, string> = { claude: "", codex: "", copilot: "" };
export const AGENT_COLOR: Record<Agent, TagColor> = { claude: "amber", codex: "teal", copilot: "violet" };

const OUTER_PAD = 12, GLYPH_W = 20, AGE_W = 36, ROW_PAD = 8, GAP = 8;
const TITLE_W = POPOVER_W - 2 * OUTER_PAD - ROW_PAD - GLYPH_W - GAP - AGE_W - GAP - 96;

/** The sessions in section order, each section as the list came (newest activity first). */
export const ordered = (sessions: Session[]): Session[] => STATE_ORDER.flatMap((s) => sessions.filter((x) => x.state === s));
/** The rows drawn: every session in section order (the popover scrolls). */
export const shown = (sessions: Session[]): Session[] => ordered(sessions);
/** The row the keys act on: the cursor's session when still listed, else the first. */
export const current = (st: PopoverState): Session | undefined => { const rows = shown(st.sessions); return rows.find((s) => s.key === st.cursor) ?? rows[0]; };

/** `blocked` reads with a question mark: the state that said so is a guess unless a hook confirmed it. A parent working through its subagents says how many. */
export const tagOf = (s: Session): string => (s.state === "blocked" && s.exact ? "waiting on you" : s.state === "working" && s.agents ? `${s.agents} agent${s.agents === 1 ? "" : "s"}` : STATE[s.state].tag);

const folder = (cwd: string) => cwd.slice(cwd.lastIndexOf("/") + 1) || cwd;

function header(state: State, n: number): ViewNode {
  return row([text(STATE[state].title, { size: "xs", weight: "semibold", color: "muted" }), { type: "badge", key: "n", text: String(n), color: STATE[state].color }], { key: `h-${state}`, gap: 1, minHeight: 22 });
}

function sessionRow(s: Session, focused: boolean, st: PopoverState): ViewNode {
  const sub = [folder(s.cwd), s.branch, s.pane ? `tmux ${s.pane}` : undefined].filter(Boolean).join(" · ");
  return row(
    [
      text(AGENT_GLYPH[s.agent], { style: "glyph", size: "md", color: AGENT_COLOR[s.agent], width: GLYPH_W, align: "center" }),
      column([text(s.title, { size: "md", weight: focused ? "semibold" : "medium", width: TITLE_W }), text(sub, { size: "xs", color: "muted", width: TITLE_W })], { key: "t", gap: 0, grow: true }),
      { type: "badge", key: "state", text: tagOf(s), color: STATE[s.state].color },
      text(ago(s.stateAt, { now: st.now, short: true }), { style: "mono", size: "xs", color: "muted", width: AGE_W, align: "end" }),
    ],
    { key: s.key, padding: 1, minHeight: 42, radius: true, action: `focus:${s.key}`, ...(focused && { selected: true }), transition: { enter: "fade", exit: "fade" } },
  );
}

function empty(): ViewNode {
  return column(
    [
      { type: "tile", key: "tile", width: 48, height: 48, text: "", color: "neutral", fill: "soft" },
      text("No sessions", { style: "title", size: "lg" }),
      text("Nothing from Claude Code, Codex or Copilot is running", { style: "muted", size: "sm", align: "center" }),
    ],
    { key: "empty", padding: 5, gap: 2, align: "center", justify: "center" },
  );
}

function hints(s?: Session): ViewNode {
  const kids: ViewNode[] = [];
  if (s) {
    kids.push(...keyHint("enter", s.state === "ended" ? "resume" : "focus"), ...keyHint("t", "transcript"), ...keyHint("o", "editor"), ...keyHint("r", "copy resume"));
    if (s.state !== "ended") kids.push(...keyHint("x", "kill"));
    if (s.pane) kids.push(...keyHint("s", "send"));
  }
  kids.push(...keyHint("p", "in pal"));
  if (s) kids.push(...keyHint(["up", "down"], "move"));
  return row(kids, { key: "hints", gap: 1, minHeight: 22 });
}

/** Every action the popover answers to; the first listed is Enter. The per-row focus actions are hidden, reached by a click on the row. */
export function actions(st: PopoverState): Action[] {
  const rows = shown(st.sessions);
  const s = current(st);
  if (!s) return [{ id: "pal", title: "Open Sessions in pal", shortcut: "p" }];
  return [
    s.state === "ended" ? { id: "resume", title: "Resume in a terminal", shortcut: "enter" } : { id: "focus", title: "Focus the terminal", shortcut: "enter" },
    { id: "view", title: "Transcript", shortcut: ["t", "cmd+t"] },
    { id: "transcript", title: "Open transcript in the editor", shortcut: ["o", "cmd+o"] },
    { id: "copy-resume", title: "Copy resume command", shortcut: ["r", "cmd+c"] },
    ...(s.state !== "ended" ? [{ id: "kill", title: "Kill", shortcut: ["x", "cmd+d"], style: "destructive" as const, confirm: `Send SIGTERM to ${AGENT_TITLE[s.agent]} (pid ${s.pid ?? "?"})?` }] : []),
    ...(s.pane ? [{ id: "send", title: "Send a line (in pal)", shortcut: "s" }] : []),
    { id: "pal", title: "Open Sessions in pal", shortcut: "p" },
    { id: "down", title: "Next", shortcut: ["down", "j"], hidden: true as const },
    { id: "up", title: "Previous", shortcut: ["up", "k"], hidden: true as const },
    ...rows.map((x): Action => ({ id: `focus:${x.key}`, title: `Focus ${x.title}`, hidden: true })),
  ];
}

export function render(st: PopoverState): View {
  const rows = shown(st.sessions);
  const cur = current(st);
  const kids: ViewNode[] = [];
  if (!rows.length) kids.push(empty());
  else {
    let state: State | undefined;
    for (const s of rows) {
      if (s.state !== state) { state = s.state; kids.push(header(state, st.sessions.filter((x) => x.state === state).length)); }
      kids.push(sessionRow(s, s.key === cur?.key, st));
    }
  }
  kids.push({ type: "divider", key: "rule" }, hints(cur));
  const n = st.sessions.length;
  return { tree: column(kids, { key: "compact", padding: 3, gap: 1 }), actions: actions(st), title: n ? `${n} session${n === 1 ? "" : "s"}` : "Sessions", id: "sessions", keys: "actions" };
}
