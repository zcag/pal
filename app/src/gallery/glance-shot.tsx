import { useEffect } from "react";
import { Launcher, type LauncherProps } from "../Launcher";

/** A made-up cover: a gradient square with a mark, as a data url (the gallery has no real artwork). */
const cover = (a: string, b: string, mark: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="80" height="80" fill="url(#g)"/><text x="40" y="52" font-family="Georgia" font-size="34" fill="#fff" text-anchor="middle" opacity=".9">${mark}</text></svg>`)}`;

type Glance = NonNullable<LauncherProps["glance"]>;
const calendar: Glance[number] = { key: "calendar/upcoming", label: "Calendar", title: "Weekly sync in 13m", tooltip: "Weekly sync, 14:45 – 15:15", icon: "\u{f00ed}" };
const gmail: Glance[number] = { key: "gmail/unread", label: "Gmail", count: 29, tooltip: "29 unread messages", icon: "\u{f02ab}" };
const weather: Glance[number] = { key: "weather/weather", label: "Weather", title: "18.5°C", tooltip: "Partly cloudy in Istanbul", icon: "\u{f0595}" };
const playing = (lines: { text: string; action?: string }[] = []): Glance[number] => ({
  key: "media/playing", label: "Now Playing", title: "Mr. Blue Sky", tooltip: "Pomplamoose · YouTube on Living Room", icon: { image: cover("#4f7cff", "#a24bd8", "♪") }, progress: 0.42, lines,
});

/** The glance strip's states for its screenshots: `one` playing, `two` (an "also" line), `three` (and "+1 more"), `none` (nothing plays: no card). */
const STATES: Record<string, Glance> = {
  none: [calendar, gmail, weather],
  one: [calendar, playing(), gmail, weather],
  two: [calendar, playing([{ text: "also: Weird Fishes · Spotify on hornet", action: "open:ctl:spotify" }]), gmail, weather],
  three: [calendar, playing([{ text: "also: Weird Fishes · Spotify on hornet", action: "open:ctl:spotify" }, { text: "+1 more", action: "open:all" }]), gmail, weather],
};

/**
 * `?gallery=glance&state=one|two|three|none[&theme=dark]` (with
 * `&design=ink`, the design that draws the strip): the empty root with the
 * glance strip, the Playing card in its second slot.
 */
export default function GlanceShot({ state = "one", theme = "light" }: { state?: string; theme?: "light" | "dark" }) {
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  return (
    <div className="g-shot" data-theme={theme}>
      <div className="g-frame">
        <Launcher sources={[]} search={async () => []} glance={STATES[state] ?? STATES.one} onGlance={() => {}} onPick={() => ({ keep: true })} onHide={() => {}} onRefresh={() => {}} onSettings={() => {}} />
      </div>
    </div>
  );
}
