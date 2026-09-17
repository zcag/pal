// The Notifications bar popover as a tree (`View` in `@zcag/pal`), pure:
// the fixture renders a made-up inbox with this same function. 420 wide
// (`ctx.compact`): the unread threads grouped by repository, newest
// repository first, each thread a row with a colour rail for its
// subject's type, the title cut to the width, a reason badge and the age;
// the row the keys are on wears the accent ring and a click on a row
// moves the ring there. `ROWS` threads at most, then one muted line
// saying how many more the palette lists. Under everything a row of key
// hints; nothing unread is "All caught up".
import { POPOVER_W, column, keyHint, row, text, type Action, type TagColor, type View, type ViewNode } from "@zcag/pal";
import type { Notification } from "./data.ts";

export type NotifState = {
  /** Unread, in the order GitHub gave (any order: the view sorts). */
  list: Notification[];
  /** The row the keys act on: an index into the shown rows. */
  cursor: number;
  /** For the ages. */
  now: number;
  /** The instance's title, when it has one ("Work"): on the view's title. */
  account?: string;
};

/** What fits under the popover's 480 px cap, in rows: a thread is one, a repository header `HEADER` of one; six threads of one repository, five over five. The rest is one line and the palette. */
export const ROWS = 6.5, HEADER = 0.45;
/** A row's inside: its padding (2 steps a side), the type rail, the age column and the gaps between them. */
const RAIL_W = 4, RAIL_H = 30, AGE_W = 36, ROW_PAD = 8, GAP = 8;
const TITLE_W = POPOVER_W - ROW_PAD - RAIL_W - GAP - AGE_W - GAP;

/** The subject's type as a colour rail at the row's edge (GitHub's colours for the open state, since the inbox does not say the state) and a word in the meta row. */
const TYPES: Record<string, { color: TagColor; tag: string }> = {
  PullRequest: { color: "green", tag: "pull request" },
  Issue: { color: "green", tag: "issue" },
  Release: { color: "blue", tag: "release" },
  Discussion: { color: "violet", tag: "discussion" },
  Commit: { color: "grey", tag: "commit" },
  CheckSuite: { color: "amber", tag: "checks" },
  RepositoryVulnerabilityAlert: { color: "red", tag: "security" },
};
const TYPE_DEFAULT = { color: "grey" as TagColor, tag: "" };

/** Every reason the notifications API sends (docs: "About notification reasons"), as a short badge in a colour that says how much it is about you. */
export const REASONS: Record<string, { text: string; color: TagColor }> = {
  mention: { text: "mention", color: "red" },
  team_mention: { text: "team mention", color: "red" },
  review_requested: { text: "review", color: "violet" },
  assign: { text: "assigned", color: "blue" },
  author: { text: "yours", color: "grey" },
  comment: { text: "comment", color: "grey" },
  subscribed: { text: "subscribed", color: "grey" },
  state_change: { text: "state", color: "amber" },
  ci_activity: { text: "CI", color: "amber" },
  security_alert: { text: "security", color: "red" },
  manual: { text: "subscribed", color: "grey" },
  invitation: { text: "invited", color: "blue" },
  member_feature_requested: { text: "request", color: "blue" },
  security_advisory_credit: { text: "credit", color: "green" },
  approval_requested: { text: "approval", color: "violet" },
};


/** `now`, `4m`, `2h`, `3d`, `2w`, `5mo`: the age of an ISO time at `now`. */
export function ago(iso: string, now: number): string {
  const s = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000));
  if (s < 60) return "now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  if (d < 30) return `${Math.floor(d / 7)}w`;
  if (d < 365) return `${Math.floor(d / 30)}mo`;
  return `${Math.floor(d / 365)}y`;
}

/**
 * The threads the popover shows, in order: newest first, grouped by
 * repository in the order of each repository's newest thread, cut where
 * the rows and their headers would pass `ROWS`. The cursor and the
 * actions index into this.
 */
export function shown(list: Notification[]): Notification[] {
  const newest = list.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const repos: string[] = [];
  for (const n of newest) if (!repos.includes(n.repo)) repos.push(n.repo);
  const out: Notification[] = [];
  let cost = 0, repo = "";
  for (const n of repos.flatMap((r) => newest.filter((x) => x.repo === r))) {
    cost += 1 + (n.repo !== repo ? HEADER : 0);
    if (cost > ROWS) break;
    repo = n.repo;
    out.push(n);
  }
  return out;
}

