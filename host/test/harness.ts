// Test harness for the extension host: spawns `bun run src/host.ts <roots>`,
// speaks the stdio protocol (protocol.ts) from the core's side, answers the
// host's `core/*` requests from a table, and records what went by. One
// `Host` per test file where the tests do not interfere; `Root` builds a
// throwaway extension root under the OS temp dir.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { BarCtx, BarItem, BarMeta, ClipboardEntry, Ctx, Detail, Effect, Item, Manifest, Notification, PaletteMeta, Request, ResolvedSettings, Response, SettingSpec, SystemCommand, Window } from "../../sdk/src/index.ts";

export const HOST = resolve(import.meta.dir, "../src/host.ts");
/** The bundled extensions, for the integration tests. */
export const BUNDLED = resolve(import.meta.dir, "../../extensions");
/** Absolute import specifiers for fixture extensions written outside the repo (the SDK by path; `@zcag/pal` by name works too, through the link the host makes). */
export const API = resolve(import.meta.dir, "../../sdk/src/index.ts");
export const PROTOCOL = resolve(import.meta.dir, "../../sdk/src/protocol.ts");

export type Kind = "request" | "notification" | "response";
/** protocol.ts: a `method` makes a request (with id) or a notification (without); no method is a response. */
export const kind = (m: any): Kind => (m.method === undefined ? "response" : m.id === undefined ? "notification" : "request");

export type CoreHandler = (params: any) => unknown;
/** Handlers by capability (`clipboard.list`), without the `core/` prefix. */
export type CoreTable = Record<string, CoreHandler>;
/** Per extension, what the file would set on top of the manifest defaults. */
export type Overlay = Record<string, { settings?: Record<string, unknown>; palettes?: Record<string, Record<string, unknown>> }>;

export type Options = {
  roots: string[];
  core?: CoreTable;
  settings?: Overlay;
  /** Per request, ms. */
  timeout?: number;
};

export type Loaded = { extension: string; root: string; palettes: PaletteMeta[]; bar: BarMeta[]; manifest: Manifest };
export type Failed = { extension: string; root: string; message: string; manifest: Manifest };
export type Hello = {
  version: string; bun: string; pid: number; roots: string[];
  extensions: { name: string; root?: string; manifest: Manifest; loaded: boolean; palettes: PaletteMeta[]; bar: BarMeta[] }[];
  errors: Record<string, string>;
};

export class HostError extends Error {
  constructor(public method: string, message: string) { super(message); }
}

const specDefaults = (specs: SettingSpec[] = []) => Object.fromEntries(specs.filter((s) => s.default !== undefined).map((s) => [s.id, s.default]));

/** What the core would send: manifest defaults with the overlay's keys on top. */
export function resolveSettings(manifest: Manifest, overlay?: Overlay[string]): ResolvedSettings {
  const palettes = Object.fromEntries(Object.entries(manifest.palettes ?? {}).map(([k, p]) => [k, { ...specDefaults(p.settings), ...overlay?.palettes?.[k] }]));
  for (const [k, v] of Object.entries(overlay?.palettes ?? {})) palettes[k] = { ...palettes[k], ...v };
  return { settings: { ...specDefaults(manifest.settings), ...overlay?.settings }, palettes };
}

export class Host {
  readonly notifications: Notification[] = [];
  /** Every `core/*` request the host made, in order, method without the prefix. */
  readonly coreCalls: { method: string; params: unknown }[] = [];
  /** Lines on stdout that were not JSON: a corrupted protocol. */
  readonly garbage: string[] = [];
  readonly manifests = new Map<string, Manifest>();
  stderr = "";
  readonly exited: Promise<number>;
  private proc: Bun.Subprocess<"pipe", "pipe", "pipe">;
  private pending = new Map<number, { resolve: (r: Response) => void; timer: ReturnType<typeof setTimeout> }>();
  private waiters: { pred: (n: Notification) => boolean; resolve: (n: Notification) => void }[] = [];
  private seq = 0;

  private constructor(readonly opts: Options) {
    this.proc = Bun.spawn(["bun", "run", "--no-install", HOST, ...opts.roots], { stdin: "pipe", stdout: "pipe", stderr: "pipe", env: { ...process.env, NO_COLOR: "1" } });
    this.exited = this.proc.exited;
    this.read();
    this.drainStderr();
  }

