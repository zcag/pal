// A QR code encoder in plain TypeScript: byte mode, versions 1 to 40, the
// four error correction levels, the eight masks scored by the standard's
// penalty rules. The algorithm follows Nayuki's QR Code generator
// (https://www.nayuki.io/page/qr-code-generator-library, MIT), reduced to
// what a launcher needs: text in, a module matrix and an SVG out. Nothing
// is fetched and no dependency is pulled in for it.

type Ecl = "L" | "M" | "Q" | "H";
type QrCode = { version: number; ecl: Ecl; mask: number; size: number; modules: boolean[][] };

const ECL_ORDINAL: Record<Ecl, number> = { L: 0, M: 1, Q: 2, H: 3 };
const ECL_FORMAT: Record<Ecl, number> = { L: 1, M: 0, Q: 3, H: 2 };
const LEVELS: Ecl[] = ["L", "M", "Q", "H"];

// Index 0 is unused; versions 1..40. Per level: codewords per block, then blocks.
const ECC_CODEWORDS_PER_BLOCK = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];
const NUM_ERROR_CORRECTION_BLOCKS = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];
const PENALTY_N1 = 3, PENALTY_N2 = 3, PENALTY_N3 = 40, PENALTY_N4 = 10;

/** Data modules in a version's symbol, function patterns excluded. */
function rawDataModules(ver: number): number {
  let n = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const align = Math.floor(ver / 7) + 2;
    n -= (25 * align - 10) * align - 55;
    if (ver >= 7) n -= 36;
  }
  return n;
}

const dataCodewords = (ver: number, ecl: Ecl) => Math.floor(rawDataModules(ver) / 8) - ECC_CODEWORDS_PER_BLOCK[ECL_ORDINAL[ecl]][ver] * NUM_ERROR_CORRECTION_BLOCKS[ECL_ORDINAL[ecl]][ver];

/** Bytes a version holds at a level in byte mode (mode and count bits taken off). */
export function capacity(ver: number, ecl: Ecl): number {
  return Math.floor((dataCodewords(ver, ecl) * 8 - 4 - (ver < 10 ? 8 : 16)) / 8);
}

// ---- Reed-Solomon over GF(2^8) with 0x11D --------------------------------------

function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMul(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = gfMul(root, 2);
  }
  return result;
}

function rsRemainder(data: number[], divisor: number[]): number[] {
  const result = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ result.shift()!;
    result.push(0);
    divisor.forEach((coef, i) => { result[i] ^= gfMul(coef, factor); });
  }
  return result;
}

function addEccAndInterleave(data: number[], ver: number, ecl: Ecl): number[] {
  const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[ECL_ORDINAL[ecl]][ver];
  const blockEccLen = ECC_CODEWORDS_PER_BLOCK[ECL_ORDINAL[ecl]][ver];
  const rawCodewords = Math.floor(rawDataModules(ver) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);
  const blocks: number[][] = [];
  const divisor = rsDivisor(blockEccLen);
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1));
    k += dat.length;
    const ecc = rsRemainder(dat, divisor);
    if (i < numShortBlocks) dat.push(0);
    blocks.push(dat.concat(ecc));
  }
  const result: number[] = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((block, j) => {
      if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) result.push(block[i]);
    });
  }
  return result;
}

// ---- the symbol ----------------------------------------------------------------------

const getBit = (x: number, i: number) => ((x >>> i) & 1) !== 0;

