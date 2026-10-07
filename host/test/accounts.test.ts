// Accounts, the contract's side (docs/design/accounts.md): the manifest's
// `sync` rules and `leaderboards` as the host and pal-pack check them, the
// SDK's `leaderboard` and `account` as `core/*` calls, a game surface's
// `score`, `leaderboard`, `account` and `signIn` relayed to them with the
// level's extension, and the core's `storage/changed` reaching the
// extension's `storage.onChange` and its open view levels.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { checkLeaderboards, checkSync, isBoardId, leaderboardOf } from "../../sdk/src/manifest.ts";
import type { Manifest } from "../../sdk/src/protocol.ts";
import { API, Host, Root, manifest } from "./harness.ts";

describe("manifest: sync", () => {
  test("each key a merge, local, or an object rule of fields and each (recursively, never local)", () => {
    expect(checkSync({})).toEqual([]);
    expect(checkSync({ sync: { best: "max", low: "min", unlocks: "union", plays: "sum", run: "latest", hand: "local", stats: { fields: { wins: "sum", streak: "latest", deep: { fields: { n: "max" } } } } } })).toEqual([]);
    expect(checkSync({ sync: { kills: { each: "sum" }, codex: { fields: { seen: "union" }, each: { each: { fields: { n: "sum" } } } } } })).toEqual([]);
    expect(checkSync({ sync: ["best"] })).toEqual(["sync: not an object of storage keys and their rules"]);
    const shape = `a rule is a string or { "fields": { <field>: <rule> }, "each": <rule> } (either or both)`;
    expect(checkSync({ sync: { a: "add", b: 1, c: { fields: { x: "local" } }, d: { fields: [] }, e: { fields: {}, extra: 1 }, f: {}, g: { each: "local" } } })).toEqual([
      `sync.a: "add" is not a rule (max, min, union, sum, latest, local, or { "fields": {...}, "each": ... })`,
      `sync.b: ${shape}`,
      `sync.c.fields.x: "local" is not a rule (max, min, union, sum, latest, or { "fields": {...}, "each": ... })`,
      `sync.d: ${shape}`,
      `sync.e: ${shape}`,
      `sync.f: ${shape}`,
      `sync.g.each: "local" is not a rule (max, min, union, sum, latest, or { "fields": {...}, "each": ... })`,
    ]);
  });
});

