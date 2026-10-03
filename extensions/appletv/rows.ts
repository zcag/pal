// The list palettes' rows, pure (the fixture builds the store shots from
// these): an app with its icon, the commands at the root, a user account.
// Every row names the Apple TV it acts on, so with two paired the root
// never leaves you guessing which one a key goes to.
import { hint, type Action, type Item } from "@zcag/pal";
import { G } from "./remote.ts";
import type { Account, App } from "./types.ts";

export const NAME = "appletv";

/** The row every palette shows while nothing is paired. */
export const SETUP_ROW: Item = { id: "setup", name: "Set Up Apple TV", subtitle: "Find the Apple TV on this network and pair with the code it shows", icon: G.remote, actions: [{ id: "setup", title: "Set up" }] };

export const APP_ACTIONS = (inDock: boolean): Action[] => [
  { id: "launch", title: "Open on the TV" },
  { id: "launch:remote", title: "Open, then show the remote", shortcut: "cmd+enter" },
  { id: "dock", title: inDock ? "Remove from the dock" : "Add to the dock", shortcut: "cmd+d" },
  { id: "copy", title: "Copy the bundle id", shortcut: "cmd+c" },
];

export function appRow(a: App, art: string, o: { device: string; front?: boolean; dock?: number }): Item {
  return {
    id: a.id,
    name: a.name,
    subtitle: o.front ? `In front on ${o.device}` : `Open on ${o.device}`,
    icon: { image: art },
    keywords: [a.id.split(".").pop() ?? a.id],
    accessories: [...(o.front ? [{ tag: "in front", color: "green" as const }] : []), ...(o.dock !== undefined ? [{ keys: String(o.dock + 1) }] : [])],
    actions: APP_ACTIONS(o.dock !== undefined),
  };
}

type Cmd = { id: string; name: string; icon: string; keywords?: string[] };

/** The commands that make sense as root rows: what a remote's buttons do, plus typing. */
export const COMMANDS: Cmd[] = [
  { id: "play-pause", name: "Play or Pause", icon: G.playPause, keywords: ["resume", "stop"] },
  { id: "wake", name: "Wake Up", icon: G.power, keywords: ["turn on", "power"] },
  { id: "sleep", name: "Sleep", icon: G.sleep, keywords: ["turn off", "power", "off"] },
  { id: "home", name: "Go Home", icon: G.home, keywords: ["home screen", "tv button"] },
  { id: "control-center", name: "Control Center", icon: G.apps },
  { id: "screensaver", name: "Start the Screen Saver", icon: G.screensaver, keywords: ["aerial"] },
  { id: "skip-forward", name: "Skip Forward", icon: G.skipFwd },
  { id: "skip-back", name: "Skip Back", icon: G.skipBack, keywords: ["rewind"] },
  { id: "next", name: "Next", icon: G.next, keywords: ["chapter", "track"] },
  { id: "previous", name: "Previous", icon: G.prev, keywords: ["chapter", "track"] },
  { id: "volume-up", name: "Volume Up", icon: G.volUp, keywords: ["louder"] },
  { id: "volume-down", name: "Volume Down", icon: G.volDown, keywords: ["quieter"] },
  { id: "users", name: "Switch User", icon: G.switchUser, keywords: ["account", "profile"] },
];

export function commandRows(device: string, others: string[]): Item[] {
  const rows: Item[] = COMMANDS.map((c) => ({ id: c.id, name: c.name, subtitle: device, icon: c.icon, keywords: ["apple tv", ...(c.keywords ?? [])], actions: [{ id: "run", title: c.name }] }));
  rows.splice(6, 0, {
    id: "type", name: "Type on Apple TV", subtitle: `Into the text field ${device} shows`, icon: G.keyboard, keywords: ["apple tv", "search", "keyboard", "text"],
    args: [{ id: "text", placeholder: "Text", required: true }],
    actions: [{ id: "type", title: "Type it", args: true }, { id: "type:append", title: "Add to what is there", shortcut: "cmd+enter", args: true }],
  });
  for (const o of others) rows.push({ id: `device:${o}`, name: `Switch to ${o}`, subtitle: "Make it the Apple TV the remote and these commands control", icon: G.tv, keywords: ["apple tv"], actions: [{ id: "run", title: `Switch to ${o}` }] });
  rows.push({ id: "setup", name: "Set Up Apple TV", subtitle: "Pair another Apple TV, or pair this one again", icon: G.remote, keywords: ["apple tv", "pair"], actions: [{ id: "setup", title: "Set up" }] });
  return rows;
}

export function accountRow(a: Account, device: string): Item {
  return {
    id: a.id, name: a.name, subtitle: a.current ? `Signed in on ${device}` : `Switch ${device} to ${a.name}`, icon: G.account,
    accessories: a.current ? [{ tag: "current", color: "green" }] : [],
    actions: a.current ? [] : [{ id: "switch", title: `Switch to ${a.name}` }],
  };
}

export const noTv = (why: string): Item[] => [hint("away", why, "Enter tries again; the remote shows more", { icon: G.wifiOff, actions: [{ id: "retry", title: "Try again" }] })];
