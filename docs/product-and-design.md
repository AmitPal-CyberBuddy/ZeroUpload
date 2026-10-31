# ZeroUpload — product structure & visual system

This is the Phase 2 / Phase 3 record: how the product is organised and why it looks the way it does.
The implementation in `src/` is the source of truth; this document explains intent.

---

## 1. Product structure

```
Home  ───────────────────────────────────────────────  the promise
 │
 ├── Tool catalogue (/tools)  ─────────────────────────  discoverability
 │      filter by category · free-text filter · grouped grid
 │
 ├── Tool workspace (/tools/:slug)  ───────────────────  the work
 │      header (what it does + local badge)
 │      source pane (drop → file card → preview/editor)
 │      settings sidebar (format, quality, geometry, pages)
 │      stage timeline (Reading → Processing → Complete)
 │      result panel (before/after bytes, preview, download)
 │      related tools (continue, don't dead-end)
 │
 ├── How it works (/architecture)  ────────────────────  auditability
 └── 404  ─────────────────────────────────────────────  files were never involved
```

### Navigation

* Sticky header: brand, *Tools*, *How it works*, search (⌘K), theme toggle, source link.
* Search is a command palette over tool metadata and keywords — not a server query.
* Breadcrumbs on every tool: ZeroUpload / Tools / Tool.
* Footer: platform categories, popular tools, project links (source, security, issues).
* Mobile: header collapses to brand + search + theme + menu; the catalogue filters scroll horizontally.

### Tool discovery

1. Homepage categories → catalogue filtered by category.
2. Featured "everyday four" cards.
3. Catalogue with text filter across names, tags and aliases.
4. ⌘K palette from anywhere.
5. Related tools at the bottom of every workspace.
6. The inspector suggests a tool based on the file's real type.

### States (every tool implements all five)

| State | Presentation |
| --- | --- |
| **Empty** | Drop zone with a zero-ring glyph, supported formats, and an explanation of where the file goes |
| **Selected** | File card: name, byte size, MIME/detected type, dimensions or page count, remove/replace |
| **Processing** | Three-node stage timeline driven by real worker events; a determinate bar wherever the work has a countable unit (PDF split per file, merge per document, images → PDF per page), indeterminate only when a phase genuinely has no measurable progress. Cancelling a PDF job is reported as “cancelling” until the worker reaches a checkpoint |
| **Error** | `ToolError` → title, cause, and a recovery hint. Never a raw stack trace, never a silent failure |
| **Success** | Accent-bordered result panel: measured before→after bytes, percentage delta, preview, download, re-run, "process another" |

Errors that would otherwise look like bugs are called out explicitly: "same format as source",
"this conversion grew the file", "format unsupported in this browser", "SVG refused".

---

## 2. Visual system

### Palette

| Token | Dark | Role |
| --- | --- | --- |
| `--bg` | `#08090b` | Near-black graphite base |
| `--surface` | `#0e1114` | Cards, panels |
| `--surface-2/3` | `#12161a` / `#171c21` | Nested surfaces, controls |
| `--text` | `#eef2f5` | Primary copy |
| `--text-secondary` | `#a3aeb8` | Explanatory copy |
| `--text-muted` | `#6f7b86` | Labels, metadata |
| `--accent` | `#5ff3d2` | Electric mint — the single primary accent |
| `--accent-strong` | `#2fe4c2` | Interactive accent |
| `--violet` | `#8b7bff` | Secondary, used sparingly (gradients, badges) |
| `--danger` / `--warn` | `#ff7a7a` / `#ffc978` | Failures and cautions |

Light theme is a faithful inversion (`#f5f6f8` base, `#0e9f85` accent) rather than a second brand: same
hierarchy, same semantic colours, adjusted for contrast.

Accent usage is rationed. Mint appears on: primary actions, active states, stage progress, result borders,
the zero mark, and small metadata values. Everything else is graphite.

### Typography

* **Geist Variable** for UI (`-0.025em` tracking on headings, 1.6 body line-height).
* **Geist Mono Variable** for anything factual: byte sizes, dimensions, hashes, coordinates, badges, stage
  labels, settings values, section eyebrows.
* Scale: 11 / 13 / 15 / 17 / 20 / 26 / 34 / 48, display `clamp(2.6rem, 7.2vw, 5.6rem)`.
* Numeric values use tabular figures so counters do not jitter.

The mono/sans split is the main "technical" signal in the design: prose is human, numbers are machine.

### Spacing, radii, elevation

* 4px base scale (4 → 96px); page gutters `clamp(1rem, 4vw, 2.5rem)`; content max 1180px.
* Radii: 6 / 8 / 12 / 16 / 22 / full. Rectangles stay restrained — 12–16px on panels, 6–8px on controls.
  No pill-shaped cards.
* Elevation comes from hairlines (`rgba(235,245,255,.08)`) and one soft shadow token, not stacked glows.
* Glassmorphism is limited to the sticky header, the intake panel and toasts (`blur(12–18px)` + low-alpha
  surface).

### Components

Buttons (primary / secondary / ghost / danger / icon / sizes) · segmented control · range slider with
filled track · switch · numeric + text inputs · select · notice (accent / default / warn / danger) ·
fields with mono labels and right-aligned values · file card · drop zone · manifest rows · key/value table ·
stage timeline · before/after comparison · result panel · badges · command palette · toasts · empty states ·
skeleton/spinner (used sparingly — timelines replace spinners in tools).

### Iconography

A single set of 24px geometric line icons drawn at 1.5px stroke, inlined as path data
(`components/ui/Icon.tsx`). No icon package, no icon font. Icons appear at 12–19px and always pair with a
label or `aria-label`.

### Motion language

| Moment | Motion |
| --- | --- |
| Page enter | 10px fade-up, 420ms, staggered 55–90ms across cards |
| Drop hover | Dashed ring rotates, border turns solid mint, 1.006 scale, soft mint glow |
| Drag active | Zero-ring spins continuously; CTA text changes to "Release to load locally" |
| Processing | Stage nodes fill in sequence; the bar advances with real per-document progress, indeterminate only between measurable phases |
| Result | 0.97 → 1 scale-in with a mint border |
| Hover | 1–3px lift, border and text colour transitions at 120–200ms |
| Palette | 8px drop + 0.985 scale, 200ms |

All durations are ≤420ms; nothing blocks input. `prefers-reduced-motion: reduce` collapses every animation
and transition to ~0ms while keeping the final state, with two deliberate exceptions: the indeterminate
progress bar becomes a static, fully visible fill (a collapsed animation would otherwise park it off-screen
and read as "stuck"), and the spinner becomes a static ring.

### The zero as identity

The mark is an **open ring** — a zero with a gap: the local boundary. A mint arc, a violet tail and a centre
dot give it enough character to work at 11px (badges) and 620px (hero ambient).

* **Wordmark**: ZER**0**UPLOAD, where the O is the live mark — the identity is inside the name.
* **Drop zone**: the same ring, dashed, rotating on drag.
* **Processing**: the ring spins and closes.
* **Empty/404**: the ring alone, large and quiet.
* **Favicon**: the ring on graphite.

It is deliberately *not* repeated on every card, button or header row — scarcity keeps it meaningful.

---

## 3. Copy rules

* Say what happens to the file, plainly: "Processed locally in this browser."
* Never claim more than the implementation guarantees: no "100% private", no "military-grade".
* Name limitations at the moment they matter (unsupported encoder, encrypted PDF, size cap).
* Prefer measured facts ("4.6 MB → 1.2 MB, 74.9% smaller") over adjectives.
