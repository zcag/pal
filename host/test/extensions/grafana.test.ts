// Grafana: the pure helpers (api.ts, spark.ts, view.ts) by import, then
// the extension over the wire against grafana-mock.ts (a Bun server
// standing in for Grafana): the dashboard rows, filters, the folder
// drill-in, the time-range form, stars; the pane with sparklines and,
// with the renderer switched on, panel images; the alert rows, filters,
// the pane, silences created and expired; the query prompt, its errors,
// the saved queries and their writes; the bar item, its popover and keys;
// the links; and the hint rows for an unset URL, a bad token, a Viewer
// token asked to write, a dead host and a slow one.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { checkView } from "../../../sdk/src/index.ts";
import type { Form, View, ViewNode } from "../../../sdk/src/protocol.ts";
import { QueryError, dashboardUrl, exploreUrl, flatPanels, fmt, instances, labelsKey, matchersLine, savedQueries, seriesOf, silenceMatchers, spanMs, standalone, timeParam, unconfigured, withUnit, type AmAlert, type RuleGroup, type Settings } from "../../../extensions/grafana/api.ts";
import { sparkline } from "../../../extensions/grafana/spark.ts";
import { render as renderBar } from "../../../extensions/grafana/view.ts";
import { Host } from "../harness.ts";
import { BASE, SETTINGS, VIEWER, calls, reset, seen, server, state } from "./grafana-mock.ts";

const E = "grafana";
let host: Host;
beforeAll(async () => { host = await Host.bundled({ settings: { [E]: { settings: SETTINGS } } }); });
afterAll(() => { host.kill(); server.stop(true); });

const list = (palette: string, query?: string, ctx?: Parameters<Host["list"]>[3]) => host.list(E, palette, query, ctx);
const pick = (palette: string, id: string, action?: string, ctx?: Parameters<Host["pick"]>[4]) => host.pick(E, palette, id, action, ctx);
const ids = (items: { id: string }[]) => items.map((i) => i.id);
const texts = (n: ViewNode): string[] => (n.type === "text" ? [n.value] : n.type === "stack" ? n.children.flatMap(texts) : n.type === "badge" ? [`[${n.text}]`] : []);
const viewOf = (x: unknown): View => { const v = (x as { view?: View; menu?: { view?: View } }); const view = v.view ?? v.menu?.view; if (!view) throw new Error("no view"); return view; };
/** The settings back to the good ones, and the caches with them: the extension drops them on a settings change, and the host only tells it of one when the values differ, so the timeout alternates between two harmless values. */
let nonce = 0;
const restore = () => host.changeSettings(E, { settings: { ...SETTINGS, timeout: 2 + (++nonce % 2) } });

