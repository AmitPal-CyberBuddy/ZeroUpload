/**
 * MIME + magic-byte helpers.
 *
 * Browsers report `File.type` from the file extension, which makes it trivially
 * spoofable. Every tool that cares about the real format should sniff the first
 * bytes with `sniffFileType()` and compare that against the declared type.
 */

export interface TypeSignature {
  type: string;
  ext: string;
  label: string;
  bytes: number[];
  offset?: number;
  /** Optional extra check for containers that share a prefix (e.g. HEIC vs AVIF). */
  test?: (head: Uint8Array) => boolean;
}

export const IMAGE_MIME = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
  gif: 'image/gif',
} as const;

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

export const SIGNATURES: TypeSignature[] = [
  { type: 'image/jpeg', ext: 'jpg', label: 'JPEG image', bytes: [0xff, 0xd8, 0xff] },
  { type: 'image/png', ext: 'png', label: 'PNG image', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { type: 'image/gif', ext: 'gif', label: 'GIF image', bytes: [...ascii('GIF8')] },
  {
    type: 'image/webp',
    ext: 'webp',
    label: 'WebP image',
    bytes: [...ascii('RIFF')],
    test: (h) => String.fromCharCode(...h.slice(8, 12)) === 'WEBP',
  },
  { type: 'image/bmp', ext: 'bmp', label: 'BMP image', bytes: [...ascii('BM')] },
  {
    type: 'image/avif',
    ext: 'avif',
    label: 'AVIF image',
    bytes: [...ascii('ftyp')],
    offset: 4,
    test: (h) => ['avif', 'avis'].includes(String.fromCharCode(...h.slice(8, 12))),
  },
  {
    type: 'image/heic',
    ext: 'heic',
    label: 'HEIC image',
    bytes: [...ascii('ftyp')],
    offset: 4,
    test: (h) => ['heic', 'heix', 'hevc', 'mif1', 'msf1'].includes(String.fromCharCode(...h.slice(8, 12))),
  },
  { type: 'application/pdf', ext: 'pdf', label: 'PDF document', bytes: [...ascii('%PDF-')] },
  { type: 'application/zip', ext: 'zip', label: 'ZIP archive', bytes: [0x50, 0x4b, 0x03, 0x04] },
  { type: 'application/zip', ext: 'zip', label: 'ZIP archive (empty)', bytes: [0x50, 0x4b, 0x05, 0x06] },
  { type: 'application/x-7z-compressed', ext: '7z', label: '7-Zip archive', bytes: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c] },
  { type: 'application/gzip', ext: 'gz', label: 'GZIP archive', bytes: [0x1f, 0x8b] },
];

const EXT_TO_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jfif: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
  gif: 'image/gif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  pdf: 'application/pdf',
  zip: 'application/zip',
  json: 'application/json',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  html: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  ts: 'text/plain',
  yml: 'text/plain',
  yaml: 'text/plain',
  xml: 'application/xml',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  heic: 'image/heic',
};

export function mimeFromExtension(name: string): string {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  return EXT_TO_MIME[ext] ?? 'application/octet-stream';
}

/** Reads up to 64 bytes and matches known signatures. */
export async function sniffFileType(file: Blob): Promise<TypeSignature | null> {
  const head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  for (const sig of SIGNATURES) {
    const offset = sig.offset ?? 0;
    if (head.length < offset + sig.bytes.length) continue;
    const matches = sig.bytes.every((byte, i) => head[offset + i] === byte);
    if (!matches) continue;
    if (sig.test && !sig.test(head)) continue;
    return sig;
  }
  return null;
}

export function isProbablyText(file: File): boolean {
  if (file.type.startsWith('text/')) return true;
  return /\.(json|txt|md|csv|svg|xml|html|css|js|ts|yml|yaml)$/i.test(file.name);
}

export function humanFileType(type: string): string {
  if (!type) return 'Unknown type';
  const known = SIGNATURES.find((s) => s.type === type);
  if (known) return known.label;
  return type;
}
