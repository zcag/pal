// Snippets: short texts kept in the extension's storage and edited through
// forms in the panel. Enter pastes one into the app in front with its
// placeholders filled (placeholders.ts), cmd+c copies it instead. The
// keyword is a row keyword, so typing `sig` finds the signature.
import { clipboard, storage, type Action, type Ctx, type Effect, type Extension, type Form, type FormValues, type Item } from "@zcag/pal";
import { asSnippets, badKeyword, expand, hasPlaceholders, preview, type Snippet } from "./placeholders.ts";

const KEY = "snippets";
const CREATE = "create";

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
    icon: "✂",
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
    { kind: "textarea", id: "text", label: "Text", required: true, default: s?.text, placeholder: "Best,\nCagdas", description: "{clipboard}, {date}, {time}, {datetime} and {uuid} are filled in when pasted." },
  ],
  submit: { id: "save", title: s ? "Save" : "Create" },
  errors,
});

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
      icon: "✂",
      list: async (): Promise<Item[]> => [
        { id: CREATE, name: "Create Snippet", subtitle: "A text to paste by name or keyword", icon: "+", keywords: ["new", "add"], actions: [{ id: CREATE, title: "Create Snippet" }] },
        ...(await all()).map(row),
      ],
      pick: async (id, action, ctx?: Ctx): Promise<Effect | void> => {
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
