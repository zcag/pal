// shell: the pure helpers first (run.ts: the shell argv, the env table,
// what looks destructive, the terminal argv, the runner itself against
// /bin/sh), then the palette over the wire: one Run row per typed
// command and nothing run until a pick, the output view with its badges
// and streams, a run outlasting the pick grace pushed in through
// `view.update`, the timeout, the confirm on a destructive command, the
// terminal action against a stand-in `open`/terminal, the history.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CAP, commandsOf, duration, envTable, looksDestructive, PICK_GRACE_MS, q, run, shellArgv, terminalArgv } from "../../../extensions/shell/run.ts";
import { tile } from "../../../sdk/src/icon.ts";
import type { View, ViewNode } from "../../../sdk/src/protocol.ts";
import { checkView } from "../../../sdk/src/view.ts";
import { Host, stored } from "../harness.ts";

const MAC = process.platform === "darwin";

describe("run.ts", () => {
  test("shellArgv: the default is the login shell with -lic, $SHELL and ~ expand, an empty setting falls back", () => {
    expect(shellArgv("$SHELL -lic", { SHELL: "/bin/zsh" })).toEqual(["/bin/zsh", "-lic"]);
    expect(shellArgv("${SHELL} -lc", { SHELL: "/opt/fish" })).toEqual(["/opt/fish", "-lc"]);
    expect(shellArgv("/bin/bash -c", {})).toEqual(["/bin/bash", "-c"]);
    expect(shellArgv("  ", { SHELL: "/bin/zsh" })).toEqual(["/bin/zsh", "-lic"]);
    expect(shellArgv("", {})).toEqual([MAC ? "/bin/zsh" : "/bin/sh", "-lic"]);
    expect(shellArgv("~/bin/mysh -c", {})[0]).toMatch(/^\/.*\/bin\/mysh$/);
  });

  test("envTable reads KEY=VALUE lines, skips the rest, keeps = inside a value", () => {
    expect(envTable(["PAGER=cat", "A=b=c", "junk", "=nope", " SPACED = x "])).toEqual({ PAGER: "cat", A: "b=c", SPACED: " x " });
  });

  test("looksDestructive reads the command word of every simple command: rm, sudo, mv, dd, git reset --hard and friends; not rmdir, mvn, ls, an argument named rm, or a redirect to /dev/null", () => {
    expect(commandsOf("FOO=1 time ls -la | xargs /bin/rm; cd x && $(mkfs.ext4 /dev/sdb1)")).toEqual([["ls", "-la"], ["rm", ""], ["cd", "x"], ["mkfs", "/dev/sdb1"]]);
    for (const c of ["rm -rf build", "sudo apt update", "mv a b", "ls | xargs rm", "dd if=/dev/zero of=/dev/disk2", "git push --force", "git push -f origin main", "git reset --hard HEAD~1", "git clean -fd", "chmod -R 777 .", "kill -9 123", "shutdown -h now", "echo x > /dev/sda", "docker system prune", "brew uninstall foo", "mkfs.ext4 /dev/sdb1", "FOO=1 rm x", "/bin/rm x", "cd /tmp && rm -r a"]) expect([c, looksDestructive(c)]).toEqual([c, true]);
    for (const c of ["ls -la", "rmdir empty", "mvn package", "git status", "git push", "echo rm", "format-code", "kill 123", "chmod +x run.sh", "brew install foo", "npm install", "cat x > /dev/null", "echo hi 2>/dev/null", "grep rm *.txt"]) expect([c, looksDestructive(c)]).toEqual([c, false]);
  });

  test("terminalArgv: Terminal and iTerm over osascript, kitty and the others by flags, Linux with -e; the line cds first and keeps the shell open", () => {
    const sh = ["/bin/zsh", "-lic"];
    if (MAC) {
      const t = terminalArgv("ls -la", "/Users/x/proj", sh, "")!;
      expect(t.slice(0, 3)).toEqual(["osascript", "-e", `tell application "Terminal"`]);
      expect(t[6]).toBe(`do script "cd '/Users/x/proj' && ls -la; exec /bin/zsh"`);
      expect(terminalArgv("ls", "/tmp", sh, "iTerm")![2]).toBe(`tell application "iTerm"`);
      expect(terminalArgv("ls", "/tmp", sh, "kitty")).toEqual(["open", "-na", "kitty", "--args", "--directory", "/tmp", "/bin/zsh", "-c", "ls; exec /bin/zsh"]);
      expect(terminalArgv("ls", "/tmp", sh, "Ghostty")![4]).toBe("--working-directory=/tmp");
      expect(terminalArgv("ls", "/tmp", sh, "Warp")).toEqual(["open", "-na", "Warp", "--args", "-e", "/bin/zsh", "-c", "cd '/tmp' && ls; exec /bin/zsh"]);
    } else {
      // foot takes the command as trailing arguments, alacritty after -e, wezterm after `start --`; the setting wins over $TERMINAL, which wins over what is installed.
      expect(terminalArgv("ls", "/tmp", sh, "", { TERMINAL: "foot" })).toEqual(["foot", "/bin/zsh", "-c", "cd '/tmp' && ls; exec /bin/zsh"]);
      expect(terminalArgv("ls", "/tmp", sh, "alacritty", { TERMINAL: "foot" })).toEqual(["alacritty", "-e", "/bin/zsh", "-c", "cd '/tmp' && ls; exec /bin/zsh"]);
      expect(terminalArgv("ls", "/tmp", sh, "", {}, (n) => (n === "wezterm" ? "/usr/bin/wezterm" : null))!.slice(0, 3)).toEqual(["wezterm", "start", "--"]);
      expect(terminalArgv("ls", "/tmp", sh, "", {}, () => null)).toBeUndefined();
    }
    expect(q("it's")).toBe(`'it'\\''s'`);
  });

  test("run: stdout and stderr apart, the exit code, the duration; a timeout kills the group and keeps what was printed; a shell that does not exist is an error in err; the cap keeps the tail", async () => {
    const sh = ["/bin/sh", "-c"];
    let r = await run("echo out; echo err >&2; exit 3", { shell: sh, cwd: "/tmp", env: {}, timeout: 5 });
    expect(r).toMatchObject({ out: "out\n", err: "err\n", code: 3, timedOut: false, truncated: false });
    expect(r.ms).toBeGreaterThanOrEqual(0);
    r = await run("echo $PAL_X; pwd", { shell: sh, cwd: "/tmp", env: { PAL_X: "hello" }, timeout: 5 });
    expect(r.out).toBe(`hello\n${realpathSync("/tmp")}\n`);
    const t0 = Date.now();
    r = await run("echo before; sleep 5; echo after", { shell: sh, cwd: "/tmp", env: {}, timeout: 1 });
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(r).toMatchObject({ out: "before\n", code: null, timedOut: true });
    r = await run("true", { shell: ["/no/such/shell", "-c"], cwd: "/tmp", env: {}, timeout: 1 });
    expect(r.code).toBeNull();
    expect(r.err).toContain("/no/such/shell");
    r = await run(`head -c ${CAP * 3} /dev/zero | tr '\\0' 'x'; echo; echo END`, { shell: sh, cwd: "/tmp", env: {}, timeout: 5 });
    expect(r.truncated).toBe(true);
    expect(r.out.length).toBeLessThanOrEqual(CAP);
    expect(r.out.endsWith("END\n")).toBe(true);
    expect(duration(340)).toBe("340 ms");
    expect(duration(1234)).toBe("1.2 s");
    expect(duration(12_345)).toBe("12 s");
    expect(duration(125_000)).toBe("2 min 5 s");
  });
});

