// The query grammar and the language table, pure: what `list` reads off
// the typed text before anything reaches a backend. `tr: hello` and
// `>de hello` name the target, `en>tr merhaba` both ends, a language name
// works where a code does (`german: hello`), and a prefix with nothing
// after it means "the selection, else the clipboard". A word that is not
// a language is text (`todo: buy milk` translates whole).

/** Google's codes with their English names; DeepL's differ where `DEEPL` says. */
const LANGS: Record<string, string> = {
  af: "Afrikaans", sq: "Albanian", am: "Amharic", ar: "Arabic", hy: "Armenian", az: "Azerbaijani", eu: "Basque", be: "Belarusian", bn: "Bengali", bs: "Bosnian", bg: "Bulgarian", ca: "Catalan",
  ceb: "Cebuano", "zh-CN": "Chinese (Simplified)", "zh-TW": "Chinese (Traditional)", hr: "Croatian", cs: "Czech", da: "Danish", nl: "Dutch", en: "English", eo: "Esperanto", et: "Estonian",
  fi: "Finnish", fr: "French", gl: "Galician", ka: "Georgian", de: "German", el: "Greek", gu: "Gujarati", ht: "Haitian Creole", ha: "Hausa", he: "Hebrew", hi: "Hindi", hu: "Hungarian",
  is: "Icelandic", id: "Indonesian", ga: "Irish", it: "Italian", ja: "Japanese", jv: "Javanese", kn: "Kannada", kk: "Kazakh", km: "Khmer", ko: "Korean", ku: "Kurdish", ky: "Kyrgyz", lo: "Lao",
  la: "Latin", lv: "Latvian", lt: "Lithuanian", lb: "Luxembourgish", mk: "Macedonian", ms: "Malay", ml: "Malayalam", mt: "Maltese", mi: "Maori", mr: "Marathi", mn: "Mongolian", ne: "Nepali",
  no: "Norwegian", fa: "Persian", pl: "Polish", pt: "Portuguese", pa: "Punjabi", ro: "Romanian", ru: "Russian", sr: "Serbian", sk: "Slovak", sl: "Slovenian", so: "Somali", es: "Spanish",
  sw: "Swahili", sv: "Swedish", tl: "Filipino", tg: "Tajik", ta: "Tamil", te: "Telugu", th: "Thai", tr: "Turkish", uk: "Ukrainian", ur: "Urdu", uz: "Uzbek", vi: "Vietnamese", cy: "Welsh",
  yi: "Yiddish", yo: "Yoruba", zu: "Zulu",
};

/** Names and aliases people type, lower case, to the code. */
const BY_NAME: Record<string, string> = Object.fromEntries(Object.entries(LANGS).map(([c, n]) => [n.toLowerCase(), c]));
Object.assign(BY_NAME, { chinese: "zh-CN", zh: "zh-CN", mandarin: "zh-CN", taiwanese: "zh-TW", türkçe: "tr", turkce: "tr", deutsch: "de", français: "fr", francais: "fr", español: "es", espanol: "es", italiano: "it", português: "pt", portugues: "pt", nederlands: "nl", русский: "ru", 日本語: "ja", 한국어: "ko", auto: "auto", jp: "ja", kr: "ko", ua: "uk", gr: "el", ir: "fa", cn: "zh-CN", tw: "zh-TW" });

/** A code or a name to Google's code, `auto` kept; undefined for a word that is no language. */
export function langOf(word: string): string | undefined {
  const w = word.trim().toLowerCase();
  if (!w) return;
  if (w === "auto") return "auto";
  const exact = Object.keys(LANGS).find((c) => c.toLowerCase() === w);
  return exact ?? BY_NAME[w];
}

/** The English name of a code, the code itself when unknown. */
export const nameOf = (code: string): string => (code === "auto" ? "Auto" : LANGS[code] ?? LANGS[Object.keys(LANGS).find((c) => c.toLowerCase() === code.toLowerCase()) ?? ""] ?? code);

