// Applications: macOS .app bundles under the three usual roots (one level
// deep so the Utilities folders come along, ported from v1 builtin/apps.rs),
// or Linux .desktop entries from the XDG data dirs. Same item shape either
// way; the platform picks the scan and the launch. On macOS the common
// System Settings panes are rows too, and a running app carries a tag with
// Quit and Hide in its actions; on Linux a .desktop file's own actions
// ("New Private Window") are the row's secondary actions.
import { readdir } from "node:fs/promises";
import { home, settings, type Action, type Detail, type Extension, type Item, type Metadata } from "@zcag/pal";
import { execArgv, parseDesktop, splitList, type DesktopAction } from "./desktop.ts";

/** `[extensions.apps]`, defaults in pal.json. */
type Settings = { folders: string[] };

const HOME = home("~");
const LINUX = process.platform === "linux";
const spawnDetached = (argv: string[]) => Bun.spawn(argv, { stdio: ["ignore", "ignore", "ignore"], detached: true }).unref();

/** Runs to completion or `ms` (then killed, rejecting "timeout"); rejects with stderr (or the exit code) on failure. */
async function run(argv: string[], ms: number): Promise<void> {
  const proc = Bun.spawn(argv, { stdin: "ignore", stdout: "ignore", stderr: "pipe" });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; proc.kill(); }, ms);
  const [code, err] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
  clearTimeout(timer);
  if (timedOut) throw new Error("timeout");
  if (code !== 0) throw new Error(err.trim() || `${argv[0]} exited ${code}`);
}

const failed = (title: string, e: unknown) => ({ keep: true as const, toast: { title, message: String((e as Error)?.message ?? e), style: "failure" as const } });

// ---- macOS ---------------------------------------------------------------

const MAC_ROOTS: [string, string][] = [
  ["/Applications", "Applications"],
  ["/System/Applications", "macOS"],
  [`${HOME}/Applications`, "User"],
];

const OPEN: Action = { id: "open", title: "Open" };
const QUIT: Action = { id: "quit", title: "Quit", shortcut: "cmd+q" };
const HIDE: Action = { id: "hide", title: "Hide", shortcut: "cmd+h" };
const REVEAL: Action = { id: "reveal", title: "Reveal in Finder", shortcut: "cmd+shift+r" };
const COPY_PATH: Action = { id: "copy-path", title: "Copy path", shortcut: "cmd+c" };
const COPY_ID: Action = { id: "copy-id", title: "Copy bundle id", shortcut: "cmd+shift+c" };

/** What a pick needs beyond the path, filled by the scan. */
type MacApp = { name: string; bundleId?: string };
const macApps = new Map<string, MacApp>();

async function bundles(dir: string, depth = 1): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith(".")) continue;
    const p = `${dir}/${e.name}`;
    if (e.name.endsWith(".app")) out.push(p);
    else if (depth > 0) out.push(...(await bundles(p, depth - 1)));
  }
  return out;
}

