// DPI Bypass: the owner's `dpi` script (`~/.local/bin/dpi`) as a toggle
// with an indicator. The script is the engine (byedpi as a SOCKS proxy
// with the network service pointed at it on macOS, zapret + dnscrypt-proxy
// under systemd on Linux; it remembers what to restore); this extension
// runs it (`on`, `off`, `toggle`, `status`, `build`) and draws what it
// says. Nothing of byedpi or networksetup is reimplemented here.
//
// The palette leads with Turn on bypass / Turn off bypass (in the root's
// Now section while on), a Repair row when only half of it is in effect
// (status.ts judges `partial`), the status with its facts in the detail
// pane, the test level, the log and the build. The test (test.ts) is the
// script's `dpi test` run here one curl per url so the rows land one by
// one, in the panel's test level and in the popover on `t`. The bar item
// `bypass` is a shield, hidden while off by its rule (`show = "always"`
// keeps a muted one), amber while partial.
//
// `on` and `off` take ~5 s on macOS (Tailscale's DNS bounce and the
// script's sleeps) and the shell gives a pick 10 s, so a switch is waited
// for up to `WAIT_MS` and then finished in the background with the HUD
// telling the outcome. On Linux the script wants sudo: `sudo -n true` is
// probed first and a closed window is a toast, never a hung prompt.
import { existsSync } from "node:fs";
import { basename } from "node:path";
import { bar, effects, errorMessage, exec, failed, hint, home, settings, tilde, toast, truncate, view as liveView, type BarItem, type Detail, type Effect, type Extension, type Item, type LinkParams } from "@zcag/pal";
import { DEFAULT_DNS, factLines, nextWord, parseStatus, summary, type State, type Status } from "./status.ts";
import { hostOf, line, parseTargets, start, summary as testSummary, type Run } from "./test.ts";
import { GLYPH, STATE_COLOR, STATE_WORD, renderPopover, renderTest, type PopoverState } from "./view.ts";

/** `[extensions.dpi]`, defaults in pal.json. */
type Settings = { tool: string; test_urls: string[]; dns: string[] };

const EXTENSION = "dpi", PALETTE = "dpi", TEST = "test", ITEM = "bypass";
const PLATFORM: "macos" | "linux" = (process.env.PAL_DPI_OS ?? process.platform) === "darwin" ? "macos" : "linux";
const MAC = PLATFORM === "macos";
/** The script's `LOG` (macOS only; Linux's units log to the journal); the tests point it elsewhere. */
const LOG = process.env.PAL_DPI_LOG || "~/Library/Logs/dpi.log";
const WHERE = "~/.local/bin/dpi";
/** `status` is two `networksetup` reads (~0.3 s); `on`/`off` bounce Tailscale's DNS and sleep (~5 s, 20 s is generous); a build clones and compiles byedpi. */
const STATUS_MS = 5000, SWITCH_MS = 20_000, BUILD_MS = 300_000, SUDO_MS = 3000;
/** How long a switch is waited for inside a pick before the HUD takes over (the shell's request deadline is 10 s). */
const WAIT_MS = 7000;
const CACHE_MS = 5000;
/** nf-md-check_network (test), file_document_outline (log), hammer (build), content_copy (copy), shield_refresh (repair), dns_outline (status), alert (a failure). */
const TEST_GLYPH = "\u{f0c53}", LOG_GLYPH = "\u{f09ee}", BUILD_GLYPH = "\u{f08ea}", COPY_GLYPH = "\u{f018f}", REPAIR_GLYPH = "\u{f00aa}", STATUS_GLYPH = "\u{f0b8c}", WARN = "\u{f0026}";
const NOT_INSTALLED = "dpi is not installed";
const SUDO_MSG = "Open a sudo window first: run `sudo -v` in a terminal, then try again";
const BUSY: Record<Cmd, string> = { on: "Turning the bypass on…", off: "Turning the bypass off…", toggle: "Switching the bypass…", repair: "Repairing the bypass: off, then on…" };
const KEYWORDS = ["dpi", "bypass", "censorship", "byedpi", "zapret", "proxy", "socks", "block", "btk"];

type Cmd = "on" | "off" | "toggle" | "repair";
type Snap = { status: Status | null; error?: string };

const conf = () => settings.get<Settings>(EXTENSION);
const dnsOverride = () => { const d = conf().dns; return Array.isArray(d) ? d.map((x) => x.trim()).filter(Boolean) : DEFAULT_DNS; };

