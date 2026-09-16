// Snippets: short texts kept in the extension's storage and edited through
// forms in the panel. Enter pastes one into the app in front with its
// placeholders filled (placeholders.ts), cmd+c copies it instead. The
// keyword is a row keyword, so typing `sig` finds the signature. The Import
// and Export rows move snippets in and out as JSON files.
import { clipboard, home, storage, type Action, type Ctx, type Effect, type Extension, type Form, type FormValues, type Item } from "@zcag/pal";
import { asSnippets, badKeyword, expand, fromJson, hasPlaceholders, preview, type Snippet } from "./placeholders.ts";

const KEY = "snippets";
/** Material Design glyphs in the bundled Nerd Font: scissors for a snippet, plus, import, export for the command rows. */
const ICON = "\u{f0190}";
const ICON_CREATE = "\u{f0415}";
const ICON_IMPORT = "\u{f02fa}";
const ICON_EXPORT = "\u{f0207}";
const CREATE = "create";
const IMPORT = "import";
const EXPORT = "export";
const EXPORT_DEFAULT = "~/Downloads/pal-snippets.json";

const PASTE: Action = { id: "paste", title: "Paste" };
const COPY: Action = { id: "copy", title: "Copy", shortcut: "cmd+c" };
const EDIT: Action = { id: "edit", title: "Edit", shortcut: "cmd+e" };
const DELETE: Action = { id: "delete", title: "Delete", shortcut: "ctrl+x", style: "destructive", confirm: "Delete this snippet?" };

const all = async () => asSnippets(await storage.get(KEY));

/** The newest text on the clipboard, for `{clipboard}`; empty when there is none. */
const clipboardText = async () => (await clipboard.list({ kind: "text", limit: 1 }))[0]?.text ?? "";

function row(s: Snippet): Item {
  return {
    id: s.id,
    name: s.name,
    subtitle: preview(s.text),
    icon: ICON,
    keywords: s.keyword ? [s.keyword] : undefined,
    accessories: [...(s.keyword ? [{ tag: s.keyword }] : []), ...(hasPlaceholders(s.text) ? [{ text: "dynamic" }] : [])],
    detail: {
      markdown: `# ${s.name}\n\n\`\`\`\n${s.text}\n\`\`\``,
      metadata: [
        ...(s.keyword ? [{ label: "Keyword", value: s.keyword }] : []),
        { label: "Length", value: `${s.text.length} characters` },
      ],
    },
    actions: [PASTE, COPY, EDIT, DELETE],
  };
}

/** The create or edit form; `errors` when a submit was refused. */
const form = (s?: Snippet, errors?: Record<string, string>): Form => ({
  id: s?.id ?? CREATE,
  title: s ? `Edit ${s.name}` : "Create Snippet",
  fields: [
    { kind: "text", id: "name", label: "Name", required: true, default: s?.name, placeholder: "Email signature" },
    { kind: "text", id: "keyword", label: "Keyword", default: s?.keyword, placeholder: "sig", description: "One word that finds it." },
    { kind: "textarea", id: "text", label: "Text", required: true, default: s?.text, placeholder: "Best,\nAda", description: "{clipboard}, {date}, {time}, {datetime} and {uuid} are filled in when pasted; {selection} is the clipboard too. {cursor} is not supported." },
  ],
  submit: { id: "save", title: s ? "Save" : "Create" },
  errors,
});

/** The path form of the Import and Export rows; `errors` when a submit was refused. */
const pathForm = (id: typeof IMPORT | typeof EXPORT, path?: string, errors?: Record<string, string>): Form => ({
  id,
  title: id === IMPORT ? "Import Snippets" : "Export Snippets",
  fields: [{ kind: "text", id: "path", label: "File", required: true, default: path ?? (id === EXPORT ? EXPORT_DEFAULT : undefined), placeholder: EXPORT_DEFAULT, description: id === IMPORT ? "A JSON array of {name, text, keyword?} (Raycast's export works). Snippets whose name and text you already have are skipped." : "Your snippets as a JSON array of {name, text, keyword?}; an existing file is replaced." }],
  submit: { id: "save", title: id === IMPORT ? "Import" : "Export" },
  errors,
});

