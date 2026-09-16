// system against canned core/system.* replies.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Host } from "../harness.ts";

let host: Host;
const ran: string[] = [];
beforeAll(async () => {
  host = await Host.bundled({ core: { "system.run": (p) => { if (p.id === "sleep") throw new Error("pmset: not permitted"); ran.push(p.id); return null; } } });
});
afterAll(() => host.kill());

const list = (q?: string) => host.list("system", "system", q);

describe("system", () => {
  test("meta: a live palette, indexed (not input), so its rows are root results", () => {
    expect(host.loaded().find((l) => l.extension === "system")!.palettes[0]).toMatchObject({ name: "system", title: "System", live: true, input: false, icon: "⏻" });
  });

  test("only available commands, mapped one to one, one run action each", async () => {
    const items = await list();
    expect(items.map((i) => i.id)).toEqual(["sleep", "shutdown", "trash"]);
    expect(items[0]).toEqual({ id: "sleep", name: "Sleep", subtitle: "Put the machine to sleep", icon: "⏾", keywords: ["suspend"], actions: [{ id: "run", title: "Sleep" }] });
  });

  test("destructive rows carry a confirm while the setting is on, not when it is off", async () => {
    const on = await list();
    expect(on[1].actions).toEqual([{ id: "run", title: "Shut Down", style: "destructive", confirm: "Shut Down now?" }]);
    expect(on[2].actions![0].confirm).toBe("Empty Trash now?");
    expect(on[0].actions![0].confirm).toBeUndefined();
    host.changeSettings("system", { settings: { confirm_destructive: false } });
    const off = await list();
    expect(off[1].actions).toEqual([{ id: "run", title: "Shut Down" }]);
    expect(off.every((i) => i.actions![0].confirm === undefined)).toBe(true);
    host.changeSettings("system", {});
    expect((await list())[1].actions![0].confirm).toBe("Shut Down now?");
  });

  test("the list ignores a query: matching is the index's", async () => {
    expect((await list("shut")).map((i) => i.id)).toEqual(["sleep", "shutdown", "trash"]);
  });

  test("pick runs through the core and hides; a refusal is a failure toast that keeps the palette", async () => {
    expect(await host.pick("system", "system", "shutdown", "run")).toEqual({});
    expect(ran).toEqual(["shutdown"]);
    expect(await host.pick("system", "system", "sleep")).toEqual({ keep: true, toast: { title: "Command failed", message: "pmset: not permitted", style: "failure" } });
  });
});
