/**
 * What a text file is, beyond the characters in it.
 *
 * A dropped `.txt` used to get one fact — a line count. The questions a person
 * actually has are different: is this really text, or a binary someone renamed;
 * is it a JSON document, and if so how deeply is it nested; does it contain
 * markup that runs when opened in a browser; and is the line ending mixed, which
 * is why the file renders as one long line in some tools.
 *
 * Two of those are security facts and three are compatibility facts, and they
 * share one report. Everything here is a string operation — no parsing library,
 * no DOM — so it behaves the same in the browser and in the test suite.
 */
import { type Finding, type Insight, type NextStep, sortFindings } from './findings';

/** Longest run of text scanned for markup; beyond this, only the head is read. */
const MARKUP_SCAN_LIMIT = 1024 * 1024;

const BOMS: { bytes: number[]; label: string; encoding: string }[] = [
  { bytes: [0xef, 0xbb, 0xbf], label: 'UTF-8 BOM', encoding: 'UTF-8 with BOM' },
  { bytes: [0xff, 0xfe], label: 'UTF-16 LE BOM', encoding: 'UTF-16 LE' },
  { bytes: [0xfe, 0xff], label: 'UTF-16 BE BOM', encoding: 'UTF-16 BE' },
];

/** Binary formats that are most often renamed to `.txt` to get past a filter. */
const RENAMED_BINARIES: { bytes: number[]; label: string; offset?: number }[] = [
  { bytes: [0x50, 0x4b, 0x03, 0x04], label: 'a ZIP archive' },
  { bytes: [0x25, 0x50, 0x44, 0x46], label: 'a PDF' },
  { bytes: [0x7f, 0x45, 0x4c, 0x46], label: 'an ELF executable' },
  { bytes: [0x4d, 0x5a], label: 'a Windows executable' },
  { bytes: [0x89, 0x50, 0x4e, 0x47], label: 'a PNG image' },
  { bytes: [0xff, 0xd8, 0xff], label: 'a JPEG image' },
  { bytes: [0x1f, 0x8b], label: 'a gzip stream' },
];

export interface TextFacts {
  /** Bytes read as text. */
  characters: number;
  lines: number;
  /** Line-ending styles present: `lf`, `crlf`, `cr`. */
  endings: ('lf' | 'crlf' | 'cr')[];
  encoding?: string;
  /** Set when the head is JSON that parses. */
  json?: { valid: true; depth: number; keys: number; arrays: number; duplicateKeys: string[] };
  /** Set when the head looks like JSON but does not parse. */
  jsonError?: string;
  /** Markup that a browser or an office application would act on. */
  markup: { tag: string; count: number }[];
  /** Control characters, which binary data has and prose does not. */
  controlRatio: number;
}

function detectBom(bytes: Uint8Array): (typeof BOMS)[number] | undefined {
  return BOMS.find((bom) => bom.bytes.every((byte, index) => bytes[index] === byte));
}

function detectRenamedBinary(bytes: Uint8Array): string | undefined {
  const candidate = RENAMED_BINARIES.find((entry) =>
    entry.bytes.every((byte, index) => bytes[(entry.offset ?? 0) + index] === byte),
  );
  return candidate?.label;
}

/** How many bytes out of the first 4096 are control characters (not tab/newline/CR). */
function controlRatio(bytes: Uint8Array): number {
  const sample = bytes.subarray(0, Math.min(4096, bytes.length));
  if (sample.length === 0) return 0;
  let control = 0;
  for (const byte of sample) {
    if (byte < 9 || (byte > 13 && byte < 32)) control += 1;
  }
  return control / sample.length;
}

/**
 * A bounded structural walk of JSON, which is where the interesting facts are:
 * depth (a 20,000-deep array is a stack-overflow attempt on some parsers), and
 * duplicate keys, which `JSON.parse` silently resolves last-wins — the mechanism
 * behind several parser-differential attacks, and a plain bug in most configs.
 */
