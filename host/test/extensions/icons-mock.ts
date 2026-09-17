// A stand-in for api.iconify.design: `/search?query=` answers the names
// whose word matches from a few made-up icons in three sets (the
// `collections` block naming the sets, `prefixes=` honoured), and
// `/<prefix>.json?icons=` the bodies. Counts every request; `fail` and
// `limited` switch the next answer to a 500 or a 429.
export type Mock = { url: string; hits: string[]; fail: boolean; limited: boolean; stop: () => void };

const SETS: Record<string, { name: string; width: number; height: number; icons: Record<string, { body: string; width?: number; height?: number }> }> = {
  mdi: { name: "Material Design Icons", width: 24, height: 24, icons: {
    home: { body: '<path fill="currentColor" d="M10 20v-6h4v6h5v-8h3L12 3L2 12h3v8z"/>' },
    "home-outline": { body: '<path fill="currentColor" d="M12 5.69L17 10.19V18h-2v-6H9v6H7v-7.81zM12 3L2 12h3v8h6v-6h2v6h6v-8h3z"/>' },
    "arrow-left": { body: '<path fill="currentColor" d="M20 11v2H8l5.5 5.5l-1.42 1.42L4.16 12l7.92-7.92L13.5 5.5L8 11z"/>' },
  } },
  tabler: { name: "Tabler Icons", width: 24, height: 24, icons: {
    home: { body: '<path fill="none" stroke="currentColor" stroke-width="2" d="M5 12H3l9-9l9 9h-2M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>' },
    "arrow-left": { body: '<path fill="none" stroke="currentColor" stroke-width="2" d="M5 12h14M5 12l6 6m-6-6l6-6"/>' },
  } },
  lucide: { name: "Lucide", width: 24, height: 24, icons: {
    house: { body: '<path fill="none" stroke="currentColor" stroke-width="2" d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/>', width: 24, height: 24 },
  } },
};

export function startMock(): Mock {
  const m: Mock = { url: "", hits: [], fail: false, limited: false, stop: () => {} };
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const u = new URL(req.url);
      m.hits.push(u.pathname + u.search);
      if (m.fail) { m.fail = false; return new Response("boom", { status: 500 }); }
      if (m.limited) { m.limited = false; return new Response("slow down", { status: 429 }); }
      if (u.pathname === "/search") {
        const q = (u.searchParams.get("query") ?? "").toLowerCase();
        const only = (u.searchParams.get("prefixes") ?? "").split(",").filter(Boolean);
        const icons: string[] = [];
        const collections: Record<string, { name: string }> = {};
        for (const [prefix, set] of Object.entries(SETS)) {
          if (only.length && !only.includes(prefix)) continue;
          for (const name of Object.keys(set.icons)) if (name.includes(q)) { icons.push(`${prefix}:${name}`); collections[prefix] = { name: set.name }; }
        }
        return Response.json({ icons: icons.slice(0, Number(u.searchParams.get("limit") ?? 64)), total: icons.length, collections });
      }
      const set = u.pathname.match(/^\/([a-z0-9-]+)\.json$/);
      if (set && SETS[set[1]]) {
        const s = SETS[set[1]];
        const want = (u.searchParams.get("icons") ?? "").split(",");
        const icons: Record<string, unknown> = {};
        const not_found: string[] = [];
        for (const n of want) (s.icons[n] ? (icons[n] = s.icons[n]) : not_found.push(n));
        return Response.json({ prefix: set[1], icons, width: s.width, height: s.height, ...(not_found.length && { not_found }) });
      }
      return new Response("not found", { status: 404 });
    },
  });
  m.url = `http://127.0.0.1:${server.port}`;
  m.stop = () => server.stop(true);
  return m;
}
