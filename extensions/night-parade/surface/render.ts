// Drawing a night. World pixels go to the screen at a whole-number zoom so
// the pack's 16 px sprites stay crisp. Back to front: the ground, the
// telegraphs and ground zones, what lies on the road, the crowd and the
// scenery sorted by depth, shots and effects, particles, the dark with its
// lights, numbers, and the screen's own effects (shake, hurt, low health).
// Nothing here changes the state; particles and ambience are the page's own.
import { BOSSES, type BossKind } from "../game/content/bosses.ts";
import { ENEMIES } from "../game/content/enemies.ts";
import { HEROES } from "../game/content/heroes.ts";
import { ELITE_TRAITS } from "../game/content/stage.ts";
import { sickles, spirits, type Enemy, type State } from "../game/sim/index.ts";
import type { Dir, Event, Fx, FxKind, ShotSprite } from "../game/sim/core.ts";

const A = "./assets/";

// ---- sheets --------------------------------------------------------------------------------------------------------

export type Sheet = { img: HTMLImageElement; fw: number; fh: number; n: number; path: string };
const sheets = new Map<string, Sheet>();

/** A sprite sheet of `n` frames of fw by fh, left to right (n from the width when not given). */
export function sheet(path: string, fw: number, fh = fw, n?: number): Sheet {
  let s = sheets.get(path);
  if (!s) {
    const img = new Image();
    s = { img, fw, fh, n: n ?? 1, path };
    const me = s;
    img.onload = () => { if (!n) me.n = Math.max(1, Math.floor(img.width / fw)); };
    img.src = A + path;
    sheets.set(path, s);
  }
  return s;
}
const ready = (s: Sheet) => s.img.complete && s.img.naturalWidth > 0;

/** Every image the page draws, loaded. */
export const loaded = () => Promise.all([...sheets.values()].map((s) => s.img.decode().catch(() => undefined)));

/** A sheet recoloured: solid (a flash) or washed (frozen, stone, an elite's colour). Cached. */
const tints = new Map<string, HTMLCanvasElement>();
function tinted(s: Sheet, color: string, mode: "solid" | "wash"): CanvasImageSource {
  const k = `${s.path}|${color}|${mode}`;
  let c = tints.get(k);
  if (c) return c;
  if (!ready(s)) return s.img;
  c = document.createElement("canvas");
  c.width = s.img.width;
  c.height = s.img.height;
  const x = c.getContext("2d")!;
  x.drawImage(s.img, 0, 0);
  x.globalCompositeOperation = mode === "solid" ? "source-in" : "source-atop";
  x.fillStyle = color;
  if (mode === "wash") x.globalAlpha = 0.55;
  x.fillRect(0, 0, c.width, c.height);
  tints.set(k, c);
  return c;
}

// ---- what to draw with ------------------------------------------------------------------------------------------------

const HERO_SHEETS = Object.fromEntries(
  Object.keys(HEROES).map((h) => [h, { walk: sheet(`sprites/${h}-walk.png`, 16), idle: h === "raiden" ? undefined : sheet(`sprites/${h}-idle.png`, 16), dead: sheet(`sprites/${h}-dead.png`, 16) }]),
) as Record<string, { walk: Sheet; idle?: Sheet; dead: Sheet }>;
const WALKERS = Object.fromEntries(Object.values(ENEMIES).map((d) => [d.sprite, sheet(`sprites/${d.sprite}.png`, 16)])) as Record<string, Sheet>;

type BossSheets = { idle: Sheet; walk?: Sheet; hit?: Sheet; attack?: Sheet; charge?: Sheet; zoom: number };
const BOSS: Record<BossKind, BossSheets> = {
  frog: { idle: sheet("sprites/frog-idle.png", 40), hit: sheet("sprites/frog-hit.png", 40), attack: sheet("sprites/frog-jump.png", 40), zoom: 1 },
  tanuki: { idle: sheet("sprites/tanuki-idle.png", 60), attack: sheet("sprites/tanuki-attack.png", 60), charge: sheet("sprites/tanuki-charge.png", 60), zoom: 1 },
  yurei: { idle: sheet("sprites/yurei-idle.png", 50), hit: sheet("sprites/yurei-hit.png", 50), zoom: 1 },
  tengu: { idle: sheet("sprites/tengu-idle.png", 82), walk: sheet("sprites/tengu-walk.png", 82), hit: sheet("sprites/tengu-hit.png", 82), attack: sheet("sprites/tengu-attack.png", 82), zoom: 1 },
  samurai: { idle: sheet("sprites/samurai-idle.png", 96, 48), walk: sheet("sprites/samurai-walk.png", 96, 48), hit: sheet("sprites/samurai-hit.png", 96, 48), zoom: 1 },
  oni: { idle: sheet("sprites/oni-idle.png", 50), walk: sheet("sprites/oni-walk.png", 50), hit: sheet("sprites/oni-hit.png", 50), zoom: 2 },
};

