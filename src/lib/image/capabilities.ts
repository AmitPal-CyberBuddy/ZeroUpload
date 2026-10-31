import type { ImageFormat } from './types';
import { IMAGE_FORMATS } from './types';

/**
 * Browsers silently fall back to PNG when asked to encode an unsupported type.
 * We probe once per format so the UI can disable options that would otherwise
 * produce a misleading file.
 *
 * The probe must use the **same encoder the tool will use**: production encoding
 * happens in the worker via `OffscreenCanvas.convertToBlob`, and a browser can
 * support a type on `HTMLCanvasElement.toBlob` but not on OffscreenCanvas (Safari
 * has differed here historically). Probing the wrong one produces options that
 * look available and then fail.
 */

const cache = new Map<string, Promise<boolean>>();

async function canEncodeWithCanvas(type: string): Promise<boolean> {
  if (supportsOffscreenCanvas()) {
    try {
      const canvas = new OffscreenCanvas(2, 2);
      const blob = await canvas.convertToBlob({ type, quality: 0.85 });
      return blob.type === type;
    } catch {
      return false;
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = 2;
  return new Promise((resolve) => {
    if (typeof canvas.toBlob !== 'function') {
      resolve(false);
      return;
    }
    canvas.toBlob(
      (blob) => resolve(!!blob && blob.type === type),
      type,
      0.85,
    );
  });
}

export function canEncode(format: string): Promise<boolean> {
  if (!cache.has(format)) {
    cache.set(format, canEncodeWithCanvas(format));
  }
  return cache.get(format)!;
}

export async function supportedEncoders(): Promise<ImageFormat[]> {
  const results = await Promise.all(
    IMAGE_FORMATS.map(async (f) => ((await canEncode(f.value)) ? f.value : null)),
  );
  return results.filter((v): v is ImageFormat => v !== null);
}

export function supportsOffscreenCanvas(): boolean {
  return (
    typeof OffscreenCanvas !== 'undefined' &&
    typeof OffscreenCanvas.prototype.convertToBlob === 'function'
  );
}

export function supportsCreateImageBitmap(): boolean {
  return typeof createImageBitmap === 'function';
}

/** Decodes dimensions without keeping the bitmap alive. */
export async function probeImage(file: Blob): Promise<{ width: number; height: number } | null> {
  if (supportsCreateImageBitmap()) {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
      const size = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return size;
    } catch {
      /* fall through to <img> */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('decode failed'));
      img.src = url;
    });
    return { width: img.naturalWidth, height: img.naturalHeight };
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}
