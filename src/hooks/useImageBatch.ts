/**
 * Image batch binding: one queue over the existing `validateImage` +
 * `processImage` primitives. No new processing code, no duplicate safety checks —
 * per-item validation throws the same `ToolError`s as the single-file tools, and
 * a rejected file fails its own item instead of the batch.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useBatchQueue } from './useBatchQueue';
import { BATCH_BUDGETS } from '../lib/files/budget';
import { ToolError, toToolError } from '../lib/files/errors';
import { outputName } from '../lib/files/format';
import { validateImage } from '../lib/image/validate';
import { processImage, type ImageStage } from '../lib/image/processor';
import type { ImageJob } from '../lib/image/types';
import { packageResults, type PackageResult } from '../lib/batch/package';
import { triggerDownload } from '../lib/files/download';

/** Stage → fraction. These are *stage weights*, not byte counts. */
const STAGE_PROGRESS: Record<ImageStage, number> = { decode: 0.3, render: 0.6, encode: 0.88 };

export interface ImageBatchSettings {
  /** Job options shared by every item; the file is supplied per item. */
  job: Omit<ImageJob, 'id' | 'file'>;
  /** Extension for the result filename. */
  extension: string;
  /** Optional suffix, e.g. "compressed". */
  suffix?: string;
  /** Archive name for "download all". */
  archiveName?: string;
}

let nextId = 0;

export function useImageBatch() {
  const settings = useRef<ImageBatchSettings | null>(null);
  const [error, setError] = useState<ToolError | null>(null);
  const [packaging, setPackaging] = useState(false);
  const [packagingRatio, setPackagingRatio] = useState(0);
  /** Lets the user stop a long archive build without touching the batch state. */
  const packagingAbort = useRef<AbortController | null>(null);

  const batch = useBatchQueue<File>({
    budget: BATCH_BUDGETS.image,
    run: async (file, context) => {
      const config = settings.current;
      if (!config) throw new Error('Batch settings were not provided.');

      context.onProgress(0.05);
      // Per-item validation: SVG/HEIC/oversized files fail alone, not the batch.
      await validateImage(file);
      if (context.signal.aborted) throw new ToolError('cancelled', 'Processing was cancelled.');

      const result = await processImage(
        { ...config.job, file },
        (stage) => context.onProgress(STAGE_PROGRESS[stage] ?? 0.5),
        { signal: context.signal },
      );

      return {
        blob: result.blob,
        name: outputName(file.name, config.extension, config.suffix),
        width: result.width,
        height: result.height,
      };
    },
  });

  const addFiles = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;
      try {
        batch.add(
          files.map((file) => ({
            id: `image-${(nextId += 1)}`,
            name: file.name,
            size: file.size,
            payload: file,
          })),
        );
        setError(null);
      } catch (err) {
        // Budget rejection happens from metadata, before any file is read.
        setError(toToolError(err));
      }
    },
    [batch],
  );

  const start = useCallback(
    async (config: ImageBatchSettings) => {
      settings.current = config;
      setError(null);
      await batch.start();
    },
    [batch],
  );

  /** Continues a paused batch with the settings it already has. */
  const resume = useCallback(() => batch.start(), [batch]);

  const downloadOne = useCallback((id: string) => {
    const item = batch.items.find((candidate) => candidate.id === id);
    if (!item?.blob) return;
    triggerDownload(item.blob, item.result?.name ?? item.name);
  }, [batch.items]);

  const packageAll = useCallback(async (): Promise<PackageResult | null> => {
    const controller = new AbortController();
    packagingAbort.current = controller;
    setPackaging(true);
    setPackagingRatio(0);
    try {
      return await packageResults(batch.items, {
        name: settings.current?.archiveName ?? 'zeroupload-batch.zip',
        onProgress: setPackagingRatio,
        signal: controller.signal,
      });
    } catch (err) {
      const toolError = toToolError(err);
      // A cancelled packaging run is not an error worth alarming the user about.
      if (toolError.code !== 'cancelled') setError(toolError);
      return null;
    } finally {
      packagingAbort.current = null;
      setPackaging(false);
      setPackagingRatio(0);
    }
  }, [batch.items]);

  const cancelPackaging = useCallback(() => {
    packagingAbort.current?.abort();
  }, []);

  // Packaging outlives a route change otherwise, and a finished archive for an
  // unmounted tool is wasted memory.
  useEffect(() => () => packagingAbort.current?.abort(), []);

  const downloadAll = useCallback(async () => {
    const packaged = await packageAll();
    if (!packaged) return;
    triggerDownload(packaged.blob, packaged.name);
    // The archive is a copy; releasing the individual results frees the originals
    // only if the user asks for it, which the panel offers explicitly.
  }, [packageAll]);

  return {
    ...batch,
    addFiles,
    start,
    resume,
    downloadOne,
    packageAll,
    downloadAll,
    packaging,
    packagingRatio,
    cancelPackaging,
    /** Ceiling on simultaneously held result bytes; the queue pauses at it. */
    outputLimit: BATCH_BUDGETS.image.maxOutputBytes,
    error,
    clearError: () => setError(null),
  };
}

export type ImageBatch = ReturnType<typeof useImageBatch>;
