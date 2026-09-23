// browser-tabs against three fakes: a Bun server speaking the DevTools
// endpoints (`/json`, `/json/version`, activate, close) and enough of the
// protocol over its WebSocket (attach, evaluate, window lookup, bring to
// front) to record what the extension did; a fake `osascript` first on PATH
// answering the JavaScript-for-Automation run with Safari tabs; and a
// Firefox `recovery.jsonlz4` compressed here by hand (one match, so the
// decoder's copy path runs). The real :9222 is never touched.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { tile } from "../../../sdk/src/icon.ts";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Host, writeTool } from "../harness.ts";

const MAC = process.platform === "darwin";
const dir = mkdtempSync(join(tmpdir(), "pal-tabs-"));
const osaLog = join(dir, "osascript.log");
const osaState = join(dir, "osascript.state");
const ffFile = join(dir, "recovery.jsonlz4");

// ---- fake DevTools browser ----------------------------------------------------------

type Target = { id: string; type: string; title: string; url: string };
const targets: Target[] = [
  { id: "T1", type: "page", title: "YouTube", url: "https://www.youtube.com/watch?v=1" },
  { id: "T2", type: "page", title: "GitHub", url: "https://github.com/zcag/pal" },
  { id: "T3", type: "page", title: "Settings", url: "chrome://settings/" },
  { id: "T4", type: "page", title: "Radio", url: "https://radio.example/live" },
  { id: "D1", type: "page", title: "DevTools", url: "devtools://devtools/bundled/inspector.html" },
  { id: "S1", type: "service_worker", title: "sw", url: "https://github.com/sw.js" },
];
const media: Record<string, { playing: boolean; audible: boolean; muted: boolean }> = {
  T1: { playing: true, audible: true, muted: false },
  T4: { playing: true, audible: false, muted: true },
  T2: { playing: false, audible: false, muted: false },
};
const windowOf: Record<string, number> = { T1: 8001, T2: 8001, T3: 8002, T4: 8001 };
const http: string[] = [];
const ws: { method: string; params: any; sessionId?: string }[] = [];
let sessions = 0;

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch(req, srv) {
    const path = new URL(req.url).pathname;
    if (path === "/json/version") return Response.json({ Browser: "Chrome/152.0.0.0", "User-Agent": "x", webSocketDebuggerUrl: `ws://127.0.0.1:${srv.port}/devtools/browser/abc` });
    if (path === "/json" || path === "/json/list") return Response.json(targets.map((t) => ({ ...t, webSocketDebuggerUrl: `ws://127.0.0.1:${srv.port}/devtools/page/${t.id}` })));
    if (path.startsWith("/devtools/browser/")) return srv.upgrade(req) ? undefined : new Response("no", { status: 400 });
    http.push(path);
    if (path.startsWith("/json/activate/")) return new Response("Target activated");
    if (path.startsWith("/json/close/")) return new Response("Target is closing");
    return new Response("not found", { status: 404 });
  },
  websocket: {
    message(sock, raw) {
      const msg = JSON.parse(String(raw)) as { id: number; method: string; params: any; sessionId?: string };
      ws.push({ method: msg.method, params: msg.params, sessionId: msg.sessionId });
      const reply = (result: unknown) => { sock.send(JSON.stringify({ id: msg.id, result })); };
      const fail = (message: string) => { sock.send(JSON.stringify({ id: msg.id, error: { message } })); };
      switch (msg.method) {
        case "Target.attachToTarget": return reply({ sessionId: `S-${msg.params.targetId}-${++sessions}` });
        case "Target.detachFromTarget": return reply({});
        case "Browser.getWindowForTarget": {
          const w = windowOf[msg.params.targetId];
          return w ? reply({ windowId: w, bounds: {} }) : fail("No window for target");
        }
        case "Runtime.evaluate": {
          const tid = msg.sessionId!.split("-")[1];
          if (msg.params.expression.includes("e.muted=")) return reply({ result: { type: "boolean", value: true } });
          const m = media[tid];
          return m ? reply({ result: { type: "object", value: m } }) : reply({ exceptionDetails: { text: "Cannot read properties" } });
        }
        case "Page.bringToFront": return reply({});
        default: return fail(`unknown ${msg.method}`);
      }
    },
  },
});
const port = server.port!;

