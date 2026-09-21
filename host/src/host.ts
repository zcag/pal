// The extension host: loads every extension under the given roots into this
// one process, serves list/pick (and the bar items' render/action, bar.ts;
// the view lifecycle notifications, views.ts) over stdio, re-imports an extension when its files change, and relays
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
import { isTileIcon } from "../../sdk/src/icon.ts";
import { checkBarRules, checkLinks, checkPalettes } from "../../sdk/src/manifest.ts";
import type { BarMeta, Extension, Manifest, Notification, PaletteMeta, Request, ResolvedSettings, Response, SettingSpec, SettingsChanged, StatesChanged } from "../../sdk/src/protocol.ts";
import { barMetas, barMethods } from "./bar.ts";
import { call, resolve as resolveCore } from "./bridge.ts";
import { loadedInstance, nameOf, resolveInstances, WorkerInstance, type Instance } from "./instances.ts";
import { bindSdk, SDK } from "./sdk.ts";
import { describe, forgetDetails, log, paletteMethods, sections as sectionsOf, timeout, type Section, type SectionKind } from "./serve.ts";
import { context, setRoots, update as updateSettings } from "./settings.ts";
import { update as updateStates } from "./states.ts";
import { forget as forgetViews, viewMethods } from "./views.ts";

const VERSION = "0.0.1";
const ROOTS = process.argv.slice(2).map((r) => resolve(r));
if (ROOTS.length === 0) ROOTS.push(resolve(import.meta.dir, "../../extensions"));
setRoots(ROOTS);
/** An import that never settles (a top-level await on something that never comes) must not hold `host/ready` back. Env for the tests. */
const LOAD_TIMEOUT_MS = Number(process.env.PAL_LOAD_TIMEOUT_MS) || 10_000;
/** A root section's palette (inline, fallback, suggest) slower than this is left out of that answer: the root paints without it. Env for the tests. */
const ROOT_TIMEOUT_MS = Number(process.env.PAL_ROOT_TIMEOUT_MS) || 1500;
/** What a worker's answer to a sections request gets on top of `ROOT_TIMEOUT_MS`, which its palettes are held to inside: only a dead worker runs it out. */
const WORKER_SLACK_MS = 250;

type Found = { root: string; entry: string };
const exts = new Map<string, Extension>();
const found = new Map<string, Found>();
const errors = new Map<string, string>();
/** Read before the code, kept across a failed load: what the settings window shows either way. */
const manifests = new Map<string, Manifest>();
/** Per loaded extension, the manifest checked against the code (`checkPalettes`): the metas served, the disagreements found. */
const checked = new Map<string, { metas: PaletteMeta[]; warnings: string[] }>();
/** Every instance of a `multi` extension, by key, each in its own worker (docs/design/instances.md); `exts` holds the inline, non-`multi` ones by name. */
const workers = new Map<string, WorkerInstance>();

const send = (msg: Response | Notification) => process.stdout.write(JSON.stringify(msg) + "\n");
// stdout is the protocol: an extension's console.log would land between the
// frames, so everything console prints goes to stderr.
console.log = console.info = console.debug = console.error;
const notify = (method: string, params?: unknown) => send({ method, params });

const exists = (p: string) => stat(p).then(() => true, () => false);
const isDir = (p: string) => stat(p).then((s) => s.isDirectory(), () => false);

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
  // A `multi` extension runs every instance in a worker, the default too; the inline copy, if it was one before, goes.
  if (manifest.multi) {
    await dispose(name);
    exts.delete(name);
    checked.delete(name);
    forgetDetails(name);
    return reloadInstances(name, f, manifest);
  }
  await stopInstances(name);
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
    check.warnings.push(...checkLinks(manifest, ext), ...checkBarRules(manifest));
    checked.set(name, check);
    for (const w of check.warnings) log(`[${name}] manifest: ${w}`);
    const bar = barMetas(ext, manifest);
    log(`loaded ${name} (${Object.keys(ext.palettes).join(",")}${bar.length ? `; bar ${bar.map((b) => b.id).join(",")}` : ""}) from ${f.root} in ${(performance.now() - t0).toFixed(1)}ms`);
    notify("extension/loaded", { extension: name, name, root: f.root, instance: { key: name, isDefault: true }, palettes: check.metas, bar, manifest, warnings: check.warnings });
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
  const multi = manifests.get(name)?.multi;
  await dispose(name);
  await stopInstances(name);
  found.delete(name);
  exts.delete(name);
  checked.delete(name);
  errors.delete(name);
  manifests.delete(name);
  forgetDetails(name);
  log(`removed ${name}`);
  // A `multi` extension's instances each said their own `extension/removed` in `stopInstances`.
  if (!multi) notify("extension/removed", { extension: name });
}

