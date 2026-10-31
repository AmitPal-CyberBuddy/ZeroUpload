# Security model

ZeroUpload's promise is narrow and checkable: **file contents are not transmitted**. Everything else about
security is ordinary browser application hygiene, and this document describes what is actually enforced.

## What is guaranteed

* No upload endpoint exists. The application is a static bundle with no API client for file data.
* No analytics, telemetry, remote logging, or third-party scripts are loaded at runtime.
* Fonts are self-hosted and bundled (no Google Fonts request).
* Source maps are disabled in production builds.
* File data lives in memory (and in Blob URLs) inside the tab. Closing the tab discards it.

Verification: open DevTools → Network, process a file, observe that no request carries file bytes. The full
source is public; the build has no server component.

## Threats considered

| Threat | Mitigation |
| --- | --- |
| Extension spoofing (e.g. malware named `.pdf`) | Magic-byte sniffing; declared vs detected type shown; mismatches surfaced to the user |
| Malformed / corrupt files | Decoders wrapped in error handling; failures produce a `ToolError` with a readable message, never a silent no-op |
| Resource exhaustion (huge files) | Per-category size caps, 2D canvas decode guarded by dimension probes, hashing capped at 512 MB |
| ZIP bombs | Budgets are read from the archive's central directory **before any decompression**: entry count (5,000), total expanded size (512 MB), per-entry size (256 MB). Peak allocation therefore stays near the compressed file size |
| Multi-file exhaustion | Every operation that takes several inputs has a cumulative budget (count, total bytes, and an output page ceiling where pages are produced): ZIP creation 2,000 files / 512 MB, PDF merge 50 documents / 250 MB / 3,000 pages, images→PDF 200 images / 150 MB. All are evaluated from `Blob.size` metadata before a byte is read |
| Batch mode as a bypass | The queue contains no processing code: every item runs through the same `validateImage` + `processImage` path as the single-file tool, so per-file size caps, signature sniffing and the SVG refusal apply per item. A failed item cannot affect the others, and a batch adds three more ceilings (50 images / 300 MB cumulative input / 300 MB of retained results) checked before the first byte is read |
| Unbounded result retention in a batch | Results stay as `Blob`s until released, so the queue stops (status `paused`) when held results reach 300 MB instead of dropping or overwriting them. Release is explicit and per row; packaging reads each result once and never releases anything implicitly |
| Archives that lie about their sizes | fflate allocates the declared size, so a false declaration truncates instead of expanding; a verification pass re-checks real byte counts and discards the result on mismatch |
| Path traversal in archives | Entry names normalised; `..` segments and absolute paths stripped; renames reported |
| Unsafe archive content | Extracted entries are never executed or auto-opened; they are offered as downloads only |
| SVG-borne scripts | SVG input is refused by every image tool |
| DOM injection | React escapes all interpolated strings; no `dangerouslySetInnerHTML` anywhere; file names are rendered as text |
| Object URL leaks | A single `useObjectUrl` hook creates and revokes every blob URL; downloads revoke after the save begins |
| Dependency compromise | Minimal dependency surface (`react`, `react-dom`, `react-router-dom`, `pdf-lib`, `fflate`); versions pinned via lockfile; no build-time remote fetches |
| Worker failure | Errors are propagated to the UI; the worker is terminated and recreated |

## What was measured in review

The original implementation checked ZIP limits *after* fflate had already inflated every entry: a 300 KB
archive expanding to 300 MB allocated the full 300 MB (788 ms) before being "rejected". It now rejects the
same file in 2 ms with ~1 MB of allocation. If you change `lib/zip/zip.ts`, keep the two-phase structure:
metadata pass first, inflation second, verification third.

The cumulative budgets were measured the same way, with inputs whose `arrayBuffer()` throws if it is ever
called: a 600 MB ZIP input is refused in 0.6 ms, 51 PDFs in 1.2 ms, 300 MB of PDFs in 0.2 ms, 160 MB of
images in 0.5 ms — all with **zero bytes read**. `npm test` asserts this property (`tests/zip-guards.test.ts`,
`tests/pdf-protocol.test.ts`), so a refactor that starts reading before checking fails the build.

## Safety model for the PDF worker

`pdf-lib` parses untrusted input, so it now runs in a dedicated module worker: a crash or memory blow-up is
contained in a separate thread that can be discarded, instead of taking the page with it. Inputs cross the
boundary as `Blob` handles (no copy, no shared mutable buffer), outputs are transferred back, and failures
return as `ToolError` codes rather than a stack trace. Cancellation is cooperative — an in-flight `save()`
cannot be interrupted, so the UI reports "cancelling" and stops between documents.

Batch processing runs one item at a time in the tab (concurrency 1) and never schedules work in parallel, so a
batch cannot multiply peak memory by its own concurrency. Retrying re-queues only failed or cancelled items.

## Known limitations

* **Memory, not sandboxing.** A browser tab is a resource-constrained process. A crafted image can still
  exhaust memory within the size caps. The app will report the failure; it cannot prevent the browser from
  being briefly busy.
* **No compression-ratio heuristic.** Real text/log/JSON archives compress 300–500×, so a ratio ceiling
  rejects legitimate files. Absolute, pre-inflate budgets are used instead.
* **No integrity guarantee of the deployment.** If the hosted bundle were modified by whoever controls the
  host, it could exfiltrate files. Hosting from a fork you control, or building locally, is the mitigation.
* **Password-protected PDFs are rejected**, not cracked.
* **Downloaded content is untrusted.** ZeroUpload does not scan archives or files for malware — it cannot.
* **`File.type` is advisory.** It is derived from the extension by the browser; that is exactly why signature
  checks exist.

## Reporting

Please open a GitHub issue for non-sensitive reports. For anything that could be actively exploited, use
GitHub's private vulnerability reporting on this repository instead of a public issue.
