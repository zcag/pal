// The two translators and the speaker. Google is the web app's own
// endpoint (`translate_a/single`, client `dict-chrome-ex`, the one the
// Chrome dictionary extension uses): no key, unofficial, and it answers
// the translation, the detected language, per-segment alternatives, a
// romanisation of either side and dictionary entries in one JSON reply.
// It can refuse an address it thinks automated (`gtx`, the client most
// scripts use, did so from Cagdas's network on 2026-09-17; `dict-chrome-ex`
// answered) and may change without notice; the README says so. DeepL is
// the documented v2 API on the free host with the user's key. `speak` is
// `say` on macOS with a voice of the language when one is installed,
// `spd-say` else `espeak` on Linux.
import { deeplSource, deeplTarget, fromDeepl } from "./lang.ts";

export type Backend = "google" | "deepl";

/** One answer, whichever backend: the text, where it came from, and what more the backend said. */
export type Translation = {
  text: string;
  /** The detected (or given) source, a Google code. */
  from: string;
  to: string;
  backend: Backend;
  /** Other renderings of the whole text or its segments, the first translation excluded. */
  alternatives: string[];
  /** The translation in Latin letters, when the target's script is not Latin. */
  translit?: string;
  /** The source in Latin letters, likewise. */
  srcTranslit?: string;
  /** Dictionary entries for a word or a short phrase: `noun: 今日は (hello, good day)`. */
  dictionary: { pos: string; word: string; back: string[] }[];
  /** 0..1 from the detector, when it says. */
  confidence?: number;
};

/** The tests point both at a Bun mock. */
export const GOOGLE = (process.env.PAL_TRANSLATE_GOOGLE || "https://translate.googleapis.com").replace(/\/+$/, "");
export const DEEPL = (process.env.PAL_TRANSLATE_DEEPL || "https://api-free.deepl.com").replace(/\/+$/, "");
/** A translation past this is a hint row; the root's inline budget is 1.5 s. */
export const FETCH_MS = 6000;
/** Google takes 5000 characters per request; longer text is cut and the row says so. */
export const MAX_CHARS = 5000;

/** A backend's refusal, with a line for the hint row. */
export class TranslateError extends Error {
  constructor(message: string, public readonly hint: string) { super(message); }
}

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

/** The shape of `dj=1` answers, the fields read. */
type GoogleReply = {
  sentences?: ({ trans?: string; orig?: string } & { translit?: string; src_translit?: string })[];
  src?: string;
  alternative_translations?: { src_phrase?: string; alternative?: { word_postproc?: string }[] }[];
  dict?: { pos?: string; entry?: { word?: string; reverse_translation?: string[] }[] }[];
  ld_result?: { srclangs?: string[]; srclangs_confidences?: number[] };
  confidence?: number;
};

/** `alternative_translations` is per segment; a whole-text alternative is the segments' second choices joined, and single-segment texts list every choice. */
export function googleAlternatives(reply: GoogleReply, first: string): string[] {
  const segs = reply.alternative_translations ?? [];
  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  const out: string[] = [];
  const add = (s: string | undefined) => { if (s && norm(s) !== norm(first) && !out.some((o) => norm(o) === norm(s))) out.push(s.trim()); };
  if (segs.length === 1) for (const a of segs[0].alternative ?? []) add(a.word_postproc);
  else if (segs.length > 1) {
    // Up to three whole-text renderings: the nth choice of every segment, the first where a segment has fewer.
    for (let n = 1; n < 4; n++) {
      const alts = segs.map((s) => s.alternative ?? []);
      if (!alts.some((a) => a.length > n)) break;
      add(alts.map((a) => (a[n] ?? a[0])?.word_postproc ?? "").join(" "));
    }
  }
  return out.slice(0, 5);
}

export function parseGoogle(reply: GoogleReply, to: string): Translation {
  const sentences = reply.sentences ?? [];
  const text = sentences.map((s) => s.trans ?? "").join("").trim();
  const tail = sentences.find((s) => s.translit !== undefined || s.src_translit !== undefined);
  const from = reply.src || reply.ld_result?.srclangs?.[0] || "auto";
  const dictionary = (reply.dict ?? []).flatMap((d) => (d.entry ?? []).map((e) => ({ pos: d.pos ?? "", word: e.word ?? "", back: e.reverse_translation ?? [] }))).filter((d) => d.word).slice(0, 6);
  return {
    text, from, to, backend: "google",
    alternatives: googleAlternatives(reply, text),
    translit: tail?.translit || undefined,
    srcTranslit: tail?.src_translit || undefined,
    dictionary,
    confidence: reply.confidence ?? reply.ld_result?.srclangs_confidences?.[0],
  };
}

async function google(text: string, from: string, to: string, signal: AbortSignal): Promise<Translation> {
  const q = new URLSearchParams({ client: "dict-chrome-ex", sl: from, tl: to, dj: "1" });
  for (const dt of ["t", "at", "rm", "ld", "bd"]) q.append("dt", dt);
  const body = new URLSearchParams({ q: text });
  const r = await fetch(`${GOOGLE}/translate_a/single?${q}`, { method: "POST", body, headers: { "User-Agent": UA }, signal });
  const raw = await r.text();
  if (!r.ok || raw.startsWith("<")) {
    // A "Sorry..." page is Google refusing the address, not the text; a 4xx is the same refusal with a code.
    const refused = raw.includes("Sorry") || r.status === 429 || r.status === 403;
    throw new TranslateError(`Google answered ${r.status}${refused ? " (automated-query refusal)" : ""}`, refused ? "Google is refusing this network for now: switch `backend` to DeepL with a key, or try later" : `Google answered ${r.status}: try again`);
  }
  let reply: GoogleReply;
  try { reply = JSON.parse(raw); } catch { throw new TranslateError("Google answered something that is not JSON", "Google's unofficial endpoint changed shape: switch `backend` to DeepL with a key"); }
  return parseGoogle(reply, to);
}

