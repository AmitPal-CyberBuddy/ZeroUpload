# ZeroUpload — architecture

This document is the design record for ZeroUpload: the constraints, the decisions, and the consequences.
It is written to be read before the source, so a contributor can decide whether a proposed feature belongs
in this product at all.

---

## 1. Governing principle

> Files should be processed locally in the user's browser whenever technically feasible.

Two corollaries shape every decision:

1. **No backend for file processing.** Not a "temporary" one, not a "just for large files" one. If an
   operation cannot be done in a tab, it is documented as unsupported.
2. **Honesty over completeness.** Limits, missing formats and browser-dependent behaviour are surfaced in
   the UI rather than hidden behind a spinner.

---

## 2. Technology stack

| Concern | Choice | Why |
| --- | --- | --- |
| UI runtime | React 19 | Component model + Suspense maps cleanly onto "one module per tool, lazy loaded" |
| Language | TypeScript (strict) | File-processing bugs are data-shape bugs; strict mode catches most of them at build time |
| Build | Vite 8 | Static output, first-class workers (`new Worker(new URL(...), { type: 'module' })`), per-route chunks |
| Routing | React Router 7, **path** history (`BrowserRouter`) | Every route is prerendered to its own `index.html`, so a deep link resolves on a static host with no rewrite rules — and the URL a crawler or a person sees is the canonical one |
| Styling | Hand-written CSS with custom properties | No runtime CSS-in-JS cost, no utility-class churn in markup; a token file gives dark/light switching for free |
| Fonts | Self-hosted Geist / Geist Mono (Fontsource) | No third-party request on load — a privacy product should not ping Google |
| Images | Browser codecs: `createImageBitmap` + `OffscreenCanvas` | Native, SIMD-optimised, zero download weight; no WASM codec bundle (~2 MB) needed for JPEG/PNG/WebP |
| PDF | `pdf-lib` (lazy, worker-only) | Pure JS, no WASM download, structural page operations; no rendering engine required. Measured from the last build: 552 kB raw / 238 kB gzip for the operations chunk that contains it (inside the worker, or the main-thread fallback), fetched only when a PDF tool runs |
| ZIP | `fflate` (lazy) | ~10 kB, fast deflate, streaming-friendly API |
| Hashing | WebCrypto `crypto.subtle.digest` | Native and constant-time implementations |

Deliberately **not** used: a component library (the design language is bespoke), an icon package (a 24px
geometric set is inlined instead), analytics, error-reporting SaaS, remote fonts.

### WebAssembly: where it would go

WASM is not used in V1 because the browser's native codecs already outperform a bundled encoder and add
zero download weight. The places where WASM genuinely earns its bytes, and which the architecture leaves
room for:

* **AVIF encoding** on browsers without a native encoder (libavif WASM, multi-megabyte — must stay opt-in
  and lazily fetched).
* **Video transcoding** (ffmpeg.wasm) — the reason video is explicitly out of scope for V1.
* **PDF rendering** for thumbnail previews (pdf.js / mupdf WASM) — a separate engine, lazily loaded.
* **OCR** (Tesseract WASM) — large language packs; needs progressive loading.

The rule: WASM is loaded on demand *inside a tool*, never in the entry chunk, and never silently.

---

## 3. Layering

```
┌──────────────────────────────────────────────────────────────┐
│ pages/            route-level composition                    │
├──────────────────────────────────────────────────────────────┤
│ tools/            one component per tool, per category       │
├──────────────────────────────────────────────────────────────┤
│ components/       layout chrome + reusable UI + file widgets │
├──────────────────────────────────────────────────────────────┤
│ hooks/            state machines: theme, toasts, object URLs, │
│                   image pipeline, encoder capability probes   │
├──────────────────────────────────────────────────────────────┤
│ lib/              framework-free processing modules          │
└──────────────────────────────────────────────────────────────┘
```

`lib/` has **no React import**. That keeps it testable, reusable in a worker, and safe to lazy-load. A tool
may use `lib/` and `components/`; `components/` must never import a tool.

### File-processing abstraction

