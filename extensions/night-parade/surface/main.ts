// Night Parade's page: the screens (title, heroes, shrine, codex, settings),
// the night itself (keys in, the sim stepped at 60 a second, drawn every
// frame, its events turned into sound, banners and particles), and the cards
// over it (level-up, chest, pause, results). The save goes through the kit's
// storage (localStorage in a browser, the extension's storage in pal);
// hiding pal's panel pauses the night and stores it, so closing pal and
// opening it again finds the night where it was, paused.
import { BOSSES, type BossKind } from "../game/content/bosses.ts";
import { ENEMIES, type EnemyKind } from "../game/content/enemies.ts";
import { HEROES, type HeroKind } from "../game/content/heroes.ts";
import { ITEMS, type ItemKind } from "../game/content/items.ts";
import { OMEN_MAX, SHRINE, UNLOCKS, omen, type ShrineKind, type UnlockKind } from "../game/content/meta.ts";
import { ACTS, EVENTS, actAt } from "../game/content/stage.ts";
import { STAT_NAMES, statText, type StatKey } from "../game/content/stats.ts";
import { WEAPONS, WEAPON_MAX, levelText, type WeaponKind } from "../game/content/weapons.ts";
import { needed } from "../game/content/xp.ts";
import { drive, loadout as botLoadout, pickChoice } from "../game/bot.ts";
import { buy, earnedUnlocks, fresh, heroOpen, load, loadout, packRun, priceOf, refund, settle, unpackRun, weaponOpen, type Earned, type Save, type Scene } from "../game/meta.ts";
import { DT, banish, choose, clock, create, pairs, reroll, restat, resume, skip, step, type Choice, type State } from "../game/sim/index.ts";
import { levelUp, openChest } from "../game/sim/progress.ts";
import { spawnAt } from "../game/sim/core.ts";
import type { SurfaceKit } from "@zcag/pal";
import * as audio from "./audio.ts";
import { draw, faceUrl, iconUrl, loaded, react, useFont, zoomFor, type View } from "./render.ts";

declare const pal: SurfaceKit;

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const canvas = $<HTMLCanvasElement>("#world");
const view: View = { ctx: canvas.getContext("2d")!, w: 0, h: 0, dpr: 1, zoom: 2, dark: document.createElement("canvas"), numbers: true };
const ui = $("#ui");

type Screen = "title" | "heroes" | "shrine" | "codex" | "settings" | "run" | "results";
let screen: Screen = "title";
let save: Save = fresh();
let run: State | undefined;
let demo: State = demoRun();
let sel = 0;
let paused = false;
/** The game's settings open over the paused night. */
let tuning = false;
let earned: Earned | undefined;
let codexTab = 0;
let refundArmed = false;
let endAt = 0;

// ---- helpers --------------------------------------------------------------------------------------------------------

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const kbd = (...ks: string[]) => ks.map((k) => `<kbd>${k}</kbd>`).join("");
const keys = (...xs: [string, string][]) => `<div class="keys">${xs.map(([k, t]) => `<span>${k} ${t}</span>`).join("")}</div>`;
const img = (src: string, cls = "px") => `<img class="${cls}" src="${src}" alt="">`;
const wIcon = (k: WeaponKind) => iconUrl(WEAPONS[k].icon);
const iIcon = (k: ItemKind) => iconUrl(ITEMS[k].icon);
const pips = (n: number, max: number) => `<span class="pips">${Array.from({ length: max }, (_, i) => `<i class="${i < n ? "on" : ""}"></i>`).join("")}</span>`;
function show(html: string, dim = true) {
  ui.innerHTML = html;
  ui.classList.toggle("dim", dim && !!html);
  ui.querySelectorAll<HTMLElement>("[data-i]").forEach((el) => {
    // On the hero screen a click only looks: starting takes Enter, the Begin button or a double-click.
    if (screen === "heroes") {
      el.addEventListener("click", () => { sel = Number(el.dataset.i); if (heroOpen(save, HERO_ORDER[sel])) save.hero = HERO_ORDER[sel]; audio.sfx("move"); heroes(); });
      el.addEventListener("dblclick", () => key("Enter"));
    } else el.addEventListener("click", () => { sel = Number(el.dataset.i); key("Enter"); });
  });
  ui.querySelector("[data-go]")?.addEventListener("click", () => key("Enter"));
}
function persist() { pal.storage.set("save", save).catch((e) => console.error("night-parade: save", e)); }

// ---- the demo behind the title -------------------------------------------------------------------------------------------

/** A bot plays behind the title with a strong kit, so the first thing you see is the game. */
function demoRun(): State {
  const s = create(botLoadout((Math.random() * 1e9) >>> 0, "kaze"));
  s.t = 200;
  for (const [k, l] of [["shuriken", 6], ["katana", 5], ["spirit", 5], ["thunder", 4], ["fire", 4]] as [WeaponKind, number][]) {
    if (!s.weapons.some((w) => w.kind === k)) { s.phase = "levelup"; s.choices = [{ type: "weapon", kind: k, level: 1 }]; s.pending = 1; choose(s, 0); }
    s.weapons.find((w) => w.kind === k)!.level = l;
  }
  s.phase = "play";
  s.events.length = 0;
  return s;
}

let demoAcc = 0;
function stepDemo(dt: number) {
  demoAcc += dt;
  while (demoAcc >= DT) {
    demoAcc -= DT;
    if (demo.phase === "levelup") choose(demo, pickChoice(demo));
    else if (demo.phase === "chest") resume(demo);
    else if (demo.phase !== "play" || demo.t > 290) demo = demoRun();
    else step(demo, drive(demo));
    demo.events.length = 0;
    demo.p.hp = demo.st.maxHp;
  }
}

// ---- screens -------------------------------------------------------------------------------------------------------------