// ---- the script ---------------------------------------------------------------------

/** The `tool` setting on PATH (the core adopts the login shell's), as a path, or under `~/.local/bin` (where the script lives); `undefined` when nowhere. */
export function toolPath(): string | undefined {
  const t = conf().tool?.trim() || "dpi";
  const found = Bun.which(t);
  if (found) return found;
  for (const p of [home(t), home(`~/.local/bin/${basename(t)}`)]) if (existsSync(p)) return p;
}

/** `dpi <args>`: stdout, or a throw with the script's complaint (`dpi: ` stripped), the exit code, or the timeout. */
async function dpi(args: string[], ms: number): Promise<string> {
  const tool = toolPath();
  if (!tool) throw new Error(NOT_INSTALLED);
  const r = await exec([tool, ...args], { ms });
  if (r.timedOut) throw new Error(`dpi ${args[0]} did not finish in ${Math.round(ms / 1000)} s`);
  if (r.code !== 0) throw new Error(lastLine(r.err).replace(/^dpi: /, "") || lastLine(r.out) || `dpi ${args[0]} exited ${r.code}`);
  return r.out;
}

const lastLine = (s: string) => s.trim().split("\n").filter((l) => l.trim()).at(-1)?.trim() ?? "";

/** The HUD's line for a switch: the script's last line (`dpi on  (Wi-Fi -> socks5://127.0.0.1:1080, dns 1.1.1.1 9.9.9.9)`), its spacing collapsed, cut to fit the capsule. */
export const hudLine = (out: string, fallback: string): string => truncate(lastLine(out).replace(/\s+/g, " ") || fallback, 96);

// The status, read once per CACHE_MS (a show, the bar and the Now section
// ask within the same second); a switch drops it. One read at a time.
let cache: { at: number; status: Status } | undefined;
let inflight: Promise<Status> | undefined;

async function readStatus(fresh = false): Promise<Status> {
  if (!fresh && cache && Date.now() - cache.at < CACHE_MS) return cache.status;
  inflight ??= dpi(["status"], STATUS_MS)
    .then((out) => { const status = parseStatus(out, PLATFORM, dnsOverride()); cache = { at: Date.now(), status }; return status; })
    .finally(() => { inflight = undefined; });
  return inflight;
}

/** The status, or why there is none (no script, a failed read): what every surface draws from. */
async function snapshot(fresh = false): Promise<Snap> {
  if (!toolPath()) return { status: null, error: NOT_INSTALLED };
  try { return { status: await readStatus(fresh) }; } catch (e) { return { status: null, error: errorMessage(e) }; }
}

/** Linux: the script's `sudo systemctl` needs an open credential window (`sudo -v` in a terminal); `-n` never prompts. macOS needs no root. */
async function sudoOk(): Promise<boolean> {
  if (MAC) return true;
  const r = await exec(["sudo", "-n", "true"], { ms: SUDO_MS }).catch(() => undefined);
  return r?.code === 0;
}

/** The switch run to its end: the script's line for the HUD, the cache dropped, the bar pushed. Repair is off, then on. */
async function switchRun(cmd: Cmd): Promise<string> {
  let out = "";
  try {
    if (cmd === "repair") { await dpi(["off"], SWITCH_MS); out = await dpi(["on"], SWITCH_MS); } else out = await dpi([cmd], SWITCH_MS);
  } finally {
    cache = undefined;
    await push().catch(() => {});
  }
  return hudLine(out, `dpi ${cmd}`);
}

/**
 * A switch from a pick, a popover key or a link: the sudo window probed
 * on Linux, the run waited for up to `WAIT_MS` with the script's line as
 * the HUD; past that the HUD says it is under way and the line lands
 * when it does. A failure inside the wait is a toast (a link throws:
 * the message is its HUD line).
 */
async function switchEffect(cmd: Cmd, link = false): Promise<Effect> {
  const refuse = (title: string, message?: string): Effect => { if (link) throw new Error(message ? `${title}: ${message}` : title); return toast(title, message, "failure"); };
  if (!toolPath()) return refuse(NOT_INSTALLED, `the script lives at ${WHERE}; set Tool in Settings if it is elsewhere`);
  if (!(await sudoOk())) return refuse(SUDO_MSG);
  const run = switchRun(cmd);
  const done = await Promise.race([run.then((hud) => ({ hud }), (e: unknown) => ({ error: errorMessage(e) })), Bun.sleep(WAIT_MS).then(() => undefined)]);
  if (done && "error" in done) return link ? refuse(`dpi ${cmd} failed`, done.error) : failed(`turn the bypass ${cmd === "repair" ? "off and on" : cmd}`, new Error(done.error));
  if (done) return { hud: done.hud };
  run.then((hud) => effects.run({ hud }), (e: unknown) => effects.run({ hud: `dpi ${cmd} failed: ${errorMessage(e)}` })).catch(() => {});
  return { hud: BUSY[cmd] };
}

