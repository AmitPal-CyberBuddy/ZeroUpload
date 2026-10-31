# V2 proof of capability

Three V2 capabilities were marked "uncertain" in [`v2-assessment.md`](v2-assessment.md): protecting PDFs,
writing password ZIPs, and protecting Office documents. All three depend on things a static site on GitHub
Pages may not be able to do — a wasm build that wants `SharedArrayBuffer`, a crypto format that other
applications may refuse, a library that only exists for Node.

This file answers them with running code before any production tool is touched. Each spike lives in
[`spikes/`](../spikes/), imports nothing from `src/`, and is not part of the app build.

**Gate:** no V2 tool architecture changes until these proofs pass. They now have — with three caveats that
are stated in §7 and §8 rather than buried.

---

## 1. What was run, and on what

| | |
| --- | --- |
| Machine | Linux sandbox, x86-64, Node v22.22.3 |
| Verification runtimes | pikepdf 10.17.0 → **libqpdf 12.4.2**, pypdf 6.21.4, msoffcrypto-tool 6.0.0 (CPython + pycryptodome), pyzipper 0.4.0 (AES via pycryptodome), Info-ZIP `UnZip 6.00` |
| Fixture producers | pikepdf/libqpdf, python-docx 1.2.0, openpyxl 3.1.5, python-pptx 1.0.2, pyzipper |
| Browser | **none available in this environment** — see §8 |

Every number below is printed by a script in `spikes/node/`, and the raw rows are written to
`spikes/node/out/*/results.json` (gitignored; regenerate with `npm run all` in `spikes/`).

### The verification rule

No spike is allowed to certify itself. Each output is opened by an implementation that shares no code with
the writer:

| Artifact | Written by | Read/verified by |
| --- | --- | --- |
| PDF | `@cantoo/pdf-lib` (JS) | libqpdf, pypdf |
| PDF fixture for reading | libqpdf (`pikepdf.save`) | `@cantoo/pdf-lib` opens it, libqpdf re-checks the result |
| ZIP | `@zip.js/zip.js` (JS) | pyzipper (pycryptodome), Python stdlib `zipfile`, Info-ZIP `unzip` |
| Office (read) | msoffcrypto-tool (Python) | `office-crypto` (JS), byte-for-byte against the original package |
| Office (write) | our `spikes/node/agile.mjs` (Web Crypto) | msoffcrypto-tool, byte-for-byte + HMAC integrity |

---

## 2. Spike 1 — PDF protection

Two candidate engines were tested. The first failed on a real-world class of files; the second passed
everything.

### 2.1 `pdf-lib-encrypt` 1.0.3 — insufficient

It writes valid AES-256 (`/V 5 /R 6`, `/StmF /StdCF`, `UE/OE/Perms` present) that libqpdf opens with the user
password, refuses without one, refuses with a wrong one, and enforces the exact `/P` bits requested. Its
output is genuinely correct — the problem is what it can *read*:

| Input (all produced by libqpdf, 5 pages) | `pdf-lib-encrypt` |
| --- | --- |
| AES-256 R6, **object streams on** (what Acrobat, qpdf, Chrome print-to-PDF and every modern writer produce) | **fails in 4 ms**: "This PDF stores objects in compressed object streams, which pdf-lib cannot parse" |
| AES-256 R6, object streams off | unlocked, 25 ms |
| AES-128 R4 | **unsupported**: "Unsupported encryption: AES-128 (/AESV2)" |
| RC4-128 R3 | unlocked, 7 ms |
| owner-password-only (no open password) | **fails** — the fixture had object streams |

An unlock tool that cannot open the files people actually have is not an unlock tool. Rejected.

### 2.2 `@cantoo/pdf-lib` 2.11.1 — passes, and replaces both engines

`PDFDocument.encrypt()` on write, `PDFDocument.load(bytes, { password })` on read.

