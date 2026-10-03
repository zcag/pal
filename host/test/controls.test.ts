// Controls and groups (docs/design/controls.md) through a real host: a
// provider and a consumer that never name each other, the harness standing
// in for the core's table and groups (app controls.rs). A publish reaches
// the consumer through its group, a run lands in the provider's own context
// (its settings), `onChange` fires, an ungrouped caller is served by itself,
// a `multi` provider answers from its worker; the view components pass
// `checkView` and `controls.act` reads their action ids.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { parseControlAction } from "../../sdk/src/api.ts";
import { inputsRow, powerButton, volumeButton, volumeRow, withControls } from "../../sdk/src/controls.ts";
import { checkControls } from "../../sdk/src/manifest.ts";
import type { Served, View } from "../../sdk/src/protocol.ts";
import { checkView } from "../../sdk/src/view.ts";
import { API, Host, Root, manifest, stored } from "./harness.ts";

/** A TV: volume, power and inputs; every op republishes, the device name from its own settings (so a run outside its context would miss it). */
const TV = `
import { controls, settings, storage } from "${API}";
let level = 0.2, on = true, current = "hdmi1";
const publish = () => {
  const device = String(settings.get().device);
  return Promise.all([
    controls.publish("volume", { device, level }),
    controls.publish("power", { device, on }),
    controls.publish("inputs", { device, list: [{ id: "hdmi1", name: "Apple TV" }, { id: "hdmi2", name: "PS5" }], current }),
  ]);
};
await publish();
export default {
  palettes: { tv: { title: "TV", list: () => [], pick: () => ({}) } },
  controls: {
    volume: { set: async (l) => { level = l; await publish(); }, step: async (d) => { level = Math.round((level + d / 10) * 10) / 10; await publish(); }, mute: () => {} },
    power: { set: async (o) => { on = o; await storage.set("power", o); await publish(); } },
    inputs: { set: async (id) => { if (id === "nope") throw new Error("no such input"); current = id; await publish(); } },
  },
};
`;

/** A set-top box: its own volume and power, a remote view drawn from what it is served, the actions forwarded to \`controls.act\`, every change it hears kept in storage. */
const BOX = `
import { controls, storage, volumeRow, powerButton, inputsRow, withControls, column } from "${API}";
let heard = [];
controls.onChange((c) => { heard.push(c); storage.set("heard", heard); });
let on = true;
await controls.publish("volume", { device: "Box", level: 0.9 });
await controls.publish("power", { device: "Box", on });
export default {
  palettes: {
    remote: {
      title: "Remote",
      view: async () => {
        const [v, p, i] = await Promise.all([controls.get("volume"), controls.get("power"), controls.get("inputs")]);
        const nodes = [volumeRow(v, 400, { device: "Box" }), powerButton(p, 36, { labels: true }), inputsRow(i, 400)].filter(Boolean);
        return withControls({ id: "remote", tree: column(nodes, { key: "root" }), actions: [{ id: "controls:volume:step:1", title: "Volume up", shortcut: "=" }], keys: "actions" });
      },
      pick: async (_id, action, ctx) => {
        if (await controls.act(action ?? "", ctx)) return { keep: true };
        if (action === "get") return { copy: JSON.stringify(await controls.get("volume")) };
        if (action === "all") return { copy: JSON.stringify(await controls.all("volume")) };
        return {};
      },
    },
  },
  controls: { volume: { set: () => {} }, power: { set: async (o) => { on = o; await controls.publish("power", { device: "Box", on }); } } },
};
`;

/** A \`multi\` TV: runs in a worker, its instance key on what it publishes. */
const WTV = `
import { controls, instance } from "${API}";
let level = 0.5;
await controls.publish("volume", { device: instance().key, level });
export default {
  palettes: { wtv: { title: "WTV", list: () => [], pick: () => ({}) } },
  controls: { volume: { set: async (l) => { level = l; await controls.publish("volume", { device: instance().key, level }); } } },
};
`;

const get = async (host: Host, action = "get") => JSON.parse(((await host.pick("box", "remote", "remote", action)) as { copy: string }).copy);

