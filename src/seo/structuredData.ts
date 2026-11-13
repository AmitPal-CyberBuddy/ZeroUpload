/**
 * Schema.org markup, generated from the same registry that renders the pages.
 *
 * What is deliberately absent: `aggregateRating`, `review`, `offers`, `price`,
 * `Organization` and every other property that would have to be invented. There
 * are no ratings, no prices and no company; the markup describes pages and
 * software that exist, and nothing else.
 *
 * `FAQPage` is only emitted where the questions are visibly on the page — which
 * is why it comes from `TOOL_CONTENT`.
 */
import { CATEGORY_MAP, isCategoryId } from '../registry/categories';
import { HUB_MAP, isHubId } from '../registry/groups';
import { getTool, TOOLS, TOOLS_BY_CATEGORY } from '../registry/tools';
import { CATEGORY_META, HUB_META, PAGE_META, TOOL_META } from './pages';
import { canonicalPath } from './site';
import { TOOL_CONTENT } from './toolContent';

type Json = Record<string, unknown>;

const SITE_NAME = 'ZeroUpload';

function absolute(root: string, path: string): string {
  return `${root.replace(/\/+$/, '')}${canonicalPath(path)}`;
}

function breadcrumb(root: string, trail: Array<{ name: string; path: string }>): Json {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: absolute(root, item.path),
    })),
  };
}

function faqSchema(questions: Array<{ q: string; a: string }>): Json | null {
  if (questions.length === 0) return null;
  return {
    '@type': 'FAQPage',
    mainEntity: questions.map((entry) => ({
      '@type': 'Question',
      name: entry.q,
      acceptedAnswer: { '@type': 'Answer', text: entry.a },
    })),
  };
}

function toolSchema(slug: string, root: string): Json | null {
  const tool = getTool(slug);
  if (!tool) return null;

  const meta = TOOL_META[tool.slug];
  const path = `/tools/${tool.slug}/`;
  const url = absolute(root, path);
  const category = CATEGORY_MAP[tool.category];

  const nodes: Json[] = [
    {
      '@type': 'WebPage',
      '@id': `${url}#page`,
      url,
      name: meta?.title ?? tool.name,
      description: meta?.description ?? tool.blurb,
      inLanguage: 'en',
      isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: absolute(root, '/') },
      breadcrumb: { '@id': `${url}#breadcrumb` },
    },
    {
      ...breadcrumb(root, [
        { name: SITE_NAME, path: '/' },
        { name: 'Tools', path: '/tools/' },
        { name: category.name, path: `/tools/${category.id}/` },
        { name: tool.name, path },
      ]),
      '@id': `${url}#breadcrumb`,
    },
    {
      '@type': 'SoftwareApplication',
      '@id': `${url}#app`,
      name: tool.name,
      url,
      description: tool.description,
      applicationCategory: 'UtilitiesApplication',
      applicationSubCategory: category.name,
      operatingSystem: 'Any (modern web browser)',
      browserRequirements: 'Requires JavaScript',
      isAccessibleForFree: true,
      // Every feature below is visible on the page as a badge or in the copy.
      ...(tool.tags?.length ? { featureList: tool.tags } : {}),
      sameAs: 'https://github.com/AmitPal-CyberBuddy/ZeroUpload',
    },
  ];

  const faq = TOOL_CONTENT[tool.slug] ? faqSchema(TOOL_CONTENT[tool.slug].faq) : null;
  if (faq) nodes.push(faq);

  return { '@context': 'https://schema.org', '@graph': nodes };
}

