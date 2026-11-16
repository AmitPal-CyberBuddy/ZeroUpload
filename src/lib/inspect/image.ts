/**
 * What an image's own bytes say, without decoding it.
 *
 * The inspector already decodes an image to report its dimensions. Decoding asks
 * "does this render"; these checks ask "what else is in here", using the header
 * walkers that a photographic file is structured around:
 *
 *  - **JPEG**: the segment chain from SOI to EOI. Anything after the EOI marker is
 *    not part of the picture — it is data riding along, and the classic payload
 *    container.
 *  - **PNG**: signature, IHDR, then the chunk list. Anything after `IEND` is the
 *    same smuggled-data case, and a missing `IEND` means a truncated file.
 *  - **GIF**: trailer byte and frame count, so an animated file is distinguishable
 *    from a still one.
 *  - **All**: trailing bytes in general, and the declared dimensions, which is
 *    where the "decode bomb" lives — a 20 KB PNG that decodes to 60,000×60,000
 *    pixels exhausts memory in the decoder before any of it reaches the screen.
 *
 * Severity is deliberately gentle. An appended thumbnail is common in files from
 * a phone gallery; an appended ZIP is not. The finding names the byte count and
 * the container it resembles, and says plainly that this scan cannot tell a slow
 * motion video's index from a payload.
 */
import { type Finding, type Insight, type NextStep, sortFindings } from './findings';

/** Ceiling on the decodable-pixel count a browser tab can survive. */
const PIXEL_BUDGET = 50_000_000;
/** Read this much of the file when walking segments; headers live near the front. */
const HEAD_LIMIT = 512 * 1024;

export interface ImageFacts {
  format: 'jpeg' | 'png' | 'gif' | 'webp' | 'bmp' | 'avif' | 'heic';
  width: number;
  height: number;
  /** Bytes between the end-of-image marker and the end of the file. */
  trailingBytes: number;
  /** What the trailing bytes appear to be, when a signature is at the front of them. */
  trailingKind?: string;
  /** JPEG progressive / baseline, or PNG interlace — context, not risk. */
  encoding?: string;
  /** Plus an orientation hint from EXIF, when present. */
  exifOrientation?: number;
  /** PNG chunk names, in order. */
  chunks?: string[];
  /** True when the end-of-data marker was never found inside the window read. */
  unterminated?: boolean;
}

/** Signatures that can sit in trailing bytes, most specific first. */
const TRAILING_SIGNATURES: { label: string; bytes: number[]; offset?: number }[] = [
  { label: 'a ZIP archive', bytes: [0x50, 0x4b, 0x03, 0x04] },
  { label: 'an embedded JPEG', bytes: [0xff, 0xd8, 0xff] },
  { label: 'a PNG image', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { label: 'a PDF', bytes: [0x25, 0x50, 0x44, 0x46] },
  { label: 'a RAR archive', bytes: [0x52, 0x61, 0x72, 0x21] },
  { label: 'a 7-Zip archive', bytes: [0x37, 0x7a, 0xbc, 0xaf] },
  { label: 'an ELF executable', bytes: [0x7f, 0x45, 0x4c, 0x46] },
  { label: 'a Windows executable', bytes: [0x4d, 0x5a] },
  { label: 'a gzip stream', bytes: [0x1f, 0x8b] },
];

function matchTrailing(bytes: Uint8Array): string | undefined {
  for (const candidate of TRAILING_SIGNATURES) {
    const offset = candidate.offset ?? 0;
    if (bytes.length < offset + candidate.bytes.length) continue;
    if (candidate.bytes.every((byte, index) => bytes[offset + index] === byte)) return candidate.label;
  }
  return undefined;
}

/** Ascending chain of JPEG segments; returns the offset just past EOI. */
function walkJpeg(bytes: Uint8Array): { end: number; progressive: boolean; exifOrientation?: number } {
  let offset = 2;
  let progressive = false;
  let exifOrientation: number | undefined;

  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      // Not a marker where one must be: stop rather than guess.
      return { end: -1, progressive, exifOrientation };
    }
    const marker = bytes[offset + 1];
    // Standalone markers carry no length.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2) return { end: -1, progressive, exifOrientation };

    if (marker === 0xc2) progressive = true;

    // APP1/Exif: read the orientation tag (0x0112) from IFD0.
    if (marker === 0xe1 && length > 14 && bytes[offset + 4] === 0x45 && bytes[offset + 5] === 0x78) {
      exifOrientation = readOrientation(bytes.subarray(offset + 4, Math.min(bytes.length, offset + 4 + length)));
    }

    if (marker === 0xda) {
      // Start of scan: entropy-coded data follows, ending at the next EOI.
      let scan = offset + 2 + length;
      while (scan + 1 < bytes.length) {
        if (bytes[scan] === 0xff && bytes[scan + 1] === 0xd9) return { end: scan + 2, progressive, exifOrientation };
        scan += 1;
      }
      return { end: -1, progressive, exifOrientation };
    }
    offset += 2 + length;
    if (marker === 0xd9) return { end: offset, progressive, exifOrientation };
  }
  return { end: -1, progressive, exifOrientation };
}

