// GitHub: five palettes over one client (api.ts) and one data layer
// (data.ts). Pull Requests, Issues and Repositories are indexed with a
// five-minute ttl, Notifications is live with a one-minute one, Search is
// an input palette. Every row's id is stable (`owner/repo#n`,
// `owner/repo`, `@login`, `thread:<id>`), so a pick after a restart still
// knows what it is about: the row table is in memory, the cache behind it
// on disk, and a PR or issue no table knows is fetched by its id. One bar
// item, `notifications`: the unread count as a badge over the same cache.
// `prs` and `issues` are separate semantic status items over their palette
// caches; they deliberately do not make a combined GitHub cluster.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { argsForm, bar, clock, errorMessage, failed, hint, home, run, storage, tinted, toast, truncate, when, type Accessory, type Action, type Arg, type BarCtx, type BarItem, type Ctx, type Detail, type Effect, type Extension, type Form, type Item, type Metadata } from "@zcag/pal";
import { ApiError, AuthError, conf, forget, hasGh, log, rateLimit } from "./api.ts";
import {
  TTL, closeIssue, createIssue, createRepo, findIssue, findPR, issueDetail, issues as fetchIssues, markAllRead, markRead, markReady, mergePR, myRepos, notifications, orgRepos, prDetail, prs as fetchPrs, search, splitId, starredRepos, viewer,
  type Issue, type IssueDetail, type IssueLists, type Notification, type PR, type PRDetail, type PRLists, type Repo, type SearchKind, type User,
} from "./data.ts";
import { render as renderNotifs, renderIssues, renderPrs, shown as shownNotifs, shownIssues, shownPrs, type IssueState, type NotifState, type PrBucketed, type PrState } from "./view.ts";

/** Octicons from the bundled Nerd Font (nf-oct-*): pull request (open, merged, closed, draft), issue (open, closed), repo, bell, search, person, plus, inbox, check; the eye is nf-cod-eye, the octicon one is a size up from the digits next to it. */
const ICON = { prs: "\uf407", merged: "\uf419", prClosed: "\uf4dc", draft: "\uf4dd", issues: "\uf41b", issueClosed: "\uf41d", repos: "\uf401", notifications: "\uf49a", search: "\uf422", user: "\uf415", plus: "\uf44d", inbox: "\uf48d", check: "\uf49e", eye: "\uea70" } as const;
/** The bar's glyph (nf-fa-github). */
const BAR_GLYPH = "\u{f09b}";
/** A PR or issue row's mark: the state's octicon in the state's colour (GitHub's own: open green, merged violet, closed red, draft slate). */
const STATE = {
  open: tinted(ICON.prs, "green"), draft: tinted(ICON.draft, "slate"), merged: tinted(ICON.merged, "violet"), closed: tinted(ICON.prClosed, "red"),
  issue: tinted(ICON.issues, "green"), done: tinted(ICON.issueClosed, "violet"),
} as const;
const TYPE_GLYPH: Record<string, string> = { PullRequest: ICON.prs, Issue: ICON.issues, Release: "\uf412", Discussion: "\uf442", Commit: "\uf417" };
const REASON: Record<string, string> = { review_requested: "Review requested", mention: "Mentioned", team_mention: "Mentioned", assign: "Assigned", author: "Your threads", comment: "Comments", subscribed: "Subscribed", state_change: "State changed", ci_activity: "CI", security_alert: "Security" };
const REASON_ORDER = ["Review requested", "Mentioned", "Assigned", "Your threads", "Comments", "State changed", "CI", "Security", "Subscribed"];
const CHECKOUT_MS = 60_000;
const SEARCH_WAIT_MS = 300;
const CREATE = "create", SUMMARY = "summary";

// ---- rows the palettes share ------------------------------------------------


/** What a failed listing shows instead of rows: how to sign in, when the limit resets, or what went wrong. */
function failure(e: unknown): Item[] {
  if (e instanceof AuthError) {
    return [e.ghPresent
      ? hint("auth", "Sign in to GitHub", "Run `gh auth login` in a terminal, or set a token under Settings › Extensions › GitHub", { actions: [{ id: "open", title: "Open token settings" }] })
      : hint("auth", "Sign in to GitHub", "Install the gh CLI and run `gh auth login`, or set a token under Settings › Extensions › GitHub", { actions: [{ id: "open", title: "Open token settings" }] })];
  }
  if (e instanceof ApiError && e.rateLimited) return [hint("limit", "GitHub rate limit reached", `Resets at ${clock(e.resetAt!)}`)];
  if (e instanceof ApiError && e.status === 401) return [hint("auth", "GitHub rejected the token", e.message, { actions: [{ id: "open", title: "Open token settings" }] })];
  log(errorMessage(e));
  return [hint("error", "GitHub did not answer", errorMessage(e))];
}

const TOKEN_URL = "https://github.com/settings/tokens/new?scopes=repo,notifications,read:org&description=pal";
const pickHint = (id: string): Effect | void => (id.startsWith("hint:auth") ? { open: TOKEN_URL } : undefined);


const repoLink = (repo: string): Metadata => ({ label: "Repository", link: { text: repo, href: `https://github.com/${repo}` } });
const labelTags = (labels: { name: string }[]) => labels.map((l) => ({ text: l.name, color: "grey" }));

/** A local clone under `repos_root`: `<root>/<name>` or `<root>/<owner>/<name>`, whichever is there. */
function clonePath(repo: string): string | undefined {
  const root = conf().repos_root?.trim();
  if (!root) return;
  const [owner, name] = repo.split("/");
  return [join(home(root), name), join(home(root), owner, name)].find((p) => existsSync(p));
}

/** The body, then the latest comments and reviews newest last, so the pane reads like the page. */
function thread(body: string, entries: { author: string; at: string; body: string; kind: string }[]): string {
  const parts = [body.trim() || "_No description._"];
  for (const e of entries.slice().sort((a, b) => a.at.localeCompare(b.at)).slice(-5)) parts.push("---", `**${e.author}** ${e.kind} · ${when(e.at)}`, e.body.trim() || "_(no text)_");
  return parts.join("\n\n");
}

// ---- muted ----------------------------------------------------------------
// A muted PR or issue is one he has decided not to be nagged about: out of
// every list, count and popover, until unmuted from the palette's Muted
// filter (or the row's own action, wherever it still turns up: Search). The
// ids are kept in storage (`owner/repo#n`, one set for both kinds), loaded
// once: this worker is the only writer.

const MUTED = "muted";
let muted = new Set<string>();
const mutedReady = storage.get<string[]>(MUTED).then((ids) => { muted = new Set(ids ?? []); }, (e) => log(`muted: ${errorMessage(e)}`));
const setMuted = async (id: string, on: boolean) => { on ? muted.add(id) : muted.delete(id); await storage.set(MUTED, [...muted]); };

