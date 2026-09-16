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
// does not exist is skipped.
import { watch } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { call, resolve as resolveCore } from "./bridge.ts";
import { context, setRoots, update as updateSettings } from "./settings.ts";
import type { Extension, Manifest, Notification, PaletteMeta, Request, ResolvedSettings, Response, SettingsChanged } from "./protocol.ts";

const VERSION = "0.0.1";
const ROOTS = process.argv.slice(2).map((r) => resolve(r));
if (ROOTS.length === 0) ROOTS.push(resolve(import.meta.dir, "../../extensions"));
setRoots(ROOTS);

type Found = { root: string; entry: string };
const exts = new Map<string, Extension>();
const found = new Map<string, Found>();
const errors = new Map<string, string>();
/** Read before the code, kept across a failed load: what the settings window shows either way. */
const manifests = new Map<string, Manifest>();

const log = (...a: unknown[]) => console.error("[host]", ...a);
const send = (msg: Response | Notification) => process.stdout.write(JSON.stringify(msg) + "\n");
const notify = (method: string, params?: unknown) => send({ method, params });

const exists = (p: string) => stat(p).then(() => true, () => false);

/** `<root>/<name>/index.{ts,js}`, or undefined when `name` is no extension there. */
async function entry(root: string, name: string): Promise<Found | undefined> {
  for (const file of ["index.ts", "index.js"]) {
    const entry = `${root}/${name}/${file}`;
    if (await exists(entry)) return { root, entry };
  }
}

/** Every extension across the roots; a later root replaces an earlier one's entry. */
async function discover(): Promise<Map<string, Found>> {
  const map = new Map<string, Found>();
  for (const root of ROOTS) {
    if (!(await exists(root))) continue;
    const names = (await readdir(root, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
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

async function load(name: string) {
  const f = found.get(name) ?? (await discover()).get(name);
  if (!f) return; // not an extension dir
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
    const mod = await context.run({ extension: name }, () => import(`${f.entry}?t=${Date.now()}`));
    const ext = mod.default as Extension;
    if (!ext?.palettes) throw new Error("default export has no palettes");
    exts.set(name, ext);
    errors.delete(name);
    log(`loaded ${name} (${Object.keys(ext.palettes).join(",")}) from ${f.root} in ${(performance.now() - t0).toFixed(1)}ms`);
    notify("extension/loaded", { extension: name, root: f.root, palettes: metas(ext), manifest });
  } catch (e) {
    const message = describe(e);
    exts.delete(name);
    errors.set(name, message);
    log(`failed ${name}: ${message}`);
    notify("extension/error", { extension: name, root: f.root, message, manifest });
  }
}

// Bun raises BuildMessage (one) or AggregateError of them (many) for a file
// that fails to compile; neither prints its position by itself.
function describe(e: unknown): string {
  const errs = e instanceof AggregateError ? e.errors : [e];
  return errs
    .map((x: any) => (x?.position ? `${x.position.file}:${x.position.line}: ${x.message}` : x?.message ?? String(x)))
    .join("; ");
}

async function loadAll() {
  for (const [name, f] of await discover()) found.set(name, f);
  await Promise.all([...found.keys()].map(load));
}

async function watchExtensions() {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  for (const root of ROOTS) {
    if (!(await exists(root))) continue;
    watch(root, { recursive: true }, (_event, file) => {
      const name = String(file ?? "").split("/")[0];
      if (!name) return;
      clearTimeout(timers.get(name));
      // A new directory, or one whose entry moved roots: look again.
      timers.set(name, setTimeout(() => (found.delete(name), load(name)), 50));
    });
  }
}

const metas = (ext: Extension): PaletteMeta[] =>
  Object.entries(ext.palettes).map(([name, p]) => ({
    name, title: p.title ?? name, live: !!p.live, input: !!p.input, icon: p.icon, view: p.view, columns: p.columns, placeholder: p.placeholder, detail: p.detail, filters: p.filters,
  }));

function palette(p: any) {
  const ext = exts.get(p?.extension);
  if (!ext) throw new Error(errors.get(p?.extension) ?? `no extension ${p?.extension}`);
  const pal = ext.palettes[p?.palette];
  if (!pal) throw new Error(`no palette ${p?.extension}/${p?.palette}`);
  return pal;
}

/** Runs `f` knowing which palette it serves, so `settings.get()` in there needs no argument. */
const inContext = <T>(p: any, f: () => T): T => context.run({ extension: String(p?.extension), palette: String(p?.palette) }, f);

const methods: Record<string, (params: any) => unknown> = {
  hello: () => ({
    version: VERSION,
    bun: Bun.version,
    pid: process.pid,
    roots: ROOTS,
    extensions: [...manifests].map(([name, manifest]) => ({ name, root: found.get(name)?.root, manifest, loaded: exts.has(name), palettes: exts.has(name) ? metas(exts.get(name)!) : [] })),
    errors: Object.fromEntries(errors),
  }),
  list: async (p) => ({ items: await inContext(p, () => palette(p).list(p.query, p.filter)) }),
  pick: async (p) => (await inContext(p, () => palette(p).pick(p.id, p.action))) ?? {},
  // Notification from the core: the resolved values of the named extensions.
  "settings/changed": (p: SettingsChanged) => {
    updateSettings(p.extensions);
    for (const [name, s] of Object.entries(p.extensions)) log(`settings ${name} ${JSON.stringify(s.settings)} palettes ${JSON.stringify(s.palettes)}`);
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
})();
await loadAll();
await watchExtensions();
notify("host/ready", { extensions: [...exts.keys()], roots: ROOTS });
