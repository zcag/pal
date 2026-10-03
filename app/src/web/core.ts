// The core for the web build: the Tauri commands the panel invokes, answered
// in the page over the web host (host.ts), and the `core/*` calls the SDK
// makes. The shape of every answer is the Rust core's (src-tauri/src/index.rs,
// registry.rs, views.rs); what a phone or a browser cannot do (windows, apps,
// the clipboard's history) answers that it is not available here.
import { emit } from "@tauri-apps/api/event";
import fuzzysort from "fuzzysort";
import type { Effect, PaletteMeta } from "../../../sdk/src/protocol.ts";
import { FALLBACK, PALETTES, sourceKey, type Source, type WireHit, type WireItem } from "../items";
import { loaded, request, setSettings, start, type Loaded } from "./host";

type Row = { source: Source; item: WireItem; key: ReturnType<typeof fuzzysort.prepare>; words: string };
/** The listed rows per source key: every palette that is neither input nor view, listed once at start and on `index_refresh`. */
const index = new Map<string, Row[]>();
const metas = new Map<string, { ext: Loaded; meta: PaletteMeta }>();

const row = (source: Source, item: WireItem): Row => ({ source, item, key: fuzzysort.prepare(item.name ?? ""), words: [item.subtitle, ...(Array.isArray(item.keywords) ? item.keywords : [])].filter(Boolean).join(" ") });
const indexed = (m: PaletteMeta) => !m.input && m.view !== "view";

/** The `pal/palettes` rows: one per palette, as registry.rs `palette_row`. */
function paletteRows(): Row[] {
  return [...metas.values()].map(({ ext, meta }) => row({ extension: "pal", palette: "palettes" }, {
    id: `${ext.name}/${meta.name}`,
    name: meta.title,
    subtitle: ext.manifest.title !== meta.title ? ext.manifest.title : undefined,
    keywords: meta.keywords,
    icon: meta.icon,
  } as WireItem));
}

async function list(key: string) {
  const { ext, meta } = metas.get(key)!;
  const source = { extension: ext.name, palette: meta.name };
  try {
    const r = (await request("list", { ...source, query: "" })) as { items: WireItem[] };
    index.set(key, r.items.map((i) => row(source, i)));
  } catch (e) {
    console.error(`[web core] list of ${key} failed:`, e);
  }
}

async function listAll(only?: Source) {
  await Promise.all([...metas].filter(([k, { meta }]) => indexed(meta) && (!only || k === sourceKey(only))).map(([k]) => list(k)));
  index.set(PALETTES, paletteRows());
  emit("pal://index");
}

