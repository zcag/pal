// The zero-code tier: every `[palette.<name>]` of a pal v1 config becomes a
// palette here. A data palette reads its json/jsonl/toml file; a script
// palette runs the plugin's command (`run.sh list`, query on stdin, JSON
// lines out; `run.sh pick`, the item on stdin and as PAL_<KEY> env vars) and
// maps v1's item fields, actions and result envelope onto the new shapes.
// Discovery happens once at import; a changed config path needs a host
// restart.
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { parse as parseToml } from "smol-toml";
import type { Accessory, Action, Ctx, Detail, Effect, Extension, Item, Palette } from "../../host/src/protocol.ts";
import { home, settings } from "../../host/src/api.ts";
import { xdg } from "../../host/src/icons.ts";

/** `[extensions.scripts]`, defaults in pal.json. */
type Settings = { config: string; skip: string[]; v1_repo: string; timeout: number; preview_max: number; ttl: number };
/** A v1 row, action or envelope: untyped JSON from a script, mapped field by field below. */
type Raw = Record<string, any>;
type V1Action = { id?: string; title?: string; action?: string; value?: string; key?: string; shortcut?: string; style?: string; confirm?: string; reload?: boolean; primary?: boolean };
type V1Palette = Raw & {
  base?: string; data?: string; command?: string | string[];
  icon?: string; icon_utf?: string; icon_xdg?: string; input?: boolean; input_prompt?: string; live?: boolean;
  auto_list?: boolean; auto_pick?: boolean; default_action?: string; action_key?: string; actions?: V1Action[];
  view?: string; display?: { detail?: boolean; columns?: number }; filter?: { id: string; name?: string }[];
  requires?: string[]; os?: string; ttl?: number;
};

const HOME = home("~");
const log = (...a: unknown[]) => console.error("[scripts]", ...a);
// Read live (timeout, preview_max apply to the next run); config, skip,
// v1_repo and ttl are used at discovery, which runs once at import.
const S = () => settings.get<Settings>("scripts");
settings.onChange(() => log("settings changed; restart the host to rediscover palettes"), "scripts");

// Scripts call jq, pal, bt, gh...; the app's PATH under launchd has none of them.
const PATH = [...new Set([...(process.env.PATH ?? "").split(":"), `${HOME}/.local/bin`, `${HOME}/.cargo/bin`, "/opt/homebrew/bin", "/usr/local/bin"])].filter(Boolean).join(":");

// ---- paths -----------------------------------------------------------------

/** v1's `expand_path`: `github:` to its sparse-checkout cache (or the v1 checkout for zcag/pal), `~`, absolute, else relative to the config dir. */
function expand(p: string, cfgDir: string): string {
  const gh = p.match(/^github:([^/]+)\/([^/]+)\/(.+?)(?:@([^@/]+))?$/);
  if (gh) {
    const [, user, repo, path, ref = "main"] = gh;
    const cache = `${process.env.XDG_DATA_HOME || `${HOME}/.local/share`}/pal/plugins/github.com/${user}/${repo}/${ref}/${path}`;
    if (existsSync(cache)) return cache;
    if (user === "zcag" && repo === "pal") return `${home(S().v1_repo)}/${path}`;
    return cache;
  }
  p = home(p);
  return isAbsolute(p) ? p : resolve(cfgDir, p);
}

function readToml(file: string): Raw | undefined {
  try { return parseToml(readFileSync(file, "utf8")) as Raw; } catch (e) { if (existsSync(file)) log(`bad toml ${file}: ${e}`); }
}

