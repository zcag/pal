// Shell: an input palette that runs one command and shows what it
// printed. Typing never runs anything: the listing is one "Run: <cmd>"
// row until Enter, and a command that looks destructive (`rm`, `sudo`,
// `mv`, ...; run.ts) asks first while the `confirm` setting is on. The
// command runs through the login shell (`$SHELL -lic`, so PATH and
// aliases apply) in `cwd` with the `env` list on top, for `timeout`
// seconds at most, and the answer is a view level: the command as the
// title, the exit code and the duration as badges, stdout in mono on a
// sunken surface with stderr under it in red, scrolling past the panel.
// A command still running when the pick has to answer gets a running
// view at once and the result pushed in with `view.update` when it ends
// (the panel's pick limit is 10 s; the timeout may be longer). In the
// view Enter copies the output, cmd+Enter opens the command in a
// terminal, cmd+r runs it again, cmd+c copies the command. Every run
// lands in the history palette (storage, the last hundred) with its exit
// code; `$ ls` at the root lists the Run row inline.
import { failed, hint, home, oneLine, settings, storage, tilde, toast, truncate, view as viewApi, type Action, type Ctx, type Effect, type Extension, type Item, type View, type ViewNode } from "@zcag/pal";
import { duration, envTable, looksDestructive, PICK_GRACE_MS, run, shellArgv, terminalArgv, type Run } from "./run.ts";

/** `[extensions.shell]`, defaults in pal.json. */
type Settings = { shell: string; cwd: string; timeout: number; env: string[]; confirm: boolean; terminal: string };

/** Material Design glyphs from the bundled Nerd Font; the tile's slate tints them. */
const GLYPH = {
  run: "\u{f07b7}", // md-console_line
  history: "\u{f02da}", // md-history
  broom: "\u{f00e2}", // md-broom
  alert: "\u{f05d6}", // md-alert_circle_outline
};

const RUN: Action = { id: "run", title: "Run" };
const TERMINAL: Action = { id: "terminal", title: "Run in terminal" };
const COPY_CMD: Action = { id: "copy_cmd", title: "Copy command", shortcut: "cmd+c" };
const REMOVE: Action = { id: "remove", title: "Remove from history", shortcut: "cmd+d", style: "destructive" };
const CLEAR: Action = { id: "clear", title: "Clear history", style: "destructive", confirm: "Forget every command in the history?" };

/** How much of the output the view draws (the clipboard gets it all, up to run.ts's cap). */
export const VIEW_CHARS = 64 * 1024;
const HISTORY_MAX = 100;
const VIEW_ID = "run";

const S = (): Settings => settings.get<Settings>();
const cwdOf = (s: Settings) => home(s.cwd?.trim() || "~");
const short = (text: string, n = 80) => truncate(oneLine(text), n);

// ---- history ------------------------------------------------------------------------

type Entry = { cmd: string; code: number | null; at: number; ms: number; cwd?: string; timedOut?: boolean };
const history = async (): Promise<Entry[]> => ((await storage.get<Entry[]>("history")) ?? []).filter((e) => e && typeof e.cmd === "string");

async function remember(r: Run, cwd: string): Promise<void> {
  const list = (await history()).filter((e) => e.cmd !== r.cmd);
  list.unshift({ cmd: r.cmd, code: r.code, at: r.startedAt, ms: r.ms, cwd, ...(r.timedOut && { timedOut: true }) });
  await storage.set("history", list.slice(0, HISTORY_MAX));
}

// ---- running -----------------------------------------------------------------------

/** The run the view shows, or the one in flight; `pick` from the view reaches it by the view id. */
type Live = { cmd: string; cwd: string; startedAt: number; /** Which palette's level shows it: the pushes go there. */ palette: "shell" | "history"; result?: Run; ticker?: ReturnType<typeof setInterval> };
let live: Live | undefined;

