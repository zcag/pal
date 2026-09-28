// Writes app/src/gallery/shots/grafana.json and bar-grafana.json, the store
// screenshots' fixtures: the three palettes, the panes and the alerts
// popover drawn through the host harness against a made-up Grafana served
// here (an online shop's production stack: its dashboards, six hours of
// panel data, two alerts firing, two pending, one silenced; nothing is the
// owner's, the tests' grafana-mock.ts carries a real fleet's names).
// `make shots EXT=grafana`.
import { NOW, pinClock, seeded, settle, writeFixture } from "../../app/scripts/fixture-kit.ts";
import { Host } from "../../host/test/harness.ts";
import type { Item } from "../../sdk/src/protocol.ts";
import manifest from "./pal.json" with { type: "json" };

pinClock();
const TOKEN = "glsa_fixture";
const iso = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();

// ---- the made-up Grafana ---------------------------------------------------------

type Dash = { uid: string; title: string; folder?: [string, string]; tags: string[]; description?: string; starred?: boolean; panels: [string, string, string][] };
/** Every dashboard: its folder (uid, title), tags, and the time series panels the pane draws, as [title, unit, expr]. */
const DASHES: Dash[] = [
  { uid: "svc-overview", title: "Service Overview", folder: ["prod", "Production"], tags: ["slo", "golden-signals"], starred: true, description: "Traffic, errors and latency for every public service",
    panels: [["Requests / s", "reqps", "sum(rate(http_requests_total[5m]))"], ["p95 latency", "ms", "histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket[5m]))) * 1000"], ["5xx ratio", "percent", "100 * sum(rate(http_requests_total{code=~\"5..\"}[5m])) / sum(rate(http_requests_total[5m]))"]] },
  { uid: "checkout", title: "Checkout API", folder: ["prod", "Production"], tags: ["api", "payments"], starred: true, description: "Orders placed, payment provider latency, error budget",
    panels: [["Orders / min", "", "sum(rate(orders_created_total[5m])) * 60"], ["Provider latency", "ms", "payment_provider_latency_ms"], ["Error budget left", "percent", "slo_error_budget_remaining{service=\"checkout\"}"]] },
  { uid: "k8s-cluster", title: "Kubernetes Cluster", folder: ["platform", "Platform"], tags: ["k8s", "capacity"], description: "Node pressure, pod restarts and requests against capacity",
    panels: [["CPU requested", "percent", "cluster:cpu_requested:ratio * 100"], ["Pod restarts", "", "sum(increase(kube_pod_container_status_restarts_total[15m]))"]] },
  { uid: "postgres", title: "Postgres", folder: ["data", "Databases"], tags: ["postgres", "storage"], description: "Connections, replication lag and disk on the primary and replicas",
    panels: [["Connections", "", "sum(pg_stat_activity_count)"], ["Replication lag", "s", "max(pg_replication_lag_seconds)"], ["Disk used", "percent", "pg_disk_used_percent"]] },
  { uid: "ingest", title: "Ingest Pipeline", folder: ["prod", "Production"], tags: ["kafka", "events"], description: "Events in, consumer lag per group, dead letters",
    panels: [["Events / s", "", "sum(rate(ingest_events_total[5m]))"], ["Consumer lag", "", "sum(kafka_consumergroup_lag)"]] },
  { uid: "node-exporter", title: "Node Exporter Full", folder: ["platform", "Platform"], tags: ["linux", "hosts"],
    panels: [["Load", "", "avg(node_load1)"], ["Memory used", "percent", "100 * (1 - avg(node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes))"]] },
  { uid: "edge", title: "CDN & Edge", folder: ["prod", "Production"], tags: ["cdn", "tls"], description: "Cache hit ratio, bandwidth and certificate expiry at the edge",
    panels: [["Cache hit ratio", "percent", "edge_cache_hit_ratio * 100"], ["Egress", "Bps", "sum(rate(edge_bytes_sent_total[5m]))"]] },
  { uid: "synthetics", title: "Synthetic Checks", folder: ["prod", "Production"], tags: ["uptime"], description: "Login, search and checkout probed every minute from three regions",
    panels: [["Probe success", "percent", "avg(probe_success) * 100"]] },
  { uid: "home", title: "Team Home", tags: ["start"], description: "Links to the runbooks, the on-call rota and the release calendar", panels: [] },
];

