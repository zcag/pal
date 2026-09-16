// calc: an input palette; dates, currency and mathjs over the query.
// Rates are canned: the host runs with PAL_CALC_OFFLINE=1 (no fetch) and a
// `rates` entry pre-seeded in the harness's storage; two more hosts at the
// end exercise the fetch against a local server.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Host, stored } from "../harness.ts";

const RATES = { EUR: 1, USD: 1.1539, TRY: 56.126, GBP: 0.85578, JPY: 178.85, CHF: 0.9441, INR: 110.73 };
const seed = (date: string, fetched: number) => stored.set("calc\0rates", { base: "EUR", date, fetched, rates: RATES });

let host: Host;
beforeAll(async () => {
  process.env.TZ = "UTC"; // bun test runs in UTC; the host it spawns must agree for the date expectations below
  process.env.PAL_CALC_OFFLINE = "1";
  seed("2026-09-15", Date.now());
  host = await Host.bundled({ settings: { calc: { settings: { home_currency: "TRY" } } } });
});
afterAll(() => { host.kill(); delete process.env.PAL_CALC_OFFLINE; stored.delete("calc\0rates"); });

const calc = (q: string) => host.list("calc", "calc", q);
const first = async (q: string) => (await calc(q))[0]?.name;
const ACTIONS = [
  { id: "copy", title: "Copy result" },
  { id: "paste", title: "Paste result" },
  { id: "copy_raw", title: "Copy without formatting", shortcut: "cmd+shift+c" },
  { id: "copy_both", title: "Copy expression = result", shortcut: "cmd+shift+e" },
];
const texts = (r: any) => (r.accessories ?? []).map((a: any) => a.text);
const pad = (n: number) => String(n).padStart(2, "0");
const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const plusDays = (n: number) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); return d; };

describe("calc", () => {
  test("meta: input palette with a placeholder", () => {
    expect(host.loaded().find((l) => l.extension === "calc")!.palettes[0]).toEqual({ name: "calc", title: "Calculator", live: false, input: true, icon: "=", placeholder: "Calculate" });
  });

  test("2+2: the result as the title, the expression as subtitle, four actions", async () => {
    expect(await calc("2+2")).toEqual([{ id: "result", name: "4", subtitle: "2+2", icon: "=", actions: ACTIONS }]);
  });

  test("an empty query lists three inert hints; whitespace counts as empty", async () => {
    const hints = await calc("");
    expect(hints).toHaveLength(3);
    for (const h of hints) { expect(h.actions).toEqual([]); expect(h.id).toMatch(/^hint:/); }
    expect(await calc("   ")).toEqual(hints);
    expect(await host.list("calc", "calc")).toEqual(hints);
  });

  test("partial or invalid input lists nothing, never an error row", async () => {
    for (const q of ["foo(((", "hello world", "sqrt", "1 +", "(1+2", "2*", "12 gb to", "km", "1 btc to usd", "12 usd to xyz", "10:00 in nowhere"]) expect(await calc(q)).toEqual([]);
  });
});

