import { useEffect, useState, type ReactNode } from "react";
import { Icon } from "./Icon";
import { Kbd } from "./Kbd";
import { SettingsField, SettingsHotkey, SettingsRow, SettingsSwitch } from "./SettingsField";
import { HoldControl } from "./SettingsPalettes";
import { SettingsSidebar, type SettingsSidebarProps } from "./SettingsSidebar";
import type { Icon as IconT } from "./types";
import type { PermissionId, SettingSpec, SettingsIndexEntry, SettingValue, SettingValues } from "./SettingsTypes";

/** One feature as the page draws it (features.rs `view`, the spec flattened). */
export type SettingsFeature = {
  id: string;
  title: string;
  description: string;
  icon?: IconT;
  /** This platform runs it (the spec's `platforms`). */
  available: boolean;
  /** Its headline state: the card's switch, the status line. */
  on: boolean;
  /** On, and waiting on this permission. */
  needs?: PermissionId;
  /** The permission it uses (its spec's `permission`) and what for (`why`), for the Overview. */
  permission?: PermissionId;
  why?: string;
  /** More than on or off: "Showing keys", "No trackpad is being read". */
  note?: string;
  /** The spec's `toggle`: the setting the card's switch writes. */
  toggle?: string;
  settings: SettingSpec[];
  /** `[features.<id>]` as written (the spec's defaults fill the rest). */
  values: SettingValues;
  /** Every command: the boolean settings' flips and the declared ones, `{ id, title }`. */
  commands: { id: string; title: string }[];
  /** `[features.<id>.hotkeys]`: command id to chord. */
  hotkeys: Record<string, string>;
};

export type SettingsFeaturesProps = {
  features: SettingsFeature[];
  onSetting: (feature: string, id: string, value: SettingValue) => void;
  onHotkey: (feature: string, command: string, combo: string | undefined) => void;
  /** Run `<feature>.<command>`: keycast's Start and Stop. */
  onRun?: (feature: string, command: string) => void;
  onRequestPermission?: (which: PermissionId) => void;
  /** The sidebar's card body (its table is typed, `[features.sidebar]`). */
  sidebar?: SettingsSidebarProps;
  /** The window switcher's chord (the Windows palette's `hold`, as written and as its manifest suggests) and the macOS App Switcher's. */
  switcher?: { hold?: string; suggested?: string; onHold: (hold: string | undefined) => void; appSwitcher?: string; onAppSwitcher: (combo: string | undefined) => void };
  /** The card to open and light on arrival (`features:<id>`). */
  open?: string;
};

const PERMISSION: Record<string, string> = { accessibility: "Accessibility", input_monitoring: "Input Monitoring", calendar: "Calendars", full_disk_access: "Full Disk Access", location: "Location Services" };

const HELP = "Built into pal: these run on their own, whether or not the panel is open. Every switch here is also a command: type its name at the root, or give it a hotkey.";

/** What the search field finds: every feature, and every setting of one. */
export const featuresIndex = (features: SettingsFeature[]): SettingsIndexEntry[] =>
  features.flatMap((f) => [
    { page: "features" as const, label: f.title, hint: "Feature", anchor: `features:${f.id}`, keywords: `${f.id} ${f.description} feature` },
    ...f.settings.map((s): SettingsIndexEntry => ({ page: "features", label: `${f.title}: ${s.label.toLowerCase()}`, hint: f.title, anchor: `features:${f.id}`, keywords: `${s.id} ${s.description ?? ""} ${"text" in s ? s.text ?? "" : ""}` })),
  ]);

/** The line under the title: what it is doing, or why it is not. */
function status(f: SettingsFeature, extra?: string): { text: string; tone: "on" | "off" | "warn" | "na" } {
  if (!f.available) return { text: "Not on this platform", tone: "na" };
  if (f.needs) return { text: `Needs ${PERMISSION[f.needs] ?? f.needs}`, tone: "warn" };
  if (f.note) return { text: f.note, tone: f.on ? "on" : "off" };
  if (extra) return { text: extra, tone: f.on ? "on" : "off" };
  return { text: f.on ? "On" : "Off", tone: f.on ? "on" : "off" };
}

