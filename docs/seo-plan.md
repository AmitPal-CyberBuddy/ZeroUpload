# SEO and AI-search discoverability — audit and plan

**Status:** audit complete, implementation not started.
**Scope:** make every real ZeroUpload capability discoverable and understandable by search engines and AI search
systems, without changing the product's privacy model, performance profile or interaction model.
**Nothing in `src/` changes until this plan is approved.**

---

## 1. Routing and public pages, as they exist today

| Fact | Value |
| --- | --- |
| Router | `react-router-dom` 7, **`HashRouter`** (`src/App.tsx`) |
| Public routes | `/` (home), `/tools` (catalogue), `/tools/:slug` (20 tools), `/architecture` (how it works), `*` (404) |
| URL form | `https://site/#/tools/image-compressor` |
| Title | set client-side by `useDocumentTitle` after render |
| Meta description | one global description in `index.html`, identical on every page |
| Canonical | none |
| Open Graph | `og:title`, `og:description`, `og:type` only, global; **no `og:image`**, no Twitter card |
| Structured data | none |
| `robots.txt` | absent |
| `sitemap.xml` | absent |
| `public/404.html` | present, `noindex`, JavaScript-redirects path-style URLs to their hash equivalent |
| Build output | single `dist/index.html` + hashed assets, `base: './'` (relative) |
| Host | GitHub Pages (workflow exists; Pages is **not yet enabled** on the repo — API returns 404) |

### What a crawler actually gets today

1. `GET /` → 200, HTML with the homepage's *global* title and description, empty `<div id="root">`.
2. `GET /tools/image-compressor` → **404** (GitHub Pages serves `public/404.html`, status 404, `noindex`).
3. `GET /#/tools/image-compressor` → the fragment is never sent to the server. The server sees `/`, so the crawler
   receives the *homepage* — the fragment is the same document.
4. If a crawler does execute JavaScript, the hash routes render, but with no per-page canonical, description or
   structured data, and the URL it would index is a fragment.

**Conclusion: not one tool is currently a crawlable page.** The homepage is the only indexable URL, and it is
indexable only as "ZeroUpload", not as "image compressor" or "PDF password protector". This is the root cause, and
it is not fixable with meta tags — it is a routing and document-generation problem.

---

## 2. Real capabilities, audited against the requested list

The brief lists 22 capabilities. Only some exist. **Pages will be created only for capabilities that actually ship.**

| Requested capability | Exists? | Where |
| --- | --- | --- |
| Image Compressor | ✅ | `image-compressor` |
| Image Converter | ✅ | `image-converter` |
| Image Resizer | ✅ | `resize` |
| PDF Compressor | ❌ | not implemented — **no page** |
| PDF Merger | ✅ | `merge-pdf` |
| PDF Splitter | ✅ | `split-pdf` |
| PDF Password Protector | ✅ | `protect-pdf` (AES-256 R6) |
| PDF Unlocker | ✅ | `unlock-pdf` |
| PDF to Images | ❌ | not implemented — **no page** |
| PDF to Text | ❌ | not implemented — **no page** |
| ZIP Creator | ✅ | `create-zip` |
| AES-256 ZIP Encryption | ✅ | mode of `create-zip` — **section on that page, not a separate URL** |
| ZIP Extractor | ✅ | `extract-zip` (plain + AES + ZipCrypto) |
| Office Document Unlocker | ✅ | `unlock-office` (.docx/.xlsx/.pptx) |
| JSON Formatter | ✅ | `json-formatter` |
| JSON Minifier | ✅ | mode of `json-formatter` — **same page, no separate URL** |
| Base64 Encoder/Decoder | ✅ | `base64` |
| URL Encoder/Decoder | ✅ | `url-encoder` |
| Hash Generator | ✅ | `hash-generator` |
| File Inspector | ✅ | `file-inspector` |
| Privacy Audit | ❌ | not implemented — **no page** |
| Metadata / EXIF Cleaner | ❌ | not implemented — **no page** |

Additional real capabilities the brief did not list, all already shipped and worth indexing: favicon generator,
image crop, image rotate/flip, PDF rotate, images → PDF.

Gated and therefore **excluded from the index**: `encrypt-office` (Office password *creation*), which is hidden from
the registry unless `VITE_ENABLE_OFFICE_ENCRYPTION=1`. Indexing an experimental, unreachable-by-default tool would
misrepresent the product.

