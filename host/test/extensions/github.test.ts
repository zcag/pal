// GitHub against a local mock of api.github.com: a Bun server serving
// fixture JSON per endpoint (GraphQL dispatched on the operation name),
// reached through `PAL_GITHUB_API`, with `PAL_GITHUB_TOKEN` standing in
// for `gh auth token`. Rows, sections, accessories and actions per
// palette, the filters, the lazy detail, an ETag hit on re-list, the
// mutations, the create forms, and the hint when nothing can sign in.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tinted } from "../../../sdk/src/icon.ts";
import type { Form } from "../../../sdk/src/protocol.ts";
import { Host, stored } from "../harness.ts";

// ---- fixtures ---------------------------------------------------------------

const actor = (login: string) => ({ login, avatarUrl: `https://avatars.githubusercontent.com/${login}` });
const pr = (o: Record<string, unknown> & { number: number; repo: string; title: string }) => ({
  id: `PR_${o.number}`, url: `https://github.com/${o.repo}/pull/${o.number}`, isDraft: false, state: "OPEN",
  updatedAt: "2026-09-15T10:00:00Z", createdAt: "2026-09-01T10:00:00Z", mergedAt: null,
  author: actor("zcag"), repository: { nameWithOwner: o.repo }, headRefName: `feat-${o.number}`, baseRefName: "main", additions: 10, deletions: 2,
  reviewDecision: null, mergeable: "MERGEABLE", labels: { nodes: [] }, reviewRequests: { nodes: [] },
  commits: { nodes: [{ commit: { statusCheckRollup: { state: "SUCCESS" } } }] },
  ...o,
});
const issue = (o: Record<string, unknown> & { number: number; repo: string; title: string }) => ({
  id: `I_${o.number}`, url: `https://github.com/${o.repo}/issues/${o.number}`, state: "OPEN",
  updatedAt: "2026-09-14T10:00:00Z", createdAt: "2026-09-02T10:00:00Z", author: actor("alice"), repository: { nameWithOwner: o.repo },
  labels: { nodes: [] }, comments: { totalCount: 0 }, assignees: { nodes: [] },
  ...o,
});
const restRepo = (full: string, o: Partial<Record<string, unknown>> = {}) => ({
  full_name: full, name: full.split("/")[1], owner: { login: full.split("/")[0] }, html_url: `https://github.com/${full}`, description: `About ${full}`,
  language: "TypeScript", stargazers_count: 12, forks_count: 1, open_issues_count: 3, private: false, fork: false, archived: false,
  default_branch: "main", pushed_at: "2026-09-10T10:00:00Z", ssh_url: `git@github.com:${full}.git`, clone_url: `https://github.com/${full}.git`,
  ...o,
});

const PRS = {
  mine: [
    pr({ number: 71, repo: "acme/widgets", title: "Directory readiness", reviewDecision: "REVIEW_REQUIRED", mergeable: "CONFLICTING", reviewRequests: { nodes: [{ requestedReviewer: { login: "bob" } }] }, labels: { nodes: [{ name: "ops", color: "ededed" }] } }),
    pr({ number: 72, repo: "zcag/pal", title: "Draft thing", isDraft: true, commits: { nodes: [{ commit: { statusCheckRollup: null } }] } }),
  ],
  reviews: [
    pr({ number: 9, repo: "acme/api", title: "Fix the parser", author: actor("bob"), reviewDecision: "CHANGES_REQUESTED", commits: { nodes: [{ commit: { statusCheckRollup: { state: "FAILURE" } } }] } }),
    pr({ number: 71, repo: "acme/widgets", title: "Directory readiness" }),
  ],
  merged: [pr({ number: 50, repo: "zcag/pal", title: "Landed", state: "MERGED", mergedAt: "2026-09-12T10:00:00Z", reviewDecision: "APPROVED" })],
};
const ISSUES = {
  assigned: [issue({ number: 5, repo: "acme/widgets", title: "Crash on start", labels: { nodes: [{ name: "bug", color: "d73a4a" }, { name: "p1", color: "ffffff" }, { name: "x", color: "000000" }] }, comments: { totalCount: 3 }, assignees: { nodes: [{ login: "zcag" }] } })],
  mentioned: [issue({ number: 5, repo: "acme/widgets", title: "Crash on start" }), issue({ number: 8, repo: "acme/api", title: "Slow endpoint", comments: { totalCount: 1 } })],
  created: [issue({ number: 3, repo: "zcag/pal", title: "Write docs", author: actor("zcag"), state: "CLOSED" })],
};
const NOTIFICATIONS = [
  { id: "1001", unread: true, reason: "subscribed", updated_at: "2026-09-15T08:00:00Z", subject: { title: "v1.2 released", url: "https://api.github.com/repos/acme/api/releases/77", latest_comment_url: null, type: "Release" }, repository: { full_name: "acme/api", html_url: "https://github.com/acme/api" } },
  { id: "1002", unread: true, reason: "review_requested", updated_at: "2026-09-15T09:00:00Z", subject: { title: "Fix the parser", url: "https://api.github.com/repos/acme/api/pulls/9", latest_comment_url: null, type: "PullRequest" }, repository: { full_name: "acme/api", html_url: "https://github.com/acme/api" } },
  { id: "1003", unread: true, reason: "mention", updated_at: "2026-09-15T07:00:00Z", subject: { title: "Crash on start", url: "https://api.github.com/repos/acme/widgets/issues/5", latest_comment_url: null, type: "Issue" }, repository: { full_name: "acme/widgets", html_url: "https://github.com/acme/widgets" } },
  { id: "1004", unread: false, reason: "assign", updated_at: "2026-09-15T06:00:00Z", subject: { title: "Already read", url: null, latest_comment_url: null, type: "Issue" }, repository: { full_name: "acme/widgets", html_url: "https://github.com/acme/widgets" } },
];
const REPOS = {
  mine: [restRepo("zcag/pal", { private: true, language: "Rust", stargazers_count: 0 }), restRepo("zcag/dotty")],
  starred: [restRepo("oven-sh/bun", { stargazers_count: 80000, language: "Zig" }), restRepo("zcag/pal", { private: true })],
  org: [restRepo("acme/widgets"), restRepo("acme/api", { archived: true })],
};

