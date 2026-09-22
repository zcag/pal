// Translate: an input palette. What is typed is translated as it is typed
// (350 ms after the last key), the target from a prefix (`tr: hello`,
// `>de hello`, `en>tr merhaba`; lang.ts) else the `to` setting else the
// system language, the source detected unless `from` names one. Nothing
// typed: the selection in the app in front, else the newest clipboard
// text. The first row is the translation (Enter copies, cmd+Enter pastes,
// cmd+shift+s speaks it), then the detected language, the alternatives,
// the romanisation when the backend gives one, dictionary entries for a
// word, and a Swap row that translates the result back. `backends.ts` is
// Google's unofficial web endpoint or DeepL with a key. A picked
// translation goes to the history palette (storage, the last hundred).
import { createHash } from "node:crypto";
import { errorMessage, hint, oneLine, settings, storage, textAtHand, toast, truncate, when, type Action, type Ctx, type Detail, type Effect, type Extension, type Item } from "@zcag/pal";
import { MAX_CHARS, speak, translate, TranslateError, type Backend, type Translation } from "./backends.ts";
import { langOf, matches, nameOf, otherEnd, parse, systemLanguage } from "./lang.ts";

/** `[extensions.translate]`, defaults in pal.json. */
type Settings = { from: string; to: string; backend: Backend; api_key: string; speak: boolean };

/** Material Design glyphs from the bundled Nerd Font; the tile's blue tints them. */
const GLYPH = {
  translate: "\u{f05ca}", // md-translate
  earth: "\u{f01e7}", // md-earth
  alt: "\u{f0e73}", // md-arrow_left_right
  latin: "\u{f002c}", // md-alphabetical
  dict: "\u{f14f7}", // md-book_open_variant
  swap: "\u{f04e1}", // md-swap_horizontal
  history: "\u{f02da}", // md-history
  broom: "\u{f00e2}", // md-broom
  alert: "\u{f05d6}", // md-alert_circle_outline
  wait: "\u{f051f}", // md-timer_sand
};

const COPY: Action = { id: "copy", title: "Copy" };
const PASTE: Action = { id: "paste", title: "Paste" };
const SPEAK: Action = { id: "speak", title: "Speak", shortcut: "cmd+shift+s" };
const COPY_SOURCE: Action = { id: "copy_source", title: "Copy the source text", shortcut: "cmd+shift+c" };
const OPEN_WEB: Action = { id: "open", title: "Open in Google Translate", shortcut: "cmd+o" };
const AGAIN: Action = { id: "again", title: "Translate again", shortcut: "cmd+t" };
const REMOVE: Action = { id: "remove", title: "Remove from history", shortcut: "cmd+d", style: "destructive" };
const CLEAR: Action = { id: "clear", title: "Clear history", style: "destructive", confirm: "Forget every translation in the history?" };

/** Keystrokes settle for this long before a request goes out. */
const DEBOUNCE_MS = 350;
const HISTORY_MAX = 100;
const CACHE_MAX = 200;

const S = () => settings.get<Settings>();

/** A row's payload for `pick`: what to copy or speak, in which language, and the source it came from. */
type Held = { text: string; lang: string; source: string; from: string; to: string; backend: Backend };
const held = new Map<string, Held>();

// ---- history ------------------------------------------------------------------

type Entry = { text: string; result: string; from: string; to: string; backend: Backend; at: number };
const history = async (): Promise<Entry[]> => ((await storage.get<Entry[]>("history")) ?? []).filter((e) => e && typeof e.text === "string" && typeof e.result === "string");

async function remember(h: Held): Promise<void> {
  const list = (await history()).filter((e) => !(e.text === h.source && e.to === h.to && e.result === h.text));
  list.unshift({ text: h.source, result: h.text, from: h.from, to: h.to, backend: h.backend, at: Date.now() });
  await storage.set("history", list.slice(0, HISTORY_MAX));
}

// ---- the source text -------------------------------------------------------------

type Source = { text: string; where: "typed" | "selection" | "clipboard" };

