// bridge.ts in-process: `call` writes a numbered `core/*` request on stdout
// and `resolve` settles it; a missing reply times out and frees the slot.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { call, resolve } from "../src/bridge.ts";

let written: string[] = [];
const realWrite = process.stdout.write;
beforeEach(() => { written = []; process.stdout.write = ((s: string) => (written.push(String(s)), true)) as typeof process.stdout.write; });
afterEach(() => { process.stdout.write = realWrite; });

const last = () => JSON.parse(written.at(-1)!);

describe("pending table", () => {
  test("call writes {id, method: core/<x>, params} and resolves on the matching reply", async () => {
    const p = call<number>("clipboard.get", { id: 7 });
    const req = last();
    expect(req).toEqual({ id: req.id, method: "core/clipboard.get", params: { id: 7 } });
    expect(written.at(-1)!.endsWith("\n")).toBe(true);
    expect(resolve({ id: req.id, result: 42 })).toBe(true);
    expect(await p).toBe(42);
  });

  test("ids count up per request", () => {
    call("a"); const a = last().id;
    call("b"); const b = last().id;
    expect(b).toBe(a + 1);
    resolve({ id: a, result: null }); resolve({ id: b, result: null });
  });

  test("an error reply rejects with its message", async () => {
    const p = call("x");
    resolve({ id: last().id, error: "nope" });
    await expect(p).rejects.toThrow("nope");
  });

  test("a reply nobody waits for is refused, and a slot resolves once", async () => {
    expect(resolve({ id: 987654, result: 1 })).toBe(false);
    const p = call("y");
    const id = last().id;
    expect(resolve({ id, result: "first" })).toBe(true);
    expect(resolve({ id, result: "second" })).toBe(false);
    expect(await p).toBe("first");
  });

  test("a call rejects when its timer fires and its slot is gone", async () => {
    const realTimeout = globalThis.setTimeout;
    let fire: (() => void) | undefined;
    let delay = 0;
    globalThis.setTimeout = ((fn: () => void, ms: number) => { fire = fn; delay = ms; return 0 as any; }) as typeof setTimeout;
    try {
      const p = call("slow.thing");
      const id = last().id;
      expect(delay).toBe(5000);
      fire!();
      await expect(p).rejects.toThrow("core slow.thing did not answer within 5 s");
      expect(resolve({ id, result: 1 })).toBe(false);
    } finally {
      globalThis.setTimeout = realTimeout;
    }
  });
});
