// A Bun mock of Giphy v1 (`/v1/gifs/search`, `/v1/gifs/trending`) for
// the gifs tests and the screenshot fixture: the reply shapes are the
// documented ones, trimmed to the fields read, with the media urls
// pointing back at the mock, which serves a generated picture for each
// (`png.ts`). The key `good` is accepted; anything else is Giphy's 401.
// `requests` records every call.
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
        const [, , n, kind] = url.pathname.replace(/\.gif$/, "").split("/");
        // The full gif is the preview's picture at twice the size, so a download is told from a preview by its bytes.
        const big = kind === "original";
        return new Response(picture(Number(n), big ? 192 : 96, big ? 144 : 72), { headers: { "content-type": "image/gif" } });
      }
      const q = url.searchParams.get("q") ?? undefined;
      const pick = (n: number) => (q ? TITLES.filter((t) => t.includes(q.toLowerCase())) : TITLES).slice(0, n);
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