function readOrientation(segment: Uint8Array): number | undefined {
  // "Exif\0\0" then a TIFF header: II*\0 or MM\0*
  if (segment.length < 14) return undefined;
  const little = segment[6] === 0x49;
  const u16 = (offset: number) =>
    little ? segment[offset] | (segment[offset + 1] << 8) : (segment[offset] << 8) | segment[offset + 1];
  const u32 = (offset: number) =>
    little
      ? (segment[offset] | (segment[offset + 1] << 8) | (segment[offset + 2] << 16) | (segment[offset + 3] << 24)) >>> 0
      : ((segment[offset] << 24) | (segment[offset + 1] << 16) | (segment[offset + 2] << 8) | segment[offset + 3]) >>> 0;

  const ifd = 6 + u32(10);
  if (ifd + 2 > segment.length) return undefined;
  const count = u16(ifd);
  for (let index = 0; index < count; index += 1) {
    const entry = ifd + 2 + index * 12;
    if (entry + 10 > segment.length) return undefined;
    if (u16(entry) === 0x0112) return u16(entry + 8);
  }
  return undefined;
}

/** PNG chunk walk; returns the offset just past IEND and the chunk names. */
function walkPng(bytes: Uint8Array): { end: number; chunks: string[]; width: number; height: number; interlace: boolean } {
  const chunks: string[] = [];
  let offset = 8;
  let width = 0;
  let height = 0;
  let interlace = false;

  while (offset + 8 <= bytes.length) {
    const length = ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
    const name = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    if (chunks.length < 64) chunks.push(name);
    if (name === 'IHDR' && offset + 8 + 13 <= bytes.length) {
      width = ((bytes[offset + 8] << 24) | (bytes[offset + 9] << 16) | (bytes[offset + 10] << 8) | bytes[offset + 11]) >>> 0;
      height = ((bytes[offset + 12] << 24) | (bytes[offset + 13] << 16) | (bytes[offset + 14] << 8) | bytes[offset + 15]) >>> 0;
      interlace = bytes[offset + 20] === 1;
    }
    const next = offset + 12 + length;
    if (name === 'IEND') return { end: next, chunks, width, height, interlace };
    if (length > bytes.length || next <= offset) break;
    offset = next;
  }
  return { end: -1, chunks, width, height, interlace };
}

function walkGif(bytes: Uint8Array): { end: number; frames: number; width: number; height: number } {
  const width = bytes[6] | (bytes[7] << 8);
  const height = bytes[8] | (bytes[9] << 8);
  let offset = 13;
  const flags = bytes[10];
  if (flags & 0x80) offset += 3 * (1 << ((flags & 0x07) + 1));

  let frames = 0;
  let guard = 0;
  while (offset < bytes.length && guard < 20_000) {
    guard += 1;
    const block = bytes[offset];
    if (block === 0x3b) return { end: offset + 1, frames, width, height };
    if (block === 0x21) {
      offset += 2;
      while (offset < bytes.length && bytes[offset] !== 0) offset += bytes[offset] + 1;
      offset += 1;
      continue;
    }
    if (block === 0x2c) {
      frames += 1;
      const local = bytes[offset + 9];
      offset += 10;
      if (local & 0x80) offset += 3 * (1 << ((local & 0x07) + 1));
      offset += 1; // LZW minimum code size
      while (offset < bytes.length && bytes[offset] !== 0) offset += bytes[offset] + 1;
      offset += 1;
      continue;
    }
    break;
  }
  return { end: -1, frames, width, height };
}

/** Bytes per pixel for a PNG colour type, for the decoded-size estimate. */
function pngDecodedSize(bytes: Uint8Array): number {
  // IHDR sits at offset 8 + 8; colour type is the 10th byte of the data.
  const colorType = bytes[8 + 8 + 9];
  const bitsPerChannel = bytes[8 + 8 + 8];
  const channels = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 3 ? 1 : colorType === 4 ? 2 : 4;
  return (bitsPerChannel * channels) / 8;
}

/**
 * Inspects an image's bytes. `width`/`height` passed in are the *decoded*
 * dimensions when the caller already has them; the header values are used when
 * they are not, so a file that lies about its size is still caught.
 */
