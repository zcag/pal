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
import { Host } from "../harness.ts";

const mac = process.platform === "darwin";

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
    expect(chrome.subtitle).toBeUndefined(); // the usual roots say nothing: it would be the same on every row
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

  test("marked rows: every app action is multi; open launches each, the copies go one per line; a pane's Open stays single, its url copies", async () => {
    const acts = host.loaded().find((l) => l.extension === "apps")!.palettes[0].actions!;
    expect(acts.filter((a) => a.multi).map((a) => a.id)).toEqual(["open", "reveal", "copy-path", "copy-id", "quit", "hide"]);
    const two = ["/Applications/Google Chrome.app", fakeApp];
    expect(await host.pick("apps", "apps", two[0]!, "open", { ids: two })).toEqual({ open: two });
    expect(await host.pick("apps", "apps", two[0]!, "copy-path", { ids: two })).toEqual({ copy: two.join("\n") });
    expect(await host.pick("apps", "apps", two[0]!, "copy-id", { ids: two })).toEqual({ copy: "com.google.Chrome\nio.pal.test.fake" });
    const kb = "pane:com.apple.Keyboard-Settings.extension", tp = "pane:com.apple.Trackpad-Settings.extension";
    const pane = (await list()).find((i) => i.id === kb)!;
    expect(pane.actions!.map((a) => [a.id, !!a.multi])).toEqual([["open", false], ["copy-url", true]]);
    expect(await host.pick("apps", "apps", kb, "copy-url", { ids: [kb, tp] })).toEqual({ copy: "x-apple.systempreferences:com.apple.Keyboard-Settings.extension\nx-apple.systempreferences:com.apple.Trackpad-Settings.extension" });
  });

  test("detail: the folder over the name, the version as a chip, the bundle id; a pane's url", async () => {
    const d = await host.detail("apps", "apps", "/Applications/Google Chrome.app");
    expect(d).toMatchObject({ caption: "/Applications", title: "Google Chrome" });
    expect(d.chips!.some((c) => c.text.startsWith("version "))).toBe(true);
    expect(d.metadata![0]).toEqual({ label: "Bundle id", value: "com.google.Chrome" });
    const fake = await host.detail("apps", "apps", fakeApp);
    expect(fake.chips![0]).toEqual({ text: "running", color: "green" });
    expect(fake.metadata!.map((m) => m.label)).toEqual(["Bundle id", "Process"]);
    const pane = await host.detail("apps", "apps", "pane:com.apple.Keyboard-Settings.extension");
    expect(pane).toMatchObject({ caption: "System Settings", title: "Keyboard" });
    expect(pane.metadata![0]).toEqual({ label: "Opens", value: "x-apple.systempreferences:com.apple.Keyboard-Settings.extension" });
  });

  test("quit: an unregistered bundle id falls back to SIGTERM; the next list has no tag; quit again says it is not running; several marked quit the running ones", async () => {
    expect(host.loaded().find((l) => l.extension === "apps")!.palettes[0].actions!.find((a) => a.id === "quit")).toMatchObject({ multi: true });
    // Marked rows: the running one quits, the one that is not is skipped, and the toast names what quit.
    expect(await host.pick("apps", "apps", fakeApp, "quit", { ids: [fakeApp, "/Applications/Pal Not There.app"] })).toEqual({ keep: true, toast: { title: "Quit Pal Fake" } });
    await child!.exited;
    expect(child!.signalCode).toBe("SIGTERM");
    const fake = (await list()).find((i) => i.id === fakeApp)!;
    expect(fake.accessories).toBeUndefined();
    expect(fake.actions).toBeUndefined();
    expect(await pick(fakeApp, "quit")).toEqual({ keep: true, toast: { title: "Pal Fake is not running" } });
    expect(await pick(fakeApp, "hide")).toEqual({ keep: true, toast: { title: "Pal Fake is not running" } });
    expect(await host.pick("apps", "apps", fakeApp, "quit", { ids: [fakeApp, "/Applications/Pal Not There.app"] })).toEqual({ keep: true, toast: { title: "None of them is running" } });
    expect(await host.pick("apps", "apps", fakeApp, "hide", { ids: [fakeApp, "/Applications/Pal Not There.app"] })).toEqual({ keep: true, toast: { title: "None of them is running" } });
  });

  test("a folders change drops the cache and the extra folder's apps show up", async () => {
    const before = await list();
    host.changeSettings("apps", { settings: { folders: ["/System/Library/CoreServices"] } });
    const after = await list();
    expect(after.length).toBeGreaterThan(before.length);
    expect(after.find((i) => i.name === "Finder")).toMatchObject({ subtitle: "/System/Library/CoreServices" });
  });
});
