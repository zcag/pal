// Quicklinks: your own links, kept in the extension's storage and edited
// through forms in the panel. A url with a `{query}` placeholder opens
// through a drill-in level whose input fills it (a search engine); one
// without opens at once. An `import` file adds read-only links; the Import
// and Export rows move links in and out as JSON files.
import { home, settings, storage, type Action, type Ctx, type Effect, type Extension, type Form, type FormValues, type Item, type LinkParams } from "@zcag/pal";
import { asLinks, badUrl, fill, fromJson, placeholder, splitKeywords, type Link } from "./links.ts";

/** A root query that is a web address (`URL_RE` at the root: a scheme, or a dotted host with a letters-only last label; no spaces): the inline "Open" row. */
const URL_RE = /^\s*(?:[a-z][a-z0-9+.-]*:\/\/\S+|(?:localhost|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,})(?::\d+)?(?:[/?#]\S*)?)\s*$/i;
/** The query as a URL: as typed with a scheme, else under `https://`. */
const asUrl = (q: string) => { const t = q.trim(); return /^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}`; };
/** The inline and fallback rows' ids carry the url; `pick` opens or copies it without a lookup. */
const OPEN_ID = "open:";

const KEY = "links";
const CREATE = "create";
const IMPORT = "import";
const EXPORT = "export";
const IMPORTED = "import:";
const EXTENSION = "quicklinks", PALETTE = "quicklinks";
const EXPORT_DEFAULT = "~/Downloads/pal-quicklinks.json";
/** md-link_plus, md-tray_arrow_down, md-tray_arrow_up: the Create, Import and Export rows (a link row gets its favicon). */
const ICON = { create: "\u{f0c94}", import: "\u{f0120}", export: "\u{f011d}" };

const OPEN: Action = { id: "open", title: "Open" };
const COPY: Action = { id: "copy", title: "Copy URL", shortcut: "cmd+c" };
const EDIT: Action = { id: "edit", title: "Edit", shortcut: "cmd+e" };
const DELETE: Action = { id: "delete", title: "Delete", shortcut: "ctrl+x", style: "destructive", confirm: "Delete this quicklink?" };

const own = async () => asLinks(await storage.get(KEY));

/** The `import` file's links, ids prefixed so they never collide with stored ones; a missing or broken file lists nothing and says so on stderr. */
async function imported(): Promise<Link[]> {
  const file = settings.get<{ import?: string }>().import?.trim();
  if (!file) return [];
  try {
    const data = await Bun.file(home(file)).json();
    if (!Array.isArray(data)) throw new Error("expected a JSON array of {name, url}");
    return data
      .filter((r) => r && typeof r.url === "string" && r.url)
      .map((r) => ({ id: IMPORTED + r.url, name: typeof r.name === "string" && r.name ? r.name : r.url, url: r.url, ...(Array.isArray(r.keywords) ? { keywords: r.keywords.map(String) } : {}) }));
  } catch (e) {
    console.error(`quicklinks: import ${file}: ${e instanceof Error ? e.message : e}`);
    return [];
  }
}

const all = async () => [...(await own()), ...(await imported())];
const find = async (id: string) => (await all()).find((l) => l.id === id);
/** By name, then by keyword, case-insensitive: what `pal://quicklinks/open?name=` takes. */
const byName = async (name: string) => {
  const n = name.trim().toLowerCase();
  const links = await all();
  return links.find((l) => l.name.toLowerCase() === n) ?? links.find((l) => l.keywords?.some((k) => k.toLowerCase() === n));
};

function row(l: Link): Item {
  const arg = placeholder(l.url);
  const readOnly = l.id.startsWith(IMPORTED);
  return {
    id: l.id,
    name: l.name,
    subtitle: l.url,
    url: l.url,
    keywords: l.keywords,
    accessories: arg ? [{ tag: `{${arg}}` }] : undefined,
    detail: {
      markdown: `# ${l.name}\n\n\`\`\`\n${l.url}\n\`\`\``,
      metadata: [
        ...(arg ? [{ label: "Asks for", value: arg }] : []),
        ...(l.keywords?.length ? [{ label: "Keywords", tags: l.keywords.map((text) => ({ text })) }] : []),
        { label: "Source", value: readOnly ? "Import file" : "Your quicklinks" },
      ],
    },
    actions: readOnly ? [OPEN, COPY] : [OPEN, COPY, EDIT, DELETE],
  };
}

/** The create or edit form; `errors` when a submit was refused. */
const form = (l?: Link, errors?: Record<string, string>): Form => ({
  id: l?.id ?? CREATE,
  title: l ? `Edit ${l.name}` : "Create Quicklink",
  fields: [
    { kind: "text", id: "name", label: "Name", required: true, default: l?.name, placeholder: "GitHub search" },
    { kind: "text", id: "url", label: "URL", required: true, default: l?.url, placeholder: "https://github.com/search?q={query}", description: "{query} stands for what you type when opening it." },
    { kind: "text", id: "keywords", label: "Keywords", default: l?.keywords?.join(" "), placeholder: "gh code", description: "Extra words that find it, space separated." },
  ],
  submit: { id: "save", title: l ? "Save" : "Create" },
  errors,
});

/** The path form of the Import and Export rows; `errors` when a submit was refused. */
const pathForm = (id: typeof IMPORT | typeof EXPORT, path?: string, errors?: Record<string, string>): Form => ({
  id,
  title: id === IMPORT ? "Import Quicklinks" : "Export Quicklinks",
  fields: [{ kind: "text", id: "path", label: "File", required: true, default: path ?? (id === EXPORT ? EXPORT_DEFAULT : undefined), placeholder: EXPORT_DEFAULT, description: id === IMPORT ? "A JSON array of {name, url, keywords?} (Raycast's {name, link} works too). Links whose url you already have are skipped." : "Your quicklinks as a JSON array of {name, url, keywords?}; an existing file is replaced." }],
  submit: { id: "save", title: id === IMPORT ? "Import" : "Export" },
  errors,
});

/** Import: the file's links that are new by url appended; export: the stored links written. Either refusal is the form again. */
async function transfer(id: typeof IMPORT | typeof EXPORT, values: FormValues): Promise<Effect> {
  const raw = String(values.path ?? "").trim();
  if (!raw) return { form: pathForm(id, raw, { path: "Required" }) };
  const path = home(raw);
  const links = await own();
  if (id === EXPORT) {
    try { await Bun.write(path, JSON.stringify(links.map(({ id: _, ...l }) => l), null, 2) + "\n"); }
    catch (e) { return { form: pathForm(id, raw, { path: `Could not write: ${e instanceof Error ? e.message : e}` }) }; }
    return { keep: true, toast: { title: `Exported ${links.length} ${links.length === 1 ? "quicklink" : "quicklinks"}`, message: path } };
  }
  let incoming: Link[];
  try { incoming = fromJson(await Bun.file(path).json()); }
  catch (e) { return { form: pathForm(id, raw, { path: `Could not read: ${e instanceof Error ? e.message : e}` }) }; }
  const have = new Set(links.map((l) => l.url));
  const fresh: Link[] = [];
  for (const l of incoming) if (!have.has(l.url)) { have.add(l.url); fresh.push(l); }
  if (fresh.length) await storage.set(KEY, [...links, ...fresh]);
  return { keep: true, toast: { title: `Imported ${fresh.length} ${fresh.length === 1 ? "quicklink" : "quicklinks"}`, message: incoming.length > fresh.length ? `${incoming.length - fresh.length} already there` : undefined } };
}

/** The submit: refused with the form again, else stored and listed again. */
async function save(id: string, values: FormValues): Promise<Effect> {
  const links = await own();
  const before = id === CREATE ? undefined : links.find((l) => l.id === id);
  if (id !== CREATE && !before) throw new Error(`no quicklink ${id}`);
  const name = String(values.name ?? "").trim(), url = String(values.url ?? "").trim();
  const errors: Record<string, string> = {};
  if (!name) errors.name = "Required";
  const bad = badUrl(url);
  if (bad) errors.url = bad;
  // The form again with the messages; the fields keep what was typed.
  if (Object.keys(errors).length) return { form: form(before, errors) };
  const keywords = splitKeywords(String(values.keywords ?? ""));
  const link: Link = { id: before?.id ?? crypto.randomUUID(), name, url, ...(keywords && { keywords }) };
  await storage.set(KEY, before ? links.map((l) => (l.id === link.id ? link : l)) : [...links, link]);
  return { keep: true, toast: { title: before ? "Saved" : "Created", message: name } };
}

export default {
  // `pal://quicklinks/open?name=GitHub&query=pal`: a plain link opens, a
  // {query} link opens filled when `query` is given, else the panel asks.
  link: async (route: string, params: LinkParams): Promise<Effect | void> => {
    if (route !== "open") return;
    const l = await byName(String(params.name));
    if (!l) throw new Error(`no quicklink "${params.name}"`);
    if (!placeholder(l.url)) return { open: l.url };
    const q = typeof params.query === "string" ? params.query.trim() : "";
    return q ? { open: fill(l.url, q) } : { push: { extension: EXTENSION, palette: PALETTE, args: { link: l.id } } };
  },
  palettes: {
    quicklinks: {
      title: "Quicklinks",
      placeholder: "Name or keyword",
      // At the root a typed web address gets one inline row that opens it; a query nothing matched gets every `{query}` link filled with it.
      match: URL_RE,
      inline: true,
      fallback: async (query: string): Promise<Item[]> => {
        const q = query.trim();
        if (!q) return [];
        return (await all()).filter((l) => placeholder(l.url)).map((l) => {
          const url = fill(l.url, q);
          return { id: OPEN_ID + url, name: l.name, subtitle: url, url, actions: [OPEN, COPY] };
        });
      },
      list: async (query, ctx): Promise<Item[]> => {
        if (ctx?.inline) {
          const q = (query ?? "").trim();
          if (!URL_RE.test(q)) return [];
          const url = asUrl(q);
          return [{ id: OPEN_ID + url, name: `Open ${url.replace(/^https?:\/\//, "")}`, subtitle: url, url, actions: [OPEN, COPY] }];
        }
        // The drill-in for a placeholder link: one row, the url filled with what is typed.
        const linkId = (ctx?.args as { link?: string } | undefined)?.link;
        if (linkId) {
          const l = await find(linkId);
          if (!l) return [];
          const arg = placeholder(l.url) ?? "query";
          const q = (query ?? "").trim();
          const url = fill(l.url, q);
          return [q
            ? { id: url, name: `Open ${l.name}`, subtitle: url, url, actions: [OPEN, COPY] }
            : { id: l.id, name: `Type the ${arg}`, subtitle: l.url, url: l.url, actions: [] }];
        }
        return [
          { id: CREATE, name: "Create Quicklink", subtitle: "A link, with {query} where what you type goes", icon: ICON.create, keywords: ["new", "add"], actions: [{ id: CREATE, title: "Create quicklink" }] },
          ...(await all()).map(row),
          { id: IMPORT, name: "Import Quicklinks", subtitle: "From a JSON file", icon: ICON.import, keywords: ["json", "restore"], actions: [{ id: IMPORT, title: "Import…" }] },
          { id: EXPORT, name: "Export Quicklinks", subtitle: "To a JSON file", icon: ICON.export, keywords: ["json", "backup"], actions: [{ id: EXPORT, title: "Export…" }] },
        ];
      },
      pick: async (id, action, ctx?: Ctx): Promise<Effect | void> => {
        // From the drill-in: the row's id is the filled url; an inline or fallback row carries it after `open:`.
        if ((ctx?.args as { link?: string } | undefined)?.link) return action === "copy" ? { copy: id } : { open: id };
        if (id.startsWith(OPEN_ID)) { const url = id.slice(OPEN_ID.length); return action === "copy" ? { copy: url } : { open: url }; }
        if (id === IMPORT || id === EXPORT) return action === "save" ? transfer(id, ctx?.values ?? {}) : { form: pathForm(id) };
        if (action === "save") return save(id, ctx?.values ?? {});
        if (id === CREATE) return { form: form() };
        const l = await find(id);
        if (!l) throw new Error(`no quicklink ${id}`);
        switch (action) {
          case "copy": return { copy: l.url };
          case "edit": return { form: form(l) };
          case "delete": {
            await storage.set(KEY, (await own()).filter((x) => x.id !== id));
            return { keep: true, toast: { title: "Deleted", message: l.name } };
          }
          default:
            return placeholder(l.url) ? { push: { extension: EXTENSION, palette: PALETTE, args: { link: id } } } : { open: l.url };
        }
      },
    },
  },
} satisfies Extension;
