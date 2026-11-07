# Documentation index

Eleven documents, in the order they are useful to someone arriving cold. Every
number in them was measured against this repository; where a claim could not be
measured it says so instead of rounding up.

## Start here

| Document | What it answers |
| --- | --- |
| [`architecture.md`](architecture.md) | Why there is no backend, and what that costs. Constraints, decisions and their consequences, written before the source. |
| [`product-and-design.md`](product-and-design.md) | How the product is organised (groups, catalogue, workspace) and why it looks the way it does (tokens, type, motion, light mode). |
| [`architecture.md#security-posture`](architecture.md) | The trust story: CSP, `connect-src 'none'`, what is verified and what is merely promised. |

## The work that shaped it

| Document | What it answers |
| --- | --- |
| [`ux-audit.md`](ux-audit.md) | Product-level UX audit of the homepage, catalogue, group pages, all tool pages, both themes, mobile and accessibility — with a four-phase plan. |
| [`seo-plan.md`](seo-plan.md) | Discoverability: page structure, structured data, crawler policy, and what was deliberately refused (one page per mode). |
| [`tool-audit.md`](tool-audit.md) | Every tool examined on its own terms: what that tool is *about*, and what its UI owes the job. |
| [`improvements.md`](improvements.md) | A later pass over the shipped artifact — frontend, client engine and product — with before/after numbers. |
| [`v2-assessment.md`](v2-assessment.md) | What would be needed for PDF↔Office conversion, OCR and the rest, and why most of it is not shippable here. |
| [`v2-proofs.md`](v2-proofs.md) | The three capabilities that were "uncertain" in that assessment, proven in the browser before anything was claimed. |

## Measurement and plans

| Document | What it answers |
| --- | --- |
| [`measurement.md`](measurement.md) | The image codec probe and the arithmetic behind the batch memory budget. |
| [`batch-processing.md`](batch-processing.md) | Batch as one action over many files: ordering, budgets, progress, cancellation, failure. |
| [`audit-and-plan.md`](audit-and-plan.md) | The whole-project audit (source, build, tests, CI, dependencies, HTML, CSS, copy, docs, weight) and the phased repair, including what each phase measured afterwards. |
| [`design-checklist-review.md`](design-checklist-review.md) | An external design-skill checklist held against this codebase: what it confirmed, what it added, what it would break. |

## Conventions

- Claims about rendered output (CSP, links, routes, page counts) are checked by
  tests in `tests/` or by scripts in `scripts/`, not asserted in prose.
- Numbers carry the command that produced them: `npm run weigh`, `npm test`,
  `npm run build`.
- A document says what was **rejected** and why. A plan that only records what
  was added is a changelog, not a design record.