/** The tree for a run in flight, or done. */
export function tree(l: Live, now = Date.now()): ViewNode {
  const r = l.result;
  const badges: ViewNode[] = r
    ? [
        r.timedOut ? { type: "badge", text: `killed after ${duration(r.ms)}`, color: "red" } : { type: "badge", text: r.code === 0 ? "exit 0" : `exit ${r.code ?? "?"}`, color: r.code === 0 ? "green" : "red" },
        { type: "text", value: duration(r.ms), style: "muted", size: "sm" },
        ...(r.truncated ? [{ type: "badge", text: "output cut", color: "amber" } as ViewNode] : []),
      ]
    : [{ type: "badge", text: "running", color: "blue" }, { type: "text", value: duration(now - l.startedAt), style: "muted", size: "sm" }];
  const body: ViewNode[] = [];
  const out = r?.out ?? "", err = r?.err ?? "";
  const cut = (s: string) => (s.length > VIEW_CHARS ? `…${s.slice(-VIEW_CHARS)}` : s);
  if (out.trim()) body.push({ type: "text", key: "out", value: cut(out.replace(/\n$/, "")), style: "mono" });
  if (err.trim()) body.push({ type: "text", key: "err", value: cut(err.replace(/\n$/, "")), style: "mono", color: "red" });
  if (r && !body.length) body.push({ type: "text", key: "none", value: "(no output)", style: "muted", size: "sm" });
  if (!r) body.push({ type: "text", key: "wait", value: "Waiting for the command…", style: "muted", size: "sm" });
  return {
    type: "stack", direction: "column", gap: 2, padding: 3, children: [
      { type: "stack", direction: "row", gap: 2, align: "center", key: "head", children: [{ type: "text", value: `$ ${l.cmd}`, style: "mono", weight: "semibold" }, { type: "spacer" }, ...badges] },
      { type: "stack", direction: "row", gap: 2, key: "where", children: [{ type: "text", value: tilde(l.cwd), style: "muted", size: "xs" }] },
      { type: "stack", direction: "column", gap: 1, padding: 3, surface: "sunken", radius: true, grow: true, key: "output", children: body },
    ],
  };
}

const VIEW_ACTIONS: Action[] = [
  { id: "copy", title: "Copy output" },
  { id: "terminal", title: "Open in terminal" },
  { id: "rerun", title: "Run again", shortcut: "cmd+r" },
  { id: "copy_cmd", title: "Copy command", shortcut: "cmd+c" },
  { id: "copy_err", title: "Copy stderr", shortcut: "cmd+shift+e" },
];

const viewOf = (l: Live): View => ({ id: VIEW_ID, title: `$ ${short(l.cmd, 60)}`, tree: tree(l), actions: VIEW_ACTIONS });

/** Pushes the live tree into the open view (dropped by the core while none is open). */
const push = (l: Live) => viewApi.update(tree(l), { palette: l.palette, id: VIEW_ID, extension: "shell" }).catch(() => {});

/** Starts the command; the run's end lands in `live` and is pushed to the view, the history updated. */
function start(cmd: string, palette: Live["palette"]): Live {
  const s = S();
  const l: Live = { cmd, cwd: cwdOf(s), startedAt: Date.now(), palette };
  if (live?.ticker) clearInterval(live.ticker);
  live = l;
  run(cmd, { shell: shellArgv(s.shell), cwd: l.cwd, env: envTable(s.env ?? []), timeout: Math.max(1, s.timeout || 10) }).then(async (r) => {
    l.result = r;
    if (l.ticker) { clearInterval(l.ticker); l.ticker = undefined; }
    if (live === l) await push(l);
    await remember(r, l.cwd);
  });
  return l;
}

/** Answers within the grace: the finished view, else the running one with a 1 Hz tick of the elapsed time pushed while it runs. */
async function answer(l: Live): Promise<Effect> {
  const t0 = Date.now();
  while (!l.result && Date.now() - t0 < PICK_GRACE_MS) await Bun.sleep(25);
  if (!l.result) l.ticker = setInterval(() => { if (live === l && !l.result) push(l); else if (l.ticker) clearInterval(l.ticker); }, 1000);
  return { view: viewOf(l) };
}

// A view level opened while a run was in flight gets the current tree (the push may have gone out before the level reported itself).
viewApi.onShown((ev) => { if (live && ev.palette === live.palette) push(live); }, "shell");

// ---- rows -------------------------------------------------------------------------


/** The one row a typed command gets: Run (with a confirm when it looks destructive), Run in terminal, Copy. */
function runRow(cmd: string, s: Settings): Item {
  const ask = s.confirm && looksDestructive(cmd);
  const runAction: Action = ask ? { ...RUN, confirm: `Run “${short(cmd, 60)}”? It looks like it removes, overwrites or escalates.`, style: "destructive" } : RUN;
  return {
    id: `run:${cmd}`, name: `Run: ${cmd}`, subtitle: `${shellArgv(s.shell).join(" ")} in ${tilde(cwdOf(s))}, ${s.timeout || 10} s at most${ask ? " · asks first" : ""}`, icon: GLYPH.run, keywords: [cmd],
    actions: [runAction, TERMINAL, COPY_CMD],
  };
}

/** `$ ls` or `> ls` at the root (and inside, for symmetry): the command after the marker. */
const strip = (query: string) => query.replace(/^\s*[$>]\s+/, "").trim();

async function list(query = "", ctx?: Ctx): Promise<Item[]> {
  const s = S();
  const cmd = strip(query);
  if (!cmd) {
    if (ctx?.inline) return [];
    return [
      hint("type", "Type a command and press Enter to run it", `${shellArgv(s.shell).join(" ")} in ${tilde(cwdOf(s))}, ${s.timeout || 10} s at most`),
      hint("root", "At the root, $ or > before the command", "$ ls -la · > git status"),
      hint("history", "Past commands are in Shell History", "With their exit codes; Enter runs one again", { icon: GLYPH.history }),
    ];
  }
  return [runRow(cmd, s)];
}

