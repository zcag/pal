// A game's side of accounts (docs/extensions.md, "Syncing storage" and
// "Leaderboards"): its manifest's `sync` and `leaderboards` as pal-pack
// checks them, the storage keys its code uses (each needs a rule), and the
// server's merge (docs/design/accounts.md, "Merge rules") to play two
// machines that both played against each other.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { checkLeaderboards, checkSync, leaderboardOf } from "../../../sdk/src/manifest.ts";
import type { Manifest, SyncRule } from "../../../sdk/src/protocol.ts";

const EXT = join(import.meta.dir, "../../../extensions");

export const manifestOf = (name: string) => JSON.parse(readFileSync(join(EXT, name, "pal.json"), "utf8")) as Manifest & { sync: Record<string, SyncRule> };

/** What is wrong with the game's `sync` and `leaderboards`; [] when nothing. */
export const problems = (m: Manifest) => [...checkSync(m), ...checkLeaderboards(m)];

/** Every literal key the extension's code gets or sets (`storage.get("save")`, `pal.storage.set("run", ...)`), sorted. */
export function storedKeys(name: string): string[] {
  const keys = new Set<string>();
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === "scripts") continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.ts$/.test(e.name) && e.name !== "fixture.ts") for (const m of readFileSync(p, "utf8").matchAll(/storage\.(?:get|set|remove)\(\s*(["'`])([^"'`]+)\1/g)) keys.add(m[2]);
    }
  };
  walk(join(EXT, name));
  return [...keys].sort();
}

/** The board a posted id falls under, or undefined: what the server checks a score against. */
export const declared = (m: Manifest, board: string) => leaderboardOf(m, board);

/**
 * The server's merge of `mine` (the value pushed) onto `theirs` (the one it
 * holds, written since `base` was synced): the spec's table, recursively.
 */
export function merge(rule: SyncRule | undefined, mine: unknown, theirs: unknown, base?: unknown): unknown {
  if (mine === undefined) return theirs;
  if (theirs === undefined) return mine;
  if (rule === "max" || rule === "min") return (rule === "max" ? Math.max : Math.min)(mine as number, theirs as number);
  if (rule === "sum") return (theirs as number) + ((mine as number) - ((base as number) ?? 0));
  if (rule === "union") {
    const seen = new Set<string>();
    return [...(mine as unknown[]), ...(theirs as unknown[])].filter((x) => !seen.has(JSON.stringify(x)) && !!seen.add(JSON.stringify(x)));
  }
  if (rule && typeof rule === "object") {
    const f = rule.fields as Record<string, SyncRule>, a = mine as Record<string, unknown>, b = theirs as Record<string, unknown>, o = (base ?? {}) as Record<string, unknown>;
    return Object.fromEntries([...new Set([...Object.keys(b), ...Object.keys(a)])].map((k) => [k, merge(f[k], a[k], b[k], o[k])]));
  }
  return mine;
}