Every tool follows the same pipeline vocabulary, expressed in two shared primitives:

* `lib/files/errors.ts` → `ToolError` (`code`, user-facing `message`, optional recovery `hint`) plus
  `assertWithinSize(file, category)`.
* `hooks/useImagePipeline.ts` → `idle → reading → decode → render → encode → done`, with `busy`, `error`,
  stale-run cancellation via a monotonic ticket, and `reset()`.

Adding a tool therefore means supplying *options and layout*, not re-implementing intake, validation,
progress, cancellation or error rendering.

```ts
// lib/image/processor.ts — the public image API every image tool shares
processImage(job, onStage): Promise<{ blob, width, height, durationMs, format }>
```

`job` is a plain, serialisable object (`{ format, quality, crop, rotate, flipH, flipV, maxWidth, ... }`),
which is what makes the worker boundary trivial: structured-clone the job, structured-clone the result.

---

## 4. Tool registry & extension model

```ts
// registry/tools.ts
{ slug, name, blurb, description, category, icon, status, tags, keywords }
```

* **Metadata is eager, implementation is lazy.** The registry is a few kB; `toolComponents.ts` maps slugs to
  `React.lazy(() => import(...))`, so a tool's code (and its libraries) download only when visited.
* The catalogue, the command palette (`⌘K`) and related-tool suggestions all derive from the same metadata —
  a new tool is discoverable everywhere with no extra wiring.
* `status: 'stable' | 'beta' | 'soon'` lets the catalogue advertise planned tools without shipping broken
  screens.

### Directory map

```
src/
├── registry/       categories.ts · tools.ts · toolComponents.ts
├── styles/         tokens.css · base.css · ui.css · layout.css · pages.css · workspace.css · tools.css
├── components/
│   ├── brand/      ZeroMark, ZeroWordmark
│   ├── layout/     SiteHeader, SiteFooter, CommandPalette, ErrorBoundary, paletteBus
│   ├── ui/         Icon, controls (Field, Segmented, RangeField, Toggle, Notice, CopyButton), Progress, Spinner
│   ├── file/       FileDrop, FileManifest
│   ├── batch/      BatchPanel (queue table, progress, ZIP packaging)
│   └── tool/       ToolLayout, Settings, StageTimeline, FileCard, CompareSizes, ResultPanel
├── hooks/          useTheme, useToast, useObjectUrl, useImagePipeline, useImageFormats, useImageBatch, useBatchQueue
├── lib/
│   ├── files/      format, mime (magic bytes), errors, budget, download, handoff
│   ├── image/      types, capabilities, render (pure geometry), processor, image.worker, ico, favicon
│   ├── batch/      types · queue (orchestration) · package (ZIP of successes)
│   ├── pdf/        protocol · ops (pdf-lib) · pdf.worker · client · pdf (public API) · ranges
│   ├── zip/        protocol · create · names · zip.worker · client · zip (public API + extraction)
│   ├── hash/       hash (WebCrypto)
│   └── dev/        text (JSON, Base64, URL — pure functions)
├── tools/          convert · compress · transform · pdf · archive · inspect · dev
└── pages/          Home, Tools, ToolRoute, Architecture, NotFound
```

---

## 5. Threading model

| Work | Thread | Rationale |
| --- | --- | --- |
| Image decode/encode/transform | Dedicated module worker (`image.worker.ts`) | A 40 MP AVIF encode blocks for seconds; the UI must stay scrollable and cancellable |
| Image geometry planning | Pure functions in `lib/image/render.ts` | Shared verbatim by worker and main-thread fallback |
| PDF operations | Dedicated module worker (`pdf.worker.ts`) | Measured (see §5a): on a 114 MB document the main thread stalls for 0.5–1.9 s when the work runs there, and 4–14 ms when it runs in the worker. `Blob` inputs cross the boundary as handles, so the main thread never holds the bytes |
| ZIP create (DEFLATE) | Dedicated module worker (`zip.worker.ts`) | Measured (§5c): packaging 30 batch results went from 818 ms of main-thread stall to 3 ms. Extraction stays on the main thread — it is bounded by the pre-inflate budget and its cost is dominated by the read itself |
| Favicon .ico assembly | Main thread, pure bytes | Building the directory for six payloads is a handful of typed-array writes (well under 1 ms); the expensive part — resizing and PNG encoding — is the image worker | A PNG payload needs no codec, so a worker would add a message round trip for nothing |
| Hashing | WebCrypto (native, non-blocking) | No streaming API, so input size is capped instead |
| Text tools | Main thread | Inputs are user-sized and bounded; a worker would add latency |

