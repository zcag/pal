// The extension host: loads every extension under the given roots into this
// one process, serves list/pick (and the bar items' render/action, bar.ts)
// over stdio, re-imports an extension when its files change, and relays
// extensions' capability calls to the core (bridge.ts). Logs go to stderr;
// stdout is the protocol.
//
//   bun run host.ts <root>...
//
// Each root holds one directory per extension with an index.ts (source, as
// in the repo) or index.js (bundled, as shipped; see
// app/scripts/build-extensions.sh). Later roots win on a name clash, so the
// core passes the bundled root first and the user's own last. A root that
// does not exist yet is picked up when it appears (its parent is watched).
import { watch, type FSWatcher } from "node:fs";
import { lstat, mkdir, readdir, readlink, realpath, rm, stat, symlink } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { checkLinkEffect, checkLinkParams, checkLinks, checkPalettes, inlineMatches, isViewPalette as isView } from "../../sdk/src/manifest.ts";
import { checkEffect, checkView } from "../../sdk/src/view.ts";
import type { Ctx, Extension, Item, Manifest, Notification, Palette, PaletteMeta, Request, ResolvedSettings, Response, SettingSpec, SettingsChanged } from "../../sdk/src/protocol.ts";
import { barMetas, barMethods } from "./bar.ts";
import { call, resolve as resolveCore } from "./bridge.ts";
import { bindSdk, SDK } from "./sdk.ts";
import { context, setRoots, update as updateSettings } from "./settings.ts";

const VERSION = "0.0.1";
const ROOTS = process.argv.slice(2).map((r) => resolve(r));
if (ROOTS.length === 0) ROOTS.push(resolve(import.meta.dir, "../../extensions"));
setRoots(ROOTS);
/** An import that never settles (a top-level await on something that never comes) must not hold `host/ready` back. Env for the tests. */
const LOAD_TIMEOUT_MS = Number(process.env.PAL_LOAD_TIMEOUT_MS) || 10_000;
/** A root section's palette (inline, fallback, suggest) slower than this is left out of that answer: the root paints without it. Env for the tests. */
const ROOT_TIMEOUT_MS = Number(process.env.PAL_ROOT_TIMEOUT_MS) || 1500;
/** Rows one palette may put in the root's inline section; the palette's own level lists everything. */
const INLINE_MAX = 5;

type Found = { root: string; entry: string };
const exts = new Map<string, Extension>();
const found = new Map<string, Found>();
const errors = new Map<string, string>();
/** Read before the code, kept across a failed load: what the settings window shows either way. */
const manifests = new Map<string, Manifest>();
/** Per loaded extension, the manifest checked against the code (`checkPalettes`): the metas served, the disagreements found. */
const checked = new Map<string, { metas: PaletteMeta[]; warnings: string[] }>();

const log = (...a: unknown[]) => console.error("[host]", ...a);
const send = (msg: Response | Notification) => process.stdout.write(JSON.stringify(msg) + "\n");
// stdout is the protocol: an extension's console.log would land between the
// frames, so everything console prints goes to stderr.
console.log = console.info = console.debug = console.error;
const notify = (method: string, params?: unknown) => send({ method, params });

const exists = (p: string) => stat(p).then(() => true, () => false);
const isDir = (p: string) => stat(p).then((s) => s.isDirectory(), () => false);

function timeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, rej) => { t = setTimeout(() => rej(new Error(`${what} timed out after ${ms} ms`)), ms); });
  return Promise.race([p, late]).finally(() => clearTimeout(t));
}

/** `<root>/<name>/index.{ts,js}`, or undefined when `name` is no extension there. */
async function entry(root: string, name: string): Promise<Found | undefined> {
  for (const file of ["index.ts", "index.js"]) {
    const path = `${root}/${name}/${file}`;
    if (await exists(path)) return { root, entry: path };
  }
}

/** `node_modules` (the `@zcag/pal` link lives there) and dotfiles are never extensions. */
const isExtensionName = (name: string) => !!name && name !== "node_modules" && !name.startsWith(".");

