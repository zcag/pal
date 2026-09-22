// The add line's grammar and the day words (extensions/odak/when.ts), pure:
// tags, the flag, the section by prefix, `d:` and `w:`, the day at the end
// with a time left in the text, and how a due day reads on a row.
import { describe, expect, test } from "bun:test";
import { due, isoDay, linkIn, parseAdd, parseWhen, waits } from "../../../extensions/odak/when.ts";

process.env.TZ = "Europe/Istanbul";
/** Tuesday 22 September 2026, mid-morning. */
const NOW = new Date(2026, 8, 22, 10, 30).getTime();
const day = (s: string | undefined) => (s === undefined ? undefined : isoDay(parseWhen(s, NOW)!));
const at = (s: string) => parseWhen(s, NOW);

describe("parseWhen", () => {
  test("today, tomorrow and their short forms", () => {
    expect(day("today")).toBe("2026-09-22");
    expect(day("tonight")).toBe("2026-09-22");
    expect(day("tomorrow")).toBe("2026-09-23");
    expect(day("tmr")).toBe("2026-09-23");
    expect(day("Tomorrow,")).toBe("2026-09-23");
  });
  test("a weekday is the next one, today included; next <weekday> the coming one, today excluded (as the calendar reads it); next week and next month", () => {
    expect(day("fri")).toBe("2026-09-25");
    expect(day("friday")).toBe("2026-09-25");
    expect(day("tue")).toBe("2026-09-22");
    expect(day("mon")).toBe("2026-09-28");
    expect(day("next mon")).toBe("2026-09-28");
    expect(day("next tue")).toBe("2026-09-29");
    expect(day("next fri")).toBe("2026-09-25");
    expect(day("next week")).toBe("2026-09-29");
    expect(day("next month")).toBe("2026-10-22");
    expect(at("next year")).toBeUndefined();
  });
  test("in N days, weeks, months; the short forms; a, an", () => {
    expect(day("in 3 days")).toBe("2026-09-25");
    expect(day("in 1 day")).toBe("2026-09-23");
    expect(day("in 2 weeks")).toBe("2026-10-06");
    expect(day("in a week")).toBe("2026-09-29");
    expect(day("in a month")).toBe("2026-10-22");
    expect(day("3d")).toBe("2026-09-25");
    expect(day("2w")).toBe("2026-10-06");
    expect(day("1m")).toBe("2026-10-22");
    expect(at("in a")).toBeUndefined();
  });
  test("a date in its forms: iso, day month, month day, a year, dots and slashes; an impossible day is nothing", () => {
    expect(day("2026-10-01")).toBe("2026-10-01");
    expect(day("2026-1-5")).toBe("2026-01-05");
    expect(day("20 sep")).toBe("2026-09-20");
    expect(day("20sep")).toBe("2026-09-20");
    expect(day("1st oct")).toBe("2026-10-01");
    expect(day("sep 20")).toBe("2026-09-20");
    expect(day("Sept 20, 2027")).toBe("2027-09-20");
    expect(day("20 september 2027")).toBe("2027-09-20");
    expect(day("30.9")).toBe("2026-09-30");
    expect(day("30/9/2026")).toBe("2026-09-30");
    expect(at("31 sep")).toBeUndefined();
    expect(at("2026-02-30")).toBeUndefined();
  });
  test("by, on, due lead in; plain words are nothing", () => {
    expect(day("by fri")).toBe("2026-09-25");
    expect(day("on 20 sep")).toBe("2026-09-20");
    expect(day("due tomorrow")).toBe("2026-09-23");
    for (const w of ["may", "in", "on", "the", "bank", "3", "sa", "mo", ""]) expect(at(w)).toBeUndefined();
  });
});

