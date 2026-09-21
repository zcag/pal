// The three agents' own files, folded into one record per session. Each
// CLI keeps an append-only log: Claude Code one `<id>.jsonl` per session
// under `~/.claude/projects/<cwd slug>/`, Codex a `rollout-<ts>-<id>.jsonl`
// under `~/.codex/sessions/YYYY/MM/DD/`, Copilot an `events.jsonl` (with a
// `workspace.yaml` beside it) under `~/.copilot/session-state/<id>/`. A
// line is folded into the accumulator as it is read, so index.ts can keep
// the byte offset and fold only what was appended since; nothing here
// touches the file system. What the fold keeps is what the palette shows:
// the title, the last exchange, the tool call still without a result, when
// the last turn started and ended, the counts. Whether the file says the
// agent is working is `working(acc)`; whether anyone is there to work is
// the process table's business (procs.ts).
import { truncate } from "@zcag/pal";

export type Agent = "claude" | "codex" | "copilot";
export const AGENTS: Agent[] = ["claude", "codex", "copilot"];
export const AGENT_TITLE: Record<Agent, string> = { claude: "Claude Code", codex: "Codex", copilot: "Copilot CLI" };

/** A tool call the assistant made whose result is not in the file yet. */
export type Pending = { id: string; name: string; summary: string; at: number };
/** One entry of the conversation as the transcript view draws it: a prompt, the assistant's text, a tool call with its outcome, or a stretch of thinking. */
export type Turn = { kind: "user" | "assistant" | "tool" | "thinking"; at: number; text?: string; name?: string; summary?: string; status?: "done" | "failed" | "pending"; ms?: number };
/** How many of the latest turns the fold keeps for the view (the whole file is never held). */
export const KEEP_TURNS = 60;
export type Tokens = { context?: number; output?: number; total?: number };

/** Everything the fold keeps for one file. Times are unix ms. */
export type Acc = {
  agent: Agent;
  id?: string;
  /** The latest directory the file names: where the work is. */
  cwd?: string;
  /** The first: where the process was started, which is the directory it still reports. */
  start?: string;
  branch?: string;
  version?: string;
  model?: string;
  title?: string;
  /** The first real prompt, the title when the file names none. */
  first?: string;
  /** The last real prompt and when it was sent. */
  prompt?: string;
  promptAt: number;
  /** The assistant's last text. */
  reply?: string;
  /** Calls without a result yet, by id, in order; the last is the one shown. */
  calls: Map<string, Pending>;
  /** The latest `KEEP_TURNS` entries, oldest first, for the transcript view. */
  log: Turn[];
  /** The tool entries of `log` by call id, to mark their outcome when the result lands; pruned with it. */
  toolLog: Map<string, Turn>;
  /** A turn started (Codex `task_started`, Copilot `assistant.turn_start`); Claude's is the prompt. */
  turnAt: number;
  /** The last turn's end and how long it took. */
  endedAt: number;
  turnMs?: number;
  turns: number;
  /** Claude: subagents still running when the last turn ended (`pendingBackgroundAgentCount` on `turn_duration`). */
  agents?: number;
  tokens: Tokens;
  /** Claude's `permissionMode`, Copilot's permission mode. */
  permission?: string;
  started: number;
  /** The newest timestamp seen. */
  last: number;
};

export const acc = (agent: Agent): Acc => ({ agent, promptAt: 0, calls: new Map(), log: [], toolLog: new Map(), turnAt: 0, endedAt: 0, turns: 0, tokens: {}, started: 0, last: 0 });

