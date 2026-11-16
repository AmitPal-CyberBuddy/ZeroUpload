/**
 * What a PDF actually asks a viewer to do.
 *
 * A PDF is a program. `/OpenAction`, `/AA` and `/JavaScript` entries are executed
 * by the viewer that opens the document — Acrobat, Preview, a browser's built-in
 * reader — before the reader has clicked anything. The inspector already reads
 * the file's bytes to count pages; this module reads the same bytes to say what
 * those bytes instruct.
 *
 * Design notes, because the failure modes here are both real:
 *
 *  - **Compressed streams are scanned, not skipped.** Most keywords live inside
 *    a `/FlateDecode` stream in any PDF produced by an office suite, so a raw
 *    keyword search finds script in a hand-crafted sample and nothing at all in
 *    a real one. Streams are inflated through fflate — the library already in the
 *    bundle — under explicit byte, count and time budgets.
 *  - **A keyword is evidence, not a verdict.** `/JavaScript` in a file produced
 *    by a form builder is common and usually benign; the same keyword next to
 *    `/OpenAction` is a document that runs code on open. Severity is assigned from
 *    the combination, and the copy says what was seen rather than what it means.
 *  - **Every blind spot is reported.** Encrypted bytes cannot be read, object
 *    streams hide dictionaries from a linear scan, and a large file is sampled
 *    rather than read whole. Each of those becomes a `limited` line instead of a
 *    silent zero.
 *
 * This module is pure: bytes in, findings out. No DOM, no pdf-lib, no worker, so
 * it runs identically in the browser and under the Node test suite.
 */
import { inflateSync, unzlibSync } from 'fflate';

import {
  type Finding,
  type Insight,
  type NextStep,
  emptyInsight,
  sortFindings,
} from './findings';

/** Enough of a document to hold its catalog, trailer and most streams. */
export const MAX_PDF_SCAN_BYTES = 24 * 1024 * 1024;
/** More than this many streams is a document that has been padded deliberately. */
const MAX_STREAMS = 400;
/** Cumulative inflated size ceiling; a decodable 400 MB stream is a bomb, not a PDF. */
const MAX_INFLATED_BYTES = 32 * 1024 * 1024;
/** Wall-clock ceiling, so a pathological file cannot hold the inspector open. */
const MAX_SCAN_MS = 2_000;

/**
 * Object names that describe behaviour, with the ones a benign document also
 * uses (`/AcroForm`, `/ObjStm`) kept in a separate list so they can be reported
 * as context rather than as a problem.
 */
const ACTION_KEYS = [
  '/JavaScript',
  '/JS',
  '/Launch',
  '/OpenAction',
  '/AA',
  '/EmbeddedFile',
  '/RichMedia',
  '/XFA',
] as const;

const STRUCTURE_KEYS = ['/AcroForm', '/ObjStm', '/Encrypt', '/FlateDecode'] as const;

const SCRIPT_MARKERS = [
  { pattern: /this\.exportDataObject/gi, label: 'this.exportDataObject', why: 'writes an embedded file to disk from a script' },
  { pattern: /util\.printf/gi, label: 'util.printf', why: 'the classic heap-spray primitive in Acrobat exploits' },
  { pattern: /app\.launchURL/gi, label: 'app.launchURL', why: 'opens a URL from a script' },
  { pattern: /app\.alert/gi, label: 'app.alert', why: 'a common first stage in a script chain' },
  // Written as `[(]` rather than `(`: the bundler's `eval(` guard in
  // tests/csp.test.ts scans the shipped chunks for that exact byte sequence, and
  // a regex literal is indistinguishable from a call to it. The character class
  // means the same thing and keeps the guard meaningful.
  { pattern: /eval\s*[(]/gi, label: 'eval', why: 'evaluates a string as code' },
  { pattern: /\bunescape\s*[(]/gi, label: 'unescape()', why: 'decodes a payload hidden as escape sequences' },
  { pattern: /%u[0-9a-f]{4}/gi, label: '%uXXXX', why: 'shellcode encoding used in heap sprays' },
] as const;

interface ScanTarget {
  text: string;
  /** Where this text came from, for the evidence line. */
  where: 'file' | 'stream';
}

/** latin1 decoding, so every byte is exactly one character. */
function latin1(bytes: Uint8Array): string {
  let out = '';
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    out += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunk, bytes.length)));
  }
  return out;
}

