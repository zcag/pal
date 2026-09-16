// Generates data.json: the curated character table the palette lists.
// Run by hand (`bun run extensions/unicode/build.ts`) and the output is
// committed, so the extension has no fetch at runtime. Names come from
// the UCD's UnicodeData.txt, HTML entity names from the WHATWG table; the
// sections, LaTeX names and the plain-word keywords are the tables below.
// The curated ranges, not the whole UCD: ~1700 characters one would paste.
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const UCD = "https://www.unicode.org/Public/UCD/latest/ucd/UnicodeData.txt";
const ENTITIES = "https://html.spec.whatwg.org/entities.json";
const OUT = join(import.meta.dir, "data.json");

/** One code point or an inclusive range. */
type Span = number | [number, number];
/** Sections in the order the palette lists them; a code point lands in the first section that names it. */
const SECTIONS: { name: string; spans: Span[]; keywords?: string[] }[] = [
  { name: "Keyboard", spans: [0x2318, 0x2325, 0x2387, 0x21e7, 0x2303, 0x238b, 0x23ce, 0x21a9, 0x232b, 0x2326, 0x21e5, 0x21e4, 0x21de, 0x21df, 0x2196, 0x2198, 0x21ea, 0x2423, 0x23cf, 0x23fb, 0x23fc, 0x23fd, 0x2b58, 0x2324, 0x2380, 0x2384, 0x2388, 0x23ed, 0x23ee, 0x23ef, 0x23f8, 0x23f9, 0x23fa, 0x25b6, 0x2328, 0x1f5b1, 0x1f5b2, 0x2610, 0x2611, 0x2612, 0x2713, 0x2714, 0x2717, 0x2718, [0x2400, 0x2426]] },
  { name: "Arrows", spans: [[0x2190, 0x21ff], [0x27f0, 0x27ff], [0x2b05, 0x2b0d], [0x2b60, 0x2b69]] },
  { name: "Math", spans: [0x00d7, 0x00f7, 0x00b1, 0x00ac, 0x00b5, [0x2200, 0x22ff], [0x2a00, 0x2a0c], 0x2a7d, 0x2a7e, [0x27e8, 0x27ef], 0x221e] },
  { name: "Greek", spans: [[0x0391, 0x03a1], [0x03a3, 0x03a9], [0x03b1, 0x03c9], 0x03d5, 0x03d6, 0x03f5] },
  { name: "Currency", spans: [0x0024, 0x00a2, 0x00a3, 0x00a4, 0x00a5, [0x20a0, 0x20c0]] },
  { name: "Quotes and dashes", spans: [[0x2010, 0x2015], [0x2018, 0x201f], 0x2039, 0x203a, 0x00ab, 0x00bb, 0x2032, 0x2033, 0x2034, 0x2035, 0x2036, 0x301d, 0x301e, 0x2212, 0x2043, 0x2e3a, 0x2e3b] },
  { name: "Punctuation", spans: [0x00a1, 0x00bf, 0x00a7, 0x00b6, 0x00b7, 0x2016, 0x2017, [0x2020, 0x2027], [0x2030, 0x2031], [0x2037, 0x2038], [0x203b, 0x2042], [0x2044, 0x205e], 0x00a8, 0x00af, 0x00b4, 0x00b8, 0x02c6, 0x02dc] },
  { name: "Spaces", spans: [0x00a0, [0x2000, 0x200d], 0x202f, 0x205f, 0x2060, 0x3000, 0xfeff, 0x00ad, 0x180e, 0x200e, 0x200f, 0x2028, 0x2029] },
  { name: "Superscripts and subscripts", spans: [0x00b9, 0x00b2, 0x00b3, [0x2070, 0x2071], [0x2074, 0x208e], [0x2090, 0x209c]] },
  { name: "Fractions and numerals", spans: [0x00bc, 0x00bd, 0x00be, [0x2150, 0x215f], 0x2189, [0x2160, 0x217f], 0x2116, 0x2117] },
  { name: "Letters", spans: [[0x00c0, 0x00d6], [0x00d8, 0x00f6], [0x00f8, 0x00ff], 0x0100, 0x0101, 0x0102, 0x0103, 0x0104, 0x0105, 0x0106, 0x0107, 0x010c, 0x010d, 0x010e, 0x010f, 0x0110, 0x0111, 0x0112, 0x0113, 0x0118, 0x0119, 0x011a, 0x011b, 0x011e, 0x011f, 0x0130, 0x0131, 0x0141, 0x0142, 0x0143, 0x0144, 0x0147, 0x0148, 0x0150, 0x0151, 0x0152, 0x0153, 0x0158, 0x0159, 0x015a, 0x015b, 0x015e, 0x015f, 0x0160, 0x0161, 0x0164, 0x0165, 0x016e, 0x016f, 0x0170, 0x0171, 0x0178, 0x0179, 0x017a, 0x017b, 0x017c, 0x017d, 0x017e, 0x1e9e, 0x00aa, 0x00ba] },
  { name: "Letterlike", spans: [[0x2100, 0x2115], [0x2118, 0x213f], 0x2140, 0x2141, 0x2142, 0x2143, 0x2144, 0x2145, 0x2146, 0x2147, 0x2148, 0x2149] },
  { name: "Symbols", spans: [0x00a9, 0x00ae, 0x00b0, 0x00a6, 0x00ac, 0x2122, 0x2117, 0x2120, 0x2121, [0x2600, 0x26ff]] },
  { name: "Dingbats", spans: [[0x2700, 0x27bf]] },
  { name: "Shapes", spans: [[0x25a0, 0x25ff], [0x2b1b, 0x2b2f], 0x2b50, 0x2b55] },
  { name: "Box drawing", spans: [[0x2500, 0x257f], [0x2580, 0x259f]] },
  { name: "Enclosed", spans: [[0x2460, 0x2473], [0x24b6, 0x24e9], 0x24ea, [0x2776, 0x2793]] },
];