/** The resident module's `dispose` before it is replaced or let go: its intervals and watchers would otherwise run on. Its failure is its own (logged). */
async function dispose(name: string) {
  const ext = exts.get(name);
  // The old module's `view.onShown` listeners would otherwise fire next to the new module's.
  forgetViews(name);
  if (!ext?.dispose) return;
  exts.delete(name);
  try { await timeout(context.run({ extension: name }, () => Promise.resolve(ext.dispose!())), 1000, `dispose of ${name}`); } catch (e) { log(`dispose ${name} failed: ${describe(e)}`); }
}

// ---- instances (docs/design/instances.md) ----------------------------------
// A `multi` extension runs one Bun Worker per configured instance
// (`[instances."gmail@work"]`), the default included, so every instance
// has its own SDK binding (its key as caller), its own module registry
// (its own caches) and can be terminated when it hangs. The core says
// which instances there are (`core/instances.get`); a change there is an
// `instances/changed` notification, which reloads the extension's
// instances as a file change would.

const instancesOf = (name: string): WorkerInstance[] => [...workers.values()].filter((w) => w.name === name);

/** The load of every enabled instance of `name`, each announced as its own `extension/loaded` or `extension/error`; the ones no longer configured are stopped. */
async function reloadInstances(name: string, f: Found, manifest: Manifest) {
  let answer: unknown;
  try {
    answer = await call("instances.get", { extension: name });
  } catch (e) {
    log(`instances of ${name} unavailable (${describe(e)}); the default alone`);
  }
  const own = isTileIcon(manifest.icon) ? manifest.icon.tile.bg : undefined;
  const all = resolveInstances(name, answer, own);
  const enabled = all.filter((i) => i.enabled);
  for (const i of all.filter((i) => !i.enabled)) log(`instance ${i.key} is disabled`);
  // Every instance restarts on a reload, as an inline extension is re-imported: the metas depend on how many there are.
  await stopInstances(name, enabled.map((i) => i.key));
  await Promise.all(enabled.map((inst) => startInstance(inst, f, manifest, enabled.length === 1)));
}

async function startInstance(inst: Instance, f: Found, manifest: Manifest, alone: boolean) {
  const { key } = inst;
  let settings: ResolvedSettings = { settings: {}, palettes: {} };
  try {
    settings = await call<ResolvedSettings>("settings.get", { extension: key, manifest });
  } catch (e) {
    log(`settings for ${key} unavailable: ${describe(e)}`);
  }
  updateSettings({ [key]: settings });
  const t0 = performance.now();
  const w = new WorkerInstance(inst, call, log);
  workers.set(key, w);
  try {
    const loaded = await w.start({ alone, entry: f.entry, manifest, settings, loadTimeout: LOAD_TIMEOUT_MS, rootTimeout: ROOT_TIMEOUT_MS }, LOAD_TIMEOUT_MS + 500);
    errors.delete(key);
    for (const x of loaded.warnings) log(`[${key}] manifest: ${x}`);
    // Two times: the import inside the worker, and the whole from spawn to loaded (the worker's own startup is the difference).
    log(`loaded ${key} (${loaded.palettes.map((p) => p.name).join(",")}${loaded.bar.length ? `; bar ${loaded.bar.map((b) => b.id).join(",")}` : ""}) in a worker from ${f.root} in ${loaded.ms.toFixed(1)}ms (${(performance.now() - t0).toFixed(1)}ms with the worker's start)`);
    notify("extension/loaded", { extension: key, name: inst.name, root: f.root, instance: loadedInstance(inst), palettes: loaded.palettes, bar: loaded.bar, manifest, warnings: loaded.warnings });
  } catch (e) {
    const message = describe(e);
    errors.set(key, message);
    log(`failed ${key}: ${message}`);
    await w.stop(0);
    workers.delete(key);
    notify("extension/error", { extension: key, name: inst.name, root: f.root, instance: loadedInstance(inst), message, manifest });
  }
}

/** Stops every worker of `name` (but the `keep` keys, which a reload is about to restart anyway and stops itself); each stopped one is `extension/removed`. */
async function stopInstances(name: string, keep: string[] = []) {
  for (const w of instancesOf(name)) {
    await w.stop();
    workers.delete(w.key);
    errors.delete(w.key);
    forgetViews(w.key);
    if (!keep.includes(w.key)) notify("extension/removed", { extension: w.key, name });
  }
}

/** The methods answered here whatever `params.extension` says: the host's own, and the root sections asked of every extension at once. */
const HOST_LEVEL = new Set(["hello", "inline", "fallback", "suggest", "settings/changed", "instances/changed", "states/changed"]);

/** The worker serving `params.extension` for a per-extension method, or undefined when the key is no instance (an inline extension, or nothing). */
const workerFor = (method: string, params: any): WorkerInstance | undefined => (!HOST_LEVEL.has(method) && typeof params?.extension === "string" ? workers.get(params.extension) : undefined);

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

/** The loaded inline extension, or the reason it is not: its load error, or that there is none (a worker's key never reaches here: `handle` routes it). */
function extension(name: string): Extension {
  const ext = exts.get(name);
  if (!ext) throw new Error(errors.get(name) ?? `no extension ${name}`);
  return ext;
}

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

