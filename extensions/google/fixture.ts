// Writes app/src/gallery/shots/google.json, the store screenshots' fixture:
// the palette listed through the host harness against a stand-in for
// Google's suggest, Wikipedia and SerpApi, every answer made up here.
// `make shots EXT=google`.
import { pinClock, settle, writeFixture } from "../../app/scripts/fixture-kit.ts";
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
    // A query about Node ranks the comparison first, as a search engine would.
    if (u.pathname === "/serpapi.com/search.json") return Response.json({ organic_results: (q.includes("node") ? [RESULTS[2], ...RESULTS.filter((r) => r !== RESULTS[2])] : RESULTS).map(([title, link, snippet]) => ({ title, link, snippet })), knowledge_graph: { title: "Bun", type: "JavaScript runtime", description: "A fast JavaScript runtime, package manager, bundler and test runner.", source: { link: "https://bun.sh/" } } });
    return new Response("not found", { status: 404 });
  },
});
process.env.PAL_GOOGLE_BASE = `http://127.0.0.1:${server.port}`;
process.env.PAL_GOOGLE_PREVIEW_MS = "1";
process.env.PAL_GOOGLE_RESULTS_MS = "1";
const settings = { language: "tr", region: "tr" };
pinClock();
const host = await Host.bundled({ settings: { google: { settings } } });
try {
  const meta = host.loaded().find((l) => l.extension === "google")!.palettes[0];
  const list = (q: string, ctx?: Parameters<Host["list"]>[3]) => host.list("google", "google", q, ctx);
  const byQuery: Record<string, unknown> = { kadıköy: await list("kadıköy") };
  const details: Record<string, unknown> = { "q:kadıköy": await host.detail("google", "google", "q:kadıköy") };
  host.changeSettings("google", { settings: { ...settings, provider: "serpapi", serpapi_key: "made-up" } });
  // Streamed as the panel asks: the suggestions, then the answer and the top results under them once the query rests.
  byQuery["bun runtime"] = (await host.listStream("google", "google", "bun runtime")).items;
  const suggestion = (byQuery["bun runtime"] as { id: string }[])[1].id;
  details[suggestion] = await host.detail("google", "google", suggestion);
  const results = await list("", { args: { results: "bun runtime" } });
  const fixture = {
    palettes: {
      google: { title: meta.title, icon: meta.icon, input: true, placeholder: meta.placeholder, showDetail: true, byQuery, details },
      "google-results": { title: "bun runtime", icon: meta.icon, input: true, showDetail: true, items: results },
    },
    // True colour: on the dark wallpaper the 256-colour quantisation greys the tile and turns the blue glyphs lavender.
    shots: {
      "1-suggestions": { palette: "google", keys: ["wait:400", "type:kadıköy", "wait:400"], caption: "kadıköy typed: Google's suggestions, the district's Wikipedia card in the pane" },
      "2-preview": { palette: "google", keys: ["wait:400", "type:bun runtime", "wait:300", "down", "wait:400"], caption: "With SerpApi: the answer and the top results join the list as you type, and the pane previews a suggestion's" },
      "3-results": { palette: "google-results", keys: ["down", "wait:300"], caption: "cmd+Enter: the answer and the results as rows, each with its site" },
      "4-actions": { palette: "google-results", keys: ["down", "cmd+k"], caption: "What a result can do: open, open in the background, copy the link or a Markdown link" },
    },
  };
  writeFixture("google", await settle(fixture));
  console.log("wrote app/src/gallery/shots/google.json");
} finally {
  host.kill();
  server.stop(true);
}
