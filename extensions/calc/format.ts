// Number formatting for the calculator: the `precision` setting as
// significant digits, grouping and the decimal separator from the `locale`
// setting through `Intl.NumberFormat`. Every result the palette shows goes
// through `num`; `raw` is the same rounding without grouping, what "Copy
// without formatting" gives.

/** Locale-formatted; integers are never rounded, so `precision` bounds the fraction of a number >= 1 and the significant digits of one below. */
export function num(x: number, precision: number, locale: string, grouping = true): string {
  if (!Number.isFinite(x)) return String(x);
  if (x === 0) return "0";
  const abs = Math.abs(x);
  if (abs >= 1e15 || abs < 1e-6) return exp(x, precision);
  const intDigits = abs < 1 ? 0 : Math.floor(Math.log10(abs)) + 1;
  const opts: Intl.NumberFormatOptions = { useGrouping: grouping };
  if (intDigits === 0) opts.maximumSignificantDigits = precision;
  else opts.maximumFractionDigits = Math.min(20, Math.max(0, precision - intDigits));
  return new Intl.NumberFormat(locale, opts).format(x);
}

/** No grouping, an ASCII decimal point: what a program would read back. */
export const raw = (x: number, precision: number) => num(x, precision, "en", false);

/** `1.2676506e+30`: exponential with `precision` significant digits, trailing zeros dropped. */
function exp(x: number, precision: number): string {
  const [mant, e] = x.toExponential(Math.max(0, precision - 1)).split("e");
  return `${mant.includes(".") ? mant.replace(/\.?0+$/, "") : mant}e${e}`;
}

/** The locale's decimal separator (`.` or `,`). */
export const decimalSeparator = (locale: string) => new Intl.NumberFormat(locale).formatToParts(1.1).find((p) => p.type === "decimal")?.value ?? ".";

/**
 * Number literals as the locale writes them turned into what the parsers
 * read: `1,234.56` loses its grouping under a `.` locale; under a `,` locale
 * `1.234,56` and `12,5` become `1234.56` and `12.5`.
 */
export function normalizeNumbers(q: string, locale: string): string {
  if (decimalSeparator(locale) === ",")
    return q.replace(/\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+,\d+/g, (s) => s.replace(/\./g, "").replace(",", "."));
  return q.replace(/\d{1,3}(?:,\d{3})+(?:\.\d+)?/g, (s) => s.replace(/,/g, ""));
}

/** `1k`, `2.5m`, `3b` as an amount: thousand, million, billion. */
export const shorthand = (s: string) => s.replace(/(\d)\s*([kmb])\b/gi, (_, d: string, u: string) => `${d}e${{ k: 3, m: 6, b: 9 }[u.toLowerCase()]}`);
