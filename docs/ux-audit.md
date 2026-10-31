# ZeroUpload — product-level UI/UX audit

**Date:** 31 October 2026
**Scope:** homepage, catalogue, five group pages, all 20 tool pages, workspace states, search, navigation, both themes, mobile, accessibility, microcopy.
**Method:** read the implementation, not screenshots — `src/pages/*`, `src/components/**`, `src/tools/**`, the eight stylesheets (4 400 lines), plus the built HTML in `dist/`. Contrast values below were computed from the tokens in `src/styles/tokens.css`, not estimated.
**Status:** findings only. Nothing in this document has been implemented.

---

## 0. Positioning: what the product is now

### 0.1 What a visitor meets today

| Layer | Current text | What it communicates |
| --- | --- | --- |
| `<h1>` | `ZeroUpload` (wordmark; `HomePage.tsx:58`) | the brand name, and nothing else |
| Tagline | “Convert. Compress. Transform. Locally.” | three verbs out of five groups |
| Lede | “A private workspace for the files you would rather not hand to a stranger…” | voice, not function |
| Eyebrow | “Local-first file toolkit” | the category, in jargon |
| Header nav | *Tools* · *How it works* | — |

The product now spans image work, PDF work (including password **protection** and **unlock**), archives with AES-256, Office document unlock, file inspection with hashing, and developer text utilities. **The tagline describes roughly 40 % of that.** The two most distinctive, highest-intent capabilities — protecting and unlocking documents — are not in it at all.

That is not a taste problem. The homepage's own headline is the wordmark, so the *only* sentence a scanner reads that names the work is a three-verb list that predates half the product.

### 0.2 What the core value proposition actually is

Three candidates, tested against what the app does:

1. **“A file utility suite”** — true, but loses the differentiator, and every competitor claims it.
2. **“A privacy-first file toolkit”** — true, but “privacy-first” is the most exhausted phrase in software; it asserts rather than demonstrates.
3. **“A local file workspace”** — this is what the UI *literally* is: one intake zone on the homepage that hands a file to one of 20 tools, each with the same workspace shape, none of which has an upload step.

The honest formulation is a combination of 1 and 3, with local processing as the *evidence* rather than the slogan:

> **A file toolkit where the work happens on your device — because there is no server to send a file to.**

That sentence is checkable (open DevTools, watch the network panel), which is what makes it different from every “100 % private” claim on the internet.

### 0.3 Does “locally” still deserve to be the strongest differentiator?

**Yes — but as a demonstrated fact, not an adjective.** The audit found the privacy claim repeated **five times before the fold** (see §8), which is the classic symptom of a differentiator that is being *asserted* rather than *shown*. The strongest evidence the product already has is the thing nobody else does: the drop zone opens a file and the file inspector describes it without a single network request. That is the demo. The words are secondary.

### 0.4 Five positioning directions (tradeoffs)

| # | Direction | Example | Strength | Weakness |
| --- | --- | --- | --- | --- |
| A | **Utility-first, breadth** | “Every file tool you need. Nothing leaves your browser.” | Names breadth *and* differentiator; ages well because it has no count | Slightly long for a headline; needs a short sub-line |
| B | **Privacy-first, plain** | “File tools that never upload anything.” | Memorable, checkable, differentiating | Reads as narrower than the product is |
| C | **Local workspace** | “Your files. Your device. Twenty tools.” | Matches the actual UI metaphor | The count rots (see P0-1); “workspace” is our word, not theirs |
| D | **Minimal / poster** | “Files in. Nothing out.” | Distinctive, ownable, works at any size | Too cryptic as the only sentence; needs the tagline beneath it |
| E | **Technical / developer** | “Twenty utilities that run in the tab.” | Credible to the audience that cares | Buries the protection/Office tools; narrows the audience |

### 0.5 Tagline verdict: **B — refine, do not replace the identity**

Rationale, in order of weight:

- The differentiator is still correct; the *verb list* is what aged. Keep the second half, rewrite the first.
- A count in the headline has already rotted once: the homepage currently says “**Seven categories**” and there are five (P0-1 below). Any headline containing a number will rot the same way.
- The `<h1>` should carry the proposition, not the wordmark. The brand is already in the header, the footer, the favicon and the tab title.

**Recommended:**

```
H1        Every file tool you need. Nothing leaves your browser.
Eyebrow   Local-first file toolkit          (keep — it is a category label)
Sub       Convert, compress, protect, unlock and inspect — in the tab you already have open.
```

