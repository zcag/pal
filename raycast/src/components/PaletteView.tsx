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
  PaletteFilter,
  PaletteMeta,
  actionsFor,
  clearShellPath,
  itemValue,
  listArgs,
  metaArgs,
  palBinary,
  parseItems,
  parseMeta,
  parsePaletteMeta,
  pick,
} from "../lib/pal";
import { usePalEnv } from "../lib/useEnv";
import { iconFor, itemIcon, resolveIcon, toColor, withMask } from "../lib/icon";
import { accessoriesFor, palEnvFor } from "../lib/accessories";
import { handleOutput, parseShortcut } from "../lib/envelope";
import { listMetadata } from "./Metadata";
import { OutOfSync } from "./OutOfSync";

export function PaletteView({
  palette,
  meta: seed,
  initialSearch,
  scopeEnv,
  unsynced = [],
}: {
  /** Palettes with no Raycast command yet; shown as a section when non-empty. */
  unsynced?: string[];
  palette: string;
  meta?: PaletteMeta;
  /** Seed the search bar - used when Pal runs as a fallback command. */
  initialSearch?: string;
  /**
   * Extra environment for every pal call in this view. A pick that resolves to
   * a palette can carry one, which is how a drill-down says *which* thing it
   * drilled into.
   */
  scopeEnv?: Record<string, string>;
}) {
  const { push } = useNavigation();
  const { env: baseEnv, ready } = usePalEnv();
  const env = useMemo(
    () => (baseEnv && scopeEnv ? { ...baseEnv, ...scopeEnv } : baseEnv),
    [baseEnv, scopeEnv],
  );
  const [searchText, setSearchText] = useState(initialSearch ?? "");
  // null = follow the palette's `[display] detail`; a bool = the user toggled.
  const [detailOverride, setDetailOverride] = useState<boolean | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Raycast's dropdown fires onChange on mount, so this fills in before the
  // first list runs; palettes without filters never gate on it.
  const [filter, setFilter] = useState<string | undefined>(undefined);

  const { data: meta, error: metaError } = useExec(palBinary(), metaArgs(palette), {
    parseOutput: (out) => parsePaletteMeta(out),
    env,
    execute: ready && !seed,
    initialData: seed,
    keepPreviousData: true,
    failureToastOptions: { title: `Could not read the "${palette}" palette` },
  });

  const isInput = meta?.input ?? false;
  const filters: PaletteFilter[] = meta?.filters ?? [];
  const scopeId = filter ?? filters[0]?.id;
  const showDetail = detailOverride ?? (meta?.display?.detail ?? false);

  // A combine palette carries items from several palettes, and an item that
  // brings no usable icon should inherit its *source* palette's, not the
  // containing one's. Only combines need the extra lookup.
  const { data: allMeta } = useExec(palBinary(), metaArgs(), {
    parseOutput: (out) => parseMeta(out),
    env,
    execute: ready && Boolean(meta?.include?.length),
    keepPreviousData: true,
  });

  const metaByName = useMemo(() => {
    const index = new Map<string, PaletteMeta>();
    for (const palette of allMeta?.palettes ?? []) index.set(palette.name, palette);
    return index;
  }, [allMeta]);

  const iconSourceFor = (item: PalItem) =>
    (typeof item._source === "string" ? metaByName.get(item._source) : undefined) ?? meta;

  const {
    data: rawItems,
    isLoading,
    revalidate,
    error,
  } = useExec(palBinary(), listArgs(palette, isInput ? searchText : undefined, scopeId), {
    parseOutput: ({ stdout }) => parseItems(stdout),
    env,
    execute:
      ready &&
      !!meta &&
      (!isInput || searchText.length > 0) &&
      (filters.length === 0 || scopeId !== undefined),
    keepPreviousData: true,
    initialData: [] as PalItem[],
  });

  const items = useMemo(() => rawItems ?? [], [rawItems]);

  // Input and live palettes are ordered by the plugin - a calculator result
  // isn't a ranking, and an OTP list is in the order the codes arrived - so
  // frecency only applies to static lists.
  const { data: sorted, visitItem, resetRanking } = useFrecencySorting(items, {
    namespace: `pal-${palette}`,
    key: (item) => item.id,
  });
  const pluginOrdered = isInput || (meta?.live ?? false);
  const ordered = pluginOrdered ? items : sorted;

  // Frecency ranks items, but it must not reorder the sections themselves -
  // a palette declares its own order (combine follows `include`), and groups
  // that shuffle as you use them are unreadable. Take section order from the
  // raw list, rank within each.
  const groups = useMemo(() => {
    const order: Array<string | null> = [];
    for (const item of items) {
      const key = item.section ?? null;
      if (!order.includes(key)) order.push(key);
    }
    return order.map(
      (key) =>
        [key, ordered.filter((item) => (item.section ?? null) === key)] as const,
    );
  }, [items, ordered]);

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
      await handleOutput(output, title, {
        push,
        revalidate,
        // A `pals` item resolves to another palette rather than doing anything.
        openPalette: (name, scope) => push(<PaletteView palette={name} scopeEnv={scope} />),
      });
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
              onAction={() => setDetailOverride(!showDetail)}
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
          {value && (
            <Action.Paste
              title="Paste Value"
              content={value}
              shortcut={{ modifiers: ["cmd", "shift"], key: "v" }}
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
          {!pluginOrdered && (
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

  const scope = filters.length ? (
    <List.Dropdown tooltip="Scope" value={scopeId} onChange={setFilter}>
      {filters.map((f) => (
        <List.Dropdown.Item
          key={f.id}
          value={f.id}
          title={f.name ?? f.id}
          icon={resolveIcon(f) ?? undefined}
        />
      ))}
    </List.Dropdown>
  ) : undefined;

  const navigationTitle = meta?.desc ? `${palette} - ${meta.desc}` : palette;
  const placeholder = isInput
    ? (meta?.input_prompt ?? `Type to query ${palette}`)
    : `Search ${palette}`;

  // Items are gated on `!!meta`, so a meta failure would otherwise leave this
  // branch unreached and the only report a toast - which is lost outright if
  // Raycast has already torn the channel down. Show whichever failed.
  const failure = error ?? metaError;
  if (failure) {
    return (
      <List navigationTitle={navigationTitle}>
        <List.EmptyView
          icon={{ source: Icon.Warning, tintColor: Color.Red }}
          title={error ? `Could not list "${palette}"` : `Could not load "${palette}"`}
          description={String(failure.message ?? failure).slice(0, 500)}
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
        columns={meta.display?.columns ?? 8}
        aspectRatio={gridAspect(meta.display?.aspect)}
        fit={GRID_FIT[meta.display?.fit ?? ""] ?? Grid.Fit.Contain}
        inset={GRID_INSET[meta.display?.inset ?? ""] ?? Grid.Inset.Small}
        searchBarAccessory={scope}
        filtering={!isInput}
        throttle={isInput}
        searchText={searchText}
        onSearchTextChange={setSearchText}
      >
        {groups.map(([section, sectionItems]) => (
          <Grid.Section
            key={section ?? "_"}
            title={section ?? undefined}
            subtitle={sectionCount(section, sectionItems.length)}
          >
            {sectionItems.map((item) => (
              <Grid.Item
                key={item.id}
                id={item.id}
                content={gridContent(item, iconSourceFor(item))}
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
      searchText={searchText}
      onSearchTextChange={setSearchText}
      onSelectionChange={setSelectedId}
      searchBarAccessory={scope}
      isShowingDetail={showDetail && hasDetail}
    >
      <OutOfSync palettes={unsynced} onSynced={revalidate} />
      {groups.map(([section, sectionItems]) => (
        <List.Section
          key={section ?? "_"}
          title={section ?? undefined}
          subtitle={sectionCount(section, sectionItems.length)}
        >
          {sectionItems.map((item) => (
            <List.Item
              key={item.id}
              id={item.id}
              title={item.name}
              subtitle={showDetail ? undefined : (item.subtitle ?? item.desc)}
              keywords={item.keywords}
              icon={listIcon(item, iconSourceFor(item))}
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

const GRID_FIT: Record<string, Grid.Fit> = { contain: Grid.Fit.Contain, fill: Grid.Fit.Fill };
const GRID_INSET: Record<string, Grid.Inset> = {
  none: Grid.Inset.Zero,
  zero: Grid.Inset.Zero,
  small: Grid.Inset.Small,
  medium: Grid.Inset.Medium,
  large: Grid.Inset.Large,
};
const GRID_ASPECTS = ["1", "3/2", "2/3", "4/3", "3/4", "16/9", "9/16"] as const;

function gridAspect(value?: string | null): Grid.AspectRatio | undefined {
  return GRID_ASPECTS.find((a) => a === value);
}

/**
 * An item's icon, plus the two things only a rich frontend can do with it -
 * round it, and explain it on hover.
 */
function listIcon(item: PalItem, source?: PaletteMeta | null) {
  const icon = withMask(itemIcon(item, source), item.mask);
  return item.tooltip ? { value: icon, tooltip: item.tooltip } : icon;
}

/** Named sections carry their size; an unnamed catch-all has nothing to say. */
function sectionCount(section: string | null, count: number): string | undefined {
  return section ? String(count) : undefined;
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
