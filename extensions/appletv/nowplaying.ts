// The Now Playing view as a render tree, pure (the fixture and the tests
// draw rigged states with it). The whole left side sits on the cover's own
// colour, brought down to a deep tone (image.ts `backdrop`): the cover
// (square for music, wide for a film or a show), the app, the title in the
// display face, what it belongs to and the facts (season and episode,
// year, rating, genre), a line of its synopsis, then the position, split
// at the chapters when the app gives them, each part filling as it plays,
// and the transport as large buttons with the speed, subtitles, audio and
// like beside them. Left and right scrub: every press moves a target
// further (faster the longer it is held), the bar and the time show where
// it will land, and one seek goes once the keys rest. On the right a panel
// cycles with Tab: Up Next (the queue with its pictures), Chapters, Audio,
// Subtitles, Lyrics (the line playing lit, the rest around it) and Info;
// the arrows walk it and Enter acts on the row.
import { POPOVER_W, column, keyHint, row, text, type Action, type HexColor, type View, type ViewNode } from "@zcag/pal";
import { G, clock, titles } from "./remote.ts";
import type { Language, Lyrics, NowPlaying, Power, QueueItem } from "./types.ts";

export type Panel = "next" | "chapters" | "audio" | "subtitles" | "lyrics" | "info";
export const PANEL_TITLES: Record<Panel, string> = { next: "Up Next", chapters: "Chapters", audio: "Audio", subtitles: "Subtitles", lyrics: "Lyrics", info: "Info" };
/** The tabs' own words: short, so six fit the panel on one line. */
const TAB_WORDS: Record<Panel, string> = { next: "Next", chapters: "Chapters", audio: "Audio", subtitles: "Subs", lyrics: "Lyrics", info: "Info" };
const PANEL_KEYS: Record<Panel, string> = { next: "q", chapters: "c", audio: "a", subtitles: "s", lyrics: "y", info: "i" };

export type NowState = {
  layout: "wide" | "compact";
  device: string;
  /** Why there is nothing to show: no Apple TV, no connection, asleep, nothing playing, no AirPlay pairing. */
  status?: "unpaired" | "down" | "asleep" | "nothing" | "noAirplay";
  power?: Power;
  now?: NowPlaying;
  /** Seconds into the item, at render time. */
  position?: number;
  art?: string;
  /** The cover is wider than tall (a film still, a show's key art). */
  artWide?: boolean;
  tone?: { deep: HexColor; glow: HexColor; accent: HexColor };
  app?: { name: string; art: string };
  queue?: (QueueItem & { art?: string })[];
  lyrics?: Lyrics | null;
  panel: Panel;
  cursor: number;
  /** A scrub in progress: where it will land. */
  scrub?: { target: number };
  /** The panel's rows can be acted on (MRP up). */
  mrp: boolean;
};

/** The panel's rows on screen: a window that follows the cursor, as `panelBody` draws it. */
export function visible(st: NowState, rows = panelRows(st)): number[] {
  const max = st.layout === "compact" ? 3 : 6;
  if (st.panel === "audio" || st.panel === "subtitles") return Array.from({ length: Math.min(rows, max + 2) }, (_, i) => i);
  const start = Math.max(0, Math.min(st.cursor - max + 2, rows - max));
  return Array.from({ length: Math.min(rows, max) }, (_, i) => start + i);
}

/** Which panels this item has: Up Next and Info always, the rest when the app gives them. */
export function panels(st: NowState): Panel[] {
  const n = st.now;
  const out: Panel[] = ["next"];
  if (n?.chapters?.length) out.push("chapters");
  if ((n?.languages?.audio.length ?? 0) > 1) out.push("audio");
  if (n?.languages?.subtitles.length) out.push("subtitles");
  if (n?.hasLyrics || st.lyrics?.lines.length) out.push("lyrics");
  out.push("info");
  return out;
}

