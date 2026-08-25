import { Toast, showToast } from "@raycast/api";
import { syncCommands } from "./lib/sync";

/**
 * Regenerate one Raycast command per palette. Separate from item scripts:
 * this rewrites the extension manifest, so it needs the source checkout and a
 * rebuild before the new commands appear.
 */
export default async function Command() {
  const toast = await showToast({ style: Toast.Style.Animated, title: "Syncing palette commands" });
  try {
    const output = await syncCommands();
    toast.style = Toast.Style.Success;
    toast.title = output || "Palette commands synced";
    toast.message = "They appear once the extension rebuilds";
  } catch (e) {
    toast.style = Toast.Style.Failure;
    toast.title = "Sync failed";
    toast.message = e instanceof Error ? e.message : String(e);
  }
}
