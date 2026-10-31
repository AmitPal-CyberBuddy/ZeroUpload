import { Suspense, useEffect } from 'react';
import { HashRouter, Route, Routes, useLocation } from 'react-router-dom';
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

/**
 * Hash routing keeps deep links working on GitHub Pages project URLs and on any
 * static host without rewrite rules — including when the app is served from a
 * subdirectory or opened from disk.
 */

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [pathname]);
  return null;
}

/** Focuses the main landmark without touching the hash router's URL. */
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
        main.scrollIntoView({ block: 'start' });
      }}
    >
      Skip to content
    </button>
  );
}

function RouteFallback() {
  return (
    <div className="route-fallback">
      <Spinner />
    </div>
  );
}

export function App() {
  return (
    <HashRouter>
      <ScrollToTop />
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
            <Route path="/architecture" element={<ArchitecturePage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
      <SiteFooter />
    </HashRouter>
  );
}