/** The rows of the open panel, for the cursor's bounds and Enter. */
export function panelRows(st: NowState): number {
  const n = st.now;
  switch (st.panel) {
    case "next": return st.queue?.length ?? 0;
    case "chapters": return n?.chapters?.length ?? 0;
    case "audio": return n?.languages?.audio.length ?? 0;
    case "subtitles": return (n?.languages?.subtitles.length ?? 0) + 1;
    default: return 0;
  }
}

/** The chapter playing at `t`. */
export const chapterAt = (n: NowPlaying, t: number) => {
  const cs = n.chapters ?? [];
  let i = -1;
  cs.forEach((c, k) => { if (c.start <= t) i = k; });
  return i;
};

const facts = (n: NowPlaying): string[] => [
  n.mediaType === "music" ? n.album : undefined,
  n.season !== undefined && n.episode !== undefined ? `Season ${n.season}, Episode ${n.episode}` : n.episode !== undefined ? `Episode ${n.episode}` : undefined,
  n.released ? n.released.slice(0, 4) : undefined,
  n.rating,
  n.genre,
].filter((x): x is string => !!x);

// ---- the left side ------------------------------------------------------------------------------

function cover(st: NowState, w: number, h: number): ViewNode {
  const key = `art-${st.now?.itemId ?? st.now?.title ?? "none"}`;
  if (st.art) return { type: "image", key, src: st.art, width: w, height: h, mask: "rounded", alt: st.now?.title, transition: { enter: "fade" } };
  if (st.app) return { type: "stack", key, width: w, height: h, surface: st.tone?.glow ?? "sunken", radius: true, align: "center", justify: "center", children: [{ type: "image", src: st.app.art, width: Math.min(w, h) * 0.5, height: Math.min(w, h) * 0.5, mask: "rounded", alt: st.app.name }], transition: { enter: "fade" } };
  const glyph = st.now?.mediaType === "music" ? G.music : st.now?.mediaType === "podcast" ? G.podcast : G.movie;
  return { type: "stack", key, width: w, height: h, surface: st.tone?.glow ?? "sunken", radius: true, align: "center", justify: "center", children: [text(glyph, { style: "glyph", size: "xl" })], transition: { enter: "fade" } };
}

/** The position: one bar, or one part per chapter filling as it plays; the scrub's target shown instead while one runs. */
function scrubber(st: NowState, width: number): ViewNode | undefined {
  const n = st.now, d = n?.duration;
  if (!n || !d || st.position === undefined) return undefined;
  const at = st.scrub?.target ?? st.position;
  const tw = d >= 3600 ? 64 : 44;
  const inner = width - 2 * tw - 16;
  const accent = st.tone?.accent;
  let bar: ViewNode;
  if (n.chapters && n.chapters.length > 1) {
    bar = row(n.chapters.map((c, i): ViewNode => {
      const end = n.chapters![i + 1]?.start ?? d, len = Math.max(1, end - c.start);
      return { type: "stack", key: `ch-${i}`, flex: len, action: `chapter:${i}`, children: [{ type: "progress", key: `chp-${i}`, value: Math.min(1, Math.max(0, (at - c.start) / len)), ...(accent && { color: accent }) }] };
    }), { key: "chapters-bar", gap: 1, width: inner });
  } else {
    const value = Math.min(1, Math.max(0, at / d));
    bar = st.mrp ? { type: "slider", key: "seek", value, width: inner, label: "Position", action: "seek", ...(accent && { color: accent }) } : { type: "progress", key: "seek", value, width: inner, ...(accent && { color: accent }) };
  }
  const left = st.scrub ? `${st.scrub.target >= st.position ? "+" : "−"}${clock(Math.abs(st.scrub.target - st.position))}` : clock(at);
  return column([
    row([
      text(left, { style: "mono", size: "xs", width: tw, weight: st.scrub ? "semibold" : undefined, key: st.scrub ? "scrub-delta" : "pos" }),
      bar,
      text(st.scrub ? clock(st.scrub.target) : `-${clock(d - at)}`, { style: "mono", size: "xs", width: tw, align: "end", weight: st.scrub ? "semibold" : undefined }),
    ], { key: "scrub-row", gap: 2 }),
    ...(n.chapters?.length ? [text(n.chapters[Math.max(0, chapterAt(n, at))]?.title ?? "", { size: "xs", key: `chname-${chapterAt(n, at)}`, transition: { enter: "fade", exit: "none" } })] : []),
  ], { key: "scrubber", gap: 1 });
}

