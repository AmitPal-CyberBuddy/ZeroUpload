import { act } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useLocation } from 'react-router-dom';
import { App } from '../../src/App';
import { ToolsPage } from '../../src/pages/ToolsPage';
import { openPalette } from '../../src/components/layout/paletteBus';
import { RECENT_KEY, RECENT_LIMIT } from '../../src/lib/recent/recentTools';
import { render } from './render';

/**
 * The palette's two new exits: back to where you were, and forward to everything.
 *
 * Both are easy to break invisibly — a chip row that renders but navigates
 * nowhere, a "see all" link that points at a query the catalogue ignores. These
 * assert the rendered links and their targets, not just that something appeared.
 */

/** React listens for `input`, and only trusts the native value setter. */
function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function open() {
  await act(async () => {
    openPalette();
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}

beforeEach(() => localStorage.clear());

describe('recent tools in the palette', () => {
  it('shows nothing when no tool has been visited', async () => {
    const page = await render(<App />, { route: '/' });
    await open();

    expect(page.container.querySelector('.palette__recent')).toBeNull();
    await page.unmount();
  });

  it('shows the visited tools, most recent first', async () => {
    localStorage.setItem(RECENT_KEY, JSON.stringify(['crop', 'base64']));

    const page = await render(<App />, { route: '/' });
    await open();

    const chips = [...page.container.querySelectorAll('.palette__chip')].map((chip) => chip.textContent?.trim());
    expect(chips).toEqual(['Image Cropper', 'Base64 Encoder']);

    await page.unmount();
  });

  it('does not repeat a recent tool in the list underneath it', async () => {
    localStorage.setItem(RECENT_KEY, JSON.stringify(['crop']));

    const page = await render(<App />, { route: '/' });
    await open();

    const names = [...page.container.querySelectorAll('.palette__item-name')].map((node) => node.textContent?.trim());
    expect(names).not.toContain('Image Cropper');
    // Twenty tools minus the one already in the chip row.
    expect(names.length).toBe(8);

    await page.unmount();
  });

  it('forgets tools the catalogue no longer lists', async () => {
    localStorage.setItem(RECENT_KEY, JSON.stringify(['removed-tool', 'base64']));

    const page = await render(<App />, { route: '/' });
    await open();

    const chips = [...page.container.querySelectorAll('.palette__chip')].map((chip) => chip.textContent?.trim());
    expect(chips).toEqual(['Base64 Encoder']);

    await page.unmount();
  });

  it('clears the row and the stored list', async () => {
    localStorage.setItem(RECENT_KEY, JSON.stringify(['crop']));

    const page = await render(<App />, { route: '/' });
    await open();

    const clear = page.container.querySelector<HTMLButtonElement>('.palette__recent-clear');
    expect(clear).not.toBeNull();
    await act(async () => {
      clear?.click();
    });

    expect(page.container.querySelector('.palette__recent')).toBeNull();
    // Removed rather than emptied: nothing left to read back later.
    expect(localStorage.getItem(RECENT_KEY)).toBeNull();

    await page.unmount();
  });

  it('hides the row as soon as a query is typed', async () => {
    localStorage.setItem(RECENT_KEY, JSON.stringify(['crop']));

    const page = await render(<App />, { route: '/' });
    await open();

    const input = page.container.querySelector('.palette__search input') as HTMLInputElement;
    await act(async () => {
      type(input, 'zip');
    });

    expect(page.container.querySelector('.palette__recent')).toBeNull();
    await page.unmount();
  });
});

describe('the way out of a truncated result list', () => {
  it('is absent when every match fits', async () => {
    const page = await render(<App />, { route: '/' });
    await open();

    const input = page.container.querySelector('.palette__search input') as HTMLInputElement;
    await act(async () => {
      type(input, 'merge');
    });

    expect(page.container.querySelector('.palette__more')).toBeNull();
    await page.unmount();
  });

  it('offers the catalogue with the query carried over when results overflow', async () => {
    const page = await render(<App />, { route: '/' });
    await open();

    const input = page.container.querySelector('.palette__search input') as HTMLInputElement;
    await act(async () => {
      type(input, 'e');
    });

    const more = page.container.querySelector<HTMLAnchorElement>('.palette__more');
    expect(more).not.toBeNull();
    expect(more?.textContent).toMatch(/^See all \d+ matches in the catalogue/);
    // The query has to survive the hop, or the catalogue opens unfiltered.
    expect(more?.getAttribute('href')).toContain('/tools/?q=e');

    await page.unmount();
  });

  it('does not offer it for an empty query', async () => {
    const page = await render(<App />, { route: '/' });
    await open();

    expect(page.container.querySelector('.palette__more')).toBeNull();
    await page.unmount();
  });
});

describe('the catalogue accepts a query from the palette', () => {
  it('filters on load when ?q= is present', async () => {
    const page = await render(<App />, { route: '/tools/?q=zip' });

    const input = page.container.querySelector<HTMLInputElement>('.catalog-search input');
    expect(input?.value).toBe('zip');
    expect(page.container.querySelector('.catalog-count')?.textContent).toMatch(/\d+ of \d+ tools/);

    await page.unmount();
  });

  it('writes the typed query to the URL, and removes it when cleared', async () => {
    // A probe inside the router, so the address bar can be asserted without one.
    function Probe() {
      return <span data-search={useLocation().search} />;
    }

    const page = await render(
      <>
        <Probe />
        <ToolsPage />
      </>,
      { route: '/tools/' },
    );

    const probe = () => page.container.querySelector('[data-search]')?.getAttribute('data-search');
    const input = page.container.querySelector<HTMLInputElement>('.catalog-search input') as HTMLInputElement;

    expect(probe()).toBe('');

    await act(async () => {
      type(input, 'zip');
    });
    expect(probe()).toBe('?q=zip');

    await act(async () => {
      type(input, '');
    });
    expect(probe()).toBe('');

    await page.unmount();
  });

  it('shows the whole catalogue when there is no query', async () => {
    const page = await render(<App />, { route: '/tools/' });

    const input = page.container.querySelector<HTMLInputElement>('.catalog-search input');
    expect(input?.value).toBe('');

    await page.unmount();
  });
});

describe('recording a visit', () => {
  it('remembers a tool page for next time', async () => {
    const page = await render(<App />, { route: '/tools/merge-pdf' });
    await page.unmount();

    const stored = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[];
    expect(stored[0]).toBe('merge-pdf');
    expect(stored.length).toBeLessThanOrEqual(RECENT_LIMIT);
  });
});
