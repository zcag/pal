// A Bun mock of the YouTube Data API v3 (`/search`, `/videos`) and an
// Invidious instance (`/api/v1/search`, `/api/v1/trending`,
// `/api/v1/channels/:id/videos`) for the youtube tests and the screenshot
// fixture: the reply shapes are the documented ones (the Invidious ones
// what invidious.f5.si answered on 2026-09-17), trimmed to the fields
// read. The Data API key `good` is accepted, `quota` answers the
// quotaExceeded error, anything else 400. `requests` records every call.

export type Seen = { path: string; params: Record<string, string> };

const NOW = Math.floor(Date.now() / 1000); // what `published` is relative to, so the ages read the same on any day
export const VIDEOS = [
  { id: "rFZHOHl-L8A", title: "lofi hip hop radio 📚 beats to relax/study to", channel: "Lofi Girl", channelId: "UCSJ4gkVC6NrvII8umztf0Ow", seconds: 0, views: 0, published: NOW - 60, live: true },
  { id: "UJs6__K7gSY", title: "Bedtime Lofi 💤  8 hours of relaxing beats to sleep to", channel: "Lofi Girl", channelId: "UCSJ4gkVC6NrvII8umztf0Ow", seconds: 28828, views: 6800000, published: NOW - 330 * 86400 },
  { id: "dYuNh58nLt8", title: "🍂 Chillhop Essentials · Fall 2026 [jazzy lofi beats / no AI]", channel: "Chillhop Music", channelId: "UCOxqgCwgOqC2lMqC5PYz_Dg", seconds: 3516, views: 178488, published: NOW - 14 * 86400 },
  { id: "ydY2FvooX-Q", title: "Relaxing Fall Jazz in Lakeside 🍂 Cozy Coffee Shop Ambience & Smooth Jazz Instrumental Music to Study", channel: "Relax Jazz Cafe", channelId: "UCZR3-lM6Z-n5_UGHlwx_Rpw", seconds: 13393, views: 35238, published: NOW - 86400 },
  { id: "5yx6BWlEVcY", title: "Chillhop Radio - jazzy & lofi hip hop beats 🐾", channel: "Chillhop Music", channelId: "UCOxqgCwgOqC2lMqC5PYz_Dg", seconds: 0, views: 0, published: NOW - 120, live: true },
  { id: "MYPVQccHhAQ", title: "4K Cozy Coffee Shop with Smooth Piano Jazz Music for Relaxing, Studying and Working", channel: "Relaxing Jazz Piano", channelId: "UC84t1K5ri-7u9bFCaUKTXDA", seconds: 12923, views: 72385856, published: NOW - 4 * 365 * 86400 },
  { id: "Ld7Xf_LUL2w", title: "1950s New York Café Jazz | Vintage Diner Coffee Shop Ambience", channel: "Vintage City Echoes", channelId: "UCFreD1WCJoZysrRcMNAAzrA", seconds: 4069, views: 243931, published: NOW - 92 * 86400 },
];
export const CHANNELS = [
  { id: "UCSJ4gkVC6NrvII8umztf0Ow", title: "Lofi Girl", subs: 15800000, description: "Connecting people through music.", avatar: "P2GSa5qZ0deWYGMqnq6cnWoWdxtXzK9s09ls0s_OlIMKx_3Vwjl3tdotbkLFjRmCPN1p7ox6" },
  { id: "UCOxqgCwgOqC2lMqC5PYz_Dg", title: "Chillhop Music", subs: 5200000, description: "Chill beats, jazz-hop and lofi, every day.", avatar: "5sz00tGeNdll17IqVECF7s7shUzz0nlirAK86WgY0yz7-4t2S51_XMvjM7HaJfdwNlM6rm_Hrg" },
];
/** The channels' real avatar urls (public); Invidious hands them protocol-relative, as the real instance did. */
const avatar = (hash: string, w: number, relative = false) => `${relative ? "" : "https:"}//yt3.ggpht.com/${hash}=s${w}-c-k-c0x00ffffff-no-rj`;
const iso = (s: number) => (s <= 0 ? "P0D" : `PT${Math.floor(s / 3600) ? `${Math.floor(s / 3600)}H` : ""}${Math.floor((s % 3600) / 60) ? `${Math.floor((s % 3600) / 60)}M` : ""}${s % 60 ? `${s % 60}S` : ""}`);
const hit = (q: string | null, v: { title: string; channel: string }) => !q || `${v.title} ${v.channel}`.toLowerCase().includes(q.toLowerCase());