/** Every extension across the roots; a later root replaces an earlier one's entry. */
async function discover(): Promise<Map<string, Found>> {
  const map = new Map<string, Found>();
  for (const root of ROOTS) {
    if (!(await exists(root))) continue;
    const names = (await readdir(root, { withFileTypes: true }).catch(() => [])).filter((d) => d.isDirectory() && isExtensionName(d.name)).map((d) => d.name);
    for (const name of names) {
      const f = await entry(root, name);
      if (f) map.set(name, f);
    }
  }
  return map;
}

/**
 * `<dir>/pal.json`, relative to the extension's own directory so a root can
 * live anywhere. A missing or broken manifest is not fatal: the extension
 * gets a bare one (its dir name as title, no settings) and the problem is
 * logged, since the code may still be fine.
 */
async function manifestOf(dir: string, name: string): Promise<Manifest> {
  const file = `${dir}/pal.json`;
  const bare: Manifest = { name, title: name };
  if (!(await exists(file))) return bare;
  try {
    const m = await Bun.file(file).json();
    if (!m || typeof m !== "object") throw new Error("not an object");
    return { ...bare, ...m, name };
  } catch (e) {
    log(`bad manifest ${file}: ${describe(e)}`);
    return bare;
  }
}

/** Never rejects: a failed load is `extension/error`, anything else a log line, and the other extensions still serve. */
async function load(name: string) {
  try {
    await reload(name);
  } catch (e) {
    log(`load ${name} failed: ${describe(e)}`);
  }
}

async function reload(name: string) {
  const f = found.get(name) ?? (await discover()).get(name);
  if (!f) return drop(name);
  found.set(name, f);
  const t0 = performance.now();
  const manifest = await manifestOf(`${f.root}/${name}`, name);
  manifests.set(name, manifest);
  // The values before the code runs, so `settings.get()` at top level has
  // them; the core keeps them current from here on (`settings/changed`).
  try {
    updateSettings({ [name]: await call<ResolvedSettings>("settings.get", { extension: name, manifest }) });
  } catch (e) {
    log(`settings for ${name} unavailable: ${describe(e)}`);
  }
  await dispose(name);
  try {
    // The query string defeats Bun's module cache on re-import; the old
    // module instance stays resident, which is the price of no restart.
    const mod = await timeout(context.run({ extension: name }, () => import(`${f.entry}?t=${Date.now()}`)), LOAD_TIMEOUT_MS, `import of ${name}`);
    const ext = mod.default as Extension;
    if (!ext?.palettes) throw new Error("default export has no palettes");
    exts.set(name, ext);
    errors.delete(name);
    forgetDetails(name);
    // The manifest and the code describe the same palettes; where they
    // disagree the load still succeeds, and each disagreement is a line on
    // stderr and a `warnings` entry the settings window shows.
    const check = checkPalettes(manifest, ext);
    check.warnings.push(...checkLinks(manifest, ext));
    checked.set(name, check);
    for (const w of check.warnings) log(`[${name}] manifest: ${w}`);
    const bar = barMetas(ext, manifest);
    log(`loaded ${name} (${Object.keys(ext.palettes).join(",")}${bar.length ? `; bar ${bar.map((b) => b.id).join(",")}` : ""}) from ${f.root} in ${(performance.now() - t0).toFixed(1)}ms`);
    notify("extension/loaded", { extension: name, root: f.root, palettes: check.metas, bar, manifest, warnings: check.warnings });
  } catch (e) {
    const message = describe(e);
    exts.delete(name);
    checked.delete(name);
    errors.set(name, message);
    log(`failed ${name}: ${message}`);
    notify("extension/error", { extension: name, root: f.root, message, manifest });
  }
}

/**
 * The directory is gone from every root (deleted, or its entry file
 * removed): whatever was loaded from it leaves. The resident module cannot
 * be unloaded, but nothing routes to it any more. A name that was never
 * an extension (a stray file in a root) is nothing to report.
 */
