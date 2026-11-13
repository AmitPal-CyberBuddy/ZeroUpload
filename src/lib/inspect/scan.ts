/**
 * One entry point: bytes and a name in, a ranked report out.
 *
 * Each scanner lives in its own module because each one is a different question
 * over a different structure. This file decides which of them apply and merges
 * their output, so a caller — the inspector today, the workspace or a future
 * media tool later — never branches on file type itself.
 *
 * What it deliberately does **not** do:
 *
 *  - **It never claims safety.** `findings.length === 0` means "nothing in the
 *    bytes read looked like the things this scans for", and the report says so in
 *    those words. A byte scan is not an antivirus and must not read like one.
 *  - **It never guesses at the type from the extension when the bytes disagree.**
 *    The family comes from the signature first, so a `.txt` that is really a PDF
 *    is scanned as a PDF and reported as a mismatch.
 *  - **It never throws.** A scanner that fails contributes a `limited` line; the
 *    rest of the report still arrives, because "we could not read this part" is
 *    more useful than an error page.
 */
import type { FileFamily } from '../capabilities/formats';
import { type Finding, type Insight, type NextStep } from './findings';
import { scanPdf, scanPdfBytes } from './pdf';
import { scanArchiveBytes } from './archive';
import { scanImageBytes } from './image';
import { scanTextBytes, type TextScanOptions } from './text';

/** How much of a file each scanner is willing to read. */
export const SCAN_LIMITS = {
  pdf: 24 * 1024 * 1024,
  /** Enough for the central directory of the largest archive we accept. */
  archive: 6 * 1024 * 1024,
  image: 512 * 1024,
  text: 1024 * 1024,
} as const;

export interface ScanInput {
  /** The file's name. Used for extension-level facts, never as the type. */
  name: string;
  size: number;
  /** The family the caller already detected (see `detectFile`). */
  family: FileFamily;
  /** The declared MIME type, when the caller has one. */
  declaredType?: string;
  /**
   * Reads up to `limit` bytes from the start of the file. The scanner decides the
   * limit, and a 200 MB video therefore costs one 512 KB read rather than an
   * array buffer the size of the file.
   */
  readHead: (limit: number) => Promise<Uint8Array>;
  /**
   * Reads up to `limit` bytes from the end. Only archives need this — their
   * directory lives at the end — and it is optional so a caller that only has a
   * prefix (a worker message, a test) still works.
   */
  readTail?: (limit: number) => Promise<Uint8Array>;
  /** The decoded dimensions, when the caller already decoded the image. */
  imageSize?: { width: number; height: number };
}

/**
 * A finding that applies to the *name* rather than the bytes, so it is produced
 * once here rather than in four scanners.
 */
function nameFindings(name: string, declaredType: string | undefined, family: FileFamily): Finding[] {
  const findings: Finding[] = [];
  const lower = name.toLowerCase();
  const parts = lower.split('.');
  const last = parts[parts.length - 1] ?? '';

  // Two extensions where the first is a document: invoice.pdf.exe.
  if (parts.length >= 3) {
    const previous = parts[parts.length - 2];
    if (['exe', 'scr', 'bat', 'cmd', 'com', 'pif', 'js', 'vbs', 'lnk', 'dll'].includes(last)) {
      findings.push({
        id: 'name.double-extension',
        severity: 'danger',
        title: 'Doubly-named executable',
        detail: `The name ends in .${last}, but Windows hides the last extension by default, so this appears as ".${previous}" to the person opening it. That is the standard disguise for a mail attachment that runs when double-clicked.`,
        evidence: `.${previous}.${last}`,
      });
    }
  }

  // A right-to-left override or zero-width run hides the real extension.
  if (/[\u202a-\u202e\u2066-\u2069]/.test(name)) {
    findings.push({
      id: 'name.bidi-control',
      severity: 'danger',
      title: 'Name contains a text-direction override',
      detail:
        'A Unicode bidirectional control character is embedded in the file name. Its only purpose here is to display the name in a different order than the bytes store it, so "annexe.exe" can read as "annexe.pdf".',
      evidence: 'U+202x / U+206x control character',
    });
  }

  if (/\u0000/.test(name)) {
    findings.push({
      id: 'name.null-byte',
      severity: 'warn',
      title: 'Name contains a null byte',
      detail: 'A NUL in a path truncates it in C-based tools: the same name can open one file to the caller and name another in a log. No file a person creates has one.',
    });
  }

  if (family === 'unknown' && last) {
    findings.push({
      id: 'name.unrecognised',
      severity: 'info',
      title: `“.${last}” is not a type this site knows`,
      detail: 'The signature was not recognised and the extension is not one of the handled formats. The facts below are honest about what could and could not be read — this is not a warning that the file is harmful, only that little can be said about it.',
    });
  } else if (!last && !declaredType) {
    findings.push({
      id: 'name.no-extension',
      severity: 'info',
      title: 'No extension',
      detail: 'The file has no extension at all, so nothing can be inferred from the name. The detected type comes from the first bytes.',
    });
  }

  return findings;
}

