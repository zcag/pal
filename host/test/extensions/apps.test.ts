// apps against this Mac: the real application folders, Google Chrome among
// them, plus a fake bundle in a temp folder whose binary is started so the
// Running tag, Quit and Hide have something to act on. Skipped elsewhere
// (the Linux scan reads .desktop files and a CI runner has no
// /Applications); the .desktop parser is pure and tested everywhere.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execArgv, parseDesktop } from "../../../extensions/apps/desktop.ts";
import { linuxTerminal, linuxTerminalArgv } from "../../../extensions/apps/terminal.ts";
import { Host } from "../harness.ts";

const mac = process.platform === "darwin";

describe("the Linux terminal (shared with ssh and shell)", () => {
  test("$TERMINAL wins, else the first installed in order, else nothing; each program takes the command its own way", () => {
    const only = (...names: string[]) => (n: string) => (names.includes(n) ? `/usr/bin/${n}` : null);
    expect(linuxTerminal({ TERMINAL: " ghostty " }, only("kitty"))).toBe("ghostty");
    expect(linuxTerminal({}, only("xterm", "foot"))).toBe("foot");
    expect(linuxTerminal({}, only("kitty", "x-terminal-emulator"))).toBe("x-terminal-emulator");
    expect(linuxTerminal({ TERMINAL: "" }, () => null)).toBeUndefined();
    expect(linuxTerminalArgv("/usr/bin/kitty", ["htop"])).toEqual(["/usr/bin/kitty", "htop"]);
    expect(linuxTerminalArgv("foot", ["htop"])).toEqual(["foot", "htop"]);
    expect(linuxTerminalArgv("wezterm", ["htop"])).toEqual(["wezterm", "start", "--", "htop"]);
    expect(linuxTerminalArgv("gnome-terminal", ["htop"])).toEqual(["gnome-terminal", "--", "htop"]);
    expect(linuxTerminalArgv("alacritty", ["htop"])).toEqual(["alacritty", "-e", "htop"]);
  });
});

describe("desktop files", () => {
  test("the entry, its actions in Actions= order (only complete ones), localised keys skipped", () => {
    const d = parseDesktop(`
[Desktop Entry]
Type=Application
Name=Firefox
Name[tr]=Firefox TR
Exec=firefox %u
Actions=new-window;new-private-window;broken;
Keywords=web;browser;

[Desktop Action new-window]
Name=New Window
Exec=firefox --new-window %u

[Desktop Action new-private-window]
Name=New Private Window
Exec=firefox --private-window %u

[Desktop Action broken]
Name=No exec here

[Desktop Action unlisted]
Name=Not in Actions
Exec=firefox
`);
    expect(d.entry).toMatchObject({ Type: "Application", Name: "Firefox", Exec: "firefox %u", Keywords: "web;browser;" });
    expect(d.entry["Name[tr]"]).toBeUndefined();
    expect(d.actions).toEqual([
      { id: "new-window", name: "New Window", exec: ["firefox", "--new-window"] },
      { id: "new-private-window", name: "New Private Window", exec: ["firefox", "--private-window"] },
    ]);
    expect(parseDesktop("").entry).toEqual({});
  });

  test("Exec= to argv: quotes, the four escapes, field codes dropped, %% kept", () => {
    expect(execArgv('"/opt/My App/bin" --flag %F %u %%')).toEqual(["/opt/My App/bin", "--flag", "%"]);
    expect(execArgv('sh -c "echo \\"hi\\" \\$HOME"')).toEqual(["sh", "-c", 'echo "hi" $HOME']);
  });
});

