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
    description: 'Change images between JPEG, PNG, WebP and AVIF, with transparency and quality under your control.',
  },
  {
    id: 'compress',
    name: 'Compress',
    verb: 'Shrink files',
    icon: 'compress',
    description: 'Make images lighter without guessing, and see the real before-and-after size.',
  },
  {
    id: 'transform',
    name: 'Transform',
    verb: 'Reshape',
    icon: 'resize',
    description: 'Resize, crop, rotate and flip with precise controls and an instant preview.',
  },
  {
    id: 'pdf',
    name: 'PDF',
    verb: 'Work with pages',
    icon: 'pdf',
    description: 'Merge, split, rotate, protect and unlock PDFs. Nothing is sent to a server.',
  },
  {
    id: 'archive',
    name: 'Archive',
    verb: 'Bundle & unpack',
    icon: 'zip',
    description: 'Bundle files into ZIPs — with or without a password — and open them safely.',
  },
  {
    id: 'inspect',
    name: 'Inspect',
    verb: 'Look inside',
    icon: 'inspect',
    description: 'Identify a file from its contents: real type, dimensions, metadata and digest.',
  },
  {
    id: 'dev',
    name: 'Developer',
    verb: 'Clean & encode',
    icon: 'code',
    description: 'Text, JSON and encoding utilities for everyday development work, run locally.',
  },
];

export const CATEGORY_MAP = Object.fromEntries(CATEGORIES.map((c) => [c.id, c])) as Record<CategoryId, Category>;
