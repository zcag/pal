// odak: the owner's todo file in the panel. Four palettes over one client
// (api.ts) and one data layer (data.ts): Todos (every open one, the
// overdue and today's on top, then the file's sections in order), Add
// Todo (one line read as you type: when.ts), Search Todos (open and
// completed) and Completed. A todo is its odak id everywhere (a hash of
// its line, so an edit gives it a new one and the cache refetches behind
// every write). One bar item, `today`: what is due today or sits in
// today's sections, red while anything is overdue, hidden at zero, with a
// popover (view.ts) that completes and adds.
import { ago, argsForm, bar, clipboard, dayName, dayNameYear, errorMessage, failed, hint, mdEscape, now, oneLine, selection, storage, tinted, toast, truncate, view, type Action, type Arg, type BarCtx, type BarItem, type Ctx, type Detail, type Effect, type Extension, type Form, type FormValues, type Item, type LinkParams, type Metadata, type TagColor } from "@zcag/pal";
import { ApiError, AuthError, EXTENSION, baseUrl, conf, log, todaySections, webUrl } from "./api.ts";
import { childrenOf, create, drop, find, isDueToday, isOverdue, isWaiting, move, remove, sectionNames, sections, todos, todosAtHand, toggle, update, type Todo } from "./data.ts";
import { render as renderBar, type BarRow, type BarState } from "./view.ts";
import { addDays, dayLabel, dayOf, due, isoDay, linkIn, parseAdd, parseWhen, waits } from "./when.ts";

/** Nerd Font `md-` glyphs: an open circle, a ticked circle, alert, plus, web, undo, key, alert-outline, search, clipboard, selection, check-all, clock. */
const ICON = { open: "\u{f0130}", done: "\u{f0134}", urgent: "\u{f0028}", plus: "\u{f0415}", web: "\u{f059f}", undo: "\u{f054c}", key: "\u{f030b}", alert: "\u{f05d6}", search: "\u{f0349}", clipboard: "\u{f0a38}", selection: "\u{f0489}", check: "\u{f012d}", clock: "\u{f0150}" } as const;
const BAR_GLYPH = ICON.done;
/** How long the Undo row and the "Added" row stay after a complete or an add. */
const RECENT_MS = 60_000;
/** Completion times kept in storage (`completed`): the newest this many. */
const COMPLETED_KEPT = 100;
/** A selection or a clipboard longer than this is not offered as a todo. */
const PREFILL_MAX = 300;

// ---- rows the palettes share -----------------------------------------------------

/** What a failed listing shows instead of rows: the setting to fill, the key to fix, the server to reach, each naming the fix. */
function failure(e: unknown): Item[] {
  if (e instanceof AuthError) {
    return e.which === "url"
      ? [hint("url", "Set the odak address", "Settings › Extensions › odak: the server, e.g. http://host:8761", { actions: [{ id: "settings", title: "Open settings" }], icon: ICON.key })]
      : [hint("key", "Set the odak API key", "The server's ODAK_API_KEY, under Settings › Extensions › odak", { actions: [{ id: "settings", title: "Open settings" }], icon: ICON.key })];
  }
  if (e instanceof ApiError && e.unauthorized) return [hint("key", "odak rejected the key", "It is not the server's ODAK_API_KEY; set it under Settings › Extensions › odak", { actions: [{ id: "settings", title: "Open settings" }], icon: ICON.alert })];
  if (e instanceof ApiError && e.unreachable) return [hint("down", "odak is not answering", `${baseUrl()}: is the server up and reachable from here? cmd+r tries again`, { actions: [{ id: "open", title: "Open odak in the browser" }], icon: ICON.alert })];
  log(errorMessage(e));
  return [hint("error", "odak did not answer", `${errorMessage(e)}; cmd+r tries again`, { icon: ICON.alert })];
}

const pickHint = (id: string, action?: string): Effect | void => {
  if (id === "hint:url" || id === "hint:key") return { open: `pal://settings/extensions?anchor=extensions:${EXTENSION}:${id === "hint:url" ? "url" : "api_key"}` };
  if (id === "hint:down" && action === "open") return { open: webUrl() };
};

/** Rows or the failure hint, never a thrown listing: the panel would show an error where a sentence does. */
const guard = async (f: () => Promise<Item[]>): Promise<Item[]> => { try { return await f(); } catch (e) { return failure(e); } };

const str = (v: unknown) => (typeof v === "string" ? v : "");
const TAG_COLORS: TagColor[] = ["blue", "green", "violet", "teal", "pink", "amber"];
/** A tag's colour, the same every time: its letters folded into the palette. */
export const tagColor = (tag: string): TagColor => TAG_COLORS[[...tag.toLowerCase()].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 997, 7) % TAG_COLORS.length];
const tagsOf = (t: Todo) => (t.tags ?? []).map((x) => ({ tag: x, color: tagColor(x) }));
/** The file's spelling of the section `wanted` names (case aside), else the file's Inbox, else its first section, else Inbox: a section the file lacks would land the line under its last heading. */
export function targetSection(names: string[], wanted?: string): string {
  const find = (n: string) => names.find((x) => x.toLowerCase() === n.toLowerCase());
  return (wanted && find(wanted)) || find("Inbox") || names[0] || "Inbox";
}
const defaultSection = (names: string[]) => targetSection(names, conf().default_section);

