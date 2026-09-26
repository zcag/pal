// A streamed list (`ctx.partial`): the early rows go out as `core/list.partial`
// with the request's stream, a burst folds into its latest snapshot, nothing
// trails the answer, and a list asked without a stream has no `partial`.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { Host, Root, manifest, simpleExt } from "./harness.ts";

let root: Root, host: Host;
beforeAll(async () => {
  root = new Root({
    s: {
      "index.ts": simpleExt("search", {
        extra: "input: true,",
        list: `async (q, ctx) => {
          if (q === "has") return [{ id: String(typeof ctx?.partial) , name: "x" }];
          if (q === "burst") { for (let i = 0; i < 20; i++) ctx.partial([{ id: "b" + i, name: "b" }]); await Bun.sleep(30); return [{ id: "done", name: "d" }]; }
          if (q === "late") { ctx.partial([{ id: "early", name: "e" }]); setTimeout(() => ctx.partial([{ id: "after", name: "a" }]), 5); return [{ id: "done", name: "d" }]; }
          ctx.partial([{ id: "fast", name: "Fast" }]);
          await Bun.sleep(20);
          ctx.partial([{ id: "fast", name: "Fast" }, { id: "mid", name: "Mid" }]);
          await Bun.sleep(20);
          return [{ id: "fast", name: "Fast" }, { id: "mid", name: "Mid" }, { id: "slow", name: "Slow" }];
        }`,
      }),
      "pal.json": manifest("s"),
    },
  });
  host = await Host.start({ roots: [root.dir] });
});
afterAll(() => { host?.kill(); root?.rm(); });

test("each partial goes out in order under the request's stream, then the answer", async () => {
  const r = await host.listStream("s", "search", "q");
  expect(r.partials.map((p) => p.map((i) => i.id))).toEqual([["fast"], ["fast", "mid"]]);
  expect(r.items.map((i) => i.id)).toEqual(["fast", "mid", "slow"]);
});

test("a burst folds into the latest snapshot, one relay in flight", async () => {
  const r = await host.listStream("s", "search", "burst");
  expect(r.partials.length).toBeLessThan(20);
  expect(r.partials.at(-1)!.map((i) => i.id)).toEqual(["b19"]);
});

test("a partial after the answer is dropped", async () => {
  const r = await host.listStream("s", "search", "late");
  await Bun.sleep(30);
  const all = host.coreCalls.filter((c) => c.method === "list.partial").map((c) => (c.params as any).items[0].id);
  expect(r.partials.map((p) => p[0].id)).toEqual(["early"]);
  expect(all).not.toContain("after");
});

test("only a streamed list has ctx.partial", async () => {
  expect((await host.list("s", "search", "has"))[0].id).toBe("undefined");
  expect((await host.listStream("s", "search", "has")).items[0].id).toBe("function");
});
