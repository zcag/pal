// The page's other screens, each drawn from what the extension answers:
// Browse (every half-done game, then a tab per difficulty: its dailies as a
// month's calendar with the day's puzzle beside it) and Stats (per
// difficulty: the figures, a chart of recent times, the history). main.ts
// owns the keys' routing and hands each screen its own. Crossword's two
// screens, cut to what a made-up puzzle needs.
import { clockText } from "../game.ts";
import type { Entry, MonthView, Opened, StatsView } from "../index.ts";
import { DIFFS, DIFF_TITLE, type Diff } from "../sudoku.ts";

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const utc = (date: string) => new Date(`${date}T00:00:00Z`);
/** "Friday, September 25", or short "Sep 25"; the year when it is not this one. */
export function dateLong(date: string, short = false): string {
  const d = utc(date), thisYear = new Date().getUTCFullYear() === d.getUTCFullYear();
  const md = `${short ? MONTHS[d.getUTCMonth()].slice(0, 3) : MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  return `${short ? "" : `${DAYS[d.getUTCDay()]}, `}${md}${thisYear ? "" : `, ${d.getUTCFullYear()}`}`;
}
const pad = (n: number) => String(n).padStart(2, "0");

/** The little mark a puzzle wears in a list: solved, solved with a hint, started (a pie of how far), new. */
export function mark(e: Pick<Entry, "state" | "filled" | "total"> | undefined): string {
  if (!e) return "";
  if (e.state === "solved" || e.state === "helped") return `<i class="m ${e.state}"><svg viewBox="0 0 16 16"><path d="M4.2 8.4l2.6 2.5 5-5.4"/></svg></i>`;
  if (e.state === "started") return `<i class="m started" style="--f:${Math.round(((e.filled ?? 0) / Math.max(1, e.total ?? 1)) * 100)}%"></i>`;
  return `<i class="m new"></i>`;
}
function stateLine(e: Entry): string {
  if (e.state === "solved") return `Solved in ${clockText(e.ms ?? 0)}`;
  if (e.state === "helped") return `Solved with a hint in ${clockText(e.ms ?? 0)}`;
  if (e.state === "started") return `Started: ${e.filled} of ${e.total} cells, ${clockText(e.ms ?? 0)}`;
  return "Not played yet";
}

type Send = <T>(msg: unknown) => Promise<T>;
type Tab = { id: string; title: string };

function tabs(el: HTMLElement, list: Tab[], on: string, pick: (id: string) => void) {
  el.innerHTML = list.map((t) => `<button type="button" tabindex="-1" data-tab="${t.id}" class="${t.id === on ? "on" : ""}">${esc(t.title)}</button>`).join("");
  el.onclick = (e) => { const id = (e.target as HTMLElement).closest<HTMLElement>("[data-tab]")?.dataset.tab; if (id) pick(id); };
  return list.map((t) => t.id);
}
const DIFF_TABS: Tab[] = DIFFS.map((d) => ({ id: d, title: DIFF_TITLE[d] }));

// ---- Browse ---------------------------------------------------------------------------------

export class Browse {
  /** A difficulty, or "progress" for every half-done game. */
  tab = "progress";
  order: string[] = [];
  year = 0;
  month = 0;
  view?: MonthView;
  /** The day of the month under the cursor. */
  day = 1;
  progress: Entry[] = [];
  row = 0;
  seq = 0;
  constructor(private io: { send: Send; play: (id: string) => void; fresh: (diff: Diff) => void; back: () => void }) {
    for (const b of document.querySelectorAll<HTMLElement>("#month-nav [data-step]")) b.addEventListener("click", () => void this.step(Number(b.dataset.step)));
    $("#cal").addEventListener("click", (e) => {
      const d = Number((e.target as HTMLElement).closest<HTMLElement>("[data-day]")?.dataset.day);
      if (!d || !this.entryOn(d)) return;
      if (d === this.day) this.playDay(); else { this.day = d; this.drawMonth(); }
    });
    $("#peek").addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      if (t.closest("[data-play]")) this.playDay();
      if (t.closest("[data-fresh]")) this.io.fresh(this.tab as Diff);
    });
    $("#rows").addEventListener("click", (e) => {
      const i = Number((e.target as HTMLElement).closest<HTMLElement>("[data-row]")?.dataset.row);
      if (!Number.isInteger(i)) return;
      if (i === this.row) this.playRow(); else { this.row = i; this.drawList(); }
    });
  }

  /** Opens on In progress when anything is half-done, else on the difficulty being played, at the puzzle's month. */
  async open(o?: Opened) {
    this.row = 0;
    if (o?.date) { this.year = Number(o.date.slice(0, 4)); this.month = Number(o.date.slice(5, 7)); this.day = Number(o.date.slice(8, 10)); }
    else { this.year = 0; this.day = 31; }
    this.progress = await this.io.send<Entry[]>({ op: "progress" }).catch(() => [] as Entry[]);
    const others = this.progress.filter((e) => e.id !== o?.id);
    this.switchTo(others.length ? "progress" : o?.diff ?? "medium");
  }

  switchTo(tab: string) {
    this.tab = tab;
    this.order = tabs($("#browse .tabs"), [{ id: "progress", title: "In progress" }, ...DIFF_TABS], tab, (id) => this.switchTo(id));
    $("#browse").dataset.tab = tab;
    const other = `<span><kbd>Tab</kbd> next tab</span><span><kbd>⌫</kbd> back</span>`;
    $("#browse-keys").innerHTML = tab !== "progress"
      ? `<span><kbd>←</kbd><kbd>→</kbd><kbd>↑</kbd><kbd>↓</kbd> day</span><span class="long"><kbd>[</kbd><kbd>]</kbd> month</span><span><kbd>⏎</kbd> play</span><span><kbd>N</kbd> new puzzle</span>${other}`
      : `<span><kbd>↑</kbd><kbd>↓</kbd> choose</span><span><kbd>⏎</kbd> carry on</span>${other}`;
    if (tab === "progress") return void this.loadProgress();
    this.view = undefined;
    void this.loadMonth();
  }

  async loadMonth() {
    const seq = ++this.seq, tab = this.tab;
    $("#cal").classList.add("busy");
    const v = await this.io.send<MonthView>({ op: "month", diff: tab, ...(this.year && { year: this.year, month: this.month }) }).catch(() => undefined);
    if (!v || seq !== this.seq || tab !== this.tab) return;
    this.view = v;
    this.year = v.year;
    this.month = v.month;
    $("#month-name").textContent = `${MONTHS[this.month - 1]} ${this.year}`;
    $("#cal").classList.remove("busy");
    const last = new Date(Date.UTC(this.year, this.month, 0)).getUTCDate();
    this.day = Math.min(this.day, last);
    // A day not out yet: onto the latest there is.
    if (!this.entryOn(this.day) && v.days.length) this.day = Number(v.days[v.days.length - 1].date!.slice(8, 10));
    this.drawMonth(true);
  }

  async step(by: number, day?: number) {
    let m = this.month + by, y = this.year;
    if (m < 1) { m = 12; y--; }
    if (m > 12) { m = 1; y++; }
    const key = `${y}-${pad(m)}`;
    if (!this.view || key > this.view.today.slice(0, 7) || key < this.view.first) return;
    this.year = y; this.month = m;
    this.day = day ?? 1;
    $("#cal").classList.remove("slide-l", "slide-r");
    void $("#cal").offsetWidth;
    $("#cal").classList.add(by < 0 ? "slide-r" : "slide-l");
    await this.loadMonth();
  }

  entryOn(day: number): Entry | undefined {
    const date = `${this.year}-${pad(this.month)}-${pad(day)}`;
    return this.view?.days.find((d) => d.date === date);
  }

  drawMonth(fresh = false) {
    const v = this.view;
    if (!v) return;
    const first = new Date(Date.UTC(this.year, this.month - 1, 1)).getUTCDay();
    const last = new Date(Date.UTC(this.year, this.month, 0)).getUTCDate();
    let html = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => `<span class="wd">${d}</span>`).join("");
    html += `<span class="pad"></span>`.repeat((first + 6) % 7);
    for (let d = 1; d <= last; d++) {
      const e = this.entryOn(d), date = `${this.year}-${pad(this.month)}-${pad(d)}`;
      const cls = ["day", e ? "has" : "none", e?.state ?? "", date === v.today ? "today" : "", d === this.day ? "cur" : ""].filter(Boolean).join(" ");
      html += `<button type="button" tabindex="-1" class="${cls}" data-day="${d}"><span>${d}</span>${mark(e)}</button>`;
    }
    const cal = $("#cal");
    cal.innerHTML = html;
    cal.classList.toggle("fresh", fresh);
    this.drawPeek();
  }

  drawPeek() {
    const v = this.view!, e = this.entryOn(this.day), date = `${this.year}-${pad(this.month)}-${pad(this.day)}`, diff = this.tab as Diff;
    const fresh = `<button type="button" tabindex="-1" data-fresh>New ${DIFF_TITLE[diff]} puzzle <kbd>N</kbd></button>`;
    const peek = $("#peek");
    peek.innerHTML = !e
      ? `<div class="empty"><span class="date">${dateLong(date)}</span><b>Not out yet</b></div><div class="go">${fresh}</div>`
      : `<div class="date">${dateLong(date)}${date === v.today ? `<em>Today</em>` : ""}</div>
        <div class="ttl">${date === v.today ? "Today's" : "The daily"} <span class="chip ${diff}">${DIFF_TITLE[diff]}</span></div>
        <div class="facts"><span class="st ${e.state}">${mark(e)}${stateLine(e)}</span></div>
        <div class="go"><button type="button" tabindex="-1" class="primary" data-play>${e.state === "solved" || e.state === "helped" ? "Look again" : e.state === "started" ? "Carry on" : "Play"} <kbd>⏎</kbd></button>${fresh}</div>`;
    peek.classList.remove("swap");
    void peek.offsetWidth;
    peek.classList.add("swap");
  }

  playDay() {
    const e = this.entryOn(this.day);
    if (e) this.io.play(e.id);
  }

  /** Every half-done game, asked afresh each time the tab opens. */
  async loadProgress() {
    $("#list").classList.add("busy");
    this.progress = await this.io.send<Entry[]>({ op: "progress" }).catch(() => [] as Entry[]);
    $("#list").classList.remove("busy");
    this.row = Math.min(this.row, Math.max(0, this.progress.length - 1));
    if (this.tab === "progress") this.drawList();
  }

  drawList() {
    const ol = $("#rows"), rows = this.progress;
    if (!rows.length) { ol.innerHTML = `<li class="empty">Nothing half-done. A game you leave partway waits here.</li>`; return; }
    ol.innerHTML = rows.map((e, i) => `<li data-row="${i}" class="${i === this.row ? "cur" : ""}">${mark(e)}<span class="chip ${e.diff}">${DIFF_TITLE[e.diff]}</span><span class="ttl">${e.date ? `Daily, ${dateLong(e.date, true)}` : "New puzzle"}</span><span class="size">${e.filled}/${e.total}</span><span class="st">${clockText(e.ms ?? 0)}</span></li>`).join("");
    ol.querySelector<HTMLElement>(".cur")?.scrollIntoView({ block: "nearest" });
  }

  playRow() {
    const e = this.progress[this.row];
    if (e) this.io.play(e.id);
  }

  key(e: KeyboardEvent) {
    e.preventDefault();
    const k = e.key;
    if (k === "Tab") { const i = this.order.indexOf(this.tab), n = this.order.length; return this.switchTo(this.order[(i + (e.shiftKey ? n - 1 : 1)) % n]); }
    if (k === "Backspace") return this.io.back();
    if (/^[1-4]$/.test(k)) return this.switchTo(DIFFS[Number(k) - 1]);
    if (this.tab === "progress") {
      if (k === "Enter") return this.playRow();
      if (k === "ArrowDown" || k === "ArrowUp" || k === "j" || k === "k") {
        this.row = Math.max(0, Math.min(this.progress.length - 1, this.row + (k === "ArrowDown" || k === "j" ? 1 : -1)));
        this.drawList();
      }
      return;
    }
    if (k === "Enter") return this.playDay();
    if (k === "n" || k === "N") return this.io.fresh(this.tab as Diff);
    if (k === "[" || k === "PageUp") return void this.step(-1);
    if (k === "]" || k === "PageDown") return void this.step(1);
    const by = k === "ArrowLeft" || k === "h" ? -1 : k === "ArrowRight" || k === "l" ? 1 : k === "ArrowUp" || k === "k" ? -7 : k === "ArrowDown" || k === "j" ? 7 : 0;
    if (!by) return;
    const last = new Date(Date.UTC(this.year, this.month, 0)).getUTCDate();
    const to = this.day + by;
    if (to < 1) return void this.step(-1, new Date(Date.UTC(this.year, this.month - 1, 0)).getUTCDate() + to);
    if (to > last) return void this.step(1, to - last);
    if (!this.entryOn(to)) return;
    this.day = to;
    this.drawMonth();
  }
}

// ---- Stats ----------------------------------------------------------------------------------

export class Stats {
  diff: Diff = "medium";
  order: string[] = [];
  constructor(private io: { send: Send; back: () => void }) {}

  async open(diff: Diff) {
    this.diff = diff;
    this.order = tabs($("#stats .tabs"), DIFF_TABS, diff, (id) => void this.open(id as Diff));
    const s = await this.io.send<StatsView>({ op: "stats", diff }).catch(() => null);
    if (s && s.diff === this.diff) this.draw(s);
  }

  draw(s: StatsView) {
    const t = (v: number | undefined) => (v === undefined ? "–" : clockText(v));
    const tile = (label: string, value: string, sub = "", cls = "") => `<div class="tile ${cls}"><span class="lbl">${label}</span><b>${value}</b><span class="sub">${sub}</span></div>`;
    $("#tiles").innerHTML = [
      tile("Solved", String(s.solved), s.solved > s.clean ? `${s.solved - s.clean} with hints` : s.flawless ? `${s.flawless} flawless` : ""),
      tile("Best time", t(s.best)),
      tile("Average", t(s.average), s.recent !== undefined ? `last ten ${t(s.recent)}` : ""),
      tile("Streak", `${s.streak}<small>${s.streak === 1 ? "day" : "days"}</small>`, s.today ? "today's done" : s.streak ? "today's still open" : "dailies solved on their day", s.streak ? "hot" : ""),
      tile("Best streak", `${s.bestStreak}<small>${s.bestStreak === 1 ? "day" : "days"}</small>`),
    ].join("");
    this.chart(s);
    const ol = $("#history ol");
    $("#history-note").textContent = s.history.length ? `${s.history.length === 60 ? "the last 60" : s.history.length} solved` : "";
    ol.innerHTML = s.history.length
      ? s.history.map((h) => `<li><span class="when">${dateLong(new Date(h.at).toISOString().slice(0, 10), true)}</span><span class="ttl">${h.date ? `Daily, ${dateLong(h.date, true)}` : "New puzzle"}</span><span class="tags">${h.hints ? `<em class="help">${h.hints} ${h.hints === 1 ? "hint" : "hints"}</em>` : !h.mistakes ? `<em class="clean">flawless</em>` : ""}${h.replay ? `<em>replay</em>` : ""}</span><span class="t">${clockText(h.ms)}</span></li>`).join("")
      : `<li class="empty">Solve a ${DIFF_TITLE[s.diff]} puzzle and it shows up here.</li>`;
    ol.scrollTop = 0;
  }

  chart(s: StatsView) {
    const svg = $("#plot") as unknown as SVGSVGElement;
    const box = svg.getBoundingClientRect();
    const W = Math.max(200, box.width || 600), H = Math.max(60, box.height || 90);
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const xs = s.times;
    $("#chart-note").textContent = xs.length ? `the last ${xs.length} without a hint${s.average !== undefined ? `, average ${clockText(s.average)}` : ""}` : "";
    if (!xs.length) { svg.innerHTML = `<text x="${W / 2}" y="${H / 2}" class="none">Your times will show here</text>`; return; }
    // The top tick a round time above the slowest (a multiple of a minute, of 10 s under one).
    const slowest = Math.max(...xs.map((x) => x.ms), s.average ?? 0), step = slowest > 120_000 ? 60_000 : 10_000;
    const top = Math.ceil(slowest / step / 2) * step * 2, gap = 4, left = 34, bw = Math.min(26, (W - left - gap * xs.length) / xs.length);
    const y = (ms: number) => H - 14 - (ms / top) * (H - 22);
    let out = "";
    for (const v of [top / 2, top]) out += `<line x1="${left}" x2="${W}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${left - 6}" y="${y(v) + 3.5}" class="axis">${clockText(v)}</text>`;
    xs.forEach((x, i) => {
      const bx = left + i * (bw + gap), by = y(x.ms);
      out += `<rect x="${bx}" y="${by}" width="${bw}" height="${H - 14 - by}" rx="2.5" class="col${x.ms === s.best ? " best" : ""}" style="--i:${i}"><title>${clockText(x.ms)}</title></rect>`;
    });
    if (s.average !== undefined) out += `<line x1="${left}" x2="${left + xs.length * (bw + gap) - gap}" y1="${y(s.average)}" y2="${y(s.average)}" class="avg"/>`;
    svg.innerHTML = out;
  }

  key(e: KeyboardEvent) {
    e.preventDefault();
    if (e.key === "Backspace" || e.key === "Enter") return this.io.back();
    if (e.key === "Tab") { const i = this.order.indexOf(this.diff), n = this.order.length; return void this.open(this.order[(i + (e.shiftKey ? n - 1 : 1)) % n] as Diff); }
    if (/^[1-4]$/.test(e.key)) return void this.open(DIFFS[Number(e.key) - 1]);
    const ol = $("#history ol");
    if (e.key === "ArrowDown" || e.key === "j") ol.scrollBy({ top: 60, behavior: "smooth" });
    if (e.key === "ArrowUp" || e.key === "k") ol.scrollBy({ top: -60, behavior: "smooth" });
  }
}
