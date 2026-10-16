// Pure rasterizer for the RenegadeBox icons: a simple archive-box glyph.
// Shapes are signed-distance rounded rectangles on a 22x22 design grid,
// supersampled 4x4 per pixel for anti-aliasing. Output is straight RGBA.
import { deflateSync } from "node:zlib";

type Shape = { x0: number; y0: number; x1: number; y1: number; r: number; ring?: number };

/** Lid (filled), body (outline, its top edge hidden under the lid) and handle slot. */
const GLYPH: Shape[] = [
  { x0: 2.5, y0: 3.5, x1: 19.5, y1: 8.2, r: 1.3 },
  { x0: 4.2, y0: 6, x1: 17.8, y1: 18.8, r: 1.6, ring: 1.7 },
  { x0: 8.4, y0: 11.4, x1: 13.6, y1: 13.3, r: 0.95 },
];

function sdRoundRect(px: number, py: number, s: Shape): number {
  const cx = (s.x0 + s.x1) / 2;
  const cy = (s.y0 + s.y1) / 2;
  const qx = Math.abs(px - cx) - ((s.x1 - s.x0) / 2 - s.r);
  const qy = Math.abs(py - cy) - ((s.y1 - s.y0) / 2 - s.r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - s.r;
}

function insideShape(px: number, py: number, s: Shape): boolean {
  const d = sdRoundRect(px, py, s);
  return s.ring ? Math.abs(d + s.ring / 2) <= s.ring / 2 : d <= 0;
}

const SS = 4;

/** Fraction of pixel (x, y) covered, given a point-in-shape test in pixel space. */
function coverage(x: number, y: number, inside: (px: number, py: number) => boolean): number {
  let hit = 0;
  for (let j = 0; j < SS; j++) {
    for (let i = 0; i < SS; i++) {
      if (inside(x + (i + 0.5) / SS, y + (j + 0.5) / SS)) hit++;
    }
  }
  return hit / (SS * SS);
}

function glyphAt(px: number, py: number, scale: number, ox: number, oy: number): boolean {
  const gx = (px - ox) / scale;
  const gy = (py - oy) / scale;
  return GLYPH.some((s) => insideShape(gx, gy, s));
}

export function traySize(scale: number): number {
  return 22 * scale;
}

/** macOS template image: pure black, shape carried entirely by alpha. */
export function renderTrayGlyph(size: number): Uint8Array {
  const px = new Uint8Array(size * size * 4);
  const scale = size / 22;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      px[(y * size + x) * 4 + 3] = Math.round(255 * coverage(x, y, (a, b) => glyphAt(a, b, scale, 0, 0)));
    }
  }
  return px;
}

/** App icon: rounded-square blue tile with a white box glyph (Apple's 824/1024 grid). */
export function renderAppIcon(size: number): Uint8Array {
  const px = new Uint8Array(size * size * 4);
  const inset = size * (100 / 1024);
  const tile: Shape = { x0: inset, y0: inset, x1: size - inset, y1: size - inset, r: size * 0.18 };
  const glyphScale = (size * 0.52) / 22;
  const g0 = (size - 22 * glyphScale) / 2;
  const top = [94, 129, 244];
  const bottom = [44, 82, 196];
  for (let y = 0; y < size; y++) {
    const t = Math.min(1, Math.max(0, (y - inset) / (size - 2 * inset)));
    const bg = top.map((c, i) => c + (bottom[i]! - c) * t);
    for (let x = 0; x < size; x++) {
      const a = coverage(x, y, (u, v) => sdRoundRect(u, v, tile) <= 0);
      const w = coverage(x, y, (u, v) => glyphAt(u, v, glyphScale, g0, g0 + size * 0.01));
      const o = (y * size + x) * 4;
      for (let i = 0; i < 3; i++) px[o + i] = Math.round(bg[i]! * (1 - w) + 255 * w);
      px[o + 3] = Math.round(255 * a);
    }
  }
  return px;
}

// --- Minimal PNG encoder (RGBA8, filter 0) ---

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

export function encodePng(rgba: Uint8Array, size: number): Uint8Array {
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, size);
  v.setUint32(4, size);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const raw = new Uint8Array(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) raw.set(rgba.subarray(y * size * 4, (y + 1) * size * 4), y * (size * 4 + 1) + 1);
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", new Uint8Array(deflateSync(raw, { level: 9 }))),
    chunk("IEND", new Uint8Array()),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}
