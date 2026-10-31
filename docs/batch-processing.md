# Batch processing

A batch is **one user action over many files**, processed sequentially in the tab. It is not "the same
tool, run repeatedly by hand": the queue owns ordering, budgets, progress, cancellation, failure
isolation and the lifetime of the result bytes.

This document is the design and the measured behaviour. It assumes the primitives described in
[`architecture.md`](architecture.md) §5–§8 (worker-based image pipeline, cooperative cancellation,
`ToolError` vocabulary, cumulative budgets).

---

## 1. Where the queue sits

```
tool (React)                →    mode: single file  →  useImagePipeline  →  processImage
                            →    mode: batch        →  useImageBatch     →  BatchQueue
                                                                             │
                                                        one item at a time   ▼
                                                             validateImage + processImage
                                                                             │
                                                                        image.worker.ts
```

* `src/lib/batch/queue.ts` — `BatchQueue<T>`: framework-free, DOM-free, tested in Node.
* `src/lib/batch/types.ts` — item/aggregate states, result metadata, snapshot shapes.
* `src/lib/batch/package.ts` — ZIP packaging of completed results via the existing `createZip`.
* `src/hooks/useBatchQueue.ts` — generic React binding (`useSyncExternalStore`, cached snapshot).
* `src/hooks/useImageBatch.ts` — the image-specific binding: budget, job settings, filenames, download.
* `src/components/batch/BatchPanel.tsx` — presentation only; it decides nothing.

The queue never touches a file's contents. It sees `{ name, size, payload }` and a `run` callback.
Everything else (validation, decode, encode, error mapping) is the existing single-file code path, so a
batch cannot bypass a guard the single-file tool has.

### Which tools have batches

Image compression, image conversion, image resize and image transform (rotate/flip). They are
file-independent: the same settings apply to every file, one file produces one result.

PDF merge, split and images→PDF are deliberately **not** batched. Merge takes several files to produce
one; split produces many results from one; images→PDF is already many-inputs-to-one. Wrapping them in a
per-file queue would add a layer without adding a capability. They keep their own cumulative budgets and
worker progress instead.

---

## 2. States

Per item: `pending → processing → completed | failed | cancelled`, plus `released` (was `completed`,
bytes dropped, metadata kept). A failed item can go back to `pending` via retry; a cancelled item can
too.

Aggregate, exposed as `BatchSnapshot.status`:

| status | meaning |
| --- | --- |
| `idle` | has items, nothing has run (or items were added to a finished batch) |
| `running` | the loop is working |
| `cancelling` | cancel requested; the current item is still finishing |
| `paused` | stopped by the output-bytes budget; items remain `pending` |
| `finished` | stopped for any other reason — see `reason`: `completed`, `cancelled`, `output-budget` |

`cancelling` exists because it is true. A cancel during an in-flight decode/encode cannot interrupt the
codec; the UI says "Finishing the current image, then stopping" and the badge reads *Cancelling*. Only
when the loop actually stops does the status become `finished`.

After a cancellation the user can see exactly what happened per row: `completed`, `failed`,
`cancelled` (the item that was running), `pending` (never started).

---

## 3. Budgets

Three separate ceilings, all decided from metadata (`File.size`) before a byte is read:

| ceiling | value | where |
| --- | --- | --- |
| one file | per-type `SIZE_LIMITS` (e.g. 80 MB image) | `errors.ts` `assertWithinSize` |
| one batch | 50 images, 300 MB cumulative input | `BATCH_BUDGETS.image` |
| retained output | 300 MB of results held at once | `BATCH_BUDGETS.image.maxOutputBytes` |

`BatchQueue.add()` re-checks the cumulative budget over `existing + new` declared sizes and throws
`ToolError('limit-exceeded', …)` on failure — nothing is read, nothing is queued. The UI renders the
message and hint from the error itself; there is no batch-specific error vocabulary.

The output budget is different in kind: it cannot be predicted, because output size is a property of the
codec, not of the file metadata. So it is enforced *observationally*, between items: before starting the
next item the loop compares `retainedBytes` with the ceiling and, if it is reached, stops with
`status = 'paused'` and `reason = 'output-budget'`. The panel explains how much is held, how many files
are waiting, and offers **Continue** (after releasing bytes) rather than silently dropping results.

Input bytes are capped at 300 MB even though only one file is decoded at a time, because *results* of the
whole batch are what stay resident. Keep the numbers together in `budget.ts` so the PDF and ZIP tools
speak the same vocabulary.

---

## 4. Result-bytes lifecycle

Four distinct things, never conflated:

1. **metadata** — `{ name, bytes, width, height }` on the item. Survives release; totals stay truthful.
2. **bytes** — the `Blob` held by the queue. This is what `retainedBytes` counts.
3. **packaged** — a ZIP built by `packageResults` → `createZip`, which reads each result blob **once**
   (`await blob.arrayBuffer()`) and deflates it. No base64, no re-encode, no second copy of a result.
