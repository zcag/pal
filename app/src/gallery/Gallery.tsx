/**
 * Every component in every state, light and dark side by side. Opened with
 * `?gallery` in a normal browser against the Vite dev server.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ActionPanel, Detail, Empty, Footer, Form, Grid, Hud, Icon, Kbd, List, Panel, Row, Search, Toast, View,
  grammar, groupBySection, useCursor, type Hit, type ToastSpec,
} from "../ui";
import type { FormValues, Item, ViewNode } from "../ui/types";
import { Launcher } from "../Launcher";
import { PALETTES, toView, type SourceInfo } from "../items";
import { toItem, type Raw } from "../fixtures";
import { DEFAULTS, apply, newGame, type Action as Move, type State } from "../../../extensions/blackjack/game.ts";
import { cardSvg, backSvg } from "../../../extensions/blackjack/cards.ts";
import { render as renderTable } from "../../../extensions/blackjack/render.ts";
import { actions, deploy, formFields, handWritten, markdownOnly, nerdGlyphs, person, raycastDocs, sample, welcomeRows } from "./data";
import {
  SettingsAbout, SettingsBar, SettingsDiagnostics, SettingsExtensions, SettingsField, SettingsGeneral, SettingsPalettes, SettingsShortcuts, SettingsWindow,
  aboutIndex, barIndex, badgedIcon, extensionsIndex, generalIndex, palettesIndex, resolveInstance, shortcutsIndex, type BarItemConfig, type PaletteConfig, type SettingValue, type SettingValues, type SettingsExtension, type SettingsPage,
} from "../ui";
import { settingsBar, settingsBarItems, settingsDiagnostics, settingsExtensions, settingsFieldSpecs, settingsFile, settingsGeneral, settingsHotkeyStatus, settingsPermissions, tileRows } from "./data";
import Shots from "./shots";
import BarShot from "./bar-shot";
import { parseThemeToml } from "./theme-toml";
import { applyThemeFile, type ThemeFile } from "../theme";
import type { ThemeFileStatus } from "../ui/SettingsTheme";
import frappeToml from "../../../examples/themes/catppuccin-frappe.toml?raw";
import dawnToml from "../../../examples/themes/rose-pine-dawn.toml?raw";
import "./gallery.css";

/** The two bundled example themes, read from the files that ship. */
const exampleThemes: ThemeFile[] = [parseThemeToml(frappeToml, "catppuccin-frappe.toml"), parseThemeToml(dawnToml, "rose-pine-dawn.toml")];
/** What Settings > General's picker shows in the gallery: both examples in the folder, the first one set. */
const settingsThemeFile: ThemeFileStatus = { setting: "catppuccin-frappe", file: "~/.config/pal/themes/catppuccin-frappe.toml", name: "Catppuccin Frappé", diagnostics: [{ level: "warning", path: "light.accnet", message: "not a theme token; docs/config.md lists them" }], dir: "~/.config/pal/themes", themes: [{ name: "catppuccin-frappe", path: "~/.config/pal/themes/catppuccin-frappe.toml", title: "Catppuccin Frappé" }, { name: "rose-pine-dawn", path: "~/.config/pal/themes/rose-pine-dawn.toml", title: "Rosé Pine Dawn" }] };

/** A subtree drawn under a theme file: the scheme's variables set inline on the wrapper, as theme.ts sets them on `:root`. */
function Themed({ file, theme, children }: { file: ThemeFile; theme: "light" | "dark"; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (ref.current) applyThemeFile(file, ref.current); }, [file, theme]);
  return <div ref={ref} className="g-theme" data-theme={theme}>{children}</div>;
}

const themes = ["light", "dark"] as const;

/** Renders `children` once per theme. `panel` gives the launcher's frame; `surface` a padded panel background. */
function Pair({ children, panel, surface }: { children: ReactNode; panel?: boolean; surface?: boolean }) {
  return (
    <div className="g-pair">
      {themes.map((t) => (
        <div key={t} className="g-theme" data-theme={t}>
          <div className={panel ? "g-frame" : surface ? "pal-panel g-surface" : "g-loose"}>{children}</div>
        </div>
      ))}
    </div>
  );
}

function State({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="g-state">
      <h3 className="g-label">{label}</h3>
      {children}
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="g-section">
      <h2 className="g-title">{title}</h2>
      {children}
    </section>
  );
}

const noop = () => {};
const hitsOf = (items: Item[]): Hit[] => items.map((item) => ({ item }));

/** A list with its own cursor, for static demos. */
function DemoList({ items, grid, columns, aspect, start = 0 }: { items: Item[]; grid?: boolean; columns?: number; aspect?: number; start?: number }) {
  const hits = groupBySection(hitsOf(items));
  const cur = useCursor(hits.length, start);
  const id = `demo-${grid ? "grid" : "list"}`;
  return grid
    ? <Grid id={id} hits={hits} cursor={cur.cursor} onCursor={cur.set} columns={columns} aspect={aspect} />
    : <List id={id} hits={hits} cursor={cur.cursor} onCursor={cur.set} />;
}

/** Streams rows in a few at a time, like the feed does, to show the list holding still. */
function StreamingList({ pool }: { pool: Item[] }) {
  const [n, setN] = useState(0);
  const [run, setRun] = useState(0);
  useEffect(() => {
    setN(0);
    const id = setInterval(() => setN((k) => (k >= pool.length ? k : k + 7)), 60);
    return () => clearInterval(id);
  }, [pool, run]);
  const hits = groupBySection(hitsOf(pool.slice(0, n)));
  const cur = useCursor(hits.length);
  return (
    <div className="g-frame">
      <Panel
        search={<Search value="" onChange={noop} placeholder={`${n} of ${pool.length} rows streamed in`} />}
        footer={<Footer title={`${hits.length} rows`} primary={{ title: "Restart" }} onPrimary={() => setRun((r) => r + 1)} />}
      >
        <List id="stream" hits={hits} cursor={cur.cursor} onCursor={cur.set} />
      </Panel>
    </div>
  );
}

/** The `cmds` rows as a lazy palette: metadata inline, the markdown answered 700 ms after the cursor rests. */
const lazyFixture = (items: Item[]): Item[] => items.map((i) => (i.palette === "cmds" ? { ...i, detail: { metadata: i.detail?.metadata }, lazyDetail: true } : i.palette === "bookmarks" ? { ...i, actions } : i));

/** The rename form a bookmark's "Rename…" answers with; `errors` when the submit is refused. */
const renameForm = (item: Item, errors?: Record<string, string>) => ({
  id: item.id, title: `Rename ${item.name}`,
  fields: [
    { kind: "text" as const, id: "name", label: "Name", required: true, default: item.name, description: "Try submitting it unchanged, or empty." },
    { kind: "checkbox" as const, id: "pin", label: "Pinned", text: "Show at the top" },
  ],
  submit: { id: "save", title: "Rename" }, errors,
});

