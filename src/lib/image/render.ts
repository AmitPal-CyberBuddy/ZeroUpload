/**
 * Core image geometry + drawing, shared by the worker and the main-thread
 * fallback. Pure functions over a bitmap so it can be unit tested and reused.
 */
import type { ImageJob } from './types';

export interface SourceRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OutputPlan {
  source: SourceRect;
  /** Canvas width/height after scale + rotation. */
  width: number;
  height: number;
  scale: number;
}

export function clampCrop(crop: SourceRect, sourceWidth: number, sourceHeight: number): SourceRect {
  const x = Math.max(0, Math.min(Math.round(crop.x), sourceWidth - 1));
  const y = Math.max(0, Math.min(Math.round(crop.y), sourceHeight - 1));
  const width = Math.max(1, Math.min(Math.round(crop.width), sourceWidth - x));
  const height = Math.max(1, Math.min(Math.round(crop.height), sourceHeight - y));
  return { x, y, width, height };
}

export function planOutput(job: ImageJob, sourceWidth: number, sourceHeight: number): OutputPlan {
  const source = job.crop
    ? clampCrop(job.crop, sourceWidth, sourceHeight)
    : { x: 0, y: 0, width: sourceWidth, height: sourceHeight };

  if (job.stretch && job.maxWidth && job.maxHeight) {
    const rotated = job.rotate === 90 || job.rotate === 270;
    const width = Math.max(1, Math.round(job.maxWidth));
    const height = Math.max(1, Math.round(job.maxHeight));
    return {
      source,
      width: rotated ? height : width,
      height: rotated ? width : height,
      scale: width / source.width,
    };
  }

  let scale = 1;
  if (job.maxWidth || job.maxHeight) {
    const sx = job.maxWidth ? job.maxWidth / source.width : Infinity;
    const sy = job.maxHeight ? job.maxHeight / source.height : Infinity;
    scale = Math.min(sx, sy, 1);
    if (job.upscale) scale = Math.min(sx, sy);
  }

  const scaledW = Math.max(1, Math.round(source.width * scale));
  const scaledH = Math.max(1, Math.round(source.height * scale));
  const rotated = job.rotate === 90 || job.rotate === 270;

  return {
    source,
    width: rotated ? scaledH : scaledW,
    height: rotated ? scaledW : scaledH,
    scale,
  };
}

/**
 * Draws the source bitmap into a 2D context using the plan. Accepts any
 * `CanvasRenderingContext2D`-compatible context, which lets the same code run
 * against OffscreenCanvas (worker) and HTMLCanvasElement (fallback).
 */
export function drawPlanned(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  bitmap: ImageBitmap | HTMLImageElement,
  job: ImageJob,
  plan: OutputPlan,
  background?: string,
): void {
  const { source, width, height } = plan;

  ctx.save();
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);
  }

  ctx.translate(width / 2, height / 2);
  const rotate = job.rotate ?? 0;
  if (rotate) ctx.rotate((rotate * Math.PI) / 180);
  if (job.flipH || job.flipV) {
    ctx.scale(job.flipH ? -1 : 1, job.flipV ? -1 : 1);
  }

  const rotated = rotate === 90 || rotate === 270;
  const drawW = rotated ? height : width;
  const drawH = rotated ? width : height;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(
    bitmap,
    source.x,
    source.y,
    source.width,
    source.height,
    -drawW / 2,
    -drawH / 2,
    drawW,
    drawH,
  );
  ctx.restore();
}

export const FLATTEN_BACKGROUND = '#ffffff';