/** A transport button: a glyph on a round tile, its action on a click. */
const big = (id: string, glyph: string, size: number, tone?: NowState["tone"]): ViewNode => ({
  type: "stack", key: `t-${id}`, width: size, height: size, surface: tone ? tone.glow : "elevated", radius: true, align: "center", justify: "center", action: id,
  children: [text(glyph, { style: "glyph", size: size > 40 ? "xl" : "lg" })],
});

/** A chip: what a toggle is set to, a click runs it. */
const chip = (id: string, label: string, tone?: NowState["tone"], on = false): ViewNode => ({
  type: "stack", key: `chip-${id}`, surface: on && tone ? tone.accent : tone ? tone.glow : "elevated", radius: true, padding: 1, action: id, align: "center",
  children: [text(label, { size: "xs", weight: "semibold" })],
});

function transport(st: NowState, compact: boolean): ViewNode {
  const n = st.now!, t = st.tone, playing = n.state === "playing";
  const s = compact ? 34 : 40;
  const chips: ViewNode[] = [];
  if (n.rates && n.rates.length > 1) chips.push(chip("speed:next", `${n.rate && n.rate !== 1 && playing ? n.rate : 1}×`, t, !!n.rate && n.rate !== 1 && playing));
  if (n.languages?.subtitles.length) { const on = n.languages.subtitles.find((l) => l.active); chips.push(chip("panel:subtitles", on ? `CC ${short(on)}` : "CC", t, !!on)); }
  if ((n.languages?.audio.length ?? 0) > 1) { const on = n.languages!.audio.find((l) => l.active); chips.push(chip("panel:audio", on ? short(on) : "Audio", t)); }
  if (n.liked !== undefined) chips.push(chip("like", n.liked ? "♥" : "♡", t, n.liked));
  if (n.shuffle && n.shuffle !== "off") chips.push(chip("shuffle", "shuffle", t, true));
  if (n.repeat && n.repeat !== "off") chips.push(chip("repeat", n.repeat === "one" ? "repeat 1" : "repeat", t, true));
  return row([
    big("previous", G.prev, s - 6, t), big("skip-back", G.skipBack, s, t), big("toggle", playing ? G.pause : G.play, s + 8, t), big("skip-forward", G.skipFwd, s, t), big("next", G.next, s - 6, t),
    ...(compact ? [] : [{ type: "spacer" } as ViewNode]),
    ...chips,
  ], { key: "transport", gap: 2, align: "center" });
}

const short = (l: Language) => (l.name.length > 10 ? l.name.slice(0, 3).toUpperCase() : l.name);

function hero(st: NowState, width: number, compact: boolean): ViewNode {
  const n = st.now!;
  const t = titles(n, st.app?.name);
  const [cw, ch] = st.artWide ? (compact ? [112, 63] : [176, 99]) : compact ? [72, 72] : [124, 124];
  const inner = width - cw - (compact ? 40 : 48);
  const f = facts(n);
  const lines: ViewNode[] = [
    row([...(st.app ? [{ type: "image", src: st.app.art, width: 16, height: 16, mask: "rounded", alt: st.app.name } as ViewNode, text(st.app.name, { size: "xs", weight: "semibold" })] : []),
      ...(n.state === "paused" ? [{ type: "badge", key: "paused", text: "paused", color: "amber" } as ViewNode] : []),
      ...(n.rate && n.rate !== 1 && n.state === "playing" ? [{ type: "badge", key: "rate", text: `${n.rate}×`, color: "violet" } as ViewNode] : [])], { key: "app-row", gap: 1, minHeight: 18 }),
    text(t.title, { style: "headline", key: `title-${n.itemId ?? t.title}`, transition: { enter: "fade" }, ...(compact && { width: inner }) }),
    ...(t.sub ? [text(t.sub, { size: compact ? "sm" : "md", weight: "medium", ...(compact && { width: inner }) })] : []),
    ...(f.length ? [text(f.join("  ·  "), { size: "xs", ...(compact && { width: inner }) })] : []),
    ...(!compact && n.description ? [text(n.description.length > 96 ? `${n.description.slice(0, 95).replace(/\s+\S*$/, "")}…` : n.description, { size: "xs", key: "synopsis" })] : []),
  ];
  return row([cover(st, cw, ch), column(lines, { key: "titles", gap: 1, grow: true, justify: "center" })], { key: "hero", gap: 3, align: "center" });
}

