# ZeroUpload

**Every file tool you need. Nothing leaves your browser.**

Open **<https://amitpal-cyberbuddy.github.io/ZeroUpload/>** and use it. No
account, no install, no upload.

ZeroUpload converts, compresses, crops, merges, splits, protects, unlocks,
inspects and encodes files inside the tab you already have open. The work happens
on your device with the browser's own codecs, Web Crypto and background workers.
There is no server to send a file to — not "we delete it afterwards", but no
upload endpoint at all.

---

## Using it

1. **Bring a file in.** Drag it onto the drop zone, paste text, or pick it from
   your device. On the homepage, a dropped file opens the file inspector, which
   tells you what the file really is and what can be done with it. On a tool page,
   the file goes straight into that tool.
2. **Adjust the few settings that matter.** Each tool shows only the controls its
   job needs, with the current value and the resulting size or dimensions
   alongside.
3. **Download the result.** The original file on your disk is never modified. The
   browser's copy disappears when you close or reload the tab.

You can watch this yourself: open your browser's developer tools → Network, then
process a file. After the page has loaded, nothing is requested.

## What is in it

**Images** — convert between JPEG, PNG, WebP and AVIF (whichever your browser can
encode), compress with a quality dial and downscaling, resize to exact pixels,
crop with a draggable frame, rotate and flip, and generate a complete favicon set
from one square image.

**PDF** — merge documents in the order you choose, split or extract pages, rotate
pages, turn images into a PDF, password-protect with AES-256, and remove a
password you already know. Pages are copied rather than re-rendered, so text stays
selectable.

**Archives and Office** — build a ZIP (optionally with an AES-256 password), see
what is inside an archive before extracting it, and remove a password from a
Word, Excel or PowerPoint file you can already open.

**Inspection** — find out what a file actually is from its first bytes, read its
dimensions and metadata, and compute a SHA-256 digest to compare two files.

**Developer** — format, minify and validate JSON with the exact error position,
encode and decode Base64 (text or file), encode and decode URLs, and compute
SHA-256, SHA-512 or SHA-1 digests.

Every tool opens into its own workspace, loads only the code it needs, and can be
reached from the catalogue, the group pages, or the search palette.

## Batch mode

The image tools (compress, convert, resize, rotate and flip) accept up to **50
images** at once. Each file reports its own progress and its own failure, you can
cancel between files, and the results can be packaged into a ZIP without leaving
the page. Files are processed one at a time, on purpose: running two at once can
double memory use for a speed-up you cannot see.

## Limits, and what gets refused

Every limit exists because the browser has to hold the whole thing in memory. A
tool that cannot do something says so and tells you what to do instead; it does
not fail halfway through.

| What | Limit |
| --- | --- |
| One image | 120 MB |
| One PDF | 200 MB |
| One archive | 400 MB |
| One Office file | 100 MB |
| Pasted text | 25 MB |
| A file encoded to Base64 | 10 MB |
| A file being hashed | 512 MB |
| Image batch | 50 images / 300 MB |
| Merging PDFs | 50 documents / 250 MB / 3,000 pages |
| Images into one PDF | 200 images / 150 MB |
| Creating a ZIP | 2,000 files / 512 MB |
| Creating an encrypted ZIP | 500 files / 64 MB |
| Reading a ZIP | 5,000 entries / 512 MB expanded / 256 MB per entry |
| Splitting into one file per page | 500 pages |

Archive limits are checked against the archive's own index before anything is
decompressed, so a zip bomb is refused instead of unpacked.

## Compatibility notes

- **Password-protected ZIPs use WinZip AE-2 (AES-256).** 7-Zip, WinRAR, Keka and
  PeaZip open them. Windows File Explorer and macOS Archive Utility cannot. The
  warning appears before the archive is created, and the older ZipCrypto format is
  offered as a compatible-but-weak alternative.
- **Protected PDFs** use AES-256. The "permissions" (no printing, no copying) are
  recorded as a request that a reader may ignore, and the app says so rather than
  claiming the file is now locked down.
- **Office passwords** can be removed from a document you can already open.
  Adding a password to Office files is built but switched off in the public build
  until it has been opened in real Word, Excel and PowerPoint.
- **AVIF depends on your browser.** The format option is hidden when the browser
  cannot encode it, instead of failing after you press the button.
- **SVG is refused** as an image input: an SVG is a scriptable document, not a
  picture, and rendering one means running someone else's code.
- **No password cracking.** PDFs and Office files unlock only when you supply the
  password. Guessing and brute force are not offered and never will be.
- **Not supported:** video transcoding, OCR, RAR/7z extraction, and converting
  PDFs to Word or Excel. These need either huge downloads or a server, and this
  site has neither.

## Keyboard

- <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>K</kbd> or <kbd>/</kbd> — open the search
  palette from anywhere.
- <kbd>↑</kbd> <kbd>↓</kbd> to move, <kbd>Enter</kbd> to open, <kbd>Esc</kbd> to
  close. <kbd>Tab</kbd> reaches the palette's own controls and the recently opened
  tools.
- The palette remembers the last four tools you opened, on your device only. A
  `Clear` button in that row forgets them.

The interface follows your system's light or dark setting and can be switched in
the header. Motion is reduced automatically when your system asks for that.

## If something goes wrong

- A bug, a file that will not open, or a limit that seems wrong:
  [open an issue](https://github.com/AmitPal-CyberBuddy/ZeroUpload/issues) and say
  which tool and what the file was.
- A security problem: please follow
  [SECURITY.md](SECURITY.md) instead of opening a public issue.
- The site's own **How it works** page explains exactly what runs where, what the
  limits are, and why. It is written to be checked, not believed.

## Running it yourself

The whole product is a static site; there is no server component to install.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static output in dist/
npm run preview  # serve the production build
```

Node 22 or newer. `npm run verify` runs the build, the unit tests, the render
tests and the bundle report. The design record — architecture, audits, the visual
system, and what was deliberately rejected — starts at
[docs/README.md](docs/README.md).

## Licence

MIT. Use it, host it, fork it.
