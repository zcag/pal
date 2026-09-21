// Lines in the shape each CLI writes, with nothing of anyone's in them:
// what the tests put under a temporary home to stand for real sessions.
// Every builder answers one JSON line (Copilot's `workspace` a YAML text);
// the fields are the ones agents.ts reads, taken from real files on a
// machine with all three CLIs and trimmed to those.
const iso = (t: number) => new Date(t).toISOString();

/** Claude Code, `~/.claude/projects/<slug>/<id>.jsonl`. */
export const claude = {
  user: (id: string, cwd: string, t: number, text: string, extra: Record<string, unknown> = {}) =>
    JSON.stringify({ parentUuid: null, isSidechain: false, type: "user", message: { role: "user", content: text }, uuid: `u-${t}`, timestamp: iso(t), cwd, sessionId: id, version: "2.1.278", gitBranch: "main", permissionMode: "default", ...extra }),
  toolResult: (id: string, cwd: string, t: number, toolId: string) =>
    JSON.stringify({ isSidechain: false, type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: toolId, content: "ok" }] }, uuid: `u-${t}`, timestamp: iso(t), cwd, sessionId: id, version: "2.1.278", gitBranch: "main" }),
  text: (id: string, cwd: string, t: number, text: string, stop: "end_turn" | "tool_use" = "end_turn") =>
    JSON.stringify({ isSidechain: false, type: "assistant", message: { model: "claude-opus-5", role: "assistant", content: [{ type: "text", text }], stop_reason: stop, usage: { input_tokens: 12, cache_creation_input_tokens: 1000, cache_read_input_tokens: 140000, output_tokens: 120 } }, uuid: `a-${t}`, timestamp: iso(t), cwd, sessionId: id, version: "2.1.278", gitBranch: "main" }),
  toolUse: (id: string, cwd: string, t: number, toolId: string, name: string, input: Record<string, unknown>) =>
    JSON.stringify({ isSidechain: false, type: "assistant", message: { model: "claude-opus-5", role: "assistant", content: [{ type: "tool_use", id: toolId, name, input }], stop_reason: "tool_use", usage: { input_tokens: 8, cache_creation_input_tokens: 0, cache_read_input_tokens: 141000, output_tokens: 40 } }, uuid: `a-${t}`, timestamp: iso(t), cwd, sessionId: id, version: "2.1.278", gitBranch: "main" }),
  turnDuration: (id: string, cwd: string, t: number, ms: number, agents = 0) =>
    JSON.stringify({ isSidechain: false, type: "system", subtype: "turn_duration", durationMs: ms, messageCount: 4, pendingBackgroundAgentCount: agents, timestamp: iso(t), uuid: `s-${t}`, isMeta: false, cwd, sessionId: id, version: "2.1.278", gitBranch: "main" }),
  /** A subagent's transcript under `<id>/subagents/`: one line is enough, its mtime is what counts. */
  subagent: (parent: string, cwd: string, t: number) =>
    JSON.stringify({ parentUuid: null, isSidechain: true, type: "user", message: { role: "user", content: "the task" }, uuid: `u-${t}`, timestamp: iso(t), cwd, sessionId: parent, version: "2.1.278", gitBranch: "main" }),
  title: (id: string, title: string) => JSON.stringify({ type: "ai-title", aiTitle: title, sessionId: id }),
  permission: (id: string, mode: string) => JSON.stringify({ type: "permission-mode", permissionMode: mode, sessionId: id }),
  lastPrompt: (id: string, text: string) => JSON.stringify({ type: "last-prompt", lastPrompt: text, leafUuid: "x", sessionId: id }),
  /** `~/.claude/history.jsonl`, one line per prompt. */
  history: (id: string, cwd: string, t: number, text: string) => JSON.stringify({ display: text, pastedContents: {}, timestamp: t, project: cwd, sessionId: id }),
};

/** Codex, `~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<id>.jsonl`. */
export const codex = {
  meta: (id: string, cwd: string, t: number) =>
    JSON.stringify({ timestamp: iso(t), ordinal: 0, type: "session_meta", payload: { session_id: id, id, timestamp: iso(t), cwd, originator: "codex_cli_rs", cli_version: "0.153.4", source: "cli" } }),
  turnContext: (t: number, cwd: string, model = "gpt-5.6-terra") =>
    JSON.stringify({ timestamp: iso(t), ordinal: 1, type: "turn_context", payload: { turn_id: `t-${t}`, cwd, approval_policy: "on-request", model, effort: "medium" } }),
  taskStarted: (t: number) => JSON.stringify({ timestamp: iso(t), ordinal: 2, type: "event_msg", payload: { type: "task_started", turn_id: `t-${t}`, started_at: Math.floor(t / 1000), model_context_window: 258400 } }),
  taskComplete: (t: number, ms: number) => JSON.stringify({ timestamp: iso(t), ordinal: 9, type: "event_msg", payload: { type: "task_complete", turn_id: "t", last_agent_message: "", duration_ms: ms } }),
  tokens: (t: number, total: number, last: number) =>
    JSON.stringify({ timestamp: iso(t), ordinal: 8, type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: total - 500, output_tokens: 500, total_tokens: total }, last_token_usage: { input_tokens: last, output_tokens: 50, total_tokens: last + 50 }, model_context_window: 258400 } } }),
  user: (t: number, text: string) => JSON.stringify({ timestamp: iso(t), ordinal: 3, type: "response_item", payload: { type: "message", id: `m-${t}`, role: "user", content: [{ type: "input_text", text }] } }),
  /** What Codex puts in front of the first prompt. */
  preamble: (t: number, cwd: string) => JSON.stringify({ timestamp: iso(t), ordinal: 3, type: "response_item", payload: { type: "message", id: `m-${t}`, role: "user", content: [{ type: "input_text", text: `<environment_context>\n  <cwd>${cwd}</cwd>\n</environment_context>` }] } }),
  assistant: (t: number, text: string) => JSON.stringify({ timestamp: iso(t), ordinal: 5, type: "response_item", payload: { type: "message", id: `m-${t}`, role: "assistant", content: [{ type: "output_text", text }], phase: "final_answer" } }),
  call: (t: number, callId: string, name: string, input: string) => JSON.stringify({ timestamp: iso(t), ordinal: 6, type: "response_item", payload: { type: "custom_tool_call", id: `c-${t}`, status: "completed", call_id: callId, name, input } }),
  output: (t: number, callId: string) => JSON.stringify({ timestamp: iso(t), ordinal: 7, type: "response_item", payload: { type: "custom_tool_call_output", id: `o-${t}`, call_id: callId, output: [{ type: "input_text", text: "ok" }] } }),
  fn: (t: number, callId: string, name: string, args: Record<string, unknown>) => JSON.stringify({ timestamp: iso(t), ordinal: 6, type: "response_item", payload: { type: "function_call", id: `c-${t}`, name, arguments: JSON.stringify(args), call_id: callId } }),
};

