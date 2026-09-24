// What the palettes list, in the extension's own shapes, and how each is
// fetched. Lists that need per-row facts the REST search cannot give
// (checks, review decision, branch, size) go through one GraphQL request
// carrying every filter's query as an alias, so "all" and each filter are
// the same cached answer; notifications and repositories are REST, which
// carries ETags, so a re-list is a 304.
import { cached, conf, gql, rest, restLoader } from "./api.ts";

/** Seconds a listing is good for; the palettes' `ttl` and the cache agree. */
export const TTL = 300;
export const NOTIF_TTL = 60;
const ms = (s: number) => s * 1000;
const PAGE = 50;

export type Rollup = "SUCCESS" | "FAILURE" | "ERROR" | "PENDING" | "EXPECTED" | undefined;
export type Label = { name: string; color: string };
export type PR = {
  kind: "pr";
  /** `owner/repo#n`: the row id. */
  id: string;
  nodeId: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  author: string;
  avatar: string;
  state: "open" | "merged" | "closed";
  draft: boolean;
  head: string;
  base: string;
  /** Absent on a search result (`PR_LITE_FRAGMENT`), as are the review decision, mergeable, checks and reviewers. */
  additions?: number;
  deletions?: number;
  /** `APPROVED`, `CHANGES_REQUESTED`, `REVIEW_REQUIRED`, or null. */
  review: string | null;
  /** `MERGEABLE`, `CONFLICTING`, `UNKNOWN`. */
  mergeable: string;
  checks: Rollup;
  labels: Label[];
  reviewers: string[];
  updatedAt: string;
  createdAt: string;
  mergedAt: string | null;
};
export type Issue = {
  kind: "issue";
  id: string;
  nodeId: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  author: string;
  avatar: string;
  state: "open" | "closed";
  labels: Label[];
  assignees: string[];
  comments: number;
  updatedAt: string;
  createdAt: string;
};
export type Repo = {
  kind: "repo";
  /** `owner/name`: the row id. */
  id: string;
  name: string;
  owner: string;
  url: string;
  description: string;
  language: string | null;
  stars: number;
  forks: number;
  issues: number;
  private: boolean;
  fork: boolean;
  archived: boolean;
  defaultBranch: string;
  pushedAt: string;
  ssh: string;
  https: string;
};
export type User = { kind: "user"; id: string; login: string; name: string; url: string; avatar: string; bio: string; org: boolean };
export type Notification = {
  kind: "notification";
  /** `thread:<id>`: the row id. */
  id: string;
  thread: string;
  title: string;
  repo: string;
  reason: string;
  /** `PullRequest`, `Issue`, `Release`, `Discussion`, `Commit`, ... */
  type: string;
  url: string;
  updatedAt: string;
};
export type Viewer = { login: string; avatar: string };