// ---- the palette over the wire ------------------------------------------------------

const dir = mkdtempSync(join(tmpdir(), "pal-shell-"));
/** What `pwd` prints inside it (macOS: /private/var/...). */
const real = realpathSync(dir);
const openLog = join(dir, "open.log");
// A stand-in `open` (macOS) / terminal (Linux) on PATH that logs its argv.
const bin = join(dir, "bin");
const stub = (name: string) => { const p = join(bin, name); writeFileSync(p, `#!/bin/sh\nprintf '%s\\n' "$*" >> "${openLog}"\n`); chmodSync(p, 0o755); };
mkdirSync(bin);
stub("open"); stub("osascript"); stub("x-terminal-emulator");
const opened = () => (existsSync(openLog) ? readFileSync(openLog, "utf8").trim().split("\n") : []);

let host: Host;
const oldPath = process.env.PATH;
beforeAll(async () => {
  process.env.PATH = `${bin}:${oldPath}`;
  stored.clear();
  host = await Host.bundled({ settings: { shell: { settings: { shell: "/bin/sh -c", cwd: dir, timeout: 2, env: ["PAL_GREETING=hi there"] } } } });
});
afterAll(() => { host.kill(); process.env.PATH = oldPath; rmSync(dir, { recursive: true, force: true }); });

