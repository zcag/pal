// A Bun mock of Tenor v2 (`/v2/search`, `/v2/featured`) and Giphy v1
// (`/v1/gifs/search`, `/v1/gifs/trending`) for the gifs tests and the
// screenshot fixture: the reply shapes are the documented ones, trimmed
// to the fields read, with the media urls pointing back at the mock, which
// serves a generated picture for each (`png.ts`). The key `good` is
// accepted; anything else is Tenor's 403 / Giphy's 401. `requests`
// records every call.
import { picture } from "../png.ts";

export type Seen = { path: string; q?: string; key?: string; filter?: string };

const TITLES = ["happy dance", "cat typing", "thumbs up", "mind blown", "facepalm", "slow clap", "excited", "no way", "eye roll", "high five", "shrug", "popcorn", "cat nap", "monday", "coffee first", "deal with it", "nailed it", "bye"];

export function startMock() {
  const requests: Seen[] = [];
  const server = Bun.serve({
    port: 0,
    fetch(req): Response {
      const url = new URL(req.url);
      const media = (n: number, kind: string): string => `${url.origin}/media/${n}/${kind}.gif`;
      if (url.pathname.startsWith("/media/")) {
        const [, , n, kind] = url.pathname.split("/");
        // The full gif is the preview's picture at twice the size, so a download is told from a preview by its bytes.
        const big = kind.startsWith("gif") || kind === "original";
        return new Response(picture(Number(n), big ? 192 : 96, big ? 144 : 72), { headers: { "content-type": "image/gif" } });
      }
      const q = url.searchParams.get("q") ?? undefined;
      const pick = (n: number) => (q ? TITLES.filter((t) => t.includes(q.toLowerCase())) : TITLES).slice(0, n);
      if (url.pathname === "/v2/search" || url.pathname === "/v2/featured") {
        const key = url.searchParams.get("key") ?? "";
        requests.push({ path: url.pathname, q, key, filter: url.searchParams.get("contentfilter") ?? undefined });
        if (key !== "good") return Response.json({ error: { code: 403, message: "API key not valid", status: "PERMISSION_DENIED" } }, { status: 403 });
        const results = pick(Number(url.searchParams.get("limit") ?? 20)).map((title, i) => {
          const n = TITLES.indexOf(title);
          return { id: `t${n}`, title: "", content_description: title, itemurl: `https://tenor.com/view/${title.replace(/ /g, "-")}-gif-${n}`, url: `https://tenor.com/b${n}.gif`, created: 1700000000 + n, tags: title.split(" "), hasaudio: false, flags: [],
            media_formats: { gif: { url: media(n, "gif"), dims: [498, 373], duration: 1.2, size: 900000 + n * 1000 }, tinygif: { url: media(n, "tinygif"), dims: [220, 165], size: 90000 }, nanogif: { url: media(n, "nanogif"), dims: [120, 90], size: 30000 } } };
        });
        return Response.json({ results, next: results.length ? "next-token" : "" });
      }
      if (url.pathname === "/v1/gifs/search" || url.pathname === "/v1/gifs/trending") {
        const key = url.searchParams.get("api_key") ?? "";
        requests.push({ path: url.pathname, q, key, filter: url.searchParams.get("rating") ?? undefined });
        if (key !== "good") return Response.json({ data: [], meta: { status: 401, msg: "Unauthorized", response_id: "" } }, { status: 401 });
        const data = pick(Number(url.searchParams.get("limit") ?? 25)).map((title) => {
          const n = TITLES.indexOf(title);
          return { type: "gif", id: `g${n}abc`, url: `https://giphy.com/gifs/${title.replace(/ /g, "-")}-g${n}abc`, title: `${title.replace(/\b\w/g, (c) => c.toUpperCase())} GIF`, rating: "g",
            images: { original: { url: media(n, "original"), width: "480", height: "360", size: String(1200000 + n) }, fixed_height_small: { url: media(n, "fixed_height_small"), width: "133", height: "100" }, preview_gif: { url: media(n, "preview_gif"), width: "100", height: "75" } } };
        });
        return Response.json({ data, pagination: { total_count: data.length, count: data.length, offset: 0 }, meta: { status: 200, msg: "OK", response_id: "x" } });
      }
      return new Response("no", { status: 404 });
    },
  });
  return { server, requests, base: `http://127.0.0.1:${server.port}`, titles: TITLES };
}
