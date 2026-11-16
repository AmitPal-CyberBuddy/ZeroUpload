/**
 * The catalogue's primary taxonomy: the job you have, not the file you hold.
 *
 * `categories.ts` answers "what kind of file is this?" — five pages, one per
 * format family. That was the whole catalogue once, and it is the wrong first
 * question: someone holding a HEIC photo and someone holding a locked .docx both
 * arrive with a task, and only one of them can name the format before they start.
 *
 * `groups.ts` introduced four capability hubs — Convert, Compress, Lock, Unlock —
 * and they worked, but they covered ten of the twenty-two tools. The remaining
 * twelve had no job at all, so `/tools/` kept presenting the format list as its
 * main structure and the by-job strip read as a footnote above it. This module
 * finishes the job: every tool belongs to exactly one job, and the catalogue is
 * laid out as those jobs in this order.
 *
 * Two rules keep it honest, and both are asserted in `tests/registry.test.ts`:
 *
 *  - **Every tool is in exactly one job.** A tool in two jobs would appear twice
 *    in a catalogue whose whole purpose is to be scannable; a tool in none would
 *    be unreachable from the page that lists everything.
 *  - **A job with a page says so.** Four of these are real routes (`/tools/lock/`)
 *    with a format matrix and caveats. The rest are filtered views of the
 *    catalogue (`/tools/?job=pages`), which is why they get a `hub` of `undefined`
 *    rather than a link that would 404.
 */
import type { IconName } from '../components/ui/Icon';
import type { CapabilityId } from '../lib/capabilities/table';
import type { FormatId } from '../lib/capabilities/formats';

export interface JobGroup {
  /** Filter value: `/tools/?job=<id>`. Must never collide with a route segment. */
  id: string;
  /** Section heading, chip label and palette group name. Short and plural-safe. */
  name: string;
  /** One sentence under the heading on the homepage card. */
  blurb: string;
  /** Two-word phrase for the homepage tile, matching the category cards. */
  verb: string;
  icon: IconName;
  /** Formats the job crosses, printed beside the chip. */
  formats: FormatId[];
  /** Tools that do it, in presentation order. Every slug must exist. */
  tools: string[];
  /**
   * The capability hub this job is also a page for. Absent for the jobs that
   * only exist as a filtered catalogue view.
   */
  hub?: CapabilityId;
}

/**
 * Order is the order a visitor is likely to need them: the four jobs the product
 * is known for, then the picture-editing jobs, then the document jobs, then the
 * ones people use deliberately rather than by accident.
 *
 * `id` and `hub` coincide for the four hub jobs on purpose — the query parameter
 * is the hub id, so `/tools/convert/` and `/tools/?job=convert` mean the same
 * thing and there is only one vocabulary to learn.
 */
export const JOB_GROUPS: JobGroup[] = [
  {
    id: 'convert',
    hub: 'convert',
    name: 'Convert',
    verb: 'Change the format',
    icon: 'refresh',
    blurb:
      'Images between JPEG, PNG, WebP and AVIF, JSON and Base64 for text, URLs between escaped and plain. Encoded by your own browser.',
    formats: ['jpg', 'png', 'webp', 'avif', 'json', 'base64', 'txt'],
    tools: ['image-converter', 'favicon', 'json-formatter', 'base64', 'url-encoder'],
  },
  {
    id: 'compress',
    hub: 'compress',
    name: 'Compress',
    verb: 'Make it smaller',
    icon: 'compress',
    blurb:
      'Re-encode an image at a quality you choose, or rebuild a PDF with its unused objects removed. Every result reports the measured saving.',
    formats: ['jpg', 'png', 'webp', 'avif', 'pdf'],
    tools: ['image-compressor', 'pdf-editor'],
  },
  {
    id: 'lock',
    hub: 'lock',
    name: 'Lock',
    verb: 'Add a password',
    icon: 'lock',
    blurb: 'Encrypt a PDF with AES-256, or build an encrypted ZIP. The password never leaves the tab.',
    formats: ['pdf', 'zip'],
    tools: ['protect-pdf', 'create-zip'],
  },
  {
    id: 'unlock',
    hub: 'unlock',
    name: 'Unlock',
    verb: 'Remove a password',
    icon: 'unlock',
    blurb:
      'Remove protection from a PDF, Word, Excel or PowerPoint file you can already open. It needs the current password and never guesses.',
    formats: ['pdf', 'docx', 'xlsx', 'pptx'],
    tools: ['unlock-pdf', 'unlock-office'],
  },
  {
    id: 'reshape',
    name: 'Reshape',
    verb: 'Reframe the picture',
    icon: 'resize',
    blurb:
      'Set an exact pixel size, keep one region and drop the rest, or turn a sideways photo upright. Dimensions are never guessed.',
    formats: ['jpg', 'png', 'webp', 'avif'],
    tools: ['resize', 'crop', 'rotate'],
  },
  {
    id: 'pages',
    name: 'Pages',
    verb: 'Arrange documents',
    icon: 'files',
    blurb:
      'Merge several PDFs into one, take a range out, straighten a scanned page, or turn photos and scans into a single document.',
    formats: ['pdf', 'jpg', 'png'],
    tools: ['merge-pdf', 'split-pdf', 'rotate-pdf', 'images-to-pdf'],
  },
  {
    id: 'unpack',
    name: 'Unpack',
    verb: 'Open & export',
    icon: 'zip',
    blurb:
      'See what is inside a ZIP before extracting it, or export one worksheet from an Excel workbook to CSV.',
    formats: ['zip', 'xlsx', 'csv'],
    tools: ['extract-zip', 'xlsx-to-csv'],
  },
  {
    id: 'verify',
    name: 'Verify',
    verb: 'Look inside',
    icon: 'inspect',
    blurb:
      'Read what a file really is from its first bytes, see the metadata it carries, and compute a digest you can compare with a published one.',
    formats: ['pdf', 'zip', 'jpg', 'png'],
    tools: ['file-inspector', 'hash-generator'],
  },
];

export const JOB_MAP = Object.fromEntries(JOB_GROUPS.map((job) => [job.id, job])) as Record<string, JobGroup>;

export function isJobId(value: string): boolean {
  return Object.prototype.hasOwnProperty.call(JOB_MAP, value);
}

/** The job a tool is presented under. Every registered tool has one. */
export function jobForTool(slug: string): JobGroup | undefined {
  return JOB_GROUPS.find((job) => job.tools.includes(slug));
}

/**
 * The jobs a file-type page's tools appear in, in catalogue order.
 *
 * A category page lists tools by format; this is how it points back at the job
 * axis without restating the membership by hand.
 */
export function jobsForCategory(slugs: readonly string[]): JobGroup[] {
  const present = new Set(slugs);
  return JOB_GROUPS.filter((job) => job.tools.some((slug) => present.has(slug)));
}

/** Where a job is browsed: its hub page, or the catalogue filtered to it. */
export function jobHref(job: JobGroup): string {
  return job.hub ? `/tools/${job.id}/` : `/tools/?job=${job.id}`;
}
