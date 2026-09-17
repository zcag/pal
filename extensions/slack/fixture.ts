// Writes app/src/gallery/shots/bar-slack.json: the store screenshots'
// fixture for the bar item, the popover's tree from view.ts over a made-up
// inbox (names and messages are this file's; the avatars are SVG initials
// drawn here, since the gallery has no Slack). `bun run
// extensions/slack/fixture.ts`, then `node app/scripts/shots.mjs bar slack`.
import { writeFileSync } from "node:fs";
import { render, type BarRow, type BarState } from "./view.ts";

/** An avatar: a coloured square with the initial, as SVG. */
const avatar = (bg: string, letter: string) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${bg}"/><text x="32" y="42" font-family="system-ui" font-size="32" font-weight="700" fill="#fff" text-anchor="middle">${letter}</text></svg>`)}`;

const rows: BarRow[] = [
  { id: "dm:T1/D_MARA", kind: "dm", where: "Mara", text: "can you look at the parser before standup? the tests are green now", time: "09:41", n: 3, more: false, avatar: avatar("#8b5cf6", "M"), dot: "green", canReply: true, canRead: true },
  { id: "dm:T1/D_TOMAS", kind: "dm", where: "Tomas", text: "📎 release-notes-0.4.md", time: "09:12", n: 1, more: false, avatar: avatar("#0ea5e9", "T"), dot: "grey", canReply: true, canRead: true },
  { id: "mention:T1/C_ENG", kind: "mention", where: "#eng", who: "Lina", text: "@cagdas the build on #ops is red since the runner image bump", time: "08:55", n: 1, more: false, avatar: avatar("#f59e0b", "L"), canReply: true, canRead: true },
  { id: "mention:T1/C_DESIGN", kind: "mention", where: "#design", who: "Ola", text: "@channel review the new empty states by Friday", time: "Yesterday", n: 2, more: true, canReply: true, canRead: true },
  { id: "thread:T1/C_PRODUCT", kind: "thread", where: "#product", text: "", time: "08:30", n: 4, more: false, canReply: false, canRead: false },
];
const quiet = [
  { id: "channel:T1/C_SUPPORT", name: "#support" },
  { id: "channel:T1/C_GENERAL", name: "#general" },
  { id: "channel:T1/C_OPSPRIV", name: "#ops-oncall" },
  { id: "channel:T1/C_RANDOM", name: "#random" },
  { id: "channel:T1/C_INFRA", name: "#infra" },
  { id: "channel:T1/C_HIRING", name: "#hiring" },
];
const inbox: BarState = { rows, quiet, quietTotal: quiet.length, focus: 0 };
const replying: BarState = { ...inbox, replying: "dm:T1/D_MARA", draft: "" };

const bar = {
  key: "slack/unreads",
  title: "Unreads",
  item: {
    icon: "\u{f04b1}",
    badge: 8,
    urgent: true,
    tooltip: "3 direct messages, 2 mentions, 4 thread replies; 6 channels unread",
    refresh: 120,
    menu: { view: render(inbox) },
  },
  states: [
    { id: "calm", item: { badge: 4, urgent: false, tooltip: "4 thread replies; 6 channels unread" } },
    { id: "stale", item: { stale: true, tooltip: "3 direct messages, 2 mentions, 4 thread replies; 6 channels unread (stale)" } },
    { id: "reply", item: { menu: { view: render(replying) } } },
    { id: "zero", item: { badge: undefined, urgent: false, tooltip: "Nothing addressed to you; 6 channels unread", menu: { view: render({ rows: [], quiet, quietTotal: quiet.length, focus: 0 }) } } },
  ],
  shots: {
    "bar-menubar-dark": { target: "menubar", theme: "dark", caption: "On the menu bar: the Slack glyph with the count of what is addressed to you, red while a direct message waits" },
    "bar-menubar-light": { target: "menubar", theme: "light", caption: "The same item on a light menu bar" },
    "bar-menubar-popover": { target: "menubar", theme: "light", popover: true, caption: "A click opens the popover: direct messages, mentions and thread replies with the sender, the message and the time, the channels also unread, the keys" },
    "bar-menubar-popover-dark": { target: "menubar", theme: "dark", popover: true, caption: "The popover in the dark theme" },
    "bar-menubar-popover-reply": { target: "menubar", theme: "light", popover: true, state: "reply", caption: "r turns the search row into a reply field; Enter posts it to the conversation" },
    "bar-sketchybar": { target: "sketchybar", theme: "dark", caption: "On sketchybar: the glyph and the count, red while a direct message waits" },
  },
};
writeFileSync(new URL("../../app/src/gallery/shots/bar-slack.json", import.meta.url), JSON.stringify(bar) + "\n");
console.log(`bar-slack.json: ${rows.length} rows, ${quiet.length} quiet channels`);
