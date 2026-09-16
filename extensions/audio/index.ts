// Audio devices over the core's audio capability: one row per output and
// per input (sections Output / Input), the default tagged, the volume as
// an accessory. Enter makes the row the default for its direction; the
// other actions set a preset volume (a pushed level with 0/25/50/75/100)
// or toggle mute without leaving the palette. Live: the defaults and
// volumes are read again on every show.
import { audio, xdg, type Accessory, type Action, type AudioDevice, type Ctx, type Effect, type Extension, type Item } from "@zcag/pal";

export const PRESETS = [0, 25, 50, 75, 100];

/** A row id is `kind:id`, since a headset is one device in both directions. */
const rowId = (d: Pick<AudioDevice, "kind" | "id">) => `${d.kind}:${d.id}`;
const parse = (row: string): { kind: AudioDevice["kind"]; id: string } => {
  const i = row.indexOf(":");
  return { kind: row.slice(0, i) as AudioDevice["kind"], id: row.slice(i + 1) };
};

const MIC = "\u{f036c}"; // md-microphone

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

const failed = (what: string, e: unknown): Effect => ({ keep: true, toast: { title: `Could not ${what}`, message: String((e as Error)?.message ?? e), style: "failure" } });

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
      icon: "♫",
      live: true,
      placeholder: "Switch output or input, set the volume",
      list: async (_query, ctx?: Ctx) => {
        const args = ctx?.args as { volume?: string } | undefined;
        if (args?.volume) return presets(args.volume);
        try {
          return (await audio.devices()).map(item);
        } catch (e) {
          return [{ id: "error", name: "No audio devices", subtitle: String((e as Error)?.message ?? e), icon: xdg("dialog-error")!, actions: [] }];
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
        if (id === "error") return { keep: true };
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
} satisfies Extension;
