import type { IconName } from '../components/ui/Icon';

export type CategoryId = 'convert' | 'compress' | 'transform' | 'pdf' | 'archive' | 'inspect' | 'dev';

export interface Category {
  id: CategoryId;
  name: string;
  icon: IconName;
  description: string;
  /** Short verb shown on the homepage tiles. */
  verb: string;
}

export const CATEGORIES: Category[] = [
  {
    id: 'convert',
    name: 'Convert',
    verb: 'Change format',
    icon: 'refresh',
    description: 'Move images between JPEG, PNG, WebP and AVIF without re-uploading anything.',
  },
  {
    id: 'compress',
    name: 'Compress',
    verb: 'Shrink files',
    icon: 'compress',
    description: 'Reduce image weight with a live quality estimate and a real before/after comparison.',
  },
  {
    id: 'transform',
    name: 'Transform',
    verb: 'Reshape',
    icon: 'resize',
    description: 'Resize, crop, rotate and flip — with pixel-accurate controls and instant previews.',
  },
  {
    id: 'pdf',
    name: 'PDF',
    verb: 'Work with pages',
    icon: 'pdf',
    description: 'Merge, split, rotate and build PDFs entirely in memory. Nothing is sent to a server.',
  },
  {
    id: 'archive',
    name: 'Archive',
    verb: 'Bundle & unpack',
    icon: 'zip',
    description: 'Create and safely extract ZIP archives with bomb protections and path sanitising.',
  },
  {
    id: 'inspect',
    name: 'Inspect',
    verb: 'Look inside',
    icon: 'inspect',
    description: 'Identify the real file type, dimensions, metadata and SHA-256 digest of any file.',
  },
  {
    id: 'dev',
    name: 'Developer',
    verb: 'Clean & encode',
    icon: 'code',
    description: 'A small set of text and encoding utilities that run on your clipboard, not a server.',
  },
];

export const CATEGORY_MAP = Object.fromEntries(CATEGORIES.map((c) => [c.id, c])) as Record<CategoryId, Category>;
