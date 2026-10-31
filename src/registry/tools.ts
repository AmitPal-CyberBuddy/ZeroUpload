import type { IconName } from '../components/ui/Icon';
import type { CategoryId } from './categories';
import { OFFICE_ENCRYPTION_ENABLED } from '../lib/office/features';

export type ToolStatus = 'stable' | 'beta' | 'soon';

export interface ToolDefinition {
  /** Route slug: /tools/<slug> */
  slug: string;
  name: string;
  /** Compact name used in tight UI (breadcrumbs, catalogue chips). */
  shortName?: string;
  /** One-liner for cards and metadata. */
  blurb: string;
  /** Full description on the tool page. */
  description: string;
  category: CategoryId;
  icon: IconName;
  status: ToolStatus;
  tags?: string[];
  keywords?: string[];
  /** Extra search terms / synonyms, also used by the command palette. */
  aliases?: string[];
  /** Interoperability flag that must be on for this tool to exist at all. */
  flag?: 'office-encryption';
}

const ALL_TOOLS: ToolDefinition[] = [
  /* ------------------------------- Convert ------------------------------- */
  {
    slug: 'image-converter',
    name: 'Image Converter',
    shortName: 'Convert',
    blurb: 'JPEG, PNG, WebP and AVIF conversions that never touch a network.',
    description:
      'Decode an image once, then re-encode it in the format you need. Supports transparent PNG/WebP, quality control for lossy formats, and a real byte-level comparison of the result.',
    category: 'convert',
    icon: 'refresh',
    status: 'stable',
    tags: ['JPEG', 'PNG', 'WebP', 'AVIF'],
    keywords: ['png to jpg', 'jpg to webp', 'webp to png', 'avif'],
  },

  {
    slug: 'favicon',
    name: 'Favicon Generator',
    shortName: 'Favicon',
    blurb: 'One image in, a complete .ico, PNG and manifest set out — assembled in this tab.',
    description:
      'Centre-crop an image to a square, render a 512px master in a worker, then derive every icon size from that single decode. The .ico container is assembled byte by byte and the manifest plus head snippet use relative paths, so the set works under a subdirectory.',
    category: 'convert',
    icon: 'grid',
    status: 'stable',
    tags: ['ICO', 'PNG', 'Web manifest'],
    keywords: ['favicon', 'ico', 'apple touch icon', 'site icon', 'webmanifest'],
    aliases: ['favicon generator', 'icon maker', 'ico converter', 'site icon'],
  },

  /* ------------------------------ Compress ------------------------------- */
  {
    slug: 'image-compressor',
    name: 'Image Compressor',
    shortName: 'Compress',
    blurb: 'Shrink photos with a live quality dial and an honest size delta.',
    description:
      'Re-encode images with a precision quality control, optional downscaling and your choice of output format. The before/after panel reports the exact byte savings.',
    category: 'compress',
    icon: 'compress',
    status: 'stable',
    tags: ['Quality', 'Before / after'],
    keywords: ['compress image', 'reduce size', 'optimize jpg', 'optimize png'],
  },

  /* ----------------------------- Transform ------------------------------- */
  {
    slug: 'resize',
    name: 'Image Resizer',
    shortName: 'Resize',
    blurb: 'Exact or proportional resizing with a high-quality resample.',
    description:
      'Set a target width, height or percentage. Aspect ratio is preserved unless you break it deliberately, and the browser resamples with high-quality smoothing.',
    category: 'transform',
    icon: 'resize',
    status: 'stable',
    tags: ['Pixels', 'Aspect ratio'],
    keywords: ['scale image', 'dimensions', 'resize photo'],
  },
  {
    slug: 'crop',
    name: 'Image Cropper',
    shortName: 'Crop',
    blurb: 'Crop precisely with a draggable frame and aspect presets.',
    description:
      'Pick a region with a draggable, resizable frame. Snap to common aspect ratios or crop freehand, then export in any supported format.',
    category: 'transform',
    icon: 'crop',
    status: 'stable',
    tags: ['Aspect ratio', 'Framing'],
    keywords: ['crop photo', 'square crop', 'cut image'],
  },
  {
    slug: 'rotate',
    name: 'Rotate & Flip',
    shortName: 'Rotate',
    blurb: 'Rotate in 90° steps or mirror an image horizontally and vertically.',
    description:
      'Fix orientation or mirror an image without losing quality — the source is drawn once at the final geometry. EXIF orientation is respected on decode.',
    category: 'transform',
    icon: 'rotate',
    status: 'stable',
    tags: ['90°', 'Mirror'],
    keywords: ['flip image', 'mirror', 'straighten photo'],
  },

  /* -------------------------------- PDF ---------------------------------- */
  {
    slug: 'merge-pdf',
    name: 'Merge PDF',
    shortName: 'Merge',
    blurb: 'Combine multiple PDFs into one document, in the order you choose.',
    description:
      'Drop several PDFs, reorder them, and write a single new document. Pages are copied as-is; nothing is rasterised, so text stays selectable.',
    category: 'pdf',
    icon: 'pdf',
    status: 'stable',
    tags: ['Multi-file', 'Reorder'],
    keywords: ['combine pdf', 'join pdf'],
  },
  {
    slug: 'split-pdf',
    name: 'Split & Extract Pages',
    shortName: 'Split',
    blurb: 'Pull out the pages you need, or split a PDF into separate files.',
    description:
      'Select pages by range or split at intervals. Download one trimmed document or a ZIP containing every chunk.',
    category: 'pdf',
    icon: 'scissors',
    status: 'stable',
    tags: ['Ranges', 'ZIP output'],
    keywords: ['extract pages', 'delete pages', 'split document'],
  },
  {
    slug: 'rotate-pdf',
    name: 'Rotate PDF',
    shortName: 'Rotate PDF',
    blurb: 'Fix sideways scans by rotating every page or a selection.',
    description:
      'Applies a rotation to page metadata, so each page renders the right way up without re-encoding the content.',
    category: 'pdf',
    icon: 'rotate',
    status: 'stable',
    tags: ['Scans', 'All pages'],
    keywords: ['turn pdf', 'landscape', 'upside down'],
  },
  {
    slug: 'images-to-pdf',
    name: 'Images to PDF',
    shortName: 'To PDF',
    blurb: 'Assemble photos and scans into a single PDF.',
    description:
      'Embed JPEG and PNG images into a PDF with either a fitted page per image or A4 pages with margins. Order is controlled by drag-free up/down controls.',
    category: 'pdf',
    icon: 'layers',
    status: 'stable',
    tags: ['JPEG', 'PNG', 'A4'],
    keywords: ['jpg to pdf', 'png to pdf', 'scan to pdf'],
  },

  {
    slug: 'protect-pdf',
    name: 'Protect PDF',
    shortName: 'Protect PDF',
    blurb: 'Encrypt a PDF with an open password and set what readers may do with it.',
    description:
      'Writes a real AES-256 (revision 6) encrypted PDF: without the password the document cannot be opened, by us or anyone else. Printing, copying, editing and commenting can each be switched off, with the caveat that a reader is free to ignore those flags.',
    category: 'pdf',
    icon: 'lock',
    status: 'stable',
    tags: ['AES-256', 'Password'],
    keywords: ['encrypt pdf', 'password protect pdf', 'lock pdf', 'restrict pdf'],
    aliases: ['encrypt pdf', 'pdf password', 'lock document'],
  },
  {
    slug: 'unlock-pdf',
    name: 'Unlock PDF',
    shortName: 'Unlock PDF',
    blurb: 'Remove the password from a PDF you can already open.',
    description:
      'Decrypts AES-256, AES-128 and RC4 protected PDFs and writes a plain document: the encryption dictionary, the key and the permission flags are all removed. It asks for the password you already know — it does not guess one.',
    category: 'pdf',
    icon: 'shield',
    status: 'stable',
    tags: ['Decrypt', 'Remove password'],
    keywords: ['decrypt pdf', 'remove pdf password', 'unlock document'],
    aliases: ['remove password', 'pdf decrypt', 'unprotect pdf'],
  },

  /* ------------------------------ Archive -------------------------------- */
  {
    slug: 'create-zip',
    name: 'Create ZIP',
    shortName: 'Zip',
    blurb: 'Bundle any number of files into a single archive.',
    description:
      'Compression runs inside a lazy-loaded fflate worker-free module. Files are read one at a time to keep peak memory low.',
    category: 'archive',
    icon: 'zip',
    status: 'stable',
    tags: ['Bundle', 'Local'],
    keywords: ['zip files', 'archive', 'compress folder'],
  },
  {
    slug: 'extract-zip',
    name: 'Extract ZIP',
    shortName: 'Unzip',
    blurb: 'Open an archive, inspect its contents and download what you need.',
    description:
      'Lists every entry with its size before you extract. Guarded against ZIP bombs: entry count, expanded size and compression ratio are all capped.',
    category: 'archive',
    icon: 'expand',
    status: 'stable',
    tags: ['Safety limits', 'Preview'],
    keywords: ['unzip', 'open zip', 'decompress'],
  },

  {
    slug: 'unlock-office',
    name: 'Unlock Office File',
    shortName: 'Unlock Office',
    blurb: 'Remove the password from a protected Word, Excel or PowerPoint file.',
    description:
      'Reads the Agile and Standard encryption containers that Office 2007 and later produce and writes back the plain .docx, .xlsx or .pptx inside them. The decrypted document is validated as a real OOXML package before it is offered.',
    category: 'archive',
    icon: 'lock',
    status: 'beta',
    tags: ['DOCX', 'XLSX', 'PPTX'],
    keywords: ['decrypt docx', 'remove word password', 'unlock excel', 'office password'],
    aliases: ['word password', 'excel password', 'decrypt office'],
  },
  {
    slug: 'encrypt-office',
    name: 'Protect Office File',
    shortName: 'Protect Office',
    blurb: 'Encrypt a modern Office document with a password — experimental.',
    description:
      'Writes the same Agile encryption container Office 2013 and later use (AES-256, SHA-512, 100 000-round key derivation). Marked experimental until it has been round-tripped through real Word, Excel and PowerPoint installations.',
    category: 'archive',
    icon: 'lock',
    status: 'beta',
    flag: 'office-encryption',
    tags: ['AES-256', 'Experimental'],
    keywords: ['encrypt docx', 'password protect excel', 'encrypt office'],
    aliases: ['office password', 'protect document'],
  },

  /* ------------------------------ Inspect -------------------------------- */
  {
    slug: 'file-inspector',
    name: 'File Inspector',
    shortName: 'Inspect',
    blurb: 'Real file type, dimensions, metadata and a SHA-256 digest.',
    description:
      'Sniffs magic bytes to reveal what a file actually is (not just what its extension claims), lists image or PDF metadata, and computes SHA-256, SHA-512 or SHA-1 on-device.',
    category: 'inspect',
    icon: 'inspect',
    status: 'stable',
    tags: ['Magic bytes', 'SHA-256'],
    keywords: ['file info', 'checksum', 'hash', 'mime type'],
  },

  /* ----------------------------- Developer ------------------------------- */
  {
    slug: 'json-formatter',
    name: 'JSON Formatter',
    shortName: 'JSON',
    blurb: 'Format, minify and validate JSON with precise error positions.',
    description:
      'Pretty-print with your indent style, minify for production, optionally sort keys, and get a line/column pointer when the document is invalid.',
    category: 'dev',
    icon: 'braces',
    status: 'stable',
    tags: ['Validate', 'Minify'],
    keywords: ['pretty print', 'json lint', 'beautify'],
  },
  {
    slug: 'base64',
    name: 'Base64 Encoder',
    shortName: 'Base64',
    blurb: 'Encode and decode text or files without a round trip to a server.',
    description:
      'Handles UTF-8 correctly (multi-byte characters survive a round trip), supports URL-safe output, and can turn any file into a data-friendly Base64 string.',
    category: 'dev',
    icon: 'code',
    status: 'stable',
    tags: ['UTF-8', 'URL-safe', 'Files'],
    keywords: ['b64', 'encode string', 'data url'],
  },
  {
    slug: 'url-encoder',
    name: 'URL Encoder',
    shortName: 'URL',
    blurb: 'Percent-encode or decode query strings and full URLs.',
    description:
      'Toggle between component encoding and full-URI encoding so you do not accidentally escape separators. Decoding reports malformed sequences instead of failing silently.',
    category: 'dev',
    icon: 'link',
    status: 'stable',
    tags: ['Percent encoding', 'Query strings'],
    keywords: ['uri encode', 'percent encode', 'decode url'],
  },
  {
    slug: 'hash-generator',
    name: 'Hash Generator',
    shortName: 'Hash',
    blurb: 'SHA-256, SHA-512 and SHA-1 digests for text.',
    description:
      'Uses the Web Crypto API directly. Digests are computed locally and can be copied with one click; nothing is logged or transmitted.',
    category: 'dev',
    icon: 'hash',
    status: 'stable',
    tags: ['Web Crypto', 'SHA-256'],
    keywords: ['checksum', 'digest', 'sha512'],
  },
];