describe("api helpers", () => {
  const ok: Settings = { url: "http://g", token: "t", time_range: "", datasource: "", queries: [], sparklines: 3, timeout: 8 };
  test("unconfigured: no url, a url without a scheme, no token, an unresolved reference", () => {
    expect(unconfigured(ok)).toBeUndefined();
    expect(unconfigured({ ...ok, url: "" })?.message).toBe("Grafana is not set up");
    expect(unconfigured({ ...ok, url: "grafana.lan" })?.message).toMatch(/http/);
    expect(unconfigured({ ...ok, token: "" })?.message).toBe("Token is not set");
    expect(unconfigured({ ...ok, token: "env:GRAFANA_TOKEN" })?.hint).toMatch(/env:GRAFANA_TOKEN has no value/);
  });
  test("savedQueries splits on the first ` = ` outside an operator and skips lines without one", () => {
    expect(savedQueries(["Targets down = up == 0", "Bad = up{job=\"x\"} != 1", "  Spaced  =  a >= b ", "no equals here", " = expr", "Name = "])).toEqual([
      { name: "Targets down", expr: "up == 0" }, { name: "Bad", expr: "up{job=\"x\"} != 1" }, { name: "Spaced", expr: "a >= b" },
    ]);
  });
  test("seriesOf: a series per numeric field with Grafana's display name, the last value; a scalar; an empty frame; an error is a QueryError with the prefix cut", () => {
    const frames = [
      { schema: { refId: "A", fields: [{ name: "Time", type: "time" }, { name: "up", type: "number", labels: { __name__: "up", host: "a" }, config: { displayNameFromDS: 'up{host="a"}' } }] }, data: { values: [[1, 2, 3], [1, null, 0]] } },
      { schema: { refId: "A", fields: [{ name: "Time", type: "time" }, { name: "Value", type: "number", labels: {} }] }, data: { values: [[5], [2]] } },
      { schema: { refId: "A", fields: [] }, data: { values: [] } },
    ];
    const s = seriesOf({ results: { A: { status: 200, frames } } });
    expect(s.map((x) => [x.name, x.value, x.time, x.points.length])).toEqual([['up{host="a"}', 0, 3, 2], ["Value", 2, 5, 1]]);
    expect(s[0].labels).toEqual({ __name__: "up", host: "a" });
    expect(seriesOf({ results: {} })).toEqual([]);
    expect(() => seriesOf({ results: { A: { status: 400, error: 'bad_data: invalid parameter "query": 1:4: parse error: unexpected end of input inside braces' } } })).toThrow(QueryError);
    try { seriesOf({ results: { A: { error: "[sse.dataQueryError] failed to execute query [A]: boom" } } }); } catch (e) { expect((e as Error).message).toBe("failed to execute query [A]: boom"); }
  });
  test("instances: firing first then by rule and labels, stable ids, the summary rendered per instance, silences matched by labels, the dashboard from view_url or __dashboardUid__, the health when not ok", () => {
    const groups: RuleGroup[] = [{ name: "g", file: "alerts", rules: [
      { name: "Z", uid: "z", state: "pending", health: "ok", annotations: { summary: "z {{ $value }}", __dashboardUid__: "d1", __panelId__: "3" }, alerts: [{ state: "Pending", activeAt: "2026-09-21T00:00:00Z", labels: { alertname: "Z", grafana_folder: "alerts", host: "b" }, annotations: { summary: "z 5" } }] },
      { name: "A", uid: "a", state: "firing", health: "error", lastError: "no such host", labels: { severity: "warning" }, annotations: { view_url: "http://g/d/x" }, alerts: [
        { state: "Alerting", labels: { __name__: "m", alertname: "A", grafana_folder: "alerts", host: "b" } },
        { state: "Alerting", labels: { __name__: "m", alertname: "A", grafana_folder: "alerts", host: "a" } },
        { state: "Normal", labels: { alertname: "A", host: "c" } },
      ] },
    ] }];
    const am: AmAlert[] = [{ labels: { __alert_rule_uid__: "a", __name__: "m", alertname: "A", grafana_folder: "alerts", host: "b" }, status: { state: "suppressed", silencedBy: ["s1"] } }];
    const out = instances(groups, am, "http://g");
    expect(out.map((x) => [x.rule, x.state, x.labels.host, x.silencedBy])).toEqual([["A", "firing", "a", []], ["A", "firing", "b", ["s1"]], ["Z", "pending", "b", []]]);
    expect(out[0].id).toBe(`a:${out[0].id.split(":")[1]}`);
    expect(out[0].id).not.toBe(out[1].id);
    expect(instances(groups, am, "http://g")[1].id).toBe(out[1].id);
    expect(out[0]).toMatchObject({ severity: "warning", dashboardUrl: "http://g/d/x", health: "error: no such host", folder: "alerts" });
    expect(out[2]).toMatchObject({ summary: "z 5", dashboardUrl: "http://g/d/d1?viewPanel=3", since: "2026-09-21T00:00:00Z", health: undefined });
    expect(silenceMatchers(out[1])).toEqual([{ name: "__alert_rule_uid__", value: "a", isEqual: true, isRegex: false }, { name: "host", value: "b", isEqual: true, isRegex: false }]);
    expect(matchersLine([{ name: "a", value: "1", isEqual: true, isRegex: false }, { name: "b", value: "x.*", isEqual: false, isRegex: true }])).toBe("a=1, b!~x.*");
    expect(labelsKey({ __name__: "m", b: "2", a: "1" })).toBe("a=1,b=2");
  });
  test("urls: the dashboard with a range and kiosk, a bare uid, Explore with the expression", () => {
    expect(dashboardUrl("http://g", { uid: "x", url: "/d/x/slug" })).toBe("http://g/d/x/slug");
    expect(dashboardUrl("http://g", { uid: "x", url: "/d/x/slug" }, { from: "now-6h" })).toBe("http://g/d/x/slug?from=now-6h&to=now");
    expect(dashboardUrl("http://g", { uid: "x" }, { from: "1700000000000", to: "now", kiosk: true })).toBe("http://g/d/x?from=1700000000000&to=now&kiosk");
    expect(dashboardUrl("http://g", { uid: "x" }, { kiosk: true })).toBe("http://g/d/x?kiosk");
    const u = new URL(exploreUrl("http://g", "prom", "up == 0"));
    expect(u.pathname).toBe("/explore");
    expect(JSON.parse(u.searchParams.get("panes")!).pal.queries[0]).toEqual({ refId: "A", expr: "up == 0", datasource: { type: "prometheus", uid: "prom" } });
  });
  test("fmt and withUnit, spanMs, timeParam, standalone, flatPanels", () => {
    expect([fmt(1), fmt(73.256), fmt(0.001234), fmt(12345.6), fmt(null), fmt(2e16), fmt(Infinity), fmt(1.5)]).toEqual(["1", "73.26", "0.00123", "12346", "no data", "2.00e+16", "+Inf", "1.5"]);
    expect([withUnit(73.2, "percent"), withUnit(0.732, "percentunit"), withUnit(1536, "bytes"), withUnit(7.25, "watt"), withUnit(5400, "s"), withUnit(90, "s"), withUnit(3, undefined)]).toEqual(["73.2%", "73.2%", "1.5 KB", "7.25 W", "1.5 h", "1.5 min", "3"]);
    const ref = Date.parse("2026-09-22T00:00:00Z");
    expect(spanMs("now-6h", "now", ref)).toBe(6 * 3600_000);
    expect(spanMs("2026-09-21T00:00:00Z", "2026-09-22T00:00:00Z", ref)).toBe(86400_000);
    expect(spanMs(String(ref - 1000), String(ref), ref)).toBe(1000);
    expect(spanMs("now/d", "now", ref)).toBe(6 * 3600_000);
    expect([timeParam("now-1h"), timeParam(" now "), timeParam("2026-09-01T00:00:00Z"), timeParam("garbage")]).toEqual(["now-1h", "now", String(Date.parse("2026-09-01T00:00:00Z")), "garbage"]);
    expect([standalone("up"), standalone("rate(x[$__rate_interval])"), standalone("up{host=\"$host\"}"), standalone("up{host=\"${host}\"}")]).toEqual([true, true, false, false]);
    expect(flatPanels([{ id: 1, type: "row", panels: [{ id: 2, type: "stat" }] }, { id: 3, type: "timeseries" }]).map((p) => p.id)).toEqual([2, 3]);
  });
  test("sparkline: a data url with the title, the caption, a filled first series, the others faint, a single point as a dot", () => {
    const url = sparkline({ title: "Draw & <co>", caption: "7.2 W", series: [[[0, 1], [1, 3], [2, 2]], [[0, 2], [2, 2]], [[1, 1]]] });
    expect(url.startsWith("data:image/svg+xml;utf8,")).toBe(true);
    const svg = decodeURIComponent(url.slice(url.indexOf(",") + 1));
    expect(svg).toContain("Draw &amp; &lt;co&gt;");
    expect(svg).toContain(">7.2 W</text>");
    expect(svg.match(/<path /g)).toHaveLength(4);
    expect(svg).toContain('opacity="0.12"');
    expect(svg).toContain('opacity="0.45"');
    expect(svg).toContain("<circle ");
  });
  test("the popover tree: sections, a rail per state, the silenced badge, the title's counts, the hints, and checkView passes", () => {
    const rows = instances([{ name: "g", rules: [
      { name: "A", uid: "a", state: "firing", alerts: [{ state: "Alerting", activeAt: "2026-09-21T00:00:00Z", labels: { alertname: "A", host: "x", severity: "critical" }, annotations: { summary: "x down" } }, { state: "Alerting", labels: { alertname: "A", host: "y" } }] },
      { name: "B", uid: "b", state: "pending", alerts: [{ state: "Pending", labels: { alertname: "B" } }] },
    ] }], [{ labels: { alertname: "A", host: "y", __alert_rule_uid__: "a" }, status: { state: "suppressed", silencedBy: ["s"] } }], "http://g");
    const v = renderBar({ rows, focus: 1, now: Date.parse("2026-09-22T00:00:00Z"), account: "Home" });
    expect(() => checkView(v, "test")).not.toThrow();
    expect(v.title).toBe("1 firing, 1 pending, 1 silenced (Home)");
    expect(texts(v.tree)).toEqual(["Firing", "[2]", "A", "x down", "[critical]", "1d", "A", "host=y", "[silenced]", "", "Pending", "[1]", "B", "", "", "rule", "dashboard", "unsilence", "copy", "pal", "move"]);
    expect(v.actions.filter((a) => !a.hidden).map((a) => a.id)).toEqual(["open", "dashboard", "unsilence", "copy", "pal", "refresh", "site"]);
    expect(renderBar({ rows, focus: 0, now: 0 }).actions.filter((a) => !a.hidden).map((a) => [a.id, a.shortcut]).slice(2, 5)).toEqual([["silence:1h", "s"], ["silence:4h", "f"], ["silence:1d", "d"]]);
    const empty = renderBar({ rows: [], focus: 0, now: 0 });
    expect(empty.title).toBe("Grafana alerts");
    expect(texts(empty.tree)).toEqual(["All quiet", "No alert is firing or pending", "alert list", "pal", "refresh"]);
    expect(empty.actions.map((a) => a.id)).toEqual(["site", "pal", "refresh", "down", "up"]);
  });
});

