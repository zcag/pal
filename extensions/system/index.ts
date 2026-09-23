// System commands over the core's system capability: sleep, lock, log out,
// power, trash, dark mode, volume, brightness, do not disturb, eject, show
// desktop, quit or unhide every app, dismiss notifications. Static rows
// (the core says which this machine can do), indexed so `mute` and
// `sleep` are root results; `live` because the keep-awake row flips its
// title, and a live palette lists again on every show, which also keeps
// the two probes here current: what is in the Trash, and whether the
// appearance is dark or light. The destructive ones ask first unless the
// setting turns that off. The core hides the panel before running, so the
// command lands on the desktop, not on pal.
//
// Keep Awake is the extension's own (awake.ts): the core's `keep-awake`
// toggle is left out of the listing and its row here takes a duration in
// the bar (`45m`, `2h`, `14:30`, `forever`; blank runs `awake_default`),
// ⌘Enter keeps awake until turned off, ⌘U opens a form for a time, an app
// to follow and the display switch. While a run is on the row reads Allow
// Sleep with the time left as a tag. The bar item `awake` (view.ts) shows
// the countdown (∞ without an end) with a coffee glyph, hidden while off;
// its popover has the presets, the display switch and Allow sleep. The
// ticks are the extension's own: a timeout to the next moment the
// countdown's text changes (every minute; every second under one, or
// while the popover is up), each a `bar.update` carrying the popover's
// tree. `pal://system/awake?for=1h` is the link twin.
//
// One more row is the extension's own: Quick Look on the Finder selection
// (`selection.files()`, read once per show), inert with the reason while
// nothing is selected; `pal://system/run?id=quick-look-selection` is its
// twin for a hotkey.
import { readdir } from "node:fs/promises";
import { basename } from "node:path";
import { bar, effects, errorMessage, failed, files, home, hint, now, selection, settings, state, storage, system, toast, truncate, view as liveView, type Accessory, type Action, type Arg, type BarCtx, type BarItem, type Effect, type Extension, type Form, type FormValues, type Item, type LinkParams, type SystemCommand } from "@zcag/pal";
import { TOOL, commandOf, describe, fmtLeft, kill, nextTick, parseTarget, pidOfApp, reconcile, spawn, summary, type Awake, type Target } from "./awake.ts";
import { DISPLAY_GLYPH, GLYPH as COFFEE, MAX_PRESETS, render, type PopoverState } from "./view.ts";

/** `[extensions.system]`, defaults in pal.json. */
type Settings = { confirm_destructive: boolean; awake_default: string; awake_display: boolean };

const EXTENSION = "system", PALETTE = "system", ITEM = "awake";
/** The keep-awake row's id: the core's id for it, so `pal://system/run?id=keep-awake` and old links still land here. */
const AWAKE = "keep-awake";
/** The run's record in storage. */
const KEY = "awake";
const MAC = process.platform === "darwin";
/** Tests point this at a temp folder; `~/.Trash` itself needs Full Disk Access to read (then the row just has no count). */
const TRASH = process.env.PAL_TRASH_DIR || (MAC ? home("~/.Trash") : `${process.env.XDG_DATA_HOME || home("~/.local/share")}/Trash/files`);
const PROBE_MS = 1500;
/** One Material Design glyph per command (the bundled Nerd Font), one weight down the column; the core's text symbol is the fallback for an id not here. */
const GLYPHS: Record<string, string> = {
  "sleep": "\u{f0904}", // md-power_sleep
  "sleep-displays": "\u{f0d90}", // md-monitor_off
  "lock": "\u{f0341}", // md-lock_outline
  "logout": "\u{f0343}", // md-logout
  "restart": "\u{f0709}", // md-restart
  "shutdown": "\u{f0425}", // md-power
  "empty-trash": "\u{f09e7}", // md-delete_outline
  "dark-mode": "\u{f050e}", // md-theme_light_dark
  "volume-up": "\u{f075d}", // md-volume_plus
  "volume-down": "\u{f075e}", // md-volume_minus
  "volume-mute": "\u{f0581}", // md-volume_off
  "brightness-up": "\u{f00e0}", // md-brightness_7
  "brightness-down": "\u{f00de}", // md-brightness_5
  "dnd": "\u{f0a91}", // md-bell_off_outline
  "eject-all": "\u{f0b91}", // md-eject_outline
  "show-desktop": "\u{f0a1d}", // md-view_dashboard_outline
  "quit-all": "\u{f0c5e}", // md-close_box_multiple_outline
  "unhide-all": "\u{f06d0}", // md-eye_outline
  "dismiss-notifications": "\u{f039f}", // md-notification_clear_all
};
/** nf-md-alert, for the row that says the tool is missing. */
const WARN = "\u{f0026}";

