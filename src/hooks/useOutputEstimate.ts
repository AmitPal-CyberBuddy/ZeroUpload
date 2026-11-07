import { useCallback, useEffect, useRef, useState } from 'react';
import { processImage } from '../lib/image/processor';
import type { ImageJob, ImageJobResult } from '../lib/image/types';
import type { ImageInput } from '../lib/image/validate';

/**
 * The real size of the result, before the user commits to it.
 *
 * "Estimate" is a slight lie: for images this actually *encodes* the output with
 * the current options, which is why the number it reports is the number the run
 * will produce, not a guess from a table of averages. Three things make that
 * affordable:
 *
 *  - **Debounce.** A slider dragged from 90 to 20 fires ~70 changes; only the
 *    last one is worth encoding. 400 ms after the user stops moving is the point
 *    where a value feels live but the machine is not re-encoding continuously.
 *  - **Supersession.** Every pass takes a token; a pass that finishes after a
 *    newer one started throws its result away. The worker is single-job, so this
 *    also means stale work cannot starve the thing the user is looking at.
 *  - **A pixel budget.** Above `AUTO_LIMIT_PIXELS` the panel stops measuring on
 *    its own and offers a button instead. Encoding a 50-megapixel photo on every
 *    slider tick would turn a helpful preview into a hot fan.
 *
 * The hook never touches the pipeline's own state: the tool's `result` stays the
 * committed output, and an estimate is only ever a preview of it.
 */

/** Above this, measure only when asked. ~24 MP is a full-frame camera photo. */
export const AUTO_LIMIT_PIXELS = 24_000_000;

/** Long enough that a dragged slider settles, short enough to feel immediate. */
const DEBOUNCE_MS = 400;

type Options = Omit<ImageJob, 'id' | 'file'>;

export interface OutputEstimate {
  /** Measured result for the current options, if one has completed. */
  estimate: ImageJobResult | null;
  /** True while a pass is in flight for the current options. */
  measuring: boolean;
  /** True when the source is too large to measure automatically. */
  needsManual: boolean;
  /** True when the panel's number is for options older than the current ones. */
  stale: boolean;
  /** Run a pass now, ignoring the pixel budget. */
  measure: () => void;
}

export function useOutputEstimate(
  input: ImageInput | null,
  options: Options | null,
  { enabled = true }: { enabled?: boolean } = {},
): OutputEstimate {
  const [estimate, setEstimate] = useState<ImageJobResult | null>(null);
  const [measuring, setMeasuring] = useState(false);
  const [stale, setStale] = useState(false);
  const [manual, setManual] = useState(false);

  const token = useRef(0);
  const interval = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pixels = input ? input.width * input.height : 0;
  const needsManual = pixels > AUTO_LIMIT_PIXELS && !manual;

  // A different file invalidates everything, including a manual override.
  const fileKey = input ? `${input.file.name}:${input.file.size}:${input.file.lastModified}` : null;
  useEffect(() => {
    token.current += 1;
    setEstimate(null);
    setStale(false);
    setMeasuring(false);
    setManual(false);
  }, [fileKey]);

  /*
   * The trigger is the *serialised* options, not the object. Tools rebuild their
   * job literal on every render, so depending on the object would restart the
   * debounce on each keystroke elsewhere in the panel and the estimate would never
   * fire. The latest options ride along in a ref for the callback to read.
   */
  const signature = options ? JSON.stringify(options) : null;
  const latest = useRef(options);
  latest.current = options;

  useEffect(() => {
    if (interval.current) clearTimeout(interval.current);

    if (!input || !signature || !enabled || needsManual) {
      setMeasuring(false);
      return;
    }

    setStale(true);
    const timer = setTimeout(async () => {
      const current = (token.current += 1);
      setMeasuring(true);
      try {
        const runOptions = latest.current;
        if (!runOptions) return;
        const result = await processImage({ ...runOptions, file: input.file });
        if (current !== token.current) return;
        setEstimate(result);
        setStale(false);
      } catch {
        // A preview that fails is not an error the user needs: the real run
        // reports failures through the tool's own error path.
        if (current === token.current) setStale(false);
      } finally {
        if (current === token.current) setMeasuring(false);
      }
    }, DEBOUNCE_MS);

    interval.current = timer;
    return () => clearTimeout(timer);
  }, [enabled, input, needsManual, signature]);

  useEffect(
    () => () => {
      token.current += 1;
      if (interval.current) clearTimeout(interval.current);
    },
    [],
  );

  const measure = useCallback(() => setManual(true), []);

  return { estimate, measuring, needsManual, stale, measure };
}

/** Exported for tests: the debounce is part of the contract, not an accident. */
export const ESTIMATE_DEBOUNCE_MS = DEBOUNCE_MS;