/**
 * The root's sections of one kind (serve.ts `sections`): the inline
 * extensions' palettes asked here, each worker asked once for its own,
 * all within `ROOT_TIMEOUT_MS` (a worker gets `WORKER_SLACK_MS` on top,
 * its palettes being held to the same inside); a late or failed one is a
 * log line and left out.
 */
async function sections(kind: SectionKind, query: unknown): Promise<Section[]> {
  const inline = sectionsOf(exts, (k) => manifests.get(k), kind, query, ROOT_TIMEOUT_MS);
  const asks = [...workers.values()].map((w) => w.request(kind, { query }, ROOT_TIMEOUT_MS + WORKER_SLACK_MS).then(
    (r) => (Array.isArray(r) ? (r as Section[]) : []),
    (e) => { log(`${kind} of ${w.key} failed: ${describe(e)}`); return [] as Section[]; },
  ));
  return (await Promise.all([inline, ...asks])).flat();
}

/** What `hello` says about one loaded or failed extension (instance). */
type Hello = { name: string; extension: string; root?: string; manifest: Manifest; loaded: boolean; instance: ReturnType<typeof loadedInstance>; palettes: PaletteMeta[]; warnings: string[]; bar: BarMeta[] };

/** Every extension for `hello`: the inline ones by name, every worker by key; a `multi` extension without a running instance (every one failed) once, unloaded. */
function helloExtensions(): Hello[] {
  const out: Hello[] = [];
  for (const [name, manifest] of manifests) {
    if (manifest.multi && instancesOf(name).length) continue;
    out.push({ name, extension: name, root: found.get(name)?.root, manifest, loaded: exts.has(name), instance: { key: name, isDefault: true }, palettes: checked.get(name)?.metas ?? [], warnings: checked.get(name)?.warnings ?? [], bar: exts.has(name) ? barMetas(exts.get(name), manifest) : [] });
  }
  for (const w of workers.values()) {
    const manifest = manifests.get(w.name) ?? { name: w.name, title: w.name };
    out.push({ name: w.name, extension: w.key, root: found.get(w.name)?.root, manifest, loaded: !!w.loaded, instance: loadedInstance(w.inst), palettes: w.loaded?.palettes ?? [], warnings: w.loaded?.warnings ?? [], bar: w.loaded?.bar ?? [] });
  }
  return out;
}

const methods: Record<string, (params: any) => unknown> = {
  hello: () => ({
    version: VERSION,
    bun: Bun.version,
    pid: process.pid,
    roots: ROOTS,
    extensions: helloExtensions(),
    errors: Object.fromEntries(errors),
  }),
  // list, pick, view, detail, link for the inline extensions; a worker's key is routed in `handle` before it gets here.
  ...paletteMethods(extension, (k) => manifests.get(k)),
  inline: (p) => sections("inline", p?.query),
  fallback: (p) => sections("fallback", p?.query),
  suggest: () => sections("suggest", ""),
  ...barMethods(extension),
  ...viewMethods,
  // Notification from the core: the resolved values of the named extensions (instance keys route to their workers' own tables).
  "settings/changed": (p: SettingsChanged) => {
    const changed = p?.extensions ?? {};
    updateSettings(changed);
    for (const [name, s] of Object.entries(changed)) {
      workers.get(name)?.settings(s);
      const r = redacted(nameOf(name), s);
      log(`settings ${name} ${JSON.stringify(r.settings)} palettes ${JSON.stringify(r.palettes)}`);
    }
  },
  // Notification from the core: states changed; the inline extensions' listeners here, every worker's through its own relay.
  "states/changed": (p: StatesChanged) => {
    const changed = p?.states ?? {};
    updateStates(changed);
    for (const w of workers.values()) w.states(changed);
  },
  // Notification from the core: `[instances.*]` of the extension changed; its instances are reloaded, as a file change would.
  "instances/changed": async (p) => {
    const name = String(p?.extension ?? "");
    if (manifests.has(name)) await load(name);
  },
};

async function handle(line: string) {
  let req: Request | Response;
  try {
    req = JSON.parse(line);
  } catch {
    return log("bad json:", line.slice(0, 80));
  }
  // No method: the core answering one of ours (see protocol.ts).
  if (!("method" in req)) {
    if (!resolveCore(req)) log("stray reply", req.id);
    return;
  }
  try {
    // An instance's key: its worker answers, inside its own context (worker.ts).
    const w = workerFor(req.method, req.params);
    if (w) {
      const result = await w.request(req.method, req.params);
      if (req.id !== undefined) send({ id: req.id, result });
      return;
    }
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
// `known`: every extension found on disk, loaded or not (the core keeps a failed one's cache), plus every instance key running.
notify("host/ready", { extensions: [...exts.keys(), ...workers.keys()], known: [...new Set([...manifests.keys(), ...workers.keys()])], roots: ROOTS });
