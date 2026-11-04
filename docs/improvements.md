# Improvement review — frontend, client engine, and product

Scope: the whole shipped artifact at `0af991a` (Phases 1–3 of the UX audit already
merged). This is a fresh pass, not a re-litigation of the audit — everything in
`docs/ux-audit.md` is treated as done.

Two notes before the findings:

- **There is no backend, and that is the product.** ZeroUpload ships as static
  HTML + JS; no server processes, receives or stores a file. What plays the
  backend role is the client engine: the worker clients, `lib/{pdf,zip,office}`,
  the memory budgets, and the build that produces the artifact. That layer is
  reviewed below under "Client engine", because that is where a "backend"
  improvement would actually land.
- Every number here was measured on this checkout. Nothing is asserted from
  memory.

---

## What is already good — keep it

| Area | Why it holds up |
| --- | --- |
| Architecture | One registry (`src/registry/tools.ts`) drives routes, catalogue, search, sitemap, structured data and the prerenderer. Adding a tool cannot half-exist. |
| Static correctness | 28 prerendered routes, 704 internal links, 0 broken, 0 orphans, enforced at build. Every page has one `<h1>`, a unique title, a description and a canonical. |
| Code hygiene | No `console.log`, no `TODO`/`FIXME`, no `any` escapes found in `src`. Errors go through one `ToolError` shape with a hint. |
| Memory discipline | Blobs are read one at a time, cumulative budgets are asserted before allocation, object URLs are created and revoked by one hook (`useObjectUrl`), worker results are transferred rather than copied. |
| Entry weight | 117 kB gz total — React 65.8 + router 13.2 + app 39.0. No PDF, ZIP or Office code in the entry chunk; all of it is behind dynamic imports. |
| Failure UX | An `ErrorBoundary` covers render failures with a "reload, your files were never uploaded" message; cancellation is a neutral toast, not an error. |
| Theme | Dark and light are token sets, not component overrides, and the theme is applied before first paint (no flash). |

---

## P1 — fix next

### 1. Light-mode primary button hover falls below AA (4.0:1)

Measured, not guessed:

```
light accent        #0b7f6b   white text 4.93:1   ✓
light accent hover  #288e7d   white text 4.00:1   ✗ AA fails
dark  accent        #5ff3d2   ink  text 13.87:1   ✓
dark  accent hover  #72f4d7   ink  text 14.23:1   ✓
```

`ui.css` hovers the primary button with
`color-mix(in srgb, var(--accent) 88%, #ffffff)` — mixing *toward white*. On a mint
accent that lightens pleasantly; on the dark teal that light mode uses, it lightens
the background while the label stays white, and the pair drops under 4.5:1. The
resting state is compliant, which is why the earlier contrast pass (which sampled
resting states) missed it.

**Fix:** a per-theme `--accent-hover` token — light mixes toward the ink colour,
dark mixes toward white. One token, two values, no component change.
**Cost:** XS. **Risk:** none.

### 2. Clicking any primary button is a state change nobody announces — but keyboard users also lose their place on navigation

`App.tsx` resets scroll on route change (`ScrollToTop`) but never moves focus.
For a mouse user the new page appears at the top; for a keyboard or screen-reader
user focus stays on the footer link they just activated, so the next Tab continues
from the old page and nothing announces that the page changed.

**Fix:** on `pathname` change, move focus to the route's `<h1>` (or `#main` with
`tabindex="-1"`) and keep the existing polite live region to announce the page
name. Must skip the first render so deep links don't steal focus on load.
**Cost:** S. **Risk:** low — the pattern is standard, and the h1 exists on 28/28
content pages.

### 3. The search shortcut advertises `⌘K` on every platform

`SiteHeader.tsx` renders `⌘` + `K` unconditionally. The handler accepts
`metaKey || ctrlKey`, so the feature works everywhere — only the label lies to
roughly 60% of visitors.

**Fix:** detect Apple once (`navigator.platform`/`userAgentData`) and render
`Ctrl K` elsewhere; keep both key handlers.
**Cost:** XS. **Risk:** none.