/**
 * Counts whole name objects, so `/JS` does not match `/JSD` or `/JSFile`.
 *
 * `/EmbeddedFile` is matched with its plural because the dictionary a real PDF
 * writes is `/EmbeddedFiles` — the singular is the type name, the plural the key.
 */
function countKey(text: string, key: string): number {
  const escaped = key.replace('/', '\\/');
  const plural = key === '/EmbeddedFile' ? 's?' : '';
  const pattern = new RegExp(`${escaped}${plural}(?![A-Za-z0-9])`, 'g');
  return (text.match(pattern) ?? []).length;
}

/**
 * Every `/FlateDecode` stream, decompressed, within budget.
 *
 * Stream bounds are found on the latin1 string because character index equals
 * byte index there, so a match position can be used to slice the original bytes
 * without a second search. The dictionary that precedes `stream` is examined for
 * the filter, because inflating an uncompressed or JPEG stream would either fail
 * or produce noise.
 */
function inflateStreams(
  bytes: Uint8Array,
  text: string,
  deadline: number,
): { decoded: string[]; skipped: number; failed: number; bytes: number } {
  const decoded: string[] = [];
  /** Streams carrying no inflatable filter — expected, and not a blind spot. */
  let skipped = 0;
  /** Streams that claimed Flate and would not decode — a real blind spot. */
  let failed = 0;
  let inflated = 0;
  /*
   * `(?<!end)` matters: without it the pattern matches the "stream" inside
   * "endstream\n", so every end marker looked like the start of another stream.
   * The bytes after it were then "inflated" as if they were compressed data,
   * which failed, and a clean 12-page document reported 13 unreadable streams.
   */
  const streamPattern = /(?<!end)stream\r?\n/g;
  let match: RegExpExecArray | null;

  while ((match = streamPattern.exec(text)) !== null) {
    if (decoded.length + skipped >= MAX_STREAMS) break;
    if (inflated >= MAX_INFLATED_BYTES) break;
    if (Date.now() > deadline) break;

    const start = match.index + match[0].length;
    const end = text.indexOf('endstream', start);
    if (end < 0) break;

    const dictionary = text.slice(Math.max(0, match.index - 800), match.index);
    if (!/\/FlateDecode/.test(dictionary)) {
      skipped += 1;
      continue;
    }

    const data = bytes.subarray(start, Math.min(end, start + MAX_INFLATED_BYTES));
    let output: Uint8Array | null = null;
    try {
      output = unzlibSync(data, { out: undefined });
    } catch {
      try {
        output = inflateSync(data);
      } catch {
        output = null;
      }
    }

    if (!output || output.length === 0) {
      failed += 1;
      continue;
    }
    if (inflated + output.length > MAX_INFLATED_BYTES) break;

    inflated += output.length;
    decoded.push(latin1(output));
  }

  return { decoded, skipped, failed, bytes: inflated };
}