const MENU = ["Begin", "Shrine", "Codex", "Settings"] as const;

function title() {
  screen = "title";
  $("#hud").hidden = true;
  audio.play("title");
  sel = Math.max(0, Math.min(MENU.length - 1, sel));
  show(`<div class="panel title">
    <div class="logo">Night Parade</div>
    <div class="jp">百 鬼 夜 行</div>
    <div class="tag">The hundred demons march tonight. Last until dawn.</div>
    <div class="menu">${MENU.map((m, i) => `<div class="item${i === sel ? " sel" : ""}" data-i="${i}">${m}</div>`).join("")}</div>
    <div class="purse">${Math.floor(save.gold)} gold · ${save.totals.dawns} dawn${save.totals.dawns === 1 ? "" : "s"} seen</div>
    ${keys([kbd("↑", "↓"), "choose"], [kbd("↵"), "go"], [kbd("P"), "pause in the night"], [kbd("M"), "mute"])}
  </div>`, false);
}

const HERO_ORDER = Object.keys(HEROES) as HeroKind[];

function heroes() {
  screen = "heroes";
  sel = Math.max(0, Math.min(HERO_ORDER.length - 1, sel));
  const k = HERO_ORDER[sel], h = HEROES[k], open = heroOpen(save, k), best = save.best[k];
  const om = save.unlocked.includes("omens");
  show(`<div class="panel wide">
    <h2>Who walks tonight? <small>${Math.floor(save.gold)} gold</small></h2>
    <div class="heroes">${HERO_ORDER.map((hk, i) => {
      const d = HEROES[hk], o = heroOpen(save, hk);
      return `<div class="hero${i === sel ? " sel" : ""}${o ? "" : " locked"}" data-i="${i}">${img(faceUrl(hk), "face px")}<div><div class="n">${o ? d.name : "???"}</div><div class="t">${o ? d.title : "Locked"}</div></div></div>`;
    }).join("")}</div>
    <div class="detail">
      ${open ? `<div class="trait"><b>${h.trait}.</b> ${esc(h.traitText)}${best ? `<p>Best: ${best.dawn ? "saw the dawn" : `lasted ${clock(best.t)}`}, level ${best.level}.</p>` : ""}</div>
      <div class="w">${img(wIcon(h.weapon))}<div>Starts with<br><b style="color:var(--ink)">${WEAPONS[h.weapon].name}</b></div></div>`
      : `<div class="trait"><b>Locked.</b> ${esc(UNLOCKS[h.unlock as UnlockKind].how)}</div><div></div>`}
    </div>
    ${om ? `<div class="omen">Omen ${kbd("Q")}${kbd("E")} <b>${save.omen ? "✦".repeat(save.omen) : "none"}</b> ${save.omen ? `enemies ×${omen(save.omen).hp.toFixed(2)} health, gold ×${omen(save.omen).gold.toFixed(1)}` : "an ordinary night"}</div>` : ""}
    <div class="go-row">${keys([kbd("←", "→", "↑", "↓"), "choose"], [kbd("↵"), open ? "walk into the night" : "locked"], [kbd("⌫"), "back"])}${open ? `<button class="go" data-go>Walk into the night</button>` : ""}</div>
  </div>`);
}

const SHRINE_ORDER = Object.keys(SHRINE) as ShrineKind[];

function shrine() {
  screen = "shrine";
  sel = Math.max(0, Math.min(SHRINE_ORDER.length - 1, sel));
  const k = SHRINE_ORDER[sel], d = SHRINE[k], owned = save.shrine[k] ?? 0, price = priceOf(save, k);
  show(`<div class="panel wide">
    <h2>The shrine <small>${Math.floor(save.gold)} gold to offer</small></h2>
    <div class="shrine">${SHRINE_ORDER.map((sk, i) => {
      const sd = SHRINE[sk], n = save.shrine[sk] ?? 0, pr = priceOf(save, sk), max = n >= sd.ranks;
      return `<div class="bless${i === sel ? " sel" : ""}" data-i="${i}">${img(iconUrl(sd.icon))}<div><div class="n">${sd.name}${pips(n, sd.ranks)}</div><div class="c ${max ? "max" : pr > save.gold ? "poor" : ""}">${max ? "complete" : `${pr} gold`}</div></div></div>`;
    }).join("")}</div>
    <div class="shrine-detail"><b style="color:var(--ink)">${d.name}</b>: ${d.text} ${owned >= d.ranks ? "All ranks offered." : price > save.gold ? `${price - Math.floor(save.gold)} more gold for the next rank.` : `Next rank: ${price} gold.`}</div>
    ${keys([kbd("←", "→", "↑", "↓"), "choose"], [kbd("↵"), "offer gold"], [kbd("R"), refundArmed ? "again to take it all back" : "refund everything"], [kbd("⌫"), "back"])}
  </div>`);
}

const TABS = ["Weapons", "Items", "Bestiary", "Unlocks"];