### 5a. What the measurements actually showed

Run on this repository's libraries with Node 22 (browser engines are typically 1–3× slower on low-end
devices). “Stall” is the longest gap observed by a 4 ms interval timer on the thread doing the work — i.e.
the time the UI could not respond.

**PDF: before and after moving `pdf-lib` into a worker** (same synthetic 114.5 MB, 10-page scan-like
document, same machine):

| Operation | Previous release (main thread) | Now, worker unavailable | Now, worker |
| --- | --- | --- | --- |
| Rotate 90° | 573 ms · stall **542 ms** | 681 ms · stall **628 ms** | 1021 ms · stall **4 ms** |
| Extract 2 pages | 288 ms · stall 0 ms | 346 ms · stall 0 ms | 460 ms · stall **7 ms** |
| Merge 2 × 114 MB | 1369 ms · stall **1326 ms** | 1998 ms · stall **1936 ms** | 1659 ms · stall **187 ms** |
| Describe a 68.7 MB document | — | 226 ms · stall 8 ms | 240 ms · stall **7 ms** |
| Split 300 pages into 300 files | ~6.9 s (old per-page re-parse) | 319 ms · stall 14 ms | 668 ms · stall **14 ms** |

Reading the table honestly:

* **Blocking is what changed.** Every operation takes roughly the same wall-clock time (sometimes 10–70 %
  longer, because the input is read inside the worker and results are copied out); the main thread went from
  freezing for up to 1.9 s to freezing for single-digit milliseconds.
* The merge row still shows a 187 ms blip. That is the receiving side of a 229 MB transfer plus process-wide
  GC in this harness — measured, not explained away. It is 10× better and it is not a parse.
* The 2022-era doubt (“PDF work is I/O-bound, it will be quick”) did not survive: it is quick only for small
  files. The fix was a worker, not a bigger number in a comment.

**Re-verified after the batch phase** (same code, two synthetic documents; “main” = the fallback path, i.e.
the same `ops.ts` called directly on the main thread):

| Operation | Worker: wall · stall | Main thread: wall · stall |
| --- | --- | --- |
| Rotate, 2 500 pages / 2.5 MB | 753 ms · **4 ms** | 791 ms · 51 ms |
| Split 250 groups × 10 pages | 684 ms · **5 ms** | 788 ms · 54 ms |
| Split 600 groups × 1 page | 660 ms · **8 ms** | 775 ms · 35 ms |
| Merge 3 × 200 pages | 1110 ms · **5 ms** | 841 ms · 72 ms |
| Extract 2 pages from 600 | 128 ms · **5 ms** | 141 ms · 17 ms |
| Describe 600 pages (worker cold start included) | 343 ms · **5 ms** | 137 ms · 26 ms |

The pattern holds: single-digit milliseconds of main-thread stall in exchange for 0–30 % more wall time
(and up to 2.5× on the first call, which pays for loading `pdf-lib` into a fresh worker). Client-level
behaviour re-verified against the built worker bundle: 30-document split with monotonic progress, abort
mid-split in 36 ms, pre-aborted signal never starts the worker, simulated worker crash → `worker-failed`
followed by a successful main-thread call, corrupt bytes → `corrupt-file` with a hint.

**Other measurements carried forward:**

