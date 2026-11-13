/**
 * What a file *is*, expressed as a small closed set of families.
 *
 * This is the vocabulary the rest of the capability layer speaks. It deliberately
 * does not use MIME types: "image/webp" answers a question nobody asks, while
 * "this is an image, so the image tools apply" is the question the homepage and
 * the workspace actually need to answer.
 *
 * The set is closed on purpose. A family means "zeroUpload has at least one thing
 * to say about this kind of file"; a type nobody supports gets no family and is
 * reported as unrecognised rather than silently landfilling into `other`.
 */
export type FileFamily =
  | 'image'
  | 'pdf'
  | 'archive'
  | 'spreadsheet'
  | 'office'
  | 'text'
  | 'video'
  | 'audio'
  | 'unknown';

export interface FamilyInfo {
  id: FileFamily;
  /** Plural noun for UI copy: "these images", "this PDF". */
  noun: string;
  /** What a visitor calls it, for badges and headings. */
  label: string;
}

export const FAMILIES: Record<FileFamily, FamilyInfo> = {
  image: { id: 'image', noun: 'images', label: 'Image' },
  pdf: { id: 'pdf', noun: 'PDF documents', label: 'PDF document' },
  archive: { id: 'archive', noun: 'archives', label: 'Archive' },
  spreadsheet: { id: 'spreadsheet', noun: 'spreadsheets', label: 'Spreadsheet' },
  office: { id: 'office', noun: 'Office documents', label: 'Office document' },
  text: { id: 'text', noun: 'text files', label: 'Text' },
  video: { id: 'video', noun: 'videos', label: 'Video' },
  audio: { id: 'audio', noun: 'audio files', label: 'Audio' },
  unknown: { id: 'unknown', noun: 'files', label: 'File' },
};

/**
 * Formats within a family that a tool can read or write.
 *
 * Kept as plain strings rather than an enum because they are also the labels
 * printed in the UI ("JPG", "WEBP", "XLSX") and the extension a download gets.
 */
export type FormatId = string;

export interface FormatInfo {
  id: FormatId;
  label: string;
  family: FileFamily;
  mime: string;
}

/**
 * The formats the platform can *decode* — not the ones it can encode, which
 * depends on the browser and is probed at runtime (`capabilities.ts`).
 *
 * SVG is listed as decodable-but-not-encodable and every tool treats it that way;
 * it is safe to rasterise because the source is the user's own file and the
 * result is drawn to a canvas, never re-emitted as markup.
 */
