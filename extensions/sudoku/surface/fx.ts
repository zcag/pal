// Confetti on one full-page canvas for a solved board (minesweeper's, the
// paper only). One animation frame loop runs while any piece is alive.
type Bit = { x: number; y: number; vx: number; vy: number; life: number; age: number; size: number; spin: number; turn: number; color: string };

const canvas = document.getElementById("fx") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
let bits: Bit[] = [], running = false, last = 0;

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
  bits = bits.filter((b) => (b.age += dt) < b.life);
  for (const b of bits) {
    if (b.age < 0) continue;
    b.vy += 520 * dt;
    b.vx *= 0.985;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.turn += b.spin * dt;
    ctx.globalAlpha = Math.min(1, 3 * (1 - b.age / b.life));
    ctx.fillStyle = b.color;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.turn);
    const h = Math.abs(Math.cos(b.turn * 1.7));
    ctx.fillRect(-b.size / 2, (-b.size / 4) * h, b.size, (b.size / 2) * h + 0.5);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  if (bits.length) requestAnimationFrame(frame);
  else running = false;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** Confetti over a box, thrown up from its lower half. */
export function confetti(box: DOMRect, colors: string[]) {
  const n = Math.round(Math.min(150, 60 + box.width / 4));
  for (let i = 0; i < n; i++) {
    const x = rand(box.left, box.right), y = rand(box.top + box.height * 0.4, box.bottom);
    bits.push({ x, y, vx: rand(-110, 110), vy: rand(-560, -260), life: rand(1.3, 2.2), age: -rand(0, 0.3), size: rand(5, 8.5), spin: rand(-9, 9), turn: rand(0, 6), color: colors[i % colors.length] });
  }
  if (running) return;
  running = true;
  last = performance.now();
  requestAnimationFrame(frame);
}
