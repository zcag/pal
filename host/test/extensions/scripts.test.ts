// scripts: a scratch v1 config with a data palette and script palettes,
// pointed at through the `config` setting; then the single-file script
// commands (commands.ts) from a scratch folder through the `commands`
// setting: the header parser, the rows, every mode, the form, the watcher.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse, scan, seconds, tags } from "../../../extensions/scripts/commands.ts";
import { tile } from "../../../sdk/src/icon.ts";
import { xdg } from "../../../sdk/src/icons.ts";
import type { Form } from "../../../sdk/src/protocol.ts";
import { Host } from "../harness.ts";

const dir = mkdtempSync(join(tmpdir(), "pal-v1-"));
const w = (rel: string, text: string, exec = false) => {
  const p = join(dir, rel);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, text);
  if (exec) chmodSync(p, 0o755);
};

w("config.toml", `
[general]
env_file = "env"

[palette.links]
auto_list = true
data = "links.json"
icon_utf = "★"
auto_pick = true
default_action = "copy"
action_key = "url"

[palette.grid]
auto_list = true
data = "links.json"
view = "grid"
display = { columns = 5, detail = true }
filter = [{ id = "all", name = "All" }, { id = "few" }]

[palette.inp]
base = "plugins/inp"
input = true
input_prompt = "Type here"
live = true

[palette.counter]
base = "plugins/counter"
ttl = 60

[palette.fresh]
base = "plugins/counter"
live = true

[palette.gated]
base = "plugins/inp"
requires = ["definitely-not-a-binary-on-this-box"]

[palette.alt]
base = "plugins/inp"
requires = ["definitely-not-a-binary-on-this-box|bash"]

[palette.otheros]
base = "plugins/inp"
os = "${process.platform === "darwin" ? "linux" : "macos"}"

[palette.oldbuiltin]
base = "builtin/palettes/pals"

[palette.empty]
icon = "x"

[palette.calc]
base = "plugins/inp"

[palette.big]
auto_list = true
data = "big.json"

[palette.bigprimary]
auto_list = true
data = "big.json"
tier = "primary"

[palette.badtier]
auto_list = true
data = "links.json"
tier = "huge"
`);
w("big.json", JSON.stringify(Array.from({ length: 100 }, (_, i) => ({ name: `row ${i}` }))));
w("env", "SECRET=from-env-file\n# comment\nQUOTED='q v'\n");
w("links.json", JSON.stringify([
  { name: "Alpha", url: "http://a", icon_xdg: "web-browser", accessories: [{ tag: { value: "t", color: "red" } }, { text: { value: "tx" } }, { date: "2025-01-01" }] },
  { id: "b", name: "Beta", url: "http://b", icon_utf: "β", detail: { markdown: "**b**", metadata: [{ label: "L", text: "v" }, { label: "K", link: "http://k", text: "kk" }, { separator: true }, { label: "T", tags: ["x", { text: "y", color: "green" }] }] } },
]));
w("plugins/inp/plugin.toml", `command = "run.sh"\nactions = [{ id = "show", title = "Show it" }, { id = "push", title = "Drill" }, { id = "cp", title = "Copy name", action = "copy", key = "name", primary = true }]`);
w("plugins/inp/run.sh", `#!/bin/bash
case "$1" in
  list)
    q=$(cat)
    echo "{\\"id\\":\\"a\\",\\"name\\":\\"alpha $q\\",\\"preview\\":\\"echo preview-of-\\$PAL_NAME-\\$SECRET\\",\\"filter\\":\\"\${PAL_FILTER:-none}\\",\\"x\\":\\"\${X:-unset}\\",\\"secret\\":\\"$SECRET\\",\\"quoted\\":\\"$QUOTED\\"}"
    echo '{"id":"b","name":"beta"}'
    echo 'not json'
    ;;
  pick)
    item=$(cat)
    case "$PAL_ACTION" in
      show) echo '{"show":{"title":"Out","markdown":"# hi","metadata":[{"label":"M","text":"m"}]}}' ;;
      push) echo '{"palette":"inp","env":{"X":"pushed"}}' ;;
      *) echo "some output"; echo "{\\"clipboard\\":\\"$PAL_ID:$(echo "$item" | head -c 1)\\",\\"hud\\":\\"copied\\"}" ;;
    esac
    ;;
esac
`, true);
w("plugins/counter/run.sh", `#!/bin/bash
f="$(dirname "$0")/count"
n=$(( $(cat "$f" 2>/dev/null || echo 0) + 1 ))
echo $n > "$f"
[ "$1" = list ] && echo "{\\"name\\":\\"run $n\\"}"
exit 0
`, true);