function codex() {
  screen = "codex";
  let body = "";
  if (codexTab === 0)
    body = (Object.keys(WEAPONS) as WeaponKind[]).map((k) => {
      const d = WEAPONS[k], seen = save.seen.weapons.includes(k), evo = save.seen.evolved.includes(k), open = weaponOpen(save, k);
      return `<div class="entry${seen ? "" : " unseen"}">${img(wIcon(k))}<div>${seen ? d.name : open ? "Not yet found" : "Locked"}<small>${seen ? `${evo ? "★ " : ""}+ ${ITEMS[d.evolveWith].name} → ${evo ? d.evolved : "?"}` : open ? d.roles.join(", ") : esc(UNLOCKS[d.unlock as UnlockKind].how)}</small></div></div>`;
    }).join("");
  else if (codexTab === 1)
    body = (Object.keys(ITEMS) as ItemKind[]).map((k) => {
      const d = ITEMS[k], seen = save.seen.items.includes(k);
      return `<div class="entry${seen ? "" : " unseen"}">${img(iIcon(k))}<div>${seen ? d.name : "Not yet found"}<small>${seen ? esc(d.blurb) : ""}</small></div></div>`;
    }).join("");
  else if (codexTab === 2)
    body = (Object.keys(ENEMIES) as EnemyKind[]).map((k) => {
      const d = ENEMIES[k], n = save.seen.enemies[k] ?? 0;
      return `<div class="entry${n ? "" : " unseen"}"><canvas data-sprite="${d.sprite}" width="16" height="16" class="px"></canvas><div>${n ? d.name : "???"}<small>${n ? `${n.toLocaleString()} defeated` : ""}</small></div></div>`;
    }).join("") + (Object.keys(BOSSES) as BossKind[]).map((k) => {
      const d = BOSSES[k], n = save.seen.bosses[k] ?? 0;
      return `<div class="entry${n ? "" : " unseen"}">${img(faceUrl(k))}<div>${n ? d.name : "???"}<small>${n ? `defeated ${n}×` : d.minor ? "mid-act" : "act boss"}</small></div></div>`;
    }).join("");
  else
    body = (Object.keys(UNLOCKS) as UnlockKind[]).map((k) => {
      const u = UNLOCKS[k], got = save.unlocked.includes(k);
      return `<div class="entry${got ? "" : " unseen"}" style="grid-template-columns:1fr"><div>${got ? "✓ " : ""}${u.name}<small>${esc(u.how)}</small></div></div>`;
    }).join("");
  show(`<div class="panel wide">
    <h2>Codex <small>${save.totals.nights} nights, ${save.totals.kills.toLocaleString()} defeated</small></h2>
    <div class="tabs">${TABS.map((t, i) => `<span class="${i === codexTab ? "on" : ""}">${t}</span>`).join("")}</div>
    <div class="codex">${body}</div>
    ${keys([kbd("←", "→"), "pages"], [kbd("⌫"), "back"])}
  </div>`);
  // Enemy portraits: the first frame of each walker, facing you.
  ui.querySelectorAll<HTMLCanvasElement>("canvas[data-sprite]").forEach((c) => {
    const im = new Image();
    im.onload = () => { const x = c.getContext("2d")!; x.imageSmoothingEnabled = false; x.drawImage(im, 0, 0, 16, 16, 0, 0, 16, 16); };
    im.src = `./assets/sprites/${c.dataset.sprite}.png`;
  });
}

const SETTINGS = ["music", "sfx", "numbers", "shake"] as const;
/** The game's settings: from the title (its own screen) or over a paused night (`tuning`). */
function settings() {
  const st = save.settings;
  const row = (i: number, name: string, v: string) => `<div class="setting${i === sel ? " sel" : ""}" data-i="${i}"><span>${name}</span>${v}</div>`;
  const meter = (x: number) => `<div class="meter"><i style="width:${x * 100}%"></i></div>`;
  show(`<div class="panel">
    <h2>Settings</h2>
    ${row(0, "Music", meter(st.music))}${row(1, "Sound", meter(st.sfx))}
    ${row(2, "Damage numbers", st.numbers ? "On" : "Off")}${row(3, "Screen shake", st.shake ? "On" : "Off")}
    ${keys([kbd("↑", "↓"), "choose"], [kbd("←", "→"), "change"], [kbd("⌫"), "back"])}
  </div>`);
}

// ---- the night -----------------------------------------------------------------------------------------------------------

function begin() {
  if (!heroOpen(save, save.hero)) return;
  enter(create(loadout(save, (Date.now() ^ (save.totals.nights * 2654435761)) >>> 0)));
  audio.play("act1");
  banner({ banner: ACTS[0].name, sub: ACTS[0].sub, tone: "act" });
}

/** A stored night back on screen: paused, or on the card it was left at, with its music waiting. */
function carryOn(s: State) {
  enter(s);
  const boss = s.enemies.find((e) => e.boss)?.boss;
  audio.play(boss ? (boss === "oni" ? "oni" : "boss") : (["act1", "act2", "act3"] as const)[actAt(s.t)]);
  if (s.phase === "levelup") { audio.suspend(); levelCard(); }
  else if (s.phase === "chest") { audio.suspend(); startChest(); }
  else setPaused(true);
}

function enter(s: State) {
  run = s;
  screen = "run";
  paused = false;
  earned = undefined;
  endAt = 0;
  held.clear();
  $("#hud").hidden = false;
  kitShown = "";
  goldShown = -1;
  announced.clear();
  show("", false);
}

/** The night as it stands, stored (on hiding); none once it's over. */
function keep() {
  if (scene) return;
  const live = screen === "run" && run && (run.phase === "play" || run.phase === "levelup" || run.phase === "chest");
  pal.storage.set("run", live ? packRun(run!) : null).catch((e) => console.error("night-parade: keep", e));
}

function drain(s: State) {
  for (const ev of s.events) {
    if ("sfx" in ev) audio.sfx(ev.sfx);
    else if ("music" in ev) audio.play(ev.music === "none" ? undefined : ev.music);
    else if ("banner" in ev) banner(ev);
    else if ("boss" in ev) bossIntro(ev.boss);
    else react(ev, save.settings);
  }
  s.events.length = 0;
}

function setPaused(p: boolean) {
  if (screen !== "run" || !run || run.phase !== "play") return;
  paused = p;
  tuning = false;
  held.clear();
  if (p) { audio.suspend(); pauseCard(); } else { audio.unsuspend(); show("", false); }
}

// ---- input -----------------------------------------------------------------------------------------------------------------

