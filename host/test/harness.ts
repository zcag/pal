// Test harness for the extension host: spawns `bun run src/host.ts <roots>`,
// speaks the stdio protocol (protocol.ts) from the core's side, answers the
// host's `core/*` requests from a table, and records what went by. One
// `Host` per test file where the tests do not interfere; `Root` builds a
// throwaway extension root under the OS temp dir. README.md has the rules a test
// keeps (writeTool for fakes, no waiting on the real clock, the time budget).
import { setDefaultTimeout } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { BarCtx, BarItem, BarMeta, ClipboardEntry, ControlName, Ctx, Detail, Effect, Group, Item, Manifest, Notification, PaletteMeta, Request, ResolvedSettings, Response, SettingSpec, SystemCommand, ViewNode, ViewUpdate, Window } from "../../sdk/src/index.ts";

// A test's own budget grows with its waits (`until` triples them on the CI runner): at bun's 5 s a test was killed while its 7.5 s wait
// still ran, and that wait's error landed on whichever test came next.
setDefaultTimeout(process.env.CI ? 15_000 : 5_000);

export const HOST = resolve(import.meta.dir, "../src/host.ts");
/** The requests that ask every loaded extension at once (the root's sections). */
const ROOT_SECTIONS = new Set(["suggest", "inline", "fallback", "fallback/late"]);
/** The bundled extensions, for the integration tests. */
export const BUNDLED = resolve(import.meta.dir, "../../extensions");
/** A bundled extension's `icon` as its pal.json has it: a logo tile's path is the manifest's to keep (app/scripts/brand-icons.ts), not a test's to copy. */
export const bundledIcon = (name: string) => JSON.parse(readFileSync(join(BUNDLED, name, "pal.json"), "utf8")).icon;
/** Absolute import specifiers for fixture extensions written outside the repo (the SDK by path; `@zcag/pal` by name works too, through the link the host makes). */
export const API = resolve(import.meta.dir, "../../sdk/src/index.ts");
export const PROTOCOL = resolve(import.meta.dir, "../../sdk/src/protocol.ts");

export type Kind = "request" | "notification" | "response";
/** protocol.ts: a `method` makes a request (with id) or a notification (without); no method is a response. */
/**
 * The one executable every stand-in tool runs (`writeTool`), made once per machine and content. macOS checks a new executable file on its
 * first run (0.15-0.3 s each, measured 2026-09-24), and the tests wrote hundreds of fresh ones: the network file alone spent 20 of its
 * 33 s on it. A link to this stub is not a new executable, so only the stub's own first run pays. It runs the script beside the link
 * (`<tool>.tool`) under the script's own shebang; a shell script is sourced so its `$0` is still the tool's path (a fake that re-runs itself).
 */
const STUB = `#!/bin/sh
IFS= read -r l < "$0.tool"
case "$l" in
  '#!'*sh) exec \${l#??} -c '. "$0.tool"' "$0" "$@" ;;
  '#!'*) exec \${l#??} "$0.tool" "$@" ;;
  *) exec /bin/sh -c '. "$0.tool"' "$0" "$@" ;;
esac
`;
const stubPath = join(tmpdir(), `pal-test-tool-${Bun.hash(STUB).toString(36)}`);
if (!existsSync(stubPath)) {
  const tmp = `${stubPath}.${process.pid}`;
  writeFileSync(tmp, STUB, { mode: 0o755 });
  renameSync(tmp, stubPath);
}

