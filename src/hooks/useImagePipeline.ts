import { useCallback, useEffect, useRef, useState } from 'react';
import { processImage, type ImageStage } from '../lib/image/processor';
import { validateImage, type ImageInput } from '../lib/image/validate';
import type { ImageJob, ImageJobResult } from '../lib/image/types';
import { toToolError, type ToolError } from '../lib/files/errors';

export type PipelineStage = 'reading' | ImageStage | 'done';

export interface ImagePipelineState {
  input: ImageInput | null;
  result: ImageJobResult | null;
  stage: PipelineStage | null;
  error: ToolError | null;
  busy: boolean;
}

/**
 * Shared state machine for every image tool: intake → validate → process →
 * result. Tools supply only their own options; error handling, busy state and
 * cleanup are identical across convert/compress/resize/crop/rotate.
 */
export function useImagePipeline() {
  const [input, setInput] = useState<ImageInput | null>(null);
  const [result, setResult] = useState<ImageJobResult | null>(null);
  const [stage, setStage] = useState<PipelineStage | null>(null);
  const [error, setError] = useState<ToolError | null>(null);
  const [busy, setBusy] = useState(false);
  const runId = useRef(0);

  useEffect(() => () => {
    runId.current += 1;
  }, []);

  const reset = useCallback(() => {
    runId.current += 1;
    setInput(null);
    setResult(null);
    setStage(null);
    setError(null);
    setBusy(false);
  }, []);

  const load = useCallback(
    async (file: File) => {
      const current = (runId.current += 1);
      setBusy(true);
      setError(null);
      setResult(null);
      setStage('reading');
      try {
        const validated = await validateImage(file);
        if (current !== runId.current) return;
        setInput(validated);
        setStage(null);
      } catch (err) {
        if (current !== runId.current) return;
        setInput(null);
        setError(toToolError(err));
        setStage(null);
      } finally {
        if (current === runId.current) setBusy(false);
      }
    },
    [],
  );

  const run = useCallback(
    async (options: Omit<ImageJob, 'id' | 'file'>) => {
      if (!input) return null;
      const current = (runId.current += 1);
      setBusy(true);
      setError(null);
      setStage('decode');
      try {
        const next = await processImage({ ...options, file: input.file }, (next) => {
          if (current === runId.current) setStage(next);
        });
        if (current !== runId.current) return null;
        setResult(next);
        setStage('done');
        return next;
      } catch (err) {
        if (current !== runId.current) return null;
        setError(toToolError(err));
        setStage(null);
        return null;
      } finally {
        if (current === runId.current) setBusy(false);
      }
    },
    [input],
  );

  return { input, result, stage, error, busy, load, run, reset, setError };
}

/** Stage labels for the shared timeline. */
export const STAGE_STEPS = ['Reading', 'Processing', 'Complete'] as const;

export function stageStates(stage: PipelineStage | null): ('idle' | 'active' | 'done')[] {
  if (!stage) return ['idle', 'idle', 'idle'];
  if (stage === 'done') return ['done', 'done', 'done'];
  if (stage === 'reading') return ['active', 'idle', 'idle'];
  return ['done', 'active', 'idle'];
}
