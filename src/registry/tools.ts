import type { IconName } from '../components/ui/Icon';
import { CATEGORY_MAP, type CategoryId } from './categories';
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
      'Fix orientation or mirror an image in one pass. Camera orientation is respected; the output is re-encoded in your chosen format.',
    category: 'image',
    icon: 'rotate',
    status: 'stable',
    tags: ['90°', 'Mirror'],
    keywords: ['flip image', 'mirror', 'straighten photo'],
  },

  /* -------------------------------- PDF ---------------------------------- */
  {
    slug: 'pdf-editor', name: 'PDF Editor', shortName: 'Edit PDF',
    blurb: 'Reorder pages and add text, images or rectangles to a PDF.',
    description: 'Arrange pages, place new content on a preview or with coordinates, then download a new PDF locally.',
    category: 'pdf', icon: 'pdf', status: 'beta', tags: ['Pages', 'Add content'],
    keywords: ['edit pdf', 'reorder pages', 'add text to pdf', 'add image to pdf'],
  },
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

  {
    slug: 'xlsx-to-csv', name: 'Excel to CSV', shortName: 'Excel to CSV',
    blurb: 'Export one XLSX worksheet as a CSV file locally.',
    description: 'Select a worksheet, review its values and download a CSV without uploading the workbook.',
    category: 'archive', icon: 'file', status: 'beta', tags: ['XLSX', 'CSV'],
    keywords: ['excel to csv', 'xlsx to csv', 'spreadsheet export'],
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
 * Curated next steps, with a reason.
 *
 * The old map was three slugs per tool and nothing else, which made every
 * suggestion indistinguishable from an advert: "Unlock PDF" appeared after
 * "Protect PDF" because that is the pair, not because this file needs it. Each
 * entry now carries the sentence that explains it, so the card can say why it is
 * there — and so a reviewer can tell a stale suggestion (the reason no longer
 * makes sense) from a wrong one.
 *
 * Ordering inside a list is deliberate: the first entry is the strongest next
 * step, because `relatedTools` keeps the order and the page renders the first
 * three. The fourth is the one that gets dropped on a narrow page.
 */
export interface RelatedEntry {
  slug: string;
  /** Why the person holding this tool's output needs it. One clause. */
  why: string;
}

const RELATED: Record<string, RelatedEntry[]> = {
  'image-converter': [
    { slug: 'image-compressor', why: 'The converted file is often the largest it has ever been — quality controls shrink it again.' },
    { slug: 'resize', why: 'A format change keeps the pixel count, so the next lever is the dimensions.' },
    { slug: 'favicon', why: 'One square image becomes the whole icon set.' },
    { slug: 'image-inspector', why: 'Check what the encoder actually wrote before you publish it.' },
  ],
  favicon: [
    { slug: 'crop', why: 'Choose the square that reads best at 16 px before generating the set.' },
    { slug: 'resize', why: 'The source has to be square; resizing first avoids a letterboxed icon.' },
    { slug: 'image-converter', why: 'The generated set is PNG — convert the original artwork if you need another format.' },
  ],
  'image-compressor': [
    { slug: 'image-converter', why: 'WebP or AVIF usually beats JPEG quality at the same size.' },
    { slug: 'resize', why: 'Half the dimensions is a quarter of the pixels — the biggest single saving.' },
    { slug: 'crop', why: 'Drop what the picture does not need, then compress what is left.' },
  ],
  resize: [
    { slug: 'crop', why: 'Aspect ratio and pixels are two different problems; crop fixes the frame.' },
    { slug: 'image-compressor', why: 'The resized file can be re-encoded smaller without visibly changing.' },
    { slug: 'images-to-pdf', why: 'A batch of resized pages is the usual way to build a photo PDF.' },
  ],
  crop: [
    { slug: 'resize', why: 'Crop to the region, then scale it to the exact pixels you need.' },
    { slug: 'rotate', why: 'A crop chosen off a sideways photo has to be redone once it is upright.' },
    { slug: 'image-converter', why: 'The cropped result is the natural thing to export in another format.' },
  ],
  rotate: [
    { slug: 'crop', why: 'Rotating changes which part of the frame you may want to keep.' },
    { slug: 'resize', why: 'After a rotation the dimensions swap; set them exactly.' },
    { slug: 'rotate-pdf', why: 'Same job, for a scanned document rather than a picture.' },
  ],
  'pdf-editor': [
    { slug: 'merge-pdf', why: 'Assemble the edited pages with the rest of the document set.' },
    { slug: 'split-pdf', why: 'Keep the pages you edited and drop the ones you did not.' },
    { slug: 'protect-pdf', why: 'Lock the result before sending it anywhere.' },
    { slug: 'file-inspector', why: 'Check the rebuilt document really says what it should.' },
  ],
  'merge-pdf': [
    { slug: 'split-pdf', why: 'Merging is how pages arrive; splitting is how they leave.' },
    { slug: 'rotate-pdf', why: 'Combined scans rarely share an orientation.' },
    { slug: 'protect-pdf', why: 'One password on the combined file instead of one per part.' },
  ],
  'split-pdf': [
    { slug: 'merge-pdf', why: 'Split, then merge the pieces in a different order.' },
    { slug: 'rotate-pdf', why: 'A page taken out of a scan is often the one that is sideways.' },
    { slug: 'create-zip', why: 'A hundred extracted pages is a download nobody wants one at a time.' },
    { slug: 'file-inspector', why: 'See what the split page really carries before sharing it.' },
  ],
  'rotate-pdf': [
    { slug: 'merge-pdf', why: 'Rotate each part, then combine them in order.' },
    { slug: 'split-pdf', why: 'Only some pages are usually sideways; split them out first.' },
    { slug: 'images-to-pdf', why: 'If the scan is image-only, rebuilding from the pictures is cleaner.' },
  ],
  'images-to-pdf': [
    { slug: 'merge-pdf', why: 'One PDF per folder is normal; the final document is the merge.' },
    { slug: 'split-pdf', why: 'Pull a range out of the assembled document.' },
    { slug: 'resize', why: 'Resize before assembling — a 40 MP photo makes a 40 MB page.' },
  ],
  'protect-pdf': [
    { slug: 'unlock-pdf', why: 'The other direction, when you have the password and want it gone.' },
    { slug: 'merge-pdf', why: 'Protect the merged document, not each part.' },
    { slug: 'create-zip', why: 'Bundle a protected PDF with the files it refers to.' },
  ],
  'unlock-pdf': [
    { slug: 'protect-pdf', why: 'Re-lock it with a password you can actually remember.' },
    { slug: 'unlock-office', why: 'The same job for a Word, Excel or PowerPoint file.' },
    { slug: 'file-inspector', why: 'A document that arrived locked is worth reading before you open it.' },
  ],
  'create-zip': [
    { slug: 'extract-zip', why: 'The other direction: see what someone else packed.' },
    { slug: 'split-pdf', why: 'Large PDFs come apart better than they pack.' },
    { slug: 'protect-pdf', why: 'Lock the documents inside before you send the bundle.' },
  ],
  'extract-zip': [
    { slug: 'file-inspector', why: 'An unfamiliar entry is exactly what the inspector is for.' },
    { slug: 'create-zip', why: 'Repack only the entries you kept.' },
    { slug: 'unlock-office', why: 'A password-protected document inside needs its password removed first.' },
    { slug: 'xlsx-to-csv', why: 'A workbook in the archive is one step from a CSV.' },
  ],
  'unlock-office': [
    { slug: 'unlock-pdf', why: 'The same job, for a PDF password you already know.' },
    { slug: 'extract-zip', why: 'A .docx is a ZIP; opening it that way shows every part it carries.' },
    { slug: 'file-inspector', why: 'Check for macros and embedded objects before opening the unlocked file.' },
  ],
  'xlsx-to-csv': [
    { slug: 'file-inspector', why: 'A workbook that arrived unexpectedly is worth inspecting first.' },
    { slug: 'json-formatter', why: 'CSV to JSON is the usual next conversion for an API.' },
    { slug: 'create-zip', why: 'Bundle the exported sheets into one download.' },
  ],
  'file-inspector': [
    { slug: 'hash-generator', why: 'Compare a digest against the one the sender published.' },
    { slug: 'extract-zip', why: 'Look inside an archive before opening anything from it.' },
    { slug: 'unlock-pdf', why: 'Read a document that arrived password protected.' },
    { slug: 'image-converter', why: 'A picture with unexpected bytes is fixed by re-encoding it.' },
  ],
  'json-formatter': [
    { slug: 'base64', why: 'A JSON payload is often carried base64-encoded.' },
    { slug: 'url-encoder', why: 'Query strings carry the same data, escaped.' },
    { slug: 'hash-generator', why: 'Pin a digest of the exact document you validated.' },
  ],
  base64: [
    { slug: 'json-formatter', why: 'Decoded base64 is usually JSON, and usually minified.' },
    { slug: 'url-encoder', why: 'The other common transport encoding.' },
    { slug: 'file-inspector', why: 'Decoded bytes that are not text: find out what they really are.' },
  ],
  'url-encoder': [
    { slug: 'base64', why: 'The other encoding a payload is likely to be wrapped in.' },
    { slug: 'json-formatter', why: 'A decoded query string is often a JSON body.' },
    { slug: 'hash-generator', why: 'A stable digest of the string you built.' },
  ],
  'hash-generator': [
    { slug: 'file-inspector', why: 'The same file, with the type, size and structure behind the digest.' },
    { slug: 'json-formatter', why: 'Hash the canonical, formatted form so whitespace cannot change the digest.' },
    { slug: 'base64', why: 'Encode the file you just hashed, for an API or a config.' },
  ],
};

/**
 * Slug aliases used by the curated table. `image-inspector` is not a route —
 * the inspector handles every family — so it is translated rather than allowed
 * to become a dead link.
 */
const SLUG_ALIASES: Record<string, string> = { 'image-inspector': 'file-inspector' };

/**
 * Tools that work on the same *kind* of input, derived from the capability
 * table rather than restated. This is what makes a suggestion list that is not
 * hand-curated still relevant instead of alphabetical.
 */
function sameFamily(slug: string): string[] {
  const tool = getTool(slug);
  if (!tool) return [];
  return TOOLS
    .filter((item) => item.slug !== slug && item.category === tool.category)
    .map((item) => item.slug);
}

/**
 * Related tools for a page: curated first (with its reason), then same-category
 * neighbours, then anything stable. Never a duplicate, never the tool itself,
 * and never a slug that is not registered.
 */
export function relatedToolEntries(tool: ToolDefinition, limit = 3): RelatedEntry[] {
  const entries: RelatedEntry[] = [];
  const seen = new Set<string>([tool.slug]);

  const add = (slug: string, why: string) => {
    const resolved = SLUG_ALIASES[slug] ?? slug;
    if (seen.has(resolved) || entries.length >= limit) return;
    if (!getTool(resolved)) return;
    seen.add(resolved);
    entries.push({ slug: resolved, why });
  };

  for (const entry of RELATED[tool.slug] ?? []) add(entry.slug, entry.why);

  if (entries.length < limit) {
    const category = CATEGORY_MAP[tool.category]?.name ?? 'this category';
    for (const slug of sameFamily(tool.slug)) {
      add(slug, `Another ${category.toLowerCase()} tool that works on the same kind of file.`);
    }
  }

  if (entries.length < limit) {
    for (const item of TOOLS) {
      if (item.status !== 'stable') continue;
      add(item.slug, 'Works locally too — nothing is uploaded.');
    }
  }

  return entries;
}

export function relatedTools(tool: ToolDefinition, limit = 3): ToolDefinition[] {
  return relatedToolEntries(tool, limit)
    .map((entry) => getTool(entry.slug))
    .filter((item): item is ToolDefinition => Boolean(item));
}
