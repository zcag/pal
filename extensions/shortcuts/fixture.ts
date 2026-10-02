// Writes app/src/gallery/shots/shortcuts.json, the store screenshots'
// fixture: rows shaped as `row()` in index.ts shapes them, from made-up
// shortcuts in three folders (nothing is read from this Mac), plus the
// Run with input form the shot opens. `bun run extensions/shortcuts/fixture.ts`,
// then `node app/scripts/shots.mjs shortcuts`.
import { pinClock, writeFixture } from "../../app/scripts/fixture-kit.ts";
import manifest from "./pal.json" with { type: "json" };

// No host and nothing timed here; pinned all the same, so a row that ever shows a time shows the strip's.
pinClock();

const ICON = "\u{f040b}";
const ACTIONS = [
  { id: "run", title: "Run" }, { id: "clipboard", title: "Run with clipboard" }, { id: "text", title: "Run with input", shortcut: "cmd+t" },
  { id: "open", title: "Open in Shortcuts", shortcut: "cmd+o" }, { id: "copy", title: "Copy name", shortcut: "cmd+c" },
];
const SHORTCUTS: [string, string | undefined][] = [
  ["Open Today's Note", undefined], ["Adjust Clipboard", undefined], ["Text to Speech", undefined],
  ["Lights On", "Home"], ["Lights Off", "Home"], ["Movie Night", "Home"], ["Good Morning", "Home"],
  ["Standup Notes", "Work"], ["Log Hours", "Work"], ["Start Focus", "Work"],
  ["Resize to 1080p", "Media"], ["Make GIF", "Media"], ["Strip Metadata", "Media"],
];
const identifier = (i: number) => `${(0x1a2b3c4d + i * 0x1111).toString(16).toUpperCase().padStart(8, "0")}-4F1E-4C3B-9A2D-${(0x5a6b7c8d9e0f + i).toString(16).toUpperCase()}`;
const items = SHORTCUTS.map(([name, folder], i) => ({
  id: name, name, icon: ICON, section: folder || "No folder", keywords: folder ? [folder] : undefined,
  detail: { caption: folder ? `Shortcuts · ${folder}` : "Shortcuts", title: name, metadata: [{ label: "Identifier", value: identifier(i) }] },
  actions: ACTIONS,
}));

const fixture = {
  palettes: { shortcuts: { title: "Shortcuts", icon: manifest.icon, tier: "primary", placeholder: "Search shortcuts by name or folder", items } },
  effects: {
    "shortcuts/Standup Notes:text": { form: {
      id: "Standup Notes", title: "Run Standup Notes",
      fields: [{ kind: "textarea", id: "input", label: "Input", required: true, placeholder: "What the shortcut receives as its input", description: "Given to the shortcut as a text file; a shortcut that takes no input ignores it." }],
      submit: { id: "run_text", title: "Run" },
    } },
  },
  shots: {
    "1-list": { palette: "shortcuts", keys: ["wait:300", "down*3"], caption: "Every Apple Shortcut on this Mac, grouped by its folder and searchable by name or folder" },
    "2-actions": { palette: "shortcuts", keys: ["wait:300", "down*3", "cmd+k"], caption: "Run it as it is, on the clipboard or on text you type, or open it in Shortcuts to edit" },
    "3-root": { keys: ["wait:300", "type:lights"], caption: "No need to open the palette: a shortcut's name typed at the root finds it" },
    "4-form": { palette: "shortcuts", keys: ["wait:300", "down*7", "cmd+t", "wait:300", "type:Shipped the settings window; reviewing PRs after lunch"], caption: "Run with input: type what the shortcut receives, here the notes a Standup shortcut files" },
  },
};
writeFixture("shortcuts", fixture);
console.log("wrote app/src/gallery/shots/shortcuts.json");
