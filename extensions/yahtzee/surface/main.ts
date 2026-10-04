// Yahtzee's page: the state, the input, the save. A move from a key, a
// click or cmd+k (`pal.onAction`) is `apply` from game.ts, the rules the
// host tests; the new state is drawn (board.ts), saved under the keys the
// extension reads (progress.ts: the card stays here, the record syncs, and
// a record sync brought in replaces the one in memory), and the extension
// is told, so the view's actions and title follow. A finished card goes to
// its boards (`pal.score`) and the result says the rank. New game (or Y,
// the daily dice: the same dice for everyone that UTC day) mid-game asks
// first; from cmd+k the panel already has.
//
// The keys, one hand on the arrows: the cursor is on the dice (← → pick a
// die, Enter holds it, ↑ or space rolls) or on the card (↓ from the dice
// lands on the category that adds most; the arrows move between the ones
// the dice may go in, ↑ past the top goes back to the dice; Enter scores).
// 1 to 5 hold a die and R rolls from anywhere. After the third roll the
// cursor is on the card by itself.
import { LOWER, ROLLS, UPPER, apply, bestOption, options, started, utcDay, type Category, type Move, type State } from "../game.ts";
import { moveOf, titleOf } from "../moves.ts";
import { KEYS, changes, restore, scores, type Key, type Saved } from "../progress.ts";
import { Board, type Cursor } from "./board.ts";
import type { SurfaceKit } from "@zcag/pal";

declare const pal: SurfaceKit;

let st: State;
let cur: Cursor = { zone: "dice", die: 0 };

/** What storage holds, as this page last wrote or heard it. */
let saved: Saved = {};
/** Saves in order, each after the last, then says so: the extension re-reads and pushes the view's actions. */
let saving: Promise<unknown> = Promise.resolve();
const save = (snap: State) => {
  const ch = changes(snap, saved);
  Object.assign(saved, ch);
  saving = saving.then(() => Promise.all(Object.entries(ch).map(([k, v]) => pal.storage.set(k, v)))).then(() => pal.send({ moved: true })).catch((e) => console.error("yahtzee: save", e));
};

const rankEl = document.getElementById("rank")!, signInEl = document.getElementById("signin")!;
/** A finished card to its boards; the rank, when a board answers, beside the record. */
async function post(done: State) {
  const answers = await Promise.all(scores(done, utcDay()).map(([board, value]) => pal.score(board, value).catch((e) => void console.error(`yahtzee: score ${board}`, e))));
  const daily = answers[1], r = daily ?? answers[0];
  if (st !== done || !r || r.rank == null) return;
  rankEl.textContent = `#${r.rank} of ${r.total}${daily ? " today" : ""}`;
  signInEl.hidden = (await pal.account().catch(() => ({ signedIn: true }))).signedIn;
}
signInEl.addEventListener("click", () => void pal.signIn());
document.getElementById("daily")!.addEventListener("click", () => play(moveOf("daily")!));

const confirmBox = document.getElementById("confirm")!;
const confirming = () => confirmBox.classList.contains("open");

const board = new Board({
  hold: (die) => { cur = { ...cur, zone: "dice", die }; play({ type: "hold", die }); },
  roll: () => play({ type: "roll" }),
  score: (cat) => play({ type: "score", category: cat }),
  point: (cat) => { if (options(st)[cat] !== undefined) point({ ...cur, zone: "card", cat }); },
  again: () => play({ type: "new" }),
});

/** The cursor moved: drawn, nothing saved. */
function point(next: Cursor) {
  cur = next;
  board.render(st, cur);
}

/** The move a confirmed New game makes: New game or the daily dice, whichever asked. */
let asked: Move = { type: "new" };
function play(m: Move, confirmed = false) {
  if ((m.type === "new" || m.type === "daily") && !confirmed && started(st)) { asked = m; confirmBox.classList.add("open"); return; }
  const next = apply(st, m);
  if (next === st) { if (m.type === "roll" && !st.ended) board.nudge(); return; }
  const prev = st;
  st = next;
  if (m.type === "roll") {
    board.press();
    const opts = options(st);
    // Out of rolls, or a Joker with one place to go: the choice is all that is left.
    if (st.rolls >= ROLLS || Object.keys(opts).length === 1) cur = { ...cur, zone: "card", cat: bestOption(st) };
    else if (cur.zone === "card") cur = { ...cur, cat: cur.cat && opts[cur.cat] !== undefined ? cur.cat : bestOption(st) };
  } else if (m.type !== "hold") cur = { zone: "dice", die: cur.die };
  board.render(st, cur, prev);
  pal.title(titleOf(st));
  save(st);
  if (st.ended && !prev.ended) void post(st);
  if (!st.ended) { rankEl.textContent = ""; signInEl.hidden = true; }
}