// ---- the mock server ----------------------------------------------------------

type Seen = { method: string; path: string; op?: string; etag?: string; body?: any };
const seen: Seen[] = [];
const NOTIF_ETAG = 'W/"notif-1"', REPOS_ETAG = 'W/"repos-1"';
const json = (data: unknown, init: ResponseInit = {}) => Response.json(data, { ...init, headers: { "x-ratelimit-remaining": "4999", "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 3600), ...(init.headers as Record<string, string>) } });

const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    const etag = req.headers.get("if-none-match") ?? undefined;
    if (req.headers.get("authorization") !== "Bearer test-token") return json({ message: "Bad credentials" }, { status: 401 });
    if (req.method === "POST" && url.pathname === "/graphql") {
      const body = (await req.json()) as { operationName: string; query: string; variables: Record<string, any> };
      seen.push({ method: "POST", path: "/graphql", op: body.operationName, body });
      switch (body.operationName) {
        case "PRs": return json({ data: { mine: { nodes: PRS.mine }, reviews: { nodes: PRS.reviews }, merged: { nodes: PRS.merged }, rateLimit: { remaining: 4900, resetAt: "2026-09-16T12:00:00Z" } } });
        case "Issues": return json({ data: { assigned: { nodes: ISSUES.assigned }, mentioned: { nodes: ISSUES.mentioned }, created: { nodes: ISSUES.created } } });
        case "PRDetail": return json({ data: { repository: { pullRequest: {
          body: "Adds the **handshake**.", comments: { totalCount: 2, nodes: [{ author: actor("bob"), body: "Looks fine", createdAt: "2026-09-14T10:00:00Z" }] },
          reviews: { nodes: [{ author: actor("bob"), state: "APPROVED", body: "", submittedAt: "2026-09-15T10:00:00Z" }, { author: actor("carol"), state: "CHANGES_REQUESTED", body: "Rename it", submittedAt: "2026-09-13T10:00:00Z" }] },
          commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: [{ name: "pytest", conclusion: "SUCCESS", status: "COMPLETED" }, { name: "lint", conclusion: "FAILURE", status: "COMPLETED" }, { context: "ci/legacy", state: "PENDING" }] } } } }] },
        } } } });
        case "IssueDetail": return json({ data: { repository: { issue: { body: "It crashes.", milestone: { title: "1.0" }, comments: { totalCount: 3, nodes: [{ author: actor("alice"), body: "Me too", createdAt: "2026-09-13T10:00:00Z" }] } } } } });
        case "FindPR": return json({ data: { repository: { pullRequest: body.variables.number === 999 ? pr({ number: 999, repo: `${body.variables.owner}/${body.variables.name}`, title: "Fetched by id" }) : null } } });
        case "FindIssue": return json({ data: { repository: { issue: null } } });
        case "MarkReady": return json({ data: { markPullRequestReadyForReview: { pullRequest: { isDraft: false } } } });
        case "Search": {
          const q: string = body.variables.q;
          const has = (k: string) => body.query.includes(`${k}: search(`);
          if (q === "boom") return json({ errors: [{ message: "Something went wrong", type: "RATE_LIMITED" }] });
          if (q.includes("nothing")) return json({ data: { ...(has("issues") && { issues: { nodes: [] } }), ...(has("repos") && { repos: { nodes: [] } }), ...(has("users") && { users: { nodes: [] } }) } });
          return json({ data: {
            ...(has("issues") ? { issues: { nodes: [{ __typename: "PullRequest", ...pr({ number: 9, repo: "acme/api", title: "Fix the parser" }) }, { __typename: "Issue", ...issue({ number: 8, repo: "acme/api", title: "Slow endpoint" }) }] } } : {}),
            ...(has("repos") ? { repos: { nodes: [{ __typename: "Repository", nameWithOwner: "oven-sh/bun", name: "bun", owner: { login: "oven-sh" }, url: "https://github.com/oven-sh/bun", description: "Fast", primaryLanguage: { name: "Zig" }, stargazerCount: 80000, forkCount: 2000, issues: { totalCount: 4000 }, isPrivate: false, isFork: false, isArchived: false, defaultBranchRef: { name: "main" }, pushedAt: "2026-09-15T00:00:00Z", sshUrl: "git@github.com:oven-sh/bun.git" }] } } : {}),
            ...(has("users") ? { users: { nodes: [{ __typename: "User", login: "jarred", name: "Jarred", url: "https://github.com/jarred", avatarUrl: "https://avatars.githubusercontent.com/jarred", bio: "Makes bun" }] } } : {}),
          } });
        }
        default: return json({ errors: [{ message: `unknown operation ${body.operationName}` }] });
      }
    }
    const rec: Seen = { method: req.method, path: url.pathname + url.search, etag };
    if (req.method !== "GET") { try { rec.body = await req.json(); } catch {} }
    seen.push(rec);
    if (req.method === "GET") {
      switch (url.pathname) {
        case "/notifications": return etag === NOTIF_ETAG ? new Response(null, { status: 304, headers: { etag: NOTIF_ETAG } }) : json(NOTIFICATIONS, { headers: { etag: NOTIF_ETAG } });
        case "/user/repos": return etag === REPOS_ETAG ? new Response(null, { status: 304, headers: { etag: REPOS_ETAG } }) : json(REPOS.mine, { headers: { etag: REPOS_ETAG } });
        case "/user/starred": return json(REPOS.starred);
        case "/orgs/acme/repos": return json(REPOS.org);
        case "/user": return json({ login: "zcag", avatar_url: "https://avatars.githubusercontent.com/zcag" });
      }
    }
    if (req.method === "PATCH" && /^\/notifications\/threads\/\d+$/.test(url.pathname)) return new Response(null, { status: 205 });
    if (req.method === "PUT" && url.pathname === "/notifications") return new Response(null, { status: 205 });
    if (req.method === "PUT" && url.pathname === "/repos/acme/api/pulls/9/merge") return json({ merged: true });
    if (req.method === "PATCH" && url.pathname === "/repos/acme/widgets/issues/5") return json({ state: "closed" });
    if (req.method === "POST" && url.pathname === "/repos/zcag/pal/issues") return json({ html_url: "https://github.com/zcag/pal/issues/99", number: 99 }, { status: 201 });
    if (req.method === "POST" && url.pathname === "/user/repos") return json(restRepo(`zcag/${rec.body.name}`, { private: rec.body.private }), { status: 201 });
    if (req.method === "POST" && url.pathname === "/orgs/acme/repos") return json(restRepo(`acme/${rec.body.name}`), { status: 201 });
    return json({ message: `no fixture for ${req.method} ${url.pathname}` }, { status: 404 });
  },
});

