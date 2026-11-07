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

---

# Second pass — correctness under a keyboard, a slow network and a thumb

The first pass measured states (hover, resting). This one measured *sequences*:
what happens across a navigation, between the click and the paint, on a touch
screen, and on the home screen. Four of the five findings are bugs, not taste.

## P1

### 1. The focus ring was 1.38:1 in light mode and 2.32:1 in dark

`--focus-ring` composed `--accent-line`, which is a **32%-opacity** accent meant for
hairline borders. Composited over the page:

| | ring | vs background | needs |
| --- | --- | --- | --- |
| dark | `rgba(95,243,210,.32)` over `#08090b` → `#24544b` | **2.32:1** | 3:1 |
| light | `rgba(14,159,133,.30)` over `#f5f6f8` → `#b0dcd6` | **1.38:1** | 3:1 |

WCAG 2.2 SC 1.4.11 wants 3:1 for a focus indicator, and this is the only signal
telling a keyboard user where they are. It now has its own solid token:
`#5ff3d2` dark (**14.4:1**) and `#0b7f6b` light (**4.93:1**). The decorative line
token is untouched — it is still right for borders.

### 2. Back navigation always landed at the top of the page

The app scrolled to `y=0` on every pathname change. Correct for a new page, wrong
for the one you just left: scroll the catalogue 2 000 px, open a tool, press Back,
and you are at the top of a list you had already navigated. Positions are now kept
per **history entry** (`location.key`) in `sessionStorage`, restored only on `POP`,
capped at 30 entries, and the whole thing is tolerant of a corrupt stored value.

## P2

### 3. Every tool click paid for its chunk with a spinner

All 20 tools are lazy routes, so a click meant: request the chunk → wait → read
"Opening workspace…". The import functions are now kept in `TOOL_LOADERS` and the
`lazy()` components derived from them, which makes the loader itself reachable, so
a card can warm its chunk on **pointer-enter, focus or touch-down**, and the
command palette warms whatever arrow keys have highlighted. Save-Data and 2G/3G
are respected — a cursor crossing a card is not consent to 240 kB of pdf-lib.

### 4. `:hover` moved things on touch screens

A tap sets `:hover` and leaves it set until something else is tapped, so the card
you just visited stayed 2 px off the grid — sticky hover, invisible on a laptop and
obvious on a phone. Every hover rule that *moves* something is now inside
`@media (hover: hover)`; colour feedback stays for everyone, and the cards gained a
real `:active` state. Four rules were affected: both card lifts, the brand mark's
tilt, the file-drop ring's tilt, and the range thumb's scale.

### 5. The home-screen icon was a squashed social card

`apple-touch-icon` pointed at `og.png` — 1200×630. iOS letterboxes that, so every
shortcut was a distorted Open Graph image. There is now a real 180×180 touch icon,
192/512 manifest icons (one maskable), and a manifest — which also finally makes
"add to home screen" open the workspace rather than nothing. The icons are drawn by
`scripts/make-icons.mjs` (4× supersampled, box-filtered, indexed PNG so a flat mark
costs 16.5 kB rather than 40.7 kB).

## Still open

- **CSP** — unchanged, still the largest trust gap, still needs its own pass.
- **Duplicate engine graphs in the artifact** (~612 kB gz) — no visitor downloads
  both; leave it.
- **Tool prose in the entry chunk**, **three near-identical worker clients** — each
  its own PR with its own measurement.
- **Offline/service worker** — a product decision.
- Phase 4 of the UX audit (recent tools, `/` shortcut, palette "see all", in-page
  anchors) — still unstarted, still awaiting approval.

## Verification

`tsc -b` clean · **363 tests / 28 files** · build green, 28 pages, 704 links, 0
warnings · entry 117.9 kB gz, CSS 12.4 kB gz · deploy 2.95 MB.

New guards, all of which fail against the old code: `tests/contrast.test.ts` (now
composites translucent tokens and checks the focus ring at 3:1), `tests/hover.test.ts`
(parses the stylesheets, tracks the at-rule stack, and refuses an unguarded moving
`:hover`), `tests/navigation.test.ts` (one scroll owner, per-entry restore, loaders
derived from one map), `tests/assets.test.ts` (manifest icons exist and match their
declared sizes).

---

# Third pass — the output is visible before you commit to it

Everything up to here was about the shell: contrast, focus, navigation, icons. This
pass is about the tools themselves, and about the one claim the product makes that
was still only asserted rather than enforced.

## 1. A tool told you nothing until you ran it

The pattern was the same in all twenty tools: set the options, press the button,
find out. Move a quality slider from 90 to 40 and the file might halve or double —
you learned which only after the encode. Ask "extract pages 1-3, 7" and whether that
is one document or four was a question for the results panel.

That is the same shape as uploading to a server and waiting for a link. Removing the
upload removes the wait, but not the guesswork — unless the output is knowable before
it exists.

**The panel.** One shared `Outcome` sits above every run button and answers "what
comes out?" while the user is still deciding:

| Tool | What it now says, live |
| --- | --- |
| Compress | `1920 × 1080 → 1280 × 720` · `WebP · quality 78` · **`412 KB · 61% smaller`** |
| Convert | `PNG · 2.4 MB` → `WebP · quality 82` · **`612 KB · 75% smaller`** |
| Resize | `4032 × 3024 → 1280 × 960` · `32% · 90% fewer pixels` · **`184 KB`** |
| Crop | `Selection 1600 × 900` · `Kept 18% · 82% discarded` (warns under 15%) · **`96 KB`** |
| Rotate | `Geometry 90° clockwise · mirrored horizontally` · `1080 × 1920px` · **`2.1 MB`** |
| Split PDF | `Pages 7 of 24` · `Files 1 PDF` / `Files 12 PDFs · one ZIP` |
| Merge PDF | `Documents 4` · `Input 12.4 MB` · `Output 1 merged PDF` |
| Images → PDF | `Pages 6` · `Page size A4 · 595 × 842 pt` · `Margin 24 pt` |
| Rotate PDF | `Pages 12` · `Applied 90°` · `Content unchanged · not re-compressed` |
| Create ZIP | `Contents 12 files · 41 MB` · `Output photos.zip` · `Compression Deflate · AES-256` · **`Name clashes 2 files share a name`** |
| Extract ZIP | `Entries 14 of 60` · `Expanded 88 MB` · `Compression 3.4× smaller packed` |
| Favicon | `Source 1024 × 1024px` · `Renders 7 sizes + .ico` · `Also writes site.webmanifest · HTML snippet` |

*Bold* values are measured, not modelled.

**How an image size is known before the run.** `useOutputEstimate` encodes the
output for real, with the current options, in the same worker the run uses. The
number in the panel is the number the run produces — no table of averages, no
extrapolation from a proxy. Three things keep that affordable:

- **400 ms debounce** — a slider dragged 90 → 20 fires ~70 changes; only the last
  one is worth encoding.
- **supersession** — every pass carries a token, and a pass that finishes after a
  newer one started throws its result away.
- **a 24 MP budget** — above that the panel stops measuring on its own and offers a
  *Measure output size* button, because encoding a 50-megapixel photo on every
  slider tick would turn a helpful preview into a hot fan.

A preview is disabled while a real run is in flight, so it can never compete with
the work the user actually asked for, and a preview that fails is silence rather
than a red box — the run owns error reporting.

Announcement is `aria-live="polite"` on the **values only**: putting it on the panel
would re-read the title and icon on every tick.

## 2. `connect-src 'none'` — the claim is now a mechanism

"Nothing is uploaded" was a promise in the copy and an absence of `fetch` calls in
the source. Both are true and neither is enforcement. Every one of the 30 generated
documents now carries a Content-Security-Policy whose first line makes exfiltration
impossible rather than merely unlikely:

```
default-src 'self'; script-src 'self' 'sha256-…' 'sha256-…';
worker-src 'self' blob:; style-src 'self' 'unsafe-inline';
img-src 'self' blob: data:; connect-src 'none'; object-src 'none';
base-uri 'self'; form-action 'none'; frame-src 'none'
```

- **`connect-src 'none'`** blocks fetch, XHR, WebSocket, EventSource and `ping`. An
  injected script would have nowhere to send a file.
- **`script-src`** allows only this build's bundles, plus one sha256 per inline
  script. The pre-paint theme bootstrap is the only inline script, and its hash is
  computed per document at build time (`scripts/csp.mjs`), so it cannot go stale.
- **`worker-src 'self' blob:`** keeps the three engines working; `blob:` covers the
  fallback path that can construct a worker from an object URL.
- **`img-src blob: data:`** covers object-URL previews and the favicon tool's
  rendered icons.

Two limitations are stated rather than hidden: `style-src` needs `'unsafe-inline'`
because React writes `style` attributes (inline *styles* cannot execute script, so
this is a formatting concession, not a hole), and `frame-ancestors` is impossible in
a `<meta>` policy — clickjacking framing would need a real header, which GitHub
Pages cannot set.

Placement was the subtle part: a `<meta>` policy only governs content *after* it, so
the tag sits immediately after `<meta charset>` rather than at the end of `<head>`,
where it would look decorative and enforce nothing. That is pinned by a test.

## 3. `/` opens the palette

The command palette accepted ⌘K / Ctrl K from anywhere but did nothing when a hand
was already on the home row. `/` now opens it too — except inside an input,
textarea, select or contenteditable, where a slash is a slash.

## Verification

`tsc -b` clean · **387 tests / 31 files** · build green, 28 pages, 704 links, 0
warnings · entry 118.1 kB gz.

New guards: `tests/csp.test.ts` (policy on all 30 documents, hashes match the inline
scripts byte for byte, policy precedes the first script, no `eval`/`new Function` in
any bundle, idempotent on rebuild), `tests/outcome.test.ts` (all thirteen tools carry
the panel; the image tools measure rather than guess; the hook debounces, supersedes
and refuses oversized sources).

## What is still open, and why

- **Duplicate engine graphs in the artifact** (~612 kB gz: pdf-lib and zip.js each
  emitted twice). No visitor downloads both — the worker path or the fallback runs,
  never both — so this is artifact weight, not page weight. The fixes available
  (manual chunking across a worker boundary) are worse than the redundancy.
- **Tool prose in the entry chunk.** `TOOL_CONTENT` is imported statically by
  `ToolLayout`, so all twenty tools' FAQ text ships with the first page. Splitting it
  per tool would also remove it from the prerendered HTML, and those pages exist *for*
  the prose. SEO and payload pull in opposite directions here; the payload is 39 kB gz.
- **Three near-identical worker clients.** Unifying them is a real refactor with a
  real risk score and deserves its own PR and its own before/after measurement.
- **Offline support.** A service worker would make "works on your device" stronger
  still, and would add cache-invalidation complexity to every deploy. A product
  decision, not a task.
- **Recent tools** and **in-page anchors** on tool pages — the remainder of the UX
  audit's Phase 4.