type DeeplReply = { translations?: { detected_source_language?: string; text?: string }[]; message?: string };

async function deepl(text: string, from: string, to: string, key: string, signal: AbortSignal): Promise<Translation> {
  if (!key) throw new TranslateError("no DeepL key", "Set `api_key` under Settings › Extensions › Translate (a free key ends in :fx), or switch `backend` to Google");
  const body = { text: [text], target_lang: deeplTarget(to), ...(deeplSource(from) && { source_lang: deeplSource(from) }) };
  const r = await fetch(`${DEEPL}/v2/translate`, { method: "POST", body: JSON.stringify(body), headers: { Authorization: `DeepL-Auth-Key ${key}`, "Content-Type": "application/json" }, signal });
  const reply = (await r.json().catch(() => ({}))) as DeeplReply;
  if (!r.ok) {
    const why = r.status === 403 ? "DeepL rejected the key: check `api_key` (a free key ends in :fx)" : r.status === 456 ? "DeepL's monthly quota for this key is used up" : r.status === 429 ? "DeepL asks to slow down: try again in a moment" : `DeepL answered ${r.status}${reply.message ? `: ${reply.message}` : ""}`;
    throw new TranslateError(why, why);
  }
  const t = reply.translations?.[0];
  if (!t?.text) throw new TranslateError("DeepL answered no translation", "DeepL answered nothing for this text");
  return { text: t.text, from: t.detected_source_language ? fromDeepl(t.detected_source_language) : from, to, backend: "deepl", alternatives: [], dictionary: [] };
}

/** One translation through the chosen backend, within `FETCH_MS`. */
export async function translate(backend: Backend, text: string, from: string, to: string, key: string): Promise<Translation> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_MS);
  try {
    return await (backend === "deepl" ? deepl(text, from, to, key, ctl.signal) : google(text, from, to, ctl.signal));
  } catch (e) {
    if (e instanceof TranslateError) throw e;
    const offline = ctl.signal.aborted || /fetch|network|ECONN|ENOTFOUND|EAI_AGAIN/i.test(String(e));
    throw new TranslateError(String((e as Error)?.message ?? e), offline ? `Could not reach ${backend === "deepl" ? "DeepL" : "Google"}: check the network and try again` : String((e as Error)?.message ?? e));
  } finally {
    clearTimeout(timer);
  }
}

// ---- speech ------------------------------------------------------------------

const MAC = process.platform === "darwin";
let voices: Promise<{ name: string; lang: string }[]> | undefined;

/** `say -v ?`: one voice per line, `Name  ll_RR  # sample`; names may have spaces ("Bad News"). */
export function parseVoices(text: string): { name: string; lang: string }[] {
  return text.split("\n").flatMap((l) => { const m = /^(.+?)\s{2,}([a-z]{2,3}(?:[_-][A-Za-z]{2,4})?)\s+#/.exec(l); return m ? [{ name: m[1].trim(), lang: m[2] }] : []; });
}

/** The first installed voice whose locale starts with the language, else undefined (the default voice speaks). */
export const voiceFor = (list: { name: string; lang: string }[], lang: string): string | undefined => {
  const base = lang.split("-")[0].toLowerCase();
  const exact = list.find((v) => v.lang.toLowerCase().replace("_", "-") === lang.toLowerCase());
  return (exact ?? list.find((v) => v.lang.toLowerCase().split(/[_-]/)[0] === base))?.name;
};

/** The argv that speaks `text` in `lang`; undefined when this machine has no speaker. */
export async function speakArgv(text: string, lang: string): Promise<string[] | undefined> {
  const bin = process.env.PAL_TRANSLATE_SAY;
  if (bin) return [bin, lang, text];
  if (MAC) {
    voices ??= (async () => { try { return parseVoices(await new Response(Bun.spawn(["say", "-v", "?"], { stdout: "pipe", stderr: "ignore" }).stdout).text()); } catch { return []; } })();
    const v = voiceFor(await voices, lang);
    return ["say", ...(v ? ["-v", v] : []), "--", text];
  }
  if (Bun.which("spd-say")) return ["spd-say", "-l", lang.split("-")[0], "--", text];
  if (Bun.which("espeak-ng")) return ["espeak-ng", "-v", lang.split("-")[0], "--", text];
  if (Bun.which("espeak")) return ["espeak", "-v", lang.split("-")[0], "--", text];
  return undefined;
}

/** Speaks in the background; resolves once the process started (not when it finished), with false when nothing can speak here. */
export async function speak(text: string, lang: string): Promise<boolean> {
  const argv = await speakArgv(text, lang);
  if (!argv) return false;
  Bun.spawn(argv, { stdio: ["ignore", "ignore", "ignore"] }).unref();
  return true;
}
