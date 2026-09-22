// The bar popover as a render tree (`View` in `@zcag/pal`), pure: index.ts
// builds the state from the cached todos and the popover's own cursor,
// the fixture renders a made-up state through the same function, the
// tests assert on it. Today's todos as rows (the overdue ones first, a
// red day; then what is due today and what sits in the sections the bar
// counts as today's), each with its flag, its section and tags under the
// text and the day on the right, a cursor (`selected`) the arrows move
// and a click sets, and the keys as keycap hints. `n` turns the search
// row into a field whose Enter adds a todo, as the timer's does.
import { POPOVER_W, column, keyHint, row, text, type Action, type View, type ViewNode } from "@zcag/pal";
import type { Due } from "./when.ts";

/** One row of the popover, everything already formatted. */
export type BarRow = {
  /** The todo's id: the action a click runs is `focus:` + this. */
  id: string;
  text: string;
  section: string;
  tags: string[];
  urgent: boolean;
  due?: Due;
};

export type BarState = {
  rows: BarRow[];
  /** Which row the keys act on. */
  focus: number;
  /** The counts the strip shows, for the title. */
  overdue: number;
  today: number;
  /** The field is open (`n`): the search row takes a todo. */
  field?: boolean;
  /** The section a todo typed in the field lands in unless the line says. */
  section: string;
};

/** A row's inner width (its own padding of one step a side), then the text column left after the flag and the day (two gaps of two steps). */
const ROW_W = POPOVER_W - 8, FLAG_W = 16, DUE_W = 76, TEXT_W = ROW_W - FLAG_W - DUE_W - 2 * 8;
/** md-checkbox-blank-circle-outline, md-alert-circle. */
const OPEN = "\u{f0130}", URGENT = "\u{f0028}";

const dueColor = (d: Due): "destructive" | "amber" | "blue" | "faint" => (d.color === "red" ? "destructive" : d.color === "grey" ? "faint" : d.color);

function rowNode(r: BarRow, focused: boolean): ViewNode {
  const sub = [r.section, ...r.tags.map((t) => `#${t}`)].join(" · ");
  return row(
    [
      text(r.urgent ? URGENT : OPEN, { key: "f", style: "glyph", size: "sm", color: r.urgent ? "destructive" : "faint", width: FLAG_W }),
      column([text(r.text, { size: "md", weight: "semibold", width: TEXT_W }), text(sub, { size: "xs", color: "muted", width: TEXT_W })], { key: "t", gap: 0 }),
      text(r.due?.text ?? "", { size: "xs", color: r.due ? dueColor(r.due) : "faint", width: DUE_W, align: "end" }),
    ],
    { key: r.id, padding: 1, minHeight: 44, radius: true, surface: focused ? "elevated" : undefined, selected: focused || undefined, action: `focus:${r.id}`, transition: { enter: "fade", exit: "fade" } },
  );
}

function hints(st: BarState): ViewNode {
  if (st.field) return row([...keyHint("enter", `add to ${st.section}`, { action: "add" }), ...keyHint("escape", "close", { action: "cancel" }), text("#tag · ! · /section · a day at the end", { style: "muted", size: "xs" })], { key: "hints", gap: 1, minHeight: 22 });
  const kids: ViewNode[] = [];
  if (st.rows.length) kids.push(...keyHint("enter", "done", { action: "complete" }), ...keyHint("u", "urgent", { action: "urgent" }));
  kids.push(...keyHint("n", "new", { action: "new" }), ...keyHint("o", "odak", { action: "open-odak" }), ...keyHint("p", "pal", { action: "open-pal" }));
  return row(kids, { key: "hints", gap: 1, minHeight: 22 });
}

/** Every action the popover answers to; the first listed is Enter (Add while the field is open). */
export function actions(st: BarState): Action[] {
  const cur = st.rows[st.focus];
  const acts: Action[] = [];
  if (st.field) acts.push({ id: "add", title: `Add to ${st.section}` });
  if (cur) {
    acts.push({ id: "complete", title: "Complete", shortcut: "x" });
    acts.push({ id: "urgent", title: cur.urgent ? "Not urgent" : "Mark urgent", shortcut: "u" });
    acts.push({ id: "tomorrow", title: "Snooze to tomorrow", shortcut: "t" });
  }
  if (!st.field) acts.push({ id: "new", title: "New todo", shortcut: "n" });
  acts.push({ id: "open-odak", title: "Open odak", shortcut: "o" }, { id: "open-pal", title: "Open in pal", shortcut: "p" }, { id: "refresh", title: "Refresh", shortcut: "r" });
  if (st.field) acts.push({ id: "cancel", title: "Close the field" });
  acts.push({ id: "down", title: "Next row", shortcut: ["down", "j"], hidden: true }, { id: "up", title: "Previous row", shortcut: ["up", "k"], hidden: true });
  for (const r of st.rows) acts.push({ id: `focus:${r.id}`, title: `Go to ${r.text}`, hidden: true });
  return acts;
}

export function render(st: BarState): View {
  const kids: ViewNode[] = [];
  if (st.rows.length) kids.push(column(st.rows.map((r, i) => rowNode(r, i === st.focus)), { key: "rows", gap: 0 }));
  else kids.push(column([
    { type: "tile", key: "zero", width: 48, height: 48, text: "✓", color: "green", fill: "soft" },
    text("Nothing due today", { style: "title", key: "zero-t" }),
    text(st.field ? "Type a todo: Enter adds it" : "n adds a todo, o opens odak", { style: "muted", size: "sm", align: "center", key: "zero-s" }),
  ], { key: "empty", gap: 2, align: "center", padding: 2 }));
  kids.push(hints(st));
  const tree = column(kids, { key: "compact", padding: 3, gap: 2 });
  const parts = [st.overdue ? `${st.overdue} overdue` : "", st.today ? `${st.today} today` : ""].filter(Boolean);
  return {
    tree,
    actions: actions(st),
    title: st.field ? "New todo" : parts.length ? parts.join(", ") : "odak",
    id: "today",
    keys: "actions",
    ...(st.field && { input: { placeholder: "Todo, #tag, !, tomorrow", submit: "add", cancel: "cancel" } }),
  };
}