**Six requested capabilities do not exist.** They are product backlog, not SEO work. Building thin pages for them
would be exactly the failure mode the brief warns about.

**Indexable page count: 20 tool pages** (+ homepage, catalogue, and category pages, below).

---

## 3. SEO / intent matrix

One canonical page per intent cluster. Secondary intents are covered by *content on the same page*, never by a
second URL.

| Page (slug) | Primary intent | Secondary intents (content, not URLs) | Content angle that makes the page genuinely useful |
| --- | --- | --- | --- |
| `image-compressor` | image compressor | compress jpg, compress png, reduce image size, reduce photo file size, compress webp | Which formats, quality/downscale controls, honest "not every file shrinks" note, measured before/after |
| `image-converter` | image converter | jpg to png, png to webp, webp to jpg, avif converter, convert image format | Format matrix, transparency handling, quality control, browser format support limits |
| `resize` | image resizer | resize image online, change image dimensions, scale image | Locked aspect ratio, upscaling caveat, exact-pixel output |
| `crop` | crop image | image cropper, crop photo, aspect ratio crop | Freehand vs preset ratios, coordinates in source pixels |
| `rotate` | rotate image | flip image, mirror image, fix photo orientation | EXIF orientation, 90° steps, mirror axes |
| `favicon` | favicon generator | ico generator, apple touch icon, favicon package, site icon | Which sizes, manifest + snippet output, why SVG is refused |
| `merge-pdf` | merge pdf | combine pdf, join pdf files, pdf merger | Ordering, no rasterising (text stays selectable) |
| `split-pdf` | split pdf | extract pages from pdf, pdf splitter, delete pdf pages | Range syntax, per-page split limit, ZIP output |
| `rotate-pdf` | rotate pdf | fix sideways pdf, turn pdf pages | Metadata-only rotation, content untouched |
| `images-to-pdf` | images to pdf | jpg to pdf, png to pdf, photo to pdf | Page-per-image vs A4, order control, no re-encode |
| `protect-pdf` | pdf password protect | encrypt pdf, lock pdf, aes-256 pdf, restrict pdf printing | AES-256 R6, permission bits are advisory (stated plainly), no recovery |
| `unlock-pdf` | remove pdf password | unlock pdf, decrypt pdf, pdf password remover | Supported schemes, "password you know, not a cracker", output has no key material |
| `create-zip` | create zip | zip files online, compress files to zip, **encrypt zip (AES-256)**, password protect zip | Engine limits (500/64 MB encrypted), Explorer/Archive Utility incompatibility warning |
| `extract-zip` | unzip | extract zip, open zip, encrypted zip password | Bomb limits, name sanitising, AES + ZipCrypto support |
| `unlock-office` | remove word password | unlock excel, remove office password, decrypt docx | Which formats, why it takes ~0.5 s, reference-implementation verification |
| `file-inspector` | inspect file | check file type, file metadata viewer, sha256 checksum, pdf metadata | Magic-byte detection, extension spoofing, hashing limits |
| `json-formatter` | json formatter | json beautifier, json validator, **json minifier**, pretty print json | Error positions, sort keys, minify mode |
| `base64` | base64 encode | base64 decode, base64 to text, file to base64 | UTF-8 correctness, URL-safe alphabet, size limit |
| `url-encoder` | url encode | url decode, percent encoding, encodeuricomponent | Component vs full-URI, malformed sequence reporting |
| `hash-generator` | sha256 generator | sha512, sha1 checksum, hash text | Algorithms, why SHA-1 is legacy, not for password storage |

Coverage check against the brief's examples: "image compressor", "compress jpg online", "PDF password protect",
"remove password from PDF", "browser based file processing tool" (→ homepage) all map to a single page, with the
query language appearing naturally in the copy.

---

## 4. Duplicate and thin-page risks