describe("meta", () => {
  test("three palettes (dashboards indexed and lazy, alerts live, query input), the bar item with its rules and mocks, the settings, multi", () => {
    const l = host.loaded().find((x) => x.extension === E)!;
    expect(l.warnings).toEqual([]);
    expect(l.palettes.map((m) => [m.name, m.input, m.live, m.ttl, m.lazy, m.detail, m.filters?.map((f) => f.id)])).toEqual([
      ["grafana", false, false, 900, true, "lazy", ["all", "starred", "folders"]],
      ["alerts", false, true, 30, true, "lazy", ["all", "firing", "pending", "silenced"]],
      ["query", true, false, undefined, undefined, undefined, undefined],
    ]);
    expect(l.bar.map((b) => [b.id, b.source, b.refresh, Object.keys(b.mocks ?? {}), b.rules?.map((r) => r.id)])).toEqual([["alerts", true, { every: 60, on: ["show", "wake", "network"] }, ["firing", "mixed", "pending", "quiet"], ["quiet", "pending", "firing"]]]);
    const m = host.manifests.get(E)!;
    expect(m.multi).toBe(true);
    expect(m.settings!.map((s) => [s.id, s.kind, s.scope])).toEqual([["url", "text", "instance"], ["token", "secret", undefined], ["time_range", "text", undefined], ["datasource", "text", undefined], ["queries", "list", undefined], ["sparklines", "number", undefined], ["timeout", "number", undefined]]);
    expect(Object.keys(m.links!)).toEqual(["query", "open"]);
    expect(Object.keys(m.states!)).toEqual(["firing", "pending"]);
  });
});

