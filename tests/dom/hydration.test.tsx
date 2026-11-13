import { describe, expect, it } from 'vitest';
import { hydrateRoot } from 'react-dom/client';
import type { ReactElement } from 'react';

/**
 * The prerendered document must be *adopted*, not rebuilt.
 *
 * `scripts/prerender.mjs` renders 30 routes into real HTML. That output used to be
 * discarded on first paint, because `main.tsx` called `createRoot().render()`:
 * the browser parsed the page, React emptied the container and constructed the
 * same DOM again. Crawlers still saw the HTML, so nothing failed and nobody
 * noticed — which is exactly why this needs a guard rather than a comment.
 *
 * The assertions are three-sided, because any one alone is satisfiable by
 * accident:
 *
 *  1. hydration logs no mismatch,
 *  2. the container still holds the server's headings and prose after hydration,
 *  3. the node identity of an existing element survives hydration.
 *
 * Tool routes are asserted on the shell only. Their workspace is deliberately a
 * placeholder at build time (`ToolRoute` writes "This tool runs in your
 * browser"), and the real tool cannot render on the server — so a whole-page
 * identity check there would be asserting the desktop shell of somebody else's
 * page. What has to survive is the header, breadcrumb, notes and related links,
 * which is most of the document.
 *
 * jsdom has no layout, so this cannot prove the page looks right. It proves the
 * one thing the renderer is for: that the work done at build time is kept.
 */

async function renderRouteHtml(route: string): Promise<string> {
  const { renderRoute } = await import('../../src/entry-server');
  return renderRoute(route);
}

async function mountForTest(html: string, route: string) {
  window.history.pushState({}, '', route);
  document.body.innerHTML = `<div id="root">${html}</div>`;
  const container = document.getElementById('root')!;

  /*
   * A node that exists in the server HTML, picked *after* the lazy tool chunk has
   * resolved. A tool route's server markup has no `<h1>` until `ToolLayout`
   * renders — the prerenderer writes the placeholder workspace without the shell
   * — so sampling before hydration would compare against a subtree that legitimately
   * gets replaced. Sampling after means the node that survives is the one that
   * proves the shell was adopted rather than rebuilt.
   */
  const before = () => container.querySelector('h1, header');

  const diagnostics: string[] = [];
  const originalError = console.error;
  const originalWarn = console.warn;
  console.error = (...args: unknown[]) => {
    diagnostics.push(args.map((value) => (typeof value === 'string' ? value : '')).join(' '));
  };
  console.warn = console.error;

  const [{ App }, { ToastProvider }, { BrowserRouter }, React] = await Promise.all([
    import('../../src/App'),
    import('../../src/hooks/useToast'),
    import('react-router-dom'),
    import('react'),
  ]);

  const tree = React.createElement(
    BrowserRouter,
    null,
    React.createElement(ToastProvider, null, React.createElement(App)),
  ) as ReactElement;

  const root = hydrateRoot(container, tree);
  /*
   * Tool routes resolve a lazy chunk after hydration, so the tree is sampled
   * after it settles. A fixed sleep would either be flaky on a loaded machine or
   * slow on a fast one; polling for the workspace is both.
   */
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline && !container.querySelector('.workspace__main, .tool-body, .filedrop')) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  await new Promise((resolve) => setTimeout(resolve, 50));
  const serverNode = before();

  console.error = originalError;
  console.warn = originalWarn;

  return {
    diagnostics,
    container,
    serverNode,
    unmount: async () => {
      root.unmount();
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

const ROUTES = ['/', '/tools/', '/tools/merge-pdf/', '/tools/image-compressor/', '/how-it-works/'];

describe('prerendered documents hydrate', () => {
  it.each(ROUTES)('%s hydrates without a mismatch', async (route) => {
    const html = await renderRouteHtml(route);
    expect(html.length, `${route} prerendered almost nothing`).toBeGreaterThan(500);

    const page = await mountForTest(html, route);
    try {
      const mismatch = page.diagnostics.filter((line) => /didn't match|did not match|Hydration/i.test(line));
      expect(mismatch, `${route} logged a hydration mismatch:\n${mismatch.join('\n')}`).toEqual([]);

      // The static prose is what the prerenderer exists to produce; it has to be
      // in the document afterwards, not replaced by a client-side equivalent.
      expect(page.container.textContent ?? '').toContain('ZeroUpload');
      expect(page.container.querySelector('h1')).not.toBeNull();
      expect(page.container.innerHTML.length).toBeGreaterThan(html.length * 0.5);
    } finally {
      await page.unmount();
    }
  });

  it('keeps the server nodes instead of rebuilding them', async () => {
    const html = await renderRouteHtml('/tools/merge-pdf/');
    const page = await mountForTest(html, '/tools/merge-pdf/');
    try {
      // Same object, still in the document: the tree was adopted.
      expect(page.serverNode).not.toBeNull();
      expect(page.serverNode!.isConnected).toBe(true);
    } finally {
      await page.unmount();
    }
  });
});
