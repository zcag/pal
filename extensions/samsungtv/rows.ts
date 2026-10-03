// The list palettes' rows, pure (the fixture builds the store shots from
// these): an app with its icon, the commands at the root, the inputs.
// Every row names the TV it acts on, so with two paired the root never
// leaves you guessing which one a key goes to.
import { hint, type Action, type Item } from "@zcag/pal";
import { G } from "./remote.ts";
import type { App, Input } from "./types.ts";

/** The row every palette shows while nothing is paired. */
export const SETUP_ROW: Item = { id: "setup", name: "Set Up Samsung TV", subtitle: "Find the TV on this network and press Allow on it", icon: G.remote, actions: [{ id: "setup", title: "Set up" }] };

export const APP_ACTIONS = (inDock: boolean): Action[] => [
  { id: "launch", title: "Open on the TV" },
  { id: "launch:remote", title: "Open, then show the remote", shortcut: "cmd+enter" },
  { id: "dock", title: inDock ? "Remove from the dock" : "Add to the dock", shortcut: "cmd+d" },
  { id: "quit", title: "Close on the TV", shortcut: "cmd+w" },
  { id: "copy", title: "Copy the app id", shortcut: "cmd+c" },
];

export function appRow(a: App, art: string, o: { device: string; front?: boolean; dock?: number }): Item {
  return {
    id: a.id,
    name: a.name,
    subtitle: o.front ? `On screen on ${o.device}` : `Open on ${o.device}`,
    icon: { image: art },
    keywords: ["samsung", "tv"],
    accessories: [...(o.front ? [{ tag: "on screen", color: "green" as const }] : []), ...(o.dock !== undefined ? [{ keys: String(o.dock + 1) }] : [])],
    actions: APP_ACTIONS(o.dock !== undefined),
  };
}

type Cmd = { id: string; name: string; icon: string; keywords?: string[] };

/** The commands that make sense as root rows: what the remote's buttons do. */
export const COMMANDS: Cmd[] = [
  { id: "wake", name: "Turn On", icon: G.power, keywords: ["power", "wake"] },
  { id: "standby", name: "Turn Off", icon: G.standby, keywords: ["power", "standby", "sleep", "off"] },
  { id: "home", name: "Go Home", icon: G.home, keywords: ["smart hub", "home screen"] },
  { id: "play-pause", name: "Play or Pause", icon: G.playPause, keywords: ["resume", "stop"] },
  { id: "mute", name: "Mute or Unmute", icon: G.mute, keywords: ["sound", "quiet"] },
  { id: "volume-up", name: "Volume Up", icon: G.volUp, keywords: ["louder"] },
  { id: "volume-down", name: "Volume Down", icon: G.volDown, keywords: ["quieter"] },
  { id: "menu", name: "Open the TV's Settings", icon: G.settings, keywords: ["menu", "picture", "sound"] },
  { id: "guide", name: "Guide", icon: G.guide, keywords: ["channels", "epg"] },
];

export function commandRows(device: string, others: string[], inputs: Input[]): Item[] {
  const rows: Item[] = COMMANDS.map((c) => ({ id: c.id, name: c.name, subtitle: device, icon: c.icon, keywords: ["samsung", "tv", ...(c.keywords ?? [])], actions: [{ id: "run", title: c.name }] }));
  const label: Record<string, string> = { hdmi: "Next HDMI Input", source: "Open the Input Menu", tv: "Switch to TV" };
  for (const i of inputs) rows.push({ id: `input:${i.id}`, name: label[i.id] ?? `Switch to ${i.name}`, subtitle: device, icon: G.hdmi, keywords: ["samsung", "tv", "input", "source", "hdmi"], actions: [{ id: "run", title: label[i.id] ?? `Switch to ${i.name}` }] });
  for (const o of others) rows.push({ id: `device:${o}`, name: `Switch to ${o}`, subtitle: "Make it the TV the remote and these commands control", icon: G.tv, keywords: ["samsung", "tv"], actions: [{ id: "run", title: `Switch to ${o}` }] });
  rows.push({ id: "setup", name: "Set Up Samsung TV", subtitle: "Pair another TV, or pair this one again", icon: G.remote, keywords: ["samsung", "tv", "pair"], actions: [{ id: "setup", title: "Set up" }] });
  return rows;
}

export const noTv = (why: string): Item[] => [hint("away", why, "Enter tries again; the remote shows more", { icon: G.wifiOff, actions: [{ id: "retry", title: "Try again" }] })];
