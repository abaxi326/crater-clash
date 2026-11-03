/** Colour helpers shared by terrain generation, renderers and UI. Hex strings are '#rgb' or '#rrggbb'. */

export type RGB = [number, number, number];

const cache = new Map<string, RGB>();

export function hexToRgb(hex: string): RGB {
  const hit = cache.get(hex);
  if (hit) return hit;
  let h = hex.startsWith('#') ? hex.slice(1) : hex;
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h.slice(0, 6), 16);
  const rgb: RGB = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  cache.set(hex, rgb);
  return rgb;
}

const to2 = (v: number): string => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');

export function rgbToHex(r: number, g: number, b: number): string {
  return `#${to2(r)}${to2(g)}${to2(b)}`;
}

/** CSS rgba() string from a hex colour and alpha in [0, 1]. */
export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
}

/** Linear blend of two hex colours. */
export function mixHex(a: string, b: string, t: number): string {
  const ca = hexToRgb(a), cb = hexToRgb(b);
  return rgbToHex(ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t);
}

/** Multiply brightness (factor < 1 darkens, > 1 lightens). */
export function shadeHex(hex: string, factor: number): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r * factor, g * factor, b * factor);
}

/**
 * Packs RGBA bytes into a Uint32 matching ImageData byte order on little-endian
 * platforms (0xAABBGGRR). Alpha defaults to 255.
 */
export function packRGBA(r: number, g: number, b: number, a = 255): number {
  return (((a & 255) << 24) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255)) >>> 0;
}

export function unpackRGBA(c: number): [number, number, number, number] {
  return [c & 255, (c >>> 8) & 255, (c >>> 16) & 255, c >>> 24];
}

export function hexToPacked(hex: string, alpha = 255): number {
  const [r, g, b] = hexToRgb(hex);
  return packRGBA(r, g, b, alpha);
}

/** Interpolate between colours of a palette (t in [0, 1] across all stops). Returns RGB floats. */
export function samplePalette(stops: readonly RGB[], t: number, out: RGB = [0, 0, 0]): RGB {
  const n = stops.length - 1;
  const f = Math.max(0, Math.min(1, t)) * n;
  const i = Math.min(n - 1, Math.floor(f));
  const k = f - i;
  const a = stops[i], b = stops[i + 1] ?? stops[i];
  out[0] = a[0] + (b[0] - a[0]) * k;
  out[1] = a[1] + (b[1] - a[1]) * k;
  out[2] = a[2] + (b[2] - a[2]) * k;
  return out;
}
