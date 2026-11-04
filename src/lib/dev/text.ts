/** Encoding helpers for the developer utilities. Pure, no DOM. */

export interface JsonFormatResult {
  output: string;
  error?: { message: string; line?: number; column?: number };
  stats: { nodes: number; depth: number; keys: number; arrays: number };
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
  return { output: JSON.stringify(prepared, null, indent), stats: measure(prepared) };
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
