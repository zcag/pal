// states: the helpers (a duration, the time-left text), then the palette
// over the wire against an in-memory table standing in for the core's
// (`core/states.*`): the rows and their sources, the filters, Enter's
// toggle, a hold for a while, the reset, New state's declare, the bar
// item that shows only what is held; and `state.onChange` in an
// extension of its own reached by the core's `states/changed`.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { duration, left } from "../../../extensions/states/index.ts";
import type { BarItem, Item, StateEntry } from "../../../sdk/src/protocol.ts";
import { API, Host, Root } from "../harness.ts";

describe("helpers", () => {
  test("duration: units chain, a bare number is minutes, junk is nothing", () => {
    expect(duration("90s")).toBe(90);
    expect(duration("25m")).toBe(1500);
    expect(duration("1h30m")).toBe(5400);
    expect(duration("1 h")).toBe(3600);
    expect(duration("25")).toBe(1500);
    expect(duration("1d")).toBe(86400);
    expect(duration("soon")).toBeUndefined();
    expect(duration("")).toBeUndefined();
  });
  test("left: hours and minutes, minutes, seconds", () => {
    expect(left(2 * 3_600_000 + 40 * 60_000)).toBe("2 h 40 m");
    expect(left(12 * 60_000)).toBe("12 m");
    expect(left(40_000)).toBe("40 s");
    expect(left(-5)).toBe("0 s");
  });
});

/** The core's table, in memory: manual over published over default, `until` honoured on read. */
class Table {
  entries = new Map<string, StateEntry>();
  declared: Record<string, unknown>[] = [];
  undeclared: string[] = [];
  constructor() {
    this.entries.set("hour", { name: "hour", value: 10, source: { published: "builtin" }, declared: false, builtin: true });
    this.entries.set("working", { name: "working", value: false, source: "expr", expr: "hour >= 9", description: "On the clock", declared: true, builtin: false });
    this.entries.set("deep", { name: "deep", value: false, source: "default", declared: true, builtin: false });
    this.entries.set("sessions/working", { name: "sessions/working", value: 2, source: { published: "sessions" }, declared: false, builtin: false });
  }
  core = {
    "states.list": () => [...this.entries.values()],
    "states.get": (p: { name?: string }) => (p.name ? this.entries.get(p.name)?.value ?? null : Object.fromEntries([...this.entries].map(([k, e]) => [k, e.value]))),
    "states.manual": (p: { name: string; value: unknown; until?: number }) => {
      const e = this.entries.get(p.name) ?? { name: p.name, value: null, source: "default" as const, declared: false, builtin: false };
      this.entries.set(p.name, { ...e, value: p.value as StateEntry["value"], source: "manual", until: p.until });
      return null;
    },
    "states.reset": (p: { name: string }) => {
      const e = this.entries.get(p.name)!;
      this.entries.set(p.name, { ...e, source: e.expr ? "expr" : "default", value: false, until: undefined });
      return null;
    },
    "states.declare": (p: Record<string, unknown>) => { this.declared.push(p); return null; },
    "states.undeclare": (p: { name: string }) => { this.undeclared.push(p.name); return null; },
  };
}

