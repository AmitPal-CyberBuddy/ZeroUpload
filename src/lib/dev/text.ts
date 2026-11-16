/** Encoding helpers for the developer utilities. Pure, no DOM. */

export interface JsonFormatResult {
  output: string;
  error?: { message: string; line?: number; column?: number };
  stats: { nodes: number; depth: number; keys: number; arrays: number };
  /**
   * Things a valid document can still be wrong about, found while formatting.
   * Separate from `error` because they do not stop the format — they are what
   * the output pane should say *beside* the result, not instead of it.
   */
  notes?: JsonNote[];
}

export interface JsonNote {
  id: 'duplicate-keys' | 'deep-nesting' | 'large-document' | 'scalar-root';
  tone: 'warn' | 'default';
  message: string;
}

const ERROR_POSITION = /position (\d+)/i;
const ERROR_LINE = /line (\d+)/i;
const ERROR_COLUMN = /column (\d+)/i;

function locate(text: string, position: number): { line: number; column: number } {
  let line = 1;
  let lastBreak = -1;
  for (let i = 0; i < position && i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) {
      line += 1;
      lastBreak = i;
    }
  }
  return { line, column: position - lastBreak };
}

/**
 * Notes about a document that parses.
 *
 * `JSON.parse` silently keeps the last of two identical keys, so a config with a
 * duplicate looks correct to every reader and behaves according to whichever
 * value the parser happened to keep. That is worth saying out loud while the
 * person is looking at the formatted text.
 */
function notesFor(parsed: unknown, input: string, stats: JsonFormatResult['stats']): JsonNote[] {
  const notes: JsonNote[] = [];

  const duplicates = new Set<string>();
  const scan = (value: unknown, path: string) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => scan(item, `${path}[${index}]`));
      return;
    }
    if (!value || typeof value !== 'object') return;
    const entries = Object.entries(value as Record<string, unknown>);
    const seen = new Set<string>();
    for (const [key] of entries) {
      if (seen.has(key) && duplicates.size < 5) duplicates.add(path ? `${path}.${key}` : key);
      seen.add(key);
    }
    for (const [key, item] of entries) scan(item, path ? `${path}.${key}` : key);
  };
  scan(parsed, '');

  /*
   * `Object.entries` cannot see a duplicate at all, so the raw text is counted
   * instead: `"key":` occurring twice inside one object literal. The count is a
   * lower bound, and the note says so rather than implying precision.
   */
  if (duplicates.size === 0) {
    const keysInText = [...input.matchAll(/"((?:[^"\\]|\\.)*)"\s*:/g)].map((match) => match[1]);
    const counts = new Map<string, number>();
    for (const key of keysInText) counts.set(key, (counts.get(key) ?? 0) + 1);
    const repeated = [...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key);
    if (repeated.length > 0) {
      notes.push({
        id: 'duplicate-keys',
        tone: 'warn',
        message: `“${repeated.slice(0, 3).join('”, “')}” appear${repeated.length === 1 ? 's' : ''} more than once in the text. If two are in the same object, JSON.parse keeps the last and drops the rest — check the formatted output shows what you meant.`,
      });
    }
  } else {
    notes.push({
      id: 'duplicate-keys',
      tone: 'warn',
      message: `Duplicate key${duplicates.size === 1 ? '' : 's'} at ${[...duplicates].join(', ')} — only the last value survives.`,
    });
  }

  if (stats.depth >= 40) {
    notes.push({
      id: 'deep-nesting',
      tone: 'warn',
      message: `${stats.depth} levels deep. Recursive parsers on a server can overflow on this; the formatter here does not.`,
    });
  }

  if (stats.nodes > 100_000) {
    notes.push({
      id: 'large-document',
      tone: 'default',
      message: `${stats.nodes.toLocaleString()} nodes. Editing this in the pane will get slow — download it and use an editor.`,
    });
  }

  if (parsed === null || typeof parsed !== 'object') {
    notes.push({
      id: 'scalar-root',
      tone: 'default',
      message: `The root is a ${parsed === null ? 'null' : typeof parsed}, not an object or array. Valid JSON, but most APIs expect an object at the top.`,
    });
  }

  return notes;
}

function measure(value: unknown): { nodes: number; depth: number; keys: number; arrays: number } {
  let nodes = 0;
  let keys = 0;
  let arrays = 0;
  let depth = 0;
  const stack: { value: unknown; level: number }[] = [{ value, level: 1 }];
  while (stack.length) {
    const { value: current, level } = stack.pop()!;
    nodes += 1;
    depth = Math.max(depth, level);
    if (Array.isArray(current)) {
      arrays += 1;
      for (const item of current) stack.push({ value: item, level: level + 1 });
    } else if (current && typeof current === 'object') {
      const entries = Object.entries(current as Record<string, unknown>);
      keys += entries.length;
      for (const [, item] of entries) stack.push({ value: item, level: level + 1 });
    }
  }
  return { nodes: Math.max(0, nodes - 1), depth, keys, arrays };
}