/** Import: the file's snippets that are new by name and text appended; export: the stored snippets written. Either refusal is the form again. */
async function transfer(id: typeof IMPORT | typeof EXPORT, values: FormValues): Promise<Effect> {
  const raw = String(values.path ?? "").trim();
  if (!raw) return { form: pathForm(id, raw, { path: "Required" }) };
  const path = home(raw);
  const snippets = await all();
  if (id === EXPORT) {
    try { await Bun.write(path, JSON.stringify(snippets.map(({ id: _, ...s }) => s), null, 2) + "\n"); }
    catch (e) { return { form: pathForm(id, raw, { path: `Could not write: ${e instanceof Error ? e.message : e}` }) }; }
    return { keep: true, toast: { title: `Exported ${snippets.length} ${snippets.length === 1 ? "snippet" : "snippets"}`, message: path } };
  }
  let incoming: Snippet[];
  try { incoming = fromJson(await Bun.file(path).json()); }
  catch (e) { return { form: pathForm(id, raw, { path: `Could not read: ${e instanceof Error ? e.message : e}` }) }; }
  const key = (s: Snippet) => `${s.name}\0${s.text}`;
  const have = new Set(snippets.map(key));
  const fresh: Snippet[] = [];
  for (const s of incoming) if (!have.has(key(s))) { have.add(key(s)); fresh.push(s); }
  if (fresh.length) await storage.set(KEY, [...snippets, ...fresh]);
  return { keep: true, toast: { title: `Imported ${fresh.length} ${fresh.length === 1 ? "snippet" : "snippets"}`, message: incoming.length > fresh.length ? `${incoming.length - fresh.length} already there` : undefined } };
}

/** The submit: refused with the form again, else stored and listed again. */
async function save(id: string, values: FormValues): Promise<Effect> {
  const snippets = await all();
  const before = id === CREATE ? undefined : snippets.find((s) => s.id === id);
  if (id !== CREATE && !before) throw new Error(`no snippet ${id}`);
  const name = String(values.name ?? "").trim(), keyword = String(values.keyword ?? "").trim(), text = String(values.text ?? "");
  const errors: Record<string, string> = {};
  if (!name) errors.name = "Required";
  if (!text.trim()) errors.text = "Required";
  const bad = keyword && badKeyword(keyword);
  if (bad) errors.keyword = bad;
  if (Object.keys(errors).length) return { form: form(before, errors) };
  const snippet: Snippet = { id: before?.id ?? crypto.randomUUID(), name, text, ...(keyword && { keyword }) };
  await storage.set(KEY, before ? snippets.map((s) => (s.id === snippet.id ? snippet : s)) : [...snippets, snippet]);
  return { keep: true, toast: { title: before ? "Saved" : "Created", message: name } };
}

export default {
  palettes: {
    snippets: {
      title: "Snippets",
      icon: ICON,
      list: async (): Promise<Item[]> => [
        { id: CREATE, name: "Create Snippet", subtitle: "A text to paste by name or keyword", icon: ICON_CREATE, keywords: ["new", "add"], actions: [{ id: CREATE, title: "Create snippet" }] },
        ...(await all()).map(row),
        { id: IMPORT, name: "Import Snippets", subtitle: "From a JSON file", icon: ICON_IMPORT, keywords: ["json", "restore"], actions: [{ id: IMPORT, title: "Import…" }] },
        { id: EXPORT, name: "Export Snippets", subtitle: "To a JSON file", icon: ICON_EXPORT, keywords: ["json", "backup"], actions: [{ id: EXPORT, title: "Export…" }] },
      ],
      pick: async (id, action, ctx?: Ctx): Promise<Effect | void> => {
        if (id === IMPORT || id === EXPORT) return action === "save" ? transfer(id, ctx?.values ?? {}) : { form: pathForm(id) };
        if (action === "save") return save(id, ctx?.values ?? {});
        if (id === CREATE) return { form: form() };
        const s = (await all()).find((x) => x.id === id);
        if (!s) throw new Error(`no snippet ${id}`);
        switch (action) {
          case "copy": return { copy: await expand(s.text, { clipboard: clipboardText }) };
          case "edit": return { form: form(s) };
          case "delete": {
            await storage.set(KEY, (await all()).filter((x) => x.id !== id));
            return { keep: true, toast: { title: "Deleted", message: s.name } };
          }
          default: return { paste: { text: await expand(s.text, { clipboard: clipboardText }) } };
        }
      },
    },
  },
} satisfies Extension;
