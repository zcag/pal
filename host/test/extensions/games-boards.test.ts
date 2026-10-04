// The Games shelf's Leaderboards (extensions/games/boards.ts) against the
// repo's own manifests: a canned `extensions.list`, the core's
// `leaderboard.get` and `account.*` from a table, and pal's server's
// boards list from a local server (`PAL_ACCOUNT_API`). The row's action
// and the push; a tab per board, a `*` board's tabs from the list, newest
// first; the first tree drawn at once and the board pushed when it lands;
// the viewer's row ringed (and below the top when not in it), anonymous
// rows marked and hidden on `a` (remembered), the period switch, the
// sign-in row when signed out; values as each format shows them.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { formatValue, tabsOf, type BoardGame } from "../../../extensions/games/boards.ts";
import type { LeaderboardRow, View, ViewNode } from "../../../sdk/src/protocol.ts";
import { checkView } from "../../../sdk/src/view.ts";
import { Host, stored } from "../harness.ts";

const ROOT = join(import.meta.dir, "../../../extensions");
const ext = (name: string) => ({ name, version: "0.1.0", root: ROOT, loaded: true, store: false, bundled: true });
const INSTALLED = ["games", "2048", "wordle", "snake", "calc"].map(ext);

const find = (n: ViewNode, pred: (n: ViewNode) => boolean, out: ViewNode[] = []): ViewNode[] => {
  if (pred(n)) out.push(n);
  if (n.type === "stack") for (const c of n.children) find(c, pred, out);
  return out;
};
const texts = (v: View) => find(v.tree, (n) => n.type === "text").map((n) => (n as { value: string }).value);

const rowOf = (rank: number, name: string, value: number, extra: Partial<LeaderboardRow> = {}): LeaderboardRow => ({ rank, name, anon: false, value, at: 1790000000, me: false, ...extra });

let host: Host;
let server: ReturnType<typeof Bun.serve>;
let signedIn = true;
let listed: string[] = [];
let board = (_p: { board: string; anon?: boolean }) => ({ board: null, rows: [rowOf(1, "ada", 9000), rowOf(2, "Teal Fox", 7000, { anon: true }), rowOf(3, "me_too", 4096, { me: true })], me: null }) as unknown;
const gets = () => host.coreCalls.filter((c) => c.method === "leaderboard.get").map((c) => c.params as Record<string, unknown>);
const env = process.env.PAL_ACCOUNT_API;

beforeAll(async () => {
  stored.clear();
  server = Bun.serve({ port: 0, fetch: (req) => (new URL(req.url).pathname === "/api/boards/wordle" ? Response.json({ boards: listed.map((id) => ({ id, title: id })) }) : new Response("no", { status: 404 })) });
  process.env.PAL_ACCOUNT_API = `http://127.0.0.1:${server.port}/`;
  host = await Host.bundled({
    only: ["games"],
    core: {
      "extensions.list": () => INSTALLED,
      "store.state": () => ({ available: [] }),
      "leaderboard.get": (p: { board: string; anon?: boolean }) => board(p),
      "account.get": () => ({ signedIn, handle: signedIn ? "me_too" : null }),
      "account.signIn": () => null,
    },
  });
});
afterAll(() => {
  host?.kill();
  server?.stop(true);
  if (env === undefined) delete process.env.PAL_ACCOUNT_API;
  else process.env.PAL_ACCOUNT_API = env;
});

const loaded = (v: View) => !texts(v).includes("Loading…");
const pushes = () => host.viewUpdates("games", { palette: "leaderboards" });
/** The tree an answer brings, or when it is still loading, the one pushed after it that is `done`: counted from before the ask, so a quick push is not missed. */
async function settle(ask: () => Promise<View>, done: (v: View) => boolean = loaded): Promise<View> {
  const from = pushes().length;
  const first = await ask();
  if (done(first)) return first;
  let hit: View | undefined;
  await host.until(() => { hit = pushes().slice(from).map((u) => u.spec as View).find(done); return !!hit; }, 3000, "the board pushed");
  return hit!;
}
const open = (game: string, done?: (v: View) => boolean) => settle(() => host.request<View>("view", { extension: "games", palette: "leaderboards", args: { game } }), done);
const pick = (game: string, action: string, done?: (v: View) => boolean) => settle(async () => (await host.pick("games", "leaderboards", game, action)).view as View, done);

describe("pure", () => {
  test("a value as its board shows it", () => {
    expect(formatValue(1234567, "points")).toBe("1,234,567");
    expect(formatValue(61.2, "time")).toBe("1:01.20");
    expect(formatValue(5.034, "time")).toBe("0:05.03");
    expect(formatValue(3725.5, "time")).toBe("1:02:05.50");
    expect(formatValue(4, "moves")).toBe("4");
  });
  test("a tab per plain board; a * board's from the list, newest first, under its title", () => {
    const g: BoardGame = { extension: "wordle", title: "Wordle", palette: "wordle", boards: [{ id: "daily/*", title: "Wordle #{1}", order: "asc", format: "moves" }, { id: "streak", title: "Longest streak", order: "desc", format: "points" }] };
    expect(tabsOf(g, ["daily/259", "daily/1000", "daily/3", "weekly/2", "daily/a/b"]).map((t) => [t.id, t.title])).toEqual([["daily/1000", "Wordle #1000"], ["daily/259", "Wordle #259"], ["daily/3", "Wordle #3"], ["streak", "Longest streak"]]);
    expect(tabsOf(g, []).map((t) => t.id)).toEqual(["streak"]);
  });
});

