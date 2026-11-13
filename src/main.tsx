import { StrictMode } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './styles/fonts.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/ui.css';
import './styles/layout.css';
import './styles/brand.css';
import './styles/workspace.css';
import './styles/pages.css';
import './styles/tools.css';
import './styles/batch.css';
import './styles/polish.css';
import './styles/a11y.css';
import { App } from './App';
import { ToastProvider } from './hooks/useToast';
import { deployBase } from './seo/site';

/**
 * Real paths, not fragments. The site can be served from a domain root or a
 * GitHub project subdirectory, so the router's basename is whatever prefix the
 * page was actually loaded from — never a hard-coded path.
 */
const base = deployBase();
const basename = base === '/' ? '/' : base.replace(/\/+$/, '');

/**
 * Links shared before the move to path routing look like `/#/tools/merge-pdf`.
 * Send them to `/tools/merge-pdf/` so old bookmarks keep working.
 */
function migrateHashLink(): void {
  const { hash } = window.location;
  if (!hash.startsWith('#/')) return;
  const [rawPath, rawQuery] = hash.slice(1).split('?');
  const target = rawPath === '/' || rawPath === '' ? '/' : `${rawPath.replace(/\/+$/, '')}/`;
  window.history.replaceState(null, '', `${basename}${target}${rawQuery ? `?${rawQuery}` : ''}`);
}
migrateHashLink();

const container = document.getElementById('root');
if (!container) throw new Error('Root container missing');

const tree = (
  <StrictMode>
    <BrowserRouter basename={basename}>
      <ToastProvider>
        <App />
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>
);

/*
 * Every real route ships as a prerendered document, so the container already
 * holds this page's markup and the tree is *adopted* rather than rebuilt.
 *
 * This used to be `createRoot(...).render(...)`, which empties the container and
 * constructs the same DOM again — the browser parsed the page, React threw it
 * away, and the prerenderer's output was doing nothing except feeding crawlers.
 * `hydrateRoot` is the pairing the prerenderer was always written for.
 *
 * The fallback matters: `/404.html` is generated without a body (GitHub Pages
 * serves it for any unknown path, and the router decides what to show), and the
 * dev server serves an empty container. Hydrating an empty node is not a
 * hydration — React would complain about a tree it cannot diff — so an empty
 * container gets a client render.
 */
if (container.firstChild) {
  hydrateRoot(container, tree);
} else {
  createRoot(container).render(tree);
}
