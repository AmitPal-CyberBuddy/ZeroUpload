import { useMemo, useState } from 'react';
import { getTool } from '../../registry/tools';
import { RunAction } from '../../components/tool/RunAction';
import { ToolLayout, Settings } from '../../components/tool/ToolLayout';
import { FileDrop } from '../../components/file/FileDrop';
import { FileCard } from '../../components/tool/FileCard';
import { StageTimeline } from '../../components/tool/StageTimeline';
import { ResultPanel } from '../../components/tool/ResultPanel';
import { Field, Notice, Segmented } from '../../components/ui/controls';
import { ToolError } from '../../lib/files/errors';
import { Icon } from '../../components/ui/Icon';
import { assertWithinSize, toToolError } from '../../lib/files/errors';
import { formatCount } from '../../lib/files/format';
import { Outcome } from '../../components/tool/Outcome';
import { useToast } from '../../hooks/useToast';
import { useRunControl } from '../../hooks/useRunControl';
// Value import only: lib/pdf/pdf loads pdf-lib dynamically, so this costs nothing.
import { parsePageRanges } from '../../lib/pdf/pdf';

const tool = getTool('rotate-pdf')!;

export default function RotatePdfTool() {
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [degrees, setDegrees] = useState(90);
  /** Page range text. Empty means every page, which is also the default. */
  const [range, setRange] = useState('');
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<'reading' | 'processing' | 'done' | null>(null);
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);
  const [result, setResult] = useState<Blob | null>(null);
  const { toast } = useToast();
  const runControl = useRunControl();

  const load = async (next: File) => {
    setError(null);
    setResult(null);
    try {
      assertWithinSize(next, 'pdf');
      const { describePdf } = await import('../../lib/pdf/pdf');
      const pages = await describePdf(next);
      setPageCount(pages.length);
      setRange('');
      setFile(next);
    } catch (err) {
      const toolError = toToolError(err);
      setError({ message: toolError.message, hint: toolError.hint });
      setFile(null);
    }
  };

  /*
   * Which pages to turn. The default is all of them, because "rotate my scan"
   * usually means the whole document; selecting a subset is for the document
   * where one page came back sideways.
   *
   * Validation is live and inline: a range that does not parse is a typing
   * mistake, not a reason to hide the action — the button stays available and
   * the error explains the syntax, the same pattern Split PDF uses.
   */
  const selection = useMemo(() => {
    if (!file) return { pages: null as number[] | null, error: null as string | null };
    if (range.trim() === '') return { pages: null, error: null };
    try {
      return { pages: parsePageRanges(range, pageCount), error: null };
    } catch (error) {
      return { pages: null, error: error instanceof ToolError ? error.message : 'That range could not be read.' };
    }
  }, [file, range, pageCount]);

  const run = async () => {
    if (!file) return;
    setBusy(true);
    const signal = runControl.begin();
    setError(null);
    setStage('reading');
    try {
      const { rotatePdf, pdfBytesToBlob } = await import('../../lib/pdf/pdf');
      setStage('processing');
      // The worker reads the file itself — nothing is copied on this thread.
      const bytes = await rotatePdf(file, degrees, {
        signal,
        ...(selection.pages ? { pages: selection.pages } : {}),
      });
      setResult(pdfBytesToBlob(bytes));
      setStage('done');
      toast(
        selection.pages
          ? `Rotated ${selection.pages.length} ${selection.pages.length === 1 ? 'page' : 'pages'} by ${degrees}°`
          : `Rotated every page by ${degrees}°`,
        'success',
      );
    } catch (err) {
      const toolError = toToolError(err);
      if (toolError.code === 'cancelled') {
        // Cancelling is a choice, not a failure: no error banner, no stale stage.
        setStage(null);
        toast('Cancelled — nothing was saved', 'default');
      } else {
        setError({ message: toolError.message, hint: toolError.hint });
        setStage(null);
      }
    } finally {
      runControl.finish();
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
              <RunAction
                label={`Rotate ${degrees}°`}
                busyLabel="Rotating…"
                icon="rotate"
                busy={busy}
                disabled={selection.error !== null}
                onRun={run}
                onCancel={runControl.cancel}
                cancellable={runControl.cancellable}
                hint={selection.pages ? `${formatCount(selection.pages.length, 'page')} selected` : undefined}
              />
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
            <Field
              label="Pages"
              hint="Leave empty to rotate every page. Commas and ranges, e.g. 2-5, 9"
              trailing={
                <span className="setting-value">
                  {selection.pages ? formatCount(selection.pages.length, 'page') : 'All pages'}
                </span>
              }
            >
              <input
                className="input input--mono"
                value={range}
                onChange={(event) => {
                  setRange(event.target.value);
                  setResult(null);
                }}
                placeholder="All pages"
                aria-label="Pages to rotate"
                aria-invalid={selection.error !== null}
                aria-describedby={selection.error ? 'rotate-pages-error' : undefined}
              />
            </Field>
            {selection.error ? (
              <p className="field__error" id="rotate-pages-error">
                {selection.error}
              </p>
            ) : null}

            <Outcome
              rows={[
                { label: 'Pages', value: formatCount(pageCount, 'page') },
                {
                  label: 'Turning',
                  value: selection.pages
                    ? `${formatCount(selection.pages.length, 'page')} of ${pageCount}`
                    : `All ${pageCount}`,
                },
                { label: 'Applied', value: `${degrees}° ${degrees === 180 ? 'turn' : 'clockwise'}` },
                { label: 'Content', value: 'Unchanged · not re-compressed' },
              ]}
              note="Only the page orientation is rewritten. Text, images and quality stay exactly as they were."
            />
            <Notice tone="default" icon="info">
              Only the orientation changes. The page content is not re-compressed, so nothing loses quality.
            </Notice>
          </Settings>
        ) : null
      }
    >
      <div className="tool-body">
        {!file ? (
          <>
            <FileDrop
              handoffTarget="rotate-pdf"
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
                <p>Choose an angle, then rotate. A preview is not drawn here, so the result is ready as soon as you click.</p>
              </div>
            )}
          </>
        )}
      </div>
    </ToolLayout>
  );
}
