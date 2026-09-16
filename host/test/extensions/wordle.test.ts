// Wordle: the rules (game.ts, pure) on rigged games, the word lists and
// the daily pick (words.ts), the tree (render.ts), and the extension over
// the wire: a view palette's meta, its opening tree, picks that type,
// submit and persist the game and the stats, the settings.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { COLS, DEFAULTS, ROWS, actions, apply, hardModeError, isState, isValid, keyMarks, mark, share, stats0, sync, type Game, type State } from "../../../extensions/wordle/game.ts";
import { render } from "../../../extensions/wordle/render.ts";
import { ALLOWED, ANSWERS, STRIDE, dailyAnswer, dayOf } from "../../../extensions/wordle/words.ts";
import type { View, ViewNode } from "../../../sdk/src/protocol.ts";
import { checkView } from "../../../sdk/src/view.ts";
import { Host, stored } from "../harness.ts";

const TODAY = 100;
const game = (answer: string, extra: Partial<Game> = {}): Game => ({ answer, guesses: [], day: TODAY, hard: false, input: "", status: "play", ...extra });
const state = (g: Game, stats = stats0()): State => ({ game: g, stats });
/** Types a word and submits it. */
const guess = (st: State, word: string, s = DEFAULTS) => apply(word.split("").reduce((x, l) => apply(x, l as never, s, TODAY), st), "submit", s, TODAY);

describe("marks", () => {
  const m = (g: string, a: string) => mark(g, a).map((x) => x[0]).join("");
  test("correct in place, present elsewhere, absent otherwise", () => {
    expect(m("crane", "crane")).toBe("ccccc");
    expect(m("slate", "crane")).toBe("aacac");
    expect(m("nacre", "crane")).toBe("ppppc");
  });
  test("a duplicate letter is present only as often as the answer has it", () => {
    expect(m("eerie", "crane")).toBe("aapac");
    expect(m("eerie", "eerie")).toBe("ccccc");
    expect(m("geese", "eerie")).toBe("acpac");
    expect(m("allay", "llama")).toBe("pcppa");
    expect(m("abbey", "babes")).toBe("ppcca");
    expect(m("sassy", "class")).toBe("ppaca");
  });
  test("the keyboard keeps the best mark per letter", () => {
    const g = game("crane", { guesses: ["slate", "trace"] });
    expect(keyMarks(g)).toEqual({ s: "absent", l: "absent", a: "correct", t: "absent", e: "correct", r: "correct", c: "present" });
  });
});

describe("words", () => {
  test("the lists: five lower-case letters, the answers allowed, a valid and an invalid word", () => {
    expect(ANSWERS.length).toBeGreaterThan(2000);
    expect(ALLOWED.size).toBeGreaterThan(8000);
    expect(ANSWERS.every((w) => /^[a-z]{5}$/.test(w))).toBe(true);
    expect([...ALLOWED].every((w) => /^[a-z]{5}$/.test(w))).toBe(true);
    expect(ANSWERS.every((w) => ALLOWED.has(w))).toBe(true);
    expect(isValid("crane")).toBe(true);
    expect(isValid("crxne")).toBe(false);
    expect(new Set(ANSWERS).size).toBe(ANSWERS.length);
  });
  test("the daily walks a permutation of the answers: no repeat before every word has come up", () => {
    const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
    expect(gcd(STRIDE, ANSWERS.length)).toBe(1);
    const seen = new Set<string>();
    for (let d = 0; d < ANSWERS.length; d++) seen.add(dailyAnswer(d));
    expect(seen.size).toBe(ANSWERS.length);
    expect(dailyAnswer(5)).toBe(dailyAnswer(5));
    expect(dailyAnswer(5)).not.toBe(dailyAnswer(6));
    expect(dailyAnswer(-1)).toBe(ANSWERS[ANSWERS.length - STRIDE]);
  });
  test("the day index is the local calendar day since 2026-01-01", () => {
    expect(dayOf(new Date(2026, 0, 1, 0, 30))).toBe(0);
    expect(dayOf(new Date(2026, 0, 1, 23, 59))).toBe(0);
    expect(dayOf(new Date(2026, 0, 2, 0, 1))).toBe(1);
    expect(dayOf(new Date(2026, 8, 16))).toBe(258);
  });
});

