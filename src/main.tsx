import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
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

// The container already holds the prerendered HTML for this route. React takes
// it over on the first frame; until then the static content stays readable.
createRoot(container).render(
  <StrictMode>
    <BrowserRouter basename={basename}>
      <ToastProvider>
        <App />
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
);
