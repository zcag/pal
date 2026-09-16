// Calculator: an input palette, mathjs evaluates the query on every
// keystroke. The result is the row's title (what you read and copy), the
// expression the subtitle. Percent-of and °C/°F are rewritten into mathjs
// syntax first; the rest (functions, units, `to` conversions) is mathjs's.
import { settings, type Extension, type Item } from "@zcag/pal";

/** `[extensions.calc]`, default in pal.json. */
type Settings = { precision: number };

// mathjs takes ~130 ms to import; started here, awaited by the first list,
// so the host reports the palette loaded right away. A failed import
// surfaces from that list, not as an unhandled rejection (which exits Bun).
const math = import("mathjs").then(({ create, all }) => create(all));
math.catch(() => {});
const ICON = "=";

const hint = (name: string, subtitle: string): Item => ({ id: `hint:${name}`, name, subtitle, icon: ICON, actions: [] });
const HINTS = [
  hint("Type an expression", "2+2 · sqrt(16) · 15% of 240"),
  hint("Units too", "12 GB to MB · 3 weeks to days · 72 °F to °C"),
];

/** Calculator idioms mathjs lacks: `15% of 240`, a bare `15%`, degree signs. */
const rewrite = (q: string) =>
  q
    .replace(/(\d+(?:\.\d+)?)\s*%\s*of\s+/gi, "($1/100)*")
    .replace(/(\d+(?:\.\d+)?)%(?!\s*\d)/g, "($1/100)")
    .replace(/°\s*([cf])\b/gi, (_, u: string) => `deg${u.toUpperCase()}`);

async function evaluate(q: string): Promise<string | undefined> {
  const m = await math;
  try {
    const r = m.evaluate(rewrite(q));
    if (r === undefined || typeof r === "function") return;
    return m.format(r, { precision: settings.get<Settings>().precision });
  } catch {
    return;
  }
}

export default {
  palettes: {
    calc: {
      title: "Calculator",
      icon: ICON,
      input: true,
      placeholder: "Calculate",
      list: async (query = "") => {
        const q = query.trim();
        if (!q) return HINTS;
        const result = await evaluate(q);
        return result === undefined ? [] : [{ id: result, name: result, subtitle: q, icon: ICON, actions: [{ id: "copy", title: "Copy result" }] }];
      },
      pick: (id) => ({ copy: id }),
    },
  },
} satisfies Extension;
