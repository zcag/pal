// Typing: the test (typing.ts, pure) driven key by key with pinned times:
// what a key does to the run, backspace's rules, wpm, raw, accuracy,
// consistency and the letter counts, the seconds the chart draws, the
// records; the words (words.ts) with their dress; the options as the view
// offers them; and the extension over the wire, a view palette whose view
// is one `surface`. The page (surface/) is browser code and is not run here.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  DEFAULTS, MAX_EXTRA, backspace, configOf, configure, endZen, file, optionsOf, paceAt, paceWpm, settingOf, good, keyLabel, kinds, label, missed, modeKey, newRun, noRecords, recent, recordsOf, refill, result, rolling, summary, titleOf,
  typeChar, typeSpace, viewActions, type Config, type Run,
} from "../../../extensions/typing/typing.ts";
import { WORDS, generate } from "../../../extensions/typing/words.ts";
import type { View } from "../../../sdk/src/protocol.ts";
import { Host, stored } from "../harness.ts";

/** A seeded rng (mulberry32), so a draw is the same every run. */
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const cfg = (c: Partial<Config> = {}): Config => ({ ...DEFAULTS, ...c });
/** Types `text` into the run, one key every `every` ms from `from`; a space is a space. Returns the time after. */
function keys(run: Run, text: string, from = 0, every = 100): number {
  let t = from;
  for (const ch of text) {
    if (ch === " ") typeSpace(run, t);
    else typeChar(run, ch, t);
    t += every;
  }
  return t;
}

