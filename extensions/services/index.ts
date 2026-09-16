// Services (replaces the v1 `systemd` script palette): one live palette
// over the OS's service manager. Linux: systemd units, `systemctl --user`
// and the system manager, four filters (User, System, Failed, Running);
// Enter starts a stopped unit and stops a running one, a system unit after
// a confirm and through whichever of `systemctl` itself, `sudo -n` and
// `pkexec` is allowed to. macOS: launchd jobs from `launchctl list` and the
// agent plists in ~/Library/LaunchAgents and /Library/LaunchAgents, with
// bootstrap/bootout for Load/Unload. Logs and plists open as `show`
// levels. `PAL_SERVICES_BACKEND` forces a backend (the tests run both on
// one machine, against fake binaries on PATH).
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { home, settings, xdg, type Accessory, type Action, type Extension, type Item, type Metadata, type TagColor } from "@zcag/pal";

/** `[extensions.services]`, defaults in pal.json. */
type Settings = { ttl: number; confirm_user: boolean; agent_dirs: string[] };
const S = () => settings.get<Settings>();
/** `ttl` is palette meta, read once at load (a change takes effect on the next reload). */
const TTL = S().ttl;

type Backend = "systemd" | "launchd";
const forced = process.env.PAL_SERVICES_BACKEND as Backend | undefined;
const BACKEND: Backend = forced === "systemd" || forced === "launchd" ? forced : process.platform === "linux" ? "systemd" : "launchd";

const ICON = xdg("preferences-system") ?? "⚙";
const LOG_LINES = 200;
const LIST_MS = 8_000;
/** The core drops a pick unanswered after 10 s: a slower verb (a stop waiting on TimeoutStopSec, a polkit prompt) goes on without us and the toast says so. */
const WAIT_MS = 8_000;
const ACT_MS = 120_000;

// ---- shared ---------------------------------------------------------------

/** `pending`: still running when `WAIT_MS` passed; it goes on by itself (killed at `ms`). */
type Run = { code: number; out: string; err: string; pending?: true };

