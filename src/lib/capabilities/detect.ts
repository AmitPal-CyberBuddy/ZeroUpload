/**
 * Deciding what family a dropped file belongs to.
 *
 * The tool categories were fixed by the page you were on: drop a PNG on the merge
 * page and it was refused, because that page only knew how to merge PDFs. The
 * workspace is the opposite — it takes anything and asks this module what it is.
 *
 * Three sources, in decreasing order of trust:
 *
 *  1. **magic bytes** (`sniffFileType`) — the file's own claim,
 *  2. **the extension**, which is what the person named it,
 *  3. **the declared MIME type**, which browsers derive from the extension anyway
 *     and is therefore the weakest signal of the three.
 *
 * Containers need a second look: `.docx`, `.xlsx` and `.pptx` are all ZIP files
 * by signature, so the extension is what separates them, and a renamed `.zip`
 * genuinely is a ZIP.
 */
import { isProbablyText, sniffFileType } from '../files/mime';
import {
  familyFromExtension,
  familyFromMime,
  formatFromFilename,
  type FileFamily,
  type FormatId,
} from './formats';

export interface DetectedFile {
  family: FileFamily;
  /** The specific format, when it can be named. */
  format?: FormatId;
  /** Human label for the badge: "PNG image", "PDF document", "Text". */
  label: string;
  /** Which signal decided it, so the UI can be honest about a guess. */
  source: 'signature' | 'extension' | 'declared-type' | 'none';
  /** True when the extension and the bytes disagree — worth telling the user. */
  mismatch: boolean;
}

/** Extensions that are all ZIP containers underneath. */
const ZIP_CONTAINER_EXTENSIONS: Record<string, { family: FileFamily; format: FormatId; label: string }> = {
  xlsx: { family: 'spreadsheet', format: 'xlsx', label: 'Excel workbook' },
  docx: { family: 'office', format: 'docx', label: 'Word document' },
  pptx: { family: 'office', format: 'pptx', label: 'PowerPoint presentation' },
};

const LABELS: Record<string, string> = {
  jpg: 'JPEG image',
  png: 'PNG image',
  webp: 'WebP image',
  avif: 'AVIF image',
  gif: 'GIF image',
  bmp: 'BMP image',
  heic: 'HEIC image',
  svg: 'SVG image',
  pdf: 'PDF document',
  zip: 'ZIP archive',
  xlsx: 'Excel workbook',
  csv: 'CSV file',
  docx: 'Word document',
  pptx: 'PowerPoint presentation',
  json: 'JSON file',
  txt: 'Text file',
  base64: 'Base64 text',
};

function extras(ext: string) {
  return ext.slice(ext.lastIndexOf('.') + 1).toLowerCase();
}

/**
 * Reads at most 64 bytes to identify a file.
 *
 * Everything below the signature check is metadata, so this is cheap enough to
 * run on every drop, on the main thread, before any tool is chosen.
 */
export async function detectFile(file: File): Promise<DetectedFile> {
  const extension = formatFromFilename(file.name);
  const containerHit = ZIP_CONTAINER_EXTENSIONS[extras(file.name)];

  const signature = await sniffFileType(file);
  const declaredFamily = familyFromMime(file.type);

  // 1. An Office or spreadsheet container: the signature says ZIP, the extension
  //    says which kind, and only the extension can tell them apart.
  if (signature && (signature.type === 'application/zip' || /x-7z|gzip/.test(signature.type))) {
    if (containerHit) {
      return {
        family: containerHit.family,
        format: containerHit.format,
        label: containerHit.label,
        source: 'signature',
        mismatch: false,
      };
    }
    const format: FormatId = signature.type === 'application/zip' ? 'zip' : extension ?? 'zip';
    return {
      family: 'archive',
      format,
      label: signature.label,
      source: 'signature',
      mismatch: Boolean(extension && extension !== 'zip'),
    };
  }

  // 2. A signature the platform recognises.
  if (signature) {
    /*
     * The signature names the format. A file called "notes.txt" whose first bytes
     * are a PNG signature is a PNG: using the extension here made the badge say
     * one thing and the offered actions say another.
     */
    const signatureFamily = familyFromMime(signature.type) ?? 'unknown';
    const extensionFamily = extension ? familyFromExtension(extension) : undefined;
    const format = (
      extensionFamily === signatureFamily && extension && LABELS[extension] ? extension : signature.ext
    ) as FormatId;
    return {
      family: signatureFamily,
      format,
      label: LABELS[format] ?? signature.label,
      source: 'signature',
      /*
       * Only a *specific* disagreement is worth a warning. Text is the exception
       * in both directions — every text file has no signature, and a PNG named
       * .txt is exactly the case a user needs to hear about.
       */
      mismatch: Boolean(
        declaredFamily && extensionFamily && declaredFamily !== signatureFamily,
      ) || Boolean(extensionFamily && extensionFamily !== signatureFamily),
    };
  }

  // 3. Text has no signature by design — it is the absence of one.
  if (isProbablyText(file) || declaredFamily === 'text') {
    const format = extension ?? (file.type.includes('json') ? 'json' : 'txt');
    return {
      family: 'text',
      format,
      label: LABELS[format ?? 'txt'] ?? 'Text file',
      source: extension ? 'extension' : 'declared-type',
      mismatch: false,
    };
  }

  // 4. Nothing matched the bytes. Fall back to what the name and MIME type
  //    claim, and be explicit that it is a claim rather than a reading.
  if (extension) {
    const claimed = familyFromMime(file.type) ?? familyFromExtension(extension);
    return {
      family: containerHit?.family ?? claimed ?? 'unknown',
      format: extension,
      label: LABELS[extension] ?? `${extension.toUpperCase()} file`,
      source: 'extension',
      mismatch: false,
    };
  }

  return {
    family: declaredFamily ?? 'unknown',
    label: declaredFamily ? `${file.type} (declared)` : 'Unrecognised file',
    source: declaredFamily ? 'declared-type' : 'none',
    mismatch: false,
  };
}

/** Synchronous best-effort, for rendering a badge before the bytes are read. */
export function guessFamily(name: string, mime: string): FileFamily {
  const extension = formatFromFilename(name);
  if (extension) {
    if (ZIP_CONTAINER_EXTENSIONS[extras(name)]) return ZIP_CONTAINER_EXTENSIONS[extras(name)].family;
    const family = familyFromMime(mime);
    if (family) return family;
    if (['jpg', 'png', 'webp', 'avif', 'gif', 'bmp', 'heic', 'svg'].includes(extension)) return 'image';
    if (extension === 'pdf') return 'pdf';
    if (extension === 'zip') return 'archive';
    if (extension === 'xlsx') return 'spreadsheet';
  }
  return familyFromMime(mime) ?? 'unknown';
}
