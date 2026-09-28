// Writes app/src/gallery/shots/typing.json: the store screenshots'
// fixture. The page keeps the options ("config") and the records
// ("records") in storage; the records are two months of tests filed one by
// one through typing.ts's own `file` (a speed that climbs from the high
// fifties to the high seventies, with a seeded day-to-day wobble), so the
// stats page, the bests and the history are what the page would have kept.
// The tests type the words the page will deal (its Math.random is seeded in
// every frame by the shots) at a steady human pace, a key every 105 to 185
// ms, with a slip or two.
// `make shots EXT=typing`.
import { Host, stored } from "../../host/test/harness.ts";
import { NOW, pinClock, seeded, writeFixture } from "../../app/scripts/fixture-kit.ts";
import { configOf, file, newRun, noRecords, type Config, type Records, type Result } from "./typing.ts";
import manifest from "./pal.json" with { type: "json" };

/** The kinds of test taken, and how often: time 30 most, the rest now and then. */
const KINDS: [string, number, number][] = [["time 30", 30, 0.45], ["time 60", 60, 0.2], ["time 15", 15, 0.12], ["words 25", 0, 0.13], ["words 50 punctuation", 0, 0.06], ["zen", 0, 0.04]];
pinClock();
const rng = seeded(7);
const DAY = 86_400_000;
let records: Records = noRecords();
const N = 140;
// Two months back to the day before the fixture's, a few tests an evening between seven and eleven, in order.
const ats = Array.from({ length: N }, (_, i) => new Date(NOW - Math.max(1, Math.round(((N - i) / N) * 58)) * DAY).setHours(19, 0, 0, 0) + Math.round(rng() * 4 * 3_600_000)).sort((a, b) => a - b);
for (let i = 0; i < N; i++) {
  const at = ats[i];
  let r = rng(), kind = KINDS[0];
  for (const k of KINDS) { if (r < k[2]) { kind = k; break; } r -= k[2]; }
  const [key, time] = kind;
  const words = key.startsWith("words") ? Number(key.split(" ")[1]) : 0;
  const base = 57 + (21 * i) / N - (key.includes("punctuation") ? 9 : 0) - (time === 60 ? 3 : 0) + (time === 15 ? 4 : 0);
  const wpm = Math.round((base + (rng() - 0.5) * 11) * 100) / 100;
  const acc = Math.round((93 + rng() * 6.5) * 100) / 100;
  const secs = time || Math.round((words ? words * 5.6 / wpm * 12 : 40 + rng() * 60) * 100) / 100;
  const res: Result = { at, key, wpm, raw: Math.round(wpm * (1 + (100 - acc) / 80) * 100) / 100, acc, consistency: Math.round((68 + rng() * 17) * 100) / 100, chars: [0, 0, 0, 0], secs, samples: [] };
  records = file(records, res).records;
}

const zen: Config = configOf({ mode: "zen" }), timed: Config = configOf({ mode: "time", time: 30 }), ten: Config = configOf({ mode: "words", words: 10 });

// The page deals its words with Math.random on opening, and the shots seed it in every frame with fixture-kit's
// seeded(42) (shots.mjs): nothing else in the page draws first, so these are the words it will show.
const dealt = (c: Config) => newRun(c, seeded(42)).words;
const jitter = seeded(3);
/** Keys for typing `words` at a steady hand, a key every 105 to 185 ms: `slip` puts a wrong letter in word i at letter j (`fix`: taken back at once). */
function typist(words: string[], slips: { word: number; at: number; wrong: string; fix: boolean }[]): string[] {
  const keys: string[] = [];
  words.forEach((w, i) => {
    [...w].forEach((ch, j) => {
      const slip = slips.find((x) => x.word === i && x.at === j);
      if (slip) {
        keys.push(`type:${slip.wrong}`, `wait:${105 + Math.round(jitter() * 80)}`);
        if (!slip.fix) return;
        keys.push("backspace", `wait:${180 + Math.round(jitter() * 90)}`);
      }
      keys.push(`type:${ch}`, `wait:${105 + Math.round(jitter() * 80)}`);
    });
    if (i < words.length - 1) keys.push("type: ", `wait:${120 + Math.round(jitter() * 90)}`);
  });
  return keys;
}
const mid = dealt(timed).slice(0, 6), test = dealt(ten);
const wrongFor = (ch: string) => (ch === "e" ? "r" : "e");

const host = await Host.bundled();
try {
  const palette = async (config: Config, clock = true) => {
    stored.set("typing\0config", config);
    const view = await host.request("view", { extension: "typing", palette: "typing" });
    return { title: manifest.title, icon: manifest.icon, view: "view", tree: view, surface: { storage: { config, records }, settings: { pace_caret: "off", stop_on_error: "off", clock } } };
  };
  // The stats page is a ⌘K action (in the test, S is a letter to type).
  const stats = ["wait:1200", "cmd+k", "wait:300", "type:stats", "wait:300", "enter", "wait:900"];
  writeFixture("typing", {
    palettes: { test: await palette(timed), ten: await palette(ten), zen: await palette(zen, false), stats: await palette(timed) },
    shots: {
      "1-test": { palette: "test", keys: ["wait:1200", ...typist(mid, [{ word: 3, at: 1, wrong: wrongFor(mid[3][1]), fix: false }]), "wait:300"], caption: "Mid-test: the caret on the next letter, a slip in red, the seconds left above" },
      "2-result": { palette: "ten", keys: ["wait:1200", ...typist(test, [{ word: 2, at: 1, wrong: wrongFor(test[2][1]), fix: true }, { word: 6, at: 2, wrong: wrongFor(test[6][2]), fix: false }]), "wait:1500"], caption: "The result: wpm and accuracy, the test second by second, a new best for ten words" },
      "3-zen": { palette: "zen", keys: ["wait:1200", "type:the quiet hour before anyone else is awake is when the words come", "wait:700"], caption: "Zen: no words to follow, the caret after whatever you type; Enter ends it and scores it" },
      "4-stats": { palette: "stats", keys: stats, caption: "Stats: the figures, and the progress chart with its average of ten" },
      "5-history": { palette: "stats", keys: [...stats, "down*4", "wait:900"], caption: "Further down: the personal best at every length, and every test taken, newest first" },
    },
  });
  console.log(`typing: ${records.tests} tests; mid-test ${mid.join(" ")}; ten ${test.join(" ")}`);
} finally {
  host.kill();
}
