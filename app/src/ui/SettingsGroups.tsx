import { useEffect, useState, type KeyboardEvent } from "react";
import { Icon } from "./Icon";
import { Tag } from "./Row";
import { ArmedButton, SettingsRow, SettingsSelect } from "./SettingsField";
import type { Icon as IconT } from "./types";
import type { SettingsIndexEntry } from "./SettingsTypes";

/** The controls a device can provide (`pal_core::controls::NAMES`); a group picks who serves volume and inputs, power is every member's. */
export type GroupControl = "volume" | "power" | "inputs" | "player";

/** What makes an extension a device a group can hold: a player alone (Spotify, Now Playing) is not one. */
export const DEVICE_CONTROLS: GroupControl[] = ["volume", "power", "inputs"];
export const isDevice = (controls: readonly string[] | undefined) => !!controls?.some((c) => (DEVICE_CONTROLS as string[]).includes(c));

/** An installed extension (instance) that can be a member: its manifest declares a device control. */
export type GroupDevice = {
  /** The instance key a group's `members` lists. */
  key: string;
  title: string;
  icon?: IconT;
  /** What the manifest says it provides. */
  controls: GroupControl[];
  /** The device it drives now, as it published it ("75\" Neo QLED"). */
  device?: string;
  /** Installed but not running: off, or its load failed. */
  stopped?: boolean;
};

/** A device extension a registry offers that is not installed: picking it installs it, then adds it. */
export type DeviceOffer = {
  name: string;
  title: string;
  icon?: IconT;
  controls: GroupControl[];
  /** Why it cannot be installed here (a newer pal needed, another platform). */
  blocked?: string;
};

/** `[groups.<id>]` as the file spells it (`pal_core::controls::Group`). */
export type DeviceGroup = { id: string; title?: string; members: string[]; volume?: string; inputs?: string };

export type SettingsGroupsProps = {
  groups: DeviceGroup[];
  devices: GroupDevice[];
  offers?: DeviceOffer[];
  /** Answers the new group's id. */
  onCreate: (title: string) => Promise<string | void> | string | void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onMembers: (id: string, members: string[]) => Promise<void> | void;
  /** `volume` or `inputs` to one member; `undefined`: each its own. */
  onBind: (id: string, control: "volume" | "inputs", member: string | undefined) => Promise<void> | void;
  /** Install an offered device; resolves once it is loaded. */
  onInstall?: (name: string) => Promise<void>;
};

/** What the search field finds: the page, and every group by name. */
export const groupsIndex = (groups: DeviceGroup[]): SettingsIndexEntry[] => [
  { page: "groups", label: "Groups", hint: "Groups", keywords: "group devices room remote volume sound inputs power together tv apple" },
  ...groups.map((g): SettingsIndexEntry => ({ page: "groups", label: g.title || g.id, hint: "Group", anchor: `groups:${g.id}`, keywords: `${g.id} ${g.members.join(" ")} group` })),
];

/** A new group's name: "Living room" first, then "Group 2", "Group 3", … whichever is free. */
export function nextTitle(groups: DeviceGroup[]): string {
  const taken = new Set(groups.map((g) => (g.title || g.id).toLowerCase()));
  if (!taken.has("living room")) return "Living room";
  for (let n = groups.length + 1; ; n++) if (!taken.has(`group ${n}`)) return `Group ${n}`;
}

/**
 * Who serves what once `key` joins: inputs go to the first member that has
 * them, and so does the sound, except that a TV (a member with inputs) takes
 * the sound over from a box without inputs (an Apple TV plays through the TV
 * it is plugged into). A choice made on the page is the binding itself, so
 * it is only ever replaced by this rule, never undone by it.
 */
export function bindingsOnJoin(g: DeviceGroup, key: string, controls: readonly GroupControl[], controlsOf: (key: string) => readonly GroupControl[]): { volume?: string; inputs?: string } {
  const out: { volume?: string; inputs?: string } = {};
  const tv = controls.includes("inputs");
  if (tv && !g.inputs) out.inputs = key;
  if (controls.includes("volume") && (!g.volume || (tv && !controlsOf(g.volume).includes("inputs")))) out.volume = key;
  return out;
}

const names = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/**
 * Settings › Groups: a card per group (its devices, where the sound and the
 * inputs come from, power together) and "New group". A device that is not
 * installed but offered by a registry is one click away: picking it installs
 * it, then adds it. Every write is one of the core's `groups_*` commands; the
 * file mirrors the page.
 */
