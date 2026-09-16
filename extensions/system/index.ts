// System commands over the core's system capability: sleep, lock, log out,
// power, trash, dark mode, volume, brightness, do not disturb, eject, show
// desktop, keep awake. Static rows (the core says which this machine can
// do), indexed so `mute` and `sleep` are root results; `live` because the
// keep-awake row flips its title, and a live palette lists again on every
// show, which also keeps the two probes here current: what is in the
// Trash, and whether the appearance is dark or light. The destructive ones
// ask first unless the setting turns that off. The core hides the panel
// before running, so the command lands on the desktop, not on pal.
import { readdir } from "node:fs/promises";
import { home, settings, system, type Accessory, type Extension, type Item, type SystemCommand } from "@zcag/pal";

/** `[extensions.system]`, defaults in pal.json. */
type Settings = { confirm_destructive: boolean };

const MAC = process.platform === "darwin";
/** Tests point this at a temp folder; `~/.Trash` itself needs Full Disk Access to read (then the row just has no count). */
const TRASH = process.env.PAL_TRASH_DIR || (MAC ? home("~/.Trash") : `${process.env.XDG_DATA_HOME || home("~/.local/share")}/Trash/files`);
const PROBE_MS = 1500;

async function output(argv: string[]): Promise<string | undefined> {
  const proc = Bun.spawn(argv, { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
  const timer = setTimeout(() => proc.kill(), PROBE_MS);
  const [code, out] = await Promise.all([proc.exited, new Response(proc.stdout).text()]);
  clearTimeout(timer);
  return code === 0 ? out.trim() : undefined;
}

/** Items in the Trash, or undefined when it cannot be read. */
const trashCount = () => readdir(TRASH).then((names) => names.filter((n) => n !== ".DS_Store").length, () => undefined);

/** `dark` or `light`, or undefined when the OS does not say. macOS has the key only while dark; GNOME's colour scheme names it. */
async function appearance(): Promise<"dark" | "light" | undefined> {
  if (MAC) return (await output(["defaults", "read", "-g", "AppleInterfaceStyle"])) === "Dark" ? "dark" : "light";
  const scheme = await output(["gsettings", "get", "org.gnome.desktop.interface", "color-scheme"]);
  return scheme === undefined ? undefined : scheme.includes("prefer-dark") ? "dark" : "light";
}

/** What the two probed rows show on the right. */
type Probes = { trash?: number; appearance?: "dark" | "light" };

function accessories(c: SystemCommand, p: Probes): Accessory[] {
  if (c.id === "empty-trash" && p.trash !== undefined) return [{ text: p.trash === 0 ? "empty" : `${p.trash} ${p.trash === 1 ? "item" : "items"}` }];
  if (c.id === "dark-mode" && p.appearance) return [{ tag: p.appearance, color: p.appearance === "dark" ? "violet" : "amber" }];
  return [];
}

function item(c: SystemCommand, confirm: boolean, p: Probes): Item {
  const run = c.destructive && confirm ? { id: "run", title: c.title, style: "destructive" as const, confirm: `${c.title} now?` } : { id: "run", title: c.title };
  return { id: c.id, name: c.title, subtitle: c.subtitle, icon: c.icon, keywords: c.keywords, accessories: accessories(c, p), actions: [run] };
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
        const commands = (await system.commands()).filter((c) => c.available);
        const probes: Probes = {
          trash: commands.some((c) => c.id === "empty-trash") ? await trashCount() : undefined,
          appearance: commands.some((c) => c.id === "dark-mode") ? await appearance() : undefined,
        };
        return commands.map((c) => item(c, confirm, probes));
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
