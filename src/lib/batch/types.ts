/**
 * Batch vocabulary, shared by the orchestrator, the React layer and the tests.
 *
 * The important distinction is between an item's **state** (what happened to
 * that file) and the batch's **status** (what the queue is doing). Conflating
 * them is how batch UIs end up claiming "cancelled" for files that were never
 * started, or "done" while the current file is still encoding.
 */
import type { ToolErrorCode } from '../files/errors';

/**
 * - `pending`    queued, not started yet (also "never started" after a cancel)
 * - `processing` currently running
 * - `completed`  finished; result bytes are held
 * - `failed`     finished with a structured error
 * - `cancelled`  started, then stopped by a cancel request
 * - `released`   was completed; result bytes have been dropped, metadata kept
 */
export type BatchItemState = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'released';

/**
 * - `idle`       nothing has been run yet
 * - `running`    the queue is working through items
 * - `cancelling` a cancel was requested and the current item has not settled yet
 * - `paused`     stopped early to respect the output-byte budget
 * - `finished`   nothing left to do
 */
export type BatchStatus = 'idle' | 'running' | 'cancelling' | 'paused' | 'finished';

export type BatchStopReason = 'completed' | 'cancelled' | 'output-budget';

/** The serialisable form of a `ToolError`. */
export interface BatchItemError {
  code: ToolErrorCode;
  message: string;
  hint?: string;
}

/** What a runner returns for one item. */
export interface BatchResult {
  blob: Blob;
  /** Filename used for individual download and ZIP packaging. */
  name: string;
  width?: number;
  height?: number;
}

/** Result metadata that survives releasing the bytes. */
export interface BatchResultMeta {
  name: string;
  bytes: number;
  width?: number;
  height?: number;
}

export interface BatchItem {
  id: string;
  name: string;
  /** Declared input size, from metadata — reading is never needed to know it. */
  size: number;
  state: BatchItemState;
  /** 0–1 for the item currently processing; `null` when not measurable. */
  progress: number | null;
  error?: BatchItemError;
  /** Kept after release so totals stay truthful. */
  result?: BatchResultMeta;
  /** Absent unless held: the single strongest guarantee against silent retention. */
  blob?: Blob;
  durationMs?: number;
}

export interface BatchSummary {
  total: number;
  /** Queued and never started (or waiting for a retry). */
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  cancelled: number;
  released: number;
  /** completed + failed + cancelled + released. */
  settled: number;
  /** 0–1, counting the current item's own progress. */
  progress: number;
  inputBytes: number;
  /** Bytes held in memory by results that have not been released. */
  retainedBytes: number;
  /** Total bytes produced, including released results. */
  outputBytes: number;
}

export interface BatchSnapshot {
  items: readonly BatchItem[];
  summary: BatchSummary;
  status: BatchStatus;
  reason: BatchStopReason | null;
}

export const EMPTY_SUMMARY: BatchSummary = {
  total: 0,
  pending: 0,
  processing: 0,
  completed: 0,
  failed: 0,
  cancelled: 0,
  released: 0,
  settled: 0,
  progress: 0,
  inputBytes: 0,
  retainedBytes: 0,
  outputBytes: 0,
};
