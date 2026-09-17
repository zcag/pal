// The compact connection popover: the five things worth knowing about the link
// you are on, as key and value.  It is deliberately not the palette -- that one
// lists every address this machine has and exists to be searched and copied,
// which is a different question from "what am I connected to right now".
import { column, keyHint, POPOVER_W, row, text, type Action, type View, type ViewNode } from "@zcag/pal";

export type NetworkPopover = {
  /** The label the strip shows: the friendly name, the SSID, the wired kind, or Offline. */
  name: string;
  kind?: "hotspot" | "public" | "wired" | "offline";
  /** `en0 · Wi-Fi`. */
  interface?: string;
  address?: string;
  gateway?: string;
  dns?: string[];
  /** 0-100. */
  signal?: number;
  security?: string;
};

const BADGE = { hotspot: ["hotspot", "amber"], public: ["open network", "amber"], wired: ["wired", "green"], offline: ["no route", "red"] } as const;
const KEY_W = 76;

const kv = (key: string, label: string, value: string): ViewNode => row([
  text(label, { key: `${key}-k`, style: "muted", size: "xs", width: KEY_W }),
  text(value, { key: `${key}-v`, style: "body", size: "sm", width: POPOVER_W - KEY_W - 24 }),
], { key, gap: 2 });

export function renderNetworkPopover(s: NetworkPopover): View {
  const badge = s.kind ? BADGE[s.kind] : (["connected", "green"] as const);
  // The strength and what secures it answer the same question -- how good is
  // this link -- so they share a row rather than each taking one.
  const link = [s.signal === undefined ? undefined : `${s.signal}%`, s.security].filter(Boolean).join(" · ");
  const pairs: [string, string | undefined][] = [
    ["interface", s.interface],
    ["ip", s.address],
    ["gateway", s.gateway],
    ["signal", link || undefined],
    ["dns", s.dns?.join(", ")],
  ];
  const rows = pairs.filter((p): p is [string, string] => !!p[1]).map(([label, value]) => kv(label, label, value));
  const actions: Action[] = [
    { id: "settings", title: "Open Network settings", shortcut: "enter" },
    { id: "addresses", title: "All addresses", shortcut: "cmd+a" },
  ];
  return {
    title: "Connection",
    id: "network",
    keys: "actions",
    actions,
    tree: column([
      row([text(s.name, { key: "name", style: "body", size: "lg", weight: "semibold" }), { type: "spacer" }, { type: "badge", key: "kind", text: badge[0], color: badge[1] }], { key: "head", gap: 2 }),
      ...(rows.length ? rows : [text("Nothing is connected", { key: "empty", style: "muted", size: "sm" })]),
      row([...keyHint("enter", "Network Settings", { action: "settings" }), ...keyHint("cmd+a", "All addresses", { action: "addresses" })], { key: "footer", gap: 1, minHeight: 20 }),
    ], { key: "network", padding: 3, gap: 2 }),
  };
}
