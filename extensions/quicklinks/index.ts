// Quicklinks: your own links, kept in the extension's storage and edited
// through forms in the panel. A url with a `{query}` placeholder opens
// through a drill-in level whose input fills it (a search engine); one
// with `{selection}` or `{clipboard}` (the SDK's placeholders) is filled
// without asking; one without opens at once, in the app the link names
// (`app`, "Open with" in the form) or the default, and with
// `prefer_existing_tab` in a browser tab already on that page
// (browser-tabs' `findTab`). The Create form fills its url and name from
// the tab in front (`activeTab`). The library level offers ready-made
// searches (library.ts); an `import` file adds read-only links; the
// Import and Export rows move links in and out as JSON files.
import { existsSync } from "node:fs";
import { clipboard, expand, hasPlaceholders, home, selection, settings, storage, type Action, type Ctx, type Effect, type Extension, type Form, type FormField, type FormValues, type Item, type LinkParams } from "@zcag/pal";
import { activeTab, findTab, focusTab } from "../browser-tabs/index.ts";
import { LIBRARY, LIBRARY_ID, libraryEntry, libraryId } from "./library.ts";
import { asLinks, badUrl, fill, fromJson, placeholder, splitKeywords, type Link } from "./links.ts";

/** `[extensions.quicklinks]`, defaults in pal.json. */
type Settings = { import?: string; prefer_existing_tab: boolean };