export function SettingsGroups({ groups, devices, offers = [], onCreate, onRename, onDelete, onMembers, onBind, onInstall }: SettingsGroupsProps) {
  const [fresh, setFresh] = useState<string | undefined>(undefined);
  const create = async () => { const id = await onCreate(nextTitle(groups)); if (id) setFresh(id); };
  const groupOf = (key: string) => groups.find((g) => g.members.includes(key));
  const controlsOf = (key: string) => devices.find((d) => d.key === key)?.controls ?? offers.find((o) => o.name === key)?.controls ?? [];
  /** Into `g` (out of the group it was in), with the sound and the inputs bound by the rule above. */
  const join = async (g: DeviceGroup, key: string) => {
    const other = groupOf(key);
    if (other && other.id !== g.id) await onMembers(other.id, other.members.filter((x) => x !== key));
    await onMembers(g.id, [...g.members, key]);
    const b = bindingsOnJoin(g, key, controlsOf(key), controlsOf);
    if (b.volume) await onBind(g.id, "volume", b.volume);
    if (b.inputs) await onBind(g.id, "inputs", b.inputs);
  };
  const nothing = devices.length === 0 && offers.length === 0;
  return (
    <div className="pal-settings-page pal-groups">
      <p className="pal-groups__help">Devices you use together, driven from one remote.</p>
      {groups.length === 0 && (
        <div className="pal-groups__start">
          <p>{nothing ? "No device that can join a group is installed or offered yet." : "No groups yet."}</p>
          <button type="button" className="pal-button" data-primary onClick={create}>New group</button>
        </div>
      )}
      <div className="pal-groups__list">
        {groups.map((g) => <Card key={g.id} g={g} open={fresh === g.id} devices={devices} offers={offers} groupOf={groupOf} join={join} onRename={onRename} onDelete={onDelete} onMembers={onMembers} onBind={onBind} onInstall={onInstall} />)}
      </div>
      {groups.length > 0 && <div className="pal-groups__foot"><button type="button" className="pal-button" data-small onClick={create}>New group</button></div>}
    </div>
  );
}

type CardProps = {
  g: DeviceGroup;
  open: boolean;
  devices: GroupDevice[];
  offers: DeviceOffer[];
  groupOf: (key: string) => DeviceGroup | undefined;
  join: (g: DeviceGroup, key: string) => Promise<void>;
} & Pick<SettingsGroupsProps, "onRename" | "onDelete" | "onMembers" | "onBind" | "onInstall">;