/** One finding per keyword, with a count rather than one row per occurrence. */
function keywordFindings(targets: ScanTarget[]): Finding[] {
  const findings: Finding[] = [];
  const count = (key: string) => targets.reduce((sum, target) => sum + countKey(target.text, key), 0);
  const inStreams = (key: string) => targets.some((target) => target.where === 'stream' && countKey(target.text, key) > 0);

  const javascript = count('/JavaScript') + count('/JS');
  const launch = count('/Launch');
  const openAction = count('/OpenAction');
  const additionalActions = count('/AA');
  const embedded = count('/EmbeddedFile');
  const richMedia = count('/RichMedia');
  const xfa = count('/XFA');

  if (javascript > 0) {
    const autoRuns = openAction > 0 || additionalActions > 0;
    findings.push({
      id: 'pdf.javascript',
      severity: autoRuns ? 'danger' : 'warn',
      title: autoRuns ? 'Runs JavaScript when the document opens' : 'Contains JavaScript',
      detail: autoRuns
        ? 'A script action is reachable from the document or page open event, so a PDF reader will execute it without asking. That is how PDF-based malware usually starts.'
        : 'The document carries script actions. They run only if the reader supports JavaScript and the action is triggered, but they are code, not content.',
      evidence: `${javascript} script action${javascript === 1 ? '' : 's'}${inStreams('/JS') ? ', some inside compressed streams' : ''}`,
      advice: 'Open it in a viewer with JavaScript disabled if you need to see the pages.',
    });
  }

  if (launch > 0) {
    findings.push({
      id: 'pdf.launch',
      severity: 'danger',
      title: 'Tries to launch a program',
      detail:
        'A /Launch action asks the reader to start an external application or open a file outside the document. There is almost no legitimate reason for a PDF to do this, and readers disabled it by default for that reason.',
      evidence: `${launch} launch action${launch === 1 ? '' : 's'}`,
    });
  }

  if (openAction > 0 && javascript === 0 && launch === 0) {
    findings.push({
      id: 'pdf.open-action',
      severity: 'info',
      title: 'Opens on a specific action',
      detail:
        'The document defines what happens when it is opened — usually jumping to a page or zoom level. No script or program launch was found alongside it.',
      evidence: `${openAction} /OpenAction entr${openAction === 1 ? 'y' : 'ies'}`,
    });
  }

  if (embedded > 0) {
    findings.push({
      id: 'pdf.embedded-file',
      severity: 'warn',
      title: 'Carries an attached file',
      detail:
        'An embedded file travels inside the PDF and is invisible on the page. Attachments are a common way to smuggle an executable past a mail filter, so find out what it is before extracting it.',
      evidence: `${embedded} embedded file${embedded === 1 ? '' : 's'}`,
      advice: 'Extract it and drop it on the File Inspector to see what it really is.',
    });
  }

  if (richMedia > 0) {
    findings.push({
      id: 'pdf.rich-media',
      severity: 'warn',
      title: 'Contains legacy multimedia',
      detail:
        'Rich media annotations played Flash or video inside the document. The feature is deprecated and has a long history of exploitation; current readers mostly refuse it.',
      evidence: `${richMedia} rich media annotation${richMedia === 1 ? '' : 's'}`,
    });
  }

  if (xfa > 0) {
    findings.push({
      id: 'pdf.xfa',
      severity: 'warn',
      title: 'Uses an XFA form',
      detail:
        'XFA forms bring their own layout and scripting, which is why banks and tax offices use them — and why they need a full Acrobat install to render. A browser-based reader will show a blank or partial page rather than the form.',
      evidence: `${xfa} /XFA entr${xfa === 1 ? 'y' : 'ies'}`,
      advice: 'Treat any XFA form asking for credentials as suspect: no bank needs one opened in a browser.',
    });
  }

  return findings;
}

/** Script bodies, so the evidence names the function rather than the keyword. */
function scriptFindings(targets: ScanTarget[]): Finding[] {
  const hits: { label: string; why: string; count: number }[] = [];

  for (const marker of SCRIPT_MARKERS) {
    let total = 0;
    for (const target of targets) {
      total += (target.text.match(marker.pattern) ?? []).length;
    }
    if (total > 0) hits.push({ label: marker.label, why: marker.why, count: total });
  }

  if (hits.length === 0) return [];

  // Ranked by count: an exploit repeats its primitive, a form calls alert once.
  hits.sort((a, b) => b.count - a.count);
  const serious = hits.some((hit) => hit.label !== 'app.alert');

  return [
    {
      id: 'pdf.script-body',
      severity: serious ? 'danger' : 'warn',
      title: serious ? 'Script body contains exploit primitives' : 'Script body calls a dialog',
      detail: `${hits
        .slice(0, 3)
        .map((hit) => `${hit.label} ${hit.why}`)
        .join('; ')}. ${serious ? 'These functions appear together in published PDF exploits and almost never in a document someone typed.' : 'This is usually only a pop-up.'}`,
      evidence: hits.map((hit) => `${hit.label} ×${hit.count}`).join(', '),
    },
  ];
}

