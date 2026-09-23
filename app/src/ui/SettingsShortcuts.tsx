import { useEffect, useMemo, useState } from "react";
import { Icon } from "./Icon";
import { Kbd } from "./Kbd";
import { isMac } from "./keys";
import { SettingsGroup, SettingsHotkey, SettingsRow, SettingsSegment, SettingsSelect } from "./SettingsField";
import { comboLabel, hotkeyPresets, sameCombo } from "./SettingsGeneral";
import { HoldControl, paletteIcon, type PaletteItem } from "./SettingsPalettes";
import { holdOf, MAX_ROOT_HOTKEYS, type BarItem, type BarItemConfig, type GeneralConfig, type HotkeyStatus, type PaletteConfig, type PermissionId, type PermissionsStatus, type RootHotkeyStatus, type SettingsExtension, type SettingsIndexEntry, type SettingsPage, type SettingsPalette, type SidebarConfig } from "./SettingsTypes";

/**
 * Settings › Shortcuts: every global key pal registers, on one page, so
 * what a chord does and what it collides with is read in one place. Four
 * cards: pal's own (Show pal, the window switcher, macOS's App Switcher,
 * the sidebar), then a table each of the palettes with a hotkey or a
 * switcher chord, the rows run by `item_hotkeys`, and the bar items with a
 * hotkey. Each row is the same recorder the Palettes and Bar panes have,
 * writing the same config key (`general.hotkey`, `palettes.<id>.hotkey` /
 * `hold` / `item_hotkeys.<row>`, `bar.items.<key>.hotkey`, `sidebar.hotkey`),
 * so the two places never disagree. A chord bound twice is said on both
 * rows with which one wins (root, then a palette's, then a switcher
 * chord, then a bar item's, then a row's, then the sidebar's: the order
 * hotkey.rs's `apply` inserts them; two of one kind leave it to chance). "Add shortcut" is one form: what to run (open a palette, run one
 * of its rows, open a bar item), which one, then the chord; it writes once
 * the chord lands and closes.
 */
export type SettingsShortcutsProps = {
  general: GeneralConfig;
  onGeneral: (value: GeneralConfig) => void;
  /** How every root hotkey's last registration went; the status line under each recorder. */
  hotkey?: HotkeyStatus;
  /** Where Spotlight's binding is switched off (System Settings > Keyboard > Keyboard Shortcuts). */
  onOpenKeyboardShortcuts?: () => void;
  permissions?: PermissionsStatus;
  onRequestPermission?: (which: PermissionId) => void;
  extensions: SettingsExtension[];
  onPalette: (id: string, config: PaletteConfig) => void;
  /** The bar items (macOS); absent where no bar is built. */
  bar?: BarItem[];
  onBarItem?: (key: string, config: BarItemConfig) => void;
  /** `[sidebar]`, for its hotkey row; the rest of the card is General's. */
  sidebar?: { value: SidebarConfig; onChange: (value: SidebarConfig) => void };
  /** A palette's rows as indexed now, for the row picker; absent, the id is typed. */
  items?: (palette: SettingsPalette) => Promise<PaletteItem[]>;
  /** Another page's row: the sidebar card, a palette's pane, a bar item. */
  onGo?: (page: SettingsPage, anchor?: string) => void;
};

/** One chord pal registers, whoever asked for it. `rank` is who wins a clash, lowest first (hotkey.rs). */
export type Binding = { id: string; kind: "root" | "palette" | "hold" | "item" | "bar" | "sidebar" | "app-switcher"; combo: string; label: string; rank: number };

const RANK: Record<Binding["kind"], number> = { root: 0, palette: 1, hold: 2, bar: 3, item: 4, sidebar: 5, "app-switcher": 6 };

/** "Extension › Palette", or the title alone when the palette is the extension. */
export const paletteTitle = (p: SettingsPalette, e: SettingsExtension) => (p.title === e.title ? p.title : `${e.title} › ${p.title}`);

