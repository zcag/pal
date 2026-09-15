// The extension host: loads every extension under ../extensions into this one
// process, serves list/pick over stdio, re-imports an extension when its files
// change, and relays extensions' capability calls to the core (bridge.ts).
// Logs go to stderr; stdout is the protocol.
import { watch } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { resolve as resolveCore } from "./bridge.ts";
import type { Extension, Notification, PaletteMeta, Request, Response } from "./protocol.ts";

const VERSION = "0.0.1";
const EXT_DIR = resolve(import.meta.dir, "../../extensions");

const exts = new Map<string, Extension>();
const errors = new Map<string, string>();

const log = (...a: unknown[]) => console.error("[host]", ...a);
const send = (msg: Response | Notification) => process.stdout.write(JSON.stringify(msg) + "\n");
const notify = (method: string, params?: unknown) => send({ method, params });

async function load(name: string) {
  const entry = `${EXT_DIR}/${name}/index.ts`;
  try {
    await stat(entry);
  } catch {
    return; // not an extension dir
  }
  const t0 = performance.now();
  try {
    // The query string defeats Bun's module cache on re-import; the old
    // module instance stays resident, which is the price of no restart.
    const mod = await import(`${entry}?t=${Date.now()}`);
    const ext = mod.default as Extension;
    if (!ext?.palettes) throw new Error("default export has no palettes");
    exts.set(name, ext);
    errors.delete(name);
    log(`loaded ${name} (${Object.keys(ext.palettes).join(",")}) in ${(performance.now() - t0).toFixed(1)}ms`);
    notify("extension/loaded", { extension: name, palettes: metas(ext) });
  } catch (e) {
    const message = describe(e);
    exts.delete(name);
    errors.set(name, message);
    log(`failed ${name}: ${message}`);
    notify("extension/error", { extension: name, message });
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
  const names = (await readdir(EXT_DIR, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  await Promise.all(names.map(load));
}

function watchExtensions() {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  watch(EXT_DIR, { recursive: true }, (_event, file) => {
    const name = String(file ?? "").split("/")[0];
    if (!name) return;
    clearTimeout(timers.get(name));
    timers.set(name, setTimeout(() => load(name), 50));
  });
}

const metas = (ext: Extension): PaletteMeta[] =>
  Object.entries(ext.palettes).map(([name, p]) => ({
    name, title: p.title ?? name, live: !!p.live, input: !!p.input, icon: p.icon, view: p.view, columns: p.columns, placeholder: p.placeholder, detail: p.detail,
  }));

function palette(p: any) {
  const ext = exts.get(p?.extension);
  if (!ext) throw new Error(errors.get(p?.extension) ?? `no extension ${p?.extension}`);
  const pal = ext.palettes[p?.palette];
  if (!pal) throw new Error(`no palette ${p?.extension}/${p?.palette}`);
  return pal;
}

const methods: Record<string, (params: any) => unknown> = {
  hello: () => ({
    version: VERSION,
    bun: Bun.version,
    pid: process.pid,
    extensions: [...exts].map(([name, e]) => ({ name, palettes: metas(e) })),
    errors: Object.fromEntries(errors),
  }),
  list: async (p) => ({ items: await palette(p).list(p.query) }),
  pick: async (p) => (await palette(p).pick(p.id, p.action)) ?? {},
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
    send({ id: req.id, result: await fn(req.params) });
  } catch (e) {
    send({ id: req.id, error: e instanceof Error ? e.message : String(e) });
  }
}

await loadAll();
watchExtensions();
notify("host/ready", { extensions: [...exts.keys()] });
for await (const line of console) if (line) handle(line);
// stdin EOF means the core is gone; the watcher would otherwise keep us alive.
log("stdin closed, exiting");
process.exit(0);