// ---- the panel -----------------------------------------------------------------------------------------

function panelTabs(st: NowState): ViewNode {
  const ps = panels(st);
  return row(ps.map((p): ViewNode => ({ type: "stack", key: `tab-${p}`, padding: 1, radius: true, surface: p === st.panel ? "elevated" : undefined, action: `panel:${p}`, children: [text(TAB_WORDS[p], { size: "xs", weight: p === st.panel ? "semibold" : "regular", color: p === st.panel ? undefined : "muted" })] })), { key: "tabs", gap: 0 });
}

function listRow(key: string, sel: boolean, action: string, kids: ViewNode[]): ViewNode {
  return { type: "stack", key, direction: "row", align: "center", gap: 2, padding: 1, radius: true, minHeight: 30, action, ...(sel && { selected: true }), children: kids };
}

function panelBody(st: NowState, width: number, maxRows: number): ViewNode {
  const n = st.now;
  const empty = (msg: string) => column([text(msg, { style: "muted", size: "sm" })], { key: `empty-${st.panel}`, padding: 2 });
  switch (st.panel) {
    case "next": {
      if (!st.queue?.length) return empty(st.mrp ? "Nothing queued after this" : "Pair AirPlay in the setup to see the queue");
      const start = Math.max(0, Math.min(st.cursor - maxRows + 2, st.queue.length - maxRows));
      return column(st.queue.slice(start, start + maxRows).map((q, k) => {
        const i = start + k;
        const sub = q.series ? [q.series, q.season !== undefined && q.episode !== undefined ? `S${q.season} · E${q.episode}` : undefined].filter(Boolean).join(" · ") : q.artist;
        return listRow(`q-${q.id}`, i === st.cursor, `queue:${i}`, [
          q.art ? { type: "image", src: q.art, width: 44, height: 28, mask: "rounded", alt: q.title } : { type: "stack", width: 44, height: 28, surface: "sunken", radius: true, children: [] },
          column([text(q.title ?? "Untitled", { size: "xs", weight: "semibold", width: width - 110 }), ...(sub ? [text(sub, { size: "xs", color: "muted", width: width - 110 })] : [])], { gap: 0 }),
          ...(q.duration ? [text(clock(q.duration), { style: "mono", size: "xs", color: "faint" })] : []),
        ]);
      }), { key: "queue", gap: 0 });
    }
    case "chapters": {
      const cs = n?.chapters ?? [];
      const cur = n && st.position !== undefined ? chapterAt(n, st.position) : -1;
      const start = Math.max(0, Math.min(st.cursor - maxRows + 2, cs.length - maxRows));
      return column(cs.slice(start, start + maxRows).map((c, k) => {
        const i = start + k;
        return listRow(`c-${i}`, i === st.cursor, `chapter:${i}`, [
          text(String(i + 1), { style: "number", size: "xs", width: 18, color: i === cur ? "accent" : "faint" }),
          text(c.title, { size: "xs", weight: i === cur ? "semibold" : "regular", width: width - 90 }),
          text(clock(c.start), { style: "mono", size: "xs", color: "faint" }),
        ]);
      }), { key: "chapter-list", gap: 0 });
    }
    case "audio":
    case "subtitles": {
      const list: (Language | { id: "off"; name: string; active: boolean })[] = st.panel === "audio" ? n?.languages?.audio ?? [] : [{ id: "off", name: "Off", active: !n?.languages?.subtitles.some((l) => l.active) }, ...(n?.languages?.subtitles ?? [])];
      return column(list.slice(0, maxRows + 2).map((l, i) => listRow(`l-${st.panel}-${l.id}`, i === st.cursor, `lang:${i}`, [
        text(l.active ? G.check : " ", { style: "glyph", size: "sm", color: "green", width: 18 }),
        text(l.name, { size: "sm", weight: l.active ? "semibold" : "regular" }),
      ])), { key: `langs-${st.panel}`, gap: 0 });
    }
    case "lyrics": {
      const lines = st.lyrics?.lines ?? [];
      if (st.lyrics === undefined) return empty("Looking for lyrics");
      if (!lines.length) return empty("No lyrics for this one");
      const timed = lines.some((l) => l.at !== undefined);
      const pos = st.position ?? 0;
      let cur = timed ? -1 : Math.floor((pos / (n?.duration || 1)) * lines.length);
      if (timed) lines.forEach((l, i) => { if ((l.at ?? Infinity) <= pos) cur = i; });
      const from = Math.max(0, cur - 2);
      return column(lines.slice(from, from + maxRows + 1).map((l, k) => {
        const i = from + k;
        return { type: "stack", key: `ly-${i}`, direction: "row", minHeight: 22, transition: { move: true, enter: "slide-up", exit: "fade" }, children: [text(l.text || "♪", { size: i === cur ? "md" : "sm", weight: i === cur ? "semibold" : "regular", color: i < cur ? "muted" : i > cur ? "faint" : undefined })] } as ViewNode;
      }), { key: "lyrics", gap: 0 });
    }
    case "info": {
      const meta: [string, string | undefined][] = [
        ["Playing on", st.device], ["App", st.app?.name ?? n?.app?.name], ["Kind", n?.mediaType], ["Genre", n?.genre], ["Released", n?.released], ["Rated", n?.rating],
        ["Length", n?.duration ? clock(n.duration) : undefined], ["Speed", n?.rates?.length ? n.rates.map((r) => `${r}×`).join(" ") : undefined],
      ];
      return column([
        ...(n?.description ? [text(n.description.length > 260 ? `${n.description.slice(0, 259)}…` : n.description, { size: "xs", key: "desc" })] : []),
        ...meta.filter(([, v]) => v).map(([k, v]) => row([text(k, { size: "xs", color: "muted", width: 72 }), text(v!, { size: "xs", width: width - 90 })], { key: `m-${k}`, gap: 1, minHeight: 16 })),
      ], { key: "info", gap: 1 });
    }
  }
}