| Check | Result |
| --- | --- |
| encrypt() wall time / RSS / size | 32 ms · +6.0 MB · 1.13× input |
| `/Encrypt` dictionary as libqpdf reads it | `V=5 R=6 Length=256 P=-1852 StmF=/StdCF UE=true Perms=true` |
| libqpdf, no password | refused (`PasswordError`) |
| libqpdf, user password / owner password | 5 pages / 5 pages |
| libqpdf, wrong password | refused |
| pypdf (independent) | 5 pages, 831 chars extracted |
| **read AES-256 with object streams** | **opened, 5 pages, 165 ms** |
| read AES-256 without object streams | opened, 5 pages, 172 ms |
| read AES-128 R4 | opened, 5 pages |
| read RC4-128 R3 | opened, 5 pages |
| wrong password on read | throws `Password incorrect` |
| `isEncrypted` without decrypting | `true` |
| owner-only file (empty user password) | `isEncrypted` true; opens with `password: ''`; output has no `/Encrypt` |
| change password (decrypt → re-encrypt) | new password accepted by libqpdf |
| 200-page document | 200 pages unlocked, 56 ms, +1 MB RSS |

Both object-stream modes are covered, which is exactly the gap that disqualified §2.1.

### 2.3 `qpdf-wasm` 0.1.0 — rejected and removed (kept only as a record)

This was the assessment's preferred engine, so it needed a verdict even though the PDF engine decision no
longer depends on it. It is no longer part of the architecture, the dependency list or any tool.

The distribution is a single emscripten **pthread** build. From `node_modules/qpdf-wasm/qpdf.js`:

```js
WebAssembly.Memory({ initial: 1024, maximum: 32768, shared: !0 })
```

`shared: true` memory can only be constructed in a **cross-origin isolated** context, which requires
`Cross-Origin-Opener-Policy: same-origin` **and** `Cross-Origin-Embedder-Policy: require-corp` on the
document. GitHub Pages serves no custom response headers, so a static site hosted there is never
cross-origin isolated. The only workaround is a service-worker shim (`coi-serviceworker`) that injects the
headers client-side, needs a reload on first visit, and does nothing when service workers are unavailable
(private windows, some in-app browsers, `file://`).

A Node harness was attempted first (see `spikes/node/qpdf-run.mjs`) and did not complete the emscripten
pthread handshake in 25 s, so no execution proof exists in this environment either.

**Verdict: rejected and removed.** Not because it is bad software — it is the most capable PDF library of the
three — but because it cannot run on the deployment target without a fragile trick, and nothing it offers is
needed once §2.2 covers both directions. `qpdf-wasm` therefore appears nowhere in the dependency list, the
architecture, or the UI: the capability check (`crossOriginIsolated`) that was going to guard it is deleted too,
rather than left in as dead weight.

---

## 3. Spike 2 — ZIP AES-256

`@zip.js/zip.js` 2.24.0, `encryptionStrength: 3` (AES-256), WinZip AE-2.

| Check | Result |
| --- | --- |
| write AES-256 (3 small files) | 112 ms · +12.7 MB RSS · 0.8 kB |
| entry metadata (Windows semantics) | `method=99` (0x63), `flags=0x9` = encrypted, AE-2 extra field `vendor_version=2`, `key_bits=256` |
| **pyzipper reads it** (independent AES implementation) | 3 entries, content intact |
| Python stdlib `zipfile` | refused — `NotImplementedError` (no AES in stdlib) |
| **Info-ZIP `unzip`** | refused: "3 files skipped because of unsupported compression or encoding" |
| zip.js decrypts a **pyzipper-written** AES archive | 1 entry, 1440 chars, 9 ms |
| wrong password | `Invalid password` |
| ZipCrypto option (`zipCrypto: true`) | opens in Info-ZIP; `method=8`, no AES extra field |
| 50 × 1 MB incompressible input, AES-256 | 1 928 ms · **+188 MB RSS** for 50 MB in |
| bundle (`ZipWriter`/`ZipReader`/Blob+Text readers) | 163 kB raw · **70 kB gz** |

### The compatibility answer, stated plainly

An AES ZIP **cannot** be opened by Windows Explorer or macOS Archive Utility. That is not a bug in zip.js;
it is what AE-2 is. The task's job is to say so in the UI, not to hide it, and to offer the alternative that
actually opens everywhere (ZipCrypto, with a security note) — while refusing to make ZipCrypto the default.