4. **released** — `release(id)` / `releaseAll()` / `remove(id)` drop the blob reference. The item keeps
   its metadata and moves to `released`.

Packaging does **not** release anything by itself: downloading a ZIP is not proof the user wants to lose
the individual files. "Release N from memory" is a separate, explicit action, and it is offered right
next to the download buttons.

`pagehide`/unmount disposes the queue, which aborts in-flight work; blobs are then garbage.

---

## 5. Cancellation

Cooperative, and honest about its granularity:

* `cancel()` aborts the `AbortSignal` handed to the runner and flips the status to `cancelling`.
  It returns immediately.
* The runner (`useImageBatch`) checks `signal.aborted` after validation and passes the signal to
  `processImage`, which (a) rejects immediately on the main-thread path and (b) posts
  `{ type: 'cancel', id }` to the image worker, which checks a `cancelled` set before planning,
  before rendering and after `convertToBlob`.
* The loop never starts another item after a cancel: completed results are kept, the current item becomes
  `cancelled`, and everything untouched stays `pending`.
* Retry re-queues only `failed` and `cancelled` items. Completed items are never reprocessed.

What it cannot do: interrupt a codec call already inside the browser. That is why the copy says
"finishing the current image" instead of claiming an instant stop.

---

## 6. Progress

Per item and aggregate, sourced from the existing worker stage events:

* `decode` → 0.30, `render` → 0.60, `encode` → 0.88, completion → 1. These are stage weights, not byte
  counts; claiming byte-accurate progress from a canvas codec would be fiction.
* Aggregate progress is `(settled + partial) / total`, where `partial` is the running item's fraction. So
  "37 / 100 files" and the overall bar agree with each other.
* Notification coalescing is unchanged: state changes notify immediately, progress ticks coalesce on a
  60 ms timer. A 50-file batch with 3 stage events each produces ~2 notifications per item at most — the
  measured figure is 103 notifications for 150 stage events across 50 items, versus ~200 if every event
  rendered.
* `snapshot()` is cached and invalidated only on change, so `useSyncExternalStore` cannot re-render in a
  loop.

---

## 7. Concurrency is 1

Deliberate, not accidental:

* A worker operation holds a full-resolution bitmap plus a destination canvas. Two at once doubles peak
  memory for a throughput gain a user cannot perceive on files that take 50–300 ms each.
* The codec already occupies its worker; parallelising would mean N workers (memory again) or a worker
  pool (the thing we explicitly did not want to build without measurements).
* The loop is written as `for (;;) { pick next pending; await runItem }` precisely so a future
  `concurrency: n` can be measured against this baseline and adopted only if the memory numbers allow it.
  Nothing else in the layer assumes 1.

---

## 8. Failure isolation

Each `run` is wrapped in `try/catch`. `toToolError` maps anything thrown — `ToolError`s from
`validateImage`/`processImage`, or an unexpected exception — into `{ code, message, hint }` stored on the
item. The loop then continues. A corrupt JPEG in the middle of 40 files costs exactly one row, and the
row explains itself and offers Retry.

---

## 9. Measured behaviour

Two harnesses, both Node 22 (`/tmp/zu5`, ephemeral, not committed — regenerate as described below):

* **`bench.mjs`** — the real `BatchQueue` with a stand-in runner that models one worker round trip
  (8 ms + 1.2 ms/MB, a 60 % output ratio). This measures the **queue**, not the codec: wall time here is
  queue + modelled service time.
* **`bench-queue.mjs`** — the same service time run in a plain loop versus through the queue, to isolate
  what the batch layer itself costs.

| scenario | wall | main-thread stall | RSS delta | runs | retained | end |
| --- | --- | --- | --- | --- | --- | --- |
| 10 × 1 MB | 87 ms | 2 ms | 4 MB | 10 | 10 (4.0 MB) | finished |
| 50 × 1 MB | 424 ms | 1 ms | 27 MB | 50 | 50 (20 MB) | finished |
| 50 × 5 MB (250 MB total) | 764 ms | 5 ms | 209 MB | 50 | 50 (200 MB) | finished |
| 20 × 0.2–8 MB mixed | 223 ms | 9 ms | ~0 | 20 | 20 (47 MB) | finished |
| 20 with 3 failures | 140 ms | 3 ms | ~0 | 20 | 17 (6.8 MB) | finished |
| 50, cancelled at 120 ms | 121 ms | 9 ms | 4 MB | 14 | 14 (5.6 MB) | finished (cancelled) |
| 20, cancel during item 4 | 81 ms | 4 ms | ~0 | 4 | 3 (1.2 MB) | finished (cancelled) |
| 40 × 4 MB held | 602 ms | 5 ms | 174 MB | 40 | 40 (160 MB) | finished |

