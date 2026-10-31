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
| **Convert** | Image converter (JPEG · PNG · WebP · AVIF where the browser can encode it) |
| **Compress** | Image compressor with quality presets, downscaling and measured before/after sizes |
| **Transform** | Resize, crop (interactive frame + aspect presets), rotate & flip |
| **PDF** | Merge, split/extract pages, rotate, images → PDF |
| **Archive** | Create ZIP, extract ZIP (with bomb + traversal protection) |
| **Inspect** | File inspector: real type from magic bytes, dimensions, PDF/ZIP metadata, SHA-256 |
| **Developer** | JSON formatter, Base64 encoder/decoder, URL encoder/decoder, hash generator |

Every tool is an independently loaded module. Opening the image compressor never downloads the PDF engine.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static output in dist/
npm run preview    # serve the production build
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
* Input sizes are capped per category (images 120 MB, PDFs 200 MB, archives 400 MB).
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
* Hashing is capped at 512 MB because WebCrypto has no streaming digest.
* Extremely large images can exhaust tab memory; the app fails with an explanation rather than hanging
  silently.
* PDF work runs on the main thread. Measured: a 137 MB document blocks for ~0.3–0.4 s and peaks at ~2× its
  size. Moving pdf-lib into a worker is the top backlog item.

## Project structure

```
src/
├── components/        layout chrome, UI primitives, brand mark, file widgets
├── hooks/             theme, toasts, object URLs, image pipeline, capabilities
├── lib/               framework-free processing: files, image, pdf, zip, hash, dev
├── pages/             home, catalogue, architecture, tool route, 404
├── registry/          tool metadata, categories, lazy component map
├── styles/            design tokens, base, layout, pages, workspace, tool styles
└── tools/             one folder per category; one component per tool
```

## Licence

MIT
