// The page's other screens, each drawn from what the extension answers:
// Browse (a month of daily minis as a calendar with the day's puzzle beside
// it, or the newest minis as a list), Stats (the figures, a chart of recent
// times, the history) and the offline page. main.ts owns the keys' routing
// and hands each screen its own.
import { clockText, type Puzzle } from "../game.ts";
import type { Entry, MonthView, NewestView, Offline, StatsView } from "../index.ts";

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

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

/** The little mark a puzzle wears in a list: solved, solved with help, started (a pie of how far), new. */
function mark(e: Entry | undefined): string {
  if (!e) return "";
  if (e.state === "solved" || e.state === "helped") return `<i class="m ${e.state}"><svg viewBox="0 0 16 16"><path d="M4.2 8.4l2.6 2.5 5-5.4"/></svg></i>`;
  if (e.state === "started") return `<i class="m started" style="--f:${Math.round(((e.filled ?? 0) / Math.max(1, e.total ?? 1)) * 100)}%"></i>`;
  return `<i class="m new"></i>`;
}
function stateLine(e: Entry): string {
  if (e.state === "solved") return `Solved in ${clockText(e.ms ?? 0)}`;
  if (e.state === "helped") return `Finished with help in ${clockText(e.ms ?? 0)}`;
  if (e.state === "started") return `Started: ${e.filled} of ${e.total} squares, ${clockText(e.ms ?? 0)}`;
  return "Not played yet";
}

type Send = <T>(msg: unknown) => Promise<T>;

// ---- Browse ---------------------------------------------------------------------------------

export class Browse {
  tab: "daily" | "newest" = "daily";
  year = 0;
  month = 0;
  view?: MonthView;
  /** The day of the month under the cursor. */
  day = 1;
  newest: Entry[] = [];
  page = -1;
  more = true;
  row = 0;
  seq = 0;
  constructor(private io: { send: Send; play: (id: string, date?: string) => void; back: () => void }) {
    for (const b of document.querySelectorAll<HTMLElement>("#browse [data-tab]")) b.addEventListener("click", () => this.switchTo(b.dataset.tab as "daily" | "newest"));
    for (const b of document.querySelectorAll<HTMLElement>("#month-nav [data-step]")) b.addEventListener("click", () => void this.step(Number(b.dataset.step)));
    $("#cal").addEventListener("click", (e) => {
      const d = Number((e.target as HTMLElement).closest<HTMLElement>("[data-day]")?.dataset.day);
      if (!d) return;
      if (d === this.day) this.playDay(); else { this.day = d; this.drawMonth(); }
    });
    $("#peek").addEventListener("click", (e) => { if ((e.target as HTMLElement).closest("[data-play]")) this.playDay(); });
    $("#newest-list").addEventListener("click", (e) => {
      const i = Number((e.target as HTMLElement).closest<HTMLElement>("[data-row]")?.dataset.row);
      if (!Number.isInteger(i)) return;
      if (i === this.row) this.playRow(); else { this.row = i; this.drawNewest(); }
    });
  }

  /** Opens on the month of the puzzle being played (a daily), or the newest list after a newest mini. */
  open(p?: Puzzle) {
    const date = p?.date ?? new Date().toISOString().slice(0, 10);
    this.tab = p && !p.date ? "newest" : "daily";
    this.year = Number(date.slice(0, 4));
    this.month = Number(date.slice(5, 7));
    this.day = Number(date.slice(8, 10));
    this.row = 0;
    this.drawTabs();
    void this.loadMonth();
    if (this.tab === "newest" || this.page < 0) void this.loadNewest(true);
  }

  switchTo(tab: "daily" | "newest") {
    this.tab = tab;
    this.drawTabs();
    if (tab === "newest" && this.page < 0) void this.loadNewest(true);
  }
  drawTabs() {
    for (const b of document.querySelectorAll<HTMLElement>("#browse [data-tab]")) b.classList.toggle("on", b.dataset.tab === this.tab);
    $("#browse").dataset.tab = this.tab;
    $("#browse-keys").innerHTML = this.tab === "daily"
      ? `<span><kbd>←</kbd><kbd>→</kbd><kbd>↑</kbd><kbd>↓</kbd> day</span><span><kbd>[</kbd><kbd>]</kbd> month</span><span><kbd>⏎</kbd> play</span><span><kbd>Tab</kbd> newest minis</span><span><kbd>⌫</kbd> back</span>`
      : `<span><kbd>↑</kbd><kbd>↓</kbd> choose</span><span><kbd>⏎</kbd> play</span><span><kbd>Tab</kbd> daily minis</span><span><kbd>⌫</kbd> back</span>`;
  }