confirmBox.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>("[data-confirm]");
  if (!b && e.target !== confirmBox) return;
  confirmBox.classList.remove("open");
  if (b?.dataset.confirm === "yes") play(asked, true);
});

// ---- the card cursor --------------------------------------------------

const COLS: readonly (readonly Category[])[] = [UPPER, LOWER];
const colOf = (c: Category) => (UPPER as readonly string[]).includes(c) ? 0 : 1;

/** Up or down within the column, skipping what cannot be scored; past the top, back to the dice. */
function vertical(dir: 1 | -1) {
  const opts = options(st);
  const col = COLS[colOf(cur.cat!)];
  for (let k = col.indexOf(cur.cat!) + dir; k >= 0 && k < col.length; k += dir) if (opts[col[k]] !== undefined) return point({ ...cur, cat: col[k] });
  if (dir < 0 && st.rolls < ROLLS) point({ ...cur, zone: "dice" });
}

/** To the other column, the open row nearest the same height. */
function across() {
  const opts = options(st);
  const at = COLS[colOf(cur.cat!)].indexOf(cur.cat!);
  const col = COLS[1 - colOf(cur.cat!)];
  const near = col.filter((c) => opts[c] !== undefined).sort((a, b) => Math.abs(col.indexOf(a) - at) - Math.abs(col.indexOf(b) - at) || col.indexOf(a) - col.indexOf(b))[0];
  if (near) point({ ...cur, cat: near });
}

/** Into the card, on the category that adds most. */
function toCard() {
  const best = bestOption(st);
  if (best) point({ ...cur, zone: "card", cat: best });
}

const ROLL_KEYS = new Set([" ", "r", "R"]);

window.addEventListener("keydown", (e) => {
  // Cmd and ctrl combos (cmd+k) are the panel's: surface.js forwards what the page leaves alone.
  if (e.metaKey || e.ctrlKey || e.altKey || !st) return;
  if (confirming()) {
    e.preventDefault();
    confirmBox.classList.remove("open");
    if (e.key === "Enter" || e.key === "y") play(asked, true);
    return;
  }
  document.body.classList.add("typing");
  const k = e.key;
  const handled = () => e.preventDefault();
  if (k === "y" || k === "Y") { handled(); play(moveOf("daily")!); return; }
  if (st.ended) {
    if (k === "Enter" || k === "n" || k === "N") { handled(); play({ type: "new" }); }
    return;
  }
  if (k === "n" || k === "N") { handled(); play({ type: "new" }); return; }
  if (ROLL_KEYS.has(k) || (k === "ArrowUp" && cur.zone === "dice")) {
    handled();
    // A held key rolls once: a second throw is never what a repeat means.
    if (!e.repeat) play({ type: "roll" });
    return;
  }
  if (k >= "1" && k <= "5") {
    handled();
    const die = Number(k) - 1;
    if (st.rolls > 0 && st.rolls < ROLLS) { cur = { ...cur, zone: "dice", die }; play({ type: "hold", die }); }
    return;
  }
  const opts = options(st);
  const inCard = cur.zone === "card" && !!cur.cat && opts[cur.cat] !== undefined;
  switch (k) {
    case "ArrowLeft": case "ArrowRight":
      handled();
      if (inCard) across();
      else if (cur.zone === "dice") point({ ...cur, die: (cur.die + (k === "ArrowLeft" ? 4 : 1)) % 5 });
      return;
    case "ArrowDown":
      handled();
      if (inCard) vertical(1);
      else toCard();
      return;
    case "ArrowUp":
      handled();
      if (inCard) vertical(-1);
      return;
    case "Enter":
      handled();
      if (e.repeat) return;
      if (inCard) play({ type: "score", category: cur.cat! });
      else if (st.rolls === 0) play({ type: "roll" });
      else if (st.rolls >= ROLLS) toCard();
      else play({ type: "hold", die: cur.die });
      return;
  }
});
// The keys' marks (the die ring, the Enter cap) show while the keys are in use; a mouse move hides them.
window.addEventListener("mousemove", (e) => { if (e.movementX || e.movementY) document.body.classList.remove("typing"); });

pal.onAction((id) => { const m = moveOf(id); if (m) play(m, true); });
pal.onTheme(() => board.render(st, cur));

pal.storage.onChange((key, value) => {
  if (!st || key !== "record" || !KEYS.includes(key as Key)) return;
  saved.record = value;
  const next = restore({ ...saved, state: st });
  if (next.record === st.record) return;
  st = next;
  board.render(st, cur);
  pal.send({ moved: true }).catch(() => {});
});

saved = Object.fromEntries(await Promise.all(KEYS.map(async (k) => [k, await pal.storage.get(k)])));
st = restore(saved);
if (st.rolls >= ROLLS) cur = { zone: "card", die: 0, cat: bestOption(st) };
board.render(st, cur);
pal.title(titleOf(st));
pal.ready();