/** LaTeX command per code point, where there is an obvious one. */
const LATEX: Record<number, string> = {
  0x00d7: "\\times", 0x00f7: "\\div", 0x00b1: "\\pm", 0x2213: "\\mp", 0x00ac: "\\neg", 0x2260: "\\neq", 0x2264: "\\leq", 0x2265: "\\geq", 0x2248: "\\approx", 0x2261: "\\equiv", 0x221e: "\\infty",
  0x2211: "\\sum", 0x220f: "\\prod", 0x222b: "\\int", 0x222c: "\\iint", 0x222e: "\\oint", 0x2202: "\\partial", 0x2207: "\\nabla", 0x2200: "\\forall", 0x2203: "\\exists", 0x2204: "\\nexists", 0x2208: "\\in", 0x2209: "\\notin", 0x220b: "\\ni",
  0x2282: "\\subset", 0x2283: "\\supset", 0x2286: "\\subseteq", 0x2287: "\\supseteq", 0x222a: "\\cup", 0x2229: "\\cap", 0x2205: "\\emptyset", 0x221a: "\\sqrt", 0x22c5: "\\cdot", 0x2218: "\\circ", 0x2022: "\\bullet", 0x2026: "\\ldots", 0x22ef: "\\cdots", 0x22ee: "\\vdots", 0x22f1: "\\ddots",
  0x2192: "\\rightarrow", 0x2190: "\\leftarrow", 0x2194: "\\leftrightarrow", 0x21d2: "\\Rightarrow", 0x21d0: "\\Leftarrow", 0x21d4: "\\Leftrightarrow", 0x2191: "\\uparrow", 0x2193: "\\downarrow", 0x2195: "\\updownarrow", 0x21a6: "\\mapsto", 0x21aa: "\\hookrightarrow", 0x27f6: "\\longrightarrow", 0x27f5: "\\longleftarrow", 0x27f9: "\\Longrightarrow",
  0x2220: "\\angle", 0x22a5: "\\perp", 0x2225: "\\parallel", 0x221d: "\\propto", 0x2234: "\\therefore", 0x2235: "\\because", 0x2135: "\\aleph", 0x210f: "\\hbar", 0x2113: "\\ell", 0x211c: "\\Re", 0x2111: "\\Im", 0x2118: "\\wp", 0x2020: "\\dagger", 0x2021: "\\ddagger", 0x00a7: "\\S", 0x00b6: "\\P", 0x00a9: "\\copyright", 0x00a3: "\\pounds", 0x20ac: "\\euro", 0x00b0: "\\degree", 0x2032: "\\prime",
  0x27e8: "\\langle", 0x27e9: "\\rangle", 0x2308: "\\lceil", 0x2309: "\\rceil", 0x230a: "\\lfloor", 0x230b: "\\rfloor", 0x2227: "\\wedge", 0x2228: "\\vee", 0x2295: "\\oplus", 0x2297: "\\otimes", 0x2296: "\\ominus", 0x2299: "\\odot", 0x22c6: "\\star", 0x22c4: "\\diamond", 0x25b3: "\\triangle", 0x22a4: "\\top", 0x22a2: "\\vdash", 0x22a8: "\\models",
  0x223c: "\\sim", 0x2243: "\\simeq", 0x2245: "\\cong", 0x226a: "\\ll", 0x226b: "\\gg", 0x227a: "\\prec", 0x227b: "\\succ", 0x2013: "\\textendash", 0x2014: "\\textemdash", 0x201c: "\\textquotedblleft", 0x201d: "\\textquotedblright", 0x2018: "\\textquoteleft", 0x2019: "\\textquoteright", 0x00ab: "\\guillemotleft", 0x00bb: "\\guillemotright", 0x2030: "\\permil", 0x2122: "\\texttrademark", 0x00ae: "\\textregistered", 0x00bf: "\\textquestiondown", 0x00a1: "\\textexclamdown",
  0x03b1: "\\alpha", 0x03b2: "\\beta", 0x03b3: "\\gamma", 0x03b4: "\\delta", 0x03b5: "\\varepsilon", 0x03f5: "\\epsilon", 0x03b6: "\\zeta", 0x03b7: "\\eta", 0x03b8: "\\theta", 0x03b9: "\\iota", 0x03ba: "\\kappa", 0x03bb: "\\lambda", 0x03bc: "\\mu", 0x03bd: "\\nu", 0x03be: "\\xi", 0x03c0: "\\pi", 0x03c1: "\\rho", 0x03c3: "\\sigma", 0x03c2: "\\varsigma", 0x03c4: "\\tau", 0x03c5: "\\upsilon", 0x03c6: "\\varphi", 0x03d5: "\\phi", 0x03c7: "\\chi", 0x03c8: "\\psi", 0x03c9: "\\omega",
  0x0393: "\\Gamma", 0x0394: "\\Delta", 0x0398: "\\Theta", 0x039b: "\\Lambda", 0x039e: "\\Xi", 0x03a0: "\\Pi", 0x03a3: "\\Sigma", 0x03a5: "\\Upsilon", 0x03a6: "\\Phi", 0x03a8: "\\Psi", 0x03a9: "\\Omega",
  0x00df: "\\ss", 0x00e6: "\\ae", 0x00c6: "\\AE", 0x0153: "\\oe", 0x0152: "\\OE", 0x00f8: "\\o", 0x00d8: "\\O", 0x00e5: "\\aa", 0x00c5: "\\AA", 0x0142: "\\l", 0x0141: "\\L", 0x0131: "\\i",
};

