// odak's model as the palettes read it: the todos (one `GET /todos`, the
// file flattened in its order, children after their parent), the sections
// (the file's `##` headings in order), and the writes. Every reader goes
// through `cached` (api.ts) so the palettes and the bar item share one
// fetch; a write patches the cache in place so the relist after it is
// instant, then fetches behind it: odak's ids are a hash of the line, so
// an edit gives the todo a new id and only the server knows it.
import { cached, forget, log, patch, peek, rest } from "./api.ts";
import { dayOf, daysUntil } from "./when.ts";

/** One line of the file (`model.Item` in odak): `deadline` and `trigger` are `YYYY-MM-DD`, `depth` the indent, `parent_id` the line above it at one less. */
export type Todo = { id: string; section: string; done: boolean; text: string; tags?: string[]; urgent?: boolean; deadline?: string; trigger?: string; file_ref?: string; parent_id?: string; depth?: number };
export type Section = { name: string; count: number };
/** What a new todo carries: the server fills the section (Inbox) and computes the id. */
export type NewTodo = { text: string; section?: string; tags?: string[]; urgent?: boolean; deadline?: string; trigger?: string; parent_id?: string };
/** What `PATCH /todos/:id` takes: an empty `text`, `section`, `deadline` or `trigger` means "keep"; `tags` `null` keeps, `[]` clears; `urgent` is always written, so send the current one. */
export type Patch = { text?: string; tags?: string[]; urgent: boolean; deadline?: string; trigger?: string };

/**
 * The id odak gives a line (`parser.parseContent`): the first four bytes
 * of sha256 over the line after its checkbox, as `renderItem` writes it
 * (tags, the flag, the days, the text, the file). An edit or a move
 * rewrites the line, so the server's answer carries the old id and the
 * next parse the new one; computing it here lets the cache and a
 * follow-up call (a move after an edit) use the new id at once. Should
 * the rule ever change, the fetch behind every write corrects the cache
 * and the follow-up call fails as a toast.
 */
export const idOf = (t: Omit<Todo, "id">): string => {
  const raw = [...(t.tags ?? []).map((x) => `[t:${x}]`), ...(t.urgent ? ["[!]"] : []), ...(t.deadline ? [`[d:${t.deadline}]`] : []), ...(t.trigger ? [`[w:${t.trigger}]`] : []), t.text, ...(t.file_ref ? [`[→ ${t.file_ref}]`] : [])].join(" ");
  return new Bun.CryptoHasher("sha256").update(raw).digest("hex").slice(0, 8);
};

/** Seconds a listing stays good for: the manifest's `ttl` on the palettes and this agree. */
export const TTL = { todos: 60, sections: 300 } as const;
const KEY = { todos: "todos", sections: "sections" } as const;

const strip = (t: Todo): Todo => { const { children: _c, ...rest } = t as Todo & { children?: unknown }; return rest; };

/** Every todo, open and done, in the file's order. */
export const todos = (refresh = false) => cached<Todo[]>(KEY.todos, TTL.todos * 1000, refresh, async () => ((await rest<Todo[] | null>("GET", "todos")) ?? []).map(strip));
/** The file's sections in order, with how many lines each holds (done ones included). */
export const sections = (refresh = false) => cached<Section[]>(KEY.sections, TTL.sections * 1000, refresh, async () => (await rest<Section[] | null>("GET", "sections")) ?? []);
/** The todos when they are already at hand (the root's Now section asks on every show), else nothing: never a fetch. */
export const todosAtHand = (): Todo[] | undefined => peek<Todo[]>(KEY.todos);

/** The file's section names in order, or none when the server cannot say. */
export const sectionNames = async (refresh = false): Promise<string[]> => (await sections(refresh).catch(() => [] as Section[])).map((s) => s.name);

/** The todo behind an id, from the cache or fetched again after a restart. */
export async function find(id: string): Promise<Todo | undefined> {
  const have = (await todos()).find((t) => t.id === id);
  if (have) return have;
  try { return strip(await rest<Todo>("GET", `todos/${encodeURIComponent(id)}`)); } catch { return undefined; }
}