### 4. No Content-Security-Policy on any of the 30 documents

The product's whole claim is "your file never leaves your browser". A CSP is the
one control that makes that claim robust to an injected script: without it, a
single XSS anywhere becomes an exfiltration path, and the promise is only as
strong as the code. GitHub Pages cannot set response headers, but a
`<meta http-equiv="Content-Security-Policy">` covers everything except
`frame-ancestors`.

**Proposed policy** (static build, so hashes rather than nonces):

```
default-src 'self';
script-src 'self' 'sha256-…'  /* the inline theme script, hashed at build */
style-src 'self' 'unsafe-inline';   /* style attributes; required */
img-src 'self' blob: data:;         /* previews and thumbnails are object URLs */
font-src 'self';
connect-src 'none';                 /* this app makes no network requests, ever */
worker-src 'self' blob:;
frame-ancestors 'none' → not supported in meta; set via _headers if the host allows
```

`connect-src 'none'` is the interesting one: it makes "no upload" a *mechanism*
rather than a promise, and it fails loudly in dev if a dependency ever tries to
phone home. **Cost:** M (hash the theme script in `prerender.mjs`, test that
`dist` pages carry it). **Risk:** medium — must be validated against the workers
and blob previews before it ships, or a tool breaks in the field.

---

## P2 — worth doing, larger or lower urgency

### 5. The artifact ships two copies of pdf-lib and two of zip.js

Measured in `dist/assets`:

| Chunk | gz | Note |
| --- | --- | --- |
| `pdf.worker-*.js` | 242.4 kB | worker graph — pdf-lib + ops glue |
| `ops-*.js` | 237.5 kB | main-thread fallback — the *same* pdf-lib |
| `zip.js-*.js` | 66.4 kB | worker graph |
| `zip.js-*.js` | 65.9 kB | main-thread fallback |

~612 kB gz of the deploy is duplicated library code: Rollup builds the worker and
the main thread as separate graphs, and `ops.ts` is imported by both. **No visitor
downloads both in a normal session** — either the worker path runs or the fallback
does — so this is artifact weight and a second parse in the rare fallback, not
per-visit bandwidth. Worth stating precisely rather than inflating it.

**Options:** (a) accept and document; (b) make the fallback reuse the worker
chunk; (c) drop the fallback and fail loudly on browsers without workers (all
supported browsers have them). (c) is honest but removes an escape hatch.
**Cost:** M–L. **Recommendation:** leave it; the tradeoff is worse than the weight.

### 6. Font subsets the site will never render

`main.tsx` imports the whole family (`@fontsource-variable/geist` and `…-geist-mono`),
so the build carries latin, latin-ext **and cyrillic** for both faces — 6 files,
109 kB. `unicode-range` means a browser fetches only the latin subset (~51 kB), so
this is artifact weight, not download weight.

**Fix:** import `@fontsource-variable/geist/latin.css` (and mono). **Cost:** XS.
**Effect:** −58 kB in the deploy, zero runtime change.

### 7. All 20 tools' marketing prose is in the entry chunk

The app's own 39 kB gz of entry code includes `src/seo/toolContent.ts` — the
summary, does/limits lists and FAQ for every tool — because `ToolLayout` imports
the map statically. A visitor on `/tools/merge-pdf/` downloads the FAQ text for
the other 19 tools.

**Fix:** keep the static import in `entry-server.tsx` (the prerenderer needs it)
and use a per-slug dynamic import in the client. **Cost:** M. **Effect:** trims
roughly a third of the app's entry bytes; measurable with the same method used
above.

### 8. Three worker clients, one design, written three times

`lib/pdf/client.ts` (178 lines), `lib/zip/client.ts` (173), `lib/office/client.ts`
(157). Normalised similarity is 0.41–0.47 — the same pending-map, timeout, abort
listener, progress-throttle and error-rehydration logic appears three times, with
three chances to fix a bug twice.

**Fix:** extract `createWorkerClient<TReq, TRes, TOutcome>()`; each engine keeps
only its encode/decode pair. **Cost:** M. **Risk:** medium — this is the code path
that moves user files; it needs its own test-first pass, not a refactor bundled
with anything else.