function categorySchema(id: string, root: string): Json | null {
  if (!isCategoryId(id)) return null;
  const category = CATEGORY_MAP[id];
  const tools = TOOLS_BY_CATEGORY[id] ?? [];
  if (tools.length === 0) return null;

  const path = `/tools/${id}/`;
  const url = absolute(root, path);
  const meta = CATEGORY_META[id];

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'CollectionPage',
        '@id': `${url}#page`,
        url,
        name: meta?.title ?? `${category.name} tools`,
        description: meta?.description ?? category.description,
        inLanguage: 'en',
        isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: absolute(root, '/') },
        mainEntity: { '@id': `${url}#tools` },
        breadcrumb: { '@id': `${url}#breadcrumb` },
      },
      {
        ...breadcrumb(root, [
          { name: SITE_NAME, path: '/' },
          { name: 'Tools', path: '/tools/' },
          { name: category.name, path },
        ]),
        '@id': `${url}#breadcrumb`,
      },
      {
        '@type': 'ItemList',
        '@id': `${url}#tools`,
        name: `${category.name} tools`,
        numberOfItems: tools.length,
        itemListElement: tools.map((tool, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          name: tool.name,
          url: absolute(root, `/tools/${tool.slug}/`),
        })),
      },
    ],
  };
}

function catalogueSchema(root: string): Json {
  const url = absolute(root, '/tools/');
  const meta = PAGE_META['/tools/'];

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'CollectionPage',
        '@id': `${url}#page`,
        url,
        name: meta.title,
        description: meta.description,
        inLanguage: 'en',
        isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: absolute(root, '/') },
        mainEntity: { '@id': `${url}#tools` },
        breadcrumb: { '@id': `${url}#breadcrumb` },
      },
      {
        ...breadcrumb(root, [
          { name: SITE_NAME, path: '/' },
          { name: 'Tools', path: '/tools/' },
        ]),
        '@id': `${url}#breadcrumb`,
      },
      {
        '@type': 'ItemList',
        '@id': `${url}#tools`,
        name: 'All ZeroUpload tools',
        numberOfItems: TOOLS.length,
        itemListElement: TOOLS.map((tool, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          name: tool.name,
          url: absolute(root, `/tools/${tool.slug}/`),
        })),
      },
    ],
  };
}

function homeSchema(root: string): Json {
  const url = absolute(root, '/');
  const meta = PAGE_META['/'];

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': `${url}#website`,
        url,
        name: SITE_NAME,
        description: meta.description,
        inLanguage: 'en',
        // No `publisher`: an Organization node would need details this project
        // does not have, and inventing them is exactly what this plan forbids.
      },
      {
        '@type': 'WebPage',
        '@id': `${url}#page`,
        url,
        name: meta.title,
        description: meta.description,
        inLanguage: 'en',
        isPartOf: { '@id': `${url}#website` },
      },
      {
        '@type': 'WebApplication',
        '@id': `${url}#app`,
        name: SITE_NAME,
        url,
        description: meta.description,
        applicationCategory: 'UtilitiesApplication',
        operatingSystem: 'Any (modern web browser)',
        browserRequirements: 'Requires JavaScript',
        isAccessibleForFree: true,
      },
    ],
  };
}

function docSchema(root: string): Json {
  const url = absolute(root, '/how-it-works/');
  const meta = PAGE_META['/how-it-works/'];

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        '@id': `${url}#page`,
        url,
        name: meta.title,
        description: meta.description,
        inLanguage: 'en',
        isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: absolute(root, '/') },
        breadcrumb: { '@id': `${url}#breadcrumb` },
      },
      {
        ...breadcrumb(root, [
          { name: SITE_NAME, path: '/' },
          { name: 'How it works', path: '/how-it-works/' },
        ]),
        '@id': `${url}#breadcrumb`,
      },
    ],
  };
}

/** JSON-LD for a canonical path, or `null` for pages that should not carry any. */
/**
 * The workspace page: a WebApplication, like a tool page, but described by what it
 * accepts rather than what it produces. No `aggregateRating`, no `offers`, no
 * `author` — none of that is true, and inventing it is how sites get penalised.
 */