/** A string key of an XML Info.plist; system and third-party bundles alike ship XML. */
const plistKey = (plist: string, key: string) => plist.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`))?.[1]?.trim() || undefined;

/** The bundle id, and the display and bundle names when they differ from the folder name, all keywords. */
async function plistInfo(app: string): Promise<{ bundleId?: string; names: string[] }> {
  const plist = await Bun.file(`${app}/Contents/Info.plist`).text().catch(() => "");
  return { bundleId: plistKey(plist, "CFBundleIdentifier"), names: [plistKey(plist, "CFBundleDisplayName"), plistKey(plist, "CFBundleName")].filter((n): n is string => !!n) };
}

/** Pids whose executable is the bundle's own (`<app>/Contents/MacOS/…`), from one `ps`. */
async function runningPids(): Promise<Map<string, number[]>> {
  const out = await new Response(Bun.spawn(["ps", "-axo", "pid=,comm="], { stdout: "pipe", stderr: "ignore" }).stdout).text().catch(() => "");
  const byApp = new Map<string, number[]>();
  for (const line of out.split("\n")) {
    const m = line.trim().match(/^(\d+)\s+(.+\.app)\/Contents\/MacOS\/[^/]+$/);
    if (m) (byApp.get(m[2]) ?? byApp.set(m[2], []).get(m[2])!).push(+m[1]);
  }
  return byApp;
}

async function scanMac(extra: string[]): Promise<Item[]> {
  const seen = new Set<string>();
  const items: Item[] = [];
  const running = await runningPids();
  macApps.clear();
  for (const [root, source] of [...MAC_ROOTS, ...extra.map((f): [string, string] => [f, f])]) {
    for (const path of await bundles(root)) {
      const name = path.slice(path.lastIndexOf("/") + 1, -4);
      if (seen.has(name.toLowerCase())) continue; // the first root wins a name (Set.add answers the set, so the old `!seen.add` never skipped)
      seen.add(name.toLowerCase());
      const { bundleId, names } = await plistInfo(path);
      macApps.set(path, { name, bundleId });
      const keywords = [...new Set([bundleId, ...names].filter((k): k is string => !!k && k.toLowerCase() !== name.toLowerCase()))];
      const isRunning = running.has(path);
      items.push({
        id: path,
        name,
        subtitle: source,
        icon: { app: path },
        keywords,
        accessories: isRunning ? [{ tag: "Running", color: "green" }] : [],
        actions: [OPEN, ...(isRunning ? [QUIT, HIDE] : []), REVEAL, COPY_PATH, ...(bundleId ? [COPY_ID] : []), ...(isRunning ? [] : [QUIT, HIDE])],
      });
    }
  }
  return items;
}

/**
 * The common System Settings panes (macOS 13 and later ids; the
 * `x-apple.systempreferences:` scheme opens the pane). A curated table
 * rather than a scan: the pane extensions under
 * /System/Library/ExtensionKit are mixed with intents and widgets and carry
 * no display names.
 */
const PANES: [id: string, title: string, keywords: string[]][] = [
  ["com.apple.Accessibility-Settings.extension", "Accessibility", ["voiceover", "zoom", "a11y"]],
  ["com.apple.Appearance-Settings.extension", "Appearance", ["dark mode", "light", "accent", "theme"]],
  ["com.apple.Battery-Settings.extension", "Battery", ["energy", "power", "low power mode"]],
  ["com.apple.BluetoothSettings", "Bluetooth", ["airpods", "devices"]],
  ["com.apple.ControlCenter-Settings.extension", "Control Center", ["menu bar"]],
  ["com.apple.Date-Time-Settings.extension", "Date & Time", ["clock", "time zone"]],
  ["com.apple.Desktop-Settings.extension", "Desktop & Dock", ["dock", "stage manager", "hot corners", "mission control"]],
  ["com.apple.Displays-Settings.extension", "Displays", ["monitor", "resolution", "night shift", "arrangement"]],
  ["com.apple.Focus-Settings.extension", "Focus", ["do not disturb", "dnd"]],
  ["com.apple.Game-Center-Settings.extension", "Game Center", ["games"]],
  ["com.apple.Internet-Accounts-Settings.extension", "Internet Accounts", ["mail", "google", "icloud accounts"]],
  ["com.apple.Keyboard-Settings.extension", "Keyboard", ["shortcuts", "input sources", "text replacements", "dictation"]],
  ["com.apple.Localization-Settings.extension", "Language & Region", ["locale", "language"]],
  ["com.apple.Lock-Screen-Settings.extension", "Lock Screen", ["screen saver", "require password"]],
  ["com.apple.LoginItems-Settings.extension", "Login Items & Extensions", ["startup", "open at login", "background"]],
  ["com.apple.Mouse-Settings.extension", "Mouse", ["tracking", "scroll"]],
  ["com.apple.Network-Settings.extension", "Network", ["ethernet", "firewall", "dns", "vpn"]],
  ["com.apple.Notifications-Settings.extension", "Notifications", ["alerts", "banners"]],
  ["com.apple.Passwords-Settings.extension", "Passwords", ["keychain", "passkeys"]],
  ["com.apple.Print-Scan-Settings.extension", "Printers & Scanners", ["printer", "scanner"]],
  ["com.apple.settings.PrivacySecurity.extension", "Privacy & Security", ["accessibility", "screen recording", "full disk access", "filevault", "permissions"]],
  ["com.apple.Screen-Time-Settings.extension", "Screen Time", ["limits", "downtime"]],
  ["com.apple.Siri-Settings.extension", "Siri", ["assistant", "apple intelligence"]],
  ["com.apple.Sharing-Settings.extension", "Sharing", ["file sharing", "screen sharing", "remote login", "hostname"]],
  ["com.apple.Software-Update-Settings.extension", "Software Update", ["update", "upgrade", "macos"]],
  ["com.apple.Sound-Settings.extension", "Sound", ["output", "input", "volume", "alert"]],
  ["com.apple.Spotlight-Settings.extension", "Spotlight", ["search", "index"]],
  ["com.apple.Startup-Disk-Settings.extension", "Startup Disk", ["boot"]],
  ["com.apple.Time-Machine-Settings.extension", "Time Machine", ["backup"]],
  ["com.apple.Touch-ID-Settings.extension", "Touch ID & Password", ["fingerprint", "biometrics", "login password"]],
  ["com.apple.Trackpad-Settings.extension", "Trackpad", ["gestures", "tap to click", "tracking"]],
  ["com.apple.Users-Groups-Settings.extension", "Users & Groups", ["accounts", "guest"]],
  ["com.apple.Wallpaper-Settings.extension", "Wallpaper", ["desktop picture", "background"]],
  ["com.apple.wifi-settings-extension", "Wi-Fi", ["wireless", "wlan", "network"]],
  ["com.apple.systempreferences.GeneralSettings", "General", ["about", "storage", "airdrop", "handoff", "login items"]],
];
const PANE = "pane:";
const SETTINGS_APP = "/System/Applications/System Settings.app";
const paneUrl = (id: string) => `x-apple.systempreferences:${id}`;

const panes = (): Item[] =>
  PANES.map(([id, title, keywords]) => ({
    id: PANE + id,
    name: title,
    subtitle: "System Settings",
    icon: { app: SETTINGS_APP },
    keywords: ["settings", "preferences", "system settings", ...keywords],
    actions: [{ id: "open", title: "Open" }, { id: "copy-url", title: "Copy URL", shortcut: "cmd+c" }],
  }));

/** Graceful quit through AppleScript (the app may ask to save), else SIGTERM to its processes. */
async function quitMac(path: string, pids: number[]) {
  const app = macApps.get(path);
  if (app?.bundleId) {
    try { await run(["osascript", "-e", `tell application id ${JSON.stringify(app.bundleId)} to quit`], 3000); return; }
    catch (e) { if ((e as Error).message === "timeout") return; } // a save dialog is up: the app decides
  }
  for (const pid of pids) process.kill(pid, "SIGTERM");
}

const hideMac = (pid: number) => run(["osascript", "-e", `tell application "System Events" to set visible of (first process whose unix id is ${pid}) to false`], 3000);

async function pickMac(id: string, action?: string) {
  if (id.startsWith(PANE)) return action === "copy-url" ? { copy: paneUrl(id.slice(PANE.length)) } : { open: paneUrl(id.slice(PANE.length)) };
  // A pick on a row restored from the persisted index, before this run has listed.
  if (!macApps.has(id)) await apps();
  const app = macApps.get(id);
  switch (action) {
    case "reveal": spawnDetached(["open", "-R", id]); return { hide: true as const };
    case "copy-path": return { copy: id };
    case "copy-id": return { copy: app?.bundleId ?? id };
    case "quit":
    case "hide": {
      const pids = (await runningPids()).get(id) ?? [];
      if (!pids.length) return { keep: true as const, toast: { title: `${app?.name ?? id} is not running` } };
      try { action === "quit" ? await quitMac(id, pids) : await hideMac(pids[0]); } catch (e) { return failed(`Could not ${action} ${app?.name ?? id}`, e); }
      // The `keep` lists again, and with the cache dropped that listing rescans, so the Running tag follows.
      cache = undefined;
      return { keep: true as const };
    }
    default: return { open: id };
  }
}

/** The detail pane: the path, bundle id and version of an app (read from its plist on request), or a pane's url. */
async function detailMac(id: string): Promise<Detail> {
  if (id.startsWith(PANE)) {
    const paneId = id.slice(PANE.length);
    const pane = PANES.find(([p]) => p === paneId);
    return { markdown: `# ${pane?.[1] ?? paneId}\n\nA System Settings pane`, metadata: [{ label: "Opens", value: paneUrl(paneId) }, ...(pane ? [{ label: "Keywords", tags: pane[2].map((text) => ({ text })) }] : [])] };
  }
  if (!macApps.has(id)) await apps();
  const app = macApps.get(id);
  const plist = await Bun.file(`${id}/Contents/Info.plist`).text().catch(() => "");
  const version = plistKey(plist, "CFBundleShortVersionString") ?? plistKey(plist, "CFBundleVersion");
  const pids = (await runningPids()).get(id) ?? [];
  const metadata: Metadata[] = [{ label: "Path", value: id }];
  if (app?.bundleId) metadata.push({ label: "Bundle id", value: app.bundleId });
  if (version) metadata.push({ label: "Version", value: version });
  metadata.push(pids.length ? { label: "Running", tags: [{ text: pids.length === 1 ? `pid ${pids[0]}` : `${pids.length} processes`, color: "green" }] } : { label: "Running", value: "No" });
  return { markdown: `# ${app?.name ?? id.slice(id.lastIndexOf("/") + 1, -4)}`, metadata };
}

