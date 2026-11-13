# Platform review — what to fix next

Review date: 13 November 2026 · checkout `3c45bc4` · branch `arena/19efb913-zeroupload`

This is a **fresh pass**, not a re-litigation. `docs/audit-and-plan.md`,
`docs/improvements.md`, `docs/ux-audit.md` and `docs/v2-assessment.md` are treated
as done; items they already recorded (duplicate engine graphs, `TOOL_CONTENT` in
the entry chunk, three near-identical worker clients, offline support) are not
re-derived here. Everything below was measured on this checkout, and every number
is reproducible with the command shown.

## Status of this pass

Findings **1–4** (the three formatter bugs and the missing boundary test) are
**fixed on this branch**, because they are small, isolated and verifiable
immediately:

| | Before | After |
| --- | --- | --- |
| `formatBytes(1 MiB − 1)` | `1024 KB` | `1 MB` |
| `formatBytes(1023.6)` | `1024 B` | `1 KB` |
| `formatDuration(3 599 999)` | `59m 60s` | `1h 0m` |
| `formatDuration(3 600 000)` | `60m 0s` | `1h 0m` |
| `middleTruncate('a.png', 4)` | `a…a.png` (7 chars) | ≤ 4 chars, no repeated glyph |
| Tests for `lib/files/format.ts` | 0 independent | **15**, hand-written expectations |

`tests/format.test.ts` is new and its expectations do not call the functions to
build the values they assert. Everything else in this document is a
recommendation, not a change.

Post-fix verification: `tsc -b` clean · **520 Node tests / 44 files** ·
**65 jsdom tests / 11 files** · build green, 30 pages, 755 links, 0 warnings, CSP
on 32 documents.

## Baseline, as built today

| | |
| --- | --- |
| Build | green — 30 routes prerendered (+404), 755 internal links, 0 broken, 0 warnings |
| CSP | on all 32 emitted documents, `connect-src 'none'`, script hashes regenerated per build |
| Tests | **585 passing** — 520 Node / 44 files, 65 jsdom / 11 files (505 before this pass) |
| Entry | 389.0 kB raw · **122.6 kB gzip** (one chunk: `index-*.js`) |
| Artifact | **4.75 MiB / 125 files**, 78 JS files, 993 kB gzip of JS in total |
| Dependencies | 11 runtime, 7 dev · `npm audit` **0 vulnerabilities** |
| Code | 20 929 lines TS/TSX · 5 139 lines CSS · 7 351 lines of tests · 22 visible tools (23 defined) |
| Hygiene | no `eval`/`new Function`, no `dangerouslySetInnerHTML`, **no `any`**, no stray `console.*`, no `TODO`/`FIXME` |

Measured with `npm run build && npm test && npm run test:dom && npm run weigh`.

## What holds up (keep it)

Said first, because the list below is long and this is not a demolition.

| Area | Evidence |
| --- | --- |
| **Contrast** | Recomputed every text/surface pair from `tokens.css` in both themes: worst case is `--text-muted` on `--surface-3` at **4.69:1 dark / 4.66:1 light** — inside the 4.5:1 AA floor, with the least headroom of any pair. The old failure modes (hover 4.00:1, focus ring 1.38:1) stay fixed. |
| **CSP as mechanism** | `connect-src 'none'` is on every document, placed before the first script, hashes recomputed at build time. This is the real differentiator and it is *enforced*, not claimed. |
| **Budgets before allocation** | `budget.ts` / `limits.ts` decide from `File.size` metadata only. The encrypted-ZIP budget carries its measured 3.8× memory reason inline. |
| **Keyboard parity where it is hard** | `CropTool` is a genuine keyboard editor: `role="group"`, `aria-roledescription="crop frame"`, live region, arrow-key nudge through the same clamp functions as a pointer drag. Most crop UI does not do this. |
| **Error shape** | One `ToolError` with `code` + `hint`; `toToolError` maps `QuotaExceededError` to actionable copy. |
| **Build is the test** | Registry → routes → catalogue → search → sitemap → JSON-LD → prerender, with link checking at build. A route that half-exists fails the build. |
| **Streaming where it was remembered** | `lib/inspect/compare.ts` hashes two blobs incrementally in 1 MiB chunks with `@noble/hashes`, yielding to the event loop, with cancellation and progress. This module is the answer to finding 6. |

---

## P1 — bugs, ordered by what they cost a user

### 0. The prerendered HTML is thrown away and re-rendered — there is no hydration

`main.tsx` mounts with `createRoot(container).render(…)`, not `hydrateRoot()`.
Verified in this checkout: a container holding prerendered markup is **emptied and
rebuilt** on mount, and React logs no mismatch because it is not diffing anything:

```
container before: <h1>Prerendered</h1><p>text</p>
createRoot(root).render(<h2>Client</h2>)
container after:  <h2>Client</h2>          ← prerendered nodes discarded
```

The consequences are real and they cut against the two things the project has
invested most in:

- **SEO half-wasted.** `scripts/prerender.mjs` emits full HTML for 30 routes, and
  `docs/seo-plan.md` §"Option A" describes a "hydrated shell". Crawlers still read
  the static HTML, so the SEO benefit survives — but every page is fully replaced
  on first load, so the *paint* benefit and the "readable before JavaScript"
  property are not what the design intends.
- **Double work on every visit.** The browser parses the prerendered tree, then
  React discards it and builds the same tree again. On a tool page that is ~14 kB
  of DOM thrown away (measured: `dist/tools/merge-pdf/index.html` body is 14,806
  characters).
- **The comments overstate the guarantee.** `main.tsx` says "The container already
  holds the prerendered HTML for this route. React takes it over on the first
  frame; until then the static content stays readable." Only the second half is
  true.

**Fix:** `hydrateRoot(container, <App/>)` in `main.tsx`, keeping `createRoot` for a
container that is empty (dev server, 404 fallback). This is the intended pairing
with a prerenderer, and it is a one-line change *plus* the mismatch work it
uncovers — which is exactly why it has to be its own change with the render suite
watching it. Expect a small number of mismatch warnings to fix on first attempt
(anything that reads `localStorage`, the clock, or `navigator` during render —
`SiteHeader` already documents one such case).
**Cost:** S–M. **Risk:** medium — hydration mismatches surface as warnings, not
failures, so this needs a test that asserts *no* `console.error` on mount of each
route, or the mismatch will live on invisibly.

### 1. `formatBytes` prints `1024 KB` and `1024 B` at unit boundaries

```
formatBytes(1023.6)   → "1024 B"     should be "1 KB"
formatBytes(1048575)  → "1024 KB"    should be "1 MB"
formatBytes(1048575.9)→ "1024 KB"
```

The unit is chosen *before* rounding, and rounding is never re-checked. This is
not cosmetic in context: `formatBytes` is the single formatter behind every size
readout, the saved-bytes delta in the `Outcome` panel, and every limit message
(`budget.ts`, `FileDrop`, `copy.test.ts`). A 1,048,575-byte file genuinely reads
"1024 KB".

**Fix:** after rounding, if the value is `1024` and a larger unit exists, promote.
**Cost:** XS. **Risk:** none — output changes only at boundaries.

### 2. `formatDuration` prints impossible durations

```
formatDuration(59999)    → "60.0 s"     should be "60.0 s" only if < 60 s; else "1m 0s"
formatDuration(3599999)  → "59m 60s"    there is no 60th second
formatDuration(3600000)  → "60m 0s"     should be "1h 0m"
formatDuration(7200000)  → "120m 0s"    should be "2h 0m"
```

Seconds are rounded without carry, and minutes never promote to hours. It reaches
a real surface: the File Inspector renders `Computed in {formatDuration(hash.ms)}`
after a SHA-256 of a large file — exactly the run long enough to hit these values.

**Fix:** promote after rounding (seconds → minutes → hours).
**Cost:** XS. **Risk:** none.

### 3. `middleTruncate` can return a string *longer* than the limit, and echoes a character

```
middleTruncate('a.png', 4)    → "a…a.png"   (7 chars for a max of 4)
middleTruncate('photo.jpg',8) → "pho…o.jpg" (9 chars for a max of 8)
middleTruncate('ab', 1)       → "ab…b"      (stem shorter than the tail budget)
```

The stem is sliced twice from the same bounds when the extension dominates `max`,
so head and tail overlap and the same letter appears at both ends. The two live
call sites pass 30 (home page hand-off) and **52** (`ExtractZipTool`, entry names
from an arbitrary archive). With `max = 52` it triggers on entry names whose last
extension segment exceeds ~47 characters — a filename a ZIP can contain and a user
does not control.

**Fix:** compute the stem budget first, clamp, and when the stem is shorter than
head+tail return the stem unchanged; guarantee `result.length <= max`.
**Cost:** XS. **Risk:** none.

### 4. Nothing tests `lib/files/format.ts` at its boundaries — that is why 1–3 survived 570 tests

The module is imported by `tests/copy.test.ts` only to *build expected strings*
(`expect(text).toContain(formatBytes(DEFAULT_LIMITS.maxTotalBytes))`), which is a
tautology: it asserts the prose contains whatever the formatter returns. There is
no independent expectation anywhere.

