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
| Routing | React Router 7, **hash** history | Static hosts have no rewrite rules; hash URLs keep deep links working on project subpaths |
| Styling | Hand-written CSS with custom properties | No runtime CSS-in-JS cost, no utility-class churn in markup; a token file gives dark/light switching for free |
| Fonts | Self-hosted Geist / Geist Mono (Fontsource) | No third-party request on load — a privacy product should not ping Google |
| Images | Browser codecs: `createImageBitmap` + `OffscreenCanvas` | Native, SIMD-optimised, zero download weight; no WASM codec bundle (~2 MB) needed for JPEG/PNG/WebP |
| PDF | `pdf-lib` (lazy) | Pure JS, no WASM download, structural page operations; no rendering engine required |
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
│   ├── ui/         Icon, controls (Field, Segmented, RangeField, Toggle, Notice, CopyButton), Spinner
│   ├── file/       FileDrop, FileManifest
│   └── tool/       ToolLayout, Settings, StageTimeline, FileCard, CompareSizes, ResultPanel
├── hooks/          useTheme, useToast, useObjectUrl, useImagePipeline, useImageFormats
├── lib/
│   ├── files/      format, mime (magic bytes), errors, download, handoff
│   ├── image/      types, capabilities, render (pure geometry), processor, image.worker
│   ├── pdf/        pdf (lazy pdf-lib wrappers)
│   ├── zip/        zip (fflate + limits)
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
| PDF operations | Main thread | pdf-lib work is memory- and I/O-bound rather than long CPU bursts; moving it to a worker would double peak memory for a 200 MB document |
| ZIP deflate | Main thread (async callbacks) | Same reasoning; entry-level limits keep each step short |
| Hashing | WebCrypto (native, non-blocking) | No streaming API, so input size is capped instead |
| Text tools | Main thread | Inputs are user-sized and bounded; a worker would add latency |

The worker boundary is a **one-worker pool with request IDs**, so concurrent operations cannot interleave
results, and a crashed worker is terminated and recreated on the next job. When `OffscreenCanvas` is
unavailable, the same pipeline runs on the main thread with identical output — a graceful degradation, not
a separate code path.

---

## 6. Library choices per capability

| Capability | Library | Loaded |
| --- | --- | --- |
| Image conversion / compression | Browser codecs via canvas | never (built in) |
| Resize / crop / rotate / flip | 2D canvas | never |
| PDF merge / split / rotate / images→PDF | `pdf-lib` | on first PDF tool use (~420 kB, own chunk) |
| ZIP create/extract | `fflate` | on first archive tool use (~10 kB gzip) |
| SHA-256 / SHA-512 / SHA-1 | WebCrypto | never |
| JSON / Base64 / URL | first-party pure functions | small chunk |
| Encoder capability probing | 2×2 canvas `toBlob` probe, cached | once per session |

---

## 7. GitHub Pages deployment

* `vite.config.ts` sets `base: './'` → assets resolve relatively, so the same artifact works at a project
  subpath, a custom domain, or a subdirectory.
* `HashRouter` → deep links do not require `404.html` rewrites or SPA fallback configuration.
* `.github/workflows/deploy.yml` runs `npm ci` → `tsc -b` → `vite build` → `actions/deploy-pages`.
* No environment variables or secrets are needed; there is no server to configure.

Trade-off: hash URLs (`/#/tools/crop`) are slightly less pretty than path URLs. The alternative is coupling
the build to a repository name and adding rewrite shims; reliability on a static host wins.

---

## 8. Security model

Summary (full list in `SECURITY.md`):

* Signature sniffing against declared MIME type; mismatch is displayed.
* Size caps per category; ZIP bomb ceilings (entries, expanded bytes, per-entry bytes, ratio).
* Archive entry sanitisation; contents downloadable only.
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
* **Progressive disclosure of cost.** Libraries load with the tool, not with the app. Worker pre-warm happens
  when an image tool mounts, not on the homepage.
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
| Hash routing | Less pretty URLs | Accepted for static-host reliability |
| No tests yet | Regressions in pure logic | `lib/` is React-free and pure by design specifically so it can be unit-tested; a Vitest suite is the next engineering step |

---

## 11. What comes next (and what does not)

Ordered by value per unit of complexity:

1. A unit-test suite over `lib/` (pure functions: ranges, crop geometry, limits, base64, JSON stats).
2. Image → ICO/favicon generation, and batch processing with a queue.
3. PDF preview thumbnails via a lazily loaded rendering engine.
4. Opt-in WASM AVIF encoding on browsers without native support.
5. Video: only with a clear, honest UX around ffmpeg.wasm download size and memory limits — or not at all.

Rejected by design: user accounts, cloud sync, "AI" file endpoints, anything that requires a server to hold
a file.
