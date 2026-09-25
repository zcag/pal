// The result's chart: the wpm up to each second (the accent line, a soft fill
// under it), the raw speed of each second (the grey line) and the mistakes
// made in it (red crosses, on their own scale at the right). SVG sized to its
// box in pixels, so text and strokes stay crisp; the colours are classes, so
// a theme flip needs no redraw. Hover shows the second under the pointer.
import type { Sample } from "../typing.ts";

const NS = "http://www.w3.org/2000/svg";
export const PAD = { l: 30, r: 22, t: 8, b: 18 };

export function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent?: Element): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent?.appendChild(e);
  return e;
}

/** The grid's step: the smallest of 1, 2, 2.5, 5 times a power of ten that covers `x` in five lines or fewer, so the lines land on round numbers. */
export function niceStep(x: number): number {
  if (x <= 0) return 25;
  for (let p = 10 ** Math.floor(Math.log10(x / 5)); ; p *= 10) for (const m of [1, 2, 2.5, 5]) if (m * p * 5 >= x) return m * p;
}

/** A smooth path through the points (Catmull-Rom as cubic Béziers, tension kept low so it never overshoots much). */
export function smooth(pts: [number, number][]): string {
  if (pts.length === 1) return `M${pts[0][0]},${pts[0][1]}`;
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const [p0, p1, p2, p3] = [pts[Math.max(0, i - 1)], pts[i], pts[i + 1], pts[Math.min(pts.length - 1, i + 2)]];
    const k = 0.16;
    d += ` C${p1[0] + (p2[0] - p0[0]) * k},${p1[1] + (p2[1] - p0[1]) * k} ${p2[0] - (p3[0] - p1[0]) * k},${p2[1] - (p3[1] - p1[1]) * k} ${p2[0]},${p2[1]}`;
  }
  return d;
}

export class Chart {
  private samples: Sample[] = [];
  private svg: SVGSVGElement;
  private tip: HTMLElement;
  private box: HTMLElement;

  constructor(box: HTMLElement) {
    this.box = box;
    this.svg = box.querySelector("svg")!;
    this.tip = box.querySelector("#tip")!;
    new ResizeObserver(() => this.samples.length && this.draw(false)).observe(box);
    box.addEventListener("mousemove", (e) => this.hover(e));
    box.addEventListener("mouseleave", () => box.classList.remove("hover"));
  }

  show(samples: Sample[]) {
    this.samples = samples;
    this.draw(true);
  }

  private geom() {
    const w = this.box.clientWidth, h = this.box.clientHeight;
    const s = this.samples;
    const peak = Math.max(...s.map((x) => Math.max(x.wpm, x.raw))) * 1.05;
    const step = niceStep(peak);
    const lines = Math.max(2, Math.ceil(peak / step));
    const top = step * lines;
    // Mistakes on their own scale; a few stay low, so one slip is not a cross on the top edge.
    const etop = Math.max(3, ...s.map((x) => x.errors));
    const x = (i: number) => PAD.l + (s.length === 1 ? (w - PAD.l - PAD.r) / 2 : (i * (w - PAD.l - PAD.r)) / (s.length - 1));
    const y = (v: number) => PAD.t + (1 - v / top) * (h - PAD.t - PAD.b);
    const ey = (v: number) => PAD.t + (1 - v / etop) * (h - PAD.t - PAD.b);
    return { w, h, top, lines, etop, x, y, ey };
  }

  private draw(animate: boolean) {
    const { w, h, top, lines, etop, x, y, ey } = this.geom();
    const s = this.samples;
    this.svg.replaceChildren();
    this.svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    const defs = el("defs", {}, this.svg);
    const grad = el("linearGradient", { id: "fillgrad", x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    el("stop", { offset: 0, class: "stop", "stop-opacity": 0.2 }, grad);
    el("stop", { offset: 1, class: "stop", "stop-opacity": 0 }, grad);

    // The grid: round steps, the wpm on the left, the mistakes on the right.
    for (let g = 0; g <= lines; g++) {
      const v = (top * g) / lines, yy = y(v);
      el("line", { x1: PAD.l, x2: w - PAD.r, y1: yy, y2: yy, class: "grid" }, this.svg);
      el("text", { x: PAD.l - 7, y: yy + 3.5, "text-anchor": "end" }, this.svg).textContent = String(Math.round(v));
    }
    el("text", { x: w - PAD.r + 7, y: ey(etop) + 3.5, "text-anchor": "start" }, this.svg).textContent = String(etop);
    el("text", { x: w - PAD.r + 7, y: ey(0) + 3.5, "text-anchor": "start" }, this.svg).textContent = "0";
    // The seconds: about eight labels, whole steps.
    const step = Math.max(1, Math.ceil(s.length / 8));
    for (let i = 0; i < s.length; i += step) el("text", { x: x(i), y: h - 3, "text-anchor": "middle" }, this.svg).textContent = String(i + 1);

    const wpm = s.map((p, i) => [x(i), y(p.wpm)] as [number, number]);
    const raw = s.map((p, i) => [x(i), y(p.raw)] as [number, number]);
    const line = smooth(wpm);
    el("path", { d: `${line} L${x(s.length - 1)},${y(0)} L${x(0)},${y(0)} Z`, class: `area${animate ? " fade" : ""}` }, this.svg);
    const r = el("path", { d: smooth(raw), class: "raw" }, this.svg);
    const l = el("path", { d: line, class: "wpm" }, this.svg);
    if (animate) for (const p of [r, l]) {
      const len = p.getTotalLength();
      p.style.strokeDasharray = `${len}`;
      p.style.setProperty("--len", `${len}`);
      p.classList.add("draw");
    }
    s.forEach((p, i) => {
      if (!p.errors) return;
      const cx = x(i), cy = ey(p.errors), d = 3;
      el("path", { d: `M${cx - d},${cy - d}L${cx + d},${cy + d}M${cx + d},${cy - d}L${cx - d},${cy + d}`, class: `errx${animate ? " fade" : ""}` }, this.svg);
    });
    el("line", { x1: 0, x2: 0, y1: PAD.t, y2: h - PAD.b, class: "guide" }, this.svg);
    el("circle", { cx: 0, cy: 0, r: 4, class: "dot" }, this.svg);
  }

  private hover(e: MouseEvent) {
    const s = this.samples;
    if (!s.length) return;
    const { w, x, y } = this.geom();
    const rect = this.box.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const i = s.length === 1 ? 0 : Math.max(0, Math.min(s.length - 1, Math.round(((px - PAD.l) / (w - PAD.l - PAD.r)) * (s.length - 1))));
    const p = s[i];
    const guide = this.svg.querySelector(".guide")!, dot = this.svg.querySelector(".dot")!;
    guide.setAttribute("x1", String(x(i)));
    guide.setAttribute("x2", String(x(i)));
    dot.setAttribute("cx", String(x(i)));
    dot.setAttribute("cy", String(y(p.wpm)));
    this.tip.innerHTML = `<b>${i + 1}s</b><br><i style="background:var(--main)"></i>wpm <b>${Math.round(p.wpm)}</b><br><i style="background:var(--faint)"></i>raw <b>${Math.round(p.raw)}</b>${p.errors ? `<br><i style="background:var(--err)"></i>errors <b>${p.errors}</b>` : ""}`;
    const tw = this.tip.offsetWidth;
    this.tip.style.left = `${x(i) + 12 + tw > w ? x(i) - 12 - tw : x(i) + 12}px`;
    this.box.classList.add("hover");
  }
}
