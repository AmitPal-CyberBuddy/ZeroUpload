/**
 * Batch orchestration.
 *
 * Deliberately small: a sequential queue over one `run` callback, with explicit
 * item states, explicit budgets, real progress and honest cancellation. It is
 * framework-free so the behaviour can be tested without a DOM, and it is the
 * only place that knows about ordering, retention and stopping conditions.
 *
 * Design choices worth stating:
 *
 *  - **Concurrency is a setting, and the product ships it at 1.** Decode buffers
 *    are large and every worker operation already holds a full-resolution bitmap,
 *    so a second lane costs one to two extra bitmaps (measured: see
 *    `docs/batch-processing.md` §10). The lane loop exists so that decision can be
 *    changed from configuration once a browser measurement justifies it — it is
 *    not a worker pool, and there is no queue of hand-offs to tune.
 *  - **A failed item does not stop the batch.** The error is recorded on the item
 *    and the loop moves on; only cancellation and the output budget stop it.
 *  - **Results are released, not garbage-collected by hope.** A completed item
 *    holds its `Blob` until `release`/`releaseAll`/`remove`; releasing keeps the
 *    metadata so counts and totals stay truthful.
 *  - **Progress is coalesced.** One notification per `progressIntervalMs` for
 *    progress, immediate for state changes, so a 50-file batch cannot cause 50
 *    renders per stage.
 */
import { ToolError, toToolError } from '../files/errors';
import { assertCumulativeBudget, type BatchBudget } from '../files/budget';
import {
  EMPTY_SUMMARY,
  type BatchItem,
  type BatchResult,
  type BatchSnapshot,
  type BatchStatus,
  type BatchStopReason,
  type BatchSummary,
} from './types';

export interface BatchRunContext {
  /** Aborted by `cancel()`. Cooperative cancellation is up to the runner. */
  signal: AbortSignal;
  /** 0–1 for the current item. Ignored after the item settles. */
  onProgress: (ratio: number) => void;
}

export interface BatchSource<T> {
  /** Stable id; generated when omitted. */
  id?: string;
  name: string;
  /** Declared size from metadata. Never read to decide anything. */
  size: number;
  payload: T;
}

export interface BatchQueueOptions<T> {
  budget: BatchBudget;
  run: (payload: T, context: BatchRunContext) => Promise<BatchResult>;
  /** Default 60 ms — the same coalescing window the PDF client uses. */
  progressIntervalMs?: number;
  /**
   * Items in flight at once. Default 1; anything above that is opt-in and costs
   * one to two extra decoded bitmaps. Clamped to 1–4 so a typo cannot turn the
   * tab into a thread pool.
   */
  concurrency?: number;
}

/**
 * What the product ships, in one place so the decision is visible.
 *
 * Batch runs one item at a time. A real-codec measurement (`docs/measurement.md`)
 * shows a second lane buys 1.5–1.9× wall time on a desktop and costs one to two
 * extra full-resolution bitmaps — 7 MB at 2 MP, up to 70 MB at 12 MP. That is a
 * trade to be made on a browser measurement, not in advance, so the value stays 1
 * until `scripts/measure` has been run on real hardware.
 */
export const DEFAULT_BATCH_CONCURRENCY = 1;

const clamp01 = (value: number) => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0);

export class BatchQueue<T> {
  private readonly budget: BatchBudget;
  private readonly run: (payload: T, context: BatchRunContext) => Promise<BatchResult>;
  private readonly progressIntervalMs: number;
  readonly concurrency: number;

  private items: BatchItem[] = [];
  private payloads = new Map<string, T>();
  private status: BatchStatus = 'idle';
  private reason: BatchStopReason | null = null;
  private controller: AbortController | null = null;
  private cancelRequested = false;
  private active = false;

  private retainedBytes = 0;
  private outputBytes = 0;

  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private cache: BatchSnapshot | null = null;
  private sequence = 0;

  constructor(options: BatchQueueOptions<T>) {
    this.budget = options.budget;
    this.run = options.run;
    this.progressIntervalMs = options.progressIntervalMs ?? 60;
    this.concurrency = Math.max(1, Math.min(4, Math.floor(options.concurrency ?? 1)));
  }

  /* ------------------------------------------------------------------ input */