const MOVE: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1], KeyA: [-1, 0], KeyD: [1, 0], KeyW: [0, -1], KeyS: [0, 1],
};
const held = new Set<string>();
let dash = false;
const input = () => {
  let x = 0, y = 0;
  for (const k of held) if (MOVE[k]) { x += MOVE[k][0]; y += MOVE[k][1]; }
  return { x: Math.sign(x), y: Math.sign(y), dash };
};

document.addEventListener("keydown", (e) => {
  // macOS never sends keyup for keys let go while ⌘ is down: forget what's held rather than walk on forever.
  if (e.metaKey || e.ctrlKey || e.altKey || /^(Meta|Control|Alt)/.test(e.code)) { held.clear(); return; }
  if (e.code === "Backquote") { perfOn = !perfOn; $("#perf").hidden = !perfOn; return; }
  audio.wake();
  if (MOVE[e.code] || e.code === "Space") e.preventDefault();
  if (e.code === "KeyM") return toggleSound();
  if (screen === "run" && run?.phase === "play" && !paused) {
    if (e.code === "Escape" || e.code === "KeyP" || e.code === "Enter") return setPaused(true);
    if (e.code === "Space" && !e.repeat) dash = true;
    if (MOVE[e.code]) held.add(e.code);
    return;
  }
  if (!e.repeat || /Arrow|Key[WASD]/.test(e.code)) key(e.code);
});
document.addEventListener("keyup", (e) => { if (/^(Meta|Control|Alt)/.test(e.code)) held.clear(); else held.delete(e.code); });
window.addEventListener("blur", () => held.clear());

function toggleSound() {
  const on = save.settings.music + save.settings.sfx > 0;
  save.settings.music = on ? 0 : 0.6;
  save.settings.sfx = on ? 0 : 0.8;
  audio.volume(save.settings);
  persist();
}

const move = (code: string, n: number, cols = 1) => {
  const d = ({ ArrowLeft: -1, KeyA: -1, ArrowRight: 1, KeyD: 1, ArrowUp: -cols, KeyW: -cols, ArrowDown: cols, KeyS: cols } as Record<string, number>)[code];
  if (d === undefined) return false;
  sel = (sel + d + n) % n;
  audio.sfx("move");
  return true;
};

/** A key on a screen or a card (the night's own keys are handled above). */
function key(code: string) {
  const ok = code === "Enter" || code === "Space", back = code === "Escape" || code === "Backspace";
  switch (screen) {
    case "title": {
      if (move(code, MENU.length)) return title();
      if (!ok) return;
      audio.sfx("accept");
      const m = MENU[sel];
      if (m === "Begin") { sel = HERO_ORDER.indexOf(save.hero); return heroes(); }
      sel = 0;
      if (m === "Shrine") return shrine();
      if (m === "Codex") { codexTab = 0; return codex(); }
      screen = "settings";
      return settings();
    }
    case "heroes":
      if (move(code, HERO_ORDER.length, 3)) { if (heroOpen(save, HERO_ORDER[sel])) save.hero = HERO_ORDER[sel]; return heroes(); }
      if ((code === "KeyQ" || code === "KeyE") && save.unlocked.includes("omens")) {
        save.omen = Math.max(0, Math.min(OMEN_MAX, save.omen + (code === "KeyE" ? 1 : -1)));
        audio.sfx("move");
        return heroes();
      }
      if (back) { audio.sfx("back"); sel = 0; return title(); }
      if (ok && heroOpen(save, HERO_ORDER[sel])) { save.hero = HERO_ORDER[sel]; persist(); audio.sfx("accept"); return begin(); }
      return;
    case "shrine":
      if (move(code, SHRINE_ORDER.length, 3)) { refundArmed = false; return shrine(); }
      if (back) { audio.sfx("back"); sel = 1; refundArmed = false; return title(); }
      if (ok) { audio.sfx(buy(save, SHRINE_ORDER[sel]) ? "buy" : "back"); persist(); return shrine(); }
      if (code === "KeyR") {
        if (refundArmed) { refund(save); persist(); audio.sfx("coin"); refundArmed = false; } else refundArmed = true;
        return shrine();
      }
      return;
    case "codex":
      if (code === "ArrowLeft" || code === "KeyA" || code === "ArrowRight" || code === "KeyD") {
        codexTab = (codexTab + (code === "ArrowLeft" || code === "KeyA" ? -1 : 1) + TABS.length) % TABS.length;
        audio.sfx("move");
        return codex();
      }
      if (back) { audio.sfx("back"); sel = 2; return title(); }
      return;
    case "settings": return settingsKey(code, ok, back, () => { sel = 3; title(); });
    case "run": return runKey(code, ok, back);
    case "results":
      if (ok) { audio.sfx("accept"); return begin(); }
      if (back) { audio.sfx("back"); sel = 0; return title(); }
  }
}

function settingsKey(code: string, ok: boolean, back: boolean, leave: () => void) {
  if (code === "ArrowUp" || code === "KeyW" || code === "ArrowDown" || code === "KeyS") { move(code, SETTINGS.length); return settings(); }
  const st = save.settings, s = SETTINGS[sel], d = code === "ArrowLeft" || code === "KeyA" ? -1 : code === "ArrowRight" || code === "KeyD" || ok ? 1 : 0;
  if (d) {
    if (s === "music" || s === "sfx") st[s] = Math.max(0, Math.min(1, Math.round((st[s] + d * 0.1) * 10) / 10));
    else st[s] = !st[s];
    audio.volume(st);
    view.numbers = st.numbers;
    audio.sfx("move");
    persist();
    return settings();
  }
  if (back) { audio.sfx("back"); leave(); }
}

