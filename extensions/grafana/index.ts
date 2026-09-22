// Grafana: dashboards as rows (starred first, the folder and the tags as
// chips, the first time series panels drawn in the pane), the alerts
// firing and pending with silences, a PromQL prompt against Prometheus,
// and a bar item counting what is firing. Everything is the HTTP API in
// api.ts with the settings' URL, token and timeout; a request that fails
// is one hint row with the fix, never an error. One worker per instance,
// so the caches below are one Grafana's.
import { ago, bar, errorMessage, hint, instance, mdEscape, now, oneLine, settings, state, tinted, toast, truncate, when, type Accessory, type Action, type BarCtx, type BarItem, type Ctx, type Detail, type Effect, type Extension, type Form, type Item, type LinkParams, type Metadata, type TagColor } from "@zcag/pal";
import { Client, DURATIONS, GrafanaError, QueryError, alertsUrl, dashboardUrl, dsUid, exploreUrl, flatPanels, fmt, fnv, instances, labelsLine, matchersLine, ownLabels, ruleUrl, savedQueries, seriesOf, silenceMatchers, silenceUrl, spanMs, standalone, timeParam, unconfigured, withUnit, type AlertInstance, type Dashboard, type DashboardJson, type Datasource, type Panel, type Series, type Settings, type Silence } from "./api.ts";
import { sparkline } from "./spark.ts";
import { SEVERITY, render as renderBar, type BarState } from "./view.ts";

const EXTENSION = "grafana";
/** nf-dev-grafana for the bar and the tile; Material Design glyphs for the rest. */
const GLYPH = { grafana: "", dash: "\u{f056e}", star: "\u{f04ce}", folder: "\u{f024b}", bell: "\u{f009a}", alarm: "\u{f0d59}", muted: "\u{f009b}", query: "\u{f0169}", check: "\u{f05e0}", problem: "\u{f0026}", saved: "\u{f04ce}" } as const;
/** `ctx.args` of the dashboards palette's folder drill-in. */
type Args = { folder?: string };
const DASH_TTL = 60_000, ALERTS_TTL = 20_000, PANE_TTL = 60_000, QUERY_TTL = 15_000, DS_TTL = 10 * 60_000;
/** Rows a query lists before saying how many more series there are. */
const MAX_SERIES = 300;

// ---- the client and the hint rows -------------------------------------------

/** The client for the current settings, or the error a hint row shows. */
function client(): Client {
  const s = settings.get<Settings>();
  const bad = unconfigured(s);
  if (bad) throw bad;
  return new Client(s.url, s.token, Math.max(1, Number(s.timeout) || 8) * 1000);
}
const base = () => settings.get<Settings>().url.trim().replace(/\/+$/, "");

/** The one row a broken setup lists: inert but for an unset URL or token, whose Enter opens Settings on the field. */
function problem(e: unknown): Item[] {
  const g = e instanceof GrafanaError ? e : undefined;
  const setup = g && /not set up|not set|did not resolve|needs http/.test(g.message);
  return [hint("setup", g?.message ?? `Grafana: ${errorMessage(e)}`, g?.hint, { icon: GLYPH.problem, actions: setup ? [{ id: "settings", title: "Open Grafana settings" }] : [] })];
}
const settingsLink = (): Effect => ({ open: `pal://settings/extensions?anchor=extensions:${instance().key}:url` });
const failed = (what: string, e: unknown): Effect => toast(`Could not ${what}`, e instanceof GrafanaError ? `${e.message}. ${e.hint}` : errorMessage(e), "failure");

// ---- dashboards ---------------------------------------------------------------

let dashCache: { at: number; rows: Dashboard[] } | undefined;

/** Every dashboard, starred first then as Grafana sorts them (by title); kept a minute across the palette and its drill-ins. */
async function dashboards(c: Client, refresh = false): Promise<Dashboard[]> {
  if (!refresh && dashCache && now() - dashCache.at < DASH_TTL) return dashCache.rows;
  const rows = (await c.dashboards()).map((d) => ({ ...d, tags: d.tags ?? [], isStarred: !!d.isStarred })).sort((a, b) => Number(b.isStarred) - Number(a.isStarred));
  dashCache = { at: now(), rows };
  return rows;
}

/** The folder a dashboard is in, as the search names it; the root is Grafana's "General" (its "Dashboards" root in 10+). */
const folderOf = (d: Dashboard) => d.folderTitle ?? "General";
const folderKey = (d: Dashboard) => d.folderUid ?? "";

function dashActions(d: Dashboard): Action[] {
  return [
    { id: "open", title: "Open in Grafana" },
    { id: "range", title: "Open with a time range", shortcut: "cmd+enter" },
    { id: "copy", title: "Copy URL", shortcut: "cmd+c" },
    { id: "star", title: d.isStarred ? "Unstar" : "Star", shortcut: "cmd+s" },
    { id: "kiosk", title: "Open in kiosk mode", shortcut: "cmd+f" },
    { id: "uid", title: "Copy uid", shortcut: "cmd+u" },
    { id: "folder", title: `Show folder ${folderOf(d)}`, shortcut: "right" },
  ];
}

