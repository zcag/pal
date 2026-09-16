/**
 * Every component in every state, light and dark side by side. Opened with
 * `?gallery` in a normal browser against the Vite dev server.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ActionPanel, Detail, Empty, Footer, Form, Grid, Hud, Kbd, List, Panel, Row, Search, Toast,
  grammar, groupBySection, useCursor, type Hit, type ToastSpec,
} from "../ui";
import type { FormValues, Item } from "../ui/types";
import { Launcher } from "../Launcher";
import { toItem, type Raw } from "../fixtures";
import { actions, deploy, formFields, handWritten, markdownOnly, nerdGlyphs, person, raycastDocs, sample, welcomeRows } from "./data";
import {
  SettingsDiagnostics, SettingsExtensions, SettingsField, SettingsGeneral, SettingsPalettes, SettingsWindow,
  extensionsIndex, generalIndex, palettesIndex, type PaletteConfig, type SettingValue, type SettingValues, type SettingsExtension, type SettingsPage,
} from "../ui";
import { settingsDiagnostics, settingsExtensions, settingsFieldSpecs, settingsFile, settingsGeneral } from "./data";
import "./gallery.css";

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
const lazyFixture = (items: Item[]): Item[] => items.map((i) => (i.palette === "cmds" ? { ...i, detail: { metadata: i.detail?.metadata }, lazyDetail: true } : i));

function Playground({ items }: { items: Item[] }) {
  const [hud, setHud] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const flash = (text: string) => { setHud(text); setTimeout(() => setHud(null), 1200); };
  const lazy = useMemo(() => lazyFixture(items), [items]);
  return (
    <div className="g-playground">
      <p className="g-note">Live: every key in the grammar works here. Enter and Escape at the root flash a HUD instead of hiding. Marks go to the console. Commands are a lazy-detail palette (skeleton, then markdown); a palette with a few sections has them as its filter dropdown (Tab cycles); Enter on a command opens a show level (its output), Enter on a bookmark a drill-in level (Commands, with args).</p>
      <div className="g-frame g-frame--live">
        <Launcher
          items={lazy}
          detail={(item) => new Promise((r) => setTimeout(() => r({ markdown: `# ${item.name}\n\nFetched on demand for \`${item.id}\`.\n\n\`\`\`\n${item.name}\n\`\`\``, metadata: item.detail?.metadata }), 700))}
          onPick={(item, _q, action, ctx) => {
            flash(`Picked ${item.name}`); setLog((l) => [`pick ${item.id}${action ? ` (${action})` : ""}${ctx?.args ? ` args=${JSON.stringify(ctx.args)}` : ""}`, ...l].slice(0, 5));
            if (item.palette === "cmds" && !ctx?.args) return { show: { markdown: "```\n$ " + item.id + "\n" + Array.from({ length: 40 }, (_, i) => `[${String(i + 1).padStart(2, "0")}/40] ${item.name}: step ${i + 1} ok`).join("\n") + "\n```", title: `${item.name} output` } };
            if (item.palette === "bookmarks" && !ctx?.args) return { push: { extension: "", palette: "cmds", args: { parent: item.id } } };
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

const toasts: ToastSpec[] = [
  { style: "success", title: "Copied", message: "https://developers.raycast.com" },
  { style: "failure", title: "Could not reach marko", message: "ssh: connect to host marko port 22: No route to host" },
  { style: "animated", title: "Deploying…" },
];

export default function Gallery() {
  const [raws, setRaws] = useState<Raw[]>([]);
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
        {raws.length ? <Playground items={all} /> : null}
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
        <State label="Text, textarea, select, checkbox; enter submits, cmd+enter from the textarea, escape cancels">
          <Pair><FormDemo /></Pair>
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
        <p className="g-note">A separate window, 960 by 600: sidebar 200 (labels on the panel's 52px text edge), content 760 (the panel's 720 plus its 20px gutters). Live: arrows move the sidebar, the table and the extension list; Space toggles a palette; the hotkey recorder records.</p>
        <State label="General, at rest">
          <WidePair>{(t) => <SettingsDemo key={t} page="general" />}</WidePair>
        </State>
        <State label="Palettes, a row selected: pal's per-palette defaults and the extension's declared settings in the pane">
          <WidePair>{(t) => <SettingsDemo key={t} page="palettes" />}</WidePair>
        </State>
        <State label="Extensions, GitHub selected: update available, the declared settings form under the separator">
          <WidePair>{(t) => <SettingsDemo key={t} page="extensions" />}</WidePair>
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
  { id: "row", title: "Row" }, { id: "list", title: "List" }, { id: "grid", title: "Grid" }, { id: "detail", title: "Detail" }, { id: "actions", title: "ActionPanel" },
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
  const patchExt = (name: string, values: SettingValues) => setExts((es) => es.map((e) => (e.name === name ? { ...e, values } : e)));
  const index = [...generalIndex, ...palettesIndex(exts), ...extensionsIndex(exts)];
  const count = exts.reduce((n, e) => n + e.palettes.length, 0);
  const aside = page === "palettes" ? `${count} palettes from ${exts.length} extensions` : page === "extensions" ? `${exts.length} installed` : undefined;
  return (
    <SettingsWindow page={page} onPage={setPage} aside={aside} index={index} diagnostics={diagnostics ? settingsDiagnostics : []} file="config.toml" version="0.1.0">
      {page === "general" && <SettingsGeneral value={general} onChange={setGeneral} file={settingsFile} />}
      {page === "palettes" && <SettingsPalettes extensions={exts} selected={palette} onSelect={setPalette} onChange={patchPalette} />}
      {page === "extensions" && <SettingsExtensions extensions={exts} selected={ext} onSelect={setExt} onChange={patchExt} />}
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
