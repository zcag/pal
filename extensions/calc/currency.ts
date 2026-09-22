// Currency conversion: `12 usd to try`, `€12 to $`, `12 dollars in lira`,
// a bare `100 try` (to the home currency). Rates are the ECB reference
// rates through frankfurter.dev (no key, ~30 currencies, one fix per
// working day), fetched on the first currency query, kept in `storage`
// with their date and refreshed after a day; without a network the last
// cached set answers, dated. No crypto: the source has none.
import { storage } from "@zcag/pal";
import { shorthand } from "./format.ts";

export const SOURCE = { name: "European Central Bank via frankfurter.dev", url: "https://www.frankfurter.dev" };
const URL = process.env.PAL_CALC_RATES_URL || "https://api.frankfurter.dev/v1/latest";
const OFFLINE = process.env.PAL_CALC_OFFLINE === "1";
const FRESH_MS = 24 * 3600 * 1000;

/** What frankfurter serves, base EUR, plus `fetched` (unix ms) for the refresh. */
export type Rates = { base: string; date: string; rates: Record<string, number>; fetched: number };

/** The ECB set; the parser knows these before any rates arrive. */
export const NAMES: Record<string, string> = {
  AUD: "Australian Dollar", BRL: "Brazilian Real", CAD: "Canadian Dollar", CHF: "Swiss Franc", CNY: "Chinese Yuan", CZK: "Czech Koruna",
  DKK: "Danish Krone", EUR: "Euro", GBP: "British Pound", HKD: "Hong Kong Dollar", HUF: "Hungarian Forint", IDR: "Indonesian Rupiah",
  ILS: "Israeli Shekel", INR: "Indian Rupee", ISK: "Icelandic Króna", JPY: "Japanese Yen", KRW: "South Korean Won", MXN: "Mexican Peso",
  MYR: "Malaysian Ringgit", NOK: "Norwegian Krone", NZD: "New Zealand Dollar", PHP: "Philippine Peso", PLN: "Polish Złoty", RON: "Romanian Leu",
  SEK: "Swedish Krona", SGD: "Singapore Dollar", THB: "Thai Baht", TRY: "Turkish Lira", USD: "US Dollar", ZAR: "South African Rand",
};

/** Symbols, longest first so `HK$` wins over `$`. */
const SYMBOLS: [string, string][] = [
  ["HK$", "HKD"], ["NZ$", "NZD"], ["CA$", "CAD"], ["AU$", "AUD"], ["US$", "USD"], ["R$", "BRL"], ["C$", "CAD"], ["A$", "AUD"], ["S$", "SGD"],
  ["$", "USD"], ["€", "EUR"], ["£", "GBP"], ["₺", "TRY"], ["¥", "JPY"], ["₹", "INR"], ["₩", "KRW"], ["₪", "ILS"], ["₱", "PHP"], ["฿", "THB"], ["zł", "PLN"],
];
/** Words, lower-case: names, plurals, slang. */
const WORDS: Record<string, string> = {
  dollar: "USD", dollars: "USD", buck: "USD", bucks: "USD", usd: "USD",
  euro: "EUR", euros: "EUR", eur: "EUR",
  pound: "GBP", pounds: "GBP", quid: "GBP", sterling: "GBP", gbp: "GBP",
  lira: "TRY", liras: "TRY", tl: "TRY", try: "TRY",
  yen: "JPY", jpy: "JPY", yuan: "CNY", rmb: "CNY", renminbi: "CNY", cny: "CNY",
  franc: "CHF", francs: "CHF", chf: "CHF", rupee: "INR", rupees: "INR", inr: "INR", won: "KRW", krw: "KRW",
  shekel: "ILS", shekels: "ILS", ils: "ILS", peso: "MXN", pesos: "MXN", mxn: "MXN", real: "BRL", reais: "BRL", brl: "BRL",
  rand: "ZAR", zar: "ZAR", krona: "SEK", kronor: "SEK", sek: "SEK", krone: "NOK", kroner: "NOK", nok: "NOK", dkk: "DKK",
  zloty: "PLN", pln: "PLN", forint: "HUF", huf: "HUF", koruna: "CZK", czk: "CZK", ringgit: "MYR", myr: "MYR",
  baht: "THB", thb: "THB", rupiah: "IDR", idr: "IDR", leu: "RON", lei: "RON", ron: "RON",
  aud: "AUD", cad: "CAD", hkd: "HKD", isk: "ISK", nzd: "NZD", php: "PHP", sgd: "SGD",
};