/** The lists as every count and row sees them: the muted ones stripped. */
async function prs(refresh?: boolean): Promise<PRLists> {
  const [l] = await Promise.all([fetchPrs(refresh), mutedReady]);
  const keep = (xs: PR[]) => xs.filter((pr) => !muted.has(pr.id));
  return { mine: keep(l.mine), reviews: keep(l.reviews), merged: keep(l.merged) };
}
async function issues(refresh?: boolean): Promise<IssueLists> {
  const [l] = await Promise.all([fetchIssues(refresh), mutedReady]);
  const keep = (xs: Issue[]) => xs.filter((i) => !muted.has(i.id));
  return { assigned: keep(l.assigned), mentioned: keep(l.mentioned), created: keep(l.created) };
}

/** The mute toggle as a row action, and its pick: the list re-lists (`keep`) and the bar item re-renders off the cache. */
const muteAction = (id: string): Action => ({ id: "mute", title: muted.has(id) ? "Unmute" : "Mute", shortcut: "cmd+m" });
async function pickMute(id: string, item: "prs" | "issues", what: string): Promise<Effect> {
  const on = !muted.has(id);
  await setMuted(id, on);
  bar.refresh(item).catch(() => {});
  return toast(on ? "Muted" : "Unmuted", what);
}

// ---- pull requests --------------------------------------------------------

const prTable = new Map<string, PR>();

function prAccessories(pr: PR): Accessory[] {
  const a: Accessory[] = [];
  if (pr.state === "merged") a.push({ tag: "merged", color: "violet" });
  else if (pr.state === "closed") a.push({ tag: "closed", color: "red" });
  else {
    if (pr.draft) a.push({ tag: "draft", color: "grey" });
    if (pr.checks === "SUCCESS") a.push({ tag: "checks ✓", color: "green" });
    else if (pr.checks === "FAILURE" || pr.checks === "ERROR") a.push({ tag: "checks ✗", color: "red" });
    else if (pr.checks === "PENDING" || pr.checks === "EXPECTED") a.push({ tag: "checks …", color: "amber" });
    if (pr.review === "APPROVED") a.push({ tag: "approved", color: "green" });
    else if (pr.review === "CHANGES_REQUESTED") a.push({ tag: "changes requested", color: "red" });
    else if (pr.review === "REVIEW_REQUIRED" && !pr.draft) a.push({ tag: "review", color: "amber" });
    if (pr.mergeable === "CONFLICTING") a.push({ tag: "conflicts", color: "red" });
  }
  a.push({ date: pr.updatedAt });
  return a;
}

function prActions(pr: PR): Action[] {
  const open = pr.state === "open";
  return [
    { id: "open", title: "Open" },
    { id: "copy", title: "Copy URL", shortcut: "cmd+c" },
    ...(open && hasGh() && clonePath(pr.repo) ? [{ id: "checkout", title: "Checkout branch", shortcut: "cmd+shift+o" }] : []),
    { id: "branch", title: "Copy branch name", shortcut: "cmd+b" },
    { id: "checks", title: "Open checks", shortcut: "cmd+shift+k" },
    { id: "files", title: "Open files changed", shortcut: "cmd+shift+f" },
    { id: "ref", title: "Copy reference" },
    ...(open ? [muteAction(pr.id)] : []),
    ...(open && pr.draft ? [{ id: "ready", title: "Mark ready for review", shortcut: "cmd+shift+r" }] : []),
    ...(open && !pr.draft && pr.mergeable === "MERGEABLE" ? [{ id: "merge", title: "Merge", shortcut: "cmd+shift+m", confirm: `Merge #${pr.number} into ${pr.base}?` }] : []),
  ];
}

const prState = (pr: PR) => (pr.state === "merged" ? { text: "merged", color: "violet" } : pr.state === "closed" ? { text: "closed", color: "red" } : pr.draft ? { text: "draft", color: "grey" } : { text: "open", color: "green" });

/** The pane's metadata: what the row knows, and after the lazy detail (`more`) the checks by name, the reviews and the comment count. */
function prMetadata(pr: PR, more?: PRDetail): Metadata[] {
  const approvers = [...new Set(more?.reviews.filter((r) => r.state === "APPROVED").map((r) => r.author) ?? [])];
  const changers = [...new Set(more?.reviews.filter((r) => r.state === "CHANGES_REQUESTED").map((r) => r.author) ?? [])];
  return [
    repoLink(pr.repo),
    { label: "Author", value: pr.author },
    { label: "Branch", value: `${pr.head} → ${pr.base}` },
    { label: "Size", value: `+${pr.additions} −${pr.deletions}` },
    { label: "State", tags: [prState(pr)] },
    ...(more ? [more.checks.length ? { label: "Checks", tags: more.checks.map((c) => ({ text: c.name, color: CHECK_COLOR[c.state] })) } : { label: "Checks", value: "none" }] : []),
    ...(approvers.length ? [{ label: "Approved by", tags: approvers.map((text) => ({ text, color: "green" })) }] : []),
    ...(changers.length ? [{ label: "Changes requested by", tags: changers.map((text) => ({ text, color: "red" })) }] : []),
    ...(pr.reviewers.length ? [{ label: "Review requested", tags: pr.reviewers.map((text) => ({ text, color: "grey" })) }] : []),
    ...(pr.labels.length ? [{ label: "Labels", tags: labelTags(pr.labels) }] : []),
    ...(more ? [{ label: "Comments", value: String(more.comments) }] : []),
    { label: "Opened", value: when(pr.createdAt) },
    { label: "Updated", value: when(pr.updatedAt) },
  ];
}
const CHECK_COLOR = { ok: "green", bad: "red", run: "amber", skip: "grey" } as const;

function prRow(pr: PR, section?: string): Item {
  prTable.set(pr.id, pr);
  return {
    id: pr.id,
    name: pr.title,
    subtitle: `${pr.repo} #${pr.number}`,
    icon: pr.state === "merged" ? STATE.merged : pr.state === "closed" ? STATE.closed : pr.draft ? STATE.draft : STATE.open,
    keywords: [pr.repo.split("/")[1], pr.repo, `#${pr.number}`, String(pr.number), pr.author, pr.head],
    url: pr.url,
    section,
    accessories: prAccessories(pr),
    detail: { metadata: prMetadata(pr) },
    actions: prActions(pr),
  };
}

const REVIEW_WORD: Record<string, string> = { APPROVED: "approved", CHANGES_REQUESTED: "requested changes", COMMENTED: "reviewed", DISMISSED: "review dismissed" };

async function prPane(pr: PR): Promise<Detail> {
  const s = splitId(pr.id)!;
  const d = await prDetail(s.owner, s.name, s.number);
  const entries = [
    ...d.latest.map((c) => ({ ...c, kind: "commented" })),
    ...d.reviews.filter((r) => r.body.trim()).map((r) => ({ author: r.author, at: r.at, body: r.body, kind: REVIEW_WORD[r.state] ?? "reviewed" })),
  ];
  return { markdown: thread(d.body, entries), metadata: prMetadata(pr, d) };
}

async function findPr(id: string): Promise<PR> {
  const have = prTable.get(id);
  if (have) return have;
  const pr = await findPR(id);
  if (!pr) throw new Error(`no pull request ${id}`);
  prTable.set(id, pr);
  return pr;
}

