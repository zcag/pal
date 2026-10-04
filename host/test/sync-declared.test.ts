// Every storage key a game writes has a sync rule (docs/design/accounts.md,
// "Merge rules"): a key left out syncs as `latest`, which for progress is a
// loss the player feels, so a game that says `sync` names every key it
// writes, even the ones that are `latest` or `local` on purpose. The keys
// are found in the source: `storage.set("k"` in the extension's code and
// `pal.storage.set("k"` in its page, the key a literal or a `const` of one
// in the same file. A key written any other way (a variable, a template)
// is reported too, since nothing could check it: write it as a literal.
// A game whose writes all go through a `progress.ts` names its keys there
// (`export const KEYS`); those are its keys, and its own writes by a
// variable are that module's, so they are not reported.
//
// The games are the store's Fun shelf that have a view palette (the Games
// shelf's own rule, extensions/games), less the ones that are not games,
// and any extension that declares `sync`. A game without `sync` is listed
// by its own test, a todo until every game has one.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { extensionsByName } from "./harness.ts";

/** Fun extensions with a view palette that are not games: the shelf itself, a GIF search. */
const NOT_GAMES = new Set(["games", "gifs"]);

type Manifest = { sync?: Record<string, unknown>; store?: { category?: string }; palettes?: Record<string, { kind?: string }> };
const DIRS = extensionsByName();
const manifestOf = (name: string): Manifest => JSON.parse(readFileSync(join(DIRS.get(name)!, "pal.json"), "utf8"));

const names = [...DIRS.keys()].sort();
const isGame = (m: Manifest, name: string) => !NOT_GAMES.has(name) && m.store?.category === "fun" && Object.values(m.palettes ?? {}).some((p) => p.kind === "view");
const games = names.filter((n) => isGame(manifestOf(n), n));
const checked = names.filter((n) => isGame(manifestOf(n), n) || manifestOf(n).sync !== undefined);

/** The extension's code and its page: every script and page, not its fixture (the screenshots' rig) or dependencies. */
const sources = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? (e.name === "node_modules" || e.name === "screenshots" ? [] : sources(join(dir, e.name)))
  : /\.(ts|js|html)$/.test(e.name) && e.name !== "fixture.ts" && !e.name.endsWith(".test.ts") ? [join(dir, e.name)] : []);

const SET = /\bstorage\.set\(\s*([^,)]+?)\s*[,)]/g;
const LITERAL = /^(["'`])([^"'`$]*)\1$/;

/** Every key written in one file, by its literal or the `const` that holds one; what neither is comes back as `unknown`. */
function writtenKeys(src: string): { keys: string[]; unknown: string[] } {
  const keys: string[] = [], unknown: string[] = [];
  for (const [, arg] of src.matchAll(SET)) {
    const lit = LITERAL.exec(arg);
    if (lit) { keys.push(lit[2]); continue; }
    const c = /^[A-Za-z_$][\w$]*$/.test(arg) ? new RegExp(`\\bconst\\s+${arg}\\s*=\\s*(["'\`])([^"'\`$]*)\\1`).exec(src) : null;
    if (c) keys.push(c[2]);
    else unknown.push(arg);
  }
  return { keys, unknown };
}

/** Per game: the keys it writes and where, and the writes no key could be read from. */
function scan(name: string): { keys: Map<string, string>; unknown: string[] } {
  const dir = DIRS.get(name)!;
  const keys = new Map<string, string>(), unknown: string[] = [];
  for (const file of sources(dir)) {
    const w = writtenKeys(readFileSync(file, "utf8"));
    const at = relative(dir, file);
    for (const k of w.keys) if (!keys.has(k)) keys.set(k, at);
    unknown.push(...w.unknown.map((u) => `${at}: storage.set(${u}, ...)`));
  }
  const progress = join(dir, "progress.ts");
  const listed: readonly string[] | undefined = existsSync(progress) ? require(progress).KEYS : undefined;
  if (!listed) return { keys, unknown };
  for (const k of listed) if (!keys.has(k)) keys.set(k, "progress.ts KEYS");
  return { keys, unknown: [] };
}

describe("synced storage is declared", () => {
  test("the scan reads literals and consts, and reports what it cannot read", () => {
    expect(writtenKeys(`const KEY = "state"; storage.set(KEY, s); pal.storage.set("save", x).catch(); storage.set('a'); storage.set(\`b\`, 1)`)).toEqual({ keys: ["state", "save", "a", "b"], unknown: [] });
    expect(writtenKeys("storage.set(key, v); storage.set(`run:${id}`, v)")).toEqual({ keys: [], unknown: ["key", "`run:${id}`"] });
  });

  // Those of them in the extension repos this run reads (pal-games has the games, pal-extensions the shelf).
  test("the games are found", () => {
    for (const g of ["2048", "wordle", "sudoku", "crossword", "solitaire"].filter((n) => DIRS.has(n))) expect(games).toContain(g);
    for (const n of NOT_GAMES) expect(games).not.toContain(n);
  });

  for (const name of checked) {
    const sync = manifestOf(name).sync;
    if (sync === undefined) continue;
    test(`${name}: every storage key it writes has a sync rule`, () => {
      const { keys, unknown } = scan(name);
      const missing = [...keys].filter(([k]) => !(k in sync)).map(([k, at]) => `${k} (written in ${at})`);
      expect(missing, `${name}'s pal.json "sync" leaves keys out: they would sync as latest. Give each a rule (docs/extensions.md, "Syncing storage")`).toEqual([]);
      expect(unknown, "a key the scan cannot read: write it as a literal or a const of one").toEqual([]);
    });
  }

  // A todo until every game has `sync` (the games got theirs one by one); then a plain test.
  const without = games.filter((n) => manifestOf(n).sync === undefined);
  (without.length ? test.todo : test)(`every game declares sync${without.length ? ` (not yet: ${without.join(", ")})` : ""}`, () => {
    expect(without).toEqual([]);
  });
});