/** The ranked hits for `q`, as index.rs `query`: a scoped query searches that source, the root every source with the palettes first among equals. */
function query(q: string, limit: number, sources?: Source[]): WireHit[] {
  const keys = sources?.length ? sources.map(sourceKey) : [...index.keys()].filter((k) => k === PALETTES || metas.get(k)?.meta.tier !== "catalog" || q.trim());
  const rows = keys.flatMap((k) => index.get(k) ?? []);
  const hit = (r: Row, score: number, positions: number[]): WireHit => ({ source: r.source, id: r.item.id, score, name_positions: positions, item: r.item });
  if (!q.trim()) return (sources?.length ? rows : index.get(PALETTES) ?? []).slice(0, limit).map((r) => hit(r, 0, []));
  return fuzzysort
    .go(q, rows, { keys: [(r) => r.key, (r) => r.words], limit: limit * 2, threshold: 0.3 })
    .map((res) => {
      const r = res.obj;
      // The palettes lead their band at the root (index.rs `PALETTE_BONUS`), a catalog row trails it.
      const tier = sourceKey(r.source) === PALETTES ? 0.15 : metas.get(sourceKey(r.source))?.meta.tier === "catalog" ? -0.2 : 0;
      return hit(r, res.score + tier, [...(res[0]?.indexes ?? [])]);
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** The clipboard API exists only on a secure page (https, localhost); over plain http the old selection copy still works. */
async function copyText(text: string) {
  if (navigator.clipboard) return navigator.clipboard.writeText(text).catch((err) => console.warn("[web core] copy failed:", err));
  const t = Object.assign(document.createElement("textarea"), { value: text });
  t.style.cssText = "position:fixed;opacity:0";
  const focused = document.activeElement as HTMLElement | null;
  document.body.append(t);
  t.select();
  document.execCommand("copy");
  t.remove();
  focused?.focus();
}

/** What the core does with a pick's envelope before the panel sees it: the clipboard and the opener; the rest (a push, a view, a toast) is the panel's. */
async function runEffect(e: Effect | null | undefined) {
  if (!e) return;
  const text = typeof e.copy === "string" ? e.copy : e.copy?.text ?? (e.paste && "text" in e.paste ? e.paste.text : undefined);
  if (text !== undefined) await copyText(text);
  for (const url of e.open === undefined ? [] : Array.isArray(e.open) ? e.open : [e.open]) {
    if (/^(https?|mailto|tel|sms):/i.test(url)) window.open(url, "_blank", "noopener");
    else console.warn(`[web core] cannot open ${url} on the web`);
  }
}

// Storage, one JSON object per extension in localStorage.
const STORE = (ext: string) => `pal-web:storage:${ext}`;
const storeOf = (ext: string): Record<string, unknown> => { try { return JSON.parse(localStorage.getItem(STORE(ext)) ?? "{}"); } catch { return {}; } };
const storeSet = (ext: string, key: string, value: unknown) => {
  const s = storeOf(ext);
  if (value === null || value === undefined) delete s[key]; else s[key] = value;
  try { localStorage.setItem(STORE(ext), JSON.stringify(s)); } catch { /* private window: this visit only */ }
  return null;
};

/** The `core/*` calls an extension makes through the SDK. */
const coreMethods: Record<string, (p: any) => unknown> = {
  "storage.get": (p) => storeOf(p.extension)[p.key] ?? null,
  "storage.set": (p) => storeSet(p.extension, p.key, p.value),
  "storage.remove": (p) => storeSet(p.extension, p.key, null),
  "storage.keys": (p) => Object.keys(storeOf(p.extension)).sort(),
  "settings.set": (p) => setSettings(p),
  "list.partial": (p) => emit("pal://partial", { n: p.stream, items: p.items }),
  "view.update": (p) => emit("pal://view", p),
  "view.post": (p) => emit("pal://view", { extension: p.extension, palette: p.palette, bar: p.bar, id: p.id, post: p.msg }),
  "effects.run": (p) => runEffect(p.effect).then(() => null),
  "states.get": () => null,
  "states.list": () => [],
  "states.declare": () => null,
  "states.undeclare": () => null,
  "states.set": () => null,
  "bar.update": () => null,
  "bar.refresh": () => null,
};
const coreCall = (method: string, params: unknown) => {
  const f = coreMethods[method];
  if (!f) throw new Error(`${method} is not available on the web`);
  return f(params ?? {});
};

/** The level on top, as views.rs tracks it: the host hears `view/shown` and `view/hidden`. */
let open: { extension: string; palette?: string; bar?: string; id: string } | null = null;
function viewOpen(next: typeof open) {
  if (JSON.stringify(next) === JSON.stringify(open)) return;
  if (open) request("view/hidden", open);
  open = next;
  if (open) request("view/shown", open);
}

const ready = start(coreCall).then(async (exts) => {
  for (const ext of exts) for (const meta of ext.metas) metas.set(`${ext.name}/${meta.name}`, { ext, meta });
  await listAll();
});

/** The Tauri commands the panel invokes (lib.rs `generate_handler!`); anything not here answers null. */
const commands: Record<string, (a: any) => unknown> = {
  sources: () => [
    { extension: "pal", palette: "palettes", name: "palettes", title: "Palettes", live: false, input: false, count: index.get(PALETTES)?.length ?? 0, stale: false },
    ...[...metas].map(([k, { ext, meta }]) => ({ extension: ext.name, palette: meta.name, ...meta, count: index.get(k)?.length ?? 0, stale: false })),
  ],
  query: (a) => query(String(a.q ?? ""), a.limit ?? 50, a.sources),
  detail: (a) => (a.source.extension === "pal" ? {} : request("detail", { ...a.source, id: a.id, args: a.args })),
  pick: async (a) => {
    const { source, ...req } = a.req;
    // A palette row is opened by the panel; the core only answers that it stays (index.rs `pick`).
    if (sourceKey(source) === PALETTES) return { keep: true };
    if (sourceKey(source) === FALLBACK) return {};
    const r = (await request("pick", { ...source, ...req })) as Effect;
    await runEffect(r);
    return r;
  },
  host_request: (a) => request(a.method, a.params),
  index_refresh: (a) => listAll(a.source ?? undefined),
  fallback: () => [],
  filter: () => null,
  view_open: (a) => viewOpen(a.open),
  // The panel hides after a pick in the app and is shown fresh on the next hotkey; a page is always shown, so it comes back to the root.
  hide: () => { setTimeout(() => emit("pal://shown", { t0: Date.now() }), 0); },
  settings_general: () => ({}),
  search_history: () => [],
  dialog_detect: () => null,
  glance_items: () => [],
  frecency_forget: () => false,
  panel_mode: (a) => a.mode ?? "normal",
  mark: () => null,
};

/** The `mockIPC` handler: every command waits for the extensions to load first. */
export async function handle(cmd: string, args: unknown): Promise<unknown> {
  if (cmd === "mark") return null;
  await ready;
  const f = commands[cmd];
  if (!f) { console.debug(`[web core] ${cmd}: not on the web`); return null; }
  return f(args ?? {});
}

export { loaded };
