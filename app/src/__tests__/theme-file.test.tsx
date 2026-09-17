// @vitest-environment happy-dom
// The theme file (pal_core::theme, theme.rs) on the page: `applyThemeFile`
// sets the scheme's variables on the root and swaps them when the scheme
// flips, and Settings > General draws the picker with the folder's
// themes, the file's name and its complaints.
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.hoisted(() => { (globalThis as { window?: unknown }).window ??= globalThis; });
import { applyThemeFile, schemeInForce, type ThemeFile } from "../theme";
import { SettingsGeneral } from "../ui/SettingsGeneral";
import type { ThemeFileStatus } from "../ui/SettingsTheme";
import type { GeneralConfig } from "../ui/SettingsTypes";

const file: ThemeFile = { file: "/cfg/themes/t.toml", theme: { name: "T", light: { "--pal-accent": "#8839ef", "--pal-bg": "#eff1f5", "color": "red" }, dark: { "--pal-accent": "#ca9ee6" } }, diagnostics: [] };

describe("applyThemeFile", () => {
  it("sets the variables of the scheme in force, swaps on a flip, clears on none", () => {
    const el = document.createElement("div");
    el.dataset.theme = "light";
    expect(schemeInForce(el)).toBe("light");
    applyThemeFile(file, el);
    expect(el.style.getPropertyValue("--pal-accent")).toBe("#8839ef");
    expect(el.style.getPropertyValue("--pal-bg")).toBe("#eff1f5");
    // Only --pal-* variables are set.
    expect(el.style.getPropertyValue("color")).toBe("");
    el.dataset.theme = "dark";
    applyThemeFile(file, el);
    expect(el.style.getPropertyValue("--pal-accent")).toBe("#ca9ee6");
    // The light section's variables are gone.
    expect(el.style.getPropertyValue("--pal-bg")).toBe("");
    applyThemeFile(null, el);
    expect(el.style.getPropertyValue("--pal-accent")).toBe("");
  });
  it("follows the OS scheme when nothing is pinned", () => {
    const el = document.createElement("div");
    expect(["light", "dark"]).toContain(schemeInForce(el));
  });
});

const general: GeneralConfig = { hotkeys: ["cmd+space"], theme: "system", launchAtLogin: false, menuBarIcon: true, position: "top", askPermissionsOnStart: true, backspaceBack: true };
const status = (over: Partial<ThemeFileStatus> = {}): ThemeFileStatus => ({ setting: "", diagnostics: [], dir: "/cfg/pal/themes", themes: [{ name: "catppuccin-frappe", path: "/cfg/pal/themes/catppuccin-frappe.toml", title: "Catppuccin Frappé" }, { name: "mine", path: "/cfg/pal/themes/mine.toml", title: "mine" }], ...over });
const page = (s: ThemeFileStatus) => renderToStaticMarkup(<SettingsGeneral value={general} onChange={() => {}} file={{ path: "~/.config/pal/config.toml" }} themeFile={{ status: s, onChange: () => {}, onEdit: () => {}, onOpenDir: () => {} }} />);

describe("the theme file picker", () => {
  it("lists pal's own and the folder's themes by title, and offers the folder when none is set", () => {
    const html = page(status());
    expect(html).toContain("pal&#x27;s own");
    expect(html).toContain("Catppuccin Frappé (catppuccin-frappe)");
    expect(html).toContain('value="mine"');
    expect(html).toContain("Open themes folder");
    expect(html).not.toContain("Edit theme file");
    expect(html).toContain("/cfg/pal/themes");
  });
  it("names the file set, offers to edit it, and lists a path outside the folder as itself", () => {
    const html = page(status({ setting: "catppuccin-frappe", file: "/cfg/pal/themes/catppuccin-frappe.toml", name: "Catppuccin Frappé" }));
    expect(html).toContain("Edit theme file");
    expect(html).toContain("Catppuccin Frappé, /cfg/pal/themes/catppuccin-frappe.toml");
    const outside = page(status({ setting: "~/dotfiles/pal.toml", file: "/Users/x/dotfiles/pal.toml", name: "Dots" }));
    expect(outside).toContain('value="~/dotfiles/pal.toml"');
  });
  it("shows the file's complaints: an error with its line, ignored keys with their reasons", () => {
    const html = page(status({ setting: "mine", file: "/cfg/pal/themes/mine.toml", diagnostics: [{ level: "error", path: "", line: 3, message: "expected `]`" }] }));
    expect(html).toContain("line 3: expected `]`");
    expect(html).not.toContain("keys ignored");
    const warned = page(status({ setting: "mine", file: "/cfg/pal/themes/mine.toml", name: "mine", diagnostics: [{ level: "warning", path: "light.accnet", message: "not a theme token; docs/config.md lists them" }, { level: "warning", path: "dark.accent", message: "ignored: expected a colour: #rrggbb, #rrggbbaa, or rgb()/hsl()" }] }));
    expect(warned).toContain("2 keys ignored: light.accnet (not a theme token; docs/config.md lists them); dark.accent (ignored: expected a colour");
  });
  it("draws no row when the picker is not wired (the gallery without a fixture)", () => {
    expect(renderToStaticMarkup(<SettingsGeneral value={general} onChange={() => {}} file={{ path: "x" }} />)).not.toContain("Theme file");
  });
});
