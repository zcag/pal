// The extension host: loads every extension under the given roots into this
// one process, serves list/pick over stdio, re-imports an extension when its
// files change, and relays extensions' capability calls to the core
// (bridge.ts). Logs go to stderr; stdout is the protocol.
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
import { call, resolve as resolveCore } from "./bridge.ts";
import { context, setRoots, update as updateSettings } from "./settings.ts";
import { checkView } from "./view.ts";
import type { Ctx, Extension, Manifest, Notification, Palette, PaletteMeta, Request, ResolvedSettings, Response, SettingSpec, SettingsChanged, ViewPalette } from "./protocol.ts";

const VERSION = "0.0.1";
const ROOTS = process.argv.slice(2).map((r) => resolve(r));
if (ROOTS.length === 0) ROOTS.push(resolve(import.meta.dir, "../../extensions"));
setRoots(ROOTS);
/** An import that never settles (a top-level await on something that never comes) must not hold `host/ready` back. Env for the tests. */
const LOAD_TIMEOUT_MS = Number(process.env.PAL_LOAD_TIMEOUT_MS) || 10_000;

type Found = { root: string; entry: string };
const exts = new Map<string, Extension>();
const found = new Map<string, Found>();
const errors = new Map<string, string>();
/** Read before the code, kept across a failed load: what the settings window shows either way. */
const manifests = new Map<string, Manifest>();

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

/** `node_modules` (the `pal` link lives there) and dotfiles are never extensions. */
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
  try {
    // The query string defeats Bun's module cache on re-import; the old
    // module instance stays resident, which is the price of no restart.
    const mod = await timeout(context.run({ extension: name }, () => import(`${f.entry}?t=${Date.now()}`)), LOAD_TIMEOUT_MS, `import of ${name}`);
    const ext = mod.default as Extension;
    if (!ext?.palettes) throw new Error("default export has no palettes");
    exts.set(name, ext);
    errors.delete(name);
    forgetDetails(name);
    log(`loaded ${name} (${Object.keys(ext.palettes).join(",")}) from ${f.root} in ${(performance.now() - t0).toFixed(1)}ms`);
    notify("extension/loaded", { extension: name, root: f.root, palettes: metas(ext, manifest), manifest });
  } catch (e) {
    const message = describe(e);
    exts.delete(name);
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
function drop(name: string) {
  if (!manifests.has(name)) return;
  found.delete(name);
  exts.delete(name);
  errors.delete(name);
  manifests.delete(name);
  forgetDetails(name);
  log(`removed ${name}`);
  notify("extension/removed", { extension: name });
}

const forgetDetails = (name: string) => { for (const k of details.keys()) if (k.startsWith(`${name}/`)) details.delete(k); };

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
 * `<root>/node_modules/pal` -> this host, so `import { settings } from "pal"`
 * in an installed extension resolves to api.ts (host/package.json `exports`)
 * by Bun's ordinary walk up the directory tree, and never to the npm package
 * of that name (Bun auto-installs a bare import it cannot resolve; a
 * `Bun.plugin` onResolve did not intercept it, 2026-09-16). The bundled
 * root, next to the host's own dir, imports by relative path and is left
 * alone (compared by real path, so a symlinked config dir still counts as
 * the user's). Re-pointed when the host moved (an app update); a real
 * directory at that path is someone else's and is left as it is.
 */
async function linkApi(root: string) {
  const host = resolve(import.meta.dir, "..");
  if (dirname(await realOr(root)) === dirname(await realOr(host))) return;
  const link = `${root}/node_modules/pal`;
  const current = await lstat(link).catch(() => undefined);
  if (current && !current.isSymbolicLink()) return log(`${link} exists and is not a link; leaving it`);
  if (current && (await readlink(link).catch(() => undefined)) === host) return;
  await mkdir(`${root}/node_modules`, { recursive: true });
  if (current) await rm(link, { force: true });
  await symlink(host, link);
  log(`linked ${link} -> ${host}`);
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

/** A palette whose `view` is a function draws a tree instead of listing rows. */
const isView = (p: Palette): p is ViewPalette => typeof p.view === "function";

// A view palette is `input` on the wire: the core indexes nothing of it
// and the root keeps only its own row, which is what `input` already means.
const metas = (ext: Extension, manifest?: Manifest): PaletteMeta[] =>
  Object.entries(ext.palettes).map(([name, p]) => ({
    name, title: p.title ?? name, live: !!p.live, input: !!p.input || isView(p), icon: p.icon, view: isView(p) ? "view" : p.view, columns: p.columns, placeholder: p.placeholder, showDetail: p.showDetail, filters: p.filters,
    detail: typeof p.detail === "function" ? "lazy" : undefined,
    ttl: p.ttl ?? manifest?.palettes?.[name]?.ttl,
  }));

/**
 * `detail(id)` answers, per palette, keyed by item id and the ctx that listed
 * it; a `list` of that palette drops them (the items may be new), a reload of
 * the extension too.
 */
const details = new Map<string, Map<string, Promise<unknown>>>();
const paletteKey = (p: any) => `${p?.extension}/${p?.palette}`;
const ctxOf = (p: any): Ctx | undefined => (p?.filter !== undefined || p?.args !== undefined || p?.refresh ? { filter: p.filter, args: p.args, ...(p.refresh && { refresh: true }) } : undefined);

function palette(p: any) {
  const ext = exts.get(p?.extension);
  if (!ext) throw new Error(errors.get(p?.extension) ?? `no extension ${p?.extension}`);
  const pal = ext.palettes[p?.palette];
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

const methods: Record<string, (params: any) => unknown> = {
  hello: () => ({
    version: VERSION,
    bun: Bun.version,
    pid: process.pid,
    roots: ROOTS,
    extensions: [...manifests].map(([name, manifest]) => ({ name, root: found.get(name)?.root, manifest, loaded: exts.has(name), palettes: exts.has(name) ? metas(exts.get(name)!, manifest) : [] })),
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
  // An effect carrying a view is checked like a `view` answer: the UI draws it the same way.
  pick: async (p) => {
    const r = (await inContext(p, () => palette(p).pick(p.id, p.action, ctxOf(p)))) ?? {};
    if (r && typeof r === "object" && "view" in r && r.view !== undefined) checkView(r.view, `${paletteKey(p)}: pick ${p.action ?? ""} view`);
    return r;
  },
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
await loadAll();
await watchExtensions();
// `known`: every extension found on disk, loaded or not (the core keeps a failed one's cache).
notify("host/ready", { extensions: [...exts.keys()], known: [...manifests.keys()], roots: ROOTS });
