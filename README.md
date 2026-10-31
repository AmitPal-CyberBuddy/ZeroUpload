# ZeroUpload

**Convert. Compress. Transform. Locally.**

ZeroUpload is a privacy-first file utility platform that runs entirely in your browser. Convert images,
compress them, resize, crop, rotate, merge PDFs, build archives, inspect files and hash them — without a
single byte of the file ever leaving your device.

There is no backend. Not "we delete your files afterwards" — there is no upload endpoint at all. Open your
browser's network panel while you work: after the initial page load, it stays quiet.

---

## Why

Most online converters ask you to upload potentially sensitive documents to a server you do not control,
wait in a queue, then download a result and hope the copy was deleted. Modern browsers already contain
everything needed to do the work locally: canvas encoders, WebAssembly, WebCrypto, workers.

ZeroUpload is an opinionated, polished surface for those capabilities.

## What is implemented

| Category | Tools |
| --- | --- |
| **Convert** | Image converter (JPEG · PNG · WebP · AVIF where the browser can encode it), favicon generator (.ico + PNG set + manifest) |
| **Compress** | Image compressor with quality presets, downscaling and measured before/after sizes |
| **Transform** | Resize, crop (interactive frame + aspect presets), rotate & flip |
| **PDF** | Merge, split/extract pages, rotate, images → PDF |
| **Archive** | Create ZIP, extract ZIP (with bomb + traversal protection) |
| **Inspect** | File inspector: real type from magic bytes, dimensions, PDF/ZIP metadata, SHA-256 |
| **Developer** | JSON formatter, Base64 encoder/decoder, URL encoder/decoder, hash generator |

Every tool is an independently loaded module. Opening the image compressor never downloads the PDF engine.

**Batch mode** is available in the image tools (compress, convert, resize, rotate/flip): up to 50 images,
processed one at a time, with per-file and overall progress, per-file failure isolation and retry,
cooperative cancellation, explicit result release and ZIP packaging of the successes. Cumulative budgets
(50 files / 300 MB input / 300 MB retained output) are checked from file metadata before anything is read.
See [`docs/batch-processing.md`](docs/batch-processing.md).

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static output in dist/
npm run preview    # serve the production build
npm test           # unit tests (Vitest, Node — no browser needed)
npx tsc -b         # type check
```

Node 22+ is recommended.

## Architecture in one screen

```
your disk ──File API──► React UI ──► tool module ──► worker / WASM / WebCrypto
                                            │
                        Blob ◄── result ────┘
                          │
                    <a download> ──► your disk
```

* **Static site only.** Vite builds plain HTML/CSS/JS. The output can be hosted on GitHub Pages, Netlify,
  S3, or a USB stick.
* **Tool registry as the extension point.** Adding a tool means adding one metadata entry
  (`src/registry/tools.ts`), one lazy import (`src/registry/toolComponents.ts`), and one component. It then
  appears in the catalogue, the command palette and search automatically.
* **Shared processing layer.** `src/lib/` holds framework-free modules (`image/`, `pdf/`, `zip/`, `hash/`,
  `dev/`, `files/`) with no React dependency, so they are testable and reusable.
* **Image work runs in a worker.** Decode → draw → encode happens in a module worker over
  `OffscreenCanvas`, with a main-thread fallback for browsers without it.
* **PDF work runs in its own worker.** `pdf-lib` never touches the main thread: operations are messages,
  progress comes back as events, results are transferred buffers, and cancellation is cooperative. Measured
  on a 114 MB document: worst main-thread stall dropped from ~1.9 s to 4–14 ms.
* **ZIP creation runs in a third worker**, so packaging a batch of results cannot freeze the interface.
  Measured on 30 results / 18 MB: main-thread stall dropped from 818 ms to 3 ms, with 0–1 ms cancellation.
* **Deterministic outputs are unit-tested byte by byte.** The `.ico` directory, the generated web manifest
  and the `<head>` snippet are pure functions in `src/lib/image/`, so the committed suite asserts their exact
  bytes rather than trusting a screenshot.
* **Heavy libraries are lazy.** `pdf-lib` and `fflate` are imported inside the code path that needs them.
* **Hash routing + relative asset paths.** Deep links work on GitHub Pages project URLs
  (`/ZeroUpload/#/tools/crop`) with no rewrite configuration.

