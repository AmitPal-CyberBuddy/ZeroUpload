# External design checklists, held against this codebase

**Sources reviewed:** the design category at [agenticskills.io](https://agenticskills.io/category/design)
and [`elayadesign/ai-design-skills`](https://github.com/elayadesign/ai-design-skills)
(`landing-page-design`, `figma-designer`, plus the companion `redesign-skill` and
the hosted SlopScan checker it advertises).

**Verdict up front:** for this product, the collection is close to useless as a
source of improvements, and following it literally would make the site worse in
three specific ways documented below. It is worth reading anyway, because it is a
good articulation of the house style that earlier audits of this project already
rejected — and it let me check whether we had drifted into ignoring any of its
genuinely universal rules. We had not, with one exception that is now fixed and
listed first.

This is not a review of the authors' work. As a prompt pack for making an AI
generate a landing page from scratch, it is coherent, specific and unusually well
structured. It is simply aimed at a different job.

---

## What the collection is

`landing-page-design` is two halves. Part A is conversion strategy: intake
questions, section order (hero → problem → benefits → how it works → proof → FAQ →
final CTA), headline formulas, risk reversal. Part B is a visual system: a fixed
type scale, a spacing table, radius rules, one typeface, motion curves.

That structure assumes a page that has to *win one intent* from a stranger who
arrived from an ad. ZeroUpload's pages have a different job: a person arrives from
a search for a specific task ("merge two PDFs without uploading"), and the page
either does that task in the first screen or it fails. There is nothing to
convert, no trial to start, and no funnel — a fact that shapes the layout more
than any conversion rule can.

---

## Rule by rule

Verdicts: **kept** (already true, verified), **adopted** (changed because of this
review), **rejected** (would harm this product), **n/a** (no such surface).

| Rule | Verdict | Evidence |
| --- | --- | --- |
| Geist / Geist Mono as the typefaces | **kept** | Already shipped and self-hosted at `src/styles/fonts.css` — Geist Variable plus Geist Mono, latin and latin-ext only, no CDN. We arrived at the same two families independently; the difference is that ours ship two subsets instead of Fontsource's five. |
| `text-wrap: balance` on headings, `pretty` on body | **kept** | `src/styles/base.css:67` (h1–h4) and `:78` (p). |
| No italics in the interface | **kept** | Zero `font-style: italic` declarations in `src/styles/`. |
| No 900/black weights | **kept** | Heaviest declared weight is 700; headings are 560. `tests/typography.test.ts` covers the scale. |
| Every interactive element has hover, active, focus, loading, empty and error states | **kept, one gap closed** | `.btn:active`, `.tool-card:active`, `.category-card:active` exist; focus rings are contrast-tested in `tests/contrast.test.ts`; `tests/hover.test.ts` guards hover behaviour. The gap was anchors — see "adopted" below. |
| Never animate `top`, `left`, `width`, `height` | **rejected for two rules, with reasons** | See "the two places we differ" below. |
| Hard 320 ms ceiling on motion, none of it looping | **kept, and stricter than the source** | `tests/motion.test.ts` fails the build if a non-indicator animation exceeds `--dur-slow` (320 ms), if a rule hard-codes a duration, or if anything loops that is not an indeterminate indicator. Under `prefers-reduced-motion` there is a global override. |
| Contrast and focus visibility | **kept** | `tests/contrast.test.ts` composites translucent tokens and checks both themes, including the focus ring at 3:1. |
| Current page indicated in navigation; no dead links | **kept** | `aria-current` on nav; `scripts/check-links.mjs` fails the build on a broken internal link (704 checked, 0 warnings). |
| Semantic landmarks, skip link, 404, favicon, meta/OG, alt text, no `window.alert` | **kept** | Prerendered shell; `tests/a11y.test.ts`; the 404 and the shell are render-tested. |
| Empty and error states that say what failed and what to do next | **kept** | Catalogue filter, palette, drop zones and `ToolError` all state the cause and the next step; several carry the exact limit that was hit. |
| "One primary action, no competing CTAs" | **kept** | Phase 1 of the UX audit resolved the duplicate primary actions; `RunAction` is the single action on every tool page. |
| Icons from Phosphor, Solar or Iconamoon | **rejected** | The icon set here is hand-drawn on a 64-unit grid (`src/components/ui/Icon.tsx`) because "geometric custom icons" was a requirement of this project's own brief. Adding an icon package would add weight and replace a coherent set with a borrowed one. |
| Tailwind's spacing, radius and type scales | **rejected** | The project has its own tokens (`src/styles/tokens.css`) tuned to its type sizes and breakpoints, and `tests/typography.test.ts` and `tests/motion.test.ts` assert against them. Adopting Tailwind's scale would mean re-deriving every value to land on a different ladder for no user-visible gain. |
| Hero heading and subheading capped at 680px | **kept, tighter** | Hero copy caps at 46ch (`.hero__lead`, `pages.css:123`), which at this size is roughly 400px. Body prose caps at 66ch. |
| No gradients in backgrounds | **kept in spirit** | Backgrounds are flat. The six gradient tokens in `tokens.css` are used for accent rules, the brand mark and a 3px progress fill — never as a page wash. |
| Skeleton loaders instead of spinners | **rejected** | A tool chunk is 2–20 kB and the work itself reports real progress through the worker (`Progress` takes 0–1 ratios). A skeleton would fake a layout for ~150 ms and then show a different one; a progress bar that reflects actual work is more honest and cheaper. |
| Cookie consent where required | **n/a** | No cookies, no analytics, no third-party requests. `connect-src 'none'` in the CSP. |
| Client-side email validation | **n/a** | There are no forms with email fields. |
| Privacy policy and terms links | **partly n/a** | There is no account, no payment and no data collection to have a policy about; `/how-it-works/` is the statement, and `docs/architecture.md` is the longer record. Adding a boilerplate "Terms" page would be a claim with no referent. |
| A mandatory "tagline reveal" section — two lines of large type whose words fade in one at a time on scroll | **rejected** | It is a decorative loop on the most-scrolled part of the page, and `tests/motion.test.ts` would fail it: word-by-word scroll activation is a scroll-driven sequence longer than the 320 ms budget. It is also the most recognisably template-shaped element in the pack — exactly what the earlier product audit asked us to remove. |
| Testimonials, logo strip, case studies, a 6–12 question FAQ on the homepage | **rejected** | There are no customers to quote and no logos to show. Inventing either is the one thing this project is not allowed to do, and a homepage FAQ was explicitly refused in Phase 3 of the UX audit. |
| "No hyphens in copy" | **rejected** | Impossible for the vocabulary of this product: AES-256, SHA-256, PDF-1.7, base64-encoded, 300 MB. The rule is a proxy for "no ugly compound adjectives", which is worth keeping as intent, not as a character ban. |
| "Never use ultra bold", "never use Inter" | **kept by accident** | We already satisfy both. Worth noting that the second is a taste preference stated as a prohibition; this project chose its faces for other reasons (self-hosted, variable, monospaced companion for values). |

---

## The two places we differ, and why

The source states "animate only `transform` and `opacity`" as absolute. Two rules
in this codebase animate layout properties:

1. `.skip-link { transition: top }` (`layout.css:16`) — a 60px slide into view on
   first Tab. There is exactly one such element, it moves once per focus, and it
   only exists for keyboard users. The alternative, a transform on a fixed
   element, is not more correct; it is the same number of composited pixels.
2. `.progress__bar { transition: width }` (`ui.css:443`) — a 3px-high bar whose
   element has no children, so the reflow stops there. Converting it to
   `scaleX()` would squash its `border-radius` and make the code harder to read
   for a saving that cannot be measured on hardware in this repository.

Both are recorded here rather than silently kept, because the honest position is
"we looked, we measured what could be measured, and the rule's cost exceeds its
benefit at this size" — not "the rule does not apply to us".

---

## What this review actually changed

**One thing, and not from the collection's own list.** Following the idea that a
page's sections should be individually addressable, tool pages now have in-page
anchors with `scroll-margin-top` so a jump does not hide the heading under the
sticky header (`src/styles/pages.css`).

Everything else that came out of this turn — recent tools in the palette, a "see
all matches" exit to the catalogue, `?q=` on the catalogue — was already queued as
Phase 5 of `docs/audit-and-plan.md` from this project's own UX audit. It would be
dishonest to attribute them to a checklist that does not mention them.

## Why the collection cannot be adopted wholesale

Its own README says the design values "live in one section near the bottom of its
file. Fork this repo, edit that section, and the rest of the skill follows
automatically." That is the right design for a generator starting from nothing. It
is also precisely the mechanism by which a mature product loses its design system:
you swap the values, and every page snaps to somebody else's defaults.

The direction of travel matters too. These skills *generate*; this project has
spent five audit passes *removing* what generated pages over-apply — decorative
motion, three card languages, competing calls to action, gradient washes, "modern
SaaS" sections that exist to fill space. A checklist that prescribes several of
those will not help a site that has already argued its way past them.

**Where it is genuinely useful:** `redesign-skill` (the companion for existing
sites) and SlopScan are diagnostic rather than prescriptive, and a few of their
questions — "is the current page indicated?", "does every state exist?", "does the
error say what to do next?" — are the same questions this project's tests already
ask, with the difference that here they fail the build rather than appear in a
report.