function dashRow(d: Dashboard): Item {
  const accessories: Accessory[] = [{ tag: folderOf(d), color: "blue" }, ...d.tags.slice(0, 2).map((t): Accessory => ({ tag: t }))];
  return {
    id: d.uid,
    name: d.title,
    subtitle: d.description ? truncate(oneLine(d.description), 90) : folderOf(d),
    icon: d.isStarred ? tinted(GLYPH.star, "amber") : GLYPH.dash,
    keywords: [d.uid, ...d.tags, folderOf(d)],
    accessories,
    actions: dashActions(d),
  };
}

/** The Folders filter: one row per folder with a dashboard in it, Enter drills in. */
function folderRows(rows: Dashboard[]): Item[] {
  const counts = new Map<string, { title: string; n: number }>();
  for (const d of rows) { const k = folderKey(d); counts.set(k, { title: folderOf(d), n: (counts.get(k)?.n ?? 0) + 1 }); }
  return [...counts].sort(([, a], [, b]) => a.title.localeCompare(b.title)).map(([uid, f]) => ({
    id: `folder:${uid}`, name: f.title, subtitle: `${f.n} ${f.n === 1 ? "dashboard" : "dashboards"}`, icon: GLYPH.folder, keywords: ["folder"],
    actions: [{ id: "show", title: "Show dashboards" }, { id: "open", title: "Open the folder in Grafana", shortcut: "cmd+enter" }],
  }));
}

async function dashRows(ctx?: Ctx): Promise<Item[]> {
  const args = (ctx?.args ?? {}) as Args;
  let c: Client;
  try { c = client(); } catch (e) { return problem(e); }
  try {
    const rows = await dashboards(c, ctx?.refresh);
    if (args.folder !== undefined) {
      const inside = rows.filter((d) => folderKey(d) === args.folder);
      return inside.length ? inside.map(dashRow) : [hint("empty", "No dashboards in this folder")];
    }
    switch (ctx?.filter) {
      case "starred": { const st = rows.filter((d) => d.isStarred); return st.length ? st.map(dashRow) : [hint("none", "No starred dashboards", "cmd+s on a dashboard stars it for this token")]; }
      case "folders": return folderRows(rows);
      default: return rows.length ? rows.map(dashRow) : [hint("none", "No dashboards", "The token sees none; a Viewer role on the folders makes them show")];
    }
  } catch (e) {
    return problem(e);
  }
}

/** The form behind Open with a time range: the setting's range prefilled, kiosk as a tick. */
function rangeForm(d: Dashboard, errors?: Record<string, string>): Form {
  const s = settings.get<Settings>();
  return {
    id: d.uid,
    title: `Open ${d.title}`,
    fields: [
      { kind: "text", id: "from", label: "From", placeholder: "now-6h, now-7d, 2026-09-01", required: true, default: s.time_range.trim() || "now-6h", description: "Relative to now, or a date." },
      { kind: "text", id: "to", label: "To", placeholder: "now", default: "now" },
      { kind: "checkbox", id: "kiosk", label: "Kiosk mode", text: "Without Grafana's chrome, for a wall", default: false },
    ],
    submit: { id: "go", title: "Open" },
    errors,
  };
}

async function pickDashboard(id: string, action: string | undefined, ctx: Ctx | undefined): Promise<Effect | void> {
  if (id === "hint:setup") return action === "settings" ? settingsLink() : undefined;
  if (id.startsWith("hint:")) return;
  const c = client();
  const s = settings.get<Settings>();
  if (id.startsWith("folder:")) {
    const uid = id.slice(7);
    if (action === "open") return { open: uid ? `${c.url}/dashboards/f/${encodeURIComponent(uid)}/` : `${c.url}/dashboards` };
    const title = (await dashboards(c)).find((d) => folderKey(d) === uid);
    return { push: { extension: EXTENSION, palette: "grafana", args: { folder: uid } satisfies Args, title: title ? folderOf(title) : "Folder" } };
  }
  const d = (await dashboards(c)).find((x) => x.uid === id) ?? { uid: id, title: id, url: `/d/${id}`, tags: [], isStarred: false };
  switch (action) {
    case "range": return { form: rangeForm(d) };
    case "go": {
      const v = ctx?.values ?? {};
      const from = String(v.from ?? "").trim();
      if (!from) return { form: rangeForm(d, { from: "Required" }) };
      return { open: dashboardUrl(c.url, d, { from: timeParam(from), to: timeParam(String(v.to ?? "now")) || "now", kiosk: v.kiosk === true }) };
    }
    case "copy": return { copy: dashboardUrl(c.url, d) };
    case "uid": return { copy: d.uid };
    case "kiosk": return { open: dashboardUrl(c.url, d, { kiosk: true, from: s.time_range.trim() || undefined }) };
    case "star": {
      try { await (d.isStarred ? c.unstar(d.uid) : c.star(d.uid)); } catch (e) { return failed(`${d.isStarred ? "unstar" : "star"} ${d.title}`, e); }
      d.isStarred = !d.isStarred;
      dashCache = undefined;
      return toast(d.isStarred ? `Starred ${d.title}` : `Unstarred ${d.title}`);
    }
    case "folder": return { push: { extension: EXTENSION, palette: "grafana", args: { folder: folderKey(d) } satisfies Args, title: folderOf(d) } };
    default: return { open: dashboardUrl(c.url, d, { from: s.time_range.trim() || undefined }) };
  }
}

