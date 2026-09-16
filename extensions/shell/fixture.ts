// Writes app/src/gallery/shots/shell.json, the store screenshots'
// fixture: the palette listed and picked through the host harness with
// `/bin/sh -c` in a temp folder of made-up files, so the output views are
// what the code draws for real commands and nothing is the owner's.
// `bun run extensions/shell/fixture.ts`, then `node app/scripts/shots.mjs shell`.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Host, stored } from "../../host/test/harness.ts";

const dir = mkdtempSync(join(tmpdir(), "pal-shell-fixture-"));
for (const [name, bytes] of [["README.md", 1840], ["package.json", 612], ["index.ts", 9210], ["notes.txt", 88]] as const) writeFileSync(join(dir, name), Buffer.alloc(bytes, 120));
mkdirSync(join(dir, "src"));
mkdirSync(join(dir, "dist"));

const OUTPUT = "ls -la";
const STDERR = "python3 -c 'import requests'";
const CONFIRM = "rm -rf dist";

stored.clear();
const host = await Host.bundled({ settings: { shell: { settings: { shell: "/bin/sh -c", cwd: dir, timeout: 5 } } } });
try {
  const l = host.loaded().find((l) => l.extension === "shell")!;
  const [shell, history] = l.palettes;
  const byQuery: Record<string, unknown> = { "": await host.list("shell", "shell", "") };
  const effects: Record<string, unknown> = {};
  // The folder's name in the view is the temp path; the shot wants a homely one.
  const homely = (s: string) => s.split(dir).join("~/proj/demo").split(process.env.USER ?? "\0").join("sam");
  const scrub = <T,>(v: T): T => JSON.parse(homely(JSON.stringify(v)));
  for (const cmd of [OUTPUT, STDERR, CONFIRM]) {
    const [row] = await host.list("shell", "shell", cmd);
    byQuery[cmd] = scrub([row]);
    if (cmd === CONFIRM) continue;
    effects[`shell/${row.id}`] = scrub(await host.pick("shell", "shell", row.id));
  }
  // A few more runs so the history has a screenful: stand-ins with the exit codes those commands would have here, shown under their names.
  const extra: [string, string, number][] = [["git status --short", "true", 5 * 60e3], ["make test", "exit 2", 40 * 60e3], ["docker ps", "true", 3 * 3600e3], ["brew outdated", "true", 26 * 3600e3]];
  for (const [, cmd] of extra) await host.pick("shell", "shell", (await host.list("shell", "shell", cmd))[0].id);
  await host.until(() => host.coreCalls.filter((c) => c.method === "storage.set").length >= 6, 5000, "the history written");
  const rows = (await host.list("shell", "history", "")).flatMap((r) => {
    const e = extra.find(([, cmd]) => r.id === `h:${cmd}`);
    if (!e) return [r];
    // The stand-ins for `true` share one history row (the history is by command); one row per name instead.
    return extra.filter(([, cmd]) => cmd === e[1]).map(([name, , age]) => ({ ...r, id: `h:${name}`, name, keywords: [name], accessories: [r.accessories![0], { date: Date.now() - age }] }));
  });
  const dateOf = (r: { accessories?: unknown[] }) => Number((r.accessories?.[1] as { date?: number } | undefined)?.date ?? 0);
  rows.sort((a, b) => (a.id === "clear" ? 1 : b.id === "clear" ? -1 : dateOf(b) - dateOf(a)));
  const fixture = {
    palettes: {
      shell: { title: shell.title, icon: shell.icon, input: true, placeholder: shell.placeholder, byQuery },
      history: { title: history.title, icon: history.icon, input: true, placeholder: history.placeholder, byQuery: { "": scrub(rows) } },
    },
    effects,
    shots: {
      "1-run": { palette: "shell", keys: [`type:${OUTPUT}`] },
      "2-output": { palette: "shell", keys: [`type:${OUTPUT}`, "enter", "wait:400"] },
      "3-stderr": { palette: "shell", keys: [`type:${STDERR}`, "enter", "wait:400"] },
      "4-confirm": { palette: "shell", keys: [`type:${CONFIRM}`, "enter", "wait:300"] },
      "5-history": { palette: "history", keys: ["down"] },
    },
  };
  writeFileSync(new URL("../../app/src/gallery/shots/shell.json", import.meta.url), JSON.stringify(fixture, null, 2) + "\n");
  console.log("wrote app/src/gallery/shots/shell.json");
} finally {
  host.kill();
  rmSync(dir, { recursive: true, force: true });
}