async function drop(name: string) {
  if (!manifests.has(name)) return;
  await dispose(name);
  found.delete(name);
  exts.delete(name);
  checked.delete(name);
  errors.delete(name);
  manifests.delete(name);
  forgetDetails(name);
  log(`removed ${name}`);
  notify("extension/removed", { extension: name });
}

const forgetDetails = (name: string) => { for (const k of details.keys()) if (k.startsWith(`${name}/`)) details.delete(k); };

/** The resident module's `dispose` before it is replaced or let go: its intervals and watchers would otherwise run on. Its failure is its own (logged). */
async function dispose(name: string) {
  const ext = exts.get(name);
  if (!ext?.dispose) return;
  exts.delete(name);
  try { await timeout(context.run({ extension: name }, () => Promise.resolve(ext.dispose!())), 1000, `dispose of ${name}`); } catch (e) { log(`dispose ${name} failed: ${describe(e)}`); }
}

// Bun raises BuildMessage (one) or AggregateError of them (many) for a file
// that fails to compile; neither prints its position by itself.
function describe(e: unknown): string {
  const errs = e instanceof AggregateError ? e.errors : [e];
  return errs
    .map((x: any) => (x?.position ? `${x.position.file}:${x.position.line}: ${x.message}` : x?.message ?? String(x)))
    .join("; ");
}

const realOr = (p: string) => realpath(p).catch(() => resolve(p));

/**
 * `<root>/node_modules/@zcag/pal` -> the SDK next to this host (`sdk/`,
 * `@zcag/pal` on npm), so `import { settings } from "@zcag/pal"` in an
 * installed extension resolves by Bun's ordinary walk up the directory
 * tree without a fetch (the host runs with `--no-install`, and a
 * `Bun.plugin` onResolve did not intercept a bare import, 2026-09-16). An
 * extension that carries its own copy of the package in its node_modules
 * gets that one instead, which is fine: the SDK reaches the host through a
 * process-wide slot (sdk/src/runtime.ts), not a shared module. The bundled
 * root, next to the host's own dir, has the SDK inlined by
 * build-extensions.sh (in the repo it resolves through the workspace) and
 * is left alone (compared by real path, so a symlinked config dir still
 * counts as the user's). Re-pointed when the host moved (an app update); a
 * real directory at that path is someone else's and is left as it is.
 */
async function linkApi(root: string) {
  const host = resolve(import.meta.dir, "..");
  if (dirname(await realOr(root)) === dirname(await realOr(host))) return;
  const link = `${root}/node_modules/@zcag/pal`;
  const current = await lstat(link).catch(() => undefined);
  if (current && !current.isSymbolicLink()) return log(`${link} exists and is not a link; leaving it`);
  if (current && (await readlink(link).catch(() => undefined)) === SDK) return;
  await mkdir(dirname(link), { recursive: true });
  if (current) await rm(link, { force: true });
  await symlink(SDK, link);
  log(`linked ${link} -> ${SDK}`);
}

/** Everything under a root, in one pass; what a fresh root gets when it appears. */
async function loadRoot(root: string) {
  await linkApi(root).catch((e) => log(`link pal in ${root} failed: ${describe(e)}`));
  const all = await discover();
  const names = [...all].filter(([, f]) => f.root === root).map(([name]) => name);
  for (const name of names) found.delete(name);
  await Promise.all(names.map(load));
}

async function loadAll() {
  for (const root of ROOTS) if (await exists(root)) await linkApi(root).catch((e) => log(`link pal in ${root} failed: ${describe(e)}`));
  for (const [name, f] of await discover()) found.set(name, f);
  await Promise.all([...found.keys()].map(load));
}

// ---- watching --------------------------------------------------------------
// One recursive watcher per root that exists, plus one on each root's
// parent so a root created after start (the user's first `pal install`)
// is picked up, and a root deleted whole lets its extensions go.

const watchers = new Map<string, FSWatcher>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