| Test | Result |
| --- | --- |
| PDF `load + save`, 137 MB scan-like document (main thread, previous release) | 426 ms, stall ~316 ms, RSS +138 MB |
| Split “every page”, 300-page text PDF, **old** per-page re-parse | ~23 ms/page (≈ 6.9 s total) |
| Split “every page”, 300 pages, **parse-once** (shipped) | 342 ms total (~1.1 ms/page) |
| ZIP: 300 KB archive expanding to 300 MB, **old** post-hoc check | 788 ms, RSS +315 MB before rejection |
| ZIP: same bomb, **preflight** (shipped) | 2 ms, RSS +1 MB |
| Legitimate 410× text archive, old 220× ratio rule | falsely rejected |
| Image dimensions from headers vs. full decode | ~64 KB read instead of a full main-thread decode |
| `createZip` with 600 MB of inputs | rejected in **0.6 ms, zero bytes read** (`Blob.size` only) |
| Merge with 51 PDFs / 300 MB total | rejected in 1.2 ms / 0.2 ms, zero bytes read |
| Images → PDF with 160 MB total / 201 images | rejected in 0.5 ms / 0.2 ms, zero bytes read |
| Merge crossing the 3,000-page ceiling (4 × 800 pages) | rejected after **325 ms** — page counts are only known after parsing, but before any page is copied or saved |
| Cancel a 300-document split | client rejects in **86 ms**; the worker stops within 8 documents |

### 5b. The PDF worker protocol

`lib/pdf/` is split so the React layer never touches either the library or the thread:

| File | Role |
| --- | --- |
| `protocol.ts` | `PdfOperation` (describe/merge/split/extract/rotate/images→pdf), the single `PdfOutcome` result shape, wire encode/decode, `ToolErrorCode` in messages |
| `ops.ts` | The pdf-lib work. No DOM. Runs inside the worker, and on the main thread as a fallback |
| `pdf.worker.ts` | Message loop, structured errors, cooperative cancel flags |
| `client.ts` | Lazy singleton worker, request IDs, progress fan-out, `AbortSignal`, crash handling, fallback |
| `pdf.ts` | Public functions with the same signatures as before; also re-exports the pure helpers |

Four decisions worth recording:

1. **Inputs are `Blob`s, not `ArrayBuffer`s.** A Blob crosses the worker boundary as a handle, so the main
   thread never allocates a 100 MB buffer just to hand it over, and one document is read at a time inside the
   worker. A transferable `ArrayBuffer` would be zero-copy at the boundary but would force every source into
   memory first — worse for the merge case that matters.
2. **Outputs are transferred.** `encodePdfOutcome` moves each result buffer to the main thread (slicing only
   when the view does not exactly cover its buffer), so the worker drops its copy instead of keeping a
   duplicate alive while the UI holds the Blob.
3. **Progress is per document.** Split emits one event per output file (300 events for 300 files), merge one
   per source, images→PDF one per image; the last tenth is reserved for serialisation. It is real work
   completed, not a timer.
4. **Cancellation is cooperative and honest.** `AbortSignal` rejects the caller immediately; the worker is
   told to stop and checks between documents, yielding to its event loop every 8 documents so the cancel
   message can actually be dispatched (without that yield, a loop of resolved promises never returns to the
   macrotask queue and the message arrives after the batch has finished — this was found by test, not in
   review). A single `save()` cannot be interrupted, and the UI does not pretend otherwise.

Failure behaviour: if a worker cannot be constructed the same `ops.ts` runs on the main thread; if the worker
dies mid-job the job is rejected as `worker-failed`, the worker is discarded, and later jobs use the main
thread rather than silently retrying (a crash usually means the same input crashes again).

All three workers use a **request-ID protocol**, so concurrent operations cannot interleave results. When a
worker cannot be created (no `OffscreenCanvas`, no module workers, a CSP that forbids them) the same code
runs on the main thread with identical output — a graceful degradation, not a separate code path. The image
worker is recreated after a crash; the PDF and ZIP workers additionally fall back to the main thread,
because a crash there is far more likely to be about the document than about the thread.

### 5c. The ZIP worker

Archive creation got the same treatment as the PDF engine, because it was the last operation that could
freeze the interface: packaging a batch of results deflated every entry on the main thread.

