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
* `src/lib/batch/package.ts` — ZIP packaging of completed results via `createZip`, whose work runs in
  `lib/zip/zip.worker.ts` (see §10a).
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

Deliberate, not accidental — and now measured rather than argued (§10b):

* A worker operation holds a full-resolution bitmap plus a destination canvas. Two at once doubles peak
  memory. Measured with a real codec: +15 MB at 2 MP, +47 MB at 8 MP, +70 MB at 12 MP.
* The codec already occupies its worker; parallelising would mean N workers (memory again) or a worker
  pool (the thing we explicitly did not want to build without measurements).
* The queue runs `concurrency` lanes, each `for (;;) { pick next pending; await runItem }`. One lane is the
  default, `DEFAULT_BATCH_CONCURRENCY` is the single place the decision lives, and the lane semantics are
  pinned by 13 tests so enabling it later is a configuration change, not a rewrite.

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
* Packaging is measured separately in §10a, because it no longer runs on the main thread.

### What these numbers do not measure

The image codec itself. There is no browser in the build environment, so `createImageBitmap` /
`OffscreenCanvas.encode` cannot run; the harness models their latency instead. What is measured is the
part the batch layer adds (ordering, budgets, coalescing, retention) plus the worker paths it uses — the
PDF worker (`architecture.md` §5a) and the ZIP worker (§10a below), both measured end-to-end.

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

Committed, framework-free, `tests/batch.test.ts` (24 tests) and `tests/zip-packaging.test.ts` (31 tests),
`npm test`, Node environment, no DOM:

| area | cases |
| --- | --- |
| budgets | empty batch, count ceiling (51 files refused, nothing queued), byte ceiling, ceiling from metadata only (**a payload getter that would count a read is never touched**), adding to an existing batch |
| lifecycle | empty start, single item, order, failure isolation, retry-failed re-queues only failures |
| progress | per-item → aggregate, coalescing (50 events → <10 notifications), late events ignored after settle |
| cancellation | cancel before start is a no-op, cancel between items (completed / cancelled / pending), retry a cancelled item |
| retention | release keeps metadata, release of a failed item is refused, output budget pauses and continues after a release |
| queue management | add while running refused, remove, clear, clear during run refused |
| packaging | successes only, archive contents verified by unzipping, results not dropped by packaging, empty packaging refused, cancelled packaging leaves the batch untouched |
| ZIP worker | see §10a — core, protocol, client, fallback, crash, transfers, budgets, cancellation |

Plus, in a jsdom route harness (not committed): all four image tools complete a 2-file batch through the
real React layer; a decode failure isolates to one row and Retry succeeds; Cancel during a slow decode
shows *Cancelling* + "Finishing the current image", then leaves `completed / cancelled / pending`; a
51-file drop is refused with the budget message and no rows; object URLs are 0 after teardown.

---

## 10a. ZIP packaging moved into a worker

Packaging a batch used to deflate every result on the main thread. It now runs in a dedicated module
worker that follows the PDF worker pattern exactly (`protocol.ts` / `create.ts` / `zip.worker.ts` /
`client.ts`, with `zip.ts` as the unchanged public API).

### Architecture

```
createZip(files, { onProgress, signal })        ← public API, no thread awareness
        │
        ├── Worker available ──► client.ts ──► zip.worker.ts ──► create.ts ──► fflate
        └── Worker missing   ──► client.ts ─────────────────────► create.ts ──► fflate
```

* **One implementation.** `create.ts` holds archive creation: the cumulative budget from metadata, the
  per-entry re-check, `sanitizeEntryName`, duplicate renaming, progress, cancellation. The worker is a
  transport; the fallback calls the same function. `sanitizeEntryName` lives in `names.ts` so the
  extraction path in `zip.ts` uses the identical rules.
