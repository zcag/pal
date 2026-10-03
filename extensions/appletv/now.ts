// The Now Playing palette's state and keys: which panel is open and where
// its cursor is, the queue and the lyrics of the item playing (asked once
// per item, their pictures with them), and the scrub. A scrub is a target,
// not a stream of seeks: each left or right moves it by 10 s, by 30 s once
// the key has repeated a few times, by a minute after that (shift: a
// minute, then five), the bar and the times show where it will land, and
// one seek goes when the keys have rested 700 ms (Enter: at once). Without
// MRP the keys skip instead.
import { toast, type Ctx, type Effect, type View } from "@zcag/pal";
import { appTone, artOf, coverArt, ensure, frontApp, onTvChange, paired, current, push, registerView, tv, withConn, NAME, type Level } from "./tv.ts";
import { positionAt, titles } from "./remote.ts";
import { panelRows, panels, render, type NowState, type Panel } from "./nowplaying.ts";
import type { Lyrics, QueueItem } from "./types.ts";

let panel: Panel = "next";
let cursor = 0;
let scrub: { target: number; at: number; streak: number; timer?: ReturnType<typeof setTimeout> } | undefined;
const SCRUB_REST_MS = 700, SCRUB_STREAK_MS = 450;

const itemKey = () => { const n = tv.conn?.nowPlaying(); return n ? n.itemId ?? `${n.title ?? ""}|${n.app?.id ?? ""}` : undefined; };
let queue: { item?: string; items?: (QueueItem & { art?: string })[] } = {};
let lyrics: { item?: string; lyrics?: Lyrics | null } = {};

/** The queue of the item playing, asked once per item with 88 px pictures. */
function fetchQueue(): void {
  const item = itemKey();
  if (!tv.conn?.mrpUp || !item || queue.item === item) return;
  queue = { item };
  tv.conn.queue(12, 88).then((items) => {
    if (queue.item !== item) return;
    queue.items = items.map((q) => ({ ...q, art: q.artwork?.length ? `data:image/${q.artwork[0] === 0x89 ? "png" : "jpeg"};base64,${Buffer.from(q.artwork).toString("base64")}` : undefined, artwork: undefined }));
    push();
  }).catch(() => { if (queue.item === item) queue.items = []; });
}

function fetchLyrics(): void {
  const item = itemKey();
  if (!tv.conn?.mrpUp || !item || lyrics.item === item || !tv.conn.nowPlaying()?.hasLyrics) return;
  lyrics = { item };
  tv.conn.lyrics().then((l) => { if (lyrics.item === item) { lyrics.lyrics = l; push(); } }).catch(() => { if (lyrics.item === item) lyrics.lyrics = null; });
}

onTvChange((kind) => {
  if (kind !== "now_playing" && kind !== "connection") return;
  fetchQueue();
  fetchLyrics();
  // A new item: the panel starts again from the top.
  if (queue.item !== itemKey()) cursor = 0;
});

export async function nowState(layout: "wide" | "compact"): Promise<NowState> {
  const list = await paired(), dev = current(list);
  const base: NowState = { layout, device: dev?.name ?? "Apple TV", panel, cursor, mrp: !!tv.conn?.mrpUp };
  if (!dev) return { ...base, status: "unpaired" };
  if (!tv.conn) return { ...base, status: tv.state === "connecting" ? "nothing" : "down" };
  if (tv.conn.power() === "off") return { ...base, status: "asleep" };
  if (!dev.airplay) return { ...base, status: "noAirplay" };
  const n = tv.conn.nowPlaying();
  if (!n || n.state === "idle" || !(n.title || n.series || n.artist)) return { ...base, status: "nothing" };
  const app = frontApp();
  const st: NowState = {
    ...base, now: n, position: positionAt(n, Date.now()), power: tv.conn.power(),
    art: coverArt.item === itemKey() ? coverArt.data : undefined, artWide: coverArt.wide,
    tone: (coverArt.item === itemKey() ? coverArt.tone : undefined) ?? (app ? appTone(app) : undefined),
    app: app ? { name: app.name, art: artOf(app) } : undefined,
    queue: queue.item === itemKey() ? queue.items : undefined,
    lyrics: lyrics.item === itemKey() ? lyrics.lyrics : undefined,
    scrub: scrub ? { target: scrub.target } : undefined,
  };
  // The open panel may not exist for this item (no chapters here): back to Up Next.
  if (!panels(st).includes(panel)) { panel = st.panel = "next"; cursor = st.cursor = 0; }
  st.cursor = cursor = Math.min(cursor, Math.max(0, panelRows(st) - 1));
  return st;
}

/** Move the scrub's target; the seek goes once the keys rest. */
function scrubBy(dir: 1 | -1, big: boolean): Effect | undefined {
  const n = tv.conn?.nowPlaying();
  if (!n?.duration) return undefined;
  if (!tv.conn!.mrpUp) { void withConn("skip", (c) => c.media(dir > 0 ? "skip_forward" : "skip_backward", big ? 60 : 10)); return undefined; }
  const now = Date.now();
  const streak = scrub && now - scrub.at < SCRUB_STREAK_MS ? scrub.streak + 1 : 0;
  const step = big ? (streak < 4 ? 60 : 300) : streak < 4 ? 10 : streak < 12 ? 30 : 60;
  const from = scrub?.target ?? positionAt(n, now) ?? 0;
  const target = Math.max(0, Math.min(n.duration - 1, from + dir * step));
  if (scrub?.timer) clearTimeout(scrub.timer);
  scrub = { target, at: now, streak, timer: setTimeout(commit, SCRUB_REST_MS) };
  return undefined;
}

