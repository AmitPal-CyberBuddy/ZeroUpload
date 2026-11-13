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
    const priorPath = previous.current;
    previous.current = pathname;
    if (first) return;
    // React StrictMode re-runs mount effects; that is not a navigation.
    if (priorPath === pathname) return;

    // Lazy tool routes can render a loading fallback with no <main>. Watch for
    // the destination rather than attempting focus once and silently giving up.
    const originalFocus = document.activeElement;
    let target: HTMLElement | null = null;
    let addedTabIndex = false;
    let observer: MutationObserver | null = null;
    let timer: number | undefined;

    const stopWaiting = () => {
      observer?.disconnect();
      observer = null;
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener('focusin', onUserFocus);
    };
    const onUserFocus = (event: FocusEvent) => {
      // Do not steal focus if the visitor has already chosen a control while
      // the lazy route was loading.
      if (event.target !== originalFocus && event.target !== target) stopWaiting();
    };
    const clear = () => {
      if (addedTabIndex) target?.removeAttribute('tabindex');
    };
    const focusDestination = () => {
      target = document.querySelector<HTMLElement>('main#main h1') ?? document.getElementById('main');
      if (!target) return false;
      addedTabIndex = !target.hasAttribute('tabindex');
      if (addedTabIndex) target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
      target.addEventListener('blur', clear, { once: true });
      stopWaiting();
      return true;
    };

    if (!focusDestination()) {
      observer = new MutationObserver(() => { focusDestination(); });
      observer.observe(document.body, { childList: true, subtree: true });
      document.addEventListener('focusin', onUserFocus);
      // A failed chunk or abandoned route must not keep an observer forever.
      timer = window.setTimeout(stopWaiting, 15_000);
    }

    return () => {
      stopWaiting();
      target?.removeEventListener('blur', clear);
      clear();
    };
  }, [pathname]);
}