Full details, including the security model and known limitations, are in:

* [`docs/architecture.md`](docs/architecture.md) — stack, layering, threading, libraries, deployment, risks.
* [`docs/product-and-design.md`](docs/product-and-design.md) — product structure, states, visual system, motion.
* The app's own **How it works** page.

## Deployment

A workflow at `.github/workflows/deploy.yml` builds and publishes `dist/` to GitHub Pages on every push to
`main`.

To enable it: **Settings → Pages → Build and deployment → Source: GitHub Actions**.

Because `vite.config.ts` uses `base: './'` and hash routing, no repository-name configuration is required —
the same artifact works at `https://user.github.io/ZeroUpload/`, at a custom domain root, or when opened
from disk.

## Security posture

Local processing is not automatically safe, and this project does not pretend otherwise. In short:

* File signatures are checked against extension claims.
* Input sizes are capped per category (images 120 MB, PDFs 200 MB, archives 400 MB), and every multi-input
  operation has a cumulative budget checked from file metadata *before* anything is read (ZIP creation
  2,000 files / 512 MB; PDF merge 50 documents / 250 MB / 3,000 pages; images → PDF 200 images / 150 MB).
* ZIP budgets (entry count, expanded size, per-entry size) are enforced from the central directory *before*
  inflation, and paths are sanitised.
* SVG input is refused rather than rasterised.
* Blob URLs are created and revoked through one hook so previews cannot leak.
* Archive contents are only offered as downloads; nothing executes.
* No analytics, no telemetry, no third-party scripts.

See [`SECURITY.md`](SECURITY.md) for the threat model and how to report an issue.

## Limitations (stated, not hidden)

* Video transcoding, OCR, RAR/7z extraction and password-protected PDFs are **not** supported. They are not
  faked with a server round trip.
* AVIF encoding depends on the browser; options are probed at runtime and disabled when unavailable.
* Favicon generation embeds PNG payloads in the `.ico` (the format every current browser and Windows Vista+
  accept) rather than BMP/DIB, and refuses SVG sources instead of rasterising a scriptable document.
* Hashing is capped at 512 MB because WebCrypto has no streaming digest.
* Extremely large images can exhaust tab memory; the app fails with an explanation rather than hanging
  silently.
* PDF operations still need roughly their own document size in memory, twice over while saving; the
  cumulative budgets are what keep that bounded. A single `PDFDocument.save()` cannot be interrupted, so
  cancelling a large operation takes effect between documents rather than instantly.
* Batch processing runs **sequentially** (concurrency 1) by design — parallel workers would double peak
  memory for a gain nobody can perceive. Batch is limited to 50 files and 300 MB of held results; the queue
  pauses rather than dropping results when the output ceiling is reached.
* Cancelling a batch stops cooperative work quickly, but a codec call already inside the browser cannot be
  interrupted: the UI says "finishing the current image" instead of pretending otherwise.
* Packaging a batch into a ZIP holds a second copy while the archive is built (results + archive). The work
  runs in a worker, so the interface stays responsive and packaging can be cancelled mid-run.

## Project structure

```
src/
├── components/        layout chrome, UI primitives, brand mark, file widgets
├── hooks/             theme, toasts, object URLs, image pipeline, capabilities
├── lib/               framework-free processing: files, image, pdf, zip, batch, hash, dev
├── pages/             home, catalogue, architecture, tool route, 404
├── registry/          tool metadata, categories, lazy component map
├── styles/            design tokens, base, layout, pages, workspace, tool styles
└── tools/             one folder per category; one component per tool
```

## Licence

MIT