| File | Role |
| --- | --- |
| `zip/protocol.ts` | `ZipOperation`, `ZipProgress` (files, not bytes), wire encode/decode, progress → ratio |
| `zip/create.ts` | The builder: budget from metadata, sanitising, duplicate renaming, progress, cancellation |
| `zip/zip.worker.ts` | Message loop; runs `create.ts` with `syncDeflate` (already off-thread, no nested worker) |
| `zip/client.ts` | Lazy singleton worker, request ids, coalescing, `AbortSignal`, crash → fallback |
| `zip/zip.ts` | Unchanged public `createZip()`, extraction and the inspection budget |
| `zip/names.ts` | `sanitizeEntryName` / `uniqueEntryName`, shared by creation and extraction |

Decisions worth recording:

1. **One implementation, two hosts.** The worker only transports; every guard lives in `create.ts`, so the
   fallback path cannot drift from the worker path.
2. **`syncDeflate` inside the worker.** `fflate`'s async API spawns its own worker and copies every entry
   across a boundary. Already off the main thread, a single `zipSync` is both simpler and faster — measured
   at 2–4× the old wall-clock time on the same inputs.
3. **Progress counts files.** One event per entry, one when DEFLATE starts; coalesced to one ratio per
   60 ms in the client, with a guaranteed final `1`.
4. **Cooperative cancel.** The worker is told to stop and checks between entries (yielding every 8) and
   again after DEFLATE. Measured abort → rejection: 0–1 ms.

Measured on the batch workload that motivated it (30 results × 0.6 MB, 18.0 MB archive):

| | wall | main-thread stall | progress events |
| --- | --- | --- | --- |
| before (main thread, fflate async) | 2203 ms | **818 ms** | 31 |
| after (ZIP worker) | 676 ms | **3 ms** | 3 |

The larger case (120 × 0.6 MB) went from **4957 ms / 4295 ms stall** to **1097 ms / 3 ms**. Full tables,
including the small-file case where the worker is marginally slower, are in
[`batch-processing.md`](batch-processing.md) §10a.

### 5d. The favicon pipeline

`/tools/favicon` turns one image into a complete icon set, and it shows how the layers are meant to combine —
including one place where a worker would be theatre.

```
source image
  │  validateImage()        header probe only: dimensions, size budget, SVG refused
  ▼
processImage()  ×1          centre-cropped square, rendered at 512px      → image worker
  ▼
processImage()  ×6          512 → 256 · 192 · 180 · 48 · 32 · 16          → image worker
  ▼
buildIco()                  directory + PNG payloads, main thread, < 1 ms
buildWebManifest()          relative paths for a project subpath
buildHeadSnippet()          relative paths, PNG links before the .ico
  ▼
createZip()                 "Download all as ZIP"                          → ZIP worker
```

| Decision | Why |
| --- | --- |
| One decode at 512px, then downscale | Seven decodes of a 20 MP photo cost seconds; one decode plus six resizes of a 512px bitmap costs milliseconds |
| PNG payloads inside the `.ico` | The DIB/BMP path is the only genuinely awkward part of the format, and every current browser plus Windows Vista+ accepts PNG entries |
| `buildIco` refuses a payload whose IHDR disagrees with the declared edge | A mismatched entry renders at the wrong size in a taskbar and nowhere else — the kind of bug nobody reports, they just leave |
| Entries sorted by size | Same input, same bytes, which is what makes byte-level tests possible |
| Assembly stays on the main thread | Six typed-array writes; the cost was resize + PNG encode, and that is already in the worker |
| Relative `href`s and `start_url: './'` | The set has to work at a project subpath, not only at a domain root |
| SVG refused | It is a scriptable document, and rasterising one reliably is browser-dependent. The tool says so and asks for a PNG |
| `release` drops the bytes but keeps the list | Sizes are metadata; the snippet and manifest stay readable after the blobs are gone |

