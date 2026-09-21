// audio against canned core/audio.* replies.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { tile } from "../../../sdk/src/icon.ts";
import type { AudioDevice } from "../../../sdk/src/index.ts";
import type { View, ViewNode } from "../../../sdk/src/protocol.ts";
import { Host } from "../harness.ts";

const walk = (n: ViewNode): ViewNode[] => [n, ...(n.type === "stack" ? n.children.flatMap(walk) : [])];
const texts = (v: View) => walk(v.tree).flatMap((n) => (n.type === "text" ? [n.value] : n.type === "badge" ? [`[${n.text}]`] : []));
const keycaps = (v: View) => walk(v.tree).flatMap((n) => (n.type === "keycap" ? [n.keys] : []));
const viewOf = (x: unknown): View => {
  const v = (x as { view?: View; menu?: { view?: View } }).view ?? (x as { menu?: { view?: View } }).menu?.view;
  if (!v) throw new Error("no view");
  return v;
};

let devices: AudioDevice[] = [
  { id: "BuiltInSpeakerDevice", name: "MacBook Pro Speakers", kind: "output", default: true, volume: 56, muted: false, transport: "builtin" },
  { id: "20-18-5B:output", name: "HK Aura Studio 4", kind: "output", default: false, volume: 25, muted: true, transport: "bluetooth" },
  { id: "Digital", name: "Optical Out", kind: "output", default: false, volume: null, muted: null, transport: null },
  { id: "BuiltInMicrophoneDevice", name: "MacBook Pro Microphone", kind: "input", default: true, volume: 57, muted: false, transport: "builtin" },
];
const calls: { method: string; params: any }[] = [];
let host: Host;
beforeAll(async () => {
  host = await Host.bundled({
    core: {
      "audio.devices": () => devices,
      "audio.set_default": (p) => { calls.push({ method: "set_default", params: p }); devices = devices.map((d) => ({ ...d, default: d.kind === p.kind ? d.id === p.id : d.default })); return null; },
      "audio.set_volume": (p) => { if (p.id === "Digital") throw new Error("Digital has no volume control"); calls.push({ method: "set_volume", params: p }); return null; },
      "audio.set_mute": (p) => { calls.push({ method: "set_mute", params: p }); return true; },
    },
  });
});
afterAll(() => host.kill());

const list = (args?: unknown) => host.list("audio", "audio", undefined, args ? { args } : undefined);
const pick = (id: string, action?: string, args?: unknown) => host.pick("audio", "audio", id, action, args ? { args } : undefined);