/** Copilot CLI, `~/.copilot/session-state/<id>/events.jsonl` and `workspace.yaml`. */
export const copilot = {
  start: (id: string, cwd: string, t: number) => JSON.stringify({ type: "session.start", data: { sessionId: id, version: 1, producer: "copilot", copilotVersion: "1.0.30", startTime: iso(t), context: { cwd }, alreadyInUse: false }, id: `e-${t}`, timestamp: iso(t), parentId: null }),
  user: (t: number, text: string) => JSON.stringify({ type: "user.message", data: { content: text, transformedContent: text, messageId: `m-${t}`, delivery: "submitted", turnId: `t-${t}` }, id: `e-${t}`, timestamp: iso(t), parentId: "x" }),
  turnStart: (t: number) => JSON.stringify({ type: "assistant.turn_start", data: { turnId: `t-${t}`, interactionId: "i" }, id: `e-${t}`, timestamp: iso(t), parentId: "x" }),
  turnEnd: (t: number) => JSON.stringify({ type: "assistant.turn_end", data: { turnId: `t-${t}` }, id: `e-${t}`, timestamp: iso(t), parentId: "x" }),
  modelTurnEnded: (t: number, model = "claude-sonnet-4.5") => JSON.stringify({ type: "model.turn_ended", data: { kind: "turn_ended", model, turn: 1, timestampMs: t }, id: `e-${t}`, timestamp: iso(t), parentId: "x" }),
  message: (t: number, content: string, model = "claude-sonnet-4.5") => JSON.stringify({ type: "assistant.message", data: { messageId: `m-${t}`, model, content, toolRequests: [], interactionId: "i", turnId: "t" }, id: `e-${t}`, timestamp: iso(t), parentId: "x" }),
  toolStart: (t: number, callId: string, name: string, args: Record<string, unknown>) => JSON.stringify({ type: "tool.execution_start", data: { toolCallId: callId, toolName: name, arguments: args, turnId: "t", model: "claude-sonnet-4.5", toolTitle: name }, id: `e-${t}`, timestamp: iso(t), parentId: "x" }),
  toolComplete: (t: number, callId: string) => JSON.stringify({ type: "tool.execution_complete", data: { toolCallId: callId, model: "claude-sonnet-4.5", success: true, result: { content: "ok" } }, id: `e-${t}`, timestamp: iso(t), parentId: "x" }),
  permissions: (t: number, mode: string) => JSON.stringify({ type: "session.permissions_changed", data: { previousAllowAllPermissions: false, allowAllPermissions: true, previousAllowAllPermissionMode: "off", allowAllPermissionMode: mode }, id: `e-${t}`, timestamp: iso(t), parentId: "x" }),
  workspace: (id: string, cwd: string, name: string, t: number) => `id: ${id}\ncwd: ${cwd}\nclient_name: github/cli\nname: ${name}\nuser_named: false\nsummary_count: 0\nfork_count: 0\ncreated_at: ${iso(t)}\nupdated_at: ${iso(t)}\n`,
  /** `~/.copilot/open-sessions-state.json`. */
  open: (entries: Record<string, boolean>, t: number) => JSON.stringify(Object.fromEntries(Object.entries(entries).map(([id, working]) => [id, { schemaVersion: 1, openedAt: iso(t), working, refreshedAt: iso(t) }])), null, 2),
};

/** One `ps -axo pid,ppid,tty,%cpu,cputime,lstart,command` line. */
export const ps = (pid: number, ppid: number, tty: string, cpu: number, time: string, command: string, started = new Date(2026, 8, 21, 9, 0, 0)) =>
  `${String(pid).padStart(6)} ${String(ppid).padStart(6)} ${tty.padEnd(8)} ${cpu.toFixed(1).padStart(5)} ${time.padStart(10)} ${started.toString().replace(/ GMT.*$/, "").replace(/^(\w{3}) (\w{3}) (\d{2}) (\d{4}) ([\d:]+)$/, "$1 $2 $3 $5 $4")} ${command}`;
