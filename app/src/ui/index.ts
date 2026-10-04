import "./fonts.css";
import "./tokens.css";
// After tokens.css: a design overrides its values (designs/index.ts).
import "./designs";
import "./ui.css";
import "./icons.css";

// Types live in ./types (component names Icon and Detail would shadow them here).

export { Panel } from "./Panel";
export { Search } from "./Search";
export { List, type Hit, type ListHandle } from "./List";
export { Grid } from "./Grid";
export { Row, Highlight, Accessory } from "./Row";
export { Icon } from "./Icon";
export { Kbd } from "./Kbd";
export { Detail } from "./Detail";
export { View, hasSurface } from "./View";
export { SurfaceContext, type SurfaceHandle, type SurfaceHost } from "./Surface";
export { ActionPanel, actionShortcut } from "./ActionPanel";
export { Footer, Hints } from "./Footer";
export { Form, useSubmitKey } from "./Form";
export { Confirm } from "./Confirm";
export { Empty, Skeleton } from "./Empty";
export { Toast, type ToastSpec } from "./Toast";
export { Hud } from "./Hud";
export { Presence } from "./presence";
export { useNavStack, type NavStack } from "./nav";
export { followCursor, useCursor, type Cursor } from "./cursor";
export { anchorOf, idsOf, isMarked, mark, markRange, markable, multiActions, pickIds, prune, step, toggle, viewCursor, viewMarks, type Selection } from "./selection";
export { useKeys, useCmdHeld, keepFocus, grammar, shortcutsOf, hasShortcut, shiftedArrow, isMac, type Command, type Handlers } from "./keys";
export { groupBySection, domId } from "./virtual";
export { relativeDate, shortcutKeys, graphemePositions } from "./format";
import "./bar-strip.css";
export { BarStrip, MenuBar, Sketchybar, shapeItem, clipText, defaultLook, type BarStripItem, type BarStripTarget, type BarStripTheme, type BarLook } from "./BarStrip";
import "./settings.css";
export { SettingsWindow, settingsPages, pageTitle, flashAnchor } from "./SettingsWindow";
export { SettingsOverview, overviewItems, overviewFacts, overviewIndex, type OverviewInput, type OverviewItem } from "./SettingsOverview";
export { SettingsGeneral, generalIndex, USAGE_DOC } from "./SettingsGeneral";
export { SettingsShortcuts, shortcutsIndex, bindings, clashOf, type Binding } from "./SettingsShortcuts";
export { SettingsThemeFile, useThemeFile, type ThemeFileProps, type ThemeFileStatus } from "./SettingsTheme";
export { ExtensionPalettes, palettesIndex, paletteIcon, HoldControl, HOLD_HELP, type PaletteItem } from "./SettingsPalettes";
export { SettingsSidebar, sidebarIndex, sidebarSummary, SIDEBAR_HELP, type SettingsSidebarProps } from "./SettingsSidebar";
export { SettingsFeatures, featuresIndex, type SettingsFeature, type SettingsFeaturesProps } from "./SettingsFeatures";
export { SettingsGroups, groupsIndex, isDevice, nextTitle, bindingsOnJoin, type GroupControl, type GroupDevice, type DeviceGroup, type DeviceOffer, type SettingsGroupsProps } from "./SettingsGroups";
export { SettingsExtensions, extensionsIndex, byName, forgetText } from "./SettingsExtensions";
export { needsOf, browseRows, registryLine, refsLine, originLine, statusText, buildLine, toMs, type ExtensionsStore, type Need } from "./SettingsStore";
export { SettingsBar, barIndex, BAR_DEFAULTS } from "./SettingsBar";
export { SettingsAbout, aboutIndex, copyText, installing, progressLine, type CrashReport, type PanicReport, type ReportKind, type UpdateInfo, type UpdateProgress } from "./SettingsAbout";
export { SettingsList, type SettingsListItem } from "./SettingsList";
export { SettingsField, SettingsRow, SettingsGroup, SettingsDivider, SettingsDisclosure, SettingsSwitch, SettingsHotkey, SettingsSegment, SettingsSelect, LocalKeys, AbsentKeys, LocalNote, localMatcher, keySegments, quoteKey } from "./SettingsField";
export { SettingsAccount, accountIndex, byDay, summary, type AccountState, type AccountDevice, type SyncRev, type RestoreTarget, type SettingsAccountProps } from "./SettingsAccount";
export { SettingsDiagnostics } from "./SettingsDiagnostics";
export { describeDefault, hotkeyList, isModified, leavesFile, needsSetup, permissionRows, permissionUsers, storePermissions, type PermissionUser } from "./SettingsTypes";
export type {
  SettingSpec, SettingValue, SettingValues, SettingOption, PaletteConfig, PaletteTier, PaletteKey, Screenshot, SettingsPalette, SettingsExtension,
  GeneralConfig, HotkeyStatus, PermissionsStatus, PermissionId, PermissionRow, PromptPermission, ConfigFileInfo, Diagnostic, SettingsPage, SettingsIndexEntry,
  BarTarget, BarShow, BarConfig, BarItemConfig, BarItem, BarRuleEffect, BarRuleView, BarStateView, BarLookConfig, BarLookOverride, BarBadgeStyle, BarFont, SidebarConfig, SidebarEdge,
} from "./SettingsTypes";
export { resolveLook, lookDefaults, lookOf, lookWrites, LOOK_KEYS, holdOf, sidebarDefaults, SIDEBAR_WINDOWS } from "./SettingsTypes";
export { badgedIcon, instanceBadge, instanceTint, instancesOf, ownBrand, resolveInstance, slugSuffix, suffixProblem, suffixTitle, validSuffix, type InstanceInfo, type RawInstance, type SettingsInstance } from "./SettingsTypes";
export { DESIGNS, designOf, type Design } from "./designs";
