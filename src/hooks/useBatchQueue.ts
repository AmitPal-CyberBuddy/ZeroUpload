/**
 * React binding for `BatchQueue`.
 *
 * The queue owns the state; this hook only subscribes and exposes stable
 * callbacks. Snapshots are cached inside the queue, so `useSyncExternalStore`
 * gets a new object only when something actually changed.
 */
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { BatchQueue, type BatchRunContext, type BatchSource } from '../lib/batch/queue';
import type { BatchBudget } from '../lib/files/budget';
import type { BatchResult } from '../lib/batch/types';

export interface UseBatchQueueOptions<T> {
  budget: BatchBudget;
  /** Called once per item, sequentially. May change between renders. */
  run: (payload: T, context: BatchRunContext) => Promise<BatchResult>;
}

export function useBatchQueue<T>({ budget, run }: UseBatchQueueOptions<T>) {
  // Keep the latest `run` without rebuilding the queue (and losing its items).
  const runRef = useRef(run);
  runRef.current = run;

  const queueRef = useRef<BatchQueue<T> | null>(null);
  if (!queueRef.current) {
    queueRef.current = new BatchQueue<T>({
      budget,
      run: (payload, context) => runRef.current(payload, context),
    });
  }
  const queue = queueRef.current;

  const snapshot = useSyncExternalStore(
    useCallback((onChange: () => void) => queue.subscribe(onChange), [queue]),
    useCallback(() => queue.snapshot(), [queue]),
    useCallback(() => queue.snapshot(), [queue]),
  );

  useEffect(() => () => queue.dispose(), [queue]);

  const add = useCallback((sources: readonly BatchSource<T>[]) => queue.add(sources), [queue]);
  const start = useCallback(() => queue.start(), [queue]);
  const cancel = useCallback(() => queue.cancel(), [queue]);
  const retryFailed = useCallback(() => queue.retryFailed(), [queue]);
  const retryItem = useCallback((id: string) => queue.retryItem(id), [queue]);
  const release = useCallback((id: string) => queue.release(id), [queue]);
  const releaseAll = useCallback(() => queue.releaseAll(), [queue]);
  const remove = useCallback((id: string) => queue.remove(id), [queue]);
  const clear = useCallback(() => queue.clear(), [queue]);
  const retained = useCallback(() => queue.retained(), [queue]);

  return {
    queue,
    items: snapshot.items,
    summary: snapshot.summary,
    status: snapshot.status,
    reason: snapshot.reason,
    add,
    start,
    cancel,
    retryFailed,
    retryItem,
    release,
    releaseAll,
    remove,
    clear,
    retained,
  };
}