Security surface, in full: the source goes through the same `validateImage` gate as every other image tool
(magic-byte type check, extension-mismatch warning, 120 MB ceiling, SVG and HEIC refused); the `.ico` builder
accepts only PNG payloads whose declared dimensions it verifies, caps the entry count at 12 and the payload at
4 MB; the generated manifest is written with `JSON.stringify`, so a site name cannot break the file; and the
archive goes through the same budgeted `createZip` as every other download.

Measured (Node 22, the same pure functions the browser runs): `buildIco` on a realistic set — four payloads,
101 kB total, up to 256px — takes **0.07 ms**; manifest plus snippet take 0.007 ms. An input file change is
irrelevant; the only real cost in this tool is the browser's own codec time, which is why the resizes go to the
worker and the assembly does not.

Covered by 22 committed tests (`tests/favicon.test.ts`): directory layout, the 256 → 0 encoding, deterministic
ordering, verbatim payloads (including a payload that is a view into a larger buffer), every rejection path,
manifest JSON and escaping, and the exact `<head>` snippet.

---

## 6. Library choices per capability

| Capability | Library | Loaded |
| --- | --- | --- |
| Image conversion / compression | Browser codecs via canvas | never (built in) |
| Resize / crop / rotate / flip | 2D canvas | never |
| PDF merge / split / rotate / protect / unlock | `@cantoo/pdf-lib` | on first PDF tool use (552 kB raw / 238 kB gzip, own chunk, or the same code in the worker) |
| ZIP create/extract | `fflate` (plain) · `@zip.js/zip.js` (encrypted) | on first archive tool use: ~7 kB gzip for fflate, ~66 kB for zip.js, fetched only when a password is set |
| SHA-256 / SHA-512 / SHA-1 | WebCrypto | never |
| JSON / Base64 / URL | first-party pure functions | small chunk |
| Encoder capability probing | 2×2 canvas `toBlob` probe, cached | once per session |

---

## 7. GitHub Pages deployment

* `vite.config.ts` sets `base: './'` → assets resolve relatively, so the same artifact works at a project
  subpath, a custom domain, or a subdirectory.
* `resolve.mainFields: ['browser', 'main']` → dependencies resolve their CommonJS entry points. `pdf-lib`'s
  ESM build imports files it does not ship (`./form.js`) and so do its dependencies
  (`@pdf-lib/standard-fonts/es` asks for `all-encodings.compressed.json.js`); with the default field order a
  *clean* checkout failed to build the PDF worker chunk. Preferring `main` makes the entry bundle, the
  fallback chunk and the worker resolve identically. Cost: the PDF chunk is ~20 kB gzip larger; benefit: the
  build no longer depends on a warm dependency-optimiser cache.
* `BrowserRouter` plus prerender → every route is a real `index.html` in the artifact, so deep links work
  without SPA fallback configuration, and the old `/#/tools/x` form is rewritten to `/tools/x/` on boot by
  `migrateHashLink()`.
* `.github/workflows/deploy.yml` runs `npm ci` → `tsc -b` → `npm test` → `vite build` → `actions/deploy-pages`.
  A failing unit test blocks the deploy.
* No environment variables or secrets are needed; there is no server to configure.

Trade-off: prerendering writes one HTML file per route (30 documents, not one), and the deploy step has to
know the site's origin for canonicals and the sitemap — `SITE_URL`, defaulting to the project Pages URL.
What it buys is path URLs that need no rewrite shim: GitHub Pages already serves `tools/crop/index.html`
for `/tools/crop/`.

---

## 8. Security model

Summary (full list in `SECURITY.md`):

* Signature sniffing against declared MIME type; mismatch is displayed.
* Size caps per category, plus **cumulative budgets per multi-input operation** (ZIP creation, PDF merge,
  images→PDF; item counts, total bytes and output page counts) evaluated from metadata before any byte is
  read.
* **ZIP budgets enforced from the central directory before any inflation**, plus per-entry re-checks during
  extraction and a verification pass afterwards.
* Archive entry sanitisation (traversal, absolute paths, drive letters, duplicates); contents are
  downloadable only.