function runKey(code: string, ok: boolean, back: boolean) {
  const s = run!;
  if (paused && tuning) return settingsKey(code, ok, back, () => { tuning = false; audio.suspend(); pauseCard(); });
  if (paused) {
    if (code === "KeyS") { tuning = true; sel = 0; audio.unsuspend(); return settings(); }
    if (back || ok || code === "KeyP") setPaused(false);
    else if (code === "KeyQ") { paused = false; s.phase = "dead"; s.tally.killedBy = "surrender"; audio.unsuspend(); show("", false); finish(); }
    return;
  }
  if (s.phase === "levelup") {
    const n = s.choices.length;
    if (/^Digit[1-4]$/.test(code)) return pick(Number(code.slice(5)) - 1);
    if (code === "ArrowUp" || code === "KeyW" || code === "ArrowDown" || code === "KeyS") { move(code, n); return levelCard(); }
    if (ok) return pick(sel);
    if (code === "KeyR" && s.rerolls > 0) { reroll(s); drain(s); sel = 0; return levelCard(); }
    if (code === "KeyX" && s.skips > 0) { skip(s); drain(s); sel = 0; return afterCard(); }
    if (code === "KeyB" && s.banishes > 0) { banish(s, sel); drain(s); sel = 0; return levelCard(); }
    return;
  }
  if (s.phase === "chest") {
    if (!ok) return;
    if (chestShown < (s.chest?.length ?? 0)) { chestShown = s.chest!.length; chestAt = performance.now() - 99999; return chestCard(); }
    resume(s);
    drain(s);
    return afterCard();
  }
}

function pick(i: number) {
  const s = run!;
  if (!s.choices[i]) return;
  choose(s, i);
  drain(s);
  sel = 0;
  afterCard();
}

/** After a card: the next card if there is one, else back to the night. */
function afterCard() {
  const s = run!;
  if (s.phase === "levelup") return levelCard();
  if (s.phase === "chest") return startChest();
  show("", false);
}

// ---- cards ----------------------------------------------------------------------------------------------------------------

type Shown = { icon: string; name: string; tag: string; what: string; hint?: string; pair?: boolean };

function describe(s: State, c: Choice): Shown {
  if (c.type === "gold") return { icon: iconUrl("Money"), name: "A purse", tag: "", what: "25 gold." };
  if (c.type === "food") return { icon: iconUrl("Dish"), name: "A meal", tag: "", what: "Heals 30." };
  if (c.type === "weapon") {
    const d = WEAPONS[c.kind], has = s.items.some((it) => it.kind === d.evolveWith);
    return {
      icon: wIcon(c.kind), name: d.name, tag: c.level === 1 ? "New" : `Lv ${c.level}`, what: levelText(c.kind, c.level),
      hint: `${has ? "★ " : ""}Evolves with ${ITEMS[d.evolveWith].name}${c.level === WEAPON_MAX && has ? " at the next chest" : ""}`, pair: has || pairs(s, c),
    };
  }
  const d = ITEMS[c.kind], ws = (Object.keys(WEAPONS) as WeaponKind[]).filter((w) => WEAPONS[w].evolveWith === c.kind);
  const mine = ws.filter((w) => s.weapons.some((x) => x.kind === w && !x.evolved));
  return {
    icon: iIcon(c.kind), name: d.name, tag: c.level === 1 ? "New" : `Lv ${c.level}`, what: d.blurb,
    hint: ws.length ? `${mine.length ? "★ Evolves your " : "Evolves "}${(mine.length ? mine : ws).map((w) => WEAPONS[w].name).join(", ")}` : undefined, pair: mine.length > 0,
  };
}

function levelCard() {
  held.clear();
  const s = run!, n = s.choices.length;
  sel = Math.max(0, Math.min(n - 1, sel));
  show(`<div class="panel">
    <h2>Level ${s.p.level - s.pending + 1} <small>choose one</small></h2>
    <div class="list">${s.choices.map((c, i) => {
      const d = describe(s, c);
      return `<div class="opt${i === sel ? " sel" : ""}" data-i="${i}"><div class="ico">${img(d.icon)}</div><div><span class="name">${d.name}</span><span class="tag${d.tag === "New" ? " new" : ""}">${d.tag}</span><div class="what">${esc(d.what)}</div>${d.hint ? `<div class="hint${d.pair ? " pair" : ""}">${esc(d.hint)}</div>` : ""}</div><div class="side">${kbd(String(i + 1))}</div></div>`;
    }).join("")}</div>
    <div class="tools"><span class="tool${s.rerolls ? "" : " none"}">${kbd("R")} Reroll ${s.rerolls}</span><span class="tool${s.skips ? "" : " none"}">${kbd("X")} Skip ${s.skips}</span><span class="tool${s.banishes ? "" : " none"}">${kbd("B")} Banish ${s.banishes}</span></div>
  </div>`);
}

let chestShown = 0, chestAt = 0, chestDrawn = "";
function startChest() {
  held.clear();
  chestShown = 0;
  chestAt = performance.now();
  chestDrawn = "";
  chestCard();
}

function prizeHtml(s: State, i: number, spinning: boolean) {
  const p = s.chest![i];
  if (spinning) {
    const pool = [...(Object.keys(WEAPONS) as WeaponKind[]).map(wIcon), ...(Object.keys(ITEMS) as ItemKind[]).map(iIcon)];
    return `<div class="prize spin"><div class="ico">${img(pool[Math.floor(Math.random() * pool.length)])}</div><div class="n">…</div></div>`;
  }
  if (p.type === "evolve") return `<div class="prize evo"><div class="ico">${img(wIcon(p.kind))}</div><div class="n">${WEAPONS[p.kind].evolved}</div><div class="d">${esc(WEAPONS[p.kind].evolvedBlurb)}</div></div>`;
  if (p.type === "gold") return `<div class="prize"><div class="ico">${img(iconUrl("Money"))}</div><div class="n">${Math.round(p.n)} gold</div></div>`;
  const d = describe(s, p.choice);
  return `<div class="prize"><div class="ico">${img(d.icon)}</div><div class="n">${d.name} <span class="lv">${d.tag}</span></div><div class="d">${esc(d.what)}</div></div>`;
}