const FX: Record<FxKind, Sheet> = {
  slash: sheet("fx/slash.png", 32), "slash-circle": sheet("fx/slash-circle.png", 32), claw: sheet("fx/claw.png", 32),
  thunder: sheet("fx/thunder.png", 20, 28), explosion: sheet("fx/explosion.png", 40), flame: sheet("fx/flame.png", 25, 30),
  "rock-spike": sheet("fx/rock-spike.png", 54, 48), rock: sheet("fx/rock.png", 60, 30), ice: sheet("fx/ice.png", 32), "ice-flake": sheet("fx/ice-flake.png", 32),
  plant: sheet("fx/plant.png", 24, 28, 10), water: sheet("fx/water.png", 44, 33, 10), pillar: sheet("fx/pillar.png", 30, 41),
  smoke: sheet("fx/smoke.png", 32), "smoke-circle": sheet("fx/smoke-circle.png", 60, 14), circle: sheet("fx/circle.png", 32),
  spark: sheet("fx/spark.png", 27, 35), boost: sheet("fx/boost.png", 53, 35), aura: sheet("fx/aura.png", 25, 24, 5), shield: sheet("fx/shield.png", 24, 26, 6),
  hit: sheet("fx/spark.png", 27, 35), leaf: sheet("fx/leaf.png", 12, 7), thrust: sheet("fx/lance.png", 6, 23),
};
const SHOTS: Record<ShotSprite, Sheet> = {
  shuriken: sheet("fx/shuriken.png", 16), "shuriken-magic": sheet("fx/shuriken-magic.png", 16), kunai: sheet("fx/kunai.png", 14, 5),
  "kunai-big": sheet("fx/kunai-big.png", 35, 9), fireball: sheet("fx/fireball.png", 16), arrow: sheet("fx/arrow.png", 13, 5),
  ice: sheet("fx/ice-spike.png", 18, 10), gust: sheet("fx/arc.png", 38, 34), wave: sheet("fx/arc.png", 38, 34),
};
const FOE = {
  water: sheet("fx/energy.png", 16), bolt: sheet("fx/ice-spike.png", 18, 10), ink: sheet("fx/cannonball.png", 16), flame: sheet("fx/fireball.png", 16),
  feather: sheet("fx/feather.png", 16), wisp: sheet("fx/energy-big.png", 24, 24, 4), club: sheet("fx/club.png", 8, 14),
};
const SPIRIT = sheet("fx/spirit.png", 32), SPIRIT_BLUE = sheet("fx/spirit-blue.png", 32), SICKLE = sheet("fx/sickle.png", 16);
const ZONE = { caltrop: sheet("fx/caltrop.png", 16), bomb: sheet("fx/bomb.png", 12, 13), cracker: sheet("fx/dynamite.png", 16) };
const PICK = {
  coin: sheet("items/coin.png", 10, 10, 4), pouch: sheet("items/pouch.png", 16), bag: sheet("items/bag.png", 14, 15), onigiri: sheet("items/onigiri.png", 16),
  feast: sheet("items/feast.png", 16), flute: sheet("items/flute.png", 16), hourglass: sheet("items/hourglass.png", 16), ofuda: sheet("items/ofuda.png", 16),
  gourd: sheet("items/gourd.png", 14), small: sheet("items/chest-small.png", 16, 16, 2), big: sheet("items/chest-big.png", 16, 14, 2),
};
const FLOOR = sheet("tiles/floor.png", 16), DETAIL = sheet("tiles/detail.png", 16), NATURE = sheet("tiles/nature.png", 16);
const VILLAGE = sheet("tiles/village.png", 16), ELEMENT = sheet("tiles/element.png", 16), FLOWER = sheet("tiles/flower.png", 16);
const FOG = sheet("fx/fog.png", 320, 180), LEAF = sheet("fx/leaf.png", 12, 7), PETAL = sheet("fx/leaf-pink.png", 12, 7);

// ---- the scenery ---------------------------------------------------------------------------------------------------------

type Deco = { src: Sheet; sx: number; sy: number; w: number; h: number; tall: boolean; petals?: boolean };
const D = (src: Sheet, sx: number, sy: number, w: number, h: number, tall = true, more: Partial<Deco> = {}): Deco => ({ src, sx, sy, w, h, tall, ...more });
const TREES: Deco[] = [
  D(NATURE, 0, 0, 32, 32), D(NATURE, 32, 0, 32, 32), D(NATURE, 64, 0, 32, 32), D(NATURE, 256, 0, 32, 32),
  D(NATURE, 224, 0, 32, 32, true, { petals: true }), D(NATURE, 0, 32, 64, 48), D(NATURE, 64, 32, 64, 48),
  D(NATURE, 192, 32, 64, 48, true, { petals: true }), D(NATURE, 0, 80, 64, 48), D(NATURE, 0, 288, 48, 48, true, { petals: true }),
  D(NATURE, 48, 288, 48, 48), D(NATURE, 144, 288, 48, 48), D(NATURE, 176, 128, 16, 48),
];
const SMALL: Deco[] = [
  D(NATURE, 258, 132, 29, 27), D(NATURE, 210, 132, 29, 27), D(NATURE, 257, 83, 61, 44), D(NATURE, 1, 134, 30, 23),
  D(NATURE, 0, 160, 16, 16, false), D(NATURE, 16, 160, 16, 16, false), D(NATURE, 32, 160, 16, 16, false), D(NATURE, 114, 227, 28, 25, false),
];
const RUINS: Deco[] = [D(VILLAGE, 0, 0, 63, 48), D(VILLAGE, 128, 0, 48, 48), D(VILLAGE, 144, 86, 32, 26), D(VILLAGE, 32, 50, 17, 46)];
const JAR = D(ELEMENT, 17, 0, 14, 16), STONE_LANTERN = D(VILLAGE, 0, 49, 31, 47);

type Placed = { d: Deco; x: number; y: number };
const chunkDeco = new Map<string, Placed[]>();
const CHUNK = 256;

function noise(x: number, y: number, salt = 0) {
  let h = (x * 374761393 + y * 668265263 + salt * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** A chunk's scenery, the same every time: a few trees, rocks and bushes, now and then a ruin. Nothing at the start. */
function decoOf(cx: number, cy: number): Placed[] {
  const k = `${cx},${cy}`;
  let out = chunkDeco.get(k);
  if (out) return out;
  out = [];
  const n = 3 + Math.floor(noise(cx, cy, 1) * 5);
  for (let i = 0; i < n; i++) {
    const x = cx * CHUNK + noise(cx, cy, 10 + i) * CHUNK, y = cy * CHUNK + noise(cx, cy, 30 + i) * CHUNK;
    if (Math.hypot(x, y) < 70) continue;
    const r = noise(cx, cy, 50 + i);
    const pool = r < 0.08 ? RUINS : r < 0.55 ? TREES : SMALL;
    out.push({ d: pool[Math.floor(noise(cx, cy, 70 + i) * pool.length)], x, y });
  }
  if (chunkDeco.size > 300) chunkDeco.clear();
  chunkDeco.set(k, out);
  return out;
}

// ---- particles and ambience (the page's own, fed by the sim's events) -------------------------------------------------------

type Part = { x: number; y: number; vx: number; vy: number; t: number; life: number; color: string; size: number; g: number; kind?: "leaf" | "petal" | "firefly" | "plus" };
const parts: Part[] = [];
let shake = 0, hurtFlash = 0, levelFlash = 0, whiteFlash = 0;

function burst(x: number, y: number, n: number, colors: string[], speed = 50, life = 0.5, g = 60, size = 1) {
  for (let i = 0; i < n && parts.length < 900; i++) {
    const a = Math.random() * Math.PI * 2, v = speed * (0.3 + Math.random());
    parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - speed * 0.3, t: 0, life: life * (0.6 + Math.random() * 0.8), color: colors[i % colors.length], size, g });
  }
}

