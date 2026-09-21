// Audio devices over the core's audio capability: one row per output and
// per input (sections Output / Input), the default tagged, the volume as
// an accessory. Enter makes the row the default for its direction; the
// other actions set the volume to the percent typed in the search bar
// (a form for a pick without it) or toggle mute without leaving the
// palette. Live: the defaults and volumes are read again on every show.
import { argsForm, audio, bar, errorMessage, failed, hint, settings, xdg, type Accessory, type Action, type Arg, type AudioDevice, type BarCtx, type BarItem, type Ctx, type Effect, type Extension, type Item, type View } from "@zcag/pal";
import { PRESETS as VIEW_PRESETS, render as renderBar, type BarKind, type BarState } from "./view.ts";

export const PRESETS = VIEW_PRESETS;

/** A row id is `kind:id`, since a headset is one device in both directions. */
const rowId = (d: Pick<AudioDevice, "kind" | "id">) => `${d.kind}:${d.id}`;
const parse = (row: string): { kind: AudioDevice["kind"]; id: string } => {
  const i = row.indexOf(":");
  return { kind: row.slice(0, i) as AudioDevice["kind"], id: row.slice(i + 1) };
};

const MIC = "\u{f036c}"; // md-microphone
const MIC_MUTED = "\u{f036d}";
const MIC_OFF = "\u{f036e}";
const VOLUME = { muted: "\u{f075f}", headphones: "\u{f08c3}", speaker: "\u{f04c3}" };
/**
 * The loudness ramp: one more arc on the same cone each step. Zero is not the
 * bottom of it — it is the same fact as muted, and takes the muted glyph.
 */
const RAMP: [number, string][] = [[67, "\u{f057e}"], [34, "\u{f0580}"], [1, "\u{f057f}"], [0, VOLUME.muted]];
const VOLUME_STEP = 5;
const VOLUME_ITEM = "volume";
/** How long the level stays up after a change, his `VOL_FLASH_SEC`. */
const FLASH_MS = 3000;

/** `[extensions.audio]`, defaults in pal.json. `bar_show_*`: when each strip is drawn; `always` keeps a muted glyph with nothing to say. */
type Settings = { level: "flash" | "always" | "never"; bar_show_volume?: "auto" | "always"; bar_show_microphone?: "auto" | "muted" | "always" };

let flashUntil = 0;
let collapse: ReturnType<typeof setTimeout> | undefined;
/** Which device the popover's keys act on, per direction, between renders: the device's id, not an index, so a list that changes under it keeps its place. */
const barFocus: Record<BarKind, string | undefined> = { output: undefined, input: undefined };

/** The popover's state for one direction: that direction's devices, the other's default for the line at the foot, and where the cursor sits. */
async function barState(kind: BarKind): Promise<BarState> {
  const all = await audio.devices();
  const devices = all.filter((d) => d.kind === kind);
  // The device in use is the card, not a row, so the cursor lands on the first one you could switch to: Enter then means "use this instead", which is the only thing the rows are for.
  const at = devices.findIndex((d) => d.id === barFocus[kind]);
  const first = devices.findIndex((d) => !d.default);
  return { kind, devices, other: all.find((d) => d.kind !== kind && d.default), focus: at < 0 ? Math.max(0, first) : at };
}


/**
 * Hold the level up for a moment, then take it away again. Every change
 * rearms the timer, so a run of scroll ticks keeps the number up throughout
 * and clears it once, at the end.
 *
 * It is a timer and a push rather than `BarItem.refresh` because the core
 * floors a poll at `MIN_EVERY` (10 s), which would leave the number up three
 * times as long as it should be.
 */
function flash(): void {
  if (settings.get<Settings>().level !== "flash") return;
  flashUntil = Date.now() + FLASH_MS;
  clearTimeout(collapse);
  collapse = setTimeout(() => { flashUntil = 0; bar.refresh(VOLUME_ITEM).catch(() => {}); }, FLASH_MS);
  collapse.unref?.();
}

function icon(d: AudioDevice): string {
  if (d.kind === "input") return MIC;
  if (d.transport === "bluetooth") return xdg("audio-headphones")!;
  return xdg("audio-speakers")!;
}

/** The row's one field in the bar, a percent; only Set volume reads it (a device with no volume control has neither). */
const VOLUME_ARGS: Arg[] = [{ id: "volume", placeholder: "Volume %", kind: "number" }];