describe("controls", () => {
  let root: Root;
  let host: Host;
  beforeAll(async () => {
    root = new Root({
      tv: { "index.ts": TV, "pal.json": manifest("tv", { controls: ["volume", "power", "inputs"], settings: [{ kind: "text", id: "device", label: "Name", default: "TV" }] }) },
      box: { "index.ts": BOX, "pal.json": manifest("box", { controls: ["volume", "power"], palettes: { remote: { title: "Remote" } } }) },
      wtv: { "index.ts": WTV, "pal.json": manifest("wtv", { multi: true, controls: ["volume"] }) },
      // Declares a control it does not handle: a load warning, not a failure.
      liar: { "index.ts": `export default { palettes: { l: { title: "L", list: () => [], pick: () => ({}) } }, controls: { brightness: { set() {} } } };`, "pal.json": manifest("liar", { controls: ["power"] }) },
    });
    host = await Host.start({ roots: [root.dir], settings: { tv: { settings: { device: "Living TV" } } }, core: { "instances.get": ({ extension }: { extension: string }) => (extension === "wtv" ? [{ key: "wtv" }] : []) } });
  });
  afterAll(() => { host.kill(); root.rm(); });

  test("ungrouped, a caller is served its own; a regroup hands its volume to the TV", async () => {
    expect((await get(host)).level).toBe(0.9);
    expect((await get(host)).provider).toEqual({ key: "box", device: "Box" });
    host.setGroups({ living: { title: "Living room", members: ["box", "tv"], volume: "tv", inputs: "tv" } });
    const v = await get(host);
    expect([v.level, v.provider]).toEqual([0.2, { key: "tv", device: "Living TV" }]);
    await host.until(() => ((stored.get("box\0heard") as unknown[]) ?? []).some((c: any) => c.provider === "" && c.mine));
  });

  test("the box's view draws the TV's volume and inputs, and its slider sets the TV's volume in the TV's own context", async () => {
    const view = (await host.request<View>("view", { extension: "box", palette: "remote" }));
    const json = JSON.stringify(view.tree);
    expect(json).toContain('"controls:volume:set"');
    expect(json).toContain('"controls:inputs:set:hdmi2"');
    expect(json).toContain("Living TV");
    expect(view.actions.map((a) => a.id)).toEqual(expect.arrayContaining(["controls:volume:step:1", "controls:volume:set", "controls:power:set:false", "controls:inputs:set:hdmi1"]));
    await host.pick("box", "remote", "remote", "controls:volume:set", { values: { value: "0.35" } });
    expect((await get(host)).level).toBe(0.35);
    await host.pick("box", "remote", "remote", "controls:volume:step:1");
    expect((await get(host)).level).toBe(0.5);
    await host.pick("box", "remote", "remote", "controls:inputs:set:hdmi2");
    expect(host.published.get("tv\0inputs")?.current).toBe("hdmi2");
    const heard = stored.get("box\0heard") as { control: string; provider: string; mine: boolean }[];
    expect(heard.some((c) => c.control === "volume" && c.provider === "tv" && c.mine)).toBe(true);
  });

  test("power in a group is every member's, and a provider's error comes back to the caller", async () => {
    await host.pick("box", "remote", "remote", "controls:power:set:false");
    expect(stored.get("tv\0power")).toBe(false);
    expect(host.published.get("box\0power")?.on).toBe(false);
    const view = await host.request<View>("view", { extension: "box", palette: "remote" });
    expect(JSON.stringify(view.tree)).toContain('"controls:power:set:true"');
    await expect(host.pick("box", "remote", "remote", "controls:inputs:set:nope")).rejects.toThrow("no such input");
  });

  test("a multi provider answers from its worker; all lists every provider", async () => {
    host.setGroups({ living: { members: ["box", "wtv"], volume: "wtv" } });
    await host.pick("box", "remote", "remote", "controls:volume:set", { values: { value: "0.8" } });
    const v = await get(host);
    expect([v.level, v.provider.key]).toEqual([0.8, "wtv"]);
    expect((await get(host, "all")).map((s: Served<"volume">) => s.provider.key).sort()).toEqual(["box", "tv", "wtv"]);
    host.setGroups({});
    expect((await get(host)).provider.key).toBe("box");
  });

  test("the manifest and the code disagreeing is a warning both ways", async () => {
    const liar = (await host.hello()).extensions.find((e) => e.name === "liar")!;
    expect(liar.loaded).toBe(true);
    expect(liar.warnings.join("\n")).toContain('"power" is declared in pal.json but');
    expect(liar.warnings.join("\n")).toContain('handles "brightness", which is not a control');
    expect(checkControls({ name: "x", title: "x", controls: ["volume"] }, { palettes: {}, controls: { volume: { set() {} } } })).toEqual([]);
  });
});

describe("control components", () => {
  const vol = (s: Partial<Served<"volume">>): Served<"volume"> => ({ provider: { key: "tv", device: "Living TV" }, ...s });

  test("nothing for a control nobody serves; the parts pass checkView once withControls declares their actions", () => {
    expect(volumeRow(null, 400)).toBeUndefined();
    expect(powerButton(undefined, 36)).toBeUndefined();
    expect(inputsRow(vol({}) as never, 400)).toBeUndefined();
    const tree = { type: "stack" as const, key: "r", children: [volumeRow(vol({ level: 0.4 }), 400)!, volumeButton(vol({}), -1, 36)!, powerButton({ provider: { key: "tv" }, on: false }, 36, { labels: true })!, inputsRow({ provider: { key: "tv" }, list: [{ id: "a:b", name: "HDMI 1" }], current: "a:b" }, 400)!] };
    const bare: View = { tree, actions: [] };
    expect(() => checkView(bare)).toThrow("is none of the view's actions");
    const v = checkView(withControls(bare));
    expect(v.actions.map((a) => [a.id, a.title])).toEqual([["controls:volume:mute", "Mute"], ["controls:volume:set", "Set volume"], ["controls:volume:step:-1", "Volume down"], ["controls:power:set:true", "Wake up"], ["controls:inputs:set:a:b", "Switch input to a:b"]]);
    expect(JSON.stringify(tree)).toContain("Living TV");
    expect(JSON.stringify(volumeRow(vol({ level: 0.4 }), 400, { device: "Living TV" }))).not.toContain("Living TV");
    expect(JSON.stringify(volumeRow(vol({}), 400))).toContain("controls:volume:step:1");
  });

  test("action ids parse with the argument's colons kept", () => {
    expect(parseControlAction("controls:inputs:set:a:b")).toEqual({ control: "inputs", op: "set", arg: "a:b" });
    expect(parseControlAction("controls:volume:set")).toEqual({ control: "volume", op: "set" });
    expect(parseControlAction("controls:brightness:set")).toBeUndefined();
    expect(parseControlAction("volume-up")).toBeUndefined();
  });
});
