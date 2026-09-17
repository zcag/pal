// gifs: the reply parser first (backends.ts, pure, on the documented
// shape), then the palette over the wire against the Bun mock of Giphy
// (gifs-mock.ts, reached through `PAL_GIFS_GIPHY`) with the cache in a
// temp dir (`PAL_GIFS_CACHE`): trending, a search, the previews as data
// urls made once, the picks (the file on the clipboard, the url, the
// page, a save, a favourite), the Favourites grid, the missing and
// refused keys, the content filter as Giphy's rating, the debounce.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileName, GIPHY_RATING, mimeOf, parseGiphy } from "../../../extensions/gifs/backends.ts";
import { tile } from "../../../sdk/src/icon.ts";
import type { Item } from "../../../sdk/src/protocol.ts";
import { picture } from "../png.ts";
import { Host, stored } from "../harness.ts";
import { startMock } from "./gifs-mock.ts";

describe("backends", () => {
  test("parseGiphy: original is the file, fixed_height_small (else preview_gif) the preview, the trailing GIF dropped from the title, sizes read from strings; a result without an original is dropped", () => {
    const r = parseGiphy({ data: [
      { id: "abc", title: "Happy Dance GIF", url: "https://giphy.com/gifs/abc", images: { original: { url: "https://g/o.gif", width: "480", height: "270", size: "99" }, fixed_height_small: { url: "https://g/s.gif", width: "178", height: "100" } } },
      { id: "def", title: "", images: { original: { url: "https://g/o2.gif" }, preview_gif: { url: "https://g/p2.gif" } } },
      { id: "x" },
    ] });
    expect(r).toEqual([
      { id: "giphy:abc", backend: "giphy", title: "Happy Dance", page: "https://giphy.com/gifs/abc", gif: "https://g/o.gif", preview: "https://g/s.gif", width: 480, height: 270, size: 99 },
      { id: "giphy:def", backend: "giphy", title: "GIF", page: "", gif: "https://g/o2.gif", preview: "https://g/p2.gif", width: 0, height: 0, size: undefined },
    ]);
    expect(parseGiphy({})).toEqual([]);
    expect(GIPHY_RATING).toEqual({ off: "r", low: "pg-13", medium: "pg", high: "g" });
  });

  test("fileName is the title, safe for a file system, .gif; mimeOf sniffs the bytes", () => {
    const g = { id: "giphy:1", backend: "giphy" as const, title: 'What? A "cat" / dog: yes', page: "", gif: "", preview: "", width: 0, height: 0 };
    expect(fileName(g)).toBe("What A cat dog yes.gif");
    expect(fileName({ ...g, title: "   " })).toBe("gif.gif");
    expect(mimeOf(Buffer.from("GIF89a...."))).toBe("image/gif");
    expect(mimeOf(picture(1))).toBe("image/png");
    expect(mimeOf(Buffer.from("RIFF....WEBPVP8 "))).toBe("image/webp");
  });
});

// ---- the palette over the wire ------------------------------------------------------

const { server, requests, base, titles } = startMock();
const dir = mkdtempSync(join(tmpdir(), "pal-gifs-"));
const cache = join(dir, "cache"), downloads = join(dir, "Downloads");
/** The mock titles its GIFs in Title Case (plus a trailing "GIF", which the parser drops). */
const shown = titles.map((t) => t.replace(/\b\w/g, (c) => c.toUpperCase()));

let host: Host;
beforeAll(async () => {
  process.env.PAL_GIFS_GIPHY = base;
  process.env.PAL_GIFS_CACHE = cache;
  stored.clear();
  host = await Host.bundled({ settings: { gifs: { settings: { giphy_api_key: "good", save_to: downloads } } } });
});
afterAll(() => {
  host.kill();
  server.stop(true);
  rmSync(dir, { recursive: true, force: true });
  delete process.env.PAL_GIFS_GIPHY; delete process.env.PAL_GIFS_CACHE;
});

const list = (q?: string) => host.list("gifs", "gifs", q);
const pick = (id: string, action?: string) => host.pick("gifs", "gifs", id, action);
const names = (items: Item[]) => items.map((i) => i.name);
const dataUrl = (i: Item) => (i.icon as { image?: string })?.image ?? "";