**Runner-up**, if a shorter lockup is wanted for social/lockup use: **“Files in. Nothing out.”** as the poster line, with the recommended H1 as the load-bearing sentence.

**Do not** ship a headline that contains a tool count, or a superlative (“100 % private”, “military-grade”, “guaranteed”).

---

## A. Executive assessment

### What genuinely works — KEEP

1. **The workspace metaphor is real and consistent.** Drop → configure → process → result → download happens in the same place in 17 of 20 tools. That is rare, and it is the product's strongest structural asset.
2. **Honest result reporting.** `CompareSizes` shows the delta *including when the file grew* (“+12 % larger than the original”). Almost nobody ships this. Keep it and protect it.
3. **Stage visibility instead of a spinner.** `StageTimeline` (Reading → Encrypting → Complete) tells the user which phase a local operation is in. Keep.
4. **The token system is small and disciplined** — 132 lines, no ad-hoc colours in components, light theme defined as tokens rather than overrides. Keep the architecture.
5. **`prefers-reduced-motion` is handled at the root** (`base.css:263`) plus a targeted fix so the indeterminate bar does not vanish (`ui.css:605`). That second part is a detail most teams never notice. Keep.
6. **Copy in the tool bodies is unusually good.** The Office unlocker explains why it takes half a second; the ZIP tool explains the Explorer incompatibility *before* writing. Keep that voice exactly as it is.
7. **Contrast is mostly sound.** Measured: dark `text-muted` on `surface-2` **4.97:1**, light `text-muted` on `bg` **4.88:1**, dark accent **14.45:1**, light accent **4.56:1** — all pass AA for normal text. The one weak spot is *size*, not colour (§E).

### What is outdated

1. **The homepage headline** (see §0) — the identity no longer describes the product.
2. **“Seven categories. One workspace.”** (`HomePage.tsx:171`) — stale since the five-group remap. This is the single most visible defect on the site: it contradicts the five cards rendered directly beneath it.
3. **The catalogue still feels like a filter UI.** The chips were converted to links (correct), but they are styled identically to the old filter buttons and sit next to an instant-filter input, so they still *read* as filters.
4. **Three card styles for one job** — `tool-card`, `feature-card`, `category-card` all mean “open a tool or a group”, with three different visual weights and three different hover behaviours.

### What is inconsistent

1. **JSON Formatter claims a file input it does not have.** `seo/pages.ts:168` says “Paste it or open a file”; `seo/toolContent.ts` says “Accepts pasted text or a file, up to 25 MB.” The component has no `FileDrop` and no file handling. This is a factual error on an indexed page — the one thing the SEO work was built to prevent.
2. **Cancellation exists in 5 of 20 tools** (image batch tools only). PDF, ZIP and Office operations show progress with no way out.
3. **Dual primary actions on some tool pages** — `ProtectPdfTool` renders “Protect now” in the workspace *and* “Protect PDF” in the settings footer, both enabled, both doing the same thing.
4. **Verb drift**: “Protect PDF” / “Protect now”, “Process another” / “Re-run”, “Choose file” / “Drop a file here” / “Drop a PDF to protect”.
5. **Three dev tools (JSON, URL, Hash) have no drop zone** while the other 17 do, so “every tool opens a file” is false in a way a user discovers by clicking.

### What is genuinely strong

The privacy model is the only claim in this product category that can be **verified by the user in ten seconds**. Everything in the UI should be arranged to make that verification easy and quiet — which is currently not the case (§8).

### Should not be changed

- Tool registry architecture, lazy chunks, worker boundaries.
- The copy inside tool bodies (limit statements, compatibility warnings).
- The result/delta panel.
- The dark palette and the mark.
- The prerender/SEO layer.

---

## B. Priority matrix

### P0 — broken or harmful

| # | Finding | Evidence | Why P0 |
| --- | --- | --- | --- |
| **P0-1** | Homepage says “Seven categories” above five category cards | `HomePage.tsx:171`, `categories.ts` | Immediate credibility damage; contradicts the page it heads |
| **P0-2** | JSON Formatter advertises a file input it does not implement | `seo/pages.ts:168`, `seo/toolContent.ts`, `JsonFormatterTool.tsx` (no `FileDrop`) | False claim on an indexed page; exactly the failure mode the SEO rules forbid |
| **P0-3** | Command palette is `aria-modal` with **no focus trap and no focus restore** | `CommandPalette.tsx:105-112` | Keyboard and screen-reader users can tab out of a modal into the page behind it |
| **P0-4** | Tool options render **below** the workspace on mobile | `ToolLayout.tsx:64-70` order + `workspace.css:234` (`position: static` ≤980px) | On a phone the settings appear after the file card and the primary button; users act before seeing the options, or conclude there are none |