describe("numbers", () => {
  test("arithmetic, constants, functions with and without parens", async () => {
    expect(await first("2^10")).toBe("1,024");
    expect(await first("5!")).toBe("120");
    expect(await first("sqrt 2")).toBe("1.414213562");
    expect(await first("sqrt(16)")).toBe("4");
    expect(await first("square root of 625")).toBe("25");
    expect(await first("2 power 10")).toBe("1,024");
    expect(await first("3 x 4")).toBe("12");
    expect(await first("10 mod 3")).toBe("1");
    expect(await first("pi")).toBe("3.141592654");
    expect(await first("e")).toBe("2.718281828");
    expect(await first("1e6")).toBe("1,000,000");
    expect(await first("123456789*1000")).toBe("123,456,789,000");
    expect(await first("2^100")).toBe("1.2676506e+30");
    expect(await first("1e-7")).toBe("1e-7");
    expect(await first("2+2 =")).toBe("4");
    expect(await first("1,000 + 1")).toBe("1,001");
  });

  test("percentages: of, off, and the calculator meaning of `240 + 15%`", async () => {
    expect(await first("15% of 240")).toBe("36");
    expect(await first("20% off 80")).toBe("64");
    expect(await first("240 + 15%")).toBe("276");
    expect(await first("240 - 15%")).toBe("204");
    expect(await first("50%")).toBe("0.5");
    expect(await first("10 % 3")).toBe("1");
  });

  test("bases: literals in, `to hex` out, a second row with the other bases", async () => {
    expect(await calc("0xff")).toEqual([
      { id: "result", name: "255", subtitle: "0xff", icon: "=", actions: ACTIONS },
      { id: "base", name: "0b11111111", subtitle: "binary", icon: "=", accessories: [{ text: "0o377" }], actions: ACTIONS },
    ]);
    expect(await first("0b1010")).toBe("10");
    const hex = (await calc("255 to hex"))[0];
    expect(hex.name).toBe("0xff");
    expect(texts(hex)).toEqual(["0b11111111", "0o377", "255"]);
    expect(await first("255 in binary")).toBe("0b11111111");
    const bare = await calc("255");
    expect(bare.map((r) => r.name)).toEqual(["255", "0xff"]);
    expect(await calc("2+2")).toHaveLength(1); // not for every integer result
  });

  test("a fraction row for a number that is one", async () => {
    expect((await calc("1/3")).map((r) => r.name)).toEqual(["0.3333333333", "1/3"]);
    expect((await calc("0.375")).map((r) => r.name)).toEqual(["0.375", "3/8"]);
    expect((await calc("pi")).map((r) => r.name)).toEqual(["3.141592654"]);
  });

  test("precision: significant digits from the setting, integers never rounded", async () => {
    expect(await first("1/3")).toBe("0.3333333333");
    expect(await first("100/3")).toBe("33.33333333");
    host.changeSettings("calc", { settings: { precision: 3, home_currency: "TRY" } });
    expect(await first("1/3")).toBe("0.333");
    expect(await first("100/3")).toBe("33.3");
    expect(await first("123456789*1000")).toBe("123,456,789,000");
    expect(await first("72 f to c")).toBe("22.2 °C");
    host.changeSettings("calc", { settings: { home_currency: "TRY" } });
  });

  test("locale: how numbers are read and written", async () => {
    host.changeSettings("calc", { settings: { locale: "tr", home_currency: "TRY" } });
    expect(await first("1,5 + 2")).toBe("3,5");
    expect(await first("1.000.000 / 3")).toBe("333.333,3333");
    expect(await first("12 usd to try")).toBe("583,68 TRY");
    host.changeSettings("calc", { settings: { home_currency: "TRY" } });
    expect(await first("1/3")).toBe("0.3333333333");
  });
});

describe("units", () => {
  test("the common phrasings, rounded to 6 significant digits, the unit as accessory", async () => {
    expect(await calc("5 km to miles")).toEqual([{ id: "result", name: "3.10686 miles", subtitle: "5 km to miles", icon: "=", accessories: [{ text: "miles" }], actions: ACTIONS }]);
    expect(await first("72 f to c")).toBe("22.2222 °C");
    expect(await first("72f to c")).toBe("22.2222 °C");
    expect(await first("212 °F to °C")).toBe("100 °C");
    expect(await first("300 k to c")).toBe("26.85 °C");
    expect(await first("12 gb to mb")).toBe("12,000 MB");
    expect(await first("1 gib to mb")).toBe("1,073.74 MB");
    expect(await first("3 weeks to days")).toBe("21 days");
    expect(await first("100 kph to mph")).toBe("62.1371 mph");
    expect(await first("100 kph in mph")).toBe("62.1371 mph");
    expect(await first("1 acre in m2")).toBe("4,046.86 m2");
    expect(await first("1 mile to km")).toBe("1.60934 km");
    expect(await first("5 kg to lb")).toBe("11.0231 lb");
    expect(await first("10 ft in m")).toBe("3.048 m");
    expect(await first("1 hp to kw")).toBe("0.7457 kW");
    expect(await first("2 hours + 30 minutes to minutes")).toBe("150 minutes");
    expect(await first("5 ft 3 in to cm")).toBe("160.02 cm");
    expect(await first("hex(255)")).toBe("0xff");
  });
});

