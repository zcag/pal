// Sparklines for view nodes: an SVG data url for an `image` node, inked
// from the tag palette of the panel's theme so it reads on either. Moved
// here from the stats popovers so every popover that plots a series (the
// stats items, the battery) shares one drawing.
import type { TagColor } from "./protocol.ts";

export type Theme = "dark" | "light" | undefined;

/** The tag palette's ink per theme (`app/src/ui/tokens.css`); with no theme known, a shade that reads on both. */
const INK: Record<"light" | "dark" | "any", Record<TagColor, string>> = {
  light: { blue: "#2457B0", amber: "#874C00", red: "#B02925", green: "#1B6B40", grey: "#55565F", violet: "#5B39C2", pink: "#A0286A", teal: "#0B6664" },
  dark: { blue: "#7FB0FF", amber: "#F0B25A", red: "#FF8A82", green: "#5CCB8E", grey: "#A3A4AE", violet: "#B39DFF", pink: "#F08CC0", teal: "#5FCFCB" },
  any: { blue: "#4F8AE8", amber: "#C98A2A", red: "#D9534F", green: "#3AA36A", grey: "#808088", violet: "#8A6EE6", pink: "#D0609A", teal: "#2E9E9A" },
};
export const ink = (color: TagColor, theme: Theme) => INK[theme ?? "any"][color];

/**
 * One series. `line: true` draws only the stroke (thin, dashed), on its own
 * `max`: a second quantity over the first, a charge level over the watts.
 * `NaN` is a gap: the area and the line break there.
 */
export type SparkSeries = { values: number[]; color: TagColor; line?: boolean; max?: number };
/** A run of slots `[from, to]` shaded in a colour behind the series: the stretches on the charger. */
export type SparkBand = { from: number; to: number; color: TagColor };

/**
 * An SVG area chart as a `data:` url for an `image` node: each series a
 * filled polyline under a stroke, the ink from the theme's tag palette, a
 * faint baseline that reads on either theme. `max` fixes the scale (100
 * for a percent); otherwise the area series' own peak, never below `floor`.
 * `slots` right-aligns short series against a fixed width of history.
 */
export function sparkline(series: SparkSeries[], o: { width: number; height: number; theme?: Theme; max?: number; floor?: number; slots?: number; bands?: SparkBand[] }): string {
  const { width: w, height: h } = o;
  const slots = Math.max(2, o.slots ?? Math.max(...series.map((s) => s.values.length), 2));
  const areas = series.filter((s) => !s.line);
  const peak = o.max ?? Math.max(o.floor ?? 1, ...areas.flatMap((s) => s.values.filter(Number.isFinite)));
  const step = w / (slots - 1);
  const x = (i: number) => (i * step).toFixed(1);
  const bands = (o.bands ?? []).map((b) => `<rect x="${x(Math.max(0, b.from - 0.5))}" y="0" width="${(Math.min(slots - 1, b.to + 0.5) - Math.max(0, b.from - 0.5)) * step}" height="${h}" fill="${ink(b.color, o.theme)}" fill-opacity="0.12"/>`);
  const paths = series.filter((s) => s.values.length > 1).flatMap((s) => {
    const first = slots - s.values.length, top = s.max ?? peak, c = ink(s.color, o.theme);
    // Each unbroken run is its own polyline, so a gap reads as a gap and not as a slope across it.
    const runs: string[][] = [[]];
    s.values.forEach((v, i) => Number.isFinite(v) ? runs[runs.length - 1].push(`${x(first + i)},${(h - 1 - (Math.min(v, top) / top) * (h - 2)).toFixed(1)}`) : runs.push([]));
    return runs.filter((r) => r.length > 1).map((pts) => s.line
      ? `<polyline points="${pts.join(" ")}" fill="none" stroke="${c}" stroke-width="1" stroke-dasharray="3 2" stroke-opacity="0.8"/>`
      : `<path d="M${pts[0]} L${pts.slice(1).join(" ")} V${h} H${pts[0].split(",")[0]} Z" fill="${c}" fill-opacity="0.18"/><polyline points="${pts.join(" ")}" fill="none" stroke="${c}" stroke-width="1.5" stroke-linejoin="round"/>`);
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${bands.join("")}<line x1="0" y1="${h - 0.5}" x2="${w}" y2="${h - 0.5}" stroke="#80808066" stroke-width="1"/>${paths.join("")}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
