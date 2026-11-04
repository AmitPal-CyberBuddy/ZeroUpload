import { describe, expect, it } from 'vitest';
import { BatchQueue, type BatchRunContext } from '../src/lib/batch/queue';
import { packageResults } from '../src/lib/batch/package';
import { BATCH_BUDGETS, type BatchBudget } from '../src/lib/files/budget';
import { ToolError } from '../src/lib/files/errors';
import { readZip } from '../src/lib/zip/zip';
import { MB, blobOf } from './helpers';

interface Payload {
  /** Result bytes. */
  bytes?: number;
  /** Download name for the produced result. */
  outName?: string;
  fail?: boolean;
  /** Blocks until cancelled — once only, so a retry can succeed. */
  hang?: boolean;
  progress?: number;
}

interface Harness {
  queue: BatchQueue<Payload>;
  runs: string[];
  budget: BatchBudget;
}

function makeQueue(
  entries: { name: string; size: number; payload?: Payload }[],
  options: { budget?: BatchBudget; bytes?: (payload: Payload) => number } = {},
): Harness {
  const runs: string[] = [];
  const budget = options.budget ?? BATCH_BUDGETS.image;
  const alreadyHung = new Set<Payload>();

  const queue = new BatchQueue<Payload>({
    budget,
    progressIntervalMs: 0,
    run: (payload, context) =>
      new Promise((resolve, reject) => {
        runs.push(context.signal.aborted ? 'aborted-before-run' : 'run');

        const settle = () => {
          if (payload.fail) {
            reject(new ToolError('decode-failed', 'This image could not be decoded.', 'Try another file.'));
            return;
          }
          const size = payload.bytes ?? options.bytes?.(payload) ?? 10;
          resolve({ blob: blobOf(new Uint8Array(size)), name: payload.outName ?? 'out.bin' });
        };

        if (payload.progress && !context.signal.aborted) context.onProgress(payload.progress);

        if (payload.hang && !alreadyHung.has(payload)) {
          alreadyHung.add(payload);
          context.signal.addEventListener('abort', () =>
            reject(new ToolError('cancelled', 'Processing was cancelled.')),
          );
          return;
        }

        if (context.signal.aborted) {
          reject(new ToolError('cancelled', 'Processing was cancelled.'));
          return;
        }
        settle();
      }),
  });

  if (entries.length > 0) {
    queue.add(entries.map((entry) => ({ name: entry.name, size: entry.size, payload: entry.payload ?? {} })));
  }
  return { queue, runs, budget };
}

const wait = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

describe('batch budgets', () => {
  it('rejects an empty batch', () => {
    const { queue } = makeQueue([]);
    expect(() => queue.add([])).toThrow(/at least one file/i);
  });

  it('rejects a batch over the item count without starting anything', () => {
    const budget = BATCH_BUDGETS.image;
    const { queue, runs } = makeQueue([]);
    const tooMany = Array.from({ length: budget.maxItems + 1 }, (_, index) => ({
      name: `f${index}.jpg`,
      size: 1024,
      payload: {},
    }));
    expect(() => queue.add(tooMany)).toThrow(/at most 50 images/);
    expect(queue.snapshot().items).toHaveLength(0);
    expect(runs).toHaveLength(0);
  });

  it('rejects a batch over the byte budget', () => {
    const { queue } = makeQueue([{ name: 'a.jpg', size: 150 * MB }]);
    expect(queue.snapshot().items).toHaveLength(1);
    // 150 MB + 200 MB crosses the 300 MB cumulative ceiling.
    expect(() => queue.add([{ name: 'b.jpg', size: 200 * MB, payload: {} }])).toThrow(/together/);
    expect(queue.snapshot().items).toHaveLength(1);
  });

  it('decides from metadata alone — a rejected batch never reads a payload', () => {
    let reads = 0;
    const payload = {
      get bytes() {
        reads += 1;
        return 1024;
      },
    };
    const queue = new BatchQueue<typeof payload>({
      budget: BATCH_BUDGETS.image,
      run: async () => {
        reads += 1;
        return { blob: blobOf(new Uint8Array(4)), name: 'x' };
      },
    });
    expect(() =>
      queue.add([
        { name: 'a.jpg', size: 200 * MB, payload },
        { name: 'b.jpg', size: 200 * MB, payload },
      ]),
    ).toThrow(/together/);
    expect(reads).toBe(0);
  });

  it('adds to an existing batch until the budget is exhausted', () => {
    const { queue } = makeQueue([{ name: 'a.jpg', size: 100 * MB }]);
    queue.add([{ name: 'b.jpg', size: 100 * MB, payload: {} }]);
    expect(queue.snapshot().items).toHaveLength(2);
    expect(() => queue.add([{ name: 'c.jpg', size: 200 * MB, payload: {} }])).toThrow(/together/);
    expect(queue.snapshot().items).toHaveLength(2);
  });
});

