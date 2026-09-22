// Grafana over its HTTP API with a service account token: the client
// (every request with the settings' timeout, one redirect hop with the
// token kept, a 401 named as such), the wire shapes the extension reads,
// and the pure helpers that turn them into what the rows need: an alert
// instance out of the ruler's groups, a series out of `/api/ds/query`'s
// frames, the URLs Grafana opens, a value written short. No pal calls
// beyond the SDK's text helpers, so the tests drive these without a host.
import { bytes, errorMessage } from "@zcag/pal";

/** `[extensions.grafana]`, defaults in pal.json. */
export type Settings = { url: string; token: string; time_range: string; datasource: string; queries: string[]; sparklines: number; timeout: number };

/** One row of `/api/search?type=dash-db`. */
export type Dashboard = { uid: string; title: string; url: string; tags: string[]; isStarred: boolean; folderUid?: string; folderTitle?: string; description?: string };
/** One row of `/api/folders`. */
export type Folder = { uid: string; title: string };
/** One target of a panel: the PromQL and where it runs. */
export type Target = { refId?: string; expr?: string; datasource?: { uid?: string; type?: string } | string; hide?: boolean };
/** One panel of a dashboard's JSON; a `row` panel nests the ones under it in `panels`. */
export type Panel = { id: number; type: string; title?: string; datasource?: { uid?: string; type?: string } | string; targets?: Target[]; panels?: Panel[]; fieldConfig?: { defaults?: { unit?: string } } };
/** `/api/dashboards/uid/<uid>`: the JSON and what Grafana knows around it. */
export type DashboardJson = { meta: { url: string; slug?: string; folderTitle?: string; folderUid?: string; isStarred?: boolean }; dashboard: { uid: string; title: string; description?: string; tags?: string[]; time?: { from: string; to: string }; refresh?: string; panels?: Panel[] } };
/** One datasource of `/api/datasources`. */
export type Datasource = { uid: string; name: string; type: string; isDefault?: boolean };

/** One rule of the ruler's Prometheus-compatible `/api/v1/rules`, with the instances the `state` filter let through. */
export type Rule = { uid?: string; name: string; state: "firing" | "pending" | "inactive"; health?: string; folderUid?: string; labels?: Record<string, string>; annotations?: Record<string, string>; lastError?: string; alerts?: RuleAlert[] };
export type RuleAlert = { labels: Record<string, string>; annotations?: Record<string, string>; state: string; activeAt?: string; value?: string };
export type RuleGroup = { name: string; file?: string; folderUid?: string; rules: Rule[] };
/** One alert the Alertmanager holds (`/api/v2/alerts`): only firing ones live here, with whether a silence covers them. */
export type AmAlert = { labels: Record<string, string>; status?: { state?: "active" | "suppressed" | "unprocessed"; silencedBy?: string[] }; fingerprint?: string };
export type Matcher = { name: string; value: string; isEqual: boolean; isRegex: boolean };
export type Silence = { id: string; matchers: Matcher[]; startsAt: string; endsAt: string; createdBy?: string; comment?: string; status?: { state?: "active" | "pending" | "expired" } };

/** One alert instance as the rows and the bar see it: the rule it belongs to, its state, its labels, its texts, and whether a silence covers it. */
export type AlertInstance = {
  /** Stable across listings: the rule's uid and a hash of the labels. */
  id: string;
  rule: string;
  ruleUid: string;
  folder: string;
  state: "firing" | "pending";
  /** ISO, when the instance went active. */
  since?: string;
  labels: Record<string, string>;
  summary?: string;
  description?: string;
  /** The `view_url` or `__dashboardUid__` annotation, as a URL. */
  dashboardUrl?: string;
  severity?: string;
  value?: string;
  /** The rule's `health` when it is not `ok`, with the error Grafana reports. */
  health?: string;
  silencedBy: string[];
};

/** One series out of a query's frames: its labels, the name Grafana would show, the last value and the points (a range query). */
export type Series = { name: string; labels: Record<string, string>; value: number | null; time?: number; points: [number, number][] };