/** One live launcher at a time: both listen on the window, as the app's one does, so two would answer every key. */
type Live = "playground" | "blackjack";
function LiveSlot({ id, live, onLive, children }: { id: Live; live: Live; onLive: (id: Live) => void; children: ReactNode }) {
  if (live === id) return <>{children}</>;
  return <div className="g-frame g-frame--live g-frame--parked"><button type="button" onClick={() => onLive(id)}>Make this the live launcher</button><span className="g-note">The other live launcher has the keyboard; one at a time, as in the app.</span></div>;
}

function Playground({ items }: { items: Item[] }) {
  const [hud, setHud] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const flash = (text: string) => { setHud(text); setTimeout(() => setHud(null), 1200); };
  const lazy = useMemo(() => lazyFixture(items), [items]);
  return (
    <div className="g-playground">
      <p className="g-note">Live: every key in the grammar works here. Enter and Escape at the root flash a HUD instead of hiding. Marks go to the console. Commands are a lazy-detail palette (skeleton, then markdown); a palette with a few sections has them as its filter dropdown (Tab cycles); Enter on a command opens a show level (its output), Enter on a bookmark a drill-in level (Commands, with args), ⌘R on a bookmark a form level (Rename…): an unchanged name comes back refused, a changed one is a toast.</p>
      <div className="g-frame g-frame--live">
        <Launcher
          items={lazy}
          detail={(item) => new Promise((r) => setTimeout(() => r({ markdown: `# ${item.name}\n\nFetched on demand for \`${item.id}\`.\n\n\`\`\`\n${item.name}\n\`\`\``, metadata: item.detail?.metadata }), 700))}
          onPick={(item, _q, action, ctx) => {
            flash(`Picked ${item.name}`); setLog((l) => [`pick ${item.id}${action ? ` (${action})` : ""}${ctx?.args ? ` args=${JSON.stringify(ctx.args)}` : ""}`, ...l].slice(0, 5));
            if (item.palette === "cmds" && !ctx?.args) return { show: { markdown: "```\n$ " + item.id + "\n" + Array.from({ length: 40 }, (_, i) => `[${String(i + 1).padStart(2, "0")}/40] ${item.name}: step ${i + 1} ok`).join("\n") + "\n```", title: `${item.name} output` } };
            if (action === "rename") return { form: renameForm(item) };
            if (action === "save") {
              const name = String(ctx?.values?.name ?? "").trim();
              setLog((l) => [`values ${JSON.stringify(ctx?.values)}`, ...l].slice(0, 5));
              if (name === item.name) return { form: renameForm(item, { name: "That is its name already" }) };
              return { toast: { title: `Renamed to ${name}` } };
            }
            if (item.palette === "bookmarks" && !ctx?.args && (!action || action === "open")) return { push: { extension: "", palette: "cmds", args: { parent: item.id } } };
          }}
          onHide={() => flash("Hidden")}
          mark={(name, t) => console.debug(name, Math.round(t))}
        />
        {hud && <div className="g-hud-anchor"><Hud text={hud} /></div>}
      </div>
      <pre className="g-log">{log.join("\n") || " "}</pre>
    </div>
  );
}

function FormDemo() {
  const [result, setResult] = useState<FormValues | "cancelled" | null>(null);
  return (
    <div className="g-frame">
      <Panel search={<Search value="" onChange={noop} back={{ title: "Add bookmark", onBack: noop }} />} footer={<Footer title="Add bookmark" primary={{ title: "Save" }} />}>
        <Form title="Add bookmark" fields={formFields} submitTitle="Save" onSubmit={setResult} onCancel={() => setResult("cancelled")} />
      </Panel>
      {result && <Toast toast={result === "cancelled" ? { style: "failure", title: "Cancelled" } : { style: "success", title: "Submitted", message: JSON.stringify(result) }} />}
    </div>
  );
}

