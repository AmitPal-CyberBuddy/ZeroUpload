import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * There are two 404s and they are the same page:
 *
 *   - `dist/404.html`, prerendered by `scripts/prerender.mjs`, served by GitHub
 *     Pages for any unknown path. It must not boot the app, so it is standalone.
 *   - `NotFoundPage.tsx`, which answers an unmatched in-app route.
 *
 * The UX audit found them drifting into two designs. This test reads both files
 * as text — no browser, no bundler — and fails when the words, the links or the
 * theme handling stop matching.
 */

const root = process.cwd();
const prerender = readFileSync(join(root, 'scripts/prerender.mjs'), 'utf8');
const page = readFileSync(join(root, 'src/pages/NotFoundPage.tsx'), 'utf8');
const shell = readFileSync(join(root, 'index.html'), 'utf8');

/** The static 404 is a template literal inside the prerender script. */
const static404 = prerender.slice(prerender.indexOf('const notFound = `'));

const text = (value: string) => value.replace(/\s+/g, ' ').trim();

describe('404 pages', () => {
  it('share the same heading and explanation', () => {
    const heading = 'There is nothing at this address.';
    expect(page).toContain(heading);
    expect(static404).toContain(heading);

    const explanation = 'Nothing was uploaded, so there is nothing to clean up.';
    expect(text(page)).toContain(explanation);
    expect(text(static404)).toContain(explanation);
  });

  it('offer the same two destinations', () => {
    // The in-app page routes internally; the static one needs absolute URLs.
    expect(page).toContain('to="/tools/"');
    expect(page).toContain('to="/"');
    expect(static404).toContain('${SITE_URL}/tools/');
    expect(static404).toContain('${SITE_URL}/');
  });

  it('resolve the theme the way the app shell does', () => {
    const themeLogic = (source: string) => source.includes("localStorage.getItem('zeroupload.theme')");
    expect(themeLogic(shell)).toBe(true);
    expect(themeLogic(static404)).toBe(true);
  });

  it('stay out of the index', () => {
    expect(static404).toContain('content="noindex, follow"');
    expect(page).toContain('noindex: true');
  });

  it('is the document the layout check visits, not an unknown path', () => {
    /*
     * `vite preview` answers an unknown path with the SPA fallback, and the build
     * uses `base: './'` so one artifact works at any prefix — which means that
     * fallback's relative asset URLs resolve *under* the unknown path and 404.
     * The layout check therefore spent a while measuring a page no visitor is
     * ever served, and reporting its 2544 px shell. It has to request the file
     * GitHub Pages actually returns for a wrong URL.
     */
    const responsive = readFileSync(join(root, 'scripts/check-responsive.mjs'), 'utf8');
    expect(responsive).toContain("routes.push('/404.html')");
    expect(responsive).not.toContain("routes.push('/not-a-page/')");
  });
});
