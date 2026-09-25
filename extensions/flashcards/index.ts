// Flashcards: spaced repetition in the panel, for the minute a build takes.
// Enter on the Flashcards row lands on the next card that is due across
// every pack in rotation; each answer is saved as it is given, so Escape
// at any point loses nothing and the next open carries on.
//
// The view is one `surface`, the page in surface/ (the card, the flip, the
// buttons; keys and mouse). The page holds no state of its own: it asks
// this side for the screen (`onMessage`) and says what was answered, and
// every screen comes back whole: the card with its buttons' intervals, the
// day's counts, the goal and the streak, or the summary when the day is
// done. The scheduling is srs.ts (FSRS), the packs packs.ts, what you know
// store.ts.
//
// Palettes: Flashcards (study everything due; `args.pack` one pack,
// `args.mode: "weak"` the refresher), Flashcard Packs (every pack with its
// progress: study it, add it to or take it out of rotation) and Add
// Flashcard (type `front = back`). While cards are due, a row in the
// root's Now section is the way back in.
import { spawn, type ChildProcess } from "node:child_process";
import { appendFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { effects, hint, now as clock, settings, view, type Action, type Effect, type Extension, type Item as Row, type View, type ViewPalette } from "@zcag/pal";
import { roles } from "./apkg.ts";
import * as ankiweb from "./ankiweb.ts";
import { parsePack, readFolder, type Pack } from "./packs.ts";
import { DAY, LEECH, answer as schedule, dayStart, items, kindOf, mastered, previews, progress, queue, stats, weak, type Mem, type Item, type Settings } from "./srs.ts";
import { dataDir, load, packsDir, save, type Data } from "./store.ts";

const EXT = "flashcards";
const STUDY = "flashcards";
const MINE = "my-cards";

type Config = { new_per_day: number; session: number; goal: number; retention: string; typing: "reverse" | "always" | "never"; speak: "auto" | "key" | "off"; voice: string; buttons: "four" | "two"; sounds: boolean; suggest: boolean };
const config = (): Config => ({ new_per_day: 15, session: 10, goal: 20, retention: "0.9", typing: "reverse", speak: "key", voice: "", buttons: "two", sounds: true, suggest: true, ...settings.get<Partial<Config>>() });
const srsSettings = (c = config()): Settings => ({ newPerDay: Number(c.new_per_day) || 0, goal: Math.max(1, Number(c.goal) || 20), retention: Number(c.retention) || 0.9 });

// ---- packs ------------------------------------------------------------------

// The bundled packs, imported so the build carries them (each its own chunk, parsed on first use).
const BUNDLED: Record<string, () => Promise<{ default: unknown }>> = {
  "spanish-words": () => import("./packs/spanish-words.json"),
  "spanish-phrases": () => import("./packs/spanish-phrases.json"),
};
let bundled: Pack[] | null = null;
let folderErrors: string[] = [];
/** The packs folder, read at most every few seconds: the root's suggestion asks on every show. */
let folder: { at: number; packs: Pack[] } | null = null;
const FOLDER_TTL_MS = Number(process.env.PAL_FLASHCARDS_FOLDER_TTL_MS) || 5000;

/** Every pack: the bundled ones, then the packs folder's (a file named like a bundled pack replaces it). */
export async function packs(): Promise<Pack[]> {
  bundled ??= await Promise.all(Object.entries(BUNDLED).map(async ([id, get]) => ({ ...parsePack(`${id}.json`, JSON.stringify((await get()).default)), bundled: true })));
  if (!folder || clock() - folder.at > FOLDER_TTL_MS) {
    const read = await readFolder(packsDir(), join(dataDir(), "media"));
    folderErrors = read.errors;
    folder = { at: clock(), packs: read.packs };
  }
  const mine = folder;
  const ids = new Set(mine.packs.map((p) => p.id));
  return [...bundled.filter((p) => !ids.has(p.id)), ...mine.packs];
}

/** The packs in rotation, in the order they were added. */
async function active(): Promise<Pack[]> {
  const [all, data] = await Promise.all([packs(), load()]);
  const byId = new Map(all.map((p) => [p.id, p]));
  return (data.active ?? []).map((id) => byId.get(id)).filter((p): p is Pack => !!p);
}

async function setActive(id: string, on: boolean) {
  const data = await load();
  const cur = data.active ?? [];
  data.active = on ? (cur.includes(id) ? cur : [...cur, id]) : cur.filter((x) => x !== id);
  await save();
}

// ---- sessions ---------------------------------------------------------------

type Args = { pack?: string; mode?: "weak" };
/** One open study level: what it studies, what it added, what can be undone, what it did. */
type Session = {
  scope: string;
  extraNew: number;
  /** The refresher's cards, weakest first (or this session's misses); a Didn't know sends one three places back. */
  drill?: string[];
  drillOf?: "weak" | "misses";
  undo: { key: string; prev: Mem | undefined; log: number; drill?: string[]; missed: boolean; learned: boolean }[];
  started: number;
  answers: number;
  passed: number;
  /** Where this block ends: `session` answers each, Keep going adds another; 0 never. */
  target: number;
  learned: string[];
  missed: string[];
  mastered: string[];
  /** The coverage when the session began, for "+0.4%". */
  covStart?: number;
  last?: string;
  /** Shown next whatever the queue says: the card an undo brought back. */
  force?: string;
};
const sessions = new Map<string, Session>();
const scopeOf = (a?: Args) => (a?.mode === "weak" ? `weak:${a.pack ?? ""}` : a?.pack ? `pack:${a.pack}` : "all");
const blockSize = (c = config()) => Math.max(0, Number(c.session) || 0);

function session(a: Args | undefined, reset = false): Session {
  const scope = scopeOf(a);
  let s = sessions.get(scope);
  if (!s || reset) sessions.set(scope, s = { scope, extraNew: 0, undo: [], started: clock(), answers: 0, passed: 0, target: blockSize(), learned: [], missed: [], mastered: [] });
  return s;
}

/** The cards a level studies: one pack's, else every pack in rotation. */
async function pool(a?: Args): Promise<Item[]> {
  if (a?.pack) { const p = (await packs()).find((x) => x.id === a.pack); return p ? items([p]) : []; }
  return items(await active());
}

/** The pack whose coverage the summary reports: the first one studied that has word weights. */
async function coveragePack(a: Args | undefined, data: Data, now: number) {
  const scoped = a?.pack ? (await packs()).filter((p) => p.id === a.pack) : await active();
  return scoped.find((p) => progress(p, data, now).coverage !== undefined);
}

// ---- screens: what the page draws ---------------------------------------------

export type CardView = {
  key: string; pack: string; packTitle: string; reverse: boolean; type: boolean;
  prompt: string; answer: string; note?: string; example?: string; example_back?: string;
  /** A noun's gender, from its note: the page colours its article. */
  gender?: "m" | "f" | "mf";
  lang: { prompt?: string; answer?: string }; kind: "new" | "learning" | "review"; leech: boolean; edited: boolean;
  /** The card has a recording of its front (an Anki deck's), which Tab plays. */
  audio: boolean;
  intervals: Record<1 | 2 | 3 | 4, string>;
};
/** `total`: every answer ever, so the page can explain itself to a newcomer. */
type Day = { answers: number; goal: number; streak: number; goalMet: boolean; total: number };
/** A card as the summary names it. */
export type Word = { key: string; word: string; meaning: string; gender?: "m" | "f" | "mf" };
export type Screen =
  | { screen: "welcome"; packs: { id: string; title: string; description?: string; cards: number; bundled: boolean }[]; folder: string }
  | { screen: "card"; mode: "study" | "weak"; card: CardView; progress: { done: number; size: number }; left: number; day: Day; canUndo: boolean; title: string }
  | {
    screen: "done"; mode: "study" | "weak";
    /** block: this block's cards answered, more wait · caught-up: nothing left today · empty: nothing to study at all. */
    reason: "block" | "caught-up" | "empty";
    day: Day; canUndo: boolean; title: string;
    session: { answers: number; passed: number; seconds: number; learned: Word[]; missed: Word[]; mastered: Word[] };
    left: number; moreNew: number; weak: number; tomorrow: number;
    coverage?: { before: number; after: number; title: string };
  };
export type Stats = {
  streak: number; best: number; total: number; seconds: number; retention: number | null; today: number; goal: number;
  heat: number[]; forecast: number[];
  packs: { id: string; title: string; total: number; mastered: number; learning: number; fresh: number; coverage?: number }[];
  /** The voice Tab speaks the first pack's language with (macOS), so the page can suggest a better one. */
  voice?: Voice | null;
};

const genderOf = (note?: string): CardView["gender"] => (!note ? undefined : /masculine or feminine/.test(note) ? "mf" : /feminine/.test(note) ? "f" : /masculine/.test(note) ? "m" : undefined);
/** A card's back with your edit over it. */
const backOf = (it: Item, data: Data) => data.edits?.[`${it.pack.id}/${it.card.id}`]?.back ?? it.card.back;

function cardView(it: Item, data: Data, now: number, c: Config): CardView {
  const { card, pack, reverse } = it, m = data.cards[it.key], back = backOf(it, data);
  return {
    key: it.key, pack: pack.id, packTitle: pack.title, reverse,
    type: c.typing === "always" || (c.typing === "reverse" && reverse),
    prompt: reverse ? back : card.front, answer: reverse ? card.front : back,
    note: card.note, example: card.example, example_back: card.example_back, gender: genderOf(card.note),
    lang: reverse ? { prompt: pack.lang?.back, answer: pack.lang?.front } : { prompt: pack.lang?.front, answer: pack.lang?.back },
    kind: kindOf(m), leech: (m?.lapses ?? 0) >= LEECH, edited: !!data.edits?.[`${pack.id}/${card.id}`], audio: !!card.audio,
    intervals: previews(m, now, srsSettings(c).retention),
  };
}

const titleOf = (a: Args | undefined, all: Pack[]) => {
  const p = a?.pack ? all.find((x) => x.id === a.pack) : undefined;
  return [a?.mode === "weak" ? "Refresher" : "Flashcards", p?.title].filter(Boolean).join(" · ");
};

/** The last 16 weeks of answers per day, oldest first, ending today. */
function heat(days: Record<number, number>, now: number): number[] {
  const out: number[] = [];
  let d = dayStart(now);
  for (let i = 0; i < 112; i++) { out.unshift(days[d] ?? 0); d = dayStart(d - DAY / 2); }
  return out;
}

async function words(keys: string[], data: Data): Promise<Word[]> {
  const byKey = new Map(items(await packs()).map((i) => [i.key, i]));
  return [...new Set(keys)].map((k) => byKey.get(k)).filter((i): i is Item => !!i)
    .map((i) => ({ key: i.key, word: i.card.front, meaning: backOf(i, data), gender: genderOf(i.card.note) }));
}

export async function screen(a: Args | undefined, now = clock()): Promise<Screen> {
  const [data, all] = await Promise.all([load(), packs()]);
  const c = config(), s = srsSettings(c), sess = session(a);
  if (!a?.pack && !data.active?.length) {
    return { screen: "welcome", folder: packsDir(), packs: all.map((p) => ({ id: p.id, title: p.title, description: p.description, cards: p.cards.length, bundled: !!p.bundled })) };
  }
  const its = await pool(a);
  const st = stats(data, its, now, s.goal);
  const day: Day = { answers: st.todayAnswers, goal: s.goal, streak: st.streak, goalMet: st.goalMet, total: data.log.length };
  const title = titleOf(a, all);
  const mode = a?.mode === "weak" ? "weak" : "study";
  const cov = await coveragePack(a, data, now);
  sess.covStart ??= cov ? progress(cov, data, now).coverage : undefined;
  const q = queue(its, data, now, s, sess.extraNew, sess.last);
  const left = q.counts.new + q.counts.learning + q.counts.review;
  let next: Item | null = null, progressOf = { done: 0, size: 0 };
  const forced = sess.force ? its.find((i) => i.key === sess.force) : undefined;
  if (mode === "weak") {
    sess.drill ??= weak(its, data, now).map((i) => i.key);
    sess.drillOf ??= "weak";
    const byKey = new Map(its.map((i) => [i.key, i]));
    next = forced ?? sess.drill.map((k) => byKey.get(k)).find(Boolean) ?? null;
    progressOf = { done: sess.answers, size: sess.answers + sess.drill.length };
  } else {
    const size = blockSize(c);
    const blockDone = size > 0 && sess.answers >= sess.target && !forced;
    next = blockDone ? null : forced ?? q.next;
    progressOf = size > 0 ? { done: sess.answers - (sess.target - size), size } : { done: sess.answers, size: sess.answers + left };
  }
  if (next) return { screen: "card", mode, card: cardView(next, data, now, c), progress: progressOf, left, day, canUndo: sess.undo.length > 0, title };
  const reason = its.length === 0 ? "empty" : mode === "study" && left > 0 ? "block" : "caught-up";
  return {
    screen: "done", mode, reason, day, canUndo: sess.undo.length > 0, title,
    session: {
      answers: sess.answers, passed: sess.passed, seconds: Math.round((now - sess.started) / 1000),
      learned: await words(sess.learned, data), missed: await words(sess.missed, data), mastered: await words(sess.mastered, data),
    },
    left, moreNew: queue(its, data, now, { ...s, newPerDay: 0 }, 1_000_000).counts.new,
    weak: weak(its, data, now).length, tomorrow: st.tomorrow,
    ...(cov && sess.covStart !== undefined && { coverage: { before: sess.covStart, after: progress(cov, data, now).coverage ?? 0, title: cov.title } }),
  };
}

/** The stats page: the streak and its best, the heatmap, the next seven days, each pack's standing. */
export async function statsOf(a: Args | undefined, now = clock()): Promise<Stats> {
  const [data, its] = await Promise.all([load(), pool(a)]);
  const s = srsSettings(), st = stats(data, its, now, s.goal);
  // The best run of days the goal was met, over the whole log.
  const met = Object.entries(st.days).filter(([, n]) => n >= s.goal).map(([d]) => Number(d)).sort((x, y) => x - y);
  let best = 0, run = 0, prev = 0;
  for (const d of met) { run = prev && dayStart(prev + DAY + DAY / 2) === d ? run + 1 : 1; best = Math.max(best, run); prev = d; }
  const t0 = dayStart(now), forecast = new Array<number>(7).fill(0);
  for (const it of its) {
    const m = data.cards[it.key];
    if (!m || m.st === 0) continue;
    const i = Math.max(0, Math.floor((dayStart(m.due) - t0 + DAY / 2) / DAY));
    if (i < 7) forecast[i]++;
  }
  const packsIn = a?.pack ? (await packs()).filter((p) => p.id === a.pack) : await active();
  const lang = packsIn.find((p) => p.lang?.front && p.lang.front !== "en")?.lang?.front;
  // Asked afresh here, so a voice downloaded since pal started is found.
  voices = null;
  const voice = lang && !config().voice ? await bestVoice(lang) : undefined;
  return {
    voice,
    streak: st.streak, best: Math.max(best, st.streak), total: data.log.length,
    seconds: Math.round(data.log.reduce((n, r) => n + Math.min(r[4], 60_000), 0) / 1000),
    retention: st.retention, today: st.todayAnswers, goal: s.goal, heat: heat(st.days, now), forecast,
    packs: packsIn.map((p) => { const pr = progress(p, data, now); return { id: p.id, title: p.title, total: pr.total, mastered: pr.mastered, learning: pr.seen - pr.mastered, fresh: pr.total - pr.seen, coverage: pr.coverage }; }),
  };
}

// ---- answering ------------------------------------------------------------------

async function answerCard(a: Args | undefined, key: string, rating: number, ms: number, now = clock()) {
  const data = await load();
  const sess = session(a);
  const prev = data.cards[key];
  sess.force = undefined;
  const missed = rating === 1 && !sess.missed.includes(key), learned = !sess.drill && (!prev || prev.st === 0);
  sess.undo.push({ key, prev, log: data.log.length, drill: sess.drill?.slice(), missed, learned });
  if (sess.undo.length > 50) sess.undo.shift();
  sess.answers++;
  if (rating > 1) sess.passed++;
  if (missed) sess.missed.push(key);
  if (sess.drill) {
    // The refresher schedules nothing: a Didn't know sends the card three places back, anything else clears it.
    const i = sess.drill.indexOf(key);
    if (i >= 0) sess.drill.splice(i, 1);
    if (rating === 1) sess.drill.splice(Math.min(3, sess.drill.length), 0, key);
    data.log.push([Math.round(now / 1000), key, rating, 4, Math.round(ms)]);
  } else {
    const next = schedule(prev, rating, now, srsSettings().retention);
    data.cards[key] = next;
    data.log.push([Math.round(now / 1000), key, rating, prev?.st ?? 0, Math.round(ms)]);
    if (learned) sess.learned.push(key);
    sess.last = key;
    if (!mastered(prev) && mastered(next)) { sess.mastered.push(key); await save(); return key; }
  }
  await save();
}

/** The card's word in the language learned, for "Mastered: casa". */
async function wordOf(key: string) {
  const it = items(await packs()).find((i) => i.key === key);
  return it?.card.front ?? key;
}

async function undo(a: Args | undefined) {
  const sess = session(a), u = sess.undo.pop();
  if (!u) return;
  const data = await load();
  if (u.prev) data.cards[u.key] = u.prev; else delete data.cards[u.key];
  data.log.length = u.log;
  if (u.drill) sess.drill = u.drill;
  sess.answers = Math.max(0, sess.answers - 1);
  if (u.missed) sess.missed = sess.missed.filter((k) => k !== u.key);
  if (u.learned) sess.learned = sess.learned.filter((k) => k !== u.key);
  sess.mastered = sess.mastered.filter((k) => k !== u.key);
  sess.last = undefined;
  sess.force = u.key;
  await save();
  return u.key;
}

async function suspend(key: string) {
  const data = await load();
  if (!data.suspended.includes(key)) data.suspended.push(key);
  await save();
}

/** Your own meaning for a card, both directions; empty puts the pack's back. */
async function edit(key: string, back: string) {
  const data = await load();
  const base = key.replace(/<$/, "");
  data.edits ??= {};
  if (back.trim()) data.edits[base] = { back: back.trim() }; else delete data.edits[base];
  await save();
}

// ---- speech ---------------------------------------------------------------------

let speaking: ChildProcess | null = null;
let voices: Promise<{ name: string; lang: string }[]> | null = null;

/** macOS's voices (`say -v ?`): "Mónica   es_ES   # ¡Hola! …". */
function macVoices() {
  return voices ??= new Promise((resolve) => {
    const p = spawn("say", ["-v", "?"]);
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("close", () => resolve(out.split("\n").map((l) => l.match(/^(.+?)\s+([a-z]{2}_[A-Z0-9]+)\s+#/)).filter(Boolean).map((m) => ({ name: m![1].trim(), lang: m![2] }))));
    p.on("error", () => resolve([]));
  });
}

/** Plays a sound file, cutting off whatever was speaking. */
async function play(path: string) {
  speaking?.kill();
  const [cmd, ...args] = process.platform === "darwin" ? ["afplay", path] : ["paplay", path];
  speaking = spawn(cmd, args, { stdio: "ignore" });
  speaking.on("error", () => { speaking = spawn("ffplay", ["-nodisp", "-autoexit", "-loglevel", "quiet", path], { stdio: "ignore" }); speaking.on("error", () => {}); });
}

/** How natural a macOS voice sounds: Premium and Enhanced (downloaded in System Settings) over the built-in one, novelty and Eloquence voices ("Eddy (Spanish (Spain))") last. */
const voiceRank = (name: string) => (/premium/i.test(name) ? 0 : /enhanced/i.test(name) ? 1 : !name.includes("(") ? 2 : 3);
export type Voice = { name: string; quality: "premium" | "enhanced" | "basic" };

/** The best installed voice for `lang` (macOS), or null. */
async function bestVoice(lang: string): Promise<Voice | null> {
  if (process.platform !== "darwin") return null;
  const fit = (await macVoices()).filter((v) => v.lang.startsWith(`${lang}_`)).sort((a, b) => voiceRank(a.name) - voiceRank(b.name));
  if (!fit[0]) return null;
  const r = voiceRank(fit[0].name);
  return { name: fit[0].name, quality: r === 0 ? "premium" : r === 1 ? "enhanced" : "basic" };
}

/** Says `text` in `lang` with the system's voice for it; a new line cuts the last one off. */
export async function speak(text: string, lang?: string) {
  speaking?.kill();
  speaking = null;
  const clean = text.replace(/\s*\/\s*/g, ", ").replace(/\.\.\./g, "…").trim();
  if (!clean) return;
  const c = config();
  if (process.platform === "darwin") {
    let voice = c.voice;
    if (!voice && lang) voice = (await bestVoice(lang))?.name ?? "";
    if (!voice && lang && lang !== "en") return;
    speaking = spawn("say", voice ? ["-v", voice, clean] : [clean], { stdio: "ignore" });
  } else {
    speaking = spawn("spd-say", ["-w", ...(lang ? ["-l", lang] : []), clean], { stdio: "ignore" });
    speaking.on("error", () => { speaking = spawn("espeak-ng", [...(lang ? ["-v", lang] : []), clean], { stdio: "ignore" }); speaking.on("error", () => {}); });
  }
  speaking.on("error", () => {});
}

// ---- the page's calls -----------------------------------------------------------

type Msg =
  | { op: "open" } | { op: "screen" } | { op: "folder" }
  | { op: "answer"; key: string; rating: number; ms?: number }
  | { op: "undo" } | { op: "more" } | { op: "mute" } | { op: "suspend"; key: string }
  | { op: "start"; packs: string[] } | { op: "speak"; text: string; lang?: string; key?: string }
  | { op: "keep" } | { op: "drill" } | { op: "stats" } | { op: "edit"; key: string; back: string } | { op: "browse" };

async function onMessage(raw: unknown, ctx?: { args?: unknown }) {
  const m = raw as Msg & { mode?: "study" | "weak" };
  // The page may switch a level between studying and the refresher: its `mode` wins over the level's.
  const base = ctx?.args as Args | undefined;
  const a: Args | undefined = m?.mode ? { ...base, mode: m.mode === "weak" ? "weak" : undefined } : base;
  switch (m?.op) {
    case "open": session(a, true); return screen(a);
    case "screen": return screen(a);
    case "answer": {
      const got = await answerCard(a, String(m.key), Math.min(4, Math.max(1, Number(m.rating) || 1)), Number(m.ms) || 0);
      const sc = await screen(a);
      return got ? { ...sc, mastered: await wordOf(got) } : sc;
    }
    case "undo": { const key = await undo(a); return { ...(await screen(a)), undone: key }; }
    case "more": { const ss = session(a); ss.extraNew += 10; ss.target = ss.answers + blockSize(); return screen(a); }
    case "keep": { const ss = session(a); ss.target = ss.answers + blockSize(); return screen(a); }
    case "drill": {
      // This session's misses, drilled until each is known once in a row.
      const from = session({ ...a, mode: undefined });
      const d = session({ ...a, mode: "weak" }, true);
      d.drill = [...from.missed];
      d.drillOf = "misses";
      return screen({ ...a, mode: "weak" });
    }
    case "stats": return statsOf(a);
    case "edit": await edit(String(m.key), String(m.back ?? "")); return screen(a);
    case "suspend": await suspend(String(m.key)); return screen(a);
    case "start": for (const id of m.packs ?? []) await setActive(String(id), true); return screen(a);
    case "speak": {
      // A deck's own recording of the word over the system voice.
      const it = m.key ? (await pool(a)).find((i) => i.key === m.key) : undefined;
      if (it?.card.audio) await play(it.card.audio); else await speak(String(m.text ?? ""), m.lang);
      return null;
    }
    case "mute": {
      // Mute silences the tones and automatic speech (Tab still speaks); sound on brings the tones back, not automatic speech.
      const c = config(), q = quiet(c);
      await settings.set(q ? { sounds: true } : { sounds: false, ...(c.speak === "auto" && { speak: "key" }) });
      await view.update(study.view(ctx) as View).catch(() => {});
      return { quiet: !q };
    }
    case "folder": await mkdir(packsDir(), { recursive: true }); await openPath(packsDir()); return null;
    case "browse": await browse(); return null;
    default: throw new Error(`flashcards: unknown call ${JSON.stringify(raw)}`);
  }
}

const openPath = (p: string) => new Promise<void>((resolve) => { const c = spawn(process.platform === "darwin" ? "open" : "xdg-open", [p], { stdio: "ignore", detached: true }); c.on("error", () => resolve()); c.unref(); resolve(); });

const quiet = (c = config()) => !c.sounds && c.speak !== "auto";

// ⌘K on the study level: each goes to the page (`pal.onAction`), which knows the card on screen.
const actions = (): Action[] => [
  { id: "speak", title: "Say it", shortcut: "cmd+s" },
  { id: "undo", title: "Undo the last answer", shortcut: "cmd+z" },
  { id: "stats", title: "Stats: streak, heatmap, the week ahead" },
  { id: "edit", title: "Write your own meaning for this card", shortcut: "cmd+e" },
  { id: "weak", title: "Refresher: drill the cards you keep missing", shortcut: "cmd+r" },
  { id: "more", title: "Learn 10 more new cards today", shortcut: "cmd+n" },
  { id: "suspend", title: "Suspend this card (never show it again)", shortcut: "cmd+backspace" },
  { id: "mute", title: quiet() ? "Sound on" : "Mute", shortcut: "cmd+m" },
  { id: "browse", title: "Find decks on AnkiWeb" },
  { id: "folder", title: "Open the packs folder" },
];

/** The root's Now section: a row while cards are due, so they are one Enter away whenever pal opens. */
async function suggest(): Promise<Row[]> {
  if (!config().suggest) return [];
  const data = await load();
  if (!data.active?.length) return [];
  const now = clock(), s = srsSettings(), its = await pool();
  const q = queue(its, data, now, s), st = stats(data, its, now, s.goal);
  const due = q.counts.review + q.counts.learning;
  if (!due) return [];
  return [{
    id: "due", name: `${due} flashcard${due === 1 ? "" : "s"} due`,
    subtitle: [st.goalMet ? "Goal met today" : `${st.todayAnswers} of ${s.goal} today`, st.streak ? `${st.streak}-day streak` : "", q.counts.new ? `${q.counts.new} new waiting` : ""].filter(Boolean).join(" · "),
    icon: { tile: { glyph: "󰘸", bg: "violet" } }, section: "Now",
    actions: [{ id: "study", title: "Study" }],
  }];
}

const study: ViewPalette = {
  title: "Flashcards",
  suggest,
  view: (ctx): View => ({ title: titleOf(ctx?.args as Args, bundled ?? []), tree: { type: "surface", src: "surface/index.html" }, actions: actions() }),
  // The suggestion's row; a surface view's own actions go to the page, not here.
  pick: (id): Effect | void => (id === "due" ? { push: { extension: EXT, palette: STUDY } } : undefined),
  onMessage,
};

// ---- Flashcard Packs ---------------------------------------------------------------

const pct = (n: number) => `${Math.round(n * 100)}%`;

async function packRows(): Promise<Row[]> {
  const [all, data] = await Promise.all([packs(), load()]);
  const now = clock(), on = new Set(data.active ?? []);
  const rows: Row[] = all.map((p) => {
    const pr = progress(p, data, now), inRot = on.has(p.id);
    const w = weak(items([p]), data, now).length;
    return {
      id: p.id, name: p.title,
      subtitle: `${pr.mastered} mastered · ${pr.seen - pr.mastered} learning · ${pr.total - pr.seen} new`,
      section: inRot ? "Practising" : "More packs",
      icon: inRot ? { glyph: "󰘸", color: "violet" } : { glyph: "󰘸", color: "slate" },
      keywords: [p.id, ...(p.description ? [p.description] : [])],
      accessories: [
        ...(pr.due ? [{ tag: `${pr.due} due`, color: "blue" }] : []),
        ...(pr.coverage !== undefined && pr.seen ? [{ text: `covers ${pct(pr.coverage)}` }] : []),
        { text: `${pct(pr.mastered / Math.max(1, pr.total))} mastered` },
      ],
      detail: {
        markdown: [`## ${p.title}`, p.description ?? "", pr.coverage !== undefined ? `The words you know cover **${pct(pr.coverage)}** of everyday spoken language, counting each by how often it is heard.` : "", p.source ? `<sub>${p.source}</sub>` : ""].filter(Boolean).join("\n\n"),
        metadata: [
          { label: "Cards", value: String(pr.total) },
          { label: "Mastered", value: `${pr.mastered} (not due for 3 weeks or more)` },
          { label: "Learning", value: String(pr.seen - pr.mastered) },
          { label: "Not seen yet", value: String(pr.total - pr.seen) },
          { label: "Due today", value: String(pr.due) },
          ...(w ? [{ label: "Weak", value: `${w} for the refresher` }] : []),
          { label: "Directions", value: p.reverse ? "Both: recognise it, then type it" : "One way" },
          { label: "Source", value: p.bundled ? "Bundled" : p.path ?? "" },
        ],
      },
      actions: [
        { id: "study", title: "Study this pack" },
        { id: inRot ? "remove" : "add", title: inRot ? "Stop practising (progress is kept)" : "Add to practice", shortcut: "cmd+enter" },
        ...(w ? [{ id: "weak", title: `Refresher: ${w} weak cards`, shortcut: "cmd+r" }] : []),
        ...(p.path ? [{ id: "reveal", title: "Show the file", shortcut: "cmd+shift+o" }] : []),
        { id: "folder", title: "Open the packs folder" },
      ],
    } satisfies Row;
  });
  for (const e of folderErrors) rows.push(hint(`err:${e}`, "A pack file could not be read", e));
  rows.push({ id: "browse", name: "Find decks on AnkiWeb", subtitle: "Thousands of shared decks, many with native audio: search, preview, add", icon: { tile: { glyph: "󰇚", bg: "blue" } }, section: "More packs", actions: [{ id: "browse", title: "Browse Anki Decks" }] });
  rows.push(hint("add-your-own", "Add your own pack", `A .tsv, .csv or .json in ${packsDir()} (an Anki "Notes in plain text" export works)`, { actions: [{ id: "folder", title: "Open the packs folder" }] }));
  return rows;
}

async function packPick(id: string, action?: string): Promise<Effect | void> {
  if (id === "browse") return { push: { extension: EXT, palette: "flashcard-anki" } };
  if (action === "folder" || id === "hint:add-your-own") { await mkdir(packsDir(), { recursive: true }); return { open: packsDir() }; }
  if (action === "reveal") { const p = (await packs()).find((x) => x.id === id); return p?.path ? { open: packsDir() } : undefined; }
  if (action === "add" || action === "remove") { await setActive(id, action === "add"); return { keep: true, hud: action === "add" ? "Added to practice" : "No longer practising" }; }
  if (action === "weak") return { push: { extension: EXT, palette: STUDY, args: { pack: id, mode: "weak" } } };
  return { push: { extension: EXT, palette: STUDY, args: { pack: id } } };
}

// ---- Browse Anki Decks ------------------------------------------------------------

const LANG_NAME: Record<string, string> = { es: "spanish", fr: "french", de: "german", it: "italian", pt: "portuguese", ja: "japanese", tr: "turkish", nl: "dutch", ko: "korean", zh: "chinese", ru: "russian" };
const fileOf = (id: number) => join(packsDir(), `anki-${id}.apkg`);
const downloading = new Set<number>();
const year = (unix: number) => (unix ? new Date(unix * 1000).getFullYear() : "");
const rating = (up: number, down: number) => (up + down ? Math.round((up / (up + down)) * 100) : null);

async function ankiRows(q = ""): Promise<Row[]> {
  // Nothing typed: the decks for the language already being learned.
  const lang = (await active()).map((p) => p.lang?.front).find((l) => l && l !== "en");
  const query = q.trim() || (lang ? LANG_NAME[lang] ?? "" : "");
  if (!query) return [hint("type", "Type what you want to learn", "spanish, japanese kana, capitals, anatomy… AnkiWeb's shared decks")];
  let decks: import("./ankiweb.ts").Deck[];
  try { decks = await ankiweb.search(query); } catch (e) { return [hint("offline", "AnkiWeb can't be reached", (e as Error).message)]; }
  if (!decks.length) return [hint("none", `No shared decks for “${query}”`, "Try fewer words, or the language's English name")];
  const have = new Set((await readdir(packsDir()).catch(() => [] as string[])));
  return decks.slice(0, 60).map((d) => {
    const added = have.has(`anki-${d.id}.apkg`), busy = downloading.has(d.id), pct = rating(d.up, d.down);
    return {
      id: String(d.id), name: d.title,
      subtitle: [`${d.notes.toLocaleString("en")} cards`, d.audio ? "audio" : "", d.images ? "pictures" : "", year(d.updated) ? `updated ${year(d.updated)}` : ""].filter(Boolean).join(" · "),
      section: q.trim() ? undefined : `${query[0].toUpperCase()}${query.slice(1)} on AnkiWeb`,
      icon: added ? { tile: { glyph: "󰄬", bg: "green" } } : { tile: { glyph: "󰘸", bg: "slate" } },
      accessories: [
        ...(busy ? [{ tag: "Downloading…", color: "blue" }] : added ? [{ tag: "Added", color: "green" }] : []),
        ...(pct !== null ? [{ text: `${pct}% of ${d.up + d.down} liked` }] : []),
      ],
      actions: added
        ? [{ id: "study", title: "Study it" }, { id: "open", title: "Open on AnkiWeb", shortcut: "cmd+enter" }]
        : [{ id: "add", title: "Add to Flashcards" }, { id: "open", title: "Open on AnkiWeb", shortcut: "cmd+enter" }],
    } satisfies Row;
  });
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n).replace(/\s+\S*$/, "")}…` : s);
const plain = (s: string) => s.replace(/\[(sound|image):[^\]]*\]/g, "").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/\|/g, "/").replace(/\s+/g, " ").trim();

async function ankiDetail(id: string) {
  const d = await ankiweb.info(Number(id));
  // A few of its notes as they would be cards: the fields apkg.ts would pick.
  const rows = d.samples.slice(0, 4).map((n) => {
    const r = roles(n.map((f) => f.name));
    return `| ${plain(n[r.front!]?.value ?? "")} | ${plain(n[r.back!]?.value ?? "")} |`;
  });
  const pct = rating(d.up, d.down);
  return {
    markdown: [`## ${d.title}`, clip(plain(d.description.replace(/\n/g, " <br> ")), 700), rows.length ? `**Sample cards**\n\n| Front | Back |\n| --- | --- |\n${rows.join("\n")}` : ""].filter(Boolean).join("\n\n"),
    metadata: [
      { label: "Cards", value: d.notes.toLocaleString("en") },
      ...(d.audio ? [{ label: "Audio", value: `${d.audio.toLocaleString("en")} recordings, played on Tab` }] : []),
      ...(d.images ? [{ label: "Pictures", value: d.images.toLocaleString("en") }] : []),
      { label: "Download", value: `${Math.max(1, Math.round(d.size / 1e6))} MB` },
      ...(pct !== null ? [{ label: "Liked", value: `${pct}% of ${d.up + d.down}` }] : []),
      ...(d.updated ? [{ label: "Updated", value: String(year(d.updated)) }] : []),
      ...(d.tags ? [{ label: "Tags", tags: d.tags.split(/\s+/).slice(0, 6).map((t) => ({ text: t })) }] : []),
    ],
  };
}

/** Downloads in the background: the pick answers at once, the HUD says when the deck is in practice. */
async function addAnki(id: number, title: string) {
  downloading.add(id);
  try {
    const bytes = await ankiweb.download(id);
    await mkdir(packsDir(), { recursive: true });
    await writeFile(fileOf(id), bytes);
    folder = null;
    // Read it now (a big deck's recordings are written once), so the first study does not wait.
    const pack = (await packs()).find((p) => p.id === `anki-${id}`);
    if (!pack) throw new Error("the download is not a deck pal can read");
    await setActive(pack.id, true);
    await effects.run({ hud: `Added ${pack.title}: ${pack.cards.length} cards` });
  } catch (e) {
    await rm(fileOf(id), { force: true });
    await effects.run({ hud: `Could not add ${title}: ${(e as Error).message}` }).catch(() => {});
  } finally {
    downloading.delete(id);
  }
}

async function ankiPick(id: string, action?: string): Promise<Effect | void> {
  if (id.startsWith("hint:")) return;
  const n = Number(id);
  if (action === "open") return { open: ankiweb.pageOf(n) };
  if (action === "study") return { push: { extension: EXT, palette: STUDY, args: { pack: `anki-${n}` } } };
  if (downloading.has(n)) return { toast: { title: "Already downloading" }, keep: true };
  const title = (await ankiweb.info(n).catch(() => null))?.title ?? "the deck";
  addAnki(n, title);
  return { toast: { title: `Downloading ${title}`, message: "It joins your practice when it is in" }, keep: true };
}

/** From the page (the first open's link, cmd+k): the panel inside Browse Anki Decks. */
const browse = () => effects.run({ push: { extension: EXT, palette: "flashcard-anki" } });

// ---- Add Flashcard -------------------------------------------------------------------

/** "gato = cat", "gato; cat", "gato → cat", "gato - cat" … front and back. */
export function splitCard(q: string): { front: string; back: string } | null {
  const m = q.match(/^\s*(.+?)\s*(?:=|→|->|;|\t| - | – )\s*(.+?)\s*$/);
  return m ? { front: m[1], back: m[2] } : null;
}

async function addRows(q = ""): Promise<Row[]> {
  const c = splitCard(q);
  if (!c) return [hint("how", q.trim() ? "Type the back after an =" : "Type front = back", `gato = cat · goes into “My cards”, practised with the rest`)];
  return [{ id: `add:${c.front}\t${c.back}`, name: `${c.front}  →  ${c.back}`, subtitle: "Add to My cards", icon: { glyph: "󰐕", color: "violet" }, actions: [{ id: "add", title: "Add the card" }] }];
}

async function addPick(id: string): Promise<Effect | void> {
  if (!id.startsWith("add:")) return;
  const [front, back] = id.slice(4).split("\t");
  const c = { front, back };
  await mkdir(packsDir(), { recursive: true });
  const file = join(packsDir(), `${MINE}.tsv`);
  let head = "";
  try { await readFile(file, "utf8"); } catch { head = "front\tback\n"; }
  folder = null;
  await appendFile(file, `${head}${c.front.replace(/\t/g, " ")}\t${c.back.replace(/\t/g, " ")}\n`);
  const data = await load();
  if (!(data.active ?? []).includes(MINE)) { data.active = [...(data.active ?? []), MINE]; await save(); }
  return { hud: `Added: ${c.front}`, keep: true };
}

export default {
  palettes: {
    [STUDY]: study,
    "flashcard-packs": { title: "Flashcard Packs", live: true, list: packRows, pick: packPick },
    "flashcard-add": { title: "Add Flashcard", input: true, list: addRows, pick: addPick },
    "flashcard-anki": { title: "Browse Anki Decks", input: true, list: ankiRows, detail: ankiDetail, pick: ankiPick },
  },
} satisfies Extension;
