import { afterEach, describe, expect, it, vi } from 'vitest';
import { createArchive } from '../src/lib/zip/create';
import { sanitizeEntryName, uniqueEntryName } from '../src/lib/zip/names';
import {
  encodeZipOutcome,
  encodeZipReadOutcome,
  decodeZipOutcome,
  zipProgressRatio,
  type ZipOperation,
  type ZipProgress,
} from '../src/lib/zip/protocol';
import { readArchive } from '../src/lib/zip/read';
import { createZip, readZip } from '../src/lib/zip/zip';
import { ToolError, type ToolErrorCode } from '../src/lib/files/errors';
import { MB, blobOf, unreadableBlob } from './helpers';

const text = (value: string) => new Blob([new TextEncoder().encode(value)]);
const entries = (...names: string[]) => names.map((name) => ({ name, blob: text(`content of ${name}`) }));

describe('archive creation', () => {
  it('rejects an empty list', async () => {
    await expect(createArchive([])).rejects.toMatchObject({ code: 'empty-input' });
  });

  it('packages a single entry', async () => {
    const result = await createArchive([{ name: 'one.txt', blob: text('solo') }]);
    const opened = await readZip(new Blob([result.archive as BlobPart]));
    expect(opened.entries.map((entry) => entry.meta.name)).toEqual(['one.txt']);
    expect(new TextDecoder().decode(opened.entries[0].data)).toBe('solo');
    expect(result.entryCount).toBe(1);
    expect(result.inputBytes).toBe(4);
  });

  it('packages several entries in order', async () => {
    const result = await createArchive(entries('a.txt', 'b.txt', 'c.txt'));
    const opened = await readZip(new Blob([result.archive as BlobPart]));
    expect(opened.entries.map((entry) => entry.meta.name)).toEqual(['a.txt', 'b.txt', 'c.txt']);
    expect(result.entryCount).toBe(3);
  });

  it('renames duplicate names instead of dropping one', async () => {
    const result = await createArchive([
      { name: 'photo.jpg', blob: text('first') },
      { name: 'photo.jpg', blob: text('second') },
      { name: 'photo.jpg', blob: text('third') },
    ]);
    const opened = await readZip(new Blob([result.archive as BlobPart]));
    expect(opened.entries.map((entry) => entry.meta.name)).toEqual(['photo.jpg', 'photo (1).jpg', 'photo (2).jpg']);
    const bodies = opened.entries.map((entry) => new TextDecoder().decode(entry.data));
    expect(bodies).toEqual(['first', 'second', 'third']);
  });

  it('sanitises traversal and absolute names', async () => {
    const result = await createArchive([
      { name: '../../../etc/passwd', blob: text('x') },
      { name: '/absolute.txt', blob: text('x') },
      { name: 'C:\\Users\\me\\photo.png', blob: text('x') },
      { name: '..', blob: text('x') },
    ]);
    const opened = await readZip(new Blob([result.archive as BlobPart]));
    expect(opened.entries.map((entry) => entry.meta.name)).toEqual([
      'etc/passwd',
      'absolute.txt',
      'Users/me/photo.png',
      'file-4',
    ]);
  });

  it('is one set of naming rules, shared with extraction', () => {
    expect(sanitizeEntryName('a/../../b.txt')).toBe('a/b.txt');
    const used = new Map<string, number>();
    expect(uniqueEntryName('x.txt', used)).toBe('x.txt');
    expect(uniqueEntryName('x.txt', used)).toBe('x (1).txt');
    expect(uniqueEntryName('x.txt', used)).toBe('x (2).txt');
    expect(uniqueEntryName('noext', used)).toBe('noext');
    expect(uniqueEntryName('noext', used)).toBe('noext (1)');
  });
});