// ---- states without a player --------------------------------------------------------------------------------

const STATUS: Record<NonNullable<NowState["status"]>, [string, string, string]> = {
  unpaired: ["No Apple TV yet", "Enter sets one up: pal finds it, you type the code it shows", G.remote],
  down: ["The Apple TV did not answer", "Is it on, and on this network? Enter tries again", G.wifiOff],
  asleep: ["The Apple TV is asleep", "p wakes it", G.sleep],
  nothing: ["Nothing playing", "Start something on the TV, or play a link: l", G.tv],
  noAirplay: ["Now Playing needs AirPlay", "Set Up Apple TV again and type the second code: it shows what plays", G.info],
};

function statusTree(st: NowState): ViewNode {
  const [title, sub, glyph] = STATUS[st.status!];
  return column([
    { type: "stack", key: "s-tile", width: 64, height: 64, surface: "elevated", radius: true, align: "center", justify: "center", children: [text(glyph, { style: "glyph", size: "xl", color: "muted" })] },
    text(title, { style: "headline", align: "center", key: `s-${st.status}`, transition: { enter: "fade" } }),
    text(sub, { style: "muted", size: "sm", align: "center" }),
  ], { key: "status", padding: 6, gap: 3, align: "center", justify: "center", grow: true });
}

// ---- actions ---------------------------------------------------------------------------------------------------