async function pickPR(pr: PR, action?: string): Promise<Effect> {
  switch (action) {
    case "copy": return { copy: pr.url };
    case "branch": return { copy: pr.head };
    case "ref": return { copy: pr.id };
    case "mute": return pickMute(pr.id, "prs", `#${pr.number} ${truncate(pr.title, 60)}`);
    case "checks": return { open: `${pr.url}/checks` };
    case "files": return { open: `${pr.url}/files` };
    case "checkout": {
      const dir = clonePath(pr.repo);
      if (!dir) return toast("No local clone", `Set repos_root to where ${pr.repo} is checked out`, "failure");
      try { await run(["gh", "pr", "checkout", String(pr.number)], { ms: CHECKOUT_MS, cwd: dir }); } catch (e) { return failed("check out the branch", e); }
      return { hud: `Checked out ${pr.head}` };
    }
    case "ready":
      try { await markReady(pr); } catch (e) { return failed("mark ready", e); }
      forget("prs");
      return toast("Ready for review", `#${pr.number} ${truncate(pr.title, 60)}`);
    case "merge":
      try { await mergePR(pr); } catch (e) { return failed("merge", e); }
      forget("prs");
      return toast("Merged", `#${pr.number} ${truncate(pr.title, 60)}`, "success");
    default: return { open: pr.url };
  }
}

const PR_FILTERS = [{ id: "all", title: "All" }, { id: "mine", title: "Mine" }, { id: "reviews", title: "Review requested" }, { id: "merged", title: "Merged" }, { id: "muted", title: "Muted" }];

async function prRows(ctx?: Ctx): Promise<Item[]> {
  const filter = ctx?.filter ?? "all";
  const seen = new Set<string>();
  const rows: Item[] = [];
  const add = (list: PR[], section: string) => { for (const pr of list) if (!seen.has(pr.id)) { seen.add(pr.id); rows.push(prRow(pr, section)); } };
  if (filter === "muted") {
    const l = await fetchPrs(!!ctx?.refresh);
    add([...l.mine, ...l.reviews].filter((pr) => muted.has(pr.id)), "Muted");
    return rows.length ? rows : [hint("none", "Nothing muted", "Mute on a pull request keeps it out of the lists, the count and the bar item")];
  }
  const lists = await prs(!!ctx?.refresh);
  if (filter === "all" || filter === "mine") add(lists.mine, "Mine");
  if (filter === "all" || filter === "reviews") add(lists.reviews, "Review requested");
  if (filter === "all" || filter === "merged") add(lists.merged, "Merged");
  if (!rows.length) return [hint("none", filter === "reviews" ? "No reviews requested" : filter === "merged" ? `Nothing merged in the last ${conf().merged_days || 7} days` : "No open pull requests")];
  return rows;
}

/** Open PRs occur in both searches when they overlap; a bar count must count a PR once. Mine first: a review asked of me on my own PR is still mine. */
function uniquePrs(lists: PRLists): PR[] {
  const seen = new Set<string>();
  return [...lists.mine, ...lists.reviews].filter((pr) => pr.state === "open" && !seen.has(pr.id) && (seen.add(pr.id), true));
}

const failedChecks = (pr: PR) => pr.checks === "FAILURE" || pr.checks === "ERROR";
const runningChecks = (pr: PR) => pr.checks === "PENDING" || pr.checks === "EXPECTED";
const blockedPr = (pr: PR) => pr.mergeable === "CONFLICTING" || failedChecks(pr) || pr.review === "CHANGES_REQUESTED";

/**
 * The state buckets are for my own PRs: their checks, reviews and
 * conflicts are mine to act on. A PR I am asked to review is information,
 * not a task with a state (another reviewer's "changes requested" is not
 * my attention item), so it sits in its own bucket whatever its state.
 */
function prBuckets(lists: PRLists): { list: PR[]; buckets: PrBucketed[] } {
  const list = uniquePrs(lists);
  const mine = new Set(lists.mine.map((pr) => pr.id));
  const own = list.filter((pr) => mine.has(pr.id));
  const reviews = list.filter((pr) => !mine.has(pr.id));
  const blocked = own.filter(blockedPr);
  const active = own.filter((pr) => !blockedPr(pr) && (runningChecks(pr) || pr.review === "REVIEW_REQUIRED"));
  const ready = own.filter((pr) => !blockedPr(pr) && pr.checks === "SUCCESS" && pr.review === "APPROVED" && pr.mergeable === "MERGEABLE");
  const waiting = own.filter((pr) => !blocked.includes(pr) && !active.includes(pr) && !ready.includes(pr));
  return {
    list,
    buckets: [
      { key: "blocked", title: "Needs attention", color: "red", rows: blocked },
      { key: "active", title: "Active", color: "amber", rows: active },
      { key: "ready", title: "Ready to merge", color: "green", rows: ready },
      { key: "waiting", title: "Waiting", color: "grey", rows: waiting },
      { key: "reviews", title: "Review requested", color: "blue", rows: reviews },
    ],
  };
}

function prBarState(lists: PRLists): PrState {
  const bucketed = prBuckets(lists);
  const st: PrState = { buckets: bucketed.buckets, focus: 0, now: Date.now() };
  const rows = shownPrs(st);
  st.focus = Math.max(0, rows.findIndex((pr) => pr.id === barFocus.prs));
  barFocus.prs = rows[st.focus]?.id;
  for (const pr of bucketed.list) prTable.set(pr.id, pr);
  return st;
}

/** A small, stateful PR strip: red needs intervention, amber is active, green can merge, muted is waiting. */
async function prsItem(ctx: BarCtx): Promise<BarItem> {
  let lists: PRLists;
  try { lists = await prs(ctx.reason === "show" || ctx.reason === "wake" || ctx.reason === "network"); } catch (e) {
    if (e instanceof AuthError) return { hidden: true };
    throw e;
  }
  const { list, buckets } = prBuckets(lists);
  if (!list.length) return conf().bar_show_prs === "always" ? { icon: ICON.prs, color: "muted", tooltip: "No open pull requests", menu: { view: renderPrs(prBarState(lists)) } } : { hidden: true };
  const [blocked, active, ready, waiting, reviews] = buckets.map((b) => b.rows);
  const segments = [
    ...(blocked.length ? [{ id: "blocked", text: `×${blocked.length}`, color: "red" as const, tooltip: `${blocked.length} PR${blocked.length === 1 ? "" : "s"} needs attention` }] : []),
    ...(active.length ? [{ id: "active", text: `…${active.length}`, color: "amber" as const, tooltip: `${active.length} PR${active.length === 1 ? "" : "s"} awaiting review or checks` }] : []),
    ...(ready.length ? [{ id: "ready", text: `✓${ready.length}`, color: "green" as const, tooltip: `${ready.length} PR${ready.length === 1 ? "" : "s"} ready to merge` }] : []),
    ...(waiting.length ? [{ id: "waiting", text: `·${waiting.length}`, color: "muted" as const, tooltip: `${waiting.length} PR${waiting.length === 1 ? "" : "s"} waiting` }] : []),
    ...(reviews.length ? [{ id: "reviews", icon: ICON.eye, text: String(reviews.length), color: "blue" as const, tooltip: `${reviews.length} review${reviews.length === 1 ? "" : "s"} asked of you` }] : []),
  ];
  return {
    icon: ICON.prs,
    segments,
    tooltip: `${list.length} open pull request${list.length === 1 ? "" : "s"}`,
    menu: { view: renderPrs(prBarState(lists)) },
    ...(list.some(runningChecks) ? { refresh: 60 } : {}),
  };
}