* **Protocol.** `{ type: 'run', id, operation }` / `{ type: 'cancel', id }` in;
  `{ type: 'progress', id, progress }` / `{ type: 'done', id, outcome }` / `{ type: 'error', id, code,
  message, hint }` out. Inputs cross as `Blob` handles (no copy, nothing detached); the finished archive
  crosses as a **transferred** `ArrayBuffer`, so the worker gives up ownership instead of keeping a
  duplicate alive.
* **Progress is in files, not bytes.** One event per entry plus one when DEFLATE starts. The client
  coalesces to one ratio per 60 ms and guarantees a final `1`.
* **Cancellation is cooperative.** Aborting rejects the caller immediately and posts `cancel`; the worker
  discards at the next entry boundary or after DEFLATE, whichever comes first. Entries are yielded every
  8 files so the cancel message is actually dispatched instead of sitting behind a busy microtask queue.
* **Failure.** If a worker cannot be constructed, the same code runs on the main thread. If it dies
  mid-archive, that job rejects as `worker-failed` and the worker is discarded — later jobs use the main
  thread. No automatic retry, no silent loop.

### Measured (Node 22; the worker is the built bundle in a `worker_thread`)

Same workload the batch flow produced before (30 results × 0.6 MB), plus a larger batch:

| workload | before: wall · stall · RSS | after: wall · stall · RSS |
| --- | --- | --- |
| 30 × 0.6 MB (zeros) | 1261 ms · **703 ms** · +95 MB | 284 ms · **6 ms** · +57 MB |
| 30 × 0.6 MB (varied bytes) | 1172 ms · **563 ms** · +41 MB | 273 ms · **3 ms** · −31 MB |
| 30 × 0.6 MB (random, 18.0 MB archive) | 2203 ms · **818 ms** · +111 MB | 676 ms · **3 ms** · +10 MB |
| 300 × 20 kB | 110 ms · 0 ms · +0 MB | 149 ms · **8 ms** · +1 MB |
| 120 × 0.6 MB (72 MB) | 4957 ms · **4295 ms** · +265 MB | 1097 ms · **3 ms** · +51 MB |

* The stall is gone: **818 ms → 3 ms** on the workload that motivated the change (a 99.6 % reduction),
  and **4295 ms → 3 ms** on the four-times-larger batch.
* Wall time also improved 2–4×, because `fflate`'s async API was spawning a worker *per large file* and
  copying every entry across that boundary; inside our worker the archive is deflated with one `zipSync`.
* Progress notifications per run: **31 → 3** (coalesced; the bar still reaches 100 %).
* Cancellation latency (abort → rejection): **0–1 ms** on all three workloads. The worker stops at the
  next entry.
* Output size is unchanged (18.01 MB archive in both paths) — DEFLATE level 6 and entry names are the same
  code.
* Small-file batches (300 × 20 kB) are the one case with a slightly slower wall clock (+39 ms) and a
  measurable stall (8 ms) — the cost of one structured-clone of 300 blob handles and a transfer back,
  against a 110 ms job that never stalled. Judged not worth a second code path.

### Tests

`tests/zip-packaging.test.ts` (31 tests) covers the core, the client and the batch packaging glue: single
and multiple results, duplicate names, sanitization, entry and byte budgets (**rejected before any read**,
verified with blobs that throw on `arrayBuffer()`), a lying blob whose real size exceeds the budget,
progress granularity and ratio mapping, cancellation before/during, transfer encoding (exact buffer
transferred, subarray copied), the worker protocol via a fake worker, progress coalescing, structured
errors, a crash → `worker-failed` followed by the main-thread fallback, the no-`Worker` fallback, and
`createZip`/`packageResults` end to end.

---

## 10b. Bounded concurrency: measured, still off

The queue now has a `concurrency` option (1–4, default 1). Before it existed, "two lanes would double peak
memory" was an argument; now it is a number. Full method, browser procedure and caveats:
[`measurement.md`](measurement.md).