// ---- the todo row -------------------------------------------------------------------

/** What has just been completed from pal, for the Undo row and the Completed palette's times. */
let lastDone: { ids: string[]; text: string; at: number } | undefined;
let lastAdded: { id: string; text: string; section: string; at: number } | undefined;

const completedTimes = () => storage.get<Record<string, number>>("completed", EXTENSION).then((v) => v ?? {}).catch(() => ({} as Record<string, number>));
async function recordCompleted(ids: string[], at: number) {
  const all = await completedTimes();
  for (const id of ids) all[id] = at;
  const kept = Object.fromEntries(Object.entries(all).sort((a, b) => b[1] - a[1]).slice(0, COMPLETED_KEPT));
  await storage.set("completed", kept, EXTENSION).catch(() => {});
}

function openActions(t: Todo): Action[] {
  return [
    { id: "complete", title: "Complete", multi: true },
    { id: "edit", title: "Edit…", shortcut: "cmd+e" },
    { id: "tomorrow", title: "Snooze to tomorrow", shortcut: "cmd+t" },
    { id: "snooze", title: "Snooze…", shortcut: "cmd+s" },
    { id: "move", title: "Move to section…", shortcut: "cmd+m" },
    { id: "urgent", title: t.urgent ? "Not urgent" : "Mark urgent", shortcut: "cmd+u" },
    { id: "subtask", title: "Add subtask…", shortcut: "cmd+n" },
    ...(linkIn(t.text) ? [{ id: "link", title: "Open link", shortcut: "cmd+l" }] : []),
    { id: "open", title: "Open odak", shortcut: "cmd+o" },
    { id: "copy", title: "Copy text", shortcut: "cmd+c" },
    { id: "copy-link", title: "Copy link", shortcut: "cmd+shift+c" },
    { id: "delete", title: "Delete", shortcut: "cmd+d", style: "destructive", confirm: "Delete this todo? Its subtasks go with it.", multi: true },
  ];
}
const DONE_ACTIONS: Action[] = [
  { id: "reopen", title: "Reopen", multi: true },
  { id: "copy", title: "Copy text", shortcut: "cmd+c" },
  { id: "open", title: "Open odak", shortcut: "cmd+o" },
  { id: "delete", title: "Delete", shortcut: "cmd+d", style: "destructive", confirm: "Delete this todo?", multi: true },
];