  /**
   * Queues inputs. Throws a `ToolError` when the batch budget would be exceeded —
   * from declared sizes only, so a rejected batch never reads a byte.
   */
  add(sources: readonly BatchSource<T>[]): void {
    if (this.active) {
      throw new ToolError('invalid-input', 'Wait for the current batch to finish before adding files.');
    }
    if (sources.length === 0) {
      throw new ToolError('empty-input', 'Add at least one file.');
    }

    assertCumulativeBudget(
      [
        ...this.items.map((item) => ({ name: item.name, size: item.size })),
        ...sources.map((source) => ({ name: source.name, size: source.size })),
      ],
      this.budget,
    );

    for (const source of sources) {
      this.sequence += 1;
      const id = source.id ?? `item-${this.sequence}`;
      this.items.push({ id, name: source.name, size: source.size, state: 'pending', progress: null });
      this.payloads.set(id, source.payload);
    }

    // Adding to a finished/paused queue re-arms it, so the run button works again.
    if ((this.status === 'finished' || this.status === 'paused') && this.items.some((item) => item.state === 'pending')) {
      this.status = 'idle';
      this.reason = null;
    }
    this.emitNow();
  }

  /** Drops an item that is not currently processing. */
  remove(id: string): boolean {
    const index = this.items.findIndex((item) => item.id === id);
    if (index === -1) return false;
    const item = this.items[index];
    if (item.state === 'processing') return false;
    if (item.state === 'completed' && item.blob) this.retainedBytes -= item.blob.size;
    this.items.splice(index, 1);
    this.payloads.delete(id);
    this.emitNow();
    return true;
  }

  /** Empties the queue. Only allowed when nothing is running. */
  clear(): void {
    if (this.active) return;
    this.items = [];
    this.payloads.clear();
    this.retainedBytes = 0;
    this.outputBytes = 0;
    this.status = 'idle';
    this.reason = null;
    this.emitNow();
  }

  /* -------------------------------------------------------------------- run */

  /** Runs every pending item. Re-callable: use it to continue after a pause. */
  async start(): Promise<void> {
    if (this.active) return;
    if (!this.items.some((item) => item.state === 'pending')) {
      this.status = this.items.length === 0 ? 'idle' : 'finished';
      this.reason = this.items.length === 0 ? null : (this.reason ?? 'completed');
      this.emitNow();
      return;
    }

    this.active = true;
    this.cancelRequested = false;
    this.status = 'running';
    this.reason = null;
    this.controller = new AbortController();
    const signal = this.controller.signal;
    this.emitNow();

    const pendingCount = this.items.filter((item) => item.state === 'pending').length;
    const lanes = Math.max(1, Math.min(this.concurrency, pendingCount));
    let budgetHit = false;

    /**
     * One lane pulls the next pending item until the queue is empty, a stop is
     * requested, or the output ceiling is reached. With one lane this is exactly
     * the sequential loop it replaced; with more, item *start* order stays the
     * queue order and completion order is whatever the runtime does.
     */
    const lane = async (): Promise<void> => {
      for (;;) {
        if (this.cancelRequested) return;
        const item = this.items.find((candidate) => candidate.state === 'pending');
        if (!item) return;
        // Stop *before* the next item, not after it: the result that crossed the
        // line is kept, and nothing further is allocated. With more than one lane
        // the ceiling can be over-shot by the items already in flight, which is
        // bounded by (lanes - 1) and reported honestly below.
        if (this.retainedBytes >= this.budget.maxOutputBytes) {
          budgetHit = true;
          return;
        }
        await this.runItem(item, signal);
      }
    };

    try {
      await Promise.all(Array.from({ length: lanes }, lane));
      this.reason = this.cancelRequested ? 'cancelled' : budgetHit ? 'output-budget' : 'completed';
    } finally {
      this.active = false;
      this.controller = null;
      this.cancelRequested = false;
      const remaining = this.items.some((item) => item.state === 'pending');
      this.status = this.reason === 'output-budget' && remaining ? 'paused' : 'finished';
      this.emitNow();
    }
  }

  /**
   * Requests a stop. Returns immediately: `status` becomes `cancelling` while the
   * current item is still running, which is what the UI must say out loud.
   * Calling it when nothing is running does nothing at all.
   */
  cancel(): void {
    if (!this.active) return;
    this.cancelRequested = true;
    this.status = 'cancelling';
    this.controller?.abort();
    this.emitNow();
  }

  /** Re-queues failed and cancelled items. Successful items are untouched. */
  retryFailed(): number {
    if (this.active) return 0;
    let count = 0;
    for (const item of this.items) {
      if (item.state === 'failed' || item.state === 'cancelled') {
        item.state = 'pending';
        item.error = undefined;
        item.progress = null;
        item.durationMs = undefined;
        count += 1;
      }
    }
    if (count > 0) {
      this.reason = null;
      if (this.status === 'finished' || this.status === 'paused') this.status = 'idle';
      this.emitNow();
    }
    return count;
  }

