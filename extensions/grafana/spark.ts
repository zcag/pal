// A panel as a sparkline the detail pane can show without the image
// renderer plugin: one SVG per panel, the title at the left, the last
// value at the right, every series as a line over a shared scale, the
// first one filled faintly. Drawn in one mid blue and one mid grey, so it
// reads on the dark and the light theme alike (the pane's own text
// colour is not known here). Pure: a data url out of points.
export type Spark = { title: string; caption: string; series: [number, number][][] };

/** The line and the caption colours: a blue that holds on both themes, a grey between the two themes' text. */
const LINE = "#4f8cf7", INK = "#8a8f98";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** The SVG as a `data:image/svg+xml` url, `width` by `height` CSS px (the pane scales it down to its width). */
export function sparkline(s: Spark, width = 320, height = 64): string {
  const top = 16, bottom = height - 3, left = 1, right = width - 1;
  const pts = s.series.flat();
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  let y0 = Math.min(...ys), y1 = Math.max(...ys);
  if (y0 === y1) { y0 -= 1; y1 += 1; }
  const X = (x: number) => (x1 === x0 ? (left + right) / 2 : left + ((x - x0) / (x1 - x0)) * (right - left));
  const Y = (y: number) => bottom - ((y - y0) / (y1 - y0)) * (bottom - top);
  const path = (p: [number, number][]) => p.map(([x, y], i) => `${i ? "L" : "M"}${X(x).toFixed(1)} ${Y(y).toFixed(1)}`).join("");
  const lines = s.series.filter((p) => p.length).map((p, i) => {
    const d = path(p);
    const area = i === 0 && p.length > 1 ? `<path d="${d}L${X(p[p.length - 1][0]).toFixed(1)} ${bottom}L${X(p[0][0]).toFixed(1)} ${bottom}Z" fill="${LINE}" opacity="0.12"/>` : "";
    const dot = p.length === 1 ? `<circle cx="${X(p[0][0]).toFixed(1)}" cy="${Y(p[0][1]).toFixed(1)}" r="2" fill="${LINE}"/>` : "";
    return `${area}<path d="${d}" fill="none" stroke="${LINE}" stroke-width="${i ? 1 : 1.5}" opacity="${i ? 0.45 : 1}" stroke-linejoin="round" stroke-linecap="round"/>${dot}`;
  }).join("");
  const font = `font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Inter,system-ui,sans-serif" font-size="11"`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
    + `<text x="${left}" y="11" ${font} fill="${INK}">${esc(s.title)}</text>`
    + `<text x="${right}" y="11" ${font} font-weight="600" text-anchor="end" fill="${LINE}">${esc(s.caption)}</text>`
    + lines + "</svg>";
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