### P1 — major experience improvement

| # | Finding |
| --- | --- |
| **P1-1** | Homepage `<h1>` is the brand name; the proposition lives in a tagline that omits protect/unlock/inspect (§0) |
| **P1-2** | Privacy claim repeated 5× above the fold (§8) — dilutes the strongest signal |
| **P1-3** | Catalogue chips still read as filters; empty search has no recovery path |
| **P1-4** | Search: substring-only matching, no typo tolerance, no fuzzy fallback, no “no results” suggestions (`CommandPalette.tsx:37-49`) |
| **P1-5** | No cancellation on PDF / ZIP / Office operations (5 of 20 tools have it) |
| **P1-6** | Errors are not announced — `Notice` has no `role="alert"`, and results are not announced either |
| **P1-7** | Dual primary CTAs on several tool pages |
| **P1-8** | Light mode is a token swap with four component overrides; three hardcoded white overlays are invisible or wrong in light (`pages.css:472`, `ui.css:62-63`, `tools.css:276`) |
| **P1-9** | No sticky primary action on mobile; long tool pages bury the button |

### P2 — polish

| # | Finding |
| --- | --- |
| P2-1 | Mono/uppercase density: labels, badges, buttons at 10.5–11.5 px; `text-muted` used for real body copy in cards |
| P2-2 | Three card languages for one action; consolidate to two |
| P2-3 | Hero entry animation runs 700–800 ms with up to 260 ms delay; last line appears ~1 s after paint |
| P2-4 | Decorative motion in four places (620 px rotating ring, pulsing eyebrow dot, pulsing footer dot, stagger on every list) |
| P2-5 | `FileDrop` is a `div role="button"` wrapping a hidden input; a native `<label>` would be simpler and better announced |
| P2-6 | 404 exists in two designs: the prerendered `dist/404.html` (standalone, dark-only) and the in-app `NotFoundPage` |
| P2-7 | Tool pages: 500–700 words of SEO prose sit between the workspace and “Related tools” with no in-page navigation |
| P2-8 | Category page `<h1>`s are sentences while tool `<h1>`s are nouns — inconsistent rhetorical level |

### P3 — optional

| # | Finding |
| --- | --- |
| P3-1 | “Twenty tools” in `seo/pages.ts` is correct only while `VITE_ENABLE_OFFICE_ENCRYPTION` is off |
| P3-2 | No recently-used tools |
| P3-3 | No `/` shortcut for search |
| P3-4 | Palette results cap at 8 with no “see all in catalogue” affordance |
| P3-5 | No homepage FAQ (deliberately — see §C) |

---

## C. Homepage recommendation

### Current structure (measured)

`hero` (eyebrow · wordmark H1 · tagline · lede · 3 trust marks · intake zone with formats) → `signal-bar` (0 / 20 / 0 / 0) → `categories` → `featured` (“The everyday four”) → `explain` (3 steps) → `cta-band`.

### Recommended structure

| # | Section | Change |
| --- | --- | --- |
| 1 | Hero | **Change H1** to the proposition; wordmark shrinks to a lockup above it. Keep the intake zone — it is the demo, not decoration. |
| 2 | Intake zone | **Keep.** It is the product in one component. |
| 3 | Signal bar | **Remove.** It repeats the hero's three trust marks with different nouns (“0 bytes uploaded / 0 accounts / 0 installs” vs “No upload / No cloud / No account”). |
| 4 | Categories | **Keep**, fix the heading to be count-agnostic (“Five ways in.” → or derive from `CATEGORIES.length`). Four of the five cards currently carry a description written for search, not for scanning — tighten to one line. |
| 5 | Featured | **Keep** but rename (“Start here” eyebrow + “The everyday four” h2 is two labels for one thing). |
| 6 | Explain | **Keep.** It is the only place the mechanism is explained calmly. |
| 7 | CTA band | **Keep**, shorten to one line. |
| — | FAQ / file-type table / logo wall / testimonial | **Do not add.** None of them answer “is this useful to me and where do I go?” |

