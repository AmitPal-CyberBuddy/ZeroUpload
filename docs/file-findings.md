# File findings and per-tool analysis

Why the inspector now tells you a PDF runs a script on open, what every other tool
does with the bytes it already reads, and how "related tools" stopped being a
funnel.

---

## 1. The problem this replaces

The File Inspector read a file thoroughly and said almost nothing about it. It
reported name, size, detected type, declared type, dimensions, page count, entry
count and a SHA-256 digest — all facts about *the container*, none about *the
content*. Upload a PDF whose `/OpenAction` executes JavaScript and it reported
"1 page". That is not a wrong answer; it is an answer to a different question.

Meanwhile "Related tools" at the foot of every tool page was a hand-written map of
three slugs per tool with no explanation, topped up from the registry in
declaration order when the map was short. Two consequences:

- **A suggestion could not say why it was there.** "Unlock PDF" after "Protect
  PDF" is the pair, not a recommendation about the file in hand.
- **The fallback was alphabetical-ish noise.** A page with fewer than three curated
  entries padded from `TOOLS` in array order, so an image tool could suggest a
  JSON formatter because it happened to be first.

Both are now data-driven, and both are tested.

---

## 2. One vocabulary: `Finding`

`src/lib/inspect/findings.ts` defines the shape every scanner returns:

```ts
interface Finding {
  id: string;          // 'pdf.launch' — stable, grouped by, asserted on
  severity: Severity;  // 'danger' | 'warn' | 'info'
  title: string;       // what was seen
  detail: string;      // in what, and why it matters
  evidence?: string;   // the literal keyword, name or count
  advice?: string;     // only where there is a real action
}
```

Three rules hold the honesty of the output:

1. **A finding names what was observed, not what it means.** "The document
   contains a /Launch action" is a fact. "This file is malicious" is not
   something a byte scan can establish, so nothing claims it.
2. **Absence of a finding is not a clean bill of health.** Compressed streams that
   will not decode, encrypted bodies, and files larger than the read window each
   produce a `limited` line rather than a silent zero.
3. **Severity is about consequence, not confidence.** `danger` means opening the
   file in the application that owns it can execute code or write outside the
   folder you chose. `warn` means something contradicts itself or carries known
   risk. `info` is context worth having.

Every scanner also returns `next: NextStep[]` — tool slugs this *particular* file
makes worth opening, with the reason. That is what feeds the inspector's
"Next steps" and narrows it from "you have a PDF" to "you have a PDF that runs
code on open, so splitting it drops the catalog action".

---

## 3. What each scanner looks at

| Module | Input | Checks |
|---|---|---|
| `inspect/pdf.ts` | PDF bytes, ≤ 24 MB | `/JavaScript`, `/JS`, `/Launch`, `/OpenAction`, `/AA`, `/EmbeddedFile(s)`, `/RichMedia`, `/XFA`, `javascript:` URIs, script-body primitives (`exportDataObject`, `util.printf`, `app.launchURL`, `unescape`), header offset (polyglot), truncated trailer, revision count, object streams, encryption |
| `inspect/archive.ts` | ZIP central directory | traversal paths, absolute paths, double extensions, runnable extensions, `vbaProject.bin`, macro-enabled extensions, OLE embeddings, external links, ActiveX parts, declared sizes over 64 MB, encrypted entries |
| `inspect/image.ts` | JPEG segments, PNG chunks, GIF blocks | trailing bytes after EOI/`IEND` and what they resemble, missing end marker, decoded-bitmap size, pixel count, EXIF orientation, animation frame count |
| `inspect/text.ts` | text ≤ 1 MB | renamed binaries, control-character ratio, executable markup, JSON structure (depth, duplicate keys, exact error position), BOM, mixed line endings, overlong lines |
| `inspect/scan.ts` | decides which of the above applies | plus name-level checks that belong to no single scanner: double extension, bidi override, NUL byte |

### Why the PDF scanner inflates streams

A raw keyword search finds `/JavaScript` in a hand-written sample and nothing at
all in a document produced by an office suite, because the payload lives inside a
`/FlateDecode` stream. The scanner walks `stream … endstream`, filters on the
dictionary's `/FlateDecode`, and inflates through fflate under explicit budgets
(400 streams, 32 MB inflated, 2 s wall clock). fflate is already in the bundle for
ZIP, so this adds no dependency.

**A bug worth recording.** The first version matched `stream\r?\n`, which also
matches the `stream` inside `endstream\n`. Every end marker therefore looked like
the start of a new stream, the bytes after it failed to inflate, and a clean
twelve-page pdf-lib invoice reported *"13 compressed streams would not decode"*.
The pattern is now `(?<!end)stream\r?\n`, and `tests/inspect-scan.test.ts` asserts
against real library output rather than a hand-built fixture — a false-positive
rate like that is what makes a scanner's warnings worthless.

