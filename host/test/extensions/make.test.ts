// make against a temp projects tree: the `projects` setting points at it, so
// the real ~/proj is never scanned. `PAL_TERMINAL_LOG` catches Run's argv
// instead of opening a terminal; the background mode runs the real `make`
// on a tiny Makefile (skipped where make is missing).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Host } from "../harness.ts";

const HAS_MAKE = Bun.which("make") !== null;
const root = mkdtempSync(join(tmpdir(), "pal-make-"));
const proj = (name: string, file: string, text: string) => { const d = join(root, name); mkdirSync(d, { recursive: true }); writeFileSync(join(d, file), text); return d; };

const pal = proj("pal", "Makefile", `
.PHONY: test lint release
VERSION := 0.1
BIN ?= pal

## Run every test suite
test: ## Rust, app and host
\tcargo test
\tbun test

lint:
\tcargo clippy

## Build a release; VERSION=x.y.z
release: lint test
\tmake -C app release

%.o: %.c
\t$(CC) -c $<

$(BIN): main.o
\t$(CC) -o $@ $<

a b: lint
\techo both

.hidden:
\techo no
`);
const deep = proj(join("srv", "theater"), "GNUmakefile", "up: ## Start the stack\n\tdocker compose up -d\ndown:\n\tdocker compose down\n");
proj(join("srv", "theater", "too-deep"), "Makefile", "never:\n\ttrue\n");
proj("node_modules/dep", "Makefile", "skipped:\n\ttrue\n");
const bare = proj("bare", "makefile", "# Everything\n.PHONY: all\nall:\n\techo all\n\nfail:\n\techo boom >&2; exit 3\n");

const PATH = process.env.PATH;
const TERMINAL = process.env.TERMINAL;
let host: Host;
beforeAll(async () => {
  // Linux: the chooser takes $TERMINAL as given (nothing is spawned under PAL_TERMINAL_LOG), so a box without one (the CI runner) still answers an argv.
  if (process.platform !== "darwin") process.env.TERMINAL ||= "kitty";
  process.env.PAL_TERMINAL_LOG = join(root, "terminal");
  host = await Host.bundled({ settings: { make: { settings: { projects: [root, root] } } } });
});
afterAll(() => { host?.kill(); process.env.PATH = PATH; if (TERMINAL === undefined) delete process.env.TERMINAL; else process.env.TERMINAL = TERMINAL; delete process.env.PAL_TERMINAL_LOG; rmSync(root, { recursive: true, force: true }); });

const list = () => host.list("make", "make");
const pick = (id: string, action?: string, ctx?: { values?: Record<string, string> }) => host.pick("make", "make", id, action, ctx);
const id = (target: string, dir: string) => `${target}@${dir}`;

