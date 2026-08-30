import {
  LaunchType,
  Toast,
  environment,
  getPreferenceValues,
  showHUD,
  showToast,
  updateCommandMetadata,
} from "@raycast/api";
import { parseMeta, runPal } from "./lib/pal";
import { bakeable, generateScripts } from "./lib/scripts";

/**
 * Regenerate the script commands that put palette items into Raycast's root
 * search. Runs on a schedule so baked entries don't rot, and can be triggered
 * by hand from root search.
 */
export default async function Command() {
  const background = environment.launchType === LaunchType.Background;
  const { bakedPalettes } = getPreferenceValues<{ bakedPalettes?: string }>();

  const toast = background
    ? undefined
    : await showToast({ style: Toast.Style.Animated, title: "Generating item scripts" });

  try {
    const configured = (bakedPalettes ?? "")
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean);

    // With nothing configured, bake the palette bare `pal` opens, so root
    // search carries the same items the terminal picker does.
    const meta = parseMeta(await runPal(["meta"]));
    const palettes = configured.length
      ? configured
      : [meta.default_palette].filter((name) =>
          meta.palettes.some((p) => p.name === name && bakeable(p)),
        );

    const results = await generateScripts(palettes);
    const total = results.reduce((sum, r) => sum + r.count, 0);
    const failed = results.filter((r) => r.error);

    await updateCommandMetadata({
      subtitle: `${total} items from ${results.length - failed.length} palettes`,
    });

    if (background) return;

    if (failed.length) {
      toast!.style = Toast.Style.Failure;
      toast!.title = `${total} items, ${failed.length} palette${failed.length === 1 ? "" : "s"} failed`;
      toast!.message = failed.map((f) => `${f.palette}: ${f.error}`).join("\n").slice(0, 300);
      return;
    }

    await toast!.hide();
    await showHUD(`Generated ${total} item scripts from ${results.length} palettes`);
  } catch (e) {
    if (background) return;
    toast!.style = Toast.Style.Failure;
    toast!.title = "Could not generate item scripts";
    toast!.message = e instanceof Error ? e.message : String(e);
  }
}