describe("playing", () => {
  test("letters fill the row to five, delete takes one back, Enter needs a full valid word", () => {
    let st = state(game("crane"));
    st = apply(st, "c", DEFAULTS, TODAY);
    st = apply(st, "r", DEFAULTS, TODAY);
    expect(st.game.input).toBe("cr");
    expect(apply(st, "submit", DEFAULTS, TODAY).notice).toEqual({ text: "Not enough letters", n: 1 });
    st = apply(st, "delete", DEFAULTS, TODAY);
    expect(st.game.input).toBe("c");
    expect(apply(state(game("crane")), "delete", DEFAULTS, TODAY).game.input).toBe("");
    const full = "crxne".split("").reduce((x, l) => apply(x, l as never, DEFAULTS, TODAY), state(game("crane")));
    expect(full.game.input).toBe("crxne");
    expect(apply(full, "z", DEFAULTS, TODAY).game.input).toBe("crxne");
    const bad = apply(full, "submit", DEFAULTS, TODAY);
    expect(bad.notice).toEqual({ text: "Not in word list", n: 1 });
    expect(bad.game.input).toBe("crxne");
    expect(apply(bad, "submit", DEFAULTS, TODAY).notice!.n).toBe(2);
    expect(apply(bad, "delete", DEFAULTS, TODAY).notice).toBeUndefined();
  });
  test("a valid guess is recorded, the answer wins, six misses lose", () => {
    const one = guess(state(game("crane")), "slate");
    expect(one.game.guesses).toEqual(["slate"]);
    expect(one.game.status).toBe("play");
    expect(one.stats.played).toBe(0);
    const won = guess(one, "crane");
    expect(won.game.status).toBe("won");
    expect(won.stats).toMatchObject({ played: 1, won: 1, streak: 1, best: 1, dist: [0, 1, 0, 0, 0, 0], lastDay: TODAY });
    expect(actions(won, DEFAULTS)).toEqual(["copy", "new"]);
    expect(apply(won, "a", DEFAULTS, TODAY)).toBe(won);
    let lost = state(game("crane"));
    for (const w of ["slate", "brick", "pound", "shady", "flung", "mound"]) lost = guess(lost, w);
    expect(lost.game.status).toBe("lost");
    expect(lost.game.guesses).toHaveLength(ROWS);
    expect(lost.stats).toMatchObject({ played: 1, won: 0, streak: 0, dist: [0, 0, 0, 0, 0, 0] });
  });
  test("hard mode: greens stay in place, ambers must be used; a game keeps the mode it started with", () => {
    const g = game("crane", { guesses: ["trace"], hard: true });
    expect(hardModeError("crane", g)).toBeNull();
    expect(hardModeError("brace", g)).toBeNull();
    expect(hardModeError("grave", g)).toBe("Guess must contain C");
    expect(hardModeError("track", g)).toBe("5th letter must be E");
    expect(hardModeError("plate", g)).toBe("2nd letter must be R");
    expect(hardModeError("cream", g)).toBe("3rd letter must be A");
    const dup = game("eerie", { guesses: ["geese"], hard: true });
    expect(hardModeError("reeve", dup)).toBeNull();
    expect(hardModeError("verse", dup)).toBe("Guess must contain E");
    const hard = guess(state(g), "grave", { ...DEFAULTS, hard_mode: true });
    expect(hard.notice!.text).toBe("Guess must contain C");
    expect(guess(state(game("crane", { guesses: ["trace"] })), "grave", { ...DEFAULTS, hard_mode: true }).game.guesses).toEqual(["trace", "grave"]);
    expect(guess(state(g), "grave", { ...DEFAULTS, hard_mode: false }).notice!.text).toBe("Guess must contain C");
  });
  test("the streak counts wins in a row and a skipped day breaks it", () => {
    const stats = { ...stats0(), played: 3, won: 3, streak: 3, best: 3, lastDay: TODAY - 1 };
    expect(guess(state(game("crane"), stats), "crane").stats).toMatchObject({ streak: 4, best: 4, lastDay: TODAY });
    const skipped = { ...stats, lastDay: TODAY - 2 };
    expect(guess(state(game("crane"), skipped), "crane").stats).toMatchObject({ streak: 1, best: 3 });
    const practiceWin = guess(state(game("crane", { day: null }), stats), "crane").stats;
    expect(practiceWin).toMatchObject({ streak: 4, lastDay: TODAY - 1, played: 4 });
  });
  test("New game: today's daily when it is unplayed, else a practice word; not offered mid-daily", () => {
    const mid = state(game("crane", { guesses: ["slate"] }));
    expect(actions(mid, DEFAULTS)).not.toContain("new");
    expect(apply(mid, "new", DEFAULTS, TODAY)).toBe(mid);
    const done = guess(mid, "crane");
    const practice = apply(done, "new", DEFAULTS, TODAY, () => 0);
    expect(practice.game).toMatchObject({ day: null, answer: ANSWERS[0], guesses: [], status: "play" });
    expect(practice.stats).toBe(done.stats);
    expect(actions(practice, DEFAULTS)).toContain("new");
    const tomorrow = apply(practice, "new", DEFAULTS, TODAY + 1);
    expect(tomorrow.game).toMatchObject({ day: TODAY + 1, answer: dailyAnswer(TODAY + 1) });
    const off = { ...DEFAULTS, daily: false };
    expect(actions(mid, off)).toContain("new");
    expect(apply(mid, "new", off, TODAY, () => 0.5).game.day).toBeNull();
  });
  test("opening on a new day starts that day's daily, unless a practice game is on or dailies are off", () => {
    const yesterday = state(game("crane", { day: TODAY - 1, guesses: ["slate"] }));
    expect(sync(yesterday, DEFAULTS, TODAY).game).toMatchObject({ day: TODAY, answer: dailyAnswer(TODAY), guesses: [] });
    const today = state(game("crane", { guesses: ["slate"] }));
    expect(sync(today, DEFAULTS, TODAY)).toBe(today);
    const practice = state(game("crane", { day: null, guesses: ["slate"] }));
    expect(sync(practice, DEFAULTS, TODAY)).toBe(practice);
    const practiceDone = state(game("crane", { day: null, guesses: ["crane"], status: "won" }));
    expect(sync(practiceDone, DEFAULTS, TODAY).game.day).toBe(TODAY);
    const doneToday = state(game("crane", { day: null, status: "won" }), { ...stats0(), lastDay: TODAY });
    expect(sync(doneToday, DEFAULTS, TODAY)).toBe(doneToday);
    expect(sync(yesterday, { ...DEFAULTS, daily: false }, TODAY)).toBe(yesterday);
  });
  test("the share text is the heading and the emoji grid", () => {
    const won = guess(guess(state(game("crane")), "slate"), "crane");
    expect(share(won.game)).toBe(`pal wordle #${TODAY + 1} 2/6\n\n⬜⬜🟩⬜🟩\n🟩🟩🟩🟩🟩`);
    const hardPractice = game("crane", { day: null, hard: true, guesses: ["trace"], status: "lost" });
    expect(share(hardPractice)).toBe("pal wordle practice X/6*\n\n⬜🟩🟩🟨🟩");
  });
  test("a stored state round-trips through JSON and a foreign one is refused", () => {
    const st = guess(state(game("crane")), "slate");
    const back = JSON.parse(JSON.stringify(st));
    expect(isState(back)).toBe(true);
    expect(guess(back, "crane").game.status).toBe("won");
    expect(isState({ game: { answer: "toolong" }, stats: stats0() })).toBe(false);
    expect(isState({ game: st.game })).toBe(false);
    expect(isState(null)).toBe(false);
  });
});

