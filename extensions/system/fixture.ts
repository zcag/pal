// Writes app/src/gallery/shots/system.json and bar-system.json, the store
// screenshots' fixtures: the palette's rows through the host harness over
// the core's catalogue (core/src/system.rs, every command available), a
// made-up Trash of three files, a dark appearance from a stand-in
// `defaults` and two files marked in Finder; the Keep Awake bar item with
// its popover tree from view.ts over a made-up run at a fixed clock, and
// the strip variants the shots pick. `bun run extensions/system/fixture.ts`,
// then `make shots EXT=system`.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Host, stored, writeTool } from "../../host/test/harness.ts";
import { NOW, pinClock, writeFixture } from "../../app/scripts/fixture-kit.ts";
import type { SystemCommand } from "../../sdk/src/index.ts";
import { fmtLeft, summary, type Awake } from "./awake.ts";
import { DISPLAY_GLYPH, GLYPH, render, type PopoverState } from "./view.ts";
const run = (o: Partial<Awake> = {}): Awake => ({ pid: 4242, started: NOW - 35 * 60_000, until: NOW + 25 * 60_000, display: false, ...o });
const state = (awake: Awake | null, extra: Partial<PopoverState> = {}): PopoverState => ({ awake, now: NOW, presets: ["30m", "1h", "2h", "forever"], display: awake?.display ?? true, defaultFor: "1h", field: false, tool: true, ...extra });

/** What index.ts `barItem` answers for a run (its title, tooltip and display mark), the popover over the state given; `color` is the manifest's `ending` rule the core lays on. */
const item = (a: Awake, extra: Partial<PopoverState> = {}) => {
  const left = a.until === null ? null : a.until - NOW;
  return {
    icon: GLYPH, title: left === null ? "∞" : fmtLeft(left), tooltip: `Awake ${summary(a, NOW)}`,
    ...(a.display && { segments: [{ id: "display", icon: DISPLAY_GLYPH, color: "muted", tooltip: "Display kept awake too" }] }),
    ...(left !== null && left <= 5 * 60_000 && { color: "amber" }),
    menu: { view: render(state(a, extra)) },
  };
};

const bar = {
  key: "system/awake",
  title: "Keep Awake",
  item: item(run()),
  states: [
    { id: "forever", item: item(run({ until: null, display: true })) },
    { id: "display", item: item(run({ until: NOW + 119 * 60_000, started: NOW - 60_000, display: true })) },
    { id: "app", item: item(run({ until: null, app: "Xcode" })) },
    { id: "ending", item: item(run({ until: NOW + 4 * 60_000 })) },
    // Off: what `show = "always"` keeps, muted; the popover on the presets.
    { id: "off", item: { hidden: true, empty: { icon: GLYPH, tooltip: "Not kept awake" }, menu: { view: render(state(null)) } } },
    // The field open (`u`).
    { id: "field", item: item(run(), { field: true }) },
  ],
  shots: {
    "menubar": { target: "menubar", caption: "On the menu bar: a coffee and what is left of the run" },
    "menubar-display": { target: "menubar", state: "display", caption: "The display kept awake too: a monitor mark after the countdown" },
    "popover": { target: "menubar", popover: true, caption: "A click opens the popover: the run on a card with the time left and a bar, the presets on the digits, the display switch, Enter allows sleep" },
    "popover-forever": { target: "menubar", popover: true, state: "forever", caption: "Until turned off: ∞ on the strip and the card; a preset gives it an end" },
    "popover-field": { target: "menubar", popover: true, state: "field", caption: "u opens the field: 45m, 14:30 or forever, then Enter" },
    "sketchybar": { target: "sketchybar", caption: "On sketchybar: the coffee and the countdown as the label" },
  },
};
writeFixture("bar-system", bar);

// ---- the palette ---------------------------------------------------------------------