The 188 MB RSS delta for 50 MB of input sets the size budget for this tool: buffering the whole archive is
acceptable at ~25 MB input, not at 200 MB. Streaming (`ZipWriterStream`) is the obvious fix if a larger budget
is wanted, but that is an integration decision, not a proof question.

---

## 4. Spike 3 — Office protection

### 4.1 Reading (what a "remove password" tool needs)

Files written by msoffcrypto-tool, decrypted by `office-crypto` 0.1.0:

| Format | Result | Time | RSS |
| --- | --- | --- | --- |
| .docx (36 kB, python-docx) | byte-identical to the original package | 233 ms | +5.6 MB |
| .xlsx (5.6 kB, openpyxl) | byte-identical | 223 ms | +0.4 MB |
| .pptx (28 kB, python-pptx) | byte-identical | 240 ms | +0.0 MB |
| wrong password | `InvalidKeyError` | — | — |

"Byte-identical" is the strongest statement available here: the decrypted output matches a file produced
before encryption ever happened, by a different program.

**But `office-crypto` is not browser-ready as published.** Its ESM build starts with
`import { createHash, createCipheriv, … } from "crypto"` — Node's built-in. esbuild refuses to bundle it for
`--platform=browser`. The fix is a 140-line shim (`spikes/node/crypto-browser-shim.mjs`) that maps those six
entry points onto `@noble/hashes` and `@noble/ciphers`; Spike 5 bundles the whole thing that way:

| Check | Result |
| --- | --- |
| browser bundle with the shim | 59 kB raw · **21 kB gz** |
| Node built-ins left in bundle | none |
| decrypts .docx / .xlsx / .pptx | byte-identical · 716 / 459 / 477 ms |
| opens files our own encryptor wrote | byte-identical |
| wrong password | `InvalidKeyError` |

That is a real, bounded piece of integration work — not a "should work", but also not free.

### 4.2 Writing (what a "protect with password" tool needs)

No published JavaScript library encrypts OOXML. `office-crypto`'s README says "decrypting (and encrypting)",
but its API surface exports no encrypt function, and its internal crypto is Node-only anyway.

So the spike implements [MS-OFFCRYPTO] Agile encryption directly (`spikes/node/agile.mjs`, 8.7 kB, Web Crypto
+ `@noble/hashes` + `cfb` for the OLE container) and checks it against msoffcrypto-tool:

| Format | Result | Time |
| --- | --- | --- |
| .docx | msoffcrypto-tool decrypts it **byte-identically**, HMAC integrity verified | 619 ms |
| .xlsx | byte-identical, HMAC verified | 572 ms |
| .pptx | byte-identical, HMAC verified | 537 ms |
| wrong password at the reference reader | refused | — |
| 8 MB package | byte-identical, +45 MB RSS | 1 149 ms |

Parameters written: AES-256 / CBC, SHA-512, `spinCount=100000`, 16-byte salts, plus the DataSpaces streams
Office expects. The secret key is 32 random bytes (msoffcrypto generates 16 random bytes and pads the rest
with `0x36`, which halves the effective key strength; we do not copy that).

### 4.2b The same thing, as production code, re-verified

The spike was then written as the code the app actually ships — `src/lib/office/agile.ts` + `cfb.ts` +
`dataspaces.ts`, with a first-party CFB writer (so the `cfb` package is *not* a dependency) — and checked again
against the same independent reader:

| Check (production `encryptOoxml`) | Result |
| --- | --- |
| .docx (41 984 B), then msoffcrypto `decrypt(verify_integrity=True)` | **byte-identical** to `tests/fixtures/plain.docx`, HMAC verified · 551 ms |
| .xlsx (10 240 B) | byte-identical, HMAC verified · 543 ms |
| wrong password at the reference reader | `InvalidKeyError` |
| OLE streams present | `EncryptionInfo`, `EncryptedPackage`, `\x06DataSpaces/{Version,DataSpaceMap,DataSpaceInfo/StrongEncryptionDataSpace,TransformInfo/StrongEncryptionTransform/\x06Primary}` |
| `EncryptionInfo` header | `04 00 04 00 40 00 00 00`, namespace `…/office/2006/encryption` |