export function scanImageBytes(bytes: Uint8Array, decoded?: { width: number; height: number }): Insight {
  const findings: Finding[] = [];
  const limited: string[] = [];
  const head = bytes.subarray(0, HEAD_LIMIT);

  let format: ImageFacts['format'] | null = null;
  if (head[0] === 0xff && head[1] === 0xd8) format = 'jpeg';
  else if (head[0] === 0x89 && head[1] === 0x50) format = 'png';
  else if (head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46) format = 'gif';
  else if (String.fromCharCode(...head.subarray(0, 4)) === 'RIFF') format = 'webp';
  else if (head[0] === 0x42 && head[1] === 0x4d) format = 'bmp';
  else if (String.fromCharCode(...head.subarray(4, 8)) === 'ftyp') {
    const brand = String.fromCharCode(...head.subarray(8, 12));
    if (brand.startsWith('avif') || brand.startsWith('avis')) format = 'avif';
    else if (/hei|hev|mif1|msf1/.test(brand)) format = 'heic';
  }

  if (!format) {
    return { findings, limited: ['The image format was not recognised from its first bytes, so its structure was not walked.'], next: [] };
  }

  let trailing = 0;
  let trailingKind: string | undefined;
  let width = decoded?.width ?? 0;
  let height = decoded?.height ?? 0;
  let encoding: string | undefined;
  let exifOrientation: number | undefined;
  let unterminated = false;

  if (format === 'jpeg') {
    const walk = walkJpeg(head);
    encoding = walk.progressive ? 'progressive' : 'baseline';
    exifOrientation = walk.exifOrientation;
    if (walk.end > 0) {
      // EOI was found inside the window; anything after it is extra.
      trailing = bytes.length - walk.end;
      trailingKind = matchTrailing(bytes.subarray(walk.end, walk.end + 16));
    } else if (bytes.length > HEAD_LIMIT) {
      limited.push('The image data is larger than the window read, so trailing bytes could not be located.');
    } else {
      unterminated = true;
    }
  } else if (format === 'png') {
    const walk = walkPng(head);
    if (!decoded) {
      width = walk.width;
      height = walk.height;
    }
    encoding = walk.interlace ? 'interlaced' : undefined;
    if (walk.end > 0) {
      trailing = bytes.length - walk.end;
      trailingKind = matchTrailing(bytes.subarray(walk.end, walk.end + 16));
    } else if (bytes.length > HEAD_LIMIT) {
      limited.push('The PNG chunks extend past the window read, so the end of the image was not located.');
    } else {
      unterminated = true;
    }
    if (walk.chunks.includes('tRNS')) encoding = `${encoding ? encoding + ', ' : ''}transparent`;
    if (decoded) {
      const perPixel = pngDecodedSize(head);
      const estimated = decoded.width * decoded.height * perPixel;
      if (estimated > 512 * 1024 * 1024) {
        findings.push({
          id: 'image.decode-size',
          severity: 'warn',
          title: 'Decodes to a very large bitmap',
          detail: `At ${perPixel.toFixed(0)} bytes per pixel this canvas needs about ${(estimated / 1024 / 1024).toFixed(0)} MB of memory to decode. Some tools here will refuse it rather than crash the tab.`,
          evidence: `${decoded.width} × ${decoded.height}`,
        });
      }
    }
  } else if (format === 'gif') {
    const walk = walkGif(head);
    if (!decoded) {
      width = walk.width;
      height = walk.height;
    }
    if (walk.end > 0) {
      trailing = bytes.length - walk.end;
      trailingKind = matchTrailing(bytes.subarray(walk.end, walk.end + 16));
    } else if (bytes.length <= HEAD_LIMIT) {
      unterminated = true;
    }
    if (walk.frames > 1) {
      findings.push({
        id: 'image.animated',
        severity: 'info',
        title: `Animated — ${walk.frames} frames`,
        detail:
          'Converting or compressing this file keeps only the first frame, which is what every tool here does. If the animation matters, it is not preserved.',
        evidence: `${walk.frames} frames`,
      });
    }
  } else if (format === 'bmp') {
    if (!decoded && head.length >= 26) {
      width = head[18] | (head[19] << 8) | (head[20] << 16) | (head[21] << 24);
      height = head[22] | (head[23] << 8) | (head[24] << 16) | (head[25] << 24);
    }
    // BMP has no terminator, so "trailing bytes" is meaningless here.
  } else if (format === 'webp' || format === 'avif' || format === 'heic') {
    limited.push(`${format.toUpperCase()} is a container; this scan read its header but did not walk its boxes.`);
  }

  if (trailing > 0) {
    const meaningful = trailing > 32;
    if (meaningful) {
      findings.push({
        id: 'image.trailing-data',
        severity: 'warn',
        title: `${trailing.toLocaleString()} bytes after the end of the image`,
        detail: `${trailingKind ? `The extra data begins with the signature of ${trailingKind}` : 'The extra data carries no signature this scan recognises'}. A viewer shows the picture and ignores everything after it, so these bytes travel invisibly — the classic way to hide a second file inside an image. Some cameras and editors append a thumbnail or a colour profile legitimately, which is why this is a warning and not a verdict.`,
        evidence: `${trailing.toLocaleString()} bytes${trailingKind ? `, looks like ${trailingKind}` : ''}`,
      });
      findings.push({
        id: 'image.trailing-preview',
        severity: 'info',
        title: 'Re-encoding removes it',
        detail: 'Anything that decodes and re-encodes the picture — compress, convert, resize — writes a clean file with no trailing data.',
      });
    }
  }

  if (unterminated) {
    findings.push({
      id: 'image.unterminated',
      severity: 'warn',
      title: 'The image never ends',
      detail:
        'No end-of-image marker was found, so the file is truncated. Whatever produced it stopped early, and the bottom of the picture is probably missing.',
      evidence: 'no end marker',
    });
  }

  if (width > 0 && height > 0 && width * height > PIXEL_BUDGET) {
    findings.push({
      id: 'image.pixel-count',
      severity: 'warn',
      title: 'Very high pixel count',
      detail: `At ${(width * height / 1_000_000).toFixed(0)} megapixels, decoding this needs a canvas larger than most tabs can hold. Compression and conversion here will refuse it rather than let the tab run out of memory.`,
      evidence: `${width} × ${height}`,
    });
  }

  if (exifOrientation !== undefined && exifOrientation !== 1) {
    findings.push({
      id: 'image.exif-orientation',
      severity: 'info',
      title: 'Stored sideways, flagged upright',
      detail: `An EXIF orientation of ${exifOrientation} tells the viewer to rotate the picture on display. Browsers and this tool honour it, so the image looks right — but software that ignores EXIF shows it on its side, and re-encoding bakes the rotation in permanently.`,
      evidence: `orientation ${exifOrientation}`,
    });
  }

  const next: NextStep[] = [];
  if (findings.some((finding) => finding.id === 'image.trailing-data')) {
    next.push({
      slug: 'image-converter',
      label: 'Re-encode to strip the extra bytes',
      why: 'A convert writes a fresh file from the decoded pixels, dropping anything appended.',
    });
    next.push({
      slug: 'image-compressor',
      label: 'Compress and clean in one pass',
      why: 'Usually smaller than the original, and never carries the appended data.',
    });
  }
  next.push(
    { slug: 'image-compressor', label: 'Compress this image', why: 'Reports the real byte saving.' },
    { slug: 'resize', label: 'Resize to exact pixels', why: 'Useful when the dimensions are the problem.' },
    { slug: 'crop', label: 'Crop a region', why: 'Keep part of the picture and discard the rest.' },
    { slug: 'rotate', label: 'Rotate or flip', why: 'Bakes the orientation in, so nothing has to guess.' },
  );

  return { findings: sortFindings(findings), limited, next };
}