const ops = (op: string) => seen.filter((s) => s.op === op);
const gets = (path: string) => seen.filter((s) => s.method === "GET" && s.path.startsWith(path));

const dir = mkdtempSync(join(tmpdir(), "pal-gh-"));
// A clone under repos_root: `<root>/pal` for zcag/pal, so Checkout and Open in editor show for it and nothing else.
mkdirSync(join(dir, "pal"));
// A `gh` on PATH that records what it was asked, so Checkout is testable and the test does not depend on the machine's gh.
const fakeGh = (name: string, script: string) => {
  const bin = join(dir, name);
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "gh"), script);
  chmodSync(join(bin, "gh"), 0o755);
  return bin;
};
const ghLog = join(dir, "gh.log");
const ghBin = fakeGh("bin", `#!/bin/sh\necho "$PWD $*" >> ${JSON.stringify(ghLog)}\ncase "$1 $2" in "auth token") echo gh-token;; "pr checkout") exit 0;; *) exit 1;; esac\n`);
const PATH0 = process.env.PATH;

let host: Host;
beforeAll(async () => {
  stored.clear();
  process.env.PAL_GITHUB_API = `http://127.0.0.1:${server.port}`;
  process.env.PAL_GITHUB_TOKEN = "test-token";
  process.env.PATH = `${ghBin}:${PATH0}`;
  host = await Host.bundled({ settings: { github: { settings: { default_org: "acme", repos_root: dir, clone_protocol: "ssh", merged_days: 7 } } } });
});
afterAll(() => { host.kill(); server.stop(true); process.env.PATH = PATH0; rmSync(dir, { recursive: true, force: true }); });

const list = (palette: string, filter?: string, query?: string, refresh?: boolean) => host.list("github", palette, query, filter || refresh ? { ...(filter && { filter }), ...(refresh && { refresh }) } : undefined);
const pick = (palette: string, id: string, action?: string, ctx?: Parameters<Host["pick"]>[4]) => host.pick("github", palette, id, action, ctx);
const ids = (items: { id: string }[]) => items.map((i) => i.id);
const tags = (i: any) => (i.accessories as any[]).filter((a) => "tag" in a).map((a) => a.tag);