let host: Host;
let dir: string;
let fakeApp: string;
let child: Bun.Subprocess | undefined;
beforeAll(async () => {
  if (!mac) return;
  dir = mkdtempSync(join(tmpdir(), "pal-apps-"));
  fakeApp = join(dir, "Pal Fake.app");
  mkdirSync(join(fakeApp, "Contents", "MacOS"), { recursive: true });
  writeFileSync(join(fakeApp, "Contents", "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>io.pal.test.fake</string>
  <key>CFBundleDisplayName</key><string>Fake Display</string>
  <key>CFBundleName</key><string>Pal Fake</string>
</dict></plist>`);
  // A symlink, not a copy: a copied system binary is refused by the signing policy, and a script's comm is /bin/sh.
  const bin = join(fakeApp, "Contents", "MacOS", "Pal Fake");
  symlinkSync("/bin/sleep", bin);
  child = Bun.spawn([bin, "60"], { stdout: "ignore", stderr: "ignore" });
  host = await Host.bundled({ settings: { apps: { settings: { folders: [dir] } } } });
});
afterAll(() => { host?.kill(); child?.kill(); if (dir) rmSync(dir, { recursive: true, force: true }); });

const list = () => host.list("apps", "apps");
const pick = (id: string, action?: string) => host.pick("apps", "apps", id, action);

describe.skipIf(!mac)("apps", () => {
  test("loads with one palette and the manifest's folders setting", async () => {
    const l = host.loaded().find((l) => l.extension === "apps")!;
    expect(l.palettes).toMatchObject([{ name: "apps", title: "Applications", live: false, input: false, tier: "primary", detail: "lazy" }]);
    // The actions every row shares ride once, on the palette; a row says its own only when running or without a bundle id.
    expect(l.palettes[0].actions!.map((a) => a.id)).toEqual(["open", "reveal", "copy-path", "copy-id", "quit", "hide"]);
    expect(l.manifest.settings?.map((s) => s.id)).toEqual(["folders"]);
  });

  test("lists the installed apps, Google Chrome among them, with existing .app icons, bundle ids and bundle names as keywords", async () => {
    const items = (await list()).filter((i) => !i.id.startsWith("pane:"));
    expect(items.length).toBeGreaterThan(20);
    const chrome = items.find((i) => i.name === "Google Chrome")!;
    expect(chrome).toBeDefined();
    expect(chrome.id).toBe("/Applications/Google Chrome.app");
    expect(chrome.icon).toEqual({ app: "/Applications/Google Chrome.app" });
    expect(chrome.keywords).toEqual(["com.google.Chrome", "Chrome"]); // the bundle id, then CFBundleName
    expect(chrome.subtitle).toBe("Applications");
    if (!chrome.accessories) expect(chrome.actions).toBeUndefined();
    for (const i of items) expect(existsSync((i.icon as { app: string }).app), i.name).toBe(true);
    expect(items.map((i) => i.name)).toEqual([...items.map((i) => i.name)].sort((a, b) => a.localeCompare(b)));
    // Names repeat across roots (GitHub runners ship several); ids are paths and must not.
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
  });

  test("System Settings panes are rows after the apps: x-apple.systempreferences urls, Open and Copy URL", async () => {
    const items = await list();
    const panes = items.filter((i) => i.id.startsWith("pane:"));
    expect(panes.length).toBeGreaterThan(30);
    expect(items.indexOf(panes[0])).toBe(items.length - panes.length);
    const kb = panes.find((i) => i.name === "Keyboard")!;
    expect(kb).toMatchObject({ id: "pane:com.apple.Keyboard-Settings.extension", subtitle: "System Settings", icon: { app: "/System/Applications/System Settings.app" } });
    expect(kb.keywords).toEqual(expect.arrayContaining(["settings", "preferences", "shortcuts"]));
    expect(kb.actions!.map((a) => a.id)).toEqual(["open", "copy-url"]);
    expect(await pick(kb.id)).toEqual({ open: "x-apple.systempreferences:com.apple.Keyboard-Settings.extension" });
    expect(await pick(kb.id, "copy-url")).toEqual({ copy: "x-apple.systempreferences:com.apple.Keyboard-Settings.extension" });
  });

  test("a running app: the running tag, Quit and Hide right after Open, display and bundle names as keywords", async () => {
    const fake = (await list()).find((i) => i.id === fakeApp)!;
    expect(fake).toMatchObject({ name: "Pal Fake", subtitle: dir, accessories: [{ tag: "running", color: "green" }] });
    expect(fake.keywords).toEqual(["io.pal.test.fake", "Fake Display"]);
    expect(fake.actions!.map((a) => a.id)).toEqual(["open", "quit", "hide", "reveal", "copy-path", "copy-id"]);
    const chrome = (await list()).find((i) => i.name === "Google Chrome")!;
    if (!chrome.accessories) expect(chrome.actions).toBeUndefined();
  });

  test("the scan is cached: a second list is the same and asks nothing of the core", async () => {
    const calls = host.coreCalls.length;
    const a = await list();
    const b = await list();
    expect(b).toEqual(a);
    expect(host.coreCalls.length).toBe(calls);
  });

  test("pick opens the bundle; copy path and copy bundle id", async () => {
    expect(await pick("/Applications/Google Chrome.app")).toEqual({ open: "/Applications/Google Chrome.app" });
    expect(await pick("/Applications/Google Chrome.app", "open")).toEqual({ open: "/Applications/Google Chrome.app" });
    expect(await pick("/Applications/Google Chrome.app", "copy-path")).toEqual({ copy: "/Applications/Google Chrome.app" });
    expect(await pick("/Applications/Google Chrome.app", "copy-id")).toEqual({ copy: "com.google.Chrome" });
  });

  test("detail: the path, bundle id and version of an app; a pane's url", async () => {
    const d = await host.detail("apps", "apps", "/Applications/Google Chrome.app");
    expect(d.markdown).toBe("# Google Chrome");
    expect(d.metadata!.map((m) => m.label)).toEqual(["Path", "Bundle id", "Version", "Running"]);
    expect(d.metadata![1].value).toBe("com.google.Chrome");
    const pane = await host.detail("apps", "apps", "pane:com.apple.Keyboard-Settings.extension");
    expect(pane.metadata![0]).toEqual({ label: "Opens", value: "x-apple.systempreferences:com.apple.Keyboard-Settings.extension" });
  });

  test("quit: an unregistered bundle id falls back to SIGTERM; the next list has no tag; quit again says it is not running", async () => {
    expect(await pick(fakeApp, "quit")).toEqual({ keep: true });
    await child!.exited;
    expect(child!.signalCode).toBe("SIGTERM");
    const fake = (await list()).find((i) => i.id === fakeApp)!;
    expect(fake.accessories).toBeUndefined();
    expect(fake.actions).toBeUndefined();
    expect(await pick(fakeApp, "quit")).toEqual({ keep: true, toast: { title: "Pal Fake is not running" } });
    expect(await pick(fakeApp, "hide")).toEqual({ keep: true, toast: { title: "Pal Fake is not running" } });
  });

  test("a folders change drops the cache and the extra folder's apps show up", async () => {
    const before = await list();
    host.changeSettings("apps", { settings: { folders: ["/System/Library/CoreServices"] } });
    const after = await list();
    expect(after.length).toBeGreaterThan(before.length);
    expect(after.find((i) => i.name === "Finder")).toMatchObject({ subtitle: "/System/Library/CoreServices" });
  });
});
