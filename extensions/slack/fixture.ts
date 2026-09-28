// Writes app/src/gallery/shots/bar-slack.json: the store screenshots'
// fixture for the bar item, the popover's tree from view.ts over a made-up
// inbox (names and messages are this file's; the avatars are SVG initials
// drawn here, since the gallery has no Slack), at fixture-kit's clock; the
// badge and the tooltip are counted from the rows as index.ts counts them.
// `make shots EXT=slack`. The panel's slack.json is written by hand.
import { when } from "@zcag/pal";
import { NOW, pinClock, writeFixture } from "../../app/scripts/fixture-kit.ts";
import { render, type BarRow, type BarState } from "./view.ts";

pinClock();
/** A row's time as index.ts writes it (`when`), `min` minutes before the clock. */
const ago = (min: number) => when(NOW - min * 60_000, NOW);

/** An avatar: a coloured square with the initial, as SVG. */
const avatar = (bg: string, letter: string) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${bg}"/><text x="32" y="42" font-family="system-ui" font-size="32" font-weight="700" fill="#fff" text-anchor="middle">${letter}</text></svg>`)}`;

const rows: BarRow[] = [
  { id: "dm:T1/D_MARA", kind: "dm", where: "Mara", text: "the tests are green now, only the fixture for the empty run is missing", time: ago(11), n: 2, more: false, avatar: avatar("#8b5cf6", "M"), dot: "green", canReply: true, canRead: true },
  { id: "dm:T1/D_TOMAS", kind: "dm", where: "Tomas", text: "📎 release-notes-0.4.md", time: ago(40), n: 1, more: false, avatar: avatar("#0ea5e9", "T"), dot: "grey", canReply: true, canRead: true },
  { id: "mention:T1/C_ENG", kind: "mention", where: "#eng", who: "Lina", text: "@alex the build on #ops is red since the runner image bump", time: ago(52), n: 1, more: false, avatar: avatar("#f59e0b", "L"), canReply: true, canRead: true },
  { id: "mention:T1/C_DESIGN", kind: "mention", where: "#design", who: "Ola", text: "@channel review the new empty states by Friday", time: ago(214), n: 1, more: false, canReply: true, canRead: true },
  { id: "thread:T1/C_PRODUCT", kind: "thread", where: "#product", text: "", time: ago(104), n: 4, more: false, canReply: false, canRead: false },
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

/** What index.ts's unreadsItem counts: each kind's messages summed, the badge their total. */
const count = (kind: BarRow["kind"]) => rows.filter((r) => r.kind === kind).reduce((n, r) => n + r.n, 0);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const tooltip = `${plural(count("dm"), "direct message")}, ${plural(count("mention"), "mention")}, ${plural(count("thread"), "thread reply", "thread replies")}; ${plural(quiet.length, "channel")} unread`;

const bar = {
  key: "slack/unreads",
  title: "Unreads",
  item: {
    icon: "\u{f04b1}",
    badge: count("dm") + count("mention") + count("thread"),
    urgent: true,
    tooltip,
    refresh: 120,
    menu: { view: render(inbox) },
  },
  states: [
    { id: "calm", item: { badge: count("thread"), urgent: false, tooltip: `${plural(count("thread"), "thread reply", "thread replies")}; ${plural(quiet.length, "channel")} unread` } },
    { id: "stale", item: { stale: true, tooltip: `${tooltip} (stale)` } },
    { id: "reply", item: { menu: { view: render(replying) } } },
    { id: "zero", item: { badge: undefined, urgent: false, tooltip: `${plural(quiet.length, "channel")} unread`, menu: { view: render({ rows: [], quiet, quietTotal: quiet.length, focus: 0 }) } } },
  ],
  shots: {
    "menubar": { target: "menubar", caption: "On the menu bar: the Slack glyph with the count of what is addressed to you, red while a direct message waits" },
    "popover": { target: "menubar", popover: true, caption: "A click opens the popover: direct messages, mentions and thread replies with the sender, the message and the time, the channels also unread, the keys" },
    "popover-reply": { target: "menubar", popover: true, state: "reply", caption: "r turns the search row into a reply field; Enter posts it to the conversation" },
    "sketchybar": { target: "sketchybar", caption: "On sketchybar: the glyph and the count, red while a direct message waits" },
  },
};
writeFixture("bar-slack", bar);
console.log(`bar-slack.json: ${rows.length} rows, ${quiet.length} quiet channels`);