describe("github", () => {
  test("meta: five palettes, ttl on the indexed ones, notifications live, search input, lazy detail where there is a pane", () => {
    const metas = host.loaded().find((l) => l.extension === "github")!.palettes;
    expect(metas.map((m) => m.name)).toEqual(["prs", "issues", "repos", "notifications", "search"]);
    expect(metas[0]).toMatchObject({ title: "Pull Requests", ttl: 300, live: false, input: false, detail: "lazy", showDetail: true, filters: [{ id: "all", title: "All" }, { id: "mine", title: "Mine" }, { id: "reviews", title: "Review requested" }, { id: "merged", title: "Merged" }] });
    expect(metas[1]).toMatchObject({ title: "Issues", ttl: 300, detail: "lazy" });
    expect(metas[2]).toMatchObject({ title: "Repositories", ttl: 300, filters: [{ id: "all", title: "All" }, { id: "mine", title: "Mine" }, { id: "starred", title: "Starred" }, { id: "org", title: "Organisation" }] });
    expect(metas[3]).toMatchObject({ title: "Notifications", live: true, ttl: 60 });
    expect(metas[4]).toMatchObject({ title: "Search GitHub", input: true, detail: "lazy" });
    expect(host.manifests.get("github")!.settings!.map((s) => [s.id, s.kind])).toEqual([["token", "secret"], ["default_org", "text"], ["repos_root", "path"], ["clone_protocol", "select"], ["merged_days", "number"], ["merge_method", "select"]]);
  });

  test("multi: two accounts are two instances; the token is per instance (a secret), the rest inherits; the lone default runs in a worker, unmarked", () => {
    const m = host.manifests.get("github")!;
    expect(m.multi).toBe(true);
    expect(m.settings!.filter((s) => s.kind === "secret" || s.scope === "instance").map((s) => s.id)).toEqual(["token"]);
    const loaded = host.loaded().find((l) => l.extension === "github")! as any;
    expect(loaded.name).toBe("github");
    expect(loaded.instance).toEqual({ key: "github", isDefault: true });
    expect(loaded.palettes[0].title).toBe("Pull Requests");
    expect(loaded.palettes[0].icon).toEqual(m.icon);
    expect(host.stderr).toMatch(/loaded github \(.*\) in a worker/);
  });

  describe("pull requests", () => {
    test("all: three sections in order, one GraphQL request, a PR in two lists listed once", async () => {
      const items = await list("prs");
      expect(ids(items)).toEqual(["acme/widgets#71", "zcag/pal#72", "acme/api#9", "zcag/pal#50"]);
      expect(items.map((i) => i.section)).toEqual(["Mine", "Mine", "Review requested", "Merged"]);
      expect(ops("PRs")).toHaveLength(1);
      expect(ops("PRs")[0].body.variables.mine).toBe("is:pr is:open author:@me sort:updated-desc");
      expect(ops("PRs")[0].body.variables.merged).toMatch(/^is:pr is:merged author:@me merged:>=\d{4}-\d{2}-\d{2}/);
    });

    test("row: title, owner/repo #n, keywords, state octicon in its colour, tags for checks, review, draft, conflicts, merged, and the updated date", async () => {
      const items = await list("prs");
      const [a, draft, review, merged] = items;
      expect(a).toMatchObject({ name: "Directory readiness", subtitle: "acme/widgets #71", url: "https://github.com/acme/widgets/pull/71", icon: tinted("\uf407", "green") });
      expect(a.keywords).toEqual(expect.arrayContaining(["widgets", "acme/widgets", "#71", "zcag", "feat-71"]));
      expect(tags(a)).toEqual(["checks ✓", "review", "conflicts"]);
      expect(a.accessories!.at(-1)).toEqual({ date: "2026-09-15T10:00:00Z" });
      expect(draft.icon).toEqual(tinted("\uf4dd", "slate"));
      expect(tags(draft)).toEqual(["draft"]);
      expect(tags(review)).toEqual(["checks ✗", "changes requested"]);
      expect(merged.icon).toEqual(tinted("\uf419", "violet"));
      expect(tags(merged)).toEqual(["merged"]);
      // Inline metadata for the pane before the lazy detail lands.
      expect(a.detail!.metadata!.map((m) => m.label)).toEqual(["Repository", "Author", "Branch", "Size", "State", "Review requested", "Labels", "Opened", "Updated"]);
      expect(a.detail!.metadata![2].value).toBe("feat-71 → main");
    });

    test("actions: open, copy, branch, checks, files, ref; merge only when mergeable, ready only on a draft, checkout only for an open PR with a clone", async () => {
      const items = await list("prs");
      const by = (id: string) => items.find((i) => i.id === id)!.actions!.map((a) => a.id);
      expect(by("acme/widgets#71")).toEqual(["open", "copy", "branch", "checks", "files", "ref"]);
      expect(by("zcag/pal#72")).toEqual(["open", "copy", "checkout", "branch", "checks", "files", "ref", "ready"]);
      expect(by("acme/api#9")).toEqual(["open", "copy", "branch", "checks", "files", "ref", "merge"]);
      expect(by("zcag/pal#50")).toEqual(["open", "copy", "branch", "checks", "files", "ref"]);
      expect(items.find((i) => i.id === "acme/api#9")!.actions!.at(-1)).toMatchObject({ confirm: "Merge #9 into main?" });
    });

    test("filters list from the same cached answer", async () => {
      expect(ids(await list("prs", "mine"))).toEqual(["acme/widgets#71", "zcag/pal#72"]);
      expect(ids(await list("prs", "reviews"))).toEqual(["acme/api#9", "acme/widgets#71"]);
      expect(ids(await list("prs", "merged"))).toEqual(["zcag/pal#50"]);
      expect(ops("PRs")).toHaveLength(1);
      await list("prs", "all", undefined, true);
      expect(ops("PRs")).toHaveLength(2);
    });

    test("picks: open, copy url, copy branch, copy reference, checks and files pages", async () => {
      expect(await pick("prs", "acme/widgets#71")).toEqual({ open: "https://github.com/acme/widgets/pull/71" });
      expect(await pick("prs", "acme/widgets#71", "copy")).toEqual({ copy: "https://github.com/acme/widgets/pull/71" });
      expect(await pick("prs", "acme/widgets#71", "branch")).toEqual({ copy: "feat-71" });
      expect(await pick("prs", "acme/widgets#71", "ref")).toEqual({ copy: "acme/widgets#71" });
      expect(await pick("prs", "acme/widgets#71", "checks")).toEqual({ open: "https://github.com/acme/widgets/pull/71/checks" });
      expect(await pick("prs", "acme/widgets#71", "files")).toEqual({ open: "https://github.com/acme/widgets/pull/71/files" });
    });

    test("checkout runs gh pr checkout in the clone", async () => {
      expect(await pick("prs", "zcag/pal#72", "checkout")).toEqual({ hud: "Checked out feat-72" });
      expect(readFileSync(ghLog, "utf8").trim().split("\n").at(-1)).toBe(`${realpathSync(join(dir, "pal"))} pr checkout 72`);
      expect(await pick("prs", "acme/api#9", "checkout")).toMatchObject({ keep: true, toast: { title: "No local clone", style: "failure" } });
    });

    test("lazy detail: the body and the thread as markdown, checks by name, approvers and changers, comment count", async () => {
      const d = await host.detail("github", "prs", "acme/widgets#71");
      expect(d.markdown).toContain("Adds the **handshake**.");
      expect(d.markdown).toContain("**bob** commented");
      expect(d.markdown).toContain("**carol** requested changes");
      expect(d.markdown).toContain("Rename it");
      const m = Object.fromEntries(d.metadata!.map((x) => [x.label, x]));
      expect(m.Checks.tags).toEqual([{ text: "pytest", color: "green" }, { text: "lint", color: "red" }, { text: "ci/legacy", color: "amber" }]);
      expect(m["Approved by"].tags).toEqual([{ text: "bob", color: "green" }]);
      expect(m["Changes requested by"].tags).toEqual([{ text: "carol", color: "red" }]);
      expect(m.Comments.value).toBe("2");
      expect(m.Branch.value).toBe("feat-71 → main");
      expect(ops("PRDetail")).toHaveLength(1);
      expect(ops("PRDetail")[0].body.variables).toEqual({ owner: "acme", name: "widgets", number: 71 });
    });

    test("merge and mark ready: the mutation, then the listing is fetched again", async () => {
      const before = ops("PRs").length;
      expect(await pick("prs", "acme/api#9", "merge")).toMatchObject({ keep: true, toast: { title: "Merged", style: "success" } });
      expect(seen.find((s) => s.method === "PUT" && s.path === "/repos/acme/api/pulls/9/merge")!.body).toEqual({ merge_method: "merge" });
      // The fixture has no merge endpoint for this one: the API's refusal is a failure toast, the listing stands.
      expect(await pick("prs", "acme/widgets#71", "merge")).toMatchObject({ keep: true, toast: { title: "Merge failed", style: "failure" } });
      expect(await pick("prs", "zcag/pal#72", "ready")).toMatchObject({ keep: true, toast: { title: "Ready for review" } });
      expect(ops("MarkReady")[0].body.variables).toEqual({ id: "PR_72" });
      await list("prs");
      expect(ops("PRs").length).toBe(before + 1);
    });

    test("a pick on an id no listing had fetches it by id", async () => {
      expect(await pick("prs", "acme/other#999", "branch")).toEqual({ copy: "feat-999" });
      expect(ops("FindPR")[0].body.variables).toEqual({ owner: "acme", name: "other", number: 999 });
      expect((await host.call("pick", { extension: "github", palette: "prs", id: "acme/other#1" })).error).toMatch(/no pull request acme\/other#1/);
    });
  });

  describe("issues", () => {
    test("all: the create row, then assigned, mentioned, created; one row per issue; labels, comments, state", async () => {
      const items = await list("issues");
      expect(ids(items)).toEqual(["create", "acme/widgets#5", "acme/api#8", "zcag/pal#3"]);
      expect(items.slice(1).map((i) => i.section)).toEqual(["Assigned", "Mentioned", "Created"]);
      const crash = items[1];
      expect(crash).toMatchObject({ name: "Crash on start", subtitle: "acme/widgets #5", icon: tinted("\uf41b", "green") });
      expect(crash.accessories).toEqual([{ tag: "bug", color: "grey" }, { tag: "p1", color: "grey" }, { text: "3 comments" }, { date: "2026-09-14T10:00:00Z" }]);
      expect(crash.keywords).toEqual(expect.arrayContaining(["widgets", "#5", "alice", "bug"]));
      expect(crash.actions!.map((a) => a.id)).toEqual(["open", "copy", "ref", "close"]);
      expect(crash.actions![3]).toMatchObject({ style: "destructive", confirm: "Close #5?" });
      expect(items[3]).toMatchObject({ icon: tinted("\uf41d", "violet"), accessories: [{ tag: "closed", color: "violet" }, { date: "2026-09-14T10:00:00Z" }] });
      expect(items[3].actions!.map((a) => a.id)).toEqual(["open", "copy", "ref"]);
      expect(ids(await list("issues", "mentioned"))).toEqual(["create", "acme/widgets#5", "acme/api#8"]);
      expect(ops("Issues")).toHaveLength(1);
    });

    test("detail: body, latest comments, milestone", async () => {
      const d = await host.detail("github", "issues", "acme/widgets#5");
      expect(d.markdown).toContain("It crashes.");
      expect(d.markdown).toContain("**alice** commented");
      expect(d.metadata!.find((m) => m.label === "Milestone")!.value).toBe("1.0");
    });

    test("picks: open, copy, ref, close (the PATCH, then a fresh listing)", async () => {
      expect(await pick("issues", "acme/api#8")).toEqual({ open: "https://github.com/acme/api/issues/8" });
      expect(await pick("issues", "acme/api#8", "ref")).toEqual({ copy: "acme/api#8" });
      const n = ops("Issues").length;
      expect(await pick("issues", "acme/widgets#5", "close")).toMatchObject({ keep: true, toast: { title: "Closed" } });
      expect(seen.find((s) => s.method === "PATCH" && s.path === "/repos/acme/widgets/issues/5")!.body).toEqual({ state: "closed" });
      await list("issues");
      expect(ops("Issues").length).toBe(n + 1);
    });

    test("create: a form with a repository select from recent repos, title, body; the submit posts and opens the issue", async () => {
      const r = await pick("issues", "create", "create");
      const form = r.form as Form;
      expect(form).toMatchObject({ id: "create", title: "Create issue", submit: { id: "save", title: "Create" } });
      expect(form.fields.map((f) => [f.id, f.kind, !!f.required])).toEqual([["repo", "select", true], ["title", "text", true], ["body", "textarea", false]]);
      const options = (form.fields[0] as { options: { id: string }[] }).options.map((o) => o.id);
      expect(options.slice(0, 3)).toEqual(["acme/widgets", "acme/api", "zcag/pal"]);
      expect(options).toContain("zcag/dotty");
      const bad = await pick("issues", "create", "save", { values: { repo: "zcag/pal", title: "  ", body: "" } });
      expect((bad.form as Form).errors).toEqual({ title: "Required" });
      const ok = await pick("issues", "create", "save", { values: { repo: "zcag/pal", title: "New one", body: "Text" } });
      expect(ok).toEqual({ open: "https://github.com/zcag/pal/issues/99", hud: "Created zcag/pal#99" });
      expect(seen.find((s) => s.method === "POST" && s.path === "/repos/zcag/pal/issues")!.body).toEqual({ title: "New one", body: "Text" });
    });
  });

  describe("repositories", () => {
    test("all: create row, mine, the org's, starred; a starred own repo listed once; language, stars, private, archived tags", async () => {
      const items = await list("repos");
      expect(ids(items)).toEqual(["create", "zcag/pal", "zcag/dotty", "acme/widgets", "acme/api", "oven-sh/bun"]);
      expect(items.slice(1).map((i) => i.section)).toEqual(["Mine", "Mine", "acme", "acme", "Starred"]);
      const pal = items[1];
      expect(pal).toMatchObject({ name: "pal", subtitle: "About zcag/pal", url: "https://github.com/zcag/pal", keywords: ["zcag/pal", "zcag", "Rust"] });
      expect(pal.accessories).toEqual([{ tag: "private", color: "amber" }, { tag: "Rust", color: "blue" }, { date: "2026-09-10T10:00:00Z" }]);
      expect(items[5].accessories).toEqual([{ tag: "Zig", color: "blue" }, { text: "★ 80000" }, { date: "2026-09-10T10:00:00Z" }]);
      expect(tags(items[4])).toContain("archived");
      // The clone under repos_root shows in the pane and adds the editor actions.
      expect(pal.detail!.metadata!.find((m) => m.label === "Local clone")!.value).toBe(join(dir, "pal"));
      expect(pal.actions!.map((a) => a.id)).toEqual(["open", "editor", "folder", "clone", "copy", "name", "issues", "pulls"]);
      expect(items[2].actions!.map((a) => a.id)).toEqual(["open", "clone", "copy", "name", "issues", "pulls"]);
    });

    test("filters: mine, starred, org; the org filter without an org is a hint", async () => {
      expect(ids(await list("repos", "mine"))).toEqual(["create", "zcag/pal", "zcag/dotty"]);
      expect(ids(await list("repos", "starred"))).toEqual(["create", "oven-sh/bun", "zcag/pal"]);
      expect(ids(await list("repos", "org"))).toEqual(["create", "acme/widgets", "acme/api"]);
      host.changeSettings("github", { settings: { default_org: "", repos_root: dir } });
      const items = await list("repos", "org");
      expect(items[1]).toMatchObject({ id: "hint:org", name: "No organisation set", actions: [] });
      host.changeSettings("github", { settings: { default_org: "acme", repos_root: dir } });
    });

    test("ETag: a re-list past the ttl sends If-None-Match and takes the 304 with the cached rows", async () => {
      const before = gets("/user/repos").length;
      expect(before).toBe(1);
      expect(gets("/user/repos")[0].etag).toBeUndefined();
      const items = await list("repos", "mine", undefined, true);
      expect(ids(items)).toEqual(["create", "zcag/pal", "zcag/dotty"]);
      const again = gets("/user/repos");
      expect(again).toHaveLength(2);
      expect(again[1].etag).toBe(REPOS_ETAG);
      // The cache in storage carries the ETag and the normalised rows, never the raw body.
      const cache = stored.get("github\0cache:repos:mine") as { etag: string; data: { id: string; kind: string }[] };
      expect(cache.etag).toBe(REPOS_ETAG);
      expect(cache.data.map((r) => r.id)).toEqual(["zcag/pal", "zcag/dotty"]);
      expect(cache.data[0].kind).toBe("repo");
    });

    test("picks: open, clone url per protocol, copy, name, issues, pulls, editor falls back to opening the folder", async () => {
      expect(await pick("repos", "zcag/dotty")).toEqual({ open: "https://github.com/zcag/dotty" });
      expect(await pick("repos", "zcag/dotty", "clone")).toEqual({ copy: "git@github.com:zcag/dotty.git" });
      host.changeSettings("github", { settings: { default_org: "acme", repos_root: dir, clone_protocol: "https" } });
      expect(await pick("repos", "zcag/dotty", "clone")).toEqual({ copy: "https://github.com/zcag/dotty.git" });
      host.changeSettings("github", { settings: { default_org: "acme", repos_root: dir } });
      expect(await pick("repos", "zcag/dotty", "name")).toEqual({ copy: "zcag/dotty" });
      expect(await pick("repos", "zcag/dotty", "issues")).toEqual({ open: "https://github.com/zcag/dotty/issues" });
      expect(await pick("repos", "zcag/pal", "folder")).toEqual({ open: join(dir, "pal") });
      expect(await pick("repos", "zcag/dotty", "editor")).toMatchObject({ keep: true, toast: { title: "No local clone", style: "failure" } });
      expect((await host.call("pick", { extension: "github", palette: "repos", id: "nope/nope" })).error).toMatch(/no repository/);
    });

    test("create: owner select (me and the org), name, description, private; the submit posts to the owner's endpoint", async () => {
      const form = (await pick("repos", "create", "create")).form as Form;
      expect(form.fields.map((f) => [f.id, f.kind])).toEqual([["owner", "select"], ["name", "text"], ["description", "text"], ["private", "checkbox"]]);
      expect((form.fields[0] as { options: { id: string }[] }).options.map((o) => o.id)).toEqual(["zcag", "acme"]);
      expect(((await pick("repos", "create", "save", { values: { owner: "zcag", name: "bad name", description: "", private: true } })).form as Form).errors).toEqual({ name: "Letters, digits, . - _" });
      expect(await pick("repos", "create", "save", { values: { owner: "zcag", name: "newrepo", description: "d", private: true } })).toEqual({ open: "https://github.com/zcag/newrepo", hud: "Created zcag/newrepo" });
      expect(seen.find((s) => s.method === "POST" && s.path === "/user/repos")!.body).toEqual({ name: "newrepo", description: "d", private: true });
      expect(await pick("repos", "create", "save", { values: { owner: "acme", name: "orgrepo", description: "", private: false } })).toEqual({ open: "https://github.com/acme/orgrepo", hud: "Created acme/orgrepo" });
      expect(seen.find((s) => s.method === "POST" && s.path === "/orgs/acme/repos")!.body).toEqual({ name: "orgrepo", description: "", private: false });
    });
  });

  describe("notifications", () => {
    test("unread only, a summary row with the count first, then sections by reason in a fixed order; subject urls resolved", async () => {
      const items = await list("notifications");
      expect(ids(items)).toEqual(["summary", "thread:1002", "thread:1003", "thread:1001"]);
      expect(items[0]).toMatchObject({ name: "3 unread notifications", accessories: [{ tag: "3", color: "blue" }] });
      expect(items[0].actions!.map((a) => a.id)).toEqual(["open", "read-all"]);
      expect(items.slice(1).map((i) => i.section)).toEqual(["Review requested", "Mentioned", "Subscribed"]);
      expect(items[1]).toMatchObject({ name: "Fix the parser", subtitle: "acme/api", url: "https://github.com/acme/api/pull/9", accessories: [{ tag: "PR", color: "grey" }, { date: "2026-09-15T09:00:00Z" }] });
      expect(items[2].url).toBe("https://github.com/acme/widgets/issues/5");
      expect(items[3].url).toBe("https://github.com/acme/api/releases");
      expect(items[1].actions!.map((a) => a.id)).toEqual(["open", "read", "copy", "read-all"]);
      expect(items[1].actions![3]).toMatchObject({ style: "destructive", confirm: expect.any(String) });
    });

    test("ETag: the live re-list is a 304", async () => {
      await list("notifications", undefined, undefined, true);
      const g = gets("/notifications");
      expect(g).toHaveLength(2);
      expect(g[1].etag).toBe(NOTIF_ETAG);
      expect(ids(await list("notifications"))).toHaveLength(4);
    });

    test("open marks the thread read then opens; mark read and mark all read hit the API and list again", async () => {
      expect(await pick("notifications", "thread:1002")).toEqual({ open: "https://github.com/acme/api/pull/9" });
      expect(seen.find((s) => s.method === "PATCH" && s.path === "/notifications/threads/1002")).toBeDefined();
      expect(await pick("notifications", "thread:1003", "read")).toMatchObject({ keep: true, toast: { title: "Marked read" } });
      expect(seen.find((s) => s.method === "PATCH" && s.path === "/notifications/threads/1003")).toBeDefined();
      expect(await pick("notifications", "thread:1001", "copy")).toEqual({ copy: "https://github.com/acme/api/releases" });
      expect(await pick("notifications", "summary", "read-all")).toMatchObject({ keep: true, toast: { title: "All notifications read" } });
      expect(seen.find((s) => s.method === "PUT" && s.path === "/notifications")!.body).toMatchObject({ read: true });
      expect(await pick("notifications", "summary")).toEqual({ open: "https://github.com/notifications" });
    });
  });

  describe("search", () => {
    test("a short query is a hint; results are typed by kind with their own actions; the query goes through as GitHub syntax", async () => {
      expect((await list("search", undefined, "a"))[0]).toMatchObject({ id: "hint:search", actions: [] });
      const items = await list("search", undefined, "parser");
      expect(ids(items)).toEqual(["acme/api#9", "acme/api#8", "oven-sh/bun", "@jarred"]);
      expect(items.map((i) => i.section)).toEqual(["Pull requests", "Issues", "Repositories", "Users"]);
      expect(items[3]).toMatchObject({ name: "jarred (Jarred)", subtitle: "Makes bun", icon: { image: "https://avatars.githubusercontent.com/jarred" } });
      expect(items[3].actions!.map((a) => a.id)).toEqual(["open", "copy", "repos"]);
      expect(ops("Search").at(-1)!.body.variables).toEqual({ q: "parser" });
    });

    test("is:pr narrows all to issues and pull requests; the filters pick the search types", async () => {
      await list("search", undefined, "is:pr parser");
      let q = ops("Search").at(-1)!.body.query as string;
      expect(q).toContain("issues: search(");
      expect(q).not.toContain("repos: search(");
      expect(ids(await list("search", "repos", "bun"))).toEqual(["oven-sh/bun"]);
      q = ops("Search").at(-1)!.body.query as string;
      expect(q).toContain("repos: search(");
      expect(q).not.toContain("issues: search(");
      expect(ids(await list("search", "users", "jarred"))).toEqual(["@jarred"]);
    });

    test("picks from search rows, a lazy pane for a PR, no results and a rate-limited answer as hints", async () => {
      expect(await pick("search", "acme/api#9", "branch")).toEqual({ copy: "feat-9" });
      expect(await pick("search", "@jarred", "copy")).toEqual({ copy: "jarred" });
      expect(await pick("search", "oven-sh/bun", "clone")).toEqual({ copy: "git@github.com:oven-sh/bun.git" });
      expect((await host.detail("github", "search", "acme/api#9")).markdown).toContain("handshake");
      expect((await list("search", undefined, "nothing here"))[0]).toMatchObject({ id: "hint:empty", name: "No results" });
      expect((await list("search", undefined, "boom"))[0]).toMatchObject({ id: "hint:limit", name: "GitHub rate limit reached" });
    });
  });

  describe("bar: notifications", () => {
    test("meta: the manifest entry with its refresh, backed by the code", () => {
      expect(host.loaded().find((l) => l.extension === "github")!.bar).toEqual([{ id: "notifications", title: "Notifications", description: expect.any(String), refresh: { every: 300, on: ["show", "wake", "network"] }, source: true }]);
    });

    test("render: the unread count as the badge, the newest five as a menu section, Open all and Mark all read under them", async () => {
      const item = await host.render("github", "notifications", { reason: "load" });
      expect(item).toMatchObject({ icon: "\u{f09b}", badge: 3, tooltip: "3 unread notifications" });
      expect(item.hidden).toBeUndefined();
      const menu = item.menu as any[];
      expect(menu[0]).toMatchObject({ type: "section", title: "Unread" });
      expect(menu[0].children.map((n: any) => n.id)).toEqual(["thread:1002", "thread:1001", "thread:1003"]);
      expect(menu[0].children[0]).toEqual({ type: "item", id: "thread:1002", title: "Fix the parser", subtitle: "acme/api", icon: "" });
      expect(menu.slice(1)).toEqual([{ type: "separator" }, { type: "item", id: "open", title: "Open all", subtitle: "3 in pal", icon: "\uf48d" }, { type: "item", id: "read-all", title: "Mark all read", icon: "\uf49e", shortcut: "cmd+shift+a", style: "destructive" }]);
    });

    test("a show/wake/network render asks GitHub (a 304 with the ETag); a timer render takes the cache", async () => {
      const before = gets("/notifications").length;
      await host.render("github", "notifications", { reason: "every" });
      expect(gets("/notifications")).toHaveLength(before);
      await host.render("github", "notifications", { reason: "show", anchor: "menubar" });
      expect(gets("/notifications")).toHaveLength(before + 1);
      expect(gets("/notifications").at(-1)!.etag).toBe(NOTIF_ETAG);
    });

    test("actions: a row marks the thread read and opens it, Open all pushes the palette, Mark all read PUTs and re-renders with a HUD line", async () => {
      expect(await host.barAction("github", "notifications", "thread:1001")).toEqual({ open: "https://github.com/acme/api/releases" });
      expect(seen.find((s) => s.method === "PATCH" && s.path === "/notifications/threads/1001")).toBeDefined();
      expect(await host.barAction("github", "notifications", "open")).toEqual({ push: { extension: "github", palette: "notifications" } });
      const puts = seen.filter((s) => s.method === "PUT" && s.path === "/notifications").length;
      expect(await host.barAction("github", "notifications", "read-all")).toEqual({ keep: true, hud: "Marked read" });
      expect(seen.filter((s) => s.method === "PUT" && s.path === "/notifications")).toHaveLength(puts + 1);
    });

    test("nothing unread is hidden", async () => {
      const unread = NOTIFICATIONS.map((n) => n.unread);
      NOTIFICATIONS.forEach((n) => { n.unread = false; });
      try {
        // Mark all read forgot the cache, so this render fetches.
        expect(await host.render("github", "notifications", { reason: "every" })).toEqual({ hidden: true });
      } finally { NOTIFICATIONS.forEach((n, i) => { n.unread = unread[i]; }); }
    });
  });

  test("a rejected token is a hint row, not an error", async () => {
    stored.clear();
    process.env.PAL_GITHUB_TOKEN = "wrong";
    const h = await Host.bundled();
    try {
      const items = await h.list("github", "prs");
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ id: "hint:auth", name: "GitHub rejected the token", subtitle: "Bad credentials" });
      expect(await h.pick("github", "prs", items[0].id)).toMatchObject({ open: expect.stringContaining("github.com/settings/tokens") });
    } finally { h.kill(); process.env.PAL_GITHUB_TOKEN = "test-token"; }
  });

  test("no token and gh not logged in: one hint row saying how, no request made", async () => {
    // A `gh` on PATH whose `auth token` fails stands in for a logged-out CLI.
    const bin = fakeGh("bin-out", "#!/bin/sh\necho 'not logged in' >&2\nexit 1\n");
    const { PAL_GITHUB_TOKEN, PATH } = process.env;
    delete process.env.PAL_GITHUB_TOKEN;
    process.env.PATH = `${bin}:${PATH}`;
    const before = seen.length;
    let h: Host | undefined;
    try {
      h = await Host.bundled();
      const items = await h.list("github", "notifications");
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ id: "hint:auth", name: "Sign in to GitHub", subtitle: expect.stringContaining("gh auth login") });
      // The bar item has no room for the hint: signed out is hidden, not an error.
      expect(await h.render("github", "notifications")).toEqual({ hidden: true });
      expect(seen.length).toBe(before);
      // A token in the settings takes over without a restart.
      h.changeSettings("github", { settings: { token: "test-token" } });
      expect(ids(await h.list("github", "notifications"))).toContain("summary");
    } finally { h?.kill(); process.env.PAL_GITHUB_TOKEN = PAL_GITHUB_TOKEN; process.env.PATH = PATH; }
  });
});