/** `dpi build` (macOS): a clone and a make, minutes; started here, the HUD says when it is done. */
async function build(): Promise<Effect> {
  if (!MAC) return toast("Build is macOS-only", "Linux uses the packaged zapret", "failure");
  if (!toolPath()) return toast(NOT_INSTALLED, `the script lives at ${WHERE}`, "failure");
  dpi(["build"], BUILD_MS).then((out) => effects.run({ hud: hudLine(out, "byedpi built") }), (e: unknown) => effects.run({ hud: `Build failed: ${errorMessage(e)}` })).catch(() => {});
  return { hud: "Building byedpi… the HUD says when it is done" };
}

function openLog(): Effect {
  const p = home(LOG);
  if (!existsSync(p)) return toast("No log yet", `${LOG} is written by the first dpi on`, "failure");
  return { open: p };
}

const copyStatus = (st: Status): Effect => ({ copy: st.raw, hud: "Copied the bypass status" });

// ---- the test --------------------------------------------------------------------

// One run at a time, shared by the test level and the popover (`t`
// there); each push draws whichever is open (`view.open()`, the host's
// table of open levels). The level's cursor and whether the popover asked
// for the rows are the module's; the latter is dropped once the popover
// is closed, so the next open is clean.
let current: Run | undefined;
let cursor = 0;
let barTest = false;
const popoverOpen = () => liveView.open(EXTENSION).some((v) => v.bar === ITEM);
const testOpen = () => liveView.open(EXTENSION).some((v) => v.palette === TEST);

/** Where the requests go: through byedpi while it is up on macOS (`socks5h`, so DNS goes through it too), direct otherwise (zapret is system-wide). */
const proxyOf = (s: Snap) => (MAC && s.status?.facts.platform === "macos" && s.status.facts.proxy.up ? `127.0.0.1:${s.status.port}` : null);

async function launch(): Promise<Run> {
  const s = await snapshot();
  cursor = 0;
  current = start(parseTargets(conf().test_urls ?? []), proxyOf(s), (run) => { if (run === current) pushViews().catch(() => {}); });
  return current;
}

const testState = () => ({ run: current!, cursor: Math.min(cursor, Math.max(0, current!.results.length - 1)) });

/** The open levels redrawn with the run as it stands: the test level, and the popover when its rows were asked for. */
async function pushViews(): Promise<void> {
  if (!current) return;
  if (testOpen()) await liveView.update(renderTest(testState()), { palette: TEST, extension: EXTENSION }).catch(() => {});
  if (barTest && popoverOpen()) await liveView.update(renderPopover(popState(await snapshot(), current)), { bar: ITEM, extension: EXTENSION }).catch(() => {});
}

const report = (run: Run) => [testSummary(run.results).text, ...run.results.map(line)].join("\n");

/** A key in the test level: the cursor, Open and Copy on its row, the whole report, a rerun. */
async function testPick(action: string | undefined): Promise<Effect> {
  if (!current || action === "rerun") return { view: renderTest({ run: await launch(), cursor: 0 }) };
  const rows = current.results;
  if (action?.startsWith("focus:")) cursor = Math.min(rows.length - 1, Math.max(0, Number(action.slice(6)) || 0));
  else if (action === "down") cursor = Math.min(rows.length - 1, cursor + 1);
  else if (action === "up") cursor = Math.max(0, cursor - 1);
  else if (action === "copy-all") return { copy: report(current), hud: "Copied the test report" };
  else {
    const r = rows[cursor];
    if (!r) return { keep: true };
    if (action === "copy") return { copy: line(r), hud: `Copied ${hostOf(r.url)} ${r.code ?? "…"}` };
    return { open: r.url };
  }
  return { view: renderTest(testState()) };
}

// ---- the bar item ------------------------------------------------------------------

const popState = (s: Snap, test?: Run): PopoverState => ({ status: s.status, error: s.error, mac: MAC, ...(test && { test }) });

