// google: the parsers and urls first (google.ts, pure), then the palette
// over the wire against one Bun stand-in for every service it reaches
// (`PAL_GOOGLE_BASE` routes `https://host/path` to `<base>/host/path`):
// Google's homepage suggest and the documented one it falls back to
// (served in ISO-8859-9, as Google does for Turkish), SerpApi, the Brave
// Search API, a SearXNG instance, Wikipedia. The suggestions and Tab's
// `complete`, a newer keystroke cancelling an older request, the root's
// late fallback rows, the pane's entity card and results preview, the
// results level, recent searches, and the picks through `PAL_OPEN_URL`.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decode, localeOf, parseBrave, parseFirefox, parseSearxng, parseSerpApi, parseSummary, parseWiz, searchUrl } from "../../../extensions/google/google.ts";
import type { Item } from "../../../sdk/src/protocol.ts";
import { Host, writeTool } from "../harness.ts";

const WIZ = `)]}'\n[[["tarkan",46,[512,433],{"zh":"Tarkan","zi":"Şarkıcı-şarkı yazarı","zs":"https://img/tarkan.jpg"}],["tarkan<b> konseri</b>",0,[512]],["tarkan<b> &amp; sezen</b>",0,[512]]],{"ag":{}}]`;

describe("google.ts", () => {
  test("parseWiz: the text without its marks, an entity's name, line and thumbnail", () => {
    expect(parseWiz(WIZ)).toEqual([
      { text: "tarkan", entity: { title: "Tarkan", about: "Şarkıcı-şarkı yazarı", image: "https://img/tarkan.jpg" } },
      { text: "tarkan konseri" },
      { text: "tarkan & sezen" },
    ]);
    expect(() => parseWiz(")]}'\n{}")).toThrow();
  });
  test("parseFirefox reads the documented shape", () => {
    expect(parseFirefox('["ça",["çay","çaykur"," "],[],{}]')).toEqual([{ text: "çay" }, { text: "çaykur" }]);
  });
  test("decode: the charset the reply names, UTF-8 without one", async () => {
    const tr = new Uint8Array([0xe7, 0x61, 0x79, 0x20, 0xfd, 0xf0, 0xfe]); // "çay ığş" in ISO-8859-9
    expect(await decode(new Response(tr, { headers: { "content-type": "text/javascript; charset=ISO-8859-9" } }))).toBe("çay ığş");
    expect(await decode(new Response("çay", { headers: { "content-type": "application/json" } }))).toBe("çay");
    expect(await decode(new Response("çay", { headers: { "content-type": "text/plain; charset=nonsense" } }))).toBe("çay");
  });
  test("localeOf and searchUrl: the settings over the system; the url names only what was set", () => {
    expect(localeOf({ language: "auto", region: "" }, "en-US")).toEqual({ hl: "en", gl: "us" });
    expect(localeOf({ language: "tr", region: "DE" }, "en-US")).toEqual({ hl: "tr", gl: "de" });
    expect(searchUrl("a b&c", { language: "auto", region: "", safe_search: false })).toBe("https://www.google.com/search?q=a+b%26c");
    expect(searchUrl("x", { language: "tr", region: "TR", safe_search: true })).toBe("https://www.google.com/search?q=x&hl=tr&gl=tr&safe=active");
  });
  test("providers: results, and the answer box, knowledge panel, infobox or answer", () => {
    expect(parseSerpApi({ organic_results: [{ title: "Bun", link: "https://bun.sh", snippet: "A <b>fast</b> runtime", date: "Sep 1" }, { title: "no link" }], answer_box: { type: "weather_result", temperature: "27", unit: "Celsius", weather: "Sunny", location: "Istanbul" } }))
      .toEqual({ results: [{ title: "Bun", url: "https://bun.sh", snippet: "A fast runtime", date: "Sep 1" }], answer: { title: "weather result", text: "27°C", about: "Sunny · Istanbul" } });
    expect(parseSerpApi({ organic_results: [], knowledge_graph: { title: "Tarkan", type: "Singer", description: "Turkish pop star", source: { link: "https://w/t" } } }).answer)
      .toEqual({ title: "Tarkan", text: "Turkish pop star", about: "Singer", url: "https://w/t" });
    expect(parseBrave({ web: { results: [{ title: "Bun", url: "https://bun.sh", description: "<strong>Bun</strong> is", age: "2 days ago" }] }, infobox: { results: [{ title: "Bun", description: "software", long_desc: "A runtime.", thumbnail: { src: "https://i" } }] } }))
      .toEqual({ results: [{ title: "Bun", url: "https://bun.sh", snippet: "Bun is", date: "2 days ago" }], answer: { title: "Bun", text: "A runtime.", about: "software", image: "https://i" } });
    expect(parseSearxng({ results: [{ title: "Bun", url: "https://bun.sh", content: "runtime", publishedDate: "2026-09-01T00:00:00" }], answers: ["42"] }))
      .toEqual({ results: [{ title: "Bun", url: "https://bun.sh", snippet: "runtime", date: "2026-09-01" }], answer: { title: "Answer", text: "42" } });
    expect(parseSummary({ type: "disambiguation", extract: "x" })).toBeUndefined();
  });
});

