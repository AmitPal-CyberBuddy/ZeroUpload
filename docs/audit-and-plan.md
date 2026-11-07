# Whole-project audit and the plan that follows

Written after a full pass over the repository: source, build output, tests, CI,
dependencies, prerendered HTML, CSS, copy and docs. Everything below was measured
on this branch, not recalled.

Baseline at the time of writing:

| | |
| --- | --- |
| Code | 24 199 lines of TS/TSX · 4 542 lines of CSS · 21 tools · 28 routes |
| Build | entry 118.3 kB gz · CSS 12.4 kB gz · `dist` 3.3 MB · 115 files |
| Tests | 401 passing across 32 files, ~8 s |
| Dependencies | 11 runtime, 7 dev · `npm audit` clean |
| Warnings | 1 bundle warning (`INEFFECTIVE_DYNAMIC_IMPORT`) |

---

## What is genuinely fine

Said first, because a plan that starts with a demolition reads as theatre.

- **Architecture held.** One registry drives routes, catalogue, search, sitemap,
  JSON-LD and prerendering; nothing has drifted into a second source of truth.
  `tools.ts` and `toolContent.ts` cover all 21 tools with no orphans.
- **The build is the test.** 30 documents prerendered, 704 internal links checked,
  0 broken. A route that exists but is unreachable fails the build.
- **No vulnerable dependencies**, no `dangerouslySetInnerHTML`, no `eval` in any
  bundle, no remote origins in the shipped JS.
- **Copy is consistent.** "ZeroUpload" appears 49 times, always that spelling;
  "upload" appears in user-facing copy only inside negations.
- **Tests are fast and deterministic** — no DOM, no network, no snapshots.
- **CI exists and runs** typecheck → tests → build → deploy.

## What is broken, ranked by what it costs

### P1 — the verification you think you have does not run

**1. Five tests never execute in CI.** *Fixed in Phase 1 — CI now builds first; 0 skipped.* `tests/csp.test.ts`, `seo.test.ts` and
`not-found.test.ts` assert against `dist`. CI runs `npm test` *before* the build, so
`describe.skipIf(!built)` silently skips them. Measured by removing `dist` and
running the suite: **396 passed, 5 skipped**. The CSP guard built last pass is
inert exactly where it matters, and a broken build would deploy green.

**2. Nothing ever mounts a component.** *Fixed in Phase 1 — 29 render tests.* Every test is either pure logic or a
source-text assertion. A `useToast` outside its provider, a hook-order violation, a
crash on first paint of a tool — none would be caught. I proved the gap by writing
a throwaway harness: **19 of 21 tool components mount cleanly in jsdom**, and the
two exceptions are the interesting part (below). This is the largest hole in the
project and it is cheap to close.

**3. `encrypt-office` renders into a crash if mounted.** *Fixed in Phase 1.* `ProtectOfficeTool` does
`getTool('encrypt-office')!` — a non-null assertion on a tool the registry *hides*
behind `VITE_ENABLE_OFFICE_ENCRYPTION`. Today the route never reaches it, so no user
is affected; but the moment the flag is flipped on a build that also changes the
registry, the failure is a blank page rather than an error.

### P2 — real but not urgent

**4. A bundle warning nobody reads.** *Fixed in Phase 1 — 0 warnings.* `src/lib/zip/encrypted.ts` is dynamically
imported *and* statically imported by `zip.ts`, so Rollup emits
`INEFFECTIVE_DYNAMIC_IMPORT` on every build. The heavy dependency (`@zip.js/zip.js`)
is still lazy — the warning is about a 297-line module being pulled into the zip
chunk. It costs a few kB and it costs something worse: a build that prints a
warning is a build people stop reading.

**5. ~20 dead CSS classes.** *Fixed in Phase 1 — 17 removed after re-checking each.* `skeleton`, `page-narrow`, `stack--lg`, `stack--sm`,
`stats-strip`, `stat__value`, `badge--soon`, `btn--danger`, `kv__value--wrap`,
`text-accent`, `text-danger` are declared and never referenced (the dynamic ones —
`notice--${tone}`, `outcome__value--${tone}` — are fine). Small bytes, but they are
the kind of thing that makes the next reader wonder what uses them.

**6. 81 kB of `og.png` and a duplicated engine graph.** pdf-lib and zip.js are each
emitted twice (worker + main-thread fallback). No visitor downloads both, so this is
artifact size, not page weight — but it is unexplained weight in a repo that
measures everything else.

