import { useCallback, useRef, useState } from 'react';
import { createRunController } from '../lib/run/controller';

/**
 * Cancellation for tools that run one job at a time.
 *
 * PDF, ZIP and Office work all go through a worker client that accepts an
 * `AbortSignal`; without a controller the tools could show "Encrypting…" but had
 * no way to stop. A tool needs three lines: `begin()` before the call,
 * `finish()` in `finally`, `cancel()` on the button.
 *
 * `cancellable` mirrors "a job is in flight" for the UI. It is deliberately
 * separate from each tool's own `busy` flag: `busy` also covers the short
 * window before a job starts, and a Cancel button that appears for three frames
 * reads as a flicker.
 */
export function useRunControl() {
  const controller = useRef(createRunController());
  const [cancellable, setCancellable] = useState(false);

  const begin = useCallback((): AbortSignal => {
    const signal = controller.current.begin();
    setCancellable(true);
    return signal;
  }, []);

  const finish = useCallback(() => {
    controller.current.finish();
    setCancellable(false);
  }, []);

  const cancel = useCallback(() => {
    controller.current.cancel();
  }, []);

  return { begin, finish, cancel, cancellable };
}
