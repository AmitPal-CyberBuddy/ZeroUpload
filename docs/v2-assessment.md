# ZeroUpload V2 — technical assessment

**Status:** evaluation only. Nothing in this document is implemented, and no code was changed to produce it.
**Date:** 31 October 2026
**Question:** can ZeroUpload become a privacy-first local file suite that converts, compresses, transforms,
inspects, sanitises, protects and unlocks files entirely in the browser?

**Short answer:** yes for inspect, sanitise, unlock, and a *narrow* set of conversions. No for Office document
rendering and no for PDF→DOCX at a quality worth shipping. The product should move its centre of gravity from
"conversion" to **inspection and cleanup**, where the browser is genuinely unbeatable, and refuse the
document-conversion category that only a native engine can do honestly.

---

## 0. How the numbers here were obtained

Package facts (versions, licences, unpacked size) come from the npm registry on 31 Oct 2026. Byte counts were
measured locally: `npm pack <pkg>`, unpack, and `gzip -9 -c <file> | wc -c` on the specific file a bundler would
import. Where a number is an estimate it says so.

| Package | Version | Licence | File measured | Raw | Gzip |
| --- | --- | --- | --- | --- | --- |
| `pdfjs-dist` | 6.4.299 | Apache-2.0 | `build/pdf.min.mjs` | 452 kB | **128 kB** |
| `pdfjs-dist` | | | `build/pdf.worker.min.mjs` | 1.26 MB | **366 kB** |
| `pdfjs-dist` | | | `cmaps/` (per-document, lazy) | 1.7 MB total | — |
| `pdfjs-dist` | | | `standard_fonts/` (per-document, lazy) | 820 kB total | — |
| `mupdf` | 1.28.1 | **AGPL-3.0** | `dist/mupdf-wasm.wasm` | 10.4 MB | 4.6 MB (`.br` 3.6 MB) |
| `@zip.js/zip.js` | 2.24.0 | BSD-3-Clause | `index.min.js` | 210 kB | **87 kB** |
| `office-crypto` | 0.1.0 | MIT | package | 1.2 MB | — |
| `js-yaml` | 5.5.0 | MIT | `dist/js-yaml.mjs` | 131 kB | **28 kB** |
| `markdown-it` | 15.0.3 | MIT | `dist/markdown-it.mjs` | 119 kB | **27 kB** |
| `dompurify` | 3.4.17 | MPL-2.0 / Apache-2.0 | `dist/purify.min.js` | 30 kB | **12 kB** |
| `turndown` | 7.2.4 | MIT | `lib/turndown.browser.es.js` | 25 kB | **7 kB** |
| `fast-xml-parser` | 5.11.2 | MIT | `lib/fxp.min.js` | 79 kB | **25 kB** |
| `papaparse` | 5.7.0 | MIT | `papaparse.min.js` | 19 kB | **7 kB** |
| `exceljs` | 4.4.0 | MIT | `dist/exceljs.bare.min.js` | 863 kB | **231 kB** |
| `docx-preview` | 0.4.1 | Apache-2.0 | package | 978 kB | — |
| `mammoth` | 1.13.0 | BSD-2-Clause | package | 1.67 MB | — |
| `tesseract.js` | 7.0.0 | Apache-2.0 | package | 1.4 MB | + core WASM and a language model (estimate: 5–20 MB total) |
| `@matbee/libreoffice-converter` | 2.7.2 | MPL-2.0 | package | **254 MB** | ~78 MB compressed first download |

For scale, today's app: entry chunk **101.8 kB gzip**, pdf-lib fallback chunk **188 kB gzip**, three module
workers, no network requests after load.

---

## 1. Capability matrix

`Rec` uses the requested A–E scale. "Local" = no server. "Memory" is peak, relative to input size.

### 1.1 Protection and unlocking

| Feature | Local browser | Library / WASM | Quality | Compatibility | Memory | Bundle cost | Rec |
| --- | --- | --- | --- | --- | --- | --- | --- |
| PDF — add open password (AES-256) | Yes, no hosting requirement | `@cantoo/pdf-lib` (MIT) | Exact — writes `/V 5 /R 6`, verified with libqpdf | Opens in Acrobat, Preview, Chrome, Firefox, pdf.js | 1.5–2× file | 245 kB gz, lazy chunk | **A** |
| PDF — printing/copying/modify permissions | Same path | `@cantoo/pdf-lib` `/P` bits | Exact flags | Honoured by compliant readers; **advisory only** | same | 0 extra | **A** |
| PDF — change password | decrypt then re-encrypt | `@cantoo/pdf-lib` | Exact | Same | 2× | 0 extra | **A** |
| PDF — remove password | Yes | `@cantoo/pdf-lib` (AES-256, AES-128, RC4) | Exact content; encryption dictionary stripped | Same | ~1.5× | 0 extra | **A** |
| PDF — detect encryption | Yes, today | pdf-lib throws `EncryptedPDFError`; `/Encrypt` scan | Reliable | — | ~0 | 0 | **A** |
| DOCX/XLSX/PPTX — remove open password | Yes | `office-crypto` (MIT) or ~200 lines of WebCrypto | High, spec-exact | Output is a normal OOXML package | 2–3× | +~40 kB gz (est.) | **A–** |
| DOCX/XLSX/PPTX — add open password | Yes, with work | own CFB writer + ECMA-376 Agile (AES-256/SHA-512) | Achievable; needs an interop gate | Must be tested against Word, Excel, PowerPoint, LibreOffice | 3× | +50 kB gz (est.) | **B** |
| DOCX/XLSX/PPTX — "modify password" | Yes | `w:documentProtection` / `sheetProtection` XML | **Not encryption** — a verifier any tool strips in seconds | Word shows "restricted editing", then a user removes it | ~1× | 0 | **B** (as "editing restriction", never as "protected") |
| ZIP — create AES-256 archive | Yes | `@zip.js/zip.js` (BSD-3) | Exact (WinZip AE-2) | 7-Zip, WinRAR, Keka, PeaZip, `unzip` (some). **Not** Windows Explorer, **not** macOS Archive Utility | 1–2× | +87 kB gz, lazy | **B** |
| ZIP — create ZipCrypto archive | Yes | `zip.js` | Cryptographically broken | Everything opens it | 1–2× | 0 extra | **D** (offer only as an explicitly-labelled compatibility fallback, never as the default) |
| ZIP — unlock | Yes | `zip.js` (AES + ZipCrypto) | Exact | — | 2× | 0 extra | **A–** |
| ZIP — change password | Yes | decrypt + re-encrypt | Exact, but rewrites every entry | — | 2–3× | 0 extra | **B** (state that timestamps/attributes may be re-written) |
| ZIP — detect encryption / AE | Yes, today | fflate central directory: GP bit 0 + extra field `0x9901` | Reliable | — | ~0 | 0 | **A** |
| Password-strength / KDF guidance | Yes | own | Advisory | — | ~0 | 0 | **A** |

