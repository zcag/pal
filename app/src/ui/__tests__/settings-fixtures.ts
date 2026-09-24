/* Fixtures the settings tests share beyond the gallery's four extensions: bar items, permissions, an extension that needs setup. */
import type { BarItem, PermissionsStatus, SettingsExtension } from "../SettingsTypes";

export const allGranted: PermissionsStatus = { accessibility: true, calendar: "granted", full_disk_access: true, input_monitoring: true, location: "granted" };
export const nothingGranted: PermissionsStatus = { accessibility: false, calendar: "not_determined", full_disk_access: false, input_monitoring: false, location: "not_determined" };

/** Home Assistant as installed with nothing filled in: url and token are what it cannot work without. */
export const homeAssistant: SettingsExtension = {
  name: "home-assistant",
  key: "home-assistant",
  title: "Home Assistant",
  description: "Lights, switches, scenes and sensors from your Home Assistant.",
  tagline: "Your home's entities as rows.",
  version: "0.1.0",
  repo: "bundled",
  bundled: true,
  settings: [
    { kind: "text", id: "url", label: "URL", required: true, description: "Where Home Assistant answers, scheme included; no trailing slash needed.", placeholder: "http://homeassistant.local:8123", default: "" },
    { kind: "secret", id: "token", label: "Token", required: true, description: "A long-lived access token (your profile in HA, Security, Long-lived access tokens). Stored in the keychain.", default: "" },
  ],
  values: {},
  palettes: [{ id: "home-assistant", title: "Home Assistant", settings: [], config: { enabled: true, settings: {} } }],
};

export const otp: SettingsExtension = { name: "otp", key: "otp", title: "Verification codes", description: "Codes from Messages.", version: "0.1.0", repo: "bundled", bundled: true, settings: [], values: {}, palettes: [{ id: "otp", title: "Verification codes", settings: [], config: { enabled: true, settings: {} } }] };

export const barItems: BarItem[] = [
  { key: "github/notifications", extension: "github", id: "notifications", title: "Notifications", description: "The unread count as a badge, hidden at zero.", extTitle: "GitHub", source: true, refreshEvery: 300, renderedAt: Math.floor(Date.now() / 1000) - 120, stale: false, state: { hidden: false, badge: 3, urgent: false, icon: "\u{f09b}", tooltip: "3 unread" }, config: { enabled: true, look: {} } },
  { key: "timer/running", extension: "timer", id: "running", title: "Running timers", extTitle: "Timer", source: true, refreshEvery: 60, renderedAt: Math.floor(Date.now() / 1000) - 3600, stale: true, state: { title: "tea 12:00", hidden: false, urgent: false, icon: "\u{f0954}", progress: 0.4, color: "amber" }, mocks: [{ id: "done", title: "Timer finished", item: { title: "tea done", hidden: false, urgent: true, icon: "\u{f0954}", color: "red" } }], config: { enabled: true, target: "sketchybar", position: "left", hotkey: "ctrl+alt+t", openOnHover: false, order: 2, look: { font: "mono", width: 64 } } },
  { key: "docker/containers", extension: "docker", id: "containers", title: "Containers", extTitle: "Docker", source: false, stale: false, config: { enabled: true, look: {} } },
];

/** An item with nothing to say that offers a quiet shape (`BarItem.empty`), kept on the strip by `show = "always"`. */
export const quietItem: BarItem = { key: "gmail/unread", extension: "gmail", id: "unread", title: "Unread", extTitle: "Gmail", source: true, refreshEvery: 120, renderedAt: Math.floor(Date.now() / 1000) - 60, stale: false, state: { hidden: true, urgent: false, empty: { icon: "\u{f01ee}", tooltip: "No unread mail" } }, mocks: [{ id: "unread", title: "3 unread", item: { hidden: false, urgent: false, icon: "\u{f01ee}", badge: 3 } }], config: { enabled: true, show: "always", look: {} } };

/** Power's battery item with its rules (docs/design/states.md): the extension's three, one changed in the file, one of the user's own; the facts it publishes. */
export const ruledItem: BarItem = {
  key: "power/battery", extension: "power", id: "battery", title: "Battery", extTitle: "Power", source: true, refreshEvery: 60, renderedAt: Math.floor(Date.now() / 1000) - 30, stale: false,
  state: { hidden: false, urgent: false, icon: "\u{f0079}", title: "42%", color: "amber" },
  states: [{ name: "level", value: 42, description: "Charge, percent" }, { name: "charging", value: false }, { name: "draw", value: 4.2, description: "Watts, while on battery" }],
  rules: [
    { id: "fine", when: "not power.charging and power.level >= 50", description: "Nothing to say on a healthy battery.", effect: { hidden: true }, default: { when: "not power.charging and power.level >= 50", effect: { hidden: true } }, overridden: false, active: false },
    { id: "low", when: "power.level < 25", effect: { color: "red", urgent: true }, default: { when: "power.level < 15", effect: { color: "red", urgent: true } }, overridden: true, active: false },
    { id: "warn", when: "power.level < 50", effect: { color: "amber" }, default: { when: "power.level < 50", effect: { color: "amber" } }, overridden: false, active: true },
    { id: "focus", when: "not working", effect: { hidden: true }, overridden: true, active: false },
  ],
  config: { enabled: true, look: {} },
};
