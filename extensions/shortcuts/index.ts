// Apple Shortcuts: every shortcut from Shortcuts.app as a row, its folder
// as the section, over the `shortcuts` command line tool (macOS 12 and
// later). Enter runs it; cmd+Enter runs it with the clipboard's text as
// its input, "Run with text" asks for the input in a form. A run may take
// as long as the shortcut does (it can show UI and wait for you), so pick
// returns at once and the result reaches the HUD afterwards through
// `effects.run`: "Done", or the first line of what the shortcut output.
// Nothing here reads the Shortcuts database (TCC guards it), so a
// shortcut's own icon and colour are not known; the rows wear the tile's.
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clipboard, effects, errorMessage, hint, toast, truncate, type Action, type Ctx, type Effect, type Extension, type Form, type Item } from "@zcag/pal";

const MAC = process.platform === "darwin";
/** Tests point this at a stand-in; the real tool is in /usr/bin on every Mac that has it. */
const CLI = process.env.PAL_SHORTCUTS_BIN || Bun.which("shortcuts") || "/usr/bin/shortcuts";
const LIST_MS = 10_000;
/** md-play_box_outline, md-apple, md-alert_circle_outline: the rows, the hint. */
const ICON = "\u{f040b}";
const ICON_OFF = "\u{f05d6}";
const ID_LINE = /^(.*) \(([0-9A-Fa-f-]{36})\)$/;

const RUN: Action = { id: "run", title: "Run" };
const RUN_CLIPBOARD: Action = { id: "clipboard", title: "Run with clipboard" };
const RUN_TEXT: Action = { id: "text", title: "Run with text…", shortcut: "cmd+t" };
const OPEN: Action = { id: "open", title: "Open in Shortcuts", shortcut: "cmd+o" };
const COPY_NAME: Action = { id: "copy", title: "Copy name", shortcut: "cmd+c" };

type Shortcut = { id: string; name: string; identifier: string; folder?: string };
/** The last listing by row id: `pick` gets the id back and nothing else. */
const known = new Map<string, Shortcut>();

const available = () => MAC && existsSync(CLI);

async function cli(args: string[]): Promise<string> {
  const proc = Bun.spawn([CLI, ...args], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => proc.kill(), LIST_MS);
  const [code, out, err] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  clearTimeout(timer);
  if (code !== 0) throw new Error(err.trim() || `shortcuts ${args[0]} exited ${code}`);
  return out;
}

const lines = (out: string) => out.split("\n").map((l) => l.trimEnd()).filter(Boolean);

/** `Name (IDENTIFIER)` lines of one folder (`none` for the ones in no folder). */
async function inFolder(folder: string): Promise<Shortcut[]> {
  return lines(await cli(["list", "--show-identifiers", "--folder-name", folder])).flatMap((l) => {
    const m = l.match(ID_LINE);
    return m ? [{ id: m[1], name: m[1], identifier: m[2], folder: folder === "none" ? undefined : folder }] : [];
  });
}

/** Every shortcut with its folder: the ones in no folder first, then folder by folder as Shortcuts lists them. */
export async function shortcuts(): Promise<Shortcut[]> {
  const folders = lines(await cli(["list", "--folders"]));
  const all = (await Promise.all(["none", ...folders].map(inFolder))).flat();
  // A row id is the name (readable in `item_hotkeys`); a second shortcut of the same name gets its identifier appended.
  const seen = new Set<string>();
  for (const s of all) {
    if (seen.has(s.id)) s.id = `${s.name} (${s.identifier})`;
    seen.add(s.id);
  }
  return all;
}

function row(s: Shortcut): Item {
  known.set(s.id, s);
  return {
    id: s.id,
    name: s.name,
    icon: ICON,
    section: s.folder || "No folder",
    keywords: s.folder ? [s.folder] : undefined,
    detail: { metadata: [{ label: "Name", value: s.name }, ...(s.folder ? [{ label: "Folder", value: s.folder }] : []), { label: "Identifier", value: s.identifier }] },
    actions: [RUN, RUN_CLIPBOARD, RUN_TEXT, OPEN, COPY_NAME],
  };
}

const unavailable = (): Item[] => [hint("unavailable", "Apple Shortcuts is not available", MAC ? "The shortcuts command line tool ships with macOS 12 and later" : "Shortcuts is a macOS app; there is nothing to run here", { icon: ICON_OFF })];

/**
 * Runs the shortcut detached from the pick, `input` as its input file, and
 * hands the outcome to the HUD once it ends: the first line of the output,
 * "Done" when there is none, the tool's message when it failed.
 */
async function run(s: Shortcut, input?: string): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "pal-shortcut-"));
  const outPath = join(dir, "out.txt");
  const args = ["run", s.identifier, "-o", outPath];
  if (input !== undefined) {
    const inPath = join(dir, "in.txt");
    await writeFile(inPath, input);
    args.push("-i", inPath);
  }
  try {
    const proc = Bun.spawn([CLI, ...args], { stdin: "ignore", stdout: "ignore", stderr: "pipe" });
    const [code, err] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
    // The output file exists only when the shortcut produced something; text is the case worth a line in the HUD, anything else is a Done.
    const out = code === 0 ? await readFile(outPath).then((b) => new TextDecoder("utf-8", { fatal: true }).decode(b), () => "") : "";
    const first = out.split("\n").map((l) => l.trim()).find(Boolean);
    const hud = code !== 0 ? `${s.name}: ${err.trim().split("\n")[0].replace(/^Error: /, "") || `exited ${code}`}` : first ? `${s.name}: ${truncate(first, 80)}` : `${s.name}: Done`;
    await effects.run({ hud });
  } catch (e) {
    await effects.run({ hud: `${s.name}: ${errorMessage(e)}` }).catch(() => {});
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

const textForm = (s: Shortcut, errors?: Record<string, string>): Form => ({
  id: s.id,
  title: `Run ${s.name}`,
  fields: [{ kind: "textarea", id: "input", label: "Input", required: true, placeholder: "What the shortcut receives as its input", description: "Given to the shortcut as a text file; a shortcut that takes no input ignores it." }],
  submit: { id: "run_text", title: "Run" },
  errors,
});

async function pick(id: string, action?: string, ctx?: Ctx): Promise<Effect | void> {
  if (id.startsWith("hint:")) return;
  const s = known.get(id);
  if (!s) return toast("Shortcut not found", "List again (cmd+r) and retry", "failure");
  switch (action) {
    case "open": return { open: `shortcuts://open-shortcut?name=${encodeURIComponent(s.name)}` };
    case "copy": return { copy: s.name };
    case "text": return { form: textForm(s) };
    case "run_text": {
      const input = String(ctx?.values?.input ?? "");
      if (!input.trim()) return { form: textForm(s, { input: "Required" }) };
      void run(s, input);
      return { hide: true };
    }
    case "clipboard": {
      const text = (await clipboard.list({ kind: "text", limit: 1 }))[0]?.text;
      if (!text) return toast("Nothing on the clipboard", "Copy some text first, or use Run with text", "failure");
      void run(s, text);
      return { hide: true };
    }
    default:
      void run(s);
      return { hide: true };
  }
}

export default {
  palettes: {
    shortcuts: {
      title: "Shortcuts",
      placeholder: "Search shortcuts by name or folder",
      list: async (): Promise<Item[]> => {
        known.clear();
        if (!available()) return unavailable();
        try {
          return (await shortcuts()).map(row);
        } catch (e) {
          return [hint("error", "Could not list shortcuts", `${errorMessage(e)}; cmd+r tries again`, { icon: ICON_OFF })];
        }
      },
      pick,
    },
  },
} satisfies Extension;