describe('lifecycle', () => {
  it('does nothing when started with no items', async () => {
    const { queue, runs } = makeQueue([]);
    await queue.start();
    expect(runs).toHaveLength(0);
    expect(queue.snapshot().status).toBe('idle');
  });

  it('runs a single-item batch and retains its result', async () => {
    const { queue, runs } = makeQueue([{ name: 'one.jpg', size: 2048, payload: { bytes: 512 } }]);
    await queue.start();

    const { items, summary, status, reason } = queue.snapshot();
    expect(runs).toHaveLength(1);
    expect(items[0].state).toBe('completed');
    expect(items[0].progress).toBe(1);
    expect(items[0].blob?.size).toBe(512);
    expect(items[0].result).toMatchObject({ bytes: 512, name: 'out.bin' });
    expect(summary).toMatchObject({ total: 1, completed: 1, settled: 1, progress: 1, retainedBytes: 512 });
    expect(status).toBe('finished');
    expect(reason).toBe('completed');
  });

  it('processes items in order, one at a time', async () => {
    const { queue } = makeQueue([
      { name: 'a.jpg', size: 10 },
      { name: 'b.jpg', size: 10 },
      { name: 'c.jpg', size: 10 },
    ]);
    await queue.start();
    expect(queue.snapshot().items.map((item) => item.state)).toEqual(['completed', 'completed', 'completed']);
  });

  it('isolates a failure: the rest of the batch continues', async () => {
    const { queue, runs } = makeQueue([
      { name: 'a.jpg', size: 10 },
      { name: 'bad.jpg', size: 10, payload: { fail: true } },
      { name: 'c.jpg', size: 10 },
    ]);
    await queue.start();

    const { items, summary, status } = queue.snapshot();
    expect(runs).toHaveLength(3);
    expect(items.map((item) => item.state)).toEqual(['completed', 'failed', 'completed']);
    expect(summary).toMatchObject({ completed: 2, failed: 1, settled: 3, progress: 1 });
    expect(items[1].error).toEqual({
      code: 'decode-failed',
      message: 'This image could not be decoded.',
      hint: 'Try another file.',
    });
    expect(items[1].blob).toBeUndefined();
    expect(status).toBe('finished');
  });

  it('retries only the failed items', async () => {
    const { queue, runs } = makeQueue([
      { name: 'a.jpg', size: 10 },
      { name: 'bad.jpg', size: 10, payload: { fail: true } },
    ]);
    await queue.start();
    expect(runs).toHaveLength(2);

    // Fix the failure, then retry: the successful item must not run again.
    queue.snapshot().items.forEach(() => undefined);
    const retried = queue.retryFailed();
    expect(retried).toBe(1);
    expect(queue.snapshot().items[1].state).toBe('pending');
    expect(queue.snapshot().items[0].state).toBe('completed');

    await queue.start();
    expect(runs).toHaveLength(3);
  });
});