// ---- the stand-in services ----------------------------------------------------------------

const seen: string[] = [];
const iso = (s: string) => new Uint8Array([...s].map((c) => ({ ç: 0xe7, ı: 0xfd, ğ: 0xf0, ş: 0xfe })[c] ?? c.charCodeAt(0)));
const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const u = new URL(req.url);
    const q = u.searchParams.get("q") ?? "";
    seen.push(`${u.pathname} ${q}`);
    switch (u.pathname) {
      case "/www.google.com/complete/search":
        if (q === "slow") { await Bun.sleep(3000); return new Response(WIZ); }
        if (q.startsWith("çay")) return new Response("<html>changed</html>");
        return new Response(q === "nothing" ? `)]}'\n[[],{}]` : WIZ.replaceAll("tarkan", q));
      case "/suggestqueries.google.com/complete/search":
        return new Response(iso(`["${q}",["${q}ı","${q}kur"]]`), { headers: { "content-type": "text/javascript; charset=ISO-8859-9" } });
      case "/serpapi.com/search.json":
        if (u.searchParams.get("api_key") !== "good") return Response.json({ error: "Invalid API key." }, { status: 401 });
        return Response.json({ organic_results: [1, 2, 3, 4, 5, 6].map((i) => ({ title: `${q} ${i}`, link: `https://site${i}.com/${i}`, snippet: `About ${q} ${i}` })), answer_box: { type: "calculator_result", result: "4" } });
      case "/api.search.brave.com/res/v1/web/search":
        if (req.headers.get("x-subscription-token") !== "b") return Response.json({ message: "bad token" }, { status: 422 });
        return Response.json({ web: { results: [{ title: `Brave ${q}`, url: "https://brave.example/", description: "via <strong>brave</strong>" }] } });
      case "/searx/search":
        return Response.json({ results: [{ title: `Searx ${q}`, url: "https://searx.example/", content: "via searx" }] });
      case "/en.wikipedia.org/api/rest_v1/page/summary/Tarkan":
        return Response.json({ type: "standard", title: "Tarkan", description: "Turkish singer", extract: "Tarkan is a singer.", content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Tarkan" } }, thumbnail: { source: "https://img/t.jpg" } });
    }
    return new Response("not found", { status: 404 });
  },
});

const dir = mkdtempSync(join(tmpdir(), "pal-google-"));
const opened = join(dir, "opened.log");
const BASE = { language: "tr", region: "tr", provider: "none", results: "typing" };
let host: Host;
beforeAll(async () => {
  writeTool(join(dir, "open"), `echo "$@" >> "${opened}"`);
  process.env.PAL_GOOGLE_BASE = `http://127.0.0.1:${server.port}`;
  process.env.PAL_GOOGLE_PREVIEW_MS = "1";
  process.env.PAL_OPEN_URL = join(dir, "open");
  try { host = await Host.bundled({ settings: { google: { settings: BASE } } }); }
  finally { for (const k of ["PAL_GOOGLE_BASE", "PAL_GOOGLE_PREVIEW_MS", "PAL_OPEN_URL"]) delete process.env[k]; }
});
afterAll(() => { host.kill(); server.stop(true); rmSync(dir, { recursive: true, force: true }); });

const list = (q?: string, ctx?: Parameters<Host["list"]>[3]) => host.list("google", "google", q, ctx);
const pick = (id: string, action?: string) => host.pick("google", "google", id, action);
const ids = (items: Item[]) => items.map((i) => i.id);
const settle = (s: Record<string, unknown>) => host.changeSettings("google", { settings: { ...BASE, ...s } });