async function prsAction(action: string): Promise<Effect> {
  if (action === "pal") return { push: { extension: "github", palette: "prs" } };
  const lists = await prs(action === "refresh");
  const st = prBarState(lists);
  const rows = shownPrs(st);
  const redraw = (): Effect => ({ ...(action === "refresh" ? { keep: true } : {}), view: renderPrs(prBarState(lists)) });
  if (action.startsWith("focus:")) { barFocus.prs = action.slice(6); return redraw(); }
  if (action === "down" || action === "up") {
    if (!rows.length) return { keep: true };
    barFocus.prs = rows[(st.focus + (action === "down" ? 1 : rows.length - 1)) % rows.length].id;
    return redraw();
  }
  if (action === "refresh") return redraw();
  const focused = rows[st.focus];
  if (!focused) return { keep: true };
  if (action === "copy") return { copy: focused.url };
  if (action === "mute") {
    await setMuted(focused.id, true);
    // The cursor stays at its index: the next PR slides under it.
    const next = prBarState(await prs());
    const at = Math.min(st.focus, Math.max(0, shownPrs(next).length - 1));
    barFocus.prs = shownPrs(next)[at]?.id;
    return { keep: true, view: renderPrs({ ...next, focus: at }) };
  }
  return pickPR(focused);
}

// ---- issues ---------------------------------------------------------------

const issueTable = new Map<string, Issue>();

function issueActions(i: Issue): Action[] {
  return [
    { id: "open", title: "Open" },
    { id: "copy", title: "Copy URL", shortcut: "cmd+c" },
    { id: "ref", title: "Copy reference" },
    ...(i.state === "open" ? [muteAction(i.id), { id: "close", title: "Close issue", shortcut: "cmd+shift+x", style: "destructive" as const, confirm: `Close #${i.number}?` }] : []),
  ];
}

const issueMetadata = (i: Issue, more?: IssueDetail): Metadata[] => [
  repoLink(i.repo),
  { label: "Author", value: i.author },
  { label: "State", tags: [i.state === "open" ? { text: "open", color: "green" } : { text: "closed", color: "violet" }] },
  ...(i.assignees.length ? [{ label: "Assignees", tags: i.assignees.map((text) => ({ text, color: "grey" })) }] : []),
  ...(i.labels.length ? [{ label: "Labels", tags: labelTags(i.labels) }] : []),
  ...(more?.milestone ? [{ label: "Milestone", value: more.milestone }] : []),
  { label: "Comments", value: String(more?.comments ?? i.comments) },
  { label: "Opened", value: when(i.createdAt) },
  { label: "Updated", value: when(i.updatedAt) },
];

function issueRow(i: Issue, section?: string): Item {
  issueTable.set(i.id, i);
  return {
    id: i.id,
    name: i.title,
    subtitle: `${i.repo} #${i.number}`,
    icon: i.state === "open" ? STATE.issue : STATE.done,
    keywords: [i.repo.split("/")[1], i.repo, `#${i.number}`, String(i.number), i.author, ...i.labels.map((l) => l.name)],
    url: i.url,
    section,
    accessories: [
      ...(i.state === "closed" ? [{ tag: "closed", color: "violet" }] : []),
      ...i.labels.slice(0, 2).map((l) => ({ tag: l.name, color: "grey" })),
      ...(i.comments ? [{ text: `${i.comments} comment${i.comments === 1 ? "" : "s"}` }] : []),
      { date: i.updatedAt },
    ],
    detail: { metadata: issueMetadata(i) },
    actions: issueActions(i),
  };
}

async function issuePane(i: Issue): Promise<Detail> {
  const s = splitId(i.id)!;
  const d = await issueDetail(s.owner, s.name, s.number);
  return { markdown: thread(d.body, d.latest.map((c) => ({ ...c, kind: "commented" }))), metadata: issueMetadata(i, d) };
}

async function findIss(id: string): Promise<Issue> {
  const have = issueTable.get(id);
  if (have) return have;
  const i = await findIssue(id);
  if (!i) throw new Error(`no issue ${id}`);
  issueTable.set(id, i);
  return i;
}

async function pickIssue(i: Issue, action?: string): Promise<Effect> {
  switch (action) {
    case "copy": return { copy: i.url };
    case "ref": return { copy: i.id };
    case "mute": return pickMute(i.id, "issues", `#${i.number} ${truncate(i.title, 60)}`);
    case "close":
      try { await closeIssue(i); } catch (e) { return failed("close", e); }
      forget("issues");
      return toast("Closed", `#${i.number} ${truncate(i.title, 60)}`);
    default: return { open: i.url };
  }
}

/** Repositories for the create form's select: the ones with recent activity in the lists first, then mine by push date. */
async function recentRepos(): Promise<string[]> {
  const out: string[] = [];
  const add = (r: string) => { if (r && !out.includes(r)) out.push(r); };
  for (const t of [issueTable, prTable]) for (const r of t.values()) add(r.repo);
  try { for (const r of await myRepos()) add(r.id); } catch (e) { log(`repos for the form: ${errorMessage(e)}`); }
  return out.slice(0, 40);
}

async function issueForm(errors?: Record<string, string>, values?: Record<string, string | boolean>): Promise<Form> {
  const repos = await recentRepos();
  return {
    id: CREATE,
    title: "Create issue",
    fields: [
      repos.length
        ? { kind: "select", id: "repo", label: "Repository", options: repos.map((r) => ({ id: r, title: r })), default: String(values?.repo ?? repos[0]), required: true }
        : { kind: "text", id: "repo", label: "Repository", placeholder: "owner/name", default: String(values?.repo ?? ""), required: true },
      { kind: "text", id: "title", label: "Title", required: true, default: String(values?.title ?? "") },
      { kind: "textarea", id: "body", label: "Body", default: String(values?.body ?? ""), description: "Markdown." },
    ],
    submit: { id: "save", title: "Create" },
    errors,
  };
}

async function saveIssue(values: Record<string, string | boolean>): Promise<Effect> {
  const repo = String(values.repo ?? "").trim(), title = String(values.title ?? "").trim(), body = String(values.body ?? "");
  const errors: Record<string, string> = {};
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) errors.repo = "owner/name";
  if (!title) errors.title = "Required";
  if (Object.keys(errors).length) return { form: await issueForm(errors, values) };
  try {
    const r = await createIssue(repo, title, body);
    forget("issues");
    return { open: r.url, hud: `Created ${repo}#${r.number}` };
  } catch (e) {
    return { form: await issueForm({ title: errorMessage(e) }, values) };
  }
}

const ISSUE_FILTERS = [{ id: "all", title: "All" }, { id: "assigned", title: "Assigned" }, { id: "mentioned", title: "Mentioned" }, { id: "created", title: "Created" }, { id: "muted", title: "Muted" }];
const createIssueRow: Item = { id: CREATE, name: "Create issue", subtitle: "A new issue in one of your repositories", icon: ICON.plus, keywords: ["new", "add"], actions: [{ id: CREATE, title: "Create issue" }] };

