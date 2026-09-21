// Makefile targets: the `projects` folders are walked two levels deep for a
// Makefile, makefile or GNUmakefile, and each file's targets become rows,
// one section per project. Targets are read from the text (no `make -pn`):
// a line starting with a name and a colon, `.PHONY` names included even
// when their rule is not literal, a `##` comment on the line or the comment
// line above the rule as its description. Run opens a terminal in the
// project folder running `make <target>` (the SDK's `terminal`), with the
// words typed into the row's argument after it (`VERBOSE=1`, `-j4`), or,
// with `terminal = "background"`, runs it here and toasts the exit status.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { errorMessage, home, settings, terminal, tilde, toast, type Action, type Arg, type Ctx, type Detail, type Extension, type Item } from "@zcag/pal";

/** `[extensions.make]`, defaults in pal.json. */
type Settings = { projects: string[]; terminal: terminal.Choice | "background" };
const S = () => settings.get<Settings>();

/** md-hammer, the manifest's icon too. */
const ICON = "\u{f08ea}";
const NAMES = ["Makefile", "makefile", "GNUmakefile"];
const DEPTH = 2;
/** The core drops a pick unanswered after 10 s: a background make still going by then is left to finish on its own. */
const WAIT_MS = 8_000;
const SKIP = new Set(["node_modules", "target", "vendor", "dist", "build"]);

// ---- scan ---------------------------------------------------------------------

type Project = { dir: string; file: string };

/** The first of `NAMES` in `dir`, if any (GNU make's own lookup order). */
function makefileIn(dir: string): string | undefined {
  for (const n of NAMES) {
    const f = join(dir, n);
    try { if (statSync(f).isFile()) return f; } catch {}
  }
}

/** `root` and its subfolders to `DEPTH`, dot folders and build output skipped, sorted by path. */
function walk(root: string, depth = 0, out: Project[] = []): Project[] {
  const file = makefileIn(root);
  if (file) out.push({ dir: root, file });
  if (depth >= DEPTH) return out;
  let entries: string[] = [];
  try { entries = readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith(".") && !SKIP.has(e.name)).map((e) => e.name).sort(); } catch {}
  for (const e of entries) walk(join(root, e), depth + 1, out);
  return out;
}

const projects = (): Project[] => {
  const seen = new Set<string>();
  return S().projects.map(home).flatMap((r) => walk(r)).filter((p) => !seen.has(p.dir) && seen.add(p.dir));
};

// ---- parse --------------------------------------------------------------------

type Target = { name: string; description?: string; phony: boolean; recipe: string };