describe('progress', () => {
  it('reports per-item progress and folds it into the aggregate', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const queue = new BatchQueue<Payload>({
      budget: BATCH_BUDGETS.image,
      progressIntervalMs: 0,
      run: async (_payload, context: BatchRunContext) => {
        context.onProgress(0.5);
        await gate;
        return { blob: blobOf(new Uint8Array(4)), name: 'x' };
      },
    });
    queue.add([
      { name: 'a.jpg', size: 10, payload: {} },
      { name: 'b.jpg', size: 10, payload: {} },
    ]);

    const promise = queue.start();
    await wait(); // let the progress notification flush

    const mid = queue.snapshot();
    expect(mid.items[0].state).toBe('processing');
    expect(mid.items[0].progress).toBe(0.5);
    expect(mid.summary.progress).toBeCloseTo(0.25, 5); // half of one of two items

    release();
    await promise;
    expect(queue.snapshot().summary.progress).toBe(1);
  });

  it('coalesces progress notifications instead of emitting one per event', async () => {
    let notifications = 0;
    const queue = new BatchQueue<Payload>({
      budget: BATCH_BUDGETS.image,
      progressIntervalMs: 60,
      run: async (_payload, context) => {
        for (let i = 1; i <= 50; i += 1) context.onProgress(i / 50);
        return { blob: blobOf(new Uint8Array(4)), name: 'x' };
      },
    });
    queue.subscribe(() => {
      notifications += 1;
    });
    queue.add([{ name: 'a.jpg', size: 10, payload: {} }]);
    await queue.start();
    // Two state changes plus at most one coalesced progress flush, not 50.
    expect(notifications).toBeLessThan(10);
  });

  it('ignores a progress event that arrives after the item settled', async () => {
    const queue = new BatchQueue<Payload>({
      budget: BATCH_BUDGETS.image,
      progressIntervalMs: 0,
      run: async (_payload, context) => {
        setTimeout(() => context.onProgress(0.2), 0);
        return { blob: blobOf(new Uint8Array(4)), name: 'x' };
      },
    });
    queue.add([{ name: 'a.jpg', size: 10, payload: {} }]);
    await queue.start();
    await wait();
    expect(queue.snapshot().items[0].progress).toBe(1);
  });
});

describe('cancellation', () => {
  it('does nothing when cancelled before starting', async () => {
    const { queue, runs } = makeQueue([{ name: 'a.jpg', size: 10 }]);
    queue.cancel();
    expect(queue.snapshot().status).toBe('idle');
    expect(queue.snapshot().items[0].state).toBe('pending');
    await queue.start();
    expect(runs).toHaveLength(1);
    expect(queue.snapshot().items[0].state).toBe('completed');
  });

  it('stops between items and leaves the rest untouched', async () => {
    const { queue, runs } = makeQueue([
      { name: 'first', size: 10 },
      { name: 'second', size: 10, payload: { hang: true } },
      { name: 'third', size: 10 },
    ]);

    const promise = queue.start();
    // Wait until the second item is the current one.
    for (let i = 0; i < 50 && queue.snapshot().items[1]?.state !== 'processing'; i += 1) await wait(2);
    expect(queue.snapshot().status).toBe('running');

    queue.cancel();
    // Honest intermediate state: the first item is done, the current one is still running.
    expect(queue.snapshot().status).toBe('cancelling');
    expect(queue.snapshot().items[1].state).toBe('processing');

    await promise;

    const { items, summary, status, reason } = queue.snapshot();
    expect(runs).toHaveLength(2);
    expect(items.map((item) => item.state)).toEqual(['completed', 'cancelled', 'pending']);
    expect(summary).toMatchObject({ completed: 1, cancelled: 1, pending: 1, settled: 2 });
    expect(status).toBe('finished');
    expect(reason).toBe('cancelled');
  });

  it('can retry a cancelled item without re-running completed ones', async () => {
    const { queue, runs } = makeQueue([
      { name: 'first', size: 10 },
      { name: 'second', size: 10, payload: { hang: true } },
    ]);
    const promise = queue.start();
    for (let i = 0; i < 50 && queue.snapshot().items[1]?.state !== 'processing'; i += 1) await wait(2);
    queue.cancel();
    await promise;

    expect(queue.retryFailed()).toBe(1);
    await queue.start();
    expect(runs.length).toBe(3);
  });
});