function detailOf(t: Todo, all: Todo[], t0: number): Detail {
  const kids = childrenOf(all, t.id);
  const parent = t.parent_id ? all.find((x) => x.id === t.parent_id) : undefined;
  const d = due(t.deadline, t0), w = waits(t.trigger, t0), link = linkIn(t.text);
  const meta: Metadata[] = [
    { label: "Section", value: t.section },
    ...(t.tags?.length ? [{ label: "Tags", tags: tagsOf(t).map((x) => ({ text: x.tag, color: x.color })) }] : []),
    ...(t.urgent ? [{ label: "Urgent", tags: [{ text: "urgent", color: "red" }] }] : []),
    ...(d ? [{ label: "Due", value: Number.isFinite(d.days) ? `${dayNameYear(dayOf(t.deadline)!)} (${d.text})` : d.text }] : []),
    ...(t.trigger ? [{ label: "Waits until", value: w ? dayNameYear(dayOf(t.trigger)!) : `${t.trigger} (come)` }] : []),
    ...(parent ? [{ label: "Under", value: truncate(parent.text, 80) }] : []),
    ...(kids.length ? [{ label: "Subtasks", value: `${kids.filter((k) => !k.done).length} open of ${kids.length}` }] : []),
    ...(link ? [{ label: "Link", link: { text: truncate(link.replace(/^https?:\/\//, ""), 60), href: link } }] : []),
    ...(t.file_ref ? [{ label: "File", value: t.file_ref }] : []),
    { label: "Id", value: t.id },
  ];
  const lines = [t.done ? `~~${mdEscape(t.text)}~~` : `**${mdEscape(t.text)}**`];
  if (kids.length) lines.push("", ...kids.map((k) => `- [${k.done ? "x" : " "}] ${mdEscape(k.text)}`));
  return { markdown: lines.join("\n"), metadata: meta };
}

/** One todo as a row: the text, the parent under it for a subtask, the tags and the day on the right, the flag as a red mark. */
function todoRow(t: Todo, all: Todo[], t0: number, section?: string, extra: Partial<Item> = {}): Item {
  const d = due(t.deadline, t0), w = waits(t.trigger, t0);
  const parent = t.parent_id ? all.find((x) => x.id === t.parent_id) : undefined;
  const kids = childrenOf(all, t.id).filter((k) => !k.done);
  return {
    id: t.id,
    name: oneLine(t.text),
    subtitle: parent ? `↳ ${oneLine(truncate(parent.text, 70))}` : undefined,
    icon: t.done ? tinted(ICON.done, "green") : t.urgent ? tinted(ICON.urgent, "red") : ICON.open,
    keywords: [t.section, ...(t.tags ?? []), ...(t.urgent ? ["urgent"] : []), ...(d ? [d.text.split(" ")[0]] : []), ...(t.done ? ["done", "completed"] : [])],
    ...(section !== undefined && { section }),
    accessories: [
      ...tagsOf(t),
      ...(d && !t.done ? [{ tag: d.text, color: d.color }] : []),
      ...(w && !t.done ? [{ tag: w, color: "grey" }] : []),
      ...(kids.length ? [{ text: `${kids.length} subtask${kids.length === 1 ? "" : "s"}` }] : []),
    ],
    detail: detailOf(t, all, t0),
    actions: t.done ? DONE_ACTIONS : openActions(t),
    ...extra,
  };
}

// ---- forms: edit, snooze, move -------------------------------------------------------

const parseTags = (s: string) => [...new Set(s.split(/[\s,]+/).map((x) => x.replace(/^#/, "").trim()).filter(Boolean))];

async function editForm(t: Todo, values?: FormValues, errors?: Record<string, string>): Promise<Form> {
  const names = await sectionNames();
  return {
    id: t.id,
    title: `Edit ${truncate(t.text, 40)}`,
    fields: [
      { kind: "text", id: "text", label: "Todo", required: true, default: values ? str(values.text) : t.text },
      names.length
        ? { kind: "select", id: "section", label: "Section", options: names.map((n) => ({ id: n, title: n })), default: values ? str(values.section) : targetSection(names, t.section) }
        : { kind: "text", id: "section", label: "Section", default: values ? str(values.section) : t.section },
      { kind: "text", id: "tags", label: "Tags", default: values ? str(values.tags) : (t.tags ?? []).join(", "), placeholder: "work, personal", description: "Comma or space separated; # optional." },
      { kind: "text", id: "due", label: "Due", default: values ? str(values.due) : t.deadline ?? "", placeholder: "tomorrow, fri, next mon, in 3 days, 2026-10-01", description: "A day in words or as a date. odak keeps a day once set: it can be moved, not cleared." },
      { kind: "checkbox", id: "urgent", label: "Urgent", text: "Flag it", default: values ? values.urgent === true : !!t.urgent },
    ],
    submit: { id: "edit:save", title: "Save" },
    errors,
  };
}

async function saveEdit(t: Todo, values: FormValues): Promise<Effect> {
  const text = str(values.text).trim(), dueText = str(values.due).trim(), section = str(values.section).trim();
  const errors: Record<string, string> = {};
  if (!text) errors.text = "Required";
  let deadline: string | undefined;
  if (dueText) { const day = parseWhen(dueText, now()); if (day === undefined) errors.due = "Not a day: tomorrow, fri, next mon, in 3 days, 20 sep, 2026-10-01"; else deadline = isoDay(day); }
  else if (t.deadline) errors.due = "odak keeps a day once set; move it instead";
  if (Object.keys(errors).length) return { form: await editForm(t, values, errors) };
  try {
    const made = await update(t.id, { text, tags: parseTags(str(values.tags)), urgent: values.urgent === true, ...(deadline && deadline !== t.deadline && { deadline }) });
    if (section && section !== t.section) await move(made.id, section);
  } catch (e) { return { form: await editForm(t, values, { text: errorMessage(e) }) }; }
  bar.refresh("today").catch(() => {});
  return toast("Saved", truncate(text, 60));
}

/** The days Snooze offers: tomorrow, in 3 days, next Monday, next week, in a month, each with its day. */
export function snoozeOptions(t0: number): { id: string; title: string }[] {
  const monday = ((1 - new Date(t0).getDay() + 6) % 7) + 1;
  return [[1, "Tomorrow"], [3, "In 3 days"], [monday, "Next Monday"], [7, "Next week"], [30, "In a month"]].map(([n, title]) => { const day = addDays(t0, n as number); return { id: isoDay(day), title: `${title}, ${dayName(day)}` }; });
}

const snoozeForm = (t: Todo, values?: FormValues, errors?: Record<string, string>): Form => ({
  id: t.id,
  title: `Snooze ${truncate(t.text, 40)}`,
  fields: [
    { kind: "select", id: "day", label: "Until", options: snoozeOptions(now()), default: values ? str(values.day) : snoozeOptions(now())[0].id },
    { kind: "text", id: "typed", label: "Or a day", default: values ? str(values.typed) : "", placeholder: "fri, 20 sep, in 2 weeks, 2026-10-01", description: "Typed here, it wins over the choice above." },
  ],
  submit: { id: "snooze:save", title: "Snooze" },
  errors,
});

async function snoozeTo(t: Todo, day: number): Promise<Effect> {
  try { await update(t.id, { deadline: isoDay(day), urgent: !!t.urgent }); } catch (e) { return failed("snooze", e); }
  bar.refresh("today").catch(() => {});
  return toast(`Snoozed to ${dayLabel(day, now())}`, truncate(t.text, 60));
}

async function saveSnooze(t: Todo, values: FormValues): Promise<Effect> {
  const typed = str(values.typed).trim();
  const day = typed ? parseWhen(typed, now()) : dayOf(str(values.day));
  if (day === undefined) return { form: snoozeForm(t, values, { typed: "Not a day: fri, 20 sep, in 2 weeks, 2026-10-01" }) };
  return snoozeTo(t, day);
}

async function moveForm(t: Todo, errors?: Record<string, string>): Promise<Form> {
  const names = await sectionNames();
  return {
    id: t.id,
    title: `Move ${truncate(t.text, 40)}`,
    fields: [names.length
      ? { kind: "select", id: "section", label: "To", options: names.map((n) => ({ id: n, title: n })), default: targetSection(names, t.section) }
      : { kind: "text", id: "section", label: "To", required: true, default: t.section }],
    submit: { id: "move:save", title: "Move" },
    errors,
  };
}

async function saveMove(t: Todo, values: FormValues): Promise<Effect> {
  const section = str(values.section).trim();
  if (!section) return { form: await moveForm(t, { section: "Required" }) };
  try { await move(t.id, section); } catch (e) { return { form: await moveForm(t, { section: errorMessage(e) }) }; }
  bar.refresh("today").catch(() => {});
  return toast(`Moved to ${section}`, truncate(t.text, 60));
}

// ---- picks on a todo -----------------------------------------------------------------------

async function complete(ids: string[], reopen = false): Promise<Effect> {
  const done: Todo[] = [];
  for (const id of ids) {
    const t = await find(id);
    if (!t || t.done !== reopen) continue;
    try { done.push(await toggle(id)); } catch (e) { return failed(reopen ? "reopen" : "complete", e); }
  }
  bar.refresh("today").catch(() => {});
  if (!done.length) return { keep: true };
  const at = now(), text = done.length === 1 ? done[0].text : `${done.length} todos`;
  if (reopen) return toast("Reopened", truncate(text, 60));
  lastDone = { ids: done.map((t) => t.id), text, at };
  await recordCompleted(lastDone.ids, at);
  return toast("Done", truncate(text, 60));
}

async function pickTodo(t: Todo, action: string | undefined, ctx?: Ctx): Promise<Effect | void> {
  const ids = ctx?.ids ?? [t.id];
  switch (action) {
    case "edit:save": return saveEdit(t, ctx?.values ?? {});
    case "snooze:save": return saveSnooze(t, ctx?.values ?? {});
    case "move:save": return saveMove(t, ctx?.values ?? {});
    case "edit": return { form: await editForm(t) };
    case "snooze": return { form: snoozeForm(t) };
    case "tomorrow": return snoozeTo(t, addDays(now(), 1));
    case "move": return { form: await moveForm(t) };
    case "urgent": {
      try { await update(t.id, { urgent: !t.urgent }); } catch (e) { return failed("change the flag", e); }
      bar.refresh("today").catch(() => {});
      return toast(t.urgent ? "Not urgent" : "Urgent", truncate(t.text, 60));
    }
    case "subtask": return { push: { extension: EXTENSION, palette: "add", args: { parent: t.id }, title: `Subtask of ${truncate(t.text, 30)}` } };
    case "link": return { open: linkIn(t.text) ?? webUrl() };
    case "open": return { open: webUrl() };
    case "copy": return { copy: t.text };
    case "copy-link": return { copy: linkIn(t.text) ?? webUrl() };
    case "delete": {
      let n = 0;
      for (const id of ids) { try { await remove(id); n++; } catch (e) { return failed("delete", e); } }
      bar.refresh("today").catch(() => {});
      return toast(n === 1 ? "Deleted" : `Deleted ${n}`, n === 1 ? truncate(t.text, 60) : undefined);
    }
    case "reopen": return complete(ids, true);
    default: return t.done ? complete(ids, true) : complete(ids);
  }
}

// ---- Todos: the open ones by section ---------------------------------------------------------

const ADD_ARGS: Arg[] = [{ id: "text", placeholder: "Todo", required: true }];

/** The section order: the file's headings, then any a todo names that the list lacks, in the order met. */
function sectionOrder(all: Todo[], names: string[]): string[] {
  const order = [...names];
  for (const t of all) if (!order.includes(t.section)) order.push(t.section);
  return order;
}

function commandRows(): Item[] {
  const host = baseUrl().replace(/^https?:\/\//, "");
  return [
    // The text is typed in the bar (`args`); cmd+enter opens the Add palette, which reads the line back as you type.
    { id: "cmd:add", name: "New todo", subtitle: "Typed in the bar: #tag, ! for urgent, /section, a day at the end", icon: ICON.plus, keywords: ["add", "create", "new"], args: ADD_ARGS, actions: [{ id: "add", title: "Add", args: true }, { id: "palette", title: "Open Add Todo", shortcut: "cmd+enter" }] },
    { id: "cmd:open", name: "Open odak", subtitle: host || undefined, icon: ICON.web, keywords: ["web", "browser"], actions: [{ id: "open", title: "Open odak" }] },
  ];
}

async function todoRows(ctx?: Ctx): Promise<Item[]> {
  const refresh = !!ctx?.refresh;
  const [all, secs] = await Promise.all([todos(refresh), sectionNames(refresh)]);
  const t0 = now();
  const rows: Item[] = commandRows();
  if (lastDone && t0 - lastDone.at < RECENT_MS) rows.push({ id: "undo", name: `Undo: reopen ${truncate(lastDone.text, 50)}`, subtitle: `Completed ${ago(lastDone.at)}`, icon: ICON.undo, keywords: ["undo", "reopen"], actions: [{ id: "undo", title: "Reopen" }] });
  const open = all.filter((t) => !t.done);
  const overdue = open.filter((t) => isOverdue(t, t0)).sort((a, b) => (a.deadline ?? "").localeCompare(b.deadline ?? ""));
  const today = open.filter((t) => isDueToday(t, t0));
  const placed = new Set([...overdue, ...today].map((t) => t.id));
  const waiting = open.filter((t) => !placed.has(t.id) && isWaiting(t, t0));
  for (const t of waiting) placed.add(t.id);
  for (const t of overdue) rows.push(todoRow(t, all, t0, "Overdue"));
  for (const t of today) rows.push(todoRow(t, all, t0, "Due today"));
  for (const s of sectionOrder(open, secs)) for (const t of open) if (t.section === s && !placed.has(t.id)) rows.push(todoRow(t, all, t0, s));
  for (const t of waiting) rows.push(todoRow(t, all, t0, "Not yet"));
  if (!open.length) rows.push(hint("none", "Nothing to do", all.length ? "Everything is checked off; Completed lists what was" : "New todo above starts the list", { icon: ICON.check }));
  return rows;
}

/** The root's Now section: what is overdue or due today, from the cache alone (asked on every show, so never a fetch). */
function suggestRows(): Item[] {
  const all = todosAtHand();
  if (!all) return [];
  const t0 = now();
  return [...all.filter((t) => isOverdue(t, t0)), ...all.filter((t) => isDueToday(t, t0))].slice(0, 3).map((t) => todoRow(t, all, t0, "Todos"));
}

async function pickCommand(id: string, action?: string, ctx?: Ctx): Promise<Effect | void> {
  if (id === "cmd:open") return { open: webUrl() };
  if (id === "cmd:add") {
    if (action === "palette") return { push: { extension: EXTENSION, palette: "add" } };
    const line = str(ctx?.values?.text).trim();
    // Without the bar's value (a hotkey, `pal run`): the same field as a form.
    if (!ctx?.values || !line) return { form: argsForm(ADD_ARGS, "New todo", { id: "add", title: "Add" }, ctx?.values && { text: "Required" }) };
    return addLine(line, undefined, "hud");
  }
  if (id === "undo") {
    if (!lastDone) return { keep: true };
    const ids = lastDone.ids;
    lastDone = undefined;
    return complete(ids, true);
  }
}

// ---- Add Todo: one line read as you type -------------------------------------------------------

type AddArgs = { parent?: string };

/** The parent a pushed Add level is for, when it still exists. */
const parentOf = async (ctx?: Ctx): Promise<Todo | undefined> => { const a = ctx?.args as AddArgs | undefined; return a?.parent ? find(a.parent) : undefined; };

/** The line as a preview row: what will be created, the tags and the day on the right, the section and the day's name in the subtitle. */
function previewRow(line: string, names: string[], parent: Todo | undefined, t0: number): Item {
  const p = parseAdd(line, t0, names);
  if (!p.text) return hint("empty", "Nothing to add yet", "The tags, flag and day were read; the todo needs words", { icon: ICON.plus });
  const section = parent?.section ?? (p.section ? targetSection(names, p.section) : defaultSection(names));
  const d = due(p.deadline, t0), w = waits(p.trigger, t0);
  const where = [parent ? `Subtask of ${truncate(parent.text, 40)}` : section, d ? (Number.isFinite(d.days) ? `due ${dayLabel(dayOf(p.deadline)!, t0)}` : `due ${d.text}`) : "", w ?? "", p.urgent ? "urgent" : ""].filter(Boolean).join(" · ");
  return {
    id: `new:${line}`,
    name: p.text,
    subtitle: where,
    icon: p.urgent ? tinted(ICON.urgent, "red") : ICON.plus,
    accessories: [...p.tags.map((x) => ({ tag: x, color: tagColor(x) })), ...(d ? [{ tag: d.text, color: d.color }] : [])],
    actions: [{ id: "add", title: "Add" }, { id: "another", title: "Add and keep the line", shortcut: "cmd+enter" }, { id: "copy-line", title: "Copy the line", shortcut: "cmd+shift+c" }],
  };
}

/** The empty Add level: what to type, what was just added (with Undo), the selection and the clipboard as todos. */
async function emptyAddRows(parent: Todo | undefined, names: string[], t0: number): Promise<Item[]> {
  const rows: Item[] = [];
  if (parent) rows.push(hint("parent", `Subtask of ${truncate(parent.text, 60)}`, `Type it; it lands under the parent in ${parent.section}`, { icon: ICON.plus }));
  else rows.push(hint("type", "Type a todo", `Lands in ${defaultSection(names)}; #tag, ! for urgent, /section, a day at the end: tomorrow, fri, next mon, in 3 days, 20 sep`, { icon: ICON.plus }));
  if (lastAdded && t0 - lastAdded.at < RECENT_MS) rows.push({ id: `added:${lastAdded.id}`, name: `Added to ${lastAdded.section}: ${truncate(lastAdded.text, 50)}`, subtitle: ago(lastAdded.at), icon: tinted(ICON.check, "green"), actions: [{ id: "undo-add", title: "Undo (delete it)", style: "destructive" }] });
  const sel = await selection.text().catch(() => null);
  const line = (s: string | null | undefined) => { const l = oneLine(s ?? ""); return l && l.length <= PREFILL_MAX ? l : ""; };
  const s = line(sel);
  if (s) rows.push({ id: `sel:${s}`, name: `Add the selected text: ${truncate(s, 60)}`, subtitle: `As typed, into ${parent?.section ?? defaultSection(names)}`, icon: ICON.selection, keywords: ["selection"], actions: [{ id: "add", title: "Add" }, { id: "edit", title: "Edit first", shortcut: "cmd+enter" }] });
  const c = await clipboard.current().catch(() => null);
  const ct = c?.kind === "text" ? line(c.text) : "";
  if (ct && ct !== s) rows.push({ id: `clip:${ct}`, name: `Add the clipboard: ${truncate(ct, 60)}`, subtitle: `As typed, into ${parent?.section ?? defaultSection(names)}`, icon: ICON.clipboard, keywords: ["clipboard", "paste"], actions: [{ id: "add", title: "Add" }, { id: "edit", title: "Edit first", shortcut: "cmd+enter" }] });
  return rows;
}

async function addRows(query = "", ctx?: Ctx): Promise<Item[]> {
  const t0 = now();
  // The sections first and unguarded: a missing address or key is the hint row here, not a failure on Enter.
  await sections();
  const [names, parent] = await Promise.all([sectionNames(), parentOf(ctx)]);
  return query.trim() ? [previewRow(query, names, parent, t0)] : emptyAddRows(parent, names, t0);
}

/** Creates the todo the line describes; the answer hides with a HUD line (`hud`) or keeps the panel with a toast (`toast`). */
async function addLine(line: string, parent: Todo | undefined, answer: "hud" | "toast"): Promise<Effect> {
  const t0 = now();
  const names = await sectionNames();
  const p = parseAdd(line, t0, names);
  if (!p.text) return toast("Nothing to add", "The todo needs words", "failure");
  const section = parent?.section ?? (p.section ? targetSection(names, p.section) : defaultSection(names));
  let made: Todo;
  try { made = await create({ text: p.text, section, tags: p.tags.length ? p.tags : undefined, urgent: p.urgent || undefined, deadline: p.deadline, trigger: p.trigger, parent_id: parent?.id }); }
  catch (e) { return failed("add the todo", e); }
  lastAdded = { id: made.id, text: made.text, section: made.section, at: t0 };
  bar.refresh("today").catch(() => {});
  const what = `Added to ${parent ? `${made.section} under ${truncate(parent.text, 30)}` : made.section}`;
  return answer === "hud" ? { hud: `${what}: ${truncate(made.text, 50)}` } : toast(what, truncate(made.text, 60));
}

async function pickAdd(id: string, action?: string, ctx?: Ctx): Promise<Effect | void> {
  if (id.startsWith("hint:")) return pickHint(id, action);
  const parent = await parentOf(ctx);
  if (id.startsWith("added:")) {
    if (action !== "undo-add") return { keep: true };
    try { await remove(id.slice(6)); } catch (e) { return failed("delete", e); }
    lastAdded = undefined;
    bar.refresh("today").catch(() => {});
    return toast("Deleted", "The todo just added is gone");
  }
  const line = id.replace(/^(new|sel|clip):/, "");
  if (id.startsWith("sel:") || id.startsWith("clip:")) return action === "edit" ? { push: { extension: EXTENSION, palette: "add", args: ctx?.args, query: line } } : addLine(line, parent, "hud");
  if (id.startsWith("new:")) {
    if (action === "copy-line") return { copy: line };
    return addLine(line, parent, action === "another" ? "toast" : "hud");
  }
}

// ---- Search: open and completed -------------------------------------------------------------------

async function searchRows(query = "", ctx?: Ctx): Promise<Item[]> {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [hint("search", "Search every todo", "Words against the text, tags and section, open and completed alike", { icon: ICON.search })];
  const all = await todos(!!ctx?.refresh);
  const t0 = now();
  const hay = (t: Todo) => `${t.text} ${(t.tags ?? []).join(" ")} ${t.section}`.toLowerCase();
  const hits = all.filter((t) => { const h = hay(t); return words.every((w) => h.includes(w)); });
  const rows = [...hits.filter((t) => !t.done).map((t) => todoRow(t, all, t0, t.section)), ...hits.filter((t) => t.done).map((t) => todoRow(t, all, t0, "Completed"))];
  return rows.length ? rows.slice(0, 60) : [hint("empty", "Nothing found", `No todo has “${query.trim()}”; Add Todo makes one`, { actions: [{ id: "add", title: "Add it" }], icon: ICON.plus })];
}

// ---- Completed -------------------------------------------------------------------------------------

async function doneRows(ctx?: Ctx): Promise<Item[]> {
  const [all, secs, times] = await Promise.all([todos(!!ctx?.refresh), sectionNames(!!ctx?.refresh), completedTimes()]);
  const t0 = now();
  const done = all.filter((t) => t.done);
  const rows: Item[] = [];
  for (const s of sectionOrder(done, secs)) for (const t of done) if (t.section === s) rows.push(todoRow(t, all, t0, s, { accessories: [...tagsOf(t), ...(times[t.id] ? [{ date: times[t.id] }] : [])] }));
  return rows.length ? rows : [hint("none", "Nothing completed", "A todo checked off in pal or in odak shows here until it is deleted", { icon: ICON.check })];
}

// ---- the bar item: today --------------------------------------------------------------------------

/** The row the keys act on, across renders; whether the field is open. */
let barFocus: string | undefined;
let barField = false;

/** The popover's rows from the todos at hand: the overdue first, then what is due today and what sits in today's sections. */
function barState(all: Todo[], t0 = now()): BarState {
  const open = all.filter((t) => !t.done && !isWaiting(t, t0));
  const overdue = open.filter((t) => isOverdue(t, t0)).sort((a, b) => (a.deadline ?? "").localeCompare(b.deadline ?? ""));
  const secs = todaySections();
  const dueToday = open.filter((t) => isDueToday(t, t0));
  const today = [...dueToday, ...open.filter((t) => !isOverdue(t, t0) && !isDueToday(t, t0) && secs.includes(t.section.toLowerCase()))];
  const rows: BarRow[] = [...overdue, ...today].map((t) => ({ id: t.id, text: truncate(oneLine(t.text), 90), section: t.section, tags: t.tags ?? [], urgent: !!t.urgent, due: due(t.deadline, t0) }));
  const focus = Math.max(0, rows.findIndex((r) => r.id === barFocus));
  return { rows, focus, overdue: overdue.length, today: today.length, field: barField || undefined, section: defaultSection([]) };
}

async function todayItem(ctx: BarCtx): Promise<BarItem> {
  let all: Todo[];
  try { all = await todos(ctx.reason === "cli" || ctx.reason === "update"); } catch (e) {
    if (e instanceof AuthError) return { hidden: true, states: { overdue: null, today: null, open: null } };
    throw e;
  }
  const st = { ...barState(all), section: defaultSection(await sectionNames()) };
  const states = { overdue: st.overdue, today: st.today, open: all.filter((t) => !t.done).length };
  const count = st.overdue + st.today;
  const tooltip = count ? [st.overdue ? `${st.overdue} overdue` : "", st.today ? `${st.today} today` : ""].filter(Boolean).join(", ") : "Nothing due today";
  const menu = { view: renderBar(st) };
  // The facts (`odak/overdue`, `odak/today`, `odak/open`): the manifest's rules hide the item at zero and colour it red while anything is overdue. The glyph and the popover are the `empty` shape a `show = "always"` config keeps.
  return { icon: BAR_GLYPH, ...(count && { title: String(count) }), tooltip, menu, empty: { icon: BAR_GLYPH, tooltip, menu }, states };
}

/** The popover drawn again from the todos at hand (no fetch): what a key that only moves the cursor answers. */
const redrawBar = async (): Promise<Effect> => ({ view: renderBar({ ...barState(await todos()), section: defaultSection(await sectionNames()) }) });

async function todayAction(action: string, ctx?: BarCtx): Promise<Effect> {
  if (action === "open-pal") return { push: { extension: EXTENSION, palette: "odak" } };
  if (action === "open-odak") return { open: webUrl() };
  if (action === "refresh") { drop(); await todos(true).catch((e) => log(`refresh: ${errorMessage(e)}`)); return { keep: true }; }
  if (action.startsWith("focus:")) { barFocus = action.slice(6); return redrawBar(); }
  if (action === "new") { barField = true; return redrawBar(); }
  if (action === "cancel") { barField = false; return redrawBar(); }
  if (action === "add") {
    const line = str(ctx?.values?.input).trim();
    if (!line) return { ...(await redrawBar()), toast: { title: "Nothing to add", message: "Type the todo first", style: "failure" } };
    const r = await addLine(line, undefined, "toast");
    if (r.toast?.style === "failure") return { ...(await redrawBar()), toast: r.toast };
    barField = false;
    return { keep: true, toast: r.toast };
  }
  const st = barState(await todos());
  const cur = st.rows[st.focus];
  switch (action) {
    case "down": case "up": {
      if (!st.rows.length) return redrawBar();
      barFocus = st.rows[(st.focus + (action === "down" ? 1 : st.rows.length - 1)) % st.rows.length].id;
      return redrawBar();
    }
    case "complete": {
      if (!cur) return { keep: true };
      const r = await complete([cur.id]);
      return r.toast?.style === "failure" ? r : { keep: true, hud: `Done: ${truncate(cur.text, 50)}` };
    }
    case "urgent": {
      if (!cur) return { keep: true };
      try { await update(cur.id, { urgent: !cur.urgent }); } catch (e) { return failed("change the flag", e); }
      return { keep: true };
    }
    case "tomorrow": {
      if (!cur) return { keep: true };
      const t = await find(cur.id);
      if (!t) return { keep: true };
      const r = await snoozeTo(t, addDays(now(), 1));
      return r.toast?.style === "failure" ? r : { keep: true, toast: r.toast };
    }
  }
  return { keep: true };
}

// The field closes with the popover, so the next open starts on the rows.
view.onHidden((ev) => { if (ev.bar === "today") barField = false; }, EXTENSION);

// ---- the extension ----------------------------------------------------------------------------

/** A pick from any palette whose rows are todos, hints or commands; the form ids land here too. */
async function pickAny(id: string, action?: string, ctx?: Ctx): Promise<Effect | void> {
  if (id.startsWith("hint:")) {
    if (id === "hint:empty" && action === "add") return { push: { extension: EXTENSION, palette: "add" } };
    return pickHint(id, action);
  }
  if (id.startsWith("cmd:") || id === "undo") return pickCommand(id, action, ctx);
  const t = await find(id);
  if (!t) return toast("Not there any more", "The todo changed or went in odak; the list is fetched again", "failure");
  return pickTodo(t, action, ctx);
}

export default {
  palettes: {
    odak: {
      title: "Todos",
      placeholder: "A todo, a tag, a section",
      live: true,
      multi: true,
      list: (_q, ctx) => guard(() => todoRows(ctx)),
      pick: pickAny,
      suggest: suggestRows,
    },
    add: {
      title: "Add Todo",
      input: true,
      placeholder: "Todo, #tag, !, /section, a day at the end",
      list: (query, ctx) => guard(() => addRows(query, ctx)),
      pick: pickAdd,
    },
    search: {
      title: "Search Todos",
      input: true,
      placeholder: "Words from the todo, a tag, a section",
      list: (query, ctx) => guard(() => searchRows(query, ctx)),
      pick: pickAny,
    },
    done: {
      title: "Completed",
      placeholder: "A completed todo",
      live: true,
      multi: true,
      list: (_q, ctx) => guard(() => doneRows(ctx)),
      pick: pickAny,
    },
  },
  bar: {
    today: { render: todayItem, onAction: todayAction },
  },
  link: async (route: string, params: LinkParams): Promise<Effect | void> => {
    if (route !== "add") return;
    const t0 = now();
    const names = await sectionNames();
    const p = parseAdd(str(params.text), t0, names);
    if (!p.text) throw new Error("text is empty");
    const dueDay = params.due !== undefined ? parseWhen(str(params.due), t0) : undefined;
    if (params.due !== undefined && dueDay === undefined) throw new Error(`cannot read the day "${str(params.due)}"`);
    const section = str(params.section) ? targetSection(names, str(params.section)) : p.section ? targetSection(names, p.section) : defaultSection(names);
    const tags = [...new Set([...p.tags, ...(Array.isArray(params.tags) ? params.tags.map(String) : [])])];
    const made = await create({ text: p.text, section, tags: tags.length ? tags : undefined, urgent: p.urgent || params.urgent === true || undefined, deadline: dueDay !== undefined ? isoDay(dueDay) : p.deadline, trigger: p.trigger });
    lastAdded = { id: made.id, text: made.text, section: made.section, at: t0 };
    bar.refresh("today").catch(() => {});
    return { hud: `Added to ${made.section}: ${truncate(made.text, 50)}` };
  },
} satisfies Extension;