let host: Host;
const cmdDir = join(dir, "commands");
mkdirSync(cmdDir, { recursive: true });
beforeAll(async () => { host = await Host.bundled({ settings: { scripts: { settings: { config: join(dir, "config.toml"), skip: ["calc"], commands: cmdDir } } } }); });
afterAll(() => { host.kill(); rmSync(dir, { recursive: true, force: true }); });

const names = () => host.loaded().find((l) => l.extension === "scripts")!.palettes.map((p) => p.name).sort();

describe("discovery", () => {
  test("every usable [palette.*] is a palette; requires/os gate, skip drops, a builtin base and an empty one are inert", () => {
    expect(names()).toEqual(["alt", "badtier", "big", "bigprimary", "commands", "counter", "empty", "fresh", "grid", "inp", "links", "oldbuiltin"]);
    expect(host.stderr).toContain("gated: gated (needs definitely-not-a-binary-on-this-box)");
    expect(host.stderr).toContain("calc: skipped (native)");
    expect(host.stderr).toMatch(/otheros: gated \((linux|macos) only\)/);
  });

  test("meta from the v1 fields: input, prompt, live, grid, columns, detail pane, filters, lazy detail only for scripts; ttl from the table, else the setting's default for a non-live one; a table without an icon wears the extension's tile", () => {
    const by = Object.fromEntries(host.loaded().find((l) => l.extension === "scripts")!.palettes.map((p) => [p.name, p]));
    const TILE = tile("slate", xdg("utilities-terminal")!);
    expect(by.inp).toEqual({ name: "inp", title: "inp", live: true, input: true, placeholder: "Type here", detail: "lazy", icon: TILE });
    expect(by.grid).toEqual({ name: "grid", title: "grid", live: false, input: false, view: "grid", columns: 5, showDetail: true, filters: [{ id: "all", title: "All" }, { id: "few", title: "few" }], ttl: 3600, icon: TILE });
    expect(by.counter.ttl).toBe(60);
    expect(by.fresh).not.toHaveProperty("ttl");
    expect(by.links).toEqual({ name: "links", title: "links", live: false, input: false, icon: "★", ttl: 3600 });
    expect(by.links.detail).toBeUndefined();
  });

  test("tier: a data file of 100 rows or more is a catalog at the root, the table's own tier wins, a bad one is ignored, a script's rows have none", () => {
    const by = Object.fromEntries(host.loaded().find((l) => l.extension === "scripts")!.palettes.map((p) => [p.name, p]));
    expect(by.big.tier).toBe("catalog");
    expect(by.bigprimary.tier).toBe("primary");
    expect(by.badtier).not.toHaveProperty("tier");
    expect(host.stderr).toContain('tier "huge" is not one of primary, normal, catalog; ignored');
    expect(by.links).not.toHaveProperty("tier");
    expect(by.counter).not.toHaveProperty("tier");
  });

  test("an inert palette lists one hint row", async () => {
    expect(await host.list("scripts", "oldbuiltin")).toEqual([{ id: "hint", name: "oldbuiltin is not available", subtitle: "v1 builtin (builtin/palettes/pals) has no equivalent yet", icon: xdg("dialog-warning"), actions: [] }]);
    expect((await host.list("scripts", "empty"))[0].subtitle).toBe("no base and no data");
    expect(await host.pick("scripts", "oldbuiltin", "hint")).toEqual({});
  });
});

