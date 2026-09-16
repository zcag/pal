// scripts: a scratch v1 config with a data palette and script palettes,
// pointed at through the `config` setting.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { xdg } from "../../src/icons.ts";
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
`);
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
beforeAll(async () => { host = await Host.bundled({ settings: { scripts: { settings: { config: join(dir, "config.toml"), skip: ["calc"] } } } }); });
afterAll(() => { host.kill(); rmSync(dir, { recursive: true, force: true }); });

const names = () => host.loaded().find((l) => l.extension === "scripts")!.palettes.map((p) => p.name).sort();

describe("discovery", () => {
  test("every usable [palette.*] is a palette; requires/os gate, skip drops, a builtin base and an empty one are inert", () => {
    expect(names()).toEqual(["alt", "counter", "empty", "fresh", "grid", "inp", "links", "oldbuiltin"]);
    expect(host.stderr).toContain("gated: gated (needs definitely-not-a-binary-on-this-box)");
    expect(host.stderr).toContain("calc: skipped (native)");
    expect(host.stderr).toMatch(/otheros: gated \((linux|macos) only\)/);
  });

  test("meta from the v1 fields: input, prompt, live, grid, columns, detail pane, filters, lazy detail only for scripts", () => {
    const by = Object.fromEntries(host.loaded().find((l) => l.extension === "scripts")!.palettes.map((p) => [p.name, p]));
    expect(by.inp).toEqual({ name: "inp", title: "inp", live: true, input: true, placeholder: "Type here", detail: "lazy" });
    expect(by.grid).toEqual({ name: "grid", title: "grid", live: false, input: false, view: "grid", columns: 5, showDetail: true, filters: [{ id: "all", title: "All" }, { id: "few", title: "few" }] });
    expect(by.links).toEqual({ name: "links", title: "links", live: false, input: false, icon: "★" });
    expect(by.links.detail).toBeUndefined();
  });

  test("an inert palette lists one hint row", async () => {
    expect(await host.list("scripts", "oldbuiltin")).toEqual([{ id: "hint", name: "oldbuiltin is not available", subtitle: "v1 builtin (builtin/palettes/pals) has no equivalent yet", icon: "!", actions: [] }]);
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

  test("ttl caches a list for the same query; without ttl every list runs the script", async () => {
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