/** A root query that is a web address (`URL_RE` at the root: a scheme, or a dotted host with a letters-only last label; no spaces): the inline "Open" row. */
const URL_RE = /^\s*(?:[a-z][a-z0-9+.-]*:\/\/\S+|(?:localhost|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,})(?::\d+)?(?:[/?#]\S*)?)\s*$/i;
/** The query as a URL: as typed with a scheme, else under `https://`. */
const asUrl = (q: string) => { const t = q.trim(); return /^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}`; };
/** The inline and fallback rows' ids carry the url; `pick` opens or copies it without a lookup. */
const OPEN_ID = "open:";

const KEY = "links";
const CREATE = "create";
const LIBRARY_ROW = "library";
const IMPORT = "import";
const EXPORT = "export";
const IMPORTED = "import:";
const EXTENSION = "quicklinks", PALETTE = "quicklinks";
const EXPORT_DEFAULT = "~/Downloads/pal-quicklinks.json";
/** md-link_plus, md-library_shelves, md-tray_arrow_down, md-tray_arrow_up: the Create, Browse library, Import and Export rows (a link row gets its favicon). */
const ICON = { create: "\u{f0c94}", library: "\u{f0ba9}", import: "\u{f0120}", export: "\u{f011d}" };
const MAC = process.platform === "darwin";
/** The "Open with" choices, checked against the machine: the app names macOS's `open -a` takes, the commands Linux runs. `PAL_QUICKLINKS_BROWSERS` (a comma list) stands in for the check (the tests). */
const BROWSERS_MAC = ["Safari", "Google Chrome", "Firefox", "Arc", "Brave Browser", "Microsoft Edge", "Chromium", "Vivaldi", "Zen"];
const BROWSERS_LINUX = ["firefox", "google-chrome", "chromium", "brave", "microsoft-edge", "vivaldi", "zen"];
/** The "Open with" choice that is no app: the OS opener. */
const DEFAULT_APP = "default";

const OPEN: Action = { id: "open", title: "Open" };
const COPY: Action = { id: "copy", title: "Copy URL", shortcut: "cmd+c" };
const EDIT: Action = { id: "edit", title: "Edit", shortcut: "cmd+e" };
const DELETE: Action = { id: "delete", title: "Delete", shortcut: "ctrl+x", style: "destructive", confirm: "Delete this quicklink?" };
/** The library level: Enter adds the search to your links, cmd+enter searches with it right away, cmd+c copies its url. */
const ADD: Action = { id: "add", title: "Add to my quicklinks" };
const SEARCH: Action = { id: "search", title: "Search with it" };

const own = async () => asLinks(await storage.get(KEY));
const conf = () => settings.get<Settings>();

/** The browsers installed, in the fixed order; empty when none is found (the field then offers Default alone). */
function browsers(): string[] {
  const forced = process.env.PAL_QUICKLINKS_BROWSERS;
  if (forced !== undefined) return forced.split(",").map((b) => b.trim()).filter(Boolean);
  return MAC ? BROWSERS_MAC.filter((b) => existsSync(`/Applications/${b}.app`) || existsSync(home(`~/Applications/${b}.app`))) : BROWSERS_LINUX.filter((b) => Bun.which(b));
}

/**
 * The url in the app the link names: `open -a <app> <url>` on macOS, the
 * command on Linux (the core's `apps.open_with` takes a file that exists,
 * not a url). `PAL_QUICKLINKS_OPEN` names a stand-in taking `<app> <url>`
 * (the tests). Detached, so the panel never waits on the browser.
 */
function openWith(url: string, app: string): Effect {
  const argv = process.env.PAL_QUICKLINKS_OPEN ? [process.env.PAL_QUICKLINKS_OPEN, app, url] : MAC ? ["open", "-a", app, url] : [app, url];
  try { Bun.spawn(argv, { stdin: "ignore", stdout: "ignore", stderr: "ignore" }).unref(); }
  catch (e) { return { keep: true, toast: { title: `Could not open with ${app}`, message: String((e as Error)?.message ?? e), style: "failure" } }; }
  return { hide: true };
}

/** The newest text on the clipboard, for `{clipboard}`; empty when there is none. */
const clipboardText = async () => (await clipboard.list({ kind: "text", limit: 1 }))[0]?.text ?? "";
/** The SDK placeholders in a url (`{selection}`, `{clipboard}`, `{date}`...), each value percent-encoded as a url component. */
const fillSilent = (url: string) => expand(url, { clipboard: async () => encodeURIComponent(await clipboardText()), selection: async () => { const t = await selection.text(); return t && encodeURIComponent(t); } });

/**
 * Open the link's url as the link says: a tab already on the page when
 * the setting prefers one and a browser has it (focused through
 * browser-tabs), else the named browser for a web address, else the OS
 * opener (a `mailto:` or an app's scheme goes there whatever the field says).
 */
async function openLink(l: Link, url = l.url): Promise<Effect> {
  if (!/^https?:\/\//i.test(url)) return { open: url };
  if (conf().prefer_existing_tab) {
    const tab = await findTab(url).catch(() => undefined);
    if (tab) return focusTab(tab);
  }
  return l.app ? openWith(url, l.app) : { open: url };
}

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
    console.error(`[quicklinks] import ${file}: ${e instanceof Error ? e.message : e}`);
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
    accessories: l.app || arg ? [...(l.app ? [{ text: l.app }] : []), ...(arg ? [{ tag: `{${arg}}` }] : [])] : undefined,
    detail: {
      markdown: `# ${l.name}\n\n\`\`\`\n${l.url}\n\`\`\``,
      metadata: [
        ...(arg ? [{ label: "Asks for", value: arg }] : []),
        ...(l.keywords?.length ? [{ label: "Keywords", tags: l.keywords.map((text) => ({ text })) }] : []),
        ...(l.app ? [{ label: "Opens with", value: l.app }] : []),
        { label: "Source", value: readOnly ? "Import file" : "Your quicklinks" },
      ],
    },
    actions: readOnly ? [OPEN, COPY] : [OPEN, COPY, EDIT, DELETE],
  };
}

/** What a push's `args.create` may carry: a link another extension hands over to save (the form comes pre-filled). */
type Create = { name?: string; url?: string; keywords?: string | string[] };
const createArgs = (ctx?: Ctx): Create | undefined => { const c = (ctx?.args as { create?: unknown } | undefined)?.create; return c && typeof c === "object" ? (c as Create) : undefined; };