describe("data palette", () => {
  test("rows from the JSON file: ids default to names, icon_xdg via the host's table, icon_utf as is, accessories and detail mapped from v1, extra fields ride along", async () => {
    const [a, b] = await host.list("scripts", "links");
    expect(a).toEqual({
      id: "Alpha", name: "Alpha", url: "http://a", icon: xdg("web-browser")!,
      accessories: [{ tag: "t", color: "red" }, { text: "tx" }, { date: "2025-01-01" }],
      actions: [{ id: "_default", title: "Copy" }],
    });
    expect(a.detail).toBeUndefined();
    expect(b).toMatchObject({ id: "b", icon: "β", actions: [{ id: "_default", title: "Copy" }] });
    expect(b.detail).toEqual({ markdown: "**b**", metadata: [{ label: "L", value: "v" }, { label: "K", link: { text: "kk", href: "http://k" } }, { label: "T", tags: [{ text: "x" }, { text: "y", color: "green" }] }] });
    expect((b.detail!.metadata![1] as any).value).toBeUndefined();
  });

  test("auto_pick with default_action copy and action_key copies that field", async () => {
    expect(await host.pick("scripts", "links", "Alpha")).toEqual({ copy: "http://a" });
    expect(await host.pick("scripts", "links", "b", "_default")).toEqual({ copy: "http://b" });
  });

  test("an unknown id is a failure toast", async () => {
    expect(await host.pick("scripts", "links", "zzz")).toMatchObject({ toast: { style: "failure", title: "Item not found" } });
  });

  test("a palette without auto_pick or actions on a data file: Select-less rows, pick does nothing", async () => {
    const [a] = await host.list("scripts", "grid");
    expect(a.actions).toBeUndefined();
    expect(await host.pick("scripts", "grid", "Alpha")).toEqual({});
  });
});

describe("script palette", () => {
  test("list runs `run.sh list` with the query on stdin, PAL_FILTER, push args and the env file exported; bad lines dropped", async () => {
    const items = await host.list("scripts", "inp", "hey", { filter: "few", args: { X: "arg", ignored: 1 } });
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ id: "a", name: "alpha hey", filter: "few", x: "arg", secret: "from-env-file", quoted: "q v" });
    expect(items[0].preview).toBeUndefined();
    expect(items[0].actions).toEqual([{ id: "cp", title: "Copy name" }, { id: "show", title: "Show it" }, { id: "push", title: "Drill" }]);
    expect((await host.list("scripts", "inp", ""))[0]).toMatchObject({ name: "alpha ", filter: "none", x: "unset" });
  });

  test("pick: a builtin copy action by key, the script's envelope (clipboard + hud), show and palette envelopes", async () => {
    await host.list("scripts", "inp", "");
    expect(await host.pick("scripts", "inp", "a")).toEqual({ copy: "alpha " });
    expect(await host.pick("scripts", "inp", "a", "cp")).toEqual({ copy: "alpha " });
    expect(await host.pick("scripts", "inp", "b", "show")).toEqual({ show: { title: "Out", markdown: "# hi", metadata: [{ label: "M", value: "m" }] } });
    expect(await host.pick("scripts", "inp", "b", "push")).toEqual({ push: { extension: "scripts", palette: "inp", args: { X: "pushed" } } });
  });

  test("the drill-in level's rows are kept apart from the root's", async () => {
    await host.list("scripts", "inp", "root");
    await host.list("scripts", "inp", "child", { args: { X: "pushed" } });
    expect(await host.pick("scripts", "inp", "a")).toEqual({ copy: "alpha root" });
    expect(await host.pick("scripts", "inp", "a", "cp", { args: { X: "pushed" } })).toEqual({ copy: "alpha child" });
  });

  test("an action without a builtin falls back to the script's pick with PAL_ACTION set and the item on stdin", async () => {
    await host.list("scripts", "inp", "");
    const e = await host.pick("scripts", "inp", "a", "nosuch");
    expect(e).toEqual({ copy: "a:{" });
  });

  test("preview runs on detail with the item's env, cached by the host until the next list", async () => {
    await host.list("scripts", "inp", "");
    expect(await host.detail("scripts", "inp", "a")).toEqual({ markdown: "preview-of-alpha -from-env-file\n" });
    expect(await host.detail("scripts", "inp", "b")).toEqual({});
    expect(await host.detail("scripts", "inp", "a")).toEqual({ markdown: "preview-of-alpha -from-env-file\n" });
  });

  test("ttl caches a list for the same query; a live table without ttl runs the script on every list", async () => {
    expect(await host.list("scripts", "counter", "")).toEqual(await host.list("scripts", "counter", ""));
    const f1 = (await host.list("scripts", "fresh", ""))[0].name;
    const f2 = (await host.list("scripts", "fresh", ""))[0].name;
    expect(f1).not.toBe(f2);
    expect(f1).toMatch(/^run \d+$/);
    expect((await host.list("scripts", "counter", "other"))[0].name).not.toBe((await host.list("scripts", "counter", ""))[0].name);
  });

  test("a script's rows carry the plugin's actions; requires with an alternative that exists loads", async () => {
    expect(await host.list("scripts", "alt", "")).toHaveLength(2);
  });
});