const list = (q?: string, ctx?: Parameters<Host["list"]>[3]) => host.list("shell", "shell", q, ctx);
const pick = (id: string, action?: string) => host.pick("shell", "shell", id, action);
/** The view a pick answered, checked as the host would. */
const viewOf = (e: { view?: View }) => checkView(e.view);
/** The text nodes of a tree, in order, as [value, color]. */
const texts = (n: ViewNode): [string, string | undefined][] => (n.type === "text" ? [[n.value, n.color]] : n.type === "stack" ? n.children.flatMap(texts) : []);
const badges = (n: ViewNode): string[] => (n.type === "badge" ? [n.text] : n.type === "stack" ? n.children.flatMap(badges) : []);

describe("shell", () => {
  test("meta: an input palette on the slate console tile, inline on `$ ` and `> `; the history is input too; the manifest and the code agree", () => {
    const l = host.loaded().find((l) => l.extension === "shell")!;
    expect(l.warnings).toEqual([]);
    expect(l.palettes[0]).toMatchObject({ name: "shell", title: "Shell", input: true, live: false, inline: true, match: "^[$>] \\S", icon: tile("slate", "\u{f07b7}") });
    expect(l.palettes[1]).toMatchObject({ name: "history", title: "Shell History", input: true, live: false });
  });

  test("the empty query is hints naming the shell, the folder and the timeout; a typed command is one Run row with the command as a keyword, nothing run", async () => {
    const hints = await list("");
    expect(hints.map((h) => h.id)).toEqual(["hint:type", "hint:root", "hint:history"]);
    expect(hints[0].subtitle).toBe(`/bin/sh -c in ${dir}, 2 s at most`);
    expect(hints.every((h) => h.actions!.length === 0 && h.icon)).toBe(true);
    const marker = join(dir, "ran");
    const rows = await list(`touch ${marker}`);
    expect(rows).toEqual([expect.objectContaining({ id: `run:touch ${marker}`, name: `Run: touch ${marker}`, keywords: [`touch ${marker}`] })]);
    expect(rows[0].actions).toEqual([{ id: "run", title: "Run" }, { id: "terminal", title: "Run in terminal" }, { id: "copy_cmd", title: "Copy command", shortcut: "cmd+c" }]);
    await Bun.sleep(100);
    expect(existsSync(marker)).toBe(false);
    expect(await pick(rows[0].id, "copy_cmd")).toEqual({ copy: `touch ${marker}` });
    expect(existsSync(marker)).toBe(false);
  });

  test("Enter runs it: the view has the command as title, exit and duration badges, the folder, stdout in mono on a sunken surface and stderr in red; Enter there copies stdout, cmd+shift+e stderr, cmd+c the command", async () => {
    const [row] = await list("echo \"$PAL_GREETING\"; pwd; echo oops >&2; exit 2");
    const e = await pick(row.id);
    const v = viewOf(e);
    expect(v.id).toBe("run");
    expect(v.title).toBe('$ echo "$PAL_GREETING"; pwd; echo oops >&2; exit 2');
    expect(v.actions.map((a) => [a.id, a.shortcut])).toEqual([["copy", undefined], ["terminal", undefined], ["rerun", "cmd+r"], ["copy_cmd", "cmd+c"], ["copy_err", "cmd+shift+e"]]);
    expect(badges(v.tree)).toEqual(["exit 2"]);
    const t = texts(v.tree);
    expect(t[0][0]).toBe('$ echo "$PAL_GREETING"; pwd; echo oops >&2; exit 2');
    expect(t[1][0]).toMatch(/^\d+ ms$/);
    expect(t[2][0]).toBe(dir);
    expect(t.slice(3)).toEqual([[`hi there\n${real}`, undefined], ["oops", "red"]]);
    const well = (v.tree as { children: ViewNode[] }).children[2] as { surface?: string; children: { style?: string }[] };
    expect(well.surface).toBe("sunken");
    expect(well.children.map((c) => c.style)).toEqual(["mono", "mono"]);
    expect(await pick("run")).toEqual({ copy: `hi there\n${real}\n`, hud: "Copied output" });
    expect(await pick("run", "copy_err")).toEqual({ copy: "oops\n" });
    expect(await pick("run", "copy_cmd")).toEqual({ copy: 'echo "$PAL_GREETING"; pwd; echo oops >&2; exit 2' });
    // A green exit 0 and "(no output)" for a silent success.
    const v2 = viewOf(await pick((await list("true"))[0].id));
    expect(badges(v2.tree)).toEqual(["exit 0"]);
    expect(texts(v2.tree).at(-1)![0]).toBe("(no output)");
    expect(await pick("run")).toEqual({ copy: "", hud: "Nothing to copy" });
  });

  test("a run that outlasts the pick grace answers a running view and pushes the result into the open level when it ends; Enter meanwhile says so", async () => {
    const [row] = await list("sleep 1; echo late");
    const t0 = Date.now();
    const v = viewOf(await pick(row.id));
    expect(Date.now() - t0).toBeLessThan(PICK_GRACE_MS + 800);
    if (Date.now() - t0 < 1000) {
      // Still running: the badge says so and Enter refuses.
      expect(badges(v.tree)).toEqual(["running"]);
      expect(await pick("run")).toMatchObject({ keep: true, toast: { title: "Still running" } });
    }
    host.viewShown("shell", { palette: "shell" }, "run");
    const u = await host.nextViewUpdate("shell", { palette: "shell" }, (u) => badges((u.spec as { tree: ViewNode }).tree).includes("exit 0"), 4000);
    expect(u).toMatchObject({ extension: "shell", palette: "shell", id: "run" });
    expect(texts((u.spec as { tree: ViewNode }).tree).at(-1)![0]).toBe("late");
    expect(await pick("run")).toEqual({ copy: "late\n", hud: "Copied output" });
    host.viewHidden("shell", { palette: "shell" }, "run");
  }, 10_000);

  test("the timeout kills the command: a red killed badge with the time, what it printed kept", async () => {
    const [row] = await list("echo partial; sleep 10; echo never");
    const v = viewOf(await pick(row.id));
    host.viewShown("shell", { palette: "shell" }, "run");
    const u = badges(v.tree).includes("running") ? await host.nextViewUpdate("shell", { palette: "shell" }, (u) => badges((u.spec as { tree: ViewNode }).tree).some((b) => b.startsWith("killed")), 5000) : { spec: { tree: v.tree } };
    const tree = (u.spec as { tree: ViewNode }).tree;
    expect(badges(tree)).toEqual([expect.stringMatching(/^killed after \d/)]);
    expect(texts(tree).at(-1)![0]).toBe("partial");
    host.viewHidden("shell", { palette: "shell" }, "run");
  }, 10_000);

  test("Run again from the view runs the same command afresh", async () => {
    const stamp = join(dir, "stamp");
    const [row] = await list(`echo x >> ${stamp}; wc -l < ${stamp}`);
    expect(texts(viewOf(await pick(row.id)).tree).at(-1)![0].trim()).toBe("1");
    expect(texts(viewOf(await pick("run", "rerun")).tree).at(-1)![0].trim()).toBe("2");
  });

  test("a destructive-looking command asks first while `confirm` is on: the Run action carries the question and the destructive style; off, it is a plain Run", async () => {
    let [row] = await list("rm -rf build");
    expect(row.subtitle).toContain("asks first");
    expect(row.actions![0]).toEqual({ id: "run", title: "Run", confirm: "Run “rm -rf build”? It looks like it removes, overwrites or escalates.", style: "destructive" });
    host.changeSettings("shell", { settings: { shell: "/bin/sh -c", cwd: dir, timeout: 2, confirm: false } });
    [row] = await list("rm -rf build");
    expect(row.actions![0]).toEqual({ id: "run", title: "Run" });
    host.changeSettings("shell", { settings: { shell: "/bin/sh -c", cwd: dir, timeout: 2, env: ["PAL_GREETING=hi there"] } });
  });

  test("Run in terminal opens the terminal on the command in the working directory and hides; from the view too", async () => {
    const [row] = await list("git status");
    expect(await pick(row.id, "terminal")).toEqual({ hide: true });
    await host.until(() => opened().length > 0, 2000, "the terminal opened");
    expect(opened().at(-1)).toContain(MAC ? `cd '${dir}' && git status; exec /bin/sh` : `cd '${dir}' && git status; exec /bin/sh`);
    await pick(row.id);
    const n = opened().length;
    expect(await pick("run", "terminal")).toEqual({ hide: true });
    await host.until(() => opened().length > n, 2000, "the terminal opened again");
  });

  test("the inline ask: `$ ls` and `> ls` list the Run row for `ls`, a bare marker nothing; inside the palette the marker is stripped too", async () => {
    expect((await list("$ ls -la", { inline: true }))[0]).toMatchObject({ id: "run:ls -la", name: "Run: ls -la" });
    expect((await list("> git status", { inline: true }))[0].id).toBe("run:git status");
    expect(await list("$ ", { inline: true })).toEqual([]);
    expect((await list("$ pwd"))[0].id).toBe("run:pwd");
  });

  test("history: every command with its exit code (killed for a timeout), the duration and folder, newest first and once; Enter runs it again as a view; remove and clear; a query filters", async () => {
    const rows = await host.list("shell", "history", "");
    expect(rows.at(-1)).toMatchObject({ id: "clear", name: "Clear history" });
    const entries = rows.slice(0, -1);
    expect(entries.map((r) => r.name).slice(0, 4)).toEqual(["git status", `echo x >> ${join(dir, "stamp")}; wc -l < ${join(dir, "stamp")}`, "echo partial; sleep 10; echo never", "sleep 1; echo late"]);
    expect(entries[1].accessories).toEqual([{ tag: "exit 0", color: "green" }, { date: expect.any(Number) }]);
    expect(entries[2].accessories![0]).toEqual({ tag: "killed", color: "red" });
    expect(entries.find((r) => r.name.startsWith("echo \"$PAL_GREETING\""))!.accessories![0]).toEqual({ tag: "exit 2", color: "red" });
    expect(entries[0].subtitle).toMatch(new RegExp(`^\\d+ ms in ${dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
    expect(entries[0].actions!.map((a) => a.id)).toEqual(["run", "terminal", "copy_cmd", "remove"]);
    expect(entries.every((r) => r.icon)).toBe(true);
    // Filtered by substring; no Clear row then.
    const some = await host.list("shell", "history", "sleep");
    expect(some.map((r) => r.name)).toEqual(["echo partial; sleep 10; echo never", "sleep 1; echo late"]);
    const v = viewOf(await host.pick("shell", "history", "h:true"));
    expect(v.title).toBe("$ true");
    // The view's picks route through the history palette too.
    expect(await host.pick("shell", "history", "run", "copy_cmd")).toEqual({ copy: "true" });
    expect(await host.pick("shell", "history", "h:true", "copy_cmd")).toEqual({ copy: "true" });
    expect(await host.pick("shell", "history", "h:true", "remove")).toMatchObject({ keep: true, toast: { title: "Removed" } });
    expect((await host.list("shell", "history", "")).map((r) => r.id)).not.toContain("h:true");
    expect(await host.pick("shell", "history", "clear", "clear")).toMatchObject({ keep: true, toast: { title: "History cleared" } });
    expect(await host.list("shell", "history", "")).toEqual([expect.objectContaining({ id: "hint:empty", actions: [] })]);
  });
});