/** How many settings differ from their defaults, the card's own switch aside: the badge on a folded card. */
const changed = (f: SettingsFeature) => f.settings.filter((s) => s.id !== f.toggle && f.values[s.id] !== undefined && JSON.stringify(f.values[s.id]) !== JSON.stringify(s.default)).length;

/**
 * Settings › Features: one card per feature, two across, each readable at
 * a glance (what it is, whether it is on, what it waits on) with its
 * headline control on the card. A card's settings and its commands'
 * hotkeys unfold in place, the card taking the full width.
 */
export function SettingsFeatures({ features, onSetting, onHotkey, onRun, onRequestPermission, sidebar, switcher, open }: SettingsFeaturesProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(open ? [open] : []));
  useEffect(() => { if (open) setExpanded((e) => new Set([...e, open])); }, [open]);
  const flip = (id: string) => setExpanded((e) => { const n = new Set(e); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <div className="pal-settings-page pal-features">
      <p className="pal-features__help">{HELP}</p>
      <div className="pal-features__grid">
        {features.map((f) => (
          <Card key={f.id} f={f} open={expanded.has(f.id)} onToggle={() => flip(f.id)} onSetting={onSetting} onHotkey={onHotkey} onRun={onRun} onRequestPermission={onRequestPermission} sidebar={sidebar} switcher={switcher} />
        ))}
      </div>
    </div>
  );
}

type CardProps = { f: SettingsFeature; open: boolean; onToggle: () => void } & Pick<SettingsFeaturesProps, "onSetting" | "onHotkey" | "onRun" | "onRequestPermission" | "sidebar" | "switcher">;

function Card({ f, open, onToggle, onSetting, onHotkey, onRun, onRequestPermission, sidebar, switcher }: CardProps) {
  const value = (s: SettingSpec) => (f.values[s.id] !== undefined ? f.values[s.id] : s.default);
  const headline = headlineOf(f, { onSetting, onRun, sidebar, switcher });
  const st = status(f, headline.status);
  const n = changed(f);
  const body = open && bodyOf(f, value, { onSetting, onHotkey, sidebar, switcher });
  return (
    <section className="pal-feature" data-open={open || undefined} data-tone={st.tone} data-anchor={`features:${f.id}`} aria-label={f.title}>
      <div className="pal-feature__head">
        <span className="pal-feature__tile"><Icon icon={f.icon} size="lg" /></span>
        <div className="pal-feature__text">
          <h3 className="pal-feature__title">{f.title}</h3>
          <span className="pal-feature__status"><span className="pal-feature__dot" aria-hidden />{st.text}</span>
        </div>
        <div className="pal-feature__control">{f.available && headline.control}</div>
      </div>
      <p className="pal-feature__desc">{f.description}</p>
      {f.needs && onRequestPermission && (
        <div className="pal-feature__needs">
          <span>pal has to be allowed {PERMISSION[f.needs] ?? f.needs} for this; nothing happens until it is.</span>
          <button type="button" className="pal-button" data-small onClick={() => onRequestPermission(f.needs!)}>Grant…</button>
        </div>
      )}
      {f.available && (
        <button type="button" className="pal-feature__more" aria-expanded={open} onClick={onToggle}>
          <span className="pal-feature__chevron" aria-hidden><svg viewBox="0 0 10 14"><path d="M3.5 2.5L7 7l-3.5 4.5" /></svg></span>
          {open ? "Hide settings" : "Settings"}
          {!open && n > 0 && <span className="pal-feature__count" title={`${n} changed from the default`}>{n}</span>}
        </button>
      )}
      {body && <div className="pal-feature__body">{body}</div>}
    </section>
  );
}

