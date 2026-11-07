import { createContext, useContext } from 'react';

/**
 * True while a page is being rendered to static HTML at build time.
 *
 * The tool workspace is interactive by definition: it needs a browser, a file
 * picker and, for PDFs, a worker. During prerendering we render the page's real
 * content — heading, description, limits, related tools — and leave the
 * workspace as a placeholder, so crawlers and no-JS visitors get a complete
 * page without any of the heavy code being executed on the build machine.
 */
export const StaticRenderContext = createContext(false);

export function useStaticRender(): boolean {
  return useContext(StaticRenderContext);
}