**7. High-contrast and forced-colors are unhandled.** 14 `backdrop-filter` uses, 18
`color-mix`, and no `forced-colors` or `prefers-contrast` block. On Windows High
Contrast Mode the glassy surfaces collapse; text usually survives because it is
real text, but borders and focus rings can disappear.

### P3 — worth doing when the tool passes their way

**8. `encrypt-office` has no SEO meta entry** (all other 20 do). Invisible today
because the tool is flag-hidden; wrong the day it ships.
**9. No in-page navigation on tool pages, no recent tools, no `/` in the docs.**
Phase 4 of the earlier UX audit, still unstarted.
**10. The README's tool table predates the last three passes** (no target-size
compression, no checksum verification, no CSP).
**11. `docs/` is 13 files with overlapping scope** and no index.

---

## The plan

Five phases, ordered so that later phases are verified by earlier ones. Each phase
ships on its own, with its own measurement, and leaves the build green.

### Phase 1 — Make the verification real *(done — see the log below)*

The point is not more tests; it is that the tests we have actually run, and that a
component render is something the project can check at all.

1. **Reorder CI**: build before test, so `dist` exists and the 5 skipped assertions
   execute. Add `npm run verify` (`tsc && build && test && test:dom`) so a local
   run matches CI exactly.
2. **A DOM test project** (jsdom, dev-only, second vitest config) that mounts:
   every tool component, every page, the palette, the header, the footer and the
   error boundary. Asserts each renders non-trivial output and logs nothing to
   `console.error` (React logs a warning for almost every real mistake, from
   key mismatches to invalid DOM nesting).
3. **Fix what the harness finds.** `encrypt-office`'s non-null assertion, and a
   `ResizeObserver` shim for Crop (jsdom has none; that is a harness gap, stated).
4. **Kill the bundle warning** by moving `inspectZipEncryption` and the encryption
   labels into a small dependency-free `src/lib/zip/inspect.ts`, which `zip.ts`
   imports statically; `encrypted.ts` then stays genuinely dynamic.
5. **Delete the dead CSS** listed above, after confirming each is unreferenced.

Exit criteria: `npm run verify` green; 0 build warnings; every tool mounted by a
test; the CSP assertions running in CI.

#### Phases 1 result — measured before and after

| | before | after |
|---|---|---|
| `npm test` before a build | 396 passed, **5 skipped** | 402 passed, **0 skipped** |
| Tests that mount a component | 0 | **29** (21 tools, 5 routes, 1 noindex, 2 error-boundary) |
| Build warnings | 1 (`INEFFECTIVE_DYNAMIC_IMPORT`) | **0** |
| CSS classes with no reference in `src/` | 23 found, 17 genuinely dead | **0 dead** (6 remaining are dynamic templates or `.w3.org`/`.woff2` false positives) |
| CI test order | test → build | **build → test → test:dom** |
| Extraction-path chunk (`zip`) | 8 812 B / 3 525 B gz | **5 326 B / 2 339 B gz** |

What the numbers mean, briefly:

- The five skipped assertions were the CSP meta tag, the sitemap, robots.txt and
  two SEO checks — i.e. exactly the tests that guard the security headers and the
  crawl policy. They were skipping in *CI*, not locally, because CI ran `npm test`
  before `npm run build` and they need an emitted `dist`. The workflow now builds
  first, and the build step itself type-checks, so nothing was lost by dropping the
  separate `tsc` step.
- The DOM project is a second vitest config (`vitest.dom.config.ts`, jsdom,
  dev-only dependency) so the Node suite stays free of DOM stubs and cannot start
  passing because a jsdom stub behaved. It caught one real defect immediately:
  `ProtectOfficeTool` read `getTool('encrypt-office')!` for a tool the registry
  deliberately hides, so it would have thrown the moment anything mounted it. It
  now reads `getToolAny`, which returns the definition regardless of the flag,
  while routing and the catalogue still use `getTool`.
- The bundle warning was accurate, not cosmetic: because `zip.ts` statically
  imported `encrypted.ts`, Rollup merged the encryption module into the shared
  extraction chunk, so every extraction downloaded it whether or not a password was
  involved. Splitting the pure central-directory code into `src/lib/zip/inspect.ts`
  took the encryption module out of the shared extraction chunk, which fell from
  8.8 kB to 5.3 kB raw (3.5 kB → 2.3 kB gzip); `encrypted.ts` (4.1 kB) now loads
  only when someone types a password. `zip.js` itself (~162 kB) was and remains
  lazy — it was never in the extraction path, whatever the warning looked like it
  was saying.