/** Typed text as it is; nothing typed: the selection, else the clipboard (`textAtHand`, read once per 2 s across empty listings). */
const source = async (typed: string): Promise<Source | undefined> => (typed ? { text: typed, where: "typed" } : (await textAtHand()) ?? undefined);

// ---- translating -------------------------------------------------------------------

const cache = new Map<string, Translation>();
let seq = 0;

/** The target for a query: the prefix, else the `to` setting (a code or a name), else the system language; then the other end when the text is already in it. */
function targets(p: ReturnType<typeof parse>, s: Settings): { from: string; to: string } {
  const from = p.from !== "auto" ? p.from : langOf(s.from || "auto") ?? "auto";
  const to = p.to ?? langOf(s.to || "") ?? systemLanguage();
  return { from, to };
}

async function fetchTranslation(text: string, from: string, to: string, s: Settings): Promise<Translation> {
  const key = `${s.backend}|${from}|${to}|${text}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const t = await translate(s.backend, text, from, to, s.api_key ?? "");
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, t);
  return t;
}

// ---- rows -------------------------------------------------------------------------

const short = (text: string, n = 120) => truncate(oneLine(text), n);
const pair = (from: string, to: string) => `${nameOf(from)} → ${nameOf(to)}`;
const BACKEND_NAME: Record<Backend, string> = { google: "Google Translate", deepl: "DeepL" };
const webUrl = (h: Held) => `https://translate.google.com/?sl=${encodeURIComponent(h.from)}&tl=${encodeURIComponent(h.to)}&text=${encodeURIComponent(h.source)}&op=translate`;

/** A row whose Enter copies `text`: the translation, an alternative, a romanisation, a dictionary word. */
function textRow(id: string, text: string, lang: string, t: Translation, src: Source, o: { subtitle: string; icon?: string; detail?: Detail; accessories?: Item["accessories"]; keywords?: string[]; actions?: Action[] }): Item {
  held.set(id, { text, lang, source: src.text, from: t.from, to: t.to, backend: t.backend });
  return { id, name: short(text), subtitle: o.subtitle, icon: o.icon ?? GLYPH.translate, keywords: o.keywords, accessories: o.accessories, detail: o.detail ?? { markdown: text }, actions: o.actions ?? [COPY, PASTE, SPEAK, COPY_SOURCE, OPEN_WEB] };
}

/** Letters outside the Latin script: a romanisation row is worth showing for such a text, and an IPA pronunciation of a Latin one is not one. */
const nonLatin = (text: string): boolean => /[\p{L}&&[^\p{Script=Latin}]]/v.test(text);

function rows(t: Translation, src: Source, cut: boolean, given: boolean): Item[] {
  const whence = src.where === "typed" ? "" : src.where === "selection" ? " · from the selection" : " · from the clipboard";
  if (t.from === t.to) {
    // Nothing to translate to: the text is in the only language the settings name (an English text, `to` unset on an English system).
    return [
      hint("same", `Already ${nameOf(t.from)}`, "Set `to` (or `from`) to the other language of your pair, or name a target: tr: …, >de …", { icon: GLYPH.earth }),
      hint("prefix", "Name the target with a prefix", "tr: hello · >de hello · en>tr merhaba · german: hello"),
    ];
  }
  const detail: Detail = {
    markdown: `${t.text}\n\n---\n\n${src.text}`,
    metadata: [
      { label: "From", value: `${nameOf(t.from)} (${t.from})` },
      { label: "To", value: `${nameOf(t.to)} (${t.to})` },
      { label: "Backend", value: BACKEND_NAME[t.backend] },
      ...(t.confidence !== undefined && !given ? [{ label: "Detection", value: `${Math.round(t.confidence * 100)}% sure` }] : []),
      { label: "Length", value: `${src.text.length} → ${t.text.length} characters${cut ? ` (cut at ${MAX_CHARS})` : ""}` },
    ],
  };
  const out: Item[] = [textRow("translation", t.text, t.to, t, src, { subtitle: `${pair(t.from, t.to)} · ${BACKEND_NAME[t.backend]}${whence}${cut ? " · text cut" : ""}`, detail, keywords: [src.text] })];
  if (t.translit && nonLatin(t.text)) out.push(textRow("translit", t.translit, t.to, t, src, { subtitle: `${nameOf(t.to)} in Latin letters`, icon: GLYPH.latin }));
  out.push(given ? hint("detected", `From ${nameOf(t.from)}`, `As the prefix says · translated to ${nameOf(t.to)}`, { icon: GLYPH.earth }) : hint("detected", `${nameOf(t.from)} detected`, t.confidence !== undefined && t.confidence < 0.999 ? `${Math.round(t.confidence * 100)}% sure · translated to ${nameOf(t.to)}` : `Translated to ${nameOf(t.to)}`, { icon: GLYPH.earth }));
  t.alternatives.forEach((a, i) => out.push(textRow(`alt:${i}`, a, t.to, t, src, { subtitle: "Alternative", icon: GLYPH.alt })));
  if (t.srcTranslit && nonLatin(src.text)) out.push(textRow("src-translit", t.srcTranslit, t.from, t, src, { subtitle: `The ${nameOf(t.from)} text in Latin letters`, icon: GLYPH.latin }));
  t.dictionary.forEach((d, i) => out.push(textRow(`dict:${i}`, d.word, t.to, t, src, { subtitle: `${d.pos ? `${d.pos} · ` : ""}${d.back.join(", ")}`, icon: GLYPH.dict, detail: { markdown: `**${d.word}**${d.pos ? ` *(${d.pos})*` : ""}\n\n${d.back.join(", ")}` } })));
  held.set("swap", { text: t.text, lang: t.to, source: src.text, from: t.from, to: t.to, backend: t.backend });
  out.push({ id: "swap", name: `Swap: ${pair(t.to, t.from)}`, subtitle: "Translate the result back", icon: GLYPH.swap, actions: [{ id: "swap", title: "Swap and translate" }] });
  return out;
}

function hints(s: Settings): Item[] {
  const to = langOf(s.to || "") ?? systemLanguage();
  return [
    hint("type", `Type text to translate to ${nameOf(to)}`, `Or select text in the app in front and open the palette · ${BACKEND_NAME[s.backend]}`),
    hint("prefix", "Name the target with a prefix", "tr: hello · >de hello · en>tr merhaba · german: hello"),
  ];
}

async function list(query = "", ctx?: Ctx): Promise<Item[]> {
  const s = S();
  const p = parse(query);
  const my = ++seq;
  // The root's inline ask is debounced by the host; inside the palette every key would be a request without this wait.
  if (p.text && !ctx?.inline) {
    await Bun.sleep(DEBOUNCE_MS);
    if (my !== seq) return [hint("wait", "Translating…", short(p.text), { icon: GLYPH.wait })];
  }
  if (ctx?.inline && !p.text) return [];
  const src = await source(p.text);
  if (!src) return hints(s);
  if (my !== seq) return [hint("wait", "Translating…", short(src.text), { icon: GLYPH.wait })];
  const { from, to: wanted } = targets(p, s);
  const cut = src.text.length > MAX_CHARS;
  const text = cut ? src.text.slice(0, MAX_CHARS) : src.text;
  try {
    let t = await fetchTranslation(text, from, wanted, s);
    // Already in the target (an English text with `to = en`): the other way round, once.
    const other = otherEnd(t.from, wanted, from);
    if (other !== wanted && !p.to) t = await fetchTranslation(text, from, other, s);
    if (my !== seq && !ctx?.inline) return [hint("wait", "Translating…", short(src.text), { icon: GLYPH.wait })];
    held.clear();
    return rows(t, src, cut, from !== "auto");
  } catch (e) {
    const te = e instanceof TranslateError ? e : undefined;
    console.error(`[translate] ${te?.message ?? e}`);
    return [hint("failed", te ? te.hint : `Could not translate: ${errorMessage(e)}`, short(src.text), { icon: GLYPH.alert })];
  }
}

async function pick(id: string, action?: string): Promise<Effect> {
  const h = held.get(id);
  if (!h) return toast("Translation is gone", "The listing changed; pick again", "failure");
  if (id === "swap") return { push: { extension: "translate", palette: "translate", query: `${h.to}>${h.from} ${h.text}` } };
  switch (action) {
    case "paste": await remember(h); return { paste: { text: h.text } };
    case "speak": {
      if (!(await speak(h.text, h.lang))) return toast("Nothing can speak here", "Install spd-say or espeak", "failure");
      await remember(h);
      return toast("Speaking", short(h.text, 60));
    }
    case "copy_source": return { copy: h.source };
    case "open": return { open: webUrl(h) };
    default:
      await remember(h);
      if (S().speak) await speak(h.text, h.lang);
      return { copy: h.text };
  }
}

// ---- history palette -----------------------------------------------------------------

const historyDetail = (e: Entry): Detail => ({ markdown: `${e.result}\n\n---\n\n${e.text}`, metadata: [{ label: "From", value: nameOf(e.from) }, { label: "To", value: nameOf(e.to) }, { label: "Backend", value: BACKEND_NAME[e.backend] ?? e.backend }, { label: "When", value: when(e.at) }] });
/** One row per (target, text, result), which is also what `remember` dedupes on; a hash, since the texts can be long. */
const historyId = (e: Entry) => `h:${createHash("sha1").update(`${e.to}|${e.text}|${e.result}`).digest("hex").slice(0, 16)}`;

async function historyRows(): Promise<Item[]> {
  const list = await history();
  if (!list.length) return [hint("empty", "Nothing translated yet", "A translation you copy, paste or speak lands here", { icon: GLYPH.history })];
  const rows = list.map((e): Item => ({
    id: historyId(e), name: short(e.result), subtitle: `${short(e.text, 60)} · ${pair(e.from, e.to)}`, icon: GLYPH.translate, keywords: [e.text],
    accessories: [{ date: e.at }], detail: historyDetail(e),
    actions: [COPY, PASTE, SPEAK, AGAIN, COPY_SOURCE, REMOVE],
  }));
  rows.push({ id: "clear", name: "Clear history", subtitle: `${list.length} ${list.length === 1 ? "translation" : "translations"}`, icon: GLYPH.broom, actions: [CLEAR] });
  return rows;
}

async function historyPick(id: string, action?: string): Promise<Effect> {
  if (id === "clear") { await storage.remove("history"); return toast("History cleared"); }
  const list = await history();
  const e = list.find((x) => historyId(x) === id);
  if (!e) return toast("Entry is gone", undefined, "failure");
  switch (action) {
    case "paste": return { paste: { text: e.result } };
    case "speak": return (await speak(e.result, e.to)) ? toast("Speaking", short(e.result, 60)) : toast("Nothing can speak here", "Install spd-say or espeak", "failure");
    case "again": return { push: { extension: "translate", palette: "translate", query: `${e.from === "auto" ? "" : e.from}>${e.to} ${e.text}` } };
    case "copy_source": return { copy: e.text };
    case "remove": await storage.set("history", list.filter((x) => historyId(x) !== id)); return toast("Removed", short(e.result, 60));
    default: return { copy: e.result };
  }
}

export default {
  palettes: {
    translate: {
      title: "Translate",
      input: true,
      // At the root: `tr: hello`, `>de hello`, `en>tr merhaba` answer inline under a Translate section.
      match: matches,
      inline: true,
      placeholder: "Text to translate, or tr: text, >de text, en>tr text",
      list,
      pick,
    },
    history: {
      title: "Translation History",
      // Newest first is the order; listed again on every show so a translation made in the panel is there next time.
      live: true,
      placeholder: "Search past translations",
      list: historyRows,
      pick: historyPick,
    },
  },
} satisfies Extension;