**Fix:** one table-driven test with hand-written expected strings for
`formatBytes` (0, 1023, 1023.6, 1024, 1 MiB−1, 1 MiB), `formatDuration`
(999, 1000, 59999, 60000, 3599999, 3600000), and `middleTruncate` (extension
longer than `max`, stem shorter than tail, exact-length passthrough).
**Cost:** XS. **Risk:** none. This is the guard that makes 1–3 stay fixed.

### 5. Base64 re-encodes the whole input synchronously on every keystroke

`Base64Tool` computes `result` in a `useMemo` over `[input, mode, urlSafe]` with no
debounce and no worker. Measured cost of one pass:

| Input | Time (one keystroke) |
| --- | --- |
| 2 MB | **113 ms** |
| 10 MB | **548 ms** |

Only *file* input is capped (10 MB); the textarea is not. Pasting a few megabytes
of Base64 and then editing it locks the tab on every key. Every other expensive
tool in the app already has the machinery to avoid this (`useOutputEstimate`'s
400 ms debounce and supersession tokens, the image worker, `useRunControl`).

**Fix:** debounce the text path (~150 ms), or move it to the existing worker, and
cap typed input with the same explicit refusal the file path uses. The
`useOutputEstimate` debounce is the pattern to copy.
**Cost:** S. **Risk:** low.

### 6. The Hash tool and the Inspector hash the hard way, while the codebase already has the easy way

```
HashGeneratorTool  → hashFile(file)      → await file.arrayBuffer() → crypto.subtle.digest
FileInspectorTool  → hashBuffer(await file.arrayBuffer(), 'SHA-256')
lib/inspect/compare.ts → sha256.create(), 1 MiB slices, yields, cancellable, progress
```

The one-shot WebCrypto digest is what forces `MAX_HASH_BYTES = 512 MB`, the "split
it first, then hash the parts" advice, **and** the total absence of progress and
cancel in `HashGeneratorTool` (the only multi-second tool in the app with neither —
`grep` finds no `useRunControl`, no cancel button, no progress). `compare.ts`
already proves the alternative works with a library the repo already ships and
loads on that path.

Note on the claim: the memory saving is plausible but **not measured here**, so the
case rests on the properties, which are measured — progress, cancellation, and the
removal of a hard ceiling, not a byte figure.

**Fix:** extract `compare.ts`'s incremental loop into `lib/hash/stream.ts`; use it
from both tools; add progress + cancel to the Hash tool. Keep a generous cap.
**Cost:** S–M. **Risk:** low — the pattern is already in-tree and tested.

### 7. "One PDF per page" can only leave as a ZIP

`SplitPdfTool`'s flagship mode produces N documents, and `downloadAll` zips them
when `outputs.length > 1`. There is no per-file download, and the only documented
path to a single page is "download the archive and unzip it". The neighbouring
`ExtractZipTool` does offer per-entry download, so the affordance exists in the
design system already.

**Fix:** a per-row download button in the results list, with "Download all (.zip)"
kept as the bulk action.
**Cost:** XS–S. **Risk:** none.

---

## P2 — measurable, lower urgency

### 8. Nothing runs before a merge

`.github/workflows/deploy.yml` is the only workflow, and it triggers on `push` to
`main` and `workflow_dispatch` — **not on `pull_request`**. So on a branch, neither
the 570 tests, the build, the link check, nor `npm run weigh` execute; the first
time they run is after the merge. The comments in that file are careful about
*ordering* the build before the tests and about `dist`-dependent tests silently
skipping — the same reasoning applies one level up.

The four browser checks are a separate, smaller gap: `test:browser-layout`,
`-pdf-editor`, `-inspector`, `-xlsx` are documented as evidence
(`docs/project-review.md` explains how to run them with `BROWSER_PATH`) but no
workflow invokes them and no browser is installed in CI, so the only checks that
look at real layout and pointer behaviour never run automatically.

**Fix (cheap):** extract the build job into a `verify` workflow on
`pull_request` + `push: main`; let `deploy` depend on it. **Fix (better):** add a
matrix job that installs Chromium (`npx playwright install --with-deps chromium`),
caches it, and runs the four scripts against `vite preview`. Or, if they stay
manual, say so in one line in the docs — currently a reader is entitled to assume
CI covers them.
**Cost:** S for the gate, M for the browser job.

### 9. README and docs have drifted from the build

- The README's limit table has no row for **Excel to CSV: 10 MB**
  (`MAX_XLSX_BYTES`), while the tool's own empty-state hint states it.
