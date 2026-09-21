// GitHub's bar popovers as render trees (`View` in `@zcag/pal`), pure:
// index.ts fetches and classifies, this module only draws the state the
// tests pass in. Pull Requests and Issues show the same buckets their
// strip segments count, all rows, the popover scrolls; the focused row
// wears the accent ring and row clicks move it. Notifications keeps its
// repository-grouped inbox: unread threads with a type rail, reason badge
// and age, capped by a height budget. All three use the popover width
// constant and the same key-hint row pattern.
import { POPOVER_W, ago, column, keyHint, row, text, type Action, type TagColor, type View, type ViewNode } from "@zcag/pal";
import type { Issue, Notification, PR } from "./data.ts";

export type PrBucket = "blocked" | "active" | "ready" | "waiting" | "reviews";
export type PrBucketed = { key: PrBucket; title: string; color: TagColor; rows: PR[] };
export type PrState = { buckets: PrBucketed[]; focus: number; now: number };
export type IssueKind = "assigned" | "mentioned" | "created";
export type IssueBucketed = { issue: Issue; kind: IssueKind };
export type IssueState = { rows: IssueBucketed[]; focus: number; now: number };

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
/** A row's inside: the outer column's `padding: 3` (12px a side), a row's own `padding: 1`, the type rail, the age column and the gaps between them. */
const OUTER_PAD = 12, RAIL_W = 4, RAIL_H = 30, AGE_W = 36, ROW_PAD = 8, GAP = 8;
const INNER_W = POPOVER_W - 2 * OUTER_PAD - ROW_PAD;
const TITLE_W = INNER_W - RAIL_W - GAP - AGE_W - GAP;

const allPrs = (st: PrState) => st.buckets.flatMap((b) => b.rows);
export const shownPrs = (st: PrState): PR[] => allPrs(st);
export const shownIssues = (st: IssueState): IssueBucketed[] => st.rows;

function barHints(): ViewNode {
  return row([...keyHint("enter", "open"), ...keyHint("c", "copy"), ...keyHint("m", "mute"), ...keyHint("r", "refresh"), ...keyHint("p", "in pal"), ...keyHint(["up", "down"], "move")], { key: "hints", gap: 1, minHeight: 22 });
}

function status(pr: PR): { text: string; color: TagColor } {
  if (pr.mergeable === "CONFLICTING") return { text: "conflicting", color: "red" };
  if (pr.checks === "FAILURE" || pr.checks === "ERROR") return { text: "checks failing", color: "red" };
  if (pr.review === "CHANGES_REQUESTED") return { text: "changes requested", color: "red" };
  if (pr.checks === "PENDING" || pr.checks === "EXPECTED") return { text: "checks running", color: "amber" };
  if (pr.review === "REVIEW_REQUIRED" && !pr.draft) return { text: "review required", color: "amber" };
  if (pr.checks === "SUCCESS" && pr.review === "APPROVED" && pr.mergeable === "MERGEABLE") return { text: "approved", color: "green" };
  return { text: pr.draft ? "draft" : "waiting", color: "grey" };
}

function sectionHeader(key: string, title: string, n: number, color: TagColor = "grey"): ViewNode {
  return row([text(title, { size: "xs", weight: "semibold", color: "muted" }), { type: "badge", key: "n", text: String(n), color }], { key: `h-${key}`, gap: 1, minHeight: 22 });
}

function prNode(pr: PR, focused: boolean, st: PrState): ViewNode {
  const s = status(pr);
  return row(
    [
      // Grows to whatever the badge (its width varies with the state text) and the age
      // column leave, so the two trailing bits always sit flush at the right edge
      // instead of trailing right after a badge of a different width each row.
      column([text(pr.title, { size: "md", weight: focused ? "semibold" : "medium", minWidth: 0 }), text(`${pr.repo}#${pr.number}`, { size: "xs", color: "muted", minWidth: 0, style: "mono" })], { key: "t", gap: 0, grow: true }),
      { type: "badge", key: "state", text: s.text, color: s.color },
      text(ago(pr.updatedAt, { now: st.now, short: true }), { style: "mono", size: "xs", color: "muted", width: AGE_W, align: "end" }),
    ],
    { key: pr.id, padding: 1, minHeight: 42, radius: true, action: `focus:${pr.id}`, ...(focused && { selected: true }), transition: { enter: "fade", exit: "fade" } },
  );
}

function issueNode(x: IssueBucketed, focused: boolean, st: IssueState): ViewNode {
  const i = x.issue;
  const meta: ViewNode[] = [text(`${i.repo}#${i.number}`, { size: "xs", color: "muted", style: "mono" })];
  for (const l of i.labels.slice(0, 2)) meta.push({ type: "badge", key: `l-${l.name}`, text: l.name, color: "grey" });
  if (i.comments) meta.push(text(`${i.comments} ${i.comments === 1 ? "comment" : "comments"}`, { size: "xs", color: "faint" }));
  return row(
    [
      column([text(i.title, { size: "md", weight: focused ? "semibold" : "medium", minWidth: 0 }), row(meta, { key: "meta", gap: 1, minHeight: 16 })], { key: "t", gap: 0, grow: true }),
      text(ago(i.updatedAt, { now: st.now, short: true }), { style: "mono", size: "xs", color: "muted", width: AGE_W, align: "end" }),
    ],
    { key: i.id, padding: 1, minHeight: 42, radius: true, action: `focus:${i.id}`, ...(focused && { selected: true }), transition: { enter: "fade", exit: "fade" } },
  );
}