/** A `.env`-style file into a table; v1's `general.env_file`. */
function readEnvFile(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (const raw of readFileSync(file, "utf8").split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const i = line.indexOf("=");
      if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^(["'])(.*)\1$/, "$2");
    }
  } catch {}
  return out;
}

/** JSON lines, a JSON array, or the first top-level array of a TOML file; bad lines are dropped. */
function readData(file: string): Raw[] {
  let text: string;
  try { text = readFileSync(file, "utf8"); } catch { log(`no data file ${file}`); return []; }
  if (file.endsWith(".toml")) {
    let table: Raw = {};
    try { table = parseToml(text) as Raw; } catch (e) { log(`bad toml ${file}: ${e}`); }
    return (Object.values(table).find(Array.isArray) as Raw[] | undefined) ?? [];
  }
  if (text.trim().startsWith("[")) { try { return JSON.parse(text); } catch { return []; } }
  return parseLines(text);
}

const parseLines = (text: string): Raw[] =>
  text.split("\n").flatMap((l) => { if (!l.trim()) return []; try { const v = JSON.parse(l); return v && typeof v === "object" ? [v] : []; } catch { return []; } });

// ---- processes --------------------------------------------------------------

type Env = Record<string, string>;
type Run = { out: string; ok: boolean; timedOut: boolean };

/** After the exit, how long stdout is still read for: a child the script left behind may hold the pipe. */
const DRAIN_MS = 500;
/** A script that ignores SIGTERM gets SIGKILL this much later. */
const KILL_MS = 2000;

/**
 * Runs the script in its own process group, so a timeout kills its whole
 * pipeline: killing bash alone leaves `sleep | jq` holding stdout, and a
 * read to EOF would then wait on the orphan, not on the timeout.
 */
async function run(cmd: string[], opts: { stdin?: string; env: Env; cwd?: string; timeout?: number }): Promise<Run> {
  const ms = (opts.timeout ?? S().timeout) * 1000;
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(cmd, { stdin: opts.stdin === undefined ? "ignore" : new Blob([opts.stdin]), stdout: "pipe", stderr: "inherit", cwd: opts.cwd, env: { ...process.env, PATH, ...opts.env }, detached: true });
  } catch (e) {
    log(`cannot run ${cmd[0]}: ${e}`);
    return { out: "", ok: false, timedOut: false };
  }
  const chunks: Uint8Array[] = [];
  // Kept reading past the race below, so it must never reject (an unhandled rejection exits Bun).
  const reading = (async () => { try { for await (const c of proc.stdout as ReadableStream<Uint8Array>) chunks.push(c); } catch {} })();
  const kill = (sig: NodeJS.Signals) => { try { process.kill(-proc.pid, sig); } catch {} };
  let timedOut = false;
  const timers = [
    setTimeout(() => { timedOut = true; kill("SIGTERM"); }, ms),
    setTimeout(() => kill("SIGKILL"), ms + KILL_MS),
  ];
  const code = await proc.exited;
  timers.forEach(clearTimeout);
  await Promise.race([reading, Bun.sleep(DRAIN_MS)]);
  if (timedOut) log(`${cmd.join(" ")} killed after ${ms} ms`);
  return { out: Buffer.concat(chunks).toString(), ok: code === 0 && !timedOut, timedOut };
}

/**
 * v1's `cmd` action: `bash -c` with the item's env. Waited on briefly so a
 * `reload` re-lists after the command has done its work and an envelope it
 * prints (`... | pal action copy`) still counts; a slow one runs on alone.
 */
async function shell(value: string, env: Env): Promise<Effect> {
  const proc = Bun.spawn(["bash", "-c", value], { stdin: "ignore", stdout: "pipe", stderr: "inherit", env: { ...process.env, PATH, ...env } });
  const text = new Response(proc.stdout as ReadableStream).text();
  const done = await Promise.race([text.then(() => true), Bun.sleep(3000).then(() => false)]);
  if (!done) { proc.unref(); return {}; }
  return effect(envelope(await text));
}

/** Every item field as `PAL_<KEY>`: strings as they are, anything else as JSON. */
const itemEnv = (raw: Raw): Env =>
  Object.fromEntries(Object.entries(raw).map(([k, v]) => [`PAL_${k.toUpperCase()}`, typeof v === "string" ? v : JSON.stringify(v)]));

// ---- v1 result envelope -> Effect ------------------------------------------