export function startMock() {
  const requests: Seen[] = [];
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      const p = Object.fromEntries(url.searchParams);
      requests.push({ path: url.pathname, params: p });
      // ---- Data API v3
      if (url.pathname === "/search" || url.pathname === "/videos") {
        if (p.key === "quota") return Response.json({ error: { code: 403, message: "quota", errors: [{ reason: "quotaExceeded", domain: "youtube.quota" }] } }, { status: 403 });
        if (p.key !== "good") return Response.json({ error: { code: 400, message: "API key not valid", errors: [{ reason: "badRequest" }] } }, { status: 400 });
        const snippet = (v: (typeof VIDEOS)[number]) => ({ publishedAt: new Date(v.published * 1000).toISOString(), channelId: v.channelId, title: v.title, description: "", thumbnails: { default: { url: `https://i.ytimg.com/vi/${v.id}/default.jpg`, width: 120, height: 90 } }, channelTitle: v.channel, liveBroadcastContent: v.live ? "live" : "none" });
        if (url.pathname === "/search" && p.type === "channel") return Response.json({ kind: "youtube#searchListResponse", items: CHANNELS.filter((c) => c.title.toLowerCase().includes((p.q ?? "").toLowerCase())).map((c) => ({ kind: "youtube#searchResult", id: { kind: "youtube#channel", channelId: c.id }, snippet: { title: c.title, description: c.description, thumbnails: { default: { url: avatar(c.avatar, 88) } } } })) });
        if (url.pathname === "/search") {
          const list = VIDEOS.filter((v) => (p.channelId ? v.channelId === p.channelId : hit(p.q ?? null, v)));
          return Response.json({ kind: "youtube#searchListResponse", pageInfo: { totalResults: list.length }, items: list.map((v) => ({ kind: "youtube#searchResult", id: { kind: "youtube#video", videoId: v.id }, snippet: snippet(v) })) });
        }
        const list = p.chart === "mostPopular" ? [...VIDEOS].reverse() : VIDEOS.filter((v) => (p.id ?? "").split(",").includes(v.id));
        return Response.json({ kind: "youtube#videoListResponse", items: list.map((v) => ({ kind: "youtube#video", id: v.id, snippet: snippet(v), contentDetails: { duration: iso(v.seconds), dimension: "2d", definition: "hd" }, statistics: { viewCount: String(v.views), likeCount: "1" } })) });
      }
      // ---- Invidious
      const inv = (v: (typeof VIDEOS)[number]) => ({ type: "video", title: v.title, videoId: v.id, author: v.channel, authorId: v.channelId, authorUrl: `/channel/${v.channelId}`, videoThumbnails: [{ quality: "default", url: `${url.origin}/vi/${v.id}/default.jpg`, width: 120, height: 90 }], viewCount: v.views, viewCountText: `${v.views} views`, published: v.published, publishedText: "", lengthSeconds: v.seconds, liveNow: !!v.live, premium: false, isUpcoming: false });
      if (url.pathname === "/api/v1/search") {
        if (p.type === "channel") return Response.json(CHANNELS.filter((c) => c.title.toLowerCase().includes((p.q ?? "").toLowerCase())).map((c) => ({ type: "channel", author: c.title, authorId: c.id, authorUrl: `/channel/${c.id}`, authorVerified: true, authorThumbnails: [32, 48, 76, 100, 176, 512].map((w) => ({ url: avatar(c.avatar, w, true), width: w, height: w })), subCount: c.subs, videoCount: 0, description: c.description })));
        return Response.json(VIDEOS.filter((v) => hit(p.q ?? null, v)).map(inv));
      }
      if (url.pathname === "/api/v1/trending") return Response.json([...VIDEOS].reverse().map(inv));
      const m = /^\/api\/v1\/channels\/([^/]+)\/videos$/.exec(url.pathname);
      if (m) return Response.json({ videos: VIDEOS.filter((v) => v.channelId === decodeURIComponent(m[1])).map(inv), continuation: null });
      if (url.pathname === "/api/v1/disabled") return new Response("Endpoint disabled", { status: 403, headers: { "content-type": "text/plain" } });
      if (url.pathname.startsWith("/captcha")) return new Response("<html>Verifying your browser…</html>", { headers: { "content-type": "text/html" } });
      return new Response("no", { status: 404 });
    },
  });
  return { server, requests, base: `http://127.0.0.1:${server.port}` };
}