/** The sim's screen events: particles and the screen's own effects. */
export function react(ev: Event, settings: { shake: boolean }) {
  if ("shake" in ev) { if (settings.shake) shake = Math.max(shake, ev.shake); return; }
  if (!("vfx" in ev)) return;
  const { x, y } = ev;
  switch (ev.vfx) {
    case "death": burst(x, y, ev.n ?? 5, ["#e8e2d0", "#b8b2a0", "#8a8578"], 40, 0.4, 40); break;
    case "pop": burst(x, y, ev.n ?? 8, [ev.color ?? "#c98b5a", "#8a5a3a", "#e0b080"], 60, 0.5, 120); break;
    case "hurt": hurtFlash = 0.35; burst(x, y, 6, ["#ff5a5a", "#b02030"], 50, 0.35, 80); break;
    case "levelup": levelFlash = 0.8; burst(x, y, 24, ["#9fd8ff", "#ffffff", "#ffd166"], 70, 0.8, -20); break;
    case "gem": burst(x, y, 3, ["#b6f28c", "#ffffff"], 30, 0.3, 0); break;
    case "heal": for (let i = 0; i < 6; i++) parts.push({ x: x + (Math.random() - 0.5) * 14, y: y + (Math.random() - 0.5) * 8, vx: 0, vy: -26, t: 0, life: 0.7, color: "#7ee08a", size: 1, g: 0, kind: "plus" }); break;
    case "gold": burst(x, y - 6, 4, ["#ffd166", "#fff2b0"], 30, 0.4, 40); break;
    case "burst": burst(x, y, ev.n ?? 40, ["#ffd166", "#ff8a5a", "#ffffff"], 110, 1.1, 30, 1.5); whiteFlash = 0.25; break;
    case "evolve": levelFlash = 1.2; whiteFlash = 0.35; burst(x, y, 50, ["#ffd166", "#ffffff", "#ff9fd8"], 120, 1.2, -10, 1.5); break;
    case "purify": whiteFlash = 0.5; burst(x, y, 60, ["#ffffff", "#fff6d8"], 180, 0.9, 0, 1.5); break;
    case "dust": burst(x, y, 8, ["#8a7050", "#6a5540"], 30, 0.5, 20); break;
  }
}

let flies = 0;
function ambient(s: State, halfW: number, halfH: number, dt: number) {
  const p = s.p;
  // Fireflies in the dark, fewer as dawn comes.
  if (flies < 18 * (1 - Math.min(1, s.t / 900)) && Math.random() < dt * 6 && ++flies)
    parts.push({ x: p.x + (Math.random() - 0.5) * halfW * 2.2, y: p.y + (Math.random() - 0.5) * halfH * 2.2, vx: (Math.random() - 0.5) * 8, vy: (Math.random() - 0.5) * 8, t: 0, life: 4 + Math.random() * 4, color: "", size: 1, g: 0, kind: "firefly" });
  // Leaves and petals drifting across.
  if (Math.random() < dt * 1.5)
    parts.push({ x: p.x - halfW - 10, y: p.y + (Math.random() - 0.7) * halfH * 2, vx: 18 + Math.random() * 14, vy: 6 + Math.random() * 8, t: 0, life: 12, color: "", size: 1, g: 0, kind: Math.random() < 0.35 ? "petal" : "leaf" });
}

// ---- the frame ---------------------------------------------------------------------------------------------------------------

/** Whole-number zoom for a viewport of w by h CSS pixels: at least 360 by 195 world pixels in view. */
export const zoomFor = (w: number, h: number) => Math.max(2, Math.floor(Math.min(w / 360, h / 195)));

export type View = { ctx: CanvasRenderingContext2D; w: number; h: number; dpr: number; zoom: number; dark: HTMLCanvasElement; numbers: boolean };

let lastTime = 0;
export function draw(v: View, s: State, time: number) {
  const dt = Math.min(0.05, Math.max(0, time - lastTime));
  lastTime = time;
  const { ctx, w, h, dpr, zoom } = v;
  const k = zoom * dpr, p = s.p, halfW = w / zoom / 2, halfH = h / zoom / 2;
  shake = Math.max(0, shake - dt * 14);
  hurtFlash = Math.max(0, hurtFlash - dt);
  levelFlash = Math.max(0, levelFlash - dt);
  whiteFlash = Math.max(0, whiteFlash - dt);
  const sx = shake ? (Math.random() - 0.5) * shake : 0, sy = shake ? (Math.random() - 0.5) * shake : 0;
  const cx = Math.round(p.x + sx), cy = Math.round(p.y + sy);
  const world = () => { WX.k = k; WX.x = Math.round((halfW - cx) * k); WX.y = Math.round((halfH - cy) * k); ctx.setTransform(k, 0, 0, k, WX.x, WX.y); };
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#1b2a1c";
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  world();
  const x0 = cx - halfW, y0 = cy - halfH, x1 = cx + halfW, y1 = cy + halfH;
  const onScreen = (x: number, y: number, m = 48) => x > x0 - m && x < x1 + m && y > y0 - m && y < y1 + m;

  ground(ctx, x0, y0, x1, y1, time);
  for (const hz of s.hazards) hazard(ctx, hz, time);
  for (const z of s.zones) zone(ctx, z, time);
  for (const g of s.gems) if (onScreen(g.x, g.y)) gem(ctx, g.x, g.y, g.v, time);
  for (const o of s.pickups) if (onScreen(o.x, o.y)) pickup(ctx, o.kind, o.tier, o.x, o.y, time);

  // Scenery and actors, back to front.
  type Item = { y: number; fn: () => void };
  const items: Item[] = [];
  for (let gx = Math.floor(x0 / CHUNK) - 1; gx <= Math.floor(x1 / CHUNK) + 1; gx++)
    for (let gy = Math.floor(y0 / CHUNK) - 1; gy <= Math.floor(y1 / CHUNK) + 1; gy++)
      for (const pl of decoOf(gx, gy)) {
        if (!onScreen(pl.x, pl.y, pl.d.w)) continue;
        if (pl.d.tall) items.push({ y: pl.y, fn: () => deco(ctx, pl.d, pl.x, pl.y, p) });
        else deco(ctx, pl.d, pl.x, pl.y, p);
        if (pl.d.petals && Math.random() < dt * 0.8) parts.push({ x: pl.x + (Math.random() - 0.5) * pl.d.w, y: pl.y - pl.d.h * 0.7, vx: 10 + Math.random() * 8, vy: 8, t: 0, life: 5, color: "", size: 1, g: 0, kind: "petal" });
      }
  const shadows: [number, number, number][] = [];
  for (const e of s.enemies) {
    if (!onScreen(e.x, e.y, 90)) continue;
    if (e.prop) { items.push({ y: e.y, fn: () => deco(ctx, e.prop === "jar" ? JAR : STONE_LANTERN, e.x, e.y + (e.prop === "jar" ? 6 : 8), undefined, e.flash > 0) }); continue; }
    if (e.under) { mound(ctx, e.x, e.y + 4, time + e.id); if (Math.random() < 0.8) parts.push({ x: e.x + (Math.random() - 0.5) * 10, y: e.y + 3, vx: (Math.random() - 0.5) * 12, vy: -14, t: 0, life: 0.45, color: "#8a6e52", size: 1, g: 40 }); continue; }
    if (!e.hidden) shadows.push([e.x, e.y + (e.boss ? e.r * 0.8 : e.flies ? 9 : 6), e.r * (e.flies ? 0.8 : 1.1)]);
    items.push({ y: e.y, fn: () => (e.boss ? boss(ctx, e, s, time) : foe(ctx, e, time)) });
  }
  shadows.push([p.x, p.y + 6, 5.5]);
  items.push({ y: p.y, fn: () => hero(ctx, s, time) });
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  ctx.beginPath();
  for (const [x, y, r] of shadows) { ctx.moveTo(x + r, y); ctx.ellipse(x, y, r, r * 0.42, 0, 0, Math.PI * 2); }
  ctx.fill();
  items.sort((a, b) => a.y - b.y);
  for (const it of items) it.fn();

  for (const sh of s.shots) shot(ctx, sh.sprite, sh.x, sh.y, sh.vx, sh.vy, sh.spin, sh.r, sh.age);
  for (const wpn of s.weapons) {
    if (wpn.kind === "spirit") for (const sp of spirits(s, wpn)) frame(ctx, sp.ring ? SPIRIT_BLUE : SPIRIT, Math.floor(time * 10), sp.x, sp.y, false, 0.6);
    if (wpn.kind === "kusarigama") for (const sk of sickles(s, wpn)) {
      ctx.strokeStyle = "rgba(200,200,210,0.6)";
      ctx.lineWidth = 0.6;
      ctx.setLineDash([1.5, 1.5]);
      ctx.beginPath(); ctx.moveTo(p.x, p.y - 3); ctx.lineTo(sk.x, sk.y); ctx.stroke();
      ctx.setLineDash([]);
      frame(ctx, SICKLE, 0, sk.x, sk.y, false, wpn.evolved ? 1.6 : 1.1, 1, sk.a + Math.PI / 2 + time * 4);
    }
  }
  for (const f of s.fx) effect(ctx, f);
  particles(ctx, dt);

  night(v, s, cx, cy, halfW, halfH, time);
  world();
  foeShots(ctx, s, time);
  // Numbers and your health above the dark, so they always read.
  if (v.numbers) numbers(ctx, s);
  bar(ctx, p.x, p.y + 10, 16, p.hp / s.st.maxHp, p.hp / s.st.maxHp > 0.3 ? "#e8554e" : "#ffb347");
  if (p.dashCd > 0) bar(ctx, p.x, p.y + 13, 10, 1 - p.dashCd / (2.2 * (1 - s.st.dash)), "#9fd8ff");
  screen(v, s, time);
  ambient(s, halfW, halfH, dt);
}