function chestCard() {
  const s = run!, prizes = s.chest ?? [], tier = prizes.length, evo = prizes.some((p) => p.type === "evolve");
  const opened = performance.now() - chestAt > 700;
  const spinning = opened && chestShown < tier;
  const sig = `${opened}|${chestShown}|${spinning ? Math.floor(performance.now() / 90) : ""}`;
  if (sig === chestDrawn) return;
  chestDrawn = sig;
  show(`<div class="panel chest${opened ? " open" : ""}">
    <h2 style="justify-content:center">${evo && chestShown > 0 ? "Evolution!" : tier >= 5 ? "A golden chest" : tier >= 3 ? "A great chest" : "A chest"}</h2>
    <div class="box" style="background-image:url(./assets/items/${tier > 1 ? "chest-big" : "chest-small"}.png)"></div>
    <div class="prizes">${prizes.slice(0, chestShown).map((_, i) => prizeHtml(s, i, false)).join("")}${spinning ? prizeHtml(s, chestShown, true) : ""}</div>
    ${keys([kbd("↵"), chestShown < tier ? "reveal all" : "carry on"])}
  </div>`);
}

/** The chest's reveal: a shake, the lid, then each prize after a short spin. */
function tickChest(now: number) {
  const s = run;
  if (!s || s.phase !== "chest" || !s.chest) return;
  const t = now - chestAt;
  const due = t < 700 ? 0 : Math.min(s.chest.length, Math.floor((t - 700) / 550));
  if (due > chestShown) {
    chestShown = due;
    audio.sfx(s.chest[due - 1].type === "evolve" ? "evolve" : "coin");
  }
  chestCard();
}

function pauseCard() {
  const s = run!, st = s.st, total = s.weapons.reduce((a, w) => a + w.dmg, 0) || 1;
  const statKeys: StatKey[] = ["maxHp", "recovery", "armor", "might", "area", "speed", "duration", "amount", "cooldown", "move", "magnet", "luck", "growth", "greed", "curse", "revival"];
  const base: Partial<Record<StatKey, number>> = { move: 66, magnet: 42 };
  show(`<div class="panel wide">
    <h2>Paused <small>${clock(s.t)} into the night, level ${s.p.level}, ${HEROES[s.load.hero].name}</small></h2>
    <div class="cols">
      <div class="build">${s.weapons.map((w) => `<div class="brow">${img(wIcon(w.kind))}<span>${w.evolved ? `<b style="color:var(--gold)">${WEAPONS[w.kind].evolved}</b>` : `${WEAPONS[w.kind].name} ${pips(w.level, WEAPON_MAX)}`}</span><span class="v">${Math.round(w.dmg).toLocaleString()}</span><div class="bar"><i style="width:${(w.dmg / total) * 100}%"></i></div></div>`).join("")}
        ${s.items.map((it) => `<div class="brow">${img(iIcon(it.kind))}<span>${ITEMS[it.kind].name} ${pips(it.level, ITEMS[it.kind].max)}</span><span class="v"></span></div>`).join("")}</div>
      <div class="statlist">${statKeys.map((k) => `<span>${STAT_NAMES[k]}</span><b>${k === "maxHp" ? Math.round(st.maxHp) : statText(k, st[k] - (base[k] ?? 0))}</b>`).join("")}</div>
    </div>
    ${keys([kbd("P"), "carry on"], [kbd("S"), "settings"], [kbd("Q"), "give up the night"], [kbd("M"), "mute"])}
  </div>`);
}

function finish() {
  earned = settle(save, run!);
  persist();
  keep();
  endAt = performance.now();
  if (earned.unlocks.length) setTimeout(() => audio.sfx("unlock"), 1600);
}

function results() {
  const s = run!, p = s.p, won = s.phase === "won";
  screen = "results";
  $("#hud").hidden = true;
  const total = s.weapons.reduce((a, w) => a + w.dmg, 0) || 1;
  const by = s.tally.killedBy;
  const who = by && ((ENEMIES as Record<string, { name: string }>)[by]?.name ?? (BOSSES as Record<string, { name: string }>)[by]?.name);
  const byText = !by ? "" : by === "surrender" ? "You gave up the night." : `Taken by ${who ?? by}.`;
  show(`<div class="panel wide ${won ? "dawn" : "dead"}">
    <h1>${won ? "Dawn" : "The parade took you"}</h1>
    <p>${won ? "The sky pales, and the parade melts into the morning mist. You saw the dawn." : `You lasted ${clock(s.t)} of the night. ${byText}`}${earned?.record ? ` <b style="color:var(--gold)">A new best for ${HEROES[s.load.hero].name}.</b>` : ""}</p>
    <div class="facts"><div><b>${clock(s.t)}</b><span>survived</span></div><div><b>${p.level}</b><span>level</span></div><div><b>${p.kills.toLocaleString()}</b><span>defeated</span></div><div><b>+${earned?.gold ?? 0}</b><span>gold</span></div></div>
    <div class="build">${[...s.weapons].sort((a, b) => b.dmg - a.dmg).map((w) => `<div class="brow">${img(wIcon(w.kind))}<span>${w.evolved ? `<b style="color:var(--gold)">${WEAPONS[w.kind].evolved}</b>` : `${WEAPONS[w.kind].name} ${pips(w.level, WEAPON_MAX)}`}</span><span class="v">${Math.round(w.dmg).toLocaleString()} · ${w.kills} kills · ${Math.round(w.dmg / Math.max(1, s.t - w.since))}/s</span><div class="bar"><i style="width:${(w.dmg / total) * 100}%"></i></div></div>`).join("")}</div>
    ${earned?.unlocks.length ? `<div class="unlocks"><b>Unlocked</b>${earned.unlocks.map((u) => `<div>${UNLOCKS[u].name}</div>`).join("")}</div>` : ""}
    ${keys([kbd("↵"), "another night"], [kbd("⌫"), "to the title"])}
  </div>`);
}

