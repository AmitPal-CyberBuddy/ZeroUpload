# Measurement: the image codec and the case for a second batch lane

The batch memory table in [`batch-processing.md`](batch-processing.md) was arithmetic: a decoded bitmap is
`width × height × 4` bytes, plus a copy while the encoder runs. That is enough to set a budget and not enough
to decide whether a second batch lane is worth its memory — which is the one question this file exists to
answer with numbers.

Two instruments, because neither alone is sufficient:

| Instrument | What it measures | What it cannot |
| --- | --- | --- |
| `scripts/measure/index.html` (browser) | The browser's own codec, in the tab, at the sizes you care about | Needs you to run it on the devices that matter |
| `bench-codec.mjs` / `bench-queue-codec.mjs` (Node, skia) | A real codec (libjpeg/libpng/libwebp) over synthetic photographs, with the real `BatchQueue` | It is not the browser's codec, and RSS is not tab memory |

Neither is a substitute for the other. The Node harness gives repeatable numbers today; the browser probe is
how the decision gets confirmed on real hardware.

---

## 1. Running the browser probe

```bash
npm run measure
# → http://localhost:5180/scripts/measure/index.html
```

The dedicated dev server (see `scripts/measure/vite.config.ts`) sends
`Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`. That makes the page
cross-origin isolated, which is the only way `performance.measureUserAgentSpecificMemory()` — the API that can
actually see `ImageBitmap` and canvas memory — is available. Without it the probe falls back to
`performance.memory.usedJSHeapSize`, which **does not count** decoded images, and says so in the
`Memory source` column.

The page loads no third-party resources and uploads nothing. It:

1. synthesises a photograph-like image (gradients + noise, so JPEG cannot cheat) at the chosen size and encodes
   it once, so every item decodes the same bytes;
2. runs the compressor's exact work per item — decode, downscale to 1600px, re-encode at q82 — holding the
   results in memory the way the app does;
3. repeats that with one, two (and optionally three) lanes, sampling peak memory every 250 ms, long tasks via
   `PerformanceObserver`, and worst event-loop lag from a 50 ms interval timer;
4. prints a verdict, and a JSON blob to paste into §5 below.

Available workloads: 2 MP × 50, 8 MP × 20, 12 MP × 10. The per-item times in the table are medians; the
verdict uses wall time.

Reading it:

* **speedup ≥ 1.3× and peak memory up by ≤ 128 MB** → the second lane is doing real work on this machine.
* **speedup < 1.3×** → the codec is not the bottleneck, or the device has fewer than four logical processors;
  a second lane buys latency you cannot perceive.
* **worst lag above ~100 ms** → the main thread is being asked to do too much; that is about the worker
  boundary, not the lane count, and lowering concurrency will not fix it.

---

## 2. Node harnesses

```bash
# a real codec, raw lanes, no orchestrator
cd /tmp/zu8 && node --expose-gc bench-codec.mjs

# the same workload through the shipped BatchQueue
cd /tmp/zu8 && node --expose-gc bench-queue-codec.mjs
```

Both use `@napi-rs/canvas` (skia: libjpeg, libpng, libwebp) over a deterministic synthetic photograph, on
Node 22.22.3, one machine. `--expose-gc` matters: without a forced collection the baseline carries the previous
run's garbage.

---

## 3. Results — real codec, raw lanes

Wall time for the whole workload; peak is process RSS, which includes the ~90–145 MB Node baseline.

| Workload | lanes | wall | peak RSS | per item | speedup |
| --- | --- | --- | --- | --- | --- |
| 2 MP × 50 | 1 | 2774 ms | 229 MB | 55 ms | — |
| 2 MP × 50 | 2 | 1824 ms | 263 MB | 36 ms | **1.52×** |
| 8 MP × 20 | 1 | 2301 ms | 421 MB | 115 ms | — |
| 8 MP × 20 | 2 | 1187 ms | 490 MB | 59 ms | **1.94×** |
| 12 MP × 10 | 1 | 1597 ms | 478 MB | 160 ms | — |
| 12 MP × 10 | 2 | 919 ms | 542 MB | 92 ms | **1.74×** |

The memory column is the honest part: the delta is +34 MB at 2 MP, +69 MB at 8 MP, +64 MB at 12 MP. Two
concurrent decodes of an 8 MP photo predict +60 MB (two 30 MB bitmaps), and that is what it costs. The
arithmetic in `batch-processing.md` holds; it was never the model that was wrong.