/** Plain words a name does not carry: what one types looking for the character. */
const WORDS: Record<number, string[]> = {
  0x2318: ["cmd", "command", "mac"], 0x2325: ["option", "alt", "mac"], 0x2387: ["option", "alt"], 0x21e7: ["shift"], 0x2303: ["control", "ctrl"], 0x238b: ["escape", "esc"], 0x23ce: ["return", "enter"], 0x21a9: ["return", "enter"], 0x232b: ["backspace", "delete"], 0x2326: ["delete", "forward delete"], 0x21e5: ["tab"], 0x21e4: ["shift tab", "backtab"], 0x21de: ["page up", "pgup"], 0x21df: ["page down", "pgdn"], 0x2196: ["home"], 0x2198: ["end"], 0x21ea: ["caps lock"], 0x2423: ["space", "spacebar"], 0x23cf: ["eject"], 0x23fb: ["power"], 0x23fc: ["power on off"], 0x23fd: ["power on"], 0x2b58: ["power", "off"], 0x2324: ["enter"], 0x2380: ["insert"], 0x2384: ["compose"], 0x2388: ["helm", "control"], 0x2328: ["keyboard"], 0x25b6: ["play", "triangle", "right"], 0x23f8: ["pause"], 0x23f9: ["stop"], 0x23fa: ["record"], 0x23ed: ["next", "skip"], 0x23ee: ["previous"], 0x23ef: ["play pause"],
  0x2610: ["checkbox", "empty", "todo"], 0x2611: ["checkbox", "checked", "done", "tick"], 0x2612: ["checkbox", "crossed"], 0x2713: ["check", "tick", "yes", "done"], 0x2714: ["check", "tick", "bold"], 0x2717: ["cross", "x", "no"], 0x2718: ["cross", "x", "bold"], 0x2705: ["check", "tick"], 0x274c: ["cross", "x"],
  0x2192: ["right", "arrow"], 0x2190: ["left", "arrow"], 0x2191: ["up", "arrow"], 0x2193: ["down", "arrow"], 0x21d2: ["implies", "double arrow"], 0x21d4: ["iff", "double arrow"], 0x2194: ["both ways"],
  0x00d7: ["times", "multiply", "x"], 0x00f7: ["divide", "obelus"], 0x2212: ["minus", "math"], 0x2248: ["almost", "roughly", "about"], 0x2260: ["not equal", "ne"], 0x2264: ["lte", "less or equal"], 0x2265: ["gte", "greater or equal"], 0x221e: ["forever", "endless"], 0x00b1: ["plus minus", "tolerance"], 0x221a: ["sqrt", "radical"], 0x2211: ["sum", "sigma", "total"], 0x220f: ["product", "pi"],
  0x00b0: ["temperature", "angle", "celsius", "fahrenheit"], 0x2103: ["celsius", "temperature"], 0x2109: ["fahrenheit", "temperature"], 0x00a9: ["copy", "legal", "rights"], 0x00ae: ["trademark", "brand", "legal"], 0x2122: ["tm", "brand"], 0x2116: ["number", "no"],
  0x2013: ["en dash", "range", "dash"], 0x2014: ["em dash", "dash"], 0x2010: ["hyphen"], 0x2011: ["nbhy", "non breaking hyphen"], 0x2026: ["ellipsis", "dots", "three dots"], 0x2018: ["single quote", "open", "curly"], 0x2019: ["single quote", "close", "curly", "apostrophe"], 0x201c: ["double quote", "open", "curly"], 0x201d: ["double quote", "close", "curly"], 0x201e: ["low quote", "german"], 0x201a: ["low quote", "german"], 0x00ab: ["guillemet", "french quote", "angle quote"], 0x00bb: ["guillemet", "french quote", "angle quote"], 0x2022: ["bullet", "list", "dot"], 0x00b7: ["middle dot", "interpunct"], 0x2030: ["permille", "per mille"],
  0x00a0: ["nbsp", "non breaking", "no break"], 0x200b: ["zwsp", "zero width"], 0x200c: ["zwnj"], 0x200d: ["zwj", "joiner"], 0x2060: ["word joiner", "wj"], 0x00ad: ["soft hyphen", "shy"], 0x2009: ["thin"], 0x200a: ["hair"], 0x2003: ["em"], 0x2002: ["en"], 0x202f: ["narrow nbsp", "nnbsp"], 0x3000: ["ideographic", "cjk", "full width"], 0xfeff: ["bom", "byte order mark", "zwnbsp"],
  0x20ac: ["eur", "euro"], 0x00a3: ["gbp", "pound", "sterling"], 0x00a5: ["jpy", "yen", "cny", "yuan"], 0x20ba: ["try", "lira", "turkish"], 0x20b9: ["inr", "rupee"], 0x20bd: ["rub", "ruble"], 0x20a9: ["krw", "won"], 0x20aa: ["ils", "shekel"], 0x20bf: ["btc", "bitcoin"], 0x0024: ["usd", "dollar"], 0x00a2: ["cent"], 0x20b4: ["uah", "hryvnia"], 0x20a8: ["rupee"], 0x20ab: ["vnd", "dong"], 0x20b1: ["php", "peso"], 0x20ae: ["mnt", "tugrik"], 0x20b8: ["kzt", "tenge"],
  0x00e7: ["turkish", "french", "cedilla"], 0x00c7: ["turkish", "french", "cedilla"], 0x011f: ["turkish", "yumusak g"], 0x011e: ["turkish", "yumusak g"], 0x0131: ["turkish", "dotless"], 0x0130: ["turkish", "dotted"], 0x015f: ["turkish"], 0x015e: ["turkish"], 0x00f6: ["turkish", "german", "umlaut"], 0x00d6: ["turkish", "german", "umlaut"], 0x00fc: ["turkish", "german", "umlaut"], 0x00dc: ["turkish", "german", "umlaut"], 0x00e4: ["german", "umlaut"], 0x00c4: ["german", "umlaut"], 0x00df: ["german", "eszett", "sharp s", "ss"], 0x1e9e: ["german", "eszett", "capital"],
  0x00e9: ["french", "accent aigu"], 0x00e8: ["french", "accent grave"], 0x00ea: ["french", "circumflex"], 0x00eb: ["french"], 0x00e0: ["french", "accent grave"], 0x00e2: ["french"], 0x00ee: ["french"], 0x00ef: ["french"], 0x00f4: ["french"], 0x00f9: ["french"], 0x00fb: ["french"], 0x00ff: ["french"], 0x0153: ["french", "ligature"], 0x0152: ["french", "ligature"], 0x00e6: ["ligature", "danish", "norwegian"], 0x00c6: ["ligature", "danish", "norwegian"], 0x00f1: ["spanish", "tilde"], 0x00d1: ["spanish", "tilde"], 0x00e5: ["swedish", "norwegian", "danish", "ring"], 0x00c5: ["swedish", "norwegian", "danish", "ring", "angstrom"], 0x00f8: ["norwegian", "danish", "slash"], 0x00d8: ["norwegian", "danish", "slash"],
  0x2665: ["love", "heart", "card"], 0x2764: ["love", "heart"], 0x2660: ["card", "spade"], 0x2663: ["card", "club"], 0x2666: ["card", "diamond"], 0x2605: ["star", "favorite", "rating"], 0x2606: ["star", "outline"], 0x2600: ["sun", "weather"], 0x2601: ["cloud", "weather"], 0x2602: ["umbrella", "rain"], 0x2614: ["umbrella", "rain"], 0x2603: ["snowman", "winter"], 0x2744: ["snowflake", "winter"], 0x26a0: ["warning", "caution"], 0x26a1: ["lightning", "bolt", "power"], 0x2620: ["skull", "danger", "death"], 0x2622: ["radioactive", "nuclear"], 0x2623: ["biohazard"], 0x267b: ["recycle"], 0x2695: ["medical", "medicine"], 0x269b: ["atom", "science"], 0x2699: ["gear", "settings", "cog"], 0x2692: ["hammer", "pick", "tools"], 0x2694: ["swords", "crossed"], 0x2696: ["scales", "balance", "law"], 0x2697: ["alembic", "chemistry"], 0x26a7: ["transgender"], 0x2640: ["female", "venus", "woman"], 0x2642: ["male", "mars", "man"], 0x26bd: ["football", "soccer"], 0x26be: ["baseball"], 0x2615: ["coffee", "tea", "cup"], 0x260e: ["phone", "telephone"], 0x2709: ["envelope", "mail", "email"], 0x270f: ["pencil", "edit"], 0x2702: ["scissors", "cut"], 0x2708: ["airplane", "plane", "flight"], 0x263a: ["smile", "happy"], 0x2639: ["frown", "sad"], 0x266a: ["music", "note"], 0x266b: ["music", "notes"], 0x266c: ["music", "notes"], 0x266d: ["music", "flat"], 0x266f: ["music", "sharp"], 0x266e: ["music", "natural"], 0x2669: ["music", "note"], 0x2654: ["chess", "king"], 0x2655: ["chess", "queen"], 0x2656: ["chess", "rook"], 0x2657: ["chess", "bishop"], 0x2658: ["chess", "knight"], 0x2659: ["chess", "pawn"], 0x26c4: ["snowman"], 0x2691: ["flag"], 0x2690: ["flag", "white"], 0x26d4: ["no entry", "forbidden"], 0x2716: ["multiply", "x", "times"], 0x2795: ["plus", "add"], 0x2796: ["minus"], 0x2797: ["divide"], 0x27a1: ["right arrow", "arrow"], 0x2b05: ["left arrow", "arrow"], 0x2b06: ["up arrow", "arrow"], 0x2b07: ["down arrow", "arrow"],
  0x25cf: ["dot", "bullet", "circle"], 0x25cb: ["circle", "ring", "outline"], 0x25a0: ["square", "block"], 0x25a1: ["square", "outline"], 0x25b2: ["triangle", "up"], 0x25bc: ["triangle", "down"], 0x25c0: ["triangle", "left"], 0x25c6: ["diamond"], 0x25c7: ["diamond", "outline"], 0x2588: ["full block", "solid"], 0x2591: ["light shade"], 0x2592: ["medium shade"], 0x2593: ["dark shade"], 0x2500: ["horizontal line", "rule"], 0x2502: ["vertical line", "pipe"], 0x250c: ["corner", "top left"], 0x2510: ["corner", "top right"], 0x2514: ["corner", "bottom left"], 0x2518: ["corner", "bottom right"], 0x253c: ["cross", "plus"],
  0x2460: ["one", "1"], 0x2461: ["two", "2"], 0x2462: ["three", "3"], 0x2463: ["four", "4"], 0x2464: ["five", "5"], 0x2465: ["six", "6"], 0x2466: ["seven", "7"], 0x2467: ["eight", "8"], 0x2468: ["nine", "9"], 0x2469: ["ten", "10"], 0x24ea: ["zero", "0"],
  0x00bd: ["half", "1/2"], 0x00bc: ["quarter", "1/4"], 0x00be: ["three quarters", "3/4"], 0x2153: ["third", "1/3"], 0x2154: ["two thirds", "2/3"], 0x00b2: ["squared", "power", "2"], 0x00b3: ["cubed", "power", "3"], 0x00b9: ["power", "1"], 0x2070: ["power", "0"],
  0x2113: ["liter", "litre", "script l"], 0x2126: ["ohm", "resistance"], 0x212b: ["angstrom"], 0x2115: ["naturals", "double struck", "blackboard"], 0x2124: ["integers", "double struck", "blackboard"], 0x211a: ["rationals", "double struck"], 0x211d: ["reals", "double struck"], 0x2102: ["complex", "double struck"], 0x2119: ["primes", "double struck", "probability"], 0x2107: ["euler"], 0x212e: ["estimated", "e mark", "packaging"], 0x2120: ["service mark"], 0x2121: ["telephone"], 0x2139: ["info", "information"],
  0x03bc: ["micro", "mu"], 0x00b5: ["micro", "mu"], 0x03c0: ["pi", "3.14"], 0x03a9: ["ohm", "omega"], 0x03bb: ["lambda"], 0x03b4: ["delta", "change"], 0x0394: ["delta", "change", "difference"], 0x03a3: ["sigma", "sum"], 0x03b8: ["theta", "angle"],
};

