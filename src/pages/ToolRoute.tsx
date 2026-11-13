import { Suspense } from 'react';
import { useParams } from 'react-router-dom';
import { TOOL_COMPONENTS } from '../registry/toolComponents';
import { getTool } from '../registry/tools';
import { NotFoundPage } from './NotFoundPage';
import { Spinner } from '../components/ui/Spinner';
import { ToolLayout } from '../components/tool/ToolLayout';
import { Notice } from '../components/ui/controls';
import { useStaticRender } from '../seo/static';
import { CATEGORY_MAP, isCategoryId } from '../registry/categories';
import { CategoryPage } from './CategoryPage';
import { useHydrated } from '../hooks/useHydrated';

function LoadingTool() {
  return (
    <div className="tool-loading" role="status">
      <Spinner label="Loading tool" />
      <span>Opening workspace…</span>
    </div>
  );
}

/**
 * What the build writes into the HTML, and what the client draws on its first
 * pass so the two trees match. The wording is deliberately different from
 * `LoadingTool`: this one is a *finished* state for a reader without JavaScript,
 * not a spinner that will resolve. Hydration replaces it one frame later.
 */
function PrerenderedWorkspace() {
  return (
    <div className="tool-loading" role="status">
      <strong>This tool runs in your browser.</strong>
      <span>Open this page with JavaScript enabled to use it — nothing is uploaded either way.</span>
    </div>
  );
}

export function ToolRoute() {
  const { slug = '' } = useParams();
  const isStatic = useStaticRender();
  const hydrated = useHydrated();

  // `/tools/image/` is a group page, `/tools/resize/` is a tool. Both live under
  // the same segment, so the registry decides which one this is.
  if (isCategoryId(slug)) return <CategoryPage category={CATEGORY_MAP[slug]} />;

  const tool = getTool(slug);
  const Component = TOOL_COMPONENTS[slug];

  if (!tool || !Component) return <NotFoundPage />;

  if (tool.status === 'soon') {
    return (
      <ToolLayout tool={tool}>
        <Notice tone="default" title="Not available yet">
          We are still building this one. It will run entirely in your browser, like every other tool here,
          so there is no half-finished version to try.
        </Notice>
      </ToolLayout>
    );
  }

  /*
   * The workspace is a placeholder at build time and on the client's first
   * render, for the same reason in both directions: the server cannot mount a
   * tool, and a client that mounts one immediately has nothing to hydrate
   * against. See `useHydrated`.
   */
  if (isStatic || !hydrated) {
    return (
      <ToolLayout tool={tool}>
        <PrerenderedWorkspace />
      </ToolLayout>
    );
  }

  /*
   * The fallback carries the same `ToolLayout` the tool will render itself.
   * Without it, the moment the lazy chunk starts loading the whole page — the
   * heading, breadcrumb and notes — is replaced by a bare spinner, so the reader
   * loses their place and the title they just clicked. With it, React replaces
   * only the workspace inside an identical shell.
   */
  return (
    <Suspense
      fallback={
        <ToolLayout tool={tool}>
          <LoadingTool />
        </ToolLayout>
      }
    >
      <Component />
    </Suspense>
  );
}
