// Writes app/src/gallery/shots/google.json, the store screenshots' fixture:
// the palette listed through the host harness against a stand-in for
// Google's suggest, Wikipedia and SerpApi, every answer made up here.
// `bun run extensions/google/fixture.ts`, then `node app/scripts/shots.mjs google`.
import { writeFileSync } from "node:fs";
import { Host } from "../../host/test/harness.ts";

const sugg = (q: string, rows: [string, { zh: string; zi: string }?][]) => `)]}'\n${JSON.stringify([rows.map(([t, e]) => [t.replace(q, `${q}<b>`) + (t === q ? "" : "</b>"), e ? 46 : 0, [512], ...(e ? [e] : [])]), {}])}`;
const SUGGEST: Record<string, string> = {
  kadıköy: sugg("kadıköy", [["kadıköy", { zh: "Kadıköy", zi: "İstanbul'da bir ilçe" }], ["kadıköy vapur saatleri"], ["kadıköy kahvaltı"], ["kadıköy moda sahil"], ["kadıköy çarşı"], ["kadıköy boğa heykeli"], ["kadıköy sinema"]]),
  "bun runtime": sugg("bun runtime", [["bun runtime"], ["bun runtime vs node"], ["bun runtime install"], ["bun runtime benchmark"], ["bun runtime windows"]]),
};
const RESULTS = [
  ["Bun: a fast all-in-one JavaScript runtime", "https://bun.sh/", "Bundle, install and run JavaScript and TypeScript, all in one tool: a runtime, a package manager, a test runner and a bundler."],
  ["Installation | Bun docs", "https://bun.sh/docs/installation", "Bun ships as a single executable with no dependencies. Install it with curl, npm, Homebrew or Docker."],
  ["Bun vs Node.js: what changes for a real project", "https://blog.example.dev/bun-vs-node", "We moved a mid-sized API to Bun for a month. Startup, install times and the test runner, measured."],
  ["oven-sh/bun on GitHub", "https://github.com/oven-sh/bun", "Incredibly fast JavaScript runtime, bundler, test runner, and package manager, all in one."],
  ["Bun (software) - Wikipedia", "https://en.wikipedia.org/wiki/Bun_(software)", "Bun is a JavaScript runtime, package manager and test runner designed as a drop-in replacement for Node.js."],
  ["Benchmarks: HTTP servers compared", "https://bench.example.org/http", "Requests per second for the same handler across runtimes, on one machine, three runs each."],
];
const server = Bun.serve({
  port: 0,
  fetch(req) {
    const u = new URL(req.url), q = u.searchParams.get("q") ?? "";
    if (u.pathname.endsWith("/complete/search")) return new Response(SUGGEST[q] ?? `)]}'\n[[],{}]`);
    if (u.pathname.includes("wikipedia.org") && u.pathname.endsWith("/Kad%C4%B1k%C3%B6y")) return Response.json({ type: "standard", title: "Kadıköy", description: "İstanbul'un bir ilçesi", extract: "Kadıköy, İstanbul'un Anadolu yakasında, Marmara Denizi kıyısında bir ilçedir. Moda, Fenerbahçe ve Bahariye caddesiyle bilinir; Avrupa yakasına vapurla bağlanır.", content_urls: { desktop: { page: "https://tr.wikipedia.org/wiki/Kad%C4%B1k%C3%B6y" } } });
    if (u.pathname === "/serpapi.com/search.json") return Response.json({ organic_results: RESULTS.map(([title, link, snippet]) => ({ title, link, snippet })), knowledge_graph: { title: "Bun", type: "JavaScript runtime", description: "A fast JavaScript runtime, package manager, bundler and test runner.", source: { link: "https://bun.sh/" } } });
    return new Response("not found", { status: 404 });
  },
});
process.env.PAL_GOOGLE_BASE = `http://127.0.0.1:${server.port}`;
process.env.PAL_GOOGLE_PREVIEW_MS = "1";
const settings = { language: "tr", region: "tr" };
const host = await Host.bundled({ settings: { google: { settings } } });
try {
  const meta = host.loaded().find((l) => l.extension === "google")!.palettes[0];
  const list = (q: string, ctx?: Parameters<Host["list"]>[3]) => host.list("google", "google", q, ctx);
  const byQuery: Record<string, unknown> = { kadıköy: await list("kadıköy") };
  const details: Record<string, unknown> = { "q:kadıköy": await host.detail("google", "google", "q:kadıköy") };
  host.changeSettings("google", { settings: { ...settings, provider: "serpapi", serpapi_key: "made-up" } });
  byQuery["bun runtime"] = await list("bun runtime");
  details["q:bun runtime"] = await host.detail("google", "google", "q:bun runtime");
  const results = await list("", { args: { results: "bun runtime" } });
  const fixture = {
    palettes: {
      google: { title: meta.title, icon: meta.icon, input: true, placeholder: meta.placeholder, showDetail: true, byQuery, details },
      "google-results": { title: "bun runtime", icon: meta.icon, input: true, showDetail: true, items: results },
    },
    shots: {
      "1-suggestions": { palette: "google", keys: ["type:kadıköy", "wait:400"] },
      "2-preview": { palette: "google", keys: ["type:bun runtime", "wait:400"] },
      "3-results": { palette: "google-results", keys: ["down", "wait:300"] },
      "4-actions": { palette: "google-results", keys: ["down", "cmd+k"] },
    },
  };
  writeFileSync(new URL("../../app/src/gallery/shots/google.json", import.meta.url), JSON.stringify(fixture, null, 2) + "\n");
  console.log("wrote app/src/gallery/shots/google.json");
} finally {
  host.kill();
  server.stop(true);
}