// ---- Linux ---------------------------------------------------------------

// `applications/` under every XDG data dir, in precedence order (the spec:
// the first dir that has a desktop id wins), then the flatpak exports.
function desktopDirs(): string[] {
  const user = process.env.XDG_DATA_HOME || `${HOME}/.local/share`;
  const sys = (process.env.XDG_DATA_DIRS || "/usr/local/share:/usr/share").split(":").filter(Boolean);
  const all = [user, ...sys, "/var/lib/flatpak/exports/share", `${HOME}/.local/share/flatpak/exports/share`];
  return [...new Set(all.map((d) => `${d.replace(/\/+$/, "")}/applications`))];
}

/** OnlyShowIn/NotShowIn against `$XDG_CURRENT_DESKTOP` (a colon list). */
function shownHere(e: Record<string, string>): boolean {
  const here = (process.env.XDG_CURRENT_DESKTOP ?? "").split(":").filter(Boolean);
  const only = splitList(e.OnlyShowIn);
  if (only.length && !only.some((d) => here.includes(d))) return false;
  return !splitList(e.NotShowIn).some((d) => here.includes(d));
}

// The spec's TryExec: an entry whose program is not installed is not shown.
async function installed(prog?: string): Promise<boolean> {
  if (!prog) return true;
  if (prog.startsWith("/")) return Bun.file(prog).exists();
  return !!Bun.which(prog);
}