### 1.2 Document conversion

| Feature | Local browser | Library / WASM | Quality | Compatibility | Memory | Bundle cost | Rec |
| --- | --- | --- | --- | --- | --- | --- | --- |
| PDF → PNG / JPG / WebP | Yes | `pdfjs-dist` + `OffscreenCanvas` | Raster-exact for rendered content | Any image viewer | 1 page at a time (8 MB at 150 dpi, 35 MB at 300 dpi, A4) | +494 kB gz, lazy | **A** |
| PDF → TXT | Yes | `pdfjs-dist` `getTextContent()` | Text preserved; **reading order is heuristic** | Universal | ~2× | 0 extra | **A–** |
| PDF → HTML | Yes | `pdfjs-dist` text + operator list | Reconstructed; positioned spans or guessed structure | Browsers, but not editable documents | ~2× | 0 extra | **B** |
| PDF → images (all pages, batched) | Yes | as above + existing batch layer | Raster-exact | — | one page at a time | 0 extra | **A** |
| Images → PDF | **Already shipped** | pdf-lib | Exact container | Acrobat etc. | ~2× | 0 | **A** |
| DOCX → TXT | Yes | own XML walk (or mammoth) | Text exact; structure lost | Universal | ~2× | ~0 (own walk) | **A** |
| DOCX → HTML | Yes | `mammoth` (semantic) or `docx-preview` (visual) | Mammoth: semantic, styles lost. docx-preview: visual, not exportable | Browser only | 2–3× | +100–250 kB gz, lazy | **B** |
| DOCX → PDF | No (at fidelity) | LibreOffice WASM only | Would be exact | — | 200–300 MB RAM | **+78 MB download** | **D** |
| XLSX → PDF | No | LibreOffice WASM only | Pagination/layout is the whole problem | — | 200–300 MB | +78 MB | **D** |
| PPTX → PDF | No | LibreOffice WASM only | Rendering engine required | — | 200–300 MB | +78 MB | **D** |
| PPTX → images | No | LibreOffice WASM only | Same | — | 200–300 MB | +78 MB | **D** |
| XLSX → images | No | LibreOffice WASM only | Same | — | 200–300 MB | +78 MB | **D** |
| PDF → DOCX | Technically | `pdfjs-dist` + own DOCX writer | **Reconstructive; layout is lost** | Opens in Word, looks wrong | 2× | +100 kB gz | **D** |
| PDF → DOCX via LibreOffice WASM | Technically | `@matbee/libreoffice-converter` | Text-box soup, still poor | Opens, barely editable | 200–300 MB | +78 MB | **D** |
| Scanned PDF → anything textual | Only with OCR | `tesseract.js` | ~87–89 % word recall on a clean scan | — | 100–300 MB | 5–20 MB | **C** |

### 1.3 PDF expansion

| Feature | Local browser | Library / WASM | Quality | Compatibility | Memory | Bundle cost | Rec |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Reorder pages | Yes | pdf-lib (extend `pdf/ops.ts`) | Exact | — | ~2× | 0 | **A** |
| Delete pages | Yes | pdf-lib | Exact | — | ~2× | 0 | **A** |
| Rotate / split / merge / extract pages | **Already shipped** | pdf-lib | Exact | — | ~2× | 0 | **A** |
| Extract text | Yes | pdf.js | Good for single-column; hyphenation and columns need heuristics | — | ~2× | 0 extra | **A–** |
| Extract images | Yes, with caveats | pdf.js operator list | Exact for JPEG/PNG XObjects; **JPX/JBIG2 need decoders**; CMYK and soft masks are pitfalls | — | 1 image at a time | +0.5 MB for the optional decoders | **B** |
| Extract metadata | Yes | pdf-lib info dict + XMP parse | Reliable | — | ~0 | 0 | **A** |
| Extract attachments | Yes, with a sandbox | pdf-lib catalog name tree | Exact bytes; **the content is hostile by definition** | — | 1 file at a time | 0 | **B** |
| Flatten forms | Yes, with caveats | pdf-lib `form.flatten()` | Correct for fields it can render; silently wrong for those it cannot | Adobe/Chrome | ~2× | 0 | **B** |
| Flatten annotations | Partly | pdf-lib low-level | Needs appearance generation per annotation type | — | ~2× | 0 | **C** |
| Inspect: pages, version, encryption, forms, attachments, metadata | Yes | pdf-lib + `pdfjs-dist` | Reliable | — | ~1× | 0–494 kB | **A** |
| Inspect: JavaScript / auto-actions | Yes, with honest wording | pdf-lib object walk (`/JS`, `/OpenAction`, `/AA`, `/Launch`, `/RichMedia`) | Finds declarative actions; cannot prove absence of obfuscation | — | ~1× | 0 | **B** |
| Linearise / optimise | Not implemented | — (no library we can ship does it) | — | — | — | — | **—** |