- A negative control was run before trusting the DOM suite: throwing inside
  `MergePdfTool` fails its test with that error, so the suite is not vacuously green.

### Phase 2 — Accessibility beyond the two easy wins *(done — see the log below)*

- `forced-colors` and `prefers-contrast: more` blocks: real borders instead of
  translucent ones, focus rings that survive, no reliance on `backdrop-filter` for
  legibility.
- A keyboard path through the interactive crop frame (arrow keys, 1 px / 10 px with
  Shift) — the one tool that is currently mouse-only.
- Extract ZIP: selection + cancellation once `readZip()` accepts an `AbortSignal`.
- Re-check every tool's controls at 320 px width and with 200 % text zoom.

#### Phase 2 result

The two theme modes are now defined rather than left to the browser:

* `forced-colors: active` (Windows High Contrast). The theme draws structure with
  translucency — a 9 % hairline, a 2 px box-shadow ring, a gradient that separates
  a button from the page — and forced colours throws all three away while forcing
  every colour to a system value. The new block states what survives: real
  `1px solid CanvasText` borders on every bordered surface, gradients and blur
  switched off, and focus drawn as `3px solid Highlight` because the default
  `box-shadow` ring does not exist in that mode. That last one was the actual bug:
  a High Contrast keyboard user had no focus indicator at all.
* `prefers-contrast: more`. Kept as a token change in `tokens.css` (both themes),
  plus structural rules in `a11y.css`: heavier rules, opaque surfaces with no
  backdrop blur, secondary text raised toward full strength.

**Crop is no longer mouse-only.** The frame takes focus and answers arrows (1 px,
10 px with Shift) and Alt+arrows for resizing, with `aria-roledescription`,
instructions via `aria-describedby`, and the readout as a polite live region. One
side effect worth naming: the drag geometry assumed a locked ratio meant "shrink
to the smaller axis", so dragging a corner sideways on a 1:1 selection did nothing
at all. With the geometry extracted to `src/lib/image/crop.ts` and 15 tests over it,
both input paths now follow the pointer and clamp together.

**Extract ZIP gained selection and a cancel that is real.** The honest version of
this needed an architecture change, not a button: on the main thread `fflate.unzip`
is one synchronous call, so an abort could only arrive *after* the work it was
supposed to stop, and the button would have been theatre. Extraction now runs in
the existing ZIP worker — the same guards, the same budgets, the same file — which
also means a 300 MB archive no longer freezes the tab. Entries come back as
transferred buffers, so the bytes are handed over rather than copied. Per-entry
checkboxes build a ZIP of just the selection; the aside action names the count.