### Hero recommendation

- **H1:** “Every file tool you need. Nothing leaves your browser.”
- **Eyebrow:** keep “Local-first file toolkit” — it is a category label, not a claim.
- **Lede:** one sentence, keep the voice, drop the repetition of “private” (the H1 already says it).
- **Trust row:** reduce from three items to **one line**, e.g. `No upload · no account · no install`. Three separately iconed claims next to a headline that already says “nothing leaves your browser” is the same fact three times.
- **Intake zone:** keep. It is the only above-the-fold element that is *product* rather than *promise*.

### CTA recommendation

One primary action: **“Browse the tools”** → `/tools/`. The current page offers “Browse all tools”, “Open tool”, “How it works”, “Open the toolkit” — four destinations competing at the same visual weight across one scroll.

### Remove / add / simplify

- **Remove:** signal bar; duplicate trust marks; the second CTA label for the same destination.
- **Add:** nothing. The page is already the right length.
- **Simplify:** card copy to one line; heading set to two rhetorical levels (brand → proposition → section).

---

## D. Search recommendation

### Current behaviour

`CommandPalette` builds a flat index of 20 tools + 2 static entries, then scores: exact name 100, `startsWith` 80, `includes` 60, all query words present in `name + blurb + tags + keywords` 40, else 0. Results cap at 8, ties fall back to registry order. The catalogue has a *separate* substring filter with different semantics (`ToolsPage.tsx:20-32`).

### Verified behaviour against the requested queries

| Query | Result today | Verdict |
| --- | --- | --- |
| `image compressor` | Image Compressor (80) | ok |
| `compress image` | Image Compressor (40 via keywords) | ok |
| `reduce JPG size` | Image Compressor (40 — “reduce size” + “optimize jpg”) | **works by luck**; the synonym list carries it |
| `resize image` | Image Resizer (40) | ok |
| `PDF password` | Protect PDF, Unlock PDF (40) | ok |
| `unlock PDF` | Unlock PDF (80) | ok |
| `ZIP` | Create ZIP, Extract ZIP | ok |
| `hash file` | Hash Generator (40); File Inspector does **not** surface | **weak** — the file-hashing tool is the inspector |
| `compresor` (typo) | **no results, no suggestion** | **fails** |
| `make my photo smaller` | **no results** | **fails** |

### Shortcomings

1. No fuzzy/typo tolerance — one wrong letter returns an empty list.
2. No intent layer beyond the hand-written `keywords`; anything phrased as a task rather than a feature fails.
3. Two different search models (palette vs catalogue filter) give two different answers to the same query.
4. Empty state is a dead end: “No tool matches “x”.” with no nearest results and no way to browse.
5. Results show name + category but no description, so the user cannot tell two similar results apart.
6. Typing “PDF” ranks by registry order, so Protect PDF (the highest-value tool in the group) appears behind Merge.

### Desired behaviour

- **One scorer, used by both surfaces.** Pure function in `src/lib/search/`, unit-tested, no DOM.
- **Ranking:** exact name > name prefix > name substring > keyword/alias hit > tag hit > description hit; then a small boost for tools in a group whose name matches; stable tiebreak by registry weight.
- **Fuzzy fallback:** if strict matching yields nothing, allow subsequence matching (`cmp`) and a single-edit tolerance for queries ≤ 6 characters. Never let fuzzy results outrank exact ones.
- **Synonyms:** keep `keywords`/`aliases` in the registry as the single source of intent phrases, and add the task-shaped ones the audit tried (`make image smaller`, `shrink photo`, `remove pdf password`, `password protect`, `unzip file`, `checksum file`).
- **Empty state:** show the three nearest tools by partial score, plus “Browse all tools”.
- **Result rows:** name + one-line blurb + group. Two-line rows are worth the height; they are what disambiguates Merge from Split.

### Desktop / mobile

- **Desktop:** palette stays the fast path; add `/` as an alternative trigger (without stealing `/` from text inputs).
- **Mobile:** the palette should be a **full-height sheet**, not a 560 px dialog floating in a blurred backdrop — on a phone the current layout puts results under the on-screen keyboard.
- **Catalogue:** the filter input should call the same scorer and announce the result count via `aria-live="polite"`.

### Visible field vs palette