/** `/api/ds/query`'s answer: one result per refId, each with frames or an error. */
export type QueryResults = { results: Record<string, { status?: number; error?: string; frames?: Frame[] }> };
export type Frame = { schema: { refId?: string; fields: { name: string; type: string; labels?: Record<string, string>; config?: { displayNameFromDS?: string; displayName?: string; unit?: string } }[] }; data: { values: unknown[][] } };

const SETTINGS_HINT = "Settings › Extensions › Grafana";

/** A request that did not work, with a one-line `hint` for the row; `status` when Grafana answered. */
export class GrafanaError extends Error {
  constructor(message: string, readonly hint: string, readonly status?: number, readonly body?: string) { super(message); }
}

/** An expression Prometheus refused: the message is its parse or evaluation error, as Explore would show it. */
export class QueryError extends GrafanaError {
  constructor(message: string) { super(message, "PromQL as Prometheus reads it; Explore shows the same"); }
}

/** What is wrong with the settings before any request, or nothing. */
export function unconfigured(s: Settings): GrafanaError | undefined {
  if (!s.url?.trim()) return new GrafanaError("Grafana is not set up", `Set the URL and a service account token under ${SETTINGS_HINT}`);
  if (!/^https?:\/\//.test(s.url.trim())) return new GrafanaError("The URL needs http:// or https://", `${s.url.trim()} is not a URL: fix it under ${SETTINGS_HINT}`);
  if (!s.token?.trim()) return new GrafanaError("Token is not set", `Add a service account token (Administration › Service accounts) under ${SETTINGS_HINT}`);
  if (/^(keychain|env):/.test(s.token)) return new GrafanaError("The token did not resolve", `${s.token} has no value on this machine; pal's log says why. ${SETTINGS_HINT}`);
}

/** Origins already reported as redirecting, so the log says it once. */
const warned = new Set<string>();

export class Client {
  url: string;
  constructor(url: string, private readonly token: string, readonly timeoutMs: number) { this.url = url.trim().replace(/\/+$/, ""); }

  /**
   * One request. A redirect is followed by hand (one hop) with the token
   * kept, since `fetch` drops Authorization when the origin changes and an
   * `http://` URL behind a proxy answering 301 would look like a bad
   * token; the client keeps the redirected origin. `raw` answers the body
   * as bytes (a rendered panel), else JSON.
   */
  async request<T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown, o: { raw?: boolean; signal?: AbortSignal; hop?: number } = {}): Promise<T> {
    let res: Response;
    const timeout = AbortSignal.timeout(this.timeoutMs);
    try {
      res = await fetch(`${this.url}${path}`, {
        method,
        headers: { Authorization: `Bearer ${this.token}`, Accept: o.raw ? "*/*" : "application/json", ...(body !== undefined && { "Content-Type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: o.signal ? AbortSignal.any([timeout, o.signal]) : timeout,
        redirect: "manual",
      });
    } catch (e) {
      if (o.signal?.aborted) throw e;
      const timedOut = e instanceof Error && e.name === "TimeoutError";
      throw new GrafanaError(timedOut ? `${this.url} did not answer within ${this.timeoutMs / 1000} s` : `Could not reach ${this.url}`, timedOut ? `Raise the timeout or check the URL under ${SETTINGS_HINT}` : `${errorMessage(e)}. Check the URL under ${SETTINGS_HINT}`);
    }
    const location = res.headers.get("location");
    if (res.status >= 301 && res.status <= 308 && location && (o.hop ?? 0) < 1) {
      const target = new URL(location, `${this.url}${path}`);
      const base = target.href.replace(/\/api\/.*$|\/render\/.*$/, "");
      if (base !== this.url) {
        if (!warned.has(this.url)) { warned.add(this.url); console.error(`[grafana] ${this.url} redirects to ${base}; set that as the URL`); }
        this.url = base;
      }
      return this.request(method, path, body, { ...o, hop: (o.hop ?? 0) + 1 });
    }
    if (res.status === 401) throw new GrafanaError("Grafana rejected the token", `Make a new service account token (Administration › Service accounts) and set it under ${SETTINGS_HINT}`, 401);
    if (res.status === 403) throw new GrafanaError("The token may not do that", "Give the service account the Editor role for silences and stars; Viewer reads everything else", 403);
    if (!res.ok) {
      const text = await res.text();
      let message = text.slice(0, 300);
      try { message = String((JSON.parse(text) as { message?: string }).message ?? message); } catch { /* not JSON */ }
      throw new GrafanaError(`Grafana answered ${res.status} for ${method} ${path.split("?")[0]}`, message || res.statusText, res.status, text);
    }
    if (o.raw) return new Uint8Array(await res.arrayBuffer()) as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : null) as T;
  }

  /** Every dashboard the token can see, with its folder; Grafana caps `limit` at 5000. */
  dashboards() { return this.request<Dashboard[]>("GET", "/api/search?type=dash-db&limit=5000"); }
  folders() { return this.request<Folder[]>("GET", "/api/folders?limit=1000"); }
  dashboard(uid: string) { return this.request<DashboardJson>("GET", `/api/dashboards/uid/${encodeURIComponent(uid)}`); }
  /** Stars are the token's user's: the service account's own list, which `isStarred` in `dashboards()` reads back. */
  star(uid: string) { return this.request<null>("POST", `/api/user/stars/dashboard/uid/${encodeURIComponent(uid)}`); }
  unstar(uid: string) { return this.request<null>("DELETE", `/api/user/stars/dashboard/uid/${encodeURIComponent(uid)}`); }
  /** The rules in those states, each with only the instances in them (`totalsFiltered`); the Prometheus-compatible ruler API, which carries the rule uid and the folder. */
  rules(states: ("firing" | "pending")[] = ["firing", "pending"]) {
    return this.request<{ data: { groups: RuleGroup[] } }>("GET", `/api/prometheus/grafana/api/v1/rules?${states.map((s) => `state=${s}`).join("&")}`).then((r) => r.data.groups);
  }
  /** What the Alertmanager holds: firing instances with their silence status. */
  amAlerts() { return this.request<AmAlert[]>("GET", "/api/alertmanager/grafana/api/v2/alerts"); }
  silences() { return this.request<Silence[]>("GET", "/api/alertmanager/grafana/api/v2/silences"); }
  /** Creates one; the answer carries the id. */
  silence(matchers: Matcher[], startsAt: string, endsAt: string, comment: string) {
    return this.request<{ silenceID: string }>("POST", "/api/alertmanager/grafana/api/v2/silences", { matchers, startsAt, endsAt, createdBy: "pal", comment }).then((r) => r.silenceID);
  }
  expire(id: string) { return this.request<null>("DELETE", `/api/alertmanager/grafana/api/v2/silence/${encodeURIComponent(id)}`); }
  datasources() { return this.request<Datasource[]>("GET", "/api/datasources"); }
  /** Runs the queries in one call; `from`/`to` are Grafana's (`now-6h`, or epoch ms as a string). */
  async query(queries: Record<string, unknown>[], from = "now-5m", to = "now", signal?: AbortSignal): Promise<QueryResults> {
    try { return await this.request<QueryResults>("POST", "/api/ds/query", { queries, from, to }, { signal }); } catch (e) {
      // A refused expression is a 400 whose body still carries the results, the error inside them: an answer, not a failure.
      if (e instanceof GrafanaError && e.status === 400 && e.body?.includes('"results"')) return JSON.parse(e.body) as QueryResults;
      throw e;
    }
  }
  /** Whether the image renderer plugin is installed: its settings answer, else a 404. */
  async renderer(): Promise<boolean> {
    try { await this.request("GET", "/api/plugins/grafana-image-renderer/settings"); return true; } catch (e) {
      if (e instanceof GrafanaError && e.status === 404) return false;
      throw e;
    }
  }
  /** One panel as a PNG through the renderer plugin; `width` and `height` in CSS px. */
  render(uid: string, panelId: number, o: { width: number; height: number; theme: string; from: string; to: string }): Promise<Uint8Array> {
    const q = new URLSearchParams({ panelId: String(panelId), width: String(o.width), height: String(o.height), theme: o.theme, from: o.from, to: o.to });
    return this.request<Uint8Array>("GET", `/render/d-solo/${encodeURIComponent(uid)}?${q}`, undefined, { raw: true });
  }
}

// ---- URLs -----------------------------------------------------------------

/** A dashboard's page, with the time range and kiosk flag when asked. Grafana redirects a bare `/d/<uid>` to the slugged URL, so a uid alone works too. */
export function dashboardUrl(base: string, d: { uid: string; url?: string }, o: { from?: string; to?: string; kiosk?: boolean } = {}): string {
  const parts: string[] = [];
  if (o.from) parts.push(`from=${encodeURIComponent(o.from)}`, `to=${encodeURIComponent(o.to || "now")}`);
  if (o.kiosk) parts.push("kiosk");
  return `${base}${d.url ?? `/d/${encodeURIComponent(d.uid)}`}${parts.length ? `?${parts.join("&")}` : ""}`;
}
export const ruleUrl = (base: string, uid: string) => `${base}/alerting/grafana/${encodeURIComponent(uid)}/view`;
export const silenceUrl = (base: string, id: string) => `${base}/alerting/silence/${encodeURIComponent(id)}/edit`;
export const alertsUrl = (base: string) => `${base}/alerting/list?view=state`;
/** Explore with the expression typed, on that datasource (Grafana 10's `panes` URL). */
export function exploreUrl(base: string, dsUid: string, expr: string, range = "now-1h"): string {
  const panes = JSON.stringify({ pal: { datasource: dsUid, queries: [{ refId: "A", expr, datasource: { type: "prometheus", uid: dsUid } }], range: { from: range, to: "now" } } });
  return `${base}/explore?schemaVersion=1&panes=${encodeURIComponent(panes)}&orgId=1`;
}

// ---- alerts ---------------------------------------------------------------

/** A short stable hash (FNV-1a, 32 bit) for an instance id. */
export function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}

/** Labels without Grafana's own (`__name__`, `__alert_rule_uid__`), sorted, as one line: the key two lists are matched on. */
export const labelsKey = (labels: Record<string, string>) => Object.entries(labels).filter(([k]) => !k.startsWith("__")).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join(",");
/** The labels that distinguish an instance: without the rule's name, the folder and Grafana's own. */
export const ownLabels = (labels: Record<string, string>) => Object.fromEntries(Object.entries(labels).filter(([k]) => !k.startsWith("__") && k !== "alertname" && k !== "grafana_folder"));
/** `host=archer, entity=sensor.x`: the own labels on one line. */
export const labelsLine = (labels: Record<string, string>) => Object.entries(ownLabels(labels)).map(([k, v]) => `${k}=${v}`).join(", ");

/**
 * The instances of the rules in `groups` that are firing or pending, in
 * one flat list: firing first, then by rule name and labels. `am` marks
 * the ones a silence covers (the Alertmanager knows firing instances by
 * their labels; pending ones are not there yet). `base` builds the
 * dashboard link out of the annotations.
 */
export function instances(groups: RuleGroup[], am: AmAlert[], base: string, folders: Record<string, string> = {}): AlertInstance[] {
  const silenced = new Map<string, string[]>();
  for (const a of am) if (a.status?.silencedBy?.length) silenced.set(labelsKey(a.labels), a.status.silencedBy);
  const out: AlertInstance[] = [];
  for (const g of groups) {
    for (const r of g.rules) {
      const ruleUid = r.uid ?? r.name;
      for (const a of r.alerts ?? []) {
        const state = a.state === "Alerting" ? "firing" : a.state === "Pending" ? "pending" : undefined;
        if (!state) continue;
        const ann = { ...r.annotations, ...a.annotations };
        const dash = ann.__dashboardUid__ ? `${base}/d/${ann.__dashboardUid__}${ann.__panelId__ ? `?viewPanel=${ann.__panelId__}` : ""}` : ann.view_url;
        out.push({
          id: `${ruleUid}:${fnv(labelsKey(a.labels))}`,
          rule: r.name,
          ruleUid,
          folder: a.labels.grafana_folder ?? folders[r.folderUid ?? g.folderUid ?? ""] ?? g.file ?? "",
          state,
          since: a.activeAt,
          labels: a.labels,
          summary: ann.summary?.trim() || undefined,
          description: ann.description?.trim() || undefined,
          dashboardUrl: dash,
          severity: a.labels.severity ?? r.labels?.severity,
          value: a.value,
          health: r.health && r.health !== "ok" ? `${r.health}${r.lastError ? `: ${r.lastError}` : ann.Error ? `: ${ann.Error}` : ""}` : undefined,
          silencedBy: silenced.get(labelsKey(a.labels)) ?? [],
        });
      }
    }
  }
  const order = (x: AlertInstance) => (x.state === "firing" ? 0 : 1);
  return out.sort((a, b) => order(a) - order(b) || a.rule.localeCompare(b.rule) || labelsKey(a.labels).localeCompare(labelsKey(b.labels)));
}

/** The matchers that silence exactly this instance: the rule by uid, then every label of its own. */
export const silenceMatchers = (a: AlertInstance): Matcher[] => [
  { name: "__alert_rule_uid__", value: a.ruleUid, isEqual: true, isRegex: false },
  ...Object.entries(ownLabels(a.labels)).map(([name, value]) => ({ name, value, isEqual: true, isRegex: false })),
];

/** `alertname=HA battery low, host=archer`: a silence's matchers on one line, `!=` and `=~` spelled as Grafana does. */
export const matchersLine = (m: Matcher[]) => m.map((x) => `${x.name}${x.isEqual ? (x.isRegex ? "=~" : "=") : (x.isRegex ? "!~" : "!=")}${x.value}`).join(", ");

/** The silence durations offered, in seconds, with the word the action and the comment use. */
export const DURATIONS: Record<string, { seconds: number; title: string }> = { "1h": { seconds: 3600, title: "1 hour" }, "4h": { seconds: 4 * 3600, title: "4 hours" }, "1d": { seconds: 86400, title: "1 day" } };

// ---- queries --------------------------------------------------------------

/** `Name = expr` lines of the `queries` setting; the first ` = ` that is not part of `==`, `!=`, `=~`, `<=`, `>=` splits (PromQL spells its operators without spaces around `=`). */
export function savedQueries(lines: string[]): { name: string; expr: string }[] {
  const out: { name: string; expr: string }[] = [];
  for (const line of lines) {
    const m = /^(.*?[^!=<>~])\s=\s(?![=~])(.+)$/.exec(line.trim());
    if (!m) continue;
    const name = m[1].trim(), expr = m[2].trim();
    if (name && expr) out.push({ name, expr });
  }
  return out;
}

/** The series of one result: one per numeric field of every frame, the display name Grafana would show, the last value and the points. */
export function seriesOf(results: QueryResults, refId = "A"): Series[] {
  const r = results.results?.[refId];
  if (!r) return [];
  if (r.error) throw new QueryError(r.error.replace(/^\[.*?\]\s*/, "").replace(/^\w+:\s*invalid parameter "query":\s*/, ""));
  const out: Series[] = [];
  for (const f of r.frames ?? []) {
    const fields = f.schema?.fields ?? [];
    const ti = fields.findIndex((x) => x.type === "time");
    const times = ti >= 0 ? (f.data.values[ti] as number[]) : [];
    fields.forEach((field, i) => {
      if (field.type !== "number") return;
      const vals = (f.data.values[i] ?? []) as (number | null)[];
      const points: [number, number][] = [];
      vals.forEach((v, j) => { if (typeof v === "number" && Number.isFinite(v)) points.push([times[j] ?? j, v]); });
      const last = points.length ? points[points.length - 1] : undefined;
      const labels = field.labels ?? {};
      out.push({ name: field.config?.displayNameFromDS ?? field.config?.displayName ?? metricName(labels, field.name), labels, value: last?.[1] ?? null, time: last?.[0], points });
    });
  }
  return out;
}

/** `up{host="archer", job="node"}` out of labels; the field's name (`Value`) when there are none. */
export function metricName(labels: Record<string, string>, fallback = "Value"): string {
  const name = labels.__name__ ?? "";
  const rest = Object.entries(labels).filter(([k]) => k !== "__name__").map(([k, v]) => `${k}="${v}"`).join(", ");
  return rest ? `${name}{${rest}}` : name || fallback;
}

/** A value written short: integers as they are, two decimals past 1, three significant under it, an exponent past 1e15. */
export function fmt(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "no data";
  if (!Number.isFinite(v)) return v > 0 ? "+Inf" : "-Inf";
  if (Number.isInteger(v)) return Math.abs(v) >= 1e15 ? v.toExponential(2) : String(v);
  const a = Math.abs(v);
  if (a >= 1000) return v.toFixed(0);
  if (a >= 1) return v.toFixed(2).replace(/\.?0+$/, "");
  return v.toPrecision(3).replace(/\.?0+$/, "");
}

/** A value in a panel's unit, for the few units a sparkline caption can say without Grafana's tables. */
export function withUnit(v: number | null | undefined, unit?: string): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return fmt(v);
  switch (unit) {
    case "percent": return `${fmt(v)}%`;
    case "percentunit": return `${fmt(v * 100)}%`;
    case "bytes": case "decbytes": return bytes(v);
    case "watt": return `${fmt(v)} W`;
    case "celsius": return `${fmt(v)} °C`;
    case "s": return v >= 3600 ? `${fmt(v / 3600)} h` : v >= 60 ? `${fmt(v / 60)} min` : `${fmt(v)} s`;
    case "ms": return `${fmt(v)} ms`;
    case "Bps": case "binBps": return `${bytes(v)}/s`;
    case "bps": return `${fmt(v)} b/s`;
    default: return fmt(v);
  }
}

