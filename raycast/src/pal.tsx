import { List, getPreferenceValues } from "@raycast/api";
import { useExec } from "@raycast/utils";
import { metaArgs, palBinary, parseMeta } from "./lib/pal";
import { usePalEnv } from "./lib/useEnv";
import { PaletteBrowser } from "./components/PaletteBrowser";
import { PaletteView } from "./components/PaletteView";

/**
 * The root command. `pal` with no arguments runs the configured
 * `default_palette`, so that's what this does by default too - the palette
 * browser is a preference away, and every palette is also its own command.
 */
export default function Command() {
  const { rootView } = getPreferenceValues<{ rootView?: string }>();
  const { env, ready } = usePalEnv();

  const { data, isLoading } = useExec(palBinary(), metaArgs(), {
    parseOutput: ({ stdout }) => parseMeta(stdout),
    env,
    execute: ready && rootView !== "browser",
    keepPreviousData: true,
  });

  if (rootView === "browser") return <PaletteBrowser />;

  if (!data) return <List isLoading={isLoading || !ready} searchBarPlaceholder="Loading palettes…" />;

  return <PaletteView palette={data.default_palette} />;
}
