// calc: an input palette; dates, currency and mathjs over the query.
// Rates are canned: the host runs with PAL_CALC_OFFLINE=1 (no fetch) and a
// `rates` entry pre-seeded in the harness's storage; two more hosts at the
// end exercise the fetch against a local server.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { tile } from "../../../sdk/src/icon.ts";
import { Host, stored } from "../harness.ts";

const RATES = { EUR: 1, USD: 1.1539, TRY: 56.126, GBP: 0.85578, JPY: 178.85, CHF: 0.9441, INR: 110.73 };
const VARS = ["salary_hour = 54 usd", "salary_day = salary_hour * 8", "salary_month = salary_hour * 2080 / 12", "lap_pool = 50 m", "lap_track = 400 m", "rent = 42000 try", "height = 183 cm", "try = 5", "loop = loop + 1", "not a var"];
const BASE = { home_currency: "TRY", vars: VARS };
const seed = (date: string, fetched: number) => stored.set("calc\0rates", { base: "EUR", date, fetched, rates: RATES });

let host: Host;
const env = { TZ: process.env.TZ, PAL_NOW: process.env.PAL_NOW };
beforeAll(async () => {
  // The clock is pinned: Wednesday 2026-09-16 10:30 in Istanbul (the SDK's clock.ts reads PAL_NOW, local to TZ), so every date below is a literal.
  process.env.TZ = "Europe/Istanbul";
  process.env.PAL_NOW = "2026-09-16T10:30:00";
  process.env.PAL_CALC_OFFLINE = "1";
  seed("2026-09-15", Date.now());
  host = await Host.bundled({ settings: { calc: { settings: BASE } } });
});
afterAll(() => {
  host.kill();
  delete process.env.PAL_CALC_OFFLINE;
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  stored.delete("calc\0rates");
});

const calc = (q: string) => host.list("calc", "calc", q);
const first = async (q: string) => (await calc(q))[0]?.name;
const ACTIONS = [
  { id: "copy", title: "Copy result" },
  { id: "paste", title: "Paste result" },
  { id: "copy_raw", title: "Copy without formatting", shortcut: "cmd+shift+c" },
  { id: "copy_both", title: "Copy expression = result", shortcut: "cmd+shift+e" },
];
const texts = (r: any) => (r.accessories ?? []).map((a: any) => a.text);

describe("calc", () => {
  test("meta: input palette with a placeholder", () => {
    const meta = host.loaded().find((l) => l.extension === "calc")!.palettes[0];
    expect(meta).toEqual({ name: "calc", title: "Calculator", live: false, input: true, icon: tile("indigo", "\u{f00ec}"), placeholder: "An expression, a conversion, a date or a time", inline: true, match: expect.any(String), fallback: "ask" });
  });

  test("at the root (inline): `match` takes sums, conversions and dates, never a bare number or a word; the inline list has no hints", async () => {
    const { matches } = await import("../../../extensions/calc/index.ts");
    for (const yes of ["2+2", "15% of 80", "12 usd to try", "5 km to miles", "3 days from now", "today + 3 days", "now in tokyo", "sqrt 2", "0xff"]) expect(matches(yes)).toBe(true);
    for (const no of ["", "42", "1,000", "chrome", "slack"]) expect(matches(no)).toBe(false);
    expect(matches("1password")).toBe(true); // a digit next to letters reads as a unit; the parse then finds nothing and the root shows no row
    expect(await host.list("calc", "calc", "", { inline: true })).toEqual([]);
    expect((await host.list("calc", "calc", "2+2", { inline: true }))[0]).toMatchObject({ id: "result", name: "4" });
    const sections = await host.request<{ extension: string; palette: string; items: { name: string }[] }[]>("inline", { query: "15% of 80" });
    expect(sections.find((s) => s.extension === "calc")!.items[0].name).toBe("12");
    expect((await host.request<unknown[]>("inline", { query: "1password" })).find((s: any) => s.extension === "calc")).toBeUndefined();
  });

  test("2+2: the result as the title, the expression as subtitle, four actions", async () => {
    expect(await calc("2+2")).toEqual([{ id: "result", name: "4", subtitle: "2+2", icon: "\u{f01fc}", actions: ACTIONS }]);
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
      { id: "result", name: "255", subtitle: "0xff", icon: "\u{f01fc}", actions: ACTIONS },
      { id: "base", name: "0b11111111", subtitle: "binary", icon: "\u{f01fc}", accessories: [{ text: "0o377" }], actions: ACTIONS },
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
    host.changeSettings("calc", { settings: { ...BASE, precision: 3 } });
    expect(await first("1/3")).toBe("0.333");
    expect(await first("100/3")).toBe("33.3");
    expect(await first("123456789*1000")).toBe("123,456,789,000");
    expect(await first("72 f to c")).toBe("22.2 °C");
    host.changeSettings("calc", { settings: BASE });
  });

  test("locale: how numbers are read and written", async () => {
    host.changeSettings("calc", { settings: { ...BASE, locale: "tr" } });
    expect(await first("1,5 + 2")).toBe("3,5");
    expect(await first("1.000.000 / 3")).toBe("333.333,3333");
    expect(await first("12 usd to try")).toBe("583,68 TRY");
    host.changeSettings("calc", { settings: BASE });
    expect(await first("1/3")).toBe("0.3333333333");
  });
});