/* View section: the vocabulary, and blackjack drawn by the extension's own render.ts. */
const vocabulary: ViewNode = {
  type: "stack", padding: 4, gap: 3,
  children: [
    { type: "stack", direction: "row", gap: 3, children: [
      { type: "text", value: "title", style: "title" }, { type: "text", value: "body", style: "body" }, { type: "text", value: "muted", style: "muted" },
      { type: "text", value: "mono 0x1F", style: "mono" }, { type: "text", value: "1,024.50", style: "number" },
      { type: "divider" },
      { type: "text", value: "xs", size: "xs" }, { type: "text", value: "sm", size: "sm" }, { type: "text", value: "md", size: "md" }, { type: "text", value: "lg", size: "lg" }, { type: "text", value: "xl", size: "xl" },
      { type: "divider" },
      { type: "text", value: "regular", weight: "regular" }, { type: "text", value: "medium", weight: "medium" }, { type: "text", value: "semibold", weight: "semibold" },
    ] },
    { type: "stack", direction: "row", gap: 3, children: (["accent", "success", "destructive", "muted", "faint", "grey", "blue", "green", "amber", "red", "violet", "pink", "teal"] as const).map((color) => ({ type: "text", value: color, color })) },
    { type: "stack", direction: "row", gap: 2, children: (["grey", "blue", "green", "amber", "red", "violet", "pink", "teal"] as const).map((color) => ({ type: "badge", text: color, color })) },
    { type: "stack", direction: "row", gap: 2, children: [
      { type: "keycap", keys: "h" }, { type: "keycap", keys: "space" }, { type: "keycap", keys: "+" }, { type: "keycap", keys: "up" }, { type: "keycap", keys: "enter" }, { type: "keycap", keys: "cmd+shift+k" },
      { type: "spacer" },
      { type: "text", value: "spacer pushes this right", style: "muted", size: "sm" },
    ] },
    { type: "stack", direction: "row", gap: 3, align: "center", children: [
      { type: "text", value: "progress", style: "muted", size: "xs" },
      { type: "progress", value: 0 }, { type: "progress", value: 0.25 }, { type: "progress", value: 0.62, width: 72 }, { type: "progress", value: 1 },
      { type: "progress", value: 0.7, width: 48, color: "green" }, { type: "progress", value: 0.4, width: 48, color: "grey" },
    ] },
    { type: "stack", direction: "row", gap: 2, align: "end", children: [
      ...(["neutral", "accent", "grey", "blue", "green", "amber", "red", "violet", "pink", "teal"] as const).map((color): ViewNode => ({ type: "stack", direction: "column", gap: 1, children: [
        { type: "tile", width: 32, height: 32, text: "8", color, fill: "solid" },
        { type: "tile", width: 32, height: 32, text: "8", color, fill: "soft" },
        { type: "tile", width: 32, height: 32, text: "8", color, fill: "outline" },
      ] })),
      { type: "tile", width: 64, height: 64, text: "2048", color: "accent", fill: "solid" },
      { type: "tile", width: 56, height: 48, text: "42", sub: "played", color: "neutral", fill: "soft" },
      { type: "tile", width: 32, height: 40, text: "Q", color: "neutral", fill: "soft" },
      { type: "text", value: "tile: solid, soft, outline per colour; the type scales with the box and shrinks to fit the text; a sub line", style: "muted", size: "xs" },
    ] },
    { type: "stack", direction: "row", gap: 3, align: "start", children: [
      { type: "stack", direction: "row", gap: 2, padding: 2, surface: "sunken", radius: true, children: [
        { type: "tile", width: 40, height: 40, text: "2", color: "neutral", fill: "solid" }, { type: "tile", width: 40, height: 40, color: "neutral", fill: "outline" }, { type: "tile", width: 40, height: 40, text: "4", color: "neutral", fill: "soft" },
        { type: "text", value: "sunken, radius", style: "muted", size: "xs" },
      ] },
      { type: "stack", direction: "column", gap: 1, padding: 3, surface: "elevated", radius: true, children: [
        { type: "text", value: "elevated, radius", style: "muted", size: "xs" },
        ...([["1", 0.1, "grey"], ["2", 0.6, "grey"], ["3", 1, undefined]] as const).map(([n, v, color]): ViewNode => ({ type: "stack", direction: "row", gap: 1, children: [
          { type: "text", value: n, style: "mono", size: "xs", color: "faint", width: 8, align: "end" },
          { type: "progress", value: v, width: 80, color },
          { type: "text", value: String(Math.round(v * 14)), style: "number", size: "xs", color: color ? "muted" : "accent", width: 20, align: "end" },
        ] })),
        { type: "text", value: "text.width lines the columns up", style: "muted", size: "xs" },
      ] },
    ] },
    { type: "stack", direction: "row", gap: 2, align: "end", children: [
      { type: "image", src: cardSvg("AS"), width: 56, height: 80, alt: "ace of spades" },
      { type: "image", src: cardSvg("QH"), width: 56, height: 80 },
      { type: "image", src: cardSvg("10D"), width: 56, height: 80 },
      { type: "image", src: cardSvg("7C"), width: 56, height: 80 },
      { type: "image", src: backSvg(), width: 56, height: 80 },
      { type: "image", src: cardSvg("KS"), width: 28, height: 40, mask: "rounded" },
      { type: "image", src: cardSvg("2H"), width: 40, height: 40, mask: "circle" },
      { type: "text", value: "image: an SVG the extension drew, sized in px, rounded or circle mask", style: "muted", size: "xs" },
    ] },
    { type: "stack", direction: "row", gap: 2, children: [
      { type: "stack", direction: "column", gap: 1, padding: 2, children: [{ type: "text", value: "column, gap 1, padding 2", style: "muted", size: "xs" }, { type: "text", value: "one" }, { type: "text", value: "two" }] },
      { type: "divider" },
      { type: "stack", direction: "column", gap: 1, padding: 2, align: "center", grow: true, children: [{ type: "text", value: "grow, align center", style: "muted", size: "xs" }, { type: "text", value: "centred" }] },
      { type: "divider" },
      { type: "stack", direction: "column", gap: 1, padding: 2, align: "end", children: [{ type: "text", value: "align end", style: "muted", size: "xs" }, { type: "text", value: "right" }] },
    ] },
  ],
};

/** A rigged shoe: the dealer pops from the end, so `order` lists player, dealer, player, hole, then draws. */
const rigged = (order: string[], s = DEFAULTS): State => {
  const st = newGame(s, () => 0.5);
  return { ...st, shoe: [...st.shoe.slice(0, 200), ...[...order].reverse()] as State["shoe"] };
};
const midHand = apply(apply(rigged(["8S", "KH", "8D", "7C", "3S", "5S", "10S"]), "deal"), "split");
const settledHand = (() => { let st = apply(rigged(["10S", "9H", "9D", "6C", "KS"]), "deal"); st = apply(st, "stand"); st.stats = { hands: 12, wins: 7, losses: 4, pushes: 1, blackjacks: 1, net: 85 }; return st; })();
const betting = (() => { const st = newGame(DEFAULTS, () => 0.5); st.stats = { hands: 12, wins: 7, losses: 4, pushes: 1, blackjacks: 1, net: 85 }; st.bankroll = 1085; st.bet = 25; return st; })();

const blackjackSource: SourceInfo = { extension: "", palette: "blackjack", title: "Blackjack", live: false, input: true, view: "view", icon: "🃏", count: 0, stale: false };

/** A live view level: the root has one palette row; Enter on it asks `view`, every key is a pick whose reply is the next tree, exactly as the host does it. */
function BlackjackDemo() {
  const state = useRef<State>(newGame(DEFAULTS));
  const [log, setLog] = useState<string[]>([]);
  const search = useCallback(async (q: string, scope?: SourceInfo): Promise<Hit[]> => (scope || (q && !"blackjack".includes(q.toLowerCase())) ? [] : [{ item: { id: "blackjack", name: "Blackjack", subtitle: "Blackjack", icon: { kind: "emoji", value: "🃏" }, palette: PALETTES, keywords: ["blackjack"] } }]), []);
  return (
    <div className="g-playground">
      <p className="g-note">Live: Enter on the row opens the view level. H hit, S stand, D double, P split, Enter deals, + / − set the bet, N starts over (asks first), ⌘K lists the moves, Escape leaves and the hand is still there when you come back. Every key is a pick answered with the next tree by the extension's own <code>render.ts</code>.</p>
      <div className="g-frame g-frame--live">
        <Launcher
          sources={[blackjackSource]}
          search={search}
          view={async () => toView(renderTable(state.current, DEFAULTS))}
          onPick={async (item, _q, action) => {
            if (item.palette === PALETTES) return { keep: true };
            // A host round trip's worth of latency, so the one-pick-at-a-time rule and the sweep can be seen.
            await new Promise((r) => setTimeout(r, 120));
            const move = action as Move | undefined;
            const next = move ? apply(state.current, move, DEFAULTS) : state.current;
            setLog((l) => [`pick ${item.id} (${action}) -> ${next.phase}`, ...l].slice(0, 4));
            state.current = next;
            return { view: toView(renderTable(next, DEFAULTS)) };
          }}
          onHide={() => setLog((l) => ["hide", ...l].slice(0, 4))}
        />
      </div>
      <pre className="g-log">{log.join("\n") || " "}</pre>
    </div>
  );
}

const toasts: ToastSpec[] = [
  { style: "success", title: "Copied", message: "https://developers.raycast.com" },
  { style: "failure", title: "Could not reach marko", message: "ssh: connect to host marko port 22: No route to host" },
  { style: "animated", title: "Deploying…" },
];

/**
 * `?gallery=settings:<page>[&theme=dark]`: one settings window alone,
 * filling the viewport, so a headless browser at the window's size
 * screenshots exactly what the app shows.
 */