describe('budgets', () => {
  it('refuses too many entries before reading any bytes', async () => {
    let reads = 0;
    const spy = (name: string) => {
      const blob = unreadableBlob(10);
      blob.arrayBuffer = () => {
        reads += 1;
        throw new Error('budget check read a file');
      };
      return { name, blob };
    };
    const tooMany = Array.from({ length: 2_001 }, (_, index) => spy(`f${index}.bin`));
    await expect(createArchive(tooMany)).rejects.toMatchObject({ code: 'limit-exceeded' });
    expect(reads).toBe(0);
  });

  it('refuses a cumulative input larger than the budget before reading any bytes', async () => {
    let reads = 0;
    const blob = unreadableBlob(300 * MB);
    blob.arrayBuffer = () => {
      reads += 1;
      throw new Error('budget check read a file');
    };
    await expect(
      createArchive([
        { name: 'big-a.bin', blob },
        { name: 'big-b.bin', blob },
      ]),
    ).rejects.toMatchObject({ code: 'limit-exceeded' });
    expect(reads).toBe(0);
  });

  it('refuses inputs that turn out larger than their declared size', async () => {
    const liar = { size: 16, arrayBuffer: async () => new Uint8Array(4096).buffer } as unknown as Blob;
    await expect(
      createArchive([{ name: 'liar.bin', blob: liar }], {
        budget: { noun: 'files', maxBytes: 1024, maxItems: 10 },
      }),
    ).rejects.toMatchObject({ code: 'limit-exceeded' });
  });
});

