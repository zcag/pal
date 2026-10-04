// The host tests' own rules, checked over their source (README.md has the why). A stand-in tool written as a fresh executable costs
// 0.15-0.3 s on macOS the first time it runs, and a file that writes one per host made the suite slow once already: every fake goes
// through `writeTool` (harness.ts). And no test waits on the real clock: the host runs on a fake one (src/clock.ts) that the test
// moves with `host.advance`, so a fixed sleep or a slow mock is never the way to let time pass. The extension repos' tests
// (app/scripts/extension-repos.mjs) are held to the same rules.
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { extensionRepos } from "../../app/scripts/extension-repos.mjs";

/** Each place tests live, with the name its files are shown under. */
const ROOTS = [{ dir: import.meta.dir, label: "host/test" }, ...extensionRepos().filter((r) => existsSync(r.tests) && !r.tests.startsWith(`${import.meta.dir}/`)).map((r) => ({ dir: r.tests, label: r.tests }))];
/** Files that may make an executable themselves, and why: `harness.ts` here, `scripts.test.ts` in pal-extensions' tests. */
const ALLOWED: Record<string, string> = {
  "host/test/harness.ts": "writeTool's stub, made once",
  "scripts.test.ts": "the scripts extension's own plugin and command files: it reads their headers, so they are real files",
};
const allowed = (f: string) => f in ALLOWED || f.split("/").pop()! in ALLOWED && !f.startsWith("host/test/");
/** Every test source, as `<label>/<path>` with its full path. */
const files = () => ROOTS.flatMap(({ dir, label }) => sources(dir).map((p) => ({ f: `${label}/${relative(dir, p)}`, p })));

/** A wait this long or longer is the host's fake clock's to make (src/clock.ts FROM): `host.advance`, never a real sleep. */
const LONGEST_SLEEP_MS = 100;
/** A line that sleeps on purpose inside code the host runs (a fixture extension's source), where the fake clock is what it waits on. */
const ON_HOST = "// on the host's clock";
/** A stand-in's sleep the test never waits out: a process that runs until it is killed, or one left to finish after the test. */
const NOT_WAITED = "never waited for";

const sources = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? sources(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []));

describe("host test rules", () => {
  test("a stand-in tool is written with writeTool, never made executable in place", () => {
    const offenders = files()
      .filter(({ f }) => !allowed(f) && f !== "host/test/rules.test.ts")
      .flatMap(({ f, p }) => readFileSync(p, "utf8").split("\n").map((line, i) => ({ at: `${f}:${i + 1}`, line })))
      .filter(({ line }) => /chmod(Sync)?\([^)]*0o[0-7]*[1357][0-7]{0,2}\)|mode:\s*0o[0-7]*[1357][0-7]{0,2}\b/.test(line))
      .map(({ at, line }) => `${at}  ${line.trim().slice(0, 100)}`);
    expect(offenders, "use writeTool(path, body) from harness.ts: README.md, Stand-in tools").toEqual([]);
  });

  test("nothing waits on the real clock: no sleep or timer of 100 ms or more in a test, a mock or a fake", () => {
    const delay = (line: string) => {
      const m = /(?:Bun\.sleep|\bsleep)\(\s*([\d_]+)\s*\)|setTimeout\(.*,\s*([\d_]+)\s*\)/.exec(line);
      if (m) return Number((m[1] ?? m[2]).replaceAll("_", ""));
      // A stand-in tool's shell `sleep` (a statement, not a word in a string the test compares): seconds, or a variable, taken as long.
      const sh = /(?:^|[;)]|\bthen|\bdo|&&|\|\|)\s*sleep\s+("?\$|[\d.]+)/.exec(line);
      return sh ? (sh[1].includes("$") ? Infinity : Number(sh[1]) * 1000) : 0;
    };
    const offenders = files()
      .filter(({ f }) => f !== "host/test/rules.test.ts")
      .flatMap(({ f, p }) => readFileSync(p, "utf8").split("\n").map((line, i) => ({ at: `${f}:${i + 1}`, line })))
      .filter(({ line }) => delay(line) >= LONGEST_SLEEP_MS && !line.includes(ON_HOST) && !line.includes(NOT_WAITED))
      .map(({ at, line }) => `${at}  ${line.trim().slice(0, 100)}`);
    expect(offenders, "let time pass with host.advance(ms) (the host's fake clock), hold a mock with a promise the test releases, or have a stand-in wait for a file the test writes: README.md, Time").toEqual([]);
  });
});