/** Coalesces the burst of events one save produces into one reload. */
function schedule(name: string) {
  clearTimeout(timers.get(name));
  // A new directory, or one whose entry moved roots: look again. A removed
  // one falls through to `drop` inside `load`, or to the root it still has.
  timers.set(name, setTimeout(() => { timers.delete(name); found.delete(name); load(name); }, 50));
}

function watchRoot(root: string) {
  if (watchers.has(root)) return;
  try {
    const w = watch(root, { recursive: true }, (_event, file) => {
      const name = String(file ?? "").split("/")[0];
      if (isExtensionName(name)) schedule(name);
    });
    w.on("error", (e) => { log(`watch ${root} failed: ${describe(e)}`); unwatchRoot(root); });
    watchers.set(root, w);
  } catch (e) {
    log(`watch ${root} failed: ${describe(e)}`);
  }
}

function unwatchRoot(root: string) {
  watchers.get(root)?.close();
  watchers.delete(root);
}

/** The root came or went: watch it and load what is there, or let its extensions go. */
async function rootChanged(root: string) {
  if (await isDir(root)) {
    if (watchers.has(root)) return;
    log(`root ${root} appeared`);
    watchRoot(root);
    await loadRoot(root);
  } else if (watchers.has(root)) {
    log(`root ${root} gone`);
    unwatchRoot(root);
    for (const [name, f] of found) if (f.root === root) schedule(name);
  }
}

async function watchExtensions() {
  for (const root of ROOTS) {
    if (await isDir(root)) watchRoot(root);
    const parent = dirname(root);
    if (parent === root || watchers.has(parent) || !(await isDir(parent))) continue;
    try {
      const w = watch(parent, (_event, file) => {
        const hit = ROOTS.find((r) => dirname(r) === parent && basename(r) === String(file ?? ""));
        if (hit) rootChanged(hit).catch((e) => log(`root ${hit}: ${describe(e)}`));
      });
      w.on("error", (e) => { log(`watch ${parent} failed: ${describe(e)}`); unwatchRoot(parent); });
      watchers.set(parent, w);
    } catch (e) {
      log(`watch ${parent} failed: ${describe(e)}`);
    }
  }
}

/**
 * `detail(id)` answers, per palette, keyed by item id and the ctx that listed
 * it; a `list` of that palette drops them (the items may be new), a reload of
 * the extension too.
 */
const details = new Map<string, Map<string, Promise<unknown>>>();
const paletteKey = (p: any) => `${p?.extension}/${p?.palette}`;
// The core sends `args: null` and `values: null` for a level without them: absent, as far as the extension is told.
const ctxOf = (p: any): Ctx | undefined =>
  p?.filter !== undefined || p?.args != null || p?.refresh || p?.values != null || p?.inline || Array.isArray(p?.ids)
    ? { filter: p.filter, ...(p.args != null && { args: p.args }), ...(p.refresh && { refresh: true }), ...(p.values != null && { values: p.values }), ...(p.inline && { inline: true }), ...(Array.isArray(p.ids) && { ids: p.ids.map(String) }) }
    : undefined;

/** The loaded extension, or the reason it is not: its load error, or that there is none. */
function extension(name: string): Extension {
  const ext = exts.get(name);
  if (!ext) throw new Error(errors.get(name) ?? `no extension ${name}`);
  return ext;
}

function palette(p: any) {
  const pal = extension(p?.extension).palettes[p?.palette];
  if (!pal) throw new Error(`no palette ${p?.extension}/${p?.palette}`);
  return pal;
}

/** Runs `f` knowing which palette it serves, so `settings.get()` in there needs no argument. */
const inContext = <T>(p: any, f: () => T): T => context.run({ extension: String(p?.extension), palette: String(p?.palette) }, f);

/** Secrets arrive resolved (the value itself); the log gets their keys only. */
function redacted(name: string, s: ResolvedSettings) {
  const m = manifests.get(name);
  const hide = (specs: SettingSpec[] | undefined, values: Record<string, unknown>) => {
    const secret = new Set((specs ?? []).filter((x) => x.kind === "secret").map((x) => x.id));
    return Object.fromEntries(Object.entries(values ?? {}).map(([k, v]) => [k, secret.has(k) ? "<secret>" : v]));
  };
  return {
    settings: hide(m?.settings, s.settings),
    palettes: Object.fromEntries(Object.entries(s.palettes ?? {}).map(([k, v]) => [k, hide(m?.palettes?.[k]?.settings, v)])),
  };
}

