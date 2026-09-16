// The smallest extension: one palette with three rows and one setting.
// `pal` is the host's API (host/src/api.ts) and its protocol types; an
// installed extension imports it by that bare name.
import { settings, type Extension, type Item } from "pal";

/** `[extensions.hello]`, defaults in pal.json. */
type Settings = { greeting: string };

export default {
  palettes: {
    hello: {
      title: "Hello",
      icon: "👋",
      // Rows are indexed: `list` runs once (and again when the settings
      // change), the root search matches them like everything else.
      list: (): Item[] => {
        const { greeting } = settings.get<Settings>();
        return [
          { id: "greet", name: `${greeting}, world`, subtitle: "Change the greeting in Settings, Extensions, Hello", icon: "👋", actions: [{ id: "copy", title: "Copy greeting" }] },
          { id: "docs", name: "How extensions work", subtitle: "docs/extensions.md on GitHub", icon: "📖", url: "https://github.com/zcag/pal/blob/main/docs/extensions.md" },
          { id: "time", name: "What time is it", subtitle: "A row whose pick shows a toast", icon: "🕰", actions: [{ id: "tell", title: "Tell me" }] },
        ];
      },
      pick: (id) => {
        if (id === "greet") return { copy: `${settings.get<Settings>().greeting}, world` };
        if (id === "docs") return { open: "https://github.com/zcag/pal/blob/main/docs/extensions.md" };
        return { toast: { title: new Date().toLocaleTimeString(), style: "success" } };
      },
    },
  },
} satisfies Extension;
