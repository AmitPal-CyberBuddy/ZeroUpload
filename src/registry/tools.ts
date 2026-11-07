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

/** Every defined tool, including the ones a feature flag hides from the catalogue. */
export const ALL_TOOLS: ToolDefinition[] = [
  /* -------------------------------- Images ------------------------------- */
  {
    slug: 'image-converter',
    name: 'Image Converter',
    shortName: 'Convert',
    blurb: 'Convert images between JPEG, PNG, WebP and AVIF — nothing is uploaded.',
    description:
      'Change an image to the format you need, keeping transparency where the format allows it. Lossy formats get a quality control, and every result reports exactly how the file size changed.',
    category: 'image',
    icon: 'refresh',
    status: 'stable',
    tags: ['JPEG', 'PNG', 'WebP', 'AVIF'],
    keywords: ['png to jpg', 'jpg to webp', 'webp to png', 'avif'],
  },

  {
    slug: 'favicon',
    name: 'Favicon Generator',
    shortName: 'Favicon',
    blurb: 'One image in, a complete favicon set out.',
    description:
      'Turn a single square image into every icon size you need, plus a web manifest and a snippet you can paste into your page. The set uses relative paths, so it works from a subdirectory too.',
    category: 'image',
    icon: 'grid',
    status: 'stable',
    tags: ['ICO', 'PNG', 'Web manifest'],
    keywords: ['favicon', 'ico', 'apple touch icon', 'site icon', 'webmanifest'],
    aliases: ['favicon generator', 'icon maker', 'ico converter', 'site icon'],
  },

  
  {
    slug: 'image-compressor',
    name: 'Image Compressor',
    shortName: 'Compress',
    blurb: 'Shrink photos with a quality dial and an honest size delta.',
    description:
      'Choose a quality level, optionally limit the width, and see exactly how many bytes you saved. If a file would get bigger, the tool says so instead of pretending otherwise.',
    category: 'image',
    icon: 'compress',
    status: 'stable',
    tags: ['Quality', 'Before / after'],
    keywords: [
      'compress image',
      'reduce size',
      'optimize jpg',
      'optimize png',
      'shrink photo',
      'make image smaller',
      'reduce photo size',
    ],
  },

  /* ----------------------------- Transform ------------------------------- */
  {
    slug: 'resize',
    name: 'Image Resizer',
    shortName: 'Resize',
    blurb: 'Resize to an exact size, or scale proportionally.',
    description:
      'Set a target width, height or percentage. The aspect ratio stays locked unless you unlock it, and the result is resampled smoothly rather than stretched.',
    category: 'image',
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
      'Choose a region with a draggable frame, snap it to a familiar aspect ratio or crop freehand, then export in the format you need.',
    category: 'image',
    icon: 'crop',
    status: 'stable',
    tags: ['Aspect ratio', 'Framing'],
    keywords: ['crop photo', 'square crop', 'cut image'],
  },
  {
    slug: 'rotate',
    name: 'Rotate & Flip',
    shortName: 'Rotate',
    blurb: 'Rotate in 90° steps or mirror an image.',
    description:
      'Fix orientation or mirror an image in one pass, without losing quality. Camera orientation is respected, so phone photos come out the right way up.',
    category: 'image',
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
    blurb: 'Combine several PDFs into one document, in the order you choose.',
    description:
      'Add the documents, put them in the order you want, and get a single PDF. Text stays selectable and nothing is re-compressed.',
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
      'Choose pages by range or cut the document into equal parts. Download a single trimmed PDF, or a ZIP with every piece.',
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
    blurb: 'Fix sideways scans in a single step.',
    description:
      'Turn every page a quarter-turn or half-turn. Only the orientation changes, so the content stays exactly as sharp as it was.',
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
      'Turn JPEG and PNG images into one PDF, with a page per image or A4 pages with margins. Set the order before you build it.',
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
    blurb: 'Add a password to a PDF and choose what readers may do with it.',
    description:
      'Protects a document with AES-256 encryption, so it cannot be opened without the password. Printing, copying, editing and commenting can each be switched off — with the honest caveat that permission flags are a request, not a lock.',
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
      'Unlocks AES-256, AES-128 and RC4 protected documents and gives you back a plain PDF with no password and no restrictions. It asks for the password you already know — it never guesses.',
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
      'Pack any mix of files into one ZIP, with or without a password. Files are processed one at a time so memory stays predictable on large bundles.',
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
    blurb: 'Open an archive, see what is inside and take what you need.',
    description:
      'Every file and its size is listed before anything is extracted. Archives that would expand far beyond their size are refused, so a malicious file cannot fill your memory.',
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
      'Unlocks .docx, .xlsx and .pptx documents saved with a password since Office 2007, and gives you back the plain file inside. The result is checked to be a valid document before you can download it.',
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
    blurb: 'Add a password to a Word, Excel or PowerPoint file.',
    description:
      'Protects a .docx, .xlsx or .pptx with the same AES-256 encryption Office itself uses, so it asks for the password when opened. Experimental until it has been tested in Word, Excel and PowerPoint directly.',
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
      'Reveals what a file actually is from its contents, not its extension, then shows its dimensions, embedded metadata and a SHA-256 digest. Useful for spotting a mislabelled or disguised file.',
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
      'Pretty-print with your preferred indentation, minify for production, sort keys, and jump straight to the line and column when something is wrong.',
    category: 'developer',
    icon: 'braces',
    status: 'stable',
    tags: ['Validate', 'Minify'],
    keywords: ['pretty print', 'json lint', 'beautify'],
  },
  {
    slug: 'base64',
    name: 'Base64 Encoder',
    shortName: 'Base64',
    blurb: 'Encode and decode text or files, locally.',
    description:
      'Encodes UTF-8 correctly, so accents and emoji survive a round trip. URL-safe output and file-to-text conversion are included.',
    category: 'developer',
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
      'Encode a single value or an entire URL without escaping its separators by accident. Malformed sequences are reported rather than silently dropped.',
    category: 'developer',
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
      'Compute a digest for any text and copy it in one click. Everything happens on your device — nothing is logged or transmitted.',
    category: 'developer',
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

/**
 * Look up a tool *including* the ones a feature flag hides.
 *
 * The components for flagged tools are still compiled in, and they need their own
 * definition to render their shell. Reading `getTool('encrypt-office')!` instead
 * made a hidden tool a crash the moment anything mounted it outside the router — a
 * test, a preview, a future flag change. This returns the definition regardless of
 * the flag, so the component can always render and the *routing* stays the thing
 * that decides whether anyone reaches it.
 */
export function getToolAny(slug: string): ToolDefinition | undefined {
  return ALL_TOOLS.find((tool) => tool.slug === slug);
}

/**
 * Curated next steps. Marketing departments would call this a funnel; here it is
 * simply the tool a person usually needs after this one — protect after merge,
 * unlock after protect, inspect after extracting something unfamiliar.
 */
const RELATED: Record<string, string[]> = {
  'image-converter': ['image-compressor', 'resize', 'favicon'],
  favicon: ['image-converter', 'resize', 'crop'],
  'image-compressor': ['image-converter', 'resize', 'crop'],
  resize: ['crop', 'image-compressor', 'images-to-pdf'],
  crop: ['resize', 'rotate', 'image-converter'],
  rotate: ['crop', 'resize', 'rotate-pdf'],
  'merge-pdf': ['split-pdf', 'rotate-pdf', 'protect-pdf'],
  'split-pdf': ['merge-pdf', 'rotate-pdf', 'create-zip'],
  'rotate-pdf': ['merge-pdf', 'split-pdf', 'images-to-pdf'],
  'images-to-pdf': ['merge-pdf', 'split-pdf', 'resize'],
  'protect-pdf': ['unlock-pdf', 'merge-pdf', 'create-zip'],
  'unlock-pdf': ['protect-pdf', 'unlock-office', 'file-inspector'],
  'create-zip': ['extract-zip', 'split-pdf', 'protect-pdf'],
  'extract-zip': ['create-zip', 'file-inspector', 'unlock-office'],
  'unlock-office': ['unlock-pdf', 'extract-zip', 'file-inspector'],
  'encrypt-office': ['protect-pdf', 'create-zip', 'unlock-office'],
  'file-inspector': ['extract-zip', 'unlock-pdf', 'hash-generator'],
  'json-formatter': ['base64', 'url-encoder', 'hash-generator'],
  base64: ['json-formatter', 'url-encoder', 'file-inspector'],
  'url-encoder': ['base64', 'json-formatter', 'hash-generator'],
  'hash-generator': ['file-inspector', 'base64', 'json-formatter'],
};

export function relatedTools(tool: ToolDefinition, limit = 3): ToolDefinition[] {
  const picked = (RELATED[tool.slug] ?? [])
    .map((slug) => getTool(slug))
    .filter((item): item is ToolDefinition => Boolean(item) && item!.slug !== tool.slug);

  if (picked.length >= limit) return picked.slice(0, limit);

  // Anything not curated yet falls back to its neighbours, never to duplicates.
  const seen = new Set([tool.slug, ...picked.map((item) => item.slug)]);
  const fallback = TOOLS.filter((item) => item.status === 'stable' && !seen.has(item.slug));
  return [...picked, ...fallback].slice(0, limit);
}