// ---- banners -------------------------------------------------------------------------------------------------------------

function banner(ev: { banner: string; sub?: string; tone: string }) {
  const tone = ev.tone === "boss" ? "event" : ev.tone;
  const box = $("#banners");
  box.querySelectorAll(`.banner.${tone}`).forEach((b) => b.remove());
  const el = document.createElement("div");
  el.className = `banner ${tone}`;
  el.innerHTML = `<b>${esc(ev.banner)}</b>${ev.sub ? `<span>${esc(ev.sub)}</span>` : ""}`;
  box.append(el);
  setTimeout(() => el.remove(), 3000);
}

function bossIntro(k: BossKind) {
  const d = BOSSES[k], box = $("#banners");
  const el = document.createElement("div");
  el.className = "banner boss";
  el.innerHTML = `${img(faceUrl(k))}<div><b>${esc(d.name)}</b><span>${esc(d.title)}</span></div>`;
  box.append(el);
  setTimeout(() => el.remove(), 3500);
  // The name card says it: drop the plain banner that came with it.
  queueMicrotask(() => box.querySelectorAll(".banner.event").forEach((b) => { if (b.textContent?.startsWith(d.name)) b.remove(); }));
}

// ---- HUD ------------------------------------------------------------------------------------------------------------------

let kitShown = "", lastSec = -1, goldShown = -1;
const announced = new Set<UnlockKind>();
function hud(s: State) {
  const p = s.p;
  $("#xp i").style.width = `${Math.min(100, (p.xp / needed(p.level)) * 100)}%`;
  $("#lv").textContent = `LV ${p.level}`;
  const sec = Math.floor(s.t);
  if (sec !== lastSec) {
    lastSec = sec;
    $("#clock b").textContent = clock(s.t);
    $("#act").textContent = ACTS[actAt(s.t)].name;
    $("#kills").textContent = `☠ ${p.kills.toLocaleString()}`;
    pal.title(`Night Parade · ${clock(s.t)}`);
    // An unlock the moment it's earned, not only at the end.
    for (const u of earnedUnlocks(s)) if (!save.unlocked.includes(u) && !announced.has(u)) {
      announced.add(u);
      banner({ banner: `Unlocked: ${UNLOCKS[u].name}`, sub: UNLOCKS[u].how, tone: "good" });
      audio.sfx("unlock");
    }
  }
  if (Math.floor(p.gold) !== goldShown) { goldShown = Math.floor(p.gold); $("#gold").innerHTML = `${img(iconUrl("Money"))}${goldShown}`; }
  const sig = s.weapons.map((w) => `${w.kind}${w.level}${w.evolved}`).join() + "|" + s.items.map((i) => `${i.kind}${i.level}`).join();
  if (sig !== kitShown) {
    kitShown = sig;
    const slot = (src: string | undefined, lv: string, evo = false) => (src ? `<span class="slot${evo ? " evo" : ""}">${img(src)}<b>${lv}</b></span>` : `<span class="slot empty"></span>`);
    $("#kit").innerHTML =
      Array.from({ length: 6 }, (_, i) => { const w = s.weapons[i]; return slot(w && wIcon(w.kind), w ? (w.evolved ? "★" : String(w.level)) : "", w?.evolved); }).join("") +
      Array.from({ length: 6 }, (_, i) => { const it = s.items[i]; return slot(it && iIcon(it.kind), it ? String(it.level) : ""); }).join("");
  }
  const boss = s.enemies.find((e) => e.boss && !e.dead);
  $("#bossbar").hidden = !boss;
  if (boss) {
    const k = boss.boss!;
    const im = $<HTMLImageElement>("#bossbar img");
    if (!im.src.endsWith(`${k}.png`)) im.src = faceUrl(k);
    $("#bossbar span").textContent = BOSSES[k].name;
    $("#bossbar .bar i").style.width = `${(boss.hp / boss.max) * 100}%`;
  }
}

// ---- the frame ---------------------------------------------------------------------------------------------------------------