const conf = () => settings.get<Settings>(EXTENSION);

async function output(argv: string[]): Promise<string | undefined> {
  const proc = Bun.spawn(argv, { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
  const timer = setTimeout(() => proc.kill(), PROBE_MS);
  const [code, out] = await Promise.all([proc.exited, new Response(proc.stdout).text()]);
  clearTimeout(timer);
  return code === 0 ? out.trim() : undefined;
}

/** Items in the Trash, or undefined when it cannot be read. */
const trashCount = () => readdir(TRASH).then((names) => names.filter((n) => n !== ".DS_Store").length, () => undefined);

/** `dark` or `light`, or undefined when the OS does not say. macOS has the key only while dark; GNOME's colour scheme names it. */
async function appearance(): Promise<"dark" | "light" | undefined> {
  if (MAC) return (await output(["defaults", "read", "-g", "AppleInterfaceStyle"])) === "Dark" ? "dark" : "light";
  const scheme = await output(["gsettings", "get", "org.gnome.desktop.interface", "color-scheme"]);
  return scheme === undefined ? undefined : scheme.includes("prefer-dark") ? "dark" : "light";
}

/** The Quick Look row's id, on the manifest's `run` route too. */
const QUICK_LOOK = "quick-look-selection";
const FINDER = "com.apple.finder";

/**
 * Quick Look on what is selected in Finder (macOS): the names as the
 * subtitle and Enter while something is marked; otherwise an inert row
 * saying why (the palette is live, so a show over Finder makes it live
 * again). `front_app` is the built-in state, a bundle id.
 */
async function quickLookRow(): Promise<Item | undefined> {
  if (!MAC) return;
  const paths = await selection.files().catch(() => [] as string[]);
  const n = paths.length;
  const front = n ? FINDER : await state.get("front_app").catch(() => null);
  return {
    id: QUICK_LOOK,
    name: "Quick Look Finder Selection",
    subtitle: n ? truncate(paths.map((p) => basename(p)).join(", "), 80) : front === FINDER ? "Nothing is selected in Finder" : "Finder is not in front",
    icon: "\u{f0dcb}", // md-file_eye_outline
    keywords: ["ql", "preview", "finder", "selection"],
    accessories: n ? [{ text: n === 1 ? "1 item" : `${n} items` }] : [],
    actions: n ? [{ id: "run", title: "Quick Look" }] : [],
  };
}

/** The Quick Look panel over the selection; a throw names why not (the HUD's line from a link). */
async function quickLook(): Promise<Effect> {
  const paths = await selection.files().catch(() => [] as string[]);
  if (!paths.length) throw new Error("nothing is selected in Finder");
  files.quickLook(paths);
  return { hide: true };
}

/** What the two probed rows show on the right. */
type Probes = { trash?: number; appearance?: "dark" | "light" };

function accessories(c: SystemCommand, p: Probes): Accessory[] {
  if (c.id === "empty-trash" && p.trash !== undefined) return [{ text: p.trash === 0 ? "empty" : `${p.trash} ${p.trash === 1 ? "item" : "items"}` }];
  if (c.id === "dark-mode" && p.appearance) return [{ tag: p.appearance, color: p.appearance === "dark" ? "violet" : "amber" }];
  return [];
}

function item(c: SystemCommand, confirm: boolean, p: Probes): Item {
  const run = c.destructive && confirm ? { id: "run", title: c.title, style: "destructive" as const, confirm: `${c.title} now?` } : { id: "run", title: c.title };
  return { id: c.id, name: c.title, subtitle: c.subtitle, icon: GLYPHS[c.id] ?? c.icon, keywords: c.keywords, accessories: accessories(c, p), actions: [run] };
}

// ---- keep awake: the run ----------------------------------------------------------

// The record in memory once read from storage (`undefined`: not yet);
// storage keeps it across host restarts, the process keeps running
// meanwhile (awake.ts).
let rec: Awake | null | undefined;
/** The first reconciliation of a process is silent: a run that ended while the host was down is old news, not a HUD. */
let watched = false;

async function load(): Promise<Awake | null> {
  if (rec === undefined) rec = (await storage.get<Awake>(KEY, EXTENSION).catch(() => null)) ?? null;
  return rec;
}
async function save(a: Awake | null) {
  rec = a;
  await (a ? storage.set(KEY, a, EXTENSION) : storage.remove(KEY, EXTENSION)).catch(() => {});
}

/**
 * The run, reconciled against its process (awake.ts `reconcile`): one that
 * ended (on time, killed elsewhere, its app quit) is cleared here, the
 * bar told and, when this host was watching it, the HUD.
 */
async function current(): Promise<Awake | null> {
  const a = await load();
  if (!a) { watched = true; return null; }
  const { awake, stale } = reconcile(a, await commandOf(a.pid), now());
  if (stale) kill(a.pid);
  if (!awake) {
    await save(null);
    if (watched) await effects.run({ hud: a.app ? `${a.app} quit, sleep allowed` : "Keep awake ended, sleep allowed" }).catch(() => {});
    follow(null);
    await bar.update(ITEM, barItem(null), EXTENSION).catch(() => {});
  }
  watched = true;
  return awake;
}

/** A new run (the old one, if any, ended first): the tool started, the record kept, the bar following. */
async function start(target: Target, display: boolean, app?: { app: string; pid: number }): Promise<Awake> {
  if (!TOOL) throw new Error("systemd-inhibit is not installed");
  const old = await current();
  if (old) kill(old.pid);
  const a = await spawn(TOOL, { until: target.until, display, app }, now());
  await save(a);
  await push();
  return a;
}

/** The run ended by hand; false when there was none. */
async function stop(): Promise<boolean> {
  const a = await current();
  if (!a) return false;
  kill(a.pid);
  await save(null);
  await push();
  return true;
}

/** The same run with the display flag flipped: a new process for what is left of it (or its app), the record replaced. */
async function flipDisplay(a: Awake): Promise<Awake> {
  const app = a.app ? await pidOfApp(a.app) : undefined;
  if (a.app && !app) throw new Error(`${a.app} is not running any more`);
  return start({ until: a.until, how: a.until === null ? "forever" : "until" }, !a.display, app);
}

// ---- keep awake: the bar item ------------------------------------------------------

// The popover's own state: whether the field is open (closed again when the
// popover leaves), and the display switch for the next run while none is on.
const pop: { open: boolean; field: boolean; display?: boolean } = { open: false, field: false };

/** The item's `presets` setting (`[bar.items."system/awake".settings]`) as its last render or action got it: the countdown's pushes and a palette's start push with no ctx at hand. */
let presets: string[] = ["30m", "1h", "2h", "forever"];
const noteSettings = (ctx: BarCtx) => { const p = ctx.settings?.presets; if (Array.isArray(p)) presets = p.map(String); };
/** The presets the popover offers: the setting's, blanks out, five at most (the tiles' and the digits' index is the same). */
const presetsOf = (): string[] => presets.map((p) => p.trim()).filter(Boolean).slice(0, MAX_PRESETS);

function popoverState(a: Awake | null, t: number): PopoverState {
  const s = conf();
  return { awake: a, now: t, presets: presetsOf(), display: a ? a.display : pop.display ?? s.awake_display, defaultFor: s.awake_default, field: pop.field, tool: !!TOOL };
}

/** The item for a run, or for none: hidden then, with the coffee and the popover as the `empty` shape a `show = "always"` config keeps. The facts ride as states (`system/awake`, `awake_until`, `awake_left`, `awake_display`). */
export function barItem(a: Awake | null, t = now()): BarItem {
  const left = a?.until == null ? null : a.until - t;
  const states = { awake: !!a, awake_until: a?.until ?? null, awake_left: left === null ? null : Math.ceil(left / 60_000), awake_display: a?.display ?? false };
  if (!TOOL) return { hidden: true, states };
  const menu = { view: render(popoverState(a, t)) };
  if (!a) return { hidden: true, empty: { icon: COFFEE, tooltip: "Not kept awake", menu }, states };
  return {
    icon: COFFEE,
    title: left === null ? "∞" : fmtLeft(left),
    tooltip: `Awake ${summary(a, t)}`,
    ...(a.display && { segments: [{ id: "display", icon: DISPLAY_GLYPH, color: "muted" as const, tooltip: "Display kept awake too" }] }),
    menu,
    states,
  };
}

let tick: ReturnType<typeof setTimeout> | undefined;

/** The next push: when the countdown's text next changes (per second while the popover is up), none for a run with no end while the popover is down (the core's minute render reconciles it). */
function follow(a: Awake | null) {
  clearTimeout(tick);
  tick = undefined;
  if (!a) return;
  const ms = nextTick(a, now(), pop.open) ?? (pop.open ? 1000 : undefined);
  if (ms !== undefined) tick = setTimeout(() => { push().catch(() => {}); }, ms);
}

/** Reads and pushes the item, popover tree included (the page replaces the level in place, the field's text kept). */
async function push() {
  const a = await current();
  follow(a);
  await bar.update(ITEM, barItem(a), EXTENSION).catch(() => {});
}

// The shell says when the popover's level is on top and when it left: the field closes with it, the tick follows. Hooked on the first render (the module is also imported by tests outside the host).
let hooked = false;
function hookViews() {
  if (hooked) return;
  hooked = true;
  liveView.onShown((ev) => { if (ev.bar === ITEM) { pop.open = true; push().catch(() => {}); } }, EXTENSION);
  liveView.onHidden((ev) => { if (ev.bar === ITEM) { pop.open = false; pop.field = false; load().then(follow).catch(() => {}); } }, EXTENSION);
}

async function renderBar(ctx: BarCtx): Promise<BarItem> {
  noteSettings(ctx);
  hookViews();
  const a = await current();
  follow(a);
  return barItem(a);
}

/** What the target is from a spelling: the setting's default for a blank (an hour when that is not a spelling either), `undefined` for something that is neither a duration nor a time. */
const targetOf = (input: string, t: number): Target | undefined => (input.trim() ? parseTarget(input, t) : parseTarget(conf().awake_default, t) ?? parseTarget("1h", t));
const NOT_A_TARGET = "45m, 2h, 14:30, 2pm, or forever";

/** A key or a click in the popover: the run changed, the popover state patched, the item re-rendered (`keep`), which carries the new tree. */
async function popoverAction(action: string, ctx: BarCtx): Promise<Effect> {
  noteSettings(ctx);
  const a = await current();
  const s = conf();
  const display = a ? a.display : pop.display ?? s.awake_display;
  const begin = async (input: string): Promise<Effect> => {
    const t = now();
    const target = targetOf(input, t);
    if (!target) return toast("Not a duration or a time", NOT_A_TARGET, "failure");
    try {
      const r = await start(target, display);
      pop.field = false;
      return { keep: true, hud: describe(r, target.how, t) };
    } catch (e) { return failed("keep awake", e); }
  };
  if (action === "start") return begin(ctx.values?.input ?? "");
  if (action === "default") return begin("");
  if (action.startsWith("preset:")) return begin(presetsOf()[Number(action.slice(7))] ?? "");
  if (action === "sleep") return { keep: true, hud: (await stop()) ? "Sleep allowed" : "Not kept awake" };
  if (action === "display") {
    if (!a) { pop.display = !display; return { keep: true }; }
    try { await flipDisplay(a); } catch (e) { return failed("switch the display", e); }
    return { keep: true, hud: a.display ? "Display may sleep now" : "Display kept awake too" };
  }
  if (action === "until") { pop.field = true; return { keep: true }; }
  if (action === "cancel") { pop.field = false; return { keep: true }; }
  if (action === "open") return { push: { extension: EXTENSION, palette: PALETTE } };
  return { keep: true };
}

// ---- keep awake: the row -------------------------------------------------------------

/** The Keep Awake row's fields in the bar: how long (blank: the default), and whether the display stays up too (the setting's answer preselected). */
const awakeArgs = (s: Settings): Arg[] => [
  { id: "for", placeholder: `45m, 2h, 14:30, forever (blank: ${s.awake_default})` },
  { id: "display", placeholder: "Display", kind: "select", options: [{ id: "on", title: "Display too" }, { id: "off", title: "System only" }], default: s.awake_display ? "on" : "off" },
];

/** The ⌘U form: a time or a duration, the display, and an app to follow (the run ends when it quits). */
const untilForm = (s: Settings, v?: FormValues, errors?: Record<string, string>): Form => ({
  id: AWAKE,
  title: "Keep Awake",
  fields: [
    { kind: "text", id: "until", label: "Until, or for", placeholder: "14:30, 2pm, 45m, 2h, forever", default: String(v?.until ?? ""), description: `A clock time (tomorrow's when it has passed), a duration, or forever; blank is ${s.awake_default}.` },
    { kind: "checkbox", id: "display", label: "Display", text: "Keep the display awake too", default: typeof v?.display === "boolean" ? v.display : s.awake_display },
    { kind: "text", id: "app", label: "While app runs", placeholder: "Optional: an app with a window open", default: String(v?.app ?? ""), description: "The run ends when that app quits." },
  ],
  submit: { id: "start", title: "Keep awake" },
  ...(errors && { errors }),
});

/** The row: Keep Awake with its fields while off, Allow Sleep with the time left while on; a hint row when the machine has no tool. */
function awakeRow(a: Awake | null, s: Settings, t: number): Item {
  const keywords = ["caffeinate", "insomnia", "no sleep", "inhibit", "allow sleep", "awake", "amphetamine"];
  if (!TOOL) return hint(AWAKE, "Keep Awake needs systemd-inhibit", "Install systemd (logind) to keep the machine from sleeping from here", { icon: WARN });
  if (!a) {
    const actions: Action[] = [{ id: "awake", title: "Keep awake" }, { id: "forever", title: "Keep awake until turned off" }, { id: "until", title: "Until a time, or while an app runs…", shortcut: "cmd+u" }];
    return { id: AWAKE, name: "Keep Awake", subtitle: `Stop the machine from sleeping for ${s.awake_default}, or as long as you type`, icon: COFFEE, keywords, args: awakeArgs(s), actions };
  }
  const left = a.until === null ? null : a.until - t;
  const actions: Action[] = [
    { id: "sleep", title: "Allow sleep" },
    { id: "awake", title: "Keep awake for…", args: true },
    { id: "display", title: a.display ? "Let the display sleep" : "Keep the display awake too", shortcut: "cmd+d" },
  ];
  return { id: AWAKE, name: "Allow Sleep", subtitle: `Awake ${summary(a, t)}`, icon: COFFEE, keywords, accessories: [{ tag: left === null ? "∞" : fmtLeft(left), color: "amber" }], args: awakeArgs(s), actions };
}

/** A pick on the row: bare is the toggle (a hotkey, `pal run`); the form's submit and the bar's fields land on `awake`/`start` with their values. */
async function awakePick(action: string | undefined, ctx?: { values?: FormValues }): Promise<Effect> {
  const s = conf();
  const t = now();
  const a = await current();
  const v = ctx?.values;
  action ??= a ? "sleep" : "awake";
  if (action === "sleep") return { hud: (await stop()) ? "Sleep allowed" : "Not kept awake" };
  if (action === "until") return { form: untilForm(s) };
  if (action === "display") {
    if (!a) return { hud: "Not kept awake" };
    try { await flipDisplay(a); } catch (e) { return failed("switch the display", e); }
    return { hud: a.display ? "Display may sleep now" : "Display kept awake too" };
  }
  const fromForm = action === "start";
  const input = String(v?.until ?? v?.for ?? "").trim();
  const appName = String(v?.app ?? "").trim();
  const target: Target | undefined = action === "forever" ? { until: null, how: "forever" } : input ? parseTarget(input, t) : appName ? { until: null, how: "forever" } : targetOf("", t);
  if (!target) return fromForm ? { form: untilForm(s, v, { until: `Not a duration or a time: ${NOT_A_TARGET}` }) } : toast("Not a duration or a time", NOT_A_TARGET, "failure");
  const display = v?.display === undefined ? s.awake_display : v.display === true || v.display === "on";
  const app = appName ? await pidOfApp(appName) : undefined;
  if (appName && !app) return fromForm ? { form: untilForm(s, v, { app: `No open window of an app named "${appName}"` }) } : toast("No such app", `Nothing named "${appName}" has a window open`, "failure");
  try { return { hud: describe(await start(target, display, app), target.how, t) }; } catch (e) { return failed("keep awake", e); }
}

/** `pal://system/awake`: bare toggles (on with the default, off while on); `for`/`until` a spelling, `display` the switch, `app` one to follow, `off` ends it. The HUD's line is the run's. */
async function awakeLink(params: LinkParams): Promise<Effect> {
  const t = now();
  const a = await current();
  const spelled = params.for ?? params.until;
  if (params.off === true || (spelled === undefined && params.app === undefined && a)) return { hud: (await stop()) ? "Sleep allowed" : "Not kept awake" };
  const target = spelled === undefined ? (params.app === undefined ? targetOf("", t) : { until: null, how: "forever" as const }) : parseTarget(String(spelled), t);
  if (!target) throw new Error(`not a duration or a time: "${spelled}" (${NOT_A_TARGET})`);
  const app = params.app === undefined ? undefined : await pidOfApp(String(params.app));
  if (params.app !== undefined && !app) throw new Error(`no open window of an app named "${params.app}"`);
  return { hud: describe(await start(target, typeof params.display === "boolean" ? params.display : conf().awake_display, app), target.how, t) };
}

export default {
  // `pal://system/run?id=lock`: the command by id, as Enter on its row; the manifest's `confirm: true` keeps the card on it. `keep-awake` is the toggle.
  link: async (route: string, params: LinkParams): Promise<Effect | void> => {
    if (route === "awake") return awakeLink(params);
    if (route !== "run") return;
    const id = String(params.id);
    if (id === QUICK_LOOK && MAC) return quickLook();
    if (id === AWAKE) return awakeLink({});
    if (!(await system.commands()).some((c) => c.id === id && c.available)) throw new Error(`no system command "${id}" on this machine`);
    await system.run(id);
  },
  palettes: {
    [PALETTE]: {
      title: "System",
      // The keep-awake row flips between Keep Awake and Allow Sleep: relisted on every show.
      live: true,
      placeholder: "Sleep, lock, volume, dark mode...",
      list: async () => {
        const s = conf();
        const all = await system.commands();
        const has = (id: string) => all.some((c) => c.id === id && c.available);
        const probes: Probes = {
          trash: has("empty-trash") ? await trashCount() : undefined,
          appearance: has("dark-mode") ? await appearance() : undefined,
        };
        // The core's keep-awake toggle is superseded by the extension's row, in its place in the list, there even when the core has no tool (the row then says what to install).
        const awake = await current();
        const ql = await quickLookRow();
        return [...all.flatMap((c) => (c.id === AWAKE ? [awakeRow(awake, s, now())] : c.available ? [item(c, s.confirm_destructive, probes)] : [])), ...(ql ? [ql] : [])];
      },
      // The empty root's Now section: the run while one is on.
      suggest: async () => { const a = await current(); return a ? [awakeRow(a, conf(), now())] : []; },
      pick: async (id, action, ctx) => {
        if (id === AWAKE) return awakePick(action, ctx);
        try {
          if (id === QUICK_LOOK) return await quickLook();
          await system.run(id);
        } catch (e) {
          return toast("Command failed", errorMessage(e), "failure");
        }
        return {};
      },
    },
  },
  bar: {
    [ITEM]: { render: renderBar, onAction: popoverAction },
  },
  dispose: () => { clearTimeout(tick); },
} satisfies Extension;