// ---- script commands ---------------------------------------------------------------------

const cmd = (name: string, header: string, body: string, exec = true) => w(`commands/${name}`, `#!/bin/bash\n${header}\n${body}\n`, exec);
cmd("deploy.sh", `# @pal.title Deploy site\n# @pal.icon 🚀\n# @pal.mode hud\n# @pal.confirm true\n# @pal.keyword deploy ship\n# @pal.description Push the site to production\n# @pal.args target Environment (staging or prod)\n# @pal.args note Release note (optional)`, `if [ -n "$2" ]; then echo "Deployed to $1 ($2)"; else echo "Deployed to $1"; fi; echo "second line"`);
cmd("ports.sh", `# @pal.title Listening ports\n# @pal.mode list\n# @pal.icon amber`, `if [ -n "$PAL_PICK" ]; then echo "picked $PAL_PICK"; exit 0; fi\necho '{"id":"5173","name":":5173","subtitle":"node","copy":"5173"}'\necho '{"name":"docs","url":"https://example.com"}'`);
cmd("lines.sh", `# @pal.title Plain lines\n# @pal.mode list`, `if [ -n "$PAL_PICK" ]; then echo "picked $PAL_PICK"; exit 0; fi\necho "plain line"; echo "another"`);
cmd("uptime.sh", `# @pal.title Uptime\n# @pal.mode inline\n# @pal.refresh 1h`, `echo "up $RANDOM"; echo "ignored"`);
cmd("ray.sh", `# @raycast.schemaVersion 1\n# @raycast.title Say hi\n# @raycast.mode compact\n# @raycast.packageName Raycast\n# @raycast.icon 👋\n# @raycast.argument1 { "type": "text", "placeholder": "Name" }\n# @raycast.needsConfirmation false\n# @raycast.currentDirectoryPath /`, `echo "hi $1 from $(pwd)"`);
cmd("quiet.sh", `# @pal.title Quiet one\n# @pal.mode silent\n# @pal.confirm yes`, `exit 0`);
cmd("broken.sh", `# @pal.title Broken\n# @pal.mode hud`, `echo "boom" >&2; exit 3`);
cmd("show.sh", `# @raycast.title Whole output\n# @raycast.mode fullOutput`, `printf 'line 1\\nline 2\\n'`);
cmd("notexec.sh", `# @pal.title Not executable`, `echo no`, false);
cmd("notitle.sh", `# @pal.mode hud`, `echo no`);
cmd("x.template.sh", `# @pal.title Template`, `echo no`);

const cmds = () => host.list("scripts", "commands");
const cpick = (id: string, action?: string, ctx?: Parameters<Host["pick"]>[4]) => host.pick("scripts", "commands", id, action, ctx);
const nextEffect = async () => {
  const from = host.coreCalls.filter((c) => c.method === "effects.run").length;
  await host.until(() => host.coreCalls.filter((c) => c.method === "effects.run").length > from, 3000, "effects.run");
  return (host.coreCalls.filter((c) => c.method === "effects.run").pop()!.params as { effect: Record<string, unknown> }).effect;
};