### 1.4 Privacy, sanitising, inspection

| Feature | Local browser | Library / WASM | Quality | Compatibility | Memory | Bundle cost | Rec |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Strip image EXIF/GPS/XMP **without re-encoding** | Yes | own byte-level segment/chunk removal | **Lossless** — pixels untouched | Every viewer | ~1× | 0 | **A** |
| Strip image metadata by re-encoding | **Already shipped** | image worker | Lossy (it is a re-encode) | — | ~1× | 0 | **A** |
| Show what image metadata exists | Yes | own TIFF/EXIF reader | Reliable for JPEG/TIFF/PNG eXIf; partial for HEIC/AVIF | — | ~0 | 0 | **A** |
| PDF metadata removal | Yes, with scope | pdf-lib info dict + XMP stream removal | Removes what it says it removes; **does not scrub orphaned objects or prior revisions** | — | ~2× | 0 | **A–** |
| PDF: remove JavaScript and auto-actions | Yes, with scope | pdf-lib object walk + rewrite | Removes the named entries; **cannot prove a document is script-free** | — | ~2× | 0 | **B** |
| PDF: remove embedded files | Yes | pdf-lib name tree edit | Exact | — | ~2× | 0 | **A–** |
| PDF: remove annotations | Yes, with caveats | pdf-lib low-level | Removes the objects; **the drawn text stays in the content stream** | — | ~2× | 0 | **B** |
| OOXML metadata strip (core/app/custom props, `rsid`, comment authors) | Yes | fflate/zip.js + XML walk | Exact for the parts named | Word/Excel/PowerPoint open the result | 2–3× | ~0 (own walk) | **A–** |
| OOXML hidden-content *detection* (tracked changes, hidden sheets, hidden slides, custom XML, external links, pasteboard shapes) | Yes | own XML walk | Reliable as a *report* | — | 2× | 0 | **A–** |
| Claim "fully sanitised" | **No** | — | Cannot be established without a full renderer | — | — | — | **E** |

### 1.5 Developer / data converters

| Feature | Local browser | Library | Quality | Bundle cost | Rec |
| --- | --- | --- | --- | --- | --- |
| JSON ↔ YAML | Yes | `js-yaml` (MIT) | Exact, with an alias/merge cap for YAML bombs | +28 kB gz | **A** |
| JSON ↔ CSV | Yes | `papaparse` (MIT) | Lossy by nature (types, nesting) — must be stated | +7 kB gz | **A** |
| XML → JSON | Yes | `fast-xml-parser` (MIT) | Lossy for attributes/namespaces/mixed content | +25 kB gz | **A** |
| CSV → XLSX | Yes | `exceljs` (+231 kB gz) **or** own minimal SpreadsheetML writer (~15 kB) | Own writer: plain cells only. exceljs: styles, formulas, dates | +15 kB or +231 kB | **B** |
| Markdown → HTML | Yes | `markdown-it` + `dompurify` | Exact; sanitising is mandatory (we would be generating HTML from user input) | +39 kB gz | **A** |
| HTML → Markdown | Yes | `turndown` | Lossy for tables, CSS layout, embedded widgets | +7 kB gz | **A** |
| JWT inspect (header/claims/expiry) | Yes | own | Exact; signature verification only with a supplied secret/JWK | 0 | **A** |
| Base64 / URL / hashing / JSON tools | **Already shipped** | own | — | 0 | **A** |

### 1.6 Archive and images

| Feature | Local browser | Library | Quality | Rec |
| --- | --- | --- | --- | --- |
| Inspect archive (entries, sizes, ratio, encryption, comment) | Yes | fflate (already) | Exact | **A** |
| Extract selected entries | Yes | fflate (already) | Exact, budgeted | **A** |
| Path normalisation, duplicate handling | **Already shipped** | own | Exact | **A** |
| Archive metadata (timestamps, comment, attributes) | Yes | fflate read / zip.js write | Read is exact; rewriting loses some attributes | **B** |
| Image convert/compress/resize/crop/rotate + batch | **Already shipped** | image worker | Exact | **A** |
| Thumbnail strip | Yes | same as EXIF strip | Lossless | **A** |
| Before/after metadata comparison | Yes | own reader | Exact | **A** |

---

## 2. Protection matrix

Terminology matters more than the table here, so read the notes under it.

