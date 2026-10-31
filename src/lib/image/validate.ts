import { assertWithinSize, ToolError } from '../files/errors';
import { sniffFileType } from '../files/mime';
import { probeImage } from './capabilities';

export interface ImageInput {
  file: File;
  width: number;
  height: number;
  /** Signature-derived type; falls back to the declared MIME type. */
  detectedType: string;
  /** True when the browser's reported type did not match the bytes. */
  mismatch: boolean;
}

const DECODABLE = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif', 'image/bmp', 'image/heic']);

/**
 * Validates an image before decoding it.
 *
 * SVG is deliberately rejected: an SVG is a scriptable document, and even though
 * `<img>`/canvas decoding does not execute scripts, rasterising one reliably
 * (external references, fonts, filters) is browser-dependent. Saying "not
 * supported, here is why" is more honest than producing a broken result.
 */
export async function validateImage(file: File): Promise<ImageInput> {
  assertWithinSize(file, 'image');

  const signature = await sniffFileType(file);
  const declared = file.type || '';

  const isSvg = declared === 'image/svg+xml' || /\.svg$/i.test(file.name) || (!signature && (await looksLikeSvg(file)));
  if (isSvg) {
    throw new ToolError(
      'unsupported-type',
      'SVG files are not rasterised here.',
      'An SVG is an executable document. Convert it to PNG in a vector editor first, then bring the PNG back.',
    );
  }

  const detectedType = signature?.type ?? declared;
  if (!DECODABLE.has(detectedType) && !declared.startsWith('image/')) {
    throw new ToolError(
      'unsupported-type',
      `${file.name} does not look like an image.`,
      signature ? `Its bytes read as “${signature.label}”.` : 'The file signature was not recognised.',
    );
  }

  if (detectedType === 'image/heic') {
    throw new ToolError(
      'unsupported-type',
      'HEIC images need a browser decoder that is not available here.',
      'Export the photo as JPEG from Photos, then retry.',
    );
  }

  const size = await probeImage(file);
  if (!size) {
    throw new ToolError(
      'decode-failed',
      'This image could not be decoded.',
      'The file may be damaged, or it may use a format this browser cannot read.',
    );
  }

  return {
    file,
    width: size.width,
    height: size.height,
    detectedType,
    mismatch: !!signature && !!declared && signature.type !== declared,
  };
}

async function looksLikeSvg(file: File): Promise<boolean> {
  const head = await file.slice(0, 400).text();
  return /<svg[\s>]/i.test(head);
}
