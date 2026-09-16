// What the v1 tables (index.ts) and the single-file script commands
// (commands.ts) both need: running a script in its own process group with
// a timeout, the PATH scripts get, and the mapping of the JSON-lines row
// vocabulary (icons, accessories, detail, actions) onto the wire shapes.
import { home, settings, type Accessory, type Action, type Detail } from "@zcag/pal";

/** `[extensions.scripts]`, defaults in pal.json. */
export type Settings = { config: string; skip: string[]; v1_repo: string; commands: string; timeout: number; preview_max: number; ttl: number };
/** Read live: `timeout`, `preview_max` and `commands` apply to the next run or listing; `config`, `skip`, `v1_repo` and `ttl` are used at discovery, which runs once at import. */
export const S = () => settings.get<Settings>("scripts");

/** A row, action or envelope as a script printed it: untyped JSON, mapped field by field. */
export type Raw = Record<string, any>;
export type Env = Record<string, string>;
export type Run = { out: string; ok: boolean; timedOut: boolean; code: number | null };
export type V1Action = { id?: string; title?: string; action?: string; value?: string; key?: string; shortcut?: string; style?: string; confirm?: string; reload?: boolean; primary?: boolean };

export const HOME = home("~");
export const log = (...a: unknown[]) => console.error("[scripts]", ...a);

// Scripts call jq, pal, bt, gh...; the app's PATH under launchd has none of them.
export const PATH = [...new Set([...(process.env.PATH ?? "").split(":"), `${HOME}/.local/bin`, `${HOME}/.cargo/bin`, "/opt/homebrew/bin", "/usr/local/bin"])].filter(Boolean).join(":");

/** After the exit, how long stdout is still read for: a child the script left behind may hold the pipe. */
const DRAIN_MS = 500;
/** A script that ignores SIGTERM gets SIGKILL this much later. */
const KILL_MS = 2000;

/**
 * Runs the script in its own process group, so a timeout kills its whole
 * pipeline: killing bash alone leaves `sleep | jq` holding stdout, and a
 * read to EOF would then wait on the orphan, not on the timeout. `stderr`
 * is inherited (pal's log) unless asked for.
 */
export async function run(cmd: string[], opts: { stdin?: string; env?: Env; cwd?: string; timeout: number; stderr?: "pipe" }): Promise<Run & { err: string }> {
  const ms = opts.timeout * 1000;
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(cmd, { stdin: opts.stdin === undefined ? "ignore" : new Blob([opts.stdin]), stdout: "pipe", stderr: opts.stderr ?? "inherit", cwd: opts.cwd, env: { ...process.env, PATH, ...opts.env }, detached: true });
  } catch (e) {
    log(`cannot run ${cmd[0]}: ${e}`);
    return { out: "", err: e instanceof Error ? e.message : String(e), ok: false, timedOut: false, code: null };
  }
  const chunks: Uint8Array[] = [];
  const errChunks: Uint8Array[] = [];
  // Kept reading past the race below, so it must never reject (an unhandled rejection exits Bun).
  const reading = (async () => { try { for await (const c of proc.stdout as ReadableStream<Uint8Array>) chunks.push(c); } catch {} })();
  const readingErr = opts.stderr ? (async () => { try { for await (const c of proc.stderr as ReadableStream<Uint8Array>) errChunks.push(c); } catch {} })() : Promise.resolve();
  const kill = (sig: NodeJS.Signals) => { try { process.kill(-proc.pid, sig); } catch {} };
  let timedOut = false;
  const timers = [
    setTimeout(() => { timedOut = true; kill("SIGTERM"); }, ms),
    setTimeout(() => kill("SIGKILL"), ms + KILL_MS),
  ];
  const code = await proc.exited;
  timers.forEach(clearTimeout);
  await Promise.race([Promise.all([reading, readingErr]), Bun.sleep(DRAIN_MS)]);
  if (timedOut) log(`${cmd.join(" ")} killed after ${ms} ms`);
  return { out: Buffer.concat(chunks).toString(), err: Buffer.concat(errChunks).toString(), ok: code === 0 && !timedOut, timedOut, code };
}

/** JSON lines: one object per line, blank lines skipped, anything else dropped. */
export const parseLines = (text: string): Raw[] =>
  text.split("\n").flatMap((l) => { if (!l.trim()) return []; try { const v = JSON.parse(l); return v && typeof v === "object" ? [v] : []; } catch { return []; } });

/** A glyph, emoji or hex colour is an icon here; an xdg name goes through the host's table, a Raycast name is dropped. */
export const glyph = (s: unknown): string | undefined => {
  if (typeof s !== "string") return;
  const t = s.trim();
  return t && (/[^\x00-\x7f]/.test(t) || /^#[0-9a-f]{3,8}$/i.test(t)) ? t : undefined;
};

/** v1 (Raycast) `{text:{value,color}} | {tag:{value,color}} | {date}`, or a plain `{text}`. */
export function accessory(a: Raw): Accessory | undefined {
  if (a.tag !== undefined) return typeof a.tag === "object" ? { tag: String(a.tag.value), color: a.tag.color } : { tag: String(a.tag), color: a.color };
  if (a.text !== undefined) return { text: String(typeof a.text === "object" ? a.text.value : a.text) };
  if (a.date !== undefined) return { date: typeof a.date === "object" ? a.date.value : a.date };
}

/** v1 `{markdown, metadata:[{label, text, link, tags} | {separator}]}`; separators have no equivalent. */
export function detail(d: Raw | undefined, markdown?: string): Detail | undefined {
  if (!d && markdown === undefined) return;
  const metadata = ((d?.metadata ?? []) as Raw[]).filter((m) => m.label).map((m) => ({
    label: String(m.label),
    value: m.link ? undefined : m.text === undefined ? undefined : String(m.text),
    link: m.link ? { text: String(m.text ?? m.link), href: String(m.link) } : undefined,
    tags: Array.isArray(m.tags) ? m.tags.map((t: any) => (typeof t === "string" ? { text: t } : { text: String(t.text ?? t.value), color: t.color })) : undefined,
  }));
  return { markdown: markdown ?? d?.markdown, metadata: metadata.length ? metadata : undefined };
}

/** v1 picks the `primary` action, else the first; here the first is Enter, so the primary goes first. */
export function ordered(actions: V1Action[]): V1Action[] {
  const i = actions.findIndex((a) => a.primary);
  return i > 0 ? [actions[i], ...actions.filter((_, j) => j !== i)] : actions;
}

export const toActions = (actions: V1Action[]): Action[] =>
  ordered(actions).map((a) => ({ id: String(a.id ?? a.title), title: String(a.title ?? a.id), shortcut: a.shortcut, style: a.style === "destructive" ? "destructive" : undefined, confirm: a.confirm }));
