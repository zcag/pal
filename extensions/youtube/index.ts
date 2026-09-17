// YouTube: search videos and channels from the panel, through the Data
// API v3 with a key or an Invidious instance without one (api.ts). Rows
// carry the thumbnail, the channel, the duration, the views and the age;
// Enter opens the video in the browser, cmd+Enter plays it in IINA, mpv
// or VLC (the `player` setting; auto takes the first installed), cmd+s
// keeps it in Watch Later (storage, a list of its own at the root).
// Trending while nothing is typed; `yt: query` answers inline at the root.
// Channels: search by name, Enter lists the channel's latest videos;
// subscriptions would need OAuth, which pal does not do, and the palette
// says so.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { errorMessage, failed, hint, settings, storage, toast, type Action, type Ctx, type Detail, type Effect, type Extension, type Item } from "@zcag/pal";
import { age, channels as searchChannels, channelUrl, channelVideos, count, duration, search, thumbUrl, watchUrl, YouTubeError, type Channel, type Source, type Video } from "./api.ts";

/** `[extensions.youtube]`, defaults in pal.json. */
type Settings = { api_key: string; invidious_url: string; player: Player; region: string };
type Player = "auto" | "iina" | "mpv" | "vlc" | "browser";

/** Material Design glyphs from the bundled Nerd Font; the tile's red tints them. */
const GLYPH = {
  video: "\u{f05c3}", // md-youtube
  channel: "\u{f0009}", // md-account_circle
  later: "\u{f0150}", // md-clock_outline
  trending: "\u{f0238}", // md-fire
  alert: "\u{f05d6}", // md-alert_circle_outline
  wait: "\u{f051f}", // md-timer_sand
  broom: "\u{f00e2}", // md-broom
};

const OPEN: Action = { id: "open", title: "Open in browser" };
const PLAY: Action = { id: "play", title: "Play in player" };
const COPY_URL: Action = { id: "copy_url", title: "Copy URL", shortcut: "cmd+c" };
const LATER: Action = { id: "later", title: "Watch later", shortcut: "cmd+s" };
const CHANNEL: Action = { id: "channel", title: "Open the channel", shortcut: "cmd+shift+o" };
const REMOVE: Action = { id: "remove", title: "Remove from Watch Later", shortcut: "cmd+d", style: "destructive" };
const CLEAR: Action = { id: "clear", title: "Clear Watch Later", style: "destructive", confirm: "Forget every saved video?" };

const DEBOUNCE_MS = 400;
const CACHE_MAX = 100;
const LATER_MAX = 200;
const EXT = "youtube";
const MAC = process.platform === "darwin";
const S = () => settings.get<Settings>();

/** Prefix at the root: `yt: lofi`. */
const PREFIX = /^\s*yt\s*:\s*/i;
export const matches = (q: string) => PREFIX.test(q) && q.replace(PREFIX, "").trim().length > 0;

/** The key wins over the instance; neither is a hint. */
function sourceOf(s: Settings): Source | undefined {
  const region = (s.region ?? "").trim().toUpperCase();
  if (s.api_key?.trim()) return { kind: "api", key: s.api_key.trim(), region };
  if (s.invidious_url?.trim()) return { kind: "invidious", url: s.invidious_url.trim(), region };
}

// ---- the player ------------------------------------------------------------------------

const which = (name: string): string | undefined => {
  const dir = process.env.PAL_YOUTUBE_PATH;
  if (dir) return existsSync(join(dir, name)) ? join(dir, name) : undefined;
  return Bun.which(name) ?? undefined;
};
const app = (name: string) => (MAC && !process.env.PAL_YOUTUBE_PATH && existsSync(`/Applications/${name}.app`) ? name : undefined);

/** The player the setting names, or the first installed for `auto`: IINA (macOS), then mpv, then VLC; nothing means the browser. */
export function playerArgv(player: Player, url: string): { title: string; argv: string[] } | undefined {
  const want = (p: Exclude<Player, "auto" | "browser">) => player === "auto" || player === p;
  if (want("iina")) { if (app("IINA")) return { title: "IINA", argv: ["open", "-a", "IINA", url] }; const b = which("iina"); if (b) return { title: "IINA", argv: [b, url] }; }
  if (want("mpv")) { const b = which("mpv"); if (b) return { title: "mpv", argv: [b, url] }; }
  if (want("vlc")) { if (app("VLC")) return { title: "VLC", argv: ["open", "-a", "VLC", url] }; const b = which("vlc"); if (b) return { title: "VLC", argv: [b, url] }; }
  return undefined;
}

