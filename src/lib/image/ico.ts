/**
 * ICO container assembly.
 *
 * An `.ico` is a small directory — a 6-byte header plus 16-byte entries that
 * point at embedded images — so it needs no codec and no dependency. The only
 * genuinely awkward part of the format is the DIB/BMP-era payload, and since
 * Windows Vista every browser and Windows itself accept PNG payloads instead.
 * Embedding PNG therefore removes the last reason to hand-write a bitmap
 * encoder, which is exactly the kind of code that silently produces icons that
 * look wrong at 16 px.
 *
 * Kept pure (no DOM, no Blob) so the committed test suite can assert every byte
 * of the directory: offsets, the 256 → 0 width/height encoding, and the fact
 * that payloads are copied verbatim.
 */
import { ToolError } from '../files/errors';
import { parsePngSize } from './size';

export interface IcoImage {
  /** Square edge length in pixels, 1–256. */
  size: number;
  /** PNG bytes at exactly `size` × `size`. */
  png: Uint8Array;
}

/** ICO stores the edge in one byte, with 0 meaning 256. That is the hard ceiling. */
export const ICO_MAX_EDGE = 256;

export const ICO_LIMITS = {
  /** Far beyond any real favicon set; a guard, not a recommendation. */
  maxImages: 12,
  /** 4 MB of icon payload is already absurd for a site icon. */
  maxTotalBytes: 4 * 1024 * 1024,
} as const;

const HEADER_BYTES = 6;
const ENTRY_BYTES = 16;

/**
 * Builds an ICO file from PNG payloads.
 *
 * Entries are emitted in ascending size order so the same inputs always produce
 * the same bytes — deterministic output is what makes this testable.
 */
export function buildIco(images: readonly IcoImage[]): Uint8Array<ArrayBuffer> {
  if (images.length === 0) {
    throw new ToolError('empty-input', 'An icon file needs at least one image.');
  }
  if (images.length > ICO_LIMITS.maxImages) {
    throw new ToolError(
      'limit-exceeded',
      `An icon file holds at most ${ICO_LIMITS.maxImages} images here.`,
      'Fewer sizes means a smaller .ico, and browsers pick from what is there.',
    );
  }

  const ordered = [...images].sort((a, b) => a.size - b.size);
  const seen = new Set<number>();
  let total = 0;

  for (const image of ordered) {
    if (!Number.isInteger(image.size) || image.size < 1 || image.size > ICO_MAX_EDGE) {
      throw new ToolError(
        'invalid-input',
        `${image.size}px does not fit in a .ico entry.`,
        'ICO entries are at most 256 × 256; larger icons belong in a PNG or the web manifest.',
      );
    }
    if (seen.has(image.size)) {
      throw new ToolError('invalid-input', `Two ${image.size}px icons cannot share one .ico.`);
    }
    seen.add(image.size);

    const dimensions = parsePngSize(image.png);
    if (!dimensions) {
      throw new ToolError(
        'unsupported-type',
        'An .ico entry must be a PNG image here.',
        'This path embeds PNG rather than BMP. Re-encode the icon as PNG first.',
      );
    }
    if (dimensions.width !== image.size || dimensions.height !== image.size) {
      throw new ToolError(
        'invalid-input',
        `The ${image.size}px entry contains a ${dimensions.width} × ${dimensions.height} image.`,
      );
    }

    total += image.png.byteLength;
  }

  if (total > ICO_LIMITS.maxTotalBytes) {
    throw new ToolError(
      'too-large',
      `Those icons total ${(total / 1024 / 1024).toFixed(1)} MB, over the ${ICO_LIMITS.maxTotalBytes / 1024 / 1024} MB ceiling for one .ico.`,
      'Drop the largest sizes from the icon file — the manifest PNGs cover those.',
    );
  }

  const dataStart = HEADER_BYTES + ENTRY_BYTES * ordered.length;
  const output = new Uint8Array(dataStart + total);
  const view = new DataView(output.buffer);

  // ICONDIR: reserved, type 1 (icon), image count.
  view.setUint16(0, 0, true);
  view.setUint16(2, 1, true);
  view.setUint16(4, ordered.length, true);

  let offset = dataStart;
  ordered.forEach((image, index) => {
    const at = HEADER_BYTES + index * ENTRY_BYTES;
    // One byte per edge; 256 is stored as 0 by specification.
    output[at] = image.size === ICO_MAX_EDGE ? 0 : image.size;
    output[at + 1] = image.size === ICO_MAX_EDGE ? 0 : image.size;
    output[at + 2] = 0; // palette size: 0 for a PNG payload
    output[at + 3] = 0; // reserved
    view.setUint16(at + 4, 1, true); // colour planes
    view.setUint16(at + 6, 32, true); // bits per pixel
    view.setUint32(at + 8, image.png.byteLength, true);
    view.setUint32(at + 12, offset, true);
    output.set(image.png, offset);
    offset += image.png.byteLength;
  });

  return output;
}