/** A dashboard's own panels flattened, rows' children included, in reading order. */
export function flatPanels(panels: Panel[] = []): Panel[] {
  return panels.flatMap((p) => (p.type === "row" ? flatPanels(p.panels) : [p]));
}

/** Whether an expression can run outside its dashboard: no template variable but Grafana's own `$__` macros. */
export const standalone = (expr: string) => !/\$(?!__)\w|\$\{(?!__)/.test(expr);

/** The datasource uid a panel or target names; `undefined` for the default, `null` for a templated one (`${DS}`) the pane cannot resolve. */
export function dsUid(ds: Panel["datasource"] | Target["datasource"]): string | null | undefined {
  const uid = typeof ds === "string" ? ds : ds?.uid;
  if (!uid) return undefined;
  return uid.startsWith("$") ? null : uid;
}

const UNIT: Record<string, number> = { s: 1000, m: 60_000, h: 3600_000, d: 86400_000, w: 7 * 86400_000, M: 30 * 86400_000, y: 365 * 86400_000 };

/** The span of a Grafana range in ms (`now-6h` to `now`, two dates, epoch ms); six hours when it cannot be read (`now/d` and friends). */
export function spanMs(from: string, to = "now", ref = Date.now()): number {
  const at = (s: string): number | undefined => {
    const t = s.trim();
    if (t === "now") return ref;
    const m = /^now-(\d+)([smhdwMy])$/.exec(t);
    if (m) return ref - Number(m[1]) * UNIT[m[2]];
    const ms = /^\d{10,}$/.test(t) ? Number(t) : Date.parse(t);
    return Number.isFinite(ms) ? ms : undefined;
  };
  const a = at(from), b = at(to);
  return a !== undefined && b !== undefined && b > a ? b - a : 6 * UNIT.h;
}

/** A relative range (`now-6h`) or an absolute date as Grafana's `from`: the date as epoch ms, anything else as written. */
export function timeParam(s: string): string {
  const t = s.trim();
  if (!t || t === "now" || t.startsWith("now")) return t;
  const ms = Date.parse(t);
  return Number.isFinite(ms) ? String(ms) : t;
}
