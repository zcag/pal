// games against the repo's own manifests: a canned `extensions.list` with
// the games, a `fun` extension that is no game (gifs, a grid), one that is
// not fun (calc), one not loaded (wordle), one whose manifest is gone, and
// games itself. The rows (every view palette of a loaded fun extension,
// by title, with its tile and tagline) and the pick (a push of the game).
import { afterAll, beforeAll, expect, test } from "bun:test";
import { join } from "node:path";
import { Host } from "../harness.ts";

const ROOT = join(import.meta.dir, "../../../extensions");
const ext = (name: string, loaded = true) => ({ name, version: "0.1.0", root: ROOT, loaded, store: false, bundled: true });
const INSTALLED = [...["games", "snake", "solitaire", "blackjack", "minesweeper", "yahtzee", "crossword", "2048", "gifs", "calc"].map((n) => ext(n)), ext("wordle", false), { ...ext("gone"), root: "/nowhere" }];

let host: Host;
let installed = INSTALLED;
beforeAll(async () => { host = await Host.bundled({ core: { "extensions.list": () => installed } }); });
afterAll(() => host?.kill());

test("one row per game: loaded, shelved under Fun, a view palette; by title, with the game's tile and tagline", async () => {
  const rows = await host.list("games", "games");
  expect(rows.map((r) => r.id)).toEqual(["2048/2048", "blackjack/blackjack", "crossword/crossword", "minesweeper/minesweeper", "snake/snake", "solitaire/solitaire", "yahtzee/yahtzee"]);
  const snake = rows.find((r) => r.id === "snake/snake")!;
  expect(snake.name).toBe("Snake II");
  expect(snake.subtitle).toContain("3310");
  expect(snake.icon).toMatchObject({ tile: { bg: "green" } });
});

test("Enter pushes the game's palette", async () => {
  expect(await host.pick("games", "games", "snake/snake", "play")).toEqual({ push: { extension: "snake", palette: "snake" } });
  expect(await host.pick("games", "games", "solitaire/solitaire")).toEqual({ push: { extension: "solitaire", palette: "solitaire" } });
});

test("no games: one hint row", async () => {
  installed = [ext("calc")];
  const rows = await host.list("games", "games");
  installed = INSTALLED;
  expect(rows).toHaveLength(1);
  expect(rows[0].id).toBe("hint:none");
});