export function formatJson(
  input: string,
  options: { indent: number | 'tab'; minify: boolean; sortKeys: boolean },
): JsonFormatResult {
  const empty = { nodes: 0, depth: 0, keys: 0, arrays: 0 };
  if (!input.trim()) return { output: '', stats: empty };

  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch (error) {
    const message = (error as Error).message;
    let line: number | undefined;
    let column: number | undefined;
    const posMatch = ERROR_POSITION.exec(message);
    const lineMatch = ERROR_LINE.exec(message);
    if (posMatch) {
      const pos = locate(input, Number(posMatch[1]));
      line = pos.line;
      column = pos.column;
    } else if (/end of (json )?input/i.test(message)) {
      // V8 omits a position for truncated documents; point at the end instead.
      const pos = locate(input, input.length);
      line = pos.line;
      column = pos.column;
    } else if (lineMatch) {
      line = Number(lineMatch[1]);
      const col = ERROR_COLUMN.exec(message);
      if (col) column = Number(col[1]);
    }
    return { output: '', error: { message, line, column }, stats: empty };
  }

  const normalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>);
      if (options.sortKeys) entries.sort(([a], [b]) => a.localeCompare(b));
      return Object.fromEntries(entries.map(([k, v]) => [k, normalize(v)]));
    }
    return value;
  };

  const prepared = options.sortKeys ? normalize(parsed) : parsed;
  const indent = options.minify ? 0 : options.indent === 'tab' ? '\t' : options.indent;
  const stats = measure(prepared);
  return { output: JSON.stringify(prepared, null, indent), stats, notes: notesFor(parsed, input, stats) };
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function encodeBase64(input: string, urlSafe = false): string {
  const bytes = new TextEncoder().encode(input);
  const encoded = bytesToBase64(bytes);
  return urlSafe ? encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : encoded;
}

export function decodeBase64(input: string): { text: string; bytes: number } {
  const normalized = input.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
    throw new Error('Input contains characters that are not valid Base64.');
  }
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new Error('Input is not valid Base64 (wrong length or padding).');
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('Decoded data is not valid UTF-8 text. It may be binary content.');
  }
  return { text, bytes: bytes.length };
}

export function encodeUrlComponent(input: string, full = false): string {
  return full ? encodeURI(input) : encodeURIComponent(input);
}

export function decodeUrlComponent(input: string): string {
  try {
    return decodeURIComponent(input.replace(/\+/g, ' '));
  } catch {
    throw new Error('Input contains malformed percent-encoding (for example "%ZZ").');
  }
}

/**
 * Character offset of a 1-based line/column, for placing the caret on a JSON error.
 *
 * Reporting "line 14, column 3" is only half the answer when the document is 300
 * lines long: the reader still has to find it. The offset is what lets the editor
 * put the cursor there.
 */
export function offsetForLineColumn(text: string, line: number, column: number): number {
  if (line < 1) return 0;
  let currentLine = 1;
  let index = 0;
  while (currentLine < line && index < text.length) {
    if (text.charCodeAt(index) === 10) currentLine += 1;
    index += 1;
  }
  return Math.min(text.length, index + Math.max(0, column - 1));
}

/**
 * Decode Base64 to bytes, for payloads that are not text.
 *
 * `decodeBase64` refuses binary content on purpose — turning arbitrary bytes into
 * UTF-8 text would produce mojibake that looks like a bug. But refusing is not the
 * whole answer: people paste Base64 of a small image or a certificate constant all
 * the time, and the useful output is the file. This returns the bytes and lets the
 * caller offer a download, without pretending they are text.
 */
export function decodeBase64Bytes(input: string): Uint8Array {
  const normalized = input.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
    throw new Error('Input contains characters that are not valid Base64.');
  }
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new Error('Input is not valid Base64 (wrong length or padding).');
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** True when the bytes are valid UTF-8, i.e. safe to show as text. */
export function looksLikeText(bytes: Uint8Array): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/**
 * What a decoded blob actually is.
 *
 * Base64 is the transport of choice for a payload precisely because it looks like
 * data, and "not UTF-8" is not an answer. The first bytes are enough to name the
 * format in almost every case that matters, and naming it turns "download 42,000
 * bytes" into "this is a PNG".
 */
export interface DecodedIdentity {
  /** A label a person would use, e.g. "PNG image". */
  label: string;
  /** The MIME type to give the download, so the OS opens the right application. */
  type: string;
  /** A file extension without the dot, for the suggested filename. */
  extension: string;
  /** True when reaching this format through base64 is worth flagging. */
  executable: boolean;
}

