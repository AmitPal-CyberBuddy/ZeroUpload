/**
 * Which tool does what to which kind of file, in one table.
 *
 * The platform used to answer this question with prose: six image tools, seven
 * PDF tools, and a catalogue that made the visitor work out which of them applied
 * to the file in their hand. This module is the machine-readable version of that
 * knowledge, and three surfaces read it:
 *
 *  - the **workspace** at `/tools/workspace/`, which takes any file and offers
 *    only the operations that apply to it,
 *  - the **capability pages** (`/tools/convert/`, `/tools/lock/`), which list the
 *    formats and actions for someone browsing rather than holding a file,
 *  - the **duplicate grouping** the registry uses to keep related tools adjacent.
 *
 * It is data, not logic, and it is deliberately exhaustive rather than clever: a
 * capability that is missing here is missing from the product, so the registry
 * test asserts that every `available` action names a tool that exists.
 */
import { FORMATS, type FileFamily, type FormatId } from './formats';

/** What an operation does *to* a file. The verbs the product is organised around. */
export type CapabilityId =
  | 'convert'
  | 'compress'
  | 'resize'
  | 'crop'
  | 'rotate'
  | 'organise'
  | 'split'
  | 'merge'
  | 'lock'
  | 'unlock'
  | 'bundle'
  | 'extract'
  | 'export'
  | 'inspect';

export interface CapabilityInfo {
  id: CapabilityId;
  /** The noun a person uses, and the name of the capability page. */
  name: string;
  /** Verb phrase for a button: "Convert", "Remove a password". */
  verb: string;
  /** One line, shown under the action. */
  blurb: string;
}

export const CAPABILITIES: Record<CapabilityId, CapabilityInfo> = {
  convert: {
    id: 'convert',
    name: 'Convert',
    verb: 'Convert format',
    blurb: 'Change a file from one format to another, keeping what the target format allows.',
  },
  compress: {
    id: 'compress',
    name: 'Compress',
    verb: 'Make it smaller',
    blurb: 'Re-encode at a lower quality or resolution and report the real byte saving.',
  },
  resize: {
    id: 'resize',
    name: 'Resize',
    verb: 'Resize',
    blurb: 'Set an exact width and height, or scale proportionally.',
  },
  crop: {
    id: 'crop',
    name: 'Crop',
    verb: 'Crop',
    blurb: 'Keep part of the picture and discard the rest.',
  },
  rotate: {
    id: 'rotate',
    name: 'Rotate & flip',
    verb: 'Rotate or flip',
    blurb: 'Turn in 90° steps or mirror horizontally and vertically.',
  },
  organise: {
    id: 'organise',
    name: 'Organise pages',
    verb: 'Reorder pages',
    blurb: 'Reorder, add and remove pages, and add text or images.',
  },
  split: {
    id: 'split',
    name: 'Split & extract',
    verb: 'Split or extract pages',
    blurb: 'Take a range of pages out, or produce one document per page.',
  },
  merge: {
    id: 'merge',
    name: 'Merge',
    verb: 'Merge documents',
    blurb: 'Combine several documents into one, in the order you choose.',
  },
  lock: {
    id: 'lock',
    name: 'Add a password',
    verb: 'Add a password',
    blurb: 'Encrypt the file so it needs a password to open.',
  },
  unlock: {
    id: 'unlock',
    name: 'Remove a password',
    verb: 'Remove the password',
    blurb: 'Remove protection from a file you can already open, so you never need the password again.',
  },
  bundle: {
    id: 'bundle',
    name: 'Bundle into an archive',
    verb: 'Bundle into a ZIP',
    blurb: 'Package one or more files into a ZIP, optionally encrypted.',
  },
  extract: {
    id: 'extract',
    name: 'Open an archive',
    verb: 'Open the archive',
    blurb: 'See what is inside before extracting, then download what you need.',
  },
  export: {
    id: 'export',
    name: 'Export',
    verb: 'Export',
    blurb: 'Turn the file into a plain format another program can read.',
  },
  inspect: {
    id: 'inspect',
    name: 'Inspect',
    verb: 'Inspect this file',
    blurb: 'Read its real type, dimensions, metadata and digest without changing anything.',
  },
};

