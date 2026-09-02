import {
  Action,
  ActionPanel,
  Color,
  Icon,
  Keyboard,
  List,
  Toast,
  openExtensionPreferences,
  showToast,
} from "@raycast/api";
import { useExec, useFrecencySorting } from "@raycast/utils";
import { useMemo } from "react";
import {
  PalMeta,
  PaletteMeta,
  clearShellPath,
  metaArgs,
  palBinary,
  parseMeta,
} from "../lib/pal";
import { usePalEnv } from "../lib/useEnv";
import { palettesMissingCommands } from "../lib/sync";
import { OutOfSync, syncPaletteCommands } from "./OutOfSync";
import { paletteDeeplink } from "../lib/extension";
import { iconFor } from "../lib/icon";
import { PaletteView } from "./PaletteView";

export function PaletteBrowser() {
  const { env, ready } = usePalEnv();

  const { data, isLoading, revalidate, error } = useExec(palBinary(), metaArgs(), {
    parseOutput: (out) => parseMeta(out),
    env,
    execute: ready,
    keepPreviousData: true,
  });

  const palettes = data?.palettes ?? [];
  const unsynced = useMemo(() => palettesMissingCommands(data ?? {}), [data]);

  const { data: sorted, visitItem } = useFrecencySorting(palettes, {
    namespace: "pal-palettes",
    key: (palette) => palette.name,
  });

  if (error) {
    return (
      <List isLoading={false}>
        <List.EmptyView
          icon={{ source: Icon.Warning, tintColor: Color.Red }}
          title="Could not reach pal"
          description={String(error.message ?? error).slice(0, 500)}
          actions={
            <ActionPanel>
              <Action title="Retry" icon={Icon.ArrowClockwise} onAction={revalidate} />
              <Action
                title="Reload Shell Environment"
                icon={Icon.Terminal}
                onAction={() => {
                  clearShellPath();
                  revalidate();
                  showToast({ style: Toast.Style.Success, title: "Shell environment reloaded" });
                }}
              />
              <Action
                title="Open Extension Preferences"
                icon={Icon.Cog}
                onAction={openExtensionPreferences}
              />
            </ActionPanel>
          }
        />
      </List>
    );
  }

  return (
    <List
      isLoading={isLoading || !ready}
      searchBarPlaceholder="Search palettes"
    >
      <OutOfSync palettes={unsynced} onSynced={revalidate} />
      {sorted.map((palette) => (
        <List.Item
          key={palette.name}
          id={palette.name}
          title={palette.name}
          subtitle={palette.desc ?? undefined}
          icon={iconFor(palette, Icon.AppWindowList)}
          keywords={paletteKeywords(palette)}
          accessories={paletteAccessories(palette, data)}
          actions={
            <ActionPanel>
              <Action.Push
                title="Open Palette"
                icon={Icon.ArrowRight}
                target={<PaletteView palette={palette.name} meta={palette} />}
                onPush={() => visitItem(palette)}
              />
              <Action.CopyToClipboard
                title="Copy Palette Name"
                content={palette.name}
                shortcut={Keyboard.Shortcut.Common.Copy}
              />
              <Action.CreateQuicklink
                title="Create Quicklink to Palette"
                quicklink={{
                  name: `pal ${palette.name}`,
                  link: paletteDeeplink(palette.name),
                }}
              />
              <Action
                title="Reload Palettes"
                icon={Icon.ArrowClockwise}
                shortcut={Keyboard.Shortcut.Common.Refresh}
                onAction={revalidate}
              />
              <Action
                title="Sync Palette Commands"
                icon={Icon.Download}
                shortcut={{ modifiers: ["cmd", "shift"], key: "s" }}
                onAction={() => syncPaletteCommands(revalidate)}
              />
            </ActionPanel>
          }
        />
      ))}
      <List.EmptyView
        icon={Icon.AppWindowList}
        title="No palettes configured"
        description="Add palettes to ~/.config/pal/config.toml"
      />
    </List>
  );
}

function paletteKeywords(palette: PaletteMeta): string[] {
  const words = [palette.name, ...(palette.desc?.split(/\s+/) ?? [])];
  if (palette.include.length) words.push(...palette.include);
  return words;
}

/** Surface how a palette behaves, so the list explains itself at a glance. */
function paletteAccessories(palette: PaletteMeta, meta?: PalMeta): List.Item.Accessory[] {
  const accessories: List.Item.Accessory[] = [];

  if (palette.input) {
    accessories.push({
      tag: { value: palette.live ? "live" : "input", color: Color.Purple },
      tooltip: "Takes a query instead of filtering a list",
    });
  }
  if (palette.view === "grid") {
    accessories.push({ tag: { value: "grid", color: Color.Blue } });
  }
  if (palette.include.length) {
    accessories.push({
      text: `${palette.include.length} palettes`,
      icon: Icon.AppWindowGrid2x2,
      tooltip: palette.include.join(", "),
    });
  }
  if (palette.name === meta?.default_palette) {
    accessories.push({ icon: { source: Icon.Star, tintColor: Color.Yellow }, tooltip: "Default palette" });
  }

  return accessories;
}