/** Merges the steps from every scanner, first claim on a slug winning. */
function mergeNext(insights: Insight[], extra: NextStep[]): NextStep[] {
  const seen = new Set<string>();
  const steps: NextStep[] = [];
  for (const step of [...insights.flatMap((insight) => insight.next), ...extra]) {
    if (seen.has(step.slug)) continue;
    seen.add(step.slug);
    steps.push(step);
  }
  return steps;
}

/**
 * Scans a file according to the family the caller detected.
 *
 * `read` is called at most once per scanner and never for a scanner that does not
 * apply, so inspecting a 200 MB video reads 512 KB rather than the whole thing.
 */
export async function scanFile(input: ScanInput): Promise<Insight> {
  const declaredType = input.declaredType;
  const insights: Insight[] = [];
  const extraFindings = nameFindings(input.name, declaredType, input.family);

  const run = async <T>(label: string, task: () => Promise<T>): Promise<T | null> => {
    try {
      return await task();
    } catch {
      insights.push({ findings: [], limited: [`The ${label} scan could not complete, so its checks did not run.`], next: [] });
      return null;
    }
  };

  if (input.family === 'pdf') {
    const result = await run('PDF', async () =>
      scanPdfBytes(await input.readHead(SCAN_LIMITS.pdf), { wholeFile: input.size <= SCAN_LIMITS.pdf }),
    );
    if (result) insights.push(result);
  } else if (input.family === 'archive' || input.family === 'spreadsheet' || input.family === 'office') {
    const result = await run('archive', async () => {
      // The directory is at the end; a small archive is read whole so the
      // directory offsets still line up with the buffer.
      const bytes = input.size <= SCAN_LIMITS.archive
        ? await input.readHead(SCAN_LIMITS.archive)
        : (await input.readTail?.(SCAN_LIMITS.archive)) ?? (await input.readHead(SCAN_LIMITS.archive));
      return scanArchiveBytes(bytes, { wholeFile: input.size <= SCAN_LIMITS.archive });
    });
    if (result) {
      insights.push(result.insight);
      if (result.unreadable) {
        insights.push({ findings: [], limited: [result.unreadable], next: [] });
      }
    }
  } else if (input.family === 'image') {
    const result = await run('image', async () => scanImageBytes(await input.readHead(SCAN_LIMITS.image), input.imageSize));
    if (result) insights.push(result);
  } else if (input.family === 'text') {
    const options: TextScanOptions = { name: input.name, type: declaredType };
    const result = await run('text', async () => scanTextBytes(await input.readHead(SCAN_LIMITS.text), options));
    if (result) insights.push(result);
  } else {
    // Unknown or media: read the head and at least say whether it is text.
    const head = await input.readHead(SCAN_LIMITS.image).catch(() => null);
    if (head) {
      const looksText = !head.some((byte) => byte < 9 || (byte > 13 && byte < 32));
      if (looksText) {
        insights.push(
          scanTextBytes(head, { name: input.name, type: declaredType }),
        );
      } else {
        insights.push({
          findings: [
            {
              id: 'unknown.binary',
              severity: 'info',
              title: 'Binary file, no deeper inspection',
              detail:
                'The bytes are not text and do not match a format this site handles, so there is no structure to walk. The hash and the detected type are still reliable; nothing else here claims to be.',
            },
          ],
          limited: ['No format-specific checks apply to this file.'],
          next: [],
        });
      }
    }
  }

  const findings = [...extraFindings, ...insights.flatMap((insight) => insight.findings)];
  const limited = insights.flatMap((insight) => insight.limited);

  if (findings.length === 0 && limited.length === 0) {
    limited.push('Nothing in the bytes scanned matched a known hazard pattern. This is a structural check, not a security verdict.');
  }

  const fallback: NextStep[] = [{ slug: 'create-zip', label: 'Bundle it into a ZIP', why: 'One file to send instead of several.' }];

  return {
    findings,
    limited,
    next: mergeNext(insights, fallback),
  };
}

/** Re-exported so a caller holding a Blob does not need to know the module split. */
export { scanPdf, scanPdfBytes, scanArchiveBytes, scanImageBytes, scanTextBytes };