## 4. Results — the same workload through `BatchQueue`

Same fixtures, `concurrency: 1` versus `concurrency: 2` on the shipped orchestrator, so budgets, state
transitions, retention accounting and progress coalescing are all included.

| Workload | lanes | wall | peak RSS | per item | completed | notifications | speedup |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2 MP × 50 | 1 | 2708 ms | 225 MB | 54 ms | 50 | 103 | — |
| 2 MP × 50 | 2 | 1867 ms | 240 MB | 37 ms | 50 | 103 | **1.45×** |
| 8 MP × 20 | 1 | 2180 ms | 389 MB | 109 ms | 20 | 43 | — |
| 8 MP × 20 | 2 | 1196 ms | 436 MB | 60 ms | 20 | 43 | **1.82×** |
| 12 MP × 10 | 1 | 1582 ms | 520 MB | 158 ms | 10 | 23 | — |
| 12 MP × 10 | 2 | 905 ms | 590 MB | 91 ms | 10 | 23 | **1.75×** |

Three things worth noting:

1. **The queue costs nothing.** Raw lanes took 2774 / 1824 ms; through the queue, 2708 / 1867 ms. The
   orchestrator is inside the noise of the codec it is sequencing.
2. **Notification counts are identical** (103 / 43 / 23) with one lane and two. The 60 ms coalescing window is
   what limits renders, not the lane count, so a second lane does not make the UI busier.
3. **Retained result bytes are identical** (13.2 / 1.4 / 0.6 MB), because retention is a property of the batch,
   not of how many lanes produced it.

---

## 5. Results log — browser probe

Fill this in from `npm run measure`. The decision below should be revisited once there are entries from a
low-end device as well as a desktop.

| Date | Device / browser | Workload | 1 lane | 2 lanes | Speedup | Peak memory Δ | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| _to be measured_ | | | | | | | |

---

## 6. The decision

**The product ships `DEFAULT_BATCH_CONCURRENCY = 1`.** The measurements above show a real 1.45–1.94× speedup
on a desktop-class machine and a real cost of one to two extra full-resolution bitmaps (7 MB at 2 MP, up to
70 MB at 12 MP). Both facts are true at once, and which one matters depends on the device:

* On a phone or a 4 GB laptop, the extra 70 MB is the difference between finishing a 12 MP batch and having
  the tab killed. A user sees a killed tab once and never comes back.
* On a desktop with memory to spare, a 50-image batch drops from 2.7 s to 1.9 s — noticeable, but the batch is
  already asynchronous and cancellable, so the user experiences "working" either way.

The asymmetry decides it: a slower batch is an annoyance, a killed tab is data loss. Concurrency stays 1 until
the browser probe shows headroom **on the devices the decision is for**, not just on the fastest one.

### If the browser numbers justify it

One line, because the option already exists and is tested (`tests/batch-concurrency.test.ts`, 13 tests):

```ts
// src/lib/batch/queue.ts
export const DEFAULT_BATCH_CONCURRENCY = 2;
```

Everything else already honours it: `useImageBatch` passes the constant into `useBatchQueue`, which passes it
to `BatchQueue`, which runs that many lanes. The semantics that were verified before the flag existed:

* items still start in queue order;
* a failure in one lane does not stop the other;
* cancellation stops both lanes, marks in-flight items `cancelled` and leaves the rest `pending`;
* the output budget is checked before each item, so the overshoot is bounded by (lanes − 1);
* progress stays monotonic and aggregate progress still ends at 1.

### If they do not

Nothing changes; `docs/batch-processing.md` §12 keeps the next phase pointed at real-device measurement rather
than throughput.

---

## 7. Caveats, stated

* **skia is not the browser.** Chrome's JPEG encoder, Safari's and Firefox's all differ in speed and memory.
  The Node numbers establish the *shape* of the trade-off (linear wall-time win, one-to-two-bitmap memory
  cost), not the exact ratio you will see.
* **RSS is not tab memory.** Process RSS includes allocator slack and the Node baseline; a browser tab's
  attribution differs. The browser probe with `measureUserAgentSpecificMemory()` is the honest number.
* **One machine, one run per configuration.** Variance between runs is a few percent, which is well below the
  effects being compared, but these are not repeated trials.
* **`usedJSHeapSize` undercounts images**, sometimes by an order of magnitude. A probe that reports that source
  cannot settle a memory question — only a wall-time one.
