// Links that can play on the Apple TV: what a url is (a YouTube video with
// its start time, a Netflix title, an Apple TV+ page), found anywhere in a
// text (a copied paragraph, a typed query), how it reaches the TV (the
// app's own link, opened over Companion), and a title and a picture for it
// (YouTube's oEmbed, no key). Pure but for `describe`. Not here, measured
// against tvOS 26.6 (notes/decisions.md): a media file over AirPlay (the
// TV takes the request and never fetches the file) and Twitch (its app
// refuses every link form).

export type LinkKind = "youtube" | "netflix" | "appletv";
export type MediaLink = {
  kind: LinkKind;
  /** The url as found (normalised to https). */
  url: string;
  /** The video, channel or title id the app takes. */
  id?: string;
  /** Seconds to start at (YouTube's `t`/`start`). */
  start?: number;
  /** A YouTube playlist the video belongs to. */
  list?: string;
};
export type LinkInfo = { title: string; by?: string; thumb?: string };

/** Each kind's app, as the Apple TV knows it, and how it is said. */
export const LINK_APPS: Record<LinkKind, { app: string; name: string }> = {
  youtube: { app: "com.google.ios.youtube", name: "YouTube" },
  netflix: { app: "com.netflix.Netflix", name: "Netflix" },
  appletv: { app: "com.apple.TVWatchList", name: "TV" },
};

/** `90`, `1m30s`, `1h2m3s`, `90s` as seconds. */
export function seconds(t: string | null | undefined): number | undefined {
  if (!t) return undefined;
  if (/^\d+$/.test(t)) return Number(t) || undefined;
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(t);
  if (!m || !(m[1] || m[2] || m[3])) return undefined;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) || undefined;
}

/** What a url plays as, or undefined for a page the TV has nothing for. */
export function parseLink(raw: string): MediaLink | undefined {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return undefined; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return undefined;
  const host = u.hostname.replace(/^(www|m|music)\./, "");
  const path = u.pathname.split("/").filter(Boolean);
  const url = u.toString().replace(/^http:/, "https:");
  if (host === "youtu.be" && path[0]) return { kind: "youtube", url, id: path[0], start: seconds(u.searchParams.get("t")) };
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const start = seconds(u.searchParams.get("t") ?? u.searchParams.get("start"));
    const list = u.searchParams.get("list") ?? undefined;
    if (path[0] === "watch" && u.searchParams.get("v")) return { kind: "youtube", url, id: u.searchParams.get("v")!, start, list };
    if (["shorts", "live", "embed", "v"].includes(path[0]) && path[1]) return { kind: "youtube", url, id: path[1], start, list };
    if (path[0] === "playlist" && list) return { kind: "youtube", url, list };
    return undefined;
  }
  if (host === "netflix.com" && (path[0] === "title" || path[0] === "watch") && path[1]) return { kind: "netflix", url, id: path[1] };
  if (host === "tv.apple.com" && path.length >= 2) return { kind: "appletv", url };
  return undefined;
}

/** The first playable link in a text (a whole copied message), or undefined. */
export function findLink(text: string | null | undefined): MediaLink | undefined {
  for (const m of (text ?? "").matchAll(/https?:\/\/[^\s<>"'`)\]]+/g)) {
    const l = parseLink(m[0].replace(/[.,;:!?]+$/, ""));
    if (l) return l;
  }
  return undefined;
}

/** A link's identity: the same video copied twice, or with another tracking parameter, is one link. */
export const linkKey = (l: MediaLink): string => `${l.kind}:${l.id ?? l.list ?? l.url}`;

/** What a link is, in words, before its title is known. */
export function linkLabel(l: MediaLink): string {
  if (l.kind === "youtube") return l.id ? "YouTube video" : "YouTube playlist";
  if (l.kind === "netflix") return "Netflix title";
  return "Apple TV app";
}

/** YouTube's oEmbed endpoint; `PAL_APPLETV_OEMBED` points the tests at a stand-in. */
const OEMBED = process.env.PAL_APPLETV_OEMBED ?? "https://www.youtube.com/oembed";
const infos = new Map<string, Promise<LinkInfo | undefined>>();
/** The link's title, who made it and a picture url: YouTube's oEmbed answers without a key; the rest say what they are. Kept per link. */
export function describe(l: MediaLink): Promise<LinkInfo | undefined> {
  const key = linkKey(l);
  let p = infos.get(key);
  if (!p) {
    p = (async () => {
      if (l.kind === "youtube" && l.id) {
        const r = await fetch(`${OEMBED}?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${l.id}`)}`, { signal: AbortSignal.timeout(4000) });
        if (!r.ok) return undefined;
        const j = (await r.json()) as { title?: string; author_name?: string; thumbnail_url?: string };
        // The 320x180 still (`mqdefault`) rather than the oEmbed's 480x360 with bars.
        return { title: j.title ?? "YouTube video", by: j.author_name, thumb: j.thumbnail_url?.replace(/hqdefault\.jpg$/, "mqdefault.jpg") };
      }
      return { title: linkLabel(l) };
    })().catch(() => { infos.delete(key); return undefined; });
    infos.set(key, p);
  }
  return p;
}

/** `1:30` for a start time. */
export const startLabel = (s?: number) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : undefined);

/**
 * How each kind reaches the TV: the app opened at a link it takes. YouTube
 * takes its own scheme (an https link is refused); Netflix and the TV app
 * claim their https links. `fromStart` drops a YouTube link's start time.
 */
export function target(l: MediaLink, fromStart = false): { app: string; url: string } {
  switch (l.kind) {
    case "youtube": {
      if (!l.id) return { app: LINK_APPS.youtube.app, url: `youtube://www.youtube.com/playlist?list=${l.list}` };
      const t = !fromStart && l.start ? `&t=${l.start}` : "";
      return { app: LINK_APPS.youtube.app, url: `youtube://www.youtube.com/watch?v=${l.id}${t}${l.list ? `&list=${l.list}` : ""}` };
    }
    case "netflix": return { app: LINK_APPS.netflix.app, url: `https://www.netflix.com/title/${l.id}` };
    case "appletv": return { app: LINK_APPS.appletv.app, url: l.url };
  }
}