| Format | Open password | Modify password | Permissions | Remove password | Native compatibility | Local feasibility |
| --- | --- | --- | --- | --- | --- | --- |
| **PDF** | Yes — AES-256 (R6) or AES-128 (R4) | Yes — via the same `/P` permission bits as "permissions" | Yes — print / copy / modify / annotate / form-fill / accessibility bits | Yes — full decrypt | Yes: Acrobat, Preview, Chrome, Firefox, pdf.js. Permission bits are **advisory** | **Yes** — `@cantoo/pdf-lib`: AES-256 R6 out, AES-256/128/RC4 in, no cross-origin isolation needed (see §2.2) |
| **DOCX** | Yes — ECMA-376 Agile (AES-256 + SHA-512, 100 000 rounds), wrapped in a CFB container | Only as *editing restriction* (`w:documentProtection`) — **not encryption, trivially removable** | Editing/formatting restrictions only; no printing restriction | Yes | Decrypt: any Word. Encrypt: must be validated against Word 16, LibreOffice, `msoffcrypto-tool` | **Decrypt: yes.** Encrypt: yes with work (CFB writer + Agile KDF), needs an interop gate |
| **XLSX** | Same as DOCX | *Sheet/workbook protection* — an editing restriction, bypassable | Sheet protection, not document security | Yes | Same | Same as DOCX |
| **PPTX** | Same as DOCX | "Mark as final" / modify restriction — advisory | Almost nothing meaningful | Yes | Same | Same as DOCX |
| **ZIP** | Yes — AES-256 (WinZip AE-2) or ZipCrypto | n/a (the format has no such concept) | n/a | Yes (decrypt) | AES: 7-Zip/WinRAR/Keka/PeaZip yes; **Windows Explorer and macOS Archive Utility no**. ZipCrypto: everything, but it is broken | **Yes**, `zip.js` |
| **PDF (owner-only, no user password)** | n/a | n/a | Yes — this is the common "restricted" PDF everyone meets | Yes — usually without a password at all | Advisory | **Yes** — and worth stating plainly: many "protected" PDFs open with no password |

### 2.1 The three things that must never be blurred

1. **Encryption ≠ permission flags.** A PDF `/P` bit is a polite request to the reader. Anyone can decrypt-and-rewrite it in seconds. Shipping "printing disabled" as a security feature is exactly the "fake security" the product forbids. The UI must say *"readers that honour the flag will refuse; this is not DRM."*
2. **"Modify password" in Office is not a password on the file.** `documentProtection` leaves the document in plaintext. A user who believes their DOCX is encrypted has been misled. Either implement real Agile encryption (the "open password") and label the other control as *editing restriction*, or do not offer it.
3. **ZipCrypto is not encryption in any meaningful sense.** Known-plaintext attack, decades old. If it is offered at all, it is an *interoperability* mode with a warning, not a security mode.

### 2.2 PDF encryption: choosing an engine

* **`pdf-lib` cannot write encrypted PDFs.** Its docs say so; the API is a stub. It also refuses to *open* encrypted
  files (`EncryptedPDFError`). That is why V1 could only detect encryption, never act on it.
* **`@cantoo/pdf-lib`** is a fork of `pdf-lib` that adds both directions: it reads AES-256, AES-128 and RC4 files
  (including the compressed object streams that modern writers emit) and writes AES-256 `/V 5 /R 6` with `/P`
  permission bits. It is plain JS — no WASM, no `SharedArrayBuffer`, no service worker, no hosting requirement.
  Verified against libqpdf (see [`v2-proofs.md`](v2-proofs.md)): libqpdf reads our output with either password,
  refuses it without one, and enforces the permission bits; four externally produced encrypted files decrypt
  byte-correct. It costs ~70 kB gz more than `pdf-lib` and sits in the same lazy PDF chunk (245 kB gz measured).
* **MuPDF.js** does more — decrypt, encrypt, permissions, sanitise, render — in 10.4 MB of WASM (4.6 MB gz), but it
  is **AGPL-3.0**. Linking it into an MIT application makes the whole application AGPL. Not a technical objection,
  a licensing one, and not one to make casually for a single feature.
* **`qpdf-wasm` was ruled out structurally.** It is Apache-2.0 and qpdf is the reference implementation, but the
  published build is pthread-compiled (`new WebAssembly.Memory({shared:true, …})` in the bundle) and therefore needs
  `SharedArrayBuffer`, which needs cross-origin isolation — `COOP: same-origin` + `COEP: require-corp`. **GitHub
  Pages cannot send custom headers.** The only workarounds are a service-worker shim (no isolation on first load,
  fragile in private modes, and hostile to the planned offline work) or moving hosts, which breaks the "any static
  host, even a USB stick" property. Since `@cantoo/pdf-lib` meets the requirement without any of that, the
  capability check, the shim and the hosting question are all deleted from this plan rather than deferred.
* **Rolling our own R6 handler** is possible (the algorithm is published and short) but the failure mode is a file
  that opens in our own reader and nowhere else — the exact class of bug this product cannot afford.

---

## 3. Conversion matrix

The 16 questions collapse into a few honest axes: does the text survive, does the *layout* survive, and is the
output editable as the user expects.

