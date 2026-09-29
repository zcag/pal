// games against the repo's own manifests: a canned `extensions.list` with
// the games, a `fun` extension that is no game (gifs, a grid), one that is
// not fun (calc), one not loaded (wordle), one whose manifest is gone, and
// games itself; and a canned `store.state` offering games not installed
// (pong, one for this platform; one for another; one with no build that
// runs here; one already installed; a fun one with no view palette). The
// rows (every game by title, the ones on offer under Not installed), the
// pick (a push of an installed game; an install, then the push, for one on
// offer), the row while it installs, and an install that fails.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { join } from "node:path";
import type { AvailableExtension, StoreResult } from "../../../sdk/src/index.ts";
import { offered } from "../../../extensions/games/index.ts";
import { Host } from "../harness.ts";

const ROOT = join(import.meta.dir, "../../../extensions");
const ext = (name: string, loaded = true) => ({ name, version: "0.1.0", root: ROOT, loaded, store: false, bundled: true });
const INSTALLED = [...["games", "snake", "solitaire", "blackjack", "minesweeper", "yahtzee", "crossword", "sudoku", "2048", "gifs", "calc"].map((n) => ext(n)), ext("wordle", false), { ...ext("gone"), root: "/nowhere" }];
const PLATFORM = process.platform === "darwin" ? "macos" : "linux";
const listing = (title: string, over: Partial<AvailableExtension["listing"]> = {}) => ({ title, description: "", tagline: `${title}, the game`, features: [], category: "fun", keywords: [], icon: { tile: { glyph: "g", bg: "green" } }, author: "pal", platforms: null, play: true, palettes: [{ id: title.toLowerCase(), title, kind: "view" }], screenshots: [], requires: [], suggests: [], ...over });
const offer = (name: string, over: Partial<AvailableExtension> = {}, l: Partial<AvailableExtension["listing"]> = {}): AvailableExtension => ({ name, registry: "pal", installed: false, bundled: false, installable: true, listing: listing(name[0].toUpperCase() + name.slice(1), l), ...over });
const AVAILABLE = [
  offer("pong"),
  offer("tetris", {}, { platforms: [PLATFORM === "macos" ? "linux" : "macos"] }),
  offer("chess", { installable: false, blocked: "needs pal with protocol 9" }),
  offer("snake", { installed: true }),
  offer("quotes", {}, { palettes: [{ id: "quotes", title: "Quotes", kind: "list" }] }),
  offer("weather", {}, { category: "reference" }),
];

let host: Host;
let installed = INSTALLED;
let avail = AVAILABLE;
let answer: (name: string) => StoreResult | Promise<StoreResult> = (name) => ({ name, ok: true, loaded: true });
const installs: unknown[] = [];
beforeAll(async () => {
  host = await Host.bundled({
    core: {
      "extensions.list": () => installed,
      "store.state": () => ({ available: avail }),
      "store.install": (p: any) => { installs.push(p); return answer(p.name); },
    },
  });
});
afterAll(() => host?.kill());

test("offered: fun, a view palette, this platform, a build that runs here, not installed", () => {
  expect(offered(AVAILABLE, new Set()).map((g) => g.extension)).toEqual(["pong"]);
  expect(offered(AVAILABLE, new Set(["pong"]))).toEqual([]);
});

test("one row per game, by title, with tile and tagline: the installed ones, then the ones on offer under Not installed", async () => {
  const rows = await host.list("games", "games");
  expect(rows.map((r) => r.id)).toEqual(["2048/2048", "blackjack/blackjack", "crossword/crossword", "minesweeper/minesweeper", "snake/snake", "solitaire/solitaire", "sudoku/sudoku", "yahtzee/yahtzee", "pong/pong"]);
  expect(rows.map((r) => r.section)).toEqual([...Array(8).fill("Installed"), "Not installed"]);
  const snake = rows.find((r) => r.id === "snake/snake")!;
  expect(snake.name).toBe("Snake II");
  expect(snake.subtitle).toContain("3310");
  expect(snake.icon).toMatchObject({ tile: { bg: "green" } });
  expect(snake.accessories ?? []).toEqual([]);
  const pong = rows.find((r) => r.id === "pong/pong")!;
  expect(pong.accessories).toBeUndefined();
  expect(pong.actions).toEqual([{ id: "install", title: "Install and play" }]);
  expect(pong.subtitle).toBe("Pong, the game");
});

test("Enter pushes an installed game's palette", async () => {
  expect(await host.pick("games", "games", "snake/snake", "play")).toEqual({ push: { extension: "snake", palette: "snake" } });
  expect(await host.pick("games", "games", "solitaire/solitaire")).toEqual({ push: { extension: "solitaire", palette: "solitaire" } });
});

test("Enter on one on offer installs it from its registry, the row says so meanwhile, then pushes it", async () => {
  let release!: () => void;
  answer = (name) => new Promise((r) => { release = () => r({ name, ok: true, loaded: true }); });
  try {
    const picked = host.pick("games", "games", "pong/pong", "install");
    await host.until(() => installs.length === 1);
    const meanwhile = await host.list("games", "games");
    expect(meanwhile.find((r) => r.id === "pong/pong")!.accessories).toEqual([{ tag: "Installing…", color: "blue" }]);
    release();
    expect(await picked).toEqual({ push: { extension: "pong", palette: "pong" } });
    expect(installs[0]).toEqual({ name: "pong", registry: "pal", from: "games" });
  } finally {
    answer = (name) => ({ name, ok: true, loaded: true });
  }
});

test("an install that fails stays on the list as a row saying why, until the next try", async () => {
  answer = (name) => ({ name, ok: false, error: "offline: pal.cagdas.io is not reachable" });
  try {
    expect(await host.pick("games", "games", "pong/pong", "install")).toEqual({ keep: true });
    const rows = await host.list("games", "games");
    expect(rows[0]).toMatchObject({ id: "hint:failed:pong", name: "Could not install Pong", subtitle: "offline: pal.cagdas.io is not reachable", actions: [] });
    answer = (name) => ({ name, ok: true, loaded: false, error: "SyntaxError" });
    expect(await host.pick("games", "games", "pong/pong", "install")).toEqual({ keep: true });
    expect((await host.list("games", "games"))[0].subtitle).toBe("SyntaxError");
    answer = (name) => ({ name, ok: true, loaded: true });
    await host.pick("games", "games", "pong/pong", "install");
    expect((await host.list("games", "games"))[0].id).toBe("2048/2048");
  } finally {
    answer = (name) => ({ name, ok: true, loaded: true });
  }
});

test("no games: one hint row", async () => {
  installed = [ext("calc")];
  const rows = await host.list("games", "games").finally(() => { installed = INSTALLED; });
  // Pong is still on offer: a row, not the hint.
  expect(rows.map((r) => [r.id, r.section])).toEqual([["pong/pong", "Not installed"]]);
  installed = [ext("calc")];
  avail = [];
  const none = await host.list("games", "games").finally(() => { installed = INSTALLED; avail = AVAILABLE; });
  expect(none).toHaveLength(1);
  expect(none[0].id).toBe("hint:none");
});