async function issueRows(ctx?: Ctx): Promise<Item[]> {
  const filter = ctx?.filter ?? "all";
  const seen = new Set<string>();
  const rows: Item[] = [createIssueRow];
  const add = (list: Issue[], section: string) => { for (const i of list) if (!seen.has(i.id)) { seen.add(i.id); rows.push(issueRow(i, section)); } };
  if (filter === "muted") {
    const l = await fetchIssues(!!ctx?.refresh);
    add([...l.assigned, ...l.mentioned, ...l.created].filter((i) => muted.has(i.id)), "Muted");
    return rows.length > 1 ? rows.slice(1) : [hint("none", "Nothing muted", "Mute on an issue keeps it out of the lists, the count and the bar item")];
  }
  const lists = await issues(!!ctx?.refresh);
  if (filter === "all" || filter === "assigned") add(lists.assigned, "Assigned");
  if (filter === "all" || filter === "mentioned") add(lists.mentioned, "Mentioned");
  if (filter === "all" || filter === "created") add(lists.created, "Created");
  if (rows.length === 1) rows.push(hint("none", "No open issues", filter === "all" ? "None assigned to you, mentioning you, or opened by you" : undefined));
  return rows;
}

/** Each open issue appears once, in its most direct relationship category. */
function uniqueIssues(lists: IssueLists): { issue: Issue; kind: "assigned" | "mentioned" | "created" }[] {
  const seen = new Set<string>();
  const out: { issue: Issue; kind: "assigned" | "mentioned" | "created" }[] = [];
  for (const [kind, list] of [["assigned", lists.assigned], ["mentioned", lists.mentioned], ["created", lists.created]] as const) {
    for (const issue of list) if (issue.state === "open" && !seen.has(issue.id)) { seen.add(issue.id); out.push({ issue, kind }); }
  }
  return out;
}

function issueBarState(lists: IssueLists): IssueState {
  const rows = uniqueIssues(lists);
  for (const { issue } of rows) issueTable.set(issue.id, issue);
  const st: IssueState = { rows, focus: 0, now: Date.now() };
  const shown = shownIssues(st);
  st.focus = Math.max(0, shown.findIndex((x) => x.issue.id === barFocus.issues));
  barFocus.issues = shown[st.focus]?.issue.id;
  return st;
}

/** Assigned, mentioned, and authored are separate colours, while this remains a single independent Issues item. */
async function issuesItem(ctx: BarCtx): Promise<BarItem> {
  let lists: IssueLists;
  try { lists = await issues(ctx.reason === "show" || ctx.reason === "wake" || ctx.reason === "network"); } catch (e) {
    if (e instanceof AuthError) return { hidden: true };
    throw e;
  }
  const list = uniqueIssues(lists);
  if (!list.length) return conf().bar_show_issues === "always" ? { icon: ICON.issues, color: "muted", tooltip: "No open issues", menu: { view: renderIssues(issueBarState(lists)) } } : { hidden: true };
  const count = (kind: "assigned" | "mentioned" | "created") => list.filter((x) => x.kind === kind).length;
  const assigned = count("assigned"), mentioned = count("mentioned"), created = count("created");
  return {
    icon: ICON.issues,
    segments: [
      ...(assigned ? [{ id: "assigned", text: `@${assigned}`, color: "blue" as const, tooltip: `${assigned} issue${assigned === 1 ? "" : "s"} assigned to you` }] : []),
      ...(mentioned ? [{ id: "mentioned", text: `@${mentioned}`, color: "amber" as const, tooltip: `${mentioned} issue${mentioned === 1 ? "" : "s"} mentioning you` }] : []),
      ...(created ? [{ id: "created", text: `·${created}`, color: "muted" as const, tooltip: `${created} issue${created === 1 ? "" : "s"} opened by you` }] : []),
    ],
    tooltip: `${list.length} open issue${list.length === 1 ? "" : "s"}`,
    menu: { view: renderIssues(issueBarState(lists)) },
  };
}

async function issuesAction(action: string): Promise<Effect> {
  if (action === "pal") return { push: { extension: "github", palette: "issues" } };
  const lists = await issues(action === "refresh");
  const st = issueBarState(lists);
  const rows = shownIssues(st);
  const redraw = (): Effect => ({ ...(action === "refresh" ? { keep: true } : {}), view: renderIssues(issueBarState(lists)) });
  if (action.startsWith("focus:")) { barFocus.issues = action.slice(6); return redraw(); }
  if (action === "down" || action === "up") {
    if (!rows.length) return { keep: true };
    barFocus.issues = rows[(st.focus + (action === "down" ? 1 : rows.length - 1)) % rows.length].issue.id;
    return redraw();
  }
  if (action === "refresh") return redraw();
  const focused = rows[st.focus]?.issue;
  if (!focused) return { keep: true };
  if (action === "copy") return { copy: focused.url };
  if (action === "mute") {
    await setMuted(focused.id, true);
    const next = issueBarState(await issues());
    const at = Math.min(st.focus, Math.max(0, shownIssues(next).length - 1));
    barFocus.issues = shownIssues(next)[at]?.issue.id;
    return { keep: true, view: renderIssues({ ...next, focus: at }) };
  }
  return pickIssue(focused);
}

// ---- repositories --------------------------------------------------------

const repoTable = new Map<string, Repo>();

const cloneUrl = (r: Repo) => (conf().clone_protocol === "https" ? r.https : r.ssh);

function repoActions(r: Repo): Action[] {
  const local = clonePath(r.id);
  return [
    { id: "open", title: "Open on GitHub" },
    ...(local ? [{ id: "editor", title: "Open in editor", shortcut: "cmd+e" }, { id: "folder", title: "Open folder", shortcut: "cmd+o" }] : []),
    { id: "clone", title: "Copy clone URL", shortcut: "cmd+shift+c" },
    { id: "copy", title: "Copy URL", shortcut: "cmd+c" },
    { id: "name", title: "Copy owner/name" },
    { id: "issues", title: "Open issues" },
    { id: "pulls", title: "Open pull requests" },
    // Takes the row's typed argument, a path inside the repository; Enter on the row still opens its front page.
    { id: "path", title: "Open path", shortcut: "cmd+p", args: true },
  ];
}

/** A path in the repository, typed in the bar for "Open path": `src/main.rs`, `docs`. */
const PATH_ARGS: Arg[] = [{ id: "path", placeholder: "Path in the repo", required: true }];

