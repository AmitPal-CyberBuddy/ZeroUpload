import { describe, expect, it } from 'vitest';
import { BatchQueue, type BatchRunContext } from '../src/lib/batch/queue';
import { BATCH_BUDGETS, type BatchBudget } from '../src/lib/files/budget';
import { ToolError } from '../src/lib/files/errors';
import { MB, blobOf } from './helpers';

/**
 * The queue ships with `concurrency: 1`. These tests exist because the option
 * exists at all: if a measurement ever justifies two lanes, the semantics below
 * are what "correct" has to mean, and they must not regress silently in the
 * meantime.
 */

interface Payload {
  bytes?: number;
  fail?: boolean;
  /** Resolves only when the test releases it. */
  gate?: Gate;
  progress?: number[];
}

interface Gate {
  resolve: () => void;
  promise: Promise<void>;
}

function gate(): Gate {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { resolve, promise };
}

const wait = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

interface Harness {
  queue: BatchQueue<Payload>;
  /** Order in which items started. */
  started: string[];
  /** Highest number of items that were in flight simultaneously. */
  peakInFlight: number;
  inFlight: () => number;
}

function makeQueue(
  entries: { name: string; size: number; payload?: Payload }[],
  options: { concurrency?: number; budget?: BatchBudget } = {},
): Harness {
  const started: string[] = [];
  let inFlight = 0;
  let peakInFlight = 0;

  const queue = new BatchQueue<Payload>({
    budget: options.budget ?? BATCH_BUDGETS.image,
    progressIntervalMs: 0,
    concurrency: options.concurrency,
    run: async (payload: Payload, context: BatchRunContext) => {
      started.push(context.signal.aborted ? 'aborted' : String((payload as Payload & { id?: string }).id ?? 'item'));
      inFlight += 1;
      peakInFlight = Math.max(peakInFlight, inFlight);
      try {
        for (const ratio of payload.progress ?? []) context.onProgress(ratio);
        if (payload.gate) await payload.gate.promise;
        else await wait(3);
        if (payload.fail) throw new ToolError('decode-failed', 'This image could not be decoded.');
        return { blob: blobOf(new Uint8Array(payload.bytes ?? 16)), name: 'out.bin' };
      } finally {
        inFlight -= 1;
      }
    },
  });

  if (entries.length > 0) {
    queue.add(
      entries.map((entry) => ({
        name: entry.name,
        size: entry.size,
        payload: { ...entry.payload, id: entry.name } as Payload,
      })),
    );
  }

  // Getters, not values: `peakInFlight` is only known after the run.
  return {
    queue,
    started,
    get peakInFlight() {
      return peakInFlight;
    },
    inFlight: () => inFlight,
  };
}

