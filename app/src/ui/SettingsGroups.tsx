import { useEffect, useState, type KeyboardEvent } from "react";
import { Icon } from "./Icon";
import { Tag } from "./Row";
import { ArmedButton, SettingsRow, SettingsSelect } from "./SettingsField";
import type { Icon as IconT } from "./types";
import type { SettingsIndexEntry } from "./SettingsTypes";

/** The controls a device can provide (`pal_core::controls::NAMES`); a group picks who serves volume and inputs, power is every member's. */
export type GroupControl = "volume" | "power" | "inputs" | "player";

/** An extension (instance) that can be a member: its manifest declares `controls`, or a group names it. */
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

/** `[groups.<id>]` as the file spells it (`pal_core::controls::Group`). */
export type DeviceGroup = { id: string; title?: string; members: string[]; volume?: string; inputs?: string };

export type SettingsGroupsProps = {
  groups: DeviceGroup[];
  devices: GroupDevice[];
  onCreate: (title: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onMembers: (id: string, members: string[]) => void;
  /** `volume` or `inputs` to one member; `undefined`: each its own. */
  onBind: (id: string, control: "volume" | "inputs", member: string | undefined) => void;
};

const HELP = "Put devices you use together in one group: then one remote drives the TV's volume and inputs, and power turns them all on and off. Each device keeps its own remote; a group only decides who serves what.";
const NONE = "Nothing here provides a control yet. Devices that can join a group, like a TV or an Apple TV, appear here once their extension is installed.";

const BOUND: { control: "volume" | "inputs"; label: string; description: string }[] = [
  { control: "volume", label: "Volume", description: "Whose volume every member's remote changes." },
  { control: "inputs", label: "Inputs", description: "Whose inputs every member's remote switches." },
];

/** What the search field finds: the page, and every group by name. */
export const groupsIndex = (groups: DeviceGroup[]): SettingsIndexEntry[] => [
  { page: "groups", label: "Groups", hint: "Groups", keywords: "group devices room remote volume inputs power together" },
  ...groups.map((g): SettingsIndexEntry => ({ page: "groups", label: g.title || g.id, hint: "Group", anchor: `groups:${g.id}`, keywords: `${g.id} ${g.members.join(" ")} group` })),
];

/**
 * Settings › Groups: a card per group (its name, its members, who serves
 * each control), and a field to start one. Every write is one of the
 * core's `groups_*` commands; the file mirrors the page.
 */
export function SettingsGroups({ groups, devices, onCreate, onRename, onDelete, onMembers, onBind }: SettingsGroupsProps) {
  const [draft, setDraft] = useState("");
  const create = () => { onCreate(draft.trim()); setDraft(""); };
  const groupOf = (key: string) => groups.find((g) => g.members.includes(key));
  return (
    <div className="pal-settings-page pal-groups">
      <p className="pal-groups__help">{HELP}</p>
      {devices.length === 0 && groups.length === 0 && <p className="pal-groups__none">{NONE}</p>}
      <div className="pal-groups__list">
        {groups.map((g) => <Card key={g.id} g={g} devices={devices} groupOf={groupOf} onRename={onRename} onDelete={onDelete} onMembers={onMembers} onBind={onBind} />)}
      </div>
      <div className="pal-groups__new">
        <input
          className="pal-inline pal-groups__new-name"
          type="text"
          value={draft}
          placeholder="Living room"
          aria-label="New group's name"
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); create(); } }}
        />
        <button type="button" className="pal-button" data-small onClick={create}>New group</button>
      </div>
    </div>
  );
}

type CardProps = { g: DeviceGroup; devices: GroupDevice[]; groupOf: (key: string) => DeviceGroup | undefined } & Pick<SettingsGroupsProps, "onRename" | "onDelete" | "onMembers" | "onBind">;

