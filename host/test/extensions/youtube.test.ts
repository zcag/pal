// youtube: the parsers and the formatting first (api.ts, pure), then the
// palettes over the wire against the Bun mock of the Data API v3 and an
// Invidious instance (youtube-mock.ts; `PAL_YOUTUBE_API` for the one, the
// `invidious_url` setting for the other): search, trending, the rows'
// icon, subtitle and detail, the picks (open, play through a stand-in
// player at `PAL_YOUTUBE_PATH`, copy, watch later, the channel), the
// channels palette and a channel's videos, Watch Later, the refusals,
// the debounce, the inline ask.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { age, count, duration, isoSeconds, parseApiChannels, parseApiVideos, parseInvChannels, parseInvVideos } from "../../../extensions/youtube/api.ts";
import { matches, playerArgv } from "../../../extensions/youtube/index.ts";
import { tile } from "../../../sdk/src/icon.ts";
import type { Item } from "../../../sdk/src/protocol.ts";
import { Host, stored, writeTool } from "../harness.ts";
import { CHANNELS, startMock, VIDEOS } from "./youtube-mock.ts";

describe("api.ts", () => {
  test("isoSeconds, duration, count and age format as the rows show them", () => {
    expect([isoSeconds("PT4M13S"), isoSeconds("PT1H2M3S"), isoSeconds("P1DT2H"), isoSeconds("P0D"), isoSeconds(undefined), isoSeconds("PT45S")]).toEqual([253, 3723, 93600, 0, 0, 45]);
    expect([duration(253), duration(3723), duration(0), duration(59)]).toEqual(["4:13", "1:02:03", "live", "0:59"]);
    expect([count(950, "views"), count(1500, "views"), count(45000, "views"), count(2100000, "views"), count(1234567890, "views"), count(undefined, "views")]).toEqual(["950 views", "1.5K views", "45K views", "2.1M views", "1.2B views", ""]);
    const now = Date.parse("2026-09-17T12:00:00Z");
    expect([age(now - 5 * 60e3, now), age(now - 3 * 3600e3, now), age(now - 86400e3, now), age(now - 40 * 86400e3, now), age(now - 800 * 86400e3, now), age(undefined, now)]).toEqual(["5 minutes ago", "3 hours ago", "1 day ago", "1 month ago", "2 years ago", ""]);
  });

  test("the Data API's videos.list and channel search, Invidious's search, trending and channel replies, all to one shape", () => {
    const api = parseApiVideos({ items: [{ id: "a", snippet: { title: "A", channelTitle: "Ch", channelId: "c1", publishedAt: "2026-09-01T00:00:00Z", liveBroadcastContent: "none" }, contentDetails: { duration: "PT4M13S" }, statistics: { viewCount: "1234" } }, { id: "b", snippet: { title: "Live", channelTitle: "Ch", channelId: "c1", liveBroadcastContent: "live" }, contentDetails: { duration: "P0D" } }, { id: "c" }] });
    expect(api).toEqual([{ id: "a", title: "A", channel: "Ch", channelId: "c1", seconds: 253, views: 1234, published: Date.parse("2026-09-01T00:00:00Z"), live: false }, { id: "b", title: "Live", channel: "Ch", channelId: "c1", seconds: 0, views: undefined, published: undefined, live: true }]);
    expect(parseApiChannels({ items: [{ id: { channelId: "c1" }, snippet: { title: "Ch", description: "d", thumbnails: { default: { url: "https://a/1" } } } }, { id: { videoId: "x" } }] })).toEqual([{ id: "c1", title: "Ch", avatar: "https://a/1", description: "d" }]);
    const inv = parseInvVideos([{ type: "video", videoId: "v", title: "V", author: "Ch", authorId: "c1", lengthSeconds: 61, viewCount: 9, published: 1700000000, liveNow: false }, { type: "channel", author: "x" }]);
    expect(inv).toEqual([{ id: "v", title: "V", channel: "Ch", channelId: "c1", seconds: 61, views: 9, published: 1700000000000, live: false }]);
    expect(parseInvVideos({ videos: [{ videoId: "w", title: "W", liveNow: true, lengthSeconds: 0 }] })[0]).toMatchObject({ id: "w", live: true, seconds: 0 });
    expect(parseInvChannels([{ type: "channel", authorId: "c1", author: "Ch", authorThumbnails: [{ url: "s32", width: 32 }, { url: "s76", width: 76 }, { url: "s512", width: 512 }], subCount: 5, description: "d" }])).toEqual([{ id: "c1", title: "Ch", avatar: "s76", subscribers: 5, description: "d" }]);
    expect(parseInvVideos("nope")).toEqual([]);
  });

  test("matches wants yt: with text; playerArgv finds mpv in the stand-in dir and nothing for a player that is not there", () => {
    expect(matches("yt: lofi")).toBe(true);
    expect(matches("YT:lofi")).toBe(true);
    expect(matches("yt:")).toBe(false);
    expect(matches("lofi")).toBe(false);
  });
});

