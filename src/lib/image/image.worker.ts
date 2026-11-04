/// <reference lib="webworker" />
/**
 * Image worker. Decoding, scaling and encoding all happen here so the main
 * thread stays responsive during heavy operations (a 40 MP AVIF encode can block
 * for seconds).
 */
import { drawPlanned, planOutput, FLATTEN_BACKGROUND } from './render';
import type { ImageWorkerRequest, ImageWorkerResponse } from './types';
import { isLossy } from './types';

const post = (message: ImageWorkerResponse) => (self as unknown as Worker).postMessage(message);

/**
 * Jobs asked to stop. Cancellation is cooperative: a decode or an encode in
 * flight cannot be interrupted, but the remaining stages are skipped, which is
 * the difference between "stops after this step" and "runs to completion".
 */
const cancelled = new Set<number>();

const CANCELLED = 'Processing was cancelled.';

function assertActive(id: number) {
  if (cancelled.has(id)) {
    throw Object.assign(new Error(CANCELLED), { code: 'cancelled' });
  }
}

async function run(id: number, job: Extract<ImageWorkerRequest, { type: 'run' }>['job']) {
  const started = performance.now();

  post({ type: 'stage', id, stage: 'decode' });
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(job.file, {
      imageOrientation: job.autoOrient === false ? 'none' : 'from-image',
      premultiplyAlpha: 'default',
    } as ImageBitmapOptions);
  } catch (error) {
    throw Object.assign(new Error('This file could not be decoded as an image.'), { code: 'decode-failed' });
  }

  try {
    assertActive(id);
    const plan = planOutput(job, bitmap.width, bitmap.height);
    post({ type: 'stage', id, stage: 'render' });

    const canvas = new OffscreenCanvas(plan.width, plan.height);
    const ctx = canvas.getContext('2d', { alpha: job.format !== 'image/jpeg' });
    if (!ctx) throw new Error('This browser cannot create a 2D canvas context.');

    const background = job.format === 'image/jpeg' ? (job.background ?? FLATTEN_BACKGROUND) : undefined;
    drawPlanned(ctx, bitmap, job, plan, background);

    assertActive(id);
    post({ type: 'stage', id, stage: 'encode' });
    const quality = isLossy(job.format) ? Math.min(1, Math.max(0.05, job.quality)) : undefined;
    const blob = await canvas.convertToBlob({ type: job.format, quality });
    assertActive(id);

    if (blob.type !== job.format) {
      throw Object.assign(new Error(`This browser cannot encode ${job.format}.`), {
        code: 'encoding-unsupported',
      });
    }

    post({
      type: 'done',
      id,
      result: {
        blob,
        width: plan.width,
        height: plan.height,
        durationMs: Math.round(performance.now() - started),
        format: job.format,
      },
    });
  } finally {
    bitmap.close();
    cancelled.delete(id);
  }
}

self.addEventListener('message', (event: MessageEvent<ImageWorkerRequest>) => {
  const data = event.data;
  if (!data) return;
  if (data.type === 'ping') return;
  if (data.type === 'cancel') {
    cancelled.add(data.id);
    return;
  }
  if (data.type === 'run') {
    const { id } = data.job;
    run(id, data.job).catch((error: unknown) => {
      const err = error as Error & { code?: string };
      post({ type: 'error', id, message: err?.message ?? 'Image processing failed.', code: err?.code });
    });
  }
});