/** Every action the view answers to; the first listed is Enter. */
export function actions(st: NowState): Action[] {
  if (st.status) {
    const first: Action = st.status === "unpaired" || st.status === "noAirplay" ? { id: "setup", title: "Set up Apple TV" } : st.status === "down" ? { id: "reconnect", title: "Try again" } : st.status === "asleep" ? { id: "power", title: "Wake up", shortcut: "p" } : { id: "remote", title: "Open the remote" };
    return [first, ...(st.status !== "unpaired" ? [{ id: "remote", title: "Remote", shortcut: "o" } as Action, { id: "play-link", title: "Play a link", shortcut: "l" } as Action] : [])].filter((a, i, all) => all.findIndex((b) => b.id === a.id) === i);
  }
  const n = st.now!;
  const playing = n.state === "playing";
  const rows = panelRows(st);
  const acts: Action[] = [];
  if (st.scrub) acts.push({ id: "scrub:commit", title: `Seek to ${clock(st.scrub.target)}` });
  else if (rows && st.panel !== "info" && st.panel !== "lyrics") acts.push({ id: "panel:enter", title: st.panel === "next" ? `Play ${st.queue?.[st.cursor]?.title ?? "it"}` : st.panel === "chapters" ? `Jump to ${n.chapters?.[st.cursor]?.title ?? "the chapter"}` : "Use this track" });
  else acts.push({ id: "toggle", title: playing ? "Pause" : "Play" });
  acts.push(
    { id: "toggle", title: playing ? "Pause" : "Play", shortcut: "space" },
    { id: "scrub+", title: "Scrub forward (hold to go faster)", shortcut: "right" },
    { id: "scrub-", title: "Scrub back (hold to go faster)", shortcut: "left" },
    { id: "skip-forward", title: "Skip forward", shortcut: "." },
    { id: "skip-back", title: "Skip back", shortcut: "," },
    { id: "next", title: n.chapters?.length ? "Next chapter" : "Next", shortcut: "cmd+right" },
    { id: "previous", title: n.chapters?.length ? "Previous chapter" : "Previous", shortcut: "cmd+left" },
    { id: "panel:cycle", title: "Next panel", shortcut: "tab" },
    { id: "panel:back", title: "Previous panel", shortcut: "shift+tab" },
  );
  for (const p of panels(st)) acts.push({ id: `panel:${p}`, title: PANEL_TITLES[p], shortcut: PANEL_KEYS[p] });
  if (n.rates && n.rates.length > 1) acts.push({ id: "speed:up", title: "Faster", shortcut: "]" }, { id: "speed:down", title: "Slower", shortcut: "[" }, { id: "speed:next", title: "Next speed", hidden: true, shortcut: "x" });
  if (n.liked !== undefined) acts.push({ id: "like", title: n.liked ? "Unlike" : "Like", shortcut: "l" });
  if (n.shuffle !== undefined) acts.push({ id: "shuffle", title: n.shuffle === "off" ? "Shuffle on" : "Shuffle off", shortcut: "cmd+s" });
  if (n.repeat !== undefined) acts.push({ id: "repeat", title: n.repeat === "off" ? "Repeat all" : n.repeat === "all" ? "Repeat one" : "Repeat off", shortcut: "cmd+r" });
  acts.push(
    { id: "volume-up", title: "Volume up", shortcut: ["=", "+"] },
    { id: "volume-down", title: "Volume down", shortcut: "-" },
    { id: "remote", title: "Open the remote", shortcut: "o" },
    { id: "play-link", title: "Play a link on the TV", shortcut: n.liked !== undefined ? "cmd+l" : "l" },
    { id: "copy", title: "Copy what is playing", shortcut: "cmd+c" },
    { id: "cursor:down", title: "Down", shortcut: "down", hidden: true },
    { id: "cursor:up", title: "Up", shortcut: "up", hidden: true },
    { id: "scrub++", title: "Scrub forward a minute", shortcut: "shift+right", hidden: true },
    { id: "scrub--", title: "Scrub back a minute", shortcut: "shift+left", hidden: true },
  );
  // The clicks: declared for what is drawn (the checks refuse a hidden action nothing runs).
  if (st.mrp && (n.chapters?.length ?? 0) < 2 && n.duration) acts.push({ id: "seek", title: "Seek", hidden: true });
  const shown = visible(st, rows);
  n.chapters?.forEach((_, i) => { if ((n.chapters!.length > 1) || (st.panel === "chapters" && shown.includes(i))) acts.push({ id: `chapter:${i}`, title: `Chapter ${i + 1}`, hidden: true }); });
  if (st.panel === "next") for (const i of shown) acts.push({ id: `queue:${i}`, title: `Play queue item ${i + 1}`, hidden: true });
  if (st.panel === "audio" || st.panel === "subtitles") for (const i of shown) acts.push({ id: `lang:${i}`, title: `Track ${i + 1}`, hidden: true });
  // Keep each id once (a toggle listed as Enter and on space): the first wins, a later one's key joins it.
  const seen = new Map<string, Action>();
  for (const a of acts) {
    const had = seen.get(a.id);
    if (!had) { seen.set(a.id, { ...a }); continue; }
    if (a.shortcut) had.shortcut = [...new Set([...(had.shortcut ? (Array.isArray(had.shortcut) ? had.shortcut : [had.shortcut]) : []), ...(Array.isArray(a.shortcut) ? a.shortcut : [a.shortcut])])];
  }
  return [...seen.values()];
}

