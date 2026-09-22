// A mock odak server for the tests and the screenshot fixture: the REST
// routes the extension reads and writes over an in-memory list (never the
// owner's), with odak's own quirks kept: an id is a hash of the line's
// content (so an edit gives a new id, a toggle does not), a PATCH keeps an
// empty text, section, deadline or trigger and always writes `urgent`, a
// move puts the line at the end of its new section, a delete takes the
// children. `state` flips the failure modes; `seen` records every request.

export const KEY = "test-key";
/** The clock the tests pin (the harness forwards `PAL_NOW`); the fixture's days are around it. */
export const NOW = "2026-09-22T10:30:00";

export type Item = { id: string; section: string; done: boolean; text: string; tags?: string[]; urgent?: boolean; deadline?: string; trigger?: string; file_ref?: string; parent_id?: string; depth?: number };

/** odak's id: the first four bytes of sha256 over the line after its checkbox, tags first, then the flag, the days, the text. */
export const idOf = (t: Omit<Item, "id">): string => {
  const raw = [...(t.tags ?? []).map((x) => `[t:${x}]`), ...(t.urgent ? ["[!]"] : []), ...(t.deadline ? [`[d:${t.deadline}]`] : []), ...(t.trigger ? [`[w:${t.trigger}]`] : []), t.text, ...(t.file_ref ? [`[→ ${t.file_ref}]`] : [])].join(" ");
  return new Bun.CryptoHasher("sha256").update(raw).digest("hex").slice(0, 8);
};

export const SECTIONS = ["Focus", "Today", "Next", "Waiting", "Backlog", "Someday", "Inbox"];

const seed = (): Item[] => [
  { section: "Focus", done: false, text: "Ship the release notes", tags: ["work"], urgent: true },
  { section: "Focus", done: false, text: "Write the changelog entry", tags: ["work"], parent_id: "", depth: 1 },
  { section: "Focus", done: false, text: "Review the parser PR https://github.com/example/pal/pull/42", tags: ["work"], deadline: "2026-09-22" },
  { section: "Today", done: false, text: "Call the bank about the card", tags: ["personal"], deadline: "2026-09-19" },
  { section: "Today", done: true, text: "Water the plants", tags: ["personal"] },
  { section: "Next", done: false, text: "Book the dentist", tags: ["personal"], deadline: "2026-09-26" },
  { section: "Next", done: false, text: "Pick a marketing project to start", tags: ["work"] },
  { section: "Waiting", done: false, text: "Visa appointment confirmation", tags: ["personal"], trigger: "2026-10-03" },
  { section: "Someday", done: false, text: "Learn the accordion" },
  { section: "Inbox", done: false, text: "Check the alt text idea", tags: ["work", "idea"] },
  { section: "Inbox", done: true, text: "Renew the domain", tags: ["personal"] },
].map((t) => ({ ...t, id: idOf(t) }));

/** The list, in file order. `reset()` puts the seed back. */
export let ITEMS: Item[] = seed();
const link = () => { const parent = ITEMS.find((t) => t.text === "Ship the release notes")!; ITEMS.find((t) => t.text === "Write the changelog entry")!.parent_id = parent.id; };
link();
export const reset = () => { ITEMS = seed(); link(); seen.length = 0; };

type Seen = { method: string; path: string; body?: any };
export const seen: Seen[] = [];
export const calls = (method: string, path: string) => seen.filter((s) => s.method === method && s.path === path);
/** Knobs the tests turn: the server refusing every call. */
export const state = { down: false };