The one check this environment cannot make is Word, Excel and PowerPoint opening the result. That single gap is
why the writer ships behind `VITE_ENABLE_OFFICE_ENCRYPTION` (default off). Reading carries no such caveat: it
consumes files Word produced, and the output is compared byte for byte.

### 4.3 Two findings that change the design

**The spin loop must not use `crypto.subtle.digest` per iteration.** 100 000 iterations, measured:

| Implementation | 100 000 rounds |
| --- | --- |
| `crypto.subtle.digest` promise per round | **6 093 ms** |
| Node `crypto.createHash` (sync native) | 355 ms |
| `@noble/hashes` sha512 (sync, pure JS, 5.6 kB gz) | **482 ms** |

Same output, 12.6× faster, and it can run in a worker without awaiting 100 000 promises. This was worth
finding before writing the tool: the first version of the spike took 6 s per document for exactly this
reason, and the whole "does Office protection feel instant?" question turns on it.

**Web Crypto's AES-CBC always pads.** `subtle.encrypt('AES-CBC')` applies PKCS#7, so an already block-aligned
32-byte input comes back as 48 bytes and every downstream reader rejects the file (this was the spike's first
failure: libqpdf reported `Invalid key size (384)`). The fix is to drop the final block. Worth knowing before
someone "simplifies" the code later.

**`office-crypto`'s `verify_password` path is broken in the reference implementation too.** With
`verify_password=True`, msoffcrypto-tool calls `.digest()` twice on one hash object, so the second derivation
sees empty input — it rejects files it encrypted itself. Verification here therefore relies on payload HMAC
integrity plus byte equality, which is the stronger check anyway.

---

## 5. What each candidate costs in a lazy chunk

esbuild, `--minify --format=esm --platform=browser` (the same tree-shaking Vite does), then `gzip -9`.
Measured, not estimated (`spikes/node/04-bundles.mjs`).

| Chunk | Raw | gzip | Cross-origin isolation | Subpath (`base: './'`) |
| --- | --- | --- | --- | --- |
| PDF — `@cantoo/pdf-lib` (read + write AES-256) | 583 kB | **245 kB** | not needed | safe |
| PDF — `pdf-lib` (already shipped, cannot encrypt) | 421 kB | 175 kB | not needed | safe |
| ZIP AES — `@zip.js/zip.js` | 163 kB | **70 kB** | not needed | `import.meta.url` in worker path — verify after bundling |
| Office read — `office-crypto` + shim | 59 kB | **21 kB** | not needed | safe |
| Office write — our Agile + `cfb` + `@noble/hashes` | 45 kB | **18 kB** | not needed | safe |
| `fflate` (already shipped, for scale) | 32 kB | 12 kB | not needed | safe |

As built (`npm run build`, 2026-10-31): entry `index` 324.6 kB raw / **102.8 kB gz**, PDF engine `ops`
564.4 kB / **244.5 kB gz**, `zip.js` 161.9 kB / **68.1 kB gz**, Office path split across `browser` 7.9 kB,
`dist` 10.9 kB, `sha2` 5.1 kB, `office` 1.6 kB and `agile` 3.1 kB gz — about 29 kB gz in total, all lazy.

The PDF engine costs **+70 kB gz over the `pdf-lib` we ship today**, in a chunk that is only fetched when a
PDF tool runs. That is the entire price of PDF protect/unlock, and it needs no wasm and no headers.

None of the chosen bundles reference `SharedArrayBuffer`, `Atomics` or `crossOriginIsolated`, which is the
property that makes them deployable on GitHub Pages at all.

---

## 6. Verdicts

