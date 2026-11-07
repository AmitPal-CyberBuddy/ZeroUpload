#!/usr/bin/env node
/**
 * Generates the raster app icons from the same geometry as `public/favicon.svg`.
 *
 * Why by hand: the site's only icon was an SVG plus a 1200×630 Open Graph image
 * used as `apple-touch-icon`. iOS wants 180×180, and it letterboxes anything else,
 * so every home-screen shortcut on an iPhone was a squashed social card. It also
 * gives the web app manifest real 192/512 icons, including a maskable one that
 * survives Android's circular crop.
 *
 * Everything is drawn here rather than converted with an image library because the
 * mark is four primitives and a build-time dependency for that is not worth it.
 * Supersampled 4×, then box-filtered down — that is the whole anti-aliasing story.
 *
 *   node scripts/make-icons.mjs
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const INK = [8, 9, 11]; // #08090b
const MINT = [95, 243, 210]; // #5ff3d2
const VIOLET = [139, 123, 255]; // #8b7bff

const SS = 4; // supersample factor

/** Distance from the centre of a rounded square to the rectangle's edge. */
function roundRectDistance(x, y, w, h, r) {
  const halfW = w / 2;
  const halfH = h / 2;
  const dx = Math.abs(x - halfW) - (halfW - r);
  const dy = Math.abs(y - halfH) - (halfH - r);
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  return outside + Math.min(Math.max(dx, dy), 0) - r;
}

function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

/** Coverage of a stroked shape, as 0..1, from its signed distance. */
function stroke(dist, width) {
  const edge = width / 2;
  const f = Math.min(Math.max(0.5 - (Math.abs(dist) - edge), 0), 1);
  return f;
}

function render(size) {
  const S = size * SS;
  const px = new Float32Array(S * S * 4); // premultiplied-ish rgb + alpha
  const scale = 64 / S; // SVG user units per device pixel
  // Everything below works in the SVG's own 64-unit space, so these are user
  // units too — mixing in device pixels here is how the first attempt painted the
  // whole right half violet.
  const radius = 16;
  const strokeW = 6;

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      const ux = x * scale;
      const uy = y * scale;

      // The body, as a rounded square. Anything outside is transparent, which is
      // what the maskable variant wants once the safe zone is applied.
      const bodyDist = roundRectDistance(ux, uy, 64, 64, 14);
      const body = Math.min(Math.max(0.5 - bodyDist, 0), 1);
      if (body <= 0) continue;

      let colour = INK;

      // Mint ring.
      const d = Math.hypot(ux - 32, uy - 32) - radius;
      const ring = stroke(d, strokeW);
      if (ring > 0) colour = mix(colour, MINT, ring);

      // Violet half-ring over the right side, matching the SVG's arc. The arcs are
      // `stroke`ed the same way as the ring so the round caps are real caps and not
      // a filled half-plane: a cap is a disc at the end of the arc.
      if (ux >= 32) {
        // A round cap is a filled disc of radius strokeW/2 at the arc's end, so it
        // needs `disc()`, not `stroke()` (which measures distance to a centreline).
        const disc = (dist) => Math.min(Math.max(0.5 - (dist - strokeW / 2), 0), 1);
        const capTop = disc(Math.hypot(ux - 32, uy - 16));
        const capBottom = disc(Math.hypot(ux - 32, uy - 48));
        const arc = Math.max(stroke(d, strokeW), capTop, capBottom);
        if (arc > 0) colour = mix(colour, VIOLET, arc);
      }

      px[i] = colour[0];
      px[i + 1] = colour[1];
      px[i + 2] = colour[2];
      px[i + 3] = 1;
    }
  }

  // Box-filter down to the target size.
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const i = ((y * SS + sy) * S + (x * SS + sx)) * 4;
          a += px[i + 3];
          r += px[i] * px[i + 3];
          g += px[i + 1] * px[i + 3];
          b += px[i + 2] * px[i + 3];
        }
      }
      const n = SS * SS;
      const o = (y * size + x) * 4;
      out[o + 3] = Math.round((a / n) * 255);
      out[o] = a > 0 ? Math.round(r / a) : 0;
      out[o + 1] = a > 0 ? Math.round(g / a) : 0;
      out[o + 2] = a > 0 ? Math.round(b / a) : 0;
    }
  }
  return out;
}