function prActions(st: PrState): Action[] {
  const rows = shownPrs(st);
  return [
    { id: "open", title: "Open on GitHub", shortcut: "enter" },
    { id: "copy", title: "Copy URL", shortcut: ["c", "cmd+c"] },
    { id: "mute", title: "Mute", shortcut: ["m", "cmd+m"] },
    { id: "refresh", title: "Refresh", shortcut: "r" },
    { id: "pal", title: "Open Pull Requests palette", shortcut: "p" },
    { id: "down", title: "Next row", shortcut: ["down", "j"], hidden: true },
    { id: "up", title: "Previous row", shortcut: ["up", "k"], hidden: true },
    ...rows.map((pr): Action => ({ id: `focus:${pr.id}`, title: `Focus ${pr.title}`, hidden: true })),
  ];
}

function issueActions(st: IssueState): Action[] {
  const rows = shownIssues(st);
  return [
    { id: "open", title: "Open on GitHub", shortcut: "enter" },
    { id: "copy", title: "Copy URL", shortcut: ["c", "cmd+c"] },
    { id: "mute", title: "Mute", shortcut: ["m", "cmd+m"] },
    { id: "refresh", title: "Refresh", shortcut: "r" },
    { id: "pal", title: "Open Issues palette", shortcut: "p" },
    { id: "down", title: "Next row", shortcut: ["down", "j"], hidden: true },
    { id: "up", title: "Previous row", shortcut: ["up", "k"], hidden: true },
    ...rows.map((x): Action => ({ id: `focus:${x.issue.id}`, title: `Focus ${x.issue.title}`, hidden: true })),
  ];
}

export function renderPrs(st: PrState): View {
  const rows = shownPrs(st);
  const focus = Math.min(Math.max(0, st.focus), Math.max(0, rows.length - 1));
  const kids: ViewNode[] = [];
  let seen = 0;
  for (const b of st.buckets) {
    const shown = b.rows.filter((pr) => rows.includes(pr));
    if (!shown.length) continue;
    kids.push(sectionHeader(b.key, b.title, b.rows.length, b.color), ...shown.map((pr) => prNode(pr, seen++ === focus, st)));
  }
  if (!rows.length) kids.push(empty("No open pull requests", "None of yours, and no review asked of you"));
  kids.push({ type: "divider", key: "rule" }, barHints());
  const n = allPrs(st).length;
  return { tree: column(kids, { key: "compact", padding: 3, gap: 1 }), actions: prActions(st), title: `${n} open ${n === 1 ? "pull request" : "pull requests"}`, id: "prs", keys: "actions" };
}

export function renderIssues(st: IssueState): View {
  const rows = shownIssues(st);
  const focus = Math.min(Math.max(0, st.focus), Math.max(0, rows.length - 1));
  const label: Record<IssueKind, string> = { assigned: "Assigned to you", mentioned: "Mentioning you", created: "Opened by you" };
  const color: Record<IssueKind, TagColor> = { assigned: "blue", mentioned: "amber", created: "grey" };
  const kids: ViewNode[] = [];
  let seen = 0;
  for (const kind of ["assigned", "mentioned", "created"] as const) {
    const bucket = st.rows.filter((x) => x.kind === kind);
    const shown = bucket.filter((x) => rows.includes(x));
    if (!shown.length) continue;
    kids.push(sectionHeader(kind, label[kind], bucket.length, color[kind]), ...shown.map((x) => issueNode(x, seen++ === focus, st)));
  }
  if (!rows.length) kids.push(empty("No open issues", "None assigned to you, mentioning you or opened by you"));
  kids.push({ type: "divider", key: "rule" }, barHints());
  const n = st.rows.length;
  return { tree: column(kids, { key: "compact", padding: 3, gap: 1 }), actions: issueActions(st), title: `${n} open ${n === 1 ? "issue" : "issues"}`, id: "issues", keys: "actions" };
}

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
      text(ago(n.updatedAt, { now: st.now, short: true }), { style: "mono", size: "xs", color: "muted", width: AGE_W, align: "end" }),
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

/** What a popover says with no rows; the PR and issue items reach it only by choice (the core's `show = "always"` keeping their `empty` shape), so it says why it is empty rather than showing bare hints. */
function empty(title = "All caught up", sub = "Nothing unread on GitHub"): ViewNode {
  return column(
    [
      { type: "tile", key: "tile", width: 48, height: 48, text: "", color: "green", fill: "soft" },
      text(title, { style: "title", size: "lg" }),
      text(sub, { style: "muted", size: "sm", align: "center" }),
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