describe("currency", () => {
  test("12 usd to try: the conversion, the rate and its date, the reverse row, a detail", async () => {
    const rows = await calc("12 usd to try");
    expect(rows.map((r) => [r.id, r.name, r.subtitle])).toEqual([["result", "583.68 TRY", "12 USD to TRY"], ["reverse", "0.25 USD", "12 TRY to USD"]]);
    expect(texts(rows[0])).toEqual(["1 USD = 48.6403 TRY", "rates 2026-09-15"]);
    expect(rows[0].actions).toEqual(ACTIONS);
    const d = rows[0].detail!;
    expect(d.markdown).toBe("**12.00 USD** = **583.68 TRY**");
    expect(d.metadata!.map((m) => [m.label, m.value ?? m.link?.text])).toEqual([
      ["Rate", "1 USD = 48.6403 TRY"], ["Inverse", "1 TRY = 0.0205591 USD"], ["From", "US Dollar (USD)"], ["To", "Turkish Lira (TRY)"], ["Rates", "2026-09-15"], ["Source", "European Central Bank via frankfurter.dev"],
    ]);
  });

  test("symbols, names, codes in any case, `in`, shorthand amounts, an amount expression", async () => {
    expect(await first("12 usd in eur")).toBe("10.40 EUR");
    expect(await first("€12 to $")).toBe("13.85 USD");
    expect(await first("12 dollars in lira")).toBe("583.68 TRY");
    expect(await first("12 USD TO TRY")).toBe("583.68 TRY");
    expect(await first("£10 to ₺")).toBe("655.85 TRY");
    expect(await first("1k usd")).toBe("48,640.26 TRY");
    expect(await first("12*2 usd to try")).toBe("1,167.37 TRY");
    expect(await first("1 jpy to try")).toBe("0.31 TRY");
    expect(await first("usd try")).toBe("48.64 TRY");
    expect((await calc("usd try"))[0].subtitle).toBe("1 USD to TRY");
  });

  test("a bare amount converts to the home currency; the home currency itself goes to USD", async () => {
    expect((await calc("12 usd"))[0].subtitle).toBe("12 USD to TRY");
    expect(await first("$12")).toBe("583.68 TRY");
    expect((await calc("100 try"))[0].subtitle).toBe("100 TRY to USD");
    host.changeSettings("calc", { settings: { home_currency: "gbp" } });
    expect((await calc("12 usd"))[0].subtitle).toBe("12 USD to GBP");
    host.changeSettings("calc", { settings: { home_currency: "" } });
    expect((await calc("12 usd"))[0].subtitle).toMatch(/^12 USD to [A-Z]{3}$/); // the time zone's
    host.changeSettings("calc", { settings: { home_currency: "TRY" } });
  });

  test("a target still being typed answers for the source alone", async () => {
    for (const q of ["12 usd t", "12 usd to", "12 usd to t", "12 usd to tr"]) expect((await calc(q))[0].subtitle).toBe("12 USD to TRY");
    expect(await first("12 usd to try")).toBe("583.68 TRY");
  });

  test("a currency the rate set lacks is an inert row, not a number", async () => {
    const rows = await calc("12 usd to sek");
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("No rate for SEK");
    expect(rows[0].actions).toEqual([]);
  });
});