/** The item: a shield in the state's glyph, the facts as states (`dpi/on`, `dpi/state`, `dpi/service`); its `off` rule hides it, `partial` colours it amber. Hidden outright without a readable status: nothing to open a popover on. `test` is the run the open popover asked for. */
export function barItem(s: Snap, test?: Run): BarItem {
  const st = s.status;
  const service = !st ? null : st.facts.platform === "macos" ? st.facts.service : st.facts.services.map((x) => x.name).join(" + ");
  const states = { on: st ? st.state !== "off" : null, state: st?.state ?? null, service };
  if (!st) return { hidden: true, states };
  const menu = { view: renderPopover(popState(s, test)) };
  const tooltip = `${STATE_WORD[st.state]}: ${summary(st)}`;
  return { icon: GLYPH[st.state], tooltip, menu, empty: { icon: GLYPH.off, tooltip, menu }, states };
}

/** The item as it stands, the popover's rows kept only while it is open (a closed popover forgets its test). */
async function item(): Promise<BarItem> {
  if (!popoverOpen()) barTest = false;
  return barItem(await snapshot(), barTest ? current : undefined);
}

async function push(): Promise<void> {
  await bar.update(ITEM, await item(), EXTENSION);
}

/** A key or a click in the popover. */
async function popoverAction(action: string): Promise<Effect> {
  if (action === "open") return { push: { extension: EXTENSION, palette: PALETTE } };
  if (action === "toggle") return switchEffect("toggle");
  if (action === "repair") return switchEffect("repair");
  if (action === "log") return openLog();
  if (action === "test") { barTest = true; await launch(); return { keep: true }; }
  if (action === "copy") { const s = await snapshot(); return s.status ? copyStatus(s.status) : toast(s.error ?? NOT_INSTALLED, undefined, "failure"); }
  return { keep: true };
}

// ---- the palette --------------------------------------------------------------------

const shieldIcon = (state: State) => (state === "off" ? GLYPH.off : { glyph: GLYPH[state], color: STATE_COLOR[state] === "green" ? "green" as const : "amber" as const });
const stateTag = (st: Status) => (st.state === "off" ? [] : [{ tag: st.state === "on" ? "on" : "partial", color: STATE_COLOR[st.state] }]);

/** The status as the detail pane shows it: the state on top, the facts as lines, the reason when partial. */
function detailOf(st: Status): Detail {
  const md = [`**${STATE_WORD[st.state]}**`, st.reason ? st.reason : summary(st), "", "```", st.raw, "```"].join("\n");
  return { markdown: md, metadata: [{ label: "State", tags: [{ text: st.state, color: STATE_COLOR[st.state] }] }, ...factLines(st).map(([label, value]) => ({ label, value }))] };
}

/** Turn on / Turn off, the row the palette leads with and the root's Now section shows while on. */
function toggleRow(st: Status): Item {
  const word = nextWord(st.state);
  return {
    id: "toggle",
    name: `Turn ${word} bypass`,
    subtitle: summary(st),
    icon: shieldIcon(st.state),
    keywords: [...KEYWORDS, word, "toggle"],
    accessories: stateTag(st),
    actions: [
      { id: word, title: `Turn ${word} bypass` },
      { id: "test", title: "Test the bypass", shortcut: "cmd+t" },
      ...(st.state === "partial" ? [{ id: "repair", title: "Repair: off, then on", shortcut: "cmd+shift+r" }] : []),
      { id: "copy", title: "Copy the status", shortcut: "cmd+c" },
    ],
  };
}

