// Writes app/src/gallery/shots/bar-github.json: the store screenshots'
// fixture for the bar item, its popover tree from view.ts over a made-up
// inbox (the names are this file's, not a real account's). `bun run
// extensions/github/fixture.ts`, then `node app/scripts/shots.mjs bar github`.
import { writeFileSync } from "node:fs";
import type { Notification } from "./data.ts";
import { render } from "./view.ts";

const NOW = Date.parse("2026-09-16T14:32:00Z");
const at = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const n = (id: string, repo: string, type: string, reason: string, title: string, minutesAgo: number, path: string): Notification =>
  ({ kind: "notification", id: `thread:${id}`, thread: id, title, repo, reason, type, url: `https://github.com/${repo}/${path}`, updatedAt: at(minutesAgo) });

const INBOX: Notification[] = [
  n("1", "zcag/pal", "PullRequest", "review_requested", "Retry the index build on a host restart", 12, "pull/418"),
  n("2", "zcag/pal", "Issue", "mention", "Settings window loses the hotkey field on tab switch", 47, "issues/402"),
  n("3", "zcag/pal", "PullRequest", "ci_activity", "Bar popovers as view levels", 130, "pull/415"),
  n("4", "zcag/tela", "Release", "subscribed", "v0.4.0", 60 * 5, "releases/tag/v0.4.0"),
  n("5", "zcag/pal-site", "Discussion", "author", "Should the store show bar items separately from palettes?", 60 * 9, "discussions/12"),
  n("6", "zcag/dek", "PullRequest", "assign", "Bump serde_json to 1.0.145", 60 * 26, "pull/88"),
  n("7", "oven-sh/bun", "Issue", "comment", "fs.watch drops events on APFS when the directory is renamed", 60 * 24 * 3, "issues/21044"),
];
const ONE: Notification[] = [INBOX[1]];

const bar = {
  key: "github/notifications",
  title: "Notifications",
  item: {
    icon: "\u{f09b}",
    badge: INBOX.length,
    tooltip: `${INBOX.length} unread notifications`,
    menu: { view: render({ list: INBOX, cursor: 0, now: NOW }) },
  },
  states: [
    { id: "dot", item: { badge: "dot", tooltip: "1 unread notification", menu: { view: render({ list: ONE, cursor: 0, now: NOW }) } } },
    { id: "stale", item: { stale: true, tooltip: `${INBOX.length} unread notifications (stale)` } },
    { id: "work", item: { menu: { view: render({ list: INBOX.slice(0, 4), cursor: 2, now: NOW, account: "Work" }) } } },
  ],
  shots: {
    "bar-menubar-dark": { target: "menubar", theme: "dark", caption: "On the menu bar: the GitHub glyph with the unread count as a red badge" },
    "bar-menubar-light": { target: "menubar", theme: "light", caption: "The same item on a light menu bar" },
    "bar-menubar-popover": { target: "menubar", theme: "light", popover: true, caption: "A click opens the popover: the unread threads by repository with their reason and age; Enter opens one, m marks it read, a marks all read" },
    "bar-menubar-popover-dark": { target: "menubar", theme: "dark", popover: true, state: "work", caption: "The same popover in the dark theme, on a second account named Work, the cursor on a thread" },
    "bar-sketchybar": { target: "sketchybar", theme: "dark", caption: "On sketchybar: the glyph and the count in red on the label" },
  },
};
writeFileSync(new URL("../../app/src/gallery/shots/bar-github.json", import.meta.url), JSON.stringify(bar) + "\n");
console.log(`${INBOX.length} threads in the inbox, ${new Set(INBOX.map((x) => x.repo)).size} repositories`);