// ---- the pane: description, facts, the first time series panels -----------------

const paneCache = new Map<string, { at: number; detail: Detail }>();
let rendererKnown: { url: string; ok: boolean } | undefined;
let dsCache: { at: number; list: Datasource[] } | undefined;

/** Whether the image renderer plugin is installed, asked once per URL and remembered for the process. */
async function hasRenderer(c: Client): Promise<boolean> {
  if (rendererKnown?.url === c.url) return rendererKnown.ok;
  let ok = false;
  try { ok = await c.renderer(); } catch (e) { console.error(`[grafana] renderer probe: ${errorMessage(e)}`); }
  rendererKnown = { url: c.url, ok };
  return ok;
}

/** The Prometheus datasource the queries run against: the setting by uid or name, else Grafana's default when it is one, else the first; kept ten minutes. */
async function datasource(c: Client): Promise<Datasource> {
  if (!dsCache || now() - dsCache.at > DS_TTL) dsCache = { at: now(), list: await c.datasources() };
  const prom = dsCache.list.filter((d) => d.type === "prometheus");
  const want = settings.get<Settings>().datasource.trim();
  const chosen = want ? prom.find((d) => d.uid === want || d.name.toLowerCase() === want.toLowerCase()) : prom.find((d) => d.isDefault) ?? prom[0];
  if (!chosen) throw new GrafanaError(want ? `No Prometheus datasource named ${want}` : "No Prometheus datasource", want ? "Its uid or name, under Settings › Extensions › Grafana" : "Add one in Grafana (Connections › Data sources)");
  return chosen;
}

/** A panel's targets that can run outside the dashboard: with an expression, shown, no template variable in it. */
const runnable = (p: Panel) => (p.targets ?? []).filter((t) => t.expr?.trim() && !t.hide && standalone(t.expr) && dsUid(t.datasource) !== null);

/**
 * The first `sparklines` time series panels as markdown images: the
 * renderer plugin's PNGs when it is installed, else one query call for
 * every panel's expressions drawn as sparklines. A panel that fails is
 * left out; nothing here is worth a hint row.
 */
async function panelImages(c: Client, dj: DashboardJson, n: number): Promise<string[]> {
  const panels = flatPanels(dj.dashboard.panels).filter((p) => p.type === "timeseries" && dsUid(p.datasource) !== null && runnable(p).length).slice(0, n);
  if (!panels.length) return [];
  const from = dj.dashboard.time?.from ?? "now-6h", to = dj.dashboard.time?.to ?? "now";
  const title = (p: Panel) => p.title?.trim() || `Panel ${p.id}`;
  if (await hasRenderer(c)) {
    const theme = (await state.get("theme").catch(() => null)) === "light" ? "light" : "dark";
    const out = await Promise.all(panels.map(async (p) => {
      try {
        const png = await c.render(dj.dashboard.uid, p.id, { width: 480, height: 160, theme, from, to });
        return `![${title(p)}](data:image/png;base64,${Buffer.from(png).toString("base64")})`;
      } catch (e) { console.error(`[grafana] render ${dj.dashboard.uid}/${p.id}: ${errorMessage(e)}`); return ""; }
    }));
    return out.filter(Boolean);
  }
  let fallback: Datasource | undefined;
  const intervalMs = Math.max(15_000, Math.round(spanMs(from, to, now()) / 60));
  const queries: Record<string, unknown>[] = [];
  for (const p of panels) {
    for (const t of runnable(p).slice(0, 3)) {
      let uid = dsUid(t.datasource) ?? dsUid(p.datasource);
      if (!uid) { try { fallback ??= await datasource(c); uid = fallback.uid; } catch { continue; } }
      queries.push({ refId: `p${p.id}_${t.refId ?? "A"}`, datasource: { uid, type: "prometheus" }, expr: t.expr, range: true, instant: false, intervalMs, maxDataPoints: 60 });
    }
  }
  if (!queries.length) return [];
  const results = await c.query(queries, from, to);
  return panels.flatMap((p) => {
    const series: Series[] = [];
    for (const q of queries) if (String(q.refId).startsWith(`p${p.id}_`)) { try { series.push(...seriesOf(results, String(q.refId))); } catch { /* one target failed: the rest draw */ } }
    const drawn = series.filter((s) => s.points.length).slice(0, 4);
    if (!drawn.length) return [];
    const caption = `${withUnit(drawn[0].value, p.fieldConfig?.defaults?.unit)}${drawn.length > 1 ? ` · ${series.length} series` : ""}`;
    return [`![${title(p)}](${sparkline({ title: title(p), caption, series: drawn.map((s) => s.points) })})`];
  });
}