describe("google", () => {
  test("meta: an input palette with the pane open, nothing the manifest and the code disagree on", () => {
    const l = host.loaded().find((l) => l.extension === "google")!;
    expect(l.warnings).toEqual([]);
    expect(l.palettes[0]).toMatchObject({ title: "Google Search", input: true, showDetail: true, placeholder: "Search Google" });
  });

  test("typed: the query first (its entity line when it is one), then the suggestions, each completing into the box", async () => {
    const rows = await list("tarkan");
    expect(ids(rows)).toEqual(["q:tarkan", "s:tarkan konseri", "s:tarkan & sezen"]);
    expect(rows[0]).toMatchObject({ name: "Search Google for “tarkan”", subtitle: "Şarkıcı-şarkı yazarı", icon: { image: "https://img/tarkan.jpg" }, complete: "tarkan" });
    expect(rows[1]).toMatchObject({ complete: "tarkan konseri" });
    expect(rows[0].actions!.map((a) => a.id)).toEqual(["search", "background", "copy", "copy_link"]);
    expect(seen.at(-1)).toBe("/www.google.com/complete/search tarkan");
    // Asked again: the cache answers.
    const before = seen.length;
    await list("tarkan");
    expect(seen.length).toBe(before);
  });

  test("the homepage endpoint changed shape: the documented one, decoded from ISO-8859-9", async () => {
    const rows = await list("çay");
    expect(rows.map((r) => r.name)).toEqual(["Search Google for “çay”", "çayı", "çaykur"]);
    expect(seen.slice(-2)).toEqual(["/www.google.com/complete/search çay", "/suggestqueries.google.com/complete/search çay"]);
  });

  test("a newer keystroke cancels the older request, whose answer is the query alone", async () => {
    const t0 = performance.now();
    const slow = list("slow");
    await Bun.sleep(50);
    const fast = await list("fast");
    expect(ids(fast)[0]).toBe("q:fast");
    expect(ids(await slow)).toEqual(["q:slow"]);
    expect(performance.now() - t0).toBeLessThan(2500);
  });

  test("the root's late fallback: three suggestions besides the query, opening the palette on cmd+enter; off with the setting", async () => {
    const [sec] = await host.request<{ extension: string; items: Item[] }[]>("fallback/late", { query: "moda" });
    expect(sec.extension).toBe("google");
    expect(ids(sec.items)).toEqual(["s:moda konseri", "s:moda & sezen"]);
    expect(sec.items[0]).toMatchObject({ subtitle: "Google suggestion", complete: "moda konseri" });
    expect(sec.items[0].actions!.map((a) => a.id)).toEqual(["search", "here", "copy"]);
    expect(await pick("s:moda konseri", "here")).toEqual({ push: { extension: "google", palette: "google", query: "moda konseri" } });
    expect(await host.request<unknown[]>("fallback/late", { query: "https://x.y" })).toEqual([]);
    settle({ root: false });
    expect(await host.request<unknown[]>("fallback/late", { query: "moda" })).toEqual([]);
    settle({});
  });

  test("the pane: an entity's Wikipedia card (English when the language has no page); a tip on the query without a provider", async () => {
    await list("tarkan");
    const card = await host.detail("google", "google", "q:tarkan");
    expect(card.markdown).toContain("![](https://img/t.jpg)");
    expect(card.markdown).toContain("Tarkan is a singer.");
    expect(seen).toContain("/tr.wikipedia.org/api/rest_v1/page/summary/Tarkan ");
    const tip = await host.detail("google", "google", "q:plain words");
    expect(tip.markdown).toContain("pick a provider");
  });

  test("SerpApi: the pane previews the answer and five results, cmd+enter lists them as rows; a bad key says so", async () => {
    settle({ provider: "serpapi", serpapi_key: "good" });
    const rows = await list("2+2");
    expect(rows[0].actions!.map((a) => a.id)).toContain("results");
    const d = await host.detail("google", "google", "q:2+2");
    expect(d.markdown).toContain("### 4");
    expect(d.markdown).toContain("**[2+2 5](https://site5.com/5)**");
    expect(d.markdown).not.toContain("site6");
    expect(d.markdown).toContain("lists all 6 here");
    const push = await pick("q:2+2", "results");
    expect(push).toEqual({ push: { extension: "google", palette: "google", args: { results: "2+2" }, title: "2+2" } });
    const before = seen.filter((s) => s.startsWith("/serpapi")).length;
    const level = await list("", { args: { results: "2+2" } });
    expect(seen.filter((s) => s.startsWith("/serpapi")).length).toBe(before); // the preview's answer, reused
    expect(ids(level)).toEqual(["a:2+2", ...[1, 2, 3, 4, 5, 6].map((i) => `r:https://site${i}.com/${i}`)]);
    expect(level[1]).toMatchObject({ name: "2+2 1", subtitle: "About 2+2 1", url: "https://site1.com/1", accessories: [{ text: "site1.com" }] });
    expect(ids(await list("5", { args: { results: "2+2" } }))).toEqual(["r:https://site5.com/5"]);
    expect(await pick("r:https://site1.com/1", "copy_md")).toEqual({ copy: "[2+2 1](https://site1.com/1)" });
    expect(await pick("a:2+2", "copy")).toEqual({ copy: "4" });
    settle({ provider: "serpapi", serpapi_key: "bad" });
    const bad = await list("", { args: { results: "other" } });
    expect(bad[0]).toMatchObject({ id: "hint:failed", subtitle: "SerpApi answered 401: Invalid API key." });
    settle({});
  });

  test("Brave and SearXNG as providers; results when asked only, the pane then keeps to the card or the tip", async () => {
    settle({ provider: "brave", brave_key: "b" });
    expect((await list("", { args: { results: "bun" } }))[0]).toMatchObject({ name: "Brave bun", subtitle: "via brave" });
    settle({ provider: "searxng", searxng_url: `http://127.0.0.1:${server.port}/searx/` });
    expect((await list("", { args: { results: "bun" } }))[0]).toMatchObject({ name: "Searx bun", url: "https://searx.example/" });
    settle({ provider: "searxng", searxng_url: `http://127.0.0.1:${server.port}/searx`, results: "ask" });
    const n = seen.length;
    expect((await host.detail("google", "google", "s:bun later")).markdown).toContain("Tab puts it in the search box");
    expect(seen.length).toBe(n);
    settle({ provider: "brave", brave_key: "" });
    expect(ids(await list("", { args: { results: "bun" } }))).toEqual(["hint:setup"]);
    settle({});
  });

  test("picks: Enter opens the search and remembers it, cmd+b in the background, the chosen browser; recent searches while nothing is typed", async () => {
    expect(await pick("s:tarkan konseri")).toEqual({ open: "https://www.google.com/search?q=tarkan+konseri&hl=tr&gl=tr" });
    expect(await pick("q:istanbul", "background")).toMatchObject({ keep: true, toast: { title: "Opened in the background" } });
    settle({ browser: "Firefox" });
    expect(await pick("q:kadıköy")).toEqual({ hide: true });
    expect(await pick("q:x", "copy_link")).toEqual({ copy: "https://www.google.com/search?q=x&hl=tr&gl=tr" });
    settle({});
    const lines = () => { try { return readFileSync(opened, "utf8").trim().split("\n"); } catch { return []; } };
    await host.until(() => lines().length === 2, 3000, "both opens logged");
    expect(lines().sort()).toEqual([
      "Firefox https://www.google.com/search?q=kad%C4%B1k%C3%B6y&hl=tr&gl=tr",
      "default https://www.google.com/search?q=istanbul&hl=tr&gl=tr background",
    ]);
    let empty = await list("");
    expect(ids(empty)).toEqual(["hint:type", "h:kadıköy", "h:istanbul", "h:tarkan konseri", "h:2+2"]);
    expect(empty[1]).toMatchObject({ section: "Recent searches", complete: "kadıköy" });
    await pick("h:istanbul", "remove");
    expect(ids(await list(""))).toEqual(["hint:type", "h:kadıköy", "h:tarkan konseri", "h:2+2"]);
    await pick("h:kadıköy", "clear");
    empty = await list("");
    expect(ids(empty)).toEqual(["hint:type"]);
  });

  test("no suggestions: the query row alone", async () => {
    const rows = await list("nothing");
    expect(ids(rows)).toEqual(["q:nothing"]);
  });
});