describe("script commands: the header", () => {
  test("tags: # // -- ; and * comments, pal and raycast prefixes, repeated tags as a list, only the first lines read", () => {
    expect(tags("#!/bin/sh\n# @pal.title A\n// @raycast.mode silent\n-- @pal.keyword x\n; @pal.keyword y\n * @pal.icon 🍀\n#@pal.title B\n")).toEqual({ title: ["A", "B"], mode: ["silent"], keyword: ["x", "y"], icon: ["🍀"] });
    expect(tags(`${"\n".repeat(70)}# @pal.title late`)).toEqual({});
    expect(seconds("10s")).toBe(10);
    expect(seconds("2m")).toBe(120);
    expect(seconds("1h")).toBe(3600);
    expect(seconds("30")).toBe(30);
    expect(seconds("soon")).toBeUndefined();
  });

  test("parse: every field from the tags, raycast aliases mapped (compact is hud, fullOutput is show, argument1 JSON, packageName, currentDirectoryPath), defaults for the rest", () => {
    const d = parse(join(cmdDir, "deploy.sh"))!;
    expect(d).toMatchObject({ id: "deploy.sh", title: "Deploy site", icon: "🚀", mode: "hud", confirm: true, keywords: ["deploy", "ship"], subtitle: "Push the site to production", cwd: cmdDir, refresh: 60 });
    expect(d.args).toEqual([{ name: "target", placeholder: "Environment (staging or prod)", optional: false }, { name: "note", placeholder: "Release note (optional)", optional: true }]);
    const r = parse(join(cmdDir, "ray.sh"))!;
    expect(r).toMatchObject({ title: "Say hi", mode: "hud", section: "Raycast", icon: "👋", confirm: false, cwd: "/", args: [{ name: "argument1", placeholder: "Name", optional: false }] });
    expect(parse(join(cmdDir, "ports.sh"))!.icon).toEqual({ tile: { glyph: "\u{f0bc3}", bg: "amber" } });
    expect(parse(join(cmdDir, "uptime.sh"))).toMatchObject({ mode: "inline", refresh: 3600 });
    expect(parse(join(cmdDir, "show.sh"))!.mode).toBe("show");
    expect(parse(join(cmdDir, "notitle.sh"))).toBeUndefined();
    expect(parse(join(dir, "nope.sh"))).toBeUndefined();
  });

  test("scan: executables with a title, sorted by file name; a file without the bit, without a title, a template or a dotfile is not one; a missing folder is empty", () => {
    expect(scan(cmdDir).map((c) => c.id)).toEqual(["broken.sh", "deploy.sh", "lines.sh", "ports.sh", "quiet.sh", "ray.sh", "show.sh", "uptime.sh"]);
    expect(scan(join(dir, "missing"))).toEqual([]);
  });
});