| Risk | Mitigation |
| --- | --- |
| Hash URLs (`/#/tools/x`) vs path URLs (`/tools/x/`) | Path is canonical; hash URLs get a client-side redirect to the path, and `robots`/canonical never cite the hash form |
| Query variants (`/tools?c=pdf`) | Catalogue canonicalises to `/tools/`; category filtering becomes real category pages (below); no `?c=` URL is ever canonical or in the sitemap |
| Category pages duplicating the catalogue | Each category page gets its own editorial intro, tool list and "which one do I need" guidance; not a card dump |
| 20 boilerplate "About this tool" blocks | Content is written per tool: real formats, real limits, real caveats. A shared *shape* is fine; shared *sentences* are not |
| Mode-as-page temptation (JSON Minifier, AES-256 ZIP, Base64 decode, PDF extract pages) | One page per tool; modes get headings (`<h2 id="minify">`, `<h2 id="aes-256">`) that anchor-link and are described in content |
| Near-synonym pages (`/compress-jpg`, `/reduce-jpg-size`) | Explicitly not built. One page, natural synonyms in prose |
| Gated `encrypt-office` | Not generated, not linked, not in sitemap |
| `404.html` being indexable | Stays `noindex`; returns a real 404 status |

---

## 5. Proposed URL structure

Directory URLs, trailing slash, one canonical form:

```
/                                    homepage
/tools/                              catalogue
/tools/image-compressor/             ← 20 tool pages, existing slugs
/tools/pdf/                          ← 7 category pages (see §5.1)
/how-it-works/                       technical documentation (renamed from /architecture)
/404.html                            served with a 404 status by GitHub Pages
```

**Keep the existing slugs.** They are already descriptive and intent-aligned (`merge-pdf`, `protect-pdf`,
`create-zip`). Renaming to `pdf-merger`/`zip-creator` would buy nothing and require redirects GitHub Pages cannot
issue as 301s. `/architecture` → `/how-it-works/` is the one rename worth making (it is the label already used in
the nav); the old path gets a client-side redirect plus a canonical, because a 301 is impossible here.

Trailing slash is deliberate: GitHub Pages **301s** `/tools/x` → `/tools/x/`, so every internal link, canonical and
sitemap entry uses the trailing form to avoid a redirect hop on every crawl.

### 5.1 Category pages — open question

Today's taxonomy is internal (`convert`, `compress`, `transform`, `pdf`, `archive`, `inspect`, `dev`). A user
searching "image tools" expects `convert` + `compress` + `transform` together.

* **Option A (no product change):** generate the 7 existing categories at `/tools/convert/`, `/tools/compress/`,
  `/tools/transform/`, `/tools/pdf/`, `/tools/archive/`, `/tools/inspect/`, `/tools/developer/`.
* **Option B (small product change):** remap the catalogue to five user-facing groups — `image` (8 tools), `pdf`
  (5), `archive` (3), `inspect` (1), `developer` (3) — and generate `/tools/image/`, `/tools/pdf/`,
  `/tools/archive/`, `/tools/inspect/`, `/tools/developer/`. Fewer, stronger pages, and "image tools" becomes a
  real landing page.

Recommendation: **B**, because it produces fewer and better category pages and matches how people search. It changes
the category chips in the catalogue, so it needs a decision.

---

## 6. Sitemap

Generated at build time (never hand-maintained) from the same registry that generates the pages:

* Included: `/`, `/tools/`, 5–7 category pages, 20 tool pages, `/how-it-works/`.
* Excluded: hash URLs, `?c=` variants, `encrypt-office`, `404.html`, anything with `noindex`.
* Absolute URLs from one origin constant: `SITE_URL` (default `https://amitpal-cyberbuddy.github.io/ZeroUpload`,
  overridable for a custom domain).
* `lastmod`: only if truthful. Plan: use the build date for pages whose content is generated (or omit `lastmod`
  entirely, which Google explicitly tolerates). No fabricated per-page dates.
* `sitemap.xml` referenced from `robots.txt` and, optionally, `<link rel="sitemap">` on the homepage.

---

## 7. robots.txt

```
User-agent: *
Allow: /

# Search and answer engines: allowed deliberately.
User-agent: OAI-SearchBot
Allow: /

User-agent: ChatGPT-User
Allow: /

User-agent: Googlebot
Allow: /

User-agent: Bingbot
Allow: /

User-agent: DuckDuckBot
Allow: /

User-agent: PerplexityBot
Allow: /

Sitemap: https://<origin>/sitemap.xml
```

Decisions that need to be made rather than assumed:

