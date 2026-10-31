/**
 * Public image-processing API.
 *
 * Tries to run work in a dedicated worker; falls back to the main thread only
 * when OffscreenCanvas is unavailable (older Safari). Callers get the same
 * promise + stage stream either way.
 */
import { ToolError } from '../files/errors';
import { drawPlanned, planOutput, FLATTEN_BACKGROUND } from './render';
import { supportsOffscreenCanvas } from './capabilities';
import type { ImageJob, ImageJobResult, ImageWorkerResponse } from './types';
import { isLossy } from './types';

export type ImageStage = 'decode' | 'render' | 'encode';
export type StageListener = (stage: ImageStage) => void;

let worker: Worker | null = null;
let workerBroken = false;
let sequence = 0;

interface Pending {
  resolve: (result: ImageJobResult) => void;
  reject: (error: unknown) => void;
  onStage?: StageListener;
}

const pending = new Map<number, Pending>();

function getWorker(): Worker | null {
  if (workerBroken) return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./image.worker.ts', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (event: MessageEvent<ImageWorkerResponse>) => {
      const data = event.data;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'stage') {
        pending.get(data.id)?.onStage?.(data.stage);
        return;
      }
      const entry = pending.get(data.id);
      if (!entry) return;
      pending.delete(data.id);
      if (data.type === 'done') {
        entry.resolve(data.result);
      } else {
        entry.reject(new ToolError(normalizeCode(data.code), data.message));
      }
    });
    worker.addEventListener('error', (event) => {
      workerBroken = true;
      const message = event.message || 'The image worker stopped unexpectedly.';
      for (const [, entry] of pending) entry.reject(new ToolError('worker-failed', message));
      pending.clear();
      worker?.terminate();
      worker = null;
    });
  } catch {
    workerBroken = true;
    worker = null;
  }
  return worker;
}

function normalizeCode(code?: string): 'decode-failed' | 'encoding-unsupported' | 'worker-failed' | 'unknown' {
  if (code === 'decode-failed' || code === 'encoding-unsupported') return code;
  return 'unknown';
}

function nextId(): number {
  sequence = (sequence + 1) % 1_000_000;
  return sequence;
}

async function runOnMainThread(job: ImageJob, onStage?: StageListener): Promise<ImageJobResult> {
  const started = performance.now();
  onStage?.('decode');

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(job.file, {
      imageOrientation: job.autoOrient === false ? 'none' : 'from-image',
    } as ImageBitmapOptions);
  } catch {
    throw new ToolError('decode-failed', 'This file could not be decoded as an image.');
  }

  try {
    const plan = planOutput(job, bitmap.width, bitmap.height);
    onStage?.('render');
    const canvas = document.createElement('canvas');
    canvas.width = plan.width;
    canvas.height = plan.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new ToolError('unsupported-browser', 'This browser cannot create a canvas context.');
    const background = job.format === 'image/jpeg' ? (job.background ?? FLATTEN_BACKGROUND) : undefined;
    drawPlanned(ctx, bitmap, job, plan, background);

    onStage?.('encode');
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, job.format, isLossy(job.format) ? job.quality : undefined),
    );
    if (!blob) throw new ToolError('unknown', 'The browser failed to encode the image.');
    if (blob.type !== job.format) {
      throw new ToolError(
        'encoding-unsupported',
        `This browser cannot encode ${job.format}.`,
        'Choose JPEG, PNG or WebP instead.',
      );
    }

    return {
      blob,
      width: plan.width,
      height: plan.height,
      durationMs: Math.round(performance.now() - started),
      format: job.format,
    };
  } finally {
    bitmap.close();
  }
}

export async function processImage(
  input: Omit<ImageJob, 'id'>,
  onStage?: StageListener,
): Promise<ImageJobResult> {
  const job: ImageJob = { ...input, id: nextId() };
  const activeWorker = supportsOffscreenCanvas() ? getWorker() : null;

  if (!activeWorker) return runOnMainThread(job, onStage);

  return new Promise<ImageJobResult>((resolve, reject) => {
    pending.set(job.id, { resolve, reject, onStage });
    try {
      activeWorker.postMessage({ type: 'run', job });
    } catch (error) {
      pending.delete(job.id);
      reject(new ToolError('worker-failed', (error as Error).message));
    }
  });
}

/** Pre-warms the worker so the first real operation starts instantly. */
export function warmImageWorker(): void {
  if (supportsOffscreenCanvas()) getWorker();
}

export function disposeImageWorker(): void {
  worker?.terminate();
  worker = null;
}
