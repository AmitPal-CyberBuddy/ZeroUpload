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

### Phase 2 — Accessibility beyond the two easy wins

- `forced-colors` and `prefers-contrast: more` blocks: real borders instead of
  translucent ones, focus rings that survive, no reliance on `backdrop-filter` for
  legibility.
- A keyboard path through the interactive crop frame (arrow keys, 1 px / 10 px with
  Shift) — the one tool that is currently mouse-only.
- Extract ZIP: selection + cancellation once `readZip()` accepts an `AbortSignal`.
- Re-check every tool's controls at 320 px width and with 200 % text zoom.

### Phase 3 — The remaining product gaps in the tools

- Images → PDF per-image page fit; Rotate PDF page subsets; Unlock Office
  pre-flight probe (the pattern already exists for PDF).
- Create ZIP "store vs deflate".
- These are the "Open" rows in `docs/tool-audit.md`, which is where the reasoning
  and the reasons for waiting live.

### Phase 4 — Weight

- Decide the duplicated engine graph with a measurement, not an opinion:
  `manualChunks` shared between the worker and the main graph, or accept it and
  document the number.
- Revisit tool prose in the entry chunk (11.2 kB gz) — the constraint is that the
  prose must stay in the prerendered HTML for the pages to be worth indexing, and
  `connect-src 'none'` rules out fetching it. That combination is why it stays.

### Phase 5 — Phase 4 of the UX audit, and docs

- Recent tools, palette "see all", in-page anchors on tool pages.
- `docs/README.md` as an index; refresh the README tool table.

---

## Why this order

Phase 1 first because a project with 401 tests that skip the important five, and
zero component renders, cannot honestly claim the rest. Phase 2 before Phase 3
because accessibility regressions are cheaper to fix in CSS than in components that
will be rewritten anyway. Phase 4 last because everything in it is a trade-off that
needs the earlier phases' numbers to argue with.