// ---- fake osascript -----------------------------------------------------------------

const safari = [
  { window: 1, index: 1, title: "Apple", url: "https://www.apple.com/", active: false },
  { window: 1, index: 2, title: "Hacker News", url: "https://news.ycombinator.com/", active: true },
  { window: 2, index: 1, title: "", url: "https://example.org/page", active: true },
];
writeFileSync(osaState, "ok");
writeFileSync(osaLog, "");
writeTool(join(dir, "osascript"), `#!/bin/bash
# osascript -l JavaScript -e <script> <mode> <args...>
shift 4
echo "$*" >> "${osaLog}"
state=$(cat "${osaState}")
if [ "$state" = denied ]; then echo "execution error: Error: Error: Not authorized to send Apple events to Safari. (-1743)" >&2; exit 1; fi
if [ "$state" = none ]; then echo '{}'; exit 0; fi
case "$1" in
  list) echo '${JSON.stringify({ Safari: safari })}' ;;
  focus|close) echo ok ;;
esac
`);

const osa = () => readFileSync(osaLog, "utf8").split("\n").filter(Boolean);

// ---- Firefox session, compressed by hand ----------------------------------------------

const ffSession = JSON.stringify({
  windows: [
    { tabs: [{ index: 1, entries: [{ url: "https://developer.mozilla.org/", title: "MDN" }] }, { index: 2, entries: [{ url: "https://old.example/", title: "Old" }, { url: "https://new.example/", title: "New" }] }], selected: 2 },
    { tabs: [{ index: 1, entries: [{ url: "about:blank" }] }], selected: 1 },
  ],
  selectedWindow: 1,
});

/** One LZ4 block: literals up to the second `{"url":"https://`, a 16-byte match back to the first, the rest as literals. */
function mozlz4(text: string): Buffer {
  const src = Buffer.from(text, "utf8");
  const needle = Buffer.from('{"url":"https://');
  const p1 = src.indexOf(needle), p2 = src.indexOf(needle, p1 + 1);
  const lits = (n: number, m: number) => n < 15 ? [(n << 4) | m] : [0xf0 | m, ...Array(Math.floor((n - 15) / 255)).fill(255), (n - 15) % 255];
  const seq1 = Buffer.concat([Buffer.from(lits(p2, 12)), src.subarray(0, p2), Buffer.from([(p2 - p1) & 0xff, (p2 - p1) >> 8])]);
  const rest = src.subarray(p2 + 16);
  const seq2 = Buffer.concat([Buffer.from(lits(rest.length, 0)), rest]);
  const size = Buffer.alloc(4);
  size.writeUInt32LE(src.length);
  return Buffer.concat([Buffer.from("mozLz40\0", "latin1"), size, seq1, seq2]);
}
writeFileSync(ffFile, mozlz4(ffSession));

// ---- host ---------------------------------------------------------------------------------

const base = { port, apps: ["Safari"], firefox: true, firefox_session: ffFile };
let host: Host;
beforeAll(async () => {
  const path = process.env.PATH;
  process.env.PATH = `${dir}:${path}`;
  try { host = await Host.bundled({ settings: { "browser-tabs": { settings: base } } }); } finally { process.env.PATH = path; }
});
afterAll(() => { host.kill(); server.stop(true); rmSync(dir, { recursive: true, force: true }); });

const list = (filter?: string) => host.list("browser-tabs", "tabs", undefined, filter ? { filter } : undefined);
const pick = (id: string, action?: string) => host.pick("browser-tabs", "tabs", id, action);
const ids = (items: { id: string }[]) => items.map((i) => i.id);