/** A stand-in executable at `path` that runs `body` (a script, `#!` line optional: sh without one); written again, it runs the new body. Returns `path`. */
export function writeTool(path: string, body: string): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.tool`, body);
  rmSync(path, { force: true });
  symlinkSync(stubPath, path);
  return path;
}

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
  /** `[groups]` as the config would hold it (docs/design/controls.md); `host.setGroups` changes it and tells the host, as a reload does. */
  groups?: Record<string, Group>;
  /** The extensions to load; the rest of the roots' are turned off (`core/store.disabled`). A bundled host otherwise runs all of them, and their background work (sessions reading this machine's Claude sessions, downloads thumbnailing) slows the root sections. A `core["store.disabled"]` of the test's own wins over it. */
  only?: string[];
};

/** `extension/loaded`: `warnings` is where the manifest and the code disagree about a palette (`checkPalettes`), empty when they agree. */
export type Loaded = { extension: string; root: string; palettes: PaletteMeta[]; bar: BarMeta[]; manifest: Manifest; warnings: string[] };
export type Failed = { extension: string; root: string; message: string; manifest: Manifest };
export type Hello = {
  protocol: number; protocolMin: number; bun: string; pid: number; roots: string[];
  extensions: { name: string; extension: string; root?: string; manifest: Manifest; loaded: boolean; disabled: boolean; palettes: PaletteMeta[]; warnings: string[]; bar: BarMeta[] }[];
  errors: Record<string, string>;
};

/**
 * A row's name and subtitle and a toast are plain text: a `code span` in
 * them shows its backticks. An extension names a setting by its label ("Set
 * Data API key"), never its id. Only an id-shaped span is caught, so a
 * user's own text (a clipboard entry) still passes.
 */
function plainText<T extends Item[]>(items: T, toast?: unknown): T {
  const t = toast as { title?: string; message?: string } | undefined;
  for (const s of [...items.flatMap((i) => [i.name, i.subtitle]), t?.title, t?.message]) {
    if (typeof s === "string" && /`[a-z][a-z0-9_]*`/.test(s)) throw new Error(`plain text with a code span, which shows its backticks: ${JSON.stringify(s)} (name a setting by its label)`);
  }
  return items;
}

/**
 * The lines a fake tool has logged so far: none while the file is missing
 * or still empty (a shell's `>>` creates it before the command writes, so a
 * wait on `.length > 0` would otherwise pass on one empty line).
 */
/** A view tree's markable rows (`NodeBase.mark`), in order: what the shell lets the user mark for a `multi` action. */
export const marksOf = (n: ViewNode): string[] => [...(typeof n.mark === "string" ? [n.mark] : []), ...(n.type === "stack" ? n.children.flatMap(marksOf) : [])];

export const logLines = (file: string): string[] => {
  try {
    return readFileSync(file, "utf8").trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
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
  /** The last `core/<method>` request, as `coreCalls` records it: other extensions' background calls (a bundled host runs them all) land in between. */
  lastCall(method: string) {
    return this.coreCalls.findLast((c) => c.method === method);
  }
  /** Lines on stdout that were not JSON: a corrupted protocol. */
  readonly garbage: string[] = [];
  readonly manifests = new Map<string, Manifest>();
  /** What extensions wrote through `settings.set`, as the file would hold it (`keychain:` for a secret), keyed `<extension>` / `<extension>/<palette>`, then id; an unset id is absent. */
  readonly written = new Map<string, Record<string, unknown>>();
  /** The secrets `settings.set` put in the "keychain", by key. */
  readonly secrets = new Map<string, string>();
  stderr = "";
  readonly exited: Promise<number>;
  private proc: Bun.Subprocess<"pipe", "pipe", "pipe">;
  private pending = new Map<number, { resolve: (r: Response) => void; timer: ReturnType<typeof setTimeout> }>();
  private waiters: { pred: (n: Notification) => boolean; resolve: (n: Notification) => void }[] = [];
  private seq = 0;
  /** Hosts started from now on run on the real clock: the store-screenshot fixtures (app/scripts/fixture-kit.ts), which want the same picture every run, not speed. */
  static realClock = false;
  /** How far this host's clock was moved (`advance`). */
  advanced = 0;
  /**
   * The same in whole seconds, for a stand-in tool stamping a time on the host's clock: the host and every tool it runs see the path as
   * `$PAL_TEST_AHEAD_FILE`, so a shell fake says `$(( $(date +%s) + $(cat "$PAL_TEST_AHEAD_FILE") ))`.
   */
  readonly aheadFile = join(mkdtempSync(join(tmpdir(), "pal-clock-")), "ahead");

  private constructor(readonly opts: Options) {
    writeFileSync(this.aheadFile, "0");
    // TZ and PAL_NOW by hand: bun 1.3 kept a `process.env.TZ` assigned at runtime out of the spread (seen on 1.3.14; calc.test.ts sets it), and the tests pin both at runtime (PAL_NOW is the extensions' clock, calendar/clock.ts).
    // TZ always: `bun test` runs in UTC with TZ unset, and a host left on the machine's zone saw another date than the test between local
    // midnight and the offset (wordle's "Daily #" one apart at 00:10 +03).
    const pinned = { ...Object.fromEntries(["TZ", "PAL_NOW"].filter((k) => process.env[k]).map((k) => [k, process.env[k]])), TZ: process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone };
    this.proc = Bun.spawn(["bun", "run", "--no-install", HOST, ...opts.roots], { stdin: "pipe", stdout: "pipe", stderr: "pipe", env: { ...process.env, ...pinned, NO_COLOR: "1", PAL_TEST_CLOCK: Host.realClock ? "" : "1", PAL_TEST_AHEAD_FILE: this.aheadFile } });
    this.exited = this.proc.exited;
    this.read();
    this.drainStderr();
  }

  /** Spawns without waiting for `host/ready`: a test of what holds it back. */
  static spawn(opts: Options): Host {
    return new Host(opts);
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
    this.send(JSON.stringify(msg) + "\n");
  }

  /** Raw line on stdin, for malformed input. */
  writeRaw(line: string) {
    this.send(line);
  }

  /**
   * A host that has already gone answers a write with EPIPE, and thrown
   * from `answer` (a request read off stdout, replied to after the process
   * exited: a palette's own timer pushing while the file's host is torn
   * down) it is an unhandled error that fails the whole run and names no
   * test. There is nothing to deliver it to, so it is dropped: a test that
   * was waiting on the reply still fails, with its own "unanswered after
   * N ms".
   */
  private send(text: string) {
    try {
      this.proc.stdin.write(text);
      this.proc.stdin.flush();
    } catch (e) {
      if ((e as { code?: string }).code !== "EPIPE") throw e;
    }
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
    // Every bundled extension's root section is real machine state (sessions reads this Mac's Claude sessions, files asks Spotlight)
    // and some wait on timers the fake clock holds: a test asks only the extensions it is about.
    if (ROOT_SECTIONS.has(method) && this.opts.roots.includes(BUNDLED) && !this.opts.only) throw new Error(`${method} on a bundled host asks every extension: start it with only: [the extensions under test] (README.md, Time)`);
    const r = await this.call(method, params, timeout);
    if (r.error !== undefined) throw new HostError(method, r.error);
    return r.result as T;
  }

  notify(method: string, params?: unknown) { this.write({ method, params }); }

  hello() { return this.request<Hello>("hello"); }
  /** Moves the host's clock (and every worker's) `ms` forward: the timers due on the way fire, `Date` reads that much later (src/clock.ts). Resolves once they ran; what they started (a fetch, a tool) is waited for with `until`. */
  advance(ms: number) {
    this.advanced += ms;
    writeFileSync(this.aheadFile, String(Math.floor(this.advanced / 1000)));
    return this.request<true>("clock/advance", { ms });
  }
  /** The host's time: the wall clock plus how far the test moved it. A fixture stamped on it reads as the extension's now. */
  now() { return Date.now() + this.advanced; }
  /** `p`'s answer once the clock moved `ms`: a request held by a debounce, a wait or a timeout the test knows the length of. */
  async after<T>(p: Promise<T>, ms: number): Promise<T> {
    await this.advance(ms);
    return p;
  }
  /** How long until each of the host's fake timers fires, in ms (the host's and every worker's). */
  timers() { return this.request<number[]>("clock/timers"); }
  /** Whether a timer of `ms` is armed and not yet run down: one set for `ms` a moment ago reads a few real ms less, never more. */
  async armed(ms: number) { return (await this.timers()).some((t) => t <= ms && t > ms - 50); }
  /**
   * Until `pred` holds: each time a timer of `step` is armed, the clock moves `step`. For a timer the extension arms only after real I/O
   * (a reply, a tool's exit, a file read), which a plain advance could land before: the clock moves only once it is there, so never
   * further than the extension asked for. Throws after `rounds` advances, or when neither comes within the wait.
   */
  async advanceUntil(step: number, pred: () => boolean, what = "condition", { rounds = 20 } = {}): Promise<void> {
    for (let i = 0; i < rounds; i++) {
      await this.until(async () => pred() || (await this.armed(step)), 3000, `${what}, or a ${step} ms timer`);
      if (pred()) return;
      await this.advance(step);
    }
    await this.until(pred, 3000, what);
  }
  /** `p`'s answer, the clock moved `step` each time a timer of `step` is armed (`advanceUntil`): a request whose answer waits on timers armed after real I/O. */
  async through<T>(p: Promise<T>, step: number, opts?: { rounds?: number }): Promise<T> {
    let done = false;
    p.then(() => (done = true), () => (done = true));
    await this.advanceUntil(step, () => done, "the answer", opts);
    return p;
  }
  list(extension: string, palette: string, query?: string, ctx?: Ctx) {
    return this.request<{ items: Item[] }>("list", { extension, palette, query, ...ctx }).then((r) => plainText(r.items));
  }
  /** A streamed `list`, as the panel asks an input palette: the answer, and the rows each `ctx.partial` showed before it, in order. */
  async listStream(extension: string, palette: string, query?: string, ctx?: Ctx) {
    const stream = { window: "test", n: ++this.streams };
    const from = this.coreCalls.length;
    const items = await this.request<{ items: Item[] }>("list", { extension, palette, query, ...ctx, stream }).then((r) => r.items);
    const partials = this.coreCalls.slice(from).filter((c) => c.method === "list.partial" && JSON.stringify((c.params as any)?.stream) === JSON.stringify(stream)).map((c) => (c.params as any).items as Item[]);
    return { items, partials };
  }
  private streams = 0;
  pick(extension: string, palette: string, id: string, action?: string, ctx?: Ctx, timeout?: number) {
    return this.request<Effect & Record<string, unknown>>("pick", { extension, palette, id, action, ...ctx }, timeout).then((e) => { plainText([], e.toast); return e; });
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
  /** A game surface's `pal.send(msg)` as the app relays it (the `surface` request): what the palette's `onMessage` returned, undefined for nothing; a throw there is a `HostError`. */
  surfaceSend(extension: string, palette: string, msg: unknown, args?: unknown) {
    return this.request<{ reply?: unknown }>("surface", { extension, palette, call: "send", data: { msg }, ...(args !== undefined && { args }) }).then((r) => r.reply);
  }
  /** The `core/view.post` messages the host sent to one palette's surface page, in order (`{ pal, data }`, a storage change `{ pal, key, value }`). */
  surfacePosts(extension: string, palette: string): ({ pal: string; data?: unknown } & Record<string, unknown>)[] {
    return this.coreCalls.filter((c) => c.method === "view.post" && (c.params as any)?.extension === extension && (c.params as any)?.palette === palette).map((c) => (c.params as any).msg);
  }
  /** The `bar/shown` notification. */
  barShown(extension: string, id: string) { this.notify("bar/shown", { extension, id }); }
  /** The `view/shown` / `view/hidden` notifications (views.rs): a view palette's level, or a bar item's own (`{ bar }`). */
  viewShown(extension: string, target: { palette?: string; bar?: string }, id = "view", compact = false) { this.notify("view/shown", { extension, ...target, id, ...(compact && { compact: true }) }); }
  viewHidden(extension: string, target: { palette?: string; bar?: string }, id = "view", compact = false) { this.notify("view/hidden", { extension, ...target, id, ...(compact && { compact: true }) }); }
  /** The `view.update` pushes the host made for one target, in order (their params). */
  viewUpdates(extension: string, target: { palette?: string; bar?: string }): ViewUpdate[] {
    return this.coreCalls.filter((c) => c.method === "view.update" && (c.params as any)?.extension === extension && (c.params as any)?.palette === target.palette && (c.params as any)?.bar === target.bar).map((c) => c.params as ViewUpdate);
  }
  /** Polls until a `view.update` for the target satisfying `pred` has arrived; resolves with it. */
  async nextViewUpdate(extension: string, target: { palette?: string; bar?: string }, pred: (u: ViewUpdate) => boolean = () => true, timeout = 3000): Promise<ViewUpdate> {
    const from = this.viewUpdates(extension, target).length;
    let hit: ViewUpdate | undefined;
    await this.until(() => { hit = this.viewUpdates(extension, target).slice(from).find(pred); return !!hit; }, timeout, `view.update ${extension}/${target.palette ?? target.bar}`);
    return hit!;
  }
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
  /** The file changed under the extension: `overlay` is what it sets now, on top of what the extension itself wrote through `settings.set`. */
  changeSettings(extension: string, overlay: Overlay[string]) {
    const manifest = this.manifests.get(extension);
    if (!manifest) throw new Error(`no manifest seen for ${extension}`);
    this.notify("settings/changed", { extensions: { [extension]: this.resolvedOf(extension, manifest, overlay) } });
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

  /** Polls until `pred` holds (it may be async: a list asked again each round). A wait sized for this Mac gets three times as long on the CI runner (`CI` set): its 1 Hz ticks and detached processes have missed 2.5 s budgets there that never miss here. */
  async until(pred: () => boolean | Promise<boolean>, timeout = 3000, what = "condition"): Promise<void> {
    const t0 = Date.now();
    timeout *= process.env.CI ? 3 : 1;
    while (!(await pred())) {
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
    rmSync(dirname(this.aheadFile), { recursive: true, force: true });
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
    if (method.startsWith("controls.") && !this.opts.core?.[method]) fn = (p) => this.controlsCall(method.slice(9), p);
    if (method === "store.disabled" && this.opts.only && !this.opts.core?.[method]) {
      const only = new Set(this.opts.only);
      fn = () => this.opts.roots.flatMap((r) => readdirSync(r, { withFileTypes: true }).filter((d) => d.isDirectory() && !only.has(d.name)).map((d) => d.name));
    }
    if (method === "settings.get") {
      const { extension, manifest } = req.params as { extension: string; manifest: Manifest };
      this.manifests.set(extension, manifest);
      fn ??= () => this.resolvedOf(extension, manifest);
    }
    let changed: { extension: string; resolved: ResolvedSettings } | undefined;
    if (method === "settings.set") {
      fn ??= (p) => {
        const r = this.setSettings(p as { extension: string; palette?: string; values: Record<string, unknown> });
        changed = { extension: (p as { extension: string }).extension, resolved: r };
        return r;
      };
    }
    try {
      const result = fn ? await fn(req.params) : null;
      this.write({ id: req.id, result: result === undefined ? null : result });
    } catch (e) {
      this.write({ id: req.id, error: e instanceof Error ? e.message : String(e) });
    }
    // The core's config watcher would push the reload after the write; here at once.
    if (changed) this.notify("settings/changed", { extensions: { [changed.extension]: changed.resolved } });
  }

  // ---- controls: what the core does (app controls.rs over pal_core::controls), in memory ----

  /** What extensions published, `<key>\0<control>` to state. */
  readonly published = new Map<string, Record<string, unknown>>();

  /** The group `key` is in: the first by id, as the core reads it. */
  private groupOf(key: string): Group | undefined {
    return Object.entries(this.opts.groups ?? {}).sort(([a], [b]) => (a < b ? -1 : 1)).find(([, g]) => g.members?.includes(key))?.[1];
  }

  private binding(g: Group | undefined, control: string): string | undefined {
    const b = control === "volume" ? g?.volume : control === "inputs" ? g?.inputs : undefined;
    return b && g?.members?.includes(b) ? b : undefined;
  }

  /** The bar items on a strip now, `<key>/<id>` (the core reads its bar table): a served player naming one of these as its `item` gets `item_shown`. */
  readonly itemsShown = new Set<string>();

  private served(key: string, control: string) {
    const s = this.published.get(`${key}\0${control}`);
    return s ? { ...s, provider: { key, device: s.device }, ...(typeof s.item === "string" && { item_shown: this.itemsShown.has(`${key}/${s.item}`) }) } : null;
  }

  private affected(key: string): string[] {
    return [...new Set([key, ...(this.groupOf(key)?.members ?? [])])].sort();
  }

  /** `[groups]` changed (a config reload): the members of every group that did hear it, as `controls::regrouped`. */
  setGroups(groups: Record<string, Group>) {
    const prev = this.opts.groups ?? {};
    const keys = new Set<string>();
    for (const id of new Set([...Object.keys(prev), ...Object.keys(groups)])) {
      if (JSON.stringify(prev[id]) !== JSON.stringify(groups[id])) for (const g of [prev[id], groups[id]]) for (const m of g?.members ?? []) keys.add(m);
    }
    this.opts.groups = groups;
    if (keys.size) this.notify("controls/changed", { changes: (["volume", "power", "inputs"] as ControlName[]).map((control) => ({ control, provider: "", keys: [...keys].sort() })) });
  }

  private async controlsCall(fn: string, p: { extension: string; control: string; state?: Record<string, unknown> | null; op?: string; args?: unknown[]; provider?: string }): Promise<unknown> {
    const { extension: key, control } = p;
    if (!["volume", "power", "inputs", "player"].includes(control)) throw new Error(`no control ${control}`);
    const g = this.groupOf(key);
    switch (fn) {
      case "publish": {
        const at = `${key}\0${control}`;
        const before = JSON.stringify(this.published.get(at) ?? null);
        if (p.state) this.published.set(at, p.state);
        else this.published.delete(at);
        if (JSON.stringify(p.state ?? null) !== before) this.notify("controls/changed", { changes: [{ control, provider: key, keys: this.affected(key) }] });
        return null;
      }
      case "get": {
        if (control === "power" && g) {
          const members = (g.members ?? []).flatMap((m) => { const s = this.published.get(`${m}\0power`); return s ? [{ ...s, key: m } as Record<string, unknown> & { key: string }] : []; });
          const first = members.find((m) => m.key === key) ?? members[0];
          if (!first) return null;
          const known = members.some((m) => typeof m.on === "boolean");
          return { ...(known && { on: members.some((m) => m.on === true) }), ...(members.some((m) => m.busy === true) && { busy: true }), provider: { key: first.key, device: first.device }, members };
        }
        return this.served(this.binding(g, control) ?? key, control);
      }
      case "all":
        return [...this.published.keys()].filter((k) => k.endsWith(`\0${control}`)).map((k) => this.served(k.split("\0")[0], control));
      case "run": {
        if (p.provider !== undefined && !this.published.has(`${p.provider}\0${control}`)) throw new Error(`${p.provider} publishes no ${control}`);
        const powered = control === "power" && g ? (g.members ?? []).filter((m) => this.published.has(`${m}\0power`)) : [];
        const targets = p.provider !== undefined ? [p.provider] : powered.length ? powered : [this.binding(g, control) ?? key];
        const errors: string[] = [];
        await Promise.all(targets.map((t) => this.request("controls/run", { extension: t, control, op: p.op, args: p.args ?? [] }).catch((e) => { errors.push(e instanceof Error ? e.message : String(e)); })));
        if (errors.length) throw new Error(errors.join("; "));
        return null;
      }
    }
    throw new Error(`unknown controls.${fn}`);
  }

  /** The manifest's defaults, the overlay the test gave (or `given`), and what `settings.set` wrote since (secrets resolved to their values). */
  private resolvedOf(extension: string, manifest: Manifest, given = this.opts.settings?.[extension]): ResolvedSettings {
    const resolveSecrets = (t: Record<string, unknown> | undefined) => Object.fromEntries(Object.entries(t ?? {}).map(([k, v]) => [k, typeof v === "string" && v.startsWith("keychain:") && this.secrets.has(v.slice(9)) ? this.secrets.get(v.slice(9)) : v]));
    const palettes = Object.fromEntries(Object.keys(manifest.palettes ?? {}).map((k) => [k, { ...given?.palettes?.[k], ...resolveSecrets(this.written.get(`${extension}/${k}`)) }]));
    return resolveSettings(manifest, { settings: { ...given?.settings, ...resolveSecrets(this.written.get(extension)) }, palettes });
  }

  /**
   * What the core does for `core/settings.set` (app settings.rs
   * `plan_write` + `write_settings`), in memory: every id must be
   * declared (else nothing is written), a secret goes to `secrets` and the
   * file gets the reference, `null` and the declared default unset the
   * key; the extension's resolved values are the answer.
   */
  private setSettings({ extension, palette, values }: { extension: string; palette?: string; values: Record<string, unknown> }): ResolvedSettings {
    const manifest = this.manifests.get(extension);
    if (!manifest) throw new Error(`settings.set: no extension ${extension}`);
    if (!values || typeof values !== "object" || !Object.keys(values).length) throw new Error("settings.set: no values");
    const specs = palette !== undefined ? manifest.palettes?.[palette]?.settings : manifest.settings;
    if (palette !== undefined && !manifest.palettes?.[palette]) throw new Error(`settings.set: ${extension} declares no palette ${palette}`);
    const planned = Object.entries(values).map(([id, value]) => {
      const spec = (specs ?? []).find((s) => s.id === id);
      if (!spec) throw new Error(`settings.set: ${extension}${palette !== undefined ? `/${palette}` : ""} declares no setting ${id}`);
      return { id, value, spec };
    });
    const key = palette !== undefined ? `${extension}/${palette}` : extension;
    const table = this.written.get(key) ?? {};
    this.written.set(key, table);
    for (const { id, value, spec } of planned) {
      const secret = spec.kind === "secret" && typeof value === "string" && value !== "" && !/^(keychain|env):/.test(value);
      if (value === null || (!secret && JSON.stringify(value) === JSON.stringify(spec.default))) delete table[id];
      else if (secret) {
        const k = palette !== undefined ? `pal/${extension === palette ? extension : `${extension}-${palette}`}-settings-${id}` : `pal/${extension}-${id}`;
        this.secrets.set(k, value as string);
        table[id] = `keychain:${k}`;
      } else table[id] = value;
    }
    return this.resolvedOf(extension, manifest);
  }
}

/** The storage capability, in memory: `<extension>\0<key>` to value. */
export const stored = new Map<string, unknown>();

/** Built-in answers for the OS capabilities; `settings.get` resolves the manifest, anything else is null. */
const CORE: CoreTable = {
  // A streamed list's early rows (app host.rs `partial`): recorded in `coreCalls`, nothing to answer.
  "list.partial": () => null,
  "storage.get": ({ extension, key }: { extension: string; key: string }) => stored.get(`${extension}\0${key}`) ?? null,
  "storage.set": ({ extension, key, value }: { extension: string; key: string; value: unknown }) => { stored.set(`${extension}\0${key}`, value); return null; },
  "storage.remove": ({ extension, key }: { extension: string; key: string }) => { stored.delete(`${extension}\0${key}`); return null; },
  // The Text expansion feature's snippets (app expansion.rs), in the feature's storage.
  "snippets.list": () => stored.get("expansion\0snippets") ?? [],
  "snippets.set": ({ snippets }: { snippets: unknown[] }) => { stored.set("expansion\0snippets", snippets); return null; },
  "storage.keys": ({ extension }: { extension: string }) => [...stored.keys()].filter((k) => k.startsWith(`${extension}\0`)).map((k) => k.split("\0")[1]).sort(),
  "clipboard.list": ({ query = "", limit = 200 }: { query?: string; limit?: number } = {}) =>
    fixtures.clipboard.filter((e) => !query || `${e.text ?? e.files?.join(" ") ?? ""} ${e.name ?? ""}`.toLowerCase().includes(query.toLowerCase())).slice(0, limit),
  "clipboard.get": ({ id }: { id: number }) => {
    const e = fixtures.clipboard.find((e) => e.id === id);
    if (!e) throw new Error(`no entry ${id}`);
    return e;
  },
  "clipboard.rename": ({ id, name }: { id: number; name: string | null }) => {
    const e = fixtures.clipboard.find((e) => e.id === id);
    if (!e) throw new Error(`no entry ${id}`);
    e.name = name?.trim() || null;
    return null;
  },
  "windows.list": () => fixtures.windows,
  "system.commands": () => fixtures.commands,
};

/** Canned OS state for the capability-backed extensions. */
export const fixtures = {
  clipboard: [
    { id: 1, kind: "text", text: "hello world", image: null, files: null, source_app: "com.google.Chrome", at: 1758000000000, bytes: 11, pinned: false, width: null, height: null, name: null },
    { id: 2, kind: "text", text: "line one\nline two\nline three", image: null, files: null, source_app: "net.kovidgoyal.kitty", at: 1758000001000, bytes: 28, pinned: true, width: null, height: null, name: "Deploy notes" },
    { id: 3, kind: "image", text: null, image: "/tmp/clip-3.png", files: null, source_app: null, at: 1758000002000, bytes: 12345, pinned: false, width: 640, height: 480, name: null },
    { id: 4, kind: "files", text: null, image: null, files: ["/Users/x/a.txt", "/Users/x/b.txt"], source_app: "com.apple.finder", at: 1758000003000, bytes: 40, pinned: false, width: null, height: null, name: null },
    { id: 5, kind: "text", text: "https://example.com/page", image: null, files: null, source_app: "com.apple.Safari", at: 1758000004000, bytes: 24, pinned: false, width: null, height: null, name: null },
  ] as ClipboardEntry[],
  windows: [
    { id: "w1", app: "kitty", title: "~/proj/pal", bundle_or_class: "net.kovidgoyal.kitty", pid: 11, minimized: false, hidden: false, on_screen: true, monitor: null, workspace: null, icon: "/Applications/kitty.app" },
    { id: "w2", app: "Google Chrome", title: "GitHub", bundle_or_class: "com.google.Chrome", pid: 22, minimized: true, hidden: false, on_screen: false, monitor: "Display 2", workspace: null, icon: null },
    { id: "w3", app: "Finder", title: "Downloads", bundle_or_class: "com.apple.finder", pid: 33, minimized: false, hidden: false, on_screen: false, monitor: null, workspace: "3", icon: null },
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
