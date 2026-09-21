import { SettingsGroup, SettingsHotkey, SettingsRow, SettingsSegment, SettingsSelect, SettingsSwitch } from "./SettingsField";
import { SIDEBAR_WINDOWS, type SettingOption, type SettingsIndexEntry, type SidebarConfig, type SidebarEdge } from "./SettingsTypes";
import { isMac } from "./keys";

export type SettingsSidebarProps = {
  value: SidebarConfig;
  onChange: (value: SidebarConfig) => void;
  /** Every enabled palette as `extension/palette` with its title: what the select offers. */
  palettes?: SettingOption[];
  /** The displays' names as the OS reports them, the primary first. */
  displays?: string[];
};

/** The help line at the top of the card, and the Bar page's pointer. */
export const SIDEBAR_HELP = `A live palette docked to a screen edge; every row wears its number and ${isMac ? "cmd" : "ctrl"}+N runs it. Off until a palette is picked.`;

const edges: { id: SidebarEdge; title: string }[] = [{ id: "left", title: "Left" }, { id: "right", title: "Right" }];

const text = {
  sidebar: { anchor: "general:sidebar", label: "Sidebar", keywords: "sidebar edge dock windows palette on off" },
  edge: { anchor: "general:sidebar:edge", label: "Edge", description: "Which side of the screen it docks to, 8 px in from the edge and from the top.", keywords: "left right side" },
  display: { anchor: "general:sidebar:display", label: "Display", description: "Cursor is whichever display the pointer is on at each show (a peek strip on every display); Primary the one with the menu bar; a name that display alone.", keywords: "monitor screen cursor primary" },
  width: { anchor: "general:sidebar:width", label: "Width", description: "Points. The height follows the rows, up to the work area.", keywords: "size points" },
  delay: { anchor: "general:sidebar:delay", label: "Peek after", description: "How long the pointer rests at the edge before the peek; 0 is the moment it touches.", keywords: "hover delay instant" },
  grace: { anchor: "general:sidebar:grace", label: "Stays for", description: "How long a peek stays after the pointer has left the edge and the window.", keywords: "hover grace linger" },
  peek: { anchor: "general:sidebar:peek", label: "Peek", description: "The pointer touching the edge peeks it, centred on the pointer. Off leaves the hotkey and nothing at the edge.", keywords: "hover strip pointer" },
  hotkey: { anchor: "general:sidebar:hotkey", label: "Hotkey", description: "Engages it from any app: shown key from hidden, or a peek made key. The root, palette and bar item hotkeys win a clash.", keywords: "shortcut keys engage" },
} as const;

/** The card's rows for the settings search, under General. */
export const sidebarIndex: SettingsIndexEntry[] = (Object.values(text) as (typeof text)[keyof typeof text][]).map((r) => ({ page: "general", label: r.label === "Sidebar" ? "Sidebar" : `Sidebar: ${r.label.toLowerCase()}`, hint: r.label === "Sidebar" ? SIDEBAR_HELP : "Sidebar", anchor: r.anchor, keywords: `${r.keywords} ${"description" in r ? r.description : SIDEBAR_HELP}` }));

/** One line for the Overview and the Bar page: "Windows on the right edge", or "off". */
export function sidebarSummary(c: SidebarConfig, palettes: SettingOption[] = []): string {
  const key = c.palette.trim();
  if (!key) return "off";
  const title = palettes.find((p) => p.id === key)?.title ?? key;
  return `${title} on the ${c.edge} edge${c.display !== "cursor" ? `, ${c.display === "primary" ? "primary display" : c.display}` : ""}`;
}

/**
 * `[sidebar]` as one card: the switch (On puts the Windows palette there
 * when none is named, Off writes the palette away), the palette, the edge,
 * the display, the width, the peek and the hotkey. The whole table is
 * here; Settings › Bar points at it.
 */