  async loadMonth() {
    const seq = ++this.seq;
    $("#month-name").textContent = `${MONTHS[this.month - 1]} ${this.year}`;
    $("#cal").classList.add("busy");
    const v = await this.io.send<MonthView>({ op: "month", year: this.year, month: this.month }).catch((e) => ({ year: this.year, month: this.month, today: "", days: [], error: String(e) }) as MonthView);
    if (seq !== this.seq) return;
    this.view = v;
    $("#cal").classList.remove("busy");
    const last = new Date(Date.UTC(this.year, this.month, 0)).getUTCDate();
    this.day = Math.min(this.day, last);
    this.drawMonth(true);
  }

  async step(by: number, day?: number) {
    let m = this.month + by, y = this.year;
    if (m < 1) { m = 12; y--; }
    if (m > 12) { m = 1; y++; }
    const now = new Date().toISOString().slice(0, 7);
    if (`${y}-${pad(m)}` > now || y < 2020) return;
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
    const lead = (first + 6) % 7; // Monday first
    let html = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => `<span class="wd">${d.slice(0, 2)}</span>`).join("");
    html += `<span class="pad"></span>`.repeat(lead);
    for (let d = 1; d <= last; d++) {
      const e = this.entryOn(d), date = `${this.year}-${pad(this.month)}-${pad(d)}`;
      const cls = ["day", e ? "has" : "none", e?.state ?? "", date === v.today ? "today" : "", date > v.today ? "future" : "", d === this.day ? "cur" : ""].filter(Boolean).join(" ");
      html += `<button type="button" tabindex="-1" class="${cls}" data-day="${d}"><span>${d}</span>${mark(e)}</button>`;
    }
    const cal = $("#cal");
    cal.innerHTML = html;
    cal.classList.toggle("fresh", fresh);
    this.drawPeek();
  }

  drawPeek() {
    const v = this.view!, e = this.entryOn(this.day), date = `${this.year}-${pad(this.month)}-${pad(this.day)}`;
    const peek = $("#peek");
    if (v.error && !v.days.length) { peek.innerHTML = `<div class="empty"><b>Couldn't load this month</b><span>${esc(v.error)}</span></div>`; return; }
    if (!e) {
      peek.innerHTML = `<div class="empty"><span class="date">${dateLong(date)}</span><b>${date > v.today ? "Not out yet" : "No daily mini this day"}</b></div>`;
      return;
    }
    peek.innerHTML = `<div class="date">${dateLong(date)}${date === v.today ? `<em>Today</em>` : ""}</div>
      <div class="ttl">${esc(e.title)}</div>
      <div class="by">by ${esc(e.author || "a Crosshare constructor")}</div>
      <div class="facts"><span class="size">${e.w}×${e.h}</span><span class="st ${e.state}">${mark(e)}${stateLine(e)}</span></div>
      <button type="button" tabindex="-1" class="primary" data-play>${e.state === "solved" || e.state === "helped" ? "Look again" : e.state === "started" ? "Carry on" : "Play"} <kbd>⏎</kbd></button>`;
    peek.classList.remove("swap");
    void peek.offsetWidth;
    peek.classList.add("swap");
  }

  playDay() {
    const e = this.entryOn(this.day);
    if (e) this.io.play(e.id, e.date);
  }

  async loadNewest(reset = false) {
    if (reset) { this.page = -1; this.newest = []; this.more = true; this.row = 0; }
    if (!this.more) return;
    const page = this.page + 1;
    $("#newest").classList.add("busy");
    const r = await this.io.send<NewestView>({ op: "newest", page }).catch((e) => ({ page, items: [], more: false, error: String(e) }) as NewestView);
    $("#newest").classList.remove("busy");
    this.page = page;
    this.more = r.more;
    const seen = new Set(this.newest.map((x) => x.id));
    this.newest.push(...r.items.filter((x) => !seen.has(x.id)));
    this.drawNewest(r.error);
  }

  drawNewest(error?: string) {
    const ol = $("#newest-list");
    if (!this.newest.length) { ol.innerHTML = `<li class="empty">${error ? `Couldn't load the newest minis: ${esc(error)}` : "Nothing here yet"}</li>`; return; }
    ol.innerHTML = this.newest.map((e, i) => `<li data-row="${i}" class="${i === this.row ? "cur" : ""}${e.big ? " big" : ""}">${mark(e)}<span class="ttl">${esc(e.title)}</span><span class="by">${esc(e.author)}</span><span class="size">${e.w}×${e.h}</span><span class="st">${e.state === "new" ? "" : e.state === "started" ? `${e.filled}/${e.total}` : clockText(e.ms ?? 0)}</span></li>`).join("")
      + (this.more ? `<li class="more">More as you scroll</li>` : "");
    const cur = ol.querySelector<HTMLElement>(".cur");
    cur?.scrollIntoView({ block: "nearest" });
  }

  playRow() {
    const e = this.newest[this.row];
    if (e) this.io.play(e.id);
  }

  key(e: KeyboardEvent) {
    e.preventDefault();
    const k = e.key;
    if (k === "Tab") return this.switchTo(this.tab === "daily" ? "newest" : "daily");
    if (k === "Backspace") return this.io.back();
    if (this.tab === "newest") {
      if (k === "Enter") return this.playRow();
      if (k === "ArrowDown" || k === "ArrowUp") {
        this.row = Math.max(0, Math.min(this.newest.length - 1, this.row + (k === "ArrowDown" ? 1 : -1)));
        this.drawNewest();
        if (this.row >= this.newest.length - 3) void this.loadNewest();
      }
      return;
    }
    if (k === "Enter") return this.playDay();
    if (k === "[" || k === "PageUp") return void this.step(-1);
    if (k === "]" || k === "PageDown") return void this.step(1);
    const by = k === "ArrowLeft" ? -1 : k === "ArrowRight" ? 1 : k === "ArrowUp" ? -7 : k === "ArrowDown" ? 7 : 0;
    if (!by) return;
    const last = new Date(Date.UTC(this.year, this.month, 0)).getUTCDate();
    const to = this.day + by;
    if (to < 1) {
      const prevLast = new Date(Date.UTC(this.year, this.month - 1, 0)).getUTCDate();
      return void this.step(-1, prevLast + to);
    }
    if (to > last) {
      const next = `${this.month === 12 ? this.year + 1 : this.year}-${pad(this.month === 12 ? 1 : this.month + 1)}`;
      if (next > new Date().toISOString().slice(0, 7)) return;
      return void this.step(1, to - last);
    }
    this.day = to;
    this.drawMonth();
  }
}

