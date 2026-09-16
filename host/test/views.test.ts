// Live views, the host's side (src/views.ts, sdk/src/api.ts `view`): the
// core's `view/shown` and `view/hidden` reach the extension's
// `view.onShown`/`view.onHidden` inside the extension's context (so a
// push in there needs no `{ palette }`), `view.open()` lists what is
// open, a `view.update` is one `core/view.update` with the target and a
// checked spec (a bare tree as `{ tree }`, a whole View as itself), pushes
// closer than `VIEW_UPDATE_MIN_MS` coalesce with the last winning, a bad
// tree is refused in the SDK, a push from a timer without `{ palette }`
// is refused, and a reload forgets the old module's listeners.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { VIEW_UPDATE_MIN_MS } from "../../sdk/src/api.ts";
import { API, Host, Root, manifest } from "./harness.ts";

const ext = `
import { view } from "${API}";
const log = [];
let timer;
let n = 0;
const tree = (v) => ({ type: "stack", children: [{ type: "text", key: "count", value: String(v), transition: { move: true } }] });
view.onShown((ev) => {
  log.push(["shown", ev]);
  // Inside the listener the palette is in context: no { palette } needed. A bar target names itself.
  if (ev.bar) { view.update(tree("bar"), { bar: ev.bar }); return; }
  view.update(tree(n));
  clearInterval(timer);
  timer = setInterval(() => view.update({ tree: tree(++n), actions: [{ id: "reset", title: "Reset" }], title: "Counter" }, { palette: "counter", id: ev.id }).catch(() => {}), 20);
});
view.onHidden((ev) => { log.push(["hidden", ev]); clearInterval(timer); timer = undefined; });
export default {
  palettes: {
    counter: {
      view: () => ({ tree: tree(n), actions: [] }),
      pick: async (id, action) => {
        if (action === "burst") { const all = await Promise.all([1, 2, 3, 4, 5].map((i) => view.update(tree("burst" + i)))); return { keep: true, settled: all }; }
        if (action === "bad") { try { await view.update({ type: "stack", children: [{ type: "text", key: "k", value: "a", transition: { move: true } }, { type: "text", key: "k", value: "b", transition: { move: true } }] }); } catch (e) { return { hud: e.message }; } }
        if (action === "open") return { hud: JSON.stringify(view.open()) };
        if (action === "log") return { hud: JSON.stringify(log) };
        if (action === "nowhere") { try { await Promise.resolve().then(() => new Promise((r) => setTimeout(r, 0))).then(() => view.update(tree(0), { extension: "ext" })); } catch (e) { return { hud: e.message }; } }
        return { keep: true };
      },
    },
    other: { list: () => [], pick: () => {} },
  },
  bar: { item: { render: () => ({ title: "x", menu: { view: { tree: tree(0), actions: [] } } }) } },
  dispose: () => clearInterval(timer),
};`;

