// Writes app/src/gallery/shots/bar-github.json: the store screenshots'
// fixture for the bar item, its popover tree from view.ts over a made-up
// inbox (the repositories are the panel fixture's acme/* and a few public
// projects', not a real account's) at the kit's clock. `make shots EXT=github`.
import { NOW, writeFixture } from "../../app/scripts/fixture-kit.ts";
import type { Notification } from "./data.ts";
import { render } from "./view.ts";

const at = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const n = (id: string, repo: string, type: string, reason: string, title: string, minutesAgo: number, path: string): Notification =>
  ({ kind: "notification", id: `thread:${id}`, thread: id, title, repo, reason, type, url: `https://github.com/${repo}/${path}`, updatedAt: at(minutesAgo) });

const INBOX: Notification[] = [
  n("1", "acme/api", "PullRequest", "review_requested", "Retry the webhook delivery with backoff", 12, "pull/517"),
  n("2", "acme/widgets", "Issue", "mention", "Search loses the cursor when rows stream in", 47, "issues/201"),
  n("3", "acme/widgets", "PullRequest", "ci_activity", "Batch the index writes on startup", 130, "pull/142"),
  n("4", "acme/widgets-cli", "Release", "subscribed", "v0.4.0", 60 * 5, "releases/tag/v0.4.0"),
  n("5", "acme/docs", "Discussion", "author", "Should the guides and the API reference share one sidebar?", 60 * 9, "discussions/12"),
];
const ONE: Notification[] = [INBOX[1]];
/** A second account's inbox: the same shape over other repositories. */
const WORK: Notification[] = [
  n("11", "acme/infra", "PullRequest", "review_requested", "Move staging to the new node pool", 8, "pull/64"),
  n("12", "acme/api", "Issue", "assign", "Rate limit headers are not surfaced", 35, "issues/530"),
  n("13", "acme/api", "PullRequest", "ci_activity", "Retry the webhook delivery with backoff", 95, "pull/517"),
  n("14", "acme/billing", "Issue", "mention", "Invoices round the tax twice for EUR", 60 * 4, "issues/77"),
];

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
    { id: "work", item: { badge: WORK.length, tooltip: `${WORK.length} unread notifications (Work)`, menu: { view: render({ list: WORK, cursor: 2, now: NOW, account: "Work" }) } } },
  ],
  shots: {
    "menubar": { target: "menubar", caption: "On the menu bar: the GitHub glyph with the unread count beside it" },
    "popover": { target: "menubar", popover: true, caption: "A click opens the popover: the unread threads by repository with their reason and age; Enter opens one, m marks it read, a marks all read" },
    "popover-work": { target: "menubar", popover: true, state: "work", caption: "A second account, named Work, gets its own crumb; the arrows walk the threads and the footer names what Enter does" },
    "sketchybar": { target: "sketchybar", caption: "On sketchybar: the glyph with the unread count as its label" },
  },
};
writeFixture("bar-github", bar);
console.log(`${INBOX.length} threads in the inbox, ${new Set(INBOX.map((x) => x.repo)).size} repositories`);