function repoRow(r: Repo, section?: string): Item {
  repoTable.set(r.id, r);
  const local = clonePath(r.id);
  return {
    id: r.id,
    name: r.name,
    subtitle: r.description ? truncate(r.description, 120) : r.owner,
    icon: ICON.repos,
    keywords: [r.id, r.owner, ...(r.language ? [r.language] : [])],
    url: r.url,
    section,
    accessories: [
      ...(r.private ? [{ tag: "private", color: "amber" }] : []),
      ...(r.archived ? [{ tag: "archived", color: "grey" }] : []),
      ...(r.language ? [{ tag: r.language, color: "blue" }] : []),
      ...(r.stars ? [{ text: `★ ${r.stars}` }] : []),
      ...(r.pushedAt ? [{ date: r.pushedAt }] : []),
    ],
    detail: {
      markdown: `# ${r.id}\n\n${r.description || "_No description._"}`,
      metadata: [
        { label: "Owner", link: { text: r.owner, href: `https://github.com/${r.owner}` } },
        ...(r.language ? [{ label: "Language", value: r.language }] : []),
        { label: "Stars", value: String(r.stars) },
        { label: "Forks", value: String(r.forks) },
        { label: "Open issues", value: String(r.issues) },
        { label: "Default branch", value: r.defaultBranch },
        { label: "Clone", value: cloneUrl(r) },
        ...(local ? [{ label: "Local clone", value: local }] : []),
        ...(r.pushedAt ? [{ label: "Pushed", value: when(r.pushedAt) }] : []),
      ],
    },
    args: PATH_ARGS,
    actions: repoActions(r),
  };
}

const spawnDetached = (argv: string[]) => Bun.spawn(argv, { stdio: ["ignore", "ignore", "ignore"], detached: true }).unref();

async function pickRepo(r: Repo, action?: string, ctx?: Ctx): Promise<Effect> {
  switch (action) {
    case "path": {
      // A bare pick (a hotkey, `pal run`) gets the field as a form. GitHub's blob url answers a directory too (it redirects to tree).
      const path = String(ctx?.values?.path ?? "").trim().replace(/^\/+/, "");
      if (!ctx?.values || !path) return { form: argsForm(PATH_ARGS, `Open a path in ${r.id}`, { id: "path", title: "Open path" }, ctx?.values && { path: "Required" }) };
      return { open: `${r.url}/blob/${r.defaultBranch}/${path.split("/").map(encodeURIComponent).join("/")}` };
    }
    case "editor": {
      const dir = clonePath(r.id);
      if (!dir) return toast("No local clone", `Nothing under repos_root for ${r.id}`, "failure");
      const editor = Bun.which("code");
      if (!editor) return { open: dir };
      spawnDetached([editor, dir]);
      return { hud: `Opened ${r.name} in VS Code` };
    }
    case "folder": { const dir = clonePath(r.id); return dir ? { open: dir } : toast("No local clone", `Nothing under repos_root for ${r.id}`, "failure"); }
    case "clone": return { copy: cloneUrl(r) };
    case "copy": return { copy: r.url };
    case "name": return { copy: r.id };
    case "issues": return { open: `${r.url}/issues` };
    case "pulls": return { open: `${r.url}/pulls` };
    default: return { open: r.url };
  }
}

async function findRepo(id: string): Promise<Repo | undefined> {
  const have = repoTable.get(id);
  if (have) return have;
  for (const rows of await Promise.all([myRepos(), starredRepos()])) for (const r of rows) repoTable.set(r.id, r);
  return repoTable.get(id);
}

async function repoForm(errors?: Record<string, string>, values?: Record<string, string | boolean>): Promise<Form> {
  const org = conf().default_org?.trim();
  let me = "";
  try { me = (await viewer()).login; } catch {}
  const owners = [...(me ? [{ id: me, title: me }] : []), ...(org ? [{ id: org, title: org }] : [])];
  return {
    id: CREATE,
    title: "Create repository",
    fields: [
      ...(owners.length > 1 ? [{ kind: "select" as const, id: "owner", label: "Owner", options: owners, default: String(values?.owner ?? owners[0].id) }] : []),
      { kind: "text", id: "name", label: "Name", required: true, default: String(values?.name ?? ""), placeholder: "my-repo" },
      { kind: "text", id: "description", label: "Description", default: String(values?.description ?? "") },
      { kind: "checkbox", id: "private", label: "Visibility", text: "Private", default: values?.private === undefined ? true : !!values.private },
    ],
    submit: { id: "save", title: "Create" },
    errors,
  };
}

async function saveRepo(values: Record<string, string | boolean>): Promise<Effect> {
  const name = String(values.name ?? "").trim();
  if (!/^[\w.-]+$/.test(name)) return { form: await repoForm({ name: "Letters, digits, . - _" }, values) };
  let me = "";
  try { me = (await viewer()).login; } catch {}
  const owner = String(values.owner ?? "").trim();
  try {
    const r = await createRepo(owner && owner !== me ? owner : undefined, name, String(values.description ?? ""), !!values.private);
    forget("repos:mine", ...(owner && owner !== me ? [`repos:org:${owner}`] : []));
    return { open: r.url, hud: `Created ${r.id}` };
  } catch (e) {
    return { form: await repoForm({ name: errorMessage(e) }, values) };
  }
}

const REPO_FILTERS = [{ id: "all", title: "All" }, { id: "mine", title: "Mine" }, { id: "starred", title: "Starred" }, { id: "org", title: "Organisation" }];
const createRepoRow: Item = { id: CREATE, name: "Create repository", subtitle: "A new repository under your account or your organisation", icon: ICON.plus, keywords: ["new", "add"], actions: [{ id: CREATE, title: "Create repository" }] };

async function repoRows(ctx?: Ctx): Promise<Item[]> {
  const filter = ctx?.filter ?? "all", refresh = !!ctx?.refresh;
  const org = conf().default_org?.trim();
  const rows: Item[] = [createRepoRow];
  const seen = new Set<string>();
  const add = (list: Repo[], section: string) => { for (const r of list) if (!seen.has(r.id)) { seen.add(r.id); rows.push(repoRow(r, section)); } };
  const want = (f: string) => filter === "all" || filter === f;
  // The three lists at once; sections in a fixed order regardless of which answers first.
  const [mine, orgs, starred] = await Promise.all([want("mine") ? myRepos(refresh) : [], want("org") && org ? orgRepos(org, refresh) : [], want("starred") ? starredRepos(refresh) : []]);
  add(mine, "Mine");
  if (org) add(orgs, org);
  else if (filter === "org") rows.push(hint("org", "Organisation is not set", "Set default_org under Settings › Extensions › GitHub"));
  add(starred, "Starred");
  return rows;
}

// ---- users (search only) --------------------------------------------------

const userTable = new Map<string, User>();

function userRow(u: User, section?: string): Item {
  userTable.set(u.id, u);
  return {
    id: u.id,
    name: u.name ? `${u.login} (${u.name})` : u.login,
    subtitle: u.bio ? truncate(u.bio, 120) : u.org ? "Organisation" : "User",
    icon: u.avatar ? { image: u.avatar } : ICON.user,
    keywords: [u.login, u.name].filter(Boolean),
    url: u.url,
    section,
    accessories: [{ tag: u.org ? "org" : "user", color: "grey" }],
    detail: { markdown: `# ${u.login}\n\n${u.bio || ""}`, metadata: [{ label: "Profile", link: { text: u.url, href: u.url } }] },
    actions: [{ id: "open", title: "Open profile" }, { id: "copy", title: "Copy login", shortcut: "cmd+c" }, { id: "repos", title: "Open repositories" }],
  };
}