describe("dashboards", () => {
  beforeEach(() => { reset(); restore(); });

  test("rows: starred first, the folder as a blue tag then two tags, the description or the folder as subtitle, the uid and tags as keywords", async () => {
    state.starred.add("node");
    const rows = await list("grafana");
    expect(ids(rows)).toEqual(["node", "home", "battery", "backups"]);
    expect(rows[0].icon).toEqual({ glyph: "\u{f04ce}", color: "amber" });
    expect(rows[0].actions!.find((a) => a.id === "star")!.title).toBe("Unstar");
    expect(rows[1]).toMatchObject({ name: "Home", subtitle: "The nav grid and the health snapshot", icon: "\u{f056e}", keywords: ["home", "cagdas", "General"], accessories: [{ tag: "General", color: "blue" }, { tag: "cagdas" }] });
    expect(rows[2].subtitle).toBe("General");
    expect(rows[3].accessories).toEqual([{ tag: "Infra", color: "blue" }, { tag: "backup" }, { tag: "cagdas" }]);
    expect(rows[1].actions!.map((a) => [a.id, a.shortcut])).toEqual([["open", undefined], ["range", "cmd+enter"], ["copy", "cmd+c"], ["star", "cmd+s"], ["kiosk", "cmd+f"], ["uid", "cmd+u"], ["folder", "right"]]);
    expect(calls("GET", "/api/search?type=dash-db&limit=5000")).toHaveLength(1);
  });

  test("filters: Starred (a hint while none), Folders with counts and a drill-in, the folder level from a row's right arrow", async () => {
    expect(ids(await list("grafana", "", { filter: "starred" }))).toEqual(["hint:none"]);
    state.starred.add("home");
    expect(ids(await list("grafana", "", { filter: "starred", refresh: true }))).toEqual(["home"]);
    const folders = await list("grafana", "", { filter: "folders" });
    expect(folders.map((f) => [f.id, f.name, f.subtitle])).toEqual([["folder:", "General", "2 dashboards"], ["folder:infra", "Infra", "2 dashboards"]]);
    expect(await pick("grafana", "folder:infra")).toEqual({ push: { extension: E, palette: "grafana", args: { folder: "infra" }, title: "Infra" } });
    expect(await pick("grafana", "folder:infra", "open")).toEqual({ open: `${BASE}/dashboards/f/infra/` });
    expect(await pick("grafana", "folder:", "open")).toEqual({ open: `${BASE}/dashboards` });
    expect(ids(await list("grafana", "", { args: { folder: "infra" } }))).toEqual(["backups", "node"]);
    expect(ids(await list("grafana", "", { args: { folder: "" } }))).toEqual(["home", "battery"]);
    expect(ids(await list("grafana", "", { args: { folder: "nope" } }))).toEqual(["hint:empty"]);
    expect(await pick("grafana", "backups", "folder")).toEqual({ push: { extension: E, palette: "grafana", args: { folder: "infra" }, title: "Infra" } });
  });

  test("picks: open (with the time_range setting when set), kiosk, copy, uid; the range form and its submit; an empty from comes back on the form", async () => {
    await list("grafana");
    expect(await pick("grafana", "home")).toEqual({ open: `${BASE}/d/home/home` });
    expect(await pick("grafana", "home", "kiosk")).toEqual({ open: `${BASE}/d/home/home?kiosk` });
    expect(await pick("grafana", "home", "copy")).toEqual({ copy: `${BASE}/d/home/home` });
    expect(await pick("grafana", "home", "uid")).toEqual({ copy: "home" });
    host.changeSettings(E, { settings: { ...SETTINGS, time_range: "now-24h" } });
    expect(await pick("grafana", "home")).toEqual({ open: `${BASE}/d/home/home?from=now-24h&to=now` });
    expect(await pick("grafana", "home", "kiosk")).toEqual({ open: `${BASE}/d/home/home?from=now-24h&to=now&kiosk` });
    const f = (await pick("grafana", "home", "range")).form as Form;
    expect(f).toMatchObject({ id: "home", title: "Open Home", submit: { id: "go", title: "Open" } });
    expect(f.fields.map((x) => [x.id, x.kind, (x as { default?: unknown }).default])).toEqual([["from", "text", "now-24h"], ["to", "text", "now"], ["kiosk", "checkbox", false]]);
    expect(await pick("grafana", "home", "go", { values: { from: "now-7d", to: "now", kiosk: true } })).toEqual({ open: `${BASE}/d/home/home?from=now-7d&to=now&kiosk` });
    expect(await pick("grafana", "home", "go", { values: { from: "2026-09-01T00:00:00Z", to: "", kiosk: false } })).toEqual({ open: `${BASE}/d/home/home?from=${Date.parse("2026-09-01T00:00:00Z")}&to=now` });
    expect(((await pick("grafana", "home", "go", { values: { from: " ", to: "now", kiosk: false } })).form as Form).errors).toEqual({ from: "Required" });
  });

  test("star and unstar go to the API, the list follows; a Viewer token gets a failure toast naming the role", async () => {
    await list("grafana");
    expect(await pick("grafana", "battery", "star")).toMatchObject({ keep: true, toast: { title: "Starred Battery & Power" } });
    expect(calls("POST", "/api/user/stars/dashboard/uid/battery")).toHaveLength(1);
    expect(ids(await list("grafana"))).toEqual(["battery", "home", "backups", "node"]);
    expect(await pick("grafana", "battery", "star")).toMatchObject({ toast: { title: "Unstarred Battery & Power" } });
    expect(calls("DELETE", "/api/user/stars/dashboard/uid/battery")).toHaveLength(1);
    expect(ids(await list("grafana"))).toEqual(["home", "battery", "backups", "node"]);
    host.changeSettings(E, { settings: { ...SETTINGS, token: VIEWER } });
    expect((await pick("grafana", "battery", "star")).toast).toMatchObject({ style: "failure", title: "Could not star Battery & Power", message: expect.stringContaining("Editor role") });
  });

  test("the pane: the description, the facts, and the first three time series panels as sparklines from one query call (a templated panel skipped, a collapsed row's panel reached, the unit on the caption)", async () => {
    const d = await host.detail(E, "grafana", "battery");
    expect(d.metadata).toEqual([
      { label: "Folder", value: "General" },
      { label: "Tags", tags: [{ text: "cagdas" }, { text: "power" }, { text: "hornet" }] },
      { label: "Time range", value: "now-12h to now, refreshed every 30s" },
      { label: "Panels", value: "6: 4 timeseries, 1 stat, 1 text" },
      { label: "UID", value: "battery", link: { text: "Open in Grafana", href: `${BASE}/d/battery/battery-and-power` } },
    ]);
    const imgs = [...d.markdown!.matchAll(/!\[(.*?)\]\((data:image\/svg\+xml;utf8,[^)]+)\)/g)];
    expect(d.markdown!.startsWith("Draw, charge and where it goes\n\n")).toBe(true);
    expect(imgs.map((m) => m[1])).toEqual(["Draw vs. presence", "Charge", "Wakeups"]);
    const svgs = imgs.map((m) => decodeURIComponent(m[2].slice(m[2].indexOf(",") + 1)));
    expect(svgs[0]).toContain("2 series</text>");
    expect(svgs[0]).toMatch(/>[\d.]+ W · 2 series</);
    expect(svgs[1]).toContain(">71% · 1 series</text>".replace(" · 1 series", ""));
    const q = calls("POST", "/api/ds/query");
    expect(q).toHaveLength(1);
    expect((q[0].body as { queries: { refId: string; datasource: unknown; range: boolean }[]; from: string; to: string }).queries.map((x) => [x.refId, x.datasource, x.range])).toEqual([
      ["p10_A", { uid: "prom", type: "prometheus" }, true], ["p10_B", { uid: "prom", type: "prometheus" }, true], ["p11_A", { uid: "prom", type: "prometheus" }, true], ["p14_A", { uid: "prom", type: "prometheus" }, true],
    ]);
    expect((q[0].body as { from: string; to: string })).toMatchObject({ from: "now-12h", to: "now" });
    expect(calls("GET", "/api/plugins/grafana-image-renderer/settings")).toHaveLength(1);
    expect(calls("GET", "/api/datasources")).toHaveLength(1);
    // A second look after a relist (the host keeps a pane only until then) is the extension's own cache: no call.
    await list("grafana");
    await host.detail(E, "grafana", "battery");
    expect(calls("GET", "/api/dashboards/uid/battery")).toHaveLength(1);
    // A dashboard without panels: the facts alone, no markdown.
    const h = await host.detail(E, "grafana", "home");
    expect(h.markdown).toBeUndefined();
    expect(h.metadata!.find((m) => m.label === "Panels")).toEqual({ label: "Panels", value: "none" });
  });

  test("the pane with the renderer installed: the panels as PNGs, the probe made once; sparklines off with the setting at 0", async () => {
    state.renderer = true;
    host.changeSettings(E, { settings: { ...SETTINGS, sparklines: 2 } });
    await list("grafana");
    const d = await host.detail(E, "grafana", "battery");
    const imgs = [...d.markdown!.matchAll(/!\[(.*?)\]\((data:image\/png;base64,[^)]+)\)/g)];
    expect(imgs.map((m) => m[1])).toEqual(["Draw vs. presence", "Charge"]);
    expect(seen.filter((r) => r.path.startsWith("/render/d-solo/battery?")).map((r) => r.path)).toEqual([
      "/render/d-solo/battery?panelId=10&width=480&height=160&theme=dark&from=now-12h&to=now",
      "/render/d-solo/battery?panelId=11&width=480&height=160&theme=dark&from=now-12h&to=now",
    ]);
    expect(calls("GET", "/api/plugins/grafana-image-renderer/settings")).toHaveLength(1);
    expect(calls("POST", "/api/ds/query")).toHaveLength(0);
    host.changeSettings(E, { settings: { ...SETTINGS, sparklines: 0 } });
    await list("grafana");
    expect((await host.detail(E, "grafana", "battery")).markdown).toBe("Draw, charge and where it goes");
  });
});

