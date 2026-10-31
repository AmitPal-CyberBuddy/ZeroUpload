import { TOOLS } from '../registry/tools';
import { PAGE_META, TOOL_META, type PageMeta } from './pages';
import { toolPath } from './site';

export interface PrerenderRoute {
  /** Canonical path with a trailing slash. */
  path: string;
  meta: PageMeta;
}

/** Metadata for a tool that has no hand-written entry yet. */
function fallbackToolMeta(name: string, blurb: string): PageMeta {
  return { title: `${name} · ZeroUpload`, description: blurb };
}

/**
 * Every page that should exist as static HTML and appear in the sitemap.
 * `soon` tools are excluded: a page for something that cannot be used yet has
 * no business in an index. Tools hidden behind an interoperability flag never
 * reach `TOOLS` at all.
 */
export function prerenderRoutes(): PrerenderRoute[] {
  const pages: PrerenderRoute[] = [
    { path: '/', meta: PAGE_META['/'] },
    { path: '/tools/', meta: PAGE_META['/tools/'] },
    { path: '/how-it-works/', meta: PAGE_META['/how-it-works/'] },
  ];

  for (const tool of TOOLS) {
    if (tool.status === 'soon') continue;
    pages.push({
      path: toolPath(tool.slug),
      meta: TOOL_META[tool.slug] ?? fallbackToolMeta(tool.name, tool.blurb),
    });
  }

  return pages;
}

/** Pages that exist only to forward an old URL to a new one. Never indexed. */
export const REDIRECT_ROUTES: Array<{ path: string; to: string }> = [
  { path: '/architecture/', to: '/how-it-works/' },
];
