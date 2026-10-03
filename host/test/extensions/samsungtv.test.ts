// Samsung TV over the host against the stand-in TV (extensions/samsungtv/
// fake.ts: the TV's state is a JSON file this test writes, every command a
// line in a log it reads back): the palettes and the bar item before
// anything is paired, the guided setup (discovery, Allow, the check of what
// works), the remote's keys and what each sends, the volume, power and
// inputs as controls (published, run through pal, and rebound by a group to
// another device's volume), typing while the TV shows its keyboard, a
// change on the TV pushed into the open remote and the bar item, the apps
// and the dock, the root commands, and the links.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { iconData, letterTile, sampleApp } from "../../../extensions/samsungtv/art.ts";
import type { FakeTv } from "../../../extensions/samsungtv/fake.ts";
import { dpad, positionAt, render as renderRemote, type RemoteState } from "../../../extensions/samsungtv/remote.ts";
import { render as renderSetup } from "../../../extensions/samsungtv/setup.ts";
import type { Served, View } from "../../../sdk/src/protocol.ts";
import { checkView } from "../../../sdk/src/view.ts";
import { Host, bundledIcon, logLines, stored } from "../harness.ts";

const E = "samsungtv";
const LIVING = { id: "uuid:32ed4ce1-0d5b-41e6-a3c1-dc1a43af0e94", name: "75\" Neo QLED", address: "192.168.1.31", model: "QE75QN85DBTXTK", mac: "F4:DD:06:41:3A:4C", power: "on" as const, tokenAuth: true };
const BEDROOM = { id: "uuid:9a0c7e11-2b3f-4c8a-8e61-6d2f1b0c9e42", name: "Bedroom", address: "192.168.1.52", model: "UE50CU7172UXXH", power: "standby" as const, tokenAuth: true };
const APPS = [
  { id: "111299001912", name: "YouTube" },
  { id: "3201606009684", name: "Spotify" },
  { id: "3202010022079", name: "Internet" },
];
const TV: FakeTv = { found: [LIVING, BEDROOM], token: "11122233", power: "on", volume: 10, muted: false, apps: APPS, front: "111299001912", keyboard: { open: false } };

const provider = { key: E, device: "Living Room" };
const served = { volume: { device: "Living Room", level: 0.1, muted: false, provider } as Served<"volume">, power: { device: "Living Room", on: true, provider } as Served<"power">, inputs: { device: "Living Room", list: [{ id: "hdmi", name: "Next HDMI" }, { id: "source", name: "Input menu" }], provider } as Served<"inputs"> };

