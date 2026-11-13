import type { IconName } from '../components/ui/Icon';

/**
 * Five groups, named the way people describe the work rather than the way the
 * code is organised: images, PDFs, archives and Office documents, inspection,
 * and developer text utilities. Each one is a real page at `/tools/<id>/`.
 */
export type CategoryId = 'image' | 'pdf' | 'archive' | 'inspect' | 'developer';

export interface Category {
  id: CategoryId;
  /** Short label for chips and navigation. */
  name: string;
  icon: IconName;
  /** One sentence, used on cards and in metadata. */
  description: string;
  /** Two-word verb shown on the homepage tiles. */
  verb: string;
  /** `<h1>` of the category page. */
  heading: string;
  /** Intro paragraph, written for someone arriving from a search result. */
  intro: string;
  /** "I need…" → tool, used for the guidance list on the category page. */
  guide: Array<{ need: string; slug: string }>;
}

export const CATEGORIES: Category[] = [
  {
    id: 'image',
    name: 'Images',
    verb: 'Reshape pixels',
    icon: 'image',
    description:
      'Convert, compress, resize, crop and rotate images, or build a complete favicon set from one square picture.',
    heading: 'Image tools that never send your picture anywhere.',
    intro:
      'Six tools for JPEG, PNG, WebP and AVIF: change the format, make the file smaller, resize it, crop it, turn a sideways photo upright, or generate a full favicon set. The picture is decoded by your browser’s own codec and stays on the device you opened it on.',
    guide: [
      { need: 'The file is too big to attach to an email', slug: 'image-compressor' },
      { need: 'It has to be a different format', slug: 'image-converter' },
      { need: 'It has to be exactly 1200 × 630 pixels', slug: 'resize' },
      { need: 'Only part of the picture is useful', slug: 'crop' },
      { need: 'The photo came out sideways or mirrored', slug: 'rotate' },
      { need: 'The site needs an icon set', slug: 'favicon' },
    ],
  },
  {
    id: 'pdf',
    name: 'PDF',
    verb: 'Work with pages',
    icon: 'pdf',
    description:
      'Merge, split, rotate, protect and unlock PDFs — page by page, in the browser, without uploading the document.',
    heading: 'PDF work, done page by page in your browser.',
    intro:
      'Combine documents, take out the pages you need, fix a sideways scan, assemble photos into a PDF, or add and remove a password. Pages are copied rather than re-rendered, so text stays selectable and the document never leaves the tab.',
    guide: [
      { need: 'Reorder pages or add text and images', slug: 'pdf-editor' },
      { need: 'Several PDFs have to become one', slug: 'merge-pdf' },
      { need: 'Only some pages matter, or one file per page', slug: 'split-pdf' },
      { need: 'A scanned page is sideways', slug: 'rotate-pdf' },
      { need: 'Photos and scans have to become a document', slug: 'images-to-pdf' },
      { need: 'Nobody should open it without a password', slug: 'protect-pdf' },
      { need: 'It still asks for a password I know', slug: 'unlock-pdf' },
    ],
  },
  {
    id: 'archive',
    name: 'Archives & Office',
    verb: 'Bundle & unlock',
    icon: 'zip',
    description:
      'Work with ZIP archives, unlock supported Office files, or export an XLSX sheet to CSV.',
    heading: 'ZIP archives and password-protected Office files.',
    intro:
      'Build or inspect a ZIP, unlock a supported Office file you can already open, or export an XLSX worksheet to CSV. Processing stays local; CSV does not preserve workbook formatting or formulas.',
    guide: [
      { need: 'Export an Excel worksheet to CSV', slug: 'xlsx-to-csv' },
      { need: 'A folder has to arrive as one file', slug: 'create-zip' },
      { need: 'An archive needs a password', slug: 'create-zip' },
      { need: 'To see what is in a ZIP before opening it', slug: 'extract-zip' },
      { need: 'A locked .docx, .xlsx or .pptx has to open again', slug: 'unlock-office' },
    ],
  },
  {
    id: 'inspect',
    name: 'Inspection',
    verb: 'Look inside',
    icon: 'inspect',
    description:
      'Find out what a file really is from its first bytes, read its metadata and compute a SHA-256 digest.',
    heading: 'Find out what a file actually is.',
    intro:
      'An extension is a claim, not a fact — and a file that calls itself a PDF can be anything at all. The inspector reads the opening bytes to identify the real type, reports dimensions and metadata, and hashes the contents so two files can be compared with certainty.',
    guide: [
      { need: 'To know whether this really is a PDF', slug: 'file-inspector' },
      { need: 'To check two downloads are identical', slug: 'file-inspector' },
      { need: 'To see what a document embeds', slug: 'file-inspector' },
    ],
  },
  {
    id: 'developer',
    name: 'Developer',
    verb: 'Clean & encode',
    icon: 'code',
    description:
      'Format, minify and validate JSON, encode Base64 and URLs, and compute checksums without pasting secrets into someone else’s server.',
    heading: 'Text and encoding utilities that stay on your machine.',
    intro:
      'JSON that arrived as one long line, a token someone pasted as Base64, a URL that got double-encoded, a checksum to verify. These are two-second jobs that most sites solve by sending your input to a server — which is exactly what you should not do with production data.',
    guide: [
      { need: 'JSON has to be readable', slug: 'json-formatter' },
      { need: 'To find the syntax error in JSON', slug: 'json-formatter' },
      { need: 'To shrink JSON before shipping it', slug: 'json-formatter' },
      { need: 'To decode a Base64 string', slug: 'base64' },
      { need: 'To escape or unescape a URL', slug: 'url-encoder' },
      { need: 'A digest or a check against a published checksum', slug: 'hash-generator' },
    ],
  },
];

export const CATEGORY_MAP = Object.fromEntries(CATEGORIES.map((c) => [c.id, c])) as Record<
  CategoryId,
  Category
>;

/** True when a path segment is a category page rather than a tool slug. */
export function isCategoryId(value: string): value is CategoryId {
  return Object.prototype.hasOwnProperty.call(CATEGORY_MAP, value);
}