async function pane(uid: string): Promise<Detail | void> {
  const hit = paneCache.get(uid);
  if (hit && now() - hit.at < PANE_TTL) return hit.detail;
  let c: Client;
  try { c = client(); } catch { return; }
  const s = settings.get<Settings>();
  let dj: DashboardJson;
  try { dj = await c.dashboard(uid); } catch (e) { return { metadata: [{ label: "Grafana", value: e instanceof GrafanaError ? e.message : errorMessage(e) }] }; }
  const db = dj.dashboard;
  const md: string[] = [];
  if (db.description?.trim()) md.push(mdEscape(db.description.trim()));
  const n = Math.max(0, Math.min(6, Number(s.sparklines) || 0));
  if (n) { try { md.push(...await panelImages(c, dj, n)); } catch (e) { console.error(`[grafana] pane ${uid}: ${errorMessage(e)}`); } }
  const panels = flatPanels(db.panels);
  const kinds = new Map<string, number>();
  for (const p of panels) kinds.set(p.type, (kinds.get(p.type) ?? 0) + 1);
  const metadata: Metadata[] = [
    { label: "Folder", value: dj.meta.folderTitle || "General" },
    ...(db.tags?.length ? [{ label: "Tags", tags: db.tags.map((t) => ({ text: t })) }] : []),
    { label: "Time range", value: `${db.time?.from ?? "now-6h"} to ${db.time?.to ?? "now"}${db.refresh ? `, refreshed every ${db.refresh}` : ""}` },
    { label: "Panels", value: panels.length ? `${panels.length}: ${[...kinds].sort(([, a], [, b]) => b - a).map(([k, v]) => `${v} ${k}`).join(", ")}` : "none" },
    { label: "UID", value: db.uid, link: { text: "Open in Grafana", href: dashboardUrl(c.url, { uid: db.uid, url: dj.meta.url }) } },
  ];
  const detail: Detail = { ...(md.length && { markdown: md.join("\n\n") }), metadata };
  paneCache.set(uid, { at: now(), detail });
  return detail;
}

// ---- alerts -------------------------------------------------------------------

let alertsCache: { at: number; list: AlertInstance[]; silences: Silence[] } | undefined;

/** The instances firing or pending and the active silences, one fetch shared by the palette and the bar for twenty seconds. */
async function alerts(c: Client, refresh = false): Promise<{ list: AlertInstance[]; silences: Silence[] }> {
  if (!refresh && alertsCache && now() - alertsCache.at < ALERTS_TTL) return alertsCache;
  const [groups, am, silences] = await Promise.all([c.rules(), c.amAlerts(), c.silences()]);
  alertsCache = { at: now(), list: instances(groups, am, c.url), silences: silences.filter((s) => (s.status?.state ?? "active") !== "expired") };
  return alertsCache;
}

const stateColor = (a: AlertInstance): TagColor => (a.state === "firing" ? "red" : "amber");

function alertActions(a: AlertInstance): Action[] {
  const silence: Action[] = a.silencedBy.length
    ? [{ id: "unsilence", title: "Expire silence", shortcut: "cmd+e", style: "destructive", confirm: `Expire the silence on ${a.rule}? It will page again.` }]
    : Object.entries(DURATIONS).map(([k, d], i): Action => ({ id: `silence:${k}`, title: `Silence for ${d.title}`, shortcut: ["cmd+s", "cmd+shift+s", "cmd+d"][i], confirm: `Silence ${a.rule} (${labelsLine(a.labels) || "every instance"}) for ${d.title}?` }));
  return [
    { id: "open", title: "Open rule in Grafana" },
    ...(a.dashboardUrl ? [{ id: "dashboard", title: "Open dashboard", shortcut: "cmd+enter" } as Action] : []),
    ...silence,
    { id: "copy", title: "Copy summary", shortcut: "cmd+c" },
    { id: "labels", title: "Copy labels", shortcut: "cmd+l" },
  ];
}

function alertRow(a: AlertInstance): Item {
  const accessories: Accessory[] = [{ tag: a.state, color: stateColor(a) }];
  if (a.severity) accessories.push({ text: a.severity });
  if (a.silencedBy.length) accessories.push({ tag: "silenced" });
  if (a.since) accessories.push({ date: a.since });
  return {
    id: a.id,
    name: a.rule,
    subtitle: a.summary || labelsLine(a.labels) || a.folder,
    icon: a.silencedBy.length ? tinted(GLYPH.muted, "slate") : tinted(a.state === "firing" ? GLYPH.alarm : GLYPH.bell, a.state === "firing" ? "red" : "amber"),
    keywords: [...new Set([a.state, a.folder, ...Object.values(ownLabels(a.labels))])],
    accessories,
    actions: alertActions(a),
  };
}