describe('queue concurrency', () => {
  it('defaults to one lane', () => {
    const { queue } = makeQueue([]);
    expect(queue.concurrency).toBe(1);
  });

  it('clamps out-of-range settings instead of trusting them', () => {
    expect(makeQueue([], { concurrency: 0 }).queue.concurrency).toBe(1);
    expect(makeQueue([], { concurrency: -3 }).queue.concurrency).toBe(1);
    expect(makeQueue([], { concurrency: 2.7 }).queue.concurrency).toBe(2);
    expect(makeQueue([], { concurrency: 99 }).queue.concurrency).toBe(4);
  });

  it('never overlaps items at concurrency 1', async () => {
    const harness = makeQueue(Array.from({ length: 6 }, (_, index) => ({ name: `f${index}`, size: 10 })));
    await harness.queue.start();
    expect(harness.peakInFlight).toBe(1);
    expect(harness.queue.snapshot().summary.completed).toBe(6);
  });

  it('runs two items at once at concurrency 2', async () => {
    const harness = makeQueue(
      Array.from({ length: 6 }, (_, index) => ({ name: `f${index}`, size: 10 })),
      { concurrency: 2 },
    );
    await harness.queue.start();
    expect(harness.peakInFlight).toBe(2);
    expect(harness.queue.snapshot().summary.completed).toBe(6);
  });

  it('does not open more lanes than there are items', async () => {
    const harness = makeQueue([{ name: 'only', size: 10 }], { concurrency: 4 });
    await harness.queue.start();
    expect(harness.peakInFlight).toBe(1);
  });

  it('processes every item exactly once and starts them in queue order', async () => {
    const names = ['a', 'b', 'c', 'd', 'e'];
    const harness = makeQueue(
      names.map((name) => ({ name, size: 10 })),
      { concurrency: 2 },
    );
    await harness.queue.start();
    expect(harness.started).toEqual(names);
    const snapshot = harness.queue.snapshot();
    expect(snapshot.items.map((item) => item.state)).toEqual(names.map(() => 'completed'));
    expect(snapshot.summary.total).toBe(names.length);
  });

  it('keeps aggregate progress monotonic across two lanes', async () => {
    const harness = makeQueue(
      Array.from({ length: 8 }, (_, index) => ({
        name: `f${index}`,
        size: 10,
        payload: { progress: [0.25, 0.5, 1] },
      })),
      { concurrency: 2 },
    );

    const seen: number[] = [];
    harness.queue.subscribe(() => {
      if (harness.queue.isActive) seen.push(harness.queue.snapshot().summary.progress);
    });

    await harness.queue.start();
    for (let index = 1; index < seen.length; index += 1) {
      expect(seen[index]).toBeGreaterThanOrEqual(seen[index - 1] - 1e-9);
    }
    expect(harness.queue.snapshot().summary.progress).toBe(1);
  });

  it('isolates a failure from the other lane', async () => {
    const harness = makeQueue(
      [
        { name: 'ok-1', size: 10 },
        { name: 'bad', size: 10, payload: { fail: true } },
        { name: 'ok-2', size: 10 },
        { name: 'ok-3', size: 10 },
      ],
      { concurrency: 2 },
    );
    await harness.queue.start();
    const summary = harness.queue.snapshot().summary;
    expect(summary.failed).toBe(1);
    expect(summary.completed).toBe(3);
    expect(harness.queue.snapshot().status).toBe('finished');
  });

  it('stops both lanes on cancel and leaves the rest pending', async () => {
    const held = gate();
    const harness = makeQueue(
      [
        { name: 'a', size: 10, payload: { gate: held } },
        { name: 'b', size: 10, payload: { gate: held } },
        { name: 'c', size: 10 },
        { name: 'd', size: 10 },
      ],
      { concurrency: 2 },
    );

    const running = harness.queue.start();
    await wait(10);
    expect(harness.inFlight()).toBe(2);

    harness.queue.cancel();
    expect(harness.queue.snapshot().status).toBe('cancelling');
    held.resolve();
    await running;

    const snapshot = harness.queue.snapshot();
    // The runner here ignores the signal, so both in-flight items finish; the
    // point is that no third item starts and the queue stops.
    expect(harness.started).toEqual(['a', 'b']);
    expect(snapshot.status).toBe('finished');
    expect(snapshot.reason).toBe('cancelled');
    expect(snapshot.summary.pending).toBe(2);
  });

  it('marks in-flight items cancelled when the runner honours the signal', async () => {
    const queue = new BatchQueue<{ id: string }>({
      budget: BATCH_BUDGETS.image,
      progressIntervalMs: 0,
      concurrency: 2,
      run: (payload, context) =>
        new Promise((_resolve, reject) => {
          if (payload.id === 'c' || payload.id === 'd') {
            _resolve({ blob: blobOf(new Uint8Array(8)), name: 'out.bin' });
            return;
          }
          context.signal.addEventListener('abort', () =>
            reject(new ToolError('cancelled', 'Processing was cancelled.')),
          );
        }),
    });
    queue.add(['a', 'b', 'c', 'd'].map((id) => ({ name: id, size: 10, payload: { id } })));

    const running = queue.start();
    await wait(10);
    queue.cancel();
    await running;

    const states = queue.snapshot().items.map((item) => item.state);
    expect(states).toEqual(['cancelled', 'cancelled', 'pending', 'pending']);
    expect(queue.snapshot().reason).toBe('cancelled');
  });

  it('pauses at the output ceiling and reports how far it got', async () => {
    const budget: BatchBudget = { ...BATCH_BUDGETS.image, maxOutputBytes: 3 * MB };
    const harness = makeQueue(
      Array.from({ length: 10 }, (_, index) => ({ name: `f${index}`, size: 10, payload: { bytes: MB } })),
      { concurrency: 2, budget },
    );
    await harness.queue.start();

    const snapshot = harness.queue.snapshot();
    expect(snapshot.status).toBe('paused');
    expect(snapshot.reason).toBe('output-budget');
    // The ceiling is checked before each item, so the overshoot is bounded by the
    // items already in flight — at most one extra at concurrency 2.
    expect(snapshot.summary.retainedBytes).toBeGreaterThanOrEqual(3 * MB);
    expect(snapshot.summary.retainedBytes).toBeLessThanOrEqual(4 * MB);
    expect(snapshot.summary.pending).toBeGreaterThan(0);
  });

  it('still rejects an over-budget batch from metadata alone', () => {
    const queue = new BatchQueue<null>({
      budget: { ...BATCH_BUDGETS.image, maxItems: 2 },
      concurrency: 4,
      run: async () => ({ blob: blobOf(new Uint8Array(4)), name: 'x' }),
    });
    expect(() =>
      queue.add([
        { name: 'a', size: 1, payload: null },
        { name: 'b', size: 1, payload: null },
        { name: 'c', size: 1, payload: null },
      ]),
    ).toThrow(expect.objectContaining({ code: 'limit-exceeded' }));
    expect(queue.snapshot().items).toHaveLength(0);
  });

  it('can continue a paused queue with the same lane count', async () => {
    const budget: BatchBudget = { ...BATCH_BUDGETS.image, maxOutputBytes: 2 * MB };
    const harness = makeQueue(
      Array.from({ length: 6 }, (_, index) => ({ name: `f${index}`, size: 10, payload: { bytes: MB } })),
      { concurrency: 2, budget },
    );
    await harness.queue.start();
    expect(harness.queue.snapshot().status).toBe('paused');

    harness.queue.releaseAll();
    await harness.queue.start();
    const snapshot = harness.queue.snapshot();
    expect(snapshot.status).toBe('finished');
    expect(snapshot.summary.completed + snapshot.summary.released).toBe(6);
  });
});