/** One root section's answer from one palette: `{ extension, palette, items }`, or nothing when it had none, failed or was too slow (logged). */
type Section = { extension: string; palette: string; items: Item[] };

/**
 * The root's sections that come from the extensions rather than the
 * index: every loaded palette that `pick`s (inline for a matching query,
 * fallback for a function fallback, suggest for the empty root) is asked
 * at once, each within `ROOT_TIMEOUT_MS`; a palette that fails or is late
 * is a log line and left out, so one slow extension never holds the root.
 * Palettes come in load order; the core and the UI order the sections.
 */
async function sections(pick: (name: string, key: string, p: Palette) => (() => Item[] | Promise<Item[]>) | undefined, what: string, max = Infinity): Promise<Section[]> {
  const asks: Promise<Section | undefined>[] = [];
  for (const [name, ext] of exts) {
    for (const [key, p] of Object.entries(ext.palettes ?? {})) {
      const f = pick(name, key, p);
      if (!f) continue;
      const params = { extension: name, palette: key };
      asks.push(
        // A throw before the first await (a sync hook) is a rejection like any other, not the whole answer's.
        timeout(Promise.resolve().then(() => inContext(params, f)), ROOT_TIMEOUT_MS, `${what} of ${name}/${key}`).then(
          (items) => (Array.isArray(items) && items.length ? { extension: name, palette: key, items: items.slice(0, max) } : undefined),
          (e) => { log(`${what} ${name}/${key} failed: ${describe(e)}`); return undefined; },
        ),
      );
    }
  }
  return (await Promise.all(asks)).filter((s): s is Section => s !== undefined);
}