/** Six hours of a panel's series, a point every six minutes: a daily shape, a little noise, the afternoon's error spike on checkout. */
const T0 = NOW - 6 * 3600_000, STEP = 6 * 60_000, N = 61;
function curve(expr: string): { labels: Record<string, string>; points: [number, number][] }[] {
  const r = seeded([...expr].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7));
  const line = (f: (i: number) => number, labels: Record<string, string> = {}) => ({ labels, points: Array.from({ length: N }, (_, i): [number, number] => [T0 + i * STEP, Math.round(f(i) * 100) / 100]) });
  const day = (i: number) => Math.sin((i / N) * Math.PI * 0.9 + 0.3);
  const noise = (a: number) => (r() - 0.5) * a;
  const spike = (i: number) => (i > 48 ? (i - 48) * 0.25 : 0);
  if (expr.includes("code=~")) return [line((i) => 0.4 + noise(0.15) + spike(i))];
  if (expr.includes("http_requests_total")) return [line((i) => 1850 + 900 * day(i) + noise(120))];
  if (expr.includes("duration_seconds")) return [line((i) => 180 + 60 * day(i) + noise(25) + spike(i) * 76)];
  if (expr.includes("orders_created")) return [line((i) => 140 + 70 * day(i) + noise(18))];
  if (expr.includes("payment_provider")) return [line((i) => 220 + noise(40) + spike(i) * 60, { provider: "primary" }), line(() => 160 + noise(20), { provider: "fallback" })];
  if (expr.includes("error_budget")) return [line((i) => 71 - i * 0.05 - spike(i) * 0.8)];
  if (expr.includes("cpu_requested")) return [line((i) => 62 + 8 * day(i) + noise(3))];
  if (expr.includes("restarts")) return [line(() => Math.max(0, Math.round(noise(5))))];
  if (expr.includes("pg_stat_activity")) return [line((i) => 180 + 60 * day(i) + noise(14))];
  if (expr.includes("replication_lag")) return [line(() => 0.4 + Math.abs(noise(0.6)))];
  if (expr.includes("pg_disk")) return [line((i) => 86.5 + i * 0.075)];
  if (expr.includes("ingest_events")) return [line((i) => 5200 + 1600 * day(i) + noise(300))];
  if (expr.includes("consumergroup_lag")) return [line((i) => 900 + (i > 40 ? (i - 40) * 520 : 0) + noise(200))];
  if (expr.includes("node_load1")) return [line((i) => 2.1 + day(i) + noise(0.4))];
  if (expr.includes("MemAvailable")) return [line((i) => 58 + 6 * day(i) + noise(2))];
  if (expr.includes("cache_hit")) return [line(() => 94 + noise(1.5))];
  if (expr.includes("edge_bytes")) return [line((i) => 3.1e8 + 1.2e8 * day(i) + noise(2e7))];
  if (expr.includes("probe_success")) return [line(() => 100 - Math.abs(noise(0.8)))];
  return [];
}

/** The query prompt's instant answer for `node_load1`: one series per host. */
const LOAD: [string, number][] = [["web-01", 2.84], ["web-02", 2.61], ["web-03", 3.07], ["api-01", 4.12], ["api-02", 3.95], ["db-01", 1.38], ["db-02", 1.12], ["ingest-01", 5.46]];

