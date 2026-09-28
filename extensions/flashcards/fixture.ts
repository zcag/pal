// Writes app/src/gallery/shots/flashcards.json: the store screenshots'
// fixture. The page keeps nothing: every screen is the extension's answer to
// `pal.send`, so the fixture runs the extension in the host harness over a
// data directory of its own (`PAL_FLASHCARDS_DIR`, a fixed one under /tmp) and
// records its replies. The data is six weeks of study of the bundled
// Spanish words, played out by srs.ts itself: each evening the day's queue
// answered (most right, a seeded few missed) until the goal, a streak to
// yesterday, then today's first answers until the card on top is the one a
// shot wants: a noun with its example, a production card whose answer has an
// accent, and the card that meets today's goal. A fourth directory has no
// pack in rotation yet (the first run). The voice is named in the settings,
// so the stats never ask this machine's `say` for its voices.
// `make shots EXT=flashcards`.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Host } from "../../host/test/harness.ts";
import { NOW, pinClock, seeded, writeFixture } from "../../app/scripts/fixture-kit.ts";
import { parsePack } from "./packs.ts";
import { DAY, answer, items, queue, stats, type Item } from "./srs.ts";
import type { Data } from "./store.ts";
import manifest from "./pal.json" with { type: "json" };

pinClock();
const SETTINGS = { new_per_day: 15, session: 10, goal: 20, retention: "0.9", typing: "reverse", speak: "key", voice: "Mónica", buttons: "two", sounds: true, suggest: true };
const S = { newPerDay: 15, goal: 20, retention: 0.9 };
const pack = parsePack("spanish-words.json", readFileSync(new URL("./packs/spanish-words.json", import.meta.url), "utf8"));
const all = items([pack]);
const r = seeded(11);

/** One answer to the card on top at `at`: right most of the time (a new card a little less), logged as the extension logs it. */
function study(d: Data, at: number, it = queue(all, d, at, S).next): Item | null {
  if (!it) return null;
  const m = d.cards[it.key];
  const rate = r() < (m ? 0.88 : 0.8) ? 3 : 1;
  d.cards[it.key] = answer(m, rate, at, S.retention);
  d.log.push([Math.round(at / 1000), it.key, rate, m?.st ?? 0, Math.round(2500 + r() * 6000)]);
  return it;
}

// Six weeks back to yesterday: an evening's session to the goal and a few past it; two days missed early on, then a streak.
const data: Data = { v: 1, cards: {}, log: [], suspended: [], active: ["spanish-words"] };
for (let back = 42; back >= 1; back--) {
  if (back === 30 || back === 19) continue;
  let at = new Date(NOW - back * DAY).setHours(20, 10, 0, 0);
  const n = 20 + Math.floor(r() * 9);
  for (let k = 0; k < n && study(data, at); k++) at += 9_000 + Math.floor(r() * 7_000);
}
/** Today's answers, the card on top now answered each time, until `ok` says it is the shot's (or `max` answers in); the answers a few seconds apart up to a moment ago. */
function today(d: Data, ok: (it: Item, answered: number) => boolean, max = 19): Data {
  const out = structuredClone(d);
  for (let k = 0; k <= max; k++) {
    const top = queue(all, out, NOW, S).next!;
    if (ok(top, stats(out, all, NOW, S.goal).todayAnswers)) return out;
    study(out, NOW - (max + 1 - k) * 12_000, top);
  }
  throw new Error("flashcards: today never brought the shot's card");
}
const noun = (it: Item) => !it.reverse && /^noun/.test(it.card.note ?? "") && !!it.card.example;
const card = today(data, (it, n) => n >= 6 && noun(it));
const typed = today(data, (it, n) => n >= 4 && it.reverse && /[áéíóú]/.test(it.card.front) && !/ /.test(it.card.front));
const goal = today(data, (_it, n) => n === 19);

/** The extension over `d`: its replies to the page's opening call and to `asks`, recorded. */
async function replies(d: Data, asks: Record<string, unknown>[] = []) {
  // One fixed place (the first-run screen's reply names its packs folder), emptied each time.
  const dir = "/tmp/pal-flashcards-fixture";
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "progress.json"), JSON.stringify(d));
  process.env.PAL_FLASHCARDS_DIR = dir;
  const host = await Host.bundled({ settings: { flashcards: { settings: SETTINGS } } });
  try {
    const send = [];
    for (const msg of [{ op: "open" }, ...asks]) send.push({ msg, reply: await host.surfaceSend("flashcards", "flashcards", msg) });
    return { send, view: await host.request("view", { extension: "flashcards", palette: "flashcards" }) };
  } finally {
    host.kill();
    rmSync(dir, { recursive: true, force: true });
  }
}
const topOf = (d: Data) => queue(all, d, NOW, S).next!;

const a = await replies(card, [{ op: "stats" }]);
const b = await replies(typed);
// The goal's answer is matched on the card and the rating: the page's `ms` is its own.
const c = await replies(goal, [{ op: "answer", key: topOf(goal).key, rating: 3 }]);
const w = await replies({ ...data, active: null });
const palette = (x: typeof a) => ({ title: manifest.title, icon: manifest.icon, view: "view", tree: x.view, surface: { storage: {}, settings: SETTINGS, send: x.send } });
// The production card's answer typed without its accent: the page counts it and shows where.
const bare = topOf(typed).card.front.normalize("NFD").replace(/[̀-ͯ]/g, "");
// The goal's card turned over as it asks: a production card typed (right), a recognition card flipped.
const g = topOf(goal), turn = g.reverse ? [`type:${g.card.front}`, "wait:200", "enter"] : ["space"];
writeFixture("flashcards", {
  palettes: { card: palette(a), typed: palette(b), goal: palette(c), welcome: palette(w) },
  shots: {
    "1-card": { palette: "card", keys: ["wait:1500", "space", "wait:900"], caption: "A card turned over: the meaning, an example with the word marked, the article coloured by gender, and when each answer brings it back" },
    "2-typed": { palette: "typed", keys: ["wait:1500", `type:${bare}`, "wait:200", "enter", "wait:900"], caption: "The other way, typed: an accent left off counts, and shows where" },
    "3-goal": { palette: "goal", keys: ["wait:1500", ...turn, "wait:600", "right", "wait:1600"], caption: "The day's twentieth card: the goal met, the streak goes on" },
    "4-stats": { palette: "card", keys: ["wait:1500", "type:s", "wait:1200"], caption: "Stats: the streak, the heatmap, the week ahead, each pack" },
    "5-welcome": { palette: "welcome", keys: ["wait:1500"], caption: "The first run: pick the packs to practise, or bring your own" },
  },
});
console.log(`flashcards: card ${topOf(card).key}, typed ${topOf(typed).key} as "${bare}", goal ${topOf(goal).key}, ${data.log.length} answers before today`);