| Conversion | Local | Text | Fonts | Layout | Tables | Images | Links | Pages | Loss class | Rec |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **PDF → PNG/JPG/WebP** | Yes | rasterised (gone as text) | rasterised | **exact pixels** | rasterised | rasterised | gone | preserved, one file per page | Lossless *as an image* | **A** |
| **PDF → TXT** | Yes | good, single-column | n/a | gone | flattened | gone | gone | page breaks only | Inherently lossy | **A–** |
| **PDF → HTML** | Yes | good | substituted (web fonts) | reconstructed | heuristic | extractable | recoverable via annotations | preserved as sections | Reconstructive | **B** |
| **DOCX → TXT** | Yes | exact | n/a | gone | flattened | gone | gone | n/a | Inherently lossy | **A** |
| **DOCX → HTML** | Yes | exact | mapped to CSS with fallbacks | approximate | real `<table>` with mammoth | embedded | kept | n/a | Mostly lossless, visually approximate | **B** |
| **images → PDF** | Yes (shipped) | n/a | n/a | one image per page | n/a | exact | n/a | one per image | Container only | **A** |
| **PDF → DOCX** | Technically | extractable | **substituted** | **lost** — reconstructed from glyph coordinates | heuristic, merged cells break | placeable | reconstructable | yes | **Reconstructive** | **D** |
| **DOCX → PDF** | No | would be exact | would be exact | would be exact | exact | exact | exact | exact | — | **D** |
| **XLSX → PDF / images** | No | — | — | pagination is the product | — | — | — | — | — | **D** |
| **PPTX → PDF / images** | No | — | — | needs a slide renderer | — | — | — | — | — | **D** |

### 3.1 PDF → DOCX, examined properly

Why it is popular: people receive a PDF and want to edit it. Why it is hard: a PDF is a *drawing*, not a
document. There are no paragraphs, no headings, no table cells — only glyphs at coordinates. Recovering
structure is a research problem, and every tool that does it well is doing layout analysis, not parsing.

What is actually available to run locally:

| Path | What you get | Why it fails our bar |
| --- | --- | --- |
| `pdfjs-dist` + own DOCX writer | Flowing text, guessed paragraphs, images placed inline | Tables become text; column order is a coin flip; headers/footers merge into the body; lists become literal bullets if the glyphs survive |
| `pdf2docx` under Pyodide | The best open-source output | Its dependency chain (OpenCV, NumPy, `python-docx`) is ~100 MB+ of WASM, needs a long cold start, and is still "may not convert cleanly" for multi-column and complex tables |
| LibreOffice WASM | Opens the PDF as positioned text frames | 78 MB download, 200–300 MB RAM, and the output is famously *not* editable — the "text-box soup" outcome |

To be concrete about the failure mode we would be shipping: a two-column academic paper comes out as
interleaved lines; a bank statement's table comes out as a wall of text in reading order; a form comes out with
every label drifting a few points; a scanned PDF comes out **completely empty** unless OCR runs first. Users do
not judge a converter by "it produced a .docx", they judge it by opening it in Word.

**Verdict: D.** Not because it is impossible, but because "technically valid but badly formatted" is precisely
the outcome the product's own principles forbid. If it is ever shipped, it must be as a **PDF → editable text
document** feature that promises text and nothing else — a different feature with a different name.

### 3.2 Office → PDF, examined properly

The only engine that renders DOCX/XLSX/PPTX faithfully is the one that was built to: LibreOffice (or Office
itself). LibreOffice compiled to WASM exists (`@matbee/libreoffice-converter`, MPL-2.0) and the numbers are
sobering: **147 MB wasm + ~100 MB data** (≈78 MB over the wire, cached), a `SharedArrayBuffer` requirement,
200–300 MB RAM per conversion, initialisation measured in seconds, and public reports of intermittent hangs at
the PDF-export step. That is not a dependency; it is a second product shipped inside ours.

**Verdict: D** for a static, GitHub-Pages-deployed, memory-budgeted app. It is not a WASM-quality problem that
will be fixed by a faster phone; it is two orders of magnitude away from the rest of the app's budget.

**A honest alternative worth considering**: DOCX → HTML rendered faithfully in the tab (`docx-preview`,
Apache-2.0), then the user's own **Print → Save as PDF**. Real text, real fonts, real pagination, no 78 MB
engine, no server. The catch is that the file is produced by the browser's print pipeline, not by us — the UI
must say so. Classify **B**; it is a *print-ready preview*, not a converter.

---

## 4. Recommended V2 roadmap

### V2.0 — highest confidence (ship first)

| # | Feature | Why it is safe |
| --- | --- | --- |
| 1 | **Privacy Audit** (extended inspector) | Read-only metadata parsing on top of the existing `FileInspectorTool`; no new heavyweight library for images/ZIP; PDF findings via pdf-lib |
| 2 | **Image metadata** (view + lossless strip: EXIF, GPS, XMP, ICC-preserving, thumbnail removal) | Pure byte-level work, no dependency, no quality loss, and it reuses `validateImage` and the image worker's budgets |
| 3 | **PDF → images** (PNG/JPG/WebP, page range, DPI choice) | pdf.js is the browser's own PDF engine; raster output is unambiguous; integrates with the existing batch layer |
| 4 | **PDF → text** | Same engine, same worker, honest about reading order |
| 5 | **PDF inspect** (version, encryption, permissions, forms, attachments, JavaScript, metadata, page geometry) | pdf-lib already parses everything needed; pdf.js for the parts it cannot |
| 6 | **PDF page organisation** (reorder, delete, extract, rotate — extending existing ops) | pdf-lib, already proven here |
| 7 | **Developer converters** (JSON↔YAML, JSON↔CSV, XML→JSON, Markdown↔HTML, JWT) | < 100 kB gz total, all lazy, all MIT/Apache, all testable without a DOM |
| 8 | **ZIP inspect + selective extract + unlock** | fflate already reads the central directory; `zip.js` handles AES decryption |
| 9 | **ZIP create with AES-256** | Real encryption, honest compatibility warning (Explorer/macOS cannot open it) |

