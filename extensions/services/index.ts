// Services: one live palette
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
import { hint as hintRow, home, settings, toast, xdg, type Accessory, type Action, type Ctx, type Extension, type Item, type Metadata, type TagColor } from "@zcag/pal";

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
const pending = (what: string) => (toast(`${what} not done yet`, `Still running after ${WAIT_MS / 1000} s; it goes on in the background`));

const hint = (name: string, subtitle: string): Item => hintRow(name, name, subtitle, { icon: ICON });
const fail = (title: string, message: string) => toast(title, message, "failure");
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
const journalctl = (scope: Scope, units: string[]) => ["journalctl", ...(scope === "user" ? ["--user"] : []), ...units.flatMap((u) => ["-u", u]), "-n", String(LOG_LINES), "--no-pager"];

/**
 * A unit's actions, every one of them also over marked units (`multi`):
 * one `systemctl` per scope names them all, so a system scope asks for
 * root once. Start and Stop (Enable and Disable) ride on every row, the
 * one that flips it first and the other at the end, so marked units in
 * both states still share them; the verb on a unit already there is a
 * no-op to systemd. The question is worded for one unit or several.
 */
function unitActions(scope: Scope, active: boolean, enabled?: string): Action[] {
  const ask = scope === "system" || S().confirm_user;
  const confirm = (what: string) => (ask ? { confirm: `${what} with the ${scope} manager?` } : {});
  const START: Action = { id: "start", title: "Start", multi: true }, STOP: Action = { id: "stop", title: "Stop", multi: true, ...confirm("Stop") };
  // A static, generated or transient unit has no [Install] section: nothing to enable.
  const fixed = enabled && ["static", "generated", "transient", "masked"].includes(enabled);
  const ENABLE: Action = { id: "enable", title: "Enable", multi: true }, DISABLE: Action = { id: "disable", title: "Disable", multi: true, ...confirm("Disable") };
  const on = enabled === "enabled";
  return [
    active ? STOP : START,
    { id: "logs", title: "Logs", shortcut: "cmd+l", multi: true },
    { id: "restart", title: "Restart", shortcut: "cmd+shift+r", multi: true, ...confirm("Restart") },
    ...(fixed ? [] : [{ ...(on ? DISABLE : ENABLE), shortcut: "cmd+e" }]),
    { id: "copy", title: "Copy unit name", shortcut: "cmd+c", multi: true },
    active ? START : STOP,
    ...(fixed ? [] : [on ? ENABLE : DISABLE]),
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

/** The toast's name for what a verb ran on: the unit, or how many. */
const named = (names: string[], one: string, many: string) => (names.length === 1 ? names[0]! : `${names.length} ${many}`) || one;

async function pickSystemd(id: string, action?: string, ctx?: Ctx) {
  const u = units.get(id);
  if (!u) return fail("Unit not listed", "List again first");
  action ??= u.active ? "stop" : "start";
  // The marked units (`ctx.ids`), else the one; those no longer listed are left out.
  const all = (ctx?.ids ?? [id]).map((i) => units.get(i)).filter((x): x is NonNullable<typeof x> => !!x);
  const names = all.map((x) => x.unit);
  switch (action) {
    case "copy": return { copy: names.join("\n") };
    case "logs": {
      // One journal for them all, interleaved by time, per scope.
      const outs = await Promise.all((["user", "system"] as Scope[]).filter((sc) => all.some((x) => x.scope === sc)).map((sc) => run(journalctl(sc, all.filter((x) => x.scope === sc).map((x) => x.unit)), LIST_MS)));
      return show(`${named(names, u.unit, "units")} logs`, outs.map((r) => r.out || r.err).join("\n"));
    }
    case "start": case "stop": case "restart": case "enable": case "disable": {
      const done = { start: "Started", stop: "Stopped", restart: "Restarted", enable: "Enabled", disable: "Disabled" }[action];
      // One systemctl per scope with every unit of it: the system scope asks for root once.
      for (const sc of ["user", "system"] as Scope[]) {
        const units_ = all.filter((x) => x.scope === sc).map((x) => x.unit);
        if (!units_.length) continue;
        const argv = systemctl(sc, "--no-ask-password", action, ...units_);
        const r = sc === "system" ? await privileged(argv) : await run(argv, ACT_MS);
        const what = named(units_, u.unit, "units");
        if (r.pending) return pending(`${action} ${what}`);
        if (r.code !== 0) return fail(`Could not ${action} ${what}`, r.err.startsWith("Not permitted") ? r.err : lastLine(r));
      }
      return toast(`${done} ${named(names, u.unit, "units")}`);
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

/**
 * A job's actions. All but Show plist also run over marked jobs (`multi`),
 * one `launchctl` each. Load rides on a loaded job too (at the end) and
 * Unload on an unloaded one, so marked jobs in both states share them; a
 * job already there is skipped.
 */
function jobActions(loaded: boolean, plist?: string): Action[] {
  const UNLOAD: Action = { id: "unload", title: "Unload", multi: true, confirm: "Unload? launchd stops it and forgets it until it is loaded again." };
  const LOAD: Action = { id: "load", title: "Load", multi: true };
  const a: Action[] = [];
  if (loaded) a.push(UNLOAD, { id: "restart", title: "Restart", shortcut: "cmd+shift+r", multi: true });
  else if (plist) a.push(LOAD);
  if (plist) a.push({ id: "show", title: "Show plist", shortcut: "cmd+l" }, { id: "open", title: "Open plist file", shortcut: "cmd+o", multi: true });
  a.push({ id: "copy", title: "Copy label", shortcut: "cmd+c", multi: true });
  if (loaded && plist) a.push(LOAD);
  else if (!loaded) a.push(UNLOAD);
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

async function pickLaunchd(id: string, action?: string, ctx?: Ctx) {
  const j = jobs.get(id);
  if (!j) return fail("Job not listed", "List again first");
  action ??= j.loaded ? "unload" : "load";
  // The marked jobs (`ctx.ids`), else the one; those no longer listed are left out.
  const ids = (ctx?.ids ?? [id]).filter((i) => jobs.has(i));
  switch (action) {
    case "copy": return { copy: ids.join("\n") };
    case "open": {
      const plists = ids.map((i) => jobs.get(i)!.plist).filter((p): p is string => !!p);
      return plists.length ? { open: plists.length === 1 ? plists[0]! : plists } : fail("No plist", "This job was loaded without one in the agent folders");
    }
    case "show": return j.plist ? show(basename(j.plist), await plistXml(j.plist).catch((e) => String(e)), "xml") : fail("No plist", "This job was loaded without one in the agent folders");
    case "load": case "unload": case "restart": {
      if (action === "load" && ids.length === 1 && !j.plist) return fail("No plist", "Nothing to load this job from");
      // Over marked jobs, one the listing shows already there (or with nothing to load it from) is skipped; the one row is always tried, launchctl answers.
      const todo = ids.length === 1 ? ids : ids.filter((i) => { const x = jobs.get(i)!; return action === "load" ? !x.loaded && !!x.plist : x.loaded; });
      if (!todo.length) return toast(`Nothing to ${action}`, `Every marked job is already ${action === "load" ? "loaded" : "not loaded"}`);
      const done = { load: "Loaded", unload: "Unloaded", restart: "Restarted" }[action];
      for (const i of todo) {
        const argv = action === "load" ? ["launchctl", "bootstrap", domain(), jobs.get(i)!.plist!] : action === "unload" ? ["launchctl", "bootout", `${domain()}/${i}`] : ["launchctl", "kickstart", "-k", `${domain()}/${i}`];
        const r = await run(argv, ACT_MS);
        if (r.pending) return pending(`${action} ${i}`);
        if (r.code !== 0) return fail(`Could not ${action} ${i}`, lastLine(r));
      }
      return toast(`${done} ${todo.length === 1 ? todo[0] : `${todo.length} jobs`}`);
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
      pick: (id, action, ctx) => (BACKEND === "systemd" ? pickSystemd(id, action, ctx) : pickLaunchd(id, action, ctx)),
    },
  },
} satisfies Extension;