/** The core's catalogue as core/src/system.rs lists it, every command available on this made-up Mac. */
const SPECS: [string, string, string, string, string[], boolean][] = [
  ["sleep", "Sleep", "Put the machine to sleep", "⏾", ["suspend", "standby", "nap"], false],
  ["sleep-displays", "Sleep Displays", "Turn the screens off", "◒", ["screen", "display", "off", "dim"], false],
  ["lock", "Lock Screen", "Lock and ask for the password", "⚿", ["secure", "away", "afk"], false],
  ["logout", "Log Out", "End the session", "⇤", ["sign out", "exit", "session"], true],
  ["restart", "Restart", "Restart the machine", "↻", ["reboot", "reset"], true],
  ["shutdown", "Shut Down", "Power the machine off", "⏻", ["power off", "halt", "off"], true],
  ["empty-trash", "Empty Trash", "Delete everything in the trash", "⌫", ["bin", "delete", "recycle"], true],
  ["dark-mode", "Toggle Dark Mode", "Switch between light and dark appearance", "◐", ["theme", "light", "appearance", "night"], false],
  ["volume-up", "Volume Up", "Output volume up 10%", "♫", ["louder", "sound", "audio"], false],
  ["volume-down", "Volume Down", "Output volume down 10%", "♪", ["quieter", "sound", "audio"], false],
  ["volume-mute", "Toggle Mute", "Mute or unmute the output", "♩", ["silence", "sound", "audio", "unmute"], false],
  ["brightness-up", "Brightness Up", "Display brightness up 10%", "☀", ["brighter", "screen", "display"], false],
  ["brightness-down", "Brightness Down", "Display brightness down 10%", "☼", ["dimmer", "screen", "display"], false],
  ["dnd", "Toggle Do Not Disturb", "Silence notifications, or let them through again", "⊘", ["focus", "notifications", "quiet", "silent"], false],
  ["eject-all", "Eject All Disks", "Unmount every external disk and disk image", "⏏", ["unmount", "usb", "drive", "volume"], false],
  ["show-desktop", "Show Desktop", "Move every window aside", "▦", ["hide windows", "expose", "mission control"], false],
  ["keep-awake", "Keep Awake", "Stop the machine and display from sleeping until turned off", "☕", ["caffeinate", "insomnia", "no sleep", "inhibit", "allow sleep"], false],
  ["quit-all", "Quit All Apps", "Quit every open app but Finder and pal", "⌧", ["close all", "quit everything", "apps", "clean"], true],
  ["unhide-all", "Unhide All Apps", "Show every hidden app again", "◫", ["show all", "hidden", "unhide", "apps"], false],
  ["dismiss-notifications", "Dismiss Notifications", "Clear every notification on screen", "⌦", ["clear all", "notification center", "banners", "alerts"], false],
];
const COMMANDS: SystemCommand[] = SPECS.map(([id, title, subtitle, icon, keywords, destructive]) => ({ id, title, subtitle, icon, keywords, destructive, available: true }));

pinClock();
const dir = mkdtempSync(join(tmpdir(), "pal-system-fixture-"));
const trash = join(dir, "Trash");
mkdirSync(trash);
for (const f of ["draft-v2.key", "IMG_0412.HEIC", "old-invoices.zip"]) writeFileSync(join(trash, f), "");
writeTool(join(dir, "bin", "defaults"), "#!/bin/sh\necho Dark\n");
// A caffeinate that is never run (no run is on): Keep Awake's row needs a tool to offer.
writeTool(join(dir, "bin", "caffeinate"), "#!/bin/sh\nexit 0\n");
const saved = { PATH: process.env.PATH, PAL_TRASH_DIR: process.env.PAL_TRASH_DIR, PAL_AWAKE_TOOL: process.env.PAL_AWAKE_TOOL };
process.env.PATH = `${join(dir, "bin")}:${process.env.PATH}`;
process.env.PAL_TRASH_DIR = trash;
process.env.PAL_AWAKE_TOOL = join(dir, "bin", "caffeinate");
stored.clear();
const host = await Host.bundled({ core: {
  "system.commands": () => COMMANDS,
  "selection.files": () => ["/Users/alex/Desktop/floor-plan.pdf", "/Users/alex/Desktop/kitchen-sketch.png"],
  "states.get": ({ name }: { name?: string }) => (name === "front_app" ? "com.apple.finder" : null),
} });
Object.assign(process.env, saved);
try {
  const meta = host.loaded().find((l) => l.extension === "system")!.palettes[0];
  const items = await host.list("system", "system");
  const at = (id: string) => items.findIndex((i) => i.id === id);
  writeFixture("system", {
    palettes: { system: { title: meta.title, icon: meta.icon, live: true, placeholder: meta.placeholder, items } },
    shots: {
      "1-list": { palette: "system", keys: [`down*${at("dark-mode")}`], caption: "The commands this machine can run; the appearance and the Trash count on the right" },
      "2-root": { keys: ["type:caffeinate"], caption: "caffeinate at the root finds Keep Awake: the rows are indexed with their keywords" },
      "3-confirm": { palette: "system", keys: [`down*${at("shutdown")}`, "enter"], caption: "A destructive command asks first" },
      "4-apps": { palette: "system", keys: [`down*${at("quick-look-selection")}`], caption: "Quit All Apps (asks first), Unhide All Apps, Dismiss Notifications, and Quick Look on what is marked in Finder" },
    },
  });
  console.log(`system.json: ${items.length} rows; bar-system.json: a run with 25 minutes left, until turned off, the display too, an app to follow, the last minutes, off, the field open`);
} finally {
  host.kill();
  rmSync(dir, { recursive: true, force: true });
}