function alignmentPositions(ver: number): number[] {
  if (ver === 1) return [];
  const numAlign = Math.floor(ver / 7) + 2;
  const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2;
  const result = [6];
  for (let pos = ver * 4 + 10; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
  return result;
}

class Matrix {
  readonly size: number;
  readonly modules: boolean[][];
  readonly isFunction: boolean[][];

  constructor(readonly version: number, readonly ecl: Ecl) {
    this.size = version * 4 + 17;
    this.modules = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
    this.isFunction = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
  }

  private set(x: number, y: number, dark: boolean) {
    this.modules[y][x] = dark;
    this.isFunction[y][x] = true;
  }

  drawFunctionPatterns() {
    for (let i = 0; i < this.size; i++) {
      this.set(6, i, i % 2 === 0);
      this.set(i, 6, i % 2 === 0);
    }
    this.drawFinder(3, 3);
    this.drawFinder(this.size - 4, 3);
    this.drawFinder(3, this.size - 4);
    const pos = alignmentPositions(this.version);
    for (let i = 0; i < pos.length; i++) {
      for (let j = 0; j < pos.length; j++) {
        if (!((i === 0 && j === 0) || (i === 0 && j === pos.length - 1) || (i === pos.length - 1 && j === 0))) this.drawAlignment(pos[i], pos[j]);
      }
    }
    this.drawFormatBits(0);
    this.drawVersion();
  }

  private drawFinder(x: number, y: number) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && xx < this.size && yy >= 0 && yy < this.size) this.set(xx, yy, dist !== 2 && dist !== 4);
      }
    }
  }

  private drawAlignment(x: number, y: number) {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) this.set(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }

  drawFormatBits(mask: number) {
    const data = (ECL_FORMAT[this.ecl] << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    for (let i = 0; i <= 5; i++) this.set(8, i, getBit(bits, i));
    this.set(8, 7, getBit(bits, 6));
    this.set(8, 8, getBit(bits, 7));
    this.set(7, 8, getBit(bits, 8));
    for (let i = 9; i < 15; i++) this.set(14 - i, 8, getBit(bits, i));
    for (let i = 0; i < 8; i++) this.set(this.size - 1 - i, 8, getBit(bits, i));
    for (let i = 8; i < 15; i++) this.set(8, this.size - 15 + i, getBit(bits, i));
    this.set(8, this.size - 8, true);
  }

  private drawVersion() {
    if (this.version < 7) return;
    let rem = this.version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (this.version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = getBit(bits, i);
      const a = this.size - 11 + (i % 3), b = Math.floor(i / 3);
      this.set(a, b, bit);
      this.set(b, a, bit);
    }
  }

  drawCodewords(data: number[]) {
    let i = 0;
    for (let right = this.size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < this.size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? this.size - 1 - vert : vert;
          if (!this.isFunction[y][x] && i < data.length * 8) {
            this.modules[y][x] = getBit(data[i >>> 3], 7 - (i & 7));
            i++;
          }
        }
      }
    }
  }

  applyMask(mask: number) {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        let invert: boolean;
        switch (mask) {
          case 0: invert = (x + y) % 2 === 0; break;
          case 1: invert = y % 2 === 0; break;
          case 2: invert = x % 3 === 0; break;
          case 3: invert = (x + y) % 3 === 0; break;
          case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break;
          case 6: invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
          default: invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
        }
        if (!this.isFunction[y][x] && invert) this.modules[y][x] = !this.modules[y][x];
      }
    }
  }

  penalty(): number {
    let result = 0;
    const m = this.modules, n = this.size;
    for (let y = 0; y < n; y++) {
      let runColor = false, runX = 0;
      const history = [0, 0, 0, 0, 0, 0, 0];
      for (let x = 0; x < n; x++) {
        if (m[y][x] === runColor) {
          runX++;
          if (runX === 5) result += PENALTY_N1;
          else if (runX > 5) result++;
        } else {
          this.addHistory(runX, history);
          if (!runColor) result += this.countPatterns(history) * PENALTY_N3;
          runColor = m[y][x];
          runX = 1;
        }
      }
      result += this.terminateAndCount(runColor, runX, history) * PENALTY_N3;
    }
    for (let x = 0; x < n; x++) {
      let runColor = false, runY = 0;
      const history = [0, 0, 0, 0, 0, 0, 0];
      for (let y = 0; y < n; y++) {
        if (m[y][x] === runColor) {
          runY++;
          if (runY === 5) result += PENALTY_N1;
          else if (runY > 5) result++;
        } else {
          this.addHistory(runY, history);
          if (!runColor) result += this.countPatterns(history) * PENALTY_N3;
          runColor = m[y][x];
          runY = 1;
        }
      }
      result += this.terminateAndCount(runColor, runY, history) * PENALTY_N3;
    }
    for (let y = 0; y < n - 1; y++) {
      for (let x = 0; x < n - 1; x++) {
        const c = m[y][x];
        if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) result += PENALTY_N2;
      }
    }
    let dark = 0;
    for (const row of m) for (const c of row) if (c) dark++;
    const total = n * n;
    const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
    return result + k * PENALTY_N4;
  }

  private countPatterns(h: number[]): number {
    const n = h[1];
    const core = n > 0 && h[2] === n && h[3] === n * 3 && h[4] === n && h[5] === n;
    return (core && h[0] >= n * 4 && h[6] >= n ? 1 : 0) + (core && h[6] >= n * 4 && h[0] >= n ? 1 : 0);
  }

  private terminateAndCount(color: boolean, run: number, h: number[]): number {
    if (color) {
      this.addHistory(run, h);
      run = 0;
    }
    run += this.size;
    this.addHistory(run, h);
    return this.countPatterns(h);
  }

  private addHistory(run: number, h: number[]) {
    if (h[0] === 0) run += this.size;
    h.pop();
    h.unshift(run);
  }
}

