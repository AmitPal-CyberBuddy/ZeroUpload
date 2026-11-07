import { StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { App } from './App';
import { ToastProvider } from './hooks/useToast';
import { StaticRenderContext } from './seo/static';
import { prerenderRoutes, REDIRECT_ROUTES } from './seo/routes';
import { headTags } from './seo/document';
import { jsonLdScript, structuredDataFor } from './seo/structuredData';

/** Everything `scripts/prerender.mjs` needs from the build. */
export { prerenderRoutes, REDIRECT_ROUTES, headTags, jsonLdScript, structuredDataFor };

/**
 * Build-time entry point.
 *
 * `scripts/prerender.mjs` imports this bundle once and asks it for the HTML of
 * every route. There is no server at runtime: the output is plain files, and the
 * app in the visitor's browser is the only thing that ever executes.
 */
/**
 * Renders one route to HTML. Links come out root-absolute (`/tools/…`);
 * `scripts/prerender.mjs` adds the deploy prefix when the site lives in a
 * subdirectory, which is what the browser router does at runtime too.
 */
export function renderRoute(path: string): string {
  return renderToString(
    <StrictMode>
      <StaticRenderContext.Provider value={true}>
        <MemoryRouter initialEntries={[path]}>
          <ToastProvider>
            <App />
          </ToastProvider>
        </MemoryRouter>
      </StaticRenderContext.Provider>
    </StrictMode>,
  );
}