- `docs/audit-and-plan.md` opens with `dist` 3.3 MB / 115 files / 401 tests /
  21 tools / 28 routes. Today: **4.75 MiB / 125 files / 570 tests / 23 defined
  tools (22 visible) / 31 HTML documents / 755 links**. `docs/improvements.md`
  contains two different test counts (363 and 387) in the same document.

In a repo whose authority comes from measured numbers, stale ones are a real cost.

**Fix:** one `docs/baseline.md`, regenerated by a script (`scripts/baseline.mjs`)
that prints the table above, plus a test asserting the README's limit table
matches `SIZE_LIMITS` + `BUDGETS` + `MAX_*` constants. The constants are already
the single source of truth; only the prose is separate.
**Cost:** S.

### 10. Extract ZIP allocates the whole archive to read its last 64 KB

```ts
const kind = inspectZipEncryption(new Uint8Array(await next.arrayBuffer())).kind ?? 'zipcrypto';
```

`inspectZipEncryption` only ever scans the final 65,557 bytes (`stop =
bytes.length - 65_557`) — the EOCD and central directory. Reading a 400 MB archive
end-to-end to answer "which cipher?" turns an instant question into a full
allocation on the exact path (encrypted, large) where memory is already tight
enough to have its own budget and its own comment.

**Fix:** `file.slice(-65_557).arrayBuffer()`. **Cost:** XS. **Risk:** low, but
the EOCD scan must be verified against a multi-disk / comment-length edge case in
the existing tests.

### 11. Twenty-one `getTool('…')!` assertions, on a lookup that can return `undefined`

Every tool component opens with `const tool = getTool('slug')!`. The registry
already exposes `getToolAny` for exactly this, and this class of assertion has
already caused one real bug (`ProtectOfficeTool`'s crash on `encrypt-office`, fixed
in Phase 1). Today the assertions are true because the registry is complete and a
test checks it; the failure mode if they ever stop being true is a blank page.

**Fix:** one `useToolDefinition(slug)` helper that throws a `ToolError` with the
slug and code `unknown`, or returns a narrow non-`undefined` type from a typed
slug union so `!` is unnecessary. **Cost:** S. **Risk:** none.

### 12. Light-mode browser chrome flashes dark before hydration

`index.html` and `site.webmanifest` hardcode `theme-color: #08090b`; `useTheme`
corrects it to `#f5f6f8` only after mount. On a light-preference device the mobile
browser UI and the PWA title bar start dark and flip. The pre-paint theme script
already runs before paint, so the value is knowable there.

**Fix:** set `theme-color` in the same inline bootstrap. **Cost:** XS.
**Risk:** none, but it changes the inline script, so `scripts/csp.mjs`'s hash is
recomputed automatically — verify with `tests/csp.test.ts`.

### 13. No formatter, and an `eslint-disable` that disables nothing

`npm run lint` is `tsc -b`. There is no ESLint/Prettier/Biome config and no
formatter dependency, yet `FileInspectorTool.tsx:136` carries
`// eslint-disable-next-line react-hooks/exhaustive-deps` — a suppression for a rule
that is not running, on a `useEffect` with an empty dependency array that reads
`pending`. TypeScript does not check hook dependencies.

**Fix:** either adopt Biome (single binary, no plugin config, fast) or drop the
comment and add a note that hook-deps are reviewed by hand. The second is honest;
the first is better. **Cost:** S. **Risk:** low.

### 14. No dependency-update automation, and no pinned Node

No `.github/dependabot.yml`, no `engines`, no `.nvmrc`, while CI pins Node 22 for a
project whose trust story rests on pinned and audited dependencies. Dependabot for
`npm` + `github-actions`, weekly, is a five-line file.
**Cost:** XS.

### 15. All 22 tools' FAQ prose is in the first-load chunk — restated with a number

Measured: **29.4 kB raw (~9.3 kB gzip) of the 122.6 kB entry** is
`seo/toolContent.ts`, because `ToolLayout` imports `TOOL_CONTENT` statically.
`docs/improvements.md` and `docs/improvements.md` already argue the SEO tradeoff,
and I agree the prose must stay in the prerendered HTML. The part worth
re-examining is narrower: the *client* does not need all 22 entries to render one
tool page, and the prerendered text is what crawlers read. A per-route dynamic
import (already the pattern for tools) would remove the prose from first load
while leaving every document's HTML intact — the cost is one small request on
client-side navigation to a tool page.

Presented as an option with its cost stated, not a recommendation: 9.3 kB gzip is
a fair price for zero navigation latency, and the current choice is defensible.

---

## P3 — product, ordered by proof-per-effort