/** The open children of a todo, in order. */
export const childrenOf = (all: Todo[], id: string): Todo[] => all.filter((t) => t.parent_id === id);

/** Overdue: an open todo whose day is past. Today: due today, or in one of the sections the bar counts as today's. */
export const isOverdue = (t: Todo, now: number): boolean => { const d = dayOf(t.deadline); return !t.done && d !== undefined && daysUntil(d, now) < 0; };
export const isDueToday = (t: Todo, now: number): boolean => { const d = dayOf(t.deadline); return !t.done && d !== undefined && daysUntil(d, now) === 0; };
/** Not yet: an open todo waiting for a day still ahead (`[w:date]`). */
export const isWaiting = (t: Todo, now: number): boolean => { const d = dayOf(t.trigger); return !t.done && d !== undefined && daysUntil(d, now) > 0; };

// ---- writes ---------------------------------------------------------------
// Each one changes the cached list the way the server will, then fetches
// behind it (`settle`): the list the relist reads is right at once, and
// the ids the server recomputed land a moment later.

/** A fetch after a write, not awaited: the next listing reads the server's ids. */
const settle = () => { todos(true).catch((e) => log(`refetch: ${e?.message ?? e}`)); sections(true).catch(() => {}); };

export async function create(t: NewTodo): Promise<Todo> {
  const body = { ...t, text: t.text.trim() };
  const made = strip(await rest<Todo>("POST", "todos", body));
  patch<Todo[]>(KEY.todos, (all) => {
    // The server appends after the section's last line; a subtask after its parent's last child.
    const at = made.parent_id ? all.findLastIndex((x) => x.id === made.parent_id || x.parent_id === made.parent_id) : all.findLastIndex((x) => x.section === made.section);
    return at < 0 ? [...all, made] : [...all.slice(0, at + 1), made, ...all.slice(at + 1)];
  });
  settle();
  return made;
}

/** Flips done; the id stays (odak hashes the line after its checkbox). */
export async function toggle(id: string): Promise<Todo> {
  const t = strip(await rest<Todo>("PATCH", `todos/${encodeURIComponent(id)}/done`));
  patch<Todo[]>(KEY.todos, (all) => all.map((x) => (x.id === id ? { ...x, done: t.done } : x)));
  settle();
  return t;
}

/** The line rewritten: the todo under its new id (`idOf`), its subtasks re-parented, in the cache and in the answer. */
const rewritten = (id: string, t: Todo): Todo => {
  const fresh = { ...t, id: idOf(t) };
  patch<Todo[]>(KEY.todos, (all) => all.map((x) => (x.id === id ? fresh : x.parent_id === id ? { ...x, parent_id: fresh.id } : x)));
  return fresh;
};

/** Text, tags, the flag, the days; the answer carries the new id. */
export async function update(id: string, p: Patch): Promise<Todo> {
  const t = rewritten(id, strip(await rest<Todo>("PATCH", `todos/${encodeURIComponent(id)}`, p)));
  settle();
  return t;
}

/** To the end of `section`, the subtasks along; the answer carries the new id (the line is rewritten, so it may change). */
export async function move(id: string, section: string): Promise<Todo> {
  const t = rewritten(id, strip(await rest<Todo>("POST", `todos/${encodeURIComponent(id)}/move`, { section })));
  patch<Todo[]>(KEY.todos, (all) => {
    const mine = (x: Todo) => x.id === t.id || x.parent_id === t.id;
    const moved = all.filter(mine).map((x) => ({ ...x, section }));
    const others = all.filter((x) => !mine(x));
    const at = others.findLastIndex((x) => x.section === section);
    return at < 0 ? [...others, ...moved] : [...others.slice(0, at + 1), ...moved, ...others.slice(at + 1)];
  });
  settle();
  return t;
}

/** The todo and its children. */
export async function remove(id: string): Promise<void> {
  await rest("DELETE", `todos/${encodeURIComponent(id)}`);
  patch<Todo[]>(KEY.todos, (all) => all.filter((x) => x.id !== id && x.parent_id !== id));
  settle();
}

/** Drops the list so the next reader fetches (a refresh key, a failed write whose local effect is in doubt). */
export const drop = () => forget(KEY.todos, KEY.sections);
