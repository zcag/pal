// privacy against canned core/privacy.in_use replies.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { checkBarItem, checkView, type PrivacyUse, type View, type ViewNode } from "../../../sdk/src/index.ts";
import { Host } from "../harness.ts";

const camera: PrivacyUse = { sensor: "camera", app: null, process: null, pid: null, path: null, device: "MacBook Pro Camera" };
const zoom: PrivacyUse = { sensor: "microphone", app: "zoom.us", process: null, pid: 812, path: "/Applications/zoom.us.app", device: null };
const ffmpeg: PrivacyUse = { sensor: "microphone", app: "kitty", process: "ffmpeg", pid: 740, path: "/Applications/kitty.app", device: null };
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
    expect(loaded.palettes).toMatchObject([{ name: "privacy", title: "Camera & Microphone", live: true }]);
    expect(loaded.bar).toMatchObject([{ id: "in-use", title: "Camera & Microphone", refresh: { on: ["privacy", "wake"] } }]);
    for (const m of Object.values(loaded.bar![0].mocks!)) checkBarItem(m.item);
  });

  test("bar: nothing in use is the clear shape with every state false; the rule hides it", async () => {
    uses = [];
    const item = await host.render("privacy", "in-use");
    checkBarItem(item);
    expect(item).toMatchObject({ empty: { tooltip: "Nothing is using the camera or microphone" }, states: { camera: false, microphone: false, screen: false } });
    expect(item.background).toBeUndefined();
    expect(texts(viewOf(item))).toContain("Nothing is using the camera or microphone");
  });

  test("bar: a glyph per sensor on amber, the apps in the tooltip; the popover focuses and shows", async () => {
    uses = [camera, zoom, ffmpeg];
    const item = await host.render("privacy", "in-use");
    checkBarItem(item);
    expect(item).toMatchObject({ icon: "\u{f05a0} \u{f036c}", background: "amber", tooltip: "Camera: MacBook Pro Camera · Microphone: zoom.us, kitty", states: { camera: true, microphone: true, screen: false } });
    const v = viewOf(item);
    expect(texts(v).slice(0, 6)).toEqual(["MacBook Pro Camera", "Camera", "zoom.us", "Microphone", "kitty", "Microphone · ffmpeg"]);
    expect(v.actions!.filter((a) => !a.hidden).map((a) => [a.id, a.title])).toEqual([["show", "Open privacy settings"], ["settings", "Open Privacy & Security settings"]]);
    expect(viewOf(await host.barAction("privacy", "in-use", "focus:microphone:740")).actions![0]).toMatchObject({ id: "show", title: "Show kitty" });
    expect(await host.barAction("privacy", "in-use", "show")).toEqual({ open: "/Applications/kitty.app" });
    expect(viewOf(await host.barAction("privacy", "in-use", "down")).actions![0]).toMatchObject({ title: "Open privacy settings" });
  });

  test("palette: the same rows, Enter brings the app forward; a use gone since is a no-op", async () => {
    uses = [zoom];
    const rows = await host.list("privacy", "privacy");
    expect(rows).toMatchObject([{ id: "microphone:812", name: "zoom.us", subtitle: "Microphone", icon: { app: "/Applications/zoom.us.app" } }]);
    expect(await host.pick("privacy", "privacy", "microphone:812")).toEqual({ open: "/Applications/zoom.us.app" });
    uses = [];
    expect(await host.pick("privacy", "privacy", "microphone:812")).toEqual({ keep: true });
    expect(await host.list("privacy", "privacy")).toMatchObject([{ id: "hint:none", name: "Nothing is using the camera or microphone" }]);
  });
});
