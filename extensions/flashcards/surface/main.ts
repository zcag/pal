// Flashcards' page: a card on a stack. It keeps no progress of its own:
// it draws the screen the extension answers and sends back what was
// answered, so Escape at any moment loses nothing.
//
// Keys, all one-handed:
//   card     space (or enter, ↓) flips it; a typed card: type, enter checks,
//            tab gives the next letter, a' → á and n~ → ñ
//   flipped  → or space: knew it, the card flies right; ← : didn't know, it
//            flies left (four buttons: 1 didn't know · 2 barely · 3 knew it ·
//            4 too easy); the mouse can drag it either way
//   any      tab says it · cmd+z undoes · cmd+e edits the meaning · s stats
//   done     enter keeps going (or learns more) · d drills the misses ·
//            r the refresher
//   welcome  ↑↓ move · space picks · enter starts
import type { SurfaceKit } from "@zcag/pal";
import { check, diff, type Checked } from "../answer.ts";
import type { CardView, Screen, Stats, Word } from "../index.ts";

declare const pal: SurfaceKit;

type Ui = { buttons: "four" | "two"; speak: "auto" | "key" | "off"; sounds: boolean };
type Card = Extract<Screen, { screen: "card" }>;
type Done = Extract<Screen, { screen: "done" }>;
type Welcome = Extract<Screen, { screen: "welcome" }>;
type Reply = Screen & { undone?: string; mastered?: string };

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const el = (tag: string, cls?: string, text?: string) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Icons drawn here: the page has no icon font (the panel's Nerd Font is not on its origin).
const ICONS: Record<string, string> = {
  flame: '<path fill="currentColor" d="M12 2.5c.9 3.2 4.8 5.3 4.8 9.9a4.8 4.8 0 0 1-9.6 0c0-1.9.9-3.4 1.9-4.4.3 1.6 1.1 2.6 2.2 2.9C10.6 8.3 11 5.4 12 2.5z"/>',
  check: '<path fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" d="M5 12.5l4.6 4.6L19 7.6"/>',
  speaker: '<path fill="currentColor" d="M4 9.3h3.4L12 5.4v13.2l-4.6-3.9H4z"/><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M15.4 9.2a4 4 0 0 1 0 5.6M17.9 6.6a7.6 7.6 0 0 1 0 10.8"/>',
  star: '<path fill="currentColor" d="M12 3.2l2.6 5.5 6 .8-4.4 4.1 1.1 5.9L12 16.6l-5.3 2.9 1.1-5.9-4.4-4.1 6-.8z"/>',
  moon: '<path fill="currentColor" d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
};
const icon = (name: string) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
for (const e of document.querySelectorAll<HTMLElement>("[data-icon]")) e.innerHTML = icon(e.dataset.icon!);
const withIcon = (name: string, text: string) => `${icon(name)}<span>${esc(text)}</span>`;

let ui: Ui = { buttons: "two", speak: "key", sounds: true };
let scr: Screen | null = null;
/** The screen under the stats page, drawn again when it closes. */
let under: Screen | null = null;
let revealed = false;
let checked: Checked | null = null;
let hints = 0;
let shownAt = 0;
let busy = false;
let flying = false;
let editing = false;
let pick = 0;
/** Study or the refresher, switched on the page; every call carries it. */
let mode: "study" | "weak" | undefined;
const chosen = new Set<string>();

const card = $("card");
const input = $<HTMLInputElement>("input");
const foot = $("foot");

// ---- talking to the extension -----------------------------------------------

async function ask<T = Reply>(msg: object): Promise<T | null> {
  try { return (await pal.send({ ...msg, ...(mode && { mode }) })) as T; } catch (e) { console.error("flashcards:", e); return null; }
}

async function call(msg: object) {
  if (busy) return;
  busy = true;
  try { const r = await ask(msg); if (r) show(r); } finally { busy = false; }
}

// ---- drawing -------------------------------------------------------------------

function show(r: Reply) {
  const prev = scr;
  // The same card again (the panel shown anew, a refresh): only the top line moves, so a half-typed answer stays.
  if (r.screen === "card" && prev?.screen === "card" && prev.card.key === r.card.key && !r.undone && !revealed && document.body.dataset.screen === "study") { scr = r; drawTop(r, prev); return; }
  scr = r;
  under = null;
  document.body.dataset.screen = r.screen === "card" ? "study" : r.screen;
  if (r.screen !== "welcome") drawTop(r, prev);
  if (r.screen === "card") drawCard(r, prev);
  else if (r.screen === "done") drawDone(r);
  else drawWelcome(r);
  if (r.mastered) toast(withIcon("star", `Mastered: ${r.mastered}`));
  pal.title(r.screen === "welcome" ? "Flashcards" : r.title);
}

function drawTop(r: Card | Done, prev: Screen | null) {
  const d = r.day;
  const streak = $("streak");
  streak.hidden = d.streak === 0;
  streak.classList.toggle("lit", d.goalMet);
  streak.querySelector("b")!.textContent = String(d.streak);
  streak.title = d.goalMet ? `${d.streak}-day streak: today counts` : `${d.streak}-day streak: meet today's goal to keep it`;
  const goal = $("goal");
  goal.classList.toggle("met", d.goalMet);
  goal.querySelector("b")!.innerHTML = d.goalMet ? icon("check") : String(d.answers);
  goal.title = d.goalMet ? `Goal met: ${d.answers} today` : `${d.answers} of ${d.goal} today`;
  (goal.querySelector(".fill") as SVGCircleElement).style.strokeDashoffset = String(94.25 * (1 - Math.min(1, d.answers / d.goal)));
  const p = $("progress");
  const [done, size] = r.screen === "card" ? [r.progress.done, r.progress.size] : [1, 1];
  (p.querySelector("i") as HTMLElement).style.width = `${size ? (done / size) * 100 : 0}%`;
  p.querySelector(".count")!.textContent = r.screen === "card" && size ? `${done} / ${size}` : "";
  // The stack under the card is what is left of the session: two cards, one, none on the last.
  $("deck").dataset.under = String(r.screen === "card" && size ? Math.max(0, Math.min(2, size - done - 1)) : 2);
  if (d.goalMet && prev && prev.screen !== "welcome" && !prev.day.goalMet) {
    confetti();
    chime("goal");
    toast(withIcon("flame", d.streak > 1 ? `Goal met · ${d.streak}-day streak` : "Goal met · the streak starts"));
    streak.classList.add("bump");
    setTimeout(() => streak.classList.remove("bump"), 700);
  }
}

const LANGS: Record<string, string> = { es: "Spanish", en: "English", fr: "French", de: "German", it: "Italian", pt: "Portuguese", tr: "Turkish", ja: "Japanese", nl: "Dutch" };
const language = (code?: string) => (code ? LANGS[code] ?? code : "the answer");
const ACCENTS: Record<string, string[]> = { es: ["á", "é", "í", "ó", "ú", "ü", "ñ", "¿", "¡"], fr: ["é", "è", "ê", "à", "ç", "ô", "û", "ï"], de: ["ä", "ö", "ü", "ß"], pt: ["á", "â", "ã", "à", "ç", "é", "ê", "í", "ó", "ô", "õ", "ú"], it: ["à", "è", "é", "ì", "ò", "ù"], tr: ["ç", "ğ", "ı", "ö", "ş", "ü"] };

/** A word with its article coloured by gender: <el> gato, <la> casa. */
function wordHTML(text: string, gender?: string): string {
  const m = gender && text.match(/^(el\/la|el|la|los|las)\s+(.*)$/i);
  return m ? `<span class="art ${gender}">${esc(m[1])}</span> ${esc(m[2])}` : esc(text);
}
const lengthOf = (t: string) => (t.length > 34 ? "xl" : t.length > 18 ? "l" : t.length > 10 ? "m" : "s");

const kindLabel = (c: CardView, r: Card) =>
  r.mode === "weak" ? "Drill" : c.leech ? "Tricky one" : c.kind === "new" ? (c.reverse ? "New · the other way round" : "New word") : c.kind === "learning" ? "Learning" : "Review";

function drawCard(r: Card & { undone?: string }, prev: Screen | null) {
  const c = r.card;
  revealed = false;
  checked = null;
  hints = 0;
  editing = false;
  document.body.classList.remove("revealed");
  document.body.classList.toggle("typing", c.type);
  card.classList.remove("flipped");
  card.dataset.gender = c.gender ?? "";
  card.dataset.kind = c.leech ? "leech" : c.kind;
  for (const id of ["kind", "kind2"]) { $(id).textContent = kindLabel(c, r); $(id).className = "tag"; }
  $("kind").title = c.leech ? "You have missed this one often: a picture or a silly sentence in your head helps more than another review" : "";
  const prompt = $("prompt");
  prompt.innerHTML = c.reverse ? esc(c.prompt) : wordHTML(c.prompt, c.gender);
  prompt.dataset.len = lengthOf(c.prompt);
  $("note").textContent = c.reverse ? `${c.note ? `${c.note} · ` : ""}in ${language(c.lang.answer)}` : c.note ?? "";
  $("asked").innerHTML = c.reverse ? esc(c.prompt) : wordHTML(c.prompt, c.gender);
  const answer = $("answer");
  answer.innerHTML = c.reverse ? wordHTML(c.answer, c.gender) : esc(c.answer);
  answer.dataset.len = lengthOf(c.answer);
  answer.contentEditable = "false";
  answer.classList.toggle("edited", c.edited);
  answer.title = c.edited ? "Your meaning (cmd+e to change it)" : "cmd+e to write your own meaning";
  drawExample(c);
  $("typed").replaceChildren();
  input.value = "";
  input.disabled = false;
  input.placeholder = `in ${language(c.lang.answer)}`;
  const acc = $("accents");
  acc.replaceChildren(...(ACCENTS[c.lang.answer ?? ""] ?? []).map((a) => { const b = el("button", "acc", a) as HTMLButtonElement; b.type = "button"; b.tabIndex = -1; b.addEventListener("mousedown", (e) => { e.preventDefault(); insert(a); }); return b; }));
  // The word said is the one in the language learned: on a reverse card that is the answer, so no button on its front.
  $("say").hidden = (!target(c).lang && !c.audio) || c.reverse;
  $("say2").hidden = !target(c).lang && !c.audio;
  const fresh = !(prev?.screen === "card" && prev.card.key === c.key) || !!r.undone;
  if (fresh) arrive(r.undone ? "back" : "stack");
  if (c.type) setTimeout(() => input.focus(), 60);
  shownAt = performance.now();
  drawFoot();
  if (ui.speak === "auto" && !c.reverse) sayTarget();
}

/** The example with the word in it marked, and its translation. */
function drawExample(c: CardView) {
  const ex = $("example");
  ex.hidden = !c.example;
  if (!c.example) return;
  const word = (c.reverse ? c.answer : c.prompt).replace(/^(el|la|los|las|el\/la)\s+/i, "");
  const stem = word.length > 4 ? word.slice(0, Math.max(3, word.length - 2)) : word;
  const re = new RegExp(`(^|[^\\p{L}])(${stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\p{L}*)`, "iu");
  ex.querySelector(".es")!.innerHTML = esc(c.example).replace(re, "$1<mark>$2</mark>");
  ex.querySelector(".en")!.textContent = c.example_back ?? "";
}

/** The card comes up off the stack (or back from the left, after an undo). */
function arrive(from: "stack" | "back") {
  card.style.transition = "none";
  card.style.transform = "";
  card.style.opacity = "";
  card.classList.remove("arrive-stack", "arrive-back");
  void card.offsetWidth;
  card.style.transition = "";
  card.classList.add(from === "back" ? "arrive-back" : "arrive-stack");
  for (const s of card.querySelectorAll<HTMLElement>(".stamp")) s.style.opacity = "";
}

function reveal() {
  if (!scr || scr.screen !== "card" || revealed || flying) return;
  const c = scr.card;
  const v = $("kind2");
  if (c.type) {
    const typed = input.value.trim();
    checked = check(typed, c.answer);
    input.disabled = true;
    const box = $("typed");
    box.replaceChildren();
    // What you typed, letter by letter against the answer: only when it differs (exact needs no second copy).
    if (typed && checked.verdict !== "exact") {
      const runs = diff(typed, checked.nearest === c.answer ? c.answer : spelling(c.answer, checked.nearest));
      let n = 0;
      for (const run of runs) for (const ch of run.text) { const s = el("span", run.kind, ch); s.style.animationDelay = `${120 + n++ * 28}ms`; box.append(s); }
    }
    v.className = `tag verdict ${typed ? checked.verdict : "wrong"}`;
    v.textContent = !typed ? "Here it is" : hints && checked.verdict !== "wrong" ? `With ${hints === 1 ? "a hint" : `${hints} hints`}` : checked.verdict === "exact" ? "Correct" : checked.verdict === "wrong" ? "Not quite" : checked.why === "accent" ? "Mind the accent" : checked.why === "article" ? "Mind the article" : "Almost: a typo";
    chime(checked.verdict === "wrong" || !typed ? "miss" : "hit");
  }
  revealed = true;
  document.body.classList.add("revealed");
  card.classList.add("flipped");
  drawFoot();
  if (ui.speak === "auto" && c.reverse) sayTarget();
}

/** The accepted answer as written in the card (accents and all) nearest the normalised one. */
function spelling(side: string, nearest: string) {
  return side.split(/\s*[,;/]\s*|\s+or\s+/i).find((p) => p.toLowerCase().includes(nearest.split(" ").pop() ?? "")) ?? side;
}

/** The grade Space/Enter/→ gives: Knew it, or what a typed answer earned. More than one hint means you needed help. */
function lit(): number {
  if (!checked) return 3;
  if (!input.value.trim() || checked.verdict === "wrong" || hints > 1) return 1;
  return checked.why === "typo" && ui.buttons === "four" ? 2 : 3;
}

// The grades as the question they answer, "Did you know it?" (FSRS's Again, Hard, Good, Easy).
const RATINGS = [
  { r: 1, name: "Didn't know", key: "1", two: "←" },
  { r: 2, name: "Barely", key: "2" },
  { r: 3, name: "Knew it", key: "3", two: "→" },
  { r: 4, name: "Too easy", key: "4" },
];

/** "10m" → "in 10 min", "1d" → "tomorrow", "3d" → "in 3 days". */
function when(span: string, r: number): string {
  const m = span.match(/^([\d.]+)(m|h|d|mo|y)$/);
  if (!m) return span;
  const n = Number(m[1]);
  if (m[2] === "d" && n === 1) return "tomorrow";
  const unit = { m: "min", h: n === 1 ? "hour" : "hours", d: "days", mo: n === 1 ? "month" : "months", y: n === 1 ? "year" : "years" }[m[2]];
  return `${r === 1 ? "again " : ""}in ${n} ${unit}`;
}

/** The first answers ever: a line saying how the thing works. */
const newcomer = () => scr?.screen === "card" && scr.day.total < 12;

function drawFoot() {
  foot.replaceChildren();
  foot.className = "";
  if (!scr) return;
  if (document.body.dataset.screen === "stats") { foot.append(button("Back", "s", closeStats, "primary")); return; }
  if (scr.screen === "card") {
    const c = scr.card;
    if (!revealed) {
      foot.append(button(c.type ? "Check" : "Flip", c.type ? "⏎" : "space", reveal, "primary flipbtn"));
      const tips: [string, string][] = c.type ? [["tab", "a letter"], ["a'", "á"], ["n~", "ñ"]] : [["tab", "say it"], ["?", "all keys"]];
      foot.append(hintLine(tips, newcomer() ? (c.type ? "Type it and check; with nothing typed, it shows you." : "Think of what it means, then flip the card.") : undefined));
    } else {
      const two = ui.buttons === "two";
      foot.className = two ? "two" : "four";
      const row = el("div", "grades");
      for (const x of two ? RATINGS.filter((x) => x.r === 1 || x.r === 3) : RATINGS) {
        const b = button(x.name, two ? x.two! : x.key, () => rate(x.r), `grade g${x.r}${x.r === lit() ? " lit" : ""}`);
        b.append(el("span", "ivl", when(c.intervals[x.r as 1 | 2 | 3 | 4], x.r)));
        row.append(b);
      }
      if (two) row.insertBefore(el("div", "q", newcomer() ? "Did you know it? Be honest: a miss comes back in a minute." : "Did you know it?"), row.lastChild);
      foot.append(row);
    }
  } else if (scr.screen === "done") {
    const d = scr, row = el("div", "grades actions");
    const misses = d.session.missed.length;
    if (d.mode === "weak") row.append(button("Back to studying", "⏎", backToStudy, "primary"));
    else if (d.reason === "block") row.append(button("Keep going", "⏎", () => call({ op: "keep" }), "primary"));
    else if (d.moreNew > 0) row.append(button("Learn 10 new words", "⏎", () => call({ op: "more" }), "primary"));
    if (misses && d.mode === "study") row.append(button(`Drill ${misses === 1 ? "the miss" : `${misses} misses`}`, "d", drill));
    else if (d.weak > 0 && d.mode === "study" && d.reason !== "block") row.append(button(`Refresher · ${d.weak}`, "r", refresher));
    row.append(button("Stats", "s", openStats));
    foot.append(row);
    if (d.canUndo) foot.append(hintLine([["⌘Z", "take the last answer back"], ["?", "all keys"]]));
  } else {
    foot.append(button(chosen.size > 1 ? `Start with ${chosen.size} packs` : "Start", "⏎", start, "primary flipbtn"), hintLine([["↑↓", "move"], ["space", "pick"]]));
  }
}

function button(text: string, key: string, fn: () => void, cls = "") {
  const b = el("button", `btn ${cls}`) as HTMLButtonElement;
  b.type = "button";
  b.tabIndex = -1;
  b.append(el("span", "label", text), el("kbd", "", key));
  b.addEventListener("click", (e) => { e.preventDefault(); fn(); });
  return b;
}

function hintLine(list: [string, string][], more?: string) {
  const h = el("div", "hints");
  if (more) h.append(el("span", "more", more));
  for (const [k, t] of list) { const s = el("span"); s.append(el("kbd", "", k), document.createTextNode(` ${t}`)); h.append(s); }
  return h;
}

// ---- done ----------------------------------------------------------------------

function drawDone(d: Done) {
  const s = d.session;
  const burst = $("done").querySelector<HTMLElement>(".burst")!;
  burst.dataset.kind = d.reason === "empty" ? "empty" : !s.answers ? "rest" : "win";
  burst.innerHTML = icon(burst.dataset.kind === "rest" ? "moon" : "check");
  $("done").querySelector("h1")!.textContent =
    d.reason === "empty" ? "Nothing to study here" :
    d.mode === "weak" ? (s.answers ? "Drilled" : "Nothing to drill") :
    d.reason === "block" ? `${s.answers} card${s.answers === 1 ? "" : "s"} done` :
    s.answers ? "All caught up" : "Nothing due right now";
  const facts: string[] = [];
  if (s.answers) {
    facts.push(`${Math.round((s.passed / s.answers) * 100)}% right`);
    facts.push(duration(s.seconds));
    if (s.learned.length) facts.push(`${s.learned.length} new word${s.learned.length === 1 ? "" : "s"}`);
    if (d.reason === "block") facts.push(`${d.left} more today`);
  } else if (d.reason !== "empty") facts.push(d.tomorrow ? `${d.tomorrow} card${d.tomorrow === 1 ? "" : "s"} come back tomorrow` : "Come back tomorrow");
  $("facts").textContent = facts.join(" · ");
  const chips = $("chips");
  chips.replaceChildren();
  let n = 0;
  const group = (label: string, list: Word[], cls: string) => {
    if (!list.length) return;
    const row = el("div", `group ${cls}`);
    row.append(el("span", "lbl", label));
    for (const w of list.slice(0, 8)) {
      const c = el("span", "chip");
      c.innerHTML = cls === "mastered" ? `${icon("star")}${wordHTML(w.word, w.gender)}` : wordHTML(w.word, w.gender);
      c.title = w.meaning;
      c.style.animationDelay = `${200 + n++ * 55}ms`;
      row.append(c);
    }
    if (list.length > 8) row.append(el("span", "chip more", `+${list.length - 8}`));
    chips.append(row);
  };
  group("Missed", s.missed, "missed");
  group("New", s.learned.filter((w) => !s.missed.some((m) => m.key === w.key)), "new");
  group("Mastered", s.mastered, "mastered");
  const cov = $("coverage");
  cov.hidden = !d.coverage || !d.coverage.after;
  if (d.coverage) {
    const { before, after } = d.coverage, gain = after - before;
    const pct = (x: number) => `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`;
    const tongue = /spanish/i.test(d.coverage.title) ? "Spanish" : "speech";
    cov.querySelector(".line")!.innerHTML = `Your words cover <b>${pct(after)}</b> of everyday ${tongue}${gain > 0.0005 ? ` <span class="gain">+${(gain * 100).toFixed(1)}%</span>` : ""}`;
    const was = cov.querySelector<HTMLElement>(".was")!, now = cov.querySelector<HTMLElement>(".now")!;
    was.style.width = `${before * 100}%`;
    now.style.left = `${before * 100}%`;
    now.style.width = "0";
    setTimeout(() => { now.style.width = `${Math.max(0, gain) * 100}%`; }, 500);
  }
  enter($("done"));
  drawFoot();
  if (s.answers && d.mode === "study") chime("done");
}

function duration(s: number) {
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

// ---- stats ------------------------------------------------------------------------

async function openStats() {
  if (!scr || scr.screen === "welcome" || busy || flying || document.body.dataset.screen === "stats") return;
  const st = await ask<Stats>({ op: "stats" });
  if (!st) return;
  under = scr;
  document.body.dataset.screen = "stats";
  const fig = (n: string, l: string) => { const f = el("div", "fig"); f.append(el("b", "", n), el("span", "", l)); return f; };
  $("stats").querySelector(".figures")!.replaceChildren(
    fig(String(st.streak), "day streak"),
    fig(String(st.best), "best streak"),
    fig(String(st.total), "answers"),
    fig(duration(st.seconds), "studied"),
    fig(st.retention === null ? "–" : `${Math.round(st.retention * 100)}%`, "remembered"),
  );
  drawHeat(st.heat);
  const fc = $("forecast");
  fc.replaceChildren();
  const max = Math.max(1, ...st.forecast), days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  st.forecast.forEach((n, i) => {
    const col = el("div", "col");
    const bar = el("i");
    bar.style.height = `${Math.max(3, (n / max) * 100)}%`;
    bar.style.animationDelay = `${i * 40}ms`;
    col.append(el("span", "n", String(n)), el("div", "well"), el("span", "d", i === 0 ? "Today" : days[new Date(Date.now() + i * 86_400_000).getDay()]));
    col.querySelector(".well")!.append(bar);
    col.title = `${n} card${n === 1 ? "" : "s"}`;
    fc.append(col);
  });
  const pb = $("packbars");
  pb.replaceChildren();
  for (const p of st.packs) {
    const row = el("div", "pbar");
    const t = el("div", "t");
    t.append(el("span", "name", p.title), el("span", "nums", `${p.mastered} mastered · ${p.learning} learning · ${p.fresh} new${p.coverage !== undefined ? ` · covers ${(p.coverage * 100).toFixed(0)}%` : ""}`));
    const bar = el("div", "bar");
    for (const [cls, v] of [["m", p.mastered], ["l", p.learning]] as const) { const i = el("i", cls); i.style.width = `${(v / Math.max(1, p.total)) * 100}%`; bar.append(i); }
    row.append(t, bar);
    pb.append(row);
  }
  // A basic system voice sounds robotic; the free Enhanced one is a download away.
  const tip = $("stats").querySelector<HTMLElement>(".voice") ?? $("stats").appendChild(el("div", "voice"));
  tip.hidden = !(st.voice && st.voice.quality === "basic");
  if (st.voice) tip.innerHTML = withIcon("speaker", `A more natural voice: System Settings › Accessibility › Spoken Content › System voice › Manage Voices, then ${st.voice.name.replace(/\s*\(.*\)$/, "")} (Enhanced). Flashcards picks it up by itself.`);
  enter($("stats"));
  drawFoot();
  pal.title("Flashcards · Stats");
}

function closeStats() {
  const back = under;
  under = null;
  if (!back) return;
  document.body.dataset.screen = back.screen === "card" ? "study" : back.screen;
  scr = back;
  drawFoot();
  pal.title(back.screen === "welcome" ? "Flashcards" : back.title);
}

function drawHeat(days: number[]) {
  const h = $("heat");
  h.replaceChildren();
  const max = Math.max(10, ...days);
  for (const n of days) {
    const c = el("i");
    c.dataset.l = n === 0 ? "0" : String(Math.min(4, Math.ceil((n / max) * 4)));
    c.title = `${n} card${n === 1 ? "" : "s"}`;
    h.append(c);
  }
}

// ---- welcome ----------------------------------------------------------------------

function drawWelcome(w: Welcome) {
  const list = $("packs");
  list.replaceChildren();
  if (!chosen.size && w.packs[0]) chosen.add(w.packs[0].id);
  w.packs.forEach((p, i) => {
    const row = el("div", `pack${i === pick ? " at" : ""}${chosen.has(p.id) ? " on" : ""}`);
    const box = el("span", "box");
    if (chosen.has(p.id)) box.innerHTML = icon("check");
    const text = el("div", "text");
    text.append(el("div", "title", p.title), el("div", "desc", p.description ?? ""));
    row.append(box, text, el("span", "count", `${p.cards} cards`));
    row.addEventListener("click", () => { pick = i; toggle(p.id); });
    row.addEventListener("dblclick", () => { chosen.add(p.id); start(); });
    list.append(row);
  });
  drawFoot();
}

function toggle(id: string) {
  if (chosen.has(id)) chosen.delete(id); else chosen.add(id);
  if (scr?.screen === "welcome") drawWelcome(scr);
}

function start() {
  if (scr?.screen !== "welcome") return;
  const ids = chosen.size ? [...chosen] : [scr.packs[pick]?.id].filter(Boolean);
  if (ids.length) call({ op: "start", packs: ids });
}

function refresher() { mode = "weak"; call({ op: "open" }); }
function drill() { mode = "weak"; call({ op: "drill" }); }
function backToStudy() { mode = "study"; call({ op: "open" }); }

/** Replays a view's entrance. */
function enter(e: HTMLElement) {
  e.classList.remove("enter");
  void e.offsetWidth;
  e.classList.add("enter");
}

// ---- answering: the card flies off ------------------------------------------------

async function rate(r: number, fromDrag = false) {
  if (!scr || scr.screen !== "card" || !revealed || busy || flying || editing) return;
  if (ui.buttons === "two" && (r === 2 || r === 4)) r = 3;
  const key = scr.card.key, ms = performance.now() - shownAt;
  flying = true;
  foot.querySelector(`.g${r}`)?.classList.add("pressed");
  if (!checked) chime(r === 1 ? "miss" : "hit");
  const right = r > 1;
  // Off it goes, from wherever a drag left it; the answer is saved while it flies.
  const x = fromDrag ? Number(card.dataset.dx || 0) : 0;
  card.classList.remove("arrive-stack", "arrive-back");
  card.style.transition = "transform 260ms cubic-bezier(0.4, 0, 0.9, 0.6), opacity 260ms ease-in";
  card.style.transform = `translateX(${right ? "" : "-"}${Math.max(130, Math.abs(x) / 3)}%) rotate(${right ? 16 : -16}deg)`;
  card.style.opacity = "0";
  card.querySelector<HTMLElement>(right ? ".stamp.yes" : ".stamp.no")!.style.opacity = "1";
  document.body.classList.add(right ? "went-yes" : "went-no");
  busy = true;
  // The answer takes ~5 ms; the next card comes as soon as this one is mostly off.
  const [reply] = await Promise.all([ask({ op: "answer", key, rating: r, ms }), wait(170)]);
  busy = false;
  flying = false;
  document.body.classList.remove("went-yes", "went-no");
  if (reply) show(reply);
  // A flip pressed while the card was still flying is not lost: it flips the next one.
  if (flipQueued && scr?.screen === "card" && !scr.card.type) reveal();
  flipQueued = false;
}
let flipQueued = false;

// Dragging the card: past a third of its width it counts, short of that it springs back.
let drag: { x0: number; id: number; moved: boolean } | null = null;
card.addEventListener("pointerdown", (e) => {
  if (!scr || scr.screen !== "card" || flying || editing || (e.target as HTMLElement).closest("button, input, #accents")) return;
  drag = { x0: e.clientX, id: e.pointerId, moved: false };
  card.setPointerCapture(e.pointerId);
});
card.addEventListener("pointermove", (e) => {
  if (!drag || e.pointerId !== drag.id || !revealed) return;
  const dx = e.clientX - drag.x0;
  if (Math.abs(dx) > 4) drag.moved = true;
  card.classList.remove("arrive-stack", "arrive-back");
  card.style.transition = "none";
  card.style.transform = `translateX(${dx}px) rotate(${dx * 0.06}deg)`;
  card.dataset.dx = String(dx);
  const t = Math.min(1, Math.abs(dx) / 110);
  card.querySelector<HTMLElement>(".stamp.yes")!.style.opacity = dx > 0 ? String(t) : "0";
  card.querySelector<HTMLElement>(".stamp.no")!.style.opacity = dx < 0 ? String(t) : "0";
});
const release = (e: PointerEvent) => {
  if (!drag || e.pointerId !== drag.id) return;
  const dx = Number(card.dataset.dx || 0), moved = drag.moved;
  drag = null;
  card.dataset.dx = "0";
  if (!revealed) { if (!moved && scr?.screen === "card" && !scr.card.type) reveal(); return; }
  if (Math.abs(dx) > Math.min(140, card.offsetWidth / 3)) { card.dataset.dx = String(dx); rate(dx > 0 ? 3 : 1, true); return; }
  card.style.transition = "transform 380ms cubic-bezier(0.2, 1.4, 0.4, 1)";
  card.style.transform = "";
  for (const s of card.querySelectorAll<HTMLElement>(".stamp")) s.style.opacity = "";
};
card.addEventListener("pointerup", release);
card.addEventListener("pointercancel", release);

// ---- typing helpers ------------------------------------------------------------------

function insert(text: string) {
  const a = input.selectionStart ?? input.value.length, b = input.selectionEnd ?? a;
  input.setRangeText(text, a, b, "end");
  input.focus();
}

const ACUTE: Record<string, string> = { a: "á", e: "é", i: "í", o: "ó", u: "ú", A: "Á", E: "É", I: "Í", O: "Ó", U: "Ú" };
input.addEventListener("keydown", (e) => {
  const i = input.selectionStart ?? 0, before = input.value[i - 1] ?? "";
  // a' → á, n~ → ñ, u: → ü: accents without an accented keyboard.
  const to = e.key === "'" ? ACUTE[before] : e.key === "~" && /n/i.test(before) ? (before === "N" ? "Ñ" : "ñ") : e.key === ":" && /u/i.test(before) ? (before === "U" ? "Ü" : "ü") : undefined;
  if (to && input.selectionStart === input.selectionEnd) { e.preventDefault(); input.setRangeText(to, i - 1, i, "end"); }
});

/** Tab on a typed card: the next letter of the answer. */
function hint() {
  if (scr?.screen !== "card" || !scr.card.type || revealed) return;
  const answer = scr.card.answer.split(/\s*[,;/]\s*/)[0];
  const typed = input.value;
  let k = 0;
  while (k < typed.length && k < answer.length && typed[k].toLowerCase() === answer[k].toLowerCase()) k++;
  if (k >= answer.length) return;
  input.value = answer.slice(0, k + 1);
  hints++;
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
  $("kind").textContent = hints === 1 ? "A hint" : `${hints} hints`;
}

// ---- editing the meaning ------------------------------------------------------------------

function startEdit() {
  if (scr?.screen !== "card" || !revealed || editing) return;
  const a = $("answer"), c = scr.card;
  editing = true;
  a.textContent = c.reverse ? c.prompt : c.answer;
  a.contentEditable = "true";
  a.focus();
  getSelection()?.selectAllChildren(a);
  toast(esc("Your own meaning: enter saves it"));
}
$("answer").addEventListener("keydown", (e) => {
  if (!editing) return;
  e.stopPropagation();
  if (e.key !== "Enter") return;
  e.preventDefault();
  const text = $("answer").textContent ?? "";
  editing = false;
  $("answer").contentEditable = "false";
  if (scr?.screen !== "card") return;
  const key = scr.card.key;
  revealed = false;
  call({ op: "edit", key, back: text }).then(() => { if (scr?.screen === "card" && scr.card.key === key) { reveal(); toast(esc("Saved")); } });
});
$("answer").addEventListener("blur", () => {
  if (!editing || scr?.screen !== "card") return;
  editing = false;
  const c = scr.card;
  $("answer").contentEditable = "false";
  $("answer").innerHTML = c.reverse ? wordHTML(c.answer, c.gender) : esc(c.answer);
});

// ---- speech and sound ---------------------------------------------------------------

/** The side in the language being learned: the prompt on a recognition card, the answer on a production one. */
const target = (c: CardView) => (c.reverse ? { text: c.answer, lang: c.lang.answer } : { text: c.prompt, lang: c.lang.prompt });

function sayTarget() {
  if (!scr || scr.screen !== "card" || ui.speak === "off") return;
  const c = scr.card;
  if (c.reverse && !revealed) return;
  const t = target(c);
  if (t.lang || c.audio) pal.send({ op: "speak", text: t.text, lang: t.lang, key: c.key }).catch(() => {});
}
function sayExample() {
  if (scr?.screen !== "card" || !revealed || !scr.card.example) return;
  pal.send({ op: "speak", text: scr.card.example, lang: scr.card.reverse ? scr.card.lang.answer : scr.card.lang.prompt }).catch(() => {});
}

let audio: AudioContext | null = null;
/** Small tones, made here (no files): a lift for a pass, a soft drop for a miss, a run for the goal. */
function chime(kind: "hit" | "miss" | "goal" | "done") {
  if (!ui.sounds) return;
  try {
    audio ??= new AudioContext();
    const notes = { hit: [880, 1318.5], miss: [311, 233], goal: [659.3, 830.6, 987.8, 1318.5], done: [523.3, 659.3, 784] }[kind];
    const t0 = audio.currentTime;
    notes.forEach((f, i) => {
      const o = audio!.createOscillator(), g = audio!.createGain();
      o.type = kind === "miss" ? "triangle" : "sine";
      o.frequency.value = f;
      const t = t0 + i * (kind === "hit" ? 0.07 : 0.09);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(kind === "miss" ? 0.05 : 0.06, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (kind === "hit" ? 0.18 : 0.32));
      o.connect(g).connect(audio!.destination);
      o.start(t);
      o.stop(t + 0.4);
    });
  } catch { /* no audio: silence is fine */ }
}

/** A pill at the top for a moment; `html` is trusted markup (withIcon, esc). */
function toast(html: string) {
  const t = el("div", "toast");
  t.innerHTML = html;
  $("fx").append(t);
  setTimeout(() => t.remove(), 2600);
}

function confetti() {
  const fx = $("fx");
  const colours = ["--pal-tag-violet", "--pal-tag-amber", "--pal-tag-green", "--pal-tag-blue", "--pal-tag-pink"];
  for (let i = 0; i < 70; i++) {
    const p = el("i", "bit");
    p.style.left = `${50 + (Math.random() - 0.5) * 30}%`;
    p.style.background = `var(${colours[i % colours.length]})`;
    p.style.setProperty("--dx", `${(Math.random() - 0.5) * 520}px`);
    p.style.setProperty("--dy", `${-120 - Math.random() * 220}px`);
    p.style.setProperty("--r", `${Math.random() * 720 - 360}deg`);
    p.style.animationDelay = `${Math.random() * 90}ms`;
    fx.append(p);
    setTimeout(() => p.remove(), 1600);
  }
}

// ---- ? : every key, for where you are ------------------------------------------------

const HELP: Record<string, [string, string][]> = {
  card: [["space", "flip the card"], ["→ or space", "knew it: it comes back later"], ["←", "didn't know: back in a minute"], ["drag", "throw the card either way"], ["tab", "say the word (shift+tab: the example)"], ["⌘Z", "take the last answer back"], ["⌘E", "write your own meaning"], ["s", "stats"], ["⌘K", "suspend, learn more, refresher, mute"], ["esc", "leave: every answer is already saved"]],
  typed: [["enter", "check (empty: show the answer)"], ["tab", "the next letter"], ["a' e' n~ u:", "á é ñ ü"], ["then → / ←", "knew it / didn't know"], ["⌘Z", "take the last answer back"], ["esc", "leave: every answer is already saved"]],
  done: [["enter", "keep going, or learn 10 new words"], ["d", "drill this session's misses"], ["r", "the refresher: the cards you keep missing"], ["s", "stats"], ["⌘Z", "take the last answer back"], ["esc", "leave"]],
  welcome: [["↑↓", "move"], ["space", "pick a pack"], ["enter", "start"], ["b", "find a deck on AnkiWeb"]],
};
const help = el("div");
help.id = "help";
help.hidden = true;
document.body.append(help);
const helpOpen = () => !help.hidden;
function openHelp() {
  const ctx = scr?.screen === "card" ? (scr.card.type && !revealed ? "typed" : "card") : scr?.screen ?? "card";
  help.replaceChildren(el("div", "cap", "Keys"));
  const t = el("div", "rows");
  for (const [k, what] of HELP[ctx] ?? HELP.card) { t.append(el("kbd", "", k), el("span", "", what)); }
  help.append(t, el("div", "close", "any key closes"));
  help.hidden = false;
}
function closeHelp() { help.hidden = true; }
help.addEventListener("click", closeHelp);

// ---- keys -----------------------------------------------------------------------

document.addEventListener("keydown", (e) => {
  if (!scr || editing) return;
  const k = e.key, mod = e.metaKey || e.ctrlKey;
  if (helpOpen()) { e.preventDefault(); closeHelp(); return; }
  if (flying) { if (!mod && (k === " " || k === "Enter" || k === "ArrowDown")) { e.preventDefault(); flipQueued = !e.repeat; } return; }
  if (mod && k.toLowerCase() === "z") { e.preventDefault(); undo(); return; }
  if (mod && k.toLowerCase() === "s") { e.preventDefault(); sayTarget(); return; }
  if (mod && k.toLowerCase() === "e") { e.preventDefault(); startEdit(); return; }
  if (mod) return;
  const typingNow = scr.screen === "card" && scr.card.type && !revealed && document.body.dataset.screen === "study";
  if (k === "?" && !typingNow) { e.preventDefault(); openHelp(); return; }
  if (k === "Tab") { e.preventDefault(); if (typingNow) hint(); else if (e.shiftKey) sayExample(); else sayTarget(); return; }

  if (document.body.dataset.screen === "stats") {
    if (k === "s" || k === "Enter" || k === "b" || k === " ") { e.preventDefault(); closeStats(); }
    return;
  }
  if (scr.screen === "welcome") {
    const n = scr.packs.length;
    if (k === "ArrowDown" || k === "j") { pick = (pick + 1) % n; drawWelcome(scr); }
    else if (k === "ArrowUp" || k === "k") { pick = (pick + n - 1) % n; drawWelcome(scr); }
    else if (k === " ") toggle(scr.packs[pick].id);
    else if (k === "Enter") start();
    else if (k === "b") pal.send({ op: "browse" }).catch(() => {});
    else return;
    e.preventDefault();
    return;
  }
  if (scr.screen === "done") {
    const primary = foot.querySelector<HTMLButtonElement>(".btn.primary");
    if (k === "Enter" || k === " ") primary?.click();
    else if (k === "d" && scr.session.missed.length && scr.mode === "study") drill();
    else if (k === "r" && scr.weak > 0 && scr.mode === "study") refresher();
    else if (k === "n" && scr.moreNew > 0 && scr.mode === "study") call({ op: "more" });
    else if (k === "s") openStats();
    else return;
    e.preventDefault();
    return;
  }
  // A card.
  if (typingNow) { if (k === "Enter") { e.preventDefault(); reveal(); } return; }
  if (k === "s" && !revealed) { e.preventDefault(); openStats(); return; }
  if (!revealed) {
    if (k === " " || k === "Enter" || k === "ArrowDown" || k === "ArrowUp") { e.preventDefault(); reveal(); }
    return;
  }
  const map: Record<string, number> = ui.buttons === "two" ? { "1": 1, "2": 3, "3": 3, "4": 3, ArrowLeft: 1, ArrowRight: 3 } : { "1": 1, "2": 2, "3": 3, "4": 4, ArrowLeft: 1, ArrowRight: 3 };
  if ((k === " " || k === "Enter") && !e.repeat) { e.preventDefault(); rate(lit()); }
  else if (map[k] && !e.repeat) { e.preventDefault(); rate(map[k]); }
});

$("say").addEventListener("click", (e) => { e.stopPropagation(); sayTarget(); });
$("say2").addEventListener("click", (e) => { e.stopPropagation(); sayTarget(); });
$("folder").addEventListener("click", (e) => { e.preventDefault(); pal.send({ op: "folder" }).catch(() => {}); });
$("browse").addEventListener("click", (e) => { e.preventDefault(); pal.send({ op: "browse" }).catch(() => {}); });

async function undo() {
  if (!scr || scr.screen === "welcome" || !scr.canUndo || flying) return;
  await call({ op: "undo" });
  toast(esc("Undone"));
}

// ⌘K picks.
pal.onAction((id) => {
  if (id === "speak") sayTarget();
  else if (id === "undo") undo();
  else if (id === "weak") refresher();
  else if (id === "more") call({ op: "more" });
  else if (id === "stats") openStats();
  else if (id === "edit") startEdit();
  else if (id === "folder") pal.send({ op: "folder" }).catch(() => {});
  else if (id === "browse") pal.send({ op: "browse" }).catch(() => {});
  else if (id === "mute") pal.send({ op: "mute" }).then((r) => toast(esc((r as { quiet?: boolean })?.quiet ? "Muted" : "Sound on"))).catch(() => {});
  else if (id === "suspend" && scr?.screen === "card") { call({ op: "suspend", key: scr.card.key }); toast(esc("Suspended: it won't come up again")); }
});

const applyUi = (s: Record<string, unknown>) => {
  ui = { buttons: s.buttons === "four" ? "four" : "two", speak: (["auto", "key", "off"] as const).find((x) => x === s.speak) ?? "key", sounds: s.sounds !== false };
  if (scr?.screen === "card") drawFoot();
};
pal.onSettings(applyUi);
// Back on screen after a while: the day may have turned or cards come due.
pal.onShown(() => { if (!busy && !flying && document.body.dataset.screen !== "stats" && (scr?.screen === "done" || (scr?.screen === "card" && !revealed))) call({ op: "screen" }); });

(async () => {
  try { applyUi(await pal.settings()); } catch { /* defaults */ }
  await call({ op: "open" });
  pal.ready();
})();
