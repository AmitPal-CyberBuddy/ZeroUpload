import { Suspense } from 'react';
import { useParams } from 'react-router-dom';
import { TOOL_COMPONENTS } from '../registry/toolComponents';
import { getTool } from '../registry/tools';
import { NotFoundPage } from './NotFoundPage';
import { Spinner } from '../components/ui/Spinner';
import { ToolLayout } from '../components/tool/ToolLayout';
import { Notice } from '../components/ui/controls';
import { useStaticRender } from '../seo/static';

function LoadingTool() {
  return (
    <div className="tool-loading" role="status">
      <Spinner label="Loading tool" />
      <span className="mono">Opening workspace…</span>
    </div>
  );
}

export function ToolRoute() {
  const { slug = '' } = useParams();
  const isStatic = useStaticRender();
  const tool = getTool(slug);
  const Component = TOOL_COMPONENTS[slug];

  if (!tool || !Component) return <NotFoundPage />;

  if (tool.status === 'soon') {
    return (
      <ToolLayout tool={tool}>
        <Notice tone="warn" title="Not available yet">
          We are still building this one. It will run entirely in your browser, like every other tool here,
          so there is no half-finished version to try.
        </Notice>
      </ToolLayout>
    );
  }

  // At build time the workspace is a placeholder: the page's content is what
  // belongs in the HTML, not a mounted file picker.
  if (isStatic) {
    return (
      <ToolLayout tool={tool}>
        <div className="tool-loading" role="status">
          <span className="mono">This tool runs in your browser.</span>
          <span>Open this page with JavaScript enabled to use it — nothing is uploaded either way.</span>
        </div>
      </ToolLayout>
    );
  }

  return (
    <Suspense fallback={<LoadingTool />}>
      <Component />
    </Suspense>
  );
}
