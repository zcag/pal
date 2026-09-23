// The host tests' time budget (make test, CI): reads bun's JUnit report, prints the slowest files, and fails when one is over
// BUDGET_S (three times that on the CI runner, as the harness's waits). The suite runs its files in parallel, so it takes about as
// long as its slowest file: one file creeping past the budget is what makes `make test` slow again, and this names it the day it
// happens. README.md says what usually makes a file slow and what to do instead.
import { readFileSync } from "node:fs";

const BUDGET_S = 30 * (process.env.CI ? 3 : 1);

const xml = readFileSync(process.argv[2], "utf8");
const files = new Map<string, number>();
for (const m of xml.matchAll(/<testsuite name="[^"]*" file="([^"]+)"[^>]* time="([\d.]+)"/g)) files.set(m[1], Math.max(files.get(m[1]) ?? 0, Number(m[2])));
if (!files.size) throw new Error(`no test files in ${process.argv[2]}`);

const slow = [...files].sort((a, b) => b[1] - a[1]);
console.log(`host tests, slowest files (budget ${BUDGET_S} s each):`);
for (const [f, s] of slow.slice(0, 5)) console.log(`  ${s.toFixed(1).padStart(5)} s  ${f}`);
const over = slow.filter(([, s]) => s > BUDGET_S);
if (over.length) {
  console.error(`\n${over.map(([f]) => f).join(", ")} over the ${BUDGET_S} s budget: see host/test/README.md (usually a real tick or timeout to make configurable, or fakes to write with writeTool)`);
  process.exit(1);
}
