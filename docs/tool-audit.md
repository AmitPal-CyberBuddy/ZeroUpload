# Every tool, one at a time

The earlier passes fixed things that were true of the *product*: contrast, focus,
navigation, icons, a CSP, and a shared outcome panel. This pass is about the
individual tools — what each one is actually for, and whether its controls let
someone do that job.

Twenty-one tools, twenty-one verdicts. "Shipped" means it is on this branch.
"Keep" means I looked, and it is right as it is. "Open" means it needs work I did
not do here, with the reason.

| Tool | What it is for | Verdict |
| --- | --- | --- |
| Image compressor | make a photo fit somewhere that has a size limit | **shipped** target-size search |
| Image converter | change format without surprises | shipped earlier; **keep** |
| Favicon generator | produce a working icon set | **keep** (see below) |
| Resize | exact or proportional dimensions | shipped earlier; **keep** |
| Crop | remove everything outside a frame | shipped earlier; **open** — keyboard nudging |
| Rotate image | turn or mirror | shipped earlier; **keep** |
| Merge PDF | one document from several, in order | **shipped** page counts |
| Split PDF | pull out pages | **shipped** inline range validation |
| Rotate PDF | fix upside-down scans | shipped earlier; **open** — page subsets |
| Images to PDF | photos into a document | shipped earlier; **open** — per-image page fit |
| Protect PDF | encrypt with a password | **shipped** confirm field |
| Unlock PDF | remove a password you know | **shipped** pre-flight probe |
| Create ZIP | archive files | shipped earlier; **open** — compression level |
| Extract ZIP | get files out | shipped — per-entry selection, cancel, worker-thread extraction |
| Unlock Office | open an encrypted Office file | **open** — needs the same probe as PDF |
| File inspector | what is this file, really | **keep** |
| JSON formatter | read and validate JSON | **shipped** jump-to-error |
| Base64 | encode/decode, including files | **shipped** binary payloads |
| URL encoder | escape a value or a whole URL | **keep** |
| Hash generator | check a download against a checksum | **shipped** file mode + verification |
| (registry) | 21 entries, one source of truth | **keep** |

---

## Shipped in this pass

### Hash generator — it hashed text and nothing else

The tool is named for the job people actually have: *is this file the one the
release page is talking about?* It could only hash a string, and it computed a
digest you had nowhere to compare against.

- **File mode.** Drop a file, get its digest. Capped at 512 MB with the reason
  stated — `crypto.subtle.digest` is one-shot, so the whole buffer must be
  resident; that is a limit of the platform, not a product decision.