type Inst = { rule: string; uid: string; state: "Alerting" | "Pending"; minutes: number; value: string; labels: Record<string, string>; summary: string; description: string; dash?: [string, number] };
const ALERTS: Inst[] = [
  { rule: "Checkout 5xx above 2%", uid: "checkout-5xx", state: "Alerting", minutes: 14, value: "3.4", labels: { severity: "critical", service: "checkout", env: "prod" }, summary: "checkout is failing 3.4% of requests", description: "The payment provider started timing out at 14:15; the fallback is taking the retries.", dash: ["checkout", 2] },
  { rule: "Disk above 90%", uid: "disk-full", state: "Alerting", minutes: 52, value: "91.2", labels: { severity: "warning", instance: "db-02", mountpoint: "/var/lib/postgresql" }, summary: "db-02 /var/lib/postgresql at 91%", description: "Grows about 1% an hour since the nightly vacuum was skipped.", dash: ["postgres", 3] },
  { rule: "TLS certificate expiring", uid: "tls-expiry", state: "Alerting", minutes: 60 * 26, value: "6", labels: { severity: "warning", domain: "static.shop.example" }, summary: "static.shop.example expires in 6 days", description: "Renewal is scheduled with the CDN change on Friday.", dash: ["edge", 1] },
  { rule: "Consumer lag growing", uid: "ingest-lag", state: "Pending", minutes: 3, value: "11840", labels: { severity: "warning", group: "orders-enricher" }, summary: "orders-enricher is 11,840 events behind", description: "Lag has grown for 10 minutes; fires after 15.", dash: ["ingest", 2] },
  { rule: "p95 latency above 400 ms", uid: "latency-p95", state: "Pending", minutes: 2, value: "412", labels: { severity: "warning", service: "checkout", env: "prod" }, summary: "checkout p95 at 412 ms", description: "Over 400 ms for 2 of the 5 minutes it waits.", dash: ["svc-overview", 2] },
];
/** The one silence: the certificate, until Friday's renewal. */
const SILENCE = { id: "8c1f3a2e", matchers: [{ name: "__alert_rule_uid__", value: "tls-expiry", isEqual: true, isRegex: false }, { name: "domain", value: "static.shop.example", isEqual: true, isRegex: false }], startsAt: iso(60 * 25), endsAt: new Date(NOW + 2 * 86400_000).toISOString(), createdBy: "maya.k", comment: "Renewed with the CDN change on Friday", status: { state: "active" } };
/** Only what is pending, for the strip's amber state (the firing ones resolved). */
let pendingOnly = false;
const live = () => ALERTS.filter((a) => !pendingOnly || a.state === "Pending");
const labelsOf = (a: Inst) => ({ alertname: a.rule, grafana_folder: "Production", ...a.labels });
const labelsKey = (l: Record<string, string>) => Object.entries(l).filter(([k]) => !k.startsWith("__")).sort().map(([k, v]) => `${k}=${v}`).join(",");

const frame = (refId: string, labels: Record<string, string>, points: [number, number][], name?: string) => ({
  schema: { refId, fields: [{ name: "Time", type: "time" }, { name: labels.__name__ ?? "Value", type: "number", labels, config: { displayNameFromDS: name } }] },
  data: { values: [points.map((p) => p[0]), points.map((p) => p[1])] },
});