describe("live views", () => {
  let root: Root;
  let host: Host;
  beforeAll(async () => {
    root = new Root({ ext: { "index.ts": ext, "pal.json": manifest("ext", { palettes: { counter: { kind: "view", refresh: 5, on: ["media"] }, other: { kind: "list" } } }) } });
    host = await Host.start({ roots: [root.dir] });
  });
  afterAll(() => { host.kill(); root.rm(); });

  test("the manifest's refresh and on ride on the palette meta; on a listing they are warned about", async () => {
    const loaded = host.loaded().find((l) => l.extension === "ext")!;
    expect(loaded.palettes.find((p) => p.name === "counter")).toMatchObject({ view: "view", refresh: 5, on: ["media"] });
    expect(loaded.palettes.find((p) => p.name === "other")).not.toHaveProperty("refresh");
    expect(loaded.warnings).toEqual([]);
  });

  test("view/shown starts the loop in the palette's context, view.open lists it, view/hidden stops it", async () => {
    host.viewShown("ext", { palette: "counter" });
    const first = await host.nextViewUpdate("ext", { palette: "counter" });
    expect(first).toEqual({ extension: "ext", palette: "counter", spec: { tree: { type: "stack", children: [{ type: "text", key: "count", value: "0", transition: { move: true } }] } } });
    const later = await host.nextViewUpdate("ext", { palette: "counter" }, (u) => "actions" in u.spec && Number((u.spec.tree as any).children[0].value) >= 2);
    expect(later).toMatchObject({ extension: "ext", palette: "counter", id: "view", spec: { title: "Counter", actions: [{ id: "reset", title: "Reset" }] } });
    expect(await host.pick("ext", "counter", "view", "open")).toEqual({ hud: JSON.stringify([{ extension: "ext", palette: "counter", id: "view" }]) });
    // A repeated shown is ignored; the hidden ends the loop and empties the list.
    host.viewShown("ext", { palette: "counter" });
    host.viewHidden("ext", { palette: "counter" });
    await Bun.sleep(80);
    const n = host.viewUpdates("ext", { palette: "counter" }).length;
    await Bun.sleep(80);
    expect(host.viewUpdates("ext", { palette: "counter" }).length).toBe(n);
    expect(await host.pick("ext", "counter", "view", "open")).toEqual({ hud: "[]" });
    const log = JSON.parse((await host.pick("ext", "counter", "view", "log")).hud as string);
    expect(log).toEqual([["shown", { extension: "ext", palette: "counter", id: "view" }], ["hidden", { extension: "ext", palette: "counter", id: "view" }]]);
    // An unknown hidden is nothing; a malformed one is a log line, not a reply.
    host.viewHidden("ext", { palette: "counter" });
    host.notify("view/shown", { extension: "ext" });
    await host.untilStderr("view/shown failed: view/shown: no extension, palette/bar and id");
    expect(host.garbage).toEqual([]);
  });

  test("a bar item's own popover level is a { bar } target, marked compact", async () => {
    host.viewShown("ext", { bar: "item" }, "view", true);
    const u = await host.nextViewUpdate("ext", { bar: "item" });
    expect(u).toEqual({ extension: "ext", bar: "item", spec: { tree: { type: "stack", children: [{ type: "text", key: "count", value: "bar", transition: { move: true } }] } } });
    expect(await host.pick("ext", "counter", "view", "open")).toEqual({ hud: JSON.stringify([{ extension: "ext", bar: "item", id: "view", compact: true }]) });
    host.viewHidden("ext", { bar: "item" }, "view", true);
    expect(await host.pick("ext", "counter", "view", "open")).toEqual({ hud: "[]" });
  });

  test("a burst of pushes coalesces: the first goes, the last wins, everyone settles", async () => {
    const before = host.viewUpdates("ext", { palette: "counter" }).length;
    const r = await host.pick("ext", "counter", "view", "burst");
    expect(r.settled).toEqual([null, null, null, null, null]);
    const sent = host.viewUpdates("ext", { palette: "counter" }).slice(before);
    expect(sent.map((u) => (u.spec.tree as any).children[0].value)).toEqual(["burst1", "burst5"]);
    // Spaced past the window, each goes on its own.
    await Bun.sleep(VIEW_UPDATE_MIN_MS + 5);
    await host.pick("ext", "counter", "view", "burst");
    expect(host.viewUpdates("ext", { palette: "counter" }).slice(before).length).toBe(4);
  });

  test("a bad tree is refused in the SDK before it goes; a push from outside the context without a target is refused", async () => {
    const before = host.coreCalls.filter((c) => c.method === "view.update").length;
    expect(await host.pick("ext", "counter", "view", "bad")).toEqual({ hud: 'view.update counter: tree has two children keyed "k"' });
    expect(await host.pick("ext", "counter", "view", "nowhere")).toEqual({ hud: "view.update: which view? pass { palette } (or { bar }) outside view/pick, as for storage" });
    expect(host.coreCalls.filter((c) => c.method === "view.update").length).toBe(before);
  });

  test("a reload forgets the old module's listeners: only the new module hears the next shown", async () => {
    const reloaded = host.next("extension/loaded", (p) => p.extension === "ext");
    root.write("ext", "index.ts", ext.replace('log.push(["shown", ev]);', 'log.push(["shown2", ev]);'));
    await reloaded;
    host.viewShown("ext", { palette: "counter" });
    await host.nextViewUpdate("ext", { palette: "counter" });
    const log = JSON.parse((await host.pick("ext", "counter", "view", "log")).hud as string);
    expect(log).toEqual([["shown2", { extension: "ext", palette: "counter", id: "view" }]]);
    host.viewHidden("ext", { palette: "counter" });
  });
});
