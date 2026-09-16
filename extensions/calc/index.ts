// Calculator: an input palette, listed on every keystroke. Three parsers
// take the query in turn: dates and time zones (`dates.ts`), currency
// (`currency.ts`, ECB rates cached in storage), then mathjs for arithmetic
// and units (`math.ts`). The result is the row's title (what Enter
// copies), the query as understood its subtitle; a second row carries
// another form when there is one (hex for an integer, a fraction, the
// reverse conversion). Nothing is listed while the query does not parse,
// so typing never shows an error.
import { settings, type Action, type Extension, type Item } from "@zcag/pal";
import { ensureRates, homeCurrency, money, NAMES, parse as parseCurrency, rate, SOURCE } from "./currency.ts";
import { dates } from "./dates.ts";
import { normalizeNumbers, num, raw as rawNum } from "./format.ts";
import { evaluate, fraction, inBase, toBase } from "./math.ts";
import type { Row } from "./row.ts";

/** `[extensions.calc]`, defaults in pal.json; `home_currency` empty means the time zone's. */
type Settings = { precision: number; locale: string; home_currency: string };

const ICON = "=";
const ACTIONS: Action[] = [
  { id: "copy", title: "Copy result" },
  { id: "paste", title: "Paste result" },
  { id: "copy_raw", title: "Copy without formatting", shortcut: "cmd+shift+c" },
  { id: "copy_both", title: "Copy expression = result", shortcut: "cmd+shift+e" },
];
const hint = (name: string, subtitle: string): Item => ({ id: `hint:${name}`, name, subtitle, icon: ICON, actions: [] });
const HINTS = [
  hint("Type an expression", "2+2 · sqrt 2 · 15% of 240 · 255 to hex"),
  hint("Convert", "12 usd to try · 5 km to miles · 72 f to c"),
  hint("Dates and time", "today + 3 days · days until 2026-12-25 · 10:00 in tokyo"),
];

/** The rows of the last listing by id: what `pick` copies (an Item comes back as its id only). */
const last = new Map<string, { name: string; raw: string; expr: string }>();

const squeeze = (q: string) => q.replace(/\s+/g, " ");

async function currency(q: string, s: Settings, locale: string): Promise<Row[] | undefined> {
  const c = parseCurrency(q);
  if (!c) return;
  const amount = await evaluate(c.amount);
  if (amount?.kind !== "number") return;
  const home = s.home_currency?.toUpperCase() || homeCurrency();
  const to = c.to ?? (c.from === home ? (home === "USD" ? "EUR" : "USD") : home);
  const expr = `${num(amount.value, s.precision, locale)} ${c.from} to ${to}`;
  const { rates, fetching } = await ensureRates();
  if (!rates) return [{ id: "rates", name: fetching ? "Fetching exchange rates…" : "No exchange rates yet (offline)", subtitle: expr, inert: true }];
  const r = rate(rates, c.from, to);
  if (!r) return [{ id: "rates", name: `No rate for ${rates.rates[c.from] ? to : c.from}`, subtitle: expr, inert: true }];
  const p = Math.min(s.precision, 6);
  const value = amount.value * r;
  const dated = { text: `rates ${rates.date}` };
  const detail = {
    markdown: `**${money(amount.value, c.from, locale)}** = **${money(value, to, locale)}**`,
    metadata: [
      { label: "Rate", value: `1 ${c.from} = ${num(r, p, locale)} ${to}` },
      { label: "Inverse", value: `1 ${to} = ${num(1 / r, p, locale)} ${c.from}` },
      { label: "From", value: `${NAMES[c.from] ?? c.from} (${c.from})` },
      { label: "To", value: `${NAMES[to] ?? to} (${to})` },
      { label: "Rates", value: rates.date },
      { label: "Source", link: { text: SOURCE.name, href: SOURCE.url } },
    ],
  };
  return [
    { id: "result", name: money(value, to, locale), subtitle: expr, raw: money(value, to, "en", false).split(" ")[0], accessories: [{ text: `1 ${c.from} = ${num(r, p, locale)} ${to}` }, dated], detail },
    { id: "reverse", name: money(amount.value / r, c.from, locale), subtitle: `${num(amount.value, s.precision, locale)} ${to} to ${c.from}`, raw: money(amount.value / r, c.from, "en", false).split(" ")[0], accessories: [{ text: `1 ${to} = ${num(1 / r, p, locale)} ${c.from}` }, dated], detail },
  ];
}

