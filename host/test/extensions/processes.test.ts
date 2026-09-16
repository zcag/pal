// processes against the real `ps`: the machine running the tests has more
// than a handful of processes, and this test file is one of them. The port
// mode is exercised with a listener opened here, and its parsers over
// canned lsof and ss output.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { parseLsofListeners, parseSsListeners, portQuery } from "../../../extensions/processes/ports.ts";
import { Host } from "../harness.ts";

const MAC = process.platform === "darwin";
const ACTIONS = ["kill", "force-kill", "copy-pid", ...(MAC ? ["activity-monitor"] : [])];

describe("ports", () => {
  test("lsof -F pcn records: one per process and port, v4 and v6 of one port folded", () => {
    expect(parseLsofListeners("p458\ncrapportd\nf11\nn*:61729\nf16\nn*:61729\np481\ncARDAgent\nf9\nn[::1]:3283\nf10\nn127.0.0.1:8791\n")).toEqual([
      { pid: 458, command: "rapportd", port: 61729, address: "*" },
      { pid: 481, command: "ARDAgent", port: 3283, address: "[::1]" },
      { pid: 481, command: "ARDAgent", port: 8791, address: "127.0.0.1" },
    ]);
  });
  test("ss -ltnpH lines: every pid in users, brackets off a v6 address", () => {
    expect(parseSsListeners('LISTEN 0 128 0.0.0.0:22 0.0.0.0:* users:(("sshd",pid=1234,fd=3),("sshd",pid=1235,fd=3))\nLISTEN 0 4096 [::]:8791 [::]:* users:(("bak",pid=77,fd=5))\nLISTEN 0 4096 127.0.0.1:631 0.0.0.0:*\n')).toEqual([
      { pid: 1234, command: "sshd", port: 22, address: "0.0.0.0" },
      { pid: 1235, command: "sshd", port: 22, address: "0.0.0.0" },
      { pid: 77, command: "bak", port: 8791, address: "::" },
    ]);
  });
  test("portQuery: a colon then digits", () => {
    expect(portQuery(":")).toBe("");
    expect(portQuery(":30")).toBe("30");
    expect(portQuery(":30a")).toBeUndefined();
    expect(portQuery("bun")).toBeUndefined();
  });
});

let host: Host;
beforeAll(async () => { host = await Host.bundled(); });
afterAll(() => host.kill());

const list = (query?: string, filter?: string) => host.list("processes", "processes", query, filter ? { filter } : undefined);
const pick = (id: string, action?: string) => host.pick("processes", "processes", id, action);

describe("processes", () => {
  test("meta: live input palette with the four filters", () => {
    expect(host.loaded().find((l) => l.extension === "processes")!.palettes[0]).toMatchObject({
      name: "processes", title: "Processes", live: true, input: true, icon: "\u{f035b}",
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
      expect(i.actions!.map((a) => a.id)).toEqual(ACTIONS);
    }
    expect(items[0].actions![0]).toMatchObject({ style: "destructive", confirm: expect.any(String) });
    // Every row has an icon: the app bundle's, else the chip glyph.
    for (const i of items) expect(i.icon).toBeTruthy();
  });

  test("detail: the full command and the numbers of the row, from the last listing", async () => {
    const items = await list();
    const d = await host.detail("processes", "processes", items[0].id);
    expect(d!.metadata!.map((m) => m.label)).toEqual(["Command", "PID", "Parent", "User", "CPU", "Memory"]);
    expect(d!.metadata![1].value).toBe(items[0].id);
    expect(await host.detail("processes", "processes", "999999999")).toEqual({});
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
    // This process, not the top row: the top one can be a short-lived build step gone by the next listing (seen on marko under a cargo build).
    const pid = String(process.pid);
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
    // Processes come and go between two listings, so no subset check: this process is in both, and mine is never the larger list by more than the churn.
    const me = String(process.pid);
    expect(mine.some((i) => i.id === me)).toBe(true);
    expect(all.some((i) => i.id === me)).toBe(true);
    const cpu = await list(undefined, "cpu");
    expect(cpu.length).toBeLessThanOrEqual(25);
    expect(cpu.length).toBeLessThan(all.length);
    const memory = await list(undefined, "memory");
    expect(memory.length).toBeLessThanOrEqual(25);
    for (let k = 1; k < memory.length; k++) expect((memory[k - 1].rss as number) >= (memory[k].rss as number)).toBe(true);
  });

  test("a :port query lists what listens on it: this test's own server, the port as a tag and keyword, the pid the row's id prefix", async () => {
    if (!Bun.which("lsof") && !Bun.which("ss")) return;
    const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("ok") });
    try {
      const port = server.port!;
      const rows = await list(`:${port}`);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: `${process.pid}:${port}`, name: expect.stringMatching(/bun/i), subtitle: `127.0.0.1:${port}`, pid: process.pid });
      expect(rows[0].accessories![0]).toEqual({ tag: `:${port}`, color: "blue" });
      expect(rows[0].keywords).toEqual(expect.arrayContaining([String(process.pid), `:${port}`, String(port)]));
      expect(rows[0].actions!.map((a) => a.id)).toEqual(ACTIONS);
      expect(await pick(rows[0].id, "copy-pid")).toEqual({ copy: String(process.pid) });
      // A prefix narrows; a bare colon is every listener, this one among them.
      expect((await list(`:${String(port).slice(0, 2)}`)).some((r) => r.id === rows[0].id)).toBe(true);
      expect((await list(":")).some((r) => r.id === rows[0].id)).toBe(true);
      expect(await list(":65535")).toEqual([]);
    } finally { server.stop(true); }
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