const pickUser = (u: User, action?: string): Effect => (action === "copy" ? { copy: u.login } : action === "repos" ? { open: `${u.url}?tab=repositories` } : { open: u.url });

// ---- notifications --------------------------------------------------------

const notifTable = new Map<string, Notification>();

const NOTIF_ACTIONS: Action[] = [
  { id: "open", title: "Open" },
  { id: "read", title: "Mark as read", shortcut: "cmd+shift+r" },
  { id: "copy", title: "Copy URL", shortcut: "cmd+c" },
  { id: "read-all", title: "Mark all as read", shortcut: "cmd+shift+a", style: "destructive", confirm: "Mark every notification as read?" },
];

function notifRow(n: Notification): Item {
  notifTable.set(n.id, n);
  const reason = REASON[n.reason] ?? n.reason;
  return {
    id: n.id,
    name: n.title,
    subtitle: n.repo,
    icon: TYPE_GLYPH[n.type] ?? ICON.notifications,
    keywords: [n.repo, n.repo.split("/")[1], n.reason, n.type.toLowerCase()],
    url: n.url,
    section: reason,
    accessories: [{ tag: n.type === "PullRequest" ? "PR" : n.type.toLowerCase(), color: "grey" }, { date: n.updatedAt }],
    detail: { markdown: `# ${n.title}`, metadata: [repoLink(n.repo), { label: "Reason", value: reason }, { label: "Type", value: n.type }, { label: "Updated", value: when(n.updatedAt) }] },
    actions: NOTIF_ACTIONS,
  };
}

async function notifRows(ctx?: Ctx): Promise<Item[]> {
  const list = await notifications(!!ctx?.refresh);
  const order = (n: Notification) => { const i = REASON_ORDER.indexOf(REASON[n.reason] ?? ""); return i < 0 ? REASON_ORDER.length : i; };
  const sorted = list.slice().sort((a, b) => order(a) - order(b) || b.updatedAt.localeCompare(a.updatedAt));
  const summary: Item = {
    id: SUMMARY,
    name: list.length ? `${list.length} unread notification${list.length === 1 ? "" : "s"}` : "No unread notifications",
    subtitle: "GitHub inbox",
    icon: ICON.notifications,
    keywords: ["unread", "inbox"],
    accessories: list.length ? [{ tag: String(list.length), color: "blue" }] : undefined,
    actions: list.length
      ? [{ id: "open", title: "Open notifications" }, { id: "read-all", title: "Mark all as read", style: "destructive", confirm: "Mark every notification as read?" }]
      : [{ id: "open", title: "Open notifications" }],
  };
  return [summary, ...sorted.map(notifRow)];
}

async function findNotif(id: string): Promise<Notification> {
  const have = notifTable.get(id);
  if (have) return have;
  for (const n of await notifications()) notifTable.set(n.id, n);
  const n = notifTable.get(id);
  if (!n) throw new Error(`no notification ${id}`);
  return n;
}

async function pickNotif(id: string, action?: string): Promise<Effect> {
  if (action === "read-all") {
    try { await markAllRead(); } catch (e) { return failed("mark all read", e); }
    await forget("notifications");
    return toast("All notifications read");
  }
  if (id === SUMMARY) return { open: "https://github.com/notifications" };
  const n = await findNotif(id);
  switch (action) {
    case "copy": return { copy: n.url };
    case "read":
      try { await markRead(n.thread); } catch (e) { return failed("mark read", e); }
      await forget("notifications");
      return toast("Marked read", truncate(n.title, 60));
    default:
      // Opening reads it, as the page would: the count is honest by the time you are back.
      try { await markRead(n.thread); await forget("notifications"); } catch (e) { log(`mark read ${n.thread}: ${errorMessage(e)}`); }
      return { open: n.url };
  }
}

/**
 * The bar item: the unread count as a badge, hidden at zero (or, with
 * `bar_show_notifications` at `always`, the glyph alone, muted, so the
 * item stays a way into the popover), the popover a view of the unread
 * threads grouped by repository (view.ts) with the keys' cursor kept
 * here by thread id. The cache is the palette's
 * (`notifications`, ETag): a trigger from the bar (the panel shown, a
 * wake, the network back, the CLI) asks GitHub, which answers 304 for
 * free when nothing changed; the timer and a first render take what is
 * cached. Signed out is hidden, not an error: the strip has no room for a
 * hint.
 */
let barFocus: Partial<Record<"notifications" | "prs" | "issues", string>> = {};
let barAccount: string | undefined;

/** The popover's state over `list`: the cursor on the focused thread, else the first row. */
function notifState(list: Notification[]): NotifState {
  for (const n of list) notifTable.set(n.id, n);
  const rows = shownNotifs(list);
  const cursor = Math.max(0, rows.findIndex((n) => n.id === barFocus.notifications));
  barFocus.notifications = rows[cursor]?.id;
  return { list, cursor, now: Date.now(), account: barAccount };
}

async function notifItem(ctx: BarCtx): Promise<BarItem> {
  let list: Notification[];
  barAccount = ctx.instance?.title;
  try { list = await notifications(ctx.reason === "show" || ctx.reason === "wake" || ctx.reason === "network" || ctx.reason === "cli"); } catch (e) {
    if (e instanceof AuthError) return { hidden: true };
    throw e;
  }
  if (list.length === 0) return conf().bar_show_notifications === "always" ? { icon: BAR_GLYPH, color: "muted", tooltip: "No unread notifications", menu: { view: renderNotifs(notifState(list)) } } : { hidden: true };
  return {
    icon: BAR_GLYPH,
    badge: list.length,
    tooltip: `${list.length} unread notification${list.length === 1 ? "" : "s"}`,
    menu: { view: renderNotifs(notifState(list)) },
  };
}

/**
 * A key or a click in the popover: Enter/`o` marks the focused thread
 * read and opens it (as the palette's row does), `m` marks it read and
 * redraws, `a` marks all read, `p` pushes the palette, arrows and a
 * click move the cursor. A redraw after a mark read answers the fresh
 * list with `keep`, so the strip's count follows too.
 */
async function notifAction(action: string): Promise<Effect> {
  if (action === "pal") return { push: { extension: "github", palette: "notifications" } };
  if (action === "site") return { open: "https://github.com/notifications" };
  if (action === "read-all") {
    const r = await pickNotif(SUMMARY, "read-all");
    // The popover reads "All caught up" while the strip's re-render hides the item.
    return r.toast?.style === "failure" ? r : { keep: true, view: renderNotifs(notifState([])) };
  }
  const list = await notifications();
  const st = notifState(list);
  const rows = shownNotifs(list);
  const focused = rows[st.cursor];
  const redraw = (next: NotifState): Effect => ({ view: renderNotifs(next) });
  if (action.startsWith("focus:")) { barFocus.notifications = action.slice(6); return redraw(notifState(list)); }
  if (action === "down" || action === "up") {
    if (!rows.length) return { keep: true };
    barFocus.notifications = rows[(st.cursor + (action === "down" ? 1 : rows.length - 1)) % rows.length].id;
    return redraw(notifState(list));
  }
  if (!focused) return { keep: true };
  switch (action) {
    case "copy": return { copy: focused.url };
    case "read": {
      const r = await pickNotif(focused.id, "read");
      if (r.toast?.style === "failure") return r;
      // The cursor stays at its index: the next thread slides under it.
      const next = notifState(await notifications());
      const at = Math.min(st.cursor, Math.max(0, shownNotifs(next.list).length - 1));
      barFocus.notifications = shownNotifs(next.list)[at]?.id;
      return { keep: true, view: renderNotifs({ ...next, cursor: at }) };
    }
    default: return pickNotif(focused.id);
  }
}