describe("make", () => {
  test("meta: indexed, lazy detail", () => {
    expect(host.loaded().find((l) => l.extension === "make")!.palettes[0]).toMatchObject({ name: "make", title: "Makefile Targets", live: false, input: false, detail: "lazy" });
  });

  test("targets per project, two levels deep, dot and node_modules folders skipped, a duplicate root listed once", async () => {
    const items = await list();
    expect(items.map((i) => [i.name, i.section])).toEqual([
      ["all", "bare"], ["fail", "bare"],
      ["test", "pal"], ["lint", "pal"], ["release", "pal"], ["a", "pal"], ["b", "pal"],
      ["up", "theater"], ["down", "theater"],
    ]);
  });

  test("rows: project subtitle with the ## or above-the-rule description, project name and phony as keywords; the four actions on the palette", async () => {
    const by = Object.fromEntries((await list()).map((i) => [i.id, i]));
    expect(by[id("test", pal)]).toMatchObject({ subtitle: `${pal}: Rust, app and host`, keywords: ["pal", "phony"], section: "pal" });
    expect(by[id("release", pal)]).toMatchObject({ subtitle: `${pal}: Build a release; VERSION=x.y.z`, keywords: ["pal", "phony"] });
    expect(by[id("lint", pal)]).toMatchObject({ subtitle: pal, keywords: ["pal", "phony"] });
    expect(by[id("all", bare)].subtitle).toBe(`${bare}: Everything`);
    expect(by[id("fail", bare)].subtitle).toBe(bare);
    expect(by[id("a", pal)].keywords).toEqual(["pal"]);
    expect(by[id("up", deep)]).toMatchObject({ subtitle: `${deep}: Start the stack`, keywords: ["theater"] });
    expect(by[id("all", bare)].actions).toBeUndefined();
    expect(host.loaded().find((l) => l.extension === "make")!.palettes[0].actions!.map((a) => a.id)).toEqual(["run", "copy", "open", "makefile"]);
  });

  test("detail: the recipe fenced, project and Makefile name, description, phony", async () => {
    await list();
    const d = await host.detail("make", "make", id("test", pal));
    expect(d.markdown).toBe("````make\ncargo test\nbun test\n````");
    expect(d.metadata).toEqual([{ label: "Project", value: pal }, { label: "Makefile", value: "Makefile" }, { label: "Description", value: "Rust, app and host" }, { label: "Phony", value: "yes" }]);
    expect((await host.detail("make", "make", id("down", deep))).metadata).toEqual([{ label: "Project", value: deep }, { label: "Makefile", value: "GNUmakefile" }]);
  });

  test("run opens a terminal in the project folder running make <target>, kept open until Enter; the HUD names it", async () => {
    await list();
    expect(await pick(id("test", pal))).toEqual({ hud: "make test" });
    const argv = JSON.parse(readFileSync(join(root, "terminal"), "utf8").trim().split("\n").at(-1)!) as string[];
    // The log holds the command the terminal runs, whatever terminal the machine has: the script is its last word.
    const script = argv.find((a) => a.includes("make test"))!;
    expect(script).toContain(`cd ${pal} && exec sh -c `);
    expect(script).toContain("make test; s=$?;");
    expect(script).toContain("read -r _");
    expect(await pick(id("a", pal), "run")).toEqual({ hud: "make a" });
    // The row's one argument: words after the target, each quoted for the shell; blank is the plain run.
    expect((await list()).find((i) => i.id === id("test", pal))!.args).toEqual([{ id: "extra", placeholder: "Variables or flags: VERBOSE=1 -j4 (optional)" }]);
    expect(await pick(id("test", pal), "run", { values: { extra: "  " } })).toEqual({ hud: "make test" });
    expect(await pick(id("test", pal), "run", { values: { extra: " VERBOSE=1  -j4 " } })).toEqual({ hud: "make test VERBOSE=1 -j4" });
    const withExtra = (JSON.parse(readFileSync(join(root, "terminal"), "utf8").trim().split("\n").at(-1)!) as string[]).find((a) => a.includes("make test"))!;
    expect(withExtra).toContain("make test VERBOSE=1 -j4; s=$?;");
  });

  test("copy command, open project, show Makefile", async () => {
    await list();
    expect(await pick(id("up", deep), "copy")).toEqual({ copy: `make -C ${deep} up` });
    expect(await pick(id("up", deep), "open")).toEqual({ open: deep });
    const r = await pick(id("up", deep), "makefile");
    expect(r.show).toEqual({ title: `GNUmakefile in ${deep}`, markdown: "````make\nup: ## Start the stack\n\tdocker compose up -d\ndown:\n\tdocker compose down\n````" });
    expect(await pick("nope@/nowhere")).toMatchObject({ keep: true, toast: { title: "Target not listed", style: "failure" } });
  });

  test.skipIf(!HAS_MAKE)("background: runs make here and toasts the exit status; a failure opens the output too", async () => {
    host.changeSettings("make", { settings: { projects: [root], terminal: "background" } });
    await list();
    expect(await pick(id("all", bare))).toEqual({ keep: true, toast: { title: "make all: done", message: "all" } });
    // The bar's words ride along as make's own arguments.
    expect(await pick(id("all", bare), "run", { values: { extra: "-s" } })).toEqual({ keep: true, toast: { title: "make all -s: done", message: "all" } });
    const r = await pick(id("fail", bare));
    expect(r.toast).toMatchObject({ title: "make fail: exit 2", style: "failure" });
    expect(r.show!.markdown).toContain("boom");
    host.changeSettings("make", { settings: { projects: [root] } });
  });

  test("a projects folder that does not exist lists nothing rather than failing", async () => {
    host.changeSettings("make", { settings: { projects: [join(root, "nope")] } });
    expect(await list()).toEqual([]);
    host.changeSettings("make", { settings: { projects: [root] } });
  });
});