describe("browser-tabs", () => {
  test("meta: live, indexed, three filters", () => {
    expect(host.loaded().find((l) => l.extension === "browser-tabs")!.palettes[0]).toMatchObject({
      name: "tabs", title: "Browser Tabs", live: true, input: false, icon: tile("cyan", "\u{f04e9}"),
      filters: [{ id: "all", title: "All" }, { id: "audible", title: "Audible" }, { id: "window", title: "This window" }],
    });
  });

  test("DevTools tabs in the browser's order, pages only: host as subtitle, favicon from the url, playing and muted tags, window numbers", async () => {
    const items = (await list()).filter((i) => i.id.startsWith("cdp:"));
    expect(ids(items)).toEqual(["cdp:T1", "cdp:T2", "cdp:T3", "cdp:T4"]);
    const [yt, gh, st, radio] = items;
    expect(yt).toMatchObject({ name: "YouTube", subtitle: "www.youtube.com", url: "https://www.youtube.com/watch?v=1", keywords: ["https://www.youtube.com/watch?v=1", "www.youtube.com", "Google Chrome"] });
    expect(yt.icon).toBeUndefined();
    expect(yt.accessories).toEqual([{ text: "Google Chrome" }, { text: "window 1" }, { tag: "playing", color: "green" }]);
    expect(gh.accessories).toEqual([{ text: "Google Chrome" }, { text: "window 1" }]);
    expect(st).toMatchObject({ name: "Settings", subtitle: "chrome://settings/", accessories: [{ text: "Google Chrome" }, { text: "window 2" }] });
    expect(st.url).toBeUndefined();
    expect(st.icon).toBeDefined();
    expect(radio.accessories).toEqual([{ text: "Google Chrome" }, { text: "window 1" }, { tag: "muted" }]);
    expect(yt.actions!.map((a) => a.id)).toEqual(["focus", "copy-url", "mute", "copy-markdown", "close"]);
    expect(yt.actions![2].title).toBe("Mute");
    expect(radio.actions![2].title).toBe("Unmute");
    expect(yt.actions![4]).toMatchObject({ shortcut: "cmd+w", style: "destructive" });
    // The probe and the window lookup ran once per page, over one socket each.
    expect(ws.filter((m) => m.method === "Runtime.evaluate").length).toBeGreaterThanOrEqual(4);
    expect(ws.filter((m) => m.method === "Browser.getWindowForTarget").length).toBeGreaterThanOrEqual(4);
  });

  test("Firefox tabs from the session file after the others: the selected entry of each tab, only its window can be focused", async () => {
    const items = (await list()).filter((i) => i.id.startsWith("ff:"));
    expect(ids(items)).toEqual(["ff:1:1", "ff:1:2", "ff:2:1"]);
    expect(items[0]).toMatchObject({ name: "MDN", subtitle: "developer.mozilla.org", url: "https://developer.mozilla.org/", accessories: [{ text: "Firefox" }, { text: "window 1" }] });
    expect(items[1]).toMatchObject({ name: "New", url: "https://new.example/" });
    expect(items[2]).toMatchObject({ name: "about:blank", subtitle: "about:blank" });
    expect(items[0].actions!.map((a) => a.title)).toEqual(["Focus window", "Copy URL", "Copy as markdown link"]);
  });

  test("the audible filter keeps the tabs a page reports as audible; this window keeps the front window of each browser", async () => {
    expect(ids(await list("audible"))).toEqual(["cdp:T1"]);
    const front = ids(await list("window"));
    expect(front).toContain("cdp:T1");
    expect(front).not.toContain("cdp:T3");
    expect(front).toContain("ff:1:1");
    expect(front).not.toContain("ff:2:1");
  });

  test("copy URL and the markdown link", async () => {
    await list();
    expect(await pick("cdp:T2", "copy-url")).toEqual({ copy: "https://github.com/zcag/pal" });
    expect(await pick("cdp:T2", "copy-markdown")).toEqual({ copy: "[GitHub](https://github.com/zcag/pal)" });
    expect(await pick("ff:1:1", "copy-markdown")).toEqual({ copy: "[MDN](https://developer.mozilla.org/)" });
  });

  test("focus over DevTools: activate, bring to front, then the focus effect on the browser's window from windows.list", async () => {
    await list();
    http.length = 0;
    const n = ws.length;
    expect(await pick("cdp:T2")).toEqual({ focus: "w2" });
    expect(http).toEqual(["/json/activate/T2"]);
    expect(ws.slice(n).map((m) => m.method)).toContain("Page.bringToFront");
    expect(host.coreCalls.at(-1)!.method).toBe("windows.list");
  });

  test("close and mute over DevTools keep the palette open; mute flips by the tab's state", async () => {
    await list();
    http.length = 0;
    expect(await pick("cdp:T3", "close")).toEqual({ keep: true });
    expect(http).toEqual(["/json/close/T3"]);
    const n = ws.length;
    expect(await pick("cdp:T1", "mute")).toEqual({ keep: true });
    expect(await pick("cdp:T4", "mute")).toEqual({ keep: true });
    const evals = ws.slice(n).filter((m) => m.method === "Runtime.evaluate").map((m) => m.params.expression);
    expect(evals[0]).toContain("e.muted=true");
    expect(evals[1]).toContain("e.muted=false");
  });

  test("a Firefox tab's focus needs a Firefox window; none open is a failure toast", async () => {
    await list();
    expect(await pick("ff:1:1")).toMatchObject({ keep: true, toast: { style: "failure" } });
  });

  test("a stale id is a no-op that keeps the palette", async () => {
    expect(await pick("cdp:gone")).toEqual({ keep: true });
  });

  test("nothing on the port and nothing else: one hint row", async () => {
    writeFileSync(osaState, "none");
    host.changeSettings("browser-tabs", { settings: { ...base, port: 1, firefox: false } });
    const items = await list();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: "hint:none", name: "No browser tabs", actions: [] });
    expect(items[0].subtitle).toContain(":1");
    writeFileSync(osaState, "ok");
    host.changeSettings("browser-tabs", { settings: base });
  });
});