const ENVELOPE_KEYS = ["toast", "hud", "clipboard", "open", "show", "reload", "close", "palette"];

/** The envelope in a pick's output: the whole output, else its last line; anything else is plain text v1 would have printed. */
function envelope(out: string): Raw | undefined {
  const lines = out.trim().split("\n");
  for (const s of [out.trim(), lines[lines.length - 1]]) {
    if (!s.startsWith("{")) continue;
    try { const v = JSON.parse(s); if (v && typeof v === "object" && ENVELOPE_KEYS.some((k) => k in v)) return v; } catch {}
  }
}

function effect(env?: Raw): Effect {
  if (!env) return {};
  const e: Effect = {};
  if (typeof env.clipboard === "string") e.copy = env.clipboard;
  if (typeof env.open === "string") e.open = env.open;
  if (env.reload) e.keep = true;
  const style = env.toast?.style === "success" || env.toast?.style === "failure" ? env.toast.style : undefined;
  if (env.toast) e.toast = { title: String(env.toast.title ?? env.toast.message ?? ""), message: env.toast.title ? env.toast.message : undefined, style };
  // A hud after copy/open/close is v1's passive notification; a toast here would hold the window open.
  else if (typeof env.hud === "string" && e.copy === undefined && e.open === undefined && !env.close) e.toast = { title: env.hud };
  // v1 `show` is a detail to read; `palette` (+ `env`) a drill-down into another v1 palette, which is one of ours.
  if (env.show && typeof env.show === "object") e.show = { ...detail(env.show), title: typeof env.show.title === "string" ? env.show.title : undefined };
  if (typeof env.palette === "string") e.push = { extension: "scripts", palette: env.palette, args: env.env && typeof env.env === "object" ? env.env : undefined };
  return e;
}

// ---- v1 item -> Item ---------------------------------------------------------