// ---- Stats ----------------------------------------------------------------------------------

export class Stats {
  constructor(private io: { send: Send; back: () => void }) {}

  async open() {
    const s = await this.io.send<StatsView>({ op: "stats" }).catch(() => null);
    if (s) this.draw(s);
  }

  draw(s: StatsView) {
    const t = (v: number | undefined) => (v === undefined ? "–" : clockText(v));
    const tile = (label: string, value: string, sub = "", cls = "") => `<div class="tile ${cls}"><span class="lbl">${label}</span><b>${value}</b><span class="sub">${sub}</span></div>`;
    $("#tiles").innerHTML = [
      tile("Solved", String(s.solved), s.solved > s.clean ? `${s.solved - s.clean} with help` : s.solved ? "all on your own" : ""),
      tile("Best time", t(s.best)),
      tile("Average", t(s.average), s.recent !== undefined ? `last ten ${t(s.recent)}` : ""),
      tile("Streak", `${s.streak}<small>${s.streak === 1 ? "day" : "days"}</small>`, s.today ? "today's done" : s.streak ? "today's still open" : "daily minis on the day", s.streak ? "hot" : ""),
      tile("Best streak", `${s.bestStreak}<small>${s.bestStreak === 1 ? "day" : "days"}</small>`),
    ].join("");
    this.chart(s);
    const ol = $("#history ol");
    $("#history-note").textContent = s.history.length ? `${s.history.length === 60 ? "the last 60" : s.history.length} solved` : "";
    ol.innerHTML = s.history.length
      ? s.history.map((h) => `<li><span class="when">${dateLong(new Date(h.at).toISOString().slice(0, 10), true)}</span><span class="ttl">${esc(h.title)}${h.date ? `<em>daily</em>` : ""}</span><span class="by">${esc(h.author)}</span><span class="tags">${h.helped ? `<em class="help">revealed</em>` : h.checked ? `<em>checked</em>` : ""}${h.replay ? `<em>replay</em>` : ""}</span><span class="t">${clockText(h.ms)}</span></li>`).join("")
      : `<li class="empty">Solve a puzzle and it shows up here.</li>`;
    ol.scrollTop = 0;
  }