function item(d: AudioDevice): Item {
  const dir = d.kind === "output" ? "Output" : "Input";
  const accessories: Accessory[] = [];
  if (d.muted) accessories.push({ tag: "muted", color: "amber" });
  if (d.volume !== null) accessories.push({ text: `${d.volume}%` });
  if (d.default) accessories.push({ tag: "default", color: "green" });
  const actions: Action[] = [{ id: "default", title: `Set as ${d.kind}` }];
  if (d.volume !== null) actions.push({ id: "volume", title: "Set volume", shortcut: "cmd+shift+v", args: true });
  if (d.muted !== null) actions.push({ id: "mute", title: d.muted ? "Unmute" : "Mute", shortcut: "cmd+m" });
  return {
    id: rowId(d),
    name: d.name,
    subtitle: d.transport ? `${dir} · ${d.transport}` : dir,
    icon: icon(d),
    keywords: [d.kind, ...(d.transport ? [d.transport] : [])],
    accessories,
    ...(d.volume !== null && { args: VOLUME_ARGS }),
    actions,
    section: dir,
  };
}

const defaultDevice = async (kind: AudioDevice["kind"]) => (await audio.devices()).find((d) => d.kind === kind && d.default);

/** The glyph says where the sound goes; only a device with nowhere else to say it falls through to the ramp. */
function outputGlyph(d: AudioDevice): string {
  if (d.muted === true) return VOLUME.muted;
  if (d.transport === "bluetooth") return VOLUME.headphones;
  if (d.transport === "hdmi" || d.transport === "airplay") return VOLUME.speaker;
  return RAMP.find(([floor]) => (d.volume ?? 0) >= floor)![1];
}

function outputBar(d: AudioDevice | undefined, menu: View): BarItem {
  if (!d) return settings.get<Settings>().bar_show_volume === "always" ? { icon: VOLUME.muted, color: "muted", icon_size: 18, icon_width: 31, tooltip: "No output device", menu: { view: menu } } : { hidden: true };
  const muted = d.muted === true;
  // The number changes only when you change it, so it is feedback rather than a
  // reading: permanently on screen it is one you stop seeing. It appears for the
  // moment after a change and then collapses back to a one-glyph item; the
  // standing answer is the popover, against the device it applies to.
  const level = settings.get<Settings>().level;
  const showLevel = d.volume !== null && (level === "always" || (level === "flash" && Date.now() < flashUntil));
  return {
    icon: outputGlyph(d),
    title: showLevel ? `${d.volume}%` : undefined,
    color: muted ? "muted" : undefined,
    icon_size: 18,
    icon_width: 31,
    tooltip: `${d.name}${muted ? ", muted" : d.volume === null ? "" : ` · ${d.volume}%`}`,
    scroll: { up: "up", down: "down" },
    menu: { view: menu },
  };
}

/** The main volume strip, or hidden when the audio backend is unavailable. */
async function renderVolume(): Promise<BarItem> {
  try { const st = await barState("output"); return outputBar(st.devices.find((d) => d.default), renderBar(st)); } catch { return { hidden: true }; }
}

/**
 * Mic only interrupts the bar when it needs attention: muted or absent.
 * `bar_show_microphone` narrows that to muted alone, or widens it to
 * always: a live mic is then the glyph, muted, whose click only opens
 * the popover (the direct click restores the level, which a live mic
 * does not want).
 */
async function renderMic(): Promise<BarItem> {
  try {
    const st = await barState("input");
    const d = st.devices.find((x) => x.default);
    const show = settings.get<Settings>().bar_show_microphone ?? "auto";
    const menu = { view: renderBar(st) };
    if (!d) return show === "muted" ? { hidden: true } : { icon: MIC_OFF, color: "red", tooltip: "No input device", click: "open", menu };
    if (!d.muted) return show === "always" ? { icon: MIC, color: "muted", tooltip: `${d.name}${d.volume === null ? "" : ` · ${d.volume}%`}`, menu } : { hidden: true };
    return { icon: MIC_MUTED, color: "red", tooltip: `${d.name}, muted`, click: "open", menu };
  } catch { return { hidden: true }; }
}

/**
 * The scroll keys and the popover's, for either direction. The scroll on
 * the strip arrives here too (`up`/`down` with no popover up), so a
 * volume change answers with `keep` and an HUD; everything the popover
 * sends answers with a fresh tree instead, which is what `fromPopover`
 * distinguishes. The device acted on is the default one, read again
 * rather than trusted from the last render.
 */
