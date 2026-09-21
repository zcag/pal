// system against canned core/system.* replies with the core's real ids, a
// temp folder standing in for the Trash (`PAL_TRASH_DIR`), a canned Finder
// selection (`core/selection.files`) and front app (`core/states.get`), and
// a stand-in for qlmanage (`PAL_FILES_QUICKLOOK`) that logs its paths.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { tile } from "../../../sdk/src/icon.ts";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SystemCommand } from "../../../sdk/src/index.ts";
import { Host } from "../harness.ts";

const MAC = process.platform === "darwin";
const COMMANDS: SystemCommand[] = [
  { id: "sleep", title: "Sleep", subtitle: "Put the machine to sleep", icon: "⏾", keywords: ["suspend"], destructive: false, available: true },
  { id: "shutdown", title: "Shut Down", subtitle: "Power the machine off", icon: "⏻", keywords: ["halt", "power"], destructive: true, available: true },
  { id: "empty-trash", title: "Empty Trash", subtitle: "Delete everything in the trash", icon: "⌫", keywords: ["bin"], destructive: true, available: true },
  { id: "dark-mode", title: "Toggle Dark Mode", subtitle: "Switch between light and dark appearance", icon: "◐", keywords: ["theme"], destructive: false, available: true },
  { id: "dnd", title: "Toggle Do Not Disturb", subtitle: "Focus", icon: "⊘", keywords: ["focus"], destructive: false, available: false },
  { id: "quit-all", title: "Quit All Apps", subtitle: "Quit every open app but Finder and pal", icon: "⌧", keywords: ["close all"], destructive: true, available: true },
  { id: "unhide-all", title: "Unhide All Apps", subtitle: "Show every hidden app again", icon: "◫", keywords: ["show all"], destructive: false, available: true },
  { id: "dismiss-notifications", title: "Dismiss Notifications", subtitle: "Clear every notification on screen", icon: "⌦", keywords: ["clear all"], destructive: false, available: MAC },
];

const trash = mkdtempSync(join(tmpdir(), "pal-trash-"));
writeFileSync(join(trash, "a.txt"), "");
writeFileSync(join(trash, "b.txt"), "");
writeFileSync(join(trash, ".DS_Store"), "");

let host: Host;
const ran: string[] = [];
/** What the canned core answers: the Finder selection and the `front_app` state. */
let finder: string[] = [];
let front = "com.google.Chrome";
const tools = mkdtempSync(join(tmpdir(), "pal-system-tools-"));
const qlLog = join(tools, "ql.log");
/** The system rows in the core's order; the Quick Look row closes the list on macOS. */
const IDS = ["sleep", "shutdown", "empty-trash", "dark-mode", "quit-all", "unhide-all", ...(MAC ? ["dismiss-notifications", "quick-look-selection"] : [])];
beforeAll(async () => {
  process.env.PAL_TRASH_DIR = trash;
  const ql = join(tools, "ql");
  writeFileSync(ql, `#!/bin/sh\nprintf "%s\\n" "$@" >> "${qlLog}"\n`, { mode: 0o755 });
  process.env.PAL_FILES_QUICKLOOK = ql;
  host = await Host.bundled({ core: {
    "system.commands": () => COMMANDS,
    "system.run": (p) => { if (p.id === "sleep") throw new Error("pmset: not permitted"); ran.push(p.id); return null; },
    "selection.files": () => finder,
    "states.get": (p: { name?: string }) => (p.name === "front_app" ? front : null),
  } });
});
afterAll(() => { host.kill(); rmSync(trash, { recursive: true, force: true }); rmSync(tools, { recursive: true, force: true }); });

const list = (q?: string) => host.list("system", "system", q);