// ---- the view -------------------------------------------------------------------------------------------------------

export function render(st: NowState): View {
  const compact = st.layout === "compact";
  let tree: ViewNode;
  if (st.status || !st.now) tree = statusTree({ ...st, status: st.status ?? "nothing" });
  else if (compact) {
    const W = POPOVER_W;
    tree = column([
      { type: "stack", key: "stage", direction: "column", gap: 3, padding: 3, radius: true, surface: st.tone?.deep ?? "elevated", children: [hero(st, W - 24, true), ...[scrubber(st, W - 24)].filter((x): x is ViewNode => !!x), transport(st, true)] },
      column([panelTabs(st), panelBody(st, W, 3)], { key: "side", gap: 1 }),
    ], { key: "compact", padding: 3, gap: 3 });
  } else {
    const SIDE = 252, MAIN = 696 - SIDE - 16;
    const stage: ViewNode = { type: "stack", key: "stage", direction: "column", gap: 3, padding: 4, radius: true, width: MAIN, surface: st.tone?.deep ?? "elevated", children: [hero(st, MAIN - 32, false), { type: "spacer", key: "stage-fill" }, ...[scrubber(st, MAIN - 32)].filter((x): x is ViewNode => !!x), transport(st, false)] };
    const side = column([panelTabs(st), panelBody(st, SIDE, 6)], { key: "side", gap: 2, width: SIDE });
    tree = column([
      row([stage, side], { key: "main", gap: 4, align: "stretch", grow: true }),
      row([...keyHint("space", st.now.state === "playing" ? "pause" : "play"), ...keyHint(["left", "right"], "scrub, hold"), ...keyHint([",", "."], "skip"), ...keyHint("tab", "panels"), ...keyHint("o", "remote"), ...keyHint("cmd+k", "more")], { key: "hints", gap: 1, minHeight: 20 }),
    ], { key: "wide", padding: 3, gap: 2, grow: true });
  }
  const t = st.now ? titles(st.now, st.app?.name) : undefined;
  const title = t ? `${t.title}${t.sub ? ` · ${t.sub}` : ""}` : "Now Playing";
  return { tree, actions: actions(st), title: title.length > 72 ? `${title.slice(0, 71)}…` : title, id: "now", keys: "actions" };
}
