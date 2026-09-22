// A mock Grafana for the tests: the routes the extension reads and writes
// over fixture data (never the owner's): the dashboard search, one
// dashboard's JSON, stars, the ruler's rules, the Alertmanager's alerts
// and silences, the datasources, `/api/ds/query` answered by expression,
// and the image renderer behind a switch. `state` flips the failure
// modes; `seen` records every request.

export const TOKEN = "sa-token";
/** A token Grafana knows but that may not write (a Viewer): 403 on silences and stars. */
export const VIEWER = "viewer-token";

export const DASHBOARDS = [
  { uid: "home", title: "Home", url: "/d/home/home", tags: ["cagdas"], description: "The nav grid and the health snapshot" },
  { uid: "battery", title: "Battery & Power", url: "/d/battery/battery-and-power", tags: ["cagdas", "power", "hornet"], description: "" },
  { uid: "backups", title: "Backups", url: "/d/backups/backups", tags: ["backup", "cagdas"], folderUid: "infra", folderTitle: "Infra", description: "The fleet restic job" },
  { uid: "node", title: "Node Exporter Full", url: "/d/node/node-exporter-full", tags: ["linux"], folderUid: "infra", folderTitle: "Infra", description: "" },
];

const BATTERY = {
  uid: "battery", title: "Battery & Power", description: "Draw, charge and where it goes", tags: ["cagdas", "power", "hornet"], time: { from: "now-12h", to: "now" }, refresh: "30s",
  panels: [
    { id: 1, type: "row", title: "Now", panels: [] },
    { id: 2, type: "stat", title: "Charge", datasource: { type: "prometheus", uid: "prom" }, targets: [{ refId: "A", expr: "mac_battery_percent", instant: true }] },
    { id: 10, type: "timeseries", title: "Draw vs. presence", datasource: { type: "prometheus", uid: "prom" }, fieldConfig: { defaults: { unit: "watt" } }, targets: [{ refId: "A", expr: "mac_power_watts" }, { refId: "B", expr: "mac_power_idle_seconds > bool 300 * 5" }] },
    { id: 11, type: "timeseries", title: "Charge", datasource: { type: "prometheus", uid: "prom" }, fieldConfig: { defaults: { unit: "percent" } }, targets: [{ refId: "A", expr: "mac_battery_percent" }] },
    { id: 12, type: "timeseries", title: "Per host", datasource: { type: "prometheus", uid: "prom" }, targets: [{ refId: "A", expr: "mac_power_watts{host=\"$host\"}" }] },
    { id: 13, type: "row", title: "More", collapsed: true, panels: [{ id: 14, type: "timeseries", title: "Wakeups", targets: [{ refId: "A", expr: "rate(mac_power_wakeups[$__rate_interval])" }] }] },
    { id: 20, type: "text", title: "" },
  ],
};

type Instance = { state: string; activeAt?: string; value?: string; labels: Record<string, string>; annotations?: Record<string, string> };
type Rule = { name: string; uid: string; labels: Record<string, string>; annotations: Record<string, string>; health?: string; lastError?: string; instances: Instance[] };
const RULES: Rule[] = [
  { name: "HA battery low", uid: "alert-battery-low", labels: { severity: "warning" }, annotations: { description: "A device battery dropped below 20%.", summary: "{{ $labels.friendly_name }} at {{ $value }}%", view_url: "https://grafana.example.com/d/ha" }, instances: [
    { state: "Alerting", activeAt: "2026-09-16T23:37:50Z", value: "8", labels: { __name__: "ha_sensor_battery_percent", alertname: "HA battery low", grafana_folder: "alerts", entity: "sensor.front_door_battery", friendly_name: "Front door", host: "archer", severity: "warning" }, annotations: { summary: "Front door at 8%" } },
    { state: "Alerting", activeAt: "2026-09-20T10:00:00Z", value: "12", labels: { __name__: "ha_sensor_battery_percent", alertname: "HA battery low", grafana_folder: "alerts", entity: "sensor.keypad_battery", friendly_name: "Keypad", host: "archer", severity: "warning" }, annotations: { summary: "Keypad at 12%" } },
  ] },
  { name: "Disk > 87%", uid: "alert-disk", labels: { severity: "critical" }, annotations: { description: "A filesystem is nearly full.", __dashboardUid__: "node", __panelId__: "7" }, instances: [
    { state: "Pending", activeAt: "2026-09-21T22:50:00Z", value: "88.2", labels: { alertname: "Disk > 87%", grafana_folder: "alerts", host: "marko", mountpoint: "/", severity: "critical" }, annotations: { summary: "marko / at 88%" } },
  ] },
  { name: "Scrape target down", uid: "alert-scrape", labels: { severity: "critical" }, annotations: { description: "A target stopped answering." }, health: "error", lastError: "lookup prometheus: no such host", instances: [] },
  { name: "Quiet rule", uid: "alert-quiet", labels: {}, annotations: {}, instances: [{ state: "Normal", labels: { alertname: "Quiet rule", grafana_folder: "alerts" } }] },
];