// ---- pieces ----------------------------------------------------------------------------------------------------------------

/** The world's transform: zoom and offset, so a sprite can set its own matrix without save/restore (costly in WebKit). */
const WX = { k: 1, x: 0, y: 0 };

function frame(ctx: CanvasRenderingContext2D, sp: Sheet, f: number, x: number, y: number, flip = false, scale = 1, alpha = 1, angle = 0, src?: CanvasImageSource) {
  if (!ready(sp)) return;
  const fi = ((Math.floor(f) % sp.n) + sp.n) % sp.n, w = sp.fw * scale, h = sp.fh * scale;
  const k = WX.k, c = angle ? Math.cos(angle) * k : k, sn = angle ? Math.sin(angle) * k : 0, fl = flip ? -1 : 1;
  ctx.setTransform(c * fl, sn * fl, -sn, c, WX.x + Math.round(x) * k, WX.y + Math.round(y) * k);
  if (alpha !== 1) ctx.globalAlpha = alpha;
  ctx.drawImage(src ?? sp.img, fi * sp.fw, 0, sp.fw, sp.fh, -w / 2, -h / 2, w, h);
  if (alpha !== 1) ctx.globalAlpha = 1;
  ctx.setTransform(k, 0, 0, k, WX.x, WX.y);
}

/** A 4-direction walker: column is the direction, row the step. */
function walker(ctx: CanvasRenderingContext2D, sp: Sheet, dir: Dir, t: number, x: number, y: number, scale: number, alpha = 1, src?: CanvasImageSource, still = false) {
  if (!ready(sp)) return;
  const row = still ? 0 : Math.floor(t * 8) % 4, w = 16 * scale;
  ctx.globalAlpha = alpha;
  ctx.drawImage(src ?? sp.img, dir * 16, row * 16, 16, 16, Math.round(x - w / 2), Math.round(y - w / 2 - 2 * scale), w, w);
  ctx.globalAlpha = 1;
}

function hero(ctx: CanvasRenderingContext2D, s: State, time: number) {
  const p = s.p, sh = HERO_SHEETS[s.load.hero];
  if (s.phase === "dead") { frame(ctx, sh.dead, 0, p.x, p.y - 2); return; }
  // Dash afterimages.
  if (p.dash > 0) for (let i = 1; i <= 3; i++) walker(ctx, sh.walk, p.dir, p.walk, p.x - p.dvx * 0.012 * i, p.y - p.dvy * 0.012 * i, 1, 0.35 / i, tinted(sh.walk, "#9fd8ff", "solid"));
  const blink = p.hurt > 0 && Math.floor(time * 20) % 2 === 0;
  if (p.invuln > 0) {
    ctx.fillStyle = `rgba(255, 220, 120, ${0.25 + 0.15 * Math.sin(time * 10)})`;
    ctx.beginPath(); ctx.arc(p.x, p.y - 2, 10, 0, Math.PI * 2); ctx.fill();
  }
  if (p.moving || !sh.idle || !ready(sh.idle)) walker(ctx, sh.walk, p.dir, p.walk, p.x, p.y, 1, 1, blink ? tinted(sh.walk, "#ffffff", "solid") : undefined, !p.moving);
  else ctx.drawImage(blink ? tinted(sh.idle, "#ffffff", "solid") : sh.idle.img, p.dir * 16, 0, 16, 16, Math.round(p.x - 8), Math.round(p.y - 10), 16, 16);
}

