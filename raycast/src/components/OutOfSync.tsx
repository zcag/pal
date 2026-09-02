import { Action, ActionPanel, Color, Icon, List, Toast, showToast } from "@raycast/api";
import { syncCommands } from "../lib/sync";

/** Run the palette-command sync, reporting through a toast. */
export async function syncPaletteCommands(onSynced?: () => void) {
  const toast = await showToast({ style: Toast.Style.Animated, title: "Syncing palette commands" });
  try {
    const output = await syncCommands();
    toast.style = Toast.Style.Success;
    toast.title = output || "Synced";
    toast.message = "Reopen Raycast once the rebuild finishes";
    onSynced?.();
  } catch (e) {
    toast.style = Toast.Style.Failure;
    toast.title = "Sync failed";
    // `make raycast` is the same two steps, and works even when the
    // source-folder preference this needs is unset.
    toast.message = `${e instanceof Error ? e.message : String(e)} - or run \`make raycast\``;
  }
}

/**
 * Palettes that exist in pal but have no Raycast command yet.
 *
 * Raycast bakes its command list into a static manifest at install time, so a
 * palette added to config.toml is invisible to root search until a sync and a
 * rebuild. Nothing else goes stale - contents are read live and item scripts
 * re-sync hourly - so this is the one staleness worth showing, and it shows
 * only when it is real.
 */
export function OutOfSync({ palettes, onSynced }: { palettes: string[]; onSynced?: () => void }) {
  if (palettes.length === 0) return null;

  return (
    <List.Section title="Out of sync">
      <List.Item
        icon={{ source: Icon.Download, tintColor: Color.Orange }}
        title={`${palettes.length} palette${palettes.length === 1 ? "" : "s"} without a command`}
        subtitle={palettes.join(", ")}
        accessories={[{ tag: { value: "sync", color: Color.Orange } }]}
        actions={
          <ActionPanel>
            <Action
              title="Sync Palette Commands"
              icon={Icon.Download}
              onAction={() => syncPaletteCommands(onSynced)}
            />
          </ActionPanel>
        }
      />
    </List.Section>
  );
}
