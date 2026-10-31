/** Shared image-processing contract between the UI, the client and the worker. */

export type ImageFormat = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/avif';

export interface ImageJob {
  id: number;
  file: Blob;
  format: ImageFormat;
  /** 0–1. Ignored by PNG (lossless). */
  quality: number;
  /** Downscale so the longest/edges fit. Never upscales unless `upscale` is set. */
  maxWidth?: number;
  maxHeight?: number;
  upscale?: boolean;
  /** Stretch to exactly maxWidth × maxHeight (breaks aspect ratio deliberately). */
  stretch?: boolean;
  /** Crop rectangle in source pixels, applied before scaling. */
  crop?: { x: number; y: number; width: number; height: number };
  rotate?: 0 | 90 | 180 | 270;
  flipH?: boolean;
  flipV?: boolean;
  /** Background colour used when flattening transparency for JPEG. */
  background?: string;
  /** Preserve EXIF orientation on decode (default true). */
  autoOrient?: boolean;
}

export interface ImageJobResult {
  blob: Blob;
  width: number;
  height: number;
  durationMs: number;
  format: string;
}

export type ImageWorkerRequest = { type: 'run'; job: ImageJob } | { type: 'ping' };

export type ImageWorkerResponse =
  | { type: 'stage'; id: number; stage: 'decode' | 'render' | 'encode' }
  | { type: 'done'; id: number; result: ImageJobResult }
  | { type: 'error'; id: number; message: string; code?: string };

export const IMAGE_FORMATS: { value: ImageFormat; label: string; ext: string; lossy: boolean }[] = [
  { value: 'image/jpeg', label: 'JPEG', ext: 'jpg', lossy: true },
  { value: 'image/png', label: 'PNG', ext: 'png', lossy: false },
  { value: 'image/webp', label: 'WebP', ext: 'webp', lossy: true },
  { value: 'image/avif', label: 'AVIF', ext: 'avif', lossy: true },
];

export function extensionForFormat(format: string): string {
  return IMAGE_FORMATS.find((f) => f.value === format)?.ext ?? 'img';
}

export function isLossy(format: string): boolean {
  return IMAGE_FORMATS.find((f) => f.value === format)?.lossy ?? true;
}