/** The create or edit form; `errors` when a submit was refused; `prefill` is what a new link starts with (another extension's `args.create`, or the tab in front). */
function form(l?: Link, errors?: Record<string, string>, prefill?: Create): Form {
  const apps = browsers();
  const app: FormField = { kind: "select", id: "app", label: "Open with", default: l?.app && apps.includes(l.app) ? l.app : DEFAULT_APP, options: [{ id: DEFAULT_APP, title: "Default browser" }, ...apps.map((id) => ({ id, title: id }))], description: "The browser it opens in." };
  const keywords = l?.keywords ?? (Array.isArray(prefill?.keywords) ? prefill.keywords : prefill?.keywords ? [prefill.keywords] : undefined);
  return {
    id: l?.id ?? CREATE,
    title: l ? `Edit ${l.name}` : "Create Quicklink",
    fields: [
      { kind: "text", id: "name", label: "Name", required: true, default: l?.name ?? prefill?.name, placeholder: "GitHub search" },
      { kind: "text", id: "url", label: "URL", required: true, default: l?.url ?? prefill?.url, placeholder: "https://github.com/search?q={query}", description: "{query} stands for what you type when opening it; {selection} and {clipboard} are filled without asking." },
      { kind: "text", id: "keywords", label: "Keywords", default: keywords?.join(" "), placeholder: "gh code", description: "Extra words that find it, space separated." },
      app,
    ],
    submit: { id: "save", title: l ? "Save" : "Create" },
    errors,
  };
}

/** The Create form for a push's `args.create`, else filled from the tab in front when a browser names one in time. */
async function createForm(ctx?: Ctx): Promise<Form> {
  const given = createArgs(ctx);
  if (given) return form(undefined, undefined, given);
  const tab = await activeTab().catch(() => undefined);
  return form(undefined, undefined, tab && { name: tab.title || undefined, url: tab.url });
}

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
  const chosen = String(values.app ?? "").trim();
  const app = chosen === DEFAULT_APP ? "" : chosen;
  const link: Link = { id: before?.id ?? crypto.randomUUID(), name, url, ...(keywords && { keywords }), ...(app && { app }) };
  await storage.set(KEY, before ? links.map((l) => (l.id === link.id ? link : l)) : [...links, link]);
  return { keep: true, toast: { title: before ? "Saved" : "Created", message: name } };
}

/** The library level: every ready-made search, tagged `added` when a link of yours has its url already. */
async function libraryRows(): Promise<Item[]> {
  const have = new Set((await own()).map((l) => l.url));
  return LIBRARY.map((e, i) => ({
    id: libraryId(i),
    name: e.name,
    subtitle: e.url,
    url: e.url,
    keywords: e.keywords,
    accessories: have.has(e.url) ? [{ tag: "added", color: "green" }] : undefined,
    actions: [have.has(e.url) ? SEARCH : ADD, have.has(e.url) ? ADD : SEARCH, COPY],
  }));
}

/** A library pick: add the entry to your links (once), search with it (the drill-in, through the stored link when there is one), or copy its url. */
async function libraryPick(id: string, action?: string): Promise<Effect> {
  const e = libraryEntry(id);
  if (!e) throw new Error(`no library entry ${id}`);
  const links = await own();
  const mine = links.find((l) => l.url === e.url);
  switch (action ?? (mine ? "search" : "add")) {
    case "copy": return { copy: e.url };
    case "search": {
      const l = mine ?? { id, name: e.name, url: e.url };
      return { push: { extension: EXTENSION, palette: PALETTE, args: { link: l.id, ...(!mine && { library: id }) }, title: l.name } };
    }
    default: {
      if (mine) return { keep: true, toast: { title: "Already there", message: mine.name } };
      await storage.set(KEY, [...links, { id: crypto.randomUUID(), name: e.name, url: e.url, keywords: e.keywords }]);
      return { keep: true, toast: { title: "Added", message: e.name } };
    }
  }
}