| Crawler | Purpose | Recommendation | Why |
| --- | --- | --- | --- |
| `OAI-SearchBot` | ChatGPT Search index | **Allow** | Without it the site cannot appear in ChatGPT search results |
| `ChatGPT-User` | user-initiated fetch when someone asks ChatGPT to open the page | **Allow** | Equivalent to a visitor clicking the page |
| `Googlebot` / `Bingbot` | classic search | **Allow** | the point of the exercise |
| `GPTBot`, `CCBot`, `Google-Extended` | model training / grounding corpora | **Allow (recommended)**, but it is a policy choice | The crawler only ever sees public marketing pages — file processing happens in the visitor's browser, so there is no user data to protect. Blocking would be a statement of principle, not a privacy control |
| SEO scrapers / unknown bots | — | allow via `*` | no benefit to blocking |

No `Crawl-delay` (Google ignores it, Bing prefers rate control in Webmaster Tools), no bot-specific content.

---

## 8. Metadata strategy

One source of truth: `src/seo/pages.ts` (framework-free data), consumed by both the static generator and the React
shell so they cannot drift.

Per page:

| Field | Rule | Example |
| --- | --- | --- |
| `<title>` | `{Primary intent, natural} — {differentiator} \| ZeroUpload`, 50–60 chars | `Image Compressor — Compress Images Locally \| ZeroUpload` |
| meta description | 140–160 chars, one concrete claim + the local-processing fact | `Compress JPG, PNG, WebP and AVIF images in your browser. Quality and size controls, honest before/after sizes, nothing uploaded.` |
| canonical | absolute, trailing slash, self-referencing | `https://…/tools/image-compressor/` |
| robots | `index,follow,max-image-preview:large` on public pages; `noindex` on 404 and any gated tool | |
| OG | `og:title`, `og:description`, `og:url`, `og:type=website`, `og:image` (1200×630), `og:site_name`, `og:locale` | |
| Twitter | `summary_large_image` + title/description/image | |
| `<html lang>` | `en` (already) | |

Titles are written per tool from the intent matrix — never a single template with the slug spliced in, and never
keyword lists. Every claim in a description must be visible on the page.

**Homepage:** `ZeroUpload — Private File Tools That Run Locally`.
**Missing asset to create:** a real 1200×630 social card (the repo has only an SVG favicon; most platforms will not
render SVG OG images). Plan: one static PNG, designed once, committed; per-tool OG images are *not* built in v1
(1200×630 × 20 would be noise, and a single strong brand card is enough).

---

## 9. Structured data

JSON-LD, generated per page, validated in CI.

| Page type | Types | Notes |
| --- | --- | --- |
| Homepage | `WebSite` + `WebApplication` | `name`, `url`, `description`, `applicationCategory: "UtilitiesApplication"`, `operatingSystem: "Any (web browser)"`, `browserRequirements: "Requires JavaScript"`, `isAccessibleForFree: true` |
| Tool page | `WebPage` + `BreadcrumbList` + `SoftwareApplication` | The tool page *is* the application: name, url, description, category, `isAccessibleForFree`, `featureList` (formats/limits, matching visible copy) |
| Category page | `CollectionPage` + `BreadcrumbList` + `ItemList` | ItemList of the tools on that page |
| `/how-it-works/` | `WebPage` + `BreadcrumbList` | technical documentation, no app markup |

Explicitly **not** included: `aggregateRating`, `review`, `offers`/`price`, `Organization`, `FAQPage` on pages
without visible Q&A, `HowTo` (deprecated as a rich result and our UI is not a step-by-step guide).
`FAQPage` *is* used on tool pages — but only after §10 adds genuinely visible question-and-answer sections, and with
the expectation that Google no longer shows FAQ rich results for most sites (Bing and AI parsers still read it).

Validation: a unit test parses every generated JSON-LD block, checks required fields per type, checks that
`SoftwareApplication.url` equals the page canonical, and that no rating/price properties appear.

---

## 10. Content model for a tool page

Static HTML, present before any JavaScript runs. For each tool:

```
breadcrumb                     Home / Tools / PDF / PDF Password Protector
h1                             PDF Password Protector
lede                           one sentence: what it does + runs locally
[ interactive workspace ]      client-side island, lazily loaded
"What this tool does"          formats in/out, what happens to the file
"What it will not do"          honest limits (advisory permissions, no cracking, size caps)
"Common questions"             3–5 genuinely useful Q&As (visible, optionally FAQPage)
"Related tools"                semantic links with descriptive anchor text
```