function silenceRow(s: Silence): Item {
  const line = matchersLine(s.matchers);
  return {
    id: `silence:${s.id}`,
    name: `Silence: ${line}`,
    subtitle: [s.comment, s.createdBy && `by ${s.createdBy}`, `ends ${when(s.endsAt)}`].filter(Boolean).join(" · "),
    icon: tinted(GLYPH.muted, "slate"),
    keywords: ["silence", ...s.matchers.map((m) => m.value)],
    accessories: [{ tag: s.status?.state === "pending" ? "starts later" : "silence" }, { date: s.endsAt }],
    actions: [
      { id: "expire", title: "Expire silence", style: "destructive", confirm: `Expire the silence on ${line}? What it covers will page again.` },
      { id: "open", title: "Open in Grafana", shortcut: "cmd+enter" },
      { id: "copy", title: "Copy matchers", shortcut: "cmd+c" },
    ],
  };
}

async function alertRows(ctx?: Ctx): Promise<Item[]> {
  let c: Client;
  try { c = client(); } catch (e) { return problem(e); }
  try {
    const { list, silences } = await alerts(c, ctx?.refresh);
    const quiet = (what: string, sub?: string) => [hint("quiet", what, sub, { icon: tinted(GLYPH.check, "green") })];
    switch (ctx?.filter) {
      case "firing": { const r = list.filter((a) => a.state === "firing"); return r.length ? r.map(alertRow) : quiet("Nothing firing"); }
      case "pending": { const r = list.filter((a) => a.state === "pending"); return r.length ? r.map(alertRow) : quiet("Nothing pending"); }
      case "silenced": {
        const r = [...list.filter((a) => a.silencedBy.length).map(alertRow), ...silences.map(silenceRow)];
        return r.length ? r : quiet("No silence is active", "cmd+s on an alert silences it for an hour");
      }
      default: return list.length ? list.map(alertRow) : quiet("All quiet", "No alert is firing or pending");
    }
  } catch (e) {
    return problem(e);
  }
}

/** Creates the silence and marks the instance covered in the cache, so the relist shows it before the Alertmanager does. */
async function silence(c: Client, a: AlertInstance, key: string): Promise<Effect> {
  const d = DURATIONS[key];
  if (!d) return failed("silence", new Error(`unknown duration ${key}`));
  const t = now();
  const matchers = silenceMatchers(a), startsAt = new Date(t).toISOString(), endsAt = new Date(t + d.seconds * 1000).toISOString(), comment = `${a.rule}: silenced from pal for ${d.title}`;
  let id: string;
  try { id = await c.silence(matchers, startsAt, endsAt, comment); } catch (e) { return failed(`silence ${a.rule}`, e); }
  if (alertsCache) {
    for (const x of alertsCache.list) if (x.id === a.id) x.silencedBy = [id];
    alertsCache.silences.push({ id, matchers, startsAt, endsAt, createdBy: "pal", comment, status: { state: "active" } });
  }
  bar.refresh("alerts").catch(() => {});
  return toast(`Silenced ${a.rule} for ${d.title}`, labelsLine(a.labels) || undefined);
}

/** Expires the silences by id and uncovers what they held in the cache. */
async function expire(c: Client, ids: string[], what: string): Promise<Effect> {
  try { for (const id of ids) await c.expire(id); } catch (e) { return failed(`expire the silence on ${what}`, e); }
  if (alertsCache) {
    for (const x of alertsCache.list) x.silencedBy = x.silencedBy.filter((s) => !ids.includes(s));
    alertsCache.silences = alertsCache.silences.filter((s) => !ids.includes(s.id));
  }
  bar.refresh("alerts").catch(() => {});
  return toast(`Expired the silence on ${what}`);
}

async function pickAlert(id: string, action: string | undefined): Promise<Effect | void> {
  if (id === "hint:setup") return action === "settings" ? settingsLink() : undefined;
  if (id.startsWith("hint:")) return;
  const c = client();
  const { list, silences } = await alerts(c);
  if (id.startsWith("silence:")) {
    const s = silences.find((x) => x.id === id.slice(8));
    if (!s) return toast("That silence is gone", undefined, "failure");
    switch (action) {
      case "open": return { open: silenceUrl(c.url, s.id) };
      case "copy": return { copy: matchersLine(s.matchers) };
      default: return expire(c, [s.id], matchersLine(s.matchers));
    }
  }
  const a = list.find((x) => x.id === id);
  if (!a) return toast("That alert is no longer firing", "The list was refreshed", "success");
  switch (action) {
    case "dashboard": return { open: a.dashboardUrl ?? alertsUrl(c.url) };
    case "copy": return { copy: a.summary ?? `${a.rule}: ${labelsLine(a.labels)}` };
    case "labels": return { copy: Object.entries(a.labels).filter(([k]) => !k.startsWith("__")).sort(([x], [y]) => x.localeCompare(y)).map(([k, v]) => `${k}="${v}"`).join(", ") };
    case "unsilence": return expire(c, a.silencedBy, a.rule);
    default:
      if (action?.startsWith("silence:")) return silence(c, a, action.slice(8));
      return { open: ruleUrl(c.url, a.ruleUid) };
  }
}