**Both, with different jobs:** the palette is the shortcut for people who know what they want; the catalogue field is the visible, discoverable entry point for people who don't. That is the current split — the problem is only that they disagree.

---

## E. Visual system recommendation

### Typography

- **KEEP** the families (Geist / Geist Mono), the scale, and the display/body split.
- **CHANGE** the mono density. Counted across `ui.css` + `pages.css`: uppercase-mono at 10.5–11.5 px appears in labels, badges, chips, card CTAs, section eyebrows, footer headings and the settings header. On a 390 px viewport that is the *majority* of secondary text. It reads as “developer tool” — which is on-brand — but at 11 px with 0.1 em tracking it is measurably harder to read than the same text at 12–13 px in the sans face.
  - **Rule to adopt:** mono is for *values* (sizes, hashes, formats, counts, shortcuts). Labels and headings go back to sans. Minimum size for any mono string that is a sentence: 12 px.
- **CHANGE** `text-muted` usage: `tool-card p`, `feature-card p` and `.settings` hints set real explanatory copy in `text-muted`. Muted is for metadata; descriptions should be `text-secondary` (8.83:1 on dark bg).
- **KEEP** tabular numerals where they exist (`numeric` class) — size deltas align.

### Colour

- **KEEP** the palette. Dark graphite + electric mint is distinctive, the mint is not over-applied (it is used for one accent per view), and the violet stays secondary.
- **KEEP** both themes as token sets rather than component overrides.
- **CHANGE** semantic usage: `--warn` doubles as “notice” and “error-adjacent warning”, and `--danger` is used for both “could not open” and “encryption failed”, which are different severities. The palette has enough tokens; the copy carries the severity, which is acceptable — but the *same* amber panel is used for “permissions are advisory” (informational) and “nothing would change” (blocking). Informational notices should not use the warning surface.
- Contrast measured and passing (see §A.7). The tightest value is light-mode accent **4.56:1** on `--bg`; if it is ever used for body-size text on `--surface-3` it will drop below AA. Constrain accent text to `--surface`/`--bg`.

### Spacing

- **KEEP** the 4 px scale and `--page-max: 1180px`. Nothing in the audit suggests the rhythm is wrong.
- **CHANGE** one thing: tool pages carry `--s-10` top padding *plus* a breadcrumb *plus* a 38 px icon *plus* a 2.3 rem `<h1>` *plus* a status badge *plus* a description *plus* a badge row before the drop zone. On mobile that is the entire first viewport spent on the header (§G).

### Cards

- **CHANGE** — consolidate three card languages into two:
  - **Tool card** (catalogue, related, group pages): one treatment, one hover (border + 2 px lift; `surface-2` background change can go — it does nothing visible in light mode).
  - **Group card** (homepage categories): keeps the count and the verb.
- **REMOVE** `feature-card`: it is a tool card with a gradient overlay, a tag row and an extra CTA line. The homepage can use the tool card with the same hover.
- Verdict on the current look: **not overly glassmorphic** (one blurred backdrop, on the palette only), **not template-y** — the bordered, near-flat surfaces are appropriate. The one decorative element that leans template is the `linear-gradient(180deg, rgba(255,255,255,0.03), transparent)` overlay on cards, which is invisible in light mode and pointless in dark.

### Icons

- **KEEP** the custom geometric set (34 icons, 1.5 px stroke, single path language). It is coherent and the metaphors are legible (`compress`, `expand`, `shield`, `inspect`, `hash`).
- **CHANGE** two mappings: `grid` is used for *Related tools*, *All tools* and *category* — three different meanings; and `refresh` covers convert / rotate / re-run. Both should be differentiated or their usage narrowed.

### Borders, shadows, surfaces

- **KEEP** the restraint: one border colour, one shadow scale, one blurred surface (palette). The UI is flatter than its competitors, which suits a utility.
- **CHANGE** the two hardcoded `rgba(255,255,255,…)` overlays (`ui.css:62-63` button inset highlight, `tools.css:276` crop grid) to token-driven values so light mode stops inheriting dark-mode-only shading.

### The “0” motif

**Verdict: currently slightly overused in one place and underused in another.**