/** Every binding the config asks for, in the order the page lists them. */
export function bindings(general: GeneralConfig, extensions: SettingsExtension[], bar: BarItem[] = [], sidebar?: SidebarConfig): Binding[] {
  const out: Binding[] = general.hotkeys.map((combo, i) => ({ id: `root:${i}`, kind: "root", combo, label: "Show pal", rank: RANK.root }));
  if (general.appSwitcher?.trim()) out.push({ id: "app-switcher", kind: "app-switcher", combo: general.appSwitcher.trim(), label: "macOS App Switcher", rank: RANK["app-switcher"] });
  if (sidebar?.hotkey?.trim()) out.push({ id: "sidebar", kind: "sidebar", combo: sidebar.hotkey.trim(), label: "Sidebar", rank: RANK.sidebar });
  for (const e of extensions) {
    for (const p of e.palettes) {
      const title = paletteTitle(p, e);
      if (p.config.hotkey?.trim()) out.push({ id: `palette:${p.id}`, kind: "palette", combo: p.config.hotkey.trim(), label: `Open ${title}`, rank: RANK.palette });
      const hold = holdOf(p);
      if (hold) out.push({ id: `hold:${p.id}`, kind: "hold", combo: hold, label: `${title} switcher`, rank: RANK.hold });
      for (const [row, combo] of Object.entries(p.config.itemHotkeys ?? {})) if (combo.trim()) out.push({ id: `item:${p.id}:${row}`, kind: "item", combo: combo.trim(), label: `${title} › ${row}`, rank: RANK.item });
    }
  }
  for (const b of bar) if (b.config.hotkey?.trim()) out.push({ id: `bar:${b.key}`, kind: "bar", combo: b.config.hotkey.trim(), label: `${b.extTitle} › ${b.title}`, rank: RANK.bar });
  return out;
}

/** The other bindings on the same chord as `b`, and how `b` fares: it wins, it loses, or a tie of one kind (either may register). */
export function clashOf(b: Binding, all: Binding[]): { others: Binding[]; outcome: "wins" | "loses" | "tie" } {
  const others = all.filter((o) => o.id !== b.id && sameCombo(o.combo, b.combo));
  const best = Math.min(b.rank, ...others.map((o) => o.rank));
  const outcome = b.rank > best ? "loses" : others.some((o) => o.rank === b.rank) ? "tie" : "wins";
  return { others, outcome };
}

/** The line under a row bound twice: who else has the chord, and who wins. */
function ClashLine({ binding, all }: { binding: Binding; all: Binding[] }) {
  const { others, outcome } = clashOf(binding, all);
  if (!others.length) return null;
  const names = others.map((o) => o.label).join(", ");
  const one = others.length === 1;
  return (
    <p className="pal-hotkey-status" data-state={outcome === "wins" ? "clash" : "failed"} role="status">
      <span className="pal-hotkey-status__dot" aria-hidden />
      {outcome === "wins" ? <>Also {names}: this one wins, so {one ? "that" : "those"} never {one ? "fires" : "fire"}</> : outcome === "loses" ? <>Also {names}, which wins: this one never fires</> : <>Also {names}: the same kind, so only one of them registers, and not by choice</>}
    </p>
  );
}

/**
 * Under a root recorder: registered, or not and why. A wanted ⌘Space that
 * failed is Spotlight's whether or not the OS said so, hence the second
 * clause; the guidance names the exact switch and opens the pane.
 */
export function HotkeyStatusLine({ status, onOpenKeyboardShortcuts }: { status: RootHotkeyStatus; onOpenKeyboardShortcuts?: () => void }) {
  const spotlight = status.spotlight ?? (isMac && !status.registered && sameCombo(status.wanted, "cmd+space") ? "cmd+space" : undefined);
  return (
    <>
      <p className="pal-hotkey-status" data-state={status.registered ? "ok" : "failed"} role="status">
        <span className="pal-hotkey-status__dot" aria-hidden />
        {status.registered ? <>Registered as <Kbd shortcut={status.wanted} /></> : <>Not registered{status.error ? `: ${status.error}` : ""}</>}
      </p>
      {spotlight && (
        <div className="pal-hotkey-guidance" role="note">
          <p>
            Spotlight uses {comboLabel(spotlight)}. Turn it off in System Settings &gt; Keyboard &gt; Keyboard Shortcuts &gt; Spotlight (untick Show Spotlight search), then pal registers it.
          </p>
          {onOpenKeyboardShortcuts && <button type="button" className="pal-button" data-small onClick={onOpenKeyboardShortcuts}>Open Keyboard Shortcuts</button>}
        </div>
      )}
    </>
  );
}