describe("gifs", () => {
  test("meta: an input grid on the pink tile with a fallback row, six columns from the palette setting; the favourites a live grid; no warnings", () => {
    const l = host.loaded().find((l) => l.extension === "gifs")!;
    expect(l.warnings).toEqual([]);
    expect(l.palettes.map((p) => p.name)).toEqual(["gifs", "favourites"]);
    expect(l.palettes[0]).toMatchObject({ title: "GIFs", input: true, view: "grid", columns: 6, fallback: "ask", fallbackTitle: "Search GIFs for “{query}”", icon: tile("pink", "\u{f0d78}") });
    expect(l.palettes[1]).toMatchObject({ title: "Favourite GIFs", live: true, view: "grid", columns: 6 });
  });

  test("nothing typed is the trending list under a Trending section with the default rating, each tile an animated preview as a data url fetched into the cache", async () => {
    const items = await list("");
    expect(names(items)).toEqual(shown);
    expect(requests.at(-1)).toMatchObject({ path: "/v1/gifs/trending", key: "good", filter: "pg" });
    expect(items.every((i) => i.section === "Trending")).toBe(true);
    expect(dataUrl(items[0])).toMatch(/^data:image\/png;base64,/);
    expect(Buffer.from(dataUrl(items[0]).slice("data:image/png;base64,".length), "base64").equals(picture(0, 96, 72))).toBe(true);
    expect(items[0].actions!.map((a) => a.id)).toEqual(["copy", "copy_url", "open", "save", "fav"]);
    expect(items[0].detail!.markdown).toContain(`![](${base}/media/0/fixed_height_small.gif)`);
    expect(items[0].detail!.metadata).toEqual([{ label: "Source", value: "Giphy" }, { label: "Size", value: "480 × 360 · 1.1 MB" }, { label: "Page", link: { text: "giphy.com/gifs/happy-dance-g0abc", href: "https://giphy.com/gifs/happy-dance-g0abc" } }]);
    expect(readdirSync(cache).filter((f) => f.endsWith("-preview.gif"))).toHaveLength(titles.length);
  });

  test("a search lists the matches; the previews come from the cache, so nothing is fetched twice; the same query again is answered without a request", async () => {
    const before = readdirSync(cache).length;
    let items = await list("cat");
    expect(names(items)).toEqual(["Cat Typing", "Cat Nap"]);
    expect(items[0].section).toBeUndefined();
    expect(requests.at(-1)).toMatchObject({ path: "/v1/gifs/search", q: "cat" });
    expect(readdirSync(cache).length).toBe(before);
    const n = requests.length;
    items = await list("cat");
    expect(requests.length).toBe(n);
    expect(names(await list("zzz"))).toEqual(["No GIFs for “zzz”"]);
  });

  test("typing is debounced: a listing overtaken by a newer one answers Searching… and sends nothing", async () => {
    const n = requests.length;
    const [a, b] = await Promise.all([list("thu"), Bun.sleep(40).then(() => list("thumbs"))]);
    expect(a).toEqual([expect.objectContaining({ id: "hint:wait", name: "Searching…", subtitle: "thu", actions: [] })]);
    expect(names(b)).toEqual(["Thumbs Up"]);
    expect(requests.slice(n).map((r) => r.q)).toEqual(["thumbs"]);
  });

  test("Enter downloads the GIF into the cache under its title and puts the file on the clipboard; cmd+Enter copies the url; open is the page; save writes it to the folder; fav keeps it", async () => {
    const [cat] = await list("cat");
    const e = await pick(cat.id);
    const path = (e.copy_files as string[])[0];
    expect(e).toEqual({ copy_files: [path], hud: "Copied GIF" });
    expect(path.startsWith(cache) && path.endsWith("-Cat Typing.gif")).toBe(true);
    expect(readFileSync(path).equals(picture(1, 192, 144))).toBe(true);
    expect(await pick(cat.id, "copy_url")).toEqual({ copy: `${base}/media/1/original.gif` });
    expect(await pick(cat.id, "open")).toEqual({ open: "https://giphy.com/gifs/cat-typing-g1abc" });
    expect(await pick(cat.id, "save")).toEqual({ hud: "Saved Cat Typing.gif" });
    expect(readFileSync(join(downloads, "Cat Typing.gif")).equals(picture(1, 192, 144))).toBe(true);
    expect(await pick(cat.id, "fav")).toMatchObject({ keep: true, toast: { title: "Added to favourites", message: "Cat Typing" } });
    expect(await pick("giphy:nope")).toMatchObject({ keep: true, toast: { style: "failure" } });
  });

  test("Favourites: what was kept, newest first, with Remove instead of Add and a Clear row; empty says so", async () => {
    const [dance] = await list("happy");
    await pick(dance.id, "fav");
    let rows = await host.list("gifs", "favourites");
    expect(names(rows)).toEqual(["Happy Dance", "Cat Typing", "Clear favourites"]);
    expect(rows[0].actions!.map((a) => a.id)).toEqual(["copy", "copy_url", "open", "save", "unfav"]);
    expect(dataUrl(rows[0])).toMatch(/^data:image\/png;base64,/);
    expect((await host.pick("gifs", "favourites", rows[1].id)).copy_files?.[0]).toEndWith("-Cat Typing.gif");
    expect(await host.pick("gifs", "favourites", rows[1].id, "unfav")).toMatchObject({ keep: true, toast: { title: "Removed" } });
    rows = await host.list("gifs", "favourites");
    expect(names(rows)).toEqual(["Happy Dance", "Clear favourites"]);
    expect(await host.pick("gifs", "favourites", "clear", "clear")).toMatchObject({ keep: true, toast: { title: "Favourites cleared" } });
    expect(await host.list("gifs", "favourites")).toEqual([expect.objectContaining({ id: "hint:empty", name: "No favourites yet", actions: [] })]);
  });

  test("no key is one row naming the setting and where a key comes from; a refused key names the fix; the content filter reaches the request as Giphy's rating", async () => {
    host.changeSettings("gifs", { settings: { giphy_api_key: "", content_filter: "high" } });
    let items = await list("");
    expect(items).toEqual([expect.objectContaining({ id: "hint:failed", actions: [] })]);
    expect(items[0].name).toContain("giphy_api_key");
    expect(items[0].name).toContain("developers.giphy.com › Create an App");
    host.changeSettings("gifs", { settings: { giphy_api_key: "bad", content_filter: "high" } });
    items = await list("");
    expect(items[0].name).toContain("Giphy refused the key");
    expect(requests.at(-1)).toMatchObject({ path: "/v1/gifs/trending", key: "bad", filter: "g" });
    host.changeSettings("gifs", { settings: { giphy_api_key: "good", content_filter: "low" } });
    expect(names(await list("clap"))).toEqual(["Slow Clap"]);
    expect(requests.at(-1)).toMatchObject({ path: "/v1/gifs/search", q: "clap", key: "good", filter: "pg-13" });
    host.changeSettings("gifs", { settings: { giphy_api_key: "good", save_to: downloads } });
  });
});
