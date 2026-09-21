// sessions against a temporary home holding the three CLIs' files in
// their own shapes (extensions/sessions/fixture.ts) and stand-ins for
// every command the extension runs (`ps`, `lsof`, `tmux`, `kitten`,
// `osascript`, `open`, `kill`, `code`) on PATH, each printing a canned
// answer from a file the tests rewrite and logging its argv.
// `PAL_TERMINAL_LOG` catches the terminal Resume opens. The `blocked?`
// test waits the real two seconds the idle check takes on a first sight.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BarItem, View, ViewNode } from "../../../sdk/src/index.ts";
import { checkBarItem, checkView } from "../../../sdk/src/view.ts";
import { acc, fold, parseWorkspace, pending, summarise, title, working as busy } from "../../../extensions/sessions/agents.ts";
import { claude, codex, copilot, ps } from "../../../extensions/sessions/fixture.ts";
import { agentOf, ancestors, appOf, cputime, kittyCandidates, kittyListenOn, kittyPids, kittyWindowOf, stepsFor, tool, ttyOf } from "../../../extensions/sessions/procs.ts";
import { actions, render as renderPopover, shown, type Session } from "../../../extensions/sessions/view.ts";
import { CAP, PAGE } from "../../../extensions/sessions/transcript.ts";
import { Host } from "../harness.ts";

const base = mkdtempSync(join(tmpdir(), "pal-sessions-"));
const home = join(base, "home"), bin = join(base, "bin"), out = join(base, "out"), log = join(base, "bin.log");
for (const d of [home, bin, out]) mkdirSync(d, { recursive: true });

// The stand-ins: `<name> <args>` appended to the log, stdout from `out/<name>.out` (tmux and kitten pick a file by subcommand).
const stub = (name: string, body: string) => { writeFileSync(join(bin, name), `#!/bin/sh\necho "${name} $*" >> ${JSON.stringify(log)}\n${body}\n`); chmodSync(join(bin, name), 0o755); };
const canned = (name: string, text: string) => writeFileSync(join(out, `${name}.out`), text);
// `@T@` in a cputime is the clock: a process whose cpu seconds grow with the wall clock is never idle.
stub("ps", `sed "s/@T@/$(date +%s)/" ${JSON.stringify(join(out, "ps.out"))} 2>/dev/null`);
stub("lsof", `cat ${JSON.stringify(join(out, "lsof.out"))} 2>/dev/null`);
stub("tmux", `case "$1" in list-panes) cat ${JSON.stringify(join(out, "tmux-panes.out"))} 2>/dev/null ;; list-clients) cat ${JSON.stringify(join(out, "tmux-clients.out"))} 2>/dev/null ;; esac`);
// kitty answers on the socket of the kitty process whose pid is 500 (`listen_on unix:/tmp/mykitty` in the conf below, the pid appended); any other socket is refused.
stub("kitten", `case "$*" in "@ --to unix:/tmp/mykitty-500 ls") cat ${JSON.stringify(join(out, "kitten.out"))} 2>/dev/null ;; "@ --to unix:/tmp/mykitty-500 focus-window "*) exit 0 ;; *) echo "no socket" >&2; exit 1 ;; esac`);
// A System Events script (the pid rung) succeeds unless `out/frontmost.fail` exists; the tab scripts answer the canned word.
stub("osascript", `case "$*" in *"System Events"*) if [ -f ${JSON.stringify(join(out, "frontmost.fail"))} ]; then echo "no such process" >&2; exit 1; fi ;; *) cat ${JSON.stringify(join(out, "osascript.out"))} 2>/dev/null ;; esac`);
stub("wezterm", `case "$2" in list) cat ${JSON.stringify(join(out, "wezterm.out"))} 2>/dev/null ;; esac`);
stub("bad-editor", `echo "boom: no display" >&2; exit 1`);
stub("open", "");
stub("kill", "");
stub("code", "");
const asked = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean) : []);
const since = (n: number) => asked().slice(n);

