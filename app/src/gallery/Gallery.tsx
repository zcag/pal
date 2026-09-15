/**
 * Every component in every state, light and dark side by side. Opened with
 * `?gallery` in a normal browser against the Vite dev server.
 */
import { useEffect, useState, type ReactNode } from "react";
import {
  ActionPanel, Detail, Empty, Footer, Form, Grid, Hud, Kbd, List, Panel, Row, Search, Toast,
  grammar, groupBySection, useCursor, type Hit, type ToastSpec,
} from "../ui";
import type { FormValues, Item } from "../ui/types";
import { Launcher } from "../Launcher";
import { toItem, type Raw } from "../fixtures";
import { actions, deploy, formFields, handWritten, markdownOnly, person, raycastDocs, sample } from "./data";
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

function Playground({ items }: { items: Item[] }) {
  const [hud, setHud] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const flash = (text: string) => { setHud(text); setTimeout(() => setHud(null), 1200); };
  return (
    <div className="g-playground">
      <p className="g-note">Live: every key in the grammar works here. Enter and Escape at the root flash a HUD instead of hiding. Marks go to the console.</p>
      <div className="g-frame g-frame--live">
        <Launcher
          items={items}
          onPick={(item) => { flash(`Picked ${item.name}`); setLog((l) => [`pick ${item.id}`, ...l].slice(0, 5)); }}
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
        <State label="Empty results">
          <Pair panel><Panel search={<Search value="zzzz" onChange={noop} />} footer={<Footer title="0 of 14719" />}><Empty icon={{ kind: "glyph", value: "⌕" }} title="No results" hint="Try a different search" /></Panel></Pair>
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
          ["Icon, title, hint", <Empty icon={{ kind: "glyph", value: "⌕" }} title="No results" hint="Try a different search" />],
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
    </main>
  );
}

const nav = [
  { id: "playground", title: "Playground" }, { id: "grammar", title: "Grammar" }, { id: "panel", title: "Panel" }, { id: "search", title: "Search" },
  { id: "row", title: "Row" }, { id: "list", title: "List" }, { id: "grid", title: "Grid" }, { id: "detail", title: "Detail" }, { id: "actions", title: "ActionPanel" },
  { id: "footer", title: "Footer" }, { id: "form", title: "Form" }, { id: "empty", title: "Empty" }, { id: "toast", title: "Toast" }, { id: "hud", title: "HUD" },
];