| Use | Status |
| --- | --- |
| Logo mark, favicon, wordmark | **KEEP** — the strongest use |
| 404 | **KEEP** |
| Drop-zone ring made of the mark's arcs | **KEEP** — it is the motif doing functional work |
| Hero ambient 620 px ring, rotating continuously | **CHANGE** — decorative, and the only element with a 26 s infinite animation; it also costs a large blurred paint on every frame on low-end phones |
| Signal bar “0” numerals | **Remove with the section** |
| Processing indicator | **WEAK** — `ZeroMark active` spins, but the *progress* state uses a generic bar |

The motif is best when it *is* the interface: intake ring, 404, completion. It is worst when it is wallpaper.

---

## F. Tool UX recommendation

### The lifecycle, as implemented

```
Drop / choose  →  options in Settings sidebar  →  primary button  →  StageTimeline
                                                                  →  ResultPanel (delta, download, re-run, process another)
```

That model is sound and 17 of 20 tools follow it. The deviations are what need fixing.

### Consistency matrix

| Tool | Drop zone | Options | Primary action | Progress | Cancel | Result | Reset |
| --- | --- | --- | --- | --- | --- | --- | --- |
| image-converter | ✓ | ✓ | ✓ | stage | ✓ | ✓ | ✓ |
| favicon | ✓ | ✓ | ✓ | progress | ✓ | custom | ✓ |
| image-compressor | ✓ | ✓ | ✓ | batch | ✓ | batch | ✓ |
| resize | ✓ | ✓ | ✓ | stage | ✓ | ✓ | ✓ |
| crop | ✓ | ✓ | ✓ | stage | ✗ | ✓ | ✓ |
| rotate | ✓ | ✓ | ✓ | stage | ✓ | ✓ | ✓ |
| merge-pdf | ✓ | ✓ | ✓ | progress | **✗** | documents | ✓ |
| split-pdf | ✓ | ✓ | ✓ | progress | **✗** | documents | ✓ |
| rotate-pdf | ✓ | ✓ | ✓ | stage | **✗** | ✓ | ✓ |
| images-to-pdf | ✓ | ✓ | ✓ | progress | **✗** | documents | ✓ |
| protect-pdf | ✓ | ✓ | **two** | stage | **✗** | ✓ | ✓ |
| unlock-pdf | ✓ | ✓ | ✓ | stage | **✗** | ✓ | ✓ |
| create-zip | ✓ | ✓ | ✓ | progress | **✗** | custom | ✓ |
| extract-zip | ✓ | ✓ | ✓ | progress | **✗** | manifest | ✓ |
| unlock-office | ✓ | ✓ | ✓ | progress | **✗** | ✓ | ✓ |
| file-inspector | ✓ | **none** | ✓ (inspect) | — | — | key/value | ✓ |
| json-formatter | **✗** | ✓ | ✓ | — | — | text | ✓ |
| base64 | ✓ | ✓ | ✓ | — | — | text | ✓ |
| url-encoder | **✗** | ✓ | ✓ | — | — | text | ✓ |
| hash-generator | **✗** | ✓ | instant | — | — | text | ✓ |

### Components to standardise

1. **One primary action location.** Choose: the Settings footer *or* an inline button, never both. Recommendation: keep the Settings footer for desktop (it is next to the options), and render **the same button** as a sticky bar on mobile.
2. **A `CancelButton`** rendered whenever an operation is cancellable. The worker protocol already supports `signal`; three PDF tools pass nothing. Add it to PDF, ZIP and Office.
3. **A `ResultPanel` variant for multi-file outputs** (merge, split, images→PDF, extract currently each render their own list). One component, one download affordance.
4. **`FileDrop` as a native label.** Replace `div role="button"` + hidden input with `<label>` + input, keeping drag handlers. Keyboard, screen readers and mobile pickers all improve for free.
5. **An `ErrorNotice`** = `Notice tone="danger" role="alert"` with the three-part shape already used in copy (“what happened / why / what now”). Today the copy is right and the semantics are missing.
6. **A `StartOverButton`** with one label, used everywhere. “Process another”, “Clear”, and “Re-run” currently mean three different things across tools.

### Do not force uniformity

- `file-inspector` has no output file — its result is a reading, not a download. That difference is correct.
- The three text tools legitimately have no drop zone; the fix is to stop implying they do (see §I), not to add a file input to a JSON formatter for symmetry.
- Batch image tools have a batch panel that single-file PDF tools must not inherit.

---

## G. Mobile recommendation

Not “make it responsive” — it already is. Specific defects:

1. **Options render after the workspace.** `ToolLayout` puts `<aside>` after the main column; at ≤980 px `workspace.css:234` makes it static, so it lands *below* the file card and the inline primary button. **Fix:** source-order the settings first on narrow screens (`grid-template-areas` or `order`), and pair it with the sticky action bar.
2. **No sticky primary action.** On a 667 px-tall viewport the tool header (icon + h1 + badge + description + badge row) plus a file card means the action is frequently off-screen. **Fix:** a bottom bar with the primary action and the current file name, shown only when a file is loaded.
3. **Palette is a floating dialog.** On phones it should be a full-height sheet that survives the keyboard.
4. **Heading block is too tall on tool pages.** Consider hiding the description paragraph behind the existing “How it works” link, or reducing `--s-10` to `--s-6` below 720 px.
5. **Touch targets:** buttons are 40 px (good); the palette rows are ~36 px (borderline); the theme and search icon buttons are 34 px at ≤860 px (**below the 44 px recommendation**) — `layout.css:181-190`.
6. **Catalogue chips scroll horizontally** (`overflow-x: auto`, hidden scrollbar). Functional, but there is no visual affordance that more exist; add a fade edge.
7. **Long tool names** (“Split & Extract Pages”, “Remove a Password from…”): verified they wrap rather than truncate, but the `<h1>` at `clamp(1.65rem, 4vw, 2.3rem)` plus the 38 px icon create a tall two-line block. Acceptable; do not truncate.
8. **Viewport height:** the palette uses `padding: clamp(1rem, 8vh, 6rem)` — on a short landscape phone that leaves almost no room for results. Use `dvh` and a sheet layout.

---

## H. Accessibility recommendation

### Verified working — KEEP

- Skip link to `#main`, focussing a real landmark (`App.tsx:32-53`).
- One `<h1>` per page; heading order is correct on tool, group and catalogue pages (verified in the built HTML).
- Global `:focus-visible` outline set on all interactive elements (`ui.css:9-17`).
- `Progress` exposes `role="progressbar"` with `aria-valuenow`; `Spinner` is `role="status"` with a visually hidden label.
- `StageTimeline` uses real list semantics.
- Reduced-motion handling at the root **and** a targeted fix for the indeterminate bar.
- Radios in a `fieldset` with a `legend` (Protect PDF) — arrow keys work natively.

### Defects

| # | Defect | Where | Fix |
| --- | --- | --- | --- |
| H1 | Palette has `aria-modal="true"` but no focus trap, no focus restore, and the page behind is not inert | `CommandPalette.tsx` | Trap Tab within the dialog; restore focus to the trigger on close; `inert` or `aria-hidden` the app root |
| H2 | Errors are visual only | `Notice` in tool pages | `role="alert"` on danger notices |
| H3 | A completed result is not announced | `ResultPanel` | `role="status" aria-live="polite"` on the result head |
| H4 | `FileDrop` is a `div role="button"` wrapping a hidden input | `FileDrop.tsx:125-146` | Use `<label>`; keep `aria-describedby` for the hint |
| H5 | Catalogue filter changes the list with no announcement | `ToolsPage.tsx` | Announce “N tools” via a polite live region |
| H6 | Icon buttons at 34 px on mobile | `layout.css:181` | 44 px hit area (can keep 34 px visual) |
| H7 | Palette option rows use `aria-selected` on `role="option"` (correct) but the active row is `data-active`, styled by attribute — no `tabindex` management, so screen-reader focus stays in the input (acceptable for a combobox pattern, but `aria-activedescendant` needs the list to have `aria-live` off) | palette | Confirm combobox pattern; add `aria-describedby` for the footer hints |
| H8 | Drag-and-drop is the only affordance on some hint copy (“Drag it, drop it, or pick it”) — the pick path exists but is not named in the drop zone's accessible name | homepage intake | Already covered by “Choose file”; ensure the label text is part of the accessible name |

**Not a problem:** colour is never the sole carrier of meaning — the size delta has text (“smaller” / “larger than the original”), statuses have words, not just dots.

---

## I. Copy / microcopy recommendation

### Vocabulary to adopt

| Action | Use | Stop using |
| --- | --- | --- |
| The tool's own verb | **Protect**, **Merge**, **Compress**, **Unlock**, **Inspect** | “Process”, “Run”, “Generate” as generic primaries |
| Getting a result | **Download** | “Save”, “Export” |
| Starting again with a new file | **Start over** | “Process another”, “Clear”, “Reset” (three words today) |
| Repeating the same operation | **Run again** | “Re-run”, “Protect now” |
| Choosing a file | **Choose a file** | “Browse”, “Select”, “Upload” (never “upload”) |