const server = Bun.serve({
  port: 0,
  async fetch(req) {
    if (req.headers.get("authorization") !== `Bearer ${TOKEN}`) return Response.json({ message: "Invalid API key" }, { status: 401 });
    const p = new URL(req.url).pathname;
    const slug = (d: Dash) => `/d/${d.uid}/${d.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-$/, "")}`;
    if (p === "/api/search") return Response.json(DASHES.map((d) => ({ uid: d.uid, title: d.title, url: slug(d), tags: d.tags, description: d.description ?? "", isStarred: !!d.starred, ...(d.folder && { folderUid: d.folder[0], folderTitle: d.folder[1] }) })));
    const dash = p.match(/^\/api\/dashboards\/uid\/(.+)$/);
    if (dash) {
      const d = DASHES.find((x) => x.uid === dash[1]);
      if (!d) return Response.json({ message: "Dashboard not found" }, { status: 404 });
      const panels = [{ id: 1, type: "stat", title: "Now", targets: [] }, ...d.panels.map(([title, unit, expr], i) => ({ id: i + 2, type: "timeseries", title, datasource: { type: "prometheus", uid: "prom" }, fieldConfig: { defaults: { unit } }, targets: [{ refId: "A", expr }] })), { id: 20, type: "text", title: "Runbook" }];
      return Response.json({ meta: { url: slug(d), folderTitle: d.folder?.[1], folderUid: d.folder?.[0], isStarred: !!d.starred }, dashboard: { uid: d.uid, title: d.title, description: d.description, tags: d.tags, time: { from: "now-6h", to: "now" }, refresh: "1m", panels } });
    }
    if (p === "/api/prometheus/grafana/api/v1/rules") {
      const rules = live().map((a) => ({ name: a.rule, uid: a.uid, labels: { severity: a.labels.severity }, annotations: { description: a.description, ...(a.dash && { __dashboardUid__: a.dash[0], __panelId__: String(a.dash[1]) }) }, health: "ok", folderUid: "prod", state: a.state === "Alerting" ? "firing" : "pending", alerts: [{ state: a.state, activeAt: iso(a.minutes), value: a.value, labels: labelsOf(a), annotations: { summary: a.summary } }] }));
      return Response.json({ status: "success", data: { groups: [{ name: "production", file: "Production", folderUid: "prod", rules }] } });
    }
    if (p === "/api/alertmanager/grafana/api/v2/alerts") return Response.json(live().filter((a) => a.state === "Alerting").map((a) => {
      const labels = { ...labelsOf(a), __alert_rule_uid__: a.uid };
      const silenced = a.uid === "tls-expiry" ? [SILENCE.id] : [];
      return { labels, annotations: { summary: a.summary }, startsAt: iso(a.minutes), fingerprint: labelsKey(labels), status: { state: silenced.length ? "suppressed" : "active", silencedBy: silenced, inhibitedBy: [] } };
    }));
    if (p === "/api/alertmanager/grafana/api/v2/silences") return Response.json([SILENCE]);
    if (p === "/api/datasources") return Response.json([{ uid: "prom", name: "Prometheus", type: "prometheus", isDefault: true }, { uid: "loki", name: "Loki", type: "loki", isDefault: false }]);
    if (p === "/api/ds/query") {
      const { queries } = (await req.json()) as { queries: { refId: string; expr: string; instant?: boolean }[] };
      const results = Object.fromEntries(queries.map((q) => [q.refId, {
        status: 200,
        frames: q.instant && q.expr === "node_load1"
          ? LOAD.map(([h, v]) => frame(q.refId, { __name__: "node_load1", instance: `${h}:9100`, job: "node" }, [[NOW, v]], `node_load1{instance="${h}:9100", job="node"}`))
          : curve(q.expr).map((s) => frame(q.refId, s.labels, s.points)),
      }]));
      return Response.json({ results });
    }
    if (p === "/api/plugins/grafana-image-renderer/settings") return Response.json({ message: "Plugin not found" }, { status: 404 });
    return Response.json({ message: "not found" }, { status: 404 });
  },
});
const BASE = `http://127.0.0.1:${server.port}`;

/** The gallery's clock is the real one: a `date` accessory reads as text at the fixture's clock, as the row would have at 14:32. By a variable, so the host's typecheck does not follow it into the DOM code. */
const FORMAT = "../../app/src/ui/format.ts";
const { relativeDate } = (await import(FORMAT)) as { relativeDate: (d: string | number, now: number) => string };
const fixed = (rows: Item[]) => rows.map((r) => ({ ...r, accessories: r.accessories?.map((a) => ("date" in a && a.date !== undefined ? { text: relativeDate(a.date as string, NOW) } : a)) }));

