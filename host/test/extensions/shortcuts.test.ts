// shortcuts against a stand-in `shortcuts` tool (`PAL_SHORTCUTS_BIN`): a
// script that lists three folders' worth of names with identifiers, and
// on `run` records its arguments and writes an output file. On Linux the
// palette is one Unavailable row and the rest is skipped.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Form } from "../../../sdk/src/protocol.ts";
import { Host, fixtures } from "../harness.ts";

const MAC = process.platform === "darwin";
const dir = mkdtempSync(join(tmpdir(), "pal-shortcuts-"));
const bin = join(dir, "shortcuts");
const log = join(dir, "runs.log");
writeFileSync(bin, `#!/bin/bash
# list --folders | list --show-identifiers --folder-name X | run <id> [-o out] [-i in]
if [ "$1" = list ]; then
  if [ "$2" = --folders ]; then printf 'Home\\nWork\\n'; exit 0; fi
  case "$4" in
    none) printf 'Open App (26FFEA3C-3ACD-430A-88E4-3ACC00F3F250)\\nAdjust Clipboard (749DC7C9-9153-4FA6-8B1A-DE5755EB40D4)\\n' ;;
    Home) printf 'Lights on (A60321F9-5380-4AC8-BFF0-D736CE80DD10)\\nOpen App (11111111-2222-3333-4444-555555555555)\\n' ;;
    Work) printf 'Standup notes (F9E73253-A6B9-4846-81B6-1AF021CD737E)\\nnot a shortcut line\\n' ;;
  esac
  exit 0
fi
if [ "$1" = run ]; then
  id="$2"; shift 2; out=""; in=""
  while [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2 ;; -i) in="$2"; shift 2 ;; *) shift ;; esac; done
  input=""; [ -n "$in" ] && input=$(cat "$in")
  printf '%s\\t%s\\n' "$id" "$input" >> "${log}"
  case "$id" in
    A60321F9-*) printf 'Lights are on\\nsecond line\\n' > "$out" ;;
    F9E73253-*) echo "Error: The operation couldn’t be completed. Standup failed" >&2; exit 1 ;;
    749DC7C9-*) printf 'got: %s' "$input" > "$out" ;;
  esac
  exit 0
fi
exit 2
`);
chmodSync(bin, 0o755);

let host: Host;
beforeAll(async () => {
  process.env.PAL_SHORTCUTS_BIN = bin;
  host = await Host.bundled();
});
afterAll(() => { host.kill(); rmSync(dir, { recursive: true, force: true }); delete process.env.PAL_SHORTCUTS_BIN; });

const list = () => host.list("shortcuts", "shortcuts");
const pick = (id: string, action?: string, ctx?: Parameters<Host["pick"]>[4]) => host.pick("shortcuts", "shortcuts", id, action, ctx);
const runs = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : []);
/** The next `effects.run` the extension makes (the HUD after a run). */
const nextHud = async () => {
  const from = host.coreCalls.filter((c) => c.method === "effects.run").length;
  await host.until(() => host.coreCalls.filter((c) => c.method === "effects.run").length > from, 3000, "effects.run");
  return (host.coreCalls.filter((c) => c.method === "effects.run").pop()!.params as { effect: { hud: string } }).effect.hud;
};