| V2 capability | Verdict | Condition |
| --- | --- | --- |
| PDF protect (password, permissions) | **Go** | `@cantoo/pdf-lib` as the PDF engine; AES-256 R6 by default |
| PDF unlock (remove password) | **Go** | same engine; covers AES-256 with object streams and owner-only files |
| PDF unlock of AES-128 / RC4 files | **Go** | verified against libqpdf fixtures; UI should say "encrypted PDF", not "AES-256" |
| ZIP inspect / extract (existing) | **No change** | `fflate` stays for plain ZIPs |
| ZIP create with a password (AES-256) | **Go, with a warning** | Explorer / Archive Utility cannot open the result; say so before writing |
| ZIP create with a password (ZipCrypto) | **Go, secondary** | offered as the "opens everywhere" option, never the default |
| Office unlock (.docx/.xlsx/.pptx) | **Go, with work** | requires the crypto shim for `office-crypto`; 21 kB gz |
| Office protect (.docx/.xlsx/.pptx) | **Go, gated** | our own [MS-OFFCRYPTO] Agile implementation, ~540–620 ms per document; shipped behind `VITE_ENABLE_OFFICE_ENCRYPTION=1` until a real Word/Excel/PowerPoint round trip exists |
| qpdf-wasm based tools | **No-go — removed** | needs cross-origin isolation; unavailable on GitHub Pages. No wasm in the PDF path at all |
| password cracking / brute force | **No-go** (unchanged) | not a capability this product will add |

---

## 7. The caveat that must not be softened

Everything above was checked against **independent software implementations**, not against the applications
users will judge us by. Specifically, these were **not** run, because they do not exist in this environment:

- Microsoft Word / Excel / PowerPoint opening our encrypted documents
- Adobe Acrobat opening our protected PDFs
- Windows Explorer and macOS Archive Utility opening our AES ZIPs (Info-ZIP `unzip` is the closest proxy
  available, and it refuses them, which matches the documented Explorer behaviour)
- any browser at all

For the PDF and Office directions the risk is low — libqpdf's `PasswordError` and msoffcrypto-tool's byte
equality are strong signals that the container and the crypto are right. For Office *writing*, "Opens in Word"
is still a claim we cannot make from here, and the UI copy must not make it until someone has tried it on a
real Office install.

Browser-specific numbers (tab memory, paint, worker startup) are also unmeasured. What was measured is the
same code path running on Node's Web Crypto, which is the same API surface the browser exposes; the numbers
in §4 are therefore an upper bound for CPU work, not a browser benchmark.

---

## 8. What followed from this

`spikes/` is a separate npm package with its own `.gitignore`, not imported by the app and not part of
`npm run build`. The implementation that followed this gate, in order:

1. **PDF engine swap** — `@cantoo/pdf-lib` replaces `pdf-lib` in the PDF worker. One dependency change plus
   import-site updates; the `lib/pdf` façade stays, so React does not see it.
2. **PDF protect/unlock as a real tool**, AES-256 R6, permissions mapped to the existing `/P` vocabulary;
   no wasm, no `coi-serviceworker`, no headers.
3. **A second ZIP writer** behind the existing `createZip` interface: `fflate` for plain archives,
   `@zip.js/zip.js` for encrypted ones, with the compatibility warning as part of the flow.
4. **Office read** needs the crypto shim committed next to the tool (it is the difference between "works in
   a browser" and "works in Node").
5. **Office write** is new code with a spec citation in comments and the msoffcrypto-tool interop test kept as
   a fixture test; the spin count stays at 100 000 and runs in a worker. It is compiled into the app but hidden
   from the registry (no route, no catalogue entry, no palette entry) unless `VITE_ENABLE_OFFICE_ENCRYPTION=1`.
6. **`qpdf-wasm` is absent** from `package.json`, the architecture page, `v2-assessment.md` and this plan.

Open question that is a product decision, not a spike result: whether 0.5–0.7 s of CPU per protected Office
document (measured on this machine, in a worker) is acceptable UX. The tool states the cost up front rather than
hiding it behind a spinner.

---

## 9. Reproducing

```bash
cd spikes
npm install
npm run all        # pdf:cantoo → zip → office → office:browser → bundles
```

Verification needs a Python virtualenv with the reference implementations:

```bash
python3 -m venv /tmp/venv
/tmp/venv/bin/pip install pikepdf pypdf msoffcrypto-tool pyzipper python-docx openpyxl python-pptx
```

Scripts expect it at `/tmp/venv/bin/python`; edit the `PY` constant in each file to point elsewhere. Generated
fixtures and `results.json` files land in `spikes/node/out/` (gitignored).
