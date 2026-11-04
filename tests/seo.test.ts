import { describe, expect, it } from 'vitest';
import { CATEGORIES } from '../src/registry/categories';
import { TOOLS, TOOLS_BY_CATEGORY, getTool } from '../src/registry/tools';
import { CATEGORY_META, PAGE_META, TOOL_META } from '../src/seo/pages';
import { TOOL_CONTENT } from '../src/seo/toolContent';
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

describe('category pages', () => {
  const live = TOOLS.filter((t) => t.status !== 'soon');

  it('groups tools into five user-facing categories', () => {
    expect(CATEGORIES.map((c) => c.id)).toEqual(['image', 'pdf', 'archive', 'inspect', 'developer']);
  });

  it('leaves no category empty and no tool ungrouped', () => {
    for (const category of CATEGORIES) {
      const tools = TOOLS_BY_CATEGORY[category.id] ?? [];
      expect(tools.length, category.id).toBeGreaterThan(0);
      for (const tool of tools) expect(tool.category).toBe(category.id);
    }
    expect(live.length).toBe(
      CATEGORIES.reduce((sum, c) => sum + (TOOLS_BY_CATEGORY[c.id]?.length ?? 0), 0),
    );
  });

  it('prerenders a page per category with its own metadata', () => {
    const paths = routes.map((r) => r.path);
    for (const category of CATEGORIES) {
      expect(paths, category.id).toContain(`/tools/${category.id}/`);
      expect(CATEGORY_META[category.id], category.id).toBeTruthy();
    }
  });

  it('only guides people to tools that exist in that category', () => {
    for (const category of CATEGORIES) {
      for (const entry of category.guide) {
        const tool = getTool(entry.slug);
        expect(tool, `${category.id} → ${entry.slug}`).toBeTruthy();
        expect(tool!.category, `${category.id} → ${entry.slug}`).toBe(category.id);
      }
    }
  });

  it('names every group in words a person would use', () => {
    for (const category of CATEGORIES) {
      expect(category.name.length).toBeLessThan(22);
      expect(category.heading.endsWith('.')).toBe(true);
      expect(category.intro.length).toBeGreaterThan(120);
    }
  });
});

describe('tool page content', () => {
  const live = TOOLS.filter((t) => t.status !== 'soon');

  it('writes sections for every live tool', () => {
    for (const tool of live) {
      const content = TOOL_CONTENT[tool.slug];
      expect(content, tool.slug).toBeTruthy();
      expect(content.summary.length, tool.slug).toBeGreaterThan(80);
      expect(content.does.length, tool.slug).toBeGreaterThanOrEqual(2);
      expect(content.limits.length, tool.slug).toBeGreaterThanOrEqual(2);
      expect(content.faq.length, tool.slug).toBeGreaterThanOrEqual(3);
    }
  });

  it('answers each question once, in prose rather than fragments', () => {
    for (const [slug, content] of Object.entries(TOOL_CONTENT)) {
      const questions = content.faq.map((entry) => entry.q);
      expect(new Set(questions).size, slug).toBe(questions.length);
      for (const entry of content.faq) {
        expect(entry.q.endsWith('?'), `${slug}: ${entry.q}`).toBe(true);
        expect(entry.a.length, `${slug}: ${entry.q}`).toBeGreaterThan(60);
      }
    }
  });

  it('states a limit instead of promising a perfect result', () => {
    const banned = /\b(guaranteed|always works|100%|bulletproof|unbreakable)\b/i;
    for (const [slug, content] of Object.entries(TOOL_CONTENT)) {
      const text = [content.summary, ...content.does, ...content.limits, ...content.faq.map((f) => f.a)].join(' ');
      expect(text, slug).not.toMatch(banned);
    }
  });

  it('does not claim that anything leaves the device', () => {
    for (const [slug, content] of Object.entries(TOOL_CONTENT)) {
      const text = [...content.faq.map((f) => f.a), ...content.does].join(' ');
      expect(text.toLowerCase(), slug).not.toMatch(/\b(uploads? (it )?to (our|a) server|sent to our server)\b/);
    }
  });
});
