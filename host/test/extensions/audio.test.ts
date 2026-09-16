// audio against canned core/audio.* replies.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { AudioDevice } from "../../../sdk/src/index.ts";
import { Host } from "../harness.ts";

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
    expect(host.loaded().find((l) => l.extension === "audio")!.palettes).toEqual([{ name: "audio", title: "Audio", live: true, input: false, icon: "♫", placeholder: "Switch output or input, set the volume" }]);
  });

  test("rows per direction with default and muted tags, the volume, and the actions", async () => {
    const items = await list();
    expect(items.map((i) => i.id)).toEqual(["output:BuiltInSpeakerDevice", "output:20-18-5B:output", "output:Digital", "input:BuiltInMicrophoneDevice"]);
    expect(items[0]).toMatchObject({ name: "MacBook Pro Speakers", subtitle: "Output · builtin", section: "Output", accessories: [{ text: "56%" }, { tag: "default", color: "green" }] });
    expect(items[0].actions!.map((a) => a.id)).toEqual(["default", "volume", "mute"]);
    expect(items[0].actions![0].title).toBe("Set as Output");
    expect(items[1].accessories).toEqual([{ tag: "muted", color: "amber" }, { text: "25%" }]);
    expect(items[1].actions!.find((a) => a.id === "mute")!.title).toBe("Unmute");
    // No volume control: no accessory and no Mute action.
    expect(items[2].accessories).toEqual([]);
    expect(items[2].actions!.map((a) => a.id)).toEqual(["default", "volume"]);
    expect(items[3]).toMatchObject({ section: "Input", subtitle: "Input · builtin" });
    expect(items[3].actions![0].title).toBe("Set as Input");
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
      expect(items[0]).toMatchObject({ id: "error", name: "No audio devices", subtitle: "neither wpctl nor pactl is installed", actions: [] });
      expect(await h.pick("audio", "audio", "error")).toEqual({ keep: true });
    } finally {
      h.kill();
    }
  });
});
