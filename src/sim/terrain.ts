/**
 * Destructible bitmap terrain.
 *
 * Pixels are stored column-major (index = x * h + y) as packed RGBA in ImageData byte
 * order (0xAABBGGRR on little-endian). Alpha doubles as coverage: pixels with
 * alpha ≥ SOLID_ALPHA are solid ground; lower non-zero alpha is anti-aliased edge.
 * Column-major storage makes vertical scans and collapsing dirt (copyWithin) cheap.
 *
 * Unsupported ground falls: any operation that removes ground marks the affected
 * columns unstable, and settle(dt) animates floating material dropping until it rests.
 */
import { BEDROCK_ROWS, SOLID_ALPHA } from '../core/constants.ts';
import type { Vec2 } from '../core/math.ts';

/** Half-open pixel rectangle [x0, x1) × [y0, y1). */
export interface Rect { x0: number; y0: number; x1: number; y1: number }

/** Returns a packed RGBA colour (alpha 255) for a pixel position. */
export type PixelPainter = (x: number, y: number) => number;

const FALL_GRAVITY = 1600;
const FALL_MAX_SPEED = 950;

export class Terrain {
  readonly w: number;
  readonly h: number;
  /** Column-major packed RGBA pixels. Prefer the methods below for queries and edits. */
  readonly px: Uint32Array;
  /** First row of indestructible bedrock. */
  readonly bedrockTop: number;
  /** Incremented on every modification. */
  version = 0;