describe("over the wire", () => {
  test("an installed game with boards has Leaderboards on its row, which opens them", async () => {
    const rows = await host.list("games", "games");
    expect(rows.find((r) => r.id === "2048/2048")!.actions).toEqual([{ id: "play", title: "Play" }, { id: "boards", title: "Leaderboards", shortcut: "cmd+l" }]);
    expect(rows.find((r) => r.id === "snake/snake")!.actions).toEqual([{ id: "play", title: "Play" }, { id: "boards", title: "Leaderboards", shortcut: "cmd+l" }]);
    expect(rows.map((r) => r.id)).not.toContain("games/leaderboards");
    expect(await host.pick("games", "games", "2048/2048", "boards")).toEqual({ push: { extension: "games", palette: "leaderboards", args: { game: "2048" } } });
  });

  test("the first tree comes at once; the board is pushed when it lands: ranks, names, values, your row ringed, anonymous marked", async () => {
    let first: View | undefined;
    const v = await open("2048", (v) => { first ??= v; return loaded(v); });
    expect(first!.title).toBe("2048");
    expect(texts(first!)).toEqual(expect.arrayContaining(["Best score", "Highest tile", "Loading…"]));
    checkView(v);
    expect(texts(v)).toEqual(expect.arrayContaining(["1", "ada", "9,000", "2", "Teal Fox", "7,000", "3", "me_too", "4,096", "All time", "This week", "Today"]));
    expect(find(v.tree, (n) => n.type === "badge").map((n) => (n as { text: string }).text)).toEqual(["anonymous", "you"]);
    expect(find(v.tree, (n) => n.selected === true).map((n) => n.key)).toEqual(["r3-me_too"]);
    expect(gets().at(-1)).toEqual({ extension: "2048", board: "score", period: "all", anon: true });
    expect(v.actions.map((a) => [a.id, a.shortcut])).toEqual(expect.arrayContaining([["play", "enter"], ["next", ["right", "tab"]], ["period", "p"], ["anon", "a"]]));
    expect(v.actions.some((a) => a.id === "signin")).toBe(false);
    expect((await host.pick("games", "leaderboards", "2048", "play"))).toEqual({ push: { extension: "2048", palette: "2048" } });
  });

  test("the next board, the period, and Hide anonymous (remembered) ask the core for that slice", async () => {
    const tile = await pick("2048", "next");
    expect(gets().at(-1)).toMatchObject({ board: "tile", period: "all" });
    expect(find(tile.tree, (n) => n.type === "text" && n.value === "Highest tile")[0]).toMatchObject({ weight: "semibold", color: "accent" });
    await pick("2048", "period");
    expect(gets().at(-1)).toEqual({ extension: "2048", board: "tile", period: "week", anon: true });
    await pick("2048", "period:day");
    expect(gets().at(-1)).toMatchObject({ period: "day" });
    board = (p) => ({ board: null, rows: p.anon === false ? [rowOf(1, "ada", 9000), rowOf(2, "me_too", 4096, { me: true })] : [], me: null });
    const hidden = await pick("2048", "anon");
    expect(stored.get("games\0hide_anon")).toBe(true);
    expect(gets().at(-1)).toEqual({ extension: "2048", board: "tile", period: "day", anon: false });
    expect(find(hidden.tree, (n) => n.type === "switch")[0]).toMatchObject({ on: true, action: "anon" });
    expect(hidden.actions.find((a) => a.id === "anon")!.title).toBe("Show anonymous players");
    expect(texts(hidden)).not.toContain("Teal Fox");
    await pick("2048", "anon");
    expect(stored.get("games\0hide_anon")).toBe(false);
  });

  test("your row below the top when you are not in it; signed out, a row to sign in", async () => {
    signedIn = false;
    board = () => ({ board: null, rows: [rowOf(1, "ada", 9000)], me: rowOf(812, "Calm Otter", 12, { anon: true, me: true }) });
    try {
      const v = await pick("2048", "refresh", (v) => texts(v).includes("Calm Otter"));
      expect(find(v.tree, (n) => n.type === "divider")).toHaveLength(1);
      expect(find(v.tree, (n) => n.selected === true).map((n) => n.key)).toEqual(["me"]);
      expect(texts(v)).toEqual(expect.arrayContaining(["812", "Calm Otter", "Sign in to put your scores here"]));
      expect(v.actions.find((a) => a.id === "signin")).toEqual({ id: "signin", title: "Sign in to put your scores here", shortcut: "s" });
      await host.pick("games", "leaderboards", "2048", "signin");
      expect(host.coreCalls.some((c) => c.method === "account.signIn")).toBe(true);
    } finally { signedIn = true; }
  });

  test("a * board's tabs come from the server's list; a board per puzzle has no period switch", async () => {
    listed = ["daily/259", "daily/260", "streak"];
    board = (p) => ({ board: null, rows: p.board === "daily/260" ? [rowOf(1, "ada", 2)] : [], me: null });
    const v = await open("wordle", (v) => texts(v).includes("ada"));
    expect(texts(v)).toEqual(expect.arrayContaining(["Wordle #260", "Wordle #259", "Longest streak", "2"]));
    expect(texts(v)).not.toContain("All time");
    expect(v.actions.some((a) => a.id === "period")).toBe(false);
    expect(gets().at(-1)).toMatchObject({ extension: "wordle", board: "daily/260", period: "all" });
    const empty = await pick("wordle", "tab:1");
    expect(texts(empty)).toContain("No scores yet: play a round to put the first one here");
    expect(empty.actions.filter((a) => a.id.startsWith("tab:")).map((a) => a.shortcut)).toEqual(["1", "2", "3"]);
  });

  test("the root's Leaderboards row opens on the game looked at last; g walks the games with boards", async () => {
    const v = await host.request<View>("view", { extension: "games", palette: "leaderboards" });
    expect(v.title).toBe("Wordle");
    const next = await host.pick("games", "leaderboards", "wordle", "game");
    expect((next.view as View).title).toBe("2048");
  });
});
