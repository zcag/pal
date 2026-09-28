// Lines in the shape each CLI writes, with nothing of anyone's in them:
// what the tests put under a temporary home to stand for real sessions.
// Every builder answers one JSON line (Copilot's `workspace` a YAML text);
// the fields are the ones agents.ts reads, taken from real files on a
// machine with all three CLIs and trimmed to those.
//
// Run, it writes the store screenshots' fixtures, app/src/gallery/shots/
// sessions.json and bar-sessions.json: six made-up sessions at the fixed
// clock (a release push a hook said is waiting on you, a Copilot review
// that is your turn, two agents working, a parent with three subagents
// out, one that ended) under a temporary home, with stand-in `ps`, `lsof`
// and `tmux`, listed and rendered through the host harness.
// `bun run extensions/sessions/fixture.ts`, then `make shots EXT=sessions`.
const iso = (t: number) => new Date(t).toISOString();

/** Claude Code, `~/.claude/projects/<slug>/<id>.jsonl`. */
export const claude = {
  user: (id: string, cwd: string, t: number, text: string, extra: Record<string, unknown> = {}) =>
    JSON.stringify({ parentUuid: null, isSidechain: false, type: "user", message: { role: "user", content: text }, uuid: `u-${t}`, timestamp: iso(t), cwd, sessionId: id, version: "2.1.278", gitBranch: "main", permissionMode: "default", ...extra }),
  toolResult: (id: string, cwd: string, t: number, toolId: string) =>
    JSON.stringify({ isSidechain: false, type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: toolId, content: "ok" }] }, uuid: `u-${t}`, timestamp: iso(t), cwd, sessionId: id, version: "2.1.278", gitBranch: "main" }),
  text: (id: string, cwd: string, t: number, text: string, stop: "end_turn" | "tool_use" = "end_turn") =>
    JSON.stringify({ isSidechain: false, type: "assistant", message: { model: "claude-opus-5", role: "assistant", content: [{ type: "text", text }], stop_reason: stop, usage: { input_tokens: 12, cache_creation_input_tokens: 1000, cache_read_input_tokens: 140000, output_tokens: 120 } }, uuid: `a-${t}`, timestamp: iso(t), cwd, sessionId: id, version: "2.1.278", gitBranch: "main" }),
  thinking: (id: string, cwd: string, t: number) =>
    JSON.stringify({ isSidechain: false, type: "assistant", message: { model: "claude-opus-5", role: "assistant", content: [{ type: "thinking", thinking: "", signature: "" }], stop_reason: null, usage: { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 141008, output_tokens: 0 } }, uuid: `a-${t}`, timestamp: iso(t), cwd, sessionId: id, version: "2.1.278", gitBranch: "main" }),
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