Answer blocks use the brief's fact shape — *what it is / what it does / where it runs / is upload required / formats
/ limits / what happens afterwards* — in prose, not as a metadata blob:

> **Does this tool upload my file?** No. The PDF is encrypted in your browser using the Web Crypto API; there is no
> server endpoint in the app.

That paragraph is simultaneously good copy, good SEO, and exactly what an AI answer engine needs to quote.

**Internal linking** is generated from the registry, not hand-written, so it cannot rot:

* Tool page → 3 related tools (same category first, then a cross-category companion), with anchor text = the tool's
  name, never "click here".
* Tool page → its category page → `/tools/`.
* Homepage → categories, plus 4 featured tools.
* `/how-it-works/` → every tool group, and back from every tool page's privacy note.

The brief's example chains (Protector → Unlocker → Inspector → Compressor) are honoured by curating an explicit
`related` override per tool, falling back to category order.

---

## 11. Architecture changes required for crawlability

The hash router is the obstacle. Three options, with the trade-offs:

### Option A — path URLs, prerendered documents, hydrated shell (recommended)

* `HashRouter` → `BrowserRouter` with a basename derived at runtime (from the module script's URL, so a project
  subpath or custom domain needs no rebuild… prefix is inferred, not hard-coded).
* Build gains a second pass: an SSR bundle of a `render-static` entry, then a Node script that renders every route
  to HTML and writes `dist/<route>/index.html`.
* Client hydrates the shell; the interactive tool mounts as an island inside it (lazy import preserved, so the PDF
  engine still only loads on a PDF page).
* Relative asset URLs are rewritten per page depth by the prerender script (`./assets/x` → `../../assets/x`), so
  `base: './'` can stay and the artifact still works from any subdirectory.
* `/#/tools/x` → redirect to `/tools/x/` on boot.

**Pros:** real 200-status pages with real content and no JS; SPA navigation and file handoff (homepage drop →
inspector) keep working; one source of truth for markup. **Cons:** prerender pipeline is new build machinery;
hydration must match (mitigated by not hydrating the heavy tool island).

### Option B — keep hash routing, add static landing pages at path URLs

Crawlable pages exist, but they are a *second* representation; the actual tool stays at `/#/…`. Two URLs per
capability, a two-step journey, and the landing page cannot be the tool. **Rejected**: it directly contradicts the
flow the brief asks for (§21) and creates the duplicate-content problem we are trying to avoid.

### Option C — full multi-page app, no client router

Every page is its own document; navigation is a normal page load. Simplest and most robust SEO-wise, but it breaks
the homepage file handoff (module state does not survive a navigation) and removes the SPA feel everywhere.

**Recommendation: Option A.**

### GitHub Pages constraints that shape the design

| Constraint | Consequence |
| --- | --- |
| No custom headers | no `301`/`302` rules, no `HSTS`, no custom cache headers; redirects are client-side |
| Directory URLs 301 to the trailing-slash form | canonical/sitemap/internal links always end in `/` |
| Unknown paths → `404.html` with a real **404** status | genuine 404s are correct and index-safe; there is no "SPA fallback that returns 200" trap |
| `base: './'` breaks at directory depth | prerender rewrites asset URLs per page depth |
| Pages must be static files | no SSR server, no edge functions, no dynamic OG images |
| Pages not enabled on the repo yet | first deploy is a prerequisite for any of the verification in §14 |

---

## 12. AI search (AEO/GEO) — what actually matters

1. **Crawlability.** `OAI-SearchBot` allowed; pages return 200 with content; no auth, no JS gate, no bot challenge.
2. **Extractability.** Each page states, in plain sentences: what it is, what it does, which formats, which limits,
   that processing is local, that no upload happens. Facts in `SoftwareApplication` + `featureList` mirror the
   visible copy.
3. **One canonical page per capability.** No near-duplicates for the model to choose between.
4. **Consistency.** Homepage, catalogue, tool page and sitemap all use the same tool names — so "PDF Password
   Protector" is one entity, not three.
5. **Honest limitations.** "Permission flags are advisory", "AES ZIPs need 7-Zip/Keka", "Office protection is
   experimental" — these are exactly the details that make a page quotable rather than generic.

