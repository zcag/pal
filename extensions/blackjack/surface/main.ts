// The table page: the state, the input, the save. A move from a key, a
// button or cmd+k (`pal.onAction`) is `apply` from game.ts, the rules the
// host tests; the new state is drawn (table.ts), saved whole under the
// key the extension reads ("state"), and the extension is told, so the
// view's actions follow the phase. New game from the page asks first;
// from cmd+k the panel already has.
import { DEFAULTS, RANKS, SUITS, apply, isState, newGame, type Action as Move, type Card, type Settings, type State } from "../game.ts";
import { MOVES, moveFor, titleOf } from "../moves.ts";
import { Table, preload } from "./table.ts";

/** What surface.js puts on `window.pal`, the parts this page uses. */
type Pal = {
  send(msg: unknown): Promise<unknown>;
  onAction(fn: (id: string) => void): void;
  storage: { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<void> };
  settings(): Promise<Record<string, unknown>>;
  onSettings(fn: (s: Record<string, unknown>) => void): void;
  title(text: string): void;
  ready(): void;
};
const pal = (window as unknown as { pal: Pal }).pal;

const KEY = "state";
const settingsOf = (raw: Record<string, unknown>): Settings => ({ ...DEFAULTS, ...(raw as Partial<Settings>) });

let s: Settings = DEFAULTS;
let st: State;
const table = new Table((m) => play(m));

/** Saves in order, each after the last, then says so: the extension re-reads and pushes the view's actions. */
let saving: Promise<unknown> = Promise.resolve();
const save = (snap: State) => { saving = saving.then(() => pal.storage.set(KEY, snap)).then(() => pal.send({ moved: true })).catch((e) => console.error("blackjack: save", e)); };

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

s = settingsOf(await pal.settings());
const stored = await pal.storage.get(KEY);
st = isState(stored) ? stored : newGame(s);
const deck: Card[] = SUITS.flatMap((u) => RANKS.map((r): Card => `${r}${u}`));
preload(deck);
table.render(st, undefined, s);
pal.title(titleOf(st, s));
pal.ready();