function workspaceSchema(root: string): Json | null {
  const path = '/tools/workspace/';
  const url = absolute(root, path);
  const meta = PAGE_META[path];

  return {
    '@context': 'https://schema.org',
    '@graph': [
      /*
       * Both nodes: a `WebPage` because every indexable page on this site is one
       * and the breadcrumb check requires it, and a `WebApplication` because the
       * workspace really is an application. They share a URL and describe the same
       * thing at different levels, which is what the schema allows.
       */
      {
        '@type': 'WebPage',
        '@id': `${url}#page`,
        url,
        name: meta?.title ?? 'ZeroUpload Workspace',
        description: meta?.description ?? 'Drop a file and see what can be done with it, entirely in the browser.',
        inLanguage: 'en',
        isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: absolute(root, '/') },
        mainEntity: { '@id': `${url}#app` },
        breadcrumb: { '@id': `${url}#breadcrumb` },
      },
      {
        '@type': 'WebApplication',
        '@id': `${url}#app`,
        url,
        name: meta?.title ?? 'ZeroUpload Workspace',
        description: meta?.description ?? 'Drop a file and see what can be done with it, entirely in the browser.',
        applicationCategory: 'UtilitiesApplication',
        operatingSystem: 'Any browser',
        inLanguage: 'en',
        isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: absolute(root, '/') },
        breadcrumb: { '@id': `${url}#breadcrumb` },
      },
      {
        ...breadcrumb(root, [
          { name: SITE_NAME, path: '/' },
          { name: 'Tools', path: '/tools/' },
          { name: 'Workspace', path },
        ]),
        '@id': `${url}#breadcrumb`,
      },
    ],
  };
}

/**
 * A capability hub is a collection page whose members are the tools for each
 * format — the same shape as a category page, which is what it is in everything
 * but name. The description comes from `HUB_META` so the schema and the `<title>`
 * cannot say different things.
 */
function hubSchema(id: string, root: string): Json | null {
  const hub = HUB_MAP[id];
  if (!hub || !hub.enabled) return null;
  const path = `/tools/${hub.id}/`;
  const url = absolute(root, path);
  const tools = hub.tools.map((slug) => getTool(slug)).filter((tool): tool is NonNullable<typeof tool> => Boolean(tool));
  if (tools.length === 0) return null;

  const meta = HUB_META[id];

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'CollectionPage',
        '@id': `${url}#page`,
        url,
        name: meta?.title ?? hub.name,
        description: meta?.description ?? hub.blurb,
        inLanguage: 'en',
        isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: absolute(root, '/') },
        mainEntity: { '@id': `${url}#tools` },
        breadcrumb: { '@id': `${url}#breadcrumb` },
      },
      {
        ...breadcrumb(root, [
          { name: SITE_NAME, path: '/' },
          { name: 'Tools', path: '/tools/' },
          { name: hub.name, path },
        ]),
        '@id': `${url}#breadcrumb`,
      },
      {
        '@type': 'ItemList',
        '@id': `${url}#tools`,
        name: `${hub.name} tools`,
        numberOfItems: tools.length,
        itemListElement: tools.map((tool, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          name: tool.name,
          url: absolute(root, `/tools/${tool.slug}/`),
        })),
      },
    ],
  };
}

export function structuredDataFor(path: string, root: string): string | null {
  const canonical = canonicalPath(path);

  let data: Json | null = null;

  if (canonical === '/') data = homeSchema(root);
  else if (canonical === '/tools/') data = catalogueSchema(root);
  /*
   * The workspace is an interactive page, but it is also a landing page with a
   * real description of what the platform recognises — a crawler gets the same
   * WebApplication node a tool page gets, minus the tool-specific claims.
   */
  else if (canonical === '/tools/workspace/') data = workspaceSchema(root);
  else if (canonical === '/how-it-works/') data = docSchema(root);
  else {
    const segments = canonical.split('/').filter(Boolean);
    if (segments.length === 2 && segments[0] === 'tools') {
      const key = segments[1];
      if (isHubId(key)) data = hubSchema(key, root);
      else data = isCategoryId(key) ? categorySchema(key, root) : toolSchema(key, root);
    }
  }

  return data ? JSON.stringify(data) : null;
}

/** The `<script>` element for a JSON-LD payload, safe inside HTML. */
export function jsonLdScript(json: string): string {
  return `<script type="application/ld+json">${json.replace(/</g, '\\u003c')}</script>`;
}
