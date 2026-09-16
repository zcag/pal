// Linux .desktop files as data: the `[Desktop Entry]` group, its
// `[Desktop Action …]` groups (the spec's additional application actions,
// "New Window", "New Private Window"), and Exec= to argv. Pure, so the
// tests run on every platform.

export type DesktopAction = { id: string; name: string; exec: string[] };
export type Desktop = { entry: Record<string, string>; actions: DesktopAction[] };

const list = (v?: string) => (v ?? "").split(";").map((s) => s.trim()).filter(Boolean);

/** Keys of a group, unlocalised (`Name[tr]` skipped), comments and blanks dropped. */
function groups(text: string): Map<string, Record<string, string>> {
  const out = new Map<string, Record<string, string>>();
  let current: Record<string, string> | undefined;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("[")) {
      const name = line.slice(1, line.indexOf("]"));
      current = out.get(name) ?? {};
      out.set(name, current);
      continue;
    }
    if (!current) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    if (!key.includes("[")) current[key] = line.slice(eq + 1).trim();
  }
  return out;
}

/**
 * Exec= to argv: double-quoted words with the spec's four escapes, field
 * codes (`%u`, `%F`, ...) dropped, `%%` kept as a literal percent.
 */
export function execArgv(exec: string): string[] {
  const args: string[] = [];
  for (const m of exec.matchAll(/"((?:\\.|[^"\\])*)"|(\S+)/g)) {
    const word = m[1] !== undefined ? m[1].replace(/\\(["`$\\])/g, "$1") : m[2];
    const clean = word.replace(/%(.)/g, (_, c) => (c === "%" ? "%" : ""));
    if (clean) args.push(clean);
  }
  return args;
}

/**
 * The entry and its actions: only the ids the `Actions=` key names, in
 * that order, each needing a `Name` and an `Exec` in its own group.
 */
export function parseDesktop(text: string): Desktop {
  const g = groups(text);
  const entry = g.get("Desktop Entry") ?? {};
  const actions: DesktopAction[] = [];
  for (const id of list(entry.Actions)) {
    const a = g.get(`Desktop Action ${id}`);
    if (!a?.Name || !a.Exec) continue;
    const exec = execArgv(a.Exec);
    if (exec.length) actions.push({ id, name: a.Name, exec });
  }
  return { entry, actions };
}

export { list as splitList };
