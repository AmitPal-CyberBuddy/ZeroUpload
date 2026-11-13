import { describe, expect, it } from 'vitest';
import { App } from '../../src/App';
import { render } from './render';

/**
 * The mobile navigation overlay.
 *
 * Two defects lived here and neither was reachable from the node suite:
 *
 *  - the menu was `96%` background plus a `backdrop-filter` blur, so it read as
 *    solid only where the blur was composited. Everywhere else the hero heading
 *    behind it showed through at just enough contrast to look like a fault;
 *  - the page kept scrolling underneath it. Because the menu is `fixed` and only
 *    as tall as its links, a wheel or a drag carried content up behind the sheet
 *    and out the other side, so the menu appeared to dissolve into the page.
 *
 * jsdom has no layout and no compositor, so these assert the mechanism (a solid
 * colour, a locked body) rather than the rendering.
 */

async function openMenu() {
  const page = await render(<App />, { route: '/tools/' });
  const burger = page.container.querySelector<HTMLButtonElement>('.header-burger');
  expect(burger, 'the burger is the only way into the menu').not.toBeNull();

  burger!.click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  return { page, burger: burger! };
}

describe('mobile menu', () => {
  it('opens from the burger and closes on Escape', async () => {
    const { page, burger } = await openMenu();

    expect(page.container.querySelector('.mobile-menu')).not.toBeNull();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(page.container.querySelector('.mobile-menu')).toBeNull();
    expect(page.errors).toEqual([]);
    await page.unmount();
    expect(burger).not.toBeNull();
  });

  it('locks page scroll while it is open and restores it on close', async () => {
    const { page } = await openMenu();
    expect(document.body.style.overflow).toBe('hidden');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(document.body.style.overflow).toBe('');
    expect(page.errors).toEqual([]);
    await page.unmount();
  });

  it('restores scrolling when the route changes with the menu open', async () => {
    const { page } = await openMenu();
    expect(document.body.style.overflow).toBe('hidden');

    // Navigating away closes the menu via the pathname effect; either way the lock
    // must go, or the page is left unscrollable with nothing on screen to explain
    // it. The link has to point somewhere *other* than the current route: a link
    // to the page you are already on does not change `location.pathname`, so the
    // effect that closes the menu never fires.
    const link = [...page.container.querySelectorAll<HTMLAnchorElement>('.mobile-menu a')].find(
      (anchor) => anchor.getAttribute('href') !== '/tools/',
    );
    expect(link, 'expected a menu link to another route').toBeDefined();
    link!.click();
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(document.body.style.overflow).toBe('');
    expect(page.errors).toEqual([]);
    await page.unmount();
  });
});
