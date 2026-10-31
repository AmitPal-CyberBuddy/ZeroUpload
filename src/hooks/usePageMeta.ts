import { useEffect } from 'react';
import { applyMeta } from '../seo/document';
import type { PageMeta } from '../seo/pages';

/**
 * Applies a page's title, description, canonical and social tags.
 *
 * The prerendered HTML already carries these for the page the visitor landed
 * on; this keeps them correct after client-side navigation, so the address bar,
 * the tab title, the canonical and a "copy link" preview never disagree.
 */
export function usePageMeta(meta: PageMeta, path: string): void {
  useEffect(() => {
    applyMeta(meta, path);
  }, [meta, path]);
}