* SVG refused (scriptable document; renderer-dependent rasterisation).
* Single blob-URL lifecycle hook; downloads revoke after starting.
* No `innerHTML`/`dangerouslySetInnerHTML`; all file-derived strings render as text.
* Self-hosted fonts, no third-party scripts, no telemetry, production source maps off.
* Documented residual risks: tab memory exhaustion, host integrity, untrusted downloaded content.

---

## 9. Performance model

* **Bytes, not copies.** Files stay as `File`/`Blob` handles until a codec needs bytes. Conversions never
  round-trip through base64 or JSON.
* **One decode, one encode.** A transform draws the source once at final geometry — no sequential
  re-encodes.
* **Progressive disclosure of cost.** Libraries load with the tool, not with the app; `pdf-lib` loads inside
  the PDF worker and never in the entry chunk. Worker pre-warm happens when a tool mounts, not on the homepage.
* **Cancellation over blocking.** Every pipeline run carries a ticket; superseded runs discard their results
  so a fast second click cannot be overwritten by a stale first result.
* **Object URL discipline.** Created and revoked in one place; download URLs revoked on a timer after the
  browser has begun saving.
* **Clear progress.** Reading → Processing → Complete is driven by real worker stage events, not a fake
  timer.

---

## 10. Risks & technical limitations

| Risk | Impact | Mitigation / decision |
| --- | --- | --- |
| AVIF encode support varies | Option unavailable on some browsers | Runtime probe; option disabled with a tooltip rather than silently producing PNG |
| EXIF/ICC handling | Colour shifts, lost orientation | `imageOrientation: 'from-image'` on decode; ICC profile passthrough is not reliable — documented, not faked |
| Memory pressure on huge images | Tab crash | Size caps, decode error handling, worker isolation |
| WebCrypto absent (non-HTTPS) | Hashing unavailable | Detected and explained in the UI |
| Browser codec differences | Output bytes differ per browser | Expected and stated; the UI reports measured bytes rather than claiming determinism |
| pdf-lib gaps (AcroForm flattening, encryption) | Some PDFs cannot be processed | Encrypted PDFs rejected with a reason; flattening not offered |
| One prerendered HTML file per route | A bigger artifact than a single page | Accepted: 30 documents total, which is what buys path URLs and per-page metadata on a static host |
| Test coverage is narrow on purpose | Untested code drifting from documented behaviour | 469 unit tests and 44 render tests cover the security/correctness core (ZIP budgets, sanitisation, page ranges, header parsing, size guards, worker protocol, ops end-to-end) and mount every tool and route — see §11 |
| PDF worker bundle duplication | +238 kB gzip of `pdf-lib` in the fallback chunk | The fallback chunk is only fetched when a worker cannot be created; normal users download the worker copy only. Accepted rather than shipping a broken fallback |
| Cooperative PDF cancellation | A `save()` in flight cannot be interrupted | Cancel takes effect between documents (measured: 86 ms from abort on a 300-document split); the UI says “cancelling” rather than claiming an instant stop |
| Multi-file totals | Resource exhaustion across many files | Cumulative budgets for every multi-input operation (bytes, item counts, output pages), enforced from metadata before reading; page ceilings are checked as documents load, before any copying |
| Batch result retention | A long batch pins hundreds of MB of output | Explicit `maxOutputBytes` ceiling: the queue pauses (never silently drops) at 300 MB of held results, and release is a first-class per-row action. Measured: 50 results = 200 MB RSS; releasing 40 = 160 MB returned |
| ZIP archive holds a second copy while it is built | Peak memory ≈ results + archive | The archive is built inside the worker and transferred back, so the main thread only ever holds results plus the finished archive. Bounded by the 300 MB batch output ceiling |

---

## 11. Verification performed

There is no browser in this environment, so verification used executable harnesses instead of assertions:

* **Routing/render**: every route (20 tools/pages + 404) rendered through React in jsdom with no console
  errors; hash-router navigation exercised.
* **Object URLs**: create/revoke counted across mount, unmount, replacement and download (0 live after
  teardown).
* **ZIP**: real bomb built with fflate, traversal-name archive, entry-count ceiling, legit high-ratio
  archive, cumulative create budget.
