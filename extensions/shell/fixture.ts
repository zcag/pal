// Writes app/src/gallery/shots/shell.json, the store screenshots'
// fixture: the palette listed and picked through the host harness with
// `/bin/sh -c` in a temp folder of made-up files, so the output views are
// what the code draws for real commands and nothing is the owner's. The
// files are dated at the fixed clock; how long a run took is the real
// clock's, so the durations (the view's badge, the history's subtitles)
// are set to plausible ones after, with the history's ages.
// `bun run extensions/shell/fixture.ts`, then `node app/scripts/shots.mjs shell`.
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ViewNode } from "@zcag/pal";
import { NOW, pinClock, writeFixture } from "../../app/scripts/fixture-kit.ts";
import { Host, stored } from "../../host/test/harness.ts";
import { duration } from "./run.ts";

const dir = mkdtempSync(join(tmpdir(), "pal-shell-fixture-"));
const M = 60e3, H = 60 * M, D = 24 * H;
const at = (path: string, age: number) => utimesSync(path, new Date(NOW - age), new Date(NOW - age));
for (const [name, bytes, age] of [["README.md", 1840, 3 * D], ["package.json", 612, 2 * H], ["index.ts", 9210, 25 * M], ["notes.txt", 88, 6 * D]] as const) { writeFileSync(join(dir, name), Buffer.alloc(bytes, 120)); at(join(dir, name), age); }
// A report script that fails the way a missing config does, the same on every machine.
writeFileSync(join(dir, "report.py"), 'import tomllib\n\nwith open("config.toml", "rb") as f:\n    config = tomllib.load(f)\n');
at(join(dir, "report.py"), 50 * M);
for (const [sub, age] of [["src", 25 * M], ["dist", 2 * D]] as const) { mkdirSync(join(dir, sub)); at(join(dir, sub), age); }

const OUTPUT = "ls -l";
const STDERR = "python3 report.py";
const CONFIRM = "rm -rf dist";

stored.clear();
pinClock();
const host = await Host.bundled({ settings: { shell: { settings: { shell: "/bin/sh -c", cwd: dir, timeout: 5 } } } });
try {
  const l = host.loaded().find((l) => l.extension === "shell")!;
  const [shell, history] = l.palettes;
  // The folder's name in the view is the temp path; the shot wants a homely one.
  const homely = (s: string) => s.split(`/private${dir}`).join("~/proj/demo").split(dir).join("~/proj/demo").split(process.env.USER ?? "\0").join("sam");
  const scrub = <T,>(v: T): T => JSON.parse(homely(JSON.stringify(v)));
  const byQuery: Record<string, unknown> = { "": scrub(await host.list("shell", "shell", "")) };
  const effects: Record<string, unknown> = {};
  // How long each run took, and how long ago, newest first.
  const TIMES: Record<string, [ms: number, age: number]> = { [STDERR]: [48, M], [OUTPUT]: [12, 2 * M], "git status --short": [31, 5 * M], "make test": [14_200, 40 * M], "docker ps": [86, 3 * H], "brew outdated": [2_400, 26 * H] };
  // The view's duration is the text after the exit badge in its head row.
  const timed = (n: ViewNode, ms: number): ViewNode => "children" in n ? { ...n, children: n.children.map((c, i, all) => (c.type === "text" && all[i - 1]?.type === "badge" ? { ...c, value: duration(ms) } : timed(c, ms))) } as ViewNode : n;
  for (const cmd of [OUTPUT, STDERR, CONFIRM]) {
    const [row] = await host.list("shell", "shell", cmd);
    byQuery[cmd] = scrub([row]);
    if (cmd === CONFIRM) continue;
    const effect = scrub(await host.pick("shell", "shell", row.id)) as { view: { tree: ViewNode } };
    effects[`shell/${row.id}`] = { ...effect, view: { ...effect.view, tree: timed(effect.view.tree, TIMES[cmd][0]) } };
  }
  // A few more runs so the history has a screenful: stand-ins with the exit codes those commands would have here, shown under their names.
  const extra: [string, string][] = [["git status --short", "true"], ["make test", "exit 2"], ["docker ps", "true"], ["brew outdated", "true"]];
  for (const [, cmd] of extra) await host.pick("shell", "shell", (await host.list("shell", "shell", cmd))[0].id);
  await host.until(() => host.coreCalls.filter((c) => c.method === "storage.set").length >= 6, 5000, "the history written");
  const rows = (await host.list("shell", "history", "")).flatMap((r) => {
    const e = extra.find(([, cmd]) => r.id === `h:${cmd}`);
    // The stand-ins for `true` share one history row (the history is by command); one row per name instead.
    const named = e ? extra.filter(([, cmd]) => cmd === e[1]).map(([name]) => ({ ...r, id: `h:${name}`, name, keywords: [name] })) : [r];
    return named.map((n) => (TIMES[n.name] ? { ...n, subtitle: n.subtitle!.replace(/^.*? in /, `${duration(TIMES[n.name][0])} in `), accessories: [n.accessories![0], { date: NOW - TIMES[n.name][1] }] } : n));
  });
  const dateOf = (r: { accessories?: unknown[] }) => Number((r.accessories?.[1] as { date?: number } | undefined)?.date ?? 0);
  // Clear history counts the rows as the history would hold them, one per name.
  const clear = rows.find((r) => r.id === "clear");
  if (clear) clear.subtitle = `${rows.length - 1} commands`;
  rows.sort((a, b) => (a.id === "clear" ? 1 : b.id === "clear" ? -1 : dateOf(b) - dateOf(a)));
  const fixture = {
    palettes: {
      shell: { title: shell.title, icon: shell.icon, input: true, placeholder: shell.placeholder, byQuery },
      history: { title: history.title, icon: history.icon, input: true, placeholder: history.placeholder, byQuery: { "": scrub(rows) } },
    },
    effects,
    shots: {
      "1-run": { palette: "shell", keys: [`type:${OUTPUT}`], caption: "A command typed: one Run row, nothing has run yet" },
      "2-output": { palette: "shell", keys: [`type:${OUTPUT}`, "enter", "wait:400"], caption: "The output view: exit 0 and the duration as badges, stdout in mono on the sunken surface" },
      "3-stderr": { palette: "shell", keys: [`type:${STDERR}`, "enter", "wait:400"], caption: "A failing command: stderr in red, exit 1" },
      "4-confirm": { palette: "shell", keys: [`type:${CONFIRM}`, "enter", "wait:300"], caption: "rm -rf on the way: the confirm card before anything runs" },
      "5-history": { palette: "history", keys: ["down"], caption: "Shell History: past commands with their exit codes, Enter runs one again" },
    },
  };
  writeFixture("shell", fixture);
  console.log("wrote app/src/gallery/shots/shell.json");
} finally {
  host.kill();
  rmSync(dir, { recursive: true, force: true });
}