These are proposals, not claims the platform supports today. Items marked
*already proposed* are in `docs/v2-assessment.md` / `docs/project-review.md` and
are listed only to say the sequencing still looks right.

1. **A local processing receipt.** After a run, offer a small panel: bytes read,
   bytes written, wall time, **network requests made: 0**, and the active CSP line.
   Everything except the counters already exists (`StageTimeline`, `Outcome`,
   `hash.ms`). For a product whose entire thesis is "nothing left your browser",
   the most persuasive artefact is a screenshot a sceptic can check against their
   own devtools. Cheap, and it makes the CSP visible instead of buried in `<head>`.
2. **Per-tool settings that survive a reload.** Today only theme, scroll positions
   and recent tools persist; every tool resets its quality/size/format each visit.
   A "remember this setting" for non-sensitive options (output format, quality,
   page-size preset) — never files, contents or passwords — removes the most
   repeated work in batch use. `recentTools.ts` already shows the safe
   `localStorage` pattern to copy.
3. **Total-savings preview for a batch.** `useOutputEstimate` already measures real
   encodes per file; summing them for the batch before the run ("50 images ·
   312 MB → 88 MB · 72% smaller · ~40 s") turns a 50-file commitment into a
   decision.
4. **Generated capability matrix** *(already proposed)* — now cheap, because the
   registry already holds status, tags, limits and format support. `/tools/`
   already exists as a group page; a comparison table generated from the registry
   and asserted by a test cannot drift.
5. **Offline install** *(already proposed; the cost is worth restating precisely)*
   — the expensive part is not the service worker, it is that content-hashed
   chunks plus prerendered HTML mean a stale shell can reference chunks that no
   longer exist after a deploy. The cheap 80% is a cache-first strategy for
   `assets/` only with a network-first HTML strategy, plus a "new version
   available" prompt. That yields real offline use with no invalidation trap.

Explicitly **not** recommended: PDF → DOCX, Office → PDF, OCR. `docs/v2-assessment.md`
§4–6 argues these at length and its conclusions still hold; nothing measured here
changes them.

---

## Suggested order

| # | Change | Cost | Why first |
| --- | --- | --- | --- |
| 1 | ~~`formatBytes` / `formatDuration` / `middleTruncate` + boundary test~~ **(done on this branch)** | XS | Three visible wrong numbers, and the missing guard that let them ship |
| 2 | `pull_request` CI gate (finding 8, cheap half) | S | Everything else lands more safely once this exists |
| 3 | Bounded tail read in Extract ZIP (10), `theme-color` (12), per-page download (7) | XS | Three small, isolated fixes |
| 4 | `useToolDefinition` to retire 21 `!` (11) | S | Mechanical, low risk, closes a class of bug |
| 5 | Base64 debounce/worker (5) | S | The only remaining "the tab freezes" path |
| 6 | Streaming hash helper for Hash tool + Inspector, with progress and cancel (6) | S–M | Uses a pattern already in-tree |
| 7 | Baseline script + README limit row (9), dependabot (14), formatter decision (13) | S | Keeps the docs' authority intact |
| 8 | Browser checks in CI (8, M half) | M | Highest remaining verification gap |
| 9 | Product items 1–2 | M | Proof and repeat-use, in that order |

Nothing above breaks local-only processing, lazy loading, workers, prerendering,
`BrowserRouter`, GitHub Pages compatibility, the registry model, or
`prefers-reduced-motion`.

## What this review did not check

- **Real browsers.** No Chromium was run: no Safari/Firefox, no iOS/Android touch,
  no zoom, no screen reader, no Windows High Contrast. The contrast numbers are
  computed, not perceived.
- **The engines themselves.** PDF, ZIP and Office correctness was taken from the
  existing suites and `docs/v2-proofs.md`; I did not re-verify encrypted-ZIP
  interop or PDF signature behaviour against real applications.
- **Large-file behaviour under memory pressure.** Budgets were read, not exercised
  at their ceilings on a constrained device.
- **Copy quality and information architecture** beyond the drift noted in finding 9.

## Reproducing

```bash
npm ci
npm run build            # 30 routes, 755 links, CSP, sitemap, 0 warnings
npm test                 # 520 pass (505 before this pass + 15 new boundary tests)
npm run test:dom         # 65 pass
npm run weigh            # entry 122.6 kB gz, per-route cost table

# findings 1–3, as measured
# (a throwaway vitest file is enough; these are pure functions)
# formatBytes(1 MiB - 1)        → "1024 KB"
# formatDuration(3_599_999)     → "59m 60s"
# middleTruncate('a.png', 4)    → "a…a.png"   (length 7)
```