/** One command, answered within `WAIT_MS`, killed after `ms`; never throws (a missing binary is exit 127). */
async function run(argv: string[], ms: number): Promise<Run> {
  if (!Bun.which(argv[0])) return { code: 127, out: "", err: `${argv[0]}: not found` };
  const proc = Bun.spawn(argv, { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => proc.kill(), ms);
  const outP = new Response(proc.stdout).text(), errP = new Response(proc.stderr).text();
  const code = await Promise.race([proc.exited, Bun.sleep(WAIT_MS).then(() => undefined)]);
  if (code === undefined) { proc.exited.then(() => clearTimeout(timer)); proc.unref(); return { code: -1, out: "", err: "", pending: true }; }
  const [out, err] = await Promise.all([outP, errP]);
  clearTimeout(timer);
  return { code, out, err: err.trim() };
}

/** The toast for a verb that is still going: the palette lists again (⌘R later shows the outcome). */
const pending = (what: string) => ({ keep: true as const, toast: { title: `${what} not done yet`, message: `Still running after ${WAIT_MS / 1000} s; it goes on in the background` } });

const hint = (name: string, subtitle: string): Item => ({ id: `hint:${name}`, name, subtitle, icon: ICON, actions: [] });
const fail = (title: string, message: string) => ({ keep: true as const, toast: { title, message, style: "failure" as const } });
const lastLine = (r: Run) => r.err.split("\n").filter(Boolean).slice(-1)[0] || `exit ${r.code}`;
/** Four backticks fence the text so a ``` inside cannot end it early. */
const fence = (s: string, lang = "") => "````" + lang + "\n" + s.replace(/````/g, "```​`") + "\n````";
const show = (title: string, text: string, lang = "") => ({ show: { title, markdown: text.trim() ? fence(text.replace(/\n+$/, ""), lang) : "_No output._" } });

// ---- systemd ----------------------------------------------------------------

type Scope = "user" | "system";
/** `systemctl list-units --output=json`. */
type UnitRow = { unit: string; load: string; active: string; sub: string; description: string };
/** `systemctl list-unit-files --output=json`. */
type FileRow = { unit_file: string; state: string };

const SYSTEMD_FILTERS = [
  { id: "user", title: "User" },
  { id: "system", title: "System" },
  { id: "failed", title: "Failed" },
  { id: "running", title: "Running" },
];

const ACTIVE_COLOR: Record<string, TagColor> = { active: "green", failed: "red", activating: "amber", deactivating: "amber", reloading: "amber", inactive: "grey" };
/** What the last listing said, by row id: Enter toggles on it, and Enable/Disable flips on it. */
const units = new Map<string, { scope: Scope; unit: string; active: boolean; enabled?: string }>();

const systemctl = (scope: Scope, ...args: string[]) => ["systemctl", ...(scope === "user" ? ["--user"] : []), "--no-pager", ...args];
const journalctl = (scope: Scope, unit: string) => ["journalctl", ...(scope === "user" ? ["--user"] : []), "-u", unit, "-n", String(LOG_LINES), "--no-pager"];

function unitActions(scope: Scope, active: boolean, enabled?: string): Action[] {
  const ask = scope === "system" || S().confirm_user;
  const confirm = (what: string) => (ask ? { confirm: `${what} this ${scope} unit?` } : {});
  // A static, generated or transient unit has no [Install] section: nothing to enable.
  const flip: Action[] = enabled && ["static", "generated", "transient", "masked"].includes(enabled) ? [] : [enabled === "enabled" ? { id: "disable", title: "Disable", shortcut: "cmd+e", ...confirm("Disable") } : { id: "enable", title: "Enable", shortcut: "cmd+e" }];
  return [
    active ? { id: "stop", title: "Stop", ...confirm("Stop") } : { id: "start", title: "Start" },
    { id: "logs", title: "Logs", shortcut: "cmd+l" },
    { id: "restart", title: "Restart", shortcut: "cmd+shift+r", ...confirm("Restart") },
    ...flip,
    { id: "copy", title: "Copy unit name", shortcut: "cmd+c" },
  ];
}

function unitItem(scope: Scope, r: UnitRow, enabled: string | undefined, section: boolean): Item {
  const id = `${scope}:${r.unit}`;
  const active = r.active === "active" || r.active === "activating" || r.active === "reloading";
  units.set(id, { scope, unit: r.unit, active, enabled });
  const accessories: Accessory[] = [];
  if (enabled && enabled !== "static" && enabled !== "generated" && enabled !== "transient") accessories.push({ text: enabled });
  // `running` for an active unit, `failed` rather than `failed/failed`, else both states.
  accessories.push({ tag: r.active === "active" || r.active === r.sub ? r.sub : `${r.active}/${r.sub}`, color: ACTIVE_COLOR[r.active] ?? "grey" });
  const metadata: Metadata[] = [
    { label: "Unit", value: r.unit },
    { label: "Scope", value: scope },
    { label: "Load", value: r.load },
    { label: "Active", value: `${r.active} (${r.sub})` },
    ...(enabled ? [{ label: "Unit file", value: enabled }] : []),
  ];
  return {
    id,
    name: r.unit.replace(/\.service$/, ""),
    subtitle: r.description !== r.unit ? r.description : undefined,
    icon: ICON,
    keywords: [r.unit, scope],
    accessories,
    detail: { metadata },
    ...(section ? { section: scope === "user" ? "User" : "System" } : {}),
    actions: unitActions(scope, active, enabled),
  };
}

/**
 * The units of one scope: what `list-units --all` has in memory, in its
 * order, then the unit files it has not loaded (a disabled service that
 * never ran is only in `list-unit-files`), inactive, without a description.
 * Templates (`name@.service`), masked and alias files are not units to run.
 */
async function scopeUnits(scope: Scope, state?: string, section = false): Promise<Item[] | Run> {
  const r = await run(systemctl(scope, "list-units", "--type=service", "--all", "--output=json", ...(state ? [`--state=${state}`] : [])), LIST_MS);
  if (r.code !== 0) return r;
  let rows: UnitRow[] = [];
  try { rows = JSON.parse(r.out || "[]"); } catch { return { ...r, code: 1, err: "systemctl gave no JSON (systemd 245 or later is needed)" }; }
  const files = await run(systemctl(scope, "list-unit-files", "--type=service", "--output=json"), LIST_MS);
  const enabled = new Map<string, string>();
  if (files.code === 0) { try { for (const f of JSON.parse(files.out || "[]") as FileRow[]) enabled.set(f.unit_file, f.state); } catch {} }
  if (!state) {
    const loaded = new Set(rows.map((u) => u.unit));
    for (const [unit, st] of enabled) if (!loaded.has(unit) && !unit.includes("@.") && !["masked", "masked-runtime", "alias"].includes(st)) rows.push({ unit, load: "not loaded", active: "inactive", sub: "dead", description: unit });
  }
  // An instance (`app-foo@autostart.service`) is enabled through its template (`app-foo@.service`).
  return rows.map((u) => unitItem(scope, u, enabled.get(u.unit) ?? enabled.get(u.unit.replace(/@[^.]*\./, "@.")), section));
}

async function listSystemd(filter = "user"): Promise<Item[]> {
  if (!Bun.which("systemctl")) return [hint("systemctl is not installed", "This palette lists systemd units on Linux")];
  if (filter === "user" || filter === "system") {
    const r = await scopeUnits(filter);
    if (!Array.isArray(r)) return [hint(`Could not list ${filter} units`, lastLine(r))];
    return r.length ? r : [hint(`No ${filter} services`, "systemctl list-units --type=service --all lists nothing")];
  }
  const state = filter === "failed" ? "failed" : "running";
  const both = await Promise.all([scopeUnits("user", state, true), scopeUnits("system", state, true)]);
  const items = both.flatMap((r) => (Array.isArray(r) ? r : []));
  const errors = both.filter((r): r is Run => !Array.isArray(r));
  if (!items.length && errors.length === 2) return [hint("Could not list units", lastLine(errors[0]))];
  return items.length ? items : [hint(`No ${state} services`, "Neither the user nor the system manager has one")];
}

const needsAuth = (r: Run) => /interactive authentication|access denied|permission denied|not permitted|authentication is required/i.test(r.err);

/**
 * A system unit's verb: `systemctl` itself first (a polkit rule may allow
 * it), then `sudo -n` (a credential window opened by `sudo -v` in a
 * terminal), then `pkexec` (a polkit agent's prompt). The first that is
 * not a permission refusal answers.
 */
async function privileged(argv: string[]): Promise<Run> {
  const plain = await run(argv, ACT_MS);
  if (plain.code === 0 || plain.pending || !needsAuth(plain)) return plain;
  const sudo = await run(["sudo", "-n", ...argv], ACT_MS);
  if (sudo.code === 0 || sudo.pending || (sudo.code !== 127 && !/password is required|a terminal is required|not allowed|may not run sudo/i.test(sudo.err))) return sudo;
  // Its prompt outlives the pick: an answer typed later still runs the verb, only the toast is gone by then.
  const pk = await run(["pkexec", ...argv], ACT_MS);
  if (pk.code === 0 || pk.pending) return pk;
  return { ...pk, err: `Not permitted: ${plain.err.split("\n")[0]}\nsudo -n: ${sudo.err.split("\n")[0] || `exit ${sudo.code}`}\npkexec: ${pk.err.split("\n")[0] || `exit ${pk.code}`}` };
}

async function pickSystemd(id: string, action?: string) {
  const u = units.get(id);
  if (!u) return fail("Unit not listed", "List again first");
  action ??= u.active ? "stop" : "start";
  switch (action) {
    case "copy": return { copy: u.unit };
    case "logs": {
      const r = await run(journalctl(u.scope, u.unit), LIST_MS);
      return show(`${u.unit} logs`, r.out || r.err);
    }
    case "start": case "stop": case "restart": case "enable": case "disable": {
      const argv = systemctl(u.scope, "--no-ask-password", action, u.unit);
      const r = u.scope === "system" ? await privileged(argv) : await run(argv, ACT_MS);
      const done = { start: "Started", stop: "Stopped", restart: "Restarted", enable: "Enabled", disable: "Disabled" }[action];
      if (r.pending) return pending(`${action} ${u.unit}`);
      if (r.code !== 0) return fail(`Could not ${action} ${u.unit}`, r.err.startsWith("Not permitted") ? r.err : lastLine(r));
      return { keep: true as const, toast: { title: `${done} ${u.unit}` } };
    }
  }
  return { keep: true as const };
}

// ---- launchd -------------------------------------------------------------------

const LAUNCHD_FILTERS = [
  { id: "agents", title: "Agents" },
  { id: "loaded", title: "Loaded" },
  { id: "running", title: "Running" },
];

type Job = { label: string; pid?: number; status?: number };
type Agent = { label: string; plist: string; program?: string; dir: string };
/** What the last listing said, by label: Load needs the plist path, the rest the domain. */
const jobs = new Map<string, { plist?: string; loaded: boolean }>();
const domain = () => `gui/${process.getuid?.() ?? 501}`;

/** `launchctl list`: `PID\tStatus\tLabel`, PID `-` when not running. */
async function launchctlList(): Promise<Map<string, Job> | Run> {
  const r = await run(["launchctl", "list"], LIST_MS);
  if (r.code !== 0) return r;
  const out = new Map<string, Job>();
  for (const line of r.out.split("\n").slice(1)) {
    const [pid, status, label] = line.split("\t");
    if (!label) continue;
    out.set(label, { label, pid: pid === "-" ? undefined : Number(pid), status: status === "-" ? undefined : Number(status) });
  }
  return out;
}

/** A plist's text as XML: as it is when it already is, through `plutil` for a binary one. */
async function plistXml(file: string): Promise<string> {
  const raw = readFileSync(file);
  if (!raw.subarray(0, 6).equals(Buffer.from("bplist"))) return raw.toString();
  const r = await run(["plutil", "-convert", "xml1", "-o", "-", file], LIST_MS);
  return r.code === 0 ? r.out : raw.toString("latin1");
}

/** The `<string>` after `<key>name</key>`, the first `<string>` of its `<array>` for `ProgramArguments`. */
const plistString = (xml: string, key: string) => xml.match(new RegExp(`<key>${key}</key>\\s*(?:<array>\\s*)?<string>([^<]*)</string>`))?.[1];

async function agents(dirs: string[]): Promise<Agent[]> {
  const out: Agent[] = [];
  for (const d of dirs) {
    const dir = home(d);
    let files: string[] = [];
    try { files = readdirSync(dir).filter((f) => f.endsWith(".plist")).sort(); } catch { continue; }
    for (const f of files) {
      const plist = join(dir, f);
      let xml = "";
      try { xml = await plistXml(plist); } catch { continue; }
      out.push({ label: plistString(xml, "Label") ?? f.replace(/\.plist$/, ""), plist, program: plistString(xml, "Program") ?? plistString(xml, "ProgramArguments"), dir });
    }
  }
  return out;
}

const shortPath = (p: string) => (p.startsWith(home("~") + "/") ? "~" + p.slice(home("~").length) : p);

function jobActions(loaded: boolean, plist?: string): Action[] {
  const a: Action[] = [];
  if (loaded) a.push({ id: "unload", title: "Unload", confirm: "Unload this job? launchd stops it and forgets it until it is loaded again." }, { id: "restart", title: "Restart", shortcut: "cmd+shift+r" });
  else if (plist) a.push({ id: "load", title: "Load" });
  if (plist) a.push({ id: "show", title: "Show plist", shortcut: "cmd+l" }, { id: "open", title: "Open plist file", shortcut: "cmd+o" });
  a.push({ id: "copy", title: "Copy label", shortcut: "cmd+c" });
  return a;
}

function jobItem(label: string, job: Job | undefined, agent: Agent | undefined, section?: string): Item {
  const loaded = job !== undefined;
  jobs.set(label, { plist: agent?.plist, loaded });
  const accessories: Accessory[] = [];
  if (job?.pid) accessories.push({ text: `pid ${job.pid}` });
  const tag = job?.pid ? { tag: "running", color: "green" as TagColor } : loaded ? (job?.status ? { tag: `exit ${job.status}`, color: "red" as TagColor } : { tag: "loaded", color: "blue" as TagColor }) : { tag: "not loaded", color: "grey" as TagColor };
  accessories.push(tag);
  const metadata: Metadata[] = [
    { label: "Label", value: label },
    ...(agent ? [{ label: "Plist", value: shortPath(agent.plist) }] : []),
    ...(agent?.program ? [{ label: "Program", value: agent.program }] : []),
    { label: "State", value: job?.pid ? `running, pid ${job.pid}` : loaded ? `loaded, last exit ${job?.status ?? 0}` : "not loaded" },
  ];
  return {
    id: label,
    name: label,
    subtitle: agent?.program ?? (agent ? shortPath(agent.plist) : undefined),
    icon: ICON,
    keywords: agent ? [basename(agent.plist)] : [],
    accessories,
    detail: { metadata },
    ...(section ? { section } : {}),
    actions: jobActions(loaded, agent?.plist),
  };
}

async function listLaunchd(filter = "agents"): Promise<Item[]> {
  if (!Bun.which("launchctl")) return [hint("launchctl is not installed", "This palette lists launchd jobs on macOS")];
  const listed = await launchctlList();
  if (!(listed instanceof Map)) return [hint("Could not list jobs", lastLine(listed))];
  if (filter === "agents") {
    const found = await agents(S().agent_dirs);
    if (!found.length) return [hint("No agent plists", S().agent_dirs.join(", "))];
    return found.map((a) => jobItem(a.label, listed.get(a.label), a, shortPath(a.dir)));
  }
  const byLabel = new Map((await agents(S().agent_dirs)).map((a) => [a.label, a]));
  // `application.<bundle>.<pid>...` are the per-launch jobs of running apps, not services.
  const all = [...listed.values()].filter((j) => (filter !== "running" || j.pid) && !j.label.startsWith("application.")).sort((a, b) => a.label.localeCompare(b.label));
  return all.length ? all.map((j) => jobItem(j.label, j, byLabel.get(j.label))) : [hint("No running jobs", "launchctl list shows none with a pid")];
}

async function pickLaunchd(id: string, action?: string) {
  const j = jobs.get(id);
  if (!j) return fail("Job not listed", "List again first");
  action ??= j.loaded ? "unload" : "load";
  switch (action) {
    case "copy": return { copy: id };
    case "open": return j.plist ? { open: j.plist } : fail("No plist", "This job was loaded without one in the agent folders");
    case "show": return j.plist ? show(basename(j.plist), await plistXml(j.plist).catch((e) => String(e)), "xml") : fail("No plist", "This job was loaded without one in the agent folders");
    case "load": case "unload": case "restart": {
      const argv = action === "load" ? ["launchctl", "bootstrap", domain(), j.plist ?? ""] : action === "unload" ? ["launchctl", "bootout", `${domain()}/${id}`] : ["launchctl", "kickstart", "-k", `${domain()}/${id}`];
      if (action === "load" && !j.plist) return fail("No plist", "Nothing to load this job from");
      const r = await run(argv, ACT_MS);
      const done = { load: "Loaded", unload: "Unloaded", restart: "Restarted" }[action];
      return r.pending ? pending(`${action} ${id}`) : r.code === 0 ? { keep: true as const, toast: { title: `${done} ${id}` } } : fail(`Could not ${action} ${id}`, lastLine(r));
    }
  }
  return { keep: true as const };
}

export default {
  palettes: {
    services: {
      title: BACKEND === "systemd" ? "Services" : "Launch Agents",
      live: true,
      ttl: TTL,
      placeholder: BACKEND === "systemd" ? "Unit name or description" : "Label",
      filters: BACKEND === "systemd" ? SYSTEMD_FILTERS : LAUNCHD_FILTERS,
      list: (_query, ctx) => (BACKEND === "systemd" ? listSystemd(ctx?.filter) : listLaunchd(ctx?.filter)),
      pick: (id, action) => (BACKEND === "systemd" ? pickSystemd(id, action) : pickLaunchd(id, action)),
    },
  },
} satisfies Extension;