const methods: Record<string, (params: any) => unknown> = {
  hello: () => ({
    version: VERSION,
    bun: Bun.version,
    pid: process.pid,
    roots: ROOTS,
    extensions: [...manifests].map(([name, manifest]) => ({ name, root: found.get(name)?.root, manifest, loaded: exts.has(name), palettes: checked.get(name)?.metas ?? [], warnings: checked.get(name)?.warnings ?? [], bar: exts.has(name) ? barMetas(exts.get(name), manifest) : [] })),
    errors: Object.fromEntries(errors),
  }),
  list: async (p) => {
    details.delete(paletteKey(p));
    const pal = palette(p);
    if (isView(pal)) throw new Error(`${paletteKey(p)}: a view palette has no list`);
    const items = await inContext(p, () => pal.list(p.query, ctxOf(p)));
    if (!Array.isArray(items)) throw new Error(`${paletteKey(p)}: list returned ${items === null ? "null" : typeof items}, not an array`);
    return { items };
  },
  // An effect carrying a view is checked like a `view` answer: the UI draws it the same way. A form likewise.
  pick: async (p) => checkEffect((await inContext(p, () => palette(p).pick(p.id, p.action, ctxOf(p)))) ?? {}, `${paletteKey(p)}: pick ${p.action ?? ""}`),
  // The tree a view palette opens with; `filter`/`args` reach it as ctx like a list.
  view: async (p) => {
    const pal = palette(p);
    if (!isView(pal)) throw new Error(`${paletteKey(p)}: not a view palette`);
    return checkView(await inContext(p, () => pal.view(ctxOf(p))), `${paletteKey(p)}: view`);
  },
  // `{}` when the palette has no `detail` or answers nothing: the UI keeps the inline one.
  detail: (p) => {
    const pal = palette(p);
    if (!pal.detail) return {};
    const key = paletteKey(p);
    const cache = details.get(key) ?? new Map<string, Promise<unknown>>();
    details.set(key, cache);
    const k = `${JSON.stringify(ctxOf(p)?.args ?? null)}\0${p.id}`;
    let r = cache.get(k);
    if (!r) {
      r = Promise.resolve(inContext(p, () => pal.detail!(p.id, ctxOf(p)))).then((d) => d ?? {});
      cache.set(k, r);
      r.catch(() => cache.delete(k));
    }
    return r;
  },
  // The root's inline section for `query`: every inline palette whose `match` accepts it lists it (`ctx.inline`), its first rows.
  inline: async (p) => {
    const q = String(p?.query ?? "");
    return sections((name, _key, pal) => (!isView(pal) && inlineMatches(pal, manifests.get(name)?.palettes?.[_key], q) ? () => pal.list(q, { inline: true }) : undefined), "inline", INLINE_MAX);
  },
  // The root's fallback rows from the palettes that answer them in code (`fallback(query)`); the "Ask" rows are the core's.
  fallback: async (p) => {
    const q = String(p?.query ?? "");
    return sections((_name, _key, pal) => (typeof pal.fallback === "function" ? () => (pal.fallback as (q: string) => Item[] | Promise<Item[]>)(q) : undefined), "fallback");
  },
  // The empty root's "Now" section: every palette's `suggest()`.
  suggest: async () => sections((_name, _key, pal) => (typeof pal.suggest === "function" ? () => pal.suggest!() : undefined), "suggest"),
  // `pal://<extension>/<route>?params` (deeplink.rs): the manifest's `links.<route>` gates it and types its params, the code's `link` answers; an effect is checked like a pick's, minus what needs a level.
  link: async (p) => {
    const name = String(p?.extension), route = String(p?.route);
    const ext = extension(name);
    const spec = manifests.get(name)?.links?.[route];
    if (!spec || typeof spec !== "object") throw new Error(`no route ${name}/${route}`);
    if (typeof ext.link !== "function") throw new Error(`${name}: no link handler for ${route}`);
    const params = checkLinkParams(spec, p?.params && typeof p.params === "object" ? p.params : {}, `${name}/${route}`);
    const r = await context.run({ extension: name }, () => ext.link!(route, params));
    return checkEffect(checkLinkEffect(r ?? {}, `${name}/${route}`), `${name}/${route}: link`);
  },
  ...barMethods(extension),
  // Notification from the core: the resolved values of the named extensions.
  "settings/changed": (p: SettingsChanged) => {
    const changed = p?.extensions ?? {};
    updateSettings(changed);
    for (const [name, s] of Object.entries(changed)) {
      const r = redacted(name, s);
      log(`settings ${name} ${JSON.stringify(r.settings)} palettes ${JSON.stringify(r.palettes)}`);
    }
  },
};

async function handle(line: string) {
  let req: Request;
  try {
    req = JSON.parse(line);
  } catch {
    return log("bad json:", line.slice(0, 80));
  }
  // No method: the core answering one of ours (see protocol.ts).
  if (req.method === undefined) {
    if (!resolveCore(req as unknown as Response)) log("stray reply", req.id);
    return;
  }
  try {
    const fn = methods[req.method];
    if (!fn) throw new Error(`unknown method ${req.method}`);
    const result = await fn(req.params);
    // No id: a notification, nothing to answer.
    if (req.id !== undefined) send({ id: req.id, result });
  } catch (e) {
    if (req.id !== undefined) send({ id: req.id, error: e instanceof Error ? e.message : String(e) });
    else log(`${req.method} failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// Read stdin from the start: loading an extension asks the core for its
// settings (settings.get) and the reply has to be read while the load waits.
(async () => {
  for await (const line of console) if (line) handle(line);
  // stdin EOF means the core is gone; the watcher would otherwise keep us alive.
  log("stdin closed, exiting");
  process.exit(0);
})().catch((e) => { log(`stdin failed: ${describe(e)}`); process.exit(1); });
bindSdk();
await loadAll();
await watchExtensions();
// `known`: every extension found on disk, loaded or not (the core keeps a failed one's cache).
notify("host/ready", { extensions: [...exts.keys()], known: [...manifests.keys()], roots: ROOTS });