Not doing: `llms.txt` (not a standard, no evidence any major system consumes it — optional experiment later),
keyword meta tags, hidden text, bot-specific content, fabricated ratings.

---

## 13. Why the privacy model is untouched

* Prerendering happens **at build time in CI**: it renders copy about the tools, never a user's file.
* No file ever leaves the device at runtime; the build produces static HTML and the app still has no endpoint.
* No analytics, no tag manager, no third-party CDN, no fonts fetched from a server (fonts are bundled today and stay
  bundled).
* No cookies introduced; the only storage remains the theme preference.
* The one new network-shaped thing is `sitemap.xml` + `robots.txt`: two static files.
* Claim discipline: no "100% private", no "military-grade"; the pages repeat the same statements the UI already
  makes, and are verifiable in DevTools exactly as before.

---

## 14. Implementation plan and verification

### Phases

| Phase | Work | Ship-able on its own? |
| --- | --- | --- |
| **P1 — Foundations** | path routing + basename inference, prerender pipeline, per-page title/description/canonical/OG, hash→path redirect, `/how-it-works/`, generated `sitemap.xml` + `robots.txt`, OG image | yes |
| **P2 — Content** | `src/seo/pages.ts` + per-tool sections (what it does / limits / formats / 3–5 Q&As), curated related-tool links, category pages | yes |
| **P3 — Signals** | JSON-LD per page type, `ItemList` on categories, validation tests, internal-link audit | yes |
| **P4 — Verification** | crawl simulation of `dist/`, Search Console + Bing Webmaster submission, Rich Results Test, AI-crawler fetch check | — |

### Verification checklist (deliverable at the end of P4)

**Crawl / static**
- [ ] every route returns 200 and meaningful HTML with JS disabled
- [ ] one `<h1>` per page, ordered headings, no `noindex` on public pages
- [ ] canonical, OG, Twitter and JSON-LD present and self-consistent on all 30 pages
- [ ] `/sitemap.xml` parses, contains exactly the canonical set, absolute URLs, trailing slashes
- [ ] `/robots.txt` allows OAI-SearchBot, Googlebot, Bingbot; references the sitemap
- [ ] `/#/tools/x` redirects to `/tools/x/`; unknown paths return 404 with the 404 document
- [ ] no broken internal links (build-time link check)

**Application (regression)**
- [ ] direct navigation and refresh on every route
- [ ] GitHub Pages project subpath **and** a custom domain both work (asset paths, basename)
- [ ] tool loading still lazy — opening `/` downloads no codec/library chunk
- [ ] homepage file handoff → inspector still works
- [ ] `tsc -b`, 245 tests, production build all green; new tests for metadata, sitemap, JSON-LD, links

**External (manual, after deploying)**
- [ ] Google Search Console: property added, sitemap submitted, URL inspection renders the page
- [ ] Bing Webmaster Tools: sitemap submitted
- [ ] Rich Results Test: no errors on a tool page
- [ ] `curl -A "Mozilla/5.0 (compatible; OAI-SearchBot/1.0)"` returns 200 and the page content — no bot wall

### Risks

| Risk | Mitigation |
| --- | --- |
| Hydration mismatch between prerendered HTML and client render | tool UI mounts as an island into an empty container; the shell is rendered from the same components |
| Prerender pipeline complexity in a build that is currently one command | generated pages are plain files; a test asserts page count, canonical and H1 for every route |
| Content quality drifting into keyword filler | one page per capability, per-tool facts, no synonyms as URLs; review pass on every page |
| SEO work bloating the bundle | no new runtime dependencies; JSON-LD is static HTML; islands stay lazy |
| Time spent on pages for tools that do not exist | the six missing capabilities are explicitly out of scope |

### Effort

Roughly 5–6 focused days: P1 ≈ 2, P2 ≈ 2–3 (content is the long pole), P3 ≈ 1, P4 ≈ 0.5 plus waiting on Search
Console.

---

## 15. What stays out of scope

* No new tools (PDF compressor, PDF→images, PDF→text, privacy audit, metadata cleaner) — they are product work.
* No keyword-stuffed synonym URLs, no doorway pages.
* No SSR server, edge functions, analytics, tag manager or third-party scripts.
* No fake ratings, prices, review counts or "trusted by" claims.
* No changes to file processing, encryption, budgets or the privacy model.