describe("dates and time", () => {
  test("now, today, arithmetic, relative phrasings; an ISO row to copy", async () => {
    const now = await calc("now");
    expect(now.map((r) => r.id)).toEqual(["result", "iso", "unix"]);
    expect(now[1].name).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    expect(Number(now[2].name)).toBeCloseTo(Date.now() / 1000, -1);
    const today = await calc("today");
    expect(today[0].subtitle).toBe("today");
    expect(texts(today[0])).toEqual(["today"]);
    expect(today[1]).toMatchObject({ id: "iso", name: isoDate(plusDays(0)), subtitle: "ISO 8601" });
    const plus3 = await calc("today + 3 days");
    expect(plus3[0].name).toBe(new Intl.DateTimeFormat("en", { dateStyle: "full" }).format(plusDays(3)));
    expect(texts(plus3[0])).toEqual(["in 3 days"]);
    expect(plus3[1].name).toBe(isoDate(plusDays(3)));
    expect((await calc("3 weeks from now"))[1].name).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(texts((await calc("3 weeks from now"))[0])).toEqual(["in 3 weeks"]);
    expect((await calc("in 3 weeks"))[1].name).toBe(isoDate(plusDays(21)));
    expect((await calc("2 days ago"))[1].name).toBe(isoDate(plusDays(-2)));
    expect((await calc("tomorrow"))[1].name).toBe(isoDate(plusDays(1)));
    expect((await calc("25 dec 2026"))[1].name).toBe("2026-12-25");
    expect((await calc("dec 25, 2026"))[0].name).toBe("Friday, December 25, 2026");
    expect((await calc("2026-02-30"))).toEqual([]);
  });

  test("counts and differences between dates", async () => {
    const until = (await calc("days until 2026-12-25"))[0];
    const days = Math.round((Date.UTC(2026, 11, 25) - Date.UTC(plusDays(0).getFullYear(), plusDays(0).getMonth(), plusDays(0).getDate())) / 86400e3);
    expect(until.name).toBe(`${days} days`);
    expect(until.subtitle).toBe("days until Friday, December 25, 2026");
    expect(await calc("2026-01-01 - 2025-06-15")).toEqual([{ id: "result", name: "200 days", subtitle: "Sunday, June 15, 2025 → Thursday, January 1, 2026", icon: "=", accessories: [{ text: "28 weeks 4 days" }, { text: "6 months 17 days" }], actions: ACTIONS }]);
    expect(await first("2025-06-15 to 2026-01-01")).toBe("200 days");
    expect(await first("weeks between 2025-06-15 and 2026-01-01")).toBe("28.6 weeks");
    expect(await first("months since 2025-06-15 ")).toMatch(/^\d+ months$/);
  });

  test("time zones: an explicit source, the local zone as the source, `time in`", async () => {
    const rows = await calc("10:00 utc to tokyo");
    expect(rows[0]).toMatchObject({ id: "result", name: "7:00 PM", subtitle: "10:00 UTC (UTC) → Tokyo (GMT+9)", accessories: [{ text: "Asia/Tokyo" }] });
    expect(rows[1].subtitle).toBe("in Asia/Tokyo");
    expect(texts((await calc("23:00 utc to tokyo"))[0])).toEqual(["Asia/Tokyo", "next day"]);
    expect(await first("14:30 ist to cet")).toMatch(/^(12|1):30 PM$/); // Istanbul is UTC+3; CET is +1 or +2 by season
    expect(await first("5pm ldn in sf")).toBe("9:00 AM");
    expect(await first("10am new york to utc+3")).toMatch(/^(5|6):00 PM$/);
    expect((await calc("10:00 in tokyo"))[0].subtitle).toMatch(/^10:00 .+ → Tokyo \(GMT\+9\)$/);
    expect((await calc("now in utc"))[0].name).toBe(new Intl.DateTimeFormat("en", { timeStyle: "short", timeZone: "UTC" }).format(Date.now()));
    expect((await calc("time in tokyo"))[0].accessories).toEqual([{ text: "Asia/Tokyo" }]);
    expect((await calc("tokyo time"))[0].accessories).toEqual([{ text: "Asia/Tokyo" }]);
    expect((await calc("10:00 in Europe/Berlin"))[0].accessories).toEqual([{ text: "Europe/Berlin" }]);
  });

  test("unix time both ways", async () => {
    const rows = await calc("unix 1700000000");
    expect(rows[0].name).toBe(new Intl.DateTimeFormat("en", { dateStyle: "full", timeStyle: "short" }).format(1700000000000));
    expect(rows[2]).toMatchObject({ id: "unix", name: "1700000000" });
    expect((await calc("1700000000 to date"))[0].name).toBe(rows[0].name);
    expect((await calc("1700000000000 to date"))[0].name).toBe(rows[0].name);
    expect(Number(await first("unix"))).toBeCloseTo(Date.now() / 1000, -1);
    expect(await first("2026-01-01 12:00 to unix")).toBe(String(new Date(2026, 0, 1, 12).getTime() / 1000));
  });
});