/**
 * The root hotkeys, one recorder per entry with its presets and its own
 * status line, so a key another app holds is reported on its row while
 * the others keep working. "Add another" opens an empty row that is
 * written once a combination lands in it (nothing is written meanwhile);
 * Remove drops a row. With no entry (`hotkey = ""`) the one row is empty
 * and the line says how pal is reached instead.
 */
export function HotkeyRows({ value, onChange, status, onOpenKeyboardShortcuts, all }: { value: string[]; onChange: (hotkeys: string[]) => void; status?: HotkeyStatus; onOpenKeyboardShortcuts?: () => void; all?: Binding[] }) {
  const [adding, setAdding] = useState(false);
  const rows = value.length ? [...value, ...(adding ? [""] : [])] : [""];
  const statusOf = (entry: string) => status?.hotkeys.find((h) => h.wanted === entry.trim());
  const put = (i: number, v: string | undefined) => {
    setAdding(false);
    const next = i < value.length ? value.map((h, j) => (j === i ? v : h)) : [...value, v];
    onChange(next.filter((h): h is string => Boolean(h && h.trim())));
  };
  const remove = (i: number) => {
    if (i >= value.length) return setAdding(false);
    onChange(value.filter((_, j) => j !== i));
  };
  return (
    <div className="pal-hotkey-field">
      {rows.map((entry, i) => {
        const several = rows.length > 1;
        const name = several ? `Show pal (${i + 1})` : "Show pal";
        const st = entry ? statusOf(entry) : undefined;
        const binding = all?.find((b) => b.id === `root:${i}`);
        return (
          <div key={i} className="pal-hotkey-entry" data-anchor={i ? `shortcuts:hotkey:${i + 1}` : undefined}>
            <div className="pal-hotkey-field__row">
              <SettingsHotkey value={entry || undefined} onChange={(v) => (v === undefined && several ? remove(i) : put(i, v ?? "ctrl+space"))} label={name} />
              <span className="pal-hotkey-presets" role="group" aria-label={several ? `Presets for hotkey ${i + 1}` : "Presets"}>
                {hotkeyPresets.map((p) => (
                  <button key={p} type="button" className="pal-button" data-small aria-pressed={Boolean(entry) && sameCombo(p, entry)} onClick={() => put(i, p)}>
                    {comboLabel(p)}
                  </button>
                ))}
              </span>
              {several && <button type="button" className="pal-button" data-small aria-label={`Remove hotkey ${i + 1}`} onClick={() => remove(i)}>Remove</button>}
            </div>
            {st && <HotkeyStatusLine status={st} onOpenKeyboardShortcuts={onOpenKeyboardShortcuts} />}
            {binding && all && <ClashLine binding={binding} all={all} />}
          </div>
        );
      })}
      {status && !value.length && <p className="pal-hotkey-status" data-state="off">No hotkey: bind <code>pal toggle</code> in your compositor or desktop.</p>}
      {value.length > 0 && !adding && value.length < MAX_ROOT_HOTKEYS && (
        <span className="pal-button-row">
          <button type="button" className="pal-button" data-small onClick={() => setAdding(true)}>Add another</button>
        </span>
      )}
    </div>
  );
}

