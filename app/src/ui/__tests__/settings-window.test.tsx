import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

afterEach(() => vi.useRealTimers());

// Icon glyphs read `window` at import; no DOM is needed for markup checks.
vi.hoisted(() => { (globalThis as { window?: unknown }).window ??= globalThis; });
import { SettingsWindow, settingsPages } from "../SettingsWindow";
import { ExtensionPalettes, palettesIndex } from "../SettingsPalettes";
import { SettingsExtensions, extensionsIndex, forgetText } from "../SettingsExtensions";
import type { ExtensionsStore } from "../SettingsStore";
import { EMPTY_STORE } from "../../store";
import { SettingsAbout } from "../SettingsAbout";
import { barItems } from "./settings-fixtures";
import { settingsExtensions, settingsStore, storeExtensions, storeReferences } from "../../gallery/data";
import { homeAssistant } from "./settings-fixtures";

const noop = () => {};
const count = (html: string, re: RegExp) => html.match(re)?.length ?? 0;

describe("SettingsWindow", () => {
  it("puts the seven pages on the toolbar as tabs, the current one selected", () => {
    const html = renderToStaticMarkup(<SettingsWindow page="extensions" onPage={noop}><p>body</p></SettingsWindow>);
    expect(settingsPages.map((p) => p.id)).toEqual(["overview", "general", "shortcuts", "features", "extensions", "bar", "about"]);
    expect(count(html, /role="tab"/g)).toBe(7);
    expect(count(html, /aria-selected="true"/g)).toBe(1);
    expect(html).toContain('data-nav="extensions" tabindex="0"');
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
    const html = renderToStaticMarkup(<ExtensionPalettes ext={settingsExtensions.find((e) => e.key === "github")!} open="github-prs" onOpen={noop} onChange={noop} />);
    expect(html).toContain('data-anchor="palettes:github-prs"');
    expect(html).toContain('data-anchor="palettes:github-prs:mine"');
  });
});

describe("ExtensionPalettes", () => {
  const github = settingsExtensions.find((e) => e.key === "github")!;
  const table = (open?: string, ext = github) => renderToStaticMarkup(<ExtensionPalettes ext={ext} open={open} onOpen={noop} onChange={noop} />);
  it("lists the extension's palettes, a row each with on, alias, hotkey and icon", () => {
    const html = table();
    expect(count(html, /data-palette-row=/g)).toBe(github.palettes.length);
    expect(html).toContain('data-palette-row="github-prs" data-anchor="palettes:github-prs"');
    for (const col of ["Palette", "On", "Alias", "Hotkey", "Icon"]) expect(html).toContain(`<span>${col}</span>`);
    expect(html).not.toContain("pal-ppane");
  });
  it("unfolds the open palette under its row: description, id, rank, and its declared settings", () => {
    const html = table("github-prs");
    expect(html).toContain('data-palette-row="github-prs" data-anchor="palettes:github-prs" data-active="true"');
    expect(html).toContain("Open pull requests across the organisation, newest first.");
    expect(html).toContain("<code>github-prs</code>");
    expect(html).toContain("At the root");
    expect(html).toContain('value="normal"');
    expect(html).toContain("palettes.github-prs.settings");
    expect(html).toContain("Mine only");
    expect(table("github-issues")).toContain("GitHub declares none for this palette.");
  });
  it("says an off palette is off", () => {
    const tabs = settingsExtensions.find((e) => e.palettes.some((p) => p.id === "tabs"))!;
    expect(table("tabs", tabs)).toContain("Off: no rows at the root");
  });
});


/** The store's callbacks as the page takes them, doing nothing: the markup is what these tests read. */
const fakeStore = (state = settingsStore): ExtensionsStore => ({
  state, loaded: true, install: async () => {}, update: async () => {}, remove: async () => {}, setDisabled: async () => {}, refresh: async () => {},
  previewRegistry: async (url) => ({ name: "x", url, count: 0, key: "", key_id: "" }), addRegistry: async () => {}, removeRegistry: async () => {}, setRegistry: async () => {},
  forgetLeftover: async () => {}, addUnlisted: async () => {}, references: storeReferences, openStore: noop,
});
const withStore = [...settingsExtensions, ...storeExtensions];