* **PDF**: throughput and event-loop stalls on synthetic 1.4 MB → 137 MB documents, measured on the main
  thread and through the worker; the worker protocol exercised over `worker_threads` with the *built* worker
  bundle (progress ordering, transferred buffers, structured error codes, cancel mid-batch, crash recovery,
  `Blob` handle transport).
* **PDF client**: abort before start, abort mid-job (86 ms), worker crash → `worker-failed` then main-thread
  fallback, structured hints.
* **Budgets**: every cumulative guard measured with blobs that throw on `arrayBuffer()`, proving a rejection
  never reads the input.
* **Image headers**: PNG/JPEG/GIF/WebP(+lossless) fixtures and negative cases against the dimension parser.
* **Unit tests (committed)**: `npm test` → 10 files, 175 tests, ~2.6 s, Node environment, no DOM and no browser
  stubs. Covers the ZIP security model, page-range and chunk logic, header parsing, size guards, error codes,
  the worker protocol encoding, real pdf-lib operations end-to-end, the whole batch queue (budgets,
  states, progress coalescing, cancellation, retention) and ZIP packaging through the client, including the
  fallback and crash paths.
* **ZIP worker**: before/after on the packaging workload (818 ms → 3 ms of main-thread stall), cancellation
  latency, progress coalescing, crash → fallback, and the built worker bundle exercised end-to-end through
  the client. Tables in `batch-processing.md` §10a.
* **Batch**: the same queue driven in Node with a modelled worker round trip (10 / 50 / 250 MB / mixed /
  failing / cancelled) for wall time, main-thread stall, RSS, item count and retained bytes; queue overhead
  measured against a plain loop at 0.23–0.33 ms per item. In jsdom, all four image tools complete a real
  batch through React: failure isolation, retry, cancel mid-item and a 51-file budget refusal. Details and
  the tables live in [`batch-processing.md`](batch-processing.md).
* **Colour**: WCAG contrast computed for every token pair used as text; 9 failing pairs found and fixed.
* **Bundle/deploy**: external URLs grepped from the production bundle (none), assets served from a
  `/ZeroUpload/` subpath, worker URL resolution inspected in the built chunk.

Not verified (no browser): real codec support, actual `OffscreenCanvas` behaviour, visual layout.

## 12. Batch processing

Batch execution is an explicit layer on top of the single-file primitives: `Tool → single execution |
batch execution → BatchQueue → (validateImage + processImage)`. Concurrency is fixed at 1, budgets are
cumulative and metadata-only, results are released explicitly, and cancellation is cooperative and
described honestly in the UI. Image compress/convert/resize/transform support it; the PDF tools keep their
own multi-input semantics. The queue can run more than one lane, but ships at one: a real-codec measurement
shows 1.45–1.94× wall time for one to two extra bitmaps, and that trade needs a browser measurement on real
devices before it is made ([`measurement.md`](measurement.md)). Full design, states, budget table and
measurements: [`batch-processing.md`](batch-processing.md).

---

## 13. What comes next (and what does not)

Ordered by value per unit of complexity:

1. Batch extraction for the archive tools, only if the output semantics stay honest.
2. A codec measurement in a real browser — the harness now exists (`scripts/measure`, `measurement.md`);
   what is missing is a run on real hardware.
3. Crop-geometry and JSON/base64 unit tests to widen the committed suite beyond the security core.
4. PDF preview thumbnails via a lazily loaded rendering engine (and a second worker).
5. Opt-in WASM AVIF encoding on browsers without native support.
6. Bounded batch concurrency (2): implemented, measured with a real codec (1.45–1.94× wall time for one to
   two extra bitmaps) and **left off** until `npm run measure` confirms it on the devices the decision is for.
   See [`measurement.md`](measurement.md) and `batch-processing.md` §10b.
7. Video: only with a clear, honest UX around ffmpeg.wasm download size and memory limits — or not at all.

Delivered from this list: image → ICO/favicon generation (§5d).

Rejected by design: user accounts, cloud sync, "AI" file endpoints, anything that requires a server to hold
a file.
