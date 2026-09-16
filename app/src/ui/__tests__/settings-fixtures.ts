/* Fixtures the settings tests share beyond the gallery's four extensions: bar items, permissions, an extension that needs setup. */
import type { BarItem, PermissionsStatus, SettingsExtension } from "../SettingsTypes";

export const allGranted: PermissionsStatus = { accessibility: true, calendar: "granted", full_disk_access: true, input_monitoring: true, location: "granted" };
export const nothingGranted: PermissionsStatus = { accessibility: false, calendar: "not_determined", full_disk_access: false, input_monitoring: false, location: "not_determined" };

/** Home Assistant as installed with nothing filled in: url and token are what it cannot work without. */
export const homeAssistant: SettingsExtension = {
  name: "home-assistant",
  title: "Home Assistant",
  description: "Lights, switches, scenes and sensors from your Home Assistant.",
  tagline: "Your home's entities as rows.",
  version: "0.1.0",
  repo: "bundled",
  bundled: true,
  settings: [
    { kind: "text", id: "url", label: "URL", description: "Where Home Assistant answers, scheme included; no trailing slash needed.", placeholder: "http://homeassistant.local:8123", default: "" },
    { kind: "secret", id: "token", label: "Token", description: "A long-lived access token (your profile in HA, Security, Long-lived access tokens). Stored in the keychain.", default: "" },
  ],
  values: {},
  palettes: [{ id: "home-assistant", title: "Home Assistant", settings: [], config: { enabled: true, settings: {} } }],
};

export const otp: SettingsExtension = { name: "otp", title: "Verification codes", description: "Codes from Messages.", version: "0.1.0", repo: "bundled", bundled: true, settings: [], values: {}, palettes: [{ id: "otp", title: "Verification codes", settings: [], config: { enabled: true, settings: {} } }] };

export const barItems: BarItem[] = [
  { key: "github/notifications", extension: "github", id: "notifications", title: "Notifications", description: "The unread count as a badge, hidden at zero.", extTitle: "GitHub", source: true, refreshEvery: 300, renderedAt: Math.floor(Date.now() / 1000) - 120, stale: false, state: { hidden: false, badge: 3, urgent: false }, config: { enabled: true } },
  { key: "timer/running", extension: "timer", id: "running", title: "Running timers", extTitle: "Timer", source: true, refreshEvery: 60, renderedAt: Math.floor(Date.now() / 1000) - 3600, stale: true, state: { title: "tea 12:00", hidden: false, urgent: false }, config: { enabled: true, target: "sketchybar", position: "left", hotkey: "ctrl+alt+t", openOnHover: false, order: 2 } },
  { key: "docker/containers", extension: "docker", id: "containers", title: "Containers", extTitle: "Docker", source: false, stale: false, config: { enabled: true } },
];