/** The control on the card itself and, when it has more to say than on or off, the status line. */
function headlineOf(f: SettingsFeature, p: Pick<SettingsFeaturesProps, "onSetting" | "onRun" | "sidebar" | "switcher">): { control?: ReactNode; status?: string } {
  if (f.toggle) return { control: <SettingsSwitch checked={f.on} onChange={(v) => p.onSetting(f.id, f.toggle!, v)} label={f.title} /> };
  switch (f.id) {
    case "keycast":
      return { control: p.onRun && <button type="button" className="pal-button" data-small onClick={() => p.onRun!(f.id, f.on ? "stop" : "toggle")}>{f.on ? "Stop" : "Start"}</button> };
    case "clipboard":
      return { status: "Recording what you copy" };
    case "sidebar":
      return { control: p.sidebar && <SettingsSwitch checked={f.on} onChange={(v) => p.sidebar!.onChange({ ...p.sidebar!.value, palette: v ? "windows/windows" : "" })} label="Sidebar" /> };
    case "switcher": {
      const chord = (p.switcher?.hold ?? p.switcher?.suggested)?.trim();
      return { control: chord ? <Kbd shortcut={chord} /> : undefined, status: chord ? "Hold the chord to switch windows" : "Off: no chord" };
    }
    case "mouse": {
      const on = f.settings.filter((s) => s.kind === "boolean" && ["middle_click", "reverse_trackpad", "reverse_mouse", "hide_pointer"].includes(s.id) && (f.values[s.id] ?? s.default) === true).map((s) => s.label);
      return { status: on.length ? on.join(" · ") : undefined };
    }
  }
  return {};
}

/** What unfolds: the settings (the headline switch left out, it is on the card), then a hotkey per command. */
function bodyOf(f: SettingsFeature, value: (s: SettingSpec) => SettingValue, p: Pick<SettingsFeaturesProps, "onSetting" | "onHotkey" | "sidebar" | "switcher">): ReactNode {
  const fields = f.settings.filter((s) => s.id !== f.toggle);
  return (
    <>
      {f.id === "sidebar" && p.sidebar && <SettingsSidebar {...p.sidebar} />}
      {f.id === "switcher" && p.switcher && (
        <div className="pal-feature__rows">
          <SettingsRow label="Chord" description="Hold it to step through the windows, let go to switch; a quick tap goes back to the window before. It is the Windows palette's hold chord, so it is on its pane under Palettes too.">
            <HoldControl value={p.switcher.hold} suggested={p.switcher.suggested} label="Switch windows" onChange={p.switcher.onHold} />
          </SettingsRow>
          <SettingsRow label="App switcher" description="macOS's own App Switcher (Cmd+Tab's) on another Tab chord, for when the window switcher has taken cmd+tab: alt+tab, say. Shift steps back.">
            <SettingsHotkey value={p.switcher.appSwitcher} onChange={p.switcher.onAppSwitcher} label="macOS App Switcher chord" />
          </SettingsRow>
        </div>
      )}
      {f.id !== "switcher" && fields.length > 0 && (
        <div className="pal-feature__rows">
          {fields.map((s) => <SettingsField key={s.id} spec={s} value={value(s)} onChange={(v) => p.onSetting(f.id, s.id, v)} />)}
        </div>
      )}
      {f.commands.length > 0 && (
        <div className="pal-feature__rows">
          <h4 className="pal-feature__sub">Commands</h4>
          {f.commands.map((c) => (
            <SettingsRow key={c.id} label={c.title} description={`pal command ${f.id}.${c.id}`}>
              <SettingsHotkey value={f.hotkeys[c.id]} onChange={(h) => p.onHotkey(f.id, c.id, h)} label={`${c.title} hotkey`} compact />
            </SettingsRow>
          ))}
        </div>
      )}
    </>
  );
}