describe('progress and cancellation', () => {
  it('reports one event per file plus a finalising phase, not per byte', async () => {
    const events: ZipProgress[] = [];
    await createArchive(entries(...Array.from({ length: 12 }, (_, i) => `f${i}.txt`)), {
      onProgress: (progress) => events.push({ ...progress }),
    });

    const compressing = events.filter((event) => event.phase === 'compressing');
    expect(compressing).toHaveLength(12);
    expect(compressing.map((event) => event.completed)).toEqual([...Array(12)].map((_v, i) => i + 1));
    expect(compressing.every((event) => event.total === 12)).toBe(true);
    expect(compressing.at(-1)!.inputBytes).toBeGreaterThan(0);
    expect(events.at(-1)!.phase).toBe('finalising');
  });

  it('maps progress to a bounded ratio that reserves the last tenth for writing', () => {
    expect(zipProgressRatio({ completed: 0, total: 10, inputBytes: 0, phase: 'compressing' })).toBe(0);
    expect(zipProgressRatio({ completed: 5, total: 10, inputBytes: 0, phase: 'compressing' })).toBeCloseTo(0.45);
    expect(zipProgressRatio({ completed: 10, total: 10, inputBytes: 0, phase: 'compressing' })).toBeCloseTo(0.9);
    expect(zipProgressRatio({ completed: 10, total: 10, inputBytes: 0, phase: 'finalising' })).toBe(0.92);
    expect(zipProgressRatio({ completed: 0, total: 0, inputBytes: 0, phase: 'compressing' })).toBe(0);
  });

  it('stops between entries when cancellation is requested', async () => {
    let completed = 0;
    const many = entries(...Array.from({ length: 20 }, (_, i) => `f${i}.txt`));
    await expect(
      createArchive(many, {
        onProgress: (progress) => {
          completed = progress.completed;
          if (progress.completed === 3) throw new Error('marker');
        },
      }),
    ).rejects.toThrow('marker');
    expect(completed).toBe(3);

    const controller = { cancelled: false };
    const promise = createArchive(many, {
      isCancelled: () => controller.cancelled,
      onProgress: (progress) => {
        if (progress.completed === 3) controller.cancelled = true;
      },
    });
    await expect(promise).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('cancels before the first read', async () => {
    let reads = 0;
    const blob = unreadableBlob(10);
    blob.arrayBuffer = () => {
      reads += 1;
      throw new Error('should not read');
    };
    await expect(createArchive([{ name: 'a.bin', blob }], { isCancelled: () => true })).rejects.toMatchObject({
      code: 'cancelled',
    });
    expect(reads).toBe(0);
  });
});

describe('transfer encoding', () => {
  it('round-trips the archive through a transferable buffer', () => {
    const archive = new Uint8Array([1, 2, 3, 4, 5, 6]);
    const { wire, transfer } = encodeZipOutcome({ archive, entryCount: 2, inputBytes: 99 });
    expect(transfer).toHaveLength(1);
    expect(transfer[0]).toBe(archive.buffer);
    const decoded = decodeZipOutcome(wire);
    expect([...decoded.archive]).toEqual([1, 2, 3, 4, 5, 6]);
    expect(decoded.entryCount).toBe(2);
    expect(decoded.inputBytes).toBe(99);
  });

  it('copies a view that does not cover its whole buffer', () => {
    const backing = new Uint8Array([9, 9, 1, 2, 3, 9]);
    const view = backing.subarray(2, 5);
    const { transfer } = encodeZipOutcome({ archive: view, entryCount: 1, inputBytes: 3 });
    expect(transfer[0]).not.toBe(backing.buffer);
    expect([...new Uint8Array(transfer[0])]).toEqual([1, 2, 3]);
  });
});

/* ------------------------------------------------------------------ client */

interface FakeWorkerInstance {
  postMessage: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
  emit: (data: unknown) => void;
  fail: (message: string) => void;
}

/**
 * A worker stand-in that runs the real work in-process but speaks the protocol.
 * Both job kinds are implemented, because `readZip` crosses the same boundary as
 * `createZip` and a harness that only knew how to create would silently test the
 * fallback path while claiming to test the worker.
 */
function installFakeWorker(behaviour: { dropProgress?: boolean } = {}) {
  const instances: FakeWorkerInstance[] = [];

  class FakeWorker {
    listeners = new Map<string, Set<(event: unknown) => void>>();
    postMessage: ReturnType<typeof vi.fn>;
    terminate = vi.fn();
    cancelled = new Set<number>();

    constructor() {
      const emit = (data: unknown) => {
        for (const fn of this.listeners.get('message') ?? []) fn({ data });
      };

      this.postMessage = vi.fn((message: { type: string; id: number; operation?: ZipOperation }) => {
        if (message.type === 'cancel') {
          this.cancelled.add(message.id);
          return;
        }
        void (async () => {
          const id = message.id;
          const operation = message.operation!;
          try {
            if (operation.kind === 'read') {
              const opened = await readArchive(operation.file, {
                limits: operation.limits,
                password: operation.password,
                isCancelled: () => this.cancelled.has(id),
                onProgress: (ratio: number) => emit({ type: 'ratio', id, ratio }),
              });
              const { wire, transfer } = encodeZipReadOutcome(opened);
              this.transfer = transfer;
              emit({ type: 'done', id, result: { kind: 'read', outcome: wire } });
              return;
            }

            const result = await createArchive(operation.entries as never, {
              isCancelled: () => this.cancelled.has(id),
              syncDeflate: true,
              onProgress: (progress) => {
                if (!behaviour.dropProgress) emit({ type: 'progress', id, progress });
              },
            });
            const { wire, transfer } = encodeZipOutcome({
              archive: result.archive,
              entryCount: result.entryCount,
              inputBytes: result.inputBytes,
            });
            this.transfer = transfer;
            emit({ type: 'done', id, result: { kind: 'create', outcome: wire } });
          } catch (error) {
            const toolError = error as ToolError;
            emit({
              type: 'error',
              id,
              code: (toolError.code ?? 'unknown') as ToolErrorCode,
              message: toolError.message,
              hint: toolError.hint,
            });
          }
        })();
      });

      instances.push(this as unknown as FakeWorkerInstance);
    }

    transfer: ArrayBuffer[] = [];

    addEventListener(type: string, fn: (event: unknown) => void) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type)!.add(fn);
    }

    removeEventListener() {}
  }

  class Wrapped extends FakeWorker {
    emit = (data: unknown) => {
      for (const fn of this.listeners.get('message') ?? []) fn({ data });
    };
    fail = (message: string) => {
      for (const fn of this.listeners.get('error') ?? []) fn({ message });
    };
  }

  vi.stubGlobal('Worker', Wrapped as unknown as typeof Worker);
  return { instances: instances as unknown as (FakeWorkerInstance & { transfer: ArrayBuffer[] })[] };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function freshClient() {
  vi.resetModules();
  return import('../src/lib/zip/client');
}

describe('worker path', () => {
  it('sends a request and returns the archive', async () => {
    const { instances } = installFakeWorker();
    const client = await freshClient();
    const outcome = await client.runZipOperation({ kind: 'create', entries: entries('a.txt', 'b.txt') });

    expect(instances).toHaveLength(1);
    expect(instances[0].postMessage).toHaveBeenCalledTimes(1);
    expect(instances[0].postMessage.mock.calls[0][0]).toMatchObject({ type: 'run', id: expect.any(Number) });

    const opened = await readZip(new Blob([outcome.archive as BlobPart]));
    expect(opened.entries).toHaveLength(2);
    expect(outcome.entryCount).toBe(2);
    expect(outcome.inputBytes).toBeGreaterThan(0);
  });

  it('transfers the archive buffer instead of copying it', async () => {
    const { instances } = installFakeWorker();
    const client = await freshClient();
    await client.runZipOperation({ kind: 'create', entries: entries('a.txt') });
    expect(instances[0].transfer).toHaveLength(1);
    expect(instances[0].transfer[0]).toBeInstanceOf(ArrayBuffer);
  });

  it('coalesces a burst of progress into a handful of notifications', async () => {
    installFakeWorker();
    const client = await freshClient();
    const ratios: number[] = [];
    await client.runZipOperation(
      { kind: 'create', entries: entries(...Array.from({ length: 40 }, (_, i) => `f${i}.txt`)) },
      { onProgress: (ratio) => ratios.push(ratio) },
    );
    // 41 worker progress events, but the client rate-limits to one per 60 ms
    // plus the guaranteed final 1.
    expect(ratios.length).toBeLessThan(8);
    expect(ratios.at(-1)).toBe(1);
  });

  it('rejects with the worker\u2019s structured error', async () => {
    installFakeWorker();
    const client = await freshClient();
    await expect(
      client.runZipOperation({
        kind: 'create',
        entries: [{ name: 'x.bin', blob: unreadableBlob(300 * MB) }, { name: 'y.bin', blob: unreadableBlob(300 * MB) }],
      }),
    ).rejects.toMatchObject({ code: 'limit-exceeded' });
  });

  it('cancels promptly and tells the worker to stop', async () => {
    const { instances } = installFakeWorker();
    const client = await freshClient();
    const controller = new AbortController();
    const promise = client.runZipOperation(
      { kind: 'create', entries: entries(...Array.from({ length: 30 }, (_, i) => `f${i}.txt`)) },
      { signal: controller.signal, onProgress: () => controller.abort() },
    );

    await expect(promise).rejects.toMatchObject({ code: 'cancelled' });
    const cancelCall = instances[0].postMessage.mock.calls.find((call) => call[0].type === 'cancel');
    expect(cancelCall?.[0]).toMatchObject({ type: 'cancel' });
  });

  it('rejects immediately when the signal is already aborted', async () => {
    const { instances } = installFakeWorker();
    const client = await freshClient();
    const controller = new AbortController();
    controller.abort();
    await expect(
      client.runZipOperation({ kind: 'create', entries: entries('a.txt') }, { signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'cancelled' });
    // No worker is even constructed for a request that is already dead.
    expect(instances).toHaveLength(0);
  });

  it('fails the job as worker-failed on a crash, then uses the main thread', async () => {
    const { instances } = installFakeWorker();
    const client = await freshClient();

    const promise = client.runZipOperation({
      kind: 'create',
      entries: [{ name: 'a.bin', blob: unreadableBlob(500 * MB) }, { name: 'b.bin', blob: unreadableBlob(500 * MB) }],
    });
    instances[0].fail('worker crashed (simulated)');

    await expect(promise).rejects.toMatchObject({ code: 'worker-failed' });
    expect(instances[0].terminate).toHaveBeenCalled();

    // No retry of the failed job: the next call takes the fallback path.
    const outcome = await client.runZipOperation({ kind: 'create', entries: entries('after.txt') });
    expect(outcome.entryCount).toBe(1);
    expect(instances).toHaveLength(1);
  });
});

describe('worker path — extraction', () => {
  it('reads an archive through the worker instead of the main thread', async () => {
    const { instances } = installFakeWorker();
    await freshClient();
    const archive = await createZip(entries('a.txt', 'b.txt'));

    const opened = await readZip(archive);
    expect(opened.entries.map((entry) => entry.meta.name)).toEqual(['a.txt', 'b.txt']);

    // The last run on this worker is the read: the archive was built first.
    const runCall = instances[0].postMessage.mock.calls.filter((call) => call[0].type === 'run').at(-1);
    expect(runCall?.[0].operation).toMatchObject({ kind: 'read' });
    // The file crosses as a Blob handle, not as copied bytes.
    expect(runCall?.[0].operation.file).toBeInstanceOf(Blob);
  });

  it('transfers every entry buffer back instead of copying them', async () => {
    const { instances } = installFakeWorker();
    await freshClient();
    const archive = await createZip(entries('a.txt', 'b.txt', 'c.txt'));
    const opened = await readZip(archive);
    expect(instances[0].transfer).toHaveLength(opened.entries.length);
    expect(instances[0].transfer.every((buffer) => buffer instanceof ArrayBuffer)).toBe(true);
  });

  it('reports a monotonic ratio that ends at exactly 1', async () => {
    installFakeWorker();
    await freshClient();
    const archive = await createZip(entries(...Array.from({ length: 8 }, (_, i) => `f${i}.txt`)));
    const ratios: number[] = [];
    await readZip(archive, undefined, (ratio) => ratios.push(ratio));
    expect(ratios.every((ratio, index) => index === 0 || ratio >= ratios[index - 1])).toBe(true);
    expect(ratios.filter((ratio) => ratio === 1)).toHaveLength(1);
  });

  it('cancels an extraction and tells the worker to stop', async () => {
    const { instances } = installFakeWorker();
    await freshClient();
    const archive = await createZip(entries(...Array.from({ length: 40 }, (_, i) => `f${i}.txt`)));
    const controller = new AbortController();

    const promise = readZip(archive, undefined, () => controller.abort(), undefined, controller.signal);
    await expect(promise).rejects.toMatchObject({ code: 'cancelled' });

    const cancelCall = instances[0].postMessage.mock.calls.find((call) => call[0].type === 'cancel');
    expect(cancelCall?.[0]).toMatchObject({ type: 'cancel' });
  });
});

describe('main-thread fallback', () => {
  it('builds the archive when no worker can be constructed', async () => {
    vi.stubGlobal('Worker', undefined);
    const client = await freshClient();
    const progress: number[] = [];
    const outcome = await client.runZipOperation({ kind: 'create', entries: entries('solo.txt') }, {
      onProgress: (ratio) => progress.push(ratio),
    });
    const opened = await readZip(new Blob([outcome.archive as BlobPart]));
    expect(opened.entries.map((entry) => entry.meta.name)).toEqual(['solo.txt']);
    expect(progress.at(-1)).toBe(1);
  });

  it('honours cancellation on the fallback path', async () => {
    vi.stubGlobal('Worker', undefined);
    const client = await freshClient();
    const controller = new AbortController();
    controller.abort();
    await expect(
      client.runZipOperation({ kind: 'create', entries: entries('a.txt') }, { signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'cancelled' });
  });
});

describe('createZip public API', () => {
  it('returns an application/zip blob that reads back', async () => {
    const blob = await createZip(entries('one.txt', 'two.txt'));
    expect(blob.type).toBe('application/zip');
    const opened = await readZip(blob);
    expect(opened.entries.map((entry) => entry.meta.name).sort()).toEqual(['one.txt', 'two.txt']);
  });

  it('reports progress and finishes at 1', async () => {
    const ratios: number[] = [];
    await createZip(entries(...Array.from({ length: 6 }, (_, i) => `f${i}.txt`)), {
      onProgress: (ratio) => ratios.push(ratio),
    });
    expect(ratios.at(-1)).toBe(1);
    expect(ratios.every((ratio) => ratio >= 0 && ratio <= 1)).toBe(true);
  });

  it('honours an aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(createZip(entries('a.txt'), { signal: controller.signal })).rejects.toMatchObject({
      code: 'cancelled',
    });
  });

  it('rejects a request that cannot fit the budget', async () => {
    await expect(
      createZip([
        { name: 'a.bin', blob: unreadableBlob(300 * MB) },
        { name: 'b.bin', blob: unreadableBlob(300 * MB) },
      ]),
    ).rejects.toMatchObject({ code: 'limit-exceeded' });
  });
});