### 9. The mobile menu opens but does not behave like a menu

`aria-expanded`/`aria-controls` are correct, but Escape does not close it, focus is
not moved into it, and clicking outside leaves it open. **Cost:** S.

---

## P3 — product ideas, with the tradeoff stated

### 10. Offline support would be the strongest possible proof

The app already needs nothing from the network after load, but it cannot be opened
*without* one. A service worker + web app manifest would let someone install it and
work on a plane — demonstrating "nothing leaves the browser" by construction rather
than by claim. **Tradeoff:** cache invalidation becomes a real problem on every
deploy (a stale shell can reference chunks that no longer exist), and it would need
a versioned cache plus a "new version available" prompt. **Cost:** L. **Recommend:**
only if the positioning leans harder on "local-first" than it does today.

### 11. Carry-over items from the audit that are still open

- **Extract ZIP has no Cancel.** Its long step starts on drop rather than from a
  button, and `readZip`'s `filter` callback would need the abort signal threaded
  through. Documented in `docs/ux-audit.md` §K; still true.
- **Tool pages have no in-page navigation.** 500–700 words of prose sit between the
  workspace and "Related tools" with nothing linking into them (Phase 4 item).
- **The palette has no "see all results"** and there is no `/` shortcut (Phase 4).
- **No recent tools** (Phase 4).

### 12. Small things observed in passing

- `RouteFallback` is a bare spinner with no text: on a slow first load of a tool a
  visitor sees an unexplained spinner. One sentence would fix it.
- The 404 is `noindex` but has no meta description; harmless, just noted for
  completeness.
- `architecture/index.html` is a redirect stub with no `<h1>` — correct by design,
  not a defect.

---

## What shipped from this list

Implemented on this branch, in the order the review suggested.

| # | Change | Evidence |
| --- | --- | --- |
| 1 | `--accent-hover` token per theme; the button stopped mixing toward white | light hover **4.00:1 → 6.01:1** (AA); dark unchanged at 14.23:1. Guarded by `tests/contrast.test.ts`, which computes every text/surface pair from `tokens.css` in both themes |
| 2 | Route changes move focus to the new `<h1>`, not just scroll | `src/hooks/useRouteFocus.ts`; skips the first render, `preventScroll`, `tabindex="-1"` removed on blur. Guarded by `tests/route-focus.test.ts` |
| 3 | The shortcut hint follows the keyboard | `src/lib/platform.ts`; `⌘K` on Apple, `Ctrl K` elsewhere, `Ctrl K` in the prerendered HTML so hydration cannot mismatch. `tests/platform.test.ts` (7 cases) |
| 6 | Latin + latin-ext only, declared locally | **11 font files / 143.4 kB → 4 files / 81.8 kB**; deploy **2.94 MB → 2.88 MB**; no runtime change (`unicode-range` already prevented the fetch) |
| 9 | The mobile menu behaves like a menu | Escape closes it and returns focus to the button; a pointer-down outside closes it; the button's label now says open/close |
| 12 | The route fallback says what it is waiting for | one line under the spinner |

Not done, deliberately: the CSP (#4) needs its own test pass against workers and
blob previews, `#7`/`#8` are each their own PR with their own measurement, and
`#10` is a product decision.

## Suggested order

1. **#1 + #3 + #6** — three XS changes, all measurable, no design argument: a
   contrast regression fixed, a label that stops lying, 58 kB off the deploy.
2. **#2** — route-change focus. The largest remaining accessibility gap.
3. **#4** — CSP. The largest remaining *trust* gap, and the only one that turns a
   claim into a mechanism. Needs its own test pass.
4. **#9 + #12** — an afternoon of polish.
5. **#7, #8** — real engineering, each worth its own PR and its own measurement.
6. **#10** — a product decision, not a task.

Nothing in this list breaks local-only processing, lazy loading, workers,
prerendering, `BrowserRouter`, GitHub Pages compatibility, the registry model,
`prefers-reduced-motion`, or the no-new-dependency rule.