describe.skipIf(!MAC)("browser-tabs over AppleScript", () => {
  test("Safari tabs by window and index, a title-less tab named by its url; one osascript run lists every app", async () => {
    writeFileSync(osaLog, "");
    const items = (await list()).filter((i) => i.id.startsWith("as:"));
    expect(ids(items)).toEqual(["as:Safari:1:1", "as:Safari:1:2", "as:Safari:2:1"]);
    expect(items[0]).toMatchObject({ name: "Apple", subtitle: "www.apple.com", accessories: [{ text: "Safari" }, { text: "window 1" }] });
    expect(items[2]).toMatchObject({ name: "example.org/page", accessories: [{ text: "Safari" }, { text: "window 2" }] });
    expect(items[0].actions!.map((a) => a.id)).toEqual(["focus", "copy-url", "copy-markdown", "close"]);
    expect(osa()).toEqual(["list Safari"]);
  });

  test("a Chromium app the port already covers is not asked again", async () => {
    writeFileSync(osaLog, "");
    host.changeSettings("browser-tabs", { settings: { ...base, apps: ["Google Chrome", "Safari"] } });
    await list();
    expect(osa()).toEqual(["list Safari"]);
    host.changeSettings("browser-tabs", { settings: base });
  });

  test("focus selects the tab and raises the window in the browser, then hides when no window of the app is listed; close runs the script and keeps the palette", async () => {
    await list();
    writeFileSync(osaLog, "");
    expect(await pick("as:Safari:1:2")).toEqual({ hide: true });
    expect(await pick("as:Safari:2:1", "close")).toEqual({ keep: true });
    expect(osa()).toEqual(["focus Safari 1 2", "close Safari 2 1"]);
  });

  test("Automation refused is a hint row that opens the Privacy pane; the other sources still list", async () => {
    writeFileSync(osaState, "denied");
    const items = await list();
    expect(items[0]).toMatchObject({ id: "hint:automation", name: "Automation permission needed", actions: [{ id: "settings", title: "Open System Settings" }] });
    expect(ids(items)).toContain("cdp:T1");
    expect(await pick("hint:automation", "settings")).toEqual({ open: "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation" });
    writeFileSync(osaState, "ok");
  });
});
