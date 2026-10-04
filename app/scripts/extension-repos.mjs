// Where pal's own extensions are on this machine (docs/design/repo-split.md):
// the checkouts of zcag/pal-extensions and zcag/pal-games beside the pal
// checkout, or the ones PAL_EXTENSION_REPOS lists (a path list, `:`
// separated), falling back to pal's own extensions/ while it still exists.
// What a debug app (pal_core::extensions::dev, the same rule), the host
// tests (host/test/harness.ts), the screenshot tool and the gallery read.
//
// A repo is { dir, shots, tests }: `dir` holds the `<name>/` directories,
// `shots` the gallery fixtures (`<name>.json`, `bar-<name>.json`) and
// `tests` the tests.
import { existsSync, readdirSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The pal checkout this file is in. */
export const PAL = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
/** The repos looked for beside the pal checkout. */
export const SIBLINGS = ["pal-extensions", "pal-games"];

const split = (dir) => ({ dir, shots: join(dir, "test/shots"), tests: join(dir, "test") });

/** The extension repos, in order: a name in an earlier one wins. */
export function extensionRepos(env = process.env) {
  const listed = env.PAL_EXTENSION_REPOS?.split(delimiter).filter(Boolean);
  const repos = (listed?.length ? listed.map((p) => resolve(p)) : SIBLINGS.map((n) => resolve(PAL, "..", n))).filter((d) => existsSync(d)).map(split);
  if (repos.length || listed?.length || !existsSync(join(PAL, "extensions"))) return repos;
  return [{ dir: join(PAL, "extensions"), shots: join(PAL, "app/src/gallery/shots"), tests: join(PAL, "host/test/extensions") }];
}

/** Every extension in the repos, by name: `{ dir, repo }`, the first repo's when two have one. */
export function extensionDirs(repos = extensionRepos()) {
  const out = new Map();
  for (const repo of repos) {
    for (const e of readdirSync(repo.dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!e.isDirectory() || e.name.startsWith(".") || e.name === "node_modules" || out.has(e.name)) continue;
      if (existsSync(join(repo.dir, e.name, "pal.json"))) out.set(e.name, { dir: join(repo.dir, e.name), repo });
    }
  }
  return out;
}

/** One extension's directory, or undefined. */
export const extensionDir = (name, repos) => extensionDirs(repos).get(name)?.dir;

// For the shell scripts: `node app/scripts/extension-repos.mjs` prints the
// repos' directories one a line, `... list` every extension as
// `<name>\t<dir>\t<shots dir>`.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "list") for (const [name, { dir, repo }] of extensionDirs()) console.log(`${name}\t${dir}\t${repo.shots}`);
  else for (const r of extensionRepos()) console.log(r.dir);
}