describe("pick", () => {
  test("copy, paste, copy without formatting, copy expression = result", async () => {
    await calc("12 usd to try");
    expect(await host.pick("calc", "calc", "result")).toEqual({ copy: "583.68 TRY" });
    expect(await host.pick("calc", "calc", "result", "copy")).toEqual({ copy: "583.68 TRY" });
    expect(await host.pick("calc", "calc", "result", "paste")).toEqual({ paste: { text: "583.68 TRY" } });
    expect(await host.pick("calc", "calc", "result", "copy_raw")).toEqual({ copy: "583.68" });
    expect(await host.pick("calc", "calc", "result", "copy_both")).toEqual({ copy: "12 USD to TRY = 583.68 TRY" });
    expect(await host.pick("calc", "calc", "reverse")).toEqual({ copy: "0.25 USD" });
    await calc("1e6");
    expect(await host.pick("calc", "calc", "result", "copy_raw")).toEqual({ copy: "1000000" });
    await calc("5 km to miles");
    expect(await host.pick("calc", "calc", "result", "copy_raw")).toEqual({ copy: "3.10686 miles" });
    expect(await host.pick("calc", "calc", "no-such-row")).toEqual({ hide: true });
  });
});

describe("rates fetch", () => {
  let server: ReturnType<typeof Bun.serve>;
  let hits = 0;
  beforeAll(() => {
    server = Bun.serve({ port: 0, fetch: () => { hits++; return Response.json({ amount: 1, base: "EUR", date: "2026-09-16", rates: { USD: 1.2, TRY: 60 } }); } });
    delete process.env.PAL_CALC_OFFLINE;
    process.env.PAL_CALC_RATES_URL = `http://127.0.0.1:${server.port}/v1/latest`;
  });
  afterAll(() => { server.stop(true); delete process.env.PAL_CALC_RATES_URL; process.env.PAL_CALC_OFFLINE = "1"; });

  test("no cache: a fetching row first, the result once the rates are in, the set stored with its date", async () => {
    stored.delete("calc\0rates");
    const h = await Host.bundled({ settings: { calc: { settings: { home_currency: "TRY" } } } });
    try {
      const rows = await h.list("calc", "calc", "12 usd to try");
      expect(rows).toEqual([{ id: "rates", name: "Fetching exchange rates…", subtitle: "12 USD to TRY", icon: "=", actions: [] }]);
      await h.until(() => stored.has("calc\0rates"), 3000, "rates stored");
      expect(stored.get("calc\0rates")).toMatchObject({ base: "EUR", date: "2026-09-16", rates: { USD: 1.2, TRY: 60, EUR: 1 } });
      const done = await h.list("calc", "calc", "12 usd to try");
      expect(done[0].name).toBe("600.00 TRY");
      expect(texts(done[0])).toEqual(["1 USD = 50 TRY", "rates 2026-09-16"]);
      expect(hits).toBe(1);
    } finally { h.kill(); }
  });

  test("a day-old cache answers at once, dated, while a refresh runs", async () => {
    hits = 0;
    seed("2026-09-14", Date.now() - 2 * 24 * 3600e3);
    const h = await Host.bundled({ settings: { calc: { settings: { home_currency: "TRY" } } } });
    try {
      const rows = await h.list("calc", "calc", "12 usd to try");
      expect(rows[0].name).toBe("583.68 TRY");
      expect(texts(rows[0])[1]).toBe("rates 2026-09-14");
      await h.until(() => (stored.get("calc\0rates") as any)?.date === "2026-09-16", 3000, "rates refreshed");
      expect((await h.list("calc", "calc", "12 usd to try"))[0].name).toBe("600.00 TRY");
      expect(hits).toBe(1);
    } finally { h.kill(); }
  });
});