describe("units", () => {
  test("the common phrasings, rounded to 6 significant digits, the unit as accessory", async () => {
    expect(await calc("5 km to miles")).toEqual([{ id: "result", name: "3.10686 miles", subtitle: "5 km to miles", icon: "\u{f01fc}", accessories: [{ text: "miles" }], actions: ACTIONS }]);
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
    host.changeSettings("calc", { settings: { ...BASE, home_currency: "gbp" } });
    expect((await calc("12 usd"))[0].subtitle).toBe("12 USD to GBP");
    host.changeSettings("calc", { settings: { ...BASE, home_currency: "" } });
    expect((await calc("12 usd"))[0].subtitle).toMatch(/^12 USD to [A-Z]{3}$/); // the time zone's
    host.changeSettings("calc", { settings: BASE });
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

describe("dates and time (PAL_NOW: Wednesday 2026-09-16 10:30 in Europe/Istanbul)", () => {
  const rows = async (q: string) => (await calc(q)).map((r: any) => [r.name, r.subtitle, texts(r)]);
  const names = async (q: string) => (await calc(q)).map((r) => r.name);

  test("now, today, arithmetic, relative phrasings; an ISO row to copy", async () => {
    expect(await rows("now")).toEqual([
      ["10:30", "now in Europe/Istanbul", ["Wednesday, September 16, 2026"]],
      ["2026-09-16T10:30:00+03:00", "ISO 8601", []],
      ["1789543800", "unix time", []],
    ]);
    expect(await rows("today")).toEqual([["Wednesday, September 16, 2026", "today", ["today"]], ["2026-09-16", "ISO 8601", []]]);
    expect((await rows("today + 3 days"))[0]).toEqual(["Saturday, September 19, 2026", "today + 3 days", ["in 3 days"]]);
    expect(await names("2026-10-14 + 45 days")).toEqual(["Saturday, November 28, 2026", "2026-11-28"]);
    expect(await names("today + 3 weeks")).toEqual(["Wednesday, October 7, 2026", "2026-10-07"]);
    expect(await rows("3 weeks from now")).toEqual([
      ["Wednesday, October 7, 2026 at 10:30", "3 weeks from now", ["in 3 weeks"]],
      ["2026-10-07T10:30:00+03:00", "ISO 8601", []],
      ["1791358200", "unix time", []],
    ]);
    expect((await calc("now + 2 hours"))[0].name).toBe("Wednesday, September 16, 2026 at 12:30");
    expect((await calc("in 90 days"))[1].name).toBe("2026-12-15");
    expect((await calc("2 days ago"))[1].name).toBe("2026-09-14");
    expect((await calc("tomorrow"))[1].name).toBe("2026-09-17");
    expect((await calc("25 dec 2026"))[1].name).toBe("2026-12-25");
    expect((await calc("dec 25, 2026"))[0].name).toBe("Friday, December 25, 2026");
    expect(await calc("2026-02-30")).toEqual([]);
  });

  test("weekdays: the coming one, next (after today), last (before today), this; next week and month; Turkish names", async () => {
    expect(await rows("next friday")).toEqual([["Friday, September 18, 2026", "next friday", ["in 2 days"]], ["2026-09-18", "ISO 8601", []]]);
    expect((await calc("friday"))[1].name).toBe("2026-09-18");
    expect((await calc("wednesday"))[1].name).toBe("2026-09-16"); // today is one
    expect((await calc("next wednesday"))[1].name).toBe("2026-09-23");
    expect((await calc("last wednesday"))[1].name).toBe("2026-09-09");
    expect((await calc("last friday"))[1].name).toBe("2026-09-11");
    expect((await calc("this mon"))[1].name).toBe("2026-09-21");
    expect((await calc("next week"))[1].name).toBe("2026-09-23");
    expect((await calc("next month"))[1].name).toBe("2026-10-16");
    expect((await calc("gelecek cuma"))[1].name).toBe("2026-09-18");
    expect((await calc("geçen salı"))[1].name).toBe("2026-09-15");
    expect((await calc("next friday + 1 week"))[1].name).toBe("2026-09-25");
  });

  test("Turkish month names, with or without their letters, any case", async () => {
    for (const q of ["25 aralık", "25 Aralık", "25 aralik", "25. aralık 2026"]) expect((await calc(q))[1].name).toBe("2026-12-25");
    expect((await calc("3 şubat 2027"))[1].name).toBe("2027-02-03");
    expect((await calc("1 mart"))[1].name).toBe("2026-03-01");
    expect((await calc("days until 25 aralık"))[0].name).toBe("100 days");
  });

  test("counts and differences between dates; workdays", async () => {
    expect(await rows("days until 25 dec")).toEqual([["100 days", "days until Friday, December 25, 2026", ["14 weeks 2 days", "3 months 9 days"]]]);
    expect(await first("days until 2026-12-25")).toBe("100 days");
    expect(await first("days since 2026-08-31")).toBe("16 days");
    expect(await first("weeks until 25 dec")).toBe("14.3 weeks");
    expect(await first("months since 2025-06-15")).toBe("15 months");
    expect(await first("days until friday")).toBe("2 days");
    expect(await calc("2026-01-01 - 2025-06-15")).toEqual([{ id: "result", name: "200 days", subtitle: "Sunday, June 15, 2025 → Thursday, January 1, 2026", icon: "\u{f01fc}", accessories: [{ text: "28 weeks 4 days" }, { text: "6 months 17 days" }], actions: ACTIONS }]);
    expect(await first("2025-06-15 to 2026-01-01")).toBe("200 days");
    expect(await first("weeks between 2025-06-15 and 2026-01-01")).toBe("28.6 weeks");
    expect(await first("between 1 mar and 14 oct")).toBe("227 days");
    // Monday to Friday from today (counted) up to the day (not): Sep 16 to Dec 25 is 100 days, 72 of them weekdays.
    expect(await rows("workdays until 25 dec")).toEqual([["72 workdays", "workdays until Friday, December 25, 2026", ["100 days", "Mon to Fri, holidays not counted"]]]);
    expect(await first("working days until friday")).toBe("2 workdays");
    expect(await first("business days between 2026-10-01 and 2026-11-01")).toBe("22 workdays");
    expect(await first("workdays since 2026-09-07")).toBe("7 workdays");
  });

  test("weeks: the ISO week now, of a day, and a numbered week's days", async () => {
    const now = [["Week 38", "this week: Mon 14 Sep to Sun 20 Sep", ["of 53 in 2026"]], ["2026-W38", "ISO 8601 week", []], ["2026-09-14", "its Monday", []]];
    for (const q of ["what week is it", "what week is it?", "week number", "what's the week number", "week"]) expect(await rows(q)).toEqual(now);
    expect((await rows("week of 25 dec"))[0]).toEqual(["Week 52", "the week of Fri 25 Dec: Mon 21 Dec to Sun 27 Dec", ["of 53 in 2026"]]);
    expect((await calc("week number of 2027-01-01"))[1].name).toBe("2026-W53"); // 1 January 2027 is a Friday: ISO week 53 of 2026
    expect((await rows("week 1 2027"))[0]).toEqual(["Week 1", "week 1 of 2027: Mon 4 Jan to Sun 10 Jan 2027", ["of 52 in 2027"]]);
    expect((await calc("week 42"))[2].name).toBe("2026-10-12");
    expect(await calc("week 54")).toEqual([]);
  });

  test("what day a date is: the weekday first", async () => {
    expect(await rows("what day is 2027-01-01")).toEqual([["Friday", "Friday, January 1, 2027", ["in 4 months"]], ["2027-01-01", "ISO 8601", []]]);
    expect(await first("what day was 29 oct 1923")).toBe("Monday");
    expect(await first("day of week 25 dec")).toBe("Friday");
  });

  test("time zones: the time there, how far ahead, the day when it is not today here; ISO and unix rows", async () => {
    expect(await rows("time in tokyo")).toEqual([
      ["16:30", "10:30 Istanbul (GMT+3) → Tokyo (GMT+9)", ["6 h ahead", "Asia/Tokyo"]],
      ["Wednesday, September 16, 2026 at 16:30", "in Asia/Tokyo", []],
      ["2026-09-16T16:30:00+09:00", "ISO 8601", []],
      ["1789543800", "unix time", []],
    ]);
    for (const q of ["tokyo time", "what time is it in tokyo?", "now in tokyo", "time in Asia/Tokyo"]) expect(await first(q)).toBe("16:30");
    expect((await rows("3pm in tokyo"))[0]).toEqual(["21:00", "15:00 Istanbul (GMT+3) → Tokyo (GMT+9)", ["6 h ahead", "Asia/Tokyo"]]);
    expect((await rows("3pm istanbul to new york"))[0]).toEqual(["08:00", "15:00 Istanbul (GMT+3) → New York (EDT)", ["7 h behind", "America/New_York"]]);
    expect((await rows("now in PST"))[0]).toEqual(["00:30", "10:30 Istanbul (GMT+3) → Los Angeles (PDT)", ["10 h behind", "America/Los_Angeles"]]);
    // A time with a zone and no target is that zone's time here.
    expect((await rows("3pm tokyo"))[0]).toEqual(["09:00", "15:00 Tokyo (GMT+9) → Istanbul (GMT+3)", ["6 h behind", "Europe/Istanbul"]]);
    expect(await first("3pm tokyo time")).toBe("09:00");
    expect((await rows("23:00 utc to tokyo"))[0]).toEqual(["tomorrow, 08:00", "23:00 UTC (UTC) → Tokyo (GMT+9)", ["9 h ahead", "Asia/Tokyo"]]);
    expect(await first("1am istanbul to sf")).toBe("yesterday, 15:00");
    expect(await first("10:00 in india")).toBe("12:30");
    expect((await calc("10:00 in india"))[0].accessories![0]).toEqual({ text: "2 h 30 min ahead" });
    expect(await first("14:30 ist to cet")).toBe("13:30");
    expect(await first("5pm ldn in sf")).toBe("09:00");
    expect(await first("10am new york to utc+3")).toBe("17:00");
    expect(await first("noon in london")).toBe("10:00");
    expect(await first("time in caracas")).toBe("03:30"); // a city the table lacks, from the IANA ids
    expect(await first("time in londra")).toBe("08:30");
    expect(await first("İstanbul time")).toBe("10:30");
    expect((await calc("10:00 in Europe/Berlin"))[0].accessories).toEqual([{ text: "1 h behind" }, { text: "Europe/Berlin" }]);
  });

  test("unix time both ways; a 10-digit number from this century is one", async () => {
    const moment = [
      ["Saturday, September 27, 2025 at 22:06", "unix 1759000000", ["12 months ago"]],
      ["2025-09-27T22:06:40+03:00", "ISO 8601", []],
      ["1759000000", "unix time", []],
    ];
    for (const q of ["1759000000", "@1759000000", "unix 1759000000", "1759000000 to date"]) expect(await rows(q)).toEqual(moment);
    expect((await rows("1759000000000"))[0][0]).toBe(moment[0][0]);
    expect(await rows("unix time")).toEqual([["1789543800", "unix time now", ["Wednesday, September 16, 2026 at 10:30"]]]);
    expect(await first("unix")).toBe("1789543800");
    expect(await first("2026-01-01 12:00 to unix")).toBe("1767258000");
    expect(await first("2026-01-01 to unix")).toBe("1767214800");
    expect(await names("5321234567")).toEqual(["5,321,234,567", "0x13d2b9887"]); // a phone number stays a number
  });

  test("durations: sums of hours and minutes, and one in a unit", async () => {
    expect(await rows("3h20m + 45m")).toEqual([["4 h 5 min", "3h20m + 45m", ["4:05"]], ["245 minutes", "in minutes", []], ["4.0833 hours", "in hours", []]]);
    expect(await first("2 hours + 30 minutes")).toBe("2 h 30 min");
    expect(await first("8h - 45 min - 30min")).toBe("6 h 45 min");
    expect(await rows("90 min in hours")).toEqual([["1.5 hours", "90 min in hours", ["1 h 30 min"]], ["1:30", "hours:minutes", []]]);
    expect(await first("1h30m to minutes")).toBe("90 minutes");
    expect(await first("45m + 10m")).toBe("55 m"); // no hour beside it: metres, mathjs's
    expect(await first("2 hours + 30 minutes to minutes")).toBe("150 minutes");
  });

  test("the root: date and time phrasings answer inline, words and app names do not", async () => {
    const { matches } = await import("../../../extensions/calc/index.ts");
    for (const yes of ["time in tokyo", "tokyo time", "3pm in tokyo", "next friday", "what week is it", "week number", "unix time", "unix", "1759000000", "@1759000000", "3h20m + 45m", "25 aralık", "gelecek cuma"]) expect([yes, matches(yes)]).toEqual([yes, true]);
    for (const no of ["friday", "mon", "week", "time machine", "slack time", "screen time", "5321234567", "what is this"]) expect([no, matches(no)]).toEqual([no, false]);
    const sections = await host.request<{ extension: string; items: { name: string }[] }[]>("inline", { query: "time in tokyo" });
    expect(sections.find((s) => s.extension === "calc")!.items[0].name).toBe("16:30");
  });
});

describe("variables", () => {
  const rows = async (q: string) => (await calc(q)).map((r: any) => [r.name, r.subtitle, texts(r)]);
  const dated = (r: string) => [r, "rates 2026-09-15"];

  test("money: in the home currency with the query as values for a subtitle, then in the currency it was worked out in", async () => {
    expect(await rows("salary_month")).toEqual([["455,272.87 TRY", "9,360.00 USD", dated("1 USD = 48.6403 TRY")], ["9,360.00 USD", "in US Dollar", []]]);
    expect((await rows("salary_month * 12"))[1]).toEqual(["112,320.00 USD", "in US Dollar", []]);
    expect((await rows("salary_month to eur"))[0]).toEqual(["8,111.62 EUR", "9,360.00 USD to eur", dated("1 USD = 0.866626 EUR")]);
    expect((await rows("salary_month - rent"))[0]).toEqual(["413,272.87 TRY", "9,360.00 USD - 42,000.00 TRY", dated("1 USD = 48.6403 TRY")]);
    expect(await rows("Rent*2")).toEqual([["84,000.00 TRY", "42,000.00 TRY*2", []]]); // already home: one row; names are case-blind
  });

  test("a ratio of two amounts is a number with its percentage; units and rates keep theirs", async () => {
    expect(await rows("rent / salary_month")).toEqual([["0.09225236807", "42,000.00 TRY / 9,360.00 USD", ["9.225%"]]]);
    expect(await rows("height to ft")).toEqual([["6.00394 ft", "183 cm to ft", []]]);
    expect(await rows("salary_hour / h")).toEqual([["54 USD/h", "54.00 USD / h", []]]);
  });

  test("`X in <variable>`: how many fit, labelled with its name; a prefix answers per member, the largest count first", async () => {
    expect(await rows("1500 usd in salary_hour")).toEqual([["27.78 salary_hour", "1500 usd / 54.00 USD", ["2,778%"]]]);
    expect(await rows("1500 usd in salary")).toEqual([
      ["27.78 hour", "1500 usd / 54.00 USD", ["2,778%"]],
      ["3.472 day", "1500 usd / 432.00 USD", ["347.2%"]],
      ["0.1603 month", "1500 usd / 9,360.00 USD", ["16.03%"]],
    ]);
    expect(await rows("salary_month in rent")).toEqual([["10.84 rent", "9,360.00 USD / 42,000.00 TRY", ["1,084%"]]]);
    expect(await rows("5 km in lap")).toEqual([["100 pool", "5 km / 50 m", ["10,000%"]], ["12.5 track", "5 km / 400 m", ["1,250%"]]]);
    expect(await rows("5 kg in lap_pool")).toEqual([["0.1 kg/m per lap_pool", "5 kg / 50 m", []]]); // no cancel: the quotient, per the name
  });

  test("an `in` naming no variable or prefix is the conversion it was", async () => {
    expect(await first("12 usd in eur")).toBe("10.40 EUR");
    expect(await first("5 km in miles")).toBe("3.10686 miles");
  });

  test("k is thousands everywhere, m and b millions and billions before a currency; a bare m is still metres", async () => {
    expect(await first("210k / 12")).toBe("17,500");
    expect(await first("2k + 500")).toBe("2,500");
    expect((await rows("210k try - rent"))[0]).toEqual(["168,000.00 TRY", "210k try - 42,000.00 TRY", []]);
    expect((await rows("210k try in salary"))[0]).toEqual(["79.95 hour", "210k try / 54.00 USD", ["7,995%"]]);
    expect((await rows("$1.5k in salary_hour"))[0]).toEqual(["27.78 salary_hour", "$1.5k / 54.00 USD", ["2,778%"]]);
    expect(await first("1.5m usd to try")).toBe("72,960,395.18 TRY");
    expect(await first("5m to ft")).toBe("16.4042 ft");
    expect(await first("300 k to c")).toBe("26.85 °C");
  });

  test("a loop, a currency's name and a malformed line are not variables", async () => {
    expect(await calc("loop")).toEqual([]);
    expect(await first("12 usd to try")).toBe("583.68 TRY");
  });

  test("at the root a variable answers inline without a digit", async () => {
    const sections = await host.request<{ extension: string; items: { name: string }[] }[]>("inline", { query: "rent / salary_month" });
    expect(sections.find((s) => s.extension === "calc")!.items[0].name).toBe("0.09225236807");
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
      expect(rows).toEqual([{ id: "rates", name: "Fetching exchange rates…", subtitle: "12 USD to TRY", icon: "\u{f01fc}", actions: [] }]);
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