const find = (n: ViewNode, pred: (n: ViewNode) => boolean, out: ViewNode[] = []): ViewNode[] => {
  if (pred(n)) out.push(n);
  if (n.type === "stack") n.children.forEach((c) => find(c, pred, out));
  return out;
};
type TileNode = Extract<ViewNode, { type: "tile" }>;
type Stack = Extract<ViewNode, { type: "stack" }>;

describe("render", () => {
  test("thirty keyed tiles on a sunken well: a submitted row flips with a stagger, a typed letter pops, the keyboard follows the marks; the letters are hidden actions", () => {
    const st = apply(guess(state(game("crane")), "slate"), "c", DEFAULTS, TODAY);
    const v = checkView(render(st, DEFAULTS, TODAY));
    expect(v.keys).toBe("actions");
    expect(v.title).toBe(`Daily #${TODAY + 1}`);
    expect(find(v.tree, (n) => n.key === "board")[0]).toMatchObject({ surface: "sunken", radius: true, padding: 2 });
    const tiles = find(v.tree, (n) => n.type === "tile") as TileNode[];
    expect(tiles).toHaveLength(ROWS * COLS + 26);
    expect(find(v.tree, (n) => n.type === "image")).toHaveLength(0);
    expect(tiles[0]).toEqual({ type: "tile", key: "g00-sa", width: 48, height: 48, text: "S", color: "grey", fill: "solid", transition: { enter: "flip", exit: "none", delay: 0 } });
    expect(tiles[2]).toMatchObject({ key: "g02-ac", text: "A", color: "green", fill: "solid", transition: { enter: "flip", exit: "none", delay: 2 } });
    expect(tiles[5]).toMatchObject({ key: "i10-c", text: "C", color: "neutral", fill: "solid", transition: { enter: "pop", exit: "none" } });
    expect(tiles[6]).toEqual({ type: "tile", key: "e11", width: 48, height: 48, color: "neutral", fill: "outline", transition: { exit: "none" } });
    const keys = tiles.slice(ROWS * COLS);
    expect(keys.find((k) => k.text === "A")).toMatchObject({ key: "ka-correct", color: "green", fill: "solid", width: 32, height: 40 });
    expect(keys.find((k) => k.text === "Q")).toMatchObject({ key: "kq-none", color: "neutral", fill: "soft" });
    expect(v.actions.slice(0, 3).map((a) => [a.id, a.shortcut])).toEqual([["submit", "enter"], ["delete", "backspace"], ["a", "a"]]);
    expect(v.actions[2]).toEqual({ id: "a", title: "Type A", shortcut: "a", hidden: true });
    expect(v.actions.filter((a) => a.hidden)).toHaveLength(26);
    expect(v.actions.filter((a) => !a.hidden).map((a) => a.id)).toEqual(["submit", "delete"]);
    expect(v.actions.map((a) => a.id)).not.toContain("delete-alt");
    expect(find(v.tree, (n) => n.type === "keycap").map((n) => (n as { keys: string }).keys)).toEqual(["enter", "backspace"]);
    expect(find(v.tree, (n) => n.type === "badge")).toHaveLength(0);
  });
  test("a bad word is a red badge keyed by its count; hard mode is a badge and New game rides on cmd+n mid-practice", () => {
    const bad = apply(state(game("crane", { input: "crxne", day: null, hard: true })), "submit", { ...DEFAULTS, hard_mode: true }, TODAY);
    const v = checkView(render(bad, DEFAULTS, TODAY));
    const badges = find(v.tree, (n) => n.type === "badge") as Extract<ViewNode, { type: "badge" }>[];
    expect(badges.map((b) => [b.text, b.color, b.key])).toEqual([["hard", "amber", undefined], ["Not in word list", "red", "notice-1"]]);
    expect(v.title).toBe("Practice");
    expect(v.actions.slice(0, 3).map((a) => a.id)).toEqual(["submit", "delete", "new"]);
    expect(v.actions.find((a) => a.id === "new")).toEqual({ id: "new", title: "Today's puzzle", shortcut: "cmd+n" });
  });
  test("the result view: the praise, the stats with the distribution, copy on Enter and C, a practice game on N", () => {
    const stats = { played: 9, won: 8, streak: 2, best: 5, dist: [0, 2, 3, 2, 1, 0], lastDay: TODAY - 1 };
    const won = guess(guess(state(game("crane"), stats), "slate"), "crane");
    const v = checkView(render(won, DEFAULTS, TODAY));
    expect(v.title).toBe("Magnificent! 2/6");
    expect(v.actions).toEqual([{ id: "copy", title: "Copy the result", shortcut: "c" }, { id: "new", title: "Practice game", shortcut: "n" }]);
    const texts = find(v.tree, (n) => n.type === "text").map((n) => (n as { value: string }).value);
    expect(texts).toEqual(expect.arrayContaining(["10", "played", "90", "win %", "3", "streak", "5", "best", "Magnificent! 2/6"]));
    expect(find(v.tree, (n) => n.key === "stats")[0]).toMatchObject({ surface: "elevated", radius: true, padding: 3 });
    const bars = find(v.tree, (n) => n.type === "progress") as Extract<ViewNode, { type: "progress" }>[];
    expect(bars).toHaveLength(ROWS);
    // The winning row (two guesses) is the accent, the others grey; the bar is the share of the fullest row.
    expect(bars.map((b) => [b.value, b.width, b.color])).toEqual([[0, 96, "grey"], [1, 96, undefined], [1, 96, "grey"], [2 / 3, 96, "grey"], [1 / 3, 96, "grey"], [0, 96, "grey"]]);
    const counts = find(v.tree, (n) => n.type === "text" && n.width === 20) as Extract<ViewNode, { type: "text" }>[];
    expect(counts.map((t) => [t.value, t.color, t.align])).toEqual([["0", "muted", "end"], ["3", "accent", "end"], ["3", "muted", "end"], ["2", "muted", "end"], ["1", "muted", "end"], ["0", "muted", "end"]]);
    const lost = state(game("crane", { guesses: ["slate", "brick", "pound", "shady", "flung", "mound"], status: "lost" }));
    expect(render(lost, DEFAULTS, TODAY).title).toBe("The word was CRANE");
  });
});