describe("SettingsExtensions", () => {
  it("an extension's page: the way back, the hero with where it came from and its build, the settings, the palettes, its bar items, and what can be done to it at its foot", () => {
    const html = renderToStaticMarkup(<SettingsExtensions extensions={settingsExtensions} selected="github" onSelect={noop} onChange={noop} store={fakeStore()} onOpenLink={noop} onOpenPalette={noop} bar={barItems} onOpenBarItem={noop} />);
    expect(html).toContain("‹ Extensions</button>");
    expect(html).toContain('class="pal-xpane__hero"');
    expect(html).toContain('class="pal-xpane__title">GitHub</h3>');
    expect(html).toContain("From the pal registry");
    expect(html).toMatch(/>9f8e7d6, \d{1,2} \w{3} \d{4}</);
    expect(html).toContain("Updates wait for you");
    expect(html).toMatch(/Update ready: 3c4d5e6, \d{1,2} \w{3} \d{4}/);
    expect(html).toContain('data-anchor="extensions:github:token"');
    expect(count(html, /class="pal-xpane__palette"/g)).toBe(3);
    expect(html).toContain('class="pal-pane__foot"');
    expect(html).toContain(">Update now</button>");
    expect(html).toContain(">Turn off</button>");
    expect(html).toContain(">Remove</button>");
    expect(html).toContain(">Remove and forget…</button>");
    expect(html).toContain('aria-label="Bar items"');
    expect(html).toContain(">Open in Bar</button>");
    // No version string stands in for the build, and nothing says "bundled".
    expect(html).not.toContain("v1.4.2");
    expect(html).not.toContain("bundled");
  });
  it("the home: what needs you with its fix, what is in use, what is turned off, the rest as an index, Browse and the registries", () => {
    const html = renderToStaticMarkup(<SettingsExtensions extensions={[...withStore, homeAssistant]} onSelect={noop} onChange={noop} store={fakeStore()} bar={barItems} />);
    const section = (name: string) => html.slice(html.indexOf(`aria-label="${name}"`), html.indexOf("</section>", html.indexOf(`aria-label="${name}"`)));
    const needs = section("Needs you");
    expect(needs).toContain("<b>GitHub</b>");
    expect(needs).toContain("<b>Home Assistant</b>");
    expect(needs).toContain(">Update</button>");
    expect(needs).toContain(">Set up</button>");
    // Every kind the store reports: failed, rolled back, pulled, too new, no longer listed, pending, a registry, left over, unlisted, turned off but pointed at.
    for (const id of ["stats", "clipboard", "bookmarks", "weather", "hue", "pending:spotify", "registry:acme", "leftover:gmail", "unlisted:tan", "disabled:timer"]) expect(needs).toContain(`data-anchor="extensions:need:${id}"`);
    expect(needs).toContain(">Update pal</button>");
    expect(needs).toContain(">Retry</button>");
    expect(needs).toContain(">Forget</button>");
    expect(needs).toContain(">Add</button>");
    expect(needs).toContain(">Turn on</button>");
    expect(section("In use")).toContain("Get more extensions");
    expect(section("Turned off")).toContain("<b>Timer</b>");
    expect(section("Turned off")).toContain('role="switch" aria-checked="false"');
    expect(section("Everything else")).toContain('placeholder="Find one"');
    expect(section("Browse")).toContain("Comes with pal");
    expect(section("Browse")).toContain(">Install</button>");
    expect(section("Registries")).toContain("https://acme.github.io/pal/index.json");
    expect(html).not.toContain('class="pal-install__field"');
    expect(html).not.toContain('class="pal-xpane__hero"');
  });
  it("gives an extension that comes with pal Turn off and no Remove, and a store link", () => {
    const exts = settingsExtensions.map((e) => (e.name === "apps" ? { ...e, storeUrl: "https://pal.cagdas.io/extensions/apps" } : e));
    const html = renderToStaticMarkup(<SettingsExtensions extensions={exts} selected="apps" onSelect={noop} onChange={noop} store={fakeStore()} onOpenLink={noop} />);
    expect(html).toContain("Comes with pal");
    expect(html).toContain(">Turn off</button>");
    expect(html).not.toContain(">Remove</button>");
    expect(html).not.toContain("Update now");
    expect(html).toContain(">Store page</button>");
  });
  it("without the store nothing can be done to an extension from its page", () => {
    const html = renderToStaticMarkup(<SettingsExtensions extensions={settingsExtensions} selected="github" onSelect={noop} onChange={noop} />);
    expect(html).not.toContain("pal-pane__foot");
    expect(html).not.toContain('aria-label="Browse"');
  });
  it("a turned-off extension's page says so and offers Turn on", () => {
    const html = renderToStaticMarkup(<SettingsExtensions extensions={withStore} selected="timer" onSelect={noop} onChange={noop} store={fakeStore()} />);
    expect(html).toContain("Turned off.");
    expect(html).toContain(">Turn on</button>");
    expect(html).toContain("None while it is turned off.");
  });
  it("a rolled-back update names its error on the page", () => {
    const html = renderToStaticMarkup(<SettingsExtensions extensions={withStore} selected="clipboard" onSelect={noop} onChange={noop} store={fakeStore()} />);
    expect(html).toContain("An update failed to load and was put back.");
    expect(html).toContain("evaluating &#x27;row.icon&#x27;");
  });
  it("a listed extension that is not installed opens as its listing, with Install or why it cannot be", () => {
    const html = renderToStaticMarkup(<SettingsExtensions extensions={withStore} selected="docker" onSelect={noop} onChange={noop} store={fakeStore()} />);
    expect(html).toContain('class="pal-xpane__title">Docker</h3>');
    expect(html).toContain("Not installed");
    expect(html).toContain(">Install</button>");
    expect(html).toContain("Containers</span>");
    const dpi = renderToStaticMarkup(<SettingsExtensions extensions={withStore} selected="dpi" onSelect={noop} onChange={noop} store={fakeStore()} />);
    expect(dpi).toContain("Not for this platform");
    expect(dpi).not.toContain(">Install</button>");
  });
  it("calls out what is missing, the load error and the manifest warnings", () => {
    const html = renderToStaticMarkup(<SettingsExtensions extensions={[homeAssistant]} selected="home-assistant" onSelect={noop} onChange={noop} />);
    expect(html).toContain("Nothing lists until url and token are set below.");
    expect(html).toContain('data-anchor="extensions:home-assistant:url" data-missing="true"');
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
  it("prefers the registry listing's screenshots on an extension's page", () => {
    const state = { ...settingsStore, available: settingsStore.available.map((a) => (a.name === "github" ? { ...a, listing: { ...a.listing, screenshots: [{ url: "https://pal.cagdas.io/x/1.png", caption: "From the index" }, "https://pal.cagdas.io/x/2.png"] } } : a)) };
    const html = renderToStaticMarkup(<SettingsExtensions extensions={settingsExtensions} selected="github" onSelect={noop} onChange={noop} store={fakeStore(state)} />);
    expect(count(html, /class="pal-xpane__shot"/g)).toBe(2);
    expect(html).toContain("<figcaption>From the index</figcaption>");
  });
  it("says so when nothing is set up, and still offers more", () => {
    const html = renderToStaticMarkup(<SettingsExtensions extensions={[]} onSelect={noop} onChange={noop} store={fakeStore({ ...EMPTY_STORE })} />);
    expect(html).toContain("nothing set up yet");
    expect(html).toContain("Get more extensions");
    expect(html).toContain("no registry has answered yet");
  });
  it("indexes Browse, Registries and every listed extension not installed", () => {
    const idx = extensionsIndex(settingsExtensions, settingsStore.available);
    expect(idx.find((e) => e.anchor === "extensions:browse")?.label).toBe("Browse extensions");
    expect(idx.find((e) => e.anchor === "extensions:registries")?.label).toBe("Registries");
    expect(idx.find((e) => e.anchor === "extensions:docker")?.hint).toContain("Not installed");
    expect(idx.some((e) => e.anchor === "extensions:apps" && e.hint?.startsWith("Not installed"))).toBe(false);
  });
  it("Remove and forget's confirm says exactly what goes", () => {
    expect(forgetText(settingsExtensions[2])).toBe("Deletes GitHub's folder and everything it kept: its settings in the config file ([extensions.github], its palettes' and bar items' tables, every instance), its stored data and cache, its search ranking, and its keychain secrets. A reinstall starts from nothing.");
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