  /** Spawns and resolves once the host says `host/ready`. */
  static async start(opts: Options): Promise<Host> {
    const h = new Host(opts);
    await Promise.race([h.next("host/ready"), h.exited.then((c) => { throw new Error(`host exited ${c} before ready\n${h.stderr}`); })]);
    return h;
  }

  /** The bundled root; `scripts` reads no v1 config unless the overlay says which. */
  static bundled(opts: Partial<Options> = {}): Promise<Host> {
    const settings: Overlay = { scripts: { settings: { config: join(tmpdir(), "pal-test-no-such-config.toml") } }, ...opts.settings };
    return Host.start({ roots: [BUNDLED], ...opts, settings });
  }

  get pid() { return this.proc.pid; }

  private write(msg: Request | Response | Notification) {
    this.proc.stdin.write(JSON.stringify(msg) + "\n");
    this.proc.stdin.flush();
  }

  /** Raw line on stdin, for malformed input. */
  writeRaw(line: string) {
    this.proc.stdin.write(line);
    this.proc.stdin.flush();
  }

  /** One request; resolves with the reply envelope (`{ id, result }` or `{ id, error }`). */
  call(method: string, params?: unknown, timeout = this.opts.timeout ?? 5000): Promise<Response> {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} #${id} unanswered after ${timeout} ms`)); }, timeout);
      this.pending.set(id, { resolve, timer });
      this.write({ id, method, params });
    });
  }

  /** One request; the result, or a `HostError` for an error reply. */
  async request<T = unknown>(method: string, params?: unknown, timeout?: number): Promise<T> {
    const r = await this.call(method, params, timeout);
    if (r.error !== undefined) throw new HostError(method, r.error);
    return r.result as T;
  }

  notify(method: string, params?: unknown) { this.write({ method, params }); }

  hello() { return this.request<Hello>("hello"); }
  list(extension: string, palette: string, query?: string, ctx?: Ctx) {
    return this.request<{ items: Item[] }>("list", { extension, palette, query, ...ctx }).then((r) => r.items);
  }
  pick(extension: string, palette: string, id: string, action?: string, ctx?: Ctx) {
    return this.request<Effect & Record<string, unknown>>("pick", { extension, palette, id, action, ...ctx });
  }
  detail(extension: string, palette: string, id: string, ctx?: Ctx) {
    return this.request<Detail>("detail", { extension, palette, id, ...ctx });
  }
  /** `bar/render` of one item, as the core asks it. */
  render(extension: string, id: string, ctx: BarCtx = { reason: "load" }) {
    return this.request<BarItem>("bar/render", { extension, id, ctx });
  }
  barAction(extension: string, id: string, action: string, ctx: BarCtx = { reason: "open" }) {
    return this.request<Effect & Record<string, unknown>>("bar/action", { extension, id, action, ctx });
  }
  barOpen(extension: string, id: string, ctx: BarCtx = { reason: "open" }) {
    return this.request<Effect & Record<string, unknown>>("bar/open", { extension, id, ctx });
  }
  /** The `bar/shown` notification. */
  barShown(extension: string, id: string) { this.notify("bar/shown", { extension, id }); }
  /** The `bar.update` pushes the host made for one item, in order (the items themselves). */
  updates(extension: string, id: string): BarItem[] {
    return this.coreCalls.filter((c) => c.method === "bar.update" && (c.params as any)?.extension === extension && (c.params as any)?.id === id).map((c) => (c.params as any).item as BarItem);
  }
  /** Polls until a `bar.update` of the item satisfying `pred` has arrived; resolves with it. */
  async nextUpdate(extension: string, id: string, pred: (item: BarItem) => boolean = () => true, timeout = 3000): Promise<BarItem> {
    const from = this.updates(extension, id).length;
    let hit: BarItem | undefined;
    await this.until(() => { hit = this.updates(extension, id).slice(from).find(pred); return !!hit; }, timeout, `bar.update ${extension}/${id}`);
    return hit!;
  }

  /** `settings/changed` for one extension: manifest defaults with `overlay` on top. */
  changeSettings(extension: string, overlay: Overlay[string]) {
    const manifest = this.manifests.get(extension);
    if (!manifest) throw new Error(`no manifest seen for ${extension}`);
    this.notify("settings/changed", { extensions: { [extension]: resolveSettings(manifest, overlay) } });
  }

  /** The next matching notification to arrive after this call. */
  next(method: string, pred: (params: any) => boolean = () => true, timeout = 5000): Promise<Notification> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.waiters = this.waiters.filter((w) => w.resolve !== done); reject(new Error(`no ${method} within ${timeout} ms`)); }, timeout);
      const done = (n: Notification) => { clearTimeout(timer); resolve(n); };
      this.waiters.push({ pred: (n) => n.method === method && pred(n.params), resolve: done });
    });
  }

  /** The notifications of one method seen so far. */
  seen<T = any>(method: string): T[] { return this.notifications.filter((n) => n.method === method).map((n) => n.params as T); }
  loaded(): Loaded[] { return this.seen<Loaded>("extension/loaded"); }
  failed(): Failed[] { return this.seen<Failed>("extension/error"); }

  /** Polls until `pred` holds. */
  async until(pred: () => boolean, timeout = 3000, what = "condition"): Promise<void> {
    const t0 = Date.now();
    while (!pred()) {
      if (Date.now() - t0 > timeout) throw new Error(`${what} not met within ${timeout} ms`);
      await Bun.sleep(10);
    }
  }
  untilStderr(text: string, timeout?: number) { return this.until(() => this.stderr.includes(text), timeout, `stderr "${text}"`); }

  /** Closes stdin (the core going away) and returns the exit code. */
  async close(): Promise<number> {
    this.proc.stdin.end();
    return this.exited;
  }

  kill() {
    for (const p of this.pending.values()) clearTimeout(p.timer);
    this.proc.kill();
  }

  private async read() {
    let buf = "";
    for await (const chunk of this.proc.stdout) {
      buf += new TextDecoder().decode(chunk);
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (line) this.line(line);
      }
    }
  }

  private async drainStderr() {
    for await (const chunk of this.proc.stderr) this.stderr += new TextDecoder().decode(chunk);
  }

  private line(line: string) {
    let msg: any;
    try { msg = JSON.parse(line); } catch { this.garbage.push(line); return; }
    switch (kind(msg)) {
      case "response": {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        clearTimeout(p.timer);
        p.resolve(msg);
        return;
      }
      case "notification":
        this.notifications.push(msg);
        this.waiters = this.waiters.filter((w) => !(w.pred(msg) && (w.resolve(msg), true)));
        return;
      case "request":
        this.answer(msg);
    }
  }

  private async answer(req: Request) {
    const method = req.method.replace(/^core\//, "");
    this.coreCalls.push({ method, params: req.params });
    let fn = this.opts.core?.[method] ?? CORE[method];
    if (method === "settings.get") {
      const { extension, manifest } = req.params as { extension: string; manifest: Manifest };
      this.manifests.set(extension, manifest);
      fn ??= () => resolveSettings(manifest, this.opts.settings?.[extension]);
    }
    try {
      const result = fn ? await fn(req.params) : null;
      this.write({ id: req.id, result: result === undefined ? null : result });
    } catch (e) {
      this.write({ id: req.id, error: e instanceof Error ? e.message : String(e) });
    }
  }
}

