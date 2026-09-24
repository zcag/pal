// Game surfaces, the host's side (src/serve.ts `surface`, src/surface.ts,
// sdk/src/api.ts `surface`; docs/design/game-surface.md): `checkView`'s
// rules for the node, the page's calls as the app relays them (`send` to
// `onMessage` with its reply, the extension's storage and settings, a
// settings change pushed to the page), `surface.post` as one
// `core/view.post`, and `surface/transpile` for the scheme's `*.ts`.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkView } from "../../sdk/src/view.ts";
import { API, Host, Root, manifest } from "./harness.ts";

const node = (src: unknown) => ({ tree: { type: "surface", src }, actions: [] });

describe("checkView: the surface node", () => {
  test("src is a path inside the extension's folder", () => {
    expect(() => checkView(node("surface/index.html"))).not.toThrow();
    expect(() => checkView(node("index.html"))).not.toThrow();
    for (const bad of ["", "/surface/index.html", "../other/index.html", "surface/../../x.html", "./index.html", "surface//index.html", ".hidden/index.html", "https://example.com/", "file:///etc/passwd", "data:text/html,x", "surface\\index.html", 42]) {
      expect(() => checkView(node(bad)), String(bad)).toThrow(/surface src/);
    }
  });

  test("one per view, anywhere in the tree", () => {
    const two = { tree: { type: "stack", children: [{ type: "surface", src: "a.html" }, { type: "surface", src: "b.html" }] }, actions: [] };
    expect(() => checkView(two)).toThrow(/second surface/);
    expect(() => checkView({ tree: { type: "stack", children: [{ type: "text", value: "x" }, { type: "surface", src: "a.html" }] }, actions: [] })).not.toThrow();
  });
});

const ext = `
import { settings, storage, surface } from "${API}";
export default {
  palettes: {
    game: {
      view: () => ({ tree: { type: "surface", src: "surface/index.html" }, actions: [{ id: "new", title: "New game" }] }),
      pick: async (_id, action) => {
        if (action === "post") { await surface.post({ score: 3 }); return { keep: true }; }
        if (action === "bad") { try { await surface.post({ x: 1 }, { extension: "game" }); } catch (e) { return { hud: e.message }; } }
        return {};
      },
      onMessage: async (msg, ctx) => {
        if (msg.echo !== undefined) return { echo: msg.echo, args: ctx?.args ?? null };
        if (msg.store) { await storage.set("best", msg.store); return undefined; }
        if (msg.level) { await settings.set("level", msg.level); return settings.get(); }
        if (msg.fail) throw new Error("no such move");
      },
    },
    plain: { view: () => ({ tree: { type: "text", value: "x" }, actions: [] }), pick: () => {} },
  },
};`;

describe("surface calls and posts", () => {
  let root: Root;
  let host: Host;
  const call = (palette: string, c: string, data: unknown, args?: unknown) => host.request("surface", { extension: "game", palette, call: c, data, ...(args !== undefined && { args }) });
  beforeAll(async () => {
    root = new Root({ game: { "index.ts": ext, "pal.json": manifest("game", { settings: [{ kind: "select", id: "level", label: "Level", options: [{ id: "easy", title: "Easy" }, { id: "hard", title: "Hard" }], default: "easy" }], palettes: { game: { kind: "view" }, plain: { kind: "view" } } }) } });
    host = await Host.start({ roots: [root.dir] });
  });
  afterAll(() => { host.kill(); root.rm(); });

  test("send reaches onMessage with the level's args; a value is the reply, undefined none, a throw the error", async () => {
    expect(await host.surfaceSend("game", "game", { echo: 7 }, { seed: 1 })).toEqual({ echo: 7, args: { seed: 1 } });
    expect(await call("game", "send", { msg: { echo: 7 } })).toEqual({ reply: { echo: 7, args: null } });
    expect(await call("game", "send", { msg: { store: 12 } })).toEqual({});
    await expect(call("game", "send", { msg: { fail: true } })).rejects.toThrow("no such move");
    await expect(call("plain", "send", { msg: {} })).rejects.toThrow("game/plain: pal.send but the palette has no onMessage");
    await expect(call("game", "exec", {})).rejects.toThrow("no surface call exec");
  });

  test("storage is the extension's own, the same the SDK writes", async () => {
    await call("game", "send", { msg: { store: 5 } });
    expect(await call("game", "storage.get", { key: "best" })).toBe(5);
    expect(await call("game", "storage.set", { key: "seen", value: [1, 2] })).toBeNull();
    expect(host.coreCalls.filter((c) => c.method === "storage.set").map((c) => c.params)).toContainEqual({ extension: "game", key: "seen", value: [1, 2] });
    expect(await call("game", "storage.get", { key: "seen" })).toEqual([1, 2]);
  });

  test("settings are the extension's values; a change after the ask is posted to the page, one onMessage made included", async () => {
    expect(await call("game", "settings", {})).toEqual({ level: "easy" });
    const settingsPosts = () => host.surfacePosts("game", "game").filter((p) => p.pal === "settings");
    host.changeSettings("game", { settings: { level: "hard" } });
    await host.until(() => settingsPosts().length === 1, 3000, "settings post");
    expect(settingsPosts()[0]).toEqual({ pal: "settings", data: { level: "hard" } });
    // A page's level picker writes the setting through the extension (minesweeper's `D`).
    expect(await host.surfaceSend("game", "game", { level: "easy" })).toEqual({ level: "easy" });
    expect(host.written.get("game")).toEqual({});
    await host.until(() => settingsPosts().length === 2, 3000, "second settings post");
    expect(settingsPosts()[1]).toEqual({ pal: "settings", data: { level: "easy" } });
  });

  test("surface.post is one core/view.post in the kit's envelope, addressed like view.update", async () => {
    await host.pick("game", "game", "view", "post");
    expect(host.surfacePosts("game", "game")).toContainEqual({ pal: "message", data: { score: 3 } });
    expect(await host.pick("game", "game", "view", "bad")).toEqual({ hud: expect.stringContaining("which view? pass { palette }") });
  });
});

describe("surface/transpile", () => {
  let root: Root;
  let host: Host;
  beforeAll(async () => {
    root = new Root({ game: { "index.ts": "export default { palettes: {} };", "game.ts": "export type State = { n: number };\nexport const apply = (s: State): State => ({ n: s.n + 1 });\n" } });
    host = await Host.start({ roots: [root.dir] });
  });
  afterAll(() => { host.kill(); root.rm(); });

  test("a page's TypeScript as JavaScript: types gone, a type-only import dropped, imports as written; cached until the file changes", async () => {
    const page = join(root.dir, "game/main.ts");
    writeFileSync(page, `import { apply, State } from "../game.ts";\nconst s: State = apply({ n: 1 });\ndocument.title = String(s.n as number);\n`);
    const js = await host.request<string>("surface/transpile", { path: page });
    expect(js).toContain(`import { apply } from "../game.ts"`);
    expect(js).not.toContain("State");
    expect(js).not.toContain(" as number");
    writeFileSync(page, "export const v: number = 2;\n");
    utimesSync(page, new Date(), new Date(Date.now() + 5000));
    expect(await host.request<string>("surface/transpile", { path: page })).toContain("export const v = 2");
  });

  test("anything but a .ts file, or one not there, is refused", async () => {
    await expect(host.request("surface/transpile", { path: join(root.dir, "game/index.js") })).rejects.toThrow("not a .ts file");
    await expect(host.request("surface/transpile", { path: join(root.dir, "game/gone.ts") })).rejects.toThrow();
  });
});