describe("script commands: the palette", () => {
  test("meta: a live palette wearing the extension's tile; rows with the title, the mode on the right unless hud, the section, the keywords, the file in the detail; an inline command's first line as its subtitle", async () => {
    const meta = host.loaded().find((l) => l.extension === "scripts")!.palettes.find((p) => p.name === "commands")!;
    expect(meta).toMatchObject({ title: "Script Commands", live: true, input: false, icon: tile("slate", xdg("utilities-terminal")!) });
    const items = await cmds();
    expect(items.map((i) => i.id)).toEqual(["broken.sh", "deploy.sh", "lines.sh", "ports.sh", "quiet.sh", "ray.sh", "show.sh", "uptime.sh"]);
    const by = Object.fromEntries(items.map((i) => [i.id, i]));
    expect(by["deploy.sh"]).toMatchObject({ name: "Deploy site", subtitle: "Push the site to production", icon: "🚀", keywords: ["deploy", "ship"] });
    expect(by["deploy.sh"].accessories).toBeUndefined();
    // The header's arguments are the row's, typed in the bar before Run (and Copy output, which runs it too); no confirm on top of them.
    expect(by["deploy.sh"].actions).toEqual([{ id: "run", title: "Run" }, { id: "open", title: "Open script", shortcut: "cmd+o" }, { id: "copy_output", title: "Copy output", shortcut: "cmd+c", args: true }, { id: "copy_path", title: "Copy path", shortcut: "cmd+shift+c" }]);
    expect(by["deploy.sh"].args).toEqual([{ id: "target", placeholder: "Environment (staging or prod)", required: true }, { id: "note", placeholder: "Release note (optional)", required: false }]);
    expect(by["ray.sh"].args).toEqual([{ id: "argument1", placeholder: "Name", required: true }]);
    expect(by["quiet.sh"].args).toBeUndefined();
    expect(by["deploy.sh"].detail!.metadata).toEqual([{ label: "File", value: join(cmdDir, "deploy.sh") }, { label: "Mode", value: "hud" }, { label: "Arguments", value: "target, note" }, { label: "Confirm", value: "yes" }, { label: "Runs in", value: cmdDir }]);
    expect(by["ports.sh"]).toMatchObject({ name: "Listening ports", accessories: [{ text: "list" }], actions: [{ id: "run", title: "Open" }, expect.anything(), expect.anything(), expect.anything()] });
    expect(by["ports.sh"].icon).toEqual({ tile: { glyph: "\u{f0bc3}", bg: "amber" } });
    expect(by["ray.sh"]).toMatchObject({ name: "Say hi", section: "Raycast", icon: "👋" });
    expect(by["quiet.sh"]).toMatchObject({ icon: "\u{f0bc3}", accessories: [{ text: "silent" }], actions: [{ id: "run", title: "Run", confirm: "Quiet one?" }, expect.anything(), expect.anything(), expect.anything()] });
    expect(by["uptime.sh"].subtitle).toMatch(/^up \d+$/);
    // The inline line is kept for the header's refresh (an hour): the second listing shows the same one.
    expect((await cmds()).find((i) => i.id === "uptime.sh")!.subtitle).toBe(by["uptime.sh"].subtitle);
    expect(items.every((i) => i.icon)).toBe(true);
  });

  test("hud: Enter hides and the HUD then carries the first output line; a failure carries stderr's first line; silent says nothing unless it failed", async () => {
    await cmds();
    expect(await cpick("ray.sh", "run", { values: { argument1: "Ada" } })).toEqual({ hide: true });
    expect(await nextEffect()).toEqual({ hud: "Say hi: hi Ada from /" });
    expect(await cpick("broken.sh")).toEqual({ hide: true });
    expect(await nextEffect()).toEqual({ hud: "Broken: boom" });
    const before = host.coreCalls.filter((c) => c.method === "effects.run").length;
    expect(await cpick("quiet.sh")).toEqual({ hide: true });
    await Bun.sleep(300);
    expect(host.coreCalls.filter((c) => c.method === "effects.run")).toHaveLength(before);
  });

  test("arguments: the bar's values run the script with them in order ($1, $2); a pick without them is the same fields as a form; a missing required one is refused", async () => {
    await cmds();
    const f = (await cpick("deploy.sh")).form as Form;
    expect(f).toMatchObject({ id: "deploy.sh", title: "Deploy site", submit: { id: "run", title: "Run" } });
    expect(f.fields.map((x) => [x.id, x.label, x.kind, x.placeholder, !!x.required])).toEqual([["target", "Environment (staging or prod)", "text", "Environment (staging or prod)", true], ["note", "Release note (optional)", "text", "Release note (optional)", false]]);
    expect(((await cpick("deploy.sh", "run", { values: { target: " ", note: "x" } })).form as Form).errors).toEqual({ target: "Required" });
    expect(await cpick("deploy.sh", "run", { values: { target: "prod", note: "v2" } })).toEqual({ hide: true });
    expect(await nextEffect()).toEqual({ hud: "Deploy site: Deployed to prod (v2)" });
    // The form's old submit id still lands (a saved hotkey may carry it).
    expect(await cpick("deploy.sh", "run_args", { values: { target: "staging" } })).toEqual({ hide: true });
    expect(await nextEffect()).toEqual({ hud: "Deploy site: Deployed to staging" });
  });

  test("list: Enter pushes a level whose rows are what the script printed (JSON lines, a url row, a plain line); a row copies, opens, or runs the script again with PAL_PICK", async () => {
    await cmds();
    expect(await cpick("ports.sh")).toEqual({ push: { extension: "scripts", palette: "commands", args: { list: "ports.sh", values: undefined } } });
    const rows = await host.list("scripts", "commands", "", { args: { list: "ports.sh" } });
    expect(rows.map((r) => [r.id, r.name, r.actions![0].title])).toEqual([["5173", ":5173", "Copy"], ["docs", "docs", "Open"]]);
    expect((await host.list("scripts", "commands", "", { args: { list: "lines.sh" } })).map((r) => [r.id, r.name, r.actions![0].title])).toEqual([["plain line", "plain line", "Pick"], ["another", "another", "Pick"]]);
    expect(rows[0]).toMatchObject({ subtitle: "node", icon: { tile: { glyph: "\u{f0bc3}", bg: "amber" } } });
    expect(await cpick("5173", "pick", { args: { list: "ports.sh" } })).toEqual({ copy: "5173" });
    expect(await cpick("docs", undefined, { args: { list: "ports.sh" } })).toEqual({ open: "https://example.com" });
    expect(await cpick("another", undefined, { args: { list: "lines.sh" } })).toEqual({ hud: "Plain lines: picked another" });
    expect(await cpick("zzz", undefined, { args: { list: "ports.sh" } })).toMatchObject({ keep: true, toast: { title: "Row not found" } });
  });

  test("show: the whole output comes back as a level with the text in the detail pane and a copy action", async () => {
    await cmds();
    expect(await cpick("show.sh")).toEqual({ hide: true });
    const e = await nextEffect();
    expect(e).toEqual({ push: { extension: "scripts", palette: "commands", args: { show: "show.sh", out: "line 1\nline 2\n" } } });
    const [row] = await host.list("scripts", "commands", "", { args: (e.push as { args: unknown }).args });
    expect(row).toMatchObject({ id: "out", name: "Whole output", detail: { markdown: "```\nline 1\nline 2\n\n```" } });
    expect(await cpick("out", "copy_shown", { args: (e.push as { args: unknown }).args })).toEqual({ copy: "line 1\nline 2\n" });
  });

  test("Open script opens the file, Copy path copies it, Copy output runs it and copies what it printed (with the bar's values; a form first without them)", async () => {
    await cmds();
    expect(await cpick("quiet.sh", "open")).toEqual({ open: join(cmdDir, "quiet.sh") });
    expect(await cpick("quiet.sh", "copy_path")).toEqual({ copy: join(cmdDir, "quiet.sh") });
    expect(await cpick("show.sh", "copy_output")).toEqual({ copy: "line 1\nline 2" });
    expect(await cpick("broken.sh", "copy_output")).toMatchObject({ keep: true, toast: { title: "Broken: boom", style: "failure" } });
    expect((await cpick("ray.sh", "copy_output")).form).toMatchObject({ id: "ray.sh", submit: { id: "copy_output", title: "Copy output" }, fields: [{ id: "argument1" }] });
    expect(await cpick("ray.sh", "copy_output", { values: { argument1: "Bob" } })).toEqual({ copy: "hi Bob from /" });
    expect(await cpick("ray.sh", "copy_args", { values: { argument1: "Cy" } })).toEqual({ copy: "hi Cy from /" });
  });

  test("the folder is watched: a file added after the first listing is a row on the next; one removed is gone, and picking it is a toast", async () => {
    await cmds();
    cmd("added.sh", `# @pal.title Added later`, `echo hi`);
    await host.until(() => false, 300, "").catch(() => {});
    expect((await cmds()).map((i) => i.id)).toContain("added.sh");
    rmSync(join(cmdDir, "added.sh"));
    await host.until(() => false, 300, "").catch(() => {});
    expect((await cmds()).map((i) => i.id)).not.toContain("added.sh");
    expect(await cpick("added.sh")).toMatchObject({ keep: true, toast: { title: "Command not found" } });
  });

  test("an empty or missing folder is one hint row naming it; the setting moves the folder live", async () => {
    host.changeSettings("scripts", { settings: { config: join(dir, "config.toml"), skip: ["calc"], commands: join(dir, "nowhere") } });
    const items = await cmds();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: "hint:none", name: `No script commands in ${join(dir, "nowhere")}`, actions: [] });
    expect(await cpick("hint:none")).toEqual({});
    host.changeSettings("scripts", { settings: { config: join(dir, "config.toml"), skip: ["calc"], commands: cmdDir } });
    expect((await cmds()).length).toBeGreaterThan(1);
  });
});
