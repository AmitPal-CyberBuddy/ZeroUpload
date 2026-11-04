import { describe, expect, it } from 'vitest';
import { CATEGORIES } from '../src/registry/categories';
import { TOOLS, TOOLS_BY_CATEGORY } from '../src/registry/tools';
import { prerenderRoutes } from '../src/seo/routes';
import { jsonLdScript, structuredDataFor } from '../src/seo/structuredData';
import { TOOL_CONTENT } from '../src/seo/toolContent';

const ROOT = 'https://example.test/site';
const routes = prerenderRoutes().filter((route) => !route.path.startsWith('/404'));

function parse(path: string): { '@context': string; '@graph': Array<Record<string, unknown>> } {
  const json = structuredDataFor(path, ROOT);
  expect(json, path).toBeTruthy();
  return JSON.parse(json!);
}

function typesFor(path: string): string[] {
  return parse(path)['@graph'].map((node) => node['@type'] as string);
}

/** Walks every node and key, so a forbidden property cannot hide in a child. */
function keys(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const item of node) keys(item, out);
  } else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      out.push(key);
      keys(value, out);
    }
  }
  return out;
}

describe('structured data coverage', () => {
  it('emits valid JSON on every indexable page', () => {
    for (const route of routes) {
      const data = parse(route.path);
      expect(data['@context'], route.path).toBe('https://schema.org');
      expect(data['@graph'].length, route.path).toBeGreaterThan(0);
    }
  });

  it('uses the right types for each kind of page', () => {
    expect(typesFor('/')).toEqual(['WebSite', 'WebPage', 'WebApplication']);
    expect(typesFor('/tools/')).toEqual(['CollectionPage', 'BreadcrumbList', 'ItemList']);
    expect(typesFor('/how-it-works/')).toEqual(['WebPage', 'BreadcrumbList']);

    for (const category of CATEGORIES) {
      expect(typesFor(`/tools/${category.id}/`), category.id).toEqual([
        'CollectionPage',
        'BreadcrumbList',
        'ItemList',
      ]);
    }

    for (const tool of TOOLS.filter((t) => t.status !== 'soon')) {
      expect(typesFor(`/tools/${tool.slug}/`), tool.slug).toContain('SoftwareApplication');
    }
  });

  it('emits nothing for pages that must stay out of the index', () => {
    expect(structuredDataFor('/404/', ROOT)).toBeNull();
    expect(structuredDataFor('/does-not-exist/', ROOT)).toBeNull();
  });
});

describe('structured data accuracy', () => {
  it('points every page node at its own canonical URL', () => {
    for (const route of routes) {
      const page = parse(route.path)['@graph'].find((node) =>
        ['WebPage', 'CollectionPage'].includes(node['@type'] as string),
      );
      expect(page, route.path).toBeTruthy();
      expect(page!['url'], route.path).toBe(`${ROOT}${route.path}`);
    }
  });

  it('ends every breadcrumb trail on the page it describes', () => {
    for (const route of routes) {
      if (route.path === '/') continue;
      const list = parse(route.path)['@graph'].find(
        (node) => node['@type'] === 'BreadcrumbList',
      ) as { itemListElement: Array<{ position: number; item: string; name: string }> };
      expect(list, route.path).toBeTruthy();
      const last = list.itemListElement.at(-1)!;
      expect(last.item, route.path).toBe(`${ROOT}${route.path}`);
      expect(list.itemListElement[0].item).toBe(`${ROOT}/`);
      list.itemListElement.forEach((entry, index) => expect(entry.position).toBe(index + 1));
    }
  });

  it('lists every tool exactly once on the catalogue and on each group page', () => {
    const catalogue = parse('/tools/')['@graph'].find((n) => n['@type'] === 'ItemList') as {
      numberOfItems: number;
      itemListElement: Array<{ name: string; url: string; position: number }>;
    };
    expect(catalogue.numberOfItems).toBe(TOOLS.length);
    expect(catalogue.itemListElement).toHaveLength(TOOLS.length);
    expect(new Set(catalogue.itemListElement.map((i) => i.url)).size).toBe(TOOLS.length);

    for (const category of CATEGORIES) {
      const list = parse(`/tools/${category.id}/`)['@graph'].find(
        (n) => n['@type'] === 'ItemList',
      ) as { numberOfItems: number; itemListElement: Array<{ name: string; url: string }> };
      const tools = TOOLS_BY_CATEGORY[category.id] ?? [];
      expect(list.numberOfItems, category.id).toBe(tools.length);
      expect(list.itemListElement.map((i) => i.url)).toEqual(
        tools.map((tool) => `${ROOT}/tools/${tool.slug}/`),
      );
    }
  });

  it('describes the tool that the page is about', () => {
    for (const tool of TOOLS.filter((t) => t.status !== 'soon')) {
      const app = parse(`/tools/${tool.slug}/`)['@graph'].find(
        (n) => n['@type'] === 'SoftwareApplication',
      ) as Record<string, unknown>;
      expect(app['name'], tool.slug).toBe(tool.name);
      expect(app['url'], tool.slug).toBe(`${ROOT}/tools/${tool.slug}/`);
      expect(app['isAccessibleForFree'], tool.slug).toBe(true);
      expect(app['applicationCategory'], tool.slug).toBe('UtilitiesApplication');
    }
  });

  it('marks up only questions that are visibly on the page', () => {
    for (const tool of TOOLS.filter((t) => t.status !== 'soon')) {
      const faq = parse(`/tools/${tool.slug}/`)['@graph'].find((n) => n['@type'] === 'FAQPage');
      if (!faq) continue;
      const entities = faq['mainEntity'] as Array<{ name: string; acceptedAnswer: { text: string } }>;
      const visible = TOOL_CONTENT[tool.slug].faq;
      expect(entities.map((e) => e.name), tool.slug).toEqual(visible.map((f) => f.q));
      expect(entities.map((e) => e.acceptedAnswer.text)).toEqual(visible.map((f) => f.a));
    }
  });

  it('never invents ratings, reviews, prices or an organization', () => {
    const forbidden = [
      'aggregateRating',
      'ratingValue',
      'review',
      'reviewCount',
      'offers',
      'price',
      'priceCurrency',
      'Organization',
      'award',
    ];
    for (const route of routes) {
      const tree = parse(route.path);
      const found = keys(tree);
      for (const property of forbidden) {
        expect(found, `${route.path} → ${property}`).not.toContain(property);
      }
    }
  });
});

describe('jsonLdScript', () => {
  it('cannot be closed early by content', () => {
    const script = jsonLdScript(JSON.stringify({ note: '</script><script>alert(1)</script>' }));
    expect(script.match(/<\/script>/g)).toHaveLength(1);
    expect(script).toContain('\\u003c');
  });

  it('declares itself as JSON-LD', () => {
    expect(jsonLdScript('{}')).toMatch(/^<script type="application\/ld\+json">/);
  });
});