async function deviceAction(kind: BarKind, action: string, ctx?: BarCtx): Promise<Effect> {
  const redraw = async (): Promise<Effect> => ({ view: renderBar(await barState(kind)) });
  try {
    // The cursor moves without touching a device, so it answers from the cache of this render alone.
    if (action.startsWith("focus:")) { barFocus[kind] = action.slice(6); return redraw(); }
    if (action === "next" || action === "prev") {
      const st = await barState(kind);
      // The cursor walks the rows, which are the devices not in use.
      const rows = st.devices.filter((d) => !d.default);
      if (!rows.length) return { keep: true };
      const here = Math.max(0, rows.findIndex((d) => d.id === st.devices[st.focus]?.id));
      barFocus[kind] = rows[(here + (action === "next" ? 1 : -1) + rows.length) % rows.length].id;
      return redraw();
    }
    if (action === "open-pal") return { push: { extension: "audio", palette: "audio" } };

    const st = await barState(kind);
    const d = st.devices.find((x) => x.default);
    if (action === "use") {
      const pick = st.devices[st.focus];
      if (!pick || pick.default) return { keep: true };
      await audio.setDefault(pick.id, kind);
      barFocus[kind] = pick.id;
      return { ...(await redraw()), hud: `${kind === "output" ? "Output" : "Input"}: ${pick.name}` };
    }
    if (!d) return { keep: true };

    // Everything below acts on the default device's level or its mute.
    const fromPopover = action === "set" || action.startsWith("preset:");
    const level = async (volume: number): Promise<Effect> => {
      await audio.setVolume(d.id, kind, Math.max(0, Math.min(100, Math.round(volume))));
      flash();
      return fromPopover || ctx?.values?.value !== undefined ? redraw() : { keep: true, hud: `${d.name} ${Math.round(volume)}%` };
    };
    if (action === "set") { const v = Number(ctx?.values?.value); return Number.isFinite(v) ? level(v * 100) : { keep: true }; }
    if (action.startsWith("preset:")) return level(Number(action.slice(7)));
    if (action === "up" || action === "down") {
      if (d.volume === null) return { keep: true };
      const volume = Math.max(0, Math.min(100, d.volume + (action === "up" ? VOLUME_STEP : -VOLUME_STEP)));
      await audio.setVolume(d.id, kind, volume);
      // Only what he just did puts the number up; a poll or a device change must
      // not, or it would be permanent again by another route.
      flash();
      return { keep: true, hud: `${d.name} ${volume}%` };
    }
    const muted = await audio.setMute(d.id, kind);
    flash();
    return { keep: true, hud: muted ? `${d.name} muted` : `${d.name} unmuted` };
  } catch (e) { return failed(kind === "output" ? "change volume" : "change the microphone", e); }
}

const volumeAction = (action: string, ctx?: BarCtx) => deviceAction("output", action, ctx);
const micBarAction = (action: string, ctx?: BarCtx) => deviceAction("input", action, ctx);

/** A direct click on the muted-microphone strip: bring it back, which is the only reason that strip is there. */
async function micAction(): Promise<Effect> {
  try {
    const d = await defaultDevice("input");
    if (!d) return { keep: true };
    if (d.volume !== null) await audio.setVolume(d.id, "input", 75);
    if (d.muted) await audio.setMute(d.id, "input", false);
    return { keep: true, hud: `${d.name} at 75%` };
  } catch (e) { return failed("unmute microphone", e); }
}


/** Set volume: the bar's percent to the device; no values (a hotkey, `pal run`) is the field as a form, anything but 0..100 comes back on it. */
async function setVolume(row: string, values: Ctx["values"] | undefined): Promise<Effect> {
  const { kind, id } = parse(row);
  const form = (errors?: Record<string, string>): Effect => ({ form: { ...argsForm(VOLUME_ARGS, "Set volume", { id: "volume", title: "Set volume" }, errors), id: row } });
  if (!values) return form();
  const raw = String(values.volume ?? "").trim(), v = Number(raw);
  if (!raw || Number.isNaN(v) || v < 0 || v > 100) return form({ volume: "A percent, 0 to 100" });
  try { await audio.setVolume(id, kind, Math.round(v)); } catch (e) { return failed("set the volume", e); }
  return { hud: `Volume ${Math.round(v)}%` };
}

export default {
  palettes: {
    audio: {
      title: "Audio",
      live: true,
      placeholder: "Switch output or input, set the volume",
      list: async () => {
        try {
          return (await audio.devices()).map(item);
        } catch (e) {
          return [hint("error", "No audio devices", errorMessage(e), { icon: xdg("dialog-error")! })];
        }
      },
      pick: async (id, action, ctx?: Ctx) => {
        if (id === "hint:error") return { keep: true };
        const { kind, id: dev } = parse(id);
        switch (action) {
          case "volume":
            return setVolume(id, ctx?.values);
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
    volume: { render: renderVolume, onAction: volumeAction },
    microphone: { render: renderMic, onOpen: micAction, onAction: micBarAction },
  },
} satisfies Extension;