describe("manifest: leaderboards", () => {
  const board = (b: Record<string, unknown>) => ({ id: "daily", title: "Daily", order: "desc", format: "points", ...b });
  test("ids are segments, * allowed; {n} only for a * there is; the enums; min below max", () => {
    expect(checkLeaderboards({ leaderboards: [board({ period: "day" }), board({ id: "stage/*", title: "Stage {1}", format: "time", min: 0, max: 3600 }), board({ id: "w/*/*", title: "{1}-{2}", order: "asc", format: "moves", period: "week" })] })).toEqual([]);
    expect(checkLeaderboards({ leaderboards: {} })).toEqual(["leaderboards: not a list of boards"]);
    const bad = checkLeaderboards({ leaderboards: [board({}), board({}), board({ id: "Stage/x", title: "" }), board({ id: "a//b" }), board({ id: "s/*", title: "S {2}" }), board({ id: "x", title: "X {1}", order: "up", format: "score", period: "month", min: 5, max: 5 }), board({ id: "y", max: "9" }), null] });
    expect(bad).toEqual([
      "leaderboards.daily: the id is used twice",
      `leaderboards.Stage/x: an id is lowercase letters, digits, "_" and "-", in segments joined by "/" (a segment may be "*")`,
      "leaderboards.Stage/x: no title",
      `leaderboards.a//b: an id is lowercase letters, digits, "_" and "-", in segments joined by "/" (a segment may be "*")`,
      `leaderboards.s/*: the title's {2} names no "*" segment of the id`,
      `leaderboards.x: the title's {1} names no "*" segment of the id`,
      `leaderboards.x: order is "asc" (lower is better) or "desc" (higher is)`,
      `leaderboards.x: format is "points", "time" or "moves"`,
      `leaderboards.x: period is "all", "day" or "week"`,
      "leaderboards.x: min must be below max",
      "leaderboards.y: max is not a number",
      "leaderboards.7: not an object",
    ]);
  });

  test("a posted board falls under its declaration, the title filled in", () => {
    const m = { name: "v", title: "V", leaderboards: [board({ id: "endless", title: "Endless" }), board({ id: "stage/*", title: "Stage {1}" })] } as Manifest;
    expect(leaderboardOf(m, "stage/hyper-3")).toMatchObject({ id: "stage/*", title: "Stage hyper-3" });
    expect(leaderboardOf(m, "endless")?.title).toBe("Endless");
    for (const b of ["stage", "stage/a/b", "stage/*", "daily", "Endless"]) expect(leaderboardOf(m, b), b).toBeUndefined();
    expect(isBoardId("stage/3")).toBe(true);
    expect(isBoardId("stage/*")).toBe(false);
  });

  test("the host warns about a wrong declaration on load", async () => {
    const root = new Root({ bad: { "index.ts": `export default { palettes: { p: { list: () => [], pick: () => {} } } };`, "pal.json": manifest("bad", { sync: { best: "most" }, leaderboards: [{ id: "x", title: "X", order: "desc", format: "laps" }] } as unknown as Partial<Manifest>) } });
    const host = await Host.start({ roots: [root.dir] });
    try {
      expect(host.loaded().find((l) => l.extension === "bad")?.warnings).toEqual([`sync.best: "most" is not a rule (max, min, union, sum, latest, local, or { "fields": {...}, "each": ... })`, `leaderboards.x: format is "points", "time" or "moves"`]);
    } finally { host.kill(); root.rm(); }
  });
});

const ext = `
import { account, leaderboard, storage } from "${API}";
const heard = [];
storage.onChange((key, value) => heard.push([key, value]));
export default {
  palettes: {
    game: { view: () => ({ tree: { type: "surface", src: "surface/index.html" }, actions: [] }), pick: () => {} },
    heard: { list: () => heard.map(([k, v], i) => ({ id: String(i), name: k, subtitle: JSON.stringify(v) })), pick: () => {} },
    sdk: {
      list: () => [],
      pick: async (id) => {
        if (id === "nan") return leaderboard.post("daily", NaN).then(() => ({}), (e) => ({ hud: e.message }));
        const r = { post: await leaderboard.post("stage/2", 31.5), get: await leaderboard.get("daily", { period: "week", anon: false }), account: await account.get(), signIn: await account.signIn() };
        return { hud: JSON.stringify(r) };
      },
    },
  },
};`;

