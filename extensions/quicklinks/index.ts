// Quicklinks: your own links, kept in the extension's storage and edited
// through forms in the panel. A url with a `{query}` placeholder opens
// through a drill-in level whose input fills it (a search engine); one
// without opens at once. An `import` file adds read-only links.
import { home, settings, storage, type Action, type Ctx, type Effect, type Extension, type Form, type FormValues, type Item } from "@zcag/pal";
import { asLinks, badUrl, fill, placeholder, splitKeywords, type Link } from "./links.ts";

const KEY = "links";
const CREATE = "create";
const IMPORTED = "import:";
const EXTENSION = "quicklinks", PALETTE = "quicklinks";

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
  palettes: {
    quicklinks: {
      title: "Quicklinks",
      icon: "🔗",
      list: async (query, ctx): Promise<Item[]> => {
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
          { id: CREATE, name: "Create Quicklink", subtitle: "A link, with {query} where what you type goes", icon: "+", keywords: ["new", "add"], actions: [{ id: CREATE, title: "Create Quicklink" }] },
          ...(await all()).map(row),
        ];
      },
      pick: async (id, action, ctx?: Ctx): Promise<Effect | void> => {
        // From the drill-in: the row's id is the filled url.
        if ((ctx?.args as { link?: string } | undefined)?.link) return action === "copy" ? { copy: id } : { open: id };
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
