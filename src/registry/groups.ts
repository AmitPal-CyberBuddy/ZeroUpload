/**
 * How the twenty-two tool pages are presented as a smaller number of jobs.
 *
 * The complaint this answers is concrete: "Unlock PDF" and "Unlock Office" were
 * two catalogue entries for one task, and "Image Converter" listed formats in its
 * blurb while the visitor still had to work out which tool to open for a HEIC
 * file. Neither was wrong — both worked — but the catalogue asked the visitor to
 * hold the product's internal structure in their head.
 *
 * Two things change here, and they are different mechanisms:
 *
 *  - **Groups** merge pages that do the same job on different formats. The URLs
 *    do not move: `/tools/unlock-pdf/` and `/tools/unlock-office/` keep working
 *    and keep their search traffic, but they are presented as one capability with
 *    the format made explicit, and they share one hub page.
 *  - **Formats** become a visible property rather than prose. "Convert: JPG, PNG,
 *    WEBP, AVIF, GIF, BMP, SVG → JPG, PNG, WEBP, AVIF" says what the group does;
 *    the workspace then narrows that list to what the file in hand can become.
 *
 * A capability hub is a *page*, not a router change: `enabled` decides whether it
 * appears in the sitemap, the catalogue and the command palette. That keeps the
 * prerenderer's "a route that exists but refuses to work is worse than an absent
 * one" rule intact.
 */
import type { CapabilityId } from '../lib/capabilities/table';
import type { FormatId } from '../lib/capabilities/formats';

export interface CapabilityHub {
  /** URL segment: `/tools/<id>/`. */
  id: string;
  capability: CapabilityId;
  /** Tab label in the catalogue. Short, because it sits beside the others. */
  name: string;
  /** `<h1>` of the hub page. */
  heading: string;
  /** One sentence under the heading. */
  blurb: string;
  /** Formats this capability crosses, printed as a row of chips. */
  formats: FormatId[];
  /**
   * Tools that perform it. These keep their own URLs and pages; the hub is a
   * front door, not a replacement, so no existing link breaks and no search
   * result loses its landing page.
   */
  tools: string[];
  /** Shown when the capability is narrower than the name suggests. */
  caveat?: string;
  /** False while the capability is not worth a page of its own yet. */
  enabled: boolean;
}

/**
 * The hubs worth having, in catalogue order.
 *
 * Deliberately not one hub per family — "all PDF tools" already exists as
 * `/tools/pdf/`. These cut across families, which is the point: the visitor
 * holding a file knows its format, and someone browsing knows the job.
 *
 * A hub also has to span more than one tool. "Archives" was drafted and cut for
 * exactly that reason: it had one tool, so it would have been a tool page with an
 * extra click, and a test asserts hubs have at least two. The ZIP work is
 * presented on `/tools/archive/`, which is where someone looking for it already
 * goes.
 */
export const CAPABILITY_HUBS: CapabilityHub[] = [
  {
    id: 'convert',
    capability: 'convert',
    name: 'Convert',
    heading: 'Convert a file to the format you need.',
    blurb:
      'Images between JPEG, PNG, WebP and AVIF — whichever formats your browser can encode. JSON and Base64 for text. The file is decoded by your own browser and never leaves it.',
    formats: ['jpg', 'png', 'webp', 'avif', 'gif', 'bmp', 'svg', 'heic', 'json', 'base64'],
    tools: ['image-converter', 'favicon', 'json-formatter', 'base64'],
    caveat:
      'There is no Office → PDF or PDF → Word here. Both need a layout engine to be faithful, and a browser tab cannot reproduce one; printing to PDF from the application is the honest route.',
    enabled: true,
  },
  {
    id: 'compress',
    capability: 'compress',
    name: 'Compress',
    heading: 'Make a file smaller without guessing.',
    blurb:
      'Re-encode images at a quality you choose, or rebuild a PDF with its unused objects removed. Every result reports the measured byte saving — and says so when a file would get bigger.',
    formats: ['jpg', 'png', 'webp', 'avif', 'pdf'],
    tools: ['image-compressor', 'pdf-editor'],
    caveat: 'Lossy re-encoding is irreversible. The original on your disk is never modified.',
    enabled: true,
  },
  {
    id: 'lock',
    capability: 'lock',
    name: 'Lock',
    heading: 'Put a password on a file.',
    blurb:
      'Encrypt a PDF with AES-256, or build an encrypted ZIP. The password is used in your browser and is never stored, logged or sent anywhere.',
    formats: ['pdf', 'zip'],
    tools: ['protect-pdf', 'create-zip'],
    caveat:
      'PDF "permissions" (no printing, no copying) are a request a reader may ignore — the app says which parts are enforced and which are not.',
    enabled: true,
  },
  {
    id: 'unlock',
    capability: 'unlock',
    name: 'Unlock',
    heading: 'Remove a password you already know.',
    blurb:
      'PDF, Word, Excel and PowerPoint files that you can open are decrypted locally, so you never need the password again. This is a remover, not a cracker: it needs the current password and makes no attempt to guess one.',
    formats: ['pdf', 'docx', 'xlsx', 'pptx'],
    tools: ['unlock-pdf', 'unlock-office'],
    caveat: 'If you do not know the password, this cannot help, and nothing here will try.',
    enabled: true,
  },
];

export const HUB_MAP = Object.fromEntries(CAPABILITY_HUBS.map((hub) => [hub.id, hub])) as Record<
  string,
  CapabilityHub
>;

/** Hubs that are worth a page, a catalogue entry and a sitemap URL. */
export const ENABLED_HUBS = CAPABILITY_HUBS.filter((hub) => hub.enabled);

export function isHubId(value: string): boolean {
  return Object.prototype.hasOwnProperty.call(HUB_MAP, value) && HUB_MAP[value].enabled;
}

/** The hub a tool is presented under, if any. */
export function hubForTool(slug: string): CapabilityHub | undefined {
  return CAPABILITY_HUBS.find((hub) => hub.tools.includes(slug));
}

/**
 * Related tools, refined by the group a tool belongs to.
 *
 * The old `RELATED` map was hand-curated per slug and had drifted: unlocking a PDF
 * suggested unlocking an Office file but not the capability they share. This
 * derives the *first* suggestion from the hub, then falls back to the curated list
 * so each page keeps its own editorial judgement about what comes next.
 */
export function siblingsOf(slug: string): string[] {
  const hub = hubForTool(slug);
  return hub ? hub.tools.filter((tool) => tool !== slug) : [];
}
