import { describe, expect, it } from 'vitest';
import { TOOLS } from '../src/registry/tools';
import { PAGE_META, TOOL_META } from '../src/seo/pages';
import { prerenderRoutes, REDIRECT_ROUTES } from '../src/seo/routes';
import { canonicalPath, toolPath } from '../src/seo/site';
import { headTags } from '../src/seo/document';

const routes = prerenderRoutes();
const ROOT = 'https://example.test/site';

describe('canonical paths', () => {
  it('normalises to one trailing slash', () => {
    expect(canonicalPath('tools/merge-pdf')).toBe('/tools/merge-pdf/');
    expect(canonicalPath('/tools/merge-pdf')).toBe('/tools/merge-pdf/');
    expect(canonicalPath('//tools//merge-pdf//')).toBe('/tools/merge-pdf/');
    expect(canonicalPath('/')).toBe('/');
  });

  it('builds tool paths from a slug', () => {
    expect(toolPath('create-zip')).toBe('/tools/create-zip/');
  });
});

describe('prerendered routes', () => {
  it('covers the homepage, catalogue, how-it-works and every live tool', () => {
    const paths = routes.map((r) => r.path);
    expect(paths).toContain('/');
    expect(paths).toContain('/tools/');
    expect(paths).toContain('/how-it-works/');
    for (const tool of TOOLS.filter((t) => t.status !== 'soon')) {
      expect(paths).toContain(toolPath(tool.slug));
    }
  });

  it('excludes tools that are not usable yet', () => {
    const soon = TOOLS.filter((t) => t.status === 'soon').map((t) => toolPath(t.slug));
    const paths = routes.map((r) => r.path);
    for (const path of soon) expect(paths).not.toContain(path);
  });

  it('uses directory URLs, never fragments', () => {
    for (const route of routes) {
      expect(route.path.startsWith('/')).toBe(true);
      expect(route.path.endsWith('/')).toBe(true);
      expect(route.path).not.toContain('#');
      expect(route.path).not.toContain('//');
    }
  });

  it('has no duplicate paths', () => {
    const paths = routes.map((r) => r.path);
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe('page metadata', () => {
  it('gives every route a distinct title', () => {
    const titles = routes.map((r) => r.meta.title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it('gives every route a distinct description', () => {
    const descriptions = routes.map((r) => r.meta.description);
    expect(new Set(descriptions).size).toBe(descriptions.length);
  });

  it('keeps titles and descriptions within search-result bounds', () => {
    for (const route of routes) {
      expect(route.meta.title.length, route.path).toBeGreaterThan(15);
      expect(route.meta.title.length, route.path).toBeLessThanOrEqual(70);
      expect(route.meta.description.length, route.path).toBeGreaterThan(90);
      expect(route.meta.description.length, route.path).toBeLessThanOrEqual(170);
    }
  });

  it('never claims an upload, an account or a guaranteed result', () => {
    for (const route of routes) {
      const text = `${route.meta.title} ${route.meta.description}`.toLowerCase();
      expect(text, route.path).not.toMatch(/\b(upload your|free forever|best in the world|guaranteed)\b/);
      expect(text, route.path).not.toContain('sign up');
    }
  });

  it('documents every live tool', () => {
    for (const tool of TOOLS.filter((t) => t.status !== 'soon')) {
      expect(TOOL_META[tool.slug], tool.slug).toBeTruthy();
    }
  });

  it('has no metadata for tools that are hidden', () => {
    const known = new Set(TOOLS.map((t) => t.slug));
    for (const slug of Object.keys(TOOL_META)) expect(known.has(slug), slug).toBe(true);
  });

  it('marks standalone pages indexable', () => {
    for (const key of ['/', '/tools/', '/how-it-works/']) {
      expect(PAGE_META[key].noindex, key).toBeFalsy();
    }
  });
});

describe('head tags', () => {
  const html = headTags(PAGE_META['/'], '/', ROOT);

  it('emits a self-referencing absolute canonical', () => {
    expect(html).toContain(`<link rel="canonical" href="${ROOT}/" />`);
  });

  it('emits description, robots and social tags exactly once', () => {
    for (const needle of [
      '<meta name="description"',
      '<meta name="robots"',
      '<meta property="og:title"',
      '<meta property="og:url"',
      '<meta name="twitter:card"',
    ]) {
      expect(html.split(needle).length - 1, needle).toBe(1);
    }
  });

  it('points og:image at the social card', () => {
    expect(html).toContain(`content="${ROOT}/og.png"`);
  });

  it('escapes values that could break out of an attribute', () => {
    const nasty = headTags({ title: 'A "quoted" <title>', description: 'x & y' }, '/tools/', ROOT);
    expect(nasty).toContain('&quot;quoted&quot; &lt;title&gt;');
    expect(nasty).toContain('x &amp; y');
  });

  it('marks redirect stubs as noindex targets', () => {
    expect(REDIRECT_ROUTES).toEqual([{ path: '/architecture/', to: '/how-it-works/' }]);
  });
});