describe("alerts", () => {
  beforeEach(() => { reset(); restore(); });

  test("rows: firing first with the summary, a red or amber tag, the severity, the date; the folder and labels as keywords; the actions with the three silences", async () => {
    const rows = await list("alerts");
    expect(rows.map((r) => [r.id.split(":")[0], r.name, r.subtitle])).toEqual([["alert-battery-low", "HA battery low", "Front door at 8%"], ["alert-battery-low", "HA battery low", "Keypad at 12%"], ["alert-disk", "Disk > 87%", "marko / at 88%"]]);
    expect(rows[0]).toMatchObject({ icon: { glyph: "\u{f0d59}", color: "red" }, accessories: [{ tag: "firing", color: "red" }, { text: "warning" }, { date: "2026-09-16T23:37:50Z" }] });
    expect(rows[0].keywords).toEqual(["firing", "alerts", "sensor.front_door_battery", "Front door", "archer", "warning"]);
    expect(rows[2]).toMatchObject({ icon: { glyph: "\u{f009a}", color: "amber" }, accessories: [{ tag: "pending", color: "amber" }, { text: "critical" }, { date: "2026-09-21T22:50:00Z" }] });
    expect(rows[0].actions!.map((a) => [a.id, a.shortcut])).toEqual([["open", undefined], ["dashboard", "cmd+enter"], ["silence:1h", "cmd+s"], ["silence:4h", "cmd+shift+s"], ["silence:1d", "cmd+d"], ["copy", "cmd+c"], ["labels", "cmd+l"]]);
    expect(rows[0].actions![2].confirm).toBe("Silence HA battery low (entity=sensor.front_door_battery, friendly_name=Front door, host=archer, severity=warning) for 1 hour?");
    expect(calls("GET", "/api/prometheus/grafana/api/v1/rules?state=firing&state=pending")).toHaveLength(1);
    expect(calls("GET", "/api/alertmanager/grafana/api/v2/alerts")).toHaveLength(1);
    expect(calls("GET", "/api/alertmanager/grafana/api/v2/silences")).toHaveLength(1);
  });

  test("filters: Firing, Pending, Silenced (a calm hint while empty)", async () => {
    expect((await list("alerts", "", { filter: "firing" })).map((r) => r.subtitle)).toEqual(["Front door at 8%", "Keypad at 12%"]);
    expect((await list("alerts", "", { filter: "pending" })).map((r) => r.subtitle)).toEqual(["marko / at 88%"]);
    expect(await list("alerts", "", { filter: "silenced" })).toMatchObject([{ id: "hint:quiet", name: "No silence is active", icon: { glyph: "\u{f05e0}", color: "green" } }]);
  });

  test("the pane: the summary in bold, the description, the rule link, the state and severity tags, since, the labels, the dashboard from the annotation (view_url, or __dashboardUid__ with the panel)", async () => {
    const rows = await list("alerts");
    const d = await host.detail(E, "alerts", rows[0].id);
    expect(d.markdown).toBe("**Front door at 8%**\n\nA device battery dropped below 20%.");
    expect(d.metadata).toEqual([
      { label: "Rule", value: "HA battery low", link: { text: "Open in Grafana", href: `${BASE}/alerting/grafana/alert-battery-low/view` } },
      { label: "State", tags: [{ text: "firing", color: "red" }, { text: "warning", color: "amber" }] },
      { label: "Since", value: expect.stringMatching(/^\w{3} 1[67] Sep/) },
      { label: "Folder", value: "alerts" },
      { label: "Value", value: "8" },
      { label: "Labels", tags: [{ text: "entity=sensor.front_door_battery" }, { text: "friendly_name=Front door" }, { text: "host=archer" }, { text: "severity=warning" }] },
      { label: "Dashboard", link: { text: "/d/ha", href: "https://grafana.example.com/d/ha" } },
    ]);
    const p = await host.detail(E, "alerts", rows[2].id);
    expect(p.metadata!.at(-1)).toEqual({ label: "Dashboard", link: { text: "/d/node?viewPanel=7", href: `${BASE}/d/node?viewPanel=7` } });
    expect(await host.detail(E, "alerts", "hint:quiet")).toEqual({});
  });

  test("picks: open the rule, the dashboard, copy the summary and the labels; a gone instance is a toast", async () => {
    const rows = await list("alerts");
    expect(await pick("alerts", rows[0].id)).toEqual({ open: `${BASE}/alerting/grafana/alert-battery-low/view` });
    expect(await pick("alerts", rows[0].id, "dashboard")).toEqual({ open: "https://grafana.example.com/d/ha" });
    expect(await pick("alerts", rows[0].id, "copy")).toEqual({ copy: "Front door at 8%" });
    expect(await pick("alerts", rows[0].id, "labels")).toEqual({ copy: 'alertname="HA battery low", entity="sensor.front_door_battery", friendly_name="Front door", grafana_folder="alerts", host="archer", severity="warning"' });
    expect((await pick("alerts", "alert-x:00000000")).toast).toMatchObject({ title: "That alert is no longer firing" });
  });

  test("silence for an hour: one POST with the rule uid and the instance's own labels, the row marked silenced at once, the bar asked to refresh, the Silenced filter with the silence row; expire from the row and from the silence row", async () => {
    const rows = await list("alerts");
    const before = host.coreCalls.filter((c) => c.method === "bar.refresh").length;
    const r = await pick("alerts", rows[0].id, "silence:1h");
    expect(r).toMatchObject({ keep: true, toast: { title: "Silenced HA battery low for 1 hour", message: "entity=sensor.front_door_battery, friendly_name=Front door, host=archer, severity=warning" } });
    const post = calls("POST", "/api/alertmanager/grafana/api/v2/silences");
    expect(post).toHaveLength(1);
    const b = post[0].body as { matchers: unknown[]; startsAt: string; endsAt: string; createdBy: string; comment: string };
    expect(b.matchers).toEqual([{ name: "__alert_rule_uid__", value: "alert-battery-low", isEqual: true, isRegex: false }, { name: "entity", value: "sensor.front_door_battery", isEqual: true, isRegex: false }, { name: "friendly_name", value: "Front door", isEqual: true, isRegex: false }, { name: "host", value: "archer", isEqual: true, isRegex: false }, { name: "severity", value: "warning", isEqual: true, isRegex: false }]);
    expect(Date.parse(b.endsAt) - Date.parse(b.startsAt)).toBe(3600_000);
    expect(b).toMatchObject({ createdBy: "pal", comment: "HA battery low: silenced from pal for 1 hour" });
    await host.until(() => host.coreCalls.filter((c) => c.method === "bar.refresh").length > before, 2000, "bar.refresh");
    const again = await list("alerts");
    expect(again[0]).toMatchObject({ icon: { glyph: "\u{f009b}", color: "slate" }, accessories: [{ tag: "firing", color: "red" }, { text: "warning" }, { tag: "silenced" }, { date: "2026-09-16T23:37:50Z" }] });
    expect(again[0].actions!.map((a) => a.id)).toEqual(["open", "dashboard", "unsilence", "copy", "labels"]);
    expect(again[1].actions!.map((a) => a.id)).toContain("silence:1h");
    // The next listing reads the Alertmanager, which now knows the silence too.
    const silenced = await list("alerts", "", { filter: "silenced", refresh: true });
    expect(silenced.map((x) => [x.id, x.name])).toEqual([[rows[0].id, "HA battery low"], ["silence:sil-1", "Silence: __alert_rule_uid__=alert-battery-low, entity=sensor.front_door_battery, friendly_name=Front door, host=archer, severity=warning"]]);
    expect(silenced[1]).toMatchObject({ subtitle: expect.stringMatching(/^HA battery low: silenced from pal for 1 hour · by pal · ends /), accessories: [{ tag: "silence" }, { date: expect.any(String) }] });
    expect(silenced[1].actions!.map((a) => [a.id, a.style])).toEqual([["expire", "destructive"], ["open", undefined], ["copy", undefined]]);
    expect(await pick("alerts", "silence:sil-1", "open")).toEqual({ open: `${BASE}/alerting/silence/sil-1/edit` });
    expect((await pick("alerts", rows[0].id, "unsilence")).toast).toMatchObject({ title: "Expired the silence on HA battery low" });
    expect(calls("DELETE", "/api/alertmanager/grafana/api/v2/silence/sil-1")).toHaveLength(1);
    expect((await list("alerts"))[0].accessories).not.toContainEqual({ tag: "silenced" });
    expect(ids(await list("alerts", "", { filter: "silenced", refresh: true }))).toEqual(["hint:quiet"]);
    // The 4 hour and 1 day spellings, and a silence row's Expire.
    expect((await pick("alerts", rows[1].id, "silence:1d")).toast!.title).toBe("Silenced HA battery low for 1 day");
    const b2 = calls("POST", "/api/alertmanager/grafana/api/v2/silences")[1].body as { startsAt: string; endsAt: string };
    expect(Date.parse(b2.endsAt) - Date.parse(b2.startsAt)).toBe(86400_000);
    expect((await pick("alerts", "silence:sil-2")).toast!.title).toMatch(/^Expired the silence on __alert_rule_uid__=alert-battery-low, entity=sensor.keypad_battery/);
    expect(calls("DELETE", "/api/alertmanager/grafana/api/v2/silence/sil-2")).toHaveLength(1);
  });

  test("a Viewer token may not silence: a failure toast naming the role, nothing marked", async () => {
    host.changeSettings(E, { settings: { ...SETTINGS, token: VIEWER } });
    const rows = await list("alerts");
    expect((await pick("alerts", rows[0].id, "silence:4h")).toast).toMatchObject({ style: "failure", title: "Could not silence HA battery low", message: expect.stringContaining("Editor role") });
    expect((await list("alerts"))[0].accessories).not.toContainEqual({ tag: "silenced" });
  });
});