function Solo({ what }: { what: string }) {
  const params = new URLSearchParams(location.search);
  const theme = params.get("theme") === "dark" ? "dark" : "light";
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  const [, page = "general"] = what.split(":");
  // `&q=hot` types into the search field once mounted, for the results state.
  useEffect(() => {
    const q = params.get("q");
    const input = document.querySelector<HTMLInputElement>(".pal-settings__search-input");
    if (!q || !input) return;
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    set?.call(input, q);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, []);
  return (
    <div className="g-solo" data-theme={theme}>
      <SettingsDemo page={page as SettingsPage} diagnostics={params.has("diagnostics")} />
    </div>
  );
}

export default function Gallery() {
  const params = new URLSearchParams(location.search);
  const solo = params.get("gallery");
  if (solo?.startsWith("settings")) return <Solo what={solo} />;
  // `?gallery&shot=<extension>&palette=<key>[&theme=dark]`: one launcher on the wallpaper, for the store screenshots (shots.tsx).
  const shot = params.get("shot");
  if (shot) return <Shots extension={shot} palette={params.get("palette") ?? undefined} theme={params.get("theme") === "dark" ? "dark" : "light"} />;
  // `?gallery&bar=<ext>/<id>&target=menubar|sketchybar&theme=dark|light[&state=<id>][&popover=1]`: a bar item on its strip (bar-shot.tsx).
  const bar = params.get("bar");
  if (bar) return <BarShot bar={bar} target={params.get("target") === "sketchybar" ? "sketchybar" : "menubar"} theme={params.get("theme") === "dark" ? "dark" : "light"} state={params.get("state") ?? undefined} popover={params.has("popover")} />;
  return <GalleryPage />;
}

function GalleryPage() {
  const [raws, setRaws] = useState<Raw[]>([]);
  const [live, setLive] = useState<Live>("playground");
  const [theme, setTheme] = useState<(typeof themes)[number]>(() => (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => {
    fetch("/fixtures/all.jsonl").then((r) => r.text()).then((t) => setRaws(t.split("\n").filter(Boolean).map((l) => JSON.parse(l) as Raw)));
  }, []);
  const fixture = sample(raws);
  const all = raws.map(toItem);
  const byPalette = (p: string, n: number) => fixture.filter((i) => i.palette === p).slice(0, n);
  const mixed = [...handWritten, ...byPalette("apps", 6), ...byPalette("bookmarks", 5), ...byPalette("cmds", 5)];
  const glyphs = [...byPalette("emoji", 12), ...byPalette("iconnerd", 12), ...byPalette("chars", 12), ...byPalette("colors", 12)];

  return (
    <main className="g-page">
      <header className="g-header">
        <h1>pal UI gallery</h1>
        <nav className="g-nav">{nav.map((s) => <a key={s.id} href={`#${s.id}`}>{s.title}</a>)}</nav>
        <div className="g-toolbar">
          {themes.map((t) => <button key={t} type="button" onClick={() => setTheme(t)} aria-pressed={theme === t}>{t}</button>)}
          <span className="g-note">
            {raws.length ? `${raws.length} fixture rows loaded. ` : "Loading fixtures… "}
            Page theme for the playground; the pairs below pin their own.
          </span>
        </div>
      </header>

      <Section id="playground" title="Playground">
        <LiveSlot id="playground" live={live} onLive={setLive}>{raws.length ? <Playground items={all} /> : null}</LiveSlot>
      </Section>

      <Section id="grammar" title="Keyboard grammar">
        <table className="g-grammar">
          <tbody>
            {grammar.map((g) => (
              <tr key={g.does}>
                <td>{g.keys.map((k) => <Kbd key={k} shortcut={k} />)}</td>
                <td>{g.does}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section id="panel" title="Panel">
        <State label="Search, list, footer">
          <Pair panel><Panel search={<Search value="" onChange={noop} />} footer={<Footer title="12 of 14719" primary={{ title: "Open" }} actions />}><DemoList items={mixed} /></Panel></Pair>
        </State>
        <State label="With detail pane (cmd+i)">
          <Pair panel><Panel search={<Search value="dep" onChange={noop} />} aside={<Detail detail={deploy.detail!} />} footer={<Footer icon={deploy.icon} title={deploy.name} primary={{ title: "Run" }} actions />}><DemoList items={mixed} /></Panel></Pair>
        </State>
        <State label="Detail pane, lazy detail on its way: the metadata is inline, the markdown is being fetched">
          <Pair panel><Panel search={<Search value="dep" onChange={noop} />} aside={<Detail detail={{ metadata: deploy.detail!.metadata }} loading />} footer={<Footer icon={deploy.icon} title={deploy.name} primary={{ title: "Run" }} actions />}><DemoList items={mixed} /></Panel></Pair>
        </State>
        <State label="Drilled into a palette with filters: the dropdown holds the palette's own scopes">
          <Pair panel><Panel search={<Search value="" onChange={noop} back={{ title: "Pull requests", icon: { kind: "glyph", value: "󰘬" }, onBack: noop }} filter={{ options: [{ id: "all", title: "All" }, { id: "work", title: "Work (serpapi)" }, { id: "own", title: "Own repos" }, { id: "oss", title: "Out there (OSS)" }], value: "work", onChange: noop }} placeholder="Search Pull requests…" />} footer={<Footer title="4 of 11" primary={{ title: "Open PR" }} actions />}><DemoList items={byPalette("cmds", 6)} /></Panel></Pair>
        </State>
        <State label="Show level (a pick's output to read): the Detail full width, Back in the footer, arrows scroll">
          <Pair panel>
            <Panel search={<Search value="" onChange={noop} back={{ title: "Deploy output", onBack: noop }} placeholder="" readOnly />} footer={<Footer title="Deploy output" primary={{ title: "Back" }} />}>
              <div className="pal-show" role="document"><Detail detail={{ markdown: "```\n" + Array.from({ length: 14 }, (_, i) => `[${String(i + 1).padStart(2, "0")}/14] deploying tela… step ${i + 1} ok`).join("\n") + "\n```" }} /></div>
            </Panel>
          </Pair>
        </State>
        <State label="Welcome: a fresh profile's empty query leads with the tips (Enter on the first shows its detail, the last hides them)">
          <Pair panel><Panel search={<Search value="" onChange={noop} />} footer={<Footer icon={welcomeRows[0].icon} title={welcomeRows[0].name} primary={{ title: "Show details" }} actions />}><DemoList items={[...welcomeRows.map((i) => ({ ...i, section: "Welcome" })), ...byPalette("apps", 4).map((i) => ({ ...i, section: "Apps" }))]} /></Panel></Pair>
        </State>
        <State label="Welcome, first row's detail open: the panel explained in the pane">
          <Pair panel><Panel search={<Search value="" onChange={noop} />} aside={<Detail detail={welcomeRows[0].detail!} />} footer={<Footer icon={welcomeRows[0].icon} title={welcomeRows[0].name} primary={{ title: "Hide details" }} actions />}><DemoList items={[...welcomeRows.map((i) => ({ ...i, section: "Welcome" })), ...byPalette("apps", 4).map((i) => ({ ...i, section: "Apps" }))]} /></Panel></Pair>
        </State>
        <State label="Empty results: what was searched and what to try; the shell's actions stay under cmd+k">
          <Pair panel><Panel search={<Search value="zzzz" onChange={noop} />} footer={<Footer title="0 of 14719" actions />}><Empty icon={{ kind: "glyph", value: "⌕" }} title="No results for “zzzz”" hint="Try a different word, or ⌘K for actions" /></Panel></Pair>
        </State>
        <State label="Empty results with one extension loaded: a note about the setup under the hint">
          <Pair panel><Panel search={<Search value="zzzz" onChange={noop} />} footer={<Footer title="0 of 212" actions />}><Empty icon={{ kind: "glyph", value: "⌕" }} title="No results for “zzzz”" hint="Try a different word, or ⌘K for actions" note="Only one extension is loaded, so there is little to find. Settings (⌘,) › Extensions lists them; the Welcome tips link the guide to adding more." /></Panel></Pair>
        </State>
        <State label="Action panel open">
          <Pair panel>
            <Panel search={<Search value="" onChange={noop} />} footer={<Footer icon={raycastDocs.icon} title={raycastDocs.name} primary={{ title: "Open in Browser" }} actions />} overlay={<ActionPanel actions={actions} onRun={noop} onClose={noop} title={raycastDocs.name} />}>
              <DemoList items={mixed} start={1} />
            </Panel>
          </Pair>
        </State>
        <State label="Toast">
          <Pair panel><Panel search={<Search value="" onChange={noop} />} footer={<Footer title="12 of 14719" primary={{ title: "Open" }} actions />} overlay={<Toast toast={toasts[0]} />}><DemoList items={mixed} /></Panel></Pair>
        </State>
      </Section>

      <Section id="compact" title="Compact mode">
        <p className="g-note">`general.compact` (cmd+shift+m in the panel): 560 wide, 32 px rows, no detail pane, the footer folded into the search row's right side (the primary hint; ⌘K still lists the actions). The subtitle goes as beside a detail pane; the type stays.</p>
        <State label="Root, both themes">
          <div className="g-pair">
            {themes.map((t) => (
              <div key={t} className="g-theme" data-theme={t} data-density="compact">
                <div className="g-frame g-frame--compact"><Panel search={<Search value="" onChange={noop} hint={{ title: "Open" }} />}><DemoList items={mixed} /></Panel></div>
              </div>
            ))}
          </div>
        </State>
        <State label="Inside a palette, rows marked">
          <div className="g-pair">
            {themes.map((t) => (
              <div key={t} className="g-theme" data-theme={t} data-density="compact">
                <div className="g-frame g-frame--compact"><Panel search={<Search value="" onChange={noop} back={{ title: "Pull requests", icon: { kind: "glyph", value: "󰘬" }, onBack: noop }} placeholder="Search Pull requests…" hint={{ title: "Open PR" }} count={2} />}><DemoList items={mixed} /></Panel></div>
              </div>
            ))}
          </div>
        </State>
      </Section>

      <Section id="theme-file" title="Theme file">
        <p className="g-note">`general.theme_file`: the two examples that ship (examples/themes/, read here from the same files), each drawn for its light and its dark section over the same rows. The app sets the section's variables on `:root` and swaps them when the scheme flips.</p>
        {exampleThemes.map((f) => (
          <State key={f.file} label={`${f.theme.name} (${f.file})`}>
            <div className="g-pair">
              {themes.map((t) => (
                <Themed key={t} file={f} theme={t}>
                  <div className="g-frame"><Panel search={<Search value="" onChange={noop} />} footer={<Footer title="12 of 14719" primary={{ title: "Open" }} actions />}><DemoList items={mixed} /></Panel></div>
                </Themed>
              ))}
            </div>
          </State>
        ))}
      </Section>

      <Section id="search" title="Search">
        {[
          ["Empty", <Search value="" onChange={noop} />],
          ["With text", <Search value="deploy tela" onChange={noop} />],
          ["Back affordance (pushed level)", <Search value="" onChange={noop} placeholder="Search Bookmarks…" back={{ title: "Bookmarks", icon: { kind: "glyph", value: "" }, onBack: noop }} />],
          ["Filter dropdown (tab cycles)", <Search value="" onChange={noop} filter={{ options: [{ id: "all", title: "All" }, { id: "apps", title: "Applications" }], value: "apps", onChange: noop }} />],
          ["Back and filter", <Search value="ha" onChange={noop} back={{ title: "Bookmarks", onBack: noop }} filter={{ options: [{ id: "all", title: "All" }, { id: "infra", title: "Infra" }], value: "all", onChange: noop }} />],
          ["Loading", <Search value="" onChange={noop} loading />],
        ].map(([label, el]) => <State key={label as string} label={label as string}><Pair surface>{el}</Pair></State>)}
      </Section>

      <Section id="row" title="Row">
        {[
          ["Plain", <Row item={{ id: "a", name: "Activity Monitor", icon: { kind: "glyph", value: "A" } }} />],
          ["Active", <Row item={{ id: "a", name: "Activity Monitor", subtitle: "macOS", icon: { kind: "glyph", value: "A" } }} active />],
          ["Match highlighting", <Row item={{ id: "a", name: "Activity Monitor", subtitle: "Utilities", icon: { kind: "glyph", value: "A" } }} match={{ name: new Set([0, 1, 9, 10]), subtitle: new Set([0, 4]) }} />],
          ["Accessories: text, tag, date", <Row item={deploy} />],
          ["Accessories: relative dates", <Row item={person} />],
          ["Future date", <Row item={{ ...handWritten[6] }} />],
          ["Emoji icon", <Row item={handWritten[5]} />],
          ["Glyph icon, tinted", <Row item={{ id: "c", name: "Red", icon: { kind: "glyph", value: "●", color: "#ff0000" }, accessories: [{ tag: "#FF0000", color: "#ff0000" }] }} />],
          ["Image icon, rounded mask", <Row item={raycastDocs} />],
          ["Image icon, circle mask", <Row item={person} active />],
          ["No icon", <Row item={handWritten[4]} />],
          ["Long title and subtitle", <Row item={handWritten[3]} />],
          ["Ordinal hint (cmd held)", <Row item={raycastDocs} ordinal={3} />],
        ].map(([label, el]) => <State key={label as string} label={label as string}><Pair surface>{el}</Pair></State>)}
        <State label="Nerd Font glyphs: private-use codepoints from the bundled symbols font, so they draw without a Nerd Font installed">
          <Pair surface>
            {nerdGlyphs.map((item, i) => <Row key={item.id} item={item} active={i === 1} />)}
            <Footer icon={nerdGlyphs[1].icon} title="Pull requests" primary={{ title: "Open" }} actions />
          </Pair>
        </State>
      </Section>

      <Section id="tiles" title="Icon tiles">
        <p className="g-note">Every bundled extension's icon as its manifest writes it (<code>extensions/*/pal.json</code>, read live): a rounded square in one of the twelve <code>--pal-brand-*</code> colours with a white mark. The same tile at 24 in a row, 20 in the crumb and the footer, 32 in a grid cell, 56 on a settings page. A row's plain glyph takes its palette's colour (<code>tint</code>); a state keeps its own.</p>
        <State label="Palette rows, the second selected">
          <Pair surface>
            {tileRows.map((item, i) => <Row key={item.id} item={item} active={i === 1} />)}
          </Pair>
        </State>
        <State label="Crumb and footer at 20">
          <Pair surface>
            <Search value="" onChange={noop} back={{ title: "Pull Requests", icon: tileRows.find((r) => r.id === "github")?.icon, onBack: noop }} placeholder="Search Pull Requests…" />
            <Footer icon={tileRows.find((r) => r.id === "timer")?.icon} title="3 of 3" primary={{ title: "Stop" }} actions />
          </Pair>
        </State>
        <State label="Rows tinted in the extension's colour, and state glyphs in their own">
          <Pair surface>
            <Row item={{ id: "t1", name: "Batch the index writes on startup", subtitle: "acme/widgets #142", icon: { kind: "glyph", value: "\uf407", tint: "green" }, accessories: [{ tag: "approved", color: "green" }] }} />
            <Row item={{ id: "t2", name: "Drop the legacy importer", subtitle: "acme/widgets #131", icon: { kind: "glyph", value: "\uf419", tint: "violet" }, accessories: [{ tag: "merged", color: "violet" }] }} active />
            <Row item={{ id: "t3", name: "pal-web", subtitle: "running · 2h", icon: { kind: "glyph", value: "\u{f0868}", tint: "cyan" }, accessories: [{ tag: "up", color: "green" }] }} />
            <Row item={{ id: "t4", name: "Tea", subtitle: "12:30 left", icon: { kind: "glyph", value: "\u{f051b}", tint: "amber" }, accessories: [{ text: "25m" }] }} />
            <Row item={{ id: "t5", name: "No calculator found", subtitle: "A hint row keeps the palette's colour", icon: { kind: "glyph", value: "\u{f0029}", tint: "indigo" }, accessories: [] }} />
          </Pair>
        </State>
        <State label="Grid cell at 32 and a settings hero at 56">
          <Pair panel><Panel search={<Search value="" onChange={noop} />}><DemoList grid columns={8} items={tileRows.slice(0, 16).map((i) => ({ ...i, section: undefined }))} start={2} /></Panel></Pair>
          <Pair surface>
            <div style={{ display: "flex", gap: 16, alignItems: "center", padding: 8 }}>
              {["github", "onepassword", "home-assistant", "media", "timer", "clipboard", "apps", "2048"].map((n) => <Icon key={n} icon={tileRows.find((r) => r.id === n)?.icon} size="lg" />)}
            </div>
          </Pair>
        </State>
      </Section>

      <Section id="list" title="List">
        <State label="Sections with counts, cursor on row 2">
          <Pair panel><Panel search={<Search value="" onChange={noop} />}><DemoList items={mixed} start={1} /></Panel></Pair>
        </State>
        <State label="Flat, no sections">
          <Pair panel><Panel search={<Search value="" onChange={noop} />}><DemoList items={byPalette("apps", 12).map((i) => ({ ...i, section: undefined }))} /></Panel></Pair>
        </State>
        <State label="Streaming in (no jump while rows arrive)">
          <Pair>{raws.length ? <StreamingList pool={all.slice(0, 600)} /> : null}</Pair>
        </State>
      </Section>

      <Section id="grid" title="Grid">
        <State label="8 columns, square, sections">
          <Pair panel><Panel search={<Search value="" onChange={noop} />}><DemoList grid columns={8} items={glyphs.map((i) => ({ ...i, section: i.palette }))} start={9} /></Panel></Pair>
        </State>
        <State label="4 columns, 16:9, flat">
          <Pair panel><Panel search={<Search value="" onChange={noop} />}><DemoList grid columns={4} aspect={16 / 9} items={[...handWritten, ...byPalette("apps", 5)].map((i) => ({ ...i, section: undefined }))} /></Panel></Pair>
        </State>
      </Section>

      <Section id="view" title="View">
        <p className="g-note">A view level: the extension sends a render tree from a fixed vocabulary (stack, text, image, tile, badge, divider, spacer, progress, keycap) and the app draws it with the tokens; the search input gives way to the view's title, the footer keeps the first action and ⌘K. A keyed node enters (fade, slide-up/down/left/right, flip, pop), exits, or with <code>move</code> slides from where its key was in the previous tree.</p>
        <State label="Vocabulary: every primitive in every style"><Pair surface><View tree={vocabulary} /></Pair></State>
        <State label="Blackjack, mid-hand after a split: hand 1 is being played (blue), the hole card is face down">
          <Pair panel>
            <Panel search={<Search value="" onChange={noop} back={{ title: "Blackjack", icon: { kind: "emoji", value: "🃏" }, onBack: noop }} title="Hand 1 of 2" />} footer={<Footer icon={{ kind: "emoji", value: "🃏" }} title="Hand 1 of 2" primary={{ title: "Hit" }} actions />}>
              <View tree={toView(renderTable(midHand, DEFAULTS)).tree} />
            </Panel>
          </Pair>
        </State>
        <State label="Blackjack, settled: the dealer drew and bust, the result line rose in, the bankroll and the record moved">
          <Pair panel>
            <Panel search={<Search value="" onChange={noop} back={{ title: "Blackjack", icon: { kind: "emoji", value: "🃏" }, onBack: noop }} title="Dealer busts" />} footer={<Footer icon={{ kind: "emoji", value: "🃏" }} title="Dealer busts" primary={{ title: "Next hand" }} actions />}>
              <View tree={toView(renderTable(settledHand, DEFAULTS)).tree} />
            </Panel>
          </Pair>
        </State>
        <State label="Blackjack, placing a bet: the table is clear and the rows keep their height; ⌘K lists the moves with their keys">
          <Pair panel>
            <Panel search={<Search value="" onChange={noop} back={{ title: "Blackjack", icon: { kind: "emoji", value: "🃏" }, onBack: noop }} title="Place your bet" />} footer={<Footer icon={{ kind: "emoji", value: "🃏" }} title="Place your bet" primary={{ title: "Deal" }} actions />} overlay={<ActionPanel actions={toView(renderTable(betting, DEFAULTS)).actions} onRun={noop} onClose={noop} title="Place your bet" />}>
              <View tree={toView(renderTable(betting, DEFAULTS)).tree} />
            </Panel>
          </Pair>
        </State>
        <State label="Live">
          <LiveSlot id="blackjack" live={live} onLive={setLive}><BlackjackDemo /></LiveSlot>
        </State>
      </Section>

      <Section id="detail" title="Detail">
        <State label="Markdown and metadata"><Pair surface><Detail detail={deploy.detail!} /></Pair></State>
        <State label="Loading (lazy markdown), metadata inline"><Pair surface><Detail detail={{ metadata: deploy.detail!.metadata }} loading /></Pair></State>
        <State label="Metadata only"><Pair surface><Detail detail={person.detail!} /></Pair></State>
        <State label="Markdown only"><Pair surface><Detail detail={markdownOnly} /></Pair></State>
      </Section>

      <Section id="actions" title="ActionPanel">
        <State label="Open: sections, implied enter / cmd+enter, declared shortcuts, destructive (type to filter)">
          <Pair panel><Panel search={<Search value="" onChange={noop} />} overlay={<ActionPanel actions={actions} onRun={noop} onClose={noop} title="Raycast API reference" />}><DemoList items={mixed} /></Panel></Pair>
        </State>
        <State label="Two actions, no sections, no title">
          <Pair panel><Panel search={<Search value="" onChange={noop} />} overlay={<ActionPanel actions={person.actions!} onRun={noop} onClose={noop} />}><DemoList items={mixed} start={2} /></Panel></Pair>
        </State>
      </Section>

      <Section id="footer" title="Footer">
        {[
          ["Counts, primary, actions", <Footer title="200+ of 14719" primary={{ title: "Open" }} actions />],
          ["Context icon and title", <Footer icon={deploy.icon} title="Deploy tela" primary={{ title: "Run" }} actions />],
          ["Primary only", <Footer title="3 of 3" primary={{ title: "Open" }} />],
          ["Nothing to do", <Footer title="0 of 14719" />],
        ].map(([label, el]) => <State key={label as string} label={label as string}><Pair surface>{el}</Pair></State>)}
      </Section>

      <Section id="form" title="Form">
        <State label="Text (required), password, select, textarea, checkbox; a help line; enter submits, cmd+enter from the textarea, escape cancels; a required field left empty is marked and focused">
          <Pair><FormDemo /></Pair>
        </State>
        <State label="Refused by the extension: `errors` by field id, shown under the field until it changes">
          <Pair panel>
            <Panel search={<Search value="" onChange={noop} back={{ title: "Bookmarks", onBack: noop }} title="Add bookmark" />} footer={<Footer title="Add bookmark" primary={{ title: "Save" }} />}>
              <div className="pal-form-level"><Form fields={formFields} submitTitle="Save" errors={{ url: "Not a URL: no scheme" }} onSubmit={noop} onCancel={noop} /></div>
            </Panel>
          </Pair>
        </State>
      </Section>

      <Section id="empty" title="Empty">
        {[
          ["Icon, title, hint", <Empty icon={{ kind: "glyph", value: "⌕" }} title="No results for “zzq”" hint="Try a different word, or ⌘K for actions" />],
          ["With a note under the hint", <Empty icon={{ kind: "glyph", value: "⌕" }} title="No results for “zzq”" hint="Try a different word, or ⌘K for actions" note="No extensions are loaded, so there is little to find." />],
          ["Title only", <Empty title="Nothing here yet" />],
          ["Emoji", <Empty icon={{ kind: "emoji", value: "📭" }} title="Inbox zero" hint="Nothing is waiting on you" />],
        ].map(([label, el]) => <State key={label as string} label={label as string}><Pair surface>{el}</Pair></State>)}
      </Section>

      <Section id="toast" title="Toast">
        {toasts.map((t) => <State key={t.style} label={t.style}><Pair surface><div className="g-anchor"><Toast toast={t} /></div></Pair></State>)}
      </Section>

      <Section id="hud" title="HUD">
        <State label="Text"><Pair><Hud text="Copied to clipboard" /></Pair></State>
        <State label="With icon"><Pair><Hud icon={{ kind: "emoji", value: "✅" }} text="Deployed v1.4.2" /></Pair></State>
      </Section>

      <Section id="settings" title="Settings">
        <p className="g-note">A separate window, 960 by 640 by default (resizable, 800 by 560 at least): a 52px toolbar with the pages as icon tabs, the page under it at a 640px measure, forms as cards with a 160px right-aligned label column. Live: arrows move the tabs and the lists; Tab walks the palettes table; the hotkey recorder records. <code>?gallery=settings:palettes&amp;theme=dark</code> shows one window alone at the viewport size.</p>
        <State label="General, at rest">
          <WidePair>{(t) => <SettingsDemo key={t} page="general" />}</WidePair>
        </State>
        <State label="Shortcuts: pal's own keys, then the palettes, rows and bar items with one, a doubled chord said on both rows">
          <WidePair>{(t) => <SettingsDemo key={t} page="shortcuts" />}</WidePair>
        </State>
        <State label="Palettes, GitHub open: the table of pal's per-palette columns, the selected palette's declared settings under it">
          <WidePair>{(t) => <SettingsDemo key={t} page="palettes" />}</WidePair>
        </State>
        <State label="Extensions, GitHub selected: update available, the declared settings, Update and Remove in the footer">
          <WidePair>{(t) => <SettingsDemo key={t} page="extensions" />}</WidePair>
        </State>
        <State label="Bar, the timer selected: the Defaults card over the items list, the pane with the preview strips, the mono width look of its own over the menu bar defaults">
          <WidePair>{(t) => <SettingsDemo key={t} page="bar" />}</WidePair>
        </State>
        <State label="About: the version, the update check, the links">
          <WidePair>{(t) => <SettingsDemo key={t} page="about" />}</WidePair>
        </State>
        <State label="Config file problems: one warning, one error, under the page">
          <WidePair>{(t) => <SettingsDemo key={t} page="general" diagnostics />}</WidePair>
        </State>
        <State label="Field renderer, every kind (row layout; the pane uses the stacked one)">
          <Pair surface><SettingsFieldsDemo /></Pair>
        </State>
        <State label="Field renderer, stacked (as in the palette pane)">
          <Pair surface><SettingsFieldsDemo layout="stack" /></Pair>
        </State>
        <State label="Diagnostics strip alone">
          <Pair surface><SettingsDiagnostics diagnostics={settingsDiagnostics} file="config.toml" /></Pair>
        </State>
      </Section>
    </main>
  );
}

const nav = [
  { id: "playground", title: "Playground" }, { id: "grammar", title: "Grammar" }, { id: "panel", title: "Panel" }, { id: "search", title: "Search" },
  { id: "row", title: "Row" }, { id: "tiles", title: "Tiles" }, { id: "list", title: "List" }, { id: "grid", title: "Grid" }, { id: "view", title: "View" }, { id: "detail", title: "Detail" }, { id: "actions", title: "ActionPanel" },
  { id: "footer", title: "Footer" }, { id: "form", title: "Form" }, { id: "empty", title: "Empty" }, { id: "toast", title: "Toast" }, { id: "hud", title: "HUD" },
  { id: "settings", title: "Settings" },
];

/* Settings section. The window is wider than a pair column, so each theme takes its own row. */
function WidePair({ children }: { children: (theme: (typeof themes)[number]) => ReactNode }) {
  return (
    <div className="g-pair g-pair--wide">
      {themes.map((t) => (
        <div key={t} className="g-theme" data-theme={t}>
          <div className="g-frame g-frame--settings">{children(t)}</div>
        </div>
      ))}
    </div>
  );
}

/** One settings window with its own state, opened on `page`. */
function SettingsDemo({ page: initial, diagnostics }: { page: SettingsPage; diagnostics?: boolean }) {
  const [page, setPage] = useState<SettingsPage>(initial);
  const [general, setGeneral] = useState(settingsGeneral);
  const [exts, setExts] = useState<SettingsExtension[]>(settingsExtensions);
  const [palette, setPalette] = useState<string | undefined>("github-prs");
  const [ext, setExt] = useState<string | undefined>("github");
  const patchPalette = (id: string, config: PaletteConfig) =>
    setExts((es) => es.map((e) => ({ ...e, palettes: e.palettes.map((p) => (p.id === id ? { ...p, config } : p)) })));
  const patchExt = (key: string, values: SettingValues) => setExts((es) => es.map((e) => (e.key === key ? { ...e, values } : e)));
  const [extInstance, setExtInstance] = useState<string | undefined>(undefined);
  // Instances, in memory: add copies the default's entry under the new key, rename and enabled patch its `instance`, remove drops it.
  const addInstance = async (name: string, suffix: string, title?: string, tint?: string) => setExts((es) => {
    const base = es.find((e) => e.name === name && e.instance?.isDefault) ?? es.find((e) => e.name === name);
    if (!base || !base.icon) return es;
    const inst = resolveInstance(`${name}@${suffix}`, name, { title, tint }, undefined, base.icon.kind === "tile" ? base.icon.bg : undefined);
    const extTitle = base.extTitle ?? base.title;
    return [...es, { ...base, key: inst.key, instance: inst, title: `${extTitle} (${inst.title})`, icon: badgedIcon(base.icon, inst), values: {}, inherited: base.values, inheritedFrom: base.title, latest: undefined, palettes: base.palettes.map((p) => ({ ...p, id: p.id.replace(name, inst.key), title: p.title.replace(/ \(.*\)$/, ` (${inst.title})`), config: { enabled: true, settings: {} }, inherited: p.config.settings })) }];
  });
  const patchInstance = (key: string, f: (e: SettingsExtension) => SettingsExtension) => setExts((es) => es.map((e) => (e.key === key ? f(e) : e)));
  const renameInstance = (key: string, title: string) => patchInstance(key, (e) => ({ ...e, instance: { ...e.instance!, title: title || e.instance!.suffix }, title: `${e.extTitle ?? e.title} (${title || e.instance!.suffix})` }));
  const enableInstance = (key: string, enabled: boolean) => patchInstance(key, (e) => ({ ...e, instance: { ...e.instance!, enabled } }));
  const removeInstance = async (key: string) => setExts((es) => es.filter((e) => e.key !== key));
  const [bar, setBar] = useState(settingsBar);
  const [barItems, setBarItems] = useState(settingsBarItems);
  const [barKey, setBarKey] = useState<string | undefined>("timer/timer");
  const patchBarItem = (key: string, config: BarItemConfig) => setBarItems((bs) => bs.map((b) => (b.key === key ? { ...b, config } : b)));
  const index = [...generalIndex, ...shortcutsIndex(general, exts, barItems), ...palettesIndex(exts), ...extensionsIndex(exts), ...barIndex(barItems), ...aboutIndex];
  const mac = /Mac/.test(navigator.platform);
  return (
    <SettingsWindow page={page} onPage={setPage} index={index} diagnostics={diagnostics ? settingsDiagnostics : []} file="config.toml" mac={mac}>
      {page === "general" && <SettingsGeneral value={general} onChange={setGeneral} file={settingsFile} onOpenFile={noop} onRevealFile={noop} onResetFrecency={noop} onRestartHost={noop} permissions={settingsPermissions} onRequestPermission={noop} themeFile={{ status: settingsThemeFile, onChange: noop, onEdit: noop, onOpenDir: noop }} onOpenShortcuts={() => setPage("shortcuts")} />}
      {page === "shortcuts" && <SettingsShortcuts general={general} onGeneral={setGeneral} hotkey={settingsHotkeyStatus(general.hotkeys)} onOpenKeyboardShortcuts={noop} permissions={settingsPermissions} onRequestPermission={noop} extensions={exts} onPalette={patchPalette} bar={barItems} onBarItem={patchBarItem} onGo={(p) => setPage(p)} />}
      {page === "palettes" && <SettingsPalettes extensions={exts} selected={palette} onSelect={setPalette} onChange={patchPalette} />}
      {page === "extensions" && <SettingsExtensions extensions={exts} selected={ext} onSelect={setExt} selectedInstance={extInstance} onSelectInstance={setExtInstance} onChange={patchExt} onInstall={() => new Promise((r) => setTimeout(r, 800))} onUpdate={noop} onRemove={noop} onOpenLink={noop} onInstanceAdd={addInstance} onInstanceRename={renameInstance} onInstanceRemove={removeInstance} onInstanceEnabled={enableInstance} />}
      {page === "bar" && <SettingsBar config={bar} onChange={setBar} items={barItems} onItem={patchBarItem} sketchybar={false} selected={barKey} onSelect={setBarKey} onOpenExtension={(name) => { setExt(name); setPage("extensions"); }} />}
      {page === "about" && <SettingsAbout version="0.1.0" file={settingsFile.path} links={{ docs: "https://github.com/zcag/pal/blob/main/docs/extensions.md", repo: "https://github.com/zcag/pal" }} onCheckUpdates={() => new Promise((r) => setTimeout(() => r({ available: true, version: "0.2.0", installable: true }), 800))} update={{ available: true, version: "0.2.0", installable: true }} onInstallUpdate={() => new Promise((r) => setTimeout(r, 800))} onOpenLink={noop} onRevealFile={noop} />}
    </SettingsWindow>
  );
}

/** Every field kind, live, with its own values. */
function SettingsFieldsDemo({ layout = "row" }: { layout?: "row" | "stack" }) {
  const [values, setValues] = useState<Record<string, SettingValue>>(() => Object.fromEntries(settingsFieldSpecs.map((f) => [f.spec.id, f.value])));
  return (
    <div className="g-settings-fields">
      {settingsFieldSpecs.map(({ spec }) => (
        <SettingsField key={spec.id} spec={spec} value={values[spec.id]} onChange={(v) => setValues((s) => ({ ...s, [spec.id]: v }))} layout={layout} />
      ))}
    </div>
  );
}