describe("over the wire", () => {
  let host: Host;
  beforeAll(async () => { stored.clear(); host = await Host.bundled(); });
  afterAll(() => host.kill());

  test("a view palette is input on the wire with view: view", async () => {
    const l = host.loaded().find((l) => l.extension === "wordle")!;
    expect(l.palettes).toEqual([{ name: "wordle", title: "Wordle", live: false, input: true, icon: "🟩", view: "view", ttl: undefined, detail: undefined, columns: undefined, placeholder: undefined, showDetail: undefined, filters: undefined }]);
  });
  test("view answers today's daily and stores it with fresh stats", async () => {
    await expect(host.request("list", { extension: "wordle", palette: "wordle" })).rejects.toThrow("view palette has no list");
    const v = await host.request<View>("view", { extension: "wordle", palette: "wordle" });
    const today = dayOf();
    expect(v.title).toBe(`Daily #${today + 1}`);
    const g = stored.get("wordle\0game") as Game;
    expect(g).toMatchObject({ day: today, answer: dailyAnswer(today), guesses: [], status: "play" });
    expect(stored.get("wordle\0stats")).toEqual(stats0());
  });
  test("picks type, submit and persist the game; the win updates the stats; copy answers the share text", async () => {
    const today = dayOf();
    stored.set("wordle\0game", game("crane", { day: today }));
    for (const l of "slate") await host.pick("wordle", "wordle", "view", l);
    expect((stored.get("wordle\0game") as Game).input).toBe("slate");
    const one = await host.pick("wordle", "wordle", "view", "submit");
    expect((one.view as View).title).toBe(`Daily #${today + 1}`);
    expect((stored.get("wordle\0game") as Game).guesses).toEqual(["slate"]);
    for (const l of "crane") await host.pick("wordle", "wordle", "view", l);
    const won = await host.pick("wordle", "wordle", "view", "submit");
    expect((won.view as View).title).toBe("Magnificent! 2/6");
    expect(stored.get("wordle\0stats")).toMatchObject({ played: 1, won: 1, streak: 1, lastDay: today });
    const copy = await host.pick("wordle", "wordle", "view", "copy");
    expect(copy.copy).toBe(`pal wordle #${today + 1} 2/6\n\n⬜⬜🟩⬜🟩\n🟩🟩🟩🟩🟩`);
    expect(copy.toast).toMatchObject({ title: "Copied" });
    expect((copy.view as View).title).toBe("Magnificent! 2/6");
    const same = await host.pick("wordle", "wordle", "view", "hologram");
    expect((same.view as View).title).toBe("Magnificent! 2/6");
  });
  test("New game after the daily is a practice word; with dailies off a game is never replaced by the day's", async () => {
    const r = await host.pick("wordle", "wordle", "view", "new");
    expect((r.view as View).title).toBe("Practice");
    expect((stored.get("wordle\0game") as Game).day).toBeNull();
    host.changeSettings("wordle", { settings: { daily: false, hard_mode: true } });
    stored.set("wordle\0game", game("crane", { day: 3, guesses: ["slate"] }));
    const v = await host.request<View>("view", { extension: "wordle", palette: "wordle" });
    expect(v.title).toBe("Daily #4");
    expect(v.actions.find((a) => a.id === "new")).toEqual({ id: "new", title: "Practice game", shortcut: "cmd+n" });
    const fresh = await host.pick("wordle", "wordle", "view", "new");
    expect(fresh.view && (stored.get("wordle\0game") as Game)).toMatchObject({ day: null, hard: true });
  });
});