async function arithmetic(q: string, s: Settings, locale: string): Promise<Row[] | undefined> {
  const b = await toBase(q);
  if (b) {
    const others = [16, 2, 8, 10].filter((x) => x !== b.base).map((x) => ({ text: x === 10 ? num(b.value, s.precision, locale) : inBase(b.value, x) }));
    return [{ id: "result", name: b.text, subtitle: squeeze(q), raw: b.text, accessories: others }];
  }
  const r = await evaluate(q);
  if (!r) return;
  const expr = squeeze(q);
  if (r.kind === "text") return [{ id: "result", name: r.text, subtitle: expr, raw: r.text }];
  if (r.kind === "unit") {
    const p = Math.min(s.precision, 6);
    return [{ id: "result", name: `${num(r.value, p, locale)} ${r.unit}`, subtitle: expr, raw: `${rawNum(r.value, p)} ${r.unit}`, accessories: [{ text: r.unit }] }];
  }
  const rows: Row[] = [{ id: "result", name: num(r.value, s.precision, locale), subtitle: expr, raw: rawNum(r.value, s.precision) }];
  // Other bases for a number typed as one (`0xff`) or a bare integer (`255`); not for every integer result.
  const written = /^\s*-?0x/i.test(q) ? 16 : /^\s*-?0b/i.test(q) ? 2 : /^\s*-?0o/i.test(q) ? 8 : /^\s*\d+\s*$/.test(q) ? 10 : 0;
  if (written && Number.isInteger(r.value) && Math.abs(r.value) <= Number.MAX_SAFE_INTEGER && Math.abs(r.value) >= 2) {
    const [main, ...rest] = [16, 2, 8].filter((x) => x !== written);
    rows.push({ id: "base", name: inBase(r.value, main), subtitle: { 16: "hexadecimal", 2: "binary", 8: "octal" }[main]!, raw: inBase(r.value, main), accessories: rest.map((x) => ({ text: inBase(r.value, x) })) });
  }
  const f = await fraction(r.value);
  if (f) rows.push({ id: "fraction", name: f, subtitle: "as a fraction", raw: f });
  return rows;
}

const item = (r: Row): Item => ({
  id: r.id,
  name: r.name,
  subtitle: r.subtitle,
  icon: ICON,
  ...(r.accessories?.length ? { accessories: r.accessories } : {}),
  ...(r.detail ? { detail: r.detail } : {}),
  actions: r.inert ? [] : ACTIONS,
});

export default {
  palettes: {
    calc: {
      title: "Calculator",
      icon: ICON,
      input: true,
      placeholder: "Calculate",
      list: async (query = "") => {
        const q = query.trim().replace(/\s*=$/, "");
        if (!q) return HINTS;
        const s = settings.get<Settings>();
        const locale = s.locale || "en";
        const qn = normalizeNumbers(q, locale);
        const rows = dates(qn, locale) ?? (await currency(qn, s, locale)) ?? (await arithmetic(qn, s, locale)) ?? [];
        last.clear();
        for (const r of rows) if (!r.inert) last.set(r.id, { name: r.name, raw: r.raw ?? r.name, expr: r.subtitle });
        return rows.map(item);
      },
      pick: (id, action) => {
        const r = last.get(id);
        if (!r) return { hide: true };
        switch (action) {
          case "paste": return { paste: { text: r.name } };
          case "copy_raw": return { copy: r.raw };
          case "copy_both": return { copy: `${r.expr} = ${r.name}` };
          default: return { copy: r.name };
        }
      },
    },
  },
} satisfies Extension;