/** The storage capability, in memory: `<extension>\0<key>` to value. */
export const stored = new Map<string, unknown>();

/** Built-in answers for the OS capabilities; `settings.get` resolves the manifest, anything else is null. */
const CORE: CoreTable = {
  "storage.get": ({ extension, key }: { extension: string; key: string }) => stored.get(`${extension}\0${key}`) ?? null,
  "storage.set": ({ extension, key, value }: { extension: string; key: string; value: unknown }) => { stored.set(`${extension}\0${key}`, value); return null; },
  "storage.remove": ({ extension, key }: { extension: string; key: string }) => { stored.delete(`${extension}\0${key}`); return null; },
  "storage.keys": ({ extension }: { extension: string }) => [...stored.keys()].filter((k) => k.startsWith(`${extension}\0`)).map((k) => k.split("\0")[1]).sort(),
  "clipboard.list": ({ query = "", limit = 200 }: { query?: string; limit?: number } = {}) =>
    fixtures.clipboard.filter((e) => !query || (e.text ?? e.files?.join(" ") ?? "").toLowerCase().includes(query.toLowerCase())).slice(0, limit),
  "clipboard.get": ({ id }: { id: number }) => {
    const e = fixtures.clipboard.find((e) => e.id === id);
    if (!e) throw new Error(`no entry ${id}`);
    return e;
  },
  "windows.list": () => fixtures.windows,
  "system.commands": () => fixtures.commands,
};