const esc = (s: string) => s.replace(/[$^.*+?()[\]{}|\\]/g, "\\$&");
const SYM = SYMBOLS.map(([s]) => esc(s)).join("|");
const WORD = Object.keys(WORDS).sort((a, b) => b.length - a.length).join("|");
/** One currency token: a symbol, or a word on its own. */
const CUR = `(?:${SYM}|\\b(?:${WORD})\\b)`;
const HEAD = new RegExp(`^(${CUR})\\s*`, "i");
const TAIL = new RegExp(`\\s*(${CUR})$`, "i");
const ONLY = new RegExp(`^${CUR}$`, "i");
const SPLIT = /\s+(?:to|in|as|→|->)\s+/i;

export const code = (token: string): string => SYMBOLS.find(([s]) => s === token)?.[1] ?? WORDS[token.toLowerCase()];

/** Whether a word is a currency (a variable may not be named one). */
export const isCurrency = (word: string): boolean => !!WORDS[word.toLowerCase()];

const PREFIXED = new RegExp(`(${SYM})\\s*(\\d[\\d.]*)`, "g");
const TOKEN = new RegExp(CUR, "gi");
const ANY = new RegExp(CUR, "i");

/** Whether an expression names a currency anywhere in it. */
export const hasCurrency = (expr: string): boolean => ANY.test(expr);

/**
 * An expression with amounts in currencies (`(54 usd) * 12 - 1000 try`)
 * as one mathjs sum: each currency becomes `(rate MONEY)` in the first
 * one's terms, so the result is money in `cur`, or a plain number when the
 * currencies cancel (`rent / salary`). Undefined when it names none, or
 * one without a rate.
 */
export function carry(expr: string, r: Rates, unit: string): { expr: string; cur: string } | undefined {
  const s = expr.replace(PREFIXED, (_, sym: string, n: string) => `${n} ${code(sym)}`);
  const first = s.match(TOKEN)?.[0];
  if (!first) return;
  const cur = code(first);
  let missing = false;
  const out = s.replace(TOKEN, (t) => {
    const x = rate(r, code(t), cur);
    if (x === undefined) missing = true;
    return ` (${x} ${unit})`;
  });
  return missing ? undefined : { expr: out, cur };
}

/** The pieces of a currency query: the amount expression (`1` when absent), the source, the target when given. Undefined when the query is not one. */
type CurrencyQuery = { amount: string; from: string; to?: string };

export function parse(q: string): CurrencyQuery | undefined {
  const full = parseFull(q);
  if (full) return full;
  // `12 usd to tr` while typing: the target is a prefix of a currency, answer for the source alone meanwhile.
  const partial = q.match(/^(.*?\S)\s+(?:t|to|i|in|a|as)(?:\s+([a-z]*))?$/i);
  if (partial && (!partial[2] || isPrefix(partial[2]))) return parseFull(partial[1]);
}

const isPrefix = (p: string) => { const l = p.toLowerCase(); return Object.keys(WORDS).some((w) => w.startsWith(l)); };

function parseFull(q: string): CurrencyQuery | undefined {
  const parts = q.split(SPLIT);
  if (parts.length > 2) return;
  const [left, right] = parts;
  let to: string | undefined;
  if (right !== undefined) {
    if (!ONLY.test(right.trim())) return;
    to = code(right.trim());
  }
  let rest = left.trim();
  let from: string | undefined;
  const head = rest.match(HEAD);
  if (head) { from = code(head[1]); rest = rest.slice(head[0].length); }
  const tail = rest.match(TAIL);
  if (tail) {
    const c = code(tail[1]);
    if (from && !rest.slice(0, tail.index).trim() && !to) { to = c; } // `usd try`: a rate
    else if (from) return;
    else from = c;
    rest = rest.slice(0, tail.index);
  }
  if (!from || (from === to && !rest.trim() && right === undefined)) return;
  return { amount: shorthand(rest.trim()) || "1", from, to };
}

let rates: Rates | undefined;
let read: Promise<void> | undefined;
let fetching: Promise<void> | undefined;
let failedAt = 0;

const fresh = (r: Rates) => Date.now() - r.fetched < FRESH_MS;

async function fetchRates(): Promise<Rates> {
  const res = await fetch(URL, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`rates: HTTP ${res.status}`);
  const j = (await res.json()) as { base: string; date: string; rates: Record<string, number> };
  if (!j.rates || typeof j.rates !== "object") throw new Error("rates: unexpected shape");
  return { base: j.base, date: j.date, rates: { ...j.rates, [j.base]: 1 }, fetched: Date.now() };
}

/**
 * The rates to answer with now: the cached set (read once from storage),
 * fresh or not. A missing or day-old set starts one fetch in the background
 * (never awaited here: the row it feeds lands on the next keystroke) unless
 * `PAL_CALC_OFFLINE=1`.
 */