export const FORMATS: Record<FormatId, FormatInfo> = {
  jpg: { id: 'jpg', label: 'JPG', family: 'image', mime: 'image/jpeg' },
  png: { id: 'png', label: 'PNG', family: 'image', mime: 'image/png' },
  webp: { id: 'webp', label: 'WEBP', family: 'image', mime: 'image/webp' },
  avif: { id: 'avif', label: 'AVIF', family: 'image', mime: 'image/avif' },
  gif: { id: 'gif', label: 'GIF', family: 'image', mime: 'image/gif' },
  bmp: { id: 'bmp', label: 'BMP', family: 'image', mime: 'image/bmp' },
  heic: { id: 'heic', label: 'HEIC', family: 'image', mime: 'image/heic' },
  svg: { id: 'svg', label: 'SVG', family: 'image', mime: 'image/svg+xml' },
  pdf: { id: 'pdf', label: 'PDF', family: 'pdf', mime: 'application/pdf' },
  zip: { id: 'zip', label: 'ZIP', family: 'archive', mime: 'application/zip' },
  xlsx: {
    id: 'xlsx',
    label: 'XLSX',
    family: 'spreadsheet',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  },
  csv: { id: 'csv', label: 'CSV', family: 'text', mime: 'text/csv' },
  docx: {
    id: 'docx',
    label: 'DOCX',
    family: 'office',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  pptx: {
    id: 'pptx',
    label: 'PPTX',
    family: 'office',
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  },
  json: { id: 'json', label: 'JSON', family: 'text', mime: 'application/json' },
  txt: { id: 'txt', label: 'TXT', family: 'text', mime: 'text/plain' },
  base64: { id: 'base64', label: 'Base64', family: 'text', mime: 'text/plain' },
};

/** Every format in a family, in the order the UI should offer them. */
export function formatsInFamily(family: FileFamily): FormatInfo[] {
  return Object.values(FORMATS).filter((format) => format.family === family);
}

/** `jpg` / `jpeg` are the same format; so are `tif`/`tiff`. */
const ALIASES: Record<string, FormatId> = {
  jpeg: 'jpg',
  jpe: 'jpg',
  jfif: 'jpg',
  heif: 'heic',
  tif: 'png', // not supported; mapped so the family resolves and the tool can refuse clearly
  tiff: 'png',
  htm: 'txt',
  markdown: 'txt',
  md: 'txt',
  text: 'txt',
  yml: 'txt',
  yaml: 'txt',
  eml: 'txt',
};

/**
 * The extension of a filename, normalised to a known format id.
 *
 * Returns `undefined` rather than guessing: "report.pdf.zip" is a ZIP, and
 * "notes" has no extension at all. Callers fall back to magic bytes.
 */
export function formatFromFilename(name: string): FormatId | undefined {
  // The extension itself is returned (lowercased) when it is not a known format:
  // callers need it to fall back to, and a bare `undefined` for "mystery.xyz"
  // loses the only signal the file carries.
  const ext = extensionOf(name);
  if (!ext) return undefined;
  if (ext in FORMATS) return ext;
  return ALIASES[ext] ?? ext;
}

/** The raw lowercased extension, whether or not it is a format we know. */
export function extensionOf(name: string): string | undefined {
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(name);
  return match ? match[1].toLowerCase() : undefined;
}

/**
 * Extension → family, for formats this platform does not implement.
 *
 * The point is not to support HEIC or TIFF, it is to *route* them: a HEIC file is
 * still an image, so the image tools are the right place to send someone — even
 * if the answer they get there is "this browser cannot decode HEIC". Telling them
 * "unrecognised file" instead would be less true and less useful.
 */
export function familyFromExtension(ext: string): FileFamily | undefined {
  const id = ALIASES[ext] ?? ext;
  if (id in FORMATS) return FORMATS[id].family;
  if (['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'heic', 'heif', 'svg', 'avif', 'ico', 'tif', 'tiff'].includes(ext)) {
    return 'image';
  }
  if (['pdf'].includes(ext)) return 'pdf';
  if (['zip', 'rar', '7z', 'gz', 'tar', 'bz2', 'xz'].includes(ext)) return 'archive';
  if (['xlsx', 'xls', 'xlsm', 'ods', 'csv', 'tsv'].includes(ext)) return 'spreadsheet';
  if (['docx', 'doc', 'pptx', 'ppt', 'odt', 'odp', 'rtf'].includes(ext)) return 'office';
  if (['json', 'txt', 'md', 'html', 'htm', 'css', 'js', 'ts', 'xml', 'yml', 'yaml', 'log'].includes(ext)) {
    return 'text';
  }
  if (['mp4', 'webm', 'mov', 'mkv', 'avi'].includes(ext)) return 'video';
  if (['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac'].includes(ext)) return 'audio';
  return undefined;
}

/** MIME prefix → family, for files with no useful extension. */
export function familyFromMime(mime: string): FileFamily | undefined {
  if (!mime) return undefined;
  if (mime.startsWith('image/')) return mime === 'image/svg+xml' ? 'image' : 'image';
  if (mime === 'application/pdf') return 'pdf';
  if (/zip|x-7z|gzip|x-rar|x-tar/.test(mime)) return 'archive';
  if (/spreadsheetml/.test(mime)) return 'spreadsheet';
  if (/wordprocessingml|presentationml/.test(mime)) return 'office';
  if (mime.startsWith('text/') || /json|xml|csv/.test(mime)) return 'text';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return undefined;
}