describe('store vs deflate', () => {
  const text = (value: string) => new Blob([new TextEncoder().encode(value)]);

  it('deflate shrinks highly compressible content', async () => {
    const blob = await createZip([{ name: 'log.txt', blob: text('a'.repeat(20_000)) }]);
    expect(blob.size).toBeLessThan(2_000);
  });

  it('store writes the bytes as they are, so the archive is about the input size', async () => {
    const blob = await createZip([{ name: 'log.txt', blob: text('a'.repeat(20_000)) }], { compression: 'store' });
    // 20 kB of data plus two small headers; the point is that it did not shrink.
    expect(blob.size).toBeGreaterThan(19_500);
    expect(blob.size).toBeLessThan(21_000);
  });

  it('store still produces a readable archive with the same contents', async () => {
    const blob = await createZip(
      [
        { name: 'a.txt', blob: text('first') },
        { name: 'b/c.txt', blob: text('second') },
      ],
      { compression: 'store' },
    );
    const opened = await readZip(blob);
    expect(opened.entries.map((entry) => entry.meta.name)).toEqual(['a.txt', 'b/c.txt']);
    expect(new TextDecoder().decode(opened.entries[1].data)).toBe('second');
  });

  it('store is predictable: the archive is the input plus headers', async () => {
    // xorshift32 — deterministic, and structurally uninteresting enough that
    // DEFLATE cannot pretend it is compressible.
    let state = 0x9e3779b9;
    const noisy = new Uint8Array(4_096);
    for (let index = 0; index < noisy.length; index += 1) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      noisy[index] = state & 0xff;
    }

    const stored = await createZip([{ name: 'noise.bin', blob: new Blob([noisy as BlobPart]) }], {
      compression: 'store',
    });
    // 4 kB of payload plus a local header and a central directory entry.
    expect(stored.size).toBeGreaterThan(noisy.length);
    expect(stored.size).toBeLessThan(noisy.length + 300);
  });

  it('encrypted archives honour the option too', async () => {
    const stored = await createZip([{ name: 'log.txt', blob: text('a'.repeat(20_000)) }], {
      compression: 'store',
      password: 'correct horse',
      encryption: 'aes-256',
    });
    const opened = await readZip(stored, undefined, undefined, 'correct horse');
    expect(new TextDecoder().decode(opened.entries[0].data).length).toBe(20_000);
  });
});

