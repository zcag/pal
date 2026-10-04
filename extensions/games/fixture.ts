// Writes app/src/gallery/shots/games.json, the store screenshots' fixture:
// the rows as index.ts lists them through the host harness, from the
// repo's own manifests. The machine it shows is a 0.9 one: the games come
// from pal's registry (docs/design/distribution.md, "What is bundled"),
// Solitaire, Wordle and Snake are installed, and every other game the
// registry lists is on offer under Not installed, each with its tile and
// tagline. The third shot is Wordle's leaderboards, as boards.ts draws them
// from a canned board (the core's `leaderboard.get`) and a canned list of
// boards (pal's server, a local one here).
// `bun run extensions/games/fixture.ts`, then `make shots EXT=games`.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Host, extensionsByName } from "../../host/test/harness.ts";
import { pinClock, writeFixture } from "../../app/scripts/fixture-kit.ts";
import type { AvailableExtension, LeaderboardRow, View } from "../../sdk/src/index.ts";
import manifest from "./pal.json" with { type: "json" };

const INSTALLED = new Set(["games", "solitaire", "wordle", "snake"]);

pinClock();
const dirs = extensionsByName();
const names = [...dirs.keys()].sort();
const installed = names.filter((n) => INSTALLED.has(n)).map((name) => ({ name, version: "0.1.0", root: dirname(dirs.get(name)!), loaded: true, store: name !== "games", bundled: name === "games" }));
const available: AvailableExtension[] = names.map((name) => {
  const m = JSON.parse(readFileSync(join(dirs.get(name)!, "pal.json"), "utf8"));
  const s = m.store ?? {};
  return {
    name, registry: "pal", installed: INSTALLED.has(name), bundled: name === "games", installable: true,
    listing: {
      title: m.title ?? name, description: m.description ?? "", tagline: s.tagline ?? "", features: s.features ?? [], category: s.category ?? "", keywords: m.keywords ?? [], icon: m.icon ?? null, author: m.author ?? "",
      platforms: s.platforms ?? null, play: !!s.play, palettes: Object.entries(m.palettes ?? {}).map(([id, p]: [string, any]) => ({ id, title: p.title ?? m.title ?? id, kind: p.kind ?? "list" })),
      screenshots: [], requires: m.requires ?? [], suggests: m.suggests ?? [],
    },
  };
});
// Today's Wordle board: guesses, fewest first; anonymous players among them, and you.
const row = (rank: number, name: string, value: number, anon = false, me = false): LeaderboardRow => ({ rank, name, anon, value, at: 1790000000, me });
const board = { board: null, me: null, rows: [row(1, "quillon", 2), row(2, "Teal Fox", 3, true), row(3, "ada", 3), row(4, "kemal", 3, false, true), row(5, "Brisk Heron", 4, true), row(6, "noor", 4), row(7, "bilge", 5), row(8, "Quiet Lynx", 6, true)] };
const server = Bun.serve({ port: 0, fetch: () => Response.json({ boards: [{ id: "daily/301" }, { id: "daily/300" }, { id: "daily/299" }, { id: "streak" }] }) });
process.env.PAL_ACCOUNT_API = `http://127.0.0.1:${server.port}`;
const host = await Host.bundled({ only: ["games"], core: { "extensions.list": () => installed, "store.state": () => ({ available }), "leaderboard.get": () => board, "account.get": () => ({ signedIn: true, handle: "kemal" }) } });
try {
  const items = await host.list("games", "games");
  // The view draws at once and pushes the board when it lands: the push with the rows in.
  await host.request<View>("view", { extension: "games", palette: "leaderboards", args: { game: "wordle" } });
  const has = (v: View) => JSON.stringify(v.tree).includes("quillon") && JSON.stringify(v.tree).includes("Wordle #301");
  await host.until(() => host.viewUpdates("games", { palette: "leaderboards" }).some((u) => has(u.spec as View)), 5000, "the board");
  const boards = host.viewUpdates("games", { palette: "leaderboards" }).map((u) => u.spec as View).find(has)!;
  writeFixture("games", {
    palettes: {
      games: { title: manifest.title, icon: manifest.icon, live: true, items },
      leaderboards: { title: "Leaderboards", icon: manifest.icon, view: "view", tree: boards },
    },
    shots: {
      "1-list": { palette: "games", keys: [], caption: "The games you have first, then every other game pal's registry offers, each with its tile and what it is; Enter installs one and starts it" },
      "2-search": { palette: "games", keys: ["type:daily"], caption: "Typing narrows the list, taglines included: daily finds the daily puzzles; Enter opens one" },
      "3-leaderboards": { palette: "leaderboards", keys: ["wait:1000"], caption: "A game's leaderboards: today's Wordle, fewest guesses first, anonymous players marked and your own row ringed" },
    },
  });
  console.log(`wrote app/src/gallery/shots/games.json: ${items.length} games`);
} finally {
  host.kill();
  server.stop(true);
}