describe("query", () => {
  beforeEach(() => { reset(); restore(); });

  test("before typing: a hint and the saved queries; a saved one runs as a push with the expression typed, copies, opens Explore", async () => {
    const rows = await list("query", "");
    expect(rows[0]).toMatchObject({ id: "hint:type", name: "Type PromQL" });
    expect(rows.slice(1).map((r) => [r.id, r.name])).toEqual([["q:0", "Targets down"], ["q:1", "Firing alerts"], ["q:2", "CPU busy %"], ["q:3", "Memory used %"], ["q:4", "Root disk used %"]]);
    expect(rows[1].actions!.map((a) => [a.id, a.shortcut])).toEqual([["run", undefined], ["explore", "cmd+o"], ["expr", "cmd+c"], ["remove", "cmd+backspace"]]);
    expect(await pick("query", "q:0")).toEqual({ push: { extension: E, palette: "query", query: "up == 0" } });
    expect(await pick("query", "q:0", "expr")).toEqual({ copy: "up == 0" });
    expect((await pick("query", "q:0", "explore")).open).toMatch(new RegExp(`^${BASE}/explore\\?schemaVersion=1&panes=`));
    expect(seen.length).toBe(1);
  });

  test("an expression: one instant query against the default Prometheus datasource, a row per series with its value and labels, the pane; a scalar; nothing matched; a parse error as a calm hint", async () => {
    const rows = await list("query", "up");
    expect(rows.map((r) => [r.id.slice(0, 2), r.name, r.accessories, r.keywords])).toEqual([["s:", 'up{host="archer", job="node"}', [{ text: "1" }], ["archer", "node"]], ["s:", 'up{host="marko", job="node"}', [{ text: "0" }], ["marko", "node"]]]);
    expect(rows[0].detail).toEqual({ markdown: "## 1", metadata: [{ label: "Expression", value: "up" }, { label: "At", value: expect.any(String) }, { label: "host", value: "archer" }, { label: "job", value: "node" }] });
    const q = calls("POST", "/api/ds/query");
    expect(q).toHaveLength(1);
    expect((q[0].body as { queries: unknown[] }).queries).toEqual([{ refId: "A", datasource: { uid: "prom", type: "prometheus" }, expr: "up", instant: true, range: false, intervalMs: 30_000, maxDataPoints: 100 }]);
    expect(await list("query", "1+1")).toMatchObject([{ name: "1+1", accessories: [{ text: "2" }] }]);
    expect(await list("query", "up == 0")).toMatchObject([{ id: "hint:empty", name: "No series", subtitle: "up == 0 matched nothing right now" }]);
    expect(await list("query", "up{")).toMatchObject([{ id: "hint:error", name: "1:4: parse error: unexpected end of input inside braces", subtitle: "PromQL as Prometheus reads it; Explore shows the same" }]);
    // The same expression again within the cache window is no call.
    await list("query", "up");
    expect(calls("POST", "/api/ds/query")).toHaveLength(4);
  });

  test("the datasource setting picks by name or uid; an unknown one is a hint", async () => {
    host.changeSettings(E, { settings: { ...SETTINGS, datasource: "prometheus archive" } });
    await list("query", "up");
    expect((calls("POST", "/api/ds/query")[0].body as { queries: { datasource: { uid: string } }[] }).queries[0].datasource.uid).toBe("prom-archive");
    host.changeSettings(E, { settings: { ...SETTINGS, datasource: "nope" } });
    expect(await list("query", "up")).toMatchObject([{ id: "hint:setup", name: "No Prometheus datasource named nope" }]);
  });

  test("picks on a result: copy the value, the series with its value, every series, the expression; Explore; save through a form that writes the setting; remove writes it too", async () => {
    const rows = await list("query", "up");
    expect(await pick("query", rows[1].id)).toEqual({ copy: "0", hud: "Copied 0" });
    expect(await pick("query", rows[1].id, "series")).toEqual({ copy: 'up{host="marko", job="node"} 0' });
    expect(await pick("query", rows[1].id, "all")).toEqual({ copy: 'up{host="archer", job="node"}\t1\nup{host="marko", job="node"}\t0' });
    expect(await pick("query", rows[1].id, "expr")).toEqual({ copy: "up" });
    expect(JSON.parse(new URL((await pick("query", rows[1].id, "explore")).open!).searchParams.get("panes")!).pal.queries[0].expr).toBe("up");
    const f = (await pick("query", rows[1].id, "save")).form as Form;
    expect(f).toMatchObject({ id: "save", title: "Save query", submit: { id: "saved", title: "Save" } });
    expect(f.fields.map((x) => [x.id, (x as { default?: string }).default])).toEqual([["name", undefined], ["expr", "up"]]);
    expect(((await pick("query", "save", "saved", { values: { name: "", expr: "up" } })).form as Form).errors).toEqual({ name: "Required" });
    expect(((await pick("query", "save", "saved", { values: { name: "a = b", expr: "up" } })).form as Form).errors).toEqual({ name: "A name without ' = ' in it" });
    expect((await pick("query", "save", "saved", { values: { name: "Up", expr: "up" } })).toast).toMatchObject({ title: "Saved Up" });
    expect(host.written.get(E)!.queries).toEqual([...host.manifests.get(E)!.settings!.find((s) => s.id === "queries")!.default as string[], "Up = up"]);
    expect((await list("query", "")).at(-1)).toMatchObject({ id: "q:5", name: "Up", subtitle: "up" });
    expect((await pick("query", "q:5", "remove")).toast).toMatchObject({ title: "Removed Up" });
    expect(host.written.get(E)!.queries).toBeUndefined();
    expect((await list("query", "")).at(-1)).toMatchObject({ id: "q:4" });
  });
});