function threadRow(n: Notification, focused: boolean, st: NotifState): ViewNode {
  const t = TYPES[n.type] ?? TYPE_DEFAULT;
  const reason = REASONS[n.reason];
  const meta: ViewNode[] = [];
  if (reason) meta.push({ type: "badge", key: "reason", text: reason.text, color: reason.color });
  if (t.tag) meta.push(text(t.tag, { size: "xs", color: "faint" }));
  return row(
    [
      { type: "tile", key: "rail", width: RAIL_W, height: RAIL_H, color: t.color, fill: "solid" },
      column([text(n.title, { size: "md", weight: focused ? "semibold" : "medium", width: TITLE_W }), row(meta, { key: "meta", gap: 1, minHeight: 16 })], { key: "body", gap: 0, grow: true }),
      text(ago(n.updatedAt, st.now), { style: "mono", size: "xs", color: "muted", width: AGE_W, align: "end" }),
    ],
    { key: n.id, padding: 1, radius: true, action: `focus:${n.id}`, ...(focused && { selected: true }), transition: { enter: "fade", exit: "fade" } },
  );
}

function repoHeader(repo: string, count: number): ViewNode {
  return row([text(repo, { size: "xs", weight: "semibold", color: "muted", width: POPOVER_W - 48 }), { type: "spacer" }, { type: "badge", key: "n", text: String(count), color: "grey" }], { key: `repo:${repo}`, gap: 1, minHeight: 18, padding: 0 });
}

function hints(): ViewNode {
  return row([...keyHint(["enter"], "open"), ...keyHint(["m"], "read"), ...keyHint(["a"], "all read"), ...keyHint(["p"], "in pal"), ...keyHint(["up", "down"], "move")], { key: "hints", gap: 1, minHeight: 22 });
}

function empty(): ViewNode {
  return column(
    [
      { type: "tile", key: "tile", width: 48, height: 48, text: "", color: "green", fill: "soft" },
      text("All caught up", { style: "title", size: "lg" }),
      text("Nothing unread on GitHub", { style: "muted", size: "sm", align: "center" }),
    ],
    { key: "empty", padding: 5, gap: 2, align: "center", justify: "center" },
  );
}

/** Every action the popover answers to; the first listed is Enter. The per-row focus actions are hidden, reached by a click on the row. */
export function actions(st: NotifState): Action[] {
  const rows = shown(st.list);
  const list: Action[] = rows.length
    ? [
      { id: "open", title: "Open on GitHub", shortcut: "o" },
      { id: "read", title: "Mark read", shortcut: "m" },
      { id: "read-all", title: "Mark all read", shortcut: ["a", "cmd+shift+a"], style: "destructive" },
      { id: "pal", title: "Open in pal", shortcut: "p" },
      { id: "copy", title: "Copy URL", shortcut: "cmd+c" },
      { id: "down", title: "Next", shortcut: ["down", "j"], hidden: true },
      { id: "up", title: "Previous", shortcut: ["up", "k"], hidden: true },
      ...rows.map((n): Action => ({ id: `focus:${n.id}`, title: `Focus ${n.title}`, hidden: true })),
    ]
    : [{ id: "pal", title: "Open in pal", shortcut: "p" }, { id: "site", title: "Open github.com/notifications", shortcut: "o" }];
  return list;
}

export function render(st: NotifState): View {
  const rows = shown(st.list);
  const cursor = Math.min(Math.max(0, st.cursor), Math.max(0, rows.length - 1));
  const kids: ViewNode[] = [];
  if (!rows.length) kids.push(empty());
  else {
    let repo = "";
    rows.forEach((n, i) => {
      if (n.repo !== repo) { repo = n.repo; kids.push(repoHeader(repo, st.list.filter((x) => x.repo === repo).length)); }
      kids.push(threadRow(n, i === cursor, st));
    });
    const more = st.list.length - rows.length;
    if (more > 0) kids.push(text(`and ${more} more in pal`, { key: "more", style: "muted", size: "xs", align: "center" }));
  }
  kids.push({ type: "divider", key: "rule" }, hints());
  const n = st.list.length;
  const title = `${n ? `${n} unread` : "Notifications"}${st.account ? ` (${st.account})` : ""}`;
  return { tree: column(kids, { key: "compact", padding: 3, gap: 1 }), actions: actions(st), title, id: "notifications", keys: "actions" };
}