describe("over the wire", () => {
  let host: Host;
  const table = new Table();
  beforeAll(async () => { host = await Host.bundled({ core: table.core }); });
  afterAll(() => host.kill());

  const rows = (filter?: string) => host.list("states", "states", undefined, filter ? { filter } : undefined);
  const byId = (rows: Item[], id: string) => rows.find((r) => r.id === id)!;

  test("every state is a row with its value and source; New state leads", async () => {
    const r = await rows();
    expect(r[0].id).toBe("new");
    expect(r.map((x) => x.id)).toEqual(["new", "hour", "working", "deep", "sessions/working"]);
    expect(byId(r, "working").accessories).toEqual([{ tag: "false", color: "muted" }, { tag: "expr", color: "muted" }]);
    expect(byId(r, "working").subtitle).toBe("On the clock");
    expect(byId(r, "hour").accessories).toEqual([{ tag: "10", color: "blue" }, { tag: "built-in", color: "muted" }]);
    expect(byId(r, "hour").actions?.map((a) => a.id)).toEqual(["copy"]); // a built-in is only copied
    expect(byId(r, "sessions/working").subtitle).toBe("Published by sessions");
    expect(byId(r, "deep").actions?.map((a) => a.id)).toEqual(["toggle", "set", "hold-1h", "hold-3h", "hold-tomorrow", "copy", "undeclare"]);
  });

  test("filters: held, mine, from extensions, built-in", async () => {
    expect((await rows("held")).map((x) => x.id)).toEqual(["hint:none"]);
    expect((await rows("mine")).map((x) => x.id)).toEqual(["new", "working", "deep"]);
    expect((await rows("ext")).map((x) => x.id)).toEqual(["sessions/working"]);
    expect((await rows("builtin")).map((x) => x.id)).toEqual(["hour"]);
  });

  test("Enter toggles a boolean; a hold puts it by hand for a while; reset takes it back", async () => {
    await host.pick("states", "states", "deep", undefined);
    expect(table.entries.get("deep")).toMatchObject({ value: true, source: "manual" });
    let r = await rows("held");
    expect(r.map((x) => x.id)).toEqual(["deep"]);
    expect(byId(r, "deep").accessories?.[1]).toEqual({ tag: "held", color: "amber" });
    expect(byId(r, "deep").actions?.some((a) => a.id === "reset")).toBe(true);

    const before = Date.now();
    await host.pick("states", "states", "working", "hold-3h");
    const w = table.entries.get("working")!;
    expect(w.value).toBe(true);
    expect(w.until! - before).toBeGreaterThanOrEqual(3 * 3_600_000 - 50);
    r = await rows();
    expect((byId(r, "working").accessories?.[1] as { tag: string }).tag).toMatch(/^held · (2 h 59 m|3 h 0 m)$/);

    await host.pick("states", "states", "working", "reset");
    expect(table.entries.get("working")).toMatchObject({ value: false, source: "expr" });
  });

  test("a typed value with a duration sets by hand; a bad duration asks again", async () => {
    await host.pick("states", "states", "deep", "set", { values: { value: "3", for: "15m" } });
    const d = table.entries.get("deep")!;
    expect(d.value).toBe(3);
    expect(d.until! - Date.now()).toBeGreaterThan(14 * 60_000);
    const again = await host.pick("states", "states", "deep", "set", { values: { value: "home", for: "soon" } }) as { form?: { errors?: Record<string, string> } };
    expect(again.form?.errors).toEqual({ for: "90s, 25m, 1h30m, 2h, 1d" });
    await host.pick("states", "states", "deep", "reset");
  });

  test("New state declares through the core; a bad name asks again; Remove undeclares", async () => {
    const r = await host.pick("states", "states", "new", undefined, { values: { name: "home", expr: "network == 'Zaxxon'", default: "false", description: "At home" } });
    expect(r.toast?.title).toBe("Declared home");
    expect(table.declared).toEqual([{ extension: "states", name: "home", expr: "network == 'Zaxxon'", default: false, description: "At home" }]);
    const bad = await host.pick("states", "states", "new", undefined, { values: { name: "Bad Name" } }) as { form?: { errors?: Record<string, string> } };
    expect(bad.form?.errors?.name).toBeDefined();
    await host.pick("states", "states", "deep", "undeclare");
    expect(table.undeclared).toEqual(["deep"]);
  });

  test("the bar item is hidden with nothing held, and names the soonest to expire", async () => {
    for (const n of ["deep", "working"]) table.core["states.reset"]({ name: n });
    const hidden = await host.render("states", "forced");
    expect(hidden).toMatchObject({ hidden: true, empty: { menu: { palette: "states" } } });
    table.core["states.manual"]({ name: "deep", value: true });
    table.core["states.manual"]({ name: "working", value: true, until: Date.now() + 40 * 60_000 });
    const item = await host.render("states", "forced") as BarItem;
    expect(item.title).toMatch(/^working · (39|40) m$/);
    expect(item.badge).toBe(2);
    expect(item.color).toBe("amber");
    expect(item.refresh).toBe(60);
    table.core["states.reset"]({ name: "deep" });
    table.core["states.reset"]({ name: "working" });
  });
});

describe("state.onChange", () => {
  const root = new Root({
    watcher: {
      "pal.json": JSON.stringify({ name: "watcher", version: "0.1.0", palettes: { w: { kind: "list" } } }),
      "index.ts": `
import { state } from "${API}";
const seen: unknown[] = [];
state.onChange("working", (v) => seen.push(["working", v]));
state.onChange((c) => seen.push(c));
export default { palettes: { w: { title: "w", list: () => seen.map((s, i) => ({ id: String(i), name: JSON.stringify(s) })) } } };`,
    },
  });
  let host: Host;
  beforeAll(async () => { host = await Host.start({ roots: [root.dir] }); });
  afterAll(() => { host.kill(); root.rm(); });

  test("the core's states/changed reaches both shapes of listener", async () => {
    host.notify("states/changed", { states: { working: true, hour: 9 } });
    host.notify("states/changed", { states: { hour: 10 } });
    await Bun.sleep(50);
    const rows = await host.list("watcher", "w");
    expect(rows.map((r) => JSON.parse(r.name))).toEqual([["working", true], { working: true, hour: 9 }, { hour: 10 }]);
  });
});