/** Canned OS state for the capability-backed extensions. */
export const fixtures = {
  clipboard: [
    { id: 1, kind: "text", text: "hello world", image: null, files: null, source_app: "com.google.Chrome", at: 1758000000000, bytes: 11, pinned: false, width: null, height: null },
    { id: 2, kind: "text", text: "line one\nline two\nline three", image: null, files: null, source_app: "net.kovidgoyal.kitty", at: 1758000001000, bytes: 28, pinned: true, width: null, height: null },
    { id: 3, kind: "image", text: null, image: "/tmp/clip-3.png", files: null, source_app: null, at: 1758000002000, bytes: 12345, pinned: false, width: 640, height: 480 },
    { id: 4, kind: "files", text: null, image: null, files: ["/Users/x/a.txt", "/Users/x/b.txt"], source_app: "com.apple.finder", at: 1758000003000, bytes: 40, pinned: false, width: null, height: null },
    { id: 5, kind: "text", text: "https://example.com/page", image: null, files: null, source_app: "com.apple.Safari", at: 1758000004000, bytes: 24, pinned: false, width: null, height: null },
  ] as ClipboardEntry[],
  windows: [
    { id: "w1", app: "kitty", title: "~/proj/pal", bundle_or_class: "net.kovidgoyal.kitty", pid: 11, minimized: false, on_screen: true, monitor: null, workspace: null, icon: "/Applications/kitty.app" },
    { id: "w2", app: "Google Chrome", title: "GitHub", bundle_or_class: "com.google.Chrome", pid: 22, minimized: true, on_screen: false, monitor: "Display 2", workspace: null, icon: null },
    { id: "w3", app: "Finder", title: "Downloads", bundle_or_class: "com.apple.finder", pid: 33, minimized: false, on_screen: false, monitor: null, workspace: "3", icon: null },
  ] as Window[],
  commands: [
    { id: "sleep", title: "Sleep", subtitle: "Put the machine to sleep", icon: "⏾", keywords: ["suspend"], destructive: false, available: true },
    { id: "shutdown", title: "Shut Down", subtitle: "Power the machine off", icon: "⏻", keywords: ["halt", "power"], destructive: true, available: true },
    { id: "trash", title: "Empty Trash", subtitle: "Delete what is in the Trash", icon: "🗑", keywords: ["bin"], destructive: true, available: true },
    { id: "dnd", title: "Toggle Do Not Disturb", subtitle: "Focus", icon: "⊘", keywords: ["focus"], destructive: false, available: false },
  ] as SystemCommand[],
};

/** A throwaway extension root: `write(name, file, text)` puts `<root>/<name>/<file>`. */
export class Root {
  readonly dir: string;
  constructor(exts: Record<string, Record<string, string>> = {}) {
    this.dir = mkdtempSync(join(tmpdir(), "pal-ext-"));
    for (const [name, files] of Object.entries(exts)) for (const [file, text] of Object.entries(files)) this.write(name, file, text);
  }
  path(name: string, file = "index.ts") { return join(this.dir, name, file); }
  write(name: string, file: string, text: string) {
    const p = this.path(name, file);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text);
    return p;
  }
  rm() { rmSync(this.dir, { recursive: true, force: true }); }
}

/** A minimal extension source: one palette named `palette` with the given list/pick bodies. */
export const simpleExt = (palette: string, body: { list?: string; pick?: string; detail?: string; extra?: string; top?: string } = {}) => `
import { settings, core } from "${API}";
${body.top ?? ""}
export default { palettes: { ${palette}: {
  title: "${palette}",
  ${body.extra ?? ""}
  list: ${body.list ?? `() => [{ id: "a", name: "A" }]`},
  pick: ${body.pick ?? `(id) => ({ copy: id })`},
  ${body.detail ? `detail: ${body.detail},` : ""}
} } };
`;

/** A pal.json for a fixture extension. */
export const manifest = (name: string, extra: Partial<Manifest> = {}) => JSON.stringify({ name, title: name, ...extra });
