// Audio devices over the core's audio capability: one row per output and
// per input (sections Output / Input), the default tagged, the volume as
// an accessory. Enter makes the row the default for its direction; the
// other actions set a preset volume (a pushed level with 0/25/50/75/100)
// or toggle mute without leaving the palette. Live: the defaults and
// volumes are read again on every show.
import { audio, errorMessage, failed, hint, xdg, type Accessory, type Action, type AudioDevice, type BarItem, type Ctx, type Effect, type Extension, type Item } from "@zcag/pal";

export const PRESETS = [0, 25, 50, 75, 100];

/** A row id is `kind:id`, since a headset is one device in both directions. */
const rowId = (d: Pick<AudioDevice, "kind" | "id">) => `${d.kind}:${d.id}`;
const parse = (row: string): { kind: AudioDevice["kind"]; id: string } => {
  const i = row.indexOf(":");
  return { kind: row.slice(0, i) as AudioDevice["kind"], id: row.slice(i + 1) };
};

const MIC = "\u{f036c}"; // md-microphone
const MIC_MUTED = "\u{f036d}";
const MIC_OFF = "\u{f036e}";
const VOLUME = { low: "\u{f057f}", high: "\u{f075d}", muted: "\u{f075f}", headphones: "\u{f08c3}" };
const BAR_MENU = { palette: "audio" } as const;
const VOLUME_STEP = 5;

function icon(d: AudioDevice): string {
  if (d.kind === "input") return MIC;
  if (d.transport === "bluetooth") return xdg("audio-headphones")!;
  return xdg("audio-speakers")!;
}

function item(d: AudioDevice): Item {
  const dir = d.kind === "output" ? "Output" : "Input";
  const accessories: Accessory[] = [];
  if (d.muted) accessories.push({ tag: "muted", color: "amber" });
  if (d.volume !== null) accessories.push({ text: `${d.volume}%` });
  if (d.default) accessories.push({ tag: "default", color: "green" });
  const actions: Action[] = [{ id: "default", title: `Set as ${d.kind}` }, { id: "volume", title: "Set volume…", shortcut: "cmd+shift+v" }];
  if (d.muted !== null) actions.push({ id: "mute", title: d.muted ? "Unmute" : "Mute", shortcut: "cmd+m" });
  return {
    id: rowId(d),
    name: d.name,
    subtitle: d.transport ? `${dir} · ${d.transport}` : dir,
    icon: icon(d),
    keywords: [d.kind, ...(d.transport ? [d.transport] : [])],
    accessories,
    actions,
    section: dir,
  };
}

const defaultDevice = async (kind: AudioDevice["kind"]) => (await audio.devices()).find((d) => d.kind === kind && d.default);

function outputBar(d: AudioDevice | undefined): BarItem {
  if (!d) return { hidden: true };
  const muted = d.muted === true;
  const icon = muted ? VOLUME.muted : d.transport === "bluetooth" ? VOLUME.headphones : (d.volume ?? 0) < 34 ? VOLUME.low : VOLUME.high;
  return {
    icon,
    title: d.volume === null ? undefined : `${d.volume}%`,
    color: muted ? "muted" : undefined,
    icon_size: 18,
    icon_width: 31,
    tooltip: `${d.name}${muted ? ", muted" : d.volume === null ? "" : ` · ${d.volume}%`}`,
    click: "open",
    scroll: { up: "up", down: "down" },
    menu: BAR_MENU,
  };
}

/** The main volume strip, or hidden when the audio backend is unavailable. */
async function renderVolume(): Promise<BarItem> {
  try { return outputBar(await defaultDevice("output")); } catch { return { hidden: true }; }
}

/** Mic only interrupts the bar when it needs attention: muted or absent. */
async function renderMic(): Promise<BarItem> {
  try {
    const d = await defaultDevice("input");
    if (!d) return { icon: MIC_OFF, color: "red", tooltip: "No input device", click: "open", menu: BAR_MENU };
    if (!d.muted) return { hidden: true };
    return { icon: MIC_MUTED, color: "red", tooltip: `${d.name}, muted`, click: "open", menu: BAR_MENU };
  } catch { return { hidden: true }; }
}

async function volumeAction(action: string): Promise<Effect> {
  try {
    const d = await defaultDevice("output");
    if (!d) return { keep: true };
    if (action === "up" || action === "down") {
      if (d.volume === null) return { keep: true };
      const volume = Math.max(0, Math.min(100, d.volume + (action === "up" ? VOLUME_STEP : -VOLUME_STEP)));
      await audio.setVolume(d.id, "output", volume);
      return { keep: true, hud: `${d.name} ${volume}%` };
    }
    const muted = await audio.setMute(d.id, "output");
    return { keep: true, hud: muted ? `${d.name} muted` : `${d.name} unmuted` };
  } catch (e) { return failed("change volume", e); }
}

async function micAction(): Promise<Effect> {
  try {
    const d = await defaultDevice("input");
    if (!d) return { keep: true };
    if (d.volume !== null) await audio.setVolume(d.id, "input", 75);
    if (d.muted) await audio.setMute(d.id, "input", false);
    return { keep: true, hud: `${d.name} at 75%` };
  } catch (e) { return failed("unmute microphone", e); }
}


/** The preset level: `args.volume` is the row the presets are for. */
async function presets(row: string): Promise<Item[]> {
  const { kind, id } = parse(row);
  const d = (await audio.devices()).find((d) => d.kind === kind && d.id === id);
  return PRESETS.map((p) => ({
    id: `${p}`,
    name: `${p}%`,
    subtitle: d?.name,
    icon: p === 0 ? xdg("audio-volume-muted")! : xdg("audio-volume-high")!,
    accessories: d?.volume === p ? [{ tag: "current", color: "green" }] : [],
    actions: [{ id: "set", title: `Set volume to ${p}%` }],
  }));
}

export default {
  palettes: {
    audio: {
      title: "Audio",
      live: true,
      placeholder: "Switch output or input, set the volume",
      list: async (_query, ctx?: Ctx) => {
        const args = ctx?.args as { volume?: string } | undefined;
        if (args?.volume) return presets(args.volume);
        try {
          return (await audio.devices()).map(item);
        } catch (e) {
          return [hint("error", "No audio devices", errorMessage(e), { icon: xdg("dialog-error")! })];
        }
      },
      pick: async (id, action, ctx?: Ctx) => {
        const args = ctx?.args as { volume?: string } | undefined;
        if (args?.volume) {
          const { kind, id: dev } = parse(args.volume);
          try {
            await audio.setVolume(dev, kind, Number(id));
          } catch (e) {
            return failed("set the volume", e);
          }
          return { hud: `Volume ${id}%` };
        }
        if (id === "hint:error") return { keep: true };
        const { kind, id: dev } = parse(id);
        switch (action) {
          case "volume":
            return { push: { extension: "audio", palette: "audio", args: { volume: id } } };
          case "mute": {
            try { await audio.setMute(dev, kind); } catch (e) { return failed("change mute", e); }
            return { keep: true };
          }
          default: {
            try { await audio.setDefault(dev, kind); } catch (e) { return failed(`set the ${kind}`, e); }
            const name = (await audio.devices().catch(() => [] as AudioDevice[])).find((d) => d.kind === kind && d.id === dev)?.name ?? dev;
            return { hud: `${kind === "output" ? "Output" : "Input"}: ${name}` };
          }
        }
      },
    },
  },
  bar: {
    volume: { render: renderVolume, onOpen: () => volumeAction("toggle"), onAction: volumeAction },
    microphone: { render: renderMic, onOpen: micAction },
  },
} satisfies Extension;