function Card({ g, open, devices, offers, groupOf, join, onRename, onDelete, onMembers, onBind, onInstall }: CardProps) {
  const [title, setTitle] = useState(g.title ?? "");
  const [adding, setAdding] = useState(open);
  const [busy, setBusy] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  useEffect(() => setTitle(g.title ?? ""), [g.title]);
  useEffect(() => { if (open) setAdding(true); }, [open]);
  const device = (key: string) => devices.find((d) => d.key === key);
  const offer = (key: string) => offers.find((o) => o.name === key);
  const name = (key: string) => device(key)?.title ?? offer(key)?.title ?? key;
  const provides = (key: string, c: GroupControl) => !!(device(key) ?? offer(key))?.controls.includes(c);
  const commit = () => { if (title.trim() !== (g.title ?? "")) onRename(g.id, title); };
  /** Add `key` (installing it first when it is only offered); the button says what is going on. */
  const add = async (key: string, install: boolean) => {
    setBusy(key);
    setError(undefined);
    try {
      if (install) await onInstall?.(key);
      await join(g, key);
      setAdding(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(undefined);
    }
  };
  const picks = [
    ...devices.filter((d) => !g.members.includes(d.key)).map((d) => ({ key: d.key, title: d.title, icon: d.icon, note: groupOf(d.key) ? `in ${groupOf(d.key)!.title || groupOf(d.key)!.id}` : d.device, install: false, blocked: undefined as string | undefined })),
    ...offers.filter((o) => !g.members.includes(o.name)).map((o) => ({ key: o.name, title: o.title, icon: o.icon, note: o.blocked ?? "Install", install: true, blocked: o.blocked })),
  ];
  const empty = g.members.length === 0;
  const powered = g.members.filter((m) => provides(m, "power"));
  return (
    <section className="pal-group" data-anchor={`groups:${g.id}`} aria-label={g.title || g.id}>
      <div className="pal-group__head">
        <input
          className="pal-inline pal-group__title"
          type="text"
          value={title}
          placeholder={g.id}
          title={`Rename · [groups.${g.id}] in the config`}
          aria-label={`Name of ${g.title || g.id}`}
          spellCheck={false}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commit}
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } else if (e.key === "Escape") { setTitle(g.title ?? ""); } }}
        />
        <span className="pal-group__delete"><ArmedButton label="Delete" arm="Delete group?" onConfirm={() => onDelete(g.id)} aria-label={`Delete ${g.title || g.id}`} data-small /></span>
      </div>
      {!empty && (
        <ul className="pal-group__members" aria-label="Devices">
          {g.members.map((m) => {
            const d = device(m), o = offer(m);
            return (
              <li key={m} className="pal-group__member" data-missing={!d || undefined}>
                <Icon icon={d?.icon ?? o?.icon} />
                <span className="pal-group__member-text">
                  <span className="pal-group__member-title">{name(m)}</span>
                  {d?.device && <span className="pal-group__member-device">{d.device}</span>}
                </span>
                {!d && o && !o.blocked && <button type="button" className="pal-button" data-small disabled={busy === m} onClick={() => { setBusy(m); onInstall?.(m).catch((e) => setError(String(e))).finally(() => setBusy(undefined)); }}>{busy === m ? "Installing…" : "Install"}</button>}
                {!d && !o && <Tag text="not installed" color="amber" />}
                {d?.stopped && <Tag text="not running" color="grey" />}
                <button type="button" className="pal-chips__remove" aria-label={`Remove ${name(m)} from ${g.title || g.id}`} onClick={() => onMembers(g.id, g.members.filter((x) => x !== m))}>×</button>
              </li>
            );
          })}
          {!adding && picks.length > 0 && <li><button type="button" className="pal-group__more" onClick={() => setAdding(true)}>+ Add a device</button></li>}
        </ul>
      )}
      {(empty || adding) && (
        <div className="pal-group__pick">
          <p className="pal-group__ask">{empty ? "Which devices do you use together?" : "Add a device"}</p>
          {picks.length === 0 ? (
            <p className="pal-group__note">Nothing to add: install a TV or an Apple TV extension from the store, and it shows up here.</p>
          ) : (
            <div className="pal-group__picks">
              {picks.map((p) => (
                <button key={p.key} type="button" className="pal-group__pickbtn" disabled={!!p.blocked || !!busy} data-install={p.install || undefined} onClick={() => add(p.key, p.install)}>
                  <Icon icon={p.icon} />
                  <span className="pal-group__member-text">
                    <span className="pal-group__member-title">{p.title}</span>
                    <span className="pal-group__member-device">{busy === p.key ? (p.install ? "Installing…" : "Adding…") : p.note ?? "Add"}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
          {!empty && <button type="button" className="pal-group__more" onClick={() => setAdding(false)}>Done</button>}
        </div>
      )}
      {error && <p className="pal-group__error">{error}</p>}
      {!empty && (
        <div className="pal-group__rows">
          {(["volume", "inputs"] as const).map((control) => {
            const able = g.members.filter((m) => provides(m, control));
            if (able.length === 0) return null;
            const bound = g[control] && g.members.includes(g[control]!) ? g[control]! : "";
            const label = control === "volume" ? "Volume buttons change" : "Input buttons switch";
            // One member has it: nothing to choose, the row only says what the buttons do.
            if (able.length === 1 && (!bound || bound === able[0])) return (
              <SettingsRow key={control} label={label}>
                <span className="pal-group__note">{bound ? `the ${name(able[0])}` : `each device its own`}</span>
              </SettingsRow>
            );
            return (
              <SettingsRow key={control} label={label} description={control === "volume" ? "Pick the device your speakers or soundbar listen to." : undefined}>
                <SettingsSelect value={bound} label={`${label} in ${g.title || g.id}`} options={[{ id: "", title: "Each device its own" }, ...able.map((m) => ({ id: m, title: `the ${name(m)}` }))]} onChange={(m) => onBind(g.id, control, m || undefined)} />
              </SettingsRow>
            );
          })}
          {powered.length > 0 && (
            <SettingsRow label="Power">
              <span className="pal-group__note">{powered.length > 1 ? `${names(powered.map(name))} turn on and off together` : `${name(powered[0])} turns on and off with the group`}</span>
            </SettingsRow>
          )}
        </div>
      )}
    </section>
  );
}