export interface CapabilityEdge {
  capability: CapabilityId;
  /** The tool that performs it. Must exist in the registry. */
  tool: string;
  /** Button label where the generic verb is not specific enough. */
  label?: string;
  /** Why this combination is worth offering, when it is not obvious. */
  note?: string;
  /**
   * False when the code is compiled in but the output has not been verified
   * against the real application (Office encryption). Routing hides it, and the
   * workspace says so rather than offering a button that 404s.
   */
  available?: boolean;
  /** Accepted input formats; omitted means every format in the family. */
  accepts?: FormatId[];
  /** Output formats this edge can produce, where the tool has a fixed list. */
  produces?: FormatId[];
}

/**
 * The table. One entry per (family, capability) pair.
 *
 * Ordering within a family is the order the workspace shows the actions in: the
 * thing people came for first, recovery options after.
 */
export const CAPABILITY_TABLE: Record<FileFamily, CapabilityEdge[]> = {
  image: [
    {
      capability: 'convert',
      tool: 'image-converter',
      accepts: ['jpg', 'png', 'webp', 'avif', 'gif', 'bmp', 'svg', 'heic'],
      // AVIF and WebP depend on the browser's encoder; the tool probes for them.
      produces: ['jpg', 'png', 'webp', 'avif'],
      label: 'Convert to another image format',
    },
    {
      capability: 'compress',
      tool: 'image-compressor',
      label: 'Compress this image',
      note: 'Reports the real byte saving, and says so when a file would grow.',
    },
    {
      capability: 'resize',
      tool: 'resize',
      label: 'Resize to exact pixels',
    },
    {
      capability: 'crop',
      tool: 'crop',
      label: 'Crop a region',
    },
    {
      capability: 'rotate',
      tool: 'rotate',
      label: 'Rotate or flip',
    },
    {
      capability: 'convert',
      tool: 'favicon',
      accepts: ['png', 'jpg', 'webp'],
      produces: ['png'],
      label: 'Generate a favicon set',
      note: 'One square image in, the full icon set plus a manifest out.',
    },
    {
      capability: 'inspect',
      tool: 'file-inspector',
      label: 'Inspect the image',
    },
    {
      capability: 'bundle',
      tool: 'create-zip',
      label: 'Bundle it into a ZIP',
    },
  ],

  pdf: [
    { capability: 'organise', tool: 'pdf-editor', label: 'Reorder or edit pages' },
    { capability: 'merge', tool: 'merge-pdf', label: 'Merge with other PDFs' },
    { capability: 'split', tool: 'split-pdf', label: 'Split or extract pages' },
    { capability: 'rotate', tool: 'rotate-pdf', label: 'Rotate pages' },
    { capability: 'compress', tool: 'pdf-editor', label: 'Rebuild at a smaller size', note: 'Removes unused objects; the page content is re-encoded, so keep the original.' },
    { capability: 'lock', tool: 'protect-pdf', label: 'Add a password (AES-256)' },
    {
      capability: 'unlock',
      tool: 'unlock-pdf',
      label: 'Remove a known password',
      note: 'Needs the current password. It is not a cracker and does not pretend to be.',
    },
    { capability: 'inspect', tool: 'file-inspector', label: 'Inspect the PDF' },
    { capability: 'bundle', tool: 'create-zip', label: 'Bundle this PDF into a ZIP' },
  ],

  archive: [
    { capability: 'extract', tool: 'extract-zip', label: 'See what is inside' },
    { capability: 'inspect', tool: 'file-inspector', label: 'Inspect the archive' },
    { capability: 'bundle', tool: 'create-zip', label: 'Rebuild as a new ZIP' },
  ],

  spreadsheet: [
    {
      capability: 'export',
      tool: 'xlsx-to-csv',
      label: 'Export a sheet to CSV',
      produces: ['csv'],
      note: 'One worksheet, values only — formulas, styles and other sheets are not carried over.',
    },
    {
      capability: 'unlock',
      tool: 'unlock-office',
      label: 'Remove a known password',
      accepts: ['xlsx'],
    },
    { capability: 'inspect', tool: 'file-inspector', label: 'Inspect the workbook' },
    { capability: 'bundle', tool: 'create-zip', label: 'Bundle it into a ZIP' },
  ],

  office: [
    { capability: 'unlock', tool: 'unlock-office', label: 'Remove a known password' },
    {
      capability: 'lock',
      tool: 'encrypt-office',
      label: 'Add a password',
      available: false,
      note: 'Written and spec-conformant, but switched off until the output has been round-tripped through real Word, Excel and PowerPoint.',
    },
    {
      capability: 'convert',
      tool: 'images-to-pdf',
      label: 'Turn pages into a PDF',
      available: false,
      note: 'Office → PDF is not offered: doing it faithfully needs layout rendering a browser tab cannot reproduce. Print to PDF from the application instead.',
    },
    { capability: 'inspect', tool: 'file-inspector', label: 'Inspect the document' },
    { capability: 'bundle', tool: 'create-zip', label: 'Bundle it into a ZIP' },
  ],

  text: [
    { capability: 'convert', tool: 'json-formatter', accepts: ['json'], label: 'Format or validate this JSON' },
    { capability: 'convert', tool: 'base64', accepts: ['txt', 'base64'], label: 'Encode or decode as Base64' },
    { capability: 'convert', tool: 'url-encoder', accepts: ['txt'], label: 'Percent-encode or decode' },
    { capability: 'inspect', tool: 'file-inspector', label: 'Inspect the text file' },
    { capability: 'bundle', tool: 'create-zip', label: 'Bundle it into a ZIP' },
    { capability: 'merge', tool: 'images-to-pdf', available: false, note: 'Text files cannot be assembled into a PDF here; there is no layout engine.' },
  ],

  video: [
    { capability: 'inspect', tool: 'file-inspector', label: 'Inspect the video' },
    { capability: 'bundle', tool: 'create-zip', label: 'Bundle it into a ZIP' },
  ],

  audio: [
    { capability: 'inspect', tool: 'file-inspector', label: 'Inspect the audio file' },
    { capability: 'bundle', tool: 'create-zip', label: 'Bundle it into a ZIP' },
  ],

  unknown: [
    { capability: 'inspect', tool: 'file-inspector', label: 'Find out what this is' },
    { capability: 'bundle', tool: 'create-zip', label: 'Bundle it into a ZIP' },
  ],
};

