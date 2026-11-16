import { CATEGORIES } from '../registry/categories';
import { TOOLS, TOOLS_BY_CATEGORY } from '../registry/tools';
import { CATEGORY_META, HUB_META, PAGE_META, TOOL_META, type PageMeta } from './pages';
import { toolPath } from './site';
import { ENABLED_HUBS } from '../registry/groups';

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
    /*
     * The workspace is a real page with real content for a crawler — what it does,
     * which formats it recognises — even though its value is interactive. It is
     * also the page the homepage drop zone should hand to, which makes it a link
     * target that has to exist rather than be a client-only view.
     */
    { path: '/tools/workspace/', meta: PAGE_META['/tools/workspace/'] },
    { path: '/how-it-works/', meta: PAGE_META['/how-it-works/'] },
  ];

  // A category page is only worth indexing when it has something to list;
  // an empty one would be exactly the thin page this plan set out to avoid.
  for (const category of CATEGORIES) {
    const tools = TOOLS_BY_CATEGORY[category.id] ?? [];
    if (tools.length === 0) continue;
    pages.push({
      path: `/tools/${category.id}/`,
      meta: CATEGORY_META[category.id] ?? fallbackToolMeta(category.name, category.description),
    });
  }

  /*
   * Capability hubs, one per job that crosses format families. These are the
   * pages that answer "Unlock PDF and Unlock Office are the same task"; they are
   * indexable because each one is a distinct search intent ("remove a PDF
   * password") with a format matrix that no single tool page carries.
   */
  for (const hub of ENABLED_HUBS) {
    pages.push({
      path: `/tools/${hub.id}/`,
      meta: HUB_META[hub.id] ?? fallbackToolMeta(hub.name, hub.blurb),
    });
  }

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