  chart(s: StatsView) {
    const svg = $("#plot") as unknown as SVGSVGElement;
    const box = svg.getBoundingClientRect();
    const W = Math.max(200, box.width || 600), H = Math.max(60, box.height || 90);
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const xs = s.times;
    $("#chart-note").textContent = xs.length ? `the last ${xs.length} without help${s.average !== undefined ? `, average ${clockText(s.average)}` : ""}` : "";
    if (!xs.length) { svg.innerHTML = `<text x="${W / 2}" y="${H / 2}" class="none">Your times will show here</text>`; return; }
    // The top tick a round time above the slowest (a multiple of 30 s, of 10 s under a minute).
    const slowest = Math.max(...xs.map((x) => x.ms), s.average ?? 0), step = slowest > 60_000 ? 30_000 : 10_000;
    const top = Math.ceil(slowest / step / 2) * step * 2, gap = 4, left = 34, bw = Math.min(26, (W - left - gap * xs.length) / xs.length);
    const y = (ms: number) => H - 14 - (ms / top) * (H - 22);
    let out = "";
    for (const v of [top / 2, top]) out += `<line x1="${left}" x2="${W}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${left - 6}" y="${y(v) + 3.5}" class="axis">${clockText(v)}</text>`;
    xs.forEach((x, i) => {
      const bx = left + i * (bw + gap), by = y(x.ms);
      out += `<rect x="${bx}" y="${by}" width="${bw}" height="${H - 14 - by}" rx="2.5" class="col${x.ms === s.best ? " best" : ""}" style="--i:${i}"><title>${esc(x.title)}: ${clockText(x.ms)}</title></rect>`;
    });
    if (s.average !== undefined) out += `<line x1="${left}" x2="${left + xs.length * (bw + gap) - gap}" y1="${y(s.average)}" y2="${y(s.average)}" class="avg"/>`;
    svg.innerHTML = out;
  }

  key(e: KeyboardEvent) {
    e.preventDefault();
    if (e.key === "Backspace" || e.key === "Enter") return this.io.back();
    const ol = $("#history ol");
    if (e.key === "ArrowDown") ol.scrollBy({ top: 60, behavior: "smooth" });
    if (e.key === "ArrowUp") ol.scrollBy({ top: -60, behavior: "smooth" });
  }
}

// ---- Offline ---------------------------------------------------------------------------------

export function showOffline(r: Offline) {
  $("#offline-why").textContent = /fetch|network|timed? ?out|abort|connect|ENOTFOUND|resolve/i.test(r.error)
    ? "pal is offline, or Crosshare is down."
    : /answered 5\d\d/.test(r.error) ? "Crosshare isn't answering right now." : r.error;
  const list = $("#offline-list");
  list.innerHTML = r.opened.length
    ? `<span class="lbl">Puzzles you've opened still play:</span>` + r.opened.slice(0, 5).map((e, i) => `<button type="button" tabindex="-1" data-id="${esc(e.id)}" class="${i === 0 ? "hl" : ""}">${mark(e)}<span class="ttl">${esc(e.title)}</span><span class="by">${esc(e.author)}</span></button>`).join("")
    : "";
}