### Specific strings

| Location | Current | Problem | Recommendation |
| --- | --- | --- | --- |
| Homepage | “Seven categories. One workspace.” | Factually wrong | “Five groups. One workspace.” — or derive from `CATEGORIES.length` |
| Homepage | “No upload / No cloud processing / No account” + “Nothing is uploaded” + “0 bytes uploaded” + tagline “Locally.” + lede “private workspace” | Same claim five times before the fold | Keep **one** trust line + the demo |
| Homepage | “The everyday four.” | Adjective without information | “Start here” (already the eyebrow) — drop the h2 or name the jobs |
| Homepage | “Ready when your files are.” | Marketing cadence, no information | “Pick a tool. Your file never leaves the tab.” |
| Homepage | “Open the toolkit” / “Browse all tools” / “Open tool” | Three labels, one destination | One label |
| JSON Formatter | “Paste it or open a file” (meta) + “Accepts pasted text or a file” (page) | False | Remove the file claim |
| JSON / URL / Hash | No drop zone | Inconsistent with 17 tools, but legitimate | Say so in `limits`: “Text only — these three tools take input by paste.” |
| Protect PDF | “Protect now” + “Protect PDF” | Two primaries | One |
| Tool cards | “Open tool” on feature cards only | Actionable affordance only in one place | Either on every card or none |

### Principles

1. **One claim, once.** A fact repeated is a fact doubted.
2. **Numbers must be true and derived.** “Seven categories” rotted; `TOOLS.length` cannot.
3. **Say the limit where the limit matters.** The current tool bodies do this well; keep that and extend it to the text tools.
4. **Never say “upload” except in the negative.** The word is currently absent from the UI, which is correct; keep it that way.

---

## J. Implementation roadmap

### Phase 1 — high-impact UX fixes (P0 + P1)

1. Homepage heading + tagline; `<h1>` carries the proposition.
2. Fix “Seven categories” and remove the signal bar.
3. Fix the JSON Formatter file claim (meta, page content, limits note).
4. Palette accessibility: focus trap, focus restore, inert background.
5. Mobile: options before workspace, sticky primary action.
6. One primary action per tool page (resolve the duplicates).
7. `Cancel` on PDF/ZIP/Office.
8. `role="alert"` on errors; `aria-live` on results and catalogue counts.
9. One shared search scorer for palette + catalogue, with fuzzy fallback and an empty state that suggests.

*Ships as one coherent release; each item is independently mergeable.*

### Phase 2 — visual refinement

- Consolidate the three card languages to two.
- Typography pass: mono only for values; raise the mono floor to 12 px; move card descriptions to `text-secondary`.
- Light mode: token-ise the three hardcoded white overlays; audit `feature-card`, `.btn--primary` inset highlight, crop grid, palette scrim.
- Severity of Notices: informational vs blocking.
- Align the two 404 designs.

### Phase 3 — interaction and motion polish

- Cap entry animation at ~320 ms total; keep stagger only on the category grid.
- Decide the hero ring: static, or remove (not a 26 s loop).
- Micro-transitions for drop-zone accept, result appear, palette open.
- Uniform hover/focus behaviour across cards.

### Phase 4 — optional enhancements

- Recent tools (local, `localStorage`, no server).
- `/` shortcut; palette “see all results”.
- In-page anchor list for the long tool prose.
- Replace the hardcoded “Twenty tools” with a derived string.

---

## What this audit did **not** ask for

- No new dependencies (no icon library, no UI kit, no animation library).
- No analytics, no CDN fonts, no runtime services.
- No change to routing, prerendering, the tool registry, lazy chunks, workers, or the size budgets.
- No homepage FAQ, no testimonials, no logo wall, no “as seen in”.
- No more animation. Several findings are requests to remove animation.

## Verified-but-unchanged (so future passes do not re-litigate)

- Contrast: all body/secondary text meets AA in both themes (measured above).
- `<h1>`/heading order on all 28 prerendered pages.
- Reduced motion: global override + targeted indeterminate-bar fix.
- Link graph: 704 internal links, 0 broken, 0 orphans (enforced at build).
- Sitemap/canonicals/structured data: consistent and test-covered.
