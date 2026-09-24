// The page's particles on one full-page canvas: a blast where a mine went
// off (a shock ring and sparks) and confetti for a cleared board. One
// animation frame loop runs while anything is alive and stops after.
type Bit = { x: number; y: number; vx: number; vy: number; g: number; life: number; age: number; size: number; spin: number; turn: number; color: string; kind: "spark" | "paper" };
type Ring = { x: number; y: number; age: number; life: number; r: number };

const canvas = document.getElementById("fx") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
let bits: Bit[] = [], rings: Ring[] = [], running = false, last = 0;

function fit() {
  const dpr = devicePixelRatio || 1;
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
addEventListener("resize", fit);
fit();

function frame(t: number) {
  const dt = Math.min(0.05, (t - last) / 1000 || 0.016);
  last = t;
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  rings = rings.filter((r) => (r.age += dt) < r.life);
  for (const r of rings) {
    if (r.age < 0) continue;
    const k = r.age / r.life;
    ctx.strokeStyle = `rgba(255, 150, 60, ${(1 - k) * 0.85})`;
    ctx.lineWidth = 3 * (1 - k) + 1;
    ctx.beginPath();
    ctx.arc(r.x, r.y, r.r * (0.2 + 0.8 * Math.sqrt(k)), 0, Math.PI * 2);
    ctx.stroke();
  }
  bits = bits.filter((b) => (b.age += dt) < b.life);
  for (const b of bits) {
    if (b.age < 0) continue;
    b.vy += b.g * dt;
    b.vx *= b.kind === "paper" ? 0.985 : 0.96;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.turn += b.spin * dt;
    ctx.globalAlpha = Math.min(1, 3 * (1 - b.age / b.life));
    ctx.fillStyle = b.color;
    if (b.kind === "spark") ctx.fillRect(b.x - b.size / 2, b.y - b.size / 2, b.size, b.size);
    else {
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.turn);
      ctx.fillRect(-b.size / 2, (-b.size / 4) * Math.abs(Math.cos(b.turn * 1.7)), b.size, (b.size / 2) * Math.abs(Math.cos(b.turn * 1.7)) + 0.5);
      ctx.restore();
    }
  }
  ctx.globalAlpha = 1;
  if (bits.length || rings.length) requestAnimationFrame(frame);
  else running = false;
}
function run() {
  if (running) return;
  running = true;
  last = performance.now();
  requestAnimationFrame(frame);
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** A mine going off at (x, y) in page px, `size` the cell. */
export function blast(x: number, y: number, size: number) {
  rings.push({ x, y, age: 0, life: 0.55, r: size * 4 }, { x, y, age: -0.08, life: 0.6, r: size * 2.4 });
  const hot = ["#FFE08A", "#FFB547", "#FF7A3D", "#F0443A", "#8A8FA0"];
  for (let i = 0; i < 34; i++) {
    const a = rand(0, Math.PI * 2), v = rand(80, 340);
    bits.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 420, life: rand(0.35, 0.8), age: 0, size: rand(1.5, 3.5), spin: 0, turn: 0, color: hot[i % hot.length], kind: "spark" });
  }
  run();
}

/** Confetti over the board's box, thrown up from its lower half. */
export function confetti(box: DOMRect, colors: string[]) {
  const n = Math.round(Math.min(140, 50 + box.width / 5));
  for (let i = 0; i < n; i++) {
    const x = rand(box.left, box.right), y = rand(box.top + box.height * 0.4, box.bottom);
    bits.push({ x, y, vx: rand(-90, 90), vy: rand(-520, -240), g: 520, life: rand(1.3, 2.1), age: -rand(0, 0.25), size: rand(5, 8), spin: rand(-9, 9), turn: rand(0, 6), color: colors[i % colors.length], kind: "paper" });
  }
  run();
}
