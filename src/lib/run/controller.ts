/**
 * One-controller-at-a-time cancellation, with no React in it.
 *
 * Every tool runs at most one job, so the rule is simple: beginning a run
 * replaces (and aborts) whatever was in flight, cancelling aborts the current
 * run, and finishing forgets it. Keeping the state machine here makes it
 * testable without a DOM, and keeps `useRunControl` down to a `useRef` plus a
 * boolean for the button.
 */
export interface RunController {
  /** Start a run. Any previous run is aborted first. Returns the new signal. */
  begin: () => AbortSignal;
  /** Abort the current run, if any. Idempotent. */
  cancel: () => void;
  /** Forget the current run. The signal is left as-is. */
  finish: () => void;
  /** Whether a run is in flight and not yet aborted. */
  isActive: () => boolean;
}

export function createRunController(): RunController {
  let current: AbortController | null = null;

  return {
    begin() {
      current?.abort();
      current = new AbortController();
      return current.signal;
    },
    cancel() {
      current?.abort();
    },
    finish() {
      current = null;
    },
    isActive() {
      return current !== null && !current.signal.aborted;
    },
  };
}