export const splitId = (id: string): { owner: string; name: string; number: number } | undefined => {
  const m = id.match(/^([^/#\s]+)\/([^/#\s]+)#(\d+)$/);
  return m ? { owner: m[1], name: m[2], number: Number(m[3]) } : undefined;
};

// ---- GraphQL shapes ------------------------------------------------------

type GqlLabels = { nodes: { name: string; color: string }[] };
type GqlActor = { login: string; avatarUrl: string } | null;
type GqlPR = {
  __typename?: "PullRequest";
  id: string; number: number; title: string; url: string; isDraft: boolean; state: "OPEN" | "MERGED" | "CLOSED";
  updatedAt: string; createdAt: string; mergedAt: string | null;
  author: GqlActor; repository: { nameWithOwner: string };
  headRefName: string; baseRefName: string; additions?: number; deletions?: number;
  reviewDecision?: string | null; mergeable?: string;
  labels: GqlLabels;
  reviewRequests?: { nodes: { requestedReviewer: { login?: string; name?: string } | null }[] };
  commits?: { nodes: { commit: { statusCheckRollup: { state: string } | null } }[] };
};
type GqlIssue = {
  __typename?: "Issue";
  id: string; number: number; title: string; url: string; state: "OPEN" | "CLOSED"; updatedAt: string; createdAt: string;
  author: GqlActor; repository: { nameWithOwner: string }; labels: GqlLabels; comments: { totalCount: number }; assignees: { nodes: { login: string }[] };
};
type GqlRepo = {
  __typename?: "Repository";
  nameWithOwner: string; name: string; owner: { login: string }; url: string; description: string | null;
  primaryLanguage: { name: string } | null; stargazerCount: number; forkCount: number; issues: { totalCount: number };
  isPrivate: boolean; isFork: boolean; isArchived: boolean; defaultBranchRef: { name: string } | null; pushedAt: string | null; sshUrl: string;
};
type GqlUser = { __typename?: "User" | "Organization"; login: string; name: string | null; url: string; avatarUrl: string; bio?: string | null; description?: string | null };

const PR_FRAGMENT = `fragment PR on PullRequest {
  id number title url isDraft state updatedAt createdAt mergedAt
  author { login avatarUrl } repository { nameWithOwner }
  headRefName baseRefName additions deletions reviewDecision mergeable
  labels(first: 10) { nodes { name color } }
  reviewRequests(first: 10) { nodes { requestedReviewer { ... on User { login } ... on Team { name } } } }
  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
}`;
/**
 * What a search asks of a pull request: the row without the fields GitHub
 * computes per result (mergeable above all, then the checks rollup, the
 * review requests and the size), which made three searches 4.6-5.7 s
 * against 1.3-1.7 s without them. The pane fetches the checks by name anyway.
 */
const PR_LITE_FRAGMENT = `fragment PR on PullRequest {
  id number title url isDraft state updatedAt createdAt mergedAt
  author { login avatarUrl } repository { nameWithOwner }
  headRefName baseRefName
  labels(first: 10) { nodes { name color } }
}`;
const ISSUE_FRAGMENT = `fragment Issue on Issue {
  id number title url state updatedAt createdAt
  author { login avatarUrl } repository { nameWithOwner }
  labels(first: 10) { nodes { name color } } comments { totalCount } assignees(first: 5) { nodes { login } }
}`;
const REPO_FRAGMENT = `fragment Repo on Repository {
  nameWithOwner name owner { login } url description primaryLanguage { name } stargazerCount forkCount issues(states: OPEN) { totalCount }
  isPrivate isFork isArchived defaultBranchRef { name } pushedAt sshUrl
}`;
const USER_FRAGMENT = `fragment User on User { login name url avatarUrl bio }
fragment Org on Organization { login name url avatarUrl description }`;

const toPR = (n: GqlPR): PR => {
  const repo = n.repository.nameWithOwner;
  return {
    kind: "pr", id: `${repo}#${n.number}`, nodeId: n.id, repo, number: n.number, title: n.title, url: n.url,
    author: n.author?.login ?? "ghost", avatar: n.author?.avatarUrl ?? "",
    state: n.state === "MERGED" ? "merged" : n.state === "CLOSED" ? "closed" : "open", draft: n.isDraft,
    head: n.headRefName, base: n.baseRefName, additions: n.additions, deletions: n.deletions,
    review: n.reviewDecision ?? null, mergeable: n.mergeable ?? "UNKNOWN", checks: (n.commits?.nodes[0]?.commit.statusCheckRollup?.state as Rollup) ?? undefined,
    labels: n.labels.nodes, reviewers: (n.reviewRequests?.nodes ?? []).map((r) => r.requestedReviewer?.login ?? r.requestedReviewer?.name ?? "").filter(Boolean),
    updatedAt: n.updatedAt, createdAt: n.createdAt, mergedAt: n.mergedAt,
  };
};
const toIssue = (n: GqlIssue): Issue => {
  const repo = n.repository.nameWithOwner;
  return {
    kind: "issue", id: `${repo}#${n.number}`, nodeId: n.id, repo, number: n.number, title: n.title, url: n.url,
    author: n.author?.login ?? "ghost", avatar: n.author?.avatarUrl ?? "", state: n.state === "CLOSED" ? "closed" : "open",
    labels: n.labels.nodes, assignees: n.assignees.nodes.map((a) => a.login), comments: n.comments.totalCount, updatedAt: n.updatedAt, createdAt: n.createdAt,
  };
};
const toRepoGql = (n: GqlRepo): Repo => ({
  kind: "repo", id: n.nameWithOwner, name: n.name, owner: n.owner.login, url: n.url, description: (n.description ?? "").slice(0, 200),
  language: n.primaryLanguage?.name ?? null, stars: n.stargazerCount, forks: n.forkCount, issues: n.issues.totalCount,
  private: n.isPrivate, fork: n.isFork, archived: n.isArchived, defaultBranch: n.defaultBranchRef?.name ?? "main", pushedAt: n.pushedAt ?? "",
  ssh: n.sshUrl, https: `${n.url}.git`,
});
const toUser = (n: GqlUser): User => ({ kind: "user", id: `@${n.login}`, login: n.login, name: n.name ?? "", url: n.url, avatar: n.avatarUrl, bio: n.bio ?? n.description ?? "", org: n.__typename === "Organization" });

// ---- pull requests ------------------------------------------------------

export type PRLists = { mine: PR[]; reviews: PR[]; merged: PR[] };
const day = (d: Date) => d.toISOString().slice(0, 10);

/** The three lists in one request; the query strings are the GitHub search syntax the docs use. */
export function prs(refresh = false): Promise<PRLists> {
  const days = Math.max(1, Number(conf().merged_days) || 7);
  const since = day(new Date(Date.now() - days * 86_400_000));
  return cached<PRLists>("prs", ms(TTL), refresh, async () => {
    const d = await gql<{ mine: { nodes: GqlPR[] }; reviews: { nodes: GqlPR[] }; merged: { nodes: GqlPR[] } }>("PRs", `${PR_FRAGMENT}
query PRs($mine: String!, $reviews: String!, $merged: String!, $n: Int!) {
  mine: search(query: $mine, type: ISSUE, first: $n) { nodes { ...PR } }
  reviews: search(query: $reviews, type: ISSUE, first: $n) { nodes { ...PR } }
  merged: search(query: $merged, type: ISSUE, first: $n) { nodes { ...PR } }
  rateLimit { remaining resetAt }
}`, { mine: "is:pr is:open author:@me sort:updated-desc", reviews: "is:pr is:open review-requested:@me sort:updated-desc", merged: `is:pr is:merged author:@me merged:>=${since} sort:updated-desc`, n: PAGE });
    const only = (nodes: GqlPR[]) => nodes.filter((n) => n && n.number !== undefined).map(toPR);
    return { data: { mine: only(d.mine.nodes), reviews: only(d.reviews.nodes), merged: only(d.merged.nodes) } };
  });
}

export type PRDetail = {
  body: string;
  comments: number;
  reviews: { author: string; state: string; body: string; at: string }[];
  latest: { author: string; body: string; at: string }[];
  checks: { name: string; state: "ok" | "bad" | "run" | "skip" }[];
};
const checkState = (c: { conclusion?: string | null; status?: string; state?: string }): PRDetail["checks"][number]["state"] => {
  const s = c.conclusion ?? c.state ?? c.status ?? "";
  if (["SUCCESS", "NEUTRAL"].includes(s)) return "ok";
  if (["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"].includes(s)) return "bad";
  if (["SKIPPED"].includes(s)) return "skip";
  return "run";
};

export async function prDetail(owner: string, name: string, number: number): Promise<PRDetail> {
  type R = { repository: { pullRequest: {
    body: string; comments: { totalCount: number; nodes: { author: GqlActor; body: string; createdAt: string }[] };
    reviews: { nodes: { author: GqlActor; state: string; body: string; submittedAt: string }[] };
    commits: { nodes: { commit: { statusCheckRollup: { contexts: { nodes: ({ name: string; conclusion: string | null; status: string } | { context: string; state: string })[] } } | null } }[] };
  } | null } };
  const d = await gql<R>("PRDetail", `query PRDetail($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) { pullRequest(number: $number) {
    body
    comments(last: 5) { totalCount nodes { author { login avatarUrl } body createdAt } }
    reviews(last: 10) { nodes { author { login avatarUrl } state body submittedAt } }
    commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 50) { nodes { ... on CheckRun { name conclusion status } ... on StatusContext { context state } } } } } } }
  } }
}`, { owner, name, number });
  const p = d.repository?.pullRequest;
  if (!p) throw new Error(`no pull request ${owner}/${name}#${number}`);
  return {
    body: p.body ?? "",
    comments: p.comments.totalCount,
    reviews: p.reviews.nodes.map((r) => ({ author: r.author?.login ?? "ghost", state: r.state, body: r.body, at: r.submittedAt })),
    latest: p.comments.nodes.map((c) => ({ author: c.author?.login ?? "ghost", body: c.body, at: c.createdAt })),
    checks: (p.commits.nodes[0]?.commit.statusCheckRollup?.contexts.nodes ?? []).map((c) => ({ name: "name" in c ? c.name : c.context, state: checkState(c) })),
  };
}

/** One PR by id, for a pick after the listing that had it is gone (a restart, an expired cache). */
export async function findPR(id: string): Promise<PR | undefined> {
  const s = splitId(id);
  if (!s) return;
  const d = await gql<{ repository: { pullRequest: GqlPR | null } | null }>("FindPR", `${PR_FRAGMENT}
query FindPR($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { pullRequest(number: $number) { ...PR } } }`, s);
  const n = d.repository?.pullRequest;
  return n ? toPR(n) : undefined;
}

export async function mergePR(pr: PR): Promise<void> {
  const s = splitId(pr.id)!;
  await rest("PUT", `/repos/${s.owner}/${s.name}/pulls/${s.number}/merge`, { body: { merge_method: conf().merge_method || "merge" } });
}

export async function markReady(pr: PR): Promise<void> {
  await gql("MarkReady", `mutation MarkReady($id: ID!) { markPullRequestReadyForReview(input: { pullRequestId: $id }) { pullRequest { isDraft } } }`, { id: pr.nodeId });
}

// ---- issues -------------------------------------------------------------

export type IssueLists = { assigned: Issue[]; mentioned: Issue[]; created: Issue[] };

export function issues(refresh = false): Promise<IssueLists> {
  return cached<IssueLists>("issues", ms(TTL), refresh, async () => {
    const d = await gql<{ assigned: { nodes: GqlIssue[] }; mentioned: { nodes: GqlIssue[] }; created: { nodes: GqlIssue[] } }>("Issues", `${ISSUE_FRAGMENT}
query Issues($assigned: String!, $mentioned: String!, $created: String!, $n: Int!) {
  assigned: search(query: $assigned, type: ISSUE, first: $n) { nodes { ...Issue } }
  mentioned: search(query: $mentioned, type: ISSUE, first: $n) { nodes { ...Issue } }
  created: search(query: $created, type: ISSUE, first: $n) { nodes { ...Issue } }
  rateLimit { remaining resetAt }
}`, { assigned: "is:issue is:open assignee:@me sort:updated-desc", mentioned: "is:issue is:open mentions:@me sort:updated-desc", created: "is:issue is:open author:@me sort:updated-desc", n: PAGE });
    const only = (nodes: GqlIssue[]) => nodes.filter((n) => n && n.number !== undefined).map(toIssue);
    return { data: { assigned: only(d.assigned.nodes), mentioned: only(d.mentioned.nodes), created: only(d.created.nodes) } };
  });
}

export type IssueDetail = { body: string; comments: number; latest: { author: string; body: string; at: string }[]; milestone: string | null };

export async function issueDetail(owner: string, name: string, number: number): Promise<IssueDetail> {
  type R = { repository: { issue: { body: string; milestone: { title: string } | null; comments: { totalCount: number; nodes: { author: GqlActor; body: string; createdAt: string }[] } } | null } };
  const d = await gql<R>("IssueDetail", `query IssueDetail($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) { issue(number: $number) {
    body milestone { title } comments(last: 5) { totalCount nodes { author { login avatarUrl } body createdAt } }
  } }
}`, { owner, name, number });
  const i = d.repository?.issue;
  if (!i) throw new Error(`no issue ${owner}/${name}#${number}`);
  return { body: i.body ?? "", comments: i.comments.totalCount, latest: i.comments.nodes.map((c) => ({ author: c.author?.login ?? "ghost", body: c.body, at: c.createdAt })), milestone: i.milestone?.title ?? null };
}

export async function findIssue(id: string): Promise<Issue | undefined> {
  const s = splitId(id);
  if (!s) return;
  const d = await gql<{ repository: { issue: GqlIssue | null } | null }>("FindIssue", `${ISSUE_FRAGMENT}
query FindIssue($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { issue(number: $number) { ...Issue } } }`, s);
  const n = d.repository?.issue;
  return n ? toIssue(n) : undefined;
}

export async function closeIssue(issue: Issue): Promise<void> {
  const s = splitId(issue.id)!;
  await rest("PATCH", `/repos/${s.owner}/${s.name}/issues/${s.number}`, { body: { state: "closed" } });
}

export async function createIssue(repo: string, title: string, body: string): Promise<{ url: string; number: number }> {
  const r = await rest<{ html_url: string; number: number }>("POST", `/repos/${repo}/issues`, { body: { title, body } });
  return { url: r.data.html_url, number: r.data.number };
}

// ---- repositories (REST, ETag) ---------------------------------------------

type RestRepo = {
  full_name: string; name: string; owner: { login: string }; html_url: string; description: string | null; language: string | null;
  stargazers_count: number; forks_count: number; open_issues_count: number; private: boolean; fork: boolean; archived: boolean;
  default_branch: string; pushed_at: string | null; ssh_url: string; clone_url: string;
};
const toRepo = (r: RestRepo): Repo => ({
  kind: "repo", id: r.full_name, name: r.name, owner: r.owner.login, url: r.html_url, description: (r.description ?? "").slice(0, 200), language: r.language,
  stars: r.stargazers_count, forks: r.forks_count, issues: r.open_issues_count, private: r.private, fork: r.fork, archived: r.archived,
  defaultBranch: r.default_branch, pushedAt: r.pushed_at ?? "", ssh: r.ssh_url, https: r.clone_url,
});
const repoList = (path: string) => restLoader<RestRepo[], Repo[]>(path, (raw) => (Array.isArray(raw) ? raw : []).map(toRepo));

export const myRepos = (refresh = false) => cached<Repo[]>("repos:mine", ms(TTL), refresh, repoList("/user/repos?affiliation=owner,collaborator&sort=pushed&per_page=100"));
export const starredRepos = (refresh = false) => cached<Repo[]>("repos:starred", ms(TTL), refresh, repoList("/user/starred?sort=updated&per_page=100"));
export const orgRepos = (org: string, refresh = false) => cached<Repo[]>(`repos:org:${org}`, ms(TTL), refresh, repoList(`/orgs/${encodeURIComponent(org)}/repos?sort=pushed&per_page=50`));

export async function createRepo(owner: string | undefined, name: string, description: string, isPrivate: boolean): Promise<Repo> {
  const body = { name, description, private: isPrivate };
  const r = await rest<RestRepo>("POST", owner ? `/orgs/${encodeURIComponent(owner)}/repos` : "/user/repos", { body });
  return toRepo(r.data);
}

export const viewer = () => cached<Viewer>("viewer", ms(3600), false, restLoader<{ login: string; avatar_url: string }, Viewer>("/user", (u) => ({ login: u.login, avatar: u.avatar_url })));

// ---- notifications (REST, ETag) ------------------------------------------

type RestNotification = {
  id: string; unread: boolean; reason: string; updated_at: string;
  subject: { title: string; url: string | null; latest_comment_url: string | null; type: string };
  repository: { full_name: string; html_url: string };
};

/** The page the subject lives on, from its API url: pulls and issues by number, a commit by sha, the rest the repository's own page. */
export function subjectUrl(n: RestNotification): string {
  const repo = n.repository.html_url;
  const u = n.subject.url ?? "";
  let m = u.match(/\/(pulls|issues)\/(\d+)$/);
  if (m) return `${repo}/${m[1] === "pulls" ? "pull" : "issues"}/${m[2]}`;
  m = u.match(/\/commits\/([0-9a-f]+)$/);
  if (m) return `${repo}/commit/${m[1]}`;
  if (n.subject.type === "Release") return `${repo}/releases`;
  if (n.subject.type === "Discussion") return `${repo}/discussions`;
  return repo;
}
const toNotification = (n: RestNotification): Notification => ({ kind: "notification", id: `thread:${n.id}`, thread: n.id, title: n.subject.title, repo: n.repository.full_name, reason: n.reason, type: n.subject.type, url: subjectUrl(n), updatedAt: n.updated_at });

export const notifications = (refresh = false) =>
  cached<Notification[]>("notifications", ms(NOTIF_TTL), refresh, restLoader<RestNotification[], Notification[]>("/notifications?per_page=50", (raw) => (Array.isArray(raw) ? raw : []).filter((n) => n.unread).map(toNotification)));

export const markRead = (thread: string) => rest("PATCH", `/notifications/threads/${thread}`);
export const markAllRead = () => rest("PUT", "/notifications", { body: { last_read_at: new Date().toISOString(), read: true } });

// ---- search -------------------------------------------------------------

export type SearchKind = "all" | "issues" | "repos" | "users";
/** How near a result is to the viewer: something they took part in, something in their own account or organisations, or anywhere on GitHub. */
export type Tier = "involved" | "near" | "rest";
export type Found<T> = { tier: Tier; item: T };
export type SearchResult = { issues: Found<PR | Issue>[]; repos: Found<Repo>[]; users: User[]; scoped: boolean };

export const myOrgs = () => cached<string[]>("orgs", ms(3600), false, restLoader<{ login: string }[], string[]>("/user/orgs?per_page=100", (raw) => (Array.isArray(raw) ? raw : []).map((o) => o.login)));

/** The viewer's own account and organisations as search qualifiers (`user:zcag org:acme`), which GitHub ORs; empty when none is known. */
async function nearScope(): Promise<string> {
  const [me, orgs] = await Promise.all([viewer().catch(() => undefined), myOrgs().catch(() => [] as string[])]);
  const owners = new Set(orgs), org = conf().default_org?.trim();
  if (org) owners.add(org);
  return [me ? `user:${me.login}` : "", ...[...owners].map((o) => `org:${o}`)].filter(Boolean).join(" ");
}

/**
 * The GitHub search syntax goes through as typed, asked once per tier and
 * deduplicated nearest first: `involves:@me` (authored, assigned,
 * mentioned, commented), then the viewer's account and organisations, then
 * everywhere. A query naming its own `repo:`, `org:` or `user:` skips the
 * middle tier, and one naming `involves:` the first. `is:pr`, `repo:` and the
 * like narrow "all" to issues and pull requests on their own.
 */
export async function search(q: string, kind: SearchKind): Promise<SearchResult> {
  const issueOnly = /(^|\s)(is|repo|author|assignee|mentions|involves|commenter|review-requested|label|state|type):/i.test(q);
  const scoped = /(^|\s)-?(repo|org|user):/i.test(q);
  const want = { issues: kind === "all" || kind === "issues", repos: kind === "repos" || (kind === "all" && !issueOnly), users: kind === "users" || (kind === "all" && !issueOnly) };
  const near = scoped || !(want.issues || want.repos) ? "" : await nearScope();
  const tiers: [Tier, string][] = [["near", near && `${q} ${near}`], ["rest", q]];
  const issueTiers: [Tier, string][] = [["involved", /(^|\s)involves:/i.test(q) ? "" : `${q} involves:@me`], ...tiers];
  // One request per search, all at once: GitHub answers the aliases of one request one after another (about 2 s each),
  // and a tier that fails drops out rather than taking the others with it.
  const asks: { key: string; tier?: Tier; q: string; type: string; first: number; nodes: string; fragments: string }[] = [
    ...(want.issues ? issueTiers.filter(([, s]) => s).map(([tier, s]) => ({ key: `issues_${tier}`, tier, q: s, type: "ISSUE", first: 20, nodes: "__typename ...PR ...Issue", fragments: `${PR_LITE_FRAGMENT}\n${ISSUE_FRAGMENT}` })) : []),
    ...(want.repos ? tiers.filter(([, s]) => s).map(([tier, s]) => ({ key: `repos_${tier}`, tier, q: s, type: "REPOSITORY", first: 10, nodes: "__typename ...Repo", fragments: REPO_FRAGMENT })) : []),
    ...(want.users ? [{ key: "users", q, type: "USER", first: 5, nodes: "__typename ...User ...Org", fragments: USER_FRAGMENT }] : []),
  ];
  const answers = await Promise.allSettled(asks.map((a) => gql<{ found: { nodes: any[] } }>("Search", `${a.fragments}
query Search($q: String!) {
  found: search(query: $q, type: ${a.type}, first: ${a.first}) { nodes { ${a.nodes} } }
  rateLimit { remaining resetAt }
}`, { q: a.q })));
  if (!answers.some((r) => r.status === "fulfilled")) throw (answers[0] as PromiseRejectedResult).reason;
  const d: Record<string, { nodes: any[] } | undefined> = Object.fromEntries(asks.map((a, i) => [a.key, answers[i].status === "fulfilled" ? answers[i].value.found : undefined]));
  const seen = new Set<string>();
  const found = <T extends { id: string }>(prefix: string, ok: (n: any) => boolean, map: (n: any) => T): Found<T>[] =>
    asks.filter((a) => a.key.startsWith(prefix)).flatMap((a) => (d[a.key]?.nodes ?? []).filter((n) => n && ok(n)).map((n) => ({ tier: a.tier!, item: map(n) })))
      .filter((f) => !seen.has(f.item.id) && !!seen.add(f.item.id));
  return {
    issues: found("issues_", (n) => "number" in n, (n) => (n.__typename === "PullRequest" || "headRefName" in n ? toPR(n as GqlPR) : toIssue(n as GqlIssue))),
    repos: found("repos_", (n) => "nameWithOwner" in n, toRepoGql),
    users: (d.users?.nodes ?? []).filter((n) => n && "login" in n).map(toUser),
    scoped,
  };
}