type Entry = { file: string; id: string; exec: string[]; terminal: boolean; actions: DesktopAction[] };
const entries = new Map<string, Entry>();
const ACTION = "action:";

async function scanLinux(extra: string[]): Promise<Item[]> {
  const seen = new Set<string>();
  const items: Item[] = [];
  entries.clear();
  for (const dir of [...desktopDirs(), ...extra]) {
    const files = await readdir(dir, { recursive: true }).catch(() => [] as string[]);
    for (const rel of files.filter((f) => f.endsWith(".desktop")).sort()) {
      const id = rel.replaceAll("/", "-"); // spec: subdirs join the id with "-"
      if (seen.has(id)) continue;
      const file = `${dir}/${rel}`;
      const { entry: e, actions } = parseDesktop(await Bun.file(file).text().catch(() => ""));
      if (e.Type !== "Application" || !e.Name || !e.Exec) continue;
      seen.add(id);
      if (e.NoDisplay === "true" || e.Hidden === "true" || !shownHere(e) || !(await installed(e.TryExec))) continue;
      const exec = execArgv(e.Exec);
      if (!exec.length) continue;
      entries.set(file, { file, id, exec, terminal: e.Terminal === "true", actions });
      const bin = exec[0].slice(exec[0].lastIndexOf("/") + 1);
      const keywords = [...new Set([e.GenericName, ...splitList(e.Keywords), bin, id.slice(0, -8)].filter((k): k is string => !!k))];
      items.push({
        id: file,
        name: e.Name,
        subtitle: e.Comment || e.GenericName || undefined,
        icon: { app: file },
        keywords,
        actions: [OPEN, ...actions.map((a): Action => ({ id: ACTION + a.id, title: a.name })), COPY_PATH],
      });
    }
  }
  return items;
}