function alertDetail(a: AlertInstance, c: Client): Detail {
  const md = [a.summary && `**${mdEscape(a.summary)}**`, a.description && mdEscape(a.description)].filter(Boolean).join("\n\n");
  const labels = Object.entries(ownLabels(a.labels)).map(([k, v]) => ({ text: `${k}=${v}` }));
  return {
    ...(md && { markdown: md }),
    metadata: [
      { label: "Rule", value: a.rule, link: { text: "Open in Grafana", href: ruleUrl(c.url, a.ruleUid) } },
      { label: "State", tags: [{ text: a.state, color: stateColor(a) }, ...(a.severity ? [{ text: a.severity, color: SEVERITY[a.severity] ?? "grey" }] : [])] },
      ...(a.since ? [{ label: "Since", value: `${when(a.since)} (${ago(a.since)})` }] : []),
      { label: "Folder", value: a.folder || "General" },
      ...(a.value ? [{ label: "Value", value: Number.isFinite(Number(a.value)) ? fmt(Number(a.value)) : a.value }] : []),
      ...(a.health ? [{ label: "Health", value: truncate(a.health, 200) }] : []),
      ...(labels.length ? [{ label: "Labels", tags: labels }] : []),
      ...(a.silencedBy.length ? [{ label: "Silenced", value: a.silencedBy.length === 1 ? "by one silence" : `by ${a.silencedBy.length} silences`, link: { text: "Open", href: silenceUrl(c.url, a.silencedBy[0]) } }] : []),
      ...(a.dashboardUrl ? [{ label: "Dashboard", link: { text: a.dashboardUrl.replace(/^https?:\/\/[^/]+/, ""), href: a.dashboardUrl } }] : []),
    ],
  };
}

// ---- the query prompt -----------------------------------------------------------

const queryCache = new Map<string, { at: number; items: Item[] }>();
/** The series behind the rows of the last listing, by row id, for the picks. */
const seriesById = new Map<string, Series>();
let lastExpr = "";
let inflight: AbortController | undefined;

const QUERY_ACTIONS: Action[] = [
  { id: "value", title: "Copy value" },
  { id: "series", title: "Copy series and value", shortcut: "cmd+enter" },
  { id: "explore", title: "Open in Explore", shortcut: "cmd+o" },
  { id: "expr", title: "Copy expression", shortcut: "cmd+c" },
  { id: "all", title: "Copy every series", shortcut: "cmd+shift+a" },
  { id: "save", title: "Save query", shortcut: "cmd+s" },
];

function savedRows(): Item[] {
  const saved = savedQueries(settings.get<Settings>().queries);
  return saved.map((q, i) => ({
    id: `q:${i}`, name: q.name, subtitle: q.expr, icon: tinted(GLYPH.saved, "amber"), keywords: ["saved"],
    actions: [
      { id: "run", title: "Run" },
      { id: "explore", title: "Open in Explore", shortcut: "cmd+o" },
      { id: "expr", title: "Copy expression", shortcut: "cmd+c" },
      { id: "remove", title: "Remove saved query", shortcut: "cmd+backspace", style: "destructive", confirm: `Remove ${q.name} from the saved queries?` },
    ],
  }));
}

function seriesRow(s: Series, expr: string): Item {
  const id = `s:${fnv(`${expr}\0${s.name}`)}`;
  seriesById.set(id, s);
  const labels = Object.entries(s.labels).filter(([k]) => k !== "__name__");
  return {
    id, name: s.name, icon: GLYPH.query, keywords: labels.map(([, v]) => v),
    accessories: [{ text: fmt(s.value) }],
    detail: { markdown: `## ${mdEscape(fmt(s.value))}`, metadata: [{ label: "Expression", value: expr }, ...(s.time ? [{ label: "At", value: when(s.time) }] : []), ...labels.map(([k, v]) => ({ label: k, value: v }))] },
  };
}

async function queryRows(query = "", ctx?: Ctx): Promise<Item[]> {
  const expr = query.trim();
  if (!expr) return [hint("type", "Type PromQL", "An instant query against Prometheus; Enter copies a value, cmd+o opens Explore", { icon: GLYPH.query }), ...savedRows()];
  let c: Client;
  try { c = client(); } catch (e) { return problem(e); }
  lastExpr = expr;
  const hit = queryCache.get(expr);
  if (hit && !ctx?.refresh && now() - hit.at < QUERY_TTL) return hit.items;
  inflight?.abort();
  const ac = (inflight = new AbortController());
  try {
    const ds = await datasource(c);
    const results = await c.query([{ refId: "A", datasource: { uid: ds.uid, type: ds.type }, expr, instant: true, range: false, intervalMs: 30_000, maxDataPoints: 100 }], "now-5m", "now", ac.signal);
    const series = seriesOf(results);
    const items = series.slice(0, MAX_SERIES).map((s) => seriesRow(s, expr));
    if (series.length > MAX_SERIES) items.push(hint("more", `and ${series.length - MAX_SERIES} more series`, "Narrow the selector, or open Explore for the whole set"));
    if (!items.length) items.push(hint("empty", "No series", `${truncate(expr, 60)} matched nothing right now`, { icon: GLYPH.query }));
    queryCache.set(expr, { at: now(), items });
    return items;
  } catch (e) {
    if (ac.signal.aborted) return [];
    return e instanceof QueryError ? [hint("error", e.message, e.hint, { icon: GLYPH.problem })] : problem(e);
  } finally {
    if (inflight === ac) inflight = undefined;
  }
}