export default {
  // `pal://quicklinks/open?name=GitHub&query=pal`: a plain link opens, a
  // {query} link opens filled when `query` is given, else the panel asks.
  link: async (route: string, params: LinkParams): Promise<Effect | void> => {
    if (route !== "open") return;
    const l = await byName(String(params.name));
    if (!l) throw new Error(`no quicklink "${params.name}"`);
    if (!placeholder(l.url)) return openLink(l, await fillSilent(l.url));
    const q = typeof params.query === "string" ? params.query.trim() : "";
    return q ? openLink(l, await fillSilent(fill(l.url, q))) : { push: { extension: EXTENSION, palette: PALETTE, args: { link: l.id } } };
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
        // The drill-in for a placeholder link (a stored one, or a library entry searched without adding): one row, the url filled with what is typed.
        const args = ctx?.args as { link?: string; library?: string } | undefined;
        if (args?.link) {
          const lib = args.library ? libraryEntry(args.library) : undefined;
          const l = lib ? { id: args.link, name: lib.name, url: lib.url } : await find(args.link);
          if (!l) return [];
          const arg = placeholder(l.url) ?? "query";
          const q = (query ?? "").trim();
          const url = fill(l.url, q);
          return [q
            ? { id: url, name: `Open ${l.name}`, subtitle: url, url, actions: [OPEN, COPY] }
            : { id: l.id, name: `Type the ${arg}`, subtitle: l.url, url: l.url, actions: [] }];
        }
        if (args?.library) return libraryRows();
        // Pushed with `args.create` by another extension: one row whose form comes pre-filled with the link it hands over.
        const create = createArgs(ctx);
        if (create) return [{ id: CREATE, name: `Create Quicklink${create.name ? ` for ${create.name}` : ""}`, subtitle: create.url ?? "A link to save", icon: ICON.create, actions: [{ id: CREATE, title: "Create quicklink" }] }];
        return [
          { id: CREATE, name: "Create Quicklink", subtitle: "A link, with {query} where what you type goes", icon: ICON.create, keywords: ["new", "add"], actions: [{ id: CREATE, title: "Create quicklink" }] },
          { id: LIBRARY_ROW, name: "Browse Library", subtitle: `${LIBRARY.length} ready-made searches: Google, Wikipedia, GitHub, npm, MDN...`, icon: ICON.library, keywords: ["library", "search", "engines"], actions: [{ id: LIBRARY_ROW, title: "Browse library" }] },
          ...(await all()).map(row),
          { id: IMPORT, name: "Import Quicklinks", subtitle: "From a JSON file", icon: ICON.import, keywords: ["json", "restore"], actions: [{ id: IMPORT, title: "Import…" }] },
          { id: EXPORT, name: "Export Quicklinks", subtitle: "To a JSON file", icon: ICON.export, keywords: ["json", "backup"], actions: [{ id: EXPORT, title: "Export…" }] },
        ];
      },
      pick: async (id, action, ctx?: Ctx): Promise<Effect | void> => {
        // From the drill-in: the row's id is the filled url (opened as the link says); an inline or fallback row carries it after `open:`.
        const args = ctx?.args as { link?: string; library?: string } | undefined;
        if (args?.link) {
          if (action === "copy") return { copy: id };
          const l = args.library ? undefined : await find(args.link);
          return openLink(l ?? { id, name: id, url: id }, await fillSilent(id));
        }
        if (args?.library || id.startsWith(LIBRARY_ID)) return libraryPick(id, action);
        if (id.startsWith(OPEN_ID)) { const url = id.slice(OPEN_ID.length); return action === "copy" ? { copy: url } : { open: url }; }
        if (id === IMPORT || id === EXPORT) return action === "save" ? transfer(id, ctx?.values ?? {}) : { form: pathForm(id) };
        if (action === "save") return save(id, ctx?.values ?? {});
        if (id === CREATE) return { form: await createForm(ctx) };
        if (id === LIBRARY_ROW) return { push: { extension: EXTENSION, palette: PALETTE, args: { library: true }, title: "Quicklink Library" } };
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
            // A typed placeholder drills in; the SDK's ones are filled here and the url opens at once.
            return placeholder(l.url) ? { push: { extension: EXTENSION, palette: PALETTE, args: { link: id } } } : openLink(l, hasPlaceholders(l.url) ? await fillSilent(l.url) : l.url);
        }
      },
    },
  },
} satisfies Extension;