/** A terminal that takes the command as trailing args (kitty, foot) or after `-e`. */
function terminalArgv(cmd: string[]): string[] | undefined {
  const term = process.env.TERMINAL || ["kitty", "foot", "xterm"].find((t) => Bun.which(t));
  if (!term) return;
  const direct = /(^|\/)(kitty|foot)$/.test(term);
  return direct ? [term, ...cmd] : [term, "-e", ...cmd];
}

// `gio launch` (then `gtk-launch`) gets the desktop file's own semantics:
// DBusActivatable, StartupNotify, Path=. Terminal entries go through our
// terminal since GLib's built-in list does not know kitty or foot. A
// `[Desktop Action]` has no launcher CLI, so its Exec runs directly.
function launchLinux(file: string, action?: string) {
  const e = entries.get(file);
  if (!e) throw new Error(`no entry ${file}`);
  const exec = action ? e.actions.find((a) => a.id === action)?.exec : undefined;
  if (action && !exec) throw new Error(`no action ${action} in ${file}`);
  if (e.terminal || exec) {
    if (!e.terminal) return spawnDetached(exec!);
    const argv = terminalArgv(exec ?? e.exec);
    if (!argv) throw new Error("no terminal: set $TERMINAL");
    return spawnDetached(argv);
  }
  if (Bun.which("gio")) return spawnDetached(["gio", "launch", file]);
  if (Bun.which("gtk-launch")) return spawnDetached(["gtk-launch", e.id]);
  spawnDetached(e.exec);
}

/** The detail pane: the desktop file, its command and its own actions. */
async function detailLinux(id: string): Promise<Detail> {
  if (!entries.has(id)) await apps();
  const e = entries.get(id);
  const metadata: Metadata[] = [{ label: "File", value: id }];
  if (e) {
    metadata.push({ label: "Runs", value: e.exec.join(" ") });
    if (e.terminal) metadata.push({ label: "Terminal", value: "Yes" });
    if (e.actions.length) metadata.push({ label: "Actions", tags: e.actions.map((a) => ({ text: a.name })) });
  }
  return { markdown: `# ${e?.id.slice(0, -8) ?? id}`, metadata };
}

async function pickLinux(id: string, action?: string) {
  if (action === "copy-path") return { copy: id };
  // A pick on a row restored from the persisted index, before this run has listed.
  if (!entries.has(id)) await apps();
  launchLinux(id, action?.startsWith(ACTION) ? action.slice(ACTION.length) : undefined);
}

// ---- palette -------------------------------------------------------------

/** `[extensions.apps] folders` on top of the platform roots, `~` expanded. */
const extraFolders = (): string[] => settings.get<Settings>().folders.map(home);

async function scan(extra: string[]): Promise<Item[]> {
  const items = await (LINUX ? scanLinux(extra) : scanMac(extra));
  items.sort((a, b) => a.name.localeCompare(b.name));
  return LINUX ? items : [...items, ...panes()];
}

// One scan per folders setting: a change makes the core list again, and
// that list rescans; `refresh` (the shell's Refresh action) rescans too.
let cache: { key: string; items: Promise<Item[]> } | undefined;
function apps(refresh = false): Promise<Item[]> {
  const extra = extraFolders();
  const key = JSON.stringify(extra);
  if (refresh || cache?.key !== key) cache = { key, items: scan(extra) };
  return cache.items;
}

export default {
  palettes: {
    apps: {
      title: "Applications",
      list: (_query, ctx) => apps(ctx?.refresh),
      pick: (id, action) => (LINUX ? pickLinux(id, action) : pickMac(id, action)),
      detail: (id) => (LINUX ? detailLinux(id) : detailMac(id)),
    },
  },
} satisfies Extension;
