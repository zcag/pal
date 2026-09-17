// Writes app/src/gallery/shots/shortcuts.json, the store screenshots'
// fixture: rows shaped as `row()` in index.ts shapes them, from made-up
// shortcuts in three folders (nothing is read from this Mac), plus the
// Run with text form the shot opens. `bun run extensions/shortcuts/fixture.ts`,
// then `node app/scripts/shots.mjs shortcuts`.
import { writeFileSync } from "node:fs";
import manifest from "./pal.json" with { type: "json" };

const ICON = "\u{f040b}";
const ACTIONS = [
  { id: "run", title: "Run" }, { id: "clipboard", title: "Run with clipboard" }, { id: "text", title: "Run with text…", shortcut: "cmd+t" },
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
  detail: { metadata: [{ label: "Name", value: name }, ...(folder ? [{ label: "Folder", value: folder }] : []), { label: "Identifier", value: identifier(i) }] },
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
    "1-list": { palette: "shortcuts", keys: ["down*3"] },
    "2-actions": { palette: "shortcuts", keys: ["down*3", "cmd+k"] },
    "3-root": { keys: ["type:lights"] },
    "4-form": { palette: "shortcuts", keys: ["down*7", "cmd+t", "type:Shipped the settings window; reviewing PRs after lunch"] },
  },
};
writeFileSync(new URL("../../app/src/gallery/shots/shortcuts.json", import.meta.url), JSON.stringify(fixture, null, 2) + "\n");
console.log("wrote app/src/gallery/shots/shortcuts.json");