// The files: three directories, one session each to begin with, timestamps relative to the wall clock.
const T = Date.now();
const s = (n: number) => T - n * 1000;
const CWD = { pal: "/Users/me/proj/pal", api: "/Users/me/proj/api", notes: "/Users/me/notes", old: "/Users/me/proj/old" };
const slug = (cwd: string) => cwd.replace(/[/.]/g, "-");
const ID = { claude: "11111111-aaaa-4bbb-8ccc-000000000001", blocked: "22222222-aaaa-4bbb-8ccc-000000000002", done: "33333333-aaaa-4bbb-8ccc-000000000003", old: "44444444-aaaa-4bbb-8ccc-000000000004", codex: "01a0c042-8f4c-7511-9165-95ea099725a5", copilot: "81147628-5d64-4c65-993e-cbc814d1ce8d" };
const claudeFile = (id: string, cwd: string) => join(home, ".claude", "projects", slug(cwd), `${id}.jsonl`);
const put = (path: string, lines: string[], mtime?: number) => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, lines.join("\n") + "\n");
  if (mtime) utimesSync(path, new Date(mtime), new Date(mtime));
};
const day = (t: number) => { const d = new Date(t); return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`; };
const codexFile = join(home, ".codex", "sessions", day(T), `rollout-2026-09-21T09-00-00-${ID.codex}.jsonl`);
const copilotDir = join(home, ".copilot", "session-state", ID.copilot);

/** Claude, working: a prompt, a call answered, a second call 5 s old still open. */
const working = [
  claude.permission(ID.claude, "bypassPermissions"),
  claude.user(ID.claude, CWD.pal, s(300), "add a sessions extension"),
  claude.title(ID.claude, "Sessions extension"),
  claude.text(ID.claude, CWD.pal, s(280), "Done: three files.", "end_turn"),
  claude.turnDuration(ID.claude, CWD.pal, s(279), 21000),
  claude.user(ID.claude, CWD.pal, s(30), "now the tests"),
  claude.thinking(ID.claude, CWD.pal, s(28)),
  claude.toolUse(ID.claude, CWD.pal, s(25), "tu-1", "Read", { file_path: "/Users/me/proj/pal/host/test/harness.ts" }),
  claude.toolResult(ID.claude, CWD.pal, s(24), "tu-1"),
  claude.text(ID.claude, CWD.pal, s(6), "Reading the harness, then writing.", "tool_use"),
  claude.toolUse(ID.claude, CWD.pal, s(5), "tu-2", "Bash", { command: "bun test test/extensions/sessions*", description: "Run the tests" }),
];
/** Claude, a call left open for a minute: blocked once the process proves idle. */
const blocked = [
  claude.user(ID.blocked, CWD.api, s(120), "deploy it"),
  claude.toolUse(ID.blocked, CWD.api, s(60), "tu-9", "Bash", { command: "git push origin main" }),
];
/** Claude, ended a minute ago with nothing behind it. */
const done = [
  claude.user(ID.done, CWD.notes, s(400), "tidy the notes"),
  claude.text(ID.done, CWD.notes, s(70), "Tidied.", "end_turn"),
  claude.turnDuration(ID.done, CWD.notes, s(65), 330000),
];
/** Codex, working: a task started after the last one completed. */
const codexLines = [
  codex.meta(ID.codex, CWD.api, s(900)),
  codex.turnContext(s(899), CWD.api),
  codex.preamble(s(898), CWD.api),
  codex.user(s(897), "what happened when I pressed refine?"),
  codex.taskStarted(s(896)),
  codex.call(s(890), "call_1", "exec", 'const r = await tools.exec_command({"cmd":"git status --short"}); return r;'),
  codex.output(s(889), "call_1"),
  codex.assistant(s(880), "Refine rewrote the draft; the original is in the history."),
  codex.taskComplete(s(879), 17000),
  codex.tokens(s(879), 42000, 38000),
  codex.user(s(40), "is it reversible?"),
  codex.taskStarted(s(39)),
  codex.fn(s(10), "call_2", "shell", { command: ["rg", "-n", "undo", "src/"] }),
];
/** Copilot, your turn: the turn ended, nothing since; the state file says not working. */
const copilotLines = [
  copilot.start(ID.copilot, CWD.notes, s(600)),
  copilot.permissions(s(599), "allowAll"),
  copilot.user(s(500), "review issue 4258"),
  copilot.turnStart(s(499)),
  copilot.toolStart(s(498), "tc-1", "grep", { pattern: "4258", limit: 20 }),
  copilot.toolComplete(s(497), "tc-1"),
  copilot.message(s(90), "Issue 4258 is closed by #4301."),
  copilot.turnEnd(s(89)),
  copilot.modelTurnEnded(s(89)),
];

/** The process table: a claude on pal (tty ttys007, under kitty) and a codex on api (ttys002), both burning cpu; a claude on api (in tmux, ttys011) with a fixed cpu time; a copilot on notes (ttys000); and what must not count. */
const procs = (blockedTime = "0:05.00") => [
  // An older kitty whose socket is dead, then the live one: the socket resolution has to fall through.
  ps(499, 1, "??", 0.0, "0:01.00", "/Applications/kitty.app/Contents/MacOS/kitty"),
  ps(500, 1, "??", 0.0, "1:00.00", "/Applications/kitty.app/Contents/MacOS/kitty"),
  ps(501, 500, "ttys007", 0.0, "0:00.10", "-zsh"),
  ps(35164, 501, "ttys007", 17.7, "0:@T@", "claude --dangerously-skip-permissions"),
  ps(35216, 35164, "ttys007", 0.0, "0:00.50", "codex mcp-server"),
  ps(600, 1, "??", 0.0, "0:10.00", "tmux"),
  ps(601, 600, "ttys011", 0.0, "0:00.10", "-zsh"),
  ps(41000, 601, "ttys011", 0.0, blockedTime, "node /Users/me/.local/share/claude/claude"),
  ps(75762, 1, "ttys002", 0.0, "0:@T@", "codex resume"),
  ps(76220, 75762, "ttys002", 0.0, "0:00.10", "/opt/homebrew/Caskroom/codex/0.153.4/bin/codex-code-mode-host"),
  ps(29645, 1, "ttys000", 0.3, "0:04.00", "copilot --allow-all"),
  ps(99, 1, "??", 0.0, "0:00.01", "ssh marko exec inotifywait claude-sessions"),
  ps(98, 1, "??", 0.0, "0:00.01", "/Users/me/.local/bin/claude-state get"),
  ps(700, 1, "??", 0.0, "0:30.00", "/Applications/iTerm.app/Contents/MacOS/iTerm2"),
].join("\n");
const lsof = "p35164\nfcwd\nn/Users/me/proj/pal\np41000\nfcwd\nn/Users/me/proj/api\np75762\nfcwd\nn/Users/me/proj/api\np29645\nfcwd\nn/Users/me/notes\n";

const PATH0 = process.env.PATH!, HOME0 = process.env.HOME!, KITTY0 = process.env.KITTY_LISTEN_ON;
let host: Host;
beforeAll(async () => {
  put(claudeFile(ID.claude, CWD.pal), working, s(5));
  put(claudeFile(ID.blocked, CWD.api), blocked, s(60));
  put(claudeFile(ID.done, CWD.notes), done, s(65));
  put(join(home, ".claude", "history.jsonl"), [claude.history(ID.claude, CWD.pal, s(300), "add a sessions extension")]);
  put(codexFile, codexLines, s(10));
  put(join(copilotDir, "events.jsonl"), copilotLines, s(89));
  writeFileSync(join(copilotDir, "workspace.yaml"), copilot.workspace(ID.copilot, CWD.notes, "Review Issue 4258 Status", s(600)));
  writeFileSync(join(copilotDir, "inuse.29645.lock"), "");
  writeFileSync(join(home, ".copilot", "open-sessions-state.json"), copilot.open({ [ID.copilot]: false }, s(89)));
  canned("ps", procs());
  canned("lsof", lsof);
  canned("tmux-panes", "/dev/ttys011 601 work:0.1\n/dev/ttys012 602 work:1.0\n");
  canned("tmux-clients", "/dev/ttys020\n");
  canned("kitten", JSON.stringify([{ id: 1, tabs: [{ id: 1, windows: [{ id: 7, pid: 501, foreground_processes: [{ pid: 35164, cmdline: ["claude"] }] }, { id: 8, pid: 900, foreground_processes: [] }] }] }]));
  canned("osascript", "no\n");
  delete process.env.KITTY_LISTEN_ON;
  put(join(home, ".config", "kitty", "kitty.conf"), ["# kitty", "allow_remote_control yes", "listen_on unix:/tmp/mykitty", "font_size 13"]);
  process.env.HOME = home;
  process.env.PATH = `${bin}:${PATH0}`;
  process.env.PAL_TERMINAL_LOG = join(base, "terminal.log");
  host = await Host.bundled();
});
afterAll(() => { host.kill(); process.env.HOME = HOME0; process.env.PATH = PATH0; if (KITTY0 !== undefined) process.env.KITTY_LISTEN_ON = KITTY0; delete process.env.PAL_TERMINAL_LOG; rmSync(base, { recursive: true, force: true }); });

const list = (filter?: string, refresh = true) => host.list("sessions", "sessions", undefined, { ...(filter && { filter }), ...(refresh && { refresh }) });
const pick = (id: string, action?: string, ctx?: Parameters<Host["pick"]>[4]) => host.pick("sessions", "sessions", id, action, ctx);
const render = () => host.render("sessions", "sessions", { reason: "update" });
const act = (action: string, values?: Record<string, string>) => host.barAction("sessions", "sessions", action, { reason: "open", compact: true, ...(values && { values }) });
const nodes = (n: ViewNode): ViewNode[] => [n, ...(n.type === "stack" ? n.children.flatMap(nodes) : [])];
const texts = (v: View) => nodes(v.tree).flatMap((n) => (n.type === "text" ? [n.value] : []));
const badges = (v: View) => nodes(v.tree).flatMap((n) => (n.type === "badge" ? [n.text] : []));
const keycaps = (v: View) => nodes(v.tree).flatMap((n) => (n.type === "keycap" ? [n.keys] : []));
const menuView = (item: BarItem) => checkView(((item.menu ?? item.empty?.menu) as { view: View }).view);
const tag = (i: { accessories?: unknown[] }) => (i.accessories as { tag?: string }[]).find((a) => a.tag)?.tag;
const key = (agent: string, id: string) => `${agent}:${id}`;
const terminalOpened = () => JSON.parse(readFileSync(join(base, "terminal.log"), "utf8").trim().split("\n").at(-1)!) as string[];

describe("sessions: the fold", () => {
  test("Claude: a prompt newer than the last turn end is working; the call without a result is pending; title, model, tokens, permission come along", () => {
    const a = acc("claude");
    for (const l of working) fold(a, l);
    expect(busy(a)).toBe(true);
    expect(title(a)).toBe("Sessions extension");
    expect(pending(a)).toMatchObject({ id: "tu-2", name: "Bash", summary: "bun test test/extensions/sessions*" });
    expect(a).toMatchObject({ id: ID.claude, cwd: CWD.pal, branch: "main", version: "2.1.278", model: "claude-opus-5", permission: "bypassPermissions", prompt: "now the tests", reply: "Reading the harness, then writing.", turns: 1, turnMs: 21000 });
    expect(a.tokens).toEqual({ context: 141008, output: 320 });
    const b = acc("claude");
    for (const l of done) fold(b, l);
    expect(busy(b)).toBe(false);
    expect(title(b)).toBe("tidy the notes");
    expect(pending(b)).toBeUndefined();
  });

  test("Codex: task_started after task_complete is working; the preamble is not the title; exec's cmd is dug out of the snippet, a function call's array joined", () => {
    const a = acc("codex");
    for (const l of codexLines) fold(a, l);
    expect(busy(a)).toBe(true);
    expect(title(a)).toBe("what happened when I pressed refine?");
    expect(a).toMatchObject({ id: ID.codex, cwd: CWD.api, version: "0.153.4", model: "gpt-5.6-terra", turns: 1, turnMs: 17000, reply: "Refine rewrote the draft; the original is in the history." });
    expect(a.tokens).toEqual({ total: 42000, context: 38000 });
    expect(pending(a)).toMatchObject({ id: "call_2", name: "shell", summary: "rg -n undo src/" });
    expect(summarise('const r = await tools.exec_command({"cmd":"git status --short"});')).toBe("git status --short");
    expect(summarise({ file_path: "/a/b.ts", old_string: "x" })).toBe("/a/b.ts");
    expect(summarise(JSON.stringify({ pattern: "TODO" }))).toBe("TODO");
    expect(summarise({ foo: 1 })).toBe('{"foo":1}');
  });

  test("Copilot: a turn end after the last start is not working; the tool call completed is not pending; workspace.yaml parses", () => {
    const a = acc("copilot");
    for (const l of copilotLines) fold(a, l);
    expect(busy(a)).toBe(false);
    expect(pending(a)).toBeUndefined();
    expect(a).toMatchObject({ id: ID.copilot, cwd: CWD.notes, version: "1.0.30", model: "claude-sonnet-4.5", permission: "allowAll", turns: 1, reply: "Issue 4258 is closed by #4301." });
    expect(parseWorkspace(copilot.workspace("x", "/a", "A name", T))).toMatchObject({ id: "x", cwd: "/a", name: "A name" });
    const b = acc("copilot");
    for (const l of [...copilotLines, copilot.user(s(5), "and #4301?"), copilot.turnStart(s(4))]) fold(b, l);
    expect(busy(b)).toBe(true);
  });

  test("procs: the agent of a command line, the cputime and tty forms, ancestors and the app bundle, kitty's window by pid, the ladder per setting", () => {
    expect(agentOf("claude --dangerously-skip-permissions")).toBe("claude");
    expect(agentOf("node /Users/me/.local/share/claude/claude")).toBe("claude");
    expect(agentOf("codex resume")).toBe("codex");
    expect(agentOf("copilot --allow-all")).toBe("copilot");
    expect(agentOf("codex mcp-server")).toBeUndefined();
    expect(agentOf("claude mcp serve")).toBeUndefined();
    expect(agentOf("/Users/me/.local/bin/claude-state get")).toBeUndefined();
    expect(agentOf("/opt/homebrew/Caskroom/codex/0.153.4/bin/codex-code-mode-host")).toBeUndefined();
    expect(agentOf("ssh marko exec inotifywait claude-sessions")).toBeUndefined();
    expect(cputime("0:01.50")).toBeCloseTo(1.5);
    expect(cputime("1:02:03")).toBe(3723);
    expect(cputime("2-00:00:01")).toBe(172801);
    expect(ttyOf("ttys007")).toBe("/dev/ttys007");
    expect(ttyOf("pts/3")).toBe("/dev/pts/3");
    expect(ttyOf("??")).toBeUndefined();
    const table = [{ pid: 1, ppid: 0, cpu: 0, time: 0, started: 0, command: "launchd" }, { pid: 500, ppid: 1, cpu: 0, time: 0, started: 0, command: "/Applications/kitty.app/Contents/MacOS/kitty" }, { pid: 501, ppid: 500, cpu: 0, time: 0, started: 0, command: "-zsh" }, { pid: 502, ppid: 501, cpu: 0, time: 0, started: 0, command: "claude" }];
    expect(ancestors(502, table).map((p) => p.pid)).toEqual([501, 500]);
    expect(appOf(502, table)).toBe("/Applications/kitty.app");
    expect(kittyWindowOf(502, [{ id: 3, pid: 900, pids: [] }, { id: 7, pid: 501, pids: [] }], table)?.id).toBe(7);
    expect(kittyWindowOf(502, [{ id: 3, pid: 900, pids: [502] }], table)?.id).toBe(3);
    expect(stepsFor("auto")).toEqual(["tmux", "kitty", "iterm", "terminal", "wezterm", "pid", "app"]);
    expect(stepsFor("wezterm")).toEqual(["tmux", "wezterm"]);
    expect(stepsFor("tmux")).toEqual(["tmux"]);
    expect(stepsFor("iterm")).toEqual(["tmux", "iterm"]);
  });

  test("tools: PATH first, then the bins launchd's PATH lacks; kitty's socket from KITTY_LISTEN_ON, else listen_on with each kitty pid appended, then bare", () => {
    expect(tool("ps")).toBe(join(bin, "ps"));
    const extra = join(base, "extra-bin");
    mkdirSync(extra, { recursive: true });
    writeFileSync(join(extra, "pal-only-here"), "#!/bin/sh\n");
    expect(tool("pal-only-here", [join(base, "nowhere"), extra])).toBe(join(extra, "pal-only-here"));
    expect(tool("pal-nowhere-at-all", [extra])).toBeUndefined();
    expect(kittyListenOn("# c\nallow_remote_control yes\nlisten_on unix:/tmp/mykitty\n")).toBe("unix:/tmp/mykitty");
    expect(kittyListenOn("listen_on none\n")).toBeUndefined();
    expect(kittyListenOn("font_size 13\n")).toBeUndefined();
    const table = [{ pid: 87710, ppid: 1, cpu: 0, time: 0, started: 0, command: "/Applications/kitty.app/Contents/MacOS/kitty" }, { pid: 2, ppid: 1, cpu: 0, time: 0, started: 0, command: "kitty --single-instance" }, { pid: 3, ppid: 1, cpu: 0, time: 0, started: 0, command: "/Applications/kitty.app/Contents/MacOS/kitten @ ls" }];
    expect(kittyPids(table)).toEqual([87710, 2]);
    expect(kittyCandidates("unix:/tmp/mykitty", [87710, 2], {})).toEqual(["unix:/tmp/mykitty-87710", "unix:/tmp/mykitty-2", "unix:/tmp/mykitty"]);
    expect(kittyCandidates("unix:/tmp/mykitty", [87710], { KITTY_LISTEN_ON: "unix:/tmp/mykitty-87710" })).toEqual(["unix:/tmp/mykitty-87710", "unix:/tmp/mykitty"]);
    expect(kittyCandidates("tcp:localhost:12345", [87710], {})).toEqual(["tcp:localhost:12345"]);
    expect(kittyCandidates(undefined, [87710], {})).toEqual([]);
    expect(kittyCandidates(undefined, [], { KITTY_LISTEN_ON: "unix:@mykitty" })).toEqual(["unix:@mykitty"]);
  });
});

describe("sessions: the palette", () => {
  test("meta: live, primary, five filters, a lazy pane, the link route and the settings", () => {
    const l = host.loaded().find((l) => l.extension === "sessions")!;
    expect(l.warnings).toEqual([]);
    expect(l.palettes[0]).toMatchObject({ name: "sessions", title: "Sessions", live: true, input: false, tier: "primary", detail: "lazy", filters: [{ id: "all", title: "All" }, { id: "claude", title: "Claude" }, { id: "codex", title: "Codex" }, { id: "copilot", title: "Copilot" }, { id: "recent", title: "Recent" }] });
    expect(l.manifest.settings!.map((x) => [x.id, x.kind])).toEqual([["agents", "list"], ["stale_minutes", "number"], ["recent_hours", "number"], ["terminal", "select"], ["editor", "text"]]);
    expect(Object.keys(l.manifest.links!)).toEqual(["state"]);
    expect(l.bar[0]).toMatchObject({ id: "sessions", title: "Sessions", refresh: { every: 10, on: ["show", "wake"] } });
  });

  test("every session across the three agents, sectioned by state in order; the blocked one waits the idle check (two ps reads 2 s apart, no cpu)", async () => {
    const n = asked().length;
    const items = await list();
    expect(items.map((i) => [i.id, i.section])).toEqual([
      [key("claude", ID.blocked), "Waiting on you?"],
      [key("copilot", ID.copilot), "Your turn"],
      [key("claude", ID.claude), "Working"],
      [key("codex", ID.codex), "Working"],
      [key("claude", ID.done), "Ended"],
    ]);
    // The ps stand-in was read twice for the idle check; lsof once, for every agent pid at once.
    expect(since(n).filter((l) => l.startsWith("ps ")).length).toBe(2);
    expect(since(n).find((l) => l.startsWith("lsof "))).toBe("lsof -a -p 35164,41000,75762,29645 -d cwd -Fpn");
    const by = Object.fromEntries(items.map((i) => [i.id, i]));
    expect(by[key("claude", ID.claude)]).toMatchObject({ name: "Sessions extension", subtitle: "Claude Code · pal · main", icon: { glyph: "", color: "orange" }, keywords: ["claude", "pal", "main", "11111111"] });
    expect(tag(by[key("claude", ID.claude)])).toBe("working");
    expect(by[key("claude", ID.claude)].accessories).toEqual([{ tag: "working", color: "blue" }, { text: "claude-opus-5" }, { text: "now" }, { text: "ttys007" }]);
    expect(by[key("claude", ID.blocked)]).toMatchObject({ name: "deploy it", subtitle: "Claude Code · api · main" });
    expect(tag(by[key("claude", ID.blocked)])).toBe("waiting on you?");
    expect(by[key("claude", ID.blocked)].accessories).toContainEqual({ text: "tmux work:0.1" });
    expect(by[key("codex", ID.codex)]).toMatchObject({ name: "what happened when I pressed refine?", subtitle: "Codex · api", icon: { glyph: "", color: "teal" } });
    expect(by[key("copilot", ID.copilot)]).toMatchObject({ name: "Review Issue 4258 Status", subtitle: "Copilot CLI · notes", icon: { glyph: "", color: "violet" } });
    expect(tag(by[key("copilot", ID.copilot)])).toBe("your turn");
    expect(by[key("claude", ID.done)]).toMatchObject({ name: "tidy the notes" });
    expect(tag(by[key("claude", ID.done)])).toBe("ended");
    // A live row's actions: focus first, the tmux one gets Send with its argument; an ended row resumes.
    expect(by[key("claude", ID.claude)].actions!.map((a) => a.id)).toEqual(["focus", "view", "transcript", "reveal", "folder", "editor", "copy-resume", "copy-id", "copy-cwd", "kill"]);
    expect(by[key("claude", ID.blocked)].actions!.map((a) => a.id)).toEqual(["focus", "send", "view", "transcript", "reveal", "folder", "editor", "copy-resume", "copy-id", "copy-cwd", "kill"]);
    expect(by[key("claude", ID.blocked)].args).toEqual([{ id: "text", placeholder: "Line to type into the session", required: true }]);
    expect(by[key("claude", ID.claude)].args).toBeUndefined();
    expect(by[key("claude", ID.done)].actions![0]).toEqual({ id: "resume", title: "Resume in a terminal" });
    expect(by[key("claude", ID.done)].actions!.map((a) => a.id)).not.toContain("kill");
  }, 10_000);

  test("a call left open is not blocked while the process burns cpu; a blocked one with no cpu stays so", async () => {
    canned("ps", procs("0:09.00"));
    let items = await list();
    expect(tag(items.find((i) => i.id === key("claude", ID.blocked))!)).toBe("working");
    canned("ps", procs("0:09.00"));
    await Bun.sleep(2100);
    items = await list();
    expect(tag(items.find((i) => i.id === key("claude", ID.blocked))!)).toBe("waiting on you?");
  }, 10_000);

  test("a working file not written for stale_minutes is an interrupted turn: your turn, not working", async () => {
    const quiet = "/Users/me/proj/quiet", id = "55555555-aaaa-4bbb-8ccc-000000000005";
    put(claudeFile(id, quiet), [claude.user(id, quiet, s(2400), "keep going")], s(2400));
    canned("ps", procs() + "\n" + ps(52000, 1, "ttys009", 0.0, "0:01.00", "claude"));
    canned("lsof", lsof + "p52000\nfcwd\nn/Users/me/proj/quiet\n");
    try {
      const row = (await list()).find((i) => i.id === key("claude", id))!;
      expect(row.section).toBe("Your turn");
      expect(tag(row)).toBe("your turn");
    } finally {
      rmSync(claudeFile(id, quiet));
      canned("ps", procs());
      canned("lsof", lsof);
    }
  });

  test("a transcript whose entries moved to another directory still pairs with the process on the one it started in (the project slug), and is working", async () => {
    const start = "/Users/me", moved = "/Users/me/proj/elsewhere", id = "66666666-aaaa-4bbb-8ccc-000000000006";
    // The project directory is the start's slug; every entry names the directory a tool ran in.
    put(claudeFile(id, start), [claude.user(id, moved, s(20), "fix the pairing"), claude.toolUse(id, moved, s(3), "tu-7", "Read", { file_path: `${moved}/index.ts` })], s(3));
    canned("ps", procs() + "\n" + ps(53000, 1, "ttys010", 0.0, "0:@T@", "claude"));
    canned("lsof", lsof + `p53000\nfcwd\nn${start}\n`);
    try {
      const row = (await list()).find((i) => i.id === key("claude", id))!;
      expect(row.section).toBe("Working");
      expect(row.accessories).toContainEqual({ text: "ttys010" });
      expect(row.subtitle).toBe("Claude Code · elsewhere · main");
      expect(Object.fromEntries((await host.detail("sessions", "sessions", key("claude", id))).metadata!.map((m) => [m.label, m.value]))).toMatchObject({ Folder: moved, Process: "pid 53000 on ttys010" });
    } finally {
      rmSync(claudeFile(id, start));
      canned("ps", procs());
      canned("lsof", lsof);
    }
  });

  test("a Claude parent whose turn ended with subagents out (pendingBackgroundAgentCount, or a subagent transcript written within 90 s) is working on their account, with the count; neither: your turn", async () => {
    const cwd = "/Users/me/proj/swarm", id = "77777777-aaaa-4bbb-8ccc-000000000007";
    const parent = (agents: number) => [claude.user(id, cwd, s(200), "run the four reviews"), claude.text(id, cwd, s(100), "Four agents are on it.", "end_turn"), claude.turnDuration(id, cwd, s(99), 100000, agents)];
    const sub = join(home, ".claude", "projects", slug(cwd), id, "subagents", "agent-1.jsonl");
    canned("ps", procs() + "\n" + ps(54000, 1, "ttys013", 0.0, "0:@T@", "claude"));
    canned("lsof", lsof + `p54000\nfcwd\nn${cwd}\n`);
    const row = async () => (await list()).find((i) => i.id === key("claude", id))!;
    try {
      put(claudeFile(id, cwd), parent(2), s(99));
      put(sub, [claude.subagent(id, cwd, s(10))], s(10));
      let r = await row();
      expect(r.section).toBe("Working");
      expect(tag(r)).toBe("2 agents");
      expect(r.accessories).toContainEqual({ text: "2 agents running" });
      expect((await host.detail("sessions", "sessions", key("claude", id))).metadata!.find((m) => m.label === "Subagents")!.value).toMatch(/^2 running \(the transcripts under ~\/\.claude\/projects\/-Users-me-proj-swarm\/77777777/);
      const v = menuView(await render());
      expect(badges(v)).toContain("2 agents");
      expect((await render()).tooltip).toContain("working");
      // The count says none, but a subagent transcript was written just now: working, the number of fresh files.
      put(claudeFile(id, cwd), parent(0), s(98));
      r = await row();
      expect(r.section).toBe("Working");
      expect(tag(r)).toBe("1 agent");
      // Neither: the count says none and the subagent file is five minutes old.
      put(sub, [claude.subagent(id, cwd, s(300))], s(300));
      r = await row();
      expect(r.section).toBe("Your turn");
      expect(tag(r)).toBe("your turn");
      expect(r.accessories!.some((a) => "text" in a && a.text.endsWith("running"))).toBe(false);
    } finally {
      rmSync(join(home, ".claude", "projects", slug(cwd)), { recursive: true, force: true });
      canned("ps", procs());
      canned("lsof", lsof);
    }
  });

  test("filters: one agent each; Recent lists a stale session too, All does not", async () => {
    put(claudeFile(ID.old, CWD.old), [claude.user(ID.old, CWD.old, s(7200), "old work"), claude.text(ID.old, CWD.old, s(7100), "done", "end_turn"), claude.turnDuration(ID.old, CWD.old, s(7099), 1000)], s(7099));
    expect((await list("claude")).map((i) => i.id)).toEqual([key("claude", ID.blocked), key("claude", ID.claude), key("claude", ID.done)]);
    expect((await list("codex")).map((i) => i.id)).toEqual([key("codex", ID.codex)]);
    expect((await list("copilot")).map((i) => i.id)).toEqual([key("copilot", ID.copilot)]);
    const recent = await list("recent");
    expect(recent.map((i) => i.id)).toContain(key("claude", ID.old));
    expect(recent.find((i) => i.id === key("claude", ID.old))!.section).toBe("Ended");
    expect((await list("all")).map((i) => i.id)).not.toContain(key("claude", ID.old));
    // Beyond recent_hours the file is not read at all.
    host.changeSettings("sessions", { settings: { recent_hours: 1 } });
    expect((await list("recent")).map((i) => i.id)).not.toContain(key("claude", ID.old));
    host.changeSettings("sessions", { settings: {} });
  });

  test("agents off: a Codex-only list; the hint row with nothing", async () => {
    host.changeSettings("sessions", { settings: { agents: ["codex"] } });
    expect((await list()).map((i) => i.id)).toEqual([key("codex", ID.codex)]);
    expect(await render()).toMatchObject({ segments: [{ id: "working", text: "1", color: "blue" }] });
    host.changeSettings("sessions", { settings: { agents: [] } });
    const items = await list();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: "hint:none", name: "No sessions", actions: [] });
    expect(await render()).toMatchObject({ hidden: true, empty: { icon: "\u{f0674}", tooltip: "No sessions" } });
    expect(texts(menuView(await render()))).toContain("No sessions");
    host.changeSettings("sessions", { settings: {} });
    await list();
  });

  test("the pane: the last exchange, the pending call with its command, the metadata", async () => {
    const d = await host.detail("sessions", "sessions", key("claude", ID.blocked));
    expect(d.markdown).toContain("## deploy it");
    expect(d.markdown).toContain("> deploy it");
    expect(d.markdown).toContain("**Waiting on you?** `Bash` since");
    expect(d.markdown).toContain("git push origin main");
    const meta = Object.fromEntries(d.metadata!.map((m) => [m.label, m.value ?? m.tags]));
    expect(meta).toMatchObject({ Agent: "Claude Code 2.1.278", Model: "claude-opus-5", Folder: CWD.api, Branch: "main", Turns: "0", Session: ID.blocked, Transcript: `~/.claude/projects/${slug(CWD.api)}/${ID.blocked}.jsonl`, Process: "pid 41000 on ttys011, tmux work:0.1" });
    expect(meta.State).toEqual([{ text: "waiting on you?", color: "red" }]);
    const c = await host.detail("sessions", "sessions", key("codex", ID.codex));
    expect(c.markdown).toContain("**Codex**\n\nRefine rewrote the draft");
    expect(c.markdown).toContain("**Running** `shell` since");
    expect(Object.fromEntries(c.metadata!.map((m) => [m.label, m.value]))).toMatchObject({ Agent: "Codex 0.153.4", Tokens: "38k context, 42k total", Turns: "1, the last took 17 s" });
    const p = await host.detail("sessions", "sessions", key("copilot", ID.copilot));
    expect(p.markdown).not.toContain("since");
    expect(Object.fromEntries(p.metadata!.map((m) => [m.label, m.value]))).toMatchObject({ Agent: "Copilot CLI 1.0.30", Permissions: "allowAll", Process: "pid 29645 on ttys000" });
  });

  test("the transcript view: the header, the entries in order as a chat (prompt blocks, replies, tool rows with their dots, the thinking line), the pending call lit when blocked; [ widens, c copies the reply, s sends over tmux or refuses", async () => {
    const viewOf = (r: Record<string, unknown>) => checkView((r as { view: View }).view);
    const dots = (v: View) => nodes(v.tree).flatMap((n) => (n.type === "tile" && n.key === "dot" ? [n.color] : []));
    const v = viewOf(await pick(key("claude", ID.claude), "view"));
    expect(v).toMatchObject({ id: key("claude", ID.claude), keys: "actions", title: "Sessions extension" });
    expect(v.input).toBeUndefined();
    const t = texts(v);
    expect(t.slice(0, 2)).toEqual(["\uec82", "Sessions extension"]);
    expect(t[2]).toMatch(/^Claude Code · pal · main · claude-opus-5 · 1 turn · 141k context$/);
    expect(t.slice(3)).toEqual(["add a sessions extension", "Done: three files.", "now the tests", "thought for 3 s", "\u{f0493}", "Read", "/Users/me/proj/pal/host/test/harness.ts", "Reading the harness, then writing.", "\u{f0493}", "Bash", "bun test test/extensions/sessions*", "focus", "copy reply", "editor", "refresh"]);
    expect(dots(v)).toEqual(["green", "grey"]);
    // The prompt is a sunken block with the accent rail; the tool rows are not lit while the session is working.
    const blocks = nodes(v.tree).filter((n) => n.type === "stack" && n.surface === "sunken");
    expect(blocks).toHaveLength(2);
    expect(nodes(v.tree).some((n) => n.type === "stack" && n.surface === "elevated")).toBe(false);
    expect(keycaps(v)).toEqual(["f", "c", "o", "r"]);
    expect(v.actions.map((a) => a.id)).toEqual(["focus", "copy-reply", "open-file", "older", "refresh"]);
    // The blocked session: its hanging Bash call is lit, and Send is offered (a tmux pane).
    const b = viewOf(await pick(key("claude", ID.blocked), "view"));
    const lit = nodes(b.tree).find((n) => n.type === "stack" && n.surface === "elevated")!;
    expect(texts({ tree: lit, actions: [] })).toEqual(["\u{f0493}", "Bash", "git push origin main"]);
    expect(dots(b)).toEqual(["grey"]);
    expect(b.actions.map((a) => a.id)).toEqual(["focus", "copy-reply", "open-file", "field", "older", "refresh"]);
    expect(keycaps(b)).toEqual(["f", "c", "o", "s", "r"]);
    // c copies the last reply; on a session with none it says so.
    expect(await pick(key("claude", ID.claude), "copy-reply")).toEqual({ copy: "Reading the harness, then writing.", hud: "Copied the last reply" });
    expect(await pick(key("claude", ID.blocked), "copy-reply")).toMatchObject({ toast: { title: "No reply yet", style: "failure" } });
    // s opens the field (the search row types), Enter sends the line over tmux and closes it; on a session outside tmux the send is refused with a toast.
    const f = viewOf(await pick(key("claude", ID.blocked), "field"));
    expect(f.input).toEqual({ placeholder: "Type a line for Claude Code", submit: "submit", cancel: "cancel" });
    expect(f.actions.slice(0, 2).map((a) => a.id)).toEqual(["submit", "cancel"]);
    let n = asked().length;
    const sent = await pick(key("claude", ID.blocked), "submit", { values: { input: "yes, go ahead" } });
    expect(sent).toMatchObject({ hud: "Sent to work:0.1" });
    expect(viewOf(sent).input).toBeUndefined();
    expect(since(n).filter((l) => l.startsWith("tmux send"))).toEqual(["tmux send-keys -t work:0.1 -l yes, go ahead", "tmux send-keys -t work:0.1 Enter"]);
    const refused = await pick(key("claude", ID.claude), "submit", { values: { input: "hi" } });
    expect(refused).toMatchObject({ toast: { title: "Not in tmux", style: "failure" } });
    expect(viewOf(refused).id).toBe(key("claude", ID.claude));
    expect(viewOf(await pick(key("claude", ID.blocked), "cancel")).input).toBeUndefined();
    // A long transcript: the last PAGE entries, a line counting the rest; [ shows PAGE more; a long reply is cut at CAP with the remainder counted.
    const cwd = "/Users/me/proj/long", id = "88888888-aaaa-4bbb-8ccc-000000000008";
    const lines: string[] = [];
    for (let i = 1; i <= 12; i++) lines.push(claude.user(id, cwd, s(500 - i * 20), `prompt ${i}`), claude.text(id, cwd, s(490 - i * 20), i === 12 ? "x".repeat(CAP + 250) : `reply ${i}`, "end_turn"), claude.turnDuration(id, cwd, s(489 - i * 20), 1000));
    put(claudeFile(id, cwd), lines, s(200));
    try {
      await list();
      let l = viewOf(await pick(key("claude", id), "view"));
      expect(texts(l)).toContain(`${24 - PAGE} earlier entries, [ shows more`);
      expect(texts(l)).not.toContain("prompt 5");
      expect(texts(l)).toContain("reply 5");
      expect(texts(l)).toContain("… 250 more chars");
      expect(texts(l).slice(3).filter((x) => /^(prompt|reply) \d+$/.test(x))).toHaveLength(PAGE - 1);
      l = viewOf(await pick(key("claude", id), "older"));
      expect(texts(l)).toContain("prompt 1");
      expect(texts(l).some((x) => x.endsWith("[ shows more"))).toBe(false);
      expect(l.actions.map((a) => a.id)).toEqual(["copy-reply", "open-file", "older", "refresh"]);
    } finally {
      rmSync(join(home, ".claude", "projects", slug(cwd)), { recursive: true, force: true });
    }
  });

  test("the transcript view streams: while its level is shown a write to the file pushes the tree again", async () => {
    const k = key("claude", ID.blocked);
    await pick(k, "view");
    host.viewShown("sessions", { palette: "sessions" }, k);
    await Bun.sleep(100);
    writeFileSync(claudeFile(ID.blocked, CWD.api), claude.toolResult(ID.blocked, CWD.api, Date.now(), "tu-9") + "\n" + claude.text(ID.blocked, CWD.api, Date.now(), "Pushed.", "end_turn") + "\n", { flag: "a" });
    const u = await host.nextViewUpdate("sessions", { palette: "sessions" }, (x) => x.id === k);
    const tree = (u.spec as View).tree;
    expect(texts({ tree, actions: [] })).toContain("Pushed.");
    expect(nodes(tree).flatMap((n) => (n.type === "tile" && n.key === "dot" ? [n.color] : []))).toEqual(["green"]);
    host.viewHidden("sessions", { palette: "sessions" }, k);
    await Bun.sleep(100);
    const before = host.viewUpdates("sessions", { palette: "sessions" }).length;
    writeFileSync(claudeFile(ID.blocked, CWD.api), claude.user(ID.blocked, CWD.api, Date.now(), "thanks") + "\n", { flag: "a" });
    await Bun.sleep(700);
    expect(host.viewUpdates("sessions", { palette: "sessions" })).toHaveLength(before);
    // The list reads the new state: the turn ended, then a prompt: working. Then the file is put back as it was for the tests after this one.
    expect((await list()).find((i) => i.id === k)!.section).toBe("Working");
    put(claudeFile(ID.blocked, CWD.api), blocked, s(60));
    expect((await list()).find((i) => i.id === k)!.section).toBe("Waiting on you?");
  });

  test("actions: transcript in the editor (found by the resolver, else open -t, a failure a toast), reveal, folder, editor, the copies, kill (one and marked), send over tmux", async () => {
    const id = key("claude", ID.blocked);
    const file = claudeFile(ID.blocked, CWD.api);
    let n = asked().length;
    expect(await pick(id, "transcript")).toEqual({ hide: true });
    expect(since(n)).toContain(`code ${file}`);
    host.changeSettings("sessions", { settings: { editor: "no-such-editor-here" } });
    n = asked().length;
    expect(await pick(id, "transcript")).toEqual({ hide: true });
    expect(since(n)).toContain(`open -t ${file}`);
    host.changeSettings("sessions", { settings: { editor: "bad-editor" } });
    expect(await pick(id, "transcript")).toMatchObject({ toast: { title: `Could not open ${ID.blocked}.jsonl with bad-editor`, message: "boom: no display", style: "failure" } });
    host.changeSettings("sessions", { settings: {} });
    expect(await pick(id, "folder")).toEqual({ open: CWD.api });
    expect(await pick(id, "copy-resume")).toEqual({ copy: `claude --resume ${ID.blocked}` });
    expect(await pick(key("codex", ID.codex), "copy-resume")).toEqual({ copy: `codex resume ${ID.codex}` });
    expect(await pick(key("copilot", ID.copilot), "copy-resume")).toEqual({ copy: `copilot --resume=${ID.copilot}` });
    expect(await pick(id, "copy-id")).toEqual({ copy: ID.blocked });
    expect(await pick(id, "copy-cwd")).toEqual({ copy: CWD.api });
    n = asked().length;
    expect(await pick(id, "reveal")).toEqual({ hide: true });
    await host.until(() => since(n).some((l) => l.startsWith("open ")));
    expect(since(n)).toContain(`open -R ${claudeFile(ID.blocked, CWD.api)}`);
    n = asked().length;
    expect(await pick(id, "editor")).toEqual({ hide: true });
    expect(since(n)).toContain(`code ${CWD.api}`);
    host.changeSettings("sessions", { settings: { editor: "no-such-editor-here" } });
    n = asked().length;
    expect(await pick(id, "editor")).toEqual({ hide: true });
    expect(since(n)).toContain(`open ${CWD.api}`);
    host.changeSettings("sessions", { settings: {} });
    n = asked().length;
    expect(await pick(id, "kill")).toEqual({ keep: true, hud: "Sent SIGTERM to 41000" });
    expect(since(n)).toContain("kill -TERM 41000");
    n = asked().length;
    expect(await pick(id, "kill", { ids: [id, key("codex", ID.codex), key("claude", ID.done)] })).toEqual({ keep: true, hud: "Sent SIGTERM to 2 sessions" });
    expect(since(n).filter((l) => l.startsWith("kill "))).toEqual(["kill -TERM 41000", "kill -TERM 75762"]);
    expect(await pick(key("claude", ID.done), "kill")).toMatchObject({ toast: { title: "Not running", style: "failure" } });
    n = asked().length;
    expect(await pick(id, "send", { values: { text: "yes, go ahead" } })).toEqual({ hud: "Sent to work:0.1" });
    expect(since(n).filter((l) => l.startsWith("tmux send"))).toEqual(["tmux send-keys -t work:0.1 -l yes, go ahead", "tmux send-keys -t work:0.1 Enter"]);
    expect(await pick(id, "send", { values: { text: "  " } })).toMatchObject({ toast: { title: "Nothing to send", style: "failure" } });
    expect(await pick(key("claude", ID.claude), "send", { values: { text: "hi" } })).toMatchObject({ toast: { title: "Not in tmux", style: "failure" } });
  });

  test("focus: tmux first (the pane selected, the client's tty followed), then kitty by pid, then iTerm2 and Terminal by tty over AppleScript, then the app; Enter on an ended row resumes in a terminal", async () => {
    // The blocked session sits in a tmux pane whose client is on ttys020: the pane is selected, the client looked for on that tty (nothing runs there), kitty asked for a window holding the session (none) and iTerm2's AppleScript says no.
    await list();
    let n = asked().length;
    expect(await pick(key("claude", ID.blocked))).toMatchObject({ toast: { title: "Could not find its window" } });
    const tmux = since(n).filter((l) => l.startsWith("tmux "));
    expect(tmux).toEqual(["tmux list-panes -a -F #{pane_tty} #{pane_pid} #{session_name}:#{window_index}.#{pane_index}", "tmux switch-client -t work:0.1", "tmux select-window -t work:0.1", "tmux select-pane -t work:0.1", "tmux list-clients -t work -F #{client_tty}"]);
    // Terminal.app is not in the table, so its AppleScript is never run (it would launch the app). The script's lines follow its log line.
    // The socket: the dead kitty's (pid 499) refused, the live one's answers and is kept from then on.
    const rest = since(n).filter((l) => /^(kitten|osascript|open|kill|code) /.test(l));
    expect(rest.slice(0, 2)).toEqual(["kitten @ --to unix:/tmp/mykitty-499 ls", "kitten @ --to unix:/tmp/mykitty-500 ls"]);
    expect(rest.map((l) => l.split(" ").slice(0, 2).join(" "))).toEqual(["kitten @", "kitten @", "osascript -e"]);
    expect(rest[2]).toContain('tell application "iTerm2"');
    expect(since(n).join("\n")).toContain('if tty of s is "/dev/ttys020"');
    // The pal session is on ttys007 under kitty, no tmux pane: kitty's window 7 holds its shell, focus-window is the answer.
    n = asked().length;
    expect(await pick(key("claude", ID.claude))).toEqual({ hide: true });
    expect(since(n).filter((l) => /^(kitten|open) /.test(l))).toEqual(["kitten @ --to unix:/tmp/mykitty-500 ls", "kitten @ --to unix:/tmp/mykitty-500 focus-window --match id:7", "open -a kitty"]);
    expect(since(n).some((l) => l.startsWith("osascript "))).toBe(false);
    // With no kitty window for it, iTerm2 answers ok: the AppleScript step did it.
    canned("kitten", "[]");
    canned("osascript", "ok\n");
    n = asked().length;
    expect(await pick(key("claude", ID.claude))).toEqual({ hide: true });
    expect(since(n).filter((l) => l.startsWith("osascript ")).length).toBe(1);
    // Neither, and WezTerm not running: the GUI ancestor (kitty.app, pid 500) is raised by pid through System Events, chosen over `open`.
    canned("osascript", "no\n");
    n = asked().length;
    expect(await pick(key("claude", ID.claude))).toEqual({ hide: true });
    expect(since(n)).toContain('osascript -e tell application "System Events" to set frontmost of (first process whose unix id is 500) to true');
    expect(since(n).some((l) => l.startsWith("open "))).toBe(false);
    // System Events refuses: the app bundle is opened, the last resort.
    writeFileSync(join(out, "frontmost.fail"), "");
    n = asked().length;
    expect(await pick(key("claude", ID.claude))).toEqual({ hide: true });
    expect(since(n)).toContain("open /Applications/kitty.app");
    rmSync(join(out, "frontmost.fail"));
    // WezTerm running with a pane on the codex session's tty: `wezterm cli list` finds it, the pane is activated and the app raised.
    canned("ps", procs() + "\n" + ps(800, 1, "??", 0.0, "0:10.00", "/Applications/WezTerm.app/Contents/MacOS/wezterm-gui"));
    canned("wezterm", JSON.stringify([{ pane_id: 5, tty_name: "/dev/ttys002", title: "codex" }, { pane_id: 6, tty_name: "/dev/ttys030", title: "zsh" }]));
    await list();
    n = asked().length;
    expect(await pick(key("codex", ID.codex))).toEqual({ hide: true });
    expect(since(n).filter((l) => /^(wezterm|open) /.test(l))).toEqual(["wezterm cli list --format json", "wezterm cli activate-pane --pane-id 5", "open -a WezTerm"]);
    canned("ps", procs());
    // tmux only: nothing beyond the pane; for a session outside tmux, nothing at all.
    host.changeSettings("sessions", { settings: { terminal: "tmux" } });
    n = asked().length;
    expect(await pick(key("claude", ID.claude))).toMatchObject({ toast: { title: "Could not find its window" } });
    expect(since(n).filter((l) => /^(kitten|osascript|open|kill|code) /.test(l))).toEqual([]);
    host.changeSettings("sessions", { settings: {} });
    canned("kitten", JSON.stringify([{ id: 1, tabs: [{ id: 1, windows: [{ id: 7, pid: 501, foreground_processes: [] }] }] }]));
    // Enter on an ended session opens a terminal in its folder with the resume command; the tmux setting opens a tmux window instead.
    expect(await pick(key("claude", ID.done))).toEqual({ hide: true });
    // The CLI by its path: the window's shell has launchd's PATH, not the user's.
    const argv = terminalOpened();
    expect(argv.at(-1)).toMatch(new RegExp(`^cd ${CWD.notes} && exec (\\S*/)?claude --resume ${ID.done}$`));
    host.changeSettings("sessions", { settings: { terminal: "tmux" } });
    n = asked().length;
    expect(await pick(key("claude", ID.done), "resume")).toEqual({ hide: true });
    expect(since(n).find((l) => l.startsWith("tmux new-window"))).toMatch(new RegExp(`^tmux new-window -c ${CWD.notes} (\\S*/)?claude --resume ${ID.done}$`));
    host.changeSettings("sessions", { settings: {} });
  });

  test("the link: a hook's state wins over the files for ten minutes and marks the row exact", async () => {
    expect(await host.request<unknown>("link", { extension: "sessions", route: "state", params: { agent: "claude", session: ID.claude, state: "blocked" } })).toEqual({});
    const item = (await list()).find((i) => i.id === key("claude", ID.claude))!;
    expect(item.section).toBe("Waiting on you?");
    expect(tag(item)).toBe("waiting on you");
    const d = await host.detail("sessions", "sessions", key("claude", ID.claude));
    expect(d.metadata!.find((m) => m.label === "State")!.tags).toEqual([{ text: "waiting on you", color: "red" }, { text: "from a hook", color: "grey" }]);
    expect(host.coreCalls.some((c) => c.method === "storage.set" && (c.params as { key: string }).key === `exact:claude:${ID.claude}`)).toBe(true);
    await host.request("link", { extension: "sessions", route: "state", params: { agent: "claude", session: ID.claude, state: "working" } });
    expect((await list()).find((i) => i.id === key("claude", ID.claude))!.section).toBe("Working");
    await expect(host.request("link", { extension: "sessions", route: "state", params: { agent: "gemini", session: "x", state: "working" } })).rejects.toThrow("agent must be one of claude, codex, copilot");
    await expect(host.request("link", { extension: "sessions", route: "state", params: { agent: "claude", session: "x", state: "idle" } })).rejects.toThrow("state must be working, waiting or blocked");
  });
});

describe("sessions: the bar", () => {
  test("the strip: the count, a segment per state, urgent while one is blocked, the tooltip; the popover passes the check", async () => {
    const item = await render();
    expect(item).toMatchObject({ icon: "\u{f0674}", urgent: true, tooltip: "5 sessions: 1 waiting on you, 1 your turn, 2 working, 1 ended", segments: [{ id: "blocked", text: "1", color: "red" }, { id: "waiting", text: "1", color: "amber" }, { id: "working", text: "2", color: "blue" }, { id: "ended", text: "1", color: "muted" }] });
    expect(checkBarItem(item)).toBeTruthy();
    const v = menuView(item);
    expect(v).toMatchObject({ id: "sessions", keys: "actions", title: "5 sessions" });
    expect(texts(v).slice(0, 8)).toEqual(["Waiting on you?", "", "deploy it", "api · main · tmux work:0.1", expect.any(String), "Your turn", "", "Review Issue 4258 Status"]);
    expect(badges(v)).toEqual(["1", "waiting on you?", "1", "your turn", "2", "working", "working", "1", "ended"]);
    expect(keycaps(v)).toEqual(["enter", "t", "o", "r", "x", "s", "p", "up", "down"]);
    // The ring is on the first row; its actions lead with Focus and offer Send (a tmux pane) and Kill with a confirm.
    const rows = nodes(v.tree).filter((n) => n.type === "stack" && n.action?.startsWith("focus:"));
    expect(rows.map((r) => r.selected)).toEqual([true, undefined, undefined, undefined, undefined]);
    expect(v.actions.slice(0, 7).map((a) => [a.id, a.shortcut])).toEqual([["focus", "enter"], ["view", ["t", "cmd+t"]], ["transcript", ["o", "cmd+o"]], ["copy-resume", ["r", "cmd+c"]], ["kill", ["x", "cmd+d"]], ["send", "s"], ["pal", "p"]]);
    expect(v.actions.find((a) => a.id === "kill")).toMatchObject({ style: "destructive", confirm: "Send SIGTERM to Claude Code (pid 41000)?" });
  });

  test("the keys: arrows and a click move the ring, o opens the transcript, r copies, x kills, p and s push the palette, Enter focuses or resumes", async () => {
    const view = (r: Record<string, unknown>) => checkView((r as { view: View }).view);
    let n = asked().length;
    expect(await act("transcript")).toEqual({ hide: true });
    expect(since(n)).toContain(`code ${claudeFile(ID.blocked, CWD.api)}`);
    expect(await act("copy-resume")).toEqual({ copy: `claude --resume ${ID.blocked}` });
    n = asked().length;
    expect(await act("kill")).toEqual({ keep: true, hud: "Sent SIGTERM to 41000" });
    expect(since(n)).toContain("kill -TERM 41000");
    expect(await act("pal")).toEqual({ push: { extension: "sessions", palette: "sessions" } });
    expect(await act("send")).toEqual({ push: { extension: "sessions", palette: "sessions", query: ID.blocked.slice(0, 8) } });
    // Down lands on the copilot row, then the pal session (no tmux pane: no Send), then the codex one.
    const ring = (v: View) => nodes(v.tree).filter((x) => x.type === "stack" && x.action?.startsWith("focus:")).find((x) => x.selected)?.key;
    let v = view(await act("down"));
    expect(ring(v)).toBe(key("copilot", ID.copilot));
    v = view(await act("down"));
    expect(ring(v)).toBe(key("claude", ID.claude));
    expect(v.actions.map((a) => a.id)).not.toContain("send");
    v = view(await act("down"));
    expect(ring(v)).toBe(key("codex", ID.codex));
    expect(await act("copy-resume")).toEqual({ copy: `codex resume ${ID.codex}` });
    // Up from the first wraps to the last, the ended one: Enter resumes.
    v = view(await act(`focus:${key("claude", ID.blocked)}`));
    v = view(await act("up"));
    expect(ring(v)).toBe(key("claude", ID.done));
    expect(v.actions[0]).toEqual({ id: "resume", title: "Resume in a terminal", shortcut: "enter" });
    expect(keycaps(v)).toEqual(["enter", "t", "o", "r", "p", "up", "down"]);
    expect(await act("resume")).toEqual({ hide: true });
    expect(terminalOpened().at(-1)).toMatch(new RegExp(`^cd ${CWD.notes} && exec (\\S*/)?claude --resume ${ID.done}$`));
    // Enter on the pal session: the kitty window.
    v = view(await act(`focus:${key("claude", ID.claude)}`));
    n = asked().length;
    expect(await act("focus")).toEqual({ hide: true });
    expect(since(n).slice(-2)).toEqual(["kitten @ --to unix:/tmp/mykitty-500 focus-window --match id:7", "open -a kitty"]);
  });

  test("a write under a watched directory asks the bar for a render within a second", async () => {
    const n = host.coreCalls.filter((c) => c.method === "bar.refresh").length;
    writeFileSync(claudeFile(ID.claude, CWD.pal), claude.user(ID.claude, CWD.pal, Date.now(), "and the README") + "\n", { flag: "a" });
    await host.until(() => host.coreCalls.filter((c) => c.method === "bar.refresh").length > n, 2000, "bar.refresh");
    expect(host.coreCalls.filter((c) => c.method === "bar.refresh").at(-1)!.params).toEqual({ extension: "sessions", id: "sessions" });
    // The appended line was folded, not the whole file again: the prompt moved on.
    expect((await host.detail("sessions", "sessions", key("claude", ID.claude))).markdown).toContain("> and the README");
  });

  test("the mocks in pal.json pass checkBarItem; the popover over made-up sessions: six rows then 'and N more in pal'", () => {
    const mocks = host.manifests.get("sessions")!.bar!.sessions.mocks!;
    expect(Object.keys(mocks)).toEqual(["working", "attention", "mixed", "ended", "hidden"]);
    for (const m of Object.values(mocks)) expect(checkBarItem(m.item)).toBeTruthy();
    expect(mocks.attention.item.urgent).toBe(true);
    expect(mocks.hidden.item).toEqual({ hidden: true, empty: { icon: "\u{f0674}", tooltip: "No sessions" } });
    const mk = (i: number, state: Session["state"]): Session => ({ key: `claude:${i}`, agent: "claude", id: String(i), cwd: `/x/${i}`, title: `Session ${i}`, file: "/x", started: T, last: T, turns: 1, tokens: {}, promptAt: T, state, stateAt: T - i * 1000 });
    const sessions = [mk(1, "working"), mk(2, "waiting"), mk(3, "blocked"), mk(4, "ended"), mk(5, "working"), mk(6, "working"), mk(7, "waiting"), mk(8, "working")];
    const v = checkView(renderPopover({ sessions, cursor: "claude:7", now: T }));
    expect(shown(sessions).map((x) => x.key)).toEqual(["claude:3", "claude:2", "claude:7", "claude:1", "claude:5", "claude:6"]);
    expect(texts(v)).toContain("and 2 more in pal");
    expect(nodes(v.tree).find((x) => x.selected)?.key).toBe("claude:7");
    expect(actions({ sessions, cursor: "claude:7", now: T }).map((a) => a.id)).toEqual(["focus", "view", "transcript", "copy-resume", "kill", "pal", "down", "up", "focus:claude:3", "focus:claude:2", "focus:claude:7", "focus:claude:1", "focus:claude:5", "focus:claude:6"]);
  });
});