const host = await Host.bundled({ settings: { grafana: { settings: { url: BASE, token: TOKEN, time_range: "now-6h" } } }, timeout: 20000 });
try {
  const meta = (name: string) => host.loaded().find((l) => l.extension === "grafana")!.palettes.find((p) => p.name === name)!;
  const pal = (name: string) => { const m = meta(name); return { title: m.title, icon: manifest.icon, placeholder: m.placeholder, filters: m.filters }; };
  const dashboards = await host.list("grafana", "grafana");
  const folders = await host.list("grafana", "grafana", "", { filter: "folders" });
  const dashDetails = Object.fromEntries(await Promise.all(dashboards.map(async (d) => [d.id, await host.detail("grafana", "grafana", d.id)])));
  const alerts = await host.list("grafana", "alerts");
  const silenced = await host.list("grafana", "alerts", "", { filter: "silenced" });
  const alertDetails = Object.fromEntries(await Promise.all(alerts.map(async (a) => [a.id, await host.detail("grafana", "alerts", a.id)])));
  const saved = await host.list("grafana", "query", "");
  const load = await host.list("grafana", "query", "node_load1");
  const range = await host.pick("grafana", "grafana", "svc-overview", "range");
  // The item as the strip gets it: the manifest's rules tint it (`firing` red, `pending` amber), which the core applies.
  const face = async (color: string) => {
    const { states: _s, empty: _e, ...item } = await host.render("grafana", "alerts", { reason: "show" });
    return { ...item, color };
  };
  const item = await face("red");
  pendingOnly = true;
  const pending = await face("amber");

  const hosts = { hosts: { [BASE]: "https://grafana.shop.example" } };
  const panel = await settle({
    palettes: {
      grafana: { ...pal("grafana"), items: dashboards, byFilter: { folders }, details: dashDetails },
      alerts: { ...pal("alerts"), live: true, items: fixed(alerts), byFilter: { silenced: fixed(silenced) }, details: alertDetails },
      query: { ...pal("query"), input: true, byQuery: { "": saved, node_load1: load } },
    },
    effects: { "grafana/svc-overview:range": range },
    shots: {
      "1-dashboards": { palette: "grafana", keys: ["cmd+i", "wait:500"], caption: "Every dashboard, starred first, its folder and tags on the right; the pane draws its first panels from their own queries" },
      "2-alerts": { palette: "alerts", keys: ["cmd+i", "wait:500"], caption: "What is firing and pending, by rule, with the summary and since when; the pane has the labels and the dashboard" },
      "3-silence": { palette: "alerts", keys: ["wait:400", "cmd+k", "wait:300"], caption: "Silence an instance for an hour, four or a day from the list, or jump to its dashboard" },
      "4-query": { palette: "query", keys: ["type:node_load1", "wait:600"], caption: "A PromQL prompt: one row per series with its value; Enter copies it, ⌘O opens Explore" },
      "5-range": { palette: "grafana", keys: ["wait:400", "cmd+enter", "wait:400", "cmd+a", "type:now-24h", "wait:200"], caption: "⌘Enter asks for the range to open a dashboard over, and whether in kiosk mode for a wall" },
    },
  }, hosts);
  writeFixture("grafana", panel);

  const bar = await settle({
    key: "grafana/alerts",
    title: manifest.bar.alerts.title,
    item,
    states: [{ id: "pending", item: pending }],
    shots: {
      "menubar": { target: "menubar", caption: "On the menu bar: the glyph red while something fires, then how many fire and how many are pending; hidden while all is quiet" },
      "menubar-pending": { target: "menubar", state: "pending", caption: "Only pending: the count in amber, before an alert's wait is up" },
      "popover": { target: "menubar", popover: true, caption: "A click opens the popover: firing then pending, each with its summary and age; s silences, o opens the dashboard" },
      "sketchybar": { target: "sketchybar", caption: "On sketchybar: the glyph and the two counts" },
    },
  }, hosts);
  writeFixture("bar-grafana", bar);
  console.log(`${dashboards.length} dashboards, ${alerts.length} alerts, ${load.length} series; bar ${JSON.stringify(item.segments?.map((s) => s.text))}`);
} finally {
  host.kill();
  server.stop(true);
}