export const DATASOURCES = [
  { uid: "loki", name: "Loki", type: "loki", isDefault: false },
  { uid: "prom", name: "Prometheus", type: "prometheus", isDefault: true },
  { uid: "prom-archive", name: "Prometheus Archive", type: "prometheus", isDefault: false },
];

/** A 1x1 PNG, what the renderer answers. */
export const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));

export type Silence = { id: string; matchers: { name: string; value: string; isEqual: boolean; isRegex: boolean }[]; startsAt: string; endsAt: string; createdBy: string; comment: string; status: { state: string } };

export const state = {
  starred: new Set<string>(),
  silences: [] as Silence[],
  /** The renderer plugin is installed. */
  renderer: false,
  /** Every request waits this long first. */
  delayMs: 0,
  nextSilence: 1,
};
export const seen: { method: string; path: string; body?: unknown }[] = [];
export const calls = (method: string, path: string) => seen.filter((r) => r.method === method && r.path === path);
export const reset = () => { seen.length = 0; state.starred.clear(); state.silences.length = 0; state.renderer = false; state.delayMs = 0; state.nextSilence = 1; };

const labelsKey = (l: Record<string, string>) => Object.entries(l).filter(([k]) => !k.startsWith("__")).sort().map(([k, v]) => `${k}=${v}`).join(",");
/** Which silences cover an instance: every matcher equal on its labels (plus the rule uid label the AM adds). */
const covering = (labels: Record<string, string>) => state.silences.filter((s) => s.status.state === "active" && s.matchers.every((m) => (labels[m.name] ?? "") === m.value));

/** A series' frame for `/api/ds/query`: `points` as [time, value] pairs. */
const frame = (refId: string, labels: Record<string, string>, points: [number, number][], name?: string) => ({
  schema: { refId, fields: [{ name: "Time", type: "time" }, { name: labels.__name__ ?? "Value", type: "number", labels, config: { displayNameFromDS: name } }] },
  data: { values: [points.map((p) => p[0]), points.map((p) => p[1])] },
});
const T0 = 1758500000000;
const ramp = (n: number, f: (i: number) => number): [number, number][] => Array.from({ length: n }, (_, i) => [T0 + i * 60_000, f(i)]);

/** What one query answers: by expression, instant or range. */
function answer(q: { refId: string; expr: string; instant?: boolean; range?: boolean }) {
  const { refId, expr } = q;
  if (expr === "up") return { status: 200, frames: [frame(refId, { __name__: "up", host: "archer", job: "node" }, [[T0, 1]], 'up{host="archer", job="node"}'), frame(refId, { __name__: "up", host: "marko", job: "node" }, [[T0, 0]], 'up{host="marko", job="node"}')] };
  if (expr === "up == 0") return { status: 200, frames: [{ schema: { refId, fields: [] }, data: { values: [] } }] };
  if (expr === "1+1") return { status: 200, frames: [frame(refId, {}, [[T0, 2]], "1+1")] };
  if (expr === "up{") return { status: 400, error: 'bad_data: invalid parameter "query": 1:4: parse error: unexpected end of input inside braces', frames: [] };
  if (expr === "mac_power_watts") return { status: 200, frames: [frame(refId, { __name__: "mac_power_watts", host: "hornet" }, ramp(30, (i) => 8 + Math.sin(i / 3) * 3))] };
  if (expr.startsWith("mac_power_idle")) return { status: 200, frames: [frame(refId, { host: "hornet" }, ramp(30, (i) => (i > 20 ? 5 : 0)))] };
  if (expr === "mac_battery_percent") return { status: 200, frames: [frame(refId, { __name__: "mac_battery_percent", host: "hornet" }, ramp(30, (i) => 100 - i))] };
  if (expr.startsWith("rate(mac_power_wakeups")) return { status: 200, frames: [frame(refId, { host: "hornet" }, ramp(30, (i) => i % 7))] };
  return { status: 200, frames: [] };
}

