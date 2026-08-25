import {
  Action,
  ActionPanel,
  Alert,
  Color,
  Grid,
  Icon,
  Keyboard,
  List,
  Toast,
  confirmAlert,
  openExtensionPreferences,
  showToast,
  useNavigation,
} from "@raycast/api";
import { showFailureToast, useExec, useFrecencySorting } from "@raycast/utils";
import { useMemo, useState } from "react";
import {
  PalAction,
  PalItem,
  PaletteMeta,
  actionsFor,
  clearShellPath,
  itemValue,
  listArgs,
  metaArgs,
  palBinary,
  parseItems,
  parsePaletteMeta,
  pick,
} from "../lib/pal";
import { usePalEnv } from "../lib/useEnv";
import { iconFor, itemIcon, toColor } from "../lib/icon";
import { accessoriesFor, palEnvFor } from "../lib/accessories";
import { handleOutput, parseShortcut } from "../lib/envelope";
import { listMetadata } from "./Metadata";

export function PaletteView({
  palette,
  meta: seed,
}: {
  palette: string;
  meta?: PaletteMeta;
}) {
  const { push } = useNavigation();
  const { env, ready } = usePalEnv();
  const [searchText, setSearchText] = useState("");
  const [showDetail, setShowDetail] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: meta } = useExec(palBinary(), metaArgs(palette), {
    parseOutput: ({ stdout }) => parsePaletteMeta(stdout),
    env,
    execute: ready && !seed,
    initialData: seed,
    keepPreviousData: true,
    failureToastOptions: { title: `Could not read the "${palette}" palette` },
  });

  const isInput = meta?.input ?? false;

  const {
    data: rawItems,
    isLoading,
    revalidate,
    error,
  } = useExec(palBinary(), listArgs(palette, isInput ? searchText : undefined), {
    parseOutput: ({ stdout }) => parseItems(stdout),
    env,
    execute: ready && !!meta && (!isInput || searchText.length > 0),
    keepPreviousData: true,
    initialData: [] as PalItem[],
  });

  const items = useMemo(() => rawItems ?? [], [rawItems]);

  // Input palettes are ordered by the plugin (a calculator result isn't a
  // ranking), so frecency only applies to static lists.
  const { data: sorted, visitItem, resetRanking } = useFrecencySorting(items, {
    namespace: `pal-${palette}`,
    key: (item) => item.id,
  });
  const ordered = isInput ? items : sorted;

  const hasDetail = useMemo(
    () => ordered.some((item) => item.detail || item.preview),
    [ordered],
  );

  const selected = ordered.find((item) => item.id === selectedId) ?? ordered[0];
  const previewCommand = showDetail ? selected?.preview : undefined;

  const { data: preview, isLoading: previewLoading } = useExec(
    "/bin/sh",
    ["-c", previewCommand ?? "true"],
    {
      env: { ...env, ...palEnvFor(selected) },
      execute: Boolean(previewCommand) && ready,
      keepPreviousData: false,
    },
  );

  async function run(item: PalItem, action?: PalAction) {
    if (action?.confirm) {
      const confirmed = await confirmAlert({
        title: action.confirm,
        icon: action.style === "destructive" ? Icon.Warning : undefined,
        primaryAction: {
          title: action.title ?? "Confirm",
          style:
            action.style === "destructive"
              ? Alert.ActionStyle.Destructive
              : Alert.ActionStyle.Default,
        },
      });
      if (!confirmed) return;
    }

    const title = action?.title ?? item.name;
    const toast = await showToast({ style: Toast.Style.Animated, title });
    try {
      await visitItem(item);
      const output = await pick(palette, item, action?.id);
      await toast.hide();
      await handleOutput(output, title, { push, revalidate });
    } catch (e) {
      await toast.hide();
      await showFailureToast(e, { title: `"${title}" failed` });
    }
  }

  function itemActions(item: PalItem) {
    const actions = actionsFor(item, meta);
    const value = itemValue(item, meta);

    return (
      <ActionPanel>
        <ActionPanel.Section>
          {actions.length > 0 ? (
            actions.map((action, index) => (
              <Action
                key={action.id ?? action.title ?? index}
                title={action.title ?? action.id ?? "Run"}
                icon={action.icon ? iconFor({ icon: action.icon }) : Icon.ArrowRight}
                style={
                  action.style === "destructive"
                    ? Action.Style.Destructive
                    : Action.Style.Regular
                }
                shortcut={parseShortcut(action.shortcut)}
                onAction={() => run(item, action)}
              />
            ))
          ) : (
            <Action title="Run" icon={Icon.ArrowRight} onAction={() => run(item)} />
          )}
        </ActionPanel.Section>

        <ActionPanel.Section>
          {hasDetail && (
            <Action
              title={showDetail ? "Hide Details" : "Show Details"}
              icon={Icon.Sidebar}
              shortcut={{ modifiers: ["cmd"], key: "d" }}
              onAction={() => setShowDetail((v) => !v)}
            />
          )}
          {item.quicklook && (
            <Action.ToggleQuickLook shortcut={Keyboard.Shortcut.Common.ToggleQuickLook} />
          )}
          <Action.CopyToClipboard
            title="Copy Name"
            content={item.name}
            shortcut={Keyboard.Shortcut.Common.Copy}
          />
          {value && (
            <Action.CopyToClipboard
              title="Copy Value"
              content={value}
              shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
            />
          )}
          <Action.CopyToClipboard
            title="Copy Item as JSON"
            content={JSON.stringify(item, null, 2)}
            shortcut={{ modifiers: ["cmd", "opt"], key: "c" }}
          />
        </ActionPanel.Section>

        <ActionPanel.Section>
          <Action
            title="Reload Palette"
            icon={Icon.ArrowClockwise}
            shortcut={Keyboard.Shortcut.Common.Refresh}
            onAction={revalidate}
          />
          {!isInput && (
            <Action
              title="Reset Ranking"
              icon={Icon.ArrowCounterClockwise}
              shortcut={Keyboard.Shortcut.Common.RemoveAll}
              onAction={() => resetRanking(item)}
            />
          )}
          <Action
            title="Reload Shell Environment"
            icon={Icon.Terminal}
            onAction={() => {
              clearShellPath();
              revalidate();
              showToast({ style: Toast.Style.Success, title: "Shell environment reloaded" });
            }}
          />
        </ActionPanel.Section>
      </ActionPanel>
    );
  }

  const navigationTitle = meta?.desc ? `${palette} - ${meta.desc}` : palette;
  const placeholder = isInput
    ? (meta?.input_prompt ?? `Type to query ${palette}`)
    : `Search ${palette}`;

  if (error) {
    return (
      <List navigationTitle={navigationTitle}>
        <List.EmptyView
          icon={{ source: Icon.Warning, tintColor: Color.Red }}
          title={`Could not list "${palette}"`}
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

  if (meta?.view === "grid") {
    return (
      <Grid
        navigationTitle={navigationTitle}
        isLoading={isLoading || !ready}
        searchBarPlaceholder={placeholder}
        columns={8}
        inset={Grid.Inset.Small}
        filtering={!isInput}
        throttle={isInput}
        onSearchTextChange={isInput ? setSearchText : undefined}
      >
        {groupBySection(ordered).map(([section, sectionItems]) => (
          <Grid.Section key={section ?? "_"} title={section ?? undefined}>
            {sectionItems.map((item) => (
              <Grid.Item
                key={item.id}
                id={item.id}
                content={gridContent(item, meta)}
                title={item.name}
                subtitle={item.subtitle ?? item.desc}
                keywords={item.keywords}
                actions={itemActions(item)}
              />
            ))}
          </Grid.Section>
        ))}
        <Grid.EmptyView
          icon={Icon.MagnifyingGlass}
          title={emptyTitle(isInput, searchText)}
          description={emptyDescription(isInput, searchText, palette)}
        />
      </Grid>
    );
  }

  return (
    <List
      navigationTitle={navigationTitle}
      isLoading={isLoading || previewLoading || !ready}
      searchBarPlaceholder={placeholder}
      filtering={!isInput}
      throttle={isInput}
      onSearchTextChange={isInput ? setSearchText : undefined}
      onSelectionChange={setSelectedId}
      isShowingDetail={showDetail && hasDetail}
    >
      {groupBySection(ordered).map(([section, sectionItems]) => (
        <List.Section key={section ?? "_"} title={section ?? undefined}>
          {sectionItems.map((item) => (
            <List.Item
              key={item.id}
              id={item.id}
              title={item.name}
              subtitle={showDetail ? undefined : (item.subtitle ?? item.desc)}
              keywords={item.keywords}
              icon={itemIcon(item, meta)}
              accessories={showDetail ? undefined : accessoriesFor(item)}
              quickLook={item.quicklook}
              detail={
                showDetail && hasDetail ? (
                  <List.Item.Detail
                    markdown={detailMarkdown(item, item.id === selected?.id ? preview : undefined)}
                    metadata={listMetadata(item.detail?.metadata)}
                  />
                ) : undefined
              }
              actions={itemActions(item)}
            />
          ))}
        </List.Section>
      ))}
      <List.EmptyView
        icon={Icon.MagnifyingGlass}
        title={emptyTitle(isInput, searchText)}
        description={emptyDescription(isInput, searchText, palette)}
      />
    </List>
  );
}

function emptyTitle(isInput: boolean, searchText: string) {
  if (!isInput) return "Nothing found";
  return searchText ? "No result" : "Type to search";
}

/**
 * An input palette that returns nothing has usually been handed something it
 * can't parse, so say which query came back empty rather than leaving a bare
 * "nothing found" that reads like the palette is broken.
 */
function emptyDescription(isInput: boolean, searchText: string, palette: string) {
  if (!isInput) return `No items in "${palette}"`;
  return searchText ? `"${searchText}" returned nothing` : undefined;
}

/** Group items by their `section`, preserving first-seen section order. */
function groupBySection(items: PalItem[]): Array<[string | null, PalItem[]]> {
  const groups = new Map<string | null, PalItem[]>();
  for (const item of items) {
    const key = item.section ?? null;
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return [...groups.entries()];
}

/** Grid tiles prefer a real colour swatch when the item describes one. */
function gridContent(item: PalItem, palette?: PaletteMeta): Grid.Item.Props["content"] {
  const raw = [item.hex, item.color, item.rgb].find(
    (v) => typeof v === "string" && /^#[0-9a-f]{3,8}$/i.test(v as string),
  ) as string | undefined;
  if (raw) return { color: raw };

  const color = toColor(item.color);
  if (color) return { color };

  return itemIcon(item, palette, Icon.Circle);
}

function detailMarkdown(item: PalItem, preview?: string): string {
  if (item.detail?.markdown) return item.detail.markdown;
  if (preview !== undefined) {
    const text = preview.trim();
    return text ? "```\n" + text + "\n```" : "_No output_";
  }
  if (item.preview) return "_Loading…_";
  return "";
}