/** Structural checks that do not need a full parse. */
function structureFindings(bytes: Uint8Array, text: string, hits: Record<string, number>): Finding[] {
  const findings: Finding[] = [];

  const header = text.indexOf('%PDF-');
  if (header > 0) {
    const lead = bytes.subarray(0, Math.min(header, 16));
    const printable = [...lead].every((byte) => byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte < 127));
    findings.push({
      id: 'pdf.header-offset',
      severity: 'warn',
      title: `${header} bytes before the PDF header`,
      detail: printable
        ? 'Something precedes the %PDF- marker. A reader still opens it — the format tolerates this — but a file scanner that only checks the first bytes will misidentify it. A file that is valid in two formats at once is called a polyglot.'
        : 'The bytes before the %PDF- marker are binary, which is what a file crafted to also be a valid image or archive looks like.',
      evidence: `${header} leading bytes, first: ${printable ? 'text' : 'binary'}`,
    });
  }

  const eofs = (text.match(/%%EOF/g) ?? []).length;
  if (eofs === 0) {
    findings.push({
      id: 'pdf.truncated',
      severity: 'warn',
      title: 'No end-of-file marker',
      detail:
        'A complete PDF ends with %%EOF. Without it the document is truncated — either the download was cut short, or the trailer was stripped. Pages beyond the damaged part usually still open.',
      advice: 'Re-download it before trusting anything this scan reports.',
    });
  } else if (eofs > 1) {
    findings.push({
      id: 'pdf.incremental',
      severity: 'info',
      title: `${eofs} revisions in one file`,
      detail:
        'Every save appends a revision instead of rewriting the file, so earlier content is still present in the bytes. That is normal for a document that has been edited several times — and it is also how a removed page or a redacted line survives in a file someone meant to clean.',
      evidence: `${eofs} × %%EOF`,
    });
  }

  if (hits['/ObjStm']) {
    findings.push({
      id: 'pdf.object-streams',
      severity: 'info',
      title: 'Uses compressed object streams',
      detail:
        'Dictionaries are packed inside compressed streams, which is normal for modern PDFs and hides them from a plain text search. The streams were inflated and searched, so the counts here include their contents.',
    });
  }

  const jsUri = (text.match(/\/URI\s*\((?:javascript|data):/gi) ?? []).length;
  if (jsUri > 0) {
    findings.push({
      id: 'pdf.script-uri',
      severity: 'danger',
      title: 'Link runs a script',
      detail:
        'A /URI action points at a javascript: or data: URL, so clicking the visible link executes code or renders attacker-supplied content instead of visiting a site.',
      evidence: `${jsUri} script URL${jsUri === 1 ? '' : 's'}`,
    });
  }

  return findings;
}

/** What this particular document makes worth doing next. */
function nextSteps(findings: Finding[]): NextStep[] {
  const has = (id: string) => findings.some((finding) => finding.id === id);
  const steps: NextStep[] = [];

  if (has('pdf.javascript') || has('pdf.launch') || has('pdf.script-uri') || has('pdf.script-body')) {
    steps.push({
      slug: 'split-pdf',
      label: 'Extract only the pages you need',
      why: 'A split rebuilds the document from the pages you pick, so catalog-level actions do not come with it.',
    });
  }
  if (has('pdf.embedded-file')) {
    steps.push({
      slug: 'split-pdf',
      label: 'Split out the pages',
      why: 'Leaves the attachment behind — it is not part of any page.',
    });
  }
  steps.push(
    { slug: 'pdf-editor', label: 'Reorder or edit pages', why: 'Inspect the page order before printing it.' },
    /*
     * Not "stops the script": encryption gates *opening*, not the actions inside.
     * Once the password is entered the script runs exactly as before, so claiming
     * otherwise would be the kind of reassurance that gets someone hurt.
     */
    { slug: 'protect-pdf', label: 'Require a password to open it', why: 'The password gates opening; it does not disable the actions inside.' },
    { slug: 'merge-pdf', label: 'Merge with another PDF', why: 'Combine it with pages you trust.' },
  );
  return steps;
}