V2.0 adds roughly **620 kB gzip** of lazy-loaded code (mostly pdf.js) and **zero bytes** to the entry chunk.

### V2.1 — valuable, needs implementation work and an explicit interop gate

| # | Feature | Gate before it ships |
| --- | --- | --- |
| 10 | **Office open-password removal** (decrypt DOCX/XLSX/PPTX) | Fixtures decrypted by Word/Excel/PowerPoint and by `msoffcrypto-tool`, byte-identical to the reference |
| 11 | **Office open-password creation** (Agile AES-256) | Generated files must open in Word 16, Excel 16, PowerPoint 16, LibreOffice and `msoffcrypto-tool`. CFB writer is the risky half |
| 12 | **PDF protect / unlock / change password** | **Shipped.** Gate was: output read by an independent implementation (libqpdf) and by our own reader, permission bits enforced, external fixtures decrypted byte-correct |
| 13 | **OOXML metadata strip** | Must survive a round-trip: open in Word, check the parts are gone, ensure the package is still valid |
| 14 | **PDF sanitise** (JavaScript, attachments, optional metadata) with a findings report | Needs the object-walk implementation and a corpus of "nasty" PDFs |
| 15 | **CSV → XLSX** | Prefer a ~15 kB own writer over a 231 kB dependency; validate against Excel and LibreOffice |
| 16 | **DOCX → print-ready HTML** (`docx-preview`) | Make the print step explicit in the UI |

### V2.2 — experimental

| # | Feature | Why experimental |
| --- | --- | --- |
| 17 | **OCR for scanned PDFs** (`tesseract.js`) | 5–20 MB download, 87–89 % word recall on a clean scan, no styling recovered. Only if it is framed as "find the text", never as "convert the document" |
| 18 | **PDF → HTML** | Positioned-span output is honest but not useful; structural guessing is a research project |
| 19 | **Flatten annotations** | Appearance generation per annotation type is a long tail |
| 20 | **PDF optimise / linearise** | No shippable library does this without cross-origin isolation; not planned |

### Do not build

| Feature | Why |
| --- | --- |
| **PDF → DOCX** | Reconstructive; produces the discarding of layout the product cannot present as success |
| **DOCX/XLSX/PPTX → PDF or images** | Needs a 78 MB LibreOffice engine and 200–300 MB RAM; a browser tab is the wrong place |
| **Password cracking / brute force** | Explicitly out of scope, and it would turn a utility into a weapon |
| **"Fully sanitised" guarantees** | Not establishable in-browser; a false promise in a security product |
| **ZipCrypto as a default** | Broken cipher presented as protection |
| **Office "modify password" as a security feature** | It is not encryption; it is a speed bump |
| **MuPDF dependency** | AGPL would relicense the entire application |
| **A cloud/account layer of any kind** | Contradicts the premise |

---

## 5. Architecture impact

### 5.1 New libraries and their integration cost

| Library | Licence | Bundle | Where it runs | Notes |
| --- | --- | --- | --- | --- |
| `pdfjs-dist` | Apache-2.0 | 494 kB gz (main + worker) | Its own worker; see the spike note below | Needs `cmaps/` (1.7 MB, per-document) and `standard_fonts/` (820 kB) copied as static assets |
| `@cantoo/pdf-lib` | MIT | 245 kB gz | Our existing PDF worker | Replaces `pdf-lib`; adds encrypt/decrypt, no wasm |
| `@zip.js/zip.js` | BSD-3 | 68 kB gz (measured chunk) | Our ZIP worker | Keep `fflate` for unencrypted archives; `zip.js` only for AES. Two archive libraries are acceptable if the boundary is explicit |
| `office-crypto` + `@noble/hashes` | MIT | ~30 kB gz (measured: 1.6 + 3.1 + 5.1 + 7.9 + 10.9 kB chunks) | Office worker | Decrypt only; encryption is our own Agile writer (7.5 kB chunk) |
| `js-yaml`, `markdown-it`, `dompurify`, `turndown`, `fast-xml-parser`, `papaparse` | MIT/Apache | ~100 kB gz total | Main thread | Small inputs, bounded by the existing `text` size category |

**pdf.js integration is the one real architectural question.** pdf.js normally wants to own its own worker
(`GlobalWorkerOptions.workerSrc`). Two options:

* **A — pdf.js main-thread API + its own worker.** Simplest, matches upstream. Parsing happens off-thread, but
  *rasterising* a page happens on the main thread: at 300 dpi an A4 page is a 35 MB canvas draw. That will stall
  the UI for ~100–300 ms per page.
* **B — pdf.js inside our worker, rendering to `OffscreenCanvas`.** Keeps everything off the main thread and
  matches the architecture we already have for images and PDFs. pdf.js is not officially supported in a
  worker-only environment (font loading and DOM assumptions appear in some paths) and nested workers are the
  thing we deliberately avoided. **This needs a spike before it is planned, not after.**

Recommendation: spike option B for one page; if it fails, take A and accept page-level stalls (yielding between
pages), stating the cost in the docs. Either way `pdf/` gains a second engine, and the public API must hide
which one produced a given result.

