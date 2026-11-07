import { describe, expect, it } from 'vitest';
import {
  parseGifSize,
  parseImageSize,
  parseJpegSize,
  parsePngSize,
  parseWebpSize,
  readImageSize,
} from '../src/lib/image/size';

const ascii = (text: string) => Array.from(text, (char) => char.charCodeAt(0));
const concat = (...parts: number[][]) => new Uint8Array(parts.flat());
const be16 = (value: number) => [(value >> 8) & 0xff, value & 0xff];
const be32 = (value: number) => [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
const le16 = (value: number) => [value & 0xff, (value >> 8) & 0xff];
const le24 = (value: number) => [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff];

function png(width: number, height: number): Uint8Array {
  return concat(
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    be32(13),
    ascii('IHDR'),
    be32(width),
    be32(height),
    [8, 2, 0, 0, 0],
  );
}

function gif(width: number, height: number): Uint8Array {
  return concat(ascii('GIF89a'), le16(width), le16(height), [0, 0, 0, 0]);
}

function jpeg(width: number, height: number): Uint8Array {
  return concat(
    [0xff, 0xd8],
    [0xff, 0xc0],
    be16(17),
    [8],
    be16(height),
    be16(width),
    [3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1],
  );
}

function webpVp8x(width: number, height: number): Uint8Array {
  return concat(
    ascii('RIFF'),
    [0, 0, 0, 0],
    ascii('WEBP'),
    ascii('VP8X'),
    [10, 0, 0, 0],
    [0, 0, 0, 0],
    le24(width - 1),
    le24(height - 1),
  );
}

function webpLossy(width: number, height: number): Uint8Array {
  return concat(
    ascii('RIFF'),
    [0, 0, 0, 0],
    ascii('WEBP'),
    ascii('VP8 '),
    [0, 0, 0, 0],
    [0, 0, 0],
    [0x9d, 0x01, 0x2a],
    le16(width),
    le16(height),
    [0, 0],
  );
}

function webpLossless(width: number, height: number): Uint8Array {
  const bits = (width - 1) | ((height - 1) << 14);
  return concat(
    ascii('RIFF'),
    [0, 0, 0, 0],
    ascii('WEBP'),
    ascii('VP8L'),
    [0, 0, 0, 0],
    [0x2f],
    [bits & 0xff, (bits >> 8) & 0xff, (bits >> 16) & 0xff, (bits >> 24) & 0xff],
    // Parser requires the full 30-byte minimum header.
    [0, 0, 0, 0, 0],
  );
}

describe('header parsing', () => {
  it('reads PNG dimensions', () => {
    expect(parsePngSize(png(4032, 3024))).toEqual({ width: 4032, height: 3024 });
  });

  it('reads GIF dimensions', () => {
    expect(parseGifSize(gif(288, 600))).toEqual({ width: 288, height: 600 });
  });

  it('reads JPEG dimensions from the start-of-frame segment', () => {
    expect(parseJpegSize(jpeg(1600, 1200))).toEqual({ width: 1600, height: 1200 });
  });

  it('reads WebP VP8X, VP8 and VP8L dimensions', () => {
    expect(parseWebpSize(webpVp8x(1920, 1080))).toEqual({ width: 1920, height: 1080 });
    expect(parseWebpSize(webpLossy(800, 600))).toEqual({ width: 800, height: 600 });
    expect(parseWebpSize(webpLossless(800, 600))).toEqual({ width: 800, height: 600 });
  });

  it('dispatches on the signature', () => {
    expect(parseImageSize(png(10, 20))).toEqual({ width: 10, height: 20 });
    expect(parseImageSize(gif(10, 20))).toEqual({ width: 10, height: 20 });
    expect(parseImageSize(jpeg(10, 20))).toEqual({ width: 10, height: 20 });
    expect(parseImageSize(webpVp8x(10, 20))).toEqual({ width: 10, height: 20 });
  });
});

describe('hostile or incomplete input', () => {
  it('returns null for garbage', () => {
    expect(parseImageSize(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))).toBeNull();
    expect(parseImageSize(new Uint8Array(0))).toBeNull();
  });

  it('returns null for truncated headers', () => {
    expect(parsePngSize(png(4000, 3000).slice(0, 23))).toBeNull();
    expect(parseGifSize(gif(10, 10).slice(0, 9))).toBeNull();
    expect(parseWebpSize(webpVp8x(10, 10).slice(0, 29))).toBeNull();
    expect(parseJpegSize(new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00]))).toBeNull();
  });

  it('returns null for a JPEG with no frame header before the scan', () => {
    // SOI, then SOS immediately: dimensions were never declared.
    expect(parseJpegSize(concat([0xff, 0xd8], [0xff, 0xda], be16(8), [0, 0, 0, 0, 0, 0]))).toBeNull();
  });

  it('returns null for zero dimensions rather than passing them through', () => {
    expect(parseImageSize(png(0, 0))).toBeNull();
    expect(parseImageSize(gif(0, 100))).toBeNull();
  });

  it('rejects a RIFF container that is not WebP', () => {
    const wav = concat(ascii('RIFF'), [0, 0, 0, 0], ascii('WAVE'), [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(parseWebpSize(wav)).toBeNull();
  });
});

describe('readImageSize', () => {
  it('reads a header from a Blob without decoding the image', async () => {
    const padding = new Uint8Array(1024 * 1024);
    const blob = new Blob([png(1920, 1080) as BlobPart, padding as BlobPart, padding as BlobPart]);
    expect(await readImageSize(blob)).toEqual({ width: 1920, height: 1080 });
  });

  it('returns null for a Blob that is not an image', async () => {
    expect(await readImageSize(new Blob(['not an image at all']))).toBeNull();
  });
});