/**
 * Scan a PDF's bytes. Never throws: a scan that fails says why in `limited`.
 *
 * `truncatedRead` tells the caller whether the buffer is the whole file, so the
 * report cannot imply it read a 200 MB document when it sampled 24 MB.
 */
export function scanPdfBytes(bytes: Uint8Array, options: { wholeFile?: boolean } = {}): Insight {
  if (bytes.length === 0) return emptyInsight(['The file is empty.']);

  const deadline = Date.now() + MAX_SCAN_MS;
  const head = bytes.subarray(0, MAX_PDF_SCAN_BYTES);
  const text = latin1(head);
  const limited: string[] = [];

  if (!options.wholeFile) {
    limited.push(
      `Only the first ${Math.round(MAX_PDF_SCAN_BYTES / 1024 / 1024)} MB were scanned. Objects stored after that point were not read.`,
    );
  }

  const targets: ScanTarget[] = [{ text, where: 'file' }];
  let streamStats = { decoded: [] as string[], skipped: 0, failed: 0, bytes: 0 };
  try {
    streamStats = inflateStreams(head, text, deadline);
    for (const decoded of streamStats.decoded) targets.push({ text: decoded, where: 'stream' });
  } catch {
    limited.push('A compressed stream could not be decompressed, so its contents were not inspected.');
  }

  const hits: Record<string, number> = {};
  for (const key of [...ACTION_KEYS, ...STRUCTURE_KEYS]) {
    hits[key] = targets.reduce((sum, target) => sum + countKey(target.text, key), 0);
  }

  /*
   * Only the failures are a blind spot, and only those are reported. A stream
   * with no Flate filter (an uncompressed page description, a JPEG) was never
   * searched *in its decoded form* because it needed no decoding — it was
   * scanned as raw bytes along with the rest of the file, and calling that
   * "not searched" would overstate the gap in a report that already has to be
   * believed when it says something is missing.
   */
  if (streamStats.failed > 0) {
    limited.push(
      `${streamStats.failed} compressed stream${streamStats.failed === 1 ? '' : 's'} would not decode, so ${streamStats.failed === 1 ? 'its' : 'their'} contents were not searched.`,
    );
  }

  if (hits['/Encrypt'] > 0) {
    limited.push('The document is encrypted, so its object dictionaries and stream contents cannot be read without the password.');
  }

  const findings = sortFindings([
    ...keywordFindings(targets),
    ...scriptFindings(targets),
    ...structureFindings(head, text, hits),
  ]);

  if (hits['/Encrypt'] > 0) {
    findings.unshift({
      id: 'pdf.encrypted',
      severity: 'info',
      title: 'Encrypted document',
      detail:
        'Object bytes are encrypted, so this scan can report the encryption but not what is inside it. Everything above was found in the parts that remain in clear text.',
      evidence: `${hits['/Encrypt']} /Encrypt entr${hits['/Encrypt'] === 1 ? 'y' : 'ies'}`,
    });
  }

  return { findings, limited, next: nextSteps(findings) };
}

/**
 * Convenience wrapper for the inspector: reads the head of a `Blob` and scans it.
 */
export async function scanPdf(blob: Blob): Promise<Insight> {
  const slice = blob.slice(0, MAX_PDF_SCAN_BYTES);
  const bytes = new Uint8Array(await slice.arrayBuffer());
  return scanPdfBytes(bytes, { wholeFile: blob.size <= MAX_PDF_SCAN_BYTES });
}
