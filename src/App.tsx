import { Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { SiteHeader } from './components/layout/SiteHeader';
import { SiteFooter } from './components/layout/SiteFooter';
import { CommandPalette } from './components/layout/CommandPalette';
import { ErrorBoundary } from './components/layout/ErrorBoundary';
import { HomePage } from './pages/HomePage';
import { ToolsPage } from './pages/ToolsPage';
import { ArchitecturePage } from './pages/ArchitecturePage';
import { ToolRoute } from './pages/ToolRoute';
import { NotFoundPage } from './pages/NotFoundPage';
import { Spinner } from './components/ui/Spinner';
import { useRouteFocus } from './hooks/useRouteFocus';
import { useScrollRestoration } from './hooks/useScrollRestoration';
import { discardHandoffExcept } from './lib/files/handoff';

/**
 * Routes are real paths (`/tools/image-compressor/`), not fragments, so every
 * tool is an address a crawler can fetch and a person can link to. The router
 * object itself lives in `main.tsx` (browser) and `entry-server.tsx` (static
 * rendering), so the same tree renders in both.
 */

/**
 * A route change has to move the viewport *and* the keyboard cursor.
 *
 * Scroll is restored per history entry rather than always reset, so Back returns
 * you to where you were in the catalogue instead of the top of it. Focus always
 * moves to the new heading, so the next Tab starts at the top of the new page.
 */
function RouteChange() {
  const { pathname } = useLocation();
  useEffect(() => discardHandoffExcept(pathname), [pathname]);
  useScrollRestoration();
  useRouteFocus();
  return null;
}

/** Focuses the main landmark without changing the URL. */
function SkipLink() {
  return (
    <button
      type="button"
      className="skip-link"
      onClick={() => {
        const main = document.getElementById('main');
        if (!main) return;
        main.setAttribute('tabindex', '-1');
        main.focus();
        main.scrollIntoView?.({ block: 'start' });
      }}
    >
      Skip to content
    </button>
  );
}

/**
 * Shown while a lazily-imported route chunk arrives. A bare spinner says "wait"
 * without saying what for; one line of text costs nothing and removes the guess.
 */
function RouteFallback() {
  return (
    <div className="route-fallback">
      <Spinner label="Loading" />
      <p>Opening…</p>
    </div>
  );
}

export function App() {
  return (
    <>
      <RouteChange />
      <SkipLink />
      <div className="app-bg" aria-hidden="true" />
      <SiteHeader />
      <CommandPalette />
      <ErrorBoundary>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/tools" element={<ToolsPage />} />
            <Route path="/tools/:slug" element={<ToolRoute />} />
            <Route path="/how-it-works" element={<ArchitecturePage />} />
            {/* The technical write-up used to live here. */}
            <Route path="/architecture" element={<Navigate to="/how-it-works/" replace />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
      <SiteFooter />
    </>
  );
}