const json = (data: unknown, status = 200) => Response.json(data, { status });
const err = (status: number, error: string) => json({ error }, status);
const clean = (t: Item): Item => Object.fromEntries(Object.entries(t).filter(([k, v]) => v !== undefined && v !== "" && !(k === "tags" && Array.isArray(v) && !v.length) && !(k === "urgent" && !v) && !(k === "done" && v === undefined))) as Item;
/** The insertion point after the section's last line, as odak's `sectionInsertPoint`: the end when the section has no line. */
/** A dirty line is rendered afresh, so its id moves: the answer carries the old one, the list the new one, the children re-parented (odak derives `parent_id` at parse time). */
const rewrite = (t: Item, old: string): Item => {
  const answer = clean({ ...t });
  const fresh = idOf(t);
  for (const c of ITEMS) if (c.parent_id === old) c.parent_id = fresh;
  t.id = fresh;
  return answer;
};
const insertAt = (section: string) => { const at = ITEMS.findLastIndex((t) => t.section === section); return at < 0 ? ITEMS.length : at + 1; };

export const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    const rec: Seen = { method: req.method, path: url.pathname + url.search };
    let body: any;
    if (req.method !== "GET") { try { body = await req.json(); rec.body = body; } catch {} }
    seen.push(rec);
    if (state.down) return new Response(null, { status: 502 });
    if (req.headers.get("authorization") !== `Bearer ${KEY}`) return new Response("unauthorized\n", { status: 401 });
    const p = url.pathname;
    let m: RegExpExecArray | null;
    if (req.method === "GET" && p === "/todos") {
      let out = ITEMS;
      const sec = url.searchParams.get("section"), tag = url.searchParams.get("tag"), pid = url.searchParams.get("parent_id");
      if (sec) out = out.filter((t) => t.section === sec);
      if (tag) out = out.filter((t) => t.tags?.includes(tag));
      if (pid) out = out.filter((t) => t.parent_id === pid);
      return json(out.map(clean));
    }
    if (req.method === "POST" && p === "/todos") {
      if (!body?.text) return err(400, "text required");
      const t: Item = clean({ id: "", section: body.section || "Inbox", done: !!body.done, text: body.text, tags: body.tags, urgent: body.urgent, deadline: body.deadline, trigger: body.trigger, parent_id: body.parent_id });
      t.id = idOf(t);
      ITEMS.splice(insertAt(t.section), 0, t);
      return json(t, 201);
    }
    if (req.method === "GET" && p === "/sections") {
      const counts = new Map<string, number>();
      for (const t of ITEMS) counts.set(t.section, (counts.get(t.section) ?? 0) + 1);
      return json(SECTIONS.map((name) => ({ name, count: counts.get(name) ?? 0 })));
    }
    if ((m = /^\/todos\/([^/]+)(\/done|\/move)?$/.exec(p))) {
      const id = decodeURIComponent(m[1]), t = ITEMS.find((x) => x.id === id);
      if (!t) return err(404, `not found: ${id}`);
      if (req.method === "GET" && !m[2]) return json(clean(t));
      if (req.method === "DELETE" && !m[2]) { ITEMS = ITEMS.filter((x) => x.id !== id && x.parent_id !== id); return new Response(null, { status: 204 }); }
      if (req.method === "PATCH" && m[2] === "/done") { t.done = !t.done; return json(clean(t)); }
      if (req.method === "PATCH" && !m[2]) {
        // odak's UpdateItem: empty strings keep, `tags` null keeps, `urgent` is written as sent; the answer carries the old id, the file's next parse the new one.
        if (body.text) t.text = body.text;
        if (body.section) t.section = body.section;
        if (body.tags != null) t.tags = body.tags;
        if (body.deadline) t.deadline = body.deadline;
        if (body.trigger) t.trigger = body.trigger;
        t.urgent = !!body.urgent;
        return json(rewrite(t, id));
      }
      if (req.method === "POST" && m[2] === "/move") {
        if (!body?.section) return err(400, "section required");
        const moved = ITEMS.filter((x) => x.id === id || x.parent_id === id);
        ITEMS = ITEMS.filter((x) => !moved.includes(x));
        for (const x of moved) x.section = body.section;
        ITEMS.splice(insertAt(body.section), 0, ...moved);
        return json(rewrite(t, id));
      }
    }
    return err(404, "not found");
  },
});

export const BASE = `http://127.0.0.1:${server.port}`;
export const SETTINGS = { url: BASE, api_key: KEY, default_section: "Inbox", today_sections: ["Focus", "Today"] };
