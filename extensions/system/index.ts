// System commands over the core's system capability: sleep, lock, log out,
// power, trash, dark mode, volume, brightness, do not disturb, eject, show
// desktop, keep awake. Static rows (the core says which this machine can
// do), indexed so `mute` and `sleep` are root results; `live` because the
// keep-awake row flips its title, and a live palette lists again on every
// show. The destructive ones ask first unless the setting turns that off.
// The core hides the panel before running, so the command lands on the
// desktop, not on pal.
import { settings, system, type Extension, type Item, type SystemCommand } from "@zcag/pal";

/** `[extensions.system]`, defaults in pal.json. */
type Settings = { confirm_destructive: boolean };

function item(c: SystemCommand, confirm: boolean): Item {
  const run = c.destructive && confirm ? { id: "run", title: c.title, style: "destructive" as const, confirm: `${c.title} now?` } : { id: "run", title: c.title };
  return { id: c.id, name: c.title, subtitle: c.subtitle, icon: c.icon, keywords: c.keywords, actions: [run] };
}

export default {
  palettes: {
    system: {
      title: "System",
      icon: "⏻",
      // The keep-awake row flips between Keep Awake and Allow Sleep: relisted on every show.
      live: true,
      placeholder: "Sleep, lock, volume, dark mode...",
      list: async () => {
        const confirm = settings.get<Settings>().confirm_destructive;
        return (await system.commands()).filter((c) => c.available).map((c) => item(c, confirm));
      },
      pick: async (id) => {
        try {
          await system.run(id);
        } catch (e) {
          return { keep: true, toast: { title: "Command failed", message: String((e as Error)?.message ?? e), style: "failure" } };
        }
        return {};
      },
    },
  },
} satisfies Extension;
