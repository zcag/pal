// Writes app/src/gallery/shots/privacy.json and bar-privacy.json: the store
// screenshots' fixtures, the popover and the rows from view.ts over made-up
// uses at a fixed clock. The apps are invented (Huddle, a call app, and
// Terminal running ffmpeg) with SVG icons drawn here, since the gallery has
// no `icon://` scheme and a real app's icon is someone's mark.
// `make shots EXT=privacy`.
import type { PrivacyUse, ViewNode } from "@zcag/pal";
import { NOW_S as NOW, writeFixture } from "../../app/scripts/fixture-kit.ts";
import { GLYPH, groups, paletteItem, render } from "./view.ts";

const svg = (body: string) => `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${body}</svg>`).toString("base64")}`;
const ICONS: Record<string, string> = {
  "/Applications/Huddle.app": svg(`<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4f8cff"/><stop offset="1" stop-color="#2750d8"/></linearGradient></defs><rect x="4" y="4" width="56" height="56" rx="13" fill="url(#g)"/><rect x="14" y="22" width="25" height="20" rx="5" fill="#fff"/><path d="M41 29l9-5v16l-9-5z" fill="#fff"/>`),
  "/System/Applications/Utilities/Terminal.app": svg(`<rect x="4" y="4" width="56" height="56" rx="13" fill="#23262f"/><rect x="4.5" y="4.5" width="55" height="55" rx="12.5" fill="none" stroke="#ffffff22"/><path d="M16 24l9 7-9 7" fill="none" stroke="#6ee7a0" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M29 40h15" stroke="#e8eaf0" stroke-width="4" stroke-linecap="round"/>`),
};

const huddle = (sensor: PrivacyUse["sensor"], minutes: number): PrivacyUse => ({ sensor, app: "Huddle", process: null, pid: 812, path: "/Applications/Huddle.app", device: sensor === "camera" ? "MacBook Pro Camera" : null, since: NOW - minutes * 60 });
const ffmpeg: PrivacyUse = { sensor: "microphone", app: "Terminal", process: "ffmpeg", pid: 740, path: "/System/Applications/Utilities/Terminal.app", device: null, since: NOW - 20 };
const system: PrivacyUse = { sensor: "screen", app: "macOS", process: null, pid: null, path: null, device: null, since: NOW - 4 * 60 };

/** The gallery draws `data:` images, not the app's `icon://` route: swap them in. */
function withIcons<T>(v: T): T {
  const walk = (n: ViewNode): ViewNode => {
    if (n.type === "image") {
      const path = decodeURIComponent(/path=([^&]+)/.exec(n.src)?.[1] ?? "");
      return ICONS[path] ? { ...n, src: ICONS[path] } : n;
    }
    return "children" in n ? { ...n, children: n.children.map(walk) } as ViewNode : n;
  };
  const view = v as { tree?: ViewNode };
  return (view.tree ? { ...view, tree: walk(view.tree) } : v) as T;
}
const popover = (uses: PrivacyUse[], focus = 0) => withIcons(render({ uses, focus, now: NOW }));

const CALL = [huddle("camera", 23), huddle("microphone", 23), ffmpeg];
const SHARE = [huddle("camera", 41), huddle("microphone", 41), huddle("screen", 6), system];
const glyphs = (uses: PrivacyUse[]) => (["camera", "microphone", "screen"] as const).filter((s) => uses.some((u) => u.sensor === s)).map((s) => GLYPH[s]).join(" ");

const bar = {
  key: "privacy/in-use",
  title: "Camera, Mic & Screen",
  item: { icon: glyphs(CALL), background: "amber", tooltip: "Camera: Huddle · Microphone: Huddle, Terminal", menu: { view: popover(CALL) } },
  states: [
    { id: "share", item: { icon: glyphs(SHARE), tooltip: "Camera: Huddle · Microphone: Huddle · Screen: Huddle, macOS", menu: { view: popover(SHARE) } } },
    { id: "clear", item: { hidden: true, empty: { icon: GLYPH.camera, tooltip: "Nothing is using the camera, the microphone or the screen" }, menu: { view: popover([]) } } },
  ],
  shots: {
    "menubar": { target: "menubar", caption: "On the menu bar only while something is in use, a glyph for each sensor: a call holding the camera and the microphone" },
    "menubar-share": { target: "menubar", state: "share", caption: "A call sharing its screen: all three glyphs" },
    "popover": { target: "menubar", popover: true, caption: "A click opens the popover: one row per app, what it holds in colour and for how long; Enter brings the app forward" },
    "popover-share": { target: "menubar", popover: true, state: "share", caption: "A call sharing its screen: the screen is named on the app's row too, and a capture by macOS itself reads macOS" },
    "sketchybar": { target: "sketchybar", caption: "On sketchybar: the same glyphs on an amber band" },
  },
};
writeFixture("bar-privacy", bar);

const rows = groups(SHARE.concat(ffmpeg)).map((g) => paletteItem(g, NOW)).map((i) => (typeof i.icon === "object" && i.icon && "app" in i.icon && ICONS[i.icon.app] ? { ...i, icon: { image: ICONS[i.icon.app] } } : i));
const palette = {
  palettes: { privacy: { title: "Camera, Mic & Screen", live: true, icon: { tile: { glyph: GLYPH.camera, bg: "amber" } }, items: rows } },
  shots: {
    "1-in-use": { palette: "privacy", keys: [], caption: "One row per app: what it holds and for how long, a screen share and a recording in Terminal included" },
    "2-actions": { palette: "privacy", keys: ["cmd+k"], caption: "Enter brings the app forward; the privacy settings are a shortcut away" },
  },
};
writeFixture("privacy", palette);
console.log("privacy.json, bar-privacy.json: a call with a recording beside it, a call sharing its screen, all clear");