// ---- search -----------------------------------------------------------------

const SEARCH_FILTERS = [{ id: "all", title: "Everything" }, { id: "issues", title: "Issues and PRs" }, { id: "repos", title: "Repositories" }, { id: "users", title: "Users" }];
const searchCache = new Map<string, { at: number; rows: Item[] }>();
let searchSeq = 0;
let lastSearch: Item[] = [];

async function searchRows(query = "", ctx?: Ctx): Promise<Item[]> {
  const q = query.trim(), kind = (ctx?.filter ?? "all") as SearchKind;
  if (q.length < 2) return [hint("search", "Search GitHub", "Text, repo:owner/name, is:pr, author:login, label:bug")];
  const key = `${kind}\0${q}`;
  const c = searchCache.get(key);
  if (c && Date.now() - c.at < TTL * 1000) return c.rows;
  // A newer keystroke supersedes this one: wait a beat, and answer the last rows if one came.
  const seq = ++searchSeq;
  await Bun.sleep(SEARCH_WAIT_MS);
  if (seq !== searchSeq) return lastSearch;
  const r = await search(q, kind);
  const rows = [
    ...r.issues.map((x) => (x.kind === "pr" ? prRow(x, "Pull requests") : issueRow(x, "Issues"))),
    ...r.repos.map((x) => repoRow(x, "Repositories")),
    ...r.users.map((x) => userRow(x, "Users")),
  ];
  const out = rows.length ? rows : [hint("empty", "No results", `Nothing on GitHub matches "${q}"`)];
  searchCache.set(key, { at: Date.now(), rows: out });
  if (searchCache.size > 50) searchCache.delete(searchCache.keys().next().value!);
  lastSearch = out;
  return out;
}

/** A pick from the search level: the row's kind is in its table, or in the shape of its id. */
async function pickAny(id: string, action?: string, ctx?: Ctx): Promise<Effect | void> {
  if (id.startsWith("hint:")) return pickHint(id);
  const pr = prTable.get(id);
  if (pr) return pickPR(pr, action);
  const issue = issueTable.get(id);
  if (issue) return pickIssue(issue, action);
  const repo = repoTable.get(id);
  if (repo) return pickRepo(repo, action, ctx);
  const user = userTable.get(id);
  if (user) return pickUser(user, action);
  if (splitId(id)) {
    const pr = await findPR(id).catch(() => undefined);
    if (pr) return pickPR(pr, action);
    return pickIssue(await findIss(id), action);
  }
  if (id.startsWith("@")) return pickUser({ kind: "user", id, login: id.slice(1), name: "", url: `https://github.com/${id.slice(1)}`, avatar: "", bio: "", org: false }, action);
  if (/^[^/\s]+\/[^/\s]+$/.test(id)) return pickRepo((await findRepo(id)) ?? { kind: "repo", id, name: id.split("/")[1], owner: id.split("/")[0], url: `https://github.com/${id}`, description: "", language: null, stars: 0, forks: 0, issues: 0, private: false, fork: false, archived: false, defaultBranch: "main", pushedAt: "", ssh: `git@github.com:${id}.git`, https: `https://github.com/${id}.git` }, action, ctx);
  throw new Error(`no row ${id}`);
}

/** Rows or the failure hint, never a thrown listing: the panel would show an error where a sentence does. */
const guard = async (f: () => Promise<Item[]>): Promise<Item[]> => { try { return await f(); } catch (e) { return failure(e); } };

/** The pane for a PR or issue row, asked lazily; the failure is the text of the pane. */
const pane = async (f: () => Promise<Detail>): Promise<Detail> => { try { return await f(); } catch (e) { return { markdown: `_${errorMessage(e)}_` }; } };

const limitHint = (): Item[] => (rateLimit && rateLimit.remaining === 0 && rateLimit.resetAt.getTime() > Date.now() ? [hint("limit", "GitHub rate limit reached", `Resets at ${clock(rateLimit.resetAt)}; showing what was cached`)] : []);

export default {
  palettes: {
    prs: {
      title: "Pull Requests",
      showDetail: true,
      filters: PR_FILTERS,
      list: (_q, ctx) => guard(async () => [...limitHint(), ...(await prRows(ctx))]),
      pick: async (id, action) => (id.startsWith("hint:") ? pickHint(id) : pickPR(await findPr(id), action)),
      detail: async (id) => (id.startsWith("hint:") ? undefined : pane(async () => prPane(await findPr(id)))),
    },
    issues: {
      title: "Issues",
      showDetail: true,
      filters: ISSUE_FILTERS,
      list: (_q, ctx) => guard(async () => [...limitHint(), ...(await issueRows(ctx))]),
      pick: async (id, action, ctx) => {
        if (id.startsWith("hint:")) return pickHint(id);
        if (id === CREATE) return action === "save" ? saveIssue(ctx?.values ?? {}) : { form: await issueForm() };
        return pickIssue(await findIss(id), action);
      },
      detail: async (id) => (id.startsWith("hint:") || id === CREATE ? undefined : pane(async () => issuePane(await findIss(id)))),
    },
    repos: {
      title: "Repositories",
      filters: REPO_FILTERS,
      list: (_q, ctx) => guard(async () => [...limitHint(), ...(await repoRows(ctx))]),
      pick: async (id, action, ctx) => {
        if (id.startsWith("hint:")) return pickHint(id);
        if (id === CREATE) return action === "save" ? saveRepo(ctx?.values ?? {}) : { form: await repoForm() };
        const r = await findRepo(id);
        if (!r) throw new Error(`no repository ${id}`);
        return pickRepo(r, action, ctx);
      },
    },
    notifications: {
      title: "Notifications",
      live: true,
      list: (_q, ctx) => guard(async () => [...limitHint(), ...(await notifRows(ctx))]),
      pick: (id, action) => (id.startsWith("hint:") ? pickHint(id) : pickNotif(id, action)),
    },
    search: {
      title: "Search GitHub",
      input: true,
      placeholder: "Text, repo:owner/name, is:pr, author:login",
      filters: SEARCH_FILTERS,
      list: (query, ctx) => guard(() => searchRows(query, ctx)),
      pick: pickAny,
      detail: async (id) => {
        const pr = prTable.get(id), issue = issueTable.get(id);
        if (pr) return pane(() => prPane(pr));
        if (issue) return pane(() => issuePane(issue));
      },
    },
  },
  bar: {
    notifications: { render: notifItem, onAction: notifAction },
    prs: { render: prsItem, onAction: prsAction },
    issues: { render: issuesItem, onAction: issuesAction },
  },
} satisfies Extension;