/** A glyph, emoji or hex colour is an icon here; an xdg name goes through the host's table, a Raycast name is dropped. */
const glyph = (s: unknown): string | undefined => {
  if (typeof s !== "string") return;
  const t = s.trim();
  return t && (/[^\x00-\x7f]/.test(t) || /^#[0-9a-f]{3,8}$/i.test(t)) ? t : undefined;
};

/** v1 (Raycast) `{text:{value,color}} | {tag:{value,color}} | {date}`, or a plain `{text}`. */
function accessory(a: Raw): Accessory | undefined {
  if (a.tag !== undefined) return typeof a.tag === "object" ? { tag: String(a.tag.value), color: a.tag.color } : { tag: String(a.tag) };
  if (a.text !== undefined) return { text: String(typeof a.text === "object" ? a.text.value : a.text) };
  if (a.date !== undefined) return { date: typeof a.date === "object" ? a.date.value : a.date };
}

/** v1 `{markdown, metadata:[{label, text, link, tags} | {separator}]}`; separators have no equivalent. */
function detail(d: Raw | undefined, markdown?: string): Detail | undefined {
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
function ordered(actions: V1Action[]): V1Action[] {
  const i = actions.findIndex((a) => a.primary);
  return i > 0 ? [actions[i], ...actions.filter((_, j) => j !== i)] : actions;
}

const toActions = (actions: V1Action[]): Action[] =>
  ordered(actions).map((a) => ({ id: String(a.id ?? a.title), title: String(a.title ?? a.id), shortcut: a.shortcut, style: a.style === "destructive" ? "destructive" : undefined, confirm: a.confirm }));

const DEFAULT_TITLE: Record<string, string> = { copy: "Copy", open: "Open", cmd: "Run", type: "Paste" };

function toItem(raw: Raw, p: Loaded): Item {
  const { icon_utf, icon_rc, icon_xdg, icon, accessories, detail: d, actions, preview: _p, ...rest } = raw;
  const id = String(raw.id ?? raw.name ?? "");
  const own = Array.isArray(actions) && actions.length ? toActions(actions) : p.actions;
  return {
    ...rest,
    id,
    name: String(raw.name ?? id),
    icon: glyph(icon_utf) ?? glyph(icon) ?? xdg(icon_xdg) ?? p.icon,
    accessories: Array.isArray(accessories) ? accessories.map(accessory).filter((a): a is Accessory => !!a) : undefined,
    detail: detail(d),
    actions: own ?? (p.defaultTitle ? [{ id: "_default", title: p.defaultTitle }] : undefined),
  };
}

// ---- palettes ------------------------------------------------------------------

type Loaded = {
  name: string; cfg: V1Palette; icon?: string; env: Env;
  exec?: string[]; dir?: string; data?: string;
  actions?: Action[]; defaultTitle?: string;
  /** Seconds a listing stays good for: the table's own `ttl`, else for a non-live table the extension's `ttl` setting when above 0 (docs/scripts.md, "ttl"). */
  ttl?: number;
  /** The raw rows of the last list, by the args it ran with (a drill-in level lists apart from the root). */
  items: Map<string, Map<string, Raw>>;
  cache?: { at: number; key: string; items: Item[] };
};

/** `Effect.push` args are v1's `env`: a string map, exported to the script as it is. */
const argsEnv = (ctx?: Ctx): Env =>
  ctx?.args && typeof ctx.args === "object" ? Object.fromEntries(Object.entries(ctx.args as Raw).filter(([, v]) => typeof v === "string")) : {};
const argsKey = (ctx?: Ctx) => JSON.stringify(argsEnv(ctx));

const inert = (name: string, subtitle: string): Palette => ({
  title: name, icon: "!",
  list: () => [{ id: "hint", name: `${name} is not available`, subtitle, icon: "!", actions: [] }],
  pick: () => ({}),
});

async function listItems(p: Loaded, query?: string, ctx?: Ctx): Promise<Item[]> {
  const filter = ctx?.filter;
  const key = `${query ?? ""}\0${filter ?? ""}\0${argsKey(ctx)}`;
  const ttl = (p.ttl ?? 0) * 1000;
  if (p.cache && p.cache.key === key && Date.now() - p.cache.at < ttl && !ctx?.refresh) return p.cache.items;
  const env: Env = { ...p.env, ...argsEnv(ctx), ...(filter !== undefined && { PAL_FILTER: filter }), ...(query !== undefined && { PAL_QUERY: query }) };
  let rows: Raw[] = [];
  if (p.cfg.auto_list && p.data) rows = readData(p.data);
  else if (p.exec) rows = parseLines((await run(p.exec.concat("list"), { stdin: query, env, cwd: p.dir })).out);
  // v1's normalize_item: an id-less item gets its name, and pick sees it (PAL_ID, the stdin item).
  for (const r of rows) if (r.id === undefined && r.name !== undefined) r.id = r.name;
  p.items.set(argsKey(ctx), new Map(rows.map((r) => [String(r.id ?? ""), r])));
  const items = rows.map((r) => toItem(r, p));
  if (ttl) p.cache = { at: Date.now(), key, items };
  return items;
}

/** At most `preview_max` preview commands run at once; the rest wait their turn. */
let previewsRunning = 0;
const previewQueue: (() => void)[] = [];
const previewSlot = () => (previewsRunning < S().preview_max ? (previewsRunning++, Promise.resolve()) : new Promise<void>((r) => previewQueue.push(() => (previewsRunning++, r()))));
const previewDone = () => { previewsRunning--; previewQueue.shift()?.(); };
/** A preview is one pane's worth of markdown, not a listing. */
const PREVIEW_TIMEOUT_S = 10;

/**
 * v1 `preview`: a shell command whose stdout is the detail markdown, run
 * when the detail pane rests on the row (the host caches it per item until
 * the next list). Rows without one answer nothing, so the inline detail stands.
 */
async function detailItem(p: Loaded, id: string, ctx?: Ctx): Promise<Detail | void> {
  const raw = p.items.get(argsKey(ctx))?.get(id);
  if (!raw || typeof raw.preview !== "string" || S().preview_max <= 0) return;
  await previewSlot();
  try {
    const r = await run(["bash", "-c", raw.preview], { env: { ...p.env, ...argsEnv(ctx), ...itemEnv(raw) }, timeout: PREVIEW_TIMEOUT_S });
    if (r.ok) return { markdown: r.out };
  } finally {
    previewDone();
  }
}

async function pickItem(p: Loaded, id: string, actionId?: string, ctx?: Ctx): Promise<Effect> {
  const raw = p.items.get(argsKey(ctx))?.get(id);
  if (!raw) return { toast: { title: "Item not found", message: "List again and retry", style: "failure" } };
  const env: Env = { ...p.env, ...argsEnv(ctx), ...itemEnv(raw) };
  const actions: V1Action[] = Array.isArray(raw.actions) && raw.actions.length ? raw.actions : p.cfg.actions ?? [];
  const action = actionId ? actions.find((a) => a.id === actionId || a.title === actionId) : actions.find((a) => a.primary) ?? actions[0];
  const pick = async () => (p.exec ? effect(envelope((await run(p.exec.concat("pick"), { stdin: JSON.stringify(raw), env, cwd: p.dir })).out)) : {});
  if (!action) {
    if (p.cfg.auto_pick) return builtin(p, p.cfg.default_action ?? "cmd", String(raw[p.cfg.action_key ?? "name"] ?? ""), env);
    return pick();
  }
  if (action.id) env.PAL_ACTION = action.id;
  const kind = action.action ?? "pick";
  const key = action.key ?? p.cfg.action_key;
  const value = action.value ?? (key ? String(raw[key] ?? "") : "");
  const e = kind === "pick" ? await pick() : await builtin(p, kind, value, env);
  return action.reload ? { keep: true, ...e } : e;
}

/** v1's action plugins: copy/open/cmd/type natively, anything else a `plugins/actions/<name>` script given the value on stdin. */
async function builtin(p: Loaded, name: string, value: string, env: Env): Promise<Effect> {
  switch (name) {
    case "copy": return { copy: value };
    case "open": return { open: value };
    case "cmd": return shell(value, env);
    case "type": return { paste: { text: value } };
  }
  const dir = [`${dirname(home(S().config))}/plugins/actions/${name}`, `${home(S().v1_repo)}/plugins/actions/${name}`].find((d) => existsSync(`${d}/plugin.toml`));
  const exec = dir && command(dir, readToml(`${dir}/plugin.toml`) ?? {});
  if (!exec) return { toast: { title: `No action ${name}`, message: `${p.name}: not a builtin, and no plugins/actions/${name}`, style: "failure" } };
  return effect(envelope((await run(exec.concat("run"), { stdin: value, env, cwd: dir })).out));
}

/** The plugin's `command` (plugin.toml, or the config's), resolved in its dir; `run.sh` when there is none. */
function command(dir: string, plugin: Raw, user?: Raw): string[] | undefined {
  const c = user?.command ?? plugin.command;
  const arr = typeof c === "string" ? [c] : Array.isArray(c) ? c.map(String) : existsSync(`${dir}/run.sh`) ? ["run.sh"] : undefined;
  return arr && [resolve(dir, arr[0]), ...arr.slice(1)];
}

/** `requires` (binaries, `|` between alternatives) and `os`, v1's `Palette::available`. */
function unavailable(cfg: V1Palette): string | undefined {
  const os = process.platform === "darwin" ? "macos" : process.platform;
  if (cfg.os && cfg.os.toLowerCase() !== os) return `${cfg.os} only`;
  const missing = (cfg.requires ?? []).find((req) => !req.split("|").some((b) => Bun.which(b.trim())));
  if (missing) return `needs ${missing}`;
}

function discover(): Record<string, Palette> {
  const { config, skip: skipped, v1_repo, ttl: defaultTtl } = S();
  const file = home(config);
  const root = readToml(file);
  if (!root) { log(`no v1 config at ${file}`); return {}; }
  const cfgDir = dirname(file);
  const v1 = home(v1_repo);
  const general = (root.general ?? {}) as Raw;
  const baseEnv: Env = { ...(general.env_file ? readEnvFile(expand(general.env_file, cfgDir)) : {}), _PAL_CONFIG: file, _PAL_CONFIG_DIR: cfgDir };
  const skip = new Set(skipped);
  const palettes: Record<string, Palette> = {};
  const report: string[] = [];

  for (const [name, user] of Object.entries((root.palette ?? {}) as Record<string, V1Palette>)) {
    if (skip.has(name)) { report.push(`${name}: skipped (native)`); continue; }
    if (user.base?.startsWith("builtin/")) {
      palettes[name] = inert(name, `v1 builtin (${user.base}) has no equivalent yet`);
      report.push(`${name}: builtin, inert`);
      continue;
    }
    let dir = user.base ? expand(user.base, cfgDir) : undefined;
    // v1 lived at ~/proj/pal before this rewrite took the path; its plugins are still in the v1 checkout.
    const moved = dir && !existsSync(dir) && dir.match(/\/pal\/(plugins\/.+)$/);
    if (moved && existsSync(`${v1}/${moved[1]}`)) { log(`${name}: ${dir} is gone, using ${v1}/${moved[1]}`); dir = `${v1}/${moved[1]}`; }
    const plugin = dir ? readToml(`${dir}/plugin.toml`) ?? {} : {};
    // v1 fills config gaps from plugin.toml field by field; the config wins where set.
    const cfg = { ...plugin, ...Object.fromEntries(Object.entries(user).filter(([, v]) => v !== undefined)) } as V1Palette;
    const why = unavailable(cfg);
    if (why) { report.push(`${name}: gated (${why})`); continue; }
    const exec = dir ? command(dir, plugin, user) : undefined;
    const data = cfg.data ? expand(cfg.data, cfgDir) : undefined;
    if (!(cfg.auto_list && data) && !exec) {
      palettes[name] = inert(name, dir ? `no command in ${dir}` : "no base and no data");
      report.push(`${name}: nothing to run`);
      continue;
    }
    const p: Loaded = {
      name, cfg, dir, exec, data,
      // The table's own ttl, else the setting; a live table is exempt from the default (it asked for fresh rows on every show, and a ttl would skip that relist).
      ttl: cfg.ttl ?? (defaultTtl > 0 && !cfg.live ? defaultTtl : undefined),
      icon: glyph(cfg.icon_utf) ?? glyph(cfg.icon) ?? xdg(cfg.icon_xdg),
      env: { ...baseEnv, _PAL_PALETTE: name, _PAL_PLUGIN_CONFIG: JSON.stringify(cfg) },
      actions: cfg.actions?.length ? toActions(cfg.actions) : undefined,
      defaultTitle: cfg.auto_pick ? DEFAULT_TITLE[cfg.default_action ?? "cmd"] : exec ? "Select" : undefined,
      items: new Map(),
    };
    palettes[name] = {
      title: name,
      icon: p.icon,
      input: !!cfg.input,
      placeholder: cfg.input_prompt,
      live: !!cfg.live,
      // The core keeps the last listing across restarts for this long; the in-process cache in listItems covers show relists and drill-ins with the same value.
      ttl: p.ttl,
      view: cfg.view === "grid" ? "grid" : undefined,
      columns: cfg.display?.columns,
      showDetail: cfg.display?.detail || undefined,
      filters: cfg.filter?.map((f) => ({ id: f.id, title: f.name ?? f.id })),
      list: (query, ctx) => listItems(p, query, ctx),
      pick: (id, action, ctx) => pickItem(p, id, action, ctx),
      // Only a script's rows can carry `preview`; a data file's never do.
      ...(exec && { detail: (id: string, ctx?: Ctx) => detailItem(p, id, ctx) }),
    };
    report.push(`${name}: ${cfg.auto_list && data ? `data ${data}` : `script ${exec![0]}`}`);
  }
  log(report.join("\n  "));
  return palettes;
}

export default { palettes: discover() } satisfies Extension;