describe("bar", () => {
  beforeEach(() => { reset(); restore(); });

  test("render: the counts as segments, the states, the tooltip, the popover as a view; a firing instance under a silence leaves the count", async () => {
    const item = await host.render(E, "alerts", { reason: "show" });
    expect({ ...item, menu: undefined, empty: undefined }).toEqual({ icon: "", segments: [{ id: "firing", text: "2", color: "red", tooltip: "2 firing" }, { id: "pending", text: "1", color: "amber", tooltip: "1 pending" }], tooltip: "2 firing, 1 pending on Grafana", states: { firing: 2, pending: 1 }, menu: undefined, empty: undefined });
    expect(item.empty).toMatchObject({ icon: "", tooltip: "No alert is firing on Grafana" });
    const v = viewOf(item.menu);
    expect(() => checkView(v, "test")).not.toThrow();
    expect(v).toMatchObject({ id: "alerts", keys: "actions", title: "2 firing, 1 pending" });
    expect(texts(v.tree).slice(0, 5)).toEqual(["Firing", "[2]", "HA battery low", "Front door at 8%", "[warning]"]);
    expect(calls("GET", "/api/prometheus/grafana/api/v1/rules?state=firing&state=pending")).toHaveLength(1);
    // The timer's render within the cache window is no call.
    await host.render(E, "alerts", { reason: "every" });
    expect(calls("GET", "/api/prometheus/grafana/api/v1/rules?state=firing&state=pending")).toHaveLength(1);
    const rows = await list("alerts");
    await pick("alerts", rows[0].id, "silence:1h");
    const after = await host.render(E, "alerts", { reason: "every" });
    expect(after.states).toEqual({ firing: 1, pending: 1 });
    expect(after.segments!.map((s) => s.text)).toEqual(["1", "1"]);
    expect(viewOf(after.menu).title).toBe("1 firing, 1 pending, 1 silenced");
  });

  test("the popover's keys: arrows and a click move the cursor, Enter opens the rule, o the dashboard, c copies, p pushes the palette, a the list, r refreshes; s silences from the bar and the tree follows", async () => {
    const item = await host.render(E, "alerts", { reason: "show" });
    const rows = viewOf(item.menu).actions.filter((a) => a.id.startsWith("focus:")).map((a) => a.id.slice(6));
    expect(rows).toHaveLength(3);
    const selected = (v: View) => (v.tree as { children: ViewNode[] }).children.find((n) => n.selected)?.key;
    expect(selected(viewOf(item.menu))).toBe(rows[0]);
    expect(selected(viewOf(await host.barAction(E, "alerts", "down")))).toBe(rows[1]);
    expect(selected(viewOf(await host.barAction(E, "alerts", "down")))).toBe(rows[2]);
    expect(selected(viewOf(await host.barAction(E, "alerts", "down")))).toBe(rows[0]);
    expect(selected(viewOf(await host.barAction(E, "alerts", "up")))).toBe(rows[2]);
    expect(await host.barAction(E, "alerts", "open")).toEqual({ open: `${BASE}/alerting/grafana/alert-disk/view` });
    expect(await host.barAction(E, "alerts", "dashboard")).toEqual({ open: `${BASE}/d/node?viewPanel=7` });
    expect(selected(viewOf(await host.barAction(E, "alerts", `focus:${rows[0]}`)))).toBe(rows[0]);
    expect(await host.barAction(E, "alerts", "copy")).toEqual({ copy: "Front door at 8%" });
    expect(await host.barAction(E, "alerts", "pal")).toEqual({ push: { extension: E, palette: "alerts" } });
    expect(await host.barAction(E, "alerts", "site")).toEqual({ open: `${BASE}/alerting/list?view=state` });
    const before = calls("GET", "/api/prometheus/grafana/api/v1/rules?state=firing&state=pending").length;
    expect((await host.barAction(E, "alerts", "refresh")).keep).toBe(true);
    expect(calls("GET", "/api/prometheus/grafana/api/v1/rules?state=firing&state=pending")).toHaveLength(before + 1);
    const r = await host.barAction(E, "alerts", "silence:4h");
    expect(r.keep).toBe(true);
    expect(texts(viewOf(r).tree)).toContain("[silenced]");
    expect(viewOf(r).actions.find((a) => a.id === "unsilence")).toMatchObject({ shortcut: ["s", "u"] });
    expect((calls("POST", "/api/alertmanager/grafana/api/v2/silences")[0].body as { comment: string }).comment).toBe("HA battery low: silenced from pal for 4 hours");
    const u = await host.barAction(E, "alerts", "unsilence");
    expect(u.keep).toBe(true);
    expect(texts(viewOf(u).tree)).not.toContain("[silenced]");
  });

  test("unconfigured is hidden with the states withdrawn; a dead host is an error (the core marks it stale)", async () => {
    host.changeSettings(E, { settings: { ...SETTINGS, url: "" } });
    expect(await host.render(E, "alerts")).toEqual({ hidden: true, states: { firing: null, pending: null } });
    host.changeSettings(E, { settings: { ...SETTINGS, url: "http://127.0.0.1:1" } });
    await expect(host.render(E, "alerts")).rejects.toThrow(/Could not reach http:\/\/127\.0\.0\.1:1/);
  });
});