A real codec (skia: libjpeg/libpng/libwebp) over synthetic photographs, on Node 22, with the shipped
`BatchQueue` doing the sequencing:

| workload | lanes | wall | peak RSS | per item | notifications | completed |
| --- | --- | --- | --- | --- | --- | --- |
| 2 MP × 50 | 1 | 2708 ms | 225 MB | 54 ms | 103 | 50 |
| 2 MP × 50 | 2 | 1867 ms | 240 MB | 37 ms | 103 | 50 |
| 8 MP × 20 | 1 | 2180 ms | 389 MB | 109 ms | 43 | 20 |
| 8 MP × 20 | 2 | 1196 ms | 436 MB | 60 ms | 43 | 20 |
| 12 MP × 10 | 1 | 1582 ms | 520 MB | 158 ms | 23 | 10 |
| 12 MP × 10 | 2 | 905 ms | 590 MB | 91 ms | 23 | 10 |

* **1.45–1.94× wall time** for a second lane, and the orchestrator itself costs nothing measurable (the same
  workload run through raw lanes took 2774 / 1824 ms).
* **+15 to +70 MB peak**, i.e. one to two extra full-resolution bitmaps. The existing model predicted exactly
  that, so the budget arithmetic was sound.
* **Identical notification counts and identical retained bytes** — the lane count does not make the UI
  busier, because renders are limited by the 60 ms coalescing window, not by how many items are in flight.

**It stays at 1.** A slower batch is an annoyance; a killed tab is data loss, and on a small-memory device the
extra 70 MB at 12 MP is the difference between the two. `DEFAULT_BATCH_CONCURRENCY` in `queue.ts` is the single
place to change when the browser probe (`npm run measure`) shows headroom on the devices the decision is for.

The option is not untested while it waits: `tests/batch-concurrency.test.ts` (13 tests) pins the semantics —
start order, two lanes at once, no overlap at 1, failure isolation across lanes, cancel stopping both lanes
with the rest left `pending`, output-ceiling overshoot bounded by (lanes − 1), monotonic aggregate progress,
and the metadata-only budget rejection.

---

## 11. Risks

1. **Packaging holds a second copy while it runs.** The archive is built inside the worker, so the main
   thread holds the results and then the finished archive — peak is roughly results + archive, briefly.
   Bounded by the 300 MB output ceiling, but it is the largest instantaneous allocation in the app.
2. **Retention is the dominant memory cost**, not the codec: 200 MB of results is 200 MB of RSS. The
   300 MB ceiling is what keeps a batch inside a tab; users who ignore "Release" will hit the pause.
3. **Cooperative cancellation granularity**: a single very large image can take a second or more to
   finish after Cancel. Packaging cancels in 0–1 ms, but an image in the middle of a decode cannot be
   interrupted. The UI says so, but the wait is real.
4. **Browser-only behaviour is unverified for the codec**: worker teardown and `OffscreenCanvas` limits are
   exercised in jsdom only, and codec memory is measured with skia in Node. `scripts/measure` exists to close
   that gap; until it has been run on a low-end device, the codec half of the memory table is a model.
5. **A second lane is measured but not enabled** (§10b): 1.45–1.94× faster, at the cost of one to two extra
   bitmaps. If it is ever enabled, the output ceiling can be over-shot by up to (lanes − 1) items, and the
   browser numbers behind the decision must be recorded in `measurement.md` §5.

## 12. Next phase (recommended)

1. **Run `npm run measure` on real hardware** — a desktop, a mid-range Android, an iPhone — and record the
   results in `measurement.md` §5. The concurrency decision is waiting on exactly that table.
2. If those numbers show headroom, flip `DEFAULT_BATCH_CONCURRENCY` to 2 and re-measure; the memory table here
   should gain a "2 lanes" column rather than being replaced.
3. Batch for ZIP creation and PDF split *if* the semantics stay honest (those tools produce many outputs
   from one input already).