describe("shortcuts", () => {
  test("meta: an indexed primary palette with the violet tile, a five-minute ttl from the manifest; the manifest and the code agree", () => {
    const l = host.loaded().find((l) => l.extension === "shortcuts")!;
    expect(l.warnings).toEqual([]);
    expect(l.palettes[0]).toMatchObject({ name: "shortcuts", title: "Shortcuts", live: false, input: false, tier: "primary", ttl: 300, placeholder: "Search shortcuts by name or folder" });
    expect(l.palettes[0].icon as unknown).toEqual({ tile: { svg: expect.stringMatching(/^M8 1\.5/), bg: "violet" } });
  });

  test.skipIf(!MAC)("rows: the ones in no folder first under \"No folder\", then folder by folder with the folder as section and keyword; a repeated name gets its identifier; a line without an identifier is dropped", async () => {
    const items = await list();
    expect(items.map((i) => [i.id, i.section])).toEqual([
      ["Open App", "No folder"], ["Adjust Clipboard", "No folder"],
      ["Lights on", "Home"], ["Open App (11111111-2222-3333-4444-555555555555)", "Home"],
      ["Standup notes", "Work"],
    ]);
    expect(items[2]).toMatchObject({ name: "Lights on", icon: "\u{f040b}", keywords: ["Home"], detail: { metadata: [{ label: "Name", value: "Lights on" }, { label: "Folder", value: "Home" }, { label: "Identifier", value: "A60321F9-5380-4AC8-BFF0-D736CE80DD10" }] } });
    expect(items[0].keywords).toBeUndefined();
    expect(items[0].actions!.map((a) => [a.id, a.shortcut])).toEqual([["run", undefined], ["clipboard", undefined], ["text", "cmd+t"], ["open", "cmd+o"], ["copy", "cmd+c"]]);
    // Run with input takes the row's typed argument; Enter still runs the shortcut bare.
    expect(items[0].actions![2]).toEqual({ id: "text", title: "Run with input", shortcut: "cmd+t", args: true });
    expect(items[0].args).toEqual([{ id: "input", placeholder: "Input", required: true }]);
    expect(host.coreCalls.filter((c) => c.method === "clipboard.list")).toHaveLength(0);
  });

  test.skipIf(!MAC)("Enter runs the shortcut by identifier and hides; the HUD then carries the output's first line, Done when there is none, the tool's message on a failure", async () => {
    await list();
    expect(await pick("Lights on")).toEqual({ hide: true });
    expect(await nextHud()).toBe("Lights on: Lights are on");
    expect(runs().pop()).toBe("A60321F9-5380-4AC8-BFF0-D736CE80DD10");
    expect(await pick("Open App", "run")).toEqual({ hide: true });
    expect(await nextHud()).toBe("Open App: Done");
    expect(await pick("Standup notes")).toEqual({ hide: true });
    expect(await nextHud()).toBe("Standup notes: The operation couldn’t be completed. Standup failed");
  });

  test.skipIf(!MAC)("cmd+Enter runs it with the newest clipboard text as the input file; an empty clipboard is a toast", async () => {
    await list();
    expect(await pick("Adjust Clipboard", "clipboard")).toEqual({ hide: true });
    expect(await nextHud()).toBe(`Adjust Clipboard: got: ${fixtures.clipboard[0].text}`);
    expect(runs().pop()).toBe(`749DC7C9-9153-4FA6-8B1A-DE5755EB40D4\t${fixtures.clipboard[0].text}`);
    const h = await Host.bundled({ core: { "clipboard.list": () => [] } });
    await h.list("shortcuts", "shortcuts");
    expect(await h.pick("shortcuts", "shortcuts", "Adjust Clipboard", "clipboard")).toEqual({ keep: true, toast: { title: "Nothing on the clipboard", message: "Copy some text first, or use Run with text", style: "failure" } });
    h.kill();
  });

  test.skipIf(!MAC)("Run with input: the text typed in the bar is the input file; without it a form whose submit runs the same way; an empty one is refused", async () => {
    await list();
    expect(await pick("Adjust Clipboard", "text", { values: { input: "from the bar" } })).toEqual({ hide: true });
    expect(await nextHud()).toBe("Adjust Clipboard: got: from the bar");
    expect(((await pick("Adjust Clipboard", "text", { values: { input: " " } })).form as Form).errors).toEqual({ input: "Required" });
    const form = (await pick("Adjust Clipboard", "text")).form as Form;
    expect(form).toMatchObject({ id: "Adjust Clipboard", title: "Run Adjust Clipboard", submit: { id: "run_text", title: "Run" } });
    expect(form.fields.map((f) => [f.id, f.kind, !!f.required])).toEqual([["input", "textarea", true]]);
    expect(((await pick("Adjust Clipboard", "run_text", { values: { input: "  " } })).form as Form).errors).toEqual({ input: "Required" });
    expect(await pick("Adjust Clipboard", "run_text", { values: { input: "typed in" } })).toEqual({ hide: true });
    expect(await nextHud()).toBe("Adjust Clipboard: got: typed in");
  });

  test.skipIf(!MAC)("Open in Shortcuts is the app's url scheme with the name; Copy name copies it; an id that is not listed is a failure toast", async () => {
    await list();
    expect(await pick("Lights on", "open")).toEqual({ open: "shortcuts://open-shortcut?name=Lights%20on" });
    expect(await pick("Lights on", "copy")).toEqual({ copy: "Lights on" });
    expect(await pick("gone", "run")).toEqual({ keep: true, toast: { title: "Shortcut not found", message: "List again (cmd+r) and retry", style: "failure" } });
  });

  test("with no tool (or off macOS) the palette is one inert row saying so", async () => {
    process.env.PAL_SHORTCUTS_BIN = join(dir, "no-such-tool");
    const h = await Host.bundled();
    const items = await h.list("shortcuts", "shortcuts");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: "hint:unavailable", name: "Apple Shortcuts is not available", actions: [] });
    expect(items[0].subtitle).toBe(MAC ? "The shortcuts command line tool ships with macOS 12 and later" : "Shortcuts is a macOS app; there is nothing to run here");
    expect(await h.pick("shortcuts", "shortcuts", "hint:unavailable")).toEqual({});
    h.kill();
    process.env.PAL_SHORTCUTS_BIN = bin;
  });

  test.skipIf(!MAC)("a tool that fails to list is one hint row naming the error and cmd+r", async () => {
    const bad = join(dir, "bad-shortcuts");
    writeFileSync(bad, "#!/bin/bash\necho 'Error: no access' >&2\nexit 1\n");
    chmodSync(bad, 0o755);
    process.env.PAL_SHORTCUTS_BIN = bad;
    const h = await Host.bundled();
    const items = await h.list("shortcuts", "shortcuts");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: "hint:error", name: "Could not list shortcuts", subtitle: "Error: no access; cmd+r tries again", actions: [] });
    h.kill();
    process.env.PAL_SHORTCUTS_BIN = bin;
  });
});