export async function ensureRates(): Promise<{ rates?: Rates; fetching: boolean }> {
  read ??= storage.get<Rates>("rates").then((r) => { if (r && r.rates) rates = r; }).catch(() => {});
  await read;
  if (!OFFLINE && !(rates && fresh(rates)) && !fetching && Date.now() - failedAt > 60_000) {
    fetching = fetchRates()
      .then((r) => { rates = r; return storage.set("rates", r); })
      .catch(() => { failedAt = Date.now(); })
      .then(() => { fetching = undefined; });
  }
  return { rates, fetching: fetching !== undefined };
}

/** `rates[to] / rates[from]`, both relative to the base; undefined for a currency the set lacks. */
export function rate(r: Rates, from: string, to: string): number | undefined {
  const a = r.rates[from], b = r.rates[to];
  return a && b ? b / a : undefined;
}

/** `15,842.40 TRY`: the number in the currency's own decimals, the code after it; a value the decimals would zero out keeps 4 significant digits. */
export function money(x: number, cur: string, locale: string, grouping = true): string {
  const digits = new Intl.NumberFormat("en", { style: "currency", currency: cur }).resolvedOptions().maximumFractionDigits ?? 2;
  const small = x !== 0 && Math.abs(x) < 10 ** -digits / 2;
  const opts: Intl.NumberFormatOptions = small ? { maximumSignificantDigits: 4 } : { minimumFractionDigits: digits, maximumFractionDigits: digits };
  return `${new Intl.NumberFormat(locale, { ...opts, useGrouping: grouping }).format(x)} ${cur}`;
}

/** Where the person is, by time zone, else the locale's region; USD when neither says. */
export function homeCurrency(): string {
  const { timeZone, locale } = Intl.DateTimeFormat().resolvedOptions();
  const byZone = ZONES[timeZone] ?? ZONES[timeZone.split("/")[0]];
  if (byZone) return byZone;
  try {
    const region = new Intl.Locale(locale).maximize().region;
    return (region && REGIONS[region]) || "USD";
  } catch {
    return "USD";
  }
}

const REGIONS: Record<string, string> = {
  TR: "TRY", US: "USD", GB: "GBP", JP: "JPY", CN: "CNY", CH: "CHF", IN: "INR", KR: "KRW", IL: "ILS", MX: "MXN", BR: "BRL", ZA: "ZAR", SE: "SEK", NO: "NOK",
  DK: "DKK", PL: "PLN", HU: "HUF", CZ: "CZK", MY: "MYR", TH: "THB", ID: "IDR", RO: "RON", AU: "AUD", CA: "CAD", HK: "HKD", IS: "ISK", NZ: "NZD", PH: "PHP", SG: "SGD",
  DE: "EUR", FR: "EUR", ES: "EUR", IT: "EUR", NL: "EUR", BE: "EUR", AT: "EUR", PT: "EUR", IE: "EUR", FI: "EUR", GR: "EUR", SK: "EUR", SI: "EUR", EE: "EUR", LV: "EUR", LT: "EUR", LU: "EUR", MT: "EUR", CY: "EUR", HR: "EUR",
};
const ZONES: Record<string, string> = {
  "Europe/Istanbul": "TRY", "Europe/London": "GBP", "Europe/Zurich": "CHF", "Europe/Stockholm": "SEK", "Europe/Oslo": "NOK", "Europe/Copenhagen": "DKK",
  "Europe/Warsaw": "PLN", "Europe/Budapest": "HUF", "Europe/Prague": "CZK", "Europe/Bucharest": "RON", "Atlantic/Reykjavik": "ISK", "Europe": "EUR",
  "Asia/Tokyo": "JPY", "Asia/Shanghai": "CNY", "Asia/Hong_Kong": "HKD", "Asia/Singapore": "SGD", "Asia/Seoul": "KRW", "Asia/Kolkata": "INR", "Asia/Calcutta": "INR",
  "Asia/Jerusalem": "ILS", "Asia/Tel_Aviv": "ILS", "Asia/Bangkok": "THB", "Asia/Jakarta": "IDR", "Asia/Kuala_Lumpur": "MYR", "Asia/Manila": "PHP",
  "America/Toronto": "CAD", "America/Vancouver": "CAD", "America/Edmonton": "CAD", "America/Winnipeg": "CAD", "America/Halifax": "CAD", "America/Mexico_City": "MXN",
  "America/Sao_Paulo": "BRL", "America": "USD", "Pacific/Honolulu": "USD", "Pacific/Auckland": "NZD", "Australia": "AUD", "Africa/Johannesburg": "ZAR",
};
