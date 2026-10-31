import { useEffect } from 'react';

const BASE = 'ZeroUpload — Convert. Compress. Transform. Locally.';

/** Keeps the tab title meaningful per route (screen readers announce it). */
export function useDocumentTitle(title?: string): void {
  useEffect(() => {
    document.title = title ? `${title} · ZeroUpload` : BASE;
  }, [title]);
}
