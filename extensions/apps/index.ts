// Applications: macOS .app bundles under the three usual roots (one level
// deep so the Utilities folders come along, ported from v1 builtin/apps.rs),
// or Linux .desktop entries from the XDG data dirs. Same item shape either
// way; the platform picks the scan and the launch.
import { readdir } from "node:fs/promises";
import { home, settings, type Extension, type Item } from "@zcag/pal";

/** `[extensions.apps]`, defaults in pal.json. */
type Settings = { folders: string[] };

const HOME = home("~");
const LINUX = process.platform === "linux";

// ---- macOS ---------------------------------------------------------------

const MAC_ROOTS: [string, string][] = [
  ["/Applications", "Applications"],
  ["/System/Applications", "macOS"],
  [`${HOME}/Applications`, "User"],
];

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

// Bundle id as a keyword, so "com.apple." or "anthropic" finds the app.
async function bundleId(app: string): Promise<string | undefined> {
  const plist = await Bun.file(`${app}/Contents/Info.plist`).text().catch(() => "");
  return plist.match(/<key>CFBundleIdentifier<\/key>\s*<string>([^<]*)<\/string>/)?.[1]?.trim();
}

async function scanMac(extra: string[]): Promise<Item[]> {
  const seen = new Set<string>();
  const items: Item[] = [];
  for (const [root, source] of [...MAC_ROOTS, ...extra.map((f): [string, string] => [f, f])]) {
    for (const path of await bundles(root)) {
      const name = path.slice(path.lastIndexOf("/") + 1, -4);
      if (!seen.add(name.toLowerCase())) continue;
      const id = await bundleId(path);
      items.push({ id: path, name, subtitle: source, icon: { app: path }, keywords: id ? [id] : [] });
    }
  }
  return items;
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

/** Keys of the `[Desktop Entry]` group; localised keys (`Name[tr]`) are skipped. */
function parseDesktop(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  let inEntry = false;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("[")) {
      inEntry = line === "[Desktop Entry]";
      continue;
    }
    if (!inEntry) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    if (!key.includes("[")) out[key] = line.slice(eq + 1).trim();
  }
  return out;
}

const list = (v?: string) => (v ?? "").split(";").map((s) => s.trim()).filter(Boolean);

/** OnlyShowIn/NotShowIn against `$XDG_CURRENT_DESKTOP` (a colon list). */
function shownHere(e: Record<string, string>): boolean {
  const here = (process.env.XDG_CURRENT_DESKTOP ?? "").split(":").filter(Boolean);
  const only = list(e.OnlyShowIn);
  if (only.length && !only.some((d) => here.includes(d))) return false;
  return !list(e.NotShowIn).some((d) => here.includes(d));
}

// The spec's TryExec: an entry whose program is not installed is not shown.
async function installed(prog?: string): Promise<boolean> {
  if (!prog) return true;
  if (prog.startsWith("/")) return Bun.file(prog).exists();
  return !!Bun.which(prog);
}

/**
 * Exec= to argv: double-quoted words with the spec's four escapes, field
 * codes (`%u`, `%F`, ...) dropped, `%%` kept as a literal percent.
 */
function execArgv(exec: string): string[] {
  const args: string[] = [];
  for (const m of exec.matchAll(/"((?:\\.|[^"\\])*)"|(\S+)/g)) {
    const word = m[1] !== undefined ? m[1].replace(/\\(["`$\\])/g, "$1") : m[2];
    const clean = word.replace(/%(.)/g, (_, c) => (c === "%" ? "%" : ""));
    if (clean) args.push(clean);
  }
  return args;
}

type Entry = { file: string; id: string; exec: string[]; terminal: boolean };
const entries = new Map<string, Entry>();

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
      const e = parseDesktop(await Bun.file(file).text().catch(() => ""));
      if (e.Type !== "Application" || !e.Name || !e.Exec) continue;
      seen.add(id);
      if (e.NoDisplay === "true" || e.Hidden === "true" || !shownHere(e) || !(await installed(e.TryExec))) continue;
      const exec = execArgv(e.Exec);
      if (!exec.length) continue;
      entries.set(file, { file, id, exec, terminal: e.Terminal === "true" });
      const bin = exec[0].slice(exec[0].lastIndexOf("/") + 1);
      const keywords = [...new Set([e.GenericName, ...list(e.Keywords), bin, id.slice(0, -8)].filter((k): k is string => !!k))];
      items.push({ id: file, name: e.Name, subtitle: e.Comment || e.GenericName || undefined, icon: { app: file }, keywords });
    }
  }
  return items;
}

const spawnDetached = (argv: string[]) => Bun.spawn(argv, { stdio: ["ignore", "ignore", "ignore"], detached: true }).unref();

/** A terminal that takes the command as trailing args (kitty, foot) or after `-e`. */
function terminalArgv(cmd: string[]): string[] | undefined {
  const term = process.env.TERMINAL || ["kitty", "foot", "xterm"].find((t) => Bun.which(t));
  if (!term) return;
  const direct = /(^|\/)(kitty|foot)$/.test(term);
  return direct ? [term, ...cmd] : [term, "-e", ...cmd];
}

// `gio launch` (then `gtk-launch`) gets the desktop file's own semantics:
// DBusActivatable, StartupNotify, Path=. Terminal entries go through our
// terminal since GLib's built-in list does not know kitty or foot.
function launchLinux(file: string) {
  const e = entries.get(file);
  if (!e) throw new Error(`no entry ${file}`);
  if (e.terminal) {
    const argv = terminalArgv(e.exec);
    if (!argv) throw new Error("no terminal: set $TERMINAL");
    return spawnDetached(argv);
  }
  if (Bun.which("gio")) return spawnDetached(["gio", "launch", file]);
  if (Bun.which("gtk-launch")) return spawnDetached(["gtk-launch", e.id]);
  spawnDetached(e.exec);
}

// ---- palette -------------------------------------------------------------

/** `[extensions.apps] folders` on top of the platform roots, `~` expanded. */
const extraFolders = (): string[] => settings.get<Settings>().folders.map(home);

async function scan(extra: string[]): Promise<Item[]> {
  const items = await (LINUX ? scanLinux(extra) : scanMac(extra));
  return items.sort((a, b) => a.name.localeCompare(b.name));
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
      // macOS: the shell's opener takes the bundle path.
      pick: async (id) => {
        if (!LINUX) return { open: id };
        // A pick on a row restored from the persisted index, before this run has listed.
        if (!entries.has(id)) await apps();
        launchLinux(id);
      },
    },
  },
} satisfies Extension;
