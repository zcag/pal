// processes against the real `ps`: the machine running the tests has more
// than a handful of processes, and this test file is one of them.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Host } from "../harness.ts";

let host: Host;
beforeAll(async () => { host = await Host.bundled(); });
afterAll(() => host.kill());

const list = (query?: string, filter?: string) => host.list("processes", "processes", query, filter ? { filter } : undefined);
const pick = (id: string, action?: string) => host.pick("processes", "processes", id, action);

describe("processes", () => {
  test("meta: live input palette with the four filters", () => {
    expect(host.loaded().find((l) => l.extension === "processes")!.palettes[0]).toMatchObject({
      name: "processes", title: "Processes", live: true, input: true, icon: "▤",
      filters: [{ id: "all", title: "All" }, { id: "mine", title: "Mine" }, { id: "cpu", title: "Top CPU" }, { id: "memory", title: "Top memory" }],
    });
  });

  test("rows with pids, sorted by cpu then memory, pid and memory accessories, three actions", async () => {
    const items = await list();
    expect(items.length).toBeGreaterThan(5);
    for (const i of items) {
      expect(i.id).toMatch(/^\d+$/);
      expect(i.pid).toBe(Number(i.id));
      expect(i.name).toBeTruthy();
      expect(i.accessories!.slice(-2)).toEqual([{ text: i.id }, { text: expect.stringMatching(/^\d+(\.\d)? [MG]B$/) }]);
      expect(i.actions!.map((a) => a.id)).toEqual(["kill", "force-kill", "copy-pid"]);
    }
    expect(items[0].actions![0]).toMatchObject({ style: "destructive", confirm: expect.any(String) });
    // Never lists the host itself, and never a system pid by default.
    expect(items.map((i) => i.id)).not.toContain(String(host.pid));
    expect(items.every((i) => Number(i.id) >= 100)).toBe(true);
    // Sorted by cpu, then rss; a cpu tag only above 10%.
    const key = (i: any) => [i.cpu as number, i.rss as number];
    for (let k = 1; k < items.length; k++) {
      const [a, b] = [key(items[k - 1]), key(items[k])];
      expect(a[0] > b[0] || (a[0] === b[0] && a[1] >= b[1])).toBe(true);
    }
    for (const i of items) expect(i.accessories!.some((a) => "tag" in a)).toBe((i.cpu as number) > 10);
  });

  test("the query narrows to name or pid", async () => {
    const all = await list();
    const pid = all[0].id;
    const byPid = await list(pid);
    expect(byPid.length).toBeGreaterThan(0);
    expect(byPid.every((i) => i.id.startsWith(pid))).toBe(true);
    const byName = await list("bun");
    expect(byName.length).toBeGreaterThan(0);
    expect(byName.every((i) => i.name.toLowerCase().includes("bun"))).toBe(true);
  });

  test("filters change the set: mine is a subset, top lists are capped and ordered", async () => {
    const all = await list();
    const mine = await list(undefined, "mine");
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.length).toBeLessThanOrEqual(all.length);
    const ids = new Set(all.map((i) => i.id));
    expect(mine.every((i) => ids.has(i.id))).toBe(true);
    const cpu = await list(undefined, "cpu");
    expect(cpu.length).toBeLessThanOrEqual(25);
    expect(cpu.length).toBeLessThan(all.length);
    const memory = await list(undefined, "memory");
    expect(memory.length).toBeLessThanOrEqual(25);
    for (let k = 1; k < memory.length; k++) expect((memory[k - 1].rss as number) >= (memory[k].rss as number)).toBe(true);
  });

  test("include_system lets pids below 100 through", async () => {
    host.changeSettings("processes", { settings: { include_system: true } });
    expect((await list()).some((i) => Number(i.id) < 100)).toBe(true);
    host.changeSettings("processes", {});
  });

  test("copy pid; killing a process of our own", async () => {
    expect(await pick("4242", "copy-pid")).toEqual({ copy: "4242" });
    const child = Bun.spawn(["sleep", "60"]);
    expect(await pick(String(child.pid), "kill")).toEqual({ keep: true });
    expect(await child.exited).not.toBe(0);
    expect(child.signalCode).toBe("SIGTERM");
    const another = Bun.spawn(["sleep", "60"]);
    expect(await pick(String(another.pid), "force-kill")).toEqual({ keep: true });
    await another.exited;
    expect(another.signalCode).toBe("SIGKILL");
    // A pid nothing has: a failure toast, palette kept.
    expect(await pick("999999999", "kill")).toMatchObject({ keep: true, toast: { style: "failure" } });
  });
});