function commit(): void {
  if (!scrub) return;
  const target = Math.round(scrub.target);
  if (scrub.timer) clearTimeout(scrub.timer);
  scrub = undefined;
  void withConn("seek", (c) => c.media("seek", target)).then(push);
  push();
}

/** One key or click of the view; `undefined` = done, redraw. */
async function act(action: string, ctx?: Ctx): Promise<Effect | undefined> {
  const c = tv.conn, n = c?.nowPlaying();
  const st = await nowState("wide");
  const rows = panelRows(st);
  if (action.startsWith("panel:") && action !== "panel:enter" && action !== "panel:cycle" && action !== "panel:back") { panel = action.slice(6) as Panel; cursor = 0; if (panel === "lyrics") fetchLyrics(); return undefined; }
  if (action.startsWith("chapter:")) { const ch = n?.chapters?.[Number(action.slice(8))]; return ch ? withConn("jump to the chapter", (x) => x.media("seek", ch.start)) : undefined; }
  if (action.startsWith("queue:")) { const q = st.queue?.[Number(action.slice(6))]; return q ? withConn("play it", (x) => x.playQueueItem(q.id)) : undefined; }
  if (action.startsWith("lang:")) return pickLanguage(Number(action.slice(5)));
  switch (action) {
    case "toggle": return withConn("play or pause", (x) => x.key("play_pause"));
    case "scrub+": return scrubBy(1, false);
    case "scrub-": return scrubBy(-1, false);
    case "scrub++": return scrubBy(1, true);
    case "scrub--": return scrubBy(-1, true);
    case "scrub:commit": commit(); return undefined;
    case "skip-forward": return withConn("skip", (x) => x.media("skip_forward", 10));
    case "skip-back": return withConn("skip", (x) => x.media("skip_backward", 10));
    case "next": return withConn("go on", (x) => x.media(n?.chapters?.length ? "next_chapter" : "next"));
    case "previous": return withConn("go back", (x) => x.media(n?.chapters?.length ? "previous_chapter" : "previous"));
    case "seek": { const f = Number(ctx?.values?.value); return n?.duration && !Number.isNaN(f) ? withConn("seek", (x) => x.media("seek", Math.round(f * n.duration!))) : undefined; }
    case "panel:cycle": case "panel:back": {
      const ps = panels(st), i = ps.indexOf(panel);
      panel = ps[(i + (action === "panel:cycle" ? 1 : ps.length - 1)) % ps.length]; cursor = 0;
      if (panel === "lyrics") fetchLyrics();
      return undefined;
    }
    case "cursor:down": cursor = Math.min(Math.max(0, rows - 1), cursor + 1); return undefined;
    case "cursor:up": cursor = Math.max(0, cursor - 1); return undefined;
    case "panel:enter": return panel === "next" ? act(`queue:${cursor}`) : panel === "chapters" ? act(`chapter:${cursor}`) : panel === "audio" || panel === "subtitles" ? pickLanguage(cursor) : undefined;
    case "speed:up": case "speed:down": case "speed:next": {
      const rates = n?.rates ?? [1];
      const now = n?.rate && n.state === "playing" ? n.rate : 1;
      const i = Math.max(0, rates.findIndex((r) => r >= now));
      const next = action === "speed:down" ? rates[Math.max(0, i - 1)] : action === "speed:up" ? rates[Math.min(rates.length - 1, i + 1)] : rates[(i + 1) % rates.length];
      return withConn("change the speed", (x) => x.setRate(next));
    }
    case "like": return withConn("like it", (x) => x.media(n?.liked ? "dislike" : "like"));
    case "shuffle": return withConn("shuffle", (x) => x.media("shuffle"));
    case "repeat": return withConn("repeat", (x) => x.media("repeat"));
    case "volume-up": return withConn("turn it up", (x) => x.key("volume_up"));
    case "volume-down": return withConn("turn it down", (x) => x.key("volume_down"));
    case "remote": return { push: { extension: NAME, palette: "remote" } };
    case "play-link": return { push: { extension: NAME, palette: "play" } };
    case "setup": return { push: { extension: NAME, palette: "setup" } };
    case "power": return withConn("wake it", (x) => x.turnOn());
    case "reconnect": await ensure().catch(() => {}); return undefined;
    case "copy": {
      if (!n?.title) return toast("Nothing playing", undefined, "failure");
      const t = titles(n, frontApp()?.name);
      return { copy: [t.title, t.sub].filter(Boolean).join(" · ") };
    }
  }
  return undefined;
}

async function pickLanguage(i: number): Promise<Effect | undefined> {
  const l = tv.conn?.nowPlaying()?.languages;
  if (!l) return undefined;
  if (panel === "audio") { const a = l.audio[i]; return a ? withConn("change the audio", (x) => x.setLanguage("audio", a.id)) : undefined; }
  if (i === 0) return withConn("turn subtitles off", (x) => x.setLanguage("subtitles", null));
  const s = l.subtitles[i - 1];
  return s ? withConn("change the subtitles", (x) => x.setLanguage("subtitles", s.id)) : undefined;
}

export async function nowPick(action: string | undefined, ctx: Ctx | undefined, layout: "wide" | "compact"): Promise<Effect> {
  const e = await act(action ?? "toggle", ctx);
  const v = render(await nowState(layout));
  if (!e) return { view: v };
  return e.push || e.copy || e.hud ? e : { ...e, view: v };
}

export const nowView = async (l: Level | { compact?: boolean }): Promise<View> => { fetchQueue(); return render(await nowState(l.compact ? "compact" : "wide")); };
registerView("now", nowView);

export function disposeNow(): void { if (scrub?.timer) clearTimeout(scrub.timer); }
