import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

afterEach(() => vi.useRealTimers());

// Icon glyphs read `window` at import; no DOM is needed for markup checks.
vi.hoisted(() => { (globalThis as { window?: unknown }).window ??= globalThis; });
import { SettingsWindow, settingsPages } from "../SettingsWindow";
import { SettingsPalettes, palettesIndex } from "../SettingsPalettes";
import { SettingsExtensions, extensionsIndex } from "../SettingsExtensions";
import { SettingsAbout } from "../SettingsAbout";
import { settingsExtensions } from "../../gallery/data";
import { homeAssistant } from "./settings-fixtures";

const noop = () => {};
const count = (html: string, re: RegExp) => html.match(re)?.length ?? 0;

describe("SettingsWindow", () => {
  it("puts the eight pages on the toolbar as tabs, the current one selected", () => {
    const html = renderToStaticMarkup(<SettingsWindow page="palettes" onPage={noop}><p>body</p></SettingsWindow>);
    expect(settingsPages.map((p) => p.id)).toEqual(["overview", "general", "shortcuts", "features", "palettes", "extensions", "bar", "about"]);
    expect(count(html, /role="tab"/g)).toBe(8);
    expect(count(html, /aria-selected="true"/g)).toBe(1);
    expect(html).toContain('data-nav="palettes" tabindex="0"');
    expect(html).toContain("data-tauri-drag-region");
    expect(html).toContain("body");
    // No sidebar, no page heading: the tab is the title.
    expect(html).not.toContain("pal-settings__nav");
    expect(html).not.toContain("<h2");
    // The tabs say their shortcut.
    expect(html).toMatch(/title="Overview \((⌘|Ctrl\+)1\)"/);
  });
  it("marks the Overview tab while something needs attention", () => {
    expect(renderToStaticMarkup(<SettingsWindow page="general" onPage={noop} attention={2}>x</SettingsWindow>)).toContain("pal-settings__tab-dot");
    expect(renderToStaticMarkup(<SettingsWindow page="general" onPage={noop} attention={0}>x</SettingsWindow>)).not.toContain("pal-settings__tab-dot");
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
  it("indexes palettes and extensions by name with an anchor the page carries", () => {
    const idx = [...palettesIndex(settingsExtensions), ...extensionsIndex(settingsExtensions)];
    // The gallery's GitHub has two instances: each is its own group, labelled with the instance.
    const pr = idx.find((e) => e.label === "GitHub › Pull requests (Personal)");
    expect(pr?.anchor).toBe("palettes:github-prs");
    expect(pr?.keywords).toContain("pr");
    expect(idx.find((e) => e.label === "Mine only")?.anchor).toBe("palettes:github-prs:mine");
    expect(idx.find((e) => e.page === "extensions" && e.label === "Token")?.anchor).toBe("extensions:github:token");
    const html = renderToStaticMarkup(<SettingsPalettes extensions={settingsExtensions} selected="github-prs" onSelect={noop} onChange={noop} />);
    expect(html).toContain('data-anchor="palettes:github-prs"');
    expect(html).toContain('data-anchor="palettes:github-prs:mine"');
  });
});

describe("SettingsPalettes", () => {
  const page = (selected?: string) => renderToStaticMarkup(<SettingsPalettes extensions={settingsExtensions} selected={selected} onSelect={noop} onChange={noop} onOpenExtension={noop} />);
  it("lists every palette under its extension's header, the row reading extension › palette; a lone palette is one row", () => {
    const html = page("github-prs");
    // Applications and Clipboard have one palette each: no header, the tagline under the row's name. GitHub's two instances are two groups.
    expect(count(html, /class="pal-ptable__head"/g)).toBe(3);
    expect(html).toContain('data-anchor="palettes:ext:github@work"');
    expect(html).toContain('<span class="pal-ptable__name-ext">GitHub › </span>Pull requests (Work)');
    expect(html).toContain('<span class="pal-ptable__name-ext">Clipboard › </span>Clipboard history');
    expect(html).toContain('data-solo="true"');
    expect(html).toContain('<span class="pal-ptable__sub">Installed apps and system settings panes, with their real icons.</span>');
    expect(count(html, /data-palette-row=/g)).toBe(10);
    expect(html).toContain('data-palette-row="github-prs" data-anchor="palettes:github-prs" data-active="true"');
    expect(html).toContain('<span class="pal-ptable__name-ext">GitHub › </span>Pull requests (Personal)');
    expect(html).toContain("Pull requests, issues and repositories you can see with the token you give it.");
    expect(html).toContain("10 of 10");
    for (const col of ["Palette", "On", "Alias", "Hotkey", "Icon"]) expect(html).toContain(`<span>${col}</span>`);
  });
  it("puts the selected palette in the pane: crumb, description, id, rank, and its declared settings", () => {
    const html = page("github-prs");
    expect(html).toContain('class="pal-ppane__crumb"');
    expect(html).toContain('class="pal-ppane__title">Pull requests (Personal)</h3>');
    expect(html).toContain("Open pull requests across the organisation, newest first.");
    expect(html).toContain("<code>github-prs</code>");
    expect(html).toContain("At the root");
    expect(html).toContain('value="normal"');
    expect(html).toContain("palettes.github-prs.settings");
    expect(html).toContain("Mine only");
    expect(page("github-issues")).toContain("GitHub declares none for this palette.");
  });
  it("says an off palette is off", () => {
    expect(page("tabs")).toContain("Off: no rows at the root");
  });
  it("selects the first palette when nothing is selected", () => {
    expect(page()).toContain('data-palette-row="apps" data-anchor="palettes:apps" data-active="true"');
  });
  it("has an empty state without extensions", () => {
    expect(renderToStaticMarkup(<SettingsPalettes extensions={[]} onSelect={noop} onChange={noop} />)).toContain("No extensions");
  });
});

describe("SettingsExtensions", () => {
  it("shows the store's hero, the settings, the palettes, and Update and Remove in the pane's footer", () => {
    const html = renderToStaticMarkup(<SettingsExtensions extensions={settingsExtensions} selected="github" onSelect={noop} onChange={noop} onInstall={async () => {}} onUpdate={noop} onRemove={noop} onOpenLink={noop} onOpenPalette={noop} />);
    expect(html).toContain('class="pal-install__field"');
    expect(html).toContain(">Install</button>");
    expect(html).toContain('class="pal-xpane__hero"');
    expect(html).toContain('class="pal-xpane__title">GitHub</h3>');
    expect(html).toContain("v1.4.2");
    expect(html).toContain("1.5.0 available");
    expect(html).toContain('data-anchor="extensions:github:token"');
    expect(html).toContain('class="pal-xpane__palette"');
    expect(count(html, /class="pal-xpane__palette"/g)).toBe(3);
    expect(html).toContain('class="pal-pane__foot"');
    expect(html).toContain("Update to 1.5.0");
    expect(html).toContain(">Remove</button>");
  });
  it("gives a built-in extension no footer and a store link", () => {
    const exts = settingsExtensions.map((e) => (e.name === "apps" ? { ...e, storeUrl: "https://pal.cagdas.io/extensions/apps" } : e));
    const html = renderToStaticMarkup(<SettingsExtensions extensions={exts} selected="apps" onSelect={noop} onChange={noop} onUpdate={noop} onRemove={noop} onOpenLink={noop} />);
    expect(html).not.toContain("pal-pane__foot");
    expect(html).toContain("built in");
    expect(html).toContain(">Store page</button>");
  });
  it("calls out what is missing, the load error and the manifest warnings", () => {
    const html = renderToStaticMarkup(<SettingsExtensions extensions={[homeAssistant]} selected="home-assistant" onSelect={noop} onChange={noop} />);
    expect(html).toContain("Nothing lists until url and token are set below.");
    expect(html).toContain('data-anchor="extensions:home-assistant:url" data-missing="true"');
    expect(html).toContain('>setup</span>');
    const broken = { ...homeAssistant, loaded: false, error: "SyntaxError: unexpected token", warnings: ["palette main: kind says live, the code implies list"] };
    const html2 = renderToStaticMarkup(<SettingsExtensions extensions={[broken]} selected="home-assistant" onSelect={noop} onChange={noop} />);
    expect(html2).toContain("Failed to load.");
    expect(html2).toContain("SyntaxError: unexpected token");
    expect(html2).toContain("kind says live");
    expect(html2).not.toContain("Nothing lists until");
  });
  it("lists the screenshots when the extension ships them", () => {
    const ext = { ...settingsExtensions[2], screenshots: [{ src: "icon://localhost/shot?ext=github&file=1-prs.png&size=0", caption: "Pull Requests" }, { src: "icon://localhost/shot?ext=github&file=bar.png&size=0", kind: "bar" }] };
    const html = renderToStaticMarkup(<SettingsExtensions extensions={[ext]} selected="github" onSelect={noop} onChange={noop} />);
    expect(count(html, /class="pal-xpane__shot"/g)).toBe(1);
    expect(html).toContain("<figcaption>Pull Requests</figcaption>");
  });
  it("has an empty state without extensions", () => {
    expect(renderToStaticMarkup(<SettingsExtensions extensions={[]} onSelect={noop} onChange={noop} onInstall={async () => {}} />)).toContain("Install one from GitHub above");
  });
});

describe("SettingsAbout", () => {
  it("shows the version, the update check, the links and the diagnostics copy", () => {
    const html = renderToStaticMarkup(<SettingsAbout version="0.1.0" file="~/.config/pal/config.toml" links={{ docs: "https://example.test/docs", repo: "https://github.com/zcag/pal" }} onCheckUpdates={async () => ({ available: false })} onOpenLink={noop} onRevealFile={noop} diagnosticsText={() => "pal 0.1.0"} />);
    expect(html).toContain("Version 0.1.0");
    expect(html).toContain("Check for Updates");
    expect(html).toContain("github.com/zcag/pal");
    expect(html).toContain("~/.config/pal/config.toml");
    expect(html).toContain("Copy Diagnostics");
    expect(html).toContain('data-anchor="about:updates"');
    expect(html).toContain("Licences");
    expect(html).toContain("None recorded.");
  });
  it("shows the last crash and panic with their actions", () => {
    vi.useFakeTimers({ now: new Date("2026-09-16T17:40:00Z") });
    const at = Date.now() - 3 * 3600 * 1000;
    const html = renderToStaticMarkup(<SettingsAbout version="0.1.0" file="~/.config/pal/config.toml" links={{ docs: "", repo: "https://github.com/zcag/pal" }}
      crash={{ at, kind: "EXC_BREAKPOINT (SIGTRAP)", path: "/Users/u/Library/Logs/DiagnosticReports/pal-2026-09-16-144017.ips" }}
      panic={{ at, message: "index out of bounds", path: "/Users/u/Library/Application Support/pal/default/last-panic.txt" }}
      onOpenReport={noop} onRevealReport={noop} />);
    expect(html).toContain("Last crash");
    expect(html).toContain("3h ago</time>, EXC_BREAKPOINT (SIGTRAP)");
    expect(html).toContain("Last panic");
    expect(html).toContain("index out of bounds");
    expect(html).toContain("Open Report");
    expect(html).toContain("Copy Path");
    expect(html).not.toContain("None recorded.");
    // Linux: a coredumpctl entry has no file, so no file actions.
    const linux = renderToStaticMarkup(<SettingsAbout version="0.1.0" file="" links={{ docs: "", repo: "" }} crash={{ at, kind: "signal 11" }} onOpenReport={noop} />);
    expect(linux).toContain("signal 11");
    expect(linux).not.toContain("Open Report");
  });
});