### 5.2 Reuse map

| Existing piece | Reused by |
| --- | --- |
| `ToolError` + `assertWithinSize` + `assertCumulativeBudget` | every new feature, unchanged |
| `BatchQueue` (concurrency, budgets, retention, cancellation) | PDF→images, image metadata strip, OOXML strip, ZIP unlock |
| `zip/create.ts` + `names.ts` | all archive output, including the new encrypted path's naming rules |
| `useObjectUrl` + `triggerDownload` | every new result; no new object-URL code |
| `sniffFileType` / `mime.ts` | PDF vs zip vs OOXML detection, encrypted-container detection |
| `image/validate.ts` | image metadata tools inherit the SVG/HEIC refusal and size caps |
| `useImagePipeline` | image metadata strip, when it is single-file |
| `Progress`, `CompareSizes`, `BatchPanel` | all result surfaces |

### 5.3 Where the current abstractions are not enough

1. **One input → many outputs.** `BatchResult` is a single `{ blob, name }`. PDF→images produces N files per
   input. Options: extend `BatchResult` with `outputs?: { name, blob }[]` (and make retention sum them), or
   package per-input outputs into a ZIP via `createZip`. The first is more honest for progress and release; the
   second is less code. Prefer the first, with the queue's retained-bytes accounting extended.
2. **A linear pipeline ("Sanitize" workflow).** Inspect → clean → protect → convert → download is a *chain*, not
   a queue. It needs the same discipline the batch layer has: one copy of the bytes at a time, per-step budgets,
   explicit release of intermediates, and a stop that discards partial output. That is a small, new abstraction
   (`DocumentPipeline`), deliberately not a general workflow engine. Build it only when two chained steps
   actually exist.
3. **Secrets in state.** No existing hook deals with a password. Rules: passwords live in a `useRef` inside the
   component that needs them, are passed by argument, never enter a snapshot/`useSyncExternalStore` value,
   never appear in a toast, an error message, a URL or `localStorage`, and are dropped on unmount. JS cannot
   guarantee zeroisation of strings — say so in the security docs rather than pretending.
4. **Capability-aware UI.** The product asks for controls that differ per format. The registry has `status` but
   no capability declaration. Add a per-tool capability descriptor (what this format supports: open password,
   permissions, metadata strip, encryption detection) and render from it, so no tool shows a control that
   cannot do what it says.

### 5.4 Workers, memory and budgets

| Feature | Worker | Budget to add |
| --- | --- | --- |
| PDF→images | pdf.js worker (+ ours) | max pages per run, max DPI, per-page pixel cap (e.g. 40 MP), output bytes |
| PDF protect/unlock | existing PDF worker | 2× input bytes; the 200 MB PDF cap already applies |
| Office decrypt/encrypt | Office worker | 2.2× input; 100 MB cap. Key derivation is 100 000 SHA-512 rounds (~0.5 s), which is why it cannot run on the main thread |
| ZIP AES | existing ZIP worker | **64 MB / 500 entries** (measured 3.8× memory), vs 512 MB / 2,000 unencrypted |
| Image metadata strip | main thread (byte copy) | 1× buffer; streaming for JPEG would be better but is not required under the 120 MB cap |
| OOXML metadata strip | worker | 2–3× input; 200 MB cap |

---

## 6. Quality risks — the parts that must not be softened

### 6.1 PDF → DOCX (if anyone proposes it again)

There is no local library that recovers *structure*. Reading order in multi-column layouts is resolved by
heuristics that fail on the documents people most want converted (papers, statements, forms). Tables cannot be
recovered reliably because a PDF rarely contains table semantics — only lines and glyphs. Fonts are substituted
because the embedded font may be subsetted, unencodable or licensed. Headers and footers become body text.
Scanned pages produce an empty document unless OCR runs first, and OCR then produces unstyled text.
The honest sentence is: *"a .docx that Word opens is not an editable copy of the document."*

### 6.2 Office → PDF

Even if the 78 MB engine were acceptable, the failure surface is large: fonts not installed on the client are
substituted; `@font-face`-less DOCX documents with Calibri metrics will paginate differently from Word;
embedded objects (charts, OLE, SmartArt) may render as placeholders; tracked changes and comments render
depending on the viewer's settings; XLSX print areas and page breaks are a whole subsystem. LibreOffice's own
compatibility notes exist for a reason, and they are written by people who work on it full time.

### 6.3 OCR

87–89 % word recall means roughly one word in eight is wrong on a *clean* scan, worse on skew, worse again on
handwriting, receipts, or CJK without the right model. No styling, no structure, no reading order guarantees.
If OCR ships, it must never be presented as "converting" a scanned document.

### 6.4 Encrypted Office files

The container is a CFB/OLE compound file whose real payload is an encrypted ZIP, and Word will accept several
variants (`Agile`, `Standard`, `RC4 CryptoAPI`, `XOR`). Supporting only Agile means older or third-party files
fail with "unsupported encryption" — acceptable *if the UI says which scheme it found*. Supporting all of them
is weeks of work on 1990s binary formats. The KDF is also deliberately slow (100 000 rounds) — that is 100 000
SHA-512 iterations per password attempt, which must run in a worker with progress, not on the main thread.

### 6.5 PDF encryption