// ---- encoding ----------------------------------------------------------------------

export type Options = {
  /** Error correction level to start from; `M` by default. */
  ecl?: Ecl;
  /** Raise the level as far as the chosen version allows (the default); off pins `ecl`. */
  boost?: boolean;
  /** Force a mask (0..7) instead of scoring the eight. */
  mask?: number;
};

/** The smallest version whose byte-mode capacity holds `bytes` at `ecl`, or undefined past version 40. */
export function versionFor(bytes: number, ecl: Ecl): number | undefined {
  for (let v = 1; v <= 40; v++) if (capacity(v, ecl) >= bytes) return v;
}

/** The QR code of `text` (UTF-8, byte mode). Throws when it does not fit version 40 at the level asked. */
export function encode(text: string, opts: Options = {}): QrCode {
  const bytes = [...new TextEncoder().encode(text)];
  let ecl = opts.ecl ?? "M";
  const version = versionFor(bytes.length, ecl);
  if (version === undefined) throw new Error(`${bytes.length} bytes do not fit a QR code at level ${ecl}`);
  if (opts.boost ?? true) for (const level of LEVELS) if (ECL_ORDINAL[level] > ECL_ORDINAL[ecl] && capacity(version, level) >= bytes.length) ecl = level;

  // Bits: mode 0100, the count (8 or 16 bits), the bytes, a terminator, pad to a byte, then the pad bytes.
  const bits: number[] = [];
  const push = (val: number, len: number) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  push(4, 4);
  push(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  const capBits = dataCodewords(version, ecl) * 8;
  push(0, Math.min(4, capBits - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capBits; pad ^= 0xec ^ 0x11) push(pad, 8);
  const codewords: number[] = [];
  bits.forEach((b, i) => { codewords[i >>> 3] = (codewords[i >>> 3] ?? 0) | (b << (7 - (i & 7))); });

  const sym = new Matrix(version, ecl);
  sym.drawFunctionPatterns();
  sym.drawCodewords(addEccAndInterleave(codewords, version, ecl));
  let mask = opts.mask ?? -1;
  if (mask < 0) {
    let best = Infinity;
    for (let i = 0; i < 8; i++) {
      sym.applyMask(i);
      sym.drawFormatBits(i);
      const p = sym.penalty();
      if (p < best) { best = p; mask = i; }
      sym.applyMask(i);
    }
  }
  sym.applyMask(mask);
  sym.drawFormatBits(mask);
  return { version, ecl, mask, size: sym.size, modules: sym.modules };
}

/**
 * The code as an SVG: one path of the dark modules on white, `quiet`
 * modules of margin around it, `shape-rendering` crisp. `px` is the side
 * the picture asks for (its width and height attributes), so an <img> of
 * it, or a markdown picture in the detail pane, comes at that size rather
 * than the pane's width; the viewBox keeps it scalable.
 */
export function toSvg(qr: QrCode, quiet = 4, px = 224): string {
  const n = qr.size + quiet * 2;
  const d: string[] = [];
  qr.modules.forEach((row, y) => row.forEach((dark, x) => { if (dark) d.push(`M${x + quiet} ${y + quiet}h1v1h-1z`); }));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${px}" height="${px}" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="#fff"/><path d="${d.join("")}" fill="#000"/></svg>`;
}

/** The SVG as a `data:` url the panel can show as an icon, a view image or a markdown picture. */
export const toDataUrl = (svg: string) => `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