// --- minimal PNG encoder ----------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/**
 * Reduce to at most 255 colours, keeping the most-used ones and mapping the rest
 * to their nearest neighbour.
 *
 * A flat two-colour mark should not cost 40 kB. Indexed PNG with a `tRNS` table
 * stores one byte per pixel instead of four, and because anti-aliased edges are a
 * blend between two known colours, 255 entries lose nothing visible.
 */
function quantize(rgba, size) {
  const pixels = size * size;
  const counts = new Map();
  for (let i = 0; i < pixels; i++) {
    const key = rgba.readUInt32BE(i * 4);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  if (counts.size <= 256) {
    const palette = [...counts.keys()].map((key) => key >>> 0);
    const index = new Map(palette.map((key, i) => [key, i]));
    const bytes = Buffer.alloc(pixels);
    for (let i = 0; i < pixels; i++) bytes[i] = index.get(rgba.readUInt32BE(i * 4));
    return { palette, bytes };
  }

  const kept = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 256)
    .map(([key]) => key >>> 0);

  // Nearest entry in RGBA space, memoised per distinct source colour.
  const cache = new Map();
  const nearest = (key) => {
    if (cache.has(key)) return cache.get(key);
    const r = key >>> 24;
    const g = (key >>> 16) & 0xff;
    const b = (key >>> 8) & 0xff;
    const a = key & 0xff;
    let best = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < kept.length; i++) {
      const k = kept[i];
      const dr = r - (k >>> 24);
      const dg = g - ((k >>> 16) & 0xff);
      const db = b - ((k >>> 8) & 0xff);
      const da = a - (k & 0xff);
      const distance = dr * dr + dg * dg + db * db + da * da;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
    cache.set(key, best);
    return best;
  };

  const bytes = Buffer.alloc(pixels);
  for (let i = 0; i < pixels; i++) bytes[i] = nearest(rgba.readUInt32BE(i * 4));

  return { palette: kept, bytes };
}

/** Palette PNG (colour type 3) with per-entry alpha in `tRNS`. */
function encodeIndexedPng({ palette, bytes }, size) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 3; // indexed colour
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  const plte = Buffer.alloc(palette.length * 3);
  const trns = Buffer.alloc(palette.length);
  palette.forEach((key, i) => {
    plte[i * 3] = key >>> 24;
    plte[i * 3 + 1] = (key >>> 16) & 0xff;
    plte[i * 3 + 2] = (key >>> 8) & 0xff;
    trns[i] = key & 0xff;
  });

  const raw = Buffer.alloc(size * (size + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size + 1)] = 0;
    bytes.copy(raw, y * (size + 1) + 1, y * size, (y + 1) * size);
  }

  const chunks = [
    chunk('IHDR', header),
    chunk('PLTE', plte),
    chunk('tRNS', trns),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ];

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ...chunks,
  ]);
}

function encodePng(rgba, size) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  // One filter byte (0 = none) per scanline.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- output -----------------------------------------------------------------

const targets = [
  ['public/apple-touch-icon.png', 180],
  ['public/icon-192.png', 192],
  ['public/icon-512.png', 512],
];

for (const [path, size] of targets) {
  const file = join(process.cwd(), path);
  mkdirSync(dirname(file), { recursive: true });
  const rgba = render(size);
  // Indexed where it saves bytes, RGBA where the palette would have to grow.
  const indexed = encodeIndexedPng(quantize(rgba, size), size);
  const direct = encodePng(rgba, size);
  const png = indexed.length <= direct.length ? indexed : direct;
  writeFileSync(file, png);
  console.log(`${path} · ${size}×${size} · ${(png.length / 1024).toFixed(1)} kB`);
}