Orchestration overhead versus a plain sequential loop, same 5 ms service time:

| items | plain loop | through queue | overhead | stall (loop / queue) | notifications |
| --- | --- | --- | --- | --- | --- |
| 1 | 6 ms | 6 ms | +0.2 ms | 0.4 / 0.0 ms | 5 |
| 10 | 51 ms | 52 ms | +0.9 ms | 0.5 / 0.5 ms | 23 |
| 50 | 259 ms | 267 ms | +7.7 ms | 0.4 / 0.5 ms | 103 |

That is **0.23–0.33 ms of queue overhead per item** — less than 1 % of a typical 100 ms codec step.

Rest of the memory story:

* Releasing 40 results (160 MB) returns `retainedBytes` to 0 and lets the blobs go; the queue keeps the
  metadata.
* Packaging 30 × 0.6 MB of incompressible-to-zero data into one ZIP: **1.20 s wall, 580 ms longest
  main-thread stall, +96 MB RSS**. That stall is `fflate` deflating on the main thread. It is user-
  initiated, it happens once, and it is the single worst responsiveness point in the batch flow — see
  Risks.

### What these numbers do not measure

The image codec itself. There is no browser in the build environment, so `createImageBitmap` /
`OffscreenCanvas.encode` cannot run; the harness models their latency instead. What is measured is the
part the batch layer adds (ordering, budgets, coalescing, retention, packaging) plus the PDF worker path
that the same architecture uses, which was measured end-to-end in `architecture.md` §5a.

### Reproducing

```bash
mkdir -p /tmp/zu-bench
npx tsc src/lib/batch/queue.ts src/lib/batch/package.ts src/lib/batch/types.ts \
        src/lib/files/*.ts src/lib/zip/zip.ts \
        --outDir /tmp/zu-bench --module esnext --target es2022 \
        --moduleResolution bundler --skipLibCheck --lib es2022,dom
# then add the .js extension to relative imports in the emitted files,
# symlink node_modules, and run the bench script against /tmp/zu-bench.
```

---

## 10. Verification

Committed, framework-free, `tests/batch.test.ts` (24 tests, `npm test`, Node environment, no DOM):

| area | cases |
| --- | --- |
| budgets | empty batch, count ceiling (51 files refused, nothing queued), byte ceiling, ceiling from metadata only (**a payload getter that would count a read is never touched**), adding to an existing batch |
| lifecycle | empty start, single item, order, failure isolation, retry-failed re-queues only failures |
| progress | per-item → aggregate, coalescing (50 events → <10 notifications), late events ignored after settle |
| cancellation | cancel before start is a no-op, cancel between items (completed / cancelled / pending), retry a cancelled item |
| retention | release keeps metadata, release of a failed item is refused, output budget pauses and continues after a release |
| queue management | add while running refused, remove, clear, clear during run refused |
| packaging | successes only, archive contents verified by unzipping, results not dropped by packaging, empty packaging refused |

Plus, in a jsdom route harness (not committed): all four image tools complete a 2-file batch through the
real React layer; a decode failure isolates to one row and Retry succeeds; Cancel during a slow decode
shows *Cancelling* + "Finishing the current image", then leaves `completed / cancelled / pending`; a
51-file drop is refused with the budget message and no rows; object URLs are 0 after teardown.

---

## 11. Risks

1. **ZIP packaging blocks the main thread** (580 ms on 18 MB, worse on a full 300 MB batch). `fflate`
   currently runs on the main thread. Moving packaging into its own worker is the obvious next fix; it was
   not done here because the task was to understand memory behaviour first, and because correctness of the
   queue matters more than one user-initiated pause.
2. **Retention is the dominant memory cost**, not the codec: 200 MB of results is 200 MB of RSS. The
   300 MB ceiling is what keeps a batch inside a tab; users who ignore "Release" will hit the pause.
3. **Cooperative cancellation granularity**: a single very large image can take a second or more to
   finish after Cancel. The UI says so, but the wait is real.
4. **Browser-only behaviour is unverified**: worker teardown, `OffscreenCanvas` limits and codec memory
   are measured in Node only for the PDF path.
5. **No throughput knob**: if measurements later show bounded concurrency (2–3) is safe, it must be
   measured against the memory table here, not assumed.

## 12. Next phase (recommended)

1. Packaging in a worker (removes the 580 ms stall; `fflate` already supports it).
2. A memory probe around `performance.measureUserAgentSpecificMemory()` where available, to replace the
   modelled codec cost with real numbers in a browser.
3. Only then evaluate bounded concurrency (2) with the same table format.
4. Batch for ZIP creation and PDF split *if* the semantics stay honest (those tools produce many outputs
   from one input already).