**320 px / 200 % zoom:** a static pass, not a visual one. Every fixed width in the
stylesheet was checked against a 288 px content box (320 minus page padding), the
two remaining offenders got a `max-width: 400px` block (the entry list's column
set, and the crop tool's 2×2 number grid), and the 13 `white-space: nowrap` uses
all sit on ellipsised or short-label text. **This still needs a person at 320 px
with text zoomed to 200 %** — that check cannot be done by reading CSS, and it is
the one item in this phase I am not calling verified.

Measured: **434 unit tests / 34 files** (was 402) and **29 render tests**; build
green, 0 warnings, CSP intact on all 30 documents. New coverage: 15 crop-geometry
tests, 11 stylesheet tests in `tests/a11y.test.ts` (forced-colours focus ring,
borders, contrast tokens staying in the token layer), 5 extraction tests over the
worker path including transfer and cancel, 2 extraction-guard tests, and the
render suite mounting all 21 tools again.

### Phase 3 — The remaining product gaps in the tools *(done — see the log below)*

- Images → PDF per-image page fit; Rotate PDF page subsets; Unlock Office
  pre-flight probe (the pattern already exists for PDF).
- Create ZIP "store vs deflate".
- These are the "Open" rows in `docs/tool-audit.md`, which is where the reasoning
  and the reasons for waiting live.

#### Phase 3 result

Four gaps, and two of them turned out to want a *different* control than the one the
audit sketched:

* **Rotate PDF: page subsets.** The range field is Split PDF's, parsed by the same
  `parsePageRanges`, so `2-4, 6` means the same thing in both tools. Validation is
  live and inline, the action stays available, and the worker turns only the listed
  indices. Seven tests read the angle back out of the produced document rather than
  trusting the operation's return value.
* **Images → PDF: `A4 · match`.** The audit suggested per-row state in the manifest.
  That would be 40 decisions on a 40-image document to answer a question one control
  answers, and the complaint was never about individual photos — it was about
  landscape photos sitting in portrait bands. A third page-size option turns each
  sheet to follow its image. Five tests assert the produced page dimensions for
  portrait, landscape, square and both A4 modes.
* **Create ZIP: store vs deflate**, not a 1–9 level dial. A dial asks the user to
  guess a number with no visible consequence; store-vs-deflate is a decision with a
  stated cost. It applies to encrypted archives too. Five tests, including one that
  proves a stored archive still round-trips.
* **Unlock Office: pre-flight probe, deliberately shallower than the PDF one.** It
  answers from eight bytes — package, CFB container, legacy 97–2003, or junk — and
  does *not* report Agile vs Standard: telling those apart needs the
  `EncryptionInfo` stream, which means reading a file the user has not asked to
  process yet. The distinction people actually hit is "this .docx is not encrypted
  at all, so no password will help", and that one is free. Four tests.

The SEO copy had to move with the tools: `rotate-pdf` said "rotation is per
document, not per page" and its FAQ told people to split, rotate and merge. That
text is prerendered and indexed, so it is part of the product, not a comment.

Measured: **455 unit tests / 36 files** (was 434), 29 render tests, build green,
0 warnings, CSP on 30 documents, 704 links, 28 sitemap urls.

### Phase 4 — Weight *(done — see the log below)*

- Decide the duplicated engine graph with a measurement, not an opinion:
  `manualChunks` shared between the worker and the main graph, or accept it and
  document the number.
- Revisit tool prose in the entry chunk (11.2 kB gz) — the constraint is that the
  prose must stay in the prerendered HTML for the pages to be worth indexing, and
  `connect-src 'none'` rules out fetching it. That combination is why it stays.

#### Phase 4 result — a measurement, then a decision

`scripts/weigh.mjs` (`npm run weigh`) walks the emitted module graph from each
prerendered document the way a browser would: `<script>` plus `modulepreload`,
static imports followed transitively, dynamic imports and worker files counted
separately because they arrive at different times. It runs in CI, and it fails if
one visit could reach both copies of a duplicated engine.

The numbers it produced:

| | gzip |
|---|---|
| First load, identical on every route | **118.4 kB** (one chunk, `index`) |
| Cheapest tool after first paint (URL encoder) | **2.3 kB** |
| Typical archive tool (create ZIP, extract ZIP) | **+76 kB** |
| Image tools (resize, convert, compress) | **+88 kB** |
| Office unlock | **+21 kB** |
| PDF tools | **+250 kB**, dominated by pdf-lib |
| Split PDF (worst case, keeps page thumbnails) | **+322 kB** |

Duplicated engines, per chunk: pdf-lib **2 × ~240 kB**, zip.js **2 × ~66 kB**,
office-crypto **2 × ~13 kB**. Two facts make that acceptable rather than alarming:

1. **The copies are alternatives, not a sum.** `client.ts` reaches the worker via
   `new Worker(new URL(...))` and reaches the main-thread engine via
   `await import('./ops')` *inside the failure branch*. A visitor downloads one or
   the other; the weigh script takes the larger of the two for that reason. The
   script's duplicate check asserts this stays true.
2. **`manualChunks` cannot fix it.** The worker is a separate Rollup pass with its
   own module graph; there is no supported way to share a chunk between the worker
   bundle and the main bundle. The only way to delete the second copy is to delete
   the fallback — which would mean every PDF tool fails outright in a browser that
   blocks module workers, in exchange for saving artifact bytes that no visitor
   pays. Not a trade worth making.

Two smaller decisions from the same numbers. **Tool prose stays in the entry
chunk**: stripping all 280 prose literals (27.8 kB raw) out of the emitted entry
chunk and re-gzipping it takes the chunk from 121.3 kB to 111.1 kB, i.e. the prose
costs **10.2 kB gzip** of first load. It stays because it is needed to hydrate the
prose that is already in the prerendered HTML, `connect-src 'none'` rules out
fetching it, and splitting it into a lazy chunk would put it behind a request on
exactly the pages where it matters, with a hydration mismatch in between. And **`og.png` stays at 81 kB**: it
was recompressed at zlib level 9 as a test — 0.8 % saving, so the file is already
near-optimal for PNG; a JPEG would be smaller but needs an encoder this repository
does not have and would smudge the flat colours that make the card readable at
small sizes. It is fetched by social crawlers, never by a visitor.

`pdf.worker` contains fflate (243 kB chunk, marker string present). That is not a
leak: `@cantoo/pdf-lib` lists fflate as a dependency of its own.

The duplicate check is a gate, not a report, so it was tested against a failure:
copying a shared chunk and adding one dynamic import to a tool chunk made the
script name the route ("both reachable from /tools/url-encoder/") and exit 1. In
the real build the only byte-identical pair is `zip-reader`, at 0.1 kB, and no
route reaches both copies.

### Phase 5 — Phase 4 of the UX audit, and docs *(done — see the log below)*

- Recent tools, palette "see all", in-page anchors on tool pages.
- `docs/README.md` as an index; refresh the README tool table.

#### Phase 5 result — four small surfaces and one cost

**Recent tools.** Four slugs in `localStorage`, shown as a chip row in the command
palette when the query is empty. Three decisions are worth recording:

- *Palette only, not the homepage.* The homepage and catalogue are prerendered, so
  a client-only list there is either a hydration mismatch or a layout shift on the
  busiest screen of the site. The palette is already the primary navigation, it is
  rendered on demand, and it rereads storage each time it opens — so a tool visited
  in another tab is there.
- *Slugs and nothing else.* No filenames, no counts, no timestamps. The record
  (`src/lib/recent/recentTools.ts`) is deliberately too small to be a privacy
  problem: even fully exposed it says only which of twenty public pages someone
  opened.
- *Everything degrades.* Read-only storage, a value another version wrote, a file
  that is not JSON, a slug that outlives its tool: each falls back to an empty
  list, tested in `tests/recent-tools.test.ts` (14 cases). A `Clear` control sits
  in the row itself rather than three menus away.

Recents are excluded from the list underneath the chips instead of repeating in
it: two rows for one tool would mean two arrow-key stops for one page.

**Palette "see all".** When more than eight entries match, the palette ends with
`See all N matches in the catalogue`, linking to `/tools/?q=…`. The catalogue
reads the parameter, and *writes* it back with `replace` as you type — so a
filtered catalogue can be shared or reloaded, the back button is not filled with
one entry per keystroke, and reopening the page does not resurrect a query the
visitor already cleared. The terminal arrow switched to a router-relative `to`,
because the neighbouring `<a href>` builds the deploy prefix by hand and `Link`
would have doubled it.

**In-page anchors.** Tool pages get `#what-this-tool-does`,
`#what-it-will-not-do` and `#common-questions`, with a row of plain text links
(not a segmented control — the sections are prose, not views) and
`scroll-margin-top` so a jump clears the sticky header. This is the one item in
this turn that also came up in an external design checklist; the rest of that
checklist is reviewed in [`design-checklist-review.md`](design-checklist-review.md).

**Docs.** `docs/README.md` is now an index of the eleven documents, and the README
tool table gained the flag-gated Office protection row it was missing, plus the
`npm run weigh` script and a pointer to the docs.

**Cost, measured against `HEAD` before this phase** (both builds run in this
sandbox, `gzip -9`):

| | before | after | delta |
| --- | --- | --- | --- |
| Entry chunk | 385 874 B / **121.1 kB** gz | 388 884 B / **122.2 kB** gz | **+1.1 kB** gz |
| CSS | 70 213 B / **13.35 kB** gz | 71 433 B / **13.52 kB** gz | **+0.17 kB** gz |

1.26 kB gzip of first load for two navigation features and one anchor row, on a
site whose entry chunk is dominated by the framework and the tool prose. No route
gained a request.

**Tests.** 469 unit tests / 37 files (was 455/36) and 44 render tests / 3 files
(was 29/2). The new render tests were checked against deliberately broken code —
removing the recents exclusion and dropping the catalogue's `?q=` read both fail —
so they are not describing themselves.

---

## Why this order

Phase 1 first because a project with 401 tests that skip the important five, and
zero component renders, cannot honestly claim the rest. Phase 2 before Phase 3
because accessibility regressions are cheaper to fix in CSS than in components that
will be rewritten anyway. Phase 4 last because everything in it is a trade-off that
needs the earlier phases' numbers to argue with.