  private dirty: Rect | null = null;
  private readonly unstable: Uint8Array;
  private readonly fallVel: Float32Array;
  private readonly fallAcc: Float32Array;
  private unstableCount = 0;
  private unstableLo: number;
  private unstableHi = -1;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.px = new Uint32Array(w * h);
    this.bedrockTop = h - BEDROCK_ROWS;
    this.unstable = new Uint8Array(w);
    this.fallVel = new Float32Array(w);
    this.fallAcc = new Float32Array(w);
    this.unstableLo = w;
  }

  // --- Queries -------------------------------------------------------------------

  /** Solid ground at a world position. Outside left/right/top is air; below the world is solid. */
  isSolid(x: number, y: number): boolean {
    const xi = Math.floor(x), yi = Math.floor(y);
    if (xi < 0 || xi >= this.w || yi < 0) return false;
    if (yi >= this.h) return true;
    return this.px[xi * this.h + yi] >>> 24 >= SOLID_ALPHA;
  }

  /** Alpha (0..255) of the pixel containing (x, y); 0 outside the bitmap. */
  alphaAt(x: number, y: number): number {
    const xi = Math.floor(x), yi = Math.floor(y);
    if (xi < 0 || xi >= this.w || yi < 0 || yi >= this.h) return 0;
    return this.px[xi * this.h + yi] >>> 24;
  }

  /** Packed colour of the pixel containing (x, y); 0 outside the bitmap. */
  colorAt(x: number, y: number): number {
    const xi = Math.floor(x), yi = Math.floor(y);
    if (xi < 0 || xi >= this.w || yi < 0 || yi >= this.h) return 0;
    return this.px[xi * this.h + yi];
  }

  /** First solid row at or below fromY in column x; returns h when there is none. */
  surfaceY(x: number, fromY = 0): number {
    const xi = Math.floor(x);
    if (xi < 0 || xi >= this.w) return this.h;
    const h = this.h, px = this.px, base = xi * h;
    for (let y = Math.max(0, Math.floor(fromY)); y < h; y++) {
      if (px[base + y] >>> 24 >= SOLID_ALPHA) return y;
    }
    return h;
  }

  /** Top-most solid row of column x (h when the column is empty). */
  heightAt(x: number): number {
    return this.surfaceY(x, 0);
  }

  isBedrock(y: number): boolean {
    return y >= this.bedrockTop;
  }

  /**
   * Outward surface normal near (x, y), estimated from the solid mass in a disc of radius r.
   * Returns (0, -1) on featureless areas.
   */
  normalAt(x: number, y: number, r = 6): Vec2 {
    let nx = 0, ny = 0;
    const r2 = r * r;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r2) continue;
        if (this.isSolid(x + dx, y + dy)) { nx -= dx; ny -= dy; }
      }
    }
    const len = Math.hypot(nx, ny);
    return len < 1e-6 ? { x: 0, y: -1 } : { x: nx / len, y: ny / len };
  }

  /** First solid point along the segment (sampled at ≤ 1 px), excluding the start point; null if clear. */
  raycast(x0: number, y0: number, x1: number, y1: number): Vec2 | null {
    const dx = x1 - x0, dy = y1 - y0;
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const x = x0 + dx * t, y = y0 + dy * t;
      if (this.isSolid(x, y)) return { x, y };
    }
    return null;
  }

  /** Number of solid pixels inside a circle (used for burial checks and AI heuristics). */
  solidCountInCircle(cx: number, cy: number, r: number): number {
    let count = 0;
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(this.w - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(this.h - 1, Math.ceil(cy + r));
    const r2 = r * r;
    for (let x = x0; x <= x1; x++) {
      const base = x * this.h, ddx = x + 0.5 - cx;
      for (let y = y0; y <= y1; y++) {
        const ddy = y + 0.5 - cy;
        if (ddx * ddx + ddy * ddy <= r2 && this.px[base + y] >>> 24 >= SOLID_ALPHA) count++;
      }
    }
    return count;
  }

  // --- Edits ---------------------------------------------------------------------

  /**
   * Removes ground inside a circle with an anti-aliased edge. Bedrock is never removed.
   * scorch (0..1) darkens the surviving ground in a ring around the crater.
   * Returns the number of solid pixels removed.
   */
  carveCircle(cx: number, cy: number, r: number, scorch = 0): number {
    if (r <= 0) return 0;
    const sw = scorch > 0 ? 6 + r * 0.32 : 0;
    const reach = r + sw + 1;
    const x0 = Math.max(0, Math.floor(cx - reach)), x1 = Math.min(this.w - 1, Math.ceil(cx + reach));
    const y0 = Math.max(0, Math.floor(cy - reach)), y1 = Math.min(this.h - 1, Math.ceil(cy + reach));
    if (x0 > x1 || y0 > y1) return 0;
    const h = this.h, px = this.px, bedrock = this.bedrockTop;
    let removed = 0;
    for (let x = x0; x <= x1; x++) {
      const base = x * h, ddx = x + 0.5 - cx;
      for (let y = y0; y <= y1; y++) {
        const c = px[base + y];
        if (c === 0) continue;
        const ddy = y + 0.5 - cy;
        const d = Math.sqrt(ddx * ddx + ddy * ddy);
        if (d > reach) continue;
        let a = c >>> 24;
        let color = c;
        const cover = r - d + 0.5; // removal coverage: ≥1 inside, ≤0 outside
        if (cover > 0 && y < bedrock) {
          const wasSolid = a >= SOLID_ALPHA;
          if (cover >= 1) {
            px[base + y] = 0;
            if (wasSolid) removed++;
            continue;
          }
          a = Math.round(a * (1 - cover));
          if (a < 6) {
            px[base + y] = 0;
            if (wasSolid) removed++;
            continue;
          }
          if (wasSolid && a < SOLID_ALPHA) removed++;
          color = ((a << 24) | (color & 0x00ffffff)) >>> 0;
        }
        if (sw > 0 && d < r + sw) {
          const k = Math.max(0, Math.min(1, 1 - (d - r) / sw));
          const f = 1 - scorch * 0.62 * Math.pow(k, 1.35);
          const rr = (color & 255) * f, gg = ((color >>> 8) & 255) * f, bb = ((color >>> 16) & 255) * (f * 0.96);
          color = (((color >>> 24) << 24) | ((bb & 255) << 16) | ((gg & 255) << 8) | (rr & 255)) >>> 0;
        }
        px[base + y] = color;
      }
    }
    this.touch(x0, y0, x1 + 1, y1 + 1, true);
    return removed;
  }

  /** Removes ground inside an axis-aligned rectangle (hard edges). Returns solid pixels removed. */
  carveRect(rx0: number, ry0: number, rx1: number, ry1: number): number {
    const x0 = Math.max(0, Math.floor(Math.min(rx0, rx1))), x1 = Math.min(this.w, Math.ceil(Math.max(rx0, rx1)));
    const y0 = Math.max(0, Math.floor(Math.min(ry0, ry1))), y1 = Math.min(this.bedrockTop, Math.ceil(Math.max(ry0, ry1)));
    if (x0 >= x1 || y0 >= y1) return 0;
    let removed = 0;
    const h = this.h, px = this.px;
    for (let x = x0; x < x1; x++) {
      const base = x * h;
      for (let y = y0; y < y1; y++) {
        const c = px[base + y];
        if (c !== 0) {
          if (c >>> 24 >= SOLID_ALPHA) removed++;
          px[base + y] = 0;
        }
      }
    }
    this.touch(x0, y0, x1, y1, true);
    return removed;
  }

  /** Removes ground along a segment with round caps (tunnels). Returns solid pixels removed. */
  carveCapsule(ax: number, ay: number, bx: number, by: number, r: number): number {
    const len = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.ceil(len / Math.max(1, r * 0.5)));
    let removed = 0;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      removed += this.carveCircle(ax + (bx - ax) * t, ay + (by - ay) * t, r);
    }
    return removed;
  }

  /**
   * Fills air inside a circle with painted ground (anti-aliased edge). Existing ground is kept.
   * Pixels inside any `protect` rectangle (e.g. tank hulls) are never filled.
   * Returns the number of pixels that became solid.
   */
  fillCircle(cx: number, cy: number, r: number, paint: PixelPainter, protect: readonly Rect[] = []): number {
    if (r <= 0) return 0;
    const x0 = Math.max(0, Math.floor(cx - r - 1)), x1 = Math.min(this.w - 1, Math.ceil(cx + r + 1));
    const y0 = Math.max(0, Math.floor(cy - r - 1)), y1 = Math.min(this.h - 1, Math.ceil(cy + r + 1));
    if (x0 > x1 || y0 > y1) return 0;
    const h = this.h, px = this.px;
    let added = 0;
    for (let x = x0; x <= x1; x++) {
      const base = x * h, ddx = x + 0.5 - cx;
      for (let y = y0; y <= y1; y++) {
        const old = px[base + y];
        const oldA = old >>> 24;
        if (oldA >= 250) continue;
        const ddy = y + 0.5 - cy;
        const cover = r - Math.sqrt(ddx * ddx + ddy * ddy) + 0.5;
        if (cover <= 0) continue;
        if (protect.length && inRects(protect, x, y)) continue;
        const a = cover >= 1 ? 255 : Math.max(oldA, Math.round(cover * 255));
        if (a <= oldA) continue;
        if (oldA < SOLID_ALPHA && a >= SOLID_ALPHA) added++;
        px[base + y] = ((a << 24) | (paint(x, y) & 0x00ffffff)) >>> 0;
      }
    }
    this.touch(x0, y0, x1 + 1, y1 + 1, true);
    return added;
  }

  /**
   * Piles painted ground on top of the existing surface in a dome profile with an anti-aliased top:
   * each column within r of cx gains up to `height` rows. Pixels inside `protect` rectangles (tank
   * hulls) stay clear. The result rests on the surface, so nothing collapses. Returns pixels added.
   */
  raiseMound(cx: number, r: number, height: number, paint: PixelPainter, protect: readonly Rect[] = []): number {
    if (r <= 0 || height <= 0) return 0;
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(this.w - 1, Math.ceil(cx + r));
    const h = this.h, px = this.px;
    let added = 0, minY = h, maxY = 0;
    for (let x = x0; x <= x1; x++) {
      const u = (x + 0.5 - cx) / r;
      if (u <= -1 || u >= 1) continue;
      const lift = height * Math.pow(1 - u * u, 0.7);
      const s = this.surfaceY(x);
      const top = Math.max(0, s - lift);
      const yTop = Math.floor(top);
      const base = x * h;
      for (let y = yTop; y < s; y++) {
        if (protect.length && inRects(protect, x, y)) continue;
        const oldA = px[base + y] >>> 24;
        const a = y === yTop ? Math.round(255 * Math.max(0, Math.min(1, 1 - (top - yTop)))) : 255;
        if (a <= oldA) continue;
        if (oldA < SOLID_ALPHA && a >= SOLID_ALPHA) added++;
        px[base + y] = ((a << 24) | (paint(x, y) & 0x00ffffff)) >>> 0;
      }
      if (yTop < minY) minY = yTop;
      if (s > maxY) maxY = s;
    }
    if (minY < maxY) this.touch(x0, minY, x1 + 1, maxY, false);
    return added;
  }

  /** Writes a packed colour directly (generation and tests). Does not mark columns unstable. */
  setPixel(x: number, y: number, color: number): void {
    if (x < 0 || x >= this.w || y < 0 || y >= this.h) return;
    this.px[x * this.h + y] = color >>> 0;
  }

  // --- Collapse ------------------------------------------------------------------

  /** True while any column may still contain falling ground. */
  get settling(): boolean {
    return this.unstableCount > 0;
  }

  /** Marks columns [x0, x1] as possibly holding unsupported ground. */
  destabilize(x0: number, x1: number): void {
    const a = Math.max(0, Math.floor(x0)), b = Math.min(this.w - 1, Math.ceil(x1));
    for (let x = a; x <= b; x++) {
      if (!this.unstable[x]) {
        this.unstable[x] = 1;
        this.unstableCount++;
      }
    }
    if (a <= b) {
      this.unstableLo = Math.min(this.unstableLo, a);
      this.unstableHi = Math.max(this.unstableHi, b);
    }
  }

  /**
   * Advances collapsing ground by dt seconds. Floating material in each unstable column
   * falls as a block (accelerating) until it rests on the ground below.
   * Returns the number of pixel rows moved (sum over columns) — 0 when nothing moved.
   */
  settle(dt: number): number {
    if (this.unstableCount === 0) return 0;
    const h = this.h, px = this.px;
    let moved = 0;
    let lo = this.w, hi = -1;
    let dx0 = this.w, dx1 = -1, dy0 = h, dy1 = -1;
    for (let x = this.unstableLo; x <= this.unstableHi; x++) {
      if (!this.unstable[x]) continue;
      const base = x * h;
      // Top of the contiguous solid stack resting on the bottom of the world.
      let g = h;
      while (g > 0 && px[base + g - 1] >>> 24 >= SOLID_ALPHA) g--;
      // Lowest floating solid pixel above the gap.
      let y = g - 1;
      while (y >= 0 && px[base + y] >>> 24 < SOLID_ALPHA) y--;
      if (y < 0) {
        this.unstable[x] = 0;
        this.unstableCount--;
        this.fallVel[x] = 0;
        this.fallAcc[x] = 0;
        continue;
      }
      lo = Math.min(lo, x);
      hi = Math.max(hi, x);
      const v = Math.min(FALL_MAX_SPEED, this.fallVel[x] + FALL_GRAVITY * dt);
      this.fallVel[x] = v;
      this.fallAcc[x] += v * dt;
      let k = Math.floor(this.fallAcc[x]);
      if (k <= 0) continue;
      this.fallAcc[x] -= k;
      const gap = g - 1 - y;
      if (k > gap) k = gap;
      let top = 0;
      while (top <= y && px[base + top] === 0) top++;
      px.copyWithin(base + top + k, base + top, base + y + 1);
      px.fill(0, base + top, base + top + k);
      moved += k;
      if (x < dx0) dx0 = x;
      if (x > dx1) dx1 = x;
      if (top < dy0) dy0 = top;
      if (y + k + 1 > dy1) dy1 = y + k + 1;
    }
    if (this.unstableCount === 0) {
      this.unstableLo = this.w;
      this.unstableHi = -1;
    } else if (hi >= lo) {
      this.unstableLo = lo;
      this.unstableHi = hi;
    }
    if (moved > 0) this.touch(dx0, dy0, dx1 + 1, dy1, false);
    return moved;
  }

  /** Runs the collapse to completion immediately. */
  settleAll(maxIterations = 600): void {
    for (let i = 0; i < maxIterations && this.settling; i++) this.settle(0.05);
  }

  // --- Rendering support --------------------------------------------------------

  /** Returns and clears the region modified since the last call (null when unchanged). */
  takeDirty(): Rect | null {
    const d = this.dirty;
    this.dirty = null;
    return d;
  }

  markAllDirty(): void {
    this.dirty = { x0: 0, y0: 0, x1: this.w, y1: this.h };
    this.version++;
  }

  /**
   * Copies a region into a row-major RGBA byte buffer (e.g. ImageData.data) of
   * size (x1 - x0) × (y1 - y0) × 4.
   */
  writeRGBA(rect: Rect, out: Uint8ClampedArray): void {
    const rw = rect.x1 - rect.x0;
    const o32 = new Uint32Array(out.buffer, out.byteOffset, out.length >> 2);
    const h = this.h, px = this.px;
    for (let x = rect.x0; x < rect.x1; x++) {
      const base = x * h, col = x - rect.x0;
      for (let y = rect.y0, o = col; y < rect.y1; y++, o += rw) o32[o] = px[base + y];
    }
  }

  private touch(x0: number, y0: number, x1: number, y1: number, destabilize: boolean): void {
    this.version++;
    const d = this.dirty;
    if (d) {
      d.x0 = Math.min(d.x0, x0); d.y0 = Math.min(d.y0, y0);
      d.x1 = Math.max(d.x1, x1); d.y1 = Math.max(d.y1, y1);
    } else {
      this.dirty = { x0, y0, x1, y1 };
    }
    if (destabilize) this.destabilize(x0 - 1, x1);
  }
}

function inRects(rects: readonly Rect[], x: number, y: number): boolean {
  for (const r of rects) if (x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1) return true;
  return false;
}
