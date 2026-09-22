// The conversions, pure: deasciify (ASCII-typed Turkish back to its
// letters, Deniz Yüret's pattern table from Emacs turkish-mode in Mustafa
// Emre Acer's JavaScript port, the `turkish-deasciifier` package), asciify
// (the reverse, a table), and the Turkish cases, where `i` and `ı` are two
// letters (`i` → `İ`, `ı` → `I`, and back): JavaScript's `tr` locale does
// those. The deasciifier's 180 KB table is imported on first use.

export type Conversion = "deasciify" | "asciify" | "upper" | "lower" | "title";
/** In the order the rows list them. */
export const CONVERSIONS: Conversion[] = ["deasciify", "asciify", "upper", "lower", "title"];
export const TITLES: Record<Conversion, string> = { deasciify: "Deasciified", asciify: "Asciified", upper: "UPPERCASE", lower: "lowercase", title: "Title Case" };
/** What each does, one line, for a subtitle or a link's description. */
export const ABOUT: Record<Conversion, string> = {
  deasciify: "Turkish letters restored: Turkce → Türkçe",
  asciify: "Turkish letters as ASCII: Türkçe → Turkce",
  upper: "Turkish uppercase: i → İ, ı → I",
  lower: "Turkish lowercase: I → ı, İ → i",
  title: "Each word capitalised the Turkish way",
};

const ASCII: Record<string, string> = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", Ç: "C", Ğ: "G", İ: "I", Ö: "O", Ş: "S", Ü: "U" };

/** The Turkish letters as their ASCII stand-ins; everything else as it is. */
export const asciify = (s: string): string => s.replace(/[çğıöşüÇĞİÖŞÜ]/g, (c) => ASCII[c]);
export const upper = (s: string): string => s.toLocaleUpperCase("tr");
export const lower = (s: string): string => s.toLocaleLowerCase("tr");
/** Every word's first letter up, the rest down, both the Turkish way; a suffix after an apostrophe (İstanbul'da) stays down, a quote or a bracket before a word is left alone. */
export const title = (s: string): string => lower(s).replace(/(^|[^\p{L}\p{M}'’])(\p{L})/gu, (_, before: string, first: string) => before + upper(first));

let deasciifier: Promise<{ deasciify(text: string): string }> | undefined;
/** The pattern-table deasciifier, made once (`deasciifier.d.ts` types the package). */
export const deasciify = async (s: string): Promise<string> => {
  deasciifier ??= import("turkish-deasciifier").then((m) => new m.default());
  return s ? (await deasciifier).deasciify(s) : s;
};

/** One conversion by name. */
export async function convert(kind: Conversion, text: string): Promise<string> {
  switch (kind) {
    case "deasciify": return deasciify(text);
    case "asciify": return asciify(text);
    case "upper": return upper(text);
    case "lower": return lower(text);
    case "title": return title(text);
  }
}

/** How many characters a conversion touched: the positions that differ (the conversions keep the length; a length change counts whole). */
export function changed(a: string, b: string): number {
  if (a.length !== b.length) return Math.max(a.length, b.length);
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
}