/** Every row of the pal card, once: label, description, and what the search finds it by. */
export const text = {
  hotkey: { anchor: "shortcuts:hotkey", hint: "Show pal from any app", label: "Show pal", description: isMac
    ? "Opens pal from any app. Press the new combination while the control is recording, or pick one of the presets; Add another gives pal a second combination that does the same. ⌘Space cannot be recorded (Spotlight opens on the press); its preset writes it directly."
    : "Opens pal from any app. Press the new combination while the control is recording, or pick one of the presets; Add another gives pal a second combination that does the same. On Wayland the registration goes through X11 and fires only while an X11 window has focus: bind pal toggle in the compositor instead and set hotkey = \"\" in the config file.", keywords: "hotkey shortcut keys spotlight cmd space several second another root" },
  switcher: { anchor: "shortcuts:switcher", hint: "Switch windows", label: "Window switcher", description: "Tap it to go back to the previous window; hold it and press again to pick. cmd+tab replaces the App Switcher and needs Input Monitoring.", keywords: "switcher alt tab cmd tab hold windows previous chord" },
  appSwitcher: { anchor: "shortcuts:app-switcher", hint: "The App Switcher's chord", label: "macOS App Switcher", description: "macOS's own app switcher (Cmd+Tab's) on another Tab chord, for when pal's switcher has taken cmd+tab: alt+tab, say. Held the same way; shift steps back. Needs Input Monitoring.", keywords: "app switcher macos cmd tab alt tab system dock" },
  sidebar: { anchor: "shortcuts:sidebar", hint: "Engage the sidebar", label: "Sidebar", description: "Engages the sidebar from any app: shown key from hidden, or a peek made key. Which palette it docks, and where, is on Features.", keywords: "sidebar edge hotkey engage" },
  palettes: { anchor: "shortcuts:palettes", hint: "Open a palette, or switch through it", label: "Open a palette", description: "Open: pal shows straight inside the palette. Switcher: tapped, the previous row (a window); held, the palette flat with the cursor on row 2, each press a step, letting go runs.", keywords: "palette hotkey open switcher hold chord" },
  items: { anchor: "shortcuts:items", hint: "Run one row without the panel", label: "Run a row", description: "A row's primary action runs as if you had pressed Enter on it, the panel down; what it shows after hiding (the HUD) still shows. Layouts, spaces, a script, a system command.", keywords: "item hotkeys row run layout space" },
  bar: { anchor: "shortcuts:bar", hint: "Open a bar item's popover", label: "Open a bar item", description: "Opens the item's popover engaged from any app, or runs its open action.", keywords: "bar item popover hotkey" },
} as const;

/** What the search finds on this page: the pal card's rows, the three tables, and every binding by its label and chord. */
export const shortcutsIndex = (general: GeneralConfig, extensions: SettingsExtension[], bar: BarItem[] = [], sidebar?: SidebarConfig): SettingsIndexEntry[] => [
  ...(Object.values(text) as (typeof text)[keyof typeof text][]).map((r): SettingsIndexEntry => ({ page: "shortcuts", label: r.label, hint: r.hint, anchor: r.anchor, keywords: `${r.label} ${r.description} ${r.keywords} shortcuts keys` })),
  ...bindings(general, extensions, bar, sidebar).filter((b) => b.kind !== "root" && b.kind !== "app-switcher" && b.kind !== "sidebar").map((b): SettingsIndexEntry => ({ page: "shortcuts", label: b.label, hint: comboLabel(b.combo), anchor: `shortcuts:${b.id}`, keywords: `${b.combo} ${comboLabel(b.combo)} shortcut hotkey` })),
];

/** Whether a row survives the filter: its label, id or chord contains the text. */
const matches = (filter: string, ...parts: (string | undefined)[]) => {
  const f = filter.trim().toLowerCase();
  return !f || parts.some((p) => p?.toLowerCase().includes(f));
};

type AddKind = "palette" | "item" | "bar";

/**
 * "Add shortcut": what to run, which one, then the chord. Nothing is
 * written until the chord lands; then the row appears in its table and
 * the form closes. A row's id can be picked from the palette's listing
 * (the datalist) or typed, for a live palette the index has not seen.
 */