async function openTerminal(cmd: string): Promise<Effect> {
  const s = S();
  const argv = terminalArgv(cmd, cwdOf(s), shellArgv(s.shell), s.terminal ?? "");
  if (!argv) return toast("No terminal to open", "Set terminal under Settings › Extensions › Shell, or $TERMINAL", "failure");
  try { Bun.spawn(argv, { stdio: ["ignore", "ignore", "ignore"], detached: true }).unref(); } catch (e) { return failed("open the terminal", e); }
  return { hide: true };
}

async function pick(id: string, action?: string): Promise<Effect> {
  if (id === VIEW_ID) {
    const l = live;
    if (!l) return { keep: true, toast: { title: "Nothing ran yet", style: "failure" } };
    switch (action) {
      case "terminal": return openTerminal(l.cmd);
      case "rerun": return answer(start(l.cmd, l.palette));
      case "copy_cmd": return { copy: l.cmd };
      case "copy_err": return l.result?.err ? { copy: l.result.err } : { keep: true, toast: { title: "No stderr", message: l.result ? "The command wrote nothing to stderr" : "Still running" } };
      default:
        if (!l.result) return { keep: true, toast: { title: "Still running", message: "Copy once it has finished" } };
        return { copy: l.result.out || l.result.err, hud: l.result.out ? "Copied output" : l.result.err ? "Copied stderr (no output)" : "Nothing to copy" };
    }
  }
  if (!id.startsWith("run:")) return { keep: true, toast: { title: "Not a command", style: "failure" } };
  const cmd = id.slice(4);
  switch (action) {
    case "terminal": return openTerminal(cmd);
    case "copy_cmd": return { copy: cmd };
    default: return answer(start(cmd, "shell"));
  }
}

// ---- history palette -----------------------------------------------------------------

const historyId = (e: Entry) => `h:${e.cmd}`;

async function historyRows(query = ""): Promise<Item[]> {
  const list = await history();
  const q = query.trim().toLowerCase();
  const rows = list.filter((e) => !q || e.cmd.toLowerCase().includes(q)).map((e): Item => ({
    id: historyId(e), name: e.cmd, subtitle: `${duration(e.ms)} in ${tilde(e.cwd ?? cwdOf(S()))}`, icon: GLYPH.run, keywords: [e.cmd],
    accessories: [e.timedOut ? { tag: "killed", color: "red" } : { tag: `exit ${e.code ?? "?"}`, color: e.code === 0 ? "green" : "red" }, { date: e.at }],
    actions: [
      S().confirm && looksDestructive(e.cmd) ? { ...RUN, title: "Run again", confirm: `Run “${short(e.cmd, 60)}” again? It looks like it removes, overwrites or escalates.`, style: "destructive" } : { ...RUN, title: "Run again" },
      TERMINAL, COPY_CMD, REMOVE,
    ],
  }));
  if (!list.length) return [hint("empty", "Nothing ran yet", "Commands you run in Shell land here with their exit codes", { icon: GLYPH.history })];
  if (!q) rows.push({ id: "clear", name: "Clear history", subtitle: `${list.length} ${list.length === 1 ? "command" : "commands"}`, icon: GLYPH.broom, actions: [CLEAR] });
  return rows;
}

async function historyPick(id: string, action?: string): Promise<Effect> {
  if (id === VIEW_ID) return pick(id, action);
  if (id === "clear") { await storage.remove("history"); return { keep: true, toast: { title: "History cleared" } }; }
  if (!id.startsWith("h:")) return { keep: true, toast: { title: "Not a command", style: "failure" } };
  const cmd = id.slice(2);
  switch (action) {
    case "terminal": return openTerminal(cmd);
    case "copy_cmd": return { copy: cmd };
    case "remove": await storage.set("history", (await history()).filter((e) => e.cmd !== cmd)); return { keep: true, toast: { title: "Removed", message: short(cmd, 60) } };
    default: return answer(start(cmd, "history"));
  }
}

export default {
  palettes: {
    shell: {
      title: "Shell",
      input: true,
      // `$ ls` or `> ls` at the root lists the Run row inline; Enter there runs it.
      match: /^[$>] \S/,
      inline: true,
      placeholder: "A command to run in your shell",
      list,
      pick,
    },
    history: {
      title: "Shell History",
      // Input, not live: a listing per keystroke keeps it current after a run without putting commands at the root, where an Enter would run one.
      input: true,
      placeholder: "Search past commands",
      list: historyRows,
      pick: historyPick,
    },
  },
  dispose: () => { if (live?.ticker) clearInterval(live.ticker); },
} satisfies Extension;
