// What a push needs tested (ci.yml's `scope` job): `bun ci-scope.ts <base>`
// diffs <base> against HEAD and writes `mode`, `names` and `app` to
// $GITHUB_OUTPUT (stdout without it).
//
// - mode=ext when every changed file is an extension's own (under
//   extensions/<name>/, its tests in host/test/extensions/, the bundled and
//   registry-only lists): the host's typechecks, its own tests and those
//   extensions' tests run (`make test-ext`), nothing Rust.
// - app=true besides when a pal.json changed: the app's gallery reads every
//   manifest, so its typecheck and tests run too.
// - mode=full for anything else, for a pal.json whose `bar` block changed
//   (the Rust parity snapshot reads its mocks), and when <base> can't be
//   diffed (a new branch, history rewritten away).
import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";

const git = (...args: string[]) => Bun.spawnSync(["git", ...args]);
const base = process.argv[2] ?? "";
const exts = readdirSync("extensions", { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
const json = (text: string) => { try { return JSON.parse(text); } catch { return undefined; } };
const bar = (rev: string, path: string) => JSON.stringify(json(rev ? git("show", `${rev}:${path}`).stdout.toString() : existsSync(path) ? readFileSync(path, "utf8") : "")?.bar ?? null);

function scope(): { mode: "full" | "ext"; names: string[]; app: boolean } {
  const full = { mode: "full" as const, names: [], app: true };
  if (!base || /^0+$/.test(base) || git("cat-file", "-e", `${base}^{commit}`).exitCode !== 0) return full;
  const files = git("diff", "--name-only", base, "HEAD").stdout.toString().split("\n").filter(Boolean);
  if (!files.length) return full;
  const names = new Set<string>();
  let app = false;
  for (const f of files) {
    const own = /^extensions\/([^/]+)\/(.+)$/.exec(f);
    // A test file belongs to the extension whose name it starts with, the longest one (home-assistant over home).
    const test = /^host\/test\/extensions\/([^/]+)\.test\.ts$/.exec(f);
    const name = own?.[1] ?? (test && exts.filter((e) => test[1] === e || test[1].startsWith(`${e}-`)).sort((a, b) => b.length - a.length)[0]);
    if (name) {
      names.add(name);
      if (own?.[2] === "pal.json") {
        if (bar(base, f) !== bar("", f)) return full;
        app = true;
      }
    } else if (!/^extensions\/(bundled|registry-only)\.txt$/.test(f)) return full;
  }
  return { mode: "ext", names: [...names].sort(), app };
}

const s = scope();
const out = `mode=${s.mode}\nnames=${s.names.join(" ")}\napp=${s.app}\n`;
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, out);
process.stdout.write(out);