describe('batch packaging', () => {
  it('packages only completed results and keeps them afterwards', async () => {
    const { BatchQueue } = await import('../src/lib/batch/queue');
    const { packageResults } = await import('../src/lib/batch/package');
    const { BATCH_BUDGETS } = await import('../src/lib/files/budget');

    const queue = new BatchQueue<number>({
      budget: BATCH_BUDGETS.image,
      progressIntervalMs: 0,
      run: async (value) => {
        if (value === 2) throw new ToolError('decode-failed', 'nope');
        return { blob: blobOf(new TextEncoder().encode(`result ${value}`)), name: `out-${value}.txt` };
      },
    });
    queue.add([1, 2, 3].map((value) => ({ name: `in-${value}.txt`, size: 10, payload: value })));
    await queue.start();

    const ratios: number[] = [];
    const packaged = await packageResults(queue.snapshot().items, {
      name: 'batch.zip',
      onProgress: (ratio) => ratios.push(ratio),
    });

    expect(packaged.count).toBe(2);
    expect(ratios.at(-1)).toBe(1);
    const opened = await readZip(packaged.blob);
    expect(opened.entries.map((entry) => entry.meta.name).sort()).toEqual(['out-1.txt', 'out-3.txt']);
    // Packaging must not consume the individual results.
    expect(queue.snapshot().summary.completed).toBe(2);
    expect(queue.retained()).toHaveLength(2);
  });

  it('refuses to package an empty result set', async () => {
    const { packageResults } = await import('../src/lib/batch/package');
    await expect(packageResults([])).rejects.toMatchObject({ code: 'empty-input' });
  });

  it('can be cancelled without touching batch state', async () => {
    const { BatchQueue } = await import('../src/lib/batch/queue');
    const { packageResults } = await import('../src/lib/batch/package');
    const { BATCH_BUDGETS } = await import('../src/lib/files/budget');

    const queue = new BatchQueue<number>({
      budget: BATCH_BUDGETS.image,
      progressIntervalMs: 0,
      run: async (value) => ({ blob: blobOf(new TextEncoder().encode(`r${value}`)), name: `r-${value}.txt` }),
    });
    queue.add([1, 2, 3].map((value) => ({ name: `in-${value}.txt`, size: 10, payload: value })));
    await queue.start();

    const controller = new AbortController();
    controller.abort();
    await expect(
      packageResults(queue.snapshot().items, { signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'cancelled' });
    expect(queue.snapshot().summary.completed).toBe(3);
  });
});