/** `name: deps ## description`, several names before the colon; `:=`, `::=`, pattern and variable targets are not rules here. */
const RULE = /^([A-Za-z0-9_.\/-][A-Za-z0-9_.\/ -]*?)\s*:(?![:=])(?!=)([^#]*)(?:##\s*(.*))?$/;
const PHONY = /^\.PHONY\s*:\s*(.*)$/;

/** The comment line right above a rule (its `.PHONY` line skipped), first line only: `## text` or `# text`. */
function above(lines: string[], i: number): string | undefined {
  let j = i - 1;
  while (j >= 0 && PHONY.test(lines[j])) j--;
  const m = j >= 0 ? lines[j].match(/^#+\s*(\S.*)$/) : null;
  return m?.[1].trim();
}

/** Targets in file order; a `.PHONY` name without a literal rule is added at the end. */
export function parse(text: string): Target[] {
  const out: Target[] = [];
  const byName = new Map<string, Target>();
  const phony = new Set<string>();
  const lines = text.split("\n");
  let current: Target | undefined;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("\t")) { if (current) current.recipe += (current.recipe ? "\n" : "") + line.slice(1); continue; }
    current = undefined;
    const p = line.match(PHONY);
    if (p) { for (const n of p[1].split(/\s+/).filter(Boolean)) phony.add(n); continue; }
    const m = line.match(RULE);
    if (!m) continue;
    const description = m[3]?.trim() || above(lines, i);
    for (const name of m[1].split(/\s+/).filter(Boolean)) {
      if (name.startsWith(".") || /[%$]/.test(name)) continue;
      const t = byName.get(name);
      if (t) { t.description ??= description; current = t; continue; }
      current = { name, description, phony: false, recipe: "" };
      byName.set(name, current);
      out.push(current);
    }
  }
  for (const n of phony) {
    const t = byName.get(n);
    if (t) t.phony = true;
    else if (!n.startsWith(".") && !/[%$]/.test(n)) out.push({ name: n, phony: true, recipe: "" });
  }
  return out;
}

// ---- rows ---------------------------------------------------------------------

/** Run's one argument in the bar: the words after the target, split on spaces. Optional, so Enter with it blank (or a bare pick) is the plain `make <target>`. */
const ARGS: Arg[] = [{ id: "extra", placeholder: "Variables or flags: VERBOSE=1 -j4 (optional)" }];
const extraWords = (ctx?: Ctx) => String(ctx?.values?.extra ?? "").trim().split(/\s+/).filter(Boolean);

const ACTIONS: Action[] = [
  { id: "run", title: "Run" },
  { id: "copy", title: "Copy command", shortcut: "cmd+c" },
  { id: "open", title: "Open project", shortcut: "cmd+o" },
  { id: "makefile", title: "Show Makefile", shortcut: "cmd+l" },
];

/** What a row id stands for, from the last listing (`pick` gets only the id). */
const rows = new Map<string, { project: Project; target: Target }>();

function list(): Item[] {
  rows.clear();
  const items: Item[] = [];
  for (const project of projects()) {
    let text = "";
    try { text = readFileSync(project.file, "utf8"); } catch { continue; }
    const name = basename(project.dir);
    for (const target of parse(text)) {
      const id = `${target.name}@${project.dir}`;
      rows.set(id, { project, target });
      items.push({
        id,
        name: target.name,
        subtitle: target.description ? `${tilde(project.dir)}: ${target.description}` : tilde(project.dir),
        icon: ICON,
        keywords: [name, ...(target.phony ? ["phony"] : [])],
        section: name,
        args: ARGS,
      });
    }
  }
  return items;
}

/** Four backticks fence the text so a ``` inside cannot end it early. */
const fence = (s: string, lang = "") => "````" + lang + "\n" + s.replace(/````/g, "```​`") + "\n````";

function detail(id: string): Detail | undefined {
  const r = rows.get(id);
  if (!r) return;
  return {
    markdown: r.target.recipe ? fence(r.target.recipe, "make") : "_No recipe of its own (dependencies only, or a pattern rule)._",
    metadata: [
      { label: "Project", value: tilde(r.project.dir) },
      { label: "Makefile", value: basename(r.project.file) },
      ...(r.target.description ? [{ label: "Description", value: r.target.description }] : []),
      ...(r.target.phony ? [{ label: "Phony", value: "yes" }] : []),
    ],
  };
}

// ---- run ----------------------------------------------------------------------

/** `make <target> <extra>` in the project folder, awaited up to `WAIT_MS`; the toast carries the exit status, a failure its output too. */
async function background(dir: string, target: string, extra: string[]) {
  const proc = Bun.spawn(["make", target, ...extra], { cwd: dir, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const cmd = ["make", target, ...extra].join(" ");
  const outP = new Response(proc.stdout).text(), errP = new Response(proc.stderr).text();
  const code = await Promise.race([proc.exited, Bun.sleep(WAIT_MS).then(() => undefined)]);
  if (code === undefined) {
    proc.unref();
    return { keep: true as const, toast: { title: `${cmd} still running`, message: `Not done after ${WAIT_MS / 1000} s in ${tilde(dir)}; it goes on in the background` } };
  }
  const [out, err] = await Promise.all([outP, errP]);
  const text = (out + (out && err ? "\n" : "") + err).replace(/\n+$/, "");
  const last = text.split("\n").filter(Boolean).slice(-1)[0];
  if (code === 0) return { keep: true as const, toast: { title: `${cmd}: done`, message: last || tilde(dir) } };
  return { ...toast(`${cmd}: exit ${code}`, last || tilde(dir), "failure"), show: { title: `${cmd} in ${tilde(dir)}`, markdown: text ? fence(text) : "_No output._" } };
}

export default {
  palettes: {
    make: {
      title: "Makefile Targets",
      placeholder: "Target or project",
      actions: ACTIONS,
      list,
      pick: async (id, action = "run", ctx) => {
        const r = rows.get(id);
        if (!r) return toast("Target not listed", "Refresh the palette with cmd+r", "failure");
        const { dir } = r.project, { name } = r.target;
        switch (action) {
          case "copy": return { copy: `make -C ${terminal.quote(dir)} ${terminal.quote(name)}` };
          case "open": return { open: dir };
          case "makefile": {
            let text = "";
            try { text = readFileSync(r.project.file, "utf8"); } catch (e) { return toast("Could not read the Makefile", errorMessage(e), "failure"); }
            return { show: { title: `${basename(r.project.file)} in ${tilde(dir)}`, markdown: fence(text.replace(/\n+$/, ""), "make") } };
          }
        }
        const want = S().terminal;
        const extra = extraWords(ctx);
        if (want === "background") return background(dir, name, extra);
        // The window stays until Enter, so a quick target's output is not gone with it.
        const q = [name, ...extra].map(terminal.quote).join(" ");
        const script = `make ${q}; s=$?; printf '\\n[make %s exited %s] Enter closes ' ${terminal.quote(name)} "$s"; read -r _`;
        const why = terminal.open(["sh", "-c", script], want, dir);
        return why ? toast("Could not open a terminal", why, "failure") : { hud: `make ${[name, ...extra].join(" ")}` };
      },
      detail,
    },
  },
} satisfies Extension;
