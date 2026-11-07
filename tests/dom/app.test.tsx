import { describe, expect, it } from 'vitest';
import { App } from '../../src/App';
import { ErrorBoundary } from '../../src/components/layout/ErrorBoundary';
import { NotFoundPage } from '../../src/pages/NotFoundPage';
import { render } from './render';

/**
 * The shell around the tools, and the routes that reach them.
 *
 * Tools mounting in isolation proves the components are sound; it does not prove
 * the app can *navigate*. These render the real `<App />` at real paths, which
 * exercises the router, the lazy route chunks, the header, the palette, the
 * footer and the error boundary together — the combination that only breaks in
 * production.
 */

const ROUTES: Array<[path: string, expect: string]> = [
  ['/', 'ZeroUpload'],
  ['/tools', 'Tools'],
  ['/tools/merge-pdf', 'Merge'],
  ['/how-it-works', 'How it works'],
  ['/tools/not-a-real-tool', 'nothing at this address'],
];

describe('the app renders at real paths', () => {
  it.each(ROUTES)('%s', async (path, expected) => {
    const page = await render(<App />, { route: path });

    expect(page.errors, `${path} logged errors:\n${page.errors.join('\n')}`).toEqual([]);
    // The route chunk must have resolved — the Suspense fallback says "Opening…".
    expect(page.html, `${path} never left the loading fallback`).not.toContain('Opening…');
    expect(page.html).toContain(expected);

    await page.unmount();
  });

  it('serves a heading on every route', async () => {
    for (const [path] of ROUTES) {
      const page = await render(<App />, { route: path });
      const headings = page.container.querySelectorAll('h1');
      expect(headings.length, `${path} has no <h1>`).toBe(1);
      await page.unmount();
    }
  });

  it('marks the 404 as noindex', async () => {
    const page = await render(<NotFoundPage />);
    expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toContain('noindex');
    await page.unmount();
  });
});

describe('the notes on a tool page', () => {
  it('offers jump links that land on a real heading', async () => {
    const page = await render(<App />, { route: '/tools/merge-pdf' });

    const nav = page.container.querySelector('.tool-notes__nav');
    expect(nav, 'no in-page navigation on a tool page').not.toBeNull();

    const links = [...(nav?.querySelectorAll('a') ?? [])];
    expect(links.length).toBe(3);

    for (const link of links) {
      const href = link.getAttribute('href') ?? '';
      expect(href.startsWith('#'), `${href} is not an in-page anchor`).toBe(true);
      const id = href.slice(1);
      // The id, not the text: a typo in the heading id breaks the jump silently.
      expect(page.container.querySelector(`[id="${id}"]`), `nothing on the page has id "${id}"`).not.toBeNull();
      expect(link.textContent?.trim().length).toBeGreaterThan(3);
    }

    await page.unmount();
  });

  it('names its section from a heading that is on the page', async () => {
    const page = await render(<App />, { route: '/tools/merge-pdf' });

    const section = page.container.querySelector('.tool-notes');
    const labelledBy = section?.getAttribute('aria-labelledby') ?? '';
    expect(page.container.querySelector(`[id="${labelledBy}"]`)?.tagName).toBe('H2');

    await page.unmount();
  });
});

describe('the error boundary', () => {
  /** A component that throws on render, standing in for a real crash. */
  function Explode(): never {
    throw new Error('boom');
  }

  it('catches a render crash and offers a way out', async () => {
    const page = await render(
      <ErrorBoundary>
        <Explode />
      </ErrorBoundary>,
    );

    // React logs the caught error; the boundary logging it too is expected. What
    // matters is that the tree did not go blank.
    expect(page.html.length).toBeGreaterThan(200);
    expect(page.html).toMatch(/something|wrong|error/i);
    // A crash inside a tool must not strand the page: there has to be an action.
    expect(page.container.querySelectorAll('a, button').length).toBeGreaterThan(0);

    await page.unmount();
  });
});
