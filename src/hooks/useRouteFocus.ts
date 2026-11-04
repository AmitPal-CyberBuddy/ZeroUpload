import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Moves focus to the new page after a client-side navigation.
 *
 * Scrolling to the top is only half of "the page changed". Without moving focus,
 * a keyboard or screen-reader user stays parked on the link they just activated —
 * so their next Tab continues through the *previous* page's footer, and nothing
 * announces where they landed. The standard single-page-app answer is to focus the
 * new page's heading, which both announces the destination and puts the tab order
 * at the top of the content.
 *
 * Two deliberate details:
 *
 *  - The first render is skipped. A visitor who deep-links to `/tools/merge-pdf/`
 *    should keep the browser's normal initial focus, not have it yanked into the
 *    document body.
 *  - `preventScroll` is used because `ScrollToTop` already handles position; the
 *    focus call must not fight it or add a second jump.
 */
export function useRouteFocus() {
  const { pathname } = useLocation();
  const previous = useRef<string | null>(null);

  useEffect(() => {
    const first = previous.current === null;
    previous.current = pathname;
    if (first) return;

    // The heading is the most useful target; `#main` is the fallback for routes
    // that render without one (the redirect stubs never mount this hook).
    const target =
      document.querySelector<HTMLElement>('main#main h1') ??
      document.getElementById('main') ??
      null;
    if (!target) return;

    // Programmatically focusable without joining the tab order permanently.
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });

    // Leave no stray outline on a mouse-driven navigation. Focus is visible for
    // keyboard users through `:focus-visible`; this only clears the element we
    // focused ourselves.
    const clear = () => target.removeAttribute('tabindex');
    target.addEventListener('blur', clear, { once: true });
    return () => target.removeEventListener('blur', clear);
  }, [pathname]);
}