export function inspectJsonStructure(text: string): { valid: true; depth: number; keys: number; arrays: number; duplicateKeys: string[] } | { valid: false; error: string } {
  let index = 0;
  let depth = 0;
  let maximumDepth = 0;
  let keys = 0;
  let arrays = 0;
  const duplicates = new Set<string>();

  const fail = (message: string) => ({ valid: false as const, error: `${message} at character ${index.toLocaleString()}` });
  const skipWhitespace = () => {
    while (index < text.length && (text[index] === ' ' || text[index] === '\n' || text[index] === '\r' || text[index] === '\t')) {
      index += 1;
    }
  };

  const readString = (): string | null => {
    if (text[index] !== '"') return null;
    index += 1;
    let out = '';
    while (index < text.length) {
      const char = text[index];
      if (char === '"') {
        index += 1;
        return out;
      }
      if (char === '\\') {
        out += text.slice(index, index + 2);
        index += 2;
        continue;
      }
      out += char;
      index += 1;
    }
    return null;
  };

  const walk = (): string | null => {
    skipWhitespace();
    if (index >= text.length) return 'Unexpected end of document';

    const char = text[index];
    if (char === '{') {
      index += 1;
      depth += 1;
      maximumDepth = Math.max(maximumDepth, depth);
      const seen = new Set<string>();
      skipWhitespace();
      if (text[index] === '}') {
        index += 1;
        depth -= 1;
        return null;
      }
      for (;;) {
        skipWhitespace();
        const key = readString();
        if (key === null) return 'Expected a quoted key';
        keys += 1;
        if (seen.has(key) && duplicates.size < 12) duplicates.add(key);
        seen.add(key);
        skipWhitespace();
        if (text[index] !== ':') return 'Expected ":"';
        index += 1;
        const problem = walk();
        if (problem) return problem;
        skipWhitespace();
        if (text[index] === ',') {
          index += 1;
          continue;
        }
        if (text[index] === '}') {
          index += 1;
          depth -= 1;
          return null;
        }
        return 'Expected "," or "}"';
      }
    }
    if (char === '[') {
      index += 1;
      depth += 1;
      arrays += 1;
      maximumDepth = Math.max(maximumDepth, depth);
      skipWhitespace();
      if (text[index] === ']') {
        index += 1;
        depth -= 1;
        return null;
      }
      for (;;) {
        const problem = walk();
        if (problem) return problem;
        skipWhitespace();
        if (text[index] === ',') {
          index += 1;
          continue;
        }
        if (text[index] === ']') {
          index += 1;
          depth -= 1;
          return null;
        }
        return 'Expected "," or "]"';
      }
    }
    if (char === '"') return readString() === null ? 'Unterminated string' : null;

    // Literal or number: consume until a structural character.
    const start = index;
    while (index < text.length && !/[,\]}\s:]/.test(text[index])) index += 1;
    if (index === start) return `Unexpected character “${char}”`;
    const literal = text.slice(start, index);
    if (!/^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/.test(literal) && !['true', 'false', 'null'].includes(literal)) {
      return `Unexpected token ${literal.slice(0, 12)}`;
    }
    return null;
  };

  const problem = walk();
  // Every failure names a position: "unexpected character" on its own makes the
  // reader hunt for it in a 4,000-line document.
  if (problem) {
    const positioned = /character \d/.test(problem);
    return { valid: false, error: positioned ? problem : `${problem} at character ${index.toLocaleString()}` };
  }
  skipWhitespace();
  if (index < text.length) return fail('Trailing content after the root value');
  return { valid: true, depth: maximumDepth, keys, arrays, duplicateKeys: [...duplicates] };
}

/** Tags worth counting: the first three are executable or load-bearing, the rest are context. */
const MARKUP_TAGS = [
  { name: 'script', pattern: /<script\b/gi },
  { name: 'iframe', pattern: /<iframe\b/gi },
  { name: 'object', pattern: /<(object|embed)\b/gi },
  { name: 'form', pattern: /<form\b/gi },
  { name: 'img', pattern: /<img\b/gi },
  { name: 'svg', pattern: /<svg\b/gi },
];