/** Edges that can actually be reached today. */
export function availableEdges(family: FileFamily): CapabilityEdge[] {
  return CAPABILITY_TABLE[family].filter((edge) => edge.available !== false);
}

/** Every edge, including the ones a flag or a verification gate hides. */
export function allEdges(family: FileFamily): CapabilityEdge[] {
  return CAPABILITY_TABLE[family];
}

/**
 * The formats a file of this family can be turned into.
 *
 * `from` is the format the file actually is. Without it the list is the union of
 * everything any tool can emit, which for an image is "can become JPG, PNG, WebP,
 * AVIF" — and the workspace then offers to convert a PNG *to PNG*, which is not a
 * conversion. Passing the source drops it from the targets so the row only ever
 * names a real destination.
 */
export function convertibleFormats(family: FileFamily, from?: FormatId): FormatId[] {
  const out = new Set<FormatId>();
  for (const edge of CAPABILITY_TABLE[family]) {
    if (edge.available === false) continue;
    for (const format of edge.produces ?? []) {
      if (format !== from) out.add(format);
    }
  }
  return [...out];
}

/**
 * The rows a tool's header should print: one per capability it performs, with
 * every format it reads and writes.
 *
 * Built from the edges rather than restated, so a tool cannot claim a format the
 * table does not give it. Two things about the raw edges make the naive
 * "one row per edge" version wrong, and both are visible on the rendered page:
 *
 *  - `file-inspector` and `create-zip` accept *any* file, so they appear in all
 *    nine families and none of those edges names a format. Row-per-edge printed
 *    nine empty "Inspect" rows above the inspector's own drop zone.
 *  - a tool that covers several families would otherwise repeat its capability
 *    once per family. Rows are merged by capability name and their formats
 *    unioned, so "Bundle" reads once with the formats all bundled families allow.
 */
export interface ToolFormatRow {
  capability: string;
  from: string[];
  to: string[];
}

export function toolFormatRows(slug: string): ToolFormatRow[] {
  const rows: ToolFormatRow[] = [];
  const label = (format: FormatId) => FORMATS[format]?.label ?? format.toUpperCase();

  for (const edges of Object.values(CAPABILITY_TABLE)) {
    for (const edge of edges) {
      if (edge.tool !== slug || edge.available === false) continue;

      const from = (edge.accepts ?? []).map(label);
      const to = (edge.produces ?? []).map(label);
      if (from.length === 0 && to.length === 0) continue;

      const name = CAPABILITIES[edge.capability].name;
      const existing = rows.find((row) => row.capability === name);
      if (!existing) {
        rows.push({ capability: name, from: [...from], to: [...to] });
        continue;
      }
      for (const format of from) if (!existing.from.includes(format)) existing.from.push(format);
      for (const format of to) if (!existing.to.includes(format)) existing.to.push(format);
    }
  }

  return rows;
}