describe("the words", () => {
  test("a word list of common lower-case words, no repeats", () => {
    expect(WORDS.length).toBeGreaterThan(200);
    expect(new Set(WORDS).size).toBe(WORDS.length);
    expect(WORDS.every((w) => /^[a-z]+$/.test(w))).toBe(true);
  });
  test("plain: words from the list, never the same twice in a row", () => {
    const ws = generate(500, { punctuation: false, numbers: false }, seeded(1));
    expect(ws).toHaveLength(500);
    expect(ws.every((w) => WORDS.includes(w))).toBe(true);
    expect(ws.some((w, i) => i > 0 && w === ws[i - 1])).toBe(false);
  });
  test("punctuation: sentences, a capital after each end, commas and the rest", () => {
    const ws = generate(400, { punctuation: true, numbers: false }, seeded(2));
    expect(ws[0][0]).toMatch(/[A-Z("]/);
    ws.forEach((w, i) => { if (i > 0 && /[.?!]$/.test(ws[i - 1]) && w !== "-") expect(w).toMatch(/^["(]?[A-Z]/); });
    const all = ws.join(" ");
    for (const mark of [",", ".", "\"", "-"]) expect(all).toContain(mark);
  });
  test("numbers: some words are 1 to 4 digits", () => {
    const nums = generate(400, { punctuation: false, numbers: true }, seeded(3)).filter((w) => /^\d+$/.test(w));
    expect(nums.length).toBeGreaterThan(20);
    expect(nums.every((n) => n.length <= 4 && n[0] !== "0")).toBe(true);
  });
  test("a words test with punctuation ends a sentence", () => {
    const run = newRun(cfg({ mode: "words", words: 10, punctuation: true }), seeded(4));
    expect(run.words).toHaveLength(10);
    expect(run.words[9]).toMatch(/[.?!,;:")]$/);
  });
  test("a time test keeps words ahead of the one in progress", () => {
    const run = newRun(cfg(), seeded(5));
    const n = run.words.length;
    expect(refill(run, seeded(6))).toBe(0);
    run.at = n - 10;
    expect(refill(run, seeded(6))).toBeGreaterThan(0);
    expect(run.words.length - run.at).toBeGreaterThan(50);
  });
});

describe("a run, key by key", () => {
  test("letters fill the word, a space moves on; a space at the start of a word does nothing", () => {
    const run = newRun(cfg(), undefined, ["the", "cat", "sat"]);
    expect(typeSpace(run, 0)).toBe(false);
    keys(run, "the ca");
    expect(run.typed).toEqual(["the", "ca"]);
    expect(run.at).toBe(1);
    expect(good(run)).toBe(6);
  });
  test("a wrong word stays wrong and counts nothing; the word in progress counts while it is right", () => {
    const run = newRun(cfg(), undefined, ["the", "cat", "sat"]);
    keys(run, "teh cax");
    expect(missed(run, 0)).toBe(true);
    expect(good(run)).toBe(0);
    backspace(run);
    expect(good(run)).toBe(2);
  });
  test("extra letters are taken up to MAX_EXTRA", () => {
    const run = newRun(cfg(), undefined, ["a", "b"]);
    keys(run, "a" + "x".repeat(MAX_EXTRA + 5));
    expect(run.typed[0]).toHaveLength(1 + MAX_EXTRA);
  });
  test("backspace goes back into a word left wrong, not into a right one; alt takes the whole word", () => {
    const run = newRun(cfg(), undefined, ["the", "cat", "sat", "on"]);
    keys(run, "the cta ");
    expect(run.at).toBe(2);
    expect(backspace(run)).toBe(true);
    expect(run.at).toBe(1);
    expect(run.typed).toEqual(["the", "cta"]);
    backspace(run, true);
    expect(run.typed).toEqual(["the", ""]);
    expect(backspace(run)).toBe(false);
    expect(run.at).toBe(1);
  });
  test("a words test ends on the last word typed right, or a space on it", () => {
    const a = newRun(cfg({ mode: "words", words: 10 }), undefined, ["to", "be"]);
    keys(a, "to b");
    expect(a.over).toBe(false);
    keys(a, "e");
    expect(a.over).toBe(true);
    expect(typeChar(a, "x", 0)).toBe(false);
    const b = newRun(cfg({ mode: "words", words: 10 }), undefined, ["to", "be"]);
    keys(b, "to bx ");
    expect(b.over).toBe(true);
  });
});

describe("stop on error", () => {
  test("letter: a wrong letter is refused but counts against accuracy", () => {
    const run = newRun(cfg(), undefined, ["cat", "dog"], "letter");
    keys(run, "c");
    expect(typeChar(run, "x", 100)).toBe("blocked");
    expect(run.typed[0]).toBe("c");
    keys(run, "at dog", 200);
    expect(run.typed).toEqual(["cat", "dog"]);
    expect(result(run, 1000).acc).toBeCloseTo(100 * 7 / 8, 1);
  });
  test("word: a wrong word cannot be left with space until it is fixed", () => {
    const run = newRun(cfg(), undefined, ["cat", "dog"], "word");
    keys(run, "cst");
    expect(typeSpace(run, 300)).toBe("blocked");
    expect(run.at).toBe(0);
    backspace(run); backspace(run);
    keys(run, "at ", 400);
    expect(run.at).toBe(1);
  });
});

describe("zen", () => {
  test("every word is what was typed: always right, Backspace edits across words, Enter ends it", () => {
    const run = newRun(cfg({ mode: "zen" }));
    expect(run.words).toEqual([""]);
    expect(endZen(run)).toBe(false);
    keys(run, "hi there ");
    expect(run.words).toEqual(["hi", "there", ""]);
    expect(backspace(run)).toBe(true);
    expect(run.at).toBe(1);
    expect(run.words).toEqual(["hi", "there"]);
    backspace(run);
    keys(run, "y", 900);
    expect(run.words).toEqual(["hi", "thery"]);
    expect(endZen(run)).toBe(true);
    const r = result(run, 1000);
    expect(r.acc).toBe(100);
    expect(r.key).toBe("zen");
    expect(r.wpm).toBe(r.raw);
  });
});

describe("the pace caret", () => {
  test("where a typist at the pace would be: 60 wpm is 5 characters a second", () => {
    const ws = ["abcd", "ef", "g"];
    expect(paceAt(ws, 60, 0)).toEqual({ word: 0, letter: 0, frac: 0 });
    expect(paceAt(ws, 60, 500)).toEqual({ word: 0, letter: 2, frac: 0.5 });
    // "abcd " is 5: one second in, the start of "ef".
    expect(paceAt(ws, 60, 1000)).toEqual({ word: 1, letter: 0, frac: 0 });
    expect(paceAt(ws, 60, 1500)).toEqual({ word: 1, letter: 2, frac: 0.5 });
    expect(paceAt(ws, 60, 60000)).toEqual({ word: 2, letter: 1, frac: 0 });
  });
  test("the speed it keeps: the best, the average of ten, the last; none to race, or in zen, nothing", () => {
    let r = noRecords();
    for (const w of [50, 70, 60]) r = file(r, { ...result(newRun(cfg(), undefined, ["a"]), 1000, w), wpm: w, key: "time 30", invalid: undefined }).records;
    expect(paceWpm(r, "time 30", "pb")).toBe(70);
    expect(paceWpm(r, "time 30", "average")).toBe(60);
    expect(paceWpm(r, "time 30", "last")).toBe(60);
    expect(paceWpm(r, "time 30", "off")).toBeUndefined();
    expect(paceWpm(r, "words 25", "pb")).toBeUndefined();
    expect(paceWpm(r, "zen", "last")).toBeUndefined();
  });
});

describe("the result", () => {
  test("wpm counts right words and their spaces; raw every character; per minute over five", () => {
    const run = newRun(cfg(), undefined, ["hello", "world", "again"]);
    keys(run, "hello wrold ag");
    // Right: "hello " 6 + "ag" 2 = 8 chars in 12 s → 8/5 × 5 = 8 wpm. Raw: 6 + 6 + 2 = 14 → 14 wpm.
    const r = result(run, 12000, 0);
    expect(r.wpm).toBe(8);
    expect(r.raw).toBe(14);
    expect(r.chars).toEqual([10, 2, 0, 0]);
  });
  test("accuracy counts a fixed mistake against it", () => {
    const run = newRun(cfg(), undefined, ["abcd", "e"]);
    keys(run, "abx");
    backspace(run);
    keys(run, "cd", 300);
    // 5 keys, 1 wrong.
    expect(result(run, 1000).acc).toBe(80);
  });
  test("missed letters count only in words moved past; extra letters count", () => {
    const run = newRun(cfg(), undefined, ["house", "cat", "dog"]);
    keys(run, "hou catss do");
    expect(result(run, 3000).chars).toEqual([3 + 3 + 2, 0, 2, 2]);
  });
  test("the seconds: the wpm so far, each second's raw speed, its mistakes; a last part-second under half joins the one before", () => {
    const run = newRun(cfg(), undefined, ["aaaa", "bbbb", "cccc"]);
    keys(run, "aaaa b", 0, 200); // 6 keys at 0..1000 ms: 5 in second 1, 1 in second 2
    keys(run, "xbb", 1200, 100); // 1200, 1300, 1400: the x is wrong
    const r = result(run, 2300);
    expect(r.samples).toHaveLength(2);
    expect(r.samples[0]).toEqual({ wpm: 60, raw: 60, errors: 0 });
    expect(r.samples[1].errors).toBe(1);
    // Second 2 runs to the end (2.3 s): 4 keys in 1.3 s.
    expect(r.samples[1].raw).toBeCloseTo((4 / 5) * (60 / 1.3), 1);
  });
  test("consistency: 100 for an even pace, lower for an uneven one", () => {
    const even = newRun(cfg(), undefined, ["abcd", "abcd", "abcd", "abcd"]);
    keys(even, "abcd abcd ab", 0, 250);
    expect(result(even, 3000).consistency).toBe(100);
    const uneven = newRun(cfg(), undefined, ["abcd", "abcd", "abcd", "abcd"]);
    keys(uneven, "abcd abcd", 0, 100);
    keys(uneven, " ab", 2500, 100);
    expect(result(uneven, 3000).consistency).toBeLessThan(60);
  });
  test("mashed keys do not count", () => {
    const run = newRun(cfg(), undefined, ["the", "cat"]);
    keys(run, "xqz wpo");
    expect(result(run, 2000).invalid).toMatch(/accuracy/);
  });
});

describe("the records", () => {
  const res = (wpm: number, key = "time 30", invalid?: string) => ({ ...result(newRun(cfg(), undefined, ["a"]), 1000, 1), wpm, key, invalid });
  test("the first test is the best; a slower one is not; an invalid one changes nothing", () => {
    let r = noRecords();
    let f = file(r, res(80));
    expect(f.best).toBe(true);
    r = f.records;
    f = file(r, res(70));
    expect(f.best).toBe(false);
    expect(f.prev?.wpm).toBe(80);
    r = f.records;
    expect(r.tests).toBe(2);
    expect(file(r, res(99, "time 30", "accuracy under 75%")).records).toBe(r);
    expect(recent(r, "time 30")).toEqual({ wpm: 75, count: 2 });
    expect(recent(r, "time 60")).toEqual({ wpm: 0, count: 0 });
  });
  test("bests are kept per kind of test", () => {
    const r = file(file(noRecords(), res(80)).records, res(50, "words 25")).records;
    expect(Object.keys(r.best).sort()).toEqual(["time 30", "words 25"]);
  });
  test("stored records and options are checked; anything else starts afresh", () => {
    expect(recordsOf({ nope: 1 })).toEqual(noRecords());
    expect(configOf({ mode: "words", words: 7, time: 60, numbers: true })).toEqual({ mode: "words", time: 60, words: DEFAULTS.words, punctuation: false, numbers: true });
    expect(configOf(null)).toEqual(DEFAULTS);
  });
});

describe("the stats", () => {
  const past = (key: string, wpm: number, acc = 95, secs = 30) => ({ at: wpm, key, wpm, raw: wpm + 5, acc, consistency: 80, secs });
  const rec = { best: {}, history: [past("zen", 40), past("words 25", 60), past("time 30", 70, 90), past("time 15 punctuation", 50), past("time 30", 90, 100), past("time 15", 80)], tests: 5, secs: 150 };
  test("the kinds in the bar's order: time first, short before long, plain before dressed", () => {
    expect(kinds(rec)).toEqual(["time 15", "time 15 punctuation", "time 30", "words 25", "zen"]);
    expect(keyLabel("words 50 punctuation numbers")).toBe("words 50 · punctuation · numbers");
  });
  test("a summary of all tests, or of one kind", () => {
    expect(summary({ ...rec, history: rec.history.slice(1) })).toMatchObject({ tests: 5, secs: 150, best: 90, avg: 70, acc: 95 });
    expect(summary(rec, "time 30")).toMatchObject({ tests: 2, secs: 60, best: 90, avg: 80, avg10: 80, acc: 95 });
    expect(summary(noRecords())).toMatchObject({ tests: 0, best: 0, avg: 0 });
  });
  test("the rolling average: the mean of up to n values ending at each", () => {
    expect(rolling([10, 20, 30, 40], 2)).toEqual([10, 15, 25, 35]);
    expect(rolling([6, 6, 12], 10)).toEqual([6, 6, 8]);
  });
});

describe("the options", () => {
  test("the keys and the words", () => {
    expect(modeKey(cfg({ mode: "words", words: 50, punctuation: true, numbers: true }))).toBe("words 50 punctuation numbers");
    expect(label(cfg({ time: 60, numbers: true }))).toBe("time 60 · numbers");
    expect(titleOf(cfg())).toBe("Typing · time 30");
  });
  test("the view's actions: a new test first, the lengths not in use, the toggles", () => {
    const ids = viewActions(cfg()).map((a) => a.id);
    expect(ids.slice(0, 2)).toEqual(["restart", "stats"]);
    expect(ids).not.toContain("time:30");
    expect(ids).toContain("words:25");
    expect(ids.slice(ids.indexOf("zen"), ids.indexOf("zen") + 3)).toEqual(["zen", "punctuation", "numbers"]);
  });
  test("the settings as the view offers them: the values not in use, written by id", () => {
    const ids = viewActions(cfg(), { pace: "pb", stop: "off" }).map((a) => a.id);
    expect(ids).toContain("zen");
    expect(ids).toEqual(expect.arrayContaining(["pace:off", "pace:average", "pace:last", "stop:letter", "stop:word"]));
    expect(ids).not.toContain("pace:pb");
    expect(ids).not.toContain("stop:off");
    expect(viewActions(cfg({ mode: "zen" })).map((a) => a.id)).not.toContain("zen");
    expect(settingOf("pace:average")).toEqual({ pace_caret: "average" });
    expect(settingOf("stop:word")).toEqual({ stop_on_error: "word" });
    expect(settingOf("pace:fast")).toBeUndefined();
    expect(optionsOf({ pace_caret: "last", stop_on_error: "nope" })).toEqual({ pace: "last", stop: "off" });
  });
  test("an action applied", () => {
    expect(configure(cfg(), "zen")).toMatchObject({ mode: "zen" });
    expect(modeKey(cfg({ mode: "zen", punctuation: true }))).toBe("zen");
    expect(configure(cfg(), "words:100")).toMatchObject({ mode: "words", words: 100 });
    expect(configure(cfg(), "time:15")).toMatchObject({ mode: "time", time: 15 });
    expect(configure(cfg(), "punctuation").punctuation).toBe(true);
    expect(configure(cfg(), "time:7")).toEqual(cfg());
  });
});

describe("over the wire", () => {
  let host: Host;
  beforeAll(async () => { stored.clear(); host = await Host.bundled(); });
  afterAll(() => host.kill());

  test("view answers the test: one surface, the actions and the title for the stored options", async () => {
    const v = await host.request<View>("view", { extension: "typing", palette: "typing" });
    expect(v.tree).toMatchObject({ type: "surface", src: "surface/index.html" });
    expect(v.title).toBe("Typing · time 30");
    expect(v.actions[0].id).toBe("restart");
  });
  test("the page's `moved` pushes the actions and the title for the saved options", async () => {
    stored.set("typing\0config", { mode: "words", words: 50, punctuation: true });
    const push = host.surfaceSend("typing", "typing", { moved: true });
    const u = await host.nextViewUpdate("typing", { palette: "typing" });
    await push;
    const spec = u.spec as View;
    expect(spec.title).toBe("Typing · words 50 · punctuation");
    expect(spec.actions.map((a) => a.id)).toContain("punctuation");
    expect(spec.actions.find((a) => a.id === "punctuation")?.title).toBe("Punctuation off");
  });
  test("the page's `set` writes the setting a ⌘K pick names, and the actions follow", async () => {
    const push = host.surfaceSend("typing", "typing", { set: "pace:pb" });
    const u = await host.nextViewUpdate("typing", { palette: "typing" });
    await push;
    expect(host.written.get("typing")).toEqual({ pace_caret: "pb" });
    const ids = (u.spec as View).actions.map((a) => a.id);
    expect(ids).not.toContain("pace:pb");
    expect(ids).toContain("pace:off");
    await host.surfaceSend("typing", "typing", { set: "pace_caret" });
    expect(host.written.get("typing")).toEqual({ pace_caret: "pb" });
  });
});
