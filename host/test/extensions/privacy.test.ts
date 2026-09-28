// privacy against canned core/privacy.in_use replies.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { checkBarItem, checkView, type PrivacyUse, type View, type ViewNode } from "../../../sdk/src/index.ts";
import { Host } from "../harness.ts";
import { duration } from "../../../extensions/privacy/view.ts";

const now = () => Math.floor(Date.now() / 1000);
const camera = (): PrivacyUse => ({ sensor: "camera", app: "zoom.us", process: null, pid: 812, path: "/Applications/zoom.us.app", device: "MacBook Pro Camera", since: now() - 23 * 60 });
const zoom = (): PrivacyUse => ({ sensor: "microphone", app: "zoom.us", process: null, pid: 812, path: "/Applications/zoom.us.app", device: null, since: now() - 22 * 60 });
const ffmpeg = (): PrivacyUse => ({ sensor: "microphone", app: "kitty", process: "ffmpeg", pid: 740, path: "/Applications/kitty.app", device: null, since: now() - 5 });
const bare = (): PrivacyUse => ({ sensor: "camera", app: null, process: null, pid: null, path: null, device: "Studio Display Camera", since: null });
let uses: PrivacyUse[] = [];
let host: Host;
beforeAll(async () => {
  host = await Host.bundled({ core: { "privacy.in_use": () => uses } });
});
afterAll(() => host.kill());

const nodes = (n: ViewNode): ViewNode[] => [n, ...("children" in n ? n.children.flatMap(nodes) : [])];
const texts = (v: View) => nodes(v.tree).flatMap((n) => (n.type === "text" ? [n.value] : []));
const viewOf = (x: unknown): View => checkView(((x as { view?: View; menu?: { view?: View } }).view ?? (x as { menu: { view: View } }).menu.view));

describe("privacy", () => {
  test("meta: a live palette and a bar item on the privacy trigger", () => {
    const loaded = host.loaded().find((l) => l.extension === "privacy")!;
    expect(loaded.palettes).toMatchObject([{ name: "privacy", title: "Camera, Mic & Screen", live: true }]);
    expect(loaded.bar).toMatchObject([{ id: "in-use", title: "Camera, Mic & Screen", refresh: { on: ["privacy", "wake"] } }]);
    for (const m of Object.values(loaded.bar![0].mocks!)) checkBarItem(m.item);
  });

  test("durations read in words", () => {
    expect(duration(null, 1000)).toBe("");
    expect(duration(1000, 1030)).toBe("just now");
    expect(duration(1000, 1000 + 23 * 60 + 10)).toBe("23 min");
    expect(duration(1000, 1000 + 60 * 60)).toBe("1 h");
    expect(duration(1000, 1000 + 65 * 60)).toBe("1 h 5 min");
  });

  test("bar: nothing in use is the clear shape with every state false; the rule hides it", async () => {
    uses = [];
    const item = checkBarItem(await host.render("privacy", "in-use"));
    expect(item).toMatchObject({ empty: { tooltip: "Nothing is using the camera, the microphone or the screen" }, states: { camera: false, microphone: false, screen: false } });
    expect(item.background).toBeUndefined();
    const v = viewOf(item);
    expect(v.title).toBe("All clear");
    expect(texts(v)).toContain("Apps show up here the moment one does.");
  });

  test("bar: a glyph per sensor on amber; the popover is one row per app with what it holds and how long", async () => {
    uses = [camera(), zoom(), ffmpeg()];
    const item = checkBarItem(await host.render("privacy", "in-use"));
    expect(item).toMatchObject({ icon: "\u{f05a0} \u{f036c}", background: "amber", tooltip: "Camera: zoom.us · Microphone: zoom.us, kitty", states: { camera: true, microphone: true, screen: false } });
    const v = viewOf(item);
    expect(v.title).toBe("Camera and mic in use");
    expect(texts(v).slice(0, 11)).toEqual(["zoom.us", "\u{f05a0}", "Camera", "\u{f036c}", "Microphone", "23 min", "kitty", "ffmpeg", "\u{f036c}", "Microphone", "just now"]);
    const rows = nodes(v.tree).filter((n): n is Extract<ViewNode, { type: "stack" }> => n.type === "stack" && !!n.action?.startsWith("focus:"));
    expect(rows.map((r) => [r.action, !!r.selected])).toEqual([["focus:zoom.us", true], ["focus:kitty", false]]);
    expect(v.actions!.filter((a) => !a.hidden).map((a) => [a.id, a.title])).toEqual([["show", "Show zoom.us"], ["settings", "Open Privacy & Security settings"]]);
    expect(viewOf(await host.barAction("privacy", "in-use", "down")).actions![0]).toMatchObject({ id: "show", title: "Show kitty" });
    expect(await host.barAction("privacy", "in-use", "show")).toEqual({ open: "/Applications/kitty.app" });
    expect(viewOf(await host.barAction("privacy", "in-use", "focus:zoom.us")).actions![0]).toMatchObject({ title: "Show zoom.us" });
  });

  test("bar: a camera no app has claimed is its own row that opens the settings", async () => {
    uses = [bare()];
    const v = viewOf(await host.render("privacy", "in-use"));
    expect(texts(v).slice(0, 2)).toEqual(["\u{f05a0}", "Studio Display Camera"]);
    expect(v.actions!.find((a) => a.id === "show")).toMatchObject({ title: "Open privacy settings" });
  });

  test("bar: a screen share adds its glyph and names its app", async () => {
    uses = [zoom(), { sensor: "screen", app: "Google Chrome", process: null, pid: 900, path: "/Applications/Google Chrome.app", device: null, since: now() - 3600 }];
    const item = await host.render("privacy", "in-use");
    expect(item).toMatchObject({ icon: "\u{f036c} \u{f0e51}", tooltip: "Microphone: zoom.us · Screen: Google Chrome", states: { camera: false, microphone: true, screen: true } });
    expect(viewOf(item).title).toBe("Mic and screen in use");
  });

  test("palette: one row per app with its duration; Enter brings it forward; gone since is a no-op", async () => {
    uses = [camera(), zoom()];
    expect(await host.list("privacy", "privacy")).toMatchObject([{ id: "zoom.us", name: "zoom.us", subtitle: "Camera, Microphone", icon: { app: "/Applications/zoom.us.app" }, accessories: [{ text: "23 min" }] }]);
    expect(await host.pick("privacy", "privacy", "zoom.us")).toEqual({ open: "/Applications/zoom.us.app" });
    uses = [];
    expect(await host.pick("privacy", "privacy", "zoom.us")).toEqual({ keep: true });
    expect(await host.list("privacy", "privacy")).toMatchObject([{ id: "hint:none", name: "Nothing is using the camera, the microphone or the screen" }]);
  });
});