function play(v: Video): Effect {
  const url = watchUrl(v.id);
  const p = playerArgv(S().player ?? "auto", url);
  if (!p) return S().player === "browser" || S().player === "auto" ? { open: url } : toast(`${S().player} is not installed`, "Set `player` under Settings › Extensions › YouTube", "failure");
  try { Bun.spawn(p.argv, { stdio: ["ignore", "ignore", "ignore"], detached: true }).unref(); }
  catch (e) { return failed(`start ${p.title}`, e); }
  return { hud: `Playing in ${p.title}` };
}

// ---- watch later --------------------------------------------------------------------------

const LATER_KEY = "later";
const isVideo = (x: unknown): x is Video => !!x && typeof x === "object" && typeof (x as Video).id === "string" && typeof (x as Video).title === "string";
const later = async (): Promise<Video[]> => ((await storage.get<Video[]>(LATER_KEY)) ?? []).filter(isVideo);

// ---- rows ----------------------------------------------------------------------------------

const held = new Map<string, Video>();
const VIDEO_ACTIONS = [OPEN, PLAY, COPY_URL, LATER, CHANNEL];
const LATER_ACTIONS = [OPEN, PLAY, COPY_URL, CHANNEL, REMOVE];

const detailOf = (v: Video): Detail => ({
  markdown: `![](${thumbUrl(v.id, "mqdefault")})\n\n**${v.title}**`,
  metadata: [
    { label: "Channel", link: { text: v.channel, href: channelUrl(v.channelId) } },
    { label: "Length", value: v.live ? "live now" : duration(v.seconds) },
    ...(v.views !== undefined ? [{ label: "Views", value: v.views.toLocaleString() }] : []),
    ...(v.published ? [{ label: "Published", value: `${new Date(v.published).toLocaleDateString()} (${age(v.published)})` }] : []),
    { label: "URL", link: { text: `youtube.com/watch?v=${v.id}`, href: watchUrl(v.id) } },
  ],
});

function item(v: Video, actions: Action[], section?: string): Item {
  held.set(v.id, v);
  // A live stream's views and age are the stream's, not the video's: the row says live and leaves them.
  const bits = v.live ? [v.channel, "live now"] : [v.channel, duration(v.seconds), count(v.views, "views"), age(v.published)].filter(Boolean);
  return { id: v.id, name: v.title, subtitle: bits.join(" · "), icon: { image: thumbUrl(v.id) }, url: watchUrl(v.id), keywords: [v.channel], ...(section && { section }), detail: detailOf(v), actions };
}

const setupHints = (): Item[] => [
  hint("setup", "Set `api_key` or `invidious_url` under Settings › Extensions › YouTube", "A Data API v3 key (free, 100 searches a day) or an Invidious instance that serves its API"),
  hint("root", "At the root, yt: before the query", "yt: lofi hip hop"),
];

let seq = 0;
const cache = new Map<string, Video[]>();
const failedRow = (e: unknown, q: string): Item => { const ye = e instanceof YouTubeError ? e : undefined; console.error(`[youtube] ${ye?.message ?? e}`); return hint("failed", ye ? ye.hint : `Could not search: ${errorMessage(e)}`, q, { icon: GLYPH.alert }); };

async function cached(key: string, fetcher: () => Promise<Video[]>): Promise<Video[]> {
  const hit = cache.get(key);
  if (hit) return hit;
  const list = await fetcher();
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, list);
  return list;
}

async function list(query = "", ctx?: Ctx): Promise<Item[]> {
  const s = S();
  const src = sourceOf(s);
  const q = query.replace(PREFIX, "").trim();
  // The root asks only for `yt: text` (the host matches first); a bare prefix or a plain query answers nothing there.
  if (ctx?.inline && !matches(query)) return [];
  if (!src) return ctx?.inline ? [] : setupHints();
  const args = ctx?.args as { channel?: string; title?: string } | undefined;
  // A channel's videos: one fetch, the query filters them here.
  const channel = args?.channel;
  if (channel) {
    try {
      const vids = await cached(`channel|${src.kind}|${channel}`, () => channelVideos(src, channel));
      const rows = vids.filter((v) => !q || v.title.toLowerCase().includes(q.toLowerCase())).map((v) => item(v, VIDEO_ACTIONS));
      return rows.length ? rows : [hint("none", q ? `Nothing matches “${q}”` : "No videos", args.title ?? channel)];
    } catch (e) { return [failedRow(e, args.title ?? channel)]; }
  }
  const my = ++seq;
  if (q && !ctx?.inline) {
    await Bun.sleep(DEBOUNCE_MS);
    if (my !== seq) return [hint("wait", "Searching…", q, { icon: GLYPH.wait })];
  }
  try {
    const vids = await cached(`search|${src.kind}|${src.region}|${q}`, () => search(src, q));
    if (my !== seq) return [hint("wait", "Searching…", q, { icon: GLYPH.wait })];
    if (!vids.length) return [hint("none", q ? `No videos for “${q}”` : "Nothing trending", src.kind === "api" ? "YouTube Data API" : src.url)];
    return vids.map((v) => item(v, VIDEO_ACTIONS, q ? undefined : "Trending"));
  } catch (e) { return [failedRow(e, q)]; }
}

