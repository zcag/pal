// Writes app/src/gallery/shots/audio.json and bar-audio.json, the store
// screenshots' fixtures: the palette's rows and the volume item drawn
// through the host harness against canned `core/audio.*` replies (the
// devices below, made up: a MacBook's speakers, AirPods, a display's
// speakers muted, an HDMI sink with no volume control). The item's level
// is its `always` setting for the strips that show it, which is what a
// flash draws for its three seconds.
// `bun run extensions/audio/fixture.ts`, then `make shots EXT=audio`.
import type { AudioDevice } from "@zcag/pal";
import { pinClock, writeFixture } from "../../app/scripts/fixture-kit.ts";
import { Host } from "../../host/test/harness.ts";

pinClock();
const out = (id: string, name: string, volume: number | null, transport: string | null, o: Partial<AudioDevice> = {}): AudioDevice => ({ id, name, kind: "output", default: false, volume, muted: volume === null ? null : false, transport, ...o });
const inp = (id: string, name: string, volume: number, transport: string, o: Partial<AudioDevice> = {}): AudioDevice => ({ id, name, kind: "input", default: false, volume, muted: false, transport, ...o });
const DESK: AudioDevice[] = [
  out("mbp-speakers", "MacBook Pro Speakers", 56, "builtin", { default: true }),
  out("airpods", "AirPods Pro", 40, "bluetooth"),
  out("studio", "Studio Display Speakers", 80, "usb", { muted: true }),
  out("hdmi", "Living Room TV", null, "hdmi"),
  inp("mbp-mic", "MacBook Pro Microphone", 75, "builtin", { default: true }),
  inp("airpods", "AirPods Pro", 100, "bluetooth"),
  inp("usb-mic", "USB Microphone", 50, "usb"),
];
/** On a call: the AirPods are the output, the microphone muted. */
const CALL = DESK.map((d) => (d.kind === "output" ? { ...d, default: d.id === "airpods" } : d.id === "mbp-mic" ? { ...d, muted: true } : d));

let devices = DESK;
const host = await Host.bundled({ core: { "audio.devices": () => devices } });
try {
  const item = await host.render("audio", "volume");
  const flash = await host.render("audio", "volume", { reason: "load", settings: { level: "always" } });
  devices = CALL;
  const call = await host.render("audio", "volume");
  devices = DESK;
  writeFixture("bar-audio", {
    key: "audio/volume",
    title: "Volume",
    item,
    states: [{ id: "flash", item: flash }, { id: "call", item: call }],
    shots: {
      "menubar": { target: "menubar", state: "flash", caption: "On the menu bar: the speaker glyph, and the new level beside it for a moment after a change" },
      "menubar-call": { target: "menubar", state: "call", caption: "The rest of the time one glyph that says where the sound goes: headphones while the AirPods play" },
      "popover": { target: "menubar", popover: true, caption: "A click opens the popover: the output in use on a card with a slider and mute, the other outputs as rows, the input in one line" },
      "popover-call": { target: "menubar", popover: true, state: "call", caption: "On a call through the AirPods with the microphone muted: the input line says so in red" },
      "sketchybar": { target: "sketchybar", state: "flash", caption: "On sketchybar: the speaker glyph with the level as the label" },
    },
  });

  const p = host.loaded().find((l) => l.extension === "audio")!.palettes[0];
  const rows = await host.list("audio", "audio");
  const airpods = rows.find((r) => r.id === "output:airpods")!;
  writeFixture("audio", {
    palettes: { audio: { title: p.title, live: p.live, icon: p.icon, placeholder: p.placeholder, items: rows } },
    // Set volume with nothing typed: the extension's own form.
    effects: { [`audio/${airpods.id}:volume`]: await host.pick("audio", "audio", airpods.id, "volume") },
    shots: {
      "1-devices": { palette: "audio", keys: ["down"], caption: "Outputs and inputs in two sections, the defaults tagged, a muted device marked, the volume on the right" },
      "2-actions": { palette: "audio", keys: ["down", "cmd+k"], caption: "What a device can do: make it the output, set its volume, mute it" },
      "3-volume": { palette: "audio", keys: ["down", "cmd+shift+v", "type:35"], caption: "Set volume with nothing typed in the bar asks for the percent here, 0 to 100" },
    },
  });
  console.log("audio.json, bar-audio.json: speakers at 56% with the level up, a call on AirPods with the microphone muted");
} finally {
  host.kill();
}