function rows(s: Snap): Item[] {
  if (!s.status) {
    if (s.error === NOT_INSTALLED) return [hint("missing", NOT_INSTALLED, `The bypass script lives at ${WHERE}; set Tool in Settings › Extensions › DPI Bypass when it is elsewhere`, { icon: { glyph: WARN, color: "amber" }, actions: [{ id: "settings", title: "Open settings" }] })];
    return [hint("error", "Could not read the bypass status", s.error, { icon: { glyph: WARN, color: "amber" }, actions: [{ id: "retry", title: "Read again" }] })];
  }
  const st = s.status;
  const targets = parseTargets(conf().test_urls ?? []);
  const blocked = targets.filter((t) => t.role === "blocked"), controls = targets.length - blocked.length;
  const out: Item[] = [toggleRow(st)];
  if (st.state === "partial") out.push({ id: "repair", name: "Repair bypass", subtitle: `Turn it off, then on: ${st.reason}`, icon: { glyph: REPAIR_GLYPH, color: "amber" }, keywords: [...KEYWORDS, "repair", "fix"], accessories: stateTag(st), actions: [{ id: "repair", title: "Repair: off, then on" }, { id: "off", title: "Turn off bypass" }] });
  out.push(
    { id: "status", name: `Status: ${st.state === "partial" ? "partly on" : st.state}`, subtitle: st.reason ?? summary(st), icon: STATUS_GLYPH, keywords: [...KEYWORDS, "status"], accessories: stateTag(st), detail: detailOf(st), actions: [{ id: "copy", title: "Copy the status" }, { id: "test", title: "Test the bypass", shortcut: "cmd+t" }] },
    { id: "test", name: "Test the bypass", subtitle: targets.length ? `curl ${blocked.map((t) => hostOf(t.url)).join(", ") || "nothing"} (blocked) and ${controls} ${controls === 1 ? "control" : "controls"}, ${proxyOf(s) ? `through socks5://${proxyOf(s)}` : "direct"}` : "No urls: fill test_urls in Settings", icon: TEST_GLYPH, keywords: [...KEYWORDS, "test", "curl", "check"], actions: [{ id: "test", title: "Run the test" }] },
  );
  if (MAC) {
    const log = existsSync(home(LOG));
    out.push(
      { id: "log", name: "Open the log", subtitle: log ? `byedpi's output, ${tilde(home(LOG))}` : `No log yet: ${tilde(home(LOG))} is written by the first dpi on`, icon: LOG_GLYPH, keywords: [...KEYWORDS, "log"], actions: log ? [{ id: "open", title: "Open the log" }] : [] },
      { id: "build", name: "Build byedpi", subtitle: "git clone and make into ~/proj/byedpi; a minute or two, the HUD says when it is done", icon: BUILD_GLYPH, keywords: [...KEYWORDS, "build", "compile", "make"], actions: [{ id: "build", title: "Build", confirm: "Build byedpi from source now?" }] },
    );
  }
  out.push({ id: "copy", name: "Copy the status", subtitle: "dpi status, as printed", icon: COPY_GLYPH, keywords: [...KEYWORDS, "copy"], actions: [{ id: "copy", title: "Copy the status" }] });
  return out;
}

async function pick(id: string, action?: string): Promise<Effect> {
  if (id === "hint:missing") return { open: `pal://settings/extensions?anchor=extensions:${EXTENSION}:tool` };
  if (id === "hint:error") { cache = undefined; return { keep: true }; }
  if (action === "test" || id === "test") return { push: { extension: EXTENSION, palette: TEST } };
  if (id === "log") return openLog();
  if (id === "build") return build();
  if (action === "repair" || (id === "repair" && !action)) return switchEffect("repair");
  if (action === "on" || action === "off") return switchEffect(action);
  if (id === "toggle") return switchEffect("toggle");
  if (action === "copy" || id === "copy" || id === "status") { const s = await snapshot(); return s.status ? copyStatus(s.status) : toast(s.error ?? NOT_INSTALLED, undefined, "failure"); }
  return { keep: true };
}

export default {
  // `pal://dpi/toggle`, `on`, `off`: the HUD says what the script said; `test` and `status` open the panel on that level.
  link: async (route: string, _params: LinkParams): Promise<Effect | void> => {
    if (route === "status") return { push: { extension: EXTENSION, palette: PALETTE } };
    if (route === "test") return { push: { extension: EXTENSION, palette: TEST } };
    if (route === "toggle" || route === "on" || route === "off") return switchEffect(route, true);
  },
  palettes: {
    [PALETTE]: {
      title: "DPI Bypass",
      // Turn on / Turn off flips with the status: relisted on every show.
      live: true,
      placeholder: "Turn the bypass on or off, test it",
      list: async () => rows(await snapshot()),
      pick,
      // The empty root's Now section: the Turn off row while the bypass is on (or half on).
      suggest: async () => { const s = await snapshot(); return s.status && s.status.state !== "off" ? [toggleRow(s.status)] : []; },
    },
    [TEST]: {
      title: "Bypass Test",
      // Opening the level runs the test (a run still going is shown as it stands); the rows are pushed as each curl lands.
      view: async () => { if (!current || current.endedAt) await launch(); return renderTest(testState()); },
      pick: async (_id, action) => testPick(action),
    },
  },
  bar: {
    [ITEM]: { render: item, onAction: popoverAction },
  },
} satisfies Extension;
