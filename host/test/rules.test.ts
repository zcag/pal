// The host tests' own rules, checked over their source (README.md has the why). A stand-in tool written as a fresh executable costs
// 0.15-0.3 s on macOS the first time it runs, and a file that writes one per host made the suite slow once already: every fake goes
// through `writeTool` (harness.ts).
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = import.meta.dir;
/** Files that may make an executable themselves, and why. */
const ALLOWED: Record<string, string> = {
  "harness.ts": "writeTool's stub, made once",
  "extensions/scripts.test.ts": "the scripts extension's own plugin and command files: it reads their headers, so they are real files",
};

const sources = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? sources(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []));

describe("host test rules", () => {
  test("a stand-in tool is written with writeTool, never made executable in place", () => {
    const offenders = sources(ROOT)
      .map((p) => relative(ROOT, p))
      .filter((f) => !(f in ALLOWED) && f !== "rules.test.ts")
      .flatMap((f) => readFileSync(join(ROOT, f), "utf8").split("\n").map((line, i) => ({ at: `${f}:${i + 1}`, line })))
      .filter(({ line }) => /chmod(Sync)?\([^)]*0o[0-7]*[1357][0-7]{0,2}\)|mode:\s*0o[0-7]*[1357][0-7]{0,2}\b/.test(line))
      .map(({ at, line }) => `${at}  ${line.trim().slice(0, 100)}`);
    expect(offenders, "use writeTool(path, body) from harness.ts: README.md, Stand-in tools").toEqual([]);
  });
});