describe('result retention', () => {
  it('releases bytes but keeps metadata', async () => {
    const { queue } = makeQueue([
      { name: 'a.jpg', size: 10, payload: { bytes: 100 } },
      { name: 'b.jpg', size: 10, payload: { bytes: 200 } },
    ]);
    await queue.start();
    expect(queue.snapshot().summary.retainedBytes).toBe(300);
    expect(queue.snapshot().summary.outputBytes).toBe(300);

    const firstId = queue.snapshot().items[0].id;
    expect(queue.release(firstId)).toBe(true);

    const after = queue.snapshot();
    expect(after.items[0].state).toBe('released');
    expect(after.items[0].blob).toBeUndefined();
    expect(after.items[0].result).toMatchObject({ bytes: 100 });
    expect(after.summary).toMatchObject({ released: 1, retainedBytes: 200, outputBytes: 300, progress: 1 });

    expect(queue.releaseAll()).toBe(1);
    expect(queue.snapshot().summary.retainedBytes).toBe(0);
    expect(queue.retained()).toEqual([]);
  });

  it('cannot release an item that never produced bytes', async () => {
    const { queue } = makeQueue([{ name: 'bad.jpg', size: 10, payload: { fail: true } }]);
    await queue.start();
    expect(queue.release(queue.snapshot().items[0].id)).toBe(false);
  });

  it('pauses at the output budget and resumes after a release', async () => {
    const budget: BatchBudget = { ...BATCH_BUDGETS.image, maxOutputBytes: 100 };
    const { queue } = makeQueue(
      [
        { name: 'a.jpg', size: 10, payload: { bytes: 60 } },
        { name: 'b.jpg', size: 10, payload: { bytes: 60 } },
        { name: 'c.jpg', size: 10, payload: { bytes: 60 } },
      ],
      { budget },
    );

    await queue.start();
    let snapshot = queue.snapshot();
    expect(snapshot.status).toBe('paused');
    expect(snapshot.reason).toBe('output-budget');
    expect(snapshot.items.map((item) => item.state)).toEqual(['completed', 'completed', 'pending']);
    expect(snapshot.summary.retainedBytes).toBe(120);

    queue.releaseAll();
    await queue.start();
    snapshot = queue.snapshot();
    expect(snapshot.items.map((item) => item.state)).toEqual(['released', 'released', 'completed']);
    expect(snapshot.status).toBe('finished');
  });
});

describe('queue management', () => {
  it('refuses to add files while running', async () => {
    const { queue } = makeQueue([{ name: 'a.jpg', size: 10, payload: { hang: true } }]);
    const promise = queue.start();
    await wait(2);
    expect(() => queue.add([{ name: 'b.jpg', size: 10, payload: {} }])).toThrow(/current batch/i);
    queue.cancel();
    await promise;
  });

  it('removes items and clears the queue', async () => {
    const { queue } = makeQueue([
      { name: 'a.jpg', size: 10 },
      { name: 'b.jpg', size: 10 },
    ]);
    await queue.start();
    const id = queue.snapshot().items[0].id;
    expect(queue.remove(id)).toBe(true);
    expect(queue.snapshot().items).toHaveLength(1);
    expect(queue.snapshot().summary.retainedBytes).toBe(10); // the remaining result
    queue.clear();
    expect(queue.snapshot().items).toEqual([]);
    expect(queue.snapshot().summary).toMatchObject({ total: 0, retainedBytes: 0, progress: 0 });
  });

  it('does not allow clearing while running', async () => {
    const { queue } = makeQueue([{ name: 'a.jpg', size: 10, payload: { hang: true } }]);
    const promise = queue.start();
    await wait(2);
    queue.clear();
    expect(queue.snapshot().items).toHaveLength(1);
    queue.cancel();
    await promise;
  });
});

describe('packaging', () => {
  it('packages completed results into one archive without releasing them', async () => {
    const { queue } = makeQueue([
      { name: 'a.jpg', size: 10, payload: { bytes: 5, outName: 'file-1.txt' } },
      { name: 'b.jpg', size: 10, payload: { bytes: 6, outName: 'file-2.txt' } },
      { name: 'c.jpg', size: 10, payload: { fail: true } },
    ]);
    await queue.start();

    const packaged = await packageResults(queue.snapshot().items, { name: 'batch.zip' });
    expect(packaged.count).toBe(2);
    expect(packaged.name).toBe('batch.zip');

    const opened = await readZip(packaged.blob);
    expect(opened.entries.map((entry) => entry.meta.name).sort()).toEqual(['file-1.txt', 'file-2.txt']);
    // The archive carries the result bytes, not a re-encode of them.
    expect(opened.entries.find((entry) => entry.meta.name === 'file-2.txt')!.data.byteLength).toBe(6);

    // Packaging must not silently drop the individual results.
    expect(queue.snapshot().summary.retainedBytes).toBe(11);
  });

  it('refuses to package when nothing completed', async () => {
    const { queue } = makeQueue([{ name: 'bad.jpg', size: 10, payload: { fail: true } }]);
    await queue.start();
    await expect(packageResults(queue.snapshot().items)).rejects.toSatisfy(
      (error) => (error as ToolError).code === 'empty-input',
    );
  });
});