function AddForm({ kind, onKind, extensions, bar, items, onPalette, onBarItem, onClose }: { kind: AddKind; onKind: (k: AddKind) => void; extensions: SettingsExtension[]; bar: BarItem[]; items?: SettingsShortcutsProps["items"]; onPalette: SettingsShortcutsProps["onPalette"]; onBarItem?: SettingsShortcutsProps["onBarItem"]; onClose: () => void }) {
  const palettes = useMemo(() => extensions.flatMap((e) => e.palettes.filter((p) => p.config.enabled).map((p) => ({ id: p.id, title: paletteTitle(p, e), p }))), [extensions]);
  const [target, setTarget] = useState("");
  const [row, setRow] = useState("");
  const [known, setKnown] = useState<PaletteItem[]>([]);
  const palette = palettes.find((x) => x.id === target);
  useEffect(() => {
    setKnown([]);
    if (kind !== "item" || !palette || !items) return;
    let live = true;
    items(palette.p).then((r) => { if (live) setKnown(r); }, () => { if (live) setKnown([]); });
    return () => { live = false; };
  }, [kind, palette, items]);
  const kinds = [{ id: "palette", title: "Open a palette" }, { id: "item", title: "Run a row" }, ...(bar.length ? [{ id: "bar", title: "Open a bar item" }] : [])];
  const targets = kind === "bar" ? bar.map((b) => ({ id: b.key, title: `${b.extTitle} › ${b.title}` })) : palettes.map(({ id, title }) => ({ id, title }));
  const ready = kind === "bar" ? Boolean(target) : kind === "item" ? Boolean(palette && row.trim()) : Boolean(palette);
  const record = (combo: string | undefined) => {
    if (!combo) return;
    if (kind === "bar") {
      const b = bar.find((x) => x.key === target);
      if (b && onBarItem) onBarItem(b.key, { ...b.config, hotkey: combo });
    } else if (palette) {
      const c = palette.p.config;
      onPalette(palette.id, kind === "item" ? { ...c, itemHotkeys: { ...(c.itemHotkeys ?? {}), [row.trim()]: combo } } : { ...c, hotkey: combo });
    }
    onClose();
  };
  return (
    <div className="pal-shortcuts__add" role="group" aria-label="Add shortcut">
      <SettingsSegment value={kind} options={kinds} onChange={(k) => { onKind(k as AddKind); setTarget(""); setRow(""); }} label="What to run" />
      <div className="pal-shortcuts__add-row">
        <SettingsSelect id="pal-shortcuts-target" label={kind === "bar" ? "Bar item" : "Palette"} value={target} options={[{ id: "", title: kind === "bar" ? "Pick a bar item…" : "Pick a palette…" }, ...targets]} onChange={(v) => { setTarget(v); setRow(""); }} />
        {kind === "item" && (
          <>
            {known.length > 0 && <datalist id="pal-shortcuts-rows">{known.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}</datalist>}
            <input className="pal-inline pal-itemkeys__id pal-shortcuts__field" type="text" list={known.length ? "pal-shortcuts-rows" : undefined} value={row} placeholder={palette ? "row id" : "pick a palette first"} aria-label="Row id" spellCheck={false} disabled={!palette} onChange={(e) => setRow(e.target.value)} />
          </>
        )}
        {ready ? <SettingsHotkey value={undefined} onChange={record} label="New shortcut" compact /> : <span className="pal-hotkey" data-compact="" data-empty="" aria-disabled="true"><span className="pal-hotkey__prompt">Record</span></span>}
        <button type="button" className="pal-button" data-small onClick={onClose}>Cancel</button>
      </div>
      <p className="pal-ppane__hint pal-itemkeys__hint">{ready ? "Record the chord to save it." : kind === "item" ? "Pick the palette, then the row: its id from the list, or typed (a live palette's rows are known once it has been shown)." : "Pick what the chord should open."}</p>
    </div>
  );
}