describe("audio", () => {
  test("meta: live", () => {
    const loaded = host.loaded().find((l) => l.extension === "audio")!;
    expect(loaded.palettes).toEqual([{ name: "audio", title: "Audio", live: true, input: false, icon: tile("violet", "\u{f057e}"), placeholder: "Switch output or input, set the volume" }]);
    expect(loaded.bar).toMatchObject([{ id: "volume", title: "Volume", refresh: { every: 5, on: ["wake"] }, keys: expect.any(Array), mocks: { muted: { item: { color: "muted" } } }, source: true }, { id: "microphone", title: "Microphone", refresh: { every: 5, on: ["wake"] }, keys: expect.any(Array), mocks: { normal: { item: { hidden: true } } }, source: true }]);
  });

  test("bar: volume controls the default output directly, scroll adjusts it, and the mic appears only while muted", async () => {
    // 56%: the middle of the ramp, and no number — the level is not furniture.
    // No `click: "open"`: a click on the strip only opens the popover, it never toggles mute on its own.
    expect(await host.render("audio", "volume")).toMatchObject({ icon: "\u{f0580}", icon_size: 18, icon_width: 31, scroll: { up: "up", down: "down" } });
    expect((await host.render("audio", "volume")).click).toBeUndefined();
    expect((await host.render("audio", "volume")).title).toBeUndefined();
    expect(await host.render("audio", "microphone")).toEqual({ hidden: true });
    expect(await host.barAction("audio", "volume", "up")).toEqual({ keep: true, hud: "MacBook Pro Speakers 61%" });
    devices = devices.map((d) => d.kind === "input" ? { ...d, muted: true } : d);
    expect(await host.render("audio", "microphone")).toMatchObject({ icon: "\u{f036d}", color: "red", click: "open" });
    expect(await host.request<any>("bar/open", { extension: "audio", id: "microphone" })).toEqual({ keep: true, hud: "MacBook Pro Microphone at 75%" });
    devices = devices.map((d) => d.kind === "input" ? { ...d, muted: false } : d);
  });

  test("bar_show_microphone: muted leaves a missing input quiet, always keeps a live mic as a muted glyph whose click opens the popover; bar_show_volume at always keeps a muted glyph with no output", async () => {
    const saved = devices;
    try {
      host.changeSettings("audio", { settings: { level: "flash", bar_show_microphone: "always" } });
      const live = await host.render("audio", "microphone");
      expect(live).toMatchObject({ icon: "\u{f036c}", color: "muted", tooltip: "MacBook Pro Microphone · 57%" });
      expect(live.click).toBeUndefined();
      expect(viewOf(live)).toMatchObject({ id: "microphone", title: "Input: MacBook Pro Microphone" });
      devices = devices.filter((d) => d.kind !== "input");
      expect(await host.render("audio", "microphone")).toMatchObject({ icon: "\u{f036e}", color: "red", tooltip: "No input device" });
      host.changeSettings("audio", { settings: { level: "flash", bar_show_microphone: "muted" } });
      expect(await host.render("audio", "microphone")).toEqual({ hidden: true });
      devices = saved.map((d) => d.kind === "input" ? { ...d, muted: true } : d);
      expect(await host.render("audio", "microphone")).toMatchObject({ icon: "\u{f036d}", color: "red", click: "open" });
      devices = saved.filter((d) => d.kind !== "output");
      expect(await host.render("audio", "volume")).toEqual({ hidden: true });
      host.changeSettings("audio", { settings: { level: "flash", bar_show_volume: "always" } });
      const none = await host.render("audio", "volume");
      expect(none).toMatchObject({ icon: "\u{f075f}", color: "muted", tooltip: "No output device" });
      expect(viewOf(none)).toMatchObject({ id: "volume", title: "No output" });
    } finally {
      devices = saved;
      host.changeSettings("audio", { settings: { level: "flash" } });
    }
  });

  test("the popover: the output in use on a card with a slider and a mute switch, the others as rows, the input in a line; the keys act on the default, the cursor on a row", async () => {
    const v = viewOf(await host.render("audio", "volume"));
    expect(v).toMatchObject({ id: "volume", title: "Output: MacBook Pro Speakers", keys: "actions" });
    const t = texts(v);
    // The card: the device in use, what it is, its level.
    expect(t).toContain("MacBook Pro Speakers");
    expect(t).toContain("builtin · 56%");
    expect(t).toContain("56%");
    // The rows: the outputs you could switch to, not the one you are on.
    expect(t).toContain("HK Aura Studio 4");
    expect(t).toContain("Optical Out");
    // The other direction gets one line, so the popover is the whole picture.
    expect(t).toContain("Input: MacBook Pro Microphone");
    const slider = walk(v.tree).find((n) => n.type === "slider")!;
    expect(slider).toMatchObject({ value: 0.56, color: "green", action: "set" });
    expect(walk(v.tree).find((n) => n.type === "switch")).toMatchObject({ on: true, action: "mute" });
    expect(keycaps(v)).toEqual(["up", "down", "enter", "m", "-", "+", "0…4", "p"]);
    expect(v.actions.filter((a) => !a.hidden).map((a) => a.id)).toEqual(["use", "mute", "up", "down", "open-pal"]);
    expect(v.actions.filter((a) => a.id.startsWith("focus:")).map((a) => a.id)).toEqual(["20-18-5B:output", "Digital"].map((x) => `focus:${x}`));

    // A click anywhere along the slider sets that point: the fraction rides in ctx.values.
    expect(await host.barAction("audio", "volume", "set", { reason: "open", values: { value: "0.25" } })).toMatchObject({ view: { id: "volume" } });
    expect(calls.at(-1)).toEqual({ method: "set_volume", params: { id: "BuiltInSpeakerDevice", kind: "output", volume: 25 } });
    // A digit is a preset, and it redraws rather than leaving an HUD, because the popover is up.
    expect(await host.barAction("audio", "volume", "preset:75")).toMatchObject({ view: { id: "volume" } });
    expect(calls.at(-1)).toEqual({ method: "set_volume", params: { id: "BuiltInSpeakerDevice", kind: "output", volume: 75 } });

    // The cursor opens on the first row rather than on the card, so Enter already means "use this instead".
    expect(v.actions[0]).toEqual({ id: "use", title: "Use HK Aura Studio 4 as output" });
    expect(viewOf(await host.barAction("audio", "volume", "next")).actions[0]).toEqual({ id: "use", title: "Use Optical Out as output" });
    expect(await host.barAction("audio", "volume", "prev")).toMatchObject({ view: { id: "volume" } });
    expect(await host.barAction("audio", "volume", "use")).toMatchObject({ hud: "Output: HK Aura Studio 4" });
    expect(calls.at(-1)).toEqual({ method: "set_default", params: { id: "20-18-5B:output", kind: "output" } });
    expect(await host.barAction("audio", "volume", "open-pal")).toEqual({ push: { extension: "audio", palette: "audio" } });
    devices = devices.map((d) => d.kind === "output" ? { ...d, default: d.id === "BuiltInSpeakerDevice" } : d);
  });

  test("the microphone popover is the same shape the other way round, and a device with no level gets no dead slider", async () => {
    devices = devices.map((d) => d.kind === "input" ? { ...d, muted: true } : d);
    const v = viewOf(await host.render("audio", "microphone"));
    expect(v).toMatchObject({ id: "microphone", title: "Input: MacBook Pro Microphone" });
    expect(texts(v)).toContain("builtin · muted · 57%");
    // Muted: the slider reads empty and the switch is off, whatever the level underneath.
    expect(walk(v.tree).find((n) => n.type === "slider")).toMatchObject({ value: 0, color: "grey" });
    expect(walk(v.tree).find((n) => n.type === "switch")).toMatchObject({ on: false });
    expect(texts(v)).toContain("Output: MacBook Pro Speakers");
    expect(await host.barAction("audio", "microphone", "mute")).toMatchObject({ hud: "MacBook Pro Microphone muted" });
    expect(calls.at(-1)).toEqual({ method: "set_mute", params: { id: "BuiltInMicrophoneDevice", kind: "input" } });
    devices = devices.map((d) => d.kind === "input" ? { ...d, muted: false } : d);

    // Optical Out reports no level at all; its card is the switch alone rather than a slider stuck at zero.
    const saved = devices;
    devices = devices.map((d) => d.kind === "output" ? { ...d, default: d.id === "Digital" } : d);
    const noLevel = viewOf(await host.render("audio", "volume"));
    expect(walk(noLevel.tree).some((n) => n.type === "slider")).toBe(false);
    expect(walk(noLevel.tree).some((n) => n.type === "switch")).toBe(false);
    expect(keycaps(noLevel)).toEqual(["up", "down", "enter", "p"]);
    devices = saved;
  });

  test("the level is feedback, not furniture: Always keeps it, Never refuses it, and a flash collapses on its own", async () => {
    // Never: not even straight after a change.
    host.changeSettings("audio", { settings: { level: "never" } });
    await host.barAction("audio", "volume", "up");
    expect((await host.render("audio", "volume")).title).toBeUndefined();
    host.changeSettings("audio", { settings: { level: "always" } });
    expect((await host.render("audio", "volume")).title).toBe("56%");
    // Flash: quiet again once an earlier one has lapsed, up on a change, gone by itself after.
    host.changeSettings("audio", { settings: { level: "flash" } });
    await Bun.sleep(4500);
    expect((await host.render("audio", "volume")).title).toBeUndefined();
    await host.barAction("audio", "volume", "down");
    expect((await host.render("audio", "volume")).title).toBe("56%");
    await Bun.sleep(4500);
    expect((await host.render("audio", "volume")).title).toBeUndefined();
  }, 20000);

  test("the glyph says where the sound goes, and only falls through to the ramp when nothing else does", async () => {
    const glyph = async (patch: Partial<AudioDevice>) => {
      const saved = devices;
      devices = devices.map((d) => d.default && d.kind === "output" ? { ...d, ...patch } : d);
      try { return (await host.render("audio", "volume")).icon; } finally { devices = saved; }
    };
    expect(await glyph({ volume: 80 })).toBe("\u{f057e}");
    expect(await glyph({ volume: 12 })).toBe("\u{f057f}");
    // Silent is the same fact as muted, not the bottom of the ramp.
    expect(await glyph({ volume: 0 })).toBe("\u{f075f}");
    expect(await glyph({ muted: true, volume: 80 })).toBe("\u{f075f}");
    expect(await glyph({ transport: "bluetooth", volume: 80 })).toBe("\u{f08c3}");
    expect(await glyph({ transport: "hdmi", volume: 80 })).toBe("\u{f04c3}");
  });

  test("rows per direction with default and muted tags, the volume, and the actions", async () => {
    const items = await list();
    expect(items.map((i) => i.id)).toEqual(["output:BuiltInSpeakerDevice", "output:20-18-5B:output", "output:Digital", "input:BuiltInMicrophoneDevice"]);
    expect(items[0]).toMatchObject({ name: "MacBook Pro Speakers", subtitle: "Output · builtin", section: "Output", accessories: [{ text: "56%" }, { tag: "default", color: "green" }] });
    expect(items[0].actions!.map((a) => a.id)).toEqual(["default", "volume", "mute"]);
    expect(items[0].actions![0].title).toBe("Set as output");
    expect(items[1].accessories).toEqual([{ tag: "muted", color: "amber" }, { text: "25%" }]);
    expect(items[1].actions!.find((a) => a.id === "mute")!.title).toBe("Unmute");
    // No volume control: no accessory and no Mute action.
    expect(items[2].accessories).toEqual([]);
    expect(items[2].actions!.map((a) => a.id)).toEqual(["default", "volume"]);
    expect(items[3]).toMatchObject({ section: "Input", subtitle: "Input · builtin" });
    expect(items[3].actions![0].title).toBe("Set as input");
  });

  test("Enter sets the default for the row's direction and says so in the HUD", async () => {
    expect(await pick("output:20-18-5B:output")).toEqual({ hud: "Output: HK Aura Studio 4" });
    expect(calls.at(-1)).toEqual({ method: "set_default", params: { id: "20-18-5B:output", kind: "output" } });
    expect(await pick("input:BuiltInMicrophoneDevice", "default")).toEqual({ hud: "Input: MacBook Pro Microphone" });
    expect(calls.at(-1)!.params).toEqual({ id: "BuiltInMicrophoneDevice", kind: "input" });
  });

  test("mute toggles through the core and keeps the palette", async () => {
    expect(await pick("output:BuiltInSpeakerDevice", "mute")).toEqual({ keep: true });
    expect(calls.at(-1)).toEqual({ method: "set_mute", params: { id: "BuiltInSpeakerDevice", kind: "output" } });
  });

  test("volume pushes a preset level for the row; a preset sets it", async () => {
    expect(await pick("output:20-18-5B:output", "volume")).toEqual({ push: { extension: "audio", palette: "audio", args: { volume: "output:20-18-5B:output" } } });
    const presets = await list({ volume: "output:20-18-5B:output" });
    expect(presets.map((i) => i.name)).toEqual(["0%", "25%", "50%", "75%", "100%"]);
    expect(presets[1]).toMatchObject({ subtitle: "HK Aura Studio 4", accessories: [{ tag: "current", color: "green" }] });
    expect(presets[2].accessories).toEqual([]);
    expect(await pick("75", "set", { volume: "output:20-18-5B:output" })).toEqual({ hud: "Volume 75%" });
    expect(calls.at(-1)).toEqual({ method: "set_volume", params: { id: "20-18-5B:output", kind: "output", volume: 75 } });
  });

  test("a core refusal is a failure toast, palette kept", async () => {
    expect(await pick("50", "set", { volume: "output:Digital" })).toEqual({ keep: true, toast: { title: "Could not set the volume", message: "Digital has no volume control", style: "failure" } });
  });

  test("no backend: one inert row that says why", async () => {
    const h = await Host.bundled({ core: { "audio.devices": () => { throw new Error("neither wpctl nor pactl is installed"); } } });
    try {
      const items = await h.list("audio", "audio");
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ id: "hint:error", name: "No audio devices", subtitle: "neither wpctl nor pactl is installed", actions: [] });
      expect(await h.pick("audio", "audio", "hint:error")).toEqual({ keep: true });
    } finally {
      h.kill();
    }
  });
});
