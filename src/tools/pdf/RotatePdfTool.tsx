import { useState } from 'react';
import { getTool } from '../../registry/tools';
import { ToolLayout, Settings } from '../../components/tool/ToolLayout';
import { FileDrop } from '../../components/file/FileDrop';
import { FileCard } from '../../components/tool/FileCard';
import { StageTimeline } from '../../components/tool/StageTimeline';
import { ResultPanel } from '../../components/tool/ResultPanel';
import { Field, Notice, Segmented } from '../../components/ui/controls';
import { Icon } from '../../components/ui/Icon';
import { Spinner } from '../../components/ui/Spinner';
import { assertWithinSize, toToolError } from '../../lib/files/errors';
import { formatCount } from '../../lib/files/format';
import { useToast } from '../../hooks/useToast';

const tool = getTool('rotate-pdf')!;

export default function RotatePdfTool() {
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [degrees, setDegrees] = useState(90);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<'reading' | 'processing' | 'done' | null>(null);
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);
  const [result, setResult] = useState<Blob | null>(null);
  const { toast } = useToast();

  const load = async (next: File) => {
    setError(null);
    setResult(null);
    try {
      assertWithinSize(next, 'pdf');
      const { describePdf } = await import('../../lib/pdf/pdf');
      const pages = await describePdf(await next.arrayBuffer());
      setPageCount(pages.length);
      setFile(next);
    } catch (err) {
      const toolError = toToolError(err);
      setError({ message: toolError.message, hint: toolError.hint });
      setFile(null);
    }
  };

  const run = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setStage('reading');
    try {
      const { rotatePdf, pdfBytesToBlob } = await import('../../lib/pdf/pdf');
      const data = await file.arrayBuffer();
      setStage('processing');
      const bytes = await rotatePdf(data, degrees);
      setResult(pdfBytesToBlob(bytes));
      setStage('done');
      toast(`Rotated every page by ${degrees}°`, 'success');
    } catch (err) {
      const toolError = toToolError(err);
      setError({ message: toolError.message, hint: toolError.hint });
      setStage(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ToolLayout
      tool={tool}
      aside={
        file ? (
          <Settings
            title="Rotation"
            footer={
              <button type="button" className="btn btn--primary btn--block" onClick={run} disabled={busy}>
                {busy ? <Spinner /> : <Icon name="rotate" size={14} />}
                {busy ? 'Rotating…' : `Rotate ${degrees}°`}
              </button>
            }
          >
            <Field label="Angle">
              <Segmented
                label="Angle"
                value={String(degrees)}
                onChange={(value) => { setDegrees(Number(value)); setResult(null); }}
                options={[
                  { value: '90', label: '90° CW' },
                  { value: '180', label: '180°' },
                  { value: '270', label: '90° CCW' },
                ]}
              />
            </Field>
            <div className="setting-row">
              <span className="field__hint">Pages affected</span>
              <span className="setting-value">{formatCount(pageCount, 'page')}</span>
            </div>
            <Notice tone="default" icon="info">
              Rotation is stored in page metadata, so the content is never re-compressed.
            </Notice>
          </Settings>
        ) : null
      }
    >
      <div className="tool-body">
        {!file ? (
          <>
            <FileDrop
              accept="application/pdf,.pdf"
              onFiles={(files) => load(files[0])}
              title="Drop a PDF to rotate"
              hint="Useful for sideways scans and upside-down exports."
              icon="rotate"
            />
            {error ? <Notice tone="danger" title="Could not open this file">{error.message}{error.hint ? <div className="hint">{error.hint}</div> : null}</Notice> : null}
          </>
        ) : (
          <>
            <div className="row row--between row--wrap">
              <span className="section-title">Document</span>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => { setFile(null); setResult(null); }}>
                <Icon name="x" size={13} /> Clear
              </button>
            </div>

            <FileCard file={file} subtitle={formatCount(pageCount, 'page')} onRemove={() => { setFile(null); setResult(null); }} />

            {stage ? (
              <StageTimeline
                stages={['Reading', 'Rotating', 'Complete']}
                states={stage === 'reading' ? ['active', 'idle', 'idle'] : stage === 'processing' ? ['done', 'active', 'idle'] : ['done', 'done', 'done']}
              />
            ) : null}

            {error ? <Notice tone="danger" title="Rotation failed">{error.message}</Notice> : null}

            {result ? (
              <ResultPanel
                title={`Rotated ${degrees}°`}
                originalBytes={file.size}
                outputBlob={result}
                filename={file.name.replace(/\.pdf$/i, '') + '-rotated.pdf'}
                showPreview={false}
                onRerun={run}
                onReset={() => { setFile(null); setResult(null); }}
                downloadLabel="Download rotated PDF"
              />
            ) : (
              <div className="preview-placeholder">
                <Icon name="rotate" size={22} />
                <p>Choose an angle. Preview is not rendered here — PDF rendering would add a second engine.</p>
                <button type="button" className="btn btn--primary" onClick={run} disabled={busy}>
                  {busy ? <Spinner /> : <Icon name="rotate" size={14} />}
                  {busy ? 'Rotating…' : 'Rotate now'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </ToolLayout>
  );
}