A second honesty fix came from the same test: "skipped" used to count every stream
without a Flate filter, including uncompressed ones that *were* scanned as raw
bytes. It now counts only streams that claimed compression and would not decode.

---

## 4. What the tools do with it

`scanFile()` is pure and bounded — it reads a prefix (and for archives a suffix),
never the whole file — so a 200 MB video costs one 512 KB read.

| Tool | New analysis |
|---|---|
| **File Inspector** | Full report above the facts, "Scanning the bytes" state while it runs, next-step buttons with reasons, per-type suggestions |
| **Extract ZIP** | The archive report rendered above the entry listing, from the same buffer the extractor already consumed |
| **Image Converter / Compressor / Resize / Crop / Rotate** | `ImageChecks`: two reads (64 B head, 16 B tail) that say when data is appended after the picture — which re-encoding will silently drop — or when the file was truncated |
| **Base64** | `identifyDecoded()` names what a non-UTF-8 decode actually is (PNG, PDF, ZIP, MP4, …) and warns prominently when it is an executable or a PHP script; the download is named and typed accordingly |
| **URL Encoder** | `inspectUrl()` splits the address into scheme/host/path/params and flags embedded credentials, encoded slashes, `..`, bare IPs, punycode, duplicated parameters, and redirect parameters that point elsewhere |
| **JSON Formatter** | `notesFor()` reports duplicate keys (which `JSON.parse` silently resolves to last-wins), nesting deep enough to overflow a recursive parser, and a non-object root |
| **Hash Generator** | Names the file from its first bytes, and when a pasted digest has the wrong length for the selected algorithm, identifies the algorithm it *is* for, computes that digest, and offers to switch — instead of reporting a mismatch that was the setting's fault |

Everything stays local: no fetch, no worker message leaves the origin, and the CSP
keeps `connect-src 'none'`. `tests/csp.test.ts` scans every shipped chunk for
`eval(` and `new Function(`, which caught a real instance — the literal `eval()`
label in a detector table.

---

## 5. Related tools

`src/registry/tools.ts` now exports:

```ts
interface RelatedEntry { slug: string; why: string }
relatedToolEntries(tool, limit = 3): RelatedEntry[]
```

Resolution order, with every step filtered to registered tools:

1. **Curated**, each with a sentence explaining it (`why`), order preserved because
   the first entry is the strongest.
2. **Same category**, derived from the registry — one phrasing, not a guess.
3. **Anything stable**, last resort.

`ToolLayout` renders the `why` above each card inside a bordered rail, reserving
two lines so three cards share a baseline. On a single column the reservation is
dropped, because an aligned baseline means nothing when nothing is beside it.

`tests/related-tools.test.ts` asserts the properties that make the list trustworthy:
three reachable suggestions on every page (including the flag-gated one), never a
self-link, never a duplicate, every suggestion explained with a full sentence,
curated order preserved, no dead aliases, and — the regression guard — no two
different tools sharing an identical triple, which is what the old padding produced.

The curated map also had to be corrected against itself: `hash-generator` listed
`file-inspector` twice, and one `why` claimed a password "stops the script running
again", which is false — encryption gates opening, not the actions inside. Both
were caught by review, not by a test; the wording is now "The password gates
opening; it does not disable the actions inside."

---

## 6. Verification

| Gate | Result |
|---|---|
| `tsc -b` | clean |
| `npm test` | 49 files · 646 tests (+21 scanner/related-tool assertions, +19 analysis helpers) |
| `npm run test:dom` | 15 files · 85 tests |
| `npm run build` | 35 pages · 37 documents · 878 links · 0 warnings |
| Visual audit, full matrix (4 widths × 2 themes × 35 routes) | `contrast=0 boundaries=0 overflow=176 headings=0 noalt=0 dupIds=0 js=0` |
| Entry chunk | 425.8 kB raw / **134.8 kB gzip** (+3.7 kB gzip for the shared vocabulary) |
| Inspector route cost | 15.2 kB tool + scan chunk, lazily loaded |

The two audit overflow counts are the two known, deliberate patterns
(`filedrop__glyph`, `hero__inner`) — identical to the pre-change baseline.

---

## 7. What this is not

- **Not an antivirus.** It pattern-matches structure, not behaviour, and it says so
  in the report. A file with no findings has passed a structural check over the
  bytes that could be read; the copy says exactly that.
- **Not a PDF parser.** It does not resolve object references or decode
  cross-reference streams, so a payload split across objects — `/JS` in one, the
  code in another — is seen as the keywords it contains rather than as a resolved
  program. The `limited` line for undecodable streams covers the rest.
- **Not exhaustive over encryption.** An encrypted PDF's dictionaries are
  unreadable, and the report lists that as a blind spot instead of reporting a
  clean scan.
- **Not a redirect-follower.** `inspectUrl` reads the address and never fetches it;
  whether a redirect is malicious is a judgement the reader makes from the host
  it names.