describe("pure parts", () => {
  const base: RemoteState = { layout: "wide", conn: "up", power: "on", device: { name: "Living Room", model: "QE75QN85DBTXTK" }, dock: APPS.map((a, i) => ({ ...a, art: letterTile(a.name), front: i === 0 })), volume: served.volume, powerSlot: served.power, inputs: served.inputs, keyboard: { open: false } };
  test("the remote's trees pass the host's checks in every state and layout; a flash lights only its cell", () => {
    for (const st of [base, { ...base, layout: "compact" as const }, { ...base, unpaired: true }, { ...base, conn: "down" as const, error: "No route", wakeable: true }, { ...base, conn: "connecting" as const }, { ...base, power: "standby" as const }, { ...base, keyboard: { open: true, text: "ha" }, typing: true }, { ...base, media: { state: "playing" as const, title: "Clip", position: 10, duration: 100, at: 0 }, position: 12 }, { ...base, volume: null, powerSlot: null, inputs: null }]) {
      expect(() => checkView(renderRemote(st), "remote")).not.toThrow();
    }
    const lit = JSON.stringify(dpad({ ...base, flash: "left" }, 176));
    expect(lit.match(/#4F8AE866/g)).toHaveLength(1);
  });
  test("the control parts are drawn from what is served, their keys spelled as controls; typing only while the TV shows its keyboard", () => {
    const v = renderRemote(base);
    const ids = v.actions.map((a) => a.id);
    expect(ids).toEqual(expect.arrayContaining(["controls:volume:step:1", "controls:volume:step:-1", "controls:volume:mute", "controls:power:set", "controls:volume:set", "controls:inputs:set:hdmi"]));
    expect(v.actions.find((a) => a.id === "controls:volume:step:1")?.shortcut).toEqual(["=", "+"]);
    expect(ids).not.toContain("type");
    expect(v.input).toBeUndefined();
    const open = renderRemote({ ...base, keyboard: { open: true }, typing: true });
    expect(open.actions.map((a) => a.id)).toContain("type");
    expect(open.input).toMatchObject({ submit: "type:send", cancel: "type:cancel" });
    // Nobody serves the volume: no row, no keys for it.
    expect(renderRemote({ ...base, volume: null }).actions.map((a) => a.id)).not.toContain("controls:volume:step:1");
  });
  test("the setup's trees pass the checks; the Allow step counts down", () => {
    for (const st of [{ phase: "find", scanning: true }, { phase: "find", scanning: false, error: "x" }, { phase: "allow", device: LIVING, until: 35_000 }, { phase: "checking", device: LIVING }, { phase: "failed", device: LIVING, error: "Denied", hint: "y" }] as const) {
      expect(() => checkView(renderSetup(st as never, [LIVING], [], undefined, 0), "setup")).not.toThrow();
    }
    expect(JSON.stringify(renderSetup({ phase: "allow", device: LIVING, until: 20_000 }, [], [], undefined, 0).tree)).toContain("20 s");
    expect(renderSetup({ phase: "find", scanning: false }, [], [], "").input).toMatchObject({ submit: "pair:typed" });
  });
  test("pictures: an app's tile keeps its colour, the TV's icon bytes by their magic, the store's invented apps", () => {
    expect(letterTile("YouTube")).toEqual(letterTile("YouTube"));
    expect(decodeURIComponent(letterTile("youtube"))).toContain(">Y</text>");
    expect(iconData(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toMatch(/^data:image\/png;base64,/);
    expect(iconData(new Uint8Array([0xff, 0xd8, 0xff]))).toMatch(/^data:image\/jpeg;base64,/);
    expect(iconData(new Uint8Array([1, 2, 3]))).toBeUndefined();
    expect(sampleApp("3201900000001")).toContain("data:image/svg+xml");
    expect(positionAt({ state: "playing", position: 10, at: 1000, duration: 100 }, 6000)).toBe(15);
  });
});

describe("over the host against the stand-in TV", () => {
  let host: Host;
  const dir = mkdtempSync(join(tmpdir(), "pal-samsungtv-"));
  const tvFile = join(dir, "tv.json");
  /** Change the TV: written whole and renamed into place, so the fake never reads half a file. */
  const setTv = (f: (tv: FakeTv) => void) => { const tv = JSON.parse(readFileSync(tvFile, "utf8")) as FakeTv; f(tv); writeFileSync(`${tvFile}.tmp`, JSON.stringify(tv)); renameSync(`${tvFile}.tmp`, tvFile); };
  const tvNow = () => JSON.parse(readFileSync(tvFile, "utf8")) as FakeTv;
  const log = () => logLines(join(dir, "log")).map((l) => JSON.parse(l) as Record<string, unknown>);
  const ops = (op: string) => log().filter((l) => l.op === op);
  const view = (palette: string) => host.request<View>("view", { extension: E, palette });
  const text = (v: { tree: unknown }) => JSON.stringify(v.tree);
  const pick = (palette: string, action: string, values?: Record<string, string>) => host.pick(E, palette, palette === "setup" ? "setup" : "remote", action, values ? { values } : undefined);
  const pub = (control: string) => host.published.get(`${E}\0${control}`);

  beforeAll(async () => {
    writeFileSync(tvFile, JSON.stringify(TV));
    process.env.PAL_SAMSUNGTV_FAKE = dir;
    host = await Host.bundled({ only: [E], settings: { [E]: { settings: { stay: false } } } });
  });
  afterAll(() => { host.kill(); delete process.env.PAL_SAMSUNGTV_FAKE; rmSync(dir, { recursive: true, force: true }); });

  test("loads with four palettes, the bar item, six links and the four controls, no warnings", () => {
    const l = host.loaded().find((x) => x.extension === E)!;
    expect(l.warnings).toEqual([]);
    expect(l.palettes.map((p) => p.name)).toEqual(["remote", "apps", "commands", "setup"]);
    expect(l.palettes.find((p) => p.name === "remote")).toMatchObject({ view: "view", icon: bundledIcon(E) });
    expect(l.palettes.find((p) => p.name === "commands")).toMatchObject({ tier: "primary" });
    expect(l.bar?.map((b) => b.id)).toEqual(["tv"]);
    expect(Object.keys(l.manifest.links!).sort()).toEqual(["input", "key", "launch", "power", "type", "volume"]);
    expect(l.manifest.controls).toEqual(["volume", "power", "inputs", "player"]);
  });

  test("nothing paired: the lists are the setup row, the remote is the welcome, the bar item hides", async () => {
    for (const p of ["apps", "commands"]) expect((await host.list(E, p)).map((i) => i.id)).toEqual(["setup"]);
    const v = await view("remote");
    expect(text(v)).toContain("Control your Samsung TV from here");
    expect(v.actions[0]).toMatchObject({ id: "setup" });
    expect(await host.render(E, "tv")).toEqual({ hidden: true });
  });

  test("setup: finds both TVs, Allow on the TV, then the check; the token and the MAC are kept", async () => {
    await view("setup");
    await host.until(() => ops("scan").length > 0, 2000, "a scan");
    await host.until(async () => text(await view("setup")).includes("Bedroom"), 2000, "the list");
    const found = await view("setup");
    expect(text(found)).toContain("QE75QN85DBTXTK");
    expect(found.actions[0]).toMatchObject({ id: `pair:${LIVING.id}`, title: `Pair with ${LIVING.name}` });
    const asking = await pick("setup", `pair:${LIVING.id}`);
    expect(text(asking.view!)).toContain("Press Allow on your TV");
    await host.until(() => ops("pair").length === 1, 2000, "the pairing");
    await host.until(async () => text(await view("setup")).includes("is ready"), 3000, "ready");
    const ready = text(await view("setup"));
    expect(ready).toContain("3 apps found");
    expect(ready).toContain("10 now; the slider sets it");
    const devices = stored.get(`${E}\0devices`) as { id: string; token: string; mac?: string }[];
    expect(devices).toEqual([expect.objectContaining({ id: LIVING.id, token: "11122233", mac: LIVING.mac })]);
    await host.until(() => host.written.get(E)?.device === LIVING.name, 2000, "the device setting");
    expect(await pick("setup", "remote")).toEqual({ push: { extension: E, palette: "remote" } });
  });

  test("the controls are published: the volume as 0..1, power, the inputs, what is on", async () => {
    await host.until(() => pub("volume")?.level === 0.1, 2000, "the volume published");
    expect(pub("volume")).toEqual({ device: LIVING.name, level: 0.1, muted: false });
    expect(pub("power")).toEqual({ device: LIVING.name, on: true });
    expect(pub("inputs")).toEqual({ device: LIVING.name, list: [{ id: "hdmi", name: "Next HDMI" }, { id: "source", name: "Input menu" }, { id: "tv", name: "TV" }] });
    expect(pub("player")).toMatchObject({ device: LIVING.name, app: "YouTube", title: "YouTube", palette: "remote" });
  });

  test("the remote: what is on, the dock; each key sends its button and lights its cell; the volume, mute, power and inputs run as controls", async () => {
    host.viewShown(E, { palette: "remote" }, "remote");
    const v = await view("remote");
    expect(v.title).toBe(`${LIVING.name} · YouTube`);
    expect(text(v)).toContain("QE75QN85DBTXTK");
    expect(v.actions[0]).toMatchObject({ id: "select", title: "OK" });
    const up = await pick("remote", "up");
    expect(text(up.view!)).toContain("#4F8AE866");
    expect(ops("key").at(-1)).toEqual({ op: "key", key: "up", press: "tap" });
    for (const [action, key] of [["back", "back"], ["home", "home"], ["play-pause", "play_pause"], ["channel-up", "channel_up"], ["menu", "menu"], ["input:next", undefined]] as const) {
      await pick("remote", action);
      if (key) await host.until(() => ops("key").at(-1)?.key === key, 2000, action);
    }
    expect(ops("input").at(-1)).toEqual({ op: "input", id: "hdmi" });
    // The control parts: through pal to whoever serves them, here the TV itself.
    await host.pick(E, "remote", "remote", "controls:volume:set", { values: { value: "0.4" } });
    await host.until(() => ops("volume").at(-1)?.level === 40, 2000, "the volume set");
    await host.until(() => pub("volume")?.level === 0.4, 2000, "the new volume published");
    await pick("remote", "controls:volume:step:1");
    await host.until(() => ops("key").at(-1)?.key === "volume_up", 2000, "a volume step");
    await pick("remote", "controls:volume:mute");
    await host.until(() => ops("mute").at(-1)?.muted === true, 2000, "muted");
    await pick("remote", "controls:inputs:set:source");
    await host.until(() => ops("input").at(-1)?.id === "source", 2000, "the input menu");
    expect(await pick("remote", "launch:0")).toMatchObject({ hud: "Opening YouTube" });
    expect(ops("launch").at(-1)).toEqual({ op: "launch", id: "111299001912" });
    expect(await pick("remote", "apps")).toEqual({ push: { extension: E, palette: "apps" } });
    setTv((tv) => { tv.muted = false; });
  });

  test("typing: offered only while the TV shows its keyboard; then the field opens by itself and Enter sends and submits", async () => {
    expect((await view("remote")).actions.map((a) => a.id)).not.toContain("type");
    setTv((tv) => { tv.keyboard = { open: true }; });
    await host.nextViewUpdate(E, { palette: "remote" }, (u) => JSON.stringify(u.spec).includes("is asking for text"));
    const open = await view("remote");
    expect(open.input).toMatchObject({ submit: "type:send", cancel: "type:cancel" });
    const sent = await pick("remote", "type:send", { input: "harbor" });
    expect(sent).toMatchObject({ hud: "Typed “harbor”" });
    expect(ops("type").at(-1)).toEqual({ op: "type", text: "harbor", done: true });
    // Escape puts the field away while the keyboard stays.
    setTv((tv) => { tv.keyboard = { open: true }; });
    await host.until(async () => !!(await view("remote")).input, 2000, "the field again");
    await pick("remote", "type:cancel");
    expect((await view("remote")).input).toBeUndefined();
    setTv((tv) => { tv.keyboard = { open: false }; });
  });

  test("a change on the TV pushes into the open remote and the bar item: another app, then standby, then on again with p", async () => {
    setTv((tv) => { tv.front = "3201606009684"; });
    await host.nextViewUpdate(E, { palette: "remote" }, (u) => JSON.stringify(u.spec).includes("Spotify"));
    expect(await host.render(E, "tv")).toMatchObject({ title: "Spotify", tooltip: `Spotify on ${LIVING.name}`, states: { power: "on", app: "Spotify" } });
    await pick("remote", "controls:power:set");
    await host.until(() => tvNow().power === "standby", 2000, "standby");
    const off = await host.nextUpdate(E, "tv", (i) => !!i.hidden);
    expect(off).toMatchObject({ hidden: true, empty: { tooltip: `${LIVING.name} is in standby` } });
    await host.until(() => pub("power")?.on === false, 2000, "power published off");
    expect(pub("volume")).toBeUndefined();
    await pick("remote", "controls:power:set:true");
    await host.until(() => tvNow().power === "on", 2000, "on again");
  });

  test("a group hands the remote's volume to another device: its row shows that device and its level", async () => {
    host.published.set("box\0volume", { device: "Soundbar", level: 0.65 });
    host.setGroups({ "living-room": { title: "Living room", members: [E, "box"], volume: "box" } });
    await host.nextViewUpdate(E, { palette: "remote" }, (u) => JSON.stringify(u.spec).includes("Soundbar"));
    const v = text(await view("remote"));
    expect(v).toContain("65%");
    host.setGroups({});
    await host.nextViewUpdate(E, { palette: "remote" }, (u) => !JSON.stringify(u.spec).includes("Soundbar"));
    host.published.delete("box\0volume");
  });

  test("apps: every app with its tile, the one on screen tagged, the dock's digits; cmd+D writes the dock; close", async () => {
    const rows = await host.list(E, "apps");
    expect(rows.map((r) => r.name)).toEqual(["Internet", "Spotify", "YouTube"]);
    expect(rows.find((r) => r.name === "Spotify")).toMatchObject({ subtitle: `On screen on ${LIVING.name}`, accessories: [{ tag: "on screen", color: "green" }, { keys: "2" }] });
    expect(rows[0].icon).toMatchObject({ image: expect.stringContaining("data:image/svg+xml") });
    expect(await host.pick(E, "apps", "3202010022079", "launch")).toMatchObject({ hud: "Opening Internet" });
    expect(await host.pick(E, "apps", "3202010022079", "quit")).toMatchObject({ hud: "Closed Internet" });
    expect(ops("quit").at(-1)).toEqual({ op: "quit", id: "3202010022079" });
    expect((await host.pick(E, "apps", "3201606009684", "dock")).toast?.title).toBe("Spotify left the dock");
    expect(host.written.get(E)?.favorites).not.toContain("Spotify");
    expect((await host.pick(E, "apps", "3201606009684", "dock")).toast).toMatchObject({ title: "Spotify is in the dock" });
  });

  test("commands at the root: the inputs, mute and power say so; the next HDMI input sends its key", async () => {
    const rows = await host.list(E, "commands");
    expect(rows.map((r) => r.id)).toEqual(expect.arrayContaining(["wake", "standby", "mute", "input:hdmi", "input:source", "input:tv"]));
    expect(rows.map((r) => r.id)).not.toContain("type");
    expect(await host.pick(E, "commands", "input:hdmi", "run")).toEqual({ hud: `${LIVING.name}: next HDMI input` });
    expect(ops("input").at(-1)).toEqual({ op: "input", id: "hdmi" });
    expect(await host.pick(E, "commands", "home", "run")).toEqual({ hud: `${LIVING.name}: Go Home` });
    await host.pick(E, "commands", "mute", "run");
    await host.until(() => ops("mute").at(-1)?.muted === true, 2000, "mute from the root");
  });

  test("links: launch by name, the volume as a number, the input, power; refusals in words", async () => {
    expect(await host.request("link", { extension: E, route: "launch", params: { app: "youtube" } })).toMatchObject({ hud: "Opening YouTube" });
    expect(ops("launch").at(-1)).toEqual({ op: "launch", id: "111299001912" });
    await host.request("link", { extension: E, route: "volume", params: { level: "25" } });
    expect(ops("volume").at(-1)).toEqual({ op: "volume", level: 25 });
    await host.request("link", { extension: E, route: "input", params: { to: "source" } });
    expect(ops("input").at(-1)).toEqual({ op: "input", id: "source" });
    await host.request("link", { extension: E, route: "key", params: { name: "KEY_INFO" } });
    expect(ops("key").at(-1)).toEqual({ op: "key", code: "KEY_INFO", press: "tap" });
    await expect(host.request("link", { extension: E, route: "launch", params: { app: "nothing" } })).rejects.toThrow(/no app "nothing"/);
    await expect(host.request("link", { extension: E, route: "type", params: { text: "hi" } })).rejects.toThrow(/no text field is open/);
    await expect(host.request("link", { extension: E, route: "input", params: { to: "hdmi3" } })).rejects.toThrow(/to is hdmi/);
    await host.request("link", { extension: E, route: "power", params: { to: "off" } });
    await host.until(() => tvNow().power === "standby", 2000, "off by link");
  });
});