describe("parseAdd", () => {
  const SECTIONS = ["Focus", "Today", "Next", "Inbox"];
  test("a plain line is the text alone", () => {
    expect(parseAdd("  buy   milk ", NOW)).toEqual({ text: "buy milk", tags: [], urgent: false });
  });
  test("#tags anywhere at a word's start, a bare ! flags, /section by prefix; an unknown /section and a # inside a url stay in the text", () => {
    const p = parseAdd("! fix the build #work #ci /fo see https://x.y/#frag", NOW, SECTIONS);
    expect(p).toMatchObject({ text: "fix the build see https://x.y/#frag", tags: ["work", "ci"], urgent: true, section: "Focus" });
    expect(parseAdd("read /nowhere #x", NOW, SECTIONS)).toEqual({ text: "read /nowhere", tags: ["x"], urgent: false });
    expect(parseAdd("wow!! ok", NOW).urgent).toBe(false);
  });
  test("d: and w: take a day as parseWhen reads it; a d: odak cannot read is kept as written; a second one stays in the text", () => {
    expect(parseAdd("taxes d:fri", NOW)).toMatchObject({ text: "taxes", deadline: "2026-09-25" });
    expect(parseAdd("taxes d:2026-12-01 w:2026-11-20", NOW)).toMatchObject({ text: "taxes", deadline: "2026-12-01", trigger: "2026-11-20" });
    expect(parseAdd("taxes d:soonish", NOW)).toMatchObject({ text: "taxes", deadline: "soonish" });
    expect(parseAdd("taxes w:whenever", NOW)).toEqual({ text: "taxes w:whenever", tags: [], urgent: false });
    expect(parseAdd("taxes d:fri d:mon", NOW)).toMatchObject({ text: "taxes d:mon", deadline: "2026-09-25" });
  });
  test("the day in words at the end: one to three words, by/on/due included, a time after it left in the text, never with d: as well", () => {
    expect(parseAdd("call the bank tomorrow", NOW)).toMatchObject({ text: "call the bank", deadline: "2026-09-23", when: "tomorrow" });
    expect(parseAdd("renew passport next mon", NOW)).toMatchObject({ text: "renew passport", deadline: "2026-09-28", when: "next mon" });
    expect(parseAdd("taxes in 3 days", NOW)).toMatchObject({ text: "taxes", deadline: "2026-09-25", when: "in 3 days" });
    expect(parseAdd("dentist by 20 sep", NOW)).toMatchObject({ text: "dentist", deadline: "2026-09-20", when: "by 20 sep" });
    expect(parseAdd("call mum next mon 9am", NOW)).toMatchObject({ text: "call mum 9am", deadline: "2026-09-28" });
    expect(parseAdd("standup fri 14:00", NOW)).toMatchObject({ text: "standup 14:00", deadline: "2026-09-25" });
    expect(parseAdd("pay rent fri d:2026-10-01", NOW)).toMatchObject({ text: "pay rent fri", deadline: "2026-10-01" });
    expect(parseAdd("tomorrow", NOW)).toMatchObject({ text: "", deadline: "2026-09-23" });
  });
  test("what is not a day stays text: a month alone, a count, a word that starts a weekday but is not one", () => {
    for (const line of ["see you in may", "buy 3", "eat the sundae", "ask about the plan a", "sat on it"]) expect(parseAdd(line, NOW)).toEqual({ text: line, tags: [], urgent: false });
  });
});

describe("due and waits", () => {
  test("overdue in red with the days, today amber, tomorrow blue, the weekday within the week, the day beyond it, the year when not this one; a deadline that is not a day as written", () => {
    expect(due("2026-09-19", NOW)).toEqual({ text: "overdue 3 d", color: "red", days: -3 });
    expect(due("2026-09-21", NOW)).toEqual({ text: "overdue 1 d", color: "red", days: -1 });
    expect(due("2026-09-22", NOW)).toEqual({ text: "today", color: "amber", days: 0 });
    expect(due("2026-09-23", NOW)).toEqual({ text: "tomorrow", color: "blue", days: 1 });
    expect(due("2026-09-26", NOW)).toEqual({ text: "Sat", color: "grey", days: 4 });
    expect(due("2026-09-29", NOW)).toEqual({ text: "Tue 29 Sep", color: "grey", days: 7 });
    expect(due("2027-01-04", NOW)).toEqual({ text: "Mon 4 Jan 2027", color: "grey", days: 104 });
    expect(due("soonish", NOW)).toEqual({ text: "soonish", color: "grey", days: NaN });
    expect(due(undefined, NOW)).toBeUndefined();
  });
  test("waits names the day ahead, nothing once it has come", () => {
    expect(waits("2026-10-03", NOW)).toBe("from Sat 3 Oct");
    expect(waits("2026-09-22", NOW)).toBeUndefined();
    expect(waits("2026-09-01", NOW)).toBeUndefined();
    expect(waits("later", NOW)).toBeUndefined();
  });
  test("linkIn finds the first link, trailing punctuation off", () => {
    expect(linkIn("see https://github.com/x/y/pull/4, then https://a.b")).toBe("https://github.com/x/y/pull/4");
    expect(linkIn("no link here")).toBeUndefined();
  });
});
