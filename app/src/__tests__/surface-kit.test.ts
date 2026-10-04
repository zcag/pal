// The surface kit (src-tauri/surface-kit/surface.js, docs/design/game-surface.md)
// in its three places: inside pal (calls up as `call`, answered by `reply`),
// on play.cagdas.io (`?play=1`: storage and the account calls up as `call`,
// answered by `result`, storage changes pushed down) and a stub anywhere
// else (`?web`, or a plain tab). The script runs against a stand-in window
// (whose parent records what the kit posts), document and localStorage.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { SurfaceKit } from "../../../sdk/src/protocol";

const SRC = readFileSync(resolve(__dirname, "../../src-tauri/surface-kit/surface.js"), "utf8");

function load(search: string, framed = true) {
  const listeners: ((e: { source: unknown; data: unknown }) => void)[] = [];
  const up: Record<string, unknown>[] = [];
  const parent = { postMessage: (m: Record<string, unknown>) => { up.push(m); } };
  const win: Record<string, unknown> = { addEventListener: (t: string, f: (e: { source: unknown; data: unknown }) => void) => { if (t === "message") listeners.push(f); } };
  win.parent = framed ? parent : win;
  const media = () => ({ matches: false, addEventListener: () => {} });
  const document = { head: { prepend: () => {} }, createElement: () => ({}), documentElement: { dataset: {}, style: { setProperty: () => {} } }, addEventListener: () => {}, hidden: false };
  const kept = new Map<string, string>();
  const localStorage = { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => kept.set(k, v), removeItem: (k: string) => kept.delete(k) };
  new Function("window", "location", "matchMedia", "document", "localStorage", SRC)(win, { search, pathname: "/game/" }, media, document, localStorage);
  const down = (data: unknown, source: unknown = parent) => listeners.forEach((f) => f({ source, data }));
  const calls = () => up.filter((m) => m.pal === "call");
  return { pal: win.pal as SurfaceKit, up, calls, down };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("surface kit", () => {
  it("a stub outside pal: storage in localStorage, a score kept as is, no board, signed out", async () => {
    for (const k of [load("?web"), load("", false)]) {
      await k.pal.storage.set("best", 7);
      expect(await k.pal.storage.get("best")).toBe(7);
      expect(await k.pal.score("daily", 5)).toEqual({ best: 5, rank: null, total: null });
      expect(await k.pal.leaderboard("daily")).toEqual({ board: null, rows: [], me: null });
      expect(await k.pal.account()).toEqual({ signedIn: false, handle: null });
      await k.pal.signIn();
      expect(typeof k.pal.storage.onChange(() => {})).toBe("function");
      expect(k.calls()).toEqual([]);
    }
  });

  it("on play.cagdas.io (?play=1): storage and the account calls go to the page, answered by result; its storage pushes reach onChange", async () => {
    const k = load("?web&play=1");
    const got = k.pal.storage.get("best");
    const score = k.pal.score("stage/2", 31.5);
    const board = k.pal.leaderboard("daily", { period: "week", anon: false });
    const who = k.pal.account();
    const sign = k.pal.signIn();
    const set = k.pal.storage.set("run", undefined);
    expect(k.calls()).toEqual([
      { pal: "call", id: 1, method: "storage.get", params: { key: "best" } },
      { pal: "call", id: 2, method: "score", params: { board: "stage/2", value: 31.5 } },
      { pal: "call", id: 3, method: "leaderboard", params: { board: "daily", period: "week", anon: false } },
      { pal: "call", id: 4, method: "account", params: {} },
      { pal: "call", id: 5, method: "signIn", params: {} },
      { pal: "call", id: 6, method: "storage.set", params: { key: "run", value: null } },
    ]);
    // Another window's answer is not ours.
    k.down({ pal: "result", id: 1, result: 99 }, {});
    k.down({ pal: "result", id: 1, result: 12 });
    k.down({ pal: "result", id: 2, error: "choose a handle" });
    k.down({ pal: "result", id: 4, result: { signedIn: true, handle: "ada" } });
    k.down({ pal: "result", id: 5, result: null });
    k.down({ pal: "result", id: 6, result: null });
    expect(await got).toBe(12);
    await expect(score).rejects.toThrow("choose a handle");
    expect(await who).toEqual({ signedIn: true, handle: "ada" });
    expect(await sign).toBeUndefined();
    expect(await set).toBeUndefined();
    k.down({ pal: "result", id: 3, result: { board: null, rows: [], me: null } });
    expect(await board).toEqual({ board: null, rows: [], me: null });
    const heard: unknown[][] = [];
    const off = k.pal.storage.onChange((key, value) => heard.push([key, value]));
    k.down({ pal: "storage", key: "best", value: 40 });
    off();
    k.down({ pal: "storage", key: "best", value: 41 });
    expect(heard).toEqual([["best", 40]]);
  });

  it("inside pal: the account calls go up as calls, answered by reply; a storage post reaches onChange", async () => {
    const k = load("");
    expect(k.up[0]).toEqual({ pal: "hello" });
    const score = k.pal.score("daily", 120);
    const board = k.pal.leaderboard("daily");
    expect(k.calls()).toEqual([
      { pal: "call", id: 1, method: "score", params: { board: "daily", value: 120 } },
      { pal: "call", id: 2, method: "leaderboard", params: { board: "daily" } },
    ]);
    k.down({ pal: "reply", id: 1, result: { best: 120, rank: 1, total: 4 } });
    k.down({ pal: "reply", id: 2, result: { board: null, rows: [], me: null } });
    expect(await score).toEqual({ best: 120, rank: 1, total: 4 });
    expect(await board).toEqual({ board: null, rows: [], me: null });
    const heard: unknown[][] = [];
    k.pal.storage.onChange((key, value) => heard.push([key, value]));
    k.down({ pal: "storage", key: "unlocks", value: ["a", "b"] });
    await tick();
    expect(heard).toEqual([["unlocks", ["a", "b"]]]);
  });
});