const ts = (v: unknown): number => (typeof v === "string" ? Date.parse(v) || 0 : typeof v === "number" ? (v > 1e12 ? v : v * 1000) : 0);
const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
const obj = (v: unknown): Record<string, unknown> | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** A prompt the user typed, as opposed to what the CLI wrapped around it (`<command-name>`, `<environment_context>`, an AGENTS.md preamble). */
const typed = (s: string) => !/^\s*(<[a-z_-]+[\s>]|# AGENTS\.md)/i.test(s);

const TITLE_CUT = 60;
/** A prompt as a title: one line, cut. */
export const titleOf = (s: string) => truncate(s.replace(/\s+/g, " ").trim(), TITLE_CUT);

/** Every `text`-like block of a content list joined. */
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  return arr(content).map((b) => { const o = obj(b); return o && (o.type === "text" || o.type === "input_text" || o.type === "output_text") ? str(o.text) ?? "" : ""; }).filter(Boolean).join("\n");
}

/**
 * What a tool call was about, one line for the pane, from its arguments
 * alone (the tools' names differ per agent, the argument names less so):
 * a shell tool's command, a file tool's path, else the first argument
 * that reads as one (`pattern`, `url`, `query`), else the arguments as
 * JSON. Codex's `exec` tool takes a JavaScript snippet whose `cmd` is dug
 * out by pattern.
 */