if (import.meta.main) {
  const { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { pinClock } = await import("../../app/scripts/fixture-kit.ts");
  const { Host, stored, writeTool } = await import("../../host/test/harness.ts");
  pinClock();
  const at = (h: number, m: number, s = 0) => new Date(2026, 8, 16, h, m, s).getTime();
  const base = mkdtempSync(join(tmpdir(), "pal-sessions-fixture-"));
  const home = join(base, "home"), bin = join(base, "bin"), proc = join(base, "proc");
  const put = (path: string, lines: string[], mtime: number) => {
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, lines.join("\n") + "\n");
    utimesSync(path, new Date(mtime), new Date(mtime));
  };
  // Claude writes the branch on every line; the builders say main.
  const on = (branch: string, lines: string[]) => lines.map((l) => l.replace('"gitBranch":"main"', `"gitBranch":${JSON.stringify(branch)}`));
  const CWD = { atlas: "/Users/dev/code/atlas", orbit: "/Users/dev/code/orbit", guide: "/Users/dev/code/field-guide", ledger: "/Users/dev/code/ledger", api: "/Users/dev/code/ledger-api", notes: "/Users/dev/notes" };
  const ID = { atlas: "3f9a1c52-7d4e-4b8a-9c21-5e6f7a8b9c01", orbit: "8b2e4d71-1a3c-4f5e-8d9b-0c1d2e3f4a02", guide: "c47d9e10-5b6a-4c7d-8e9f-1a2b3c4d5e03", notes: "e1f20a3b-9c8d-4e7f-a6b5-c4d3e2f1a004", api: "019a4f2e-6c3b-7d10-9e8f-7a6b5c4d3e21", ledger: "5d6e7f80-2a1b-4c3d-9e8f-0a1b2c3d4e05" };
  const claudeFile = (id: string, cwd: string) => join(home, ".claude", "projects", cwd.replace(/[/.]/g, "-"), `${id}.jsonl`);

  // A release push on atlas, in a tmux pane: the tool call is up, and a hook said it waits on you.
  put(claudeFile(ID.atlas, CWD.atlas), on("release/2.4", [
    claude.permission(ID.atlas, "default"),
    claude.user(ID.atlas, CWD.atlas, at(14, 2), "What merged since v2.3.0?"),
    claude.text(ID.atlas, CWD.atlas, at(14, 3, 10), "Fourteen: six features, seven fixes, one dependency bump.", "end_turn"),
    claude.turnDuration(ID.atlas, CWD.atlas, at(14, 3, 11), 70000),
    claude.user(ID.atlas, CWD.atlas, at(14, 18), "Cut the 2.4 release from them: changelog, version bump, tag"),
    claude.title(ID.atlas, "Cut the 2.4 release"),
    claude.toolUse(ID.atlas, CWD.atlas, at(14, 24, 10), "tu-a2", "Edit", { file_path: `${CWD.atlas}/CHANGELOG.md`, old_string: "## Unreleased" }),
    claude.toolResult(ID.atlas, CWD.atlas, at(14, 24, 11), "tu-a2"),
    claude.toolUse(ID.atlas, CWD.atlas, at(14, 26, 30), "tu-a3", "Bash", { command: "npm version 2.4.0 && npm test", description: "Bump and test" }),
    claude.toolResult(ID.atlas, CWD.atlas, at(14, 29, 50), "tu-a3"),
    claude.text(ID.atlas, CWD.atlas, at(14, 30, 40), "Changelog and version done, tests pass. Pushing with the tag.", "tool_use"),
    claude.toolUse(ID.atlas, CWD.atlas, at(14, 30, 52), "tu-a4", "Bash", { command: "git push origin release/2.4 v2.4.0", description: "Push the release" }),
  ]), at(14, 30, 52));
  stored.set(`sessions\0exact:claude:${ID.atlas}`, { state: "blocked", at: at(14, 30, 53) });

  // Offline sync on orbit, in kitty: a second turn writing code, the tests running now.
  put(claudeFile(ID.orbit, CWD.orbit), on("feat/offline-sync", [
    claude.permission(ID.orbit, "acceptEdits"),
    claude.user(ID.orbit, CWD.orbit, at(13, 41), "Sketch how offline sync could work for the notes view"),
    claude.title(ID.orbit, "Offline sync for the notes view"),
    claude.text(ID.orbit, CWD.orbit, at(13, 44, 30), "Queue every edit in IndexedDB with the note's version, replay the queue on reconnect, and let the server reject a stale version so the client can merge.", "end_turn"),
    claude.turnDuration(ID.orbit, CWD.orbit, at(13, 44, 31), 208000),
    claude.user(ID.orbit, CWD.orbit, at(14, 29, 5), "Good, build it: queue edits in IndexedDB and replay them on reconnect"),
    claude.thinking(ID.orbit, CWD.orbit, at(14, 29, 9)),
    claude.toolUse(ID.orbit, CWD.orbit, at(14, 29, 31), "tu-o1", "Write", { file_path: `${CWD.orbit}/src/sync/queue.ts`, content: "" }),
    claude.toolResult(ID.orbit, CWD.orbit, at(14, 29, 32), "tu-o1"),
    claude.toolUse(ID.orbit, CWD.orbit, at(14, 30, 44), "tu-o2", "Edit", { file_path: `${CWD.orbit}/src/notes/store.ts`, old_string: "save(" }),
    claude.toolResult(ID.orbit, CWD.orbit, at(14, 30, 45), "tu-o2"),
    claude.toolUse(ID.orbit, CWD.orbit, at(14, 31, 2), "tu-o3", "Write", { file_path: `${CWD.orbit}/src/sync/queue.test.ts`, content: "" }),
    claude.toolResult(ID.orbit, CWD.orbit, at(14, 31, 3), "tu-o3"),
    claude.text(ID.orbit, CWD.orbit, at(14, 31, 40), "The queue and the replay are in, with a test for a stale version. Running the sync tests.", "tool_use"),
    claude.toolUse(ID.orbit, CWD.orbit, at(14, 31, 52), "tu-o4", "Bash", { command: "bun test src/sync", description: "Run the sync tests" }),
  ]), at(14, 31, 52));

  // The docs audit on field-guide: the turn is over, three subagents are out.
  put(claudeFile(ID.guide, CWD.guide), [
    claude.user(ID.guide, CWD.guide, at(14, 9), "Check every page of the docs for broken links and outdated screenshots, one agent per section"),
    claude.title(ID.guide, "Audit the docs for broken links"),
    claude.text(ID.guide, CWD.guide, at(14, 11, 20), "Three agents are on it: guides, reference and tutorials. I will merge what they find into one list.", "end_turn"),
    claude.turnDuration(ID.guide, CWD.guide, at(14, 11, 21), 140000, 3),
  ], at(14, 11, 21));

  // Meeting notes, done eight minutes ago; nothing runs there any more.
  put(claudeFile(ID.notes, CWD.notes), [
    claude.user(ID.notes, CWD.notes, at(14, 12), "Tidy this week's meeting notes into one summary with the decisions on top"),
    claude.title(ID.notes, "Weekly notes summary"),
    claude.text(ID.notes, CWD.notes, at(14, 23, 50), "Done: summary.md has the four decisions on top, then the open questions and who owns each.", "end_turn"),
    claude.turnDuration(ID.notes, CWD.notes, at(14, 24), 710000),
  ], at(14, 24));

  // Codex on the ledger API, chasing a rounding bug: a test run in flight.
  put(join(home, ".codex", "sessions", "2026", "09", "16", `rollout-2026-09-16T14-20-00-${ID.api}.jsonl`), [
    codex.meta(ID.api, CWD.api, at(14, 20)),
    codex.turnContext(at(14, 20, 1), CWD.api),
    codex.preamble(at(14, 20, 2), CWD.api),
    codex.user(at(14, 20, 3), "Why do the CSV totals drift by a cent on large invoices?"),
    codex.taskStarted(at(14, 20, 4)),
    codex.call(at(14, 20, 30), "call_1", "exec", 'const r = await tools.exec_command({"cmd":"rg -n toFixed src/"}); return r;'),
    codex.output(at(14, 20, 31), "call_1"),
    codex.assistant(at(14, 26), "The line totals are rounded before they are summed, so 40 lines can be a cent off. Summing in cents first and rounding once fixes it."),
    codex.tokens(at(14, 26), 61200, 54800),
    codex.fn(at(14, 31, 50), "call_2", "shell", { command: ["cargo", "test", "totals"] }),
  ], at(14, 31, 50));

  // Copilot on ledger: the review is written, the next word is yours.
  const copilotDir = join(home, ".copilot", "session-state", ID.ledger);
  put(join(copilotDir, "events.jsonl"), [
    copilot.start(ID.ledger, CWD.ledger, at(14, 5)),
    copilot.user(at(14, 5, 20), "Review PR 212, the invoice CSV export"),
    copilot.turnStart(at(14, 5, 21)),
    copilot.toolStart(at(14, 5, 40), "tc-1", "grep", { pattern: "toLocaleString", limit: 20 }),
    copilot.toolComplete(at(14, 5, 41), "tc-1"),
    copilot.message(at(14, 27), "PR 212 looks right apart from one thing: the export formats amounts with the locale's decimal comma, so a CSV from a German account will not import back. I left a suggestion on line 48 of export.ts."),
    copilot.turnEnd(at(14, 27, 5)),
    copilot.modelTurnEnded(at(14, 27, 5)),
  ], at(14, 27, 5));
  writeFileSync(join(copilotDir, "workspace.yaml"), copilot.workspace(ID.ledger, CWD.ledger, "Review the invoice export PR", at(14, 5)));
  writeFileSync(join(copilotDir, "inuse.48011.lock"), "");
  writeFileSync(join(home, ".copilot", "open-sessions-state.json"), copilot.open({ [ID.ledger]: false }, at(14, 27, 5)));

  // The process table (each agent under its terminal's shell), the directories lsof or /proc give, the tmux panes.
  const started = (h: number, m: number) => new Date(at(h, m));
  const PROCS = [
    ps(500, 1, "??", 0.4, "3:12.00", "/Applications/kitty.app/Contents/MacOS/kitty", started(9, 2)),
    ps(501, 500, "ttys007", 0.0, "0:00.20", "-zsh", started(13, 40)),
    ps(48220, 501, "ttys007", 21.4, "0:41.30", "claude", started(13, 40)),
    ps(503, 500, "ttys009", 0.0, "0:00.20", "-zsh", started(14, 8)),
    ps(48300, 503, "ttys009", 3.1, "0:12.80", "claude", started(14, 8)),
    ps(505, 500, "ttys002", 0.0, "0:00.20", "-zsh", started(14, 19)),
    ps(48390, 505, "ttys002", 8.2, "0:09.10", "codex", started(14, 19)),
    ps(507, 500, "ttys004", 0.0, "0:00.20", "-zsh", started(14, 4)),
    ps(48011, 507, "ttys004", 0.1, "0:06.40", "copilot", started(14, 4)),
    ps(600, 1, "??", 0.0, "0:04.00", "tmux", started(9, 5)),
    ps(601, 600, "ttys011", 0.0, "0:00.20", "-zsh", started(14, 17)),
    ps(48122, 601, "ttys011", 0.0, "0:18.70", "claude", started(14, 17)),
  ].join("\n");
  const DIRS: [number, string][] = [[48220, CWD.orbit], [48300, CWD.guide], [48390, CWD.api], [48011, CWD.ledger], [48122, CWD.atlas]];
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(base, "ps.out"), PROCS + "\n");
  writeFileSync(join(base, "lsof.out"), DIRS.map(([pid, cwd]) => `p${pid}\nfcwd\nn${cwd}\n`).join(""));
  writeFileSync(join(base, "panes.out"), "/dev/ttys011 601 work:0.1\n");
  for (const [pid, cwd] of DIRS) { mkdirSync(join(proc, String(pid)), { recursive: true }); symlinkSync(cwd, join(proc, String(pid), "cwd")); }
  writeTool(join(bin, "ps"), `cat ${JSON.stringify(join(base, "ps.out"))}`);
  writeTool(join(bin, "lsof"), `cat ${JSON.stringify(join(base, "lsof.out"))}`);
  writeTool(join(bin, "tmux"), `case "$1" in list-panes) cat ${JSON.stringify(join(base, "panes.out"))} ;; esac`);

  const saved = { HOME: process.env.HOME, PATH: process.env.PATH };
  Object.assign(process.env, { HOME: home, PATH: `${bin}:${process.env.PATH}`, PAL_PROC: proc });
  const host = await Host.bundled({ timeout: 15000 });
  Object.assign(process.env, saved);
  try {
    const meta = host.loaded().find((l) => l.extension === "sessions")!.palettes[0];
    const items = await host.list("sessions", "sessions", undefined, { refresh: true });
    const details = Object.fromEntries(await Promise.all(items.map(async (i) => [i.id, await host.detail("sessions", "sessions", i.id)])));
    const orbit = `claude:${ID.orbit}`;
    const transcript = (await host.pick("sessions", "sessions", orbit, "view")).view;
    // The bar without the ended notes session (as once it has gone stale), so the popover's rows fit its 480 px without a scroll.
    rmSync(claudeFile(ID.notes, CWD.notes));
    const item = await host.render("sessions", "sessions", { reason: "update" });
    // The popover's `t`: the transcript of the row under the ring (the release push) over the list.
    const barTranscript = (await host.barAction("sessions", "sessions", "view", { reason: "open", compact: true })).view;
    const manifest = host.loaded().find((l) => l.extension === "sessions")!.manifest;
    const panel = {
      palettes: { sessions: { title: meta.title, icon: meta.icon, live: true, placeholder: meta.placeholder, filters: meta.filters, items, details } },
      effects: { [`sessions/${orbit}:view`]: { view: transcript } },
      shots: {
        "1-list": { palette: "sessions", keys: ["wait:300"], caption: "Every Claude Code, Codex and Copilot session on the machine by state: the one waiting on you first, then your turn, working, ended" },
        "2-detail": { palette: "sessions", keys: ["cmd+i", "wait:400"], caption: "The pane: your last prompt, the agent's last words and the command it is waiting to run; the folder, tokens and process below" },
        "3-transcript": { palette: "sessions", keys: ["down*2", "cmd+t", "wait:400"], caption: "cmd+t reads the transcript inside pal: prompts, replies and every tool call with its outcome, live while it runs" },
        "4-actions": { palette: "sessions", keys: ["cmd+k", "wait:300"], caption: "⌘K on a session: focus its terminal, send a line to its tmux pane, read or reveal the transcript, copy the resume command" },
      },
    };
    writeFileSync(new URL("../../app/src/gallery/shots/sessions.json", import.meta.url), JSON.stringify(panel) + "\n");
    const bar = {
      key: "sessions/sessions", title: manifest.bar!.sessions.title, item,
      states: [{ id: "transcript", item: { menu: { view: barTranscript } } }],
      shots: {
        "menubar": { target: "menubar", caption: "On the menu bar: how many sessions wait on you, are your turn and are working; the glyph turns red while one waits on you" },
        "popover": { target: "menubar", popover: true, caption: "A click opens the popover: a row per session by state; Enter focuses its terminal, r copies the resume command" },
        "popover-transcript": { target: "menubar", popover: true, state: "transcript", caption: "t shows the transcript over the list, the command waiting on you lit" },
        "sketchybar": { target: "sketchybar", caption: "On sketchybar: the three counts in red, amber and blue" },
      },
    };
    writeFileSync(new URL("../../app/src/gallery/shots/bar-sessions.json", import.meta.url), JSON.stringify(bar) + "\n");
    console.log(`sessions.json, bar-sessions.json: ${items.map((i) => `${i.name} (${i.section})`).join(", ")}`);
  } finally {
    host.kill();
    rmSync(base, { recursive: true, force: true });
  }
}