/** DeepL's spelling of a target: upper case, the regional forms it insists on. */
export function deeplTarget(code: string): string {
  const t: Record<string, string> = { en: "EN-US", pt: "PT-PT", "zh-CN": "ZH-HANS", "zh-TW": "ZH-HANT", no: "NB" };
  return t[code] ?? code.toUpperCase();
}
/** DeepL's spelling of a source: the plain two letters, or nothing for auto. */
export const deeplSource = (code: string): string | undefined => (code === "auto" ? undefined : code.split("-")[0].toUpperCase());

/** Google's `zh-CN` back from DeepL's `ZH`, `EN` from `EN-US`; otherwise lower case. */
export function fromDeepl(code: string): string {
  const c = code.toUpperCase();
  if (c.startsWith("ZH")) return c === "ZH-HANT" ? "zh-TW" : "zh-CN";
  if (c === "NB") return "no";
  return c.split("-")[0].toLowerCase();
}

/** What the query said: the ends (`auto` for an unsaid source, undefined for an unsaid target) and the text after the prefix (empty: use the selection or the clipboard). */
type Parsed = { from: string; to?: string; text: string; /** A prefix was typed (`tr:`, `>de`, `en>tr`). */ prefixed: boolean };

const WORD = "[\\p{L}][\\p{L}-]{0,24}";
const PAIR = new RegExp(`^\\s*(${WORD})\\s*>\\s*(${WORD})(?:\\s+|$)([\\s\\S]*)$`, "u");
// `>de`, never `> de`: the shell palette answers `> ` (a space) at the root, so the two prefixes stay apart.
const TO = new RegExp(`^\\s*>(${WORD})(?:\\s+|$)([\\s\\S]*)$`, "u");
const COLON = new RegExp(`^\\s*(${WORD})\\s*:\\s*([\\s\\S]*)$`, "u");

/**
 * `en>tr merhaba` (both ends), `>de hello` or `tr: hello` (the target), else
 * plain text. A prefix only counts when its words are languages, so a
 * colon in ordinary text (`note: call mum`) is translated as it is.
 */
export function parse(query: string): Parsed {
  let m = PAIR.exec(query);
  if (m) {
    const from = langOf(m[1]), to = langOf(m[2]);
    if (from && to && to !== "auto") return { from, to, text: m[3].trim(), prefixed: true };
  }
  m = TO.exec(query);
  if (m) {
    const to = langOf(m[1]);
    if (to && to !== "auto") return { from: "auto", to, text: m[2].trim(), prefixed: true };
  }
  m = COLON.exec(query);
  if (m) {
    const to = langOf(m[1]);
    if (to && to !== "auto") return { from: "auto", to, text: m[2].trim(), prefixed: true };
  }
  return { from: "auto", text: query.trim(), prefixed: false };
}

/**
 * Whether a root query is the palette's (`match`): a language prefix with
 * text after it. A bare prefix is left to the palette itself, where it
 * reads the selection; at the root it would read it on every keystroke.
 */
export const matches = (query: string): boolean => {
  const p = parse(query);
  return p.prefixed && p.text.length > 0;
};

/** The language the system speaks, as a Google code (`en` from `en-US`, `zh-CN` kept), `en` when nothing says. */
export function systemLanguage(locale = Intl.DateTimeFormat().resolvedOptions().locale): string {
  const [lang, region] = locale.split(/[-_]/);
  if (lang === "zh") return region?.toUpperCase() === "TW" || region?.toUpperCase() === "HK" ? "zh-TW" : "zh-CN";
  return LANGS[lang] ? lang : "en";
}

/**
 * Where a text lands when it is already in the target: the other end of
 * the user's pair when the `from` setting names one, else English, else
 * (for an English text) the system language, else the target as typed.
 */
export function otherEnd(detected: string, to: string, from: string, system = systemLanguage()): string {
  if (detected !== to) return to;
  if (from !== "auto" && from !== detected) return from;
  if (detected !== "en") return "en";
  return system !== "en" ? system : to;
}
