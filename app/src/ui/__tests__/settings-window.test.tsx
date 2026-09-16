import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// Icon glyphs read `window` at import; no DOM is needed for markup checks.
vi.hoisted(() => { (globalThis as { window?: unknown }).window ??= globalThis; });
import { SettingsWindow, settingsPages } from "../SettingsWindow";
import { SettingsPalettes } from "../SettingsPalettes";
import { SettingsExtensions } from "../SettingsExtensions";
import { SettingsAbout } from "../SettingsAbout";
import { settingsExtensions } from "../../gallery/data";

const noop = () => {};
const count = (html: string, re: RegExp) => html.match(re)?.length ?? 0;

describe("SettingsWindow", () => {
  it("puts the four pages on the toolbar as tabs, the current one selected", () => {
    const html = renderToStaticMarkup(<SettingsWindow page="palettes" onPage={noop}><p>body</p></SettingsWindow>);
    expect(settingsPages.map((p) => p.id)).toEqual(["general", "palettes", "extensions", "about"]);
    expect(count(html, /role="tab"/g)).toBe(4);
    expect(count(html, /aria-selected="true"/g)).toBe(1);
    expect(html).toContain('data-nav="palettes" tabindex="0"');
    expect(html).toContain("data-tauri-drag-region");
    expect(html).toContain("body");
    // No sidebar, no page heading: the tab is the title.
    expect(html).not.toContain("pal-settings__nav");
    expect(html).not.toContain("<h2");
  });
  it("reserves the traffic lights' corner only on macOS", () => {
    expect(renderToStaticMarkup(<SettingsWindow page="general" onPage={noop} mac>x</SettingsWindow>)).toContain('data-mac="true"');
    expect(renderToStaticMarkup(<SettingsWindow page="general" onPage={noop}>x</SettingsWindow>)).not.toContain("data-mac");
  });
  it("shows the last error under the page", () => {
    const html = renderToStaticMarkup(<SettingsWindow page="general" onPage={noop} aside={<span role="alert">general.hotkey: refused</span>}>x</SettingsWindow>);
    expect(html).toContain('class="pal-settings__aside"');
    expect(html).toContain("general.hotkey: refused");
  });
});

describe("SettingsPalettes", () => {
  const page = (selected?: string) => renderToStaticMarkup(<SettingsPalettes extensions={settingsExtensions} selected={selected} onSelect={noop} onChange={noop} />);
  it("lists the extensions on the left and the selected palette's extension's table on the right", () => {
    const html = page("github-prs");
    expect(count(html, /role="option"/g)).toBe(settingsExtensions.length);
    expect(html).toContain('data-item="github" data-active="true"');
    expect(count(html, /data-palette-row=/g)).toBe(3);
    for (const col of ["Palette", "Enabled", "Alias", "Hotkey", "Icon"]) expect(html).toContain(`>${col}</span>`);
    expect(html).toContain('data-palette-row="github-prs" data-active="true"');
  });
  it("puts the selected palette's declared settings under the table", () => {
    const html = page("github-prs");
    expect(html).toContain("Pull requests settings");
    expect(html).toContain("palettes.github-prs.settings");
    expect(html).toContain("Mine only");
    expect(page("github-issues")).toContain("GitHub declares no settings for Issues.");
  });
  it("opens the first extension when nothing is selected", () => {
    expect(page()).toContain('data-item="apps" data-active="true"');
  });
});

describe("SettingsExtensions", () => {
  it("has the install field with its button, and Update and Remove in the pane's footer", () => {
    const html = renderToStaticMarkup(<SettingsExtensions extensions={settingsExtensions} selected="github" onSelect={noop} onChange={noop} onInstall={async () => {}} onUpdate={noop} onRemove={noop} />);
    expect(html).toContain('class="pal-install__field"');
    expect(html).toContain(">Install</button>");
    expect(html).toContain('class="pal-pane__foot"');
    expect(html).toContain("Update to 1.5.0");
    expect(html).toContain(">Remove</button>");
    expect(html).toContain("1.4.2");
  });
  it("gives a built-in extension no footer", () => {
    const html = renderToStaticMarkup(<SettingsExtensions extensions={settingsExtensions} selected="apps" onSelect={noop} onChange={noop} onUpdate={noop} onRemove={noop} />);
    expect(html).not.toContain("pal-pane__foot");
    expect(html).toContain("built in");
  });
});

describe("SettingsAbout", () => {
  it("shows the version, the update check and the links", () => {
    const html = renderToStaticMarkup(<SettingsAbout version="0.1.0" file="~/.config/pal/config.toml" links={{ docs: "https://example.test/docs", repo: "https://github.com/zcag/pal" }} onCheckUpdates={async () => ({ available: false })} onOpenLink={noop} onRevealFile={noop} />);
    expect(html).toContain("Version 0.1.0");
    expect(html).toContain("Check for Updates");
    expect(html).toContain("github.com/zcag/pal");
    expect(html).toContain("~/.config/pal/config.toml");
    expect(html).toContain("Licences");
  });
});