/**
 * Flagged tools are removed from the catalogue rather than shown disabled: a
 * route that exists but refuses to work is a worse experience than one that is
 * not linked, and filtering here keeps the homepage count, the tools index, the
 * command palette and `getTool` (hence routing) consistent automatically.
 */
export const TOOLS: ToolDefinition[] = ALL_TOOLS.filter(
  (tool) => tool.flag !== 'office-encryption' || OFFICE_ENCRYPTION_ENABLED,
);

export const TOOL_MAP = Object.fromEntries(
  TOOLS.map((tool): [string, ToolDefinition] => [tool.slug, tool]),
) as Record<string, ToolDefinition>;

export const TOOLS_BY_CATEGORY = TOOLS.reduce<Record<string, ToolDefinition[]>>((acc, tool) => {
  (acc[tool.category] ??= []).push(tool);
  return acc;
}, {});

export function getTool(slug: string): ToolDefinition | undefined {
  return TOOL_MAP[slug];
}

export function relatedTools(tool: ToolDefinition, limit = 3): ToolDefinition[] {
  const sameCategory = TOOLS.filter((t) => t.category === tool.category && t.slug !== tool.slug);
  const others = TOOLS.filter((t) => t.category !== tool.category && t.slug !== tool.slug && t.status === 'stable');
  return [...sameCategory, ...others].slice(0, limit);
}