describe("system", () => {
  test("meta: a live palette, indexed (not input), so its rows are root results", () => {
    expect(host.loaded().find((l) => l.extension === "system")!.palettes[0]).toMatchObject({ name: "system", title: "System", live: true, input: false, icon: tile("slate", "\u{f0425}") });
  });

  test("only available commands, mapped one to one, one run action each", async () => {
    const items = await list();
    expect(items.map((i) => i.id)).toEqual(IDS);
    // The app commands wear their own glyphs too.
    expect(items.slice(4, 7).map((i) => i.icon)).toEqual(["\u{f0c5e}", "\u{f06d0}", ...(MAC ? ["\u{f039f}"] : [])]);
    // The row draws the extension's glyph for the id, not the core's text symbol.
    expect(items[0]).toEqual({ id: "sleep", name: "Sleep", subtitle: "Put the machine to sleep", icon: "\u{f0904}", keywords: ["suspend"], accessories: [], actions: [{ id: "run", title: "Sleep" }] });
  });

  test("Empty Trash counts what is in the Trash (.DS_Store aside); Toggle Dark Mode tags the current appearance", async () => {
    const by = Object.fromEntries((await list()).map((i) => [i.id, i]));
    expect(by["empty-trash"].accessories).toEqual([{ text: "2 items" }]);
    rmSync(join(trash, "b.txt"));
    expect((await list()).find((i) => i.id === "empty-trash")!.accessories).toEqual([{ text: "1 item" }]);
    rmSync(join(trash, "a.txt"));
    expect((await list()).find((i) => i.id === "empty-trash")!.accessories).toEqual([{ text: "empty" }]);
    if (MAC) expect(by["dark-mode"].accessories).toEqual([{ tag: expect.stringMatching(/^(dark|light)$/), color: expect.stringMatching(/^(violet|amber)$/) }]);
    else expect(by["dark-mode"].accessories!.length).toBeLessThanOrEqual(1);
  });

  test("an unreadable Trash is a row without a count", async () => {
    process.env.PAL_TRASH_DIR = join(trash, "nope");
    const h = await Host.bundled({ core: { "system.commands": () => COMMANDS, "selection.files": () => [], "states.get": () => null } });
    expect((await h.list("system", "system")).find((i) => i.id === "empty-trash")!.accessories).toEqual([]);
    h.kill();
    process.env.PAL_TRASH_DIR = trash;
  });

  test("destructive rows carry a confirm while the setting is on, not when it is off", async () => {
    const on = await list();
    expect(on[1].actions).toEqual([{ id: "run", title: "Shut Down", style: "destructive", confirm: "Shut Down now?" }]);
    expect(on[2].actions![0].confirm).toBe("Empty Trash now?");
    expect(on[4].actions![0]).toEqual({ id: "run", title: "Quit All Apps", style: "destructive", confirm: "Quit All Apps now?" });
    expect(on[5].actions![0].confirm).toBeUndefined();
    expect(on[0].actions![0].confirm).toBeUndefined();
    host.changeSettings("system", { settings: { confirm_destructive: false } });
    const off = await list();
    expect(off[1].actions).toEqual([{ id: "run", title: "Shut Down" }]);
    expect(off.every((i) => i.actions?.[0]?.confirm === undefined)).toBe(true);
    host.changeSettings("system", {});
    expect((await list())[1].actions![0].confirm).toBe("Shut Down now?");
  });

  test("the list ignores a query: matching is the index's", async () => {
    expect((await list("shut")).map((i) => i.id)).toEqual(IDS);
  });

  test.skipIf(!MAC)("Quick Look Finder Selection: inert with the reason while nothing is selected (Finder in front or not), the names and Enter once something is; the pick and the run link open qlmanage on the paths", async () => {
    const row = async () => (await list()).find((i) => i.id === "quick-look-selection")!;
    expect(await row()).toMatchObject({ name: "Quick Look Finder Selection", subtitle: "Finder is not in front", icon: "\u{f0dcb}", accessories: [], actions: [] });
    front = "com.apple.finder";
    expect((await row()).subtitle).toBe("Nothing is selected in Finder");
    await expect(host.request("link", { extension: "system", route: "run", params: { id: "quick-look-selection" } })).rejects.toThrow("nothing is selected in Finder");
    expect(await host.pick("system", "system", "quick-look-selection", "run")).toEqual({ keep: true, toast: { title: "Command failed", message: "nothing is selected in Finder", style: "failure" } });
    finder = ["/Users/x/Desktop/shot.png", "/Users/x/Documents/report.pdf"];
    expect(await row()).toMatchObject({ subtitle: "shot.png, report.pdf", accessories: [{ text: "2 items" }], actions: [{ id: "run", title: "Quick Look" }] });
    expect(await host.pick("system", "system", "quick-look-selection", "run")).toEqual({ hide: true });
    expect(await host.request<unknown>("link", { extension: "system", route: "run", params: { id: "quick-look-selection" } })).toEqual({ hide: true });
    // The stand-in is detached; it lands within a moment.
    const log = () => Bun.file(qlLog).text().then((t) => t.trim().split("\n")).catch(() => [] as string[]);
    for (let i = 0; i < 40 && (await log()).length < 4; i++) await Bun.sleep(50);
    expect(await log()).toEqual([...finder, ...finder]);
    expect(ran).not.toContain("quick-look-selection");
    finder = [];
    front = "com.google.Chrome";
  });

  test("pick runs through the core and hides; a refusal is a failure toast that keeps the palette", async () => {
    expect(await host.pick("system", "system", "shutdown", "run")).toEqual({});
    expect(ran).toEqual(["shutdown"]);
    expect(await host.pick("system", "system", "sleep")).toEqual({ keep: true, toast: { title: "Command failed", message: "pmset: not permitted", style: "failure" } });
  });
});