// ---- the palettes over the wire ------------------------------------------------------

const { server, requests, base } = startMock();
const dir = mkdtempSync(join(tmpdir(), "pal-youtube-"));
const bins = join(dir, "bin"), played = join(dir, "played.log");
mkdirSync(bins);
writeTool(join(bins, "mpv"), `#!/bin/sh\nprintf '%s\\n' "$*" >> "${played}"\n`);

const playedLog = () => (existsSync(played) ? readFileSync(played, "utf8").trim().split("\n") : []);

let host: Host;
beforeAll(async () => {
  process.env.PAL_YOUTUBE_API = base;
  process.env.PAL_YOUTUBE_PATH = bins;
  stored.clear();
  host = await Host.bundled({ settings: { youtube: { settings: { api_key: "good", region: "tr" } } } });
});
afterAll(() => {
  host.kill();
  server.stop(true);
  rmSync(dir, { recursive: true, force: true });
  delete process.env.PAL_YOUTUBE_API; delete process.env.PAL_YOUTUBE_PATH;
});

const list = (q?: string, ctx?: Parameters<Host["list"]>[3]) => host.list("youtube", "search", q, ctx);
const pick = (id: string, action?: string) => host.pick("youtube", "search", id, action);
const names = (items: Item[]) => items.map((i) => i.name);
const lofi = VIDEOS[1], jazz = VIDEOS[3], chill = VIDEOS[2], piano = VIDEOS[5];

