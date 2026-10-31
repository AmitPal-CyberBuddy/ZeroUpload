import { Suspense } from 'react';
import { useParams } from 'react-router-dom';
import { TOOL_COMPONENTS } from '../registry/toolComponents';
import { getTool } from '../registry/tools';
import { NotFoundPage } from './NotFoundPage';
import { Spinner } from '../components/ui/Spinner';
import { ToolLayout } from '../components/tool/ToolLayout';
import { Notice } from '../components/ui/controls';

function LoadingTool() {
  return (
    <div className="tool-loading" role="status">
      <Spinner label="Loading tool" />
      <span className="mono">Loading tool module…</span>
    </div>
  );
}

export function ToolRoute() {
  const { slug = '' } = useParams();
  const tool = getTool(slug);
  const Component = TOOL_COMPONENTS[slug];

  if (!tool || !Component) return <NotFoundPage />;

  if (tool.status === 'soon') {
    return (
      <ToolLayout tool={tool}>
        <Notice tone="warn" title="This tool is planned">
          It is scoped but not implemented yet. ZeroUpload ships tools only when they can run entirely in
          the browser — no server fallback.
        </Notice>
      </ToolLayout>
    );
  }

  return (
    <Suspense fallback={<LoadingTool />}>
      <Component />
    </Suspense>
  );
}
