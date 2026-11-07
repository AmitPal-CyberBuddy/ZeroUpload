/**
 * Reads image dimensions from file headers.
 *
 * Why not just `createImageBitmap`? Because that decodes the *whole* image on the
 * main thread — the exact work the worker exists to avoid. For a 50 MP photo the
 * probe alone stalls the UI, then the worker decodes it again. Header parsing
 * costs a few kilobytes of I/O and keeps decoding inside the worker.
 *
 * If a header cannot be parsed (unusual container, truncated data, AVIF/HEIC),
 * callers fall back to `createImageBitmap`, so this is an optimisation, not a
 * capability change.
 */

const BE16 = (v: Uint8Array, o: number) => (v[o] << 8) | v[o + 1];
const BE32 = (v: Uint8Array, o: number) => ((v[o] << 24) | (v[o + 1] << 16) | (v[o + 2] << 8) | v[o + 3]) >>> 0;
const LE16 = (v: Uint8Array, o: number) => v[o] | (v[o + 1] << 8);
const LE24 = (v: Uint8Array, o: number) => v[o] | (v[o + 1] << 8) | (v[o + 2] << 16);

const ascii = (v: Uint8Array, o: number, len: number) =>
  String.fromCharCode(...v.subarray(o, o + len));

const JPEG_SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

export function parsePngSize(v: Uint8Array): { width: number; height: number } | null {
  if (v.length < 24) return null;
  if (v[0] !== 0x89 || ascii(v, 1, 3) !== 'PNG') return null;
  if (ascii(v, 12, 4) !== 'IHDR') return null;
  return { width: BE32(v, 16), height: BE32(v, 20) };
}

export function parseGifSize(v: Uint8Array): { width: number; height: number } | null {
  if (v.length < 10 || ascii(v, 0, 4) !== 'GIF8') return null;
  return { width: LE16(v, 6), height: LE16(v, 8) };
}

export function parseJpegSize(v: Uint8Array): { width: number; height: number } | null {
  if (v.length < 4 || v[0] !== 0xff || v[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < v.length) {
    if (v[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = v[offset + 1];
    // Standalone markers carry no length field.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // reached scan data without a SOF
    const length = BE16(v, offset + 2);
    if (length < 2) return null;
    if (JPEG_SOF.has(marker)) {
      return { height: BE16(v, offset + 5), width: BE16(v, offset + 7) };
    }
    offset += 2 + length;
  }
  return null;
}

export function parseWebpSize(v: Uint8Array): { width: number; height: number } | null {
  if (v.length < 30) return null;
  if (ascii(v, 0, 4) !== 'RIFF' || ascii(v, 8, 4) !== 'WEBP') return null;
  const chunk = ascii(v, 12, 4);
  if (chunk === 'VP8X') {
    return { width: LE24(v, 24) + 1, height: LE24(v, 27) + 1 };
  }
  if (chunk === 'VP8 ') {
    // Lossy: 3-byte start code then 14-bit width/height.
    if (v[23] !== 0x9d || v[24] !== 0x01 || v[25] !== 0x2a) return null;
    return { width: LE16(v, 26) & 0x3fff, height: LE16(v, 28) & 0x3fff };
  }
  if (chunk === 'VP8L') {
    // Lossless: signature 0x2f then 14-bit width-1 / height-1.
    if (v[20] !== 0x2f) return null;
    const bits = v[21] | (v[22] << 8) | (v[23] << 16) | (v[24] << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  return null;
}

export function parseImageSize(bytes: Uint8Array): { width: number; height: number } | null {
  const size =
    parsePngSize(bytes) ?? parseJpegSize(bytes) ?? parseGifSize(bytes) ?? parseWebpSize(bytes) ?? null;
  if (!size || !size.width || !size.height) return null;
  return size;
}

/** Reads up to 64 KB — enough for any header, cheap even for 200 MB files. */
export async function readImageSize(file: Blob): Promise<{ width: number; height: number } | null> {
  try {
    const head = new Uint8Array(await file.slice(0, 65536).arrayBuffer());
    return parseImageSize(head);
  } catch {
    return null;
  }
}
