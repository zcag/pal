// Crossword's fixtures: hand-made minis (the grids filled from common words,
// the clues written here; no Crosshare puzzle is ever copied into the repo)
// as ipuz, and a stand-in for crosshare.org serving them the way the site
// does: a month of daily minis and a page of the newest minis as Next.js
// pages with the list in __NEXT_DATA__, and /api/ipuz/<id>.
import type { Ipuz } from "../../../extensions/crossword/ipuz.ts";

/** An ipuz from the grid's rows ("#" a block) and the clues by number, as Crosshare writes it. */
export function ipuz(title: string, author: string, rows: string[], across: Record<number, string>, down: Record<number, string>, notes = "Created on crosshare.org"): Ipuz {
  return {
    version: "http://ipuz.org/v2", kind: ["http://ipuz.org/crossword#1"], title, author, copyright: `Copyright ${author}, all rights reserved`, notes,
    dimensions: { width: rows[0].length, height: rows.length },
    puzzle: rows.map((r) => [...r].map((c) => (c === "#" ? "#" : 0))),
    solution: rows.map((r) => [...r].map((c) => (c === "#" ? "#" : c))),
    clues: {
      Across: Object.entries(across).map(([n, clue]) => ({ number: Number(n), clue })),
      Down: Object.entries(down).map(([n, clue]) => ({ number: Number(n), clue })),
    },
  };
}

export const TALL = ipuz("Standing Tall", "Pat Quill", ["#TALL", "BELIE", "OPINE", "SEVER", "SEED#"],
  { 1: "Like a giraffe", 5: "Give a false impression of", 6: "Share one's two cents", 7: "Cut, as ties", 8: "What a sunflower grows from" },
  { 1: "Cone-shaped dwelling", 2: "Kicking, as they say", 3: "Ruled, as notebook paper", 4: "Sly look", 5: "One who signs the paychecks" },
  "A mini about things that grow up. - Created on crosshare.org");

export const DUMP = ipuz("Kitchen Table", "Robin Vale", ["#DUMP", "BEVEL", "ABUSE", "SALSA", "TRAY#"],
  { 1: "Landfill, informally", 5: "Slanted edge on a mirror", 6: "Misuse", 7: "Chip dip that can be mild or hot", 8: "Cafeteria carrier" },
  { 1: "Keep out, formally", 2: "Dangler at the back of the throat", 3: "Like a teenager's room, stereotypically", 4: "Guilty or not guilty, e.g.", 5: "Fiber used in matting" });

export const CART = ipuz("Square Deal", "Pat Quill", ["CART", "AREA", "REAL", "TALE"],
  { 1: "Shopping ___", 5: "Square footage", 6: "Not fake", 7: "Bedtime story" },
  { 1: "Golf ___", 2: "Zone", 3: "___ estate", 4: "Fairy ___" });

export type Day = { day: number; id: string; title: string; author: string; w?: number; h?: number };
export type Tagged = { id: string; title: string; author: string; w?: number; h?: number };

const page = (props: unknown) =>
  `<!doctype html><html><head><title>Crosshare</title></head><body><div id="__next"></div><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: props }, page: "/x" })}</script></body></html>`;

/** A /dailyminis page: `month` 1-based, the site's props carry it 0-based. */
export const monthPage = (year: number, month: number, days: Day[]) =>
  page({ year, month: month - 1, puzzles: [...days].sort((a, b) => b.day - a.day).map((d) => [d.day, { id: d.id, title: d.title, authorName: d.author, guestConstructor: null, size: { rows: d.h ?? 5, cols: d.w ?? 5 } }, { i: "x", n: d.author, u: "u" }, false]) });

export const tagPage = (items: Tagged[], nextPage: number | null) =>
  page({ tags: ["mini"], puzzles: items.map((t) => ({ id: t.id, title: t.title, authorName: t.author, guestConstructor: null, size: { rows: t.h ?? 5, cols: t.w ?? 5 } })), currentPage: 0, prevPage: null, nextPage });

/** The stand-in site: months by "YYYY-MM", tag pages by number, puzzles by id. Every request is counted in `hits`; `down` answers 503 to all, `delay` holds each answer (the page's loading state). */
export function fakeCrosshare(site: { months: Record<string, Day[]>; tags: Tagged[][]; puzzles: Record<string, Ipuz> }) {
  const hits: string[] = [];
  let down = false, delay = 0;
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const path = new URL(req.url).pathname;
      hits.push(path);
      if (delay) await Bun.sleep(delay);
      if (down) return new Response("unavailable", { status: 503 });
      let m = /^\/dailyminis\/(\d{4})\/(\d{1,2})$/.exec(path);
      if (m) {
        const days = site.months[`${m[1]}-${m[2].padStart(2, "0")}`];
        return days ? new Response(monthPage(Number(m[1]), Number(m[2]), days), { headers: { "content-type": "text/html" } }) : new Response("not found", { status: 404 });
      }
      m = /^\/tags\/mini\/page\/(\d+)$/.exec(path);
      if (m) {
        const n = Number(m[1]), items = site.tags[n];
        return items ? new Response(tagPage(items, site.tags[n + 1] ? n + 1 : null)) : new Response("not found", { status: 404 });
      }
      m = /^\/api\/ipuz\/([\w-]+)$/.exec(path);
      if (m && site.puzzles[m[1]]) return Response.json(site.puzzles[m[1]]);
      return new Response("not found", { status: 404 });
    },
  });
  return { url: `http://127.0.0.1:${server.port}`, hits, stop: () => server.stop(true), set down(v: boolean) { down = v; }, set delay(ms: number) { delay = ms; } };
}