export function SettingsShortcuts({ general, onGeneral, hotkey, onOpenKeyboardShortcuts, permissions, onRequestPermission, extensions, onPalette, bar = [], onBarItem, sidebar, items, onGo }: SettingsShortcutsProps) {
  const [filter, setFilter] = useState("");
  const [adding, setAdding] = useState<AddKind | undefined>(undefined);
  const all = useMemo(() => bindings(general, extensions, bar, sidebar?.value), [general, extensions, bar, sidebar?.value]);
  const windows = extensions.flatMap((e) => e.palettes).find((p) => p.id === "windows");
  const chord = windows ? holdOf(windows) : undefined;
  const needsGrant = !!chord && sameCombo(chord, "cmd+tab") && permissions?.input_monitoring === false;
  const at = (id: string) => all.find((b) => b.id === id);

  /** Palettes with a hotkey or a switcher chord, with their extension. */
  const paletteRows = extensions.flatMap((e) => e.palettes.filter((p) => p.config.hotkey?.trim() || holdOf(p)).map((p) => ({ p, e, title: paletteTitle(p, e) })));
  const itemRows = extensions.flatMap((e) => e.palettes.flatMap((p) => Object.entries(p.config.itemHotkeys ?? {}).map(([row, combo]) => ({ p, e, row, combo, title: paletteTitle(p, e) }))));
  const barRows = bar.filter((b) => b.config.hotkey?.trim());
  const shown = { palettes: paletteRows.filter((r) => matches(filter, r.title, r.p.config.hotkey && comboLabel(r.p.config.hotkey), holdOf(r.p) && comboLabel(holdOf(r.p)!), r.p.config.hotkey, holdOf(r.p))), items: itemRows.filter((r) => matches(filter, r.title, r.row, r.combo, comboLabel(r.combo))), bar: barRows.filter((b) => matches(filter, b.title, b.extTitle, b.config.hotkey, comboLabel(b.config.hotkey!))) };
  // The rows' names from each palette's listing, read once per palette with item hotkeys (a live palette the index has not seen lists nothing: the id stands).
  const [names, setNames] = useState<Record<string, PaletteItem[]>>({});
  const listed = itemRows.map((r) => r.p.id).filter((id, i, a) => a.indexOf(id) === i).join("\n");
  useEffect(() => {
    if (!items) return;
    let live = true;
    for (const id of listed.split("\n").filter(Boolean)) {
      const p = itemRows.find((r) => r.p.id === id)?.p;
      if (p) items(p).then((r) => { if (live) setNames((n) => ({ ...n, [id]: r })); }, () => {});
    }
    return () => { live = false; };
  }, [items, listed]); // eslint-disable-line react-hooks/exhaustive-deps
  const nameOf = (p: SettingsPalette, row: string) => names[p.id]?.find((k) => k.id === row)?.name;

  const setItem = (p: SettingsPalette, row: string, combo: string | undefined) => {
    const next = { ...(p.config.itemHotkeys ?? {}) };
    if (combo) next[row] = combo;
    else delete next[row];
    onPalette(p.id, { ...p.config, itemHotkeys: Object.keys(next).length ? next : undefined });
  };

  return (
    <div className="pal-settings-page pal-shortcuts">
      <div className="pal-shortcuts__bar">
        <input className="pal-inline pal-shortcuts__field" type="search" value={filter} placeholder="Filter by name or keys" aria-label="Filter shortcuts" onChange={(e) => setFilter(e.target.value)} />
        {!adding && <button type="button" className="pal-button" data-primary="" onClick={() => setAdding("palette")}>Add Shortcut</button>}
      </div>
      {adding && <AddForm kind={adding} onKind={setAdding} extensions={extensions} bar={bar} items={items} onPalette={onPalette} onBarItem={onBarItem} onClose={() => setAdding(undefined)} />}

      {matches(filter, "show pal", ...general.hotkeys.map(comboLabel), "window switcher", chord && comboLabel(chord), "app switcher", general.appSwitcher && comboLabel(general.appSwitcher), "sidebar", sidebar?.value.hotkey && comboLabel(sidebar.value.hotkey)) && (
        <SettingsGroup title="pal">
          <SettingsRow anchor={text.hotkey.anchor} label={text.hotkey.label} description={text.hotkey.description}>
            <HotkeyRows value={general.hotkeys} onChange={(hotkeys) => onGeneral({ ...general, hotkeys })} status={hotkey} onOpenKeyboardShortcuts={onOpenKeyboardShortcuts} all={all} />
          </SettingsRow>
          {windows && (
            <SettingsRow anchor={text.switcher.anchor} label={text.switcher.label} description={<>{text.switcher.description}{chord ? "" : " Off: the Windows palette opens from its hotkey or the root only."}{needsGrant && <> <span className="pal-setting__note">Input Monitoring is not granted, so {comboLabel("cmd+tab")} stays the App Switcher's until it is.</span></>}</>}>
              <span className="pal-hold pal-switcher">
                <HoldControl value={windows.config.hold} suggested={windows.hold} label="Switch windows" onChange={(hold) => onPalette(windows.id, { ...windows.config, hold })} />
                {needsGrant && onRequestPermission && <button type="button" className="pal-button" data-small data-primary="" onClick={() => onRequestPermission("input_monitoring")}>Turn on Input Monitoring…</button>}
              </span>
              {at(`hold:${windows.id}`) && <ClashLine binding={at(`hold:${windows.id}`)!} all={all} />}
            </SettingsRow>
          )}
          {isMac && (
            <SettingsRow anchor={text.appSwitcher.anchor} label={text.appSwitcher.label} description={text.appSwitcher.description}>
              <SettingsHotkey value={general.appSwitcher} onChange={(appSwitcher) => onGeneral({ ...general, appSwitcher })} label="macOS App Switcher chord" />
              {at("app-switcher") && <ClashLine binding={at("app-switcher")!} all={all} />}
            </SettingsRow>
          )}
          {sidebar && (
            <SettingsRow anchor={text.sidebar.anchor} label={text.sidebar.label} description={<>{text.sidebar.description}{onGo && <> <button type="button" className="pal-link" onClick={() => onGo("features", "features:sidebar")}>Sidebar settings</button></>}</>}>
              <SettingsHotkey value={sidebar.value.hotkey} onChange={(h) => sidebar.onChange({ ...sidebar.value, hotkey: h })} label="Sidebar hotkey" />
              {at("sidebar") && <ClashLine binding={at("sidebar")!} all={all} />}
            </SettingsRow>
          )}
        </SettingsGroup>
      )}

      <SettingsGroup title="Palettes" note="palettes.<id>.hotkey, hold">
        <SettingsRow anchor={text.palettes.anchor} label={text.palettes.label} description={text.palettes.description} layout="stack">
          {shown.palettes.length === 0 && <p className="pal-ppane__none">{filter ? "No palette shortcut matches." : "None. Add Shortcut › Open a palette, or a palette's own pane under Palettes."}</p>}
          {shown.palettes.length > 0 && (
            <ul className="pal-itemkeys pal-shortcuts__table" aria-label="Palette shortcuts">
              {shown.palettes.map(({ p, e, title }) => (
                <li key={p.id} className="pal-itemkeys__row pal-shortcuts__row" data-anchor={`shortcuts:palette:${p.id}`}>
                  <span className="pal-itemkeys__item">
                    <Icon icon={paletteIcon(p, e)} />
                    <button type="button" className="pal-shortcuts__name" title="The palette's pane" onClick={() => onGo?.("palettes", `palettes:${p.id}`)}>{title}</button>
                  </span>
                  <span className="pal-shortcuts__cell"><span className="pal-shortcuts__cell-label">Open</span><SettingsHotkey value={p.config.hotkey?.trim() || undefined} onChange={(hotkey) => onPalette(p.id, { ...p.config, hotkey })} label={`Open ${title}`} compact /></span>
                  {(p.hold !== undefined || p.config.hold !== undefined) && <span className="pal-shortcuts__cell"><span className="pal-shortcuts__cell-label">Switcher</span><HoldControl value={p.config.hold} suggested={p.hold} label={`${title} switcher chord`} onChange={(hold) => onPalette(p.id, { ...p.config, hold })} /></span>}
                  <span className="pal-shortcuts__clash">
                    {at(`palette:${p.id}`) && <ClashLine binding={at(`palette:${p.id}`)!} all={all} />}
                    {at(`hold:${p.id}`) && <ClashLine binding={at(`hold:${p.id}`)!} all={all} />}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Rows" note="palettes.<id>.item_hotkeys">
        <SettingsRow anchor={text.items.anchor} label={text.items.label} description={text.items.description} layout="stack">
          {shown.items.length === 0 && <p className="pal-ppane__none">{filter ? "No row shortcut matches." : "None. Add Shortcut › Run a row: a layout, a space, a script."}</p>}
          {shown.items.length > 0 && (
            <ul className="pal-itemkeys pal-shortcuts__table" aria-label="Row shortcuts">
              {shown.items.map((r) => (
                <li key={`${r.p.id}:${r.row}`} className="pal-itemkeys__row pal-shortcuts__row" data-anchor={`shortcuts:item:${r.p.id}:${r.row}`}>
                  <span className="pal-itemkeys__item">
                    <Icon icon={paletteIcon(r.p, r.e)} />
                    <span className="pal-shortcuts__name">{r.title} › {nameOf(r.p, r.row) ?? r.row}</span>
                    {nameOf(r.p, r.row) && <code className="pal-itemkeys__id pal-shortcuts__id">{r.row}</code>}
                  </span>
                  <SettingsHotkey value={r.combo} onChange={(combo) => setItem(r.p, r.row, combo)} label={`${r.title} › ${r.row}`} compact />
                  <button type="button" className="pal-button" data-small aria-label={`Remove ${r.row}`} onClick={() => setItem(r.p, r.row, undefined)}>Remove</button>
                  <span className="pal-shortcuts__clash">{at(`item:${r.p.id}:${r.row}`) && <ClashLine binding={at(`item:${r.p.id}:${r.row}`)!} all={all} />}</span>
                </li>
              ))}
            </ul>
          )}
        </SettingsRow>
      </SettingsGroup>

      {bar.length > 0 && onBarItem && (
        <SettingsGroup title="Bar items" note="bar.items.<key>.hotkey">
          <SettingsRow anchor={text.bar.anchor} label={text.bar.label} description={text.bar.description} layout="stack">
            {shown.bar.length === 0 && <p className="pal-ppane__none">{filter ? "No bar item shortcut matches." : "None. Add Shortcut › Open a bar item."}</p>}
            {shown.bar.length > 0 && (
              <ul className="pal-itemkeys pal-shortcuts__table" aria-label="Bar item shortcuts">
                {shown.bar.map((b) => (
                  <li key={b.key} className="pal-itemkeys__row pal-shortcuts__row" data-anchor={`shortcuts:bar:${b.key}`}>
                    <span className="pal-itemkeys__item">
                      <Icon icon={b.extIcon} />
                      <button type="button" className="pal-shortcuts__name" title="The item on the Bar page" onClick={() => onGo?.("bar", `bar:${b.key}`)}>{b.extTitle} › {b.title}</button>
                    </span>
                    <SettingsHotkey value={b.config.hotkey} onChange={(hotkey) => onBarItem(b.key, { ...b.config, hotkey })} label={`${b.title} hotkey`} compact />
                    <button type="button" className="pal-button" data-small aria-label={`Remove ${b.title} hotkey`} onClick={() => onBarItem(b.key, { ...b.config, hotkey: undefined })}>Remove</button>
                    <span className="pal-shortcuts__clash">{at(`bar:${b.key}`) && <ClashLine binding={at(`bar:${b.key}`)!} all={all} />}</span>
                  </li>
                ))}
              </ul>
            )}
          </SettingsRow>
        </SettingsGroup>
      )}
    </div>
  );
}