async function act(v: Video, action: string | undefined): Promise<Effect> {
  switch (action) {
    case "play": return play(v);
    case "copy_url": return { copy: watchUrl(v.id) };
    case "channel": return { open: channelUrl(v.channelId) };
    case "later": {
      const list = (await later()).filter((x) => x.id !== v.id);
      await storage.set(LATER_KEY, [v, ...list].slice(0, LATER_MAX));
      return toast("Saved for later", v.title);
    }
    case "remove": await storage.set(LATER_KEY, (await later()).filter((x) => x.id !== v.id)); return toast("Removed", v.title);
    default: return { open: watchUrl(v.id) };
  }
}

async function pick(id: string, action?: string): Promise<Effect> {
  const v = held.get(id) ?? (await later()).find((x) => x.id === id);
  if (!v) return toast("Video is gone", "The listing changed; pick again", "failure");
  return act(v, action);
}

// ---- channels ---------------------------------------------------------------------------------

const heldChannels = new Map<string, Channel>();
const channelCache = new Map<string, Channel[]>();

async function channelRows(query = ""): Promise<Item[]> {
  const s = S();
  const src = sourceOf(s);
  const q = query.trim();
  if (!src) return setupHints();
  if (!q) return [hint("type", "Type a channel's name", "Enter lists its latest videos, cmd+enter opens it", { icon: GLYPH.channel }), hint("oauth", "Your subscriptions are not here", "Listing them needs a Google sign-in (OAuth), which pal does not do")];
  const my = ++seq;
  await Bun.sleep(DEBOUNCE_MS);
  if (my !== seq) return [hint("wait", "Searching…", q, { icon: GLYPH.wait })];
  try {
    let list = channelCache.get(`${src.kind}|${q}`);
    if (!list) { list = await searchChannels(src, q); if (channelCache.size >= CACHE_MAX) channelCache.clear(); channelCache.set(`${src.kind}|${q}`, list); }
    if (my !== seq) return [hint("wait", "Searching…", q, { icon: GLYPH.wait })];
    if (!list.length) return [hint("none", `No channels for “${q}”`)];
    return list.map((c): Item => {
      heldChannels.set(c.id, c);
      return {
        id: c.id, name: c.title, subtitle: [count(c.subscribers, "subscribers"), c.description?.replace(/\s+/g, " ").slice(0, 80)].filter(Boolean).join(" · "), icon: c.avatar ? { image: c.avatar } : GLYPH.channel, url: channelUrl(c.id),
        actions: [{ id: "videos", title: "Latest videos" }, { id: "open", title: "Open the channel" }, { id: "copy_url", title: "Copy URL", shortcut: "cmd+c" }],
      };
    });
  } catch (e) { return [failedRow(e, q)]; }
}

async function channelPick(id: string, action?: string): Promise<Effect> {
  const c = heldChannels.get(id);
  if (!c) return toast("Channel is gone", undefined, "failure");
  switch (action) {
    case "open": return { open: channelUrl(c.id) };
    case "copy_url": return { copy: channelUrl(c.id) };
    default: return { push: { extension: EXT, palette: "search", args: { channel: c.id, title: c.title } } };
  }
}

// ---- watch later palette ---------------------------------------------------------------------

async function laterRows(): Promise<Item[]> {
  const list = await later();
  if (!list.length) return [hint("empty", "Nothing saved yet", "cmd+s on a video keeps it here", { icon: GLYPH.later })];
  const rows = list.map((v) => item(v, LATER_ACTIONS));
  rows.push({ id: "clear", name: "Clear Watch Later", subtitle: `${list.length} ${list.length === 1 ? "video" : "videos"}`, icon: GLYPH.broom, actions: [CLEAR] });
  return rows;
}

async function laterPick(id: string, action?: string): Promise<Effect> {
  if (id === "clear") { await storage.remove(LATER_KEY); return toast("Watch Later cleared"); }
  return pick(id, action);
}

export default {
  palettes: {
    search: {
      title: "YouTube",
      input: true,
      // At the root: `yt: lofi` answers inline under a YouTube section.
      match: matches,
      inline: true,
      placeholder: "Search videos (trending while empty)",
      fallback: "Search YouTube for “{query}”",
      list,
      pick,
    },
    channels: {
      title: "YouTube Channels",
      input: true,
      placeholder: "A channel's name",
      list: channelRows,
      pick: channelPick,
    },
    later: {
      title: "Watch Later",
      live: true,
      placeholder: "Search saved videos",
      list: laterRows,
      pick: laterPick,
    },
  },
} satisfies Extension;