describe("youtube", () => {
  test("meta: the search an input palette on the red tile, inline with yt: and a fallback row; channels input; Watch Later live; no warnings", () => {
    const l = host.loaded().find((l) => l.extension === "youtube")!;
    expect(l.warnings).toEqual([]);
    expect(l.palettes.map((p) => p.name)).toEqual(["search", "channels", "later"]);
    expect(l.palettes[0]).toMatchObject({ title: "YouTube", input: true, inline: true, match: "^\\s*yt\\s*:\\s*\\S", fallback: "ask", fallbackTitle: "Search YouTube for “{query}”", icon: tile("red", "\u{f05c3}") });
    expect(l.palettes[1]).toMatchObject({ title: "YouTube Channels", input: true });
    expect(l.palettes[2]).toMatchObject({ title: "Watch Later", live: true });
  });

  test("a search through the Data API: search then videos.list for the durations and views; rows with the thumbnail, channel, length, views and age, the url, a detail with the bigger thumbnail", async () => {
    const items = await list("lofi");
    expect(requests.slice(-2).map((r): [string, string | number | undefined] => [r.path, r.params.q ?? r.params.id?.split(",").length])).toEqual([["/search", "lofi"], ["/videos", 4]]);
    expect(requests.at(-2)!.params).toMatchObject({ part: "snippet", type: "video", maxResults: "25", key: "good" });
    expect(names(items)).toEqual([VIDEOS[0].title, lofi.title, chill.title, VIDEOS[4].title]);
    expect(items[1]).toMatchObject({ id: lofi.id, subtitle: "Lofi Girl · 8:00:28 · 6.8M views · 11 months ago", icon: { image: `https://i.ytimg.com/vi/${lofi.id}/default.jpg` }, url: `https://www.youtube.com/watch?v=${lofi.id}`, keywords: ["Lofi Girl"] });
    expect(items[0].subtitle).toBe("Lofi Girl · live now");
    expect(items[1].actions!.map((a) => a.id)).toEqual(["open", "play", "copy_url", "later", "channel"]);
    expect(items[1].detail!.markdown).toBe(`![](https://i.ytimg.com/vi/${lofi.id}/mqdefault.jpg)\n\n**${lofi.title}**`);
    expect(items[1].detail!.metadata!.slice(0, 3)).toEqual([{ label: "Channel", link: { text: "Lofi Girl", href: `https://www.youtube.com/channel/${lofi.channelId}` } }, { label: "Length", value: "8:00:28" }, { label: "Views", value: (6800000).toLocaleString() }]);
    // Cached: the same query again asks nothing.
    const n = requests.length;
    await list("lofi");
    expect(requests.length).toBe(n);
    expect(names(await list("zzz"))).toEqual(["No videos for “zzz”"]);
  });

  test("nothing typed is the trending list for the region under a Trending section; the inline ask answers yt: only", async () => {
    const items = await list("");
    expect(requests.at(-1)).toMatchObject({ path: "/videos", params: { chart: "mostPopular", regionCode: "TR" } });
    expect(items[0]).toMatchObject({ name: VIDEOS[6].title, section: "Trending" });
    expect(await list("", { inline: true })).toEqual([]);
    expect(await list("lofi", { inline: true })).toEqual([]);
    expect(names(await list("yt: piano", { inline: true }))).toEqual([piano.title]);
  });

  test("typing is debounced: a listing overtaken by a newer one answers Searching… and sends nothing", async () => {
    const n = requests.length;
    const [a, b] = await Promise.all([list("coff"), Bun.sleep(40).then(() => list("coffee"))]);
    expect(a).toEqual([expect.objectContaining({ id: "hint:wait", name: "Searching…", subtitle: "coff", actions: [] })]);
    expect(names(b)).toEqual([jazz.title, piano.title, VIDEOS[6].title]);
    expect(requests.slice(n).map((r) => r.params.q).filter(Boolean)).toEqual(["coffee"]);
  });

  test("picks: open, play in the player (mpv from the stand-in dir), copy the url, the channel, watch later; a stale id is a failure toast", async () => {
    await list("lofi");
    expect(await pick(lofi.id)).toEqual({ open: `https://www.youtube.com/watch?v=${lofi.id}` });
    expect(await pick(lofi.id, "copy_url")).toEqual({ copy: `https://www.youtube.com/watch?v=${lofi.id}` });
    expect(await pick(lofi.id, "channel")).toEqual({ open: `https://www.youtube.com/channel/${lofi.channelId}` });
    expect(await pick(lofi.id, "play")).toEqual({ hud: "Playing in mpv" });
    await host.until(() => playedLog().length > 0, 2000, "the player ran");
    expect(playedLog().at(-1)).toBe(`https://www.youtube.com/watch?v=${lofi.id}`);
    host.changeSettings("youtube", { settings: { api_key: "good", player: "vlc" } });
    expect(await pick(lofi.id, "play")).toMatchObject({ keep: true, toast: { title: "vlc is not installed", style: "failure" } });
    host.changeSettings("youtube", { settings: { api_key: "good", player: "browser" } });
    expect(await pick(lofi.id, "play")).toEqual({ open: `https://www.youtube.com/watch?v=${lofi.id}` });
    host.changeSettings("youtube", { settings: { api_key: "good", region: "tr" } });
    expect(await pick(lofi.id, "later")).toMatchObject({ keep: true, toast: { title: "Saved for later", message: lofi.title } });
    expect(await pick("nope")).toMatchObject({ keep: true, toast: { style: "failure" } });
    expect(playerArgv("auto", "u")).toEqual({ title: "mpv", argv: [join(bins, "mpv"), "u"] });
    expect(playerArgv("iina", "u")).toBeUndefined();
  });

  test("channels: hints while empty (the subscriptions note), a search by name with the avatar and subscribers, Enter pushes the channel's videos, cmd+enter opens it", async () => {
    let rows = await host.list("youtube", "channels", "");
    expect(rows.map((r) => r.id)).toEqual(["hint:type", "hint:oauth"]);
    expect(rows[1].subtitle).toContain("OAuth");
    rows = await host.list("youtube", "channels", "lofi");
    expect(requests.at(-1)).toMatchObject({ path: "/search", params: { type: "channel", q: "lofi" } });
    expect(rows).toEqual([expect.objectContaining({ id: CHANNELS[0].id, name: "Lofi Girl", subtitle: "Connecting people through music.", icon: { image: expect.stringContaining("=s88") }, url: `https://www.youtube.com/channel/${CHANNELS[0].id}` })]);
    expect(await host.pick("youtube", "channels", CHANNELS[0].id, "open")).toEqual({ open: `https://www.youtube.com/channel/${CHANNELS[0].id}` });
    expect(await host.pick("youtube", "channels", CHANNELS[0].id, "copy_url")).toEqual({ copy: `https://www.youtube.com/channel/${CHANNELS[0].id}` });
    const e = await host.pick("youtube", "channels", CHANNELS[0].id);
    expect(e).toEqual({ push: { extension: "youtube", palette: "search", args: { channel: CHANNELS[0].id, title: "Lofi Girl" } } });
    const vids = await list("", { args: e.push!.args });
    expect(requests.at(-2)).toMatchObject({ path: "/search", params: { channelId: CHANNELS[0].id, order: "date", type: "video" } });
    expect(names(vids)).toEqual([VIDEOS[0].title, lofi.title]);
    expect(names(await list("bedtime", { args: e.push!.args }))).toEqual([lofi.title]);
    expect(names(await list("zzz", { args: e.push!.args }))).toEqual(["Nothing matches “zzz”"]);
  });

  test("Watch Later: what was kept, newest first, with Remove; a pick there works without a listing of the search; Clear", async () => {
    await list("jazz");
    await pick(jazz.id, "later");
    let rows = await host.list("youtube", "later");
    expect(names(rows)).toEqual([jazz.title, lofi.title, "Clear Watch Later"]);
    expect(rows[0].actions!.map((a) => a.id)).toEqual(["open", "play", "copy_url", "channel", "remove"]);
    expect(await host.pick("youtube", "later", lofi.id)).toEqual({ open: `https://www.youtube.com/watch?v=${lofi.id}` });
    expect(await host.pick("youtube", "later", lofi.id, "remove")).toMatchObject({ keep: true, toast: { title: "Removed" } });
    rows = await host.list("youtube", "later");
    expect(names(rows)).toEqual([jazz.title, "Clear Watch Later"]);
    expect(await host.pick("youtube", "later", "clear", "clear")).toMatchObject({ keep: true, toast: { title: "Watch Later cleared" } });
    expect(await host.list("youtube", "later")).toEqual([expect.objectContaining({ id: "hint:empty", actions: [] })]);
  });

  test("a refused key and a used-up quota each name the fix; no key and no instance is the setup hint", async () => {
    host.changeSettings("youtube", { settings: { api_key: "bad" } });
    expect((await list("lofi"))[0]).toMatchObject({ id: "hint:failed", name: expect.stringContaining("refused the key"), actions: [] });
    host.changeSettings("youtube", { settings: { api_key: "quota" } });
    expect((await list("lofi again"))[0].name).toContain("daily quota");
    host.changeSettings("youtube", { settings: {} });
    expect((await list("lofi"))[0]).toMatchObject({ id: "hint:setup", name: expect.stringContaining("invidious_url") });
    expect(await list("yt: lofi", { inline: true })).toEqual([]);
    expect((await host.list("youtube", "channels", "x"))[0].id).toBe("hint:setup");
  });

  test("Invidious: search, trending, channel search and a channel's videos through /api/v1; an instance whose API is off, or that answers a captcha page, says so", async () => {
    host.changeSettings("youtube", { settings: { invidious_url: `${base}/` } });
    let items = await list("lakeside");
    expect(requests.at(-1)).toMatchObject({ path: "/api/v1/search", params: { q: "lakeside", type: "video" } });
    expect(names(items)).toEqual([jazz.title]);
    expect(items[0]).toMatchObject({ subtitle: "Relax Jazz Cafe · 3:43:13 · 35K views · 1 day ago", icon: { image: `https://i.ytimg.com/vi/${jazz.id}/default.jpg` } });
    items = await list("");
    expect(requests.at(-1)).toMatchObject({ path: "/api/v1/trending" });
    expect(items[0].name).toBe(VIDEOS[6].title);
    const ch = await host.list("youtube", "channels", "chillhop");
    expect(ch[0]).toMatchObject({ name: "Chillhop Music", subtitle: "5.2M subscribers · Chill beats, jazz-hop and lofi, every day.", icon: { image: expect.stringMatching(/^https:\/\/yt3\.ggpht\.com\/.*=s76/) } });
    const vids = await list("", { args: { channel: CHANNELS[1].id, title: "Chillhop Music" } });
    expect(requests.at(-1)!.path).toBe(`/api/v1/channels/${CHANNELS[1].id}/videos`);
    expect(names(vids)).toEqual([chill.title, VIDEOS[4].title]);
    host.changeSettings("youtube", { settings: { invidious_url: `${base}/captcha` } });
    expect((await list("x"))[0].name).toContain("does not serve the API");
    host.changeSettings("youtube", { settings: { invidious_url: "http://127.0.0.1:1" } });
    expect((await list("y"))[0].name).toContain("Could not reach");
    host.changeSettings("youtube", { settings: { api_key: "good", region: "tr" } });
  });
});