describe("links", () => {
  beforeEach(() => { reset(); restore(); });
  const link = (route: string, params: Record<string, unknown>) => host.request<Record<string, unknown>>("link", { extension: E, route, params });
  test("query pushes the prompt with the expression; open builds the dashboard URL with the range given, else the setting", async () => {
    expect(await link("query", { expr: "up == 0" })).toEqual({ push: { extension: E, palette: "query", query: "up == 0" } });
    expect(await link("open", { uid: "home" })).toEqual({ open: `${BASE}/d/home` });
    expect(await link("open", { uid: "home", from: "now-24h", kiosk: true })).toEqual({ open: `${BASE}/d/home?from=now-24h&to=now&kiosk` });
    host.changeSettings(E, { settings: { ...SETTINGS, time_range: "now-7d" } });
    expect(await link("open", { uid: "home", to: "2026-09-01" })).toEqual({ open: `${BASE}/d/home?from=now-7d&to=${Date.parse("2026-09-01")}` });
    await expect(link("open", {})).rejects.toThrow(/uid is required/);
  });
});

describe("what goes wrong", () => {
  beforeEach(() => { reset(); restore(); });

  test("no URL: one hint row whose Enter opens Settings on the field; no token; a rejected token; a dead host; a slow one", async () => {
    host.changeSettings(E, { settings: { ...SETTINGS, url: "" } });
    for (const p of ["grafana", "alerts"]) {
      const rows = await list(p);
      expect(rows).toMatchObject([{ id: "hint:setup", name: "Grafana is not set up", subtitle: expect.stringContaining("Settings › Extensions › Grafana"), actions: [{ id: "settings", title: "Open Grafana settings" }] }]);
      expect(await pick(p, "hint:setup", "settings")).toEqual({ open: "pal://settings/extensions?anchor=extensions:grafana:url" });
      expect(await pick(p, "hint:setup")).toEqual({});
    }
    expect(await list("query", "up")).toMatchObject([{ id: "hint:setup", name: "Grafana is not set up" }]);
    expect((await pick("grafana", "home")).toast).toMatchObject({ style: "failure", title: "Could not reach Grafana for home" });
    host.changeSettings(E, { settings: { ...SETTINGS, token: "" } });
    expect(await list("grafana")).toMatchObject([{ id: "hint:setup", name: "Token is not set" }]);
    host.changeSettings(E, { settings: { ...SETTINGS, token: "wrong" } });
    expect(await list("grafana")).toMatchObject([{ id: "hint:setup", name: "Grafana rejected the token", subtitle: expect.stringContaining("service account token"), actions: [] }]);
    expect(await list("alerts")).toMatchObject([{ name: "Grafana rejected the token" }]);
    expect(await list("query", "up")).toMatchObject([{ name: "Grafana rejected the token" }]);
    host.changeSettings(E, { settings: { ...SETTINGS, url: "http://127.0.0.1:1" } });
    expect(await list("grafana")).toMatchObject([{ name: "Could not reach http://127.0.0.1:1", subtitle: expect.stringContaining("Check the URL") }]);
    host.changeSettings(E, { settings: { ...SETTINGS, timeout: 1 } });
    state.delayMs = 1500;
    expect(await list("alerts")).toMatchObject([{ name: `${BASE} did not answer within 1 s`, subtitle: expect.stringContaining("Raise the timeout") }]);
    state.delayMs = 0;
  }, 15_000);

  test("a redirecting host is followed once with the token kept, and the log says which URL to set", async () => {
    const redirecting = Bun.serve({ port: 0, fetch(req) { const u = new URL(req.url); return new Response(null, { status: 301, headers: { location: `${BASE}${u.pathname}${u.search}` } }); } });
    try {
      host.changeSettings(E, { settings: { ...SETTINGS, url: `http://127.0.0.1:${redirecting.port}` } });
      expect(ids(await list("grafana"))).toEqual(["home", "battery", "backups", "node"]);
      await host.untilStderr(`redirects to ${BASE}; set that as the URL`);
    } finally {
      redirecting.stop(true);
    }
  });
});