/** The form behind Save query: the name, the expression as typed. */
function saveForm(expr: string, errors?: Record<string, string>): Form {
  return {
    id: "save",
    title: "Save query",
    fields: [
      { kind: "text", id: "name", label: "Name", placeholder: "Targets down", required: true },
      { kind: "text", id: "expr", label: "Expression", required: true, default: expr },
    ],
    submit: { id: "saved", title: "Save" },
    errors,
  };
}

async function pickQuery(id: string, action: string | undefined, ctx: Ctx | undefined): Promise<Effect | void> {
  if (id === "hint:setup") return action === "settings" ? settingsLink() : undefined;
  if (id.startsWith("hint:")) return;
  const lines = settings.get<Settings>().queries;
  if (id === "save") {
    const v = ctx?.values ?? {};
    const name = String(v.name ?? "").trim(), expr = String(v.expr ?? "").trim();
    if (!name || !expr) return { form: saveForm(expr, { [name ? "expr" : "name"]: "Required" }) };
    if (/\s=\s/.test(name)) return { form: saveForm(expr, { name: "A name without ' = ' in it" }) };
    await settings.set("queries", [...lines, `${name} = ${expr}`]);
    return toast(`Saved ${name}`, "Listed before you type, and under Settings › Extensions › Grafana");
  }
  if (id.startsWith("q:")) {
    const q = savedQueries(lines)[Number(id.slice(2))];
    if (!q) return toast("That saved query is gone", undefined, "failure");
    switch (action) {
      case "explore": { const c = client(); return { open: exploreUrl(c.url, (await datasource(c)).uid, q.expr) }; }
      case "expr": return { copy: q.expr };
      case "remove": {
        await settings.set("queries", lines.filter((l) => !(savedQueries([l])[0]?.name === q.name && savedQueries([l])[0]?.expr === q.expr)));
        return toast(`Removed ${q.name}`);
      }
      default: return { push: { extension: EXTENSION, palette: "query", query: q.expr } };
    }
  }
  const s = seriesById.get(id);
  switch (action) {
    case "explore": { const c = client(); return { open: exploreUrl(c.url, (await datasource(c)).uid, lastExpr) }; }
    case "expr": return { copy: lastExpr };
    case "save": return { form: saveForm(lastExpr) };
    case "all": {
      const rows = queryCache.get(lastExpr)?.items.filter((i) => !i.id.startsWith("hint:")) ?? [];
      return { copy: rows.map((i) => `${i.name}\t${fmt(seriesById.get(i.id)?.value)}`).join("\n") };
    }
    case "series": return s ? { copy: `${s.name} ${fmt(s.value)}` } : undefined;
    default: return s ? { copy: fmt(s.value), hud: `Copied ${fmt(s.value)}` } : undefined;
  }
}

// A new URL or token: nothing fetched under the old one is worth keeping.
settings.onChange(() => { dashCache = undefined; alertsCache = undefined; dsCache = undefined; rendererKnown = undefined; paneCache.clear(); queryCache.clear(); });

// ---- the bar item ----------------------------------------------------------------

let barFocus: string | undefined;
let barAccount: string | undefined;

/** The popover's state over the cached list: the cursor on the focused instance, else the first row. */
function barState(list: AlertInstance[]): BarState {
  const focus = Math.max(0, list.findIndex((a) => a.id === barFocus));
  barFocus = list[focus]?.id;
  return { rows: list, focus, now: now(), account: barAccount };
}

/** Counts firing and pending, publishes both as states, and hands presence and colour to the manifest's rules; unconfigured is hidden (the strip has no room for a hint), anything else throws (stale). */
async function alertsItem(ctx: BarCtx): Promise<BarItem> {
  barAccount = ctx.instance?.title;
  let c: Client;
  try { c = client(); } catch { return { hidden: true, states: { firing: null, pending: null } }; }
  const { list } = await alerts(c, ["show", "wake", "network", "cli", "update"].includes(ctx.reason));
  const firing = list.filter((a) => a.state === "firing" && !a.silencedBy.length).length, pending = list.filter((a) => a.state === "pending").length;
  const parts = [firing && `${firing} firing`, pending && `${pending} pending`].filter(Boolean);
  const tooltip = parts.length ? `${parts.join(", ")} on Grafana` : "No alert is firing on Grafana";
  const menu = { view: renderBar(barState(list)) };
  return {
    icon: GLYPH.grafana,
    segments: [...(firing ? [{ id: "firing", text: String(firing), color: "red" as const, tooltip: `${firing} firing` }] : []), ...(pending ? [{ id: "pending", text: String(pending), color: "amber" as const, tooltip: `${pending} pending` }] : [])],
    tooltip,
    menu,
    empty: { icon: GLYPH.grafana, tooltip: "No alert is firing on Grafana", menu },
    states: { firing, pending },
  };
}