/**
 * Whether the last bytes of the file are the format's end marker.
 *
 * Cheap and exact: a JPEG ends with FF D9 and a PNG ends with the IEND chunk, so
 * a file that ends some other way either has data appended after the image or was
 * truncated. Either way the reader is seeing something the author of the picture
 * did not intend, and a 16-byte tail read is enough to say which shape it is.
 */
export function endsWithEndMarker(format: 'jpeg' | 'png' | 'gif', tail: Uint8Array): boolean {
  if (format === 'jpeg') return tail.length >= 2 && tail[tail.length - 2] === 0xff && tail[tail.length - 1] === 0xd9;
  if (format === 'png') {
    const text = String.fromCharCode(...tail.subarray(Math.max(0, tail.length - 8)));
    return text.includes('IEND');
  }
  return tail.length > 0 && tail[tail.length - 1] === 0x3b;
}

export function formatOf(bytes: Uint8Array): ImageFacts['format'] | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'png';
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'gif';
  if (String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF') return 'webp';
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return 'bmp';
  if (String.fromCharCode(...bytes.subarray(4, 8)) === 'ftyp') {
    const brand = String.fromCharCode(...bytes.subarray(8, 12));
    if (brand.startsWith('avif') || brand.startsWith('avis')) return 'avif';
    if (/hei|hev|mif1|msf1/.test(brand)) return 'heic';
  }
  return null;
}

/** Pure helper exported for the tests and for the media tools' future use. */
export function trailingBytesOf(bytes: Uint8Array): number {
  const head = bytes.subarray(0, HEAD_LIMIT);
  if (head[0] === 0xff && head[1] === 0xd8) {
    const walk = walkJpeg(head);
    return walk.end > 0 ? Math.max(0, bytes.length - walk.end) : 0;
  }
  if (head[0] === 0x89 && head[1] === 0x50) {
    const walk = walkPng(head);
    return walk.end > 0 ? Math.max(0, bytes.length - walk.end) : 0;
  }
  return 0;
}
