// The table page: the state, the input, the save. A move from a key, a
// button or cmd+k (`pal.onAction`) is `apply` from game.ts, the rules the
// host tests; the new state is drawn (table.ts), saved under the keys
// the extension reads (progress.ts: what changed of the hand, the chips,
// the record and the bests), and the extension is told, so the view's
// actions follow the phase. A new best goes to its board (`pal.score`).
// Chips or a record that sync brought in (another machine's night, merged)
// replace the ones in memory at once, so the next move does not show, or
// write back, the old ones. New game from the page asks first; from cmd+k
// the panel already has.
import { DEFAULTS, RANKS, SUITS, apply, type Action as Move, type Card, type Settings, type State } from "../game.ts";
import { MOVES, moveFor, titleOf } from "../moves.ts";
import { KEYS as STORED, changes, restore, scores, type Key, type Saved } from "../progress.ts";
import { Table, preload } from "./table.ts";
import type { SurfaceKit } from "@zcag/pal";

declare const pal: SurfaceKit;

const settingsOf = (raw: Record<string, unknown>): Settings => ({ ...DEFAULTS, ...(raw as Partial<Settings>) });

let s: Settings = DEFAULTS;
let st: State;
const table = new Table((m) => play(m));

/** What storage holds, as this page last wrote or heard it. */
let saved: Saved = {};
/** Saves in order, each after the last, then says so: the extension re-reads and pushes the view's actions. */
let saving: Promise<unknown> = Promise.resolve();
const save = (snap: State) => {
  const ch = changes(snap, saved);
  Object.assign(saved, ch);
  saving = saving.then(() => Promise.all(Object.entries(ch).map(([k, v]) => pal.storage.set(k, v)))).then(() => pal.send({ moved: true })).catch((e) => console.error("blackjack: save", e));
  for (const [board, value] of scores(ch)) pal.score(board, value).catch((e) => console.error(`blackjack: score ${board}`, e));
};

const confirmBox = document.getElementById("confirm")!;
const confirming = () => confirmBox.classList.contains("open");

function play(m: Move, confirmed = false) {
  if (m === "new" && !confirmed) { confirmBox.classList.add("open"); return; }
  const next = apply(st, m, s);
  if (next === st) return;
  const prev = st;
  st = next;
  table.render(st, prev, s);
  pal.title(titleOf(st, s));
  save(st);
}

confirmBox.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>("[data-confirm]");
  if (!b && e.target !== confirmBox) return;
  confirmBox.classList.remove("open");
  if (b?.dataset.confirm === "yes") play("new", true);
});

const KEYS: Record<string, string> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", Enter: "enter", "=": "+", _: "-" };

window.addEventListener("keydown", (e) => {
  // Cmd and ctrl combos (cmd+k) are the panel's: surface.js forwards what the page leaves alone.
  if (e.metaKey || e.ctrlKey || e.altKey || !st) return;
  const key = KEYS[e.key] ?? e.key.toLowerCase();
  if (confirming()) {
    e.preventDefault();
    confirmBox.classList.remove("open");
    if (key === "enter" || key === "y") play("new", true);
    return;
  }
  const m = moveFor(key, st, s);
  if (!m) return;
  e.preventDefault();
  // A held key repeats the bet's steps only: a held hit is not a thing anyone means.
  if (e.repeat && !m.startsWith("bet-")) return;
  table.press(m);
  play(m);
});

pal.onAction((id) => { if (id in MOVES) play(id as Move, true); });
pal.onSettings((raw) => { s = settingsOf(raw); table.render(st, st, s); pal.title(titleOf(st, s)); });
new ResizeObserver(() => { if (st) table.render(st, st, s); }).observe(document.getElementById("felt")!);

pal.storage.onChange((key, value) => {
  if (!st || key === "state" || !STORED.includes(key as Key)) return;
  saved[key as Key] = value;
  const next = restore({ ...saved, state: st }, s);
  if (next.bankroll === st.bankroll && next.stats === st.stats) return;
  const prev = st;
  st = next;
  table.render(st, prev, s);
  pal.title(titleOf(st, s));
  pal.send({ moved: true }).catch(() => {});
});

s = settingsOf(await pal.settings());
saved = Object.fromEntries(await Promise.all(STORED.map(async (k) => [k, await pal.storage.get(k)])));
st = restore(saved, s);
const deck: Card[] = SUITS.flatMap((u) => RANKS.map((r): Card => `${r}${u}`));
preload(deck);
table.render(st, undefined, s);
pal.title(titleOf(st, s));
pal.ready();