let acc = 0, then = performance.now();
/** Where frame time goes (read by headless checks through ?dev). */
const prof = { sim: 0, drain: 0, draw: 0, hud: 0, frames: 0 };
let perfOn = false, perfAt = 0, perfFrames = 0, perfWorst = 0, perfLast = 0;
/** The ` overlay: frames a second, the worst frame, where the time went, and what's on the field. */
function perfTick(now: number, s: State) {
  perfFrames++;
  perfWorst = Math.max(perfWorst, now - perfLast);
  perfLast = now;
  if (now - perfAt < 500) return;
  const f = prof.frames || 1, secs = (now - perfAt) / 1000;
  $("#perf").textContent =
    `${Math.round(perfFrames / secs)} fps · worst ${perfWorst.toFixed(0)} ms · sim ${(prof.sim / f).toFixed(2)} · draw ${(prof.draw / f).toFixed(2)} · hud ${(prof.hud / f).toFixed(2)} ms\n` +
    `enemies ${s.enemies.length} · shots ${s.shots.length} · theirs ${s.foeShots.length} · fx ${s.fx.length} · zones ${s.zones.length} · gems ${s.gems.length} · ${view.w}×${view.h}@${view.dpr} zoom ${view.zoom}`;
  for (const k of Object.keys(prof) as (keyof typeof prof)[]) prof[k] = 0;
  perfAt = now;
  perfFrames = 0;
  perfWorst = 0;
}
function frame(now: number) {
  const dt = Math.min(0.1, (now - then) / 1000);
  then = now;
  if (screen === "run" && run) {
    const s = run;
    if (!paused && s.phase === "play") {
      // At most four steps a frame: a slow frame drops time rather than snowballing into slower ones.
      acc = Math.min(acc + dt, DT * 4);
      const t0 = performance.now();
      while (acc >= DT && s.phase === "play") {
        step(s, scene ? drive(s) : input());
        if (scene) s.p.hp = s.st.maxHp;
        dash = false;
        acc -= DT;
      }
      prof.sim += performance.now() - t0;
      const t1 = performance.now();
      drain(s);
      prof.drain += performance.now() - t1;
      const ph = s.phase as State["phase"]; // step() moved it on
      if (scene && (ph === "levelup" || ph === "chest")) { // a staged scene plays on without cards
        if (ph === "levelup") choose(s, pickChoice(s)); else resume(s);
        while ((s.phase as State["phase"]) === "levelup") choose(s, pickChoice(s));
        s.events.length = 0;
      } else if (ph === "levelup") { acc = 0; sel = 0; levelCard(); }
      else if (ph === "chest") { acc = 0; startChest(); }
      else if (ph === "dead" || ph === "won") { acc = 0; finish(); }
    }
    tickChest(now);
    if (endAt && now - endAt > (s.phase === "won" ? 3200 : 1800)) results();
    const t2 = performance.now();
    draw(view, s, now / 1000);
    const t3 = performance.now();
    if (screen === "run") hud(s);
    prof.draw += t3 - t2;
    prof.hud += performance.now() - t3;
    prof.frames++;
    if (perfOn) perfTick(now, s);
  } else if (screen === "results" && run) draw(view, run, now / 1000);
  else {
    stepDemo(dt);
    const numbers = view.numbers;
    view.numbers = false; // the demo behind the title stays quiet
    draw(view, demo, now / 1000);
    view.numbers = numbers;
  }
  requestAnimationFrame(frame);
}

function fit() {
  const w = window.innerWidth, h = window.innerHeight, dpr = window.devicePixelRatio || 1;
  Object.assign(view, { w, h, dpr, zoom: zoomFor(w, h) });
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
}
window.addEventListener("resize", fit);

// ---- pal ---------------------------------------------------------------------------------------------------------------------

// The view's actions, picked from ⌘K (index.ts ACTIONS).
pal.onAction((id) => {
  if (id === "mute") return toggleSound();
  if (screen !== "run" || !run) return;
  if (id === "pause") { if (paused) setPaused(false); else setPaused(true); }
  if (id === "give-up" && (run.phase === "play" || paused)) { paused = false; run.phase = "dead"; run.tally.killedBy = "surrender"; audio.unsuspend(); show("", false); finish(); }
});

pal.onHidden(() => {
  held.clear();
  if (screen === "run" && run?.phase === "play" && !paused) setPaused(true);
  audio.suspend();
  keep();
});
pal.onShown(() => { if (!paused || tuning) audio.unsuspend(); });
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) return;
  if (screen === "run" && run?.phase === "play" && !paused) setPaused(true);
  keep();
});

// `?dev`: the page's state on window.np, so a headless check can jump ahead.
if (new URLSearchParams(location.search).has("dev")) Object.assign(window, { np: { get run() { return run; }, get save() { return save; }, prof, restat, spawnAt, begin, key, results, title } });

/**
 * A staged moment for the store's screenshots (fixture.ts writes it to the
 * extension's storage): a night from a seed with a build, played forward by the
 * bot, then shown live with the bot still playing and never dying; or a card
 * over it (a level-up, a chest with its prizes). Never set by the game itself.
 */
let scene: Scene | undefined;

function stage(sc: Scene) {
  const s = create({ ...loadout(save, sc.seed), hero: sc.hero, locked: [] });
  for (const [k, l, evo] of sc.weapons) {
    if (!s.weapons.some((w) => w.kind === k)) { s.phase = "levelup"; s.choices = [{ type: "weapon", kind: k, level: 1 }]; s.pending = 1; choose(s, 0); }
    const w = s.weapons.find((x) => x.kind === k)!;
    w.level = l;
    w.evolved = !!evo;
  }
  for (const [k, l] of sc.items) s.items.push({ kind: k, level: l });
  s.p.level = sc.level;
  restat(s);
  s.p.hp = s.st.maxHp;
  s.t = sc.t;
  s.act = actAt(sc.t);
  const next = EVENTS.findIndex((e) => e.at > sc.t - 1);
  s.eventIdx = next < 0 ? EVENTS.length : next;
  for (let i = 0; i < sc.play * 60; i++) {
    if (s.phase === "levelup") choose(s, pickChoice(s));
    else if (s.phase === "chest") resume(s);
    step(s, drive(s));
    s.p.hp = s.st.maxHp;
  }
  s.phase = "play";
  s.pending = 0;
  s.events.length = 0;
  run = s;
  screen = "run";
  $("#hud").hidden = false;
  show("", false);
  if (sc.card === "levelup") { s.pending = 1; levelUp(s); sel = 0; levelCard(); }
  if (sc.card === "chest") { openChest(s, 5); startChest(); }
}

/** pal's Settings › Volume, in percent, over the game's own music and sound. */
const loudness = (s: Record<string, unknown>) => audio.master(typeof s.volume === "number" ? Math.max(0, Math.min(100, s.volume)) / 100 : 1);

async function boot() {
  save = load(await pal.storage.get("save").catch(() => null));
  scene = (await pal.storage.get("scene").catch(() => null)) as Scene | undefined ?? undefined;
  const kept = scene ? undefined : unpackRun(await pal.storage.get("run").catch(() => null));
  view.numbers = save.settings.numbers;
  audio.volume(save.settings);
  loudness(await pal.settings().catch(() => ({})));
  pal.onSettings(loudness);
  useFont();
  fit();
  await loaded();
  if (scene) stage(scene);
  else if (kept) carryOn(kept);
  else title();
  pal.ready();
  requestAnimationFrame(frame);
}
void boot();
