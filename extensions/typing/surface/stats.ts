// The stats page: the history in figures, the personal bests, the progress
// chart and every past test. A row of chips picks the kind of test (all of
// them, or one); the figures, the chart and the list follow it, the bests
// always show the eight lengths for the options now on the bar. The numbers
// come from typing.ts (`summary`, `rolling`, `kinds`), the host tests them.
import { COUNTS, TIMES, keyLabel, kinds, modeKey, rolling, summary, type Config, type Past, type Records } from "../typing.ts";
import { PAD, el, niceStep } from "./chart.ts";

const $ = (sel: string) => document.querySelector(sel) as HTMLElement;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** `14:02` today, `Sep 25 14:02` this year, `Sep 25 2025` before. */
function when(at: number): string {
  const d = new Date(at), now = new Date();
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return time;
  const day = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return d.getFullYear() === now.getFullYear() ? `${day} ${time}` : `${day} ${d.getFullYear()}`;
}

/** `42s`, `12m`, `3h 20m`. */
function duration(secs: number): string {
  if (secs < 60) return `${Math.round(secs)}s`;
  const m = Math.round(secs / 60);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

export class Stats {
  private rec!: Records;
  private cfg!: Config;
  /** The picked kind; "" is all of them. */
  private kind = "";
  private shown: Past[] = [];
  private box = $("#stats");
  private plot = $("#progress");

  constructor() {
    $("#kinds").addEventListener("click", (e) => {
      const k = (e.target as HTMLElement).closest<HTMLElement>("[data-kind]")?.dataset.kind;
      if (k !== undefined) this.pick(k);
    });
    new ResizeObserver(() => this.rec && this.chart()).observe(this.plot);
    this.plot.addEventListener("mousemove", (e) => this.hover(e));
    this.plot.addEventListener("mouseleave", () => this.plot.classList.remove("hover"));
  }

  show(rec: Records, cfg: Config) {
    this.rec = rec;
    this.cfg = cfg;
    if (this.kind && !kinds(rec).includes(this.kind)) this.kind = "";
    this.box.scrollTop = 0;
    this.draw();
  }

  /** ← → : the kind before or after. */
  step(dir: 1 | -1) {
    const all = ["", ...kinds(this.rec)];
    const i = all.indexOf(this.kind) + dir;
    if (i >= 0 && i < all.length) this.pick(all[i]);
  }

  scroll(dir: 1 | -1) {
    this.box.scrollBy({ top: dir * 90, behavior: "smooth" });
  }

  private pick(kind: string) {
    this.kind = kind;
    this.draw();
    $("#kinds .on")?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }

  private draw() {
    const rec = this.rec;
    this.shown = this.kind ? rec.history.filter((p) => p.key === this.kind) : rec.history;
    $("#stats").classList.toggle("empty", !rec.history.length);

    $("#kinds").innerHTML = ["", ...kinds(rec)].map((k) => `<button type="button" tabindex="-1" data-kind="${k}" class="${k === this.kind ? "on" : ""}">${k ? keyLabel(k) : "all tests"}</button>`).join("");

    const s = summary(rec, this.kind || undefined);
    const tile = (lbl: string, val: string, sub = "") => `<div class="tile"><div class="lbl">${lbl}</div><div class="val">${val}</div>${sub ? `<div class="sub">${sub}</div>` : ""}</div>`;
    $("#tiles").innerHTML =
      tile("tests", String(s.tests)) +
      tile("time typing", duration(s.secs)) +
      tile("highest wpm", String(Math.floor(s.best))) +
      tile("average wpm", String(Math.floor(s.avg)), `last 10: ${Math.floor(s.avg10)}`) +
      tile("accuracy", `${Math.floor(s.acc)}%`) +
      tile("consistency", `${Math.floor(s.consistency)}%`);

    // The bests for the options on the bar: the eight lengths, dressed as the next test would be.
    const dress = (c: Partial<Config>) => modeKey({ ...this.cfg, ...c });
    const cards = [...TIMES.map((t) => dress({ mode: "time", time: t })), ...COUNTS.map((n) => dress({ mode: "words", words: n }))];
    const extra = [this.cfg.punctuation && "punctuation", this.cfg.numbers && "numbers"].filter(Boolean).join(" · ");
    $("#bests-dress").textContent = extra ? `with ${extra}` : "";
    $("#bests").innerHTML = cards.map((k) => {
      const b = rec.best[k];
      const [mode, n] = k.split(" ");
      return `<div class="pb${b ? "" : " none"}"><div class="lbl">${n} ${mode === "time" ? "seconds" : "words"}</div><div class="val">${b ? Math.floor(b.wpm) : "–"}</div><div class="sub">${b ? `${Math.floor(b.acc)}% · ${when(b.at)}` : "no test yet"}</div></div>`;
    }).join("");

    // Newest first; the best of its kind wears the crown.
    const crown = `<svg viewBox="0 0 16 16"><path d="M2 5.5 5 8l3-4.5L11 8l3-2.5-1.2 7H3.2z"/></svg>`;
    $("#list tbody").innerHTML = this.shown.slice().reverse().map((p) => {
      const top = rec.best[p.key]?.at === p.at;
      return `<tr><td class="date">${when(p.at)}</td><td class="kind">${esc(keyLabel(p.key))}</td><td class="wpm">${Math.floor(p.wpm)}${top ? crown : ""}</td><td>${Math.floor(p.raw)}</td><td>${Math.floor(p.acc)}%</td><td>${Math.floor(p.consistency)}%</td><td>${duration(p.secs)}</td></tr>`;
    }).join("");
    $("#list-count").textContent = this.shown.length ? `${this.shown.length} test${this.shown.length === 1 ? "" : "s"}` : "";
    this.chart();
  }

  /** Every test as a dot at its wpm, the average of ten as the line through them. */
  private geom() {
    const w = this.plot.clientWidth, h = this.plot.clientHeight;
    const xs = this.shown;
    // From round numbers just under the slowest test to just over the fastest: the trend is what matters here, not 0.
    const peak = Math.max(10, ...xs.map((p) => p.wpm)) * 1.04, low = Math.min(...xs.map((p) => p.wpm)) * 0.9;
    const step = niceStep(Math.max(peak - low, 10)), lo = Math.floor(low / step) * step;
    const lines = Math.max(2, Math.ceil((peak - lo) / step)), top = lo + step * lines;
    const x = (i: number) => PAD.l + (xs.length < 2 ? (w - PAD.l - PAD.r) / 2 : (i * (w - PAD.l - PAD.r)) / (xs.length - 1));
    const y = (v: number) => PAD.t + (1 - (v - lo) / (top - lo)) * (h - PAD.t - PAD.b);
    return { w, h, lo, top, lines, x, y };
  }

  private chart() {
    const svg = this.plot.querySelector("svg")!;
    svg.replaceChildren();
    if (!this.shown.length) return;
    const { w, h, lo, top, lines, x, y } = this.geom();
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    for (let g = 0; g <= lines; g++) {
      const v = lo + ((top - lo) * g) / lines;
      el("line", { x1: PAD.l, x2: w - PAD.r, y1: y(v), y2: y(v), class: "grid" }, svg);
      el("text", { x: PAD.l - 7, y: y(v) + 3.5, "text-anchor": "end" }, svg).textContent = String(Math.round(v));
    }
    const r = Math.max(1.6, Math.min(3.2, 260 / this.shown.length));
    this.shown.forEach((p, i) => el("circle", { cx: x(i), cy: y(p.wpm), r, class: "pt" }, svg));
    if (this.shown.length > 1) {
      const avg = rolling(this.shown.map((p) => p.wpm));
      el("path", { d: avg.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join(""), class: "trend" }, svg);
    }
    el("text", { x: PAD.l, y: h - 3, "text-anchor": "start" }, svg).textContent = "oldest";
    el("text", { x: w - PAD.r, y: h - 3, "text-anchor": "end" }, svg).textContent = "latest";
    el("circle", { cx: 0, cy: 0, r: 4.5, class: "dot" }, svg);
  }

  private hover(e: MouseEvent) {
    const xs = this.shown;
    if (!xs.length) return;
    const { w, x, y } = this.geom();
    const px = e.clientX - this.plot.getBoundingClientRect().left;
    const i = xs.length < 2 ? 0 : Math.max(0, Math.min(xs.length - 1, Math.round(((px - PAD.l) / (w - PAD.l - PAD.r)) * (xs.length - 1))));
    const p = xs[i];
    const dot = this.plot.querySelector(".dot")!;
    dot.setAttribute("cx", String(x(i)));
    dot.setAttribute("cy", String(y(p.wpm)));
    const tip = $("#ptip");
    tip.innerHTML = `<b>${Math.floor(p.wpm)} wpm</b> · ${Math.floor(p.acc)}%<br>${esc(keyLabel(p.key))}<br><span>${when(p.at)}</span>`;
    const tw = tip.offsetWidth;
    tip.style.left = `${x(i) + 12 + tw > w ? x(i) - 12 - tw : x(i) + 12}px`;
    this.plot.classList.add("hover");
  }
}