export function SettingsSidebar({ value, onChange, palettes = [], displays = [] }: SettingsSidebarProps) {
  const set = <K extends keyof SidebarConfig>(k: K, v: SidebarConfig[K]) => onChange({ ...value, [k]: v });
  const on = value.palette.trim() !== "";
  // A palette the file names that the list does not offer (disabled, or a typo) stays selectable, so the select shows what the file says.
  const options = on && !palettes.some((p) => p.id === value.palette.trim()) ? [...palettes, { id: value.palette.trim(), title: value.palette.trim() }] : palettes;
  // The same for a display named in the file that is not connected now.
  const known: SettingOption[] = [{ id: "cursor", title: "Cursor" }, { id: "primary", title: "Primary" }, ...displays.filter((d) => d && d !== "cursor" && d !== "primary").map((d) => ({ id: d, title: d }))];
  const displayOptions = known.some((d) => d.id === value.display) ? known : [...known, { id: value.display, title: `${value.display} (not connected)` }];
  return (
    <SettingsGroup title="Sidebar" note={isMac ? undefined : "macOS only; the table is read here, nothing is built"}>
      <SettingsRow anchor={text.sidebar.anchor} label={text.sidebar.label} description={<>{SIDEBAR_HELP}{on ? " Peek it, click into it or press its hotkey; typing filters, Enter runs, Escape hides." : ` On shows the Windows palette (${SIDEBAR_WINDOWS}), the one built for it; pick another below.`}</>}>
        <span className="pal-sidebar__on">
          <SettingsSwitch checked={on} onChange={(v) => set("palette", v ? SIDEBAR_WINDOWS : "")} label="Sidebar" />
          {on && <SettingsSelect id="pal-sidebar-palette" label="Sidebar palette" value={value.palette.trim()} options={options} onChange={(v) => set("palette", v)} />}
        </span>
      </SettingsRow>
      <SettingsRow anchor={text.edge.anchor} label={text.edge.label} description={text.edge.description}>
        <SettingsSegment value={value.edge} options={edges} onChange={(v) => set("edge", v as SidebarEdge)} label="Sidebar edge" />
      </SettingsRow>
      <SettingsRow anchor={text.display.anchor} label={text.display.label} description={text.display.description} htmlFor="pal-sidebar-display">
        <SettingsSelect id="pal-sidebar-display" value={value.display} options={displayOptions} onChange={(v) => set("display", v)} />
      </SettingsRow>
      <SettingsRow anchor={text.width.anchor} label={text.width.label} description={text.width.description} htmlFor="pal-sidebar-width">
        <span className="pal-number"><input id="pal-sidebar-width" className="pal-field__input pal-bar__order" type="number" min={120} step={10} aria-label="Sidebar width" value={value.width} onChange={(e) => { const n = Number(e.target.value); if (e.target.value !== "" && Number.isFinite(n) && n > 0) set("width", n); }} /><span className="pal-number__unit">pt</span></span>
      </SettingsRow>
      <SettingsRow anchor={text.peek.anchor} label={text.peek.label} description={text.peek.description}>
        <SettingsSwitch checked={value.peek} onChange={(v) => set("peek", v)} label="Sidebar peek" />
      </SettingsRow>
      <SettingsRow anchor={text.delay.anchor} label={text.delay.label} description={text.delay.description} htmlFor="pal-sidebar-delay">
        <span className="pal-number"><input id="pal-sidebar-delay" className="pal-field__input pal-bar__order" type="number" min={0} step={50} aria-label="Sidebar peek delay" value={value.delay} onChange={(e) => { const n = Number(e.target.value); if (e.target.value !== "" && Number.isFinite(n) && n >= 0) set("delay", n); }} /><span className="pal-number__unit">ms</span></span>
      </SettingsRow>
      <SettingsRow anchor={text.grace.anchor} label={text.grace.label} description={text.grace.description} htmlFor="pal-sidebar-grace">
        <span className="pal-number"><input id="pal-sidebar-grace" className="pal-field__input pal-bar__order" type="number" min={0} step={50} aria-label="Sidebar peek grace" value={value.grace} onChange={(e) => { const n = Number(e.target.value); if (e.target.value !== "" && Number.isFinite(n) && n >= 0) set("grace", n); }} /><span className="pal-number__unit">ms</span></span>
      </SettingsRow>
      <SettingsRow anchor={text.hotkey.anchor} label={text.hotkey.label} description={text.hotkey.description}>
        <SettingsHotkey value={value.hotkey} onChange={(v) => set("hotkey", v)} label="Sidebar hotkey" />
      </SettingsRow>
    </SettingsGroup>
  );
}