const EVENT_ATTRIBUTE = /\son[a-z]+\s*=\s*["']?/gi;
const REMOTE_SCHEME = /\bhttps?:\/\//gi;

export interface TextScanOptions {
  /** The file name, so an `.html` that was dropped as text is judged as markup. */
  name?: string;
  /** Declared or sniffed MIME type. */
  type?: string;
}

export function scanTextBytes(bytes: Uint8Array, options: TextScanOptions = {}): Insight {
  const findings: Finding[] = [];
  const limited: string[] = [];
  const bom = detectBom(bytes);

  const renamed = detectRenamedBinary(bytes);
  if (renamed) {
    findings.push({
      id: 'text.renamed-binary',
      severity: 'danger',
      title: `This is not text — it is ${renamed}`,
      detail:
        'The file starts with the signature of a binary format, so the name and the declared type both lie about it. Opened in an editor it is noise; opened in the application that owns the real format, it is that file.',
      evidence: renamed,
      advice: 'Drop it on the File Inspector to have it reported by what it is.',
    });
  }

  const control = controlRatio(bytes);
  if (!renamed && control > 0.25) {
    findings.push({
      id: 'text.binary',
      severity: 'warn',
      title: 'Looks like binary data',
      detail: `${(control * 100).toFixed(0)}% of the first ${Math.min(4096, bytes.length).toLocaleString()} bytes are control characters, which prose does not contain. Every text operation here would produce a garbled result.`,
      evidence: `${(control * 100).toFixed(0)}% control bytes`,
    });
  }

  const text = new TextDecoder(bom?.encoding.startsWith('UTF-16') ? bom.encoding : 'utf-8', { fatal: false })
    .decode(bytes.subarray(0, MARKUP_SCAN_LIMIT));

  if (bytes.length > MARKUP_SCAN_LIMIT) {
    limited.push(`Only the first ${Math.round(MARKUP_SCAN_LIMIT / 1024 / 1024)} MB were searched for markup and JSON structure.`);
  }

  const endings: TextFacts['endings'] = [];
  if (/\r\n/.test(text)) endings.push('crlf');
  if (/\n/.test(text.replace(/\r\n/g, ''))) endings.push('lf');
  if (/\r(?!\n)/.test(text)) endings.push('cr');

  /* ---- Markup ---- */
  const segment = text.slice(0, MARKUP_SCAN_LIMIT);
  const isMarkup = /^\s*<(!doctype|html|svg|\?xml)/i.test(segment) || /\.(html?|xhtml|svg|xml)$/i.test(options.name ?? '');
  const markupHits: { tag: string; count: number }[] = [];
  for (const tag of MARKUP_TAGS) {
    const count = (segment.match(tag.pattern) ?? []).length;
    if (count > 0) markupHits.push({ tag: tag.name, count });
  }
  const events = (segment.match(EVENT_ATTRIBUTE) ?? []).length;

  if (isMarkup && (markupHits.some((hit) => hit.tag === 'script') || events > 0)) {
    const scriptCount = markupHits.find((hit) => hit.tag === 'script')?.count ?? 0;
    findings.push({
      id: 'text.markup-script',
      severity: 'danger',
      title: 'Executable markup',
      detail: `This file contains ${scriptCount} script tag${scriptCount === 1 ? '' : 's'}${events > 0 ? ` and ${events} inline event handler${events === 1 ? '' : 's'}` : ''}. Opened in a browser it runs that code with the page's access to your files; opened as text it does nothing. The danger is entirely in which application is used.`,
      evidence: [scriptCount ? `script ×${scriptCount}` : '', events ? `on* handler ×${events}` : ''].filter(Boolean).join(', '),
      advice: 'Read it here, never by double-clicking it.',
    });
  } else if (markupHits.length > 0 && isMarkup) {
    findings.push({
      id: 'text.markup',
      severity: 'info',
      title: 'Markup document',
      detail: `Recognised as markup rather than plain text: ${markupHits.map((hit) => `<${hit.tag}>`).join(', ')}. No script tag or event handler was found.`,
      evidence: `${markupHits.reduce((sum, hit) => sum + hit.count, 0)} tags`,
    });
  }

  const remote = (segment.match(REMOTE_SCHEME) ?? []).length;
  if (remote > 0 && (isMarkup || /\.(md|txt|html?)$/i.test(options.name ?? ''))) {
    findings.push({
      id: 'text.remote-reference',
      severity: 'info',
      title: `${remote} web address${remote === 1 ? '' : 'es'} referenced`,
      detail: 'Nothing here fetches anything — the file was not opened as a document and no request is made on your behalf. The note is here because a document that references URLs can be made to load them when a different application opens it, which is how tracking pixels work.',
      evidence: `${remote} http(s) reference${remote === 1 ? '' : 's'}`,
    });
  }

  /* ---- JSON ---- */
  let json: TextFacts['json'];
  let jsonError: string | undefined;
  const looksJson =
    /^\s*[[{]/.test(segment) ||
    /\.json$/i.test(options.name ?? '') ||
    (options.type ?? '').includes('json');

  if (looksJson && segment.trim().length > 0) {
    const result = inspectJsonStructure(segment);
    if (result.valid) {
      json = result;
      if (result.duplicateKeys.length > 0) {
        findings.push({
          id: 'text.json-duplicate-keys',
          severity: 'warn',
          title: 'Duplicate keys in the same object',
          detail: 'JSON.parse keeps the last value and silently drops the rest, while some other parsers keep the first. Two readers of this file can therefore see different data — which is a bug in a config and a known attack on validators.',
          evidence: result.duplicateKeys.slice(0, 4).join(', '),
        });
      }
      if (result.depth >= 64) {
        findings.push({
          id: 'text.json-depth',
          severity: 'warn',
          title: `Nested ${result.depth} levels deep`,
          detail: 'Deeply nested JSON overflows the stack in recursive parsers. The formatter here uses an explicit stack, so it will open — but a server-side parser may refuse it or crash.',
          evidence: `depth ${result.depth}`,
        });
      }
    } else {
      jsonError = result.error;
      findings.push({
        id: 'text.json-invalid',
        severity: 'warn',
        title: 'Claims to be JSON but does not parse',
        detail: `${result.error}. Either the file is truncated, or it is not JSON — the formatter will show the exact position.`,
        evidence: result.error,
      });
    }
  }

  if (bom) {
    findings.push({
      id: 'text.bom',
      severity: 'info',
      title: `${bom.label} present`,
      detail: `The file starts with a byte-order mark (${bom.label}), so its encoding is ${bom.encoding}. Most tools cope, but shell scripts and some parsers treat the three bytes as content, which is why they fail with "command not found" on a file that looks perfect.`,
      evidence: bom.bytes.map((byte) => byte.toString(16).padStart(2, '0')).join(' '),
    });
  }

  if (endings.length > 1) {
    findings.push({
      id: 'text.mixed-endings',
      severity: 'info',
      title: `Mixed line endings (${endings.join(' + ')})`,
      detail: 'The file mixes two conventions, usually because it was edited on two platforms. Some editors show it as one long line, and a diff shows every line as changed.',
      evidence: endings.join(' + '),
    });
  }

  const veryLongLine = text.split(/\r\n|\r|\n/).reduce((longest, line) => Math.max(longest, line.length), 0);
  if (veryLongLine > 20_000 && endings.length > 0) {
    findings.push({
      id: 'text.long-line',
      severity: 'info',
      title: `One line is ${veryLongLine.toLocaleString()} characters`,
      detail: 'A single line that long is usually a minified bundle or a data blob rather than prose. Editors and diffs degrade badly on it.',
      evidence: `${veryLongLine.toLocaleString()} characters`,
    });
  }

  /* ---- Next steps, narrowed by what was found ---- */
  const next: NextStep[] = [];
  if (json && json.valid) {
    next.push({ slug: 'json-formatter', label: 'Format this JSON', why: `${json.keys.toLocaleString()} keys across ${json.arrays.toLocaleString()} arrays — reformatting makes the structure visible.` });
  } else if (jsonError) {
    next.push({ slug: 'json-formatter', label: 'Find the JSON error', why: 'Points the caret at the exact character that breaks it.' });
  }
  if (markupHits.some((hit) => hit.tag === 'script')) {
    next.push({ slug: 'base64', label: 'Encode it before sharing', why: 'Neutralises the markup: base64 is data, not a document any application will run.' });
  }
  if (renamed) {
    next.push({ slug: 'file-inspector', label: 'Confirm the real type', why: 'Reported by signature instead of by name.' });
  }
  next.push(
    { slug: 'base64', label: 'Encode this file as Base64', why: 'Useful for pasting into a config or an API payload.' },
    { slug: 'hash-generator', label: 'Take a SHA-256 digest', why: 'A stable fingerprint to compare two copies.' },
    { slug: 'create-zip', label: 'Bundle it into a ZIP', why: 'One file to send instead of several.' },
  );

  const seen = new Set<string>();
  return {
    findings: sortFindings(findings),
    limited,
    next: next.filter((step) => (seen.has(step.slug) ? false : (seen.add(step.slug), true))),
  };
}

/** Exported for the inspector's facts table, so counts are computed once. */
export function textFacts(bytes: Uint8Array): TextFacts {
  const bom = detectBom(bytes);
  const text = new TextDecoder().decode(bytes.subarray(0, MARKUP_SCAN_LIMIT));
  const endings: TextFacts['endings'] = [];
  if (/\r\n/.test(text)) endings.push('crlf');
  if (/\n/.test(text.replace(/\r\n/g, ''))) endings.push('lf');
  if (/\r(?!\n)/.test(text)) endings.push('cr');
  const json = /^\s*[[{]/.test(text) ? inspectJsonStructure(text) : null;
  return {
    characters: text.length,
    lines: text.length === 0 ? 0 : text.split(/\r\n|\r|\n/).length,
    endings,
    encoding: bom?.encoding ?? 'UTF-8',
    json: json && json.valid ? json : undefined,
    jsonError: json && !json.valid ? json.error : undefined,
    markup: MARKUP_TAGS.map((tag) => ({ tag: tag.name, count: (text.match(tag.pattern) ?? []).length })).filter((hit) => hit.count > 0),
    controlRatio: controlRatio(bytes),
  };
}