export function summarise(input: unknown): string {
  let o = obj(input);
  if (typeof input === "string") {
    try { o = obj(JSON.parse(input)); } catch { /* not JSON: a snippet or a bare string */ }
    if (!o) {
      const m = input.match(/"cmd"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      return truncate((m ? JSON.parse(`"${m[1]}"`) : input).replace(/\s+/g, " ").trim(), 120);
    }
  }
  if (!o) return "";
  for (const k of ["command", "cmd", "file_path", "path", "filePath", "pattern", "url", "query", "description"]) {
    const v = o[k];
    if (typeof v === "string" && v) return truncate(v.replace(/\s+/g, " ").trim(), 120);
    if (Array.isArray(v) && v.length) return truncate(v.map(String).join(" "), 120);
  }
  return truncate(JSON.stringify(o), 120);
}

/** An entry onto the log, the oldest dropped past `KEEP_TURNS` (and its tool id forgotten). */
function push(a: Acc, t: Turn): Turn {
  a.log.push(t);
  if (a.log.length > KEEP_TURNS) { const gone = a.log.shift()!; for (const [k, v] of a.toolLog) if (v === gone) a.toolLog.delete(k); }
  return t;
}

/** A prompt lands: the file says a turn began (Claude has no other mark of it). Only a typed one is shown; a wrapped one (a task notification, a slash command's output) still starts a turn. */
function prompt(a: Acc, text: string, at: number) {
  a.promptAt = at;
  if (!typed(text)) return;
  a.prompt = text;
  a.first ??= text;
  push(a, { kind: "user", at, text });
}

function reply(a: Acc, text: string, at: number) {
  a.reply = text;
  push(a, { kind: "assistant", at, text });
}

function thinking(a: Acc, at: number, ms?: number) {
  const last = a.log.at(-1);
  // Consecutive thinking entries read as one line.
  if (last?.kind === "thinking") { if (ms !== undefined) last.ms = (last.ms ?? 0) + ms; return; }
  push(a, { kind: "thinking", at, ...(ms !== undefined && { ms }) });
}

function call(a: Acc, id: string, name: string, input: unknown, at: number) {
  const summary = summarise(input);
  a.calls.set(id, { id, name, summary, at });
  a.toolLog.set(id, push(a, { kind: "tool", at, name, summary, status: "pending" }));
}

/** The result landed: the call answered, its log entry marked. */
function result(a: Acc, id: string, failed = false) {
  a.calls.delete(id);
  const t = a.toolLog.get(id);
  if (t) { t.status = failed ? "failed" : "done"; a.toolLog.delete(id); }
}

/** A turn ended: the calls are answered or abandoned either way. */
function ended(a: Acc, at: number, ms?: number) {
  a.endedAt = at;
  if (ms !== undefined) a.turnMs = ms;
  a.turns++;
  a.calls.clear();
}

function claude(a: Acc, e: Record<string, unknown>) {
  const at = ts(e.timestamp);
  a.id ??= str(e.sessionId);
  if (str(e.cwd)) { a.cwd = str(e.cwd); a.start ??= a.cwd; }
  if (str(e.gitBranch) && e.gitBranch !== "HEAD") a.branch = str(e.gitBranch);
  a.version ??= str(e.version);
  const m = obj(e.message);
  switch (e.type) {
    case "ai-title": a.title = str(e.aiTitle); break;
    case "summary": a.title ??= str(e.summary); break;
    case "permission-mode": a.permission = str(e.permissionMode); break;
    case "user": {
      if (e.isSidechain || !m) break;
      const blocks = arr(m.content).map(obj);
      for (const b of blocks) if (b?.type === "tool_result" && str(b.tool_use_id)) result(a, str(b.tool_use_id)!, b.is_error === true);
      const text = textOf(m.content);
      if (!e.isMeta && text && !blocks.some((b) => b?.type === "tool_result")) prompt(a, text, at);
      break;
    }
    case "assistant": {
      if (e.isSidechain || !m) break;
      a.model = str(m.model) ?? a.model;
      const u = obj(m.usage);
      if (u) {
        a.tokens.context = (num(u.input_tokens) ?? 0) + (num(u.cache_creation_input_tokens) ?? 0) + (num(u.cache_read_input_tokens) ?? 0);
        a.tokens.output = (a.tokens.output ?? 0) + (num(u.output_tokens) ?? 0);
      }
      for (const b of arr(m.content).map(obj)) {
        if (!b) continue;
        if (b.type === "text" && str(b.text)) reply(a, str(b.text)!, at);
        if (b.type === "thinking") thinking(a, at);
        if (b.type === "tool_use" && str(b.id)) call(a, str(b.id)!, str(b.name) ?? "tool", b.input, at);
      }
      // `end_turn` without a `turn_duration` after it (an older CLI): the turn is over for the state, not for the count.
      if (m.stop_reason === "end_turn") { a.endedAt = Math.max(a.endedAt, at); a.calls.clear(); }
      break;
    }
    case "system":
      if (e.subtype === "turn_duration") { ended(a, at, num(e.durationMs)); a.agents = num(e.pendingBackgroundAgentCount) ?? 0; }
      break;
  }
}

function codex(a: Acc, e: Record<string, unknown>) {
  const at = ts(e.timestamp);
  const p = obj(e.payload);
  if (!p) return;
  switch (e.type) {
    case "session_meta":
      a.id ??= str(p.session_id) ?? str(p.id);
      a.cwd = str(p.cwd) ?? a.cwd;
      a.start ??= a.cwd;
      a.version ??= str(p.cli_version);
      a.started ||= ts(p.timestamp) || at;
      break;
    case "turn_context":
      a.cwd = str(p.cwd) ?? a.cwd;
      a.model = str(p.model) ?? a.model;
      break;
    case "event_msg":
      switch (p.type) {
        case "task_started": a.turnAt = at; break;
        case "task_complete": case "turn_aborted": ended(a, at, num(p.duration_ms)); break;
        case "token_count": {
          const info = obj(p.info);
          const total = obj(info?.total_token_usage), last = obj(info?.last_token_usage);
          if (total) a.tokens.total = num(total.total_tokens);
          if (last) a.tokens.context = num(last.input_tokens);
          break;
        }
      }
      break;
    case "response_item":
      switch (p.type) {
        case "message": {
          const text = textOf(p.content);
          if (!text) break;
          if (p.role === "user" && typed(text)) prompt(a, text, at);
          else if (p.role === "assistant") reply(a, text, at);
          break;
        }
        case "reasoning": thinking(a, at); break;
        case "custom_tool_call": if (str(p.call_id)) call(a, str(p.call_id)!, str(p.name) ?? "tool", p.input, at); break;
        case "function_call": if (str(p.call_id)) call(a, str(p.call_id)!, str(p.name) ?? "tool", p.arguments, at); break;
        case "custom_tool_call_output": case "function_call_output": if (str(p.call_id)) result(a, str(p.call_id)!); break;
      }
      break;
  }
}

function copilot(a: Acc, e: Record<string, unknown>) {
  const at = ts(e.timestamp);
  const d = obj(e.data) ?? {};
  switch (e.type) {
    case "session.start":
      a.id ??= str(d.sessionId);
      a.cwd = str(obj(d.context)?.cwd) ?? a.cwd;
      a.start ??= a.cwd;
      a.version ??= str(d.copilotVersion);
      a.started ||= ts(d.startTime) || at;
      break;
    case "user.message": if (str(d.content)) prompt(a, str(d.content)!, at); break;
    case "assistant.turn_start": a.turnAt = at; break;
    case "assistant.turn_end": a.endedAt = at; break;
    // One `model.turn_ended` per prompt answered; `assistant.turn_end` fires per model call, several a prompt.
    case "model.turn_ended": a.turns++; a.model = str(d.model) ?? a.model; if (a.promptAt) a.turnMs = at - a.promptAt; break;
    case "model.turn_started": a.model = str(d.model) ?? a.model; break;
    case "session.model_change": a.model = str(d.newModel) ?? a.model; break;
    case "session.permissions_changed": a.permission = str(d.allowAllPermissionMode) ?? (d.allowAllPermissions ? "allow all" : a.permission); break;
    case "assistant.message":
      if (str(d.reasoningText)) thinking(a, at);
      if (str(d.content)) reply(a, str(d.content)!, at);
      a.model = str(d.model) ?? a.model;
      break;
    case "tool.execution_start": if (str(d.toolCallId)) call(a, str(d.toolCallId)!, str(d.toolName) ?? "tool", d.arguments, at); break;
    case "tool.execution_complete": if (str(d.toolCallId)) result(a, str(d.toolCallId)!, d.success === false); break;
    case "model.model_call_success": {
      const u = obj(obj(d.responseChunk)?.usage);
      if (u) { a.tokens.context = num(u.prompt_tokens); a.tokens.output = (a.tokens.output ?? 0) + (num(u.completion_tokens) ?? 0); }
      break;
    }
  }
}

const FOLD: Record<Agent, (a: Acc, e: Record<string, unknown>) => void> = { claude, codex, copilot };

/** One line of the file into the accumulator; a line that is not JSON (cut short, or not this format) is skipped. */
export function fold(a: Acc, line: string): void {
  if (!line.trim()) return;
  let e: Record<string, unknown> | undefined;
  try { e = obj(JSON.parse(line)); } catch { return; }
  if (!e) return;
  const at = ts(e.timestamp);
  if (at) { a.started ||= at; if (at > a.last) a.last = at; }
  FOLD[a.agent](a, e);
}

/** The file says a turn is under way: a prompt (Claude) or a turn start (Codex, Copilot) newer than the last turn end. */
export const working = (a: Acc): boolean => (a.agent === "claude" ? a.promptAt : a.turnAt) > a.endedAt;

/** The call still waiting on a result, the newest. */
export const pending = (a: Acc): Pending | undefined => [...a.calls.values()].at(-1);

/** Claude's `ai-title`, else the first prompt; Codex the first prompt; Copilot's name is workspace.yaml's (index.ts puts it on `title`). */
export const title = (a: Acc): string => a.title ?? (a.first ? titleOf(a.first) : "Untitled session");

/** `~/.copilot/session-state/<id>/workspace.yaml`: flat `key: value` lines, quotes stripped. */
export function parseWorkspace(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^([A-Za-z_]+):\s*(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  return out;
}

/** The slug Claude Code files a cwd under: `/` and `.` as `-`. */
export const claudeSlug = (cwd: string) => cwd.replace(/[/.]/g, "-");

/** `142k`, `8.2k`, `950`. */
export const fmtTokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