const DECODED_SIGNATURES: { label: string; type: string; extension: string; bytes: number[]; offset?: number; executable?: boolean }[] = [
  { label: 'PNG image', type: 'image/png', extension: 'png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { label: 'JPEG image', type: 'image/jpeg', extension: 'jpg', bytes: [0xff, 0xd8, 0xff] },
  { label: 'GIF image', type: 'image/gif', extension: 'gif', bytes: [0x47, 0x49, 0x46, 0x38] },
  { label: 'WebP image', type: 'image/webp', extension: 'webp', bytes: [0x57, 0x45, 0x42, 0x50], offset: 8 },
  { label: 'PDF document', type: 'application/pdf', extension: 'pdf', bytes: [0x25, 0x50, 0x44, 0x46] },
  { label: 'ZIP archive', type: 'application/zip', extension: 'zip', bytes: [0x50, 0x4b, 0x03, 0x04] },
  { label: 'gzip stream', type: 'application/gzip', extension: 'gz', bytes: [0x1f, 0x8b] },
  { label: 'MP4 video', type: 'video/mp4', extension: 'mp4', bytes: [0x66, 0x74, 0x79, 0x70], offset: 4 },
  { label: 'MP3 audio', type: 'audio/mpeg', extension: 'mp3', bytes: [0x49, 0x44, 0x33] },
  { label: 'Windows executable', type: 'application/vnd.microsoft.portable-executable', extension: 'exe', bytes: [0x4d, 0x5a], executable: true },
  { label: 'ELF executable', type: 'application/x-elf', extension: 'elf', bytes: [0x7f, 0x45, 0x4c, 0x46], executable: true },
  { label: 'Java class file', type: 'application/java-vm', extension: 'class', bytes: [0xca, 0xfe, 0xba, 0xbe], executable: true },
  { label: 'Mach-O executable', type: 'application/x-mach-binary', extension: 'macho', bytes: [0xcf, 0xfa, 0xed, 0xfe], executable: true },
  { label: 'PHP script', type: 'application/x-httpd-php', extension: 'php', bytes: [0x3c, 0x3f, 0x70, 0x68], executable: true },
];

export function identifyDecoded(bytes: Uint8Array): DecodedIdentity | null {
  for (const signature of DECODED_SIGNATURES) {
    const offset = signature.offset ?? 0;
    if (bytes.length < offset + signature.bytes.length) continue;
    if (signature.bytes.every((byte, index) => bytes[offset + index] === byte)) {
      return {
        label: signature.label,
        type: signature.type,
        extension: signature.extension,
        executable: Boolean(signature.executable),
      };
    }
  }
  return null;
}

/**
 * What a decoded URL actually addresses.
 *
 * Decoding is the easy half. The useful half is answering "where does this
 * actually go", because percent-encoding is the standard way to make a link look
 * like it points somewhere it does not: `%2f%2f` becomes `//`, which turns a
 * relative-looking path into a protocol-relative host; a username before the `@`
 * is ignored by the browser but read by a person; and a `\u202e` in the path can
 * display the hostname backwards.
 *
 * This is analysis, not navigation: the URL is never fetched — `connect-src
 * 'none'` is in the CSP and remains so.
 */
export interface UrlFacts {
  /** Scheme as written, lowercased, e.g. `https`. Empty for a relative reference. */
  scheme: string;
  host: string;
  port: string;
  path: string;
  /** Parameters in order, with duplicates preserved — `a=1&a=2` is a real case. */
  params: { key: string; value: string }[];
  /** The part after `#`, unescaped. */
  fragment: string;
  /** Credentials embedded before the host. */
  userInfo?: string;
  /** True when the host is a bare IP address. */
  ipHost: boolean;
  /** Findings about the decoded URL, phrased as facts. */
  notes: { tone: 'warn' | 'danger' | 'default'; message: string }[];
  /** True when the input is not an absolute URL at all. */
  relative: boolean;
}

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

export function inspectUrl(value: string): UrlFacts | null {
  const text = value.trim();
  if (!text) return null;

  // A scheme is required before `//` is authority; otherwise it is a path.
  const schemeMatch = /^([a-z][a-z0-9+.-]*):/i.exec(text);
  const scheme = schemeMatch ? schemeMatch[1].toLowerCase() : '';
  const rest = schemeMatch ? text.slice(schemeMatch[0].length) : text;

  const hasAuthority = rest.startsWith('//');
  const authorityEnd = hasAuthority
    ? (() => {
        const index = rest.slice(2).search(/[/?#]/);
        return index < 0 ? rest.length : index + 2;
      })()
    : 0;
  const authority = hasAuthority ? rest.slice(2, authorityEnd) : '';
  const remainder = hasAuthority ? rest.slice(authorityEnd) : rest;

  const withoutFragment = remainder.split('#')[0];
  const fragment = remainder.includes('#') ? remainder.slice(remainder.indexOf('#') + 1) : '';
  const [rawPath, rawQuery = ''] = withoutFragment.split('?');

  const at = authority.lastIndexOf('@');
  const userInfo = at >= 0 ? authority.slice(0, at) : undefined;
  const hostPort = at >= 0 ? authority.slice(at + 1) : authority;
  const [host, port = ''] = hostPort.split(':');

  let params: UrlFacts['params'] = [];
  try {
    params = [...new URLSearchParams(rawQuery).entries()].map(([key, value]) => ({ key, value }));
  } catch {
    params = [];
  }

  const notes: UrlFacts['notes'] = [];
  const decodedHost = safeDecode(host);
  const decodedPath = safeDecode(rawPath);

  if (userInfo) {
    const [user, password] = userInfo.split(':');
    notes.push({
      tone: 'danger',
      message: `The URL carries credentials before the host (${safeDecode(user)}${password !== undefined ? ' and a password' : ''}). Browsers ignore them when navigating, so this reads as a login page for ${decodedHost} while going to exactly the same place as a plain ${decodedHost} link. It exists to make the address look like something it is not.`,
    });
  }

  if (/%2f|%5c/i.test(rawPath)) {
    notes.push({
      tone: 'warn',
      message: `The path contains an encoded slash (${/%2f/i.test(rawPath) ? '%2f' : '%5c'}). Once decoded it is a separator, so the host a filter sees and the path the server receives can differ — the basis of several path-traversal and access-control bypasses.`,
    });
  }

  if (decodedPath.includes('..')) {
    notes.push({
      tone: 'warn',
      message: 'The path contains a parent-directory segment (..) after decoding. On a server that does not normalise before routing, that reaches a file outside the intended folder.',
    });
  }

  if (IPV4.test(decodedHost)) {
    notes.push({
      tone: 'warn',
      message: `${decodedHost} is a bare IP address rather than a name, so there is no certificate identity to recognise and no domain reputation to check. Legitimate services use names; a link that goes straight to an address rarely does.`,
    });
  } else if (decodedHost.startsWith('xn--') || decodedHost.split('.').some((label) => label.startsWith('xn--'))) {
    notes.push({
      tone: 'warn',
      message: 'The host is punycode (xn--). It renders in non-Latin characters, which can spell a familiar brand in another script while being a different domain entirely.',
    });
  }

  /*
   * A single redirect parameter is the common case, so this runs even when it is
   * the only parameter — the earlier version nested it inside `params.length >= 2`
   * and missed exactly the link that matters most.
   */
  const redirect = params.find(
    (param) => /^(url|redirect|next|return|continue|dest|target|goto)$/i.test(param.key) && /^(https?:|\/\/)/i.test(param.value),
  );
  if (redirect) {
    notes.push({
      tone: 'warn',
      message: `“${redirect.key}” holds another full URL (${redirect.value.slice(0, 80)}). This link is a redirect: the host you see is not necessarily where you end up.`,
    });
  }

  if (params.length >= 2) {
    const keys = params.map((param) => param.key);
    const duplicated = [...new Set(keys.filter((key, index) => keys.indexOf(key) !== index))];
    if (duplicated.length > 0) {
      notes.push({
        tone: 'warn',
        message: `The query string repeats ${duplicated.length === 1 ? `“${duplicated[0]}”` : duplicated.map((key) => `“${key}”`).join(', ')}. Two readers can take different values — the first or the last — which is how a parameter-smuggling check gets bypassed.`,
      });
    }
  }

  if (scheme === 'data' || scheme === 'javascript') {
    notes.push({
      tone: 'danger',
      message: `The scheme is ${scheme}:, so the URL carries its own content instead of pointing at a page. Opening it renders attacker-supplied HTML or runs script in the context of whatever page it is pasted into.`,
    });
  } else if (scheme && !['http', 'https', 'mailto', 'tel', 'ftp'].includes(scheme)) {
    notes.push({
      tone: 'warn',
      message: `The scheme is “${scheme}”, which is not a web address. It usually hands off to a desktop application.`,
    });
  }

  if (/[\u202a-\u202e\u2066-\u2069]/.test(text)) {
    notes.push({
      tone: 'danger',
      message: 'The URL contains a Unicode text-direction control, so the order characters are displayed in differs from the order they are stored in. The address on screen is not the address that will be opened.',
    });
  }

  return {
    scheme,
    host: decodedHost,
    port,
    path: decodedPath,
    params,
    fragment: safeDecode(fragment),
    userInfo,
    ipHost: IPV4.test(decodedHost),
    notes,
    relative: !scheme,
  };
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
