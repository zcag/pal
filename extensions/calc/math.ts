// Arithmetic and units: mathjs evaluates the query after a pass that turns
// calculator idioms into its syntax (`sqrt 2`, `15% of 240`, `240 + 15%`,
// `72 f to c`, `12 gb to mb`, `100 kph to mph`). Base conversions
// (`255 to hex`) are answered here without mathjs.

import type { MathJsInstance } from "mathjs";

// mathjs costs ~80 ms and ~65 MB to create (`create(all)` builds every
// function and unit table), so it is made on the first evaluation, not at
// load: most sessions never type a sum, and the root's `match` keeps
// ordinary queries away from here. A failed import surfaces from that
// evaluation.
let math: Promise<MathJsInstance> | undefined;
const mathjs = () => (math ??= import("mathjs").then(({ create, all }) => create(all)));

export type MathResult =
  | { kind: "number"; value: number }
  | { kind: "unit"; value: number; unit: string }
  | { kind: "text"; text: string };

/** Lower-cased spellings mathjs lacks (or reads as something else: `kb` is a kilobit there) to its unit names. */
const UNITS: Record<string, string> = {
  kb: "kB", mb: "MB", gb: "GB", tb: "TB", pb: "PB", kib: "KiB", mib: "MiB", gib: "GiB", tib: "TiB",
  kbps: "kb/s", mbps: "Mb/s", gbps: "Gb/s",
  kph: "km/h", kmh: "km/h", kmph: "km/h", mph: "mi/h",
  kw: "kW", mw: "MW", gw: "GW", kwh: "kWh", mwh: "MWh", wh: "Wh",
  mo: "month", mos: "months", yr: "year", yrs: "years", hr: "hour", hrs: "hours", wk: "week", wks: "weeks",
  ha: "hectare", sqm: "m2", sqkm: "km2",
  tsp: "teaspoon", tbsp: "tablespoon", floz: "floz", "fl oz": "floz",
  lbs: "lb", kgs: "kg", st: "stone",
  celsius: "degC", fahrenheit: "degF", kelvin: "K",
};
const TEMP: Record<string, string> = { f: "degF", c: "degC", k: "K", "°f": "degF", "°c": "degC", degf: "degF", degc: "degC", celsius: "degC", fahrenheit: "degF", kelvin: "K" };
const FUNCS = "sqrt|cbrt|sin|cos|tan|asin|acos|atan|sinh|cosh|tanh|log|ln|log10|log2|abs|exp|ceil|floor|round|sign";
const NUM = "-?\\d+(?:\\.\\d+)?(?:e-?\\d+)?";

