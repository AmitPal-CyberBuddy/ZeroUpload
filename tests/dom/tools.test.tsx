import { describe, expect, it } from 'vitest';
import { TOOL_LOADERS } from '../../src/registry/toolComponents';
import { TOOLS } from '../../src/registry/tools';
import { render } from './render';

/**
 * Every tool page must mount.
 *
 * This is the coverage the suite was missing: 400-odd tests that could all pass
 * while a tool rendered a blank page. The assertions are deliberately two-sided —
 * the page must produce a real amount of markup *and* React must log nothing —
 * because either one alone is easy to satisfy by accident (a `<Suspense>`
 * fallback renders, and a page that never loads logs nothing).
 */

/**
 * The least markup a real tool page produces. An empty `<Suspense>` fallback is
 * a handful of bytes; a mounted tool shell with its heading, drop zone and
 * settings is kilobytes. 1200 sits comfortably between the two.
 */
const MIN_HTML = 1200;

describe('every registered tool mounts', () => {
  const slugs = TOOLS.map((tool) => tool.slug);

  it('has a loader for every tool in the registry', () => {
    for (const slug of slugs) {
      expect(TOOL_LOADERS[slug], `no component registered for "${slug}"`).toBeTypeOf('function');
    }
  });

  it.each(slugs)('%s', async (slug) => {
    const load = TOOL_LOADERS[slug];
    expect(load, `no loader for "${slug}"`).toBeTypeOf('function');

    const Tool = (await load()).default;
    const page = await render(<Tool />);

    expect(page.errors, `${slug} logged errors while mounting:\n${page.errors.join('\n')}`).toEqual([]);
    expect(page.html.length, `${slug} rendered only ${page.html.length} bytes`).toBeGreaterThan(MIN_HTML);

    // A tool page always names itself somewhere in the shell.
    expect(page.html).toContain('ZeroUpload');

    await page.unmount();
  });
});