/** A key or a click in the popover: Enter opens the focused rule, `o` its dashboard, `s`/`f`/`d` silence it (or `s` expires the silence), `c` copies, `p` pushes the palette, arrows and a click move the cursor; a change answers the fresh tree with `keep` so the strip follows. */
async function alertsAction(action: string): Promise<Effect | void> {
  if (action === "pal") return { push: { extension: EXTENSION, palette: "alerts" } };
  const c = client();
  if (action === "site") return { open: alertsUrl(c.url) };
  const { list } = await alerts(c, action === "refresh");
  if (action === "refresh") return { keep: true, view: renderBar(barState(list)) };
  const st = barState(list);
  const redraw = (): Effect => ({ view: renderBar(barState(list)) });
  if (action.startsWith("focus:")) { barFocus = action.slice(6); return redraw(); }
  if (action === "down" || action === "up") {
    if (!list.length) return { keep: true };
    barFocus = list[(st.focus + (action === "down" ? 1 : list.length - 1)) % list.length].id;
    return redraw();
  }
  const cur = list[st.focus];
  if (!cur) return { keep: true };
  switch (action) {
    case "open": return { open: ruleUrl(c.url, cur.ruleUid) };
    case "dashboard": return { open: cur.dashboardUrl ?? alertsUrl(c.url) };
    case "copy": return { copy: cur.summary ?? `${cur.rule}: ${labelsLine(cur.labels)}` };
    // A silence or its end: the row's rail turns grey (or red again) in place, and the strip's count follows the `keep`.
    case "unsilence": { const r = await expire(c, cur.silencedBy, cur.rule); return r.toast?.style === "failure" ? r : { keep: true, view: renderBar(barState(list)) }; }
    default:
      if (action.startsWith("silence:")) { const r = await silence(c, cur, action.slice(8)); return r.toast?.style === "failure" ? r : { keep: true, view: renderBar(barState(list)) }; }
      return { keep: true };
  }
}

// ---- the extension ------------------------------------------------------------------

export default {
  palettes: {
    grafana: {
      title: "Grafana Dashboards",
      placeholder: "Search dashboards",
      filters: [{ id: "all", title: "All dashboards" }, { id: "starred", title: "Starred" }, { id: "folders", title: "Folders" }],
      list: (_query, ctx) => dashRows(ctx),
      pick: async (id, action, ctx): Promise<Effect | void> => {
        try { return await pickDashboard(id, action, ctx); } catch (e) { return failed(`reach Grafana for ${id}`, e); }
      },
      detail: (id) => (id.startsWith("hint:") || id.startsWith("folder:") ? undefined : pane(id)),
    },
    alerts: {
      title: "Grafana Alerts",
      live: true,
      placeholder: "Search alerts",
      filters: [{ id: "all", title: "Firing and pending" }, { id: "firing", title: "Firing" }, { id: "pending", title: "Pending" }, { id: "silenced", title: "Silenced" }],
      list: (_query, ctx) => alertRows(ctx),
      pick: async (id, action): Promise<Effect | void> => {
        try { return await pickAlert(id, action); } catch (e) { return failed(`reach Grafana for ${id}`, e); }
      },
      detail: async (id): Promise<Detail | void> => {
        if (id.startsWith("hint:") || id.startsWith("silence:")) return;
        let c: Client;
        try { c = client(); } catch { return; }
        const a = (await alerts(c).catch(() => undefined))?.list.find((x) => x.id === id);
        return a ? alertDetail(a, c) : undefined;
      },
    },
    query: {
      title: "Grafana Query",
      input: true,
      placeholder: "PromQL, e.g. up == 0",
      actions: QUERY_ACTIONS,
      list: (query, ctx) => queryRows(query, ctx),
      pick: async (id, action, ctx): Promise<Effect | void> => {
        try { return await pickQuery(id, action, ctx); } catch (e) { return failed("reach Grafana", e); }
      },
    },
  },
  bar: {
    alerts: { render: alertsItem, onAction: alertsAction },
  },
  link: async (route: string, params: LinkParams): Promise<Effect | void> => {
    if (route === "query") return { push: { extension: EXTENSION, palette: "query", query: String(params.expr) } };
    if (route === "open") {
      const s = settings.get<Settings>();
      const from = params.from !== undefined ? timeParam(String(params.from)) : s.time_range.trim() || undefined;
      return { open: dashboardUrl(base(), { uid: String(params.uid) }, { from, to: params.to !== undefined ? timeParam(String(params.to)) : undefined, kiosk: params.kiosk === true }) };
    }
  },
} satisfies Extension;