  retryItem(id: string): boolean {
    if (this.active) return false;
    const item = this.items.find((candidate) => candidate.id === id);
    if (!item || (item.state !== 'failed' && item.state !== 'cancelled')) return false;
    item.state = 'pending';
    item.error = undefined;
    item.progress = null;
    item.durationMs = undefined;
    if (this.status === 'finished' || this.status === 'paused') this.status = 'idle';
    this.emitNow();
    return true;
  }

  /* --------------------------------------------------------------- retention */

  /** Drops the bytes of one completed result, keeping its metadata. */
  release(id: string): boolean {
    const item = this.items.find((candidate) => candidate.id === id);
    if (!item || item.state !== 'completed' || !item.blob) return false;
    this.retainedBytes -= item.blob.size;
    item.blob = undefined;
    item.state = 'released';
    item.progress = null;
    this.emitNow();
    return true;
  }

  releaseAll(): number {
    let count = 0;
    for (const item of this.items) {
      if (item.state === 'completed' && item.blob) {
        this.retainedBytes -= item.blob.size;
        item.blob = undefined;
        item.state = 'released';
        item.progress = null;
        count += 1;
      }
    }
    if (count > 0) this.emitNow();
    return count;
  }

  /** Completed results that still hold bytes, in queue order. */
  retained(): { id: string; name: string; blob: Blob }[] {
    return this.items
      .filter((item): item is BatchItem & { blob: Blob } => item.state === 'completed' && !!item.blob)
      .map((item) => ({ id: item.id, name: item.result?.name ?? item.name, blob: item.blob }));
  }

  /* ------------------------------------------------------------- observation */

  get isActive(): boolean {
    return this.active;
  }

  snapshot(): BatchSnapshot {
    if (!this.cache) {
      const items = this.items.map((item) => ({ ...item }));
      this.cache = {
        items,
        summary: this.summarise(items),
        status: this.status,
        reason: this.reason,
      };
    }
    return this.cache;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Aborts in-flight work and drops listeners. Called on unmount. */
  dispose(): void {
    this.controller?.abort();
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.listeners.clear();
  }

  /* --------------------------------------------------------------- internals */

  private async runItem(item: BatchItem, signal: AbortSignal): Promise<void> {
    const payload = this.payloads.get(item.id) as T;
    const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();

    item.state = 'processing';
    item.progress = 0;
    this.emitNow();

    try {
      const result = await this.run(payload, {
        signal,
        onProgress: (ratio) => {
          // Ignore late events from a superseded run.
          if (item.state !== 'processing') return;
          item.progress = clamp01(ratio);
          this.emitSoon();
        },
      });

      item.blob = result.blob;
      item.result = {
        name: result.name,
        bytes: result.blob.size,
        width: result.width,
        height: result.height,
      };
      item.state = 'completed';
      item.progress = 1;
      this.retainedBytes += result.blob.size;
      this.outputBytes += result.blob.size;
    } catch (error) {
      const toolError = toToolError(error);
      item.progress = null;
      item.state = toolError.code === 'cancelled' ? 'cancelled' : 'failed';
      item.error = { code: toolError.code, message: toolError.message, hint: toolError.hint };
    } finally {
      const endedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
      item.durationMs = Math.round(endedAt - startedAt);
      this.emitNow();
    }
  }

  private summarise(items: readonly BatchItem[]): BatchSummary {
    if (items.length === 0) return { ...EMPTY_SUMMARY };

    let pending = 0;
    let processing = 0;
    let completed = 0;
    let failed = 0;
    let cancelled = 0;
    let released = 0;
    let inputBytes = 0;
    let retainedBytes = 0;
    let outputBytes = 0;
    let partial = 0;

    for (const item of items) {
      inputBytes += item.size;
      switch (item.state) {
        case 'pending':
          pending += 1;
          break;
        case 'processing':
          processing += 1;
          partial += item.progress ?? 0;
          break;
        case 'completed':
          completed += 1;
          break;
        case 'failed':
          failed += 1;
          break;
        case 'cancelled':
          cancelled += 1;
          break;
        case 'released':
          released += 1;
          break;
      }
      if (item.state === 'completed' && item.blob) retainedBytes += item.blob.size;
      if (item.result) outputBytes += item.result.bytes;
    }

    const settled = completed + failed + cancelled + released;
    return {
      total: items.length,
      pending,
      processing,
      completed,
      failed,
      cancelled,
      released,
      settled,
      progress: Math.min(1, (settled + partial) / items.length),
      inputBytes,
      retainedBytes,
      outputBytes,
    };
  }

  private emitNow(): void {
    this.cache = null;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    for (const listener of this.listeners) listener();
  }

  private emitSoon(): void {
    this.cache = null;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      for (const listener of this.listeners) listener();
    }, this.progressIntervalMs);
  }
}
