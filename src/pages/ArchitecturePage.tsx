import { Link } from 'react-router-dom';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { Icon } from '../components/ui/Icon';
import { ZeroMark } from '../components/brand/ZeroMark';

export function ArchitecturePage() {
  useDocumentTitle('How local processing works');

  return (
    <main id="main" className="page">
      <article className="doc">
        <span className="eyebrow">Architecture</span>
        <h1>How a local-first file tool actually works</h1>
        <p>
          ZeroUpload is a static React application. There is no API server, no database and no upload
          endpoint, because nothing in the product needs one. This page explains exactly where your bytes
          go — and where they do not.
        </p>

        <div className="notice notice--accent" style={{ marginBottom: 'var(--s-6)' }}>
          <ZeroMark size={18} />
          <div>
            <strong>Watch the network tab.</strong> Open dev tools, process a file, and look at the requests.
            After the initial page load, there is nothing to see. That is the whole claim, and it is
            verifiable in ten seconds.
          </div>
        </div>

        <h2>The boundary</h2>
        <pre>
{`   your disk
      │  (drag, drop, paste — File API)
      ▼
┌──────────────────────────── browser tab ────────────────────────────┐
│                                                                    │
│  React UI ──► tool module ──► worker / WebAssembly / WebCrypto     │
│      ▲                              │                              │
│      └──── progress + result ◄──────┘                              │
│                                                                    │
│  Blob ──► object URL ──► <a download> ──► your disk                │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
      │
      ✕  no request is ever made with file contents`}
        </pre>

        <h2>What runs where</h2>
        <table className="doc-table">
          <thead>
            <tr>
              <th>Operation</th>
              <th>Engine</th>
              <th>Off the main thread?</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Image decode / encode</td>
              <td>Browser codecs via <code>createImageBitmap</code> + <code>OffscreenCanvas</code></td>
              <td>Yes — dedicated module worker</td>
            </tr>
            <tr>
              <td>Resize / crop / rotate</td>
              <td>2D canvas draw with high-quality smoothing</td>
              <td>Yes — same worker</td>
            </tr>
            <tr>
              <td>PDF merge / split / rotate / protect / unlock</td>
              <td>
                @cantoo/pdf-lib (pure JS, loaded only inside the worker). Encryption is AES-256
                (<code>/V 5 /R 6</code>) written by the library itself — no WASM, no{' '}
                <code>SharedArrayBuffer</code>, no cross-origin isolation, so it works on plain static hosting.
              </td>
              <td>
                Yes — dedicated module worker. Measured on a 114 MB document: the longest main-thread stall
                fell from ~1.9 s to 4–14 ms, with progress events and cooperative cancellation.
              </td>
            </tr>
            <tr>
              <td>ZIP create (packaging)</td>
              <td>
                fflate for plain archives; <code>@zip.js/zip.js</code> only when a password is set, because fflate
                cannot write AES. The two engines never touch the same archive.
              </td>
              <td>
                Yes — a third module worker. Packaging 30 batch results (18 MB) went from 818 ms of
                main-thread stall to 3 ms, and can be cancelled in about a millisecond. The archive buffer is
                transferred back, not copied.
              </td>
            </tr>
            <tr>
              <td>Office decrypt / encrypt</td>
              <td>
                <code>office-crypto</code> (a port of msoffcrypto-tool) for reading Agile and Standard containers,
                with <code>@noble/hashes</code> standing in for Node's crypto through a build-time alias. Writing is
                first-party: an Agile encryptor plus a minimal CFB container writer.
              </td>
              <td>
                Yes — a dedicated Office worker. The 100 000-round SHA-512 key derivation is ~0.5 s of synchronous
                work and would be a visible stall on the main thread.
              </td>
            </tr>
            <tr>
              <td>ZIP extract</td>
              <td>fflate for plain archives, <code>@zip.js/zip.js</code> for AES/ZipCrypto ones</td>
              <td>
                No — but limits are read from the archive directory before anything is inflated, so a bomb
                is refused without allocating its payload.
              </td>
            </tr>
            <tr>
              <td>Hashing</td>
              <td><code>crypto.subtle.digest</code></td>
              <td>Native, non-blocking</td>
            </tr>
            <tr>
              <td>JSON / Base64 / URL / text hashing</td>
              <td>Plain JavaScript</td>
              <td>No — inputs are small and bounded</td>
            </tr>
          </tbody>
        </table>

        <h2>Bundling strategy</h2>
        <p>
          Every tool is a separate dynamically imported chunk. The homepage ships no codec library at all.
          Measured from the last build: the entry chunk is 103 kB gzipped, the PDF engine 245 kB, zip.js 68 kB,
          fflate 12 kB, and the whole Office decrypt path about 29 kB. Each is fetched only when a tool that
          needs it is opened, so a visitor who compresses one photo never downloads the PDF engine.
        </p>

        <div className="doc-card-grid">
          <div className="doc-card">
            <h3>Entry chunk</h3>
            <p>React, router, design system, tool registry. Registry metadata is intentionally tiny.</p>
          </div>
          <div className="doc-card">
            <h3>Tool chunks</h3>
            <p>One per tool. Shared primitives (file card, stages, comparison) are hoisted into a common chunk.</p>
          </div>
          <div className="doc-card">
            <h3>Worker chunks</h3>
            <p>
              The image pipeline, the PDF engine and ZIP creation each compile to their own module worker,
              so decoding, encoding, PDF parsing and DEFLATE never block input handling. Each worker carries its
              own dependencies instead of shipping them with the page, and each has a main-thread fallback
              that runs the same code. Batch mode reuses the image worker one file at a time: concurrency is
              1, so peak memory cannot double for a speed-up nobody can perceive.
            </p>
          </div>
        </div>

        <h2>Safety limits, stated plainly</h2>
        <p>
          “Local” is not automatically “safe”. A browser tab is a resource-constrained process, and a
          malicious file can still exhaust it. These limits are enforced in code:
        </p>
        <ul>
          <li>Images up to 120 MB, PDFs up to 200 MB, archives up to 400 MB on input — larger files are refused with an explanation.</li>
          <li>
            ZIP limits (5,000 entries, 512 MB expanded, 256 MB per entry) are enforced against the archive
            directory <em>before</em> decompression — checking after inflating would already be too late.
          </li>
          <li>
            Operations that take several files have a cumulative budget, checked from file sizes before
            anything is read: ZIP creation 2,000 files / 512 MB, PDF merge 50 documents / 250 MB / 3,000
            pages, images → PDF 200 images / 150 MB.
          </li>
          <li>
            Batch mode adds three ceilings of its own — 50 images, 300 MB of input and 300 MB of retained
            results — all decided from file sizes. Each file still passes the single-file checks, so a batch
            is not a way around them.
          </li>
          <li>Entry names are sanitised; <code>../</code> traversal and absolute paths cannot escape.</li>
          <li>SVG input is refused rather than rasterised, because an SVG is a scriptable document with browser-dependent rendering.</li>
          <li>File signatures are checked against extension claims; mismatches are surfaced.</li>
          <li>
            Image dimensions are read from file headers rather than decoded, so intake does not stall the
            main thread before the worker starts.
          </li>
          <li>Hashing is capped at 512 MB, because WebCrypto has no streaming digest.</li>
          <li>Archive contents are only ever offered as downloads. Nothing executes automatically.</li>
        </ul>

        <h2>Object URL lifecycle</h2>
        <p>
          Previews, downloads and result panels all acquire blob URLs through one hook that revokes them on
          unmount or replacement. Downloads revoke after the browser has started the save. A long session
          should not accumulate dead blob references — that is an explicit design requirement, not an
          afterthought.
        </p>

        <h2>What cannot be done locally</h2>
        <p>
          Rather than quietly introducing a server, ZeroUpload states the gaps:
        </p>
        <ul>
          <li>
            <strong>Video transcoding</strong> to arbitrary formats. WebCodecs exists but codec support and
            container muxing are still uneven; it is planned, not faked.
          </li>
          <li>
            <strong>OCR and heavy ML tasks</strong>. Possible with WASM models, at a download size most users
            would not accept for a simple conversion.
          </li>
          <li>
            <strong>Password-protected PDFs</strong>. These are rejected; decrypting them is out of scope.
          </li>
          <li>
            <strong>Legacy formats</strong> such as RAR, 7z, or PSD flattening, which need large native
            decoders.
          </li>
        </ul>

        <h2>Deployment</h2>
        <p>
          The build output is plain HTML, CSS, JavaScript and one worker bundle. It is deployed to GitHub
          Pages by a workflow that runs the Vite build and publishes <code>dist/</code>. Routing uses hash
          URLs so deep links survive on a project subpath (<code>/ZeroUpload/</code>) without any rewrite
          configuration, and asset paths are relative — the site also works from a custom domain or a
          subdirectory without rebuilding.
        </p>

        <hr />

        <div className="row row--wrap">
          <Link to="/tools" className="btn btn--primary">
            Open a tool <Icon name="arrow-right" size={14} />
          </Link>
          <a
            className="btn btn--secondary"
            href="https://github.com/AmitPal-CyberBuddy/ZeroUpload"
            target="_blank"
            rel="noreferrer noopener"
          >
            <Icon name="github" size={14} /> Read the source
          </a>
        </div>
      </article>
    </main>
  );
}