function Card({ g, devices, groupOf, onRename, onDelete, onMembers, onBind }: CardProps) {
  const [title, setTitle] = useState(g.title ?? "");
  useEffect(() => setTitle(g.title ?? ""), [g.title]);
  const device = (key: string) => devices.find((d) => d.key === key);
  const name = (key: string) => device(key)?.title ?? key;
  const provides = (key: string, c: GroupControl) => !!device(key)?.controls.includes(c);
  const commit = () => { if (title.trim() !== (g.title ?? "")) onRename(g.id, title); };
  // A device is in one group at most (the core warns and keeps the first): one in another group is offered as a move, "(in Bedroom)".
  const addable = devices.filter((d) => !g.members.includes(d.key));
  const powered = g.members.filter((m) => provides(m, "power"));
  return (
    <section className="pal-group" data-anchor={`groups:${g.id}`} aria-label={g.title || g.id}>
      <div className="pal-group__head">
        <input
          className="pal-inline pal-group__title"
          type="text"
          value={title}
          placeholder={g.id}
          aria-label={`Name of ${g.title || g.id}`}
          spellCheck={false}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commit}
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } else if (e.key === "Escape") { setTitle(g.title ?? ""); } }}
        />
        <code className="pal-group__id">groups.{g.id}</code>
        <ArmedButton label="Delete" arm="Delete? Click again" onConfirm={() => onDelete(g.id)} aria-label={`Delete ${g.title || g.id}`} data-small data-destructive />
      </div>
      <ul className="pal-group__members" aria-label="Members">
        {g.members.map((m) => {
          const d = device(m);
          return (
            <li key={m} className="pal-group__member" data-missing={!d || undefined}>
              <Icon icon={d?.icon} />
              <span className="pal-group__member-text">
                <span className="pal-group__member-title">{name(m)}</span>
                {d?.device && <span className="pal-group__member-device">{d.device}</span>}
              </span>
              {!d && <Tag text="not installed" color="amber" />}
              {d?.stopped && <Tag text="not running" color="grey" />}
              <button type="button" className="pal-chips__remove" aria-label={`Remove ${name(m)} from ${g.title || g.id}`} onClick={() => onMembers(g.id, g.members.filter((x) => x !== m))}>×</button>
            </li>
          );
        })}
        {addable.length > 0 && (
          <li className="pal-group__add">
            <SettingsSelect
              value=""
              label={`Add a device to ${g.title || g.id}`}
              options={[{ id: "", title: g.members.length ? "Add a device…" : "Add the first device…" }, ...addable.map((d) => {
                const other = groupOf(d.key);
                return { id: d.key, title: other ? `${d.title} (in ${other.title || other.id})` : d.title };
              })]}
              onChange={(key) => {
                if (!key) return;
                const other = groupOf(key);
                if (other) onMembers(other.id, other.members.filter((x) => x !== key));
                onMembers(g.id, [...g.members, key]);
              }}
            />
          </li>
        )}
      </ul>
      {g.members.length === 0 ? (
        <p className="pal-group__empty">Add the devices you use together: the one you navigate with, and the TV the sound and the inputs come from.</p>
      ) : (
        <div className="pal-group__rows">
          {BOUND.map(({ control, label, description }) => {
            const able = g.members.filter((m) => provides(m, control));
            const bound = g[control] && g.members.includes(g[control]!) ? g[control]! : "";
            return (
              <SettingsRow key={control} label={label} description={description}>
                {able.length === 0 && !bound ? (
                  <span className="pal-group__note">No member has {control === "volume" ? "a volume" : "inputs"}</span>
                ) : (
                  <SettingsSelect value={bound} label={`${label} of ${g.title || g.id}`} options={[{ id: "", title: "Each its own" }, ...[...new Set([...able, ...(bound ? [bound] : [])])].map((m) => ({ id: m, title: name(m) }))]} onChange={(m) => onBind(g.id, control, m || undefined)} />
                )}
              </SettingsRow>
            );
          })}
          <SettingsRow label="Power" description="On and off reach every member that can be turned on and off.">
            <span className="pal-group__note">{powered.length ? `Every member: ${powered.map(name).join(", ")}` : "No member turns on and off"}</span>
          </SettingsRow>
        </div>
      )}
    </section>
  );
}