/** A burrower underground: the ridge of earth it pushes up, heaving as it digs, so it can be seen coming. */
function mound(ctx: CanvasRenderingContext2D, x: number, y: number, t: number) {
  const h = 1 + Math.sin(t * 14) * 0.25;
  ctx.fillStyle = "#3e3024";
  ctx.beginPath(); ctx.ellipse(x, y, 7.5, 3.2 * h, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#6e5640";
  ctx.beginPath(); ctx.ellipse(x, y - 1, 5.5, 2.2 * h, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#94785a";
  ctx.beginPath(); ctx.ellipse(x - 1, y - 1.8, 2.6, 1, 0, 0, Math.PI * 2); ctx.fill();
}

function foe(ctx: CanvasRenderingContext2D, e: Enemy, time: number) {
  const d = ENEMIES[e.kind], sp = WALKERS[d.sprite];
  const scale = e.elite ? (e.elite.traits.includes("hulking") ? 2.6 : 1.8) : e.kind === "slimelet" ? 0.75 : 1;
  let x = e.x;
  const y = e.y - (e.flies ? 4 + Math.sin(time * 5 + e.id) * 1.5 : 0);
  if (e.wind > 0) x += Math.sin(time * 80) * 1.2; // the shiver before a lunge
  const alpha = e.hidden ? 0 : e.fade > 0 ? Math.min(1, Math.abs(e.fade - 0.2) * 5) : e.path ? 0.92 : 1;
  if (e.elite) {
    ctx.strokeStyle = ELITE_TRAITS[e.elite.traits[0]].tint;
    ctx.globalAlpha = 0.5 + 0.3 * Math.sin(time * 6 + e.id);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(e.x, e.y + e.r * 0.7, e.r * 1.3, e.r * 0.55, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
  }
  let src: CanvasImageSource | undefined;
  if (e.flash > 0) src = tinted(sp, "#ffffff", "solid");
  else if (e.st.freeze > 0) src = tinted(sp, "#9fd8ff", "wash");
  else if (e.st.root > 0) src = tinted(sp, "#7ee08a", "wash");
  else if (e.st.burn > 0) src = tinted(sp, "#ff8a4a", "wash");
  else if (e.st.slow > 0) src = tinted(sp, "#6ec3ff", "wash");
  else if (e.elite) src = tinted(sp, ELITE_TRAITS[e.elite.traits[0]].tint, "wash");
  const still = e.st.freeze > 0 || e.st.stun > 0 || e.st.root > 0 || e.wind > 0;
  walker(ctx, sp, e.dir, e.walk, x, y, scale, alpha, src, still);
  if (e.st.stun > 0)
    for (let i = 0; i < 3; i++) {
      const a = time * 5 + (i * Math.PI * 2) / 3;
      ctx.fillStyle = "#ffd166";
      ctx.fillRect(Math.round(x + Math.cos(a) * 5), Math.round(y - 10 * scale + Math.sin(a) * 2), 1, 1);
    }
  if (e.elite?.shield) frame(ctx, FX.shield, 0, x, y - 2, false, (e.r * 2.2) / 24, 0.6);
  if (e.elite && e.hp < e.max) bar(ctx, e.x, e.y + e.r + 2, e.r * 2, e.hp / e.max, ELITE_TRAITS[e.elite.traits[0]].tint);
}

function boss(ctx: CanvasRenderingContext2D, e: Enemy, s: State, time: number) {
  if (e.hidden) return;
  const b = BOSS[e.boss!], mode = e.ai?.mode ?? "walk";
  let sp = b.walk ?? b.idle, rate = 10;
  if (e.flash > 0 && b.hit) sp = b.hit;
  else if (mode === "hop" && b.attack) sp = b.attack;
  else if ((mode === "roll" || mode === "aim") && b.charge) sp = b.charge;
  else if ((mode === "gust" || mode === "slam" || mode === "throw" || mode === "vanish") && b.attack) sp = b.attack;
  else if (mode === "crouch" || mode === "draw" || mode === "sweep" || mode === "stone") { sp = b.idle; rate = 4; }
  const flip = s.p.x < e.x;
  let y = e.y - (sp.fh * b.zoom) / 2 + e.r;
  if (mode === "hop") y -= Math.sin(Math.min(1, e.ai!.t / 0.7) * Math.PI) * 26;
  let src: CanvasImageSource | undefined;
  if (mode === "stone") src = tinted(sp, "#8a8a92", "wash");
  else if (e.ai?.enraged) src = tinted(sp, "#ff3a3a", "wash");
  if (e.flash > 0 && !b.hit) src = tinted(sp, "#ffffff", "solid");
  if (e.boss === "samurai" && mode === "dash")
    for (let i = 1; i <= 3; i++) frame(ctx, sp, Math.floor(time * rate), e.x - (e.ai!.tx - e.x) * 0.02 * i, y, flip, b.zoom, 0.25 / i, 0, tinted(sp, "#ff5a5a", "solid"));
  frame(ctx, sp, Math.floor(time * rate), e.x, y, flip, b.zoom, e.fade > 0 ? 0.5 : 1, 0, src);
  if (e.boss === "yurei") frame(ctx, FX.aura, Math.floor(time * 8), e.x, e.y - 12, false, 1.6, 0.35);
}

function deco(ctx: CanvasRenderingContext2D, d: Deco, x: number, y: number, p?: { x: number; y: number }, flash = false) {
  if (!ready(d.src)) return;
  let a = 1;
  // Walk behind something tall and it fades, so you're never lost behind a tree.
  if (p && d.tall && p.y < y && p.y > y - d.h && Math.abs(p.x - x) < d.w / 2) a = 0.45;
  ctx.globalAlpha = a;
  const src = flash ? tinted(d.src, "#ffffff", "solid") : d.src.img;
  ctx.drawImage(src, d.sx, d.sy, d.w, d.h, Math.round(x - d.w / 2), Math.round(y - d.h), d.w, d.h);
  ctx.globalAlpha = 1;
}

function ground(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, time: number) {
  if (!ready(FLOOR) || !ready(DETAIL)) return;
  for (let ty = Math.floor(y0 / 16) - 1; ty <= Math.ceil(y1 / 16); ty++)
    for (let tx = Math.floor(x0 / 16) - 1; tx <= Math.ceil(x1 / 16); tx++) {
      const r = noise(tx, ty);
      const col = r < 0.86 ? 11 : 12 + Math.floor((r - 0.86) * 28);
      ctx.drawImage(FLOOR.img, col * 16, 12 * 16, 16, 16, tx * 16, ty * 16, 16.02, 16.02);
      const d = noise(tx + 911, ty - 377);
      if (d < 0.05) ctx.drawImage(DETAIL.img, (Math.floor(d * 160) % 8) * 16, 2 * 16, 16, 16, tx * 16, ty * 16, 16, 16);
      else if (d < 0.058 && ready(FLOWER)) ctx.drawImage(FLOWER.img, (Math.floor(time * 3 + tx) % 4) * 16, 0, 16, 16, tx * 16, ty * 16, 16, 16);
    }
}

/** A telegraph: a ring or line that fills as its moment comes. */
function hazard(ctx: CanvasRenderingContext2D, h: State["hazards"][number], time: number) {
  if (h.done) return;
  const k = Math.min(1, h.t / h.delay), pulse = 0.5 + 0.5 * Math.sin(time * 18);
  if (h.kind === "dust") {
    ctx.fillStyle = `rgba(120, 96, 70, ${0.4 + 0.3 * pulse})`;
    ctx.beginPath(); ctx.ellipse(h.x, h.y + 3, 6 + k * 3, 3, 0, 0, Math.PI * 2); ctx.fill();
    return;
  }
  const col = h.kind === "gust" ? "220, 235, 255" : "255, 60, 60";
  ctx.lineWidth = 1;
  if (h.kind === "line") {
    const a = Math.atan2(h.y2 - h.y, h.x2 - h.x), len = Math.hypot(h.x2 - h.x, h.y2 - h.y), K = WX.k;
    ctx.setTransform(Math.cos(a) * K, Math.sin(a) * K, -Math.sin(a) * K, Math.cos(a) * K, WX.x + h.x * K, WX.y + h.y * K);
    ctx.fillStyle = `rgba(${col}, ${0.12 + 0.1 * pulse})`;
    ctx.fillRect(0, -h.r, len, h.r * 2);
    ctx.fillStyle = `rgba(${col}, 0.35)`;
    ctx.fillRect(0, -h.r, len * k, h.r * 2);
    ctx.strokeStyle = `rgba(${col}, 0.8)`;
    ctx.strokeRect(0, -h.r, len, h.r * 2);
    ctx.setTransform(K, 0, 0, K, WX.x, WX.y);
    return;
  }
  ctx.fillStyle = `rgba(${col}, ${0.1 + 0.08 * pulse})`;
  ctx.beginPath(); ctx.ellipse(h.x, h.y, h.r, h.r * 0.6, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = `rgba(${col}, 0.3)`;
  ctx.beginPath(); ctx.ellipse(h.x, h.y, h.r * k, h.r * 0.6 * k, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = `rgba(${col}, ${0.6 + 0.4 * pulse})`;
  ctx.beginPath(); ctx.ellipse(h.x, h.y, h.r, h.r * 0.6, 0, 0, Math.PI * 2); ctx.stroke();
}

function zone(ctx: CanvasRenderingContext2D, z: State["zones"][number], time: number) {
  switch (z.kind) {
    case "burn": frame(ctx, FX.flame, time * 12 + z.x, z.x, z.y - 6, false, (z.r * 2) / 25, Math.min(1, z.life * 2) * 0.9); break;
    case "caltrop": frame(ctx, ZONE.caltrop, 0, z.x, z.y, false, 0.8, Math.min(1, z.life * 2)); break;
    case "bomb": frame(ctx, ZONE.bomb, 0, z.x, z.y - 2 + Math.sin(time * 6) * 0.5); break;
    case "cracker":
    case "dynamite":
      frame(ctx, ZONE.cracker, 0, z.x, z.y, false, z.kind === "dynamite" ? 1.4 : 0.8, 1, Math.sin(time * 30) * 0.2);
      if (Math.floor(time * 20) % 2) { ctx.fillStyle = "#ffd166"; ctx.fillRect(Math.round(z.x + 3), Math.round(z.y - 5), 1, 1); }
      break;
    case "whirl":
      for (let i = 0; i < 3; i++) frame(ctx, FX["smoke-circle"], time * 8 + i, z.x, z.y, i % 2 === 1, (z.r * 2) / 60, 0.5, time * 3 + i);
      frame(ctx, FX.water, time * 10, z.x, z.y - 6, false, (z.r * 1.6) / 44, 0.7);
      break;
    case "tornado":
      for (let i = 0; i < 4; i++) frame(ctx, SHOTS.gust, time * 10 + i, z.x, z.y - i * 5, i % 2 === 0, 0.5 + i * 0.12, 0.7, time * 6 * (i % 2 ? -1 : 1));
      break;
    case "smoke": frame(ctx, FX.smoke, (z.age / 0.9) * 6, z.x, z.y, false, 1, 0.8); break;
  }
}

/**
 * Enemy shots, drawn above the dark so the night never hides them, each on a
 * red halo with a rim: red on the ground or in the air always means it can hurt you.
 */
function foeShots(ctx: CanvasRenderingContext2D, s: State, time: number) {
  if (!s.foeShots.length) return;
  const pulse = 0.75 + 0.25 * Math.sin(time * 14);
  ctx.beginPath();
  for (const f of s.foeShots) { const r = f.r + 3; ctx.moveTo(f.x + r, f.y); ctx.arc(f.x, f.y, r, 0, Math.PI * 2); }
  ctx.fillStyle = `rgba(255, 40, 60, ${0.28 * pulse})`;
  ctx.fill();
  ctx.lineWidth = 0.8;
  ctx.strokeStyle = `rgba(255, 110, 110, ${0.9 * pulse})`;
  ctx.stroke();
  for (const f of s.foeShots) {
    const sp = FOE[f.kind];
    const spin = f.kind === "club" ? f.spin * 14 : f.kind === "feather" || f.kind === "bolt" ? Math.atan2(f.vy, f.vx) + (f.kind === "feather" ? Math.PI * 0.75 : 0) : 0;
    frame(ctx, sp, Math.floor(f.spin * 10), f.x, f.y, false, f.kind === "club" ? 2 : f.kind === "wisp" ? 0.6 : 0.9, 1, spin);
  }
}

function shot(ctx: CanvasRenderingContext2D, kind: ShotSprite, x: number, y: number, vx: number, vy: number, spin: number, r: number, age: number) {
  const sp = SHOTS[kind], a = Math.atan2(vy, vx);
  switch (kind) {
    case "shuriken": case "shuriken-magic": frame(ctx, sp, spin * 16, x, y, false, 1, 1, spin * 12); break;
    case "fireball": frame(ctx, sp, spin * 12, x, y, false, 1, 1, a + Math.PI / 2); break;
    case "gust": case "wave": frame(ctx, sp, Math.min(5, age * 8), x, y, false, (r * 2) / 34, Math.max(0.3, 1 - age), a - Math.PI / 2); break;
    case "ice": frame(ctx, sp, spin * 12, x, y, false, 0.9, 1, a); break;
    default: frame(ctx, sp, 0, x, y, false, 1, 1, a);
  }
}

function effect(ctx: CanvasRenderingContext2D, f: Fx) {
  const sp = FX[f.kind], k = f.t / f.dur, n = sp.n;
  const fi = Math.min(n - 1, Math.floor(k * n));
  switch (f.kind) {
    case "thunder": frame(ctx, sp, fi, f.x, f.y - 10, f.flip, 1.2); break;
    case "rock-spike": frame(ctx, sp, fi, f.x, f.y - 14 * f.scale, f.flip, f.scale); break;
    case "pillar": frame(ctx, sp, fi, f.x, f.y - 14 * f.scale, false, f.scale); break;
    case "circle": frame(ctx, sp, fi, f.x, f.y, false, f.scale, 1 - k * 0.6); break;
    case "thrust": {
      // The naginata's blade darting out and back along its line.
      const out = Math.sin(k * Math.PI) * (f.len ?? 60);
      frame(ctx, sp, 0, f.x + Math.cos(f.angle) * out * 0.5, f.y + Math.sin(f.angle) * out * 0.5, false, 1.3, 1, f.angle + Math.PI / 2);
      ctx.strokeStyle = `rgba(230, 240, 255, ${0.6 * (1 - k)})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(f.x + Math.cos(f.angle) * out, f.y + Math.sin(f.angle) * out); ctx.stroke();
      break;
    }
    default: frame(ctx, sp, fi, f.x, f.y, f.flip, f.scale, 1, f.angle);
  }
}

function pickup(ctx: CanvasRenderingContext2D, kind: string, tier: number | undefined, x: number, y: number, time: number) {
  const bob = Math.sin(time * 4 + x) * 1;
  if (kind === "chest") {
    const big = (tier ?? 1) > 1, sp = big ? PICK.big : PICK.small;
    const glow = tier === 5 ? "255, 209, 102" : tier === 3 ? "200, 220, 255" : "255, 240, 200";
    ctx.fillStyle = `rgba(${glow}, ${0.25 + 0.15 * Math.sin(time * 5)})`;
    ctx.beginPath(); ctx.ellipse(x, y + 5, 12, 5, 0, 0, Math.PI * 2); ctx.fill();
    frame(ctx, sp, 0, x, y - 2 + bob, false, big ? 1.3 : 1);
    return;
  }
  const sp = PICK[kind as keyof typeof PICK];
  if (!sp) return;
  if (kind !== "coin" && kind !== "onigiri" && kind !== "pouch" && kind !== "bag") {
    ctx.fillStyle = `rgba(255, 240, 180, ${0.2 + 0.15 * Math.sin(time * 6)})`;
    ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.fill();
  }
  frame(ctx, sp, kind === "coin" ? time * 8 : 0, x, y + bob, false, kind === "coin" ? 0.9 : 0.8);
}

/** An experience gem: a small diamond, green, then blue, then red as it holds more. */
function gem(ctx: CanvasRenderingContext2D, x: number, y: number, v: number, t: number) {
  const [hi, lo] = v >= 10 ? ["#ff9a9a", "#c8323c"] : v >= 3 ? ["#b0e0ff", "#2f7fd6"] : ["#c6f7a0", "#3aa24a"];
  const X = Math.round(x), Y = Math.round(y + Math.sin(t * 3 + x) * 0.6), big = v >= 10 ? 1 : 0;
  ctx.fillStyle = lo;
  ctx.fillRect(X - 1 - big, Y - 2 - big, 3 + 2 * big, 5 + 2 * big);
  ctx.fillRect(X - 2 - big, Y - 1, 5 + 2 * big, 3);
  ctx.fillStyle = hi;
  ctx.fillRect(X - 1, Y - 1 - big, 1 + big, 2);
  if (Math.floor(t * 2 + x) % 7 === 0) { ctx.fillStyle = "#ffffff"; ctx.fillRect(X, Y - 2 - big, 1, 1); }
}

function bar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, frac: number, color: string) {
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(Math.round(x - w / 2) - 0.5, Math.round(y), w + 1, 2.5);
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x - w / 2), Math.round(y) + 0.5, w * Math.max(0, Math.min(1, frac)), 1.5);
}

function particles(ctx: CanvasRenderingContext2D, dt: number) {
  for (let i = parts.length - 1; i >= 0; i--) {
    const q = parts[i];
    q.t += dt;
    if (q.t >= q.life) {
      if (q.kind === "firefly") flies--;
      parts[i] = parts[parts.length - 1];
      parts.pop();
      continue;
    }
    q.vy += q.g * dt;
    q.x += q.vx * dt;
    q.y += q.vy * dt;
    const a = 1 - q.t / q.life;
    if (q.kind === "leaf" || q.kind === "petal") {
      q.vx += Math.sin(q.t * 2 + q.y) * 6 * dt;
      frame(ctx, q.kind === "petal" ? PETAL : LEAF, q.t * 6, q.x, q.y, false, 0.7, Math.min(1, a * 3) * 0.85, Math.sin(q.t * 3) * 0.6);
      continue;
    }
    if (q.kind === "firefly") {
      q.vx += (Math.random() - 0.5) * 30 * dt;
      q.vy += (Math.random() - 0.5) * 30 * dt;
      const glow = (0.5 + 0.5 * Math.sin(q.t * 4 + q.x)) * Math.min(1, a * 4, q.t * 2);
      ctx.fillStyle = `rgba(232, 255, 154, ${glow})`;
      ctx.fillRect(Math.round(q.x), Math.round(q.y), 1, 1);
      continue;
    }
    ctx.globalAlpha = a;
    ctx.fillStyle = q.color;
    if (q.kind === "plus") { ctx.fillRect(Math.round(q.x) - 1, Math.round(q.y), 3, 1); ctx.fillRect(Math.round(q.x), Math.round(q.y) - 1, 1, 3); }
    else ctx.fillRect(Math.round(q.x), Math.round(q.y), q.size, q.size);
    ctx.globalAlpha = 1;
  }
}

let fontReady = false;
/** The pack's pixel font, for the numbers on the field and the clock. */
export function useFont() {
  const f = new FontFace("NP", `url(${A}font/normal.ttf)`);
  f.load().then((ff) => { (document.fonts as unknown as { add(f: FontFace): void }).add(ff); fontReady = true; }).catch(() => {});
}

function numbers(ctx: CanvasRenderingContext2D, s: State) {
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  let font = 0;
  for (const n of s.nums) {
    const k = n.t / 0.7, size = n.crit ? 8 : n.heal ? 7 : 6;
    if (size !== font) { font = size; ctx.font = `${size}px ${fontReady ? "NP" : "monospace"}`; }
    const y = n.y - k * 10 - (n.crit ? Math.sin(Math.min(1, k * 4) * Math.PI) * 3 : 0);
    const text = n.v === 0 ? "✕" : n.heal ? `+${Math.round(n.v)}` : String(Math.round(n.v));
    ctx.globalAlpha = Math.min(1, (1 - k) * 2.5);
    ctx.fillStyle = "#000";
    ctx.fillText(text, Math.round(n.x) + 0.5, Math.round(y) + 0.5);
    ctx.fillStyle = n.heal ? "#7ee08a" : n.crit ? "#ffd166" : "#ffffff";
    ctx.fillText(text, Math.round(n.x), Math.round(y));
  }
  ctx.globalAlpha = 1;
}

/** A soft round light, drawn once and stamped wherever there's light. */
const LIGHT = (() => {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const x = c.getContext("2d")!, g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(0,0,0,1)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
  return c;
})();

/** Night over everything: a pool of lantern light around you, lights from lanterns and fire, tints for blood moon and the hourglass, gold at dawn. */
function night(v: View, s: State, cx: number, cy: number, halfW: number, halfH: number, time: number) {
  const { ctx, w, h, dpr, zoom, dark } = v;
  const won = s.phase === "won";
  const f = won ? 1 : Math.min(0.72, s.t / 1250);
  const a = 0.74 * (1 - f);
  const W = Math.round(w * dpr), H = Math.round(h * dpr);
  if (dark.width !== W || dark.height !== H) { dark.width = W; dark.height = H; }
  const d = dark.getContext("2d")!;
  d.globalCompositeOperation = "source-over";
  d.clearRect(0, 0, W, H);
  if (a > 0.01) {
    d.fillStyle = s.moon > 0 ? `rgba(40, 6, 12, ${a + 0.08})` : `rgba(10, 12, 38, ${a})`;
    d.fillRect(0, 0, W, H);
    d.globalCompositeOperation = "destination-out";
    const K = zoom * dpr, sx = (x: number) => (x - cx + halfW) * K, sy = (y: number) => (y - cy + halfH) * K;
    const light = (x: number, y: number, r: number, str: number) => {
      const X = sx(x), Y = sy(y), R = r * K;
      if (X < -R || Y < -R || X > W + R || Y > H + R) return;
      d.globalAlpha = str;
      d.drawImage(LIGHT, X - R, Y - R, R * 2, R * 2);
    };
    light(s.p.x, s.p.y, 112 + Math.sin(time * 3) * 2, 0.9);
    for (const e of s.enemies) {
      if (e.prop === "lantern") light(e.x, e.y - 18, 46 + Math.sin(time * 4 + e.id) * 3, 0.8);
      else if (e.kind === "lantern" || e.kind === "onibi") light(e.x, e.y, 26, 0.55);
    }
    for (const z of s.zones) if (z.kind === "burn") light(z.x, z.y, 30, 0.6);
    for (const x of s.fx) if (x.kind === "explosion" || x.kind === "thunder") light(x.x, x.y, 55, 0.8 * (1 - x.t / x.dur));
    for (const sh of s.shots) if (sh.sprite === "fireball") light(sh.x, sh.y, 20, 0.6);
    d.globalAlpha = 1;
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (a > 0.01) ctx.drawImage(dark, 0, 0);
  // Tints over the whole scene.
  if (s.frozen > 0) { ctx.fillStyle = "rgba(160, 200, 255, 0.18)"; ctx.fillRect(0, 0, W, H); }
  if (s.moon > 0) { ctx.fillStyle = `rgba(200, 20, 30, ${0.12 + 0.04 * Math.sin(time * 2)})`; ctx.fillRect(0, 0, W, H); }
  if (won) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "rgba(255, 190, 120, 0.35)");
    g.addColorStop(1, "rgba(255, 230, 190, 0.08)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  // A slow ground fog drifting over the road.
  if (ready(FOG) && !won) {
    ctx.globalAlpha = 0.05;
    ctx.imageSmoothingEnabled = true;
    const K = zoom * dpr, fw = 320 * K, fh = 180 * K, ox = ((((time * 6 - cx) * K) % fw) + fw) % fw, oy = (((-cy * K) % fh) + fh) % fh;
    for (let x = -fw + ox; x < W; x += fw) for (let y = -fh + oy; y < H; y += fh) ctx.drawImage(FOG.img, x, y, fw, fh);
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = false;
  }
}

/** Full-screen gradients, rendered once per size (a red edge, a blue glow) and drawn with an alpha. */
const vignettes = new Map<string, HTMLCanvasElement>();
function vignette(W: number, H: number, kind: "edge" | "glow") {
  const key = `${kind}${W}x${H}`;
  let c = vignettes.get(key);
  if (c) return c;
  c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const x = c.getContext("2d")!;
  const g = kind === "edge"
    ? x.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.7)
    : x.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.6);
  g.addColorStop(0, kind === "edge" ? "rgba(200, 20, 30, 0)" : "rgba(160, 220, 255, 1)");
  g.addColorStop(1, kind === "edge" ? "rgba(200, 20, 30, 1)" : "rgba(160, 220, 255, 0)");
  x.fillStyle = g;
  x.fillRect(0, 0, W, H);
  if (vignettes.size > 6) vignettes.clear();
  vignettes.set(key, c);
  return c;
}

/** The screen's own effects: the red edge when hurt, a pulse when low, a flash for big moments. */
function screen(v: View, s: State, time: number) {
  const { ctx, w, h, dpr } = v, W = w * dpr, H = h * dpr;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const low = s.p.hp / s.st.maxHp < 0.3 && s.phase === "play" ? 0.25 + 0.2 * Math.sin(time * 6) : 0;
  const red = Math.max(hurtFlash * 1.4, low);
  if (red > 0.01) {
    ctx.globalAlpha = Math.min(0.6, red);
    ctx.drawImage(vignette(W, H, "edge"), 0, 0);
  }
  if (levelFlash > 0) {
    ctx.globalAlpha = levelFlash * 0.35;
    ctx.drawImage(vignette(W, H, "glow"), 0, 0);
  }
  ctx.globalAlpha = 1;
  if (whiteFlash > 0) { ctx.fillStyle = `rgba(255, 255, 255, ${whiteFlash})`; ctx.fillRect(0, 0, W, H); }
}

// ---- pictures for the DOM ------------------------------------------------------------------------------------------------------

export const iconUrl = (name: string) => `${A}icons/${name}.png`;
export const faceUrl = (name: string) => `${A}faces/${name}.png`;
export const bossName = (k: BossKind) => BOSSES[k].name;