- **Verification.** Paste the published checksum and the tool says match or no
  match. Comparison is whitespace-, case- and shape-insensitive, because published
  checksums arrive as `SHA256 (file.iso) = …`, `sha256:…`, spaced in groups of
  eight, with a leading `\`, or with the filename on the same line.
- **Three answers, not two.** A value that cannot be a digest of the selected
  algorithm is reported as a paste problem (`not-hex`, `wrong-length`) rather than
  as a mismatch. Calling a bad paste a corrupted download sends someone hunting for
  a bug that does not exist.

### Image compressor — a quality slider is not a size requirement

Quality 78 means nothing on its own: on a 300 px icon and a 4000 px photograph it
produces wildly different files. The requirement people bring is "under 500 KB".

- **Target-size mode** searches for the highest quality whose output fits, using
  real encodes through the same worker the run uses — not a model of one. Quality is
  monotonic in output size, so a binary search converges in ≤ 8 probes (~0.01
  quality resolution).
- **It refuses to lie.** If the target is unreachable the run reports the smallest
  output it could make and says so, instead of quietly returning something too big.
- The quality dial is hidden in this mode rather than left visible next to a number
  the run would ignore.

### Protect PDF — a typo used to destroy the file

There is no recovery path for a mistyped open password: the output is encrypted with
whatever was typed, and nobody — including this app — can open it afterwards. Unlike
a permissions password, it cannot be lifted later.

- **A confirm field is now a hard gate**, not a hint. Two seconds of typing against
  an unrecoverable output.
- The explanatory copy stays concrete ("there is no way to recover a mistyped
  password") and still never says "owner password" or claims absolute permissions.

### Unlock PDF — "my PDF is locked" is two different problems

A document either needs a password to *open*, or only restricts printing/copying —
and the second opens with no password at all. Asking for a password in both cases
sends people hunting for one that was never set.

- **A pre-flight probe on load** parses the file and reports which it is, before the
  first keystroke: *opens without a password → leave the field empty*; *needs a
  password*; or *not a readable PDF* (with the run disabled, so a damaged file is not
  presented as a password problem).

### Merge PDF — a size is not a page count

`8.2 MB` does not tell you it is 40 pages, and page count is what decides whether
this is the file you meant to put second.

- Each added document is parsed in the background and its page count appears under
  its size in the list; the total is in the panel. Pending files read
  `12 + 2 counting` rather than holding up the add.

### Split PDF — the count could contradict the button

The live "3 selected" counter is deliberately forgiving so the field can be typed
in, which meant `1-3, 7x` showed a plausible number and then threw on click.

- The **real parser now runs on every keystroke**; a bad range shows a message under
  the field (`role="alert"`), sets `aria-invalid`, and disables the button. Same
  parser as the run, so the two cannot disagree.

### JSON formatter — the error was a place you had to go and find

Line and column were already computed and printed in the footer. On a 300-line
document that is a coordinate, not an answer.

- The position is now **a button**: it focuses the editor, scrolls to the character
  and selects it. `offsetForLineColumn` is pure and unit-tested, including the
  truncated-input case where the parser reports no position at all.

### Base64 — "not text" was treated as "not valid"

Decoding a Base64 payload of a PNG or a certificate constant produced a UTF-8 error
and nothing else, even though the input decoded perfectly.

- Binary payloads are a **third outcome**: the pane says how many bytes it decoded,
  and offers them as a file download. Text still round-trips as before, whitespace
  and the URL-safe alphabet are still tolerated.

---

## Keep — looked at, right as it is

- **Favicon generator.** Produces a real `.ico` containing 16/32/48, the PNG sizes
  in the manifest, a `site.webmanifest` and an HTML snippet, with the theme colour
  wired through. It already ships the artifact people cannot assemble by hand.
- **File inspector.** Signature-first type detection, reported mismatch between the
  declared type and the bytes, a digest on demand, and no pretence that it can open
  anything it cannot.
- **Resize.** Aspect lock, contain/stretch, upscale warning, presets — and the
  outcome panel now states the resulting dimensions and whether pixels were added.
- **Rotate image.** Quarter turns plus mirrors, with the resulting geometry stated
  before the run. Free-angle rotation would be a different tool with a canvas
  editor; it is not this one.
- **URL encoder.** The component/whole-URI distinction is the only one that matters
  here, and it is explained at the point of use.
- **Image converter.** Capability-aware format list (a format the browser cannot
  encode is disabled with the reason), EXIF handling, mismatch warning.

## Open — with reasons, not excuses

- ~~**Extract ZIP: no selection, no cancel.**~~ **Shipped.** Both needed the same
  change underneath, which is why they came together: extraction now runs in the
  ZIP worker, so the tab never blocks in a synchronous decode and an abort is
  delivered to a thread that is not busy. Ticking entries builds a smaller archive
  from the selection instead of re-packing the whole thing.
- **Rotate PDF: all pages only.** Rotating selected pages needs the same page-range
  parsing `Split PDF` already has, plus per-page rotation flags. Small, but it is a
  new control with its own copy and tests.
- **Images to PDF: no per-image page fit.** "Fit" and "A4" apply to every image;
  mixing a portrait screenshot and a landscape photo on A4 leaves letterboxing the
  user cannot control. The control is per-row state in the manifest, which is a
  component change.
- **Unlock Office: no pre-flight probe.** The PDF probe is the pattern; this tool
  needs the same answer (`Agile` vs `Standard` vs not encrypted) from the Office
  parser, which currently only reports after a failed attempt.
- **Create ZIP: no compression level.** Deflate's level is exposed by zip.js, but
  the honest control is "store" vs "deflate" — and the tool already says that
  already-compressed files will not shrink, which is the fact that matters.
- ~~**Crop: no keyboard nudging.**~~ **Shipped.** The frame is focusable and answers
  arrows (1 px, 10 px with Shift) and Alt+arrows (resize). The geometry moved to
  `src/lib/image/crop.ts` so the pointer drag and the keyboard path now share one
  set of clamps — which is how a locked ratio stopped ignoring a sideways drag.

## What this pass measured

`tsc -b` clean · **401 tests / 32 files** (up from 387) · build green: 28 pages,
704 links, 0 warnings, CSP on all 30 documents.

*(After the next pass: **434 tests / 34 files**, plus 29 render tests. See
`docs/audit-and-plan.md`.)*

`tests/tool-controls.test.ts` covers the four pieces of logic that are testable
without a browser: checksum normalisation (eight input shapes, plus the three
failure modes), target-size search (reachable, unreachable, cancelled, probe cap,
converges near the right quality), Base64 binary decoding, and JSON error offsets.