type Row = { cp: number; n: string; s: string; k: string[]; e?: string };

const cps = (span: Span): number[] => (typeof span === "number" ? [span] : Array.from({ length: span[1] - span[0] + 1 }, (_, i) => span[0] + i));
/** Case-insensitive dedupe, first spelling kept. */
const uniq = (xs: string[]) => { const seen = new Set<string>(); return xs.filter((x) => { const k = x.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }); };

const [ucd, entities] = await Promise.all([
  fetch(UCD).then((r) => r.text()),
  fetch(ENTITIES).then((r) => r.json() as Promise<Record<string, { codepoints: number[] }>>),
]);

/** Code point to [name, Unicode 1.0 name] from UnicodeData.txt (fields 1 and 10). */
const names = new Map<number, [string, string]>();
for (const line of ucd.split("\n")) {
  const f = line.split(";");
  if (f.length > 10 && !f[1].startsWith("<")) names.set(parseInt(f[0], 16), [f[1], f[10]]);
}

/** Code point to its entity names, the canonical `&name;` forms only, shortest first (lower case wins a tie, so `rarr` over `RightArrow`). */
const ents = new Map<number, string[]>();
for (const [k, v] of Object.entries(entities)) {
  if (!k.endsWith(";") || v.codepoints.length !== 1) continue;
  const name = k.slice(1, -1);
  ents.set(v.codepoints[0], [...(ents.get(v.codepoints[0]) ?? []), name]);
}
const byLength = (a: string, b: string) => a.length - b.length || (a === a.toLowerCase() ? -1 : 1);

const rows: Row[] = [];
const taken = new Set<number>();
for (const sec of SECTIONS) {
  for (const span of sec.spans) for (const cp of cps(span)) {
    if (taken.has(cp)) continue;
    const named = names.get(cp);
    if (!named) { console.error(`no UCD name for U+${cp.toString(16).toUpperCase()}, skipped`); continue; }
    taken.add(cp);
    const [name, old] = named;
    const e = (ents.get(cp) ?? []).sort(byLength);
    const k = uniq([...(WORDS[cp] ?? []), ...(old ? [old.toLowerCase()] : []), ...e.slice(0, 4), ...(LATEX[cp] ? [LATEX[cp]] : []), ...(sec.keywords ?? [])]);
    rows.push({ cp, n: name.toLowerCase(), s: sec.name, k, ...(e.length && { e: e[0] }) });
  }
}

writeFileSync(OUT, JSON.stringify(rows) + "\n");
const perSection = SECTIONS.map((s) => `${s.name} ${rows.filter((r) => r.s === s.name).length}`).join(", ");
console.log(`${rows.length} characters -> ${OUT}\n${perSection}`);