/** What mathjs sees: the idioms above rewritten into its syntax. */
export function rewrite(q: string): string {
  let s = q
    .replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-").replace(/\*\*/g, "^").replace(/π/g, "pi").replace(/√\s*/g, "sqrt ")
    .replace(/\s+as\s+/gi, " to ").replace(/\s*(?:→|->)\s*/g, " to ")
    .replace(/(\d)\s+x\s+(\d)/gi, "$1*$2").replace(/([1-9])x(\d)/gi, "$1*$2")
    .replace(/(\d+(?:\.\d+)?)\s*(?:feet|foot|ft|')\s*(\d+(?:\.\d+)?)\s*(?:inches|inch|in|")/gi, "($1 ft + $2 in)")
    .replace(/\bsquare root of\s+/gi, "sqrt ").replace(/\bcube root of\s+/gi, "cbrt ")
    .replace(/\s+(?:to the )?power (?:of )?/gi, "^").replace(/\s+squared\b/gi, "^2").replace(/\s+cubed\b/gi, "^3")
    .replace(/\bmod\b(?!\s*\()/gi, "%")
    .replace(new RegExp(`\\b(${FUNCS})\\s+(?:of\\s+)?(${NUM}|pi|e)\\b(?!\\s*\\()`, "gi"), "$1($2)");
  // Percentages: `15% of 240`, `20% off 80`, `240 + 15%` (276, the calculator meaning), a bare `15%`.
  s = s
    .replace(/(\d+(?:\.\d+)?)\s*%\s*of\s+/gi, "($1/100)*")
    .replace(/(\d+(?:\.\d+)?)\s*%\s*off\s+/gi, "(1-$1/100)*")
    .replace(/^(.*?\S)\s*([+-])\s*(\d+(?:\.\d+)?)%\s*$/, "(($1)*(1$2$3/100))")
    .replace(/(\d+(?:\.\d+)?)%(?!\s*\d)/g, "($1/100)");
  // Temperature letters mean degrees only across a `to`: `72 f to c`, `300 k to c`.
  s = s.replace(/^(.*?\d)\s*(°?[fck]|deg[fc]|celsius|fahrenheit|kelvin)\s+to\s+(°?[fck]|deg[fc]|celsius|fahrenheit|kelvin)\s*$/i, (_, a: string, u1: string, u2: string) => `${a} ${TEMP[u1.toLowerCase()]} to ${TEMP[u2.toLowerCase()]}`);
  s = s.replace(/°\s*([cf])\b/gi, (_, u: string) => `deg${u.toUpperCase()}`);
  return s.replace(/\bfl\s+oz\b/gi, "floz").replace(/\b[a-z]+\b/gi, (w) => UNITS[w.toLowerCase()] ?? w);
}

/** `mi / h` back to how people write it. */
const unitName = (u: string) => u.replace(/\s*\/\s*/g, "/").replace(/^mi\/h$/, "mph").replace(/^degC$/, "°C").replace(/^degF$/, "°F");

export async function evaluate(q: string): Promise<MathResult | undefined> {
  const m = await mathjs();
  let r: any;
  try {
    r = m.evaluate(rewrite(q));
  } catch {
    return;
  }
  if (r === undefined || r === null || typeof r === "function") return;
  if (typeof r === "number") return Number.isFinite(r) ? { kind: "number", value: r } : undefined;
  if (typeof r === "bigint") return { kind: "number", value: Number(r) };
  if (typeof r === "string") return { kind: "text", text: r };
  if (typeof r === "boolean") return { kind: "text", text: String(r) };
  if (m.isUnit(r)) {
    if (r.value === null) return; // `km` alone: a unit, not a quantity
    const unit = r.formatUnits();
    try {
      const value = r.toNumber(unit);
      return { kind: "unit", value, unit: unitName(unit) };
    } catch {
      return { kind: "text", text: m.format(r, { precision: 14 }) };
    }
  }
  if (m.isBigNumber(r) || m.isFraction(r)) return { kind: "number", value: r.valueOf() as number };
  try {
    return { kind: "text", text: m.format(r, { precision: 14 }) };
  } catch {
    return;
  }
}

/** `p/q` for a non-integer the continued fraction lands on within 1e-9, with a small denominator; else nothing. */
export async function fraction(x: number): Promise<string | undefined> {
  if (!Number.isFinite(x) || Number.isInteger(x)) return;
  const m = await mathjs();
  try {
    const f = m.fraction(x);
    if (Number(f.d) > 10000 || Math.abs(f.valueOf() - x) > 1e-9 * Math.abs(x)) return;
    return f.toFraction();
  } catch {
    return;
  }
}

const BASES: Record<string, number> = { hex: 16, hexadecimal: 16, bin: 2, binary: 2, oct: 8, octal: 8, dec: 10, decimal: 10 };
const PREFIX: Record<number, string> = { 16: "0x", 2: "0b", 8: "0o", 10: "" };

/** `255 to hex`: the expression before the base word, evaluated, shown in that base (integers only). */
export async function toBase(q: string): Promise<{ text: string; value: number; base: number } | undefined> {
  const m = q.match(/^(.+?)\s+(?:to|in|as)\s+(hex|hexadecimal|bin|binary|oct|octal|dec|decimal)$/i);
  if (!m) return;
  const r = await evaluate(m[1]);
  if (r?.kind !== "number" || !Number.isInteger(r.value) || Math.abs(r.value) > Number.MAX_SAFE_INTEGER) return;
  const base = BASES[m[2].toLowerCase()];
  return { text: inBase(r.value, base), value: r.value, base };
}

export const inBase = (n: number, base: number) => (n < 0 ? "-" : "") + PREFIX[base] + Math.abs(n).toString(base);