export const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const u = new URL(req.url);
    const auth = req.headers.get("authorization");
    const body = req.method === "POST" ? await req.json().catch(() => undefined) : undefined;
    seen.push({ method: req.method, path: u.pathname + (u.search || ""), body });
    if (state.delayMs) await Bun.sleep(state.delayMs);
    if (auth !== `Bearer ${TOKEN}` && auth !== `Bearer ${VIEWER}`) return Response.json({ message: "Invalid API key" }, { status: 401 });
    const viewer = auth === `Bearer ${VIEWER}`;
    const p = u.pathname;
    if (p === "/api/search") return Response.json(DASHBOARDS.map((d) => ({ ...d, isStarred: state.starred.has(d.uid) })));
    const dash = p.match(/^\/api\/dashboards\/uid\/(.+)$/);
    if (dash) {
      const d = DASHBOARDS.find((x) => x.uid === dash[1]);
      if (!d) return Response.json({ message: "Dashboard not found" }, { status: 404 });
      return Response.json({ meta: { url: d.url, folderTitle: d.folderTitle, folderUid: d.folderUid, isStarred: state.starred.has(d.uid) }, dashboard: d.uid === "battery" ? BATTERY : { uid: d.uid, title: d.title, tags: d.tags, panels: [] } });
    }
    const star = p.match(/^\/api\/user\/stars\/dashboard\/uid\/(.+)$/);
    if (star) {
      if (viewer) return Response.json({ message: "You'll need additional permissions to perform this action" }, { status: 403 });
      if (req.method === "POST") state.starred.add(star[1]); else state.starred.delete(star[1]);
      return Response.json({ message: "ok" });
    }
    if (p === "/api/prometheus/grafana/api/v1/rules") {
      const states: string[] = u.searchParams.getAll("state").map((s) => (s === "firing" ? "Alerting" : s === "pending" ? "Pending" : "Normal"));
      const rules = RULES.map((r) => {
        const alerts = r.instances.filter((a) => states.includes(a.state));
        return { name: r.name, uid: r.uid, labels: r.labels, annotations: r.annotations, health: r.health ?? "ok", lastError: r.lastError, folderUid: "folder-1", state: alerts.some((a) => a.state === "Alerting") ? "firing" : alerts.some((a) => a.state === "Pending") ? "pending" : "inactive", alerts };
      }).filter((r) => r.alerts.length || !states.length);
      return Response.json({ status: "success", data: { groups: [{ name: "infra", file: "alerts", folderUid: "folder-1", rules }] } });
    }
    if (p === "/api/alertmanager/grafana/api/v2/alerts") {
      const out = RULES.flatMap((r) => r.instances.filter((a) => a.state === "Alerting").map((a) => {
        const labels = { ...a.labels, __alert_rule_uid__: r.uid };
        const s = covering(labels);
        return { labels, annotations: a.annotations, startsAt: a.activeAt, fingerprint: labelsKey(labels), status: { state: s.length ? "suppressed" : "active", silencedBy: s.map((x) => x.id), inhibitedBy: [] } };
      }));
      return Response.json(out);
    }
    if (p === "/api/alertmanager/grafana/api/v2/silences") {
      if (req.method === "POST") {
        if (viewer) return Response.json({ message: "permission denied" }, { status: 403 });
        const b = body as Omit<Silence, "id" | "status">;
        const id = `sil-${state.nextSilence++}`;
        state.silences.push({ ...b, id, status: { state: "active" } });
        return Response.json({ silenceID: id });
      }
      return Response.json(state.silences);
    }
    const sil = p.match(/^\/api\/alertmanager\/grafana\/api\/v2\/silence\/(.+)$/);
    if (sil && req.method === "DELETE") {
      if (viewer) return Response.json({ message: "permission denied" }, { status: 403 });
      const s = state.silences.find((x) => x.id === sil[1]);
      if (!s) return Response.json({ message: "silence not found" }, { status: 404 });
      s.status.state = "expired";
      return new Response(null, { status: 200 });
    }
    if (p === "/api/datasources") return Response.json(DATASOURCES);
    if (p === "/api/ds/query") {
      const queries = (body as { queries: { refId: string; expr: string; instant?: boolean; range?: boolean }[] }).queries;
      const results = Object.fromEntries(queries.map((q) => [q.refId, answer(q)]));
      const bad = Object.values(results).some((r) => r.status === 400);
      return Response.json({ results }, { status: bad ? 400 : 200 });
    }
    if (p === "/api/plugins/grafana-image-renderer/settings") return state.renderer ? Response.json({ enabled: true }) : Response.json({ message: "Plugin not found, no installed plugin with that id" }, { status: 404 });
    if (p.startsWith("/render/d-solo/")) return state.renderer ? new Response(PNG, { headers: { "content-type": "image/png" } }) : new Response("no renderer", { status: 500 });
    return Response.json({ message: "not found" }, { status: 404 });
  },
});

export const BASE = `http://127.0.0.1:${server.port}`;
export const SETTINGS = { url: BASE, token: TOKEN, timeout: 2 };