Correctness traps, in order of how badly they bite: encrypting every string *and* every stream but forgetting
the metadata or the trailer `/ID`; mishandling embedded files; producing a document that our own reader opens
and Acrobat rejects; and permission bits that a user mistakes for enforcement. Also: **any rewrite invalidates
existing digital signatures.** The UI must warn before protecting or sanitising a signed document.

### 6.6 Archive encryption

AES ZIP is a WinZip extension, not a base-spec feature. Windows Explorer and macOS Archive Utility cannot open
it — this is the number one support question for every tool that offers it. ZipCrypto, the compatible option, is
broken. Both facts have to be on screen *before* the user types a password, not in a help article.

### 6.7 Sanitising claims

Removing an annotation does not remove the text drawn under it. Removing a property does not remove a copy of it
in an orphaned object, an XMP packet, an embedded thumbnail, or a revision. A rewritten PDF by pdf-lib drops
incremental-update history (good) but keeps every object it was told about (bad). Therefore: report **what was
found** and **what was removed**, and never print "sanitised". The product's own security doc already takes this
position for archives; keep it.

### 6.8 The risk that is specific to this product

Every one of these features asks the user to *type a secret into our page*. That raises the stakes on things that
are otherwise housekeeping: no password in a toast or an error string, no `console.log` of file bytes, no
third-party script ever (an injected script reads the password field), a strict CSP, and honest documentation
that a compromised device or a malicious extension is outside the browser's threat model.

---

## 7. Product recommendation

**The direction works, but not as stated.** "Convert, compress, transform, inspect, sanitize, protect, unlock"
reads as a list of equal verbs. Technically they are not equal: inspect, sanitise and unlock are things the
browser does *better* than a server (the bytes never move, and the analysis is cheap). Conversion is the one
category where the browser is structurally outgunned, because document fidelity needs a layout engine.

So the recommendation is to rebalance:

1. **Move the centre of gravity to "know what is in this file, and take things out of it."** That is a real,
   underserved, privacy-native product: metadata, GPS, hidden content, embedded files, scripts, annotations,
   signatures, encryption status — then remove what the user chose, and say exactly what was removed. Nothing in
   the current architecture resists this; most of it is already built.
2. **Keep exactly the conversions whose output is unambiguous.** Rasterising a PDF page, extracting text,
   re-encoding an image, repackaging images into a PDF — these have honest definitions and can be verified by
   looking at the result. PDF→DOCX and Office→PDF do not, and no amount of engineering inside a tab will change
   that.
3. **Treat "Protect" as a serious, narrow category.** Real AES-256 ZIP, real ECMA-376 Agile Office encryption,
   real PDF encryption — each with a compatibility statement and no permission theatre. This is the highest
   trust-per-byte feature the product can offer, and the place where "no fake security" has to be enforced
   hardest.
4. **Keep the identity.** "Convert. Compress. Transform. Locally." still describes the *tools*; the thing that
   grows is the fourth word of the promise — *locally* — into "inspect, clean and protect locally, too".

If the choice is between "more converters" and "the most trustworthy local privacy toolkit", the second is both
more defensible and more buildable. It also survives the one thing that would sink the first: a user opening a
converted DOCX and seeing their document mangled.

### Sequenced next steps (when implementation is approved)

1. Decide the hosting question in §2.2 (it gates PDF protection entirely).
2. Spike pdf.js-in-a-worker for one page (§5.1) — one day, decides the rendering architecture.
3. Ship V2.0 items 1–3 (Privacy Audit, image metadata, PDF→images) as the proof of the new category.
4. Build the Office decrypt path (V2.1 item 10) behind an interop test suite, not a demo.
5. Revisit PDF protection (V2.1 item 12) only after 1 and 2 are settled.

---

## Appendix — external sources consulted

Claims about library behaviour that are not visible in this repository's code were checked against:

* pdf-lib's encryption stance (API is a stub, `PDFDocument.load` refuses encrypted input) — its own docs, and the
  behaviour already observed in `src/lib/pdf/ops.ts`.
* PDF Standard Security Handler add-ons for pdf-lib, including the documented **xref-stream limitation** of any
  pdf-lib-based decryptor: <https://github.com/alestre/pdf-encrypt-lib>
* AES ZIP interoperability (Windows Explorer and macOS Archive Utility cannot open WinZip AE-2 archives):
  <https://tooltea.com/convert/zip-password-protector>, <https://essexsoftware.com/password-protect-zip/windows/>
* ECMA-376 Agile encryption parameters (AES-256 / SHA-512, spinCount 100 000), the CFB wrapper, and the
  "restriction" schemes that are *not* encryption: <https://strongwind.dev/office-password-toolkit/versions/office-2013/>
* LibreOffice-in-WASM reality check (≈147 MB wasm + ≈100 MB data, `SharedArrayBuffer`/COOP-COEP requirement,
  200–300 MB RAM, intermittent export hangs): <https://www.npmjs.com/package/@matbee/libreoffice-converter>,
  <https://dev.to/digitalofen/i-tried-running-file-conversion-fully-in-the-browser-wasm-libreoffice-ffmpeg-57mh>
* PDF→Word fidelity limits and why open-source converters reconstruct rather than convert:
  <https://www.nutrient.io/blog/convert-pdf-to-word/>
* SheetJS is no longer published on npm (registry stuck at 0.18.5, with CVE-2023-30533 and CVE-2024-22363 fixed
  only in CDN-only releases) — the reason this assessment recommends an own minimal XLSX writer or `exceljs`
  instead: <https://github.com/LumenMarch/ToolHub/pull/83>