describe("leaderboards, the account and synced storage", () => {
  let root: Root;
  let host: Host;
  const core = {
    "leaderboard.post": (p: { board: string; value: number }) => { if (p.board === "nohandle") throw new Error("choose a handle"); return { best: p.value, rank: 2, total: 9 }; },
    "leaderboard.get": (p: { board: string }) => ({ board: { id: p.board, title: "Daily", order: "desc", format: "points", period: "day" }, rows: [{ rank: 1, name: "Teal Fox", anon: true, value: 40, at: 1790000000, me: false }], me: null }),
    "account.get": () => ({ signedIn: true, handle: "ada" }),
    "account.signIn": () => null,
    "leaderboard.replay": (p: { board: string; key: string }) => ({ board: p.board, value: 31.5, name: "ada", anon: false, at: 1790000000, data: `run:${p.key}` }),
  };
  const surface = (c: string, data: unknown) => host.request("surface", { extension: "game", palette: "game", call: c, data });
  const calls = (method: string) => host.coreCalls.filter((c) => c.method === method).map((c) => c.params);
  beforeAll(async () => {
    root = new Root({ game: { "index.ts": ext, "pal.json": manifest("game", { palettes: { game: { kind: "view" }, heard: { kind: "list" }, sdk: { kind: "list" } }, sync: { best: "max" }, leaderboards: [{ id: "daily", title: "Daily", order: "desc", format: "points", period: "day" }, { id: "stage/*", title: "Stage {1}", order: "asc", format: "time" }] } as Partial<Manifest>) } });
    host = await Host.start({ roots: [root.dir], core });
  });
  afterAll(() => { host.kill(); root.rm(); });

  test("the SDK's calls are core/leaderboard.* and core/account.*, the extension named by the host", async () => {
    const r = await host.pick("game", "sdk", "go");
    expect(JSON.parse(String(r.hud))).toEqual({ post: { best: 31.5, rank: 2, total: 9 }, get: core["leaderboard.get"]({ board: "daily" }), account: { signedIn: true, handle: "ada" }, signIn: null });
    expect(calls("leaderboard.post").at(-1)).toEqual({ extension: "game", board: "stage/2", value: 31.5 });
    expect(calls("leaderboard.get").at(-1)).toEqual({ extension: "game", board: "daily", period: "week", anon: false });
    expect(calls("account.get").at(-1)).toEqual({});
    expect(await host.pick("game", "sdk", "nan")).toEqual({ hud: "leaderboard.post daily: the value must be a finite number" });
  });

  test("a surface's score, leaderboard, account and signIn are the extension's, whatever the page says", async () => {
    expect(await surface("score", { board: "daily", value: 120, extension: "other" })).toEqual({ best: 120, rank: 2, total: 9 });
    expect(calls("leaderboard.post").at(-1)).toEqual({ extension: "game", board: "daily", value: 120 });
    await surface("leaderboard", { board: "daily", anon: true, period: 3 });
    expect(calls("leaderboard.get").at(-1)).toEqual({ extension: "game", board: "daily", anon: true });
    expect(await surface("account", {})).toEqual({ signedIn: true, handle: "ada" });
    expect(await surface("signIn", {})).toBeNull();
    await expect(surface("score", { board: "nohandle", value: 1 })).rejects.toThrow("choose a handle");
  });

  test("a surface's score carries its replay, and a row's replay is read back", async () => {
    await surface("score", { board: "stage/2", value: 31.5, replay: "1a,2b" });
    expect(calls("leaderboard.post").at(-1)).toEqual({ extension: "game", board: "stage/2", value: 31.5, replay: "1a,2b" });
    await surface("score", { board: "stage/2", value: 30, replay: 7 });
    expect(calls("leaderboard.post").at(-1)).toEqual({ extension: "game", board: "stage/2", value: 30 });
    expect(await surface("replay", { board: "stage/2", key: "abc123" })).toEqual({ board: "stage/2", value: 31.5, name: "ada", anon: false, at: 1790000000, data: "run:abc123" });
    expect(calls("leaderboard.replay").at(-1)).toEqual({ extension: "game", board: "stage/2", key: "abc123" });
  });

  test("storage/changed reaches storage.onChange, and the open levels of that extension only", async () => {
    const posts = () => host.surfacePosts("game", "game").filter((m) => m.pal === "storage");
    host.notify("storage/changed", { extension: "game", key: "best", value: 9 });
    host.notify("storage/changed", { extension: "other", key: "best", value: 1 });
    expect((await host.list("game", "heard")).map((i) => [i.name, i.subtitle])).toEqual([["best", "9"]]);
    expect(posts()).toEqual([]);
    host.viewShown("game", { palette: "game" });
    host.notify("storage/changed", { extension: "game", key: "run", value: null });
    await host.until(() => posts().length === 1, 3000, "storage post");
    expect(posts()).toEqual([{ pal: "storage", key: "run", value: null }]);
    expect((await host.list("game", "heard")).map((i) => i.name)).toEqual(["best", "run"]);
    host.viewHidden("game", { palette: "game" });
  });
});
