import { describe, expect, it } from 'vitest';
import { PDFDocument } from '@cantoo/pdf-lib';
import { runOperation } from '../src/lib/pdf/ops';
import type { PdfOperation } from '../src/lib/pdf/protocol';

/**
 * Page geometry for Images → PDF.
 *
 * The whole point of `a4-match` is measurable: a landscape image on portrait A4
 * leaves two empty bands, and the test reads the produced page size back out of the
 * document rather than trusting the option that produced it.
 */

/**
 * A real PNG of a given pixel size.
 *
 * The geometry test needs images whose aspect ratio is known and different, and
 * pdf-lib reads the dimensions out of the header — so this writes a genuine PNG
 * with *stored* deflate blocks rather than a hand-made fake. No encoder dependency
 * and no canvas, which keeps the test runnable in plain Node.
 */
function png(width: number, height: number): Uint8Array {
  const rowBytes = width * 3 + 1;
  const raw = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * rowBytes] = 0; // filter: none
    for (let x = 0; x < width; x += 1) {
      const i = y * rowBytes + 1 + x * 3;
      raw[i] = (x * 7) % 256;
      raw[i + 1] = (y * 11) % 256;
      raw[i + 2] = 128;
    }
  }

  const stored = zlibStored(raw);
  const chunks: Uint8Array[] = [signature()];
  const ihdr = new Uint8Array(13);
  writeUint32(ihdr, 0, width);
  writeUint32(ihdr, 4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  chunks.push(chunk('IHDR', ihdr));
  chunks.push(chunk('IDAT', stored));
  chunks.push(chunk('IEND', new Uint8Array(0)));
  return concat(chunks);
}

function zlibStored(data: Uint8Array): Uint8Array {
  const blocks: number[] = [0x78, 0x01];
  let offset = 0;
  while (offset < data.length) {
    const length = Math.min(65_535, data.length - offset);
    const last = offset + length >= data.length ? 1 : 0;
    blocks.push(last, length & 0xff, (length >> 8) & 0xff, ~length & 0xff, (~length >> 8) & 0xff);
    for (let i = 0; i < length; i += 1) blocks.push(data[offset + i]);
    offset += length;
  }
  const adler = adler32(data);
  blocks.push((adler >>> 24) & 0xff, (adler >>> 16) & 0xff, (adler >>> 8) & 0xff, adler & 0xff);
  return new Uint8Array(blocks);
}

function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const byte of data) {
    a = (a + byte) % 65_521;
    b = (b + a) % 65_521;
  }
  return ((b << 16) | a) >>> 0;
}

function signature(): Uint8Array {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}

function writeUint32(target: Uint8Array, offset: number, value: number): void {
  target[offset] = (value >>> 24) & 0xff;
  target[offset + 1] = (value >>> 16) & 0xff;
  target[offset + 2] = (value >>> 8) & 0xff;
  target[offset + 3] = value & 0xff;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** CRC-32, needed by PNG chunk framing. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new Uint8Array([...type].map((char) => char.charCodeAt(0)));
  const body = concat([typeBytes, data]);
  const out = new Uint8Array(8 + data.length + 4);
  writeUint32(out, 0, data.length);
  out.set(body, 4);
  writeUint32(out, 4 + body.length, crc32(body));
  return out;
}

const image = (bytes: Uint8Array, type: string, name: string) => ({
  name,
  type,
  blob: new Blob([bytes as BlobPart], { type }),
});

const build = async (width: number, height: number, pageSize: 'fit' | 'a4' | 'a4-match', margin = 0) =>
  runOperation({
    kind: 'images-to-pdf',
    images: [image(png(width, height), 'image/png', 'photo.png')],
    options: { pageSize, margin },
  } satisfies PdfOperation);

const pageSizes = async (bytes: Uint8Array) => {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => {
    const size = page.getSize();
    return { width: Math.round(size.width), height: Math.round(size.height) };
  });
};

describe('Images → PDF page geometry', () => {
  it('fit: the page is the image plus margins', async () => {
    const [page] = await pageSizes((await build(120, 80, 'fit', 10)).documents[0]);
    expect(page).toEqual({ width: 140, height: 100 });
  });

  it('a4: every page is portrait', async () => {
    expect(await pageSizes((await build(120, 80, 'a4')).documents[0])).toEqual([{ width: 595, height: 842 }]);
    expect(await pageSizes((await build(80, 120, 'a4')).documents[0])).toEqual([{ width: 595, height: 842 }]);
  });

  it('a4-match: a landscape image gets a landscape sheet', async () => {
    expect(await pageSizes((await build(120, 80, 'a4-match')).documents[0])).toEqual([{ width: 842, height: 595 }]);
  });

  it('a4-match: a portrait image still gets a portrait sheet', async () => {
    expect(await pageSizes((await build(80, 120, 'a4-match')).documents[0])).toEqual([{ width: 595, height: 842 }]);
  });

  it('squares count as portrait, because that is the safer of two imperfect answers', async () => {
    expect(await pageSizes((await build(100, 100, 'a4-match')).documents[0])).toEqual([{ width: 595, height: 842 }]);
  });
});
