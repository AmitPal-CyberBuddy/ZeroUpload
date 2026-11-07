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
